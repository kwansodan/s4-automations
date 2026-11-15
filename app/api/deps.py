"""FastAPI Security Dependencies & Guardrails for S4 Automations Engine."""

import time
from collections import defaultdict
from threading import Lock
from typing import Dict, Any, Optional, Set
from fastapi import Request, HTTPException, Depends, status

from app.services.auth_service import AuthService
from app.config import settings
from app.utils.logging import get_logger

logger = get_logger("api.deps")


# -------------------------------------------------------------------------
# In-Memory Sliding-Window Rate Limiter
# -------------------------------------------------------------------------

class RateLimiter:
    """Thread-safe sliding-window rate limiter for sensitive endpoints."""

    def __init__(self, max_requests: int = 5, window_seconds: int = 300):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._history = defaultdict(list)
        self._lock = Lock()

    def check(self, key: str) -> bool:
        """Returns True if request is allowed, False if limit exceeded."""
        now = time.time()
        cutoff = now - self.window_seconds
        with self._lock:
            # Purge timestamps older than window
            valid_timestamps = [t for t in self._history[key] if t > cutoff]
            if len(valid_timestamps) >= self.max_requests:
                self._history[key] = valid_timestamps
                return False
            valid_timestamps.append(now)
            self._history[key] = valid_timestamps
            return True

    def reset(self, key: str):
        with self._lock:
            self._history.pop(key, None)


# Dedicated rate limiter instances
otp_request_limiter = RateLimiter(max_requests=5, window_seconds=300)  # max 5 OTP requests per 5 min
otp_verify_limiter = RateLimiter(max_requests=10, window_seconds=300)  # max 10 verification attempts per 5 min


def get_client_ip(request: Request) -> str:
    """Extracts client IP considering standard reverse proxy headers."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else "unknown"


def enforce_otp_request_rate_limit(request: Request):
    """Enforces rate limiting on OTP request endpoints."""
    ip = get_client_ip(request)
    if not otp_request_limiter.check(ip):
        logger.warning(f"Rate limit exceeded for OTP request from IP: {ip}")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many verification code requests. Please wait a few minutes before trying again.",
        )


def enforce_otp_verify_rate_limit(request: Request):
    """Enforces rate limiting on OTP verification attempts."""
    ip = get_client_ip(request)
    if not otp_verify_limiter.check(ip):
        logger.warning(f"Rate limit exceeded for OTP verification from IP: {ip}")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many verification attempts. Please wait a few minutes before trying again.",
        )


# -------------------------------------------------------------------------
# Authentication & Authorization Dependencies
# -------------------------------------------------------------------------

async def require_authenticated_user(request: Request) -> Dict[str, Any]:
    """
    Enforces that the caller presents a valid HMAC-signed Bearer token.
    Resolves Platform Super-Admin vs Org-Admin claims and validated impersonation header.
    """
    auth_header = request.headers.get("Authorization", "")
    token = ""
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    elif "access_token" in request.query_params:
        # Allow access_token query param for direct downloads or SSE streams
        token = request.query_params.get("access_token", "").strip()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please provide a valid Bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = AuthService.validate_token(token)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid, expired, or tampered session token. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    impersonate_org = (request.headers.get("X-Impersonate-Org-Id") or "").strip()
    if impersonate_org:
        if not user.get("is_platform_admin"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only Platform Super-Admins may inspect or impersonate another tenant workspace.",
            )
        user["impersonating_org_id"] = impersonate_org
        request.state.impersonating_org_id = impersonate_org
    else:
        request.state.impersonating_org_id = None

    request.state.user = user
    return user


async def require_org_admin(request: Request) -> Dict[str, Any]:
    """
    Enforces Organization/Firm Administrator or Workspace Operator privileges
    (Platform Super-Admin, Firm Partner, or Organization Admin).
    """
    user = await require_authenticated_user(request)
    role_lower = str(user.get("role") or "").strip().lower()
    if user.get("is_platform_admin") or user.get("is_org_admin") or role_lower in ("admin", "partner", "owner"):
        return user

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Organization Administrator or Partner privileges required.",
    )


async def require_platform_admin(request: Request) -> Dict[str, Any]:
    """Enforces strict SaaS Platform Super-Admin privileges."""
    user = await require_authenticated_user(request)
    if user.get("is_platform_admin") is True:
        return user

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Platform Super-Admin privileges required.",
    )


# Backwards-compatible alias for firm/workspace-scoped endpoints
require_admin_user = require_org_admin


async def get_optional_user(request: Request) -> Optional[Dict[str, Any]]:
    """Extracts authenticated user if present, or None if anonymous."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:].strip()
    return AuthService.validate_token(token)


# -------------------------------------------------------------------------
# Multi-Tenant Organization & Client Isolation Helpers
# -------------------------------------------------------------------------

def get_user_allowed_org_ids(user: Optional[Dict[str, Any]]) -> Set[str]:
    """Collects all organization IDs accessible to the authenticated user."""
    if not user:
        return set()
    allowed: Set[str] = set()
    for org in user.get("organizations") or []:
        if isinstance(org, dict) and org.get("id"):
            allowed.add(str(org["id"]))
    active_org = user.get("organization")
    if isinstance(active_org, dict) and active_org.get("id"):
        allowed.add(str(active_org["id"]))
    imp = user.get("impersonating_org_id")
    if imp:
        allowed.add(str(imp))
    return allowed


def verify_org_access(
    user: Optional[Dict[str, Any]],
    requested_org_id: Optional[str] = None,
) -> Optional[str]:
    """
    Resolves and authorizes the effective organization_id for the caller.
    Returns None ONLY when an unimpersonated Platform Super-Admin omits org or requests 'all'.
    Always returns a validated concrete org ID for non-super-admins (blocking cross-tenant 'all' or foreign orgs).
    """
    if not user:
        return requested_org_id

    cleaned_req = (requested_org_id or "").strip() or None
    if user.get("is_platform_admin"):
        if cleaned_req == "all":
            return None
        return cleaned_req or user.get("impersonating_org_id") or None

    allowed = get_user_allowed_org_ids(user)
    if cleaned_req and cleaned_req.lower() != "all":
        if cleaned_req not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Not authorized to access organization '{cleaned_req}'.",
            )
        return cleaned_req

    active_org = (user.get("organization") or {}).get("id")
    if active_org:
        return str(active_org)
    if allowed:
        return sorted(allowed)[0]

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="No active organization membership found for user.",
    )


def _client_matches_org(client: Any, org_id: str) -> bool:
    """Checks whether a ClientOrganization record belongs to the target organization."""
    c_org = client.organization_id or "s4_advisory"
    if org_id == "s4_advisory":
        return c_org in ("s4_advisory", "", None)
    if org_id == "anr_group_direct" and client.id == "anr_group":
        return True
    return c_org == org_id or client.id == org_id


def verify_client_access(
    db: Any,
    user: Optional[Dict[str, Any]],
    client_id: str,
    allow_missing_for_platform_admin: bool = False,
) -> Any:
    """
    Loads the ClientOrganization and verifies that the authenticated user is allowed to access it.
    Honors Platform Super-Admin impersonation boundaries and rejects cross-tenant access with 403.
    """
    from sqlmodel import select
    from app.models.db_models import ClientOrganization

    client = db.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
    if not client:
        if (
            allow_missing_for_platform_admin
            and user
            and user.get("is_platform_admin")
            and not user.get("impersonating_org_id")
        ):
            return None
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Client '{client_id}' not found.",
        )

    if not user:
        return client

    if user.get("is_platform_admin"):
        imp = user.get("impersonating_org_id")
        if imp and not _client_matches_org(client, str(imp)):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Client '{client_id}' does not belong to impersonated organization '{imp}'.",
            )
        return client

    allowed = get_user_allowed_org_ids(user)
    if any(_client_matches_org(client, org_id) for org_id in allowed):
        return client

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Not authorized to access client '{client_id}'.",
    )


def get_accessible_client_ids(
    db: Any,
    user: Optional[Dict[str, Any]],
    requested_org_id: Optional[str] = None,
) -> Optional[Set[str]]:
    """
    Returns None if the unimpersonated Platform Super-Admin can view all clients,
    or the exact Set of permitted ClientOrganization.id values for the resolved org scope.
    """
    from sqlmodel import select
    from app.models.db_models import ClientOrganization

    effective_org = verify_org_access(user, requested_org_id)
    if effective_org is None:
        return None

    clients = db.exec(select(ClientOrganization)).all()
    return {c.id for c in clients if _client_matches_org(c, effective_org)}


async def enforce_tenant_request_scope(
    request: Request,
    current_user: Dict[str, Any] = Depends(require_org_admin),
) -> Dict[str, Any]:
    """
    Router-level dependency that automatically enforces tenant/client boundaries
    whenever 'organization_id', 'client_id', or 'tx_id' appears in path or query parameters.
    """
    from sqlmodel import Session
    from app.db.session import get_engine
    from app.models.db_models import BankTransaction

    path_params = getattr(request, "path_params", {}) or {}
    query_params = request.query_params

    req_org = path_params.get("organization_id") or query_params.get("organization_id")
    if req_org:
        verify_org_access(current_user, req_org)

    req_client = path_params.get("client_id") or query_params.get("client_id")
    req_tx = path_params.get("tx_id")

    if (req_client and str(req_client).upper() != "ALL") or req_tx:
        with Session(get_engine()) as db:
            if req_client and str(req_client).upper() != "ALL":
                verify_client_access(
                    db,
                    current_user,
                    str(req_client),
                    allow_missing_for_platform_admin=True,
                )
            if req_tx:
                try:
                    tx_int = int(req_tx)
                except ValueError:
                    tx_int = None
                if tx_int is not None:
                    btx = db.get(BankTransaction, tx_int)
                    if btx and btx.client_id:
                        verify_client_access(
                            db,
                            current_user,
                            btx.client_id,
                            allow_missing_for_platform_admin=True,
                        )

    return current_user

