"""Automated test suite for the Autonomous GL Month-End Close Checklist & Runbook Engine."""

import pytest
from sqlmodel import Session, create_engine, SQLModel
from sqlmodel.pool import StaticPool
from fastapi.testclient import TestClient

from app.main import app
from app.models.db_models import (
    ClientOrganization,
    MonthEndCloseChecklist,
    ManualJournalWorkingPaper,
)
from app.services.gl_closing_service import GLClosingService
from app.api.deps import require_authenticated_user
from app.db.session import get_db_session


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
                    "is_active": True,
                    "active": True,
                }
            ],
        )
        session.add(client)
        session.commit()
        yield session


@pytest.mark.asyncio
async def test_synthesize_baseline_checklist_covers_active_accounts(test_db: Session):
    """Verify that baseline close checklist synthesizes standard and tailored steps."""
    client = test_db.get(ClientOrganization, "anr_group")
    assert client is not None

    tb = await GLClosingService.fetch_trial_balance(test_db, client, month="October", year=2026)
    steps = GLClosingService.synthesize_baseline_close_checklist(client, tb)

    # 1. Verify standard closing steps exist
    step_ids = [s["step_id"] for s in steps]
    assert "step_subledger_ar_tieout" in step_ids
    assert "step_subledger_ap_tieout" in step_ids
    assert "step_bank_reconciliation_tieout" in step_ids
    assert "step_suspense_zero_clearance" in step_ids
    assert "step_depreciation_ias16" in step_ids
    assert "step_prepayments_amortization" in step_ids
    assert "step_operating_accruals" in step_ids
    assert "step_fx_revaluation" in step_ids
    assert "step_statutory_tax_provision" in step_ids
    assert "step_equity_retained_earnings_tieout" in step_ids

    # 2. Check that target accounts cover AR, AP, Bank, Fixed Assets, Taxes
    categories = {s["category"] for s in steps}
    assert "SUBLEDGER_TIE_OUT" in categories
    assert "FIXED_ASSETS" in categories
    assert "PREPAYMENTS" in categories
    assert "ACCRUALS_LIABILITIES" in categories
    assert "TAXATION" in categories


@pytest.mark.asyncio
async def test_get_or_create_period_checklist_persists(test_db: Session):
    """Verify get_or_create_period_checklist creates persistent database records."""
    client = test_db.get(ClientOrganization, "anr_group")
    assert client is not None

    checklist = await GLClosingService.get_or_create_period_checklist(test_db, client, "October", 2026)
    assert checklist.id is not None
    assert checklist.client_id == "anr_group"
    assert checklist.period_month == "October"
    assert checklist.period_year == 2026
    assert checklist.total_steps_count >= 10
    assert checklist.completed_steps_count == 0
    assert checklist.status == "DRAFT"

    # Re-retrieval should return the exact same instance
    re_retrieved = await GLClosingService.get_or_create_period_checklist(test_db, client, "October", 2026)
    assert re_retrieved.checklist_id == checklist.checklist_id


@pytest.mark.asyncio
async def test_inter_agent_subledger_tie_outs(test_db: Session):
    """Verify subledger coordination across AR Customer, AP Vendor, and Bank accounts."""
    client = test_db.get(ClientOrganization, "anr_group")
    assert client is not None

    tie_outs = await GLClosingService.run_inter_agent_subledger_tie_out(test_db, client, "October", 2026)
    assert "accounts_receivable" in tie_outs
    assert "accounts_payable" in tie_outs
    assert "bank_reconciliation" in tie_outs

    ar = tie_outs["accounts_receivable"]
    assert ar["gl_control_account"] == "1200"
    assert ar["gl_balance"] == 215000.0
    assert ar["status"] == "TIED_OUT"

    ap = tie_outs["accounts_payable"]
    assert ap["gl_control_account"] == "2100"
    assert ap["gl_balance"] == 142000.0
    assert ap["status"] == "TIED_OUT"

    bank = tie_outs["bank_reconciliation"]
    assert bank["suspense_cleared"] is True
    assert bank["suspense_account_balance"] == 0.0


@pytest.mark.asyncio
async def test_pre_flight_anomaly_discovery_and_dynamic_step_integration(test_db: Session):
    """Verify that pre-flight scan identifies newly added active accounts and integrates steps."""
    client = test_db.get(ClientOrganization, "anr_group")
    assert client is not None

    checklist = await GLClosingService.get_or_create_period_checklist(test_db, client, "October", 2026)
    initial_step_count = len(checklist.steps)

    # Run pre-flight review
    summary = await GLClosingService.pre_flight_close_review(test_db, client, "October", 2026)

    assert "coverage_percentage" in summary
    assert summary["coverage_percentage"] > 70.0
    assert "executive_pre_flight_memo" in summary
    assert "Pre-Flight General Ledger & Close Discovery Memo" in summary["executive_pre_flight_memo"]

    # Refresh checklist
    test_db.refresh(checklist)
    assert checklist.status == "PREFLIGHT_COMPLETED"
    assert len(checklist.steps) >= initial_step_count


@pytest.mark.asyncio
async def test_execute_step_and_runbook(test_db: Session):
    """Verify step-by-step execution, working paper generation, and runbook progression."""
    client = test_db.get(ClientOrganization, "anr_group")
    assert client is not None

    checklist = await GLClosingService.get_or_create_period_checklist(test_db, client, "October", 2026)

    # 1. Execute Depreciation Step
    step_res = await GLClosingService.execute_checklist_step(
        test_db, client, checklist.checklist_id, "step_depreciation_ias16", auto_post=False
    )
    assert step_res["step"]["status"] == "COMPLETED"
    assert step_res["working_paper_id"] is not None
    assert step_res["completed_steps"] >= 1

    # Verify working paper exists
    from sqlmodel import select
    wp = test_db.exec(
        select(ManualJournalWorkingPaper).where(
            ManualJournalWorkingPaper.paper_id == step_res["working_paper_id"]
        )
    ).first()
    assert wp is not None
    assert wp.is_balanced is True
    assert wp.total_debit > 0

    # 2. Execute Full Runbook
    runbook_res = await GLClosingService.execute_close_runbook(
        test_db, client, checklist.checklist_id, auto_post=False
    )
    assert runbook_res["completed_steps"] >= 8
    assert "post_close_verification" in runbook_res
    assert runbook_res["post_close_verification"]["is_balanced"] is True


@pytest.mark.asyncio
async def test_post_close_equilibrium_verification(test_db: Session):
    """Verify Post-Posting Verification Loop ('Audit After Post') equilibrium confirmation."""
    client = test_db.get(ClientOrganization, "anr_group")
    assert client is not None

    checklist = await GLClosingService.get_or_create_period_checklist(test_db, client, "October", 2026)
    verification = await GLClosingService.verify_post_posting_equilibrium(test_db, client, checklist.checklist_id)

    assert verification["is_balanced"] is True
    assert verification["discrepancy"] == 0.0
    assert verification["suspense_cleared"] is True
    assert verification["status"] == "VERIFIED"
    assert verification["certificate_id"].startswith("CERT-")


@pytest.mark.asyncio
async def test_autonomous_inquiry_dispatch(test_db: Session):
    """Verify autonomous inquiry dispatch to Controller via WhatsApp or Email."""
    client = test_db.get(ClientOrganization, "anr_group")
    assert client is not None

    checklist = await GLClosingService.get_or_create_period_checklist(test_db, client, "October", 2026)
    inq_res = await GLClosingService.dispatch_autonomous_inquiry(
        test_db,
        client,
        checklist.checklist_id,
        "step_depreciation_ias16",
        "Please confirm residual salvage value for laundry machinery acquired in Q3.",
        target_channel="WHATSAPP",
    )
    assert inq_res["status"] == "DISPATCHED"
    assert inq_res["channel"] == "WHATSAPP"
    assert inq_res["inquiry_id"].startswith("inq_")


def test_gl_checklist_api_endpoints_and_tenant_security(test_db: Session):
    """Verify API endpoints for checklist retrieval, pre-flight review, and cross-tenant security."""
    app.dependency_overrides[get_db_session] = lambda: test_db
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "email": "partner@s4advisory.com",
        "organization_id": "s4_advisory",
        "organizations": [{"id": "s4_advisory"}],
        "organization": {"id": "s4_advisory"},
        "role": "partner",
        "is_org_admin": True,
        "is_platform_admin": False,
    }

    client = TestClient(app)

    # 1. GET Checklist
    res = client.get("/api/v1/gl/anr_group/checklist?month=October&year=2026")
    assert res.status_code == 200
    data = res.json()
    assert data["client_id"] == "anr_group"
    assert len(data["steps"]) >= 10
    checklist_id = data["checklist_id"]

    # 2. Subledger Tie-Out Endpoint
    sub_res = client.post("/api/v1/gl/anr_group/checklist/subledger-tie-out?month=October&year=2026")
    assert sub_res.status_code == 200
    sub_data = sub_res.json()
    assert "accounts_receivable" in sub_data

    # 3. Pre-Flight Scan Endpoint
    pf_res = client.post("/api/v1/gl/anr_group/checklist/pre-flight-scan?month=October&year=2026")
    assert pf_res.status_code == 200
    pf_data = pf_res.json()
    assert pf_data["coverage_percentage"] > 70.0

    # 4. Execute Individual Step Endpoint
    exec_step_res = client.post(
        "/api/v1/gl/anr_group/checklist/steps/step_subledger_ar_tieout/execute",
        json={"checklist_id": checklist_id, "auto_post": False},
    )
    assert exec_step_res.status_code == 200

    # 5. Post-Close Verify Endpoint
    verify_res = client.post(f"/api/v1/gl/anr_group/checklist/post-close-verify?checklist_id={checklist_id}")
    assert verify_res.status_code == 200
    assert verify_res.json()["is_balanced"] is True

    # 6. Cross-Tenant Forbidden Access
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "email": "intruder@otherfirm.com",
        "organization_id": "competitor_firm",
        "organizations": [{"id": "competitor_firm"}],
        "organization": {"id": "competitor_firm"},
        "role": "partner",
        "is_org_admin": True,
        "is_platform_admin": False,
    }
    forbidden_res = client.get("/api/v1/gl/anr_group/checklist")
    assert forbidden_res.status_code == 403

    app.dependency_overrides.clear()
