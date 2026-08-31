"""Tests for Multi-Pipeline Ingestion and Execution Engine."""

import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.models.db_models import ClientOrganization, StagedTransaction, AccountingEntityType
from app.strategies.dynamic_blueprint import DynamicBlueprintStrategy


@pytest.mark.asyncio
async def test_client_multi_pipeline_creation_and_retrieval():
    from app.db.session import get_engine
    from sqlmodel import Session, select
    
    with Session(get_engine()) as session:
        existing = session.exec(select(ClientOrganization).where(ClientOrganization.id == "opera_square_multitest")).first()
        if existing:
            session.delete(existing)
            session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Register new multi-pipeline client
        payload = {
            "name": "Opera Square MultiTest",
            "industry": "Wholesale & Retail Electrical Distribution",
            "icon": "🛍️",
            "status": "dev",
            "pipelines": [
                {
                    "id": "pipe_ar_slips",
                    "name": "Counter Sales & Delivery Slips",
                    "section": "AR",
                    "entity_type": "ar_sales_invoice",
                    "source_type": "google_drive",
                    "source_identifier": "drive_folder_ar",
                    "default_account_code": "4000 - Sales Revenue",
                },
                {
                    "id": "pipe_ap_bills",
                    "name": "China & Local Supplier Bills",
                    "section": "AP",
                    "entity_type": "ap_vendor_bill",
                    "source_type": "google_drive",
                    "source_identifier": "drive_folder_ap",
                    "default_account_code": "5000 - Inventory Purchases",
                },
                {
                    "id": "pipe_bank_rec",
                    "name": "GCB Bank Statements",
                    "section": "BANK",
                    "entity_type": "bank_statement",
                    "source_type": "onedrive",
                    "source_identifier": "onedrive_bank",
                }
            ]
        }
        res = await client.post("/api/v1/clients", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["id"] == "opera_square_multitest"
        assert len(data["pipelines"]) == 3

        # Retrieve client config
        cfg_res = await client.get("/api/v1/clients/opera_square_multitest/config")
        assert cfg_res.status_code == 200
        cfg_data = cfg_res.json()
        assert len(cfg_data["pipelines"]) == 3
        assert cfg_data["pipelines"][0]["name"] == "Counter Sales & Delivery Slips"

        # Add a 4th pipeline
        new_pipe_payload = {
            "id": "pipe_momo_receipts",
            "name": "MTN MoMo Customer Receipts",
            "section": "AR",
            "entity_type": "ar_customer_payment",
            "source_type": "email",
            "source_identifier": "momo@operasquare.com",
        }
        pipe_res = await client.post("/api/v1/clients/opera_square_multitest/pipelines", json=new_pipe_payload)
        assert pipe_res.status_code == 200
        updated_pipes = pipe_res.json()
        assert len(updated_pipes) == 4

        # Delete a pipeline
        del_res = await client.delete("/api/v1/clients/opera_square_multitest/pipelines/pipe_momo_receipts")
        assert del_res.status_code == 200
        rem_pipes = del_res.json()
        assert len(rem_pipes) == 3


@pytest.mark.asyncio
async def test_dynamic_blueprint_multi_pipeline_execution():
    from app.db.session import get_engine
    from sqlmodel import Session, select
    
    with Session(get_engine()) as session:
        existing_txs = session.exec(select(StagedTransaction).where(StagedTransaction.client_id == "opera_test_runner")).all()
        for tx in existing_txs:
            session.delete(tx)
        session.commit()

    client_org = ClientOrganization(
        id="opera_test_runner",
        name="Opera Test Runner",
        industry="Retail",
        pipelines=[
            {
                "id": "p_ar",
                "name": "AR Sales Invoices",
                "section": "AR",
                "entity_type": "ar_sales_invoice",
                "source_type": "manual",
                "source_identifier": "",
            },
            {
                "id": "p_ap",
                "name": "AP Supplier Bills",
                "section": "AP",
                "entity_type": "ap_vendor_bill",
                "source_type": "manual",
                "source_identifier": "",
            }
        ]
    )

    strategy = DynamicBlueprintStrategy(client_org)
    sources = await strategy.discover_sources("August", 2026)
    assert len(sources) == 2
    assert sources[0].metadata["entity_type"] == "ar_sales_invoice"
    assert sources[1].metadata["entity_type"] == "ap_vendor_bill"

    # Extraction & Staging
    extracted = await strategy.extract_and_validate(sources)
    assert len(extracted) >= 2

    # Staging review ledger
    stage_res = await strategy.sync_review_workspace("August", 2026, extracted)
    assert stage_res["status"] == "STAGED"
    assert stage_res["staged_transactions_count"] >= 2
