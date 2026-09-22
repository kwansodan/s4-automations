"""Commercial Laundry Automation Strategy for Daily Handwritten Pickup/Delivery Slips."""

from typing import List, Dict, Any, Optional
from datetime import datetime

from app.strategies.base import BaseAutomationStrategy, SourceDocument, SourceType, ExtractedLineItem
from app.services.google_drive_service import GoogleDriveService
from app.services.google_sheets_service import GoogleSheetsService
from app.services.ocr_service import GeminiOCRService
from app.services.zoho_service import ZohoBooksService
from app.models.schemas import OCRSlipExtraction
from app.config import settings
from app.utils.date_parser import resolve_transaction_date
from app.utils.logging import get_logger

logger = get_logger("strategy.commercial_laundry")


class CommercialLaundryStrategy(BaseAutomationStrategy):
    """
    Commercial Laundry Industry Strategy:
    1. Scan Drive for daily handwritten pickup/delivery slips (deep hierarchy)
    2. Gemini Flash Vision OCR extraction
    3. PostgreSQL Ledger staging with linen loss reconciliation
    4. Zoho Books Draft Invoicing
    """

    def __init__(self, client_id: str = "commercial_laundry", client_name: str = "Commercial Laundry"):
        super().__init__(client_id=client_id, client_name=client_name)
        self.drive = GoogleDriveService()
        self.sheets = GoogleSheetsService()
        self.ocr = GeminiOCRService()
        self.zoho = ZohoBooksService()

    async def discover_sources(self, month: str, year: int) -> List[SourceDocument]:
        """Discovers unparsed control slip images from Google Drive folder, checking direct files and subfolders."""
        root_id = (settings.CONTROL_SHEETS_FOLDER_ID or "").strip()

        # 1. First attempt deep resilient discovery across root folder
        sources: List[SourceDocument] = []
        if root_id:
            sources = self.drive.discover_pipeline_hierarchy(folder_id=root_id, month=month, year=year)

        if not sources:
            # Fallback to direct month folder check
            month_folder_id = self.drive.get_month_folder(month, year)
            if month_folder_id:
                # Check direct files and any customer subfolders inside the month folder
                sources = self.drive.discover_pipeline_hierarchy(folder_id=month_folder_id, month=month, year=year)
                if not sources:
                    drive_files = self.drive.list_unprocessed_slips(month_folder_id)
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
        logger.info(f"Discovered {len(sources)} source slip files for {self.client_name} ({month} {year}).")
        return sources

    async def extract_and_validate(self, sources: List[SourceDocument], **kwargs) -> List[ExtractedLineItem]:
        """Runs Gemini Vision structured OCR extraction."""
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
                            "date": resolve_transaction_date(
                                extracted_date=extracted_slip.slip_date,
                                file_name=src.file_name,
                                target_month=kwargs.get("month"),
                                target_year=kwargs.get("year"),
                            ),
                            "file_name": src.file_name,
                            "source_identifier": src.source_identifier,
                            "drive_file_url": src.metadata.get("drive_file_url") or (f"https://drive.google.com/file/d/{src.source_identifier}/view" if src.source_identifier else ""),
                        },
                    )
                )
        return items

    async def sync_review_workspace(
        self, month: str, year: int, items: List[ExtractedLineItem]
    ) -> Dict[str, Any]:
        """Stages extracted line items into PostgreSQL staged_transactions."""
        from app.models.db_models import StagedTransaction
        from app.db.session import get_engine
        from sqlmodel import Session
        import uuid

        batch_id = f"batch_{self.client_id}_{month.lower()}_{year}_{uuid.uuid4().hex[:6]}"
        staged_count = 0

        try:
            with Session(get_engine()) as session:
                for i in items:
                    raw = i.raw_extracted_data or {}
                    file_name = raw.get("file_name") or "slip.jpg"
                    source_identifier = raw.get("source_identifier")
                    tx_date = resolve_transaction_date(
                        extracted_date=raw.get("date"),
                        file_name=file_name,
                        target_month=month,
                        target_year=year,
                    )
                    drive_url = raw.get("drive_file_url") or (f"https://drive.google.com/file/d/{source_identifier}/view" if source_identifier else "")
                    raw["drive_file_url"] = drive_url

                    staged = StagedTransaction(
                        client_id=self.client_id,
                        batch_id=batch_id,
                        pipeline_id="pipe_daily_slips",
                        pipeline_name="Daily Control Slips OCR",
                        pipeline_type="AR",
                        entity_type="ar_sales_invoice",
                        transaction_date=str(tx_date),
                        source_type="google_drive",
                        source_file_name=str(file_name),
                        source_identifier=source_identifier,
                        item_or_description=i.item_or_description,
                        category_or_account=i.category_or_account or "Linen Laundry Service",
                        quantity_or_debit=i.quantity_or_debit,
                        credit_amount=i.credit_amount,
                        rate_or_price=i.unit_price,
                        total_amount=i.total_amount,
                        reviewed=False,
                        approved=False,
                        status="PENDING",
                        validation_status="VALID",
                        confidence_score=0.96,
                        discrepancy_amount=i.discrepancy,
                        checksum=i.source_checksum,
                        metadata_json=raw,
                    )
                    session.add(staged)
                    staged_count += 1
                session.commit()
            logger.info(f"Successfully staged {staged_count} transactions into PostgreSQL for {self.client_name}")
        except Exception as db_err:
            logger.error(f"Error staging transactions into database: {db_err}")
            self.execution_warnings.append(f"Database staging error: {db_err}")

        # Database ledger staging complete (Google Sheets eliminated)
        sheet_id, sheet_url = None, None

        return {
            "spreadsheet_id": sheet_id,
            "spreadsheet_url": sheet_url,
            "staged_transactions_count": staged_count,
        }

    async def post_to_accounting(
        self, month: str, year: int, approved_items: Optional[List[Any]] = None
    ) -> Dict[str, Any]:
        """Creates or appends to Zoho Books Draft Invoices."""
        from app.workflows.zoho_invoice_generator import run_zoho_invoices_core
        return await run_zoho_invoices_core(target_month=month, target_year=year)


# Backwards compatibility alias
ANRLaundryStrategy = CommercialLaundryStrategy
