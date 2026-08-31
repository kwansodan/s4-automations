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
