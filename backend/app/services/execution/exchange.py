from typing import Any

from .base import BaseExecutionProvider, ExecutionSnapshot, ExecutionTrade


class ExchangeLiveProvider(BaseExecutionProvider):
    """Explicitly disabled adapter reserved for a future authenticated exchange integration."""

    def open_position(self, symbol: str, side: str, entry_price: float, quantity: float, **kwargs: Any) -> None:
        raise NotImplementedError("live exchange execution is not enabled")

    def close_position(self, symbol: str, exit_price: float, **kwargs: Any) -> ExecutionTrade:
        raise NotImplementedError("live exchange execution is not enabled")

    def snapshot(self) -> ExecutionSnapshot:
        raise NotImplementedError("live exchange execution is not enabled")
