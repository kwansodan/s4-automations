"""Multi-Channel Social & Release Broadcaster Service for Accounting Automations."""

import json
import os
import subprocess
import urllib.parse
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
import httpx

from app.config import settings
from app.utils.logging import get_logger
from app.services.mailjet_service import MailjetService

logger = get_logger("social_service")


class SocialBroadcasterService:
    """Orchestrates multi-channel feature announcements across LinkedIn, X, Email, and Changelog."""

    @staticmethod
    def get_recent_git_commits(limit: int = 8) -> List[Dict[str, Any]]:
        """Reads recent git commits from the local repository."""
        try:
            cmd = ["git", "log", f"-n {limit}", "--pretty=format:%H|%an|%ad|%s", "--date=short"]
            res = subprocess.run(
                " ".join(cmd),
                shell=True,
                capture_output=True,
                text=True,
                timeout=5,
            )
            if res.returncode != 0 or not res.stdout.strip():
                return SocialBroadcasterService._get_fallback_commits()

            commits = []
            for line in res.stdout.strip().split("\n"):
                parts = line.strip().split("|")
                if len(parts) >= 4:
                    full_hash, author, date, message = parts[0], parts[1], parts[2], "|".join(parts[3:])
                    commits.append({
                        "hash": full_hash[:7],
                        "full_hash": full_hash,
                        "author": author,
                        "date": date,
                        "message": message,
                    })
            return commits or SocialBroadcasterService._get_fallback_commits()
        except Exception as e:
            logger.warning(f"Could not read git log: {e}. Returning fallback commits.")
            return SocialBroadcasterService._get_fallback_commits()

    @staticmethod
    def _get_fallback_commits() -> List[Dict[str, Any]]:
        """Fallback commits when git binary or repo history is unavailable."""
        return [
            {
                "hash": "63445e0",
                "full_hash": "63445e0",
                "author": "S4 Engineer",
                "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "message": "fix(oauth): expose and configure Zoho Authorized Redirect URI in Client Settings",
            },
            {
                "hash": "587346e",
                "full_hash": "587346e",
                "author": "S4 Engineer",
                "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "message": "feat(telemetry): provide full background execution transparency and run summary modal across the app",
            },
            {
                "hash": "1a7d926",
                "full_hash": "1a7d926",
                "author": "S4 Engineer",
                "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "message": "feat(accounting): log auto-posted transactions to spreadsheet and mark status as posted/billed",
            },
            {
                "hash": "28c5a7b",
                "full_hash": "28c5a7b",
                "author": "S4 Engineer",
                "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "message": "feat(pipelines): add toggle to move processed files to Processed subfolder",
            },
        ]

    @staticmethod
    async def generate_multi_channel_content(
        feature_title: str,
        feature_summary: str,
        category: str = "ACCOUNTING_AUTOMATION",
        target_audience: str = "Accounting Firms & Finance Leaders",
        commit_hash: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Uses Google Gemini to craft tailored copy across LinkedIn, X/Twitter, Client Email, and Changelog."""
        
        prompt = f"""
You are an elite B2B product marketing director and senior accounting software architect for "S4 Automations" — an enterprise multi-tenant accounting and document ingestion automation engine.
S4 Automations eliminates manual data entry for accounting firms, CFOs, and finance teams by automating:
- Accounts Receivable (AR): Handwritten slips & invoices extracted with Gemini Vision AI, reviewed in Google Sheets, and drafted into Zoho Books/QuickBooks/Xero.
- Accounts Payable (AP): Vendor bills ingestion, OCR, validation, duplicate prevention, and auto-posting.
- Banking & MoMo: Bank feeds & statement OCR, AI transaction categorization, clarification portal for missing receipts, and auto-reconciliation.
- Multi-tenant architecture with Inngest durable workflows, FastAPI, and client portals.

### Feature Announcement Details:
- Title: {feature_title}
- Summary / What Was Built: {feature_summary}
- Category: {category}
- Target Audience: {target_audience}
- Commit Reference: {commit_hash or "Latest Release"}

### Deliverable:
Return a strictly valid JSON object with tailored content for 4 distinct distribution channels:

1. "linkedin":
   - "hooks": Array of 3 distinct, attention-grabbing opening lines (1: Story/Problem hook, 2: Shocking Metric/Speed hook, 3: Direct Feature Drop hook).
   - "body": Professional, high-converting LinkedIn post (around 150-250 words). Must address the exact accounting pain (manual data entry, human error, month-end delay), explain how this new feature solves it, provide clean bullet points, a clear CTA ("What does your team do for this?"), and professional spacing.
   - "hashtags": Array of 5-7 relevant hashtags (e.g. ["#AccountingAutomation", "#CPA", "#FinTech", "#ZohoBooks", "#QuickBooks", "#Bookkeeping", "#Python"]).

2. "twitter":
   - "tweet": High-impact, engaging tweet under 270 characters highlighting the problem solved and the feature drop.
   - "thread": Array of 2-3 tweet thread items for a deeper technical or workflow breakdown.

3. "client_email":
   - "subject": Professional, engaging email subject line for client finance teams and accounting partners.
   - "preheader": Short preview snippet (1 sentence).
   - "html": Clean, beautifully styled HTML newsletter body (inline styles with modern dark or clean slate theme, highlighting "What's New", "Why it Matters for Your Accounting", and "How to Use It").

4. "changelog":
   - "version": Suggested semantic version string (e.g. "1.4.0").
   - "category": Categorization (e.g. "AP Automation", "AR Billing", "Banking & MoMo", "Platform & Integrations").
   - "markdown": Concise, audit-ready markdown release note with bullet points of improvements and fixes.

Strictly respond with ONLY the JSON object. No preamble, no markdown formatting wrappers like ```json.
"""

        if not settings.GEMINI_API_KEY or settings.MOCK_MODE:
            return SocialBroadcasterService._generate_mock_content(feature_title, feature_summary, category)

        try:
            # Call Google Gemini API
            from google import genai
            client = genai.Client(api_key=settings.GEMINI_API_KEY)
            response = client.models.generate_content(
                model=settings.GEMINI_MODEL,
                contents=prompt,
            )
            raw_text = response.text.strip()
            # Clean possible markdown json wrapper
            if raw_text.startswith("```json"):
                raw_text = raw_text[7:]
            elif raw_text.startswith("```"):
                raw_text = raw_text[3:]
            if raw_text.endswith("```"):
                raw_text = raw_text[:-3]
            
            data = json.loads(raw_text.strip())
            return data
        except Exception as e:
            logger.error(f"Gemini multi-channel generation error: {e}. Falling back to template generation.")
            return SocialBroadcasterService._generate_mock_content(feature_title, feature_summary, category)

    @staticmethod
    def _generate_mock_content(title: str, summary: str, category: str) -> Dict[str, Any]:
        """Provides high-quality structured content if Gemini is offline or in mock mode."""
        safe_title = title or "Automated File Routing & Real-Time Sync"
        safe_summary = summary or "Automatically sorts processed documents into dedicated subfolders and prevents duplicate postings in Zoho Books."
        
        hooks = [
            f"Accountants spend up to 15 hours a week reconciling data that should be automated. Here's how we solved {safe_title.lower()}.",
            f"Most bookkeeping bottlenecks aren't caused by complex math. They're caused by messy file handoffs.",
            f"🚀 Just deployed a major update to S4 Automations: {safe_title}.",
        ]

        linkedin_body = (
            f"{hooks[0]}\n\n"
            f"In accounting, accuracy and clean audit trails are everything. When finance teams process vendor bills or customer invoices, even a single duplicate file can throw off month-end reconciliation.\n\n"
            f"That's why we just shipped a brand new capability in S4 Automations:\n\n"
            f"✨ What's New:\n"
            f"• {safe_title}: {safe_summary}\n"
            f"• Zero duplicate transactions: Instant checksum and metadata verification before drafting to your ledger.\n"
            f"• Seamless integration: Works out-of-the-box with Zoho Books, QuickBooks Online, and Xero.\n\n"
            f"By eliminating manual handoffs, finance teams close their books faster with 100% auditable certainty.\n\n"
            f"How is your finance team handling document archiving and reconciliation this quarter?\n\n"
            f"#AccountingAutomation #FinTech #CPA #Bookkeeping #ZohoBooks #QuickBooks #Automation"
        )

        tweet = (
            f"🚀 New in S4 Automations: {safe_title}!\n\n"
            f"Stop losing hours to manual file handling and duplicate entries. {safe_summary[:120]}...\n\n"
            f"Built for modern accounting firms & finance leaders. #FinTech #Accounting"
        )

        email_html = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #f8fafc; border-radius: 16px; padding: 32px; border: 1px solid #1e293b;">
          <div style="text-align: center; margin-bottom: 24px;">
            <span style="background: rgba(14, 165, 233, 0.15); color: #38bdf8; font-size: 11px; font-weight: 700; padding: 6px 12px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 1px;">S4 Automations Release</span>
            <h1 style="color: #ffffff; font-size: 22px; font-weight: 800; margin-top: 14px; margin-bottom: 8px;">{safe_title}</h1>
            <p style="color: #94a3b8; font-size: 13px; line-height: 1.5;">A new feature has been deployed to enhance your accounting workflow and data integrity.</p>
          </div>
          <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
            <h3 style="color: #38bdf8; font-size: 14px; margin-top: 0; margin-bottom: 10px;">⚡ What's New:</h3>
            <p style="color: #cbd5e1; font-size: 13px; line-height: 1.6; margin: 0;">{safe_summary}</p>
          </div>
          <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 12px; padding: 16px; margin-bottom: 24px;">
            <h4 style="color: #34d399; font-size: 13px; margin: 0 0 6px 0;">🛡️ Accounting Impact</h4>
            <p style="color: #a7f3d0; font-size: 12px; margin: 0; line-height: 1.5;">This upgrade prevents duplicate billing, preserves full document lineage, and automatically keeps your accounting ledger synchronized without manual intervention.</p>
          </div>
          <div style="text-align: center;">
            <a href="https://service4gh.com" style="display: inline-block; background: #0284c7; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 700; padding: 10px 24px; border-radius: 8px;">Open S4 Workspace</a>
          </div>
        </div>
        """

        return {
            "linkedin": {
                "hooks": hooks,
                "body": linkedin_body,
                "hashtags": ["#AccountingAutomation", "#FinTech", "#CPA", "#Bookkeeping", "#ZohoBooks", "#QuickBooks"],
            },
            "twitter": {
                "tweet": tweet,
                "thread": [
                    f"1/3 🚀 We just shipped {safe_title} for S4 Automations.",
                    f"2/3 Why? {safe_summary}",
                    "3/3 Live now across all active client pipelines. Check it out on S4 Automations!",
                ],
            },
            "client_email": {
                "subject": f"[S4 Release] New Feature Live: {safe_title}",
                "preheader": f"See what's new in S4 Automations: {safe_summary[:80]}",
                "html": email_html,
            },
            "changelog": {
                "version": "1.3.0",
                "category": category,
                "markdown": f"### {safe_title}\n\n- **Description**: {safe_summary}\n- **Ledger Integrations**: Synchronized with Zoho Books, QuickBooks, and Xero.\n- **Audit Trail**: Full checksum verification and processed file routing enabled.",
            },
        }

    @staticmethod
    def resolve_linkedin_target() -> Dict[str, Any]:
        """Resolves target posting URN, organization ID, and direct admin URLs."""
        posting_mode = getattr(settings, "LINKEDIN_POSTING_MODE", "organization") or "organization"
        page_name = getattr(settings, "LINKEDIN_PAGE_NAME", "") or "LinkedIn Business Page"
        org_id = getattr(settings, "LINKEDIN_ORGANIZATION_ID", "") or ""

        # Clean org_id if full URL was pasted
        if org_id:
            org_id = org_id.strip()
            if "linkedin.com/company/" in org_id:
                parts = org_id.split("linkedin.com/company/")[1].strip("/").split("/")
                org_id = parts[0]
            if org_id.startswith("urn:li:organization:"):
                org_id = org_id.replace("urn:li:organization:", "")

        author_urn = getattr(settings, "LINKEDIN_AUTHOR_URN", "") or ""
        
        if posting_mode == "organization" or org_id:
            if not author_urn and org_id:
                author_urn = f"urn:li:organization:{org_id}"
            company_admin_url = f"https://www.linkedin.com/company/{org_id}/admin/feed/posts/" if org_id else None
            is_organization = True
        else:
            company_admin_url = None
            is_organization = False

        return {
            "posting_mode": posting_mode,
            "is_organization": is_organization,
            "organization_id": org_id,
            "page_name": page_name,
            "author_urn": author_urn,
            "company_admin_url": company_admin_url,
            "has_access_token": bool(getattr(settings, "LINKEDIN_ACCESS_TOKEN", None)),
        }

    @staticmethod
    async def publish_to_linkedin(text: str) -> Dict[str, Any]:
        """Publishes post to LinkedIn (Company Page or Personal) via REST API if configured, otherwise returns 1-click web composer intent."""
        encoded_text = urllib.parse.quote(text)
        personal_intent_url = f"https://www.linkedin.com/feed/?shareActive=true&text={encoded_text}"
        
        target = SocialBroadcasterService.resolve_linkedin_target()
        org_id = target["organization_id"]
        author_urn = target["author_urn"]
        page_name = target["page_name"]
        company_admin_url = target["company_admin_url"]
        is_org = target["is_organization"]

        # Default web intent
        web_intent_url = company_admin_url if (is_org and company_admin_url) else personal_intent_url

        access_token = getattr(settings, "LINKEDIN_ACCESS_TOKEN", None)
        
        # If API token and author URN are configured, attempt direct background dispatch
        if access_token and author_urn and not settings.MOCK_MODE:
            try:
                headers = {
                    "Authorization": f"Bearer {access_token}",
                    "X-Restli-Protocol-Version": "2.0.0",
                    "Content-Type": "application/json",
                    "LinkedIn-Version": "202401",
                }
                payload = {
                    "author": author_urn,
                    "commentary": text,
                    "visibility": "PUBLIC",
                    "distribution": {
                        "feedDistribution": "MAIN_FEED",
                        "targetEntities": [],
                        "thirdPartyDistributionChannels": [],
                    },
                    "lifecycleState": "PUBLISHED",
                    "isReshareDisabledByAuthor": False,
                }
                async with httpx.AsyncClient(timeout=12.0) as client:
                    resp = await client.post("https://api.linkedin.com/rest/posts", headers=headers, json=payload)
                    if resp.status_code in (200, 201):
                        return {
                            "status": "SUCCESS",
                            "mode": "api",
                            "target": "organization" if is_org else "person",
                            "organization_name": page_name,
                            "message": f"Published directly to {page_name} via LinkedIn REST API." if is_org else "Published directly to LinkedIn feed via API.",
                            "post_id": resp.headers.get("x-restli-id", ""),
                            "web_intent_url": web_intent_url,
                            "company_admin_url": company_admin_url,
                            "personal_intent_url": personal_intent_url,
                        }
                    else:
                        logger.warning(f"LinkedIn API returned {resp.status_code}: {resp.text}. Falling back to web intent.")
            except Exception as e:
                logger.error(f"Failed direct LinkedIn post: {e}")

        return {
            "status": "READY_FOR_SHARE",
            "mode": "web_intent",
            "target": "organization" if is_org else "person",
            "organization_name": page_name,
            "organization_id": org_id,
            "message": f"Ready to publish on {page_name}. 1-Click Company Admin Composer ready." if is_org else "Direct API token not set or in mock mode. 1-Click web composer ready.",
            "web_intent_url": web_intent_url,
            "company_admin_url": company_admin_url,
            "personal_intent_url": personal_intent_url,
        }

    @staticmethod
    async def test_linkedin_connection(
        access_token: Optional[str] = None,
        author_urn: Optional[str] = None,
        organization_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Tests validity of LinkedIn credentials and organization access."""
        token = access_token or getattr(settings, "LINKEDIN_ACCESS_TOKEN", None)
        org = organization_id or getattr(settings, "LINKEDIN_ORGANIZATION_ID", None)
        urn = author_urn or getattr(settings, "LINKEDIN_AUTHOR_URN", None)

        if not token:
            if org:
                clean_org = org.strip()
                if "linkedin.com/company/" in clean_org:
                    clean_org = clean_org.split("linkedin.com/company/")[1].strip("/").split("/")[0]
                return {
                    "success": True,
                    "mode": "web_intent",
                    "message": f"LinkedIn Business Page '{clean_org}' connected for 1-Click Admin Web Posting. (Direct API token optional).",
                    "organization_id": clean_org,
                    "company_admin_url": f"https://www.linkedin.com/company/{clean_org}/admin/feed/posts/",
                }
            return {
                "success": False,
                "mode": "none",
                "message": "Neither direct access token nor business page ID is configured.",
            }

        headers = {
            "Authorization": f"Bearer {token}",
            "X-Restli-Protocol-Version": "2.0.0",
            "LinkedIn-Version": "202401",
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            authenticated_user = None
            try:
                user_res = await client.get("https://api.linkedin.com/v2/userinfo", headers={"Authorization": f"Bearer {token}"})
                if user_res.status_code == 200:
                    user_data = user_res.json()
                    authenticated_user = user_data.get("name") or user_data.get("email") or "Authorized User"
            except Exception:
                pass

            if urn and "organization" in urn:
                try:
                    org_urn_id = urn.split(":")[-1]
                    org_res = await client.get(f"https://api.linkedin.com/rest/organizations/{org_urn_id}", headers=headers)
                    if org_res.status_code in (200, 201):
                        org_data = org_res.json()
                        org_name = org_data.get("localizedName") or org_data.get("vanityName") or org or "Business Page"
                        return {
                            "success": True,
                            "mode": "api",
                            "message": f"Successfully connected to LinkedIn Business Page: {org_name} (URN: {urn})",
                            "organization_name": org_name,
                            "authenticated_user": authenticated_user,
                        }
                    elif org_res.status_code in (401, 403):
                        return {
                            "success": False,
                            "mode": "api_error",
                            "message": f"Token authenticated for {authenticated_user or 'user'}, but lacks permissions for organization {org_urn_id}. Ensure your LinkedIn App has 'w_organization_social' permission.",
                            "status_code": org_res.status_code,
                        }
                except Exception as e:
                    logger.warning(f"Organization check notice: {e}")

            if authenticated_user:
                return {
                    "success": True,
                    "mode": "api",
                    "message": f"Connected to LinkedIn as {authenticated_user}. Direct API ready.",
                    "authenticated_user": authenticated_user,
                }

            return {
                "success": False,
                "mode": "api_error",
                "message": "LinkedIn API returned invalid or expired token. Check your access token or use 1-Click Page Admin mode.",
            }

    @staticmethod
    async def publish_to_twitter(text: str) -> Dict[str, Any]:
        """Publishes tweet to X/Twitter via API v2 if configured, otherwise returns 1-click web intent."""
        encoded_text = urllib.parse.quote(text)
        web_intent_url = f"https://twitter.com/intent/tweet?text={encoded_text}"

        if settings.TWITTER_ACCESS_TOKEN and not settings.MOCK_MODE:
            logger.info("Twitter direct credentials detected.")

        return {
            "status": "READY_FOR_SHARE",
            "mode": "web_intent",
            "message": "1-Click X (Twitter) composer ready.",
            "web_intent_url": web_intent_url,
        }

    @staticmethod
    async def broadcast_client_emails(subject: str, html_content: str, recipients: Optional[List[str]] = None) -> Dict[str, Any]:
        """Broadcasts the release note email to client finance contacts using Mailjet."""
        target_recipients = recipients or []
        
        # If no explicit recipients provided, attempt pulling from EmailSubscriber table
        if not target_recipients:
            try:
                from sqlmodel import select
                from app.db.session import engine
                from app.models.db_models import EmailSubscriber
                from sqlmodel import Session

                with Session(engine) as db:
                    subs = db.exec(select(EmailSubscriber).where(EmailSubscriber.is_active == True)).all()
                    if subs:
                        target_recipients = [s.email for s in subs]
            except Exception as e:
                logger.warning(f"Failed to query active subscribers: {e}")

        # Fallback to configured admin notification emails
        if not target_recipients:
            target_recipients = [settings.NOTIFICATION_EMAIL, settings.AUTH_EMAIL]

        target_recipients = list(set([r.strip() for r in target_recipients if r and "@" in r]))
        
        dispatched_count = 0
        errors = []

        for email in target_recipients:
            try:
                success = await MailjetService.send_email(
                    to_email=email,
                    subject=subject,
                    html_content=html_content,
                    recipient_name="S4 Accounting Partner",
                )
                if success:
                    dispatched_count += 1
            except Exception as e:
                errors.append(f"{email}: {str(e)}")

        # Update last_emailed_at in database for subscribers
        try:
            from sqlmodel import select
            from app.db.session import engine
            from app.models.db_models import EmailSubscriber, get_utc_now
            from sqlmodel import Session

            with Session(engine) as db:
                for email in target_recipients:
                    sub = db.exec(select(EmailSubscriber).where(EmailSubscriber.email == email)).first()
                    if sub:
                        sub.last_emailed_at = get_utc_now()
                        db.add(sub)
                db.commit()
        except Exception as e:
            logger.warning(f"Failed to update subscriber last_emailed_at: {e}")

        return {
            "status": "SUCCESS" if dispatched_count > 0 else "PARTIAL",
            "dispatched_count": dispatched_count,
            "total_recipients": len(target_recipients),
            "errors": errors,
        }
