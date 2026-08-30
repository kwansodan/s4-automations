"""Tests for Client Setup Wizard API Endpoints."""

import time
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.models.db_models import ClientOrganization
from sqlmodel import Session, select
from app.db.session import engine


@pytest.fixture
def client():
    return TestClient(app)


def test_probe_external_google_drive(client):
    """Test live probing Google Drive folder access."""
    payload = {
        "source_type": "google_drive",
        "folder_id": "1Uu_test_folder_12345",
        "zoho_org_id": "782910482",
        "zoho_contact_id": "contact_9921",
    }
    response = client.post("/api/clients/probe-external", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "checks" in data
    assert data["source_type"] == "google_drive"
    assert any(c["target"] == "Google Drive Folder" for c in data["checks"])
    assert any("Zoho Books Org" in c["target"] for c in data["checks"])


def test_probe_external_onedrive(client):
    """Test probing OneDrive credentials."""
    payload = {
        "source_type": "onedrive",
        "source_config": {
            "client_id": "azure-client-id-123",
            "tenant_id": "azure-tenant-id-456",
            "drive_id": "drive_abc",
        }
    }
    response = client.post("/api/clients/probe-external", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "CONNECTED"


def test_probe_external_email(client):
    """Test probing inbound email configuration."""
    payload = {
        "source_type": "email",
        "source_email": "apex_logistics@inbound.service4gh.com",
    }
    response = client.post("/api/clients/probe-external", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "CONNECTED"


def test_dry_run_sample_ocr_laundry(client):
    """Test sample dry-run extraction for commercial laundry slip."""
    payload = {
        "engine_type": "gemini_flash_vision",
        "sample_preset": "laundry_slip",
    }
    response = client.post("/api/clients/dry-run-ocr", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert len(data["items"]) >= 2
    assert data["ready_for_review_sheets"] is True
    assert data["total_value"] > 0


def test_dry_run_sample_ocr_bank_statement(client):
    """Test sample dry-run extraction for corporate bank statement."""
    payload = {
        "engine_type": "pdf_bank_parser",
        "sample_preset": "bank_statement",
    }
    response = client.post("/api/clients/dry-run-ocr", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert data["overall_confidence"] >= 0.95


def test_create_client_with_wizard_payload(client):
    """Test creating a new client with full wizard specifications."""
    unique_suffix = int(time.time() * 1000)
    client_name = f"Zenith Fleet {unique_suffix}"
    payload = {
        "name": client_name,
        "industry": "Transport & Fleet Logistics",
        "icon": "🚛",
        "status": "dev",
        "description": "Automated fuel invoice & trip log extraction pipeline.",
        "source_type": "google_drive",
        "folder_id": "1Zenith_Fleet_Folder_XYZ",
        "zoho_org_id": "9918231",
        "zoho_contact_id": "cust_zenith_10",
        "source_config": {"auto_archive": True, "scan_subfolders": True},
        "custom_config": {"currency": "GHS", "variance_tolerance": 5.0},
        "active_integrations": ["Google Drive", "Gemini Vision", "Zoho Books", "Inngest"],
        "blueprints": [
            {"title": "Fuel Slip Vision OCR", "desc": "Extract handwritten meter readings and pump totals", "status": "active"},
            {"title": "Trip Discrepancy Reconciliation", "desc": "Cross-check driver log vs fuel pump slip", "status": "in_progress"},
            {"title": "Zoho Books Fuel Expense Posting", "desc": "Post verified fuel expenses", "status": "queued"},
        ],
    }

    response = client.post("/api/clients", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == client_name
    assert len(data["blueprints"]) == 3
    assert "Google Drive" in data["active_integrations"]
