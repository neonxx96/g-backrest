from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict


@dataclass(frozen=True)
class ExecutionTrade:
    symbol: str
    side: str
    entry_price: float
    exit_price: float
    quantity: float
    gross_pnl: float
    total_fees: float
    net_pnl: float
    context_snapshot: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ExecutionSnapshot:
    balance: float
    available_margin: float
    used_margin: float
    realized_pnl: float
    total_fees: float


class BaseExecutionProvider(ABC):
    @abstractmethod
    def open_position(self, symbol: str, side: str, entry_price: float, quantity: float, **kwargs: Any) -> None: ...

    @abstractmethod
    def close_position(self, symbol: str, exit_price: float, **kwargs: Any) -> ExecutionTrade: ...

    @abstractmethod
    def snapshot(self) -> ExecutionSnapshot: ...
