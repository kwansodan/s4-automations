"""Unit tests for production runtime fixes (OCRSlipItem null coercion, ZohoContact currency_code, EmailSourceService params)."""

import pytest
from app.models.schemas import OCRSlipItem, OCRSlipExtraction, ZohoContact
from app.services.email_source_service import EmailSourceService


def test_ocr_slip_item_null_coercion():
    """Verify that null unit_rate or quantities from Gemini Vision are cleanly coerced to 0.0/0."""
    item_dict = {
        "raw_item_name": "B/Sheet Dbl",
        "standard_item_name": "Bed Sheet Double",
        "unit_rate": None,
        "pickup_qty": None,
        "delivery_qty": None,
        "unreturned_loss_qty": None,
    }
    item = OCRSlipItem.model_validate(item_dict)
    assert item.unit_rate == 0.0
    assert item.pickup_qty == 0
    assert item.delivery_qty == 0
    assert item.unreturned_loss_qty == 0


def test_ocr_slip_extraction_from_json_with_nulls():
    """Verify full extraction parsing when LLM outputs null values in JSON."""
    raw_json = """
    {
        "file_name": "Active 8 Spintex 20-10-2026.jpg",
        "client_name": "Active 8",
        "raw_customer_name": "Active 8 Spintex",
        "reconciled_customer_name": "Active 8 - Spintex",
        "slip_date": "20/10/2026",
        "items": [
            {
                "raw_item_name": "Bath Towel",
                "standard_item_name": "Bath Towel Plush",
                "unit_rate": null,
                "pickup_qty": 15,
                "delivery_qty": null,
                "unreturned_loss_qty": null
            }
        ]
    }
    """
    extraction = OCRSlipExtraction.model_validate_json(raw_json)
    assert len(extraction.items) == 1
    assert extraction.items[0].unit_rate == 0.0
    assert extraction.items[0].pickup_qty == 15
    assert extraction.items[0].delivery_qty == 0


def test_zoho_contact_currency_code_attribute():
    """Verify ZohoContact has currency_code attribute and defaults to GHS."""
    contact = ZohoContact(
        contact_id="cnt_999",
        contact_name="Test Hotel",
        company_name="Test Hotel Ltd",
    )
    assert hasattr(contact, "currency_code")
    assert contact.currency_code == "GHS"


def test_email_source_service_keyword_args():
    """Verify EmailSourceService handles imap_server, imap_user, imap_password, and folder kwargs."""
    svc = EmailSourceService(
        imap_server="imap.example.com",
        imap_user="user@example.com",
        imap_password="password123",
        folder="INBOX.Billing",
    )
    assert svc.host == "imap.example.com"
    assert svc.username == "user@example.com"
    assert svc.password == "password123"
    assert svc.default_folder == "INBOX.Billing"
    assert hasattr(svc, "fetch_unread_attachments")
