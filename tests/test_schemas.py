"""Tests for Pydantic models and schemas."""

import pytest
from app.models.schemas import (
    ConfidenceLevel,
    SlipStatus,
    OCRSlipItem,
    OCRSlipExtraction,
    MonthlySKUSummary,
    DailySlipDetailRow,
    MonthlySummaryRow,
    ZohoContact,
    ZohoItem,
    ZohoDraftInvoiceRequest,
    ZohoInvoiceLineItem,
)


def test_ocr_slip_item_defaults():
    item = OCRSlipItem(raw_item_name="B/Sheet Dbl", pickup_qty=20, delivery_qty=18)
    assert item.raw_item_name == "B/Sheet Dbl"
    assert item.pickup_qty == 20
    assert item.delivery_qty == 18
    assert item.confidence_score == ConfidenceLevel.HIGH


def test_monthly_sku_summary_raw_names_display():
    summary = MonthlySKUSummary(
        client_name="Luxwood",
        standard_item_name="Bed Sheet (Double / King)",
        raw_names_seen=["B/Sheet Dbl", "Double Bedsheet", "B/Sheet Dbl"],
        unit_rate=18.50,
        total_pickup_qty=50,
        total_delivery_qty=48,
        total_loss_qty=2,
        line_total_amount=925.00,
    )
    assert "B/Sheet Dbl" in summary.raw_names_display
    assert "Double Bedsheet" in summary.raw_names_display


def test_daily_slip_detail_to_sheet_row():
    row = DailySlipDetailRow(
        slip_date="15/08/2026",
        file_name="slip_01.jpg",
        client_name="Luxwood",
        raw_item_name="B/Sheet Dbl",
        standard_item_name="Bed Sheet (Double / King)",
        pickup_qty=25,
        delivery_qty=23,
        loss_qty=2,
        confidence_score=ConfidenceLevel.HIGH,
        drive_file_url="https://drive.google.com/file/d/123/view",
        processed_at="2026-08-28 10:00:00",
    )
    sheet_row = row.to_sheet_row()
    assert len(sheet_row) == 11
    assert sheet_row[0] == "15/08/2026"
    assert '=HYPERLINK("https://drive.google.com/file/d/123/view", "View Scan ↗")' in sheet_row[9]


def test_monthly_summary_to_sheet_row():
    row = MonthlySummaryRow(
        client_name="The Lennox",
        zoho_contact_id="cnt_the_lennox_003",
        zoho_item_id="item_bath_towel",
        standard_item_name="Bath Towel",
        raw_names_seen="B/Towel, Bath Towel",
        confidence_score=ConfidenceLevel.MEDIUM,
        unit_rate=12.00,
        total_picked_up=100,
        total_delivered=95,
        linen_discrepancy=5,
        total_billed=1200.00,
        audit_notes="Discrepancy 5 unreturned",
        reviewed=True,
        approved=False,
        status=SlipStatus.PENDING,
    )
    sheet_row = row.to_sheet_row()
    assert len(sheet_row) == 15
    assert sheet_row[0] == "The Lennox"
    assert sheet_row[5] == "MEDIUM"
    assert sheet_row[6] == 12.0
    assert sheet_row[12] is True
    assert sheet_row[13] is False
    assert sheet_row[14] == "PENDING"
