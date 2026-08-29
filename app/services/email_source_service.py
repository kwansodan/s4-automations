"""Email Ingestion Source Service for S4 Automations."""

import imaplib
import email
from email.header import decode_header
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

from app.config import settings
from app.utils.logging import get_logger

logger = get_logger("email_source")


class EmailSourceService:
    """Discovers and extracts PDF and image invoice attachments from client inboxes."""

    def __init__(
        self,
        host: Optional[str] = None,
        port: int = 993,
        username: Optional[str] = None,
        password: Optional[str] = None,
    ):
        self.host = host or settings.SMTP_HOST
        self.port = port
        self.username = username or settings.SMTP_USER
        self.password = password or settings.SMTP_PASSWORD

    def fetch_unprocessed_attachments(
        self,
        folder: str = "INBOX",
        subject_filter: Optional[str] = None,
        allowed_extensions: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Polls IMAP server for unread emails with attachments.
        Returns list of extracted files with metadata and raw bytes.
        """
        extensions = allowed_extensions or [".pdf", ".png", ".jpg", ".jpeg", ".csv"]
        
        # Development / Mock fallback when IMAP credentials are not yet configured
        if not self.host or not self.username or not self.password or settings.MOCK_MODE:
            logger.info("IMAP credentials not configured or running in Mock Mode. Returning simulated email attachments.")
            return [
                {
                    "file_name": "Supplier_Invoice_INV-88912.pdf",
                    "sender_email": "billing@apexlogistics.com",
                    "subject": "Monthly Freight & Clearing Invoice INV-88912",
                    "received_date": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
                    "mime_type": "application/pdf",
                    "file_bytes": b"%PDF-1.4 simulated pdf bytes",
                    "metadata": {
                        "message_id": "<msg_apex_88912@apexlogistics.com>",
                        "vendor_name": "Apex Logistics Ghana Ltd",
                        "po_number": "PO-2026-081",
                    },
                }
            ]

        extracted_attachments = []
        try:
            mail = imaplib.IMAP4_SSL(self.host, self.port)
            mail.login(self.username, self.password)
            mail.select(folder)

            search_criteria = "UNSEEN"
            if subject_filter:
                search_criteria += f' SUBJECT "{subject_filter}"'

            status, messages = mail.search(None, search_criteria)
            email_ids = messages[0].split()

            logger.info(f"Discovered {len(email_ids)} unread emails matching criteria in {folder}.")

            for e_id in email_ids:
                res, msg_data = mail.fetch(e_id, "(RFC822)")
                for response_part in msg_data:
                    if isinstance(response_part, tuple):
                        msg = email.message_from_bytes(response_part[1])
                        subject, encoding = decode_header(msg.get("Subject", ""))[0]
                        if isinstance(subject, bytes):
                            subject = subject.decode(encoding or "utf-8", errors="ignore")

                        sender = msg.get("From", "")
                        date_str = msg.get("Date", "")

                        for part in msg.walk():
                            if part.get_content_maintype() == "multipart":
                                continue
                            if part.get("Content-Disposition") is None:
                                continue

                            filename = part.get_filename()
                            if filename:
                                filename_decoded, enc = decode_header(filename)[0]
                                if isinstance(filename_decoded, bytes):
                                    filename = filename_decoded.decode(enc or "utf-8", errors="ignore")

                                if any(filename.lower().endswith(ext) for ext in extensions):
                                    file_data = part.get_payload(decode=True)
                                    extracted_attachments.append({
                                        "file_name": filename,
                                        "sender_email": sender,
                                        "subject": subject,
                                        "received_date": date_str,
                                        "mime_type": part.get_content_type(),
                                        "file_bytes": file_data,
                                        "metadata": {
                                            "email_id": e_id.decode(),
                                            "message_id": msg.get("Message-ID", ""),
                                        },
                                    })

            mail.close()
            mail.logout()
        except Exception as e:
            logger.error(f"Error fetching email attachments via IMAP: {e}")

        return extracted_attachments
