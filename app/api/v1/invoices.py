"""Invoicing orchestration endpoints."""

from typing import Dict, Any, Optional, List
from datetime import datetime
from fastapi import APIRouter, BackgroundTasks, Query, HTTPException
import inngest

from app.inngest_client import inngest_client
from app.models.inngest_events import InvoiceGenerateEvent
from app.models.schemas import ExistingInvoicesQueryResponse, ExistingInvoiceItem
from app.utils.logging import get_logger

logger = get_logger("api.invoices")
router = APIRouter(prefix="/invoices", tags=["Invoicing"])


_existing_invoices_cache: Dict[str, ExistingInvoicesQueryResponse] = {}
_existing_invoices_cache_time: Dict[str, float] = {}


@router.get("/existing", summary="Check Existing Draft Invoices for Month/Customer", response_model=ExistingInvoicesQueryResponse)
async def check_existing_draft_invoices(
    client_id: str = Query(..., description="Client organization ID or slug"),
    month: str = Query(..., description="Billing month name, e.g. 'August'"),
    year: int = Query(..., description="Billing year, e.g. 2026"),
    customer_name: Optional[str] = Query(None, description="Optional Customer name to filter"),
) -> ExistingInvoicesQueryResponse:
    """
    Checks whether draft invoices have already been raised in Zoho Books or
    staged in the application ledger for the given billing month, client, and customer.
    """
    import time
    cache_key = f"{client_id}:{month}:{year}:{customer_name or 'all'}"
    now_ts = time.time()
    if cache_key in _existing_invoices_cache and (now_ts - _existing_invoices_cache_time.get(cache_key, 0.0) < 60):
        return _existing_invoices_cache[cache_key]

    from app.services.zoho_service import ZohoBooksService
    from app.api.v1.clients import get_client_id_aliases
    from app.models.db_models import StagedTransaction
    from app.workflows.zoho_invoice_generator import extract_slip_customer_name
    from sqlmodel import Session, select
    from app.db.session import get_engine
    from app.config import settings
    import httpx

    existing_invoices: List[ExistingInvoiceItem] = []
    seen_ids = set()

    # 1. Check in-memory mock storage (for test and mock environments)
    for key, inv in ZohoBooksService._global_mock_draft_invoices.items():
        inv_id = str(inv.get("invoice_id", ""))
        inv_num = str(inv.get("invoice_number", inv_id))
        inv_cust = str(inv.get("customer_name", ""))
        inv_notes = str(inv.get("notes", "")).lower()
        inv_date = str(inv.get("date", ""))

        target_str = f"{month} {year}".lower()
        try:
            m_num = datetime.strptime(month, "%B").month
        except Exception:
            m_num = 0
        m_prefix = f"{year:04d}-{m_num:02d}"

        # Match billing period
        period_match = target_str in inv_notes or (m_num > 0 and inv_date.startswith(m_prefix)) or f"_{month}_{year}".lower() in key
        if period_match:
            # If customer_name filter is provided, check match
            if customer_name:
                cust_filter = customer_name.strip().lower()
                if cust_filter not in inv_cust.lower() and cust_filter not in str(inv.get("customer_id", "")).lower():
                    continue
            if inv_id and inv_id not in seen_ids:
                seen_ids.add(inv_id)
                existing_invoices.append(
                    ExistingInvoiceItem(
                        invoice_id=inv_id,
                        invoice_number=inv_num,
                        customer_name=inv_cust or (customer_name or "Customer"),
                        total=float(inv.get("total", 0.0)),
                        status=str(inv.get("status", "draft")),
                        date=inv.get("date"),
                        due_date=inv.get("due_date"),
                    )
                )

    # 2. Check live Zoho Books if credentials configured
    try:
        zoho = ZohoBooksService.from_client_id(client_id)
        if zoho.org_id and not settings.MOCK_MODE and zoho.refresh_token:
            access_token = await zoho.get_access_token()
            headers = zoho._get_headers(access_token)
            url = f"{zoho.books_api_url}/invoices"
            params = {
                "organization_id": zoho.org_id,
                "status": "draft",
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                res = await client.get(url, headers=headers, params=params)
                if res.status_code == 200:
                    raw_invoices = res.json().get("invoices", [])
                    target_str = f"{month} {year}".lower()
                    try:
                        m_num = datetime.strptime(month, "%B").month
                    except Exception:
                        m_num = 0
                    m_prefix = f"{year:04d}-{m_num:02d}"

                    for inv in raw_invoices:
                        inv_id = str(inv.get("invoice_id", ""))
                        inv_num = str(inv.get("invoice_number", inv_id))
                        inv_cust = str(inv.get("customer_name", ""))
                        inv_notes = str(inv.get("notes", "")).lower()
                        inv_date = str(inv.get("date", ""))

                        period_match = target_str in inv_notes or (m_num > 0 and inv_date.startswith(m_prefix))
                        if period_match:
                            if customer_name:
                                cust_filter = customer_name.strip().lower()
                                if cust_filter not in inv_cust.lower():
                                    continue
                            if inv_id and inv_id not in seen_ids:
                                seen_ids.add(inv_id)
                                existing_invoices.append(
                                    ExistingInvoiceItem(
                                        invoice_id=inv_id,
                                        invoice_number=inv_num,
                                        customer_name=inv_cust,
                                        total=float(inv.get("total", 0.0)),
                                        status=str(inv.get("status", "draft")),
                                        date=inv.get("date"),
                                        due_date=inv.get("due_date"),
                                    )
                                )
    except Exception as err:
        logger.debug(f"Zoho Books existing invoices query note: {err}")

    # 3. Check PostgreSQL ledger staged_transactions with status == 'INVOICED'
    try:
        aliases = get_client_id_aliases(client_id)
        with Session(get_engine()) as session:
            query = select(StagedTransaction).where(
                StagedTransaction.client_id.in_(aliases),
                StagedTransaction.approved == True,
                StagedTransaction.status == "INVOICED",
            )
            invoiced_staged = session.exec(query).all()
            for st in invoiced_staged:
                match_month = True
                if st.transaction_date:
                    try:
                        parsed_date = datetime.fromisoformat(st.transaction_date.replace("Z", "+00:00"))
                        if parsed_date.strftime("%B").lower() != month.lower():
                            match_month = False
                        if year and parsed_date.year != year:
                            match_month = False
                    except Exception:
                        pass
                if match_month:
                    cust_name = extract_slip_customer_name(st.source_file_name, st.metadata_json)
                    if customer_name and cust_name.strip().lower() != customer_name.strip().lower():
                        continue
                    ref_id = st.accounting_ref_id or f"inv_staged_{st.id}"
                    if ref_id not in seen_ids:
                        seen_ids.add(ref_id)
                        existing_invoices.append(
                            ExistingInvoiceItem(
                                invoice_id=str(ref_id),
                                invoice_number=str(ref_id),
                                customer_name=cust_name,
                                total=float(st.total_amount or 0.0),
                                status="draft",
                                date=st.transaction_date,
                            )
                        )
    except Exception as db_err:
        logger.debug(f"PostgreSQL staged existing invoices query note: {db_err}")

    response_obj = ExistingInvoicesQueryResponse(
        has_existing=len(existing_invoices) > 0,
        existing_invoices=existing_invoices,
        count=len(existing_invoices),
        client_id=client_id,
        month=month,
        year=year,
    )
    _existing_invoices_cache[cache_key] = response_obj
    _existing_invoices_cache_time[cache_key] = now_ts
    return response_obj


@router.post("", summary="Generate Zoho Books Draft Invoices (Root)")
@router.post("/trigger", summary="Generate Zoho Books Draft Invoices (Trigger)")
@router.post("/generate", summary="Generate Zoho Books Draft Invoices")
async def trigger_invoice_generation(
    payload: Optional[InvoiceGenerateEvent] = None,
    background_tasks: BackgroundTasks = None,
) -> Dict[str, Any]:
    """
    Triggers Zoho Draft Invoice creation for all approved rows in the review sheet.
    """
    from app.workflows.zoho_invoice_generator import run_zoho_invoices_core

    event_data = payload.model_dump() if payload else {}
    logger.info(f"Received trigger for invoice generation: {event_data}")
    
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

    if mode == "regenerate" and not confirm_delete:
        raise HTTPException(
            status_code=400,
            detail="Regeneration mode requires explicit confirmation (confirm_delete=True)",
        )

    from app.utils.progress_tracker import pipeline_tracker
    pipeline_tracker.start_pipeline("1-Click Zoho Invoicing", target_month, target_year, total_stages=3)
    pipeline_tracker.update_progress(
        percent=10,
        stage_index=1,
        current_step=f"Initializing draft invoice generation ({mode} mode) for {target_month} {target_year}...",
    )

    # 1. Execute immediately in a dedicated background daemon thread with its own event loop
    # This prevents heavy synchronous Google Sheets/Zoho API calls from blocking the main FastAPI loop
    import threading
    import asyncio

    def _run_invoices_worker():
        worker_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(worker_loop)
        try:
            worker_loop.run_until_complete(
                run_zoho_invoices_core(
                    target_month=target_month,
                    target_year=target_year,
                    explicit_sheet_id=explicit_sheet_id,
                    filter_client_name=filter_client_name,
                    include_line_item_description=include_line_item_description,
                    mode=mode,
                    target_customer_name=target_customer_name,
                    invoice_date=invoice_date,
                    due_date=due_date,
                    terms=terms,
                    confirm_delete=confirm_delete,
                )
            )
        except Exception as err:
            logger.error(f"Background invoice generation error: {err}")
        finally:
            worker_loop.close()

    inngest_sent = False
    try:
        await inngest_client.send(
            inngest.Event(
                name="anr/invoices.generate",
                data=event_data,
            )
        )
        inngest_sent = True
        logger.info(f"Dispatched invoice generation to Inngest for {target_month} {target_year}.")
    except Exception as e:
        logger.warning(f"Inngest invoice dispatch skipped or unavailable ({e}). Running via fallback background task.")

    if not inngest_sent:
        threading.Thread(
            target=_run_invoices_worker,
            daemon=True,
            name=f"invoices-{target_month}-{target_year}",
        ).start()

    return {
        "status": "PROCESSING",
        "message": f"Zoho invoice generation started for approved rows ({target_month} {target_year}).",
        "event": "anr/invoices.generate",
        "data": event_data,
    }
