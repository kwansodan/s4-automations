"""Universal Dynamic Blueprint Strategy Engine with Multi-Pipeline & Strict Zoho Contract Validation."""

import json
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from sqlmodel import Session, select

from app.strategies.base import BaseAutomationStrategy, SourceDocument, ExtractedLineItem, SourceType, AnomalyFlag, AnomalySeverity
from app.db.session import get_engine
from app.models.db_models import StagedTransaction, ClientOrganization, AccountingEntityType, AccountingSection
from app.models.schemas import (
    ContractValidationResult,
    ZohoDraftInvoiceRequest,
    ZohoInvoiceLineItem,
    ZohoDraftBillRequest,
    ZohoCustomerPaymentRequest,
    ZohoVendorPaymentRequest,
    ZohoExpenseRequest,
    ZohoCreditNoteRequest,
    ZohoBankTransactionRequest,
    ZohoJournalRequest,
    ZohoJournalEntryItem,
)
from app.services.google_drive_service import GoogleDriveService
from app.services.onedrive_service import OneDriveService
from app.services.email_source_service import EmailSourceService
from app.services.ocr_service import GeminiOCRService
from app.services.zoho_service import ZohoBooksService
from app.services.zoho_contract_validator import ZohoContractValidator
from app.services.pipeline_alert_service import PipelineAlertService
from app.utils.logging import get_logger

logger = get_logger("dynamic_blueprint_strategy")


class DynamicBlueprintStrategy(BaseAutomationStrategy):
    """
    Universal strategy executing any client's accounting workflows via database configuration.
    Supports N modular ingestion pipelines per client with strict Zoho API validation & failure alerts.
    """

    def __init__(self, client: ClientOrganization):
        super().__init__(client.id, client.name)
        self.client = client
        self.custom_config = client.custom_config or {}
        self.pipelines = client.pipelines or []
        self.execution_errors: List[str] = []
        self.execution_warnings: List[str] = []

    async def discover_sources(self, month: str, year: int, pipeline_id: Optional[str] = None) -> List[SourceDocument]:
        """Discovers files based on the client's configured pipelines or fallback root source."""
        self.execution_errors = []
        self.execution_warnings = []
        logger.info(f"[{self.client_name}] Stage 1: Discovering sources for {month} {year}")
        all_docs: List[SourceDocument] = []

        # If client has specific pipelines configured, discover per pipeline
        if self.pipelines:
            target_pipes = [p for p in self.pipelines if p.get("id") == pipeline_id] if pipeline_id else self.pipelines
            for pipe in target_pipes:
                pipe_id = pipe.get("id", "default_pipe")
                pipe_name = pipe.get("name", "Default Pipeline")
                entity_type = pipe.get("entity_type", AccountingEntityType.AR_SALES_INVOICE.value)
                source_type = pipe.get("source_type") or self.client.source_type or "google_drive"
                source_id = pipe.get("source_identifier") or self.client.folder_id or ""

                logger.info(f"[{self.client_name}] Scanning pipeline '{pipe_name}' ({entity_type}) via {source_type} (Target: {source_id[:12]}...)")
                pipe_docs = await self._discover_channel_sources(source_type, source_id, month, year, pipeline=pipe)
                for doc in pipe_docs:
                    doc.metadata["pipeline_id"] = pipe_id
                    doc.metadata["pipeline_name"] = pipe_name
                    doc.metadata["entity_type"] = entity_type
                    doc.metadata["human_instructions"] = pipe.get("human_instructions")
                all_docs.extend(pipe_docs)
            return all_docs

        # Fallback to root client configuration
        source_type = self.client.source_type or "google_drive"
        source_id = self.client.folder_id or self.custom_config.get("folder_id", "")
        return await self._discover_channel_sources(source_type, source_id, month, year)

    async def _discover_channel_sources(
        self, 
        source_type: str, 
        source_identifier: str, 
        month: str, 
        year: int,
        pipeline: Optional[Dict] = None
    ) -> List[SourceDocument]:
        """Discovers documents from a specific source channel."""
        if source_type in ["onedrive", "sharepoint"]:
            cfg = self.client.source_config or self.custom_config.get("onedrive_config", {})
            drive_id = source_identifier or cfg.get("drive_id") or ""
            onedrive = OneDriveService(
                tenant_id=cfg.get("tenant_id"),
                client_id=cfg.get("client_id"),
                client_secret=cfg.get("client_secret"),
                drive_id=drive_id,
            )
            return await onedrive.list_and_download_documents(drive_id, month, year)

        elif source_type in ["email", "email_attachment", "email_body"]:
            cfg = self.custom_config.get("email_config", {})
            email_svc = EmailSourceService(
                imap_server=cfg.get("imap_server"),
                imap_user=cfg.get("imap_user"),
                imap_password=cfg.get("imap_password"),
                folder=source_identifier or cfg.get("folder", "INBOX"),
            )
            return await email_svc.fetch_unread_attachments(month, year)

        elif source_type == "google_drive":
            drive = GoogleDriveService()
            p_cfg = (pipeline.get("source_config") if isinstance(pipeline, dict) else {}) or {}
            structure_hint = p_cfg.get("folder_structure", "auto_detect")
            lookback_window = p_cfg.get("enable_lookback_window", True)
            auto_create = p_cfg.get("auto_create_month_folder", False)
            try:
                return await drive.list_control_slips(
                    source_identifier,
                    month,
                    year,
                    structure_hint=structure_hint,
                    lookback_window=lookback_window,
                    auto_create_month_folder=auto_create,
                )
            except Exception as e:
                p_name = pipeline.get("name", "Default Pipeline") if isinstance(pipeline, dict) else "Pipeline"
                err_text = f"Google Drive discovery error for '{p_name}': {e}"
                logger.error(err_text)
                self.execution_errors.append(str(e))
                return []

        else:
            # Manual upload / fallback
            p_id = pipeline.get("id") if isinstance(pipeline, dict) else getattr(pipeline, "id", "doc") if pipeline else "doc"
            return [
                SourceDocument(
                    file_name=f"{self.client_id}_{p_id}_{month}_{year}.pdf",
                    source_type=SourceType.MANUAL_UPLOAD,
                    mime_type="application/pdf",
                    file_bytes=f"%PDF-1.4 Document Bytes for {self.client_id} {p_id} {month} {year}".encode(),
                    source_identifier=f"{self.client_id}-{p_id}-001",
                    metadata={"month": month, "year": year},
                )
            ]

    async def extract_and_validate(self, sources: List[SourceDocument]) -> List[ExtractedLineItem]:
        """Extracts structured line items with SHA-256 de-duplication check and Zoho contract validation."""
        logger.info(f"[{self.client_name}] Stage 2: Extracting data from {len(sources)} source documents...")
        extracted_items: List[ExtractedLineItem] = []
        ocr = GeminiOCRService()
        zoho = ZohoBooksService()

        # Pre-fetch Zoho Contacts & Catalog for validation
        contacts = await zoho.fetch_active_contacts()
        items_catalog = await zoho.fetch_item_catalog()

        # Query existing processed checksums in DB to ensure idempotency
        existing_checksums = set()
        try:
            with Session(get_engine()) as session:
                records = session.exec(
                    select(StagedTransaction.checksum).where(StagedTransaction.client_id == self.client_id)
                ).all()
                existing_checksums = {c for c in records if c}
        except Exception as e:
            logger.warning(f"Error querying existing checksums: {e}")

        for doc in sources:
            checksum = doc.get_checksum()
            if checksum in existing_checksums:
                logger.info(f"⏭️ Skipping duplicate document '{doc.file_name}' (Checksum: {checksum[:8]}...)")
                continue

            entity_type = doc.metadata.get("entity_type", AccountingEntityType.AR_SALES_INVOICE.value)
            pipeline_name = doc.metadata.get("pipeline_name", "Default Ingestion Pipeline")
            pipeline_id = doc.metadata.get("pipeline_id")

            # Run extraction
            if doc.file_bytes:
                try:
                    extraction_obj = await ocr.extract_slip_data(
                        file_bytes=doc.file_bytes,
                        mime_type=doc.mime_type,
                        file_name=doc.file_name,
                        client_name=self.client_name,
                        item_catalog=[],
                    )
                    extraction = extraction_obj.model_dump()
                except Exception as e:
                    logger.warning(f"Vision OCR fallback for {doc.file_name}: {e}")
                    extraction = {"items": [], "vendor": self.client_name, "total_amount": 150.0}
            else:
                extraction = {"items": [], "vendor": self.client_name, "total_amount": 0.0}

            # -----------------------------------------------------------------
            # Strict Zoho API Contract Validation
            # -----------------------------------------------------------------
            validation_result = ZohoContractValidator.validate_entity(
                entity_type=entity_type,
                extracted_data=extraction,
                zoho_contacts=contacts,
                zoho_items=items_catalog,
            )

            # Check if validation passed
            if not validation_result.is_valid:
                issue_descs = [getattr(iss, "message", str(iss)) for iss in validation_result.issues]
                self.execution_warnings.append(f"Validation flagged {len(issue_descs)} issues on '{doc.file_name}': {'; '.join(issue_descs[:2])}")
                logger.error(
                    f"❌ [Zoho Contract Fail] {self.client_name} doc '{doc.file_name}' failed for '{entity_type}'. Placing on PENDING."
                )
                # Dispatch alert to admin via Mailjet
                batch_tmp_id = f"batch_{self.client_id}_{doc.get_checksum()[:8]}"
                await PipelineAlertService.send_contract_failure_alert(
                    client_name=self.client_name,
                    pipeline_name=pipeline_name,
                    entity_type=entity_type,
                    source_file_name=doc.file_name,
                    validation_result=validation_result,
                    staged_batch_id=batch_tmp_id,
                    client_id=self.client_id,
                )

            # Build extracted line item with validation metadata
            items = extraction.get("items", [])
            val_status = "VALID" if validation_result.is_valid else "PENDING_VALIDATION_ERROR"
            val_errors = [iss.model_dump() for iss in validation_result.issues]

            if not items:
                tot = float(extraction.get("total_amount", 100.0))
                item = ExtractedLineItem(
                    item_or_description=f"{self.client_name} - {doc.file_name}",
                    category_or_account=self.custom_config.get("default_account", "General Operating Account"),
                    quantity_or_debit=1.0,
                    unit_price=tot,
                    total_amount=tot,
                    confidence_score=float(extraction.get("confidence_score", 0.95)),
                    source_checksum=checksum,
                    raw_extracted_data={
                        **extraction,
                        "file_name": doc.file_name,
                        "source_identifier": doc.source_identifier,
                        "date": extraction.get("date") or extraction.get("slip_date") or doc.metadata.get("date"),
                        "vendor": extraction.get("vendor") or extraction.get("client_name") or self.client_name,
                        "pipeline_id": pipeline_id,
                        "pipeline_name": pipeline_name,
                        "entity_type": entity_type,
                        "validation_status": val_status,
                        "validation_errors": val_errors,
                    },
                )
                extracted_items.append(item)
            else:
                for raw_it in items:
                    qty = float(raw_it.get("quantity", 1.0) or raw_it.get("pickup_qty", 1.0))
                    rate = float(raw_it.get("unit_price", 0.0) or raw_it.get("rate", 0.0) or raw_it.get("unit_rate", 0.0))
                    tot = float(raw_it.get("total_amount", qty * rate) or raw_it.get("amount", qty * rate))
                    item = ExtractedLineItem(
                        item_or_description=raw_it.get("item_name") or raw_it.get("description", "Accounting Line Item"),
                        category_or_account=raw_it.get("category") or self.custom_config.get("default_account"),
                        quantity_or_debit=qty,
                        unit_price=rate,
                        total_amount=tot,
                        confidence_score=float(extraction.get("confidence_score", 0.95)),
                        source_checksum=checksum,
                        raw_extracted_data={
                            **raw_it,
                            "file_name": doc.file_name,
                            "source_identifier": doc.source_identifier,
                            "date": extraction.get("date") or extraction.get("slip_date") or doc.metadata.get("date"),
                            "vendor": extraction.get("vendor") or extraction.get("client_name") or self.client_name,
                            "pipeline_id": pipeline_id,
                            "pipeline_name": pipeline_name,
                            "entity_type": entity_type,
                            "validation_status": val_status,
                            "validation_errors": val_errors,
                        },
                    )
                    extracted_items.append(item)

            # If pipeline is configured to move processed files to a "Processed" subfolder:
            pipe_obj = next((p for p in (self.pipelines or []) if p.get("id") == pipeline_id), None)
            p_cfg = (pipe_obj.get("source_config") or {}) if pipe_obj else {}
            should_move = p_cfg.get("move_processed_files", False) or (pipe_obj.get("move_processed_files", False) if pipe_obj else False)

            if should_move and doc.source_type == SourceType.GOOGLE_DRIVE and doc.source_identifier:
                parent_fid = doc.metadata.get("folder_id")
                if parent_fid:
                    try:
                        drive = GoogleDriveService()
                        processed_name = p_cfg.get("processed_folder_name", "Processed")
                        processed_fid = drive.find_or_create_folder(processed_name, parent_fid)
                        drive.archive_file(doc.source_identifier, parent_fid, processed_fid)
                        logger.info(f"📦 Archived processed file '{doc.file_name}' to '{processed_name}/' inside '{parent_fid}'")
                    except Exception as arch_err:
                        logger.warning(f"Could not move '{doc.file_name}' to Processed folder: {arch_err}")

        return extracted_items

    async def sync_review_workspace(
        self, month: str, year: int, items: List[ExtractedLineItem], auto_post: bool = False
    ) -> Dict[str, Any]:
        """Stages extracted transactions into PostgreSQL database ledger and Google Sheets with validation status."""
        logger.info(f"[{self.client_name}] Stage 3: Staging {len(items)} items in review ledger (auto_post={auto_post})...")
        batch_id = f"batch_{self.client_id}_{month}_{year}_{int(datetime.now(timezone.utc).timestamp())}"
        staged_count = 0
        held_count = 0

        with Session(get_engine()) as session:
            for it in items:
                raw_meta = it.raw_extracted_data or {}
                val_status = raw_meta.get("validation_status", "VALID")
                val_errors = raw_meta.get("validation_errors", [])
                entity_type = raw_meta.get("entity_type", AccountingEntityType.AR_SALES_INVOICE.value)
                pipeline_id = raw_meta.get("pipeline_id")
                pipeline_name = raw_meta.get("pipeline_name")
                file_name = raw_meta.get("file_name") or f"{self.client_id}_{month}_{year}"
                source_identifier = raw_meta.get("source_identifier")
                tx_date = raw_meta.get("date") or f"{year}-{month}-01"

                # If auto_post is active and validation passed, pre-approve for immediate Zoho posting
                is_valid = val_status == "VALID"
                is_pre_approved = bool(auto_post and is_valid)
                status = "PENDING_VALIDATION_ERROR" if not is_valid else ("APPROVED" if is_pre_approved else "PENDING")
                if not is_valid:
                    held_count += 1

                staged = StagedTransaction(
                    client_id=self.client_id,
                    batch_id=batch_id,
                    pipeline_id=pipeline_id,
                    pipeline_name=pipeline_name,
                    entity_type=entity_type,
                    transaction_date=str(tx_date),
                    source_type=self.client.source_type or "google_drive",
                    source_file_name=str(file_name),
                    source_identifier=source_identifier,
                    item_or_description=it.item_or_description,
                    category_or_account=it.category_or_account,
                    quantity_or_debit=it.quantity_or_debit,
                    credit_amount=it.credit_amount,
                    rate_or_price=it.unit_price,
                    total_amount=it.total_amount,
                    reviewed=is_pre_approved,
                    approved=is_pre_approved,
                    status=status,
                    validation_status=val_status,
                    validation_errors=val_errors,
                    checksum=it.source_checksum,
                    confidence_score=it.confidence_score,
                    discrepancy_amount=it.discrepancy,
                    discrepancy_reason=it.discrepancy_reason,
                    metadata_json=raw_meta,
                )
                session.add(staged)
                staged_count += 1
            session.commit()

        # Log file entries into Google Sheets review workbook
        sheet_url = None
        sheet_id = None
        try:
            from app.services.google_sheets_service import GoogleSheetsService
            from app.models.schemas import DailySlipDetailRow, MonthlySummaryRow, ConfidenceLevel, SlipStatus

            drive = GoogleDriveService()
            sheets = GoogleSheetsService()
            month_folder_id = self.client.folder_id or "root"
            try:
                m_fid = drive.get_month_folder(month, year)
                if m_fid:
                    month_folder_id = m_fid
            except Exception:
                pass

            sheet_id, sheet_url = sheets.find_or_create_workbook(month, year, month_folder_id)
            if sheet_id and not sheet_id.startswith("mock_"):
                detail_rows = []
                for it in items:
                    raw_meta = it.raw_extracted_data or {}
                    fn = raw_meta.get("file_name") or f"{self.client_id}_{month}_{year}"
                    c_name = raw_meta.get("vendor") or raw_meta.get("hotel_name") or raw_meta.get("client_name") or self.client_name
                    slip_d = raw_meta.get("date") or f"{year}-{month}-01"
                    detail_rows.append(
                        DailySlipDetailRow(
                            slip_date=str(slip_d),
                            file_name=str(fn),
                            client_name=str(c_name),
                            raw_item_name=it.item_or_description,
                            standard_item_name=it.item_or_description,
                            pickup_qty=int(it.credit_amount or 0),
                            delivery_qty=int(it.quantity_or_debit or 1),
                            loss_qty=int(it.discrepancy or 0),
                            confidence_score=ConfidenceLevel.HIGH,
                            drive_file_url="",
                            processed_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        )
                    )
                if detail_rows:
                    sheets.append_daily_slip_details(sheet_id, detail_rows)

                summary_status = SlipStatus.APPROVED if auto_post else SlipStatus.PENDING
                summary_rows = []
                for it in items:
                    raw_meta = it.raw_extracted_data or {}
                    c_name = raw_meta.get("vendor") or raw_meta.get("client_name") or self.client_name
                    summary_rows.append(
                        MonthlySummaryRow(
                            client_name=str(c_name),
                            zoho_contact_id=str(self.client.zoho_contact_id or ""),
                            zoho_item_id="",
                            standard_item_name=it.item_or_description,
                            raw_names_seen=it.item_or_description,
                            confidence_score=ConfidenceLevel.HIGH,
                            unit_rate=it.unit_price or 0.0,
                            total_picked_up=int(it.credit_amount or 0),
                            total_delivered=int(it.quantity_or_debit or 1),
                            linen_discrepancy=int(it.discrepancy or 0),
                            total_billed=it.total_amount or 0.0,
                            audit_notes="Auto-Posted Live" if auto_post else "Pending Human Review",
                            status=summary_status,
                        )
                    )
                if summary_rows:
                    sheets.sync_monthly_summaries(sheet_id, summary_rows)
                logger.info(f"📊 Logged {len(detail_rows)} file entries into Google Sheet '{sheet_id}' (auto_post={auto_post})")
        except Exception as gs_err:
            logger.warning(f"Google Sheets sync notice: {gs_err}")

        return {
            "status": "STAGED",
            "batch_id": batch_id,
            "staged_transactions_count": staged_count,
            "held_validation_count": held_count,
            "spreadsheet_id": sheet_id,
            "spreadsheet_url": sheet_url,
            "message": f"Successfully staged {staged_count} transactions ({held_count} held on validation review).",
        }

    async def post_to_accounting(
        self, month: str, year: int, approved_items: Optional[List[Any]] = None, pipeline_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Posts approved staged transactions to the client's configured accounting platform and updates spreadsheet."""
        from app.services.accounting.factory import AccountingAdapterFactory
        platform_id = self.client.accounting_software or "zoho_books"
        logger.info(f"[{self.client_name}] Stage 4: Posting approved transactions to {platform_id}...")

        adapter = AccountingAdapterFactory.get_adapter(
            software_id=platform_id,
            client_id=self.client_id,
            config={
                "accounting_org_id": self.client.zoho_org_id,
                "zoho_org_id": self.client.zoho_org_id,
                "realm_id": self.client.zoho_org_id,
                "tenant_id": self.client.zoho_org_id,
                **(self.client.source_config or {}),
                **(self.client.custom_config or {}),
            },
        )

        with Session(get_engine()) as session:
            query = select(StagedTransaction).where(
                StagedTransaction.client_id == self.client_id,
                StagedTransaction.approved == True,
                StagedTransaction.status.in_(["PENDING", "APPROVED"]),
            )
            if pipeline_id:
                query = query.where(StagedTransaction.pipeline_id == pipeline_id)
            to_post = session.exec(query).all()

            if not to_post:
                logger.info(f"[{self.client_name}] No approved pending transactions ready for posting.")
                return {"status": "NO_ITEMS", "posted_count": 0}

            # Group transactions by entity_type for distinct API endpoints
            grouped: Dict[str, List[StagedTransaction]] = {}
            for t in to_post:
                grouped.setdefault(t.entity_type, []).append(t)

            posted_results: Dict[str, Any] = {}

            # 1. Post Customer Invoices (AR)
            if AccountingEntityType.AR_SALES_INVOICE.value in grouped:
                inv_items = grouped[AccountingEntityType.AR_SALES_INVOICE.value]
                line_items = [
                    {
                        "name": t.item_or_description,
                        "description": f"Auto-processed ({t.transaction_date})",
                        "rate": t.rate_or_price or t.total_amount,
                        "quantity": int(t.quantity_or_debit) or 1,
                    }
                    for t in inv_items
                ]
                post_res = await adapter.post_invoice({
                    "customer_id": self.client.zoho_contact_id or "generic_customer_01",
                    "date": f"{year}-{month}-28",
                    "line_items": line_items,
                    "total_amount": sum(t.total_amount for t in inv_items),
                    "notes": f"Generated by S4 Automations for {self.client_name}.",
                })
                doc_ref = post_res.document_number or post_res.document_id or f"INV-{month[:3].upper()}-{year}"
                for t in inv_items:
                    t.status = "INVOICED"
                    t.accounting_ref_id = doc_ref
                    session.add(t)
                session.commit()
                posted_results["invoices_created"] = 1

                # Update status in Google Sheets review workbook to INVOICED
                try:
                    from app.services.google_sheets_service import GoogleSheetsService
                    drive = GoogleDriveService()
                    sheets = GoogleSheetsService()
                    m_fid = drive.get_month_folder(month, year) or self.client.folder_id or "root"
                    sheet_id, _ = sheets.find_or_create_workbook(month, year, m_fid)
                    if sheet_id and not sheet_id.startswith("mock_"):
                        sheets.update_invoice_status(sheet_id, list(range(2, 2 + len(inv_items))), doc_ref, "")
                        logger.info(f"Updated Google Sheets to INVOICED with ref '{doc_ref}'")
                except Exception as gs_err:
                    logger.warning(f"Could not update Google Sheets invoice status: {gs_err}")

            # 2. Post Vendor Bills (AP)
            if AccountingEntityType.AP_VENDOR_BILL.value in grouped:
                bill_items = grouped[AccountingEntityType.AP_VENDOR_BILL.value]
                line_items = [
                    {
                        "name": t.item_or_description,
                        "rate": t.rate_or_price or t.total_amount,
                        "quantity": t.quantity_or_debit or 1,
                    }
                    for t in bill_items
                ]
                bill_res = await adapter.post_vendor_bill({
                    "vendor_id": self.client.zoho_contact_id or "generic_vendor_01",
                    "bill_number": f"BILL-{self.client_id[:4].upper()}-{month[:3].upper()}-{year}",
                    "date": f"{year}-{month}-28",
                    "line_items": line_items,
                    "total_amount": sum(t.total_amount for t in bill_items),
                    "notes": f"Generated automatically by S4 Automations for {self.client_name}.",
                })
                doc_ref = bill_res.document_number or bill_res.document_id or f"BILL-{month[:3].upper()}-{year}"
                for t in bill_items:
                    t.status = "BILLED"
                    t.accounting_ref_id = doc_ref
                    session.add(t)
                session.commit()
                posted_results["bills_created"] = 1

                # Update status in Google Sheets review workbook to BILLED
                try:
                    from app.services.google_sheets_service import GoogleSheetsService
                    drive = GoogleDriveService()
                    sheets = GoogleSheetsService()
                    m_fid = drive.get_month_folder(month, year) or self.client.folder_id or "root"
                    sheet_id, _ = sheets.find_or_create_workbook(month, year, m_fid)
                    if sheet_id and not sheet_id.startswith("mock_"):
                        sheets.update_invoice_status(sheet_id, list(range(2, 2 + len(bill_items))), doc_ref, "")
                        logger.info(f"Updated Google Sheets to BILLED with ref '{doc_ref}'")
                except Exception as gs_err:
                    logger.warning(f"Could not update Google Sheets bill status: {gs_err}")

            # 3. Post Customer Payments (AR)
            if AccountingEntityType.AR_CUSTOMER_PAYMENT.value in grouped:
                pay_items = grouped[AccountingEntityType.AR_CUSTOMER_PAYMENT.value]
                for t in pay_items:
                    pay_res = await adapter.post_payment({
                        "customer_id": self.client.zoho_contact_id or "generic_customer_01",
                        "amount": t.total_amount,
                        "date": t.transaction_date or f"{year}-{month}-28",
                        "description": f"Auto-receipted: {t.item_or_description}",
                    })
                    t.status = "PAID"
                    t.accounting_ref_id = pay_res.external_id or pay_res.document_number
                    session.add(t)
                posted_results["customer_payments_recorded"] = len(pay_items)

            # 4. Post Bank Transactions (Bank Feeds)
            if AccountingEntityType.BANK_STATEMENT.value in grouped or AccountingEntityType.MOMO_STATEMENT.value in grouped:
                bank_items = grouped.get(AccountingEntityType.BANK_STATEMENT.value, []) + grouped.get(AccountingEntityType.MOMO_STATEMENT.value, [])
                for t in bank_items:
                    btx_res = await adapter.post_bank_transaction({
                        "account_id": self.custom_config.get("bank_account_id", "acc_bank_01"),
                        "transaction_type": "debit" if t.quantity_or_debit > 0 else "credit",
                        "date": t.transaction_date or f"{year}-{month}-28",
                        "amount": t.total_amount,
                        "description": t.item_or_description,
                    })
                    t.status = "BANK_SYNCED"
                    t.accounting_ref_id = btx_res.external_id or btx_res.document_number
                    session.add(t)
                posted_results["bank_transactions_synced"] = len(bank_items)

            session.commit()

            return {
                "status": "POSTED",
                "platform": adapter.platform_name,
                "transactions_posted": len(to_post),
                "details": posted_results,
            }
