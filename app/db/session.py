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
                connect_args={"connect_timeout": 10},
            )
            # Test connectivity immediately
            with temp_engine.connect() as conn:
                pass
            _engine = temp_engine
            logger.info("Connected to PostgreSQL database successfully.")
            return _engine
        except Exception as e:
            logger.warning(f"PostgreSQL connection to {db_url} not available ({e}). Using local SQLite database.")

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


def run_schema_migrations(active_engine: Engine):
    """
    Safely and idempotently adds missing columns to existing tables for PostgreSQL and SQLite.
    Inspects existing columns first to avoid aborted transactions on PostgreSQL.
    Executes each statement in its own isolated connection with explicit rollback on error.
    Combines explicit curated column definitions with dynamic SQLModel reflection fallback.
    """
    import app.models.db_models  # Ensure all SQLModel schemas are registered
    from sqlalchemy import inspect, text

    is_postgres = active_engine.dialect.name == "postgresql"
    ts_type = "TIMESTAMP" if is_postgres else "DATETIME"
    json_type = "JSON"

    columns_to_ensure = [
        # clients table
        ("clients", "accounting_software", "VARCHAR DEFAULT 'zoho_books'"),
        ("clients", "folder_id", "VARCHAR"),
        ("clients", "zoho_org_id", "VARCHAR"),
        ("clients", "zoho_contact_id", "VARCHAR"),
        ("clients", "source_type", "VARCHAR DEFAULT 'google_drive'"),
        ("clients", "status_text", "VARCHAR DEFAULT 'In Development'"),
        ("clients", "icon", "VARCHAR DEFAULT '🏢'"),
        ("clients", "pipelines", f"{json_type} DEFAULT '[]'"),
        ("clients", "team_members", f"{json_type} DEFAULT '[]'"),
        ("clients", "watched_accounts", f"{json_type} DEFAULT '[\"6990\", \"850\", \"suspense\", \"uncategorized\"]'"),
        ("clients", "blueprints", f"{json_type} DEFAULT '[]'"),
        ("clients", "active_integrations", f"{json_type} DEFAULT '[]'"),
        ("clients", "source_config", f"{json_type} DEFAULT '{{}}'"),
        ("clients", "custom_config", f"{json_type} DEFAULT '{{}}'"),
        ("clients", "stats_summary", f"{json_type} DEFAULT '{{}}'"),
        ("clients", "source_email", "VARCHAR"),
        ("clients", "last_run_at", ts_type),
        ("clients", "updated_at", f"{ts_type} DEFAULT CURRENT_TIMESTAMP"),

        # staged_transactions table
        ("staged_transactions", "pipeline_id", "VARCHAR"),
        ("staged_transactions", "pipeline_name", "VARCHAR"),
        ("staged_transactions", "entity_type", "VARCHAR DEFAULT 'ar_sales_invoice'"),
        ("staged_transactions", "pipeline_type", "VARCHAR DEFAULT 'AR'"),
        ("staged_transactions", "confidence_score", "FLOAT DEFAULT 1.0"),
        ("staged_transactions", "discrepancy_amount", "FLOAT DEFAULT 0.0"),
        ("staged_transactions", "discrepancy_reason", "VARCHAR"),
        ("staged_transactions", "validation_status", "VARCHAR DEFAULT 'VALID'"),
        ("staged_transactions", "validation_errors", f"{json_type} DEFAULT '[]'"),
        ("staged_transactions", "checksum", "VARCHAR"),
        ("staged_transactions", "source_identifier", "VARCHAR"),
        ("staged_transactions", "category_or_account", "VARCHAR"),
        ("staged_transactions", "accounting_ref_id", "VARCHAR"),
        ("staged_transactions", "metadata_json", f"{json_type} DEFAULT '{{}}'"),

        # bank_transactions table
        ("bank_transactions", "bank_account_name", "VARCHAR DEFAULT 'Main Operating Bank Account'"),
        ("bank_transactions", "checksum", "VARCHAR"),
        ("bank_transactions", "mapped_account_id", "VARCHAR"),
        ("bank_transactions", "mapped_account_name", "VARCHAR"),
        ("bank_transactions", "payee_name", "VARCHAR"),
        ("bank_transactions", "tax_rate", "VARCHAR"),
        ("bank_transactions", "ai_suggested_account", "VARCHAR"),
        ("bank_transactions", "category_confidence", "FLOAT DEFAULT 0.0"),
        ("bank_transactions", "client_attachments", f"{json_type} DEFAULT '[]'"),
        ("bank_transactions", "client_explanation", "VARCHAR"),
        ("bank_transactions", "accountant_query", "VARCHAR"),
        ("bank_transactions", "query_date", ts_type),
        ("bank_transactions", "response_date", ts_type),
        ("bank_transactions", "source_platform", "VARCHAR DEFAULT 'bank_feed'"),
        ("bank_transactions", "metadata_json", f"{json_type} DEFAULT '{{}}'"),
        ("bank_transactions", "updated_at", f"{ts_type} DEFAULT CURRENT_TIMESTAMP"),

        # auth_otps table
        ("auth_otps", "is_verified", "BOOLEAN DEFAULT FALSE"),
        ("auth_otps", "attempts", "INTEGER DEFAULT 0"),

        # audit_logs table
        ("audit_logs", "actor_email", "VARCHAR DEFAULT 'system'"),
        ("audit_logs", "source_type", "VARCHAR DEFAULT 'system'"),
        ("audit_logs", "source_identifier", "VARCHAR"),
    ]

    try:
        inspector = inspect(active_engine)
        existing_tables = set(inspector.get_table_names())
    except Exception as e:
        logger.warning(f"Failed to inspect database tables: {e}")
        existing_tables = set()

    # Step 1: Explicit curated column migration
    for table_name, column_name, col_def in columns_to_ensure:
        if table_name not in existing_tables:
            continue

        try:
            existing_cols = {c["name"] for c in inspector.get_columns(table_name)}
            if column_name in existing_cols:
                continue
        except Exception as e:
            logger.debug(f"Could not inspect columns for table '{table_name}': {e}")

        logger.info(f"Schema migration: Adding missing column '{column_name}' to table '{table_name}'...")
        if is_postgres:
            stmt = f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {column_name} {col_def}"
        else:
            stmt = f"ALTER TABLE {table_name} ADD COLUMN {column_name} {col_def}"

        # Execute in an isolated connection
        try:
            with active_engine.connect() as conn:
                try:
                    conn.execute(text(stmt))
                    conn.commit()
                    logger.info(f"Successfully added column '{column_name}' to '{table_name}'.")
                except Exception as ex:
                    conn.rollback()
                    if "already exists" in str(ex).lower():
                        logger.debug(f"Column '{column_name}' on '{table_name}' already exists.")
                    else:
                        logger.warning(f"Notice on adding column '{column_name}' to '{table_name}': {ex}")
        except Exception as conn_err:
            logger.warning(f"Connection error while migrating '{table_name}.{column_name}': {conn_err}")

    # Step 2: Dynamic reflection fallback across all registered SQLModel tables
    for table_name, table in SQLModel.metadata.tables.items():
        if table_name not in existing_tables:
            continue

        try:
            existing_cols = {c["name"] for c in inspector.get_columns(table_name)}
        except Exception:
            continue

        for col in table.columns:
            if col.name in existing_cols:
                continue

            try:
                col_type = col.type.compile(dialect=active_engine.dialect)
            except Exception:
                col_type = "VARCHAR"

            logger.info(f"Dynamic schema migration: Detected unmigrated column '{col.name}' ({col_type}) on table '{table_name}'...")
            if is_postgres:
                stmt = f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {col.name} {col_type}"
            else:
                stmt = f"ALTER TABLE {table_name} ADD COLUMN {col.name} {col_type}"

            try:
                with active_engine.connect() as conn:
                    try:
                        conn.execute(text(stmt))
                        conn.commit()
                        logger.info(f"Successfully dynamically added column '{col.name}' to '{table_name}'.")
                    except Exception as ex:
                        conn.rollback()
                        if "already exists" not in str(ex).lower():
                            logger.warning(f"Notice on dynamically adding column '{col.name}' to '{table_name}': {ex}")
            except Exception as conn_err:
                logger.warning(f"Connection error while dynamically adding '{table_name}.{col.name}': {conn_err}")


def init_db():
    """Initializes database tables, runs safe migrations, and seeds default clients."""
    from app.models.db_models import ClientOrganization

    active_engine = get_engine()
    logger.info("Initializing SQLModel database schemas...")
    SQLModel.metadata.create_all(active_engine)

    # Run safe cross-platform column migrations
    run_schema_migrations(active_engine)

    # Seed Default Clients if empty
    try:
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
                ]
                for c in default_clients:
                    session.add(c)
                session.commit()
                logger.info("Successfully seeded default accounting client organizations.")
    except Exception as e:
        logger.warning(f"Database seed notice: {e}")


def get_db_session() -> Generator[Session, None, None]:
    """FastAPI dependency yielding database session."""
    with Session(get_engine()) as session:
        yield session
