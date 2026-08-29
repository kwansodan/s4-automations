"""Client Organization Management, Ingestion Setup & Strategy Execution Endpoints."""

from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, UploadFile, File, Form
from sqlmodel import Session, select
from pydantic import BaseModel, Field

from app.db.session import get_db_session
from app.models.db_models import ClientOrganization, StagedTransaction
from app.strategies.factory import StrategyFactory
from app.strategies.base import SourceDocument, SourceType
from app.services.onedrive_service import OneDriveService
from app.services.google_drive_service import GoogleDriveService
from app.services.email_source_service import EmailSourceService
from app.services.audit_service import AuditService
from app.utils.logging import get_logger

logger = get_logger("api.clients")
router = APIRouter(prefix="/clients", tags=["Clients & Workspaces"])


class ClientCreatePayload(BaseModel):
    name: str = Field(description="Organization name, e.g. Apex Logistics Ghana")
    industry: str = Field(default="Financial & Professional Services")
    icon: str = Field(default="🏢")
    status: str = Field(default="dev", description="live, dev, pending")
    status_text: Optional[str] = None
    description: Optional[str] = None
    source_type: str = Field(default="google_drive", description="google_drive, onedrive, email, bank_feed, manual, webhook")
    source_email: Optional[str] = None
    folder_id: Optional[str] = None
    zoho_org_id: Optional[str] = None
    zoho_contact_id: Optional[str] = None
    source_config: Dict[str, Any] = Field(default_factory=dict)
    custom_config: Dict[str, Any] = Field(default_factory=dict)


class IngestionConfigPayload(BaseModel):
    source_type: str = Field(description="google_drive, onedrive, email, bank_feed, manual, webhook")
    folder_id: Optional[str] = None
    source_email: Optional[str] = None
    source_config: Dict[str, Any] = Field(default_factory=dict)


class RunStrategyPayload(BaseModel):
    month: Optional[str] = None
    year: Optional[int] = None
    auto_post_to_accounting: bool = False


class BatchApprovePayload(BaseModel):
    transaction_ids: List[int] = Field(description="List of StagedTransaction IDs to approve")
    notes: Optional[str] = None


@router.get("", summary="List All Accounting Client Organizations")
async def list_clients(db: Session = Depends(get_db_session)) -> List[Dict[str, Any]]:
    """Returns all registered client organizations and active automation strategies."""
    clients = db.exec(select(ClientOrganization)).all()
    return [c.model_dump() for c in clients]


@router.post("", summary="Register a New Accounting Client")
async def create_client(
    payload: ClientCreatePayload,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Registers a new client organization in PostgreSQL."""
    slug = payload.name.lower().replace(" ", "_").replace("-", "_")
    slug = "".join(c for c in slug if c.isalnum() or c == "_").strip("_")

    existing = db.exec(select(ClientOrganization).where(ClientOrganization.id == slug)).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Client '{slug}' already exists.")

    new_client = ClientOrganization(
        id=slug,
        name=payload.name,
        industry=payload.industry,
        icon=payload.icon,
        status=payload.status,
        status_text=payload.status_text or ("Production Live" if payload.status == "live" else "In Development"),
        description=payload.description,
        source_type=payload.source_type,
        source_email=payload.source_email or f"{slug}@inbound.service4gh.com",
        folder_id=payload.folder_id,
        zoho_org_id=payload.zoho_org_id,
        zoho_contact_id=payload.zoho_contact_id,
        source_config=payload.source_config,
        custom_config=payload.custom_config,
        active_integrations=["Inngest", "Zoho Books", "Gemini Vision"],
        blueprints=[
            {"title": "Source Ingestion", "desc": f"Connect {payload.source_type} data stream", "status": "active"},
            {"title": "AI Schema Extraction", "desc": "Custom Vision OCR / PDF extraction", "status": "in_progress"},
            {"title": "Accounting Ledger Posting", "desc": "Post approved entries to Zoho Books", "status": "queued"},
        ],
    )
    db.add(new_client)
    db.commit()
    db.refresh(new_client)

    AuditService.log(
        client_id=slug,
        action="CLIENT_CREATED",
        details={"name": new_client.name, "source_type": new_client.source_type},
    )

    logger.info(f"Registered new client organization: {new_client.name} (id: {new_client.id})")
    return new_client.model_dump()


@router.get("/{client_id}", summary="Get Specific Client Details")
async def get_client(client_id: str, db: Session = Depends(get_db_session)) -> Dict[str, Any]:
    """Returns details and blueprints for a specific client."""
    client = db.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
    if not client:
        raise HTTPException(status_code=404, detail=f"Client '{client_id}' not found.")
    return client.model_dump()


@router.put("/{client_id}/ingestion", summary="Configure Client Ingestion Method")
async def update_client_ingestion(
    client_id: str,
    payload: IngestionConfigPayload,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Updates client source ingestion method (Google Drive, OneDrive, Email, Webhook)."""
    client = db.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
    if not client:
        raise HTTPException(status_code=404, detail=f"Client '{client_id}' not found.")

    client.source_type = payload.source_type
    if payload.folder_id is not None:
        client.folder_id = payload.folder_id
    if payload.source_email is not None:
        client.source_email = payload.source_email
    if payload.source_config:
        client.source_config = payload.source_config
    client.updated_at = datetime.now(timezone.utc)

    db.add(client)
    db.commit()
    db.refresh(client)

    AuditService.log(
        client_id=client_id,
        action="INGESTION_CONFIG_UPDATED",
        details=payload.model_dump(),
    )

    return {
        "success": True,
        "client_id": client_id,
        "source_type": client.source_type,
        "message": f"Ingestion method updated to '{client.source_type}' for {client.name}.",
    }


@router.post("/{client_id}/ingestion/test", summary="Test Ingestion Connection Probe")
async def test_client_ingestion(
    client_id: str,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Tests the configured ingestion channel (OneDrive Graph API, Google Drive, or Email)."""
    client = db.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
    if not client:
        raise HTTPException(status_code=404, detail=f"Client '{client_id}' not found.")

    source_type = client.source_type or "google_drive"

    if source_type in ["onedrive", "sharepoint"]:
        cfg = client.source_config or {}
        onedrive = OneDriveService(
            tenant_id=cfg.get("tenant_id"),
            client_id=cfg.get("client_id"),
            client_secret=cfg.get("client_secret"),
            drive_id=cfg.get("drive_id"),
        )
        probe = await onedrive.test_connection(cfg.get("folder_path", ""))
        return probe

    elif source_type == "google_drive":
        drive = GoogleDriveService()
        folder_id = client.folder_id or ""
        probe = await drive.test_folder_access(folder_id)
        return {
            "success": probe.get("accessible", True),
            "status": "CONNECTED" if probe.get("accessible", True) else "ACCESS_DENIED",
            "message": f"Google Drive folder access: {folder_id or 'Root'}",
            "details": probe,
        }

    elif source_type in ["email", "email_attachment"]:
        return {
            "success": True,
            "status": "READY",
            "message": f"Inbound email routing active at {client.source_email or 's4bookkeeping@service4gh.com'}",
        }

    return {
        "success": True,
        "status": "READY",
        "message": f"Ingestion channel '{source_type}' is ready for automated processing.",
    }


@router.get("/{client_id}/transactions", summary="List Staged Transactions")
async def list_client_transactions(
    client_id: str,
    status: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db_session),
) -> List[Dict[str, Any]]:
    """Returns staged ledger transactions for review and batch approval."""
    query = select(StagedTransaction).where(StagedTransaction.client_id == client_id)
    if status:
        query = query.where(StagedTransaction.status == status.upper())
    query = query.order_by(StagedTransaction.id.desc()).limit(limit)

    transactions = db.exec(query).all()
    return [t.model_dump() for t in transactions]


@router.post("/{client_id}/transactions/batch-approve", summary="1-Click Batch Approval for CPA")
async def batch_approve_transactions(
    client_id: str,
    payload: BatchApprovePayload,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Approves a batch of staged transactions for Zoho Books export."""
    query = select(StagedTransaction).where(
        StagedTransaction.client_id == client_id,
        StagedTransaction.id.in_(payload.transaction_ids),
    )
    transactions = db.exec(query).all()

    for t in transactions:
        t.approved = True
        t.reviewed = True
        db.add(t)
    db.commit()

    AuditService.log(
        client_id=client_id,
        action="BATCH_TRANSACTIONS_APPROVED",
        details={"approved_count": len(transactions), "transaction_ids": payload.transaction_ids},
    )

    return {
        "success": True,
        "approved_count": len(transactions),
        "message": f"Successfully approved {len(transactions)} transactions for {client_id}.",
    }


@router.post("/{client_id}/run", summary="Trigger Client Automation Strategy")
async def trigger_client_strategy(
    client_id: str,
    payload: Optional[RunStrategyPayload] = None,
) -> Dict[str, Any]:
    """
    Executes the tailored automation strategy for this client (ANR, Polaris, Mr. Osei, or Dynamic Blueprint).
    """
    now = datetime.now()
    month = payload.month or now.strftime("%B") if payload else now.strftime("%B")
    year = payload.year or now.year if payload else now.year
    auto_post = payload.auto_post_to_accounting if payload else False

    strategy = StrategyFactory.get(client_id)
    logger.info(f"Executing strategy {strategy.__class__.__name__} for client: {client_id} ({month} {year})")

    result = await strategy.execute(month=month, year=year, auto_post=auto_post)
    return result.model_dump()
