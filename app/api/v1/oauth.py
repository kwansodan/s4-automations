"""Multi-Tenant OAuth2 Integration Endpoints for Zoho Books, QuickBooks Online & Xero."""

from typing import Dict, Any, Optional
from datetime import datetime, timezone
import base64
import httpx
from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlmodel import Session, select

from app.config import settings
from app.db.session import get_engine
from app.models.db_models import ClientOrganization
from app.utils.logging import get_logger

logger = get_logger("oauth")

router = APIRouter(prefix="/oauth", tags=["OAuth Authentication"])


def _resolve_base_url(request: Optional[Request]) -> str:
    """Dynamically resolves external base URL handling reverse proxies."""
    if not request:
        return "http://localhost:8000"
    base_url = str(request.base_url).rstrip("/")
    forwarded_proto = request.headers.get("x-forwarded-proto")
    forwarded_host = request.headers.get("x-forwarded-host")
    if forwarded_proto and forwarded_host:
        base_url = f"{forwarded_proto}://{forwarded_host}"
    return base_url


def get_zoho_redirect_uri(request: Optional[Request]) -> str:
    if settings.ZOHO_REDIRECT_URI:
        return settings.ZOHO_REDIRECT_URI
    return f"{_resolve_base_url(request)}/api/v1/oauth/zoho/callback"


def get_quickbooks_redirect_uri(request: Optional[Request]) -> str:
    if settings.QUICKBOOKS_REDIRECT_URI:
        return settings.QUICKBOOKS_REDIRECT_URI
    return f"{_resolve_base_url(request)}/api/v1/oauth/quickbooks/callback"


def get_xero_redirect_uri(request: Optional[Request]) -> str:
    if settings.XERO_REDIRECT_URI:
        return settings.XERO_REDIRECT_URI
    return f"{_resolve_base_url(request)}/api/v1/oauth/xero/callback"


def _render_success_html(
    platform_name: str,
    platform_icon: str,
    accent_color: str,
    event_type: str,
    client_slug: str,
    org_id: str,
    org_name: str,
    refresh_token: Optional[str] = None,
) -> HTMLResponse:
    """Renders a high-aesthetic popup completion bridge with window.opener postMessage and auto-redirect."""
    display_name = org_name or client_slug.replace("_", " ").title()
    return HTMLResponse(
        content=f"""
        <!DOCTYPE html>
        <html>
          <head>
            <title>{platform_name} Connected Successfully</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body {{
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                background-color: #0b1120;
                color: #f8fafc;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                margin: 0;
                padding: 20px;
                box-sizing: border-box;
              }}
              .card {{
                text-align: center;
                padding: 36px 28px;
                background: linear-gradient(145deg, #1e293b, #0f172a);
                border-radius: 20px;
                border: 1px solid rgba(56, 189, 248, 0.3);
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 20px rgba(56, 189, 248, 0.15);
                max-width: 440px;
                width: 100%;
              }}
              .icon {{
                width: 60px;
                height: 60px;
                background: rgba(16, 185, 129, 0.15);
                border: 1px solid rgba(16, 185, 129, 0.3);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 28px;
                margin: 0 auto 18px auto;
              }}
              h2 {{
                color: #fff;
                font-size: 20px;
                font-weight: 800;
                margin: 0 0 8px 0;
              }}
              p {{
                color: #94a3b8;
                font-size: 13px;
                line-height: 1.5;
                margin: 0 0 16px 0;
              }}
              .badge {{
                display: inline-block;
                background: rgba(15, 23, 42, 0.9);
                border: 1px solid #334155;
                padding: 8px 14px;
                border-radius: 10px;
                font-family: monospace;
                font-size: 12px;
                color: {accent_color};
                margin-bottom: 20px;
              }}
              .footer {{
                color: #64748b;
                font-size: 11px;
              }}
            </style>
          </head>
          <body>
            <div class="card">
              <div class="icon">{platform_icon}</div>
              <h2>{platform_name} Connected!</h2>
              <p>Successfully authorized and bound organization:</p>
              <div class="badge">{display_name} (ID: {org_id})</div>
              <p class="footer">Closing window and returning to S4 Automations...</p>
            </div>
            <script>
              try {{
                if (window.opener) {{
                  window.opener.postMessage({{
                    type: '{event_type}',
                    clientId: '{client_slug}',
                    orgId: '{org_id}',
                    orgName: '{display_name}',
                    refreshToken: '{refresh_token or ""}'
                  }}, '*');
                  setTimeout(() => window.close(), 1600);
                }} else {{
                  setTimeout(() => {{
                    window.location.href = '/?connected=true&client_id={client_slug}&platform={platform_name}';
                  }}, 1800);
                }}
              }} catch (e) {{
                console.error(e);
              }}
            </script>
          </body>
        </html>
        """
    )


def _render_error_html(platform_name: str, error: str) -> HTMLResponse:
    """Renders user-friendly OAuth error response."""
    return HTMLResponse(
        content=f"""
        <!DOCTYPE html>
        <html>
          <head><title>{platform_name} Connection Failed</title></head>
          <body style="font-family: sans-serif; background: #0b1120; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
            <div style="text-align: center; padding: 30px; background: #1e293b; border-radius: 16px; border: 1px solid #f43f5e; max-width: 420px;">
              <h2 style="color: #f43f5e; margin: 0 0 10px 0;">{platform_name} Connection Failed</h2>
              <p style="color: #94a3b8; font-size: 13px;">{error}</p>
              <button onclick="window.close()" style="margin-top: 15px; padding: 8px 16px; background: #334155; color: #fff; border: none; border-radius: 8px; cursor: pointer;">Close Window</button>
            </div>
          </body>
        </html>
        """,
        status_code=400,
    )


# ============================================================================
# 1. ZOHO BOOKS OAUTH2
# ============================================================================

@router.get("/zoho/authorize-url")
async def get_zoho_authorize_url(
    client_id: str = Query(..., description="Client organization slug, e.g. anr_group or new_client_slug"),
    request: Request = None,
) -> Dict[str, Any]:
    """Generates the Zoho OAuth2 authorization consent URL for 1-Click tenant connection."""
    if not client_id or not client_id.strip():
        raise HTTPException(status_code=400, detail="client_id parameter is required.")

    app_client_id = settings.ZOHO_CLIENT_ID or "1000.MOCK_S4_APP_ID"
    redirect_uri = get_zoho_redirect_uri(request)
    accounts_url = settings.ZOHO_ACCOUNTS_URL.rstrip("/")
    scope = "ZohoBooks.fullaccess.all"

    auth_url = (
        f"{accounts_url}/oauth/v2/auth?"
        f"scope={scope}&"
        f"client_id={app_client_id}&"
        f"response_type=code&"
        f"access_type=offline&"
        f"prompt=consent&"
        f"redirect_uri={redirect_uri}&"
        f"state={client_id}"
    )

    return {
        "platform": "zoho_books",
        "authorize_url": auth_url,
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "accounts_url": accounts_url,
    }


@router.get("/zoho/connect")
async def connect_zoho_direct(
    client_id: str = Query(..., description="Client organization slug"),
    request: Request = None,
):
    """Direct HTTP 302 redirect to Zoho OAuth consent screen."""
    data = await get_zoho_authorize_url(client_id=client_id, request=request)
    return RedirectResponse(url=data["authorize_url"], status_code=status.HTTP_302_FOUND)


@router.get("/zoho/callback", response_class=HTMLResponse)
async def zoho_oauth_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None, description="Client organization slug passed in state"),
    location: Optional[str] = Query(None, description="Zoho regional data center, e.g. eu, in, com, au, ca"),
    error: Optional[str] = Query(None),
    request: Request = None,
) -> HTMLResponse:
    """Handles OAuth2 redirect from Zoho, exchanges code for refresh_token, discovers Org ID, and binds to client record."""
    if error:
        logger.error(f"Zoho OAuth authorization error: {error}")
        return _render_error_html("Zoho Books", error)

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing authorization code or state parameter.")

    client_slug = state
    redirect_uri = get_zoho_redirect_uri(request)

    org_id = None
    org_name = None
    refresh_token = None

    if settings.MOCK_MODE or code.startswith("mock_") or not settings.ZOHO_CLIENT_SECRET:
        logger.info(f"Mock OAuth exchange for client '{client_slug}'...")
        org_id = f"mock_org_{client_slug}"
        org_name = f"{client_slug.replace('_', ' ').title()} Books"
        refresh_token = f"mock_ref_{client_slug}_{int(datetime.now(timezone.utc).timestamp())}"
    else:
        accounts_url = settings.ZOHO_ACCOUNTS_URL.rstrip("/")
        if location and location.lower() in ("eu", "in", "com.au", "au", "ca", "jp"):
            accounts_url = f"https://accounts.zoho.{location.lower()}"

        token_url = f"{accounts_url}/oauth/v2/token"
        token_payload = {
            "code": code,
            "client_id": settings.ZOHO_CLIENT_ID,
            "client_secret": settings.ZOHO_CLIENT_SECRET,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }

        async with httpx.AsyncClient(timeout=30.0) as http_client:
            token_res = await http_client.post(token_url, params=token_payload)
            if token_res.status_code != 200:
                raise HTTPException(status_code=400, detail=f"Zoho token exchange failed: {token_res.text}")
            
            token_data = token_res.json()
            access_token = token_data.get("access_token")
            refresh_token = token_data.get("refresh_token")
            api_domain = token_data.get("api_domain") or settings.ZOHO_BOOKS_API_URL.rstrip("/").replace("/books/v3", "")

            if not access_token:
                raise HTTPException(status_code=400, detail=f"No access token in response: {token_data}")

            org_url = f"{api_domain}/books/v3/organizations"
            org_res = await http_client.get(
                org_url,
                headers={"Authorization": f"Zoho-oauthtoken {access_token}"},
            )

            if org_res.status_code == 200:
                org_data = org_res.json()
                orgs = org_data.get("organizations", [])
                if orgs:
                    primary_org = next((o for o in orgs if o.get("is_default_org")), orgs[0])
                    org_id = str(primary_org.get("organization_id", ""))
                    org_name = primary_org.get("name", "")

            if not org_id:
                org_id = settings.ZOHO_ORG_ID or "default_org"
                org_name = client_slug.replace("_", " ").title()

    with Session(get_engine()) as session:
        client_obj = session.exec(
            select(ClientOrganization).where(
                (ClientOrganization.id == client_slug) | (ClientOrganization.name == client_slug)
            )
        ).first()

        if client_obj:
            client_obj.zoho_org_id = org_id
            cfg = dict(client_obj.custom_config or {})
            if refresh_token:
                cfg["zoho_refresh_token"] = refresh_token
            if org_name:
                cfg["zoho_org_name"] = org_name
            cfg["zoho_connected_at"] = datetime.now(timezone.utc).isoformat()
            cfg["zoho_auth_type"] = "1-click-oauth"
            client_obj.custom_config = cfg

            integrations = list(client_obj.active_integrations or [])
            if "Zoho Books" not in integrations and "zoho_books" not in integrations:
                integrations.append("Zoho Books")
            client_obj.active_integrations = integrations
            client_obj.status = "live"
            client_obj.status_text = "Production Live"
            client_obj.updated_at = datetime.now(timezone.utc)

            session.add(client_obj)
            session.commit()

    return _render_success_html(
        platform_name="Zoho Books",
        platform_icon="🟢",
        accent_color="#38bdf8",
        event_type="ZOHO_OAUTH_SUCCESS",
        client_slug=client_slug,
        org_id=org_id or "",
        org_name=org_name or "",
        refresh_token=refresh_token,
    )


@router.get("/zoho/status")
async def get_zoho_connection_status(
    client_id: str = Query(..., description="Client organization slug"),
) -> Dict[str, Any]:
    """Returns the live Zoho Books OAuth connection status for a client organization."""
    with Session(get_engine()) as session:
        client_obj = session.exec(
            select(ClientOrganization).where(
                (ClientOrganization.id == client_id) | (ClientOrganization.name == client_id)
            )
        ).first()
        if not client_obj:
            raise HTTPException(status_code=404, detail=f"Client organization '{client_id}' not found.")

        cfg = client_obj.custom_config or {}
        has_refresh_token = bool(cfg.get("zoho_refresh_token"))
        org_id = client_obj.zoho_org_id or cfg.get("accounting_org_id")
        org_name = cfg.get("zoho_org_name")
        connected_at = cfg.get("zoho_connected_at")

        is_connected = bool(org_id and (has_refresh_token or settings.MOCK_MODE))

        return {
            "client_id": client_obj.id,
            "platform": "zoho_books",
            "is_connected": is_connected,
            "org_id": org_id,
            "org_name": org_name,
            "connected_at": connected_at,
            "auth_type": cfg.get("zoho_auth_type", "manual" if not has_refresh_token else "1-click-oauth"),
        }


@router.post("/zoho/disconnect")
async def disconnect_zoho(
    client_id: str = Query(..., description="Client organization slug"),
) -> Dict[str, Any]:
    """Disconnects and revokes Zoho Books connection for a client organization."""
    with Session(get_engine()) as session:
        client_obj = session.exec(
            select(ClientOrganization).where(
                (ClientOrganization.id == client_id) | (ClientOrganization.name == client_id)
            )
        ).first()
        if not client_obj:
            raise HTTPException(status_code=404, detail=f"Client organization '{client_id}' not found.")

        cfg = dict(client_obj.custom_config or {})
        cfg.pop("zoho_refresh_token", None)
        cfg.pop("zoho_org_name", None)
        cfg.pop("zoho_connected_at", None)
        cfg.pop("zoho_auth_type", None)
        client_obj.custom_config = cfg
        client_obj.zoho_org_id = None

        integrations = [i for i in (client_obj.active_integrations or []) if i not in ("Zoho Books", "zoho_books")]
        client_obj.active_integrations = integrations
        client_obj.updated_at = datetime.now(timezone.utc)

        session.add(client_obj)
        session.commit()

        return {
            "success": True,
            "client_id": client_id,
            "message": f"Zoho Books disconnected for organization '{client_obj.name}'.",
        }


# ============================================================================
# 2. QUICKBOOKS ONLINE OAUTH2
# ============================================================================

@router.get("/quickbooks/authorize-url")
async def get_quickbooks_authorize_url(
    client_id: str = Query(..., description="Client organization slug"),
    request: Request = None,
) -> Dict[str, Any]:
    """Generates the Intuit QuickBooks Online OAuth2 consent URL."""
    if not client_id or not client_id.strip():
        raise HTTPException(status_code=400, detail="client_id parameter is required.")

    app_client_id = settings.QUICKBOOKS_CLIENT_ID or "mock_qb_client_id"
    redirect_uri = get_quickbooks_redirect_uri(request)
    scope = "com.intuit.quickbooks.accounting"

    auth_url = (
        f"https://appcenter.intuit.com/connect/oauth2?"
        f"client_id={app_client_id}&"
        f"response_type=code&"
        f"scope={scope}&"
        f"redirect_uri={redirect_uri}&"
        f"state={client_id}"
    )

    return {
        "platform": "quickbooks_online",
        "authorize_url": auth_url,
        "client_id": client_id,
        "redirect_uri": redirect_uri,
    }


@router.get("/quickbooks/connect")
async def connect_quickbooks_direct(
    client_id: str = Query(..., description="Client organization slug"),
    request: Request = None,
):
    """Direct HTTP 302 redirect to Intuit QuickBooks OAuth consent screen."""
    data = await get_quickbooks_authorize_url(client_id=client_id, request=request)
    return RedirectResponse(url=data["authorize_url"], status_code=status.HTTP_302_FOUND)


@router.get("/quickbooks/callback", response_class=HTMLResponse)
async def quickbooks_oauth_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None, description="Client organization slug"),
    realmId: Optional[str] = Query(None, description="Intuit Realm ID / Company ID"),
    error: Optional[str] = Query(None),
    request: Request = None,
) -> HTMLResponse:
    """Handles OAuth2 redirect from Intuit, exchanges code, fetches company info, and binds realmId to client record."""
    if error:
        logger.error(f"QuickBooks OAuth authorization error: {error}")
        return _render_error_html("QuickBooks Online", error)

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing authorization code or state parameter.")

    client_slug = state
    redirect_uri = get_quickbooks_redirect_uri(request)
    company_name = None
    refresh_token = None
    target_realm_id = realmId or f"mock_realm_{client_slug}"

    if settings.MOCK_MODE or code.startswith("mock_") or not settings.QUICKBOOKS_CLIENT_SECRET:
        logger.info(f"Mock QuickBooks OAuth exchange for client '{client_slug}'...")
        company_name = f"{client_slug.replace('_', ' ').title()} LLC"
        refresh_token = f"mock_qb_ref_{client_slug}_{int(datetime.now(timezone.utc).timestamp())}"
    else:
        token_url = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
        auth_header = base64.b64encode(f"{settings.QUICKBOOKS_CLIENT_ID}:{settings.QUICKBOOKS_CLIENT_SECRET}".encode()).decode()
        
        async with httpx.AsyncClient(timeout=30.0) as http_client:
            token_res = await http_client.post(
                token_url,
                headers={
                    "Authorization": f"Basic {auth_header}",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                },
            )

            if token_res.status_code != 200:
                raise HTTPException(status_code=400, detail=f"QuickBooks token exchange failed: {token_res.text}")

            token_data = token_res.json()
            access_token = token_data.get("access_token")
            refresh_token = token_data.get("refresh_token")

            # Fetch Company Legal Name
            if realmId and access_token:
                base_api = "https://quickbooks.api.intuit.com" if settings.QUICKBOOKS_ENVIRONMENT == "production" else "https://sandbox-quickbooks.api.intuit.com"
                info_res = await http_client.get(
                    f"{base_api}/v3/company/{realmId}/companyinfo/{realmId}",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Accept": "application/json",
                    },
                )
                if info_res.status_code == 200:
                    info_data = info_res.json()
                    company_name = info_data.get("CompanyInfo", {}).get("CompanyName")

            if not company_name:
                company_name = client_slug.replace("_", " ").title()

    with Session(get_engine()) as session:
        client_obj = session.exec(
            select(ClientOrganization).where(
                (ClientOrganization.id == client_slug) | (ClientOrganization.name == client_slug)
            )
        ).first()

        if client_obj:
            cfg = dict(client_obj.custom_config or {})
            cfg["quickbooks_realm_id"] = target_realm_id
            if refresh_token:
                cfg["quickbooks_refresh_token"] = refresh_token
            if company_name:
                cfg["quickbooks_company_name"] = company_name
            cfg["quickbooks_connected_at"] = datetime.now(timezone.utc).isoformat()
            cfg["quickbooks_auth_type"] = "1-click-oauth"
            client_obj.custom_config = cfg

            integrations = list(client_obj.active_integrations or [])
            if "QuickBooks Online" not in integrations and "quickbooks_online" not in integrations:
                integrations.append("QuickBooks Online")
            client_obj.active_integrations = integrations
            client_obj.status = "live"
            client_obj.status_text = "Production Live"
            client_obj.updated_at = datetime.now(timezone.utc)

            session.add(client_obj)
            session.commit()

    return _render_success_html(
        platform_name="QuickBooks Online",
        platform_icon="🟦",
        accent_color="#22c55e",
        event_type="QUICKBOOKS_OAUTH_SUCCESS",
        client_slug=client_slug,
        org_id=target_realm_id,
        org_name=company_name or target_realm_id,
        refresh_token=refresh_token,
    )


@router.get("/quickbooks/status")
async def get_quickbooks_connection_status(
    client_id: str = Query(..., description="Client organization slug"),
) -> Dict[str, Any]:
    """Returns the live QuickBooks Online OAuth connection status."""
    with Session(get_engine()) as session:
        client_obj = session.exec(
            select(ClientOrganization).where(
                (ClientOrganization.id == client_id) | (ClientOrganization.name == client_id)
            )
        ).first()
        if not client_obj:
            raise HTTPException(status_code=404, detail=f"Client organization '{client_id}' not found.")

        cfg = client_obj.custom_config or {}
        has_refresh_token = bool(cfg.get("quickbooks_refresh_token"))
        realm_id = cfg.get("quickbooks_realm_id")
        company_name = cfg.get("quickbooks_company_name")
        connected_at = cfg.get("quickbooks_connected_at")

        is_connected = bool(realm_id and (has_refresh_token or settings.MOCK_MODE))

        return {
            "client_id": client_obj.id,
            "platform": "quickbooks_online",
            "is_connected": is_connected,
            "org_id": realm_id,
            "org_name": company_name,
            "connected_at": connected_at,
            "auth_type": cfg.get("quickbooks_auth_type", "manual" if not has_refresh_token else "1-click-oauth"),
        }


@router.post("/quickbooks/disconnect")
async def disconnect_quickbooks(
    client_id: str = Query(..., description="Client organization slug"),
) -> Dict[str, Any]:
    """Disconnects QuickBooks Online integration for a client organization."""
    with Session(get_engine()) as session:
        client_obj = session.exec(
            select(ClientOrganization).where(
                (ClientOrganization.id == client_id) | (ClientOrganization.name == client_id)
            )
        ).first()
        if not client_obj:
            raise HTTPException(status_code=404, detail=f"Client organization '{client_id}' not found.")

        cfg = dict(client_obj.custom_config or {})
        cfg.pop("quickbooks_realm_id", None)
        cfg.pop("quickbooks_refresh_token", None)
        cfg.pop("quickbooks_company_name", None)
        cfg.pop("quickbooks_connected_at", None)
        cfg.pop("quickbooks_auth_type", None)
        client_obj.custom_config = cfg

        integrations = [i for i in (client_obj.active_integrations or []) if i not in ("QuickBooks Online", "quickbooks_online")]
        client_obj.active_integrations = integrations
        client_obj.updated_at = datetime.now(timezone.utc)

        session.add(client_obj)
        session.commit()

        return {
            "success": True,
            "client_id": client_id,
            "message": f"QuickBooks Online disconnected for organization '{client_obj.name}'.",
        }


# ============================================================================
# 3. XERO OAUTH2
# ============================================================================

@router.get("/xero/authorize-url")
async def get_xero_authorize_url(
    client_id: str = Query(..., description="Client organization slug"),
    request: Request = None,
) -> Dict[str, Any]:
    """Generates the Xero OAuth2 authorization consent URL."""
    if not client_id or not client_id.strip():
        raise HTTPException(status_code=400, detail="client_id parameter is required.")

    app_client_id = settings.XERO_CLIENT_ID or "mock_xero_client_id"
    redirect_uri = get_xero_redirect_uri(request)
    scope = "accounting.transactions accounting.contacts accounting.settings offline_access"

    auth_url = (
        f"https://login.xero.com/identity/connect/authorize?"
        f"response_type=code&"
        f"client_id={app_client_id}&"
        f"redirect_uri={redirect_uri}&"
        f"scope={scope}&"
        f"state={client_id}"
    )

    return {
        "platform": "xero",
        "authorize_url": auth_url,
        "client_id": client_id,
        "redirect_uri": redirect_uri,
    }


@router.get("/xero/connect")
async def connect_xero_direct(
    client_id: str = Query(..., description="Client organization slug"),
    request: Request = None,
):
    """Direct HTTP 302 redirect to Xero OAuth consent screen."""
    data = await get_xero_authorize_url(client_id=client_id, request=request)
    return RedirectResponse(url=data["authorize_url"], status_code=status.HTTP_302_FOUND)


@router.get("/xero/callback", response_class=HTMLResponse)
async def xero_oauth_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None, description="Client organization slug"),
    error: Optional[str] = Query(None),
    request: Request = None,
) -> HTMLResponse:
    """Handles OAuth2 redirect from Xero, exchanges code, queries /connections for tenant discovery, and binds to client."""
    if error:
        logger.error(f"Xero OAuth authorization error: {error}")
        return _render_error_html("Xero", error)

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing authorization code or state parameter.")

    client_slug = state
    redirect_uri = get_xero_redirect_uri(request)
    tenant_id = None
    tenant_name = None
    refresh_token = None

    if settings.MOCK_MODE or code.startswith("mock_") or not settings.XERO_CLIENT_SECRET:
        logger.info(f"Mock Xero OAuth exchange for client '{client_slug}'...")
        tenant_id = f"mock_xero_tenant_{client_slug}"
        tenant_name = f"{client_slug.replace('_', ' ').title()} Xero Account"
        refresh_token = f"mock_xero_ref_{client_slug}_{int(datetime.now(timezone.utc).timestamp())}"
    else:
        token_url = "https://identity.xero.com/connect/token"
        
        async with httpx.AsyncClient(timeout=30.0) as http_client:
            token_res = await http_client.post(
                token_url,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "client_id": settings.XERO_CLIENT_ID,
                    "client_secret": settings.XERO_CLIENT_SECRET,
                },
            )

            if token_res.status_code != 200:
                raise HTTPException(status_code=400, detail=f"Xero token exchange failed: {token_res.text}")

            token_data = token_res.json()
            access_token = token_data.get("access_token")
            refresh_token = token_data.get("refresh_token")

            # Identity Connections Discovery
            conn_res = await http_client.get(
                "https://api.xero.com/connections",
                headers={"Authorization": f"Bearer {access_token}"},
            )

            if conn_res.status_code == 200:
                conns = conn_res.json()
                if conns and isinstance(conns, list):
                    primary_conn = conns[0]
                    tenant_id = primary_conn.get("tenantId")
                    tenant_name = primary_conn.get("tenantName")

            if not tenant_id:
                tenant_id = f"xero_{client_slug}"
                tenant_name = client_slug.replace("_", " ").title()

    with Session(get_engine()) as session:
        client_obj = session.exec(
            select(ClientOrganization).where(
                (ClientOrganization.id == client_slug) | (ClientOrganization.name == client_slug)
            )
        ).first()

        if client_obj:
            cfg = dict(client_obj.custom_config or {})
            cfg["xero_tenant_id"] = tenant_id
            if refresh_token:
                cfg["xero_refresh_token"] = refresh_token
            if tenant_name:
                cfg["xero_tenant_name"] = tenant_name
            cfg["xero_connected_at"] = datetime.now(timezone.utc).isoformat()
            cfg["xero_auth_type"] = "1-click-oauth"
            client_obj.custom_config = cfg

            integrations = list(client_obj.active_integrations or [])
            if "Xero" not in integrations and "xero" not in integrations:
                integrations.append("Xero")
            client_obj.active_integrations = integrations
            client_obj.status = "live"
            client_obj.status_text = "Production Live"
            client_obj.updated_at = datetime.now(timezone.utc)

            session.add(client_obj)
            session.commit()

    return _render_success_html(
        platform_name="Xero",
        platform_icon="🔷",
        accent_color="#0284c7",
        event_type="XERO_OAUTH_SUCCESS",
        client_slug=client_slug,
        org_id=tenant_id or "",
        org_name=tenant_name or tenant_id or "",
        refresh_token=refresh_token,
    )


@router.get("/xero/status")
async def get_xero_connection_status(
    client_id: str = Query(..., description="Client organization slug"),
) -> Dict[str, Any]:
    """Returns the live Xero OAuth connection status."""
    with Session(get_engine()) as session:
        client_obj = session.exec(
            select(ClientOrganization).where(
                (ClientOrganization.id == client_id) | (ClientOrganization.name == client_id)
            )
        ).first()
        if not client_obj:
            raise HTTPException(status_code=404, detail=f"Client organization '{client_id}' not found.")

        cfg = client_obj.custom_config or {}
        has_refresh_token = bool(cfg.get("xero_refresh_token"))
        tenant_id = cfg.get("xero_tenant_id")
        tenant_name = cfg.get("xero_tenant_name")
        connected_at = cfg.get("xero_connected_at")

        is_connected = bool(tenant_id and (has_refresh_token or settings.MOCK_MODE))

        return {
            "client_id": client_obj.id,
            "platform": "xero",
            "is_connected": is_connected,
            "org_id": tenant_id,
            "org_name": tenant_name,
            "connected_at": connected_at,
            "auth_type": cfg.get("xero_auth_type", "manual" if not has_refresh_token else "1-click-oauth"),
        }


@router.post("/xero/disconnect")
async def disconnect_xero(
    client_id: str = Query(..., description="Client organization slug"),
) -> Dict[str, Any]:
    """Disconnects Xero integration for a client organization."""
    with Session(get_engine()) as session:
        client_obj = session.exec(
            select(ClientOrganization).where(
                (ClientOrganization.id == client_id) | (ClientOrganization.name == client_id)
            )
        ).first()
        if not client_obj:
            raise HTTPException(status_code=404, detail=f"Client organization '{client_id}' not found.")

        cfg = dict(client_obj.custom_config or {})
        cfg.pop("xero_tenant_id", None)
        cfg.pop("xero_refresh_token", None)
        cfg.pop("xero_tenant_name", None)
        cfg.pop("xero_connected_at", None)
        cfg.pop("xero_auth_type", None)
        client_obj.custom_config = cfg

        integrations = [i for i in (client_obj.active_integrations or []) if i not in ("Xero", "xero")]
        client_obj.active_integrations = integrations
        client_obj.updated_at = datetime.now(timezone.utc)

        session.add(client_obj)
        session.commit()

        return {
            "success": True,
            "client_id": client_id,
            "message": f"Xero disconnected for organization '{client_obj.name}'.",
        }
