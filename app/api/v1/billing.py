"""Billing, Customer Subscription Management, Free Trial Lifecycle, and 3rd-Party Cost Monitor API."""

from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from sqlmodel import Session, select, func, desc, or_

from app.db.session import get_db_session
from app.models.db_models import (
    Organization,
    CustomerPaymentRecord,
    ApiKeyUsageLog,
    PlatformPricingConfig,
    LandingPageConfig,
    get_utc_now,
)
from app.services.telemetry_service import (
    get_cost_summary,
    _RECENT_CALLS,
    _CALLS_LOCK,
    USD_TO_GHS_RATE,
)
from app.utils.logging import get_logger

logger = get_logger("billing_api")
router = APIRouter(prefix="/billing", tags=["Admin Billing & Customer Subscriptions"])


# -------------------------------------------------------------------------
# Request / Response Schemas
# -------------------------------------------------------------------------

class UpdateSubscriptionRequest(BaseModel):
    plan_tier: Optional[str] = None
    subscription_status: Optional[str] = None
    billing_cycle: Optional[str] = None
    currency: Optional[str] = None
    base_price: Optional[float] = None
    monthly_document_allowance: Optional[int] = None
    overage_rate_per_doc: Optional[float] = None
    billing_contact_name: Optional[str] = None
    billing_contact_email: Optional[str] = None
    billing_contact_phone: Optional[str] = None
    billing_notes: Optional[str] = None


class ApplyBoosterPackRequest(BaseModel):
    slips_count: int = Field(..., description="250, 500, 1000, or custom slip count")
    amount_ghs: float = Field(..., description="Cost of booster pack in GHS")
    payment_channel: str = Field(default="MTN_MOMO", description="MTN_MOMO, VODAFONE_CASH, BANK_DEPOSIT, CARD, MANUAL_OVERRIDE")
    transaction_reference: Optional[str] = Field(default=None, description="MoMo transaction ID or bank receipt reference")
    mark_as_paid: bool = Field(default=True)
    notes: Optional[str] = None


class ExtendTrialRequest(BaseModel):
    additional_days: int = Field(default=14, description="Number of days to extend the trial")
    additional_slips: int = Field(default=50, description="Additional trial slip quota to grant")
    notes: Optional[str] = None


class ConvertToPaidRequest(BaseModel):
    plan_tier: str = Field(default="pro", description="starter, pro, enterprise")
    base_price: float = Field(default=2800.0)
    billing_cycle: str = Field(default="MONTHLY")
    currency: str = Field(default="GHS")
    payment_channel: str = Field(default="MTN_MOMO")
    transaction_reference: Optional[str] = None
    notes: Optional[str] = None


class RecordPaymentRequest(BaseModel):
    organization_id: str = Field(..., description="Organization slug ID")
    amount: float = Field(..., description="Amount paid")
    currency: str = Field(default="GHS")
    period_covered: str = Field(default="September 2026")
    payment_channel: str = Field(default="MTN_MOMO", description="MTN_MOMO, VODAFONE_CASH, BANK_DEPOSIT, CARD, MANUAL_OVERRIDE")
    payment_type: str = Field(default="SUBSCRIPTION", description="SUBSCRIPTION, BOOSTER_PACK, OVERAGE, CUSTOM")
    transaction_reference: Optional[str] = None
    payment_status: str = Field(default="PAID", description="PAID, PENDING_VERIFICATION")
    admin_notes: Optional[str] = None


class UpdatePaymentStatusRequest(BaseModel):
    payment_status: str = Field(..., description="PAID, PENDING_VERIFICATION, OVERDUE, FAILED, REFUNDED")
    admin_notes: Optional[str] = None


class UpdatePricingConfigRequest(BaseModel):
    currency: Optional[str] = "GHS"
    usd_to_ghs_rate: Optional[float] = 13.50
    trial_days: Optional[int] = 14
    trial_document_quota: Optional[int] = 50
    grace_period_days: Optional[int] = 3
    tiers: Optional[List[Dict[str, Any]]] = None
    booster_packs: Optional[List[Dict[str, Any]]] = None
    sync_landing_page: Optional[bool] = True


# -------------------------------------------------------------------------
# Billing Endpoints
# -------------------------------------------------------------------------

@router.get("/overview", summary="Executive Financial & Gross Margin Overview")
async def get_billing_overview(
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """
    Returns high-level subscription metrics, gross profit margin analysis,
    and operational free trial alerts.
    """
    now = get_utc_now()
    orgs = db.exec(select(Organization)).all()

    # Load dynamic PlatformPricingConfig
    pricing_cfg = db.exec(select(PlatformPricingConfig).where(PlatformPricingConfig.id == 1)).first()
    if not pricing_cfg:
        pricing_cfg = PlatformPricingConfig(id=1)
        db.add(pricing_cfg)
        db.commit()
        db.refresh(pricing_cfg)

    fx_rate = pricing_cfg.usd_to_ghs_rate or USD_TO_GHS_RATE

    # If no organizations exist yet, seed a default S4 Advisory Firm
    if not orgs:
        default_org = Organization(
            id="s4_advisory",
            name="S4 Advisory & Accounting Partners",
            org_type="ACCOUNTING_FIRM",
            plan_tier="pro",
            max_clients=25,
            subscription_status="ACTIVE",
            base_price=2800.0,
            currency="GHS",
            monthly_document_allowance=3000,
            monthly_documents_processed=240,
            topup_document_balance=0,
            current_period_start=now - timedelta(days=10),
            current_period_end=now + timedelta(days=20),
            billing_contact_name="Finance Director",
            billing_contact_email="cdanso@service4gh.com",
            billing_contact_phone="0240000000",
        )
        db.add(default_org)
        db.commit()
        db.refresh(default_org)
        orgs = [default_org]

    active_count = 0
    trialing_count = 0
    expiring_trials_count = 0
    past_due_count = 0
    total_mrr_ghs = 0.0

    two_days_from_now = now + timedelta(days=2)

    for o in orgs:
        status_val = (o.subscription_status or "ACTIVE").upper()
        if status_val == "ACTIVE":
            active_count += 1
            if (o.currency or "GHS") == "USD":
                total_mrr_ghs += (o.base_price or 0.0) * fx_rate
            else:
                total_mrr_ghs += (o.base_price or 0.0)
        elif status_val == "TRIALING":
            trialing_count += 1
            if o.trial_ends_at and o.trial_ends_at <= two_days_from_now:
                expiring_trials_count += 1
        elif status_val in ("PAST_DUE", "GRACE_PERIOD"):
            past_due_count += 1

    # Overdue payments in ledger
    overdue_payments = db.exec(
        select(CustomerPaymentRecord).where(CustomerPaymentRecord.payment_status == "OVERDUE")
    ).all()
    overdue_count = len(overdue_payments)

    # 3rd-Party Infrastructure Cost & Gross Margin (30-day window)
    cost_data = get_cost_summary(db, days=30)
    infra_cost_ghs = cost_data.get("total_cost_ghs", 0.0)

    # Margin calculation
    gross_profit_ghs = max(0.0, total_mrr_ghs - infra_cost_ghs)
    margin_percent = (
        round((gross_profit_ghs / total_mrr_ghs * 100), 1) if total_mrr_ghs > 0 else 98.5
    )

    return {
        "mrr_ghs": round(total_mrr_ghs, 2),
        "arr_ghs": round(total_mrr_ghs * 12, 2),
        "mrr_usd": round(total_mrr_ghs / fx_rate, 2) if fx_rate > 0 else 0.0,
        "infra_cost_30d_ghs": infra_cost_ghs,
        "infra_cost_30d_usd": cost_data.get("total_cost_usd", 0.0),
        "gross_profit_margin_percent": margin_percent,
        "active_subscriptions_count": active_count,
        "trialing_accounts_count": trialing_count,
        "expiring_trials_count": expiring_trials_count,
        "past_due_count": past_due_count,
        "overdue_payments_count": overdue_count,
        "booster_packs": pricing_cfg.booster_packs or [
            {"slips": 250, "price_ghs": 320.0, "unit_rate": 1.28, "badge": "Quick Top-Up"},
            {"slips": 500, "price_ghs": 550.0, "unit_rate": 1.10, "badge": "Most Popular", "is_popular": True},
            {"slips": 1000, "price_ghs": 950.0, "unit_rate": 0.95, "badge": "Best Value"},
        ],
    }


@router.get("/organizations", summary="List Customer Subscriptions & Quota Health")
async def list_customer_subscriptions(
    status_filter: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Lists all customer organizations with subscription tiers, trial statuses, and booster balances."""
    query = select(Organization)

    if status_filter and status_filter != "ALL":
        query = query.where(Organization.subscription_status == status_filter)

    if search:
        p = f"%{search.strip().lower()}%"
        query = query.where(or_(func.lower(Organization.name).like(p), func.lower(Organization.id).like(p)))

    orgs = db.exec(query.order_by(Organization.created_at.desc())).all()

    now = get_utc_now()
    results = []

    for o in orgs:
        # Calculate remaining trial days
        trial_days_remaining = None
        if o.trial_ends_at:
            delta = (o.trial_ends_at - now).days
            trial_days_remaining = max(0, delta)

        # Quota usage percentage
        base_allowance = o.monthly_document_allowance or 3000
        processed = o.monthly_documents_processed or 0
        booster_balance = o.topup_document_balance or 0
        total_capacity = base_allowance + booster_balance
        utilization_percent = round((processed / total_capacity * 100), 1) if total_capacity > 0 else 0.0

        results.append({
            "id": o.id,
            "name": o.name,
            "org_type": o.org_type,
            "plan_tier": o.plan_tier,
            "subscription_status": o.subscription_status or "ACTIVE",
            "billing_cycle": o.billing_cycle or "MONTHLY",
            "currency": o.currency or "GHS",
            "base_price": o.base_price or 2800.0,
            "current_period_start": o.current_period_start,
            "current_period_end": o.current_period_end,
            "trial_start_at": o.trial_start_at,
            "trial_ends_at": o.trial_ends_at,
            "trial_days_remaining": trial_days_remaining,
            "trial_document_quota": o.trial_document_quota or 50,
            "monthly_document_allowance": base_allowance,
            "monthly_documents_processed": processed,
            "topup_document_balance": booster_balance,
            "total_available_capacity": total_capacity,
            "quota_utilization_percent": min(100.0, utilization_percent),
            "overage_rate_per_doc": o.overage_rate_per_doc or 0.90,
            "billing_contact_name": o.billing_contact_name,
            "billing_contact_email": o.billing_contact_email,
            "billing_contact_phone": o.billing_contact_phone,
            "billing_notes": o.billing_notes,
            "max_clients": o.max_clients,
            "is_active": o.is_active,
        })

    return {"organizations": jsonable_encoder(results), "total_count": len(results)}


@router.patch("/organizations/{org_id}/subscription", summary="Update Customer Subscription Details")
async def update_customer_subscription(
    org_id: str,
    payload: UpdateSubscriptionRequest,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Updates an organization's subscription plan, price, document allowances, or contacts."""
    org = db.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Organization '{org_id}' not found.")

    update_dict = payload.model_dump(exclude_unset=True)
    for field, val in update_dict.items():
        if hasattr(org, field) and val is not None:
            setattr(org, field, val)

    org.updated_at = get_utc_now()
    db.add(org)
    db.commit()
    db.refresh(org)

    logger.info(f"Updated subscription for organization '{org_id}'")
    return {"success": True, "message": "Subscription updated successfully.", "organization": jsonable_encoder(org)}


@router.post("/organizations/{org_id}/booster-pack", summary="Apply Option 2 Document Booster Pack")
async def apply_booster_pack(
    org_id: str,
    payload: ApplyBoosterPackRequest,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """
    Applies Option 2 on-demand slip top-up booster pack (+250, +500, +1000 slips).
    Credits never expire and roll over indefinitely.
    Automatically generates a CustomerPaymentRecord in the ledger.
    """
    org = db.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Organization '{org_id}' not found.")

    # 1. Increment booster balance
    current_balance = org.topup_document_balance or 0
    lifetime_total = org.topup_purchased_total or 0
    org.topup_document_balance = current_balance + payload.slips_count
    org.topup_purchased_total = lifetime_total + payload.slips_count
    org.updated_at = get_utc_now()
    db.add(org)

    # 2. Record ledger transaction
    now = get_utc_now()
    invoice_num = f"S4-TOP-{now.strftime('%Y%m%d')}-{payload.slips_count}"
    payment = CustomerPaymentRecord(
        organization_id=org_id,
        invoice_number=invoice_num,
        amount=payload.amount_ghs,
        currency="GHS",
        period_covered=f"+{payload.slips_count} Slips Booster Pack",
        payment_status="PAID" if payload.mark_as_paid else "PENDING_VERIFICATION",
        payment_channel=payload.payment_channel,
        payment_type="BOOSTER_PACK",
        transaction_reference=payload.transaction_reference,
        due_date=now,
        paid_at=now if payload.mark_as_paid else None,
        admin_notes=payload.notes or f"On-demand +{payload.slips_count} slips credit pack applied by platform admin.",
    )
    db.add(payment)
    db.commit()
    db.refresh(org)
    db.refresh(payment)

    logger.info(f"Applied +{payload.slips_count} booster pack to '{org_id}'. New booster balance: {org.topup_document_balance}")
    return {
        "success": True,
        "message": f"Successfully added +{payload.slips_count} document slips! New booster balance: {org.topup_document_balance}.",
        "new_balance": org.topup_document_balance,
        "payment": jsonable_encoder(payment),
    }


@router.post("/organizations/{org_id}/extend-trial", summary="Extend Free Trial (Admin 1-Click)")
async def extend_customer_trial(
    org_id: str,
    payload: ExtendTrialRequest,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Grants a 1-click extension to a customer's free trial."""
    org = db.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Organization '{org_id}' not found.")

    now = get_utc_now()
    current_end = org.trial_ends_at if (org.trial_ends_at and org.trial_ends_at > now) else now
    org.trial_ends_at = current_end + timedelta(days=payload.additional_days)
    org.trial_document_quota = (org.trial_document_quota or 50) + payload.additional_slips
    org.subscription_status = "TRIALING"
    org.updated_at = now

    if payload.notes:
        org.billing_notes = (org.billing_notes or "") + f"\n[{now.strftime('%Y-%m-%d')}] Extended trial by {payload.additional_days}d: {payload.notes}"

    db.add(org)
    db.commit()
    db.refresh(org)

    logger.info(f"Extended trial for '{org_id}' by {payload.additional_days} days. New trial end: {org.trial_ends_at}")
    return {
        "success": True,
        "message": f"Trial extended by {payload.additional_days} days (+{payload.additional_slips} slips granted).",
        "trial_ends_at": org.trial_ends_at,
        "new_quota": org.trial_document_quota,
    }


@router.post("/organizations/{org_id}/convert-to-paid", summary="Convert Trial to Paid Active Subscription")
async def convert_trial_to_paid(
    org_id: str,
    payload: ConvertToPaidRequest,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Converts a trialing customer to an active paying subscription and records the initial invoice."""
    org = db.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Organization '{org_id}' not found.")

    now = get_utc_now()
    org.subscription_status = "ACTIVE"
    org.plan_tier = payload.plan_tier
    org.base_price = payload.base_price
    org.billing_cycle = payload.billing_cycle
    org.currency = payload.currency
    org.current_period_start = now
    org.current_period_end = now + timedelta(days=365 if payload.billing_cycle == "ANNUALLY" else 30)

    # Set plan allowances
    if payload.plan_tier == "starter":
        org.monthly_document_allowance = 500
        org.overage_rate_per_doc = 1.50
    elif payload.plan_tier == "enterprise":
        org.monthly_document_allowance = 10000
        org.overage_rate_per_doc = 0.65
    else:
        org.monthly_document_allowance = 3000
        org.overage_rate_per_doc = 0.90

    org.updated_at = now
    db.add(org)

    # Record first subscription payment
    invoice_num = f"S4-INV-{now.strftime('%Y%m')}-{org_id.upper()[:4]}"
    payment = CustomerPaymentRecord(
        organization_id=org_id,
        invoice_number=invoice_num,
        amount=payload.base_price,
        currency=payload.currency,
        period_covered=now.strftime("%B %Y"),
        payment_status="PAID" if payload.transaction_reference else "PENDING_VERIFICATION",
        payment_channel=payload.payment_channel,
        payment_type="SUBSCRIPTION",
        transaction_reference=payload.transaction_reference,
        due_date=now,
        paid_at=now if payload.transaction_reference else None,
        admin_notes=payload.notes or "Initial subscription activation payment.",
    )
    db.add(payment)
    db.commit()
    db.refresh(org)
    db.refresh(payment)

    logger.info(f"Converted '{org_id}' to ACTIVE {payload.plan_tier} plan.")
    return {
        "success": True,
        "message": f"Successfully activated {payload.plan_tier.upper()} subscription for '{org.name}'!",
        "organization": jsonable_encoder(org),
        "payment": jsonable_encoder(payment),
    }


# -------------------------------------------------------------------------
# Customer Payments & Invoices Ledger
# -------------------------------------------------------------------------

@router.get("/payments", summary="List Customer Subscription Payments & Invoices")
async def list_customer_payments(
    organization_id: Optional[str] = None,
    status_filter: Optional[str] = None,
    payment_type: Optional[str] = None,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Returns ledger of customer subscription and booster payments."""
    query = select(CustomerPaymentRecord)

    if organization_id:
        query = query.where(CustomerPaymentRecord.organization_id == organization_id)
    if status_filter and status_filter != "ALL":
        query = query.where(CustomerPaymentRecord.payment_status == status_filter)
    if payment_type:
        query = query.where(CustomerPaymentRecord.payment_type == payment_type)

    payments = db.exec(query.order_by(CustomerPaymentRecord.created_at.desc()).limit(limit)).all()

    return {"payments": jsonable_encoder(payments), "total_count": len(payments)}


@router.post("/payments/record", summary="Record a Payment (MoMo / Bank Wire / Manual)")
async def record_customer_payment(
    payload: RecordPaymentRequest,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Records a new customer subscription payment or MoMo deposit verification."""
    now = get_utc_now()
    invoice_num = f"S4-REC-{now.strftime('%Y%m%d%H%M')}"

    payment = CustomerPaymentRecord(
        organization_id=payload.organization_id,
        invoice_number=invoice_num,
        amount=payload.amount,
        currency=payload.currency,
        period_covered=payload.period_covered,
        payment_status=payload.payment_status,
        payment_channel=payload.payment_channel,
        payment_type=payload.payment_type,
        transaction_reference=payload.transaction_reference,
        due_date=now,
        paid_at=now if payload.payment_status == "PAID" else None,
        admin_notes=payload.admin_notes,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)

    logger.info(f"Recorded payment of {payload.amount} {payload.currency} for '{payload.organization_id}'")
    return {"success": True, "message": "Payment recorded successfully.", "payment": jsonable_encoder(payment)}


@router.patch("/payments/{payment_id}/status", summary="Update Payment Status (Verify MoMo / Bank Wire)")
async def update_payment_status(
    payment_id: int,
    payload: UpdatePaymentStatusRequest,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Verifies or updates a payment status (e.g. marking MoMo deposit as PAID)."""
    payment = db.exec(select(CustomerPaymentRecord).where(CustomerPaymentRecord.id == payment_id)).first()
    if not payment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Payment #{payment_id} not found.")

    payment.payment_status = payload.payment_status
    if payload.payment_status == "PAID" and not payment.paid_at:
        payment.paid_at = get_utc_now()

    if payload.admin_notes:
        payment.admin_notes = (payment.admin_notes or "") + f" | {payload.admin_notes}"

    db.add(payment)
    db.commit()
    db.refresh(payment)

    return {"success": True, "message": f"Payment status updated to {payload.payment_status}.", "payment": jsonable_encoder(payment)}


# -------------------------------------------------------------------------
# 3rd-Party Paid Services Cost Monitor
# -------------------------------------------------------------------------

@router.get("/cost-monitor", summary="3rd-Party Paid Services Usage & Cost Analytics")
async def get_paid_services_cost_monitor(
    days: int = Query(default=30, ge=1, le=90),
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """
    Returns deep-dive consumption and cost analytics for Google Gemini AI Vision,
    Zoho Books API calls, Mailjet email sends, and Google Workspace operations.
    Includes customer infrastructure cost attribution.
    """
    summary = get_cost_summary(db, days=days)

    # In-memory recent telemetry stream
    with _CALLS_LOCK:
        recent_stream = list(_RECENT_CALLS[:50])

    return {
        "summary": summary,
        "recent_api_calls": jsonable_encoder(recent_stream),
    }


# -------------------------------------------------------------------------
# Global Platform Pricing & Option 2 Booster Rates Catalog
# -------------------------------------------------------------------------

@router.get("/pricing-config", summary="Get Global Pricing Tiers & Booster Rates")
async def get_platform_pricing_config(
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Returns platform subscription tiers, Option 2 booster rates, trial settings, and FX rate."""
    pricing_cfg = db.exec(select(PlatformPricingConfig).where(PlatformPricingConfig.id == 1)).first()
    if not pricing_cfg:
        pricing_cfg = PlatformPricingConfig(id=1)
        db.add(pricing_cfg)
        db.commit()
        db.refresh(pricing_cfg)
    return {"config": jsonable_encoder(pricing_cfg)}


@router.put("/pricing-config", summary="Update Global Pricing Tiers & Booster Rates (Admin)")
async def update_platform_pricing_config(
    payload: UpdatePricingConfigRequest,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Updates standard subscription tiers, booster pack prices, free trial quotas, and FX conversion rates."""
    pricing_cfg = db.exec(select(PlatformPricingConfig).where(PlatformPricingConfig.id == 1)).first()
    if not pricing_cfg:
        pricing_cfg = PlatformPricingConfig(id=1)

    update_data = payload.model_dump(exclude_unset=True)
    for field, val in update_data.items():
        if hasattr(pricing_cfg, field) and val is not None:
            setattr(pricing_cfg, field, val)

    pricing_cfg.updated_at = get_utc_now()
    db.add(pricing_cfg)

    # Optional synchronization to public LandingPageConfig pricing tiers
    if payload.sync_landing_page and payload.tiers:
        landing_cfg = db.exec(select(LandingPageConfig).where(LandingPageConfig.id == 1)).first()
        if landing_cfg:
            new_pricing_tiers = []
            for t in payload.tiers:
                tier_id = t.get("tier_id")
                landing_id = "business" if tier_id == "starter" else ("firm" if tier_id == "pro" else "enterprise")
                new_pricing_tiers.append({
                    "id": landing_id,
                    "title": t.get("name") or ("Boutique & Single Entity" if tier_id == "starter" else ("Accounting & Advisory Firm" if tier_id == "pro" else "Multi-Branch Enterprise")),
                    "subtitle": t.get("description") or "",
                    "price_display": f"GHS {t.get('price_ghs', 0):,.0f}",
                    "period": "/ month",
                    "badge": t.get("badge") or ("Single Business" if tier_id == "starter" else ("Most Popular for CPAs" if tier_id == "pro" else "High Volume")),
                    "is_popular": bool(t.get("is_popular", False)),
                    "features": [
                        f"Up to {t.get('document_allowance', 500):,} monthly documents",
                        "Gemini 2.5/3.6 Flash Vision OCR",
                        f"Up to {t.get('max_clients', 1)} client organization(s)" if t.get('max_clients', 1) > 1 else "Single entity workspace",
                        "Google Sheets & Web Review Inbox",
                        "1-Click Sync to Zoho / QuickBooks",
                        f"Option 2 Rollover Boosters or GHS {t.get('overage_rate_ghs', 1.0):.2f}/slip",
                    ],
                    "cta_text": "Request Free Firm Walkthrough" if tier_id == "pro" else ("Start Free Pilot" if tier_id == "starter" else "Contact Enterprise Team"),
                    "cta_action": "lead_modal",
                })
            landing_cfg.pricing_tiers = new_pricing_tiers
            landing_cfg.updated_at = get_utc_now()
            db.add(landing_cfg)
            logger.info("Synchronized platform pricing tiers to LandingPageConfig.")

    db.commit()
    db.refresh(pricing_cfg)

    logger.info("Updated global PlatformPricingConfig.")
    return {
        "success": True,
        "message": "Global platform pricing catalog and booster rates updated successfully.",
        "config": jsonable_encoder(pricing_cfg),
    }
