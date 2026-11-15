"""Intelligent, Sustainable Client-Specific Knowledge Engine for Autonomous Accounting Agents."""

import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from sqlmodel import Session, select

from app.config import settings
from app.models.db_models import ClientKnowledgeEntry, ClientOrganization
from app.utils.logging import get_logger

logger = get_logger("client_knowledge")

VALID_KNOWLEDGE_CATEGORIES = {
    "ENTITY_ALIAS",
    "SKU_PRICING_RULE",
    "COA_MAPPING_RULE",
    "TAX_AND_COMPLIANCE",
    "WORKFLOW_SOP",
    "DOMAIN_FACT",
}


class ClientKnowledgeService:
    """
    Manages structured, client-specific and agent-specific knowledge rules.
    Supports:
      1. Conversational teaching via Email, WhatsApp, or Natural Language Studio.
      2. Continuous implicit learning from accountant ledger categorizations & resolutions.
      3. Active prompt injection & deterministic entity/account resolution for AI agents.
    """

    @staticmethod
    def ensure_table(session: Session) -> None:
        """Ensures the client_knowledge_entries table exists in SQLite/PostgreSQL."""
        try:
            from sqlmodel import SQLModel
            engine = session.get_bind()
            ClientKnowledgeEntry.__table__.create(engine, checkfirst=True)
        except Exception as e:
            logger.debug(f"ensure_table notice for client_knowledge_entries: {e}")

    @classmethod
    def sync_legacy_client_aliases(cls, session: Session, client: ClientOrganization) -> None:
        """
        Idempotently syncs any legacy custom_config.customer_mappings into structured
        ENTITY_ALIAS knowledge entries so all client knowledge lives in one unified store.
        """
        cls.ensure_table(session)
        custom_cfg = client.custom_config or {}
        mappings = custom_cfg.get("customer_mappings") or {}
        if not isinstance(mappings, dict) or not mappings:
            return

        existing = session.exec(
            select(ClientKnowledgeEntry)
            .where(ClientKnowledgeEntry.client_id == client.id)
            .where(ClientKnowledgeEntry.category == "ENTITY_ALIAS")
        ).all()
        existing_triggers = {
            (e.trigger_pattern or "").strip().lower() for e in existing if e.trigger_pattern
        }

        added = False
        for shorthand, val in mappings.items():
            clean_trigger = str(shorthand).strip()
            if not clean_trigger or clean_trigger.lower() in existing_triggers:
                continue
            target_name = val.get("name", str(val)) if isinstance(val, dict) else str(val)
            entry = ClientKnowledgeEntry(
                client_id=client.id,
                agent_id="ALL",
                section="AR",
                category="ENTITY_ALIAS",
                title=f"Customer Alias: '{clean_trigger}' -> '{target_name}'",
                trigger_pattern=clean_trigger,
                target_value=target_name,
                rule_content=f"When '{clean_trigger}' appears on slips or documents, map Customer to '{target_name}'.",
                structured_data={"shorthand": clean_trigger, "official_name": target_name, "entity_type": "customer"},
                source="MANUAL_UI",
                confidence=1.0,
                is_active=True,
                created_by="system_sync",
            )
            session.add(entry)
            existing_triggers.add(clean_trigger.lower())
            added = True

        if added:
            try:
                session.commit()
            except Exception:
                session.rollback()

    @classmethod
    def list_knowledge(
        cls,
        session: Session,
        client_id: str,
        agent_id: Optional[str] = None,
        section: Optional[str] = None,
        category: Optional[str] = None,
        search: Optional[str] = None,
        active_only: bool = False,
    ) -> List[ClientKnowledgeEntry]:
        """Returns structured knowledge entries for a client, optionally scoped to an agent or category."""
        cls.ensure_table(session)
        from app.api.v1.clients import get_client_id_aliases
        aliases = get_client_id_aliases(client_id) or [client_id]

        stmt = select(ClientKnowledgeEntry).where(ClientKnowledgeEntry.client_id.in_(aliases))
        if active_only:
            stmt = stmt.where(ClientKnowledgeEntry.is_active == True)
        if category and category.upper() != "ALL":
            stmt = stmt.where(ClientKnowledgeEntry.category == category.upper())

        rows = session.exec(
            stmt.order_by(ClientKnowledgeEntry.is_active.desc(), ClientKnowledgeEntry.usage_count.desc(), ClientKnowledgeEntry.id.desc())
        ).all()

        filtered: List[ClientKnowledgeEntry] = []
        for row in rows:
            if agent_id and agent_id.upper() not in ("ALL", ""):
                if row.agent_id and row.agent_id not in ("ALL", "", agent_id):
                    continue
            if section and section.upper() not in ("ALL", ""):
                if row.section and row.section.upper() not in ("ALL", "", section.upper()):
                    continue
            if search:
                q = search.strip().lower()
                haystack = f"{row.title} {row.trigger_pattern or ''} {row.target_value or ''} {row.rule_content}".lower()
                if q not in haystack:
                    continue
            filtered.append(row)

        return filtered

    @classmethod
    def get_knowledge_summary(
        cls,
        session: Session,
        client_id: str,
        agent_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Returns knowledge base counts grouped by category and learning source."""
        entries = cls.list_knowledge(session, client_id=client_id, agent_id=agent_id, active_only=False)
        by_category: Dict[str, int] = {cat: 0 for cat in VALID_KNOWLEDGE_CATEGORIES}
        by_source: Dict[str, int] = {}
        active_count = 0
        total_usages = 0

        for e in entries:
            cat = (e.category or "DOMAIN_FACT").upper()
            by_category[cat] = by_category.get(cat, 0) + 1
            src = (e.source or "MANUAL_UI").upper()
            by_source[src] = by_source.get(src, 0) + 1
            if e.is_active:
                active_count += 1
            total_usages += int(e.usage_count or 0)

        return {
            "total_entries": len(entries),
            "total_count": len(entries),
            "active_entries": active_count,
            "active_count": active_count,
            "total_applications": total_usages,
            "by_category": by_category,
            "by_source": by_source,
        }

    @classmethod
    def upsert_knowledge_entry(
        cls,
        session: Session,
        client_id: str,
        title: str,
        rule_content: str,
        category: str = "DOMAIN_FACT",
        agent_id: str = "ALL",
        section: str = "ALL",
        trigger_pattern: Optional[str] = None,
        target_value: Optional[str] = None,
        structured_data: Optional[Dict[str, Any]] = None,
        source: str = "MANUAL_UI",
        confidence: float = 1.0,
        created_by: str = "accountant",
        entry_id: Optional[int] = None,
    ) -> ClientKnowledgeEntry:
        """Creates or updates a ClientKnowledgeEntry, deduplicating by trigger_pattern + category when appropriate."""
        cls.ensure_table(session)
        norm_cat = (category or "DOMAIN_FACT").upper()
        if norm_cat not in VALID_KNOWLEDGE_CATEGORIES:
            norm_cat = "DOMAIN_FACT"

        now_utc = datetime.now(timezone.utc)
        existing: Optional[ClientKnowledgeEntry] = None

        if entry_id is not None:
            existing = session.exec(
                select(ClientKnowledgeEntry)
                .where(ClientKnowledgeEntry.id == entry_id)
                .where(ClientKnowledgeEntry.client_id == client_id)
            ).first()

        if existing is None and trigger_pattern:
            clean_trig = trigger_pattern.strip().lower()
            candidates = session.exec(
                select(ClientKnowledgeEntry)
                .where(ClientKnowledgeEntry.client_id == client_id)
                .where(ClientKnowledgeEntry.category == norm_cat)
            ).all()
            for cand in candidates:
                if (cand.trigger_pattern or "").strip().lower() == clean_trig:
                    existing = cand
                    break

        if existing:
            existing.title = title.strip()
            existing.rule_content = rule_content.strip()
            existing.category = norm_cat
            existing.agent_id = agent_id or existing.agent_id or "ALL"
            existing.section = (section or existing.section or "ALL").upper()
            if trigger_pattern is not None:
                existing.trigger_pattern = trigger_pattern.strip()
            if target_value is not None:
                existing.target_value = target_value.strip()
            if structured_data is not None:
                merged = dict(existing.structured_data or {})
                merged.update(structured_data)
                existing.structured_data = merged
            existing.confidence = max(float(existing.confidence or 0.8), float(confidence or 1.0))
            existing.is_active = True
            existing.updated_at = now_utc
            session.add(existing)
            session.commit()
            session.refresh(existing)
            return existing

        new_entry = ClientKnowledgeEntry(
            client_id=client_id,
            agent_id=agent_id or "ALL",
            section=(section or "ALL").upper(),
            category=norm_cat,
            title=title.strip(),
            trigger_pattern=trigger_pattern.strip() if trigger_pattern else None,
            target_value=target_value.strip() if target_value else None,
            rule_content=rule_content.strip(),
            structured_data=structured_data or {},
            source=source,
            confidence=confidence,
            usage_count=0,
            is_active=True,
            created_by=created_by,
            created_at=now_utc,
            updated_at=now_utc,
        )
        session.add(new_entry)
        session.commit()
        session.refresh(new_entry)
        return new_entry

    @classmethod
    def build_agent_knowledge_prompt(
        cls,
        session: Session,
        client_id: str,
        agent_id: Optional[str] = None,
        section: Optional[str] = None,
        record_usage: bool = True,
    ) -> str:
        """
        Compiles active client-specific and agent-specific knowledge rules into a structured
        prompt section for Gemini OCR, Bank Categorization, or Agent Email/WhatsApp responses.
        """
        entries = cls.list_knowledge(
            session,
            client_id=client_id,
            agent_id=agent_id,
            section=section,
            active_only=True,
        )
        if not entries:
            return ""

        now_utc = datetime.now(timezone.utc)
        grouped: Dict[str, List[str]] = {}
        category_labels = {
            "ENTITY_ALIAS": "Customer & Vendor Name Aliases",
            "SKU_PRICING_RULE": "Item Catalog & Pricing Rules",
            "COA_MAPPING_RULE": "Chart of Accounts (GL) Mapping Rules",
            "TAX_AND_COMPLIANCE": "Tax & Statutory Compliance Rules",
            "WORKFLOW_SOP": "Operational SOPs & Approval Rules",
            "DOMAIN_FACT": "Client Business & Domain Facts",
        }

        for entry in entries[:40]:
            label = category_labels.get(entry.category, "Client Rules")
            bullet = f"- [{entry.title}]: {entry.rule_content}"
            if entry.trigger_pattern and entry.target_value:
                bullet += f" (Trigger: '{entry.trigger_pattern}' -> Target: '{entry.target_value}')"
            grouped.setdefault(label, []).append(bullet)
            if record_usage:
                entry.usage_count = int(entry.usage_count or 0) + 1
                entry.last_applied_at = now_utc
                session.add(entry)

        if record_usage:
            try:
                session.commit()
            except Exception:
                session.rollback()

        sections_txt = ["### Client-Specific Knowledge Base & Learned Rules:"]
        for label, bullets in grouped.items():
            sections_txt.append(f"#### {label}:")
            sections_txt.extend(bullets)

        return "\n".join(sections_txt)

    @classmethod
    def get_entity_aliases_dict(
        cls,
        session: Session,
        client_id: str,
        agent_id: Optional[str] = None,
    ) -> Dict[str, str]:
        """Returns a dictionary of {trigger_pattern: target_value} for ENTITY_ALIAS rules."""
        entries = cls.list_knowledge(
            session,
            client_id=client_id,
            agent_id=agent_id,
            category="ENTITY_ALIAS",
            active_only=True,
        )
        result: Dict[str, str] = {}
        for e in entries:
            if e.trigger_pattern and e.target_value:
                result[e.trigger_pattern.strip()] = e.target_value.strip()
        return result

    @classmethod
    def learn_from_accountant_action(
        cls,
        session: Session,
        client_id: str,
        action_type: str,
        details: Dict[str, Any],
        agent_id: str = "ALL",
        actor: str = "accountant",
    ) -> Optional[ClientKnowledgeEntry]:
        """
        Automatically learns sustainable client-specific knowledge when an accountant:
          - Categorizes a bank transaction to a Chart of Accounts GL account (BANK_CATEGORIZED).
          - Resolves a client clarification request with a reusable explanation (QUERY_RESOLVED).
          - Maps a customer or vendor shorthand name (ENTITY_MAPPED).
        """
        cls.ensure_table(session)
        act = (action_type or "").upper()

        if act == "BANK_CATEGORIZED":
            desc = str(details.get("description") or details.get("payee_name") or "").strip()
            payee = str(details.get("payee_name") or "").strip()
            acct_name = str(details.get("mapped_account_name") or "").strip()
            acct_id = str(details.get("mapped_account_id") or "").strip()
            if not acct_name:
                return None

            trigger = payee or desc[:45].strip()
            if not trigger or len(trigger) < 3:
                return None

            return cls.upsert_knowledge_entry(
                session=session,
                client_id=client_id,
                agent_id=agent_id or "ALL",
                section="BANK",
                category="COA_MAPPING_RULE",
                title=f"Map '{trigger}' -> {acct_name}",
                trigger_pattern=trigger,
                target_value=acct_name,
                rule_content=f"Transactions matching '{trigger}' should be categorized to Chart of Accounts '{acct_name}'"
                + (f" (ID: {acct_id})." if acct_id else "."),
                structured_data={
                    "payee_or_description": trigger,
                    "mapped_account_name": acct_name,
                    "mapped_account_id": acct_id,
                },
                source="CORRECTION_AUTO_LEARNED",
                confidence=0.92,
                created_by=actor,
            )

        if act == "QUERY_RESOLVED":
            desc = str(details.get("description") or "").strip()
            explanation = str(details.get("client_explanation") or "").strip()
            p_type = str(details.get("pipeline_type") or "ALL").upper()
            mapped_acct = str(details.get("mapped_account_name") or "").strip()
            if not explanation or len(explanation) < 5:
                return None

            if mapped_acct and desc:
                return cls.upsert_knowledge_entry(
                    session=session,
                    client_id=client_id,
                    agent_id=agent_id or "ALL",
                    section=p_type if p_type in ("AR", "AP", "BANK", "GL") else "ALL",
                    category="COA_MAPPING_RULE",
                    title=f"Clarified Mapping: '{desc[:35]}' -> {mapped_acct}",
                    trigger_pattern=desc[:45],
                    target_value=mapped_acct,
                    rule_content=f"Client clarified '{desc}': \"{explanation}\". Map to '{mapped_acct}'.",
                    structured_data={"explanation": explanation, "mapped_account_name": mapped_acct},
                    source="PORTAL_CLARIFICATION",
                    confidence=0.95,
                    created_by=actor,
                )

            return cls.upsert_knowledge_entry(
                session=session,
                client_id=client_id,
                agent_id=agent_id or "ALL",
                section=p_type if p_type in ("AR", "AP", "BANK", "GL") else "ALL",
                category="DOMAIN_FACT",
                title=f"Clarification Note: {desc[:40] or 'Client Transaction'}",
                trigger_pattern=desc[:45] if desc else None,
                target_value=explanation[:80],
                rule_content=f"Regarding '{desc}': Client confirmed that {explanation}",
                structured_data={"explanation": explanation, "description": desc},
                source="PORTAL_CLARIFICATION",
                confidence=0.90,
                created_by=actor,
            )

        if act == "ENTITY_MAPPED":
            raw_name = str(details.get("raw_name") or "").strip()
            official_name = str(details.get("official_name") or "").strip()
            sec = str(details.get("section") or "AR").upper()
            if not raw_name or not official_name:
                return None
            party_type = "Vendor" if sec == "AP" else "Customer"
            return cls.upsert_knowledge_entry(
                session=session,
                client_id=client_id,
                agent_id=agent_id or "ALL",
                section=sec,
                category="ENTITY_ALIAS",
                title=f"{party_type} Alias: '{raw_name}' -> '{official_name}'",
                trigger_pattern=raw_name,
                target_value=official_name,
                rule_content=f"Always resolve {party_type.lower()} shorthand '{raw_name}' to official {party_type.lower()} '{official_name}'.",
                structured_data={"shorthand": raw_name, "official_name": official_name, "party_type": party_type.lower()},
                source="CORRECTION_AUTO_LEARNED",
                confidence=0.98,
                created_by=actor,
            )

        return None

    @classmethod
    async def teach_from_natural_language(
        cls,
        session: Session,
        client_id: str,
        raw_text: str,
        agent_id: str = "ALL",
        section: str = "ALL",
        source: str = "MANUAL_UI",
        actor: str = "accountant",
    ) -> List[ClientKnowledgeEntry]:
        """
        Parses natural-language instructions, emails, WhatsApp teaching messages, or onboarding notes
        into structured ClientKnowledgeEntry records using Gemini AI (with deterministic parser fallback).
        """
        cls.ensure_table(session)
        cleaned = (raw_text or "").strip()
        if not cleaned:
            return []

        parsed_rules: List[Dict[str, Any]] = []

        # 1. Try Gemini structured extraction when API key is configured and not in mock mode
        if settings.GEMINI_API_KEY and not settings.MOCK_MODE and len(cleaned) > 10:
            try:
                from google import genai
                ai_client = genai.Client(api_key=settings.GEMINI_API_KEY)
                prompt = f"""
You are an expert accounting knowledge engineer for S4 Automations.
Convert the following natural-language client instruction or note into a JSON array of structured knowledge rules.

Client ID: "{client_id}"
Target Agent / Section: "{section}"
Input Text:
\"\"\"{cleaned}\"\"\"

Each item in the JSON array MUST have:
- "category": one of ["ENTITY_ALIAS", "SKU_PRICING_RULE", "COA_MAPPING_RULE", "TAX_AND_COMPLIANCE", "WORKFLOW_SOP", "DOMAIN_FACT"]
- "section": one of ["ALL", "AR", "AP", "BANK", "GL"]
- "title": concise human-readable title (max 70 chars)
- "trigger_pattern": the keyword, shorthand, vendor, customer, or item name that triggers this rule (or null)
- "target_value": the mapped official name, GL account, or price/rate (or null)
- "rule_content": clear, actionable instruction sentence for the AI agent

Return ONLY a valid JSON list of objects.
"""
                resp = ai_client.models.generate_content(
                    model=settings.GEMINI_MODEL or "gemini-2.5-flash",
                    contents=prompt,
                )
                txt = (resp.text or "").strip()
                txt = re.sub(r"^```(?:json)?\s*", "", txt)
                txt = re.sub(r"\s*```$", "", txt)
                data = json.loads(txt)
                if isinstance(data, list):
                    parsed_rules = [d for d in data if isinstance(d, dict) and d.get("rule_content")]
            except Exception as e:
                logger.debug(f"Gemini knowledge distillation fallback triggered: {e}")

        # 2. Deterministic multi-rule parser fallback (ensures offline/test/instant reliability)
        if not parsed_rules:
            parsed_rules = cls._deterministic_parse_knowledge_text(cleaned, default_section=section)

        created_entries: List[ClientKnowledgeEntry] = []
        for r in parsed_rules:
            entry = cls.upsert_knowledge_entry(
                session=session,
                client_id=client_id,
                agent_id=agent_id or "ALL",
                section=str(r.get("section") or section or "ALL").upper(),
                category=str(r.get("category") or "DOMAIN_FACT").upper(),
                title=str(r.get("title") or cleaned[:60]),
                trigger_pattern=r.get("trigger_pattern"),
                target_value=r.get("target_value"),
                rule_content=str(r.get("rule_content") or cleaned),
                structured_data=r.get("structured_data") or {},
                source=source,
                confidence=0.95 if source in ("MANUAL_UI", "EMAIL_TEACHING", "WHATSAPP_TEACHING") else 0.90,
                created_by=actor,
            )
            created_entries.append(entry)

        return created_entries

    @classmethod
    def _deterministic_parse_knowledge_text(
        cls,
        text: str,
        default_section: str = "ALL",
    ) -> List[Dict[str, Any]]:
        """Deterministically extracts structured rules from natural language statements."""
        lines = [
            ln.strip(" \t•-*")
            for ln in re.split(
                r"[\r\n]+|(?<=\.)\s+(?=(?:Always|Whenever|Remember|Note|Map|Treat|If|When|Also|Price|Categorize|For)\b)",
                text,
                flags=re.IGNORECASE,
            )
            if ln and ln.strip(" \t•-*")
        ]
        if not lines:
            lines = [text.strip()]

        results: List[Dict[str, Any]] = []
        for line in lines:
            low = line.lower()
            sec = default_section.upper() if default_section else "ALL"
            if sec == "ALL":
                if any(k in low for k in ["vendor", "bill", "payable", "expense", "supplier"]):
                    sec = "AP"
                elif any(k in low for k in ["bank", "momo", "debit", "transfer", "categorize", "chart of account", "gl "]):
                    sec = "BANK"
                elif any(k in low for k in ["customer", "slip", "invoice", "receivable", "linen", "laundry"]):
                    sec = "AR"

            # Pattern A1: "slip/invoice/customer for X, map it to Y" -> ENTITY_ALIAS
            slip_alias_match = re.search(
                r"(?:slip|invoice|customer|vendor|bill)\s+for\s+['\"]?([^'\",]+?)['\"]?\s*,?\s*(?:map\s+(?:it|them)\s+to|use|is)\s+['\"]?([^'\".;,\n]+)['\"]?",
                line,
                re.IGNORECASE,
            )
            if slip_alias_match:
                trig = slip_alias_match.group(1).strip()
                targ = slip_alias_match.group(2).strip()
                results.append({
                    "category": "ENTITY_ALIAS",
                    "section": sec if sec != "ALL" else "AR",
                    "title": f"Alias: '{trig}' -> '{targ}'",
                    "trigger_pattern": trig,
                    "target_value": targ,
                    "rule_content": line,
                })
                continue

            # Pattern A2: Quoted alias / refers to / means / shorthand
            alias_match = re.search(
                r"['\"]([^'\"]+)['\"]\s*(?:means|refers to|is shorthand for|maps to|->|=|is)\s*['\"]?([^'\".;,\n]+)['\"]?",
                line,
                re.IGNORECASE,
            )
            if alias_match and not any(k in low for k in ["account", "gl ", "6", "5", "4", "ghs", "rate", "price"]):
                trig = alias_match.group(1).strip()
                targ = alias_match.group(2).strip()
                results.append({
                    "category": "ENTITY_ALIAS",
                    "section": sec if sec != "ALL" else "AR",
                    "title": f"Alias: '{trig}' -> '{targ}'",
                    "trigger_pattern": trig,
                    "target_value": targ,
                    "rule_content": line,
                })
                continue

            # Pattern B: COA / GL Account mapping ("map X to Y", "categorize X under Y")
            coa_match = re.search(
                r"(?:map|categorize|categorise|assign|book|post)\s+['\"]?([^'\"]+?)['\"]?\s+(?:to|under|as|into)\s+['\"]?(.+?)(?=['\"]?(?:\s+(?:and|then)\s+(?:auto[- ]?approve|approve|generate|draft|send|follow|raise|scan|reconcile|check)\b|[;\n.]|$))",
                line,
                re.IGNORECASE,
            )
            if coa_match:
                trig = re.sub(r"^(?:all|any|payments? to|bills? from|transactions? for)\s+", "", coa_match.group(1).strip(), flags=re.I)
                trig = re.sub(r"\s+(?:transactions?|txns?|debits?|credits?|charges?|expenses?|payments?)$", "", trig, flags=re.I).strip()
                targ = coa_match.group(2).strip().rstrip(".,; ")
                results.append({
                    "category": "COA_MAPPING_RULE",
                    "section": sec if sec != "ALL" else "BANK",
                    "title": f"COA Rule: {trig[:32]} -> {targ[:32]}",
                    "trigger_pattern": trig[:60],
                    "target_value": targ[:60],
                    "rule_content": line,
                })
                continue

            # Pattern C: Pricing / Rate rule (mentions GHS / rate / price / charge)
            price_match = re.search(
                r"(?:GHS|₵|\$)\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:GHS|cedis)",
                line,
                re.IGNORECASE,
            )
            if price_match and any(k in low for k in ["rate", "price", "charge", "cost", "per ", "unit", "sku", "item"]):
                amt = price_match.group(1) or price_match.group(2)
                quoted = re.findall(r"['\"]([^'\"]+)['\"]", line)
                trig = quoted[0] if quoted else line[:35]
                results.append({
                    "category": "SKU_PRICING_RULE",
                    "section": sec if sec != "ALL" else "AR",
                    "title": f"Pricing Rule: {trig[:35]} @ GHS {amt}",
                    "trigger_pattern": trig[:60],
                    "target_value": f"GHS {amt}",
                    "rule_content": line,
                    "structured_data": {"rate": float(amt)},
                })
                continue

            # Pattern D: Tax & Compliance (VAT, NHIL, GETFund, withholding, GRA)
            if any(k in low for k in ["vat", "nhil", "getfund", "withholding", "wht", "tax", "levy", "gra"]):
                results.append({
                    "category": "TAX_AND_COMPLIANCE",
                    "section": sec,
                    "title": f"Tax Rule: {line[:52]}",
                    "trigger_pattern": None,
                    "target_value": None,
                    "rule_content": line,
                })
                continue

            # Pattern E: SOP / Workflow rule
            if any(k in low for k in ["always", "never", "must", "require", "flag", "approve", "threshold", "cutoff", "schedule"]):
                results.append({
                    "category": "WORKFLOW_SOP",
                    "section": sec,
                    "title": f"SOP: {line[:55]}",
                    "trigger_pattern": None,
                    "target_value": None,
                    "rule_content": line,
                })
                continue

            # Default: Domain Fact
            results.append({
                "category": "DOMAIN_FACT",
                "section": sec,
                "title": line[:60],
                "trigger_pattern": None,
                "target_value": None,
                "rule_content": line,
            })

        return results
