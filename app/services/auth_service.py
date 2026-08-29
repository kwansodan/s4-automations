"""Authentication & Email OTP Service for S4 Automations."""

import hmac
import hashlib
import time
import secrets
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, Any, Optional

from app.config import settings
from app.utils.logging import get_logger

logger = get_logger("auth_service")

# Thread-safe in-memory store for active OTP codes: { "email": { "otp": "123456", "expires_at": 1724900000 } }
_ACTIVE_OTPS: Dict[str, Dict[str, Any]] = {}
OTP_TTL_SECONDS = 600  # 10 minutes


class AuthService:
    """Handles passwordless email OTP generation, dispatch, and token verification."""

    @classmethod
    def request_otp(cls, email: str) -> Dict[str, Any]:
        """Generates a secure 6-digit OTP and dispatches it via email/logger."""
        cleaned_email = email.strip().lower()
        allowed_email = settings.AUTH_EMAIL.strip().lower()

        if cleaned_email != allowed_email:
            logger.warning(f"Unauthorized OTP request attempt for email: {cleaned_email}")
            return {
                "success": False,
                "status": "UNAUTHORIZED",
                "message": f"Email '{email}' is not authorized for S4 Automations admin access.",
            }

        # Generate 6-digit cryptographically secure numeric OTP
        otp = f"{secrets.randbelow(900000) + 100000}"
        expires_at = time.time() + OTP_TTL_SECONDS

        _ACTIVE_OTPS[cleaned_email] = {
            "otp": otp,
            "expires_at": expires_at,
        }

        # Dispatch via SMTP if configured, else fallback to log
        email_sent = cls._send_email(cleaned_email, otp)

        logger.info(f"🔑 [AUTH OTP] Verification code for {cleaned_email}: {otp} (Expires in 10 mins)")

        return {
            "success": True,
            "status": "OTP_SENT",
            "message": f"A 6-digit verification code has been sent to {email}.",
            "email": cleaned_email,
            "expires_in_seconds": OTP_TTL_SECONDS,
            # Provide debug hint when SMTP is not yet configured for zero-blocker development
            "dev_hint": None if email_sent else f"Code logged to server: {otp}",
        }

    @classmethod
    def verify_otp(cls, email: str, otp_code: str) -> Dict[str, Any]:
        """Verifies the 6-digit OTP and issues a bearer access token."""
        cleaned_email = email.strip().lower()
        cleaned_otp = otp_code.strip()

        record = _ACTIVE_OTPS.get(cleaned_email)
        if not record:
            return {
                "success": False,
                "status": "NO_ACTIVE_OTP",
                "message": "No active verification code found. Please request a new code.",
            }

        if time.time() > record["expires_at"]:
            _ACTIVE_OTPS.pop(cleaned_email, None)
            return {
                "success": False,
                "status": "EXPIRED",
                "message": "Verification code has expired. Please request a new one.",
            }

        if record["otp"] != cleaned_otp:
            return {
                "success": False,
                "status": "INVALID_OTP",
                "message": "Incorrect 6-digit verification code. Please try again.",
            }

        # OTP is valid -> clear used code and issue token
        _ACTIVE_OTPS.pop(cleaned_email, None)

        token = cls._create_token(cleaned_email)
        logger.info(f"✅ User {cleaned_email} successfully authenticated via Email OTP.")

        return {
            "success": True,
            "status": "AUTHENTICATED",
            "access_token": token,
            "token_type": "bearer",
            "user": {
                "email": cleaned_email,
                "name": "S4 Bookkeeping Admin",
                "role": "admin",
            },
        }

    @classmethod
    def validate_token(cls, token: str) -> Optional[Dict[str, Any]]:
        """Validates a signed token and returns user profile if valid."""
        import base64
        import json

        if not token or "." not in token:
            return None
        
        parts = token.split(".")
        if len(parts) != 2:
            return None

        payload_b64, sig = parts
        expected_sig = hmac.new(
            settings.AUTH_SECRET_KEY.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256
        ).hexdigest()

        if not hmac.compare_digest(sig, expected_sig):
            return None

        try:
            pad = len(payload_b64) % 4
            if pad:
                payload_b64 += "=" * (4 - pad)
            payload_bytes = base64.urlsafe_b64decode(payload_b64)
            data = json.loads(payload_bytes.decode("utf-8"))

            if time.time() > data.get("exp", 0):
                return None

            return {
                "email": data.get("sub", settings.AUTH_EMAIL),
                "name": "S4 Bookkeeping Admin",
                "role": data.get("role", "admin"),
            }
        except Exception as e:
            logger.warning(f"Token decode error: {e}")
            return None

    @classmethod
    def _create_token(cls, email: str) -> str:
        """Creates a tamper-proof signed bearer token valid for 30 days."""
        import base64
        import json

        payload = {
            "sub": email,
            "role": "admin",
            "exp": int(time.time() + (30 * 86400)),
        }
        payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("utf-8").rstrip("=")
        sig = hmac.new(
            settings.AUTH_SECRET_KEY.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256
        ).hexdigest()
        return f"{payload_b64}.{sig}"

    @classmethod
    def _send_email(cls, to_email: str, otp: str) -> bool:
        """Sends OTP email via SMTP if credentials are provided in settings."""
        if not settings.SMTP_HOST or not settings.SMTP_USER or not settings.SMTP_PASSWORD:
            logger.info("SMTP settings not fully configured in .env. OTP recorded in server log.")
            return False

        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = f"Your S4 Automations Login Code: {otp}"
            msg["From"] = settings.SMTP_FROM
            msg["To"] = to_email

            html_content = f"""
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; background: #0f172a; color: #f8fafc; border-radius: 8px; border: 1px solid #334155;">
                <div style="text-align: center; margin-bottom: 20px;">
                    <h2 style="color: #38bdf8; margin: 0;">⚡ S4 Automations</h2>
                    <p style="color: #94a3b8; font-size: 14px; margin-top: 4px;">Accounting & Financial Automation Suite</p>
                </div>
                <p style="font-size: 15px;">Hello S4 Bookkeeping Admin,</p>
                <p style="font-size: 14px; color: #cbd5e1;">Use the following 6-digit verification code to sign in to your dashboard:</p>
                <div style="background: rgba(56, 189, 248, 0.15); border: 1px solid #38bdf8; border-radius: 6px; padding: 16px; text-align: center; margin: 24px 0;">
                    <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #38bdf8;">{otp}</span>
                </div>
                <p style="font-size: 13px; color: #94a3b8;">This code is valid for 10 minutes. If you did not request this code, you can safely ignore this email.</p>
                <hr style="border: 0; border-top: 1px solid #334155; margin: 20px 0;" />
                <p style="font-size: 11px; color: #64748b; text-align: center;">S4 Automations &bull; Secure Multi-Client Accounting Portal</p>
            </div>
            """
            msg.attach(MIMEText(html_content, "html"))

            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
                server.starttls()
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(settings.SMTP_FROM, [to_email], msg.as_string())

            logger.info(f"Successfully dispatched OTP email to {to_email} via SMTP ({settings.SMTP_HOST})")
            return True
        except Exception as e:
            logger.error(f"Failed to dispatch SMTP email to {to_email}: {e}")
            return False
