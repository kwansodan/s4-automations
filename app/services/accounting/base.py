"""Abstract Base Accounting Platform Adapter for S4 Multi-Platform Engine."""

from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional
from pydantic import BaseModel


class AccountingContact(BaseModel):
    contact_id: str
    contact_name: str
    company_name: Optional[str] = ""
    email: Optional[str] = ""
    contact_type: str = "customer"  # customer or vendor


class AccountingItem(BaseModel):
    item_id: str
    name: str
    rate: float
    account_code: Optional[str] = ""


class AccountingPostResult(BaseModel):
    success: bool
    platform: str
    entity_type: str
    document_id: Optional[str] = None
    document_number: Optional[str] = None
    status: str = "POSTED"
    url: Optional[str] = None
    message: str = ""
    raw_response: Dict[str, Any] = {}


class BaseAccountingAdapter(ABC):
    """
    Standard interface that all target accounting platform connectors (Zoho Books,
    QuickBooks Online, Sage, Xero, Odoo, Tally, SAP, MS Dynamics, Wave, Busy) implement.
    """

    def __init__(self, client_id: str, config: Optional[Dict[str, Any]] = None):
        self.client_id = client_id
        self.config = config or {}

    @property
    @abstractmethod
    def platform_name(self) -> str:
        """Name of the target accounting platform."""
        pass

    @property
    @abstractmethod
    def is_live(self) -> bool:
        """Returns True if the connector is live and ready for production posting."""
        pass

    @abstractmethod
    async def fetch_contacts(self, contact_type: str = "customer") -> List[AccountingContact]:
        """Fetches customer or vendor contacts directory from the target accounting platform."""
        pass

    @abstractmethod
    async def fetch_item_catalog(self) -> List[AccountingItem]:
        """Fetches standard inventory / pricing catalog items."""
        pass

    @abstractmethod
    async def post_invoice(self, payload: Dict[str, Any]) -> AccountingPostResult:
        """Posts an approved Sales Invoice to the target accounting system."""
        pass

    @abstractmethod
    async def post_vendor_bill(self, payload: Dict[str, Any]) -> AccountingPostResult:
        """Posts an approved Vendor Bill to the target accounting system."""
        pass

    @abstractmethod
    async def post_payment(self, payload: Dict[str, Any], is_customer: bool = True) -> AccountingPostResult:
        """Posts a Customer or Vendor Payment."""
        pass

    @abstractmethod
    async def post_bank_transaction(self, payload: Dict[str, Any]) -> AccountingPostResult:
        """Posts a bank statement line or bank deposit/withdrawal."""
        pass

    @abstractmethod
    async def post_journal_entry(self, payload: Dict[str, Any]) -> AccountingPostResult:
        """Posts a multi-leg manual journal entry."""
        pass

    @abstractmethod
    async def fetch_chart_of_accounts(self) -> List[Dict[str, Any]]:
        """Fetches Chart of Accounts directory from the target accounting platform."""
        pass

    @abstractmethod
    async def fetch_uncategorized_bank_transactions(self, watched_accounts: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """Fetches uncategorized/unreconciled bank transactions from accounting software or bank feed."""
        pass

    @abstractmethod
    async def categorize_bank_transaction(
        self,
        transaction_id: str,
        account_id: str,
        payee_name: Optional[str] = None,
        tax_rate: Optional[str] = None,
    ) -> AccountingPostResult:
        """Categorizes an unmapped bank transaction in the accounting platform."""
        pass
