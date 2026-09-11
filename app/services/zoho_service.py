"""Zoho Books API Service integration with OAuth2 refresh, Catalog sync, and Invoicing."""

import time
from difflib import SequenceMatcher
from typing import List, Dict, Optional, Any
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from app.config import settings
from app.models.schemas import (
    ZohoContact,
    ZohoItem,
    ZohoDraftInvoiceRequest,
    ZohoDraftInvoiceResponse,
    ZohoDraftBillRequest,
    ZohoDraftBillResponse,
    ZohoCustomerPaymentRequest,
    ZohoCustomerPaymentResponse,
    ZohoVendorPaymentRequest,
    ZohoVendorPaymentResponse,
    ZohoExpenseRequest,
    ZohoExpenseResponse,
    ZohoCreditNoteRequest,
    ZohoCreditNoteResponse,
    ZohoBankTransactionRequest,
    ZohoBankTransactionResponse,
    ZohoJournalRequest,
    ZohoJournalResponse,
    MonthlySKUSummary,
)
from app.utils.logging import get_logger

logger = get_logger("zoho_service")


class ZohoBooksService:
    """
    Service for integrating with Zoho Books API:
    - Customer Contact Discovery & Matching
    - Item Catalog Synchronization (SKUs & Unit Rates in GHS)
    - Draft Invoice Creation & Downstream Status Tracking
    """

    # Tenant-isolated caches keyed by f"{client_id}:{org_id}" to guarantee strict client isolation
    _tenant_tokens: Dict[str, Dict[str, Any]] = {}
    _tenant_contacts: Dict[str, List[ZohoContact]] = {}
    _tenant_items: Dict[str, List[ZohoItem]] = {}

    def __init__(
        self,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        refresh_token: Optional[str] = None,
        org_id: Optional[str] = None,
        accounts_url: Optional[str] = None,
        books_api_url: Optional[str] = None,
    ):
        self.client_id = client_id or settings.ZOHO_CLIENT_ID
        self.client_secret = client_secret or settings.ZOHO_CLIENT_SECRET
        self.refresh_token = refresh_token or settings.ZOHO_REFRESH_TOKEN
        self.org_id = org_id or settings.ZOHO_ORG_ID
        self.accounts_url = (accounts_url or settings.ZOHO_ACCOUNTS_URL).rstrip("/")
        self.books_api_url = (books_api_url or settings.ZOHO_BOOKS_API_URL).rstrip("/")

        # Unique tenant cache key
        self._tenant_key = f"{self.client_id}:{self.org_id}"

        # Initialize instance caches from tenant store if available
        cached_tok = ZohoBooksService._tenant_tokens.get(self._tenant_key, {})
        self._access_token: Optional[str] = cached_tok.get("token")
        self._token_expiry_timestamp: float = cached_tok.get("expiry", 0.0)
        self._cached_contacts: List[ZohoContact] = ZohoBooksService._tenant_contacts.get(self._tenant_key, [])
        self._cached_items: List[ZohoItem] = ZohoBooksService._tenant_items.get(self._tenant_key, [])

    @classmethod
    def from_client_id(cls, client_id: str) -> "ZohoBooksService":
        """Factory initializing ZohoBooksService with dedicated credentials for the client organization."""
        from app.models.db_models import ClientOrganization
        from app.db.session import get_engine
        from sqlmodel import Session, select

        with Session(get_engine()) as session:
            client_obj = session.exec(
                select(ClientOrganization).where(
                    (ClientOrganization.id == client_id) | (ClientOrganization.name == client_id)
                )
            ).first()

            if client_obj:
                cfg = client_obj.custom_config or {}
                return cls(
                    client_id=cfg.get("zoho_client_id") or cfg.get("client_id") or settings.ZOHO_CLIENT_ID,
                    client_secret=cfg.get("zoho_client_secret") or cfg.get("client_secret") or settings.ZOHO_CLIENT_SECRET,
                    refresh_token=cfg.get("zoho_refresh_token") or cfg.get("refresh_token") or settings.ZOHO_REFRESH_TOKEN,
                    org_id=client_obj.zoho_org_id or cfg.get("accounting_org_id") or cfg.get("zoho_org_id") or settings.ZOHO_ORG_ID,
                    accounts_url=cfg.get("zoho_accounts_url") or settings.ZOHO_ACCOUNTS_URL,
                    books_api_url=cfg.get("zoho_books_api_url") or settings.ZOHO_BOOKS_API_URL,
                )

        return cls()

    async def get_access_token(self, force_refresh: bool = False) -> str:
        """Retrieves a valid OAuth2 access token, refreshing if expired."""
        if not self.refresh_token or not self.client_id or not self.client_secret:
            raise ValueError(f"Zoho Books credentials (refresh token, client ID, secret) are not configured for org '{self.org_id}'.")

        current_time = time.time()
        tenant_cache = ZohoBooksService._tenant_tokens.get(self._tenant_key, {})
        cached_tok = tenant_cache.get("token")
        cached_exp = tenant_cache.get("expiry", 0.0)

        # Keep a 60-second buffer and reuse isolated tenant token if still valid
        if not force_refresh and cached_tok and current_time < (cached_exp - 60):
            self._access_token = cached_tok
            self._token_expiry_timestamp = cached_exp
            return cached_tok

        token_url = f"{self.accounts_url}/oauth/v2/token"
        params = {
            "refresh_token": self.refresh_token,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "grant_type": "refresh_token",
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            logger.info(f"Refreshing Zoho OAuth2 token for org {self.org_id} from {token_url}...")
            response = await client.post(token_url, params=params)
            
            if response.status_code != 200:
                logger.error(f"Zoho token refresh failed for org {self.org_id} ({response.status_code}): {response.text}")
                # If we already have a previous token for this tenant, reuse it during rate limit/backoff
                if cached_tok:
                    logger.warning(f"Reusing previous Zoho access token for org {self.org_id} due to rate limiting.")
                    return cached_tok
                raise RuntimeError(f"Zoho OAuth token refresh failed for org {self.org_id}: {response.text}")

            data = response.json()
            if "access_token" not in data:
                error_msg = data.get("error", "Unknown OAuth error")
                logger.error(f"Zoho OAuth returned error for org {self.org_id}: {error_msg}")
                if cached_tok:
                    return cached_tok
                raise RuntimeError(f"Zoho OAuth error for org {self.org_id}: {error_msg}")

            access_tok = data["access_token"]
            expires_in = data.get("expires_in", 3600)
            
            # Store isolated token in tenant store
            ZohoBooksService._tenant_tokens[self._tenant_key] = {
                "token": access_tok,
                "expiry": current_time + expires_in,
            }
            self._access_token = access_tok
            self._token_expiry_timestamp = current_time + expires_in
            
            logger.info(f"Zoho access token refreshed successfully for org {self.org_id}. Valid for {expires_in}s.")
            return access_tok

    def _get_headers(self, access_token: str) -> Dict[str, str]:
        return {
            "Authorization": f"Zoho-oauthtoken {access_token}",
            "Content-Type": "application/json;charset=UTF-8",
        }

    @retry(
        reraise=True,
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
    )
    async def fetch_active_contacts(self) -> List[ZohoContact]:
        """Fetches all active customer contacts from Zoho Books."""
        if not self.org_id:
            logger.info("No live Zoho credentials/org_id; returning empty contacts list.")
            return []

        access_token = await self.get_access_token()
        headers = self._get_headers(access_token)
        url = f"{self.books_api_url}/contacts"
        params = {
            "organization_id": self.org_id,
            "status": "active",
            "contact_type": "customer",
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=headers, params=params)
            
            if response.status_code == 401:
                # Refresh token and retry
                access_token = await self.get_access_token(force_refresh=True)
                headers = self._get_headers(access_token)
                response = await client.get(url, headers=headers, params=params)

            response.raise_for_status()
            data = response.json()
            raw_contacts = data.get("contacts", [])

            contacts = []
            for c in raw_contacts:
                contacts.append(
                    ZohoContact(
                        contact_id=str(c.get("contact_id", "")),
                        contact_name=c.get("contact_name", "") or c.get("company_name", ""),
                        company_name=c.get("company_name", ""),
                        email=c.get("email", ""),
                        status=c.get("status", "active"),
                    )
                )

            self._cached_contacts = contacts
            ZohoBooksService._tenant_contacts[self._tenant_key] = contacts
            logger.info(f"Fetched {len(contacts)} active contacts from Zoho Books for tenant {self._tenant_key}.")
            return contacts

    @retry(
        reraise=True,
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
    )
    async def fetch_chart_of_accounts(self) -> List[Dict[str, Any]]:
        """Fetches active Chart of Accounts from Zoho Books REST API."""
        if not self.org_id or not self.refresh_token:
            logger.warning(f"No refresh token or org_id configured for Zoho Books (org: {self.org_id}). Returning empty chart of accounts.")
            return []

        access_token = await self.get_access_token()
        headers = self._get_headers(access_token)
        url = f"{self.books_api_url}/chartofaccounts"
        params = {"organization_id": self.org_id}

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=headers, params=params)

            if response.status_code == 401:
                access_token = await self.get_access_token(force_refresh=True)
                headers = self._get_headers(access_token)
                response = await client.get(url, headers=headers, params=params)

            response.raise_for_status()
            data = response.json()
            raw_accounts = data.get("chartofaccounts", [])

            accounts = []
            for acc in raw_accounts:
                acc_name = acc.get("account_name", "")
                acc_type = acc.get("account_type", "")
                accounts.append(
                    {
                        "account_id": str(acc.get("account_id", "")),
                        "account_code": acc.get("account_code", "") or str(acc.get("account_id", "")),
                        "account_name": acc_name,
                        "account_type": acc_type,
                        "is_suspense": acc_type.lower() in ["suspense", "other_current_liability"] or "uncategorized" in acc_name.lower(),
                    }
                )

            logger.info(f"Fetched {len(accounts)} chart of accounts from Zoho Books for org {self.org_id}.")
            return accounts

    @retry(
        reraise=True,
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
    )
    async def create_vendor_contact(self, vendor_name: str) -> ZohoContact:
        """Creates a new Vendor contact in Zoho Books."""
        if not self.org_id:
            raise ValueError("Cannot create vendor contact: Zoho Organization ID is not configured.")

        access_token = await self.get_access_token()
        headers = self._get_headers(access_token)
        url = f"{self.books_api_url}/contacts"
        params = {"organization_id": self.org_id}
        payload = {
            "contact_name": vendor_name,
            "company_name": vendor_name,
            "contact_type": "vendor",
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers, params=params, json=payload)
            if response.status_code == 401:
                access_token = await self.get_access_token(force_refresh=True)
                headers = self._get_headers(access_token)
                response = await client.post(url, headers=headers, params=params, json=payload)
            
            response.raise_for_status()
            data = response.json()
            c = data.get("contact", {})
            new_vendor = ZohoContact(
                contact_id=str(c.get("contact_id", "")),
                contact_name=c.get("contact_name", ""),
                company_name=c.get("company_name", ""),
                email=c.get("email", ""),
                status=c.get("status", "active"),
            )
            self._cached_contacts.append(new_vendor)
            logger.info(f"Created new Vendor in Zoho Books: {vendor_name}")
            return new_vendor

    @retry(
        reraise=True,
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
    )
    async def fetch_item_catalog(self) -> List[ZohoItem]:
        """Fetches active linen/laundry items catalog from Zoho Books."""
        if not self.org_id:
            logger.info("No live Zoho credentials/org_id; returning empty item catalog.")
            return []

        access_token = await self.get_access_token()
        headers = self._get_headers(access_token)
        url = f"{self.books_api_url}/items"
        params = {
            "organization_id": self.org_id,
            "status": "active",
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=headers, params=params)
            if response.status_code == 401:
                access_token = await self.get_access_token(force_refresh=True)
                headers = self._get_headers(access_token)
                response = await client.get(url, headers=headers, params=params)

            response.raise_for_status()
            data = response.json()
            raw_items = data.get("items", [])

            items = []
            for item in raw_items:
                items.append(
                    ZohoItem(
                        item_id=str(item.get("item_id", "")),
                        name=item.get("name", ""),
                        rate=float(item.get("rate", 0.0)),
                        description=item.get("description", ""),
                        status=item.get("status", "active"),
                    )
                )

            self._cached_items = items
            ZohoBooksService._tenant_items[self._tenant_key] = items
            logger.info(f"Fetched {len(items)} active items from Zoho Books catalog for tenant {self._tenant_key}.")
            return items

    def find_contact_by_name(self, client_name: str) -> Optional[ZohoContact]:
        """Matches a client folder name against the Zoho Contacts cache."""
        cleaned_client = client_name.strip().lower()
        
        # 1. Exact match
        for contact in self._cached_contacts:
            if contact.contact_name.strip().lower() == cleaned_client:
                return contact
            if contact.company_name and contact.company_name.strip().lower() == cleaned_client:
                return contact

        # 2. Substring match
        for contact in self._cached_contacts:
            if cleaned_client in contact.contact_name.strip().lower() or (
                contact.company_name and cleaned_client in contact.company_name.strip().lower()
            ):
                return contact
            if contact.contact_name.strip().lower() in cleaned_client:
                return contact

        # 3. Fuzzy similarity match (>= 0.72)
        best_contact = None
        highest_score = 0.0
        for contact in self._cached_contacts:
            name_score = SequenceMatcher(None, cleaned_client, contact.contact_name.strip().lower()).ratio()
            comp_score = (
                SequenceMatcher(None, cleaned_client, contact.company_name.strip().lower()).ratio()
                if contact.company_name
                else 0.0
            )
            max_score = max(name_score, comp_score)
            if max_score > highest_score:
                highest_score = max_score
                best_contact = contact

        if highest_score >= 0.72 and best_contact:
            logger.info(f"Fuzzy matched client '{client_name}' to Zoho contact '{best_contact.contact_name}' (score: {highest_score:.2f})")
            return best_contact

        return None

    @retry(
        reraise=True,
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
    )
    async def find_existing_draft_invoice(
        self, customer_id: str, month: str, year: int
    ) -> Optional[Dict[str, Any]]:
        """
        Finds an existing draft invoice for this customer and billing month in Zoho Books.
        Returns the full invoice dict with line items if found, else None.
        """
        if not self.org_id:
            return None

        access_token = await self.get_access_token()
        headers = self._get_headers(access_token)
        url = f"{self.books_api_url}/invoices"
        params = {
            "organization_id": self.org_id,
            "customer_id": customer_id,
            "status": "draft",
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=headers, params=params)
            if response.status_code == 401:
                access_token = await self.get_access_token(force_refresh=True)
                headers = self._get_headers(access_token)
                response = await client.get(url, headers=headers, params=params)

            if response.status_code != 200:
                logger.warning(f"Could not query draft invoices for customer {customer_id}: {response.text}")
                return None

            data = response.json()
            invoices = data.get("invoices", [])
            
            target_str = f"{month} {year}".lower()
            matched_inv_id = None

            for inv in invoices:
                # Match by notes/subject containing month & year or date
                inv_notes = str(inv.get("notes", "")).lower()
                inv_date = str(inv.get("date", ""))
                
                # Parse month number
                try:
                    month_num = datetime.strptime(month, "%B").month
                except Exception:
                    month_num = 0
                month_prefix = f"{year:04d}-{month_num:02d}"

                if target_str in inv_notes or (month_num > 0 and inv_date.startswith(month_prefix)):
                    matched_inv_id = inv.get("invoice_id")
                    break

            if not matched_inv_id:
                return None

            # Fetch full invoice details with line items
            detail_url = f"{self.books_api_url}/invoices/{matched_inv_id}"
            detail_res = await client.get(detail_url, headers=headers, params={"organization_id": self.org_id})
            if detail_res.status_code == 200:
                return detail_res.json().get("invoice")

            return None

    @retry(
        reraise=True,
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
    )
    async def create_draft_invoice(
        self, request: ZohoDraftInvoiceRequest
    ) -> ZohoDraftInvoiceResponse:
        """Creates a Draft Invoice in Zoho Books for approved monthly billing rows."""
        if not self.org_id:
            raise ValueError("Cannot create draft invoice: Zoho Organization ID is not configured.")

        access_token = await self.get_access_token()
        headers = self._get_headers(access_token)
        url = f"{self.books_api_url}/invoices"
        params = {"organization_id": self.org_id}

        payload = {
            "customer_id": request.customer_id,
            "date": request.date,
            "due_date": request.due_date,
            "line_items": [
                {
                    "item_id": li.item_id,
                    "name": li.name,
                    "description": li.description,
                    "rate": li.rate,
                    "quantity": li.quantity,
                }
                for li in request.line_items
            ],
            "notes": request.notes,
            "terms": request.terms,
            "status": "draft",
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers, params=params, json=payload)
            if response.status_code == 401:
                access_token = await self.get_access_token(force_refresh=True)
                headers = self._get_headers(access_token)
                response = await client.post(url, headers=headers, params=params, json=payload)

            response.raise_for_status()
            data = response.json()
            invoice = data.get("invoice", {})
            invoice_id = str(invoice.get("invoice_id", ""))
            invoice_num = invoice.get("invoice_number", "")
            total_amt = float(invoice.get("total", 0.0))

            logger.info(f"Successfully created Zoho Draft Invoice {invoice_num} (ID: {invoice_id})")
            return ZohoDraftInvoiceResponse(
                code=data.get("code", 0),
                message=data.get("message", "Success"),
                invoice_id=invoice_id,
                invoice_number=invoice_num,
                customer_id=request.customer_id,
                customer_name=invoice.get("customer_name", ""),
                total=total_amt,
                status="draft",
                invoice_url=f"https://books.zoho.com/app#/invoices/{invoice_id}",
            )

    async def create_or_append_draft_invoice(
        self, request: ZohoDraftInvoiceRequest, month: str, year: int
    ) -> ZohoDraftInvoiceResponse:
        """
        Checks for an existing draft invoice for this customer and month.
        If found: appends/merges new line items into the existing invoice.
        If not found: creates a fresh draft invoice.
        """
        if not self.org_id:
            raise ValueError("Cannot append draft invoice: Zoho Organization ID is not configured.")

        existing = await self.find_existing_draft_invoice(request.customer_id, month, year)

        if not existing:
            return await self.create_draft_invoice(request)

        # Append new items to existing invoice
        invoice_id = existing.get("invoice_id", "")
        invoice_num = existing.get("invoice_number", "")
        existing_items = existing.get("line_items", [])

        # Build merged line items
        combined_items = []
        for old in existing_items:
            combined_items.append({
                "item_id": old.get("item_id", ""),
                "name": old.get("name", ""),
                "description": old.get("description", ""),
                "rate": float(old.get("rate", 0.0)),
                "quantity": int(old.get("quantity", 0)),
            })

        for new_li in request.line_items:
            combined_items.append({
                "item_id": new_li.item_id,
                "name": new_li.name,
                "description": new_li.description,
                "rate": new_li.rate,
                "quantity": new_li.quantity,
            })

        access_token = await self.get_access_token()
        headers = self._get_headers(access_token)
        url = f"{self.books_api_url}/invoices/{invoice_id}"
        params = {"organization_id": self.org_id}

        payload = {
            "customer_id": request.customer_id,
            "date": request.date,
            "due_date": request.due_date,
            "line_items": combined_items,
            "notes": request.notes,
            "terms": request.terms,
            "status": "draft",
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.put(url, headers=headers, params=params, json=payload)
            if response.status_code == 401:
                access_token = await self.get_access_token(force_refresh=True)
                headers = self._get_headers(access_token)
                response = await client.put(url, headers=headers, params=params, json=payload)

            response.raise_for_status()
            data = response.json()
            updated_inv = data.get("invoice", {})
            updated_total = float(updated_inv.get("total", 0.0))

            logger.info(f"Successfully appended items to Zoho Draft Invoice {invoice_num} (New Total: GHS {updated_total:.2f})")
            return ZohoDraftInvoiceResponse(
                code=data.get("code", 0),
                message=data.get("message", "Appended to existing draft invoice"),
                invoice_id=invoice_id,
                invoice_number=invoice_num,
                customer_id=request.customer_id,
                customer_name=updated_inv.get("customer_name", ""),
                total=updated_total,
                status="draft",
                invoice_url=f"https://books.zoho.com/app#/invoices/{invoice_id}",
            )

    @retry(
        reraise=True,
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
    )
    async def create_draft_bill(self, request: ZohoDraftBillRequest) -> ZohoDraftBillResponse:
        """Creates a new Draft Vendor Bill in Zoho Books."""
        if not self.org_id:
            raise ValueError("Cannot create draft bill: Zoho Organization ID is not configured.")

        access_token = await self.get_access_token()
        headers = self._get_headers(access_token)
        url = f"{self.books_api_url}/bills"
        params = {"organization_id": self.org_id}

        payload = {
            "vendor_id": request.vendor_id,
            "bill_number": request.bill_number,
            "date": request.date,
            "due_date": request.due_date,
            "line_items": request.line_items,
            "notes": request.notes,
            "status": "draft",
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers, params=params, json=payload)
            if response.status_code == 401:
                access_token = await self.get_access_token(force_refresh=True)
                headers = self._get_headers(access_token)
                response = await client.post(url, headers=headers, params=params, json=payload)

            response.raise_for_status()
            data = response.json()
            bill = data.get("bill", {})
            bill_id = str(bill.get("bill_id", ""))
            bill_num = bill.get("bill_number", "")
            total_amt = float(bill.get("total", 0.0))

            logger.info(f"Successfully created Zoho Draft Bill {bill_num} (ID: {bill_id})")
            return ZohoDraftBillResponse(
                code=data.get("code", 0),
                message=data.get("message", "Success"),
                bill_id=bill_id,
                bill_number=bill_num,
                vendor_id=request.vendor_id,
                vendor_name=bill.get("vendor_name", ""),
                total=total_amt,
                status="draft",
                bill_url=f"https://books.zoho.com/app#/bills/{bill_id}",
            )

    @retry(
        reraise=True,
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
    )
    async def create_customer_payment(
        self, request: ZohoCustomerPaymentRequest
    ) -> ZohoCustomerPaymentResponse:
        """Records a Customer Payment in Zoho Books."""
        if not self.org_id:
            raise ValueError("Cannot create customer payment: Zoho Organization ID is not configured.")

        access_token = await self.get_access_token()
        headers = self._get_headers(access_token)
        url = f"{self.books_api_url}/customerpayments"
        params = {"organization_id": self.org_id}

        payload: Dict[str, Any] = {
            "customer_id": request.customer_id,
            "payment_mode": request.payment_mode,
            "amount": request.amount,
            "date": request.date,
            "reference_number": request.reference_number,
            "description": request.description,
        }
        if request.account_id:
            payload["account_id"] = request.account_id
        if request.invoices:
            payload["invoices"] = [
                {
                    "invoice_id": inv.invoice_id,
                    "amount_applied": inv.amount_applied,
                    "tax_amount_withheld": inv.tax_amount_withheld,
                }
                for inv in request.invoices
            ]

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers, params=params, json=payload)
            if response.status_code == 401:
                access_token = await self.get_access_token(force_refresh=True)
                headers = self._get_headers(access_token)
                response = await client.post(url, headers=headers, params=params, json=payload)

            response.raise_for_status()
            data = response.json()
            payment = data.get("payment", {})
            return ZohoCustomerPaymentResponse(
                code=data.get("code", 0),
                message=data.get("message", "Success"),
                payment_id=str(payment.get("payment_id", "")),
                payment_number=payment.get("payment_number", ""),
                customer_id=request.customer_id,
                customer_name=payment.get("customer_name", ""),
                amount=float(payment.get("amount", request.amount)),
                payment_url=f"https://books.zoho.com/app#/customerpayments/{payment.get('payment_id')}",
            )

    @retry(
        reraise=True,
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
    )
    async def create_vendor_payment(
        self, request: ZohoVendorPaymentRequest
    ) -> ZohoVendorPaymentResponse:
        """Records a Vendor Payment in Zoho Books."""
        if not self.org_id:
            raise ValueError("Cannot create vendor payment: Zoho Organization ID is not configured.")

        access_token = await self.get_access_token()
        headers = self._get_headers(access_token)
        url = f"{self.books_api_url}/vendorpayments"
        params = {"organization_id": self.org_id}

        payload: Dict[str, Any] = {
            "vendor_id": request.vendor_id,
            "payment_mode": request.payment_mode,
            "amount": request.amount,
            "date": request.date,
            "reference_number": request.reference_number,
            "description": request.description,
        }
        if request.paid_through_account_id:
            payload["paid_through_account_id"] = request.paid_through_account_id
        if request.bills:
            payload["bills"] = [{"bill_id": b.bill_id, "amount_applied": b.amount_applied} for b in request.bills]

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers, params=params, json=payload)
            if response.status_code == 401:
                access_token = await self.get_access_token(force_refresh=True)
                headers = self._get_headers(access_token)
                response = await client.post(url, headers=headers, params=params, json=payload)

            response.raise_for_status()
            data = response.json()
            payment = data.get("vendorpayment", {})
            return ZohoVendorPaymentResponse(
                code=data.get("code", 0),
                message=data.get("message", "Success"),
                payment_id=str(payment.get("payment_id", "")),
                payment_number=payment.get("payment_number", ""),
                vendor_id=request.vendor_id,
                vendor_name=payment.get("vendor_name", ""),
                amount=float(payment.get("amount", request.amount)),
                payment_url=f"https://books.zoho.com/app#/vendorpayments/{payment.get('payment_id')}",
            )

    @retry(
        reraise=True,
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
    )
    async def create_direct_expense(self, request: ZohoExpenseRequest) -> ZohoExpenseResponse:
        """Records a direct expense / petty cash disbursement in Zoho Books."""
        if not self.org_id:
            raise ValueError("Cannot create direct expense: Zoho Organization ID is not configured.")

        access_token = await self.get_access_token()
        headers = self._get_headers(access_token)
        url = f"{self.books_api_url}/expenses"
        params = {"organization_id": self.org_id}

        payload: Dict[str, Any] = {
            "account_id": request.account_id,
            "paid_through_account_id": request.paid_through_account_id,
            "date": request.date,
            "amount": request.amount,
            "reference_number": request.reference_number,
            "description": request.description,
        }
        if request.vendor_id:
            payload["vendor_id"] = request.vendor_id

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers, params=params, json=payload)
            if response.status_code == 401:
                access_token = await self.get_access_token(force_refresh=True)
                headers = self._get_headers(access_token)
                response = await client.post(url, headers=headers, params=params, json=payload)

            response.raise_for_status()
            data = response.json()
            expense = data.get("expense", {})
            return ZohoExpenseResponse(
                code=data.get("code", 0),
                message=data.get("message", "Success"),
                expense_id=str(expense.get("expense_id", "")),
                account_name=expense.get("account_name", ""),
                amount=float(expense.get("amount", request.amount)),
                expense_url=f"https://books.zoho.com/app#/expenses/{expense.get('expense_id')}",
            )

    @retry(
        reraise=True,
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
    )
    async def create_credit_note(self, request: ZohoCreditNoteRequest) -> ZohoCreditNoteResponse:
        """Creates a Credit Note in Zoho Books."""
        if not self.org_id:
            raise ValueError("Cannot create credit note: Zoho Organization ID is not configured.")

        access_token = await self.get_access_token()
        headers = self._get_headers(access_token)
        url = f"{self.books_api_url}/creditnotes"
        params = {"organization_id": self.org_id}

        payload: Dict[str, Any] = {
            "customer_id": request.customer_id,
            "date": request.date,
            "line_items": request.line_items,
            "reference_number": request.reference_number,
            "notes": request.notes,
        }
        if request.creditnote_number:
            payload["creditnote_number"] = request.creditnote_number

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers, params=params, json=payload)
            if response.status_code == 401:
                access_token = await self.get_access_token(force_refresh=True)
                headers = self._get_headers(access_token)
                response = await client.post(url, headers=headers, params=params, json=payload)

            response.raise_for_status()
            data = response.json()
            cn = data.get("creditnote", {})
            return ZohoCreditNoteResponse(
                code=data.get("code", 0),
                message=data.get("message", "Success"),
                creditnote_id=str(cn.get("creditnote_id", "")),
                creditnote_number=cn.get("creditnote_number", ""),
                total=float(cn.get("total", 0.0)),
                creditnote_url=f"https://books.zoho.com/app#/creditnotes/{cn.get('creditnote_id')}",
            )

    @retry(
        reraise=True,
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
    )
    async def create_bank_transaction(
        self, request: ZohoBankTransactionRequest
    ) -> ZohoBankTransactionResponse:
        """Feeds a bank statement transaction line into Zoho Books."""
        if not self.org_id:
            raise ValueError("Cannot create bank transaction: Zoho Organization ID is not configured.")

        access_token = await self.get_access_token()
        headers = self._get_headers(access_token)
        url = f"{self.books_api_url}/banktransactions"
        params = {"organization_id": self.org_id}

        payload: Dict[str, Any] = {
            "from_account_id": request.from_account_id,
            "transaction_type": request.transaction_type,
            "date": request.date,
            "amount": request.amount,
            "description": request.description,
            "reference_number": request.reference_number,
            "payee": request.payee,
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers, params=params, json=payload)
            if response.status_code == 401:
                access_token = await self.get_access_token(force_refresh=True)
                headers = self._get_headers(access_token)
                response = await client.post(url, headers=headers, params=params, json=payload)

            response.raise_for_status()
            data = response.json()
            btx = data.get("bank_transaction", {})
            return ZohoBankTransactionResponse(
                code=data.get("code", 0),
                message=data.get("message", "Success"),
                transaction_id=str(btx.get("transaction_id", "")),
                transaction_type=btx.get("transaction_type", request.transaction_type),
                amount=float(btx.get("amount", request.amount)),
                status=btx.get("status", "uncategorized"),
            )

    @retry(
        reraise=True,
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
    )
    async def fetch_bank_accounts(self) -> List[Dict[str, Any]]:
        """Fetches bank accounts registered in Zoho Books API (/bankaccounts)."""
        if not self.org_id:
            return []

        access_token = await self.get_access_token()
        headers = self._get_headers(access_token)
        url = f"{self.books_api_url}/bankaccounts"
        params: Dict[str, Any] = {"organization_id": self.org_id}

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=headers, params=params)
            if response.status_code == 401:
                access_token = await self.get_access_token(force_refresh=True)
                headers = self._get_headers(access_token)
                response = await client.get(url, headers=headers, params=params)

            response.raise_for_status()
            data = response.json()
            return data.get("bankaccounts", [])

    @retry(
        reraise=True,
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
    )
    async def fetch_bank_transactions(
        self,
        account_id: Optional[str] = None,
        status: Optional[str] = None,
        date_start: Optional[str] = None,
        date_end: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Fetches bank transactions from Zoho Books API (/banktransactions)."""
        if not self.org_id:
            return []

        access_token = await self.get_access_token()
        headers = self._get_headers(access_token)
        url = f"{self.books_api_url}/banktransactions"
        params: Dict[str, Any] = {"organization_id": self.org_id}
        if account_id:
            params["account_id"] = account_id
        if status and str(status).upper() != "ALL":
            params["filter_by"] = f"Status.{status.capitalize()}"
        if date_start:
            params["date_start"] = date_start
        if date_end:
            params["date_end"] = date_end

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=headers, params=params)
            if response.status_code == 401:
                access_token = await self.get_access_token(force_refresh=True)
                headers = self._get_headers(access_token)
                response = await client.get(url, headers=headers, params=params)

            response.raise_for_status()
            data = response.json()
            return data.get("banktransactions", [])

    @retry(
        reraise=True,
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
    )
    async def fetch_account_transactions(
        self,
        account_id: str,
        account_name: Optional[str] = None,
        date_start: Optional[str] = None,
        date_end: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Fetches transactions for a specific chart of accounts or general ledger account from Zoho Books.
        
        Searches across:
        1. /expenses (for expense accounts like 'Uncate Outflows' where entries are created as Expenses)
        2. /registers/{account_id}/transactions (standard Zoho Books ledger register endpoint)
        3. /chartofaccounts/transactions and /chartofaccounts/accounttransactions
        4. /journals (manual journal entries)
        5. /banktransactions?account_id={account_id}
        """
        if not self.org_id:
            return []

        access_token = await self.get_access_token()
        headers = self._get_headers(access_token)

        combined_txs: List[Dict[str, Any]] = []
        seen_keys = set()

        def _add_tx(t: Dict[str, Any]):
            tid = str(t.get("transaction_id") or t.get("expense_id") or t.get("journal_id") or "")
            tdate = str(t.get("transaction_date") or t.get("date") or "")
            tamt = str(t.get("amount") or t.get("total") or t.get("debit_amount") or "")
            tdesc = str(t.get("description") or t.get("vendor_name") or t.get("customer_name") or "")
            key = f"{tid}:{tdate}:{tamt}:{tdesc}" if tid else f"{tdate}:{tamt}:{tdesc}"
            if key not in seen_keys:
                seen_keys.add(key)
                combined_txs.append(t)

        async with httpx.AsyncClient(timeout=30.0) as client:
            # -------------------------------------------------------------
            # 1. EXPENSES: Query /expenses (Directly captures Expense transactions)
            # -------------------------------------------------------------
            try:
                exp_url = f"{self.books_api_url}/expenses"
                exp_params: Dict[str, Any] = {"organization_id": self.org_id}
                if date_start:
                    exp_params["date_start"] = date_start
                if date_end:
                    exp_params["date_end"] = date_end

                exp_res = await client.get(exp_url, headers=headers, params=exp_params)
                if exp_res.status_code == 401:
                    access_token = await self.get_access_token(force_refresh=True)
                    headers = self._get_headers(access_token)
                    exp_res = await client.get(exp_url, headers=headers, params=exp_params)

                raw_expenses = []
                if exp_res.status_code == 200:
                    raw_expenses = exp_res.json().get("expenses", [])

                # Fallback: if date filter returned 0, fetch all expenses to catch any period
                if not raw_expenses and (date_start or date_end):
                    all_exp_res = await client.get(exp_url, headers=headers, params={"organization_id": self.org_id})
                    if all_exp_res.status_code == 200:
                        raw_expenses = all_exp_res.json().get("expenses", [])

                for exp in raw_expenses:
                    e_acc_id = str(exp.get("account_id", ""))
                    e_paid_id = str(exp.get("paid_through_account_id", ""))
                    e_acc_name = str(exp.get("account_name", "")).strip().lower()
                    target_id = str(account_id)
                    target_name = str(account_name or "").strip().lower()

                    matches = (
                        e_acc_id == target_id
                        or e_paid_id == target_id
                        or (target_name and (e_acc_name == target_name or target_name in e_acc_name))
                    )
                    if matches:
                        formatted_exp = {
                            "transaction_id": exp.get("expense_id") or exp.get("transaction_id"),
                            "expense_id": exp.get("expense_id"),
                            "date": exp.get("date"),
                            "transaction_date": exp.get("date"),
                            "amount": float(exp.get("total", 0.0) or exp.get("amount", 0.0) or exp.get("bcy_total", 0.0) or 0.0),
                            "total": float(exp.get("total", 0.0) or exp.get("amount", 0.0) or 0.0),
                            "debit_amount": float(exp.get("total", 0.0) or exp.get("amount", 0.0) or 0.0),
                            "transaction_type": "EXPENSE",
                            "vendor_name": exp.get("vendor_name"),
                            "customer_name": exp.get("customer_name"),
                            "payee": exp.get("vendor_name") or exp.get("customer_name"),
                            "description": (
                                exp.get("description")
                                or exp.get("vendor_name")
                                or exp.get("customer_name")
                                or f"Expense in {exp.get('account_name', account_name or 'Watched Account')}"
                            ),
                            "reference_number": exp.get("reference_number"),
                            "account_id": e_acc_id or target_id,
                            "account_name": exp.get("account_name") or account_name,
                        }
                        _add_tx(formatted_exp)

                if combined_txs:
                    logger.info(f"Fetched {len(combined_txs)} expense transactions from /expenses for account {account_id} ({account_name}).")
            except Exception as exp_err:
                logger.warning(f"Error querying /expenses for account {account_id}: {exp_err}")

            # -------------------------------------------------------------
            # 2. REGISTERS: /registers/{account_id}/transactions
            # -------------------------------------------------------------
            try:
                reg_url = f"{self.books_api_url}/registers/{account_id}/transactions"
                reg_params: Dict[str, Any] = {"organization_id": self.org_id}
                if date_start and date_end:
                    reg_params["filter_by"] = "TransactionDate.CustomDate"
                    reg_params["from_date"] = date_start
                    reg_params["to_date"] = date_end
                elif date_start:
                    reg_params["from_date"] = date_start
                elif date_end:
                    reg_params["to_date"] = date_end

                r_res = await client.get(reg_url, headers=headers, params=reg_params)
                if r_res.status_code == 401:
                    access_token = await self.get_access_token(force_refresh=True)
                    headers = self._get_headers(access_token)
                    r_res = await client.get(reg_url, headers=headers, params=reg_params)

                r_txs = []
                if r_res.status_code == 200:
                    r_data = r_res.json()
                    r_txs = (
                        r_data.get("register_transactions")
                        or r_data.get("account_transactions")
                        or r_data.get("transactions")
                        or []
                    )
                elif date_start or date_end:
                    # Fallback to no date filter
                    all_r_res = await client.get(reg_url, headers=headers, params={"organization_id": self.org_id})
                    if all_r_res.status_code == 200:
                        all_r_data = all_r_res.json()
                        r_txs = (
                            all_r_data.get("register_transactions")
                            or all_r_data.get("account_transactions")
                            or all_r_data.get("transactions")
                            or []
                        )

                for r_item in r_txs:
                    _add_tx(r_item)
            except Exception as r_err:
                logger.warning(f"Notice querying /registers/{account_id}/transactions: {r_err}")

            # -------------------------------------------------------------
            # 3. CHART OF ACCOUNTS: /chartofaccounts/transactions & /accounttransactions
            # -------------------------------------------------------------
            for coa_endpoint in ["transactions", "accounttransactions"]:
                try:
                    c_url = f"{self.books_api_url}/chartofaccounts/{coa_endpoint}"
                    c_params: Dict[str, Any] = {
                        "organization_id": self.org_id,
                        "account_id": account_id,
                    }
                    if date_start:
                        c_params["date_start"] = date_start
                    if date_end:
                        c_params["date_end"] = date_end

                    c_res = await client.get(c_url, headers=headers, params=c_params)
                    if c_res.status_code == 200:
                        c_data = c_res.json()
                        c_list = (
                            c_data.get("account_transactions")
                            or c_data.get("transactions")
                            or c_data.get("chartofaccounts", [])
                        )
                        for c_item in (c_list or []):
                            _add_tx(c_item)
                except Exception as coa_err:
                    logger.debug(f"Notice querying /chartofaccounts/{coa_endpoint}: {coa_err}")

            # -------------------------------------------------------------
            # 4. JOURNALS: /journals (Manual journals affecting account)
            # -------------------------------------------------------------
            try:
                j_url = f"{self.books_api_url}/journals"
                j_params: Dict[str, Any] = {"organization_id": self.org_id}
                if date_start:
                    j_params["date_start"] = date_start
                if date_end:
                    j_params["date_end"] = date_end

                j_res = await client.get(j_url, headers=headers, params=j_params)
                if j_res.status_code == 200:
                    j_list = j_res.json().get("journals", [])
                    for j_item in j_list:
                        j_account_id = str(j_item.get("account_id", ""))
                        if j_account_id == str(account_id):
                            _add_tx(j_item)
            except Exception as j_err:
                logger.debug(f"Notice querying /journals: {j_err}")

            # -------------------------------------------------------------
            # 5. CUSTOMER PAYMENTS: /customerpayments (Inflows / payments deposited to account)
            # -------------------------------------------------------------
            try:
                cp_url = f"{self.books_api_url}/customerpayments"
                cp_params: Dict[str, Any] = {"organization_id": self.org_id}
                if date_start:
                    cp_params["date_start"] = date_start
                if date_end:
                    cp_params["date_end"] = date_end

                cp_res = await client.get(cp_url, headers=headers, params=cp_params)
                if cp_res.status_code == 200:
                    raw_payments = cp_res.json().get("customerpayments", [])
                    for cp in raw_payments:
                        cp_acc_id = str(cp.get("account_id", ""))
                        cp_acc_name = str(cp.get("account_name", "")).strip().lower()
                        target_id = str(account_id)
                        target_name = str(account_name or "").strip().lower()
                        if cp_acc_id == target_id or (target_name and (cp_acc_name == target_name or target_name in cp_acc_name)):
                            _add_tx({
                                "transaction_id": cp.get("payment_id"),
                                "date": cp.get("date"),
                                "transaction_date": cp.get("date"),
                                "amount": float(cp.get("amount", 0.0) or cp.get("bcy_amount", 0.0) or 0.0),
                                "credit_amount": float(cp.get("amount", 0.0) or 0.0),
                                "transaction_type": "CREDIT",
                                "customer_name": cp.get("customer_name"),
                                "payee": cp.get("customer_name"),
                                "description": cp.get("description") or cp.get("reference_number") or f"Payment from {cp.get('customer_name')}",
                                "reference_number": cp.get("payment_number") or cp.get("reference_number"),
                                "account_id": cp_acc_id or target_id,
                                "account_name": cp.get("account_name") or account_name,
                            })
            except Exception as cp_err:
                logger.debug(f"Notice querying /customerpayments: {cp_err}")

            # -------------------------------------------------------------
            # 6. BANK TRANSACTIONS: /banktransactions?account_id={account_id}
            # -------------------------------------------------------------
            try:
                b_url = f"{self.books_api_url}/banktransactions"
                b_params: Dict[str, Any] = {
                    "organization_id": self.org_id,
                    "account_id": account_id,
                }
                if date_start:
                    b_params["from_date"] = date_start
                if date_end:
                    b_params["to_date"] = date_end

                b_res = await client.get(b_url, headers=headers, params=b_params)
                if b_res.status_code == 200:
                    b_txs = b_res.json().get("banktransactions", [])
                    for b_item in b_txs:
                        _add_tx(b_item)
            except Exception as b_err:
                logger.debug(f"Notice querying /banktransactions for account {account_id}: {b_err}")

        logger.info(f"Total transactions fetched for account {account_id} ({account_name or ''}): {len(combined_txs)}.")
        return combined_txs

    @retry(
        reraise=True,
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
    )
    async def create_journal_entry(self, request: ZohoJournalRequest) -> ZohoJournalResponse:
        """Posts a balanced double-entry manual journal into Zoho Books."""
        if not self.org_id:
            raise ValueError("Cannot create journal entry: Zoho Organization ID is not configured.")

        access_token = await self.get_access_token()
        headers = self._get_headers(access_token)
        url = f"{self.books_api_url}/journalentries"
        params = {"organization_id": self.org_id}

        payload: Dict[str, Any] = {
            "journal_date": request.journal_date,
            "journal_entries": [
                {
                    "account_id": e.account_id,
                    "debit_or_credit": e.debit_or_credit,
                    "amount": e.amount,
                    "description": e.description,
                }
                for e in request.journal_entries
            ],
            "reference_number": request.reference_number,
            "notes": request.notes,
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers, params=params, json=payload)
            if response.status_code == 401:
                access_token = await self.get_access_token(force_refresh=True)
                headers = self._get_headers(access_token)
                response = await client.post(url, headers=headers, params=params, json=payload)

            response.raise_for_status()
            data = response.json()
            jrnl = data.get("journal_entry", {})
            return ZohoJournalResponse(
                code=data.get("code", 0),
                message=data.get("message", "Success"),
                journal_id=str(jrnl.get("journal_id", "")),
                journal_date=jrnl.get("journal_date", request.journal_date),
                total=float(jrnl.get("total", 0.0)),
                journal_url=f"https://books.zoho.com/app#/journals/{jrnl.get('journal_id')}",
            )



