"""Client Organization Management & Strategy Execution Endpoints."""

from typing import List, Dict, Any, Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from sqlmodel import Session, select
from pydantic import BaseModel, Field

from app.db.session import get_db_session
from app.models.db_models import ClientOrganization
from app.strategies.factory import StrategyFactory
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
    source_type: str = Field(default="google_drive", description="google_drive, email, bank_feed, manual")
    source_email: Optional[str] = None
    folder_id: Optional[str] = None
    zoho_org_id: Optional[str] = None


class RunStrategyPayload(BaseModel):
    month: Optional[str] = None
    year: Optional[int] = None
    auto_post_to_accounting: bool = False


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
        source_email=payload.source_email,
        folder_id=payload.folder_id,
        zoho_org_id=payload.zoho_org_id,
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
    logger.info(f"Registered new client organization: {new_client.name} (id: {new_client.id})")
    return new_client.model_dump()


@router.get("/{client_id}", summary="Get Specific Client Details")
async def get_client(client_id: str, db: Session = Depends(get_db_session)) -> Dict[str, Any]:
    """Returns details and blueprints for a specific client."""
    client = db.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
    if not client:
        raise HTTPException(status_code=404, detail=f"Client '{client_id}' not found.")
    return client.model_dump()


@router.post("/{client_id}/run", summary="Trigger Client Automation Strategy")
async def trigger_client_strategy(
    client_id: str,
    payload: Optional[RunStrategyPayload] = None,
    background_tasks: BackgroundTasks = None,
) -> Dict[str, Any]:
    """
    Executes the tailored automation strategy for this client (ANR, Polaris, Mr. Osei, or custom).
    """
    now = datetime.now()
    month = payload.month or now.strftime("%B") if payload else now.strftime("%B")
    year = payload.year or now.year if payload else now.year
    auto_post = payload.auto_post_to_accounting if payload else False

    strategy = StrategyFactory.get(client_id)
    logger.info(f"Executing strategy {strategy.__class__.__name__} for client: {client_id} ({month} {year})")

    result = await strategy.execute(month=month, year=year, auto_post=auto_post)
    return result.model_dump()
