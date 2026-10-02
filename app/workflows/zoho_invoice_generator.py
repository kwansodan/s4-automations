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
    mode: str = "append",
    target_customer_name: Optional[str] = None,
    invoice_date: Optional[str] = None,
    due_date: Optional[str] = None,
    terms: Optional[str] = None,
    confirm_delete: bool = False,
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

    target_customer_name = target_customer_name.strip() if target_customer_name and str(target_customer_name).strip() else None

    if mode == "regenerate" and not confirm_delete:
        raise ValueError("Regeneration mode requires explicit confirmation (confirm_delete=True)")

    async def _run_step(step_name: str, fn):
        if step_runner:
            return await step_runner(step_name, fn)
        return await fn()

    pipeline_tracker.start_pipeline("1-Click Zoho Invoicing", target_month, target_year, total_stages=3)

    try:
        # Calculate Invoice Date: either explicit invoice_date override or last day of billing month
        if invoice_date and str(invoice_date).strip():
            inv_date = str(invoice_date).strip()
        else:
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
        pipeline_tracker.add_log("info", f"Fetching approved items for {target_month} {target_year} (Invoice Date: {inv_date}, Mode: {mode})...")

        # Step 1: Query PostgreSQL staged_transactions Ledger for Approved Rows
        async def fetch_approved() -> Dict[str, Any]:
            approved_rows = []

            logger.info("Scanning PostgreSQL staged_transactions ledger for approved billing rows...")
            from app.models.db_models import StagedTransaction
            status_list = ["PENDING", "APPROVED", "INVOICED"] if mode == "regenerate" else ["PENDING", "APPROVED"]
            with Session(get_engine()) as session:
                query = select(StagedTransaction).where(
                    StagedTransaction.approved == True,
                    StagedTransaction.status.in_(status_list),
                    StagedTransaction.pipeline_type != "AP",
                )
                if filter_client_name:
                    from app.api.v1.clients import get_client_id_aliases
                    aliases = get_client_id_aliases(filter_client_name)
                    query = query.where(StagedTransaction.client_id.in_(aliases))
                staged_approved = session.exec(query).all()
                if not staged_approved and mode != "regenerate":
                    fallback_query = select(StagedTransaction).where(
                        StagedTransaction.approved == True,
                        StagedTransaction.status == "INVOICED",
                        StagedTransaction.pipeline_type != "AP",
                    )
                    if filter_client_name:
                        from app.api.v1.clients import get_client_id_aliases
                        aliases = get_client_id_aliases(filter_client_name)
                        fallback_query = fallback_query.where(StagedTransaction.client_id.in_(aliases))
                    staged_approved = session.exec(fallback_query).all()

                if staged_approved:
                    logger.info(f"Discovered {len(staged_approved)} approved transactions from PostgreSQL staged_transactions ledger (status in {status_list}).")
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
                            if target_customer_name and cust_name.strip().lower() != target_customer_name.strip().lower():
                                continue
                            approved_rows.append({
                                "row_index": idx,
                                "tenant_id": st.client_id,
                                "customer_name": cust_name,
                                "client_name": st.client_id,
                                "zoho_contact_id": (st.metadata_json or {}).get("zoho_contact_id", ""),
                                "zoho_item_id": (st.metadata_json or {}).get("zoho_item_id", ""),
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
            status_desc = "[PENDING, APPROVED, INVOICED]" if mode == "regenerate" else "[PENDING, APPROVED]"
            pipeline_tracker.add_log("warning", f"No approved rows found with Approved == True and Status in {status_desc} in PostgreSQL ledger.")
            no_rows_result = {
                "status": "NO_APPROVED_ROWS",
                "message": f"No rows with Approved == True and Status in {status_desc} were found. Please approve rows before generating invoices.",
                "invoices_created": [],
            }
            pipeline_tracker.complete_pipeline(no_rows_result)
            return no_rows_result

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
                if target_customer_name and customer.strip().lower() != target_customer_name.strip().lower():
                    continue
                customer_groups.setdefault(customer, []).append(row)

            total_customers = len(customer_groups)
            pipeline_tracker.update_step(
                current_step=f"Processing draft invoices for {total_customers} Customer(s) ({len(approved_rows)} items)...",
                percent=50,
                stage_index=2,
                stats_update={
                    "customers_total": total_customers,
                    "customers_done": 0,
                    "items_extracted": len(approved_rows),
                },
            )

            created_invoices: List[Dict[str, Any]] = []

            for idx, (customer_name, items) in enumerate(customer_groups.items(), 1):
                step_percent = 50 + int(((idx - 1) / max(total_customers, 1)) * 45)  # Progresses smoothly 50% to 95%
                pipeline_tracker.update_step(
                    current_step=f"Preparing Customer invoice ({idx}/{total_customers}): {customer_name}...",
                    percent=step_percent,
                    stage_index=2,
                    stats_update={"customers_done": idx - 1},
                )

                tenant_slug = items[0].get("tenant_id") or filter_client_name or "anr_group"
                zoho_org_id = None
                tenant_custom_config = {}
                tenant_db_id = None
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
                        tenant_custom_config = dict(tenant_obj.custom_config or {})
                        tenant_db_id = tenant_obj.id

                try:
                    zoho = ZohoBooksService.from_client_id(tenant_slug)
                    if zoho_org_id:
                        zoho.org_id = zoho_org_id
                except Exception:
                    zoho = ZohoBooksService(org_id=zoho_org_id)

                # Ensure active Zoho contacts and items are loaded into memory cache
                try:
                    await zoho.fetch_active_contacts()
                    await zoho.fetch_item_catalog()
                except Exception as fetch_err:
                    logger.debug(f"Could not fetch Zoho contacts/items into cache: {fetch_err}")

                from app.config import settings
                is_mock = getattr(settings, "MOCK_MODE", False) or not zoho.org_id

                contact_id = items[0].get("zoho_contact_id")
                if not contact_id or (not is_mock and not str(contact_id).strip().isdigit()):
                    contact_id = ""

                # Check customer_mappings registry in tenant configuration (case-insensitive)
                if not contact_id:
                    mappings = tenant_custom_config.get("customer_mappings", {})
                    if customer_name in mappings:
                        cand = mappings[customer_name].get("zoho_contact_id")
                        if cand and (is_mock or str(cand).strip().isdigit()):
                            contact_id = str(cand).strip()
                    if not contact_id:
                        c_lower = customer_name.strip().lower()
                        for m_key, m_val in mappings.items():
                            if m_key.strip().lower() == c_lower:
                                cand = m_val.get("zoho_contact_id")
                                if cand and (is_mock or str(cand).strip().isdigit()):
                                    contact_id = str(cand).strip()
                                    break

                if not contact_id:
                    contact = zoho.find_contact_by_name(customer_name)
                    if contact and (is_mock or str(contact.contact_id).strip().isdigit()):
                        contact_id = str(contact.contact_id).strip()

                if not contact_id:
                    from datetime import timezone
                    from sqlalchemy.orm.attributes import flag_modified
                    auto_create_policy = bool(
                        tenant_custom_config.get("auto_create_missing_contacts", False)
                    )

                    if not auto_create_policy:
                        logger.warning(
                            f"Skipping customer '{customer_name}' in tenant '{tenant_slug}': Not mapped to a Zoho contact and auto_create_missing_contacts is disabled by policy."
                        )
                        pipeline_tracker.add_log(
                            "warning",
                            f"Skipping Customer '{customer_name}': Not mapped in Customer Registry and auto-provisioning is disabled by policy. Please map this customer in Client Settings or Daily Slip Review.",
                        )
                        continue

                    if settings.MOCK_MODE or not zoho.org_id or not zoho.refresh_token:
                        contact_id = f"cnt_auto_{customer_name.lower().replace(' ', '_')[:16]}"
                        logger.info(f"Using default contact ID '{contact_id}' for customer '{customer_name}' in tenant '{tenant_slug}'.")
                    else:
                        try:
                            logger.info(f"Auto-provisioning customer '{customer_name}' in Zoho Books for tenant '{tenant_slug}' (opt-in policy enabled)...")
                            new_cust = await zoho.create_customer_contact(customer_name)
                            contact_id = new_cust.contact_id
                            pipeline_tracker.add_log("info", f"Auto-created new Customer '{customer_name}' in Zoho Books (ID: {contact_id}).")

                            # Register into customer_mappings so subsequent runs resolve immediately
                            if tenant_db_id:
                                with Session(get_engine()) as reg_session:
                                    t_ref = reg_session.exec(select(ClientOrganization).where(ClientOrganization.id == tenant_db_id)).first()
                                    if t_ref:
                                        t_cfg = dict(t_ref.custom_config or {})
                                        t_maps = dict(t_cfg.get("customer_mappings", {}))
                                        t_maps[customer_name] = {
                                            "zoho_contact_id": contact_id,
                                            "name": customer_name,
                                            "currency_code": "GHS",
                                            "updated_at": datetime.now(timezone.utc).isoformat(),
                                        }
                                        t_cfg["customer_mappings"] = t_maps
                                        t_ref.custom_config = t_cfg
                                        flag_modified(t_ref, "custom_config")
                                        reg_session.add(t_ref)
                                        reg_session.commit()
                        except Exception as create_err:
                            logger.error(f"Failed to auto-create customer '{customer_name}' in Zoho Books: {create_err}")
                            pipeline_tracker.add_log("warning", f"Skipping {customer_name}: Could not find or auto-create contact in Zoho Books.")
                            continue

                # Determine whether to include descriptions for this client's line items
                should_include_desc = include_line_item_description
                if should_include_desc is None:
                    should_include_desc = tenant_custom_config.get("include_line_item_description", False)
                if should_include_desc is None:
                    should_include_desc = False

                zoho_line_items: List[ZohoInvoiceLineItem] = []
                row_indices: List[int] = []

                # Aggregate line items by linen SKU / item name to prevent duplicate lines and respect Zoho Books 200 line item limit
                sku_groups: Dict[str, Dict[str, Any]] = {}
                for item in items:
                    row_indices.append(item["row_index"])
                    total_qty = item.get("total_picked_up", 0) or item.get("total_delivered", 0)
                    loss_qty = item.get("linen_discrepancy", 0)
                    item_name = item.get("standard_item_name") or "Laundry Item"
                    raw_sku_id = item.get("zoho_item_id")
                    sku_key = str(raw_sku_id).strip() if (raw_sku_id and str(raw_sku_id).strip().isdigit()) else item_name.strip().lower()

                    if sku_key not in sku_groups:
                        sku_groups[sku_key] = {
                            "zoho_item_id": str(raw_sku_id).strip() if (raw_sku_id and str(raw_sku_id).strip().isdigit()) else "",
                            "name": item_name,
                            "unit_rate": float(item.get("unit_rate", 0.0)),
                            "total_qty": 0,
                            "total_pickup": 0,
                            "total_delivery": 0,
                            "total_loss": 0,
                            "slips_count": 0,
                        }
                    sku_groups[sku_key]["total_qty"] += total_qty
                    sku_groups[sku_key]["total_pickup"] += item.get("total_picked_up", 0)
                    sku_groups[sku_key]["total_delivery"] += item.get("total_delivered", 0)
                    sku_groups[sku_key]["total_loss"] += loss_qty
                    sku_groups[sku_key]["slips_count"] += 1
                    if float(item.get("unit_rate", 0.0)) > 0:
                        sku_groups[sku_key]["unit_rate"] = float(item.get("unit_rate", 0.0))

                for sku_key, sku_data in sku_groups.items():
                    desc = ""
                    if should_include_desc:
                        desc = f"Linen service: {sku_data['name']} ({sku_data['slips_count']} slips). "
                        desc += f"Pickups: {sku_data['total_pickup']}, Deliveries: {sku_data['total_delivery']}."
                        if sku_data["total_loss"] > 0:
                            desc += f" (Unreturned loss discrepancy: {sku_data['total_loss']} pcs)"

                    resolved_item_id = sku_data.get("zoho_item_id", "")
                    if not resolved_item_id or not str(resolved_item_id).isdigit():
                        matched_item = zoho.find_item_by_name(sku_data["name"])
                        if matched_item and str(matched_item.item_id).isdigit():
                            resolved_item_id = str(matched_item.item_id)
                        else:
                            resolved_item_id = ""

                    zoho_line_items.append(
                        ZohoInvoiceLineItem(
                            item_id=resolved_item_id,
                            name=sku_data["name"],
                            description=desc,
                            rate=sku_data["unit_rate"],
                            quantity=sku_data["total_qty"],
                        )
                    )

                tenant_display_name = tenant_obj.name if tenant_obj else "Commercial Laundry"

                # Calculate custom due_date and terms overrides
                if due_date and str(due_date).strip():
                    resolved_due_date = str(due_date).strip()
                else:
                    try:
                        parsed_inv_dt = datetime.strptime(inv_date, "%Y-%m-%d")
                        from datetime import timedelta
                        resolved_due_date = (parsed_inv_dt + timedelta(days=14)).strftime("%Y-%m-%d")
                    except Exception:
                        resolved_due_date = inv_date

                if terms and str(terms).strip():
                    resolved_terms = str(terms).strip()
                else:
                    resolved_terms = "Payment due within 14 days of invoice date."

                inv_request = ZohoDraftInvoiceRequest(
                    customer_id=contact_id,
                    date=inv_date,
                    due_date=resolved_due_date,
                    line_items=zoho_line_items,
                    notes=f"{tenant_display_name} Commercial Laundry Service Billing for {customer_name} ({target_month} {target_year}). (Source: In-App PostgreSQL Ledger)",
                    terms=resolved_terms,
                )

                if mode == "regenerate":
                    pipeline_tracker.add_log(
                        "info",
                        f"Regenerating draft invoice for Customer '{customer_name}'...",
                    )
                    if confirm_delete:
                        existing = await zoho.find_existing_draft_invoice(contact_id, target_month, target_year)
                        if existing:
                            existing_inv_id = str(existing.get("invoice_id", "")).strip()
                            inv_num = existing.get("invoice_number", existing_inv_id)
                            pipeline_tracker.add_log(
                                "warning",
                                f"Deleting existing draft invoice {inv_num} for Customer '{customer_name}'...",
                            )
                            await zoho.delete_draft_invoice(existing_inv_id)
                            pipeline_tracker.add_log(
                                "info",
                                f"Deleted draft invoice {inv_num} from Zoho Books.",
                            )
                    pipeline_tracker.add_log(
                        "info",
                        f"Creating fresh Zoho Books draft invoice for Customer '{customer_name}' ({len(zoho_line_items)} items)...",
                    )
                    response = await zoho.create_draft_invoice(inv_request)
                    if is_mock or not zoho.org_id:
                        key = f"{contact_id}_{target_month}_{target_year}".lower()
                        ZohoBooksService._global_mock_draft_invoices[key] = {
                            "invoice_id": response.invoice_id,
                            "invoice_number": response.invoice_number,
                            "customer_id": contact_id,
                            "customer_name": customer_name,
                            "total": response.total,
                            "status": "draft",
                            "notes": inv_request.notes or "",
                            "date": inv_request.date,
                            "due_date": inv_request.due_date,
                            "terms": inv_request.terms,
                            "line_items": [li.model_dump() for li in inv_request.line_items],
                        }
                else:
                    pipeline_tracker.add_log(
                        "info",
                        f"Drafting/Appending to Zoho Books Invoice for {customer_name} in {tenant_display_name}'s organization (Invoice Date: {inv_date}, {len(zoho_line_items)} items)...",
                    )
                    response = await zoho.create_or_append_draft_invoice(
                        inv_request,
                        target_month,
                        target_year,
                        due_date=resolved_due_date,
                        terms=resolved_terms,
                    )

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

                step_done_percent = 50 + int((idx / max(total_customers, 1)) * 45)
                pipeline_tracker.update_step(
                    current_step=f"Completed draft invoice for Customer ({idx}/{total_customers}): {customer_name}",
                    percent=step_done_percent,
                    stats_update={"customers_done": idx},
                )
                pipeline_tracker.add_log(
                    "success",
                    f"🎉 Processed Draft Invoice {response.invoice_number} for customer {customer_name} in {tenant_display_name}'s Zoho Books (Total: GHS {response.total:.2f}). Marked INVOICED.",
                )
                inv_dump = response.model_dump()
                inv_dump["customer_name"] = customer_name
                inv_dump["total_ghs"] = response.total
                inv_dump["zoho_link"] = response.invoice_url or f"https://books.zoho.com/app#/invoices/{response.invoice_id}"
                inv_dump["date"] = inv_request.date
                inv_dump["due_date"] = inv_request.due_date
                inv_dump["terms"] = inv_request.terms
                created_invoices.append(inv_dump)

            return {
                "status": "COMPLETED",
                "mode": mode,
                "month": target_month,
                "year": target_year,
                "invoices_count": len(created_invoices),
                "total_billed_ghs": sum(inv.get("total_ghs", inv.get("total", 0.0)) for inv in created_invoices),
                "invoices_created": created_invoices,
            }

        invoice_result = await _run_step("generate-draft-invoices", generate_invoices)
        pipeline_tracker.complete_pipeline(invoice_result)
        return invoice_result

    except Exception as e:
        if e.__class__.__name__ in ("StepInterrupt", "InngestStepInterrupt"):
            raise
        err_msg = str(e)
        if hasattr(e, "response") and hasattr(e.response, "text"):
            try:
                err_data = e.response.json()
                msg = err_data.get("message")
                code = err_data.get("code")
                if msg:
                    err_msg = f"Zoho Books error [{code}]: {msg}" if code is not None else f"Zoho Books error: {msg}"
            except Exception:
                err_msg = e.response.text
        logger.error(f"Invoice generation failed: {err_msg}")
        pipeline_tracker.fail_pipeline(err_msg)
        raise RuntimeError(err_msg) from e


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
    mode = event_data.get("mode", "append")
    target_customer_name = event_data.get("target_customer_name")
    invoice_date = event_data.get("invoice_date")
    due_date = event_data.get("due_date")
    terms = event_data.get("terms")
    confirm_delete = bool(event_data.get("confirm_delete", False))

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
        mode=mode,
        target_customer_name=target_customer_name,
        invoice_date=invoice_date,
        due_date=due_date,
        terms=terms,
        confirm_delete=confirm_delete,
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

