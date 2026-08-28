"""Tests for Inngest durable workflows."""

import pytest
from unittest.mock import AsyncMock, MagicMock
from app.workflows.daily_billing_pipeline import execute_daily_billing_pipeline
from app.workflows.zoho_invoice_generator import execute_generate_zoho_invoices


class MockContext:
    def __init__(self, data=None):
        self.event = MagicMock()
        self.event.data = data or {}


class MockStep:
    async def run(self, step_id, fn):
        if callable(fn):
            import inspect
            if inspect.iscoroutinefunction(fn):
                return await fn()
            return fn()
        return fn


@pytest.mark.asyncio
async def test_daily_billing_pipeline_workflow():
    ctx = MockContext({"month": "August", "year": 2026})
    step = MockStep()

    result = await execute_daily_billing_pipeline(ctx, step)
    assert result["status"] == "COMPLETED"
    assert result["month_name"] == "August"
    assert result["year"] == 2026
    assert result["total_clients_discovered"] >= 5
    assert result["total_slips_processed"] > 0
    assert len(result["clients_processed"]) >= 5


@pytest.mark.asyncio
async def test_zoho_invoice_generator_workflow():
    ctx = MockContext({"month": "August", "year": 2026})
    step = MockStep()

    result = await execute_generate_zoho_invoices(ctx, step)
    assert result["status"] == "COMPLETED"
    assert result["invoices_count"] > 0
    assert len(result["invoices_created"]) > 0
    assert result["invoices_created"][0]["status"] == "draft"
