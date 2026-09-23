"""Multi-Tenant OAuth2 Integration Endpoints for Zoho Books, QuickBooks Online & Xero."""

from typing import Dict, Any, Optional, List
from datetime import datetime, timezone
import base64
import json
import httpx
from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field
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
        return "https://autapi.service4gh.com"
    forwarded_proto = request.headers.get("x-forwarded-proto")
    forwarded_host = request.headers.get("x-forwarded-host")
    if forwarded_proto and forwarded_host:
        return f"{forwarded_proto}://{forwarded_host}"
    host = request.headers.get("host")
    if host:
        proto = "https" if not ("localhost" in host or "127.0.0.1" in host) else "http"
        return f"{proto}://{host}"
    base_url = str(request.base_url).rstrip("/")
    if "localhost" in base_url or "127.0.0.1" in base_url:
        return "http://localhost:8000"
    return base_url or "https://autapi.service4gh.com"


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


def get_linkedin_redirect_uri(request: Optional[Request]) -> str:
    if settings.LINKEDIN_REDIRECT_URI:
        return settings.LINKEDIN_REDIRECT_URI
    return f"{_resolve_base_url(request)}/api/v1/oauth/linkedin/callback"


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
              try {
                var allowedOrigins = """ + json.dumps(settings.get_cors_origins()) + """;
                var targetOrigin = null;
                try {
                  if (document.referrer) {
                    var ref = new URL(document.referrer).origin;
                    if (allowedOrigins.indexOf(ref) !== -1) {
                      targetOrigin = ref;
                    }
                  }
                } catch (err) {}

                if (window.opener) {
                  var payload = {
                    type: '""" + event_type + """',
                    clientId: '""" + client_slug + """',
                    orgId: '""" + org_id + """',
                    orgName: '""" + display_name + """',
                    refreshToken: '""" + (refresh_token or "") + """'
                  };
                  if (targetOrigin) {
                    window.opener.postMessage(payload, targetOrigin);
                  } else {
                    for (var i = 0; i < allowedOrigins.length; i++) {
                      window.opener.postMessage(payload, allowedOrigins[i]);
                    }
                  }
                  setTimeout(function() { window.close(); }, 1600);
                } else {
                  setTimeout(function() {
                    window.location.href = '/?connected=true&client_id=""" + client_slug + """&platform=""" + platform_name + """';
                  }, 1800);
                }
              } catch (e) {
                console.error(e);
              }
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


def _render_org_selection_html(
    client_slug: str,
    orgs: List[Dict[str, Any]],
    refresh_token: str,
    access_token: str,
) -> HTMLResponse:
    """Renders an interactive organization entity selector when a Zoho account has multiple business entities."""
    serialized_orgs = [
        {
            "org_id": str(o.get("organization_id", "")),
            "name": o.get("name", "Unnamed Organization"),
            "currency": o.get("currency_code", ""),
            "is_default": bool(o.get("is_default_org", False)),
        }
        for o in orgs
    ]
    orgs_json_str = json.dumps(serialized_orgs)
    client_display = client_slug.replace("_", " ").title()

    cards_html = ""
    for o in serialized_orgs:
        def_badge = '<span style="background: rgba(16,185,129,0.2); color: #34d399; font-size: 10px; font-weight: bold; padding: 2px 8px; border-radius: 9999px; border: 1px solid rgba(16,185,129,0.3);">★ Default</span>' if o["is_default"] else ""
        curr_text = f" • Currency: {o['currency']}" if o['currency'] else ""
        cards_html += f"""
        <div class="org-card" onclick="selectOrg('{o['org_id']}', '{o['name']}')">
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
              <span style="font-size: 13px; font-weight: 700; color: #fff;">{o['name']}</span>
              {def_badge}
            </div>
            <div style="font-size: 11px; color: #94a3b8; font-family: monospace;">
              Org ID: <span style="color: #38bdf8;">{o['org_id']}</span>{curr_text}
            </div>
          </div>
          <button type="button" class="btn-select" id="btn-{o['org_id']}">
            Select Entity &rarr;
          </button>
        </div>
        """

    return HTMLResponse(
        content=f"""
        <!DOCTYPE html>
        <html>
          <head>
            <title>Select Zoho Books Entity</title>
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
                padding: 16px;
                box-sizing: border-box;
              }}
              .container {{
                background: linear-gradient(145deg, #1e293b, #0f172a);
                border-radius: 20px;
                border: 1px solid rgba(56, 189, 248, 0.3);
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
                max-width: 520px;
                width: 100%;
                padding: 28px 24px;
              }}
              .header {{
                text-align: center;
                margin-bottom: 20px;
              }}
              .header h2 {{
                color: #fff;
                font-size: 18px;
                font-weight: 800;
                margin: 0 0 6px 0;
              }}
              .header p {{
                color: #94a3b8;
                font-size: 12px;
                line-height: 1.4;
                margin: 0;
              }}
              .org-list {{
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-height: 380px;
                overflow-y: auto;
                padding-right: 4px;
              }}
              .org-card {{
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                background: #0b1329;
                border: 1px solid #334155;
                border-radius: 12px;
                padding: 14px 16px;
                cursor: pointer;
                transition: all 0.2s ease;
                text-align: left;
              }}
              .org-card:hover {{
                border-color: #38bdf8;
                background: #0f1f3d;
                transform: translateY(-1px);
              }}
              .btn-select {{
                background: #0284c7;
                color: #fff;
                border: none;
                border-radius: 8px;
                font-size: 11px;
                font-weight: 700;
                padding: 6px 12px;
                cursor: pointer;
                transition: background 0.15s ease;
                white-space: nowrap;
              }}
              .btn-select:hover {{
                background: #0369a1;
              }}
              .success-card {{
                display: none;
                text-align: center;
                padding: 20px 0;
              }}
              .success-card h3 {{
                color: #34d399;
                margin: 12px 0 6px 0;
              }}
            </style>
          </head>
          <body>
            <div class="container" id="picker-container">
              <div id="picker-view">
                <div class="header">
                  <div style="font-size: 28px; margin-bottom: 8px;">🏢</div>
                  <h2>Select Zoho Organization Entity</h2>
                  <p>Your Zoho account is linked to <b>{len(serialized_orgs)} entities</b>. Select which organization to connect to <b>{client_display}</b>:</p>
                </div>
                <div class="org-list">
                  {cards_html}
                </div>
              </div>
              <div class="success-card" id="success-view">
                <div style="font-size: 36px;">🟢</div>
                <h3>Connected Successfully!</h3>
                <p style="color: #94a3b8; font-size: 13px;" id="confirmed-label">Linked to organization</p>
                <p style="color: #64748b; font-size: 11px; margin-top: 14px;">Closing window and returning to S4 Automations...</p>
              </div>
            </div>

            <script>
              const availableOrgs = {orgs_json_str};

              async function selectOrg(orgId, orgName) {{
                const btns = document.querySelectorAll('.btn-select');
                btns.forEach(b => {{ b.disabled = true; b.innerText = 'Linking...'; }});

                const postPayload = {{
                  type: 'ZOHO_OAUTH_SUCCESS',
                  clientId: '{client_slug}',
                  orgId: orgId,
                  orgName: orgName,
                  refreshToken: '{refresh_token}',
                  availableOrgs: availableOrgs
                }};

                // Immediately notify opener window so setup wizard receives entity selection
                if (window.opener) {{
                  try {{
                    window.opener.postMessage(postPayload, '*');
                  }} catch (pErr) {{
                    console.warn('postMessage notice:', pErr);
                  }}
                }}

                // Persist selection to backend
                try {{
                  await fetch('/api/v1/oauth/zoho/confirm-org', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{
                      client_id: '{client_slug}',
                      org_id: orgId,
                      org_name: orgName,
                      refresh_token: '{refresh_token}',
                      available_orgs: availableOrgs
                    }})
                  }});
                }} catch (syncErr) {{
                  console.warn('Backend confirmation sync notice:', syncErr);
                }}

                // Transition to confirmed success view and close popup
                document.getElementById('picker-view').style.display = 'none';
                document.getElementById('success-view').style.display = 'block';
                document.getElementById('confirmed-label').innerText = orgName + ' (ID: ' + orgId + ')';
                setTimeout(() => window.close(), 1600);
              }}
            </script>
          </body>
        </html>
        """
    )


def _render_xero_tenant_selection_html(
    client_slug: str,
    tenants: List[Dict[str, Any]],
    refresh_token: str,
) -> HTMLResponse:
    """Renders an interactive organization entity selector when a Xero user account is connected to multiple Xero tenants."""
    serialized_tenants = [
        {
            "org_id": str(t.get("tenantId", "")),
            "name": t.get("tenantName", "Unnamed Organisation"),
            "tenant_type": t.get("tenantType", "ORGANISATION"),
        }
        for t in tenants
    ]
    tenants_json_str = json.dumps(serialized_tenants)
    client_display = client_slug.replace("_", " ").title()

    cards_html = ""
    for t in serialized_tenants:
        cards_html += f"""
        <div class="org-card" onclick="selectTenant('{t['org_id']}', '{t['name']}')">
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
              <span style="font-size: 13px; font-weight: 700; color: #fff;">{t['name']}</span>
              <span style="background: rgba(2,132,199,0.2); color: #38bdf8; font-size: 10px; font-weight: bold; padding: 2px 8px; border-radius: 9999px; border: 1px solid rgba(2,132,199,0.3);">{t['tenant_type']}</span>
            </div>
            <div style="font-size: 11px; color: #94a3b8; font-family: monospace;">
              Tenant ID: <span style="color: #38bdf8;">{t['org_id']}</span>
            </div>
          </div>
          <button type="button" class="btn-select" id="btn-{t['org_id']}">
            Select Organisation &rarr;
          </button>
        </div>
        """

    return HTMLResponse(
        content=f"""
        <!DOCTYPE html>
        <html>
          <head>
            <title>Select Xero Organisation</title>
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
                padding: 16px;
                box-sizing: border-box;
              }}
              .container {{
                background: linear-gradient(145deg, #1e293b, #0f172a);
                border-radius: 20px;
                border: 1px solid rgba(2, 132, 199, 0.4);
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
                max-width: 520px;
                width: 100%;
                padding: 28px 24px;
              }}
              .header {{
                text-align: center;
                margin-bottom: 20px;
              }}
              .header h2 {{
                color: #fff;
                font-size: 18px;
                font-weight: 800;
                margin: 0 0 6px 0;
              }}
              .header p {{
                color: #94a3b8;
                font-size: 12px;
                line-height: 1.4;
                margin: 0;
              }}
              .org-list {{
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-height: 380px;
                overflow-y: auto;
                padding-right: 4px;
              }}
              .org-card {{
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                background: #0b1329;
                border: 1px solid #334155;
                border-radius: 12px;
                padding: 14px 16px;
                cursor: pointer;
                transition: all 0.2s ease;
                text-align: left;
              }}
              .org-card:hover {{
                border-color: #38bdf8;
                background: #0f1f3d;
                transform: translateY(-1px);
              }}
              .btn-select {{
                background: #0284c7;
                color: #fff;
                border: none;
                border-radius: 8px;
                font-size: 11px;
                font-weight: 700;
                padding: 6px 12px;
                cursor: pointer;
                transition: background 0.15s ease;
                white-space: nowrap;
              }}
              .btn-select:hover {{
                background: #0369a1;
              }}
              .success-card {{
                display: none;
                text-align: center;
                padding: 20px 0;
              }}
              .success-card h3 {{
                color: #38bdf8;
                margin: 12px 0 6px 0;
              }}
            </style>
          </head>
          <body>
            <div class="container" id="picker-container">
              <div id="picker-view">
                <div class="header">
                  <div style="font-size: 28px; margin-bottom: 8px;">🔷</div>
                  <h2>Select Xero Organisation</h2>
                  <p>Your Xero account has access to <b>{len(serialized_tenants)} organisations</b>. Select which organisation to connect to <b>{client_display}</b>:</p>
                </div>
                <div class="org-list">
                  {cards_html}
                </div>
              </div>
              <div class="success-card" id="success-view">
                <div style="font-size: 36px;">🟢</div>
                <h3>Connected Successfully!</h3>
                <p style="color: #94a3b8; font-size: 13px;" id="confirmed-label">Linked to Xero organisation</p>
                <p style="color: #64748b; font-size: 11px; margin-top: 14px;">Closing window and returning to S4 Automations...</p>
              </div>
            </div>

            <script>
              const availableTenants = {tenants_json_str};

              async function selectTenant(tenantId, tenantName) {{
                const btns = document.querySelectorAll('.btn-select');
                btns.forEach(b => {{ b.disabled = true; b.innerText = 'Linking...'; }});

                const postPayload = {{
                  type: 'XERO_OAUTH_SUCCESS',
                  clientId: '{client_slug}',
                  orgId: tenantId,
                  orgName: tenantName,
                  refreshToken: '{refresh_token}',
                  availableOrgs: availableTenants
                }};

                // Immediately notify opener window so setup wizard receives entity selection
                if (window.opener) {{
                  try {{
                    window.opener.postMessage(postPayload, '*');
                  }} catch (pErr) {{
                    console.warn('postMessage notice:', pErr);
                  }}
                }}

                // Persist selection to backend
                try {{
                  await fetch('/api/v1/oauth/xero/confirm-tenant', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{
                      client_id: '{client_slug}',
                      tenant_id: tenantId,
                      tenant_name: tenantName,
                      refresh_token: '{refresh_token}',
                      available_tenants: availableTenants
                    }})
                  }});
                }} catch (syncErr) {{
                  console.warn('Backend confirmation sync notice:', syncErr);
                }}

                // Transition to confirmed success view and close popup
                document.getElementById('picker-view').style.display = 'none';
                document.getElementById('success-view').style.display = 'block';
                document.getElementById('confirmed-label').innerText = tenantName + ' (ID: ' + tenantId + ')';
                setTimeout(() => window.close(), 1600);
              }}
            </script>
          </body>
        </html>
        """
    )


# ============================================================================
# 1. ZOHO BOOKS OAUTH2
# ============================================================================

@router.get("/zoho/authorize-url")
async def get_zoho_authorize_url(
    client_id: str = Query(..., description="Client organization slug, e.g. anr_group or new_client_slug"),
    redirect_uri: Optional[str] = Query(None, description="Custom redirect URI override"),
    request: Request = None,
) -> Dict[str, Any]:
    """Generates the Zoho OAuth2 authorization consent URL for 1-Click tenant connection."""
    if not client_id or not client_id.strip():
        raise HTTPException(status_code=400, detail="client_id parameter is required.")

    app_client_id = settings.ZOHO_CLIENT_ID or "1000.MOCK_S4_APP_ID"
    final_redirect_uri = redirect_uri.strip() if (redirect_uri and redirect_uri.strip()) else get_zoho_redirect_uri(request)
    accounts_url = settings.ZOHO_ACCOUNTS_URL.rstrip("/")
    scope = "ZohoBooks.fullaccess.all"

    auth_url = (
        f"{accounts_url}/oauth/v2/auth?"
        f"scope={scope}&"
        f"client_id={app_client_id}&"
        f"response_type=code&"
        f"access_type=offline&"
        f"prompt=consent&"
        f"redirect_uri={final_redirect_uri}&"
        f"state={client_id}"
    )

    return {
        "platform": "zoho_books",
        "authorize_url": auth_url,
        "client_id": client_id,
        "redirect_uri": final_redirect_uri,
        "app_client_id": app_client_id,
        "accounts_url": accounts_url,
        "recommended_redirect_uris": [
            "https://autapi.service4gh.com/api/v1/oauth/zoho/callback",
            "https://service4gh.com/api/v1/oauth/zoho/callback",
            f"{_resolve_base_url(request)}/api/v1/oauth/zoho/callback",
        ],
    }


@router.get("/zoho/connect")
async def connect_zoho_direct(
    client_id: str = Query(..., description="Client organization slug"),
    redirect_uri: Optional[str] = Query(None, description="Custom redirect URI override"),
    request: Request = None,
):
    """Direct HTTP 302 redirect to Zoho OAuth consent screen."""
    data = await get_zoho_authorize_url(client_id=client_id, redirect_uri=redirect_uri, request=request)
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
                if len(orgs) > 1:
                    logger.info(f"Zoho user has {len(orgs)} organizations. Presenting interactive entity picker for client '{client_slug}'.")
                    return _render_org_selection_html(
                        client_slug=client_slug,
                        orgs=orgs,
                        refresh_token=refresh_token or "",
                        access_token=access_token or "",
                    )
                elif orgs:
                    primary_org = orgs[0]
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
            if 'orgs' in locals() and orgs:
                cfg["zoho_available_orgs"] = [
                    {
                        "org_id": str(o.get("organization_id", "")),
                        "name": o.get("name", "Unnamed Organization"),
                        "currency": o.get("currency_code", ""),
                        "is_default": bool(o.get("is_default_org", False)),
                    }
                    for o in orgs
                ]
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


class ZohoConfirmOrgRequest(BaseModel):
    client_id: str = Field(..., description="Client organization slug")
    org_id: str = Field(..., description="Selected Zoho organization ID")
    org_name: Optional[str] = Field(None, description="Selected Zoho organization name")
    refresh_token: Optional[str] = Field(None, description="OAuth refresh token")
    available_orgs: Optional[List[Dict[str, Any]]] = Field(None, description="Discovered Zoho organization entities")


@router.post("/zoho/confirm-org")
async def confirm_zoho_org(payload: ZohoConfirmOrgRequest) -> Dict[str, Any]:
    """Persists user's chosen Zoho organization entity and refreshes client status."""
    with Session(get_engine()) as session:
        client_obj = session.exec(
            select(ClientOrganization).where(
                (ClientOrganization.id == payload.client_id) | (ClientOrganization.name == payload.client_id)
            )
        ).first()

        if not client_obj:
            logger.info(f"Client '{payload.client_id}' not found during OAuth confirm-org. Auto-provisioning onboarding draft client.")
            client_obj = ClientOrganization(
                id=payload.client_id,
                name=payload.client_id.replace("_", " ").title(),
                industry="General",
                status="dev",
                status_text="Onboarding Draft",
                accounting_software="zoho_books",
                zoho_org_id=payload.org_id,
            )
            session.add(client_obj)

        client_obj.zoho_org_id = payload.org_id
        cfg = dict(client_obj.custom_config or {})
        if payload.refresh_token:
            cfg["zoho_refresh_token"] = payload.refresh_token
        if payload.org_name:
            cfg["zoho_org_name"] = payload.org_name
        if payload.available_orgs:
            cfg["zoho_available_orgs"] = payload.available_orgs
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

        logger.info(f"Successfully bound client '{payload.client_id}' to Zoho entity '{payload.org_name}' (ID: {payload.org_id})")

        return {
            "success": True,
            "client_id": payload.client_id,
            "org_id": payload.org_id,
            "org_name": payload.org_name,
            "available_orgs": payload.available_orgs or [],
        }


@router.get("/zoho/organizations")
async def get_zoho_organizations(
    client_id: str = Query(..., description="Client organization slug"),
) -> Dict[str, Any]:
    """Retrieves all Zoho organization entities accessible to the client.
    First returns cached organizations from DB; if access token can be refreshed, refreshes live from Zoho API.
    """
    with Session(get_engine()) as session:
        client_obj = session.exec(
            select(ClientOrganization).where(
                (ClientOrganization.id == client_id) | (ClientOrganization.name == client_id)
            )
        ).first()

        if not client_obj:
            raise HTTPException(status_code=404, detail=f"Client organization '{client_id}' not found.")

        cfg = client_obj.custom_config or {}
        cached_orgs = cfg.get("zoho_available_orgs", [])
        active_org_id = client_obj.zoho_org_id or cfg.get("accounting_org_id")
        refresh_token = cfg.get("zoho_refresh_token")

        if not refresh_token or settings.MOCK_MODE:
            return {
                "client_id": client_id,
                "active_org_id": active_org_id,
                "organizations": cached_orgs or ([{"org_id": active_org_id, "name": cfg.get("zoho_org_name", client_obj.name), "is_default": True}] if active_org_id else []),
            }

        # Attempt live fetch from Zoho API using refresh token
        try:
            from app.services.zoho_service import ZohoBooksService
            service = ZohoBooksService.from_client_id(client_id)
            access_token = service._get_access_token()
            api_domain = settings.ZOHO_BOOKS_API_URL.rstrip("/").replace("/books/v3", "")

            async with httpx.AsyncClient(timeout=15.0) as http_client:
                org_res = await http_client.get(
                    f"{api_domain}/books/v3/organizations",
                    headers={"Authorization": f"Zoho-oauthtoken {access_token}"},
                )
                if org_res.status_code == 200:
                    raw_orgs = org_res.json().get("organizations", [])
                    live_orgs = [
                        {
                            "org_id": str(o.get("organization_id", "")),
                            "name": o.get("name", "Unnamed Organization"),
                            "currency": o.get("currency_code", ""),
                            "is_default": bool(o.get("is_default_org", False)),
                        }
                        for o in raw_orgs
                    ]
                    # Update cache in DB
                    cfg_copy = dict(cfg)
                    cfg_copy["zoho_available_orgs"] = live_orgs
                    client_obj.custom_config = cfg_copy
                    session.add(client_obj)
                    session.commit()
                    return {
                        "client_id": client_id,
                        "active_org_id": active_org_id,
                        "organizations": live_orgs,
                    }
        except Exception as e:
            logger.warning(f"Could not refresh live Zoho orgs for '{client_id}': {e}")

        return {
            "client_id": client_id,
            "active_org_id": active_org_id,
            "organizations": cached_orgs,
        }


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
        available_orgs = cfg.get("zoho_available_orgs", [])

        is_connected = bool(org_id and (has_refresh_token or settings.MOCK_MODE))

        return {
            "client_id": client_obj.id,
            "platform": "zoho_books",
            "is_connected": is_connected,
            "org_id": org_id,
            "org_name": org_name,
            "connected_at": connected_at,
            "auth_type": cfg.get("zoho_auth_type", "manual" if not has_refresh_token else "1-click-oauth"),
            "available_orgs": available_orgs,
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
                    if len(conns) > 1:
                        logger.info(f"Xero account for client '{client_slug}' has {len(conns)} connected tenants. Presenting tenant picker.")
                        return _render_xero_tenant_selection_html(
                            client_slug=client_slug,
                            tenants=conns,
                            refresh_token=refresh_token or "",
                        )
                    elif conns:
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
            if 'conns' in locals() and conns:
                cfg["xero_available_tenants"] = [
                    {
                        "org_id": str(t.get("tenantId", "")),
                        "name": t.get("tenantName", "Unnamed Organisation"),
                        "tenant_type": t.get("tenantType", "ORGANISATION"),
                    }
                    for t in conns
                ]
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


class XeroConfirmTenantRequest(BaseModel):
    client_id: str = Field(..., description="Client organization slug")
    tenant_id: str = Field(..., description="Selected Xero tenant ID")
    tenant_name: Optional[str] = Field(None, description="Selected Xero tenant name")
    refresh_token: Optional[str] = Field(None, description="OAuth refresh token")
    available_tenants: Optional[List[Dict[str, Any]]] = Field(None, description="Discovered Xero tenants")


@router.post("/xero/confirm-tenant")
async def confirm_xero_tenant(payload: XeroConfirmTenantRequest) -> Dict[str, Any]:
    """Persists user's chosen Xero tenant organization and refreshes client status."""
    with Session(get_engine()) as session:
        client_obj = session.exec(
            select(ClientOrganization).where(
                (ClientOrganization.id == payload.client_id) | (ClientOrganization.name == payload.client_id)
            )
        ).first()

        if not client_obj:
            logger.info(f"Client '{payload.client_id}' not found during Xero confirm-tenant. Auto-provisioning onboarding draft client.")
            client_obj = ClientOrganization(
                id=payload.client_id,
                name=payload.client_id.replace("_", " ").title(),
                industry="General",
                status="dev",
                status_text="Onboarding Draft",
                accounting_software="xero",
            )
            session.add(client_obj)

        cfg = dict(client_obj.custom_config or {})
        cfg["xero_tenant_id"] = payload.tenant_id
        if payload.refresh_token:
            cfg["xero_refresh_token"] = payload.refresh_token
        if payload.tenant_name:
            cfg["xero_tenant_name"] = payload.tenant_name
        if payload.available_tenants:
            cfg["xero_available_tenants"] = payload.available_tenants
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

        logger.info(f"Successfully bound client '{payload.client_id}' to Xero tenant '{payload.tenant_name}' (ID: {payload.tenant_id})")

        return {
            "success": True,
            "client_id": payload.client_id,
            "tenant_id": payload.tenant_id,
            "tenant_name": payload.tenant_name,
            "available_tenants": payload.available_tenants or [],
        }


@router.get("/xero/tenants")
async def get_xero_tenants(
    client_id: str = Query(..., description="Client organization slug"),
) -> Dict[str, Any]:
    """Retrieves all Xero tenants accessible to the client from DB cache or live Xero connections."""
    with Session(get_engine()) as session:
        client_obj = session.exec(
            select(ClientOrganization).where(
                (ClientOrganization.id == client_id) | (ClientOrganization.name == client_id)
            )
        ).first()

        if not client_obj:
            raise HTTPException(status_code=404, detail=f"Client organization '{client_id}' not found.")

        cfg = client_obj.custom_config or {}
        cached_tenants = cfg.get("xero_available_tenants", [])
        active_tenant_id = cfg.get("xero_tenant_id")
        refresh_token = cfg.get("xero_refresh_token")

        if not refresh_token or settings.MOCK_MODE:
            return {
                "client_id": client_id,
                "active_org_id": active_tenant_id,
                "organizations": [
                    {"org_id": t.get("org_id") or t.get("tenantId"), "name": t.get("name") or t.get("tenantName")}
                    for t in cached_tenants
                ] if cached_tenants else ([{"org_id": active_tenant_id, "name": cfg.get("xero_tenant_name", client_obj.name)}] if active_tenant_id else []),
            }

        try:
            token_url = "https://identity.xero.com/connect/token"
            async with httpx.AsyncClient(timeout=15.0) as http_client:
                token_res = await http_client.post(
                    token_url,
                    data={
                        "grant_type": "refresh_token",
                        "refresh_token": refresh_token,
                        "client_id": settings.XERO_CLIENT_ID,
                        "client_secret": settings.XERO_CLIENT_SECRET,
                    },
                )
                if token_res.status_code == 200:
                    token_data = token_res.json()
                    new_access = token_data.get("access_token")
                    new_refresh = token_data.get("refresh_token")
                    conn_res = await http_client.get(
                        "https://api.xero.com/connections",
                        headers={"Authorization": f"Bearer {new_access}"},
                    )
                    if conn_res.status_code == 200:
                        raw_conns = conn_res.json()
                        live_tenants = [
                            {
                                "org_id": str(t.get("tenantId", "")),
                                "name": t.get("tenantName", "Unnamed Organisation"),
                                "tenant_type": t.get("tenantType", "ORGANISATION"),
                            }
                            for t in raw_conns
                        ]
                        cfg_copy = dict(cfg)
                        cfg_copy["xero_available_tenants"] = live_tenants
                        if new_refresh:
                            cfg_copy["xero_refresh_token"] = new_refresh
                        client_obj.custom_config = cfg_copy
                        session.add(client_obj)
                        session.commit()
                        return {
                            "client_id": client_id,
                            "active_org_id": active_tenant_id,
                            "organizations": live_tenants,
                        }
        except Exception as e:
            logger.warning(f"Could not refresh live Xero tenants for '{client_id}': {e}")

        return {
            "client_id": client_id,
            "active_org_id": active_tenant_id,
            "organizations": [
                {"org_id": t.get("org_id") or t.get("tenantId"), "name": t.get("name") or t.get("tenantName")}
                for t in cached_tenants
            ],
        }


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
        raw_tenants = cfg.get("xero_available_tenants", [])
        available_orgs = [
            {"org_id": t.get("org_id") or t.get("tenantId"), "name": t.get("name") or t.get("tenantName")}
            for t in raw_tenants
        ]

        is_connected = bool(tenant_id and (has_refresh_token or settings.MOCK_MODE))

        return {
            "client_id": client_obj.id,
            "platform": "xero",
            "is_connected": is_connected,
            "org_id": tenant_id,
            "org_name": tenant_name,
            "connected_at": connected_at,
            "auth_type": cfg.get("xero_auth_type", "manual" if not has_refresh_token else "1-click-oauth"),
            "available_orgs": available_orgs,
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


# -------------------------------------------------------------------------
# LinkedIn OAuth2
# -------------------------------------------------------------------------

@router.get("/linkedin/authorize", summary="Initiate LinkedIn OAuth2 Authorization")
async def linkedin_authorize(
    request: Request,
    state: Optional[str] = Query(default="social_broadcaster"),
):
    """Initiates OAuth2 code flow with LinkedIn."""
    client_id = settings.LINKEDIN_CLIENT_ID
    if not client_id:
        raise HTTPException(
            status_code=400,
            detail="LinkedIn Client ID not configured. Please set LINKEDIN_CLIENT_ID in settings or enter access token manually.",
        )
    redirect_uri = get_linkedin_redirect_uri(request)
    scope = "openid profile email w_member_social w_organization_social r_organization_social"
    auth_url = (
        f"https://www.linkedin.com/oauth/v2/authorization?"
        f"response_type=code&client_id={client_id}&redirect_uri={httpx.URL(redirect_uri)}&scope={scope}&state={state}"
    )
    return RedirectResponse(auth_url)


@router.get("/linkedin/callback", summary="LinkedIn OAuth2 Callback", response_class=HTMLResponse)
async def linkedin_callback(
    request: Request,
    code: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
):
    """Handles OAuth2 callback from LinkedIn, exchanges code for access token, and saves it."""
    if error:
        return _render_error_html("LinkedIn", "🔗", "#0A66C2", error, error_description or "User cancelled or denied authorization.")
    if not code:
        return _render_error_html("LinkedIn", "🔗", "#0A66C2", "Missing Code", "No authorization code received from LinkedIn.")

    client_id = settings.LINKEDIN_CLIENT_ID
    client_secret = settings.LINKEDIN_CLIENT_SECRET
    redirect_uri = get_linkedin_redirect_uri(request)

    if not client_id or not client_secret:
        return _render_error_html("LinkedIn", "🔗", "#0A66C2", "Configuration Missing", "LINKEDIN_CLIENT_ID or LINKEDIN_CLIENT_SECRET is missing.")

    try:
        token_url = "https://www.linkedin.com/oauth/v2/accessToken"
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": client_id,
            "client_secret": client_secret,
        }
        async with httpx.AsyncClient(timeout=15.0) as http_client:
            token_res = await http_client.post(token_url, data=data)
            if token_res.status_code not in (200, 201):
                return _render_error_html("LinkedIn", "🔗", "#0A66C2", "Token Exchange Failed", f"LinkedIn returned HTTP {token_res.status_code}: {token_res.text}")
            token_data = token_res.json()
            access_token = token_data.get("access_token")

            user_name = "Authorized User"
            try:
                user_res = await http_client.get("https://api.linkedin.com/v2/userinfo", headers={"Authorization": f"Bearer {access_token}"})
                if user_res.status_code == 200:
                    user_info = user_res.json()
                    user_name = user_info.get("name") or user_info.get("email") or "Authorized User"
            except Exception:
                pass

            settings.update_values({
                "LINKEDIN_ACCESS_TOKEN": access_token,
            })
            settings.save_to_env_file()

            return _render_success_html(
                platform_name="LinkedIn",
                platform_icon="🔗",
                accent_color="#0A66C2",
                title="LinkedIn Connected Successfully",
                organization_name=user_name,
                message=f"Connected as {user_name}. Your LinkedIn access token is now saved and ready for feature broadcasts.",
                auto_close_seconds=4,
            )
    except Exception as e:
        logger.error(f"LinkedIn OAuth callback error: {e}")
        return _render_error_html("LinkedIn", "🔗", "#0A66C2", "Exception", str(e))

