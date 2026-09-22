"""Unit tests for Client Ingestion Configuration & Staged Transaction Endpoints."""

import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.db.session import init_db


@pytest.fixture(autouse=True)
def setup_database():
    init_db()


client = TestClient(app)


def test_update_client_ingestion_and_probe():
    """Verify updating ingestion settings to OneDrive and probing connection."""
    # 1. Update Ingestion
    update_res = client.put(
        "/api/clients/anr_group/ingestion",
        json={
            "source_type": "onedrive",
            "source_config": {"tenant_id": "test-tenant", "folder_path": "/ANR/2026"},
        },
    )
    assert update_res.status_code == 200
    assert update_res.json()["source_type"] == "onedrive"

    # 2. Test Ingestion Probe
    probe_res = client.post("/api/clients/anr_group/ingestion/test")
    assert probe_res.status_code == 200
    assert probe_res.json()["success"] is True


def test_staged_transactions_and_batch_approval():
    """Verify querying staged transactions and batch approving them."""
    from app.db.session import get_engine
    from sqlmodel import Session
    from app.models.db_models import StagedTransaction

    with Session(get_engine()) as session:
        st = StagedTransaction(
            client_id="anr_group",
            batch_id="batch_anr_test_01",
            pipeline_id="pipe_ar_slips",
            pipeline_name="Daily Laundry Slips",
            pipeline_type="AR",
            entity_type="ar_sales_invoice",
            transaction_date="2026-08-15",
            source_type="google_drive",
            source_file_name="slip_001.jpg",
            item_or_description="Linen Laundry Service",
            total_amount=150.0,
            status="PENDING",
        )
        session.add(st)
        session.commit()

    # 1. List Staged Transactions
    list_res = client.get("/api/clients/anr_group/transactions")
    assert list_res.status_code == 200
    txs = list_res.json()
    assert len(txs) >= 1

    tx_id = txs[0]["id"]

    # 2. Batch Approve
    approve_res = client.post(
        "/api/clients/anr_group/transactions/batch-approve",
        json={"transaction_ids": [tx_id], "notes": "CPA Verified"},
    )
    assert approve_res.status_code == 200
    assert approve_res.json()["approved_count"] == 1


def test_alias_and_date_filtering_for_anr_group():
    """Verify transactions stored as commercial_laundry are returned when querying anr_group for September 2026."""
    from app.db.session import get_engine
    from sqlmodel import Session
    from app.models.db_models import StagedTransaction

    with Session(get_engine()) as session:
        st = StagedTransaction(
            client_id="commercial_laundry",
            batch_id="batch_commercial_laundry_sep_2026_abc123",
            pipeline_id="pipe_daily_slips",
            pipeline_name="Daily Control Slips OCR",
            pipeline_type="AR",
            entity_type="ar_sales_invoice",
            transaction_date="2026-09-01",
            source_type="google_drive",
            source_file_name="Embassy Gardens 01-09-2026.jpg",
            item_or_description="Bed Sheet Large",
            quantity_or_debit=10.0,
            credit_amount=10.0,
            rate_or_price=15.0,
            total_amount=150.0,
            status="PENDING",
        )
        session.add(st)
        session.commit()

    # 1. Query anr_group for September 2026 - Daily Transactions
    list_res = client.get("/api/clients/anr_group/transactions?month=September&year=2026&pipeline_type=AR")
    assert list_res.status_code == 200
    txs = list_res.json()
    assert len(txs) >= 1
    assert any(t["item_or_description"] == "Bed Sheet Large" for t in txs)

    # 2. Query anr_group for September 2026 - Summary Aggregation
    summary_res = client.get("/api/clients/anr_group/transactions/summary?month=September&year=2026&pipeline_type=AR")
    assert summary_res.status_code == 200
    summary_data = summary_res.json()
    assert summary_data["total_transactions"] >= 1
    assert len(summary_data["summary"]) >= 1
    assert any(r["item_name"] == "Bed Sheet Large" for r in summary_data["summary"])
