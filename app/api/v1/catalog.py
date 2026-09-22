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
    contacts = []
    items = []
    try:
        contacts = await zoho.fetch_active_contacts()
        items = await zoho.fetch_item_catalog()
    except Exception as e:
        logger.warning(f"Failed to fetch live Zoho catalog ({e}). Falling back to cached / default catalog.")

    # If items are empty (e.g. Zoho not configured or offline), populate from PostgreSQL staged transactions & master list
    if not items:
        item_map: Dict[str, Dict[str, Any]] = {}
        try:
            from sqlmodel import Session, text
            from app.db.session import get_engine
            with Session(get_engine()) as session:
                rows = session.exec(
                    text("""
                        SELECT item_or_description, AVG(rate_or_price) as avg_rate
                        FROM staged_transactions
                        WHERE item_or_description IS NOT NULL AND TRIM(item_or_description) != ''
                        GROUP BY item_or_description
                    """)
                ).all()
                for r in rows:
                    name = str(r[0]).strip()
                    rate = float(r[1] or 0.0)
                    slug = name.lower().replace(" ", "_").replace("/", "_")
                    item_map[name.lower()] = {
                        "item_id": f"item_{slug}",
                        "name": name,
                        "rate": round(rate, 2),
                        "description": f"Control slip linen item: {name}",
                        "status": "active",
                    }
        except Exception as db_err:
            logger.debug(f"Catalog fallback DB query notice: {db_err}")

        # Baseline linen catalog items
        mock_items = [
            {"item_id": "item_bed_sheet_dbl", "name": "Bed Sheet (Double / King)", "rate": 18.50, "description": "Commercial laundered double bed sheet", "status": "active"},
            {"item_id": "item_bed_sheet_sgl", "name": "Bed Sheet (Single)", "rate": 14.00, "description": "Commercial laundered single bed sheet", "status": "active"},
            {"item_id": "item_duvet_cover_king", "name": "Duvet Cover (King)", "rate": 25.00, "description": "Laundered king size duvet cover", "status": "active"},
            {"item_id": "item_pillow_case", "name": "Pillow Case", "rate": 6.50, "description": "Laundered standard pillow case", "status": "active"},
            {"item_id": "item_bath_towel", "name": "Bath Towel", "rate": 12.00, "description": "Heavyweight plush bath towel", "status": "active"},
            {"item_id": "item_hand_towel", "name": "Hand Towel", "rate": 7.00, "description": "Cotton hand towel", "status": "active"},
            {"item_id": "item_face_towel", "name": "Face Towel", "rate": 4.50, "description": "Small face towel / washcloth", "status": "active"},
            {"item_id": "item_bath_mat", "name": "Bath Mat", "rate": 9.00, "description": "Hotel floor bath mat", "status": "active"},
            {"item_id": "item_pool_towel", "name": "Pool Towel (Stripe)", "rate": 15.00, "description": "Large striped pool towel", "status": "active"},
            {"item_id": "item_table_cloth", "name": "Table Cloth (Banquet)", "rate": 22.00, "description": "Pressed banquet table cloth", "status": "active"},
        ]
        for mi in mock_items:
            if mi["name"].lower() not in item_map:
                item_map[mi["name"].lower()] = mi

        items_list = list(item_map.values())
        items_list.sort(key=lambda x: x["name"])
    else:
        items_list = [i.model_dump() if hasattr(i, "model_dump") else dict(i) for i in items]

    if not contacts:
        contacts_list = [
            {"contact_id": "cnt_luxwood_001", "contact_name": "Luxwood", "company_name": "Luxwood Hotel & Suites"},
            {"contact_id": "cnt_the_bantree_002", "contact_name": "The Bantree", "company_name": "The Bantree Residences"},
            {"contact_id": "cnt_the_lennox_003", "contact_name": "The Lennox", "company_name": "The Lennox Luxury Apartments"},
            {"contact_id": "cnt_active8_004", "contact_name": "Active 8 Spintex", "company_name": "Active 8 Spintex"},
            {"contact_id": "cnt_maharaja_005", "contact_name": "Maharaja", "company_name": "Maharaja Restaurant & Suites"},
        ]
    else:
        contacts_list = [c.model_dump() if hasattr(c, "model_dump") else dict(c) for c in contacts]

    return {
        "organization_id": organization_id or zoho.org_id,
        "contacts_count": len(contacts_list),
        "items_count": len(items_list),
        "contacts": contacts_list,
        "items": items_list,
    }
