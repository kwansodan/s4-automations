"""Unit tests for ZohoContractValidator and PipelineAlertService."""

import pytest
from app.services.zoho_contract_validator import ZohoContractValidator
from app.models.schemas import ZohoContact, ZohoItem, ContractValidationResult
from app.models.db_models import AccountingEntityType
from app.services.pipeline_alert_service import PipelineAlertService


@pytest.fixture
def mock_contacts():
    return [
        ZohoContact(contact_id="cnt_01", contact_name="Luxwood Hotel & Suites", company_name="Luxwood"),
        ZohoContact(contact_id="cnt_02", contact_name="Golden Detergents Ltd", company_name="Golden Detergents"),
    ]


@pytest.fixture
def mock_items():
    return [
        ZohoItem(item_id="item_01", name="Bed Sheet Double", rate=18.50),
        ZohoItem(item_id="item_02", name="Bath Towel Plush", rate=12.00),
    ]


def test_sales_invoice_validation_success(mock_contacts, mock_items):
    data = {
        "date": "2026-08-30",
        "customer_name": "Luxwood Hotel & Suites",
        "total_amount": 37.00,
        "items": [
            {"item_name": "Bed Sheet Double", "quantity": 2, "unit_price": 18.50, "amount": 37.00}
        ]
    }
    res = ZohoContractValidator.validate_entity(
        entity_type=AccountingEntityType.AR_SALES_INVOICE.value,
        extracted_data=data,
        zoho_contacts=mock_contacts,
        zoho_items=mock_items,
    )
    assert res.is_valid is True
    assert len(res.issues) == 0
    assert res.normalized_payload["customer_id"] == "cnt_01"


def test_sales_invoice_missing_customer_and_date():
    data = {
        "total_amount": 100.0,
        "items": [{"item_name": "Generic Item", "quantity": 1, "unit_price": 100.0}]
    }
    res = ZohoContractValidator.validate_entity(
        entity_type=AccountingEntityType.AR_SALES_INVOICE.value,
        extracted_data=data,
    )
    assert res.is_valid is False
    issue_fields = [i.field_name for i in res.issues]
    assert "date" in issue_fields
    assert "customer_id" in issue_fields


def test_vendor_bill_missing_bill_number(mock_contacts):
    data = {
        "bill_date": "2026-08-30",
        "vendor_name": "Golden Detergents Ltd",
        "total_amount": 500.0,
        "items": [{"item_name": "Bleach 50L", "quantity": 2, "unit_price": 250.0}]
    }
    res = ZohoContractValidator.validate_entity(
        entity_type=AccountingEntityType.AP_VENDOR_BILL.value,
        extracted_data=data,
        zoho_contacts=mock_contacts,
    )
    assert res.is_valid is False
    assert any(i.field_name == "bill_number" for i in res.issues)


def test_math_mismatch_detection(mock_contacts):
    data = {
        "date": "2026-08-30",
        "customer_name": "Luxwood Hotel",
        "total_amount": 500.00,  # Stated total 500
        "items": [
            {"item_name": "Bed Sheet", "quantity": 2, "unit_price": 50.00, "amount": 100.00}  # Line sum 100
        ]
    }
    res = ZohoContractValidator.validate_entity(
        entity_type=AccountingEntityType.AR_SALES_INVOICE.value,
        extracted_data=data,
        zoho_contacts=mock_contacts,
    )
    assert res.is_valid is False
    assert any(i.error_type == "MATH_MISMATCH" for i in res.issues)


def test_manual_journal_unbalanced_rejection():
    data = {
        "journal_date": "2026-08-31",
        "journal_entries": [
            {"account_id": "acc_01", "debit_or_credit": "debit", "amount": 1000.0},
            {"account_id": "acc_02", "debit_or_credit": "credit", "amount": 800.0},  # Unbalanced
        ]
    }
    res = ZohoContractValidator.validate_entity(
        entity_type=AccountingEntityType.GL_JOURNAL.value,
        extracted_data=data,
    )
    assert res.is_valid is False
    assert any(i.error_type == "MATH_MISMATCH" for i in res.issues)


@pytest.mark.asyncio
async def test_pipeline_alert_service_dispatch():
    val_res = ContractValidationResult(
        is_valid=False,
        target_entity="ap_vendor_bill",
        issues=[
            {
                "field_name": "bill_number",
                "error_type": "MISSING_MANDATORY_FIELD",
                "message": "Missing bill number",
                "severity": "CRITICAL",
            }
        ]
    )
    # Testing alert formulation
    success = await PipelineAlertService.send_contract_failure_alert(
        client_name="Opera Square Electricals",
        pipeline_name="Supplier Invoices",
        entity_type="ap_vendor_bill",
        source_file_name="supplier_inv_001.pdf",
        validation_result=val_res,
        staged_batch_id="batch_test_001",
        recipient_email="test@service4gh.com",
    )
    assert success is True
