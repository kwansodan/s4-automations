"""Bank Transaction Reconciliation & Client Clarification Portal API."""

import secrets
import hashlib
import time
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form, Depends, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select, or_, and_
from sqlalchemy.orm.attributes import flag_modified

from app.config import settings
from app.db.session import get_engine
from app.models.db_models import BankTransaction, StagedTransaction, ClientOrganization, AuthOtpRecord
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
from app.api.deps import (
    require_admin_user,
    enforce_otp_request_rate_limit,
    enforce_otp_verify_rate_limit,
)
from app.utils.logging import get_logger

logger = get_logger("bank_portal_api")
router = APIRouter(tags=["Bank Reconciliation & Portal"])
bank_accountant_router = APIRouter(
    prefix="/bank",
    tags=["Accountant Bank Management"],
    dependencies=[Depends(require_admin_user)],
)

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


@router.post(
    "/portal/auth/request-otp",
    summary="Client Portal: Request OTP via Email/Identifier",
    dependencies=[Depends(enforce_otp_request_rate_limit)],
)
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
        if settings.ENVIRONMENT.lower() == "development" and settings.MOCK_MODE:
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

    logger.info(f"🔑 [PORTAL OTP] Client '{client_org.name}' ({client_org.id}) OTP generated (Expires in 15 mins)")

    return {
        "success": True,
        "message": f"Verification OTP generated for {client_org.name}.",
        "client_id": client_org.id,
        "client_name": client_org.name,
        "expires_in_seconds": 900,
        "dev_hint": f"OTP Code: {otp}" if (settings.ENVIRONMENT.lower() in ("development", "test") and settings.MOCK_MODE) else None,
    }


@router.post(
    "/portal/auth/verify-otp",
    summary="Client Portal: Verify OTP & Login",
    dependencies=[Depends(enforce_otp_verify_rate_limit)],
)
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
        
        if not client_org and settings.ENVIRONMENT.lower() == "development" and settings.MOCK_MODE:
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
            if settings.ENVIRONMENT.lower() == "development" and settings.MOCK_MODE and len(cleaned_otp) == 6:
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

@router.get("/portal/transactions", summary="Client Portal: List Unresolved Transactions & Requests")
async def client_portal_list_transactions(client: Dict[str, Any] = Depends(get_portal_client)) -> List[Dict[str, Any]]:
    client_id = client["client_id"]
    from app.api.v1.clients import get_client_id_aliases
    from app.workflows.zoho_invoice_generator import extract_slip_customer_name

    aliases = get_client_id_aliases(client_id) or [client_id]
    results: List[Dict[str, Any]] = []

    with Session(get_engine()) as session:
        # 1. Bank Transactions
        txs = session.exec(
            select(BankTransaction)
            .where(BankTransaction.client_id.in_(aliases))
            .where(BankTransaction.status.in_(["UNMAPPED", "CLARIFICATION_REQUESTED", "CLIENT_ANSWERED"]))
            .order_by(BankTransaction.transaction_date.desc())
        ).all()
        for tx in txs:
            d = tx.model_dump()
            d["item_key"] = f"BANK:{tx.id}"
            d["pipeline_type"] = "BANK"
            d["entity_label"] = "Bank Transaction"
            d["party_or_account_name"] = tx.bank_account_name or "Bank Account"
            results.append(d)

        # 2. Staged Transactions (AR Slips, AP Vendor Bills, and General Requests) with active/answered queries
        staged_rows = session.exec(
            select(StagedTransaction)
            .where(StagedTransaction.client_id.in_(aliases))
            .order_by(StagedTransaction.transaction_date.desc(), StagedTransaction.id.desc())
        ).all()

        grouped_staged: Dict[str, List[StagedTransaction]] = {}
        for st in staged_rows:
            meta = st.metadata_json or {}
            q_stat = str(meta.get("query_status") or "").upper()
            q_text = meta.get("accountant_query")
            if q_stat not in ("CLARIFICATION_REQUESTED", "CLIENT_ANSWERED") and not q_text:
                continue
            if q_stat == "RESOLVED":
                continue

            p_type = (st.pipeline_type or "AR").upper()
            batch_key = meta.get("query_batch_id") or (
                f"ar_slip:{st.client_id}:{st.source_file_name}" if p_type == "AR" and st.source_file_name else f"staged:{st.id}"
            )
            grouped_staged.setdefault(batch_key, []).append(st)

        for batch_key, group in grouped_staged.items():
            primary = group[0]
            meta = primary.metadata_json or {}
            p_type = (primary.pipeline_type or "AR").upper()
            q_stat = str(meta.get("query_status") or "CLARIFICATION_REQUESTED").upper()
            total_amt = round(sum(float(g.total_amount or 0.0) for g in group), 2)

            if p_type == "AR":
                entity_label = "Receivable Slip / Invoice"
                party_name = extract_slip_customer_name(primary.source_file_name, meta) or "Customer"
                if len(group) > 1:
                    item_names = ", ".join(str(g.item_or_description or "Item") for g in group[:4])
                    if len(group) > 4:
                        item_names += f" (+{len(group) - 4} more)"
                    desc_text = f"{primary.source_file_name} ({len(group)} items: {item_names})"
                else:
                    desc_text = f"{primary.source_file_name} - {primary.item_or_description}"
                tx_type = "CREDIT"
            elif p_type == "AP":
                entity_label = "Vendor Bill / Expense"
                party_name = str(meta.get("vendor_name") or primary.item_or_description or "Vendor")
                desc_text = f"{primary.source_file_name} - {primary.item_or_description}"
                tx_type = "DEBIT"
            else:
                entity_label = "General Information Request"
                party_name = str(meta.get("category") or "Monthly Close / Document Request")
                desc_text = primary.item_or_description or primary.source_file_name or "Information Request"
                tx_type = "DEBIT"

            results.append({
                "id": primary.id,
                "item_key": f"STAGED:{primary.id}",
                "staged_transaction_ids": [g.id for g in group if g.id is not None],
                "client_id": primary.client_id,
                "pipeline_type": p_type,
                "entity_label": entity_label,
                "party_or_account_name": party_name,
                "source_file_name": primary.source_file_name,
                "transaction_date": primary.transaction_date,
                "description": desc_text,
                "amount": total_amt,
                "transaction_type": tx_type,
                "status": "CLIENT_ANSWERED" if q_stat == "CLIENT_ANSWERED" else "CLARIFICATION_REQUESTED",
                "accountant_query": meta.get("accountant_query"),
                "client_explanation": meta.get("client_explanation"),
                "client_attachments": meta.get("client_attachments", []),
            })

    return results


async def _handle_portal_explanation_submission(
    session: Session,
    client: Dict[str, Any],
    item_key: str,
    payload: ClientExplanationSubmit,
) -> Dict[str, Any]:
    client_id = client["client_id"]
    from app.api.v1.clients import get_client_id_aliases
    aliases = get_client_id_aliases(client_id) or [client_id]
    now_utc = datetime.now(timezone.utc)
    now_iso = now_utc.isoformat()

    key_low = str(item_key).strip().lower()
    is_staged = key_low.startswith("staged:")
    raw_id_str = item_key.split(":", 1)[1] if ":" in item_key else item_key
    try:
        numeric_id = int(raw_id_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid transaction identifier.")

    tx = None
    if not is_staged:
        tx = session.exec(
            select(BankTransaction)
            .where(BankTransaction.id == numeric_id)
            .where(BankTransaction.client_id.in_(aliases))
        ).first()

    if tx:
        tx.client_explanation = payload.client_explanation
        if payload.client_attachments:
            tx.client_attachments = payload.client_attachments
        tx.status = "CLIENT_ANSWERED"
        tx.response_date = now_utc
        tx.updated_at = now_utc

        meta = dict(tx.metadata_json or {})
        history = list(meta.get("query_history") or [])
        history.append({
            "sender": "client",
            "text": payload.client_explanation,
            "timestamp": now_iso,
            "attachments": payload.client_attachments or [],
        })
        meta["query_history"] = history
        meta["query_status"] = "CLIENT_ANSWERED"
        tx.metadata_json = meta
        flag_modified(tx, "metadata_json")

        session.add(tx)
        session.commit()
        session.refresh(tx)

        amt_val = float(tx.amount or 0.0)
        date_val = tx.transaction_date
        desc_val = tx.description
        out_record = tx.model_dump()
        out_record["item_key"] = f"BANK:{tx.id}"
    else:
        # Look up in StagedTransaction (AR, AP, GENERAL)
        st = session.exec(
            select(StagedTransaction)
            .where(StagedTransaction.id == numeric_id)
            .where(StagedTransaction.client_id.in_(aliases))
        ).first()
        if not st:
            raise HTTPException(status_code=404, detail="Transaction or request not found.")

        st_meta = dict(st.metadata_json or {})
        batch_id = st_meta.get("query_batch_id")
        if batch_id:
            all_client_st = session.exec(
                select(StagedTransaction).where(StagedTransaction.client_id.in_(aliases))
            ).all()
            sibling_rows = [
                r for r in all_client_st
                if (r.metadata_json or {}).get("query_batch_id") == batch_id
            ]
        elif (st.pipeline_type or "AR").upper() == "AR" and st.source_file_name:
            sibling_rows = session.exec(
                select(StagedTransaction)
                .where(StagedTransaction.client_id.in_(aliases))
                .where(StagedTransaction.source_file_name == st.source_file_name)
            ).all()
        else:
            sibling_rows = [st]

        if not sibling_rows:
            sibling_rows = [st]

        for row in sibling_rows:
            rmeta = dict(row.metadata_json or {})
            rmeta["client_explanation"] = payload.client_explanation
            if payload.client_attachments is not None:
                rmeta["client_attachments"] = payload.client_attachments
            rmeta["query_status"] = "CLIENT_ANSWERED"
            rmeta["response_date"] = now_iso
            history = list(rmeta.get("query_history") or [])
            history.append({
                "sender": "client",
                "text": payload.client_explanation,
                "timestamp": now_iso,
                "attachments": payload.client_attachments or [],
            })
            rmeta["query_history"] = history
            row.metadata_json = rmeta
            flag_modified(row, "metadata_json")
            session.add(row)

        session.commit()
        session.refresh(st)

        amt_val = round(sum(float(r.total_amount or 0.0) for r in sibling_rows), 2)
        date_val = st.transaction_date
        desc_val = f"{st.source_file_name} ({st.item_or_description})"
        out_record = st.model_dump()
        out_record["item_key"] = f"STAGED:{st.id}"
        out_record["status"] = "CLIENT_ANSWERED"
        out_record["client_explanation"] = payload.client_explanation
        out_record["client_attachments"] = payload.client_attachments or []

    # Notify Accounting Team (CPA Lead)
    target_email = settings.NOTIFICATION_EMAIL or "cdanso@service4gh.com"
    subject = f"✅ [Client Responded] Explanation provided for GHS {amt_val:,.2f} ({client['client_name']})"
    html_body = f"""
    <div style="background-color: #f8fafc; padding: 32px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <div style="background: #ffffff; color: #0f172a; padding: 28px; border-radius: 16px; max-width: 580px; margin: 0 auto; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
            <div style="display: inline-block; padding: 4px 12px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 9999px; color: #059669; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px;">
                ✅ Client Clarification Received
            </div>
            <h2 style="color: #0f172a; margin: 0 0 12px 0; font-size: 20px; font-weight: 700; letter-spacing: -0.01em;">
                New Explanation Received from {client['client_name']}
            </h2>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin: 16px 0; font-size: 13px; color: #334155;">
                <div style="color: #64748b; font-size: 11px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; margin-bottom: 4px;">Transaction / Request</div>
                <span style="font-weight: 700; color: #0f172a; font-family: 'JetBrains Mono', monospace; font-size: 15px;">GHS {amt_val:,.2f}</span> on <span style="color: #475569;">{date_val}</span> &bull; <span style="color: #64748b; font-size: 12px;">{desc_val}</span>
            </div>
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-left: 4px solid #059669; padding: 14px 16px; border-radius: 8px; margin: 16px 0;">
                <div style="font-size: 11px; font-weight: 700; color: #059669; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">Client's Explanation:</div>
                <p style="color: #065f46; font-size: 14px; margin: 0; line-height: 1.5;">{payload.client_explanation}</p>
            </div>
            <div style="margin-top: 24px; text-align: center;">
                <a href="{settings.APP_BASE_URL}/requests" style="display: inline-block; background: #0284c7; color: #ffffff; padding: 11px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 13px; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);">
                    Open Information Requests Control Center &rarr;
                </a>
            </div>
        </div>
    </div>
    """
    try:
        await MailjetService.send_email(
            to_email=target_email,
            subject=subject,
            html_content=html_body,
            text_content=f"Client {client['client_name']} explained GHS {amt_val:,.2f}: {payload.client_explanation}",
            recipient_name="Accounting Team",
        )
    except Exception as e:
        logger.warning(f"Could not notify team of client response: {e}")

    AuditService.log(
        client_id=client_id,
        action="CLIENT_EXPLANATION_SUBMITTED",
        details={"item_key": item_key, "amount": amt_val, "explanation": payload.client_explanation},
    )

    return {"success": True, "transaction": out_record}


@router.post("/portal/transactions/{tx_id}/explain", summary="Client Portal: Submit Explanation for Transaction")
async def client_portal_explain_transaction(
    tx_id: int,
    payload: ClientExplanationSubmit,
    client: Dict[str, Any] = Depends(get_portal_client),
) -> Dict[str, Any]:
    with Session(get_engine()) as session:
        return await _handle_portal_explanation_submission(session, client, str(tx_id), payload)


@router.post("/portal/items/{item_key}/explain", summary="Client Portal: Submit Explanation for Any Pipeline Request")
async def client_portal_explain_item(
    item_key: str,
    payload: ClientExplanationSubmit,
    client: Dict[str, Any] = Depends(get_portal_client),
) -> Dict[str, Any]:
    with Session(get_engine()) as session:
        return await _handle_portal_explanation_submission(session, client, item_key, payload)


# -------------------------------------------------------------------------
# Accountant & Internal Banking Management Endpoints (Requires Admin)
# -------------------------------------------------------------------------

@bank_accountant_router.get("/clients/{client_id}/accounts", summary="Accountant: Get Live Chart of Accounts")
async def accountant_get_chart_of_accounts(client_id: str) -> Dict[str, Any]:
    """Returns the Chart of Accounts for categorizing transactions for this client."""
    with Session(get_engine()) as session:
        client = session.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
        if not client:
            software = "zoho_books"
            if "xero" in client_id.lower() or "polaris" in client_id.lower():
                software = "xero"
            elif "qbo" in client_id.lower() or "quickbooks" in client_id.lower() or "mr_osei" in client_id.lower():
                software = "quickbooks_online"
            client = ClientOrganization(
                id=client_id,
                name=client_id.replace("_", " ").title(),
                accounting_software=software,
                watched_accounts=["6990", "850", "suspense", "uncategorized"],
            )

        watched = client.watched_accounts if (client.watched_accounts and len(client.watched_accounts) > 0) else ["6990", "850", "suspense", "uncategorized"]
        software = client.accounting_software or "zoho_books"
        cfg = client.custom_config or {}

        # Check OAuth status based on software platform
        if software == "zoho_books":
            has_token = bool(cfg.get("zoho_refresh_token") or settings.ZOHO_REFRESH_TOKEN)
        elif software in ["quickbooks_online", "quickbooks"]:
            has_token = bool(cfg.get("quickbooks_refresh_token") or settings.QUICKBOOKS_REFRESH_TOKEN)
        elif software == "xero":
            has_token = bool(cfg.get("xero_refresh_token") or settings.XERO_REFRESH_TOKEN)
        else:
            has_token = True

        has_oauth = bool(has_token or settings.MOCK_MODE)

        if not has_oauth:
            return {
                "client_id": client_id,
                "accounting_software": software,
                "oauth_pending": True,
                "watched_accounts": watched,
                "accounts": [],
                "accounts_count": 0,
                "message": f"OAuth connection pending for {software.replace('_', ' ').title()}. Please connect OAuth in Client Settings to flow live Chart of Accounts.",
            }

        try:
            adapter = AccountingAdapterFactory.get(software, client.id)
            accounts = await adapter.fetch_chart_of_accounts()
        except Exception as err:
            logger.warning(f"Failed to fetch live chart of accounts for client '{client_id}': {err}")
            accounts = []

        if not accounts:
            return {
                "client_id": client_id,
                "accounting_software": software,
                "oauth_pending": True,
                "watched_accounts": watched,
                "accounts": [],
                "accounts_count": 0,
                "message": f"OAuth connection pending or unauthorized for {software.replace('_', ' ').title()}. Please authorize in Client Settings to allow live Chart of Accounts to flow through.",
            }

        for acc in accounts:
            acc["is_watched"] = False

        return {
            "client_id": client_id,
            "accounting_software": software,
            "oauth_pending": False,
            "watched_accounts": [],
            "accounts": accounts,
            "accounts_count": len(accounts),
        }


@bank_accountant_router.get("/clients/{client_id}/bank-accounts", summary="Accountant: Get Live Banking Module Accounts")
async def accountant_get_bank_accounts(client_id: str) -> Dict[str, Any]:
    """Returns active Bank, Credit Card, and Mobile Money accounts from the accounting platform's Banking section."""
    with Session(get_engine()) as session:
        client = session.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
        if not client:
            software = "zoho_books"
            if "xero" in client_id.lower() or "polaris" in client_id.lower():
                software = "xero"
            elif "qbo" in client_id.lower() or "quickbooks" in client_id.lower() or "mr_osei" in client_id.lower():
                software = "quickbooks_online"
            client = ClientOrganization(
                id=client_id,
                name=client_id.replace("_", " ").title(),
                accounting_software=software,
                watched_accounts=[],
            )

        software = client.accounting_software or "zoho_books"
        cfg = client.custom_config or {}

        # Resolve configured watched bank accounts (ignoring legacy GL codes)
        legacy_gl = {"6990", "850", "999", "suspense", "uncategorized", "all"}
        raw_watched = list(client.watched_accounts or [])
        for p in (client.pipelines or []):
            if isinstance(p, dict) and str(p.get("section", "")).upper() == "BANK":
                p_watched = p.get("watched_accounts")
                if isinstance(p_watched, list):
                    raw_watched = p_watched
                    break
        watched_bank_accounts = [
            str(w).strip()
            for w in raw_watched
            if str(w).strip() and str(w).strip().lower() not in legacy_gl
        ]

        if software == "zoho_books":
            has_token = bool(cfg.get("zoho_refresh_token") or settings.ZOHO_REFRESH_TOKEN)
        elif software in ["quickbooks_online", "quickbooks"]:
            has_token = bool(cfg.get("quickbooks_refresh_token") or settings.QUICKBOOKS_REFRESH_TOKEN)
        elif software == "xero":
            has_token = bool(cfg.get("xero_refresh_token") or settings.XERO_REFRESH_TOKEN)
        else:
            has_token = True

        has_oauth = bool(has_token or settings.MOCK_MODE)
        bank_accounts: List[Dict[str, Any]] = []

        if has_oauth:
            try:
                adapter = AccountingAdapterFactory.get(software, client.id)
                bank_accounts = await adapter.fetch_bank_accounts()
            except Exception as err:
                logger.warning(f"Failed to fetch live bank accounts for client '{client_id}': {err}")
                bank_accounts = []

        # Also merge any distinct bank_account_name values already stored in BankTransaction rows for this client
        existing_txs = session.exec(
            select(BankTransaction).where(BankTransaction.client_id == client_id)
        ).all()
        known_names = {str(b.get("account_name", "")).strip().lower() for b in bank_accounts if b.get("account_name")}
        generic_placeholders = {"bank account", "zoho bank feed", "quickbooks bank feed", "xero bank feed", "watched account", ""}
        for tx in existing_txs:
            b_name = (tx.bank_account_name or "").strip()
            if b_name and b_name.lower() not in known_names and b_name.lower() not in generic_placeholders:
                known_names.add(b_name.lower())
                meta = tx.metadata_json or {}
                b_id = (
                    meta.get("zoho_account_id")
                    or meta.get("qbo_account_id")
                    or meta.get("from_account_id")
                    or b_name
                )
                bank_accounts.append({
                    "account_id": str(b_id),
                    "account_name": b_name,
                    "account_type": "bank",
                    "currency": "GHS",
                    "account_number_masked": "",
                    "balance": 0.0,
                    "uncategorized_transactions": 0,
                    "is_active": True,
                })

        return {
            "client_id": client_id,
            "accounting_software": software,
            "oauth_pending": not has_oauth,
            "watched_bank_accounts": watched_bank_accounts,
            "bank_accounts": bank_accounts,
            "bank_accounts_count": len(bank_accounts),
        }


@bank_accountant_router.put("/clients/{client_id}/watched-accounts", summary="Accountant: Update Watched Bank Accounts")
async def accountant_update_watched_accounts(client_id: str, payload: WatchedAccountsUpdate) -> Dict[str, Any]:
    """Updates the list of Bank Accounts monitored for uncategorized transactions."""
    with Session(get_engine()) as session:
        client = session.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
        if not client:
            client = ClientOrganization(
                id=client_id,
                name=client_id.replace("_", " ").title(),
                accounting_software="zoho_books",
                watched_accounts=payload.watched_accounts,
            )
            session.add(client)
            session.commit()
            session.refresh(client)
        else:
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
            "message": f"Updated monitored bank accounts for {client.name}.",
        }


def _matches_month_and_year(date_str: str, target_month: Optional[str], target_year: Optional[Any]) -> bool:
    """Matches a date string (YYYY-MM-DD or DD/MM/YYYY) against optional target_month and target_year."""
    if not date_str:
        return False

    clean_date = date_str.strip().replace("/", "-")
    parts = clean_date.split("-")
    if len(parts) < 2:
        has_month_filter = bool(target_month and str(target_month).upper() != "ALL")
        has_year_filter = bool(target_year is not None and str(target_year).upper() != "ALL")
        return not (has_month_filter or has_year_filter)

    # Identify tx_year and tx_month
    if len(parts[0]) == 4 and parts[0].isdigit():
        tx_year = int(parts[0])
        tx_month = int(parts[1]) if parts[1].isdigit() else None
    elif len(parts) >= 3 and len(parts[2]) >= 4 and parts[2][:4].isdigit():
        tx_year = int(parts[2][:4])
        tx_month = int(parts[1]) if parts[1].isdigit() else None
    else:
        tx_year = None
        tx_month = int(parts[1]) if parts[1].isdigit() else None

    # Parse and check year filter
    if target_year is not None and str(target_year).upper() != "ALL":
        try:
            expected_y = int(str(target_year).strip())
            if tx_year is None or tx_year != expected_y:
                return False
        except ValueError:
            pass

    # Check month filter
    if not target_month or target_month.upper() == "ALL":
        return True

    target_m_num = None
    t_m_clean = target_month.strip()
    if "-" in t_m_clean:
        sub_parts = t_m_clean.split("-")
        if len(sub_parts) >= 2:
            try:
                y_from_str = int(sub_parts[0])
                if tx_year is None or tx_year != y_from_str:
                    return False
                target_m_num = int(sub_parts[1])
            except ValueError:
                pass
    elif t_m_clean.isdigit():
        target_m_num = int(t_m_clean)
    else:
        for fmt in ("%B", "%b"):
            try:
                target_m_num = datetime.strptime(t_m_clean, fmt).month
                break
            except ValueError:
                continue

    if target_m_num is not None:
        return tx_month == target_m_num if tx_month is not None else False

    return False


def _extract_year_month(date_str: Optional[str]) -> Optional[str]:
    """Extracts a normalized 'YYYY-MM' period from a date string."""
    if not date_str:
        return None
    clean = date_str.strip().replace("/", "-")
    parts = clean.split("-")
    if len(parts) >= 2:
        if len(parts[0]) == 4 and parts[0].isdigit() and parts[1].isdigit():
            return f"{parts[0]}-{int(parts[1]):02d}"
        if len(parts) >= 3 and len(parts[2]) >= 4 and parts[2][:4].isdigit() and parts[1].isdigit():
            return f"{parts[2][:4]}-{int(parts[1]):02d}"
    return None


def purge_legacy_mock_bank_transactions(session: Session, client_id: Optional[str] = None) -> int:
    """Purges any legacy synthetic mock bank transactions from the database."""
    mock_banks = [
        "Stanbic Bank Corporate",
        "Ecobank Ghana GHS Operating",
        "Chase Commercial Checking",
        "Standard Chartered Main",
        "Generic Operating Account",
    ]
    query = select(BankTransaction).where(
        or_(
            BankTransaction.bank_account_name.in_(mock_banks),
            BankTransaction.description.like("%MOMO CASH OUT 0244910291%"),
            BankTransaction.description.like("%TOTAL ENERGIES ACCRA CENTRAL%"),
            BankTransaction.description.like("%WIRE TRANSFER TO KWAME MENSAH%"),
            BankTransaction.description.like("%DIRECT CREDIT VODAFONE GHANA%"),
            BankTransaction.description.like("%ACCRA FUEL DEPOT%"),
            BankTransaction.description.like("%DIRECT SETTLEMENT MOMO%"),
            BankTransaction.description.like("%CLEARING TRANSFER - UNALLOCATED MOMO%"),
            BankTransaction.description.like("%OFFICE WORKSHOP REPAIRS%"),
            BankTransaction.description.like("%ACH DEBIT - VENDOR SERVICES UNMAPPED%"),
            BankTransaction.description.like("%DIRECT DEBIT - UTILITY PAYMENT UNRECONCILED%"),
            BankTransaction.description.like("%UNCLASSIFIED TRANSACTION [Watched:%"),
            BankTransaction.description.like("%[Watched: 6990]%"),
            BankTransaction.description.like("%[Watched: 850]%"),
            BankTransaction.description.like("%[Watched: suspense]%"),
            BankTransaction.description.like("%[Watched: uncategorized]%"),
        )
    )
    if client_id:
        query = query.where(BankTransaction.client_id == client_id)

    legacy_txs = session.exec(query).all()
    if legacy_txs:
        purged_count = len(legacy_txs)
        for tx in legacy_txs:
            session.delete(tx)
        session.commit()
        logger.info(f"Purged {purged_count} legacy synthetic mock bank transactions for client {client_id or 'all'}.")
        return purged_count
    return 0


@bank_accountant_router.post("/clients/{client_id}/purge-test-transactions", summary="Accountant: Purge Legacy Test / Simulated Bank Transactions")
async def accountant_purge_test_transactions(client_id: str) -> Dict[str, Any]:
    """Explicitly deletes any legacy mock/synthetic transactions for this client from the database."""
    with Session(get_engine()) as session:
        purged = purge_legacy_mock_bank_transactions(session, client_id=client_id)
        return {
            "success": True,
            "client_id": client_id,
            "purged_count": purged,
            "message": f"Successfully purged {purged} test transactions." if purged > 0 else "No test transactions found.",
        }


@bank_accountant_router.get("/clients/{client_id}/transactions", summary="Accountant: List & Filter Uncategorized Bank Transactions")
async def accountant_list_bank_transactions(
    client_id: str,
    status: Optional[str] = Query("ALL", description="ALL, UNMAPPED, CLARIFICATION_REQUESTED, CLIENT_ANSWERED, MAPPED"),
    search: Optional[str] = Query(None, description="Search description, payee, or amount"),
    month: Optional[str] = Query("ALL", description="ALL, month name ('September'), month number ('09'), or 'YYYY-MM'"),
    year: Optional[str] = Query(None, description="Filter by year e.g. 2026 or ALL"),
    bank_account: Optional[str] = Query("ALL", description="Filter by bank account name or ALL"),
) -> Dict[str, Any]:
    """Lists uncategorized bank transactions requiring classification or client attention."""
    with Session(get_engine()) as session:
        client = session.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
        if not client:
            client = ClientOrganization(id=client_id, name=client_id.replace("_", " ").title())

        # Purge synthetic demo data in production
        if not settings.MOCK_MODE:
            purge_legacy_mock_bank_transactions(session, client_id=client_id)

        # Auto-align polarity, bank account name, and status of existing bank transactions based on raw accounting feed metadata
        all_for_client = session.exec(select(BankTransaction).where(BankTransaction.client_id == client_id)).all()
        needs_commit = False
        for t in all_for_client:
            raw = (t.metadata_json or {}).get("raw_transaction")
            if raw and isinstance(raw, dict):
                # 1. Align polarity
                doc = str(raw.get("debit_or_credit") or "").strip().lower()
                imported_type = str(raw.get("imported_transaction_type") or "").strip().lower()
                debit_amt = float(raw.get("debit_amount", 0.0) or 0.0)
                credit_amt = float(raw.get("credit_amount", 0.0) or 0.0)

                correct_type = None
                if doc == "debit" or debit_amt > 0 or imported_type in ("deposit", "inflow"):
                    correct_type = "CREDIT"
                elif doc == "credit" or credit_amt > 0 or imported_type in ("withdrawal", "expense", "outflow"):
                    correct_type = "DEBIT"
                elif "debit" in imported_type:
                    correct_type = "DEBIT"
                elif "credit" in imported_type:
                    correct_type = "CREDIT"

                if correct_type and t.transaction_type != correct_type:
                    t.transaction_type = correct_type
                    session.add(t)
                    needs_commit = True

                # 2. Align bank_account_name if raw transaction carries a specific bank account name
                raw_bank_name = str(
                    raw.get("from_account_name")
                    or raw.get("account_name")
                    or (raw.get("AccountRef", {}) or {}).get("name")
                    or (raw.get("DepositToAccountRef", {}) or {}).get("name")
                    or (raw.get("BankAccount", {}) or {}).get("Name")
                    or ""
                ).strip()
                if raw_bank_name and (not t.bank_account_name or t.bank_account_name in ("Bank Account", "Zoho Bank Feed", "QuickBooks Bank Feed", "Xero Bank Feed")):
                    t.bank_account_name = raw_bank_name
                    session.add(t)
                    needs_commit = True

                # 3. Align status if already categorized or matched in Zoho Books
                raw_stat = str(raw.get("transaction_status") or raw.get("status") or "").strip().lower()
                if raw_stat in ("categorized", "matched", "manually_added", "excluded") and t.status == "UNMAPPED":
                    t.status = "MAPPED"
                    if not t.mapped_account_name:
                        t.mapped_account_name = "Categorized in Zoho"
                    session.add(t)
                    needs_commit = True

        if needs_commit:
            session.commit()
            all_for_client = session.exec(select(BankTransaction).where(BankTransaction.client_id == client_id)).all()

        query = select(BankTransaction).where(BankTransaction.client_id == client_id)

        if status and status.upper() != "ALL":
            query = query.where(BankTransaction.status == status.upper())

        transactions = session.exec(query.order_by(BankTransaction.transaction_date.desc(), BankTransaction.id.desc())).all()

        # Discover distinct bank accounts across the client's period-matching transactions
        period_matching_all = [t for t in all_for_client if _matches_month_and_year(t.transaction_date, month, year)]
        bank_account_counts: Dict[str, int] = {}
        for t in period_matching_all:
            b_name = (t.bank_account_name or "Bank Account").strip()
            bank_account_counts[b_name] = bank_account_counts.get(b_name, 0) + 1
        available_bank_accounts = sorted(list(bank_account_counts.keys()))

        # Calculate metrics (scoped to selected bank_account if specified)
        metrics_pool = all_for_client
        if bank_account and bank_account.upper() != "ALL":
            b_target = bank_account.strip().lower()
            metrics_pool = [t for t in all_for_client if (t.bank_account_name or "Bank Account").strip().lower() == b_target]

        total_count = len(metrics_pool)
        total_uncategorized = sum(1 for t in metrics_pool if t.status == "UNMAPPED")
        total_pending_client = sum(1 for t in metrics_pool if t.status == "CLARIFICATION_REQUESTED")
        total_client_answered = sum(1 for t in metrics_pool if t.status == "CLIENT_ANSWERED")
        total_mapped = sum(1 for t in metrics_pool if t.status == "MAPPED")

        # Discover distinct periods and transaction counts per period
        period_counts = {}
        for t in metrics_pool:
            ym = _extract_year_month(t.transaction_date)
            if ym:
                period_counts[ym] = period_counts.get(ym, 0) + 1

        available_months = sorted(list(period_counts.keys()), reverse=True)

        # Apply in-memory month/year filter
        filtered = [t for t in transactions if _matches_month_and_year(t.transaction_date, month, year)]

        # Apply bank_account filter
        if bank_account and bank_account.upper() != "ALL":
            b_target = bank_account.strip().lower()
            filtered = [t for t in filtered if (t.bank_account_name or "Bank Account").strip().lower() == b_target]

        # Search filter
        if search:
            s_low = search.lower()
            filtered = [
                t for t in filtered
                if s_low in t.description.lower()
                or (t.bank_account_name and s_low in t.bank_account_name.lower())
                or (t.payee_name and s_low in t.payee_name.lower())
                or (t.mapped_account_name and s_low in t.mapped_account_name.lower())
                or (t.client_explanation and s_low in t.client_explanation.lower())
                or s_low in str(t.amount)
            ]

        return {
            "client_id": client_id,
            "month": month,
            "year": year,
            "bank_account": bank_account or "ALL",
            "available_months": available_months,
            "period_counts": period_counts,
            "available_bank_accounts": available_bank_accounts,
            "bank_account_counts": bank_account_counts,
            "metrics": {
                "total_count": total_count,
                "filtered_count": len(filtered),
                "total_uncategorized": total_uncategorized,
                "total_pending_client": total_pending_client,
                "total_client_answered": total_client_answered,
                "total_mapped": total_mapped,
            },
            "transactions": [t.model_dump() for t in filtered],
        }


@bank_accountant_router.post("/transactions/{tx_id}/categorize", summary="Accountant: Classify & Categorize Bank Transaction")
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

        # Sync to accounting software
        if payload.post_to_accounting and client:
            adapter = AccountingAdapterFactory.get(client.accounting_software, client.id)
            meta = tx.metadata_json or {}
            ext_tx_id = (
                meta.get("external_transaction_id")
                or meta.get("zoho_transaction_id")
                or meta.get("qbo_transaction_id")
                or meta.get("xero_transaction_id")
                or str(tx.id)
            )
            raw_tx = meta.get("raw_transaction") or {}
            from_account_id = (
                meta.get("zoho_account_id")
                or meta.get("from_account_id")
                or raw_tx.get("from_account_id")
                or raw_tx.get("account_id")
            )
            post_res = await adapter.categorize_bank_transaction(
                transaction_id=str(ext_tx_id),
                account_id=payload.mapped_account_id,
                payee_name=payload.payee_name,
                tax_rate=payload.tax_rate,
                attachments=tx.client_attachments,
                transaction_type=tx.transaction_type,
                amount=tx.amount,
                date=tx.transaction_date,
                description=tx.description,
                from_account_id=from_account_id,
            )
            if not post_res.success:
                logger.error(f"Failed to sync categorization to {client.accounting_software}: {post_res.message}")
                raise HTTPException(status_code=400, detail=post_res.message)

        tx.status = "MAPPED"
        tx.updated_at = datetime.now(timezone.utc)
        session.add(tx)
        session.commit()
        session.refresh(tx)

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


@bank_accountant_router.get("/transactions/{tx_id}/matches", summary="Accountant: Get Platform Matches for Bank Transaction")
async def accountant_get_bank_transaction_matches(tx_id: int) -> Dict[str, Any]:
    """Fetches potential matching open invoices, bills, and payments from connected accounting platform."""
    with Session(get_engine()) as session:
        tx = session.exec(select(BankTransaction).where(BankTransaction.id == tx_id)).first()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found.")

        client = session.exec(select(ClientOrganization).where(ClientOrganization.id == tx.client_id)).first()
        if not client:
            return {"success": True, "matches": []}

        meta = tx.metadata_json or {}
        ext_tx_id = (
            meta.get("external_transaction_id")
            or meta.get("zoho_transaction_id")
            or meta.get("qbo_transaction_id")
            or meta.get("xero_transaction_id")
        )

        matches = []
        if ext_tx_id and str(client.accounting_software).lower() in ["zoho", "zoho books", "zohobooks"]:
            from app.services.zoho_service import ZohoBooksService
            zoho_client = ZohoBooksService(
                org_id=client.zoho_org_id,
                client_id=client.zoho_client_id,
                client_secret=client.zoho_client_secret,
                refresh_token=client.zoho_refresh_token,
            )
            try:
                matches = await zoho_client.fetch_bank_transaction_matches(str(ext_tx_id))
            except Exception as e:
                logger.warning(f"Could not fetch matches for tx {tx_id}: {e}")

        return {
            "success": True,
            "transaction_id": tx_id,
            "external_transaction_id": ext_tx_id,
            "matches": matches,
        }


@bank_accountant_router.post("/transactions/{tx_id}/toggle-direction", summary="Accountant: Toggle Transfer In / Transfer Out")
async def accountant_toggle_transaction_direction(tx_id: int) -> Dict[str, Any]:
    """Allows an operator to quickly flip between Transfer In (CREDIT) and Transfer Out (DEBIT)."""
    with Session(get_engine()) as session:
        tx = session.get(BankTransaction, tx_id)
        if not tx:
            raise HTTPException(status_code=404, detail="Bank transaction not found.")
        tx.transaction_type = "DEBIT" if tx.transaction_type == "CREDIT" else "CREDIT"
        session.add(tx)
        session.commit()
        session.refresh(tx)
        return {
            "success": True,
            "transaction_id": tx.id,
            "transaction_type": tx.transaction_type,
            "message": f"Updated transaction to {'Transfer In (+)' if tx.transaction_type == 'CREDIT' else 'Transfer Out (-)'}.",
        }


@bank_accountant_router.post("/transactions/{tx_id}/query", summary="Accountant: Draw Client Attention (Send Query)")
async def accountant_query_transaction(tx_id: int, payload: BankTransactionQueryRequest) -> Dict[str, Any]:
    """Draws client attention, sets status to CLARIFICATION_REQUESTED, and dispatches Magic Link notification."""
    with Session(get_engine()) as session:
        tx = session.exec(select(BankTransaction).where(BankTransaction.id == tx_id)).first()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found.")

        client = session.exec(select(ClientOrganization).where(ClientOrganization.id == tx.client_id)).first()
        client_name = client.name if client else tx.client_id

        # Target recipient
        target_email = payload.recipient_email
        if not target_email and client and client.team_members:
            for tm in client.team_members:
                if tm.get("role") in ["CFO", "Financial_Controller", "Operations_Lead"] and tm.get("email"):
                    target_email = tm.get("email")
                    break

        target_email = target_email or settings.NOTIFICATION_EMAIL or "cdanso@service4gh.com"
        now_utc = datetime.now(timezone.utc)
        now_iso = now_utc.isoformat()

        tx.accountant_query = payload.query_text
        tx.status = "CLARIFICATION_REQUESTED"
        tx.query_date = now_utc
        tx.updated_at = now_utc

        meta = dict(tx.metadata_json or {})
        meta["recipient_email"] = target_email
        meta["query_status"] = "CLARIFICATION_REQUESTED"
        history = list(meta.get("query_history") or [])
        history.append({
            "sender": "accountant",
            "text": payload.query_text,
            "recipient_email": target_email,
            "timestamp": now_iso,
        })
        meta["query_history"] = history
        tx.metadata_json = meta
        flag_modified(tx, "metadata_json")

        session.add(tx)
        session.commit()
        session.refresh(tx)

        # Generate Magic Link for 1-click response
        magic_token = generate_magic_link_token(tx.client_id, client_name, tx.id)
        magic_url = f"{settings.APP_BASE_URL.rstrip('/')}/?portal_magic={magic_token}"

        if payload.send_immediately:
            subject = f"❓ [Action Required] Clarification requested for GHS {tx.amount:,.2f} ({client_name})"
            html_content = f"""
            <div style="background-color: #f8fafc; padding: 32px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                <div style="background: #ffffff; color: #0f172a; padding: 32px; border-radius: 16px; max-width: 580px; margin: 0 auto; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                    <div style="display: inline-block; padding: 4px 12px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 9999px; color: #0284c7; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px;">
                        ❓ Information Request
                    </div>
                    <h2 style="color: #0f172a; margin: 0 0 10px 0; font-size: 20px; font-weight: 700; letter-spacing: -0.01em;">
                        Clarification Needed on Bank Transaction
                    </h2>
                    <p style="color: #475569; font-size: 14px; line-height: 1.5; margin: 0 0 18px 0;">
                        Hello from your accounting team for <strong>{client_name}</strong>,
                    </p>
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; margin: 16px 0;">
                        <div style="font-size: 11px; text-transform: uppercase; font-weight: 600; color: #64748b; letter-spacing: 0.05em;">Transaction Details:</div>
                        <div style="font-size: 18px; font-weight: 700; color: #0f172a; font-family: 'JetBrains Mono', monospace; margin-top: 4px;">
                            GHS {tx.amount:,.2f} <span style="font-size: 13px; font-weight: normal; color: #64748b;">({tx.transaction_type})</span>
                        </div>
                        <div style="font-size: 12px; color: #475569; margin-top: 6px;">
                            Date: <strong>{tx.transaction_date}</strong> &bull; Ref: <code>{tx.description}</code>
                        </div>
                    </div>
                    <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-left: 4px solid #0284c7; padding: 14px 16px; border-radius: 8px; margin-bottom: 24px;">
                        <strong style="color: #0369a1; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">Question from Accountant:</strong>
                        <p style="color: #0c4a6e; font-size: 14px; margin: 6px 0 0 0; line-height: 1.5; font-style: italic;">"{payload.query_text}"</p>
                    </div>
                    <div style="text-align: center; margin: 28px 0 16px 0;">
                        <a href="{magic_url}" style="background: #0284c7; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);">
                            Review &amp; Provide Explanation &rarr;
                        </a>
                    </div>
                    <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
                        🔒 No password required &bull; Secure 72-hour one-click access
                    </p>
                </div>
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


@bank_accountant_router.post("/transactions/bulk-categorize", summary="Accountant: Bulk Categorize Multiple Transactions")
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


@bank_accountant_router.post("/transactions/bulk-query", summary="Accountant: Bulk Query Client on Multiple Transactions")
async def accountant_bulk_query(payload: BankTransactionBulkQueryRequest) -> Dict[str, Any]:
    """Dispatches a consolidated digest email for multiple selected transactions."""
    with Session(get_engine()) as session:
        txs = session.exec(select(BankTransaction).where(BankTransaction.id.in_(payload.transaction_ids))).all()
        if not txs:
            raise HTTPException(status_code=404, detail="No matching transactions found.")

        client_id = txs[0].client_id
        client = session.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
        client_name = client.name if client else client_id
        target_email = payload.recipient_email or settings.NOTIFICATION_EMAIL or "cdanso@service4gh.com"
        now_utc = datetime.now(timezone.utc)
        now_iso = now_utc.isoformat()

        for t in txs:
            t.accountant_query = payload.query_text
            t.status = "CLARIFICATION_REQUESTED"
            t.query_date = now_utc
            t.updated_at = now_utc
            meta = dict(t.metadata_json or {})
            meta["recipient_email"] = target_email
            meta["query_status"] = "CLARIFICATION_REQUESTED"
            history = list(meta.get("query_history") or [])
            history.append({
                "sender": "accountant",
                "text": payload.query_text,
                "recipient_email": target_email,
                "timestamp": now_iso,
            })
            meta["query_history"] = history
            t.metadata_json = meta
            flag_modified(t, "metadata_json")
            session.add(t)
        session.commit()

        magic_token = generate_magic_link_token(client_id, client_name, None)
        magic_url = f"{settings.APP_BASE_URL.rstrip('/')}/?portal_magic={magic_token}"

        subject = f"❓ [Action Required] Clarification requested on {len(txs)} uncategorized bank transactions ({client_name})"
        
        items_html = "".join(
            f"<li style='margin-bottom: 8px; color: #334155; font-size: 13px;'><strong style='color: #0f172a; font-family: monospace;'>GHS {t.amount:,.2f}</strong> <span style='color: #64748b;'>({t.transaction_date})</span> &bull; <code style='background: #f1f5f9; padding: 2px 6px; border-radius: 4px; color: #0f172a;'>{t.description}</code></li>"
            for t in txs[:10]
        )

        html_content = f"""
        <div style="background-color: #f8fafc; padding: 32px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
            <div style="background: #ffffff; color: #0f172a; padding: 32px; border-radius: 16px; max-width: 580px; margin: 0 auto; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                <div style="display: inline-block; padding: 4px 12px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 9999px; color: #0284c7; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px;">
                    ❓ Bulk Information Request
                </div>
                <h2 style="color: #0f172a; margin: 0 0 10px 0; font-size: 20px; font-weight: 700; letter-spacing: -0.01em;">
                    Clarification Needed on {len(txs)} Uncategorized Bank Transactions
                </h2>
                <p style="color: #475569; font-size: 14px; line-height: 1.5; margin: 0 0 16px 0;">
                    Your accounting team has requested information on the following items for <strong>{client_name}</strong>:
                </p>
                <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-left: 4px solid #0284c7; padding: 14px 16px; border-radius: 8px; margin: 16px 0 20px 0;">
                    <div style="font-size: 11px; font-weight: 700; color: #0369a1; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">Accountant's Question:</div>
                    <p style="margin: 0; color: #0c4a6e; font-size: 14px; line-height: 1.5; font-style: italic;">"{payload.query_text}"</p>
                </div>
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; margin-bottom: 24px;">
                    <div style="font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px;">Pending Transactions:</div>
                    <ul style="padding-left: 20px; margin: 0;">
                        {items_html}
                    </ul>
                </div>
                <div style="text-align: center; margin-top: 24px;">
                    <a href="{magic_url}" style="background: #0284c7; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);">
                        Open Portal &amp; Provide Notes &rarr;
                    </a>
                </div>
                <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 16px 0 0 0;">
                    🔒 No password required &bull; Secure 72-hour one-click access
                </p>
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


@bank_accountant_router.post("/clients/{client_id}/sync-accounting", summary="Accountant: Pull Uncategorized Bank Transactions from Accounting Platform")
async def accountant_sync_bank_feeds(
    client_id: str,
    month: Optional[str] = Query(None, description="Filter sync by target month (e.g. September, 09, YYYY-MM)"),
    year: Optional[str] = Query(None, description="Filter sync by target year (e.g. 2026 or ALL)"),
) -> Dict[str, Any]:
    """Pulls unmapped bank transactions from connected accounting platform bank feeds into the Information Requests queue."""
    with Session(get_engine()) as session:
        client = session.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
        if not client:
            raise HTTPException(status_code=404, detail="Client organisation not found.")

        # Ensure any legacy mock transactions are wiped out
        purge_legacy_mock_bank_transactions(session, client_id=client_id)

        # Clean up historical records previously ingested from watched GL accounts
        legacy_gl_txs = session.exec(
            select(BankTransaction).where(
                BankTransaction.client_id == client_id,
                or_(
                    BankTransaction.source_file_name == "Live_Watched_Accounts_Sync",
                    BankTransaction.bank_account_name == "Watched Account",
                    BankTransaction.description.like("%[Watched:%"),
                ),
            )
        ).all()
        if legacy_gl_txs:
            for l_tx in legacy_gl_txs:
                session.delete(l_tx)
            session.commit()
            logger.info(f"Purged {len(legacy_gl_txs)} historical GL register records for client {client_id}.")

        # Resolve monitored bank accounts from the client's BANK pipeline or watched_accounts
        legacy_gl = {"6990", "850", "999", "suspense", "uncategorized", "all"}
        raw_watched = list(client.watched_accounts or [])
        for p in (client.pipelines or []):
            if isinstance(p, dict) and str(p.get("section", "")).upper() == "BANK":
                p_watched = p.get("watched_accounts")
                if isinstance(p_watched, list):
                    raw_watched = p_watched
                    break
        watched_bank_accounts = [
            str(w).strip()
            for w in raw_watched
            if str(w).strip() and str(w).strip().lower() not in legacy_gl
        ]

        target_year_int = int(year) if (year and year.upper() != "ALL" and year.strip().isdigit()) else None
        adapter = AccountingAdapterFactory.get(client.accounting_software, client.id)
        feeds = await adapter.fetch_uncategorized_bank_transactions(
            watched_accounts=watched_bank_accounts if watched_bank_accounts else None,
            month=month,
            year=target_year_int,
        )

        period_label = f" for {month} {year}".strip() if (month or year) else ""

        # Collect IDs and checksums of the truly uncategorized feeds from live accounting platform
        feed_checksums = set()
        feed_ext_ids = set()
        for f in (feeds or []):
            c_str = f"{client_id}:{f.get('transaction_date')}:{f.get('amount')}:{f.get('description')}"
            feed_checksums.add(hashlib.sha256(c_str.encode()).hexdigest()[:16])
            ext_id = f.get("external_transaction_id") or f.get("zoho_transaction_id")
            if ext_id:
                feed_ext_ids.add(str(ext_id))

        # Reconcile existing UNMAPPED transactions: if an existing bank feed transaction is no longer in Zoho's uncategorized feed, it was categorized directly in Zoho
        existing_unmapped = session.exec(
            select(BankTransaction).where(
                BankTransaction.client_id == client_id,
                BankTransaction.status == "UNMAPPED",
            )
        ).all()
        reconciled_in_zoho_count = 0
        for ex in existing_unmapped:
            if _matches_month_and_year(ex.transaction_date, month, year):
                meta = ex.metadata_json or {}
                ext_id = str(meta.get("external_transaction_id") or meta.get("zoho_transaction_id") or "")
                has_zoho_id = bool(meta.get("zoho_transaction_id") or meta.get("external_transaction_id"))
                is_feed_src = ex.source_file_name in ("Live_Bank_Feed_Sync", "Zoho_Live_Bank_Feed", "Bank Feed")
                if not (has_zoho_id or is_feed_src):
                    continue
                if ex.checksum not in feed_checksums and (not ext_id or ext_id not in feed_ext_ids):
                    ex.status = "MAPPED"
                    if not ex.mapped_account_name:
                        ex.mapped_account_name = f"Categorized directly in {adapter.platform_name}"
                    ex.updated_at = datetime.now(timezone.utc)
                    session.add(ex)
                    reconciled_in_zoho_count += 1

        if not feeds:
            if reconciled_in_zoho_count > 0:
                session.commit()
                return {
                    "success": True,
                    "client_id": client_id,
                    "synced_new_count": 0,
                    "reconciled_count": reconciled_in_zoho_count,
                    "message": f"Updated {reconciled_in_zoho_count} transaction(s) categorized directly in {adapter.platform_name}{period_label}.",
                }
            return {
                "success": True,
                "client_id": client_id,
                "synced_new_count": 0,
                "message": f"No uncategorized bank transactions found on {adapter.platform_name}{period_label}.",
            }

        synced_count = 0
        for f in feeds:
            # Checksum idempotency
            checksum_str = f"{client_id}:{f.get('transaction_date')}:{f.get('amount')}:{f.get('description')}"
            c_hash = hashlib.sha256(checksum_str.encode()).hexdigest()[:16]
            existing = session.exec(
                select(BankTransaction).where(
                    or_(
                        BankTransaction.checksum == c_hash,
                        and_(
                            BankTransaction.client_id == client_id,
                            BankTransaction.transaction_date == f.get("transaction_date"),
                            BankTransaction.amount == float(f.get("amount", 0.0)),
                            BankTransaction.description == f.get("description"),
                        ),
                    )
                )
            ).first()
            if existing:
                updated_existing = False
                new_type = f.get("transaction_type")
                if new_type and existing.transaction_type != new_type:
                    existing.transaction_type = new_type
                    updated_existing = True
                feed_bank_name = f.get("bank_account_name") or f.get("account_name")
                if feed_bank_name and feed_bank_name not in ("Bank Account", "Zoho Bank Feed", "QuickBooks Bank Feed", "Xero Bank Feed") and existing.bank_account_name != feed_bank_name:
                    existing.bank_account_name = feed_bank_name
                    updated_existing = True
                if updated_existing:
                    session.add(existing)
                    synced_count += 1
                continue
            else:
                meta = {}
                if f.get("external_transaction_id"):
                    meta["external_transaction_id"] = f.get("external_transaction_id")
                if f.get("zoho_transaction_id"):
                    meta["zoho_transaction_id"] = f.get("zoho_transaction_id")
                if f.get("zoho_account_id"):
                    meta["zoho_account_id"] = f.get("zoho_account_id")
                if f.get("qbo_transaction_id"):
                    meta["qbo_transaction_id"] = f.get("qbo_transaction_id")
                if f.get("qbo_account_id"):
                    meta["qbo_account_id"] = f.get("qbo_account_id")
                if f.get("xero_transaction_id"):
                    meta["xero_transaction_id"] = f.get("xero_transaction_id")
                if f.get("raw_transaction"):
                    meta["raw_transaction"] = f.get("raw_transaction")

                new_tx = BankTransaction(
                    client_id=client_id,
                    transaction_date=f.get("transaction_date", datetime.now().strftime("%Y-%m-%d")),
                    description=f.get("description", "Uncategorized Bank Transaction"),
                    amount=float(f.get("amount", 0.0)),
                    transaction_type=f.get("transaction_type", "DEBIT"),
                    bank_account_name=f.get("bank_account_name") or f.get("account_name") or "Bank Account",
                    source_file_name=f.get("source_file_name", "Live_Bank_Feed_Sync"),
                    checksum=c_hash,
                    status="UNMAPPED",
                    ai_suggested_account=f.get("ai_suggested_account"),
                    category_confidence=float(f.get("category_confidence", 0.85)),
                    metadata_json=meta,
                )
                session.add(new_tx)
                synced_count += 1

        session.commit()

        msg_parts = []
        if synced_count > 0:
            msg_parts.append(f"synced {synced_count} uncategorized transactions")
        if reconciled_in_zoho_count > 0:
            msg_parts.append(f"cleared {reconciled_in_zoho_count} categorized directly in {adapter.platform_name}")
        final_msg = f"Bank feed updated{period_label}: {', '.join(msg_parts)}." if msg_parts else f"Bank feed is up to date{period_label}."

        return {
            "success": True,
            "client_id": client_id,
            "synced_new_count": synced_count,
            "reconciled_count": reconciled_in_zoho_count,
            "message": final_msg,
        }


MAX_BANK_UPLOAD_BYTES = 15 * 1024 * 1024  # 15 MB
ALLOWED_BANK_UPLOAD_EXTS = {".csv", ".pdf", ".txt", ".xlsx", ".xls"}


@bank_accountant_router.post("/upload", summary="Accountant: Ingest Bank Statement (CSV / PDF)")
async def accountant_upload_bank_statement(
    client_id: str = Form(...),
    month: str = Form(default=datetime.now().strftime("%B")),
    year: int = Form(default=datetime.now().year),
    file: UploadFile = File(...),
) -> Dict[str, Any]:
    """Ingests uploaded bank statement with file-size and extension verification."""
    import os
    if file.filename:
        _, ext = os.path.splitext(file.filename)
        if ext.lower() not in ALLOWED_BANK_UPLOAD_EXTS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported statement format '{ext}'. Allowed formats: CSV, PDF, TXT, Excel.",
            )

    content = await file.read(MAX_BANK_UPLOAD_BYTES + 1)
    if len(content) > MAX_BANK_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail="File too large. Maximum statement size is 15MB.",
        )

    res = await run_bank_pipeline_core(
        target_month=month,
        target_year=year,
        client_id=client_id,
        file_bytes=content,
        file_name=file.filename,
        mime_type=file.content_type,
    )
    return res


# -------------------------------------------------------------------------
# Unified Information Requests Control Center Endpoints (AR, AP, BANK, GENERAL)
# -------------------------------------------------------------------------

class CreateInformationRequestPayload(BaseModel):
    client_id: str = Field(description="Target client organization ID")
    pipeline_type: str = Field(default="BANK", description="AR, AP, BANK, or GENERAL")
    query_text: str = Field(description="Question or instruction for the client")
    recipient_email: Optional[str] = None
    send_immediately: bool = True
    bank_transaction_ids: Optional[List[int]] = None
    staged_transaction_ids: Optional[List[int]] = None
    subject: Optional[str] = Field(default=None, description="Subject or document reference for GENERAL requests")
    general_title: Optional[str] = Field(default=None, description="Alias for subject")
    category: Optional[str] = Field(default=None, description="Category label for GENERAL requests")
    party_name: Optional[str] = Field(default=None, description="Alias for category/party")
    amount: Optional[float] = Field(default=0.0, description="Optional amount for GENERAL requests")
    general_amount: Optional[float] = Field(default=None, description="Alias for amount")
    transaction_date: Optional[str] = Field(default=None, description="Optional date for GENERAL requests")
    general_date: Optional[str] = Field(default=None, description="Alias for transaction_date")


class RemindInformationRequestsPayload(BaseModel):
    request_ids: Optional[List[str]] = Field(default=None, description="List of canonical request_ids (e.g. bank:12, staged:45)")
    item_keys: Optional[List[str]] = Field(default=None, description="Alias for request_ids")
    recipient_email: Optional[str] = None
    custom_note: Optional[str] = None


class ResolveInformationRequestsPayload(BaseModel):
    request_ids: Optional[List[str]] = Field(default=None, description="List of canonical request_ids to resolve")
    item_keys: Optional[List[str]] = Field(default=None, description="Alias for request_ids")
    resolution_action: str = Field(
        default="RESOLVE_ONLY",
        description="RESOLVE_ONLY, APPROVE_LEDGER (for AR/AP), or CATEGORIZE_BANK (for BANK)",
    )
    approve_in_ledger: Optional[bool] = None
    mapped_account_id: Optional[str] = None
    mapped_account_name: Optional[str] = None
    payee_name: Optional[str] = None
    notes: Optional[str] = None
    resolution_note: Optional[str] = None


class FollowupInformationRequestPayload(BaseModel):
    request_id: Optional[str] = Field(default=None, description="Canonical request_id (e.g. bank:12 or staged:45)")
    item_key: Optional[str] = Field(default=None, description="Alias for request_id")
    followup_text: Optional[str] = Field(default=None, description="Follow-up question or note from accountant")
    query_text: Optional[str] = Field(default=None, description="Alias for followup_text")
    message: Optional[str] = Field(default=None, description="Alias for followup_text")
    recipient_email: Optional[str] = None
    send_email: bool = True
    send_immediately: Optional[bool] = None


def _compute_age_hours(iso_or_dt: Optional[Any]) -> float:
    if not iso_or_dt:
        return 0.0
    try:
        if isinstance(iso_or_dt, datetime):
            dt = iso_or_dt if iso_or_dt.tzinfo else iso_or_dt.replace(tzinfo=timezone.utc)
        else:
            s = str(iso_or_dt).strip().replace("Z", "+00:00")
            dt = datetime.fromisoformat(s)
            if not dt.tzinfo:
                dt = dt.replace(tzinfo=timezone.utc)
        diff = (datetime.now(timezone.utc) - dt).total_seconds() / 3600.0
        return max(0.0, round(diff, 1))
    except Exception:
        return 0.0


def _normalize_history_entries(raw_history: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for h in raw_history:
        if not isinstance(h, dict):
            continue
        raw_sender = str(h.get("sender") or h.get("actor") or "accountant").lower()
        is_client = "client" in raw_sender
        msg = str(h.get("message") or h.get("text") or "")
        normalized.append({
            **h,
            "sender": "client" if is_client else "accountant",
            "actor": "CLIENT" if is_client else "ACCOUNTANT",
            "text": msg,
            "message": msg,
            "timestamp": h.get("timestamp") or "",
            "attachments": h.get("attachments") or [],
        })
    return normalized


@bank_accountant_router.get("/requests", summary="Accountant: List & Triage Information Requests Across All Pipelines & Clients")
async def accountant_list_information_requests(
    client_id: Optional[str] = Query("ALL", description="Client ID or ALL for firm-wide control view"),
    pipeline_type: Optional[str] = Query("ALL", description="ALL, AR, AP, BANK, GENERAL"),
    status: Optional[str] = Query("ALL", description="ALL, NEEDS_REVIEW, AWAITING_CLIENT, OVERDUE, RESOLVED"),
    search: Optional[str] = Query(None, description="Search query, explanation, party, bank account, or email"),
    month: Optional[str] = Query("ALL", description="Filter by month or ALL"),
    year: Optional[str] = Query("ALL", description="Filter by year or ALL"),
) -> Dict[str, Any]:
    """Unified control center endpoint returning all client information requests across AR, AP, Banking, and General."""
    from app.api.v1.clients import get_client_id_aliases
    from app.workflows.zoho_invoice_generator import extract_slip_customer_name

    with Session(get_engine()) as session:
        all_clients = session.exec(select(ClientOrganization)).all()
        client_name_map: Dict[str, str] = {c.id: c.name for c in all_clients}
        client_icon_map: Dict[str, str] = {c.id: (c.icon or "🏢") for c in all_clients}

        target_aliases: Optional[List[str]] = None
        canonical_target_client_id: Optional[str] = None
        if client_id and client_id.strip().upper() != "ALL":
            canonical_target_client_id = client_id.strip()
            target_aliases = get_client_id_aliases(canonical_target_client_id) or [canonical_target_client_id]

        # 1. Gather BankTransaction requests
        bank_query = select(BankTransaction)
        if target_aliases:
            bank_query = bank_query.where(BankTransaction.client_id.in_(target_aliases))
        bank_rows = session.exec(bank_query.order_by(BankTransaction.transaction_date.desc(), BankTransaction.id.desc())).all()

        all_items: List[Dict[str, Any]] = []

        for btx in bank_rows:
            meta = btx.metadata_json or {}
            has_query = bool(
                btx.accountant_query
                or btx.client_explanation
                or btx.status in ("CLARIFICATION_REQUESTED", "CLIENT_ANSWERED")
                or meta.get("query_status")
            )
            if not has_query:
                continue

            if not _matches_month_and_year(btx.transaction_date, month, year):
                continue

            if btx.status == "CLIENT_ANSWERED":
                norm_status = "NEEDS_REVIEW"
                query_status_val = "CLIENT_ANSWERED"
            elif btx.status == "CLARIFICATION_REQUESTED":
                norm_status = "AWAITING_CLIENT"
                query_status_val = "CLARIFICATION_REQUESTED"
            elif btx.status in ("MAPPED", "POSTED") or str(meta.get("query_status")).upper() == "RESOLVED":
                norm_status = "RESOLVED"
                query_status_val = "RESOLVED"
            else:
                norm_status = "AWAITING_CLIENT"
                query_status_val = "CLARIFICATION_REQUESTED"

            q_dt_raw = btx.query_date.isoformat() if btx.query_date else (meta.get("query_date") or (btx.created_at.isoformat() if btx.created_at else None))
            r_dt_raw = btx.response_date.isoformat() if btx.response_date else meta.get("response_date")
            age_hrs = _compute_age_hours(q_dt_raw)
            is_overdue = (norm_status == "AWAITING_CLIENT") and (age_hrs >= 72.0)

            c_id = btx.client_id
            c_name = client_name_map.get(c_id) or c_id.replace("_", " ").title()
            recipient = meta.get("recipient_email") or "Client Contact"

            history = list(meta.get("query_history") or [])
            if not history:
                if btx.accountant_query:
                    history.append({
                        "sender": "accountant",
                        "text": btx.accountant_query,
                        "recipient_email": recipient,
                        "timestamp": q_dt_raw,
                    })
                if btx.client_explanation:
                    history.append({
                        "sender": "client",
                        "text": btx.client_explanation,
                        "timestamp": r_dt_raw,
                        "attachments": btx.client_attachments or [],
                    })
            history = _normalize_history_entries(history)

            magic_token = generate_magic_link_token(c_id, c_name, btx.id)
            magic_url = f"{settings.APP_BASE_URL.rstrip('/')}/?portal_magic={magic_token}"

            all_items.append({
                "id": btx.id,
                "primary_id": btx.id,
                "request_id": f"BANK:{btx.id}",
                "item_key": f"BANK:{btx.id}",
                "source_kind": "BANK",
                "client_id": c_id,
                "client_name": c_name,
                "client_currency": "GHS",
                "client_icon": client_icon_map.get(c_id, "🏢"),
                "pipeline_type": "BANK",
                "entity_label": "Bank Transaction",
                "transaction_id": btx.id,
                "transaction_ids": [btx.id],
                "items_count": 1,
                "line_count": 1,
                "transaction_date": btx.transaction_date,
                "amount": float(btx.amount or 0.0),
                "currency": "GHS",
                "direction": btx.transaction_type or "DEBIT",
                "transaction_type": btx.transaction_type or "DEBIT",
                "party_or_account_name": btx.bank_account_name or "Bank Account",
                "bank_account_name": btx.bank_account_name or "Bank Account",
                "payee_name": btx.payee_name,
                "mapped_account_id": btx.mapped_account_id,
                "mapped_account_name": btx.mapped_account_name,
                "assigned_category": btx.mapped_account_name,
                "title": btx.description,
                "description": btx.description,
                "source_file_name": btx.source_file_name,
                "drive_file_id": None,
                "drive_file_url": None,
                "status": norm_status,
                "query_status": query_status_val,
                "raw_status": btx.status,
                "accountant_query": btx.accountant_query or "",
                "client_explanation": btx.client_explanation,
                "client_attachments": btx.client_attachments or [],
                "recipient_email": recipient,
                "query_date": q_dt_raw,
                "response_date": r_dt_raw,
                "resolved_date": meta.get("resolved_date"),
                "age_hours": age_hrs,
                "is_overdue": is_overdue,
                "reminder_count": int(meta.get("reminder_count") or 0),
                "last_reminder_at": meta.get("last_reminder_at"),
                "last_reminded_at": meta.get("last_reminder_at"),
                "query_history": history,
                "magic_url": magic_url,
            })

        # 2. Gather StagedTransaction requests (AR, AP, GENERAL)
        staged_query = select(StagedTransaction)
        if target_aliases:
            staged_query = staged_query.where(StagedTransaction.client_id.in_(target_aliases))
        staged_rows = session.exec(staged_query.order_by(StagedTransaction.transaction_date.desc(), StagedTransaction.id.desc())).all()

        grouped_staged: Dict[str, List[StagedTransaction]] = {}
        for st in staged_rows:
            meta = st.metadata_json or {}
            q_stat = str(meta.get("query_status") or "").upper()
            q_text = meta.get("accountant_query")
            p_type = (st.pipeline_type or "AR").upper()

            if not q_text and q_stat not in ("CLARIFICATION_REQUESTED", "CLIENT_ANSWERED", "RESOLVED") and p_type != "GENERAL":
                continue

            if not _matches_month_and_year(st.transaction_date, month, year):
                continue

            batch_key = meta.get("query_batch_id") or (
                f"ar_slip:{st.client_id}:{st.source_file_name}" if p_type == "AR" and st.source_file_name else f"staged:{st.id}"
            )
            grouped_staged.setdefault(batch_key, []).append(st)

        for batch_key, group in grouped_staged.items():
            primary = group[0]
            meta = primary.metadata_json or {}
            p_type = (primary.pipeline_type or "AR").upper()
            if p_type not in ("AR", "AP", "GENERAL"):
                p_type = "AR"

            q_stat = str(meta.get("query_status") or "CLARIFICATION_REQUESTED").upper()
            if q_stat == "CLIENT_ANSWERED":
                norm_status = "NEEDS_REVIEW"
                query_status_val = "CLIENT_ANSWERED"
            elif q_stat == "RESOLVED" or (primary.approved and q_stat != "CLARIFICATION_REQUESTED"):
                norm_status = "RESOLVED"
                query_status_val = "RESOLVED"
            else:
                norm_status = "AWAITING_CLIENT"
                query_status_val = "CLARIFICATION_REQUESTED"

            total_amt = round(sum(float(g.total_amount or 0.0) for g in group), 2)
            q_dt_raw = meta.get("query_date") or (primary.created_at.isoformat() if primary.created_at else None)
            r_dt_raw = meta.get("response_date")
            age_hrs = _compute_age_hours(q_dt_raw)
            is_overdue = (norm_status == "AWAITING_CLIENT") and (age_hrs >= 72.0)

            c_id = primary.client_id
            for known_cid in client_name_map.keys():
                if c_id.lower() == known_cid.lower() or known_cid.lower() in c_id.lower():
                    c_id = known_cid
                    break
            c_name = client_name_map.get(c_id) or c_id.replace("_", " ").title()
            recipient = meta.get("recipient_email") or "Client Contact"

            if p_type == "AR":
                entity_label = f"AR Control Slip ({len(group)} items)" if len(group) > 1 else "AR Slip / Invoice Item"
                party_name = extract_slip_customer_name(primary.source_file_name, meta) or "Customer"
                if len(group) > 1:
                    item_names = ", ".join(str(g.item_or_description or "Item") for g in group[:4])
                    if len(group) > 4:
                        item_names += f" (+{len(group) - 4} more)"
                    desc_text = f"{primary.source_file_name} ({item_names})"
                else:
                    desc_text = f"{primary.source_file_name} - {primary.item_or_description}"
                direction = "CREDIT"
            elif p_type == "AP":
                entity_label = "AP Vendor Bill"
                party_name = str(meta.get("vendor_name") or primary.item_or_description or "Vendor")
                desc_text = f"{primary.source_file_name} - {primary.category_or_account or primary.item_or_description}"
                direction = "DEBIT"
            else:
                entity_label = "General / Document Request"
                party_name = str(meta.get("category") or primary.category_or_account or "Monthly Close")
                desc_text = primary.item_or_description or primary.source_file_name or "General Information Request"
                direction = "DEBIT"

            drive_file_id_val = meta.get("drive_file_id") or primary.source_identifier
            drive_url = meta.get("drive_file_url") or (
                f"https://drive.google.com/file/d/{drive_file_id_val}/view" if drive_file_id_val else None
            )

            history = list(meta.get("query_history") or [])
            if not history:
                if meta.get("accountant_query"):
                    history.append({
                        "sender": "accountant",
                        "text": meta.get("accountant_query"),
                        "recipient_email": recipient,
                        "timestamp": q_dt_raw,
                    })
                if meta.get("client_explanation"):
                    history.append({
                        "sender": "client",
                        "text": meta.get("client_explanation"),
                        "timestamp": r_dt_raw,
                        "attachments": meta.get("client_attachments", []),
                    })
            history = _normalize_history_entries(history)

            magic_token = generate_magic_link_token(c_id, c_name, primary.id)
            magic_url = f"{settings.APP_BASE_URL.rstrip('/')}/?portal_magic={magic_token}"

            all_items.append({
                "id": primary.id,
                "primary_id": primary.id,
                "request_id": f"STAGED:{primary.id}",
                "item_key": f"STAGED:{primary.id}",
                "source_kind": "STAGED",
                "client_id": c_id,
                "client_name": c_name,
                "client_currency": "GHS",
                "client_icon": client_icon_map.get(c_id, "🏢"),
                "pipeline_type": p_type,
                "entity_label": entity_label,
                "transaction_id": primary.id,
                "transaction_ids": [g.id for g in group if g.id is not None],
                "items_count": len(group),
                "line_count": len(group),
                "line_items": [
                    {
                        "id": g.id,
                        "description": g.item_or_description or g.source_file_name or "Item",
                        "quantity": float(g.quantity_or_debit or 0.0),
                        "credit_amount": float(g.credit_amount or 0.0) if g.credit_amount is not None else 0.0,
                        "rate": float(g.rate_or_price or 0.0),
                        "amount": float(g.total_amount or 0.0),
                    }
                    for g in group
                ],
                "transaction_date": primary.transaction_date,
                "amount": total_amt,
                "currency": "GHS",
                "direction": direction,
                "transaction_type": direction,
                "party_or_account_name": party_name,
                "bank_account_name": None,
                "payee_name": party_name,
                "mapped_account_id": primary.accounting_ref_id,
                "mapped_account_name": primary.category_or_account,
                "assigned_category": primary.category_or_account,
                "title": desc_text,
                "description": desc_text,
                "source_file_name": primary.source_file_name,
                "drive_file_id": drive_file_id_val,
                "drive_file_url": drive_url,
                "status": norm_status,
                "query_status": query_status_val,
                "raw_status": q_stat,
                "accountant_query": meta.get("accountant_query") or "",
                "client_explanation": meta.get("client_explanation"),
                "client_attachments": meta.get("client_attachments", []),
                "recipient_email": recipient,
                "query_date": q_dt_raw,
                "response_date": r_dt_raw,
                "resolved_date": meta.get("resolved_date"),
                "age_hours": age_hrs,
                "is_overdue": is_overdue,
                "reminder_count": int(meta.get("reminder_count") or 0),
                "last_reminder_at": meta.get("last_reminder_at"),
                "last_reminded_at": meta.get("last_reminder_at"),
                "query_history": history,
                "magic_url": magic_url,
                "reviewed": all(bool(g.reviewed) for g in group),
                "approved": all(bool(g.approved) for g in group),
                "is_approved": all(bool(g.approved) for g in group),
                "is_reviewed": all(bool(g.reviewed) for g in group),
            })

        # Compute summary metrics across all matching client items (before pipeline/status/search filters)
        needs_review_count = sum(1 for i in all_items if i["status"] == "NEEDS_REVIEW")
        awaiting_client_count = sum(1 for i in all_items if i["status"] == "AWAITING_CLIENT")
        overdue_count = sum(1 for i in all_items if i["is_overdue"])
        resolved_count = sum(1 for i in all_items if i["status"] == "RESOLVED")

        by_pipeline = {
            "AR": sum(1 for i in all_items if i["pipeline_type"] == "AR"),
            "AP": sum(1 for i in all_items if i["pipeline_type"] == "AP"),
            "BANK": sum(1 for i in all_items if i["pipeline_type"] == "BANK"),
            "GENERAL": sum(1 for i in all_items if i["pipeline_type"] == "GENERAL"),
        }

        by_client_map: Dict[str, Dict[str, Any]] = {}
        for c in all_clients:
            by_client_map[c.id] = {
                "client_id": c.id,
                "client_name": c.name,
                "client_icon": c.icon or "🏢",
                "total": 0,
                "total_requests": 0,
                "needs_review": 0,
                "answered_count": 0,
                "awaiting_client": 0,
                "pending_count": 0,
                "overdue": 0,
                "overdue_count": 0,
                "resolved": 0,
            }
        for i in all_items:
            cid = i["client_id"]
            if cid not in by_client_map:
                by_client_map[cid] = {
                    "client_id": cid,
                    "client_name": i["client_name"],
                    "client_icon": i.get("client_icon", "🏢"),
                    "total": 0,
                    "total_requests": 0,
                    "needs_review": 0,
                    "answered_count": 0,
                    "awaiting_client": 0,
                    "pending_count": 0,
                    "overdue": 0,
                    "overdue_count": 0,
                    "resolved": 0,
                }
            entry = by_client_map[cid]
            entry["total"] += 1
            entry["total_requests"] += 1
            if i["status"] == "NEEDS_REVIEW":
                entry["needs_review"] += 1
                entry["answered_count"] += 1
            elif i["status"] == "AWAITING_CLIENT":
                entry["awaiting_client"] += 1
                entry["pending_count"] += 1
                if i["is_overdue"]:
                    entry["overdue"] += 1
                    entry["overdue_count"] += 1
            elif i["status"] == "RESOLVED":
                entry["resolved"] += 1

        by_recipient: Dict[str, int] = {}
        for i in all_items:
            rec = i.get("recipient_email") or "Unassigned"
            by_recipient[rec] = by_recipient.get(rec, 0) + 1

        # Apply pipeline_type filter
        filtered = list(all_items)
        if pipeline_type and pipeline_type.upper() != "ALL":
            p_target = pipeline_type.upper()
            filtered = [i for i in filtered if i["pipeline_type"] == p_target]

        # Apply status filter
        if status and status.upper() != "ALL":
            s_target = status.upper()
            if s_target == "OVERDUE":
                filtered = [i for i in filtered if i["is_overdue"]]
            elif s_target in ("NEEDS_REVIEW", "CLIENT_ANSWERED"):
                filtered = [i for i in filtered if i["status"] == "NEEDS_REVIEW"]
            elif s_target in ("AWAITING_CLIENT", "CLARIFICATION_REQUESTED", "PENDING", "PENDING_CLIENT"):
                filtered = [i for i in filtered if i["status"] == "AWAITING_CLIENT"]
            elif s_target == "RESOLVED":
                filtered = [i for i in filtered if i["status"] == "RESOLVED"]

        # Apply search filter
        if search:
            q_low = search.strip().lower()
            filtered = [
                i for i in filtered
                if q_low in (i.get("description") or "").lower()
                or q_low in (i.get("party_or_account_name") or "").lower()
                or q_low in (i.get("accountant_query") or "").lower()
                or q_low in (i.get("client_explanation") or "").lower()
                or q_low in (i.get("recipient_email") or "").lower()
                or q_low in (i.get("client_name") or "").lower()
                or q_low in str(i.get("amount") or "")
            ]

        # Sort by priority: NEEDS_REVIEW first, then OVERDUE, then AWAITING_CLIENT, then RESOLVED
        status_rank = {"NEEDS_REVIEW": 0, "AWAITING_CLIENT": 1, "RESOLVED": 2}
        filtered.sort(
            key=lambda x: (
                status_rank.get(x["status"], 3),
                0 if x["is_overdue"] else 1,
                -float(x.get("age_hours") or 0.0),
            )
        )

        return {
            "client_id": client_id or "ALL",
            "pipeline_type": pipeline_type or "ALL",
            "status": status or "ALL",
            "metrics": {
                "total_count": len(all_items),
                "total_requests": len(all_items),
                "filtered_count": len(filtered),
                "needs_review_count": needs_review_count,
                "client_answered_count": needs_review_count,
                "needs_review": needs_review_count,
                "awaiting_client_count": awaiting_client_count,
                "pending_client_count": awaiting_client_count,
                "awaiting_client": awaiting_client_count,
                "overdue_count": overdue_count,
                "overdue_72h": overdue_count,
                "resolved_count": resolved_count,
                "resolved": resolved_count,
                "ar_count": by_pipeline["AR"],
                "ap_count": by_pipeline["AP"],
                "bank_count": by_pipeline["BANK"],
                "general_count": by_pipeline["GENERAL"],
                "by_pipeline": by_pipeline,
                "by_recipient": by_recipient,
            },
            "client_summaries": sorted(
                list(by_client_map.values()),
                key=lambda c: (-c["needs_review"], -c["awaiting_client"], -c["total"], c["client_name"]),
            ),
            "items": filtered,
            "requests": filtered,
        }


@bank_accountant_router.post("/requests/create", summary="Accountant: Create & Dispatch Information Request (AR, AP, BANK, or GENERAL)")
async def accountant_create_information_request(payload: CreateInformationRequestPayload) -> Dict[str, Any]:
    """Creates an information request across AR, AP, Banking, or General and emails a 1-click Magic Link to the client."""
    from app.workflows.zoho_invoice_generator import extract_slip_customer_name

    p_type = (payload.pipeline_type or "BANK").upper()
    now_utc = datetime.now(timezone.utc)
    now_iso = now_utc.isoformat()

    with Session(get_engine()) as session:
        client = session.exec(select(ClientOrganization).where(ClientOrganization.id == payload.client_id)).first()
        client_name = client.name if client else payload.client_id.replace("_", " ").title()

        target_email = payload.recipient_email
        if not target_email and client and client.team_members:
            for tm in client.team_members:
                if tm.get("role") in ["CFO", "Financial_Controller", "Operations_Lead"] and tm.get("email"):
                    target_email = tm.get("email")
                    break
        target_email = target_email or (client.source_email if client else None) or settings.NOTIFICATION_EMAIL or "cdanso@service4gh.com"

        created_request_ids: List[str] = []
        email_items_summary: List[str] = []
        total_amount_queried = 0.0
        primary_tx_id_for_magic: Optional[int] = None

        # Path A: Bank Transactions
        if p_type == "BANK" and payload.bank_transaction_ids:
            btxs = session.exec(
                select(BankTransaction).where(BankTransaction.id.in_(payload.bank_transaction_ids))
            ).all()
            if not btxs:
                raise HTTPException(status_code=404, detail="No matching bank transactions found.")

            for btx in btxs:
                btx.accountant_query = payload.query_text
                btx.status = "CLARIFICATION_REQUESTED"
                btx.query_date = now_utc
                btx.updated_at = now_utc

                meta = dict(btx.metadata_json or {})
                meta["recipient_email"] = target_email
                meta["query_status"] = "CLARIFICATION_REQUESTED"
                meta["query_date"] = now_iso
                history = list(meta.get("query_history") or [])
                history.append({
                    "sender": "accountant",
                    "actor": "ACCOUNTANT",
                    "text": payload.query_text,
                    "message": payload.query_text,
                    "recipient_email": target_email,
                    "timestamp": now_iso,
                })
                meta["query_history"] = history
                btx.metadata_json = meta
                flag_modified(btx, "metadata_json")
                session.add(btx)

                created_request_ids.append(f"BANK:{btx.id}")
                total_amount_queried += float(btx.amount or 0.0)
                email_items_summary.append(
                    f"<li><strong>GHS {float(btx.amount or 0.0):,.2f}</strong> ({btx.transaction_date}) &bull; {btx.bank_account_name or 'Bank'}: <code>{btx.description}</code></li>"
                )
            session.commit()
            if len(btxs) == 1:
                primary_tx_id_for_magic = btxs[0].id
            badge_label = "Bank Transaction Clarification"

        # Path B: AR or AP StagedTransactions
        elif p_type in ("AR", "AP") and payload.staged_transaction_ids:
            stxs = session.exec(
                select(StagedTransaction).where(StagedTransaction.id.in_(payload.staged_transaction_ids))
            ).all()
            if not stxs:
                raise HTTPException(status_code=404, detail="No matching staged transactions found.")

            batch_id = f"qbatch_{p_type.lower()}_{int(time.time() * 1000)}"
            for st in stxs:
                meta = dict(st.metadata_json or {})
                meta["query_status"] = "CLARIFICATION_REQUESTED"
                meta["accountant_query"] = payload.query_text
                meta["recipient_email"] = target_email
                meta["query_date"] = now_iso
                # If all selected rows belong to the same AR slip file, group them under one batch_id
                if p_type == "AR" and len({s.source_file_name for s in stxs}) == 1:
                    meta["query_batch_id"] = batch_id
                history = list(meta.get("query_history") or [])
                history.append({
                    "sender": "accountant",
                    "actor": "ACCOUNTANT",
                    "text": payload.query_text,
                    "message": payload.query_text,
                    "recipient_email": target_email,
                    "timestamp": now_iso,
                })
                meta["query_history"] = history
                st.metadata_json = meta
                flag_modified(st, "metadata_json")
                session.add(st)
                total_amount_queried += float(st.total_amount or 0.0)

            session.commit()
            primary = stxs[0]
            primary_tx_id_for_magic = primary.id
            created_request_ids.append(f"STAGED:{primary.id}")

            if p_type == "AR":
                badge_label = "Accounts Receivable Slip Clarification"
                cust = extract_slip_customer_name(primary.source_file_name, primary.metadata_json or {}) or "Customer"
                email_items_summary.append(
                    f"<li><strong>Customer: {cust}</strong> &bull; Document: <code>{primary.source_file_name}</code> ({len(stxs)} line item(s), Total: <strong>GHS {total_amount_queried:,.2f}</strong>)</li>"
                )
            else:
                badge_label = "Accounts Payable Vendor Bill Clarification"
                for st in stxs[:10]:
                    v_name = (st.metadata_json or {}).get("vendor_name") or st.item_or_description or "Vendor"
                    email_items_summary.append(
                        f"<li><strong>Vendor: {v_name}</strong> &bull; <strong>GHS {float(st.total_amount or 0.0):,.2f}</strong> ({st.transaction_date}) &bull; <code>{st.source_file_name}</code></li>"
                    )

        # Path C: General / Ad-Hoc Document or Close Request
        else:
            subj = (payload.subject or payload.general_title or "Monthly Close / Document Clarification").strip()
            cat = (payload.category or payload.party_name or "General Request").strip()
            tx_date = payload.transaction_date or payload.general_date or datetime.now().strftime("%Y-%m-%d")
            amt = float(payload.general_amount if payload.general_amount is not None else (payload.amount or 0.0))
            batch_id = f"qbatch_gen_{int(time.time() * 1000)}"

            meta = {
                "query_status": "CLARIFICATION_REQUESTED",
                "accountant_query": payload.query_text,
                "recipient_email": target_email,
                "query_date": now_iso,
                "query_batch_id": batch_id,
                "category": cat,
                "query_history": [
                    {
                        "sender": "accountant",
                        "actor": "ACCOUNTANT",
                        "text": payload.query_text,
                        "message": payload.query_text,
                        "recipient_email": target_email,
                        "timestamp": now_iso,
                    }
                ],
            }
            new_st = StagedTransaction(
                client_id=payload.client_id,
                batch_id=batch_id,
                pipeline_type="GENERAL",
                entity_type="general_request",
                transaction_date=tx_date,
                source_type="manual",
                source_file_name=subj,
                item_or_description=subj,
                category_or_account=cat,
                quantity_or_debit=1.0,
                rate_or_price=amt,
                total_amount=amt,
                reviewed=False,
                approved=False,
                status="PENDING",
                metadata_json=meta,
            )
            session.add(new_st)
            session.commit()
            session.refresh(new_st)

            primary_tx_id_for_magic = new_st.id
            created_request_ids.append(f"STAGED:{new_st.id}")
            total_amount_queried = amt
            badge_label = "General Information / Document Request"
            email_items_summary.append(
                f"<li><strong>{subj}</strong> ({cat}) &bull; Date: {tx_date}{f' &bull; GHS {amt:,.2f}' if amt > 0 else ''}</li>"
            )

        magic_token = generate_magic_link_token(payload.client_id, client_name, primary_tx_id_for_magic)
        magic_url = f"{settings.APP_BASE_URL.rstrip('/')}/?portal_magic={magic_token}"

        if payload.send_immediately:
            subject_line = f"❓ [Action Required] {badge_label} for {client_name}"
            items_html = "".join(email_items_summary)
            html_content = f"""
            <div style="background-color: #f8fafc; padding: 32px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                <div style="background: #ffffff; color: #0f172a; padding: 32px; border-radius: 16px; max-width: 580px; margin: 0 auto; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                    <div style="display: inline-block; padding: 4px 12px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 9999px; color: #0284c7; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px;">
                        ❓ {badge_label}
                    </div>
                    <h2 style="color: #0f172a; margin: 0 0 10px 0; font-size: 20px; font-weight: 700; letter-spacing: -0.01em;">
                        Information Requested by Your Accounting Team
                    </h2>
                    <p style="color: #475569; font-size: 14px; line-height: 1.5; margin: 0 0 16px 0;">
                        Hello from your accounting team for <strong>{client_name}</strong>. Please review and clarify the following item(s):
                    </p>
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; margin-bottom: 18px;">
                        <ul style="padding-left: 18px; margin: 0; color: #334155; font-size: 13px; line-height: 1.6;">
                            {items_html}
                        </ul>
                    </div>
                    <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-left: 4px solid #0284c7; padding: 14px 16px; border-radius: 8px; margin-bottom: 24px;">
                        <strong style="color: #0369a1; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">Question from Accountant:</strong>
                        <p style="color: #0c4a6e; font-size: 14px; margin: 6px 0 0 0; line-height: 1.5; font-style: italic;">"{payload.query_text}"</p>
                    </div>
                    <div style="text-align: center; margin: 28px 0 16px 0;">
                        <a href="{magic_url}" style="background: #0284c7; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);">
                            Open Client Portal &amp; Respond &rarr;
                        </a>
                    </div>
                    <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
                        🔒 No password required &bull; Secure 72-hour one-click access
                    </p>
                </div>
            </div>
            """
            try:
                await MailjetService.send_email(
                    to_email=target_email,
                    subject=subject_line,
                    html_content=html_content,
                    text_content=f"{badge_label} for {client_name}: {payload.query_text}\nRespond here: {magic_url}",
                    recipient_name=client_name,
                )
            except Exception as e:
                logger.warning(f"Could not dispatch information request email: {e}")

        AuditService.log(
            client_id=payload.client_id,
            action="INFORMATION_REQUEST_CREATED",
            details={
                "pipeline_type": p_type,
                "request_ids": created_request_ids,
                "recipient_email": target_email,
                "query_text": payload.query_text,
            },
        )

        return {
            "success": True,
            "client_id": payload.client_id,
            "pipeline_type": p_type,
            "updated_count": len(created_request_ids),
            "request_ids": created_request_ids,
            "recipient_email": target_email,
            "magic_url": magic_url,
            "portal_url": magic_url,
            "email_sent": bool(payload.send_immediately),
            "message": f"Information request dispatched to {target_email}.",
        }


@bank_accountant_router.post("/requests/remind", summary="Accountant: Send Consolidated Reminder Digest for Pending Requests")
async def accountant_remind_information_requests(payload: RemindInformationRequestsPayload) -> Dict[str, Any]:
    """Sends a 1-click reminder digest email for one or more pending information requests across AR, AP, and Banking."""
    now_utc = datetime.now(timezone.utc)
    now_iso = now_utc.isoformat()
    target_keys = payload.item_keys or payload.request_ids or []

    with Session(get_engine()) as session:
        reminded_items: List[str] = []
        client_id_val: Optional[str] = None
        target_email = payload.recipient_email

        for req_id in target_keys:
            r_low = req_id.lower()
            if r_low.startswith("bank:"):
                b_id = int(req_id.split(":", 1)[1])
                btx = session.get(BankTransaction, b_id)
                if not btx:
                    continue
                client_id_val = client_id_val or btx.client_id
                meta = dict(btx.metadata_json or {})
                meta["reminder_count"] = int(meta.get("reminder_count") or 0) + 1
                meta["last_reminder_at"] = now_iso
                if not target_email and meta.get("recipient_email"):
                    target_email = meta.get("recipient_email")
                btx.metadata_json = meta
                flag_modified(btx, "metadata_json")
                session.add(btx)
                reminded_items.append(
                    f"<li><strong>[BANK] GHS {float(btx.amount or 0.0):,.2f}</strong> ({btx.transaction_date}) &bull; <code>{btx.description}</code><br/><span style='color:#0369a1;font-style:italic;'>Question: {btx.accountant_query or 'Please clarify transaction details.'}</span></li>"
                )
            elif r_low.startswith("staged:"):
                s_id = int(req_id.split(":", 1)[1])
                st = session.get(StagedTransaction, s_id)
                if not st:
                    continue
                client_id_val = client_id_val or st.client_id
                meta = dict(st.metadata_json or {})
                meta["reminder_count"] = int(meta.get("reminder_count") or 0) + 1
                meta["last_reminder_at"] = now_iso
                if not target_email and meta.get("recipient_email"):
                    target_email = meta.get("recipient_email")
                st.metadata_json = meta
                flag_modified(st, "metadata_json")
                session.add(st)
                p_lbl = (st.pipeline_type or "AR").upper()
                reminded_items.append(
                    f"<li><strong>[{p_lbl}] GHS {float(st.total_amount or 0.0):,.2f}</strong> ({st.transaction_date}) &bull; <code>{st.source_file_name}</code><br/><span style='color:#0369a1;font-style:italic;'>Question: {meta.get('accountant_query') or 'Please provide clarification.'}</span></li>"
                )

        session.commit()

        if not client_id_val:
            raise HTTPException(status_code=404, detail="No valid requests found to remind.")

        client = session.exec(select(ClientOrganization).where(ClientOrganization.id == client_id_val)).first()
        client_name = client.name if client else client_id_val.replace("_", " ").title()
        target_email = target_email or (client.source_email if client else None) or settings.NOTIFICATION_EMAIL or "cdanso@service4gh.com"

        magic_token = generate_magic_link_token(client_id_val, client_name, None)
        magic_url = f"{settings.APP_BASE_URL.rstrip('/')}/?portal_magic={magic_token}"

        note_html = (
            f"<p style='color:#0f172a;font-size:13px;background:#fef3c7;border:1px solid #fde68a;padding:10px 14px;border-radius:8px;margin-bottom:16px;'><strong>Note from Accountant:</strong> {payload.custom_note}</p>"
            if payload.custom_note
            else ""
        )
        items_html = "".join(reminded_items[:15])
        subject_line = f"⏰ [Reminder] {len(reminded_items)} Pending Information Request(s) for {client_name}"
        html_content = f"""
        <div style="background-color: #f8fafc; padding: 32px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
            <div style="background: #ffffff; color: #0f172a; padding: 32px; border-radius: 16px; max-width: 580px; margin: 0 auto; border: 1px solid #e2e8f0;">
                <div style="display: inline-block; padding: 4px 12px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 9999px; color: #d97706; font-size: 11px; font-weight: 700; text-transform: uppercase; margin-bottom: 12px;">
                    ⏰ Friendly Reminder
                </div>
                <h2 style="color: #0f172a; margin: 0 0 10px 0; font-size: 20px; font-weight: 700;">
                    {len(reminded_items)} Pending Clarification(s) Awaiting Your Reply
                </h2>
                <p style="color: #475569; font-size: 14px; line-height: 1.5; margin: 0 0 16px 0;">
                    Your accounting team is waiting on your input for <strong>{client_name}</strong> to complete reconciliation and monthly close:
                </p>
                {note_html}
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; margin-bottom: 24px;">
                    <ul style="padding-left: 18px; margin: 0; display: flex; flex-direction: column; gap: 10px; font-size: 13px; color: #334155;">
                        {items_html}
                    </ul>
                </div>
                <div style="text-align: center; margin-top: 24px;">
                    <a href="{magic_url}" style="background: #0284c7; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block;">
                        Open Portal &amp; Answer All ({len(reminded_items)}) &rarr;
                    </a>
                </div>
            </div>
        </div>
        """
        try:
            await MailjetService.send_email(
                to_email=target_email,
                subject=subject_line,
                html_content=html_content,
                text_content=f"Reminder: {len(reminded_items)} pending information requests for {client_name}.\nRespond here: {magic_url}",
                recipient_name=client_name,
            )
        except Exception as e:
            logger.warning(f"Could not send reminder email: {e}")

        return {
            "success": True,
            "reminded_count": len(reminded_items),
            "emails_sent": 1,
            "recipient_email": target_email,
            "magic_url": magic_url,
            "portal_url": magic_url,
            "magic_urls": {client_id_val: magic_url},
            "message": f"Reminder sent for {len(reminded_items)} request(s) to {target_email}.",
        }


@bank_accountant_router.post("/requests/resolve", summary="Accountant: Resolve Information Requests & Apply Ledger Action")
async def accountant_resolve_information_requests(payload: ResolveInformationRequestsPayload) -> Dict[str, Any]:
    """Marks information requests as RESOLVED and optionally approves AR/AP ledger items or categorizes Bank transactions."""
    now_utc = datetime.now(timezone.utc)
    now_iso = now_utc.isoformat()
    resolved_count = 0
    target_keys = payload.item_keys or payload.request_ids or []
    should_approve_ledger = bool(payload.approve_in_ledger) or payload.resolution_action == "APPROVE_LEDGER"
    note_val = payload.notes or payload.resolution_note

    with Session(get_engine()) as session:
        for req_id in target_keys:
            r_low = req_id.lower()
            if r_low.startswith("bank:"):
                b_id = int(req_id.split(":", 1)[1])
                btx = session.get(BankTransaction, b_id)
                if not btx:
                    continue
                if payload.resolution_action == "CATEGORIZE_BANK" and payload.mapped_account_id:
                    btx.mapped_account_id = payload.mapped_account_id
                    btx.mapped_account_name = payload.mapped_account_name or payload.mapped_account_id
                    if payload.payee_name:
                        btx.payee_name = payload.payee_name
                    btx.status = "MAPPED"
                else:
                    if not btx.mapped_account_name:
                        btx.mapped_account_name = "Resolved via Control Center"
                    btx.status = "MAPPED"
                btx.updated_at = now_utc
                meta = dict(btx.metadata_json or {})
                meta["query_status"] = "RESOLVED"
                meta["resolved_date"] = now_iso
                if note_val:
                    history = list(meta.get("query_history") or [])
                    history.append({
                        "sender": "accountant",
                        "actor": "ACCOUNTANT",
                        "text": note_val,
                        "message": note_val,
                        "timestamp": now_iso,
                    })
                    meta["query_history"] = history
                btx.metadata_json = meta
                flag_modified(btx, "metadata_json")
                session.add(btx)
                resolved_count += 1

            elif r_low.startswith("staged:"):
                s_id = int(req_id.split(":", 1)[1])
                st = session.get(StagedTransaction, s_id)
                if not st:
                    continue
                st_meta = dict(st.metadata_json or {})
                batch_id = st_meta.get("query_batch_id")
                if batch_id:
                    siblings = [
                        r for r in session.exec(select(StagedTransaction).where(StagedTransaction.client_id == st.client_id)).all()
                        if (r.metadata_json or {}).get("query_batch_id") == batch_id
                    ]
                elif (st.pipeline_type or "AR").upper() == "AR" and st.source_file_name:
                    siblings = session.exec(
                        select(StagedTransaction)
                        .where(StagedTransaction.client_id == st.client_id)
                        .where(StagedTransaction.source_file_name == st.source_file_name)
                    ).all()
                else:
                    siblings = [st]

                for row in (siblings or [st]):
                    rmeta = dict(row.metadata_json or {})
                    rmeta["query_status"] = "RESOLVED"
                    rmeta["resolved_date"] = now_iso
                    if note_val:
                        history = list(rmeta.get("query_history") or [])
                        history.append({
                            "sender": "accountant",
                            "actor": "ACCOUNTANT",
                            "text": note_val,
                            "message": note_val,
                            "timestamp": now_iso,
                        })
                        rmeta["query_history"] = history
                    row.metadata_json = rmeta
                    flag_modified(row, "metadata_json")
                    if should_approve_ledger:
                        row.reviewed = True
                        row.approved = True
                        row.status = "APPROVED"
                    session.add(row)
                resolved_count += 1

        session.commit()

        return {
            "success": True,
            "resolved_count": resolved_count,
            "resolution_action": "APPROVE_LEDGER" if should_approve_ledger else payload.resolution_action,
            "message": f"Successfully resolved {resolved_count} information request(s).",
        }


@bank_accountant_router.post("/requests/followup", summary="Accountant: Send Follow-Up Question in Request Thread")
async def accountant_followup_information_request(payload: FollowupInformationRequestPayload) -> Dict[str, Any]:
    """Appends a follow-up question from the accountant to an existing request thread and re-notifies the client."""
    now_utc = datetime.now(timezone.utc)
    now_iso = now_utc.isoformat()

    req_id = payload.item_key or payload.request_id or ""
    f_text = (payload.followup_text or payload.query_text or payload.message or "").strip()
    if not req_id or not f_text:
        raise HTTPException(status_code=400, detail="item_key/request_id and follow-up message are required.")

    with Session(get_engine()) as session:
        r_low = req_id.lower()
        if r_low.startswith("bank:"):
            b_id = int(req_id.split(":", 1)[1])
            btx = session.get(BankTransaction, b_id)
            if not btx:
                raise HTTPException(status_code=404, detail="Bank transaction not found.")
            client_id_val = btx.client_id
            meta = dict(btx.metadata_json or {})
            target_email = payload.recipient_email or meta.get("recipient_email")
            btx.accountant_query = f_text
            btx.status = "CLARIFICATION_REQUESTED"
            btx.query_date = now_utc
            btx.updated_at = now_utc
            meta["query_status"] = "CLARIFICATION_REQUESTED"
            if target_email:
                meta["recipient_email"] = target_email
            history = list(meta.get("query_history") or [])
            history.append({
                "sender": "accountant",
                "actor": "ACCOUNTANT",
                "text": f_text,
                "message": f_text,
                "recipient_email": target_email,
                "timestamp": now_iso,
            })
            meta["query_history"] = history
            btx.metadata_json = meta
            flag_modified(btx, "metadata_json")
            session.add(btx)
            session.commit()
            tx_id_for_magic = btx.id
            desc_summary = f"GHS {float(btx.amount or 0.0):,.2f} ({btx.transaction_date}) - {btx.description}"
        elif r_low.startswith("staged:"):
            s_id = int(req_id.split(":", 1)[1])
            st = session.get(StagedTransaction, s_id)
            if not st:
                raise HTTPException(status_code=404, detail="Staged transaction not found.")
            client_id_val = st.client_id
            st_meta = dict(st.metadata_json or {})
            target_email = payload.recipient_email or st_meta.get("recipient_email")
            batch_id = st_meta.get("query_batch_id")
            if batch_id:
                siblings = [
                    r for r in session.exec(select(StagedTransaction).where(StagedTransaction.client_id == st.client_id)).all()
                    if (r.metadata_json or {}).get("query_batch_id") == batch_id
                ]
            elif (st.pipeline_type or "AR").upper() == "AR" and st.source_file_name:
                siblings = session.exec(
                    select(StagedTransaction)
                    .where(StagedTransaction.client_id == st.client_id)
                    .where(StagedTransaction.source_file_name == st.source_file_name)
                ).all()
            else:
                siblings = [st]

            for row in (siblings or [st]):
                rmeta = dict(row.metadata_json or {})
                rmeta["query_status"] = "CLARIFICATION_REQUESTED"
                rmeta["accountant_query"] = f_text
                rmeta["query_date"] = now_iso
                if target_email:
                    rmeta["recipient_email"] = target_email
                history = list(rmeta.get("query_history") or [])
                history.append({
                    "sender": "accountant",
                    "actor": "ACCOUNTANT",
                    "text": f_text,
                    "message": f_text,
                    "recipient_email": target_email,
                    "timestamp": now_iso,
                })
                rmeta["query_history"] = history
                row.metadata_json = rmeta
                flag_modified(row, "metadata_json")
                session.add(row)
            session.commit()
            tx_id_for_magic = st.id
            desc_summary = f"GHS {float(st.total_amount or 0.0):,.2f} ({st.transaction_date}) - {st.source_file_name}"
        else:
            raise HTTPException(status_code=400, detail="Unsupported request_id format.")

        client = session.exec(select(ClientOrganization).where(ClientOrganization.id == client_id_val)).first()
        client_name = client.name if client else client_id_val.replace("_", " ").title()
        target_email = target_email or (client.source_email if client else None) or settings.NOTIFICATION_EMAIL or "cdanso@service4gh.com"
        magic_token = generate_magic_link_token(client_id_val, client_name, tx_id_for_magic)
        magic_url = f"{settings.APP_BASE_URL.rstrip('/')}/?portal_magic={magic_token}"

        should_email = payload.send_immediately if payload.send_immediately is not None else payload.send_email
        if should_email:
            try:
                await MailjetService.send_email(
                    to_email=target_email,
                    subject=f"💬 [Follow-Up Question] Clarification needed for {client_name}",
                    html_content=f"<p>Follow-up from your accountant regarding <strong>{desc_summary}</strong>:</p><blockquote>{f_text}</blockquote><p><a href='{magic_url}'>Click here to reply in the Client Portal</a></p>",
                    text_content=f"Follow-up regarding {desc_summary}: {f_text}\nReply: {magic_url}",
                    recipient_name=client_name,
                )
            except Exception as e:
                logger.warning(f"Failed sending follow-up email: {e}")

        return {
            "success": True,
            "request_id": req_id,
            "item_key": req_id,
            "recipient_email": target_email,
            "magic_url": magic_url,
            "portal_url": magic_url,
            "email_sent": bool(should_email),
            "message": f"Follow-up question sent to {target_email}.",
        }


# Mount accountant routes into bank portal router
router.include_router(bank_accountant_router)
