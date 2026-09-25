"""Pipeline Alert Service for S4 Automations.

Sends actionable, styled HTML email notifications when an ingestion pipeline
places a transaction or document on PENDING due to Zoho API contract validation failure.
"""

from typing import Any, Optional
from app.services.mailjet_service import MailjetService
from app.models.schemas import ContractValidationResult
from app.config import settings
from app.utils.logging import get_logger

logger = get_logger("pipeline_alert_service")


class PipelineAlertService:
    """Dispatches actionable alert emails when an ingestion pipeline is placed on pending."""

    @classmethod
    async def send_contract_failure_alert(
        cls,
        client_name: str,
        pipeline_name: str,
        entity_type: str,
        source_file_name: str,
        validation_result: ContractValidationResult,
        staged_batch_id: str,
        client_id: Optional[str] = None,
        recipient_email: Optional[str] = None,
    ) -> bool:
        """Dispatches an email alert to the lead admin/accountant and subscribed CFO/team stakeholders."""
        target_email = recipient_email or settings.NOTIFICATION_EMAIL or "cdanso@service4gh.com"
        subject = f"🚨 [Action Required] Pipeline Held: {client_name} - {pipeline_name} ({entity_type})"

        # Generate styled HTML list of issues
        issues_html = ""
        for iss in validation_result.issues:
            val_display = (
                f"<div style='font-size: 11px; color: #64748b; margin-top: 4px;'>Extracted Value: <code style='background: #f1f5f9; padding: 2px 6px; border-radius: 4px; color: #0f172a; font-family: monospace;'>{iss.received_value}</code></div>"
                if iss.received_value is not None
                else ""
            )
            is_crit = iss.severity == "CRITICAL"
            bg_color = "#fff1f2" if is_crit else "#fffbeb"
            border_color = "#fecdd3" if is_crit else "#fde68a"
            accent_color = "#e11d48" if is_crit else "#d97706"
            issues_html += f"""
            <li style="margin-bottom: 12px; background: {bg_color}; padding: 12px 14px; border-radius: 8px; border: 1px solid {border_color}; border-left: 4px solid {accent_color};">
                <div style="font-weight: 700; color: {accent_color}; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">
                    [{iss.severity}] {iss.error_type} (Field: <code>{iss.field_name}</code>)
                </div>
                <div style="color: #334155; font-size: 13px; margin-top: 4px; line-height: 1.4;">{iss.message}</div>
                {val_display}
            </li>
            """

        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #0f172a; margin: 0; padding: 32px 16px; }}
                .card {{ background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; max-width: 620px; margin: 0 auto; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }}
                .header {{ background-color: #ffffff; padding: 28px 28px 20px 28px; border-bottom: 1px solid #e2e8f0; }}
                .badge {{ display: inline-block; background-color: #fff1f2; border: 1px solid #fecdd3; color: #e11d48; font-size: 11px; font-weight: 700; padding: 5px 12px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }}
                .title {{ font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 6px 0; letter-spacing: -0.01em; }}
                .subtitle {{ color: #64748b; font-size: 13px; margin: 0; line-height: 1.5; }}
                .content {{ padding: 24px 28px; }}
                .info-grid {{ background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 20px; margin-bottom: 24px; }}
                .info-row {{ display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; font-size: 13px; }}
                .info-row:last-child {{ border-bottom: none; }}
                .info-label {{ color: #64748b; font-weight: 500; }}
                .info-val {{ color: #0f172a; font-weight: 600; text-align: right; }}
                .issues-list {{ list-style-type: none; padding: 0; margin: 12px 0 24px 0; }}
                .btn {{ display: inline-block; background-color: #0284c7; color: #ffffff; font-weight: 600; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; text-align: center; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); }}
                .footer {{ background-color: #f8fafc; padding: 16px 28px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; }}
            </style>
        </head>
        <body>
            <div class="card">
                <div class="header">
                    <span class="badge">Pipeline Held on Pending</span>
                    <h1 class="title">Zoho API Contract Validation Failure</h1>
                    <p class="subtitle">Document ingestion quarantined. Manual review or data correction required.</p>
                </div>
                <div class="content">
                    <div class="info-grid">
                        <div class="info-row"><span class="info-label">Client Organization:</span><span class="info-val">{client_name}</span></div>
                        <div class="info-row"><span class="info-label">Pipeline:</span><span class="info-val" style="color: #0284c7;">{pipeline_name}</span></div>
                        <div class="info-row"><span class="info-label">Target Zoho Entity:</span><span class="info-val" style="color: #4338ca;">{entity_type}</span></div>
                        <div class="info-row"><span class="info-label">Source Document:</span><span class="info-val">{source_file_name}</span></div>
                        <div class="info-row"><span class="info-label">Staged Batch ID:</span><span class="info-val" style="font-family: monospace; font-size: 11px;">{staged_batch_id}</span></div>
                    </div>

                    <h3 style="color: #0f172a; font-size: 13px; font-weight: 700; margin: 20px 0 10px 0; text-transform: uppercase; letter-spacing: 0.05em;">Unresolved Zoho API Discrepancies ({len(validation_result.issues)}):</h3>
                    <ul class="issues-list">
                        {issues_html}
                    </ul>

                    <div style="text-align: center; margin-top: 24px;">
                        <a href="{settings.APP_BASE_URL}" class="btn">Open S4 Ledger &amp; Fix Discrepancies &rarr;</a>
                    </div>
                </div>
                <div class="footer">
                    Sent automatically by S4 Automations Engine &bull; Zero malformed data guarantee for Zoho Books API.
                </div>
            </div>
        </body>
        </html>
        """

        plain_text = (
            f"S4 PIPELINE HELD ON PENDING: {client_name} - {pipeline_name} ({entity_type})\n"
            f"Source Document: {source_file_name}\n"
            f"Discrepancies found: {len(validation_result.issues)}\n"
            f"Please visit the S4 Automations workspace to review and resolve."
        )

        try:
            success = await MailjetService.send_email(
                to_email=target_email,
                subject=subject,
                html_content=html_content,
                text_content=plain_text,
                recipient_name=client_name,
            )
            if success:
                logger.info(f"✅ Dispatched pipeline failure alert for '{client_name}' to {target_email}")
            else:
                logger.warning(f"Could not dispatch pipeline alert email to {target_email}")

            # Also dispatch anomaly alerts to configured organization stakeholders (e.g. CFO, Controller)
            if client_id:
                try:
                    from app.db.session import get_engine
                    from sqlmodel import Session, select
                    from app.models.db_models import ClientOrganization

                    with Session(get_engine()) as session:
                        client_org = session.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
                        if client_org and client_org.team_members:
                            for tm in client_org.team_members:
                                notifs = tm.get("notifications", {})
                                tm_email = tm.get("email")
                                if notifs.get("critical_anomalies") and tm_email and tm_email != target_email:
                                    await MailjetService.send_email(
                                        to_email=tm_email,
                                        subject=subject,
                                        html_content=html_content,
                                        text_content=plain_text,
                                        recipient_name=tm.get("name", client_name),
                                    )
                                    logger.info(f"✅ Dispatched critical anomaly alert to stakeholder: {tm.get('name')} ({tm_email})")
                except Exception as ex:
                    logger.warning(f"Could not dispatch stakeholder alerts for client '{client_id}': {ex}")

            return success
        except Exception as e:
            logger.error(f"Error dispatching pipeline alert email: {e}")
            return False
