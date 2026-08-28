"""Inngest Workflow 2: Zoho Books Draft Invoice Generation for Approved Billing Rows."""

from datetime import datetime
from typing import List, Dict, Any, Optional
import inngest

from app.inngest_client import inngest_client
from app.models.schemas import (
    ZohoDraftInvoiceRequest,
    ZohoInvoiceLineItem,
    ZohoDraftInvoiceResponse,
)
from app.services.zoho_service import ZohoBooksService
from app.services.google_drive_service import GoogleDriveService
from app.services.google_sheets_service import GoogleSheetsService
from app.utils.logging import get_logger
from app.utils.progress_tracker import pipeline_tracker

logger = get_logger("zoho_invoice_generator")


async def run_zoho_invoices_core(
    target_month: str,
    target_year: int,
    explicit_sheet_id: Optional[str] = None,
    filter_client_name: Optional[str] = None,
    step_runner=None,
) -> Dict[str, Any]:
    """
    Core implementation of Zoho Draft Invoice generation from approved review rows.
    Runs via Inngest step runner or direct asynchronous execution.
    """
    async def _run_step(step_name: str, fn):
        if step_runner:
            return await step_runner(step_name, fn)
        return await fn()

    pipeline_tracker.start_pipeline("1-Click Zoho Invoicing", target_month, target_year, total_stages=3)

    try:
        pipeline_tracker.update_progress(
            percent=20,
            stage_index=1,
            current_step="Scanning review sheet for manager-approved billing rows...",
        )
        pipeline_tracker.add_log("info", f"Fetching approved items from Google Sheet for {target_month} {target_year}...")

        # Step 1: Discover / Locate Review Sheet & Fetch Approved Rows
        async def fetch_approved() -> Dict[str, Any]:
            sheets = GoogleSheetsService()
            drive = GoogleDriveService()

            sheet_id = explicit_sheet_id
            sheet_url = ""
            if not sheet_id:
                month_folder_id = drive.get_month_folder(target_month, target_year)
                sheet_id, sheet_url = sheets.find_or_create_workbook(target_month, target_year, month_folder_id)

            approved_rows = sheets.fetch_approved_monthly_rows(sheet_id)
            if filter_client_name:
                approved_rows = [r for r in approved_rows if r.get("client_name", "").lower() == filter_client_name.lower()]

            logger.info(f"Retrieved {len(approved_rows)} approved items ready for invoicing.")
            return {
                "spreadsheet_id": sheet_id,
                "spreadsheet_url": sheet_url,
                "approved_rows": approved_rows,
            }

        fetch_result = await _run_step("fetch-approved-items", fetch_approved)
        sheet_id = fetch_result.get("spreadsheet_id", "")
        approved_rows = fetch_result.get("approved_rows", [])

        if not approved_rows:
            logger.info("No approved rows found for invoicing.")
            pipeline_tracker.add_log("warning", "No approved rows found with Approved? == True and Status == PENDING.")
            pipeline_tracker.complete_pipeline({
                "status": "NO_APPROVED_ROWS",
                "message": "No rows with Approved? == True and Status == PENDING were found.",
                "invoices_created": [],
            })
            return {
                "status": "NO_APPROVED_ROWS",
                "message": "No rows with Approved? == True and Status == PENDING were found.",
                "invoices_created": [],
            }

        pipeline_tracker.update_progress(
            percent=50,
            stage_index=2,
            current_step=f"Drafting Zoho Invoices for {len(approved_rows)} approved items...",
            stats_update={"items_extracted": len(approved_rows)},
        )
        pipeline_tracker.add_log("info", f"Found {len(approved_rows)} approved line items to invoice.")

        # Step 2: Group by Client & Generate Draft Invoices
        async def generate_invoices() -> Dict[str, Any]:
            zoho = ZohoBooksService()
            sheets = GoogleSheetsService()

            client_groups: Dict[str, List[Dict[str, Any]]] = {}
            for row in approved_rows:
                client = row.get("client_name", "Unknown Client")
                client_groups.setdefault(client, []).append(row)

            created_invoices: List[Dict[str, Any]] = []

            for client_name, items in client_groups.items():
                contact_id = items[0].get("zoho_contact_id")
                if not contact_id:
                    contact = zoho.find_contact_by_name(client_name)
                    contact_id = contact.contact_id if contact else ""

                if not contact_id:
                    logger.warning(f"Could not determine Zoho Contact ID for client '{client_name}'. Skipping.")
                    pipeline_tracker.add_log("warning", f"Skipping {client_name}: Contact ID not matched in Zoho.")
                    continue

                zoho_line_items: List[ZohoInvoiceLineItem] = []
                row_indices: List[int] = []

                for item in items:
                    row_indices.append(item["row_index"])
                    total_qty = item.get("total_picked_up", 0) or item.get("total_delivered", 0)
                    loss_qty = item.get("linen_discrepancy", 0)
                    
                    desc = f"Linen service: {item.get('raw_names_seen', item.get('standard_item_name'))}. "
                    desc += f"Pickups: {item.get('total_picked_up', 0)}, Deliveries: {item.get('total_delivered', 0)}."
                    if loss_qty > 0:
                        desc += f" (Unreturned loss discrepancy: {loss_qty} pcs)"

                    zoho_line_items.append(
                        ZohoInvoiceLineItem(
                            item_id=item.get("zoho_item_id", ""),
                            name=item.get("standard_item_name", "Laundry Item"),
                            description=desc,
                            rate=item.get("unit_rate", 0.0),
                            quantity=total_qty,
                        )
                    )

                inv_date = datetime.now().strftime("%Y-%m-%d")
                inv_request = ZohoDraftInvoiceRequest(
                    customer_id=contact_id,
                    date=inv_date,
                    line_items=zoho_line_items,
                    notes=f"ANR Commercial Laundry Service Billing for {target_month} {target_year}. Sheet: {fetch_result.get('spreadsheet_url', sheet_id)}",
                    terms="Payment due within 14 days of invoice date.",
                )

                pipeline_tracker.add_log("info", f"Creating Draft Invoice in Zoho Books for {client_name} ({len(zoho_line_items)} items)...")
                response = await zoho.create_draft_invoice(inv_request)

                sheets.update_invoice_status(
                    spreadsheet_id=sheet_id,
                    row_indices=row_indices,
                    invoice_number=response.invoice_number,
                    invoice_url=response.invoice_url or "",
                )

                pipeline_tracker.add_log(
                    "success",
                    f"🎉 Created Draft Invoice {response.invoice_number} for {client_name} (GHS {response.total:.2f}). Marked INVOICED in sheet.",
                )
                created_invoices.append(response.model_dump())

            return {
                "status": "COMPLETED",
                "invoices_count": len(created_invoices),
                "invoices_created": created_invoices,
            }

        invoice_result = await _run_step("generate-draft-invoices", generate_invoices)
        pipeline_tracker.complete_pipeline(invoice_result)
        return invoice_result

    except Exception as e:
        logger.error(f"Invoice generation failed: {e}")
        pipeline_tracker.fail_pipeline(str(e))
        raise


async def execute_generate_zoho_invoices(ctx: inngest.Context, step: inngest.Step) -> Dict[str, Any]:
    """Inngest entrypoint for draft invoice generator."""
    event_data = ctx.event.data if hasattr(ctx.event, "data") and ctx.event.data else {}
    now = datetime.now()
    target_month = event_data.get("month") or now.strftime("%B")
    target_year = int(event_data.get("year") or now.year)
    explicit_sheet_id = event_data.get("spreadsheet_id")
    filter_client_name = event_data.get("client_name")

    return await run_zoho_invoices_core(
        target_month=target_month,
        target_year=target_year,
        explicit_sheet_id=explicit_sheet_id,
        filter_client_name=filter_client_name,
        step_runner=step.run,
    )


# Register durable Inngest function
anr_generate_zoho_invoices = inngest_client.create_function(
    fn_id="anr_generate_zoho_invoices",
    trigger=inngest.TriggerEvent(event="anr/invoices.generate"),
)(execute_generate_zoho_invoices)

