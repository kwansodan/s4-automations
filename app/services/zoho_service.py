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
    MonthlySKUSummary,
)
from app.utils.logging import get_logger

logger = get_logger("zoho_service")


class ZohoBooksService:
    """Handles communication with Zoho Books API including OAuth2 token management."""

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

        self._access_token: Optional[str] = None
        self._token_expiry_timestamp: float = 0.0

        # In-memory caches for fast reconciliation
        self._cached_contacts: List[ZohoContact] = []
        self._cached_items: List[ZohoItem] = []

    async def get_access_token(self, force_refresh: bool = False) -> str:
        """Retrieves a valid OAuth2 access token, refreshing if expired."""
        if settings.MOCK_MODE or not self.refresh_token:
            logger.info("Operating in Mock Mode for Zoho authentication.")
            return "mock-zoho-access-token"

        current_time = time.time()
        # Keep a 60-second buffer
        if not force_refresh and self._access_token and current_time < (self._token_expiry_timestamp - 60):
            return self._access_token

        token_url = f"{self.accounts_url}/oauth/v2/token"
        params = {
            "refresh_token": self.refresh_token,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "grant_type": "refresh_token",
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            logger.info(f"Refreshing Zoho OAuth2 token from {token_url}...")
            response = await client.post(token_url, params=params)
            
            if response.status_code != 200:
                logger.error(f"Zoho token refresh failed ({response.status_code}): {response.text}")
                raise RuntimeError(f"Zoho OAuth token refresh failed: {response.text}")

            data = response.json()
            if "access_token" not in data:
                error_msg = data.get("error", "Unknown OAuth error")
                logger.error(f"Zoho OAuth returned error: {error_msg}")
                raise RuntimeError(f"Zoho OAuth error: {error_msg}")

            self._access_token = data["access_token"]
            expires_in = data.get("expires_in", 3600)
            self._token_expiry_timestamp = current_time + expires_in
            logger.info(f"Zoho access token refreshed successfully. Valid for {expires_in}s.")
            return self._access_token

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
            logger.info(f"Fetched {len(contacts)} active contacts from Zoho Books.")
            return contacts

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
            logger.info(f"Fetched {len(items)} active items from Zoho Books catalog.")
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
            return ZohoDraftInvoiceResponse(
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
