"""Concrete Xero Adapter for S4 Multi-Platform Engine."""

import calendar
from datetime import datetime
from typing import Dict, Any, List, Optional
from app.config import settings
from app.utils.logging import get_logger
from app.services.accounting.base import BaseAccountingAdapter, AccountingContact, AccountingItem, AccountingPostResult
from app.services.xero_service import XeroService

logger = get_logger("xero_adapter")


class XeroAdapter(BaseAccountingAdapter):
    """Production live adapter connecting to Xero Accounting API v2.0."""

    def __init__(self, client_id: str, config: Optional[Dict[str, Any]] = None):
        super().__init__(client_id, config)
        tenant_id = (
            self.config.get("xero_tenant_id")
            or self.config.get("accounting_org_id")
            or self.config.get("tenant_id")
            or self.config.get("zoho_org_id")
        )
        app_client_id = self.config.get("xero_client_id") or self.config.get("client_id") or settings.XERO_CLIENT_ID
        app_client_secret = self.config.get("xero_client_secret") or self.config.get("client_secret") or settings.XERO_CLIENT_SECRET
        refresh_token = self.config.get("xero_refresh_token") or self.config.get("refresh_token")

        self.xero = XeroService(
            tenant_id=tenant_id,
            client_id=app_client_id,
            client_secret=app_client_secret,
            refresh_token=refresh_token,
        )

    @property
    def platform_name(self) -> str:
        return "Xero"

    @property
    def is_live(self) -> bool:
        return True

    async def fetch_contacts(self, contact_type: str = "customer") -> List[AccountingContact]:
        raw_contacts = await self.xero.fetch_contacts()
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
        raw_items = await self.xero.fetch_items()
        return [
            AccountingItem(
                item_id=i.get("item_id", ""),
                name=i.get("name", ""),
                rate=i.get("rate", 0.0),
                sku=i.get("sku", ""),
                account_code=i.get("account_code", "200"),
            )
            for i in raw_items
        ]

    async def post_invoice(self, payload: Dict[str, Any]) -> AccountingPostResult:
        res = await self.xero.create_invoice(payload)
        return AccountingPostResult(
            success=res.get("success", True),
            platform=self.platform_name,
            entity_type="ar_sales_invoice",
            external_id=res.get("invoice_id", ""),
            document_number=res.get("invoice_number", ""),
            status="CREATED",
            response_payload=res,
            message=res.get("message", "Created invoice in Xero."),
        )

    async def post_vendor_bill(self, payload: Dict[str, Any]) -> AccountingPostResult:
        res = await self.xero.create_bill(payload)
        return AccountingPostResult(
            success=res.get("success", True),
            platform=self.platform_name,
            entity_type="ap_vendor_bill",
            external_id=res.get("bill_id", ""),
            document_number=res.get("bill_number", ""),
            status="CREATED",
            response_payload=res,
            message=res.get("message", "Created vendor bill in Xero."),
        )

    async def post_payment(self, payload: Dict[str, Any], is_vendor_payment: bool = False) -> AccountingPostResult:
        res = await self.xero.create_payment(payload)
        return AccountingPostResult(
            success=res.get("success", True),
            platform=self.platform_name,
            entity_type="ap_vendor_payment" if is_vendor_payment else "ar_customer_payment",
            external_id=res.get("payment_id", ""),
            document_number=payload.get("reference_number", "XERO-PMT"),
            status="CREATED",
            response_payload=res,
            message=res.get("message", "Recorded payment in Xero."),
        )

    async def post_bank_transaction(self, payload: Dict[str, Any]) -> AccountingPostResult:
        res = await self.xero.create_payment(payload)
        return AccountingPostResult(
            success=True,
            platform=self.platform_name,
            entity_type="bank_statement",
            external_id=res.get("payment_id", ""),
            document_number=payload.get("reference_number", "XERO-BANK-TX"),
            status="CREATED",
            response_payload=res,
            message="Recorded bank transaction in Xero.",
        )

    async def post_journal_entry(self, payload: Dict[str, Any]) -> AccountingPostResult:
        res = await self.xero.create_manual_journal(payload)
        return AccountingPostResult(
            success=True,
            platform=self.platform_name,
            entity_type="gl_journal",
            external_id=res.get("journal_id", ""),
            document_number=res.get("journal_number", ""),
            status="CREATED",
            response_payload=res,
            message="Posted manual journal in Xero.",
        )

    async def fetch_chart_of_accounts(self) -> List[Dict[str, Any]]:
        """Returns Chart of Accounts for Xero."""
        live_accs = await self.xero.fetch_chart_of_accounts()
        if live_accs:
            return live_accs
        if settings.MOCK_MODE:
            return [
                {"account_id": "xero_850", "account_code": "850", "account_name": "Suspense Account", "account_type": "Current Liability", "is_suspense": True},
                {"account_id": "xero_999", "account_code": "999", "account_name": "Unallocated Payments", "account_type": "Current Asset", "is_suspense": True},
                {"account_id": "xero_400", "account_code": "400", "account_name": "Advertising & Marketing", "account_type": "Expense", "is_suspense": False},
                {"account_id": "xero_420", "account_code": "420", "account_name": "Consulting & Accounting", "account_type": "Expense", "is_suspense": False},
                {"account_id": "xero_429", "account_code": "429", "account_name": "General Expenses", "account_type": "Expense", "is_suspense": False},
                {"account_id": "xero_461", "account_code": "461", "account_name": "Printing & Stationery", "account_type": "Expense", "is_suspense": False},
                {"account_id": "xero_200", "account_code": "200", "account_name": "Sales Revenue", "account_type": "Income", "is_suspense": False},
            ]
        return []

    async def fetch_uncategorized_bank_transactions(
        self,
        watched_accounts: Optional[List[str]] = None,
        month: Optional[str] = None,
        year: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Discovers unmapped transactions residing in watched suspense accounts on Xero."""
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
            raw_txs = await self.xero.fetch_uncategorized_bank_transactions(
                watched_accounts=watched_accounts,
                date_start=date_start,
                date_end=date_end,
            )
            results = []
            for tx in (raw_txs or []):
                tx_id = str(tx.get("transaction_id", ""))
                tx_date = str(tx.get("date") or f"{target_year}-01-01")
                amt = abs(float(tx.get("amount", 0.0)))
                desc = tx.get("description") or f"Xero Bank Transaction #{tx_id}"
                results.append({
                    "transaction_date": tx_date,
                    "description": desc,
                    "amount": amt,
                    "transaction_type": tx.get("transaction_type", "DEBIT"),
                    "bank_account_name": tx.get("bank_account_name") or "Xero Bank Feed",
                    "account_name": tx.get("account_name") or "Suspense Account",
                    "source_file_name": "Xero_Live_Sync",
                    "mapped_account_id": None,
                    "ai_suggested_account": None,
                    "category_confidence": 0.90,
                    "watched_account": tx.get("watched_account") or "850",
                    "external_transaction_id": tx_id,
                    "xero_transaction_id": tx_id,
                    "raw_transaction": tx.get("raw_transaction"),
                })
            return results
        except Exception as e:
            logger.error(f"Error fetching uncategorized bank transactions from Xero: {e}")
            return []

    async def categorize_bank_transaction(
        self,
        transaction_id: str,
        account_id: str,
        payee_name: Optional[str] = None,
        tax_rate: Optional[str] = None,
    ) -> AccountingPostResult:
        """Pushes categorized line into Xero."""
        try:
            res = await self.xero.categorize_bank_transaction(
                transaction_id=transaction_id,
                account_id=account_id,
                payee_name=payee_name,
            )
            return AccountingPostResult(
                success=res.get("success", True),
                platform=self.platform_name,
                entity_type="bank_transaction_categorized",
                document_id=transaction_id,
                message=res.get("message", f"Transaction reconciled to account {account_id} on Xero."),
                raw_response=res,
            )
        except Exception as e:
            logger.error(f"Error categorizing transaction {transaction_id} on Xero: {e}")
            return AccountingPostResult(
                success=False,
                platform=self.platform_name,
                entity_type="bank_transaction_categorized",
                document_id=transaction_id,
                message=f"Failed to reconcile on Xero: {str(e)}",
            )
