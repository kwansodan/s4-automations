"""PostgreSQL & SQLite Database Engine and Session Management."""

import os
from typing import Generator, Optional
from sqlmodel import SQLModel, create_engine, Session, select
from sqlalchemy.engine import Engine

from app.config import settings
from app.utils.logging import get_logger

logger = get_logger("db.session")

_engine: Optional[Engine] = None


def get_engine() -> Engine:
    """Returns singleton database engine, dynamically falling back to SQLite if PostgreSQL is unreachable."""
    global _engine
    if _engine is not None:
        return _engine

    db_url = settings.DATABASE_URL
    if db_url.startswith("postgres"):
        if db_url.startswith("postgres://"):
            db_url = db_url.replace("postgres://", "postgresql://", 1)
        try:
            temp_engine = create_engine(
                db_url,
                pool_pre_ping=True,
                pool_size=10,
                max_overflow=20,
                connect_args={"connect_timeout": 1},
            )
            # Test connectivity immediately
            with temp_engine.connect() as conn:
                pass
            _engine = temp_engine
            logger.info("Connected to PostgreSQL database successfully.")
            return _engine
        except Exception as e:
            logger.info(f"PostgreSQL connection to {db_url} not available ({e}). Using local SQLite database.")

    # SQLite fallback
    os.makedirs("data", exist_ok=True)
    sqlite_url = "sqlite:///data/s4_automations.db"
    _engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})
    return _engine


# Engine proxy export
class _EngineProxy:
    def __getattr__(self, name):
        return getattr(get_engine(), name)


engine = _EngineProxy()


def init_db():
    """Initializes database tables and seeds default clients."""
    from app.models.db_models import ClientOrganization

    active_engine = get_engine()
    logger.info("Initializing SQLModel database schemas...")
    SQLModel.metadata.create_all(active_engine)

    # SQLite migration: ensure columns exist for backward compatibility with existing databases
    with active_engine.connect() as conn:
        from sqlalchemy import text
        migrations = [
            "ALTER TABLE clients ADD COLUMN pipelines JSON DEFAULT '[]'",
            "ALTER TABLE clients ADD COLUMN accounting_software VARCHAR DEFAULT 'zoho_books'",
            "ALTER TABLE staged_transactions ADD COLUMN pipeline_id VARCHAR",
            "ALTER TABLE staged_transactions ADD COLUMN pipeline_name VARCHAR",
            "ALTER TABLE staged_transactions ADD COLUMN entity_type VARCHAR",
            "ALTER TABLE staged_transactions ADD COLUMN pipeline_type VARCHAR DEFAULT 'AR'",
            "ALTER TABLE staged_transactions ADD COLUMN validation_status VARCHAR DEFAULT 'VALID'",
            "ALTER TABLE staged_transactions ADD COLUMN validation_errors JSON DEFAULT '[]'",
        ]
        for m in migrations:
            try:
                conn.execute(text(m))
                conn.commit()
            except Exception:
                pass

    # Seed Default Clients if empty
    with Session(active_engine) as session:
        existing = session.exec(select(ClientOrganization)).first()
        if not existing:
            logger.info("Seeding default accounting client organizations...")
            default_clients = [
                ClientOrganization(
                    id="anr_group",
                    name="ANR Group (Commercial Laundry)",
                    industry="Commercial Hospitality & Laundry Services",
                    icon="🧺",
                    status="live",
                    status_text="Production Live",
                    accounting_software="zoho_books",
                    description="Daily handwritten control slip OCR extraction, linen loss reconciliation, Google Sheets review sync, and Zoho Books draft invoicing.",
                    folder_id="1Uu_Q3p8s1_anr_laundry_slips",
                    zoho_org_id="782910482",
                    source_type="google_drive",
                    active_integrations=["Google Drive", "Gemini Vision 3.6", "Google Sheets", "Zoho Books", "Inngest"],
                    pipelines=[
                        {
                            "id": "pipe_anr_daily_slips",
                            "name": "Daily Control Slips OCR",
                            "section": "AR",
                            "entity_type": "ar_sales_invoice",
                            "source_type": "google_drive",
                            "source_identifier": "1Uu_Q3p8s1_anr_laundry_slips",
                            "schedule": "Daily @ 18:00 UTC",
                            "auto_post_draft": False,
                            "active": True,
                        },
                        {
                            "id": "pipe_anr_detergent_bills",
                            "name": "Chemical & Detergent Vendor Bills",
                            "section": "AP",
                            "entity_type": "ap_vendor_bill",
                            "source_type": "email",
                            "source_identifier": "bills@anrgroup.com",
                            "schedule": "Weekly on Friday",
                            "auto_post_draft": False,
                            "active": True,
                        },
                    ],
                    blueprints=[
                        {"title": "Vision OCR Extraction", "desc": "Gemini 3.6 Flash structured extraction", "status": "active"},
                        {"title": "Google Sheets Review Sync", "desc": "Populate Tab 1 & Tab 2", "status": "active"},
                        {"title": "Draft Invoicing Engine", "desc": "1-Click draft invoice appending", "status": "active"},
                    ],
                ),
                ClientOrganization(
                    id="polaris",
                    name="Polaris Capital & Advisory",
                    industry="Financial Services & Asset Management",
                    icon="⚡",
                    status="dev",
                    status_text="In Development",
                    accounting_software="xero",
                    description="Automated bank statement PDF parsing, multi-currency ledger matching, and Xero expense journal posting.",
                    folder_id="xero_tenant_accra_01",
                    zoho_org_id="xero_tenant_accra_01",
                    source_type="bank_feed",
                    active_integrations=["PDF Vision Parser", "Xero Accounting", "Bank Feeds", "Inngest"],
                    pipelines=[
                        {
                            "id": "pipe_polaris_bank_feed",
                            "name": "Stanbic Bank Statements Feed",
                            "section": "BANK",
                            "entity_type": "bank_statement",
                            "source_type": "bank_feed",
                            "source_identifier": "904000889122",
                            "schedule": "Daily @ 06:00 UTC",
                            "auto_post_draft": False,
                            "active": True,
                        },
                        {
                            "id": "pipe_polaris_gl_journals",
                            "name": "Advisory Retainer GL Journal Posting",
                            "section": "GL",
                            "entity_type": "gl_journal",
                            "source_type": "email",
                            "source_identifier": "advisory@polariscapital.com",
                            "schedule": "Monthly on 28th",
                            "auto_post_draft": False,
                            "active": True,
                        },
                    ],
                    blueprints=[
                        {"title": "Bank Statement PDF Parser", "desc": "Extract structured transactions from multi-bank PDF statements", "status": "in_progress"},
                        {"title": "AI Transaction Categorization", "desc": "Match chart of accounts and assign expense categories", "status": "in_progress"},
                        {"title": "Journal Batch Poster", "desc": "Post balanced double-entry journals into Xero Accounting API", "status": "queued"},
                    ],
                ),
                ClientOrganization(
                    id="mr_osei",
                    name="Mr. Osei Property Group",
                    industry="Real Estate & Property Management",
                    icon="🏢",
                    status="pending",
                    status_text="Setup Pending",
                    accounting_software="quickbooks_online",
                    description="Automated tenant rent receipt processing, monthly recurring billing, utility cost allocation, and late notice dispatch.",
                    folder_id="9341452891048201",
                    zoho_org_id="9341452891048201",
                    source_type="whatsapp",
                    active_integrations=["WhatsApp Receipts", "Google Sheets", "QuickBooks Online", "Inngest"],
                    pipelines=[
                        {
                            "id": "pipe_mr_osei_rent_receipts",
                            "name": "Tenant Rent MoMo Receipts OCR",
                            "section": "AR",
                            "entity_type": "ar_sales_invoice",
                            "source_type": "whatsapp",
                            "source_identifier": "+233244009988",
                            "schedule": "Real-time Webhook",
                            "auto_post_draft": False,
                            "active": True,
                        },
                        {
                            "id": "pipe_mr_osei_utility_bills",
                            "name": "Shared Utility & Power Bills",
                            "section": "AP",
                            "entity_type": "ap_vendor_bill",
                            "source_type": "email",
                            "source_identifier": "utilities@propertygroup.com",
                            "schedule": "Monthly on 1st",
                            "auto_post_draft": False,
                            "active": True,
                        },
                    ],
                    blueprints=[
                        {"title": "Rent Receipt OCR Ingestion", "desc": "Extract tenant mobile money / bank transfer receipts", "status": "queued"},
                        {"title": "Utility Cost Apportionment", "desc": "Apportion shared water/power bills across occupied units", "status": "queued"},
                        {"title": "Tenant Monthly Invoicing", "desc": "Generate tenant invoices with automated dispatch in QuickBooks Online", "status": "queued"},
                    ],
                ),
            ]
            for c in default_clients:
                session.add(c)
            session.commit()
            logger.info("Successfully seeded 3 default accounting client organizations.")


def get_db_session() -> Generator[Session, None, None]:
    """FastAPI dependency yielding database session."""
    with Session(get_engine()) as session:
        yield session
