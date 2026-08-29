"""Abstract Base Strategy, Data Contracts & Dynamic Blueprint Engine for S4 Client Automations."""

import hashlib
import asyncio
from abc import ABC, abstractmethod
from enum import Enum
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


class SourceType(str, Enum):
    GOOGLE_DRIVE = "google_drive"
    ONEDRIVE = "onedrive"
    SHAREPOINT = "sharepoint"
    EMAIL_ATTACHMENT = "email_attachment"
    EMAIL_BODY = "email_body"
    BANK_FEED = "bank_feed"
    MANUAL_UPLOAD = "manual_upload"
    WEBHOOK = "webhook"


class SourceDocument(BaseModel):
    file_name: str
    source_type: SourceType = SourceType.GOOGLE_DRIVE
    mime_type: str = "application/pdf"
    file_bytes: Optional[bytes] = None
    source_identifier: Optional[str] = None
    sender_email: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    checksum: Optional[str] = None

    def get_checksum(self) -> str:
        """Calculates or returns cached SHA-256 checksum of document content."""
        if self.checksum:
            return self.checksum
        if self.file_bytes:
            self.checksum = hashlib.sha256(self.file_bytes).hexdigest()
        else:
            # Fallback checksum using file metadata
            meta_str = f"{self.file_name}_{self.source_type}_{self.source_identifier}"
            self.checksum = hashlib.sha256(meta_str.encode()).hexdigest()
        return self.checksum


class AnomalySeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class AnomalyFlag(BaseModel):
    rule_name: str
    severity: AnomalySeverity = AnomalySeverity.WARNING
    message: str
    variance_amount: Optional[float] = 0.0


class ExtractedLineItem(BaseModel):
    item_or_description: str
    category_or_account: Optional[str] = None
    quantity_or_debit: float = 0.0
    credit_amount: float = 0.0
    unit_price: float = 0.0
    total_amount: float = 0.0
    confidence_score: float = 1.0
    discrepancy: float = 0.0
    discrepancy_reason: Optional[str] = None
    anomalies: List[AnomalyFlag] = Field(default_factory=list)
    source_checksum: Optional[str] = None
    raw_extracted_data: Dict[str, Any] = Field(default_factory=dict)


class StrategyExecutionResult(BaseModel):
    client_id: str
    month: str
    year: int
    status: str = "COMPLETED"  # COMPLETED, PROCESSING, FAILED
    sources_discovered: int = 0
    sources_processed: int = 0
    sources_skipped_duplicate: int = 0
    items_extracted: int = 0
    total_amount: float = 0.0
    discrepancies_count: int = 0
    accounting_records_posted: int = 0
    message: str = ""
    details: Dict[str, Any] = Field(default_factory=dict)


class BaseAutomationStrategy(ABC):
    """
    Standardized 4-Stage Lifecycle Strategy for all S4 Accounting Clients.
    Supports bounded concurrency, SHA-256 idempotency, and automated anomaly checking.
    """

    CONCURRENCY_LIMIT = 5

    def __init__(self, client_id: str, client_name: str):
        self.client_id = client_id
        self.client_name = client_name
        self.semaphore = asyncio.Semaphore(self.CONCURRENCY_LIMIT)

    @abstractmethod
    async def discover_sources(self, month: str, year: int) -> List[SourceDocument]:
        """Stage 1: Discover unparsed source files (Drive, OneDrive, Email, Bank Feeds)."""
        pass

    @abstractmethod
    async def extract_and_validate(self, sources: List[SourceDocument]) -> List[ExtractedLineItem]:
        """Stage 2: Run AI Vision / PDF schema extraction and domain validation."""
        pass

    @abstractmethod
    async def sync_review_workspace(
        self, month: str, year: int, items: List[ExtractedLineItem]
    ) -> Dict[str, Any]:
        """Stage 3: Stage data in Google Sheets or PostgreSQL review workspace."""
        pass

    @abstractmethod
    async def post_to_accounting(
        self, month: str, year: int, approved_items: Optional[List[Any]] = None
    ) -> Dict[str, Any]:
        """Stage 4: Post approved transactions into Zoho Books."""
        pass

    def validate_anomalies(self, item: ExtractedLineItem) -> List[AnomalyFlag]:
        """Runs standard accounting anomaly rules on an extracted line item."""
        flags: List[AnomalyFlag] = []

        # 1. Negative amounts check
        if item.total_amount < 0:
            flags.append(AnomalyFlag(
                rule_name="NEGATIVE_TOTAL",
                severity=AnomalySeverity.CRITICAL,
                message=f"Negative total amount detected: {item.total_amount}",
                variance_amount=item.total_amount,
            ))

        # 2. Low confidence score
        if item.confidence_score < 0.70:
            flags.append(AnomalyFlag(
                rule_name="LOW_CONFIDENCE_OCR",
                severity=AnomalySeverity.WARNING,
                message=f"Extraction confidence ({item.confidence_score:.0%}) is below 70% threshold. Manual verification recommended.",
            ))

        # 3. Discrepancy / inventory shrinkage
        if item.discrepancy > 0:
            flags.append(AnomalyFlag(
                rule_name="INVENTORY_OR_PRICE_VARIANCE",
                severity=AnomalySeverity.WARNING,
                message=f"Detected variance: {item.discrepancy} ({item.discrepancy_reason or 'shrinkage'})",
                variance_amount=item.discrepancy,
            ))

        return flags

    async def execute(self, month: str, year: int, auto_post: bool = False) -> StrategyExecutionResult:
        """Executes the complete pipeline lifecycle for this client."""
        from app.services.audit_service import AuditService

        AuditService.log(
            client_id=self.client_id,
            action="PIPELINE_TRIGGERED",
            details={"month": month, "year": year, "auto_post": auto_post},
        )

        # Stage 1: Discover
        sources = await self.discover_sources(month, year)

        # Stage 2: Extract & Validate
        items = await self.extract_and_validate(sources)

        # Run standard anomaly checks on each item
        for item in items:
            item_anomalies = self.validate_anomalies(item)
            item.anomalies.extend(item_anomalies)

        # Stage 3: Sync Review Workspace
        review_sync = await self.sync_review_workspace(month, year, items)

        # Stage 4: Post to Accounting (optional auto-post)
        posted_count = 0
        if auto_post:
            post_result = await self.post_to_accounting(month, year)
            posted_count = post_result.get("invoices_created", 0) or post_result.get("journals_created", 0)

        total_val = sum(i.total_amount for i in items)
        total_loss = sum(i.discrepancy for i in items)

        result = StrategyExecutionResult(
            client_id=self.client_id,
            month=month,
            year=year,
            status="COMPLETED",
            sources_discovered=len(sources),
            sources_processed=len(sources),
            sources_skipped_duplicate=0,
            items_extracted=len(items),
            total_amount=round(total_val, 2),
            discrepancies_count=int(total_loss),
            accounting_records_posted=posted_count,
            message=f"Pipeline completed for {self.client_name} ({month} {year}).",
            details=review_sync,
        )

        AuditService.log(
            client_id=self.client_id,
            action="PIPELINE_COMPLETED",
            details=result.model_dump(),
        )

        return result
