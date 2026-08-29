"""Authentication & Email OTP API endpoints."""

from typing import Dict, Any
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["Authentication"])


class OtpRequestPayload(BaseModel):
    email: str = Field(default="s4bookkeeping@service4gh.com", description="Admin email address")


class OtpVerifyPayload(BaseModel):
    email: str = Field(default="s4bookkeeping@service4gh.com", description="Admin email address")
    otp: str = Field(description="6-digit verification code")


@router.post("/otp/request", summary="Request 6-digit Email OTP")
async def request_login_otp(payload: OtpRequestPayload) -> Dict[str, Any]:
    """Generates a secure 6-digit OTP and sends it to s4bookkeeping@service4gh.com."""
    result = AuthService.request_otp(payload.email)
    if not result.get("success"):
        raise HTTPException(status_code=403, detail=result.get("message"))
    return result


@router.post("/otp/verify", summary="Verify 6-digit Email OTP")
async def verify_login_otp(payload: OtpVerifyPayload) -> Dict[str, Any]:
    """Verifies the 6-digit OTP and returns a signed bearer access token."""
    result = AuthService.verify_otp(payload.email, payload.otp)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message"))
    return result


@router.get("/me", summary="Get Current Authenticated User")
async def get_current_user(request: Request) -> Dict[str, Any]:
    """Validates the authorization bearer token and returns current user info."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "").strip() if auth_header.startswith("Bearer ") else ""
    user = AuthService.validate_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session token")
    return {"authenticated": True, "user": user}
