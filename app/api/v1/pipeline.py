"""Pipeline orchestration and execution status endpoints."""

from typing import Dict, Any, Optional
from datetime import datetime
from fastapi import APIRouter, BackgroundTasks, Request
import inngest

from app.inngest_client import inngest_client
from app.models.inngest_events import PipelineTriggerEvent
from app.utils.logging import get_logger
from app.utils.progress_tracker import pipeline_tracker

logger = get_logger("api.pipeline")
router = APIRouter(prefix="/pipeline", tags=["Pipeline"])


@router.post("/trigger", summary="Trigger Daily OCR Ingestion Pipeline")
async def trigger_pipeline(
    payload: Optional[PipelineTriggerEvent] = None,
    background_tasks: BackgroundTasks = None,
) -> Dict[str, Any]:
    """
    Manually triggers the daily billing & OCR ingestion pipeline via Inngest event dispatch
    and immediate background task execution.
    """
    from app.workflows.daily_billing_pipeline import run_daily_pipeline_core

    event_data = payload.model_dump() if payload else {}
    logger.info(f"Received manual trigger for daily billing pipeline: {event_data}")
    
    now = datetime.now()
    target_month = event_data.get("month") or now.strftime("%B")
    target_year = int(event_data.get("year") or now.year)
    filter_clients = event_data.get("client_slugs")

    # 1. Execute immediately in background task
    if background_tasks:
        background_tasks.add_task(
            run_daily_pipeline_core,
            target_month,
            target_year,
            filter_clients,
        )

    # 2. Also dispatch to Inngest for durable orchestration
    try:
        await inngest_client.send(
            inngest.Event(
                name="anr/pipeline.trigger",
                data=event_data,
            )
        )
    except Exception as e:
        logger.warning(f"Inngest dispatch skipped or unavailable ({e}). Running via background task.")

    return {
        "status": "PROCESSING",
        "message": f"Pipeline execution started for {target_month} {target_year}.",
        "event": "anr/pipeline.trigger",
        "data": event_data,
    }


@router.get("/status", summary="Get Pipeline Real-time Progress")
async def get_pipeline_status() -> Dict[str, Any]:
    """
    Returns real-time execution status, stage progress, counters, and telemetry logs.
    """
    return pipeline_tracker.get_state()


@router.post("/simulate", summary="Interactive AI Pipeline Simulation Lab")
async def simulate_pipeline_extraction(request: Request) -> Dict[str, Any]:
    """
    Simulates AI extraction on a test sample (image, PDF, or text) with human-written
    transposition instructions, mapping raw information into the target accounting entity schema.
    """
    from app.services.ocr_service import GeminiOCRService
    from app.services.zoho_contract_validator import ZohoContractValidator
    from app.services.zoho_service import ZohoBooksService

    ocr = GeminiOCRService()
    zoho = ZohoBooksService()

    file_bytes = None
    file_name = "sample_document.png"
    mime_type = "image/png"
    sample_text = None
    entity_type = "ar_sales_invoice"
    client_id = None
    client_name = "General Client"
    accounting_software = "zoho_books"
    human_instructions = None

    # Handle Content Types (Multipart Form-Data or JSON)
    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" in content_type or "application/x-www-form-urlencoded" in content_type:
        form = await request.form()
        entity_type = form.get("entity_type") or entity_type
        sample_text = form.get("sample_text")
        client_id = form.get("client_id")
        client_name = form.get("client_name") or client_name
        accounting_software = form.get("accounting_software") or accounting_software
        human_instructions = form.get("human_instructions")

        file_obj = form.get("file")
        if file_obj and hasattr(file_obj, "read"):
            file_bytes = await file_obj.read()
            file_name = getattr(file_obj, "filename", "sample_document.png") or "sample_document.png"
            mime_type = getattr(file_obj, "content_type", "image/png") or "image/png"
    else:
        try:
            body = await request.json()
            entity_type = body.get("entity_type") or entity_type
            sample_text = body.get("sample_text")
            client_id = body.get("client_id")
            client_name = body.get("client_name") or client_name
            accounting_software = body.get("accounting_software") or accounting_software
            human_instructions = body.get("human_instructions")
        except Exception:
            pass

    # Fetch catalog for client if available
    catalog = []
    try:
        catalog = await zoho.fetch_item_catalog()
    except Exception as e:
        logger.warning(f"Could not load catalog for simulation: {e}")

    # Run AI Simulation & Transposition
    sim_res = await ocr.simulate_pipeline_transposition(
        file_bytes=file_bytes,
        file_name=file_name,
        mime_type=mime_type,
        sample_text=sample_text,
        entity_type=entity_type,
        client_name=client_name or "Client Organization",
        human_instructions=human_instructions,
        accounting_software=accounting_software or "zoho_books",
        item_catalog=catalog,
    )

    # Perform contract validation on transposed payload
    transposed = sim_res.get("transposed_payload", {})
    val_result = ZohoContractValidator.validate_entity(
        entity_type=entity_type,
        extracted_data=transposed,
        zoho_contacts=[],
        zoho_items=catalog,
    )

    val_errors = []
    if not val_result.is_valid and hasattr(val_result, "issues"):
        val_errors = [f"{iss.field_name}: {iss.message}" for iss in val_result.issues]

    return {
        "success": True,
        "entity_type": entity_type,
        "accounting_software": accounting_software or "zoho_books",
        "raw_datapoints": sim_res.get("raw_datapoints", []),
        "transposed_payload": transposed,
        "validation_status": "VALID" if val_result.is_valid else "VALIDATION_WARNINGS",
        "validation_errors": val_errors,
        "ai_reasoning": sim_res.get("ai_reasoning", ""),
        "confidence_score": sim_res.get("confidence_score", 0.95),
        "source_file_name": file_name,
    }

