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
        recipient_email: Optional[str] = None,
    ) -> bool:
        """Dispatches an email alert to the lead admin/accountant regarding contract validation failure."""
        target_email = recipient_email or settings.NOTIFICATION_EMAIL or "cdanso@service4gh.com"
        subject = f"🚨 [Action Required] Pipeline Held: {client_name} - {pipeline_name} ({entity_type})"

        # Generate styled HTML list of issues
        issues_html = ""
        for iss in validation_result.issues:
            val_display = (
                f"<div style='font-size: 11px; color: #94a3b8; margin-top: 2px;'>Extracted Value: <code>{iss.received_value}</code></div>"
                if iss.received_value is not None
                else ""
            )
            color = "#ef4444" if iss.severity == "CRITICAL" else "#f59e0b"
            issues_html += f"""
            <li style="margin-bottom: 12px; background: rgba(30, 41, 59, 0.7); padding: 10px; border-radius: 6px; border-left: 3px solid {color};">
                <div style="font-weight: bold; color: {color}; font-size: 12px; text-transform: uppercase;">
                    [{iss.severity}] {iss.error_type} (Field: <code>{iss.field_name}</code>)
                </div>
                <div style="color: #e2e8f0; font-size: 13px; margin-top: 4px;">{iss.message}</div>
                {val_display}
            </li>
            """

        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #f8fafc; margin: 0; padding: 20px; }}
                .card {{ background-color: #111827; border: 1px solid #1f2937; border-radius: 12px; max-width: 620px; margin: 0 auto; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5); }}
                .header {{ background: linear-gradient(135deg, #1e1b4b 0%, #311042 100%); padding: 24px; border-bottom: 1px solid #374151; }}
                .badge {{ display: inline-block; background-color: #ef4444; color: #ffffff; font-size: 11px; font-weight: bold; padding: 4px 8px; border-radius: 4px; text-transform: uppercase; margin-bottom: 8px; }}
                .title {{ font-size: 20px; font-weight: bold; color: #ffffff; margin: 0 0 4px 0; }}
                .subtitle {{ color: #94a3b8; font-size: 13px; margin: 0; }}
                .content {{ padding: 24px; }}
                .info-grid {{ background-color: #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 20px; }}
                .info-row {{ display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #334155; font-size: 13px; }}
                .info-row:last-child {{ border-bottom: none; }}
                .info-label {{ color: #94a3b8; }}
                .info-val {{ color: #f8fafc; font-weight: 600; text-align: right; }}
                .issues-list {{ list-style-type: none; padding: 0; margin: 12px 0 24px 0; }}
                .btn {{ display: inline-block; background-color: #2563eb; color: #ffffff; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 14px; text-align: center; }}
                .footer {{ background-color: #0f172a; padding: 16px 24px; border-top: 1px solid #1f2937; font-size: 12px; color: #64748b; text-align: center; }}
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
                        <div class="info-row"><span class="info-label">Pipeline:</span><span class="info-val" style="color: #38bdf8;">{pipeline_name}</span></div>
                        <div class="info-row"><span class="info-label">Target Zoho Entity:</span><span class="info-val" style="color: #a78bfa;">{entity_type}</span></div>
                        <div class="info-row"><span class="info-label">Source Document:</span><span class="info-val">{source_file_name}</span></div>
                        <div class="info-row"><span class="info-label">Staged Batch ID:</span><span class="info-val" style="font-family: monospace; font-size: 11px;">{staged_batch_id}</span></div>
                    </div>

                    <h3 style="color: #f8fafc; font-size: 14px; margin: 16px 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px;">Unresolved Zoho API Discrepancies ({len(validation_result.issues)}):</h3>
                    <ul class="issues-list">
                        {issues_html}
                    </ul>

                    <div style="text-align: center; margin-top: 24px;">
                        <a href="http://localhost:5173" class="btn">Open S4 Ledger & Fix Discrepancies →</a>
                    </div>
                </div>
                <div class="footer">
                    Sent automatically by S4 Automations Engine • Zero malformed data guarantee for Zoho Books API.
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
            return success
        except Exception as e:
            logger.error(f"Error dispatching pipeline alert email: {e}")
            return False
