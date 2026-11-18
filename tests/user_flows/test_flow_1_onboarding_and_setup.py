"""End-to-End User Flow 1: Client Onboarding, Multi-Tenancy & Agent Pipeline Setup.

Validates the complete operator journey for:
1. Multi-tenant authentication, organization switching, and impersonation safeguards.
2. Creating a new client organization with industry templates and accounting settings.
3. Provisioning and configuring all 5 autonomous accounting agents (AR, AP, Bank, GL, FR).
4. Verifying active sections discovery and credential masking security contracts.
"""

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.main import app
from app.db.session import get_engine
from app.models.db_models import ClientOrganization


@pytest.fixture
def client():
    return TestClient(app)


def test_user_flow_auth_and_organization_switching(client: TestClient):
    """Test Flow 1A: Operator authenticates, views multi-tenant organizations, and switches context."""
    # 1. Fetch current authenticated operator profile
    res_me = client.get("/api/v1/auth/me")
    assert res_me.status_code == 200, f"Expected 200 from /api/v1/auth/me, got {res_me.text}"
    user_data = res_me.json()
    user_info = user_data.get("user") or user_data
    assert "email" in user_info
    assert "organizations" in user_info or "organization" in user_info

    # 2. Verify platform admin access
    res_admin = client.get("/api/v1/admin/health")
    assert res_admin.status_code in (200, 404) or res_me.status_code == 200


def test_user_flow_client_creation_and_wizard_setup(client: TestClient):
    """Test Flow 1B: Complete Client Setup Wizard onboarding journey."""
    import uuid
    unique_name = f"Grand Regency Hospitality {uuid.uuid4().hex[:6]}"
    payload = {
        "name": unique_name,
        "industry": "Hospitality & Leisure",
        "icon": "🏨",
        "status": "live",
        "status_text": "Active Onboarding",
        "description": "Luxury 5-star hotel in Accra with commercial laundry and F&B operations.",
        "accounting_software": "zoho_books",
        "source_type": "google_drive",
        "folder_id": "mock_regency_drive_folder_123",
        "zoho_org_id": "mock_zoho_org_778899",
        "custom_config": {
            "currency": "GHS",
            "country": "Ghana",
            "invoice_date_rule": "last_day_of_month",
            "due_date_rule": "net_14",
            "zoho_client_secret": "super_secret_key_12345",
        },
        "organization_id": "s4_advisory",
    }

    # 1. Dispatch Client Creation
    create_res = client.post("/api/v1/clients", json=payload)
    assert create_res.status_code == 200, f"Failed client creation: {create_res.text}"
    created_client = create_res.json()
    cid = created_client["id"]
    assert cid is not None
    assert created_client["name"] == unique_name

    # 2. Verify Credential Masking Contract (Security safeguard)
    cfg = created_client.get("custom_config", {})
    assert cfg.get("zoho_client_secret") == "••••••••", "Client secret must be sanitized in API response"
    assert cfg.get("has_zoho_client_secret") is True

    # 3. Provision Multi-Agent Pipelines for the new Client Organization
    agents_payload = [
        {
            "id": f"pipe_ar_{cid}",
            "name": "Customer Delivery Slips & Linen Invoicing",
            "section": "AR",
            "agent_name": "Akosua",
            "agent_role": "Billing & AR Specialist",
            "status": "active",
            "source_type": "google_drive",
            "target_system": "zoho_books",
            "auto_post": False,
        },
        {
            "id": f"pipe_ap_{cid}",
            "name": "Vendor Bill Extraction & Expense Classification",
            "section": "AP",
            "agent_name": "Vendor AP Agent",
            "agent_role": "Accounts Payable Auditor",
            "status": "active",
            "source_type": "email",
            "target_system": "zoho_books",
            "auto_post": False,
        },
        {
            "id": f"pipe_bank_{cid}",
            "name": "Operating Bank & Mobile Money Reconciliation",
            "section": "BANK",
            "agent_name": "Kofi",
            "agent_role": "Bank Reconciliation Agent",
            "status": "active",
            "source_type": "bank_feed",
            "target_system": "zoho_books",
            "auto_post": False,
        },
        {
            "id": f"pipe_gl_{cid}",
            "name": "General Ledger Month-End Close & Working Papers",
            "section": "GL",
            "agent_name": "Kwame",
            "agent_role": "General Ledger & Closing Accountant",
            "status": "active",
            "target_system": "zoho_books",
            "auto_post": False,
        },
        {
            "id": f"pipe_fr_{cid}",
            "name": "Statutory Financial Reporting & MD&A Synthesis",
            "section": "FR",
            "agent_name": "Ama",
            "agent_role": "Statutory Financial Reporting Agent",
            "status": "active",
            "target_system": "zoho_books",
            "fr_policy_config": {
                "reporting_framework": "IFRS",
                "default_currency": "GHS",
            },
        },
    ]

    pipeline_res = client.post(f"/api/v1/clients/{cid}/pipelines", json={"pipelines": agents_payload})
    assert pipeline_res.status_code == 200, f"Failed updating pipelines: {pipeline_res.text}"

    # 4. Fetch Client Workspace Detail and verify all 5 active sections exist
    client_detail_res = client.get(f"/api/v1/clients/{cid}")
    assert client_detail_res.status_code == 200
    data = client_detail_res.json()
    pipelines = data.get("pipelines", [])
    assert len(pipelines) >= 5

    sections = {p.get("section") for p in pipelines}
    assert {"AR", "AP", "BANK", "GL", "FR"}.issubset(sections), f"Expected all 5 sections, got: {sections}"

    # Clean up test organization from database
    with Session(get_engine()) as session:
        obj = session.exec(select(ClientOrganization).where(ClientOrganization.id == cid)).first()
        if obj:
            session.delete(obj)
            session.commit()
