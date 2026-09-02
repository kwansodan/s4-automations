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
