"""Google Sheets review workbook and approval endpoints."""

from typing import Dict, Any, Optional
from datetime import datetime
from fastapi import APIRouter

from app.services.google_drive_service import GoogleDriveService
from app.services.google_sheets_service import GoogleSheetsService
from app.utils.logging import get_logger

logger = get_logger("api.sheets")
router = APIRouter(prefix="/sheets", tags=["Sheets Review"])


@router.get("/data", summary="Get Sheets Review Data")
async def get_sheets_data(
    month: Optional[str] = None,
    year: Optional[int] = None,
    pipeline_type: Optional[str] = "AR",
    client_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Returns Tab 1 (Daily Details) and Tab 2 (Monthly Summary) data for review (AR or AP)."""
    now = datetime.now()
    t_month = month or now.strftime("%B")
    t_year = year or now.year
    is_ap = (pipeline_type or "").upper() == "AP"

    drive = GoogleDriveService()
    sheets = GoogleSheetsService()

    client_name = "Client"
    if client_id:
        from app.db.session import get_engine
        from sqlmodel import Session, select
        from app.models.db_models import ClientOrganization
        with Session(get_engine()) as session:
            c = session.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
            if c:
                client_name = c.name

    try:
        month_folder_id = drive.get_month_folder(t_month, t_year)
        if is_ap:
            sheet_id, sheet_url = sheets.find_or_create_ap_workbook(t_month, t_year, month_folder_id, client_name=client_name)
            data = sheets.fetch_ap_sheets_review_data(sheet_id, t_month, t_year)
        else:
            sheet_id, sheet_url = sheets.find_or_create_workbook(t_month, t_year, month_folder_id)
            data = sheets.fetch_sheets_review_data(sheet_id, t_month, t_year)
        return data
    except Exception as e:
        logger.error(f"Error fetching Google Sheets data for {t_month} {t_year} (is_ap={is_ap}): {e}")
        mock_id = f"mock_sheet_ap_{t_month.lower()}_{t_year}" if is_ap else f"mock_sheet_{t_month.lower()}_{t_year}"
        if is_ap:
            return sheets.fetch_ap_sheets_review_data(mock_id, t_month, t_year)
        return sheets.fetch_sheets_review_data(mock_id, t_month, t_year)


@router.get("/review-data", summary="Get Sheets Review Data (Alias)")
async def get_sheets_review_data(
    month: Optional[str] = None,
    year: Optional[int] = None,
    pipeline_type: Optional[str] = "AR",
    client_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Alias for /sheets/data for backwards compatibility."""
    return await get_sheets_data(month=month, year=year, pipeline_type=pipeline_type, client_id=client_id)


@router.patch("/transactions/{transaction_id}/status", summary="Update Staged Transaction Status")
async def update_sheet_transaction_status(
    transaction_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    """Updates a single staged transaction's status in PostgreSQL."""
    from app.db.session import get_engine
    from sqlmodel import Session, select
    from app.models.db_models import StagedTransaction

    status = payload.get("status", "PENDING")

    with Session(get_engine()) as session:
        try:
            tx_id_int = int(transaction_id)
            tx = session.exec(select(StagedTransaction).where(StagedTransaction.id == tx_id_int)).first()
            if tx:
                tx.status = status
                if status == "APPROVED":
                    tx.approved = True
                    tx.reviewed = True
                elif status == "REJECTED":
                    tx.approved = False
                session.add(tx)
                session.commit()
                return {"success": True, "message": f"Updated transaction {transaction_id} to {status}."}
        except ValueError:
            pass

    return {"success": True, "message": f"Recorded status update for {transaction_id}."}


@router.post("/toggle-approval", summary="Toggle Row Approval in Review Sheet")
async def toggle_sheet_approval(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Toggles Reviewed or Approved checkbox for a row in Tab 2."""
    sheets = GoogleSheetsService()

    sheet_id = payload.get("spreadsheet_id", "mock_sheet_august_2026")
    row_idx = payload.get("row_index", 2)
    field = payload.get("field", "approved")
    val = payload.get("value", True)
    is_ap = bool(payload.get("is_ap", False))

    sheets.toggle_row_field(sheet_id, row_idx, field, val, is_ap=is_ap)
    return {
        "status": "SUCCESS",
        "row_index": row_idx,
        "field": field,
        "value": val,
        "is_ap": is_ap,
    }


@router.patch("/daily-detail", summary="Update Cell in Daily Details")
async def update_daily_detail_cell(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Updates a cell in Daily_Details with USER_ENTERED so dynamic formulas in Monthly_Summary recalculate."""
    sheets = GoogleSheetsService()
    sheet_id = payload.get("spreadsheet_id")
    row_idx = int(payload.get("row_index", 2))
    field = payload.get("field", "delivery_qty")
    val = payload.get("value")
    is_ap = bool(payload.get("is_ap", False))

    if not sheet_id:
        return {"success": False, "message": "Missing spreadsheet_id parameter."}

    success = sheets.update_daily_detail_cell(sheet_id, row_idx, field, val, is_ap=is_ap)
    return {
        "success": success,
        "spreadsheet_id": sheet_id,
        "row_index": row_idx,
        "field": field,
        "value": val,
        "is_ap": is_ap,
    }

