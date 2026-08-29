"""Tests for Authentication & Email OTP Service."""

import pytest
from app.services.auth_service import AuthService
from app.config import settings


def test_otp_request_authorized_email():
    res = AuthService.request_otp("s4bookkeeping@service4gh.com")
    assert res["success"] is True
    assert res["status"] == "OTP_SENT"
    assert "email" in res
    assert res["email"] == "s4bookkeeping@service4gh.com"


def test_otp_request_unauthorized_email():
    res = AuthService.request_otp("hacker@unknown.com")
    assert res["success"] is False
    assert res["status"] == "UNAUTHORIZED"


def test_otp_verify_success_and_token():
    # 1. Request OTP
    req = AuthService.request_otp("s4bookkeeping@service4gh.com")
    assert req["success"] is True
    
    # 2. Extract active OTP from in-memory store
    from app.services.auth_service import _ACTIVE_OTPS
    active_code = _ACTIVE_OTPS["s4bookkeeping@service4gh.com"]["otp"]
    assert len(active_code) == 6

    # 3. Verify OTP
    verify_res = AuthService.verify_otp("s4bookkeeping@service4gh.com", active_code)
    assert verify_res["success"] is True
    assert verify_res["status"] == "AUTHENTICATED"
    assert "access_token" in verify_res
    token = verify_res["access_token"]

    # 4. Validate Token
    user = AuthService.validate_token(token)
    assert user is not None
    assert user["email"] == "s4bookkeeping@service4gh.com"
    assert user["role"] == "admin"


def test_otp_verify_invalid_code():
    AuthService.request_otp("s4bookkeeping@service4gh.com")
    verify_res = AuthService.verify_otp("s4bookkeeping@service4gh.com", "999999")
    assert verify_res["success"] is False
    assert verify_res["status"] == "INVALID_OTP"
