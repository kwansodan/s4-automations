"""Abstract Base Strategy & Data Contracts for S4 Client Automation Engines."""

from abc import ABC, abstractmethod
from enum import Enum
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


class SourceType(str, Enum):
    GOOGLE_DRIVE = "google_drive"
    EMAIL_ATTACHMENT = "email_attachment"
    EMAIL_BODY = "email_body"
    BANK_FEED = "bank_feed"
    MANUAL_UPLOAD = "manual_upload"


class SourceDocument(BaseModel):
    file_name: str
    source_type: SourceType = SourceType.GOOGLE_DRIVE
    mime_type: str = "application/pdf"
    file_bytes: Optional[bytes] = None
    source_identifier: Optional[str] = None
    sender_email: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ExtractedLineItem(BaseModel):
    item_or_description: str
    category_or_account: Optional[str] = None
    quantity_or_debit: float = 0.0
    credit_amount: float = 0.0
    unit_price: float = 0.0
    total_amount: float = 0.0
    confidence_score: float = 1.0
    discrepancy: float = 0.0
    raw_extracted_data: Dict[str, Any] = Field(default_factory=dict)


class StrategyExecutionResult(BaseModel):
    client_id: str
    month: str
    year: int
    status: str = "COMPLETED" # COMPLETED, PROCESSING, FAILED
    sources_discovered: int = 0
    sources_processed: int = 0
    items_extracted: int = 0
    total_amount: float = 0.0
    discrepancies_count: int = 0
    accounting_records_posted: int = 0
    message: str = ""
    details: Dict[str, Any] = Field(default_factory=dict)


class BaseAutomationStrategy(ABC):
    """
    Standardized 4-Stage Lifecycle Strategy for all S4 Accounting Clients.
    """

    def __init__(self, client_id: str, client_name: str):
        self.client_id = client_id
        self.client_name = client_name

    @abstractmethod
    async def discover_sources(self, month: str, year: int) -> List[SourceDocument]:
        """Stage 1: Discover unparsed source files (Drive, Email, Bank Feeds)."""
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
