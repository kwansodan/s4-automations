"""True Agentic Accounting Brain Service: Tool Registry, ReAct Execution Loop, Autonomy Policy Guardrails & Reactive Chaining."""

from __future__ import annotations

import asyncio
import base64
import calendar
import contextvars
import copy
import csv
import io
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

import httpx
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import Session, desc, select

from app.config import settings
from app.models.db_models import (
    AgentExecutionRun,
    BankTransaction,
    ClientKnowledgeEntry,
    ClientOrganization,
    FinancialStatementReport,
    ManualJournalWorkingPaper,
    StagedTransaction,
)
from app.services.audit_service import AuditService
from app.services.client_knowledge_service import ClientKnowledgeService
from app.services.mailjet_service import MailjetService
from app.services.telemetry_service import record_api_call_sync
from app.utils.date_parser import MONTH_MAP, resolve_transaction_date
from app.utils.logging import get_logger
from app.workflows.bank_statement_pipeline import parse_csv_bank_statement

logger = get_logger("agentic_brain_service")

AUTONOMY_LEVELS = ("copilot", "semi_autonomous", "full_autonomous")

DEFAULT_AGENT_POLICIES: Dict[str, Any] = {
    "autonomy_level": "semi_autonomous",
    "schedule_frequency": "daily_morning",
    "auto_approve_threshold": 0.92,
    "auto_apply_knowledge": True,
    "auto_query_anomalies": False,
    "proactive_SLA_reminders": True,
}

_IN_BANK_SCAN_CV: contextvars.ContextVar[bool] = contextvars.ContextVar("_in_bank_scan_cv", default=False)


def sanitize_no_em_dash(text: Optional[str]) -> str:
    """Removes em dashes and en dashes in outputs per workspace formatting convention."""
    if not text:
        return ""
    return str(text).replace("\u2014", " - ").replace("\u2013", " - ")


def _parse_dt_utc(raw_dt: Any) -> Optional[datetime]:
    if raw_dt is None:
        return None
    if isinstance(raw_dt, datetime):
        return raw_dt if raw_dt.tzinfo else raw_dt.replace(tzinfo=timezone.utc)
    try:
        s = str(raw_dt).strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _slugify(val: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "_", str(val or "").lower()).strip("_")
    return cleaned[:40] or "item"


def _extract_entity_label(tx: StagedTransaction) -> str:
    meta = dict(tx.metadata_json or {})
    if (tx.pipeline_type or "AR").upper() == "AP":
        return str(
            meta.get("reconciled_vendor_name")
            or meta.get("vendor_name")
            or meta.get("raw_vendor_name")
            or tx.source_file_name
            or "Unknown Vendor"
        ).strip()
    return str(
        meta.get("reconciled_customer_name")
        or meta.get("customer_name")
        or meta.get("raw_customer_name")
        or tx.source_file_name
        or "Unknown Customer"
    ).strip()


def _parse_csv_flexible(content_bytes: bytes, file_name: str) -> List[Dict[str, Any]]:
    """Parses bank CSV supporting both Debit/Credit columns and signed/Type Amount columns."""
    text = content_bytes.decode("utf-8", errors="replace")
    reader = csv.reader(io.StringIO(text))
    rows = [r for r in reader if any(c.strip() for c in r)]
    if len(rows) < 2:
        return []

    header = [c.lower().strip() for c in rows[0]]
    type_col = next((i for i, c in enumerate(header) if c in ("type", "tx_type", "transaction_type", "dr_cr", "drcr")), None)
    amt_col = next((i for i, c in enumerate(header) if any(k in c for k in ("amount", "value", "ghs", "usd"))), None)
    debit_col = next((i for i, c in enumerate(header) if "debit" in c or c == "dr" or "withdrawal" in c), None)
    credit_col = next((i for i, c in enumerate(header) if "credit" in c or c == "cr" or "deposit" in c), None)
    date_col = next((i for i, c in enumerate(header) if "date" in c), 0)
    desc_col = next((i for i, c in enumerate(header) if any(k in c for k in ("desc", "narration", "detail", "particulars", "memo"))), 1)

    if type_col is not None and amt_col is not None:
        parsed: List[Dict[str, Any]] = []
        for row in rows[1:]:
            if len(row) <= max(date_col, desc_col, amt_col, type_col):
                continue
            d_val = row[date_col].strip()
            desc_val = row[desc_col].strip()
            if not d_val or not desc_val:
                continue
            raw_amt = row[amt_col].replace(",", "").strip()
            try:
                amount = abs(float(raw_amt))
            except ValueError:
                amount = 0.0
            t_raw = row[type_col].strip().upper()
            tx_type = "CREDIT" if t_raw.startswith(("CR", "DEP", "IN")) else "DEBIT"
            parsed.append({
                "transaction_date": d_val,
                "description": desc_val,
                "amount": amount,
                "transaction_type": tx_type,
                "source_file_name": file_name,
            })
        if parsed:
            return parsed

    if (debit_col is not None) != (credit_col is not None):
        parsed = []
        for row in rows[1:]:
            if len(row) <= max(date_col, desc_col):
                continue
            d_val = row[date_col].strip()
            desc_val = row[desc_col].strip()
            if not d_val or not desc_val:
                continue
            col_idx = debit_col if debit_col is not None else credit_col
            if col_idx is None or len(row) <= col_idx:
                continue
            try:
                amount = abs(float(row[col_idx].replace(",", "").strip() or 0))
            except ValueError:
                amount = 0.0
            parsed.append({
                "transaction_date": d_val,
                "description": desc_val,
                "amount": amount,
                "transaction_type": "DEBIT" if debit_col is not None else "CREDIT",
                "source_file_name": file_name,
            })
        if parsed:
            return parsed

    return parse_csv_bank_statement(content_bytes, file_name)


def _extract_numeric_price(text: str) -> Optional[float]:
    if not text:
        return None
    m = re.search(r"(\d+(?:\.\d{1,2})?)", str(text).replace(",", ""))
    if m:
        try:
            val = float(m.group(1))
            return val if val > 0 else None
        except ValueError:
            return None
    return None


def _normalize_match_tokens(pattern: str) -> List[str]:
    cleaned = re.sub(r"[^a-z0-9\s]", " ", str(pattern or "").lower()).strip()
    stop = {"all", "the", "for", "whenever", "any", "transactions", "transaction", "debits", "credits", "slips", "bills", "map", "categorize", "under", "to"}
    return [tok for tok in cleaned.split() if len(tok) >= 2 and tok not in stop]


def _rule_matches_text(pattern: str, text: str) -> bool:
    if not pattern or not text:
        return False
    p_low = pattern.strip().lower()
    t_low = text.strip().lower()
    if p_low in t_low:
        return True
    tokens = _normalize_match_tokens(pattern)
    if not tokens:
        return False
    if len(tokens) == 1:
        return tokens[0] in t_low
    return all(tok in t_low for tok in tokens)


class AgenticBrainService:
    """
    Event-driven, tool-calling accounting agent runtime (Perceive -> Plan -> Act -> Verify -> Learn).
    Supports 10 native accounting tools, Gemini JSON tool planning with deterministic fallback,
    per-agent autonomy guardrails, reactive domain chaining, and full telemetry persistence.
    """

    _in_bank_scan_cv = _IN_BANK_SCAN_CV
    MAX_REACT_TURNS = 5

    TOOL_DEFINITIONS: List[Dict[str, Any]] = [
        {
            "name": "scan_and_ingest_storage",
            "description": "Scans configured storage or bank feeds (Google Drive, OneDrive, Email, Bank Feed) for new documents/transactions and stages them.",
            "parameters": ["month", "year", "force_reprocess"],
            "mutates_ledger": False,
            "external_dispatch": False,
        },
        {
            "name": "ingest_message_attachments",
            "description": "Parses file attachments sent via Email or WhatsApp (CSV/PDF/Image), stages StagedTransaction or BankTransaction rows, and applies active knowledge rules.",
            "parameters": ["attachments", "sender", "channel", "month", "year"],
            "mutates_ledger": False,
            "external_dispatch": False,
        },
        {
            "name": "apply_learned_knowledge_retroactively",
            "description": "Applies all active ClientKnowledgeEntry rules (COA mappings, entity aliases, SKU pricing) across UNMAPPED bank rows and PENDING staged transactions.",
            "parameters": [],
            "mutates_ledger": True,
            "external_dispatch": False,
        },
        {
            "name": "auto_approve_verified_transactions",
            "description": "Auto-approves valid StagedTransaction items passing contract validation, positive rates, zero discrepancy, and confidence >= min_confidence.",
            "parameters": ["min_confidence", "customer_or_vendor", "month", "year"],
            "mutates_ledger": True,
            "external_dispatch": False,
        },
        {
            "name": "categorize_bank_transactions",
            "description": "Maps matching UNMAPPED/clarification bank transactions to a Chart of Accounts GL category and saves a reusable COA_MAPPING_RULE.",
            "parameters": ["payee_or_description", "account_id", "account_name"],
            "mutates_ledger": True,
            "external_dispatch": False,
        },
        {
            "name": "raise_anomaly_clarification_requests",
            "description": "Detects unmapped bank transactions or AR/AP discrepancies and creates/dispatches consolidated Client Portal clarification queries.",
            "parameters": ["send_immediately", "min_amount"],
            "mutates_ledger": True,
            "external_dispatch": True,
        },
        {
            "name": "followup_overdue_information_requests",
            "description": "Identifies CLARIFICATION_REQUESTED items older than overdue_hours (default 72h) and dispatches a reminder digest.",
            "parameters": ["overdue_hours"],
            "mutates_ledger": False,
            "external_dispatch": True,
        },
        {
            "name": "generate_draft_invoices_or_bills",
            "description": "Creates draft Customer invoices (AR) or Vendor bills (AP) in Zoho Books / accounting ERP for approved transactions.",
            "parameters": ["month", "year", "customer_name", "mode"],
            "mutates_ledger": True,
            "external_dispatch": True,
        },
        {
            "name": "reconcile_storage_vs_ledger",
            "description": "Compares configured Drive/storage files against staged DB records and reports missing files, unmapped bank rows, or discrepancies.",
            "parameters": ["month", "year"],
            "mutates_ledger": False,
            "external_dispatch": False,
        },
        {
            "name": "query_ledger_analytics",
            "description": "Computes live breakdown metrics across staged AR Customers, AP Vendors, SKUs, and Bank transactions.",
            "parameters": ["month", "year", "customer_or_vendor", "status"],
            "mutates_ledger": False,
            "external_dispatch": False,
        },
        # === GL Accountant Agent Tools ===
        {
            "name": "fetch_trial_balance_and_gl",
            "description": "Pulls General Ledger accounts and Trial Balance (Debits, Credits, Net Balances) from Zoho Books or curated accounting ledger.",
            "parameters": ["month", "year"],
            "mutates_ledger": False,
            "external_dispatch": False,
        },
        {
            "name": "audit_closing_adjustments",
            "description": "Reviews the Trial Balance in the context of entity accounting policies and statutory standards to detect required closing adjustments.",
            "parameters": ["month", "year"],
            "mutates_ledger": False,
            "external_dispatch": False,
        },
        {
            "name": "formulate_manual_journal",
            "description": "Constructs balanced double-entry manual adjusting journal lines verifying debits equal credits.",
            "parameters": ["adjustment"],
            "mutates_ledger": False,
            "external_dispatch": False,
        },
        {
            "name": "attach_working_paper",
            "description": "Generates an auditable ManualJournalWorkingPaper record with tabular calculation schedules and technical accounting memo ('white paper').",
            "parameters": ["month", "year", "adjustment", "auto_approve"],
            "mutates_ledger": True,
            "external_dispatch": False,
        },
        {
            "name": "post_approved_journal_to_erp",
            "description": "Pushes an approved balanced manual journal into Zoho Books / ERP and links the ERP journal entry ID.",
            "parameters": ["paper_id"],
            "mutates_ledger": True,
            "external_dispatch": True,
        },
        # === Financial Reporting Agent Tools ===
        {
            "name": "generate_financial_statement_pack",
            "description": "Synthesizes formal financial statements (P&L, Balance Sheet, Cash Flow, Changes in Equity) from the adjusted Trial Balance.",
            "parameters": ["month", "year", "period_type", "reporting_framework"],
            "mutates_ledger": False,
            "external_dispatch": False,
        },
        {
            "name": "compile_notes_and_disclosures",
            "description": "Compiles statutory accounting policy notes and supporting disclosure sub-schedules for the financial statement pack.",
            "parameters": ["report_id"],
            "mutates_ledger": False,
            "external_dispatch": False,
        },
        {
            "name": "compute_financial_ratios_and_commentary",
            "description": "Calculates liquidity, leverage, and profitability ratios along with executive MD&A variance commentary.",
            "parameters": ["report_id"],
            "mutates_ledger": False,
            "external_dispatch": False,
        },
    ]

    TOOL_NAMES = {t["name"] for t in TOOL_DEFINITIONS}

    @classmethod
    def ensure_table(cls, session: Session) -> None:
        try:
            AgentExecutionRun.__table__.create(session.get_bind(), checkfirst=True)
        except Exception as e:
            logger.debug(f"ensure_table AgentExecutionRun notice: {e}")

    @classmethod
    def _get_aliases(cls, client_id: str) -> List[str]:
        try:
            from app.api.v1.clients import get_client_id_aliases
            aliases = get_client_id_aliases(client_id)
            return aliases or [client_id]
        except Exception:
            return [client_id]

    @classmethod
    def resolve_client_and_agent(
        cls,
        db: Session,
        client_id: str,
        agent_id: Optional[str] = None,
        section: Optional[str] = None,
    ) -> Tuple[Optional[ClientOrganization], Optional[Dict[str, Any]]]:
        aliases = cls._get_aliases(client_id)
        client = db.exec(select(ClientOrganization).where(ClientOrganization.id.in_(aliases))).first()
        if not client:
            client = db.get(ClientOrganization, client_id)
        if not client:
            return None, None

        from app.services.agent_comms_service import AgentCommsService
        raw_list = list(client.agents or client.pipelines or [])
        target_agent = None
        if agent_id:
            target_agent = next((dict(a) for a in raw_list if str(a.get("id")) == str(agent_id)), None)
            if target_agent is None and raw_list:
                return client, None
        if not target_agent and section:
            sec_u = section.upper().strip()
            target_agent = next(
                (dict(a) for a in raw_list if str(a.get("section", "AR")).upper() == sec_u and a.get("is_active", a.get("active", True))),
                None,
            ) or next((dict(a) for a in raw_list if str(a.get("section", "AR")).upper() == sec_u), None)
        if not target_agent and raw_list and not agent_id:
            target_agent = dict(raw_list[0])
        if not target_agent:
            if agent_id:
                return client, None
            sec = (section or "AR").upper()
            target_agent = {
                "id": f"agent_{sec.lower()}_default",
                "name": f"{client.name} {sec} Agent",
                "section": sec,
                "entity_type": (
                    "gl_journal" if sec == "GL"
                    else "fr_statement_pack" if sec == "FR"
                    else "bank_feed" if sec == "BANK"
                    else "ap_vendor_bill" if sec == "AP"
                    else "ar_sales_invoice"
                ),
                "source_type": (
                    "general_ledger" if sec in ("GL", "FR")
                    else "bank_feed" if sec == "BANK"
                    else (client.source_type or "google_drive")
                ),
                "is_active": True,
                "active": True,
            }

        enriched = AgentCommsService.enrich_agent_metadata(client.id, target_agent)
        return client, enriched

    @classmethod
    def _update_agent_run_metadata(
        cls,
        db: Session,
        client: ClientOrganization,
        agent_id: str,
        summary_data: Dict[str, Any],
        trigger_type: str = "",
    ) -> None:
        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            pipes = copy.deepcopy(list(client.pipelines or []))
            agents = copy.deepcopy(list(client.agents or pipes))
            for lst in (pipes, agents):
                for item in lst:
                    if str(item.get("id")) == str(agent_id):
                        item["last_triggered_at"] = now_iso
                        if str(trigger_type).upper() == "SCHEDULED_HEARTBEAT":
                            item["last_heartbeat_at"] = now_iso
                        item["total_runs_count"] = int(item.get("total_runs_count", 0)) + 1
                        item["last_run_summary"] = copy.deepcopy(summary_data)
            if pipes:
                client.pipelines = pipes
                flag_modified(client, "pipelines")
            if agents:
                client.agents = agents
                flag_modified(client, "agents")
            client.last_run_at = datetime.now(timezone.utc)
            client.updated_at = datetime.now(timezone.utc)
            db.add(client)
            db.commit()
        except Exception as e:
            logger.warning(f"Failed updating agent run metadata for {client.id}/{agent_id}: {e}")
            db.rollback()

    @classmethod
    def get_ledger_snapshot(cls, db: Session, client_id: str, section: str = "AR") -> Dict[str, Any]:
        aliases = cls._get_aliases(client_id)
        staged = list(db.exec(select(StagedTransaction).where(StagedTransaction.client_id.in_(aliases))).all())
        banks = list(db.exec(select(BankTransaction).where(BankTransaction.client_id.in_(aliases))).all())
        kb_entries = list(
            db.exec(
                select(ClientKnowledgeEntry).where(
                    ClientKnowledgeEntry.client_id.in_(aliases),
                    ClientKnowledgeEntry.is_active == True,
                )
            ).all()
        )

        sec_u = (section or "AR").upper()
        section_staged = [t for t in staged if (t.pipeline_type or "AR").upper() == sec_u] if sec_u in ("AR", "AP") else staged
        pending_staged = [t for t in section_staged if not t.approved and t.status in ("PENDING", "PENDING_VALIDATION_ERROR")]
        approved_staged = [t for t in section_staged if t.approved or t.status == "APPROVED"]
        discrepancy_staged = [t for t in section_staged if abs(float(t.discrepancy_amount or 0)) > 0 or t.validation_status in ("PENDING_VALIDATION_ERROR", "PENDING_CUSTOMER_MAPPING")]

        unmapped_bank = [b for b in banks if b.status == "UNMAPPED"]
        clarif_bank = [b for b in banks if b.status == "CLARIFICATION_REQUESTED"]
        answered_bank = [b for b in banks if b.status == "CLIENT_ANSWERED"]
        mapped_bank = [b for b in banks if b.status == "MAPPED"]

        now_utc = datetime.now(timezone.utc)
        overdue_bank = []
        for b in clarif_bank:
            ref_dt = _parse_dt_utc(b.query_date or b.updated_at or b.created_at)
            if ref_dt and (now_utc - ref_dt).total_seconds() >= 72 * 3600:
                overdue_bank.append(b)

        working_papers = list(
            db.exec(select(ManualJournalWorkingPaper).where(ManualJournalWorkingPaper.client_id.in_(aliases))).all()
        )
        reports = list(
            db.exec(select(FinancialStatementReport).where(FinancialStatementReport.client_id.in_(aliases))).all()
        )

        return {
            "section": sec_u,
            "staged_total": len(section_staged),
            "staged_pending": len(pending_staged),
            "staged_approved": len(approved_staged),
            "staged_discrepancies": len(discrepancy_staged),
            "bank_total": len(banks),
            "bank_unmapped": len(unmapped_bank),
            "bank_clarification_requested": len(clarif_bank),
            "bank_client_answered": len(answered_bank),
            "bank_mapped": len(mapped_bank),
            "bank_overdue_72h": len(overdue_bank),
            "active_knowledge_rules": len(kb_entries),
            "working_papers_total": len(working_papers),
            "working_papers_suggested": len([w for w in working_papers if w.status == "SUGGESTED"]),
            "working_papers_posted": len([w for w in working_papers if w.status == "POSTED_TO_ERP"]),
            "financial_reports_total": len(reports),
            "sample_unmapped_bank": [
                {"id": b.id, "description": b.description, "amount": b.amount, "type": b.transaction_type}
                for b in unmapped_bank[:8]
            ],
            "sample_pending_staged": [
                {
                    "id": t.id,
                    "entity": _extract_entity_label(t),
                    "item": t.item_or_description,
                    "amount": t.total_amount,
                    "confidence": t.confidence_score,
                    "validation_status": t.validation_status,
                }
                for t in pending_staged[:8]
            ],
        }

    # =========================================================================
    # Autonomy Guardrails Policy Check
    # =========================================================================
    @classmethod
    def check_tool_policy(
        cls,
        tool_name: str,
        tool_input: Dict[str, Any],
        autonomy_level: str,
        trigger_type: str,
        explicit_human_command: bool = False,
        agent: Optional[Dict[str, Any]] = None,
    ) -> Tuple[bool, str, Dict[str, Any]]:
        """
        Evaluates whether a tool call can execute autonomously under the configured autonomy policy.
        Returns (allowed, reason_if_blocked, adjusted_input).
        """
        level = autonomy_level if autonomy_level in AUTONOMY_LEVELS else "semi_autonomous"
        adjusted = dict(tool_input or {})
        is_autonomous_bg = trigger_type in ("SCHEDULED_HEARTBEAT", "WATCHDOG_SLA", "REACTIVE_EVENT") or not explicit_human_command

        if tool_name == "auto_approve_verified_transactions":
            if level == "copilot" and not explicit_human_command:
                return False, "Copilot mode pauses ledger approval for human review.", adjusted
            if "min_confidence" not in adjusted or adjusted.get("min_confidence") is None:
                adjusted["min_confidence"] = float((agent or {}).get("auto_approve_threshold", 0.92))
            return True, "", adjusted

        if tool_name == "generate_draft_invoices_or_bills":
            if level in ("copilot", "semi_autonomous") and not explicit_human_command:
                return (
                    False,
                    f"{level} policy requires explicit human approval or Full Autopilot mode before drafting Zoho invoices/bills.",
                    adjusted,
                )
            return True, "", adjusted

        if tool_name == "raise_anomaly_clarification_requests":
            if level == "copilot" and not explicit_human_command:
                adjusted["send_immediately"] = False
            elif is_autonomous_bg and agent is not None and not agent.get("auto_query_anomalies", False):
                adjusted["send_immediately"] = False
            return True, "", adjusted

        if tool_name == "followup_overdue_information_requests":
            if is_autonomous_bg and agent is not None and not agent.get("proactive_SLA_reminders", True):
                return False, "Proactive SLA reminders are disabled in agent policy.", adjusted
            return True, "", adjusted

        sec = str((agent or {}).get("section", "")).upper()
        if sec == "FR" and tool_name in ("post_approved_journal_to_erp", "generate_draft_invoices_or_bills", "categorize_bank_transactions"):
            return False, "Financial Reporting Agent is strictly read-only presentation and disclosure synthesis. Journal posting is disallowed.", adjusted

        if sec == "GL" and tool_name in ("generate_draft_invoices_or_bills", "scan_and_ingest_storage"):
            return False, "GL Accountant Agent scope is strictly reserved for General Ledger & Trial Balance reviews. Operational invoicing is disallowed.", adjusted

        if tool_name == "post_approved_journal_to_erp":
            if level == "copilot" and not explicit_human_command:
                return (
                    False,
                    "Copilot mode requires human authorization before posting manual journals to ERP.",
                    adjusted,
                )
            return True, "", adjusted

        return True, "", adjusted

    # =========================================================================
    # 10 Native Accounting Tools Implementation
    # =========================================================================
    @classmethod
    async def _tool_scan_and_ingest_storage(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        month = str(args.get("month") or datetime.now().strftime("%B")).strip()
        year = int(args.get("year") or datetime.now().year)
        force_reprocess = bool(args.get("force_reprocess", False))
        section = str(agent.get("section", "AR")).upper()
        agent_id = str(agent.get("id", "default"))

        if section == "BANK" or agent.get("source_type") == "bank_feed":
            cv_token = _IN_BANK_SCAN_CV.set(True)
            try:
                from app.api.v1.bank_portal import accountant_sync_bank_feeds
                sync_res = await accountant_sync_bank_feeds(client_id=client.id, month=month, year=str(year))
                newly_synced = int(
                    sync_res.get("synced_new_count", sync_res.get("synced_count", sync_res.get("newly_synced", 0))) or 0
                )
                return {
                    "status": "success",
                    "channel": "bank_feed",
                    "items_extracted": newly_synced,
                    "reconciled_count": int(sync_res.get("reconciled_count", 0) or 0),
                    "message": sanitize_no_em_dash(sync_res.get("message") or f"Synced {newly_synced} bank transactions for {month} {year}."),
                }
            except Exception as e:
                logger.warning(f"Bank feed scan fallback for {client.id}: {e}")
                aliases = cls._get_aliases(client.id)
                existing_cnt = len(list(db.exec(select(BankTransaction).where(BankTransaction.client_id.in_(aliases))).all()))
                return {
                    "status": "partial",
                    "channel": "bank_feed",
                    "items_extracted": 0,
                    "existing_bank_rows": existing_cnt,
                    "message": sanitize_no_em_dash(f"Checked bank feed for {month} {year}; {existing_cnt} existing bank rows present ({e})."),
                }
            finally:
                _IN_BANK_SCAN_CV.reset(cv_token)

        try:
            from app.strategies.dynamic_blueprint import DynamicBlueprintStrategy
            strategy = DynamicBlueprintStrategy(client)
            sources = await strategy.discover_sources(month=month, year=year, pipeline_id=agent_id)
            ext_res = await strategy.extract_and_validate(
                sources=sources,
                force_reprocess=force_reprocess,
                month=month,
                year=year,
                pipeline_id=agent_id,
            )
            if isinstance(ext_res, dict):
                extracted = ext_res.get("extracted", []) or []
                skipped = ext_res.get("skipped", []) or []
            elif isinstance(ext_res, list):
                extracted = list(ext_res)
                skipped = list(getattr(strategy, "skipped_documents", []) or [])
            else:
                extracted = []
                skipped = list(getattr(strategy, "skipped_documents", []) or [])
            if extracted:
                await strategy.sync_review_workspace(
                    month=month,
                    year=year,
                    items=extracted,
                    auto_post=False,
                    pipeline_id=agent_id,
                )
            return {
                "status": "success",
                "sources_discovered": len(sources),
                "items_extracted": len(extracted),
                "duplicates_skipped": len(skipped),
                "message": sanitize_no_em_dash(
                    f"Scanned {len(sources)} source files for {month} {year}; extracted {len(extracted)} items and skipped {len(skipped)} duplicates."
                ),
            }
        except Exception as e:
            logger.warning(f"Storage scan notice for {client.id}/{agent_id}: {e}")
            return {
                "status": "partial",
                "sources_discovered": 0,
                "items_extracted": 0,
                "message": sanitize_no_em_dash(f"Storage scan completed with notice for {month} {year}: {e}"),
            }

    @staticmethod
    def _safe_float(val: Any, default: float = 0.0) -> float:
        if val is None or val == "":
            return default
        try:
            return float(str(val).replace(",", "").strip())
        except (ValueError, TypeError):
            return default

    @classmethod
    async def _download_attachment_bytes(
        cls,
        att: Dict[str, Any],
        file_name: str,
        mime_type: str,
    ) -> Tuple[Optional[bytes], str, Optional[str]]:
        raw_bytes: Optional[bytes] = None
        decode_error: Optional[str] = None
        resolved_mime = str(mime_type or "application/octet-stream").lower()

        if isinstance(att.get("content_bytes"), (bytes, bytearray)):
            raw_bytes = bytes(att["content_bytes"])
        elif att.get("content_base64") or att.get("data_base64") or att.get("base64"):
            b64_val = str(att.get("content_base64") or att.get("data_base64") or att.get("base64"))
            if "," in b64_val and "base64" in b64_val.split(",", 1)[0].lower():
                b64_val = b64_val.split(",", 1)[1]
            try:
                raw_bytes = base64.b64decode(b64_val, validate=False)
            except Exception as dec_err:
                decode_error = f"Invalid base64 encoding: {dec_err}"
                logger.warning(f"Failed base64 decode for {file_name}: {dec_err}")
        elif att.get("content_text") or att.get("text") or att.get("raw_content"):
            raw_text = str(att.get("content_text") or att.get("text") or att.get("raw_content"))
            raw_bytes = raw_text.encode("utf-8")
        elif isinstance(att.get("url"), str) and att["url"].startswith(("http://", "https://")):
            try:
                async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as dl_client:
                    dl_res = await dl_client.get(att["url"])
                    dl_res.raise_for_status()
                    raw_bytes = dl_res.content
                    ct_hdr = (dl_res.headers.get("content-type") or "").split(";")[0].strip().lower()
                    if ct_hdr and resolved_mime == "application/octet-stream":
                        resolved_mime = ct_hdr
            except Exception as url_err:
                decode_error = f"URL download failed: {url_err}"
                logger.warning(f"Failed downloading attachment URL for {file_name}: {url_err}")
        elif att.get("media_id") and getattr(settings, "WHATSAPP_ACCESS_TOKEN", None):
            try:
                headers = {"Authorization": f"Bearer {settings.WHATSAPP_ACCESS_TOKEN}"}
                async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as dl_client:
                    meta_res = await dl_client.get(f"https://graph.facebook.com/v19.0/{att['media_id']}", headers=headers)
                    meta_res.raise_for_status()
                    meta_data = meta_res.json() or {}
                    media_url = meta_data.get("url")
                    if media_url:
                        bin_res = await dl_client.get(media_url, headers=headers)
                        bin_res.raise_for_status()
                        raw_bytes = bin_res.content
                        if resolved_mime == "application/octet-stream":
                            hdr_mime = bin_res.headers.get("content-type", "").split(";")[0].strip()
                            meta_mime = str(meta_data.get("mime_type") or "").split(";")[0].strip()
                            resolved_mime = hdr_mime or meta_mime or resolved_mime
            except Exception as media_err:
                decode_error = f"WhatsApp media download failed: {media_err}"
                logger.warning(f"Failed downloading WhatsApp media_id for {file_name}: {media_err}")

        return raw_bytes, resolved_mime, decode_error

    @classmethod
    def _parse_staged_csv_rows(
        cls,
        raw_bytes: bytes,
        file_name: str,
        pipeline_type: str,
        default_entity: str,
        default_date: str,
    ) -> Tuple[str, List[Dict[str, Any]]]:
        text = raw_bytes.decode("utf-8", errors="replace")
        dict_rows = list(csv.DictReader(io.StringIO(text)))
        fallback_label = "Unknown Vendor" if pipeline_type == "AP" else "Unknown Customer"
        resolved_entity = default_entity
        parsed_lines: List[Dict[str, Any]] = []

        for dr in dict_rows:
            lower_d = {str(k).lower().strip(): v for k, v in dr.items() if k}
            if pipeline_type == "AP":
                ent_val = lower_d.get("vendor") or lower_d.get("vendor_name") or lower_d.get("supplier") or resolved_entity or fallback_label
                qty = cls._safe_float(lower_d.get("qty") or lower_d.get("quantity"), 1.0)
                rate = cls._safe_float(lower_d.get("rate") or lower_d.get("unit_rate") or lower_d.get("amount"), 0.0)
                tot = cls._safe_float(lower_d.get("total") or lower_d.get("amount"), qty * rate)
                item_label = lower_d.get("item") or lower_d.get("description") or file_name
            else:
                ent_val = lower_d.get("customer") or lower_d.get("customer_name") or lower_d.get("hotel") or resolved_entity or fallback_label
                qty = cls._safe_float(lower_d.get("qty") or lower_d.get("quantity") or lower_d.get("pickup_qty"), 1.0)
                rate = cls._safe_float(lower_d.get("rate") or lower_d.get("unit_rate"), 0.0)
                tot = cls._safe_float(lower_d.get("total") or lower_d.get("amount"), qty * rate)
                item_label = lower_d.get("item") or lower_d.get("sku") or lower_d.get("description") or file_name

            resolved_entity = str(ent_val)
            parsed_lines.append({
                "item": item_label,
                "qty": qty,
                "rate": rate if rate > 0 else (tot / qty if qty else tot),
                "total": tot,
                "entity_name": resolved_entity,
                "date": lower_d.get("date") or default_date,
            })

        return resolved_entity, parsed_lines

    @classmethod
    async def _ingest_bank_attachment(
        cls,
        db: Session,
        client: ClientOrganization,
        aliases: List[str],
        att: Dict[str, Any],
        file_name: str,
        mime_type: str,
        raw_bytes: Optional[bytes],
        is_csv_like: bool,
        channel: str,
        sender: str,
        decode_error: Optional[str],
    ) -> Tuple[int, List[Dict[str, Any]], Optional[str]]:
        extracted_rows: List[Dict[str, Any]] = []
        err_msg = decode_error

        if isinstance(att.get("mock_rows"), list):
            extracted_rows = list(att["mock_rows"])
        elif is_csv_like and raw_bytes:
            extracted_rows = _parse_csv_flexible(raw_bytes, file_name)
        elif raw_bytes and not settings.MOCK_MODE and settings.GEMINI_API_KEY:
            try:
                from app.services.ocr_service import GeminiOCRService
                ocr = GeminiOCRService()
                res = await ocr.extract_bank_statement(raw_bytes, mime_type or "application/pdf", file_name)
                for tx in res.transactions:
                    extracted_rows.append({
                        "transaction_date": tx.transaction_date,
                        "description": tx.description,
                        "amount": tx.amount,
                        "transaction_type": tx.transaction_type,
                        "source_file_name": file_name,
                    })
            except Exception as ocr_err:
                err_msg = f"OCR bank statement extraction failed: {ocr_err}"
                logger.warning(f"Bank statement OCR failed for {file_name}: {ocr_err}")
        else:
            if raw_bytes:
                extracted_rows = _parse_csv_flexible(raw_bytes, file_name)
            if not extracted_rows and isinstance(att.get("amount"), (int, float)):
                extracted_rows = [{
                    "transaction_date": datetime.now().strftime("%Y-%m-%d"),
                    "description": f"{channel} attachment bank statement item ({file_name})",
                    "amount": float(att["amount"]),
                    "transaction_type": "DEBIT",
                    "source_file_name": file_name,
                }]

        if not extracted_rows:
            return 0, [], err_msg or "Could not extract any valid bank transactions from attachment."

        staged_count = 0
        previews: List[Dict[str, Any]] = []
        for row in extracted_rows:
            tx_date = str(row.get("transaction_date") or datetime.now().strftime("%Y-%m-%d"))
            desc_val = str(row.get("description") or "").strip()
            amt_val = cls._safe_float(row.get("amount"), 0.0)
            tx_type = str(row.get("transaction_type") or "DEBIT").upper()
            if not desc_val:
                continue
            dup = db.exec(
                select(BankTransaction).where(
                    BankTransaction.client_id.in_(aliases),
                    BankTransaction.transaction_date == tx_date,
                    BankTransaction.description == desc_val,
                    BankTransaction.amount == amt_val,
                )
            ).first()
            if not dup:
                bt = BankTransaction(
                    client_id=client.id,
                    transaction_date=tx_date,
                    description=desc_val,
                    amount=amt_val,
                    transaction_type=tx_type,
                    source_file_name=file_name,
                    bank_account_name=str(att.get("bank_account_name") or f"{channel} Uploaded Statement"),
                    status="UNMAPPED",
                    metadata_json={"ingest_channel": channel, "sender": sender},
                )
                db.add(bt)
                staged_count += 1
                previews.append({"type": "BANK", "description": desc_val, "amount": amt_val})
        db.commit()
        return staged_count, previews, None

    @classmethod
    async def _ingest_entity_document_attachment(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        pipeline_type: str,
        att: Dict[str, Any],
        file_name: str,
        mime_type: str,
        raw_bytes: Optional[bytes],
        is_csv_like: bool,
        channel: str,
        sender: str,
        month: str,
        year: int,
        decode_error: Optional[str],
    ) -> Tuple[int, List[Dict[str, Any]], Optional[str]]:
        is_ap = pipeline_type == "AP"
        entity_name = str(att.get("vendor_name") if is_ap else att.get("customer_name") or "")
        doc_date = resolve_transaction_date(file_name=file_name, target_month=month, target_year=year)
        parsed_lines: List[Dict[str, Any]] = []
        err_msg = decode_error

        if raw_bytes and not is_csv_like and not settings.MOCK_MODE and settings.GEMINI_API_KEY:
            try:
                from app.services.ocr_service import GeminiOCRService
                ocr = GeminiOCRService()
                if is_ap:
                    bill = await ocr.extract_vendor_bill(raw_bytes, mime_type or "image/png", file_name)
                    entity_name = bill.vendor_name or entity_name or "Unknown Vendor"
                    doc_date = resolve_transaction_date(extracted_date=bill.bill_date, file_name=file_name, target_month=month, target_year=year)
                    for li in bill.line_items:
                        parsed_lines.append({
                            "item": li.description,
                            "qty": li.quantity or 1,
                            "rate": li.unit_rate or li.amount or 0.0,
                            "total": li.amount or ((li.quantity or 1) * (li.unit_rate or 0.0)),
                        })
                else:
                    ext = await ocr.extract_slip(
                        file_bytes=raw_bytes,
                        mime_type=mime_type or "image/png",
                        file_name=file_name,
                        client_name=client.name,
                        item_catalog=[],
                    )
                    entity_name = ext.reconciled_customer_name or ext.raw_customer_name or entity_name or "Unknown Customer"
                    doc_date = resolve_transaction_date(extracted_date=ext.slip_date, file_name=file_name, target_month=month, target_year=year)
                    for it in ext.items:
                        rate = float(it.unit_rate or 0.0)
                        qty = float(it.pickup_qty or it.delivery_qty or 1)
                        parsed_lines.append({
                            "item": it.standard_item_name or it.raw_item_name,
                            "qty": qty,
                            "rate": rate,
                            "total": round(qty * rate, 2),
                            "discrepancy": max(0, (it.pickup_qty or 0) - (it.delivery_qty or 0)),
                        })
            except Exception as ocr_err:
                err_msg = f"OCR {'vendor bill' if is_ap else 'slip'} extraction failed: {ocr_err}"
                logger.warning(f"{pipeline_type} OCR failed for {file_name}: {ocr_err}")
        elif is_csv_like and raw_bytes:
            entity_name, parsed_lines = cls._parse_staged_csv_rows(raw_bytes, file_name, pipeline_type, entity_name, doc_date)

        if not parsed_lines and isinstance(att.get("amount"), (int, float)):
            entity_name = entity_name or file_name.rsplit(".", 1)[0].replace("_", " ").title()
            amt_num = float(att["amount"])
            fallback_item = f"Vendor Expense ({file_name})" if is_ap else f"Control Slip Item ({file_name})"
            parsed_lines = [{"item": fallback_item, "qty": 1, "rate": amt_num, "total": amt_num}]

        if not parsed_lines:
            default_reason = (
                "Could not extract any valid Vendor bill line items from attachment."
                if is_ap
                else "Could not extract any valid Customer slip line items from attachment."
            )
            return 0, [], err_msg or default_reason

        agent_id = str(agent.get("id", "default"))
        agent_name = str(agent.get("name", "Accounting Agent"))
        fallback_entity = "Unknown Vendor" if is_ap else "Unknown Customer"
        batch_id = f"{channel.lower()}_att_{uuid.uuid4().hex[:8]}"
        staged_delta = 0
        previews: List[Dict[str, Any]] = []

        for li in parsed_lines:
            ent_label = str(li.get("entity_name") or entity_name or fallback_entity)
            disc_amt = 0.0 if is_ap else cls._safe_float(li.get("discrepancy"), 0.0)
            rate_val = cls._safe_float(li.get("rate"), 0.0)
            meta = (
                {
                    "vendor_name": ent_label,
                    "reconciled_vendor_name": ent_label,
                    "ingest_channel": channel,
                    "sender": sender,
                }
                if is_ap
                else {
                    "raw_customer_name": ent_label,
                    "customer_name": ent_label,
                    "reconciled_customer_name": ent_label,
                    "customer_reconciled": True,
                    "ingest_channel": channel,
                    "sender": sender,
                }
            )
            st = StagedTransaction(
                client_id=client.id,
                batch_id=batch_id,
                pipeline_id=agent_id,
                pipeline_name=agent_name,
                pipeline_type=pipeline_type,
                entity_type="ap_vendor_bill" if is_ap else "ar_sales_invoice",
                transaction_date=str(li.get("date") or doc_date),
                source_type=f"{channel}_ATTACHMENT",
                source_file_name=file_name,
                source_identifier=f"{channel}_{uuid.uuid4().hex[:10]}",
                item_or_description=str(li.get("item") or ("Vendor Expense" if is_ap else "Service Item")),
                quantity_or_debit=cls._safe_float(li.get("qty"), 1.0),
                rate_or_price=rate_val,
                total_amount=cls._safe_float(li.get("total"), 0.0),
                discrepancy_amount=disc_amt,
                confidence_score=0.94 if is_ap else 0.95,
                status="PENDING",
                validation_status="VALID" if rate_val > 0 else "PENDING_VALIDATION_ERROR",
                metadata_json=meta,
            )
            db.add(st)
            staged_delta += 1
            preview_key = "vendor" if is_ap else "customer"
            previews.append({
                "type": pipeline_type,
                preview_key: ent_label,
                "item": st.item_or_description,
                "total": st.total_amount,
            })
        db.commit()
        return staged_delta, previews, None

    @classmethod
    async def _tool_ingest_message_attachments(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        attachments = list(args.get("attachments") or [])
        sender = str(args.get("sender") or "unknown")
        channel = str(args.get("channel") or "EMAIL").upper()
        section = str(agent.get("section", "AR")).upper()
        month = str(args.get("month") or datetime.now().strftime("%B"))
        year = int(args.get("year") or datetime.now().year)

        if not attachments:
            return {
                "status": "no_attachments",
                "files_processed": 0,
                "bank_transactions_staged": 0,
                "staged_transactions_created": 0,
                "rules_applied_count": 0,
                "message": "No file attachments found to ingest.",
            }

        bank_staged = 0
        staged_created = 0
        items_preview: List[Dict[str, Any]] = []
        failed_files: List[Dict[str, str]] = []
        aliases = cls._get_aliases(client.id)

        for idx, att in enumerate(attachments):
            if not isinstance(att, dict):
                continue
            file_name = str(att.get("filename") or att.get("file_name") or att.get("name") or f"attachment_{idx + 1}.bin")
            raw_mime = str(att.get("content_type") or att.get("mime_type") or "application/octet-stream").lower()
            fname_low = file_name.lower()

            raw_bytes, mime_type, decode_error = await cls._download_attachment_bytes(att, file_name, raw_mime)
            has_explicit_structured = isinstance(att.get("mock_rows"), list) or isinstance(att.get("amount"), (int, float))
            if not raw_bytes and not has_explicit_structured:
                failed_files.append({
                    "file_name": file_name,
                    "reason": decode_error or "Attachment content was missing or empty.",
                })
                continue

            is_csv_like = fname_low.endswith((".csv", ".tsv", ".txt")) or "csv" in mime_type
            looks_like_bank = (
                section == "BANK"
                or "bank" in fname_low
                or "statement" in fname_low
                or "momo" in fname_low
                or att.get("document_type") == "bank_statement"
            )
            if is_csv_like and raw_bytes and section not in ("AR", "AP"):
                looks_like_bank = True
            elif is_csv_like and raw_bytes and not looks_like_bank:
                first_line = (raw_bytes.decode("utf-8", errors="replace").splitlines() or [""])[0].lower()
                if any(k in first_line for k in ("narration", "debit", "credit", "balance", "transaction_type")):
                    looks_like_bank = True

            if looks_like_bank:
                delta, previews, err = await cls._ingest_bank_attachment(
                    db, client, aliases, att, file_name, mime_type, raw_bytes, is_csv_like, channel, sender, decode_error
                )
                bank_staged += delta
            else:
                target_ptype = (
                    "AP"
                    if (section == "AP" or "bill" in fname_low or "vendor" in fname_low or "receipt" in fname_low)
                    else "AR"
                )
                delta, previews, err = await cls._ingest_entity_document_attachment(
                    db, client, agent, target_ptype, att, file_name, mime_type, raw_bytes, is_csv_like, channel, sender, month, year, decode_error
                )
                staged_created += delta

            if err:
                failed_files.append({"file_name": file_name, "reason": err})
            else:
                items_preview.extend(previews)

        # Immediately apply learned knowledge rules across newly staged items
        kb_res = await cls._tool_apply_learned_knowledge_retroactively(db, client, agent, {})
        rules_applied = int(kb_res.get("bank_rows_mapped", 0)) + int(kb_res.get("staged_items_healed", 0))

        AuditService.log(
            client_id=client.id,
            action="AGENT_ATTACHMENT_INGESTED",
            actor_email=sender,
            details={
                "channel": channel,
                "files_processed": len(attachments),
                "bank_transactions_staged": bank_staged,
                "staged_transactions_created": staged_created,
                "rules_applied_count": rules_applied,
                "failed_files": failed_files,
            },
        )

        att_status = "success"
        if failed_files and (bank_staged == 0 and staged_created == 0):
            att_status = "error"
        elif failed_files:
            att_status = "partial"

        fail_note = (
            f" Failed/unreadable file(s): {', '.join(f['file_name'] for f in failed_files)}."
            if failed_files
            else ""
        )

        return {
            "status": att_status,
            "files_processed": len(attachments),
            "bank_transactions_staged": bank_staged,
            "staged_transactions_created": staged_created,
            "rules_applied_count": rules_applied,
            "failed_files": failed_files,
            "items_preview": items_preview[:10],
            "message": sanitize_no_em_dash(
                f"Ingested {len(attachments)} {channel} attachment(s): staged {bank_staged} bank row(s) and {staged_created} document line(s), and auto-applied {rules_applied} learned rule match(es).{fail_note}"
            ),
        }

    @classmethod
    async def _tool_apply_learned_knowledge_retroactively(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        aliases = cls._get_aliases(client.id)
        entries = list(
            db.exec(
                select(ClientKnowledgeEntry)
                .where(
                    ClientKnowledgeEntry.client_id.in_(aliases),
                    ClientKnowledgeEntry.is_active == True,
                )
                .order_by(desc(ClientKnowledgeEntry.confidence), desc(ClientKnowledgeEntry.id))
            ).all()
        )
        if not entries:
            return {
                "status": "success",
                "bank_rows_mapped": 0,
                "staged_items_healed": 0,
                "rules_applied": 0,
                "message": "No active knowledge rules found to apply.",
            }

        bank_rows = list(
            db.exec(
                select(BankTransaction).where(
                    BankTransaction.client_id.in_(aliases),
                    BankTransaction.status.in_(["UNMAPPED", "CLARIFICATION_REQUESTED", "CLIENT_ANSWERED"]),
                )
            ).all()
        )
        staged_rows = list(
            db.exec(
                select(StagedTransaction).where(
                    StagedTransaction.client_id.in_(aliases),
                    StagedTransaction.approved == False,
                    StagedTransaction.status.in_(["PENDING", "PENDING_VALIDATION_ERROR"]),
                )
            ).all()
        )

        now_utc = datetime.now(timezone.utc)
        bank_mapped_count = 0
        staged_healed_count = 0
        matched_details: List[Dict[str, Any]] = []
        used_entries: Dict[int, ClientKnowledgeEntry] = {}

        # A. Match COA / Banking Rules onto BankTransactions
        for btx in bank_rows:
            haystack = " ".join(
                p for p in [btx.description or "", btx.payee_name or "", btx.client_explanation or ""] if p
            )
            for entry in entries:
                cat_u = (entry.category or "").upper()
                if cat_u not in ("COA_MAPPING_RULE", "BANK_RULE", "GENERAL_RULE", ""):
                    continue
                pattern = (entry.trigger_pattern or "").strip()
                sdata = dict(entry.structured_data or {})
                target_acct = str(sdata.get("account_name") or entry.target_value or "").strip()
                if not pattern or not target_acct:
                    continue
                if _rule_matches_text(pattern, haystack):
                    btx.mapped_account_name = target_acct
                    btx.mapped_account_id = str(sdata.get("account_id") or btx.mapped_account_id or f"acc_{_slugify(target_acct)}")
                    btx.payee_name = btx.payee_name or str(sdata.get("payee_name") or pattern.title())
                    btx.category_confidence = float(entry.confidence or 0.95)
                    btx.status = "MAPPED"
                    btx.updated_at = now_utc
                    db.add(btx)
                    bank_mapped_count += 1
                    if entry.id is not None:
                        used_entries[entry.id] = entry
                    matched_details.append({"bank_tx_id": btx.id, "description": btx.description, "mapped_to": target_acct})
                    break

        # B. Match Entity Aliases & SKU Pricing Rules onto StagedTransactions (AR/AP)
        for st in staged_rows:
            meta = dict(st.metadata_json or {})
            p_type = (st.pipeline_type or "AR").upper()
            raw_entity = " ".join(
                str(x)
                for x in [
                    meta.get("raw_customer_name") or "",
                    meta.get("customer_name") or "",
                    meta.get("raw_vendor_name") or "",
                    meta.get("vendor_name") or "",
                    st.source_file_name or "",
                ]
                if x
            )
            item_name = str(st.item_or_description or meta.get("raw_item_name") or "")
            changed = False

            for entry in entries:
                cat_u = (entry.category or "").upper()
                pattern = (entry.trigger_pattern or "").strip()
                target = (entry.target_value or "").strip()
                sdata = dict(entry.structured_data or {})
                if not pattern or not target:
                    continue

                if cat_u == "ENTITY_ALIAS" and _rule_matches_text(pattern, raw_entity):
                    if p_type == "AP":
                        if meta.get("reconciled_vendor_name") != target:
                            meta["reconciled_vendor_name"] = target
                            meta["vendor_name"] = target
                            meta["vendor_reconciled"] = True
                            changed = True
                    else:
                        if meta.get("reconciled_customer_name") != target:
                            meta["reconciled_customer_name"] = target
                            meta["customer_name"] = target
                            meta["customer_reconciled"] = True
                            changed = True
                    if st.validation_status == "PENDING_CUSTOMER_MAPPING":
                        st.validation_status = "VALID"
                        st.validation_errors = []
                    if st.status == "PENDING_VALIDATION_ERROR":
                        st.status = "PENDING"
                    if entry.id is not None:
                        used_entries[entry.id] = entry

                elif cat_u == "SKU_PRICING_RULE" and _rule_matches_text(pattern, item_name):
                    price = _extract_numeric_price(str(sdata.get("unit_rate") or sdata.get("rate") or sdata.get("price") or target))
                    if price and (abs(float(st.rate_or_price or 0.0) - price) > 0.001):
                        st.rate_or_price = price
                        qty = float(st.quantity_or_debit or 1.0)
                        st.total_amount = round(qty * price, 2)
                        if st.validation_status == "PENDING_VALIDATION_ERROR" and float(st.discrepancy_amount or 0.0) == 0.0:
                            st.validation_status = "VALID"
                            st.validation_errors = []
                        if st.status == "PENDING_VALIDATION_ERROR":
                            st.status = "PENDING"
                        changed = True
                        if entry.id is not None:
                            used_entries[entry.id] = entry

            if changed:
                st.metadata_json = meta
                flag_modified(st, "metadata_json")
                db.add(st)
                staged_healed_count += 1
                matched_details.append({"staged_tx_id": st.id, "item": st.item_or_description, "healed": True})

        for entry in used_entries.values():
            entry.usage_count = int(entry.usage_count or 0) + 1
            entry.last_applied_at = now_utc
            entry.updated_at = now_utc
            db.add(entry)

        db.commit()
        total_applied = bank_mapped_count + staged_healed_count

        return {
            "status": "success",
            "bank_rows_mapped": bank_mapped_count,
            "staged_items_healed": staged_healed_count,
            "rules_applied": total_applied,
            "matched_details": matched_details[:15],
            "message": sanitize_no_em_dash(
                f"Retroactively applied {len(used_entries)} active rule(s): mapped {bank_mapped_count} bank transaction(s) and healed {staged_healed_count} staged item(s)."
            ),
        }

    @classmethod
    async def _tool_auto_approve_verified_transactions(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        aliases = cls._get_aliases(client.id)
        min_confidence = float(args.get("min_confidence") if args.get("min_confidence") is not None else agent.get("auto_approve_threshold", 0.92))
        filter_entity = str(args.get("customer_or_vendor") or args.get("customer_name") or args.get("vendor_name") or "").strip().lower()
        month = args.get("month")
        year = int(args["year"]) if args.get("year") else None

        section = str(agent.get("section", "AR")).upper()
        query = select(StagedTransaction).where(
            StagedTransaction.client_id.in_(aliases),
            StagedTransaction.approved == False,
            StagedTransaction.status.in_(["PENDING"]),
        )
        if section in ("AR", "AP"):
            query = query.where(StagedTransaction.pipeline_type == section)

        candidates = list(db.exec(query).all())
        approved_ids: List[int] = []
        skipped_count = 0

        from app.api.v1.clients import matches_month_and_year

        for tx in candidates:
            if month or year:
                if not matches_month_and_year(tx.transaction_date, tx.batch_id, tx.source_file_name, str(month) if month else None, year):
                    continue
            if filter_entity:
                entity_label = _extract_entity_label(tx).lower()
                raw_file = str(tx.source_file_name or "").lower()
                if filter_entity not in entity_label and filter_entity not in raw_file:
                    continue

            conf = float(tx.confidence_score if tx.confidence_score is not None else 0.95)
            val_ok = (tx.validation_status or "VALID") not in ("PENDING_VALIDATION_ERROR", "PENDING_CUSTOMER_MAPPING")
            rate_ok = float(tx.rate_or_price or 0.0) > 0 and float(tx.total_amount or 0.0) > 0
            disc_ok = abs(float(tx.discrepancy_amount or 0.0)) < 0.01

            if conf >= min_confidence and val_ok and rate_ok and disc_ok:
                tx.reviewed = True
                tx.approved = True
                tx.status = "APPROVED"
                db.add(tx)
                if tx.id is not None:
                    approved_ids.append(tx.id)
            else:
                skipped_count += 1

        db.commit()

        if approved_ids:
            AuditService.log(
                client_id=client.id,
                action="AGENT_AUTO_APPROVED_TRANSACTIONS",
                details={
                    "agent_id": agent.get("id"),
                    "approved_count": len(approved_ids),
                    "min_confidence": min_confidence,
                    "filter_entity": filter_entity or None,
                },
            )

        return {
            "status": "success",
            "approved_count": len(approved_ids),
            "skipped_count": skipped_count,
            "approved_ids": approved_ids[:25],
            "message": sanitize_no_em_dash(
                f"Auto-approved {len(approved_ids)} verified transaction(s) meeting confidence >= {min_confidence:.2f} (skipped {skipped_count} needing review)."
            ),
        }

    @classmethod
    async def _tool_categorize_bank_transactions(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        aliases = cls._get_aliases(client.id)
        pattern = str(args.get("payee_or_description") or args.get("pattern") or "").strip()
        account_name = str(args.get("account_name") or "").strip()
        account_id = str(args.get("account_id") or (f"acc_{_slugify(account_name)}" if account_name else "")).strip()
        match_all = bool(args.get("match_all", False))
        learn_rule = bool(args.get("learn_rule", True))

        if not account_name:
            return {
                "status": "error",
                "categorized_count": 0,
                "message": "Target Chart of Accounts category name is required.",
            }
        if not pattern and not match_all:
            return {
                "status": "error",
                "categorized_count": 0,
                "message": "Payee or description filter is required to categorize bank transactions.",
            }

        candidates = list(
            db.exec(
                select(BankTransaction).where(
                    BankTransaction.client_id.in_(aliases),
                    BankTransaction.status.in_(["UNMAPPED", "CLARIFICATION_REQUESTED", "CLIENT_ANSWERED"]),
                )
            ).all()
        )

        now_utc = datetime.now(timezone.utc)
        cat_count = 0
        for btx in candidates:
            haystack = f"{btx.description or ''} {btx.payee_name or ''}".strip()
            if match_all or _rule_matches_text(pattern, haystack):
                btx.mapped_account_name = account_name
                btx.mapped_account_id = account_id
                btx.payee_name = btx.payee_name or (pattern.title() if pattern else "Matched Payee")
                btx.category_confidence = 0.96
                btx.status = "MAPPED"
                btx.updated_at = now_utc
                db.add(btx)
                cat_count += 1

        db.commit()

        if learn_rule and pattern:
            try:
                ClientKnowledgeService.upsert_knowledge_entry(
                    db,
                    client_id=client.id,
                    agent_id=str(agent.get("id") or "") or None,
                    section="BANK",
                    category="COA_MAPPING_RULE",
                    title=f"Map {pattern} -> {account_name}",
                    trigger_pattern=pattern,
                    target_value=account_name,
                    rule_content=f"Categorize transactions matching '{pattern}' to '{account_name}'.",
                    structured_data={"account_id": account_id, "account_name": account_name},
                    source="AGENT_COMMAND",
                    confidence=0.96,
                    created_by="autonomous_agent",
                )
            except Exception as kb_err:
                logger.warning(f"Notice recording learned rule during bank categorization: {kb_err}")

        return {
            "status": "success",
            "categorized_count": cat_count,
            "pattern": pattern or "*",
            "account_name": account_name,
            "message": sanitize_no_em_dash(
                f"Categorized {cat_count} bank transaction(s) matching '{pattern or 'ALL'}' to '{account_name}'."
            ),
        }

    @classmethod
    async def _tool_raise_anomaly_clarification_requests(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        aliases = cls._get_aliases(client.id)
        send_immediately = bool(args.get("send_immediately", True))
        min_amount = float(args.get("min_amount", 0.0) or 0.0)
        section = str(agent.get("section", "AR")).upper()

        bank_anomalies: List[BankTransaction] = []
        if section in ("BANK", "ALL"):
            bank_anomalies = list(
                db.exec(
                    select(BankTransaction).where(
                        BankTransaction.client_id.in_(aliases),
                        BankTransaction.status == "UNMAPPED",
                    )
                ).all()
            )
            bank_anomalies = [b for b in bank_anomalies if float(b.amount or 0.0) >= min_amount]

        staged_anomalies = list(
            db.exec(
                select(StagedTransaction).where(
                    StagedTransaction.client_id.in_(aliases),
                    StagedTransaction.approved == False,
                    StagedTransaction.status.in_(["PENDING", "PENDING_VALIDATION_ERROR"]),
                )
            ).all()
        )
        if section in ("AR", "AP"):
            staged_anomalies = [t for t in staged_anomalies if (t.pipeline_type or "AR").upper() == section]
        staged_anomalies = [
            t
            for t in staged_anomalies
            if abs(float(t.discrepancy_amount or 0.0)) > 0
            or (t.validation_status or "VALID") in ("PENDING_VALIDATION_ERROR", "PENDING_CUSTOMER_MAPPING", "VALIDATION_WARNINGS", "ANOMALY")
            or float(t.rate_or_price or 0.0) <= 0
        ]

        dispatched = 0
        drafted = 0
        now_utc = datetime.now(timezone.utc)
        anomaly_items: List[Dict[str, Any]] = []

        for b in bank_anomalies:
            anomaly_items.append({"type": "BANK_UNMAPPED", "id": b.id, "description": b.description, "amount": b.amount})
            if send_immediately:
                b.status = "CLARIFICATION_REQUESTED"
                b.accountant_query = b.accountant_query or f"Please clarify the purpose and GL category for '{b.description}' ({b.amount:.2f})."
                b.query_date = now_utc
                b.updated_at = now_utc
                db.add(b)
                dispatched += 1
            else:
                drafted += 1

        for t in staged_anomalies:
            t_meta = dict(t.metadata_json or {})
            if t_meta.get("query_status") in ("CLARIFICATION_REQUESTED", "CLIENT_ANSWERED"):
                continue
            ent_lbl = _extract_entity_label(t)
            anomaly_items.append({
                "type": f"{(t.pipeline_type or 'AR').upper()}_ANOMALY",
                "id": t.id,
                "entity": ent_lbl,
                "item": t.item_or_description,
                "discrepancy": t.discrepancy_amount,
            })
            if send_immediately:
                t_meta["query_status"] = "CLARIFICATION_REQUESTED"
                t_meta["query_date"] = now_utc.isoformat()
                t_meta["accountant_query"] = (
                    t_meta.get("accountant_query")
                    or f"Please clarify discrepancy/pricing for {ent_lbl} ({t.item_or_description or t.source_file_name or 'Document line'})."
                )
                t.metadata_json = t_meta
                flag_modified(t, "metadata_json")
                db.add(t)
                dispatched += 1
            else:
                drafted += 1

        if dispatched > 0:
            db.commit()
            target_email = (client.custom_config or {}).get("contact_email") or client.source_email
            if target_email:
                try:
                    await MailjetService.send_email(
                        to_email=target_email,
                        subject=f"[{client.name}] Clarification Needed for {dispatched} Transaction(s)",
                        html_content=f"<p>Hello,</p><p>Your accounting agent flagged {dispatched} transaction/document item(s) requiring clarification via the Client Portal.</p>",
                        text_content=f"Your accounting agent flagged {dispatched} transaction/document item(s) for clarification.",
                    )
                except Exception as mail_err:
                    logger.warning(f"Non-fatal email error during clarification dispatch: {mail_err}")

        staged_flagged_cnt = sum(1 for it in anomaly_items if it["type"] != "BANK_UNMAPPED")
        return {
            "status": "success" if send_immediately else "drafted_only",
            "queries_dispatched": dispatched,
            "drafted_queries_count": drafted,
            "bank_anomalies_count": len(bank_anomalies),
            "staged_anomalies_count": staged_flagged_cnt,
            "items": anomaly_items[:15],
            "message": sanitize_no_em_dash(
                f"Dispatched {dispatched} clarification request(s) across {len(bank_anomalies)} bank item(s) and {staged_flagged_cnt} document anomaly item(s)"
                + (f" ({drafted} query drafts held for human review in copilot/draft policy mode)." if drafted else ".")
            ),
        }

    @classmethod
    async def _tool_followup_overdue_information_requests(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        aliases = cls._get_aliases(client.id)
        overdue_hours = float(args.get("overdue_hours", 72) or 72)
        section = str(agent.get("section", "AR")).upper()
        now_utc = datetime.now(timezone.utc)

        open_queries: List[BankTransaction] = []
        if section in ("BANK", "ALL"):
            open_queries = list(
                db.exec(
                    select(BankTransaction).where(
                        BankTransaction.client_id.in_(aliases),
                        BankTransaction.status == "CLARIFICATION_REQUESTED",
                    )
                ).all()
            )
        open_staged = list(
            db.exec(
                select(StagedTransaction).where(
                    StagedTransaction.client_id.in_(aliases),
                    StagedTransaction.approved == False,
                    StagedTransaction.status.in_(["PENDING", "PENDING_VALIDATION_ERROR"]),
                )
            ).all()
        )
        if section in ("AR", "AP"):
            open_staged = [s for s in open_staged if (s.pipeline_type or "AR").upper() == section]

        overdue_bank_rows: List[BankTransaction] = []
        for b in open_queries:
            ref_dt = _parse_dt_utc(b.query_date or b.updated_at or b.created_at)
            if ref_dt and (now_utc - ref_dt).total_seconds() >= overdue_hours * 3600:
                overdue_bank_rows.append(b)

        overdue_staged_rows: List[StagedTransaction] = []
        for st in open_staged:
            st_meta = dict(st.metadata_json or {})
            if st_meta.get("query_status") != "CLARIFICATION_REQUESTED":
                continue
            ref_dt = _parse_dt_utc(st_meta.get("query_date") or st.created_at)
            if ref_dt and (now_utc - ref_dt).total_seconds() >= overdue_hours * 3600:
                overdue_staged_rows.append(st)

        total_overdue = len(overdue_bank_rows) + len(overdue_staged_rows)
        reminders_sent = 0
        if total_overdue > 0:
            target_email = (client.custom_config or {}).get("contact_email") or client.source_email or "client@example.com"
            try:
                await MailjetService.send_email(
                    to_email=target_email,
                    subject=f"[{client.name}] Reminder: {total_overdue} Overdue Clarification Request(s)",
                    html_content=f"<p>Hello,</p><p>This is an automated follow-up for {total_overdue} clarification request(s) pending for over {int(overdue_hours)} hours.</p>",
                    text_content=f"Reminder: {total_overdue} clarification request(s) have been pending over {int(overdue_hours)} hours.",
                )
            except Exception as mail_err:
                logger.warning(f"Reminder dispatch notice: {mail_err}")

            for b in overdue_bank_rows:
                meta = dict(b.metadata_json or {})
                meta["last_sla_reminder_at"] = now_utc.isoformat()
                meta["sla_reminder_count"] = int(meta.get("sla_reminder_count", 0)) + 1
                b.metadata_json = meta
                flag_modified(b, "metadata_json")
                db.add(b)
                reminders_sent += 1

            for st in overdue_staged_rows:
                st_meta = dict(st.metadata_json or {})
                st_meta["last_sla_reminder_at"] = now_utc.isoformat()
                st_meta["sla_reminder_count"] = int(st_meta.get("sla_reminder_count", 0)) + 1
                st.metadata_json = st_meta
                flag_modified(st, "metadata_json")
                db.add(st)
                reminders_sent += 1

            db.commit()

            AuditService.log(
                client_id=client.id,
                action="AGENT_OVERDUE_SLA_REMINDERS_SENT",
                details={"overdue_hours": overdue_hours, "reminders_sent": reminders_sent},
            )

        overdue_items = (
            [{"type": "BANK", "id": b.id, "description": b.description, "amount": b.amount} for b in overdue_bank_rows[:6]]
            + [
                {
                    "type": (s.pipeline_type or "AR").upper(),
                    "id": s.id,
                    "description": f"{_extract_entity_label(s)}: {s.item_or_description}",
                    "amount": s.total_amount,
                }
                for s in overdue_staged_rows[:6]
            ]
        )

        return {
            "status": "success",
            "overdue_count": total_overdue,
            "reminders_sent": reminders_sent,
            "overdue_items": overdue_items[:10],
            "message": sanitize_no_em_dash(
                f"Checked clarification requests (> {int(overdue_hours)}h SLA): found {total_overdue} overdue item(s) and sent {reminders_sent} reminder(s)."
            ),
        }

    @staticmethod
    def _parse_month_num(month: Any) -> int:
        raw = str(month or "").strip()
        if not raw:
            return datetime.now().month
        low = raw.lower()
        if low in MONTH_MAP:
            return MONTH_MAP[low]
        m_iso = re.match(r"^\d{4}-(\d{1,2})$", low)
        if m_iso:
            n = int(m_iso.group(1))
            if 1 <= n <= 12:
                return n
        for token in re.split(r"[\s\-_/]+", low):
            if token in MONTH_MAP:
                return MONTH_MAP[token]
        try:
            n = int(low)
            if 1 <= n <= 12:
                return n
        except (TypeError, ValueError):
            pass
        return datetime.now().month

    @classmethod
    def _resolve_draft_doc_date(
        cls,
        client: ClientOrganization,
        agent: Dict[str, Any],
        month: str,
        year: int,
        explicit_date: Optional[str] = None,
    ) -> str:
        if explicit_date and str(explicit_date).strip():
            return str(explicit_date).strip()

        month_num = cls._parse_month_num(month)
        eff_year = int(year) if year else datetime.now(timezone.utc).year
        last_day = calendar.monthrange(eff_year, month_num)[1]
        custom_cfg = client.custom_config if isinstance(client.custom_config, dict) else {}
        agent_src = agent.get("source_config") if isinstance(agent.get("source_config"), dict) else {}
        nested_agent = (
            agent_src.get("invoicing_date_settings")
            if isinstance(agent_src.get("invoicing_date_settings"), dict)
            else {}
        )
        nested_custom = (
            custom_cfg.get("invoicing_date_settings")
            if isinstance(custom_cfg.get("invoicing_date_settings"), dict)
            else {}
        )

        if agent_src.get("override_date_rules"):
            raw_rule = (
                nested_agent.get("invoice_date_rule")
                or agent_src.get("invoice_date_rule")
                or "last_day_of_month"
            )
            fixed_day_raw = next(
                (
                    v
                    for v in (
                        nested_agent.get("fixed_invoice_day"),
                        nested_agent.get("fixed_day"),
                        agent_src.get("fixed_invoice_day"),
                        agent_src.get("fixed_day"),
                    )
                    if v is not None and str(v).strip() != ""
                ),
                None,
            )
        else:
            raw_rule = (
                nested_custom.get("invoice_date_rule")
                or custom_cfg.get("invoice_date_rule")
                or "last_day_of_month"
            )
            fixed_day_raw = next(
                (
                    v
                    for v in (
                        nested_custom.get("fixed_invoice_day"),
                        nested_custom.get("fixed_day"),
                        custom_cfg.get("fixed_invoice_day"),
                        custom_cfg.get("fixed_day"),
                    )
                    if v is not None and str(v).strip() != ""
                ),
                None,
            )

        rule = str(raw_rule).strip().lower()

        if rule in ("first_day_next_month", "first_day_of_next_month", "first_day_following_month"):
            next_month = 1 if month_num == 12 else month_num + 1
            next_year = eff_year + 1 if month_num == 12 else eff_year
            return f"{next_year:04d}-{next_month:02d}-01"

        if rule == "today":
            return datetime.now(timezone.utc).strftime("%Y-%m-%d")

        if rule == "fixed_day" and fixed_day_raw is not None:
            try:
                day_int = max(1, min(int(fixed_day_raw), last_day))
                return f"{eff_year:04d}-{month_num:02d}-{day_int:02d}"
            except (TypeError, ValueError):
                pass

        return f"{eff_year:04d}-{month_num:02d}-{last_day:02d}"

    @classmethod
    async def _draft_ar_invoice_group(
        cls,
        db: Session,
        zoho: Any,
        ent_name: str,
        rows: List[StagedTransaction],
        month: str,
        year: int,
        doc_date: str,
        next_seq: int,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        from app.models.schemas import ZohoDraftInvoiceRequest, ZohoInvoiceLineItem

        contact = zoho.find_contact_by_name(ent_name)
        if not contact and zoho.can_transact() and not settings.MOCK_MODE:
            try:
                contact = await zoho.create_customer_contact(ent_name)
            except Exception as cust_err:
                logger.warning(f"Customer contact resolution failed for '{ent_name}': {cust_err}")
                return None, f"Customer '{ent_name}': {cust_err}"
        if zoho.can_transact() and not settings.MOCK_MODE and not (contact and contact.contact_id):
            return None, f"Customer '{ent_name}': could not resolve Zoho Customer contact_id."

        contact_id = contact.contact_id if contact else f"cnt_auto_{_slugify(ent_name)[:16]}"
        line_items: List[ZohoInvoiceLineItem] = []
        for r in rows:
            raw_qty = float(r.quantity_or_debit or 1.0)
            raw_rate = float(r.rate_or_price or 0.0)
            if raw_qty >= 1.0 and abs(raw_qty - round(raw_qty)) < 1e-6:
                int_qty = int(round(raw_qty))
                eff_rate = raw_rate
            else:
                int_qty = 1
                eff_rate = round(float(r.total_amount or (raw_qty * raw_rate)), 2)
            line_items.append(
                ZohoInvoiceLineItem(
                    item_id=str(r.accounting_ref_id or f"item_{_slugify(str(r.item_or_description or 'service'))[:12]}"),
                    name=str(r.item_or_description or "Service Item"),
                    rate=eff_rate,
                    quantity=int_qty,
                )
            )

        month_num = cls._parse_month_num(month)
        req = ZohoDraftInvoiceRequest(
            customer_id=contact_id,
            date=doc_date,
            line_items=line_items,
            notes=f"Auto-drafted by S4 Autonomous Agent for {month} {year}.",
        )
        if settings.MOCK_MODE or zoho.can_transact():
            try:
                inv_res = await zoho.create_or_append_draft_invoice(req, month=month, year=year)
                doc_num = getattr(inv_res, "invoice_number", "DRAFT") or "DRAFT"
            except Exception as inv_err:
                logger.warning(f"Zoho AR draft invoice creation failed for '{ent_name}': {inv_err}")
                return None, f"Customer '{ent_name}': {inv_err}"
        else:
            doc_num = f"DRAFT-{year}-{month_num:02d}-{next_seq:03d}"

        for r in rows:
            r.status = "INVOICED"
            db.add(r)

        return {
            "entity_role": "Customer",
            "entity_name": ent_name,
            "document_number": doc_num,
            "date": doc_date,
            "total": round(sum(float(r.total_amount or 0.0) for r in rows), 2),
        }, None

    @classmethod
    async def _draft_ap_bill_group(
        cls,
        db: Session,
        zoho: Any,
        ent_name: str,
        rows: List[StagedTransaction],
        month: str,
        year: int,
        doc_date: str,
        next_seq: int,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        from app.models.schemas import ZohoDraftBillRequest

        month_num = cls._parse_month_num(month)
        doc_num = f"BILL-{year}-{month_num:02d}-{next_seq:03d}"
        if zoho.can_transact() and not settings.MOCK_MODE:
            try:
                vendor = await zoho.find_or_create_vendor_contact(ent_name)
            except Exception as vnd_err:
                logger.warning(f"Vendor contact resolution failed for '{ent_name}': {vnd_err}")
                return None, f"Vendor '{ent_name}': {vnd_err}"
            if not (vendor and vendor.contact_id):
                return None, f"Vendor '{ent_name}': could not resolve Zoho Vendor contact_id."
            bill_req = ZohoDraftBillRequest(
                vendor_id=vendor.contact_id,
                date=doc_date,
                line_items=[
                    {
                        "name": str(r.item_or_description or "Vendor Expense"),
                        "rate": float(r.rate_or_price or 0.0),
                        "quantity": float(r.quantity_or_debit or 1.0),
                        "account_name": r.category_or_account or "Cost of Goods Sold",
                    }
                    for r in rows
                ],
                notes=f"Auto-drafted Vendor bill by S4 Autonomous Agent for {month} {year}.",
            )
            try:
                bill_res = await zoho.create_draft_bill(bill_req)
                doc_num = getattr(bill_res, "bill_number", doc_num) or doc_num
            except Exception as bill_err:
                logger.warning(f"Zoho AP draft bill creation failed for '{ent_name}': {bill_err}")
                return None, f"Vendor '{ent_name}': {bill_err}"

        for r in rows:
            r.status = "BILLED"
            db.add(r)

        return {
            "entity_role": "Vendor",
            "entity_name": ent_name,
            "document_number": doc_num,
            "date": doc_date,
            "total": round(sum(float(r.total_amount or 0.0) for r in rows), 2),
        }, None

    @classmethod
    async def _tool_generate_draft_invoices_or_bills(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        month = str(args.get("month") or datetime.now().strftime("%B")).strip()
        year = int(args.get("year") or datetime.now().year)
        customer_name = args.get("customer_name") or args.get("vendor_name")
        mode = str(args.get("mode") or "append").strip()
        section = str(agent.get("section", "AR")).upper()
        agent_id = str(agent.get("id", "default"))
        aliases = cls._get_aliases(client.id)

        target_ptype = "AP" if section == "AP" else "AR"
        approved_rows = list(
            db.exec(
                select(StagedTransaction).where(
                    StagedTransaction.client_id.in_(aliases),
                    StagedTransaction.pipeline_type == target_ptype,
                    StagedTransaction.status == "APPROVED",
                )
            ).all()
        )

        from app.api.v1.clients import matches_month_and_year

        filtered_rows: List[StagedTransaction] = []
        for row in approved_rows:
            if month or year:
                if not matches_month_and_year(row.transaction_date, row.batch_id, row.source_file_name, month, year):
                    continue
            if customer_name:
                ent = _extract_entity_label(row).lower()
                if str(customer_name).strip().lower() not in ent and str(customer_name).strip().lower() not in str(row.source_file_name or "").lower():
                    continue
            filtered_rows.append(row)

        drafted_docs = 0
        draft_details: List[Dict[str, Any]] = []
        draft_errors: List[str] = []
        doc_date = cls._resolve_draft_doc_date(
            client,
            agent,
            month,
            year,
            explicit_date=args.get("doc_date") or args.get("invoice_date"),
        )

        if filtered_rows:
            from app.services.zoho_service import ZohoBooksService

            zoho = ZohoBooksService.from_client_id(client.id)
            if target_ptype == "AR" and zoho.can_transact() and not settings.MOCK_MODE:
                try:
                    await zoho.fetch_active_contacts()
                except Exception as prefetch_err:
                    logger.warning(f"Prefetch Zoho Customer contacts failed: {prefetch_err}")

            grouped: Dict[str, List[StagedTransaction]] = {}
            for row in filtered_rows:
                grouped.setdefault(_extract_entity_label(row), []).append(row)

            for ent_name, rows in grouped.items():
                if target_ptype == "AR":
                    detail, err_msg = await cls._draft_ar_invoice_group(
                        db, zoho, ent_name, rows, month, year, doc_date, len(draft_details) + 1
                    )
                else:
                    detail, err_msg = await cls._draft_ap_bill_group(
                        db, zoho, ent_name, rows, month, year, doc_date, len(draft_details) + 1
                    )
                if err_msg:
                    draft_errors.append(err_msg)
                elif detail:
                    drafted_docs += 1
                    draft_details.append(detail)
            db.commit()

        # Fallback: if no staged DB rows matched and live client uses Google Sheets AR workflow
        client_src_cfg = client.source_config if isinstance(client.source_config, dict) else {}
        fallback_sheet_id = client_src_cfg.get("sheet_id")
        if drafted_docs == 0 and target_ptype == "AR" and fallback_sheet_id:
            try:
                from app.workflows.zoho_invoice_generator import run_zoho_invoices_core
                res = await run_zoho_invoices_core(
                    target_month=month,
                    target_year=year,
                    explicit_sheet_id=fallback_sheet_id,
                    filter_client_name=str(customer_name) if customer_name else None,
                    mode=mode,
                    invoice_date=doc_date,
                )
                drafted_docs = int(res.get("drafts_created", res.get("invoices_created", 0)) or 0)
            except Exception as sheet_err:
                logger.warning(f"Sheet invoice fallback notice: {sheet_err}")

        if drafted_docs > 0:
            AuditService.log(
                client_id=client.id,
                action="AGENT_DRAFTED_ACCOUNTING_DOCS",
                details={"agent_id": agent_id, "section": target_ptype, "drafted_count": drafted_docs, "month": month, "year": year, "doc_date": doc_date},
            )

        role_word = "Vendor bill(s)" if target_ptype == "AP" else "Customer invoice(s)"
        final_status = "error" if (draft_errors and drafted_docs == 0) else ("partial" if draft_errors else "success")
        err_suffix = f" Errors: {'; '.join(draft_errors)}" if draft_errors else ""
        return {
            "status": final_status,
            "invoices_drafted": drafted_docs,
            "month": month,
            "year": year,
            "doc_date": doc_date,
            "details": draft_details,
            "errors": draft_errors,
            "message": sanitize_no_em_dash(f"Drafted {drafted_docs} {role_word} for {month} {year}.{err_suffix}"),
        }

    @classmethod
    async def _tool_reconcile_storage_vs_ledger(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        month = str(args.get("month") or datetime.now().strftime("%B")).strip()
        year = int(args.get("year") or datetime.now().year)
        agent_id = str(agent.get("id", "default"))
        aliases = cls._get_aliases(client.id)

        staged = list(db.exec(select(StagedTransaction).where(StagedTransaction.client_id.in_(aliases))).all())
        banks = list(db.exec(select(BankTransaction).where(BankTransaction.client_id.in_(aliases))).all())
        staged_files = {s.source_file_name for s in staged if s.source_file_name}

        drive_files: List[Dict[str, Any]] = []
        try:
            if not settings.MOCK_MODE and client.folder_id:
                from app.strategies.dynamic_blueprint import DynamicBlueprintStrategy
                strategy = DynamicBlueprintStrategy(client)
                drive_files = await strategy.discover_sources(month=month, year=year, pipeline_id=agent_id)
        except Exception as e:
            logger.debug(f"Reconcile storage check notice: {e}")

        missing_in_ledger = [d.get("name") for d in drive_files if d.get("name") and d.get("name") not in staged_files]
        unreconciled = [s for s in staged if s.validation_status in ("PENDING_CUSTOMER_MAPPING", "PENDING_VALIDATION_ERROR")]
        discrepancy_rows = [s for s in staged if abs(float(s.discrepancy_amount or 0.0)) > 0]
        unmapped_bank = [b for b in banks if b.status == "UNMAPPED"]

        return {
            "status": "success",
            "month": month,
            "year": year,
            "drive_files_count": len(drive_files),
            "staged_files_count": len(staged_files),
            "missing_in_ledger": missing_in_ledger,
            "unreconciled_entities_count": len(unreconciled),
            "discrepancy_rows_count": len(discrepancy_rows),
            "unmapped_bank_count": len(unmapped_bank),
            "message": sanitize_no_em_dash(
                f"Reconciled {month} {year}: {len(staged_files)} staged document(s), {len(missing_in_ledger)} missing in ledger, "
                f"{len(unreconciled)} unmapped entity item(s), {len(discrepancy_rows)} discrepancy row(s), and {len(unmapped_bank)} unmapped bank row(s)."
            ),
        }

    @classmethod
    async def _tool_query_ledger_analytics(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        aliases = cls._get_aliases(client.id)
        month = args.get("month")
        year = int(args["year"]) if args.get("year") else None
        entity_filter = str(args.get("customer_or_vendor") or "").strip().lower()
        status_filter = str(args.get("status") or "").strip().upper()
        section = str(agent.get("section", "AR")).upper()

        staged = list(db.exec(select(StagedTransaction).where(StagedTransaction.client_id.in_(aliases))).all())
        banks = list(db.exec(select(BankTransaction).where(BankTransaction.client_id.in_(aliases))).all())

        from app.api.v1.clients import matches_month_and_year

        matched_staged = []
        for s in staged:
            if month or year:
                if not matches_month_and_year(s.transaction_date, s.batch_id, s.source_file_name, str(month) if month else None, year):
                    continue
            if status_filter and (s.status or "").upper() != status_filter:
                continue
            if entity_filter and entity_filter not in _extract_entity_label(s).lower():
                continue
            matched_staged.append(s)

        matched_banks = []
        for b in banks:
            if month or year:
                if not matches_month_and_year(b.transaction_date, None, b.source_file_name, str(month) if month else None, year):
                    continue
            if status_filter and (b.status or "").upper() != status_filter:
                continue
            if entity_filter and entity_filter not in f"{b.description or ''} {b.payee_name or ''}".lower():
                continue
            matched_banks.append(b)

        entity_totals: Dict[str, float] = {}
        for s in matched_staged:
            lbl = _extract_entity_label(s)
            entity_totals[lbl] = round(entity_totals.get(lbl, 0.0) + float(s.total_amount or 0.0), 2)

        bank_status_counts: Dict[str, int] = {}
        for b in matched_banks:
            bank_status_counts[b.status] = bank_status_counts.get(b.status, 0) + 1

        role_plural = "Vendors" if section == "AP" else "Customers"
        return {
            "status": "success",
            "staged_count": len(matched_staged),
            "staged_total_amount": round(sum(float(s.total_amount or 0.0) for s in matched_staged), 2),
            "entity_role": role_plural,
            "by_entity": entity_totals,
            "bank_count": len(matched_banks),
            "bank_total_amount": round(sum(float(b.amount or 0.0) for b in matched_banks), 2),
            "bank_by_status": bank_status_counts,
            "message": sanitize_no_em_dash(
                f"Analytics snapshot: {len(matched_staged)} staged document line(s) across {len(entity_totals)} {role_plural} "
                f"(Total: {round(sum(float(s.total_amount or 0.0) for s in matched_staged), 2):,.2f}) and {len(matched_banks)} bank transaction(s) ({bank_status_counts})."
            ),
        }

    # === GL Accountant & Financial Reporting Native Tools ===
    @classmethod
    async def _tool_fetch_trial_balance_and_gl(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        from app.services.gl_closing_service import GLClosingService
        month = args.get("month") or "October"
        year = int(args.get("year") or datetime.now(timezone.utc).year)
        tb = await GLClosingService.fetch_trial_balance(db, client, month=month, year=year)
        return {
            "status": "success",
            "trial_balance": tb,
            "accounts_count": len(tb.get("accounts", [])),
            "total_debits": tb.get("total_debits", 0.0),
            "total_credits": tb.get("total_credits", 0.0),
            "is_balanced": tb.get("is_balanced", False),
            "message": sanitize_no_em_dash(
                f"Fetched Trial Balance for {month} {year}: {len(tb.get('accounts', []))} accounts. "
                f"Debits: {tb.get('total_debits'):,.2f}, Credits: {tb.get('total_credits'):,.2f} "
                f"(Balanced: {tb.get('is_balanced')})."
            ),
        }

    @classmethod
    async def _tool_audit_closing_adjustments(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        from app.services.gl_closing_service import GLClosingService
        month = args.get("month") or "October"
        year = int(args.get("year") or datetime.now(timezone.utc).year)
        adjustments = await GLClosingService.audit_closing_adjustments(db, client, month=month, year=year)
        return {
            "status": "success",
            "adjustments_count": len(adjustments),
            "suggested_adjustments": adjustments,
            "message": sanitize_no_em_dash(
                f"GL Closing Audit completed for {month} {year}: Identified {len(adjustments)} required "
                f"closing adjustments (Depreciation, Prepayments, Accruals, FX, Tax Provision)."
            ),
        }

    @classmethod
    async def _tool_formulate_manual_journal(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        adjustment = dict(args.get("adjustment") or args)
        entries = adjustment.get("journal_entries") or []
        total_deb = sum(float(e.get("amount", 0.0)) for e in entries if e.get("debit_or_credit") == "debit")
        total_cred = sum(float(e.get("amount", 0.0)) for e in entries if e.get("debit_or_credit") == "credit")
        is_balanced = abs(total_deb - total_cred) < 0.01
        if not is_balanced:
            return {
                "status": "error",
                "message": f"Journal does not balance! Debits ({total_deb:.2f}) != Credits ({total_cred:.2f}).",
            }
        return {
            "status": "success",
            "title": adjustment.get("title", "Proposed Manual Journal"),
            "total_debit": round(total_deb, 2),
            "total_credit": round(total_cred, 2),
            "is_balanced": is_balanced,
            "journal_entries": entries,
            "message": sanitize_no_em_dash(
                f"Balanced manual journal formulated: {len(entries)} lines, Total {total_deb:,.2f}."
            ),
        }

    @classmethod
    async def _tool_attach_working_paper(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        from app.services.gl_closing_service import GLClosingService
        month = args.get("month") or "October"
        year = int(args.get("year") or datetime.now(timezone.utc).year)
        adjustment = dict(args.get("adjustment") or args)
        auto_approve = bool(args.get("auto_approve", False))
        if not adjustment.get("journal_entries"):
            adjs = await GLClosingService.audit_closing_adjustments(db, client, month=month, year=year)
            created_papers = []
            for adj in adjs:
                wp = await GLClosingService.create_working_paper(
                    db=db,
                    client=client,
                    adjustment=adj,
                    month=month,
                    year=year,
                    prepared_by=agent.get("name", "gl_accountant_agent"),
                    auto_approve=auto_approve,
                )
                created_papers.append({
                    "paper_id": wp.paper_id,
                    "title": wp.title,
                    "adjustment_type": wp.adjustment_type,
                    "total_debit": wp.total_debit,
                    "status": wp.status,
                })
            return {
                "status": "success",
                "created_count": len(created_papers),
                "working_papers": created_papers,
                "message": sanitize_no_em_dash(
                    f"Created and attached {len(created_papers)} working paper(s) with calculation schedules and white paper memos."
                ),
            }

        wp = await GLClosingService.create_working_paper(
            db=db,
            client=client,
            adjustment=adjustment,
            month=month,
            year=year,
            prepared_by=agent.get("name", "gl_accountant_agent"),
            auto_approve=auto_approve,
        )
        return {
            "status": "success",
            "paper_id": wp.paper_id,
            "title": wp.title,
            "adjustment_type": wp.adjustment_type,
            "total_debit": wp.total_debit,
            "status": wp.status,
            "memo_length": len(wp.memo_markdown or ""),
            "message": sanitize_no_em_dash(
                f"Attached Working Paper '{wp.paper_id}' ({wp.title}) with technical white paper memo and calculation schedules."
            ),
        }

    @classmethod
    async def _tool_post_approved_journal_to_erp(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        from app.services.gl_closing_service import GLClosingService
        paper_id = args.get("paper_id")
        if not paper_id:
            wp = db.exec(
                select(ManualJournalWorkingPaper)
                .where(ManualJournalWorkingPaper.client_id == client.id)
                .order_by(desc(ManualJournalWorkingPaper.created_at))
            ).first()
            if not wp:
                return {"status": "error", "message": "No manual journal working paper found to post."}
            paper_id = wp.paper_id

        res = await GLClosingService.post_working_paper_to_erp(
            db=db,
            client=client,
            paper_id=paper_id,
            approved_by=agent.get("name", "gl_accountant_agent"),
        )
        return {
            "status": "success",
            "journal_details": res,
            "message": sanitize_no_em_dash(
                f"Journal posted to ERP for Working Paper '{paper_id}': Reference {res.get('journal_reference')}, Total {res.get('total_debit'):,.2f}."
            ),
        }

    @classmethod
    async def _tool_run_subledger_tie_out(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        from app.services.gl_closing_service import GLClosingService
        month = args.get("month") or "October"
        year = int(args.get("year") or datetime.now(timezone.utc).year)
        tie_out = await GLClosingService.run_inter_agent_subledger_tie_out(db, client, month=month, year=year)
        all_tied = tie_out.get("all_subledgers_tied_out", False)
        return {
            "status": "success",
            "all_subledgers_tied_out": all_tied,
            "tie_out_summary": tie_out,
            "message": sanitize_no_em_dash(
                f"Subledger tie-out for {month} {year}: All Subledgers Tied Out = {all_tied}. "
                f"AR: {tie_out.get('accounts_receivable', {}).get('status')}, "
                f"AP: {tie_out.get('accounts_payable', {}).get('status')}, "
                f"Bank: {tie_out.get('bank_reconciliation', {}).get('status')} "
                f"(Suspense cleared: {tie_out.get('bank_reconciliation', {}).get('suspense_cleared')})."
            ),
        }

    @classmethod
    async def _tool_run_pre_flight_close_review(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        from app.services.gl_closing_service import GLClosingService
        month = args.get("month") or "October"
        year = int(args.get("year") or datetime.now(timezone.utc).year)
        review = await GLClosingService.pre_flight_close_review(db, client, month=month, year=year)
        accounts_audited = int(review.get("total_gl_accounts_audited") or review.get("accounts_audited_count") or 0)
        uncovered = int(review.get("uncovered_accounts_found") or review.get("uncovered_accounts_count") or 0)
        anomalies = int(review.get("contra_anomalies_found") or review.get("contra_anomalies_count") or 0)
        new_steps = int(review.get("new_steps_integrated") or len(review.get("dynamically_added_steps", [])))
        return {
            "status": "success",
            "checklist_id": review.get("checklist_id"),
            "accounts_audited_count": accounts_audited,
            "total_gl_accounts_audited": accounts_audited,
            "uncovered_accounts_count": uncovered,
            "contra_anomalies_count": anomalies,
            "dynamically_added_steps": new_steps,
            "coverage_percentage": review.get("coverage_percentage", 100.0),
            "message": sanitize_no_em_dash(
                f"Pre-Flight Discovery Review for {month} {year}: Audited {accounts_audited} accounts. "
                f"Discovered {uncovered} unmapped accounts and {anomalies} contra-anomalies. "
                f"Added {new_steps} tailored closing steps."
            ),
        }

    @classmethod
    async def _tool_execute_close_runbook(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        from app.services.gl_closing_service import GLClosingService
        month = args.get("month") or "October"
        year = int(args.get("year") or datetime.now(timezone.utc).year)
        checklist_id = args.get("checklist_id")
        if not checklist_id:
            cl = await GLClosingService.get_or_create_period_checklist(db, client, month, year)
            checklist_id = cl.checklist_id

        auto_post = bool(args.get("auto_post", False)) or (agent.get("autonomy_level") == "full_autonomous")
        res = await GLClosingService.execute_close_runbook(db, client, checklist_id, auto_post=auto_post)
        return {
            "status": "success",
            "checklist_id": res.get("checklist_id"),
            "completed_steps": res.get("completed_steps"),
            "total_steps": res.get("total_steps"),
            "exceptions_count": res.get("exceptions_count"),
            "post_close_verification": res.get("post_close_verification"),
            "message": sanitize_no_em_dash(
                f"Executed Month-End Close Runbook '{checklist_id}': {res.get('completed_steps')}/{res.get('total_steps')} steps completed "
                f"({res.get('exceptions_count')} exceptions). Verification Status: {res.get('post_close_verification', {}).get('status')}."
            ),
        }

    @classmethod
    async def _tool_verify_post_closing_equilibrium(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        from app.services.gl_closing_service import GLClosingService
        month = args.get("month") or "October"
        year = int(args.get("year") or datetime.now(timezone.utc).year)
        checklist_id = args.get("checklist_id")
        if not checklist_id:
            cl = await GLClosingService.get_or_create_period_checklist(db, client, month, year)
            checklist_id = cl.checklist_id

        res = await GLClosingService.verify_post_posting_equilibrium(db, client, checklist_id)
        return {
            "status": "success",
            "certificate_id": res.get("certificate_id"),
            "is_balanced": res.get("is_balanced"),
            "suspense_cleared": res.get("suspense_cleared"),
            "verification_status": res.get("status"),
            "message": sanitize_no_em_dash(
                f"Post-Posting Equilibrium Verification: Certificate {res.get('certificate_id')} - "
                f"Balanced: {res.get('is_balanced')}, Suspense Cleared: {res.get('suspense_cleared')}. {res.get('narrative')}"
            ),
        }

    @classmethod
    async def _tool_dispatch_controller_inquiry(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        from app.services.gl_closing_service import GLClosingService
        checklist_id = args.get("checklist_id")
        step_id = args.get("step_id") or "step_pre_flight_unmapped"
        question_text = args.get("question_text") or "Please confirm accounting classification and policy for period-end adjustments."
        target_channel = args.get("target_channel") or "EMAIL"
        if not checklist_id:
            month = args.get("month") or "October"
            year = int(args.get("year") or datetime.now(timezone.utc).year)
            cl = await GLClosingService.get_or_create_period_checklist(db, client, month, year)
            checklist_id = cl.checklist_id

        res = await GLClosingService.dispatch_autonomous_inquiry(
            db=db,
            client=client,
            checklist_id=checklist_id,
            step_id=step_id,
            question_text=question_text,
            target_channel=target_channel,
        )
        return {
            "status": "success",
            "inquiry": res,
            "message": sanitize_no_em_dash(
                f"Dispatched Controller Inquiry via {target_channel} to {res.get('recipient')} for Step '{step_id}'."
            ),
        }

    @classmethod
    async def _tool_generate_financial_statement_pack(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        from app.services.financial_reporting_service import FinancialReportingService
        month = args.get("month") or "October"
        year = int(args.get("year") or datetime.now(timezone.utc).year)
        framework = args.get("reporting_framework") or "IFRS"
        report = await FinancialReportingService.synthesize_statement_pack(
            db=db,
            client=client,
            period_type=args.get("period_type", "MONTHLY"),
            period_month=month,
            period_quarter=args.get("period_quarter"),
            period_year=year,
            reporting_framework=framework,
            prepared_by=agent.get("name", "financial_reporting_agent"),
        )
        return {
            "status": "success",
            "report_id": report.report_id,
            "report_title": report.report_title,
            "net_profit": report.income_statement.get("net_profit_for_period"),
            "total_assets": report.balance_sheet.get("total_assets"),
            "is_balanced": report.balance_sheet.get("is_balanced"),
            "message": sanitize_no_em_dash(
                f"Generated Financial Statement Pack '{report.report_id}' ({report.report_title}): "
                f"Net Profit {report.income_statement.get('net_profit_for_period'):,.2f}, Total Assets {report.balance_sheet.get('total_assets'):,.2f} "
                f"(Balance Sheet Balanced: {report.balance_sheet.get('is_balanced')})."
            ),
        }

    @classmethod
    async def _tool_compile_notes_and_disclosures(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        report_id = args.get("report_id")
        query = select(FinancialStatementReport).where(FinancialStatementReport.client_id == client.id)
        if report_id:
            query = query.where(FinancialStatementReport.report_id == report_id)
        report = db.exec(query.order_by(desc(FinancialStatementReport.created_at))).first()
        if not report:
            return {"status": "error", "message": "No financial report found. Run generate_financial_statement_pack first."}
        return {
            "status": "success",
            "report_id": report.report_id,
            "notes_count": len(report.notes_to_accounts or []),
            "notes": report.notes_to_accounts,
            "message": sanitize_no_em_dash(
                f"Compiled {len(report.notes_to_accounts or [])} statutory notes and disclosure sub-schedules for {report.report_title}."
            ),
        }

    @classmethod
    async def _tool_compute_financial_ratios_and_commentary(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        report_id = args.get("report_id")
        query = select(FinancialStatementReport).where(FinancialStatementReport.client_id == client.id)
        if report_id:
            query = query.where(FinancialStatementReport.report_id == report_id)
        report = db.exec(query.order_by(desc(FinancialStatementReport.created_at))).first()
        if not report:
            return {"status": "error", "message": "No financial report found. Run generate_financial_statement_pack first."}
        return {
            "status": "success",
            "report_id": report.report_id,
            "ratios": report.financial_ratios,
            "commentary": report.executive_commentary,
            "message": sanitize_no_em_dash(
                f"Computed financial ratios (Current Ratio: {report.financial_ratios.get('liquidity', {}).get('current_ratio')}x, "
                f"Net Margin: {report.financial_ratios.get('profitability', {}).get('net_profit_margin_pct')}%) and MD&A executive commentary."
            ),
        }

    @classmethod
    async def execute_tool(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        tool_name: str,
        tool_input: Dict[str, Any],
    ) -> Dict[str, Any]:
        dispatch_map: Dict[str, Callable[..., Any]] = {
            "scan_and_ingest_storage": cls._tool_scan_and_ingest_storage,
            "ingest_message_attachments": cls._tool_ingest_message_attachments,
            "apply_learned_knowledge_retroactively": cls._tool_apply_learned_knowledge_retroactively,
            "auto_approve_verified_transactions": cls._tool_auto_approve_verified_transactions,
            "categorize_bank_transactions": cls._tool_categorize_bank_transactions,
            "raise_anomaly_clarification_requests": cls._tool_raise_anomaly_clarification_requests,
            "followup_overdue_information_requests": cls._tool_followup_overdue_information_requests,
            "generate_draft_invoices_or_bills": cls._tool_generate_draft_invoices_or_bills,
            "reconcile_storage_vs_ledger": cls._tool_reconcile_storage_vs_ledger,
            "query_ledger_analytics": cls._tool_query_ledger_analytics,
            # GL Accountant Agent Tools
            "fetch_trial_balance_and_gl": cls._tool_fetch_trial_balance_and_gl,
            "audit_closing_adjustments": cls._tool_audit_closing_adjustments,
            "formulate_manual_journal": cls._tool_formulate_manual_journal,
            "attach_working_paper": cls._tool_attach_working_paper,
            "post_approved_journal_to_erp": cls._tool_post_approved_journal_to_erp,
            "run_subledger_tie_out": cls._tool_run_subledger_tie_out,
            "run_pre_flight_close_review": cls._tool_run_pre_flight_close_review,
            "execute_close_runbook": cls._tool_execute_close_runbook,
            "verify_post_closing_equilibrium": cls._tool_verify_post_closing_equilibrium,
            "dispatch_controller_inquiry": cls._tool_dispatch_controller_inquiry,
            # Financial Reporting Agent Tools
            "generate_financial_statement_pack": cls._tool_generate_financial_statement_pack,
            "compile_notes_and_disclosures": cls._tool_compile_notes_and_disclosures,
            "compute_financial_ratios_and_commentary": cls._tool_compute_financial_ratios_and_commentary,
        }
        fn = dispatch_map.get(tool_name)
        if not fn:
            return {"status": "error", "message": f"Unknown tool '{tool_name}'."}
        return await fn(db, client, agent, tool_input)

    # =========================================================================
    # Planner (Gemini Function/JSON Planner + Deterministic Intent Router)
    # =========================================================================
    @classmethod
    def _extract_month_year_from_text(cls, text: str) -> Tuple[Optional[str], Optional[int]]:
        low = str(text or "").lower()
        found_month = None
        for m_key in [
            "january", "february", "march", "april", "may", "june",
            "july", "august", "september", "october", "november", "december",
            "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
        ]:
            if re.search(rf"\b{m_key}\b", low):
                m_idx = MONTH_MAP[m_key]
                full_names = [
                    "January", "February", "March", "April", "May", "June",
                    "July", "August", "September", "October", "November", "December",
                ]
                found_month = full_names[m_idx - 1]
                break
        yr_m = re.search(r"\b(20\d{2})\b", low)
        found_year = int(yr_m.group(1)) if yr_m else None
        return found_month, found_year

    @classmethod
    def _parse_categorize_command(cls, goal: str) -> Optional[Dict[str, str]]:
        # Supports forms like:
        # "Categorize all ECG debits to 5020 - Electricity Expense"
        # "Map MTN Momo fuel debits to 5040 - Fuel"
        # "Classify Vodafone transactions under 5030 - Internet & Telecoms"
        pattern = re.compile(
            r"(?:categorize|categorise|map|classify|reclassify|assign)\s+(?:all\s+)?(.+?)\s+"
            r"(?:transactions?|txns?|debits?|credits?|charges?|expenses?|payments?)?\s*(?:to|under|as|into)\s+(.+?)"
            r"(?=\s+(?:and|then)\s+(?:auto[- ]?approve|approve|generate|draft|send|follow|raise|scan|reconcile|check)\b|[;.]|$)",
            re.IGNORECASE,
        )
        m = pattern.search(goal.strip().rstrip("."))
        if not m:
            return None
        subj = re.sub(r"^(?:all|any)\s+", "", m.group(1).strip(), flags=re.IGNORECASE)
        subj = re.sub(r"\s+(?:transactions?|txns?|debits?|credits?|charges?|expenses?|payments?)$", "", subj, flags=re.IGNORECASE).strip()
        target = m.group(2).strip().rstrip(".")
        if subj and target:
            return {"payee_or_description": subj, "account_name": target}
        return None

    @classmethod
    def _parse_entity_target(cls, goal: str, keywords: Tuple[str, ...]) -> Optional[str]:
        low = goal.strip()
        months = {
            "january", "february", "march", "april", "may", "june",
            "july", "august", "september", "october", "november", "december",
        }
        generic_exact = {
            "all", "valid", "verified", "approved", "pending", "slips", "slip",
            "invoices", "invoice", "bills", "bill", "transactions", "transaction",
            "draft", "drafts", "entries", "entry", "items", "item", "records", "record",
            "policy", "autonomy", "cycle", "status", "ledger", "rules",
        } | months
        noise_tokens = {
            "within", "autonomy", "policy", "cycle", "agent", "rules", "knowledge",
            "storage", "overdue", "clarifications", "status", "ledger", "threshold",
            "transactions", "transaction", "slips", "invoices", "bills",
        }
        for kw in keywords:
            m = re.search(
                rf"\b{re.escape(kw)}\b\s+"
                r"(?:all\s+|verified\s+|valid\s+|approved\s+|pending\s+|transactions?\s+|slips?\s+|bills?\s+|invoices?\s+|entries?\s+|items?\s+|records?\s+|for\s+)*"
                r"([A-Za-z0-9 &'\-]+?)"
                r"(?:\s+(?:slips?|bills?|invoices?|transactions?|entries?|items?|records?|for|in|from|during|with|within|using|under|across|before|after)\b|[.,():]|$)",
                low,
                re.IGNORECASE,
            )
            if m:
                cand = m.group(1).strip()
                cand_low = cand.lower()
                tokens = cand_low.split()
                if not cand or cand_low in generic_exact:
                    continue
                if any(tok in noise_tokens for tok in tokens):
                    continue
                if len(tokens) == 2 and tokens[0] in months and re.fullmatch(r"\d{4}", tokens[1]):
                    continue
                if re.fullmatch(r"\d+", cand):
                    continue
                return cand
        return None

    @classmethod
    def looks_like_actionable_command(cls, text: str, has_attachments: bool = False) -> bool:
        if has_attachments:
            return True
        low = str(text or "").strip().lower()
        if not low:
            return False
        command_verbs = (
            "approve ", "auto-approve", "auto approve",
            "categorize ", "categorise ", "reclassify ",
            "scan drive", "scan onedrive", "scan storage", "sync bank", "pull bank", "fetch slips",
            "generate draft", "create draft", "draft invoice", "draft bill", "create invoice", "post invoice",
            "send reminder", "follow up", "followup", "overdue",
            "raise query", "raise clarification", "ask client", "query unmapped",
            "apply knowledge", "apply rule", "apply learned", "heal unmapped", "retroactive",
            "reconcile", "run cycle", "run autonomous", "execute goal",
        )
        return any(v in low for v in command_verbs)

    @classmethod
    def _deterministic_plan(
        cls,
        goal: str,
        agent: Dict[str, Any],
        ledger_state: Dict[str, Any],
        month: Optional[str] = None,
        year: Optional[int] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
        sender: str = "",
        channel: str = "UI",
    ) -> List[Dict[str, Any]]:
        steps: List[Dict[str, Any]] = []
        low = str(goal or "").lower()
        parsed_month, parsed_year = cls._extract_month_year_from_text(goal)
        eff_month = month or parsed_month
        eff_year = year or parsed_year
        section = str(agent.get("section", "AR")).upper()

        if section == "GL":
            # GL Accountant Agent Plan: Full Autonomous Month-End Close Runbook or Specific Action
            steps.append({
                "thought": f"Pulling General Ledger accounts and Trial Balance for {eff_month or 'closing period'} {eff_year or ''}.",
                "tool_name": "fetch_trial_balance_and_gl",
                "tool_input": {"month": eff_month, "year": eff_year},
            })
            steps.append({
                "thought": f"Cross-checking subledgers (AR Customers, AP Vendors, Bank feed) against control accounts and verifying zero suspense balance.",
                "tool_name": "run_subledger_tie_out",
                "tool_input": {"month": eff_month, "year": eff_year},
            })
            steps.append({
                "thought": f"Performing pre-flight close review to audit 100% of GL accounts, identify uncovered balances, and detect contra-anomalies.",
                "tool_name": "run_pre_flight_close_review",
                "tool_input": {"month": eff_month, "year": eff_year},
            })
            steps.append({
                "thought": f"Executing tailored Month-End Close Runbook procedures with calculation schedules and technical white papers.",
                "tool_name": "execute_close_runbook",
                "tool_input": {
                    "month": eff_month,
                    "year": eff_year,
                    "auto_post": ("post" in low or agent.get("autonomy_level") == "full_autonomous"),
                },
            })
            steps.append({
                "thought": "Verifying post-posting equilibrium, zero suspense clearance, and issuing digital verification certificate.",
                "tool_name": "verify_post_closing_equilibrium",
                "tool_input": {"month": eff_month, "year": eff_year},
            })
            return steps

        if section == "FR":
            # Financial Reporting Agent Plan: Synthesize statements, notes, ratios (strictly read-only)
            steps.append({
                "thought": f"Synthesizing Income Statement, Balance Sheet, Indirect Cash Flow, and Statement of Changes in Equity for {eff_month or 'period'} {eff_year or ''}.",
                "tool_name": "generate_financial_statement_pack",
                "tool_input": {"month": eff_month, "year": eff_year, "reporting_framework": "IFRS"},
            })
            steps.append({
                "thought": "Compiling statutory accounting policy notes and disclosure sub-schedules.",
                "tool_name": "compile_notes_and_disclosures",
                "tool_input": {},
            })
            steps.append({
                "thought": "Computing liquidity, solvency, and profitability ratios with MD&A executive performance commentary.",
                "tool_name": "compute_financial_ratios_and_commentary",
                "tool_input": {},
            })
            return steps

        if attachments:
            steps.append({
                "thought": f"Inbound {channel} message includes {len(attachments)} attachment(s); ingesting files and applying learned rules first.",
                "tool_name": "ingest_message_attachments",
                "tool_input": {
                    "attachments": attachments,
                    "sender": sender,
                    "channel": channel,
                    "month": eff_month,
                    "year": eff_year,
                },
            })

        is_full_cycle = any(k in low for k in ("autonomous cycle", "full cycle", "close", "heartbeat", "scheduled")) or not low.strip()

        if any(k in low for k in ("scan", "sync bank", "fetch", "ingest drive", "pull ", "onedrive")) or is_full_cycle:
            steps.append({
                "thought": f"Scanning configured storage/feeds for {eff_month or 'current month'} to stage any newly arrived items.",
                "tool_name": "scan_and_ingest_storage",
                "tool_input": {"month": eff_month, "year": eff_year, "force_reprocess": False},
            })

        cat_cmd = cls._parse_categorize_command(goal)
        if cat_cmd:
            steps.append({
                "thought": f"User instructed categorizing '{cat_cmd['payee_or_description']}' transactions to '{cat_cmd['account_name']}'.",
                "tool_name": "categorize_bank_transactions",
                "tool_input": {
                    "payee_or_description": cat_cmd["payee_or_description"],
                    "account_name": cat_cmd["account_name"],
                    "learn_rule": True,
                },
            })

        # Split chained sentences on ' and ' or ';' for multi-action commands like:
        # "Categorize ECG debits to 5020 - Electricity and auto-approve valid Kempinski slips"
        if any(k in low for k in ("apply", "knowledge", "rule", "heal", "retroactive", "map unmapped")) or is_full_cycle or (
            cat_cmd is None and ledger_state.get("active_knowledge_rules", 0) > 0 and (ledger_state.get("bank_unmapped", 0) > 0 or ledger_state.get("staged_pending", 0) > 0)
        ):
            if agent.get("auto_apply_knowledge", True) or "apply" in low or "heal" in low or "rule" in low:
                steps.append({
                    "thought": f"Checking {ledger_state.get('active_knowledge_rules', 0)} active ClientKnowledgeEntry rules against unmapped bank rows and pending staged items.",
                    "tool_name": "apply_learned_knowledge_retroactively",
                    "tool_input": {},
                })

        if any(k in low for k in ("approve", "auto-approve", "auto approve", "verify valid")) or is_full_cycle:
            cust_filter = None if is_full_cycle else cls._parse_entity_target(goal, ("approve", "auto-approve", "auto approve"))
            steps.append({
                "thought": f"Evaluating verified {section} transactions against contract validation and confidence threshold.",
                "tool_name": "auto_approve_verified_transactions",
                "tool_input": {
                    "min_confidence": float(agent.get("auto_approve_threshold", 0.92)),
                    "customer_or_vendor": cust_filter,
                    "month": eff_month,
                    "year": eff_year,
                },
            })

        if any(k in low for k in ("clarif", "query", "anomal", "ask client", "flag ")) or is_full_cycle:
            steps.append({
                "thought": "Scanning for unmapped bank rows and staged discrepancies that require client clarification.",
                "tool_name": "raise_anomaly_clarification_requests",
                "tool_input": {"send_immediately": True, "min_amount": 0.0},
            })

        if any(k in low for k in ("overdue", "reminder", "follow up", "followup", "sla")) or is_full_cycle:
            steps.append({
                "thought": "Checking clarification requests against the 72-hour SLA window for overdue follow-up reminders.",
                "tool_name": "followup_overdue_information_requests",
                "tool_input": {"overdue_hours": 72},
            })

        if any(k in low for k in ("draft", "invoice", "bill", "zoho", "quickbooks", "xero", "post ")) or is_full_cycle:
            cust_filter = None if is_full_cycle else cls._parse_entity_target(
                goal,
                ("invoice for", "invoices for", "bill for", "bills for", "draft for", "drafts for", "slips for", "slip for", "transactions for"),
            )
            steps.append({
                "thought": f"Checking approved {section} transactions ready for Zoho draft generation.",
                "tool_name": "generate_draft_invoices_or_bills",
                "tool_input": {
                    "month": eff_month,
                    "year": eff_year,
                    "customer_name": cust_filter,
                    "mode": "append",
                },
            })

        if any(k in low for k in ("reconcile", "missing slip", "compare storage", "audit")):
            steps.append({
                "thought": "Reconciling source storage inventory against PostgreSQL/SQLite staged ledger records.",
                "tool_name": "reconcile_storage_vs_ledger",
                "tool_input": {"month": eff_month, "year": eff_year},
            })

        if not steps or any(k in low for k in ("summary", "breakdown", "status", "how much", "total", "report", "analytic", "check")):
            steps.append({
                "thought": "Querying live ledger analytics to compile accurate verified metrics.",
                "tool_name": "query_ledger_analytics",
                "tool_input": {"month": eff_month, "year": eff_year},
            })

        # Deduplicate preserving order
        seen = set()
        deduped: List[Dict[str, Any]] = []
        for s in steps:
            key = (s["tool_name"], json.dumps(s["tool_input"], sort_keys=True, default=str))
            if key not in seen:
                seen.add(key)
                deduped.append(s)
        return deduped[:8]

    @staticmethod
    def _canonical_tool_key(tool_name: str, tool_input: Dict[str, Any]) -> Tuple[str, str]:
        normalized: Dict[str, Any] = {}
        for k, v in sorted((tool_input or {}).items()):
            if k == "attachments" and isinstance(v, list):
                att_sigs = []
                for att in v:
                    if isinstance(att, dict):
                        fname = str(att.get("filename") or att.get("file_name") or att.get("name") or "")
                        raw_b = att.get("content_bytes")
                        if isinstance(raw_b, (bytes, bytearray)):
                            b_len = len(raw_b)
                        else:
                            b_len = len(str(att.get("content_base64") or att.get("content_text") or att.get("url") or ""))
                        att_sigs.append((fname, b_len))
                    else:
                        att_sigs.append(str(att))
                normalized[k] = att_sigs
            else:
                normalized[k] = v
        return (str(tool_name), json.dumps(normalized, sort_keys=True, default=str))

    @classmethod
    def _get_active_knowledge_summaries(
        cls,
        db: Session,
        client_id: str,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        aliases = cls._get_aliases(client_id)
        entries = list(
            db.exec(
                select(ClientKnowledgeEntry)
                .where(
                    ClientKnowledgeEntry.client_id.in_(aliases),
                    ClientKnowledgeEntry.is_active == True,
                )
                .order_by(desc(ClientKnowledgeEntry.id))
            ).all()
        )[:limit]
        return [
            {
                "id": k.id,
                "section": k.section,
                "category": k.category,
                "title": sanitize_no_em_dash(k.title or ""),
                "trigger_pattern": k.trigger_pattern,
                "target_value": k.target_value,
                "rule_content": sanitize_no_em_dash((k.rule_content or "")[:300]),
            }
            for k in entries
        ]

    @classmethod
    def _deterministic_followup_plan(
        cls,
        goal: str,
        agent: Dict[str, Any],
        ledger_state: Dict[str, Any],
        prior_observations: List[Dict[str, Any]],
        turn_index: int,
        seen_executions: set,
        month: Optional[str] = None,
        year: Optional[int] = None,
        autonomy_level: str = "semi_autonomous",
        trigger_type: str = "MANUAL_UI",
        explicit_human_command: bool = False,
    ) -> Tuple[List[Dict[str, Any]], bool, str]:
        prev_obs = [o for o in prior_observations if o.get("react_turn") == turn_index - 1]
        newly_staged = any(
            int(o.get("items_extracted", 0) or 0) > 0
            or int(o.get("bank_transactions_staged", 0) or 0) > 0
            or int(o.get("staged_transactions_created", 0) or 0) > 0
            for o in prev_obs
            if o.get("tool_name") in ("scan_and_ingest_storage", "ingest_message_attachments")
        )
        if not newly_staged:
            return [], True, "No newly staged or extracted items require follow-up actions."

        parsed_month, parsed_year = cls._extract_month_year_from_text(goal)
        eff_month = month or parsed_month
        eff_year = year or parsed_year
        section = str(agent.get("section", "AR")).upper()
        candidates: List[Dict[str, Any]] = []

        if (
            ledger_state.get("active_knowledge_rules", 0) > 0
            and (ledger_state.get("bank_unmapped", 0) > 0 or ledger_state.get("staged_pending", 0) > 0)
            and agent.get("auto_apply_knowledge", True)
        ):
            candidates.append({
                "thought": "Turn 2 follow-up: newly staged items detected; applying active learned knowledge rules retroactively.",
                "tool_name": "apply_learned_knowledge_retroactively",
                "tool_input": {},
            })

        if section in ("AR", "AP") and ledger_state.get("staged_pending", 0) > 0:
            approve_input = {
                "min_confidence": float(agent.get("auto_approve_threshold", 0.92)),
                "customer_or_vendor": None,
                "month": eff_month,
                "year": eff_year,
            }
            allowed, _, _ = cls.check_tool_policy(
                tool_name="auto_approve_verified_transactions",
                tool_input=approve_input,
                autonomy_level=autonomy_level,
                trigger_type=trigger_type,
                explicit_human_command=explicit_human_command,
                agent=agent,
            )
            if allowed:
                candidates.append({
                    "thought": f"Turn 2 follow-up: evaluating {ledger_state.get('staged_pending', 0)} newly staged {section} item(s) within '{autonomy_level}' policy.",
                    "tool_name": "auto_approve_verified_transactions",
                    "tool_input": approve_input,
                })

        candidates.append({
            "thought": "Turn 2 verification: querying updated ledger analytics after ingest and follow-up processing.",
            "tool_name": "query_ledger_analytics",
            "tool_input": {"month": eff_month, "year": eff_year},
        })

        filtered = [
            step for step in candidates
            if cls._canonical_tool_key(step["tool_name"], step.get("tool_input") or {}) not in seen_executions
        ]
        if not filtered:
            return [], True, "All Turn 2 follow-up tools already executed."
        return filtered[:8], True, "Executing Turn 2 follow-up verification steps."

    @classmethod
    async def _plan_goal_actions(
        cls,
        goal: str,
        client: ClientOrganization,
        agent: Dict[str, Any],
        ledger_state: Dict[str, Any],
        month: Optional[str] = None,
        year: Optional[int] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
        sender: str = "",
        channel: str = "UI",
        prior_observations: Optional[List[Dict[str, Any]]] = None,
        knowledge_rules: Optional[List[Dict[str, Any]]] = None,
        turn_index: int = 1,
        seen_executions: Optional[set] = None,
        autonomy_level: str = "semi_autonomous",
        trigger_type: str = "MANUAL_UI",
        explicit_human_command: bool = False,
        allow_gemini: bool = True,
    ) -> Tuple[List[Dict[str, Any]], bool, str, bool]:
        """
        Plans the next ReAct turn's actions given fresh ledger state, active knowledge rules,
        and prior execution observations.
        Returns (steps, done_after_steps, final_thought, gemini_active).
        """
        prior_obs_list = list(prior_observations or [])
        rules_list = list(knowledge_rules or [])
        seen_set = seen_executions if seen_executions is not None else set()

        gemini_configured = (
            allow_gemini
            and not settings.MOCK_MODE
            and bool(settings.GEMINI_API_KEY)
            and bool(goal.strip())
        )
        # On Turn 1 with attachments in live Gemini mode, ingest files safely first so Turn 2+ Gemini plans from real observations
        if gemini_configured and turn_index == 1 and bool(attachments):
            parsed_month, parsed_year = cls._extract_month_year_from_text(goal)
            return [
                {
                    "thought": f"Inbound {channel} message includes {len(attachments)} attachment(s); ingesting files safely before Turn 2 Gemini planning.",
                    "tool_name": "ingest_message_attachments",
                    "tool_input": {
                        "attachments": attachments,
                        "sender": sender,
                        "channel": channel,
                        "month": month or parsed_month,
                        "year": year or parsed_year,
                    },
                }
            ], False, "", allow_gemini

        if gemini_configured:
            try:
                from google import genai
                from google.genai import types

                tool_catalog_str = "\n".join(
                    f"- {t['name']}({', '.join(t['parameters'])}): {t['description']}"
                    for t in cls.TOOL_DEFINITIONS
                )
                prior_summary_str = json.dumps(prior_obs_list, default=str) if prior_obs_list else "[] (Turn 1 - no prior actions yet)"
                rules_summary_str = json.dumps(rules_list, default=str) if rules_list else "[]"
                prompt = f"""
You are the autonomous multi-turn ReAct planning brain for {agent.get('name')} ({agent.get('section')} section) at client '{client.name}'.
Autonomy level: {autonomy_level}. Current ReAct turn: {turn_index} of {cls.MAX_REACT_TURNS}.

### Current Live Ledger Snapshot:
{json.dumps(ledger_state, default=str)}

### Active Client Knowledge Rules:
{rules_summary_str}

### Prior Turn Execution Observations:
{prior_summary_str}

### Equipped Tools:
{tool_catalog_str}

### Objective / Triggered Goal:
"{goal}"

Return STRICT valid JSON (no markdown fences, and do NOT use em dashes anywhere):
{{
  "done": false,
  "final_thought": "Brief summary if done is true, else empty string",
  "steps": [
    {{
      "thought": "Brief reason for calling this tool next",
      "tool_name": "exact_tool_name_from_above",
      "tool_input": {{}}
    }}
  ]
}}
Rules:
- If Prior Turn Execution Observations show the goal has been completely accomplished and verified, set "done": true, "steps": [], and provide "final_thought".
- Do NOT repeat any identical tool_name with identical tool_input from Prior Turn Execution Observations.
- Choose only the tools needed next to make concrete progress. Use 'Customer' for AR and 'Vendor' for AP.
"""
                g_client = genai.Client(api_key=settings.GEMINI_API_KEY)
                resp = g_client.models.generate_content(
                    model=settings.GEMINI_MODEL or "gemini-2.5-flash",
                    contents=prompt,
                    config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.1),
                )
                record_api_call_sync(service_name="gemini_ai", operation="agent_react_planner", client_id=client.id, is_success=True)
                raw_text = str(getattr(resp, "text", "") or "").strip()
                if raw_text.startswith("```"):
                    raw_text = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_text, flags=re.IGNORECASE | re.DOTALL).strip()
                data = json.loads(raw_text)
                if not isinstance(data, dict):
                    raise ValueError("Gemini planner JSON root must be an object.")

                planned: List[Dict[str, Any]] = []
                for step in (data.get("steps") or []):
                    if not isinstance(step, dict):
                        continue
                    t_name = str(step.get("tool_name") or "").strip()
                    if t_name in cls.TOOL_NAMES:
                        planned.append({
                            "thought": sanitize_no_em_dash(step.get("thought") or f"Executing {t_name}"),
                            "tool_name": t_name,
                            "tool_input": dict(step.get("tool_input") or {}),
                        })

                final_thought = sanitize_no_em_dash(str(data.get("final_thought") or ""))
                has_done_flag = "done" in data
                explicit_done = bool(data.get("done")) if has_done_flag else bool(planned or final_thought)
                if data.get("done") is True and not planned:
                    return [], True, final_thought, True
                if has_done_flag and data.get("done") is False and not planned:
                    # Avoid empty stall loops when Gemini indicates not done without proposing valid tools
                    return [], True, final_thought, True
                if planned or has_done_flag:
                    return planned[:8], explicit_done, final_thought, True
            except Exception as gem_err:
                logger.warning(f"Gemini ReAct planner fallback triggered ({gem_err}); using deterministic planner.")
                allow_gemini = False

        if turn_index == 1:
            steps = cls._deterministic_plan(
                goal=goal,
                agent=agent,
                ledger_state=ledger_state,
                month=month,
                year=year,
                attachments=attachments,
                sender=sender,
                channel=channel,
            )
            has_ingest = any(
                s.get("tool_name") in ("scan_and_ingest_storage", "ingest_message_attachments")
                for s in steps
            )
            return steps, (not has_ingest), "", allow_gemini

        followup_steps, followup_done, followup_thought = cls._deterministic_followup_plan(
            goal=goal,
            agent=agent,
            ledger_state=ledger_state,
            prior_observations=prior_obs_list,
            turn_index=turn_index,
            seen_executions=seen_set,
            month=month,
            year=year,
            autonomy_level=autonomy_level,
            trigger_type=trigger_type,
            explicit_human_command=explicit_human_command,
        )
        return followup_steps, followup_done, followup_thought, allow_gemini

    # =========================================================================
    # Public Execution Orchestrators
    # =========================================================================
    @classmethod
    async def plan_and_execute_goal(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        goal: str,
        trigger_type: str = "MANUAL_UI",
        trigger_source: Optional[str] = None,
        month: Optional[str] = None,
        year: Optional[int] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
        autonomy_override: Optional[str] = None,
        explicit_human_command: bool = False,
    ) -> Dict[str, Any]:
        cls.ensure_table(db)

        section = str(agent.get("section", "AR")).upper()
        agent_id = str(agent.get("id", "default"))
        agent_name = str(agent.get("name", f"{section} Agent"))
        autonomy_level = (
            autonomy_override
            if autonomy_override in AUTONOMY_LEVELS
            else str(agent.get("autonomy_level") or "semi_autonomous")
        )
        if autonomy_level not in AUTONOMY_LEVELS:
            autonomy_level = "semi_autonomous"

        run_id = f"run_{uuid.uuid4().hex[:12]}"
        started_at = datetime.now(timezone.utc)
        run_rec = AgentExecutionRun(
            run_id=run_id,
            client_id=client.id,
            agent_id=agent_id,
            agent_name=agent_name,
            section=section,
            trigger_type=trigger_type,
            trigger_source=trigger_source,
            goal=sanitize_no_em_dash(goal),
            autonomy_level=autonomy_level,
            status="RUNNING",
            reasoning_steps=[],
            started_at=started_at,
        )
        db.add(run_rec)
        db.commit()
        db.refresh(run_rec)

        # In explicit human commands via Email/WhatsApp/specific UI directive, allow direct tool execution unless explicitly generic autonomous close
        low_goal = str(goal or "").lower()
        is_generic_cycle_goal = any(k in low_goal for k in ("autonomous cycle", "full cycle", "heartbeat")) or not low_goal.strip()
        eff_explicit_cmd = explicit_human_command and not is_generic_cycle_goal

        # Guardrail 1: GL Accountant Agent must NOT deal with operational invoices, AR, AP, or bank statement feeds
        if section == "GL":
            forbidden_ops = ("draft invoice", "create invoice", "generate invoice", "vendor bill", "draft bill", "create bill", "sync bank", "bank feed", "ingest bank")
            if any(op in low_goal for op in forbidden_ops) and not any(k in low_goal for k in ("journal", "closing", "trial balance", "tb", "working paper", "adjustment", "audit")):
                refusal_msg = (
                    "GL Accountant Agent scope is strictly reserved for General Ledger & Trial Balance reviews, "
                    "closing adjustments, and manual journals. AR/AP/Banking operations must be handled by respective operational agents."
                )
                run_rec.status = "SUCCESS"
                run_rec.completed_at = datetime.now(timezone.utc)
                run_rec.summary_report = refusal_msg
                db.add(run_rec)
                db.commit()
                return {
                    "run_id": run_id,
                    "status": "rejected",
                    "message": refusal_msg,
                    "summary_report": refusal_msg,
                    "reasoning_trace": [],
                }

        # Guardrail 2: Financial Reporting Agent is strictly read-only presentation and disclosure synthesis
        if section == "FR":
            forbidden_mutations = ("post journal", "create journal", "post to erp", "draft invoice", "draft bill", "categorize bank", "delete ")
            if any(op in low_goal for op in forbidden_mutations):
                refusal_msg = (
                    "Financial Reporting Agent is strictly read-only presentation and disclosure synthesis. "
                    "Adjustments must be performed by the GL Accountant Agent."
                )
                run_rec.status = "SUCCESS"
                run_rec.completed_at = datetime.now(timezone.utc)
                run_rec.summary_report = refusal_msg
                db.add(run_rec)
                db.commit()
                return {
                    "run_id": run_id,
                    "status": "rejected",
                    "message": refusal_msg,
                    "summary_report": refusal_msg,
                    "reasoning_trace": [],
                }

        trace_steps: List[Dict[str, Any]] = []
        prior_observations: List[Dict[str, Any]] = []
        seen_executions: set = set()
        actions_taken = 0
        items_processed = 0
        items_auto_approved = 0
        items_categorized = 0
        queries_dispatched = 0
        invoices_drafted = 0
        had_failure = False
        had_awaiting_human = False
        outcome_lines: List[str] = []
        gemini_active = True
        global_step_idx = 0

        for turn_idx in range(1, cls.MAX_REACT_TURNS + 1):
            ledger_state = cls.get_ledger_snapshot(db, client.id, section=section)
            knowledge_rules = cls._get_active_knowledge_summaries(db, client.id)

            planned_steps, done_after_turn, final_thought, gemini_active = await cls._plan_goal_actions(
                goal=goal,
                client=client,
                agent=agent,
                ledger_state=ledger_state,
                month=month,
                year=year,
                attachments=attachments if turn_idx == 1 else None,
                sender=trigger_source or "",
                channel=trigger_type,
                prior_observations=prior_observations,
                knowledge_rules=knowledge_rules,
                turn_index=turn_idx,
                seen_executions=seen_executions,
                autonomy_level=autonomy_level,
                trigger_type=trigger_type,
                explicit_human_command=eff_explicit_cmd,
                allow_gemini=gemini_active,
            )

            if not planned_steps:
                if final_thought:
                    outcome_lines.append(final_thought)
                break

            turn_executed_any = False
            for p_step in planned_steps:
                t_name = p_step["tool_name"]
                t_input = dict(p_step.get("tool_input") or {})
                raw_key = cls._canonical_tool_key(t_name, t_input)
                if raw_key in seen_executions:
                    continue

                allowed, block_reason, adj_input = cls.check_tool_policy(
                    tool_name=t_name,
                    tool_input=t_input,
                    autonomy_level=autonomy_level,
                    trigger_type=trigger_type,
                    explicit_human_command=eff_explicit_cmd,
                    agent=agent,
                )
                adj_key = cls._canonical_tool_key(t_name, adj_input)
                if adj_key in seen_executions:
                    continue

                seen_executions.add(raw_key)
                seen_executions.add(adj_key)
                turn_executed_any = True
                global_step_idx += 1
                thought = sanitize_no_em_dash(p_step.get("thought") or f"Step {global_step_idx}: Execute {t_name}.")

                # Avoid displaying giant base64 strings inside persisted trace logs
                logged_input = {}
                for k, v in adj_input.items():
                    if k == "attachments" and isinstance(v, list):
                        logged_input["attachments"] = [att.get("filename") or att.get("name") or "file" for att in v if isinstance(att, dict)]
                    elif v is not None:
                        logged_input[k] = v

                if not allowed:
                    had_awaiting_human = True
                    blocked_msg = sanitize_no_em_dash(f"Skipped by '{autonomy_level}' autonomy policy: {block_reason}")
                    trace_steps.append({
                        "react_turn": turn_idx,
                        "step_index": global_step_idx,
                        "thought": thought,
                        "tool_name": t_name,
                        "tool_input": logged_input,
                        "tool_output_summary": blocked_msg,
                        "status": "AWAITING_HUMAN",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })
                    prior_observations.append({
                        "react_turn": turn_idx,
                        "tool_name": t_name,
                        "tool_input": logged_input,
                        "status": "AWAITING_HUMAN",
                        "summary": blocked_msg,
                    })
                    outcome_lines.append(f"[{t_name}] Held for human approval ({block_reason})")
                    continue

                try:
                    res = await cls.execute_tool(db, client, agent, t_name, adj_input)
                    summary_msg = sanitize_no_em_dash(res.get("message") or f"{t_name} completed.")
                    step_status = "SUCCESS"
                    if res.get("status") in ("error",):
                        step_status = "FAILED"
                        had_failure = True
                    elif res.get("status") == "drafted_only":
                        step_status = "AWAITING_HUMAN"
                        had_awaiting_human = True
                        actions_taken += 1
                    else:
                        actions_taken += 1

                    ext_cnt = int(res.get("items_extracted", 0) or 0)
                    bank_staged_cnt = int(res.get("bank_transactions_staged", 0) or 0)
                    doc_staged_cnt = int(res.get("staged_transactions_created", 0) or 0)
                    approved_cnt = int(res.get("approved_count", 0) or 0)
                    mapped_cnt = int(res.get("categorized_count", 0) or 0) + int(res.get("bank_rows_mapped", 0) or 0) + int(res.get("staged_items_healed", 0) or 0)
                    q_cnt = int(res.get("queries_dispatched", 0) or 0) + int(res.get("reminders_sent", 0) or 0)
                    inv_cnt = int(res.get("invoices_drafted", 0) or 0)

                    items_processed += ext_cnt + bank_staged_cnt + doc_staged_cnt
                    items_auto_approved += approved_cnt
                    items_categorized += mapped_cnt
                    queries_dispatched += q_cnt
                    invoices_drafted += inv_cnt

                    outcome_lines.append(f"[{t_name}] {summary_msg}")
                    trace_steps.append({
                        "react_turn": turn_idx,
                        "step_index": global_step_idx,
                        "thought": thought,
                        "tool_name": t_name,
                        "tool_input": logged_input,
                        "tool_output_summary": summary_msg,
                        "status": step_status,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })
                    prior_observations.append({
                        "react_turn": turn_idx,
                        "tool_name": t_name,
                        "tool_input": logged_input,
                        "status": step_status,
                        "summary": summary_msg,
                        "items_extracted": ext_cnt,
                        "bank_transactions_staged": bank_staged_cnt,
                        "staged_transactions_created": doc_staged_cnt,
                        "approved_count": approved_cnt,
                        "categorized_or_mapped_count": mapped_cnt,
                        "queries_dispatched": q_cnt,
                        "invoices_drafted": inv_cnt,
                    })
                except Exception as exec_err:
                    had_failure = True
                    err_txt = sanitize_no_em_dash(f"Tool '{t_name}' failed: {exec_err}")
                    logger.error(err_txt, exc_info=True)
                    outcome_lines.append(f"[{t_name}] {err_txt}")
                    trace_steps.append({
                        "react_turn": turn_idx,
                        "step_index": global_step_idx,
                        "thought": thought,
                        "tool_name": t_name,
                        "tool_input": logged_input,
                        "tool_output_summary": err_txt,
                        "status": "FAILED",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })
                    prior_observations.append({
                        "react_turn": turn_idx,
                        "tool_name": t_name,
                        "tool_input": logged_input,
                        "status": "FAILED",
                        "summary": err_txt,
                    })

            if final_thought and done_after_turn:
                outcome_lines.append(final_thought)
            if done_after_turn or not turn_executed_any:
                break

        final_status = "COMPLETED"
        if had_failure and actions_taken == 0:
            final_status = "FAILED"
        elif had_failure:
            final_status = "PARTIAL"
        elif had_awaiting_human and actions_taken == 0:
            final_status = "AWAITING_HUMAN"
        elif had_awaiting_human and autonomy_level == "copilot" and actions_taken > 0:
            final_status = "AWAITING_HUMAN"

        summary_report = sanitize_no_em_dash(
            f"Agent '{agent_name}' finished with status {final_status} ({actions_taken} tool action(s)). " + " | ".join(outcome_lines)
        )

        run_rec.status = final_status
        run_rec.reasoning_steps = trace_steps
        run_rec.actions_taken_count = actions_taken
        run_rec.items_processed = items_processed
        run_rec.items_auto_approved = items_auto_approved
        run_rec.items_categorized = items_categorized
        run_rec.queries_dispatched = queries_dispatched
        run_rec.invoices_drafted = invoices_drafted
        run_rec.summary_report = summary_report
        run_rec.completed_at = datetime.now(timezone.utc)
        flag_modified(run_rec, "reasoning_steps")
        db.add(run_rec)
        db.commit()
        db.refresh(run_rec)
        run_payload = run_rec.model_dump(mode="json")

        now_iso = datetime.now(timezone.utc).isoformat()
        cls._update_agent_run_metadata(
            db,
            client,
            agent_id,
            {
                "run_id": run_payload["run_id"],
                "status": final_status,
                "timestamp": now_iso,
                "triggered_at": now_iso,
                "summary": summary_report[:400],
                "summary_message": summary_report[:400],
                "items_extracted": items_processed,
                "items_auto_approved": items_auto_approved,
                "items_categorized": items_categorized,
                "queries_dispatched": queries_dispatched,
                "invoices_drafted": invoices_drafted,
            },
            trigger_type=trigger_type,
        )

        return run_payload

    @classmethod
    async def run_autonomous_cycle(
        cls,
        db: Session,
        client: ClientOrganization,
        agent: Dict[str, Any],
        trigger_type: str = "SCHEDULED_HEARTBEAT",
        trigger_source: Optional[str] = None,
        month: Optional[str] = None,
        year: Optional[int] = None,
        autonomy_override: Optional[str] = None,
    ) -> Dict[str, Any]:
        eff_month = month or datetime.now().strftime("%B")
        eff_year = year or datetime.now().year
        section = str(agent.get("section") or agent.get("pipeline_type") or "AR").upper()
        if section == "GL":
            goal = (
                f"Run full autonomous month-end close cycle for {agent.get('name', 'GL Accountant Agent')} "
                f"({eff_month} {eff_year}): cross-check subledgers (AR Customers, AP Vendors, Bank feed), "
                f"perform pre-flight gap discovery, execute tailored closing runbook steps, verify post-closing equilibrium, "
                f"and compile closing white papers."
            )
        elif section == "FR":
            goal = (
                f"Run full autonomous financial reporting cycle for {agent.get('name', 'Financial Reporting Agent')} "
                f"({eff_month} {eff_year}): synthesize statutory IFRS statement pack (Income Statement, Balance Sheet, "
                f"Cash Flows, Equity), compile disclosure notes, and compute financial ratios."
            )
        else:
            goal = (
                f"Run full autonomous cycle for {agent.get('name', 'Accounting Agent')} ({eff_month} {eff_year}): "
                f"scan storage, apply learned knowledge rules, auto-approve valid transactions within autonomy policy, "
                f"handle overdue clarifications, and report ledger status."
            )
        return await cls.plan_and_execute_goal(
            db=db,
            client=client,
            agent=agent,
            goal=goal,
            trigger_type=trigger_type,
            trigger_source=trigger_source,
            month=eff_month,
            year=eff_year,
            autonomy_override=autonomy_override,
            explicit_human_command=False,
        )

    @classmethod
    async def on_reactive_event(
        cls,
        db: Session,
        client_id: str,
        event_type: str,
        event_payload: Optional[Dict[str, Any]] = None,
        agent_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Reacts immediately to domain events:
          - KNOWLEDGE_TAUGHT: Retroactively applies active knowledge rules to existing UNMAPPED bank rows and PENDING staged rows.
          - PORTAL_CLARIFICATION_SUBMITTED: Evaluates client's explanation, applies matching rules or updates status, and auto-approves if policy allows.
          - BANK_SYNC_COMPLETED: Immediately categorizes newly synced bank rows using active COA_MAPPING_RULE entries.
        """
        cls.ensure_table(db)
        payload = dict(event_payload or {})
        preferred_sec = payload.get("section") or ("BANK" if event_type in ("PORTAL_CLARIFICATION_SUBMITTED", "BANK_SYNC_COMPLETED") else "AR")
        client, agent = cls.resolve_client_and_agent(db, client_id=client_id, agent_id=agent_id, section=preferred_sec)
        if not client or not agent:
            return {"status": "ignored", "reason": f"Client '{client_id}' or agent not found."}

        if event_type == "KNOWLEDGE_TAUGHT":
            goal = "Reactively apply newly taught knowledge rule across all existing unmapped bank rows and pending staged items."
            run_data = await cls.plan_and_execute_goal(
                db=db,
                client=client,
                agent=agent,
                goal=goal,
                trigger_type="REACTIVE_EVENT",
                trigger_source=event_type,
                explicit_human_command=True,
            )
            return {"status": "processed", "event_type": event_type, "run": run_data}

        if event_type == "PORTAL_CLARIFICATION_SUBMITTED":
            explanation = str(payload.get("explanation") or "")
            goal = f"Reactively process submitted client portal clarification ('{explanation[:80]}'): apply learned rules to answered/unmapped rows and verify ledger analytics."
            run_data = await cls.plan_and_execute_goal(
                db=db,
                client=client,
                agent=agent,
                goal=goal,
                trigger_type="REACTIVE_EVENT",
                trigger_source=event_type,
                explicit_human_command=False,
            )
            return {"status": "processed", "event_type": event_type, "run": run_data}

        if event_type == "BANK_SYNC_COMPLETED":
            goal = "Reactively apply active COA knowledge rules to newly synced bank transactions and raise anomalies if needed."
            run_data = await cls.plan_and_execute_goal(
                db=db,
                client=client,
                agent=agent,
                goal=goal,
                trigger_type="REACTIVE_EVENT",
                trigger_source=event_type,
                explicit_human_command=False,
            )
            return {"status": "processed", "event_type": event_type, "run": run_data}

        return {"status": "ignored", "reason": f"Unsupported reactive event '{event_type}'."}

    # =========================================================================
    # Per-Agent Multi-Frequency Heartbeat Scheduler
    # =========================================================================
    @classmethod
    def is_agent_due(cls, agent: Dict[str, Any], now_utc: Optional[datetime] = None, force: bool = False) -> bool:
        if not agent.get("is_active", agent.get("active", True)):
            return False
        freq = str(agent.get("schedule_frequency") or "daily_morning").strip().lower()
        if freq in ("manual", "disabled", "off", "none") and not force:
            return False
        if force:
            return True

        now = now_utc or datetime.now(timezone.utc)
        last_dt = _parse_dt_utc(agent.get("last_heartbeat_at"))
        if last_dt is None:
            return True

        elapsed = (now - last_dt).total_seconds()
        if freq == "hourly":
            return elapsed >= 3500
        if freq == "every_6_hours":
            return elapsed >= 6 * 3550
        if freq in ("daily", "daily_morning", "daily_evening"):
            return elapsed >= 23 * 3600
        if freq == "weekly":
            return elapsed >= 6.9 * 86400
        if freq == "monthly_cutoff":
            return elapsed >= 27 * 86400 or (now.day >= 28 and elapsed >= 23 * 3600)
        return elapsed >= 23 * 3600

    @classmethod
    async def run_due_agents_heartbeat(
        cls,
        db: Session,
        client_id: Optional[str] = None,
        force: bool = False,
        month: Optional[str] = None,
        year: Optional[int] = None,
        allowed_client_ids: Optional[set] = None,
    ) -> Dict[str, Any]:
        cls.ensure_table(db)
        if client_id:
            aliases = cls._get_aliases(client_id)
            clients = list(db.exec(select(ClientOrganization).where(ClientOrganization.id.in_(aliases))).all())
        else:
            stmt = select(ClientOrganization).where(ClientOrganization.status.in_(["live", "active"]))
            if allowed_client_ids is not None:
                if not allowed_client_ids:
                    clients = []
                else:
                    stmt = stmt.where(ClientOrganization.id.in_(sorted(allowed_client_ids)))
                    clients = list(db.exec(stmt).all())
            else:
                clients = list(db.exec(stmt).all())
            if not clients:
                fallback_stmt = select(ClientOrganization)
                if allowed_client_ids is not None:
                    if allowed_client_ids:
                        clients = list(db.exec(fallback_stmt.where(ClientOrganization.id.in_(sorted(allowed_client_ids)))).all())
                else:
                    clients = list(db.exec(fallback_stmt).all())

        now_utc = datetime.now(timezone.utc)
        evaluated_agents = 0
        executed_runs: List[Dict[str, Any]] = []
        skipped_agents: List[Dict[str, Any]] = []

        from app.services.agent_comms_service import AgentCommsService

        for client in clients:
            raw_agents = list(client.agents or client.pipelines or [])
            for raw_agent in raw_agents:
                evaluated_agents += 1
                agent = AgentCommsService.enrich_agent_metadata(client.id, dict(raw_agent))
                freq = str(agent.get("schedule_frequency") or "daily_morning")
                if cls.is_agent_due(agent, now_utc=now_utc, force=force):
                    try:
                        run_res = await asyncio.wait_for(
                            cls.run_autonomous_cycle(
                                db=db,
                                client=client,
                                agent=agent,
                                trigger_type="SCHEDULED_HEARTBEAT",
                                trigger_source=f"schedule:{freq}",
                                month=month,
                                year=year,
                            ),
                            timeout=25.0,
                        )
                        executed_runs.append(run_res)
                    except asyncio.TimeoutError:
                        logger.warning(
                            f"Heartbeat timeout (25s) exceeded for client '{client.id}', agent '{agent.get('id')}'. Skipping to next agent."
                        )
                        skipped_agents.append({
                            "client_id": client.id,
                            "agent_id": agent.get("id"),
                            "schedule_frequency": freq,
                            "reason": "timeout_exceeded_25s",
                        })
                    except Exception as run_err:
                        logger.error(
                            f"Error running autonomous cycle for client '{client.id}', agent '{agent.get('id')}': {run_err}",
                            exc_info=True,
                        )
                        skipped_agents.append({
                            "client_id": client.id,
                            "agent_id": agent.get("id"),
                            "schedule_frequency": freq,
                            "reason": f"error: {str(run_err)}",
                        })
                else:
                    skipped_agents.append({
                        "client_id": client.id,
                        "agent_id": agent.get("id"),
                        "schedule_frequency": freq,
                        "reason": "not_due_or_manual",
                    })

        return {
            "status": "completed",
            "clients_checked": len(clients),
            "agents_evaluated": evaluated_agents,
            "runs_executed": len(executed_runs),
            "runs_skipped": len(skipped_agents),
            "executed_runs": executed_runs,
        }

    @classmethod
    def list_runs(
        cls,
        db: Session,
        client_id: str,
        agent_id: Optional[str] = None,
        limit: int = 30,
    ) -> List[Dict[str, Any]]:
        cls.ensure_table(db)
        aliases = cls._get_aliases(client_id)
        stmt = select(AgentExecutionRun).where(AgentExecutionRun.client_id.in_(aliases))
        if agent_id:
            stmt = stmt.where(AgentExecutionRun.agent_id == agent_id)
        stmt = stmt.order_by(desc(AgentExecutionRun.started_at), desc(AgentExecutionRun.id)).limit(limit)
        rows = list(db.exec(stmt).all())
        return [r.model_dump(mode="json") for r in rows]
