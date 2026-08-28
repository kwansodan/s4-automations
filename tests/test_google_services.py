"""Tests for Google Drive and Google Sheets services."""

import pytest
from app.models.schemas import DailySlipDetailRow, MonthlySummaryRow, ConfidenceLevel, SlipStatus
from app.services.google_drive_service import GoogleDriveService
from app.services.google_sheets_service import GoogleSheetsService


def test_drive_folder_operations():
    drive = GoogleDriveService()
    month_folder = drive.get_month_folder("August", 2026)
    assert "august_2026" in month_folder.lower()

    clients = drive.list_client_folders(month_folder)
    assert len(clients) > 0
    client_names = [c.client_name for c in clients]
    assert "Luxwood" in client_names

    unprocessed = drive.list_unprocessed_slips("mock_fld_luxwood")
    assert len(unprocessed) > 0

    archived = drive.archive_file("mock_file_1", "mock_fld_luxwood", "mock_fld_processed")
    assert archived is True


def test_sheets_workbook_and_sync():
    sheets = GoogleSheetsService()
    sheet_id, sheet_url = sheets.find_or_create_workbook("August", 2026, "mock_fld_august_2026")
    assert "mock_sheet_august_2026" in sheet_id
    assert sheet_url.startswith("https://docs.google.com/spreadsheets/d/")

    # Tab 1: Append detail rows
    detail_rows = [
        DailySlipDetailRow(
            slip_date="15/08/2026",
            file_name="slip_01.jpg",
            client_name="Luxwood",
            raw_item_name="B/Sheet Dbl",
            standard_item_name="Bed Sheet (Double / King)",
            pickup_qty=30,
            delivery_qty=28,
            loss_qty=2,
            confidence_score=ConfidenceLevel.HIGH,
            drive_file_url="https://drive.google.com/file/d/123/view",
            processed_at="2026-08-28 12:00:00",
        )
    ]
    appended = sheets.append_daily_slip_details(sheet_id, detail_rows)
    assert appended == 1

    # Tab 2: Sync monthly summary rows
    summary_rows = [
        MonthlySummaryRow(
            client_name="Luxwood",
            zoho_contact_id="cnt_luxwood_001",
            zoho_item_id="item_bed_sheet_dbl",
            standard_item_name="Bed Sheet (Double / King)",
            raw_names_seen="B/Sheet Dbl",
            confidence_score=ConfidenceLevel.HIGH,
            unit_rate=18.50,
            total_picked_up=30,
            total_delivered=28,
            linen_discrepancy=2,
            total_billed=555.00,
            audit_notes="Discrepancy 2 unreturned",
            reviewed=True,
            approved=True,
            status=SlipStatus.PENDING,
        )
    ]
    synced = sheets.sync_monthly_summaries(sheet_id, summary_rows)
    assert synced == 1

    # Tab 2: Fetch approved rows
    approved_rows = sheets.fetch_approved_monthly_rows(sheet_id)
    assert len(approved_rows) > 0
    assert approved_rows[0]["approved"] is True

    # Update status to INVOICED
    sheets.update_invoice_status(sheet_id, [2], "INV-ANR-00100", "https://books.zoho.com/inv/1")
