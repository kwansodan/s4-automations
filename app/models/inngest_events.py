"""Inngest event payload schemas."""

from typing import Optional, List
from pydantic import BaseModel, Field


class PipelineTriggerEvent(BaseModel):
    """Payload for manual or automated `anr/pipeline.trigger` event."""
    month: Optional[str] = Field(default=None, description="Target month name, e.g. 'August'")
    year: Optional[int] = Field(default=None, description="Target year, e.g. 2026")
    client_slugs: Optional[List[str]] = Field(default=None, description="Optional list of specific clients to process")
    force_reprocess: bool = Field(default=False, description="Whether to reprocess files even if already archived")


class InvoiceGenerateEvent(BaseModel):
    """Payload for `anr/invoices.generate` event."""
    month: Optional[str] = Field(default=None, description="Target month name, e.g. 'August'")
    year: Optional[int] = Field(default=None, description="Target year, e.g. 2026")
    spreadsheet_id: Optional[str] = Field(default=None, description="Explicit Google Spreadsheet ID")
    client_name: Optional[str] = Field(default=None, description="Optional client name to invoice only this client")
    send_email: bool = Field(default=False, description="Whether to automatically send invoice to client after creation")
