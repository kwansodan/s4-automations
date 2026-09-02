"""Tests for Client Management and Audit Trail API Endpoints."""

import time
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.db.session import init_db

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_db():
    init_db()


def test_list_clients_endpoint():
    """Test GET /api/clients returns all registered clients."""
    res = client.get("/api/clients")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    assert len(data) >= 2
    client_ids = [c["id"] for c in data]
    assert "anr_group" in client_ids
    assert "mr_osei" in client_ids


def test_create_and_get_client_endpoint():
    """Test POST /api/clients creates a new client and GET retrieves it."""
    unique_suffix = int(time.time() * 1000)
    org_name = f"Kwan Corp {unique_suffix}"
    payload = {
        "name": org_name,
        "industry": "Real Estate Investment",
        "icon": "🏗️",
        "status": "dev",
        "source_type": "email",
        "source_email": f"invoices_{unique_suffix}@kwanre.com",
    }
    create_res = client.post("/api/clients", json=payload)
    assert create_res.status_code == 200
    created = create_res.json()
    assert created["name"] == org_name
    assert created["source_type"] == "email"

    # Get by ID
    get_res = client.get(f"/api/clients/{created['id']}")
    assert get_res.status_code == 200
    assert get_res.json()["name"] == org_name


def test_trigger_client_strategy_endpoint():
    """Test POST /api/clients/{client_id}/run triggers client strategy."""
    res = client.post("/api/clients/anr_group/run", json={"month": "August", "year": 2026})
    assert res.status_code == 200
    data = res.json()
    assert data["client_id"] == "anr_group"
    assert data["status"] == "COMPLETED"


def test_audit_logs_endpoint():
    """Test GET /api/audit returns historical audit trail."""
    res = client.get("/api/audit?limit=20")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    assert len(data) >= 1
