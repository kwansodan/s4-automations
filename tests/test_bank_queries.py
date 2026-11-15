import pytest
from httpx import AsyncClient, ASGITransport
from sqlmodel import Session, select
from app.main import app
from app.db.session import get_engine
from app.models.db_models import BankTransaction
from app.api.v1.bank_portal import generate_magic_link_token, validate_magic_link_token, generate_portal_token


@pytest.fixture(autouse=True)
def setup_test_bank_transactions():
    """Sets up isolated test transactions for test suite execution."""
    with Session(get_engine()) as session:
        existing = session.exec(select(BankTransaction).where(BankTransaction.client_id == "anr_group")).first()
        if not existing:
            tx1 = BankTransaction(
                id=1,
                client_id="anr_group",
                transaction_date="2026-09-28",
                description="Fleet Fuel Refueling Expense",
                amount=1850.0,
                transaction_type="DEBIT",
                bank_account_name="Main Operating Account",
                status="UNMAPPED",
                source_file_name="test_upload.pdf",
            )
            tx2 = BankTransaction(
                id=2,
                client_id="anr_group",
                transaction_date="2026-09-25",
                description="Office Stationeries Supply",
                amount=450.0,
                transaction_type="DEBIT",
                bank_account_name="Main Operating Account",
                status="UNMAPPED",
                source_file_name="test_upload.pdf",
            )
            session.add(tx1)
            session.add(tx2)
            session.commit()


@pytest.mark.asyncio
async def test_get_chart_of_accounts_and_watched_accounts():
    """Test retrieving Chart of Accounts with watched status flags."""
    from unittest.mock import patch
    sample_accounts = [
        {"account_id": "acc_6990", "account_name": "Suspense Account", "account_type": "Other Current Liability", "is_suspense": True},
        {"account_id": "acc_850", "account_name": "Uncategorized Expense", "account_type": "Expense", "is_suspense": True},
        {"account_id": "acc_5100", "account_name": "Fuel & Fleet", "account_type": "Expense", "is_suspense": False},
    ]
    transport = ASGITransport(app=app)
    with patch("app.services.accounting.zoho_adapter.ZohoBooksAdapter.fetch_chart_of_accounts", return_value=sample_accounts):
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


@pytest.mark.asyncio
async def test_list_transactions_with_month_filter_and_metrics():
    """Test filtering transactions by month and verifying available_months and scoped KPIs."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Fetch with ALL months
        all_res = await ac.get("/api/v1/bank/clients/anr_group/transactions?status=ALL&month=ALL")
        assert all_res.status_code == 200
        all_data = all_res.json()
        assert "available_months" in all_data
        assert isinstance(all_data["available_months"], list)
        assert len(all_data["available_months"]) > 0

        # 2. Pick the first available month (e.g. 2026-09)
        sample_month = all_data["available_months"][0]
        month_res = await ac.get(f"/api/v1/bank/clients/anr_group/transactions?status=ALL&month={sample_month}")
        assert month_res.status_code == 200
        month_data = month_res.json()
        assert month_data["month"] == sample_month
        assert "metrics" in month_data
        # All returned transactions must match the sampled month
        for tx in month_data["transactions"]:
            assert tx["transaction_date"].startswith(sample_month)


@pytest.mark.asyncio
async def test_sync_watched_accounts_with_month_scope():
    """Test syncing transactions residing in watched accounts for a target month."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        sync_res = await ac.post("/api/v1/bank/clients/anr_group/sync-accounting?month=September&year=2026")
        assert sync_res.status_code == 200
        sync_data = sync_res.json()
        assert sync_data["success"] is True
        assert "synced_new_count" in sync_data
        assert any(term in sync_data["message"].lower() for term in ["watched accounts", "bank feed", "uncategorized"])


@pytest.mark.asyncio
async def test_unified_information_requests_control_center_and_portal():
    """Test creating, listing, reminding, following up, portal answering, and resolving AR, AP, BANK, and GENERAL requests."""
    from app.models.db_models import StagedTransaction

    with Session(get_engine()) as session:
        ar_tx = StagedTransaction(
            client_id="anr_group",
            batch_id="batch_ar_test",
            pipeline_type="AR",
            entity_type="invoice_item",
            transaction_date="2026-10-12",
            source_type="google_drive",
            source_file_name="Labadi_Beach_Hotel_12_10_2026.jpg",
            item_or_description="Bed Sheets King Size",
            category_or_account="Sales",
            quantity_or_debit=50.0,
            credit_amount=48.0,
            rate_or_price=10.0,
            total_amount=500.0,
            reviewed=False,
            approved=False,
            status="PENDING",
            metadata_json={"customer_name": "Labadi Beach Hotel"},
        )
        ap_tx = StagedTransaction(
            client_id="anr_group",
            batch_id="batch_ap_test",
            pipeline_type="AP",
            entity_type="vendor_bill",
            transaction_date="2026-10-14",
            source_type="google_drive",
            source_file_name="ECG_Power_Bill_Oct26.pdf",
            item_or_description="Electricity Utility Bill",
            category_or_account="Utilities Expense",
            quantity_or_debit=1.0,
            rate_or_price=1200.0,
            total_amount=1200.0,
            reviewed=False,
            approved=False,
            status="PENDING",
            metadata_json={"vendor_name": "Electricity Company of Ghana"},
        )
        session.add(ar_tx)
        session.add(ap_tx)
        session.commit()
        session.refresh(ar_tx)
        session.refresh(ap_tx)
        ar_id = ar_tx.id
        ap_id = ap_tx.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Create AR request
        ar_req_res = await ac.post(
            "/api/v1/bank/requests/create",
            json={
                "client_id": "anr_group",
                "pipeline_type": "AR",
                "staged_transaction_ids": [ar_id],
                "query_text": "Please confirm why 2 bed sheets were short on delivery.",
                "recipient_email": "ops@anrgroup.com",
                "send_immediately": False,
            },
        )
        assert ar_req_res.status_code == 200
        ar_req_data = ar_req_res.json()
        assert ar_req_data["success"] is True
        ar_item_key = f"STAGED:{ar_id}"

        # 2. Create AP request
        ap_req_res = await ac.post(
            "/api/v1/bank/requests/create",
            json={
                "client_id": "anr_group",
                "pipeline_type": "AP",
                "staged_transaction_ids": [ap_id],
                "query_text": "Please attach the official VAT receipt for this ECG bill.",
                "recipient_email": "finance@anrgroup.com",
                "send_immediately": False,
            },
        )
        assert ap_req_res.status_code == 200
        ap_item_key = f"STAGED:{ap_id}"

        # 3. Create GENERAL ad-hoc request
        gen_req_res = await ac.post(
            "/api/v1/bank/requests/create",
            json={
                "client_id": "anr_group",
                "pipeline_type": "GENERAL",
                "general_title": "October Payroll Summary Schedule",
                "party_name": "Monthly Close",
                "general_amount": 0.0,
                "query_text": "Please upload the signed October payroll summary sheet.",
                "recipient_email": "hr@anrgroup.com",
                "send_immediately": False,
            },
        )
        assert gen_req_res.status_code == 200
        gen_req_data = gen_req_res.json()
        assert gen_req_data["success"] is True
        gen_item_key = gen_req_data["request_ids"][0]

        # 4. Verify GENERAL request does NOT pollute AR transactions list
        ar_list_res = await ac.get("/api/clients/anr_group/transactions?pipeline_type=AR")
        assert ar_list_res.status_code == 200
        ar_list_items = ar_list_res.json()
        assert isinstance(ar_list_items, list)
        assert all(item.get("pipeline_type") != "GENERAL" for item in ar_list_items)
        matched_ar = [item for item in ar_list_items if item["id"] == ar_id]
        assert len(matched_ar) == 1
        assert matched_ar[0]["query_status"] == "CLARIFICATION_REQUESTED"

        # 5. List requests in Control Center
        cc_res = await ac.get("/api/v1/bank/requests?client_id=anr_group")
        assert cc_res.status_code == 200
        cc_data = cc_res.json()
        assert cc_data["metrics"]["total_count"] >= 3
        assert cc_data["metrics"]["ar_count"] >= 1
        assert cc_data["metrics"]["ap_count"] >= 1
        assert cc_data["metrics"]["general_count"] >= 1
        returned_keys = {i["item_key"] for i in cc_data["items"]}
        assert ar_item_key in returned_keys
        assert ap_item_key in returned_keys
        assert gen_item_key in returned_keys

        # 6. Client Portal lists all pipeline requests & accepts explanation for STAGED AR item
        session_token = generate_portal_token("anr_group", "ANR Logistics Group")
        portal_list = await ac.get(
            "/api/v1/portal/transactions",
            headers={"Authorization": f"Bearer {session_token}"},
        )
        assert portal_list.status_code == 200
        portal_items = portal_list.json()
        portal_keys = {p.get("item_key") for p in portal_items}
        assert ar_item_key in portal_keys
        assert ap_item_key in portal_keys

        explain_ar_res = await ac.post(
            f"/api/v1/portal/items/{ar_item_key}/explain",
            headers={"Authorization": f"Bearer {session_token}"},
            json={
                "client_explanation": "2 sheets were stained and kept back for re-washing.",
                "client_attachments": [{"name": "Signed_Delivery_Note.jpg", "size": 45200}],
            },
        )
        assert explain_ar_res.status_code == 200
        assert explain_ar_res.json()["success"] is True

        # 7. Send reminder & follow-up on AP request
        remind_res = await ac.post(
            "/api/v1/bank/requests/remind",
            json={"item_keys": [ap_item_key]},
        )
        assert remind_res.status_code == 200
        assert remind_res.json()["reminded_count"] == 1

        followup_res = await ac.post(
            "/api/v1/bank/requests/followup",
            json={
                "item_key": ap_item_key,
                "query_text": "Also confirm the meter number on the ECG bill.",
                "send_immediately": False,
            },
        )
        assert followup_res.status_code == 200
        assert followup_res.json()["success"] is True

        # 8. Resolve AR request with 1-click ledger approval
        resolve_res = await ac.post(
            "/api/v1/bank/requests/resolve",
            json={
                "item_keys": [ar_item_key],
                "approve_in_ledger": True,
            },
        )
        assert resolve_res.status_code == 200
        assert resolve_res.json()["resolved_count"] == 1

        # Verify AR item is now approved and RESOLVED
        ar_after = await ac.get("/api/clients/anr_group/transactions?pipeline_type=AR")
        matched_after = [item for item in ar_after.json() if item["id"] == ar_id][0]
        assert matched_after["approved"] is True
        assert matched_after["query_status"] == "RESOLVED"


