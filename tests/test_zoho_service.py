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
