import calendar
import re
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
from app.utils.logging import get_logger
from app.utils.progress_tracker import pipeline_tracker

logger = get_logger("zoho_invoice_generator")


def extract_slip_customer_name(source_file_name: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None) -> str:
    """Extracts customer / property name from slip metadata or source filename."""
    metadata = metadata or {}
    if metadata.get("customer_name") and str(metadata["customer_name"]).strip():
        return str(metadata["customer_name"]).strip()
    if metadata.get("customer") and str(metadata["customer"]).strip():
        return str(metadata["customer"]).strip()
    if metadata.get("property_name") and str(metadata["property_name"]).strip():
        return str(metadata["property_name"]).strip()
    if metadata.get("customer_name_hint") and str(metadata["customer_name_hint"]).strip():
        return str(metadata["customer_name_hint"]).strip()
    if not source_file_name:
        return "General Customer"
    base = re.sub(r"\.[a-zA-Z0-9]+$", "", source_file_name).strip()
    base = re.sub(r"[\s._-]+(\d{1,2}[\s._\/-]\d{1,2}[\s._\/-]\d{2,4}|\d{4}[\s._\/-]\d{1,2}[\s._\/-]\d{1,2})$", "", base, flags=re.I).strip()
    base = re.sub(r"^(manual_slip_|manual_bill_|manual_|slip_)", "", base, flags=re.I).strip()
    base = base.replace("_", " ").strip()
    return base if base else "General Customer"


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

        # Step 1: Query PostgreSQL staged_transactions Ledger for Approved Rows
        async def fetch_approved() -> Dict[str, Any]:
            approved_rows = []

            logger.info("Scanning PostgreSQL staged_transactions ledger for approved billing rows...")
            from app.models.db_models import StagedTransaction
            with Session(get_engine()) as session:
                query = select(StagedTransaction).where(
                    StagedTransaction.approved == True,
                    StagedTransaction.status.in_(["PENDING", "APPROVED"]),
                    StagedTransaction.pipeline_type != "AP",
                )
                if filter_client_name:
                    from app.api.v1.clients import get_client_id_aliases
                    aliases = get_client_id_aliases(filter_client_name)
                    query = query.where(StagedTransaction.client_id.in_(aliases))
                staged_approved = session.exec(query).all()
                if staged_approved:
                    logger.info(f"Discovered {len(staged_approved)} approved transactions from PostgreSQL staged_transactions ledger.")
                    for idx, st in enumerate(staged_approved, start=1000):
                        match_month = True
                        if target_month and st.transaction_date:
                            try:
                                parsed_date = datetime.fromisoformat(st.transaction_date.replace("Z", "+00:00"))
                                if parsed_date.strftime("%B").lower() != target_month.lower():
                                    match_month = False
                                if target_year and parsed_date.year != target_year:
                                    match_month = False
                            except Exception:
                                pass
                        if match_month:
                            cust_name = extract_slip_customer_name(st.source_file_name, st.metadata_json)
                            approved_rows.append({
                                "row_index": idx,
                                "tenant_id": st.client_id,
                                "customer_name": cust_name,
                                "client_name": st.client_id,
                                "zoho_contact_id": (st.metadata_json or {}).get("zoho_contact_id", ""),
                                "zoho_item_id": st.accounting_ref_id or (st.metadata_json or {}).get("zoho_item_id", ""),
                                "standard_item_name": st.item_or_description,
                                "raw_names_seen": st.item_or_description,
                                "confidence_score": "HIGH",
                                "unit_rate": float(st.rate_or_price or st.total_amount or 0.0),
                                "total_picked_up": int(st.credit_amount or st.quantity_or_debit or 1),
                                "total_delivered": int(st.quantity_or_debit or 1),
                                "linen_discrepancy": int(st.discrepancy_amount or 0),
                                "total_billed": float(st.total_amount or 0.0),
                                "audit_notes": f"PostgreSQL Staged ID: {st.id}",
                                "reviewed": True,
                                "approved": True,
                                "status": "APPROVED",
                                "_staged_transaction_id": st.id,
                            })


            logger.info(f"Retrieved {len(approved_rows)} approved items from PostgreSQL ledger ready for invoicing.")
            return {
                "source": "in_app_ledger",
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

        # Step 2: Group by Customer (recipient on delivery slip) & Generate Draft Invoices in Tenant's Zoho Books
        async def generate_invoices() -> Dict[str, Any]:
            customer_groups: Dict[str, List[Dict[str, Any]]] = {}
            for row in approved_rows:
                customer = row.get("customer_name") or "General Customer"
                customer_groups.setdefault(customer, []).append(row)

            created_invoices: List[Dict[str, Any]] = []

            for customer_name, items in customer_groups.items():
                tenant_slug = items[0].get("tenant_id") or filter_client_name or "anr_group"
                zoho_org_id = None
                tenant_obj = None
                with Session(get_engine()) as session:
                    from app.api.v1.clients import get_client_id_aliases
                    slug_aliases = get_client_id_aliases(tenant_slug)
                    tenant_obj = session.exec(
                        select(ClientOrganization).where(
                            (ClientOrganization.id.in_(slug_aliases)) | (ClientOrganization.name.in_(slug_aliases))
                        )
                    ).first()
                    if tenant_obj:
                        zoho_org_id = tenant_obj.zoho_org_id

                try:
                    zoho = ZohoBooksService.from_client_id(tenant_slug)
                    if zoho_org_id:
                        zoho.org_id = zoho_org_id
                except Exception:
                    zoho = ZohoBooksService(org_id=zoho_org_id)

                # Ensure active Zoho contacts are loaded into memory cache
                try:
                    await zoho.fetch_active_contacts()
                except Exception as fetch_err:
                    logger.debug(f"Could not fetch Zoho contacts into cache: {fetch_err}")

                contact_id = items[0].get("zoho_contact_id")

                # Check customer_mappings registry in tenant configuration
                if not contact_id and tenant_obj:
                    cfg = tenant_obj.custom_config or {}
                    mappings = cfg.get("customer_mappings", {})
                    if customer_name in mappings:
                        contact_id = mappings[customer_name].get("zoho_contact_id")

                if not contact_id:
                    contact = zoho.find_contact_by_name(customer_name)
                    contact_id = contact.contact_id if contact else ""

                if not contact_id:
                    from app.config import settings
                    if settings.MOCK_MODE or not zoho.org_id or not zoho.refresh_token:
                        contact_id = f"cnt_auto_{customer_name.lower().replace(' ', '_')[:16]}"
                        logger.info(f"Using default contact ID '{contact_id}' for customer '{customer_name}' in tenant '{tenant_slug}'.")
                    else:
                        try:
                            logger.info(f"Auto-provisioning customer '{customer_name}' in Zoho Books for tenant '{tenant_slug}'...")
                            new_cust = await zoho.create_customer_contact(customer_name)
                            contact_id = new_cust.contact_id
                            pipeline_tracker.add_log("info", f"Auto-created new Customer '{customer_name}' in Zoho Books (ID: {contact_id}).")
                        except Exception as create_err:
                            logger.error(f"Failed to auto-create customer '{customer_name}' in Zoho Books: {create_err}")
                            pipeline_tracker.add_log("warning", f"Skipping {customer_name}: Could not find or auto-create contact in Zoho Books.")
                            continue

                # Determine whether to include descriptions for this client's line items
                should_include_desc = include_line_item_description
                if should_include_desc is None and tenant_obj:
                    should_include_desc = (tenant_obj.custom_config or {}).get("include_line_item_description", True)
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

                tenant_display_name = tenant_obj.name if tenant_obj else "Commercial Laundry"
                inv_request = ZohoDraftInvoiceRequest(
                    customer_id=contact_id,
                    date=inv_date,
                    line_items=zoho_line_items,
                    notes=f"{tenant_display_name} Commercial Laundry Service Billing for {customer_name} ({target_month} {target_year}). (Source: In-App PostgreSQL Ledger)",
                    terms="Payment due within 14 days of invoice date.",
                )

                pipeline_tracker.add_log("info", f"Drafting/Appending to Zoho Books Invoice for {customer_name} in {tenant_display_name}'s organization (Invoice Date: {inv_date}, {len(zoho_line_items)} items)...")
                response = await zoho.create_or_append_draft_invoice(inv_request, target_month, target_year)

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
                    f"🎉 Processed Draft Invoice {response.invoice_number} for customer {customer_name} in {tenant_display_name}'s Zoho Books (Total: GHS {response.total:.2f}). Marked INVOICED.",
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
        if e.__class__.__name__ in ("StepInterrupt", "InngestStepInterrupt"):
            raise
        logger.error(f"Invoice generation failed: {e}")
        pipeline_tracker.fail_pipeline(str(e))
        raise


async def execute_generate_zoho_invoices(
    ctx: inngest.Context,
    step: Optional[inngest.Step] = None,
) -> Dict[str, Any]:
    """Inngest entrypoint for draft invoice generator."""
    event_data = ctx.event.data if hasattr(ctx.event, "data") and ctx.event.data else {}
    now = datetime.now()
    target_month = event_data.get("month") or now.strftime("%B")
    target_year = int(event_data.get("year") or now.year)
    explicit_sheet_id = event_data.get("spreadsheet_id")
    filter_client_name = event_data.get("client_id") or event_data.get("client_name")
    include_line_item_description = event_data.get("include_line_item_description")

    step_runner = None
    if hasattr(ctx, "step") and ctx.step:
        async def _ctx_step_runner(name: str, fn):
            return await ctx.step.run(name, fn)
        step_runner = _ctx_step_runner
    elif step and hasattr(step, "run"):
        async def _direct_step_runner(name: str, fn):
            return await step.run(name, fn)
        step_runner = _direct_step_runner

    return await run_zoho_invoices_core(
        target_month=target_month,
        target_year=target_year,
        explicit_sheet_id=explicit_sheet_id,
        filter_client_name=filter_client_name,
        include_line_item_description=include_line_item_description,
        step_runner=step_runner,
    )


# Register durable Inngest function
s4_generate_zoho_invoices = inngest_client.create_function(
    fn_id="s4_generate_zoho_invoices",
    trigger=[
        inngest.TriggerEvent(event="s4/invoices.generate"),
        inngest.TriggerEvent(event="anr/invoices.generate"),
    ],
)(execute_generate_zoho_invoices)

anr_generate_zoho_invoices = s4_generate_zoho_invoices

