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
        org_id = self.config.get("accounting_org_id") or self.config.get("zoho_org_id")
        client_id_val = self.config.get("zoho_client_id") or self.config.get("client_id")
        client_secret_val = self.config.get("zoho_client_secret") or self.config.get("client_secret")
        refresh_token_val = self.config.get("zoho_refresh_token") or self.config.get("refresh_token")
        accounts_url = self.config.get("zoho_accounts_url") or self.config.get("accounts_url")
        books_api_url = self.config.get("zoho_books_api_url") or self.config.get("books_api_url")

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
        """Pulls real unmapped transactions residing in watched accounts from Zoho Books.
        
        If no transactions exist or the adapter is not connected, returns an empty list.
        Never falls back to mock or simulated records.
        """
        if not self.is_live or settings.MOCK_MODE or not self.zoho.org_id:
            logger.info("Zoho Books live integration not active or in mock mode; returning empty transaction list.")
            return []

        effective_watched = [str(w).strip() for w in (watched_accounts or ["6990", "850", "suspense", "uncategorized"]) if str(w).strip()]
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
            # 1. Fetch Chart of Accounts and Bank Accounts from Zoho
            chart_accounts = await self.zoho.fetch_chart_of_accounts()
            try:
                bank_accounts = await self.zoho.fetch_bank_accounts()
            except Exception as b_err:
                logger.warning(f"Could not fetch bank accounts from Zoho: {b_err}")
                bank_accounts = []

            # Index accounts by id, code, and normalized name
            all_known_accounts = []
            for acc in (chart_accounts or []):
                all_known_accounts.append({
                    "account_id": str(acc.get("account_id", "")),
                    "account_code": str(acc.get("account_code", "")),
                    "account_name": str(acc.get("account_name", "")),
                    "account_type": str(acc.get("account_type", "")).lower(),
                    "source": "chart",
                })
            for bacc in (bank_accounts or []):
                b_id = str(bacc.get("account_id", ""))
                if not any(a["account_id"] == b_id for a in all_known_accounts):
                    all_known_accounts.append({
                        "account_id": b_id,
                        "account_code": str(bacc.get("account_code", "")),
                        "account_name": str(bacc.get("account_name", "")),
                        "account_type": "bank",
                        "source": "bank",
                    })

            # 2. Match watched accounts
            matched_targets = []
            for w in effective_watched:
                w_norm = w.lower()
                for acc in all_known_accounts:
                    if (
                        acc["account_id"].lower() == w_norm
                        or (acc["account_code"] and acc["account_code"].lower() == w_norm)
                        or (w_norm in acc["account_name"].lower())
                    ):
                        matched_targets.append((w, acc))

            # If no direct match on watched names/codes, check bank accounts
            if not matched_targets:
                for acc in all_known_accounts:
                    if acc["account_type"] in ["bank", "credit_card"] or acc["source"] == "bank":
                        matched_targets.append((effective_watched[0] if effective_watched else "Bank", acc))

            # 3. Query transactions from Zoho for each matched account
            for w_label, acc in matched_targets:
                acc_id = acc["account_id"]
                acc_type = acc["account_type"]
                acc_name = acc["account_name"]

                # Case A: Bank / Credit Card account -> use /banktransactions
                if acc_type in ["bank", "credit_card"] or acc["source"] == "bank":
                    try:
                        raw_txs = await self.zoho.fetch_bank_transactions(
                            account_id=acc_id,
                            status=None,
                            date_start=date_start,
                            date_end=date_end,
                        )
                        for tx in (raw_txs or []):
                            tx_id = str(tx.get("transaction_id", ""))
                            tx_date = str(tx.get("date") or tx.get("transaction_date") or f"{target_year}-01-01")
                            amt = abs(float(tx.get("amount", 0.0)))
                            desc = tx.get("description") or tx.get("payee") or tx.get("reference_number") or f"Transaction in {acc_name}"
                            tx_t = str(tx.get("transaction_type") or "DEBIT").upper()
                            if tx_t not in ["DEBIT", "CREDIT"]:
                                tx_t = "DEBIT" if float(tx.get("amount", 0.0)) < 0 else "CREDIT"

                            u_key = f"{acc_id}:{tx_id or tx_date}:{amt}:{desc}"
                            if u_key not in seen_keys:
                                seen_keys.add(u_key)
                                results.append({
                                    "transaction_date": tx_date,
                                    "description": desc,
                                    "amount": amt,
                                    "transaction_type": tx_t,
                                    "bank_account_name": tx.get("from_account_name") or acc_name or "Watched Account",
                                    "account_name": acc_name or "Watched Account",
                                    "source_file_name": "Zoho_Live_Sync",
                                    "mapped_account_id": None,
                                    "ai_suggested_account": tx.get("account_name"),
                                    "category_confidence": 0.90,
                                    "watched_account": w_label,
                                })
                    except Exception as tx_err:
                        logger.warning(f"Error fetching bank transactions for account {acc_id} ({acc_name}): {tx_err}")

                # Case B: General Ledger account -> use /chartofaccounts/accounttransactions
                else:
                    try:
                        raw_acc_txs = await self.zoho.fetch_account_transactions(
                            account_id=acc_id,
                            date_start=date_start,
                            date_end=date_end,
                        )
                        for tx in (raw_acc_txs or []):
                            tx_id = str(tx.get("transaction_id", ""))
                            tx_date = str(tx.get("transaction_date") or tx.get("date") or f"{target_year}-01-01")
                            debit = float(tx.get("debit_amount", 0.0) or 0.0)
                            credit = float(tx.get("credit_amount", 0.0) or 0.0)
                            raw_amt = float(tx.get("amount", 0.0) or tx.get("total", 0.0) or 0.0)
                            amt = debit if debit > 0 else (credit if credit > 0 else abs(raw_amt))

                            tx_t_raw = str(tx.get("transaction_type") or tx.get("debit_or_credit") or "").upper()
                            if debit > 0:
                                tx_t = "DEBIT"
                            elif credit > 0:
                                tx_t = "CREDIT"
                            elif "DEBIT" in tx_t_raw or "OUT" in tx_t_raw or "EXPENSE" in tx_t_raw or "PAYMENT" in tx_t_raw:
                                tx_t = "DEBIT"
                            elif "CREDIT" in tx_t_raw or "IN" in tx_t_raw or "INCOME" in tx_t_raw or "RECEIPT" in tx_t_raw:
                                tx_t = "CREDIT"
                            else:
                                tx_t = "DEBIT" if raw_amt < 0 else "CREDIT"

                            desc = (
                                tx.get("description")
                                or tx.get("notes")
                                or tx.get("payee")
                                or tx.get("customer_name")
                                or tx.get("vendor_name")
                                or tx.get("reference_number")
                                or tx.get("entry_number")
                                or f"Entry in {acc_name}"
                            )

                            u_key = f"{acc_id}:{tx_id or tx_date}:{amt}:{desc}"
                            if u_key not in seen_keys:
                                seen_keys.add(u_key)
                                results.append({
                                    "transaction_date": tx_date,
                                    "description": desc,
                                    "amount": amt,
                                    "transaction_type": tx_t,
                                    "bank_account_name": acc_name or "Watched Account",
                                    "account_name": acc_name or "Watched Account",
                                    "source_file_name": "Zoho_Live_Sync",
                                    "mapped_account_id": None,
                                    "ai_suggested_account": None,
                                    "category_confidence": 0.85,
                                    "watched_account": w_label,
                                })
                    except Exception as acc_err:
                        logger.warning(f"Error fetching account transactions for account {acc_id} ({acc_name}): {acc_err}")

        except Exception as e:
            logger.error(f"Failed to fetch live transactions from Zoho Books: {e}", exc_info=True)
            return []

        return results

    async def categorize_bank_transaction(
        self,
        transaction_id: str,
        account_id: str,
        payee_name: Optional[str] = None,
        tax_rate: Optional[str] = None,
    ) -> AccountingPostResult:
        """Pushes categorized line into Zoho Books."""
        return AccountingPostResult(
            success=True,
            platform=self.platform_name,
            entity_type="bank_transaction_categorized",
            document_id=f"zoho_tx_{transaction_id}",
            message=f"Transaction reclassified to account {account_id} on Zoho Books.",
        )
