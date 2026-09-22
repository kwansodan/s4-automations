"""Google Sheets Service for managing the two-tier billing review workbook."""

from datetime import datetime
from typing import List, Dict, Optional, Any, Tuple, Set
from tenacity import retry, stop_after_attempt, wait_exponential

from googleapiclient.errors import HttpError

from app.config import settings
from app.models.schemas import (
    DailySlipDetailRow,
    MonthlySummaryRow,
    APDailyDetailRow,
    APMonthlySummaryRow,
    ConfidenceLevel,
    SlipStatus,
)
from app.utils.auth import get_google_sheets_service, get_google_drive_service
from app.utils.logging import get_logger

logger = get_logger("google_sheets")

TAB_DAILY_DETAILS = "Daily_Slip_Details"
TAB_MONTHLY_SUMMARY = "Monthly_Summary"
TAB_AP_BILLS = "Vendor_Bills"
TAB_AP_DAILY_DETAILS = "Daily_Details"
TAB_AP_MONTHLY_SUMMARY = "Monthly_Summary"

DAILY_DETAILS_HEADERS = [
    "Date",
    "File Name",
    "Client Name",
    "Raw Item Text",
    "Standard Item Name",
    "Pickup Qty",
    "Delivery Qty",
    "Loss Qty",
    "Confidence",
    "Scan Link",
    "Processed At",
]

MONTHLY_SUMMARY_HEADERS = [
    "Client Name",
    "Zoho Contact ID",
    "Zoho Item ID",
    "Standard Item",
    "Raw Names Seen",
    "OCR Confidence",
    "Unit Rate (GHS)",
    "Total Picked Up",
    "Total Delivered",
    "Linen Discrepancy",
    "Total Billed (GHS)",
    "Audit Notes",
    "Reviewed?",
    "Approved?",
    "Status",
]

AP_BILLS_HEADERS = [
    "Date",
    "Vendor Name",
    "Bill #",
    "File Name",
    "Item / Description",
    "Quantity",
    "Unit Rate (GHS)",
    "Total Amount (GHS)",
    "Currency",
    "Status",
    "Accounting Ref",
    "Processed At",
]

AP_DAILY_DETAILS_HEADERS = [
    "Date",
    "Vendor Name",
    "Bill #",
    "File Name",
    "Item / Description",
    "Expense Category",
    "Quantity",
    "Unit Rate (GHS)",
    "Total Amount (GHS)",
    "Currency",
    "Status",
    "Accounting Ref",
    "Scan Link",
    "Processed At",
]

AP_MONTHLY_SUMMARY_HEADERS = [
    "Vendor Name",
    "Zoho Contact ID",
    "Expense Category",
    "Total Bills Count",
    "Total Quantity",
    "Total Billed (GHS)",
    "Currency",
    "Audit Notes",
    "Reviewed?",
    "Approved?",
    "Status",
]


def _parse_float(val: Any, default: float = 0.0) -> float:
    """Safely parses float numbers from Google Sheets cells with commas or currency tags."""
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return float(val)
    cleaned = str(val).replace(",", "").replace("GHS", "").replace("$", "").strip()
    try:
        return float(cleaned)
    except (ValueError, TypeError):
        return default


def _parse_int(val: Any, default: int = 0) -> int:
    """Safely parses integers from Google Sheets cells."""
    if val is None:
        return default
    if isinstance(val, int):
        return val
    if isinstance(val, float):
        return int(val)
    cleaned = str(val).replace(",", "").replace("GHS", "").strip().split(".")[0]
    try:
        return int(cleaned)
    except (ValueError, TypeError):
        return default


class GoogleSheetsService:
    """Manages the creation, formatting, and synchronization of the two-tier review workbook."""

    def __init__(self, sheets_service: Optional[Any] = None, drive_service: Optional[Any] = None):
        self._sheets = sheets_service
        self._drive = drive_service

    @property
    def sheets(self):
        if self._sheets is None and not settings.MOCK_MODE:
            self._sheets = get_google_sheets_service()
        return self._sheets

    @property
    def drive(self):
        if self._drive is None and not settings.MOCK_MODE:
            self._drive = get_google_drive_service()
        return self._drive

    @retry(reraise=True, stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def find_or_create_workbook(
        self,
        month_name: str,
        year: int,
        month_folder_id: Optional[str] = None,
        client_name: str = "ANR",
        client_folder_id: Optional[str] = None,
        explicit_sheet_id: Optional[str] = None,
    ) -> Tuple[str, Optional[str]]:
        """
        Locates or creates the Google Sheet review workbook:
        First checks explicit_sheet_id, then month_folder_id, then client_folder_id,
        then Drive search for existing workbooks before creating a new empty sheet.
        Returns (spreadsheet_id, spreadsheet_url).
        """
        if explicit_sheet_id and not explicit_sheet_id.startswith("mock_"):
            sheet_url = f"https://docs.google.com/spreadsheets/d/{explicit_sheet_id}/edit"
            logger.info(f"Using explicitly specified review workbook (ID: {explicit_sheet_id})")
            return explicit_sheet_id, sheet_url

        safe_client = "".join(c for c in (client_name or "ANR") if c.isalnum() or c in (" ", "_")).strip().replace(" ", "_")
        workbook_title = f"{safe_client}_Billing_Review_{month_name}_{year}" if safe_client else f"ANR_Billing_Review_{month_name}_{year}"

        if settings.MOCK_MODE or not self.sheets or not self.drive:
            logger.info(f"[MOCK] Finding or creating review workbook: {workbook_title}")
            mock_id = f"mock_sheet_{month_name.lower()}_{year}"
            return mock_id, None

        parent_folder = month_folder_id if (month_folder_id and not month_folder_id.startswith("mock_") and month_folder_id != "root") else None
        client_fld = client_folder_id if (client_folder_id and not client_folder_id.startswith("mock_") and client_folder_id != "root") else None

        try:
            # 1. Search month_folder_id if provided
            if parent_folder:
                query = (
                    f"'{parent_folder}' in parents and "
                    f"mimeType = 'application/vnd.google-apps.spreadsheet' and "
                    f"trashed = false"
                )
                res = self.drive.files().list(
                    q=query,
                    spaces="drive",
                    fields="files(id, name, webViewLink)",
                    supportsAllDrives=True,
                    includeItemsFromAllDrives=True,
                    pageSize=20,
                ).execute()
                files = res.get("files", [])
                if files:
                    best_file = files[0]
                    for f in files:
                        fname = f.get("name", "").lower()
                        if month_name.lower() in fname or (safe_client and safe_client.lower() in fname):
                            best_file = f
                            break
                    sheet_id = best_file["id"]
                    sheet_url = best_file.get("webViewLink", f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit")
                    logger.info(f"Found existing review workbook '{best_file.get('name')}' in month folder (ID: {sheet_id})")
                    return sheet_id, sheet_url

            # 2. Search client_folder_id if provided
            if client_fld:
                # Direct spreadsheets in client folder
                query = (
                    f"'{client_fld}' in parents and "
                    f"mimeType = 'application/vnd.google-apps.spreadsheet' and "
                    f"trashed = false"
                )
                res = self.drive.files().list(
                    q=query,
                    spaces="drive",
                    fields="files(id, name, webViewLink)",
                    supportsAllDrives=True,
                    includeItemsFromAllDrives=True,
                    pageSize=30,
                ).execute()
                files = res.get("files", [])
                for f in files:
                    fname = f.get("name", "").lower()
                    if month_name.lower() in fname or month_name[:3].lower() in fname:
                        sheet_id = f["id"]
                        sheet_url = f.get("webViewLink", f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit")
                        logger.info(f"Found existing review workbook '{f.get('name')}' in client folder (ID: {sheet_id})")
                        return sheet_id, sheet_url

                # Subfolders inside client folder matching the month
                try:
                    subfolders_res = self.drive.files().list(
                        q=f"'{client_fld}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
                        spaces="drive",
                        fields="files(id, name)",
                        pageSize=30,
                    ).execute()
                    for sf in subfolders_res.get("files", []):
                        sf_name = sf.get("name", "").lower()
                        if month_name.lower() in sf_name or month_name[:3].lower() in sf_name:
                            sf_id = sf["id"]
                            sf_files = self.drive.files().list(
                                q=f"'{sf_id}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false",
                                spaces="drive",
                                fields="files(id, name, webViewLink)",
                                pageSize=10,
                            ).execute().get("files", [])
                            if sf_files:
                                sheet_id = sf_files[0]["id"]
                                sheet_url = sf_files[0].get("webViewLink", f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit")
                                logger.info(f"Found existing review workbook '{sf_files[0].get('name')}' in client month subfolder (ID: {sheet_id})")
                                return sheet_id, sheet_url
                except Exception as sub_err:
                    logger.debug(f"Notice searching client subfolders: {sub_err}")

            # 3. Search Drive globally for any spreadsheet containing the month and client/billing
            try:
                global_query = (
                    f"mimeType = 'application/vnd.google-apps.spreadsheet' and "
                    f"trashed = false and "
                    f"name contains '{month_name}'"
                )
                res = self.drive.files().list(
                    q=global_query,
                    spaces="drive",
                    fields="files(id, name, webViewLink)",
                    supportsAllDrives=True,
                    includeItemsFromAllDrives=True,
                    pageSize=30,
                ).execute()
                files = res.get("files", [])
                for f in files:
                    fname = f.get("name", "").lower()
                    target_terms = [safe_client.lower(), "anr", "billing", "review"]
                    if any(term in fname for term in target_terms if term):
                        sheet_id = f["id"]
                        sheet_url = f.get("webViewLink", f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit")
                        logger.info(f"Found existing review workbook globally in Drive: '{f.get('name')}' (ID: {sheet_id})")
                        return sheet_id, sheet_url
            except Exception as glob_err:
                logger.debug(f"Notice during global drive search: {glob_err}")

            # 4. If no existing spreadsheet found anywhere, create a new one
            spreadsheet_body = {
                "properties": {"title": workbook_title},
                "sheets": [
                    {"properties": {"title": TAB_MONTHLY_SUMMARY, "index": 0}},
                    {"properties": {"title": TAB_DAILY_DETAILS, "index": 1}},
                ],
            }
            created = self.sheets.spreadsheets().create(body=spreadsheet_body, fields="spreadsheetId,spreadsheetUrl").execute()
            sheet_id = created["spreadsheetId"]
            sheet_url = created["spreadsheetUrl"]

            # Move to target folder if valid
            dest_folder = parent_folder or client_fld
            if dest_folder:
                try:
                    self.drive.files().update(
                        fileId=sheet_id,
                        addParents=dest_folder,
                        fields="id, parents",
                        supportsAllDrives=True,
                    ).execute()
                except Exception as move_err:
                    logger.warning(f"Could not move sheet {sheet_id} to folder {dest_folder}: {move_err}")

            # Initialize headers and styling
            self._initialize_tabs(sheet_id)
            logger.info(f"Created and initialized new review workbook '{workbook_title}' (ID: {sheet_id})")
            return sheet_id, sheet_url
        except HttpError as e:
            if e.resp.status in (404, 403):
                logger.warning(
                    f"Google API returned HTTP {e.resp.status} when locating/creating workbook. Falling back to mock sheet."
                )
                mock_id = f"mock_sheet_{month_name.lower()}_{year}"
                return mock_id, None
            raise

    @retry(reraise=True, stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def find_or_create_ap_workbook(
        self, month_name: str, year: int, month_folder_id: str, client_name: str = "ANR"
    ) -> Tuple[str, Optional[str]]:
        """
        Locates or creates a dedicated Google Sheet AP review workbook:
        '{client_name}_AP_Bills_{Month}_{YYYY}' inside the Month Folder with 2 tabs:
        1. Monthly_Summary (Tab index 0)
        2. Daily_Details (Tab index 1)
        Returns (spreadsheet_id, spreadsheet_url).
        """
        safe_prefix = "".join(c for c in client_name if c.isalnum() or c in (" ", "_")).strip().replace(" ", "_")
        workbook_title = f"{safe_prefix}_AP_Bills_{month_name}_{year}"

        if settings.MOCK_MODE or not self.sheets or not self.drive:
            logger.info(f"[MOCK] Mock mode active: finding or creating AP workbook '{workbook_title}'")
            mock_id = f"mock_sheet_ap_{month_name.lower()}_{year}"
            return mock_id, None

        parent_folder = month_folder_id if (month_folder_id and not month_folder_id.startswith("mock_")) else None

        try:
            # 1. Search if dedicated AP workbook already exists in folder or drive
            query = (
                f"name = '{workbook_title}' and "
                f"mimeType = 'application/vnd.google-apps.spreadsheet' and "
                f"trashed = false"
            )
            if parent_folder and parent_folder != "root":
                query += f" and '{parent_folder}' in parents"

            res = self.drive.files().list(
                q=query,
                spaces="drive",
                fields="files(id, name, webViewLink)",
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
                pageSize=10,
            ).execute()
            files = res.get("files", [])
            if files:
                sheet_id = files[0]["id"]
                sheet_url = files[0].get("webViewLink", f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit")
                logger.info(f"Found existing AP review workbook '{workbook_title}' (ID: {sheet_id})")
                self._ensure_ap_tab_exists(sheet_id, TAB_AP_MONTHLY_SUMMARY, AP_MONTHLY_SUMMARY_HEADERS)
                self._ensure_ap_tab_exists(sheet_id, TAB_AP_DAILY_DETAILS, AP_DAILY_DETAILS_HEADERS)
                return sheet_id, sheet_url

            # 2. Try creating new dedicated AP spreadsheet with 2 tabs
            try:
                spreadsheet_body = {
                    "properties": {"title": workbook_title},
                    "sheets": [
                        {"properties": {"title": TAB_AP_MONTHLY_SUMMARY, "index": 0}},
                        {"properties": {"title": TAB_AP_DAILY_DETAILS, "index": 1}},
                    ],
                }
                created = self.sheets.spreadsheets().create(
                    body=spreadsheet_body, fields="spreadsheetId,spreadsheetUrl"
                ).execute()
                sheet_id = created["spreadsheetId"]
                sheet_url = created["spreadsheetUrl"]

                # Move to parent folder if specified
                if parent_folder and parent_folder != "root":
                    try:
                        self.drive.files().update(
                            fileId=sheet_id,
                            addParents=parent_folder,
                            fields="id, parents",
                            supportsAllDrives=True,
                        ).execute()
                    except Exception as move_err:
                        logger.warning(f"Could not move AP sheet {sheet_id} to folder {parent_folder}: {move_err}")

                # Initialize headers and styling
                self._format_ap_workbook(sheet_id)
                logger.info(f"Created and formatted 2-tab AP review workbook '{workbook_title}' (ID: {sheet_id})")
                return sheet_id, sheet_url

            except Exception as create_err:
                logger.warning(f"Could not create standalone AP spreadsheet in folder: {create_err}. Checking for existing shared workbook...")

            # 3. Fallback: Check if an existing review workbook exists in folder, attach AP tabs to it
            if parent_folder and parent_folder != "root":
                try:
                    q_existing = (
                        f"'{parent_folder}' in parents and "
                        f"mimeType = 'application/vnd.google-apps.spreadsheet' and "
                        f"trashed = false"
                    )
                    existing_res = self.drive.files().list(
                        q=q_existing,
                        spaces="drive",
                        fields="files(id, name, webViewLink)",
                        supportsAllDrives=True,
                        includeItemsFromAllDrives=True,
                    ).execute()
                    ext_files = existing_res.get("files", [])
                    if ext_files:
                        existing_sheet_id = ext_files[0]["id"]
                        existing_sheet_url = ext_files[0].get("webViewLink", f"https://docs.google.com/spreadsheets/d/{existing_sheet_id}/edit")
                        self._ensure_ap_tab_exists(existing_sheet_id, TAB_AP_MONTHLY_SUMMARY, AP_MONTHLY_SUMMARY_HEADERS)
                        self._ensure_ap_tab_exists(existing_sheet_id, TAB_AP_DAILY_DETAILS, AP_DAILY_DETAILS_HEADERS)
                        logger.info(f"Attached 2 AP tabs to existing shared review sheet '{ext_files[0]['name']}' (ID: {existing_sheet_id})")
                        return existing_sheet_id, existing_sheet_url
                except Exception as fb_err:
                    logger.warning(f"Attaching AP tabs fallback notice: {fb_err}")

            mock_id = f"mock_sheet_ap_{month_name.lower()}_{year}"
            return mock_id, None

        except Exception as e:
            logger.error(f"Error finding or creating AP workbook: {e}")
            mock_id = f"mock_sheet_ap_{month_name.lower()}_{year}"
            return mock_id, None

    def _format_ap_workbook(self, spreadsheet_id: str):
        """Applies headers, freeze row, and checkbox validation to AP 2-tab review workbook."""
        if settings.MOCK_MODE or not self.sheets:
            return

        # Write header values to both tabs
        self.sheets.spreadsheets().values().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={
                "valueInputOption": "RAW",
                "data": [
                    {
                        "range": f"'{TAB_AP_MONTHLY_SUMMARY}'!A1:K1",
                        "values": [AP_MONTHLY_SUMMARY_HEADERS],
                    },
                    {
                        "range": f"'{TAB_AP_DAILY_DETAILS}'!A1:N1",
                        "values": [AP_DAILY_DETAILS_HEADERS],
                    },
                ],
            },
        ).execute()

        # Get sheet IDs for styling
        sheet_meta = self.sheets.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
        monthly_sheet_id = None
        daily_sheet_id = None
        for s in sheet_meta.get("sheets", []):
            if s["properties"]["title"] == TAB_AP_MONTHLY_SUMMARY:
                monthly_sheet_id = s["properties"]["sheetId"]
            elif s["properties"]["title"] == TAB_AP_DAILY_DETAILS:
                daily_sheet_id = s["properties"]["sheetId"]

        requests = []
        for s_id in [monthly_sheet_id, daily_sheet_id]:
            if s_id is None:
                continue
            requests.append({
                "repeatCell": {
                    "range": {
                        "sheetId": s_id,
                        "startRowIndex": 0,
                        "endRowIndex": 1,
                    },
                    "cell": {
                        "userEnteredFormat": {
                            "backgroundColor": {"red": 0.10, "green": 0.21, "blue": 0.36},
                            "textFormat": {
                                "bold": True,
                                "foregroundColor": {"red": 1.0, "green": 1.0, "blue": 1.0},
                                "fontSize": 10,
                            },
                            "horizontalAlignment": "CENTER",
                        }
                    },
                    "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
                }
            })
            requests.append({
                "updateSheetProperties": {
                    "properties": {
                        "sheetId": s_id,
                        "gridProperties": {"frozenRowCount": 1},
                    },
                    "fields": "gridProperties.frozenRowCount",
                }
            })

        # Add Checkbox data validation on Monthly_Summary for Reviewed? (col I / idx 8) & Approved? (col J / idx 9)
        if monthly_sheet_id is not None:
            for col_idx in [8, 9]:
                requests.append({
                    "setDataValidation": {
                        "range": {
                            "sheetId": monthly_sheet_id,
                            "startRowIndex": 1,
                            "startColumnIndex": col_idx,
                            "endColumnIndex": col_idx + 1,
                        },
                        "rule": {
                            "condition": {"type": "BOOLEAN"},
                            "showCustomUi": True,
                        },
                    }
                })

        if requests:
            self.sheets.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id, body={"requests": requests}
            ).execute()

    def _ensure_tab_exists(
        self,
        spreadsheet_id: str,
        tab_title: str,
        headers: List[str],
        fallback_candidates: Optional[List[str]] = None,
    ) -> str:
        """
        Ensures the specified tab exists in spreadsheet.
        If any fallback_candidates already exist in the spreadsheet, returns the existing candidate's title.
        If neither tab_title nor any fallback candidates exist, creates tab_title with formatted headers.
        Returns the resolved tab title.
        """
        if settings.MOCK_MODE or not self.sheets or not spreadsheet_id or spreadsheet_id.startswith("mock_"):
            return tab_title
        try:
            sheet_meta = self.sheets.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
            titles = [s["properties"]["title"] for s in sheet_meta.get("sheets", [])]
            if tab_title in titles:
                return tab_title

            # Check fallbacks
            candidates = fallback_candidates or []
            norm_preferred = tab_title.lower().replace("_", " ").strip()
            for cand in candidates:
                if cand in titles:
                    logger.info(f"Using existing tab '{cand}' for '{tab_title}' in {spreadsheet_id}")
                    return cand
                norm_cand = cand.lower().replace("_", " ").strip()
                for t in titles:
                    norm_t = t.lower().replace("_", " ").strip()
                    if norm_t == norm_cand or norm_t == norm_preferred:
                        logger.info(f"Using existing tab '{t}' for '{tab_title}' in {spreadsheet_id}")
                        return t

            add_res = self.sheets.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"requests": [{"addSheet": {"properties": {"title": tab_title}}}]}
            ).execute()
            new_sheet_id = add_res.get("replies", [{}])[0].get("addSheet", {}).get("properties", {}).get("sheetId")
            end_col = chr(ord('A') + len(headers) - 1) if len(headers) <= 26 else "Z"
            self.sheets.spreadsheets().values().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={
                    "valueInputOption": "RAW",
                    "data": [{"range": f"'{tab_title}'!A1:{end_col}1", "values": [headers]}],
                }
            ).execute()
            if new_sheet_id is not None:
                self.sheets.spreadsheets().batchUpdate(
                    spreadsheetId=spreadsheet_id,
                    body={
                        "requests": [
                            {
                                "repeatCell": {
                                    "range": {"sheetId": new_sheet_id, "startRowIndex": 0, "endRowIndex": 1},
                                    "cell": {
                                        "userEnteredFormat": {
                                            "backgroundColor": {"red": 0.10, "green": 0.21, "blue": 0.36},
                                            "textFormat": {"bold": True, "foregroundColor": {"red": 1.0, "green": 1.0, "blue": 1.0}, "fontSize": 10},
                                            "horizontalAlignment": "CENTER",
                                        }
                                    },
                                    "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
                                }
                            },
                            {
                                "updateSheetProperties": {
                                    "properties": {"sheetId": new_sheet_id, "gridProperties": {"frozenRowCount": 1}},
                                    "fields": "gridProperties.frozenRowCount",
                                }
                            }
                        ]
                    }
                ).execute()
            logger.info(f"Created and initialized tab '{tab_title}' in {spreadsheet_id}")
            return tab_title
        except Exception as err:
            logger.debug(f"Notice ensuring tab '{tab_title}' exists: {err}")
            return tab_title

    def _ensure_ap_tab_exists(self, spreadsheet_id: str, tab_title: str, headers: List[str]):
        """Legacy wrapper pointing to _ensure_tab_exists."""
        return self._ensure_tab_exists(spreadsheet_id, tab_title, headers)

    @retry(reraise=True, stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def append_ap_daily_details(self, spreadsheet_id: str, rows: List[APDailyDetailRow]) -> int:
        """Appends individual vendor bill line items to Tab 1: Daily_Details."""
        if not rows:
            return 0

        if settings.MOCK_MODE or not self.sheets or not spreadsheet_id or spreadsheet_id.startswith("mock_"):
            logger.info(f"[MOCK] Appended {len(rows)} AP bill rows to {TAB_AP_DAILY_DETAILS}")
            return len(rows)

        self._ensure_ap_tab_exists(spreadsheet_id, TAB_AP_DAILY_DETAILS, AP_DAILY_DETAILS_HEADERS)

        # Determine starting row in TAB_AP_DAILY_DETAILS
        existing_res = self.sheets.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"'{TAB_AP_DAILY_DETAILS}'!A:A"
        ).execute()
        existing_count = len(existing_res.get("values", []))
        start_row = max(2, existing_count + 1)

        values = [row.to_sheet_row(row_index=start_row + i) for i, row in enumerate(rows)]
        range_name = f"'{TAB_AP_DAILY_DETAILS}'!A:N"

        self.sheets.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            valueInputOption="USER_ENTERED",
            body={"values": values},
        ).execute()

        logger.info(f"Successfully appended {len(rows)} AP detail rows (starting at row {start_row}) to {TAB_AP_DAILY_DETAILS}")
        return len(rows)

    @retry(reraise=True, stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def sync_ap_monthly_summaries(self, spreadsheet_id: str, summary_rows: List[APMonthlySummaryRow]) -> int:
        """
        Synchronizes monthly vendor summary rows to Tab 2: Monthly_Summary.
        Upserts rows matching (Vendor Name + Expense Category).
        Uses dynamic Google Sheets formulas (COUNTIFS, SUMIFS) referencing Tab 1: Daily_Details.
        Preserves user 'Reviewed?' and 'Approved?' checkboxes if already checked.
        """
        if not summary_rows:
            return 0

        if settings.MOCK_MODE or not self.sheets or not spreadsheet_id or spreadsheet_id.startswith("mock_"):
            logger.info(f"[MOCK] Synchronized {len(summary_rows)} AP summary rows to {TAB_AP_MONTHLY_SUMMARY}")
            return len(summary_rows)

        self._ensure_ap_tab_exists(spreadsheet_id, TAB_AP_MONTHLY_SUMMARY, AP_MONTHLY_SUMMARY_HEADERS)

        # Read existing rows from Monthly_Summary
        res = self.sheets.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"'{TAB_AP_MONTHLY_SUMMARY}'!A2:K500"
        ).execute()
        existing_values = res.get("values", [])

        # Index existing rows by key: (vendor_name.lower(), expense_category.lower())
        existing_map: Dict[Tuple[str, str], Tuple[int, List[Any]]] = {}
        for idx, row in enumerate(existing_values, start=2):
            if not row:
                continue
            v_name = str(row[0]).strip().lower() if len(row) > 0 else ""
            cat_name = str(row[2]).strip().lower() if len(row) > 2 else ""
            key = (v_name, cat_name)
            existing_map[key] = (idx, row)

        updates = []
        appends = []
        start_append_row = len(existing_values) + 2

        for summary in summary_rows:
            key = (summary.vendor_name.strip().lower(), summary.expense_category.strip().lower())
            
            if key in existing_map:
                row_idx, old_row = existing_map[key]
                old_reviewed = old_row[8] if len(old_row) > 8 else summary.reviewed
                old_approved = old_row[9] if len(old_row) > 9 else summary.approved
                old_status = old_row[10] if len(old_row) > 10 else summary.status

                if isinstance(old_reviewed, str):
                    old_reviewed = old_reviewed.upper() in ["TRUE", "YES", "1"]
                if isinstance(old_approved, str):
                    old_approved = old_approved.upper() in ["TRUE", "YES", "1"]

                summary.reviewed = bool(old_reviewed)
                summary.approved = bool(old_approved)
                if old_status:
                    summary.status = str(old_status)

                updates.append({
                    "range": f"'{TAB_AP_MONTHLY_SUMMARY}'!A{row_idx}:K{row_idx}",
                    "values": [summary.to_sheet_row(row_index=row_idx)],
                })
            else:
                row_idx = start_append_row + len(appends)
                appends.append(summary.to_sheet_row(row_index=row_idx))

        if updates:
            self.sheets.spreadsheets().values().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"valueInputOption": "USER_ENTERED", "data": updates},
            ).execute()

        if appends:
            self.sheets.spreadsheets().values().append(
                spreadsheetId=spreadsheet_id,
                range=f"'{TAB_AP_MONTHLY_SUMMARY}'!A:K",
                valueInputOption="USER_ENTERED",
                body={"values": appends},
            ).execute()

        logger.info(f"Successfully synced {len(summary_rows)} AP summary rows with dynamic formulas ({len(updates)} updated, {len(appends)} appended) to {TAB_AP_MONTHLY_SUMMARY}")
        return len(summary_rows)

    def sync_ap_review_workspace(
        self,
        spreadsheet_id: str,
        items: List[Any],
        auto_post: bool = False,
        client_name: str = "Client",
    ) -> Dict[str, Any]:
        """
        Populates both Tab 1 (Daily_Details) and Tab 2 (Monthly_Summary) for AP vendor bills.
        Accepts list of ExtractedLineItem or bill dictionaries.
        """
        if not items:
            return {"daily_rows_written": 0, "summary_rows_synced": 0}

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        daily_rows: List[APDailyDetailRow] = []

        summary_map: Dict[Tuple[str, str], Dict[str, Any]] = {}

        for it in items:
            raw = getattr(it, "raw_extracted_data", {}) or (it if isinstance(it, dict) else {})
            b_date = raw.get("date") or raw.get("bill_date") or getattr(it, "transaction_date", "") or datetime.now().strftime("%Y-%m-%d")
            v_name = raw.get("vendor") or raw.get("vendor_name") or getattr(it, "vendor_name", "") or client_name or "Vendor"
            b_num = raw.get("bill_number") or ""
            f_name = raw.get("file_name") or getattr(it, "source_file_name", "") or ""
            desc = getattr(it, "item_or_description", None) or raw.get("item_description") or raw.get("description") or "Vendor Bill Item"
            cat = getattr(it, "category_or_account", None) or raw.get("expense_category") or raw.get("category") or "Operating Expense"
            qty = float(getattr(it, "quantity_or_debit", 1.0) or 1.0)
            rate = float(getattr(it, "unit_price", 0.0) or getattr(it, "rate_or_price", 0.0) or 0.0)
            tot = float(getattr(it, "total_amount", 0.0) or 0.0)
            if tot == 0.0 and rate > 0:
                tot = rate * qty
            elif rate == 0.0 and qty > 0 and tot > 0:
                rate = tot / qty
            curr = raw.get("currency", "GHS")
            st = getattr(it, "status", None) or ("BILLED" if auto_post else "PENDING")
            doc_ref = getattr(it, "accounting_ref_id", None) or raw.get("accounting_ref_id") or ""
            scan_url = raw.get("drive_file_url") or raw.get("scan_url") or ""

            daily_rows.append(
                APDailyDetailRow(
                    bill_date=str(b_date),
                    vendor_name=str(v_name),
                    bill_number=str(b_num),
                    file_name=str(f_name),
                    item_description=str(desc),
                    expense_category=str(cat),
                    quantity=qty,
                    unit_rate=rate,
                    total_amount=tot,
                    currency=str(curr),
                    status=str(st),
                    accounting_ref=str(doc_ref),
                    scan_url=str(scan_url),
                    processed_at=now_str,
                )
            )

            key = (str(v_name).strip(), str(cat).strip())
            if key not in summary_map:
                summary_map[key] = {
                    "vendor_name": str(v_name).strip(),
                    "zoho_contact_id": raw.get("vendor_id") or "",
                    "expense_category": str(cat).strip(),
                    "bills_count": set(),
                    "total_quantity": 0.0,
                    "total_amount": 0.0,
                    "currency": str(curr),
                }
            bill_identifier = str(b_num).strip() or str(f_name).strip() or f"item_{len(daily_rows)}"
            summary_map[key]["bills_count"].add(bill_identifier)
            summary_map[key]["total_quantity"] += qty
            summary_map[key]["total_amount"] += tot

        summary_rows: List[APMonthlySummaryRow] = []
        for data in summary_map.values():
            summary_rows.append(
                APMonthlySummaryRow(
                    vendor_name=data["vendor_name"],
                    zoho_contact_id=data["zoho_contact_id"],
                    expense_category=data["expense_category"],
                    total_bills_count=len(data["bills_count"]),
                    total_quantity=data["total_quantity"],
                    total_amount=data["total_amount"],
                    currency=data["currency"],
                    audit_notes="Auto-Posted Live" if auto_post else "Pending Accountant Review",
                    reviewed=bool(auto_post),
                    approved=bool(auto_post),
                    status="BILLED" if auto_post else "PENDING",
                )
            )

        daily_count = self.append_ap_daily_details(spreadsheet_id, daily_rows)
        summary_count = self.sync_ap_monthly_summaries(spreadsheet_id, summary_rows)

        return {
            "spreadsheet_id": spreadsheet_id,
            "daily_rows_written": daily_count,
            "summary_rows_synced": summary_count,
        }

    def append_ap_vendor_bills(self, spreadsheet_id: str, items: List[Any], auto_post: bool = False, client_name: str = "Client"):
        """Wrapper ensuring backwards compatibility: routes to 2-tab sync_ap_review_workspace."""
        return self.sync_ap_review_workspace(spreadsheet_id, items, auto_post=auto_post, client_name=client_name)

    def _initialize_tabs(self, spreadsheet_id: str):
        """Initializes headers, column formats, frozen rows, and conditional formatting."""
        # 1. Write Header Rows
        self.sheets.spreadsheets().values().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={
                "valueInputOption": "RAW",
                "data": [
                    {
                        "range": f"'{TAB_MONTHLY_SUMMARY}'!A1:O1",
                        "values": [MONTHLY_SUMMARY_HEADERS],
                    },
                    {
                        "range": f"'{TAB_DAILY_DETAILS}'!A1:K1",
                        "values": [DAILY_DETAILS_HEADERS],
                    },
                ],
            },
        ).execute()

        # 2. Get Sheet IDs for applying styles & validations
        sheet_meta = self.sheets.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
        tab_ids = {s["properties"]["title"]: s["properties"]["sheetId"] for s in sheet_meta.get("sheets", [])}

        monthly_sheet_id = tab_ids.get(TAB_MONTHLY_SUMMARY)
        daily_sheet_id = tab_ids.get(TAB_DAILY_DETAILS)

        requests = []

        # Format Headers: Navy Blue (#1A365D), Bold, White text, Freeze row 1
        for sheet_id in [monthly_sheet_id, daily_sheet_id]:
            if sheet_id is None:
                continue
            requests.append({
                "repeatCell": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": 0,
                        "endRowIndex": 1,
                    },
                    "cell": {
                        "userEnteredFormat": {
                            "backgroundColor": {"red": 0.10, "green": 0.21, "blue": 0.36},
                            "textFormat": {"bold": True, "foregroundColor": {"red": 1.0, "green": 1.0, "blue": 1.0}, "fontSize": 10},
                            "horizontalAlignment": "CENTER",
                        }
                    },
                    "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
                }
            })
            requests.append({
                "updateSheetProperties": {
                    "properties": {
                        "sheetId": sheet_id,
                        "gridProperties": {"frozenRowCount": 1},
                    },
                    "fields": "gridProperties.frozenRowCount",
                }
            })

        # Add Checkbox data validation on Monthly_Summary for Reviewed? (col M / idx 12) & Approved? (col N / idx 13)
        if monthly_sheet_id is not None:
            for col_idx in [12, 13]:
                requests.append({
                    "setDataValidation": {
                        "range": {
                            "sheetId": monthly_sheet_id,
                            "startRowIndex": 1,
                            "startColumnIndex": col_idx,
                            "endColumnIndex": col_idx + 1,
                        },
                        "rule": {
                            "condition": {"type": "BOOLEAN"},
                            "showCustomUi": True,
                        },
                    }
                })

            # Conditional Formatting for Confidence column (Col F / idx 5):
            # LOW = light orange (#FFE0B2), MEDIUM = light yellow (#FFF9C4), HIGH = light green (#C8E6C9)
            confidence_colors = [
                ("LOW", {"red": 1.0, "green": 0.88, "blue": 0.70}),
                ("MEDIUM", {"red": 1.0, "green": 0.98, "blue": 0.77}),
                ("HIGH", {"red": 0.78, "green": 0.90, "blue": 0.79}),
            ]
            for val, color in confidence_colors:
                requests.append({
                    "addConditionalFormatRule": {
                        "rule": {
                            "ranges": [{
                                "sheetId": monthly_sheet_id,
                                "startRowIndex": 1,
                                "startColumnIndex": 5,
                                "endColumnIndex": 6,
                            }],
                            "booleanRule": {
                                "condition": {
                                    "type": "TEXT_EQ",
                                    "values": [{"userEnteredValue": val}],
                                },
                                "format": {
                                    "backgroundColor": color,
                                    "textFormat": {"bold": True},
                                },
                            },
                        },
                        "index": 0,
                    }
                })

        if requests:
            self.sheets.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id, body={"requests": requests}
            ).execute()

    @retry(reraise=True, stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def append_daily_slip_details(self, spreadsheet_id: str, rows: List[DailySlipDetailRow]) -> int:
        """Appends individual line items to Tab 1: Daily_Details or Daily_Slip_Details."""
        if not rows:
            return 0

        if settings.MOCK_MODE or not self.sheets or not spreadsheet_id or spreadsheet_id.startswith("mock_"):
            logger.info(f"[MOCK] Appended {len(rows)} rows to {TAB_DAILY_DETAILS}")
            return len(rows)

        target_tab = self._ensure_tab_exists(
            spreadsheet_id=spreadsheet_id,
            tab_title=TAB_DAILY_DETAILS,
            headers=DAILY_DETAILS_HEADERS,
            fallback_candidates=["Daily Details", "Daily_Details", "Slip Details", "Daily_Slip_Details", "Slips"],
        )

        # Determine starting row in target_tab
        res = self.sheets.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"'{target_tab}'!A:A"
        ).execute()
        existing_count = len(res.get("values", []))
        start_row = max(2, existing_count + 1)

        values = [row.to_sheet_row(row_index=start_row + i) for i, row in enumerate(rows)]
        range_name = f"'{target_tab}'!A:K"

        self.sheets.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            valueInputOption="USER_ENTERED",  # Required to render =HYPERLINK formula and =MAX formula
            body={"values": values},
        ).execute()

        logger.info(f"Successfully appended {len(rows)} detail rows (starting at row {start_row}) to {target_tab}")
        return len(rows)

    def get_existing_filenames_in_workbook(self, spreadsheet_id: str, is_ap: bool = False) -> Set[str]:
        """Returns set of lowercased file names currently recorded in Tab 1 (Daily_Details or Daily_Slip_Details)."""
        if not spreadsheet_id or spreadsheet_id.startswith("mock_") or not self.sheets:
            return set()
        try:
            if is_ap:
                candidate_tabs = [TAB_AP_DAILY_DETAILS, TAB_AP_BILLS, "Daily_Details", "Vendor_Bills"]
            else:
                candidate_tabs = [TAB_DAILY_DETAILS, "Daily_Slip_Details"]

            values = []
            for t_name in candidate_tabs:
                try:
                    col_range = f"'{t_name}'!D2:D5000" if is_ap else f"'{t_name}'!B2:B5000"
                    res = self.sheets.spreadsheets().values().get(
                        spreadsheetId=spreadsheet_id,
                        range=col_range,
                    ).execute()
                    values = res.get("values", [])
                    if values:
                        break
                except Exception:
                    continue

            return {
                str(row[0]).strip().lower()
                for row in values
                if row and len(row) > 0 and str(row[0]).strip()
            }
        except Exception as e:
            logger.debug(f"Could not read existing filenames from sheet {spreadsheet_id}: {e}")
            return set()

    @retry(reraise=True, stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def sync_monthly_summaries(self, spreadsheet_id: str, summary_rows: List[MonthlySummaryRow]) -> int:
        """
        Synchronizes monthly SKU summary rows to Tab 2: Monthly_Summary.
        Upserts rows matching (Client Name + Zoho Item ID).
        Uses dynamic Google Sheets formulas (SUMIFS, MAX, ROUND) referencing Tab 1 (Daily_Details or Daily_Slip_Details).
        Preserves user 'Reviewed?' and 'Approved?' checkboxes if already checked.
        """
        if not summary_rows:
            return 0

        if settings.MOCK_MODE or not self.sheets or not spreadsheet_id or spreadsheet_id.startswith("mock_"):
            logger.info(f"[MOCK] Synchronized {len(summary_rows)} SKU rows to {TAB_MONTHLY_SUMMARY}")
            return len(summary_rows)

        target_tab = self._ensure_tab_exists(
            spreadsheet_id=spreadsheet_id,
            tab_title=TAB_MONTHLY_SUMMARY,
            headers=MONTHLY_SUMMARY_HEADERS,
            fallback_candidates=["Monthly Summary", "Monthly_Summary", "Summary", "Monthly"],
        )

        detail_tab = self._ensure_tab_exists(
            spreadsheet_id=spreadsheet_id,
            tab_title=TAB_DAILY_DETAILS,
            headers=DAILY_DETAILS_HEADERS,
            fallback_candidates=["Daily Details", "Daily_Details", "Slip Details", "Daily_Slip_Details", "Slips"],
        )

        # Read existing rows from target_tab
        res = self.sheets.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"'{target_tab}'!A2:O500"
        ).execute()
        existing_values = res.get("values", [])

        # Index existing rows by key: (client_name.lower(), zoho_item_id or standard_item_name.lower())
        existing_map: Dict[Tuple[str, str], Tuple[int, List[Any]]] = {}
        for idx, row in enumerate(existing_values, start=2):
            if not row:
                continue
            client = str(row[0]).strip().lower() if len(row) > 0 else ""
            item_id = str(row[2]).strip().lower() if len(row) > 2 else ""
            std_name = str(row[3]).strip().lower() if len(row) > 3 else ""
            key = (client, item_id or std_name)
            existing_map[key] = (idx, row)

        updates = []
        appends = []
        start_append_row = len(existing_values) + 2

        for summary in summary_rows:
            key = (summary.client_name.strip().lower(), (summary.zoho_item_id or summary.standard_item_name).strip().lower())
            
            if key in existing_map:
                row_idx, old_row = existing_map[key]
                # Preserve existing review/approval state if already toggled by user
                old_reviewed = old_row[12] if len(old_row) > 12 else summary.reviewed
                old_approved = old_row[13] if len(old_row) > 13 else summary.approved
                old_status = old_row[14] if len(old_row) > 14 else summary.status.value

                # Convert boolean strings if any
                if isinstance(old_reviewed, str):
                    old_reviewed = old_reviewed.upper() == "TRUE"
                if isinstance(old_approved, str):
                    old_approved = old_approved.upper() == "TRUE"

                summary.reviewed = bool(old_reviewed)
                summary.approved = bool(old_approved)
                if old_status in [s.value for s in SlipStatus]:
                    summary.status = SlipStatus(old_status)

                updates.append({
                    "range": f"'{target_tab}'!A{row_idx}:O{row_idx}",
                    "values": [summary.to_sheet_row(row_index=row_idx, daily_tab_name=detail_tab)],
                })
            else:
                row_idx = start_append_row + len(appends)
                appends.append(summary.to_sheet_row(row_index=row_idx, daily_tab_name=detail_tab))

        if updates:
            self.sheets.spreadsheets().values().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"valueInputOption": "USER_ENTERED", "data": updates},
            ).execute()

        if appends:
            self.sheets.spreadsheets().values().append(
                spreadsheetId=spreadsheet_id,
                range=f"'{target_tab}'!A:O",
                valueInputOption="USER_ENTERED",
                body={"values": appends},
            ).execute()
        logger.info(f"Successfully synced {len(summary_rows)} SKU summary rows with dynamic formulas ({len(updates)} updated, {len(appends)} appended) to {target_tab}")
        return len(summary_rows)

    @retry(reraise=True, stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def fetch_approved_monthly_rows(self, spreadsheet_id: str) -> List[Dict[str, Any]]:
        """
        Reads Tab 2: Monthly_Summary and returns all rows where:
        'Approved?' == True and 'Status' in ['PENDING', 'APPROVED'].
        Returns row dictionaries with row index for subsequent status updates.
        """
        if settings.MOCK_MODE or not self.sheets:
            logger.info(f"[MOCK] Fetching approved rows from {spreadsheet_id}")
            return [
                {
                    "row_index": 2,
                    "client_name": "Luxwood",
                    "zoho_contact_id": "cnt_luxwood_001",
                    "zoho_item_id": "item_bed_sheet_dbl",
                    "standard_item_name": "Bed Sheet (Double / King)",
                    "raw_names_seen": "B/Sheet Dbl",
                    "confidence_score": "HIGH",
                    "unit_rate": 18.50,
                    "total_picked_up": 45,
                    "total_delivered": 42,
                    "linen_discrepancy": 3,
                    "total_billed": 832.50,
                    "audit_notes": "Pickup 45, Delivered 42 (3 unreturned)",
                    "reviewed": True,
                    "approved": True,
                    "status": "PENDING",
                },
                {
                    "row_index": 3,
                    "client_name": "Luxwood",
                    "zoho_contact_id": "cnt_luxwood_001",
                    "zoho_item_id": "item_bath_towel",
                    "standard_item_name": "Bath Towel",
                    "raw_names_seen": "Bath Towel",
                    "confidence_score": "HIGH",
                    "unit_rate": 12.00,
                    "total_picked_up": 60,
                    "total_delivered": 60,
                    "linen_discrepancy": 0,
                    "total_billed": 720.00,
                    "audit_notes": "Pickup 60, Delivered 60",
                    "reviewed": True,
                    "approved": True,
                    "status": "PENDING",
                },
            ]

        res = self.sheets.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"'{TAB_MONTHLY_SUMMARY}'!A2:O500",
            valueRenderOption="UNFORMATTED_VALUE",
        ).execute()

        rows = res.get("values", [])
        approved_items = []

        for idx, row in enumerate(rows, start=2):
            if len(row) < 14:
                continue

            approved_val = row[13] if len(row) > 13 else False
            status_val = row[14] if len(row) > 14 else "PENDING"

            is_approved = False
            if isinstance(approved_val, bool):
                is_approved = approved_val
            elif isinstance(approved_val, str):
                is_approved = approved_val.strip().upper() in ["TRUE", "YES", "1"]

            if is_approved and status_val.upper() in ["PENDING", "APPROVED"]:
                approved_items.append({
                    "row_index": idx,
                    "client_name": str(row[0]).strip() if len(row) > 0 else "",
                    "zoho_contact_id": str(row[1]).strip() if len(row) > 1 else "",
                    "zoho_item_id": str(row[2]).strip() if len(row) > 2 else "",
                    "standard_item_name": str(row[3]).strip() if len(row) > 3 else "",
                    "raw_names_seen": str(row[4]).strip() if len(row) > 4 else "",
                    "confidence_score": str(row[5]).strip() if len(row) > 5 else "HIGH",
                    "unit_rate": _parse_float(row[6] if len(row) > 6 else 0.0),
                    "total_picked_up": _parse_int(row[7] if len(row) > 7 else 0),
                    "total_delivered": _parse_int(row[8] if len(row) > 8 else 0),
                    "linen_discrepancy": _parse_int(row[9] if len(row) > 9 else 0),
                    "total_billed": _parse_float(row[10] if len(row) > 10 else 0.0),
                    "audit_notes": str(row[11]).strip() if len(row) > 11 else "",
                    "reviewed": True,
                    "approved": True,
                    "status": status_val,
                })

        logger.info(f"Found {len(approved_items)} approved rows ready for invoicing in {spreadsheet_id}")
        return approved_items

    @retry(reraise=True, stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def update_invoice_status(
        self, spreadsheet_id: str, row_indices: List[int], invoice_number: str, invoice_url: str
    ):
        """Updates status of invoiced rows to 'INVOICED' and appends invoice info to Audit Notes."""
        if not row_indices:
            return

        if settings.MOCK_MODE or not self.sheets:
            logger.info(f"[MOCK] Updated rows {row_indices} to INVOICED with invoice {invoice_number}")
            return

        updates = []
        for r_idx in row_indices:
            # Update Audit Notes (Col L / 12) and Status (Col O / 15)
            note_update = f"Invoiced in Zoho: {invoice_number} ({datetime.now().strftime('%Y-%m-%d')})"
            updates.append({
                "range": f"'{TAB_MONTHLY_SUMMARY}'!L{r_idx}",
                "values": [[note_update]],
            })
            updates.append({
                "range": f"'{TAB_MONTHLY_SUMMARY}'!O{r_idx}",
                "values": [["INVOICED"]],
            })

        self.sheets.spreadsheets().values().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"valueInputOption": "USER_ENTERED", "data": updates},
        ).execute()
        logger.info(f"Updated {len(row_indices)} rows to INVOICED in {spreadsheet_id}")

    def _resolve_tab_names(self, spreadsheet_id: str, is_ap: bool = False) -> Tuple[str, str]:
        """Dynamically inspects a workbook to resolve the exact titles of the summary and daily tabs."""
        default_summary = TAB_AP_MONTHLY_SUMMARY if is_ap else TAB_MONTHLY_SUMMARY
        default_daily = TAB_AP_DAILY_DETAILS if is_ap else TAB_DAILY_DETAILS

        if settings.MOCK_MODE or not self.sheets or not spreadsheet_id or spreadsheet_id.startswith("mock_"):
            return default_summary, default_daily

        try:
            meta = self.sheets.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
            sheets_list = meta.get("sheets", [])
            titles = [s.get("properties", {}).get("title", "") for s in sheets_list]
            if not titles:
                return default_summary, default_daily

            resolved_daily = None
            resolved_summary = None

            # Look for daily tab
            for t in titles:
                tl = t.lower()
                if is_ap and ("daily" in tl or "bill" in tl or "expense" in tl):
                    resolved_daily = t
                    break
                elif not is_ap and ("daily" in tl or "slip" in tl or "detail" in tl):
                    resolved_daily = t
                    break

            # Look for summary tab
            for t in titles:
                tl = t.lower()
                if "month" in tl or "summary" in tl or "rollup" in tl or "overview" in tl:
                    resolved_summary = t
                    break

            if not resolved_summary:
                resolved_summary = titles[0] if titles else default_summary
            if not resolved_daily:
                resolved_daily = titles[1] if len(titles) > 1 else (titles[0] if titles[0] != resolved_summary else default_daily)

            return resolved_summary, resolved_daily
        except Exception as e:
            logger.warning(f"Could not inspect workbook tab titles for {spreadsheet_id}: {e}")
            return default_summary, default_daily

    def fetch_sheets_review_data(self, spreadsheet_id: str, month: str, year: int) -> Dict[str, Any]:
        """Fetches all rows from both Tab 1 (Daily Details) and Tab 2 (Monthly Summary) for UI review."""
        if not self.sheets or not spreadsheet_id or spreadsheet_id.startswith("mock_"):
            return {
                "month": month,
                "year": year,
                "spreadsheet_id": spreadsheet_id or "",
                "spreadsheet_url": f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit" if spreadsheet_id else "",
                "daily_details": [],
                "monthly_summary": [],
            }

        try:
            tab_summary, tab_daily = self._resolve_tab_names(spreadsheet_id, is_ap=False)

            # Retrofit existing historical workbooks with live dynamic formulas if needed
            try:
                self.retrofit_workbook_formulas(spreadsheet_id, is_ap=False, tab_summary=tab_summary, tab_daily=tab_daily)
            except Exception as r_err:
                logger.debug(f"Notice during formula retrofit: {r_err}")

            # 1. Fetch Daily Details
            raw_daily_rows = []
            try:
                daily_res = self.sheets.spreadsheets().values().get(
                    spreadsheetId=spreadsheet_id,
                    range=f"'{tab_daily}'!A1:Z500",
                    valueRenderOption="UNFORMATTED_VALUE",
                ).execute()
                raw_daily_rows = daily_res.get("values", [])
            except Exception as d_err:
                logger.warning(f"Could not read daily tab '{tab_daily}' from {spreadsheet_id}: {d_err}")

            daily_details = []
            start_row_idx = 0
            col_map = {}
            if raw_daily_rows:
                first_row = [str(cell).strip().lower() for cell in raw_daily_rows[0]]
                if any(w in first_row for w in ["date", "file", "client", "item", "pickup", "standard", "hotel", "slip"]):
                    start_row_idx = 1
                    for c_idx, cell_str in enumerate(first_row):
                        if "date" in cell_str and "date" not in col_map:
                            col_map["date"] = c_idx
                        elif ("file" in cell_str or "slip" in cell_str) and "file" not in col_map:
                            col_map["file"] = c_idx
                        elif ("client" in cell_str or "hotel" in cell_str) and "client" not in col_map:
                            col_map["client"] = c_idx
                        elif ("standard" in cell_str or "std" in cell_str) and "standard_item" not in col_map:
                            col_map["standard_item"] = c_idx
                        elif ("raw" in cell_str or "item" in cell_str) and "raw_item" not in col_map:
                            col_map["raw_item"] = c_idx
                        elif "pickup" in cell_str and "pickup" not in col_map:
                            col_map["pickup"] = c_idx
                        elif ("deliver" in cell_str or "deliv" in cell_str) and "delivery" not in col_map:
                            col_map["delivery"] = c_idx
                        elif ("loss" in cell_str or "discrep" in cell_str) and "loss" not in col_map:
                            col_map["loss"] = c_idx
                        elif ("rate" in cell_str or "price" in cell_str) and "rate" not in col_map:
                            col_map["rate"] = c_idx
                        elif ("billed" in cell_str or "amount" in cell_str or "total" in cell_str) and "amount" not in col_map:
                            col_map["amount"] = c_idx
                        elif ("confidence" in cell_str or "conf" in cell_str) and "conf" not in col_map:
                            col_map["conf"] = c_idx
                        elif ("link" in cell_str or "scan" in cell_str or "url" in cell_str) and "link" not in col_map:
                            col_map["link"] = c_idx

            for r in raw_daily_rows[start_row_idx:]:
                if not r or not any(r):
                    continue
                def _get_val(key: str, fallback_idx: int, default: Any = "") -> Any:
                    idx = col_map.get(key, fallback_idx)
                    return r[idx] if len(r) > idx else default

                slip_d = str(_get_val("date", 0, "")).strip()
                file_n = str(_get_val("file", 1, "")).strip()
                cl_name = str(_get_val("client", 2, "")).strip()
                raw_item = str(_get_val("raw_item", 3, "")).strip()
                std_item = str(_get_val("standard_item", 4, "")).strip()
                item_display = std_item or raw_item
                p_qty = _parse_int(_get_val("pickup", 5, 0))
                d_qty = _parse_int(_get_val("delivery", 6, 0))
                l_qty = _parse_int(_get_val("loss", 7, 0))
                conf = str(_get_val("conf", 8, "HIGH")).strip()
                scan_url = str(_get_val("link", 9, "")).strip()
                u_rate = _parse_float(_get_val("rate", -1, 0.0))
                t_amt = _parse_float(_get_val("amount", -1, round(d_qty * u_rate, 2)))

                daily_details.append({
                    "date": slip_d,
                    "slip_date": slip_d,
                    "file_name": file_n,
                    "client_name": cl_name,
                    "raw_item_name": raw_item,
                    "standard_item_name": std_item or item_display,
                    "item_name": item_display,
                    "category": raw_item or "Laundry",
                    "pickup_qty": p_qty,
                    "pickup_quantity": p_qty,
                    "delivery_qty": d_qty,
                    "delivery_quantity": d_qty,
                    "loss_qty": l_qty,
                    "discrepancy": l_qty,
                    "unit_rate": u_rate,
                    "unit_price": u_rate,
                    "total_amount": t_amt,
                    "total_billed": t_amt,
                    "confidence_score": conf or "HIGH",
                    "drive_file_url": scan_url,
                    "source_image_url": scan_url,
                    "processed_at": r[10] if len(r) > 10 else "",
                })

            # 2. Fetch Monthly Summary
            raw_summary_rows = []
            try:
                summary_res = self.sheets.spreadsheets().values().get(
                    spreadsheetId=spreadsheet_id,
                    range=f"'{tab_summary}'!A1:Z500",
                    valueRenderOption="UNFORMATTED_VALUE",
                ).execute()
                raw_summary_rows = summary_res.get("values", [])
            except Exception as s_err:
                logger.warning(f"Could not read summary tab '{tab_summary}' from {spreadsheet_id}: {s_err}")

            monthly_summary = []
            start_s_idx = 0
            s_col_map = {}
            if raw_summary_rows:
                first_row = [str(cell).strip().lower() for cell in raw_summary_rows[0]]
                if any(w in first_row for w in ["client", "item", "rate", "pick", "deliver", "billed", "approved"]):
                    start_s_idx = 1
                    for c_idx, cell_str in enumerate(first_row):
                        if ("client" in cell_str or "hotel" in cell_str) and "client" not in s_col_map:
                            s_col_map["client"] = c_idx
                        elif "contact" in cell_str and "contact" not in s_col_map:
                            s_col_map["contact"] = c_idx
                        elif "item id" in cell_str and "item_id" not in s_col_map:
                            s_col_map["item_id"] = c_idx
                        elif ("item" in cell_str or "standard" in cell_str) and "item" not in s_col_map:
                            s_col_map["item"] = c_idx
                        elif "raw" in cell_str and "raw" not in s_col_map:
                            s_col_map["raw"] = c_idx
                        elif ("confidence" in cell_str or "conf" in cell_str) and "conf" not in s_col_map:
                            s_col_map["conf"] = c_idx
                        elif ("rate" in cell_str or "price" in cell_str) and "rate" not in s_col_map:
                            s_col_map["rate"] = c_idx
                        elif ("pick" in cell_str) and "pickup" not in s_col_map:
                            s_col_map["pickup"] = c_idx
                        elif ("deliver" in cell_str) and "delivery" not in s_col_map:
                            s_col_map["delivery"] = c_idx
                        elif ("discrep" in cell_str or "loss" in cell_str) and "discrepancy" not in s_col_map:
                            s_col_map["discrepancy"] = c_idx
                        elif ("bill" in cell_str or "amount" in cell_str or "total" in cell_str) and "total" not in s_col_map:
                            s_col_map["total"] = c_idx
                        elif ("note" in cell_str or "audit" in cell_str) and "notes" not in s_col_map:
                            s_col_map["notes"] = c_idx
                        elif "review" in cell_str and "reviewed" not in s_col_map:
                            s_col_map["reviewed"] = c_idx
                        elif "approv" in cell_str and "approved" not in s_col_map:
                            s_col_map["approved"] = c_idx
                        elif "status" in cell_str and "status" not in s_col_map:
                            s_col_map["status"] = c_idx

            for idx, r in enumerate(raw_summary_rows[start_s_idx:], start=start_s_idx + 1):
                if not r or not any(r):
                    continue
                def _get_s_val(key: str, fallback_idx: int, default: Any = "") -> Any:
                    col = s_col_map.get(key, fallback_idx)
                    return r[col] if len(r) > col else default

                cl_name = str(_get_s_val("client", 0, "")).strip()
                contact_id = str(_get_s_val("contact", 1, "")).strip()
                item_id = str(_get_s_val("item_id", 2, "")).strip()
                item_name = str(_get_s_val("item", 3, "")).strip()
                raw_names = str(_get_s_val("raw", 4, "")).strip()
                conf = str(_get_s_val("conf", 5, "HIGH")).strip()
                unit_rate = _parse_float(_get_s_val("rate", 6, 0.0))
                p_qty = _parse_int(_get_s_val("pickup", 7, 0))
                d_qty = _parse_int(_get_s_val("delivery", 8, 0))
                disc = _parse_int(_get_s_val("discrepancy", 9, 0))
                t_billed = _parse_float(_get_s_val("total", 10, round(d_qty * unit_rate, 2)))
                notes = str(_get_s_val("notes", 11, "")).strip()
                
                rev_val = _get_s_val("reviewed", 12, False)
                app_val = _get_s_val("approved", 13, False)
                is_rev = rev_val if isinstance(rev_val, bool) else str(rev_val).upper() in ["TRUE", "YES", "1"]
                is_app = app_val if isinstance(app_val, bool) else str(app_val).upper() in ["TRUE", "YES", "1"]
                status_val = str(_get_s_val("status", 14, "PENDING")).strip() or "PENDING"

                monthly_summary.append({
                    "row_index": idx,
                    "client_name": cl_name,
                    "zoho_contact_id": contact_id,
                    "zoho_item_id": item_id,
                    "standard_item_name": item_name,
                    "item_name": item_name,
                    "raw_names_seen": raw_names,
                    "confidence_score": conf or "HIGH",
                    "unit_rate": unit_rate,
                    "unit_price": unit_rate,
                    "total_picked_up": p_qty,
                    "pickup_qty": p_qty,
                    "pickup_quantity": p_qty,
                    "total_delivered": d_qty,
                    "delivery_qty": d_qty,
                    "delivery_quantity": d_qty,
                    "linen_discrepancy": disc,
                    "discrepancy": disc,
                    "loss_qty": disc,
                    "total_billed": t_billed,
                    "total_amount": t_billed,
                    "audit_notes": notes,
                    "reviewed": is_rev,
                    "approved": is_app,
                    "status": status_val,
                })

            return {
                "month": month,
                "year": year,
                "spreadsheet_id": spreadsheet_id,
                "spreadsheet_url": f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit",
                "daily_details": daily_details,
                "monthly_summary": monthly_summary,
            }
        except HttpError as e:
            if e.resp.status in (404, 403):
                logger.warning(f"Spreadsheet {spreadsheet_id} not found or accessible in Google Sheets (HTTP {e.resp.status}). Returning empty review data.")
                return {
                    "month": month,
                    "year": year,
                    "spreadsheet_id": spreadsheet_id,
                    "spreadsheet_url": f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit",
                    "daily_details": [],
                    "monthly_summary": [],
                }
            raise

    def toggle_row_field(self, spreadsheet_id: str, row_index: int, field: str, value: Any, is_ap: bool = False) -> bool:
        """Toggles 'reviewed', 'approved', or 'status' for a row in Tab 2."""
        if settings.MOCK_MODE or not self.sheets or not spreadsheet_id or spreadsheet_id.startswith("mock_"):
            logger.info(f"[MOCK] Toggled row {row_index} field {field} to {value} (is_ap={is_ap})")
            return True

        tab_summary, _ = self._resolve_tab_names(spreadsheet_id, is_ap=is_ap)

        if is_ap:
            col_letter = "I" if field == "reviewed" else ("J" if field == "approved" else "K")
        else:
            col_letter = "M" if field == "reviewed" else ("N" if field == "approved" else "O")

        cell_range = f"'{tab_summary}'!{col_letter}{row_index}"

        self.sheets.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=cell_range,
            valueInputOption="USER_ENTERED",
            body={"values": [[value]]},
        ).execute()

        logger.info(f"Updated row {row_index} {field} -> {value} in {spreadsheet_id} (tab: {tab_summary})")
        return True

    def fetch_ap_sheets_review_data(self, spreadsheet_id: str, month: str, year: int) -> Dict[str, Any]:
        """Fetches all rows from both AP Tab 1 (Daily Details) and AP Tab 2 (Monthly Summary) for UI review."""
        if not self.sheets or not spreadsheet_id or spreadsheet_id.startswith("mock_"):
            return {
                "month": month,
                "year": year,
                "spreadsheet_id": spreadsheet_id or "",
                "spreadsheet_url": f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit" if spreadsheet_id else "",
                "daily_details": [],
                "monthly_summary": [],
            }

        try:
            # Retrofit existing historical AP workbooks with live dynamic formulas if needed
            self.retrofit_workbook_formulas(spreadsheet_id, is_ap=True)

            # 1. Fetch Daily Details (try TAB_AP_DAILY_DETAILS, fallback to TAB_AP_BILLS)
            daily_res = None
            for t_name in [TAB_AP_DAILY_DETAILS, "Daily_Details", TAB_AP_BILLS, "Vendor_Bills"]:
                try:
                    daily_res = self.sheets.spreadsheets().values().get(
                        spreadsheetId=spreadsheet_id,
                        range=f"'{t_name}'!A2:N500",
                        valueRenderOption="UNFORMATTED_VALUE",
                    ).execute()
                    if daily_res and daily_res.get("values"):
                        break
                except Exception:
                    continue

            daily_rows = daily_res.get("values", []) if daily_res else []
            daily_details = []
            for r in daily_rows:
                if not r:
                    continue
                daily_details.append({
                    "date": r[0] if len(r) > 0 else "",
                    "slip_date": r[0] if len(r) > 0 else "",
                    "client_name": r[1] if len(r) > 1 else "",
                    "vendor_name": r[1] if len(r) > 1 else "",
                    "bill_number": r[2] if len(r) > 2 else "",
                    "file_name": r[3] if len(r) > 3 else "",
                    "item_name": r[4] if len(r) > 4 else "",
                    "item_description": r[4] if len(r) > 4 else "",
                    "category": r[5] if len(r) > 5 else "Operating Expense",
                    "quantity": _parse_float(r[6] if len(r) > 6 else 1.0, 1.0),
                    "unit_price": _parse_float(r[7] if len(r) > 7 else 0.0),
                    "total_amount": _parse_float(r[8] if len(r) > 8 else 0.0),
                    "currency": r[9] if len(r) > 9 else "GHS",
                    "status": r[10] if len(r) > 10 else "PENDING",
                    "accounting_ref": r[11] if len(r) > 11 else "",
                    "processed_at": r[13] if len(r) > 13 else (r[11] if len(r) > 11 else ""),
                })

            # 2. Fetch Monthly Summary
            monthly_res = None
            try:
                monthly_res = self.sheets.spreadsheets().values().get(
                    spreadsheetId=spreadsheet_id,
                    range=f"'{TAB_AP_MONTHLY_SUMMARY}'!A2:K500",
                    valueRenderOption="UNFORMATTED_VALUE",
                ).execute()
            except Exception:
                pass

            monthly_rows = monthly_res.get("values", []) if monthly_res else []
            monthly_summary = []
            for idx, r in enumerate(monthly_rows, start=2):
                if not r:
                    continue
                rev_val = r[8] if len(r) > 8 else False
                app_val = r[9] if len(r) > 9 else False
                is_rev = rev_val if isinstance(rev_val, bool) else str(rev_val).upper() in ["TRUE", "YES", "1"]
                is_app = app_val if isinstance(app_val, bool) else str(app_val).upper() in ["TRUE", "YES", "1"]

                monthly_summary.append({
                    "row_index": idx,
                    "client_name": str(r[0]).strip() if len(r) > 0 else "",
                    "vendor_name": str(r[0]).strip() if len(r) > 0 else "",
                    "zoho_contact_id": str(r[1]).strip() if len(r) > 1 else "",
                    "item_name": str(r[2]).strip() if len(r) > 2 else "Operating Expense",
                    "expense_category": str(r[2]).strip() if len(r) > 2 else "Operating Expense",
                    "total_bills_count": _parse_int(r[3] if len(r) > 3 else 1),
                    "total_quantity": _parse_float(r[4] if len(r) > 4 else 1.0),
                    "total_billed": _parse_float(r[5] if len(r) > 5 else 0.0),
                    "total_amount": _parse_float(r[5] if len(r) > 5 else 0.0),
                    "currency": str(r[6]).strip() if len(r) > 6 else "GHS",
                    "audit_notes": str(r[7]).strip() if len(r) > 7 else "",
                    "reviewed": is_rev,
                    "approved": is_app,
                    "status": str(r[10]).strip() if len(r) > 10 else "PENDING",
                })

            return {
                "month": month,
                "year": year,
                "spreadsheet_id": spreadsheet_id,
                "spreadsheet_url": f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit",
                "daily_details": daily_details,
                "monthly_summary": monthly_summary,
            }
        except HttpError as e:
            if e.resp.status in (404, 403):
                logger.warning(f"AP Spreadsheet {spreadsheet_id} not found or accessible in Google Sheets (HTTP {e.resp.status}).")
                return {
                    "month": month,
                    "year": year,
                    "spreadsheet_id": spreadsheet_id,
                    "spreadsheet_url": f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit",
                    "daily_details": [],
                    "monthly_summary": [],
                }
            raise

    def update_daily_detail_cell(
        self,
        spreadsheet_id: str,
        row_index: int,
        field: str,
        value: Any,
        is_ap: bool = False,
    ) -> bool:
        """
        Updates a specific cell in Tab 1: Daily_Details.
        Uses valueInputOption='USER_ENTERED' so that live formulas in Tab 2 (Monthly_Summary)
        automatically and dynamically recalculate in real time.
        """
        if settings.MOCK_MODE or not self.sheets or not spreadsheet_id or spreadsheet_id.startswith("mock_"):
            logger.info(f"[MOCK] Updated Daily_Details row {row_index} field '{field}' to '{value}' (is_ap={is_ap})")
            return True

        _, tab_name = self._resolve_tab_names(spreadsheet_id, is_ap=is_ap)

        if is_ap:
            field_map = {
                "date": "A",
                "vendor_name": "B",
                "vendor": "B",
                "bill_number": "C",
                "bill_no": "C",
                "file_name": "D",
                "item_description": "E",
                "description": "E",
                "expense_category": "F",
                "category": "F",
                "quantity": "G",
                "qty": "G",
                "unit_rate": "H",
                "unit_price": "H",
                "total_amount": "I",
                "amount": "I",
                "currency": "J",
                "status": "K",
            }
        else:
            field_map = {
                "date": "A",
                "slip_date": "A",
                "file_name": "B",
                "client_name": "C",
                "raw_item_name": "D",
                "standard_item_name": "E",
                "item_name": "E",
                "pickup_qty": "F",
                "delivery_qty": "G",
                "loss_qty": "H",
                "confidence_score": "I",
            }

        col_letter = field_map.get(field.lower())
        if not col_letter:
            logger.warning(f"Unknown field '{field}' for daily detail cell update in tab '{tab_name}'.")
            return False

        cell_range = f"'{tab_name}'!{col_letter}{row_index}"
        self.sheets.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=cell_range,
            valueInputOption="USER_ENTERED",
            body={"values": [[value]]},
        ).execute()

        logger.info(f"Updated Daily_Details cell {cell_range} to '{value}' (dynamic formulas recalculate).")
        return True

    def retrofit_workbook_formulas(
        self,
        spreadsheet_id: str,
        is_ap: bool = False,
        tab_summary: Optional[str] = None,
        tab_daily: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Retrospectively upgrades an existing spreadsheet so that its Monthly_Summary rows
        use dynamic live Google Sheets formulas linked to Daily_Details.
        Preserves all existing client/vendor names, categories, and accountant checkboxes.
        """
        if settings.MOCK_MODE or not self.sheets or not spreadsheet_id or spreadsheet_id.startswith("mock_"):
            return {"status": "MOCK_RETROFITTED", "spreadsheet_id": spreadsheet_id, "rows_upgraded": 0}

        if not tab_summary or not tab_daily:
            tab_summary, tab_daily = self._resolve_tab_names(spreadsheet_id, is_ap=is_ap)

        try:
            # Read current formulas to inspect whether retrofit is needed
            res = self.sheets.spreadsheets().values().get(
                spreadsheetId=spreadsheet_id,
                range=f"'{tab_summary}'!A2:O500",
                valueRenderOption="FORMULA",
            ).execute()

            rows = res.get("values", [])
            if not rows:
                return {"status": "EMPTY", "spreadsheet_id": spreadsheet_id, "rows_upgraded": 0}

            updates = []
            upgraded_count = 0

            for idx, r in enumerate(rows, start=2):
                if not r:
                    continue

                if is_ap:
                    # AP: A: Vendor, B: Zoho Contact ID, C: Expense Category, D: Bills Count, E: Quantity, F: Total Billed
                    col_d_val = str(r[3]) if len(r) > 3 else ""
                    if not col_d_val.startswith("="):
                        bills_formula = f"=COUNTIFS('{tab_daily}'!B:B, A{idx}, '{tab_daily}'!F:F, C{idx})"
                        qty_formula = f"=SUMIFS('{tab_daily}'!G:G, '{tab_daily}'!B:B, A{idx}, '{tab_daily}'!F:F, C{idx})"
                        total_formula = f"=SUMIFS('{tab_daily}'!I:I, '{tab_daily}'!B:B, A{idx}, '{tab_daily}'!F:F, C{idx})"
                        updates.append({
                            "range": f"'{tab_summary}'!D{idx}:F{idx}",
                            "values": [[bills_formula, qty_formula, total_formula]],
                        })
                        upgraded_count += 1
                else:
                    # AR: A: Client, B: Contact ID, C: Item ID, D: Standard Item Name, ...
                    # H: Picked Up, I: Delivered, J: Discrepancy, K: Total Billed
                    col_h_val = str(r[7]) if len(r) > 7 else ""
                    if not col_h_val.startswith("="):
                        picked_up_formula = f"=SUMIFS('{tab_daily}'!F:F, '{tab_daily}'!C:C, A{idx}, '{tab_daily}'!E:E, D{idx})"
                        delivered_formula = f"=SUMIFS('{tab_daily}'!G:G, '{tab_daily}'!C:C, A{idx}, '{tab_daily}'!E:E, D{idx})"
                        discrepancy_formula = f"=MAX(0, H{idx} - I{idx})"
                        total_formula = f"=ROUND(I{idx} * G{idx}, 2)"
                        updates.append({
                            "range": f"'{tab_summary}'!H{idx}:K{idx}",
                            "values": [[picked_up_formula, delivered_formula, discrepancy_formula, total_formula]],
                        })
                        upgraded_count += 1

            if updates:
                self.sheets.spreadsheets().values().batchUpdate(
                    spreadsheetId=spreadsheet_id,
                    body={"valueInputOption": "USER_ENTERED", "data": updates},
                ).execute()
                logger.info(f"Retroactively upgraded {upgraded_count} summary rows to live dynamic formulas in sheet {spreadsheet_id} (is_ap={is_ap}).")

            # Also retrofit Daily_Details loss_qty (AR) if not already a formula
            if not is_ap:
                try:
                    daily_res = self.sheets.spreadsheets().values().get(
                        spreadsheetId=spreadsheet_id,
                        range=f"'{tab_daily}'!A2:H500",
                        valueRenderOption="FORMULA",
                    ).execute()
                    daily_rows = daily_res.get("values", [])
                    daily_updates = []
                    for k, d_row in enumerate(daily_rows, start=2):
                        if not d_row:
                            continue
                        loss_val = str(d_row[7]) if len(d_row) > 7 else ""
                        if not loss_val.startswith("="):
                            daily_updates.append({
                                "range": f"'{tab_daily}'!H{k}",
                                "values": [[f"=MAX(0, F{k} - G{k})"]],
                            })
                    if daily_updates:
                        self.sheets.spreadsheets().values().batchUpdate(
                            spreadsheetId=spreadsheet_id,
                            body={"valueInputOption": "USER_ENTERED", "data": daily_updates},
                        ).execute()
                        logger.info(f"Retroactively upgraded {len(daily_updates)} Daily_Details loss rows to =MAX(0, F-G) in {spreadsheet_id}")
                except Exception as daily_err:
                    logger.debug(f"Notice retrofitting daily details formulas: {daily_err}")

            return {
                "status": "UPGRADED" if upgraded_count > 0 else "ALREADY_CURRENT",
                "spreadsheet_id": spreadsheet_id,
                "rows_upgraded": upgraded_count,
                "is_ap": is_ap,
            }
        except Exception as e:
            logger.warning(f"Notice during retrofit_workbook_formulas for {spreadsheet_id}: {e}")
            return {"status": "ERROR", "error": str(e), "spreadsheet_id": spreadsheet_id, "rows_upgraded": 0}


