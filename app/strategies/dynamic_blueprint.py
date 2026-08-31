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

    async def discover_sources(self, month: str, year: int, pipeline_id: Optional[str] = None) -> List[SourceDocument]:
        """Discovers files based on the client's configured pipelines or fallback root source."""
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
            return await drive.list_control_slips(source_identifier, month, year)

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
                            "pipeline_id": pipeline_id,
                            "pipeline_name": pipeline_name,
                            "entity_type": entity_type,
                            "validation_status": val_status,
                            "validation_errors": val_errors,
                        },
                    )
                    extracted_items.append(item)

        return extracted_items

    async def sync_review_workspace(
        self, month: str, year: int, items: List[ExtractedLineItem]
    ) -> Dict[str, Any]:
        """Stages extracted transactions into PostgreSQL database ledger with validation status."""
        logger.info(f"[{self.client_name}] Stage 3: Staging {len(items)} items in review ledger...")
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

                status = "PENDING_VALIDATION_ERROR" if val_status != "VALID" else "PENDING"
                if status == "PENDING_VALIDATION_ERROR":
                    held_count += 1

                staged = StagedTransaction(
                    client_id=self.client_id,
                    batch_id=batch_id,
                    pipeline_id=pipeline_id,
                    pipeline_name=pipeline_name,
                    entity_type=entity_type,
                    transaction_date=f"{year}-{month}-01",
                    source_type=self.client.source_type or "system",
                    source_file_name=f"{self.client_id}_{month}_{year}",
                    item_or_description=it.item_or_description,
                    category_or_account=it.category_or_account,
                    quantity_or_debit=it.quantity_or_debit,
                    credit_amount=it.credit_amount,
                    rate_or_price=it.unit_price,
                    total_amount=it.total_amount,
                    reviewed=False,
                    approved=False,
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

        return {
            "status": "STAGED",
            "batch_id": batch_id,
            "staged_transactions_count": staged_count,
            "held_validation_count": held_count,
            "message": f"Successfully staged {staged_count} transactions ({held_count} held on validation review).",
        }

    async def post_to_accounting(
        self, month: str, year: int, approved_items: Optional[List[Any]] = None
    ) -> Dict[str, Any]:
        """Posts approved staged transactions to Zoho Books routing to correct entity endpoints."""
        logger.info(f"[{self.client_name}] Stage 4: Posting approved transactions to Zoho Books...")
        zoho = ZohoBooksService()

        with Session(get_engine()) as session:
            query = select(StagedTransaction).where(
                StagedTransaction.client_id == self.client_id,
                StagedTransaction.approved == True,
                StagedTransaction.status.in_(["PENDING", "APPROVED"]),
            )
            to_post = session.exec(query).all()

            if not to_post:
                logger.info(f"[{self.client_name}] No approved pending transactions ready for posting.")
                return {"status": "NO_ITEMS", "posted_count": 0}

            # Group transactions by entity_type for distinct Zoho API endpoints
            grouped: Dict[str, List[StagedTransaction]] = {}
            for t in to_post:
                grouped.setdefault(t.entity_type, []).append(t)

            posted_results: Dict[str, Any] = {}

            # 1. Post Customer Invoices (AR)
            if AccountingEntityType.AR_SALES_INVOICE.value in grouped:
                inv_items = grouped[AccountingEntityType.AR_SALES_INVOICE.value]
                line_items = [
                    ZohoInvoiceLineItem(
                        item_id="",
                        name=t.item_or_description,
                        description=f"Auto-processed ({t.transaction_date})",
                        rate=t.rate_or_price or t.total_amount,
                        quantity=int(t.quantity_or_debit) or 1,
                    )
                    for t in inv_items
                ]
                req = ZohoDraftInvoiceRequest(
                    customer_id=self.client.zoho_contact_id or "782910482_generic_customer",
                    date=f"{year}-{month}-28",
                    line_items=line_items,
                    notes=f"Generated by S4 Automations for {self.client_name}.",
                )
                res = await zoho.create_draft_invoice(req)
                for t in inv_items:
                    t.status = "INVOICED"
                    t.accounting_ref_id = res.invoice_id
                    session.add(t)
                posted_results["invoices_created"] = 1

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
                bill_req = ZohoDraftBillRequest(
                    vendor_id=self.client.zoho_contact_id or "782910482_vendor",
                    bill_number=f"BILL-{self.client_id[:4].upper()}-{month[:3].upper()}-{year}",
                    date=f"{year}-{month}-28",
                    line_items=line_items,
                    notes=f"Generated automatically by S4 Automations for {self.client_name}.",
                )
                bill_res = await zoho.create_draft_bill(bill_req)
                for t in bill_items:
                    t.status = "BILLED"
                    t.accounting_ref_id = bill_res.bill_id
                    session.add(t)
                posted_results["bills_created"] = 1

            # 3. Post Customer Payments (AR)
            if AccountingEntityType.AR_CUSTOMER_PAYMENT.value in grouped:
                pay_items = grouped[AccountingEntityType.AR_CUSTOMER_PAYMENT.value]
                for t in pay_items:
                    pay_req = ZohoCustomerPaymentRequest(
                        customer_id=self.client.zoho_contact_id or "782910482_customer",
                        amount=t.total_amount,
                        date=t.transaction_date or f"{year}-{month}-28",
                        description=f"Auto-receipted: {t.item_or_description}",
                    )
                    pay_res = await zoho.create_customer_payment(pay_req)
                    t.status = "PAID"
                    t.accounting_ref_id = pay_res.payment_id
                    session.add(t)
                posted_results["customer_payments_recorded"] = len(pay_items)

            # 4. Post Bank Transactions (Bank Feeds)
            if AccountingEntityType.BANK_STATEMENT.value in grouped or AccountingEntityType.MOMO_STATEMENT.value in grouped:
                bank_items = grouped.get(AccountingEntityType.BANK_STATEMENT.value, []) + grouped.get(AccountingEntityType.MOMO_STATEMENT.value, [])
                for t in bank_items:
                    btx_req = ZohoBankTransactionRequest(
                        from_account_id=self.custom_config.get("bank_account_id", "acc_bank_01"),
                        transaction_type="debit" if t.quantity_or_debit > 0 else "credit",
                        date=t.transaction_date or f"{year}-{month}-28",
                        amount=t.total_amount,
                        description=t.item_or_description,
                    )
                    btx_res = await zoho.create_bank_transaction(btx_req)
                    t.status = "BANK_SYNCED"
                    t.accounting_ref_id = btx_res.transaction_id
                    session.add(t)
                posted_results["bank_transactions_synced"] = len(bank_items)

            session.commit()

            return {
                "status": "POSTED",
                "transactions_posted": len(to_post),
                "details": posted_results,
            }
