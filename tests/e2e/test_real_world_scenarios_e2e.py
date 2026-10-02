"""
Tier 4 E2E Tests: Real-World Commercial Laundry Workflows.

End-to-end multi-step scenarios representing daily commercial laundry operations:
- Scenario A: Complete monthly billing cycle across multiple hospitality customers
- Scenario B: Mid-month supplementary billing for single customer
- Scenario C: Billing correction and safe draft regeneration with deletion safeguards
- Scenario D: Multi-tenant billing data isolation
"""

import pytest
from typing import Dict, Any
from tests.e2e.conftest import execute_invoicing_workflow
from app.db.session import get_engine
from app.models.db_models import StagedTransaction, ClientOrganization
from app.services.zoho_service import ZohoBooksService
from app.utils.progress_tracker import pipeline_tracker
from sqlmodel import Session, select


# ---------------------------------------------------------------------------
# Scenario A: Complete Monthly Billing Cycle
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_scenario_a_complete_monthly_billing_cycle(seed_commercial_laundry_data: Dict[str, Any]):
    """
    Scenario A: Full monthly billing run for August 2026.
    Processes all approved slips for Labadi Beach Hotel and Luxwood Hotel,
    verifying telemetry streaming, invoice generation, amounts, and receipt items.
    """
    # 1. Trigger full invoicing run in Append mode
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        mode="append",
        target_customer_name=None,
    )

    # 2. Verify pipeline execution status
    assert res["status"] == "COMPLETED"
    assert res["invoices_count"] == 2

    # 3. Verify itemized receipt data structure
    receipt = res["invoices_created"]
    customer_names = {item["customer_name"] for item in receipt}
    assert "Labadi Beach Hotel" in customer_names
    assert "Luxwood Hotel" in customer_names

    # 4. Verify billing amounts match approved line items
    # Labadi: 60 sheets @ 18.50 = 1110.00, 40 towels @ 12.00 = 480.00 -> 1590.00
    labadi_inv = next(i for i in receipt if i["customer_name"] == "Labadi Beach Hotel")
    assert labadi_inv["total"] == 1590.00

    # Luxwood: 25 duvets @ 25.00 = 625.00, 65 pillow cases @ 8.00 = 520.00 -> 1145.00
    luxwood_inv = next(i for i in receipt if i["customer_name"] == "Luxwood Hotel")
    assert luxwood_inv["total"] == 1145.00

    # 5. Verify database ledger state transitions to INVOICED
    with Session(get_engine()) as session:
        labadi_txs = session.exec(
            select(StagedTransaction).where(
                StagedTransaction.client_id == "commercial_laundry_tenant",
                StagedTransaction.id.in_([101, 102]),
            )
        ).all()
        for tx in labadi_txs:
            assert tx.status == "INVOICED"
            assert tx.accounting_ref_id is not None
            assert str(tx.accounting_ref_id).startswith("INV-")

    # 6. Verify pipeline tracker telemetry completed with receipt payload
    tracker_state = pipeline_tracker.get_state()
    assert tracker_state["is_running"] is False
    assert tracker_state["percent"] == 100
    assert tracker_state["last_result"] is not None
    assert "invoices_created" in tracker_state["last_result"]
    assert len(tracker_state["last_result"]["invoices_created"]) == 2


# ---------------------------------------------------------------------------
# Scenario B: Mid-Month Supplementary Single-Customer Billing
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_scenario_b_mid_month_single_customer_supplementary(seed_commercial_laundry_data: Dict[str, Any]):
    """
    Scenario B: Mid-month supplementary billing for Luxwood Hotel only.
    Leaves other customers (Labadi Beach Hotel) pending without modification.
    """
    # 1. Trigger scoped invoicing for Luxwood Hotel
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        mode="append",
        target_customer_name="Luxwood Hotel",
    )

    # 2. Verify only Luxwood Hotel was invoiced
    assert res["status"] == "COMPLETED"
    assert res["invoices_count"] == 1
    assert res["invoices_created"][0]["customer_name"] == "Luxwood Hotel"

    # 3. Verify Labadi Beach Hotel items remain in APPROVED status in ledger
    with Session(get_engine()) as session:
        labadi_txs = session.exec(
            select(StagedTransaction).where(
                StagedTransaction.client_id == "commercial_laundry_tenant",
                StagedTransaction.id.in_([101, 102]),
            )
        ).all()
        for tx in labadi_txs:
            assert tx.status == "APPROVED"
            assert tx.accounting_ref_id is None


# ---------------------------------------------------------------------------
# Scenario C: Billing Correction via Safe Draft Regeneration
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_scenario_c_billing_correction_and_safe_regeneration(seed_commercial_laundry_data: Dict[str, Any]):
    """
    Scenario C: Safe regeneration of an existing invoice for The Bantree.
    Verifies draft deletion, transaction re-billing, and fresh reference assignment.
    """
    # The Bantree has existing invoice INV-ANR-202608-0099
    old_inv_id = "INV-ANR-202608-0099"
    ZohoBooksService._global_mock_draft_invoices[f"commercial_laundry_tenant:cnt_bantree_103:August_2026"] = {
        "invoice_id": old_inv_id,
        "invoice_number": old_inv_id,
        "customer_id": "cnt_bantree_103",
        "customer_name": "The Bantree",
        "total": 270.00,
        "status": "draft",
    }

    # 1. Trigger regeneration with confirmed deletion
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        mode="regenerate",
        target_customer_name="The Bantree",
        confirm_delete=True,
    )

    # 2. Verify regeneration completed
    assert res["status"] == "COMPLETED"
    assert res["invoices_count"] == 1

    new_inv = res["invoices_created"][0]
    assert new_inv["customer_name"] == "The Bantree"
    assert new_inv["total"] == 270.00
    assert new_inv["invoice_number"] != old_inv_id

    # 3. Verify ledger transaction updated with new invoice reference
    with Session(get_engine()) as session:
        bantree_tx = session.exec(
            select(StagedTransaction).where(
                StagedTransaction.client_id == "commercial_laundry_tenant",
                StagedTransaction.id == 105,
            )
        ).first()
        assert bantree_tx.status == "INVOICED"
        assert bantree_tx.accounting_ref_id == new_inv["invoice_number"]


# ---------------------------------------------------------------------------
# Scenario D: Multi-Tenant Billing Isolation
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_scenario_d_multi_tenant_billing_isolation(seed_commercial_laundry_data: Dict[str, Any]):
    """
    Scenario D: Invoicing run for tenant A never touches or bills tenant B transactions.
    """
    # 1. Insert an approved transaction belonging to a different tenant
    with Session(get_engine()) as session:
        # Clean existing test records if present
        existing_other_tx = session.exec(select(StagedTransaction).where(StagedTransaction.id == 999)).first()
        if existing_other_tx:
            session.delete(existing_other_tx)
        existing_tenant = session.exec(select(ClientOrganization).where(ClientOrganization.id == "other_hospitality_tenant")).first()
        if existing_tenant:
            session.delete(existing_tenant)
        session.commit()

        other_tenant = ClientOrganization(
            id="other_hospitality_tenant",
            name="Other Hospitality Group Ltd",
            industry="Hotels",
        )
        session.add(other_tenant)

        other_tx = StagedTransaction(
            id=999,
            client_id="other_hospitality_tenant",
            batch_id="batch_other_001",
            source_file_name="other_hotel_slip.jpg",
            transaction_date="2026-08-12T00:00:00Z",
            item_or_description="Chef Apron",
            quantity_or_debit=50.0,
            credit_amount=50.0,
            rate_or_price=5.00,
            total_amount=250.00,
            approved=True,
            status="APPROVED",
            metadata_json={"customer_name": "Accra City Hotel", "zoho_contact_id": "cnt_accra_city"},
        )
        session.add(other_tx)
        session.commit()

    # 2. Run invoicing specifically for commercial_laundry_tenant
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        mode="append",
        target_customer_name=None,
    )
    assert res["status"] == "COMPLETED"

    # 3. Verify only commercial laundry customers were billed
    billed_customers = {i["customer_name"] for i in res["invoices_created"]}
    assert "Accra City Hotel" not in billed_customers

    # 4. Verify other tenant's transaction remains strictly APPROVED and unbilled
    with Session(get_engine()) as session:
        tx_check = session.exec(select(StagedTransaction).where(StagedTransaction.id == 999)).first()
        assert tx_check.status == "APPROVED"
        assert tx_check.accounting_ref_id is None
