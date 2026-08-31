"""Concrete QuickBooks Online (Intuit) Adapter for S4 Multi-Platform Engine."""

from typing import Dict, Any, List, Optional
from app.services.accounting.base import BaseAccountingAdapter, AccountingContact, AccountingItem, AccountingPostResult
from app.services.quickbooks_service import QuickBooksService


class QuickBooksAdapter(BaseAccountingAdapter):
    """Production live adapter connecting to Intuit QuickBooks Online REST API."""

    def __init__(self, client_id: str, config: Optional[Dict[str, Any]] = None):
        super().__init__(client_id, config)
        realm_id = self.config.get("accounting_org_id") or self.config.get("realm_id") or self.config.get("zoho_org_id")
        self.qbo = QuickBooksService(
            realm_id=realm_id,
            client_id=self.config.get("client_id"),
            client_secret=self.config.get("client_secret"),
            refresh_token=self.config.get("refresh_token"),
            is_sandbox=self.config.get("is_sandbox", True),
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
