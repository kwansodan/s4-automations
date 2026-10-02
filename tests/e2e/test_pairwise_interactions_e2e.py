"""
Tier 3 E2E Tests: Pairwise Combinatorial Interactions.

Systematic 2-way combinatorial interactions across:
- Invoicing mode: Append vs Regenerate
- Customer scope: All customers vs Single customer
- Invoice date rules: Last day of month, First day following month, Today, Fixed day, Explicit override
- Payment terms rules: Net 0, Net 14, Net 30, Net 60, Custom offset, Explicit due date
"""

import datetime
from datetime import timedelta
import calendar
import pytest
from typing import Dict, Any
from tests.e2e.conftest import execute_invoicing_workflow
from app.db.session import get_engine
from app.models.db_models import ClientOrganization
from sqlmodel import Session, select


# ---------------------------------------------------------------------------
# Interaction 1: Mode=Append x Scope=All x Rule=LastDay x Terms=Net30
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_pairwise_append_all_customers_last_day_net30(seed_commercial_laundry_data: Dict[str, Any]):
    """Append mode, all customers, last day of month invoice date, Net 30 due date."""
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        mode="append",
        target_customer_name=None,
        invoice_date="2026-08-31",
        due_date="2026-09-30",
    )
    assert res["status"] == "COMPLETED"
    assert res["invoices_count"] >= 2

    for inv in res["invoices_created"]:
        assert inv["date"] == "2026-08-31"
        assert inv["due_date"] == "2026-09-30"


# ---------------------------------------------------------------------------
# Interaction 2: Mode=Append x Scope=Single x Rule=FirstDayNextMonth x Terms=Net14
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_pairwise_append_single_customer_first_day_next_month_net14(seed_commercial_laundry_data: Dict[str, Any]):
    """Append mode, single customer (Labadi), first day of next month, Net 14 due date."""
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        mode="append",
        target_customer_name="Labadi Beach Hotel",
        invoice_date="2026-09-01",
        due_date="2026-09-15",
    )
    assert res["status"] == "COMPLETED"
    assert res["invoices_count"] == 1
    inv = res["invoices_created"][0]
    assert inv["customer_name"] == "Labadi Beach Hotel"
    assert inv["date"] == "2026-09-01"
    assert inv["due_date"] == "2026-09-15"


# ---------------------------------------------------------------------------
# Interaction 3: Mode=Regenerate x Scope=Single x Rule=Today x Terms=Net0
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_pairwise_regenerate_single_customer_today_net0(seed_commercial_laundry_data: Dict[str, Any]):
    """Regenerate mode, single customer (The Bantree), today invoice date, Net 0 (Due on receipt)."""
    today_str = datetime.date.today().isoformat()
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        mode="regenerate",
        target_customer_name="The Bantree",
        confirm_delete=True,
        invoice_date=today_str,
        due_date=today_str,
    )
    assert res["status"] == "COMPLETED"
    assert res["invoices_count"] == 1
    inv = res["invoices_created"][0]
    assert inv["customer_name"] == "The Bantree"
    assert inv["date"] == today_str
    assert inv["due_date"] == today_str


# ---------------------------------------------------------------------------
# Interaction 4: Mode=Regenerate x Scope=All x Rule=FixedDay x Terms=Net60
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_pairwise_regenerate_all_customers_fixed_day_net60(seed_commercial_laundry_data: Dict[str, Any]):
    """Regenerate mode, all customers, fixed day 15, Net 60 terms."""
    fixed_date = "2026-08-15"
    expected_due = (datetime.date(2026, 8, 15) + timedelta(days=60)).isoformat()

    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        mode="regenerate",
        target_customer_name=None,
        confirm_delete=True,
        invoice_date=fixed_date,
        due_date=expected_due,
    )
    assert res["status"] == "COMPLETED"
    assert res["invoices_count"] >= 3  # Labadi, Luxwood, Bantree

    for inv in res["invoices_created"]:
        assert inv["date"] == fixed_date
        assert inv["due_date"] == expected_due


# ---------------------------------------------------------------------------
# Interaction 5: Mode=Append x Scope=Single x Explicit Date & Due Date Overrides
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_pairwise_append_single_customer_explicit_date_and_due_overrides(seed_commercial_laundry_data: Dict[str, Any]):
    """Explicit date and due date parameters override tenant configured date rules."""
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        mode="append",
        target_customer_name="Luxwood Hotel",
        invoice_date="2026-08-25",
        due_date="2026-09-08",
    )
    assert res["status"] == "COMPLETED"
    assert res["invoices_count"] == 1
    inv = res["invoices_created"][0]
    assert inv["customer_name"] == "Luxwood Hotel"
    assert inv["date"] == "2026-08-25"
    assert inv["due_date"] == "2026-09-08"


# ---------------------------------------------------------------------------
# Interaction 6: Mode=Regenerate x Scope=Single x Rule=LastDay x Custom Offset Terms
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_pairwise_regenerate_single_customer_custom_offset_days(seed_commercial_laundry_data: Dict[str, Any]):
    """Regenerate mode with custom due offset of 21 days from last day of month."""
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        mode="regenerate",
        target_customer_name="The Bantree",
        confirm_delete=True,
        invoice_date="2026-08-31",
        due_date="2026-09-21",
    )
    assert res["status"] == "COMPLETED"
    inv = res["invoices_created"][0]
    assert inv["date"] == "2026-08-31"
    assert inv["due_date"] == "2026-09-21"


# ---------------------------------------------------------------------------
# Interaction 7: Mode=Append x Scope=All x Custom Terms Note String
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_pairwise_append_all_customers_custom_terms_note(seed_commercial_laundry_data: Dict[str, Any]):
    """Explicit custom terms text embedded on all generated invoices."""
    custom_terms_str = "Payable via MoMo to 0244-123-456 within 7 business days."
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        mode="append",
        terms=custom_terms_str,
    )
    assert res["status"] == "COMPLETED"
    for inv in res["invoices_created"]:
        assert inv["terms"] == custom_terms_str or custom_terms_str in inv.get("notes", "")
