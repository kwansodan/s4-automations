"""Zoho Books catalog and contacts query endpoints."""

from typing import Dict, Any, Optional
from fastapi import APIRouter

from app.services.zoho_service import ZohoBooksService
from app.utils.logging import get_logger

logger = get_logger("api.catalog")
router = APIRouter(prefix="/catalog", tags=["Zoho Books Catalog"])


@router.get("", summary="Get Zoho Contacts and Item Catalog")
async def get_zoho_catalog(
    client_id: Optional[str] = None,
    organization_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Returns active Zoho contacts and item catalog scoped strictly to the client workspace."""
    client_obj = None
    client_name = None
    client_industry = ""

    if client_id:
        try:
            from sqlmodel import Session, select
            from app.db.session import get_engine
            from app.models.db_models import ClientOrganization
            with Session(get_engine()) as session:
                client_obj = session.exec(
                    select(ClientOrganization).where(
                        (ClientOrganization.id == client_id) | (ClientOrganization.name == client_id)
                    )
                ).first()
                if client_obj:
                    client_name = client_obj.name
                    client_industry = (client_obj.industry or "").lower()
        except Exception as e:
            logger.debug(f"Could not load client organization '{client_id}': {e}")

    # Determine is_laundry_client
    is_laundry = False
    if client_obj:
        if client_obj.id in ["anr_group", "anr"] or "laundry" in client_industry or "linen" in client_industry:
            is_laundry = True
    elif not client_id and not organization_id:
        is_laundry = True  # Legacy default for root playground

    # Initialize client-scoped Zoho service
    contacts = []
    items = []
    effective_org = organization_id

    if client_id:
        try:
            zoho = ZohoBooksService.from_client_id(client_id)
            if effective_org:
                zoho.org_id = effective_org
            elif client_obj and client_obj.zoho_org_id and client_obj.zoho_org_id != "782910482":
                zoho.org_id = client_obj.zoho_org_id
        except Exception:
            zoho = ZohoBooksService(org_id=effective_org)
    else:
        zoho = ZohoBooksService(org_id=effective_org)

    try:
        if zoho.org_id and zoho.refresh_token:
            contacts = await zoho.fetch_active_contacts()
            items = await zoho.fetch_item_catalog()
    except Exception as e:
        logger.warning(f"Failed to fetch live Zoho catalog for '{client_id or effective_org}' ({e}). Falling back to scoped catalog.")

    # If items are empty, populate strictly from THIS client's staged transactions
    if not items:
        item_map: Dict[str, Dict[str, Any]] = {}
        try:
            from sqlmodel import Session, text
            from app.db.session import get_engine
            with Session(get_engine()) as session:
                if client_id:
                    rows = session.exec(
                        text("""
                            SELECT item_or_description, AVG(rate_or_price) as avg_rate
                            FROM staged_transactions
                            WHERE (client_id = :cid OR client_id = :cname)
                              AND item_or_description IS NOT NULL 
                              AND TRIM(item_or_description) != ''
                            GROUP BY item_or_description
                        """),
                        {"cid": client_id, "cname": client_name or client_id}
                    ).all()
                elif is_laundry:
                    # Only fallback to laundry staged transactions if this is the default legacy laundry sandbox
                    rows = session.exec(
                        text("""
                            SELECT item_or_description, AVG(rate_or_price) as avg_rate
                            FROM staged_transactions
                            WHERE (client_id = 'anr_group' OR client_id = 'anr')
                              AND item_or_description IS NOT NULL 
                              AND TRIM(item_or_description) != ''
                            GROUP BY item_or_description
                        """)
                    ).all()
                else:
                    rows = []

                for r in rows:
                    name = str(r[0]).strip()
                    rate = float(r[1] or 0.0)
                    slug = name.lower().replace(" ", "_").replace("/", "_")
                    item_map[name.lower()] = {
                        "item_id": f"item_{slug}",
                        "name": name,
                        "rate": round(rate, 2),
                        "description": f"{client_name or 'Client'} item: {name}",
                        "status": "active",
                    }
        except Exception as db_err:
            logger.debug(f"Catalog fallback DB query notice: {db_err}")

        # Baseline linen catalog items ONLY for laundry clients
        if is_laundry:
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
        if is_laundry:
            contacts_list = [
                {"contact_id": "cnt_luxwood_001", "contact_name": "Luxwood", "company_name": "Luxwood Hotel & Suites"},
                {"contact_id": "cnt_the_bantree_002", "contact_name": "The Bantree", "company_name": "The Bantree Residences"},
                {"contact_id": "cnt_the_lennox_003", "contact_name": "The Lennox", "company_name": "The Lennox Luxury Apartments"},
                {"contact_id": "cnt_active8_004", "contact_name": "Active 8 Spintex", "company_name": "Active 8 Spintex"},
                {"contact_id": "cnt_maharaja_005", "contact_name": "Maharaja", "company_name": "Maharaja Restaurant & Suites"},
            ]
        elif client_id:
            contacts_list = []
            try:
                from sqlmodel import Session, select
                from app.db.session import get_engine
                from app.models.db_models import ClientContact
                with Session(get_engine()) as session:
                    cc_rows = session.exec(
                        select(ClientContact).where(ClientContact.client_id == client_id)
                    ).all()
                    for cc in cc_rows:
                        contacts_list.append({
                            "contact_id": f"cnt_{cc.id}",
                            "contact_name": cc.name,
                            "company_name": client_name or cc.name,
                            "email": cc.email,
                        })
            except Exception as cc_err:
                logger.debug(f"Could not load client contacts for '{client_id}': {cc_err}")

            if not contacts_list and client_obj:
                contacts_list = [{
                    "contact_id": f"cnt_{client_obj.id}",
                    "contact_name": client_obj.name,
                    "company_name": client_obj.name,
                    "email": client_obj.contact_email or "",
                }]
        else:
            contacts_list = []
    else:
        contacts_list = [c.model_dump() if hasattr(c, "model_dump") else dict(c) for c in contacts]

    return {
        "organization_id": effective_org or (client_obj.zoho_org_id if client_obj else None) or zoho.org_id,
        "client_id": client_id,
        "contacts_count": len(contacts_list),
        "items_count": len(items_list),
        "contacts": contacts_list,
        "items": items_list,
    }
