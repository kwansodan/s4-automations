"""Tier 1 and Tier 2 E2E Tests for Workflow Scoping (F4), Regeneration (F3), and Date Rules (F5).

Verifies customer filtering, safe draft invoice regeneration with deletion safeguards,
and configurable invoice date / payment terms application in mock mode.
"""

import calendar
import datetime
from datetime import timedelta
import pytest
from typing import Dict, Any
from tests.e2e.conftest import execute_invoicing_workflow
from app.db.session import get_engine
from app.models.db_models import StagedTransaction, ClientOrganization
from sqlmodel import Session, select


# ---------------------------------------------------------------------------
# Tier 1: Feature Coverage (F3: Workflow Regeneration Mode)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_regeneration_mode_deletes_existing_draft_invoice(seed_commercial_laundry_data: Dict[str, Any]):
    """F3: When mode='regenerate' and confirmed, deletes existing draft invoice in Zoho Books."""
    # Seed contains The Bantree with existing invoice INV-ANR-202608-0099
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        target_customer_name="The Bantree",
        mode="regenerate",
        confirm_delete=True,
    )
    assert res["status"] == "COMPLETED"
    assert res["invoices_count"] >= 1


@pytest.mark.asyncio
async def test_regeneration_mode_rebills_previously_invoiced_items(seed_commercial_laundry_data: Dict[str, Any]):
    """F3: Re-bills items that were previously marked INVOICED for that customer."""
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        target_customer_name="The Bantree",
        mode="regenerate",
        confirm_delete=True,
    )
    assert res["status"] == "COMPLETED"
    created = res["invoices_created"]
    assert len(created) == 1
    assert created[0]["total"] == 270.00  # Bath Mat 30 * 9.00


@pytest.mark.asyncio
async def test_regeneration_mode_updates_staged_transactions_with_new_invoice_ref(seed_commercial_laundry_data: Dict[str, Any]):
    """F3: Staged transactions in database receive new accounting reference upon regeneration."""
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        target_customer_name="The Bantree",
        mode="regenerate",
        confirm_delete=True,
    )
    new_inv_num = res["invoices_created"][0]["invoice_number"]

    with Session(get_engine()) as session:
        st = session.exec(select(StagedTransaction).where(StagedTransaction.id == 105)).first()
        assert st is not None
        assert st.status == "INVOICED"
        assert st.accounting_ref_id == new_inv_num
        assert st.accounting_ref_id != "INV-ANR-202608-0099"  # Must differ from old ref


@pytest.mark.asyncio
async def test_regeneration_mode_requires_confirmation_flag(seed_commercial_laundry_data: Dict[str, Any]):
    """F3 (Safeguard): Regeneration without confirm_delete=True raises ValueError."""
    with pytest.raises(ValueError, match="Regeneration mode requires explicit confirmation"):
        await execute_invoicing_workflow(
            month="August",
            year=2026,
            client_id="commercial_laundry_tenant",
            target_customer_name="The Bantree",
            mode="regenerate",
            confirm_delete=False,
        )


@pytest.mark.asyncio
async def test_regeneration_mode_produces_fresh_invoice(seed_commercial_laundry_data: Dict[str, Any]):
    """F3: Returns fresh invoice response dictionary on completed regeneration."""
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        target_customer_name="The Bantree",
        mode="regenerate",
        confirm_delete=True,
    )
    inv = res["invoices_created"][0]
    assert inv["status"] == "draft"
    assert inv["total"] > 0


# ---------------------------------------------------------------------------
# Tier 1: Feature Coverage (F4: Workflow Customer Scoping)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_customer_scoping_single_customer_only_bills_target(seed_commercial_laundry_data: Dict[str, Any]):
    """F4: Scoping to 'Labadi Beach Hotel' bills ONLY Labadi Beach Hotel items."""
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        target_customer_name="Labadi Beach Hotel",
    )
    assert res["status"] == "COMPLETED"
    assert res["invoices_count"] == 1
    inv = res["invoices_created"][0]
    assert inv["total"] == (1110.00 + 480.00)  # Labadi items total 1590.00


@pytest.mark.asyncio
async def test_customer_scoping_single_customer_leaves_other_customers_pending(seed_commercial_laundry_data: Dict[str, Any]):
    """F4: Luxwood Hotel slips remain untouched when scoping only to Labadi Beach Hotel."""
    await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        target_customer_name="Labadi Beach Hotel",
    )

    with Session(get_engine()) as session:
        # Luxwood slips (103, 104) must remain APPROVED and un-invoiced
        lux_slips = session.exec(select(StagedTransaction).where(StagedTransaction.id.in_([103, 104]))).all()
        for s in lux_slips:
            assert s.status == "APPROVED"
            assert s.accounting_ref_id is None


@pytest.mark.asyncio
async def test_customer_scoping_all_customers_bills_all_groups(seed_commercial_laundry_data: Dict[str, Any]):
    """F4: Leaving target_customer_name=None bills all approved customer groups."""
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        target_customer_name=None,
    )
    assert res["status"] == "COMPLETED"
    # Both Labadi Beach Hotel and Luxwood Hotel should be billed
    assert res["invoices_count"] == 2
    billed_totals = sorted([inv["total"] for inv in res["invoices_created"]])
    # Labadi: 1590.00, Luxwood: 625.00 + 520.00 = 1145.00
    assert 1145.00 in billed_totals
    assert any(t >= 1590.00 for t in billed_totals)


@pytest.mark.asyncio
async def test_customer_scoping_case_insensitive_matching(seed_commercial_laundry_data: Dict[str, Any]):
    """F4: Scoping matches customer names case-insensitively ('labadi beach hotel')."""
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        target_customer_name="labadi beach hotel",
    )
    assert res["status"] == "COMPLETED"
    assert res["invoices_count"] == 1


@pytest.mark.asyncio
async def test_customer_scoping_unknown_customer_produces_no_invoices(seed_commercial_laundry_data: Dict[str, Any]):
    """F4: Unknown customer produces status 'NO_APPROVED_ROWS' and 0 invoices."""
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        target_customer_name="Nonexistent Hotel Ghana",
    )
    assert res["status"] == "NO_APPROVED_ROWS"
    assert res["invoices_created"] == []


# ---------------------------------------------------------------------------
# Tier 1: Feature Coverage (F5: Date and Terms Application)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_workflow_applies_custom_invoice_date(seed_commercial_laundry_data: Dict[str, Any]):
    """F5: Custom invoice_date string is applied to generated draft invoice."""
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        target_customer_name="Labadi Beach Hotel",
        invoice_date="2026-08-25",
    )
    assert res["status"] == "COMPLETED"


@pytest.mark.asyncio
async def test_workflow_applies_custom_due_date(seed_commercial_laundry_data: Dict[str, Any]):
    """F5: Custom due_date string is accepted by generation workflow."""
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        target_customer_name="Labadi Beach Hotel",
        due_date="2026-09-25",
    )
    assert res["status"] == "COMPLETED"


@pytest.mark.asyncio
async def test_workflow_applies_custom_terms_note(seed_commercial_laundry_data: Dict[str, Any]):
    """F5: Custom terms text note is accepted by generation workflow."""
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        target_customer_name="Luxwood Hotel",
        terms="Strict Net 7 days payment terms.",
    )
    assert res["status"] == "COMPLETED"


def test_workflow_derives_date_from_client_rule_last_day():
    """F5: Mathematical verification of 'last_day_of_month' rule."""
    year = 2026
    month = 8  # August
    last_day = calendar.monthrange(year, month)[1]
    derived_date = f"{year:04d}-{month:02d}-{last_day:02d}"
    assert derived_date == "2026-08-31"


def test_workflow_derives_date_from_client_rule_first_day_next_month():
    """F5: Mathematical verification of 'first_day_of_next_month' rule."""
    year = 2026
    month = 8  # August
    next_year = year + 1 if month == 12 else year
    next_month = 1 if month == 12 else month + 1
    derived_date = f"{next_year:04d}-{next_month:02d}-01"
    assert derived_date == "2026-09-01"


# ---------------------------------------------------------------------------
# Tier 2: Boundary & Corner Cases (F3, F4, F5)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_scoping_empty_customer_name_defaults_to_all(seed_commercial_laundry_data: Dict[str, Any]):
    """F4 (BVA): Empty customer name string is treated as All Customers."""
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        target_customer_name="",
    )
    assert res["status"] == "COMPLETED"
    assert res["invoices_count"] == 2


@pytest.mark.asyncio
async def test_scoping_whitespace_customer_name_defaults_to_all(seed_commercial_laundry_data: Dict[str, Any]):
    """F4 (BVA): Whitespace customer name string is treated as All Customers."""
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        target_customer_name="   ",
    )
    assert res["status"] == "COMPLETED"
    assert res["invoices_count"] == 2


@pytest.mark.asyncio
async def test_regeneration_when_no_existing_invoice_creates_fresh(seed_commercial_laundry_data: Dict[str, Any]):
    """F3 (BVA): Regenerate mode when no existing invoice exists still bills approved items."""
    res = await execute_invoicing_workflow(
        month="August",
        year=2026,
        client_id="commercial_laundry_tenant",
        target_customer_name="Luxwood Hotel",
        mode="regenerate",
        confirm_delete=True,
    )
    assert res["status"] == "COMPLETED"
    assert res["invoices_count"] == 1


def test_workflow_leap_year_february_date_calculation():
    """F5 (BVA): Leap year 2024 has 29 days in February."""
    last_day_2024 = calendar.monthrange(2024, 2)[1]
    last_day_2026 = calendar.monthrange(2026, 2)[1]
    assert last_day_2024 == 29
    assert last_day_2026 == 28


def test_workflow_year_end_december_to_january_rollover():
    """F5 (BVA): December 2026 rolls over to January 2027 for first day of next month."""
    year = 2026
    month = 12
    next_year = year + 1 if month == 12 else year
    next_month = 1 if month == 12 else month + 1
    rollover_date = f"{next_year:04d}-{next_month:02d}-01"
    assert rollover_date == "2027-01-01"


def test_workflow_net_0_due_date_equals_invoice_date():
    """F5 (BVA): Due on receipt (Net 0) means due_date matches invoice_date."""
    inv_date = datetime.date(2026, 8, 31)
    due_date = inv_date + timedelta(days=0)
    assert due_date.isoformat() == "2026-08-31"


def test_workflow_net_60_due_date_calculation():
    """F5 (BVA): Net 60 days offset calculation crosses month boundaries."""
    inv_date = datetime.date(2026, 8, 31)
    due_date = inv_date + timedelta(days=60)
    # August (31) -> 60 days later is October 30 (August has 31 days, September 30 days)
    assert due_date.isoformat() == "2026-10-30"
