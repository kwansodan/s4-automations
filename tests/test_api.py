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
    assert "ANR Laundry Billing Engine" in response.text


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
        assert data["status"] == "QUEUED"
        mock_send.assert_awaited_once()


def test_trigger_invoice_generation_endpoint():
    with patch("app.main.inngest_client.send", new_callable=AsyncMock) as mock_send:
        mock_send.return_value = ["event_id_456"]
        response = client.post("/api/invoices/generate", json={"month": "August", "year": 2026})
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "QUEUED"
        mock_send.assert_awaited_once()

