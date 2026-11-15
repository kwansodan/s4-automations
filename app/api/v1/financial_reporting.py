"""Financial Reporting & Statutory Disclosures API Endpoints."""

from typing import Dict, Any, Optional, List
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlmodel import Session, select, desc

from app.api.deps import require_authenticated_user, verify_client_access
from app.db.session import get_db_session
from app.models.db_models import (
    ClientOrganization,
    FinancialStatementReport,
    get_utc_now,
)
from app.services.financial_reporting_service import FinancialReportingService
from app.utils.logging import get_logger

logger = get_logger("api.financial_reporting")
router = APIRouter(prefix="/fr", tags=["Financial Reporting & Disclosures"])


class GenerateReportRequest(BaseModel):
    period_type: str = "MONTHLY"  # MONTHLY, QUARTERLY, ANNUAL
    period_month: Optional[str] = "October"
    period_quarter: Optional[str] = None
    period_year: int = 2026
    reporting_framework: str = "IFRS"  # IFRS, IFRS_FOR_SMES, GHANA_GAAP, US_GAAP


@router.get("/{client_id}/reports", summary="List Generated Financial Statement Reports")
async def list_reports(
    client_id: str,
    year: Optional[int] = Query(None, description="Fiscal year filter"),
    period_type: Optional[str] = Query(None, description="MONTHLY, QUARTERLY, ANNUAL"),
    current_user: Dict[str, Any] = Depends(require_authenticated_user),
    db: Session = Depends(get_db_session),
) -> List[Dict[str, Any]]:
    """Lists synthesized financial statement packs."""
    user_dict = current_user if isinstance(current_user, dict) else {"is_platform_admin": True}
    client = verify_client_access(db, user_dict, client_id)

    query = select(FinancialStatementReport).where(FinancialStatementReport.client_id == client.id)
    if year:
        query = query.where(FinancialStatementReport.period_year == year)
    if period_type:
        query = query.where(FinancialStatementReport.period_type == period_type.upper())

    reports = db.exec(query.order_by(desc(FinancialStatementReport.created_at))).all()
    return [
        {
            "id": r.id,
            "report_id": r.report_id,
            "client_id": r.client_id,
            "report_title": r.report_title,
            "reporting_framework": r.reporting_framework,
            "period_type": r.period_type,
            "period_month": r.period_month,
            "period_quarter": r.period_quarter,
            "period_year": r.period_year,
            "currency": r.currency,
            "is_audited": r.is_audited,
            "status": r.status,
            "revenue": (r.income_statement or {}).get("revenue", 0.0),
            "net_profit": (r.income_statement or {}).get("net_profit_for_period", 0.0),
            "total_assets": (r.balance_sheet or {}).get("total_assets", 0.0),
            "is_balanced": (r.balance_sheet or {}).get("is_balanced", False),
            "notes_count": len(r.notes_to_accounts or []),
            "prepared_by": r.prepared_by,
            "published_at": r.published_at.isoformat() if r.published_at else None,
            "created_at": r.created_at.isoformat(),
        }
        for r in reports
    ]


@router.post("/{client_id}/reports/generate", summary="Synthesize End-of-Period Financial Statements")
async def generate_financial_statement_report(
    client_id: str,
    req: GenerateReportRequest,
    current_user: Dict[str, Any] = Depends(require_authenticated_user),
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """
    Synthesizes a complete financial reporting pack from the adjusted Trial Balance.
    Includes Income Statement, Balance Sheet, Indirect Cash Flow, Statement of Changes
    in Equity, Statutory Notes & Disclosures, Ratios, and MD&A Commentary.
    """
    user_dict = current_user if isinstance(current_user, dict) else {"is_platform_admin": True}
    client = verify_client_access(db, user_dict, client_id)

    report = await FinancialReportingService.synthesize_statement_pack(
        db=db,
        client=client,
        period_type=req.period_type,
        period_month=req.period_month,
        period_quarter=req.period_quarter,
        period_year=req.period_year,
        reporting_framework=req.reporting_framework,
        prepared_by=user_dict.get("email") or "financial_reporting_agent",
    )

    return {
        "status": "success",
        "report_id": report.report_id,
        "report_title": report.report_title,
        "period": f"{report.period_month or report.period_quarter or ''} {report.period_year}",
        "reporting_framework": report.reporting_framework,
        "net_profit": report.income_statement.get("net_profit_for_period"),
        "total_assets": report.balance_sheet.get("total_assets"),
        "is_balanced": report.balance_sheet.get("is_balanced"),
        "published_at": report.published_at.isoformat() if report.published_at else None,
    }


@router.get("/{client_id}/reports/{report_id}", summary="Get Full Financial Statement Pack")
async def get_report_detail(
    client_id: str,
    report_id: str,
    current_user: Dict[str, Any] = Depends(require_authenticated_user),
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Retrieves the full multi-statement reporting pack, disclosures, ratios, and MD&A narrative."""
    user_dict = current_user if isinstance(current_user, dict) else {"is_platform_admin": True}
    client = verify_client_access(db, user_dict, client_id)

    report = db.exec(
        select(FinancialStatementReport).where(
            FinancialStatementReport.client_id == client.id,
            FinancialStatementReport.report_id == report_id,
        )
    ).first()

    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Financial statement report '{report_id}' not found.",
        )

    return {
        "id": report.id,
        "report_id": report.report_id,
        "client_id": report.client_id,
        "report_title": report.report_title,
        "reporting_framework": report.reporting_framework,
        "period_type": report.period_type,
        "period_month": report.period_month,
        "period_quarter": report.period_quarter,
        "period_year": report.period_year,
        "currency": report.currency,
        "is_audited": report.is_audited,
        "status": report.status,
        "income_statement": report.income_statement,
        "balance_sheet": report.balance_sheet,
        "cash_flow_statement": report.cash_flow_statement,
        "equity_statement": report.equity_statement,
        "notes_to_accounts": report.notes_to_accounts,
        "financial_ratios": report.financial_ratios,
        "executive_commentary": report.executive_commentary,
        "prepared_by": report.prepared_by,
        "published_at": report.published_at.isoformat() if report.published_at else None,
        "created_at": report.created_at.isoformat(),
        "updated_at": report.updated_at.isoformat(),
    }
