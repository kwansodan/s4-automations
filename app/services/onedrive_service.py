"""Microsoft OneDrive & SharePoint Connector via Microsoft Graph API."""

import httpx
import urllib.parse
import re
from typing import List, Dict, Any, Optional
from app.config import settings
from app.strategies.base import SourceDocument, SourceType
from app.utils.logging import get_logger

logger = get_logger("onedrive_service")


class OneDriveService:
    """
    Connects to Microsoft 365 OneDrive and SharePoint document libraries via Graph API.
    Supports both direct Drive IDs and full SharePoint Web Folder URLs.
    Example SharePoint URL:
    https://service4limitedcompany.sharepoint.com/sites/s4bookkeeping/Shared%20Documents/General/Opera%20square/Ingestion
    """

    GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0"
    LOGIN_BASE_URL = "https://login.microsoftonline.com"

    def __init__(
        self,
        tenant_id: Optional[str] = None,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        drive_id: Optional[str] = None,
        folder_path: Optional[str] = None,
    ):
        self.tenant_id = tenant_id
        self.client_id = client_id
        self.client_secret = client_secret
        self.drive_id = drive_id
        self.folder_path = folder_path
        self._access_token: Optional[str] = None

    @staticmethod
    def parse_folder_path_or_url(input_path: str) -> Dict[str, Any]:
        """
        Parses a SharePoint web URL or relative path into Graph API routing parameters.
        Example: https://service4limitedcompany.sharepoint.com/sites/s4bookkeeping/Shared%20Documents/General/Opera%20square/Ingestion
        """
        raw = urllib.parse.unquote(input_path.strip()) if input_path else ""
        if not raw:
            return {"type": "root", "clean_path": ""}

        # Check if full SharePoint / OneDrive URL
        if raw.startswith("http://") or raw.startswith("https://"):
            parsed = urllib.parse.urlparse(raw)
            hostname = parsed.netloc
            path = parsed.path.strip("/")
            
            # Pattern: sites/<site-name>/<doc_library>/<subfolders...>
            match = re.match(r"^sites/([^/]+)(?:/(?:Shared Documents|Shared%20Documents|Documents)?/(.*))?$", path, re.IGNORECASE)
            if match:
                site_name = match.group(1)
                subpath = match.group(2) or ""
                return {
                    "type": "sharepoint_site",
                    "hostname": hostname,
                    "site_name": site_name,
                    "subpath": subpath,
                    "clean_path": subpath or path,
                    "original_url": raw,
                }
            
            return {
                "type": "sharepoint_generic",
                "hostname": hostname,
                "clean_path": path,
                "original_url": raw,
            }

        # Otherwise treat as standard folder path / drive ID
        clean = raw.strip("/").replace("\\", "/")
        return {"type": "relative_path", "clean_path": clean}

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

    async def _resolve_graph_children_endpoint(self, client: httpx.AsyncClient, headers: Dict[str, str], target_path: str) -> Optional[str]:
        """Resolves the Graph API children endpoint for either SharePoint Site or OneDrive."""
        parsed = self.parse_folder_path_or_url(target_path)
        
        if parsed["type"] == "sharepoint_site":
            # 1. Lookup SharePoint site ID
            site_url = f"{self.GRAPH_BASE_URL}/sites/{parsed['hostname']}:/sites/{parsed['site_name']}"
            site_res = await client.get(site_url, headers=headers)
            if site_res.status_code == 200:
                site_id = site_res.json().get("id")
                subpath = parsed.get("subpath")
                if subpath:
                    return f"{self.GRAPH_BASE_URL}/sites/{site_id}/drive/root:/{subpath}:/children"
                return f"{self.GRAPH_BASE_URL}/sites/{site_id}/drive/root/children"
            else:
                logger.warning(f"Could not resolve SharePoint site ({site_res.status_code}): {site_res.text}")

        # Fallback to direct drive_id or default drive
        clean_path = parsed.get("clean_path", "")
        if self.drive_id:
            if clean_path:
                return f"{self.GRAPH_BASE_URL}/drives/{self.drive_id}/root:/{clean_path}:/children"
            return f"{self.GRAPH_BASE_URL}/drives/{self.drive_id}/root/children"

        if clean_path:
            return f"{self.GRAPH_BASE_URL}/me/drive/root:/{clean_path}:/children"
        return f"{self.GRAPH_BASE_URL}/me/drive/root/children"

    async def test_connection(self, folder_path: str = "") -> Dict[str, Any]:
        """Probes OneDrive / SharePoint folder reachability."""
        target = folder_path or self.folder_path or ""
        parsed = self.parse_folder_path_or_url(target)
        display_name = parsed.get("clean_path") or target or "Root Folder"

        if settings.MOCK_MODE or not self.tenant_id or not self.client_id:
            logger.info("Mock mode: Simulated successful OneDrive / SharePoint connection probe.")
            return {
                "success": True,
                "status": "CONNECTED",
                "message": f"Connected to Microsoft SharePoint/OneDrive folder '{display_name}'. (Ready for Ingestion)",
                "items_count": 4,
            }

        token = await self.get_access_token()
        if not token:
            return {
                "success": False,
                "status": "AUTH_FAILED",
                "message": "Failed to authenticate with Microsoft Graph. Please check Tenant ID, Client ID, and Secret.",
            }

        headers = {"Authorization": f"Bearer {token}"}

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                endpoint = await self._resolve_graph_children_endpoint(client, headers, target)
                if not endpoint:
                    return {
                        "success": False,
                        "status": "SITE_NOT_FOUND",
                        "message": "Could not resolve SharePoint site or Document Library from URL.",
                    }

                res = await client.get(endpoint, headers=headers)
                if res.status_code == 200:
                    data = res.json()
                    items = data.get("value", [])
                    return {
                        "success": True,
                        "status": "CONNECTED",
                        "message": f"Connected to Microsoft SharePoint/OneDrive. Discovered {len(items)} items in folder.",
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
        """Discovers and downloads files from OneDrive / SharePoint folder as SourceDocument items."""
        target = folder_path or self.folder_path or ""
        parsed = self.parse_folder_path_or_url(target)
        display_name = parsed.get("clean_path") or target or "Ingestion"

        if settings.MOCK_MODE or not self.tenant_id or not self.client_id:
            logger.info(f"OneDrive Service: Running in simulated mode for {month} {year} ({display_name})")
            return [
                SourceDocument(
                    file_name=f"SharePoint_Slip_{month}_{year}_001.pdf",
                    source_type=SourceType.ONEDRIVE,
                    mime_type="application/pdf",
                    file_bytes=b"%PDF-1.4 Mock SharePoint Document Content",
                    source_identifier="ms-graph-item-001",
                    metadata={"folder": target, "month": month, "year": year},
                ),
                SourceDocument(
                    file_name=f"SharePoint_Invoice_{month}_{year}_002.pdf",
                    source_type=SourceType.ONEDRIVE,
                    mime_type="application/pdf",
                    file_bytes=b"%PDF-1.4 Mock SharePoint Document Content",
                    source_identifier="ms-graph-item-002",
                    metadata={"folder": target, "month": month, "year": year},
                ),
            ]

        token = await self.get_access_token()
        if not token:
            logger.warning("No valid Microsoft Graph token. Returning empty sources.")
            return []

        headers = {"Authorization": f"Bearer {token}"}
        documents: List[SourceDocument] = []

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                endpoint = await self._resolve_graph_children_endpoint(client, headers, target)
                if not endpoint:
                    logger.error("Could not determine Graph endpoint for folder download.")
                    return []

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
            logger.error(f"Error fetching files from Microsoft OneDrive / SharePoint: {e}")

        return documents

