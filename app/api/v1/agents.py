"""Autonomous Accounting Agents API, Multi-Tenant Email & WhatsApp Webhooks & Agent Comms Endpoints."""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlmodel import Session, select
from sqlalchemy.orm.attributes import flag_modified

from app.api.deps import (
    get_accessible_client_ids,
    require_admin_user,
    verify_client_access,
)
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


class ExecuteAgentGoalPayload(BaseModel):
    goal: str = Field(
        default="Run autonomous cycle: scan storage, apply learned knowledge rules, approve verified items, and check anomalies.",
        description="Natural-language objective or autonomous close directive",
    )
    month: Optional[str] = Field(default=None)
    year: Optional[int] = Field(default=None)
    autonomy_override: Optional[str] = Field(
        default=None,
        description="Optional override: copilot, semi_autonomous, full_autonomous",
    )
    explicit_human_command: bool = Field(
        default=True,
        description="Whether this goal represents an authorized accountant directive",
    )


class UpdateAgentAutonomyPayload(BaseModel):
    autonomy_level: Optional[str] = Field(
        default=None,
        description="copilot, semi_autonomous, or full_autonomous",
    )
    schedule_frequency: Optional[str] = Field(
        default=None,
        description="hourly, every_6_hours, daily_morning, daily_evening, weekly, monthly_cutoff, manual",
    )
    auto_approve_threshold: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    auto_apply_knowledge: Optional[bool] = Field(default=None)
    auto_query_anomalies: Optional[bool] = Field(default=None)
    proactive_SLA_reminders: Optional[bool] = Field(default=None)


class HeartbeatTriggerPayload(BaseModel):
    client_id: Optional[str] = Field(default=None)
    force: bool = Field(default=False)
    month: Optional[str] = Field(default=None)
    year: Optional[int] = Field(default=None)



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
    multipart_attachments: List[Dict[str, Any]] = []
    if "multipart" in ct or "form" in ct:
        form = await request.form()
        for k, v in form.items():
            if isinstance(v, (str, int, float)):
                raw_data[k] = v
            elif hasattr(v, "read"):
                try:
                    file_bytes = await v.read()
                    multipart_attachments.append({
                        "filename": getattr(v, "filename", None) or f"{k}.bin",
                        "content_type": getattr(v, "content_type", None) or "application/octet-stream",
                        "content_bytes": file_bytes,
                    })
                except Exception as att_err:
                    logger.warning(f"Failed reading multipart email attachment '{k}': {att_err}")
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
    attachments = list(raw_data.get("attachments")) if isinstance(raw_data.get("attachments"), list) else []
    attachments.extend(multipart_attachments)

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
    multipart_attachments: List[Dict[str, Any]] = []
    if "multipart" in ct or "form" in ct:
        form = await request.form()
        for k, v in form.items():
            if isinstance(v, (str, int, float)):
                raw_payload[k] = v
            elif hasattr(v, "read"):
                try:
                    file_bytes = await v.read()
                    multipart_attachments.append({
                        "filename": getattr(v, "filename", None) or f"{k}.bin",
                        "content_type": getattr(v, "content_type", None) or "application/octet-stream",
                        "content_bytes": file_bytes,
                    })
                except Exception as att_err:
                    logger.warning(f"Failed reading multipart WhatsApp attachment '{k}': {att_err}")
    else:
        try:
            raw_payload = await request.json()
        except Exception:
            raw_payload = {}

    parsed_messages = WhatsAppService.parse_inbound_webhook_payload(raw_payload)
    if not parsed_messages and multipart_attachments:
        parsed_messages = [{
            "from_phone": raw_payload.get("from_phone") or raw_payload.get("From") or "+233240000000",
            "to_phone": raw_payload.get("to_phone") or raw_payload.get("To"),
            "text": str(raw_payload.get("text") or raw_payload.get("Body") or ""),
            "client_id": client_id_hint or raw_payload.get("client_id"),
            "agent_id": raw_payload.get("agent_id"),
            "attachments": [],
        }]
    if not parsed_messages:
        return {"status": "IGNORED", "reason": "No actionable message events in webhook payload", "results": []}

    results: List[Dict[str, Any]] = []
    for idx_msg, item in enumerate(parsed_messages):
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

        msg_attachments = list(item.get("attachments") or [])
        if idx_msg == 0 and multipart_attachments:
            msg_attachments.extend(multipart_attachments)

        processed = await AgentCommsService.process_inbound_agent_message(
            session=db,
            client=client,
            agent=agent,
            channel="WHATSAPP",
            sender_address=normalize_phone(item.get("from_phone")) or "+233240000000",
            recipient_address=normalize_phone(item.get("to_phone")) or str(agent.get("whatsapp_phone_number") or settings.WHATSAPP_PLATFORM_NUMBER),
            body_text=item.get("text") or "",
            subject=None,
            attachments=msg_attachments,
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
    organization_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db_session),
    _admin: dict = Depends(require_admin_user),
) -> Dict[str, Any]:
    """Returns all configured agents across clients (or for a specific client) with communication & knowledge stats."""
    AgentCommsService.ensure_table(db)
    ClientKnowledgeService.ensure_table(db)

    stmt = select(ClientOrganization)
    if client_id and client_id.upper() != "ALL":
        verify_client_access(db, _admin, client_id, allow_missing_for_platform_admin=True)
        stmt = stmt.where(ClientOrganization.id == client_id)
    else:
        allowed_clients = get_accessible_client_ids(db, _admin, organization_id)
        if allowed_clients is not None:
            if not allowed_clients:
                return {"total_agents": 0, "agents": []}
            stmt = stmt.where(ClientOrganization.id.in_(sorted(allowed_clients)))
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


@router.post("/heartbeat", summary="Trigger Autonomous Multi-Frequency Agent Heartbeat & Watchdog Sweep")
async def trigger_agents_heartbeat(
    payload: Optional[HeartbeatTriggerPayload] = None,
    client_id: Optional[str] = Query(default=None),
    force: Optional[bool] = Query(default=None),
    db: Session = Depends(get_db_session),
    _admin: dict = Depends(require_admin_user),
) -> Dict[str, Any]:
    """
    Evaluates all active autonomous agents across clients (or for a single client)
    against their configured schedule_frequency, executes due ReAct autonomous cycles,
    and checks SLA clarification timeouts.
    """
    from app.services.agentic_brain_service import AgenticBrainService

    eff_client = client_id or (payload.client_id if payload else None)
    allowed_clients = None
    if eff_client:
        verify_client_access(db, _admin, eff_client, allow_missing_for_platform_admin=True)
    else:
        allowed_clients = get_accessible_client_ids(db, _admin)

    eff_force = bool(force if force is not None else (payload.force if payload else False))
    eff_month = payload.month if payload else None
    eff_year = payload.year if payload else None

    return await AgenticBrainService.run_due_agents_heartbeat(
        db=db,
        client_id=eff_client,
        force=eff_force,
        month=eff_month,
        year=eff_year,
        allowed_client_ids=allowed_clients,
    )


@router.get("/{client_id}/whatsapp-config", summary="Get Tenant WhatsApp Business Number Configuration")
async def get_tenant_whatsapp_config(
    client_id: str,
    db: Session = Depends(get_db_session),
    _admin: dict = Depends(require_admin_user),
) -> Dict[str, Any]:
    """Returns the client's WhatsApp Business communication configuration and copyable webhook URLs."""
    client = verify_client_access(db, _admin, client_id)

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
    client = verify_client_access(db, _admin, client_id)

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
    verify_client_access(db, _admin, client_id, allow_missing_for_platform_admin=True)
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
    client = verify_client_access(db, admin, client_id)

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


@router.post("/{client_id}/{agent_id}/execute-goal", summary="Execute Natural-Language Goal or Autonomous ReAct Cycle")
async def execute_agent_goal(
    client_id: str,
    agent_id: str,
    payload: ExecuteAgentGoalPayload,
    db: Session = Depends(get_db_session),
    admin: dict = Depends(require_admin_user),
) -> Dict[str, Any]:
    """
    Runs the true agentic ReAct loop (Perceive -> Plan -> Act -> Verify -> Learn)
    for any natural-language goal or autonomous close cycle on the specified agent.
    """
    from app.services.agentic_brain_service import AUTONOMY_LEVELS, AgenticBrainService

    if payload.autonomy_override and payload.autonomy_override not in AUTONOMY_LEVELS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid autonomy_override '{payload.autonomy_override}'. Allowed: {', '.join(AUTONOMY_LEVELS)}",
        )

    verify_client_access(db, admin, client_id, allow_missing_for_platform_admin=True)
    client, agent = AgenticBrainService.resolve_client_and_agent(db, client_id=client_id, agent_id=agent_id)
    if not client or not agent:
        raise HTTPException(status_code=404, detail=f"Client '{client_id}' or agent '{agent_id}' not found.")
    verify_client_access(db, admin, client.id)

    run_data = await AgenticBrainService.plan_and_execute_goal(
        db=db,
        client=client,
        agent=agent,
        goal=payload.goal,
        trigger_type="MANUAL_UI",
        trigger_source=admin.get("email", "accountant@service4gh.com"),
        month=payload.month,
        year=payload.year,
        autonomy_override=payload.autonomy_override,
        explicit_human_command=payload.explicit_human_command,
    )
    return {"success": True, "run": run_data}


@router.get("/{client_id}/{agent_id}/runs", summary="List Agent Reasoning & Autonomous Execution Runs")
async def list_agent_runs(
    client_id: str,
    agent_id: str,
    limit: int = Query(default=30, ge=1, le=200),
    db: Session = Depends(get_db_session),
    _admin: dict = Depends(require_admin_user),
) -> Dict[str, Any]:
    """Returns historical ReAct reasoning traces and tool execution telemetry for an agent."""
    from app.services.agentic_brain_service import AgenticBrainService

    verify_client_access(db, _admin, client_id, allow_missing_for_platform_admin=True)
    runs = AgenticBrainService.list_runs(db=db, client_id=client_id, agent_id=agent_id, limit=limit)
    return {
        "client_id": client_id,
        "agent_id": agent_id,
        "count": len(runs),
        "runs": runs,
    }


@router.patch("/{client_id}/{agent_id}/autonomy", summary="Update Agent Autonomy Level & Watchdog Policies")
async def update_agent_autonomy_policy(
    client_id: str,
    agent_id: str,
    payload: UpdateAgentAutonomyPayload,
    db: Session = Depends(get_db_session),
    admin: dict = Depends(require_admin_user),
) -> Dict[str, Any]:
    """Updates an autonomous agent's autonomy_level, schedule_frequency, approval thresholds, and reactive settings."""
    from app.services.agentic_brain_service import AUTONOMY_LEVELS, AgenticBrainService

    if payload.autonomy_level is not None and payload.autonomy_level not in AUTONOMY_LEVELS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid autonomy_level '{payload.autonomy_level}'. Allowed: {', '.join(AUTONOMY_LEVELS)}",
        )

    verify_client_access(db, admin, client_id, allow_missing_for_platform_admin=True)
    client, existing_agent = AgenticBrainService.resolve_client_and_agent(db, client_id=client_id, agent_id=agent_id)
    if not client:
        raise HTTPException(status_code=404, detail=f"Client '{client_id}' not found.")
    verify_client_access(db, admin, client.id)

    agents_list = AgentCommsService.sync_client_agents_list(client)
    updated_agent = None
    for idx, ag in enumerate(agents_list):
        if str(ag.get("id")) == str(agent_id):
            ag_copy = dict(ag)
            if payload.autonomy_level is not None:
                ag_copy["autonomy_level"] = payload.autonomy_level
            if payload.schedule_frequency is not None:
                ag_copy["schedule_frequency"] = payload.schedule_frequency
            if payload.auto_approve_threshold is not None:
                ag_copy["auto_approve_threshold"] = float(payload.auto_approve_threshold)
            if payload.auto_apply_knowledge is not None:
                ag_copy["auto_apply_knowledge"] = payload.auto_apply_knowledge
            if payload.auto_query_anomalies is not None:
                ag_copy["auto_query_anomalies"] = payload.auto_query_anomalies
            if payload.proactive_SLA_reminders is not None:
                ag_copy["proactive_SLA_reminders"] = payload.proactive_SLA_reminders
            updated_agent = AgentCommsService.enrich_agent_metadata(client.id, ag_copy, client.custom_config)
            agents_list[idx] = updated_agent
            break

    if updated_agent is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found on client '{client_id}'.")

    client.agents = agents_list
    client.pipelines = agents_list
    client.updated_at = datetime.now(timezone.utc)
    flag_modified(client, "agents")
    flag_modified(client, "pipelines")
    db.add(client)
    db.commit()

    AuditService.log(
        client_id=client.id,
        action="AGENT_AUTONOMY_POLICY_UPDATED",
        actor_email=admin.get("email", "admin"),
        details={
            "agent_id": agent_id,
            "autonomy_level": updated_agent.get("autonomy_level"),
            "schedule_frequency": updated_agent.get("schedule_frequency"),
            "auto_approve_threshold": updated_agent.get("auto_approve_threshold"),
        },
    )

    return {"success": True, "agent": updated_agent}

