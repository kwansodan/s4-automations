"""Google Gemini Vision OCR Service with Structured Output and Semantic SKU Reconciliation."""

import json
import re
from difflib import SequenceMatcher
from typing import List, Dict, Optional, Any, Tuple
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import settings
from app.models.schemas import (
    ConfidenceLevel,
    SlipStatus,
    OCRSlipExtraction,
    OCRSlipItem,
    MonthlySKUSummary,
    ZohoItem,
)
from app.utils.logging import get_logger

logger = get_logger("ocr_service")


class GeminiOCRService:
    """Extracts structured line items from physical handwritten laundry slips using Gemini 3.6 Flash."""

    def __init__(self, api_key: Optional[str] = None, model_name: Optional[str] = None):
        self.api_key = api_key or settings.GEMINI_API_KEY
        self.model_name = model_name or settings.GEMINI_MODEL
        self._client = None

    def _get_client(self):
        if self._client is None and not settings.MOCK_MODE:
            try:
                # Try google-genai client first
                from google import genai
                self._client = genai.Client(api_key=self.api_key)
            except Exception:
                try:
                    # Fallback to google-generativeai client
                    import google.generativeai as genai_legacy
                    genai_legacy.configure(api_key=self.api_key)
                    self._client = genai_legacy
                except Exception as e:
                    logger.warning(f"Could not initialize Gemini client: {e}. Will use mock/fallback.")
        return self._client

    def _build_prompt(self, client_name: str, file_name: str, item_catalog: List[ZohoItem]) -> str:
        catalog_lines = "\n".join([f"- ID: {item.item_id} | Name: {item.name} | Rate: {item.rate}" for item in item_catalog])
        return f"""
You are an expert commercial laundry billing auditor and OCR specialist for ANR Laundry Services.
Analyze this physical handwritten laundry control slip (pickup / delivery note) for hotel client: "{client_name}".
The file name is: "{file_name}".

### Standard Zoho Item Catalog:
{catalog_lines}

### Instructions:
1. Extract the Date on the slip in DD/MM/YYYY format.
2. For each linen row / item written on the slip:
   - Identify the exact handwritten raw text ('raw_item_name', e.g. "B/Sheet Dbl", "F/Towel", "Bath Mat").
   - Match it semantically to the most accurate item in the Standard Zoho Catalog ('standard_item_name' and 'zoho_item_id').
   - Extract 'unit_rate' from the catalog matching this item.
   - Extract 'pickup_qty' (pieces picked up / collected for washing). If none, 0.
   - Extract 'delivery_qty' (clean pieces returned / delivered back to client). If none, 0.
   - Calculate 'unreturned_loss_qty' as (pickup_qty - delivery_qty).
   - Assign 'confidence_score' ("HIGH", "MEDIUM", or "LOW") based on handwriting legibility.
   - Add any 'remarks' (e.g. torn, stained, guest laundry, replacement).
3. Assign an overall document 'overall_confidence' ("HIGH", "MEDIUM", or "LOW").

Return strictly valid JSON conforming to the schema.
"""

    @retry(reraise=True, stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def extract_slip_data(
        self,
        file_bytes: bytes,
        mime_type: str,
        file_name: str,
        client_name: str,
        item_catalog: List[ZohoItem],
    ) -> OCRSlipExtraction:
        """
        Invokes Gemini Vision with structured schema to extract line items from a slip.
        """
        if settings.MOCK_MODE or not self.api_key:
            logger.info(f"[MOCK] Running mock extraction for slip {file_name} (Client: {client_name})")
            return self._generate_mock_extraction(file_name, client_name, item_catalog)

        prompt = self._build_prompt(client_name, file_name, item_catalog)

        try:
            # 1. Attempt using modern google-genai SDK
            from google import genai
            from google.genai import types
            
            client = genai.Client(api_key=self.api_key)
            response = client.models.generate_content(
                model=self.model_name,
                contents=[
                    types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
                    prompt,
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=OCRSlipExtraction,
                    temperature=0.1,
                ),
            )
            raw_text = response.text
            parsed = self._safe_parse_extraction(raw_text, file_name, client_name)
            self._reconcile_with_catalog(parsed, item_catalog)
            return parsed

        except Exception as genai_err:
            logger.warning(f"google-genai attempt failed ({genai_err}). Trying google-generativeai fallback...")
            try:
                import google.generativeai as genai_legacy
                genai_legacy.configure(api_key=self.api_key)
                model = genai_legacy.GenerativeModel(self.model_name)
                
                response = model.generate_content(
                    [
                        {"mime_type": mime_type, "data": file_bytes},
                        prompt + "\nReturn JSON output only without markdown formatting.",
                    ],
                    generation_config={"temperature": 0.1},
                )
                raw_text = response.text
                parsed = self._safe_parse_extraction(raw_text, file_name, client_name)
                self._reconcile_with_catalog(parsed, item_catalog)
                return parsed
            except Exception as legacy_err:
                logger.error(f"Gemini extraction failed: {legacy_err}")
                raise RuntimeError(f"OCR extraction failed for {file_name}: {legacy_err}")

    def _safe_parse_extraction(self, text: str, file_name: str, client_name: str) -> OCRSlipExtraction:
        """Cleans markdown code fences, injects metadata, and validates schema."""
        import json
        cleaned = re.sub(r"^```json\s*", "", text.strip(), flags=re.MULTILINE)
        cleaned = re.sub(r"```$", "", cleaned.strip(), flags=re.MULTILINE)
        try:
            data = json.loads(cleaned)
            if isinstance(data, dict):
                if not data.get("file_name"):
                    data["file_name"] = file_name
                if not data.get("client_name") and client_name:
                    data["client_name"] = client_name
                return OCRSlipExtraction.model_validate(data)
        except Exception:
            pass
        return OCRSlipExtraction.model_validate_json(cleaned)

    def _reconcile_with_catalog(self, extraction: OCRSlipExtraction, item_catalog: List[ZohoItem]):
        """Fuzzy matches and sets missing zoho_item_id and unit_rate for extracted items."""
        for item in extraction.items:
            matched_item = self.find_best_matching_item(
                item.standard_item_name or item.raw_item_name, item_catalog
            )
            if matched_item:
                item.standard_item_name = matched_item.name
                item.zoho_item_id = matched_item.item_id
                if item.unit_rate <= 0:
                    item.unit_rate = matched_item.rate
            else:
                if not item.standard_item_name:
                    item.standard_item_name = item.raw_item_name
                item.confidence_score = ConfidenceLevel.LOW
                item.remarks = (item.remarks + " [Unmatched SKU - needs review]").strip()

            # Ensure loss qty calculation
            item.unreturned_loss_qty = item.pickup_qty - item.delivery_qty

    def find_best_matching_item(self, text: str, item_catalog: List[ZohoItem]) -> Optional[ZohoItem]:
        """Fuzzy matches raw handwritten text or item name against Zoho Catalog."""
        if not text or not item_catalog:
            return None

        cleaned = text.lower().strip()
        
        # 1. Direct synonym mapping
        SYNONYMS = {
            "b/sheet dbl": "Bed Sheet (Double / King)",
            "bed sheet dbl": "Bed Sheet (Double / King)",
            "double sheet": "Bed Sheet (Double / King)",
            "king sheet": "Bed Sheet (Double / King)",
            "b/sheet sgl": "Bed Sheet (Single)",
            "single sheet": "Bed Sheet (Single)",
            "duvet cov king": "Duvet Cover (King)",
            "d/cover k": "Duvet Cover (King)",
            "duvet cover": "Duvet Cover (King)",
            "p/case": "Pillow Case",
            "pillow cover": "Pillow Case",
            "pillow case": "Pillow Case",
            "b/towel": "Bath Towel",
            "bath towel": "Bath Towel",
            "h/towel": "Hand Towel",
            "hand towel": "Hand Towel",
            "f/towel": "Face Towel",
            "face towel": "Face Towel",
            "washcloth": "Face Towel",
            "b/mat": "Bath Mat",
            "bath mat": "Bath Mat",
            "pool towel": "Pool Towel (Stripe)",
            "t/cloth": "Table Cloth (Banquet)",
            "table cloth": "Table Cloth (Banquet)",
            "napkin": "Napkin / Serviet",
            "serviette": "Napkin / Serviet",
        }

        for syn, target_name in SYNONYMS.items():
            if syn in cleaned or cleaned in syn:
                for item in item_catalog:
                    if item.name.lower() == target_name.lower():
                        return item

        # 2. SequenceMatcher fuzzy score
        best_match = None
        highest_ratio = 0.0

        for item in item_catalog:
            ratio = SequenceMatcher(None, cleaned, item.name.lower()).ratio()
            if ratio > highest_ratio:
                highest_ratio = ratio
                best_match = item

        if highest_ratio >= 0.40:
            return best_match

        return None

    def _generate_mock_extraction(
        self, file_name: str, client_name: str, item_catalog: List[ZohoItem]
    ) -> OCRSlipExtraction:
        """Generates realistic mock OCR extraction data for test slip files."""
        # Pick 2-3 standard items from catalog
        items = []
        sample_skus = [
            ("Bed Sheet (Double / King)", "B/Sheet Dbl", 25, 23, 18.50, "item_bed_sheet_dbl"),
            ("Bath Towel", "Bath Towel", 30, 30, 12.00, "item_bath_towel"),
            ("Pillow Case", "P/Case", 50, 48, 6.50, "item_pillow_case"),
        ]

        for std_name, raw_name, pick, deliv, rate, z_id in sample_skus:
            items.append(
                OCRSlipItem(
                    raw_item_name=raw_name,
                    standard_item_name=std_name,
                    zoho_item_id=z_id,
                    unit_rate=rate,
                    pickup_qty=pick,
                    delivery_qty=deliv,
                    unreturned_loss_qty=pick - deliv,
                    confidence_score=ConfidenceLevel.HIGH,
                    remarks="Count verified",
                )
            )

        return OCRSlipExtraction(
            file_name=file_name,
            client_name=client_name,
            slip_date="15/08/2026",
            items=items,
            overall_confidence=ConfidenceLevel.HIGH,
            notes="Legible handwritten control note",
        )

    def aggregate_monthly_skus(
        self,
        client_name: str,
        zoho_contact_id: str,
        extractions: List[OCRSlipExtraction],
        item_catalog: List[ZohoItem],
    ) -> List[MonthlySKUSummary]:
        """
        Aggregates all slip line items for a client into consolidated SKU summaries for Tab 2: Monthly_Summary.
        """
        grouped: Dict[str, Dict[str, Any]] = {}

        for ext in extractions:
            for item in ext.items:
                # Key by Zoho Item ID or standard name
                key = item.zoho_item_id or item.standard_item_name or item.raw_item_name
                if not key:
                    continue

                if key not in grouped:
                    grouped[key] = {
                        "client_name": client_name,
                        "zoho_contact_id": zoho_contact_id,
                        "zoho_item_id": item.zoho_item_id,
                        "standard_item_name": item.standard_item_name or item.raw_item_name,
                        "raw_names_seen": set(),
                        "confidence_scores": [],
                        "unit_rate": item.unit_rate,
                        "total_pickup_qty": 0,
                        "total_delivery_qty": 0,
                        "total_loss_qty": 0,
                        "slips_count": 0,
                    }

                grouped[key]["raw_names_seen"].add(item.raw_item_name)
                grouped[key]["confidence_scores"].append(item.confidence_score)
                grouped[key]["total_pickup_qty"] += item.pickup_qty
                grouped[key]["total_delivery_qty"] += item.delivery_qty
                grouped[key]["total_loss_qty"] += (item.pickup_qty - item.delivery_qty)
                grouped[key]["slips_count"] += 1
                if item.unit_rate > 0:
                    grouped[key]["unit_rate"] = item.unit_rate

        summaries: List[MonthlySKUSummary] = []
        for key, data in grouped.items():
            # Overall confidence: if any LOW -> LOW, if any MEDIUM -> MEDIUM, else HIGH
            scores = data["confidence_scores"]
            if ConfidenceLevel.LOW in scores:
                conf = ConfidenceLevel.LOW
            elif ConfidenceLevel.MEDIUM in scores:
                conf = ConfidenceLevel.MEDIUM
            else:
                conf = ConfidenceLevel.HIGH

            total_pickup = data["total_pickup_qty"]
            total_deliv = data["total_delivery_qty"]
            total_loss = data["total_loss_qty"]
            rate = data["unit_rate"]
            billed_amount = total_pickup * rate

            discrepancy_msg = f"Linen Loss: {total_loss}" if total_loss > 0 else "Counts Reconciled"
            audit_note = f"Aggregated across {data['slips_count']} slips. {discrepancy_msg}."

            summaries.append(
                MonthlySKUSummary(
                    client_name=client_name,
                    zoho_contact_id=zoho_contact_id,
                    zoho_item_id=data["zoho_item_id"],
                    standard_item_name=data["standard_item_name"],
                    raw_names_seen=list(data["raw_names_seen"]),
                    confidence_score=conf,
                    unit_rate=rate,
                    total_pickup_qty=total_pickup,
                    total_delivery_qty=total_deliv,
                    total_loss_qty=total_loss,
                    line_total_amount=round(billed_amount, 2),
                    daily_trace_summary=f"Pickup: {total_pickup}, Delivery: {total_deliv}",
                    audit_notes=audit_note,
                    reviewed=False,
                    approved=False,
                    status=SlipStatus.PENDING,
                )
            )

        # Sort alphabetically by item name
        summaries.sort(key=lambda s: s.standard_item_name)
        logger.info(f"Aggregated {len(summaries)} monthly SKU summaries for client '{client_name}'")
        return summaries
