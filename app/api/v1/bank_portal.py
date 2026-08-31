"""Bank Transaction Reconciliation & Client Clarification Portal API."""

import secrets
import hashlib
import time
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form, Depends
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.config import settings
from app.db.session import get_engine
from app.models.db_models import BankTransaction, ClientOrganization, AuthOtpRecord
from app.models.schemas import BankTransactionUpdate
from app.services.auth_service import AuthService
from app.workflows.bank_statement_pipeline import run_bank_pipeline_core
from app.utils.logging import get_logger

logger = get_logger("bank_portal_api")
router = APIRouter(tags=["Bank Reconciliation & Portal"])

PORTAL_TOKEN_SECRET = settings.AUTH_SECRET_KEY + "_portal"


# -------------------------------------------------------------------------
# Portal Models
# -------------------------------------------------------------------------

class PortalOtpRequest(BaseModel):
    identifier: str = Field(description="Client organization slug, email, or phone number")


class PortalOtpVerify(BaseModel):
    identifier: str = Field(description="Client organization slug, email, or phone number")
    otp: str = Field(description="6-digit verification code")


class AccountantQueryRequest(BaseModel):
    query_text: str = Field(description="Accountant question or clarification request for client")


class MapTransactionRequest(BaseModel):
    mapped_account_id: str = Field(description="Zoho Account ID / Expense Account")


# -------------------------------------------------------------------------
# Helper Authentication for Client Portal
# -------------------------------------------------------------------------

def generate_portal_token(client_id: str, client_name: str) -> str:
    timestamp = int(time.time())
    payload = f"{client_id}:{client_name}:{timestamp}"
    signature = hashlib.sha256(f"{payload}:{PORTAL_TOKEN_SECRET}".encode()).hexdigest()[:32]
    return f"{payload}:{signature}"


def validate_portal_token(token: str) -> Optional[Dict[str, Any]]:
    if not token or ":" not in token:
        return None
    parts = token.split(":")
    if len(parts) != 4:
        return None
    client_id, client_name, timestamp_str, sig = parts
    try:
        timestamp = int(timestamp_str)
    except ValueError:
        return None
    
    # 7-day portal session
    if time.time() - timestamp > 7 * 86400:
        return None

    expected_sig = hashlib.sha256(f"{client_id}:{client_name}:{timestamp}:{PORTAL_TOKEN_SECRET}".encode()).hexdigest()[:32]
    if secrets.compare_digest(sig, expected_sig):
        return {"client_id": client_id, "client_name": client_name}
    return None


async def get_portal_client(request: Request) -> Dict[str, Any]:
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "").strip() if auth_header.startswith("Bearer ") else ""
    client = validate_portal_token(token)
    if not client:
        raise HTTPException(status_code=401, detail="Invalid or expired client portal session")
    return client


# -------------------------------------------------------------------------
# Client Portal Authentication Endpoints
# -------------------------------------------------------------------------

@router.post("/v1/portal/auth/request-otp", summary="Client Portal: Request OTP via Email/Identifier")
async def client_portal_request_otp(payload: PortalOtpRequest) -> Dict[str, Any]:
    cleaned = payload.identifier.strip().lower()
    
    # Find client by id, name, or source_email
    client_org = None
    with Session(get_engine()) as session:
        clients = session.exec(select(ClientOrganization)).all()
        for c in clients:
            if (
                c.id.lower() == cleaned
                or c.name.lower() == cleaned
                or (c.source_email and c.source_email.lower() == cleaned)
            ):
                client_org = c
                break
    
    if not client_org:
        # If running in mock/dev mode, create a temporary mock client context if identifier looks plausible
        if settings.MOCK_MODE:
            client_org = ClientOrganization(id=cleaned or "demo_client", name=payload.identifier or "Demo Client", industry="General")
        else:
            raise HTTPException(status_code=404, detail="Client organization not found for this identifier.")

    # Generate 6-digit OTP
    otp = f"{secrets.randbelow(900000) + 100000}"
    salt = secrets.token_hex(8)
    otp_hash = hashlib.sha256(f"{salt}:{otp}:{PORTAL_TOKEN_SECRET}".encode()).hexdigest()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)

    otp_key = f"portal:{client_org.id}"
    try:
        with Session(get_engine()) as session:
            existing = session.exec(select(AuthOtpRecord).where(AuthOtpRecord.email == otp_key)).all()
            for old in existing:
                session.delete(old)
            
            record = AuthOtpRecord(
                email=otp_key,
                otp_hash=otp_hash,
                salt=salt,
                expires_at=expires_at,
                is_verified=False,
                attempts=0,
            )
            session.add(record)
            session.commit()
    except Exception as e:
        logger.error(f"Error saving portal OTP: {e}")

    logger.info(f"🔑 [PORTAL OTP] Client '{client_org.name}' ({client_org.id}) OTP: {otp}")

    return {
        "success": True,
        "message": f"Verification OTP generated for {client_org.name}.",
        "client_id": client_org.id,
        "client_name": client_org.name,
        "expires_in_seconds": 900,
        "dev_hint": f"OTP Code: {otp}",
    }


@router.post("/v1/portal/auth/verify-otp", summary="Client Portal: Verify OTP & Login")
async def client_portal_verify_otp(payload: PortalOtpVerify) -> Dict[str, Any]:
    cleaned = payload.identifier.strip().lower()
    cleaned_otp = payload.otp.strip()

    # Find client org
    client_org = None
    with Session(get_engine()) as session:
        clients = session.exec(select(ClientOrganization)).all()
        for c in clients:
            if (
                c.id.lower() == cleaned
                or c.name.lower() == cleaned
                or (c.source_email and c.source_email.lower() == cleaned)
            ):
                client_org = c
                break
        
        if not client_org and settings.MOCK_MODE:
            client_org = ClientOrganization(id=cleaned, name=cleaned.title(), industry="General")

        if not client_org:
            raise HTTPException(status_code=404, detail="Client organization not found.")

        otp_key = f"portal:{client_org.id}"
        record = session.exec(
            select(AuthOtpRecord)
            .where(AuthOtpRecord.email == otp_key)
            .where(AuthOtpRecord.is_verified == False)
        ).first()

        if not record:
            # Fallback for dev mode
            if settings.MOCK_MODE and len(cleaned_otp) == 6:
                token = generate_portal_token(client_org.id, client_org.name)
                return {"success": True, "token": token, "client": {"id": client_org.id, "name": client_org.name}}
            raise HTTPException(status_code=400, detail="No active OTP found. Please request a new code.")

        if record.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
            session.delete(record)
            session.commit()
            raise HTTPException(status_code=400, detail="OTP expired. Please request a new code.")

        expected_hash = hashlib.sha256(f"{record.salt}:{cleaned_otp}:{PORTAL_TOKEN_SECRET}".encode()).hexdigest()
        if not secrets.compare_digest(record.otp_hash, expected_hash):
            record.attempts += 1
            session.add(record)
            session.commit()
            raise HTTPException(status_code=400, detail="Incorrect OTP code.")

        client_id_val = client_org.id
        client_name_val = client_org.name
        client_industry_val = client_org.industry

        record.is_verified = True
        session.add(record)
        session.commit()

    token = generate_portal_token(client_id_val, client_name_val)
    return {
        "success": True,
        "token": token,
        "client": {
            "id": client_id_val,
            "name": client_name_val,
            "industry": client_industry_val,
        }
    }



@router.get("/v1/portal/me", summary="Client Portal: Get Current Client Session")
async def client_portal_me(client: Dict[str, Any] = Depends(get_portal_client)) -> Dict[str, Any]:
    return {"authenticated": True, "client": client}


# -------------------------------------------------------------------------
# Client Portal Transaction Clarification Endpoints
# -------------------------------------------------------------------------

@router.get("/v1/portal/transactions", summary="Client Portal: List Unresolved Transactions")
async def client_portal_list_transactions(client: Dict[str, Any] = Depends(get_portal_client)) -> List[Dict[str, Any]]:
    client_id = client["client_id"]
    with Session(get_engine()) as session:
        txs = session.exec(
            select(BankTransaction)
            .where(BankTransaction.client_id == client_id)
            .where(BankTransaction.status.in_(["UNMAPPED", "CLARIFICATION_REQUESTED", "CLIENT_ANSWERED"]))
            .order_by(BankTransaction.transaction_date.desc())
        ).all()
        return [tx.model_dump() for tx in txs]


@router.post("/v1/portal/transactions/{tx_id}/explain", summary="Client Portal: Submit Explanation for Transaction")
async def client_portal_explain_transaction(
    tx_id: int,
    payload: BankTransactionUpdate,
    client: Dict[str, Any] = Depends(get_portal_client),
) -> Dict[str, Any]:
    client_id = client["client_id"]
    with Session(get_engine()) as session:
        tx = session.exec(
            select(BankTransaction)
            .where(BankTransaction.id == tx_id)
            .where(BankTransaction.client_id == client_id)
        ).first()

        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found.")

        tx.client_explanation = payload.client_explanation
        tx.status = "CLIENT_ANSWERED"
        tx.updated_at = datetime.now(timezone.utc)
        session.add(tx)
        session.commit()
        session.refresh(tx)
        return {"success": True, "transaction": tx.model_dump()}


# -------------------------------------------------------------------------
# Accountant / Internal Endpoints
# -------------------------------------------------------------------------

@router.get("/v1/bank/clients/{client_id}/transactions", summary="Accountant: List Client Bank Transactions")
async def accountant_list_bank_transactions(client_id: str) -> List[Dict[str, Any]]:
    with Session(get_engine()) as session:
        txs = session.exec(
            select(BankTransaction)
            .where(BankTransaction.client_id == client_id)
            .order_by(BankTransaction.transaction_date.desc())
        ).all()
        return [tx.model_dump() for tx in txs]


@router.post("/v1/bank/transactions/{tx_id}/query", summary="Accountant: Add Clarification Query to Transaction")
async def accountant_query_transaction(tx_id: int, payload: AccountantQueryRequest) -> Dict[str, Any]:
    with Session(get_engine()) as session:
        tx = session.exec(select(BankTransaction).where(BankTransaction.id == tx_id)).first()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found.")
        tx.accountant_query = payload.query_text
        tx.status = "CLARIFICATION_REQUESTED"
        tx.updated_at = datetime.now(timezone.utc)
        session.add(tx)
        session.commit()
        session.refresh(tx)
        return {"success": True, "transaction": tx.model_dump()}


@router.post("/v1/bank/transactions/{tx_id}/map", summary="Accountant: Map Transaction to Zoho Account")
async def accountant_map_transaction(tx_id: int, payload: MapTransactionRequest) -> Dict[str, Any]:
    with Session(get_engine()) as session:
        tx = session.exec(select(BankTransaction).where(BankTransaction.id == tx_id)).first()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found.")
        tx.mapped_account_id = payload.mapped_account_id
        tx.status = "MAPPED"
        tx.updated_at = datetime.now(timezone.utc)
        session.add(tx)
        session.commit()
        session.refresh(tx)
        return {"success": True, "transaction": tx.model_dump()}


@router.post("/v1/bank/upload", summary="Accountant: Ingest Bank Statement (CSV / PDF)")
async def accountant_upload_bank_statement(
    client_id: str = Form(...),
    month: str = Form(default=datetime.now().strftime("%B")),
    year: int = Form(default=datetime.now().year),
    file: UploadFile = File(...),
) -> Dict[str, Any]:
    content = await file.read()
    res = await run_bank_pipeline_core(
        target_month=month,
        target_year=year,
        client_id=client_id,
        file_bytes=content,
        file_name=file.filename,
        mime_type=file.content_type,
    )
    return res

