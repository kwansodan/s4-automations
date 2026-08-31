"""Pydantic schemas for OCR extraction, Google Sheets rows, and Zoho API."""

from enum import Enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, computed_field


class ConfidenceLevel(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class SlipStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    INVOICED = "INVOICED"
    REJECTED = "REJECTED"


# -------------------------------------------------------------------------
# OCR / Gemini Vision Extraction Schemas
# -------------------------------------------------------------------------

class OCRSlipItem(BaseModel):
    """Extracted single linen item from a handwritten slip."""
    raw_item_name: str = Field(description="Original handwritten item name as written on slip, e.g., 'B/Sheet Dbl', 'F/Towel'")
    standard_item_name: str = Field(default="", description="Reconciled standard item name from Zoho catalog")
    zoho_item_id: str = Field(default="", description="Matched Zoho Item ID")
    unit_rate: float = Field(default=0.0, description="Unit rate in GHS or account currency")
    pickup_qty: int = Field(default=0, ge=0, description="Quantity picked up from client")
    delivery_qty: int = Field(default=0, ge=0, description="Quantity delivered back to client")
    unreturned_loss_qty: int = Field(default=0, description="Loss discrepancy (pickup_qty - delivery_qty)")
    confidence_score: ConfidenceLevel = Field(default=ConfidenceLevel.HIGH, description="OCR extraction confidence")
    remarks: str = Field(default="", description="Slip line item remarks or notes")


class OCRSlipExtraction(BaseModel):
    """Full extraction response for a single physical slip scan."""
    file_name: str = Field(default="", description="Name of the physical scan file")
    client_name: str = Field(default="", description="Client name detected or matched")
    slip_date: str = Field(default="", description="Date on slip in DD/MM/YYYY format")
    items: List[OCRSlipItem] = Field(default_factory=list, description="Extracted line items on this slip")
    overall_confidence: ConfidenceLevel = Field(default=ConfidenceLevel.HIGH, description="Overall document confidence")
    notes: str = Field(default="", description="General notes or legibility warnings")


# -------------------------------------------------------------------------
# SKU Aggregation Models
# -------------------------------------------------------------------------

class MonthlySKUSummary(BaseModel):
    """Consolidated monthly summary for a single client + SKU."""
    client_name: str
    zoho_contact_id: str = ""
    zoho_item_id: str = ""
    standard_item_name: str
    raw_names_seen: List[str] = Field(default_factory=list)
    confidence_score: ConfidenceLevel = ConfidenceLevel.HIGH
    unit_rate: float = 0.0
    total_pickup_qty: int = 0
    total_delivery_qty: int = 0
    total_loss_qty: int = 0
    line_total_amount: float = 0.0
    daily_trace_summary: str = ""
    audit_notes: str = ""
    reviewed: bool = False
    approved: bool = False
    status: SlipStatus = SlipStatus.PENDING

    @computed_field
    def raw_names_display(self) -> str:
        """Comma-separated list of raw handwritten variations observed."""
        return ", ".join(sorted(set(self.raw_names_seen))) if self.raw_names_seen else self.standard_item_name


# -------------------------------------------------------------------------
# Google Sheets Row Schemas
# -------------------------------------------------------------------------

class DailySlipDetailRow(BaseModel):
    """Row model for Tab 1: Daily_Slip_Details."""
    slip_date: str
    file_name: str
    client_name: str
    raw_item_name: str
    standard_item_name: str
    pickup_qty: int
    delivery_qty: int
    loss_qty: int
    confidence_score: ConfidenceLevel
    drive_file_url: str
    processed_at: str

    def to_sheet_row(self) -> List[Any]:
        """Convert to Google Sheets row values array."""
        hyperlink_formula = f'=HYPERLINK("{self.drive_file_url}", "View Scan ↗")' if self.drive_file_url else "N/A"
        return [
            self.slip_date,
            self.file_name,
            self.client_name,
            self.raw_item_name,
            self.standard_item_name,
            self.pickup_qty,
            self.delivery_qty,
            self.loss_qty,
            self.confidence_score.value,
            hyperlink_formula,
            self.processed_at,
        ]


class MonthlySummaryRow(BaseModel):
    """15-Column Schema for Tab 2: Monthly_Summary."""
    client_name: str
    zoho_contact_id: str
    zoho_item_id: str
    standard_item_name: str
    raw_names_seen: str
    confidence_score: ConfidenceLevel
    unit_rate: float
    total_picked_up: int
    total_delivered: int
    linen_discrepancy: int
    total_billed: float
    audit_notes: str
    reviewed: bool = False
    approved: bool = False
    status: SlipStatus = SlipStatus.PENDING

    def to_sheet_row(self) -> List[Any]:
        """Convert to Google Sheets 15-column row values array."""
        return [
            self.client_name,
            self.zoho_contact_id,
            self.zoho_item_id,
            self.standard_item_name,
            self.raw_names_seen,
            self.confidence_score.value,
            round(self.unit_rate, 2),
            self.total_picked_up,
            self.total_delivered,
            self.linen_discrepancy,
            round(self.total_billed, 2),
            self.audit_notes,
            self.reviewed,
            self.approved,
            self.status.value,
        ]


# -------------------------------------------------------------------------
# Zoho Books Schemas
# -------------------------------------------------------------------------

class ZohoContact(BaseModel):
    """Zoho Customer / Contact representation."""
    contact_id: str
    contact_name: str
    company_name: Optional[str] = ""
    email: Optional[str] = ""
    status: Optional[str] = "active"


class ZohoItem(BaseModel):
    """Zoho Item Catalog entry."""
    item_id: str
    name: str
    rate: float
    description: Optional[str] = ""
    status: Optional[str] = "active"


class ZohoInvoiceLineItem(BaseModel):
    """Line item for Zoho Draft Invoice."""
    item_id: str
    name: str
    description: str = ""
    rate: float
    quantity: int
    item_total: Optional[float] = None


class ZohoDraftInvoiceRequest(BaseModel):
    """Request payload to create a draft invoice in Zoho Books."""
    customer_id: str
    date: str
    due_date: Optional[str] = None
    line_items: List[ZohoInvoiceLineItem]
    notes: Optional[str] = ""
    terms: Optional[str] = "Payment due upon receipt"
    is_inclusive_tax: bool = False
    status: str = "draft"


class ZohoDraftInvoiceResponse(BaseModel):
    """Response returned from Zoho Books after invoice creation."""
    code: int = 0
    message: str = ""
    invoice_id: str
    invoice_number: str
    customer_id: str
    customer_name: str
    total: float
    status: str
    invoice_url: Optional[str] = ""


class ZohoDraftBillRequest(BaseModel):
    """Request payload to create a Draft Vendor Bill in Zoho Books."""
    vendor_id: str
    bill_number: Optional[str] = None
    date: str
    due_date: Optional[str] = None
    line_items: List[Dict[str, Any]] = Field(default_factory=list)
    notes: Optional[str] = ""
    status: str = "draft"


class ZohoDraftBillResponse(BaseModel):
    """Response returned from Zoho Books after bill creation."""
    code: int = 0
    message: str = ""
    bill_id: str
    bill_number: str
    vendor_id: str
    vendor_name: str
    total: float
    status: str
    bill_url: Optional[str] = ""


# -------------------------------------------------------------------------
# Pipeline Workflow State Schemas
# -------------------------------------------------------------------------

class ClientFolderInfo(BaseModel):
    """Information about a discovered client folder in Google Drive."""
    folder_id: str
    client_name: str
    client_slug: str
    processed_folder_id: str = ""
    unprocessed_file_count: int = 0


class PreflightDiscoveryResult(BaseModel):
    """Result of Step 1: Pre-flight & Discovery."""
    month_name: str
    year: int
    month_folder_id: str
    spreadsheet_id: str
    spreadsheet_url: str
    clients: List[ClientFolderInfo] = Field(default_factory=list)
    active_contacts_count: int = 0
    active_items_count: int = 0


class ClientProcessingResult(BaseModel):
    """Result of Step 2-5 for a single client."""
    client_name: str
    client_slug: str
    files_processed_count: int = 0
    line_items_extracted_count: int = 0
    sku_summaries_count: int = 0
    errors: List[str] = Field(default_factory=list)


class PipelineRunResult(BaseModel):
    """Overall outcome of the daily billing pipeline run."""
    run_id: str
    month_name: str
    year: int
    spreadsheet_id: str
    spreadsheet_url: str
    total_clients_discovered: int
    clients_processed: List[ClientProcessingResult] = Field(default_factory=list)
    total_slips_processed: int = 0
    status: str = "COMPLETED"


# -------------------------------------------------------------------------
# Frontend & Configuration Schemas
# -------------------------------------------------------------------------

class ConfigUpdateRequest(BaseModel):
    """Payload to update and save configuration settings via frontend."""
    INNGEST_EVENT_KEY: Optional[str] = None
    INNGEST_SIGNING_KEY: Optional[str] = None
    INNGEST_APP_ID: Optional[str] = None
    INNGEST_DEV_SERVER_URL: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None
    GEMINI_MODEL: Optional[str] = None
    ZOHO_CLIENT_ID: Optional[str] = None
    ZOHO_CLIENT_SECRET: Optional[str] = None
    ZOHO_REFRESH_TOKEN: Optional[str] = None
    ZOHO_ORG_ID: Optional[str] = None
    ZOHO_ACCOUNTS_URL: Optional[str] = None
    ZOHO_BOOKS_API_URL: Optional[str] = None
    CONTROL_SHEETS_FOLDER_ID: Optional[str] = None
    GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: Optional[str] = None
    GOOGLE_SERVICE_ACCOUNT_FILE: Optional[str] = None
    NOTIFICATION_EMAIL: Optional[str] = None
    PORT: Optional[int] = None
    ENVIRONMENT: Optional[str] = None
    LOG_LEVEL: Optional[str] = None
    MOCK_MODE: Optional[bool] = None
    persist_to_file: bool = True


class ConnectionTestResult(BaseModel):
    """Result of live integration connectivity test."""
    gemini_status: str = "UNKNOWN"
    gemini_message: str = ""
    zoho_status: str = "UNKNOWN"
    zoho_message: str = ""
    google_status: str = "UNKNOWN"
    google_message: str = ""
    inngest_status: str = "UNKNOWN"
    inngest_message: str = ""
    all_healthy: bool = False


class ToggleApprovalRequest(BaseModel):
    """Request to toggle Reviewed or Approved state for a row in Tab 2."""
    spreadsheet_id: Optional[str] = None
    month: Optional[str] = None
    year: Optional[int] = None
    row_index: int
    field: str = Field(description="'reviewed' or 'approved' or 'status'")
    value: Any


class SheetsReviewData(BaseModel):
    """Data response for Tab 1 (Details) and Tab 2 (Monthly Summary)."""
    month: str
    year: int
    spreadsheet_id: str
    spreadsheet_url: str
    daily_details: List[Dict[str, Any]] = Field(default_factory=list)
    monthly_summary: List[Dict[str, Any]] = Field(default_factory=list)


class StatsSummary(BaseModel):
    """High level dashboard stats."""
    total_slips_ingested: int = 0
    unreturned_linen_loss_count: int = 0
    approved_billing_total_ghs: float = 0.0
    pending_approval_count: int = 0
    active_clients_count: int = 0
    mock_mode: bool = False


# -------------------------------------------------------------------------
# Accounts Payable & Bank Portal Schemas
# -------------------------------------------------------------------------

class OCRAPBillItem(BaseModel):
    """Extracted single line item from a vendor bill."""
    item_description: str
    quantity: float = 1.0
    unit_rate: float = 0.0
    amount: float = 0.0

class OCRAPBillExtraction(BaseModel):
    """Full extraction response for a vendor bill."""
    vendor_name: str
    bill_date: str
    bill_number: str = ""
    currency: str = "GHS"
    total_amount: float
    items: List[OCRAPBillItem] = Field(default_factory=list)
    overall_confidence: ConfidenceLevel = Field(default=ConfidenceLevel.HIGH)

class BankTransactionUpdate(BaseModel):
    """Request from client portal to update a bank transaction explanation."""
    client_explanation: str


class OCRBankTransaction(BaseModel):
    """Single transaction row from a bank statement."""
    transaction_date: str
    description: str
    amount: float
    transaction_type: str = "DEBIT" # DEBIT or CREDIT
    balance: Optional[float] = None
    reference: Optional[str] = ""


class OCRBankStatementExtraction(BaseModel):
    """Full extraction response for a bank statement (PDF)."""
    bank_name: str = ""
    account_number: str = ""
    currency: str = "GHS"
    statement_period: str = ""
    transactions: List[OCRBankTransaction] = Field(default_factory=list)
    overall_confidence: ConfidenceLevel = Field(default=ConfidenceLevel.HIGH)

