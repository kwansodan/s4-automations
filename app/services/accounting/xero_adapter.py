"""Concrete Xero Adapter for S4 Multi-Platform Engine."""

from typing import Dict, Any, List, Optional
from app.services.accounting.base import BaseAccountingAdapter, AccountingContact, AccountingItem, AccountingPostResult
from app.services.xero_service import XeroService


class XeroAdapter(BaseAccountingAdapter):
    """Production live adapter connecting to Xero Accounting API v2.0."""

    def __init__(self, client_id: str, config: Optional[Dict[str, Any]] = None):
        super().__init__(client_id, config)
        tenant_id = self.config.get("accounting_org_id") or self.config.get("tenant_id") or self.config.get("zoho_org_id")
        self.xero = XeroService(
            tenant_id=tenant_id,
            client_id=self.config.get("client_id"),
            client_secret=self.config.get("client_secret"),
            refresh_token=self.config.get("refresh_token"),
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
