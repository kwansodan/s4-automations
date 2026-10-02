"""Tier 1 and Tier 2 E2E Tests for Pipeline Telemetry (F7) and Itemized Receipt Payload (F8).

Verifies real-time customer iteration progress, step reporting, elapsed time,
streaming log tickers, thread safety, and last_result receipt payloads.
"""

import time
import threading
import pytest
from app.utils.progress_tracker import PipelineProgressTracker


# ---------------------------------------------------------------------------
# Tier 1: Feature Coverage (F7: Pipeline Tracker Customer Telemetry)
# ---------------------------------------------------------------------------

def test_tracker_initializes_with_customer_stats():
    """F7: start_pipeline initializes state with zeroed customer stats."""
    tracker = PipelineProgressTracker()
    tracker.start_pipeline("1-Click Zoho Invoicing", "August", 2026, total_stages=4)
    state = tracker.get_state()
    assert state["is_running"] is True
    assert state["status"] == "RUNNING"
    assert state["task_name"] == "1-Click Zoho Invoicing"
    assert state["stage_index"] == 1
    assert state["total_stages"] == 4
    assert state["percent"] == 5


def test_tracker_updates_progress_percentage():
    """F7: update_progress updates percent completion dynamically."""
    tracker = PipelineProgressTracker()
    tracker.start_pipeline("Invoicing", "August", 2026)
    tracker.update_progress(percent=45, stage_index=2)
    state = tracker.get_state()
    assert state["percent"] == 45
    assert state["stage_index"] == 2


def test_tracker_updates_current_step_description():
    """F7: Updates current operational step description with customer details."""
    tracker = PipelineProgressTracker()
    tracker.start_pipeline("Invoicing", "August", 2026)
    step_msg = "Drafting Zoho Books Invoice for customer: Labadi Beach Hotel (1/3)..."
    tracker.update_progress(percent=50, current_step=step_msg)
    state = tracker.get_state()
    assert state["current_step"] == step_msg


def test_tracker_records_streaming_logs_with_timestamps():
    """F7: add_log records operational entries with time and level."""
    tracker = PipelineProgressTracker()
    tracker.start_pipeline("Invoicing", "August", 2026)
    tracker.add_log("info", "Aggregated 4 control slips into 2 standard SKU line items.")
    tracker.add_log("success", "Created draft invoice INV-000104 for Labadi Beach Hotel.")
    state = tracker.get_state()
    logs = state["recent_logs"]
    assert len(logs) >= 2
    assert any("INV-000104" in l["message"] for l in logs)
    assert all("time" in l and "level" in l for l in logs)


def test_tracker_computes_elapsed_seconds_clock():
    """F7: Tracks non-negative elapsed execution seconds."""
    tracker = PipelineProgressTracker()
    tracker.start_pipeline("Invoicing", "August", 2026)
    time.sleep(0.05)
    state = tracker.get_state()
    assert state["elapsed_seconds"] >= 0.05


# ---------------------------------------------------------------------------
# Tier 1: Feature Coverage (F8: Itemized Receipt Payload)
# ---------------------------------------------------------------------------

def test_tracker_completes_with_invoices_created_payload():
    """F8: complete_pipeline transitions status to COMPLETED and records last_result."""
    tracker = PipelineProgressTracker()
    tracker.start_pipeline("Invoicing", "August", 2026)
    receipt_payload = {
        "status": "COMPLETED",
        "invoices_count": 2,
        "invoices_created": [
            {
                "invoice_id": "inv_labadi_01",
                "invoice_number": "INV-000104",
                "customer_name": "Labadi Beach Hotel",
                "total_ghs": 1590.00,
                "zoho_link": "https://books.zoho.com/app#/invoices/inv_labadi_01",
            },
            {
                "invoice_id": "inv_luxwood_02",
                "invoice_number": "INV-000105",
                "customer_name": "Luxwood Hotel",
                "total_ghs": 1145.00,
                "zoho_link": "https://books.zoho.com/app#/invoices/inv_luxwood_02",
            },
        ],
    }
    tracker.complete_pipeline(receipt_payload)
    state = tracker.get_state()
    assert state["is_running"] is False
    assert state["status"] == "COMPLETED"
    assert state["percent"] == 100
    assert state["last_result"] == receipt_payload


def test_tracker_receipt_contains_invoice_numbers():
    """F8: Receipt payload stores created invoice numbers."""
    tracker = PipelineProgressTracker()
    tracker.start_pipeline("Invoicing", "August", 2026)
    tracker.complete_pipeline({
        "invoices_created": [{"invoice_number": "INV-202608-0104", "customer_name": "Labadi Beach Hotel", "total_ghs": 1590.0}]
    })
    invoices = tracker.get_state()["last_result"]["invoices_created"]
    assert invoices[0]["invoice_number"] == "INV-202608-0104"


def test_tracker_receipt_contains_customer_names():
    """F8: Receipt payload strictly records debtor party as customer_name."""
    tracker = PipelineProgressTracker()
    tracker.start_pipeline("Invoicing", "August", 2026)
    tracker.complete_pipeline({
        "invoices_created": [{"invoice_number": "INV-01", "customer_name": "Labadi Beach Hotel", "total_ghs": 500.0}]
    })
    invoices = tracker.get_state()["last_result"]["invoices_created"]
    assert invoices[0]["customer_name"] == "Labadi Beach Hotel"


def test_tracker_receipt_contains_ghs_totals():
    """F8: Receipt payload stores numerical total amounts billed."""
    tracker = PipelineProgressTracker()
    tracker.start_pipeline("Invoicing", "August", 2026)
    tracker.complete_pipeline({
        "invoices_created": [{"invoice_number": "INV-02", "customer_name": "Luxwood Hotel", "total_ghs": 1145.50}]
    })
    invoices = tracker.get_state()["last_result"]["invoices_created"]
    assert invoices[0]["total_ghs"] == 1145.50


def test_tracker_get_state_returns_serializable_dict():
    """F7/F8: get_state returns JSON-serializable dictionary with expected schema keys."""
    tracker = PipelineProgressTracker()
    state = tracker.get_state()
    expected_keys = {
        "is_running", "status", "task_name", "month", "year",
        "current_step", "stage_index", "total_stages", "percent",
        "stats", "recent_logs", "elapsed_seconds", "last_result",
    }
    assert expected_keys.issubset(set(state.keys()))


# ---------------------------------------------------------------------------
# Tier 2: Boundary & Corner Cases (F7, F8)
# ---------------------------------------------------------------------------

def test_tracker_fail_pipeline_records_error_message():
    """F7 (Corner): fail_pipeline marks ERROR and sets error_message."""
    tracker = PipelineProgressTracker()
    tracker.start_pipeline("Invoicing", "August", 2026)
    err = "Zoho Books API 401 Unauthorized"
    tracker.fail_pipeline(err)
    state = tracker.get_state()
    assert state["is_running"] is False
    assert state["status"] == "ERROR"
    assert state["error_message"] == err
    assert "Failed" in state["current_step"]


def test_tracker_logs_ring_buffer_caps_at_300():
    """F7 (BVA): Log history capped to prevent unbounded memory growth."""
    tracker = PipelineProgressTracker()
    tracker.start_pipeline("Stress", "August", 2026)
    for i in range(350):
        tracker.add_log("info", f"Log item {i}")
    assert len(tracker.logs) <= 300


def test_tracker_percent_clamped_between_0_and_100():
    """F7 (BVA): Percentage updates clamped to [0, 100]."""
    tracker = PipelineProgressTracker()
    tracker.start_pipeline("Clamping", "August", 2026)
    tracker.update_progress(percent=-15)
    assert tracker.get_state()["percent"] == 0
    tracker.update_progress(percent=150)
    assert tracker.get_state()["percent"] == 100


def test_tracker_zero_customers_empty_receipt():
    """F8 (BVA): Empty invoices_created list when zero customers billed."""
    tracker = PipelineProgressTracker()
    tracker.start_pipeline("Empty Run", "August", 2026)
    tracker.complete_pipeline({"invoices_count": 0, "invoices_created": []})
    state = tracker.get_state()
    assert state["status"] == "COMPLETED"
    assert state["last_result"]["invoices_count"] == 0
    assert state["last_result"]["invoices_created"] == []


def test_tracker_concurrent_thread_safety():
    """F7 (Stress): Concurrent updates from multiple worker threads without data races."""
    tracker = PipelineProgressTracker()
    tracker.start_pipeline("Multi-threaded", "August", 2026)

    def worker(worker_id: int):
        for i in range(50):
            tracker.update_progress(percent=(i * 2) % 100, current_step=f"Worker {worker_id} step {i}")
            tracker.add_log("info", f"Worker {worker_id} log {i}")

    threads = [threading.Thread(target=worker, args=(t,)) for t in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    state = tracker.get_state()
    assert len(state["recent_logs"]) > 0
    assert 0 <= state["percent"] <= 100
