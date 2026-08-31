"""Concrete Zoho Books Adapter for S4 Multi-Platform Engine."""

from typing import Dict, Any, List, Optional
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


class ZohoBooksAdapter(BaseAccountingAdapter):
    """Production live adapter connecting to Zoho Books REST API."""

    def __init__(self, client_id: str, config: Optional[Dict[str, Any]] = None):
        super().__init__(client_id, config)
        self.zoho = ZohoBooksService()

    @property
    def platform_name(self) -> str:
        return "Zoho Books"

    @property
    def is_live(self) -> bool:
        return True

    async def fetch_contacts(self, contact_type: str = "customer") -> List[AccountingContact]:
        raw_contacts = await self.zoho.get_customers(organization_id=self.config.get("zoho_org_id"))
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
        raw_items = await self.zoho.get_items(organization_id=self.config.get("zoho_org_id"))
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
