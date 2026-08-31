"""Unit tests for S4 Multi-Platform Accounting Adapters & Catalog."""

import pytest
from app.services.accounting.factory import AccountingAdapterFactory
from app.services.accounting.zoho_adapter import ZohoBooksAdapter
from app.services.accounting.placeholder_adapter import InProgressAccountingAdapter
from app.models.schemas import ACCOUNTING_SOFTWARES_CATALOG
from app.models.db_models import AccountingSoftware


def test_accounting_softwares_catalog_contains_10_platforms():
    """Verify that catalog has all 10 West African accounting platforms."""
    assert len(ACCOUNTING_SOFTWARES_CATALOG) == 10
    platform_ids = [p["id"] for p in ACCOUNTING_SOFTWARES_CATALOG]
    
    # 1 Live platform
    assert "zoho_books" in platform_ids
    zoho_meta = next(p for p in ACCOUNTING_SOFTWARES_CATALOG if p["id"] == "zoho_books")
    assert zoho_meta["status"] == "live"

    # 9 In-Progress platforms
    expected_in_progress = [
        "quickbooks_online",
        "sage_business_cloud",
        "xero",
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


def test_adapter_factory_returns_zoho_adapter():
    """Verify that factory returns live ZohoBooksAdapter for Zoho Books."""
    adapter = AccountingAdapterFactory.get_adapter("zoho_books", client_id="anr_group")
    assert isinstance(adapter, ZohoBooksAdapter)
    assert adapter.is_live is True
    assert adapter.platform_name == "Zoho Books"


@pytest.mark.asyncio
async def test_adapter_factory_returns_in_progress_adapters():
    """Verify that non-Zoho platforms return InProgressAccountingAdapter with staging."""
    for sw in [
        AccountingSoftware.QUICKBOOKS_ONLINE,
        AccountingSoftware.SAGE_BUSINESS_CLOUD,
        AccountingSoftware.XERO,
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
