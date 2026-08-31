"""Mailjet Email Service (REST API v3.1 & SMTP) for S4 Automations."""

import smtplib
import httpx
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, Any, Optional, List

from app.config import settings
from app.utils.logging import get_logger

logger = get_logger("mailjet_service")


class MailjetService:
    """Dispatches emails via Mailjet REST API v3.1 with SMTP fallback."""

    MAILJET_API_URL = "https://api.mailjet.com/v3.1/send"

    @classmethod
    def is_configured(cls) -> bool:
        """Checks if either Mailjet API keys or SMTP credentials are configured."""
        has_api_keys = bool(settings.MAILJET_API_KEY and settings.MAILJET_SECRET_KEY)
        has_smtp = bool(settings.SMTP_USER and settings.SMTP_PASSWORD)
        return has_api_keys or has_smtp

    @classmethod
    async def send_email(
        cls,
        to_email: str,
        subject: str,
        html_content: str,
        text_content: Optional[str] = None,
        recipient_name: Optional[str] = None,
    ) -> bool:
        """
        Sends an email using Mailjet REST API v3.1 (preferred) or SMTP fallback.
        """
        # 0. Mock mode handler
        if settings.MOCK_MODE:
            logger.info(f"[MOCK] Dispatched email with subject '{subject}' to {to_email}")
            return True

        # 1. Try Mailjet REST API v3.1 if API keys are provided
        if settings.MAILJET_API_KEY and settings.MAILJET_SECRET_KEY and not settings.MOCK_MODE:
            try:
                payload = {
                    "Messages": [
                        {
                            "From": {
                                "Email": settings.MAILJET_FROM_EMAIL or "s4bookkeeping@service4gh.com",
                                "Name": settings.MAILJET_FROM_NAME or "S4 Automations Security",
                            },
                            "To": [
                                {
                                    "Email": to_email,
                                    "Name": recipient_name or to_email.split("@")[0],
                                }
                            ],
                            "Subject": subject,
                            "TextPart": text_content or subject,
                            "HTMLPart": html_content,
                        }
                    ]
                }

                async with httpx.AsyncClient(timeout=10.0) as client:
                    response = await client.post(
                        cls.MAILJET_API_URL,
                        auth=(settings.MAILJET_API_KEY, settings.MAILJET_SECRET_KEY),
                        json=payload,
                    )

                if response.status_code in [200, 201]:
                    logger.info(f"✅ Dispatched email to {to_email} via Mailjet REST API v3.1 (Status: {response.status_code})")
                    return True
                else:
                    logger.warning(f"Mailjet REST API returned error status {response.status_code}: {response.text}. Attempting SMTP fallback...")
            except Exception as e:
                logger.error(f"Mailjet REST API error: {e}. Attempting SMTP fallback...")

        # 2. Fallback to Mailjet SMTP (in-v3.mailjet.com:587)
        smtp_user = settings.SMTP_USER or settings.MAILJET_API_KEY
        smtp_pass = settings.SMTP_PASSWORD or settings.MAILJET_SECRET_KEY
        smtp_host = settings.SMTP_HOST or "in-v3.mailjet.com"

        if smtp_user and smtp_pass and not settings.MOCK_MODE:
            try:
                msg = MIMEMultipart("alternative")
                msg["Subject"] = subject
                msg["From"] = settings.SMTP_FROM or settings.MAILJET_FROM_EMAIL or "s4bookkeeping@service4gh.com"
                msg["To"] = to_email

                if text_content:
                    msg.attach(MIMEText(text_content, "plain"))
                msg.attach(MIMEText(html_content, "html"))

                with smtplib.SMTP(smtp_host, settings.SMTP_PORT) as server:
                    server.starttls()
                    server.login(smtp_user, smtp_pass)
                    server.sendmail(msg["From"], [to_email], msg.as_string())

                logger.info(f"✅ Dispatched email to {to_email} via Mailjet SMTP ({smtp_host})")
                return True
            except Exception as e:
                logger.error(f"Mailjet SMTP delivery failed: {e}")
                return False

        logger.info(f"Mailjet credentials not configured in .env. Email with subject '{subject}' logged to server.")
        return False

    @classmethod
    async def send_login_otp(cls, to_email: str, otp_code: str) -> bool:
        """Sends branded passwordless login OTP email via Mailjet."""
        subject = f"⚡ Your S4 Automations Login Code: {otp_code}"
        
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>{subject}</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', Arial, sans-serif; background-color: #020617; color: #f8fafc;">
          <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #020617; padding: 40px 10px;">
            <tr>
              <td align="center">
                <table width="100%" max-width="500px" style="max-width: 500px; background-color: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 36px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);">
                  <tr>
                    <td align="left">
                      <div style="display: inline-block; padding: 8px 12px; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 8px; color: #38bdf8; font-size: 13px; font-weight: 600; margin-bottom: 20px;">
                        ⚡ S4 Automations Security
                      </div>
                      <h2 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0 0 12px 0;">
                        Verification Code
                      </h2>
                      <p style="color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                        Use this 6-digit one-time password (OTP) to securely access the S4 Multi-Client Accounting Suite:
                      </p>
                      
                      <div style="background-color: #020617; border: 1px solid #38bdf8; border-radius: 12px; padding: 20px; text-align: center; margin: 0 0 24px 0;">
                        <span style="font-family: 'JetBrains Mono', monospace, Courier; font-size: 36px; font-weight: 800; letter-spacing: 10px; color: #38bdf8;">
                          {otp_code}
                        </span>
                      </div>

                      <p style="color: #64748b; font-size: 12px; line-height: 1.5; margin: 0 0 16px 0;">
                        ⏳ <strong>Expires in 10 minutes.</strong> If you did not request this login code, please disregard this email.
                      </p>
                      <hr style="border: 0; border-top: 1px solid #1e293b; margin: 24px 0;" />
                      <p style="color: #475569; font-size: 11px; margin: 0; text-align: center;">
                        Protected by S4 Multi-Client Accounting Automation • Service4GH
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
        """
        text_content = f"Your S4 Automations verification code is: {otp_code}. It expires in 10 minutes."
        return await cls.send_email(to_email, subject, html_content, text_content)
