"""Automated tests for Autonomous Accounting Agents, Multi-Channel Email/WhatsApp Communications,
SaaS Multi-Tenant WhatsApp Routing, and Client Knowledge Base Studio."""

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.main import app
from app.db.session import get_engine
from app.models.db_models import (
    ClientOrganization,
    ClientKnowledgeEntry,
    AgentMessage,
    BankTransaction,
)
from app.services.client_knowledge_service import ClientKnowledgeService
from app.services.agent_comms_service import AgentCommsService


@pytest.fixture
def client():
    with TestClient(app) as tc:
        yield tc


@pytest.fixture
def sample_agent_client():
    """Creates or resets a test client organization with AR, AP, and BANK agents."""
    with Session(get_engine()) as db:
        cid = "test_agent_saas_co"
        for msg in db.exec(select(AgentMessage).where(AgentMessage.client_id == cid)).all():
            db.delete(msg)
        for ke in db.exec(select(ClientKnowledgeEntry).where(ClientKnowledgeEntry.client_id == cid)).all():
            db.delete(ke)
        for bt in db.exec(select(BankTransaction).where(BankTransaction.client_id == cid)).all():
            db.delete(bt)
        existing = db.get(ClientOrganization, cid)
        if existing:
            db.delete(existing)
        db.commit()

        raw_agents = [
            {
                "id": "agent_ar_slips",
                "name": "Daily Control Slips Agent",
                "section": "AR",
                "entity_type": "ar_sales_invoice",
                "source_type": "google_drive",
                "is_active": True,
                "active": True,
            },
            {
                "id": "agent_bank_recon",
                "name": "Treasury & Bank Recon Agent",
                "section": "BANK",
                "entity_type": "bank_feed",
                "source_type": "bank_feed",
                "is_active": True,
                "active": True,
            },
        ]
        org = ClientOrganization(
            id=cid,
            organization_id="s4_advisory",
            name="Test Agent SaaS Co",
            industry="Hospitality & Commercial Services",
            status="live",
            accounting_software="zoho_books",
            pipelines=raw_agents,
            agents=raw_agents,
            source_config={},
            custom_config={"currency": "GHS"},
        )
        AgentCommsService.sync_client_agents_list(org)
        db.add(org)
        db.commit()
        return cid


def test_client_agents_crud_and_pipeline_parity(client, sample_agent_client):
    cid = sample_agent_client

    # 1. GET /api/v1/clients/{cid}/agents returns enriched agents with dedicated agent_email
    res = client.get(f"/api/v1/clients/{cid}/agents")
    assert res.status_code == 200
    agents = res.json()
    assert len(agents) == 2
    assert "@" in agents[0]["agent_email"]
    assert agents[0]["whatsapp_routing_tag"].startswith("@")

    # 2. POST /api/v1/clients/{cid}/agents adds a new AP agent and syncs with /pipelines
    new_agent = {
        "id": "agent_ap_bills",
        "name": "Supplier Bills Agent",
        "section": "AP",
        "entity_type": "ap_vendor_bill",
        "source_type": "email",
        "is_active": True,
    }
    post_res = client.post(f"/api/v1/clients/{cid}/agents", json=new_agent)
    assert post_res.status_code == 200
    updated_agents = post_res.json()
    assert len(updated_agents) == 3
    ap_agent = next(a for a in updated_agents if a["id"] == "agent_ap_bills")
    assert "@" in ap_agent["agent_email"]
    assert "ap" in ap_agent["agent_email"] or "bills" in ap_agent["agent_email"]

    # Verify /pipelines returns the exact same synchronized list
    pipe_res = client.get(f"/api/v1/clients/{cid}/pipelines")
    assert pipe_res.status_code == 200
    assert len(pipe_res.json()) == 3

    # 3. DELETE /api/v1/clients/{cid}/agents/{agent_id}
    del_res = client.delete(f"/api/v1/clients/{cid}/agents/agent_ap_bills")
    assert del_res.status_code == 200
    assert len(del_res.json()) == 2


def test_dedicated_agent_email_webhook_and_conversational_teaching(client, sample_agent_client):
    cid = sample_agent_client
    agents = client.get(f"/api/v1/clients/{cid}/agents").json()
    ar_agent = next(a for a in agents if a["section"] == "AR")
    dedicated_email = ar_agent["agent_email"]

    # Send an inbound email to the agent's dedicated email address that teaches a customer alias and pricing rule
    email_payload = {
        "to": dedicated_email,
        "from": "cfo@testagentco.com",
        "subject": "New customer alias and pricing rule",
        "text": "Whenever we receive a slip for Kempinski, map it to Kempinski Hotel Gold Coast City. Also price King Duvet at 35 GHS.",
    }
    webhook_res = client.post("/api/v1/agents/webhooks/email", json=email_payload)
    assert webhook_res.status_code == 200
    data = webhook_res.json()
    assert data["success"] is True
    assert data["client_id"] == cid
    assert data["agent_id"] == ar_agent["id"]
    assert data["channel"] == "EMAIL"
    assert len(data["learned_rules"]) >= 2
    assert "Kempinski Hotel Gold Coast City" in data["reply_text"]

    # Verify rules were persisted in ClientKnowledgeEntry
    kb_res = client.get(f"/api/v1/clients/{cid}/knowledge")
    assert kb_res.status_code == 200
    kb_data = kb_res.json()
    assert kb_data["summary"]["active_count"] >= 2
    categories = {e["category"] for e in kb_data["entries"]}
    assert "ENTITY_ALIAS" in categories
    assert "SKU_PRICING_RULE" in categories

    # Verify conversation history was recorded
    msg_res = client.get(f"/api/v1/agents/{cid}/{ar_agent['id']}/messages")
    assert msg_res.status_code == 200
    msg_data = msg_res.json()
    assert msg_data["count"] == 2
    assert msg_data["messages"][0]["direction"] == "INBOUND"
    assert msg_data["messages"][1]["direction"] == "OUTBOUND"


def test_saas_multi_tenant_whatsapp_config_and_webhooks(client, sample_agent_client):
    cid = sample_agent_client

    # 1. Configure tenant's dedicated WhatsApp Business number (Meta Cloud API mode)
    put_res = client.put(
        f"/api/v1/agents/{cid}/whatsapp-config",
        json={
            "whatsapp_mode": "dedicated_meta",
            "whatsapp_phone_number": "+233249998877",
            "whatsapp_phone_number_id": "meta_phone_id_998877",
            "whatsapp_waba_id": "waba_12345",
            "whatsapp_verify_token": "custom_tenant_verify_token",
            "whatsapp_access_token": "EAAG_TEST_TOKEN",
        },
    )
    assert put_res.status_code == 200
    cfg = put_res.json()
    assert cfg["whatsapp_mode"] == "dedicated_meta"
    assert cfg["whatsapp_phone_number"] == "+233249998877"
    assert cfg["whatsapp_phone_number_id"] == "meta_phone_id_998877"
    assert cfg["has_custom_access_token"] is True
    assert f"/api/v1/agents/webhooks/whatsapp/{cid}" in cfg["webhook_url"]

    # 2. Verify Meta GET webhook handshake on the tenant-specific callback URL
    verify_res = client.get(
        f"/api/v1/agents/webhooks/whatsapp/{cid}",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": "custom_tenant_verify_token",
            "hub.challenge": "987654321",
        },
    )
    assert verify_res.status_code == 200
    assert verify_res.text == "987654321"

    # 3. Simulate an inbound Meta WhatsApp Cloud API payload to the global webhook
    # routed automatically by phone_number_id ("meta_phone_id_998877")
    meta_payload = {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "waba_12345",
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "messaging_product": "whatsapp",
                            "metadata": {
                                "display_phone_number": "233249998877",
                                "phone_number_id": "meta_phone_id_998877",
                            },
                            "contacts": [
                                {
                                    "profile": {"name": "Kwame Mensah"},
                                    "wa_id": "233201112233",
                                }
                            ],
                            "messages": [
                                {
                                    "from": "233201112233",
                                    "id": "wamid.test123",
                                    "timestamp": "1700000000",
                                    "type": "text",
                                    "text": {
                                        "body": "Map ECG to 5020 - Electricity & Water Expense"
                                    },
                                }
                            ],
                        },
                    }
                ],
            }
        ],
    }
    wa_res = client.post("/api/v1/agents/webhooks/whatsapp", json=meta_payload)
    assert wa_res.status_code == 200
    wa_data = wa_res.json()
    assert wa_data["status"] == "PROCESSED"
    assert wa_data["processed_count"] == 1
    result_item = wa_data["results"][0]
    assert result_item["client_id"] == cid
    assert len(result_item["learned_rules"]) >= 1
    assert result_item["learned_rules"][0]["category"] == "COA_MAPPING_RULE"


def test_knowledge_studio_and_implicit_learning_from_bank_categorization(client, sample_agent_client):
    cid = sample_agent_client

    # 1. Create a bank transaction and categorize it via the accountant endpoint
    with Session(get_engine()) as db:
        tx = BankTransaction(
            client_id=cid,
            transaction_date="2026-11-10",
            description="MTN MOMO TRF TO TOTAL ENERGIES FUEL STATION",
            amount=850.0,
            transaction_type="DEBIT",
            bank_account_name="Main GHS Account",
            status="UNMAPPED",
        )
        db.add(tx)
        db.commit()
        db.refresh(tx)
        tx_id = tx.id

    cat_res = client.post(
        f"/api/v1/bank/transactions/{tx_id}/categorize",
        json={
            "mapped_account_id": "acc_fuel_5040",
            "mapped_account_name": "5040 - Motor Vehicle Fuel & Lubricants",
            "payee_name": "Total Energies",
            "post_to_accounting": False,
        },
    )
    assert cat_res.status_code == 200

    # 2. Verify that categorizing the transaction automatically built a COA_MAPPING_RULE in ClientKnowledgeEntry
    kb_res = client.get(f"/api/v1/clients/{cid}/knowledge", params={"category": "COA_MAPPING_RULE"})
    assert kb_res.status_code == 200
    entries = kb_res.json()["entries"]
    assert any(
        "5040 - Motor Vehicle Fuel & Lubricants" in (e.get("target_value") or e.get("rule_content") or "")
        for e in entries
    )

    # 3. Verify natural language teaching endpoint (/knowledge/teach)
    teach_res = client.post(
        f"/api/v1/clients/{cid}/knowledge/teach",
        json={
            "instruction_text": "Whenever we receive a slip for Labadi Beach, map it to Labadi Beach Hotel Ltd.",
            "source": "MANUAL_UI",
        },
    )
    assert teach_res.status_code == 200
    assert teach_res.json()["learned_count"] >= 1

    # 4. Verify prompt compilation includes the learned rules
    with Session(get_engine()) as db:
        prompt_block = ClientKnowledgeService.build_agent_knowledge_prompt(db, cid)
        assert "5040 - Motor Vehicle Fuel & Lubricants" in prompt_block
        assert "Labadi Beach Hotel Ltd" in prompt_block


def test_direct_agent_messaging_and_knowledge_lifecycle(client, sample_agent_client):
    cid = sample_agent_client

    # 1. List all agents globally via GET /api/v1/agents
    global_res = client.get("/api/v1/agents", params={"client_id": cid})
    assert global_res.status_code == 200
    global_data = global_res.json()
    assert global_data["total_agents"] == 2

    # 2. Send a direct IN_APP message to the BANK agent
    msg_res = client.post(
        f"/api/v1/agents/{cid}/agent_bank_recon/message",
        json={
            "channel": "IN_APP",
            "message": "Remember to always categorize Vodafone Business under 5030 - Internet & Telecoms.",
            "send_external_reply": False,
        },
    )
    assert msg_res.status_code == 200
    msg_body = msg_res.json()
    assert msg_body["agent_id"] == "agent_bank_recon"
    assert len(msg_body["learned_knowledge"]) >= 1
    learned_entry_id = msg_body["learned_knowledge"][0]["id"]

    # 3. Toggle active status of the knowledge entry
    toggle_res = client.patch(f"/api/v1/clients/{cid}/knowledge/{learned_entry_id}/toggle")
    assert toggle_res.status_code == 200
    assert toggle_res.json()["entry"]["is_active"] is False

    # 4. Delete the knowledge entry
    del_res = client.delete(f"/api/v1/clients/{cid}/knowledge/{learned_entry_id}")
    assert del_res.status_code == 200
    assert del_res.json()["deleted_id"] == learned_entry_id
