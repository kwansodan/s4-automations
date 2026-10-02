"""Tests for Zoho Books API Service."""

import pytest
from app.services.zoho_service import ZohoBooksService
from app.models.schemas import ZohoDraftInvoiceRequest, ZohoInvoiceLineItem


@pytest.mark.asyncio
async def test_fetch_active_contacts_mock():
    zoho = ZohoBooksService()
    contacts = await zoho.fetch_active_contacts()
    assert len(contacts) >= 5
    contact_names = [c.contact_name for c in contacts]
    assert "Luxwood" in contact_names
    assert "The Lennox" in contact_names


@pytest.mark.asyncio
async def test_fetch_item_catalog_mock():
    zoho = ZohoBooksService()
    items = await zoho.fetch_item_catalog()
    assert len(items) >= 5
    item_ids = [i.item_id for i in items]
    assert "item_bed_sheet_dbl" in item_ids
    assert "item_bath_towel" in item_ids


@pytest.mark.asyncio
async def test_find_contact_by_name():
    zoho = ZohoBooksService()
    await zoho.fetch_active_contacts()

    # Exact match
    contact = zoho.find_contact_by_name("Luxwood")
    assert contact is not None
    assert contact.contact_id == "cnt_luxwood_001"

    # Substring / Case insensitive match
    contact2 = zoho.find_contact_by_name("the lennox")
    assert contact2 is not None
    assert contact2.contact_id == "cnt_the_lennox_003"


@pytest.mark.asyncio
async def test_create_draft_invoice_mock():
    zoho = ZohoBooksService()
    request = ZohoDraftInvoiceRequest(
        customer_id="cnt_luxwood_001",
        date="2026-08-28",
        line_items=[
            ZohoInvoiceLineItem(
                item_id="item_bed_sheet_dbl",
                name="Bed Sheet (Double / King)",
                rate=18.50,
                quantity=50,
            ),
            ZohoInvoiceLineItem(
                item_id="item_bath_towel",
                name="Bath Towel",
                rate=12.00,
                quantity=40,
            ),
        ],
    )

    response = await zoho.create_draft_invoice(request)
    assert response.code == 0
    assert response.status == "draft"
    assert response.total == (50 * 18.50 + 40 * 12.00)
    assert response.invoice_number.startswith("INV-ANR-")


@pytest.mark.asyncio
async def test_create_or_append_draft_invoice_mock():
    zoho = ZohoBooksService()
    # Step 1: Initial invoice creation
    req1 = ZohoDraftInvoiceRequest(
        customer_id="cnt_the_bantree_002",
        date="2026-08-31",
        line_items=[
            ZohoInvoiceLineItem(
                item_id="item_duvet_king",
                name="Duvet Cover (King)",
                rate=25.00,
                quantity=10,
            )
        ],
    )
    res1 = await zoho.create_or_append_draft_invoice(req1, "August", 2026)
    assert res1.total == 250.00
    first_inv_num = res1.invoice_number

    # Step 2: Next day upload/append new line items
    req2 = ZohoDraftInvoiceRequest(
        customer_id="cnt_the_bantree_002",
        date="2026-08-31",
        line_items=[
            ZohoInvoiceLineItem(
                item_id="item_pillow_case",
                name="Pillow Case",
                rate=6.00,
                quantity=20,
            )
        ],
    )
    res2 = await zoho.create_or_append_draft_invoice(req2, "August", 2026)
    # Must append to the same invoice number with updated total
    assert res2.invoice_number == first_inv_num
    assert res2.total == (250.00 + 120.00)


@pytest.mark.asyncio
async def test_delete_draft_invoice_mock():
    zoho = ZohoBooksService()
    # 1. Create a draft invoice
    req = ZohoDraftInvoiceRequest(
        customer_id="cnt_kwarleyz_004",
        date="2026-08-31",
        line_items=[
            ZohoInvoiceLineItem(
                item_id="item_bath_mat",
                name="Bath Mat",
                rate=9.00,
                quantity=15,
            )
        ],
    )
    res = await zoho.create_or_append_draft_invoice(req, "August", 2026)
    assert res.total == 135.00
    created_id = res.invoice_id

    # Verify it exists in mock storage
    existing = await zoho.find_existing_draft_invoice("cnt_kwarleyz_004", "August", 2026)
    assert existing is not None
    assert existing["invoice_id"] == created_id

    # 2. Delete the draft invoice
    deleted = await zoho.delete_draft_invoice(created_id)
    assert deleted is True

    # 3. Verify it is now deleted
    existing_after = await zoho.find_existing_draft_invoice("cnt_kwarleyz_004", "August", 2026)
    assert existing_after is None

    # 4. Idempotent delete on non-existent invoice returns True
    deleted_again = await zoho.delete_draft_invoice(created_id)
    assert deleted_again is True


@pytest.mark.asyncio
async def test_create_or_append_draft_invoice_with_due_date_and_terms():
    zoho = ZohoBooksService()
    req = ZohoDraftInvoiceRequest(
        customer_id="cnt_number_one_005",
        date="2026-08-31",
        line_items=[
            ZohoInvoiceLineItem(
                item_id="item_table_cloth",
                name="Table Cloth (Banquet)",
                rate=22.00,
                quantity=5,
            )
        ],
    )
    custom_due = "2026-09-14"
    custom_terms = "Net 14 days strict"
    res = await zoho.create_or_append_draft_invoice(
        req,
        month="August",
        year=2026,
        due_date=custom_due,
        terms=custom_terms,
    )
    assert res.total == 110.00
    assert req.due_date == custom_due
    assert req.terms == custom_terms

    # Check stored mock draft retains custom due date and terms
    stored = await zoho.find_existing_draft_invoice("cnt_number_one_005", "August", 2026)
    assert stored is not None
    assert stored["due_date"] == custom_due
    assert stored["terms"] == custom_terms


