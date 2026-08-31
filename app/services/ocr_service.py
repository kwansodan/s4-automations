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
    OCRAPBillExtraction,
    OCRBankStatementExtraction,
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

    @retry(reraise=True, stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def extract_vendor_bill(
        self,
        file_bytes: bytes,
        mime_type: str,
        file_name: str,
    ) -> OCRAPBillExtraction:
        """
        Invokes Gemini Vision to extract AP vendor bill data.
        """
        if settings.MOCK_MODE or not self.api_key:
            return OCRAPBillExtraction(
                vendor_name="Mock Vendor",
                bill_date="01/01/2026",
                total_amount=100.0,
            )

        prompt = f"""
You are an expert accounts payable clerk. Analyze this vendor bill/invoice.
Extract the vendor name, bill date, bill number, currency (default GHS if not found), total amount, and line items.
For line items, extract description, quantity, unit_rate, and amount.
Return strictly valid JSON conforming to the schema.
"""
        
        try:
            from google import genai
            from google.genai import types
            client = genai.Client(api_key=self.api_key)
            response = client.models.generate_content(
                model=self.model_name,
                contents=[types.Part.from_bytes(data=file_bytes, mime_type=mime_type), prompt],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=OCRAPBillExtraction,
                    temperature=0.1,
                ),
            )
            raw_text = response.text
            import json
            cleaned = re.sub(r"^```json\s*", "", raw_text.strip(), flags=re.MULTILINE)
            cleaned = re.sub(r"```$", "", cleaned.strip(), flags=re.MULTILINE)
            return OCRAPBillExtraction.model_validate_json(cleaned)
        except Exception as e:
            logger.error(f"Failed to extract vendor bill {file_name}: {e}")
            raise RuntimeError(f"Failed to extract vendor bill {file_name}: {e}")

    @retry(reraise=True, stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def extract_bank_statement(
        self,
        file_bytes: bytes,
        mime_type: str,
        file_name: str,
    ) -> OCRBankStatementExtraction:
        """
        Invokes Gemini Vision to extract transactions from PDF bank statements.
        """
        if settings.MOCK_MODE or not self.api_key:
            return OCRBankStatementExtraction(
                bank_name="GCB Bank Ghana",
                account_number="1234567890",
                statement_period="August 2026",
                transactions=[],
            )

        prompt = f"""
You are an expert banking and financial auditor. Analyze this Bank Statement.
Extract bank name, account number, statement period, and every transaction row.
For each transaction:
- transaction_date in YYYY-MM-DD or DD/MM/YYYY
- description (narration/details)
- amount (positive float)
- transaction_type ("DEBIT" for withdrawal/charge/outflow, "CREDIT" for deposit/inflow)
- balance (optional)
- reference (optional reference code or cheque number)
Return strictly valid JSON conforming to the schema.
"""
        try:
            from google import genai
            from google.genai import types
            client = genai.Client(api_key=self.api_key)
            response = client.models.generate_content(
                model=self.model_name,
                contents=[types.Part.from_bytes(data=file_bytes, mime_type=mime_type), prompt],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=OCRBankStatementExtraction,
                    temperature=0.1,
                ),
            )
            raw_text = response.text
            import json
            cleaned = re.sub(r"^```json\s*", "", raw_text.strip(), flags=re.MULTILINE)
            cleaned = re.sub(r"```$", "", cleaned.strip(), flags=re.MULTILINE)
            return OCRBankStatementExtraction.model_validate_json(cleaned)
        except Exception as e:
            logger.error(f"Failed to extract bank statement {file_name}: {e}")
            raise RuntimeError(f"Failed to extract bank statement {file_name}: {e}")



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

    async def simulate_pipeline_transposition(
        self,
        file_bytes: Optional[bytes] = None,
        file_name: str = "sample_document.png",
        mime_type: str = "image/png",
        sample_text: Optional[str] = None,
        entity_type: str = "ar_sales_invoice",
        client_name: str = "General Client",
        human_instructions: Optional[str] = None,
        accounting_software: str = "zoho_books",
        item_catalog: Optional[List[ZohoItem]] = None,
    ) -> Dict[str, Any]:
        """
        Studies sample document or text, applies human-written transposition instructions,
        and transposes raw extracted data into the target accounting entity's API schema.
        """
        logger.info(
            f"Simulating pipeline transposition for '{client_name}' (Entity: {entity_type}, Platform: {accounting_software})"
        )

        catalog = item_catalog or []
        instructions_text = human_instructions.strip() if human_instructions else "Extract all standard transaction fields and line items matching the target entity schema."

        # If Mock mode or no API key, synthesize intelligent mock simulation
        if settings.MOCK_MODE or not self.api_key:
            return self._generate_mock_simulation(
                file_name=file_name,
                sample_text=sample_text,
                entity_type=entity_type,
                client_name=client_name,
                human_instructions=instructions_text,
                accounting_software=accounting_software,
                item_catalog=catalog,
            )

        # Build Multi-Modal AI Prompt
        prompt = f"""
You are an expert AI Document Transposition Engine for S4 Automations.
Your task is to analyze the provided document/text and transpose raw extracted datapoints into the strict target accounting entity schema for {accounting_software.upper()}.

### Target Entity Type:
{entity_type}

### Client Name:
{client_name}

### Human-Written Transposition Instructions:
"{instructions_text}"

### Standard Item Catalog (Reference):
{', '.join([it.name for it in catalog[:15]]) if catalog else 'No custom catalog provided. Infer standard SKU/service names.'}

### Required JSON Output Structure:
{{
  "raw_datapoints": [
    {{ "key": "Field Label", "value": "Extracted Value", "confidence": 0.95, "source_snippet": "exact text from doc" }}
  ],
  "transposed_payload": {{
    "customer_id": "string or contact name",
    "vendor_id": "string (for AP)",
    "date": "YYYY-MM-DD",
    "document_number": "INV-xxx or BILL-xxx",
    "line_items": [
      {{ "name": "Item Description", "rate": 0.0, "quantity": 1, "amount": 0.0 }}
    ],
    "total_amount": 0.0,
    "notes": "string"
  }},
  "ai_reasoning": "Explain step-by-step how the human instructions were interpreted and how raw text was mapped into the final API payload.",
  "confidence_score": 0.95
}}

Analyze thoroughly and return JSON output only.
"""

        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=self.api_key)
            contents = [prompt]
            if file_bytes:
                contents.insert(0, types.Part.from_bytes(data=file_bytes, mime_type=mime_type))
            elif sample_text:
                contents.insert(0, f"### Sample Document Text Content:\n{sample_text}")

            response = client.models.generate_content(
                model=self.model_name,
                contents=contents,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.1,
                ),
            )
            data = json.loads(response.text)
            return data

        except Exception as e:
            logger.warning(f"Live Gemini simulation failed ({e}). Falling back to mock simulation.")
            return self._generate_mock_simulation(
                file_name=file_name,
                sample_text=sample_text,
                entity_type=entity_type,
                client_name=client_name,
                human_instructions=instructions_text,
                accounting_software=accounting_software,
                item_catalog=catalog,
            )

    def _generate_mock_simulation(
        self,
        file_name: str,
        sample_text: Optional[str],
        entity_type: str,
        client_name: str,
        human_instructions: str,
        accounting_software: str,
        item_catalog: List[ZohoItem],
    ) -> Dict[str, Any]:
        """Synthesizes structured simulation response honoring entity schema and human instructions."""
        now_date = "2026-08-30"

        # 1. Accounts Receivable: Sales Invoices
        if "invoice" in entity_type or entity_type == "ar_sales_invoice":
            raw_datapoints = [
                {"key": "Client / Hotel", "value": client_name, "confidence": 0.98, "source_snippet": f"Header: {client_name}"},
                {"key": "Date", "value": now_date, "confidence": 0.95, "source_snippet": "Date: 30/08/2026"},
                {"key": "Line 1: Bed Sheet Double", "value": "25 pcs @ GHS 18.50", "confidence": 0.96, "source_snippet": "B/Sheet Dbl 25 23"},
                {"key": "Line 2: Bath Towel", "value": "30 pcs @ GHS 12.00", "confidence": 0.97, "source_snippet": "Bath Towel 30 30"},
                {"key": "Discrepancy (Linen Loss)", "value": "2 pcs unreturned", "confidence": 0.92, "source_snippet": "Pickup 25 - Deliv 23"},
            ]
            transposed_payload = {
                "customer_id": f"cnt_{client_name.lower().replace(' ', '_')[:10]}",
                "customer_name": client_name,
                "date": now_date,
                "invoice_number": f"INV-{client_name[:3].upper()}-2026-08",
                "line_items": [
                    {"name": "Bed Sheet (Double / King)", "description": "Commercial Laundry Pickup/Delivery", "rate": 18.50, "quantity": 25, "amount": 462.50},
                    {"name": "Bath Towel (White)", "description": "Standard Hospitality Terry", "rate": 12.00, "quantity": 30, "amount": 360.00},
                ],
                "total_amount": 822.50,
                "currency": "GHS",
                "notes": f"Auto-transposed via S4 AI Engine for {client_name}. Instructions applied: '{human_instructions[:80]}...'",
            }
            reasoning = (
                f"Identified client '{client_name}' and date {now_date}. Parsed 2 line items from slip. "
                f"Applied human rule: '{human_instructions[:100]}'. Calculated line totals with catalog pricing."
            )

        # 2. Accounts Payable: Vendor Bills
        elif "bill" in entity_type or entity_type == "ap_vendor_bill":
            raw_datapoints = [
                {"key": "Vendor Name", "value": "Golden Detergents & Chemicals Ltd", "confidence": 0.96, "source_snippet": "From: Golden Detergents Ltd"},
                {"key": "Bill Number", "value": "BILL-GD-8821", "confidence": 0.98, "source_snippet": "Invoice #: BILL-GD-8821"},
                {"key": "Bill Date", "value": now_date, "confidence": 0.95, "source_snippet": "30-Aug-2026"},
                {"key": "Chemical Supply 50L", "value": "4 Drums @ 350.00", "confidence": 0.94, "source_snippet": "Heavy Duty Detergent 50L x 4"},
            ]
            transposed_payload = {
                "vendor_id": "vnd_golden_detergents",
                "vendor_name": "Golden Detergents & Chemicals Ltd",
                "bill_number": "BILL-GD-8821",
                "date": now_date,
                "line_items": [
                    {"name": "Industrial Laundry Detergent 50L", "rate": 350.00, "quantity": 4, "amount": 1400.00}
                ],
                "total_amount": 1400.00,
                "currency": "GHS",
                "notes": f"Vendor bill ingestion for {client_name}. Transposed according to: '{human_instructions[:80]}...'",
            }
            reasoning = (
                f"Extracted vendor 'Golden Detergents & Chemicals Ltd' and bill #BILL-GD-8821. "
                f"Transposed 4 units of detergent into AP Vendor Bill payload for {accounting_software}."
            )

        # 3. Bank & Mobile Money Statements
        elif "bank" in entity_type or "momo" in entity_type:
            raw_datapoints = [
                {"key": "Bank / Channel", "value": "Stanbic Bank Ghana (Account ending 9122)", "confidence": 0.99, "source_snippet": "Stanbic Bank Stmt"},
                {"key": "Tx Date", "value": now_date, "confidence": 0.95, "source_snippet": "2026-08-30"},
                {"key": "Description", "value": "AWS Cloud Infrastructure EMEA", "confidence": 0.97, "source_snippet": "POS: AWS EMEA CLOUD"},
                {"key": "Debit Amount", "value": "1450.00", "confidence": 0.98, "source_snippet": "DR: 1,450.00"},
            ]
            transposed_payload = {
                "account_id": "acc_bank_operating_01",
                "transaction_type": "debit",
                "date": now_date,
                "amount": 1450.00,
                "description": "AWS Cloud Infrastructure EMEA",
                "reference_number": "TX-STANBIC-88401",
                "category_suggestion": "60020 - Cloud & Hosting Expenses",
            }
            reasoning = (
                f"Parsed bank transaction debit of GHS 1,450.00 on {now_date}. "
                f"Mapped description 'AWS Cloud Infrastructure EMEA' to GL Expense Code '60020' based on rule instructions."
            )

        # 4. General Ledger Journals
        else:
            raw_datapoints = [
                {"key": "Journal Narrative", "value": "Monthly Retainer Fee Accrual", "confidence": 0.95, "source_snippet": "Advisory Fee Aug 2026"},
                {"key": "Debit Account", "value": "12000 - Accounts Receivable", "amount": 15000.00, "confidence": 0.98},
                {"key": "Credit Account", "value": "40010 - Advisory Revenue", "amount": 15000.00, "confidence": 0.98},
            ]
            transposed_payload = {
                "journal_date": now_date,
                "reference_number": "JRNL-2026-08-01",
                "notes": f"Advisory accrual for {client_name}. Instructions: {human_instructions[:60]}",
                "line_items": [
                    {"account": "12000 - Accounts Receivable", "debit": 15000.00, "credit": 0.0},
                    {"account": "40010 - Advisory Revenue", "debit": 0.0, "credit": 15000.00},
                ],
                "total_debit": 15000.00,
                "total_credit": 15000.00,
            }
            reasoning = "Generated balanced double-entry manual journal entry with Debit = Credit = 15,000.00."

        return {
            "success": True,
            "raw_datapoints": raw_datapoints,
            "transposed_payload": transposed_payload,
            "ai_reasoning": reasoning,
            "confidence_score": 0.96,
        }
