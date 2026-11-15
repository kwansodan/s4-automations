"""Multi-Tenant WhatsApp Business Service (Meta Cloud API, Twilio & Shared Gateway) for Autonomous Accounting Agents."""

import re
from typing import Any, Dict, List, Optional, Tuple
import httpx

from app.config import settings
from app.utils.logging import get_logger

logger = get_logger("whatsapp_service")


def normalize_phone(phone: Optional[str]) -> str:
    """Normalizes a phone or WhatsApp identifier to digits only (e.g. 'whatsapp:+233551234567' -> '233551234567')."""
    if not phone:
        return ""
    cleaned = re.sub(r"^whatsapp:", "", str(phone).strip(), flags=re.IGNORECASE)
    digits = re.sub(r"[^\d]", "", cleaned)
    if digits.startswith("0") and len(digits) == 10:
        # Default Ghana local 10-digit format 0XX... -> 233XX...
        digits = "233" + digits[1:]
    return digits


class WhatsAppService:
    """
    Handles multi-tenant WhatsApp Business communication for S4 Automations Agents:
      1. Platform-Managed Shared Gateway (whatsapp_mode = 'platform_shared'):
         Instant zero-setup onboarding using the S4 Gateway number + agent @routing_tag.
      2. Tenant-Owned Dedicated WhatsApp Number (whatsapp_mode = 'dedicated_meta' | 'dedicated_twilio'):
         Allows SaaS users who sign up to connect their own WhatsApp Business number so the app
         listens on their webhook and replies directly from their number.
    """

    META_GRAPH_BASE = "https://graph.facebook.com/v20.0"

    @classmethod
    def verify_webhook_handshake(
        cls,
        hub_mode: Optional[str],
        hub_verify_token: Optional[str],
        hub_challenge: Optional[str],
        tenant_verify_token: Optional[str] = None,
    ) -> Tuple[bool, str]:
        """
        Verifies Meta WhatsApp Cloud API GET webhook subscription handshake.
        Accepts either the tenant's custom verify token or the platform's default verify token.
        """
        if hub_mode != "subscribe" or not hub_verify_token:
            return False, "Invalid hub.mode or missing hub.verify_token"

        allowed_tokens = {settings.WHATSAPP_VERIFY_TOKEN}
        if tenant_verify_token:
            allowed_tokens.add(tenant_verify_token.strip())

        if hub_verify_token.strip() in allowed_tokens:
            return True, str(hub_challenge or "")
        return False, "Verification token mismatch"

    @classmethod
    def parse_inbound_webhook_payload(cls, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Normalizes inbound WhatsApp webhook payloads from:
          - Meta WhatsApp Cloud API (entry[].changes[].value.messages[])
          - Twilio WhatsApp Webhook (From, To, Body, MediaUrl0)
          - Direct JSON API / Simulator ({from_phone, to_phone, text, client_id, agent_id, attachments})
        Returns a list of normalized message dicts:
          {
            "from_phone": str,
            "to_phone": str,
            "phone_number_id": Optional[str],
            "waba_id": Optional[str],
            "sender_name": Optional[str],
            "text": str,
            "message_id": Optional[str],
            "client_id": Optional[str],
            "agent_id": Optional[str],
            "attachments": List[Dict[str, Any]],
          }
        """
        messages_out: List[Dict[str, Any]] = []

        # 1. Meta WhatsApp Cloud API format
        if "entry" in payload and isinstance(payload.get("entry"), list):
            for entry in payload["entry"]:
                waba_id = str(entry.get("id") or "")
                for change in entry.get("changes", []):
                    val = change.get("value") or {}
                    meta = val.get("metadata") or {}
                    phone_number_id = str(meta.get("phone_number_id") or "")
                    display_phone = normalize_phone(meta.get("display_phone_number"))
                    contacts_list = val.get("contacts") or []
                    contact_name = None
                    if contacts_list and isinstance(contacts_list[0], dict):
                        contact_name = (contacts_list[0].get("profile") or {}).get("name")

                    for msg in val.get("messages", []):
                        from_phone = normalize_phone(msg.get("from"))
                        msg_type = msg.get("type", "text")
                        text_body = ""
                        attachments: List[Dict[str, Any]] = []

                        if msg_type == "text":
                            text_body = (msg.get("text") or {}).get("body", "")
                        elif msg_type in ("image", "document", "audio", "video"):
                            media_obj = msg.get(msg_type) or {}
                            text_body = media_obj.get("caption") or f"[Attached {msg_type.upper()}]"
                            attachments.append({
                                "type": msg_type,
                                "media_id": media_obj.get("id"),
                                "mime_type": media_obj.get("mime_type"),
                                "file_name": media_obj.get("filename") or f"whatsapp_{msg_type}",
                            })
                        elif msg_type == "interactive":
                            inter = msg.get("interactive") or {}
                            btn_reply = inter.get("button_reply") or inter.get("list_reply") or {}
                            text_body = btn_reply.get("title") or btn_reply.get("id") or ""

                        messages_out.append({
                            "from_phone": from_phone,
                            "to_phone": display_phone or phone_number_id,
                            "phone_number_id": phone_number_id,
                            "waba_id": waba_id,
                            "sender_name": contact_name,
                            "text": text_body.strip(),
                            "message_id": msg.get("id"),
                            "client_id": payload.get("client_id"),
                            "agent_id": payload.get("agent_id"),
                            "attachments": attachments,
                        })
            return messages_out

        # 2. Twilio WhatsApp format (From, To, Body)
        if "From" in payload or "Body" in payload:
            from_p = normalize_phone(payload.get("From"))
            to_p = normalize_phone(payload.get("To"))
            body = str(payload.get("Body") or "").strip()
            atts = []
            num_media = int(payload.get("NumMedia") or 0)
            for idx in range(num_media):
                m_url = payload.get(f"MediaUrl{idx}")
                m_type = payload.get(f"MediaContentType{idx}")
                if m_url:
                    atts.append({"url": m_url, "mime_type": m_type, "file_name": f"twilio_media_{idx}"})
            messages_out.append({
                "from_phone": from_p,
                "to_phone": to_p,
                "phone_number_id": to_p,
                "waba_id": payload.get("AccountSid"),
                "sender_name": payload.get("ProfileName"),
                "text": body,
                "message_id": payload.get("MessageSid") or payload.get("SmsMessageSid"),
                "client_id": payload.get("client_id"),
                "agent_id": payload.get("agent_id"),
                "attachments": atts,
            })
            return messages_out

        # 3. Direct JSON API / Webhook Simulator format
        from_phone = normalize_phone(
            payload.get("from_phone") or payload.get("from") or payload.get("sender") or "+233240000000"
        )
        to_phone = normalize_phone(
            payload.get("to_phone") or payload.get("to") or payload.get("recipient") or settings.WHATSAPP_PLATFORM_NUMBER
        )
        text = str(
            payload.get("text") or payload.get("message") or payload.get("body") or ""
        ).strip()
        if text or payload.get("attachments"):
            messages_out.append({
                "from_phone": from_phone,
                "to_phone": to_phone,
                "phone_number_id": payload.get("phone_number_id") or to_phone,
                "waba_id": payload.get("waba_id"),
                "sender_name": payload.get("sender_name"),
                "text": text,
                "message_id": payload.get("message_id"),
                "client_id": payload.get("client_id"),
                "agent_id": payload.get("agent_id"),
                "attachments": payload.get("attachments") or [],
            })

        return messages_out

    @classmethod
    async def send_message(
        cls,
        to_phone: str,
        message_text: str,
        tenant_whatsapp_config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Dispatches an outbound WhatsApp message to `to_phone`.
        Automatically uses the tenant's dedicated WhatsApp Business credentials if configured
        (dedicated_meta or dedicated_twilio), or falls back to the platform gateway / clean log mode.
        """
        clean_to = normalize_phone(to_phone)
        cfg = tenant_whatsapp_config or {}
        mode = str(cfg.get("whatsapp_mode") or "platform_shared").lower()

        phone_number_id = (
            cfg.get("whatsapp_phone_number_id")
            if mode == "dedicated_meta" and cfg.get("whatsapp_phone_number_id")
            else settings.WHATSAPP_PHONE_NUMBER_ID
        )
        access_token = (
            cfg.get("whatsapp_access_token")
            if mode == "dedicated_meta" and cfg.get("whatsapp_access_token")
            else settings.WHATSAPP_ACCESS_TOKEN
        )
        from_number = (
            normalize_phone(cfg.get("whatsapp_phone_number"))
            if mode in ("dedicated_meta", "dedicated_twilio") and cfg.get("whatsapp_phone_number")
            else normalize_phone(settings.WHATSAPP_PLATFORM_NUMBER)
        )

        if settings.MOCK_MODE or not (phone_number_id and access_token):
            logger.info(
                f"[WHATSAPP OUTBOUND ({mode.upper()})] From {from_number} -> To {clean_to}: {message_text[:120]}"
            )
            return {
                "delivered": True,
                "provider": "mock_or_logged" if not (phone_number_id and access_token) else "mock",
                "whatsapp_mode": mode,
                "from_phone": from_number,
                "to_phone": clean_to,
            }

        try:
            url = f"{cls.META_GRAPH_BASE}/{phone_number_id}/messages"
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            }
            body = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": clean_to,
                "type": "text",
                "text": {"preview_url": False, "body": message_text[:4000]},
            }
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, headers=headers, json=body)
            if resp.status_code in (200, 201):
                return {
                    "delivered": True,
                    "provider": "meta_cloud_api",
                    "whatsapp_mode": mode,
                    "from_phone": from_number,
                    "to_phone": clean_to,
                    "response": resp.json(),
                }
            logger.warning(f"Meta WhatsApp Cloud API returned {resp.status_code}: {resp.text}")
        except Exception as e:
            logger.error(f"Error sending WhatsApp message via Meta Cloud API: {e}")

        return {
            "delivered": False,
            "provider": "meta_cloud_api_fallback",
            "whatsapp_mode": mode,
            "from_phone": from_number,
            "to_phone": clean_to,
        }
