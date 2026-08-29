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
            extracted_slip: OCRSlipExtraction = await self.ocr.extract_slip_data(
                image_bytes=file_bytes,
                file_name=src.file_name,
                item_catalog=catalog,
                mime_type=src.mime_type,
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

        daily_rows = []
        for i in items:
            raw = i.raw_extracted_data
            daily_rows.append({
                "date": raw.get("date", datetime.now().strftime("%Y-%m-%d")),
                "client_name": raw.get("hotel_name", "ANR Client"),
                "file_name": raw.get("file_name", "slip.jpg"),
                "item_name": i.item_or_description,
                "category": i.category_or_account or "General",
                "pickup_quantity": int(i.credit_amount),
                "delivery_quantity": int(i.quantity_or_debit),
                "discrepancy": int(i.discrepancy),
                "unit_price": i.unit_price,
                "total_amount": i.total_amount,
            })

        self.sheets.append_daily_details(sheet_id, daily_rows)
        self.sheets.update_monthly_summary(sheet_id)

        return {
            "spreadsheet_id": sheet_id,
            "spreadsheet_url": sheet_url,
            "daily_rows_written": len(daily_rows),
        }

    async def post_to_accounting(
        self, month: str, year: int, approved_items: Optional[List[Any]] = None
    ) -> Dict[str, Any]:
        """Creates or appends to Zoho Books Draft Invoices."""
        from app.workflows.zoho_invoice_generator import run_zoho_invoices_core
        return await run_zoho_invoices_core(month=month, year=year)
