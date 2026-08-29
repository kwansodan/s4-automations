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
        "/api/clients/polaris/ingestion",
        json={
            "source_type": "onedrive",
            "source_config": {"tenant_id": "test-tenant", "folder_path": "/Polaris/2026"},
        },
    )
    assert update_res.status_code == 200
    assert update_res.json()["source_type"] == "onedrive"

    # 2. Test Ingestion Probe
    probe_res = client.post("/api/clients/polaris/ingestion/test")
    assert probe_res.status_code == 200
    assert probe_res.json()["success"] is True


def test_staged_transactions_and_batch_approval():
    """Verify querying staged transactions and batch approving them."""
    # 1. Trigger Polaris run to stage transactions
    run_res = client.post("/api/clients/polaris/run", json={"month": "August", "year": 2026})
    assert run_res.status_code == 200

    # 2. List Staged Transactions
    list_res = client.get("/api/clients/polaris/transactions")
    assert list_res.status_code == 200
    txs = list_res.json()
    assert len(txs) >= 1

    tx_id = txs[0]["id"]

    # 3. Batch Approve
    approve_res = client.post(
        "/api/clients/polaris/transactions/batch-approve",
        json={"transaction_ids": [tx_id], "notes": "CPA Verified"},
    )
    assert approve_res.status_code == 200
    assert approve_res.json()["approved_count"] == 1
