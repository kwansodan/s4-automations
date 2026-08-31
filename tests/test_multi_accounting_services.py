"""Unit & Integration tests for S4 Multi-Platform Accounting Engine (QuickBooks, Xero, Zoho)."""

import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.services.accounting.factory import AccountingAdapterFactory
from app.services.accounting.zoho_adapter import ZohoBooksAdapter
from app.services.accounting.quickbooks_adapter import QuickBooksAdapter
from app.services.accounting.xero_adapter import XeroAdapter
from app.services.accounting.placeholder_adapter import InProgressAccountingAdapter
from app.services.quickbooks_service import QuickBooksService
from app.services.xero_service import XeroService


@pytest.mark.asyncio
async def test_accounting_adapter_factory_resolution():
    """Verify factory returns concrete live adapters for Zoho, QBO, Xero and in-progress for others."""
    # 1. Zoho Books
    zoho_adapter = AccountingAdapterFactory.get_adapter("zoho_books", "client_1")
    assert isinstance(zoho_adapter, ZohoBooksAdapter)
    assert zoho_adapter.is_live is True
    assert zoho_adapter.platform_name == "Zoho Books"

    # 2. QuickBooks Online
    qbo_adapter = AccountingAdapterFactory.get_adapter("quickbooks_online", "client_2")
    assert isinstance(qbo_adapter, QuickBooksAdapter)
    assert qbo_adapter.is_live is True
    assert qbo_adapter.platform_name == "QuickBooks Online"

    # 3. Xero Accounting
    xero_adapter = AccountingAdapterFactory.get_adapter("xero", "client_3")
    assert isinstance(xero_adapter, XeroAdapter)
    assert xero_adapter.is_live is True
    assert xero_adapter.platform_name == "Xero"

    # 4. Roadmap platform (e.g. Sage, Odoo)
    sage_adapter = AccountingAdapterFactory.get_adapter("sage_business_cloud", "client_4")
    assert isinstance(sage_adapter, InProgressAccountingAdapter)
    assert sage_adapter.is_live is False
    assert sage_adapter.platform_name == "Sage Business Cloud"


@pytest.mark.asyncio
async def test_quickbooks_adapter_lifecycle():
    """Verify QuickBooks adapter customer sync, item catalog sync, invoice posting and bills."""
    adapter = QuickBooksAdapter(
        client_id="anr_ghana",
        config={"accounting_org_id": "9341452891048201", "is_sandbox": True},
    )

    # Fetch contacts
    contacts = await adapter.fetch_contacts("customer")
    assert len(contacts) > 0
    assert any("Kempinski" in c.contact_name for c in contacts)

    # Fetch item catalog
    items = await adapter.fetch_item_catalog()
    assert len(items) > 0
    assert any("Bedsheet" in i.name for i in items)

    # Post invoice
    inv_res = await adapter.post_invoice({
        "customer_id": "QBO_CUST_101",
        "invoice_number": "QBO-INV-9901",
        "total_amount": 1450.00,
    })
    assert inv_res.success is True
    assert inv_res.platform == "QuickBooks Online"
    assert inv_res.entity_type == "ar_sales_invoice"
    assert inv_res.document_number == "QBO-INV-9901"

    # Post vendor bill
    bill_res = await adapter.post_vendor_bill({
        "vendor_id": "QBO_VEND_01",
        "bill_number": "QBO-BILL-3301",
        "total_amount": 890.00,
    })
    assert bill_res.success is True
    assert bill_res.entity_type == "ap_vendor_bill"

    # Post payment
    pmt_res = await adapter.post_payment({
        "customer_id": "QBO_CUST_101",
        "amount": 1450.00,
        "reference_number": "QBO-PMT-77",
    })
    assert pmt_res.success is True
    assert pmt_res.entity_type == "ar_customer_payment"


@pytest.mark.asyncio
async def test_xero_adapter_lifecycle():
    """Verify Xero adapter contact sync, item catalog sync, invoice posting and bills."""
    adapter = XeroAdapter(
        client_id="apex_ghana",
        config={"accounting_org_id": "xero_tenant_accra_01"},
    )

    # Fetch contacts
    contacts = await adapter.fetch_contacts("customer")
    assert len(contacts) > 0
    assert any("Movenpick" in c.contact_name for c in contacts)

    # Fetch item catalog
    items = await adapter.fetch_item_catalog()
    assert len(items) > 0
    assert any("Duvet Cover" in i.name for i in items)

    # Post ACCREC Invoice
    inv_res = await adapter.post_invoice({
        "customer_id": "XERO_CONT_01",
        "invoice_number": "XERO-INV-8801",
        "total_amount": 2300.00,
    })
    assert inv_res.success is True
    assert inv_res.platform == "Xero"
    assert inv_res.entity_type == "ar_sales_invoice"

    # Post ACCPAY Bill
    bill_res = await adapter.post_vendor_bill({
        "vendor_id": "XERO_CONT_05",
        "bill_number": "XERO-BILL-2201",
        "total_amount": 650.00,
    })
    assert bill_res.success is True
    assert bill_res.entity_type == "ap_vendor_bill"


@pytest.mark.asyncio
async def test_api_fetch_accounting_catalog_endpoint():
    """Verify POST /api/v1/clients/accounting/fetch-catalog across all platforms."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Probe QuickBooks Online
        qbo_resp = await ac.post(
            "/api/v1/clients/accounting/fetch-catalog",
            json={"software": "quickbooks_online", "org_id": "9341452891048201"},
        )
        assert qbo_resp.status_code == 200
        qbo_data = qbo_resp.json()
        assert qbo_data["software"] == "quickbooks_online"
        assert qbo_data["is_live"] is True
        assert len(qbo_data["contacts"]) > 0
        assert len(qbo_data["items"]) > 0

        # 2. Probe Xero
        xero_resp = await ac.post(
            "/api/v1/clients/accounting/fetch-catalog",
            json={"software": "xero", "org_id": "xero_tenant_accra_01"},
        )
        assert xero_resp.status_code == 200
        xero_data = xero_resp.json()
        assert xero_data["software"] == "xero"
        assert xero_data["is_live"] is True
        assert len(xero_data["contacts"]) > 0

        # 3. Probe Zoho Books
        zoho_resp = await ac.post(
            "/api/v1/clients/accounting/fetch-catalog",
            json={"software": "zoho_books", "org_id": "782910482"},
        )
        assert zoho_resp.status_code == 200
        zoho_data = zoho_resp.json()
        assert zoho_data["software"] == "zoho_books"
        assert zoho_data["is_live"] is True
