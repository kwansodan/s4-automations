"""Unit tests for Microsoft OneDrive & SharePoint Service."""

import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from app.services.onedrive_service import OneDriveService
from app.strategies.base import SourceType


@pytest.mark.asyncio
async def test_onedrive_mock_mode_connection_test():
    """Verify OneDrive connection probe returns success with mocked Graph API."""
    svc = OneDriveService(tenant_id="test_tenant", client_id="test_client", client_secret="test_secret")
    with patch.object(svc, "get_access_token", new_callable=AsyncMock) as mock_tok, \
         patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_tok.return_value = "token_graph_123"
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"value": [{"id": "item1", "name": "invoice_aug.pdf"}]}
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        res = await svc.test_connection(folder_path="/Invoices/2026")
        assert res["success"] is True
        assert res["status"] == "CONNECTED"


@pytest.mark.asyncio
async def test_onedrive_document_download():
    """Verify OneDrive document listing returns SourceDocument objects."""
    svc = OneDriveService(tenant_id="test_tenant", client_id="test_client", client_secret="test_secret")
    with patch.object(svc, "get_access_token", new_callable=AsyncMock) as mock_tok, \
         patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_tok.return_value = "token_graph_123"

        list_resp = MagicMock()
        list_resp.status_code = 200
        list_resp.json.return_value = {
            "value": [
                {"id": "doc1", "name": "august_invoice_01.pdf", "size": 1024, "@microsoft.graph.downloadUrl": "http://download/doc1"},
                {"id": "doc2", "name": "august_invoice_02.pdf", "size": 2048, "@microsoft.graph.downloadUrl": "http://download/doc2"},
            ]
        }

        dl_resp = MagicMock()
        dl_resp.status_code = 200
        dl_resp.content = b"%PDF-1.4 Mock PDF Content"
        dl_resp.raise_for_status = MagicMock()

        mock_get.side_effect = [list_resp, dl_resp, dl_resp]

        docs = await svc.list_and_download_documents(folder_path="/Accounting", month="August", year=2026)
        assert len(docs) >= 2
        assert docs[0].source_type == SourceType.ONEDRIVE
        assert docs[0].file_name.endswith(".pdf")
        assert docs[0].get_checksum() is not None


def test_sharepoint_url_parsing():
    """Verify SharePoint web folder URL is parsed into hostname, site_name, and relative path."""
    url = "https://service4limitedcompany.sharepoint.com/sites/s4bookkeeping/Shared%20Documents/General/Opera%20square/Ingestion"
    parsed = OneDriveService.parse_folder_path_or_url(url)

    assert parsed["type"] == "sharepoint_site"
    assert parsed["hostname"] == "service4limitedcompany.sharepoint.com"
    assert parsed["site_name"] == "s4bookkeeping"
    assert "General/Opera square/Ingestion" in parsed["clean_path"]
