"""Tests for Multi-Tenant Automation Strategies & Strategy Factory."""

import pytest
from sqlmodel import Session, select
from app.strategies.factory import StrategyFactory
from app.strategies.anr_laundry import ANRLaundryStrategy
from app.strategies.polaris_advisory import PolarisBankFeedStrategy
from app.strategies.mr_osei_property import MrOseiPropertyStrategy
from app.strategies.base import BaseAutomationStrategy, SourceDocument, ExtractedLineItem
from app.db.session import engine, init_db
from app.models.db_models import StagedTransaction


@pytest.fixture(autouse=True)
def setup_db():
    init_db()


def test_strategy_factory_resolution():
    """Verify factory returns appropriate strategy instance for each client."""
    assert isinstance(StrategyFactory.get("anr_group"), ANRLaundryStrategy)
    assert isinstance(StrategyFactory.get("polaris"), PolarisBankFeedStrategy)
    assert isinstance(StrategyFactory.get("mr_osei"), MrOseiPropertyStrategy)
    # Default fallback
    assert isinstance(StrategyFactory.get("unknown_client"), ANRLaundryStrategy)


@pytest.mark.asyncio
async def test_polaris_bank_feed_strategy_execution():
    """Verify Polaris strategy executes and stages transactions in PostgreSQL."""
    strategy = PolarisBankFeedStrategy()
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
