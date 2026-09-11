"""Accounting Adapter Factory for S4 Multi-Platform Engine."""

from typing import Dict, Any, Optional
from app.services.accounting.base import BaseAccountingAdapter
from app.services.accounting.zoho_adapter import ZohoBooksAdapter
from app.services.accounting.quickbooks_adapter import QuickBooksAdapter
from app.services.accounting.xero_adapter import XeroAdapter
from app.services.accounting.placeholder_adapter import InProgressAccountingAdapter
from app.models.db_models import AccountingSoftware


class AccountingAdapterFactory:
    """Factory resolving the appropriate accounting software connector adapter."""

    PLATFORM_NAMES: Dict[str, str] = {
        AccountingSoftware.ZOHO_BOOKS.value: "Zoho Books",
        AccountingSoftware.QUICKBOOKS_ONLINE.value: "QuickBooks Online",
        AccountingSoftware.SAGE_BUSINESS_CLOUD.value: "Sage Business Cloud",
        AccountingSoftware.XERO.value: "Xero Accounting",
        AccountingSoftware.ODOO.value: "Odoo Accounting",
        AccountingSoftware.TALLY_PRIME.value: "TallyPrime",
        AccountingSoftware.SAP_BUSINESS_ONE.value: "SAP Business One",
        AccountingSoftware.MS_DYNAMICS_365.value: "Microsoft Dynamics 365",
        AccountingSoftware.WAVE.value: "Wave Accounting",
        AccountingSoftware.BUSY_ACCOUNTING.value: "Busy Accounting",
    }

    @classmethod
    def get_adapter(
        cls,
        software_id: str,
        client_id: str,
        config: Optional[Dict[str, Any]] = None,
    ) -> BaseAccountingAdapter:
        """Returns the concrete or placeholder adapter for the requested platform."""
        resolved_config = dict(config or {})
        if not resolved_config and client_id:
            try:
                from sqlmodel import Session, select
                from app.db.session import get_engine
                from app.models.db_models import ClientOrganization
                with Session(get_engine()) as session:
                    client_obj = session.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
                    if client_obj:
                        if client_obj.zoho_org_id:
                            resolved_config["accounting_org_id"] = client_obj.zoho_org_id
                            resolved_config["zoho_org_id"] = client_obj.zoho_org_id
                        if client_obj.custom_config:
                            resolved_config.update(client_obj.custom_config)
            except Exception:
                pass

        sid = (software_id or "zoho_books").lower()
        if sid == AccountingSoftware.ZOHO_BOOKS.value or sid == "zoho":
            return ZohoBooksAdapter(client_id=client_id, config=resolved_config)
        elif sid == AccountingSoftware.QUICKBOOKS_ONLINE.value or sid == "quickbooks" or sid == "qbo":
            return QuickBooksAdapter(client_id=client_id, config=resolved_config)
        elif sid == AccountingSoftware.XERO.value or sid == "xero":
            return XeroAdapter(client_id=client_id, config=resolved_config)

        platform_name = cls.PLATFORM_NAMES.get(sid, sid.replace("_", " ").title())
        return InProgressAccountingAdapter(
            platform_id=sid,
            platform_name=platform_name,
            client_id=client_id,
            config=resolved_config,
        )

    # Alias for get_adapter
    get = get_adapter
