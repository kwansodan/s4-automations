"""Inngest Workflow: Accounts Payable (AP) Vendor Bill Ingestion & Processing."""

from datetime import datetime
from typing import List, Dict, Any, Optional
import inngest

from app.inngest_client import inngest_client
from app.models.schemas import (
    OCRAPBillExtraction,
    ZohoDraftBillRequest,
    ZohoDraftBillResponse,
)
from app.models.db_models import StagedTransaction, ClientOrganization
from app.db.session import get_engine
from app.services.zoho_service import ZohoBooksService
from app.services.google_drive_service import GoogleDriveService
from app.services.ocr_service import GeminiOCRService
from app.utils.logging import get_logger
from app.utils.progress_tracker import pipeline_tracker
from sqlmodel import select, Session

logger = get_logger("ap_billing_pipeline")


async def run_ap_pipeline_core(
    target_month: str,
    target_year: int,
    client_id: Optional[str] = None,
    auto_post_draft: bool = False,
    step_runner=None,
) -> Dict[str, Any]:
    """
    Core implementation of the automated Accounts Payable (AP) pipeline.
    Discovers vendor invoices in Drive/storage, extracts data via Gemini Vision OCR,
    matches or creates vendors in Zoho Books, and stages/posts draft bills.
    """
    async def _run_step(step_name: str, fn):
        if step_runner:
            return await step_runner(step_name, fn)
        return await fn()

    pipeline_tracker.start_pipeline("Accounts Payable (AP) Ingestion", target_month, target_year, total_stages=4)

    try:
        # Step 1: Pre-flight & Client Setup
        pipeline_tracker.update_progress(
            percent=15,
            stage_index=1,
            current_step="Connecting to client storage & Zoho Books organization...",
        )
        
        async def run_preflight() -> Dict[str, Any]:
            drive = GoogleDriveService()
            zoho_org_id = None
            client_name = "Default Client"
            
            with Session(get_engine()) as session:
                if client_id:
                    client = session.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
                    if client:
                        zoho_org_id = client.zoho_org_id
                        client_name = client.name
            
            zoho = ZohoBooksService(org_id=zoho_org_id)
            contacts = await zoho.fetch_active_contacts()
            
            # Discover bill files in client folder or AP folder
            month_folder_id = drive.get_month_folder(target_month, target_year)
            files = []
            try:
                files = drive.list_files_in_folder(month_folder_id)
            except Exception as e:
                logger.warning(f"Could not list files in month folder: {e}")
                
            return {
                "client_name": client_name,
                "zoho_org_id": zoho_org_id,
                "files_count": len(files),
                "files": files,
                "contacts_count": len(contacts),
            }

        preflight = await _run_step("ap-preflight", run_preflight)
        files = preflight.get("files", [])
        zoho_org_id = preflight.get("zoho_org_id")

        pipeline_tracker.update_progress(
            percent=35,
            stage_index=2,
            current_step=f"Discovered {len(files)} files for AP processing.",
        )

        # Step 2: OCR Extraction
        ocr = GeminiOCRService()
        drive = GoogleDriveService()
        zoho = ZohoBooksService(org_id=zoho_org_id)
        
        processed_bills: List[Dict[str, Any]] = []
        batch_id = f"AP_{target_year}_{target_month}_{int(datetime.now().timestamp())}"

        for idx, file_info in enumerate(files):
            file_id = file_info.get("id")
            file_name = file_info.get("name", f"bill_{idx}.pdf")
            mime_type = file_info.get("mimeType", "application/pdf")

            async def process_file():
                content = drive.download_file_bytes(file_id) if file_id else b""
                extraction: OCRAPBillExtraction = await ocr.extract_vendor_bill(
                    file_bytes=content,
                    mime_type=mime_type,
                    file_name=file_name,
                )
                
                # Check or Create Vendor in Zoho
                vendor_name = extraction.vendor_name or "Unknown Vendor"
                matched_contact = zoho.find_contact_by_name(vendor_name)
                vendor_id = ""
                if matched_contact:
                    vendor_id = matched_contact.contact_id
                else:
                    # Automatically create missing vendor in Zoho Books
                    new_contact = await zoho.create_vendor_contact(vendor_name)
                    vendor_id = new_contact.contact_id

                # Stage in DB
                staged = StagedTransaction(
                    client_id=client_id or "default",
                    batch_id=batch_id,
                    pipeline_type="AP",
                    transaction_date=extraction.bill_date or datetime.now().strftime("%Y-%m-%d"),
                    source_type="google_drive",
                    source_file_name=file_name,
                    item_or_description=f"Vendor Bill: {vendor_name}",
                    total_amount=extraction.total_amount,
                    status="PENDING",
                    metadata_json={
                        "vendor_name": vendor_name,
                        "vendor_id": vendor_id,
                        "bill_number": extraction.bill_number,
                        "currency": extraction.currency,
                        "items": [item.model_dump() for item in extraction.items],
                    }
                )
                with Session(get_engine()) as session:
                    session.add(staged)
                    session.commit()
                    session.refresh(staged)

                # If auto_post_draft is True, create draft bill in Zoho Books
                bill_res = None
                if auto_post_draft and vendor_id:
                    line_items = [
                        {
                            "name": it.item_description,
                            "description": it.item_description,
                            "rate": it.unit_rate or it.amount,
                            "quantity": it.quantity or 1,
                        }
                        for it in extraction.items
                    ]
                    if not line_items:
                        line_items = [{"name": "Expenses / Supplies", "rate": extraction.total_amount, "quantity": 1}]
                        
                    bill_req = ZohoDraftBillRequest(
                        vendor_id=vendor_id,
                        bill_number=extraction.bill_number,
                        date=extraction.bill_date or datetime.now().strftime("%Y-%m-%d"),
                        line_items=line_items,
                        notes=f"Processed via S4 Automations AP Pipeline ({batch_id})",
                    )
                    bill_res = await zoho.create_draft_bill(bill_req)
                    staged.status = "INVOICED"
                    staged.accounting_ref_id = bill_res.bill_id
                    with Session(get_engine()) as session:
                        session.add(staged)
                        session.commit()

                return {
                    "file_name": file_name,
                    "vendor_name": vendor_name,
                    "vendor_id": vendor_id,
                    "total_amount": extraction.total_amount,
                    "status": staged.status,
                    "bill_response": bill_res.model_dump() if bill_res else None,
                }

            res = await _run_step(f"process-ap-file-{idx}", process_file)
            processed_bills.append(res)
            
            percent = 35 + int(((idx + 1) / max(len(files), 1)) * 45)
            pipeline_tracker.update_progress(
                percent=percent,
                stage_index=3,
                current_step=f"Extracted bill {idx+1}/{len(files)}: {file_name}",
            )

        pipeline_tracker.update_progress(
            percent=100,
            stage_index=4,
            current_step=f"AP Pipeline complete. Processed {len(processed_bills)} vendor bills.",
            stats_update={
                "bills_processed": len(processed_bills),
                "total_ap_amount": sum(b.get("total_amount", 0.0) for b in processed_bills),
            },
        )

        return {
            "batch_id": batch_id,
            "target_month": target_month,
            "target_year": target_year,
            "bills_processed_count": len(processed_bills),
            "bills": processed_bills,
        }

    except Exception as e:
        logger.error(f"AP Pipeline error: {e}", exc_info=True)
        pipeline_tracker.fail_pipeline(str(e))
        raise


@inngest_client.create_function(
    fn_id="accounts-payable-pipeline",
    name="Accounts Payable (AP) Pipeline",
    trigger=inngest.TriggerEvent(event="app/ap.pipeline.trigger"),
)
async def inngest_ap_pipeline_fn(ctx: inngest.Context) -> Dict[str, Any]:
    event_data = ctx.event.data or {}
    target_month = event_data.get("month", datetime.now().strftime("%B"))
    target_year = int(event_data.get("year", datetime.now().year))
    client_id = event_data.get("client_id")
    auto_post_draft = bool(event_data.get("auto_post_draft", False))

    async def step_runner(name: str, fn):
        return await ctx.step.run(name, fn)

    return await run_ap_pipeline_core(
        target_month=target_month,
        target_year=target_year,
        client_id=client_id,
        auto_post_draft=auto_post_draft,
        step_runner=step_runner,
    )
