"""Unit and Integration Tests for Multi-Tenant 1-Click Zoho OAuth Engine."""

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.main import app
from app.db.session import get_engine
from app.models.db_models import ClientOrganization


@pytest.fixture(autouse=True)
def ensure_test_client():
    """Ensures test client organization exists in DB."""
    with Session(get_engine()) as session:
        client = session.exec(select(ClientOrganization).where(ClientOrganization.id == "anr_group")).first()
        if not client:
            client = ClientOrganization(
                id="anr_group",
                name="ANR Commercial Laundry Services",
                industry="Commercial Hospitality Laundry",
                status="dev",
                status_text="In Development",
                accounting_software="zoho_books",
            )
            session.add(client)
            session.commit()


def test_get_zoho_authorize_url():
    """Verifies generation of Zoho OAuth authorization URL."""
    client = TestClient(app)
    response = client.get("/api/v1/oauth/zoho/authorize-url?client_id=anr_group")
    assert response.status_code == 200
    data = response.json()
    assert "authorize_url" in data
    assert "accounts.zoho.com/oauth/v2/auth" in data["authorize_url"]
    assert "scope=ZohoBooks.fullaccess.all" in data["authorize_url"]
    assert "state=anr_group" in data["authorize_url"]
    assert "redirect_uri=" in data["authorize_url"]


def test_zoho_connect_direct_redirect():
    """Verifies direct 302 redirect trigger to Zoho consent."""
    client = TestClient(app, follow_redirects=False)
    response = client.get("/api/v1/oauth/zoho/connect?client_id=anr_group")
    assert response.status_code == 302
    assert "location" in response.headers
    assert "accounts.zoho.com/oauth/v2/auth" in response.headers["location"]


def test_zoho_oauth_callback_success_mock():
    """Verifies OAuth callback handling and database credential binding."""
    client = TestClient(app)
    response = client.get("/api/v1/oauth/zoho/callback?code=mock_code_xyz&state=anr_group")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "Zoho Books Connected" in response.text
    assert "ZOHO_OAUTH_SUCCESS" in response.text

    # Verify DB record was updated
    with Session(get_engine()) as session:
        client_obj = session.exec(select(ClientOrganization).where(ClientOrganization.id == "anr_group")).first()
        assert client_obj is not None
        assert client_obj.zoho_org_id is not None
        assert client_obj.custom_config.get("zoho_refresh_token") is not None
        assert client_obj.custom_config.get("zoho_auth_type") == "1-click-oauth"
        assert "Zoho Books" in client_obj.active_integrations


def test_zoho_oauth_status():
    """Verifies live connection status endpoint."""
    client = TestClient(app)
    response = client.get("/api/v1/oauth/zoho/status?client_id=anr_group")
    assert response.status_code == 200
    data = response.json()
    assert data["client_id"] == "anr_group"
    assert data["platform"] == "zoho_books"
    assert data["is_connected"] is True
    assert data["org_id"] is not None


def test_zoho_oauth_disconnect():
    """Verifies revoking and disconnecting Zoho integration."""
    client = TestClient(app)
    response = client.post("/api/v1/oauth/zoho/disconnect?client_id=anr_group")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True

    # Verify status is now disconnected
    status_res = client.get("/api/v1/oauth/zoho/status?client_id=anr_group")
    assert status_res.status_code == 200
    status_data = status_res.json()
    assert status_data["is_connected"] is False
    assert status_data["org_id"] is None


def test_zoho_oauth_callback_error():
    """Verifies error reporting in OAuth callback."""
    client = TestClient(app)
    response = client.get("/api/v1/oauth/zoho/callback?error=access_denied&state=anr_group")
    assert response.status_code == 400
    assert "Connection Failed" in response.text
    assert "access_denied" in response.text
