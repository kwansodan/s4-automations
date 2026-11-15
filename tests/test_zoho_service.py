"""Tests for Zoho Books API Service using isolated test mocks."""

import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from app.services.zoho_service import ZohoBooksService
from app.models.schemas import ZohoContact, ZohoItem, ZohoDraftInvoiceRequest, ZohoInvoiceLineItem


@pytest.fixture
def mock_zoho_service():
    """Provides a ZohoBooksService instance initialized with test credentials."""
    zoho = ZohoBooksService(
        org_id="test_org_12345",
        refresh_token="test_refresh_token",
        client_id="test_client_id",
        client_secret="test_client_secret",
    )
    return zoho


@pytest.mark.asyncio
async def test_fetch_active_contacts_mock(mock_zoho_service):
    mock_contacts_data = [
        {"contact_id": "cnt_luxwood_001", "contact_name": "Luxwood", "company_name": "Luxwood Hotel", "status": "active"},
        {"contact_id": "cnt_the_lennox_003", "contact_name": "The Lennox", "company_name": "The Lennox Residences", "status": "active"},
        {"contact_id": "cnt_bantree_002", "contact_name": "The Bantree", "company_name": "The Bantree", "status": "active"},
        {"contact_id": "cnt_kwarleyz_004", "contact_name": "Kwarleyz", "company_name": "Kwarleyz Residence", "status": "active"},
        {"contact_id": "cnt_number_one_005", "contact_name": "Number One", "company_name": "Number One Oxford Street", "status": "active"},
    ]
    with patch.object(mock_zoho_service, "get_access_token", new_callable=AsyncMock) as mock_tok, \
         patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_tok.return_value = "test_access_token"
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"code": 0, "contacts": mock_contacts_data, "page_context": {"has_more_page": False}}
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        contacts = await mock_zoho_service.fetch_active_contacts()
        assert len(contacts) >= 5
        contact_names = [c.contact_name for c in contacts]
        assert "Luxwood" in contact_names
        assert "The Lennox" in contact_names


@pytest.mark.asyncio
async def test_fetch_item_catalog_mock(mock_zoho_service):
    mock_items_data = [
        {"item_id": "item_bed_sheet_dbl", "name": "Bed Sheet (Double / King)", "rate": 18.50, "status": "active"},
        {"item_id": "item_bath_towel", "name": "Bath Towel", "rate": 12.00, "status": "active"},
        {"item_id": "item_duvet_king", "name": "Duvet Cover (King)", "rate": 25.00, "status": "active"},
        {"item_id": "item_pillow_case", "name": "Pillow Case", "rate": 6.50, "status": "active"},
        {"item_id": "item_bath_mat", "name": "Bath Mat", "rate": 9.00, "status": "active"},
    ]
    with patch.object(mock_zoho_service, "get_access_token", new_callable=AsyncMock) as mock_tok, \
         patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_tok.return_value = "test_access_token"
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"code": 0, "items": mock_items_data, "page_context": {"has_more_page": False}}
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        items = await mock_zoho_service.fetch_item_catalog()
        assert len(items) >= 5
        item_ids = [i.item_id for i in items]
        assert "item_bed_sheet_dbl" in item_ids
        assert "item_bath_towel" in item_ids


@pytest.mark.asyncio
async def test_find_contact_by_name(mock_zoho_service):
    mock_zoho_service._cached_contacts = [
        ZohoContact(contact_id="cnt_luxwood_001", contact_name="Luxwood", company_name="Luxwood Hotel"),
        ZohoContact(contact_id="cnt_the_lennox_003", contact_name="The Lennox", company_name="The Lennox Luxury Apartments"),
    ]

    # Exact match
    contact = mock_zoho_service.find_contact_by_name("Luxwood")
    assert contact is not None
    assert contact.contact_id == "cnt_luxwood_001"

    # Substring / Case insensitive match
    contact2 = mock_zoho_service.find_contact_by_name("the lennox")
    assert contact2 is not None
    assert contact2.contact_id == "cnt_the_lennox_003"


@pytest.mark.asyncio
async def test_create_draft_invoice_mock(mock_zoho_service):
    request = ZohoDraftInvoiceRequest(
        customer_id="cnt_luxwood_001",
        date="2026-08-28",
        due_date="2026-09-11",
        terms="Net 14",
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

    with patch.object(mock_zoho_service, "get_access_token", new_callable=AsyncMock) as mock_tok, \
         patch.object(mock_zoho_service, "get_default_sales_account_id", new_callable=AsyncMock) as mock_sales, \
         patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_tok.return_value = "test_access_token"
        mock_sales.return_value = "acc_sales_123"
        mock_resp = MagicMock()
        mock_resp.status_code = 201
        mock_resp.is_error = False
        mock_resp.json.return_value = {
            "code": 0,
            "message": "The invoice has been created as draft.",
            "invoice": {
                "invoice_id": "78291048200008888",
                "invoice_number": "INV-ANR-202608-0001",
                "customer_id": "cnt_luxwood_001",
                "customer_name": "Luxwood",
                "status": "draft",
                "total": 50 * 18.50 + 40 * 12.00,
                "date": "2026-08-28",
                "due_date": "2026-09-11",
                "currency_code": "GHS",
            },
        }
        mock_resp.raise_for_status = MagicMock()
        mock_post.return_value = mock_resp

        response = await mock_zoho_service.create_draft_invoice(request)
        assert response.code == 0
        assert response.status == "draft"
        assert response.total == (50 * 18.50 + 40 * 12.00)
        assert response.invoice_number.startswith("INV-ANR-")


@pytest.mark.asyncio
async def test_delete_draft_invoice_mock(mock_zoho_service):
    with patch.object(mock_zoho_service, "get_access_token", new_callable=AsyncMock) as mock_tok, \
         patch("httpx.AsyncClient.delete", new_callable=AsyncMock) as mock_del:
        mock_tok.return_value = "test_access_token"
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"code": 0, "message": "The invoice has been deleted."}
        mock_resp.raise_for_status = MagicMock()
        mock_del.return_value = mock_resp

        deleted = await mock_zoho_service.delete_draft_invoice("78291048200008888")
        assert deleted is True


@pytest.mark.asyncio
async def test_create_or_append_draft_invoice_with_due_date_and_terms(mock_zoho_service):
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

    with patch.object(mock_zoho_service, "find_existing_draft_invoice", new_callable=AsyncMock) as mock_find, \
         patch.object(mock_zoho_service, "create_draft_invoice", new_callable=AsyncMock) as mock_create:
        mock_find.return_value = None
        from app.models.schemas import ZohoDraftInvoiceResponse
        mock_create.return_value = ZohoDraftInvoiceResponse(
            invoice_id="inv_test_001",
            invoice_number="INV-ANR-202608-0002",
            customer_id="cnt_number_one_005",
            customer_name="Number One",
            status="draft",
            total=110.00,
            date="2026-08-31",
            due_date=custom_due,
            currency_code="GHS",
        )

        res = await mock_zoho_service.create_or_append_draft_invoice(
            req,
            month="August",
            year=2026,
            due_date=custom_due,
            terms=custom_terms,
        )
        assert res.total == 110.00
        assert req.due_date == custom_due
        assert req.terms == custom_terms
