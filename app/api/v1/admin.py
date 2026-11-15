"""Platform Super-Admin SaaS Operations Console API (/api/v1/admin)."""

import csv
import io
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from sqlmodel import Session, desc, func, or_, select

from app.api.deps import require_platform_admin
from app.config import settings
from app.db.session import get_db_session
from app.models.db_models import (
    AgentExecutionRun,
    AgentMessage,
    ApiKeyUsageLog,
    AuditLog,
    ClientOrganization,
    CustomerPaymentRecord,
    FirmTeamMember,
    LandingPageConfig,
    Organization,
    PlatformAdminUser,
    PlatformPricingConfig,
    StagedTransaction,
    UserOrganizationMembership,
    get_utc_now,
)
from app.services.agent_comms_service import AgentCommsService
from app.services.audit_service import AuditService
from app.services.telemetry_service import USD_TO_GHS_RATE, get_cost_summary
from app.utils.logging import get_logger

logger = get_logger("api.admin")
router = APIRouter(prefix="/admin", tags=["Platform Super-Admin Console"])


# -------------------------------------------------------------------------
# Request Schemas
# -------------------------------------------------------------------------

class CreateOrganizationPayload(BaseModel):
    id: Optional[str] = Field(default=None, description="Optional custom URL slug")
    name: str = Field(..., min_length=2, description="Tenant organization display name")
    org_type: str = Field(default="ACCOUNTING_FIRM", description="ACCOUNTING_FIRM or INDIVIDUAL_BUSINESS")
    plan_tier: str = Field(default="pro", description="starter, pro, scale, enterprise")
    max_clients: int = Field(default=15, ge=1)
    industry: Optional[str] = Field(default="Accounting & Advisory")
    icon: str = Field(default="🏛️")
    subscription_status: str = Field(default="TRIALING", description="ACTIVE, TRIALING, PAST_DUE, SUSPENDED")
    billing_cycle: str = Field(default="MONTHLY")
    currency: str = Field(default="GHS")
    base_price: float = Field(default=2800.0, ge=0.0)
    monthly_document_allowance: int = Field(default=3000, ge=0)
    trial_days: int = Field(default=14, ge=1, le=90)
    trial_document_quota: int = Field(default=50, ge=0)
    storage_strategy: str = Field(default="platform_managed", description="platform_managed, byos_google, byos_onedrive")
    byos_folder_id: Optional[str] = None
    white_label_logo_url: Optional[str] = None
    custom_portal_subdomain: Optional[str] = None
    billing_contact_name: Optional[str] = None
    billing_contact_email: Optional[str] = None
    billing_contact_phone: Optional[str] = None
    primary_admin_email: Optional[str] = None
    billing_notes: Optional[str] = None


class UpdateOrganizationSettingsPayload(BaseModel):
    name: Optional[str] = None
    org_type: Optional[str] = None
    industry: Optional[str] = None
    icon: Optional[str] = None
    max_clients: Optional[int] = Field(default=None, ge=1)
    white_label_logo_url: Optional[str] = None
    custom_portal_subdomain: Optional[str] = None
    contact_email: Optional[str] = None
    storage_strategy: Optional[str] = None
    byos_folder_id: Optional[str] = None
    billing_contact_name: Optional[str] = None
    billing_contact_email: Optional[str] = None
    billing_contact_phone: Optional[str] = None
    billing_notes: Optional[str] = None


class UpdateOrganizationStatusPayload(BaseModel):
    is_active: bool
    subscription_status: str = Field(description="ACTIVE, TRIALING, PAST_DUE, GRACE_PERIOD, SUSPENDED, CANCELED")
    reason: str = Field(default="Operator status update", min_length=2)


class ImpersonateTenantPayload(BaseModel):
    organization_id: str
    reason: Optional[str] = Field(default="Support and configuration inspection")


class AddPlatformAdminPayload(BaseModel):
    email: str = Field(..., min_length=3)
    name: str = Field(default="Platform Super-Admin")
    notes: Optional[str] = None


class UpdatePlatformAdminPayload(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class UpdateMembershipRolePayload(BaseModel):
    role: str = Field(..., description="OWNER, ADMIN, PARTNER, SENIOR_ACCOUNTANT, STAFF, AUDITOR")
    title: Optional[str] = None
    is_primary: Optional[bool] = None


# -------------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------------

def _slugify_org_id(name: str, explicit_id: Optional[str] = None) -> str:
    raw = (explicit_id or name or "tenant").strip().lower()
    slug = re.sub(r"[^a-z0-9_]+", "_", raw.replace("-", "_").replace(" ", "_")).strip("_")
    return slug or f"org_{int(get_utc_now().timestamp())}"


def _resolve_plan_defaults(db: Session, plan_tier: str) -> Dict[str, Any]:
    cfg = db.exec(select(PlatformPricingConfig).where(PlatformPricingConfig.id == 1)).first()
    tiers = (cfg.tiers if cfg else None) or []
    for t in tiers:
        if t.get("tier_id") == plan_tier:
            return t
    return {}


# -------------------------------------------------------------------------
# 1. Executive Overview & Infrastructure Readiness
# -------------------------------------------------------------------------

@router.get("/overview", summary="Platform Super-Admin Executive Cockpit")
async def get_admin_overview(
    db: Session = Depends(get_db_session),
    admin_user: Dict[str, Any] = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Aggregates multi-tenant SaaS revenue, tenant counts, agent fleet 24h runs, infrastructure readiness, and security audits."""
    now = get_utc_now()
    since_24h = now - timedelta(hours=24)

    orgs = db.exec(select(Organization)).all()
    clients = db.exec(select(ClientOrganization)).all()
    pricing_cfg = db.exec(select(PlatformPricingConfig).where(PlatformPricingConfig.id == 1)).first()
    fx_rate = (pricing_cfg.usd_to_ghs_rate if pricing_cfg else None) or USD_TO_GHS_RATE

    active_orgs = 0
    trialing_orgs = 0
    suspended_orgs = 0
    past_due_orgs = 0
    total_mrr_ghs = 0.0

    for o in orgs:
        st = (o.subscription_status or "ACTIVE").upper()
        if not o.is_active or st == "SUSPENDED":
            suspended_orgs += 1
        elif st == "ACTIVE":
            active_orgs += 1
            base = float(o.base_price or 0.0)
            total_mrr_ghs += base * fx_rate if (o.currency or "GHS") == "USD" else base
        elif st == "TRIALING":
            trialing_orgs += 1
        elif st in ("PAST_DUE", "GRACE_PERIOD"):
            past_due_orgs += 1

    cost_30d = get_cost_summary(db, days=30)
    infra_cost_ghs = float(cost_30d.get("total_cost_ghs", 0.0))
    gross_profit_ghs = max(0.0, total_mrr_ghs - infra_cost_ghs)
    margin_pct = round((gross_profit_ghs / total_mrr_ghs * 100), 1) if total_mrr_ghs > 0 else 100.0

    runs_24h = db.exec(
        select(AgentExecutionRun).where(AgentExecutionRun.started_at >= since_24h)
    ).all()
    failed_runs_24h = sum(1 for r in runs_24h if (r.status or "").upper() == "FAILED")
    awaiting_human_24h = sum(1 for r in runs_24h if (r.status or "").upper() == "AWAITING_HUMAN")

    msgs_24h_count = db.exec(
        select(func.count(AgentMessage.id)).where(AgentMessage.created_at >= since_24h)
    ).one()

    total_slips = db.exec(select(func.count(StagedTransaction.id))).one()
    pending_payments = db.exec(
        select(func.count(CustomerPaymentRecord.id)).where(
            CustomerPaymentRecord.payment_status.in_(["OVERDUE", "PENDING_VERIFICATION"])
        )
    ).one()

    recent_audits = db.exec(
        select(AuditLog).order_by(desc(AuditLog.created_at)).limit(8)
    ).all()

    landing_cfg = db.exec(select(LandingPageConfig).where(LandingPageConfig.id == 1)).first()
    maintenance_mode = (landing_cfg.mode == "maintenance") if landing_cfg else False

    total_agents = sum(len(AgentCommsService.sync_client_agents_list(c)) for c in clients)

    subsystems = {
        "database": {"status": "HEALTHY", "detail": "Connected via active SQLModel session"},
        "gemini_vision": {
            "status": "CONFIGURED" if bool(settings.GEMINI_API_KEY) else ("MOCK" if settings.MOCK_MODE else "MISSING"),
            "detail": f"Model: {settings.GEMINI_MODEL}",
        },
        "zoho_books": {
            "status": "CONFIGURED" if bool(settings.ZOHO_CLIENT_ID and settings.ZOHO_REFRESH_TOKEN) else ("MOCK" if settings.MOCK_MODE else "PARTIAL"),
            "detail": settings.ZOHO_BOOKS_API_URL,
        },
        "mailjet_email": {
            "status": "CONFIGURED" if bool(settings.MAILJET_API_KEY and settings.MAILJET_SECRET_KEY) else "UNCONFIGURED",
            "detail": f"Sender: {settings.MAILJET_FROM_EMAIL} | Domain: {settings.AGENT_EMAIL_DOMAIN}",
        },
        "whatsapp_gateway": {
            "status": "CONFIGURED" if bool(settings.WHATSAPP_PHONE_NUMBER_ID and settings.WHATSAPP_ACCESS_TOKEN) else "UNCONFIGURED",
            "detail": f"Platform Number: +{settings.WHATSAPP_PLATFORM_NUMBER}",
        },
        "inngest_workers": {
            "status": "CONFIGURED" if bool(settings.INNGEST_EVENT_KEY) else "UNCONFIGURED",
            "detail": f"App ID: {settings.INNGEST_APP_ID}",
        },
    }

    return {
        "operator_email": admin_user.get("email"),
        "maintenance_mode": maintenance_mode,
        "revenue": {
            "mrr_ghs": round(total_mrr_ghs, 2),
            "arr_ghs": round(total_mrr_ghs * 12, 2),
            "infra_cost_30d_ghs": infra_cost_ghs,
            "gross_profit_margin_percent": margin_pct,
            "pending_or_overdue_payments": pending_payments,
        },
        "tenants": {
            "total_organizations": len(orgs),
            "active_organizations": active_orgs,
            "trialing_organizations": trialing_orgs,
            "suspended_organizations": suspended_orgs,
            "past_due_organizations": past_due_orgs,
            "total_client_workspaces": len(clients),
            "total_staged_transactions": total_slips,
        },
        "agent_fleet": {
            "total_agents": total_agents,
            "runs_24h": len(runs_24h),
            "failed_runs_24h": failed_runs_24h,
            "awaiting_human_24h": awaiting_human_24h,
            "messages_24h": msgs_24h_count,
        },
        "subsystems": subsystems,
        "recent_audits": jsonable_encoder(recent_audits),
    }


# -------------------------------------------------------------------------
# 2. Tenant Organizations Lifecycle & White-Label / BYOS Management
# -------------------------------------------------------------------------

@router.post("/organizations", summary="Provision a New Tenant Organization")
async def create_tenant_organization(
    payload: CreateOrganizationPayload,
    db: Session = Depends(get_db_session),
    admin_user: Dict[str, Any] = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Creates a new Accounting Firm or Individual Business tenant with billing quota, optional trial window, and primary admin membership."""
    slug = _slugify_org_id(payload.name, payload.id)
    existing = db.exec(select(Organization).where(Organization.id == slug)).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Organization '{slug}' already exists.",
        )

    now = get_utc_now()
    tier_defaults = _resolve_plan_defaults(db, payload.plan_tier)
    sub_status = payload.subscription_status.upper()
    storage_creds = {"google_drive_root_folder_id": payload.byos_folder_id} if payload.byos_folder_id else {}

    org = Organization(
        id=slug,
        name=payload.name.strip(),
        org_type=payload.org_type.upper(),
        plan_tier=payload.plan_tier,
        max_clients=payload.max_clients or tier_defaults.get("max_clients", 15),
        industry=payload.industry or "Accounting & Advisory",
        icon=payload.icon or "🏛️",
        white_label_logo_url=payload.white_label_logo_url,
        custom_portal_subdomain=payload.custom_portal_subdomain,
        contact_email=payload.billing_contact_email or payload.primary_admin_email,
        storage_strategy=payload.storage_strategy or "platform_managed",
        storage_credentials=storage_creds,
        subscription_status=sub_status,
        billing_cycle=payload.billing_cycle.upper(),
        currency=payload.currency.upper(),
        base_price=payload.base_price if payload.base_price is not None else float(tier_defaults.get("price_ghs", 2800.0)),
        current_period_start=now,
        current_period_end=now + timedelta(days=365 if payload.billing_cycle.upper() == "ANNUALLY" else 30),
        trial_start_at=now if sub_status == "TRIALING" else None,
        trial_ends_at=(now + timedelta(days=payload.trial_days)) if sub_status == "TRIALING" else None,
        trial_document_quota=payload.trial_document_quota,
        monthly_document_allowance=payload.monthly_document_allowance or tier_defaults.get("document_allowance", 3000),
        overage_rate_per_doc=float(tier_defaults.get("overage_rate_ghs", 0.90)),
        billing_contact_name=payload.billing_contact_name,
        billing_contact_email=payload.billing_contact_email,
        billing_contact_phone=payload.billing_contact_phone,
        billing_notes=payload.billing_notes,
        is_active=(sub_status != "SUSPENDED"),
        created_at=now,
        updated_at=now,
    )
    db.add(org)

    if payload.primary_admin_email and payload.primary_admin_email.strip():
        admin_email = payload.primary_admin_email.strip().lower()
        db.add(
            UserOrganizationMembership(
                user_email=admin_email,
                organization_id=slug,
                role="OWNER",
                title="Managing Partner",
                is_primary=True,
            )
        )
        existing_ftm = db.exec(
            select(FirmTeamMember).where(
                FirmTeamMember.organization_id == slug,
                FirmTeamMember.email == admin_email,
            )
        ).first()
        if not existing_ftm:
            db.add(
                FirmTeamMember(
                    organization_id=slug,
                    name=payload.billing_contact_name or "Organization Admin",
                    email=admin_email,
                    phone=payload.billing_contact_phone or "",
                    role="PARTNER",
                    status="INVITED",
                    assigned_client_ids=["*"],
                    permissions={
                        "can_query_clients": True,
                        "can_categorize": True,
                        "can_sync_accounting": True,
                        "can_manage_clients": True,
                    },
                )
            )

    db.commit()
    db.refresh(org)

    AuditService.log(
        client_id=slug,
        action="ADMIN_ORG_CREATED",
        actor_email=admin_user["email"],
        details={
            "organization_id": slug,
            "name": org.name,
            "plan_tier": org.plan_tier,
            "subscription_status": org.subscription_status,
        },
        source_type="admin_console",
    )

    return {"success": True, "message": f"Provisioned tenant '{org.name}'.", "organization": jsonable_encoder(org)}


@router.get("/organizations/{org_id}", summary="Get Comprehensive Tenant Organization Dossier")
async def get_tenant_organization_detail(
    org_id: str,
    db: Session = Depends(get_db_session),
    _admin_user: Dict[str, Any] = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Returns full tenant organization configuration, child client workspaces, team members, payments, and 30d cost attribution."""
    org = db.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail=f"Organization '{org_id}' not found.")

    clients = db.exec(select(ClientOrganization).where(ClientOrganization.organization_id == org_id)).all()
    if org_id == "s4_advisory":
        legacy_clients = db.exec(
            select(ClientOrganization).where(
                (ClientOrganization.organization_id == None) | (ClientOrganization.organization_id == "")
            )
        ).all()
        seen_c = {c.id for c in clients}
        for lc in legacy_clients:
            if lc.id not in seen_c:
                clients.append(lc)

    memberships = db.exec(
        select(UserOrganizationMembership).where(UserOrganizationMembership.organization_id == org_id)
    ).all()
    firm_members = db.exec(
        select(FirmTeamMember).where(FirmTeamMember.organization_id == org_id)
    ).all()
    payments = db.exec(
        select(CustomerPaymentRecord)
        .where(CustomerPaymentRecord.organization_id == org_id)
        .order_by(desc(CustomerPaymentRecord.created_at))
        .limit(20)
    ).all()

    since_30d = get_utc_now() - timedelta(days=30)
    client_ids = [c.id for c in clients]
    usage_rows = db.exec(
        select(ApiKeyUsageLog).where(
            ApiKeyUsageLog.created_at >= since_30d,
            or_(
                ApiKeyUsageLog.organization_id == org_id,
                ApiKeyUsageLog.client_id.in_(client_ids) if client_ids else False,
            ),
        )
    ).all()
    usage_cost_ghs = round(sum(float(u.estimated_cost_ghs or 0.0) for u in usage_rows), 2)
    usage_tokens = sum(int(u.total_tokens or 0) for u in usage_rows)

    recent_audits = db.exec(
        select(AuditLog)
        .where(AuditLog.client_id.in_(client_ids + [org_id, "platform"]))
        .order_by(desc(AuditLog.created_at))
        .limit(25)
    ).all()

    return {
        "organization": jsonable_encoder(org),
        "clients": [
            {
                "id": c.id,
                "name": c.name,
                "status": c.status,
                "accounting_software": c.accounting_software,
                "source_type": c.source_type,
                "agents_count": len(c.agents or c.pipelines or []),
                "last_run_at": c.last_run_at.isoformat() if c.last_run_at else None,
            }
            for c in clients
        ],
        "members_count": max(len(memberships), len(firm_members)),
        "memberships": jsonable_encoder(memberships),
        "firm_members": jsonable_encoder(firm_members),
        "payments": jsonable_encoder(payments),
        "telemetry_30d": {
            "api_calls": len(usage_rows),
            "total_tokens": usage_tokens,
            "cost_ghs": usage_cost_ghs,
        },
        "recent_audits": jsonable_encoder(recent_audits),
    }


@router.patch("/organizations/{org_id}/settings", summary="Update Tenant White-Label, BYOS & Capacity")
async def update_tenant_organization_settings(
    org_id: str,
    payload: UpdateOrganizationSettingsPayload,
    db: Session = Depends(get_db_session),
    admin_user: Dict[str, Any] = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Updates organization branding, subdomain, BYOS strategy, and client quota caps."""
    org = db.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail=f"Organization '{org_id}' not found.")

    updates = payload.model_dump(exclude_unset=True)
    byos_folder = updates.pop("byos_folder_id", None)
    for field, value in updates.items():
        if hasattr(org, field) and value is not None:
            setattr(org, field, value)

    if byos_folder is not None:
        creds = dict(org.storage_credentials or {})
        creds["google_drive_root_folder_id"] = byos_folder.strip()
        org.storage_credentials = creds

    org.updated_at = get_utc_now()
    db.add(org)
    db.commit()
    db.refresh(org)

    AuditService.log(
        client_id=org_id,
        action="ADMIN_ORG_SETTINGS_UPDATED",
        actor_email=admin_user["email"],
        details={"organization_id": org_id, "updated_fields": sorted(payload.model_dump(exclude_unset=True).keys())},
        source_type="admin_console",
    )

    return {"success": True, "message": "Tenant organization settings updated.", "organization": jsonable_encoder(org)}


@router.patch("/organizations/{org_id}/status", summary="Suspend or Reactivate a Tenant Organization")
async def update_tenant_organization_status(
    org_id: str,
    payload: UpdateOrganizationStatusPayload,
    db: Session = Depends(get_db_session),
    admin_user: Dict[str, Any] = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Suspends or reactivates an organization with mandatory reason logged to AuditLog."""
    if org_id == "s4_advisory" and not payload.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot suspend the root platform advisory organization ('s4_advisory').",
        )

    org = db.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail=f"Organization '{org_id}' not found.")

    prev_status = org.subscription_status
    prev_active = org.is_active
    org.is_active = bool(payload.is_active)
    org.subscription_status = payload.subscription_status.upper()
    org.updated_at = get_utc_now()
    db.add(org)
    db.commit()
    db.refresh(org)

    AuditService.log(
        client_id=org_id,
        action="ADMIN_ORG_SUSPEND" if not payload.is_active else "ADMIN_ORG_REACTIVATE",
        actor_email=admin_user["email"],
        details={
            "organization_id": org_id,
            "previous_status": prev_status,
            "previous_is_active": prev_active,
            "new_status": org.subscription_status,
            "new_is_active": org.is_active,
            "reason": payload.reason,
        },
        source_type="admin_console",
    )

    return {
        "success": True,
        "message": f"Organization '{org.name}' is now {'ACTIVE' if org.is_active else 'SUSPENDED'} ({org.subscription_status}).",
        "organization": jsonable_encoder(org),
    }


# -------------------------------------------------------------------------
# 3. Audited View-as-Tenant Impersonation
# -------------------------------------------------------------------------

@router.post("/impersonate", summary="Begin Audited View-as-Tenant Inspection")
async def start_tenant_impersonation(
    payload: ImpersonateTenantPayload,
    db: Session = Depends(get_db_session),
    admin_user: Dict[str, Any] = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Starts an audited View-as-Tenant session for a Platform Super-Admin."""
    org = db.exec(select(Organization).where(Organization.id == payload.organization_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail=f"Organization '{payload.organization_id}' not found.")

    AuditService.log(
        client_id=org.id,
        action="ADMIN_IMPERSONATE_START",
        actor_email=admin_user["email"],
        details={"organization_id": org.id, "organization_name": org.name, "reason": payload.reason},
        source_type="admin_console",
    )

    return {
        "success": True,
        "impersonating_org": {
            "id": org.id,
            "name": org.name,
            "org_type": org.org_type,
            "subscription_status": org.subscription_status,
        },
        "message": f"Audited inspection active for {org.name}.",
    }


@router.post("/impersonate/exit", summary="End Audited View-as-Tenant Inspection")
async def exit_tenant_impersonation(
    payload: Optional[ImpersonateTenantPayload] = None,
    admin_user: Dict[str, Any] = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Records termination of an audited View-as-Tenant session."""
    target_org = (payload.organization_id if payload else None) or admin_user.get("impersonating_org_id") or "platform"
    AuditService.log(
        client_id=target_org,
        action="ADMIN_IMPERSONATE_END",
        actor_email=admin_user["email"],
        details={"organization_id": target_org},
        source_type="admin_console",
    )
    return {"success": True, "message": "Returned to Platform Super-Admin session."}


# -------------------------------------------------------------------------
# 4. Super-Admins Allowlist & Cross-Tenant User RBAC Directory
# -------------------------------------------------------------------------

@router.get("/super-admins", summary="List Platform Super-Admins")
async def list_platform_super_admins(
    db: Session = Depends(get_db_session),
    _admin_user: Dict[str, Any] = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Returns database PlatformAdminUser records alongside environment-pinned root allowlist emails."""
    env_emails = set(settings.get_platform_admin_emails())
    root_email = (settings.AUTH_EMAIL or "").strip().lower()
    rows = db.exec(select(PlatformAdminUser).order_by(PlatformAdminUser.created_at)).all()
    row_emails = {r.email.lower() for r in rows}

    admins = [
        {
            "id": r.id,
            "email": r.email,
            "name": r.name,
            "is_active": r.is_active,
            "is_root": r.is_root or (r.email.lower() == root_email),
            "pinned_in_env": r.email.lower() in env_emails,
            "notes": r.notes,
            "added_by": r.added_by,
            "last_login_at": r.last_login_at.isoformat() if r.last_login_at else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]

    for env_email in sorted(env_emails):
        if env_email not in row_emails:
            admins.append({
                "id": None,
                "email": env_email,
                "name": "Environment Pinned Operator",
                "is_active": True,
                "is_root": (env_email == root_email),
                "pinned_in_env": True,
                "notes": "Configured via AUTH_EMAIL or PLATFORM_ADMIN_EMAILS environment variable",
                "added_by": "env",
                "last_login_at": None,
                "created_at": None,
            })

    return {"super_admins": admins, "total_count": len(admins)}


@router.post("/super-admins", summary="Grant Platform Super-Admin Access")
async def add_platform_super_admin(
    payload: AddPlatformAdminPayload,
    db: Session = Depends(get_db_session),
    admin_user: Dict[str, Any] = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Grants Platform Super-Admin privileges to an email address."""
    cleaned_email = payload.email.strip().lower()
    if "@" not in cleaned_email:
        raise HTTPException(status_code=400, detail="Valid email address required.")

    existing = db.exec(select(PlatformAdminUser).where(PlatformAdminUser.email == cleaned_email)).first()
    if existing:
        existing.is_active = True
        existing.name = payload.name.strip() or existing.name
        if payload.notes is not None:
            existing.notes = payload.notes
        existing.updated_at = get_utc_now()
        db.add(existing)
        db.commit()
        db.refresh(existing)
        record = existing
    else:
        record = PlatformAdminUser(
            email=cleaned_email,
            name=payload.name.strip() or "Platform Super-Admin",
            is_active=True,
            is_root=False,
            notes=payload.notes,
            added_by=admin_user["email"],
        )
        db.add(record)
        db.commit()
        db.refresh(record)

    AuditService.log(
        client_id="platform",
        action="ADMIN_SUPERADMIN_GRANTED",
        actor_email=admin_user["email"],
        details={"target_email": cleaned_email, "name": record.name},
        source_type="admin_console",
    )
    return {"success": True, "super_admin": jsonable_encoder(record)}


@router.delete("/super-admins/{admin_id}", summary="Revoke Platform Super-Admin Access")
async def revoke_platform_super_admin(
    admin_id: int,
    db: Session = Depends(get_db_session),
    admin_user: Dict[str, Any] = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Revokes database Super-Admin access with root/last-admin safety protection."""
    record = db.get(PlatformAdminUser, admin_id)
    if not record:
        raise HTTPException(status_code=404, detail="Super-Admin record not found.")

    root_email = (settings.AUTH_EMAIL or "").strip().lower()
    if record.is_root or record.email.lower() == root_email:
        raise HTTPException(
            status_code=400,
            detail="Cannot revoke the root AUTH_EMAIL Platform Administrator.",
        )

    active_rows = db.exec(select(PlatformAdminUser).where(PlatformAdminUser.is_active == True)).all()
    env_pinned = set(settings.get_platform_admin_emails())
    if len(active_rows) <= 1 and len(env_pinned) <= 1:
        raise HTTPException(
            status_code=400,
            detail="Cannot revoke the last remaining active Platform Super-Admin.",
        )

    target_email = record.email
    db.delete(record)
    db.commit()

    AuditService.log(
        client_id="platform",
        action="ADMIN_SUPERADMIN_REVOKED",
        actor_email=admin_user["email"],
        details={"target_email": target_email},
        source_type="admin_console",
    )
    return {"success": True, "message": f"Revoked Super-Admin access for {target_email}."}


@router.get("/users", summary="Cross-Tenant User & Organization Membership Directory")
async def list_cross_tenant_users(
    organization_id: Optional[str] = None,
    role: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db_session),
    _admin_user: Dict[str, Any] = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Aggregates UserOrganizationMembership and FirmTeamMember entries across all tenants."""
    orgs = {o.id: o.name for o in db.exec(select(Organization)).all()}
    m_stmt = select(UserOrganizationMembership)
    if organization_id and organization_id != "ALL":
        m_stmt = m_stmt.where(UserOrganizationMembership.organization_id == organization_id)
    memberships = db.exec(m_stmt.order_by(desc(UserOrganizationMembership.created_at))).all()

    f_stmt = select(FirmTeamMember)
    if organization_id and organization_id != "ALL":
        f_stmt = f_stmt.where(FirmTeamMember.organization_id == organization_id)
    firm_members = db.exec(f_stmt.order_by(desc(FirmTeamMember.created_at))).all()
    firm_by_key = {(f.email.lower(), f.organization_id): f for f in firm_members}

    users_out: List[Dict[str, Any]] = []
    seen_pairs = set()

    for m in memberships:
        key = (m.user_email.lower(), m.organization_id)
        seen_pairs.add(key)
        ftm = firm_by_key.get(key)
        users_out.append({
            "membership_id": m.id,
            "firm_member_id": ftm.id if ftm else None,
            "email": m.user_email,
            "name": ftm.name if ftm else (m.title or "Organization User"),
            "organization_id": m.organization_id,
            "organization_name": orgs.get(m.organization_id, m.organization_id),
            "role": m.role,
            "title": m.title,
            "status": ftm.status if ftm else "ACTIVE",
            "is_primary": m.is_primary,
            "last_login_at": ftm.last_login_at.isoformat() if (ftm and ftm.last_login_at) else None,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        })

    for ftm in firm_members:
        key = (ftm.email.lower(), ftm.organization_id)
        if key in seen_pairs:
            continue
        users_out.append({
            "membership_id": None,
            "firm_member_id": ftm.id,
            "email": ftm.email,
            "name": ftm.name,
            "organization_id": ftm.organization_id,
            "organization_name": orgs.get(ftm.organization_id, ftm.organization_id),
            "role": ftm.role,
            "title": ftm.role,
            "status": ftm.status,
            "is_primary": False,
            "last_login_at": ftm.last_login_at.isoformat() if ftm.last_login_at else None,
            "created_at": ftm.created_at.isoformat() if ftm.created_at else None,
        })

    if role and role != "ALL":
        users_out = [u for u in users_out if (u.get("role") or "").upper() == role.upper()]
    if search and search.strip():
        q = search.strip().lower()
        users_out = [
            u for u in users_out
            if q in (u.get("email") or "").lower()
            or q in (u.get("name") or "").lower()
            or q in (u.get("organization_name") or "").lower()
        ]

    return {"users": users_out, "total_count": len(users_out)}


@router.patch("/memberships/{membership_id}", summary="Update Organization Membership Role")
async def update_user_membership_role(
    membership_id: int,
    payload: UpdateMembershipRolePayload,
    db: Session = Depends(get_db_session),
    admin_user: Dict[str, Any] = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Updates an organization member's RBAC role and records an immutable audit event."""
    m = db.get(UserOrganizationMembership, membership_id)
    if not m:
        raise HTTPException(status_code=404, detail="Membership record not found.")

    old_role = m.role
    m.role = payload.role.upper()
    if payload.title is not None:
        m.title = payload.title
    if payload.is_primary is not None:
        m.is_primary = payload.is_primary
    db.add(m)
    db.commit()
    db.refresh(m)

    AuditService.log(
        client_id=m.organization_id,
        action="ADMIN_MEMBERSHIP_UPDATED",
        actor_email=admin_user["email"],
        details={
            "membership_id": m.id,
            "user_email": m.user_email,
            "organization_id": m.organization_id,
            "old_role": old_role,
            "new_role": m.role,
        },
        source_type="admin_console",
    )
    return {"success": True, "membership": jsonable_encoder(m)}


# -------------------------------------------------------------------------
# 5. Global AI Agent Fleet, ReAct Run Traces & Gateway Diagnostics
# -------------------------------------------------------------------------

@router.get("/agent-fleet", summary="Cross-Tenant Autonomous Agent Fleet Directory")
async def get_global_agent_fleet(
    client_id: Optional[str] = None,
    organization_id: Optional[str] = None,
    db: Session = Depends(get_db_session),
    _admin_user: Dict[str, Any] = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Lists all provisioned accounting agents across all client organizations enriched with 7d run telemetry."""
    AgentCommsService.ensure_table(db)
    orgs = {o.id: o.name for o in db.exec(select(Organization)).all()}

    stmt = select(ClientOrganization)
    if client_id and client_id != "ALL":
        stmt = stmt.where(ClientOrganization.id == client_id)
    if organization_id and organization_id != "ALL":
        stmt = stmt.where(ClientOrganization.organization_id == organization_id)

    clients = db.exec(stmt).all()
    since_7d = get_utc_now() - timedelta(days=7)
    runs_7d = db.exec(
        select(AgentExecutionRun)
        .where(AgentExecutionRun.started_at >= since_7d)
        .order_by(desc(AgentExecutionRun.started_at))
    ).all()

    runs_by_agent: Dict[tuple, List[AgentExecutionRun]] = {}
    for r in runs_7d:
        runs_by_agent.setdefault((r.client_id, r.agent_id), []).append(r)

    fleet: List[Dict[str, Any]] = []
    for c in clients:
        org_id = c.organization_id or "s4_advisory"
        synced = AgentCommsService.sync_client_agents_list(c)
        for ag in synced:
            ag_id = ag.get("id")
            ag_runs = runs_by_agent.get((c.id, ag_id), [])
            latest = ag_runs[0] if ag_runs else None
            fleet.append({
                **ag,
                "client_id": c.id,
                "client_name": c.name,
                "organization_id": org_id,
                "organization_name": orgs.get(org_id, org_id),
                "runs_7d": len(ag_runs),
                "failed_7d": sum(1 for r in ag_runs if (r.status or "").upper() == "FAILED"),
                "latest_run_status": latest.status if latest else None,
                "latest_run_at": latest.started_at.isoformat() if (latest and latest.started_at) else None,
                "latest_run_id": latest.run_id if latest else None,
            })

    return {"total_agents": len(fleet), "agents": fleet}


@router.get("/agent-runs", summary="Cross-Tenant AgentExecutionRun Explorer")
async def list_global_agent_runs(
    client_id: Optional[str] = None,
    status_filter: Optional[str] = None,
    trigger_type: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db_session),
    _admin_user: Dict[str, Any] = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Queries cross-tenant autonomous ReAct execution runs with full reasoning step traces."""
    stmt = select(AgentExecutionRun)
    count_stmt = select(func.count(AgentExecutionRun.id))

    if client_id and client_id != "ALL":
        stmt = stmt.where(AgentExecutionRun.client_id == client_id)
        count_stmt = count_stmt.where(AgentExecutionRun.client_id == client_id)
    if status_filter and status_filter != "ALL":
        stmt = stmt.where(AgentExecutionRun.status == status_filter)
        count_stmt = count_stmt.where(AgentExecutionRun.status == status_filter)
    if trigger_type and trigger_type != "ALL":
        stmt = stmt.where(AgentExecutionRun.trigger_type == trigger_type)
        count_stmt = count_stmt.where(AgentExecutionRun.trigger_type == trigger_type)

    stmt = stmt.order_by(desc(AgentExecutionRun.started_at)).offset(offset).limit(limit)
    runs = db.exec(stmt).all()
    total = db.exec(count_stmt).one()

    return {"runs": jsonable_encoder(runs), "total_count": total}


@router.get("/agent-messages", summary="Cross-Tenant Multi-Channel Message Log")
async def list_global_agent_messages(
    channel: Optional[str] = None,
    direction: Optional[str] = None,
    client_id: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db_session),
    _admin_user: Dict[str, Any] = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Returns cross-tenant Email, WhatsApp, and In-App agent messages for gateway debugging."""
    AgentCommsService.ensure_table(db)
    stmt = select(AgentMessage)
    if channel and channel != "ALL":
        stmt = stmt.where(AgentMessage.channel == channel.upper())
    if direction and direction != "ALL":
        stmt = stmt.where(AgentMessage.direction == direction.upper())
    if client_id and client_id != "ALL":
        stmt = stmt.where(AgentMessage.client_id == client_id)

    rows = db.exec(stmt.order_by(desc(AgentMessage.created_at)).limit(limit)).all()
    return {"messages": jsonable_encoder(rows), "total_count": len(rows)}


@router.get("/gateway-health", summary="Inbound Email and WhatsApp Webhook Gateway Readiness")
async def get_gateway_health(
    db: Session = Depends(get_db_session),
    _admin_user: Dict[str, Any] = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Checks gateway env readiness, webhook URLs, and latest inbound messages."""
    AgentCommsService.ensure_table(db)
    latest_email = db.exec(
        select(AgentMessage)
        .where(AgentMessage.channel == "EMAIL", AgentMessage.direction == "INBOUND")
        .order_by(desc(AgentMessage.created_at))
        .limit(1)
    ).first()
    latest_whatsapp = db.exec(
        select(AgentMessage)
        .where(AgentMessage.channel == "WHATSAPP", AgentMessage.direction == "INBOUND")
        .order_by(desc(AgentMessage.created_at))
        .limit(1)
    ).first()

    base_url = (settings.APP_BASE_URL or "https://aut.service4gh.com").rstrip("/")
    return {
        "email_gateway": {
            "domain": settings.AGENT_EMAIL_DOMAIN,
            "mailjet_configured": bool(settings.MAILJET_API_KEY and settings.MAILJET_SECRET_KEY),
            "smtp_configured": bool(settings.SMTP_HOST and settings.SMTP_FROM),
            "webhook_url": f"{base_url}/api/v1/agents/webhooks/email",
            "last_inbound_at": latest_email.created_at.isoformat() if latest_email and latest_email.created_at else None,
        },
        "whatsapp_gateway": {
            "platform_number": settings.WHATSAPP_PLATFORM_NUMBER,
            "phone_number_id": settings.WHATSAPP_PHONE_NUMBER_ID or "",
            "access_token_configured": bool(settings.WHATSAPP_ACCESS_TOKEN),
            "verify_token_configured": bool(settings.WHATSAPP_VERIFY_TOKEN),
            "webhook_url": f"{base_url}/api/v1/agents/webhooks/whatsapp",
            "last_inbound_at": latest_whatsapp.created_at.isoformat() if latest_whatsapp and latest_whatsapp.created_at else None,
        },
    }


# -------------------------------------------------------------------------
# 6. Compliance Audit Log Explorer & Per-Tenant Cost Telemetry
# -------------------------------------------------------------------------

@router.get("/audit-logs", summary="Searchable Platform & Compliance Audit Trail")
async def list_platform_audit_logs(
    client_id: Optional[str] = None,
    action: Optional[str] = None,
    actor_email: Optional[str] = None,
    source_type: Optional[str] = None,
    search: Optional[str] = None,
    export_format: Optional[str] = Query(default="json", alias="format"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db_session),
    _admin_user: Dict[str, Any] = Depends(require_platform_admin),
) -> Any:
    """Provides filterable, exportable immutable AuditLog inspection across all tenants and operator sessions."""
    stmt = select(AuditLog)
    count_stmt = select(func.count(AuditLog.id))

    if client_id and client_id != "ALL":
        stmt = stmt.where(AuditLog.client_id == client_id)
        count_stmt = count_stmt.where(AuditLog.client_id == client_id)
    if action and action != "ALL":
        stmt = stmt.where(AuditLog.action == action)
        count_stmt = count_stmt.where(AuditLog.action == action)
    if actor_email and actor_email.strip():
        p = f"%{actor_email.strip().lower()}%"
        stmt = stmt.where(func.lower(AuditLog.actor_email).like(p))
        count_stmt = count_stmt.where(func.lower(AuditLog.actor_email).like(p))
    if source_type and source_type != "ALL":
        stmt = stmt.where(AuditLog.source_type == source_type)
        count_stmt = count_stmt.where(AuditLog.source_type == source_type)
    if search and search.strip():
        p = f"%{search.strip().lower()}%"
        cond = or_(
            func.lower(AuditLog.action).like(p),
            func.lower(AuditLog.actor_email).like(p),
            func.lower(AuditLog.client_id).like(p),
        )
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)

    logs = db.exec(stmt.order_by(desc(AuditLog.created_at)).offset(offset).limit(limit)).all()
    total = db.exec(count_stmt).one()

    if export_format == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["id", "created_at", "action", "actor_email", "client_id", "source_type", "source_identifier", "details"])
        for entry in logs:
            writer.writerow([
                entry.id,
                entry.created_at.isoformat() if entry.created_at else "",
                entry.action,
                entry.actor_email,
                entry.client_id,
                entry.source_type or "",
                entry.source_identifier or "",
                str(entry.details or {}),
            ])
        return Response(
            content=buf.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=s4_audit_logs.csv"},
        )

    distinct_actions = [
        a for a in db.exec(select(AuditLog.action).distinct()).all() if a
    ]

    return {
        "logs": jsonable_encoder(logs),
        "total_count": total,
        "available_actions": sorted(distinct_actions),
    }


@router.get("/telemetry/tenants", summary="Per-Tenant AI Cost Attribution vs Subscription Margin")
async def get_tenant_telemetry_breakdown(
    days: int = Query(default=30, ge=1, le=90),
    db: Session = Depends(get_db_session),
    _admin_user: Dict[str, Any] = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Combines ApiKeyUsageLog token/cost consumption by organization against subscription revenue."""
    since = get_utc_now() - timedelta(days=days)
    orgs = db.exec(select(Organization)).all()
    clients = db.exec(select(ClientOrganization)).all()
    client_to_org = {c.id: (c.organization_id or "s4_advisory") for c in clients}

    usage_rows = db.exec(
        select(ApiKeyUsageLog).where(ApiKeyUsageLog.created_at >= since)
    ).all()

    org_usage: Dict[str, Dict[str, Any]] = {}
    for o in orgs:
        org_usage[o.id] = {
            "organization_id": o.id,
            "organization_name": o.name,
            "plan_tier": o.plan_tier,
            "subscription_status": o.subscription_status,
            "base_price_ghs": float(o.base_price or 0.0),
            "monthly_document_allowance": o.monthly_document_allowance or 0,
            "monthly_documents_processed": o.monthly_documents_processed or 0,
            "api_calls": 0,
            "failed_calls": 0,
            "total_tokens": 0,
            "cost_usd": 0.0,
            "cost_ghs": 0.0,
        }

    for row in usage_rows:
        oid = row.organization_id or (client_to_org.get(row.client_id) if row.client_id else "s4_advisory") or "s4_advisory"
        if oid not in org_usage:
            org_usage[oid] = {
                "organization_id": oid,
                "organization_name": oid,
                "plan_tier": "custom",
                "subscription_status": "ACTIVE",
                "base_price_ghs": 0.0,
                "monthly_document_allowance": 0,
                "monthly_documents_processed": 0,
                "api_calls": 0,
                "failed_calls": 0,
                "total_tokens": 0,
                "cost_usd": 0.0,
                "cost_ghs": 0.0,
            }
        bucket = org_usage[oid]
        bucket["api_calls"] += 1
        if not row.is_success:
            bucket["failed_calls"] += 1
        bucket["total_tokens"] += int(row.total_tokens or 0)
        bucket["cost_usd"] += float(row.estimated_cost_usd or 0.0)
        bucket["cost_ghs"] += float(row.estimated_cost_ghs or 0.0)

    breakdown = []
    for item in org_usage.values():
        item["cost_usd"] = round(item["cost_usd"], 4)
        item["cost_ghs"] = round(item["cost_ghs"], 2)
        rev = item["base_price_ghs"]
        item["net_margin_ghs"] = round(rev - item["cost_ghs"], 2)
        item["margin_percent"] = round((rev - item["cost_ghs"]) / rev * 100, 1) if rev > 0 else 0.0
        breakdown.append(item)

    breakdown.sort(key=lambda x: x["cost_ghs"], reverse=True)
    summary = get_cost_summary(db, days=days)
    return {
        "period_days": days,
        "summary": summary,
        "tenants": breakdown,
    }
