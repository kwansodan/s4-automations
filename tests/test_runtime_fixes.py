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


def test_safe_parse_extraction_conversational_text():
    """Verify _safe_parse_extraction parses JSON surrounded by conversational text without UnboundLocalError."""
    from app.services.ocr_service import GeminiOCRService
    ocr = GeminiOCRService(api_key="fake-key-for-test", model_name="gemini-2.5-flash")
    text_with_chatter = """
    Here is the structured extraction for the slip:
    ```json
    {
        "file_name": "Active 8 Spintex 20-10-2026.jpg",
        "client_name": "Active 8",
        "raw_customer_name": "Active 8 Spintex",
        "reconciled_customer_name": "Active 8 - Spintex",
        "slip_date": "20/10/2026",
        "items": [
            {
                "raw_item_name": "Bath Sheet",
                "standard_item_name": "Bath Sheet Luxury",
                "unit_rate": null,
                "pickup_qty": 10,
                "delivery_qty": 10,
                "unreturned_loss_qty": 0
            }
        ]
    }
    ```
    Hope this helps!
    """
    res = ocr._safe_parse_extraction(text_with_chatter, "Active 8 Spintex 20-10-2026.jpg", "Active 8")
    assert res is not None
    assert res.file_name == "Active 8 Spintex 20-10-2026.jpg"
    assert len(res.items) == 1
    assert res.items[0].raw_item_name == "Bath Sheet"


def test_safe_parse_extraction_broken_text_graceful_fallback():
    """Verify _safe_parse_extraction handles completely unparseable text gracefully without crashing."""
    from app.services.ocr_service import GeminiOCRService
    ocr = GeminiOCRService(api_key="fake-key-for-test", model_name="gemini-2.5-flash")
    unparseable_text = "503 High Demand: Service Unavailable"
    res = ocr._safe_parse_extraction(unparseable_text, "Active 8 Spintex 22-10-2026.jpg", "Active 8")
    assert res is not None
    assert res.file_name == "Active 8 Spintex 22-10-2026.jpg"
    assert "Extraction formatting incomplete" in res.notes


def test_postgres_url_driver_rewriting():
    """Verify postgresql:// URLs get rewritten to postgresql+psycopg2://."""
    raw = "postgresql://postgres:postgres@postgres:5432/s4_automations"
    cleaned = raw.strip()
    if cleaned.startswith("postgresql://") and "+psycopg" not in cleaned:
        rewritten = cleaned.replace("postgresql://", "postgresql+psycopg2://", 1)
    assert rewritten == "postgresql+psycopg2://postgres:postgres@postgres:5432/s4_automations"

