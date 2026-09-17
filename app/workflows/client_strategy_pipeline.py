"""Inngest Multi-Tenant Client Strategy Execution Workflow."""

import inngest
from typing import Dict, Any, Optional, List
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
    trigger=[
        inngest.TriggerCron(cron="0 18 * * *"),  # Autonomous Daily Schedule @ 18:00 UTC
        inngest.TriggerEvent(event="s4/client.strategy.execute"),
    ],
    retries=3,
)
async def client_strategy_pipeline(ctx: inngest.Context, step: inngest.Step) -> Dict[str, Any]:
    """
    Durable multi-tenant workflow executing any client's accounting strategy across 4 lifecycle stages.
    Supports both manual single-client trigger (s4/client.strategy.execute) and autonomous daily scheduled cron.
    """
    event_data = ctx.event.data or {}
    now = datetime.now()
    target_month = event_data.get("month") or now.strftime("%B")
    target_year = int(event_data.get("year") or now.year)
    actor_email = event_data.get("actor_email") or ("cron_scheduler" if not ctx.event.data else "system")
    auto_post = bool(event_data.get("auto_post", False))
    force_reprocess = bool(event_data.get("force_reprocess", False))

    # Identify target clients:
    # 1. Manual trigger: client_id is passed in event payload
    # 2. Autonomous cron trigger: client_id omitted -> query all active/live clients from database
    requested_client_id = event_data.get("client_id")
    if requested_client_id:
        target_client_ids = [requested_client_id]
    else:
        target_client_ids = []
        try:
            from app.db.session import get_engine
            from sqlmodel import Session, select
            from app.models.db_models import ClientOrganization

            with Session(get_engine()) as session:
                clients = session.exec(select(ClientOrganization).where(ClientOrganization.status == "live")).all()
                if not clients:
                    clients = session.exec(select(ClientOrganization)).all()
                target_client_ids = [c.id for c in clients if c.id]
        except Exception as e:
            logger.error(f"Failed to query active clients for autonomous run: {e}")
            target_client_ids = ["anr_group"]

        if not target_client_ids:
            target_client_ids = ["anr_group"]

    results: Dict[str, Any] = {}

    for c_id in target_client_ids:
        logger.info(f"⚡ [Inngest Workflow] Running pipeline for client '{c_id}' ({target_month} {target_year})")
        pipeline_tracker.start_pipeline(f"Pipeline: {c_id}", target_month, target_year, total_stages=4)

        AuditService.log(
            client_id=c_id,
            action="AUTONOMOUS_RUN_DISPATCHED" if not requested_client_id else "WORKFLOW_DISPATCHED",
            actor_email=actor_email,
            details={"month": target_month, "year": target_year, "auto_post": auto_post, "is_autonomous": not bool(requested_client_id)},
        )

        # Step 1: Discover Sources
        async def _step_discover(cid=c_id):
            strategy = StrategyFactory.get(cid)
            pipeline_tracker.update_progress(percent=25, stage_index=1, current_step=f"Discovering sources for {cid}...")
            sources = await strategy.discover_sources(target_month, target_year)
            return {
                "sources_count": len(sources),
                "sources": [s.model_dump(exclude={"file_bytes"}) for s in sources],
            }

        discover_res = await step.run(f"1-discover-sources-{c_id}", _step_discover)
        sources_count = discover_res.get("sources_count", 0)

        # If zero new files found for this month, finish gracefully
        if sources_count == 0:
            logger.info(f"Zero new source files for client '{c_id}' in {target_month} {target_year}. Skipping OCR.")
            pipeline_tracker.update_progress(percent=100, stage_index=4, current_step=f"No new files found for {c_id}.")
            client_summary = {
                "client_id": c_id,
                "month": target_month,
                "year": target_year,
                "status": "COMPLETED_NO_FILES",
                "sources_discovered": 0,
                "items_extracted": 0,
                "total_amount": 0.0,
                "message": f"No new unparsed files found in Google Drive for {target_month} {target_year}.",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
            results[c_id] = client_summary
            AuditService.log(
                client_id=c_id,
                action="AUTONOMOUS_RUN_NO_FILES",
                actor_email=actor_email,
                details=client_summary,
            )
            continue

        # Step 2: Extract & Validate
        async def _step_extract(cid=c_id):
            strategy = StrategyFactory.get(cid)
            pipeline_tracker.update_progress(percent=50, stage_index=2, current_step=f"Extracting & validating line items for {cid}...")
            sources = await strategy.discover_sources(target_month, target_year)
            items = await strategy.extract_and_validate(sources, force_reprocess=force_reprocess)
            return {
                "items_count": len(items),
                "total_value": sum(i.total_amount for i in items),
                "items": [i.model_dump() for i in items],
            }

        extract_res = await step.run(f"2-extract-and-validate-{c_id}", _step_extract)

        # Step 3: Sync Review Workspace (PostgreSQL Staged Transactions)
        async def _step_sync(cid=c_id):
            strategy = StrategyFactory.get(cid)
            pipeline_tracker.update_progress(percent=75, stage_index=3, current_step=f"Syncing review ledger for {cid}...")
            sources = await strategy.discover_sources(target_month, target_year)
            items = await strategy.extract_and_validate(sources, force_reprocess=force_reprocess)
            return await strategy.sync_review_workspace(target_month, target_year, items)

        sync_res = await step.run(f"3-sync-review-workspace-{c_id}", _step_sync)

        # Step 4: Post to Accounting (optional)
        post_res = {"status": "SKIPPED", "invoices_created": 0}
        if auto_post:
            async def _step_post(cid=c_id):
                strategy = StrategyFactory.get(cid)
                pipeline_tracker.update_progress(percent=95, stage_index=4, current_step=f"Posting to Zoho Books for {cid}...")
                return await strategy.post_to_accounting(target_month, target_year)

            post_res = await step.run(f"4-post-to-accounting-{c_id}", _step_post)

        pipeline_tracker.update_progress(percent=100, stage_index=4, current_step=f"Completed {c_id} pipeline.")

        client_summary = {
            "client_id": c_id,
            "month": target_month,
            "year": target_year,
            "status": "SUCCESS",
            "sources_discovered": discover_res.get("sources_count", 0),
            "items_extracted": extract_res.get("items_count", 0),
            "total_amount": extract_res.get("total_value", 0.0),
            "sync_details": sync_res,
            "accounting_post": post_res,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }

        AuditService.log(
            client_id=c_id,
            action="WORKFLOW_COMPLETED",
            actor_email=actor_email,
            details=client_summary,
        )
        results[c_id] = client_summary

    return results.get(requested_client_id, results) if requested_client_id else results

