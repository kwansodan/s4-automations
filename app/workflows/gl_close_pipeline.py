"""Inngest Workflow: Autonomous General Ledger (GL) Month-End Close & Reporting Pipeline."""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import inngest
from sqlmodel import Session, select

from app.db.session import get_engine
from app.inngest_client import inngest_client
from app.models.db_models import ClientOrganization, MonthEndCloseChecklist
from app.services.audit_service import AuditService
from app.services.gl_closing_service import GLClosingService
from app.utils.logging import get_logger
from app.utils.progress_tracker import pipeline_tracker

logger = get_logger("gl_close_pipeline")


async def run_gl_close_pipeline_core(
    target_month: str,
    target_year: int,
    client_id: Optional[str] = None,
    auto_post: bool = False,
    step_runner=None,
) -> Dict[str, Any]:
    """
    Core executor for autonomous Month-End Close across 5 lifecycle stages:
    1. Checklist Formulation / On-Launch Study
    2. Inter-Agent Subledger Coordination (AR, AP, Bank)
    3. Pre-Flight Gap & Anomaly Discovery
    4. Runbook Procedure Execution (Depreciation, Prepayments, Accruals, FX, Tax)
    5. Post-Posting Equilibrium Verification & Chained Financial Reporting
    """
    async def _run_step(step_name: str, fn):
        if step_runner:
            return await step_runner(step_name, fn)
        return await fn()

    pipeline_tracker.start_pipeline(
        task_name="GL Month-End Close & Reporting",
        month=target_month,
        year=target_year,
        total_stages=5,
        client_id=client_id,
        agent_id="gl_accountant",
        agent_name="Kwame",
        agent_role="General Ledger & Closing Accountant",
        section="GL",
        collaborating_agents=["Ama (Reporting)", "Kofi (Bank Recon)", "Akosua (AR/Billing)"],
    )

    with Session(get_engine()) as session:
        if client_id:
            clients = session.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).all()
        else:
            clients = session.exec(select(ClientOrganization).where(ClientOrganization.status.in_(["live", "active"]))).all()
            if not clients:
                clients = session.exec(select(ClientOrganization)).all()

        target_clients = list(clients)

    if not target_clients:
        pipeline_tracker.fail_pipeline("No active client organizations found for Month-End Close.")
        return {"status": "NO_CLIENTS", "message": "No active clients found."}

    results: Dict[str, Any] = {}

    for client in target_clients:
        cid = client.id
        logger.info(f"Starting Autonomous Month-End Close for '{cid}' ({target_month} {target_year})")

        try:
            # Stage 1: Checklist Initialization / Retrieval
            pipeline_tracker.update_progress(
                percent=20,
                stage_index=1,
                current_step=f"Formulating entity-tailored close checklist for {client.name}...",
            )

            async def _step_checklist(c=client):
                with Session(get_engine()) as db_session:
                    db_client = db_session.exec(select(ClientOrganization).where(ClientOrganization.id == c.id)).first()
                    cl = await GLClosingService.get_or_create_period_checklist(db_session, db_client, target_month, target_year)
                    return {
                        "checklist_id": cl.checklist_id,
                        "total_steps": len(cl.steps or []),
                        "status": cl.status,
                    }

            cl_res = await _run_step(f"1-checklist-setup-{cid}", _step_checklist)
            checklist_id = cl_res["checklist_id"]

            # Stage 2: Inter-Agent Subledger Coordination
            pipeline_tracker.update_progress(
                percent=40,
                stage_index=2,
                current_step=f"Cross-checking AR, AP, and Bank subledgers against control accounts...",
            )

            async def _step_subledgers(c=client):
                with Session(get_engine()) as db_session:
                    db_client = db_session.exec(select(ClientOrganization).where(ClientOrganization.id == c.id)).first()
                    return await GLClosingService.run_inter_agent_subledger_tie_out(
                        db_session, db_client, target_month, target_year
                    )

            tie_out_res = await _run_step(f"2-subledger-tie-outs-{cid}", _step_subledgers)

            # Stage 3: Pre-Flight Gap & Anomaly Discovery
            pipeline_tracker.update_progress(
                percent=60,
                stage_index=3,
                current_step=f"Auditing 100% of GL accounts for new unmapped balances and contra-anomalies...",
            )

            async def _step_preflight(c=client):
                with Session(get_engine()) as db_session:
                    db_client = db_session.exec(select(ClientOrganization).where(ClientOrganization.id == c.id)).first()
                    return await GLClosingService.pre_flight_close_review(
                        db_session, db_client, target_month, target_year
                    )

            preflight_res = await _run_step(f"3-preflight-scan-{cid}", _step_preflight)

            # Stage 4: Runbook Procedure Execution
            pipeline_tracker.update_progress(
                percent=80,
                stage_index=4,
                current_step=f"Executing tailored Month-End Close procedures and attaching calculation schedules...",
            )

            async def _step_runbook(c=client, cl_id=checklist_id):
                with Session(get_engine()) as db_session:
                    db_client = db_session.exec(select(ClientOrganization).where(ClientOrganization.id == c.id)).first()
                    return await GLClosingService.execute_close_runbook(
                        db_session, db_client, cl_id, auto_post=auto_post
                    )

            runbook_res = await _run_step(f"4-execute-runbook-{cid}", _step_runbook)

            # Stage 5: Post-Posting Verification Loop & Reporting Chaining
            pipeline_tracker.update_progress(
                percent=100,
                stage_index=5,
                current_step=f"Verifying post-posting equilibrium and sealing completion certificate...",
            )

            async def _step_verify(c=client, cl_id=checklist_id):
                with Session(get_engine()) as db_session:
                    db_client = db_session.exec(select(ClientOrganization).where(ClientOrganization.id == c.id)).first()
                    return await GLClosingService.verify_post_posting_equilibrium(
                        db_session, db_client, cl_id
                    )

            verify_res = await _run_step(f"5-post-close-verify-{cid}", _step_verify)

            summary = {
                "client_id": cid,
                "checklist_id": checklist_id,
                "period": f"{target_month} {target_year}",
                "status": runbook_res.get("status"),
                "completed_steps": runbook_res.get("completed_steps"),
                "total_steps": runbook_res.get("total_steps"),
                "exceptions_count": runbook_res.get("exceptions_count"),
                "subledger_tie_outs": tie_out_res,
                "pre_flight_discovery": preflight_res,
                "post_close_verification": verify_res,
                "financial_statement_pack": verify_res.get("financial_statement_pack"),
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }

            AuditService.log(
                client_id=cid,
                action="AUTONOMOUS_GL_CLOSE_COMPLETED",
                actor_email="system",
                details={
                    "period_month": target_month,
                    "period_year": target_year,
                    "completed_steps": runbook_res.get("completed_steps"),
                    "total_steps": runbook_res.get("total_steps"),
                    "verification_status": verify_res.get("status"),
                    "certificate_id": verify_res.get("certificate_id"),
                },
                source_type="gl_closing_pipeline",
                source_identifier=checklist_id,
            )

            results[cid] = summary
            pipeline_tracker.add_log("success", f"Closed and verified books for {client.name} with sealed completion certificate.")

        except Exception as e:
            err_msg = f"GL Close Pipeline error for client '{cid}': {e}"
            logger.error(err_msg, exc_info=True)
            pipeline_tracker.fail_pipeline(err_msg)
            results[cid] = {"status": "FAILED", "error": str(e)}

    pipeline_tracker.complete_pipeline({
        "status": "COMPLETED",
        "processed_clients": len(target_clients),
        "results": results,
    })

    return results


@inngest_client.create_function(
    fn_id="s4-gl-month-end-close-pipeline",
    name="S4 Autonomous GL Month-End Close & Financial Reporting Pipeline",
    trigger=[
        inngest.TriggerCron(cron="0 21 28-31 * *"),  # Month-end closing window @ 21:00 UTC
        inngest.TriggerEvent(event="s4/gl.close.execute"),
    ],
    retries=2,
)
async def inngest_gl_close_fn(ctx: inngest.Context, step: Optional[inngest.Step] = None) -> Dict[str, Any]:
    """
    Durable Inngest workflow executing autonomous Month-End Close and Financial Statement Pack synthesis.
    """
    step = getattr(ctx, "step", None) or step
    event_data = getattr(ctx.event, "data", {}) or {}
    now = datetime.now()
    target_month = event_data.get("month") or now.strftime("%B")
    target_year = int(event_data.get("year") or now.year)
    client_id = event_data.get("client_id")
    auto_post = bool(event_data.get("auto_post", False))

    async def _step_runner(step_name: str, fn):
        if step:
            return await step.run(step_name, fn)
        return await fn()

    return await run_gl_close_pipeline_core(
        target_month=target_month,
        target_year=target_year,
        client_id=client_id,
        auto_post=auto_post,
        step_runner=_step_runner if step else None,
    )
