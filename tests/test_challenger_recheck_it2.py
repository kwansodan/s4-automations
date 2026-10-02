"""
Empirical Challenger Iteration 2 Boundary Verification Tests.
Role: empirical-challenger
Milestone: iteration-2-challenger-recheck

Constraints:
- Zero em dashes anywhere in this file.
- Accounts receivable party terminology strictly Customer.
"""

import pytest
from datetime import datetime
from typing import Dict, Any
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.main import app
from app.db.session import init_db, get_engine
from app.models.db_models import StagedTransaction, ClientOrganization
from app.models.inngest_events import InvoiceGenerateEvent
from app.services.zoho_service import ZohoBooksService
from app.services.auth_service import AuthService
from app.workflows.zoho_invoice_generator import run_zoho_invoices_core


@pytest.fixture(autouse=True)
def setup_challenger_tenant():
    """Seed test tenant and initial staged transactions for testing."""
    init_db()
    tenant_slug = "challenger_recheck_tenant"

    with Session(get_engine()) as session:
        existing = session.exec(
            select(ClientOrganization).where(ClientOrganization.id == tenant_slug)
        ).first()
        if not existing:
            new_org = ClientOrganization(
                id=tenant_slug,
                name="Challenger Recheck Org",
                industry="Hospitality",
                zoho_org_id="zoho_org_recheck_001",
                custom_config={
                    "customer_mappings": {
                        "Customer Alpha": {"zoho_contact_id": "cnt_alpha_01"},
                        "Customer Beta": {"zoho_contact_id": "cnt_beta_02"},
                    }
                },
            )
            session.add(new_org)
            session.commit()

        # Clean prior test rows for this tenant
        for old_st in session.exec(
            select(StagedTransaction).where(StagedTransaction.client_id == tenant_slug)
        ).all():
            session.delete(old_st)
        session.commit()

        st_alpha = StagedTransaction(
            id=7701,
            client_id=tenant_slug,
            batch_id="batch_rc_01",
            source_file_name="slip_alpha.jpg",
            transaction_date="2026-08-10T00:00:00Z",
            item_or_description="Standard Tablecloth",
            quantity_or_debit=10.0,
            rate_or_price=20.0,
            total_amount=200.0,
            approved=True,
            status="APPROVED",
            metadata_json={"customer_name": "Customer Alpha", "zoho_contact_id": "cnt_alpha_01"},
        )
        st_beta = StagedTransaction(
            id=7702,
            client_id=tenant_slug,
            batch_id="batch_rc_01",
            source_file_name="slip_beta.jpg",
            transaction_date="2026-08-10T00:00:00Z",
            item_or_description="Large Napkins",
            quantity_or_debit=20.0,
            rate_or_price=5.0,
            total_amount=100.0,
            approved=True,
            status="APPROVED",
            metadata_json={"customer_name": "Customer Beta", "zoho_contact_id": "cnt_beta_02"},
        )
        session.add(st_alpha)
        session.add(st_beta)
        session.commit()

    yield tenant_slug


@pytest.mark.asyncio
async def test_regeneration_unconfirmed_direct_call_raises_value_error(setup_challenger_tenant):
    """Direct call with mode='regenerate' and confirm_delete=False must raise ValueError."""
    tenant_slug = setup_challenger_tenant
    with pytest.raises(ValueError) as exc_info:
        await run_zoho_invoices_core(
            target_month="August",
            target_year=2026,
            filter_client_name=tenant_slug,
            mode="regenerate",
            confirm_delete=False,
        )
    assert str(exc_info.value) == "Regeneration mode requires explicit confirmation (confirm_delete=True)"


@pytest.mark.asyncio
async def test_regeneration_default_confirm_delete_raises_value_error(setup_challenger_tenant):
    """Direct call with mode='regenerate' omitting confirm_delete must raise ValueError."""
    tenant_slug = setup_challenger_tenant
    with pytest.raises(ValueError) as exc_info:
        await run_zoho_invoices_core(
            target_month="August",
            target_year=2026,
            filter_client_name=tenant_slug,
            mode="regenerate",
        )
    assert str(exc_info.value) == "Regeneration mode requires explicit confirmation (confirm_delete=True)"


def test_regeneration_pydantic_schema_validation():
    """InvoiceGenerateEvent schema must reject mode='regenerate' without confirm_delete."""
    with pytest.raises(ValueError, match="Regeneration mode requires explicit confirmation"):
        InvoiceGenerateEvent(
            month="August",
            year=2026,
            mode="regenerate",
            confirm_delete=False,
        )


def test_api_endpoints_reject_unconfirmed_regeneration(setup_challenger_tenant):
    """POST endpoints must reject unconfirmed regeneration payloads with HTTP 422."""
    tenant_slug = setup_challenger_tenant
    client = TestClient(app)
    auth_token = AuthService._create_token("admin@service4gh.com", role="admin")
    headers = {"Authorization": f"Bearer {auth_token}"}

    endpoints = [
        "/api/v1/invoices/generate",
        "/api/v1/invoices/trigger",
        "/api/v1/invoices",
    ]

    for ep in endpoints:
        # Case A: Explicit confirm_delete=False
        resp = client.post(
            ep,
            json={
                "month": "August",
                "year": 2026,
                "client_id": tenant_slug,
                "mode": "regenerate",
                "confirm_delete": False,
            },
            headers=headers,
        )
        assert resp.status_code in (400, 422), f"Endpoint {ep} accepted unconfirmed regeneration: {resp.status_code}"
        assert "Regeneration mode requires explicit confirmation (confirm_delete=True)" in resp.text

        # Case B: Omitted confirm_delete field
        resp_omitted = client.post(
            ep,
            json={
                "month": "August",
                "year": 2026,
                "client_id": tenant_slug,
                "mode": "regenerate",
            },
            headers=headers,
        )
        assert resp_omitted.status_code in (400, 422), f"Endpoint {ep} accepted omitted confirm_delete: {resp_omitted.status_code}"
        assert "Regeneration mode requires explicit confirmation (confirm_delete=True)" in resp_omitted.text


@pytest.mark.asyncio
async def test_trigger_invoice_generation_direct_handler_guard():
    """Direct invocation of trigger_invoice_generation route function raises HTTPException(400)."""
    from app.api.v1.invoices import trigger_invoice_generation

    class MockUnvalidatedPayload:
        def model_dump(self):
            return {
                "month": "August",
                "year": 2026,
                "mode": "regenerate",
                "confirm_delete": False,
            }

    with pytest.raises(HTTPException) as exc_info:
        await trigger_invoice_generation(payload=MockUnvalidatedPayload())
    assert exc_info.value.status_code == 400
    assert "Regeneration mode requires explicit confirmation (confirm_delete=True)" in exc_info.value.detail


@pytest.mark.asyncio
async def test_customer_scoping_whitespace_sanitization(setup_challenger_tenant):
    """Calling run_zoho_invoices_core with whitespace customer name defaults to All Customers."""
    tenant_slug = setup_challenger_tenant
    whitespace_samples = ["   ", "\t  \n  ", "  ", " \t "]

    for ws in whitespace_samples:
        # Reset staged transactions to APPROVED
        with Session(get_engine()) as session:
            for tx in session.exec(
                select(StagedTransaction).where(StagedTransaction.client_id == tenant_slug)
            ).all():
                tx.status = "APPROVED"
                tx.approved = True
                tx.accounting_ref_id = None
                session.add(tx)
            session.commit()

        res = await run_zoho_invoices_core(
            target_month="August",
            target_year=2026,
            filter_client_name=tenant_slug,
            target_customer_name=ws,
            mode="append",
        )
        assert res.get("status") == "COMPLETED"
        invoices_created = res.get("invoices_created", [])
        assert len(invoices_created) == 2, f"Expected 2 invoices for whitespace {repr(ws)}, got {len(invoices_created)}"
        billed_customers = {inv["customer_name"] for inv in invoices_created}
        assert "Customer Alpha" in billed_customers
        assert "Customer Beta" in billed_customers


@pytest.mark.asyncio
async def test_confirmed_regeneration_deletes_prior_draft_and_rebills(setup_challenger_tenant):
    """Confirmed regeneration deletes prior draft and includes both INVOICED and APPROVED rows."""
    tenant_slug = setup_challenger_tenant
    # Mark Alpha as INVOICED, Beta as APPROVED
    with Session(get_engine()) as session:
        alpha = session.exec(select(StagedTransaction).where(StagedTransaction.id == 7701)).first()
        beta = session.exec(select(StagedTransaction).where(StagedTransaction.id == 7702)).first()
        alpha.status = "INVOICED"
        alpha.accounting_ref_id = "INV-PRIOR-ALPHA"
        beta.status = "APPROVED"
        beta.accounting_ref_id = None
        session.add(alpha)
        session.add(beta)
        session.commit()

    # Pre-seed prior draft in mock cache
    ZohoBooksService._global_mock_draft_invoices["cnt_alpha_01_august_2026"] = {
        "invoice_id": "inv_alpha_prior_id",
        "invoice_number": "INV-PRIOR-ALPHA",
        "customer_id": "cnt_alpha_01",
        "customer_name": "Customer Alpha",
        "total": 200.0,
        "status": "draft",
    }

    res = await run_zoho_invoices_core(
        target_month="August",
        target_year=2026,
        filter_client_name=tenant_slug,
        target_customer_name="Customer Alpha",
        mode="regenerate",
        confirm_delete=True,
    )
    assert res.get("status") == "COMPLETED"
    invoices_created = res.get("invoices_created", [])
    assert len(invoices_created) == 1
    new_inv = invoices_created[0]
    assert new_inv["customer_name"] == "Customer Alpha"
    assert new_inv["total"] == 200.0

    # Verify transaction 7701 updated with new invoice number
    with Session(get_engine()) as session:
        refreshed_alpha = session.exec(select(StagedTransaction).where(StagedTransaction.id == 7701)).first()
        assert refreshed_alpha.status == "INVOICED"
        assert refreshed_alpha.accounting_ref_id == new_inv["invoice_number"]
        assert refreshed_alpha.accounting_ref_id != "INV-PRIOR-ALPHA"
