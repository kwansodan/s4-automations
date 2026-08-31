"""Google Drive Service for managing control sheets folder hierarchy and files."""

import io
from typing import List, Dict, Optional, Any, Tuple
from googleapiclient.http import MediaIoBaseDownload
from tenacity import retry, stop_after_attempt, wait_exponential

from googleapiclient.errors import HttpError

from app.config import settings
from app.models.schemas import ClientFolderInfo
from app.utils.auth import get_google_drive_service
from app.utils.logging import get_logger

logger = get_logger("google_drive")


class GoogleDriveService:
    """Manages Google Drive folder hierarchy, document discovery, downloads, and archival."""

    def __init__(self, drive_service: Optional[Any] = None):
        self._service = drive_service

    @property
    def service(self):
        if self._service is None and not settings.MOCK_MODE:
            self._service = get_google_drive_service()
        return self._service

    @retry(reraise=True, stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def find_or_create_folder(self, folder_name: str, parent_id: str) -> str:
        """Finds an existing folder by name inside parent_id or creates a new one."""
        if settings.MOCK_MODE or not self.service or parent_id.startswith("mock_"):
            logger.info(f"[MOCK] Finding or creating folder '{folder_name}' in parent '{parent_id}'")
            return f"mock_folder_{folder_name.lower().replace(' ', '_')}"

        try:
            query = (
                f"name = '{folder_name}' and "
                f"'{parent_id}' in parents and "
                f"mimeType = 'application/vnd.google-apps.folder' and "
                f"trashed = false"
            )
            response = self.service.files().list(
                q=query,
                spaces="drive",
                fields="files(id, name)",
                pageSize=10
            ).execute()
            files = response.get("files", [])
            if files:
                folder_id = files[0]["id"]
                logger.info(f"Found existing folder '{folder_name}' (ID: {folder_id})")
                return folder_id

            # Create folder
            file_metadata = {
                "name": folder_name,
                "mimeType": "application/vnd.google-apps.folder",
                "parents": [parent_id] if parent_id and parent_id != "root" else []
            }
            created = self.service.files().create(
                body=file_metadata,
                fields="id, name"
            ).execute()
            folder_id = created["id"]
            logger.info(f"Created new folder '{folder_name}' (ID: {folder_id})")
            return folder_id
        except HttpError as e:
            if e.resp.status in (404, 403):
                logger.warning(
                    f"Parent folder '{parent_id}' was not found or accessible in Google Drive (HTTP {e.resp.status}). "
                    f"Please verify CONTROL_SHEETS_FOLDER_ID and share permissions with the Service Account email. "
                    f"Falling back to mock folder for '{folder_name}'."
                )
                return f"mock_folder_{folder_name.lower().replace(' ', '_')}"
            raise

    def get_month_folder(self, month_name: str, year: int) -> str:
        """Gets or creates the Month folder under root CONTROL_SHEETS_FOLDER_ID, checking month aliases first."""
        root_id = (settings.CONTROL_SHEETS_FOLDER_ID or "").strip()
        if not root_id or root_id in ("your_google_drive_folder_id", "your_folder_id", "1aB2cD3eF4gH..."):
            root_id = "root"

        if settings.MOCK_MODE or not self.service or root_id.startswith("mock_"):
            return f"mock_folder_{month_name.lower()}_{year}"

        # First check if any existing folder matches any month aliases (e.g. Aug 2026, August 2026, 2026-08)
        aliases = self.get_month_aliases(month_name, year)
        aliases_lower = {a.lower() for a in aliases}
        try:
            query = f"'{root_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
            res = self.service.files().list(q=query, spaces="drive", fields="files(id, name)", pageSize=100).execute()
            for f in res.get("files", []):
                if f.get("name", "").strip().lower() in aliases_lower:
                    logger.info(f"Matched existing month folder alias '{f['name']}' (ID: {f['id']})")
                    return f["id"]
        except Exception as e:
            logger.warning(f"Could not scan root folder for month aliases: {e}")

        # Fallback to creating canonical folder 'Month YYYY'
        folder_name = f"{month_name.capitalize()} {year}"
        return self.find_or_create_folder(folder_name, root_id)

    @retry(reraise=True, stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def list_client_folders(self, month_folder_id: str) -> List[ClientFolderInfo]:
        """Discovers all client subfolders inside the month folder."""
        if settings.MOCK_MODE or not self.service:
            logger.info(f"[MOCK] Listing client folders for month folder {month_folder_id}")
            return [
                ClientFolderInfo(folder_id="mock_fld_luxwood", client_name="Luxwood", client_slug="luxwood", unprocessed_file_count=2),
                ClientFolderInfo(folder_id="mock_fld_the_bantree", client_name="The Bantree", client_slug="the_bantree", unprocessed_file_count=1),
                ClientFolderInfo(folder_id="mock_fld_the_lennox", client_name="The Lennox", client_slug="the_lennox", unprocessed_file_count=2),
                ClientFolderInfo(folder_id="mock_fld_active_8", client_name="Active 8 Spintex", client_slug="active_8_spintex", unprocessed_file_count=1),
                ClientFolderInfo(folder_id="mock_fld_maharaja", client_name="Maharaja", client_slug="maharaja", unprocessed_file_count=1),
            ]

        query = (
            f"'{month_folder_id}' in parents and "
            f"mimeType = 'application/vnd.google-apps.folder' and "
            f"trashed = false"
        )
        response = self.service.files().list(
            q=query,
            spaces="drive",
            fields="files(id, name)",
            pageSize=100
        ).execute()

        client_folders: List[ClientFolderInfo] = []
        for f in response.get("files", []):
            name = f["name"].strip()
            # Ignore utility or archive folders at month root if any
            if name.lower() in ["processed", "archive", "templates", "backup"]:
                continue
            
            slug = name.lower().replace(" ", "_").replace("-", "_")
            client_folders.append(
                ClientFolderInfo(
                    folder_id=f["id"],
                    client_name=name,
                    client_slug=slug,
                )
            )

        logger.info(f"Discovered {len(client_folders)} client folders in month folder {month_folder_id}")
        return client_folders

    @retry(reraise=True, stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def list_unprocessed_slips(self, client_folder_id: str) -> List[Dict[str, Any]]:
        """
        Lists all unarchived loose image or PDF files in client folder root.
        Excludes subfolders like 'Processed'.
        """
        if settings.MOCK_MODE or not self.service:
            logger.info(f"[MOCK] Listing unarchived slips in client folder {client_folder_id}")
            return [
                {
                    "id": f"mock_file_{client_folder_id}_1",
                    "name": "slip_20260815_01.jpg",
                    "mimeType": "image/jpeg",
                    "webViewLink": f"https://drive.google.com/file/d/mock_file_{client_folder_id}_1/view",
                },
                {
                    "id": f"mock_file_{client_folder_id}_2",
                    "name": "slip_20260816_02.png",
                    "mimeType": "image/png",
                    "webViewLink": f"https://drive.google.com/file/d/mock_file_{client_folder_id}_2/view",
                },
            ]

        query = (
            f"'{client_folder_id}' in parents and "
            f"mimeType != 'application/vnd.google-apps.folder' and "
            f"trashed = false"
        )
        response = self.service.files().list(
            q=query,
            spaces="drive",
            fields="files(id, name, mimeType, webViewLink, size, createdTime)",
            pageSize=100
        ).execute()

        raw_files = response.get("files", [])
        supported_exts = (".jpg", ".jpeg", ".png", ".webp", ".pdf", ".heic", ".bmp", ".tiff", ".tif")
        files = [
            f for f in raw_files
            if f.get("mimeType", "").startswith("image/")
            or f.get("mimeType") == "application/pdf"
            or f.get("name", "").lower().endswith(supported_exts)
        ]
        logger.info(f"Found {len(files)} unprocessed slip files in folder {client_folder_id}")
        return files

    @retry(reraise=True, stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def download_file_bytes(self, file_id: str) -> Tuple[bytes, str]:
        """Downloads raw bytes of a file from Google Drive."""
        if settings.MOCK_MODE or not self.service:
            logger.info(f"[MOCK] Downloading mock bytes for file {file_id}")
            return b"mock-slip-binary-content", "image/jpeg"

        file_metadata = self.service.files().get(
            fileId=file_id, fields="id, name, mimeType"
        ).execute()
        mime_type = file_metadata.get("mimeType", "image/jpeg")

        request = self.service.files().get_media(fileId=file_id)
        fh = io.BytesIO()
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while not done:
            status, done = downloader.next_chunk()

        fh.seek(0)
        return fh.read(), mime_type

    @retry(reraise=True, stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def archive_file(self, file_id: str, client_folder_id: str, processed_folder_id: str) -> bool:
        """Moves a processed file from the client folder root into client_folder/Processed/."""
        if settings.MOCK_MODE or not self.service:
            logger.info(f"[MOCK] Moving file {file_id} to processed folder {processed_folder_id}")
            return True

        self.service.files().update(
            fileId=file_id,
            addParents=processed_folder_id,
            removeParents=client_folder_id,
            fields="id, parents"
        ).execute()
        logger.info(f"Archived file {file_id} into Processed folder {processed_folder_id}")
        return True

    async def test_folder_access(self, folder_id: str) -> Dict[str, Any]:
        """Tests whether a Google Drive folder exists and is accessible by the service account."""
        if not folder_id or folder_id in ("root", "your_folder_id", "default") or settings.MOCK_MODE or not self.service:
            return {
                "accessible": True,
                "folder_id": folder_id or "root",
                "folder_name": "S4 Ingestion Root Folder",
                "permissions": "Editor",
                "mock_mode": True,
            }
        try:
            res = self.service.files().get(
                fileId=folder_id,
                fields="id, name, capabilities, owners, permissions"
            ).execute()
            return {
                "accessible": True,
                "folder_id": res.get("id"),
                "folder_name": res.get("name"),
                "can_edit": res.get("capabilities", {}).get("canEdit", True),
                "mock_mode": False,
            }
        except Exception as e:
            logger.warning(f"Could not access Google Drive folder {folder_id}: {e}")
            return {
                "accessible": False,
                "folder_id": folder_id,
                "error": str(e),
                "mock_mode": False,
            }

    @staticmethod
    def get_month_aliases(month_name: str, year: int) -> List[str]:
        """Generates common month/year naming aliases used across client operational drives."""
        m_lower = month_name.lower().strip()
        month_map = {
            "january": ("jan", "01", "1"), "february": ("feb", "02", "2"),
            "march": ("mar", "03", "3"), "april": ("apr", "04", "4"),
            "may": ("may", "05", "5"), "june": ("jun", "06", "6"),
            "july": ("jul", "07", "7"), "august": ("aug", "08", "8"),
            "september": ("sep", "09", "9"), "october": ("oct", "10", "10"),
            "november": ("nov", "11", "11"), "december": ("dec", "12", "12"),
        }
        
        full_name = month_name.capitalize()
        short_name, num_padded, num_raw = month_map.get(m_lower, (m_lower[:3], "00", "0"))
        short_cap = short_name.capitalize()
        yr_short = str(year)[-2:]
        yr_full = str(year)

        aliases = [
            f"{full_name} {yr_full}", f"{full_name}_{yr_full}", f"{full_name}-{yr_full}", f"{full_name}{yr_full}",
            f"{short_cap} {yr_full}", f"{short_cap}_{yr_full}", f"{short_cap}-{yr_full}", f"{short_cap}{yr_full}",
            f"{short_cap} {yr_short}", f"{short_cap}_{yr_short}", f"{short_cap}-{yr_short}",
            f"{yr_full}-{num_padded}", f"{yr_full}_{num_padded}", f"{yr_full} {num_padded}",
            f"{num_padded}-{yr_full}", f"{num_padded}_{yr_full}", f"{num_padded} {yr_full}",
            f"{num_padded}_{full_name}_{yr_full}", f"{num_padded}_{short_cap}_{yr_full}",
            full_name, short_cap,
        ]
        return list(dict.fromkeys(aliases))

    async def list_control_slips(self, folder_id: str, month: str, year: int) -> List[Any]:
        """Discovers source documents across Month-First, Customer-First, or Flat Drive layouts."""
        return await self.discover_documents_multi_convention(folder_id, month, year)

    async def discover_documents_multi_convention(
        self, folder_id: str, month: str, year: int
    ) -> List[Any]:
        """
        Resilient Multi-Convention Google Drive Discovery Engine:
        - Pass 1 (Month-First): Looks for matching Month folders in root -> scans customer subfolders / files.
        - Pass 2 (Customer-First): Looks for Customer folders in root -> scans matching Month subfolders.
        - Pass 3 (Flat): Scans direct image / PDF files in the target folder.
        Automatically tags `customer_name_hint` and `customer_slug` in metadata.
        """
        from app.strategies.base import SourceDocument, SourceType

        if settings.MOCK_MODE or not self.service or not folder_id or folder_id.startswith("mock_"):
            logger.info(f"[MOCK] Multi-convention document discovery for folder '{folder_id}' ({month} {year})")
            return [
                SourceDocument(
                    file_name=f"mock_slip_luxwood_{month.lower()}_{year}_01.jpg",
                    source_type=SourceType.GOOGLE_DRIVE,
                    source_identifier=f"mock_doc_{folder_id}_01",
                    mime_type="image/jpeg",
                    metadata={
                        "folder_id": folder_id,
                        "customer_name_hint": "Luxwood Hotel",
                        "customer_slug": "luxwood",
                        "month": month,
                        "year": year,
                        "hierarchy_pattern": "month_first",
                    },
                ),
                SourceDocument(
                    file_name=f"mock_slip_lennox_{month.lower()}_{year}_02.png",
                    source_type=SourceType.GOOGLE_DRIVE,
                    source_identifier=f"mock_doc_{folder_id}_02",
                    mime_type="image/png",
                    metadata={
                        "folder_id": folder_id,
                        "customer_name_hint": "The Lennox",
                        "customer_slug": "the_lennox",
                        "month": month,
                        "year": year,
                        "hierarchy_pattern": "customer_first",
                    },
                ),
            ]

        month_aliases = self.get_month_aliases(month, year)
        aliases_lower = {a.lower() for a in month_aliases}
        discovered_docs: List[SourceDocument] = []
        ignored_names = {"processed", "archive", "trash", "templates", "backup", "archived", "temp"}

        try:
            # 1. Fetch child folders and loose files in the target root folder
            query = f"'{folder_id}' in parents and trashed = false"
            res = self.service.files().list(
                q=query,
                spaces="drive",
                fields="files(id, name, mimeType, webViewLink, size, createdTime)",
                pageSize=150,
            ).execute()
            items = res.get("files", [])

            child_folders = [f for f in items if f.get("mimeType") == "application/vnd.google-apps.folder"]
            child_files = [f for f in items if f.get("mimeType") != "application/vnd.google-apps.folder"]

            # -------------------------------------------------------------
            # PASS 1: Check for Month-First Hierarchy (Root -> Month Folder -> Customer Folders / Files)
            # -------------------------------------------------------------
            matching_month_folders = [
                f for f in child_folders if f.get("name", "").strip().lower() in aliases_lower
            ]

            if matching_month_folders:
                logger.info(f"📁 [Drive Pass 1: Month-First] Found {len(matching_month_folders)} month folder(s) for '{month} {year}'")
                for mf in matching_month_folders:
                    m_id = mf["id"]
                    m_name = mf["name"]

                    # List items inside Month folder
                    m_res = self.service.files().list(
                        q=f"'{m_id}' in parents and trashed = false",
                        spaces="drive",
                        fields="files(id, name, mimeType, webViewLink, size, createdTime)",
                        pageSize=150,
                    ).execute()
                    m_items = m_res.get("files", [])
                    m_subfolders = [f for f in m_items if f.get("mimeType") == "application/vnd.google-apps.folder"]
                    m_files = [f for f in m_items if f.get("mimeType") != "application/vnd.google-apps.folder"]

                    # If customer subfolders exist inside the month folder (e.g. August 2026 / Luxwood Hotel)
                    for cust_fld in m_subfolders:
                        cust_name = cust_fld["name"].strip()
                        if cust_name.lower() in ignored_names:
                            continue
                        cust_id = cust_fld["id"]
                        cust_slug = cust_name.lower().replace(" ", "_").replace("-", "_")

                        slips = self.list_unprocessed_slips(cust_id)
                        for s in slips:
                            discovered_docs.append(
                                SourceDocument(
                                    file_name=s.get("name", "slip.jpg"),
                                    source_type=SourceType.GOOGLE_DRIVE,
                                    source_identifier=s.get("id"),
                                    mime_type=s.get("mimeType", "image/jpeg"),
                                    metadata={
                                        "folder_id": cust_id,
                                        "month_folder_id": m_id,
                                        "month_folder_name": m_name,
                                        "customer_name_hint": cust_name,
                                        "customer_slug": cust_slug,
                                        "month": month,
                                        "year": year,
                                        "hierarchy_pattern": "month_first_customer_subfolder",
                                    },
                                )
                            )

                    # Also pick up direct files placed in the Month folder root
                    for f in m_files:
                        if self._is_supported_doc(f):
                            discovered_docs.append(
                                SourceDocument(
                                    file_name=f.get("name", "doc.pdf"),
                                    source_type=SourceType.GOOGLE_DRIVE,
                                    source_identifier=f.get("id"),
                                    mime_type=f.get("mimeType", "application/pdf"),
                                    metadata={
                                        "folder_id": m_id,
                                        "month_folder_id": m_id,
                                        "month_folder_name": m_name,
                                        "month": month,
                                        "year": year,
                                        "hierarchy_pattern": "month_first_direct_files",
                                    },
                                )
                            )

            # -------------------------------------------------------------
            # PASS 2: Check for Customer-First Hierarchy (Root -> Customer Folders -> Month Subfolders)
            # -------------------------------------------------------------
            if not discovered_docs and child_folders:
                logger.info("📁 [Drive Pass 2: Customer-First] Checking customer folders for nested month subfolders...")
                for cust_fld in child_folders:
                    cust_name = cust_fld["name"].strip()
                    if cust_name.lower() in ignored_names:
                        continue
                    cust_id = cust_fld["id"]
                    cust_slug = cust_name.lower().replace(" ", "_").replace("-", "_")

                    # Query subfolders of this customer folder
                    cust_res = self.service.files().list(
                        q=f"'{cust_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
                        spaces="drive",
                        fields="files(id, name)",
                        pageSize=50,
                    ).execute()
                    cust_subflds = cust_res.get("files", [])

                    matching_month_subflds = [
                        sf for sf in cust_subflds if sf.get("name", "").strip().lower() in aliases_lower
                    ]

                    for mf in matching_month_subflds:
                        slips = self.list_unprocessed_slips(mf["id"])
                        for s in slips:
                            discovered_docs.append(
                                SourceDocument(
                                    file_name=s.get("name", "slip.jpg"),
                                    source_type=SourceType.GOOGLE_DRIVE,
                                    source_identifier=s.get("id"),
                                    mime_type=s.get("mimeType", "image/jpeg"),
                                    metadata={
                                        "folder_id": mf["id"],
                                        "parent_customer_id": cust_id,
                                        "customer_name_hint": cust_name,
                                        "customer_slug": cust_slug,
                                        "month": month,
                                        "year": year,
                                        "hierarchy_pattern": "customer_first_month_subfolder",
                                    },
                                )
                            )

            # -------------------------------------------------------------
            # PASS 3: Flat Folder Discovery (Direct loose files in folder_id)
            # -------------------------------------------------------------
            if not discovered_docs and child_files:
                logger.info(f"📁 [Drive Pass 3: Flat Files] Scanning direct files in folder '{folder_id}'...")
                for f in child_files:
                    if self._is_supported_doc(f):
                        discovered_docs.append(
                            SourceDocument(
                                file_name=f.get("name", "doc.pdf"),
                                source_type=SourceType.GOOGLE_DRIVE,
                                source_identifier=f.get("id"),
                                mime_type=f.get("mimeType", "application/pdf"),
                                metadata={
                                    "folder_id": folder_id,
                                    "month": month,
                                    "year": year,
                                    "hierarchy_pattern": "flat_folder",
                                },
                            )
                        )

            logger.info(
                f"✅ Discovered {len(discovered_docs)} documents across Drive hierarchy for '{month} {year}'"
            )
            return discovered_docs

        except Exception as e:
            logger.error(f"Error executing multi-convention Google Drive discovery: {e}")
            return []

    def _is_supported_doc(self, file_dict: Dict[str, Any]) -> bool:
        """Helper to determine if a file is an image or PDF document."""
        mime = file_dict.get("mimeType", "")
        name = file_dict.get("name", "").lower()
        supported_exts = (".jpg", ".jpeg", ".png", ".webp", ".pdf", ".heic", ".bmp", ".tiff", ".tif", ".csv")
        return mime.startswith("image/") or mime == "application/pdf" or name.endswith(supported_exts)


