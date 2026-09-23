"""Configuration, Diagnostics, and Aggregated Stats endpoints."""

from typing import Dict, Any, Optional
from datetime import datetime
from fastapi import APIRouter

from app.config import settings
from app.services.zoho_service import ZohoBooksService
from app.services.google_drive_service import GoogleDriveService
from app.utils.logging import get_logger

logger = get_logger("api.config")
router = APIRouter(tags=["Configuration & Stats"])


@router.get("/config", summary="Get System Configuration")
async def get_configuration() -> Dict[str, Any]:
    """Returns current system configuration with sensitive keys masked."""
    return {
        "status": "success",
        "config": settings.get_masked_dict(),
    }


ALLOWED_CONFIG_KEYS = {
    "INNGEST_DEV_SERVER_URL",
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "ZOHO_CLIENT_ID",
    "ZOHO_CLIENT_SECRET",
    "ZOHO_REFRESH_TOKEN",
    "ZOHO_ORG_ID",
    "ZOHO_ACCOUNTS_URL",
    "ZOHO_BOOKS_API_URL",
    "CONTROL_SHEETS_FOLDER_ID",
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64",
    "MAILJET_API_KEY",
    "MAILJET_SECRET_KEY",
    "MAILJET_FROM_EMAIL",
    "MAILJET_FROM_NAME",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM",
    "NOTIFICATION_EMAIL",
    "LINKEDIN_ACCESS_TOKEN",
    "LINKEDIN_AUTHOR_URN",
    "LINKEDIN_ORGANIZATION_ID",
    "LINKEDIN_PAGE_NAME",
    "LINKEDIN_POSTING_MODE",
    "LINKEDIN_CLIENT_ID",
    "LINKEDIN_CLIENT_SECRET",
    "LINKEDIN_REDIRECT_URI",
    "TWITTER_API_KEY",
    "TWITTER_API_SECRET",
    "TWITTER_ACCESS_TOKEN",
    "TWITTER_ACCESS_SECRET",
    "MOCK_MODE",
    "ALLOWED_ORIGINS",
}


@router.post("/config", summary="Update System Configuration")
async def update_configuration(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Updates system configuration dynamically in memory and persists to .env file.
    Only whitelisted keys are accepted.
    """
    logger.info("Received configuration update from authenticated admin.")
    persist = payload.pop("persist_to_file", True)

    sanitized_payload = {k: v for k, v in payload.items() if k in ALLOWED_CONFIG_KEYS}
    settings.update_values(sanitized_payload)
    if persist:
        settings.save_to_env_file()
        logger.info("Successfully persisted sanitized configuration to .env file.")

    return {
        "status": "UPDATED",
        "message": "Configuration updated successfully and applied to runtime.",
        "config": settings.get_masked_dict(),
    }


@router.post("/config/test", summary="Run Connectivity Diagnostics")
@router.post("/config/diagnostics", summary="Run Connectivity Diagnostics (Alias)")
async def test_configuration_connections() -> Dict[str, Any]:
    """
    Performs live connectivity diagnostics against Gemini, Zoho Books, Google Drive, Inngest, and Database.
    """
    logger.info("Running connectivity test for all platform integrations...")
    results = {
        "gemini_status": "UNKNOWN",
        "gemini_message": "",
        "zoho_status": "UNKNOWN",
        "zoho_message": "",
        "google_status": "UNKNOWN",
        "google_message": "",
        "inngest_status": "UNKNOWN",
        "inngest_message": "",
        "database_status": "UNKNOWN",
        "database_message": "",
        "all_healthy": True,
    }

    # 1. Test Gemini
    try:
        if settings.MOCK_MODE or not settings.GEMINI_API_KEY:
            results["gemini_status"] = "MOCK_OK"
            results["gemini_message"] = "Mock mode enabled (simulated Gemini 3.6 Flash responses)"
        else:
            from google import genai
            client = genai.Client(api_key=settings.GEMINI_API_KEY)
            resp = client.models.generate_content(
                model=settings.GEMINI_MODEL,
                contents="Ping",
            )
            results["gemini_status"] = "CONNECTED"
            results["gemini_message"] = f"Successfully pinged {settings.GEMINI_MODEL}"
    except Exception as e:
        results["gemini_status"] = "FAILED"
        results["gemini_message"] = str(e)
        results["all_healthy"] = False

    # 2. Test Zoho Books
    try:
        zoho = ZohoBooksService()
        contacts = await zoho.fetch_active_contacts()
        results["zoho_status"] = "CONNECTED" if not settings.MOCK_MODE else "MOCK_OK"
        results["zoho_message"] = f"Successfully authenticated. Loaded {len(contacts)} contacts."
    except Exception as e:
        results["zoho_status"] = "FAILED"
        results["zoho_message"] = str(e)
        results["all_healthy"] = False

    # 3. Test Google Drive / Sheets
    try:
        drive = GoogleDriveService()
        month_folder = drive.get_month_folder("August", 2026)
        results["google_status"] = "CONNECTED" if not settings.MOCK_MODE else "MOCK_OK"
        results["google_message"] = f"Drive folder access verified: {month_folder}"
    except Exception as e:
        results["google_status"] = "FAILED"
        results["google_message"] = str(e)
        results["all_healthy"] = False

    # 4. Inngest
    if settings.INNGEST_EVENT_KEY and settings.INNGEST_SIGNING_KEY:
        results["inngest_status"] = "CONFIGURED"
        results["inngest_message"] = f"Inngest App: {settings.INNGEST_APP_ID}"
    else:
        results["inngest_status"] = "WARNING"
        results["inngest_message"] = "Inngest keys missing or running in local dev mode"

    # 5. Database Connection (PostgreSQL / SQLite)
    try:
        from app.db.session import get_engine
        from sqlalchemy import text
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        dialect = engine.dialect.name
        results["database_status"] = "CONNECTED"
        results["database_message"] = f"Database online ({dialect.upper()})"
    except Exception as e:
        results["database_status"] = "FAILED"
        results["database_message"] = f"Database connectivity error: {str(e)}"
        results["all_healthy"] = False

    return results


@router.get("/stats", summary="Get Aggregated KPI Dashboard Stats")
async def get_dashboard_stats(month: Optional[str] = None, year: Optional[int] = None) -> Dict[str, Any]:
    """Returns aggregated KPI summary metrics computed natively from PostgreSQL staged_transactions."""
    now = datetime.now()
    t_month = month or now.strftime("%B")
    t_year = year or now.year

    from app.db.session import get_engine
    from sqlmodel import Session, select
    from app.models.db_models import StagedTransaction

    total_slips = 0
    total_loss = 0
    approved_total = 0.0
    pending_count = 0
    active_clients = 0

    try:
        with Session(get_engine()) as session:
            query = select(StagedTransaction)
            all_tx = session.exec(query).all()

            # Match target month and year if transaction_date provided
            period_tx = []
            for tx in all_tx:
                match = True
                if tx.transaction_date and t_month:
                    try:
                        dt = datetime.fromisoformat(tx.transaction_date.replace("Z", "+00:00"))
                        if dt.strftime("%B").lower() != t_month.lower():
                            match = False
                        if t_year and dt.year != t_year:
                            match = False
                    except Exception:
                        pass
                if match:
                    period_tx.append(tx)

            total_slips = len(set(tx.source_file_name for tx in period_tx if tx.source_file_name))
            total_loss = sum(int(tx.discrepancy_amount or 0) for tx in period_tx)
            approved_total = sum(float(tx.total_amount or 0.0) for tx in period_tx if tx.approved)
            pending_count = sum(1 for tx in period_tx if not tx.approved and tx.status in ["PENDING", "APPROVED"])
            active_clients = len(set(tx.client_id for tx in period_tx if tx.client_id))
    except Exception as e:
        logger.warning(f"Error querying PostgreSQL ledger stats: {e}")

    return {
        "total_slips_ingested": total_slips,
        "unreturned_linen_loss_count": total_loss,
        "approved_billing_total_ghs": round(approved_total, 2),
        "pending_approval_count": pending_count,
        "active_clients_count": active_clients,
        "mock_mode": settings.MOCK_MODE,
    }


@router.get("/audit", summary="Comprehensive System Configuration & Placeholder Audit")
async def run_system_audit() -> Dict[str, Any]:
    """
    Performs a deep diagnostic audit of all database records, client organizations,
    pipeline stream configurations, and external credentials to identify invalid placeholders.
    """
    from app.db.session import get_engine
    from sqlmodel import Session, select
    from app.models.db_models import ClientOrganization, StagedTransaction

    audit_report = {
        "timestamp": datetime.now().isoformat(),
        "overall_status": "HEALTHY",
        "placeholders_found": 0,
        "environment_checks": {},
        "client_audits": [],
        "database_stats": {},
        "recommendations": [],
    }

    # 1. Environment and Storage Checks
    ctrl_folder = (settings.CONTROL_SHEETS_FOLDER_ID or "").strip()
    has_valid_folder = bool(ctrl_folder and ctrl_folder != "1Uu_Q3p8s1_anr_laundry_slips")
    
    audit_report["environment_checks"] = {
        "CONTROL_SHEETS_FOLDER_ID": {
            "status": "VALID" if has_valid_folder else "MISSING_OR_PLACEHOLDER",
            "value": ctrl_folder[:12] + "..." if ctrl_folder else "NOT_CONFIGURED",
            "is_placeholder": ctrl_folder == "1Uu_Q3p8s1_anr_laundry_slips",
        },
        "GEMINI_API_KEY": {
            "status": "CONFIGURED" if bool(settings.GEMINI_API_KEY) else "MISSING",
            "model": settings.GEMINI_MODEL,
        },
        "ZOHO_BOOKS": {
            "status": "CONFIGURED" if bool(settings.ZOHO_REFRESH_TOKEN and settings.ZOHO_ORG_ID) else "PARTIAL_OR_MOCK",
            "org_id": settings.ZOHO_ORG_ID or "NOT_SET",
        },
        "GOOGLE_SERVICE_ACCOUNT": {
            "status": "CONFIGURED" if bool(settings.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 or settings.GOOGLE_SERVICE_ACCOUNT_FILE) else "MISSING",
            "email": settings.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        },
    }

    # 2. Database Clients and Pipelines Audit
    placeholder_count = 0
    client_reports = []

    try:
        with Session(get_engine()) as session:
            clients = session.exec(select(ClientOrganization)).all()
            total_staged = session.exec(select(StagedTransaction)).all()
            
            audit_report["database_stats"] = {
                "total_clients": len(clients),
                "total_staged_transactions": len(total_staged),
            }

            for c in clients:
                client_report = {
                    "id": c.id,
                    "name": c.name,
                    "folder_id": c.folder_id,
                    "folder_status": "VALID",
                    "issues": [],
                    "pipelines": [],
                }

                # Check root folder ID
                if not c.folder_id:
                    client_report["issues"].append("Root folder_id is not configured.")
                    client_report["folder_status"] = "MISSING"
                elif c.folder_id == "1Uu_Q3p8s1_anr_laundry_slips":
                    client_report["issues"].append("Root folder_id is holding dummy placeholder '1Uu_Q3p8s1_anr_laundry_slips'.")
                    client_report["folder_status"] = "PLACEHOLDER_DETECTED"
                    placeholder_count += 1

                # Audit each configured pipeline
                pipelines = c.pipelines or []
                for p in pipelines:
                    p_id = p.get("id", "unnamed")
                    p_name = p.get("name", "Unnamed Pipeline")
                    p_source_id = p.get("source_identifier") or ""
                    p_source_type = p.get("source_type") or "google_drive"
                    
                    p_issues = []
                    if p_source_type == "google_drive":
                        if p_source_id == "1Uu_Q3p8s1_anr_laundry_slips":
                            p_issues.append("Pipeline source_identifier is using dummy placeholder '1Uu_Q3p8s1_anr_laundry_slips'.")
                            placeholder_count += 1
                        elif not p_source_id and not has_valid_folder:
                            p_issues.append("No source folder configured on pipeline and no root folder in environment.")

                    client_report["pipelines"].append({
                        "id": p_id,
                        "name": p_name,
                        "source_type": p_source_type,
                        "source_identifier": p_source_id,
                        "has_issues": len(p_issues) > 0,
                        "issues": p_issues,
                    })
                    if p_issues:
                        client_report["issues"].extend(p_issues)

                client_reports.append(client_report)

    except Exception as e:
        logger.error(f"Error auditing database records: {e}")
        audit_report["recommendations"].append(f"Database query error: {str(e)}")

    audit_report["client_audits"] = client_reports
    audit_report["placeholders_found"] = placeholder_count

    if placeholder_count > 0:
        audit_report["overall_status"] = "WARNING_PLACEHOLDERS_DETECTED"
        audit_report["recommendations"].append(
            f"Detected {placeholder_count} legacy dummy placeholder identifier(s). "
            f"Trigger the 1-Click Repair tool (/api/config/audit/repair) to replace with production settings."
        )
    elif not has_valid_folder:
        audit_report["overall_status"] = "WARNING_FOLDER_MISSING"
        audit_report["recommendations"].append(
            "CONTROL_SHEETS_FOLDER_ID environment variable is missing or empty. Please set your root Google Drive folder ID."
        )

    return audit_report


@router.post("/audit/repair", summary="1-Click Auto-Remediation & Placeholder Scrub")
async def repair_system_placeholders() -> Dict[str, Any]:
    """
    Scans and automatically repairs all legacy dummy placeholder folder IDs in the database,
    synchronizing them to the active CONTROL_SHEETS_FOLDER_ID environment setting.
    """
    from app.db.session import get_engine
    from sqlmodel import Session, select
    from app.models.db_models import ClientOrganization

    real_folder = (settings.CONTROL_SHEETS_FOLDER_ID or "").strip()
    repaired_clients = []
    repaired_pipelines = []

    try:
        with Session(get_engine()) as session:
            clients = session.exec(select(ClientOrganization)).all()
            for c in clients:
                updated = False
                
                # Auto-heal root folder ID
                if c.folder_id == "1Uu_Q3p8s1_anr_laundry_slips":
                    c.folder_id = real_folder or None
                    updated = True
                    repaired_clients.append({"client_id": c.id, "name": c.name, "new_folder_id": c.folder_id})

                # Auto-heal pipelines
                if c.pipelines:
                    new_pipes = []
                    for p in c.pipelines:
                        pipe_dict = dict(p)
                        if pipe_dict.get("source_identifier") == "1Uu_Q3p8s1_anr_laundry_slips":
                            pipe_dict["source_identifier"] = real_folder or ""
                            repaired_pipelines.append({
                                "client_id": c.id,
                                "pipeline_id": pipe_dict.get("id"),
                                "pipeline_name": pipe_dict.get("name"),
                                "new_source_identifier": pipe_dict["source_identifier"],
                            })
                            updated = True
                        new_pipes.append(pipe_dict)
                    c.pipelines = new_pipes

                if updated:
                    session.add(c)

            session.commit()
            logger.info(f"Auto-remediation completed: {len(repaired_clients)} clients, {len(repaired_pipelines)} pipelines sanitized.")

        return {
            "success": True,
            "message": f"Successfully scrubbed placeholders across {len(repaired_clients)} client(s) and {len(repaired_pipelines)} pipeline(s).",
            "repaired_clients": repaired_clients,
            "repaired_pipelines": repaired_pipelines,
            "active_folder_used": real_folder or "CLEARED_EMPTY",
        }
    except Exception as e:
        logger.error(f"Error during placeholder auto-repair: {e}")
        raise HTTPException(status_code=500, detail=f"Auto-repair failed: {str(e)}")
