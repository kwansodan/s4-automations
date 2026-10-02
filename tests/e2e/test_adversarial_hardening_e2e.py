"""
Tier 5 E2E Tests: Adversarial Hardening, Boundary Stress, and Encoding Integrity.

Adversarial edge cases covering:
- Encoding & Escaping Integrity: special chars, HTML tags, SQL injection strings, unicode
- Invalid Input Combinations: invalid mode strings, missing confirmation flags
- Boundary Stress: leap years, centurial dates, 0 transactions, large numbers, idempotency
"""

import calendar
import datetime
import pytest
from typing import Dict, Any
from tests.e2e.conftest import execute_invoicing_workflow
from app.db.session import get_engine
from app.models.db_models import StagedTransaction, ClientOrganization
from app.services.zoho_service import ZohoBooksService
from sqlmodel import Session, select


# ---------------------------------------------------------------------------
# Adversarial 1: Encoding and Escaping Integrity in Terms and Customer Names
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_adversarial_terms_injection_and_escaping(seed_commercial_laundry_data: Dict[str, Any]):
    """Terms string containing SQL injection patterns, script tags, and unicode."""
    adversarial_terms = "'; DROP TABLE invoices; <script>alert('xss')</script> & GHS ₵ 500"
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        mode="append",
        terms=adversarial_terms,
    )
    assert res["status"] == "COMPLETED"
    for inv in res["invoices_created"]:
        assert inv["terms"] == adversarial_terms or adversarial_terms in inv.get("notes", "")


@pytest.mark.asyncio
async def test_adversarial_customer_name_special_characters():
    """Customer name containing ampersands, single quotes, and brackets."""
    with Session(get_engine()) as session:
        # Create special customer staged transaction
        tx = StagedTransaction(
            id=777,
            client_id="commercial_laundry_tenant",
            batch_id="batch_special_001",
            source_file_name="special_slip.jpg",
            transaction_date="2026-08-14T00:00:00Z",
            item_or_description="Hand Towel",
            quantity_or_debit=10.0,
            credit_amount=10.0,
            rate_or_price=15.00,
            total_amount=150.00,
            approved=True,
            status="APPROVED",
            metadata_json={
                "customer_name": "O'Connor & Sons (GH) Ltd.",
                "zoho_contact_id": "cnt_oconnor_777",
                "zoho_item_id": "item_towel_hand",
            },
        )
        session.add(tx)
        session.commit()

    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        mode="append",
        target_customer_name="O'Connor & Sons (GH) Ltd.",
    )
    assert res["status"] == "COMPLETED"
    assert res["invoices_count"] == 1
    assert res["invoices_created"][0]["customer_name"] == "O'Connor & Sons (GH) Ltd."


# ---------------------------------------------------------------------------
# Adversarial 2: Invalid Input Combinations and Safety Flags
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_adversarial_regeneration_without_confirmation_safeguard(seed_commercial_laundry_data: Dict[str, Any]):
    """mode='regenerate' without confirm_delete flag must reject execution."""
    with pytest.raises(ValueError, match="Regeneration mode requires explicit confirmation"):
        await execute_invoicing_workflow(
            month="August",
            year=2026,
            client_id="commercial_laundry_tenant",
            mode="regenerate",
            confirm_delete=False,
        )


@pytest.mark.asyncio
async def test_adversarial_unrecognized_month_name():
    """Malformed month name string falls back safely to current month without crashing."""
    res = await execute_invoicing_workflow(
        month="NotARealMonth123",
        year=2026,
        client_id="commercial_laundry_tenant",
        mode="append",
        target_customer_name="NonexistentCustomer",
    )
    assert res["status"] == "NO_APPROVED_ROWS"
    assert res["invoices_created"] == []


# ---------------------------------------------------------------------------
# Adversarial 3: Boundary Stress, Leap Years, and Centurial Calendars
# ---------------------------------------------------------------------------

def test_adversarial_leap_year_february_2096():
    """Calendar boundary: Far future leap year 2096 has 29 days in February."""
    days = calendar.monthrange(2096, 2)[1]
    assert days == 29


def test_adversarial_centurial_non_leap_year_2100():
    """Calendar boundary: Centurial non-leap year 2100 has 28 days in February."""
    days = calendar.monthrange(2100, 2)[1]
    assert days == 28


def test_adversarial_centurial_leap_year_2000():
    """Calendar boundary: Centurial 400-year leap year 2000 has 29 days in February."""
    days = calendar.monthrange(2000, 2)[1]
    assert days == 29


@pytest.mark.asyncio
async def test_adversarial_zero_approved_transactions_returns_no_rows():
    """Invoicing for an empty month with 0 transactions returns clean NO_APPROVED_ROWS status."""
    res = await execute_invoicing_workflow(
        month="January",
        year=2020,
        client_id="commercial_laundry_tenant",
        mode="append",
        target_customer_name=None,
    )
    assert res["status"] == "NO_APPROVED_ROWS"
    assert res["invoices_created"] == []


@pytest.mark.asyncio
async def test_adversarial_high_volume_line_item_amounts():
    """Large transaction quantity (100,000 units) calculates correctly without overflow."""
    with Session(get_engine()) as session:
        large_tx = StagedTransaction(
            id=888,
            client_id="commercial_laundry_tenant",
            batch_id="batch_large_001",
            source_file_name="large_volume_slip.jpg",
            transaction_date="2026-08-20T00:00:00Z",
            item_or_description="Face Cloth Bulk",
            quantity_or_debit=100000.0,
            credit_amount=100000.0,
            rate_or_price=1.25,
            total_amount=125000.00,
            approved=True,
            status="APPROVED",
            metadata_json={
                "customer_name": "Mega Resort Ghana",
                "zoho_contact_id": "cnt_mega_888",
                "zoho_item_id": "item_cloth_face",
            },
        )
        session.add(large_tx)
        session.commit()

    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        mode="append",
        target_customer_name="Mega Resort Ghana",
    )
    assert res["status"] == "COMPLETED"
    assert res["invoices_count"] == 1
    assert res["invoices_created"][0]["total"] == 125000.00


@pytest.mark.asyncio
async def test_adversarial_rapid_sequential_invocations(seed_commercial_laundry_data: Dict[str, Any]):
    """Multiple sequential workflow invocations execute cleanly without state corruption."""
    res1 = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        mode="append",
        target_customer_name="Labadi Beach Hotel",
    )
    assert res1["status"] == "COMPLETED"

    # Second invocation with Luxwood Hotel immediately follows
    res2 = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        mode="append",
        target_customer_name="Luxwood Hotel",
    )
    assert res2["status"] == "COMPLETED"
    assert res2["invoices_created"][0]["customer_name"] == "Luxwood Hotel"
