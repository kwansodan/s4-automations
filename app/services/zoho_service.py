"""Zoho Books API Service integration with OAuth2 refresh, Catalog sync, and Invoicing."""

import time
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
        if settings.MOCK_MODE or not self.refresh_token:
            logger.info(f"Operating in Mock Mode for Zoho authentication (client org: {self.org_id or 'default'}).")
            return "mock-zoho-access-token"

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
        if settings.MOCK_MODE or not self.org_id:
            logger.info("Using mock Zoho contacts catalog.")
            self._cached_contacts = [
                ZohoContact(contact_id="cnt_luxwood_001", contact_name="Luxwood", company_name="Luxwood Hotel & Suites"),
                ZohoContact(contact_id="cnt_the_bantree_002", contact_name="The Bantree", company_name="The Bantree Residences"),
                ZohoContact(contact_id="cnt_the_lennox_003", contact_name="The Lennox", company_name="The Lennox Luxury Apartments"),
                ZohoContact(contact_id="cnt_active8_004", contact_name="Active 8 Spintex", company_name="Active 8 Spintex"),
                ZohoContact(contact_id="cnt_maharaja_005", contact_name="Maharaja", company_name="Maharaja Restaurant & Suites"),
            ]
            return self._cached_contacts

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
    async def create_vendor_contact(self, vendor_name: str) -> ZohoContact:
        """Creates a new Vendor contact in Zoho Books."""
        if settings.MOCK_MODE or not self.org_id:
            logger.info(f"Mock: Created vendor {vendor_name}")
            new_vendor = ZohoContact(contact_id=f"cnt_mock_{int(time.time())}", contact_name=vendor_name, company_name=vendor_name)
            self._cached_contacts.append(new_vendor)
            return new_vendor

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
        if settings.MOCK_MODE or not self.org_id:
            logger.info("Using mock Zoho item catalog.")
            self._cached_items = [
                ZohoItem(item_id="item_bed_sheet_dbl", name="Bed Sheet (Double / King)", rate=18.50, description="Commercial laundered double bed sheet"),
                ZohoItem(item_id="item_bed_sheet_sgl", name="Bed Sheet (Single)", rate=14.00, description="Commercial laundered single bed sheet"),
                ZohoItem(item_id="item_duvet_cover_king", name="Duvet Cover (King)", rate=25.00, description="Laundered king size duvet cover"),
                ZohoItem(item_id="item_pillow_case", name="Pillow Case", rate=6.50, description="Laundered standard pillow case"),
                ZohoItem(item_id="item_bath_towel", name="Bath Towel", rate=12.00, description="Heavyweight plush bath towel"),
                ZohoItem(item_id="item_hand_towel", name="Hand Towel", rate=7.00, description="Cotton hand towel"),
                ZohoItem(item_id="item_face_towel", name="Face Towel", rate=4.50, description="Small face towel / washcloth"),
                ZohoItem(item_id="item_bath_mat", name="Bath Mat", rate=9.00, description="Hotel floor bath mat"),
                ZohoItem(item_id="item_pool_towel", name="Pool Towel (Stripe)", rate=15.00, description="Large striped pool towel"),
                ZohoItem(item_id="item_table_cloth", name="Table Cloth (Banquet)", rate=22.00, description="Pressed banquet table cloth"),
                ZohoItem(item_id="item_napkin", name="Napkin / Serviet", rate=3.50, description="Pressed cloth napkin"),
            ]
            return self._cached_items

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

        return None

    _global_mock_draft_invoices: Dict[str, Dict[str, Any]] = {}

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
        key = f"{customer_id}_{month}_{year}".lower()
        if settings.MOCK_MODE or not self.org_id:
            return ZohoBooksService._global_mock_draft_invoices.get(key)

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
        if settings.MOCK_MODE or not self.org_id:
            logger.info(f"[MOCK] Creating draft invoice for customer {request.customer_id}")
            total = sum(li.rate * li.quantity for li in request.line_items)
            mock_id = f"inv_mock_{int(time.time())}"
            mock_num = f"INV-ANR-{int(time.time()) % 100000:05d}"
            mock_res = ZohoDraftInvoiceResponse(
                code=0,
                message="Invoice created successfully (Mock)",
                invoice_id=mock_id,
                invoice_number=mock_num,
                customer_id=request.customer_id,
                customer_name="Client",
                total=total,
                status="draft",
                invoice_url=f"https://books.zoho.com/app#/invoices/{mock_id}",
            )
            return mock_res

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
        existing = await self.find_existing_draft_invoice(request.customer_id, month, year)
        key = f"{request.customer_id}_{month}_{year}".lower()

        if not existing:
            created = await self.create_draft_invoice(request)
            if settings.MOCK_MODE or not self.org_id:
                ZohoBooksService._global_mock_draft_invoices[key] = {
                    "invoice_id": created.invoice_id,
                    "invoice_number": created.invoice_number,
                    "customer_id": request.customer_id,
                    "customer_name": created.customer_name,
                    "total": created.total,
                    "status": "draft",
                    "notes": request.notes,
                    "line_items": [li.model_dump() for li in request.line_items],
                }
            return created

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

        if settings.MOCK_MODE or not self.org_id:
            new_total = sum(i["rate"] * i["quantity"] for i in combined_items)
            ZohoBooksService._global_mock_draft_invoices[key]["line_items"] = combined_items
            ZohoBooksService._global_mock_draft_invoices[key]["total"] = new_total
            logger.info(f"[MOCK] Appended {len(request.line_items)} items to existing Draft Invoice {invoice_num} (Total: GHS {new_total:.2f})")
            return ZohoDraftInvoiceResponse(
                code=0,
                message=f"Appended items to existing draft invoice {invoice_num} (Mock)",
                invoice_id=invoice_id,
                invoice_number=invoice_num,
                customer_id=request.customer_id,
                customer_name=existing.get("customer_name", "Client"),
                total=new_total,
                status="draft",
                invoice_url=f"https://books.zoho.com/app#/invoices/{invoice_id}",
            )

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
        if settings.MOCK_MODE or not self.org_id:
            mock_id = f"bill_mock_{int(time.time())}"
            mock_num = request.bill_number or f"BILL-MOCK-{int(time.time()) % 10000:04d}"
            total = sum(float(item.get("rate", 0)) * float(item.get("quantity", 1)) for item in request.line_items)
            logger.info(f"[MOCK] Created Draft Bill {mock_num} for vendor {request.vendor_id} (Total: GHS {total:.2f})")
            return ZohoDraftBillResponse(
                code=0,
                message="Bill created successfully (Mock)",
                bill_id=mock_id,
                bill_number=mock_num,
                vendor_id=request.vendor_id,
                vendor_name="Vendor",
                total=total,
                status="draft",
                bill_url=f"https://books.zoho.com/app#/bills/{mock_id}",
            )

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
        if settings.MOCK_MODE or not self.org_id:
            mock_id = f"pay_mock_{int(time.time())}"
            mock_num = f"PAY-{int(time.time()) % 100000:05d}"
            logger.info(f"[MOCK] Created Customer Payment {mock_num} of GHS {request.amount:.2f} for customer {request.customer_id}")
            return ZohoCustomerPaymentResponse(
                code=0,
                message="Customer payment recorded successfully (Mock)",
                payment_id=mock_id,
                payment_number=mock_num,
                customer_id=request.customer_id,
                customer_name="Client",
                amount=request.amount,
                payment_url=f"https://books.zoho.com/app#/customerpayments/{mock_id}",
            )

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
        if settings.MOCK_MODE or not self.org_id:
            mock_id = f"vpay_mock_{int(time.time())}"
            mock_num = f"VPAY-{int(time.time()) % 100000:05d}"
            logger.info(f"[MOCK] Created Vendor Payment {mock_num} of GHS {request.amount:.2f} for vendor {request.vendor_id}")
            return ZohoVendorPaymentResponse(
                code=0,
                message="Vendor payment recorded successfully (Mock)",
                payment_id=mock_id,
                payment_number=mock_num,
                vendor_id=request.vendor_id,
                vendor_name="Vendor",
                amount=request.amount,
                payment_url=f"https://books.zoho.com/app#/vendorpayments/{mock_id}",
            )

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
        if settings.MOCK_MODE or not self.org_id:
            mock_id = f"exp_mock_{int(time.time())}"
            logger.info(f"[MOCK] Created Direct Expense of GHS {request.amount:.2f} for account {request.account_id}")
            return ZohoExpenseResponse(
                code=0,
                message="Expense created successfully (Mock)",
                expense_id=mock_id,
                account_name="Operating Expense",
                amount=request.amount,
                expense_url=f"https://books.zoho.com/app#/expenses/{mock_id}",
            )

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
        if settings.MOCK_MODE or not self.org_id:
            mock_id = f"cn_mock_{int(time.time())}"
            mock_num = request.creditnote_number or f"CN-{int(time.time()) % 10000:04d}"
            tot = sum(float(it.get("rate", 0)) * float(it.get("quantity", 1)) for it in request.line_items)
            logger.info(f"[MOCK] Created Credit Note {mock_num} (Total: GHS {tot:.2f})")
            return ZohoCreditNoteResponse(
                code=0,
                message="Credit Note created (Mock)",
                creditnote_id=mock_id,
                creditnote_number=mock_num,
                total=tot,
                creditnote_url=f"https://books.zoho.com/app#/creditnotes/{mock_id}",
            )

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
        if settings.MOCK_MODE or not self.org_id:
            mock_id = f"btx_mock_{int(time.time())}"
            logger.info(f"[MOCK] Staged Bank Transaction {mock_id} ({request.transaction_type}: GHS {request.amount:.2f})")
            return ZohoBankTransactionResponse(
                code=0,
                message="Bank transaction created (Mock)",
                transaction_id=mock_id,
                transaction_type=request.transaction_type,
                amount=request.amount,
                status="uncategorized",
            )

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
    async def create_journal_entry(self, request: ZohoJournalRequest) -> ZohoJournalResponse:
        """Posts a balanced double-entry manual journal into Zoho Books."""
        if settings.MOCK_MODE or not self.org_id:
            mock_id = f"jrnl_mock_{int(time.time())}"
            tot = sum(e.amount for e in request.journal_entries if e.debit_or_credit == "debit")
            logger.info(f"[MOCK] Posted Manual Journal {mock_id} (Total Debits: GHS {tot:.2f})")
            return ZohoJournalResponse(
                code=0,
                message="Journal posted (Mock)",
                journal_id=mock_id,
                journal_date=request.journal_date,
                total=tot,
                journal_url=f"https://books.zoho.com/app#/journals/{mock_id}",
            )

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



