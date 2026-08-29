"""SQLModel Database Models for PostgreSQL / SQLite."""

from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
from sqlmodel import SQLModel, Field, Column, JSON


def get_utc_now() -> datetime:
    """Returns current timezone-aware UTC datetime."""
    return datetime.now(timezone.utc)


class ClientOrganization(SQLModel, table=True):
    __tablename__ = "clients"

    id: str = Field(primary_key=True, description="Client slug identifier, e.g. anr_group")
    name: str = Field(index=True, description="Organization name")
    industry: str = Field(description="Business industry")
    icon: str = Field(default="🏢", description="Emoji icon")
    status: str = Field(default="dev", description="live, dev, pending")
    status_text: str = Field(default="In Development")
    description: Optional[str] = Field(default=None)
    folder_id: Optional[str] = Field(default=None, description="Google Drive folder ID")
    zoho_org_id: Optional[str] = Field(default=None, description="Zoho Books Organization ID")
    zoho_contact_id: Optional[str] = Field(default=None, description="Zoho Contact/Customer ID")
    source_type: str = Field(default="google_drive", description="google_drive, onedrive, email, bank_feed, manual, webhook")
    source_email: Optional[str] = Field(default=None, description="Dedicated inbound email address")
    source_config: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    custom_config: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    active_integrations: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    blueprints: List[Dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
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
    status: str = Field(default="PENDING", index=True)  # PENDING, INVOICED, JOURNAL_POSTED, REJECTED
    metadata_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=get_utc_now)
