"""Comprehensive Unit and Integration Tests for Zoho, QuickBooks Online & Xero Multi-Tenant OAuth Engine."""

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.main import app
from app.db.session import get_engine
from app.models.db_models import ClientOrganization


@pytest.fixture(autouse=True)
def setup_test_clients():
    """Ensures test clients exist for each platform in DB."""
    with Session(get_engine()) as session:
        for cid, cname, software in [
            ("test_zoho_client", "Test Zoho Client", "zoho_books"),
            ("test_qb_client", "Test QuickBooks Client", "quickbooks_online"),
            ("test_xero_client", "Test Xero Client", "xero"),
        ]:
            client = session.exec(select(ClientOrganization).where(ClientOrganization.id == cid)).first()
            if not client:
                client = ClientOrganization(
                    id=cid,
                    name=cname,
                    industry="Retail",
                    status="dev",
                    status_text="In Development",
                    accounting_software=software,
                )
                session.add(client)
        session.commit()


# ============================================================================
# QUICKBOOKS ONLINE TESTS
# ============================================================================

def test_quickbooks_authorize_url():
    """Verifies generation of Intuit QuickBooks OAuth authorization URL."""
    client = TestClient(app)
    response = client.get("/api/v1/oauth/quickbooks/authorize-url?client_id=test_qb_client")
    assert response.status_code == 200
    data = response.json()
    assert data["platform"] == "quickbooks_online"
    assert "appcenter.intuit.com/connect/oauth2" in data["authorize_url"]
    assert "com.intuit.quickbooks.accounting" in data["authorize_url"]
    assert "state=test_qb_client" in data["authorize_url"]


def test_quickbooks_connect_redirect():
    """Verifies direct 302 redirect trigger to Intuit QuickBooks consent."""
    client = TestClient(app, follow_redirects=False)
    response = client.get("/api/v1/oauth/quickbooks/connect?client_id=test_qb_client")
    assert response.status_code == 302
    assert "appcenter.intuit.com" in response.headers["location"]


def test_quickbooks_callback_success_mock():
    """Verifies QuickBooks callback handling, realmId binding, and DB persistence."""
    client = TestClient(app)
    response = client.get(
        "/api/v1/oauth/quickbooks/callback?code=mock_code_qb&state=test_qb_client&realmId=9341452891048201"
    )
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "QuickBooks Online Connected" in response.text
    assert "QUICKBOOKS_OAUTH_SUCCESS" in response.text
    assert "9341452891048201" in response.text

    # Verify DB record
    with Session(get_engine()) as session:
        client_obj = session.exec(select(ClientOrganization).where(ClientOrganization.id == "test_qb_client")).first()
        assert client_obj is not None
        assert client_obj.custom_config.get("quickbooks_realm_id") == "9341452891048201"
        assert client_obj.custom_config.get("quickbooks_refresh_token") is not None
        assert "QuickBooks Online" in client_obj.active_integrations


def test_quickbooks_status_and_disconnect():
    """Verifies QuickBooks status query and disconnect flow."""
    client = TestClient(app)
    # Check status
    status_res = client.get("/api/v1/oauth/quickbooks/status?client_id=test_qb_client")
    assert status_res.status_code == 200
    assert status_res.json()["is_connected"] is True
    assert status_res.json()["org_id"] == "9341452891048201"

    # Disconnect
    disc_res = client.post("/api/v1/oauth/quickbooks/disconnect?client_id=test_qb_client")
    assert disc_res.status_code == 200
    assert disc_res.json()["success"] is True

    # Re-check status
    status_after = client.get("/api/v1/oauth/quickbooks/status?client_id=test_qb_client")
    assert status_after.json()["is_connected"] is False


# ============================================================================
# XERO TESTS
# ============================================================================

def test_xero_authorize_url():
    """Verifies generation of Xero OAuth authorization URL."""
    client = TestClient(app)
    response = client.get("/api/v1/oauth/xero/authorize-url?client_id=test_xero_client")
    assert response.status_code == 200
    data = response.json()
    assert data["platform"] == "xero"
    assert "login.xero.com/identity/connect/authorize" in data["authorize_url"]
    assert "accounting.transactions" in data["authorize_url"]
    assert "state=test_xero_client" in data["authorize_url"]


def test_xero_connect_redirect():
    """Verifies direct 302 redirect trigger to Xero consent."""
    client = TestClient(app, follow_redirects=False)
    response = client.get("/api/v1/oauth/xero/connect?client_id=test_xero_client")
    assert response.status_code == 302
    assert "login.xero.com" in response.headers["location"]


def test_xero_callback_success_mock():
    """Verifies Xero callback handling, tenant discovery, and DB persistence."""
    client = TestClient(app)
    response = client.get("/api/v1/oauth/xero/callback?code=mock_code_xero&state=test_xero_client")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "Xero Connected" in response.text
    assert "XERO_OAUTH_SUCCESS" in response.text

    # Verify DB record
    with Session(get_engine()) as session:
        client_obj = session.exec(select(ClientOrganization).where(ClientOrganization.id == "test_xero_client")).first()
        assert client_obj is not None
        assert client_obj.custom_config.get("xero_tenant_id") is not None
        assert client_obj.custom_config.get("xero_refresh_token") is not None
        assert "Xero" in client_obj.active_integrations


def test_xero_status_and_disconnect():
    """Verifies Xero status query and disconnect flow."""
    client = TestClient(app)
    # Check status
    status_res = client.get("/api/v1/oauth/xero/status?client_id=test_xero_client")
    assert status_res.status_code == 200
    assert status_res.json()["is_connected"] is True

    # Disconnect
    disc_res = client.post("/api/v1/oauth/xero/disconnect?client_id=test_xero_client")
    assert disc_res.status_code == 200
    assert disc_res.json()["success"] is True

    # Re-check status
    status_after = client.get("/api/v1/oauth/xero/status?client_id=test_xero_client")
    assert status_after.json()["is_connected"] is False
