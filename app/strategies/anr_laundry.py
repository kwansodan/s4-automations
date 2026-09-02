"""ANR Group Commercial Laundry Automation Strategy."""

from typing import List, Dict, Any, Optional
from datetime import datetime

from app.strategies.base import BaseAutomationStrategy, SourceDocument, SourceType, ExtractedLineItem
from app.services.google_drive_service import GoogleDriveService
from app.services.google_sheets_service import GoogleSheetsService
from app.services.ocr_service import GeminiOCRService
from app.services.zoho_service import ZohoBooksService
from app.models.schemas import OCRSlipExtraction
from app.utils.logging import get_logger

logger = get_logger("strategy.anr")


class ANRLaundryStrategy(BaseAutomationStrategy):
    """
    Production Strategy for ANR Group:
    1. Scan Drive for daily handwritten slips
    2. Gemini 3.6 Flash Vision OCR extraction
    3. 2-Tab Google Sheets review sync
    4. Zoho Books Draft Invoicing
    """

    def __init__(self):
        super().__init__(client_id="anr_group", client_name="ANR Group (Commercial Laundry)")
        self.drive = GoogleDriveService()
        self.sheets = GoogleSheetsService()
        self.ocr = GeminiOCRService()
        self.zoho = ZohoBooksService()

    async def discover_sources(self, month: str, year: int) -> List[SourceDocument]:
        """Discovers unparsed control slip images from Google Drive folder."""
        month_folder_id = self.drive.get_month_folder(month, year)
        drive_files = self.drive.list_unprocessed_slips(month_folder_id)
        
        sources = []
        for df in drive_files:
            sources.append(
                SourceDocument(
                    file_name=df.get("name", "slip.jpg"),
                    source_type=SourceType.GOOGLE_DRIVE,
                    source_identifier=df.get("id"),
                    mime_type=df.get("mimeType", "image/jpeg"),
                    metadata={"folder_id": month_folder_id, "drive_file_id": df.get("id")},
                )
            )
        return sources

    async def extract_and_validate(self, sources: List[SourceDocument]) -> List[ExtractedLineItem]:
        """Runs Gemini 3.6 Flash Vision structured OCR extraction."""
        items: List[ExtractedLineItem] = []
        catalog = await self.zoho.fetch_item_catalog()

        for src in sources:
            file_bytes = src.file_bytes or self.drive.download_file_bytes(src.source_identifier)
            if isinstance(file_bytes, tuple):
                file_bytes = file_bytes[0]

            extracted_slip: OCRSlipExtraction = await self.ocr.extract_slip_data(
                file_bytes=file_bytes,
                mime_type=src.mime_type,
                file_name=src.file_name,
                client_name=self.client_name,
                item_catalog=catalog,
            )

            for line in extracted_slip.items:
                discrepancy = max(0, (line.pickup_qty or 0) - (line.delivery_qty or 0))
                unit_rate = line.unit_rate or 15.0
                total_billed = (line.delivery_qty or 0) * unit_rate

                items.append(
                    ExtractedLineItem(
                        item_or_description=line.standard_item_name or line.raw_item_name,
                        category_or_account="Linen Laundry Service",
                        quantity_or_debit=float(line.delivery_qty or 0),
                        credit_amount=float(line.pickup_qty or 0),
                        unit_price=float(unit_rate),
                        total_amount=float(total_billed),
                        discrepancy=float(discrepancy),
                        raw_extracted_data={
                            "hotel_name": extracted_slip.client_name,
                            "date": extracted_slip.slip_date,
                            "file_name": src.file_name,
                            "source_identifier": src.source_identifier,
                        },
                    )
                )
        return items

    async def sync_review_workspace(
        self, month: str, year: int, items: List[ExtractedLineItem]
    ) -> Dict[str, Any]:
        """Syncs extracted line items into Google Sheets Tab 1 & Tab 2."""
        month_folder_id = self.drive.get_month_folder(month, year)
        sheet_id, sheet_url = self.sheets.find_or_create_workbook(month, year, month_folder_id)

        from app.models.schemas import DailySlipDetailRow, MonthlySummaryRow, ConfidenceLevel, SlipStatus

        detail_rows = []
        for i in items:
            raw = i.raw_extracted_data or {}
            detail_rows.append(
                DailySlipDetailRow(
                    slip_date=raw.get("date", datetime.now().strftime("%Y-%m-%d")),
                    file_name=raw.get("file_name", "slip.jpg"),
                    client_name=raw.get("hotel_name", "ANR Client"),
                    raw_item_name=raw.get("raw_item_name", i.item_or_description),
                    standard_item_name=i.item_or_description,
                    pickup_qty=int(i.credit_amount),
                    delivery_qty=int(i.quantity_or_debit),
                    loss_qty=int(i.discrepancy),
                    confidence_score=ConfidenceLevel.HIGH,
                    drive_file_url="",
                    processed_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                )
            )

        self.sheets.append_daily_slip_details(sheet_id, detail_rows)

        summary_rows = [
            MonthlySummaryRow(
                client_name="ANR Client",
                zoho_contact_id="zoho_contact_anr",
                zoho_item_id="zoho_item_01",
                standard_item_name=i.item_or_description,
                raw_names_seen=i.item_or_description,
                confidence_score=ConfidenceLevel.HIGH,
                unit_rate=i.unit_price,
                total_picked_up=int(i.credit_amount),
                total_delivered=int(i.quantity_or_debit),
                linen_discrepancy=int(i.discrepancy),
                total_billed=i.total_amount,
                audit_notes="OCR Extracted",
                status=SlipStatus.PENDING,
            )
            for i in items
        ]
        self.sheets.sync_monthly_summaries(sheet_id, summary_rows)

        return {
            "spreadsheet_id": sheet_id,
            "spreadsheet_url": sheet_url,
            "daily_rows_written": len(detail_rows),
        }

    async def post_to_accounting(
        self, month: str, year: int, approved_items: Optional[List[Any]] = None
    ) -> Dict[str, Any]:
        """Creates or appends to Zoho Books Draft Invoices."""
        from app.workflows.zoho_invoice_generator import run_zoho_invoices_core
        return await run_zoho_invoices_core(month=month, year=year)
