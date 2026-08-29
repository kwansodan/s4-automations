"""PostgreSQL & SQLite Database Engine and Session Management."""

import os
from typing import Generator
from sqlmodel import SQLModel, create_engine, Session, select
from sqlalchemy.exc import OperationalError

from app.config import settings
from app.utils.logging import get_logger

logger = get_logger("db.session")

# Build connection engine
def get_engine():
    db_url = settings.DATABASE_URL
    
    # In local testing without Postgres or in mock mode, fallback to sqlite cleanly
    try:
        if db_url.startswith("postgresql"):
            engine = create_engine(
                db_url,
                pool_pre_ping=True,
                pool_size=10,
                max_overflow=20,
                connect_args={"connect_timeout": 3},
            )
            # Test connection
            with engine.connect() as conn:
                pass
            return engine
    except Exception as e:
        logger.warning(f"PostgreSQL connection at {db_url} unavailable ({e}). Falling back to local SQLite database.")
    
    # SQLite Fallback for zero-blocker development & testing
    os.makedirs("data", exist_ok=True)
    sqlite_url = "sqlite:///data/s4_automations.db"
    return create_engine(sqlite_url, connect_args={"check_same_thread": False})


engine = get_engine()


def init_db():
    """Initializes database tables and seeds default clients."""
    from app.models.db_models import ClientOrganization

    logger.info("Initializing SQLModel database schemas...")
    SQLModel.metadata.create_all(engine)

    # Seed Default Clients if empty
    with Session(engine) as session:
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
                    description="Daily handwritten control slip OCR extraction, linen loss reconciliation, Google Sheets review sync, and Zoho Books draft invoicing.",
                    folder_id="1Uu_Q3p8s1_anr_laundry_slips",
                    zoho_org_id="782910482",
                    source_type="google_drive",
                    active_integrations=["Google Drive", "Gemini Vision 3.6", "Google Sheets", "Zoho Books", "Inngest"],
                    blueprints=[
                        {"title": "Vision OCR Extraction", "desc": "Gemini 3.6 Flash structured extraction", "status": "active"},
                        {"title": "Google Sheets Review Sync", "desc": "Populate Tab 1 & Tab 2", "status": "active"},
                        {"title": "Zoho Books Invoicing", "desc": "1-Click draft invoice appending", "status": "active"},
                    ],
                ),
                ClientOrganization(
                    id="polaris",
                    name="Polaris Capital & Advisory",
                    industry="Financial Services & Asset Management",
                    icon="⚡",
                    status="dev",
                    status_text="In Development",
                    description="Automated bank statement PDF parsing, multi-currency ledger matching, and Zoho Books expense journal posting.",
                    source_type="bank_feed",
                    active_integrations=["PDF Vision Parser", "Zoho Books Journals", "Bank Feeds", "Inngest"],
                    blueprints=[
                        {"title": "Bank Statement PDF Parser", "desc": "Extract structured transactions from multi-bank PDF statements", "status": "in_progress"},
                        {"title": "AI Transaction Categorization", "desc": "Match chart of accounts and assign expense categories", "status": "in_progress"},
                        {"title": "Zoho Journal Batch Poster", "desc": "Post balanced double-entry journals into Zoho Books API", "status": "queued"},
                    ],
                ),
                ClientOrganization(
                    id="mr_osei",
                    name="Mr. Osei Property Group",
                    industry="Real Estate & Property Management",
                    icon="🏢",
                    status="pending",
                    status_text="Setup Pending",
                    description="Automated tenant rent receipt processing, monthly recurring billing, utility cost allocation, and late notice dispatch.",
                    source_type="email",
                    active_integrations=["Email Receipts", "Google Sheets", "Zoho Invoicing", "Inngest"],
                    blueprints=[
                        {"title": "Rent Receipt OCR Ingestion", "desc": "Extract tenant mobile money / bank transfer receipts", "status": "queued"},
                        {"title": "Utility Cost Apportionment", "desc": "Apportion shared water/power bills across occupied units", "status": "queued"},
                        {"title": "Tenant Monthly Invoicing", "desc": "Generate tenant invoices with automated dispatch", "status": "queued"},
                    ],
                ),
            ]
            for c in default_clients:
                session.add(c)
            session.commit()
            logger.info("Successfully seeded 3 default accounting client organizations.")


def get_db_session() -> Generator[Session, None, None]:
    """FastAPI dependency yielding database session."""
    with Session(engine) as session:
        yield session
