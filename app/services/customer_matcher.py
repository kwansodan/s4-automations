"""Multi-tiered intelligent customer matching and driver shorthand reconciliation engine."""

import re
from difflib import SequenceMatcher
from typing import List, Dict, Any, Optional, Set, Tuple
from pydantic import BaseModel, Field

from app.models.schemas import ZohoContact
from app.utils.logging import get_logger

logger = get_logger("customer_matcher")

# Common prefixes in hospitality and property management
CHAIN_PREFIXES = [
    r"^clifton\s+homes\s*[-–:]\s*",
    r"^clifton\s+homes\s+",
    r"^kempinski\s+hotel\s*[-–:]\s*",
    r"^kempinski\s+",
    r"^marriott\s+hotel\s*[-–:]\s*",
    r"^marriott\s+",
    r"^accor\s+hotel\s*[-–:]\s*",
    r"^hilton\s+",
    r"^moevenpick\s+",
    r"^the\s+",
]

# Common industry entity suffixes that drivers frequently omit
ENTITY_SUFFIXES = [
    r"\s+apartments?$",
    r"\s+apts?$",
    r"\s+residence?$",
    r"\s+residences?$",
    r"\s+suites?$",
    r"\s+hotel\s*(&|and)?\s*suites?$",
    r"\s+hotel$",
    r"\s+gardens?$",
    r"\s+gdns?$",
    r"\s+court$",
    r"\s+towers?$",
    r"\s+villa$",
    r"\s+villas$",
    r"\s+lodge$",
    r"\s+guest\s*house$",
    r"\s+ltd\.?$",
    r"\s+limited$",
    r"\s+ghana$",
]

# Stop words to ignore during token intersection
STOP_WORDS = {
    "the", "and", "&", "at", "in", "by", "for", "of", "a", "an",
    "hotel", "suites", "suite", "residence", "residences", "apartments", "apartment",
    "gdn", "gdns", "gardens", "garden", "court", "tower", "towers", "ghana", "ltd", "limited",
}


class CustomerCandidate(BaseModel):
    contact_id: str
    contact_name: str
    company_name: Optional[str] = None
    similarity_score: float = Field(ge=0.0, le=1.0)
    match_tier: str


class CustomerMatchResult(BaseModel):
    raw_input_name: str
    matched_contact_id: Optional[str] = None
    matched_contact_name: Optional[str] = None
    confidence_score: float = Field(default=0.0, ge=0.0, le=1.0)
    match_tier: str = "UNMATCHED"  # EXACT, ALIAS, CANONICAL_TOKEN, SUBSTRING, FUZZY, UNMATCHED
    is_auto_matched: bool = False
    candidate_suggestions: List[CustomerCandidate] = Field(default_factory=list)


def normalize_customer_name(name: str) -> str:
    """Standardizes string by trimming, lowercasing, and normalizing whitespace and punctuation."""
    if not name:
        return ""
    cleaned = str(name).strip().lower()
    cleaned = re.sub(r"[\t\r\n]+", " ", cleaned)
    cleaned = re.sub(r"['\"`´’]", "", cleaned)
    cleaned = re.sub(r"[^\w\s]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def strip_chain_prefixes(name: str) -> str:
    """Strips parent chain and group prefixes (e.g. 'Clifton homes - The Gallery' -> 'The Gallery')."""
    s = normalize_customer_name(name)
    for pat in CHAIN_PREFIXES:
        s = re.sub(pat, "", s, flags=re.IGNORECASE).strip()
    return s


def strip_entity_suffixes(name: str) -> str:
    """Strips common entity suffixes (e.g. 'Gallery Apartments' -> 'Gallery')."""
    s = normalize_customer_name(name)
    for pat in ENTITY_SUFFIXES:
        s = re.sub(pat, "", s, flags=re.IGNORECASE).strip()
    return s


def extract_canonical_core(name: str) -> str:
    """Extracts the distilled core identifying name by stripping prefixes and suffixes."""
    s = strip_chain_prefixes(name)
    s = strip_entity_suffixes(s)
    # If stripping left nothing, fall back to normalized original
    return s if s else normalize_customer_name(name)


def extract_distinctive_tokens(name: str) -> Set[str]:
    """Returns set of non-stop-word tokens longer than 2 characters."""
    norm = normalize_customer_name(name)
    words = set(re.findall(r"[a-z0-9]+", norm))
    return {w for w in words if len(w) > 2 and w not in STOP_WORDS}


def calculate_similarity(a: str, b: str) -> float:
    """Calculates string similarity using SequenceMatcher after basic normalization."""
    norm_a = normalize_customer_name(a)
    norm_b = normalize_customer_name(b)
    if not norm_a or not norm_b:
        return 0.0
    if norm_a == norm_b:
        return 1.0
    return SequenceMatcher(None, norm_a, norm_b).ratio()


def generate_candidate_aliases_from_zoho_name(official_name: str) -> List[str]:
    """
    Generates intelligent driver shorthand aliases from an official Zoho Customer name.
    Example: 'Clifton homes - The Gallery' -> ['The Gallery', 'Gallery', 'Gallery Apartments']
    """
    if not official_name or not official_name.strip():
        return []

    aliases: List[str] = []
    clean_official = official_name.strip()

    # 1. Shorthand without chain prefix (e.g. "Clifton homes - The Gallery" -> "The Gallery")
    without_prefix = strip_chain_prefixes(clean_official)
    if without_prefix and without_prefix.lower() != clean_official.lower():
        aliases.append(without_prefix.title())

    # 2. Pure core name without prefix and without suffix (e.g. "Gallery")
    core = extract_canonical_core(clean_official)
    if core and core.lower() != clean_official.lower() and core.title() not in aliases:
        aliases.append(core.title())

    # 3. Handle 'The ...' variation
    if core:
        the_var = f"The {core.title()}"
        if the_var.lower() != clean_official.lower() and the_var not in aliases:
            aliases.append(the_var)

    # 4. Handle hyphen / dash split parts
    if "-" in clean_official:
        parts = [p.strip() for p in clean_official.split("-") if p.strip()]
        for p in parts:
            if len(p) > 3 and p.lower() != clean_official.lower() and p.title() not in aliases:
                aliases.append(p.title())

    # 5. Handle colon or slash splits
    for delim in [":", "/", "|"]:
        if delim in clean_official:
            parts = [p.strip() for p in clean_official.split(delim) if p.strip()]
            for p in parts:
                if len(p) > 3 and p.lower() != clean_official.lower() and p.title() not in aliases:
                    aliases.append(p.title())

    return list(dict.fromkeys(aliases))


class CustomerMatcher:
    """
    Multi-tiered resolver for matching handwritten driver customer names against official Zoho Contacts.
    """

    AUTO_MATCH_THRESHOLD = 0.85
    SUGGESTION_THRESHOLD = 0.50

    @classmethod
    def match_customer(
        cls,
        raw_name: Optional[str] = None,
        contacts: Optional[List[ZohoContact]] = None,
        customer_mappings: Optional[Dict[str, Any]] = None,
        **kwargs,
    ) -> CustomerMatchResult:
        """
        Executes multi-tiered matching pipeline:
        Tier 1: Explicit Saved Aliases (customer_mappings)
        Tier 2: Exact & Normalized Match
        Tier 3: Canonical Core Match (strips chain prefixes and suffixes)
        Tier 4: Token Set Overlap Match
        Tier 5: Fuzzy Sequence Similarity Match
        """
        raw_val = raw_name if raw_name is not None else kwargs.get("raw_input")
        raw_clean = str(raw_val or "").strip()
        contacts = contacts if contacts is not None else (kwargs.get("zoho_contacts") or [])
        customer_mappings = customer_mappings if customer_mappings is not None else (kwargs.get("saved_mappings") or {})

        if not raw_clean:
            return CustomerMatchResult(
                raw_input_name="",
                match_tier="EMPTY",
                confidence_score=0.0,
                is_auto_matched=False,
            )

        norm_input = normalize_customer_name(raw_clean)
        core_input = extract_canonical_core(raw_clean)
        input_tokens = extract_distinctive_tokens(raw_clean)

        # -------------------------------------------------------------
        # TIER 1: Explicit Saved Aliases from Tenant Registry
        # -------------------------------------------------------------
        if customer_mappings:
            # 1a. Direct lookup
            for alias_key, map_val in customer_mappings.items():
                alias_norm = normalize_customer_name(str(alias_key))
                if alias_norm == norm_input or alias_norm == core_input:
                    target_id = map_val.get("zoho_contact_id") if isinstance(map_val, dict) else str(map_val)
                    target_name = map_val.get("name") if isinstance(map_val, dict) else str(alias_key)

                    # Verify against contact list to ensure proper naming
                    for c in contacts:
                        if target_id and str(c.contact_id).strip() == str(target_id).strip():
                            return CustomerMatchResult(
                                raw_input_name=raw_clean,
                                matched_contact_id=str(c.contact_id).strip(),
                                matched_contact_name=c.contact_name,
                                confidence_score=1.0,
                                match_tier="ALIAS",
                                is_auto_matched=True,
                            )
                    if target_id:
                        return CustomerMatchResult(
                            raw_input_name=raw_clean,
                            matched_contact_id=str(target_id).strip(),
                            matched_contact_name=str(target_name),
                            confidence_score=1.0,
                            match_tier="ALIAS",
                            is_auto_matched=True,
                        )

        # -------------------------------------------------------------
        # TIER 2: Exact Match against Official Contacts
        # -------------------------------------------------------------
        for c in contacts:
            c_norm = normalize_customer_name(c.contact_name)
            co_norm = normalize_customer_name(c.company_name or "")
            if norm_input == c_norm or (co_norm and norm_input == co_norm):
                return CustomerMatchResult(
                    raw_input_name=raw_clean,
                    matched_contact_id=str(c.contact_id).strip(),
                    matched_contact_name=c.contact_name,
                    confidence_score=1.0,
                    match_tier="EXACT",
                    is_auto_matched=True,
                )

        # -------------------------------------------------------------
        # TIER 3: Canonical Core Match (Prefix & Suffix Invariant)
        # Handles: "The Gallery", "Gallery" -> "Clifton homes - The Gallery"
        # -------------------------------------------------------------
        if core_input:
            for c in contacts:
                c_core = extract_canonical_core(c.contact_name)
                co_core = extract_canonical_core(c.company_name or "")
                if core_input == c_core or (co_core and core_input == co_core):
                    return CustomerMatchResult(
                        raw_input_name=raw_clean,
                        matched_contact_id=str(c.contact_id).strip(),
                        matched_contact_name=c.contact_name,
                        confidence_score=0.98,
                        match_tier="CANONICAL_TOKEN",
                        is_auto_matched=True,
                    )

        # -------------------------------------------------------------
        # TIER 4: Substring & Token Set Overlap Match
        # -------------------------------------------------------------
        for c in contacts:
            c_norm = normalize_customer_name(c.contact_name)
            c_tokens = extract_distinctive_tokens(c.contact_name)

            # Substring match if input has meaningful length
            if len(norm_input) >= 4 and norm_input in c_norm:
                return CustomerMatchResult(
                    raw_input_name=raw_clean,
                    matched_contact_id=str(c.contact_id).strip(),
                    matched_contact_name=c.contact_name,
                    confidence_score=0.92,
                    match_tier="SUBSTRING",
                    is_auto_matched=True,
                )

            # High token overlap (input distinctive tokens are fully contained in contact tokens)
            if input_tokens and input_tokens.issubset(c_tokens):
                return CustomerMatchResult(
                    raw_input_name=raw_clean,
                    matched_contact_id=str(c.contact_id).strip(),
                    matched_contact_name=c.contact_name,
                    confidence_score=0.90,
                    match_tier="TOKEN_OVERLAP",
                    is_auto_matched=True,
                )

        # -------------------------------------------------------------
        # TIER 5: Fuzzy Similarity Scoring across All Contacts
        # Handles driver misspellings like 'Galery', 'Embassey', 'Kwarley'
        # -------------------------------------------------------------
        candidates: List[CustomerCandidate] = []
        for c in contacts:
            score_full = calculate_similarity(raw_clean, c.contact_name)
            score_core = calculate_similarity(core_input, extract_canonical_core(c.contact_name))
            score_prefix = calculate_similarity(raw_clean, strip_chain_prefixes(c.contact_name))

            best_score = max(score_full, score_core, score_prefix)
            if best_score >= cls.SUGGESTION_THRESHOLD:
                candidates.append(
                    CustomerCandidate(
                        contact_id=str(c.contact_id).strip(),
                        contact_name=c.contact_name,
                        company_name=c.company_name,
                        similarity_score=round(best_score, 3),
                        match_tier="FUZZY",
                    )
                )

        # Sort candidates descending by similarity score
        candidates.sort(key=lambda x: x.similarity_score, reverse=True)

        if candidates:
            top_match = candidates[0]
            if top_match.similarity_score >= cls.AUTO_MATCH_THRESHOLD:
                return CustomerMatchResult(
                    raw_input_name=raw_clean,
                    matched_contact_id=top_match.contact_id,
                    matched_contact_name=top_match.contact_name,
                    confidence_score=top_match.similarity_score,
                    match_tier="FUZZY_HIGH",
                    is_auto_matched=True,
                    candidate_suggestions=candidates[:3],
                )
            else:
                return CustomerMatchResult(
                    raw_input_name=raw_clean,
                    matched_contact_id=top_match.contact_id,
                    matched_contact_name=top_match.contact_name,
                    confidence_score=top_match.similarity_score,
                    match_tier="AMBIGUOUS_SUGGESTION",
                    is_auto_matched=False,
                    candidate_suggestions=candidates[:3],
                )

        # No match found above threshold
        return CustomerMatchResult(
            raw_input_name=raw_clean,
            match_tier="UNMATCHED",
            confidence_score=0.0,
            is_auto_matched=False,
            candidate_suggestions=[],
        )
