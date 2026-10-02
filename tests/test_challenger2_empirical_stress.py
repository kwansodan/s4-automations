"""
Empirical Challenger 2 Stress Test Suite for s4-automations.
Validates:
1. Telemetry and Concurrency:
   - Thread safety of PipelineProgressTracker under high concurrency.
   - Ring buffer bound enforcement (capped at 300 entries).
   - Percentage clamping between 0 and 100.
2. Receipt Data Integrity:
   - Itemized receipt schema and field presence.
   - Large volume currency amounts (100,000+ GHS).
   - Floating point arithmetic drift detection.
3. Frontend Contracts and Lifecycles:
   - Modal 3-phase transition logic (config -> live_progress -> receipt).
   - Floating widget visibility condition (is_running && !isInvoiceModalOpen).
   - Sequential polling timing (1.2s) and flight guard.
"""

import threading
import time
import re
from pathlib import Path
from decimal import Decimal
import pytest

from app.utils.progress_tracker import PipelineProgressTracker, pipeline_tracker
from app.models.schemas import ZohoDraftInvoiceResponse, ExistingInvoiceItem

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_SRC = REPO_ROOT / "frontend" / "src"


# ==============================================================================
# SECTION 1: TELEMETRY AND CONCURRENCY STRESS TESTS
# ==============================================================================

def test_tracker_thread_safety_under_heavy_concurrency():
    """Verify thread safety with 40 concurrent worker threads updating progress and logs."""
    tracker = PipelineProgressTracker()
    tracker.start_pipeline("Stress Test Pipeline", "August", 2026, total_stages=10)

    errors = []
    read_states = []

    def writer_worker(thread_id: int):
        try:
            for i in range(100):
                tracker.update_progress(
                    percent=(thread_id * 10 + i) % 100,
                    stage_index=(i % 10) + 1,
                    current_step=f"Thread {thread_id} step {i}",
                    stats_update={"slips_processed": i, "items_extracted": i * 2},
                )
                tracker.add_log("info", f"Thread {thread_id} log message #{i}")
        except Exception as e:
            errors.append(f"Writer thread {thread_id} failed: {e}")

    def reader_worker(thread_id: int):
        try:
            for _ in range(50):
                state = tracker.get_state()
                # Verify reading state produces valid structure without race condition
                assert isinstance(state["recent_logs"], list)
                assert isinstance(state["stats"], dict)
                read_states.append(state["percent"])
                time.sleep(0.001)
        except Exception as e:
            errors.append(f"Reader thread {thread_id} failed: {e}")

    threads = []
    # 20 writer threads
    for t in range(20):
        threads.append(threading.Thread(target=writer_worker, args=(t,)))
    # 20 reader threads
    for t in range(20):
        threads.append(threading.Thread(target=reader_worker, args=(t,)))

    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(errors) == 0, f"Thread safety violations detected: {errors}"
    final_state = tracker.get_state()
    assert 0 <= final_state["percent"] <= 100
    assert len(final_state["recent_logs"]) <= 50
    assert len(tracker.logs) == 300, f"Expected ring buffer capped at 300, found {len(tracker.logs)}"


def test_tracker_log_ring_buffer_bounds_and_no_memory_leak():
    """Verify that adding 5,000 logs strictly bounds log storage at exactly 300 entries."""
    tracker = PipelineProgressTracker()
    tracker.start_pipeline("Log Bound Test", "August", 2026)

    for i in range(5000):
        tracker.add_log("info", f"High volume log entry #{i}")

    assert len(tracker.logs) == 300
    # First entry should be the 4700th log
    assert "High volume log entry #4700" in tracker.logs[0]["message"]
    # Last entry should be the 4999th log
    assert "High volume log entry #4999" in tracker.logs[-1]["message"]

    # Verify get_state recent_logs is capped at 50
    state = tracker.get_state()
    assert len(state["recent_logs"]) == 50
    assert "High volume log entry #4999" in state["recent_logs"][-1]["message"]


def test_tracker_percentage_progression_clamping():
    """Verify percentage progression strictly clamps to [0, 100] for invalid and extreme inputs."""
    tracker = PipelineProgressTracker()
    tracker.start_pipeline("Clamp Test", "August", 2026)

    # Negative bounds
    tracker.update_progress(percent=-50)
    assert tracker.get_state()["percent"] == 0

    tracker.update_step(current_step="Step A", percent=-1)
    assert tracker.get_state()["percent"] == 0

    # Upper bounds
    tracker.update_progress(percent=101)
    assert tracker.get_state()["percent"] == 100

    tracker.update_step(current_step="Step B", percent=99999)
    assert tracker.get_state()["percent"] == 100

    # Normal range
    tracker.update_progress(percent=42)
    assert tracker.get_state()["percent"] == 42


# ==============================================================================
# SECTION 2: RECEIPT DATA INTEGRITY AND CURRENCY PRECISION
# ==============================================================================

def test_receipt_structure_and_large_currency_amounts():
    """Verify receipt structure handles 100,000+ GHS volume without truncation or error."""
    large_amount_1 = 125500.75
    large_amount_2 = 250000.25
    expected_total = 375501.00

    item1 = ZohoDraftInvoiceResponse(
        code=0,
        message="Created",
        invoice_id="inv_large_1",
        invoice_number="INV-009001",
        customer_id="cust_001",
        customer_name="Labadi Beach Hotel",
        total=large_amount_1,
        status="draft",
        invoice_url="https://books.zoho.com/app#/invoices/inv_large_1",
        date="2026-08-31",
        due_date="2026-09-14",
    )

    item2 = ZohoDraftInvoiceResponse(
        code=0,
        message="Created",
        invoice_id="inv_large_2",
        invoice_number="INV-009002",
        customer_id="cust_002",
        customer_name="The Bantree Restaurant",
        total=large_amount_2,
        status="draft",
        invoice_url="https://books.zoho.com/app#/invoices/inv_large_2",
        date="2026-08-31",
        due_date="2026-09-14",
    )

    created_invoices = [
        {
            **item1.model_dump(),
            "customer_name": item1.customer_name,
            "total_ghs": item1.total,
            "zoho_link": item1.invoice_url,
        },
        {
            **item2.model_dump(),
            "customer_name": item2.customer_name,
            "total_ghs": item2.total,
            "zoho_link": item2.invoice_url,
        },
    ]

    total_billed = sum(inv["total_ghs"] for inv in created_invoices)
    receipt_payload = {
        "status": "COMPLETED",
        "mode": "append",
        "month": "August",
        "year": 2026,
        "invoices_count": len(created_invoices),
        "total_billed_ghs": total_billed,
        "invoices_created": created_invoices,
    }

    # Verify receipt fields
    assert receipt_payload["invoices_count"] == 2
    assert receipt_payload["total_billed_ghs"] == expected_total

    tracker = PipelineProgressTracker()
    tracker.start_pipeline("Invoicing Run", "August", 2026)
    tracker.complete_pipeline(summary=receipt_payload)

    state = tracker.get_state()
    assert state["status"] == "COMPLETED"
    assert state["last_result"] is not None
    assert len(state["last_result"]["invoices_created"]) == 2

    first_inv = state["last_result"]["invoices_created"][0]
    assert first_inv["invoice_number"] == "INV-009001"
    assert first_inv["customer_name"] == "Labadi Beach Hotel"
    assert first_inv["total_ghs"] == 125500.75
    assert "https://books.zoho.com/app#/invoices/inv_large_1" in first_inv["zoho_link"]


def test_currency_precision_and_floating_point_drift_mitigation():
    """Verify that multiple currency totals do not experience arithmetic precision drift."""
    # Test summing 100 fractional items that trigger standard IEEE 754 drift (e.g. 0.10, 0.20)
    items = [19.99 for _ in range(33)]  # 19.99 * 33 = 659.67
    items.extend([100.10, 200.20, 300.30])  # 600.60
    # True sum: 659.67 + 600.60 = 1260.27

    float_sum = sum(items)
    decimal_sum = sum(Decimal(str(x)) for x in items)

    # In standard float, sum(items) might be 1260.2700000000002
    assert abs(float_sum - float(decimal_sum)) < 1e-9

    # Test formatCurrency parity: formatting to 2 decimal places produces exact string
    formatted_float = f"GHS {float_sum:,.2f}"
    formatted_decimal = f"GHS {decimal_sum:,.2f}"
    assert formatted_float == formatted_decimal
    assert formatted_float == "GHS 1,260.27"


# ==============================================================================
# SECTION 3: FRONTEND STATE AND LIFECYCLE CONTRACTS
# ==============================================================================

def test_modal_three_phase_transitions_in_codebase():
    """Verify InvoiceModal enforces strict 3-phase transitions (config -> live_progress -> receipt)."""
    modal_file = FRONTEND_SRC / "components" / "modals" / "InvoiceModal.tsx"
    assert modal_file.exists()
    content = modal_file.read_text(encoding="utf-8")

    # 1. Type definition contains exactly the 3 phases
    phase_match = re.search(r"type InvoiceModalPhase\s*=\s*'config'\s*\|\s*'live_progress'\s*\|\s*'receipt';", content)
    assert phase_match is not None, "InvoiceModalPhase must be 'config' | 'live_progress' | 'receipt'"

    # 2. Initial state is config
    assert "useState<InvoiceModalPhase>('config')" in content

    # 3. Transition to live_progress upon dispatch
    assert "setPhase('live_progress')" in content

    # 4. Transition to receipt upon completed pipeline
    receipt_transition = re.search(
        r"pipelineProgress\?\.status\s*===\s*'COMPLETED'\s*&&\s*phase\s*===\s*'live_progress'",
        content,
    )
    assert receipt_transition is not None, "Must transition to receipt when status is COMPLETED and phase is live_progress"

    # 5. Transition back to config on Done receipt action
    done_handler = re.search(r"const handleDoneReceipt\s*=\s*\(\)\s*=>\s*\{[^}]*setPhase\('config'\)", content)
    assert done_handler is not None, "handleDoneReceipt must reset phase to config"

    # 6. Fallback back to config on early error
    error_recovery = re.search(r"catch\s*\([^)]*\)\s*\{[\s\S]*?setPhase\('config'\)", content)
    assert error_recovery is not None, "Must return to config phase on dispatch failure"


def test_floating_widget_visibility_condition_contract():
    """Verify floating widget visibility requires running pipeline AND closed invoice modal."""
    app_file = FRONTEND_SRC / "App.tsx"
    assert app_file.exists()
    app_content = app_file.read_text(encoding="utf-8")

    # Visibility condition in App.tsx
    widget_render = re.search(
        r"pipelineProgress\?\.is_running\s*&&\s*!isInvoiceModalOpen\s*&&\s*\(\s*<PipelineFloatingWidget\s*/>\s*\)",
        app_content,
    )
    assert widget_render is not None, "PipelineFloatingWidget must be conditioned on pipelineProgress?.is_running && !isInvoiceModalOpen"

    # Widget self-defense in PipelineFloatingWidget.tsx
    widget_file = FRONTEND_SRC / "components" / "common" / "PipelineFloatingWidget.tsx"
    assert widget_file.exists()
    widget_content = widget_file.read_text(encoding="utf-8")
    assert "if (!pipelineProgress?.is_running)" in widget_content
    assert "return null" in widget_content


def test_sequential_polling_rate_and_flight_guard():
    """Verify AutomationContext polls sequentially at 1.2s without request stacking."""
    context_file = FRONTEND_SRC / "context" / "AutomationContext.tsx"
    assert context_file.exists()
    content = context_file.read_text(encoding="utf-8")

    # Check isRequestInFlight guard preventing stacking
    assert "let isRequestInFlight = false;" in content
    assert "if (!isMounted || isRequestInFlight) return;" in content
    assert "isRequestInFlight = true;" in content

    # Check 1200ms (1.2s) polling interval
    poll_timeout = re.search(r"timeoutId\s*=\s*setTimeout\s*\(\s*poll\s*,\s*1200\s*\);", content)
    assert poll_timeout is not None, "Polling interval must be exactly 1200ms (1.2s)"

    # Check termination on completion
    assert "if (!progress.is_running)" in content
    assert "return; // Terminate polling" in content


def test_no_em_dashes_in_challenger_and_core_files():
    """Verify zero em dashes in target files."""
    em_dash = "\u2014"
    files_to_check = [
        FRONTEND_SRC / "components" / "modals" / "InvoiceModal.tsx",
        FRONTEND_SRC / "components" / "common" / "PipelineFloatingWidget.tsx",
        FRONTEND_SRC / "context" / "AutomationContext.tsx",
        REPO_ROOT / "app" / "utils" / "progress_tracker.py",
        REPO_ROOT / "app" / "workflows" / "zoho_invoice_generator.py",
    ]

    for f in files_to_check:
        if f.exists():
            text = f.read_text(encoding="utf-8")
            assert em_dash not in text, f"Em dash detected in {f.relative_to(REPO_ROOT)}"


def test_ar_party_terminology_strictly_customer():
    """Verify accounts receivable party terminology strictly uses Customer, never Client."""
    # Check InvoiceModal itemized receipt list
    modal_content = (FRONTEND_SRC / "components" / "modals" / "InvoiceModal.tsx").read_text(encoding="utf-8")
    assert "customer_name" in modal_content
    assert "Itemized Zoho Books Draft Invoices" in modal_content

    # Check PipelineFloatingWidget
    widget_content = (FRONTEND_SRC / "components" / "common" / "PipelineFloatingWidget.tsx").read_text(encoding="utf-8")
    assert "Customer Invoicing Progress:" in widget_content
    assert "Client Invoicing Progress:" not in widget_content
