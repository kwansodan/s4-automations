"""Autonomous Accounting Agent Communication & AI Response Engine (Email, WhatsApp & In-App)."""

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from sqlmodel import Session, select
from sqlalchemy.orm.attributes import flag_modified

from app.config import settings
from app.models.db_models import (
    AgentMessage,
    BankTransaction,
    ClientContact,
    ClientKnowledgeEntry,
    ClientOrganization,
    FirmTeamMember,
    StagedTransaction,
)
from app.services.client_knowledge_service import ClientKnowledgeService
from app.services.mailjet_service import MailjetService
from app.services.whatsapp_service import WhatsAppService, normalize_phone
from app.utils.logging import get_logger

logger = get_logger("agent_comms")


def slugify_token(text: str) -> str:
    """Converts an arbitrary string into a clean lowercase alphanumeric/underscore slug."""
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", (text or "").strip().lower()).strip("_")
    return cleaned or "agent"


class AgentCommsService:
    """
    Coordinates multi-channel communication (Dedicated Email, Multi-Tenant WhatsApp, and In-App)
    with client-specific Autonomous Accounting Agents powered by the Gemini AI Engine.
    """

    @staticmethod
    def ensure_table(session: Session) -> None:
        """Ensures the agent_messages table exists in SQLite/PostgreSQL."""
        try:
            engine = session.get_bind()
            AgentMessage.__table__.create(engine, checkfirst=True)
        except Exception as e:
            logger.debug(f"ensure_table notice for agent_messages: {e}")

    @classmethod
    def format_default_agent_email(cls, client_id: str, agent_id: str, agent_name: str, section: str = "AR") -> str:
        """Generates a deterministic, human-friendly dedicated email address for an agent instance."""
        domain = settings.AGENT_EMAIL_DOMAIN or "agents.service4gh.com"
        c_slug = slugify_token(client_id).replace("_", "-")
        name_slug = slugify_token(agent_name)
        if name_slug.startswith(slugify_token(client_id)):
            name_slug = name_slug[len(slugify_token(client_id)):].strip("_")
        if not name_slug or len(name_slug) > 28:
            short_id = re.sub(r"^(?:pipe_|agent_)", "", slugify_token(agent_id))
            name_slug = short_id or slugify_token(section)
        name_slug = name_slug.replace("_", "-")
        return f"{c_slug}.{name_slug}@{domain}"

    @classmethod
    def format_whatsapp_routing_tag(cls, client_id: str, agent_id: str, section: str = "AR") -> str:
        """Generates a concise WhatsApp routing handle for an agent (e.g. '@anr_group.ar_slips')."""
        c_slug = slugify_token(client_id)
        short_id = re.sub(r"^(?:pipe_|agent_)", "", slugify_token(agent_id))
        if short_id.startswith(c_slug):
            short_id = short_id[len(c_slug):].strip("_")
        if not short_id:
            short_id = slugify_token(section)
        return f"@{c_slug}.{short_id}"

    @classmethod
    def enrich_agent_metadata(
        cls,
        client_id: str,
        agent_data: Dict[str, Any],
        client_custom_config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Ensures an agent (pipeline) dictionary has complete Agent Identity & Multi-Channel fields:
          - id, name, section, entity_type
          - agent_email (dedicated email address per agent instance)
          - whatsapp_enabled, whatsapp_mode ('platform_shared' | 'dedicated_meta' | 'dedicated_twilio')
          - whatsapp_phone_number, whatsapp_phone_number_id, whatsapp_routing_tag
          - whatsapp_webhook_url (dedicated SaaS tenant webhook URL)
        """
        enriched = dict(agent_data or {})
        agent_id = str(enriched.get("id") or f"agent_{int(datetime.now(timezone.utc).timestamp())}")
        enriched["id"] = agent_id
        section = str(enriched.get("section") or enriched.get("pipeline_type") or "AR").upper()
        enriched["section"] = section
        agent_name = str(enriched.get("name") or f"{section} Accounting Agent")
        enriched["name"] = agent_name

        if not enriched.get("agent_email"):
            enriched["agent_email"] = cls.format_default_agent_email(client_id, agent_id, agent_name, section)

        if enriched.get("whatsapp_enabled") is None:
            enriched["whatsapp_enabled"] = True

        custom_cfg = client_custom_config or {}
        tenant_wa_cfg = custom_cfg.get("whatsapp_config") or {}
        wa_mode = (
            enriched.get("whatsapp_mode")
            or tenant_wa_cfg.get("whatsapp_mode")
            or ("dedicated_meta" if tenant_wa_cfg.get("whatsapp_phone_number") else "platform_shared")
        )
        enriched["whatsapp_mode"] = wa_mode
        enriched["whatsapp_phone_number"] = (
            enriched.get("whatsapp_phone_number")
            or tenant_wa_cfg.get("whatsapp_phone_number")
            or settings.WHATSAPP_PLATFORM_NUMBER
        )
        if tenant_wa_cfg.get("whatsapp_phone_number_id") and not enriched.get("whatsapp_phone_number_id"):
            enriched["whatsapp_phone_number_id"] = tenant_wa_cfg.get("whatsapp_phone_number_id")

        if not enriched.get("whatsapp_routing_tag"):
            enriched["whatsapp_routing_tag"] = cls.format_whatsapp_routing_tag(client_id, agent_id, section)

        base_url = (settings.APP_BASE_URL or "https://aut.service4gh.com").rstrip("/")
        enriched["whatsapp_webhook_url"] = f"{base_url}/api/v1/agents/webhooks/whatsapp/{client_id}"
        enriched["email_webhook_url"] = f"{base_url}/api/v1/agents/webhooks/email"
        return enriched

    @classmethod
    def sync_client_agents_list(cls, client: ClientOrganization) -> List[Dict[str, Any]]:
        """
        Synchronizes `client.agents` and `client.pipelines`, enriching every agent instance
        with its dedicated email address and WhatsApp configuration.
        """
        raw_list = list(client.agents or client.pipelines or [])
        enriched_list = [
            cls.enrich_agent_metadata(client.id, item, client.custom_config)
            for item in raw_list
            if isinstance(item, dict)
        ]
        client.agents = enriched_list
        client.pipelines = enriched_list
        return enriched_list

    @classmethod
    def resolve_agent_by_email(
        cls,
        session: Session,
        recipient_email: str,
        subject: Optional[str] = None,
        body_text: Optional[str] = None,
        client_id_hint: Optional[str] = None,
        agent_id_hint: Optional[str] = None,
    ) -> Tuple[ClientOrganization, Dict[str, Any]]:
        """
        Resolves a target (ClientOrganization, agent_dict) from an inbound email address
        (e.g. 'anr-group.daily-slips@agents.service4gh.com' or 'bills@anrgroup.com').
        """
        clients = session.exec(select(ClientOrganization)).all()
        if not clients:
            raise ValueError("No client organizations registered.")

        clean_to = (recipient_email or "").strip().lower()
        # Extract email inside angle brackets if formatted as "Name <addr@domain>"
        m_angle = re.search(r"<([^>]+)>", clean_to)
        if m_angle:
            clean_to = m_angle.group(1).strip().lower()

        # 0. Explicit hints if provided
        if client_id_hint:
            for c in clients:
                if c.id == client_id_hint:
                    agents = cls.sync_client_agents_list(c)
                    if agent_id_hint:
                        for ag in agents:
                            if ag.get("id") == agent_id_hint:
                                return c, ag
                    if agents:
                        return c, agents[0]

        # 1. Exact match on agent_email or source_identifier across all clients
        for c in clients:
            agents = cls.sync_client_agents_list(c)
            for ag in agents:
                ag_email = str(ag.get("agent_email") or "").strip().lower()
                src_id = str(ag.get("source_identifier") or "").strip().lower()
                if clean_to and clean_to in (ag_email, src_id):
                    return c, ag

        # 2. Local-part prefix matching: e.g. "{client_slug}.{agent_slug}@..."
        local_part = clean_to.split("@")[0] if "@" in clean_to else clean_to
        if "." in local_part:
            prefix_client, prefix_agent = local_part.split(".", 1)
            norm_c = slugify_token(prefix_client)
            norm_a = slugify_token(prefix_agent)
            for c in clients:
                if slugify_token(c.id) == norm_c or norm_c in slugify_token(c.id):
                    agents = cls.sync_client_agents_list(c)
                    for ag in agents:
                        if (
                            norm_a in slugify_token(ag.get("id", ""))
                            or norm_a in slugify_token(ag.get("name", ""))
                            or norm_a == slugify_token(ag.get("section", ""))
                        ):
                            return c, ag
                    if agents:
                        return c, agents[0]

        # 3. Match client.source_email or client_id in recipient address
        for c in clients:
            if (c.source_email and c.source_email.strip().lower() == clean_to) or (
                slugify_token(c.id) in slugify_token(local_part)
            ):
                agents = cls.sync_client_agents_list(c)
                if agents:
                    return c, agents[0]

        # 4. Fallback to first client with an active agent
        primary_client = clients[0]
        agents = cls.sync_client_agents_list(primary_client)
        if not agents:
            default_ag = cls.enrich_agent_metadata(
                primary_client.id,
                {"id": f"agent_{primary_client.id}_ar", "name": "Primary Accounting Agent", "section": "AR"},
                primary_client.custom_config,
            )
            return primary_client, default_ag
        return primary_client, agents[0]

    @classmethod
    def resolve_agent_by_whatsapp(
        cls,
        session: Session,
        sender_phone: str,
        recipient_phone_or_id: Optional[str],
        message_text: str,
        client_id_hint: Optional[str] = None,
        agent_id_hint: Optional[str] = None,
    ) -> Tuple[ClientOrganization, Dict[str, Any]]:
        """
        Resolves a target (ClientOrganization, agent_dict) for an inbound WhatsApp message:
          1. Explicit client_id_hint / agent_id_hint (from per-tenant webhook URL).
          2. Dedicated Tenant WhatsApp Business Number match (matching recipient phone_number_id or phone number).
          3. @routing_tag prefix in message_text (e.g. '@anr_group.daily_slips').
          4. Sender phone match against ClientContact or FirmTeamMember or recent AgentMessage history.
        """
        clients = session.exec(select(ClientOrganization)).all()
        if not clients:
            raise ValueError("No client organizations registered.")

        clean_sender = normalize_phone(sender_phone)
        clean_recipient = normalize_phone(recipient_phone_or_id)
        raw_recipient_id = str(recipient_phone_or_id or "").strip()
        text_low = (message_text or "").strip().lower()

        def pick_agent_for_client(c: ClientOrganization, ag_hint: Optional[str] = None) -> Dict[str, Any]:
            agents = cls.sync_client_agents_list(c)
            if ag_hint:
                for ag in agents:
                    if (
                        ag.get("id") == ag_hint
                        or slugify_token(ag.get("section", "")) == slugify_token(ag_hint)
                        or slugify_token(ag_hint) in slugify_token(ag.get("name", ""))
                    ):
                        return ag
            # Also check if message text mentions AR, AP, or Bank
            for ag in agents:
                sec = str(ag.get("section") or "").upper()
                if sec == "BANK" and any(k in text_low for k in ["bank", "momo", "reconcil", "debit", "statement"]):
                    return ag
                if sec == "AP" and any(k in text_low for k in ["vendor", "bill", "payable", "supplier", "expense"]):
                    return ag
                if sec == "AR" and any(k in text_low for k in ["invoice", "customer", "slip", "receivable", "laundry"]):
                    return ag
            if agents:
                return agents[0]
            return cls.enrich_agent_metadata(
                c.id,
                {"id": f"agent_{c.id}_ar", "name": "Primary Accounting Agent", "section": "AR"},
                c.custom_config,
            )

        # 1. Explicit client_id_hint (e.g. from /api/v1/agents/webhooks/whatsapp/{client_id})
        if client_id_hint:
            for c in clients:
                if c.id == client_id_hint:
                    return c, pick_agent_for_client(c, agent_id_hint)

        # 2. Match @routing_tag in message text (e.g. "@anr_group.daily_slips ...")
        tag_match = re.search(r"@([a-zA-Z0-9_\-]+(?:\.[a-zA-Z0-9_\-]+)?)", message_text or "")
        if tag_match:
            tag_val = tag_match.group(0).lower()
            tag_body = tag_match.group(1).lower()
            for c in clients:
                agents = cls.sync_client_agents_list(c)
                for ag in agents:
                    r_tag = str(ag.get("whatsapp_routing_tag") or "").lower()
                    if r_tag == tag_val or slugify_token(ag.get("id", "")) == slugify_token(tag_body):
                        return c, ag
                if slugify_token(c.id) in slugify_token(tag_body):
                    part_after = tag_body.split(".", 1)[1] if "." in tag_body else None
                    return c, pick_agent_for_client(c, part_after)

        # 3. Dedicated Tenant WhatsApp Business Number match (SaaS BYOWN mode)
        if raw_recipient_id or clean_recipient:
            for c in clients:
                custom_cfg = c.custom_config or {}
                wa_cfg = custom_cfg.get("whatsapp_config") or {}
                cfg_phone = normalize_phone(wa_cfg.get("whatsapp_phone_number"))
                cfg_pid = str(wa_cfg.get("whatsapp_phone_number_id") or "").strip()

                agents = cls.sync_client_agents_list(c)
                for ag in agents:
                    ag_phone = normalize_phone(ag.get("whatsapp_phone_number"))
                    ag_pid = str(ag.get("whatsapp_phone_number_id") or "").strip()
                    if ag.get("whatsapp_mode") in ("dedicated_meta", "dedicated_twilio"):
                        if (ag_pid and ag_pid == raw_recipient_id) or (
                            ag_phone and clean_recipient and ag_phone == clean_recipient
                        ):
                            return c, ag

                if (cfg_pid and cfg_pid == raw_recipient_id) or (
                    cfg_phone and clean_recipient and cfg_phone == clean_recipient
                ):
                    return c, pick_agent_for_client(c, agent_id_hint)

        # 4. Match sender_phone against ClientContact or recent conversation history
        if clean_sender:
            contacts = session.exec(select(ClientContact)).all()
            for ct in contacts:
                if normalize_phone(ct.phone) == clean_sender:
                    for c in clients:
                        if c.id == ct.client_id:
                            return c, pick_agent_for_client(c, agent_id_hint)

            cls.ensure_table(session)
            last_msg = session.exec(
                select(AgentMessage)
                .where(AgentMessage.channel == "WHATSAPP")
                .where(AgentMessage.sender_address == clean_sender)
                .order_by(AgentMessage.id.desc())
            ).first()
            if last_msg:
                for c in clients:
                    if c.id == last_msg.client_id:
                        return c, pick_agent_for_client(c, last_msg.agent_id)

        # 5. Default fallback
        primary_client = clients[0]
        return primary_client, pick_agent_for_client(primary_client, agent_id_hint)

    @classmethod
    async def process_inbound_agent_message(
        cls,
        session: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        channel: str,
        sender_address: str,
        recipient_address: str,
        body_text: str,
        subject: Optional[str] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
        send_external_reply: bool = True,
    ) -> Dict[str, Any]:
        """
        Processes an inbound message (Email, WhatsApp, or In-App) directed to a specific Agent:
          1. Records the inbound AgentMessage.
          2. Extracts & persists any new client-specific knowledge rules if the message teaches the agent.
          3. Resolves/updates any matching open clarification request if the sender is answering a query.
          4. Assembles live financial context (AR/AP/Bank transactions + client knowledge base).
          5. Generates an intelligent response via Gemini AI (with rich data-grounded fallback).
          6. Dispatches the reply via Email or WhatsApp and records the outbound AgentMessage.
        """
        cls.ensure_table(session)
        ClientKnowledgeService.ensure_table(session)

        norm_channel = (channel or "IN_APP").upper()
        agent_id = str(agent.get("id") or "agent_default")
        agent_name = str(agent.get("name") or "Accounting Agent")
        section = str(agent.get("section") or "AR").upper()
        clean_body = re.sub(r"^@[a-zA-Z0-9_\-.]+\s*", "", (body_text or "").strip()).strip()
        if not clean_body:
            clean_body = (body_text or "Status inquiry").strip()

        # 1. Persist Inbound Message
        inbound_msg = AgentMessage(
            client_id=client.id,
            agent_id=agent_id,
            agent_name=agent_name,
            channel=norm_channel,
            direction="INBOUND",
            sender_address=sender_address,
            recipient_address=recipient_address,
            subject=subject,
            body_text=body_text or clean_body,
            attachments=attachments or [],
            ai_metadata={"section": section},
        )
        session.add(inbound_msg)
        session.commit()
        session.refresh(inbound_msg)

        # 2. Check for Conversational Teaching / Knowledge Instructions
        learned_entries: List[ClientKnowledgeEntry] = []
        if cls._looks_like_teaching_instruction(clean_body, subject):
            teach_source = (
                "EMAIL_TEACHING"
                if norm_channel == "EMAIL"
                else "WHATSAPP_TEACHING"
                if norm_channel == "WHATSAPP"
                else "MANUAL_UI"
            )
            learned_entries = await ClientKnowledgeService.teach_from_natural_language(
                session=session,
                client_id=client.id,
                raw_text=clean_body,
                agent_id=agent_id,
                section=section,
                source=teach_source,
                actor=sender_address,
            )

        # 3. Check if sender is answering an open Information Request
        clarification_updated = cls._try_match_and_update_open_query(
            session=session,
            client_id=client.id,
            sender_address=sender_address,
            body_text=clean_body,
            attachments=attachments or [],
        )

        # 4. Assemble Live Ledger Context + Client Knowledge Prompt
        ledger_context = cls._gather_live_agent_context(session, client, agent)
        knowledge_prompt = ClientKnowledgeService.build_agent_knowledge_prompt(
            session=session,
            client_id=client.id,
            agent_id=agent_id,
            section=section,
            record_usage=True,
        )

        # 5. Generate AI Response
        reply_text = await cls._generate_ai_agent_reply(
            client=client,
            agent=agent,
            channel=norm_channel,
            sender_address=sender_address,
            subject=subject,
            user_message=clean_body,
            ledger_context=ledger_context,
            knowledge_prompt=knowledge_prompt,
            learned_entries=learned_entries,
            clarification_updated=clarification_updated,
        )

        # 6. Dispatch External Reply (Email or WhatsApp) if requested
        delivery_info: Dict[str, Any] = {"dispatched": False, "channel": norm_channel}
        reply_subject = f"Re: {subject}" if subject and not subject.lower().startswith("re:") else (
            subject or f"[{agent_name}] Update for {client.name}"
        )

        if send_external_reply:
            if norm_channel == "EMAIL" and "@" in sender_address:
                html_reply = cls._format_email_reply_html(
                    client_name=client.name,
                    agent_name=agent_name,
                    agent_email=str(agent.get("agent_email") or recipient_address),
                    reply_text=reply_text,
                    learned_entries=learned_entries,
                )
                sent_ok = await MailjetService.send_email(
                    to_email=sender_address,
                    subject=reply_subject,
                    html_content=html_reply,
                    text_content=reply_text,
                )
                delivery_info = {"dispatched": sent_ok, "channel": "EMAIL", "to": sender_address}
            elif norm_channel == "WHATSAPP":
                custom_cfg = client.custom_config or {}
                wa_cfg = dict(custom_cfg.get("whatsapp_config") or {})
                if agent.get("whatsapp_mode"):
                    wa_cfg["whatsapp_mode"] = agent.get("whatsapp_mode")
                if agent.get("whatsapp_phone_number"):
                    wa_cfg["whatsapp_phone_number"] = agent.get("whatsapp_phone_number")
                if agent.get("whatsapp_phone_number_id"):
                    wa_cfg["whatsapp_phone_number_id"] = agent.get("whatsapp_phone_number_id")
                wa_res = await WhatsAppService.send_message(
                    to_phone=sender_address,
                    message_text=reply_text,
                    tenant_whatsapp_config=wa_cfg,
                )
                delivery_info = {"dispatched": wa_res.get("delivered", True), "channel": "WHATSAPP", **wa_res}

        # 7. Persist Outbound AI Message
        outbound_msg = AgentMessage(
            client_id=client.id,
            agent_id=agent_id,
            agent_name=agent_name,
            channel=norm_channel,
            direction="OUTBOUND",
            sender_address=recipient_address,
            recipient_address=sender_address,
            subject=reply_subject if norm_channel == "EMAIL" else None,
            body_text=reply_text,
            attachments=[],
            ai_metadata={
                "section": section,
                "learned_knowledge_ids": [e.id for e in learned_entries if e.id is not None],
                "learned_knowledge_titles": [e.title for e in learned_entries],
                "clarification_updated": clarification_updated,
                "delivery": delivery_info,
                "ledger_snapshot": {
                    "total_items": ledger_context.get("total_items", 0),
                    "pending_count": ledger_context.get("pending_count", 0),
                    "total_amount_ghs": ledger_context.get("total_amount_ghs", 0.0),
                },
            },
        )
        session.add(outbound_msg)
        session.commit()
        session.refresh(outbound_msg)

        learned_dumped = [e.model_dump() for e in learned_entries]
        return {
            "client_id": client.id,
            "client_name": client.name,
            "agent_id": agent_id,
            "agent_name": agent_name,
            "agent_email": agent.get("agent_email"),
            "channel": norm_channel,
            "inbound_message": inbound_msg.model_dump(),
            "outbound_message": outbound_msg.model_dump(),
            "reply_text": reply_text,
            "learned_knowledge": learned_dumped,
            "learned_rules": learned_dumped,
            "clarification_updated": clarification_updated,
            "delivery": delivery_info,
        }

    @staticmethod
    def _looks_like_teaching_instruction(body_text: str, subject: Optional[str] = None) -> bool:
        """Detects whether a message contains a rule, alias, or instruction meant to teach the agent."""
        combined = f"{subject or ''} {body_text or ''}".lower()
        teaching_keywords = [
            "remember",
            "always map",
            "always categorize",
            "always use",
            "whenever",
            "from now on",
            "rule:",
            "teach:",
            "note that",
            "shorthand",
            "refers to",
            "maps to",
            "categorize ",
            "map all ",
            "map ",
            "price ",
            "treat ",
            "alias",
            "rate for ",
            "price for ",
        ]
        return any(kw in combined for kw in teaching_keywords)

    @staticmethod
    def _try_match_and_update_open_query(
        session: Session,
        client_id: str,
        sender_address: str,
        body_text: str,
        attachments: List[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        """
        If the sender has an active CLARIFICATION_REQUESTED transaction on this client and
        their message explains it, records the response on the transaction.
        """
        from app.api.v1.clients import get_client_id_aliases
        aliases = get_client_id_aliases(client_id) or [client_id]
        clean_sender = (sender_address or "").strip().lower()
        if not clean_sender or len(body_text.strip()) < 4:
            return None

        # Check BankTransaction with CLARIFICATION_REQUESTED where recipient_email matches or mentioned in text
        bank_txs = session.exec(
            select(BankTransaction)
            .where(BankTransaction.client_id.in_(aliases))
            .where(BankTransaction.status == "CLARIFICATION_REQUESTED")
            .order_by(BankTransaction.transaction_date.desc())
        ).all()

        now_utc = datetime.now(timezone.utc)
        now_iso = now_utc.isoformat()

        for tx in bank_txs:
            meta = dict(tx.metadata_json or {})
            rec_email = str(meta.get("recipient_email") or "").strip().lower()
            desc_words = [w.lower() for w in re.findall(r"[a-zA-Z]{4,}", tx.description or "")]
            mentioned = any(w in body_text.lower() for w in desc_words[:3]) if desc_words else False
            if (rec_email and rec_email == clean_sender) or mentioned:
                tx.client_explanation = body_text
                if attachments:
                    tx.client_attachments = attachments
                tx.status = "CLIENT_ANSWERED"
                tx.response_date = now_utc
                tx.updated_at = now_utc
                history = list(meta.get("query_history") or [])
                history.append({
                    "sender": "client",
                    "text": body_text,
                    "timestamp": now_iso,
                    "attachments": attachments,
                })
                meta["query_history"] = history
                meta["query_status"] = "CLIENT_ANSWERED"
                tx.metadata_json = meta
                flag_modified(tx, "metadata_json")
                session.add(tx)
                session.commit()
                return {"item_key": f"BANK:{tx.id}", "description": tx.description, "amount": tx.amount}

        return None

    @classmethod
    def _gather_live_agent_context(
        cls,
        session: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Gathers live transaction statistics and recent items for this client and agent."""
        from app.api.v1.clients import get_client_id_aliases
        aliases = get_client_id_aliases(client.id) or [client.id]
        section = str(agent.get("section") or "AR").upper()

        if section == "BANK":
            txs = session.exec(
                select(BankTransaction)
                .where(BankTransaction.client_id.in_(aliases))
                .order_by(BankTransaction.transaction_date.desc())
            ).all()
            unmapped = [t for t in txs if t.status == "UNMAPPED"]
            queried = [t for t in txs if t.status == "CLARIFICATION_REQUESTED"]
            answered = [t for t in txs if t.status == "CLIENT_ANSWERED"]
            mapped = [t for t in txs if t.status in ("MAPPED", "POSTED")]
            total_amt = round(sum(float(t.amount or 0.0) for t in txs), 2)
            sample_lines = [
                f"{t.transaction_date}: {t.description} | GHS {float(t.amount or 0.0):,.2f} ({t.transaction_type}) | Account: {t.bank_account_name or 'Bank'} | Status: {t.status}"
                for t in txs[:12]
            ]
            return {
                "section": "BANK",
                "total_items": len(txs),
                "pending_count": len(unmapped) + len(queried),
                "unmapped_count": len(unmapped),
                "awaiting_client_count": len(queried),
                "client_answered_count": len(answered),
                "approved_or_mapped_count": len(mapped),
                "total_amount_ghs": total_amt,
                "sample_transactions": sample_lines,
            }

        # AR, AP, or GL StagedTransaction rows
        staged = session.exec(
            select(StagedTransaction)
            .where(StagedTransaction.client_id.in_(aliases))
            .where(StagedTransaction.pipeline_type == section)
            .order_by(StagedTransaction.transaction_date.desc(), StagedTransaction.id.desc())
        ).all()
        pending = [s for s in staged if not s.approved and s.status not in ("APPROVED", "INVOICED", "BILLED")]
        approved = [s for s in staged if s.approved or s.status in ("APPROVED", "INVOICED", "BILLED")]
        discrepancies = [s for s in staged if float(s.discrepancy_amount or 0.0) > 0]
        queried = [
            s for s in staged
            if str((s.metadata_json or {}).get("query_status") or "").upper() in ("CLARIFICATION_REQUESTED", "CLIENT_ANSWERED")
        ]
        total_amt = round(sum(float(s.total_amount or 0.0) for s in staged), 2)
        party_label = "Vendor" if section == "AP" else "Customer"
        sample_lines = []
        for s in staged[:12]:
            meta = s.metadata_json or {}
            party = meta.get("vendor_name") if section == "AP" else (meta.get("customer_name") or meta.get("reconciled_customer_name") or s.source_file_name)
            sample_lines.append(
                f"{s.transaction_date}: {s.item_or_description} | {party_label}: {party} | GHS {float(s.total_amount or 0.0):,.2f} | Status: {s.status}"
            )

        return {
            "section": section,
            "total_items": len(staged),
            "pending_count": len(pending),
            "approved_or_mapped_count": len(approved),
            "discrepancy_count": len(discrepancies),
            "active_queries_count": len(queried),
            "total_amount_ghs": total_amt,
            "sample_transactions": sample_lines,
        }

    @classmethod
    async def _generate_ai_agent_reply(
        cls,
        client: ClientOrganization,
        agent: Dict[str, Any],
        channel: str,
        sender_address: str,
        subject: Optional[str],
        user_message: str,
        ledger_context: Dict[str, Any],
        knowledge_prompt: str,
        learned_entries: List[ClientKnowledgeEntry],
        clarification_updated: Optional[Dict[str, Any]],
    ) -> str:
        """
        Generates a response from the autonomous accounting agent using the Gemini AI Engine,
        with a deterministic data-grounded fallback when running offline or in test mode.
        """
        agent_name = str(agent.get("name") or "Accounting Agent")
        section = str(agent.get("section") or "AR").upper()
        sample_tx_block = "\n".join(f"- {ln}" for ln in ledger_context.get("sample_transactions", [])) or "- No transactions staged yet."
        learned_block = (
            "\n".join(f"- [{e.category}] {e.title}: {e.rule_content}" for e in learned_entries)
            if learned_entries
            else "None in this message."
        )

        system_prompt = f"""
You are "{agent_name}", an autonomous AI Accounting Agent for client "{client.name}" ({client.industry}) running on S4 Automations.
Your specialization section is: {section} ({agent.get('entity_type', section)}).
Your dedicated agent email is: {agent.get('agent_email')}.
Communication Channel: {channel}.
Sender: {sender_address}.

### Live Ledger Summary for {client.name} ({section}):
- Total Transactions Tracked: {ledger_context.get('total_items', 0)}
- Total Value: GHS {ledger_context.get('total_amount_ghs', 0.0):,.2f}
- Pending Review / Unmapped: {ledger_context.get('pending_count', 0)}
- Approved / Categorized: {ledger_context.get('approved_or_mapped_count', 0)}
- Flagged Discrepancies: {ledger_context.get('discrepancy_count', 0)}

### Recent Transactions in {section} Queue:
{sample_tx_block}

{knowledge_prompt or '### Client-Specific Knowledge Base: No custom rules stored yet.'}

### Newly Learned Knowledge from This Message:
{learned_block}

### Instructions:
1. Respond directly, accurately, and professionally as {agent_name} for {client.name}.
2. Ground your answer in the Live Ledger Summary, Recent Transactions, and Client-Specific Knowledge Base above.
3. For AR (Accounts Receivable), always refer to the party as "Customer". For AP (Accounts Payable), always refer to the party as "Vendor".
4. If new knowledge rules were learned from the user's message, explicitly confirm the rule(s) you saved to {client.name}'s knowledge base.
5. Keep the response concise and well-structured for {channel}. Do not use em dashes.
"""

        if settings.GEMINI_API_KEY and not settings.MOCK_MODE:
            try:
                from google import genai
                ai_client = genai.Client(api_key=settings.GEMINI_API_KEY)
                resp = ai_client.models.generate_content(
                    model=settings.GEMINI_MODEL or "gemini-2.5-flash",
                    contents=f"{system_prompt}\n\nUser Message ({subject or 'Direct Message'}):\n{user_message}",
                )
                if resp and resp.text:
                    return resp.text.strip().replace("\u2014", "-")
            except Exception as e:
                logger.debug(f"Gemini agent response fallback triggered: {e}")

        # Deterministic, context-grounded AI response synthesizer
        parts: List[str] = [
            f"Hello from {agent_name} ({client.name} - {section} Agent)."
        ]

        if learned_entries:
            rule_Summaries = "; ".join(f"'{e.title}'" for e in learned_entries)
            parts.append(
                f"I have learned and saved {len(learned_entries)} new client-specific rule(s) into {client.name}'s Knowledge Base: {rule_Summaries}. I will automatically apply this knowledge to future extractions, categorizations, and responses."
            )

        if clarification_updated:
            parts.append(
                f"Thank you. I have recorded your clarification for transaction '{clarification_updated.get('description')}' (GHS {float(clarification_updated.get('amount') or 0.0):,.2f}) and marked it as Client Answered for accountant review."
            )

        # Check if the user asked about a term covered by the client's knowledge base
        active_kb = ClientKnowledgeService.list_knowledge(
            session=Session(
                bind=None  # We already have knowledge_prompt string
            ) if False else None,  # Use knowledge_prompt directly below
            client_id=client.id,
        ) if False else []

        if knowledge_prompt:
            # Find any matching lines in knowledge_prompt relevant to words in user_message
            msg_words = [w.lower() for w in re.findall(r"[a-zA-Z0-9]{3,}", user_message) if w.lower() not in {"what", "how", "the", "for", "and", "are", "can", "you", "tell", "about", "status", "please"}]
            matched_kb_lines = []
            for ln in knowledge_prompt.splitlines():
                if ln.startswith("- [") and any(w in ln.lower() for w in msg_words):
                    matched_kb_lines.append(ln[2:])
            if matched_kb_lines:
                parts.append(
                    "Based on " + client.name + "'s Knowledge Base: " + " | ".join(matched_kb_lines[:3])
                )

        total_items = ledger_context.get("total_items", 0)
        total_amt = float(ledger_context.get("total_amount_ghs", 0.0))
        pending_cnt = ledger_context.get("pending_count", 0)
        approved_cnt = ledger_context.get("approved_or_mapped_count", 0)

        parts.append(
            f"Current {section} Ledger Summary for {client.name}: {total_items} transaction(s) totaling GHS {total_amt:,.2f} ({pending_cnt} pending review, {approved_cnt} approved/mapped)."
        )

        samples = ledger_context.get("sample_transactions") or []
        if samples:
            msg_words = [w.lower() for w in re.findall(r"[a-zA-Z0-9]{3,}", user_message)]
            matching_samples = [s for s in samples if any(w in s.lower() for w in msg_words)]
            selected_samples = matching_samples[:3] if matching_samples else samples[:3]
            parts.append("Recent items: " + " ; ".join(selected_samples))

        return "\n\n".join(parts).replace("\u2014", "-")

    @staticmethod
    def _format_email_reply_html(
        client_name: str,
        agent_name: str,
        agent_email: str,
        reply_text: str,
        learned_entries: List[ClientKnowledgeEntry],
    ) -> str:
        """Formats a clean HTML email body for outbound agent replies."""
        paragraphs = "".join(
            f"<p style='margin: 0 0 12px 0; color: #1e293b; font-size: 14px; line-height: 1.6;'>{p}</p>"
            for p in reply_text.split("\n\n")
            if p.strip()
        )
        learned_badge = ""
        if learned_entries:
            items_html = "".join(
                f"<li style='margin-bottom: 4px;'><strong>{e.title}</strong> ({e.category})</li>"
                for e in learned_entries
            )
            learned_badge = f"""
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 12px 16px; margin: 16px 0;">
                <div style="font-size: 11px; font-weight: 700; color: #15803d; text-transform: uppercase; margin-bottom: 6px;">
                    New Client Knowledge Saved ({len(learned_entries)})
                </div>
                <ul style="margin: 0; padding-left: 18px; color: #166534; font-size: 13px;">{items_html}</ul>
            </div>
            """

        return f"""
        <div style="background-color: #f8fafc; padding: 28px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 28px;">
                <div style="display: inline-block; padding: 4px 12px; background: #e0f2fe; color: #0369a1; border-radius: 9999px; font-size: 11px; font-weight: 700; margin-bottom: 14px;">
                    {agent_name} &bull; {client_name}
                </div>
                {paragraphs}
                {learned_badge}
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
                <div style="font-size: 11px; color: #64748b;">
                    Dedicated Agent Address: <strong>{agent_email}</strong> &bull; Powered by S4 Automations AI Engine
                </div>
            </div>
        </div>
        """
