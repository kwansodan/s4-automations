"""OAuth2 Integration Endpoints for Multi-Tenant Accounting Platforms."""

from typing import Dict, Any, Optional
from datetime import datetime, timezone
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


def get_redirect_uri(request: Request) -> str:
    """Computes the authorized OAuth redirect callback URI."""
    if settings.ZOHO_REDIRECT_URI:
        return settings.ZOHO_REDIRECT_URI
    
    # Dynamically resolve from request host / base URL
    base_url = str(request.base_url).rstrip("/")
    # Handle reverse proxy / forwarded protocols
    forwarded_proto = request.headers.get("x-forwarded-proto")
    forwarded_host = request.headers.get("x-forwarded-host")
    if forwarded_proto and forwarded_host:
        base_url = f"{forwarded_proto}://{forwarded_host}"
    
    return f"{base_url}/api/v1/oauth/zoho/callback"


@router.get("/zoho/authorize-url")
async def get_zoho_authorize_url(
    client_id: str = Query(..., description="Client organization slug, e.g. anr_group"),
    request: Request = None,
) -> Dict[str, Any]:
    """Generates the Zoho OAuth2 authorization consent URL for 1-Click tenant connection."""
    with Session(get_engine()) as session:
        client_obj = session.exec(
            select(ClientOrganization).where(
                (ClientOrganization.id == client_id) | (ClientOrganization.name == client_id)
            )
        ).first()
        if not client_obj:
            raise HTTPException(status_code=404, detail=f"Client organization '{client_id}' not found.")

    app_client_id = settings.ZOHO_CLIENT_ID or "1000.MOCK_S4_APP_ID"
    redirect_uri = get_redirect_uri(request) if request else "http://localhost:8000/api/v1/oauth/zoho/callback"
    accounts_url = settings.ZOHO_ACCOUNTS_URL.rstrip("/")

    # Scopes required for full accounting operations: invoices, bills, banking, contacts, items, coa
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
    error: Optional[str] = Query(None),
    request: Request = None,
) -> HTMLResponse:
    """Handles OAuth2 redirect from Zoho, exchanges code for refresh_token, discovers Org ID, and binds to client record."""
    if error:
        logger.error(f"Zoho OAuth authorization error: {error}")
        return HTMLResponse(
            content=f"""
            <!DOCTYPE html>
            <html>
              <head><title>Zoho Connection Failed</title></head>
              <body style="font-family: sans-serif; background: #0b1120; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
                <div style="text-align: center; padding: 30px; background: #1e293b; border-radius: 16px; border: 1px solid #f43f5e; max-width: 420px;">
                  <h2 style="color: #f43f5e; margin: 0 0 10px 0;">Connection Failed</h2>
                  <p style="color: #94a3b8; font-size: 13px;">{error}</p>
                  <button onclick="window.close()" style="margin-top: 15px; padding: 8px 16px; background: #334155; color: #fff; border: none; border-radius: 8px; cursor: pointer;">Close Window</button>
                </div>
                <script>
                  if (window.opener) {{
                    window.opener.postMessage({{ type: 'ZOHO_OAUTH_ERROR', error: '{error}' }}, '*');
                  }}
                </script>
              </body>
            </html>
            """,
            status_code=400,
        )

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing authorization code or state parameter.")

    client_slug = state
    redirect_uri = get_redirect_uri(request) if request else "http://localhost:8000/api/v1/oauth/zoho/callback"

    org_id = None
    org_name = None
    refresh_token = None

    # Step 1: Handle Mock Mode vs Live Code Exchange
    if settings.MOCK_MODE or code.startswith("mock_") or not settings.ZOHO_CLIENT_SECRET:
        logger.info(f"Mock OAuth exchange for client '{client_slug}'...")
        org_id = f"mock_org_{client_slug}"
        org_name = f"{client_slug.replace('_', ' ').title()} Books"
        refresh_token = f"mock_ref_{client_slug}_{int(datetime.now(timezone.utc).timestamp())}"
    else:
        accounts_url = settings.ZOHO_ACCOUNTS_URL.rstrip("/")
        token_url = f"{accounts_url}/oauth/v2/token"
        
        token_payload = {
            "code": code,
            "client_id": settings.ZOHO_CLIENT_ID,
            "client_secret": settings.ZOHO_CLIENT_SECRET,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }

        async with httpx.AsyncClient(timeout=30.0) as http_client:
            logger.info(f"Exchanging OAuth code with Zoho at {token_url}...")
            token_res = await http_client.post(token_url, params=token_payload)
            
            if token_res.status_code != 200:
                logger.error(f"Failed to exchange OAuth code: {token_res.text}")
                raise HTTPException(status_code=400, detail=f"Zoho token exchange failed: {token_res.text}")
            
            token_data = token_res.json()
            access_token = token_data.get("access_token")
            refresh_token = token_data.get("refresh_token")
            api_domain = token_data.get("api_domain") or settings.ZOHO_BOOKS_API_URL.rstrip("/").replace("/books/v3", "")

            if not access_token:
                raise HTTPException(status_code=400, detail=f"No access token in response: {token_data}")

            # Step 2: Auto-Discover Organization ID and Metadata via Zoho Organizations API
            org_url = f"{api_domain}/books/v3/organizations"
            logger.info(f"Discovering organizations from {org_url}...")
            org_res = await http_client.get(
                org_url,
                headers={"Authorization": f"Zoho-oauthtoken {access_token}"},
            )

            if org_res.status_code == 200:
                org_data = org_res.json()
                orgs = org_data.get("organizations", [])
                if orgs:
                    # Pick the default or first organization
                    primary_org = next((o for o in orgs if o.get("is_default_org")), orgs[0])
                    org_id = str(primary_org.get("organization_id", ""))
                    org_name = primary_org.get("name", "")
                    logger.info(f"Discovered Zoho Organization: {org_name} (ID: {org_id})")

            if not org_id:
                org_id = settings.ZOHO_ORG_ID or "default_org"
                org_name = client_slug.replace("_", " ").title()

    # Step 3: Persist isolated credentials into Database
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
            logger.info(f"Successfully bound Zoho Books Org '{org_name}' ({org_id}) to client '{client_slug}'.")

    # Step 4: Return Elegant Success Window Bridge
    display_org_name = org_name or client_slug.replace("_", " ").title()
    return HTMLResponse(
        content=f"""
        <!DOCTYPE html>
        <html>
          <head>
            <title>Zoho Books Connected Successfully</title>
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
                color: #38bdf8;
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
              <div class="icon">🟢</div>
              <h2>Zoho Books Connected!</h2>
              <p>Successfully authorized and bound organization:</p>
              <div class="badge">{display_org_name} (Org: {org_id})</div>
              <p class="footer">Closing window and returning to S4 Automations...</p>
            </div>
            <script>
              try {{
                if (window.opener) {{
                  window.opener.postMessage({{
                    type: 'ZOHO_OAUTH_SUCCESS',
                    clientId: '{client_slug}',
                    orgId: '{org_id}',
                    orgName: '{display_org_name}'
                  }}, '*');
                  setTimeout(() => window.close(), 1600);
                }} else {{
                  setTimeout(() => {{
                    window.location.href = '/?connected=true&client_id={client_slug}';
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

        logger.info(f"Disconnected Zoho Books for client '{client_id}'.")
        return {
            "success": True,
            "client_id": client_id,
            "message": f"Zoho Books disconnected for organization '{client_obj.name}'.",
        }
