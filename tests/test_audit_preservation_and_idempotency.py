"""Tests for slip audit state preservation, idempotency, and deduplication."""

import pytest
from unittest.mock import AsyncMock
from sqlmodel import Session, select

from app.db.session import get_engine
from app.models.db_models import StagedTransaction
from app.strategies.commercial_laundry import CommercialLaundryStrategy
from app.strategies.base import ExtractedLineItem
from app.api.v1.clients import prune_duplicate_staged_transactions


@pytest.mark.asyncio
async def test_commercial_laundry_sync_idempotency_preserves_audited_state():
    """Verifies that running sync_review_workspace repeatedly does not duplicate rows and strictly preserves approved status."""
    client_id = "anr_group"
    test_file_name = "Test_Slip_Idempotency_01.jpg"
    
    # 0. Clean any prior test artifacts
    with Session(get_engine()) as session:
        existing = session.exec(
            select(StagedTransaction).where(
                StagedTransaction.client_id == client_id,
                StagedTransaction.source_file_name == test_file_name,
            )
        ).all()
        for e in existing:
            session.delete(e)
        session.commit()

    # 1. Prepare sample extracted line items
    items = [
        ExtractedLineItem(
            item_or_description="Bed Sheet Double (Heavy Cotton)",
            category_or_account="Linen Laundry Service",
            quantity_or_debit=20.0,
            credit_amount=20.0,
            unit_price=15.0,
            total_amount=300.0,
            discrepancy=0.0,
            raw_extracted_data={
                "file_name": test_file_name,
                "source_identifier": "drive_id_slip_001",
                "date": "2026-09-15",
                "hotel_name": "Labadi Beach Hotel",
                "customer_name": "Labadi Beach Hotel",
            },
        )
    ]

    strategy = CommercialLaundryStrategy(client_id=client_id, client_name="ANR Group")
    strategy.zoho.fetch_active_contacts = AsyncMock(return_value=[])

    # 2. First Run (Initial Staging)
    res1 = await strategy.sync_review_workspace("September", 2026, items)
    assert res1["staged_transactions_count"] == 1

    # Verify 1 staged row created with PENDING
    with Session(get_engine()) as session:
        staged_records = session.exec(
            select(StagedTransaction).where(
                StagedTransaction.client_id == client_id,
                StagedTransaction.source_file_name == test_file_name,
            )
        ).all()
        assert len(staged_records) == 1
        tx = staged_records[0]
        assert tx.approved is False
        assert tx.reviewed is False
        assert tx.status == "PENDING"

        # 3. Simulate Operator Auditing & Approving on Friday
        tx.approved = True
        tx.reviewed = True
        tx.status = "APPROVED"
        session.add(tx)
        session.commit()

    # 4. Second Run (Simulating Weekend Autonomous Cron Job)
    res2 = await strategy.sync_review_workspace("September", 2026, items)
    assert res2["staged_transactions_count"] == 1

    # Verify still exactly 1 staged row, and operator's approval is strictly preserved
    with Session(get_engine()) as session:
        staged_after_cron = session.exec(
            select(StagedTransaction).where(
                StagedTransaction.client_id == client_id,
                StagedTransaction.source_file_name == test_file_name,
            )
        ).all()
        assert len(staged_after_cron) == 1, "Duplicate rows should NOT be created on subsequent cron runs"
        assert staged_after_cron[0].approved is True, "Approved status should NOT be reset to False"
        assert staged_after_cron[0].reviewed is True, "Reviewed status should NOT be reset to False"
        assert staged_after_cron[0].status == "APPROVED", "Status should remain APPROVED"

        # Clean up
        for s in staged_after_cron:
            session.delete(s)
        session.commit()


def test_prune_duplicate_staged_transactions():
    """Verifies that prune_duplicate_staged_transactions keeps the approved record and removes redundant pending records."""
    client_id = "test_laundry_prune"
    test_file_name = "Duplicate_Slip.jpg"

    with Session(get_engine()) as session:
        # Clean any prior test items
        existing = session.exec(
            select(StagedTransaction).where(
                StagedTransaction.client_id == client_id,
                StagedTransaction.source_file_name == test_file_name,
            )
        ).all()
        for e in existing:
            session.delete(e)
        session.commit()

        # Create 1 approved transaction and 3 redundant pending duplicates
        t_approved = StagedTransaction(
            client_id=client_id,
            batch_id="batch_initial",
            transaction_date="2026-09-10",
            source_file_name=test_file_name,
            source_identifier="drive_dup_01",
            item_or_description="Bath Towel Large",
            quantity_or_debit=10.0,
            rate_or_price=12.0,
            total_amount=120.0,
            reviewed=True,
            approved=True,
            status="APPROVED",
        )
        session.add(t_approved)

        for i in range(3):
            t_dup = StagedTransaction(
                client_id=client_id,
                batch_id=f"batch_cron_run_{i}",
                transaction_date="2026-09-10",
                source_file_name=test_file_name,
                source_identifier="drive_dup_01",
                item_or_description="Bath Towel Large",
                quantity_or_debit=10.0,
                rate_or_price=12.0,
                total_amount=120.0,
                reviewed=False,
                approved=False,
                status="PENDING",
            )
            session.add(t_dup)

        session.commit()

        # Pre-check: 4 total records
        all_before = session.exec(
            select(StagedTransaction).where(
                StagedTransaction.client_id == client_id,
                StagedTransaction.source_file_name == test_file_name,
            )
        ).all()
        assert len(all_before) == 4

        # Execute pruning
        pruned = prune_duplicate_staged_transactions(session, [client_id])
        assert pruned == 3, f"Expected 3 duplicate records to be pruned, got {pruned}"

        # Post-check: exactly 1 record remains and it is the approved one
        remaining = session.exec(
            select(StagedTransaction).where(
                StagedTransaction.client_id == client_id,
                StagedTransaction.source_file_name == test_file_name,
            )
        ).all()
        assert len(remaining) == 1
        assert remaining[0].approved is True
        assert remaining[0].status == "APPROVED"

        # Clean up
        for r in remaining:
            session.delete(r)
        session.commit()
