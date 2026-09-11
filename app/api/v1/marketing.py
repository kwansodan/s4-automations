"""Marketing & Audience CRM Endpoints for S4 Automations."""

import threading
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, Response
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from sqlmodel import Session, select, func, or_, desc

from app.config import settings
from app.db.session import get_db_session
from app.models.db_models import EmailSubscriber, MarketingLead, ClientOrganization, LandingPageConfig, get_utc_now
from app.services.mailjet_service import MailjetService
from app.utils.logging import get_logger

logger = get_logger("marketing_api")

# Thread-safe in-memory cache for ultra-fast public landing page serving (< 2ms)
_LANDING_CACHE: Optional[Dict[str, Any]] = None
_LANDING_LOCK = threading.Lock()

router = APIRouter(prefix="/marketing", tags=["Marketing & Audience CRM"])


# -------------------------------------------------------------------------
# Request / Response Schemas
# -------------------------------------------------------------------------

class CreateSubscriberRequest(BaseModel):
    email: str = Field(..., description="Subscriber email address")
    name: Optional[str] = None
    company: Optional[str] = None
    role_or_title: Optional[str] = "Finance Lead"
    tier: str = Field(default="lead", description="lead, client, firm_partner, subscriber")
    tags: Optional[List[str]] = Field(default=["general"])
    notes: Optional[str] = None
    bulk_emails: Optional[str] = Field(default=None, description="Comma or newline-separated emails for bulk import")


class UpdateSubscriberRequest(BaseModel):
    name: Optional[str] = None
    company: Optional[str] = None
    role_or_title: Optional[str] = None
    tier: Optional[str] = None
    tags: Optional[List[str]] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class LeadCaptureRequest(BaseModel):
    full_name: str = Field(..., description="Lead contact name")
    email: str = Field(..., description="Work email address")
    company_name: str = Field(..., description="Company or accounting firm name")
    phone_or_whatsapp: Optional[str] = None
    accounting_firm: bool = Field(default=False)
    client_count_estimate: Optional[str] = Field(default="1-5")
    primary_accounting_software: Optional[str] = Field(default="zoho_books")
    biggest_headache: Optional[str] = None


class UpdateLeadStatusRequest(BaseModel):
    status: str = Field(..., description="NEW, CONTACTED, DEMO_SCHEDULED, PILOT_ACTIVE, CONVERTED, CLOSED")
    notes: Optional[str] = None


class UpdateLandingConfigRequest(BaseModel):
    mode: Optional[str] = None
    is_published: Optional[bool] = None

    announcement_enabled: Optional[bool] = None
    announcement_badge: Optional[str] = None
    announcement_text: Optional[str] = None
    announcement_link: Optional[str] = None

    hero_badge: Optional[str] = None
    hero_headline: Optional[str] = None
    hero_subheadline: Optional[str] = None
    hero_primary_cta_text: Optional[str] = None
    hero_primary_cta_action: Optional[str] = None
    hero_secondary_cta_text: Optional[str] = None
    hero_secondary_cta_action: Optional[str] = None
    hero_highlights: Optional[List[str]] = None

    show_announcement: Optional[bool] = None
    show_hero: Optional[bool] = None
    show_how_it_works: Optional[bool] = None
    show_ocr_sandbox: Optional[bool] = None
    show_roi_calculator: Optional[bool] = None
    show_integrations: Optional[bool] = None
    show_social_proof: Optional[bool] = None
    show_pricing: Optional[bool] = None
    show_faq: Optional[bool] = None
    show_cta_banner: Optional[bool] = None
    show_demo_modal: Optional[bool] = None
    show_client_portal_link: Optional[bool] = None

    whatsapp_number: Optional[str] = None
    whatsapp_message: Optional[str] = None

    roi_hourly_rate_ghs: Optional[float] = None
    roi_default_clients: Optional[int] = None
    roi_default_slips: Optional[int] = None

    faq_items: Optional[List[Dict[str, Any]]] = None
    pricing_tiers: Optional[List[Dict[str, Any]]] = None

    maintenance_headline: Optional[str] = None
    maintenance_message: Optional[str] = None
    maintenance_estimated_time: Optional[str] = None
    maintenance_support_email: Optional[str] = None
    last_updated_by: Optional[str] = None


# -------------------------------------------------------------------------
# Audience / Email Subscriber Endpoints
# -------------------------------------------------------------------------

@router.get("/audience")
async def list_subscribers(
    search: Optional[str] = None,
    tag: Optional[str] = None,
    tier: Optional[str] = None,
    active_only: bool = False,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Lists email subscribers with search, tag filtering, and summary statistics."""
    query = select(EmailSubscriber)

    if active_only:
        query = query.where(EmailSubscriber.is_active == True)
    if tier:
        query = query.where(EmailSubscriber.tier == tier)
    if search:
        search_pattern = f"%{search.strip().lower()}%"
        query = query.where(
            or_(
                func.lower(EmailSubscriber.email).like(search_pattern),
                func.lower(EmailSubscriber.name).like(search_pattern),
                func.lower(EmailSubscriber.company).like(search_pattern),
            )
        )

    # Execute main query ordered by created_at descending
    query = query.order_by(desc(EmailSubscriber.created_at))
    all_results = db.exec(query).all()

    # In-memory filter for tags since tags is a JSON column
    filtered_results = all_results
    if tag:
        tag_lower = tag.strip().lower()
        filtered_results = [s for s in all_results if any(t.lower() == tag_lower for t in (s.tags or []))]

    total_count = len(filtered_results)
    paginated_subscribers = filtered_results[offset : offset + limit]

    # Collect available tags across all subscribers
    all_tags = set()
    active_count = 0
    tier_counts: Dict[str, int] = {}

    for s in all_results:
        if s.is_active:
            active_count += 1
        tier_counts[s.tier] = tier_counts.get(s.tier, 0) + 1
        for t in s.tags or []:
            all_tags.add(t)

    return {
        "subscribers": paginated_subscribers,
        "total_count": total_count,
        "active_count": active_count,
        "tier_counts": tier_counts,
        "available_tags": sorted(list(all_tags)),
    }


@router.post("/audience")
async def create_or_bulk_import_subscribers(
    payload: CreateSubscriberRequest,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Adds a single subscriber or bulk-imports multiple email addresses."""
    created_list = []
    skipped_list = []

    emails_to_process = []
    if payload.bulk_emails:
        # Split by comma, semicolon, or newline
        raw = payload.bulk_emails.replace(";", ",").replace("\n", ",")
        for part in raw.split(","):
            cleaned = part.strip()
            if cleaned and "@" in cleaned:
                emails_to_process.append(cleaned)
    elif payload.email:
        emails_to_process.append(payload.email.strip())

    if not emails_to_process:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid email address provided."
        )

    for email_str in emails_to_process:
        # Check if exists
        existing = db.exec(select(EmailSubscriber).where(EmailSubscriber.email == email_str)).first()
        if existing:
            # Update tags if new tags provided
            if payload.tags:
                current_tags = set(existing.tags or [])
                current_tags.update(payload.tags)
                existing.tags = list(current_tags)
                existing.is_active = True
                existing.updated_at = get_utc_now()
                db.add(existing)
            skipped_list.append(email_str)
            continue

        new_sub = EmailSubscriber(
            email=email_str,
            name=payload.name if len(emails_to_process) == 1 else email_str.split("@")[0],
            company=payload.company,
            role_or_title=payload.role_or_title,
            tier=payload.tier,
            tags=payload.tags or ["general"],
            source="csv_import" if len(emails_to_process) > 1 else "manual",
            notes=payload.notes,
            is_active=True,
            created_at=get_utc_now(),
            updated_at=get_utc_now(),
        )
        db.add(new_sub)
        created_list.append(email_str)

    db.commit()
    logger.info(f"Audience import: {len(created_list)} added, {len(skipped_list)} already existed.")

    return {
        "success": True,
        "created_count": len(created_list),
        "skipped_count": len(skipped_list),
        "created_emails": created_list,
        "message": f"Successfully added {len(created_list)} contacts to your marketing audience."
    }


@router.put("/audience/{subscriber_id}")
async def update_subscriber(
    subscriber_id: int,
    payload: UpdateSubscriberRequest,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Updates an existing subscriber's profile, status, or tags."""
    sub = db.get(EmailSubscriber, subscriber_id)
    if not sub:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subscriber not found.")

    if payload.name is not None:
        sub.name = payload.name
    if payload.company is not None:
        sub.company = payload.company
    if payload.role_or_title is not None:
        sub.role_or_title = payload.role_or_title
    if payload.tier is not None:
        sub.tier = payload.tier
    if payload.tags is not None:
        sub.tags = payload.tags
    if payload.is_active is not None:
        sub.is_active = payload.is_active
    if payload.notes is not None:
        sub.notes = payload.notes

    sub.updated_at = get_utc_now()
    db.add(sub)
    db.commit()
    db.refresh(sub)

    return {"success": True, "subscriber": sub}


@router.delete("/audience/{subscriber_id}")
async def delete_subscriber(
    subscriber_id: int,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Permanently deletes a subscriber from the audience list."""
    sub = db.get(EmailSubscriber, subscriber_id)
    if not sub:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subscriber not found.")

    db.delete(sub)
    db.commit()
    return {"success": True, "message": f"Removed {sub.email} from audience."}


@router.post("/audience/sync-clients")
async def sync_client_contacts_to_audience(
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Scans all registered clients and team members, syncing their emails into the audience list."""
    clients = db.exec(select(ClientOrganization)).all()
    synced_count = 0
    new_count = 0

    for client in clients:
        contacts = []
        if client.source_email and "@" in client.source_email:
            contacts.append({
                "email": client.source_email.strip(),
                "name": f"{client.name} Inbound",
                "role": "Inbound Accounting Lead",
            })

        for member in client.team_members or []:
            m_email = member.get("email")
            if m_email and "@" in m_email:
                contacts.append({
                    "email": m_email.strip(),
                    "name": member.get("name") or m_email.split("@")[0],
                    "role": member.get("role") or "Client Team Member",
                })

        for contact in contacts:
            email_str = contact["email"]
            existing = db.exec(select(EmailSubscriber).where(EmailSubscriber.email == email_str)).first()
            if existing:
                tags = set(existing.tags or [])
                tags.add("client_contact")
                tags.add(f"client:{client.id}")
                existing.tags = list(tags)
                existing.company = client.name
                existing.tier = "client"
                db.add(existing)
                synced_count += 1
            else:
                new_sub = EmailSubscriber(
                    email=email_str,
                    name=contact["name"],
                    company=client.name,
                    role_or_title=contact["role"],
                    tier="client",
                    tags=["client_contact", f"client:{client.id}"],
                    source="client_sync",
                    is_active=True,
                    created_at=get_utc_now(),
                    updated_at=get_utc_now(),
                )
                db.add(new_sub)
                new_count += 1

    db.commit()
    return {
        "success": True,
        "synced_count": synced_count,
        "new_count": new_count,
        "total_processed": synced_count + new_count,
        "message": f"Synchronized {new_count} new and {synced_count} existing client contacts into your audience list."
    }


# -------------------------------------------------------------------------
# Public Inbound Lead Capture Endpoints (Landing Page Funnel)
# -------------------------------------------------------------------------

@router.post("/lead-capture")
async def capture_public_lead(
    payload: LeadCaptureRequest,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """
    Public endpoint for demo bookings and free automation audits.
    Stores the lead, auto-enrolls in audience, and notifies the team.
    """
    lead = MarketingLead(
        full_name=payload.full_name.strip(),
        email=payload.email.strip().lower(),
        phone_or_whatsapp=payload.phone_or_whatsapp,
        company_name=payload.company_name.strip(),
        accounting_firm=payload.accounting_firm,
        client_count_estimate=payload.client_count_estimate,
        primary_accounting_software=payload.primary_accounting_software,
        biggest_headache=payload.biggest_headache,
        status="NEW",
        source="landing_page_demo",
        metadata_json={},
        created_at=get_utc_now(),
    )
    db.add(lead)

    # Auto-add to EmailSubscriber list with tags
    existing_sub = db.exec(select(EmailSubscriber).where(EmailSubscriber.email == lead.email)).first()
    tier_type = "firm_partner" if payload.accounting_firm else "lead"
    lead_tags = ["inbound_lead", "demo_requested", payload.primary_accounting_software or "zoho_books"]

    if existing_sub:
        current_tags = set(existing_sub.tags or [])
        current_tags.update(lead_tags)
        existing_sub.tags = list(current_tags)
        existing_sub.company = payload.company_name
        existing_sub.tier = tier_type
        db.add(existing_sub)
    else:
        new_sub = EmailSubscriber(
            email=lead.email,
            name=payload.full_name,
            company=payload.company_name,
            role_or_title="Managing Partner" if payload.accounting_firm else "Finance Controller",
            tier=tier_type,
            tags=lead_tags,
            source="landing_page",
            is_active=True,
            created_at=get_utc_now(),
            updated_at=get_utc_now(),
        )
        db.add(new_sub)

    db.commit()
    db.refresh(lead)

    # Send Notification to Internal Team via Mailjet
    admin_notify_email = settings.NOTIFICATION_EMAIL or settings.AUTH_EMAIL or "s4bookkeeping@service4gh.com"
    admin_subject = f"🔥 New S4 Demo Request: {payload.company_name} ({payload.full_name})"
    admin_html = f"""
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; background: #0f172a; color: #f8fafc; border-radius: 12px;">
      <h2 style="color: #38bdf8; margin-top: 0;">🚀 New Accounting Automation Pilot Inquiry</h2>
      <p style="font-size: 14px; line-height: 1.5;">A new prospect has requested a live demo from the public landing page:</p>
      
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px;">
        <tr style="border-bottom: 1px solid #334155;"><td style="padding: 8px; color: #94a3b8;">Full Name:</td><td style="padding: 8px; font-weight: bold;">{payload.full_name}</td></tr>
        <tr style="border-bottom: 1px solid #334155;"><td style="padding: 8px; color: #94a3b8;">Email:</td><td style="padding: 8px; font-weight: bold;"><a href="mailto:{payload.email}" style="color: #38bdf8;">{payload.email}</a></td></tr>
        <tr style="border-bottom: 1px solid #334155;"><td style="padding: 8px; color: #94a3b8;">Company / Firm:</td><td style="padding: 8px; font-weight: bold;">{payload.company_name} ({'Accounting Firm' if payload.accounting_firm else 'Single Business'})</td></tr>
        <tr style="border-bottom: 1px solid #334155;"><td style="padding: 8px; color: #94a3b8;">WhatsApp / Phone:</td><td style="padding: 8px; font-weight: bold;">{payload.phone_or_whatsapp or 'Not provided'}</td></tr>
        <tr style="border-bottom: 1px solid #334155;"><td style="padding: 8px; color: #94a3b8;">Target ERP:</td><td style="padding: 8px; font-weight: bold; text-transform: uppercase;">{payload.primary_accounting_software}</td></tr>
        <tr style="border-bottom: 1px solid #334155;"><td style="padding: 8px; color: #94a3b8;">Client Volume:</td><td style="padding: 8px; font-weight: bold;">{payload.client_count_estimate or '1-5'}</td></tr>
        <tr><td style="padding: 8px; color: #94a3b8;">Pain Point:</td><td style="padding: 8px; font-style: italic;">{payload.biggest_headache or 'General bookkeeping automation'}</td></tr>
      </table>

      <a href="mailto:{payload.email}?subject=Re:%20S4%20Automations%20Demo%20for%20{payload.company_name}" style="display: inline-block; background: #0284c7; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 13px;">Reply to Prospect Now</a>
    </div>
    """

    try:
        await MailjetService.send_email(
            to_email=admin_notify_email,
            subject=admin_subject,
            html_content=admin_html,
            recipient_name="S4 Growth Team",
        )
    except Exception as e:
        logger.warning(f"Failed to dispatch admin lead notification email: {e}")

    # Send Welcome Auto-Responder to Prospect
    prospect_subject = "Welcome to S4 Automations - Let's Streamline Your Accounting"
    prospect_html = f"""
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 24px; background: #ffffff; color: #1e293b; border: 1px solid #e2e8f0; border-radius: 12px;">
      <h2 style="color: #0369a1; margin-top: 0;">Hello {payload.full_name},</h2>
      <p style="font-size: 14px; line-height: 1.6; color: #334155;">
        Thank you for your interest in <strong>S4 Automations</strong>. We received your request for a live demo for <strong>{payload.company_name}</strong>.
      </p>
      <p style="font-size: 14px; line-height: 1.6; color: #334155;">
        Our accounting automation engine helps firms and finance teams eliminate up to 85% of manual receipt, vendor bill, and MoMo entry directly into {payload.primary_accounting_software.replace('_', ' ').title()}.
      </p>
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px; margin: 18px 0; font-size: 13px; color: #166534;">
        <strong>Next Step:</strong> One of our senior automation engineers will reach out to you within 24 hours to schedule your walkthrough and run a sample batch of your documents.
      </div>
      <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
        Need immediate assistance? Feel free to reply directly to this email.
      </p>
      <p style="font-size: 13px; color: #0f172a; margin-top: 24px; font-weight: bold;">
        The S4 Automations Engineering Team<br/>
        <span style="font-size: 11px; color: #64748b; font-weight: normal;">https://s4-automations.com</span>
      </p>
    </div>
    """

    try:
        await MailjetService.send_email(
            to_email=payload.email,
            subject=prospect_subject,
            html_content=prospect_html,
            recipient_name=payload.full_name,
        )
    except Exception as e:
        logger.warning(f"Failed to dispatch prospect confirmation email: {e}")

    return {
        "success": True,
        "lead_id": lead.id,
        "message": "Demo request received! Check your inbox for confirmation.",
    }


@router.get("/leads")
async def list_marketing_leads(
    status_filter: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Admin view for pipeline of inbound landing page leads with search."""
    query = select(MarketingLead)
    count_query = select(func.count(MarketingLead.id))
    if status_filter:
        query = query.where(MarketingLead.status == status_filter)
        count_query = count_query.where(MarketingLead.status == status_filter)
    if search:
        pattern = f"%{search.strip().lower()}%"
        search_filter = or_(
            func.lower(MarketingLead.full_name).like(pattern),
            func.lower(MarketingLead.email).like(pattern),
            func.lower(MarketingLead.company_name).like(pattern),
        )
        query = query.where(search_filter)
        count_query = count_query.where(search_filter)

    query = query.order_by(desc(MarketingLead.created_at)).offset(offset).limit(limit)

    leads = db.exec(query).all()
    total = db.exec(count_query).one()

    return {
        "leads": leads,
        "total_count": total,
    }


@router.put("/leads/{lead_id}/status")
@router.patch("/leads/{lead_id}/status")
async def update_lead_status(
    lead_id: int,
    payload: UpdateLeadStatusRequest,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Updates lead sales status (e.g. from NEW to DEMO_SCHEDULED or CONVERTED)."""
    lead = db.get(MarketingLead, lead_id)
    if not lead:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found.")

    lead.status = payload.status
    if payload.notes:
        meta = dict(lead.metadata_json or {})
        notes_list = meta.get("activity_notes", [])
        notes_list.append({
            "timestamp": get_utc_now().isoformat(),
            "status": payload.status,
            "note": payload.notes,
        })
        meta["activity_notes"] = notes_list
        lead.metadata_json = meta

    db.add(lead)
    db.commit()
    db.refresh(lead)

    return {"success": True, "lead": lead}


# -------------------------------------------------------------------------
# Public Landing Page & Visitor Visibility Management Endpoints
# -------------------------------------------------------------------------

@router.get("/landing-config", summary="Get Public Landing Page Configuration")
async def get_landing_config(
    response: Response,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """
    Returns public landing page configuration.
    High-performance: Served from in-memory cache with HTTP Edge Caching headers.
    Zero-CLS design ensures instant client hydration.
    """
    global _LANDING_CACHE

    with _LANDING_LOCK:
        if _LANDING_CACHE is not None:
            response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
            return _LANDING_CACHE

    # Cache miss - load from DB or initialize default
    cfg = db.exec(select(LandingPageConfig).where(LandingPageConfig.id == 1)).first()
    if not cfg:
        logger.info("Initializing default LandingPageConfig in database...")
        cfg = LandingPageConfig(id=1)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)

    cfg_dict = jsonable_encoder(cfg)

    with _LANDING_LOCK:
        _LANDING_CACHE = cfg_dict

    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
    return cfg_dict


@router.put("/landing-config", summary="Update Landing Page Configuration (Admin)")
async def update_landing_config(
    payload: UpdateLandingConfigRequest,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """
    Updates landing page configuration, saves historical snapshot for rollback,
    and invalidates in-memory cache immediately.
    """
    global _LANDING_CACHE

    cfg = db.exec(select(LandingPageConfig).where(LandingPageConfig.id == 1)).first()
    if not cfg:
        cfg = LandingPageConfig(id=1)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)

    # 1. Snapshot previous state into version_history (JSON-serializable)
    prev_snapshot = jsonable_encoder(cfg.model_dump(exclude={"version_history"}))
    prev_snapshot["snapshot_timestamp"] = get_utc_now().isoformat()
    history = list(cfg.version_history or [])
    history.insert(0, prev_snapshot)
    # Keep up to 20 historical versions, ensuring all items are JSON-serializable
    cfg.version_history = jsonable_encoder(history[:20])
    cfg.version = (cfg.version or 1) + 1

    # 2. Apply updates
    data = payload.model_dump(exclude_unset=True)
    for field_name, value in data.items():
        if hasattr(cfg, field_name) and value is not None:
            setattr(cfg, field_name, value)

    cfg.updated_at = get_utc_now()
    db.add(cfg)
    db.commit()
    db.refresh(cfg)

    cfg_dict = jsonable_encoder(cfg)

    # 3. Invalidate / update in-memory cache
    with _LANDING_LOCK:
        _LANDING_CACHE = cfg_dict

    logger.info(f"Published LandingPageConfig v{cfg.version} (Mode: {cfg.mode})")
    return {
        "success": True,
        "message": f"Landing page configuration v{cfg.version} published successfully.",
        "config": cfg_dict,
    }


@router.post("/landing-config/rollback/{version_id}", summary="Rollback Landing Page Config (Admin)")
async def rollback_landing_config(
    version_id: int,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Rolls back landing page configuration to a previous snapshot."""
    global _LANDING_CACHE

    cfg = db.exec(select(LandingPageConfig).where(LandingPageConfig.id == 1)).first()
    if not cfg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Config record not found.")

    target_snapshot = next((s for s in (cfg.version_history or []) if s.get("version") == version_id), None)
    if not target_snapshot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Version {version_id} not found in history.")

    # Record current state as a snapshot before rolling back (JSON-serializable)
    current_snapshot = jsonable_encoder(cfg.model_dump(exclude={"version_history"}))
    current_snapshot["snapshot_timestamp"] = get_utc_now().isoformat()
    current_snapshot["note"] = f"Pre-rollback snapshot before restoring v{version_id}"
    history = list(cfg.version_history or [])
    history.insert(0, current_snapshot)
    cfg.version_history = jsonable_encoder(history[:20])

    # Restore fields from target_snapshot
    for field_name, value in target_snapshot.items():
        if field_name not in ["id", "version", "version_history", "created_at", "updated_at", "snapshot_timestamp", "note"]:
            if hasattr(cfg, field_name):
                setattr(cfg, field_name, value)

    cfg.version = (cfg.version or 1) + 1
    cfg.updated_at = get_utc_now()
    cfg.last_updated_by = f"Rollback to v{version_id}"

    db.add(cfg)
    db.commit()
    db.refresh(cfg)

    cfg_dict = jsonable_encoder(cfg)
    with _LANDING_LOCK:
        _LANDING_CACHE = cfg_dict

    logger.info(f"Restored LandingPageConfig to snapshot v{version_id} (New active version: v{cfg.version})")
    return {
        "success": True,
        "message": f"Successfully rolled back to version {version_id}.",
        "config": cfg_dict,
    }
