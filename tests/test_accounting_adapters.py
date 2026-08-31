"""Unit tests for S4 Multi-Platform Accounting Adapters & Catalog."""

import pytest
from app.services.accounting.factory import AccountingAdapterFactory
from app.services.accounting.zoho_adapter import ZohoBooksAdapter
from app.services.accounting.quickbooks_adapter import QuickBooksAdapter
from app.services.accounting.xero_adapter import XeroAdapter
from app.services.accounting.placeholder_adapter import InProgressAccountingAdapter
from app.models.schemas import ACCOUNTING_SOFTWARES_CATALOG
from app.models.db_models import AccountingSoftware


def test_accounting_softwares_catalog_contains_10_platforms():
    """Verify that catalog has all 10 West African accounting platforms."""
    assert len(ACCOUNTING_SOFTWARES_CATALOG) == 10
    platform_ids = [p["id"] for p in ACCOUNTING_SOFTWARES_CATALOG]
    
    # 3 Live platforms
    live_platforms = ["zoho_books", "quickbooks_online", "xero"]
    for pid in live_platforms:
        assert pid in platform_ids
        meta = next(p for p in ACCOUNTING_SOFTWARES_CATALOG if p["id"] == pid)
        assert meta["status"] == "live"

    # 7 In-Progress platforms
    expected_in_progress = [
        "sage_business_cloud",
        "odoo",
        "tally_prime",
        "sap_business_one",
        "ms_dynamics_365",
        "wave",
        "busy_accounting",
    ]
    for pid in expected_in_progress:
        assert pid in platform_ids
        meta = next(p for p in ACCOUNTING_SOFTWARES_CATALOG if p["id"] == pid)
        assert meta["status"] == "in_progress"


def test_adapter_factory_returns_live_adapters():
    """Verify that factory returns live adapters for Zoho, QuickBooks, and Xero."""
    zoho = AccountingAdapterFactory.get_adapter("zoho_books", client_id="anr_group")
    assert isinstance(zoho, ZohoBooksAdapter)
    assert zoho.is_live is True

    qbo = AccountingAdapterFactory.get_adapter("quickbooks_online", client_id="anr_group")
    assert isinstance(qbo, QuickBooksAdapter)
    assert qbo.is_live is True

    xero = AccountingAdapterFactory.get_adapter("xero", client_id="anr_group")
    assert isinstance(xero, XeroAdapter)
    assert xero.is_live is True


@pytest.mark.asyncio
async def test_adapter_factory_returns_in_progress_adapters():
    """Verify that roadmap platforms return InProgressAccountingAdapter with staging."""
    for sw in [
        AccountingSoftware.SAGE_BUSINESS_CLOUD,
        AccountingSoftware.ODOO,
        AccountingSoftware.TALLY_PRIME,
        AccountingSoftware.SAP_BUSINESS_ONE,
        AccountingSoftware.MS_DYNAMICS_365,
        AccountingSoftware.WAVE,
        AccountingSoftware.BUSY_ACCOUNTING,
    ]:
        adapter = AccountingAdapterFactory.get_adapter(sw.value, client_id="demo_client")
        assert isinstance(adapter, InProgressAccountingAdapter)
        assert adapter.is_live is False
        assert adapter.platform_name != ""

        # Test mock contact fetch
        contacts = await adapter.fetch_contacts("customer")
        assert len(contacts) > 0

        # Test staging post
        result = await adapter.post_invoice({"amount": 500})
        assert result.success is True
        assert result.status == "MOCK_STAGED"

