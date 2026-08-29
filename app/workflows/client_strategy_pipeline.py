"""Inngest Multi-Tenant Client Strategy Execution Workflow."""

import inngest
from typing import Dict, Any, Optional
from datetime import datetime, timezone

from app.inngest_client import inngest_client
from app.strategies.factory import StrategyFactory
from app.services.audit_service import AuditService
from app.utils.progress_tracker import pipeline_tracker
from app.utils.logging import get_logger

logger = get_logger("client_strategy_pipeline")


@inngest_client.create_function(
    fn_id="s4-client-strategy-pipeline",
    name="S4 Multi-Client Accounting Automation Pipeline",
    trigger=inngest.TriggerEvent(event="s4/client.strategy.execute"),
    retries=3,
)
async def client_strategy_pipeline(ctx: inngest.Context, step: inngest.Step) -> Dict[str, Any]:
    """
    Durable multi-tenant workflow executing any client's accounting strategy across 4 lifecycle stages.
    """
    event_data = ctx.event.data or {}
    client_id = event_data.get("client_id", "anr_group")
    month = event_data.get("month", "August")
    year = int(event_data.get("year", 2026))
    auto_post = bool(event_data.get("auto_post", False))
    actor_email = event_data.get("actor_email", "system")

    logger.info(f"⚡ [Inngest Workflow] Starting automation pipeline for client '{client_id}' ({month} {year})")
    pipeline_tracker.start_pipeline(f"Pipeline: {client_id}", month, year, total_stages=4)

    AuditService.log(
        client_id=client_id,
        action="WORKFLOW_DISPATCHED",
        actor_email=actor_email,
        details={"month": month, "year": year, "auto_post": auto_post},
    )

    # Step 1: Discover Sources
    async def _step_discover():
        strategy = StrategyFactory.get(client_id)
        pipeline_tracker.update_progress(percent=25, stage_index=1, current_step=f"Discovering sources for {client_id}...")
        sources = await strategy.discover_sources(month, year)
        return {
            "sources_count": len(sources),
            "sources": [s.model_dump(exclude={"file_bytes"}) for s in sources],
        }

    discover_res = await step.run("1-discover-sources", _step_discover)

    # Step 2: Extract & Validate
    async def _step_extract():
        strategy = StrategyFactory.get(client_id)
        pipeline_tracker.update_progress(percent=50, stage_index=2, current_step=f"Extracting & validating line items...")
        sources = await strategy.discover_sources(month, year)
        items = await strategy.extract_and_validate(sources)
        return {
            "items_count": len(items),
            "total_value": sum(i.total_amount for i in items),
            "items": [i.model_dump() for i in items],
        }

    extract_res = await step.run("2-extract-and-validate", _step_extract)

    # Step 3: Sync Review Workspace
    async def _step_sync():
        strategy = StrategyFactory.get(client_id)
        pipeline_tracker.update_progress(percent=75, stage_index=3, current_step=f"Syncing review ledger...")
        sources = await strategy.discover_sources(month, year)
        items = await strategy.extract_and_validate(sources)
        return await strategy.sync_review_workspace(month, year, items)

    sync_res = await step.run("3-sync-review-workspace", _step_sync)

    # Step 4: Post to Accounting (optional)
    post_res = {"status": "SKIPPED", "invoices_created": 0}
    if auto_post:
        async def _step_post():
            strategy = StrategyFactory.get(client_id)
            pipeline_tracker.update_progress(percent=95, stage_index=4, current_step=f"Posting to Zoho Books...")
            return await strategy.post_to_accounting(month, year)

        post_res = await step.run("4-post-to-accounting", _step_post)

    pipeline_tracker.update_progress(percent=100, stage_index=4, current_step=f"Completed {client_id} pipeline.")

    summary = {
        "client_id": client_id,
        "month": month,
        "year": year,
        "status": "SUCCESS",
        "sources_discovered": discover_res.get("sources_count", 0),
        "items_extracted": extract_res.get("items_count", 0),
        "total_amount": extract_res.get("total_value", 0.0),
        "sync_details": sync_res,
        "accounting_post": post_res,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }

    AuditService.log(
        client_id=client_id,
        action="WORKFLOW_COMPLETED",
        actor_email=actor_email,
        details=summary,
    )

    return summary
