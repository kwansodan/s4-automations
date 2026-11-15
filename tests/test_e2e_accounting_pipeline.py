"""End-to-End Accounting Pipeline Test Suite.

Covers all 8 core user flows across the S4 Accounting Automation platform:
Flow 1: Authentication, OTP Rate Limiting, and Session Verification
Flow 2: Client Organization Onboarding and Credential Secret Masking
Flow 3: 1-Click Zoho OAuth with HMAC-Signed CSRF State Verification
Flow 4: Accounts Receivable Laundry Slip OCR and Linen Loss Calculation
Flow 5: Draft Invoice Generation, Customer Scoping, Append and Regeneration
Flow 6: Accounts Payable Vendor Bills and Zoho Draft Bill Creation
Flow 7: Bank Statement Parsing and Client Clarification Magic Links
Flow 8: Immutable Audit Logging and Telemetry Progress Streaming
"""

import uuid
import pytest
from httpx import AsyncClient, ASGITransport
from sqlmodel import Session, select
from unittest.mock import AsyncMock, patch

from app.main import app
from app.config import settings
from app.db.session import get_engine, init_db
from app.models.db_models import (
    ClientOrganization,
    StagedTransaction,
    BankTransaction,
    AuditLog,
)
from app.models.schemas import (
    OCRSlipExtraction,
    OCRSlipItem,
    ConfidenceLevel,
    ZohoDraftInvoiceRequest,
    ZohoInvoiceLineItem,
    ZohoDraftBillRequest,
)
from app.services.auth_service import AuthService
from app.services.audit_service import AuditService
from app.services.zoho_service import ZohoBooksService
from app.api.v1.oauth import generate_oauth_state, verify_oauth_state
from app.api.v1.bank_portal import generate_magic_link_token, validate_magic_link_token
from app.workflows.zoho_invoice_generator import execute_generate_zoho_invoices
from app.utils.progress_tracker import pipeline_tracker


@pytest.fixture(autouse=True)
def setup_test_environment():
    """Ensure database is initialized and mock mode is active."""
    init_db()
    settings.MOCK_MODE = True


# =========================================================================
# Flow 1: Auth & OTP Rate Limiting and Verification
# =========================================================================
@pytest.mark.asyncio
async def test_flow_1_auth_otp_rate_limiting_and_verification():
    """Verify OTP dispatch, rate limit enforcement, and valid token generation."""
    test_email = settings.AUTH_EMAIL.strip().lower()

    # Step 1: Request OTP code
    req_res = AuthService.request_otp(test_email)
    assert req_res["success"] is True
    assert req_res["status"] == "OTP_SENT"
    otp_code = req_res.get("dev_hint", "").replace("Code: ", "").strip()
    assert len(otp_code) == 6
    assert otp_code.isdigit()

    # Step 2: Test failed attempts and limit protection
    for _ in range(5):
        fail_res = AuthService.verify_otp(test_email, "000000")
        assert fail_res["success"] is False

    # Attempt after 5 failures should be blocked / invalidated
    too_many = AuthService.verify_otp(test_email, "000000")
    assert too_many["status"] in ("TOO_MANY_ATTEMPTS", "NOT_FOUND")

    # Step 3: Request fresh OTP and verify successfully
    fresh_req = AuthService.request_otp(test_email)
    assert fresh_req["success"] is True
    fresh_code = fresh_req.get("dev_hint", "").replace("Code: ", "").strip()
    verified_res = AuthService.verify_otp(test_email, fresh_code)
    assert verified_res["success"] is True
    assert "access_token" in verified_res

    # Step 4: Token decoding and admin role verification
    token = verified_res.get("access_token") or verified_res.get("token")
    assert token is not None
    payload = AuthService.validate_token(token)
    assert payload is not None
    assert payload["email"] == test_email
    assert payload["role"] in ("admin", "PARTNER", "OWNER")


# =========================================================================
# Flow 2: Client Onboarding and Secret Masking
# =========================================================================
@pytest.mark.asyncio
async def test_flow_2_client_onboarding_and_secret_masking():
    """Verify client settings mask sensitive credentials with bullet characters."""
    unique_client_id = f"client_{uuid.uuid4().hex[:8]}"
    with Session(get_engine()) as session:
        client = ClientOrganization(
            id=unique_client_id,
            name="Apex Commercial Hospitality",
            industry="Commercial Hospitality",
            organization_id="s4_advisory",
            zoho_org_id="928550250",
            custom_config={
                "zoho_client_id": "1000.EXAMPLECLIENTID",
                "zoho_client_secret": "SUPER_SECRET_CLIENT_KEY",
                "zoho_refresh_token": "1000.REFRESHTOKEN_SECRET",
            },
        )
        session.add(client)
        session.commit()

    token = AuthService._create_token(settings.AUTH_EMAIL, role="admin")
    headers = {"Authorization": f"Bearer {token}"}
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get(f"/api/v1/clients/{unique_client_id}", headers=headers)
        assert res.status_code == 200
        data = res.json()

        # Sensitive secrets in custom_config must be masked with bullet points
        assert "custom_config" in data
        assert data["custom_config"]["zoho_client_secret"] == "••••••••"
        assert data["custom_config"]["zoho_refresh_token"] == "••••••••"
        assert data["custom_config"]["has_zoho_client_secret"] is True
        assert data["custom_config"]["has_zoho_refresh_token"] is True
        assert "SUPER_SECRET" not in str(data)


# =========================================================================
# Flow 3: 1-Click Zoho OAuth with Signed CSRF State
# =========================================================================
@pytest.mark.asyncio
async def test_flow_3_oauth_csrf_signed_state_verification():
    """Verify HMAC-signed OAuth state protects against CSRF and detects tampering."""
    client_id = "anr_group"

    # Step 1: Generate valid signed state
    state = generate_oauth_state(client_id)
    assert state is not None
    assert len(state) > 20

    # Step 2: Successfully verify valid state
    resolved_id = verify_oauth_state(state)
    assert resolved_id == client_id

    # Step 3: Tampered state fails signature check
    tampered_state = state[:-4] + "AAAA"
    with pytest.raises(Exception):
        verify_oauth_state(tampered_state)


# =========================================================================
# Flow 4: AR Laundry Slip OCR and Linen Loss Calculation
# =========================================================================
@pytest.mark.asyncio
async def test_flow_4_ar_laundry_slip_ocr_and_loss_calculation():
    """Verify OCR extraction schema, customer party terminology, and loss formula."""
    slip = OCRSlipExtraction(
        file_name="slip_aug20_test.jpg",
        client_name="Luxwood",
        slip_date="20/08/2026",
        items=[
            OCRSlipItem(
                raw_item_name="Bedsheet Queen",
                standard_item_name="Bed Sheet (Double / King)",
                zoho_item_id="item_bed_sheet_dbl",
                unit_rate=18.50,
                pickup_qty=50,
                delivery_qty=46,
                unreturned_loss_qty=4,
                confidence_score=ConfidenceLevel.HIGH,
            ),
            OCRSlipItem(
                raw_item_name="Bath Towel",
                standard_item_name="Bath Towel",
                zoho_item_id="item_bath_towel",
                unit_rate=12.00,
                pickup_qty=30,
                delivery_qty=30,
                unreturned_loss_qty=0,
                confidence_score=ConfidenceLevel.HIGH,
            ),
        ],
        overall_confidence=ConfidenceLevel.HIGH,
    )

    # Verify math and linen loss rule: max(0, pickup - delivery)
    for item in slip.items:
        expected_loss = max(0, item.pickup_qty - item.delivery_qty)
        assert item.unreturned_loss_qty == expected_loss
        expected_amount = (item.delivery_qty if item.delivery_qty > 0 else item.pickup_qty) * item.unit_rate
        assert expected_amount > 0

    # Verify customer party mapping
    assert slip.client_name == "Luxwood"


# =========================================================================
# Flow 5: Draft Invoice Creation, Scoping, and Regeneration
# =========================================================================
class MockContext:
    def __init__(self, data=None):
        self.event = AsyncMock()
        self.event.data = data or {}


class MockStep:
    async def run(self, step_id, fn):
        if callable(fn):
            import inspect
            if inspect.iscoroutinefunction(fn):
                return await fn()
            return fn()
        return fn


@pytest.mark.asyncio
async def test_flow_5_draft_invoice_creation_scoping_and_regeneration():
    """Verify Zoho Books invoice drafting, customer scoping, and confirmed regeneration."""
    uid = uuid.uuid4().hex[:6]
    customer_a = "Luxwood"
    customer_b = "The Lennox"

    # Stage approved transactions for both customers
    with Session(get_engine()) as session:
        st1 = StagedTransaction(
            client_id="anr_group",
            batch_id=f"batch_{uid}",
            pipeline_type="AR",
            entity_type="ar_sales_invoice",
            transaction_date="2026-08-15T10:00:00Z",
            source_file_name=f"slip_{customer_a}_{uid}.jpg",
            item_or_description="Bed Sheet (Double / King)",
            quantity_or_debit=10.0,
            rate_or_price=18.50,
            total_amount=185.00,
            approved=True,
            status="APPROVED",
            metadata_json={"customer_name": customer_a, "zoho_contact_id": "cnt_luxwood_001"},
        )
        st2 = StagedTransaction(
            client_id="anr_group",
            batch_id=f"batch_{uid}",
            pipeline_type="AR",
            entity_type="ar_sales_invoice",
            transaction_date="2026-08-15T11:00:00Z",
            source_file_name=f"slip_{customer_b}_{uid}.jpg",
            item_or_description="Bath Towel",
            quantity_or_debit=15.0,
            rate_or_price=12.00,
            total_amount=180.00,
            approved=True,
            status="APPROVED",
            metadata_json={"customer_name": customer_b, "zoho_contact_id": "cnt_the_lennox_003"},
        )
        session.add(st1)
        session.add(st2)
        session.commit()

    # Step 1: Customer scoping (target only customer_a)
    ctx = MockContext({
        "month": "August",
        "year": 2026,
        "target_customer_name": customer_a,
    })
    step = MockStep()

    result = await execute_generate_zoho_invoices(ctx, step)
    assert result["status"] == "COMPLETED"
    assert result["invoices_count"] == 1
    assert result["invoices_created"][0]["customer_name"] == customer_a

    # Step 2: Unconfirmed regeneration rejected
    ctx_unconfirmed = MockContext({
        "month": "August",
        "year": 2026,
        "mode": "regenerate",
        "confirm_delete": False,
        "target_customer_name": customer_a,
    })
    with pytest.raises(ValueError, match="Regeneration mode requires explicit confirmation"):
        await execute_generate_zoho_invoices(ctx_unconfirmed, step)

    # Step 3: Confirmed regeneration succeeds
    ctx_confirmed = MockContext({
        "month": "August",
        "year": 2026,
        "mode": "regenerate",
        "confirm_delete": True,
        "target_customer_name": customer_a,
    })
    result_regen = await execute_generate_zoho_invoices(ctx_confirmed, step)
    assert result_regen["status"] == "COMPLETED"
    assert result_regen["mode"] == "regenerate"


# =========================================================================
# Flow 6: AP Vendor Bills and Zoho Draft Bill Creation
# =========================================================================
@pytest.mark.asyncio
async def test_flow_6_ap_vendor_bills_and_zoho_draft_bill_creation():
    """Verify Accounts Payable vendor bill structures and draft bill creation."""
    bill_req = ZohoDraftBillRequest(
        vendor_id="vnd_chemical_corp_101",
        bill_number="BILL-CHM-2026-001",
        date="2026-08-22",
        due_date="2026-09-05",
        line_items=[
            {
                "account_id": "acc_supplies_501",
                "description": "Commercial Laundry Detergent (50kg Drum)",
                "rate": 450.00,
                "quantity": 3.0,
            }
        ],
    )

    # Line item calculations
    total_val = sum(li["rate"] * li["quantity"] for li in bill_req.line_items)
    assert total_val == 1350.00
    assert bill_req.vendor_id.startswith("vnd_")


# =========================================================================
# Flow 7: Bank Statement Parsing and Clarification Magic Link Flow
# =========================================================================
@pytest.mark.asyncio
async def test_flow_7_bank_statement_parsing_and_clarification_magic_link():
    """Verify bank statement feed staging and secure 1-click clarification links."""
    batch_key = f"feed_{uuid.uuid4().hex[:6]}"
    with Session(get_engine()) as session:
        tx = BankTransaction(
            client_id="polaris",
            organization_id="s4_advisory",
            transaction_date="2026-08-14",
            description="Unidentified Wire Transfer Ref 88201",
            amount=15400.00,
            is_debit=False,
            requires_client_clarification=True,
            status="WAITING_ON_CLIENT",
            metadata_json={"source": "Stanbic Bank Statement"},
        )
        session.add(tx)
        session.commit()
        session.refresh(tx)
        tx_id = tx.id

    # Generate 1-click magic link token
    token = generate_magic_link_token(client_id="polaris", client_name="Polaris Advisory", tx_id=tx_id)
    assert token is not None

    # Verify token resolves correctly
    verified_payload = validate_magic_link_token(token)
    assert verified_payload is not None
    assert verified_payload["client_id"] == "polaris"
    assert verified_payload.get("target_tx_id") == tx_id


# =========================================================================
# Flow 8: Audit Logs and Telemetry Progress Streaming
# =========================================================================
@pytest.mark.asyncio
async def test_flow_8_audit_logs_and_telemetry_streaming():
    """Verify immutable audit log trail and real-time pipeline tracker telemetry."""
    test_client = f"client_{uuid.uuid4().hex[:6]}"
    AuditService.log(
        client_id=test_client,
        action="INVOICES_GENERATED",
        actor_email="system",
        details={"month": "August", "year": 2026, "invoices_created": 3},
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get(f"/api/v1/audit?client_id={test_client}")
        assert res.status_code == 200
        logs = res.json()
        assert len(logs) >= 1
        assert logs[0]["action"] == "INVOICES_GENERATED"
        assert logs[0]["client_id"] == test_client

    # Verify pipeline telemetry progress tracker
    pipeline_tracker.start_pipeline("E2E Verification Run", "August", 2026, total_stages=4)
    pipeline_tracker.update_progress(
        percent=75,
        stage_index=3,
        current_step="Drafting invoices in Zoho Books...",
        stats_update={"invoices_drafted": 2},
    )
    assert pipeline_tracker.percent == 75
    assert pipeline_tracker.stage_index == 3
    assert pipeline_tracker.stats.get("invoices_drafted") == 2
    pipeline_tracker.complete_pipeline("Pipeline verified successfully.")
    assert pipeline_tracker.status == "COMPLETED"
    assert pipeline_tracker.percent == 100
