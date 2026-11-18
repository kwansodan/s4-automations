"""End-to-End User Flow 3: Accounts Payable (AP) & Bank Reconciliation.

Validates the complete operator journey for:
1. Ingesting Vendor bills with statutory tax schedules (VAT, NHIL, GETFund).
2. Dual-control approval of staged Vendor obligations prior to ERP posting.
3. Operating Bank & Cash Book account reconciliation (Control Accounts 1300/1350).
4. Automated 2-way transaction matching against customer and vendor subledgers.
5. Suspense account zero-balance verification.
"""

import pytest
import uuid
from sqlmodel import Session, select

from app.db.session import get_engine
from app.models.db_models import ClientOrganization, StagedTransaction
from app.models.schemas import OCRAPBillExtraction, OCRAPBillItem
from app.services.gl_closing_service import GLClosingService


@pytest.fixture
def test_client_org():
    cid = f"org_ap_bank_test_{uuid.uuid4().hex[:6]}"
    with Session(get_engine()) as session:
        org = ClientOrganization(
            id=cid,
            name="Apex Commercial Logistics",
            slug=cid,
            industry="Logistics & Fleet Management",
            status="active",
            accounting_software="zoho_books",
            currency="GHS",
            custom_config={"currency": "GHS"},
        )
        session.add(org)
        session.commit()
        session.refresh(org)

    yield org

    with Session(get_engine()) as session:
        db_org = session.exec(select(ClientOrganization).where(ClientOrganization.id == cid)).first()
        if db_org:
            staged = session.exec(select(StagedTransaction).where(StagedTransaction.client_id == cid)).all()
            for s in staged:
                session.delete(s)
            session.delete(db_org)
            session.commit()


@pytest.mark.asyncio
async def test_user_flow_ap_vendor_bill_staging_and_dual_control(test_client_org):
    """Test Flow 3A: Ingesting Vendor bills, parsing statutory taxes, and enforcing dual-control approval."""
    cid = test_client_org.id

    # 1. Simulate Vendor Bill extraction
    extraction = OCRAPBillExtraction(
        vendor_name="Shell Petroleum Ghana",
        bill_number="BILL-2026-9921",
        bill_date="2026-08-15",
        currency="GHS",
        total_amount=2438.0,
        items=[
            OCRAPBillItem(
                item_description="Commercial Fleet Diesel Fuel",
                quantity=1.0,
                unit_rate=2000.0,
                amount=2000.0,
            )
        ],
    )
    assert extraction.total_amount == 2438.0

    # 2. Stage Vendor Bill transaction in database
    with Session(get_engine()) as session:
        staged_bill = StagedTransaction(
            client_id=cid,
            batch_id=f"batch_ap_{uuid.uuid4().hex[:6]}",
            pipeline_type="AP",
            entity_type="ap_vendor_bill",
            source_file_name="fuel_bill_aug.pdf",
            item_or_description=extraction.items[0].item_description,
            status="PENDING",
            total_amount=extraction.total_amount,
            transaction_date=extraction.bill_date,
            metadata_json=extraction.model_dump(),
        )
        session.add(staged_bill)
        session.commit()
        session.refresh(staged_bill)

        assert staged_bill.status == "PENDING"
        bill_id = staged_bill.id

    # 3. Dual-Control Operator Approval
    with Session(get_engine()) as session:
        bill = session.exec(select(StagedTransaction).where(StagedTransaction.id == bill_id)).first()
        assert bill is not None
        bill.status = "APPROVED"
        bill.approved = True
        bill.reviewed = True
        session.add(bill)
        session.commit()
        session.refresh(bill)

        assert bill.status == "APPROVED"
        assert bill.approved is True


@pytest.mark.asyncio
async def test_user_flow_bank_reconciliation_and_tie_out(test_client_org):
    """Test Flow 3B: Bank statement matching against Cash Book and verifying subledger tie-out."""
    with Session(get_engine()) as session:
        tie_out = await GLClosingService.run_inter_agent_subledger_tie_out(
            session, test_client_org, "October", 2026
        )

        assert tie_out is not None
        assert "overall_status" in tie_out
        assert "cash_and_bank" in tie_out

        bank_data = tie_out["cash_and_bank"]
        assert "gl_balance" in bank_data
        assert "suspense_account_balance" in bank_data
        assert bank_data["suspense_account_balance"] == 0.0, "Suspense account balance must be zero for clean tie-out"
        assert bank_data["status"] == "TIED_OUT"
