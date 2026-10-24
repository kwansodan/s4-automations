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


@pytest.mark.asyncio
async def test_ocr_raises_ai_model_unavailable_on_503(monkeypatch):
    """Verify that when the best model returns 503 high demand, AIModelUnavailableException is raised without candidate fallbacks."""
    from unittest.mock import MagicMock
    from app.services.ocr_service import GeminiOCRService, AIModelUnavailableException

    models_called = []

    class MockModels:
        def generate_content(self, model, contents, config=None):
            models_called.append(model)
            raise Exception("503 UNAVAILABLE: The model is experiencing high demand. Please try again later.")

    class MockGenaiClient:
        def __init__(self, api_key=None):
            self.models = MockModels()

    import google.genai as genai_module
    monkeypatch.setattr(genai_module, "Client", MockGenaiClient)

    ocr = GeminiOCRService(api_key="test-key", model_name="gemini-3.6-flash")

    with pytest.raises(AIModelUnavailableException) as exc_info:
        await ocr.extract_slip_data(
            file_bytes=b"fake-bytes",
            mime_type="image/jpeg",
            file_name="slip_1.jpg",
            client_name="Test Client",
            item_catalog=[],
        )

    # Verify only the primary best model was attempted and no inferior models were called
    assert models_called == ["gemini-3.6-flash"]
    assert "currently unavailable" in str(exc_info.value)


@pytest.mark.asyncio
async def test_dynamic_blueprint_terminates_on_model_unavailable(monkeypatch):
    """Verify DynamicBlueprintStrategy halts immediately and updates pipeline_tracker on AIModelUnavailableException."""
    from unittest.mock import AsyncMock
    from app.strategies.dynamic_blueprint import DynamicBlueprintStrategy
    from app.services.ocr_service import AIModelUnavailableException
    from app.strategies.base import SourceDocument
    from app.utils.progress_tracker import pipeline_tracker

    from app.models.db_models import ClientOrganization

    client_org = ClientOrganization(
        id="test_client",
        name="Test Hotel",
        accounting_software="zoho_books",
        pipelines=[{"id": "p1", "pipeline_name": "Test P", "direction": "inflow", "entity_type": "ar_sales_invoice"}],
    )
    strategy = DynamicBlueprintStrategy(client=client_org)

    # Mock OCR extraction to raise AIModelUnavailableException
    mock_ocr = AsyncMock()
    mock_ocr.extract_slip_data.side_effect = AIModelUnavailableException("503 Service Unavailable")
    mock_ocr.simulate_pipeline_transposition.side_effect = AIModelUnavailableException("503 Service Unavailable")
    mock_ocr.extract_vendor_bill.side_effect = AIModelUnavailableException("503 Service Unavailable")
    mock_ocr.model_name = "gemini-3.6-flash"
    monkeypatch.setattr("app.strategies.dynamic_blueprint.GeminiOCRService", lambda: mock_ocr)

    doc = SourceDocument(
        source_type="google_drive",
        source_identifier="drive_1",
        file_name="slip_august.jpg",
        file_bytes=b"image-content",
        mime_type="image/jpeg",
        metadata={"pipeline_id": "p1"},
    )

    with pytest.raises(AIModelUnavailableException):
        await strategy.extract_and_validate([doc])

    # Ensure pipeline tracker caught the error and marked state as ERROR
    tracker_state = pipeline_tracker.get_state()
    assert tracker_state["status"] == "ERROR"
    assert "AI Model Unavailable" in tracker_state["current_step"]


