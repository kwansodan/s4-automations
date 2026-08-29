"""Strategy Factory for S4 Multi-Client Accounting Suite."""

from typing import Dict, Type
from app.strategies.base import BaseAutomationStrategy
from app.strategies.anr_laundry import ANRLaundryStrategy
from app.strategies.polaris_advisory import PolarisBankFeedStrategy
from app.strategies.mr_osei_property import MrOseiPropertyStrategy
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
        cls._REGISTRY[client_id] = strategy_class
        logger.info(f"Registered custom automation strategy for client: {client_id}")

    @classmethod
    def get(cls, client_id: str) -> BaseAutomationStrategy:
        """Returns instantiated automation strategy for the given client_id."""
        cleaned_id = client_id.strip().lower()
        strategy_class = cls._REGISTRY.get(cleaned_id)
        if not strategy_class:
            logger.warning(f"No specific strategy registered for client '{client_id}'. Falling back to default ANR strategy.")
            return ANRLaundryStrategy()
        return strategy_class()

    @classmethod
    def list_available_strategies(cls) -> Dict[str, str]:
        """Returns dictionary of registered client strategies."""
        return {k: v.__name__ for k, v in cls._REGISTRY.items()}
