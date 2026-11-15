"""General Ledger (GL) Closing & Working Papers API Endpoints."""

from typing import Dict, Any, Optional, List
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlmodel import Session, select, desc

from app.api.deps import require_authenticated_user, verify_client_access
from app.db.session import get_db_session
from app.models.db_models import (
    ClientOrganization,
    ManualJournalWorkingPaper,
    get_utc_now,
)
from app.services.gl_closing_service import GLClosingService
from app.utils.logging import get_logger

logger = get_logger("api.gl_closing")
router = APIRouter(prefix="/gl", tags=["GL Closing & Working Papers"])


class ManualJournalLineCreate(BaseModel):
    account_id: str
    account_name: Optional[str] = ""
    debit_or_credit: str  # "debit" or "credit"
    amount: float
    description: Optional[str] = ""


class CreateWorkingPaperRequest(BaseModel):
    title: str
    adjustment_type: str = "GENERAL_CLOSING"
    standard_reference: Optional[str] = "IFRS"
    entity_policy_applied: Optional[str] = None
    period_month: str = "October"
    period_year: int = 2026
    journal_entries: List[ManualJournalLineCreate]
    math_schedules: Optional[Dict[str, Any]] = None
    memo_markdown: Optional[str] = None
    auto_approve: bool = False


class AuditClosingRequest(BaseModel):
    month: str = "October"
    year: int = 2026
    auto_create_working_papers: bool = True
    auto_approve: bool = False


@router.get("/{client_id}/trial-balance", summary="Fetch Client Trial Balance & General Ledger")
async def get_trial_balance(
    client_id: str,
    month: Optional[str] = Query(None, description="Closing month, e.g. 'October'"),
    year: Optional[int] = Query(None, description="Fiscal year, e.g. 2026"),
    current_user: Dict[str, Any] = Depends(require_authenticated_user),
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Retrieves Trial Balance and General Ledger account balances."""
    user_dict = current_user if isinstance(current_user, dict) else {"is_platform_admin": True}
    client = verify_client_access(db, user_dict, client_id)

    tb = await GLClosingService.fetch_trial_balance(db, client, month=month, year=year)
    return tb


@router.get("/{client_id}/working-papers", summary="List Manual Journal Working Papers")
async def list_working_papers(
    client_id: str,
    year: Optional[int] = Query(None, description="Fiscal year filter"),
    month: Optional[str] = Query(None, description="Closing month filter"),
    status: Optional[str] = Query(None, description="Status filter: DRAFT, SUGGESTED, APPROVED, POSTED_TO_ERP, REJECTED"),
    current_user: Dict[str, Any] = Depends(require_authenticated_user),
    db: Session = Depends(get_db_session),
) -> List[Dict[str, Any]]:
    """Lists auditable working papers and technical memos for manual journals."""
    user_dict = current_user if isinstance(current_user, dict) else {"is_platform_admin": True}
    client = verify_client_access(db, user_dict, client_id)

    query = select(ManualJournalWorkingPaper).where(ManualJournalWorkingPaper.client_id == client.id)
    if year:
        query = query.where(ManualJournalWorkingPaper.period_year == year)
    if month:
        query = query.where(ManualJournalWorkingPaper.period_month.ilike(month))
    if status:
        query = query.where(ManualJournalWorkingPaper.status == status.upper())

    papers = db.exec(query.order_by(desc(ManualJournalWorkingPaper.created_at))).all()
    return [
        {
            "id": p.id,
            "paper_id": p.paper_id,
            "client_id": p.client_id,
            "journal_id": p.journal_id,
            "journal_reference": p.journal_reference,
            "title": p.title,
            "adjustment_type": p.adjustment_type,
            "standard_reference": p.standard_reference,
            "entity_policy_applied": p.entity_policy_applied,
            "period_month": p.period_month,
            "period_year": p.period_year,
            "currency": p.currency,
            "total_debit": p.total_debit,
            "total_credit": p.total_credit,
            "is_balanced": p.is_balanced,
            "status": p.status,
            "entries_count": len((p.journal_payload or {}).get("journal_entries", [])),
            "prepared_by": p.prepared_by,
            "approved_by": p.approved_by,
            "posted_at": p.posted_at.isoformat() if p.posted_at else None,
            "created_at": p.created_at.isoformat(),
        }
        for p in papers
    ]


@router.get("/{client_id}/working-papers/{paper_id}", summary="Get Detailed Working Paper with White Paper Memo")
async def get_working_paper(
    client_id: str,
    paper_id: str,
    current_user: Dict[str, Any] = Depends(require_authenticated_user),
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Retrieves full working paper details including math schedules and technical accounting memo."""
    user_dict = current_user if isinstance(current_user, dict) else {"is_platform_admin": True}
    client = verify_client_access(db, user_dict, client_id)

    wp = db.exec(
        select(ManualJournalWorkingPaper).where(
            ManualJournalWorkingPaper.client_id == client.id,
            ManualJournalWorkingPaper.paper_id == paper_id,
        )
    ).first()

    if not wp:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Working paper '{paper_id}' not found.",
        )

    return {
        "id": wp.id,
        "paper_id": wp.paper_id,
        "client_id": wp.client_id,
        "journal_id": wp.journal_id,
        "journal_reference": wp.journal_reference,
        "title": wp.title,
        "adjustment_type": wp.adjustment_type,
        "standard_reference": wp.standard_reference,
        "entity_policy_applied": wp.entity_policy_applied,
        "period_month": wp.period_month,
        "period_year": wp.period_year,
        "currency": wp.currency,
        "total_debit": wp.total_debit,
        "total_credit": wp.total_credit,
        "is_balanced": wp.is_balanced,
        "status": wp.status,
        "journal_payload": wp.journal_payload,
        "math_schedules": wp.math_schedules,
        "memo_markdown": wp.memo_markdown,
        "attachment_urls": wp.attachment_urls,
        "prepared_by": wp.prepared_by,
        "approved_by": wp.approved_by,
        "posted_at": wp.posted_at.isoformat() if wp.posted_at else None,
        "created_at": wp.created_at.isoformat(),
        "updated_at": wp.updated_at.isoformat(),
    }


@router.post("/{client_id}/working-papers/audit-and-suggest", summary="Audit GL and Suggest Adjusting Working Papers")
async def audit_and_suggest_journals(
    client_id: str,
    req: AuditClosingRequest,
    current_user: Dict[str, Any] = Depends(require_authenticated_user),
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """
    Audits the General Ledger and Trial Balance against elected accounting policies,
    statutory rules, and reporting standards (IFRS, Ghana GRA Act 896).
    Identifies unrecorded adjustments and optionally generates working papers.
    """
    user_dict = current_user if isinstance(current_user, dict) else {"is_platform_admin": True}
    client = verify_client_access(db, user_dict, client_id)

    adjustments = await GLClosingService.audit_closing_adjustments(db, client, month=req.month, year=req.year)

    created_papers: List[Dict[str, Any]] = []
    if req.auto_create_working_papers:
        for adj in adjustments:
            wp = await GLClosingService.create_working_paper(
                db=db,
                client=client,
                adjustment=adj,
                month=req.month,
                year=req.year,
                prepared_by=user_dict.get("email") or "gl_accountant_agent",
                auto_approve=req.auto_approve,
            )
            created_papers.append({
                "paper_id": wp.paper_id,
                "title": wp.title,
                "adjustment_type": wp.adjustment_type,
                "total_debit": wp.total_debit,
                "status": wp.status,
            })

    return {
        "status": "success",
        "client_id": client.id,
        "period": f"{req.month} {req.year}",
        "adjustments_detected": len(adjustments),
        "suggested_adjustments": adjustments,
        "created_working_papers": created_papers,
    }


@router.post("/{client_id}/working-papers", summary="Create Manual Journal Working Paper")
async def create_working_paper(
    client_id: str,
    req: CreateWorkingPaperRequest,
    current_user: Dict[str, Any] = Depends(require_authenticated_user),
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Creates a custom manual journal working paper with mathematical balance validation."""
    user_dict = current_user if isinstance(current_user, dict) else {"is_platform_admin": True}
    client = verify_client_access(db, user_dict, client_id)

    entries = [e.model_dump() for e in req.journal_entries]
    adj = {
        "title": req.title,
        "adjustment_type": req.adjustment_type,
        "standard_reference": req.standard_reference,
        "entity_policy_applied": req.entity_policy_applied,
        "journal_entries": entries,
        "calculation_facts": req.math_schedules or {},
        "reasoning": req.memo_markdown or "Custom journal adjustment prepared by accountant.",
        "currency": client.currency or "GHS",
    }

    wp = await GLClosingService.create_working_paper(
        db=db,
        client=client,
        adjustment=adj,
        month=req.period_month,
        year=req.period_year,
        prepared_by=user_dict.get("email") or "accountant",
        auto_approve=req.auto_approve,
    )

    return {
        "status": "success",
        "paper_id": wp.paper_id,
        "title": wp.title,
        "total_debit": wp.total_debit,
        "total_credit": wp.total_credit,
        "is_balanced": wp.is_balanced,
        "status": wp.status,
    }


@router.post("/{client_id}/working-papers/{paper_id}/approve-and-post", summary="Approve and Post Working Paper Journal to ERP")
async def approve_and_post_journal(
    client_id: str,
    paper_id: str,
    current_user: Dict[str, Any] = Depends(require_authenticated_user),
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Approves a manual journal working paper and posts it to Zoho Books ERP."""
    user_dict = current_user if isinstance(current_user, dict) else {"is_platform_admin": True}
    client = verify_client_access(db, user_dict, client_id)

    result = await GLClosingService.post_working_paper_to_erp(
        db=db,
        client=client,
        paper_id=paper_id,
        approved_by=user_dict.get("email") or "operator",
    )

    return {
        "status": "success",
        "message": f"Working Paper '{paper_id}' successfully posted to Zoho Books.",
        "journal": result,
    }
