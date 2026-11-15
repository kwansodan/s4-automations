"""Comprehensive automated integration tests for the True Agentic Accounting Architecture:
- Natural-language Email & WhatsApp command tool execution (`categorize_bank_transactions`, `auto_approve_verified_transactions`, etc.)
- Inbound Email multipart & WhatsApp attachment auto-ingestion + knowledge application
- Reactive Event Chaining (`KNOWLEDGE_TAUGHT` & `PORTAL_CLARIFICATION_SUBMITTED`)
- Autonomy Guardrails (`copilot`, `semi_autonomous`, `full_autonomous`), Per-Agent Heartbeat Scheduler (`is_agent_due` + `POST /api/v1/agents/heartbeat`), Overdue >72h SLA Watchdogs, and ReAct Reasoning Traces (`GET /runs`)
"""

import base64
from datetime import datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.main import app
from app.db.session import get_engine
from app.models.db_models import (
    AgentExecutionRun,
    AgentMessage,
    BankTransaction,
    ClientKnowledgeEntry,
    ClientOrganization,
    StagedTransaction,
)
from app.api.v1.bank_portal import generate_portal_token
from app.services.agentic_brain_service import AgenticBrainService


TEST_CLIENT_ID = "test_true_agentic_co"


@pytest.fixture
def client():
    with TestClient(app) as tc:
        yield tc


def _cleanup_test_client(db: Session, cid: str = TEST_CLIENT_ID) -> None:
    for row in db.exec(select(AgentExecutionRun).where(AgentExecutionRun.client_id == cid)).all():
        db.delete(row)
    for row in db.exec(select(AgentMessage).where(AgentMessage.client_id == cid)).all():
        db.delete(row)
    for row in db.exec(select(ClientKnowledgeEntry).where(ClientKnowledgeEntry.client_id == cid)).all():
        db.delete(row)
    for row in db.exec(select(BankTransaction).where(BankTransaction.client_id == cid)).all():
        db.delete(row)
    for row in db.exec(select(StagedTransaction).where(StagedTransaction.client_id == cid)).all():
        db.delete(row)
    org = db.get(ClientOrganization, cid)
    if org:
        db.delete(org)
    db.commit()


@pytest.fixture
def agentic_client_org():
    """Creates an isolated ClientOrganization with AR, AP, and BANK autonomous agents."""
    with Session(get_engine()) as db:
        AgenticBrainService.ensure_table(db)
        _cleanup_test_client(db, TEST_CLIENT_ID)

        raw_agents = [
            {
                "id": "agent_ar_slips",
                "name": "AR Control Slips Agent",
                "section": "AR",
                "entity_type": "ar_sales_invoice",
                "source_type": "google_drive",
                "is_active": True,
                "active": True,
                "autonomy_level": "semi_autonomous",
                "schedule_frequency": "hourly",
                "auto_approve_threshold": 0.85,
                "auto_apply_knowledge": True,
                "auto_query_anomalies": True,
                "proactive_SLA_reminders": True,
            },
            {
                "id": "agent_ap_bills",
                "name": "AP Vendor Bills Agent",
                "section": "AP",
                "entity_type": "ap_vendor_bill",
                "source_type": "email",
                "is_active": True,
                "active": True,
                "autonomy_level": "semi_autonomous",
                "schedule_frequency": "daily_morning",
                "auto_approve_threshold": 0.90,
                "auto_apply_knowledge": True,
                "auto_query_anomalies": True,
                "proactive_SLA_reminders": True,
            },
            {
                "id": "agent_bank_recon",
                "name": "Treasury & Bank Recon Agent",
                "section": "BANK",
                "entity_type": "bank_feed",
                "source_type": "bank_feed",
                "is_active": True,
                "active": True,
                "autonomy_level": "semi_autonomous",
                "schedule_frequency": "hourly",
                "auto_approve_threshold": 0.85,
                "auto_apply_knowledge": True,
                "auto_query_anomalies": True,
                "proactive_SLA_reminders": True,
            },
        ]

        from app.services.agent_comms_service import AgentCommsService

        org = ClientOrganization(
            id=TEST_CLIENT_ID,
            organization_id="s4_advisory",
            name="True Agentic Holdings Ltd",
            industry="Hospitality & Commercial Services",
            status="live",
            accounting_software="zoho_books",
            description="Test tenant for end-to-end ReAct autonomous workflows",
            source_email="finance@trueagentic.example.com",
            agents=raw_agents,
            pipelines=raw_agents,
            custom_config={
                "currency": "GHS",
                "contact_email": "finance@trueagentic.example.com",
                "whatsapp_config": {
                    "whatsapp_mode": "platform_shared",
                    "whatsapp_phone_number": "+15551234567",
                    "whatsapp_verify_token": "s4_wa_verify_true_agentic",
                },
            },
            team_members=[
                {"name": "Ada Mensah", "email": "ada@trueagentic.example.com", "phone": "+233244556677", "role": "CFO"}
            ],
        )
        AgentCommsService.sync_client_agents_list(org)
        db.add(org)
        db.commit()

    yield TEST_CLIENT_ID

    with Session(get_engine()) as db:
        _cleanup_test_client(db, TEST_CLIENT_ID)


def test_conversational_command_executes_agent_tools_via_email_and_whatsapp(client: TestClient, agentic_client_org: str):
    """Inbound Email and WhatsApp commands plan & execute native accounting tools instead of chat-only replies."""
    cid = agentic_client_org
    with Session(get_engine()) as db:
        ecg_tx = BankTransaction(
            client_id=cid,
            transaction_date="2026-03-10",
            description="ECG PREPAID POWER ACCRA",
            amount=480.0,
            transaction_type="DEBIT",
            source_file_name="march_bank.csv",
            status="UNMAPPED",
        )
        kempinski_slip = StagedTransaction(
            client_id=cid,
            batch_id="March_2026",
            pipeline_id="agent_ar_slips",
            pipeline_name="AR Control Slips Agent",
            pipeline_type="AR",
            entity_type="ar_sales_invoice",
            transaction_date="2026-03-11",
            source_type="google_drive",
            source_file_name="kempinski_slip_01.pdf",
            item_or_description="Bed Sheet (Double / King)",
            quantity_or_debit=40.0,
            rate_or_price=18.50,
            total_amount=740.0,
            confidence_score=0.96,
            validation_status="VALID",
            status="PENDING",
            approved=False,
            metadata_json={"customer_name": "Kempinski Hotel Gold Coast"},
        )
        db.add(ecg_tx)
        db.add(kempinski_slip)
        db.commit()
        db.refresh(ecg_tx)
        db.refresh(kempinski_slip)
        ecg_id = ecg_tx.id
        slip_id = kempinski_slip.id

    # 1. Inbound Email actionable compound command
    email_res = client.post(
        "/api/v1/agents/webhooks/email",
        json={
            "client_id": cid,
            "agent_id": "agent_ar_slips",
            "from_email": "ada@trueagentic.example.com",
            "subject": "Month-end close instructions",
            "text": "Categorize all ECG debits to 5020 - Electricity Expense and auto-approve valid Kempinski slips",
        },
    )
    assert email_res.status_code == 200, email_res.text
    payload = email_res.json()
    assert payload["status"] == "PROCESSED"
    assert payload.get("agent_run") is not None
    run_info = payload["agent_run"]
    assert run_info["trigger_type"] == "EMAIL_COMMAND"
    assert run_info["actions_taken_count"] >= 2
    assert "\u2014" not in (payload.get("reply") or "")
    assert "\u2014" not in (run_info.get("summary_report") or "")

    called_tools = {s["tool_name"] for s in run_info.get("reasoning_steps", [])}
    assert "categorize_bank_transactions" in called_tools
    assert "auto_approve_verified_transactions" in called_tools

    with Session(get_engine()) as db:
        ecg_after = db.get(BankTransaction, ecg_id)
        slip_after = db.get(StagedTransaction, slip_id)
        assert ecg_after is not None and ecg_after.status == "MAPPED"
        assert "5020" in (ecg_after.mapped_account_name or "")
        assert slip_after is not None and slip_after.approved is True
        assert slip_after.status == "APPROVED"

        out_msgs = list(
            db.exec(
                select(AgentMessage).where(
                    AgentMessage.client_id == cid,
                    AgentMessage.direction == "OUTBOUND",
                )
            ).all()
        )
        assert len(out_msgs) >= 1
        assert out_msgs[-1].ai_metadata.get("agent_run") is not None
        assert "Actions Executed:" in out_msgs[-1].body_text or "Categorize" in out_msgs[-1].body_text or "Tool" in out_msgs[-1].body_text

    # 2. Inbound WhatsApp actionable command routed to BANK agent
    wa_res = client.post(
        f"/api/v1/agents/webhooks/whatsapp/{cid}",
        json={
            "client_id": cid,
            "agent_id": "agent_bank_recon",
            "from_phone": "+233244556677",
            "text": "@agent_bank_recon Run autonomous cycle and check summary",
        },
    )
    assert wa_res.status_code == 200, wa_res.text
    wa_data = wa_res.json()
    assert wa_data["status"] == "PROCESSED"
    primary = wa_data["primary_result"]
    assert primary["channel"] == "WHATSAPP"
    assert primary["agent_run"] is not None
    assert primary["agent_run"]["trigger_type"] == "WHATSAPP_COMMAND"
    assert "\u2014" not in (primary.get("reply") or "")

    with Session(get_engine()) as db:
        runs = list(db.exec(select(AgentExecutionRun).where(AgentExecutionRun.client_id == cid)).all())
        trigger_types = {r.trigger_type for r in runs}
        assert "EMAIL_COMMAND" in trigger_types
        assert "WHATSAPP_COMMAND" in trigger_types


def test_inbound_email_and_whatsapp_attachment_auto_ingestion(client: TestClient, agentic_client_org: str):
    """Email multipart files and WhatsApp attachments trigger ingest_message_attachments and apply learned rules."""
    cid = agentic_client_org

    # Pre-teach a COA mapping rule so ingested attachments auto-map matching descriptions
    teach_res = client.post(
        f"/api/v1/clients/{cid}/knowledge/teach",
        json={
            "text": "Map HUBTEL transactions to 5045 - Payment Processing Fees",
            "agent_id": "agent_bank_recon",
            "section": "BANK",
        },
    )
    assert teach_res.status_code == 200, teach_res.text

    # 1. Multipart Email attachment CSV upload
    csv_bytes = (
        "Date,Description,Debit,Credit\n"
        "2026-03-14,HUBTEL MERCHANT SETTLEMENT,120.00,0\n"
        "2026-03-15,UNKNOWN HARDWARE STORE,310.00,0\n"
    ).encode("utf-8")

    email_multipart_res = client.post(
        "/api/v1/agents/webhooks/email",
        data={
            "client_id": cid,
            "agent_id": "agent_bank_recon",
            "from_email": "ada@trueagentic.example.com",
            "subject": "March bank statement CSV attached",
            "text": "Please find attached our mid-month CSV statement.",
        },
        files={"attachment1": ("march_bank_statement.csv", csv_bytes, "text/csv")},
    )
    assert email_multipart_res.status_code == 200, email_multipart_res.text
    mp_data = email_multipart_res.json()
    assert mp_data["status"] == "PROCESSED"
    assert mp_data.get("agent_run") is not None
    step_tools = [s["tool_name"] for s in mp_data["agent_run"]["reasoning_steps"]]
    assert "ingest_message_attachments" in step_tools

    with Session(get_engine()) as db:
        bank_rows = list(db.exec(select(BankTransaction).where(BankTransaction.client_id == cid)).all())
        hubtel_rows = [b for b in bank_rows if "HUBTEL" in (b.description or "").upper()]
        unknown_rows = [b for b in bank_rows if "HARDWARE" in (b.description or "").upper()]
        assert len(hubtel_rows) >= 1
        assert hubtel_rows[0].status == "MAPPED"
        assert "5045" in (hubtel_rows[0].mapped_account_name or "")
        assert len(unknown_rows) >= 1
        assert unknown_rows[0].status == "UNMAPPED"

    # 2. WhatsApp JSON webhook attachment (inline CSV base64 bank item routed to BANK agent)
    wa_csv_b64 = base64.b64encode(
        b"Date,Description,Debit,Credit\n2026-03-18,MELCOM OFFICE SUPPLIES,95.00,0\n"
    ).decode("ascii")
    wa_att_res = client.post(
        f"/api/v1/agents/webhooks/whatsapp/{cid}",
        json={
            "client_id": cid,
            "agent_id": "agent_bank_recon",
            "from_phone": "+233244556677",
            "text": "Attached bank feed snippet",
            "attachments": [
                {
                    "filename": "whatsapp_bank_snippet.csv",
                    "content_type": "text/csv",
                    "content_base64": wa_csv_b64,
                }
            ],
        },
    )
    assert wa_att_res.status_code == 200, wa_att_res.text
    wa_att_data = wa_att_res.json()
    assert wa_att_data["primary_result"]["agent_run"] is not None
    assert "ingest_message_attachments" in [
        s["tool_name"] for s in wa_att_data["primary_result"]["agent_run"]["reasoning_steps"]
    ]
    with Session(get_engine()) as db:
        melcom = [
            b
            for b in db.exec(select(BankTransaction).where(BankTransaction.client_id == cid)).all()
            if "MELCOM" in (b.description or "").upper()
        ]
        assert len(melcom) >= 1


def test_reactive_knowledge_teaching_and_portal_clarification_reactivation(client: TestClient, agentic_client_org: str):
    """Teaching a rule via Knowledge Studio and submitting portal clarifications reactively wake agentic brain."""
    cid = agentic_client_org
    with Session(get_engine()) as db:
        voda_tx = BankTransaction(
            client_id=cid,
            transaction_date="2026-03-19",
            description="VODAFONE FIBRE BROADBAND",
            amount=350.0,
            transaction_type="DEBIT",
            source_file_name="march_bank.csv",
            status="UNMAPPED",
        )
        clar_tx = BankTransaction(
            client_id=cid,
            transaction_date="2026-03-12",
            description="GOIL STATION ACCRA",
            amount=220.0,
            transaction_type="DEBIT",
            source_file_name="march_bank.csv",
            status="CLARIFICATION_REQUESTED",
            accountant_query="Was this fleet fuel or generator diesel?",
            query_date=datetime.now(timezone.utc) - timedelta(hours=4),
        )
        db.add(voda_tx)
        db.add(clar_tx)
        db.commit()
        db.refresh(voda_tx)
        db.refresh(clar_tx)
        voda_id = voda_tx.id
        clar_id = clar_tx.id

    # 1. Knowledge teaching triggers reactive KNOWLEDGE_TAUGHT event
    teach_res = client.post(
        f"/api/v1/clients/{cid}/knowledge/teach",
        json={
            "text": "Map VODAFONE to 5030 - Internet & Telecoms",
            "agent_id": "agent_bank_recon",
            "section": "BANK",
        },
    )
    assert teach_res.status_code == 200, teach_res.text

    with Session(get_engine()) as db:
        voda_after = db.get(BankTransaction, voda_id)
        assert voda_after is not None
        assert voda_after.status == "MAPPED"
        assert "5030" in (voda_after.mapped_account_name or "")

        reactive_runs = list(
            db.exec(
                select(AgentExecutionRun).where(
                    AgentExecutionRun.client_id == cid,
                    AgentExecutionRun.trigger_type == "REACTIVE_EVENT",
                )
            ).all()
        )
        assert len(reactive_runs) >= 1

    # 2. Portal clarification submission triggers reactive PORTAL_CLARIFICATION_SUBMITTED event
    portal_token = generate_portal_token(cid, "True Agentic Holdings Ltd")
    portal_res = client.post(
        f"/api/v1/portal/transactions/{clar_id}/explain",
        headers={"Authorization": f"Bearer {portal_token}"},
        json={"client_explanation": "Delivery van fleet fuel expense for Accra route"},
    )
    assert portal_res.status_code == 200, portal_res.text

    with Session(get_engine()) as db:
        reactive_sources = {
            r.trigger_source
            for r in db.exec(
                select(AgentExecutionRun).where(
                    AgentExecutionRun.client_id == cid,
                    AgentExecutionRun.trigger_type == "REACTIVE_EVENT",
                )
            ).all()
        }
        assert "KNOWLEDGE_TAUGHT" in reactive_sources
        assert "PORTAL_CLARIFICATION_SUBMITTED" in reactive_sources


def test_autonomy_levels_and_scheduled_heartbeat_execution(client: TestClient, agentic_client_org: str):
    """Tests copilot guardrail holds, full_autonomous upgrade, hourly due scheduler, >72h SLA watchdogs, and Customer/Vendor drafts."""
    cid = agentic_client_org

    with Session(get_engine()) as db:
        ar_slip = StagedTransaction(
            client_id=cid,
            batch_id="March_2026",
            pipeline_id="agent_ar_slips",
            pipeline_name="AR Control Slips Agent",
            pipeline_type="AR",
            entity_type="ar_sales_invoice",
            transaction_date="2026-03-20",
            source_type="google_drive",
            source_file_name="marriott_march_slip.pdf",
            item_or_description="Bath Towel",
            quantity_or_debit=25.0,
            rate_or_price=12.0,
            total_amount=300.0,
            confidence_score=0.95,
            validation_status="VALID",
            status="PENDING",
            approved=False,
            metadata_json={"customer_name": "Marriott Hotel Accra"},
        )
        ap_bill = StagedTransaction(
            client_id=cid,
            batch_id="March_2026",
            pipeline_id="agent_ap_bills",
            pipeline_name="AP Vendor Bills Agent",
            pipeline_type="AP",
            entity_type="ap_vendor_bill",
            transaction_date="2026-03-21",
            source_type="email",
            source_file_name="soap_supplier_bill.pdf",
            item_or_description="Industrial Detergent Supply",
            quantity_or_debit=10.0,
            rate_or_price=45.0,
            total_amount=450.0,
            confidence_score=0.97,
            validation_status="VALID",
            status="PENDING",
            approved=False,
            metadata_json={"vendor_name": "Accra Chemical Supplies"},
        )
        overdue_q = BankTransaction(
            client_id=cid,
            transaction_date="2026-03-01",
            description="MYSTERY WIRE TRANSFER 9981",
            amount=1800.0,
            transaction_type="DEBIT",
            source_file_name="march_bank.csv",
            status="CLARIFICATION_REQUESTED",
            accountant_query="Please upload supporting invoice.",
            query_date=datetime.now(timezone.utc) - timedelta(hours=80),
        )
        unmapped_q = BankTransaction(
            client_id=cid,
            transaction_date="2026-03-22",
            description="UNIDENTIFIED POS DEBIT 4410",
            amount=640.0,
            transaction_type="DEBIT",
            source_file_name="march_bank.csv",
            status="UNMAPPED",
        )
        db.add(ar_slip)
        db.add(ap_bill)
        db.add(overdue_q)
        db.add(unmapped_q)
        db.commit()
        db.refresh(ar_slip)
        db.refresh(ap_bill)
        db.refresh(overdue_q)
        ar_id, ap_id, overdue_id = ar_slip.id, ap_bill.id, overdue_q.id

    # 1. Put AR agent in COPILOT mode via PATCH /autonomy
    patch_cop = client.patch(
        f"/api/v1/agents/{cid}/agent_ar_slips/autonomy",
        json={"autonomy_level": "copilot", "schedule_frequency": "hourly"},
    )
    assert patch_cop.status_code == 200, patch_cop.text
    assert patch_cop.json()["agent"]["autonomy_level"] == "copilot"

    # Execute autonomous cycle with explicit_human_command=False -> guardrails must pause approval & Zoho drafts!
    cop_run_res = client.post(
        f"/api/v1/agents/{cid}/agent_ar_slips/execute-goal",
        json={
            "goal": "Run autonomous cycle for March 2026: approve verified items and generate draft Customer invoices",
            "month": "March",
            "year": 2026,
            "explicit_human_command": False,
        },
    )
    assert cop_run_res.status_code == 200, cop_run_res.text
    cop_run = cop_run_res.json()["run"]
    assert cop_run["status"] == "AWAITING_HUMAN"
    assert cop_run["items_auto_approved"] == 0
    assert cop_run["invoices_drafted"] == 0
    awaiting_tools = {s["tool_name"] for s in cop_run["reasoning_steps"] if s["status"] == "AWAITING_HUMAN"}
    assert "auto_approve_verified_transactions" in awaiting_tools
    assert "generate_draft_invoices_or_bills" in awaiting_tools

    # Verify DB rows untouched during copilot pause
    with Session(get_engine()) as db:
        assert db.get(StagedTransaction, ar_id).status == "PENDING"

    # 2. Upgrade AR and AP agents to FULL AUTONOMOUS mode & verify heartbeat executes due agents
    for aid in ("agent_ar_slips", "agent_ap_bills"):
        p_full = client.patch(
            f"/api/v1/agents/{cid}/{aid}/autonomy",
            json={
                "autonomy_level": "full_autonomous",
                "schedule_frequency": "hourly",
                "auto_approve_threshold": 0.80,
                "proactive_SLA_reminders": True,
                "auto_query_anomalies": True,
            },
        )
        assert p_full.status_code == 200, p_full.text
        assert p_full.json()["agent"]["autonomy_level"] == "full_autonomous"

    # Heartbeat sweep (force=False): newly configured hourly agents have no last_triggered_at so they are DUE!
    hb1 = client.post(
        "/api/v1/agents/heartbeat",
        json={"client_id": cid, "force": False, "month": "March", "year": 2026},
    )
    assert hb1.status_code == 200, hb1.text
    hb1_data = hb1.json()
    assert hb1_data["agents_evaluated"] == 3
    assert hb1_data["runs_executed"] == 3

    with Session(get_engine()) as db:
        ar_after = db.get(StagedTransaction, ar_id)
        ap_after = db.get(StagedTransaction, ap_id)
        overdue_after = db.get(BankTransaction, overdue_id)
        assert ar_after is not None and ar_after.approved is True and ar_after.status == "INVOICED"
        assert ap_after is not None and ap_after.approved is True and ap_after.status == "BILLED"
        assert overdue_after is not None
        assert int((overdue_after.metadata_json or {}).get("sla_reminder_count", 0)) >= 1

    # 3. Verify GET /{cid}/{aid}/runs returns Reasoning Traces with Customer/Vendor terminology and NO em dashes
    runs_ar = client.get(f"/api/v1/agents/{cid}/agent_ar_slips/runs").json()
    runs_ap = client.get(f"/api/v1/agents/{cid}/agent_ap_bills/runs").json()
    assert runs_ar["count"] >= 2
    assert runs_ap["count"] >= 1
    latest_ar = runs_ar["runs"][0]
    latest_ap = runs_ap["runs"][0]
    assert latest_ar["trigger_type"] == "SCHEDULED_HEARTBEAT"
    assert latest_ar["invoices_drafted"] >= 1
    assert latest_ap["invoices_drafted"] >= 1
    assert "Customer" in latest_ar["summary_report"] or "Customer" in " ".join(s["tool_output_summary"] for s in latest_ar["reasoning_steps"])
    assert "Vendor" in latest_ap["summary_report"] or "Vendor" in " ".join(s["tool_output_summary"] for s in latest_ap["reasoning_steps"])
    assert "\u2014" not in latest_ar["summary_report"]
    assert "\u2014" not in latest_ap["summary_report"]

    # 4. Immediate second heartbeat with force=False must SKIP hourly & daily agents (<1h elapsed)
    hb2 = client.post(
        "/api/v1/agents/heartbeat",
        json={"client_id": cid, "force": False, "month": "March", "year": 2026},
    )
    assert hb2.status_code == 200
    assert hb2.json()["runs_executed"] == 0

    # Whereas force=True runs again regardless of cadence timer
    hb3 = client.post(
        "/api/v1/agents/heartbeat",
        json={"client_id": cid, "force": True, "month": "March", "year": 2026},
    )
    assert hb3.status_code == 200
    assert hb3.json()["runs_executed"] == 3


@pytest.mark.asyncio
async def test_agentic_edge_cases_and_guardrails(client: TestClient, agentic_client_org: str):
    """Tests error paths, invalid inputs, empty goals/attachments, and AP/AR convention invariants."""
    cid = agentic_client_org

    # 1. Invalid autonomy level rejected cleanly
    bad_patch = client.patch(
        f"/api/v1/agents/{cid}/agent_ar_slips/autonomy",
        json={"autonomy_level": "rogue_mode"},
    )
    assert bad_patch.status_code == 400

    bad_exec = client.post(
        f"/api/v1/agents/{cid}/agent_ar_slips/execute-goal",
        json={"goal": "Check summary", "autonomy_override": "invalid_level"},
    )
    assert bad_exec.status_code == 400

    # 2. Non-existent agent / client returns 404
    missing_agent = client.post(
        f"/api/v1/agents/{cid}/does_not_exist/execute-goal",
        json={"goal": "Check summary"},
    )
    assert missing_agent.status_code == 404

    # 3. Empty goal falls back safely to full autonomous perception & analytics without crashing
    empty_goal_res = client.post(
        f"/api/v1/agents/{cid}/agent_ar_slips/execute-goal",
        json={"goal": "   ", "explicit_human_command": True},
    )
    assert empty_goal_res.status_code == 200
    run_obj = empty_goal_res.json()["run"]
    assert run_obj["actions_taken_count"] >= 1
    assert "\u2014" not in run_obj["summary_report"]

    # 4. Direct tool test with empty attachments list returns clean no_attachments structure
    with Session(get_engine()) as db:
        org = db.get(ClientOrganization, cid)
        agent = (org.agents or [])[0]
        att_out = await AgenticBrainService._tool_ingest_message_attachments(
            db=db,
            client=org,
            agent=agent,
            args={"attachments": [], "channel": "EMAIL", "sender": "test@example.com"},
        )
        assert att_out["status"] == "no_attachments"
        assert att_out["files_processed"] == 0


def test_as_preposition_categorization_and_chained_knowledge_rule(client: TestClient, agentic_client_org: str):
    """Covers 'as' preposition in categorization & knowledge rules, chained clause trimming, and BANK section inference."""
    cid = agentic_client_org
    with Session(get_engine()) as db:
        db.add(
            BankTransaction(
                client_id=cid,
                transaction_date="2026-03-10",
                description="ECG PREPAID ACCRA",
                amount=480.0,
                transaction_type="DEBIT",
                source_file_name="march_bank.csv",
                status="UNMAPPED",
            )
        )
        db.add(
            BankTransaction(
                client_id=cid,
                transaction_date="2026-03-11",
                description="MTN FIBER BUSINESS",
                amount=350.0,
                transaction_type="DEBIT",
                source_file_name="march_bank.csv",
                status="UNMAPPED",
            )
        )
        db.add(
            BankTransaction(
                client_id=cid,
                transaction_date="2026-03-12",
                description="VODAFONE GHANA FIBER",
                amount=290.0,
                transaction_type="DEBIT",
                source_file_name="march_bank.csv",
                status="UNMAPPED",
            )
        )
        db.commit()

    # 1. Chained rule via /knowledge/teach with 'as' + chained 'and auto-approve ...' and section="ALL"
    teach_res = client.post(
        f"/api/v1/clients/{cid}/knowledge/teach",
        json={
            "raw_text": "Categorize ECG debits as 5020 - Electricity Expense and auto-approve valid Kempinski slips",
            "section": "ALL",
            "agent_id": "ALL",
        },
    )
    assert teach_res.status_code == 200
    teach_data = teach_res.json()
    assert teach_data["learned_count"] >= 1
    coa_rules = [e for e in teach_data["learned_entries"] if e.get("category") == "COA_MAPPING_RULE"]
    assert len(coa_rules) == 1
    assert coa_rules[0]["target_value"] == "5020 - Electricity Expense"
    assert "auto-approve" not in coa_rules[0]["target_value"].lower()
    assert coa_rules[0]["trigger_pattern"].lower() == "ecg"
    assert teach_data["reactive_run"]["agent_id"] == "agent_bank_recon"

    # 2. Direct NL execute-goal using 'as' preposition against MTN Fiber
    goal_res = client.post(
        f"/api/v1/agents/{cid}/agent_bank_recon/execute-goal",
        json={
            "goal": "Categorize MTN Fiber debits as 6010 - Telecom & Internet",
            "explicit_human_command": True,
        },
    )
    assert goal_res.status_code == 200
    assert "categorize_bank_transactions" in {s["tool_name"] for s in goal_res.json()["run"].get("reasoning_steps", [])}

    # 3. Structured /knowledge save with section="ALL" infers BANK (not AR) for COA_MAPPING_RULE
    save_res = client.post(
        f"/api/v1/clients/{cid}/knowledge",
        json={
            "title": "Vodafone Fiber Rule",
            "rule_content": "Map Vodafone fiber charges to 6015 - Fiber Optic",
            "category": "COA_MAPPING_RULE",
            "section": "ALL",
            "agent_id": "ALL",
            "trigger_pattern": "vodafone",
            "target_value": "6015 - Fiber Optic",
        },
    )
    assert save_res.status_code == 200
    assert save_res.json()["reactive_run"]["agent_id"] == "agent_bank_recon"

    with Session(get_engine()) as db:
        ecg = db.exec(select(BankTransaction).where(BankTransaction.client_id == cid, BankTransaction.description == "ECG PREPAID ACCRA")).first()
        mtn = db.exec(select(BankTransaction).where(BankTransaction.client_id == cid, BankTransaction.description == "MTN FIBER BUSINESS")).first()
        voda = db.exec(select(BankTransaction).where(BankTransaction.client_id == cid, BankTransaction.description == "VODAFONE GHANA FIBER")).first()
        assert ecg and ecg.status == "MAPPED" and ecg.mapped_account_name == "5020 - Electricity Expense"
        assert mtn and mtn.status == "MAPPED" and mtn.mapped_account_name == "6010 - Telecom & Internet"
        assert voda and voda.status == "MAPPED" and voda.mapped_account_name == "6015 - Fiber Optic"


@pytest.mark.asyncio
async def test_corrupt_attachments_rejected_and_http_whatsapp_attachments_ingested(client: TestClient, agentic_client_org: str, monkeypatch):
    """Corrupt/empty files cannot fabricate VALID rows; URL downloads & WhatsApp multipart uploads ingest real bytes."""
    import httpx
    from types import SimpleNamespace

    cid = agentic_client_org

    # 1. Corrupt PDF + empty 0-byte attachment must fail cleanly without creating synthetic rows
    with Session(get_engine()) as db:
        org = db.get(ClientOrganization, cid)
        ar_agent = [a for a in (org.agents or []) if a["id"] == "agent_ar_slips"][0]
        corrupt_out = await AgenticBrainService._tool_ingest_message_attachments(
            db=db,
            client=org,
            agent=ar_agent,
            args={
                "attachments": [
                    {
                        "filename": "bad_slip.pdf",
                        "content_type": "application/pdf",
                        "content_base64": base64.b64encode(b"%PDF-1.4\x00CORRUPTED_TRUNCATED_GARBAGE").decode(),
                    },
                    {
                        "filename": "empty_receipt.pdf",
                        "content_type": "application/pdf",
                        "content_base64": "",
                    },
                ],
                "channel": "EMAIL",
                "sender": "ada@trueagentic.example.com",
            },
        )
        assert corrupt_out["status"] == "error"
        assert corrupt_out["staged_transactions_created"] == 0
        assert corrupt_out["bank_transactions_staged"] == 0
        assert len(corrupt_out["failed_files"]) == 2
        failed_names = {f["file_name"] for f in corrupt_out["failed_files"]}
        assert {"bad_slip.pdf", "empty_receipt.pdf"} == failed_names

        # Auto-approve right after must approve 0 rows (nothing fabricated)
        app_out = await AgenticBrainService._tool_auto_approve_verified_transactions(
            db=db, client=org, agent=ar_agent, args={}
        )
        assert app_out["approved_count"] == 0

    # 2. HTTP URL attachment download with mocked httpx.AsyncClient
    csv_bytes = b"date,vendor,description,qty,amount\n2026-03-15,GridCo Ghana,Power Supply March,1,1250.00\n"

    class _FakeAsyncHttpClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, **kwargs):
            assert "cdn.example.com/gridco_bill.csv" in str(url)
            return SimpleNamespace(
                status_code=200,
                content=csv_bytes,
                headers={"content-type": "text/csv"},
                raise_for_status=lambda: None,
            )

    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncHttpClient)
    with Session(get_engine()) as db:
        org = db.get(ClientOrganization, cid)
        ap_agent = [a for a in (org.agents or []) if a["id"] == "agent_ap_bills"][0]
        url_out = await AgenticBrainService._tool_ingest_message_attachments(
            db=db,
            client=org,
            agent=ap_agent,
            args={
                "attachments": [{"filename": "gridco_bill.csv", "url": "https://cdn.example.com/gridco_bill.csv"}],
                "channel": "WHATSAPP",
                "sender": "+233244556677",
            },
        )
        assert url_out["status"] == "success"
        assert url_out["staged_transactions_created"] == 1
        staged_gridco = db.exec(select(StagedTransaction).where(StagedTransaction.client_id == cid, StagedTransaction.source_file_name == "gridco_bill.csv")).first()
        assert staged_gridco is not None
        assert staged_gridco.total_amount == 1250.0
        assert staged_gridco.pipeline_type == "AP"

    # 3. WhatsApp multipart/form-data file upload on tenant webhook preserves file bytes
    wa_csv = b"date,vendor,description,qty,amount\n2026-03-16,Telecel Business,Fiber Link,1,680.00\n"
    wa_res = client.post(
        f"/api/v1/agents/webhooks/whatsapp/{cid}",
        data={"From": "whatsapp:+233244556677", "Body": "Please ingest this attached vendor bill"},
        files={"file": ("wa_vendor_bill.csv", wa_csv, "text/csv")},
    )
    assert wa_res.status_code == 200
    with Session(get_engine()) as db:
        wa_row = db.exec(select(StagedTransaction).where(StagedTransaction.client_id == cid, StagedTransaction.source_file_name == "wa_vendor_bill.csv")).first()
        assert wa_row is not None
        assert wa_row.pipeline_type == "AP"
        assert wa_row.total_amount == 680.0


@pytest.mark.asyncio
async def test_staged_anomaly_clarification_sla_followup_and_portal_routing(client: TestClient, agentic_client_org: str):
    """Covers STAGED:<id> anomaly query persistence, >72h SLA followup, and non-BANK portal clarification routing."""
    cid = agentic_client_org
    overdue_ts = (datetime.now(timezone.utc) - timedelta(hours=80)).isoformat()

    with Session(get_engine()) as db:
        fresh_anom = StagedTransaction(
            client_id=cid,
            batch_id="March_2026",
            pipeline_id="agent_ar_slips",
            pipeline_name="AR Control Slips Agent",
            pipeline_type="AR",
            entity_type="ar_sales_invoice",
            transaction_date="2026-03-14",
            source_type="google_drive",
            source_file_name="kempinski_fresh_anom.pdf",
            item_or_description="Event Hall Linen",
            quantity_or_debit=10.0,
            rate_or_price=50.0,
            total_amount=500.0,
            confidence_score=0.61,
            validation_status="PENDING_VALIDATION_ERROR",
            discrepancy_amount=50.0,
            discrepancy_reason="MISSING_PO_NUMBER",
            status="PENDING",
            metadata_json={"customer_name": "Kempinski Hotel"},
        )
        overdue_anom = StagedTransaction(
            client_id=cid,
            batch_id="March_2026",
            pipeline_id="agent_ar_slips",
            pipeline_name="AR Control Slips Agent",
            pipeline_type="AR",
            entity_type="ar_sales_invoice",
            transaction_date="2026-03-09",
            source_type="google_drive",
            source_file_name="labadi_overdue_anom.pdf",
            item_or_description="Tablecloth Set",
            quantity_or_debit=5.0,
            rate_or_price=40.0,
            total_amount=200.0,
            confidence_score=0.58,
            validation_status="PENDING_VALIDATION_ERROR",
            discrepancy_amount=25.0,
            discrepancy_reason="RATE_MISMATCH",
            status="PENDING",
            metadata_json={
                "customer_name": "Labadi Beach",
                "query_status": "CLARIFICATION_REQUESTED",
                "query_date": overdue_ts,
                "accountant_query": "Please confirm contract rate for Tablecloth Set.",
            },
        )
        db.add(fresh_anom)
        db.add(overdue_anom)
        db.commit()
        db.refresh(fresh_anom)
        db.refresh(overdue_anom)
        fresh_id = fresh_anom.id

        org = db.get(ClientOrganization, cid)
        ar_agent = [a for a in (org.agents or []) if a["id"] == "agent_ar_slips"][0]

        q_out = await AgenticBrainService._tool_raise_anomaly_clarification_requests(
            db=db, client=org, agent=ar_agent, args={"month": "March", "year": 2026}
        )
        assert q_out["queries_dispatched"] == 1

        sla_out = await AgenticBrainService._tool_followup_overdue_information_requests(
            db=db, client=org, agent=ar_agent, args={}
        )
        assert sla_out["reminders_sent"] >= 1

        db.refresh(fresh_anom)
        db.refresh(overdue_anom)
        assert (fresh_anom.metadata_json or {}).get("query_status") == "CLARIFICATION_REQUESTED"
        assert (fresh_anom.metadata_json or {}).get("query_date")
        assert int((overdue_anom.metadata_json or {}).get("sla_reminder_count") or 0) >= 1

    # Portal response for STAGED:<id> routes PORTAL_CLARIFICATION_SUBMITTED to AR agent (not hardcoded BANK)
    token = generate_portal_token(cid, "True Agentic Holdings Ltd")
    explain_res = client.post(
        f"/api/v1/portal/items/STAGED:{fresh_id}/explain",
        headers={"Authorization": f"Bearer {token}"},
        json={"client_explanation": "PO-9921 confirmed by Kempinski finance (Linen Services)"},
    )
    assert explain_res.status_code == 200, explain_res.text

    with Session(get_engine()) as db:
        refreshed = db.get(StagedTransaction, fresh_id)
        assert (refreshed.metadata_json or {}).get("query_status") == "CLIENT_ANSWERED"
        runs = list(
            db.exec(
                select(AgentExecutionRun).where(
                    AgentExecutionRun.client_id == cid,
                    AgentExecutionRun.trigger_type == "REACTIVE_EVENT",
                    AgentExecutionRun.trigger_source == "PORTAL_CLARIFICATION_SUBMITTED",
                )
            ).all()
        )
        assert len(runs) >= 1
        latest = sorted(runs, key=lambda r: r.id)[-1]
        assert latest.agent_id == "agent_ar_slips"
        assert latest.section == "AR"


@pytest.mark.asyncio
async def test_gemini_react_json_planner_live_and_malformed_fallback(client: TestClient, agentic_client_org: str, monkeypatch):
    """Tests live Gemini ReAct JSON planner path and resilient fallback to deterministic plan on malformed JSON."""
    import google.genai as genai
    from types import SimpleNamespace
    from app.config import settings
    from app.services.zoho_service import ZohoBooksService

    cid = agentic_client_org
    with Session(get_engine()) as db:
        db.add(
            BankTransaction(
                client_id=cid,
                transaction_date="2026-03-14",
                description="ECG PREPAID ACCRA",
                amount=310.0,
                transaction_type="DEBIT",
                source_file_name="march_bank.csv",
                status="UNMAPPED",
            )
        )
        db.commit()

    monkeypatch.setattr(ZohoBooksService, "can_transact", lambda self: False)

    planner_outputs = iter([
        '{"steps": [{"thought": "Classify ECG utility charge via Gemini ReAct plan.", "tool_name": "categorize_bank_transactions", "tool_input": {"payee_or_description": "ECG", "account_name": "5020 - Electricity Expense", "learn_rule": true}}]}',
        "NOT VALID JSON {{{ truncated",
    ])

    class _FakeModels:
        def generate_content(self, **kwargs):
            return SimpleNamespace(text=next(planner_outputs))

    class _FakeGenAIClient:
        def __init__(self, *args, **kwargs):
            self.models = _FakeModels()

    monkeypatch.setattr(genai, "Client", _FakeGenAIClient)

    orig_mock = settings.MOCK_MODE
    orig_key = settings.GEMINI_API_KEY
    try:
        settings.MOCK_MODE = False
        settings.GEMINI_API_KEY = "test_fake_gemini_key"

        with Session(get_engine()) as db:
            org = db.get(ClientOrganization, cid)
            bank_agent = [a for a in (org.agents or []) if a["id"] == "agent_bank_recon"][0]

            # A: Valid Gemini ReAct JSON plan chooses categorize_bank_transactions on neutral prompt
            run_live = await AgenticBrainService.plan_and_execute_goal(
                db=db,
                client=org,
                agent=bank_agent,
                goal="Review March utility charge",
                trigger_type="MANUAL_UI",
                month="March",
                year=2026,
                explicit_human_command=True,
            )
            assert run_live["status"] == "COMPLETED"
            assert "categorize_bank_transactions" in {s["tool_name"] for s in (run_live.get("reasoning_steps") or [])}

            ecg = db.exec(select(BankTransaction).where(BankTransaction.client_id == cid, BankTransaction.description == "ECG PREPAID ACCRA")).first()
            assert ecg and ecg.status == "MAPPED" and ecg.mapped_account_name == "5020 - Electricity Expense"

            # B: Malformed Gemini JSON falls back safely to deterministic plan without raising
            run_fb = await AgenticBrainService.plan_and_execute_goal(
                db=db,
                client=org,
                agent=bank_agent,
                goal="Show March summary breakdown",
                trigger_type="MANUAL_UI",
                month="March",
                year=2026,
                explicit_human_command=True,
            )
            assert run_fb["status"] == "COMPLETED"
            assert "query_ledger_analytics" in {s["tool_name"] for s in (run_fb.get("reasoning_steps") or [])}
    finally:
        settings.MOCK_MODE = orig_mock
        settings.GEMINI_API_KEY = orig_key


@pytest.mark.asyncio
async def test_live_zoho_ap_ar_contact_resolution_bank_sync_and_inngest_heartbeat(client: TestClient, agentic_client_org: str, monkeypatch):
    """Tests live Zoho AP/AR Vendor/Customer contact resolution, BANK_SYNC_COMPLETED reactive chaining, and Inngest active+live sweep."""
    from types import SimpleNamespace
    from app.services.accounting.factory import AccountingAdapterFactory
    from app.config import settings
    from app.models.schemas import ZohoContact, ZohoDraftBillResponse, ZohoDraftInvoiceResponse
    from app.services.zoho_service import ZohoBooksService
    from app.workflows.client_strategy_pipeline import inngest_agent_heartbeat_fn

    cid = agentic_client_org

    # --- Part A: Live Zoho AP Vendor & AR Customer Contact Resolution ---
    with Session(get_engine()) as db:
        db.add(
            StagedTransaction(
                client_id=cid,
                batch_id="March_2026",
                pipeline_id="agent_ap_bills",
                pipeline_name="AP Vendor Bills Agent",
                pipeline_type="AP",
                entity_type="ap_vendor_bill",
                transaction_date="2026-03-14",
                source_type="email",
                source_file_name="melcom_bill.pdf",
                item_or_description="Cleaning Supplies",
                quantity_or_debit=2.0,
                rate_or_price=260.0,
                total_amount=520.0,
                confidence_score=0.96,
                validation_status="VALID",
                status="APPROVED",
                approved=True,
                metadata_json={"vendor_name": "Melcom Ghana Ltd"},
            )
        )
        db.add(
            StagedTransaction(
                client_id=cid,
                batch_id="March_2026",
                pipeline_id="agent_ar_slips",
                pipeline_name="AR Control Slips Agent",
                pipeline_type="AR",
                entity_type="ar_sales_invoice",
                transaction_date="2026-03-14",
                source_type="google_drive",
                source_file_name="kempinski_approved.pdf",
                item_or_description="Duvet Cover Set",
                quantity_or_debit=10.0,
                rate_or_price=74.0,
                total_amount=740.0,
                confidence_score=0.97,
                validation_status="VALID",
                status="APPROVED",
                approved=True,
                metadata_json={"customer_name": "Kempinski Hotel"},
            )
        )
        db.commit()

    captured_bills = []
    captured_invoices = []

    async def _fake_fetch_vendors(self):
        return []

    async def _fake_create_vendor(self, vendor_name: str):
        return ZohoContact(contact_id="zoho_vnd_999", contact_name=vendor_name, company_name=vendor_name, status="active")

    async def _fake_create_draft_bill(self, req):
        captured_bills.append(req)
        return ZohoDraftBillResponse(
            bill_id="zb_999",
            bill_number="BILL-ZOHO-999",
            vendor_id=req.vendor_id,
            vendor_name="Melcom Ghana Ltd",
            total=520.0,
            status="draft",
        )

    async def _fake_fetch_contacts(self):
        cust = ZohoContact(contact_id="zoho_cust_888", contact_name="Kempinski Hotel", company_name="Kempinski Hotel", status="active")
        self._cached_contacts = [cust]
        return [cust]

    async def _fake_create_or_append_inv(self, req, month=None, year=None):
        captured_invoices.append(req)
        return ZohoDraftInvoiceResponse(
            invoice_id="zi_888",
            invoice_number="INV-ZOHO-888",
            customer_id=req.customer_id,
            customer_name="Kempinski Hotel",
            status="draft",
            total=740.0,
            date=req.date,
        )

    monkeypatch.setattr(ZohoBooksService, "can_transact", lambda self: True)
    monkeypatch.setattr(ZohoBooksService, "fetch_active_vendors", _fake_fetch_vendors)
    monkeypatch.setattr(ZohoBooksService, "create_vendor_contact", _fake_create_vendor)
    monkeypatch.setattr(ZohoBooksService, "create_draft_bill", _fake_create_draft_bill)
    monkeypatch.setattr(ZohoBooksService, "fetch_active_contacts", _fake_fetch_contacts)
    monkeypatch.setattr(ZohoBooksService, "create_or_append_draft_invoice", _fake_create_or_append_inv)

    orig_mock = settings.MOCK_MODE
    try:
        settings.MOCK_MODE = False
        with Session(get_engine()) as db:
            org = db.get(ClientOrganization, cid)
            ap_agent = [a for a in (org.agents or []) if a["id"] == "agent_ap_bills"][0]
            ar_agent = [a for a in (org.agents or []) if a["id"] == "agent_ar_slips"][0]

            ap_out = await AgenticBrainService._tool_generate_draft_invoices_or_bills(
                db=db, client=org, agent=ap_agent, args={"month": "March", "year": 2026}
            )
            assert ap_out["status"] == "success"
            assert ap_out["invoices_drafted"] == 1
            assert len(captured_bills) == 1
            assert captured_bills[0].vendor_id == "zoho_vnd_999"
            assert not captured_bills[0].vendor_id.startswith("vnd_auto_")

            ar_out = await AgenticBrainService._tool_generate_draft_invoices_or_bills(
                db=db, client=org, agent=ar_agent, args={"month": "March", "year": 2026}
            )
            assert ar_out["status"] == "success"
            assert ar_out["invoices_drafted"] == 1
            assert len(captured_invoices) == 1
            assert captured_invoices[0].customer_id == "zoho_cust_888"
            assert not captured_invoices[0].customer_id.startswith("cnt_auto_")

            # Verify unresolved live Vendor fails truthfully without marking row BILLED
            bad_ap = StagedTransaction(
                client_id=cid,
                batch_id="March_2026",
                pipeline_id="agent_ap_bills",
                pipeline_name="AP Vendor Bills Agent",
                pipeline_type="AP",
                entity_type="ap_vendor_bill",
                transaction_date="2026-03-14",
                source_type="email",
                source_file_name="broken_vendor.pdf",
                item_or_description="Unresolved Vendor Item",
                quantity_or_debit=1.0,
                rate_or_price=100.0,
                total_amount=100.0,
                confidence_score=0.95,
                validation_status="VALID",
                status="APPROVED",
                approved=True,
                metadata_json={"vendor_name": "Broken Vendor"},
            )
            db.add(bad_ap)
            db.commit()
            db.refresh(bad_ap)

            async def _fail_create_vendor(self, vendor_name: str):
                raise RuntimeError("Zoho 400 Vendor create rejected")

            monkeypatch.setattr(ZohoBooksService, "create_vendor_contact", _fail_create_vendor)
            err_out = await AgenticBrainService._tool_generate_draft_invoices_or_bills(
                db=db, client=org, agent=ap_agent, args={"month": "March", "year": 2026}
            )
            assert err_out["status"] == "error"
            assert err_out["invoices_drafted"] == 0
            assert len(err_out["errors"]) == 1
            db.refresh(bad_ap)
            assert bad_ap.status == "APPROVED"
    finally:
        settings.MOCK_MODE = orig_mock

    # --- Part B: BANK_SYNC_COMPLETED Reactive Trigger ---
    class _FakeAdapter:
        platform_name = "Zoho Books"

        async def fetch_uncategorized_bank_transactions(self, watched_accounts=None, month=None, year=None):
            return [
                {
                    "transaction_date": "2026-03-18",
                    "description": "STANBIC BANK FEE",
                    "amount": 45.0,
                    "transaction_type": "DEBIT",
                    "external_transaction_id": "zbk_sync_001",
                }
            ]

    monkeypatch.setattr(AccountingAdapterFactory, "get", lambda software, client_id: _FakeAdapter())
    sync_res = client.post(f"/api/v1/bank/clients/{cid}/sync-accounting")
    assert sync_res.status_code == 200
    sync_data = sync_res.json()
    assert sync_data["synced_new_count"] == 1
    assert sync_data["reactive_run"] is not None
    assert sync_data["reactive_run"]["trigger_type"] == "REACTIVE_EVENT"
    assert sync_data["reactive_run"]["trigger_source"] == "BANK_SYNC_COMPLETED"
    assert sync_data["reactive_run"]["section"] == "BANK"

    # --- Part C: Inngest Heartbeat & Global Sweep Includes Both 'live' and 'active' Clients ---
    active_cid = "test_active_status_co"
    try:
        with Session(get_engine()) as db:
            _cleanup_test_client(db, active_cid)
            db.add(
                ClientOrganization(
                    id=active_cid,
                    organization_id="s4_advisory",
                    name="Active Status Sweep Ltd",
                    industry="Financial Services",
                    status="active",
                    accounting_software="zoho_books",
                    agents=[
                        {
                            "id": "agent_active_bank",
                            "name": "Active Bank Agent",
                            "section": "BANK",
                            "entity_type": "bank_feed",
                            "source_type": "bank_feed",
                            "is_active": True,
                            "active": True,
                            "autonomy_level": "semi_autonomous",
                            "schedule_frequency": "hourly",
                        }
                    ],
                    pipelines=[
                        {
                            "id": "agent_active_bank",
                            "name": "Active Bank Agent",
                            "section": "BANK",
                            "entity_type": "bank_feed",
                            "source_type": "bank_feed",
                            "is_active": True,
                            "active": True,
                            "autonomy_level": "semi_autonomous",
                            "schedule_frequency": "hourly",
                        }
                    ],
                )
            )
            db.commit()

        hb_out = await inngest_agent_heartbeat_fn._handler(
            SimpleNamespace(event=SimpleNamespace(data={"client_id": None, "force": True, "month": "March", "year": 2026})),
            step=None,
        )
        assert hb_out["clients_checked"] >= 2
        with Session(get_engine()) as db:
            active_runs = list(db.exec(select(AgentExecutionRun).where(AgentExecutionRun.client_id == active_cid)).all())
            live_runs = list(db.exec(select(AgentExecutionRun).where(AgentExecutionRun.client_id == cid)).all())
            assert len(active_runs) >= 1
            assert len(live_runs) >= 1
    finally:
        with Session(get_engine()) as db:
            _cleanup_test_client(db, active_cid)


@pytest.mark.asyncio
async def test_multi_turn_react_loop_and_termination_guards(client: TestClient, agentic_client_org: str, monkeypatch):
    """Verifies multi-turn ReAct Observe -> Re-plan -> Act -> Verify in both deterministic & Gemini modes and loop guards."""
    import google.genai as genai
    from types import SimpleNamespace
    from app.config import settings
    from app.services.zoho_service import ZohoBooksService

    cid = agentic_client_org
    monkeypatch.setattr(ZohoBooksService, "can_transact", lambda self: False)

    # 1. Deterministic multi-turn: Turn 1 ingests AR CSV attachment -> Turn 2 observes new pending items & auto-approves + queries analytics
    with Session(get_engine()) as db:
        org = db.get(ClientOrganization, cid)
        ar_agent = [a for a in (org.agents or []) if a["id"] == "agent_ar_slips"][0]
        ar_csv = b"date,customer,item,qty,rate,total\n2026-03-20,Kempinski Hotel,Duvet Cover,10,25.00,250.00\n"
        det_run = await AgenticBrainService.plan_and_execute_goal(
            db=db,
            client=org,
            agent=ar_agent,
            goal="Process incoming hotel document",
            trigger_type="EMAIL_COMMAND",
            trigger_source="ada@trueagentic.example.com",
            month="March",
            year=2026,
            attachments=[{
                "filename": "kempinski_march_slip.csv",
                "content_type": "text/csv",
                "content_bytes": ar_csv,
            }],
            explicit_human_command=False,
        )
        assert det_run["status"] == "COMPLETED"
        steps = det_run["reasoning_steps"]
        assert any(s.get("react_turn") == 1 and s["tool_name"] == "ingest_message_attachments" for s in steps)
        assert any(s.get("react_turn") == 2 and s["tool_name"] == "auto_approve_verified_transactions" for s in steps)
        assert any(s.get("react_turn") == 2 and s["tool_name"] == "query_ledger_analytics" for s in steps)
        staged = db.exec(
            select(StagedTransaction).where(
                StagedTransaction.client_id == cid,
                StagedTransaction.source_file_name == "kempinski_march_slip.csv",
            )
        ).first()
        assert staged is not None and staged.approved is True and staged.status == "APPROVED"

    # 2. Live Gemini multi-turn ReAct (done=false -> Turn 2 sees prior_observations & knowledge_rules -> done=true)
    #    AND attachment Turn 1 -> Gemini Turn 2
    teach_res = client.post(
        f"/api/v1/clients/{cid}/knowledge/teach",
        json={
            "text": "Map HUBTEL transactions to 5045 - Payment Processing Fees",
            "agent_id": "agent_bank_recon",
            "section": "BANK",
        },
    )
    assert teach_res.status_code == 200

    with Session(get_engine()) as db:
        db.add(
            BankTransaction(
                client_id=cid,
                transaction_date="2026-03-21",
                description="WATER COMPANY GHANA",
                amount=190.0,
                transaction_type="DEBIT",
                source_file_name="march_bank.csv",
                status="UNMAPPED",
            )
        )
        db.commit()

    captured_prompts = []
    scripted_responses = []

    class _FakeModels:
        def generate_content(self, **kwargs):
            captured_prompts.append(str(kwargs.get("contents") or ""))
            return SimpleNamespace(text=scripted_responses.pop(0))

    class _FakeGenAIClient:
        def __init__(self, *args, **kwargs):
            self.models = _FakeModels()

    monkeypatch.setattr(genai, "Client", _FakeGenAIClient)

    orig_mock = settings.MOCK_MODE
    orig_key = settings.GEMINI_API_KEY
    try:
        settings.MOCK_MODE = False
        settings.GEMINI_API_KEY = "test_fake_gemini_key"

        with Session(get_engine()) as db:
            org = db.get(ClientOrganization, cid)
            bank_agent = [a for a in (org.agents or []) if a["id"] == "agent_bank_recon"][0]

            # A. Two-turn Gemini ReAct loop
            captured_prompts.clear()
            scripted_responses[:] = [
                '{"done": false, "final_thought": "", "steps": [{"thought": "Categorize water utility first", "tool_name": "categorize_bank_transactions", "tool_input": {"payee_or_description": "WATER COMPANY", "account_name": "5035 - Water Utility", "learn_rule": true}}]}',
                '{"done": true, "final_thought": "Water utility mapped and ledger analytics verified.", "steps": [{"thought": "Verify updated totals", "tool_name": "query_ledger_analytics", "tool_input": {"month": "March", "year": 2026}}]}',
            ]
            mt_run = await AgenticBrainService.plan_and_execute_goal(
                db=db,
                client=org,
                agent=bank_agent,
                goal="Classify March water utility and confirm totals",
                trigger_type="MANUAL_UI",
                month="March",
                year=2026,
                explicit_human_command=True,
            )
            assert mt_run["status"] == "COMPLETED"
            assert len(captured_prompts) == 2
            assert "HUBTEL" in captured_prompts[0]
            assert "categorize_bank_transactions" in captured_prompts[1]
            assert mt_run["reasoning_steps"][0]["react_turn"] == 1
            assert mt_run["reasoning_steps"][1]["react_turn"] == 2
            assert "Water utility mapped and ledger analytics verified." in mt_run["summary_report"]

            # B. Live Gemini + attachment: Turn 1 runs ingest_message_attachments without Gemini, Turn 2 invokes Gemini with Turn 1 observation
            captured_prompts.clear()
            scripted_responses[:] = [
                '{"done": true, "final_thought": "Attachment ingestion inspected and verified complete.", "steps": []}',
            ]
            att_live_run = await AgenticBrainService.plan_and_execute_goal(
                db=db,
                client=org,
                agent=bank_agent,
                goal="Ingest March mobile money csv attachment",
                trigger_type="EMAIL_COMMAND",
                trigger_source="cfo@trueagentic.example.com",
                month="March",
                year=2026,
                attachments=[{
                    "filename": "momo_march_stmt.csv",
                    "content_type": "text/csv",
                    "content_bytes": b"Date,Description,Debit,Credit\n2026-03-22,HUBTEL TRANSFER FEE,15.00,0\n",
                }],
                explicit_human_command=True,
            )
            assert att_live_run["status"] == "COMPLETED"
            assert len(captured_prompts) == 1
            assert "ingest_message_attachments" in captured_prompts[0]
            assert att_live_run["reasoning_steps"][0]["react_turn"] == 1
            assert att_live_run["reasoning_steps"][0]["tool_name"] == "ingest_message_attachments"
            assert "Attachment ingestion inspected and verified complete." in att_live_run["summary_report"]

            # C. Duplicate execution guard: repeating identical tool call with done=false breaks cleanly instead of spinning
            captured_prompts.clear()
            scripted_responses[:] = [
                '{"done": false, "steps": [{"thought": "Check metrics", "tool_name": "query_ledger_analytics", "tool_input": {"month": "March", "year": 2026}}]}',
                '{"done": false, "steps": [{"thought": "Repeat same call", "tool_name": "query_ledger_analytics", "tool_input": {"month": "March", "year": 2026}}]}',
                '{"done": false, "steps": [{"thought": "Should never reach turn 3", "tool_name": "query_ledger_analytics", "tool_input": {"month": "March", "year": 2026}}]}',
            ]
            dedup_run = await AgenticBrainService.plan_and_execute_goal(
                db=db,
                client=org,
                agent=bank_agent,
                goal="Check March analytics",
                trigger_type="MANUAL_UI",
                month="March",
                year=2026,
                explicit_human_command=True,
            )
            assert len(captured_prompts) == 2
            assert len(dedup_run["reasoning_steps"]) == 1

            # D. Hard MAX_REACT_TURNS cap: distinct steps returning done=false stop at MAX_REACT_TURNS (5)
            captured_prompts.clear()
            months_cycle = ["January", "February", "March", "April", "May", "June", "July"]
            scripted_responses[:] = [
                f'{{"done": false, "steps": [{{"thought": "Check {m}", "tool_name": "query_ledger_analytics", "tool_input": {{"month": "{m}", "year": 2026}}}}]}}'
                for m in months_cycle
            ]
            cap_run = await AgenticBrainService.plan_and_execute_goal(
                db=db,
                client=org,
                agent=bank_agent,
                goal="Audit monthly snapshots sequentially",
                trigger_type="MANUAL_UI",
                month="March",
                year=2026,
                explicit_human_command=True,
            )
            assert len(captured_prompts) == AgenticBrainService.MAX_REACT_TURNS
            assert len(cap_run["reasoning_steps"]) == AgenticBrainService.MAX_REACT_TURNS
            assert max(s["react_turn"] for s in cap_run["reasoning_steps"]) == 5
    finally:
        settings.MOCK_MODE = orig_mock
        settings.GEMINI_API_KEY = orig_key


def test_bank_upload_endpoint_triggers_reactive_agent_categorization(client: TestClient, agentic_client_org: str):
    """POST /api/v1/bank/upload fires BANK_SYNC_COMPLETED reactive categorization when newly_staged > 0 and returns None on duplicate upload."""
    cid = agentic_client_org
    teach_res = client.post(
        f"/api/v1/clients/{cid}/knowledge/teach",
        json={
            "text": "Map TOTALENERGIES transactions to 5040 - Fuel & Transport",
            "agent_id": "agent_bank_recon",
            "section": "BANK",
        },
    )
    assert teach_res.status_code == 200, teach_res.text

    csv_payload = b"Date,Description,Debit,Credit,Balance\n2026-03-19,TOTALENERGIES ACCRA STATION,320.00,,1400.00\n"
    up1 = client.post(
        "/api/v1/bank/upload",
        data={"client_id": cid, "month": "March", "year": "2026"},
        files={"file": ("march_upload.csv", csv_payload, "text/csv")},
    )
    assert up1.status_code == 200, up1.text
    d1 = up1.json()
    assert d1["status"] == "success"
    assert d1["newly_staged"] == 1
    assert d1["reactive_run"] is not None
    assert d1["reactive_run"]["trigger_type"] == "REACTIVE_EVENT"
    assert d1["reactive_run"]["trigger_source"] == "BANK_SYNC_COMPLETED"
    assert d1["reactive_run"]["section"] == "BANK"

    with Session(get_engine()) as db:
        bt = db.exec(
            select(BankTransaction).where(
                BankTransaction.client_id == cid,
                BankTransaction.description == "TOTALENERGIES ACCRA STATION",
            )
        ).first()
        assert bt is not None
        assert bt.status == "MAPPED"
        assert "5040" in (bt.mapped_account_name or "")

    # Duplicate upload stages 0 rows -> skips redundant reactive trigger
    up2 = client.post(
        "/api/v1/bank/upload",
        data={"client_id": cid, "month": "March", "year": "2026"},
        files={"file": ("march_upload.csv", csv_payload, "text/csv")},
    )
    assert up2.status_code == 200, up2.text
    d2 = up2.json()
    assert d2["newly_staged"] == 0
    assert d2["reactive_run"] is None


@pytest.mark.asyncio
async def test_draft_invoice_dates_calendar_month_end_and_custom_rules(agentic_client_org: str, monkeypatch):
    """Validates exact calendar month-end dates (31, 29 leap Feb, 28 non-leap Feb, 30) and client invoicing_date_settings rules."""
    from types import SimpleNamespace
    from app.services.zoho_service import ZohoBooksService

    cid = agentic_client_org
    captured_reqs = []

    async def _fake_create_draft(self, req, month=None, year=None):
        captured_reqs.append(req)
        return SimpleNamespace(invoice_number=f"INV-{req.date}")

    monkeypatch.setattr(ZohoBooksService, "can_transact", lambda self: True)
    monkeypatch.setattr(ZohoBooksService, "create_or_append_draft_invoice", _fake_create_draft)
    monkeypatch.setattr(ZohoBooksService, "find_contact_by_name", lambda self, name: SimpleNamespace(contact_id="cnt_test_hotel", contact_name=name))

    def _seed_approved_row(db: Session, month_name: str, year_num: int, day_num: int) -> None:
        m_num = {"February": 2, "March": 3, "April": 4, "October": 10, "December": 12}[month_name]
        db.add(
            StagedTransaction(
                client_id=cid,
                batch_id=f"{month_name}_{year_num}",
                pipeline_id="agent_ar_slips",
                pipeline_name="AR Control Slips Agent",
                pipeline_type="AR",
                entity_type="ar_sales_invoice",
                transaction_date=f"{year_num:04d}-{m_num:02d}-{day_num:02d}",
                source_type="google_drive",
                source_file_name=f"kempinski_{month_name.lower()}_{year_num}.pdf",
                item_or_description="Banquet Linen",
                quantity_or_debit=10.0,
                rate_or_price=20.0,
                total_amount=200.0,
                confidence_score=0.98,
                validation_status="VALID",
                status="APPROVED",
                approved=True,
                metadata_json={"customer_name": "Kempinski Hotel"},
            )
        )
        db.commit()

    month_end_cases = [
        ("October", 2026, "2026-10-31"),
        ("February", 2024, "2024-02-29"),
        ("February", 2026, "2026-02-28"),
        ("April", 2026, "2026-04-30"),
    ]

    with Session(get_engine()) as db:
        org = db.get(ClientOrganization, cid)
        ar_agent = [a for a in (org.agents or []) if a["id"] == "agent_ar_slips"][0]

        for month_name, year_num, expected_date in month_end_cases:
            _seed_approved_row(db, month_name, year_num, 15)
            out = await AgenticBrainService._tool_generate_draft_invoices_or_bills(
                db=db,
                client=org,
                agent=ar_agent,
                args={"month": month_name, "year": year_num},
            )
            assert out["invoices_drafted"] == 1
            assert out["doc_date"] == expected_date
            assert out["details"][0]["date"] == expected_date
            assert captured_reqs[-1].date == expected_date

        # Custom rule: first_day_next_month (December rolls over to next year Jan 01)
        org.custom_config = {"invoicing_date_settings": {"invoice_date_rule": "first_day_next_month"}}
        db.add(org)
        db.commit()
        db.refresh(org)
        _seed_approved_row(db, "December", 2026, 20)
        dec_out = await AgenticBrainService._tool_generate_draft_invoices_or_bills(
            db=db,
            client=org,
            agent=ar_agent,
            args={"month": "December", "year": 2026},
        )
        assert dec_out["doc_date"] == "2027-01-01"
        assert captured_reqs[-1].date == "2027-01-01"

        # Custom rule: fixed_day (clamped cleanly to month's max day)
        org.custom_config = {"invoicing_date_settings": {"invoice_date_rule": "fixed_day", "fixed_invoice_day": 31}}
        db.add(org)
        db.commit()
        db.refresh(org)
        _seed_approved_row(db, "February", 2026, 10)
        feb_fixed_out = await AgenticBrainService._tool_generate_draft_invoices_or_bills(
            db=db,
            client=org,
            agent=ar_agent,
            args={"month": "February", "year": 2026},
        )
        assert feb_fixed_out["doc_date"] == "2026-02-28"

        # Custom rule: today
        org.custom_config = {"invoice_date_rule": "today"}
        db.add(org)
        db.commit()
        db.refresh(org)
        _seed_approved_row(db, "March", 2026, 5)
        today_out = await AgenticBrainService._tool_generate_draft_invoices_or_bills(
            db=db,
            client=org,
            agent=ar_agent,
            args={"month": "March", "year": 2026},
        )
        assert today_out["doc_date"] == datetime.now(timezone.utc).strftime("%Y-%m-%d")


def test_trigger_pipeline_stream_syncs_pipelines_and_agents(client: TestClient, agentic_client_org: str, monkeypatch):
    """POST /clients/{cid}/pipelines/{id}/trigger persists deep-copied run stats on BOTH client.pipelines and client.agents (including bank_feed)."""
    from app.services.accounting.factory import AccountingAdapterFactory

    cid = agentic_client_org

    # 1. Trigger AR pipeline (general DynamicBlueprintStrategy branch)
    ar_res = client.post(
        f"/api/v1/clients/{cid}/pipelines/agent_ar_slips/trigger",
        json={"month": "March", "year": 2026, "auto_post_to_accounting": False},
    )
    assert ar_res.status_code == 200, ar_res.text

    with Session(get_engine()) as db:
        org = db.get(ClientOrganization, cid)
        pipe_ar = next(p for p in (org.pipelines or []) if p["id"] == "agent_ar_slips")
        agent_ar = next(a for a in (org.agents or []) if a["id"] == "agent_ar_slips")
        assert int(pipe_ar.get("total_runs_count", 0)) == 1
        assert int(agent_ar.get("total_runs_count", 0)) == 1
        assert pipe_ar.get("last_run_summary") == agent_ar.get("last_run_summary")
        assert pipe_ar.get("last_run_summary") is not agent_ar.get("last_run_summary")
        assert pipe_ar.get("last_triggered_at") and agent_ar.get("last_triggered_at")
        assert pipe_ar.get("last_run_at") and agent_ar.get("last_run_at")

    # 2. Trigger BANK bank_feed pipeline (must not fail on nonexistent client.pipeline_streams)
    class _EmptyBankAdapter:
        platform_name = "Zoho Books"

        async def fetch_uncategorized_bank_transactions(self, watched_accounts=None, month=None, year=None):
            return []

    monkeypatch.setattr(AccountingAdapterFactory, "get", lambda software, client_id: _EmptyBankAdapter())

    bank_res = client.post(
        f"/api/v1/clients/{cid}/pipelines/agent_bank_recon/trigger",
        json={"month": "March", "year": 2026},
    )
    assert bank_res.status_code == 200, bank_res.text
    assert bank_res.json()["status"] == "COMPLETED"

    with Session(get_engine()) as db:
        org = db.get(ClientOrganization, cid)
        pipe_bank = next(p for p in (org.pipelines or []) if p["id"] == "agent_bank_recon")
        agent_bank = next(a for a in (org.agents or []) if a["id"] == "agent_bank_recon")
        assert int(pipe_bank.get("total_runs_count", 0)) == 1
        assert int(agent_bank.get("total_runs_count", 0)) == 1
        assert pipe_bank.get("last_run_summary", {}).get("pipeline_id") == "agent_bank_recon"
        assert agent_bank.get("last_run_summary", {}).get("pipeline_id") == "agent_bank_recon"
        assert pipe_bank.get("last_run_at") and agent_bank.get("last_run_at")


def test_date_rule_override_month_parsing_and_ap_bill_dates(agentic_client_org: str, monkeypatch):
    """Verifies _parse_month_num, strict override_date_rules isolation, fixed_day=0 clamping, AP ZohoDraftBillRequest.date, and Sheets fallback invoice_date."""
    import asyncio
    from types import SimpleNamespace
    from app.config import settings
    from app.services.zoho_service import ZohoBooksService

    cid = agentic_client_org
    assert AgenticBrainService._parse_month_num("March 2026") == 3
    assert AgenticBrainService._parse_month_num("2026-03") == 3
    assert AgenticBrainService._parse_month_num("02") == 2
    assert AgenticBrainService._parse_month_num("Sept") == 9

    captured_bill_requests = []
    captured_sheet_calls = []

    with Session(get_engine()) as db:
        org = db.get(ClientOrganization, cid)
        # Client-level rule is 'today' with fixed_day=15; overriding agent must NOT inherit either
        org.custom_config = {
            "invoicing_date_settings": {"invoice_date_rule": "today", "fixed_day": 15}
        }
        org.source_config = None
        ap_agent = next(a for a in (org.agents or []) if a["id"] == "agent_ap_bills")

        override_default_agent = {**ap_agent, "source_config": {"override_date_rules": True}}
        assert AgenticBrainService._resolve_draft_doc_date(
            org, override_default_agent, "October", 2026
        ) == "2026-10-31"
        assert AgenticBrainService._resolve_draft_doc_date(
            org, override_default_agent, "February", 2024
        ) == "2024-02-29"

        override_zero_day_agent = {
            **ap_agent,
            "source_config": {
                "override_date_rules": True,
                "invoice_date_rule": "fixed_day",
                "fixed_invoice_day": 0,
            },
        }
        assert AgenticBrainService._resolve_draft_doc_date(
            org, override_zero_day_agent, "March 2026", 2026
        ) == "2026-03-01"

        override_dec_agent = {
            **ap_agent,
            "source_config": {
                "override_date_rules": True,
                "invoice_date_rule": "first_day_next_month",
            },
        }
        assert AgenticBrainService._resolve_draft_doc_date(
            org, override_dec_agent, "December", 2026
        ) == "2027-01-01"

        db.add(
            StagedTransaction(
                client_id=cid,
                batch_id="October 2026",
                pipeline_id="agent_ap_bills",
                pipeline_type="AP",
                entity_type="ap_vendor_bill",
                transaction_date="2026-10-14",
                source_type="email",
                source_file_name="october_2026_gridco_bill.pdf",
                item_or_description="Industrial Tariff",
                quantity_or_debit=1.0,
                rate_or_price=420.0,
                total_amount=420.0,
                status="APPROVED",
                confidence_score=0.98,
                metadata_json={"vendor_name": "GridCo Power"},
            )
        )
        db.commit()

        monkeypatch.setattr(settings, "MOCK_MODE", False)
        monkeypatch.setattr(ZohoBooksService, "can_transact", lambda self: True)

        async def _fake_vendor(self, name):
            return SimpleNamespace(contact_id="vend_gridco_01", contact_name=name)

        async def _fake_create_bill(self, bill_req):
            captured_bill_requests.append(bill_req)
            return SimpleNamespace(bill_number="BILL-ZOHO-2026-10-001")

        monkeypatch.setattr(ZohoBooksService, "find_or_create_vendor_contact", _fake_vendor)
        monkeypatch.setattr(ZohoBooksService, "create_draft_bill", _fake_create_bill)

        ap_res = asyncio.run(
            AgenticBrainService._tool_generate_draft_invoices_or_bills(
                db,
                org,
                override_default_agent,
                {"month": "October", "year": 2026},
            )
        )
        assert ap_res["status"] == "success"
        assert ap_res["doc_date"] == "2026-10-31"
        assert len(captured_bill_requests) == 1
        assert captured_bill_requests[0].date == "2026-10-31"

        # Verify Sheets fallback guards None source_config and forwards resolved doc_date when sheet_id is set
        ar_agent = next(a for a in (org.agents or []) if a["id"] == "agent_ar_slips")
        ar_no_rows = asyncio.run(
            AgenticBrainService._tool_generate_draft_invoices_or_bills(
                db,
                org,
                {**ar_agent, "source_config": {"override_date_rules": True}},
                {"month": "November", "year": 2026},
            )
        )
        assert ar_no_rows["status"] == "success"
        assert ar_no_rows["invoices_drafted"] == 0
        assert ar_no_rows["doc_date"] == "2026-11-30"

        org.source_config = {"sheet_id": "sheet_custom_123"}
        import app.workflows.zoho_invoice_generator as zoho_inv_mod

        async def _fake_sheet_runner(**kwargs):
            captured_sheet_calls.append(kwargs)
            return {"drafts_created": 2}

        monkeypatch.setattr(zoho_inv_mod, "run_zoho_invoices_core", _fake_sheet_runner)
        ar_sheet_res = asyncio.run(
            AgenticBrainService._tool_generate_draft_invoices_or_bills(
                db,
                org,
                {
                    **ar_agent,
                    "source_config": {
                        "override_date_rules": True,
                        "invoice_date_rule": "first_day_next_month",
                    },
                },
                {"month": "November", "year": 2026},
            )
        )
        assert ar_sheet_res["status"] == "success"
        assert ar_sheet_res["invoices_drafted"] == 2
        assert len(captured_sheet_calls) == 1
        assert captured_sheet_calls[0]["invoice_date"] == "2026-12-01"


def test_live_gemini_attachment_turn1_ingest_only_and_tool_input_in_observations(agentic_client_org: str, monkeypatch):
    """In live Gemini mode with attachments and compound goal, Turn 1 only runs ingest_message_attachments; Turn 2 prompt sees prior tool_input."""
    import asyncio
    import json
    from types import SimpleNamespace
    import google.genai as real_genai
    from app.config import settings

    cid = agentic_client_org
    captured_prompts = []

    class _FakeModels:
        def generate_content(self, model=None, contents=None, config=None):
            captured_prompts.append(str(contents or ""))
            return SimpleNamespace(
                text=json.dumps({
                    "done": True,
                    "final_thought": "Turn 2 verified staged bank rows from Turn 1 observation and queried summary.",
                    "steps": [
                        {
                            "thought": "Query ledger analytics to verify Turn 1 bank ingestion.",
                            "tool_name": "query_ledger_analytics",
                            "tool_input": {"month": "March", "year": 2026},
                        }
                    ],
                })
            )

    class _FakeGenaiClient:
        def __init__(self, api_key=None):
            self.models = _FakeModels()

    monkeypatch.setattr(settings, "MOCK_MODE", False)
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr(real_genai, "Client", _FakeGenaiClient)

    csv_bytes = b"Date,Narration,Debit,Credit,Balance\n2026-03-10,Kempinski Transfer,,1500.00,1500.00\n"
    att_payload = [
        {
            "filename": "march_bank.csv",
            "content_type": "text/csv",
            "content_base64": base64.b64encode(csv_bytes).decode("ascii"),
        }
    ]

    with Session(get_engine()) as db:
        org = db.get(ClientOrganization, cid)
        bank_agent = next(a for a in (org.agents or []) if a["id"] == "agent_bank_recon")
        run = asyncio.run(
            AgenticBrainService.plan_and_execute_goal(
                db=db,
                client=org,
                agent=bank_agent,
                goal="Process attached statement, auto-approve items, and generate draft summary",
                trigger_type="EMAIL_INBOUND",
                trigger_source="cfo@client.com",
                attachments=att_payload,
                explicit_human_command=True,
                month="March",
                year=2026,
            )
        )

    turns = [s.get("react_turn") for s in (run.get("reasoning_steps") or [])]
    tools = [s.get("tool_name") for s in (run.get("reasoning_steps") or [])]
    assert tools == ["ingest_message_attachments", "query_ledger_analytics"]
    assert turns == [1, 2]
    # Gemini must only be consulted from Turn 2 onward once Turn 1 attachment ingestion completed
    assert len(captured_prompts) == 1
    assert '"tool_name": "ingest_message_attachments"' in captured_prompts[0]
    assert '"tool_input":' in captured_prompts[0]
    assert '"attachments": ["march_bank.csv"]' in captured_prompts[0]


def test_scan_and_ingest_storage_triggers_deterministic_turn2_followup(agentic_client_org: str, monkeypatch):
    """When scan_and_ingest_storage extracts items on Turn 1, Turn 2 deterministically runs knowledge, approval, and analytics follow-up."""
    import asyncio
    import app.strategies.dynamic_blueprint as dyn_bp_mod

    cid = agentic_client_org

    with Session(get_engine()) as db:
        org = db.get(ClientOrganization, cid)
        ar_agent = next(a for a in (org.agents or []) if a["id"] == "agent_ar_slips")
        ar_agent["autonomy_level"] = "full_autonomous"
        db.add(
            ClientKnowledgeEntry(
                client_id=cid,
                section="AR",
                category="account_mapping",
                title="Map Kempinski Slips",
                trigger_pattern="kempinski",
                target_value="Sales Revenue - Hospitality",
                rule_content="Map Kempinski deposits to Hospitality Revenue",
                is_active=True,
            )
        )
        db.commit()

        class _FakeDynamicStrategy:
            skipped_documents = []

            def __init__(self, client_obj):
                self.client_obj = client_obj

            async def discover_sources(self, month=None, year=None, pipeline_id=None):
                return [{"name": "october_kempinski_slip.pdf"}]

            async def extract_and_validate(self, sources=None, force_reprocess=False, month=None, year=None, pipeline_id=None):
                return {"extracted": [{"customer": "Kempinski Hotel", "amount": 2400.0}], "skipped": []}

            async def sync_review_workspace(self, month=None, year=None, items=None, auto_post=False, pipeline_id=None):
                with Session(get_engine()) as inner_db:
                    inner_db.add(
                        StagedTransaction(
                            client_id=cid,
                            batch_id="October 2026",
                            pipeline_id="agent_ar_slips",
                            pipeline_type="AR",
                            entity_type="ar_sales_invoice",
                            transaction_date="2026-10-12",
                            source_type="google_drive",
                            source_file_name="october_kempinski_slip.pdf",
                            item_or_description="Banquet Catering",
                            quantity_or_debit=1.0,
                            rate_or_price=2400.0,
                            total_amount=2400.0,
                            status="PENDING",
                            confidence_score=0.96,
                            metadata_json={"customer_name": "Kempinski Hotel"},
                        )
                    )
                    inner_db.commit()

        monkeypatch.setattr(dyn_bp_mod, "DynamicBlueprintStrategy", _FakeDynamicStrategy)

        run = asyncio.run(
            AgenticBrainService.plan_and_execute_goal(
                db=db,
                client=org,
                agent=ar_agent,
                goal="Scan storage for October 2026 slips",
                trigger_type="MANUAL_UI",
                explicit_human_command=True,
                month="October",
                year=2026,
            )
        )

    assert run.get("status") == "COMPLETED"
    steps = run.get("reasoning_steps") or []
    turn1_tools = [s["tool_name"] for s in steps if s.get("react_turn") == 1]
    turn2_tools = [s["tool_name"] for s in steps if s.get("react_turn") == 2]
    assert turn1_tools == ["scan_and_ingest_storage"]
    assert "apply_learned_knowledge_retroactively" in turn2_tools
    assert "auto_approve_verified_transactions" in turn2_tools
    assert "query_ledger_analytics" in turn2_tools
    assert int(run.get("items_auto_approved", 0)) >= 1


def test_bank_upload_reentrancy_guard_and_non_fatal_reactive_error(client: TestClient, agentic_client_org: str, monkeypatch):
    """POST /api/v1/bank/upload skips reactive chaining under _in_bank_scan_cv re-entrancy and stays non-fatal if on_reactive_event raises."""
    import app.api.v1.bank_portal as bank_portal_mod

    cid = agentic_client_org
    calls = []

    async def _fake_bank_core(**kwargs):
        return {"status": "success", "client_id": cid, "total_extracted": 2, "newly_staged": 2}

    async def _raising_reactive(**kwargs):
        calls.append(kwargs)
        raise RuntimeError("Simulated reactive failure")

    monkeypatch.setattr(bank_portal_mod, "run_bank_pipeline_core", _fake_bank_core)
    monkeypatch.setattr(AgenticBrainService, "on_reactive_event", classmethod(lambda cls, **kw: _raising_reactive(**kw)))

    # 1. Re-entrancy suppression check: reactive hook must NOT fire inside active bank scan context
    token = AgenticBrainService._in_bank_scan_cv.set(True)
    try:
        r1 = client.post(
            "/api/v1/bank/upload",
            data={"client_id": cid, "month": "March", "year": "2026"},
            files={"file": ("statement.csv", b"Date,Narration,Debit,Credit\n", "text/csv")},
        )
    finally:
        AgenticBrainService._in_bank_scan_cv.reset(token)

    assert r1.status_code == 200, r1.text
    assert r1.json()["newly_staged"] == 2
    assert r1.json()["reactive_run"] is None
    assert len(calls) == 0

    # 2. Outside contextvar: reactive error must be caught cleanly without failing upload HTTP response
    r2 = client.post(
        "/api/v1/bank/upload",
        data={"client_id": cid, "month": "March", "year": "2026"},
        files={"file": ("statement.csv", b"Date,Narration,Debit,Credit\n", "text/csv")},
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["newly_staged"] == 2
    assert r2.json()["reactive_run"] is None
    assert len(calls) == 1


def test_update_agent_run_metadata_deep_copies_summary_across_pipelines_and_agents(agentic_client_org: str):
    """_update_agent_run_metadata deep-copies last_run_summary so client.pipelines and client.agents never share dict identity."""
    cid = agentic_client_org
    summary = {"status": "COMPLETED", "nested": {"count": 4}}

    with Session(get_engine()) as db:
        org = db.get(ClientOrganization, cid)
        AgenticBrainService._update_agent_run_metadata(
            db=db,
            client=org,
            agent_id="agent_ar_slips",
            trigger_type="MANUAL_UI",
            summary_data=summary,
        )
        db.commit()

    with Session(get_engine()) as db:
        org = db.get(ClientOrganization, cid)
        pipe = next(p for p in (org.pipelines or []) if p["id"] == "agent_ar_slips")
        agent = next(a for a in (org.agents or []) if a["id"] == "agent_ar_slips")
        assert pipe["last_run_summary"] == summary
        assert agent["last_run_summary"] == summary
        assert pipe["last_run_summary"] is not agent["last_run_summary"]
        assert pipe["last_run_summary"]["nested"] is not agent["last_run_summary"]["nested"]

