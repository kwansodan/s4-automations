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
async def get_sheets_data(month: Optional[str] = None, year: Optional[int] = None) -> Dict[str, Any]:
    """Returns Tab 1 (Daily Details) and Tab 2 (Monthly Summary) data for review."""
    now = datetime.now()
    t_month = month or now.strftime("%B")
    t_year = year or now.year

    drive = GoogleDriveService()
    sheets = GoogleSheetsService()

    try:
        month_folder_id = drive.get_month_folder(t_month, t_year)
        sheet_id, sheet_url = sheets.find_or_create_workbook(t_month, t_year, month_folder_id)
        data = sheets.fetch_sheets_review_data(sheet_id, t_month, t_year)
        return data
    except Exception as e:
        logger.error(f"Error fetching Google Sheets data for {t_month} {t_year}: {e}")
        return sheets.fetch_sheets_review_data(f"mock_sheet_{t_month.lower()}_{t_year}", t_month, t_year)


@router.post("/toggle-approval", summary="Toggle Row Approval in Review Sheet")
async def toggle_sheet_approval(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Toggles Reviewed or Approved checkbox for a row in Tab 2."""
    sheets = GoogleSheetsService()

    sheet_id = payload.get("spreadsheet_id", "mock_sheet_august_2026")
    row_idx = payload.get("row_index", 2)
    field = payload.get("field", "approved")
    val = payload.get("value", True)

    sheets.toggle_row_field(sheet_id, row_idx, field, val)
    return {
        "status": "SUCCESS",
        "row_index": row_idx,
        "field": field,
        "value": val,
    }
