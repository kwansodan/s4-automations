"""Unit tests for production runtime fixes (OCRSlipItem null coercion, ZohoContact currency_code, EmailSourceService params)."""

import json
import pytest
from app.models.schemas import OCRSlipItem, OCRSlipExtraction, ZohoContact
from app.services.email_source_service import EmailSourceService


def test_ocr_slip_item_null_coercion():
    """Verify that null unit_rate or quantities from Gemini Vision are cleanly coerced to 0.0/0."""
    item_dict = {
        "raw_item_name": "B/Sheet Dbl",
        "standard_item_name": "Bed Sheet Double",
        "unit_rate": None,
        "pickup_qty": None,
        "delivery_qty": None,
        "unreturned_loss_qty": None,
    }
    item = OCRSlipItem.model_validate(item_dict)
    assert item.unit_rate == 0.0
    assert item.pickup_qty == 0
    assert item.delivery_qty == 0
    assert item.unreturned_loss_qty == 0


def test_ocr_slip_extraction_from_json_with_nulls():
    """Verify full extraction parsing when LLM outputs null values in JSON."""
    raw_json = """
    {
        "file_name": "Active 8 Spintex 20-10-2026.jpg",
        "client_name": "Active 8",
        "raw_customer_name": "Active 8 Spintex",
        "reconciled_customer_name": "Active 8 - Spintex",
        "slip_date": "20/10/2026",
        "items": [
            {
                "raw_item_name": "Bath Towel",
                "standard_item_name": "Bath Towel Plush",
                "unit_rate": null,
                "pickup_qty": 15,
                "delivery_qty": null,
                "unreturned_loss_qty": null
            }
        ]
    }
    """
    extraction = OCRSlipExtraction.model_validate_json(raw_json)
    assert len(extraction.items) == 1
    assert extraction.items[0].unit_rate == 0.0
    assert extraction.items[0].pickup_qty == 15
    assert extraction.items[0].delivery_qty == 0


def test_zoho_contact_currency_code_attribute():
    """Verify ZohoContact has currency_code attribute and defaults to GHS."""
    contact = ZohoContact(
        contact_id="cnt_999",
        contact_name="Test Hotel",
        company_name="Test Hotel Ltd",
    )
    assert hasattr(contact, "currency_code")
    assert contact.currency_code == "GHS"


def test_email_source_service_keyword_args():
    """Verify EmailSourceService handles imap_server, imap_user, imap_password, and folder kwargs."""
    svc = EmailSourceService(
        imap_server="imap.example.com",
        imap_user="user@example.com",
        imap_password="password123",
        folder="INBOX.Billing",
    )
    assert svc.host == "imap.example.com"
    assert svc.username == "user@example.com"
    assert svc.password == "password123"
    assert svc.default_folder == "INBOX.Billing"
    assert hasattr(svc, "fetch_unread_attachments")


def test_safe_parse_extraction_conversational_text():
    """Verify _safe_parse_extraction parses JSON surrounded by conversational text without UnboundLocalError."""
    from app.services.ocr_service import GeminiOCRService
    ocr = GeminiOCRService(api_key="fake-key-for-test", model_name="gemini-2.5-flash")
    text_with_chatter = """
    Here is the structured extraction for the slip:
    ```json
    {
        "file_name": "Active 8 Spintex 20-10-2026.jpg",
        "client_name": "Active 8",
        "raw_customer_name": "Active 8 Spintex",
        "reconciled_customer_name": "Active 8 - Spintex",
        "slip_date": "20/10/2026",
        "items": [
            {
                "raw_item_name": "Bath Sheet",
                "standard_item_name": "Bath Sheet Luxury",
                "unit_rate": null,
                "pickup_qty": 10,
                "delivery_qty": 10,
                "unreturned_loss_qty": 0
            }
        ]
    }
    ```
    Hope this helps!
    """
    res = ocr._safe_parse_extraction(text_with_chatter, "Active 8 Spintex 20-10-2026.jpg", "Active 8")
    assert res is not None
    assert res.file_name == "Active 8 Spintex 20-10-2026.jpg"
    assert len(res.items) == 1
    assert res.items[0].raw_item_name == "Bath Sheet"


def test_safe_parse_extraction_broken_text_graceful_fallback():
    """Verify _safe_parse_extraction handles completely unparseable text gracefully without crashing."""
    from app.services.ocr_service import GeminiOCRService
    ocr = GeminiOCRService(api_key="fake-key-for-test", model_name="gemini-2.5-flash")
    unparseable_text = "503 High Demand: Service Unavailable"
    res = ocr._safe_parse_extraction(unparseable_text, "Active 8 Spintex 22-10-2026.jpg", "Active 8")
    assert res is not None
    assert res.file_name == "Active 8 Spintex 22-10-2026.jpg"
    assert "Extraction formatting incomplete" in res.notes


def test_postgres_url_driver_rewriting():
    """Verify postgresql:// URLs get rewritten to postgresql+psycopg2://."""
    raw = "postgresql://postgres:postgres@postgres:5432/s4_automations"
    cleaned = raw.strip()
    if cleaned.startswith("postgresql://") and "+psycopg" not in cleaned:
        rewritten = cleaned.replace("postgresql://", "postgresql+psycopg2://", 1)
    assert rewritten == "postgresql+psycopg2://postgres:postgres@postgres:5432/s4_automations"


@pytest.mark.asyncio
async def test_ocr_raises_ai_model_unavailable_on_503(monkeypatch):
    """Verify that when the best model returns 503 high demand, AIModelUnavailableException is raised without candidate fallbacks."""
    from unittest.mock import MagicMock
    from app.services.ocr_service import GeminiOCRService, AIModelUnavailableException

    models_called = []

    class MockModels:
        def generate_content(self, model, contents, config=None):
            models_called.append(model)
            raise Exception("503 UNAVAILABLE: The model is experiencing high demand. Please try again later.")

    class MockGenaiClient:
        def __init__(self, api_key=None):
            self.models = MockModels()

    import google.genai as genai_module
    monkeypatch.setattr(genai_module, "Client", MockGenaiClient)

    async def mock_sleep(sec):
        pass
    monkeypatch.setattr("asyncio.sleep", mock_sleep)

    ocr = GeminiOCRService(api_key="test-key", model_name="gemini-3.6-flash")

    with pytest.raises(AIModelUnavailableException) as exc_info:
        await ocr.extract_slip_data(
            file_bytes=b"fake-bytes",
            mime_type="image/jpeg",
            file_name="slip_1.jpg",
            client_name="Test Client",
            item_catalog=[],
        )

    # Verify only the primary best model was attempted (3 retries on 503) and no inferior models were called
    assert models_called == ["gemini-3.6-flash"] * 3
    assert "currently unavailable" in str(exc_info.value)


@pytest.mark.asyncio
async def test_dynamic_blueprint_terminates_on_model_unavailable(monkeypatch):
    """Verify DynamicBlueprintStrategy halts immediately and updates pipeline_tracker on AIModelUnavailableException."""
    from unittest.mock import AsyncMock
    from app.strategies.dynamic_blueprint import DynamicBlueprintStrategy
    from app.services.ocr_service import AIModelUnavailableException
    from app.strategies.base import SourceDocument
    from app.utils.progress_tracker import pipeline_tracker

    from app.models.db_models import ClientOrganization

    client_org = ClientOrganization(
        id="test_client",
        name="Test Hotel",
        accounting_software="zoho_books",
        pipelines=[{"id": "p1", "pipeline_name": "Test P", "direction": "inflow", "entity_type": "ar_sales_invoice"}],
    )
    strategy = DynamicBlueprintStrategy(client=client_org)

    # Mock OCR extraction to raise AIModelUnavailableException
    mock_ocr = AsyncMock()
    mock_ocr.extract_slip_data.side_effect = AIModelUnavailableException("503 Service Unavailable")
    mock_ocr.simulate_pipeline_transposition.side_effect = AIModelUnavailableException("503 Service Unavailable")
    mock_ocr.extract_vendor_bill.side_effect = AIModelUnavailableException("503 Service Unavailable")
    mock_ocr.model_name = "gemini-3.6-flash"
    monkeypatch.setattr("app.strategies.dynamic_blueprint.GeminiOCRService", lambda: mock_ocr)

    doc = SourceDocument(
        source_type="google_drive",
        source_identifier="drive_1",
        file_name="slip_august.jpg",
        file_bytes=b"image-content",
        mime_type="image/jpeg",
        metadata={"pipeline_id": "p1"},
    )

    with pytest.raises(AIModelUnavailableException):
        await strategy.extract_and_validate([doc])

    # Ensure pipeline tracker caught the error and marked state as ERROR
    tracker_state = pipeline_tracker.get_state()
    assert tracker_state["status"] == "ERROR"
    assert "AI Model Unavailable" in tracker_state["current_step"]


@pytest.mark.asyncio
async def test_daily_billing_pipeline_stages_and_recovers_processed(monkeypatch):
    """Verify daily_billing_pipeline commits transactions to DB and recovers unindexed slips from Processed folder."""
    from unittest.mock import AsyncMock, MagicMock
    from sqlmodel import Session, select, delete
    from app.db.session import get_engine
    from app.models.db_models import StagedTransaction, ClientOrganization
    from app.models.schemas import (
        ClientFolderInfo,
        OCRSlipExtraction,
        OCRSlipItem,
        ConfidenceLevel,
        ZohoContact,
    )
    from app.workflows.daily_billing_pipeline import run_daily_pipeline_core

    # Use a unique test client slug
    test_slug = "recovery_test_client"
    test_client_name = "Recovery Test Hotel"

    # Clean up any leftover test transactions
    with Session(get_engine()) as session:
        session.exec(
            delete(StagedTransaction).where(
                (StagedTransaction.client_id == test_slug)
                | (StagedTransaction.client_id == test_client_name)
            )
        )
        session.commit()

    # Mock GoogleDriveService
    mock_drive = MagicMock()
    mock_drive.get_month_folder.return_value = "month_folder_oct2026"
    mock_drive.list_client_folders.return_value = [
        ClientFolderInfo(
            folder_id="client_f_1",
            client_name=test_client_name,
            client_slug=test_slug,
        )
    ]
    mock_drive.find_or_create_folder.return_value = "processed_f_1"

    # 1 loose file and 1 unindexed recovery file in Processed folder
    loose_slip = {
        "id": "file_loose_101",
        "name": "Kempinski 05-10-2026.jpg",
        "webViewLink": "https://drive.google.com/loose101",
        "mimeType": "image/jpeg",
    }
    processed_unindexed_slip = {
        "id": "file_proc_202",
        "name": "Kempinski 06-10-2026.jpg",
        "webViewLink": "https://drive.google.com/proc202",
        "mimeType": "image/jpeg",
    }

    def mock_list_unprocessed_slips(folder_id):
        if folder_id == "client_f_1":
            return [loose_slip]
        elif folder_id == "processed_f_1":
            return [processed_unindexed_slip]
        return []

    mock_drive.list_unprocessed_slips.side_effect = mock_list_unprocessed_slips
    mock_drive.download_file_bytes.return_value = (b"fake_slip_bytes", "image/jpeg")

    archived_files = []

    def mock_archive(file_id, src_id, dst_id):
        archived_files.append((file_id, src_id, dst_id))
        return True

    mock_drive.archive_file.side_effect = mock_archive
    monkeypatch.setattr("app.workflows.daily_billing_pipeline.GoogleDriveService", lambda: mock_drive)

    # Mock ZohoBooksService
    mock_zoho = MagicMock()
    mock_zoho.fetch_active_contacts = AsyncMock(
        return_value=[
            ZohoContact(
                contact_id="zoho_kempinski_100",
                contact_name="Kempinski Hotel Gold Coast City Accra",
                company_name="Kempinski Hotel",
            )
        ]
    )
    mock_zoho.fetch_item_catalog = AsyncMock(
        return_value=[{"item_id": "i1", "name": "Bath Towel", "rate": 15.0}]
    )
    mock_zoho.find_contact_by_name.return_value = None
    monkeypatch.setattr("app.workflows.daily_billing_pipeline.ZohoBooksService", lambda org_id=None: mock_zoho)

    # Mock GeminiOCRService
    mock_ocr = MagicMock()

    async def mock_extract(file_bytes, mime_type, file_name, client_name, **kwargs):
        slip_dt = "05/10/2026" if "05" in file_name else "06/10/2026"
        return OCRSlipExtraction(
            file_name=file_name,
            client_name=client_name,
            raw_customer_name="Kempinski Hotel",
            reconciled_customer_name="Kempinski Hotel",
            slip_date=slip_dt,
            items=[
                OCRSlipItem(
                    raw_item_name="B Towel",
                    standard_item_name="Bath Towel",
                    pickup_qty=10,
                    delivery_qty=10,
                    unreturned_loss_qty=0,
                    unit_rate=15.0,
                    confidence_score=ConfidenceLevel.HIGH,
                )
            ],
        )

    mock_ocr.extract_slip_data = AsyncMock(side_effect=mock_extract)
    mock_ocr.aggregate_monthly_skus.return_value = []
    monkeypatch.setattr("app.workflows.daily_billing_pipeline.GeminiOCRService", lambda: mock_ocr)

    # Execute core pipeline for October 2026
    result = await run_daily_pipeline_core(
        target_month="October",
        target_year=2026,
        filter_clients=[test_slug],
    )

    assert result["status"] == "COMPLETED"
    assert result["total_slips_processed"] == 2

    # Verify archiving: loose file was moved, but processed file was NOT re-archived
    assert len(archived_files) == 1
    assert archived_files[0][0] == "file_loose_101"

    # Verify database persistence into staged_transactions
    with Session(get_engine()) as session:
        staged = session.exec(
            select(StagedTransaction).where(
                (StagedTransaction.client_id == test_slug)
                | (StagedTransaction.client_id == test_client_name)
            )
        ).all()

        assert len(staged) == 2
        staged_files = {s.source_file_name for s in staged}
        assert "Kempinski 05-10-2026.jpg" in staged_files
        assert "Kempinski 06-10-2026.jpg" in staged_files

        for s in staged:
            # CustomerMatcher matched Kempinski to Zoho Contact
            assert s.accounting_ref_id == "zoho_kempinski_100"
            assert s.validation_status == "VALID"
            assert s.metadata_json.get("customer_reconciled") is True
            assert s.total_amount == 150.0  # 10 * 15.0
            assert s.transaction_date in ("2026-10-05", "2026-10-06")

    # Run pipeline a second time to verify idempotency (zero duplicates)
    mock_drive.list_unprocessed_slips.side_effect = lambda f_id: (
        [] if f_id == "client_f_1" else [loose_slip, processed_unindexed_slip]
    )

    result_2 = await run_daily_pipeline_core(
        target_month="October",
        target_year=2026,
        filter_clients=[test_slug],
    )

    assert result_2["total_slips_processed"] == 0

    with Session(get_engine()) as session:
        staged_after = session.exec(
            select(StagedTransaction).where(
                (StagedTransaction.client_id == test_slug)
                | (StagedTransaction.client_id == test_client_name)
            )
        ).all()
        assert len(staged_after) == 2

    # Clean up test transactions
    with Session(get_engine()) as session:
        session.exec(
            delete(StagedTransaction).where(
                (StagedTransaction.client_id == test_slug)
                | (StagedTransaction.client_id == test_client_name)
            )
        )
        session.commit()


def test_matches_month_and_year_prevents_day_as_month_false_positives():
    """Verify matches_month_and_year never confuses day numbers with month numbers."""
    from app.api.v1.clients import matches_month_and_year

    # Day 10 of September (2026-09-10) must NEVER match October (month 10)
    assert matches_month_and_year(
        t_date_raw="2026-09-10",
        batch_id_raw="batch_anr_september_2026_xyz",
        source_filename_raw="Embassy Gardens 10-09-2026.jpg",
        month="October",
        year=2026,
    ) is False

    # Day 10 of September (2026-09-10) MUST match September (month 09)
    assert matches_month_and_year(
        t_date_raw="2026-09-10",
        batch_id_raw="batch_anr_september_2026_xyz",
        source_filename_raw="Embassy Gardens 10-09-2026.jpg",
        month="September",
        year=2026,
    ) is True

    # Day 10 of October (2026-10-10) MUST match October
    assert matches_month_and_year(
        t_date_raw="2026-10-10",
        batch_id_raw="batch_anr_october_2026_abc",
        source_filename_raw="Embassy Gardens 10-10-2026.jpg",
        month="October",
        year=2026,
    ) is True

    # Day 15 of August (2026-08-15) must match August and reject October
    assert matches_month_and_year(
        t_date_raw="2026-08-15",
        batch_id_raw="batch_august_2026",
        source_filename_raw="slip_001.jpg",
        month="August",
        year=2026,
    ) is True
    assert matches_month_and_year(
        t_date_raw="2026-08-15",
        batch_id_raw="batch_august_2026",
        source_filename_raw="slip_001.jpg",
        month="October",
        year=2026,
    ) is False


@pytest.mark.asyncio
async def test_list_client_transactions_strict_month_isolation_no_leakage():
    """Verify list_client_transactions returns an empty list for empty months without leaking previous months."""
    from sqlmodel import Session, select, delete
    from app.db.session import get_engine
    from app.models.db_models import StagedTransaction, ClientOrganization
    from app.api.v1.clients import list_client_transactions, get_client_transactions_summary

    test_cid = "strict_isolation_client"

    # Clean up any leftover test transactions
    with Session(get_engine()) as session:
        session.exec(delete(StagedTransaction).where(StagedTransaction.client_id == test_cid))
        # Ensure client exists
        existing_c = session.exec(select(ClientOrganization).where(ClientOrganization.id == test_cid)).first()
        if not existing_c:
            session.add(ClientOrganization(id=test_cid, name="Strict Isolation Hotel", industry="Hospitality"))
        # Seed 2 September transactions
        session.add(
            StagedTransaction(
                client_id=test_cid,
                batch_id="batch_september_2026_01",
                pipeline_id="pipe_ar",
                pipeline_type="AR",
                entity_type="ar_sales_invoice",
                transaction_date="2026-09-10",
                source_type="google_drive",
                source_file_name="Embassy Gardens 10-09-2026.jpg",
                item_or_description="Bath Towel",
                quantity_or_debit=10.0,
                rate_or_price=15.0,
                total_amount=150.0,
                status="INVOICED",
                approved=True,
                reviewed=True,
            )
        )
        session.commit()

    with Session(get_engine()) as session:
        # Query for October 2026 (which has 0 transactions)
        october_txs = await list_client_transactions(
            client_id=test_cid,
            status=None,
            month="October",
            year=2026,
            pipeline_type="AR",
            db=session,
        )
        # Must return empty list, NOT the September transaction!
        assert len(october_txs) == 0

        # Query for September 2026 (which has 1 transaction)
        september_txs = await list_client_transactions(
            client_id=test_cid,
            status=None,
            month="September",
            year=2026,
            pipeline_type="AR",
            db=session,
        )
        assert len(september_txs) == 1
        assert september_txs[0]["transaction_date"] == "2026-09-10"

        # Query summary for October 2026
        october_summary = await get_client_transactions_summary(
            client_id=test_cid,
            month="October",
            year=2026,
            pipeline_type="AR",
            customer_name=None,
            db=session,
        )
        assert len(october_summary.get("summary", [])) == 0
        assert october_summary.get("total_billed", 0) == 0

    # Clean up test transactions and client
    with Session(get_engine()) as session:
        session.exec(delete(StagedTransaction).where(StagedTransaction.client_id == test_cid))
        session.exec(delete(ClientOrganization).where(ClientOrganization.id == test_cid))
        session.commit()


@pytest.mark.asyncio
async def test_google_drive_processed_recovery_sweep(monkeypatch):
    """Verify discover_documents_multi_convention recovers unindexed slips from Processed folder."""
    from unittest.mock import MagicMock
    from app.services.google_drive_service import GoogleDriveService
    from sqlmodel import Session, delete
    from app.db.session import get_engine
    from app.models.db_models import StagedTransaction

    test_cid = "recovery_sweep_client"

    # Clean up DB
    with Session(get_engine()) as session:
        session.exec(delete(StagedTransaction).where(StagedTransaction.client_id == test_cid))
        session.commit()

    drive = GoogleDriveService()
    mock_service = MagicMock()
    drive.service = mock_service

    # Setup mock file list queries
    def mock_files_list(q="", **kwargs):
        mock_req = MagicMock()
        if "'root_folder' in parents" in q:
            # Root contains Month folder 'October 2026'
            mock_req.execute.return_value = {
                "files": [{"id": "month_fld_1", "name": "October 2026", "mimeType": "application/vnd.google-apps.folder"}]
            }
        elif "'month_fld_1' in parents" in q:
            # Month folder contains customer subfolder 'Active 8 Spintex'
            mock_req.execute.return_value = {
                "files": [{"id": "cust_fld_1", "name": "Active 8 Spintex", "mimeType": "application/vnd.google-apps.folder"}]
            }
        elif "'cust_fld_1' in parents" in q and "mimeType != 'application/vnd.google-apps.folder'" in q:
            # 0 loose files in customer folder
            mock_req.execute.return_value = {"files": []}
        elif "'cust_fld_1' in parents" in q and "(name = 'Processed' or name = 'processed')" in q:
            # Processed folder exists
            mock_req.execute.return_value = {
                "files": [{"id": "proc_fld_1", "name": "Processed", "mimeType": "application/vnd.google-apps.folder"}]
            }
        elif "'proc_fld_1' in parents" in q:
            # Processed folder contains 2 slips: 1 already indexed, 1 orphaned
            mock_req.execute.return_value = {
                "files": [
                    {"id": "file_indexed_1", "name": "Active 8 Spintex 10-10-2026.jpg", "mimeType": "image/jpeg", "webViewLink": "https://drive.google.com/1"},
                    {"id": "file_orphaned_2", "name": "Active 8 Spintex 11-10-2026.jpg", "mimeType": "image/jpeg", "webViewLink": "https://drive.google.com/2"},
                ]
            }
        else:
            mock_req.execute.return_value = {"files": []}
        return mock_req

    mock_service.files().list.side_effect = mock_files_list

    # Seed 1 indexed slip in database
    with Session(get_engine()) as session:
        session.add(
            StagedTransaction(
                client_id=test_cid,
                batch_id="b1",
                pipeline_id="p1",
                pipeline_type="AR",
                entity_type="ar_sales_invoice",
                transaction_date="2026-10-10",
                source_type="google_drive",
                source_file_name="Active 8 Spintex 10-10-2026.jpg",
                source_identifier="file_indexed_1",
                item_or_description="Bath Towel",
                quantity_or_debit=1.0,
                rate_or_price=10.0,
                total_amount=10.0,
            )
        )
        session.commit()

    docs = await drive.discover_documents_multi_convention(
        folder_id="root_folder",
        month="October",
        year=2026,
    )

    # Should discover only the orphaned slip from Processed folder!
    assert len(docs) == 1
    assert docs[0].file_name == "Active 8 Spintex 11-10-2026.jpg"
    assert docs[0].source_identifier == "file_orphaned_2"
    assert docs[0].metadata.get("is_recovery") is True
    assert docs[0].metadata.get("already_archived") is True

    # Clean up DB
    with Session(get_engine()) as session:
        session.exec(delete(StagedTransaction).where(StagedTransaction.client_id == test_cid))
        session.commit()


@pytest.mark.asyncio
async def test_gemini_ocr_transient_503_backoff_retry(monkeypatch):
    """Verify GeminiOCRService retries transient 503 errors and succeeds on subsequent attempt."""
    from unittest.mock import MagicMock
    from app.services.ocr_service import GeminiOCRService

    ocr = GeminiOCRService()
    ocr.api_key = "test_api_key"
    ocr.model_name = "gemini-3.6-flash"

    mock_genai_client = MagicMock()
    attempt_count = 0

    def mock_generate_content(*args, **kwargs):
        nonlocal attempt_count
        attempt_count += 1
        if attempt_count == 1:
            # Simulate Google GenAI 503 capacity limit on attempt 1
            raise Exception("503 UNAVAILABLE: This model is currently experiencing high demand. Spikes in demand are usually temporary.")
        # Attempt 2 succeeds
        mock_resp = MagicMock()
        mock_resp.text = json.dumps({
            "client_name": "Test Hotel",
            "date": "10/10/2026",
            "items": [
                {
                    "raw_item_name": "B/Towel",
                    "standard_item_name": "Bath Towel",
                    "pickup_qty": 5,
                    "delivery_qty": 5,
                    "unit_rate": 12.0,
                    "confidence_score": "HIGH",
                }
            ],
            "overall_confidence": "HIGH",
        })
        return mock_resp

    mock_genai_client.models.generate_content.side_effect = mock_generate_content
    monkeypatch.setattr("google.genai.Client", lambda api_key: mock_genai_client)

    # Fast sleep to avoid slowing down unit tests
    sleep_calls = []
    async def mock_sleep(sec):
        sleep_calls.append(sec)

    monkeypatch.setattr("asyncio.sleep", mock_sleep)

    result = await ocr.extract_slip_data(
        file_bytes=b"dummy_image_data",
        mime_type="image/jpeg",
        file_name="Active 8 Spintex 10-10-2026.jpg",
        client_name="Test Hotel",
        item_catalog=[],
    )

    assert attempt_count == 2
    assert len(sleep_calls) == 1
    assert sleep_calls[0] == 2  # Attempt 1 backed off for 2s
    assert result.client_name == "Test Hotel"
    assert len(result.items) == 1
    assert result.items[0].standard_item_name == "Bath Towel"





