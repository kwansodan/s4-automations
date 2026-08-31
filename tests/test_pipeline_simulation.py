"""Tests for Interactive Pipeline Simulation Lab & Promptable AI Transposition."""

import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.services.ocr_service import GeminiOCRService
from app.models.schemas import ZohoItem


@pytest.mark.asyncio
async def test_ocr_service_simulate_pipeline_transposition():
    ocr = GeminiOCRService()
    catalog = [
        ZohoItem(item_id="item_1", name="Bed Sheet (Double / King)", rate=18.50),
        ZohoItem(item_id="item_2", name="Bath Towel", rate=12.00),
    ]

    # Test AR Sales Invoice with Human Instructions
    res = await ocr.simulate_pipeline_transposition(
        file_name="sample_slip.png",
        mime_type="image/png",
        entity_type="ar_sales_invoice",
        client_name="Kempinski Hotel Gold Coast City",
        human_instructions="Column P is pickup count and Column D is delivery count. Calculate discrepancy = P - D.",
        accounting_software="zoho_books",
        item_catalog=catalog,
    )

    assert res["success"] is True
    assert "raw_datapoints" in res
    assert len(res["raw_datapoints"]) > 0
    assert "transposed_payload" in res
    assert "line_items" in res["transposed_payload"]
    assert "confidence_score" in res
    assert res["confidence_score"] > 0.8
    assert "Kempinski" in res["ai_reasoning"] or "Kempinski" in res["transposed_payload"]["customer_name"]


@pytest.mark.asyncio
async def test_ocr_service_simulate_ap_vendor_bill():
    ocr = GeminiOCRService()

    res = await ocr.simulate_pipeline_transposition(
        sample_text="Vendor: Golden Detergents Ltd. Bill #: BILL-8821. Heavy Duty Detergent 50L x 4 @ 350.00 = 1400.00",
        entity_type="ap_vendor_bill",
        client_name="ANR Laundry",
        human_instructions="Extract vendor name and bill number. Assign to operating expenses.",
        accounting_software="quickbooks_online",
    )

    assert res["success"] is True
    assert res["transposed_payload"]["bill_number"] == "BILL-GD-8821" or "BILL" in res["transposed_payload"]["bill_number"]
    assert res["transposed_payload"]["total_amount"] > 0


@pytest.mark.asyncio
async def test_api_pipeline_simulate_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Test multipart simulation with sample text
        response = await ac.post(
            "/api/v1/pipeline/simulate",
            data={
                "sample_text": "Slip Date: 30/08/2026. Bed Sheet Dbl: 25 collected, 23 returned.",
                "entity_type": "ar_sales_invoice",
                "client_id": "anr_group",
                "client_name": "ANR Commercial Laundry",
                "accounting_software": "xero",
                "human_instructions": "Extract line items and map unreturned pieces to linen loss.",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["entity_type"] == "ar_sales_invoice"
        assert data["accounting_software"] == "xero"
        assert data["validation_status"] in ["VALID", "VALIDATION_WARNINGS"]
        assert len(data["raw_datapoints"]) > 0
        assert "transposed_payload" in data
        assert "ai_reasoning" in data


@pytest.mark.asyncio
async def test_api_pipeline_simulate_bank_statement():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.post(
            "/api/v1/pipeline/simulate",
            data={
                "sample_text": "2026-08-30 POS: AWS EMEA CLOUD DR 1450.00",
                "entity_type": "bank_statement",
                "client_id": "polaris",
                "client_name": "Polaris Advisory",
                "accounting_software": "quickbooks_online",
                "human_instructions": "Map AWS debit payments to 60020 - Cloud & Hosting Expenses.",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["entity_type"] == "bank_statement"
        assert data["transposed_payload"]["amount"] == 1450.00
