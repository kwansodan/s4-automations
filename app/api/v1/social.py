"""Social & Multi-Channel Feature Release Broadcaster API Endpoints."""

from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlmodel import Session, select, desc

from app.config import settings
from app.db.session import get_db_session
from app.models.db_models import FeatureRelease, get_utc_now
from app.services.social_service import SocialBroadcasterService
from app.utils.logging import get_logger

logger = get_logger("social_api")

router = APIRouter(prefix="/social", tags=["Feature Release & Social Broadcaster"])


# -------------------------------------------------------------------------
# Request / Response Schemas
# -------------------------------------------------------------------------

class UpdateLinkedInConfigRequest(BaseModel):
    posting_mode: Optional[str] = Field(default="organization", description="'organization' or 'person'")
    organization_id: Optional[str] = Field(default=None, description="LinkedIn Organization ID or Vanity Slug")
    organization_name: Optional[str] = Field(default=None, description="LinkedIn Company/Page Display Name")
    author_urn: Optional[str] = Field(default=None, description="LinkedIn Author URN")
    access_token: Optional[str] = Field(default=None, description="LinkedIn OAuth Bearer Token")
    client_id: Optional[str] = Field(default=None, description="LinkedIn App Client ID")
    client_secret: Optional[str] = Field(default=None, description="LinkedIn App Client Secret")
    redirect_uri: Optional[str] = Field(default=None, description="Custom OAuth Redirect URI")


class TestLinkedInConfigRequest(BaseModel):
    access_token: Optional[str] = None
    author_urn: Optional[str] = None
    organization_id: Optional[str] = None


class GenerateReleaseRequest(BaseModel):
    title: str = Field(..., description="Short feature or release headline")
    summary: str = Field(..., description="Description or bullet points of what was built")
    category: str = Field(default="ACCOUNTING_AUTOMATION", description="AP, AR, BANK, OCR, INTEGRATION, PLATFORM")
    target_audience: str = Field(default="Accounting Firms & Finance Leaders", description="Target audience lens")
    commit_hash: Optional[str] = Field(default=None, description="Optional git commit hash reference")


class BroadcastReleaseRequest(BaseModel):
    version: str = Field(default="1.1.0", description="Semantic release version")
    title: str = Field(..., description="Feature title")
    category: str = Field(default="ACCOUNTING_AUTOMATION")
    summary: str = Field(...)
    commit_hash: Optional[str] = None
    
    linkedin_post: Optional[str] = None
    twitter_post: Optional[str] = None
    client_email_subject: Optional[str] = None
    client_email_html: Optional[str] = None
    changelog_entry: Optional[str] = None
    
    channels: List[str] = Field(
        default=["linkedin", "twitter", "email", "changelog"],
        description="Active channels to broadcast to"
    )
    email_recipients: Optional[List[str]] = Field(default=None, description="Custom recipient email list")


# -------------------------------------------------------------------------
# API Endpoints
# -------------------------------------------------------------------------

@router.get("/linkedin/config")
async def get_linkedin_config() -> Dict[str, Any]:
    """Returns current LinkedIn integration configuration and target business page details."""
    target = SocialBroadcasterService.resolve_linkedin_target()
    clean_token = getattr(settings, "LINKEDIN_ACCESS_TOKEN", None)
    masked_token = (clean_token[:4] + "..." + clean_token[-4:]) if clean_token and len(clean_token) > 8 else ("******" if clean_token else "")
    
    return {
        "status": "success",
        "posting_mode": getattr(settings, "LINKEDIN_POSTING_MODE", "organization") or "organization",
        "organization_id": getattr(settings, "LINKEDIN_ORGANIZATION_ID", "") or "",
        "organization_name": getattr(settings, "LINKEDIN_PAGE_NAME", "") or "",
        "author_urn": getattr(settings, "LINKEDIN_AUTHOR_URN", "") or target.get("author_urn", ""),
        "company_admin_url": target.get("company_admin_url"),
        "has_access_token": bool(clean_token),
        "masked_token": masked_token,
        "client_id": getattr(settings, "LINKEDIN_CLIENT_ID", "") or "",
        "has_client_secret": bool(getattr(settings, "LINKEDIN_CLIENT_SECRET", None)),
        "is_connected": bool(getattr(settings, "LINKEDIN_ORGANIZATION_ID", None) or clean_token),
    }


@router.post("/linkedin/config")
async def update_linkedin_config(payload: UpdateLinkedInConfigRequest) -> Dict[str, Any]:
    """Updates and persists LinkedIn integration settings for company pages and direct publishing."""
    update_data = {}
    if payload.posting_mode is not None:
        update_data["LINKEDIN_POSTING_MODE"] = payload.posting_mode
    if payload.organization_id is not None:
        clean_org = payload.organization_id.strip()
        if "linkedin.com/company/" in clean_org:
            clean_org = clean_org.split("linkedin.com/company/")[1].strip("/").split("/")[0]
        if clean_org.startswith("urn:li:organization:"):
            clean_org = clean_org.replace("urn:li:organization:", "")
        update_data["LINKEDIN_ORGANIZATION_ID"] = clean_org
        if clean_org and not payload.author_urn:
            update_data["LINKEDIN_AUTHOR_URN"] = f"urn:li:organization:{clean_org}"
    if payload.organization_name is not None:
        update_data["LINKEDIN_PAGE_NAME"] = payload.organization_name
    if payload.author_urn is not None:
        update_data["LINKEDIN_AUTHOR_URN"] = payload.author_urn
    if payload.access_token is not None and not payload.access_token.startswith("***"):
        update_data["LINKEDIN_ACCESS_TOKEN"] = payload.access_token.strip()
    if payload.client_id is not None:
        update_data["LINKEDIN_CLIENT_ID"] = payload.client_id.strip()
    if payload.client_secret is not None and not payload.client_secret.startswith("***"):
        update_data["LINKEDIN_CLIENT_SECRET"] = payload.client_secret.strip()
    if payload.redirect_uri is not None:
        update_data["LINKEDIN_REDIRECT_URI"] = payload.redirect_uri.strip()

    settings.update_values(update_data)
    settings.save_to_env_file()
    logger.info(f"Updated LinkedIn configuration: organization_id={settings.LINKEDIN_ORGANIZATION_ID}")

    return await get_linkedin_config()


@router.post("/linkedin/test")
async def test_linkedin_connection_endpoint(payload: Optional[TestLinkedInConfigRequest] = None) -> Dict[str, Any]:
    """Tests live connection to LinkedIn API or verifies business page configuration."""
    res = await SocialBroadcasterService.test_linkedin_connection(
        access_token=payload.access_token if payload else None,
        author_urn=payload.author_urn if payload else None,
        organization_id=payload.organization_id if payload else None,
    )
    return res


@router.get("/commits")
async def get_recent_commits(limit: int = 100) -> List[Dict[str, Any]]:
    """Returns recent git commits from the repository for 1-click feature selection."""
    return SocialBroadcasterService.get_recent_git_commits(limit=limit)


@router.post("/generate")
async def generate_channel_content(payload: GenerateReleaseRequest) -> Dict[str, Any]:
    """Uses Gemini AI to generate tailored copy across LinkedIn, X/Twitter, Client Email, and Changelog."""
    if not payload.title and not payload.summary:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either feature title or summary must be provided."
        )
    
    content = await SocialBroadcasterService.generate_multi_channel_content(
        feature_title=payload.title,
        feature_summary=payload.summary,
        category=payload.category,
        target_audience=payload.target_audience,
        commit_hash=payload.commit_hash,
    )
    return content


@router.post("/broadcast")
async def broadcast_release(
    payload: BroadcastReleaseRequest,
    db: Session = Depends(get_db_session)
) -> Dict[str, Any]:
    """Dispatches the release communication across selected channels and records the release."""
    delivery_status: Dict[str, Any] = {}
    
    # 1. LinkedIn Broadcast
    if "linkedin" in payload.channels and payload.linkedin_post:
        li_res = await SocialBroadcasterService.publish_to_linkedin(payload.linkedin_post)
        delivery_status["linkedin"] = li_res
    
    # 2. X / Twitter Broadcast
    if "twitter" in payload.channels and payload.twitter_post:
        tw_res = await SocialBroadcasterService.publish_to_twitter(payload.twitter_post)
        delivery_status["twitter"] = tw_res
        
    # 3. Client Email Broadcast
    if "email" in payload.channels and payload.client_email_subject and payload.client_email_html:
        em_res = await SocialBroadcasterService.broadcast_client_emails(
            subject=payload.client_email_subject,
            html_content=payload.client_email_html,
            recipients=payload.email_recipients,
        )
        delivery_status["email"] = em_res
        
    # 4. In-App Changelog
    is_changelog = "changelog" in payload.channels
    if is_changelog:
        delivery_status["changelog"] = {
            "status": "SUCCESS",
            "message": "Published to live in-app changelog.",
        }

    # Save to Database
    try:
        release_record = FeatureRelease(
            version=payload.version,
            title=payload.title,
            category=payload.category,
            summary=payload.summary,
            commit_hash=payload.commit_hash,
            linkedin_post=payload.linkedin_post,
            twitter_post=payload.twitter_post,
            client_email_subject=payload.client_email_subject,
            client_email_html=payload.client_email_html,
            changelog_entry=payload.changelog_entry or payload.summary,
            channels_broadcasted=payload.channels,
            broadcast_status=delivery_status,
            is_published_to_changelog=is_changelog,
            published_at=get_utc_now(),
        )
        db.add(release_record)
        db.commit()
        db.refresh(release_record)
        release_id = release_record.id
    except Exception as e:
        logger.error(f"Failed to persist FeatureRelease to database: {e}")
        db.rollback()
        release_id = None

    return {
        "success": True,
        "release_id": release_id,
        "version": payload.version,
        "title": payload.title,
        "channels": payload.channels,
        "delivery_status": delivery_status,
    }


@router.get("/history")
async def get_release_history(
    limit: int = 20,
    db: Session = Depends(get_db_session)
) -> List[Dict[str, Any]]:
    """Returns past feature releases and their broadcast dispatch statuses."""
    try:
        statement = select(FeatureRelease).order_by(desc(FeatureRelease.created_at)).limit(limit)
        results = db.exec(statement).all()
        return [
            {
                "id": r.id,
                "version": r.version,
                "title": r.title,
                "category": r.category,
                "summary": r.summary,
                "commit_hash": r.commit_hash,
                "channels_broadcasted": r.channels_broadcasted,
                "broadcast_status": r.broadcast_status,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "published_at": r.published_at.isoformat() if r.published_at else None,
            }
            for r in results
        ]
    except Exception as e:
        logger.error(f"Error fetching release history: {e}")
        return []


@router.get("/changelog")
async def get_public_changelog(
    limit: int = 30,
    db: Session = Depends(get_db_session)
) -> List[Dict[str, Any]]:
    """Returns published in-app changelog entries for public or portal display."""
    try:
        statement = (
            select(FeatureRelease)
            .where(FeatureRelease.is_published_to_changelog == True)
            .order_by(desc(FeatureRelease.created_at))
            .limit(limit)
        )
        results = db.exec(statement).all()
        if not results:
            # Return seeded defaults if empty
            return [
                {
                    "id": 1,
                    "version": "1.3.2",
                    "title": "Zoho Books 1-Click OAuth & Callback Configuration",
                    "category": "INTEGRATION",
                    "summary": "Full reverse-proxy detection and 1-click Authorized Redirect URI copying for instant Zoho Books tenant authentication.",
                    "changelog_entry": "### Zoho Books 1-Click OAuth\n\n- Automatic reverse-proxy host detection.\n- Added 1-Click Authorized Redirect URI copy tool in Client Settings.\n- Eliminates Invalid Redirect URI errors during partner connection.",
                    "published_at": "2026-09-08T14:40:00Z",
                },
                {
                    "id": 2,
                    "version": "1.3.1",
                    "title": "Real-Time Server Logs & Execution Transparency",
                    "category": "PLATFORM",
                    "summary": "Live server telemetry and streaming error diagnostics directly visible in frontend workspace.",
                    "changelog_entry": "### Real-Time Telemetry\n\n- Live Docker log streaming to in-app console.\n- Detailed execution modals after triggering streams.",
                    "published_at": "2026-09-08T12:00:00Z",
                },
                {
                    "id": 3,
                    "version": "1.3.0",
                    "title": "Automated Processed File Archival Subfolder",
                    "category": "AP_WORKFLOW",
                    "summary": "Processed vendor bills and control sheets are now automatically moved to client/Processed/ to avoid duplicate billings.",
                    "changelog_entry": "### Processed File Archival\n\n- New pipeline toggle: 'Move to Processed Folder'.\n- Automatically creates /Processed subfolder in Google Drive.\n- Guaranteed zero duplicate ingestion.",
                    "published_at": "2026-09-07T18:00:00Z",
                },
            ]

        return [
            {
                "id": r.id,
                "version": r.version,
                "title": r.title,
                "category": r.category,
                "summary": r.summary,
                "changelog_entry": r.changelog_entry or r.summary,
                "published_at": r.published_at.isoformat() if r.published_at else r.created_at.isoformat(),
            }
            for r in results
        ]
    except Exception as e:
        logger.error(f"Error fetching changelog: {e}")
        return []
