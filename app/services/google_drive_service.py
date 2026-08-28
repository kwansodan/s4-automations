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
        """Gets or creates the Month folder '<Month> <YYYY>' under root CONTROL_SHEETS_FOLDER_ID."""
        folder_name = f"{month_name} {year}"
        root_id = (settings.CONTROL_SHEETS_FOLDER_ID or "").strip()
        if not root_id or root_id in ("your_google_drive_folder_id", "your_folder_id", "1aB2cD3eF4gH..."):
            root_id = "root"
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
