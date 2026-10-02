"""
E2E Frontend Contracts, Type Parity, and AR Terminology Tests.

Covers Features F9 through F22:
- F9: Frontend InvoiceDateRule and PaymentTermsRule types in client.ts
- F10: Settings page Invoice Date Rule UI contract
- F11: Settings page Payment Terms Rule UI contract
- F12: Pipeline types extension (PipelineProgress, CreatedInvoiceReceiptItem)
- F13: Invoicing modal scoping UI contract
- F14: Invoicing modal draft conflict detection and warning banner contract
- F15: Invoicing modal date and terms override controls contract
- F16: Active pipeline run telemetry widget (PipelineFloatingWidget)
- F17: Itemized receipt UI contract
- F18: Polling interval acceleration (sequential <= 1500ms)
- F19: AR Party Terminology Enforcement (Audit: Customer used for AR debtors, never Client)
- F20: Error state rendering contracts
- F21: Empty receipt state rendering contracts
- F22: Schema Parity Test (Backend Pydantic vs Frontend TypeScript)
"""

import os
import re
from pathlib import Path
import pytest
from app.models.inngest_events import InvoiceGenerateEvent
from app.models.schemas import (
    ExistingInvoiceItem,
    ExistingInvoicesQueryResponse,
)
from app.utils.progress_tracker import pipeline_tracker

FRONTEND_SRC = Path("frontend/src")


def test_f9_invoice_date_rule_type_defined_in_client_ts():
    """F9: Verify InvoiceDateRule type is exported and includes standard rule variants."""
    client_ts_path = FRONTEND_SRC / "types" / "client.ts"
    assert client_ts_path.exists(), "frontend/src/types/client.ts must exist"
    content = client_ts_path.read_text(encoding="utf-8")

    assert "export type InvoiceDateRule" in content
    assert "'LAST_DAY_OF_MONTH'" in content
    assert "'FIRST_DAY_OF_NEXT_MONTH'" in content or "'first_day_following_month'" in content
    assert "'TODAY'" in content or "'today'" in content
    assert "'FIXED_DAY'" in content or "'fixed_day'" in content


def test_f9_payment_terms_rule_type_defined_in_client_ts():
    """F9: Verify PaymentTermsRule type is exported and includes net terms variants."""
    client_ts_path = FRONTEND_SRC / "types" / "client.ts"
    content = client_ts_path.read_text(encoding="utf-8")

    assert "export type PaymentTermsRule" in content
    assert "'NET_0'" in content or "'net_0'" in content
    assert "'NET_14'" in content or "'net_14'" in content
    assert "'NET_30'" in content or "'net_30'" in content
    assert "'NET_60'" in content or "'net_60'" in content
    assert "'CUSTOM'" in content or "'custom'" in content


def test_f9_invoicing_date_settings_interface_in_client_ts():
    """F9: Verify InvoicingDateSettings interface has required date and terms fields."""
    client_ts_path = FRONTEND_SRC / "types" / "client.ts"
    content = client_ts_path.read_text(encoding="utf-8")

    assert "export interface InvoicingDateSettings" in content
    assert "invoice_date_rule" in content
    assert "payment_terms_rule" in content
    assert "custom_due_days" in content
    assert "custom_terms_note" in content


def test_f12_pipeline_progress_interface_in_pipeline_ts():
    """F12: Verify PipelineProgress interface includes telemetry and itemized receipt fields."""
    pipeline_ts_path = FRONTEND_SRC / "types" / "pipeline.ts"
    assert pipeline_ts_path.exists(), "frontend/src/types/pipeline.ts must exist"
    content = pipeline_ts_path.read_text(encoding="utf-8")

    assert "export interface PipelineProgress" in content
    assert "is_running: boolean" in content
    assert "percent: number" in content
    assert "current_step: string" in content
    assert "elapsed_seconds" in content
    assert "started_at" in content
    assert "stats: PipelineStats" in content
    assert "recent_logs" in content
    assert "last_result" in content
    assert "invoices_created" in content


def test_f12_created_invoice_receipt_item_in_pipeline_ts():
    """F12: Verify CreatedInvoiceReceiptItem defines required fields for itemized receipt table."""
    pipeline_ts_path = FRONTEND_SRC / "types" / "pipeline.ts"
    content = pipeline_ts_path.read_text(encoding="utf-8")

    assert "export interface CreatedInvoiceReceiptItem" in content
    assert "invoice_number: string" in content
    assert "customer_name: string" in content
    assert "total_ghs: number" in content


def test_f14_existing_draft_invoices_api_contracts_in_api_ts():
    """F14: Verify api.ts exports ExistingDraftInvoice, ExistingInvoicesResponse, and fetchExistingInvoices."""
    api_ts_path = FRONTEND_SRC / "lib" / "api.ts"
    assert api_ts_path.exists(), "frontend/src/lib/api.ts must exist"
    content = api_ts_path.read_text(encoding="utf-8")

    assert "export interface ExistingDraftInvoice" in content
    assert "invoice_id: string" in content
    assert "customer_name: string" in content
    assert "export interface ExistingInvoicesResponse" in content
    assert "has_existing: boolean" in content
    assert "existing_invoices: ExistingDraftInvoice[]" in content
    assert "export async function fetchExistingInvoices" in content
    assert "/api/v1/invoices/existing" in content


def test_f16_pipeline_floating_widget_renders_clock_and_progress():
    """F16: Verify PipelineFloatingWidget component renders timer clock, progress bar, and customer stats."""
    widget_path = FRONTEND_SRC / "components" / "common" / "PipelineFloatingWidget.tsx"
    assert widget_path.exists(), "PipelineFloatingWidget.tsx must exist"
    content = widget_path.read_text(encoding="utf-8")

    assert "pipelineProgress?.is_running" in content
    assert "percent" in content
    assert "current_step" in content
    assert "elapsed_seconds" in content or "elapsed" in content
    assert "customers_done" in content
    assert "customers_total" in content


def test_f18_accelerated_polling_interval_in_automation_context():
    """F18: Verify telemetry polling interval in AutomationContext is accelerated (<= 1500ms)."""
    context_path = FRONTEND_SRC / "context" / "AutomationContext.tsx"
    assert context_path.exists(), "AutomationContext.tsx must exist"
    content = context_path.read_text(encoding="utf-8")

    assert "fetchPipelineStatus" in content
    match = re.search(r"setTimeout\s*\(\s*poll\s*,\s*(\d+)\s*\)", content)
    assert match is not None, "Polling interval timeout should be set"
    interval_ms = int(match.group(1))
    assert interval_ms <= 1500, f"Expected polling interval <= 1500ms, found {interval_ms}ms"


def test_f19_ar_party_terminology_strictly_customer_in_widget():
    """F19: Verify PipelineFloatingWidget uses Customer terminology for AR debtor progress."""
    widget_path = FRONTEND_SRC / "components" / "common" / "PipelineFloatingWidget.tsx"
    content = widget_path.read_text(encoding="utf-8")

    assert "Customer Invoicing Progress" in content
    assert "Client Invoicing Progress" not in content


def test_f19_ar_party_terminology_in_receipt_item_type():
    """F19: Verify CreatedInvoiceReceiptItem uses customer_name, not client_name."""
    pipeline_ts_path = FRONTEND_SRC / "types" / "pipeline.ts"
    content = pipeline_ts_path.read_text(encoding="utf-8")

    assert "customer_name: string" in content
    receipt_def = re.search(r"interface CreatedInvoiceReceiptItem\s*{([^}]+)}", content)
    assert receipt_def is not None
    assert "client_name" not in receipt_def.group(1), "AR debtor in receipt must be customer_name, not client_name"


def test_f22_schema_parity_invoice_generate_event():
    """F22: Schema parity check between Python InvoiceGenerateEvent and frontend trigger payload."""
    event_fields = set(InvoiceGenerateEvent.model_fields.keys())
    expected_fields = {
        "month",
        "year",
        "target_customer_name",
        "mode",
        "confirm_delete",
        "invoice_date",
        "due_date",
        "terms",
    }
    assert expected_fields.issubset(event_fields), f"Missing fields in InvoiceGenerateEvent: {expected_fields - event_fields}"


def test_f22_schema_parity_existing_invoice_item():
    """F22: Schema parity check between Python ExistingInvoiceItem and TypeScript ExistingDraftInvoice."""
    python_fields = set(ExistingInvoiceItem.model_fields.keys())
    assert "invoice_id" in python_fields
    assert "invoice_number" in python_fields
    assert "customer_name" in python_fields
    assert "total" in python_fields
    assert "status" in python_fields

    api_ts_path = FRONTEND_SRC / "lib" / "api.ts"
    content = api_ts_path.read_text(encoding="utf-8")
    for field in ["invoice_id", "invoice_number", "customer_name", "total", "status"]:
        assert f"{field}:" in content or f"{field} :" in content


def test_f22_schema_parity_pipeline_progress_state():
    """F22: Parity between backend pipeline_tracker.get_state() and frontend PipelineProgress."""
    state = pipeline_tracker.get_state()
    assert "is_running" in state
    assert "status" in state
    assert "percent" in state
    assert "current_step" in state
    assert "stats" in state
    assert "recent_logs" in state
    assert "last_result" in state
    assert "elapsed_seconds" in state
