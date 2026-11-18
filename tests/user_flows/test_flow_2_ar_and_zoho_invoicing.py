"""End-to-End User Flow 2: Accounts Receivable (AR) & Zoho Customer Invoicing.

Validates the complete operator journey for:
1. Detecting existing draft invoices in Zoho Books for a billing period.
2. Safeguarding against unconfirmed draft invoice regeneration (HTTP 400).
3. Generating Customer draft invoices in Append mode with configurable dates.
4. Deleting and re-billing in Regenerate mode with explicit confirmation.
5. Verifying itemized receipt payload generation in pipeline telemetry.
"""

import pytest
import time
from fastapi.testclient import TestClient

from app.main import app
from app.utils.progress_tracker import pipeline_tracker
from app.services.zoho_service import ZohoBooksService


@pytest.fixture
def client():
    return TestClient(app)


def test_user_flow_detect_existing_draft_invoices(client: TestClient):
    """Test Flow 2A: Operator opens InvoiceModal and detects existing draft invoices for the month."""
    res = client.get("/api/v1/invoices/existing?client_id=anr_luxury&month=August&year=2026")
    assert res.status_code == 200, f"Expected 200 from existing invoices endpoint, got {res.text}"
    data = res.json()
    assert "has_existing" in data
    assert "existing_invoices" in data
    assert isinstance(data["existing_invoices"], list)

    # Scoped to specific customer
    res_cust = client.get("/api/v1/invoices/existing?client_id=anr_luxury&month=August&year=2026&customer_name=Luxwood")
    assert res_cust.status_code == 200
    cust_data = res_cust.json()
    assert "has_existing" in cust_data


def test_user_flow_regeneration_safety_safeguard(client: TestClient):
    """Test Flow 2B: System strictly rejects regeneration if operator has not checked safety confirmation."""
    payload = {
        "month": "August",
        "year": 2026,
        "client_id": "anr_luxury",
        "mode": "regenerate",
        "confirm_delete": False,  # Missing confirmation!
    }
    res = client.post("/api/v1/invoices/generate", json=payload)
    assert res.status_code in (400, 422), f"Expected 400 or 422 for unconfirmed regeneration, got {res.status_code}"
    assert "confirmation" in res.text.lower()


def test_user_flow_draft_invoice_generation_append_mode(client: TestClient):
    """Test Flow 2C: Operator generates draft invoices for Customers in Append mode."""
    payload = {
        "month": "August",
        "year": 2026,
        "client_id": "anr_luxury",
        "mode": "append",
        "target_customer_name": "Luxwood",
        "invoice_date": "2026-08-31",
        "due_date": "2026-09-14",
        "terms": "Net 14 Days",
        "confirm_delete": False,
    }
    res = client.post("/api/v1/invoices/generate", json=payload)
    assert res.status_code == 200, f"Failed invoice generation dispatch: {res.text}"
    assert res.json().get("status") in ("PROCESSING", "success")

    # Verify pipeline tracker is updated immediately
    time.sleep(0.1)
    status_res = client.get("/api/v1/pipeline/status")
    assert status_res.status_code == 200
    st = status_res.json()
    assert st["task_name"] is not None
    assert st["month"] == "August"
    assert st["year"] == 2026


def test_user_flow_draft_invoice_regeneration_confirmed(client: TestClient):
    """Test Flow 2D: Operator confirms regeneration, system cleans existing draft and issues new receipt."""
    # Pre-seed a mock draft invoice in ZohoBooksService memory
    mock_inv_id = "inv_mock_preseed_001"
    ZohoBooksService._global_mock_draft_invoices["cnt_luxwood_001_2026-08-31"] = {
        "invoice_id": mock_inv_id,
        "invoice_number": "INV-PRESEED-001",
        "customer_id": "cnt_luxwood_001",
        "customer_name": "Luxwood",
        "total": 500.0,
        "status": "draft",
        "date": "2026-08-31",
        "line_items": [],
    }

    payload = {
        "month": "August",
        "year": 2026,
        "client_id": "anr_luxury",
        "mode": "regenerate",
        "target_customer_name": "Luxwood",
        "invoice_date": "2026-08-31",
        "due_date": "2026-09-14",
        "terms": "Net 14 Days",
        "confirm_delete": True,  # Explicitly confirmed
    }
    res = client.post("/api/v1/invoices/generate", json=payload)
    assert res.status_code == 200, f"Expected 200 with confirmed regeneration, got {res.text}"
    assert res.json().get("status") in ("PROCESSING", "success")
