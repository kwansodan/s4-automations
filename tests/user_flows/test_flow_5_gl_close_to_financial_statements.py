"""End-to-End User Flow 5: GL Month-End Close, Working Papers & Financial Statement Synthesis.

Validates the complete operator journey for:
1. On-launch checklist formulation tailored to client accounting policies and framework.
2. Inter-agent subledger tie-outs across AR, AP, and Bank control accounts.
3. Automated Pre-Flight scan for unmapped balances and contra anomalies.
4. Execution of all tailored adjusting runbook procedures and calculation schedules.
5. Post-close equilibrium verification ("Audit after Post") and certificate sealing.
6. Chained synthesis of full IFRS financial statement pack with mathematical balance:
   Total Assets == Total Liabilities + Total Equity.
"""

import pytest
import uuid
from sqlmodel import Session, select

from app.db.session import get_engine
from app.models.db_models import ClientOrganization, MonthEndCloseChecklist, ManualJournalWorkingPaper
from app.services.gl_closing_service import GLClosingService
from app.services.financial_reporting_service import FinancialReportingService


@pytest.fixture
def gl_test_org():
    cid = f"org_gl_flow_{uuid.uuid4().hex[:6]}"
    with Session(get_engine()) as session:
        org = ClientOrganization(
            id=cid,
            name="Vanguard Global Trading Ghana",
            slug=cid,
            industry="Wholesale & Global Trading",
            status="active",
            accounting_software="zoho_books",
            currency="GHS",
            custom_config={"currency": "GHS", "reporting_framework": "IFRS"},
            pipelines=[
                {
                    "id": f"pipe_gl_{cid}",
                    "name": "General Ledger & Closing Accountant",
                    "section": "GL",
                    "status": "active",
                },
                {
                    "id": f"pipe_fr_{cid}",
                    "name": "Statutory Financial Reporting & MD&A Agent",
                    "section": "FR",
                    "status": "active",
                },
            ],
            agents=[
                {
                    "id": f"pipe_gl_{cid}",
                    "name": "Kwame",
                    "role": "General Ledger & Closing Accountant",
                    "section": "GL",
                    "status": "active",
                },
                {
                    "id": f"pipe_fr_{cid}",
                    "name": "Ama",
                    "role": "Statutory Financial Reporting Agent",
                    "section": "FR",
                    "status": "active",
                },
            ],
        )
        session.add(org)
        session.commit()
        session.refresh(org)

    yield org

    with Session(get_engine()) as session:
        db_org = session.exec(select(ClientOrganization).where(ClientOrganization.id == cid)).first()
        if db_org:
            checklists = session.exec(select(MonthEndCloseChecklist).where(MonthEndCloseChecklist.client_id == cid)).all()
            for cl in checklists:
                session.delete(cl)
            wps = session.exec(select(ManualJournalWorkingPaper).where(ManualJournalWorkingPaper.client_id == cid)).all()
            for wp in wps:
                session.delete(wp)
            session.delete(db_org)
            session.commit()


@pytest.mark.asyncio
async def test_user_flow_gl_close_and_financial_reporting_synthesis(gl_test_org):
    """Test Flow 5: Complete Month-End Close and Financial Statement Pack synthesis lifecycle."""
    cid = gl_test_org.id

    with Session(get_engine()) as session:
        db_org = session.exec(select(ClientOrganization).where(ClientOrganization.id == cid)).first()

        # Stage 1: On-Launch Checklist Formulation
        checklist = await GLClosingService.get_or_create_period_checklist(session, db_org, "October", 2026)
        assert checklist.checklist_id is not None
        assert len(checklist.steps) >= 5
        cl_id = checklist.checklist_id

        # Stage 2: Inter-Agent Subledger Tie-Outs
        tie_out = await GLClosingService.run_inter_agent_subledger_tie_out(session, db_org, "October", 2026)
        assert tie_out["overall_status"] in ("TIED_OUT", "READY_WITH_WARNINGS")
        assert "accounts_receivable" in tie_out
        assert "accounts_payable" in tie_out
        assert "cash_and_bank" in tie_out or "bank_reconciliation" in tie_out

        # Stage 3: Pre-Flight Anomaly & Gap Discovery
        preflight = await GLClosingService.pre_flight_close_review(session, db_org, "October", 2026)
        assert preflight["overall_readiness"] in ("CLEAR_TO_CLOSE", "ATTENTION_REQUIRED", "BLOCKED")
        assert "total_accounts_reviewed" in preflight

        # Stage 4: Runbook Procedure Execution
        runbook_res = await GLClosingService.execute_close_runbook(session, db_org, cl_id, auto_post=False)
        assert runbook_res["status"] in ("COMPLETED", "IN_PROGRESS")
        assert runbook_res["total_steps"] >= 5

        # Stage 5: Post-Close Equilibrium Verification
        verification = await GLClosingService.verify_post_posting_equilibrium(session, db_org, cl_id)
        assert verification["is_balanced"] is True
        assert verification["status"] == "VERIFIED"
        assert verification["total_debits"] == verification["total_credits"]
        assert verification["suspense_account_balance"] == 0.0

        # Stage 6: Chained Financial Statement Pack Synthesis (Ama - FR Agent)
        report = await FinancialReportingService.synthesize_statement_pack(
            db=session,
            client=db_org,
            period_type="MONTHLY",
            period_month="October",
            period_year=2026,
            reporting_framework="IFRS",
            prepared_by="ama_fr_agent",
        )

        assert report.report_id is not None
        assert report.reporting_framework == "IFRS"

        # Verify mathematical integrity across all financial statements
        bs = report.balance_sheet
        assert bs["is_balanced"] is True, "Balance sheet must be balanced!"
        assert bs["total_assets"] == bs["total_equity_and_liabilities"], "Assets must equal Liabilities + Equity"

        pnl = report.income_statement
        assert "revenue" in pnl
        assert "net_profit_for_period" in pnl

        cf = report.cash_flow_statement
        assert cf["method"] == "INDIRECT_METHOD"
        assert "net_increase_decrease_in_cash" in cf
        assert "operating_activities" in cf

        ratios = report.financial_ratios
        assert "liquidity" in ratios
        assert "profitability" in ratios
        assert "leverage" in ratios
        assert ratios["liquidity"]["current_ratio"] >= 0.0

        # Verify executive commentary exists
        assert len(report.executive_commentary) > 50
        assert "Executive Financial Performance Review" in report.executive_commentary
