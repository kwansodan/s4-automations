"""Tests for FastAPI endpoints."""

import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health_check_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "anr-commercial-laundry-billing"
    assert "integrations" in data


def test_dashboard_ui_endpoint():
    response = client.get("/")
    assert response.status_code == 200
    assert "S4 Automations" in response.text or "ANR Laundry Billing" in response.text



def test_zoho_catalog_endpoint():
    response = client.get("/api/catalog")
    assert response.status_code == 200
    data = response.json()
    assert data["contacts_count"] > 0
    assert data["items_count"] > 0


from unittest.mock import patch, AsyncMock


def test_trigger_pipeline_endpoint():
    with patch("app.main.inngest_client.send", new_callable=AsyncMock) as mock_send:
        mock_send.return_value = ["event_id_123"]
        response = client.post("/api/pipeline/trigger", json={"month": "August", "year": 2026})
        assert response.status_code == 200
        data = response.json()
        assert data["status"] in ["QUEUED", "PROCESSING"]
        mock_send.assert_awaited_once()


def test_trigger_invoice_generation_endpoint():
    with patch("app.main.inngest_client.send", new_callable=AsyncMock) as mock_send:
        mock_send.return_value = ["event_id_456"]
        response = client.post("/api/invoices/generate", json={"month": "August", "year": 2026})
        assert response.status_code == 200
        data = response.json()
        assert data["status"] in ["QUEUED", "PROCESSING"]
        mock_send.assert_awaited_once()


def test_get_and_update_config_endpoint():
    # 1. GET config
    get_res = client.get("/api/config")
    assert get_res.status_code == 200
    cfg_data = get_res.json()["config"]
    assert "GEMINI_MODEL" in cfg_data
    assert "ZOHO_ORG_ID" in cfg_data

    # 2. POST config
    post_res = client.post("/api/config", json={
        "NOTIFICATION_EMAIL": "test_billing@service4gh.com",
        "persist_to_file": False,
    })
    assert post_res.status_code == 200
    assert post_res.json()["config"]["NOTIFICATION_EMAIL"] == "test_billing@service4gh.com"


def test_config_connections_endpoint():
    res = client.post("/api/config/test")
    assert res.status_code == 200
    data = res.json()
    assert "gemini_status" in data
    assert "zoho_status" in data
    assert "google_status" in data


def test_sheets_review_data_endpoint():
    res = client.get("/api/sheets/data?month=August&year=2026")
    assert res.status_code == 200
    data = res.json()
    assert "daily_details" in data
    assert "monthly_summary" in data
    assert len(data["monthly_summary"]) > 0


def test_toggle_sheet_approval_endpoint():
    res = client.post("/api/sheets/toggle-approval", json={
        "row_index": 2,
        "field": "approved",
        "value": True,
    })
    assert res.status_code == 200
    assert res.json()["status"] == "SUCCESS"


def test_dashboard_stats_endpoint():
    res = client.get("/api/stats")
    assert res.status_code == 200
    data = res.json()
    assert data["total_slips_ingested"] >= 0
    assert data["approved_billing_total_ghs"] >= 0


def test_pipeline_status_endpoint():
    res = client.get("/api/pipeline/status")
    assert res.status_code == 200
    data = res.json()
    assert "status" in data
    assert "percent" in data
    assert "current_step" in data
    assert "stats" in data
    assert "recent_logs" in data


def test_auth_otp_endpoints_flow():
    # 1. Request OTP for authorized email
    res1 = client.post("/api/auth/otp/request", json={"email": "s4bookkeeping@service4gh.com"})
    assert res1.status_code == 200
    assert res1.json()["success"] is True

    # 2. Extract active code from dev_hint
    dev_hint = res1.json().get("dev_hint")
    assert dev_hint is not None
    active_code = dev_hint.split("Code logged to server: ")[1].strip()

    # 3. Verify OTP
    res2 = client.post("/api/auth/otp/verify", json={
        "email": "s4bookkeeping@service4gh.com",
        "otp": active_code,
    })
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["status"] == "AUTHENTICATED"
    assert "access_token" in data2
    token = data2["access_token"]

    # 4. Check /api/auth/me with Bearer token
    res3 = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert res3.status_code == 200
    assert res3.json()["authenticated"] is True
    assert res3.json()["user"]["email"] == "s4bookkeeping@service4gh.com"



