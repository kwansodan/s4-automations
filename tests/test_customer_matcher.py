"""Unit tests for intelligent CustomerMatcher and driver shorthand reconciliation."""

import pytest
from app.models.schemas import ZohoContact
from app.services.customer_matcher import (
    CustomerMatcher,
    normalize_customer_name,
    extract_canonical_core,
    generate_candidate_aliases_from_zoho_name,
)

SAMPLE_CONTACTS = [
    ZohoContact(contact_id="10001", contact_name="Clifton homes - The Gallery", company_name="Clifton Homes Ltd", status="active"),
    ZohoContact(contact_id="10002", contact_name="Clifton Homes - Embassy Gardens", company_name="Clifton Homes Ltd", status="active"),
    ZohoContact(contact_id="10003", contact_name="The Lennox - Airport", company_name="Lennox Hospitality", status="active"),
    ZohoContact(contact_id="10004", contact_name="Kwarleyz Residence", company_name="Kwarleyz Group", status="active"),
    ZohoContact(contact_id="10005", contact_name="Active 8 Spintex", company_name="Active 8 Ltd", status="active"),
]


def test_normalize_customer_name():
    assert normalize_customer_name("  Clifton Homes - The Gallery  ") == "clifton homes the gallery"
    assert normalize_customer_name("The   Gallery!!!") == "the gallery"


def test_extract_canonical_core():
    # Strips "Clifton homes - " and "The "
    assert extract_canonical_core("Clifton homes - The Gallery") == "gallery"
    # Strips "Clifton Homes - " and "Gardens"
    assert extract_canonical_core("Clifton Homes - Embassy Gardens") == "embassy"
    # Strips "Residence"
    assert extract_canonical_core("Kwarleyz Residence") == "kwarleyz"


def test_match_driver_writing_gallery():
    # Driver writes "Gallery"
    res1 = CustomerMatcher.match_customer("Gallery", SAMPLE_CONTACTS)
    assert res1.is_auto_matched is True
    assert res1.matched_contact_id == "10001"
    assert res1.matched_contact_name == "Clifton homes - The Gallery"
    assert res1.confidence_score >= 0.85

    # Driver writes "the gallery"
    res2 = CustomerMatcher.match_customer("the gallery", SAMPLE_CONTACTS)
    assert res2.is_auto_matched is True
    assert res2.matched_contact_id == "10001"
    assert res2.matched_contact_name == "Clifton homes - The Gallery"


def test_match_driver_writing_embassy():
    # Driver writes "Embassy"
    res = CustomerMatcher.match_customer("Embassy", SAMPLE_CONTACTS)
    assert res.is_auto_matched is True
    assert res.matched_contact_id == "10002"
    assert res.matched_contact_name == "Clifton Homes - Embassy Gardens"


def test_match_driver_misspelling_fuzzy():
    # Driver writes typo "Galery" instead of "Gallery"
    res = CustomerMatcher.match_customer("Galery", SAMPLE_CONTACTS)
    assert res.matched_contact_id == "10001"
    assert res.confidence_score >= 0.80
    assert "Clifton homes - The Gallery" in [c.contact_name for c in res.candidate_suggestions]


def test_explicit_alias_precedence():
    # Operator saved custom alias "G-Block" -> 10001
    mappings = {
        "G-Block": {
            "zoho_contact_id": "10001",
            "name": "Clifton homes - The Gallery",
        }
    }
    res = CustomerMatcher.match_customer("g-block", SAMPLE_CONTACTS, customer_mappings=mappings)
    assert res.is_auto_matched is True
    assert res.matched_contact_id == "10001"
    assert res.match_tier == "ALIAS"


def test_generate_candidate_aliases():
    aliases = generate_candidate_aliases_from_zoho_name("Clifton homes - The Gallery")
    assert "The Gallery" in aliases
    assert "Gallery" in aliases

    aliases_embassy = generate_candidate_aliases_from_zoho_name("Clifton Homes - Embassy Gardens")
    assert "Embassy" in aliases_embassy or "Embassy Gardens" in aliases_embassy
