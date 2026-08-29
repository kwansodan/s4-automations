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

    if background_tasks:
        background_tasks.add_task(
            run_zoho_invoices_core,
            target_month,
            target_year,
            explicit_sheet_id,
            filter_client_name,
        )

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
