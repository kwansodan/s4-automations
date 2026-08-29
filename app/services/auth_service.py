"""Authentication & Email OTP Service for S4 Automations backed by Database."""

import hmac
import hashlib
import time
import secrets
import smtplib
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, Any, Optional
from sqlmodel import Session, select

from app.config import settings
from app.db.session import engine
from app.models.db_models import AuthOtpRecord
from app.utils.logging import get_logger

logger = get_logger("auth_service")
OTP_TTL_SECONDS = 600  # 10 minutes


class AuthService:
    """Handles passwordless email OTP generation, dispatch, and database verification."""

    @classmethod
    def _hash_otp(cls, otp: str, salt: str) -> str:
        return hashlib.sha256(f"{salt}:{otp}:{settings.AUTH_SECRET_KEY}".encode()).hexdigest()

    @classmethod
    def request_otp(cls, email: str) -> Dict[str, Any]:
        """Generates a secure 6-digit OTP and persists it to the database."""
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
        salt = secrets.token_hex(8)
        otp_hash = cls._hash_otp(otp, salt)
        expires_at = datetime.utcnow() + timedelta(seconds=OTP_TTL_SECONDS)

        # Persist to database
        try:
            with Session(engine) as session:
                # Remove any existing active OTP for this email
                existing = session.exec(select(AuthOtpRecord).where(AuthOtpRecord.email == cleaned_email)).all()
                for old in existing:
                    session.delete(old)
                
                record = AuthOtpRecord(
                    email=cleaned_email,
                    otp_hash=otp_hash,
                    salt=salt,
                    expires_at=expires_at,
                    is_verified=False,
                    attempts=0,
                )
                session.add(record)
                session.commit()
        except Exception as e:
            logger.error(f"Database error persisting OTP: {e}")

        # Dispatch via SMTP if configured, else fallback to log
        email_sent = cls._send_email(cleaned_email, otp)

        logger.info(f"🔑 [AUTH OTP] Verification code for {cleaned_email}: {otp} (Expires in 10 mins)")

        return {
            "success": True,
            "status": "OTP_SENT",
            "message": f"A 6-digit verification code has been sent to {email}.",
            "email": cleaned_email,
            "expires_in_seconds": OTP_TTL_SECONDS,
            "dev_hint": None if email_sent else f"Code logged to server: {otp}",
        }

    @classmethod
    def verify_otp(cls, email: str, otp_code: str) -> Dict[str, Any]:
        """Verifies the 6-digit OTP from database and issues a bearer access token."""
        cleaned_email = email.strip().lower()
        cleaned_otp = otp_code.strip()

        try:
            with Session(engine) as session:
                record = session.exec(
                    select(AuthOtpRecord)
                    .where(AuthOtpRecord.email == cleaned_email)
                    .where(AuthOtpRecord.is_verified == False)
                ).first()

                if not record:
                    return {
                        "success": False,
                        "status": "NO_ACTIVE_OTP",
                        "message": "No active verification code found. Please request a new code.",
                    }

                if datetime.utcnow() > record.expires_at:
                    session.delete(record)
                    session.commit()
                    return {
                        "success": False,
                        "status": "EXPIRED",
                        "message": "Verification code has expired. Please request a new one.",
                    }

                expected_hash = cls._hash_otp(cleaned_otp, record.salt)
                if record.otp_hash != expected_hash:
                    record.attempts += 1
                    session.add(record)
                    session.commit()
                    return {
                        "success": False,
                        "status": "INVALID_OTP",
                        "message": "Incorrect 6-digit verification code. Please try again.",
                    }

                # OTP is valid -> delete record and issue token
                session.delete(record)
                session.commit()

        except Exception as e:
            logger.error(f"Database error during OTP verification: {e}")
            return {
                "success": False,
                "status": "DB_ERROR",
                "message": "Verification failed due to a database exception.",
            }

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
    def _create_token(cls, email: str) -> str:
        """Generates a secure HMAC-signed bearer token with 30-day TTL."""
        import base64
        import json

        issued_at = int(time.time())
        expires_at = issued_at + (30 * 86400)  # 30 days
        payload = {
            "sub": email,
            "role": "admin",
            "iat": issued_at,
            "exp": expires_at,
            "nonce": secrets.token_hex(8),
        }
        raw_payload = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
        sig = hmac.new(
            settings.AUTH_SECRET_KEY.encode(),
            raw_payload.encode(),
            hashlib.sha256,
        ).hexdigest()

        return f"{raw_payload}.{sig}"

    @classmethod
    def validate_token(cls, token: str) -> Optional[Dict[str, Any]]:
        """Validates bearer token signature and expiration."""
        import base64
        import json

        if not token or "." not in token:
            return None

        try:
            raw_payload, sig = token.rsplit(".", 1)
            expected_sig = hmac.new(
                settings.AUTH_SECRET_KEY.encode(),
                raw_payload.encode(),
                hashlib.sha256,
            ).hexdigest()

            if not hmac.compare_digest(sig, expected_sig):
                logger.warning("Invalid token signature detected.")
                return None

            payload_bytes = base64.urlsafe_b64decode(raw_payload)
            payload = json.loads(payload_bytes.decode())

            if time.time() > payload.get("exp", 0):
                logger.warning("Expired session token presented.")
                return None

            return {
                "email": payload.get("sub"),
                "name": "S4 Bookkeeping Admin",
                "role": payload.get("role", "admin"),
            }
        except Exception as e:
            logger.warning(f"Failed parsing session token: {e}")
            return None

    @classmethod
    def _send_email(cls, to_email: str, otp: str) -> bool:
        """Sends OTP via SMTP server."""
        if not settings.SMTP_HOST or not settings.SMTP_USER or not settings.SMTP_PASSWORD:
            logger.info("SMTP credentials not configured. OTP dispatched to server console.")
            return False

        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = f"⚡ Your S4 Automations Login Code: {otp}"
            msg["From"] = settings.SMTP_FROM
            msg["To"] = to_email

            html_content = f"""
            <div style="font-family: Arial, sans-serif; background-color: #0b0f19; color: #f8fafc; padding: 24px; border-radius: 12px;">
              <h2 style="color: #38bdf8; margin-top: 0;">⚡ S4 Automations Security</h2>
              <p>Your one-time verification code for the S4 Multi-Client Accounting Suite is:</p>
              <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #ffffff; background: #1a2234; padding: 16px; text-align: center; border-radius: 8px; margin: 20px 0;">
                {otp}
              </div>
              <p style="color: #94a3b8; font-size: 13px;">This code will expire in 10 minutes. If you did not request this login, please ignore this email.</p>
            </div>
            """
            msg.attach(MIMEText(html_content, "html"))

            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
                server.starttls()
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(settings.SMTP_FROM, [to_email], msg.as_string())

            logger.info(f"Dispatched OTP email to {to_email} via {settings.SMTP_HOST}")
            return True
        except Exception as e:
            logger.error(f"Failed to dispatch OTP email via SMTP: {e}")
            return False
