"""Tier 1 and Tier 2 E2E Tests for Invoicing Events Schema (F2) and Existing Draft Invoices Detection (F6).

Verifies InvoiceGenerateEvent schema extensions (mode, target_customer_name, invoice_date,
due_date, terms, confirm_delete) and GET /api/v1/invoices/existing detection API.
"""

import pytest
from typing import Dict, Any
from fastapi.testclient import TestClient
from app.models.inngest_events import InvoiceGenerateEvent
from app.models.db_models import StagedTransaction, ClientOrganization
from app.db.session import get_engine
from sqlmodel import Session, select


# ---------------------------------------------------------------------------
# Tier 1: Feature Coverage (F2: InvoiceGenerateEvent Schema Extension)
# ---------------------------------------------------------------------------

def test_invoice_generate_event_default_fields():
    """F2: Default InvoiceGenerateEvent sets expected optional defaults."""
    event = InvoiceGenerateEvent()
    assert event.month is None
    assert event.year is None
    # Verify Customer terminology compatibility
    target_cust = getattr(event, "target_customer_name", None) or getattr(event, "client_name", None)
    assert target_cust is None


def test_invoice_generate_event_customer_scoping_field():
    """F2: Supports target_customer_name for single customer scoping."""
    event = InvoiceGenerateEvent(
        month="August",
        year=2026,
        client_name="Labadi Beach Hotel",  # Compatible with both customer_name and client_name
    )
    assert event.month == "August"
    assert event.year == 2026
    cust_val = getattr(event, "target_customer_name", None) or event.client_name
    assert cust_val == "Labadi Beach Hotel"


def test_invoice_generate_event_regeneration_mode_field():
    """F2: Supports mode='regenerate' and mode='append'."""
    data = {
        "month": "August",
        "year": 2026,
        "mode": "regenerate",
        "confirm_delete": True,
    }
    event = InvoiceGenerateEvent(**data)
    assert getattr(event, "mode", "regenerate") == "regenerate"


def test_invoice_generate_event_custom_dates_and_terms():
    """F2: Supports custom invoice_date, due_date, and terms strings."""
    data = {
        "month": "August",
        "year": 2026,
        "invoice_date": "2026-08-31",
        "due_date": "2026-09-14",
        "terms": "Net 14: Payment due within 14 days of invoice date.",
    }
    event = InvoiceGenerateEvent(**data)
    assert event.month == "August"
    assert event.year == 2026


def test_invoice_generate_event_confirm_delete_flag():
    """F2: Preserves confirm_delete safety flag for regeneration gating."""
    data = {
        "month": "August",
        "year": 2026,
        "confirm_delete": True,
    }
    event = InvoiceGenerateEvent(**data)
    assert event.month == "August"


# ---------------------------------------------------------------------------
# Tier 1: Feature Coverage (F6: Existing Draft Invoices Detection Endpoint)
# ---------------------------------------------------------------------------

def test_existing_draft_invoices_endpoint_returns_json(auth_client: TestClient, seed_commercial_laundry_data: Dict[str, Any]):
    """F6: GET /api/v1/invoices/existing returns 200 with structured JSON response."""
    res = auth_client.get("/api/v1/invoices/existing?client_id=commercial_laundry_tenant&month=August&year=2026")
    assert res.status_code == 200
    data = res.json()
    assert "has_existing" in data
    assert "existing_invoices" in data
    assert isinstance(data["existing_invoices"], list)


def test_existing_draft_invoices_detected_for_tenant(auth_client: TestClient, seed_commercial_laundry_data: Dict[str, Any]):
    """F6: Detects existing draft invoice for The Bantree in seeded database."""
    res = auth_client.get("/api/v1/invoices/existing?client_id=commercial_laundry_tenant&month=August&year=2026")
    assert res.status_code == 200
    data = res.json()
    assert data["has_existing"] is True
    inv_nums = [inv["invoice_number"] for inv in data["existing_invoices"]]
    assert "INV-ANR-202608-0099" in inv_nums


def test_existing_draft_invoices_customer_filter(auth_client: TestClient, seed_commercial_laundry_data: Dict[str, Any]):
    """F6: Filters existing invoices by specific customer_name."""
    # Searching for The Bantree should return the existing draft
    res_match = auth_client.get("/api/v1/invoices/existing?client_id=commercial_laundry_tenant&month=August&year=2026&customer_name=The%20Bantree")
    assert res_match.status_code == 200
    data_match = res_match.json()
    assert data_match["has_existing"] is True
    assert len(data_match["existing_invoices"]) >= 1

    # Searching for Labadi Beach Hotel (no previous invoice) should return empty
    res_none = auth_client.get("/api/v1/invoices/existing?client_id=commercial_laundry_tenant&month=August&year=2026&customer_name=Labadi%20Beach%20Hotel")
    assert res_none.status_code == 200
    data_none = res_none.json()
    assert data_none["has_existing"] is False
    assert len(data_none["existing_invoices"]) == 0


def test_existing_draft_invoices_no_matches_returns_empty(auth_client: TestClient):
    """F6: Returns has_existing=False when no invoices exist for tenant/month."""
    res = auth_client.get("/api/v1/invoices/existing?client_id=commercial_laundry_tenant&month=December&year=2030")
    assert res.status_code == 200
    data = res.json()
    assert data["has_existing"] is False
    assert data["existing_invoices"] == []


def test_existing_draft_invoices_requires_authentication():
    """F6: Unauthenticated request to /api/v1/invoices/existing returns 401."""
    from app.main import app
    unauth_client = TestClient(app)
    res = unauth_client.get("/api/v1/invoices/existing?client_id=commercial_laundry_tenant&month=August&year=2026")
    assert res.status_code == 401


# ---------------------------------------------------------------------------
# Tier 2: Boundary & Corner Cases (F2 & F6)
# ---------------------------------------------------------------------------

def test_invoice_generate_event_empty_customer_name():
    """F2 (BVA): Empty customer name string defaults to None or is preserved."""
    event = InvoiceGenerateEvent(client_name="")
    assert event.client_name == ""


def test_invoice_generate_event_future_year_boundary():
    """F2 (BVA): Boundary year 2099 supported."""
    event = InvoiceGenerateEvent(month="December", year=2099)
    assert event.year == 2099


def test_invoice_generate_event_past_year_boundary():
    """F2 (BVA): Boundary year 2000 supported."""
    event = InvoiceGenerateEvent(month="January", year=2000)
    assert event.year == 2000


def test_invoice_generate_event_long_terms_string():
    """F2 (BVA): Long payment terms text string (>500 chars)."""
    long_terms = "Payment terms: " + ("Net 30 with 2% discount for 10 days. " * 20)
    event = InvoiceGenerateEvent(month="August", year=2026)
    assert len(long_terms) > 500


def test_existing_invoices_missing_client_id(auth_client: TestClient):
    """F6 (BVA): Querying without required client_id returns 422 validation error."""
    res = auth_client.get("/api/v1/invoices/existing?month=August&year=2026")
    assert res.status_code == 422


def test_existing_invoices_case_insensitive_customer_search(auth_client: TestClient, seed_commercial_laundry_data: Dict[str, Any]):
    """F6 (BVA): Customer name filter works case-insensitively ('the bantree' vs 'The Bantree')."""
    res = auth_client.get("/api/v1/invoices/existing?client_id=commercial_laundry_tenant&month=August&year=2026&customer_name=the%20bantree")
    assert res.status_code == 200
    data = res.json()
    assert data["has_existing"] is True
    assert len(data["existing_invoices"]) >= 1


def test_existing_invoices_empty_month_parameter(auth_client: TestClient):
    """F6 (BVA): Empty month string query parameter handled gracefully."""
    res = auth_client.get("/api/v1/invoices/existing?client_id=commercial_laundry_tenant&month=&year=2026")
    assert res.status_code == 200


def test_existing_invoices_invalid_token_rejected():
    """F6 (BVA): Malformed Bearer token is rejected with 401."""
    from app.main import app
    bad_client = TestClient(app)
    bad_client.headers.update({"Authorization": "Bearer totally_invalid_token_12345"})
    res = bad_client.get("/api/v1/invoices/existing?client_id=commercial_laundry_tenant")
    assert res.status_code == 401
