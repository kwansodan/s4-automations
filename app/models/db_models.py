"""SQLModel Database Models for PostgreSQL / SQLite."""

from enum import Enum
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
from sqlmodel import SQLModel, Field, Column, JSON


def get_utc_now() -> datetime:
    """Returns current timezone-aware UTC datetime."""
    return datetime.now(timezone.utc)


class AccountingSection(str, Enum):
    """Core Accounting Workflow Sections."""
    AR = "AR"       # Accounts Receivable (Revenue, Customer Invoices, Payments, Credits)
    AP = "AP"       # Accounts Payable (Vendor Bills, Disbursements, Expenses, POs)
    BANK = "BANK"   # Banking & Treasury (Bank Statements, Feeds, MoMo, Reconciliation)
    GL = "GL"       # General Ledger (Manual Journals, Chart of Accounts)


class AccountingEntityType(str, Enum):
    """Exhaustive Zoho Books Accounting Entities for Ingestion Pipelines."""
    # Accounts Receivable (AR)
    AR_SALES_INVOICE = "ar_sales_invoice"         # Zoho /invoices
    AR_CUSTOMER_PAYMENT = "ar_customer_payment"   # Zoho /customerpayments
    AR_CREDIT_NOTE = "ar_credit_note"             # Zoho /creditnotes
    AR_RETAINER_INVOICE = "ar_retainer_invoice"   # Zoho /retainerinvoices
    AR_ESTIMATE = "ar_estimate"                   # Zoho /estimates
    AR_DELIVERY_CHALLAN = "ar_delivery_challan"   # Zoho /deliverychallans
    
    # Accounts Payable (AP)
    AP_VENDOR_BILL = "ap_vendor_bill"             # Zoho /bills
    AP_VENDOR_PAYMENT = "ap_vendor_payment"       # Zoho /vendorpayments
    AP_DIRECT_EXPENSE = "ap_direct_expense"       # Zoho /expenses
    AP_PURCHASE_ORDER = "ap_purchase_order"       # Zoho /purchaseorders
    AP_VENDOR_CREDIT = "ap_vendor_credit"         # Zoho /vendorcredits
    
    # Banking & Treasury
    BANK_STATEMENT = "bank_statement"             # Zoho /banktransactions
    MOMO_STATEMENT = "momo_statement"             # Zoho /banktransactions (MoMo)
    
    # General Ledger
    GL_JOURNAL = "gl_journal"                     # Zoho /journalentries


class AccountingSoftware(str, Enum):
    """Supported Target Accounting Software Platforms in West Africa."""
    ZOHO_BOOKS = "zoho_books"                       # Live / Active
    QUICKBOOKS_ONLINE = "quickbooks_online"         # Live / Active
    SAGE_BUSINESS_CLOUD = "sage_business_cloud"     # In Progress
    XERO = "xero"                                   # Live / Active
    ODOO = "odoo"                                   # In Progress
    TALLY_PRIME = "tally_prime"                     # In Progress
    SAP_BUSINESS_ONE = "sap_business_one"           # In Progress
    MS_DYNAMICS_365 = "ms_dynamics_365"             # In Progress
    WAVE = "wave"                                   # In Progress
    BUSY_ACCOUNTING = "busy_accounting"             # In Progress


class ClientOrganization(SQLModel, table=True):
    __tablename__ = "clients"

    id: str = Field(primary_key=True, description="Client slug identifier, e.g. anr_group")
    name: str = Field(index=True, description="Organization name")
    industry: str = Field(description="Business industry / domain tag")
    icon: str = Field(default="🏢", description="Emoji icon")
    status: str = Field(default="dev", description="live, dev, pending")
    status_text: str = Field(default="In Development")
    description: Optional[str] = Field(default=None)
    accounting_software: str = Field(default="zoho_books", description="Target accounting software platform")
    folder_id: Optional[str] = Field(default=None, description="Google Drive folder ID")
    zoho_org_id: Optional[str] = Field(default=None, description="Zoho Books Organization ID")
    zoho_contact_id: Optional[str] = Field(default=None, description="Zoho Contact/Customer ID")
    source_type: str = Field(default="google_drive", description="google_drive, onedrive, email, bank_feed, manual, webhook, whatsapp")
    source_email: Optional[str] = Field(default=None, description="Dedicated inbound email address")
    source_config: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    custom_config: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    active_integrations: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    blueprints: List[Dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    pipelines: List[Dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON), description="Configured multi-pipeline ingestion streams")
    team_members: List[Dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON), description="Organization team members and alert routing")
    stats_summary: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    last_run_at: Optional[datetime] = Field(default=None)
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(default_factory=get_utc_now)


class AuthOtpRecord(SQLModel, table=True):
    __tablename__ = "auth_otps"

    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True)
    otp_hash: str
    salt: str
    expires_at: datetime
    is_verified: bool = Field(default=False)
    attempts: int = Field(default=0)
    created_at: datetime = Field(default_factory=get_utc_now)


class AuditLog(SQLModel, table=True):
    __tablename__ = "audit_logs"

    id: Optional[int] = Field(default=None, primary_key=True)
    client_id: str = Field(index=True)
    action: str = Field(index=True, description="e.g. OCR_EXTRACT, ROW_APPROVED, INVOICE_GENERATED, CONFIG_UPDATE")
    actor_email: str = Field(default="system")
    details: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    source_type: Optional[str] = Field(default="system")
    source_identifier: Optional[str] = Field(default=None, description="Filename, email ID, or sheet row ID")
    created_at: datetime = Field(default_factory=get_utc_now, index=True)


class StagedTransaction(SQLModel, table=True):
    __tablename__ = "staged_transactions"

    id: Optional[int] = Field(default=None, primary_key=True)
    client_id: str = Field(index=True)
    batch_id: str = Field(index=True)
    pipeline_id: Optional[str] = Field(default=None, index=True, description="ID of the specific ingestion pipeline")
    pipeline_name: Optional[str] = Field(default=None, description="Name of the pipeline")
    pipeline_type: str = Field(default="AR", description="AR, AP, BANK, GL")
    entity_type: str = Field(default="ar_sales_invoice", index=True, description="Exact target Zoho entity")
    transaction_date: str
    source_type: str = Field(default="google_drive")
    source_file_name: str
    source_identifier: Optional[str] = Field(default=None)
    checksum: Optional[str] = Field(default=None, index=True)
    item_or_description: str
    category_or_account: Optional[str] = Field(default=None)
    quantity_or_debit: float = Field(default=0.0)
    credit_amount: float = Field(default=0.0)
    rate_or_price: float = Field(default=0.0)
    total_amount: float = Field(default=0.0)
    confidence_score: float = Field(default=1.0)
    discrepancy_amount: float = Field(default=0.0)
    discrepancy_reason: Optional[str] = Field(default=None)
    accounting_ref_id: Optional[str] = Field(default=None, index=True)
    reviewed: bool = Field(default=False)
    approved: bool = Field(default=False)
    status: str = Field(default="PENDING", index=True)  # PENDING, PENDING_VALIDATION_ERROR, APPROVED, INVOICED, BILLED, JOURNAL_POSTED, REJECTED
    validation_status: str = Field(default="VALID", index=True)  # VALID, PENDING_VALIDATION_ERROR, RESOLVED
    validation_errors: List[Dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    metadata_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=get_utc_now)


class BankTransaction(SQLModel, table=True):
    __tablename__ = "bank_transactions"

    id: Optional[int] = Field(default=None, primary_key=True)
    client_id: str = Field(index=True)
    transaction_date: str = Field(index=True)
    description: str
    amount: float = Field(default=0.0)
    transaction_type: str = Field(default="DEBIT", description="DEBIT or CREDIT")
    source_file_name: str
    
    # Matching / Reconciling
    status: str = Field(default="UNMAPPED", index=True) # UNMAPPED, CLARIFICATION_REQUESTED, CLIENT_ANSWERED, MAPPED
    mapped_account_id: Optional[str] = Field(default=None)
    
    # Client Portal Communication
    client_explanation: Optional[str] = Field(default=None)
    accountant_query: Optional[str] = Field(default=None)
    
    metadata_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(default_factory=get_utc_now)

