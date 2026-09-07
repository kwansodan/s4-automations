"""System Diagnostics, Log Streaming & Error Reporting Endpoints for Frontend In-App Debugging."""

from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Query

from app.config import settings
from app.utils.logging import (
    get_logger,
    get_recent_server_logs,
    get_recent_server_errors,
    log_buffer,
)
from app.utils.progress_tracker import pipeline_tracker

logger = get_logger("api.system")
router = APIRouter(prefix="/system", tags=["System Diagnostics & Logs"])


@router.get("/logs", summary="Stream Recent Backend Server Logs")
async def get_server_logs(
    level: Optional[str] = Query(default=None, description="Filter by log level: ALL, INFO, WARNING, ERROR, CRITICAL"),
    limit: int = Query(default=100, ge=1, le=500, description="Max number of log lines to return"),
    search: Optional[str] = Query(default=None, description="Keyword search query"),
) -> Dict[str, Any]:
    """Returns recent server stdout/stderr logs from the in-memory ring buffer."""
    logs = get_recent_server_logs(level=level, limit=limit, search=search)
    return {
        "status": "success",
        "total_returned": len(logs),
        "capacity": log_buffer.capacity,
        "logs": logs,
    }


@router.get("/errors", summary="Get Recent Backend Server Exceptions")
async def get_server_errors(
    limit: int = Query(default=50, ge=1, le=100, description="Max error records to return"),
) -> Dict[str, Any]:
    """Returns recent exception records with full Python tracebacks."""
    errors = get_recent_server_errors(limit=limit)
    return {
        "status": "success",
        "total_returned": len(errors),
        "errors": errors,
    }


@router.delete("/logs", summary="Clear In-Memory Server Log Buffer")
async def clear_server_logs() -> Dict[str, Any]:
    """Flushes the in-memory log buffer."""
    log_buffer.clear()
    logger.info("In-memory log buffer cleared via frontend request.")
    return {"status": "cleared", "message": "Log buffer emptied successfully."}


@router.get("/debug-dump", summary="Consolidated System Debug Snapshot")
async def get_system_debug_dump() -> Dict[str, Any]:
    """
    Returns a unified diagnostic bundle containing system health, masked environment configs,
    active pipeline state, and recent errors for 1-click debugging.
    """
    from app.db.session import get_engine
    from sqlmodel import Session, select, func
    from app.models.db_models import ClientOrganization, StagedTransaction, BankTransaction

    db_status = "UNKNOWN"
    clients_count = 0
    staged_tx_count = 0
    bank_tx_count = 0

    try:
        engine = get_engine()
        with Session(engine) as session:
            clients_count = session.exec(select(func.count(ClientOrganization.id))).one()
            staged_tx_count = session.exec(select(func.count(StagedTransaction.id))).one()
            bank_tx_count = session.exec(select(func.count(BankTransaction.id))).one()
            db_status = f"CONNECTED ({engine.name})"
    except Exception as db_err:
        db_status = f"FAILED ({db_err})"

    pipeline_state = pipeline_tracker.get_state()
    recent_errors = get_recent_server_errors(limit=10)

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": "anr-commercial-laundry-billing",
        "environment": settings.ENVIRONMENT,
        "mock_mode": settings.MOCK_MODE,
        "gemini_model": settings.GEMINI_MODEL,
        "database": {
            "status": db_status,
            "clients_count": clients_count,
            "staged_transactions_count": staged_tx_count,
            "bank_transactions_count": bank_tx_count,
        },
        "pipeline": {
            "is_running": pipeline_state.get("is_running", False),
            "status": pipeline_state.get("status", "IDLE"),
            "current_step": pipeline_state.get("current_step", ""),
            "error_message": pipeline_state.get("error_message"),
            "percent": pipeline_state.get("percent", 0),
        },
        "config_summary": settings.get_masked_dict(),
        "recent_errors": recent_errors,
    }
