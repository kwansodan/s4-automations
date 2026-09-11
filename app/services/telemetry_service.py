"""Telemetry and Usage Service for 3rd-Party Paid APIs (Gemini, Zoho, Mailjet, Drive, Social)."""

import asyncio
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List
from sqlmodel import Session, select, func, desc

from app.db.session import get_engine
from app.models.db_models import ApiKeyUsageLog, get_utc_now
from app.utils.logging import get_logger

logger = get_logger("telemetry_service")

# Approximate USD to GHS exchange rate for cost reporting in West Africa
USD_TO_GHS_RATE = 13.50

# In-memory ring buffer of recent logs for zero-latency dashboard display
_RECENT_CALLS: List[Dict[str, Any]] = []
_CALLS_LOCK = threading.Lock()
MAX_IN_MEMORY_LOGS = 200


def calculate_service_cost(
    service_name: str,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    units: int = 1,
) -> tuple[float, float]:
    """
    Calculates estimated cost in USD and GHS for third-party operations.
    Returns: (cost_usd, cost_ghs)
    """
    service = (service_name or "").lower()
    cost_usd = 0.0

    if "gemini" in service:
        # Gemini 3.6 Flash / 2.5 Flash pricing:
        # Input: $0.075 / 1,000,000 tokens
        # Output: $0.30 / 1,000,000 tokens
        input_cost = (prompt_tokens / 1_000_000) * 0.075
        output_cost = (completion_tokens / 1_000_000) * 0.30
        cost_usd = input_cost + output_cost
        # Minimum baseline per image/doc if tokens were unmeasured
        if cost_usd == 0.0 and units > 0:
            cost_usd = units * 0.0003  # ~1,500 tokens

    elif "zoho" in service:
        # Zoho Books API: Free included quota with overage tier ~$0.0005/call
        cost_usd = units * 0.0005

    elif "mailjet" in service:
        # Mailjet email delivery: ~$0.001 per dispatched email
        cost_usd = units * 0.001

    elif "twitter" in service or "x" in service:
        # Twitter API basic tier: ~$0.033 per post
        cost_usd = units * 0.033

    elif "drive" in service or "sheets" in service:
        # Google Workspace API: generous free quota, negligible unit cost
        cost_usd = units * 0.00005

    cost_ghs = cost_usd * USD_TO_GHS_RATE
    return round(cost_usd, 6), round(cost_ghs, 4)


def record_api_call_sync(
    service_name: str,
    operation: str = "ocr_extraction",
    organization_id: Optional[str] = "s4_advisory",
    client_id: Optional[str] = None,
    units_consumed: int = 1,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    total_tokens: int = 0,
    latency_ms: float = 0.0,
    is_success: bool = True,
    status_code: Optional[int] = 200,
    error_message: Optional[str] = None,
):
    """
    Non-blocking, fail-safe synchronous recorder for API telemetry.
    Saves to DB and in-memory ring buffer.
    """
    try:
        cost_usd, cost_ghs = calculate_service_cost(
            service_name, prompt_tokens, completion_tokens, units_consumed
        )

        log_data = {
            "service_name": service_name,
            "operation": operation,
            "organization_id": organization_id or "s4_advisory",
            "client_id": client_id,
            "units_consumed": units_consumed,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens or (prompt_tokens + completion_tokens),
            "estimated_cost_usd": cost_usd,
            "estimated_cost_ghs": cost_ghs,
            "latency_ms": round(latency_ms, 2),
            "is_success": is_success,
            "status_code": status_code,
            "error_message": error_message,
            "created_at": get_utc_now(),
        }

        # 1. Update in-memory ring buffer
        with _CALLS_LOCK:
            _RECENT_CALLS.insert(0, log_data)
            if len(_RECENT_CALLS) > MAX_IN_MEMORY_LOGS:
                _RECENT_CALLS.pop()

        # 2. Persist to database in background thread / session
        engine = get_engine()
        with Session(engine) as db:
            record = ApiKeyUsageLog(**log_data)
            db.add(record)
            db.commit()

    except Exception as e:
        logger.debug(f"Telemetry logging notice (non-fatal): {e}")


async def record_api_call(
    service_name: str,
    operation: str = "ocr_extraction",
    organization_id: Optional[str] = "s4_advisory",
    client_id: Optional[str] = None,
    units_consumed: int = 1,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    total_tokens: int = 0,
    latency_ms: float = 0.0,
    is_success: bool = True,
    status_code: Optional[int] = 200,
    error_message: Optional[str] = None,
):
    """Asynchronous wrapper for record_api_call_sync."""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        record_api_call_sync,
        service_name,
        operation,
        organization_id,
        client_id,
        units_consumed,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        latency_ms,
        is_success,
        status_code,
        error_message,
    )


def get_cost_summary(db: Session, days: int = 30) -> Dict[str, Any]:
    """
    Aggregates consumption and costs across all paid 3rd-party services.
    """
    cutoff = get_utc_now() - timedelta(days=days)

    # All logs in period
    logs = db.exec(
        select(ApiKeyUsageLog).where(ApiKeyUsageLog.created_at >= cutoff)
    ).all()

    total_cost_usd = sum(l.estimated_cost_usd for l in logs)
    total_cost_ghs = sum(l.estimated_cost_ghs for l in logs)
    total_calls = len(logs)
    failed_calls = sum(1 for l in logs if not l.is_success)

    # Breakdown by service
    service_breakdown: Dict[str, Dict[str, Any]] = {
        "gemini": {
            "name": "Google Gemini AI Vision",
            "calls": 0,
            "tokens": 0,
            "cost_usd": 0.0,
            "cost_ghs": 0.0,
            "errors": 0,
            "avg_latency_ms": 0.0,
            "unit_label": "tokens",
        },
        "zoho": {
            "name": "Zoho Books API",
            "calls": 0,
            "tokens": 0,
            "cost_usd": 0.0,
            "cost_ghs": 0.0,
            "errors": 0,
            "avg_latency_ms": 0.0,
            "unit_label": "requests",
        },
        "mailjet": {
            "name": "Mailjet Email Delivery",
            "calls": 0,
            "tokens": 0,
            "cost_usd": 0.0,
            "cost_ghs": 0.0,
            "errors": 0,
            "avg_latency_ms": 0.0,
            "unit_label": "emails",
        },
        "google_drive": {
            "name": "Google Workspace (Drive & Sheets)",
            "calls": 0,
            "tokens": 0,
            "cost_usd": 0.0,
            "cost_ghs": 0.0,
            "errors": 0,
            "avg_latency_ms": 0.0,
            "unit_label": "file operations",
        },
        "twitter": {
            "name": "Social Broadcaster (X / LinkedIn)",
            "calls": 0,
            "tokens": 0,
            "cost_usd": 0.0,
            "cost_ghs": 0.0,
            "errors": 0,
            "avg_latency_ms": 0.0,
            "unit_label": "posts",
        },
    }

    latencies: Dict[str, List[float]] = {k: [] for k in service_breakdown}

    for l in logs:
        s_key = "gemini" if "gemini" in l.service_name else (
            "zoho" if "zoho" in l.service_name else (
                "mailjet" if "mailjet" in l.service_name else (
                    "google_drive" if ("drive" in l.service_name or "sheet" in l.service_name) else (
                        "twitter" if ("twitter" in l.service_name or "linkedin" in l.service_name) else "other"
                    )
                )
            )
        )

        if s_key in service_breakdown:
            service_breakdown[s_key]["calls"] += 1
            service_breakdown[s_key]["tokens"] += l.total_tokens
            service_breakdown[s_key]["cost_usd"] += l.estimated_cost_usd
            service_breakdown[s_key]["cost_ghs"] += l.estimated_cost_ghs
            if not l.is_success:
                service_breakdown[s_key]["errors"] += 1
            if l.latency_ms > 0:
                latencies[s_key].append(l.latency_ms)

    for k, v in service_breakdown.items():
        v["cost_usd"] = round(v["cost_usd"], 4)
        v["cost_ghs"] = round(v["cost_ghs"], 2)
        if latencies[k]:
            v["avg_latency_ms"] = round(sum(latencies[k]) / len(latencies[k]), 1)

    # Per-client infrastructure cost attribution
    client_costs: Dict[str, Dict[str, Any]] = {}
    for l in logs:
        c_id = l.client_id or l.organization_id or "general_platform"
        if c_id not in client_costs:
            client_costs[c_id] = {
                "client_id": c_id,
                "total_calls": 0,
                "gemini_tokens": 0,
                "cost_usd": 0.0,
                "cost_ghs": 0.0,
            }
        client_costs[c_id]["total_calls"] += 1
        client_costs[c_id]["gemini_tokens"] += l.total_tokens
        client_costs[c_id]["cost_usd"] += l.estimated_cost_usd
        client_costs[c_id]["cost_ghs"] += l.estimated_cost_ghs

    client_attribution_list = sorted(
        client_costs.values(), key=lambda x: x["cost_ghs"], reverse=True
    )
    for c in client_attribution_list:
        c["cost_usd"] = round(c["cost_usd"], 4)
        c["cost_ghs"] = round(c["cost_ghs"], 2)

    return {
        "period_days": days,
        "total_cost_usd": round(total_cost_usd, 4),
        "total_cost_ghs": round(total_cost_ghs, 2),
        "total_api_calls": total_calls,
        "failed_calls": failed_calls,
        "overall_success_rate": round(
            ((total_calls - failed_calls) / total_calls * 100) if total_calls > 0 else 100.0, 1
        ),
        "services": service_breakdown,
        "client_attribution": client_attribution_list[:10],
    }
