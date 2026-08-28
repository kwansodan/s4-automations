"""Tests for Gemini OCR Service and SKU reconciliation."""

import pytest
from app.models.schemas import ConfidenceLevel, OCRSlipExtraction, OCRSlipItem
from app.services.ocr_service import GeminiOCRService


def test_find_best_matching_item(sample_zoho_items):
    ocr = GeminiOCRService()

    # Exact synonym
    match = ocr.find_best_matching_item("b/sheet dbl", sample_zoho_items)
    assert match is not None
    assert match.item_id == "item_bed_sheet_dbl"

    # Variations
    match2 = ocr.find_best_matching_item("P/Case", sample_zoho_items)
    assert match2 is not None
    assert match2.item_id == "item_pillow_case"

    match3 = ocr.find_best_matching_item("Bath Towel", sample_zoho_items)
    assert match3 is not None
    assert match3.item_id == "item_bath_towel"


@pytest.mark.asyncio
async def test_extract_slip_data_mock(sample_zoho_items):
    ocr = GeminiOCRService()
    extraction = await ocr.extract_slip_data(
        file_bytes=b"mock-content",
        mime_type="image/jpeg",
        file_name="slip_001.jpg",
        client_name="Luxwood",
        item_catalog=sample_zoho_items,
    )

    assert extraction.file_name == "slip_001.jpg"
    assert extraction.client_name == "Luxwood"
    assert len(extraction.items) > 0
    assert extraction.items[0].zoho_item_id != ""


def test_aggregate_monthly_skus(sample_zoho_items, sample_ocr_extractions):
    ocr = GeminiOCRService()
    summaries = ocr.aggregate_monthly_skus(
        client_name="Luxwood",
        zoho_contact_id="cnt_luxwood_001",
        extractions=sample_ocr_extractions,
        item_catalog=sample_zoho_items,
    )

    assert len(summaries) == 3  # Bed Sheet (Double / King), Bath Towel, Pillow Case
    
    # Check Bed Sheet (Double / King): slip 1 has 30 pick / 28 deliv; slip 2 has 20 pick / 20 deliv -> total 50 pick, 48 deliv, 2 loss
    bed_sheet_summary = next(s for s in summaries if s.zoho_item_id == "item_bed_sheet_dbl")
    assert bed_sheet_summary.total_pickup_qty == 50
    assert bed_sheet_summary.total_delivery_qty == 48
    assert bed_sheet_summary.total_loss_qty == 2
    assert bed_sheet_summary.line_total_amount == round(50 * 18.50, 2)
    assert "B/Sheet Dbl" in bed_sheet_summary.raw_names_seen
    assert "Double Bedsheet" in bed_sheet_summary.raw_names_seen

    # Check Pillow Case: medium confidence in slip 2 -> summary confidence should be MEDIUM
    pillow_summary = next(s for s in summaries if s.zoho_item_id == "item_pillow_case")
    assert pillow_summary.confidence_score == ConfidenceLevel.MEDIUM


def test_unmatched_item_handling(sample_zoho_items):
    ocr = GeminiOCRService()
    unmatched = ocr.find_best_matching_item("Unknown Exotic Linen X100", sample_zoho_items)
    assert unmatched is None

    extraction = OCRSlipExtraction(
        file_name="unmatched_slip.jpg",
        client_name="Test Client",
        items=[
            OCRSlipItem(
                raw_item_name="Unknown Exotic Linen X100",
                pickup_qty=10,
                delivery_qty=10,
            )
        ],
    )
    ocr._reconcile_with_catalog(extraction, sample_zoho_items)
    assert extraction.items[0].confidence_score == ConfidenceLevel.LOW
    assert "Unmatched SKU" in extraction.items[0].remarks

