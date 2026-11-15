"""Tests for Multi-Tenant Automation Strategies & Strategy Factory."""

import pytest
from sqlmodel import Session, select
from app.strategies.factory import StrategyFactory
from app.strategies.commercial_laundry import CommercialLaundryStrategy
from app.strategies.polaris_advisory import PolarisBankFeedStrategy
from app.strategies.mr_osei_property import MrOseiPropertyStrategy
from app.strategies.base import BaseAutomationStrategy, SourceDocument, ExtractedLineItem
from app.db.session import engine, init_db
from app.models.db_models import StagedTransaction


@pytest.fixture(autouse=True)
def setup_db():
    init_db()


from unittest.mock import AsyncMock
from app.strategies.dynamic_blueprint import DynamicBlueprintStrategy


def test_strategy_factory_resolution():
    """Verify factory returns appropriate strategy instance for each client."""
    assert isinstance(StrategyFactory.get("anr_group"), (CommercialLaundryStrategy, DynamicBlueprintStrategy))
    assert isinstance(StrategyFactory.get("polaris"), PolarisBankFeedStrategy)
    assert isinstance(StrategyFactory.get("mr_osei"), MrOseiPropertyStrategy)
    # Default fallback
    assert isinstance(StrategyFactory.get("unknown_client"), CommercialLaundryStrategy)


@pytest.mark.asyncio
async def test_polaris_bank_feed_strategy_execution():
    """Verify Polaris strategy executes and stages transactions in PostgreSQL."""
    strategy = PolarisBankFeedStrategy()

    sample_sources = [
        SourceDocument(
            file_name="Stanbic_Bank_Statement_August_2026.pdf",
            source_type="bank_feed",
            mime_type="application/pdf",
            metadata={"bank_name": "Stanbic Bank Ghana", "account_no": "904000889122"},
        )
    ]
    sample_items = [
        ExtractedLineItem(
            item_or_description="AWS Cloud Infrastructure EMEA",
            category_or_account="60020 - Cloud & Hosting Expenses",
            quantity_or_debit=1450.00,
            credit_amount=0.0,
            unit_price=1450.00,
            total_amount=1450.00,
            confidence_score=0.98,
            raw_extracted_data={"date": "2026-08-04", "bank": "Stanbic Bank Ghana"},
        ),
        ExtractedLineItem(
            item_or_description="MTN Ghana Business Internet",
            category_or_account="60010 - Telecom & Utilities",
            quantity_or_debit=620.00,
            credit_amount=0.0,
            unit_price=620.00,
            total_amount=620.00,
            confidence_score=0.98,
            raw_extracted_data={"date": "2026-08-12", "bank": "Stanbic Bank Ghana"},
        ),
        ExtractedLineItem(
            item_or_description="Ghana Revenue Authority PAYE",
            category_or_account="20010 - Statutory Payroll Liabilities",
            quantity_or_debit=4850.00,
            credit_amount=0.0,
            unit_price=4850.00,
            total_amount=4850.00,
            confidence_score=0.98,
            raw_extracted_data={"date": "2026-08-18", "bank": "Stanbic Bank Ghana"},
        ),
        ExtractedLineItem(
            item_or_description="Advisory Retainer Fee - TechCorp",
            category_or_account="40010 - Management Advisory Revenue",
            quantity_or_debit=0.0,
            credit_amount=18500.00,
            unit_price=18500.00,
            total_amount=18500.00,
            confidence_score=0.98,
            raw_extracted_data={"date": "2026-08-25", "bank": "Stanbic Bank Ghana"},
        ),
    ]

    strategy.discover_sources = AsyncMock(return_value=sample_sources)
    strategy.extract_and_validate = AsyncMock(return_value=sample_items)

    result = await strategy.execute(month="August", year=2026, auto_post=True)

    assert result.client_id == "polaris"
    assert result.status == "COMPLETED"
    assert result.items_extracted >= 4
    assert result.total_amount > 0

    # Verify staging in PostgreSQL
    with Session(engine) as session:
        staged = session.exec(select(StagedTransaction).where(StagedTransaction.client_id == "polaris")).all()
        assert len(staged) >= 4


@pytest.mark.asyncio
async def test_mr_osei_property_strategy_execution():
    """Verify Mr. Osei strategy executes and stages rent ledger rows."""
    strategy = MrOseiPropertyStrategy()

    sample_sources = [
        SourceDocument(
            file_name="Rent_Receipt_Unit4B.pdf",
            source_type="email_attachment",
            mime_type="application/pdf",
        )
    ]
    sample_items = [
        ExtractedLineItem(
            item_or_description="Unit 4B Monthly Rent - August 2026",
            category_or_account="40000 - Rental Income",
            quantity_or_debit=1.0,
            unit_price=3500.00,
            total_amount=3500.00,
            confidence_score=0.95,
            raw_extracted_data={"tenant": "Ama Boateng", "unit": "4B"},
        ),
        ExtractedLineItem(
            item_or_description="Unit 2A Monthly Rent - August 2026",
            category_or_account="40000 - Rental Income",
            quantity_or_debit=1.0,
            unit_price=2800.00,
            total_amount=2800.00,
            confidence_score=0.95,
            raw_extracted_data={"tenant": "Kofi Mensah", "unit": "2A"},
        ),
    ]

    strategy.discover_sources = AsyncMock(return_value=sample_sources)
    strategy.extract_and_validate = AsyncMock(return_value=sample_items)

    result = await strategy.execute(month="August", year=2026, auto_post=True)

    assert result.client_id == "mr_osei"
    assert result.status == "COMPLETED"
    assert result.items_extracted >= 2

    # Verify rent ledger in PostgreSQL
    with Session(engine) as session:
        staged = session.exec(select(StagedTransaction).where(StagedTransaction.client_id == "mr_osei")).all()
        assert len(staged) >= 2


def test_custom_strategy_registration():
    """Verify new client strategies can be registered dynamically."""
    class ApexCustomStrategy(BaseAutomationStrategy):
        def __init__(self):
            super().__init__(client_id="apex_custom", client_name="Apex Logistics")
        async def discover_sources(self, month, year):
            return []
        async def extract_and_validate(self, sources):
            return []
        async def sync_review_workspace(self, month, year, items):
            return {}
        async def post_to_accounting(self, month, year, approved_items=None):
            return {}

    StrategyFactory.register("apex_custom", ApexCustomStrategy)
    resolved = StrategyFactory.get("apex_custom")
    assert isinstance(resolved, ApexCustomStrategy)
