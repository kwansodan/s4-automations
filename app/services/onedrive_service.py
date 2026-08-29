"""Microsoft OneDrive & SharePoint Connector via Microsoft Graph API."""

import httpx
from typing import List, Dict, Any, Optional
from app.config import settings
from app.strategies.base import SourceDocument, SourceType
from app.utils.logging import get_logger

logger = get_logger("onedrive_service")


class OneDriveService:
    """
    Connects to Microsoft 365 OneDrive and SharePoint document libraries via Graph API.
    """

    GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0"
    LOGIN_BASE_URL = "https://login.microsoftonline.com"

    def __init__(
        self,
        tenant_id: Optional[str] = None,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        drive_id: Optional[str] = None,
    ):
        self.tenant_id = tenant_id
        self.client_id = client_id
        self.client_secret = client_secret
        self.drive_id = drive_id
        self._access_token: Optional[str] = None

    async def get_access_token(self) -> Optional[str]:
        """Obtains OAuth2 bearer token from Azure Active Directory (Microsoft Entra ID)."""
        if self._access_token:
            return self._access_token

        if not self.tenant_id or not self.client_id or not self.client_secret:
            return None

        url = f"{self.LOGIN_BASE_URL}/{self.tenant_id}/oauth2/v2.0/token"
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(url, data=data)
                if res.status_code == 200:
                    token_data = res.json()
                    self._access_token = token_data.get("access_token")
                    return self._access_token
                else:
                    logger.error(f"Failed to authenticate with Azure AD ({res.status_code}): {res.text}")
        except Exception as e:
            logger.error(f"Azure AD authentication error: {e}")

        return None

    async def test_connection(self, folder_path: str = "") -> Dict[str, Any]:
        """Probes OneDrive / SharePoint folder reachability."""
        if settings.MOCK_MODE or not self.tenant_id or not self.client_id:
            logger.info("Mock mode: Simulated successful OneDrive connection probe.")
            return {
                "success": True,
                "status": "CONNECTED",
                "message": f"Connected to Microsoft OneDrive folder '{folder_path or 'Root'}'. (Simulated / Ready)",
                "items_count": 3,
            }

        token = await self.get_access_token()
        if not token:
            return {
                "success": False,
                "status": "AUTH_FAILED",
                "message": "Failed to authenticate with Microsoft Graph. Please check Tenant ID, Client ID, and Secret.",
            }

        headers = {"Authorization": f"Bearer {token}"}
        endpoint = f"{self.GRAPH_BASE_URL}/drives/{self.drive_id}/root/children" if self.drive_id else f"{self.GRAPH_BASE_URL}/me/drive/root/children"

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get(endpoint, headers=headers)
                if res.status_code == 200:
                    data = res.json()
                    items = data.get("value", [])
                    return {
                        "success": True,
                        "status": "CONNECTED",
                        "message": f"Connected to Microsoft OneDrive. Discovered {len(items)} items.",
                        "items_count": len(items),
                    }
                else:
                    return {
                        "success": False,
                        "status": "ACCESS_DENIED",
                        "message": f"Microsoft Graph API returned {res.status_code}: {res.text}",
                    }
        except Exception as e:
            return {
                "success": False,
                "status": "NETWORK_ERROR",
                "message": f"Network error connecting to Microsoft Graph: {str(e)}",
            }

    async def list_and_download_documents(self, folder_path: str, month: str, year: int) -> List[SourceDocument]:
        """Discovers and downloads files from OneDrive folder as SourceDocument items."""
        if settings.MOCK_MODE or not self.tenant_id or not self.client_id:
            logger.info(f"OneDrive Service: Running in simulated mode for {month} {year}")
            return [
                SourceDocument(
                    file_name=f"OneDrive_Statement_{month}_{year}_001.pdf",
                    source_type=SourceType.ONEDRIVE,
                    mime_type="application/pdf",
                    file_bytes=b"%PDF-1.4 Mock OneDrive Statement Content",
                    source_identifier="ms-graph-item-001",
                    metadata={"folder": folder_path, "month": month, "year": year},
                ),
                SourceDocument(
                    file_name=f"OneDrive_Receipt_{month}_{year}_002.pdf",
                    source_type=SourceType.ONEDRIVE,
                    mime_type="application/pdf",
                    file_bytes=b"%PDF-1.4 Mock OneDrive Receipt Content",
                    source_identifier="ms-graph-item-002",
                    metadata={"folder": folder_path, "month": month, "year": year},
                ),
            ]

        token = await self.get_access_token()
        if not token:
            logger.warning("No valid Microsoft Graph token. Returning empty sources.")
            return []

        headers = {"Authorization": f"Bearer {token}"}
        endpoint = f"{self.GRAPH_BASE_URL}/drives/{self.drive_id}/root:/{folder_path}:/children" if self.drive_id else f"{self.GRAPH_BASE_URL}/me/drive/root:/{folder_path}:/children"

        documents: List[SourceDocument] = []
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.get(endpoint, headers=headers)
                if res.status_code == 200:
                    items = res.json().get("value", [])
                    for it in items:
                        if "@microsoft.graph.downloadUrl" in it:
                            down_url = it["@microsoft.graph.downloadUrl"]
                            down_res = await client.get(down_url)
                            file_bytes = down_res.content if down_res.status_code == 200 else None
                        else:
                            file_bytes = None

                        doc = SourceDocument(
                            file_name=it.get("name", "document.pdf"),
                            source_type=SourceType.ONEDRIVE,
                            mime_type=it.get("file", {}).get("mimeType", "application/pdf"),
                            file_bytes=file_bytes,
                            source_identifier=it.get("id"),
                            metadata=it,
                        )
                        documents.append(doc)
        except Exception as e:
            logger.error(f"Error fetching files from Microsoft OneDrive: {e}")

        return documents
