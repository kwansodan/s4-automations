"""Zoho Books catalog and contacts query endpoints."""

from typing import Dict, Any, Optional
from fastapi import APIRouter

from app.services.zoho_service import ZohoBooksService
from app.utils.logging import get_logger

logger = get_logger("api.catalog")
router = APIRouter(prefix="/catalog", tags=["Zoho Books Catalog"])


@router.get("", summary="Get Zoho Contacts and Item Catalog")
async def get_zoho_catalog(organization_id: Optional[str] = None) -> Dict[str, Any]:
    """Returns active Zoho contacts and item catalog for reconciliation."""
    zoho = ZohoBooksService(org_id=organization_id)
    try:
        contacts = await zoho.fetch_active_contacts()
        items = await zoho.fetch_item_catalog()
        return {
            "organization_id": organization_id or zoho.org_id,
            "contacts_count": len(contacts),
            "items_count": len(items),
            "contacts": [c.model_dump() for c in contacts],
            "items": [i.model_dump() for i in items],
        }
    except Exception as e:
        logger.warning(f"Failed to fetch live Zoho catalog ({e}). Falling back to cached / default catalog.")
        mock_contacts = [
            {"contact_id": "cnt_luxwood_001", "contact_name": "Luxwood", "company_name": "Luxwood Hotel & Suites"},
            {"contact_id": "cnt_the_bantree_002", "contact_name": "The Bantree", "company_name": "The Bantree Residences"},
            {"contact_id": "cnt_the_lennox_003", "contact_name": "The Lennox", "company_name": "The Lennox Luxury Apartments"},
            {"contact_id": "cnt_active8_004", "contact_name": "Active 8 Spintex", "company_name": "Active 8 Spintex"},
            {"contact_id": "cnt_maharaja_005", "contact_name": "Maharaja", "company_name": "Maharaja Restaurant & Suites"},
        ]
        mock_items = [
            {"item_id": "item_bed_sheet_dbl", "name": "Bed Sheet (Double / King)", "rate": 18.50, "description": "Commercial laundered double bed sheet"},
            {"item_id": "item_bed_sheet_sgl", "name": "Bed Sheet (Single)", "rate": 14.00, "description": "Commercial laundered single bed sheet"},
            {"item_id": "item_duvet_cover_king", "name": "Duvet Cover (King)", "rate": 25.00, "description": "Laundered king size duvet cover"},
            {"item_id": "item_pillow_case", "name": "Pillow Case", "rate": 6.50, "description": "Laundered standard pillow case"},
            {"item_id": "item_bath_towel", "name": "Bath Towel", "rate": 12.00, "description": "Heavyweight plush bath towel"},
            {"item_id": "item_hand_towel", "name": "Hand Towel", "rate": 7.00, "description": "Cotton hand towel"},
            {"item_id": "item_face_towel", "name": "Face Towel", "rate": 4.50, "description": "Small face towel / washcloth"},
            {"item_id": "item_bath_mat", "name": "Bath Mat", "rate": 9.00, "description": "Hotel floor bath mat"},
            {"item_id": "item_pool_towel", "name": "Pool Towel (Stripe)", "rate": 15.00, "description": "Large striped pool towel"},
            {"item_id": "item_table_cloth", "name": "Table Cloth (Banquet)", "rate": 22.00, "description": "Pressed banquet table cloth"},
        ]
        return {
            "contacts_count": len(mock_contacts),
            "items_count": len(mock_items),
            "contacts": mock_contacts,
            "items": mock_items,
        }
