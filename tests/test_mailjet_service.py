"""Tests for Mailjet Email Service."""

import pytest
from unittest.mock import patch, AsyncMock
from app.services.mailjet_service import MailjetService
from app.config import settings


@pytest.mark.asyncio
async def test_mailjet_service_not_configured_fallback():
    """Verify that unconfigured Mailjet logs email and returns False without crashing."""
    with patch.object(settings, "MAILJET_API_KEY", None), \
         patch.object(settings, "MAILJET_SECRET_KEY", None), \
         patch.object(settings, "SMTP_USER", None), \
         patch.object(settings, "SMTP_PASSWORD", None):
        
        res = await MailjetService.send_email(
            to_email="test@service4gh.com",
            subject="Test Subject",
            html_content="<p>Test</p>",
        )
        assert res is False


@pytest.mark.asyncio
async def test_mailjet_service_rest_api_dispatch():
    """Verify Mailjet REST API v3.1 sends HTTP request with basic auth."""
    mock_response = AsyncMock()
    mock_response.status_code = 200

    with patch.object(settings, "MAILJET_API_KEY", "test_public_key"), \
         patch.object(settings, "MAILJET_SECRET_KEY", "test_secret_key"), \
         patch.object(settings, "MOCK_MODE", False), \
         patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        
        mock_post.return_value = mock_response

        res = await MailjetService.send_login_otp(
            to_email="s4bookkeeping@service4gh.com",
            otp_code="982314",
        )
        assert res is True
        mock_post.assert_called_once()
        call_kwargs = mock_post.call_args.kwargs
        assert call_kwargs["auth"] == ("test_public_key", "test_secret_key")
        assert "982314" in str(call_kwargs["json"])
