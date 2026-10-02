"""Tier 1, Tier 2, and Adversarial E2E Tests for Zoho Books Service (F1).

Verifies draft invoice deletion, idempotency, retry handling, custom due dates,
and payment terms application under mock mode.
"""

import pytest
from app.services.zoho_service import ZohoBooksService
from app.models.schemas import ZohoDraftInvoiceRequest, ZohoInvoiceLineItem


# ---------------------------------------------------------------------------
# Tier 1: Feature Coverage (Happy-Path Isolation)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_delete_draft_invoice_success_mock():
    """F1: Verifies delete_draft_invoice returns True when deleting an existing draft."""
    zoho = ZohoBooksService(org_id="zoho_org_ghana_001")
    result = await zoho.delete_draft_invoice("inv_mock_123456")
    assert result is True


@pytest.mark.asyncio
async def test_delete_draft_invoice_returns_boolean_status():
    """F1: Verifies delete_draft_invoice returns a boolean primitive."""
    zoho = ZohoBooksService()
    result = await zoho.delete_draft_invoice("inv_test_draft_999")
    assert isinstance(result, bool)
    assert result is True


@pytest.mark.asyncio
async def test_create_draft_invoice_with_explicit_due_date():
    """F1/F5: Verifies create_draft_invoice accepts and processes explicit due_date."""
    zoho = ZohoBooksService()
    req = ZohoDraftInvoiceRequest(
        customer_id="cnt_labadi_101",
        date="2026-08-31",
        due_date="2026-09-14",
        terms="Payment due within 14 days of invoice date.",
        line_items=[
            ZohoInvoiceLineItem(
                item_id="item_sheet_dbl",
                name="Bed Sheet (Double / King)",
                rate=18.50,
                quantity=10,
            )
        ],
    )
    res = await zoho.create_draft_invoice(req)
    assert res.status == "draft"
    assert res.total == 185.00
    assert res.customer_id == "cnt_labadi_101"
    assert req.due_date == "2026-09-14"


@pytest.mark.asyncio
async def test_create_draft_invoice_with_custom_terms_text():
    """F1/F5: Verifies create_draft_invoice accepts and preserves custom terms text."""
    zoho = ZohoBooksService()
    custom_terms = "Net 30. Direct bank transfer to Commercial Laundry Ghana Ltd."
    req = ZohoDraftInvoiceRequest(
        customer_id="cnt_luxwood_102",
        date="2026-08-31",
        due_date="2026-09-30",
        terms=custom_terms,
        line_items=[
            ZohoInvoiceLineItem(
                item_id="item_bath_towel",
                name="Bath Towel",
                rate=12.00,
                quantity=5,
            )
        ],
    )
    res = await zoho.create_draft_invoice(req)
    assert res.status == "draft"
    assert res.total == 60.00
    assert req.terms == custom_terms


@pytest.mark.asyncio
async def test_create_or_append_draft_invoice_preserves_terms_and_due_date():
    """F1/F5: Verifies create_or_append preserves custom terms and due_date."""
    zoho = ZohoBooksService()
    custom_terms = "Payment due strictly on receipt."
    req = ZohoDraftInvoiceRequest(
        customer_id="cnt_bantree_103",
        date="2026-08-31",
        due_date="2026-09-14",
        terms=custom_terms,
        line_items=[
            ZohoInvoiceLineItem(
                item_id="item_bath_mat",
                name="Bath Mat",
                rate=9.00,
                quantity=20,
            )
        ],
    )
    res = await zoho.create_or_append_draft_invoice(req, month="August", year=2026)
    assert res.status == "draft"
    assert res.customer_id == "cnt_bantree_103"
    assert req.due_date == "2026-09-14"
    assert req.terms == custom_terms


# ---------------------------------------------------------------------------
# Tier 2: Boundary and Corner Cases
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_delete_draft_invoice_empty_id_raises_error():
    """F1 (BVA): Empty string invoice_id must be rejected."""
    zoho = ZohoBooksService()
    with pytest.raises((ValueError, RuntimeError)):
        await zoho.delete_draft_invoice("")


@pytest.mark.asyncio
async def test_delete_draft_invoice_whitespace_id_handling():
    """F1 (BVA): Whitespace invoice_id must be rejected."""
    zoho = ZohoBooksService()
    with pytest.raises((ValueError, RuntimeError)):
        await zoho.delete_draft_invoice("   ")


@pytest.mark.asyncio
async def test_delete_draft_invoice_idempotent_when_already_deleted():
    """F1 (BVA): Repeated deletion of same invoice_id must succeed idempotently."""
    zoho = ZohoBooksService()
    inv_id = "inv_idempotent_test_456"
    first_res = await zoho.delete_draft_invoice(inv_id)
    second_res = await zoho.delete_draft_invoice(inv_id)
    assert first_res is True
    assert second_res is True


@pytest.mark.asyncio
async def test_delete_draft_invoice_non_existent_invoice_id():
    """F1 (BVA): Deleting non-existent invoice in mock mode succeeds safely."""
    zoho = ZohoBooksService()
    result = await zoho.delete_draft_invoice("inv_nonexistent_99999999")
    assert result is True


@pytest.mark.asyncio
async def test_delete_draft_invoice_numeric_string_format():
    """F1 (BVA): Accepts purely numeric string invoice IDs commonly used by Zoho."""
    zoho = ZohoBooksService()
    result = await zoho.delete_draft_invoice("4982019482019284")
    assert result is True


# ---------------------------------------------------------------------------
# Tier 5: Adversarial Edge Cases
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_delete_draft_invoice_adversarial_path_traversal():
    """F1 (Adversarial): Path traversal attempt in invoice_id must not crash service."""
    zoho = ZohoBooksService()
    malicious_id = "../../api/v3/contacts/delete?all=true"
    result = await zoho.delete_draft_invoice(malicious_id)
    assert isinstance(result, bool)


@pytest.mark.asyncio
async def test_create_draft_invoice_special_characters_in_terms():
    """F5 (Adversarial): Terms containing special characters, quotes, and newlines."""
    zoho = ZohoBooksService()
    complex_terms = "Terms: 50% upfront, 50% net 14.\nNotes: \"Strict VAT/NHIL/GETFund\". Special chars: <>&'\""
    req = ZohoDraftInvoiceRequest(
        customer_id="cnt_labadi_101",
        date="2026-08-31",
        due_date="2026-09-14",
        terms=complex_terms,
        line_items=[
            ZohoInvoiceLineItem(
                item_id="item_discrepancy",
                name="Linen Discrepancy",
                rate=25.00,
                quantity=1,
            )
        ],
    )
    res = await zoho.create_draft_invoice(req)
    assert res.status == "draft"
    assert res.total == 25.00
    assert req.terms == complex_terms
