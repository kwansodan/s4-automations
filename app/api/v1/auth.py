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


class SwitchOrgPayload(BaseModel):
    organization_id: str = Field(description="Target organization slug identifier")


@router.post("/switch-org", summary="Switch Active Organization Context")
async def switch_active_organization(payload: SwitchOrgPayload, request: Request) -> Dict[str, Any]:
    """Switches the active primary organization context for the authenticated user."""
    from sqlmodel import Session, select
    from app.db.session import get_engine
    from app.models.db_models import UserOrganizationMembership, Organization

    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "").strip() if auth_header.startswith("Bearer ") else ""
    user = AuthService.validate_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session token")

    target_org_id = payload.organization_id.strip()
    with Session(get_engine()) as session:
        memberships = session.exec(
            select(UserOrganizationMembership).where(UserOrganizationMembership.user_email == user["email"])
        ).all()

        target_found = False
        for m in memberships:
            if m.organization_id == target_org_id:
                m.is_primary = True
                target_found = True
            else:
                m.is_primary = False
            session.add(m)

        # If user is admin/owner and membership record doesn't exist yet, auto-provision it
        if not target_found:
            target_org = session.exec(select(Organization).where(Organization.id == target_org_id)).first()
            if target_org:
                new_m = UserOrganizationMembership(
                    user_email=user["email"],
                    organization_id=target_org_id,
                    role="ADMIN",
                    title="Platform Administrator",
                    is_primary=True,
                )
                session.add(new_m)
                target_found = True

        if target_found:
            session.commit()

    current_org, orgs = AuthService.get_user_organizations(user["email"])
    user["organization"] = current_org
    user["organizations"] = orgs

    return {
        "success": True,
        "message": f"Switched active workspace to {current_org['name']}",
        "user": user,
    }


@router.get("/organizations", summary="List User Organizations")
async def list_user_organizations(request: Request) -> Dict[str, Any]:
    """Returns the list of organizations accessible by the authenticated user."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "").strip() if auth_header.startswith("Bearer ") else ""
    user = AuthService.validate_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session token")

    current_org, orgs = AuthService.get_user_organizations(user["email"])
    return {
        "active_organization": current_org,
        "organizations": orgs,
    }
