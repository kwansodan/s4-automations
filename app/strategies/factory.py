"""Strategy Factory for S4 Multi-Client Accounting Suite."""

from typing import Dict, Type
from sqlmodel import Session, select

from app.strategies.base import BaseAutomationStrategy
from app.strategies.anr_laundry import ANRLaundryStrategy
from app.strategies.polaris_advisory import PolarisBankFeedStrategy
from app.strategies.mr_osei_property import MrOseiPropertyStrategy
from app.strategies.dynamic_blueprint import DynamicBlueprintStrategy
from app.models.db_models import ClientOrganization
from app.db.session import get_engine
from app.utils.logging import get_logger

logger = get_logger("strategy.factory")


class StrategyFactory:
    """Resolves and instantiates the appropriate automation strategy for a client."""

    _REGISTRY: Dict[str, Type[BaseAutomationStrategy]] = {
        "anr_group": ANRLaundryStrategy,
        "polaris": PolarisBankFeedStrategy,
        "mr_osei": MrOseiPropertyStrategy,
    }

    @classmethod
    def register(cls, client_id: str, strategy_class: Type[BaseAutomationStrategy]):
        """Dynamically registers a custom automation strategy for a new client."""
        cls._REGISTRY[client_id.strip().lower()] = strategy_class
        logger.info(f"Registered custom automation strategy for client: {client_id}")

    @classmethod
    def get(cls, client_id: str) -> BaseAutomationStrategy:
        """Returns instantiated automation strategy for the given client_id or resolves DynamicBlueprint."""
        cleaned_id = client_id.strip().lower()

        # 1. Check bespoke code registry
        strategy_class = cls._REGISTRY.get(cleaned_id)
        if strategy_class:
            return strategy_class()

        # 2. Check Database for ClientOrganization profile to run Dynamic Blueprint
        try:
            with Session(get_engine()) as session:
                client = session.exec(select(ClientOrganization).where(ClientOrganization.id == cleaned_id)).first()
                if client:
                    logger.info(f"Instantiating Dynamic Blueprint Strategy for client '{client.name}' ({client.id})")
                    return DynamicBlueprintStrategy(client)
        except Exception as e:
            logger.warning(f"Error querying client profile from database: {e}")

        # 3. Fallback
        logger.warning(f"No specific strategy or database profile found for '{client_id}'. Defaulting to ANRLaundryStrategy.")
        return ANRLaundryStrategy()

    @classmethod
    def list_available_strategies(cls) -> Dict[str, str]:
        """Returns dictionary of registered client strategies."""
        return {k: v.__name__ for k, v in cls._REGISTRY.items()}
