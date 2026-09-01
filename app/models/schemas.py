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


class ZohoPaymentInvoiceLink(BaseModel):
    """Invoice link allocation for customer payment."""
    invoice_id: str
    amount_applied: float
    tax_amount_withheld: Optional[float] = 0.0


class ZohoCustomerPaymentRequest(BaseModel):
    """Payload to record customer payment receipt in Zoho Books."""
    customer_id: str
    payment_mode: str = "Bank Transfer"  # Bank Transfer, Mobile Money, Cash, Cheque
    amount: float
    date: str
    account_id: Optional[str] = None  # Deposit to bank / clearing account
    reference_number: Optional[str] = ""
    description: Optional[str] = ""
    invoices: List[ZohoPaymentInvoiceLink] = Field(default_factory=list)


class ZohoCustomerPaymentResponse(BaseModel):
    """Response from Zoho Books Customer Payment creation."""
    code: int = 0
    message: str = ""
    payment_id: str
    payment_number: str
    customer_id: str
    customer_name: str
    amount: float
    payment_url: Optional[str] = ""


class ZohoBillPaymentLink(BaseModel):
    """Bill allocation for vendor payment."""
    bill_id: str
    amount_applied: float


class ZohoVendorPaymentRequest(BaseModel):
    """Payload to record vendor payment in Zoho Books."""
    vendor_id: str
    payment_mode: str = "Bank Transfer"
    amount: float
    date: str
    paid_through_account_id: Optional[str] = None
    reference_number: Optional[str] = ""
    description: Optional[str] = ""
    bills: List[ZohoBillPaymentLink] = Field(default_factory=list)


class ZohoVendorPaymentResponse(BaseModel):
    """Response from Zoho Books Vendor Payment creation."""
    code: int = 0
    message: str = ""
    payment_id: str
    payment_number: str
    vendor_id: str
    vendor_name: str
    amount: float
    payment_url: Optional[str] = ""


class ZohoExpenseRequest(BaseModel):
    """Payload to record direct expense / petty cash in Zoho Books."""
    account_id: str  # Expense Chart of Account ID
    paid_through_account_id: str  # Paid through Bank/Cash Account
    date: str
    amount: float
    vendor_id: Optional[str] = None
    reference_number: Optional[str] = ""
    description: Optional[str] = ""
    is_inclusive_tax: bool = False
    tax_id: Optional[str] = None


class ZohoExpenseResponse(BaseModel):
    """Response from Zoho Books Direct Expense creation."""
    code: int = 0
    message: str = ""
    expense_id: str
    account_name: str
    amount: float
    expense_url: Optional[str] = ""


class ZohoCreditNoteRequest(BaseModel):
    """Payload to record customer Credit Note in Zoho Books."""
    customer_id: str
    date: str
    line_items: List[Dict[str, Any]]
    creditnote_number: Optional[str] = None
    reference_number: Optional[str] = ""
    notes: Optional[str] = ""


class ZohoCreditNoteResponse(BaseModel):
    """Response from Zoho Books Credit Note creation."""
    code: int = 0
    message: str = ""
    creditnote_id: str
    creditnote_number: str
    total: float
    creditnote_url: Optional[str] = ""


class ZohoBankTransactionRequest(BaseModel):
    """Payload to record bank statement line in Zoho Books."""
    from_account_id: str  # Bank Account ID
    transaction_type: str = "debit"  # debit or credit
    date: str
    amount: float
    description: Optional[str] = ""
    reference_number: Optional[str] = ""
    payee: Optional[str] = ""


class ZohoBankTransactionResponse(BaseModel):
    """Response from Zoho Books Bank Transaction creation."""
    code: int = 0
    message: str = ""
    transaction_id: str
    transaction_type: str
    amount: float
    status: str = "uncategorized"


class ZohoJournalEntryItem(BaseModel):
    """Debit or Credit line in double-entry manual journal."""
    account_id: str
    debit_or_credit: str  # debit or credit
    amount: float
    description: Optional[str] = ""


class ZohoJournalRequest(BaseModel):
    """Payload to post manual journal entry into Zoho Books."""
    journal_date: str
    journal_entries: List[ZohoJournalEntryItem]
    reference_number: Optional[str] = ""
    notes: Optional[str] = ""


class ZohoJournalResponse(BaseModel):
    """Response from Zoho Books Journal Entry creation."""
    code: int = 0
    message: str = ""
    journal_id: str
    journal_date: str
    total: float
    journal_url: Optional[str] = ""


# -------------------------------------------------------------------------
# Modular Pipeline & Validation Schemas
# -------------------------------------------------------------------------

class IngestionPipelineConfig(BaseModel):
    """Configuration for a specific accounting ingestion pipeline."""
    id: str
    name: str
    section: str = "AR"  # AR, AP, BANK, GL
    entity_type: str = "ar_sales_invoice"  # AccountingEntityType value
    source_type: str = "google_drive"  # google_drive, onedrive, email, manual, webhook
    source_identifier: str = ""  # Folder ID, email address, drive ID
    default_account_code: Optional[str] = None
    default_account_id: Optional[str] = None
    default_tax_rate: Optional[str] = None
    auto_post_to_zoho: bool = False
    is_active: bool = True
    trigger_type: str = "scheduled_cron"  # realtime_webhook, scheduled_cron, manual_only, event_mesh
    cron_expression: Optional[str] = "0 20 * * *"
    cron_schedule_human: Optional[str] = "Daily at 8:00 PM"
    webhook_slug: Optional[str] = None
    last_triggered_at: Optional[str] = None
    total_runs_count: int = 0
    notes: Optional[str] = ""


class ValidationIssue(BaseModel):
    """Detailed validation issue when an ingested document fails target Zoho API contract."""
    field_name: str
    error_type: str  # MISSING_MANDATORY_FIELD, UNMATCHED_ENTITY, MATH_MISMATCH, INVALID_DATE, UNRESOLVED_ACCOUNT
    message: str
    received_value: Optional[Any] = None
    severity: str = "CRITICAL"  # CRITICAL, WARNING


class ContractValidationResult(BaseModel):
    """Result of strict Zoho API Contract validation."""
    is_valid: bool
    target_entity: str
    issues: List[ValidationIssue] = Field(default_factory=list)
    normalized_payload: Dict[str, Any] = Field(default_factory=dict)


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


# -------------------------------------------------------------------------
# Multi-Accounting Software Platform Schemas & Catalog
# -------------------------------------------------------------------------

class AccountingSoftwareMetadata(BaseModel):
    """Platform metadata for supported West African accounting software packages."""
    id: str
    name: str
    regional_popularity: str
    icon: str
    status: str  # 'live' or 'in_progress'
    target_protocol: str
    description: str


ACCOUNTING_SOFTWARES_CATALOG: List[Dict[str, Any]] = [
    {
        "id": "zoho_books",
        "name": "Zoho Books",
        "regional_popularity": "#1 Cloud Accounting in West Africa (Ghana, Nigeria)",
        "icon": "🟢",
        "status": "live",
        "target_protocol": "REST API v3 / OAuth2",
        "description": "Native cloud accounting with live contact sync, catalog pricing, and automated invoice/bill generation.",
    },
    {
        "id": "quickbooks_online",
        "name": "QuickBooks Online (Intuit)",
        "regional_popularity": "Dominant SME & Startup Accounting across West Africa",
        "icon": "📗",
        "status": "live",
        "target_protocol": "Intuit REST API / OAuth2",
        "description": "Standard cloud accounting for Ghanaian and Nigerian SMEs. Native API adapter with live customer & invoice sync.",
    },
    {
        "id": "sage_business_cloud",
        "name": "Sage Business Cloud / Evolution",
        "regional_popularity": "Standard Mid-Market ERP in Ghana & Nigeria",
        "icon": "🌿",
        "status": "in_progress",
        "target_protocol": "Sage Data Hub REST API",
        "description": "Widely deployed across mid-tier manufacturing, retail, and commercial enterprises. In progress.",
    },
    {
        "id": "xero",
        "name": "Xero Accounting",
        "regional_popularity": "Rapidly Growing for Tech & Export Companies",
        "icon": "🔵",
        "status": "live",
        "target_protocol": "Xero API v2 / OAuth2",
        "description": "Cloud accounting for modern agencies and regional tech firms. Native API adapter with live contact & invoice sync.",
    },
    {
        "id": "odoo",
        "name": "Odoo Accounting & ERP",
        "regional_popularity": "Major Open-Source ERP for Wholesale & Trading",
        "icon": "🟣",
        "status": "in_progress",
        "target_protocol": "Odoo JSON-RPC / REST API",
        "description": "Integrated ERP widely adopted across West African distribution and logistics firms. In progress.",
    },
    {
        "id": "tally_prime",
        "name": "TallyPrime / Tally.ERP 9",
        "regional_popularity": "Market Standard in Opera Square & Alaba Market",
        "icon": "⚡",
        "status": "in_progress",
        "target_protocol": "Tally XML / Server Gateway",
        "description": "Essential trading and inventory software for large commodity and electronics distributors. In progress.",
    },
    {
        "id": "sap_business_one",
        "name": "SAP Business One",
        "regional_popularity": "Corporate & FMCG Standard across West Africa",
        "icon": "🔷",
        "status": "in_progress",
        "target_protocol": "SAP Service Layer OData",
        "description": "Mid-tier and enterprise ERP for large distribution and FMCG conglomerates. In progress.",
    },
    {
        "id": "ms_dynamics_365",
        "name": "Microsoft Dynamics 365 Business Central",
        "regional_popularity": "Corporate & Financial Institutions",
        "icon": "🟦",
        "status": "in_progress",
        "target_protocol": "Microsoft Graph / OData API",
        "description": "Enterprise cloud ERP for institutional supply chains and corporate finance. In progress.",
    },
    {
        "id": "wave",
        "name": "Wave Accounting",
        "regional_popularity": "Popular for Micro-Merchants & Small Consultancies",
        "icon": "🌊",
        "status": "in_progress",
        "target_protocol": "Wave GraphQL API",
        "description": "Free cloud accounting used by micro-enterprises and boutique service providers. In progress.",
    },
    {
        "id": "busy_accounting",
        "name": "Busy Accounting / Busy ERP",
        "regional_popularity": "Retail, Hardware & Fast-Moving Consumer Goods",
        "icon": "💼",
        "status": "in_progress",
        "target_protocol": "Busy Sync API / Webhook",
        "description": "Inventory and accounting software popular in West African commercial trading centres. In progress.",
    },
]


class AccountingCatalogFetchRequest(BaseModel):
    """Payload to dynamically discover contacts and item catalogs from any supported platform."""
    software: str = Field(default="zoho_books", description="Accounting software platform identifier")
    org_id: Optional[str] = Field(default=None, description="Organization, Realm, or Tenant ID")
    config: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Optional connection credentials")


class AccountingCatalogFetchResponse(BaseModel):
    """Universal response returning contacts and items from accounting platform."""
    software: str
    platform_name: str
    is_live: bool = True
    contacts_count: int
    items_count: int
    contacts: List[Dict[str, Any]] = Field(default_factory=list)
    items: List[Dict[str, Any]] = Field(default_factory=list)
    synced_at: str


class NotificationPreferences(BaseModel):
    """Notification subscriptions for organization stakeholders."""
    executive_digest: bool = True
    critical_anomalies: bool = True
    staged_approvals: bool = False
    channel: str = "email"  # email, whatsapp, both


class OrganizationTeamMember(BaseModel):
    """Organization stakeholder team member profile."""
    id: str
    name: str
    email: str
    phone: Optional[str] = None
    role: str = "CFO"  # CFO, Financial_Controller, Operations_Lead, External_Auditor, Accounts_Payable_Clerk
    notifications: NotificationPreferences = Field(default_factory=NotificationPreferences)


class WatchedAccountsUpdate(BaseModel):
    """Update list of watched Chart of Account codes."""
    watched_accounts: List[str] = Field(description="List of account IDs or codes to monitor")


class ChartOfAccountItem(BaseModel):
    """Single Chart of Account record from accounting platform."""
    account_id: str
    account_name: str
    account_code: Optional[str] = ""
    account_type: str = "Expense"  # Expense, Income, Bank, Asset, Liability, Equity
    is_watched: bool = False
    is_suspense: bool = False


class BankTransactionCategorizeRequest(BaseModel):
    """Accountant categorization payload."""
    mapped_account_id: str = Field(description="Target Chart of Accounts ID")
    mapped_account_name: Optional[str] = Field(default=None, description="Human readable account name")
    payee_name: Optional[str] = Field(default=None, description="Customer or vendor payee")
    tax_rate: Optional[str] = Field(default=None, description="Applied VAT/tax rate")
    post_to_accounting: bool = Field(default=True, description="Whether to sync directly to accounting platform")


class BankTransactionQueryRequest(BaseModel):
    """Accountant request to draw client attention."""
    query_text: str = Field(description="Specific question or note for client")
    recipient_email: Optional[str] = Field(default=None, description="Optional target stakeholder email")
    send_immediately: bool = Field(default=True, description="Send email immediately or queue in outbox")


class BankTransactionBulkCategorizeRequest(BaseModel):
    """Bulk categorization payload."""
    transaction_ids: List[int]
    mapped_account_id: str
    mapped_account_name: Optional[str] = None
    payee_name: Optional[str] = None
    tax_rate: Optional[str] = None


class BankTransactionBulkQueryRequest(BaseModel):
    """Bulk query digest payload."""
    transaction_ids: List[int]
    query_text: str
    recipient_email: Optional[str] = None


class ClientExplanationSubmit(BaseModel):
    """Client portal explanation response."""
    client_explanation: str
    client_attachments: Optional[List[Dict[str, Any]]] = Field(default_factory=list)



