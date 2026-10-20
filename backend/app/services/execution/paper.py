from dataclasses import dataclass, field
from typing import Any, Dict

from backend.app.services.paper_trading import PaperTradingSession
from .base import BaseExecutionProvider, ExecutionSnapshot, ExecutionTrade


@dataclass
class _Position:
    symbol: str
    side: str
    entry_price: float
    quantity: float
    leverage: float
    margin: float
    entry_fee: float
    context_snapshot: Dict[str, Any] = field(default_factory=dict)


class PaperSandboxProvider(BaseExecutionProvider):
    """Deterministic accounting adapter backed by the existing paper session boundary."""

    def __init__(self, initial_balance: float = 1000.0, default_leverage: float = 1.0, maker_fee: float = 0.0002, taker_fee: float = 0.0005):
        if initial_balance <= 0 or default_leverage < 1:
            raise ValueError("invalid sandbox configuration")
        self.session = PaperTradingSession(initial_balance=initial_balance)
        self.initial_balance = float(initial_balance)
        self.default_leverage = float(default_leverage)
        self.maker_fee = float(maker_fee)
        self.taker_fee = float(taker_fee)
        self.balance = float(initial_balance)
        self.realized_pnl = 0.0
        self.total_fees = 0.0
        self.positions: Dict[str, _Position] = {}

    def open_position(self, symbol: str, side: str, entry_price: float, quantity: float, **kwargs: Any) -> None:
        symbol = symbol.upper()
        side = side.upper()
        if side not in {"LONG", "SHORT"} or entry_price <= 0 or quantity <= 0 or symbol in self.positions:
            raise ValueError("invalid or duplicate position")
        leverage = float(kwargs.get("leverage", self.default_leverage))
        if leverage < 1:
            raise ValueError("leverage must be >= 1")
        margin = entry_price * quantity / leverage
        if margin > self.snapshot().available_margin:
            raise ValueError("insufficient available margin")
        fee = entry_price * quantity * (self.maker_fee if kwargs.get("maker", True) else self.taker_fee)
        self.total_fees += fee
        self.balance -= fee
        self.positions[symbol] = _Position(symbol, side, entry_price, quantity, leverage, margin, fee, dict(kwargs.get("context", {})))

    def apply_funding(self, symbol: str, rate: float) -> float:
        position = self.positions.get(symbol.upper())
        if position is None:
            raise ValueError("position not found")
        funding = position.entry_price * position.quantity * float(rate)
        self.total_fees += funding
        self.balance -= funding
        return funding

    def close_position(self, symbol: str, exit_price: float, **kwargs: Any) -> ExecutionTrade:
        position = self.positions.pop(symbol.upper(), None)
        if position is None or exit_price <= 0:
            raise ValueError("position not found or invalid exit")
        gross = ((exit_price - position.entry_price) if position.side == "LONG" else (position.entry_price - exit_price)) * position.quantity
        exit_fee = exit_price * position.quantity * (self.maker_fee if kwargs.get("maker", True) else self.taker_fee)
        self.total_fees += exit_fee
        self.balance += gross - exit_fee
        self.realized_pnl += gross - position.entry_fee - exit_fee
        return ExecutionTrade(position.symbol, position.side, position.entry_price, exit_price, position.quantity, gross, position.entry_fee + exit_fee, gross - position.entry_fee - exit_fee, position.context_snapshot)

    def snapshot(self) -> ExecutionSnapshot:
        used = sum(position.margin for position in self.positions.values())
        return ExecutionSnapshot(self.balance, max(0.0, self.balance - used), used, self.realized_pnl, self.total_fees)
