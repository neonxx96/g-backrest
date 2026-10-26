"""Hedge Mode ledger (SRS M4.1) — изолированные суб-кошельки маржи для
одновременных Long и Short суб-стратегий. Чистый учёт без ордеров:

- Общий баланс делится на именованные суб-кошельки (например "long:trend",
  "short:scalp"); каждая суб-стратегия видит только свою маржу.
- Перевод маржи между кошельками и из/в общий неразмещённый пул — только через
  явные операции allocate/deallocate с валидацией (нельзя выделить больше пула,
  нельзя снять занятую маржу открытой позиции).
- Открытие/закрытие позиции резервирует/освобождает маржу внутри кошелька;
  realized PnL пишется в кошелёк суб-стратегии (изолированный учёт).
- Ликвидационная изоляция: риск позиции ограничен маржой СВОЕГО кошелька —
  убыток одной суб-стратегии не трогает чужие кошельки.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class SubWallet:
    name: str
    side: str                     # "LONG" | "SHORT"
    margin_allocated: float = 0.0
    margin_in_use: float = 0.0
    realized_pnl: float = 0.0
    open_positions: int = 0

    @property
    def margin_free(self) -> float:
        return self.margin_allocated - self.margin_in_use

    @property
    def equity(self) -> float:
        return self.margin_allocated + self.realized_pnl


class HedgeLedger:
    """Реестр суб-кошельков поверх общего баланса. Все суммы в USD."""

    def __init__(self, total_balance: float):
        if total_balance <= 0:
            raise ValueError("total_balance must be positive")
        self.total_balance = float(total_balance)
        self._wallets: Dict[str, SubWallet] = {}

    # --- wallets ---------------------------------------------------------------

    def create_wallet(self, name: str, side: str) -> SubWallet:
        side = side.upper()
        if side not in ("LONG", "SHORT"):
            raise ValueError("side must be LONG or SHORT")
        if not name or not name.strip():
            raise ValueError("wallet name must be non-empty")
        if name in self._wallets:
            raise ValueError(f"wallet already exists: {name}")
        wallet = SubWallet(name=name, side=side)
        self._wallets[name] = wallet
        return wallet

    def wallet(self, name: str) -> SubWallet:
        try:
            return self._wallets[name]
        except KeyError:
            raise ValueError(f"unknown wallet: {name}")

    def wallets(self) -> List[SubWallet]:
        return list(self._wallets.values())

    # --- margin moves ------------------------------------------------------------

    @property
    def unallocated(self) -> float:
        """Неразмещённый пул = баланс + суммарный realized PnL − выделенная маржа."""
        total_pnl = sum(w.realized_pnl for w in self._wallets.values())
        allocated = sum(w.margin_allocated for w in self._wallets.values())
        return self.total_balance + total_pnl - allocated

    def allocate(self, name: str, amount: float) -> None:
        if amount <= 0:
            raise ValueError("amount must be positive")
        if amount > self.unallocated + 1e-9:
            raise ValueError(
                f"insufficient unallocated margin: {amount:.4f} > {self.unallocated:.4f}"
            )
        self.wallet(name).margin_allocated += float(amount)

    def deallocate(self, name: str, amount: float) -> None:
        wallet = self.wallet(name)
        if amount <= 0:
            raise ValueError("amount must be positive")
        if amount > wallet.margin_free + 1e-9:
            raise ValueError(
                f"cannot deallocate margin in use: {amount:.4f} > free {wallet.margin_free:.4f}"
            )
        wallet.margin_allocated -= float(amount)

    # --- positions (учёт резервирования маржи) ------------------------------------

    def open_position(self, name: str, margin_required: float) -> None:
        wallet = self.wallet(name)
        if margin_required <= 0:
            raise ValueError("margin_required must be positive")
        if margin_required > wallet.margin_free + 1e-9:
            raise ValueError(
                f"wallet '{name}' margin exceeded: {margin_required:.4f} > free {wallet.margin_free:.4f}"
            )
        wallet.margin_in_use += float(margin_required)
        wallet.open_positions += 1

    def close_position(self, name: str, margin_released: float, realized_pnl: float) -> float:
        """Закрытие позиции. Возвращает realized_pnl, фактически зачтённый кошельку:
        в изолированной марже убыток ноги ограничен её маржой (ликвидация по
        isolated margin) — излишек убытка НЕ перетекает в другие кошельки."""
        wallet = self.wallet(name)
        if wallet.open_positions <= 0:
            raise ValueError(f"wallet '{name}' has no open positions")
        if margin_released <= 0:
            raise ValueError("margin_released must be positive")
        if margin_released > wallet.margin_in_use + 1e-9:
            raise ValueError(
                f"released margin exceeds margin in use: {margin_released:.4f} > {wallet.margin_in_use:.4f}"
            )
        # Isolated margin: убыток ноги клампится её маржой, остальное — обязательство биржи
        booked_pnl = max(float(realized_pnl), -float(margin_released))
        wallet.margin_in_use -= float(margin_released)
        wallet.open_positions -= 1
        wallet.realized_pnl += booked_pnl
        return booked_pnl

    # --- summary ------------------------------------------------------------

    def summary(self) -> dict:
        return {
            "total_balance": round(self.total_balance, 4),
            "unallocated": round(self.unallocated, 4),
            "total_realized_pnl": round(sum(w.realized_pnl for w in self._wallets.values()), 4),
            "wallets": [
                {
                    "name": w.name,
                    "side": w.side,
                    "margin_allocated": round(w.margin_allocated, 4),
                    "margin_in_use": round(w.margin_in_use, 4),
                    "margin_free": round(w.margin_free, 4),
                    "realized_pnl": round(w.realized_pnl, 4),
                    "equity": round(w.equity, 4),
                    "open_positions": w.open_positions,
                }
                for w in self._wallets.values()
            ],
        }
