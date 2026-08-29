"""Pipeline orchestration and execution status endpoints."""

from typing import Dict, Any, Optional
from datetime import datetime
from fastapi import APIRouter, BackgroundTasks
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
