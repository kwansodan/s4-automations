"""Tests for Platform Super-Admin RBAC hardening, multi-tenant isolation, and /api/v1/admin operations."""

import uuid
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.config import settings
from app.db.session import get_engine
from app.main import app
from app.models.db_models import (
    AgentExecutionRun,
    AgentMessage,
    AuditLog,
    ClientOrganization,
    FirmTeamMember,
    Organization,
    PlatformAdminUser,
    UserOrganizationMembership,
)
from app.services.auth_service import AuthService


def _super_admin_headers() -> dict:
    token = AuthService._create_token(settings.AUTH_EMAIL, role="admin")
    return {"Authorization": f"Bearer {token}"}


def _staff_headers(email: str, org_id: str = "s4_advisory") -> dict:
    with Session(get_engine()) as db:
        existing = db.exec(select(FirmTeamMember).where(FirmTeamMember.email == email)).first()
        if not existing:
            db.add(
                FirmTeamMember(
                    organization_id=org_id,
                    name="Test Staff Accountant",
                    email=email,
                    role="SENIOR_ACCOUNTANT",
                    status="ACTIVE",
                    assigned_client_ids=[],
                )
            )
            db.commit()
    token = AuthService._create_token(email, role="SENIOR_ACCOUNTANT")
    return {"Authorization": f"Bearer {token}"}


def test_rbac_blocks_anonymous_and_staff_from_platform_admin():
    """Real un-overridden RBAC checks must reject anonymous (401) and non-super-admin (403) callers."""
    client = TestClient(app)
    saved_overrides = dict(app.dependency_overrides)
    app.dependency_overrides.clear()
    try:
        # Anonymous requests return 401
        r_anon = client.get("/api/v1/admin/overview")
        assert r_anon.status_code == 401

        r_cfg_anon = client.get("/api/v1/config")
        assert r_cfg_anon.status_code == 401

        # Authenticated non-super-admin staff receives 403 on platform endpoints
        staff_email = f"staff_{uuid.uuid4().hex[:6]}@firmtest.gh"
        headers = _staff_headers(staff_email)

        assert client.get("/api/v1/admin/overview", headers=headers).status_code == 403
        assert client.get("/api/v1/billing/overview", headers=headers).status_code == 403
        assert client.get("/api/v1/config", headers=headers).status_code == 403
        assert client.post("/api/v1/system/migrate", headers=headers).status_code == 403
        assert client.get("/api/v1/marketing/leads", headers=headers).status_code == 403
        assert client.get("/api/v1/social/history", headers=headers).status_code == 403

        # Public landing-config, lead-capture, and changelog remain accessible anonymously
        assert client.get("/api/v1/marketing/landing-config").status_code == 200
        assert client.get("/api/v1/social/changelog").status_code == 200

        # Platform Super-Admin succeeds with 200
        sa_headers = _super_admin_headers()
        res_sa = client.get("/api/v1/admin/overview", headers=sa_headers)
        assert res_sa.status_code == 200
        data = res_sa.json()
        assert "revenue" in data
        assert "tenants" in data
        assert "agent_fleet" in data
        assert "subsystems" in data
    finally:
        app.dependency_overrides.update(saved_overrides)


def test_switch_org_blocks_cross_tenant_escalation():
    """Non-super-admin must receive 403 when attempting /auth/switch-org to another organization."""
    client = TestClient(app)
    target_org_id = f"victim_firm_{uuid.uuid4().hex[:6]}"
    staff_email = f"intruder_{uuid.uuid4().hex[:6]}@otherfirm.gh"

    with Session(get_engine()) as db:
        db.add(Organization(id=target_org_id, name="Victim Accounting Firm"))
        db.commit()

    headers = _staff_headers(staff_email)
    res = client.post(
        "/api/v1/auth/switch-org",
        json={"organization_id": target_org_id},
        headers=headers,
    )
    assert res.status_code == 403

    with Session(get_engine()) as db:
        escalated = db.exec(
            select(UserOrganizationMembership).where(
                UserOrganizationMembership.user_email == staff_email,
                UserOrganizationMembership.organization_id == target_org_id,
            )
        ).first()
        assert escalated is None


def test_list_clients_empty_org_does_not_leak_other_tenants():
    """Querying GET /api/v1/clients for a new organization with 0 clients must return [] rather than global fallback."""
    client = TestClient(app)
    empty_org_id = f"empty_firm_{uuid.uuid4().hex[:6]}"
    with Session(get_engine()) as db:
        db.add(Organization(id=empty_org_id, name="Empty New Firm"))
        db.commit()

    sa_headers = _super_admin_headers()
    res = client.get(f"/api/v1/clients?organization_id={empty_org_id}", headers=sa_headers)
    assert res.status_code == 200
    assert res.json() == []


def test_tenant_lifecycle_impersonation_and_audit_trail():
    """Super-Admin can create, update white-label/BYOS, suspend/reactivate, and impersonate tenants with immutable audit logs."""
    client = TestClient(app)
    sa_headers = _super_admin_headers()
    slug = f"kempinski_partners_{uuid.uuid4().hex[:6]}"

    # 1. Create organization
    create_res = client.post(
        "/api/v1/admin/organizations",
        json={
            "id": slug,
            "name": "Kempinski Audit & Advisory",
            "org_type": "ACCOUNTING_FIRM",
            "plan_tier": "pro",
            "max_clients": 20,
            "subscription_status": "TRIALING",
            "trial_days": 14,
            "custom_portal_subdomain": slug,
            "storage_strategy": "byos_google",
            "byos_folder_id": "drive_folder_xyz",
            "primary_admin_email": f"partner_{slug}@kempinski.gh",
        },
        headers=sa_headers,
    )
    assert create_res.status_code == 200, create_res.text
    created = create_res.json()["organization"]
    assert created["id"] == slug
    assert created["storage_strategy"] == "byos_google"
    assert created["storage_credentials"]["google_drive_root_folder_id"] == "drive_folder_xyz"

    # 2. Fetch dossier
    detail_res = client.get(f"/api/v1/admin/organizations/{slug}", headers=sa_headers)
    assert detail_res.status_code == 200
    assert detail_res.json()["organization"]["name"] == "Kempinski Audit & Advisory"

    # 3. Update white-label settings
    patch_res = client.patch(
        f"/api/v1/admin/organizations/{slug}/settings",
        json={"max_clients": 35, "white_label_logo_url": "https://cdn.example.com/logo.png"},
        headers=sa_headers,
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["organization"]["max_clients"] == 35

    # 4. Suspend and reactivate
    suspend_res = client.patch(
        f"/api/v1/admin/organizations/{slug}/status",
        json={"is_active": False, "subscription_status": "SUSPENDED", "reason": "Invoice overdue 45 days"},
        headers=sa_headers,
    )
    assert suspend_res.status_code == 200
    assert suspend_res.json()["organization"]["is_active"] is False
    assert suspend_res.json()["organization"]["subscription_status"] == "SUSPENDED"

    # Cannot suspend s4_advisory root org
    root_suspend = client.patch(
        "/api/v1/admin/organizations/s4_advisory/status",
        json={"is_active": False, "subscription_status": "SUSPENDED", "reason": "Test block"},
        headers=sa_headers,
    )
    assert root_suspend.status_code == 400

    # 5. Impersonation audit logging
    imp_res = client.post(
        "/api/v1/admin/impersonate",
        json={"organization_id": slug, "reason": "Verify Drive sync setup"},
        headers=sa_headers,
    )
    assert imp_res.status_code == 200
    assert imp_res.json()["impersonating_org"]["id"] == slug

    exit_res = client.post(
        "/api/v1/admin/impersonate/exit",
        json={"organization_id": slug},
        headers=sa_headers,
    )
    assert exit_res.status_code == 200

    # 6. Verify immutable audit trail entries via /api/v1/admin/audit-logs
    audit_res = client.get(f"/api/v1/admin/audit-logs?client_id={slug}", headers=sa_headers)
    assert audit_res.status_code == 200
    actions = [a["action"] for a in audit_res.json()["logs"]]
    assert "ADMIN_ORG_CREATED" in actions
    assert "ADMIN_ORG_SUSPEND" in actions
    assert "ADMIN_IMPERSONATE_START" in actions
    assert "ADMIN_IMPERSONATE_END" in actions


def test_super_admin_allowlist_and_fleet_telemetry():
    """Verify Super-Admin allowlist CRUD with root protection and cross-tenant Agent Fleet telemetry."""
    client = TestClient(app)
    sa_headers = _super_admin_headers()
    new_sa_email = f"ops_{uuid.uuid4().hex[:6]}@service4gh.com"

    # 1. Add Super-Admin
    add_res = client.post(
        "/api/v1/admin/super-admins",
        json={"email": new_sa_email, "name": "Ops Engineer"},
        headers=sa_headers,
    )
    assert add_res.status_code == 200
    new_sa_id = add_res.json()["super_admin"]["id"]

    # Confirm granted user holds platform admin claim
    assert AuthService.is_platform_admin(new_sa_email) is True

    # 2. List Super-Admins includes both root and new entry
    list_res = client.get("/api/v1/admin/super-admins", headers=sa_headers)
    assert list_res.status_code == 200
    emails = [a["email"] for a in list_res.json()["super_admins"]]
    assert settings.AUTH_EMAIL.strip().lower() in emails
    assert new_sa_email in emails

    # 3. Root admin cannot be deleted
    root_row = next((a for a in list_res.json()["super_admins"] if a.get("is_root") and a.get("id")), None)
    if root_row:
        del_root = client.delete(f"/api/v1/admin/super-admins/{root_row['id']}", headers=sa_headers)
        assert del_root.status_code == 400

    # Revoke temporary ops super-admin cleanly
    del_res = client.delete(f"/api/v1/admin/super-admins/{new_sa_id}", headers=sa_headers)
    assert del_res.status_code == 200

    # 4. Global agent fleet & telemetry endpoints respond cleanly
    assert client.get("/api/v1/admin/agent-fleet", headers=sa_headers).status_code == 200
    assert client.get("/api/v1/admin/agent-runs", headers=sa_headers).status_code == 200
    assert client.get("/api/v1/admin/agent-messages", headers=sa_headers).status_code == 200
    assert client.get("/api/v1/admin/gateway-health", headers=sa_headers).status_code == 200
    assert client.get("/api/v1/admin/telemetry/tenants", headers=sa_headers).status_code == 200
    assert client.get("/api/v1/admin/users", headers=sa_headers).status_code == 200
