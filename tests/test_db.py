"""Tests for Database Models, Sessions, Auth OTP, and Audit Logging."""

import pytest
from sqlmodel import Session, select
from app.db.session import engine, init_db
from app.models.db_models import ClientOrganization, AuthOtpRecord, AuditLog
from app.services.auth_service import AuthService
from app.services.audit_service import AuditService
from app.config import settings


@pytest.fixture(autouse=True)
def setup_database():
    """Ensures database is initialized before each test."""
    init_db()


def test_database_initialization_and_client_seeding():
    """Verify that init_db creates tables and seeds default clients."""
    with Session(engine) as session:
        clients = session.exec(select(ClientOrganization)).all()
        client_ids = [c.id for c in clients]

        assert len(clients) >= 3
        assert "anr_group" in client_ids
        assert "polaris" in client_ids
        assert "mr_osei" in client_ids


def test_auth_service_db_backed_otp_lifecycle():
    """Verify OTP generation and verification persists in database."""
    email = settings.AUTH_EMAIL

    # 1. Request OTP
    req = AuthService.request_otp(email)
    assert req["success"] is True
    assert req["status"] == "OTP_SENT"

    # Verify record in DB
    with Session(engine) as session:
        record = session.exec(select(AuthOtpRecord).where(AuthOtpRecord.email == email)).first()
        assert record is not None
        assert record.is_verified is False
        assert record.otp_hash is not None

    # 2. Test Invalid OTP
    invalid_verify = AuthService.verify_otp(email, "000000")
    assert invalid_verify["success"] is False
    assert invalid_verify["status"] == "INVALID_OTP"

    # 3. Test Valid OTP
    # For testing, calculate correct OTP or retrieve dev hint
    dev_hint = req.get("dev_hint")
    if dev_hint and "Code logged to server: " in dev_hint:
        otp_code = dev_hint.split("Code logged to server: ")[1].strip()
        valid_verify = AuthService.verify_otp(email, otp_code)
        assert valid_verify["success"] is True
        assert valid_verify["status"] == "AUTHENTICATED"
        assert "access_token" in valid_verify


def test_audit_service_logging_and_query():
    """Verify audit log entries are saved to DB and queryable."""
    AuditService.log(
        client_id="polaris",
        action="TEST_ACTION_EXECUTE",
        actor_email="admin@service4gh.com",
        details={"test_key": "test_val"},
    )

    logs = AuditService.get_logs(client_id="polaris", action="TEST_ACTION_EXECUTE")
    assert len(logs) >= 1
    assert logs[0].client_id == "polaris"
    assert logs[0].action == "TEST_ACTION_EXECUTE"
    assert logs[0].details.get("test_key") == "test_val"
