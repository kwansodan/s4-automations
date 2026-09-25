"""Concrete QuickBooks Online (Intuit) Adapter for S4 Multi-Platform Engine."""

import calendar
from datetime import datetime
from typing import Dict, Any, List, Optional
from app.config import settings
from app.utils.logging import get_logger
from app.services.accounting.base import BaseAccountingAdapter, AccountingContact, AccountingItem, AccountingPostResult
from app.services.quickbooks_service import QuickBooksService

logger = get_logger("quickbooks_adapter")


class QuickBooksAdapter(BaseAccountingAdapter):
    """Production live adapter connecting to Intuit QuickBooks Online REST API."""

    def __init__(self, client_id: str, config: Optional[Dict[str, Any]] = None):
        super().__init__(client_id, config)
        realm_id = (
            self.config.get("quickbooks_realm_id")
            or self.config.get("accounting_org_id")
            or self.config.get("realm_id")
            or self.config.get("zoho_org_id")
        )
        app_client_id = self.config.get("quickbooks_client_id") or self.config.get("client_id") or settings.QUICKBOOKS_CLIENT_ID
        app_client_secret = self.config.get("quickbooks_client_secret") or self.config.get("client_secret") or settings.QUICKBOOKS_CLIENT_SECRET
        refresh_token = self.config.get("quickbooks_refresh_token") or self.config.get("refresh_token")
        is_sandbox = self.config.get("is_sandbox", settings.QUICKBOOKS_ENVIRONMENT != "production")

        self.qbo = QuickBooksService(
            realm_id=realm_id,
            client_id=app_client_id,
            client_secret=app_client_secret,
            refresh_token=refresh_token,
            is_sandbox=is_sandbox,
        )

    @property
    def platform_name(self) -> str:
        return "QuickBooks Online"

    @property
    def is_live(self) -> bool:
        return True

    async def fetch_contacts(self, contact_type: str = "customer") -> List[AccountingContact]:
        raw_contacts = await self.qbo.fetch_customers()
        return [
            AccountingContact(
                contact_id=c.get("contact_id", ""),
                contact_name=c.get("contact_name", ""),
                company_name=c.get("company_name", ""),
                email=c.get("email", ""),
                phone=c.get("phone", ""),
                currency=c.get("currency", "GHS"),
                contact_type=contact_type,
            )
            for c in raw_contacts
        ]

    async def fetch_item_catalog(self) -> List[AccountingItem]:
        raw_items = await self.qbo.fetch_items()
        return [
            AccountingItem(
                item_id=i.get("item_id", ""),
                name=i.get("name", ""),
                rate=i.get("rate", 0.0),
                sku=i.get("sku", ""),
                account_code=i.get("account_code", "4000"),
            )
            for i in raw_items
        ]

    async def post_invoice(self, payload: Dict[str, Any]) -> AccountingPostResult:
        res = await self.qbo.create_invoice(payload)
        return AccountingPostResult(
            success=res.get("success", True),
            platform=self.platform_name,
            entity_type="ar_sales_invoice",
            external_id=res.get("invoice_id", ""),
            document_number=res.get("invoice_number", ""),
            status="CREATED",
            response_payload=res,
            message=res.get("message", "Created invoice in QuickBooks Online."),
        )

    async def post_vendor_bill(self, payload: Dict[str, Any]) -> AccountingPostResult:
        res = await self.qbo.create_bill(payload)
        return AccountingPostResult(
            success=res.get("success", True),
            platform=self.platform_name,
            entity_type="ap_vendor_bill",
            external_id=res.get("bill_id", ""),
            document_number=res.get("bill_number", ""),
            status="CREATED",
            response_payload=res,
            message=res.get("message", "Created vendor bill in QuickBooks Online."),
        )

    async def post_payment(self, payload: Dict[str, Any], is_vendor_payment: bool = False) -> AccountingPostResult:
        res = await self.qbo.create_payment(payload)
        return AccountingPostResult(
            success=res.get("success", True),
            platform=self.platform_name,
            entity_type="ap_vendor_payment" if is_vendor_payment else "ar_customer_payment",
            external_id=res.get("payment_id", ""),
            document_number=res.get("reference_number", ""),
            status="CREATED",
            response_payload=res,
            message=res.get("message", "Recorded payment in QuickBooks Online."),
        )

    async def post_bank_transaction(self, payload: Dict[str, Any]) -> AccountingPostResult:
        res = await self.qbo.create_journal_entry({
            "journal_number": payload.get("reference_number", "QBO-BANK-TX"),
            "line_items": [
                {"account": payload.get("account_id", "1001"), "debit": payload.get("amount", 0.0)},
                {"account": "4000", "credit": payload.get("amount", 0.0)},
            ]
        })
        return AccountingPostResult(
            success=True,
            platform=self.platform_name,
            entity_type="bank_statement",
            external_id=res.get("journal_id", ""),
            document_number=res.get("journal_number", ""),
            status="CREATED",
            response_payload=res,
            message="Recorded bank transaction in QuickBooks Online.",
        )

    async def post_journal_entry(self, payload: Dict[str, Any]) -> AccountingPostResult:
        res = await self.qbo.create_journal_entry(payload)
        return AccountingPostResult(
            success=True,
            platform=self.platform_name,
            entity_type="gl_journal",
            external_id=res.get("journal_id", ""),
            document_number=res.get("journal_number", ""),
            status="CREATED",
            response_payload=res,
            message="Posted journal entry in QuickBooks Online.",
        )

    async def fetch_chart_of_accounts(self) -> List[Dict[str, Any]]:
        """Returns Chart of Accounts for QuickBooks Online."""
        live_accs = await self.qbo.fetch_chart_of_accounts()
        if live_accs:
            return live_accs
        if settings.MOCK_MODE:
            return [
                {"account_id": "qbo_6990", "account_code": "6990", "account_name": "Uncategorized Expense", "account_type": "Expense", "is_suspense": True},
                {"account_id": "qbo_4990", "account_code": "4990", "account_name": "Uncategorized Income", "account_type": "Income", "is_suspense": True},
                {"account_id": "qbo_850", "account_code": "850", "account_name": "Ask My Accountant", "account_type": "Other Expense", "is_suspense": True},
                {"account_id": "qbo_5100", "account_code": "5100", "account_name": "Office Expenses", "account_type": "Expense", "is_suspense": False},
                {"account_id": "qbo_5200", "account_code": "5200", "account_name": "Automobile & Fuel Expense", "account_type": "Expense", "is_suspense": False},
                {"account_id": "qbo_5300", "account_code": "5300", "account_name": "Rent & Lease", "account_type": "Expense", "is_suspense": False},
                {"account_id": "qbo_4100", "account_code": "4100", "account_name": "Sales Income", "account_type": "Income", "is_suspense": False},
                {"account_id": "qbo_1200", "account_code": "1200", "account_name": "Shareholder Distributions / Draw", "account_type": "Equity", "is_suspense": False},
            ]
        return []

    async def fetch_uncategorized_bank_transactions(
        self,
        watched_accounts: Optional[List[str]] = None,
        month: Optional[str] = None,
        year: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Discovers unmapped transactions residing in watched accounts on QuickBooks Online."""
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

        date_start = None
        date_end = None
        if target_m_num:
            days_in_m = calendar.monthrange(target_year, target_m_num)[1]
            date_start = f"{target_year}-{target_m_num:02d}-01"
            date_end = f"{target_year}-{target_m_num:02d}-{days_in_m:02d}"
        elif year:
            date_start = f"{target_year}-01-01"
            date_end = f"{target_year}-12-31"

        try:
            raw_txs = await self.qbo.fetch_uncategorized_transactions(
                watched_accounts=watched_accounts,
                date_start=date_start,
                date_end=date_end,
            )
            results = []
            for tx in (raw_txs or []):
                tx_id = str(tx.get("transaction_id", ""))
                tx_date = str(tx.get("date") or f"{target_year}-01-01")
                amt = abs(float(tx.get("amount", 0.0)))
                desc = tx.get("description") or f"QuickBooks Purchase #{tx_id}"
                results.append({
                    "transaction_date": tx_date,
                    "description": desc,
                    "amount": amt,
                    "transaction_type": tx.get("transaction_type", "DEBIT"),
                    "bank_account_name": tx.get("bank_account_name") or "QuickBooks Bank Feed",
                    "account_name": tx.get("account_name") or "Uncategorized Expense",
                    "source_file_name": "QuickBooks_Live_Sync",
                    "mapped_account_id": None,
                    "ai_suggested_account": None,
                    "category_confidence": 0.90,
                    "watched_account": tx.get("watched_account") or "6990",
                    "external_transaction_id": tx_id,
                    "qbo_transaction_id": tx_id,
                    "raw_transaction": tx.get("raw_transaction"),
                })
            return results
        except Exception as e:
            logger.error(f"Error fetching uncategorized transactions from QuickBooks: {e}")
            return []

    async def categorize_bank_transaction(
        self,
        transaction_id: str,
        account_id: str,
        payee_name: Optional[str] = None,
        tax_rate: Optional[str] = None,
    ) -> AccountingPostResult:
        """Pushes categorized line into QuickBooks."""
        try:
            res = await self.qbo.categorize_transaction(
                transaction_id=transaction_id,
                account_id=account_id,
                payee_name=payee_name,
            )
            return AccountingPostResult(
                success=res.get("success", True),
                platform=self.platform_name,
                entity_type="bank_transaction_categorized",
                document_id=transaction_id,
                message=res.get("message", f"Transaction categorized to account {account_id} on QuickBooks Online."),
                raw_response=res,
            )
        except Exception as e:
            logger.error(f"Error categorizing transaction {transaction_id} on QuickBooks Online: {e}")
            return AccountingPostResult(
                success=False,
                platform=self.platform_name,
                entity_type="bank_transaction_categorized",
                document_id=transaction_id,
                message=f"Failed to categorize on QuickBooks Online: {str(e)}",
            )
