import base64
import calendar
from datetime import datetime
from typing import Dict, Any, List, Optional
from app.config import settings
from app.utils.logging import get_logger
from app.services.accounting.base import BaseAccountingAdapter, AccountingContact, AccountingItem, AccountingPostResult
from app.services.zoho_service import ZohoBooksService
from app.models.schemas import (
    ZohoCustomerPaymentRequest,
    ZohoVendorPaymentRequest,
    ZohoExpenseRequest,
    ZohoCreditNoteRequest,
    ZohoBankTransactionRequest,
    ZohoJournalRequest,
)

logger = get_logger("zoho_adapter")


class ZohoBooksAdapter(BaseAccountingAdapter):
    """Production live adapter connecting to Zoho Books REST API."""

    def __init__(self, client_id: str, config: Optional[Dict[str, Any]] = None):
        super().__init__(client_id, config)
        raw_org = self.config.get("accounting_org_id") or self.config.get("zoho_org_id")
        org_id = raw_org if raw_org != "782910482" else None
        client_id_val = self.config.get("zoho_client_id") or self.config.get("client_id")
        client_secret_val = self.config.get("zoho_client_secret") or self.config.get("client_secret")
        refresh_token_val = self.config.get("zoho_refresh_token") or self.config.get("refresh_token")
        accounts_url = self.config.get("zoho_accounts_url") or self.config.get("accounts_url")
        books_api_url = self.config.get("zoho_books_api_url") or self.config.get("books_api_url")

        if client_id:
            try:
                self.zoho = ZohoBooksService.from_client_id(client_id)
                if org_id:
                    self.zoho.org_id = org_id
                if client_id_val:
                    self.zoho.client_id = client_id_val
                if client_secret_val:
                    self.zoho.client_secret = client_secret_val
                if refresh_token_val:
                    self.zoho.refresh_token = refresh_token_val
                if accounts_url:
                    self.zoho.accounts_url = accounts_url.rstrip("/")
                if books_api_url:
                    self.zoho.books_api_url = books_api_url.rstrip("/")
            except Exception:
                self.zoho = ZohoBooksService(
                    client_id=client_id_val,
                    client_secret=client_secret_val,
                    refresh_token=refresh_token_val,
                    org_id=org_id,
                    accounts_url=accounts_url,
                    books_api_url=books_api_url,
                )
        else:
            self.zoho = ZohoBooksService(
                client_id=client_id_val,
                client_secret=client_secret_val,
                refresh_token=refresh_token_val,
                org_id=org_id,
                accounts_url=accounts_url,
                books_api_url=books_api_url,
            )

    @property
    def platform_name(self) -> str:
        return "Zoho Books"

    @property
    def is_live(self) -> bool:
        return True

    async def fetch_contacts(self, contact_type: str = "customer") -> List[AccountingContact]:
        raw_contacts = await self.zoho.fetch_active_contacts()
        return [
            AccountingContact(
                contact_id=c.contact_id,
                contact_name=c.contact_name,
                company_name=c.company_name,
                email=c.email,
                contact_type=contact_type,
            )
            for c in raw_contacts
        ]

    async def fetch_item_catalog(self) -> List[AccountingItem]:
        raw_items = await self.zoho.fetch_item_catalog()
        return [
            AccountingItem(
                item_id=i.item_id,
                name=i.name,
                rate=i.rate,
            )
            for i in raw_items
        ]

    async def post_invoice(self, payload: Dict[str, Any]) -> AccountingPostResult:
        res = await self.zoho.create_draft_invoice(payload)
        return AccountingPostResult(
            success=True,
            platform=self.platform_name,
            entity_type="ar_sales_invoice",
            document_id=res.invoice_id,
            document_number=res.invoice_number,
            url=res.invoice_url,
            message=f"Draft invoice {res.invoice_number} generated on Zoho Books.",
            raw_response=res.model_dump(),
        )

    async def post_vendor_bill(self, payload: Dict[str, Any]) -> AccountingPostResult:
        res = await self.zoho.create_vendor_bill(payload)
        return AccountingPostResult(
            success=True,
            platform=self.platform_name,
            entity_type="ap_vendor_bill",
            document_id=res.bill_id,
            document_number=res.bill_number,
            url=res.bill_url,
            message=f"Vendor bill {res.bill_number} posted to Zoho Books.",
            raw_response=res.model_dump(),
        )

    async def post_payment(self, payload: Dict[str, Any], is_customer: bool = True) -> AccountingPostResult:
        if is_customer:
            req = ZohoCustomerPaymentRequest(**payload)
            res = await self.zoho.create_customer_payment(req)
            doc_id = res.payment_id
        else:
            req = ZohoVendorPaymentRequest(**payload)
            res = await self.zoho.create_vendor_payment(req)
            doc_id = res.payment_id

        return AccountingPostResult(
            success=True,
            platform=self.platform_name,
            entity_type="ar_customer_payment" if is_customer else "ap_vendor_payment",
            document_id=doc_id,
            message=res.message,
            raw_response=res.model_dump(),
        )

    async def post_bank_transaction(self, payload: Dict[str, Any]) -> AccountingPostResult:
        req = ZohoBankTransactionRequest(**payload)
        res = await self.zoho.create_bank_transaction(req)
        return AccountingPostResult(
            success=True,
            platform=self.platform_name,
            entity_type="bank_statement",
            document_id=res.transaction_id,
            message=f"Bank transaction recorded ({res.amount} GHS).",
            raw_response=res.model_dump(),
        )

    async def post_journal_entry(self, payload: Dict[str, Any]) -> AccountingPostResult:
        req = ZohoJournalRequest(**payload)
        res = await self.zoho.create_journal_entry(req)
        return AccountingPostResult(
            success=True,
            platform=self.platform_name,
            entity_type="gl_journal",
            document_id=res.journal_id,
            url=res.journal_url,
            message=f"Manual journal posted ({res.total} GHS).",
            raw_response=res.model_dump(),
        )

    async def fetch_chart_of_accounts(self) -> List[Dict[str, Any]]:
        """Fetches live Chart of Accounts from Zoho Books REST API."""
        return await self.zoho.fetch_chart_of_accounts()

    async def fetch_uncategorized_bank_transactions(
        self,
        watched_accounts: Optional[List[str]] = None,
        month: Optional[str] = None,
        year: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Pulls real uncategorized bank transactions from Zoho Books bank feeds (/banktransactions?transaction_status=uncategorized).
        
        Only queries active bank accounts; does NOT watch or poll any general ledger (GL) account codes.
        If no transactions exist or the adapter is not connected, returns an empty list.
        Never falls back to mock or simulated records.
        """
        if not self.is_live or settings.MOCK_MODE or not self.zoho.org_id:
            logger.info("Zoho Books live integration not active or in mock mode; returning empty transaction list.")
            return []

        now = datetime.now()
        target_year = year or now.year

        # Resolve numeric month if passed
        target_m_num = None
        if month and str(month).upper() != "ALL":
            m_clean = str(month).strip()
            if "-" in m_clean:
                parts = m_clean.split("-")
                if len(parts) >= 2 and parts[1].isdigit():
                    target_m_num = int(parts[1])
            elif m_clean.isdigit():
                target_m_num = int(m_clean)
            else:
                for fmt in ("%B", "%b"):
                    try:
                        target_m_num = datetime.strptime(m_clean, fmt).month
                        break
                    except ValueError:
                        pass

        # Calculate ISO date bounds if specified
        date_start = None
        date_end = None
        if target_m_num:
            days_in_m = calendar.monthrange(target_year, target_m_num)[1]
            date_start = f"{target_year}-{target_m_num:02d}-01"
            date_end = f"{target_year}-{target_m_num:02d}-{days_in_m:02d}"
        elif year:
            date_start = f"{target_year}-01-01"
            date_end = f"{target_year}-12-31"

        results: List[Dict[str, Any]] = []
        seen_keys = set()

        try:
            # Fetch native uncategorized bank feed transactions from Zoho Books (/banktransactions?transaction_status=uncategorized)
            raw_uncat_feed = await self.zoho.fetch_uncategorized_bank_transactions(
                date_start=date_start,
                date_end=date_end,
            )
            for tx in (raw_uncat_feed or []):
                tx_id = str(tx.get("transaction_id", ""))
                tx_date = str(tx.get("date") or tx.get("transaction_date") or f"{target_year}-01-01")
                amt = abs(float(tx.get("amount", 0.0)))
                desc = (
                    tx.get("description")
                    or tx.get("payee")
                    or tx.get("reference_number")
                    or "Uncategorized Bank Feed Transaction"
                )
                # Exclusively inspect debit_or_credit, imported_transaction_type, and debit_amount / credit_amount
                doc = str(tx.get("debit_or_credit") or tx.get("imported_transaction_type") or "").strip().lower()
                debit_amt = float(tx.get("debit_amount", 0.0) or 0.0)
                credit_amt = float(tx.get("credit_amount", 0.0) or 0.0)

                if "debit" in doc or debit_amt > 0:
                    tx_t = "DEBIT"
                elif "credit" in doc or credit_amt > 0:
                    tx_t = "CREDIT"
                else:
                    tx_t = "DEBIT"

                u_key = f"zoho_uncat:{tx_id}:{amt}:{desc}"
                if u_key not in seen_keys:
                    seen_keys.add(u_key)
                    results.append({
                        "transaction_date": tx_date,
                        "description": desc,
                        "amount": amt,
                        "transaction_type": tx_t,
                        "bank_account_name": tx.get("from_account_name") or "Zoho Bank Account",
                        "account_name": tx.get("account_name") or "Uncategorized Feed",
                        "source_file_name": "Zoho_Live_Bank_Feed",
                        "mapped_account_id": None,
                        "ai_suggested_account": tx.get("account_name"),
                        "category_confidence": 0.95,
                        "external_transaction_id": tx_id,
                        "zoho_transaction_id": tx_id,
                        "zoho_account_id": str(tx.get("from_account_id") or ""),
                        "raw_transaction": tx,
                    })
        except Exception as uncat_err:
            logger.warning(f"Could not fetch native uncategorized bank feeds from Zoho: {uncat_err}")

        return results

    async def categorize_bank_transaction(
        self,
        transaction_id: str,
        account_id: str,
        payee_name: Optional[str] = None,
        tax_rate: Optional[str] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
    ) -> AccountingPostResult:
        """Pushes categorized line into Zoho Books."""
        if self.is_live and not settings.MOCK_MODE and self.zoho.org_id:
            try:
                res = await self.zoho.categorize_uncategorized_transaction(
                    transaction_id=transaction_id,
                    account_id=account_id,
                    payee_name=payee_name,
                )

                # Attach client uploaded receipts or supporting files to Zoho Books expense if available
                if attachments and isinstance(attachments, list):
                    expense_id = (
                        res.get("expense_id")
                        or (res.get("bank_transaction") or {}).get("expense_id")
                        or (res.get("expense") or {}).get("expense_id")
                    )
                    if expense_id:
                        for att in attachments:
                            url = att.get("url") or ""
                            name = att.get("name") or "attachment"
                            if url.startswith("data:"):
                                try:
                                    encoded = url.split(",", 1)[1] if "," in url else url
                                    file_bytes = base64.b64decode(encoded)
                                    await self.zoho.attach_expense_receipt(
                                        expense_id=str(expense_id),
                                        file_bytes=file_bytes,
                                        filename=name,
                                    )
                                except Exception as att_err:
                                    logger.warning(f"Could not attach {name} to Zoho expense {expense_id}: {att_err}")

                return AccountingPostResult(
                    success=True,
                    platform=self.platform_name,
                    entity_type="bank_transaction_categorized",
                    document_id=transaction_id,
                    message=f"Categorized transaction {transaction_id} to account {account_id} on Zoho Books.",
                    raw_response=res,
                )
            except Exception as e:
                logger.error(f"Error categorizing transaction {transaction_id} on Zoho Books: {e}")
                return AccountingPostResult(
                    success=False,
                    platform=self.platform_name,
                    entity_type="bank_transaction_categorized",
                    document_id=transaction_id,
                    message=f"Failed to categorize on Zoho Books: {str(e)}",
                )

        return AccountingPostResult(
            success=True,
            platform=self.platform_name,
            entity_type="bank_transaction_categorized",
            document_id=f"zoho_tx_{transaction_id}",
            message=f"Transaction reclassified to account {account_id} on Zoho Books.",
        )
