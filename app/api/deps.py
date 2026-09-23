"""FastAPI Security Dependencies & Guardrails for S4 Automations Engine."""

import time
from collections import defaultdict
from threading import Lock
from typing import Dict, Any, Optional
from fastapi import Request, HTTPException, status, Depends

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

async def require_admin_user(request: Request) -> Dict[str, Any]:
    """
    Enforces that the caller presents a valid HMAC-signed Bearer token
    issued to an authorized administrator.
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

    # Attach authenticated user context to request state for downstream handlers
    request.state.user = user
    return user


async def get_optional_user(request: Request) -> Optional[Dict[str, Any]]:
    """Extracts authenticated user if present, or None if anonymous."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:].strip()
    return AuthService.validate_token(token)
