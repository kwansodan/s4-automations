import os
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock
from httpx import AsyncClient, ASGITransport

# Ensure Inngest dev server URL is configured for test runner
os.environ.setdefault("INNGEST_DEV_SERVER_URL", "http://127.0.0.1:8288")
from app.config import settings
if not settings.INNGEST_DEV_SERVER_URL:
    settings.INNGEST_DEV_SERVER_URL = "http://127.0.0.1:8288"

from app.main import app
from app.workflows.daily_billing_pipeline import execute_daily_billing_pipeline
from app.workflows.zoho_invoice_generator import execute_generate_zoho_invoices
from app.models.db_models import StagedTransaction
from app.db.session import get_engine
from sqlmodel import Session, select
from app.services.zoho_service import ZohoBooksService
from app.models.schemas import ZohoDraftInvoiceRequest, ZohoInvoiceLineItem
from app.utils.progress_tracker import pipeline_tracker


class MockContext:
    def __init__(self, data=None):
        self.event = MagicMock()
        self.event.data = data or {}


class MockStep:
    async def run(self, step_id, fn):
        if callable(fn):
            import inspect
            if inspect.iscoroutinefunction(fn):
                return await fn()
            return fn()
        return fn


def create_staged_transaction(
    customer_name: str = "Luxwood",
    status: str = "APPROVED",
    approved: bool = True,
    month: str = "August",
    year: int = 2026,
    item_name: str = "Bed Sheet (Double / King)",
    rate: float = 18.50,
    qty: float = 20.0,
) -> StagedTransaction:
    unique_suffix = uuid.uuid4().hex[:6]
    st = StagedTransaction(
        client_id="anr_group",
        batch_id=f"batch_test_{unique_suffix}",
        pipeline_type="AR",
        entity_type="ar_sales_invoice",
        transaction_date=f"{year}-08-15T12:00:00Z",
        source_file_name=f"slip_{customer_name}_{unique_suffix}.jpg",
        item_or_description=item_name,
        quantity_or_debit=qty,
        rate_or_price=rate,
        total_amount=qty * rate,
        approved=approved,
        status=status,
        metadata_json={
            "customer_name": customer_name,
            "zoho_contact_id": "cnt_luxwood_001" if customer_name == "Luxwood" else "cnt_the_lennox_003",
            "zoho_item_id": "item_bed_sheet_dbl",
        },
    )
    with Session(get_engine()) as session:
        session.add(st)
        session.commit()
        session.refresh(st)
    return st


@pytest.mark.asyncio
async def test_daily_billing_pipeline_workflow(monkeypatch):
    from app.models.schemas import ClientFolderInfo, OCRSlipExtraction, OCRSlipItem, ConfidenceLevel

    mock_drive = MagicMock()
    mock_drive.get_month_folder.return_value = "mock_fld_august_2026"
    mock_drive.list_client_folders.return_value = [
        ClientFolderInfo(client_name="Luxwood", client_slug="anr_group", folder_id="fld_1", processed_folder_id="fld_1_proc"),
        ClientFolderInfo(client_name="The Bantree", client_slug="anr_group", folder_id="fld_2", processed_folder_id="fld_2_proc"),
        ClientFolderInfo(client_name="The Lennox", client_slug="anr_group", folder_id="fld_3", processed_folder_id="fld_3_proc"),
        ClientFolderInfo(client_name="Kwarleyz", client_slug="anr_group", folder_id="fld_4", processed_folder_id="fld_4_proc"),
        ClientFolderInfo(client_name="Number One", client_slug="anr_group", folder_id="fld_5", processed_folder_id="fld_5_proc"),
    ]
    mock_drive.find_or_create_folder.return_value = "mock_proc_fld"
    mock_drive.list_unprocessed_slips.return_value = [
        {"id": "file_1", "name": "slip_1.jpg", "webViewLink": "https://drive.google.com/1"}
    ]
    mock_drive.download_file_bytes.return_value = (b"fake_bytes", "image/jpeg")
    mock_drive.archive_file.return_value = True

    mock_ocr = MagicMock()
    mock_ocr.extract_slip_data = AsyncMock(
        return_value=OCRSlipExtraction(
            file_name="slip_1.jpg",
            client_name="Luxwood",
            slip_date="15/08/2026",
            items=[
                OCRSlipItem(
                    raw_item_name="B/Sheet Dbl",
                    standard_item_name="Bed Sheet (Double / King)",
                    zoho_item_id="item_bed_sheet_dbl",
                    unit_rate=18.50,
                    pickup_qty=30,
                    delivery_qty=28,
                    unreturned_loss_qty=2,
                    confidence_score=ConfidenceLevel.HIGH,
                )
            ],
            overall_confidence=ConfidenceLevel.HIGH,
        )
    )

    monkeypatch.setattr("app.workflows.daily_billing_pipeline.GoogleDriveService", lambda: mock_drive)
    monkeypatch.setattr("app.workflows.daily_billing_pipeline.GeminiOCRService", lambda: mock_ocr)

    ctx = MockContext({"month": "August", "year": 2026})
    step = MockStep()

    result = await execute_daily_billing_pipeline(ctx, step)
    assert result["status"] == "COMPLETED"
    assert result["month_name"] == "August"
    assert result["year"] == 2026
    assert result["total_clients_discovered"] >= 5
    assert result["total_slips_processed"] > 0
    assert len(result["clients_processed"]) >= 5


@pytest.mark.asyncio
async def test_zoho_invoice_generator_workflow():
    create_staged_transaction("Luxwood", status="APPROVED", approved=True, qty=25.0)

    ctx = MockContext({"month": "August", "year": 2026})
    step = MockStep()

    result = await execute_generate_zoho_invoices(ctx, step)
    assert result["status"] == "COMPLETED"
    assert result["invoices_count"] > 0
    assert len(result["invoices_created"]) > 0
    assert result["invoices_created"][0]["status"] == "draft"


@pytest.mark.asyncio
async def test_zoho_invoice_generator_append_mode():
    st = create_staged_transaction("Luxwood", status="APPROVED", approved=True, qty=15.0)

    ctx = MockContext({
        "month": "August",
        "year": 2026,
        "mode": "append",
        "target_customer_name": "Luxwood",
    })
    step = MockStep()

    result = await execute_generate_zoho_invoices(ctx, step)
    assert result["status"] == "COMPLETED"
    assert result["mode"] == "append"
    assert result["invoices_count"] == 1
    created = result["invoices_created"][0]
    assert created["customer_name"] == "Luxwood"

    # Verify transaction in database transitioned to INVOICED
    with Session(get_engine()) as session:
        refreshed = session.exec(select(StagedTransaction).where(StagedTransaction.id == st.id)).first()
        assert refreshed.status == "INVOICED"
        assert refreshed.accounting_ref_id is not None


@pytest.mark.asyncio
async def test_zoho_invoice_generator_regenerate_mode_with_confirm_delete():
    # Pre-create draft invoice in mock Zoho Books
    zoho = ZohoBooksService()
    req = ZohoDraftInvoiceRequest(
        customer_id="cnt_luxwood_001",
        date="2026-08-31",
        line_items=[
            ZohoInvoiceLineItem(
                item_id="item_bed_sheet_dbl",
                name="Bed Sheet (Double / King)",
                rate=18.50,
                quantity=10,
            )
        ],
    )
    old_inv = await zoho.create_or_append_draft_invoice(req, "August", 2026)
    old_inv_id = old_inv.invoice_id

    # Verify old invoice exists in mock storage
    existing = await zoho.find_existing_draft_invoice("cnt_luxwood_001", "August", 2026)
    assert existing is not None
    assert existing["invoice_id"] == old_inv_id

    # Seed transaction with status INVOICED (simulating re-querying previous invoiced slips)
    st = create_staged_transaction("Luxwood", status="INVOICED", approved=True, qty=30.0)

    ctx = MockContext({
        "month": "August",
        "year": 2026,
        "mode": "regenerate",
        "confirm_delete": True,
        "target_customer_name": "Luxwood",
    })
    step = MockStep()

    result = await execute_generate_zoho_invoices(ctx, step)
    assert result["status"] == "COMPLETED"
    assert result["mode"] == "regenerate"
    assert result["invoices_count"] == 1
    new_inv = result["invoices_created"][0]
    # New invoice created successfully
    assert new_inv["customer_name"] == "Luxwood"

    # Verify old invoice was deleted from mock storage
    assert old_inv_id not in ZohoBooksService._global_mock_draft_invoices


@pytest.mark.asyncio
async def test_zoho_invoice_generator_customer_scoping():
    # Seed transactions for both Luxwood and The Lennox
    create_staged_transaction("Luxwood", status="APPROVED", approved=True, qty=10.0)
    create_staged_transaction("The Lennox", status="APPROVED", approved=True, qty=20.0)

    ctx = MockContext({
        "month": "August",
        "year": 2026,
        "target_customer_name": "The Lennox",
    })
    step = MockStep()

    result = await execute_generate_zoho_invoices(ctx, step)
    assert result["status"] == "COMPLETED"
    # Should only generate invoice for The Lennox
    assert result["invoices_count"] == 1
    assert result["invoices_created"][0]["customer_name"] == "The Lennox"


@pytest.mark.asyncio
async def test_zoho_invoice_generator_custom_dates_and_terms():
    create_staged_transaction("Luxwood", status="APPROVED", approved=True, qty=10.0)

    custom_inv_date = "2026-08-25"
    custom_due_date = "2026-09-08"
    custom_terms = "Net 14 days strict payment"

    ctx = MockContext({
        "month": "August",
        "year": 2026,
        "target_customer_name": "Luxwood",
        "invoice_date": custom_inv_date,
        "due_date": custom_due_date,
        "terms": custom_terms,
    })
    step = MockStep()

    result = await execute_generate_zoho_invoices(ctx, step)
    assert result["status"] == "COMPLETED"
    inv = result["invoices_created"][0]
    assert inv["date"] == custom_inv_date
    assert inv["due_date"] == custom_due_date


@pytest.mark.asyncio
async def test_zoho_invoice_generator_telemetry_streaming():
    create_staged_transaction("Luxwood", status="APPROVED", approved=True, qty=12.0)

    ctx = MockContext({
        "month": "August",
        "year": 2026,
        "target_customer_name": "Luxwood",
    })
    step = MockStep()

    result = await execute_generate_zoho_invoices(ctx, step)
    assert result["status"] == "COMPLETED"
    # Verify pipeline_tracker updated customer counters
    assert "customers_total" in pipeline_tracker.stats
    assert "customers_done" in pipeline_tracker.stats
    assert pipeline_tracker.stats["customers_total"] >= 1
    assert pipeline_tracker.stats["customers_done"] >= 1


@pytest.mark.asyncio
async def test_check_existing_draft_invoices_api():
    # Pre-create a mock draft invoice
    zoho = ZohoBooksService()
    req = ZohoDraftInvoiceRequest(
        customer_id="cnt_luxwood_001",
        date="2026-08-31",
        line_items=[
            ZohoInvoiceLineItem(
                item_id="item_bed_sheet_dbl",
                name="Bed Sheet (Double / King)",
                rate=18.50,
                quantity=10,
            )
        ],
    )
    await zoho.create_or_append_draft_invoice(req, "August", 2026)

    from app.services.auth_service import AuthService
    token = AuthService._create_token(settings.AUTH_EMAIL, role="admin")
    headers = {"Authorization": f"Bearer {token}"}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get(
            "/api/v1/invoices/existing",
            params={
                "client_id": "anr_group",
                "month": "August",
                "year": 2026,
                "customer_name": "Luxwood",
            },
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_existing"] is True
        assert len(data["existing_invoices"]) > 0
        assert any("Luxwood" in inv["customer_name"] for inv in data["existing_invoices"])
