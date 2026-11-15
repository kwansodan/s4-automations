"""Deep audit E2E regression tests: SPA routing fallback, tenant isolation, and system error RBAC."""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.config import settings
from app.db.session import get_engine
from app.main import app
from app.models.db_models import BankTransaction, ClientOrganization, FirmTeamMember
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
                    name="Deep Audit Staff",
                    email=email,
                    role="PARTNER",
                    status="ACTIVE",
                    assigned_client_ids=[],
                )
            )
            db.commit()
    token = AuthService._create_token(email, role="PARTNER")
    return {"Authorization": f"Bearer {token}"}


def _create_foreign_client_with_bank_tx() -> tuple:
    """Creates a client owned by another organization plus one queried bank transaction."""
    cid = f"foreign_{uuid.uuid4().hex[:8]}"
    with Session(get_engine()) as db:
        db.add(
            ClientOrganization(
                id=cid,
                organization_id=f"other_org_{uuid.uuid4().hex[:6]}",
                name="Foreign Tenant Client",
                industry="Logistics",
                status="live",
                accounting_software="zoho_books",
            )
        )
        db.commit()
        tx = BankTransaction(
            client_id=cid,
            transaction_date="2026-10-05",
            description="Foreign tenant transfer",
            amount=125.0,
            transaction_type="DEBIT",
            status="CLARIFICATION_REQUESTED",
            accountant_query="What is this payment for?",
        )
        db.add(tx)
        db.commit()
        db.refresh(tx)
        return cid, tx.id


def test_spa_history_fallback_and_non_spa_404():
    client = TestClient(app)
    for path in ("/admin/overview", "/requests", "/clients"):
        res = client.get(path)
        assert res.status_code == 200, path
        assert "text/html" in res.headers.get("content-type", "")
    assert client.get("/api/v1/definitely-not-a-route").status_code == 404
    assert client.get("/assets/missing-chunk-xyz.js").status_code == 404


def test_system_errors_rbac_staff_forbidden_super_admin_allowed():
    client = TestClient(app)
    saved = dict(app.dependency_overrides)
    app.dependency_overrides.clear()
    try:
        staff = _staff_headers(f"audit_{uuid.uuid4().hex[:6]}@firmtest.gh")
        assert client.get("/api/v1/system/errors", headers=staff).status_code == 403
        assert client.get("/api/v1/system/errors", headers=_super_admin_headers()).status_code == 200
    finally:
        app.dependency_overrides.update(saved)


def test_cross_tenant_access_is_blocked_for_staff():
    client = TestClient(app)
    foreign_cid, foreign_tx_id = _create_foreign_client_with_bank_tx()
    saved = dict(app.dependency_overrides)
    app.dependency_overrides.clear()
    try:
        staff = _staff_headers(f"audit_{uuid.uuid4().hex[:6]}@firmtest.gh")

        # Direct cross-tenant reads are rejected
        assert client.get(f"/api/v1/audit?client_id={foreign_cid}", headers=staff).status_code == 403
        assert client.get(f"/api/v1/agents/{foreign_cid}/ALL/messages", headers=staff).status_code == 403
        assert client.get(f"/api/v1/agents/{foreign_cid}/ALL/runs", headers=staff).status_code == 403
        assert client.get(f"/api/v1/bank/requests?client_id={foreign_cid}", headers=staff).status_code == 403

        # Cross-tenant mutations on foreign bank transactions are rejected
        r_toggle = client.post(f"/api/v1/bank/transactions/{foreign_tx_id}/toggle-direction", headers=staff)
        assert r_toggle.status_code == 403
        r_resolve = client.post(
            "/api/v1/bank/requests/resolve",
            headers=staff,
            json={"item_keys": [f"BANK:{foreign_tx_id}"]},
        )
        assert r_resolve.status_code == 403

        # Firm-wide ALL view never leaks foreign tenant requests
        r_all = client.get("/api/v1/bank/requests?client_id=ALL", headers=staff)
        assert r_all.status_code == 200
        leaked = [i for i in r_all.json().get("items", []) if i.get("client_id") == foreign_cid]
        assert leaked == []

        # Platform Super-Admin can still see the foreign tenant request
        r_sa = client.get(f"/api/v1/bank/requests?client_id={foreign_cid}", headers=_super_admin_headers())
        assert r_sa.status_code == 200
        assert any(i.get("client_id") == foreign_cid for i in r_sa.json().get("items", []))
    finally:
        app.dependency_overrides.update(saved)


def test_organizations_columns_migrated():
    from sqlalchemy import inspect

    from app.db.session import run_schema_migrations

    run_schema_migrations(get_engine())
    cols = {c["name"] for c in inspect(get_engine()).get_columns("organizations")}
    for expected in ("white_label_logo_url", "custom_portal_subdomain", "storage_strategy", "storage_credentials"):
        assert expected in cols
