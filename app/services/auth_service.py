"""Authentication & Email OTP Service for S4 Automations backed by Database."""

import hmac
import hashlib
import time
import secrets
from datetime import datetime, timezone, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, Any, Optional, List, Tuple
from sqlmodel import Session, select

from app.config import settings
from app.db.session import get_engine
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
    def is_platform_admin(cls, email: str) -> bool:
        """Returns True if email is pinned in config allowlist or active in PlatformAdminUser table."""
        cleaned_email = (email or "").strip().lower()
        if not cleaned_email:
            return False
        if cleaned_email in settings.get_platform_admin_emails():
            return True
        try:
            from app.models.db_models import PlatformAdminUser
            with Session(get_engine()) as session:
                row = session.exec(
                    select(PlatformAdminUser)
                    .where(PlatformAdminUser.email == cleaned_email)
                    .where(PlatformAdminUser.is_active == True)
                ).first()
                return row is not None
        except Exception:
            return False

    @classmethod
    def request_otp(cls, email: str) -> Dict[str, Any]:
        """Generates a secure 6-digit OTP and persists it to the database."""
        cleaned_email = email.strip().lower()
        is_admin = cls.is_platform_admin(cleaned_email)
        is_team_member = False

        if not is_admin:
            try:
                from app.models.db_models import FirmTeamMember
                with Session(get_engine()) as session:
                    member = session.exec(
                        select(FirmTeamMember)
                        .where(FirmTeamMember.email == cleaned_email)
                        .where(FirmTeamMember.status.in_(["ACTIVE", "INVITED"]))
                    ).first()
                    if member:
                        is_team_member = True
            except Exception as e:
                logger.error(f"Error checking firm team member table: {e}")

        if not (is_admin or is_team_member):
            logger.warning(f"Unauthorized OTP request attempt for email: {cleaned_email}")
            return {
                "success": False,
                "status": "UNAUTHORIZED",
                "message": f"Email '{email}' is not authorized. Please ask your administrator to invite you to the firm team.",
            }

        # Generate 6-digit cryptographically secure numeric OTP
        otp = f"{secrets.randbelow(900000) + 100000}"
        salt = secrets.token_hex(8)
        otp_hash = cls._hash_otp(otp, salt)
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=OTP_TTL_SECONDS)

        # Persist to database
        try:
            with Session(get_engine()) as session:
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
        cls._send_email(cleaned_email, otp)

        logger.info(f"🔑 [AUTH OTP] Verification code for {cleaned_email}: {otp} (Expires in 10 mins)")

        return {
            "success": True,
            "status": "OTP_SENT",
            "message": f"A 6-digit verification code has been sent to {email}.",
            "email": cleaned_email,
            "expires_in_seconds": OTP_TTL_SECONDS,
            "dev_hint": f"Code: {otp}" if (settings.ENVIRONMENT.lower() in ("development", "test") and settings.MOCK_MODE) else None,
        }

    @classmethod
    def _serialize_org(cls, org: Any, role: str = "ADMIN", title: str = "Administrator", is_primary: bool = False) -> Dict[str, Any]:
        return {
            "id": org.id,
            "name": org.name,
            "org_type": org.org_type,
            "plan_tier": org.plan_tier,
            "max_clients": org.max_clients,
            "industry": org.industry,
            "icon": org.icon,
            "subscription_status": getattr(org, "subscription_status", "ACTIVE"),
            "is_active": getattr(org, "is_active", True),
            "white_label_logo_url": getattr(org, "white_label_logo_url", None),
            "custom_portal_subdomain": getattr(org, "custom_portal_subdomain", None),
            "role": role,
            "title": title,
            "is_primary": is_primary,
        }

    @classmethod
    def get_user_organizations(
        cls, email: str, impersonating_org_id: Optional[str] = None
    ) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
        """Returns active primary organization and list of organizations accessible by the user."""
        from app.models.db_models import Organization, UserOrganizationMembership, FirmTeamMember

        cleaned_email = (email or "").strip().lower()
        is_sa = cls.is_platform_admin(cleaned_email)
        orgs: List[Dict[str, Any]] = []
        current_org: Optional[Dict[str, Any]] = None

        try:
            with Session(get_engine()) as session:
                memberships = session.exec(
                    select(UserOrganizationMembership).where(
                        UserOrganizationMembership.user_email == cleaned_email
                    )
                ).all()
                membership_map = {m.organization_id: m for m in memberships}

                if is_sa:
                    all_orgs = session.exec(select(Organization).order_by(Organization.name)).all()
                    for org in all_orgs:
                        m = membership_map.get(org.id)
                        is_pri = (impersonating_org_id == org.id) if impersonating_org_id else (m.is_primary if m else False)
                        org_dict = cls._serialize_org(
                            org,
                            role=(m.role if m else "PLATFORM_SUPER_ADMIN"),
                            title=(m.title if m else "Platform Super-Admin"),
                            is_primary=is_pri,
                        )
                        orgs.append(org_dict)
                        if is_pri or current_org is None:
                            current_org = org_dict
                else:
                    seen_ids = set()
                    for m in memberships:
                        org = session.exec(select(Organization).where(Organization.id == m.organization_id)).first()
                        if org:
                            org_dict = cls._serialize_org(org, role=m.role, title=m.title or "Team Member", is_primary=m.is_primary)
                            orgs.append(org_dict)
                            seen_ids.add(org.id)
                            if m.is_primary or current_org is None:
                                current_org = org_dict

                    team_rows = session.exec(
                        select(FirmTeamMember).where(
                            FirmTeamMember.email == cleaned_email,
                            FirmTeamMember.status.in_(["ACTIVE", "INVITED"]),
                        )
                    ).all()
                    for tm in team_rows:
                        if tm.organization_id not in seen_ids:
                            org = session.exec(select(Organization).where(Organization.id == tm.organization_id)).first()
                            if org:
                                org_dict = cls._serialize_org(org, role=tm.role, title=tm.role, is_primary=(current_org is None))
                                orgs.append(org_dict)
                                seen_ids.add(org.id)
                                if current_org is None:
                                    current_org = org_dict
        except Exception as e:
            logger.warning(f"Could not load organizations for {email}: {e}")

        if not current_org:
            current_org = {
                "id": "s4_advisory",
                "name": "S4 Accounting & Advisory Partners",
                "org_type": "ACCOUNTING_FIRM",
                "plan_tier": "firm_scale",
                "max_clients": 50,
                "industry": "Chartered Accounting & Audit Practice",
                "icon": "🏛️",
                "role": "OWNER" if is_sa else "STAFF",
                "title": "Managing Partner" if is_sa else "Team Member",
                "is_primary": True,
            }
            orgs = [current_org]

        return current_org, orgs

    @classmethod
    def verify_otp(cls, email: str, otp_code: str) -> Dict[str, Any]:
        """Verifies the 6-digit OTP from database and issues a bearer access token."""
        cleaned_email = email.strip().lower()
        cleaned_otp = otp_code.strip()

        try:
            with Session(get_engine()) as session:
                record = session.exec(
                    select(AuthOtpRecord)
                    .where(AuthOtpRecord.email == cleaned_email)
                    .where(AuthOtpRecord.is_verified == False)
                ).first()

                if not record:
                    return {
                        "success": False,
                        "status": "NOT_FOUND",
                        "message": "No active OTP request found for this email. Please request a new code.",
                    }

                record_exp = record.expires_at
                if record_exp.tzinfo is None:
                    record_exp = record_exp.replace(tzinfo=timezone.utc)

                if datetime.now(timezone.utc) > record_exp:
                    session.delete(record)
                    session.commit()
                    return {
                        "success": False,
                        "status": "EXPIRED",
                        "message": "Verification code has expired. Please request a new code.",
                    }

                record.attempts += 1
                if record.attempts > 5:
                    session.delete(record)
                    session.commit()
                    return {
                        "success": False,
                        "status": "TOO_MANY_ATTEMPTS",
                        "message": "Too many failed attempts. Code has been invalidated. Please request a new one.",
                    }

                expected_hash = cls._hash_otp(cleaned_otp, record.salt)
                if not hmac.compare_digest(record.otp_hash, expected_hash):
                    session.add(record)
                    session.commit()
                    return {
                        "success": False,
                        "status": "INVALID_OTP",
                        "message": f"Incorrect verification code. {5 - record.attempts} attempt(s) remaining.",
                    }

                # Mark verified & cleanup
                record.is_verified = True
                session.delete(record)
                session.commit()
        except Exception as e:
            logger.error(f"Database error verifying OTP: {e}")
            return {
                "success": False,
                "status": "DB_ERROR",
                "message": f"Database verification error: {str(e)}",
            }

        user_profile = cls._build_user_profile(
            cleaned_email,
            fallback_role="admin" if cls.is_platform_admin(cleaned_email) else "SENIOR_ACCOUNTANT",
            update_login_timestamp=True,
        )
        token = cls._create_token(cleaned_email, role=user_profile["role"])
        logger.info(
            f"✅ User {cleaned_email} authenticated via Email OTP ({user_profile['organization']['org_type']}, platform_admin={user_profile['is_platform_admin']})."
        )

        return {
            "success": True,
            "status": "AUTHENTICATED",
            "access_token": token,
            "token_type": "bearer",
            "user": user_profile,
        }

    @classmethod
    def _build_user_profile(
        cls,
        email: str,
        fallback_role: str = "SENIOR_ACCOUNTANT",
        update_login_timestamp: bool = False,
        impersonating_org_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Builds normalized user identity, organization scope, and RBAC flags."""
        cleaned_email = (email or "").strip().lower()
        is_sa = cls.is_platform_admin(cleaned_email)
        user_name = "S4 Platform Administrator" if is_sa else "Team Member"
        user_role = "admin" if is_sa else (fallback_role or "SENIOR_ACCOUNTANT")

        try:
            from app.models.db_models import FirmTeamMember, PlatformAdminUser
            with Session(get_engine()) as session:
                if is_sa:
                    sa_row = session.exec(
                        select(PlatformAdminUser).where(PlatformAdminUser.email == cleaned_email)
                    ).first()
                    if sa_row:
                        user_name = sa_row.name or user_name
                        if update_login_timestamp:
                            sa_row.last_login_at = datetime.now(timezone.utc)
                            session.add(sa_row)
                            session.commit()

                member = session.exec(
                    select(FirmTeamMember).where(FirmTeamMember.email == cleaned_email)
                ).first()
                if member:
                    if not is_sa:
                        user_name = member.name
                        user_role = member.role
                    elif member.name and user_name == "S4 Platform Administrator":
                        user_name = member.name
                    if update_login_timestamp:
                        member.status = "ACTIVE"
                        member.last_login_at = datetime.now(timezone.utc)
                        session.add(member)
                        session.commit()
        except Exception as e:
            logger.warning(f"Could not enrich user profile for {cleaned_email}: {e}")

        current_org, orgs = cls.get_user_organizations(
            cleaned_email, impersonating_org_id=impersonating_org_id if is_sa else None
        )
        org_role = str((current_org or {}).get("role", "")).upper()
        is_org_admin = is_sa or str(user_role).lower() in ("admin", "partner", "owner") or org_role in ("OWNER", "ADMIN", "PARTNER")

        return {
            "email": cleaned_email,
            "name": user_name,
            "role": user_role,
            "is_platform_admin": is_sa,
            "is_org_admin": is_org_admin,
            "impersonating_org_id": impersonating_org_id if is_sa else None,
            "organization": current_org,
            "organizations": orgs,
        }

    @classmethod
    def _create_token(cls, email: str, role: str = "admin") -> str:
        """Generates a secure HMAC-signed bearer token with 30-day TTL."""
        import base64
        import json

        issued_at = int(time.time())
        expires_at = issued_at + (30 * 86400)  # 30 days
        payload = {
            "sub": email,
            "role": role,
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

            email = payload.get("sub", "")
            fallback_role = payload.get("role", "SENIOR_ACCOUNTANT")
            return cls._build_user_profile(email, fallback_role=fallback_role, update_login_timestamp=False)
        except Exception as e:
            logger.warning(f"Failed parsing session token: {e}")
            return None

    @classmethod
    def _send_email(cls, to_email: str, otp: str) -> bool:
        """Sends OTP via Mailjet REST API v3.1 or SMTP."""
        import asyncio
        import concurrent.futures
        from app.services.mailjet_service import MailjetService

        if not MailjetService.is_configured():
            logger.info("Mailjet credentials not configured. OTP dispatched to server console.")
            return False

        try:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None

            if loop and loop.is_running():
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    future = pool.submit(asyncio.run, MailjetService.send_login_otp(to_email, otp))
                    return future.result()
            else:
                return asyncio.run(MailjetService.send_login_otp(to_email, otp))
        except Exception as e:
            logger.error(f"Failed to dispatch OTP email via Mailjet: {e}")
            return False
