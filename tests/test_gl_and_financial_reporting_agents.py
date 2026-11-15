"""Automated test suite for General Ledger (GL) Accountant Agent and Financial Reporting (FR) Agent."""

import pytest
from datetime import datetime, timezone
from sqlmodel import Session, select, create_engine, SQLModel
from sqlmodel.pool import StaticPool
from fastapi.testclient import TestClient

from app.main import app
from app.models.db_models import (
    ClientOrganization,
    ManualJournalWorkingPaper,
    FinancialStatementReport,
    get_utc_now,
)
from app.services.agentic_brain_service import AgenticBrainService
from app.services.gl_closing_service import GLClosingService
from app.services.financial_reporting_service import FinancialReportingService
from app.services.auth_service import AuthService
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
        # Create test client organization
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
                },
                {
                    "id": "pipe_anr_financial_reporting",
                    "name": "Financial Reporting & Disclosures Agent",
                    "section": "FR",
                    "entity_type": "fr_statement_pack",
                    "source_type": "general_ledger",
                    "autonomy_level": "copilot",
                    "is_active": True,
                    "active": True,
                },
            ],
            agents=[
                {
                    "id": "pipe_anr_gl_closing",
                    "name": "General Ledger & Closing Accountant",
                    "section": "GL",
                    "entity_type": "gl_journal",
                    "source_type": "general_ledger",
                    "autonomy_level": "semi_autonomous",
                    "is_active": True,
                    "active": True,
                },
                {
                    "id": "pipe_anr_financial_reporting",
                    "name": "Financial Reporting & Disclosures Agent",
                    "section": "FR",
                    "entity_type": "fr_statement_pack",
                    "source_type": "general_ledger",
                    "autonomy_level": "copilot",
                    "is_active": True,
                    "active": True,
                },
            ],
        )
        session.add(client)
        session.commit()
        session.refresh(client)
        yield session


# =============================================================================
# 1. Scope Separation & Guardrail Tests
# =============================================================================

@pytest.mark.asyncio
async def test_gl_agent_rejects_operational_invoices_and_bills(test_db: Session):
    """Verifies that the GL Accountant Agent strictly rejects operational invoice/bill drafting."""
    client = test_db.exec(select(ClientOrganization).where(ClientOrganization.id == "anr_group")).first()
    gl_agent = {"id": "pipe_anr_gl_closing", "name": "GL Closing Agent", "section": "GL"}

    res = await AgenticBrainService.plan_and_execute_goal(
        db=test_db,
        client=client,
        agent=gl_agent,
        goal="Draft invoice for Kempinski Hotel customer slips for October 2026",
    )

    assert res["status"] == "rejected"
    assert "strictly reserved for General Ledger & Trial Balance reviews" in res["message"]


@pytest.mark.asyncio
async def test_fr_agent_rejects_ledger_mutations_and_journal_posting(test_db: Session):
    """Verifies that the Financial Reporting Agent strictly rejects ledger mutation and journal posting."""
    client = test_db.exec(select(ClientOrganization).where(ClientOrganization.id == "anr_group")).first()
    fr_agent = {"id": "pipe_anr_financial_reporting", "name": "FR Agent", "section": "FR"}

    res = await AgenticBrainService.plan_and_execute_goal(
        db=test_db,
        client=client,
        agent=fr_agent,
        goal="Post journal entry for depreciation to ERP",
    )

    assert res["status"] == "rejected"
    assert "strictly read-only presentation and disclosure synthesis" in res["message"]


# =============================================================================
# 2. Trial Balance & Closing Adjustments Audit Tests
# =============================================================================

@pytest.mark.asyncio
async def test_gl_closing_service_trial_balance_balanced(test_db: Session):
    """Verifies Trial Balance accounts are fetched and mathematically balanced."""
    client = test_db.exec(select(ClientOrganization).where(ClientOrganization.id == "anr_group")).first()
    tb = await GLClosingService.fetch_trial_balance(test_db, client, month="October", year=2026)

    assert tb["client_id"] == "anr_group"
    assert tb["is_balanced"] is True
    assert tb["total_debits"] > 0
    assert abs(tb["total_debits"] - tb["total_credits"]) < 0.01
    assert len(tb["accounts"]) >= 10


@pytest.mark.asyncio
async def test_gl_closing_service_audit_adjustments(test_db: Session):
    """Verifies that closing audit identifies required adjustments across IAS 16, Prepayments, Accruals, FX, and Taxes."""
    client = test_db.exec(select(ClientOrganization).where(ClientOrganization.id == "anr_group")).first()
    adjustments = await GLClosingService.audit_closing_adjustments(test_db, client, month="October", year=2026)

    assert len(adjustments) >= 4
    types = {a["adjustment_type"] for a in adjustments}
    assert "DEPRECIATION" in types
    assert "PREPAYMENT" in types
    assert "ACCRUAL" in types
    assert "TAX_PROVISION" in types

    for adj in adjustments:
        entries = adj["journal_entries"]
        assert len(entries) >= 2
        deb = sum(e["amount"] for e in entries if e["debit_or_credit"] == "debit")
        cred = sum(e["amount"] for e in entries if e["debit_or_credit"] == "credit")
        assert abs(deb - cred) < 0.01


# =============================================================================
# 3. Working Papers & Technical Accounting White Papers Tests
# =============================================================================

@pytest.mark.asyncio
async def test_create_working_paper_and_white_paper_memo(test_db: Session):
    """Verifies working paper creation with complete calculation schedules and technical white paper memo."""
    client = test_db.exec(select(ClientOrganization).where(ClientOrganization.id == "anr_group")).first()
    adj = {
        "title": "Monthly Depreciation on Plant & Machinery",
        "adjustment_type": "DEPRECIATION",
        "standard_reference": "IAS 16 Property, Plant and Equipment (Section 50)",
        "entity_policy_applied": "Straight-line depreciation over 5-year economic life.",
        "calculation_facts": {
            "gross_asset_cost": 480000.0,
            "residual_value": 0.0,
            "useful_life_years": 5,
            "annual_charge": 96000.0,
            "monthly_charge": 8000.0,
        },
        "reasoning": "IAS 16.50 systematic allocation over useful life.",
        "currency": "GHS",
        "journal_entries": [
            {"account_id": "6200", "account_name": "Depreciation Expense", "debit_or_credit": "debit", "amount": 8000.0, "description": "Depr expense"},
            {"account_id": "1150", "account_name": "Accumulated Depreciation", "debit_or_credit": "credit", "amount": 8000.0, "description": "Accum depr"},
        ],
    }

    wp = await GLClosingService.create_working_paper(
        db=test_db,
        client=client,
        adjustment=adj,
        month="October",
        year=2026,
        prepared_by="gl_accountant_agent",
    )

    assert wp.paper_id.startswith("wp_2026_oct_")
    assert wp.is_balanced is True
    assert wp.total_debit == 8000.0
    assert wp.total_credit == 8000.0
    assert wp.status == "SUGGESTED"
    assert "Technical Accounting White Paper & Working Memo" in wp.memo_markdown
    assert "IAS 16" in wp.memo_markdown
    assert "480,000.00" in wp.memo_markdown


@pytest.mark.asyncio
async def test_post_working_paper_to_erp(test_db: Session):
    """Verifies posting an approved working paper to ERP and updating status to POSTED_TO_ERP."""
    client = test_db.exec(select(ClientOrganization).where(ClientOrganization.id == "anr_group")).first()
    adj = {
        "title": "Prepayment Amortization - Rent & Insurance",
        "adjustment_type": "PREPAYMENT",
        "standard_reference": "IAS 1 Presentation of Financial Statements",
        "journal_entries": [
            {"account_id": "6300", "account_name": "Insurance Expense", "debit_or_credit": "debit", "amount": 3000.0, "description": "Expired portion"},
            {"account_id": "1250", "account_name": "Prepaid Expenses", "debit_or_credit": "credit", "amount": 3000.0, "description": "Asset reduction"},
        ],
    }

    wp = await GLClosingService.create_working_paper(
        db=test_db,
        client=client,
        adjustment=adj,
        month="October",
        year=2026,
    )

    res = await GLClosingService.post_working_paper_to_erp(
        db=test_db,
        client=client,
        paper_id=wp.paper_id,
        approved_by="senior_controller@service4gh.com",
    )

    assert res["status"] == "POSTED_TO_ERP"
    assert res["journal_id"] is not None
    assert res["journal_reference"].startswith("JRNL-")
    assert res["total_debit"] == 3000.0

    # Verify DB persistence
    refreshed = test_db.exec(select(ManualJournalWorkingPaper).where(ManualJournalWorkingPaper.paper_id == wp.paper_id)).first()
    assert refreshed.status == "POSTED_TO_ERP"
    assert refreshed.approved_by == "senior_controller@service4gh.com"
    assert refreshed.posted_at is not None


# =============================================================================
# 4. Financial Statement Pack Synthesis Tests
# =============================================================================

@pytest.mark.asyncio
async def test_financial_reporting_statement_pack_balanced(test_db: Session):
    """Verifies synthesis of complete reporting pack and mathematical balance of the Balance Sheet."""
    client = test_db.exec(select(ClientOrganization).where(ClientOrganization.id == "anr_group")).first()

    report = await FinancialReportingService.synthesize_statement_pack(
        db=test_db,
        client=client,
        period_type="MONTHLY",
        period_month="October",
        period_year=2026,
        reporting_framework="IFRS",
    )

    assert report.report_id.startswith("fs_2026_oct_")
    assert report.status == "BOARD_READY"
    assert report.reporting_framework == "IFRS"

    # 1. Income Statement
    pnl = report.income_statement
    assert pnl["revenue"] > 0
    assert pnl["gross_profit"] > 0
    assert pnl["operating_profit_ebit"] > 0
    assert pnl["net_profit_for_period"] > 0
    assert pnl["gross_profit_margin_pct"] > 0

    # 2. Balance Sheet Mathematical Balance: Assets == Liabilities + Equity
    bs = report.balance_sheet
    assert bs["is_balanced"] is True
    assert bs["total_assets"] > 0
    assert abs(bs["total_assets"] - bs["total_equity_and_liabilities"]) < 0.05
    assert bs["discrepancy"] == 0.0

    # 3. Statement of Cash Flows (Indirect Method)
    cf = report.cash_flow_statement
    assert cf["method"] == "INDIRECT_METHOD"
    assert "operating_activities" in cf
    assert "investing_activities" in cf
    assert cf["cash_and_cash_equivalents_closing"] > 0

    # 4. Statement of Changes in Equity
    eq = report.equity_statement
    assert eq["total_equity_closing"] > 0
    assert eq["profit_for_the_period"] == pnl["net_profit_for_period"]

    # 5. Notes & Disclosures
    assert len(report.notes_to_accounts) >= 5
    note_titles = [n["title"] for n in report.notes_to_accounts]
    assert any("Summary of Significant Accounting Policies" in t for t in note_titles)
    assert any("Property, Plant and Equipment" in t for t in note_titles)

    # 6. Financial Ratios
    ratios = report.financial_ratios
    assert ratios["liquidity"]["current_ratio"] > 1.0
    assert ratios["profitability"]["net_profit_margin_pct"] > 0

    # 7. Commentary
    assert len(report.executive_commentary) > 100
    assert "Executive Financial Performance Review" in report.executive_commentary


# =============================================================================
# 5. API Endpoints & Multi-Tenant Access Tests
# =============================================================================

def test_gl_api_endpoints_and_tenant_security(test_db: Session):
    """Tests GL endpoints and verifies cross-tenant isolation enforcement."""
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

    # 1. Fetch Trial Balance
    tb_res = client.get("/api/v1/gl/anr_group/trial-balance")
    assert tb_res.status_code == 200
    tb_data = tb_res.json()
    assert tb_data["client_id"] == "anr_group"
    assert tb_data["is_balanced"] is True

    # 2. Audit and Suggest Working Papers
    audit_res = client.post(
        "/api/v1/gl/anr_group/working-papers/audit-and-suggest",
        json={"month": "October", "year": 2026, "auto_create_working_papers": True, "auto_approve": False},
    )
    assert audit_res.status_code == 200
    audit_data = audit_res.json()
    assert audit_data["adjustments_detected"] >= 4
    assert len(audit_data["created_working_papers"]) >= 4
    first_paper_id = audit_data["created_working_papers"][0]["paper_id"]

    # 3. List Working Papers
    list_res = client.get("/api/v1/gl/anr_group/working-papers")
    assert list_res.status_code == 200
    papers_list = list_res.json()
    assert len(papers_list) >= 4

    # 4. Get Working Paper Detail
    detail_res = client.get(f"/api/v1/gl/anr_group/working-papers/{first_paper_id}")
    assert detail_res.status_code == 200
    detail_data = detail_res.json()
    assert detail_data["paper_id"] == first_paper_id
    assert "Technical Accounting White Paper" in detail_data["memo_markdown"]

    # 5. Approve and Post Journal to ERP
    post_res = client.post(f"/api/v1/gl/anr_group/working-papers/{first_paper_id}/approve-and-post")
    assert post_res.status_code == 200
    post_data = post_res.json()
    assert post_data["journal"]["status"] == "POSTED_TO_ERP"

    # 6. Financial Reporting: Generate Statement Pack
    fr_gen_res = client.post(
        "/api/v1/fr/anr_group/reports/generate",
        json={"period_type": "MONTHLY", "period_month": "October", "period_year": 2026, "reporting_framework": "IFRS"},
    )
    assert fr_gen_res.status_code == 200
    fr_data = fr_gen_res.json()
    report_id = fr_data["report_id"]
    assert fr_data["is_balanced"] is True

    # 7. Financial Reporting: Get Report Detail
    fr_det_res = client.get(f"/api/v1/fr/anr_group/reports/{report_id}")
    assert fr_det_res.status_code == 200
    fr_full = fr_det_res.json()
    assert fr_full["balance_sheet"]["is_balanced"] is True
    assert len(fr_full["notes_to_accounts"]) >= 5

    # 8. Cross-Tenant Security: Unauthorized access to another organization's client
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "email": "intruder@otherfirm.com",
        "organization_id": "competitor_firm",
        "organizations": [{"id": "competitor_firm"}],
        "organization": {"id": "competitor_firm"},
        "role": "partner",
        "is_org_admin": True,
        "is_platform_admin": False,
    }
    forbidden_res = client.get("/api/v1/gl/anr_group/trial-balance")
    assert forbidden_res.status_code == 403

    app.dependency_overrides.clear()
