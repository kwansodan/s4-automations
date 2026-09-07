"""Invoicing orchestration endpoints."""

from typing import Dict, Any, Optional
from datetime import datetime
from fastapi import APIRouter, BackgroundTasks
import inngest

from app.inngest_client import inngest_client
from app.models.inngest_events import InvoiceGenerateEvent
from app.utils.logging import get_logger

logger = get_logger("api.invoices")
router = APIRouter(prefix="/invoices", tags=["Invoicing"])


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
    filter_client_name = event_data.get("client_name")

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
                )
            )
        except Exception as err:
            logger.error(f"Background invoice generation error: {err}")
        finally:
            worker_loop.close()

    threading.Thread(
        target=_run_invoices_worker,
        daemon=True,
        name=f"invoices-{target_month}-{target_year}",
    ).start()


    try:
        await inngest_client.send(
            inngest.Event(
                name="anr/invoices.generate",
                data=event_data,
            )
        )
    except Exception as e:
        logger.warning(f"Inngest invoice dispatch skipped or unavailable ({e}). Running via background task.")

    return {
        "status": "PROCESSING",
        "message": f"Zoho invoice generation started for approved rows ({target_month} {target_year}).",
        "event": "anr/invoices.generate",
        "data": event_data,
    }
