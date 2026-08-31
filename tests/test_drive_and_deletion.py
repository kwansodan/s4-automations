"""Tests for Google Drive Multi-Convention Hierarchy Engine & Safe Deletion Integrity Guards."""

import uuid
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.services.google_drive_service import GoogleDriveService


def test_google_drive_month_aliases_generation():
    drive = GoogleDriveService()
    aliases_aug = drive.get_month_aliases("August", 2026)
    
    # Assert essential variations are generated
    assert "August 2026" in aliases_aug
    assert "Aug 2026" in aliases_aug
    assert "August_2026" in aliases_aug
    assert "Aug_2026" in aliases_aug
    assert "2026-08" in aliases_aug
    assert "08-2026" in aliases_aug
    assert "Aug 26" in aliases_aug
    assert "August" in aliases_aug
    assert "Aug" in aliases_aug

    # Assert December variations
    aliases_dec = drive.get_month_aliases("december", 2025)
    assert "December 2025" in aliases_dec
    assert "Dec 2025" in aliases_dec
    assert "2025-12" in aliases_dec


@pytest.mark.asyncio
async def test_google_drive_multi_convention_discovery():
    drive = GoogleDriveService()
    
    # Mock multi-convention discovery
    docs = await drive.discover_documents_multi_convention("mock_fld_root", "August", 2026)
    assert len(docs) > 0
    
    # Check customer metadata hints are automatically attached
    doc_1 = docs[0]
    assert doc_1.metadata.get("customer_name_hint") in ["Luxwood Hotel", "The Lennox"]
    assert "customer_slug" in doc_1.metadata
    assert doc_1.metadata.get("month") == "August"
    assert doc_1.metadata.get("year") == 2026


@pytest.mark.asyncio
async def test_client_deletion_integrity_guard():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Create a client with 1 pipeline
        unique_id = uuid.uuid4().hex[:6]
        client_payload = {
            "name": f"Acme Holdings {unique_id}",
            "industry": "Commercial Holding & Retail",
            "accounting_software": "zoho_books",
            "pipelines": [
                {
                    "id": f"pipe_acme_pos_{unique_id}",
                    "name": "POS Daily Ingestion",
                    "section": "AR",
                    "entity_type": "ar_sales_invoice",
                    "source_type": "google_drive",
                    "source_identifier": f"1fld_acme_pos_{unique_id}",
                    "active": True,
                }
            ],
            "team_members": [
                {
                    "id": "tm_cfo_acme",
                    "name": "CFO Acme",
                    "email": "cfo@acme.com",
                    "role": "CFO",
                    "notifications": {
                        "executive_digest": True,
                        "critical_anomalies": True,
                        "staged_approvals": False,
                        "channel": "email",
                    },
                }
            ],
        }

        create_res = await ac.post("/api/v1/clients", json=client_payload)
        assert create_res.status_code == 200
        client_data = create_res.json()
        client_id = client_data["id"]

        # 2. Attempt to delete client while it has active pipelines -> MUST BE BLOCKED (HTTP 400)
        del_attempt_1 = await ac.delete(f"/api/v1/clients/{client_id}")
        assert del_attempt_1.status_code == 400
        error_detail = del_attempt_1.json().get("detail", "")
        assert "Cannot delete organisation" in error_detail
        assert "active pipeline stream(s)" in error_detail

        # 3. Delete the pipeline stream first
        del_pipe_res = await ac.delete(f"/api/v1/clients/{client_id}/pipelines/pipe_acme_pos_{unique_id}")
        assert del_pipe_res.status_code == 200
        remaining_pipes = del_pipe_res.json()
        assert isinstance(remaining_pipes, list)
        assert len(remaining_pipes) == 0

        # 4. Now delete the client organization -> MUST SUCCEED (HTTP 200)
        del_attempt_2 = await ac.delete(f"/api/v1/clients/{client_id}")
        assert del_attempt_2.status_code == 200
        assert del_attempt_2.json()["success"] is True

        # 5. Verify client no longer exists
        get_res = await ac.get(f"/api/v1/clients/{client_id}")
        assert get_res.status_code == 404
