"""S4 Multi-Platform Accounting Adapters."""

from app.services.accounting.base import BaseAccountingAdapter, AccountingContact, AccountingItem, AccountingPostResult
from app.services.accounting.zoho_adapter import ZohoBooksAdapter
from app.services.accounting.placeholder_adapter import InProgressAccountingAdapter
from app.services.accounting.factory import AccountingAdapterFactory

__all__ = [
    "BaseAccountingAdapter",
    "AccountingContact",
    "AccountingItem",
    "AccountingPostResult",
    "ZohoBooksAdapter",
    "InProgressAccountingAdapter",
    "AccountingAdapterFactory",
]
