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


class OrganizationType(str, Enum):
    ACCOUNTING_FIRM = "ACCOUNTING_FIRM"           # Aggregator: Accounting / Audit Firm managing multiple clients
    INDIVIDUAL_BUSINESS = "INDIVIDUAL_BUSINESS"   # Direct: Single commercial enterprise / SMB managing own books


class UserOrgRole(str, Enum):
    OWNER = "OWNER"                   # Firm Partner or Company Managing Director
    ADMIN = "ADMIN"                   # Senior Accountant or Finance Controller
    STAFF = "STAFF"                   # Junior Bookkeeper or AP Clerk
    AUDITOR = "AUDITOR"               # Read-Only Audit Reviewer
    CLIENT_USER = "CLIENT_USER"       # External Portal Contact


class Organization(SQLModel, table=True):
    __tablename__ = "organizations"

    id: str = Field(primary_key=True, description="Organization slug identifier, e.g. s4_advisory or anr_group")
    name: str = Field(index=True, description="Organization display name")
    org_type: str = Field(default="ACCOUNTING_FIRM", description="ACCOUNTING_FIRM or INDIVIDUAL_BUSINESS")
    plan_tier: str = Field(default="pro", description="starter, pro, scale, enterprise")
    max_clients: int = Field(default=25, description="Max client quota for accounting firms, or 1 for individual business")
    industry: Optional[str] = Field(default="Accounting & Advisory", description="Industry domain")
    icon: str = Field(default="🏛️", description="Organization icon")
    
    # White-label & Portal Branding
    white_label_logo_url: Optional[str] = Field(default=None)
    custom_portal_subdomain: Optional[str] = Field(default=None)
    contact_email: Optional[str] = Field(default=None)
    
    # Storage Mode: platform_managed or byos
    storage_strategy: str = Field(default="platform_managed", description="platform_managed, byos_google, byos_onedrive")
    storage_credentials: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(default_factory=get_utc_now)


class UserOrganizationMembership(SQLModel, table=True):
    __tablename__ = "user_organization_memberships"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_email: str = Field(index=True, description="Staff / User email address")
    organization_id: str = Field(index=True, description="Organization slug ID")
    role: str = Field(default="ADMIN", description="OWNER, ADMIN, STAFF, AUDITOR, CLIENT_USER")
    title: Optional[str] = Field(default="Managing Partner")
    is_primary: bool = Field(default=True)
    created_at: datetime = Field(default_factory=get_utc_now)


class ClientOrganization(SQLModel, table=True):
    __tablename__ = "clients"

    id: str = Field(primary_key=True, description="Client slug identifier, e.g. anr_group")
    organization_id: Optional[str] = Field(default="s4_advisory", index=True, description="Parent Organization ID (Accounting Firm ID or self)")
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
    watched_accounts: List[str] = Field(default_factory=lambda: ["6990", "850", "suspense", "uncategorized"], sa_column=Column(JSON), description="Watched Chart of Account IDs/codes for uncategorized transactions")
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
    source_file_name: str = Field(default="Bank Feed")
    bank_account_name: Optional[str] = Field(default="Main Operating Bank Account")
    checksum: Optional[str] = Field(default=None, index=True)
    
    # Classification & Reconciling
    status: str = Field(default="UNMAPPED", index=True)  # UNMAPPED, CLARIFICATION_REQUESTED, CLIENT_ANSWERED, MAPPED, POSTED
    mapped_account_id: Optional[str] = Field(default=None)
    mapped_account_name: Optional[str] = Field(default=None)
    payee_name: Optional[str] = Field(default=None)
    tax_rate: Optional[str] = Field(default=None)
    ai_suggested_account: Optional[str] = Field(default=None)
    category_confidence: float = Field(default=0.0)
    
    # Client Portal & Query Communication
    client_explanation: Optional[str] = Field(default=None)
    accountant_query: Optional[str] = Field(default=None)
    client_attachments: List[Dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    query_date: Optional[datetime] = Field(default=None)
    response_date: Optional[datetime] = Field(default=None)
    source_platform: str = Field(default="bank_feed")
    
    metadata_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(default_factory=get_utc_now)


class FeatureRelease(SQLModel, table=True):
    """Tracks new features built, social broadcasts, and in-app changelog entries."""
    __tablename__ = "feature_releases"

    id: Optional[int] = Field(default=None, primary_key=True)
    version: str = Field(default="1.0.0", index=True)
    title: str = Field(index=True)
    category: str = Field(default="ACCOUNTING_AUTOMATION", index=True)  # AP, AR, BANK, OCR, INTEGRATION, PLATFORM
    summary: str
    commit_hash: Optional[str] = Field(default=None, index=True)
    
    # Generated Channel Texts
    linkedin_post: Optional[str] = Field(default=None)
    twitter_post: Optional[str] = Field(default=None)
    client_email_subject: Optional[str] = Field(default=None)
    client_email_html: Optional[str] = Field(default=None)
    changelog_entry: Optional[str] = Field(default=None)
    
    # Broadcast Dispatches & Delivery Logs
    channels_broadcasted: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    broadcast_status: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    is_published_to_changelog: bool = Field(default=True, index=True)
    
    created_at: datetime = Field(default_factory=get_utc_now)
    published_at: Optional[datetime] = Field(default=None)


class EmailSubscriber(SQLModel, table=True):
    """Tracks email recipients, newsletter subscribers, and outreach contacts for the release broadcaster and marketing."""
    __tablename__ = "email_subscribers"

    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True, description="Subscriber email address")
    name: Optional[str] = Field(default=None, description="Contact name")
    company: Optional[str] = Field(default=None, description="Company or firm name")
    role_or_title: Optional[str] = Field(default="Finance Lead", description="Job title")
    tier: str = Field(default="lead", description="lead, client, firm_partner, subscriber")
    tags: List[str] = Field(default_factory=lambda: ["general"], sa_column=Column(JSON), description="Audience segment tags")
    is_active: bool = Field(default=True, index=True)
    source: str = Field(default="manual", description="manual, csv_import, client_sync, landing_page, referral")
    notes: Optional[str] = Field(default=None)
    last_emailed_at: Optional[datetime] = Field(default=None)
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(default_factory=get_utc_now)


class MarketingLead(SQLModel, table=True):
    """Tracks inbound public landing page demo bookings and pilot inquiries."""
    __tablename__ = "marketing_leads"

    id: Optional[int] = Field(default=None, primary_key=True)
    full_name: str = Field(index=True)
    email: str = Field(index=True)
    phone_or_whatsapp: Optional[str] = Field(default=None)
    company_name: str
    accounting_firm: bool = Field(default=False, description="True if accounting/audit firm, False if single business")
    client_count_estimate: Optional[str] = Field(default=None, description="e.g. 1-5, 6-20, 20+")
    primary_accounting_software: Optional[str] = Field(default="zoho_books")
    biggest_headache: Optional[str] = Field(default=None, description="paper receipts, bank reconciliation, manual entry, client delays")
    status: str = Field(default="NEW", index=True)  # NEW, CONTACTED, DEMO_SCHEDULED, PILOT_ACTIVE, CONVERTED, CLOSED
    source: str = Field(default="landing_page_demo")
    metadata_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=get_utc_now)


class ClientContact(SQLModel, table=True):
    """Tracks client stakeholders invited for information request purposes (clarifications, invoice uploads)."""
    __tablename__ = "client_contacts"

    id: Optional[int] = Field(default=None, primary_key=True)
    client_id: str = Field(index=True, description="Client organization slug, e.g. anr_group")
    organization_id: str = Field(default="s4_advisory", index=True, description="Managing accounting firm ID")
    name: str = Field(index=True, description="Full name of contact, e.g. Kwame Mensah")
    email: str = Field(index=True, description="Contact email address")
    phone: Optional[str] = Field(default=None, description="Phone / WhatsApp number with country code")
    role: str = Field(default="CFO", description="CFO, Financial_Controller, Managing_Director, Operations_Lead, Internal_Accountant")
    portal_status: str = Field(default="INVITED", index=True, description="ACTIVE, INVITED, INACTIVE")
    magic_token: Optional[str] = Field(default=None, description="Current active 72-hour magic portal token")
    invite_sent_at: Optional[datetime] = Field(default=None)
    last_active_at: Optional[datetime] = Field(default=None)
    notification_channel: str = Field(default="both", description="email, whatsapp, both")
    notes: Optional[str] = Field(default=None, description="Internal notes regarding this contact")
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(default_factory=get_utc_now)


class FirmTeamMember(SQLModel, table=True):
    """Tracks accounting firm staff participating in client portfolio management."""
    __tablename__ = "firm_team_members"

    id: Optional[int] = Field(default=None, primary_key=True)
    organization_id: str = Field(default="s4_advisory", index=True, description="Accounting firm slug ID")
    name: str = Field(index=True, description="Full staff name, e.g. Charles Danso")
    email: str = Field(index=True, description="Staff corporate email address")
    phone: Optional[str] = Field(default=None, description="Phone number")
    role: str = Field(default="SENIOR_ACCOUNTANT", index=True, description="PARTNER, SENIOR_ACCOUNTANT, STAFF_ACCOUNTANT, AUDITOR")
    status: str = Field(default="ACTIVE", index=True, description="ACTIVE, INVITED, INACTIVE")
    assigned_client_ids: List[str] = Field(default_factory=lambda: ["*"], sa_column=Column(JSON), description="List of client IDs managed or ['*'] for all")
    permissions: Dict[str, bool] = Field(
        default_factory=lambda: {
            "can_query_clients": True,
            "can_categorize": True,
            "can_sync_accounting": True,
            "can_manage_clients": False,
        },
        sa_column=Column(JSON),
        description="Fine-grained feature permissions",
    )
    invite_sent_at: Optional[datetime] = Field(default=None)
    last_login_at: Optional[datetime] = Field(default=None)
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(default_factory=get_utc_now)


class LandingPageConfig(SQLModel, table=True):
    """Stores full landing page configuration, visitor access modes, and section toggles."""
    __tablename__ = "landing_page_config"

    id: Optional[int] = Field(default=1, primary_key=True)
    mode: str = Field(default="public", description="public, login_only, maintenance")
    is_published: bool = Field(default=True)

    # Announcement Bar
    announcement_enabled: bool = Field(default=True)
    announcement_badge: str = Field(default="What's New")
    announcement_text: str = Field(default="🚀 Live: Multi-Pipeline Ingestion with Automatic Zoho & QuickBooks Reconciliation.")
    announcement_link: Optional[str] = Field(default="#how-it-works")

    # Hero Section
    hero_badge: str = Field(default="Built for Accounting Firms, Hospitality & Multi-Branch Enterprises")
    hero_headline: str = Field(default="Stop Manually Keying Receipts, Control Slips & MoMo Statements.")
    hero_subheadline: str = Field(
        default="S4 Automations leverages Gemini Vision AI to read messy handwritten chits, crumpled vendor invoices, and mobile money dockets. It converts them into verified draft bills and invoices inside Zoho Books, QuickBooks, and Xero with 1 click."
    )
    hero_primary_cta_text: str = Field(default="Request a Free Firm Walkthrough")
    hero_primary_cta_action: str = Field(default="lead_modal")
    hero_secondary_cta_text: str = Field(default="See How It Works in 3 Steps")
    hero_secondary_cta_action: str = Field(default="#how-it-works")
    hero_highlights: List[str] = Field(
        default_factory=lambda: [
            "99.4% Extraction Accuracy",
            "Human-in-the-Loop Review Sheet",
            "Direct Bank & MoMo Reconciliation",
        ],
        sa_column=Column(JSON),
    )

    # Section Visibility Toggles (Visitor Controls)
    show_announcement: bool = Field(default=True)
    show_hero: bool = Field(default=True)
    show_how_it_works: bool = Field(default=True)
    show_ocr_sandbox: bool = Field(default=True)
    show_roi_calculator: bool = Field(default=True)
    show_integrations: bool = Field(default=True)
    show_social_proof: bool = Field(default=True)
    show_pricing: bool = Field(default=True)
    show_faq: bool = Field(default=True)
    show_cta_banner: bool = Field(default=True)
    show_demo_modal: bool = Field(default=True)
    show_client_portal_link: bool = Field(default=True)

    # WhatsApp & Quick Pilot
    whatsapp_number: str = Field(default="233200000000")
    whatsapp_message: str = Field(default="Hi S4 Team, I'd like to test 3 sample receipts/invoices from my firm for automation.")

    # ROI Parameters
    roi_hourly_rate_ghs: float = Field(default=75.0)
    roi_default_clients: int = Field(default=12)
    roi_default_slips: int = Field(default=180)

    # Custom FAQs (JSON list of {question, answer})
    faq_items: List[Dict[str, Any]] = Field(
        default_factory=lambda: [
            {
                "question": "How does S4 Automations handle messy handwriting and low-light scans?",
                "answer": "Our proprietary S4 Neural Ingestion Engine™ is trained on unstructured West African paperwork. Before any data reaches your ledger, low-confidence fields are flagged in a human-in-the-loop spreadsheet or web review inbox for your team to verify with 1 click.",
            },
            {
                "question": "Will syncing create duplicate invoices or bills in our accounting software?",
                "answer": "No. Every source document receives a cryptographic checksum. If you re-run an ingestion, our idempotent engine automatically matches existing draft documents and appends only verified items, completely eliminating duplicates.",
            },
            {
                "question": "Can the engine handle local statutory taxes (VAT, NHIL, GETFund, COVID levy)?",
                "answer": "Yes. S4's blueprint strategies automatically identify taxable items, calculate statutory levies, and post them directly to the corresponding tax sub-accounts in Zoho Books, QuickBooks, or Xero.",
            },
            {
                "question": "Do you store our or our clients' confidential financial data?",
                "answer": "No. S4 utilizes a Bring-Your-Own-Storage (BYOS) architecture. Your source scans and receipts remain safely inside your own Google Drive or cloud folders. We process and sync directly to your accounting API with bank-grade TLS 1.3 encryption.",
            },
            {
                "question": "How long does it take to onboard a new business or client?",
                "answer": "Setup takes less than 15 minutes. Connect your accounting organization via 1-Click OAuth, point S4 to your Google Drive folder, and run your first test extraction immediately.",
            },
        ],
        sa_column=Column(JSON),
    )

    # Pricing Tiers (JSON list of {id, title, subtitle, price_display, period, badge, features, cta_text, cta_action, is_popular})
    pricing_tiers: List[Dict[str, Any]] = Field(
        default_factory=lambda: [
            {
                "id": "business",
                "title": "Boutique & Single Entity",
                "subtitle": "Ideal for hotels, restaurants, retail shops, or single businesses automating daily control slips & bills.",
                "price_display": "Custom Pilot",
                "period": "starting at GHS 850/mo",
                "badge": "Single Business",
                "is_popular": False,
                "features": [
                    "Up to 500 monthly documents",
                    "Gemini 2.5 Flash Vision OCR",
                    "Google Sheets & Web Review Inbox",
                    "1-Click Sync to Zoho / QuickBooks",
                    "Linen & stock discrepancy alerts",
                    "WhatsApp audit support",
                ],
                "cta_text": "Start Free 20-Slip Pilot",
                "cta_action": "lead_modal",
            },
            {
                "id": "firm",
                "title": "Accounting & Advisory Firm",
                "subtitle": "Purpose-built for CPAs and bookkeepers managing multi-client portfolios.",
                "price_display": "Firm Portfolio",
                "period": "tailored to client volume",
                "badge": "Most Popular for CPAs",
                "is_popular": True,
                "features": [
                    "Unlimited client organizations",
                    "Multi-pipeline AR, AP & Bank streams",
                    "Client Clarification Magic Portal",
                    "Automatic MoMo & Bank feed matching",
                    "Multi-staff role permissions",
                    "Priority WhatsApp & Slack channel",
                ],
                "cta_text": "Request Firm Walkthrough",
                "cta_action": "lead_modal",
            },
            {
                "id": "enterprise",
                "title": "Multi-Branch Enterprise",
                "subtitle": "For large hospitality chains, commercial laundries, and distributed retail operations.",
                "price_display": "Enterprise SLA",
                "period": "custom dedicated deployment",
                "badge": "High Volume",
                "is_popular": False,
                "features": [
                    "Custom blueprint pipeline rules",
                    "Dedicated cloud ingestion workers",
                    "Custom ERP / Database connectors",
                    "Custom VAT / statutory tax engines",
                    "Dedicated account manager",
                    "99.9% uptime SLA guarantee",
                ],
                "cta_text": "Contact Enterprise Team",
                "cta_action": "whatsapp",
            },
        ],
        sa_column=Column(JSON),
    )

    # Maintenance Mode Details
    maintenance_headline: str = Field(default="S4 Automations is Upgrading")
    maintenance_message: str = Field(
        default="We are currently deploying high-throughput ingestion engine updates. Existing scheduled automated pipelines continue running in the background. Public registrations will re-open shortly."
    )
    maintenance_estimated_time: Optional[str] = Field(default="Resuming at 08:00 UTC")

    # Audit & Rollback
    version: int = Field(default=1)
    version_history: List[Dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    last_updated_by: Optional[str] = Field(default="System Administrator")
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(default_factory=get_utc_now)




