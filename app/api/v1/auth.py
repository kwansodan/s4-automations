from typing import Dict, Any
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel, Field

from app.services.auth_service import AuthService
from app.services.audit_service import AuditService
from app.api.deps import (
    require_authenticated_user,
    enforce_otp_request_rate_limit,
    enforce_otp_verify_rate_limit,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])


class OtpRequestPayload(BaseModel):
    email: str = Field(default="s4bookkeeping@service4gh.com", description="Admin email address")


class OtpVerifyPayload(BaseModel):
    email: str = Field(default="s4bookkeeping@service4gh.com", description="Admin email address")
    otp: str = Field(description="6-digit verification code")


@router.post(
    "/otp/request",
    summary="Request 6-digit Email OTP",
    dependencies=[Depends(enforce_otp_request_rate_limit)],
)
async def request_login_otp(payload: OtpRequestPayload) -> Dict[str, Any]:
    """Generates a secure 6-digit OTP and sends it to authorized admin or team member emails."""
    result = AuthService.request_otp(payload.email)
    if not result.get("success"):
        raise HTTPException(status_code=403, detail=result.get("message"))
    return result


@router.post(
    "/otp/verify",
    summary="Verify 6-digit Email OTP",
    dependencies=[Depends(enforce_otp_verify_rate_limit)],
)
async def verify_login_otp(payload: OtpVerifyPayload) -> Dict[str, Any]:
    """Verifies the 6-digit OTP and returns a signed bearer access token."""
    result = AuthService.verify_otp(payload.email, payload.otp)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message"))
    return result


@router.get("/me", summary="Get Current Authenticated User")
async def get_current_user(user: Dict[str, Any] = Depends(require_authenticated_user)) -> Dict[str, Any]:
    """Validates the authorization bearer token and returns current user info."""
    return {"authenticated": True, "user": user}


class SwitchOrgPayload(BaseModel):
    organization_id: str = Field(description="Target organization slug identifier")


@router.post("/switch-org", summary="Switch Active Organization Context")
async def switch_active_organization(
    payload: SwitchOrgPayload,
    user: Dict[str, Any] = Depends(require_authenticated_user),
) -> Dict[str, Any]:
    """Switches the active primary organization context for the authenticated user."""
    from sqlmodel import Session, select
    from app.db.session import get_engine
    from app.models.db_models import UserOrganizationMembership, FirmTeamMember, Organization

    target_org_id = payload.organization_id.strip()
    is_sa = bool(user.get("is_platform_admin"))

    with Session(get_engine()) as session:
        target_org = session.exec(select(Organization).where(Organization.id == target_org_id)).first()
        if not target_org:
            raise HTTPException(status_code=404, detail=f"Organization '{target_org_id}' not found.")

        memberships = session.exec(
            select(UserOrganizationMembership).where(UserOrganizationMembership.user_email == user["email"])
        ).all()

        team_access = session.exec(
            select(FirmTeamMember).where(
                FirmTeamMember.email == user["email"],
                FirmTeamMember.organization_id == target_org_id,
                FirmTeamMember.status.in_(["ACTIVE", "INVITED"]),
            )
        ).first()

        has_direct_membership = any(m.organization_id == target_org_id for m in memberships)
        if not is_sa and not has_direct_membership and not team_access:
            raise HTTPException(
                status_code=403,
                detail=f"You are not authorized to access organization '{target_org_id}'.",
            )

        for m in memberships:
            m.is_primary = (m.organization_id == target_org_id)
            session.add(m)

        if not has_direct_membership:
            session.add(
                UserOrganizationMembership(
                    user_email=user["email"],
                    organization_id=target_org_id,
                    role="PLATFORM_SUPER_ADMIN" if is_sa else (team_access.role if team_access else "STAFF"),
                    title="Platform Super-Admin" if is_sa else (team_access.role if team_access else "Team Member"),
                    is_primary=True,
                )
            )

        session.commit()

    if is_sa:
        AuditService.log(
            client_id=target_org_id,
            action="ADMIN_ORG_SWITCH",
            actor_email=user["email"],
            details={"organization_id": target_org_id, "via": "switch-org"},
            source_type="admin_console",
        )

    current_org, orgs = AuthService.get_user_organizations(user["email"])
    user["organization"] = current_org
    user["organizations"] = orgs

    return {
        "success": True,
        "message": f"Switched active workspace to {current_org['name']}",
        "user": user,
    }


@router.get("/organizations", summary="List User Organizations")
async def list_user_organizations(
    user: Dict[str, Any] = Depends(require_authenticated_user),
) -> Dict[str, Any]:
    """Returns the list of organizations accessible by the authenticated user."""
    current_org, orgs = AuthService.get_user_organizations(user["email"])
    return {
        "active_organization": current_org,
        "organizations": orgs,
    }
