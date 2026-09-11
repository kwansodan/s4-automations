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
        # organizations table
        ("organizations", "subscription_status", "VARCHAR DEFAULT 'ACTIVE'"),
        ("organizations", "billing_cycle", "VARCHAR DEFAULT 'MONTHLY'"),
        ("organizations", "currency", "VARCHAR DEFAULT 'GHS'"),
        ("organizations", "base_price", "FLOAT DEFAULT 2800.0"),
        ("organizations", "current_period_start", ts_type),
        ("organizations", "current_period_end", ts_type),
        ("organizations", "trial_start_at", ts_type),
        ("organizations", "trial_ends_at", ts_type),
        ("organizations", "trial_document_quota", "INTEGER DEFAULT 50"),
        ("organizations", "monthly_document_allowance", "INTEGER DEFAULT 3000"),
        ("organizations", "monthly_documents_processed", "INTEGER DEFAULT 0"),
        ("organizations", "topup_document_balance", "INTEGER DEFAULT 0"),
        ("organizations", "topup_purchased_total", "INTEGER DEFAULT 0"),
        ("organizations", "overage_rate_per_doc", "FLOAT DEFAULT 0.90"),
        ("organizations", "billing_contact_name", "VARCHAR"),
        ("organizations", "billing_contact_email", "VARCHAR"),
        ("organizations", "billing_contact_phone", "VARCHAR"),
        ("organizations", "billing_notes", "VARCHAR"),

        # clients table
        ("clients", "organization_id", "VARCHAR DEFAULT 's4_advisory'"),
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

    # Execute in an isolated connection without relying on inspector.get_table_names()
    # In PostgreSQL, ALTER TABLE ... ADD COLUMN IF NOT EXISTS is completely native and idempotent.
    # In SQLite, ALTER TABLE ... ADD COLUMN is executed and duplicate column errors are safely ignored.
    try:
        with active_engine.connect() as conn:
            # Step 1: Explicit curated column definitions
            for table_name, column_name, col_def in columns_to_ensure:
                if is_postgres:
                    stmt = f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {column_name} {col_def}"
                else:
                    stmt = f"ALTER TABLE {table_name} ADD COLUMN {column_name} {col_def}"

                try:
                    conn.execute(text(stmt))
                    conn.commit()
                except Exception as ex:
                    conn.rollback()
                    err_str = str(ex).lower()
                    if "already exists" in err_str or "duplicate column" in err_str or "does not exist" in err_str or "no such table" in err_str:
                        pass
                    else:
                        logger.debug(f"Notice on migrating {table_name}.{column_name}: {ex}")

            # Step 2: Dynamic SQLModel reflection fallback for any new fields
            for table_name, table in SQLModel.metadata.tables.items():
                for col in table.columns:
                    try:
                        col_type = col.type.compile(dialect=active_engine.dialect)
                    except Exception:
                        col_type = "VARCHAR"

                    if is_postgres:
                        stmt = f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {col.name} {col_type}"
                    else:
                        stmt = f"ALTER TABLE {table_name} ADD COLUMN {col.name} {col_type}"

                    try:
                        conn.execute(text(stmt))
                        conn.commit()
                    except Exception:
                        conn.rollback()

            # Step 3: Safe backfills for legacy rows with NULL organization_id
            try:
                conn.execute(text("UPDATE clients SET organization_id = 's4_advisory' WHERE organization_id IS NULL OR organization_id = ''"))
                conn.commit()
            except Exception:
                conn.rollback()
    except Exception as batch_err:
        logger.warning(f"Notice during schema migration batch: {batch_err}")


def init_db():
    """Initializes database tables, runs safe migrations, and seeds default clients."""
    from app.models.db_models import ClientOrganization

    active_engine = get_engine()
    logger.info("Initializing SQLModel database schemas...")
    try:
        SQLModel.metadata.create_all(active_engine)
    except Exception as e:
        logger.warning(f"Notice during metadata.create_all: {e}")

    # Run safe cross-platform column migrations unconditionally
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

            # Ensure ANR Group has default pipelines populated if empty
            anr_client = session.exec(select(ClientOrganization).where(ClientOrganization.id == "anr_group")).first()
            if anr_client and anr_client.pipelines is None:
                logger.info("Auto-healing ANR Group pipelines in database...")
                anr_client.pipelines = [
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
                        "is_active": True,
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
                        "is_active": True,
                    },
                ]
                session.add(anr_client)
                session.commit()
                logger.info("Successfully updated ANR Group pipelines.")

            # Seed Default Organizations (Accounting Firm & Direct Business) if empty
            from app.models.db_models import Organization, UserOrganizationMembership
            from app.config import settings

            existing_org = session.exec(select(Organization)).first()
            if not existing_org:
                logger.info("Seeding default dual-mode SaaS organizations...")
                default_orgs = [
                    Organization(
                        id="s4_advisory",
                        name="S4 Accounting & Advisory Partners",
                        org_type="ACCOUNTING_FIRM",
                        plan_tier="firm_scale",
                        max_clients=50,
                        industry="Chartered Accounting & Audit Practice",
                        icon="🏛️",
                        contact_email=settings.AUTH_EMAIL,
                    ),
                    Organization(
                        id="anr_group_direct",
                        name="ANR Group (Commercial Laundry)",
                        org_type="INDIVIDUAL_BUSINESS",
                        plan_tier="pro",
                        max_clients=1,
                        industry="Commercial Hospitality & Laundry Services",
                        icon="🧺",
                        contact_email="cfo@anrgroup.com",
                    ),
                ]
                for org in default_orgs:
                    session.add(org)
                session.commit()

                # Seed primary membership for admin
                admin_email = settings.AUTH_EMAIL.strip().lower()
                session.add(
                    UserOrganizationMembership(
                        user_email=admin_email,
                        organization_id="s4_advisory",
                        role="OWNER",
                        title="Managing Partner",
                        is_primary=True,
                    )
                )
                session.add(
                    UserOrganizationMembership(
                        user_email=admin_email,
                        organization_id="anr_group_direct",
                        role="ADMIN",
                        title="Advisory Partner / CFO",
                        is_primary=False,
                    )
                )
                session.commit()
                logger.info("Successfully seeded dual-mode SaaS organizations and memberships.")

            # Purge any legacy synthetic client contacts, team members, and staged transactions
            from app.models.db_models import ClientContact, FirmTeamMember, StagedTransaction
            fake_contact_emails = [
                "kwame@anrgroup.com",
                "adarko@anrgroup.com",
                "kofi@apexlogistics.gh",
            ]
            legacy_contacts = session.exec(
                select(ClientContact).where(ClientContact.email.in_(fake_contact_emails))
            ).all()
            for lc in legacy_contacts:
                session.delete(lc)

            fake_team_emails = [
                "aboateng@service4gh.com",
                "eosei@service4gh.com",
            ]
            legacy_team = session.exec(
                select(FirmTeamMember).where(FirmTeamMember.email.in_(fake_team_emails))
            ).all()
            for lt in legacy_team:
                session.delete(lt)

            legacy_staged = session.exec(
                select(StagedTransaction).where(
                    StagedTransaction.source_file_name.like("%Stanbic%")
                )
            ).all()
            for ls in legacy_staged:
                session.delete(ls)

            session.commit()

            # Ensure the primary firm partner exists
            admin_email = (settings.AUTH_EMAIL or "cdanso@service4gh.com").strip().lower()
            existing_admin_member = session.exec(
                select(FirmTeamMember).where(FirmTeamMember.email == admin_email)
            ).first()
            if not existing_admin_member:
                admin_member = FirmTeamMember(
                    organization_id="s4_advisory",
                    name="Charles Danso",
                    email=admin_email,
                    phone="+233 24 400 1122",
                    role="PARTNER",
                    status="ACTIVE",
                    assigned_client_ids=["*"],
                    permissions={
                        "can_query_clients": True,
                        "can_categorize": True,
                        "can_sync_accounting": True,
                        "can_manage_clients": True,
                    },
                )
                session.add(admin_member)
                session.commit()

            # Ensure any legacy synthetic mock bank transactions are purged
            from app.models.db_models import BankTransaction
            mock_banks = [
                "Stanbic Bank Corporate",
                "Ecobank Ghana GHS Operating",
                "Chase Commercial Checking",
                "Standard Chartered Main",
                "Generic Operating Account",
            ]
            del_txs = session.exec(
                select(BankTransaction).where(
                    BankTransaction.bank_account_name.in_(mock_banks)
                )
            ).all()
            if del_txs:
                for dtx in del_txs:
                    session.delete(dtx)
                session.commit()
                logger.info(f"Purged {len(del_txs)} legacy synthetic bank transactions on database init.")
    except Exception as e:
        logger.warning(f"Database seed notice: {e}")


_migrations_checked = False


def get_db_session() -> Generator[Session, None, None]:
    """FastAPI dependency yielding database session, ensuring schema migrations run on first request."""
    global _migrations_checked
    active_engine = get_engine()
    if not _migrations_checked:
        try:
            run_schema_migrations(active_engine)
            _migrations_checked = True
        except Exception as mig_err:
            logger.warning(f"Lazy schema migration notice: {mig_err}")

    with Session(active_engine) as session:
        yield session


# Alias for dependency injection compatibility
get_db = get_db_session

