"""Google Sheets Service for managing the two-tier billing review workbook."""

from datetime import datetime
from typing import List, Dict, Optional, Any, Tuple
from tenacity import retry, stop_after_attempt, wait_exponential

from googleapiclient.errors import HttpError

from app.config import settings
from app.models.schemas import (
    DailySlipDetailRow,
    MonthlySummaryRow,
    ConfidenceLevel,
    SlipStatus,
)
from app.utils.auth import get_google_sheets_service, get_google_drive_service
from app.utils.logging import get_logger

logger = get_logger("google_sheets")

TAB_DAILY_DETAILS = "Daily_Slip_Details"
TAB_MONTHLY_SUMMARY = "Monthly_Summary"
TAB_AP_BILLS = "Vendor_Bills"

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
    def find_or_create_workbook(self, month_name: str, year: int, month_folder_id: str) -> Tuple[str, str]:
        """
        Locates or creates the Google Sheet review workbook:
        'ANR_Billing_Review_<Month>_<YYYY>' inside the Month Folder.
        Returns (spreadsheet_id, spreadsheet_url).
        """
        workbook_title = f"ANR_Billing_Review_{month_name}_{year}"
        
        if settings.MOCK_MODE or not self.sheets or not self.drive or not month_folder_id or month_folder_id.startswith("mock_"):
            logger.info(f"[MOCK] Finding or creating review workbook: {workbook_title}")
            mock_id = f"mock_sheet_{month_name.lower()}_{year}"
            return mock_id, None

        try:
            # 1. Search if already exists in folder
            query = (
                f"name = '{workbook_title}' and "
                f"'{month_folder_id}' in parents and "
                f"mimeType = 'application/vnd.google-apps.spreadsheet' and "
                f"trashed = false"
            )
            res = self.drive.files().list(
                q=query,
                spaces="drive",
                fields="files(id, name, webViewLink)",
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            ).execute()
            files = res.get("files", [])
            if files:
                sheet_id = files[0]["id"]
                sheet_url = files[0].get("webViewLink", f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit")
                logger.info(f"Found existing review workbook '{workbook_title}' (ID: {sheet_id})")
                return sheet_id, sheet_url

            # 2. Create new spreadsheet
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

            # Move to the Month folder if valid
            if month_folder_id and month_folder_id != "root" and not month_folder_id.startswith("mock_"):
                try:
                    self.drive.files().update(
                        fileId=sheet_id,
                        addParents=month_folder_id,
                        fields="id, parents",
                        supportsAllDrives=True,
                    ).execute()
                except Exception as move_err:
                    logger.warning(f"Could not move sheet {sheet_id} to folder {month_folder_id}: {move_err}")

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
        '{client_name}_AP_Bills_{Month}_{YYYY}' inside the Month Folder.
        Falls back to attaching a 'Vendor_Bills' tab to an existing review workbook in the folder
        if creating a separate spreadsheet is restricted by Google Drive quota/permissions.
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
                return sheet_id, sheet_url

            # 2. Try creating new dedicated AP spreadsheet inside parent folder
            file_metadata = {
                "name": workbook_title,
                "mimeType": "application/vnd.google-apps.spreadsheet",
            }
            if parent_folder and parent_folder != "root":
                file_metadata["parents"] = [parent_folder]

            try:
                created = self.drive.files().create(
                    body=file_metadata,
                    fields="id, webViewLink",
                    supportsAllDrives=True,
                ).execute()
                sheet_id = created["id"]
                sheet_url = created.get("webViewLink", f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit")

                # Rename default Sheet1 to TAB_AP_BILLS
                try:
                    sheet_meta = self.sheets.spreadsheets().get(spreadsheetId=sheet_id).execute()
                    first_sheet_id = sheet_meta["sheets"][0]["properties"]["sheetId"]
                    self.sheets.spreadsheets().batchUpdate(
                        spreadsheetId=sheet_id,
                        body={
                            "requests": [
                                {
                                    "updateSheetProperties": {
                                        "properties": {
                                            "sheetId": first_sheet_id,
                                            "title": TAB_AP_BILLS,
                                        },
                                        "fields": "title",
                                    }
                                }
                            ]
                        },
                    ).execute()
                except Exception as rename_err:
                    logger.warning(f"Notice setting initial tab title: {rename_err}")

                # Initialize AP headers
                self.sheets.spreadsheets().values().batchUpdate(
                    spreadsheetId=sheet_id,
                    body={
                        "valueInputOption": "RAW",
                        "data": [
                            {
                                "range": f"'{TAB_AP_BILLS}'!A1:L1",
                                "values": [AP_BILLS_HEADERS],
                            },
                        ],
                    },
                ).execute()
                logger.info(f"Created and initialized dedicated AP review workbook '{workbook_title}' (ID: {sheet_id})")
                return sheet_id, sheet_url

            except Exception as create_err:
                logger.warning(f"Could not create standalone AP spreadsheet in folder: {create_err}. Checking for existing shared workbook...")

            # 3. Fallback: If creating a standalone sheet is restricted, check if an existing
            # review workbook is shared in this folder (e.g. ANR_Billing_Review_<Month>_<Year>)
            # and attach a dedicated 'Vendor_Bills' tab to it.
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
                        # Inspect sheets to see if Vendor_Bills already exists
                        sheet_meta = self.sheets.spreadsheets().get(spreadsheetId=existing_sheet_id).execute()
                        sheets_list = sheet_meta.get("sheets", [])
                        tab_id = None
                        for s in sheets_list:
                            if s["properties"]["title"] == TAB_AP_BILLS:
                                tab_id = s["properties"]["sheetId"]
                                break
                        if tab_id is None:
                            # Add dedicated Vendor_Bills tab
                            add_resp = self.sheets.spreadsheets().batchUpdate(
                                spreadsheetId=existing_sheet_id,
                                body={
                                    "requests": [
                                        {"addSheet": {"properties": {"title": TAB_AP_BILLS}}}
                                    ]
                                }
                            ).execute()
                            tab_id = add_resp.get("replies", [{}])[0].get("addSheet", {}).get("properties", {}).get("sheetId")
                            self.sheets.spreadsheets().values().batchUpdate(
                                spreadsheetId=existing_sheet_id,
                                body={
                                    "valueInputOption": "RAW",
                                    "data": [
                                        {"range": f"'{TAB_AP_BILLS}'!A1:L1", "values": [AP_BILLS_HEADERS]},
                                    ],
                                },
                            ).execute()
                        final_url = f"{existing_sheet_url}#gid={tab_id}" if tab_id is not None else existing_sheet_url
                        logger.info(f"Attached '{TAB_AP_BILLS}' tab to existing shared review sheet '{ext_files[0]['name']}' (ID: {existing_sheet_id})")
                        return existing_sheet_id, final_url
                except Exception as fb_err:
                    logger.warning(f"Attaching tab to existing review sheet fallback notice: {fb_err}")

            mock_id = f"mock_sheet_ap_{month_name.lower()}_{year}"
            return mock_id, None

        except Exception as e:
            logger.error(f"Error finding or creating AP workbook: {e}")
            mock_id = f"mock_sheet_ap_{month_name.lower()}_{year}"
            return mock_id, None

    def append_ap_vendor_bills(self, spreadsheet_id: str, items: List[Any], auto_post: bool = False):
        """Appends extracted AP vendor bills to the Vendor_Bills sheet."""
        if settings.MOCK_MODE or not self.sheets or not spreadsheet_id or spreadsheet_id.startswith("mock_"):
            return

        rows = []
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        for it in items:
            raw = getattr(it, "raw_extracted_data", {}) or {}
            d = raw.get("date") or raw.get("bill_date") or ""
            v_name = raw.get("vendor") or raw.get("vendor_name") or ""
            b_num = raw.get("bill_number") or ""
            f_name = raw.get("file_name") or ""
            desc = getattr(it, "item_or_description", "")
            qty = getattr(it, "quantity_or_debit", 1.0)
            rate = getattr(it, "unit_price", 0.0)
            tot = getattr(it, "total_amount", 0.0)
            curr = raw.get("currency", "GHS")
            st = "BILLED" if auto_post else "PENDING"
            doc_ref = raw.get("accounting_ref_id", "")

            rows.append([d, v_name, b_num, f_name, desc, qty, rate, tot, curr, st, doc_ref, now_str])

        if rows:
            try:
                # Ensure Vendor_Bills tab exists in target sheet
                try:
                    sheet_meta = self.sheets.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
                    titles = [s["properties"]["title"] for s in sheet_meta.get("sheets", [])]
                    if TAB_AP_BILLS not in titles:
                        self.sheets.spreadsheets().batchUpdate(
                            spreadsheetId=spreadsheet_id,
                            body={"requests": [{"addSheet": {"properties": {"title": TAB_AP_BILLS}}}]}
                        ).execute()
                        self.sheets.spreadsheets().values().batchUpdate(
                            spreadsheetId=spreadsheet_id,
                            body={
                                "valueInputOption": "RAW",
                                "data": [{"range": f"'{TAB_AP_BILLS}'!A1:L1", "values": [AP_BILLS_HEADERS]}],
                            }
                        ).execute()
                except Exception as meta_err:
                    logger.debug(f"Sheet tab check notice: {meta_err}")

                self.sheets.spreadsheets().values().append(
                    spreadsheetId=spreadsheet_id,
                    range=f"'{TAB_AP_BILLS}'!A2:L",
                    valueInputOption="USER_ENTERED",
                    insertDataOption="INSERT_ROWS",
                    body={"values": rows},
                ).execute()
                logger.info(f"Appended {len(rows)} AP bill rows to Google Sheet '{spreadsheet_id}'")
            except Exception as e:
                logger.warning(f"Could not append AP bills to Google Sheet: {e}")

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
        """Appends individual line items to Tab 1: Daily_Slip_Details."""
        if not rows:
            return 0

        if settings.MOCK_MODE or not self.sheets:
            logger.info(f"[MOCK] Appended {len(rows)} rows to {TAB_DAILY_DETAILS}")
            return len(rows)

        values = [row.to_sheet_row() for row in rows]
        range_name = f"'{TAB_DAILY_DETAILS}'!A:K"

        self.sheets.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            valueInputOption="USER_ENTERED",  # Required to render =HYPERLINK formula
            body={"values": values},
        ).execute()

        logger.info(f"Successfully appended {len(rows)} detail rows to {TAB_DAILY_DETAILS}")
        return len(rows)

    @retry(reraise=True, stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def sync_monthly_summaries(self, spreadsheet_id: str, summary_rows: List[MonthlySummaryRow]) -> int:
        """
        Synchronizes monthly SKU summary rows to Tab 2: Monthly_Summary.
        Upserts rows matching (Client Name + Zoho Item ID).
        Preserves user 'Reviewed?' and 'Approved?' checkboxes if already checked.
        """
        if not summary_rows:
            return 0

        if settings.MOCK_MODE or not self.sheets:
            logger.info(f"[MOCK] Synchronized {len(summary_rows)} SKU rows to {TAB_MONTHLY_SUMMARY}")
            return len(summary_rows)

        # Read existing rows from Monthly_Summary
        res = self.sheets.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"'{TAB_MONTHLY_SUMMARY}'!A2:O500"
        ).execute()
        existing_values = res.get("values", [])

        # Index existing rows by key: (client_name.lower(), zoho_item_id or standard_item_name.lower())
        existing_map: Dict[Tuple[str, str], Tuple[int, List[Any]]] = {}
        for idx, row in enumerate(existing_values, start=2):
            if not row:
                continue
            client = row[0].strip().lower() if len(row) > 0 else ""
            item_id = row[2].strip().lower() if len(row) > 2 else ""
            std_name = row[3].strip().lower() if len(row) > 3 else ""
            key = (client, item_id or std_name)
            existing_map[key] = (idx, row)

        updates = []
        appends = []

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
                    "range": f"'{TAB_MONTHLY_SUMMARY}'!A{row_idx}:O{row_idx}",
                    "values": [summary.to_sheet_row()],
                })
            else:
                appends.append(summary.to_sheet_row())

        if updates:
            self.sheets.spreadsheets().values().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"valueInputOption": "USER_ENTERED", "data": updates},
            ).execute()

        if appends:
            self.sheets.spreadsheets().values().append(
                spreadsheetId=spreadsheet_id,
                range=f"'{TAB_MONTHLY_SUMMARY}'!A:O",
                valueInputOption="USER_ENTERED",
                body={"values": appends},
            ).execute()

        logger.info(f"Updated {len(updates)} and appended {len(appends)} rows in {TAB_MONTHLY_SUMMARY}")
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
            range=f"'{TAB_MONTHLY_SUMMARY}'!A2:O500"
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
                    "client_name": row[0].strip() if len(row) > 0 else "",
                    "zoho_contact_id": row[1].strip() if len(row) > 1 else "",
                    "zoho_item_id": row[2].strip() if len(row) > 2 else "",
                    "standard_item_name": row[3].strip() if len(row) > 3 else "",
                    "raw_names_seen": row[4].strip() if len(row) > 4 else "",
                    "confidence_score": row[5].strip() if len(row) > 5 else "HIGH",
                    "unit_rate": _parse_float(row[6] if len(row) > 6 else 0.0),
                    "total_picked_up": _parse_int(row[7] if len(row) > 7 else 0),
                    "total_delivered": _parse_int(row[8] if len(row) > 8 else 0),
                    "linen_discrepancy": _parse_int(row[9] if len(row) > 9 else 0),
                    "total_billed": _parse_float(row[10] if len(row) > 10 else 0.0),
                    "audit_notes": row[11].strip() if len(row) > 11 else "",
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
            # 1. Fetch Daily Details
            daily_res = self.sheets.spreadsheets().values().get(
                spreadsheetId=spreadsheet_id, range=f"'{TAB_DAILY_DETAILS}'!A2:K500"
            ).execute()
            daily_rows = daily_res.get("values", [])
            daily_details = []
            for r in daily_rows:
                if not r:
                    continue
                daily_details.append({
                    "slip_date": r[0] if len(r) > 0 else "",
                    "file_name": r[1] if len(r) > 1 else "",
                    "client_name": r[2] if len(r) > 2 else "",
                    "raw_item_name": r[3] if len(r) > 3 else "",
                    "standard_item_name": r[4] if len(r) > 4 else "",
                    "pickup_qty": _parse_int(r[5] if len(r) > 5 else 0),
                    "delivery_qty": _parse_int(r[6] if len(r) > 6 else 0),
                    "loss_qty": _parse_int(r[7] if len(r) > 7 else 0),
                    "confidence_score": r[8] if len(r) > 8 else "HIGH",
                    "drive_file_url": r[9] if len(r) > 9 else "",
                    "processed_at": r[10] if len(r) > 10 else "",
                })

            # 2. Fetch Monthly Summary
            monthly_res = self.sheets.spreadsheets().values().get(
                spreadsheetId=spreadsheet_id, range=f"'{TAB_MONTHLY_SUMMARY}'!A2:O500"
            ).execute()
            monthly_rows = monthly_res.get("values", [])
            monthly_summary = []
            for idx, r in enumerate(monthly_rows, start=2):
                if not r:
                    continue
                rev_val = r[12] if len(r) > 12 else False
                app_val = r[13] if len(r) > 13 else False
                is_rev = rev_val if isinstance(rev_val, bool) else str(rev_val).upper() in ["TRUE", "YES", "1"]
                is_app = app_val if isinstance(app_val, bool) else str(app_val).upper() in ["TRUE", "YES", "1"]

                monthly_summary.append({
                    "row_index": idx,
                    "client_name": r[0].strip() if len(r) > 0 else "",
                    "zoho_contact_id": r[1].strip() if len(r) > 1 else "",
                    "zoho_item_id": r[2].strip() if len(r) > 2 else "",
                    "standard_item_name": r[3].strip() if len(r) > 3 else "",
                    "raw_names_seen": r[4].strip() if len(r) > 4 else "",
                    "confidence_score": r[5].strip() if len(r) > 5 else "HIGH",
                    "unit_rate": _parse_float(r[6] if len(r) > 6 else 0.0),
                    "total_picked_up": _parse_int(r[7] if len(r) > 7 else 0),
                    "total_delivered": _parse_int(r[8] if len(r) > 8 else 0),
                    "linen_discrepancy": _parse_int(r[9] if len(r) > 9 else 0),
                    "total_billed": _parse_float(r[10] if len(r) > 10 else 0.0),
                    "audit_notes": r[11].strip() if len(r) > 11 else "",
                    "reviewed": is_rev,
                    "approved": is_app,
                    "status": r[14].strip() if len(r) > 14 else "PENDING",
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

    def toggle_row_field(self, spreadsheet_id: str, row_index: int, field: str, value: Any) -> bool:
        """Toggles 'reviewed', 'approved', or 'status' for a row in Tab 2."""
        if settings.MOCK_MODE or not self.sheets or not spreadsheet_id or spreadsheet_id.startswith("mock_"):
            logger.info(f"[MOCK] Toggled row {row_index} field {field} to {value}")
            return True

        col_letter = "M" if field == "reviewed" else ("N" if field == "approved" else "O")
        cell_range = f"'{TAB_MONTHLY_SUMMARY}'!{col_letter}{row_index}"

        self.sheets.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=cell_range,
            valueInputOption="USER_ENTERED",
            body={"values": [[value]]},
        ).execute()

        logger.info(f"Updated row {row_index} {field} -> {value} in {spreadsheet_id}")
        return True

