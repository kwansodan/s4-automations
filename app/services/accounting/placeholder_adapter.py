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
