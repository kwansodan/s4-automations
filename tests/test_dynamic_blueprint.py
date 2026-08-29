"""Unit tests for Dynamic Blueprint Strategy, Checksums & Anomaly Engine."""

import pytest
from sqlmodel import Session, select
from app.db.session import init_db, get_engine
from app.models.db_models import ClientOrganization, StagedTransaction
from app.strategies.base import SourceDocument, SourceType, ExtractedLineItem, AnomalySeverity
from app.strategies.dynamic_blueprint import DynamicBlueprintStrategy
from app.strategies.factory import StrategyFactory


@pytest.fixture(autouse=True)
def setup_database():
    init_db()


@pytest.mark.asyncio
async def test_checksum_computation_and_idempotency():
    """Verify document checksum is calculated deterministically."""
    data = b"%PDF-1.4 Mock Receipt for Total Energies GH"
    doc1 = SourceDocument(
        file_name="receipt_01.pdf",
        source_type=SourceType.EMAIL_ATTACHMENT,
        file_bytes=data,
    )
    doc2 = SourceDocument(
        file_name="receipt_02.pdf",
        source_type=SourceType.EMAIL_ATTACHMENT,
        file_bytes=data,
    )
    # Different filenames but same content have exact same SHA-256
    assert doc1.get_checksum() == doc2.get_checksum()
    assert len(doc1.get_checksum()) == 64


@pytest.mark.asyncio
async def test_dynamic_blueprint_strategy_execution():
    """Verify dynamic blueprint strategy executes standard 4-stage lifecycle."""
    with Session(get_engine()) as session:
        client = session.exec(select(ClientOrganization).where(ClientOrganization.id == "apex_logistics")).first()
        if not client:
            client = ClientOrganization(
                id="apex_logistics",
                name="Apex Haulage & Logistics",
                industry="Fleet & Haulage",
                source_type="onedrive",
                custom_config={"default_account": "Fuel & Vehicle Expenses"},
            )
        # Clean previous test transactions to verify fresh extraction
        existing_txs = session.exec(select(StagedTransaction).where(StagedTransaction.client_id == "apex_logistics")).all()
        for t in existing_txs:
            session.delete(t)
        session.commit()

    strategy = StrategyFactory.get("apex_logistics")
    assert isinstance(strategy, DynamicBlueprintStrategy)

    result = await strategy.execute(month="August", year=2026, auto_post=False)
    assert result.status == "COMPLETED"
    assert result.client_id == "apex_logistics"
    assert result.items_extracted >= 1

    # Verify staged transactions in database
    with Session(get_engine()) as session:
        staged = session.exec(select(StagedTransaction).where(StagedTransaction.client_id == "apex_logistics")).all()
        assert len(staged) >= 1
        assert staged[0].status == "PENDING"
        assert staged[0].checksum is not None


def test_anomaly_validation_rules():
    """Verify anomaly detector flags negative numbers and low confidence."""
    strategy = DynamicBlueprintStrategy(
        ClientOrganization(id="test_co", name="Test Co", industry="General")
    )
    item = ExtractedLineItem(
        item_or_description="Corrupt Invoice Item",
        total_amount=-500.0,
        confidence_score=0.45,
        discrepancy=50.0,
        discrepancy_reason="Linen loss missing count",
    )
    flags = strategy.validate_anomalies(item)

    rule_names = [f.rule_name for f in flags]
    assert "NEGATIVE_TOTAL" in rule_names
    assert "LOW_CONFIDENCE_OCR" in rule_names
    assert "INVENTORY_OR_PRICE_VARIANCE" in rule_names
