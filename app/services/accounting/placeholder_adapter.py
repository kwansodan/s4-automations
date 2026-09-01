"""Placeholder / In-Progress Adapter for non-Zoho West African Accounting Platforms."""

from typing import Dict, Any, List, Optional
from app.services.accounting.base import BaseAccountingAdapter, AccountingContact, AccountingItem, AccountingPostResult


class InProgressAccountingAdapter(BaseAccountingAdapter):
    """
    Adapter for accounting platforms currently marked as 'in_progress'
    (QuickBooks Online, Sage, Xero, Odoo, Tally, SAP, MS Dynamics, Wave, Busy).
    """

    def __init__(self, platform_id: str, platform_name: str, client_id: str, config: Optional[Dict[str, Any]] = None):
        super().__init__(client_id, config)
        self._platform_id = platform_id
        self._platform_name = platform_name

    @property
    def platform_name(self) -> str:
        return self._platform_name

    @property
    def is_live(self) -> bool:
        return False

    async def fetch_contacts(self, contact_type: str = "customer") -> List[AccountingContact]:
        return [
            AccountingContact(
                contact_id=f"mock_{self._platform_id}_cust_001",
                contact_name="Standard Sandbox Contact",
                company_name="West Africa Demo Enterprise",
                email="accounts@demo.service4gh.com",
                contact_type=contact_type,
            )
        ]

    async def fetch_item_catalog(self) -> List[AccountingItem]:
        return [
            AccountingItem(
                item_id=f"mock_{self._platform_id}_item_001",
                name="General Commercial Goods & Services",
                rate=100.0,
            )
        ]

    async def post_invoice(self, payload: Dict[str, Any]) -> AccountingPostResult:
        return AccountingPostResult(
            success=True,
            platform=self.platform_name,
            entity_type="ar_sales_invoice",
            document_id=f"mock_{self._platform_id}_inv_999",
            document_number=f"{self._platform_id.upper()}-INV-001",
            status="MOCK_STAGED",
            message=f"[{self.platform_name} Connector In Progress] Transaction staged for future connector dispatch.",
            raw_response={"notice": f"Live posting to {self.platform_name} connector is currently in progress."},
        )

    async def post_vendor_bill(self, payload: Dict[str, Any]) -> AccountingPostResult:
        return AccountingPostResult(
            success=True,
            platform=self.platform_name,
            entity_type="ap_vendor_bill",
            document_id=f"mock_{self._platform_id}_bill_999",
            document_number=f"{self._platform_id.upper()}-BILL-001",
            status="MOCK_STAGED",
            message=f"[{self.platform_name} Connector In Progress] Vendor bill staged.",
            raw_response={"notice": f"Live posting to {self.platform_name} is in progress."},
        )

    async def post_payment(self, payload: Dict[str, Any], is_customer: bool = True) -> AccountingPostResult:
        return AccountingPostResult(
            success=True,
            platform=self.platform_name,
            entity_type="ar_customer_payment" if is_customer else "ap_vendor_payment",
            document_id=f"mock_{self._platform_id}_pay_999",
            status="MOCK_STAGED",
            message=f"[{self.platform_name} Connector In Progress] Payment staged.",
        )

    async def post_bank_transaction(self, payload: Dict[str, Any]) -> AccountingPostResult:
        return AccountingPostResult(
            success=True,
            platform=self.platform_name,
            entity_type="bank_statement",
            document_id=f"mock_{self._platform_id}_bank_999",
            status="MOCK_STAGED",
            message=f"[{self.platform_name} Connector In Progress] Bank transaction staged.",
        )

    async def post_journal_entry(self, payload: Dict[str, Any]) -> AccountingPostResult:
        return AccountingPostResult(
            success=True,
            platform=self.platform_name,
            entity_type="gl_journal",
            document_id=f"mock_{self._platform_id}_jrnl_999",
            status="MOCK_STAGED",
            message=f"[{self.platform_name} Connector In Progress] Journal entry staged.",
        )

    async def fetch_chart_of_accounts(self) -> List[Dict[str, Any]]:
        """Returns standard Chart of Accounts for generic platform."""
        return [
            {"account_id": f"{self._platform_id}_6990", "account_code": "6990", "account_name": "Uncategorized Expenses", "account_type": "Expense", "is_suspense": True},
            {"account_id": f"{self._platform_id}_850", "account_code": "850", "account_name": "Suspense Account", "account_type": "Liability", "is_suspense": True},
            {"account_id": f"{self._platform_id}_5100", "account_code": "5100", "account_name": "Office Supplies", "account_type": "Expense", "is_suspense": False},
            {"account_id": f"{self._platform_id}_5200", "account_code": "5200", "account_name": "Fuel & Vehicle", "account_type": "Expense", "is_suspense": False},
            {"account_id": f"{self._platform_id}_4100", "account_code": "4100", "account_name": "Sales Revenue", "account_type": "Income", "is_suspense": False},
        ]

    async def fetch_uncategorized_bank_transactions(self, watched_accounts: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """Discovers unmapped bank feeds residing in watched suspense accounts."""
        return [
            {
                "transaction_date": "2026-08-28",
                "description": f"[{self.platform_name}] UNCLASSIFIED BANK FEED TRANSACTION",
                "amount": 750.0,
                "transaction_type": "DEBIT",
                "bank_account_name": "Generic Operating Account",
                "source_file_name": "Direct_Feed",
                "mapped_account_id": None,
                "ai_suggested_account": "Office Supplies",
                "category_confidence": 0.85,
            }
        ]

    async def categorize_bank_transaction(
        self,
        transaction_id: str,
        account_id: str,
        payee_name: Optional[str] = None,
        tax_rate: Optional[str] = None,
    ) -> AccountingPostResult:
        """Pushes categorized line into platform."""
        return AccountingPostResult(
            success=True,
            platform=self.platform_name,
            entity_type="bank_transaction_categorized",
            document_id=f"tx_{transaction_id}",
            message=f"Transaction staged for classification to {account_id}.",
        )
