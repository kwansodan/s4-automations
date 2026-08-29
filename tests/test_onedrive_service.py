"""Unit tests for Microsoft OneDrive & SharePoint Service."""

import pytest
from unittest.mock import patch, AsyncMock
from app.services.onedrive_service import OneDriveService
from app.strategies.base import SourceType


@pytest.mark.asyncio
async def test_onedrive_mock_mode_connection_test():
    """Verify OneDrive connection probe returns success in mock mode."""
    svc = OneDriveService(tenant_id="test_tenant", client_id="test_client")
    res = await svc.test_connection(folder_path="/Invoices/2026")

    assert res["success"] is True
    assert res["status"] == "CONNECTED"


@pytest.mark.asyncio
async def test_onedrive_document_download():
    """Verify OneDrive document listing returns SourceDocument objects."""
    svc = OneDriveService(tenant_id="test_tenant", client_id="test_client")
    docs = await svc.list_and_download_documents(folder_path="/Accounting", month="August", year=2026)

    assert len(docs) >= 2
    assert docs[0].source_type == SourceType.ONEDRIVE
    assert docs[0].file_name.endswith(".pdf")
    assert docs[0].get_checksum() is not None
