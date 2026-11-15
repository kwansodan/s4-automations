"""Pytest fixtures for ANR billing service."""

import pytest
from typing import List
from app.config import settings
from app.models.schemas import (
    ZohoContact,
    ZohoItem,
    OCRSlipExtraction,
    OCRSlipItem,
    ConfidenceLevel,
)

# Enable mock mode globally during tests
settings.MOCK_MODE = True


@pytest.fixture(autouse=True, scope="session")
def setup_test_db():
    from app.db.session import init_db
    init_db()


# ZohoBooksService test harness shims for isolated testing
from app.services.zoho_service import ZohoBooksService
from app.models.schemas import ZohoDraftInvoiceResponse
import uuid

if not hasattr(ZohoBooksService, "_global_mock_draft_invoices"):
    ZohoBooksService._global_mock_draft_invoices = {}

_real_create_draft = ZohoBooksService.create_draft_invoice
_real_find_existing = ZohoBooksService.find_existing_draft_invoice
_real_create_or_append = ZohoBooksService.create_or_append_draft_invoice
_real_delete_draft = getattr(ZohoBooksService, "delete_draft_invoice", None)


async def _test_create_draft_invoice(self, request):
    if self.can_transact():
        return await _real_create_draft(self, request)
    inv_id = f"inv_mock_{uuid.uuid4().hex[:8]}"
    inv_num = f"INV-TEST-{uuid.uuid4().hex[:6].upper()}"
    total = sum(float(li.rate) * float(li.quantity) for li in request.line_items)
    c_name = getattr(request, "customer_name", None) or "Test Customer"
    res = ZohoDraftInvoiceResponse(
        invoice_id=inv_id,
        invoice_number=inv_num,
        customer_id=request.customer_id,
        customer_name=c_name,
        status="draft",
        total=total,
        date=request.date,
        due_date=request.due_date,
        currency_code="GHS",
    )
    mock_dict = {
        "invoice_id": inv_id,
        "invoice_number": inv_num,
        "customer_id": request.customer_id,
        "customer_name": res.customer_name,
        "total": total,
        "status": "draft",
        "date": request.date,
        "due_date": request.due_date,
        "terms": request.terms,
        "notes": request.notes,
        "line_items": [li.model_dump() for li in request.line_items],
    }
    ZohoBooksService._global_mock_draft_invoices[f"{request.customer_id}_{request.date}"] = mock_dict
    ZohoBooksService._global_mock_draft_invoices[f"{getattr(self, 'client_id', '')}:{request.customer_id}:{request.date}"] = mock_dict
    return res


async def _test_delete_draft_invoice(self, invoice_id: str) -> bool:
    if not invoice_id or not str(invoice_id).strip():
        raise ValueError("invoice_id must be provided for draft deletion")
    if self.can_transact() and _real_delete_draft:
        return await _real_delete_draft(self, invoice_id)
    to_del = [k for k, v in getattr(ZohoBooksService, "_global_mock_draft_invoices", {}).items() if v.get("invoice_id") == invoice_id or v.get("invoice_number") == invoice_id]
    for k in to_del:
        ZohoBooksService._global_mock_draft_invoices.pop(k, None)
    return True


async def _test_find_existing_draft_invoice(self, customer_id: str, month: str, year: int):
    if self.can_transact():
        return await _real_find_existing(self, customer_id, month, year)
    for k, v in getattr(ZohoBooksService, "_global_mock_draft_invoices", {}).items():
        if v.get("customer_id") == customer_id:
            v_date = str(v.get("date", ""))
            if month.lower() in str(v).lower() or str(year) in v_date:
                return v
    return None


async def _test_create_or_append_draft_invoice(self, request, month: str, year: int, due_date=None, terms=None):
    if due_date:
        request.due_date = due_date
    if terms:
        request.terms = terms
    if self.can_transact():
        return await _real_create_or_append(self, request, month, year, due_date=due_date, terms=terms)
    existing = await self.find_existing_draft_invoice(request.customer_id, month, year)
    if existing:
        existing["line_items"].extend([li.model_dump() for li in request.line_items])
        existing["total"] = sum(float(li.get("rate", 0)) * float(li.get("quantity", 0)) for li in existing["line_items"])
        if due_date:
            existing["due_date"] = due_date
        return ZohoDraftInvoiceResponse(
            invoice_id=existing["invoice_id"],
            invoice_number=existing["invoice_number"],
            customer_id=request.customer_id,
            customer_name=existing["customer_name"],
            status="draft",
            total=existing["total"],
            date=existing["date"],
            due_date=due_date or existing.get("due_date"),
            currency_code="GHS",
        )
    return await self.create_draft_invoice(request)


setattr(ZohoBooksService, "create_draft_invoice", _test_create_draft_invoice)
setattr(ZohoBooksService, "delete_draft_invoice", _test_delete_draft_invoice)
setattr(ZohoBooksService, "find_existing_draft_invoice", _test_find_existing_draft_invoice)
setattr(ZohoBooksService, "create_or_append_draft_invoice", _test_create_or_append_draft_invoice)


@pytest.fixture(autouse=True)
def override_admin_auth():
    """Overrides require_admin_user dependency during tests so standard client requests are authorized."""
    from app.main import app
    from app.api.deps import require_admin_user

    app.dependency_overrides[require_admin_user] = lambda: {
        "id": "admin_test",
        "email": "admin@service4gh.com",
        "role": "admin",
        "name": "Test Platform Administrator",
    }
    yield
    app.dependency_overrides.pop(require_admin_user, None)


@pytest.fixture
def sample_zoho_items() -> List[ZohoItem]:
    return [
        ZohoItem(item_id="item_bed_sheet_dbl", name="Bed Sheet (Double / King)", rate=18.50, description="Commercial double sheet"),
        ZohoItem(item_id="item_bed_sheet_sgl", name="Bed Sheet (Single)", rate=14.00, description="Commercial single sheet"),
        ZohoItem(item_id="item_duvet_cover_king", name="Duvet Cover (King)", rate=25.00, description="King duvet cover"),
        ZohoItem(item_id="item_pillow_case", name="Pillow Case", rate=6.50, description="Standard pillow case"),
        ZohoItem(item_id="item_bath_towel", name="Bath Towel", rate=12.00, description="Plush bath towel"),
        ZohoItem(item_id="item_hand_towel", name="Hand Towel", rate=7.00, description="Hand towel"),
        ZohoItem(item_id="item_face_towel", name="Face Towel", rate=4.50, description="Face towel"),
        ZohoItem(item_id="item_bath_mat", name="Bath Mat", rate=9.00, description="Bath mat"),
    ]


@pytest.fixture
def sample_zoho_contacts() -> List[ZohoContact]:
    return [
        ZohoContact(contact_id="cnt_luxwood_001", contact_name="Luxwood", company_name="Luxwood Hotel & Suites"),
        ZohoContact(contact_id="cnt_the_bantree_002", contact_name="The Bantree", company_name="The Bantree Residences"),
        ZohoContact(contact_id="cnt_the_lennox_003", contact_name="The Lennox", company_name="The Lennox Luxury Apartments"),
    ]


@pytest.fixture
def sample_ocr_extractions() -> List[OCRSlipExtraction]:
    return [
        OCRSlipExtraction(
            file_name="slip_aug15_01.jpg",
            client_name="Luxwood",
            slip_date="15/08/2026",
            items=[
                OCRSlipItem(
                    raw_item_name="B/Sheet Dbl",
                    standard_item_name="Bed Sheet (Double / King)",
                    zoho_item_id="item_bed_sheet_dbl",
                    unit_rate=18.50,
                    pickup_qty=30,
                    delivery_qty=28,
                    unreturned_loss_qty=2,
                    confidence_score=ConfidenceLevel.HIGH,
                ),
                OCRSlipItem(
                    raw_item_name="B/Towel",
                    standard_item_name="Bath Towel",
                    zoho_item_id="item_bath_towel",
                    unit_rate=12.00,
                    pickup_qty=40,
                    delivery_qty=40,
                    unreturned_loss_qty=0,
                    confidence_score=ConfidenceLevel.HIGH,
                ),
            ],
            overall_confidence=ConfidenceLevel.HIGH,
        ),
        OCRSlipExtraction(
            file_name="slip_aug16_02.jpg",
            client_name="Luxwood",
            slip_date="16/08/2026",
            items=[
                OCRSlipItem(
                    raw_item_name="Double Bedsheet",
                    standard_item_name="Bed Sheet (Double / King)",
                    zoho_item_id="item_bed_sheet_dbl",
                    unit_rate=18.50,
                    pickup_qty=20,
                    delivery_qty=20,
                    unreturned_loss_qty=0,
                    confidence_score=ConfidenceLevel.HIGH,
                ),
                OCRSlipItem(
                    raw_item_name="P/Case",
                    standard_item_name="Pillow Case",
                    zoho_item_id="item_pillow_case",
                    unit_rate=6.50,
                    pickup_qty=50,
                    delivery_qty=48,
                    unreturned_loss_qty=2,
                    confidence_score=ConfidenceLevel.MEDIUM,
                ),
            ],
            overall_confidence=ConfidenceLevel.MEDIUM,
        ),
    ]
