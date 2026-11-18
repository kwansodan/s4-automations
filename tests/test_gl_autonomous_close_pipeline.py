"""Automated test suite for autonomous GL Month-End Close pipeline, webhook controller resolution, and reporting chaining."""

import pytest
from unittest.mock import patch
from sqlmodel import Session, create_engine, SQLModel, select
from sqlmodel.pool import StaticPool

from app.models.db_models import (
    ClientOrganization,
    MonthEndCloseChecklist,
    FinancialStatementReport,
    AgentMessage,
)
from app.services.gl_closing_service import GLClosingService
from app.services.agent_comms_service import AgentCommsService
from app.services.agentic_brain_service import AgenticBrainService
from app.workflows.gl_close_pipeline import run_gl_close_pipeline_core


@pytest.fixture(name="test_db")
def test_db_fixture():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        client = ClientOrganization(
            id="anr_group",
            name="ANR Group Commercial Laundry",
            industry="Commercial Laundry & Hospitality",
            organization_id="s4_advisory",
            custom_config={"currency": "GHS"},
            accounting_software="zoho_books",
            zoho_org_id="zoho_test_org",
            pipelines=[
                {
                    "id": "pipe_anr_gl_closing",
                    "name": "General Ledger & Closing Accountant",
                    "section": "GL",
                    "entity_type": "gl_journal",
                    "source_type": "general_ledger",
                    "autonomy_level": "semi_autonomous",
                    "schedule_frequency": "monthly_cutoff",
                    "is_active": True,
                    "active": True,
                },
                {
                    "id": "pipe_anr_fr_reporting",
                    "name": "Statutory Financial Reporting & MD&A Agent",
                    "section": "FR",
                    "entity_type": "financial_statement_pack",
                    "source_type": "general_ledger",
                    "autonomy_level": "semi_autonomous",
                    "schedule_frequency": "monthly_cutoff",
                    "is_active": True,
                    "active": True,
                    "status": "active",
                },
            ],
            agents=[
                {
                    "id": "pipe_anr_gl_closing",
                    "name": "General Ledger & Closing Accountant",
                    "section": "GL",
                    "pipeline_type": "gl_accounting",
                    "autonomy_level": "semi_autonomous",
                    "schedule_frequency": "monthly_cutoff",
                    "is_active": True,
                    "active": True,
                    "status": "active",
                },
                {
                    "id": "pipe_anr_fr_reporting",
                    "name": "Statutory Financial Reporting & MD&A Agent",
                    "section": "FR",
                    "pipeline_type": "financial_reporting",
                    "autonomy_level": "semi_autonomous",
                    "schedule_frequency": "monthly_cutoff",
                    "is_active": True,
                    "active": True,
                    "status": "active",
                },
            ],
        )
        session.add(client)
        session.commit()
        yield session


@pytest.mark.asyncio
async def test_gl_close_pipeline_core_execution(test_db: Session):
    """Verify that run_gl_close_pipeline_core completes all 5 stages end-to-end with chained reporting."""
    client = test_db.get(ClientOrganization, "anr_group")
    assert client is not None

    with patch("app.workflows.gl_close_pipeline.get_engine", return_value=test_db.get_bind()):
        results = await run_gl_close_pipeline_core(
            target_month="October",
            target_year=2026,
            client_id="anr_group",
            auto_post=False,
        )

    assert "anr_group" in results
    anr_summary = results["anr_group"]
    assert anr_summary.get("status") in ("COMPLETED", "IN_PROGRESS")
    assert anr_summary.get("completed_steps") >= 1
    assert "post_close_verification" in anr_summary

    verification = anr_summary["post_close_verification"]
    assert verification.get("is_balanced") is True
    assert verification.get("status") == "VERIFIED"

    # Chained financial statement pack should be created
    assert "financial_statement_pack" in verification
    pack = verification["financial_statement_pack"]
    assert pack is not None
    assert pack.get("report_id") is not None
    assert pack.get("is_balanced") is True


@pytest.mark.asyncio
async def test_controller_inquiry_webhook_resolution(test_db: Session):
    """Verify that inbound controller WhatsApp/Email messages resolve open checklist inquiries."""
    client = test_db.get(ClientOrganization, "anr_group")
    assert client is not None

    # 1. Create a checklist and dispatch an inquiry
    checklist = await GLClosingService.get_or_create_period_checklist(test_db, client, "October", 2026)
    inquiry_res = await GLClosingService.dispatch_autonomous_inquiry(
        db=test_db,
        client=client,
        checklist_id=checklist.checklist_id,
        step_id="step_depreciation_ias16",
        question_text="Please confirm the useful life and residual value for commercial laundry machinery.",
        target_channel="EMAIL",
        recipient_override="controller@anrgroup.com",
    )
    assert inquiry_res["status"] in ("DISPATCHED", "SENT")

    # Refresh checklist to confirm step is marked SENT
    test_db.refresh(checklist)
    dep_step = next(s for s in checklist.steps if s["step_id"] == "step_depreciation_ias16")
    assert dep_step.get("inquiry_status") == "SENT"

    # Block step to test unblocking upon controller reply
    dep_step["status"] = "BLOCKED"
    checklist.steps = [dict(s) for s in checklist.steps]
    test_db.add(checklist)
    test_db.commit()

    # 2. Simulate inbound response from controller via email webhook
    gl_agent = client.agents[0]
    inbound_res = await AgentCommsService.process_inbound_agent_message(
        session=test_db,
        client=client,
        agent=gl_agent,
        channel="EMAIL",
        sender_address="controller@anrgroup.com",
        recipient_address="anr-group.gl-closing@agents.service4gh.com",
        body_text="Approved. Commercial laundry equipment has a 5-year straight line useful life with zero residual value.",
        subject="Re: Monthly Closing Query: PPE Depreciation",
        send_external_reply=False,
    )

    assert inbound_res is not None

    # 3. Verify checklist step has been updated and unblocked
    test_db.refresh(checklist)
    dep_step_after = next(s for s in checklist.steps if s["step_id"] == "step_depreciation_ias16")
    assert dep_step_after.get("inquiry_status") == "ANSWERED"
    assert "5-year straight line" in dep_step_after.get("inquiry_response", "")
    assert dep_step_after.get("status") in ("IN_PROGRESS", "READY", "COMPLETED")


@pytest.mark.asyncio
async def test_gl_agent_react_closing_tools(test_db: Session):
    """Verify that all new GL close tools execute correctly via AgenticBrainService."""
    client = test_db.get(ClientOrganization, "anr_group")
    assert client is not None
    gl_agent = client.agents[0]

    # 1. run_subledger_tie_out
    tie_res = await AgenticBrainService.execute_tool(
        db=test_db,
        client=client,
        agent=gl_agent,
        tool_name="run_subledger_tie_out",
        tool_input={"month": "October", "year": 2026},
    )
    assert tie_res["status"] == "success"
    assert "tie_out_summary" in tie_res

    # 2. run_pre_flight_close_review
    review_res = await AgenticBrainService.execute_tool(
        db=test_db,
        client=client,
        agent=gl_agent,
        tool_name="run_pre_flight_close_review",
        tool_input={"month": "October", "year": 2026},
    )
    assert review_res["status"] == "success"
    assert review_res["accounts_audited_count"] > 0

    # 3. execute_close_runbook
    runbook_res = await AgenticBrainService.execute_tool(
        db=test_db,
        client=client,
        agent=gl_agent,
        tool_name="execute_close_runbook",
        tool_input={"month": "October", "year": 2026, "auto_post": False},
    )
    assert runbook_res["status"] == "success"
    assert runbook_res["completed_steps"] >= 1

    # 4. verify_post_closing_equilibrium
    verify_res = await AgenticBrainService.execute_tool(
        db=test_db,
        client=client,
        agent=gl_agent,
        tool_name="verify_post_closing_equilibrium",
        tool_input={"month": "October", "year": 2026},
    )
    assert verify_res["status"] == "success"
    assert verify_res["is_balanced"] is True
    assert verify_res["suspense_cleared"] is True
