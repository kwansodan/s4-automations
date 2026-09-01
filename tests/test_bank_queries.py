"""Comprehensive Automated Tests for Bank Transactions, Information Requests & Client Portal."""

import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.api.v1.bank_portal import generate_magic_link_token, validate_magic_link_token, generate_portal_token


@pytest.mark.asyncio
async def test_get_chart_of_accounts_and_watched_accounts():
    """Test retrieving Chart of Accounts with watched status flags."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get("/api/v1/bank/clients/anr_group/accounts")
        assert res.status_code == 200
        data = res.json()
        assert data["client_id"] == "anr_group"
        assert "watched_accounts" in data
        assert isinstance(data["accounts"], list)
        assert len(data["accounts"]) > 0

        # Verify suspense account flag
        suspense_accs = [a for a in data["accounts"] if a.get("is_suspense")]
        assert len(suspense_accs) > 0


@pytest.mark.asyncio
async def test_update_watched_accounts():
    """Test updating the watched Chart of Account codes for a client."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        new_watched = ["6990", "850", "acc_5100", "acc_5200"]
        res = await ac.put(
            "/api/v1/bank/clients/anr_group/watched-accounts",
            json={"watched_accounts": new_watched},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert data["watched_accounts"] == new_watched


@pytest.mark.asyncio
async def test_list_bank_transactions_and_metrics():
    """Test retrieving bank transactions with summary KPIs and filter flags."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get("/api/v1/bank/clients/anr_group/transactions?status=ALL")
        assert res.status_code == 200
        data = res.json()
        assert data["client_id"] == "anr_group"
        assert "metrics" in data
        assert "transactions" in data
        assert data["metrics"]["total_count"] >= 1
        assert "total_uncategorized" in data["metrics"]
        assert "total_pending_client" in data["metrics"]
        assert "total_client_answered" in data["metrics"]


@pytest.mark.asyncio
async def test_accountant_categorize_bank_transaction():
    """Test inline categorization and account mapping of a transaction."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # First get an existing transaction
        list_res = await ac.get("/api/v1/bank/clients/anr_group/transactions?status=ALL")
        txs = list_res.json()["transactions"]
        target_tx = txs[0]

        cat_res = await ac.post(
            f"/api/v1/bank/transactions/{target_tx['id']}/categorize",
            json={
                "mapped_account_id": "acc_5200",
                "mapped_account_name": "Vehicle Fuel & Transport",
                "payee_name": "Total Energies Accra",
                "tax_rate": "Standard VAT (15%)",
                "post_to_accounting": True,
            },
        )
        assert cat_res.status_code == 200
        data = cat_res.json()
        assert data["success"] is True
        assert data["transaction"]["mapped_account_id"] == "acc_5200"
        assert data["transaction"]["status"] == "MAPPED"


@pytest.mark.asyncio
async def test_accountant_query_and_magic_link_dispatch():
    """Test drawing client attention, creating magic link, and notifying stakeholder."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        list_res = await ac.get("/api/v1/bank/clients/anr_group/transactions?status=ALL")
        txs = list_res.json()["transactions"]
        target_tx = txs[0]

        query_res = await ac.post(
            f"/api/v1/bank/transactions/{target_tx['id']}/query",
            json={
                "query_text": "Kwame, please provide the commercial invoice for this fleet refueling.",
                "recipient_email": "cfo@anrgroup.com",
                "send_immediately": True,
            },
        )
        assert query_res.status_code == 200
        data = query_res.json()
        assert data["success"] is True
        assert data["transaction"]["status"] == "CLARIFICATION_REQUESTED"
        assert "portal_magic=" in data["magic_url"]

        # Validate magic link token
        magic_token = data["magic_url"].split("portal_magic=")[1]
        token_data = validate_magic_link_token(magic_token)
        assert token_data is not None
        assert token_data["client_id"] == "anr_group"
        assert token_data["target_tx_id"] == target_tx["id"]


@pytest.mark.asyncio
async def test_client_portal_magic_access_and_explanation_submit():
    """Test client 1-click magic access and submitting explanatory notes."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Generate token
        magic_token = generate_magic_link_token("anr_group", "ANR Logistics Group", 1)
        magic_res = await ac.get(f"/api/v1/portal/magic-access?token={magic_token}")
        assert magic_res.status_code == 200
        auth_data = magic_res.json()
        assert auth_data["success"] is True
        assert "token" in auth_data
        session_token = auth_data["token"]

        # Submit explanation as authenticated client
        explain_res = await ac.post(
            "/api/v1/portal/transactions/1/explain",
            headers={"Authorization": f"Bearer {session_token}"},
            json={
                "client_explanation": "Refueling payment for 3 delivery trucks operating in Tema port.",
                "client_attachments": [{"name": "Total_Fuel_Invoice_Aug26.pdf", "size": 102400}],
            },
        )
        assert explain_res.status_code == 200
        explain_data = explain_res.json()
        assert explain_data["success"] is True
        assert explain_data["transaction"]["status"] == "CLIENT_ANSWERED"
        assert "Refueling payment" in explain_data["transaction"]["client_explanation"]


@pytest.mark.asyncio
async def test_bulk_categorize_and_bulk_query():
    """Test bulk actions on multiple bank transactions."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        list_res = await ac.get("/api/v1/bank/clients/anr_group/transactions?status=ALL")
        txs = list_res.json()["transactions"]
        tx_ids = [t["id"] for t in txs[:2]]

        # Bulk categorize
        bulk_cat = await ac.post(
            "/api/v1/bank/transactions/bulk-categorize",
            json={
                "transaction_ids": tx_ids,
                "mapped_account_id": "acc_5100",
                "mapped_account_name": "Office Supplies & Stationery",
            },
        )
        assert bulk_cat.status_code == 200
        assert bulk_cat.json()["categorized_count"] == len(tx_ids)

        # Bulk query
        bulk_query = await ac.post(
            "/api/v1/bank/transactions/bulk-query",
            json={
                "transaction_ids": tx_ids,
                "query_text": "Please confirm if these items were purchased under monthly office budget.",
                "recipient_email": "operations@anrgroup.com",
            },
        )
        assert bulk_query.status_code == 200
        assert bulk_query.json()["queried_count"] == len(tx_ids)
