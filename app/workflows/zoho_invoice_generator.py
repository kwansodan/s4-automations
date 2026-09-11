import calendar
from datetime import datetime
from typing import List, Dict, Any, Optional
import inngest

from app.inngest_client import inngest_client
from app.models.schemas import (
    ZohoDraftInvoiceRequest,
    ZohoInvoiceLineItem,
    ZohoDraftInvoiceResponse,
)
from app.models.db_models import ClientOrganization
from app.db.session import get_engine
from sqlmodel import select, Session
from app.services.zoho_service import ZohoBooksService
from app.services.google_drive_service import GoogleDriveService
from app.services.google_sheets_service import GoogleSheetsService
from app.utils.logging import get_logger
from app.utils.progress_tracker import pipeline_tracker

logger = get_logger("zoho_invoice_generator")


async def run_zoho_invoices_core(
    target_month: Optional[str] = None,
    target_year: Optional[int] = None,
    explicit_sheet_id: Optional[str] = None,
    filter_client_name: Optional[str] = None,
    include_line_item_description: Optional[bool] = None,
    step_runner=None,
    month: Optional[str] = None,
    year: Optional[int] = None,
    **kwargs,
) -> Dict[str, Any]:
    """
    Core implementation of Zoho Draft Invoice generation from approved review rows.
    Runs via Inngest step runner or direct asynchronous execution.
    Supports both Google Sheets approved rows and PostgreSQL staged transactions ledger.
    """
    now = datetime.now()
    target_month = target_month or month or now.strftime("%B")
    target_year = int(target_year or year or now.year)

    async def _run_step(step_name: str, fn):
        if step_runner:
            return await step_runner(step_name, fn)
        return await fn()

    pipeline_tracker.start_pipeline("1-Click Zoho Invoicing", target_month, target_year, total_stages=3)

    try:
        # Calculate Invoice Date as the last day of the billing month (e.g. 2026-08-31)
        try:
            month_num = datetime.strptime(target_month, "%B").month
        except ValueError:
            try:
                month_num = datetime.strptime(target_month, "%b").month
            except ValueError:
                try:
                    month_num = int(target_month)
                except ValueError:
                    month_num = datetime.now().month

        last_day = calendar.monthrange(target_year, month_num)[1]
        inv_date = f"{target_year:04d}-{month_num:02d}-{last_day:02d}"

        pipeline_tracker.update_progress(
            percent=20,
            stage_index=1,
            current_step="Scanning review workspace for manager-approved billing rows...",
        )
        pipeline_tracker.add_log("info", f"Fetching approved items for {target_month} {target_year} (Invoice Date: {inv_date})...")

        # Step 1: Discover / Locate Review Sheet & Fetch Approved Rows
        async def fetch_approved() -> Dict[str, Any]:
            sheets = GoogleSheetsService()
            drive = GoogleDriveService()

            sheet_id = explicit_sheet_id
            sheet_url = ""
            approved_rows = []

            try:
                if not sheet_id:
                    month_folder_id = drive.get_month_folder(target_month, target_year)
                    sheet_id, sheet_url = sheets.find_or_create_workbook(target_month, target_year, month_folder_id)

                approved_rows = sheets.fetch_approved_monthly_rows(sheet_id)
                if filter_client_name:
                    approved_rows = [r for r in approved_rows if r.get("client_name", "").lower() == filter_client_name.lower()]
            except Exception as sheet_err:
                logger.warning(f"Notice fetching sheets approved rows: {sheet_err}")

            # Fallback: check PostgreSQL staged_transactions if Google Sheets has no approved items
            if not approved_rows:
                logger.info("Scanning PostgreSQL staged_transactions ledger for approved items...")
                from app.models.db_models import StagedTransaction
                with Session(get_engine()) as session:
                    query = select(StagedTransaction).where(
                        StagedTransaction.approved == True,
                        StagedTransaction.status.in_(["PENDING", "APPROVED"]),
                        StagedTransaction.pipeline_type != "AP",
                    )
                    if filter_client_name:
                        c_slug = filter_client_name.lower().replace(" ", "_")
                        query = query.where(
                            (StagedTransaction.client_id == c_slug) | (StagedTransaction.client_id == filter_client_name)
                        )
                    staged_approved = session.exec(query).all()
                    if staged_approved:
                        logger.info(f"Discovered {len(staged_approved)} approved transactions from PostgreSQL staged_transactions ledger.")
                        for idx, st in enumerate(staged_approved, start=1000):
                            approved_rows.append({
                                "row_index": idx,
                                "client_name": st.client_id,
                                "zoho_contact_id": "",
                                "zoho_item_id": st.accounting_ref_id or "",
                                "standard_item_name": st.item_or_description,
                                "raw_names_seen": st.item_or_description,
                                "confidence_score": "HIGH",
                                "unit_rate": st.rate_or_price or st.total_amount,
                                "total_picked_up": int(st.quantity_or_debit) or 1,
                                "total_delivered": int(st.quantity_or_debit) or 1,
                                "linen_discrepancy": int(st.discrepancy_amount),
                                "total_billed": st.total_amount,
                                "audit_notes": f"PostgreSQL Staged ID: {st.id}",
                                "reviewed": True,
                                "approved": True,
                                "status": "PENDING",
                                "_staged_transaction_id": st.id,
                            })

            logger.info(f"Retrieved {len(approved_rows)} approved items ready for invoicing.")
            return {
                "spreadsheet_id": sheet_id or "local_ledger",
                "spreadsheet_url": sheet_url,
                "approved_rows": approved_rows,
            }

        fetch_result = await _run_step("fetch-approved-items", fetch_approved)
        sheet_id = fetch_result.get("spreadsheet_id", "")
        approved_rows = fetch_result.get("approved_rows", [])

        if not approved_rows:
            logger.info("No approved rows found for invoicing.")
            pipeline_tracker.add_log("warning", "No approved rows found with Approved == True and Status == PENDING in Sheets or PostgreSQL ledger.")
            pipeline_tracker.complete_pipeline({
                "status": "NO_APPROVED_ROWS",
                "message": "No rows with Approved == True and Status in [PENDING, APPROVED] were found. Please approve rows before generating invoices.",
                "invoices_created": [],
            })
            return {
                "status": "NO_APPROVED_ROWS",
                "message": "No rows with Approved == True and Status in [PENDING, APPROVED] were found. Please approve rows before generating invoices.",
                "invoices_created": [],
            }

        pipeline_tracker.update_progress(
            percent=50,
            stage_index=2,
            current_step=f"Drafting Zoho Invoices for {len(approved_rows)} approved items (Date: {inv_date})...",
            stats_update={"items_extracted": len(approved_rows)},
        )
        pipeline_tracker.add_log("info", f"Found {len(approved_rows)} approved line items to invoice.")

        # Step 2: Group by Client & Generate Draft Invoices
        async def generate_invoices() -> Dict[str, Any]:
            sheets = GoogleSheetsService()

            client_groups: Dict[str, List[Dict[str, Any]]] = {}
            for row in approved_rows:
                client = row.get("client_name", "Unknown Client")
                client_groups.setdefault(client, []).append(row)

            created_invoices: List[Dict[str, Any]] = []

            for client_name, items in client_groups.items():
                zoho_org_id = None
                client_obj = None
                with Session(get_engine()) as session:
                    client_slug = client_name.lower().replace(" ", "_")
                    client_obj = session.exec(
                        select(ClientOrganization).where(
                            (ClientOrganization.id == client_slug) | (ClientOrganization.name == client_name)
                        )
                    ).first()
                    if client_obj:
                        zoho_org_id = client_obj.zoho_org_id

                zoho = ZohoBooksService(org_id=zoho_org_id)
                contact_id = items[0].get("zoho_contact_id") or (client_obj.zoho_contact_id if client_obj else None)
                if not contact_id:
                    contact = zoho.find_contact_by_name(client_name)
                    contact_id = contact.contact_id if contact else ""

                if not contact_id and client_obj:
                    contact = zoho.find_contact_by_name(client_obj.name) or zoho.find_contact_by_name(client_obj.id)
                    contact_id = contact.contact_id if contact else ""

                if not contact_id:
                    from app.config import settings
                    if settings.MOCK_MODE or not zoho.org_id:
                        contact_id = f"cnt_auto_{client_name.lower().replace(' ', '_')[:16]}"
                        logger.info(f"Using default contact ID '{contact_id}' for client '{client_name}'.")
                    else:
                        logger.warning(f"Could not determine Zoho Contact ID for client '{client_name}'. Skipping.")
                        pipeline_tracker.add_log("warning", f"Skipping {client_name}: Contact ID not matched in Zoho Books.")
                        continue

                # Determine whether to include descriptions for this client's line items
                should_include_desc = include_line_item_description
                if should_include_desc is None and client_obj:
                    should_include_desc = (client_obj.custom_config or {}).get("include_line_item_description", True)
                if should_include_desc is None:
                    should_include_desc = True

                zoho_line_items: List[ZohoInvoiceLineItem] = []
                row_indices: List[int] = []

                for item in items:
                    row_indices.append(item["row_index"])
                    total_qty = item.get("total_picked_up", 0) or item.get("total_delivered", 0)
                    loss_qty = item.get("linen_discrepancy", 0)
                    
                    desc = ""
                    if should_include_desc:
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

                inv_request = ZohoDraftInvoiceRequest(
                    customer_id=contact_id,
                    date=inv_date,
                    line_items=zoho_line_items,
                    notes=f"ANR Commercial Laundry Service Billing for {target_month} {target_year}. Sheet: {fetch_result.get('spreadsheet_url', sheet_id)}",
                    terms="Payment due within 14 days of invoice date.",
                )

                pipeline_tracker.add_log("info", f"Drafting/Appending to Zoho Books Invoice for {client_name} (Invoice Date: {inv_date}, {len(zoho_line_items)} items)...")
                response = await zoho.create_or_append_draft_invoice(inv_request, target_month, target_year)

                if sheet_id and not sheet_id.startswith("mock_") and sheet_id != "local_ledger":
                    try:
                        sheets.update_invoice_status(
                            spreadsheet_id=sheet_id,
                            row_indices=row_indices,
                            invoice_number=response.invoice_number,
                            invoice_url=response.invoice_url or "",
                        )
                    except Exception as sheet_err:
                        logger.warning(f"Could not update sheet invoice status: {sheet_err}")

                # Also update corresponding staged_transactions in PostgreSQL
                staged_ids = [it.get("_staged_transaction_id") for it in items if it.get("_staged_transaction_id")]
                if staged_ids:
                    try:
                        with Session(get_engine()) as session:
                            from app.models.db_models import StagedTransaction
                            st_query = select(StagedTransaction).where(StagedTransaction.id.in_(staged_ids))
                            for st in session.exec(st_query).all():
                                st.status = "INVOICED"
                                st.accounting_ref_id = response.invoice_number or response.invoice_id
                                session.add(st)
                            session.commit()
                    except Exception as db_err:
                        logger.warning(f"Could not update staged transactions in DB: {db_err}")

                pipeline_tracker.add_log(
                    "success",
                    f"🎉 Processed Draft Invoice {response.invoice_number} for {client_name} (Total: GHS {response.total:.2f}). Marked INVOICED.",
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

