"""Tests for Accounts Payable and Bank Transaction Reconciliation Portal."""

import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.models.schemas import OCRAPBillExtraction, OCRBankStatementExtraction
from app.services.zoho_service import ZohoBooksService


@pytest.mark.asyncio
async def test_bank_portal_otp_flow():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Request OTP
        req_res = await client.post(
            "/api/v1/portal/auth/request-otp",
            json={"identifier": "anr_group"},
        )
        assert req_res.status_code == 200
        req_data = req_res.json()
        assert req_data["success"] is True
        assert "dev_hint" in req_data
        otp_code = req_data["dev_hint"].replace("OTP Code: ", "").strip()

        # Verify OTP
        verify_res = await client.post(
            "/api/v1/portal/auth/verify-otp",
            json={"identifier": "anr_group", "otp": otp_code},
        )
        assert verify_res.status_code == 200
        verify_data = verify_res.json()
        assert verify_data["success"] is True
        token = verify_data["token"]
        assert token is not None

        # Fetch Portal Transactions
        tx_res = await client.get(
            "/api/v1/portal/transactions",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert tx_res.status_code == 200
        assert isinstance(tx_res.json(), list)


@pytest.mark.asyncio
async def test_zoho_vendor_creation():
    zoho = ZohoBooksService()
    vendor = await zoho.create_vendor_contact("Golden Detergents Ltd")
    assert vendor is not None
    assert vendor.contact_name == "Golden Detergents Ltd"


@pytest.mark.asyncio
async def test_accountant_bank_endpoints():
    """Verify accountant endpoints for listing, querying and mapping bank transactions."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. List client bank transactions
        list_res = await client.get("/api/v1/bank/clients/anr_group/transactions")
        assert list_res.status_code == 200
        data = list_res.json()
        assert "transactions" in data
        assert isinstance(data["transactions"], list)

        # 2. Upload a sample statement
        files = {"file": ("test_stmt.csv", b"Date,Description,Debit,Credit,Balance\n2026-08-01,Service Fee,50.00,,500.00\n", "text/csv")}
        upload_res = await client.post(
            "/api/v1/bank/upload",
            data={"client_id": "anr_group", "month": "August", "year": 2026},
            files=files,
        )
        assert upload_res.status_code == 200
        upload_data = upload_res.json()
        assert upload_data["status"] == "success"

