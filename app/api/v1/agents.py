"""Autonomous Accounting Agents API, Multi-Tenant Email & WhatsApp Webhooks & Agent Comms Endpoints."""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlmodel import Session, select
from sqlalchemy.orm.attributes import flag_modified

from app.api.deps import require_admin_user
from app.config import settings
from app.db.session import get_db_session
from app.models.db_models import AgentMessage, ClientKnowledgeEntry, ClientOrganization
from app.services.agent_comms_service import AgentCommsService
from app.services.audit_service import AuditService
from app.services.client_knowledge_service import ClientKnowledgeService
from app.services.whatsapp_service import WhatsAppService, normalize_phone
from app.utils.logging import get_logger

logger = get_logger("api.agents")

router = APIRouter(prefix="/agents", tags=["Autonomous Accounting Agents & Multi-Channel Comms"])


class InboundEmailWebhookPayload(BaseModel):
    from_email: Optional[str] = Field(default=None, description="Sender email address")
    sender: Optional[str] = Field(default=None, description="Alternative sender field (Mailjet/SendGrid)")
    to_email: Optional[str] = Field(default=None, description="Dedicated agent email address")
    recipient: Optional[str] = Field(default=None, description="Alternative recipient field")
    subject: Optional[str] = Field(default="")
    text: Optional[str] = Field(default=None, description="Plain text email body")
    body_text: Optional[str] = Field(default=None)
    html: Optional[str] = Field(default=None)
    client_id: Optional[str] = Field(default=None)
    agent_id: Optional[str] = Field(default=None)
    attachments: List[Dict[str, Any]] = Field(default_factory=list)


class DirectAgentMessagePayload(BaseModel):
    channel: str = Field(default="IN_APP", description="IN_APP, EMAIL, or WHATSAPP")
    sender_address: Optional[str] = Field(default=None, description="Sender email or phone number")
    subject: Optional[str] = Field(default=None)
    message: str = Field(description="Question, command, or knowledge rule for the agent")
    attachments: List[Dict[str, Any]] = Field(default_factory=list)
    send_external_reply: bool = Field(default=False)


class TenantWhatsAppConfigPayload(BaseModel):
    whatsapp_mode: str = Field(
        default="platform_shared",
        description="platform_shared, dedicated_meta, or dedicated_twilio",
    )
    whatsapp_phone_number: Optional[str] = Field(
        default=None,
        description="Tenant's dedicated WhatsApp Business number (e.g. +233551234567)",
    )
    whatsapp_phone_number_id: Optional[str] = Field(
        default=None,
        description="Meta Cloud API Phone Number ID or Twilio From SID",
    )
    whatsapp_waba_id: Optional[str] = Field(
        default=None,
        description="Meta WhatsApp Business Account (WABA) ID",
    )
    whatsapp_access_token: Optional[str] = Field(
        default=None,
        description="Meta System User Access Token or Twilio Auth Token",
    )
    whatsapp_verify_token: Optional[str] = Field(
        default=None,
        description="Webhook verification token for Meta Developer Portal",
    )
    twilio_account_sid: Optional[str] = Field(
        default=None,
        description="Twilio Account SID for dedicated Twilio WhatsApp mode",
    )
    twilio_auth_token: Optional[str] = Field(
        default=None,
        description="Twilio Auth Token for dedicated Twilio WhatsApp mode",
    )


# -------------------------------------------------------------------------
# 1. Public Inbound Email & WhatsApp Webhooks (Multi-Tenant SaaS)
# -------------------------------------------------------------------------

@router.post("/webhooks/email", summary="Inbound Email Webhook for Dedicated Agent Email Addresses")
async def inbound_agent_email_webhook(
    request: Request,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """
    Receives inbound emails sent to any Agent's dedicated email address
    (e.g. anr-group.daily-slips@agents.service4gh.com).
    Supports JSON payloads, Mailjet Parse API, SendGrid Inbound Parse, and form-data.
    Routes to the resolved Agent, processes instructions/queries with Gemini AI, and replies.
    """
    ct = (request.headers.get("content-type") or "").lower()
    raw_data: Dict[str, Any] = {}
    if "multipart" in ct or "form" in ct:
        form = await request.form()
        raw_data = {k: v for k, v in form.items() if isinstance(v, (str, int, float))}
    else:
        try:
            raw_data = await request.json()
        except Exception:
            raw_data = {}

    sender = str(
        raw_data.get("from_email")
        or raw_data.get("from")
        or raw_data.get("sender")
        or raw_data.get("From")
        or raw_data.get("Sender")
        or "accountant@service4gh.com"
    ).strip()
    recipient = str(
        raw_data.get("to_email")
        or raw_data.get("to")
        or raw_data.get("recipient")
        or raw_data.get("To")
        or raw_data.get("Recipient")
        or ""
    ).strip()
    subject = str(raw_data.get("subject") or raw_data.get("Subject") or "Agent Inquiry").strip()
    body_text = str(
        raw_data.get("text")
        or raw_data.get("body_text")
        or raw_data.get("Text-part")
        or raw_data.get("plain")
        or raw_data.get("html")
        or subject
    ).strip()
    attachments = raw_data.get("attachments") if isinstance(raw_data.get("attachments"), list) else []

    try:
        client, agent = AgentCommsService.resolve_agent_by_email(
            session=db,
            recipient_email=recipient,
            subject=subject,
            body_text=body_text,
            client_id_hint=raw_data.get("client_id"),
            agent_id_hint=raw_data.get("agent_id"),
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    result = await AgentCommsService.process_inbound_agent_message(
        session=db,
        client=client,
        agent=agent,
        channel="EMAIL",
        sender_address=sender,
        recipient_address=recipient or str(agent.get("agent_email")),
        body_text=body_text,
        subject=subject,
        attachments=attachments,
        send_external_reply=True,
    )
    return {"success": True, "status": "PROCESSED", **result}


@router.get("/webhooks/whatsapp", summary="Meta WhatsApp Cloud API Global Webhook Verification")
async def verify_global_whatsapp_webhook(
    request: Request,
    db: Session = Depends(get_db_session),
):
    """Handles Meta WhatsApp Cloud API GET subscription verification handshake."""
    params = request.query_params
    hub_mode = params.get("hub.mode")
    hub_token = params.get("hub.verify_token")
    hub_challenge = params.get("hub.challenge")

    # Check if any tenant has registered this verify token
    clients = db.exec(select(ClientOrganization)).all()
    matched_tenant_token = None
    for c in clients:
        wa_cfg = (c.custom_config or {}).get("whatsapp_config") or {}
        t_tok = wa_cfg.get("whatsapp_verify_token")
        if t_tok and hub_token and t_tok.strip() == hub_token.strip():
            matched_tenant_token = t_tok
            break

    ok, challenge_out = WhatsAppService.verify_webhook_handshake(
        hub_mode=hub_mode,
        hub_verify_token=hub_token,
        hub_challenge=hub_challenge,
        tenant_verify_token=matched_tenant_token,
    )
    if not ok:
        raise HTTPException(status_code=403, detail=challenge_out)
    return Response(content=challenge_out, media_type="text/plain")


@router.get("/webhooks/whatsapp/{client_id}", summary="Tenant-Dedicated WhatsApp Webhook Verification")
async def verify_tenant_whatsapp_webhook(
    client_id: str,
    request: Request,
    db: Session = Depends(get_db_session),
):
    """
    Handles Meta WhatsApp Cloud API GET subscription verification for a specific SaaS client's
    own WhatsApp Business number.
    """
    client = db.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
    tenant_token = None
    if client:
        wa_cfg = (client.custom_config or {}).get("whatsapp_config") or {}
        tenant_token = wa_cfg.get("whatsapp_verify_token")

    params = request.query_params
    ok, challenge_out = WhatsAppService.verify_webhook_handshake(
        hub_mode=params.get("hub.mode"),
        hub_verify_token=params.get("hub.verify_token"),
        hub_challenge=params.get("hub.challenge"),
        tenant_verify_token=tenant_token,
    )
    if not ok:
        raise HTTPException(status_code=403, detail=challenge_out)
    return Response(content=challenge_out, media_type="text/plain")


@router.post("/webhooks/whatsapp", summary="Global Multi-Tenant Inbound WhatsApp Webhook")
async def inbound_global_whatsapp_webhook(
    request: Request,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """
    Receives inbound WhatsApp messages from Meta Cloud API, Twilio, or direct JSON payloads.
    Automatically routes to the right client & agent by inspecting:
      1. The receiving business WhatsApp number / phone_number_id (for users who connected their own WhatsApp number).
      2. The @routing_tag in the message body (for users on the platform shared gateway).
      3. The sender's registered phone number in ClientContact / FirmTeamMember.
    """
    return await _handle_whatsapp_inbound(request=request, db=db, client_id_hint=None)


@router.post("/webhooks/whatsapp/{client_id}", summary="Tenant-Dedicated Inbound WhatsApp Webhook")
async def inbound_tenant_whatsapp_webhook(
    client_id: str,
    request: Request,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """
    Receives inbound WhatsApp messages on a tenant's dedicated webhook callback URL
    (/api/v1/agents/webhooks/whatsapp/{client_id}).
    """
    return await _handle_whatsapp_inbound(request=request, db=db, client_id_hint=client_id)


async def _handle_whatsapp_inbound(
    request: Request,
    db: Session,
    client_id_hint: Optional[str] = None,
) -> Dict[str, Any]:
    ct = (request.headers.get("content-type") or "").lower()
    raw_payload: Dict[str, Any] = {}
    if "multipart" in ct or "form" in ct:
        form = await request.form()
        raw_payload = {k: v for k, v in form.items() if isinstance(v, (str, int, float))}
    else:
        try:
            raw_payload = await request.json()
        except Exception:
            raw_payload = {}

    parsed_messages = WhatsAppService.parse_inbound_webhook_payload(raw_payload)
    if not parsed_messages:
        return {"status": "IGNORED", "reason": "No actionable message events in webhook payload", "results": []}

    results: List[Dict[str, Any]] = []
    for item in parsed_messages:
        eff_client_hint = client_id_hint or item.get("client_id")
        eff_agent_hint = item.get("agent_id")
        recipient_id_or_phone = item.get("phone_number_id") or item.get("to_phone")
        try:
            client, agent = AgentCommsService.resolve_agent_by_whatsapp(
                session=db,
                sender_phone=item.get("from_phone") or "",
                recipient_phone_or_id=recipient_id_or_phone,
                message_text=item.get("text") or "",
                client_id_hint=eff_client_hint,
                agent_id_hint=eff_agent_hint,
            )
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

        processed = await AgentCommsService.process_inbound_agent_message(
            session=db,
            client=client,
            agent=agent,
            channel="WHATSAPP",
            sender_address=normalize_phone(item.get("from_phone")) or "+233240000000",
            recipient_address=normalize_phone(item.get("to_phone")) or str(agent.get("whatsapp_phone_number") or settings.WHATSAPP_PLATFORM_NUMBER),
            body_text=item.get("text") or "",
            subject=None,
            attachments=item.get("attachments") or [],
            send_external_reply=True,
        )
        results.append(processed)

    return {
        "success": True,
        "status": "PROCESSED",
        "messages_processed": len(results),
        "processed_count": len(results),
        "primary_result": results[0] if results else None,
        "results": results,
    }


# -------------------------------------------------------------------------
# 2. Admin-Authenticated Agent Discovery, Messaging & WhatsApp Setup
# -------------------------------------------------------------------------

@router.get("", summary="List All Autonomous Accounting Agents Across Clients")
async def list_all_agents(
    client_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db_session),
    _admin: dict = Depends(require_admin_user),
) -> Dict[str, Any]:
    """Returns all configured agents across clients (or for a specific client) with communication & knowledge stats."""
    AgentCommsService.ensure_table(db)
    ClientKnowledgeService.ensure_table(db)

    stmt = select(ClientOrganization)
    if client_id and client_id.upper() != "ALL":
        stmt = stmt.where(ClientOrganization.id == client_id)
    clients = db.exec(stmt).all()

    agents_out: List[Dict[str, Any]] = []
    for c in clients:
        synced_agents = AgentCommsService.sync_client_agents_list(c)
        kb_entries = ClientKnowledgeService.list_knowledge(db, client_id=c.id, active_only=True)
        msgs = db.exec(select(AgentMessage).where(AgentMessage.client_id == c.id)).all()

        for ag in synced_agents:
            ag_id = ag.get("id")
            ag_kb_count = sum(1 for k in kb_entries if k.agent_id in ("ALL", None, "", ag_id))
            ag_msg_count = sum(1 for m in msgs if m.agent_id == ag_id)
            agents_out.append({
                **ag,
                "client_id": c.id,
                "client_name": c.name,
                "knowledge_count": ag_kb_count,
                "messages_count": ag_msg_count,
            })

    return {
        "total_agents": len(agents_out),
        "agents": agents_out,
    }


@router.get("/{client_id}/whatsapp-config", summary="Get Tenant WhatsApp Business Number Configuration")
async def get_tenant_whatsapp_config(
    client_id: str,
    db: Session = Depends(get_db_session),
    _admin: dict = Depends(require_admin_user),
) -> Dict[str, Any]:
    """Returns the client's WhatsApp Business communication configuration and copyable webhook URLs."""
    client = db.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
    if not client:
        raise HTTPException(status_code=404, detail=f"Client '{client_id}' not found.")

    custom_cfg = client.custom_config or {}
    wa_cfg = dict(custom_cfg.get("whatsapp_config") or {})
    base_url = (settings.APP_BASE_URL or "https://aut.service4gh.com").rstrip("/")
    verify_tok = wa_cfg.get("whatsapp_verify_token") or f"s4_wa_verify_{client_id}"
    has_token = bool(wa_cfg.get("whatsapp_access_token") and wa_cfg.get("whatsapp_access_token") != "••••••••")
    has_twilio_token = bool(wa_cfg.get("twilio_auth_token") and wa_cfg.get("twilio_auth_token") != "••••••••")
    tenant_webhook = f"{base_url}/api/v1/agents/webhooks/whatsapp/{client_id}"

    return {
        "client_id": client_id,
        "client_name": client.name,
        "whatsapp_mode": wa_cfg.get("whatsapp_mode") or "platform_shared",
        "whatsapp_phone_number": wa_cfg.get("whatsapp_phone_number") or settings.WHATSAPP_PLATFORM_NUMBER,
        "whatsapp_phone_number_id": wa_cfg.get("whatsapp_phone_number_id") or "",
        "whatsapp_waba_id": wa_cfg.get("whatsapp_waba_id") or "",
        "has_access_token": has_token,
        "has_custom_access_token": has_token,
        "twilio_account_sid": wa_cfg.get("twilio_account_sid") or "",
        "has_twilio_auth_token": has_twilio_token,
        "whatsapp_verify_token": verify_tok,
        "webhook_url": tenant_webhook,
        "webhook_callback_url": tenant_webhook,
        "global_webhook_url": f"{base_url}/api/v1/agents/webhooks/whatsapp",
        "platform_shared_number": settings.WHATSAPP_PLATFORM_NUMBER,
    }


@router.put("/{client_id}/whatsapp-config", summary="Save Tenant Dedicated WhatsApp Business Number Configuration")
async def save_tenant_whatsapp_config(
    client_id: str,
    payload: TenantWhatsAppConfigPayload,
    db: Session = Depends(get_db_session),
    _admin: dict = Depends(require_admin_user),
) -> Dict[str, Any]:
    """
    Allows a SaaS user/client to configure their own dedicated WhatsApp Business number
    (Meta Cloud API or Twilio) or switch back to the Platform Shared Gateway.
    """
    client = db.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
    if not client:
        raise HTTPException(status_code=404, detail=f"Client '{client_id}' not found.")

    custom_cfg = dict(client.custom_config or {})
    existing_wa = dict(custom_cfg.get("whatsapp_config") or {})

    existing_wa["whatsapp_mode"] = payload.whatsapp_mode
    if payload.whatsapp_phone_number is not None:
        existing_wa["whatsapp_phone_number"] = payload.whatsapp_phone_number.strip()
    if payload.whatsapp_phone_number_id is not None:
        existing_wa["whatsapp_phone_number_id"] = payload.whatsapp_phone_number_id.strip()
    if payload.whatsapp_waba_id is not None:
        existing_wa["whatsapp_waba_id"] = payload.whatsapp_waba_id.strip()
    if payload.whatsapp_access_token and payload.whatsapp_access_token != "••••••••":
        existing_wa["whatsapp_access_token"] = payload.whatsapp_access_token.strip()
    if payload.twilio_account_sid is not None:
        existing_wa["twilio_account_sid"] = payload.twilio_account_sid.strip()
    if payload.twilio_auth_token and payload.twilio_auth_token != "••••••••":
        existing_wa["twilio_auth_token"] = payload.twilio_auth_token.strip()
    if payload.whatsapp_verify_token:
        existing_wa["whatsapp_verify_token"] = payload.whatsapp_verify_token.strip()
    elif not existing_wa.get("whatsapp_verify_token"):
        existing_wa["whatsapp_verify_token"] = f"s4_wa_verify_{client_id}"

    custom_cfg["whatsapp_config"] = existing_wa
    client.custom_config = custom_cfg
    flag_modified(client, "custom_config")

    # Re-sync agents so each agent inherits the updated WhatsApp mode and number
    synced = AgentCommsService.sync_client_agents_list(client)
    for ag in synced:
        ag["whatsapp_mode"] = existing_wa["whatsapp_mode"]
        if existing_wa.get("whatsapp_phone_number"):
            ag["whatsapp_phone_number"] = existing_wa["whatsapp_phone_number"]
        if existing_wa.get("whatsapp_phone_number_id"):
            ag["whatsapp_phone_number_id"] = existing_wa["whatsapp_phone_number_id"]
    client.agents = synced
    client.pipelines = synced
    flag_modified(client, "agents")
    flag_modified(client, "pipelines")
    client.updated_at = datetime.now(timezone.utc)

    db.add(client)
    db.commit()
    db.refresh(client)

    AuditService.log(
        client_id=client_id,
        action="WHATSAPP_CONFIG_UPDATED",
        details={
            "whatsapp_mode": existing_wa["whatsapp_mode"],
            "whatsapp_phone_number": existing_wa.get("whatsapp_phone_number"),
        },
    )

    return await get_tenant_whatsapp_config(client_id=client_id, db=db, _admin=_admin)


@router.get("/{client_id}/{agent_id}/messages", summary="Get Multi-Channel Conversation History for an Agent")
async def list_agent_messages(
    client_id: str,
    agent_id: str,
    channel: Optional[str] = Query(default=None, description="EMAIL, WHATSAPP, IN_APP, or ALL"),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db_session),
    _admin: dict = Depends(require_admin_user),
) -> Dict[str, Any]:
    """Returns chronological Email, WhatsApp, and In-App messages for a specific Agent (or ALL agents on a client)."""
    AgentCommsService.ensure_table(db)
    from app.api.v1.clients import get_client_id_aliases
    aliases = get_client_id_aliases(client_id) or [client_id]

    stmt = select(AgentMessage).where(AgentMessage.client_id.in_(aliases))
    if agent_id and agent_id.upper() != "ALL":
        stmt = stmt.where(AgentMessage.agent_id == agent_id)
    if channel and channel.upper() != "ALL":
        stmt = stmt.where(AgentMessage.channel == channel.upper())

    rows = db.exec(stmt.order_by(AgentMessage.id.asc()).limit(limit)).all()
    return {
        "client_id": client_id,
        "agent_id": agent_id,
        "total": len(rows),
        "count": len(rows),
        "messages": [r.model_dump() for r in rows],
    }


@router.post("/{client_id}/{agent_id}/message", summary="Send or Simulate a Message to an Agent via Email, WhatsApp, or In-App")
async def send_message_to_agent(
    client_id: str,
    agent_id: str,
    payload: DirectAgentMessagePayload,
    db: Session = Depends(get_db_session),
    admin: dict = Depends(require_admin_user),
) -> Dict[str, Any]:
    """
    Allows an accountant or user to communicate with a specific Agent via IN_APP, EMAIL, or WHATSAPP,
    triggering the Gemini AI Engine, learning any taught rules, and returning the AI response.
    """
    client = db.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
    if not client:
        raise HTTPException(status_code=404, detail=f"Client '{client_id}' not found.")

    agents = AgentCommsService.sync_client_agents_list(client)
    target_agent = next((a for a in agents if a.get("id") == agent_id), None)
    if not target_agent:
        if agents:
            target_agent = agents[0]
        else:
            target_agent = AgentCommsService.enrich_agent_metadata(
                client.id,
                {"id": agent_id or f"agent_{client.id}_ar", "name": "Primary Accounting Agent", "section": "AR"},
                client.custom_config,
            )

    ch = (payload.channel or "IN_APP").upper()
    sender = payload.sender_address or (
        admin.get("email", "accountant@service4gh.com")
        if ch in ("EMAIL", "IN_APP")
        else "+233240000000"
    )
    recipient = (
        str(target_agent.get("agent_email"))
        if ch == "EMAIL"
        else str(target_agent.get("whatsapp_phone_number") or settings.WHATSAPP_PLATFORM_NUMBER)
        if ch == "WHATSAPP"
        else str(target_agent.get("name"))
    )

    result = await AgentCommsService.process_inbound_agent_message(
        session=db,
        client=client,
        agent=target_agent,
        channel=ch,
        sender_address=sender,
        recipient_address=recipient,
        body_text=payload.message,
        subject=payload.subject,
        attachments=payload.attachments,
        send_external_reply=payload.send_external_reply,
    )
    return result
