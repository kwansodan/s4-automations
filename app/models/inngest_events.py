"""Inngest event payload schemas."""

from typing import Optional, List
from pydantic import BaseModel, Field, model_validator


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
    client_id: Optional[str] = Field(default=None, description="Optional tenant or client organization ID")
    send_email: bool = Field(default=False, description="Whether to automatically send invoice to client after creation")
    include_line_item_description: Optional[bool] = Field(default=None, description="Whether to include detailed operational descriptions on invoice line items. If None, falls back to client settings.")
    mode: str = Field(default="append", description="Invoicing mode: 'append' or 'regenerate'")
    target_customer_name: Optional[str] = Field(default=None, description="Optional single Customer name to filter invoicing")
    invoice_date: Optional[str] = Field(default=None, description="Explicit invoice date in YYYY-MM-DD format")
    due_date: Optional[str] = Field(default=None, description="Explicit due date in YYYY-MM-DD format")
    terms: Optional[str] = Field(default=None, description="Explicit payment terms note")
    confirm_delete: bool = Field(default=False, description="Explicit confirmation to delete existing draft invoices when regenerating")

    @model_validator(mode="after")
    def validate_regeneration_confirmation(self):
        if self.mode == "regenerate" and not self.confirm_delete:
            raise ValueError("Regeneration mode requires explicit confirmation (confirm_delete=True)")
        return self



