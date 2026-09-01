"""Bank Transaction Reconciliation & Client Clarification Portal API."""

import secrets
import hashlib
import time
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form, Depends, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.config import settings
from app.db.session import get_engine
from app.models.db_models import BankTransaction, ClientOrganization, AuthOtpRecord
from app.models.schemas import (
    BankTransactionUpdate,
    WatchedAccountsUpdate,
    BankTransactionCategorizeRequest,
    BankTransactionQueryRequest,
    BankTransactionBulkCategorizeRequest,
    BankTransactionBulkQueryRequest,
    ClientExplanationSubmit,
)
from app.services.accounting.factory import AccountingAdapterFactory
from app.services.audit_service import AuditService
from app.services.mailjet_service import MailjetService
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


# -------------------------------------------------------------------------
# Helper Authentication & Magic Link Engine for Client Portal
# -------------------------------------------------------------------------

def generate_portal_token(client_id: str, client_name: str) -> str:
    """Generates a standard 7-day portal session token."""
    timestamp = int(time.time())
    payload = f"{client_id}:{client_name}:{timestamp}"
    signature = hashlib.sha256(f"{payload}:{PORTAL_TOKEN_SECRET}".encode()).hexdigest()[:32]
    return f"{payload}:{signature}"


def generate_magic_link_token(client_id: str, client_name: str, tx_id: Optional[int] = None) -> str:
    """Generates a secure, signed 72-hour magic link token for 1-click email response."""
    timestamp = int(time.time())
    tx_part = str(tx_id) if tx_id is not None else "all"
    payload = f"magic:{client_id}:{client_name}:{tx_part}:{timestamp}"
    signature = hashlib.sha256(f"{payload}:{PORTAL_TOKEN_SECRET}".encode()).hexdigest()[:32]
    return f"{payload}:{signature}"


def validate_magic_link_token(token: str) -> Optional[Dict[str, Any]]:
    """Validates magic token and returns authenticated client session."""
    if not token or not token.startswith("magic:"):
        return None
    parts = token.split(":")
    if len(parts) != 6:
        return None
    _, client_id, client_name, tx_part, timestamp_str, sig = parts
    try:
        timestamp = int(timestamp_str)
    except ValueError:
        return None

    # 72-hour validity
    if time.time() - timestamp > 72 * 3600:
        return None

    expected_payload = f"magic:{client_id}:{client_name}:{tx_part}:{timestamp}"
    expected_sig = hashlib.sha256(f"{expected_payload}:{PORTAL_TOKEN_SECRET}".encode()).hexdigest()[:32]
    if secrets.compare_digest(sig, expected_sig):
        return {
            "client_id": client_id,
            "client_name": client_name,
            "target_tx_id": int(tx_part) if tx_part != "all" and tx_part.isdigit() else None,
        }
    return None


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
        # Check if query parameter token was provided
        query_token = request.query_params.get("token")
        if query_token:
            client = validate_portal_token(query_token)
    if not client:
        raise HTTPException(status_code=401, detail="Invalid or expired client portal session")
    return client


# -------------------------------------------------------------------------
# Client Portal Authentication Endpoints
# -------------------------------------------------------------------------

@router.get("/portal/magic-access", summary="Client Portal: 1-Click Magic Link Authentication")
async def client_portal_magic_access(token: str = Query(..., description="Signed magic access token")) -> Dict[str, Any]:
    """Exchanges a signed magic link from email into a valid portal session."""
    data = validate_magic_link_token(token)
    if not data:
        raise HTTPException(status_code=400, detail="Invalid or expired magic link. Please request an OTP login.")

    session_token = generate_portal_token(data["client_id"], data["client_name"])
    return {
        "success": True,
        "token": session_token,
        "client": {
            "id": data["client_id"],
            "name": data["client_name"],
        },
        "target_tx_id": data.get("target_tx_id"),
    }


@router.post("/portal/auth/request-otp", summary="Client Portal: Request OTP via Email/Identifier")
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


@router.post("/portal/auth/verify-otp", summary="Client Portal: Verify OTP & Login")
async def client_portal_verify_otp(payload: PortalOtpVerify) -> Dict[str, Any]:
    cleaned = payload.identifier.strip().lower()
    cleaned_otp = payload.otp.strip()

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


@router.get("/portal/me", summary="Client Portal: Get Current Client Session")
async def client_portal_me(client: Dict[str, Any] = Depends(get_portal_client)) -> Dict[str, Any]:
    return {"authenticated": True, "client": client}


# -------------------------------------------------------------------------
# Client Portal Transaction Clarification Endpoints
# -------------------------------------------------------------------------

@router.get("/portal/transactions", summary="Client Portal: List Unresolved Transactions")
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


@router.post("/portal/transactions/{tx_id}/explain", summary="Client Portal: Submit Explanation for Transaction")
async def client_portal_explain_transaction(
    tx_id: int,
    payload: ClientExplanationSubmit,
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
        if payload.client_attachments:
            tx.client_attachments = payload.client_attachments
        tx.status = "CLIENT_ANSWERED"
        tx.response_date = datetime.now(timezone.utc)
        tx.updated_at = datetime.now(timezone.utc)
        session.add(tx)
        session.commit()
        session.refresh(tx)

        # Notify Accounting Team (CPA Lead)
        target_email = settings.NOTIFICATION_EMAIL or "cdanso@service4gh.com"
        subject = f"✅ [Client Responded] Explanation provided for GHS {tx.amount:,.2f} ({client['client_name']})"
        html_body = f"""
        <div style="font-family: sans-serif; background: #0b0f19; color: #f8fafc; padding: 20px; border-radius: 10px;">
            <h2 style="color: #10b981; margin-top: 0;">New Explanation Received from {client['client_name']}</h2>
            <p><strong>Transaction:</strong> GHS {tx.amount:,.2f} on {tx.transaction_date} ({tx.description})</p>
            <div style="background: #1e293b; padding: 15px; border-radius: 8px; border-left: 4px solid #10b981;">
                <strong>Client's Explanation:</strong><br/>
                <p style="color: #e2e8f0; font-size: 14px;">{payload.client_explanation}</p>
            </div>
            <p style="margin-top: 20px;">
                <a href="http://localhost:5173" style="background: #0284c7; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                    Open S4 Information Requests &amp; Classify →
                </a>
            </p>
        </div>
        """
        try:
            await MailjetService.send_email(
                to_email=target_email,
                subject=subject,
                html_content=html_body,
                text_content=f"Client {client['client_name']} explained GHS {tx.amount:,.2f}: {payload.client_explanation}",
                recipient_name="Accounting Team",
            )
        except Exception as e:
            logger.warning(f"Could not notify team of client response: {e}")

        AuditService.log(
            client_id=client_id,
            action="CLIENT_EXPLANATION_SUBMITTED",
            details={"transaction_id": tx_id, "amount": tx.amount, "explanation": payload.client_explanation},
        )

        return {"success": True, "transaction": tx.model_dump()}


# -------------------------------------------------------------------------
# Accountant & Internal Banking Management Endpoints
# -------------------------------------------------------------------------

@router.get("/bank/clients/{client_id}/accounts", summary="Accountant: Get Live Chart of Accounts & Watched Status")
async def accountant_get_chart_of_accounts(client_id: str) -> Dict[str, Any]:
    """Returns the Chart of Accounts with watched status flags for this client."""
    with Session(get_engine()) as session:
        client = session.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
        if not client:
            raise HTTPException(status_code=404, detail="Client organisation not found.")

        watched = client.watched_accounts or ["6990", "850", "suspense", "uncategorized"]
        adapter = AccountingAdapterFactory.get(client.accounting_software, client.id)
        accounts = await adapter.fetch_chart_of_accounts()

        # Mark watched flags
        for acc in accounts:
            code = acc.get("account_code") or acc.get("account_id")
            name = acc.get("account_name", "").lower()
            acc["is_watched"] = code in watched or any(w.lower() in name for w in watched)

        return {
            "client_id": client_id,
            "accounting_software": client.accounting_software,
            "watched_accounts": watched,
            "accounts": accounts,
            "accounts_count": len(accounts),
        }


@router.put("/bank/clients/{client_id}/watched-accounts", summary="Accountant: Update Watched Accounts")
async def accountant_update_watched_accounts(client_id: str, payload: WatchedAccountsUpdate) -> Dict[str, Any]:
    """Updates the list of Chart of Accounts IDs monitored for uncategorized transactions."""
    with Session(get_engine()) as session:
        client = session.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
        if not client:
            raise HTTPException(status_code=404, detail="Client organisation not found.")

        client.watched_accounts = payload.watched_accounts
        client.updated_at = datetime.now(timezone.utc)
        session.add(client)
        session.commit()
        session.refresh(client)

        AuditService.log(
            client_id=client_id,
            action="WATCHED_ACCOUNTS_UPDATED",
            details={"watched_accounts": payload.watched_accounts},
        )

        return {
            "success": True,
            "client_id": client_id,
            "watched_accounts": client.watched_accounts,
            "message": f"Updated {len(payload.watched_accounts)} watched Chart of Accounts for {client.name}.",
        }


@router.get("/bank/clients/{client_id}/transactions", summary="Accountant: List & Filter Bank Transactions")
async def accountant_list_bank_transactions(
    client_id: str,
    status: Optional[str] = Query("ALL", description="ALL, UNMAPPED, CLARIFICATION_REQUESTED, CLIENT_ANSWERED, MAPPED"),
    search: Optional[str] = Query(None, description="Search description, payee, or amount"),
) -> Dict[str, Any]:
    """Returns bank transactions with summary metrics for the Information Requests dashboard."""
    with Session(get_engine()) as session:
        query = select(BankTransaction).where(BankTransaction.client_id == client_id)

        all_txs = session.exec(query.order_by(BankTransaction.transaction_date.desc())).all()

        # Seed mock bank transactions if empty for demo/dev clients
        if not all_txs and (client_id.startswith("mock_") or client_id in ["anr_group", "polaris_ghana", "mr_osei_trading"]):
            now_str = datetime.now().strftime("%Y-%m")
            seed_items = [
                BankTransaction(
                    client_id=client_id,
                    transaction_date=f"{now_str}-28",
                    description="MOMO CASH OUT 0244910291 - AGENT FEE & AIRTIME",
                    amount=450.0,
                    transaction_type="DEBIT",
                    bank_account_name="Ecobank Ghana GHS Operating",
                    status="UNMAPPED",
                    ai_suggested_account="Internet & Communication (MoMo/Data)",
                    category_confidence=0.92,
                ),
                BankTransaction(
                    client_id=client_id,
                    transaction_date=f"{now_str}-27",
                    description="TOTAL ENERGIES ACCRA CENTRAL - FUEL BULK PURCHASE",
                    amount=1850.0,
                    transaction_type="DEBIT",
                    bank_account_name="Stanbic Bank Corporate",
                    status="UNMAPPED",
                    ai_suggested_account="Vehicle Fuel & Transport",
                    category_confidence=0.95,
                ),
                BankTransaction(
                    client_id=client_id,
                    transaction_date=f"{now_str}-25",
                    description="TRANSFER TO KWAME MENSAH - REFERENCE 492010",
                    amount=14500.0,
                    transaction_type="DEBIT",
                    bank_account_name="Ecobank Ghana GHS Operating",
                    status="CLARIFICATION_REQUESTED",
                    accountant_query="Kwame, what was the business purpose of this GHS 14,500 withdrawal? Please attach invoice.",
                    query_date=datetime.now(timezone.utc) - timedelta(days=1),
                    ai_suggested_account="Director's Loan Account",
                    category_confidence=0.65,
                ),
                BankTransaction(
                    client_id=client_id,
                    transaction_date=f"{now_str}-22",
                    description="DIRECT CREDIT VODAFONE GHANA FIBRE BROADBAND",
                    amount=820.0,
                    transaction_type="DEBIT",
                    bank_account_name="Ecobank Ghana GHS Operating",
                    status="CLIENT_ANSWERED",
                    accountant_query="Is this for the main office or warehouse connection?",
                    client_explanation="This is for the annual warehouse high-speed fibre connection.",
                    response_date=datetime.now(timezone.utc) - timedelta(hours=3),
                    ai_suggested_account="Internet & Communication (MoMo/Data)",
                    category_confidence=0.94,
                ),
                BankTransaction(
                    client_id=client_id,
                    transaction_date=f"{now_str}-15",
                    description="OFFICE RENT LEASE ADVANCE - ACCRA PROPERTIES",
                    amount=25000.0,
                    transaction_type="DEBIT",
                    bank_account_name="Stanbic Bank Corporate",
                    status="MAPPED",
                    mapped_account_id="acc_5300",
                    mapped_account_name="Rent & Utilities",
                    payee_name="Accra Properties Ltd",
                    tax_rate="Standard VAT (15%)",
                ),
            ]
            for s in seed_items:
                session.add(s)
            session.commit()
            all_txs = session.exec(query.order_by(BankTransaction.transaction_date.desc())).all()

        # Compute summary metrics
        total_count = len(all_txs)
        total_uncategorized = sum(1 for t in all_txs if t.status == "UNMAPPED")
        total_pending_client = sum(1 for t in all_txs if t.status == "CLARIFICATION_REQUESTED")
        total_client_answered = sum(1 for t in all_txs if t.status == "CLIENT_ANSWERED")
        total_mapped = sum(1 for t in all_txs if t.status in ["MAPPED", "POSTED"])

        # Filter items
        filtered = all_txs
        if status and status != "ALL":
            filtered = [t for t in filtered if t.status == status]

        if search:
            s_low = search.lower().strip()
            filtered = [
                t for t in filtered
                if s_low in t.description.lower()
                or (t.payee_name and s_low in t.payee_name.lower())
                or (t.mapped_account_name and s_low in t.mapped_account_name.lower())
                or (t.client_explanation and s_low in t.client_explanation.lower())
                or s_low in str(t.amount)
            ]

        return {
            "client_id": client_id,
            "metrics": {
                "total_count": total_count,
                "total_uncategorized": total_uncategorized,
                "total_pending_client": total_pending_client,
                "total_client_answered": total_client_answered,
                "total_mapped": total_mapped,
            },
            "transactions": [t.model_dump() for t in filtered],
        }


@router.post("/bank/transactions/{tx_id}/categorize", summary="Accountant: Classify & Categorize Bank Transaction")
async def accountant_categorize_bank_transaction(tx_id: int, payload: BankTransactionCategorizeRequest) -> Dict[str, Any]:
    """Assigns Chart of Accounts category and syncs to accounting platform."""
    with Session(get_engine()) as session:
        tx = session.exec(select(BankTransaction).where(BankTransaction.id == tx_id)).first()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found.")

        client = session.exec(select(ClientOrganization).where(ClientOrganization.id == tx.client_id)).first()

        tx.mapped_account_id = payload.mapped_account_id
        tx.mapped_account_name = payload.mapped_account_name or payload.mapped_account_id
        if payload.payee_name:
            tx.payee_name = payload.payee_name
        if payload.tax_rate:
            tx.tax_rate = payload.tax_rate

        tx.status = "MAPPED"
        tx.updated_at = datetime.now(timezone.utc)
        session.add(tx)
        session.commit()
        session.refresh(tx)

        # Sync to accounting software
        if payload.post_to_accounting and client:
            adapter = AccountingAdapterFactory.get(client.accounting_software, client.id)
            await adapter.categorize_bank_transaction(
                transaction_id=str(tx.id),
                account_id=payload.mapped_account_id,
                payee_name=payload.payee_name,
                tax_rate=payload.tax_rate,
            )

        AuditService.log(
            client_id=tx.client_id,
            action="BANK_TRANSACTION_CATEGORIZED",
            details={
                "transaction_id": tx.id,
                "account_id": payload.mapped_account_id,
                "account_name": tx.mapped_account_name,
                "amount": tx.amount,
            },
        )

        return {
            "success": True,
            "transaction": tx.model_dump(),
            "message": f"Categorized transaction {tx.id} to '{tx.mapped_account_name}'.",
        }


@router.post("/bank/transactions/{tx_id}/query", summary="Accountant: Draw Client Attention (Send Query)")
async def accountant_query_transaction(tx_id: int, payload: BankTransactionQueryRequest) -> Dict[str, Any]:
    """Draws client attention, sets status to CLARIFICATION_REQUESTED, and dispatches Magic Link notification."""
    with Session(get_engine()) as session:
        tx = session.exec(select(BankTransaction).where(BankTransaction.id == tx_id)).first()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found.")

        client = session.exec(select(ClientOrganization).where(ClientOrganization.id == tx.client_id)).first()
        client_name = client.name if client else tx.client_id

        tx.accountant_query = payload.query_text
        tx.status = "CLARIFICATION_REQUESTED"
        tx.query_date = datetime.now(timezone.utc)
        tx.updated_at = datetime.now(timezone.utc)
        session.add(tx)
        session.commit()
        session.refresh(tx)

        # Generate Magic Link for 1-click response
        magic_token = generate_magic_link_token(tx.client_id, client_name, tx.id)
        magic_url = f"http://localhost:5173/?portal_magic={magic_token}"

        # Target recipient
        target_email = payload.recipient_email
        if not target_email and client and client.team_members:
            for tm in client.team_members:
                if tm.get("role") in ["CFO", "Financial_Controller", "Operations_Lead"] and tm.get("email"):
                    target_email = tm.get("email")
                    break

        target_email = target_email or settings.NOTIFICATION_EMAIL or "cdanso@service4gh.com"

        if payload.send_immediately:
            subject = f"❓ [Action Required] Clarification requested for GHS {tx.amount:,.2f} ({client_name})"
            html_content = f"""
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0f19; color: #f8fafc; padding: 24px; border-radius: 12px; max-width: 600px;">
                <h2 style="color: #38bdf8; margin-top: 0;">Clarification Needed on Bank Transaction</h2>
                <p>Hello from your accounting team for <strong>{client_name}</strong>,</p>
                <div style="background: #1e293b; padding: 16px; border-radius: 8px; margin: 16px 0;">
                    <div style="font-size: 13px; color: #94a3b8;">Transaction Details:</div>
                    <div style="font-size: 18px; font-weight: bold; color: #ffffff; margin-top: 4px;">GHS {tx.amount:,.2f} ({tx.transaction_type})</div>
                    <div style="font-size: 12px; color: #cbd5e1; font-family: monospace; margin-top: 4px;">Date: {tx.transaction_date} • Ref: {tx.description}</div>
                </div>
                <div style="background: rgba(56, 189, 248, 0.1); border-left: 4px solid #38bdf8; padding: 14px; border-radius: 6px; margin-bottom: 20px;">
                    <strong style="color: #38bdf8; font-size: 12px; text-transform: uppercase;">Question from Accountant:</strong>
                    <p style="color: #ffffff; font-size: 14px; margin: 6px 0 0 0;">"{payload.query_text}"</p>
                </div>
                <div style="text-align: center; margin: 24px 0;">
                    <a href="{magic_url}" style="background: linear-gradient(135deg, #0284c7 0%, #4f46e5 100%); color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block;">
                        Review &amp; Provide Explanation →
                    </a>
                </div>
                <p style="font-size: 11px; color: #64748b; text-align: center;">No password required • Secure 72-hour one-click access</p>
            </div>
            """
            try:
                await MailjetService.send_email(
                    to_email=target_email,
                    subject=subject,
                    html_content=html_content,
                    text_content=f"Clarification needed for {client_name} - GHS {tx.amount:,.2f}: {payload.query_text}\nLink: {magic_url}",
                    recipient_name=client_name,
                )
                logger.info(f"✅ Dispatched query alert for tx {tx_id} to {target_email}")
            except Exception as e:
                logger.warning(f"Could not dispatch query email: {e}")

        AuditService.log(
            client_id=tx.client_id,
            action="BANK_TRANSACTION_QUERIED",
            details={"transaction_id": tx_id, "query_text": payload.query_text, "recipient_email": target_email},
        )

        return {
            "success": True,
            "transaction": tx.model_dump(),
            "magic_url": magic_url,
            "recipient_email": target_email,
            "message": f"Query dispatched to {target_email}.",
        }


@router.post("/bank/transactions/bulk-categorize", summary="Accountant: Bulk Categorize Multiple Transactions")
async def accountant_bulk_categorize(payload: BankTransactionBulkCategorizeRequest) -> Dict[str, Any]:
    """Applies the same Chart of Accounts category to a list of selected transactions."""
    with Session(get_engine()) as session:
        txs = session.exec(select(BankTransaction).where(BankTransaction.id.in_(payload.transaction_ids))).all()
        for t in txs:
            t.mapped_account_id = payload.mapped_account_id
            t.mapped_account_name = payload.mapped_account_name or payload.mapped_account_id
            if payload.payee_name:
                t.payee_name = payload.payee_name
            if payload.tax_rate:
                t.tax_rate = payload.tax_rate
            t.status = "MAPPED"
            t.updated_at = datetime.now(timezone.utc)
            session.add(t)
        session.commit()

        return {
            "success": True,
            "categorized_count": len(txs),
            "mapped_account_name": payload.mapped_account_name or payload.mapped_account_id,
            "message": f"Successfully categorized {len(txs)} transactions.",
        }


@router.post("/bank/transactions/bulk-query", summary="Accountant: Bulk Query Client on Multiple Transactions")
async def accountant_bulk_query(payload: BankTransactionBulkQueryRequest) -> Dict[str, Any]:
    """Dispatches a consolidated digest email for multiple selected transactions."""
    with Session(get_engine()) as session:
        txs = session.exec(select(BankTransaction).where(BankTransaction.id.in_(payload.transaction_ids))).all()
        if not txs:
            raise HTTPException(status_code=404, detail="No matching transactions found.")

        client_id = txs[0].client_id
        client = session.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
        client_name = client.name if client else client_id

        for t in txs:
            t.accountant_query = payload.query_text
            t.status = "CLARIFICATION_REQUESTED"
            t.query_date = datetime.now(timezone.utc)
            t.updated_at = datetime.now(timezone.utc)
            session.add(t)
        session.commit()

        magic_token = generate_magic_link_token(client_id, client_name, None)
        magic_url = f"http://localhost:5173/?portal_magic={magic_token}"

        target_email = payload.recipient_email or settings.NOTIFICATION_EMAIL or "cdanso@service4gh.com"
        subject = f"❓ [Action Required] Clarification requested on {len(txs)} bank transactions ({client_name})"
        
        items_html = "".join(
            f"<li><strong>GHS {t.amount:,.2f}</strong> ({t.transaction_date}) - <code>{t.description}</code></li>"
            for t in txs[:10]
        )

        html_content = f"""
        <div style="font-family: sans-serif; background: #0b0f19; color: #f8fafc; padding: 24px; border-radius: 12px;">
            <h2 style="color: #38bdf8;">Clarification Needed on {len(txs)} Bank Transactions</h2>
            <p>Your accounting team has requested information on the following items for <strong>{client_name}</strong>:</p>
            <div style="background: rgba(56, 189, 248, 0.1); border-left: 4px solid #38bdf8; padding: 12px; margin: 16px 0;">
                <p style="margin: 0; color: #ffffff;">"{payload.query_text}"</p>
            </div>
            <ul style="color: #cbd5e1; font-size: 13px;">
                {items_html}
            </ul>
            <div style="text-align: center; margin-top: 24px;">
                <a href="{magic_url}" style="background: #0284c7; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                    Open Portal &amp; Provide Notes →
                </a>
            </div>
        </div>
        """
        try:
            await MailjetService.send_email(
                to_email=target_email,
                subject=subject,
                html_content=html_content,
                text_content=f"Clarification needed on {len(txs)} transactions: {payload.query_text}\nLink: {magic_url}",
                recipient_name=client_name,
            )
        except Exception as e:
            logger.warning(f"Could not dispatch bulk query email: {e}")

        return {
            "success": True,
            "queried_count": len(txs),
            "recipient_email": target_email,
            "magic_url": magic_url,
            "message": f"Dispatched consolidated query digest with {len(txs)} transactions to {target_email}.",
        }


@router.post("/bank/clients/{client_id}/sync-accounting", summary="Accountant: Sync Uncategorized Bank Feeds from Accounting Platform")
async def accountant_sync_bank_feeds(client_id: str) -> Dict[str, Any]:
    """Pulls uncategorized transactions from connected accounting platform into the Information Requests queue."""
    with Session(get_engine()) as session:
        client = session.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
        if not client:
            raise HTTPException(status_code=404, detail="Client organisation not found.")

        adapter = AccountingAdapterFactory.get(client.accounting_software, client.id)
        feeds = await adapter.fetch_uncategorized_bank_transactions(client.watched_accounts)

        synced_count = 0
        for f in feeds:
            # Checksum idempotency
            checksum_str = f"{client_id}:{f.get('transaction_date')}:{f.get('amount')}:{f.get('description')}"
            c_hash = hashlib.sha256(checksum_str.encode()).hexdigest()[:16]
            existing = session.exec(select(BankTransaction).where(BankTransaction.checksum == c_hash)).first()
            if not existing:
                new_tx = BankTransaction(
                    client_id=client_id,
                    transaction_date=f.get("transaction_date", datetime.now().strftime("%Y-%m-%d")),
                    description=f.get("description", "Direct Bank Feed Line"),
                    amount=float(f.get("amount", 0.0)),
                    transaction_type=f.get("transaction_type", "DEBIT"),
                    bank_account_name=f.get("bank_account_name", "Main Operating Account"),
                    source_file_name=f.get("source_file_name", "Live Bank Feed"),
                    checksum=c_hash,
                    status="UNMAPPED",
                    ai_suggested_account=f.get("ai_suggested_account"),
                    category_confidence=float(f.get("category_confidence", 0.85)),
                )
                session.add(new_tx)
                synced_count += 1

        session.commit()

        return {
            "success": True,
            "client_id": client_id,
            "synced_new_count": synced_count,
            "message": f"Synced {synced_count} new bank transactions into Information Requests queue.",
        }


@router.post("/bank/upload", summary="Accountant: Ingest Bank Statement (CSV / PDF)")
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
