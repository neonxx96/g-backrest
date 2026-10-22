"""Position Sizer (SRS M4.2a) — чистый расчёт размера позиции поверх
execution_simulator, без его изменения. Денежный контур: только расчёты,
никаких ордеров; все функции детерминированы и валидируют вход.

Режимы:
- Fixed Fractional: риск = equity × risk_pct; qty = risk / |entry - stop|.
- Budgeted DCA-лестница: N лимит-ног против хода цены, СУММАРНЫЙ риск всех ног
  до общего стопа ≤ бюджета (по SRS ≤ 1% equity). Каждая нога получает долю
  бюджета риска; количество ноги = её_бюджет / |её_цена - стоп|.
- Max Portfolio Heat: сумма открытых рисков портфеля в % от equity с блокировкой
  новых входов сверх лимита.
"""

from dataclasses import dataclass, field
from typing import List, Optional, Sequence, Tuple


@dataclass(frozen=True)
class DcaLeg:
    index: int
    price: float
    quantity: float
    risk_budget_usd: float
    risk_usd: float          # фактический риск ноги до общего стопа
    notional_usd: float


@dataclass(frozen=True)
class DcaPlan:
    symbol: str
    side: str                # "LONG" | "SHORT"
    stop_price: float
    budget_usd: float
    total_risk_usd: float    # суммарный риск лестницы до стопа (<= budget_usd)
    total_quantity: float
    weighted_entry: float    # средневзвешенная цена входа по ногам
    legs: Tuple[DcaLeg, ...] = field(default_factory=tuple)


class PositionSizer:
    def __init__(self, max_portfolio_heat_pct: float = 6.0):
        if max_portfolio_heat_pct <= 0:
            raise ValueError("max_portfolio_heat_pct must be positive")
        self.max_portfolio_heat_pct = float(max_portfolio_heat_pct)

    # --- Fixed Fractional ----------------------------------------------------

    def fixed_fractional(
        self,
        equity: float,
        entry_price: float,
        stop_price: float,
        risk_pct: float = 1.0,
    ) -> float:
        """Количество по Fixed Fractional: риск = equity × risk_pct%,
        qty = risk / |entry - stop|. Направление не требуется — расстояние модулярно."""
        sl_distance = self._validate_common(equity, entry_price, stop_price)
        if risk_pct <= 0:
            raise ValueError("risk_pct must be positive")
        risk_budget = equity * (risk_pct / 100.0)
        return risk_budget / sl_distance

    # --- Budgeted DCA ladder -------------------------------------------------

    def budgeted_dca_ladder(
        self,
        symbol: str,
        side: str,
        equity: float,
        entry_price: float,
        stop_price: float,
        leg_offsets_pct: Sequence[float],
        leg_risk_shares: Optional[Sequence[float]] = None,
        risk_budget_pct: float = 1.0,
    ) -> DcaPlan:
        """Лестница DCA: нога i по цене entry ∓ offsets[i]% (против хода),
        общий стоп — stop_price. Суммарный риск лестницы ≤ equity × risk_budget_pct%.

        leg_risk_shares — доли бюджета риска на ногу (сумма строго 1.0);
        по умолчанию равные доли. Нога с ценой за стопом или на нём — ValueError
        (truth-first: такую лестницу не считаем, а не «чиним» молча)."""
        side = side.upper()
        if side not in ("LONG", "SHORT"):
            raise ValueError("side must be LONG or SHORT")
        self._validate_common(equity, entry_price, stop_price)
        if risk_budget_pct <= 0:
            raise ValueError("risk_budget_pct must be positive")
        if side == "LONG" and stop_price >= entry_price:
            raise ValueError("long stop must be below entry")
        if side == "SHORT" and stop_price <= entry_price:
            raise ValueError("short stop must be above entry")

        if not leg_offsets_pct:
            raise ValueError("leg_offsets_pct must not be empty")
        offsets = [float(o) for o in leg_offsets_pct]
        if any(o < 0 for o in offsets):
            raise ValueError("leg offsets must be >= 0")
        if any(b <= a for a, b in zip(offsets, offsets[1:])):
            raise ValueError("leg offsets must be strictly increasing")

        n = len(offsets)
        if leg_risk_shares is None:
            shares = [1.0 / n] * n
        else:
            shares = [float(s) for s in leg_risk_shares]
            if len(shares) != n:
                raise ValueError("leg_risk_shares length must match offsets")
            if any(s <= 0 for s in shares):
                raise ValueError("leg risk shares must be positive")
            if abs(sum(shares) - 1.0) > 1e-9:
                raise ValueError("leg risk shares must sum to 1.0")

        budget = equity * (risk_budget_pct / 100.0)
        sign = 1.0 if side == "LONG" else -1.0

        legs: List[DcaLeg] = []
        total_qty = 0.0
        total_risk = 0.0
        total_notional = 0.0
        for i, (offset, share) in enumerate(zip(offsets, shares)):
            leg_price = entry_price * (1.0 - sign * offset / 100.0)
            leg_stop_dist = (leg_price - stop_price) * sign
            if leg_stop_dist <= 0:
                raise ValueError(
                    f"leg {i} price {leg_price:.8f} is on or beyond the stop {stop_price:.8f}"
                )
            leg_budget = budget * share
            qty = leg_budget / leg_stop_dist
            legs.append(DcaLeg(
                index=i,
                price=round(leg_price, 8),
                quantity=qty,
                risk_budget_usd=leg_budget,
                risk_usd=qty * leg_stop_dist,
                notional_usd=qty * leg_price,
            ))
            total_qty += qty
            total_risk += qty * leg_stop_dist
            total_notional += qty * leg_price

        weighted_entry = total_notional / total_qty if total_qty > 0 else 0.0
        return DcaPlan(
            symbol=symbol.upper(),
            side=side,
            stop_price=float(stop_price),
            budget_usd=budget,
            total_risk_usd=total_risk,
            total_quantity=total_qty,
            weighted_entry=weighted_entry,
            legs=tuple(legs),
        )

    # --- Max Portfolio Heat --------------------------------------------------

    def portfolio_heat(self, open_risks_usd: Sequence[float], equity: float) -> float:
        """Текущий нагрев портфеля: Σ открытых рисков / equity × 100 (%)."""
        if equity <= 0:
            raise ValueError("equity must be positive")
        return sum(max(0.0, float(r)) for r in open_risks_usd) / equity * 100.0

    def check_heat(
        self,
        open_risks_usd: Sequence[float],
        equity: float,
        new_risk_usd: float,
        max_heat_pct: Optional[float] = None,
    ) -> Tuple[bool, float]:
        """(allowed, heat_after): пропустит ли портфель новый риск.
        heat_after — нагрев ПОСЛЕ добавления new_risk_usd (даже если вход заблокирован)."""
        limit = float(max_heat_pct) if max_heat_pct is not None else self.max_portfolio_heat_pct
        if limit <= 0:
            raise ValueError("max_heat_pct must be positive")
        if new_risk_usd < 0:
            raise ValueError("new_risk_usd must be >= 0")
        heat_after = self.portfolio_heat(open_risks_usd, equity) + (float(new_risk_usd) / equity * 100.0)
        return (heat_after <= limit + 1e-9, heat_after)

    # --- Signal Quality Multiplier (SRS M4.2b) --------------------------------

    @staticmethod
    def quality_multiplier(confluence_score: float, threshold: float = 0.65) -> float:
        """Множитель качества сигнала по Confluence Score (SRS: 0.5–1.2×).

        - score < threshold  -> 0.5 (риск режем вдвое; решение о пропуске — не здесь,
          а в Strict AND / Verdict);
        - score >= threshold -> линейно 1.0 (на пороге) … 1.2 (при score = 1.0).
        """
        score = float(confluence_score)
        if not 0.0 <= score <= 1.0:
            raise ValueError("confluence_score must be within [0, 1]")
        if not 0.0 < threshold <= 1.0:
            raise ValueError("threshold must be within (0, 1]")
        if score < threshold:
            return 0.5
        if threshold >= 1.0:
            return 1.0
        return 1.0 + 0.2 * (score - threshold) / (1.0 - threshold)

    def adjusted_risk_budget(
        self,
        equity: float,
        risk_pct: float,
        confluence_score: Optional[float] = None,
        threshold: float = 0.65,
    ) -> Tuple[float, float]:
        """(adjusted_budget_usd, multiplier): риск-бюджет с учётом quality multiplier.
        Без скора (None) множитель 1.0 — поведение Fixed Fractional не меняется."""
        if equity <= 0:
            raise ValueError("equity must be positive")
        if risk_pct <= 0:
            raise ValueError("risk_pct must be positive")
        base = equity * (risk_pct / 100.0)
        mult = 1.0 if confluence_score is None else self.quality_multiplier(confluence_score, threshold)
        return (base * mult, mult)

    # --- helpers --------------------------------------------------------------

    @staticmethod
    def _validate_common(equity: float, entry_price: float, stop_price: float) -> float:
        if equity <= 0:
            raise ValueError("equity must be positive")
        if entry_price <= 0 or stop_price <= 0:
            raise ValueError("entry_price and stop_price must be positive")
        sl_distance = abs(entry_price - stop_price)
        if sl_distance <= 0:
            raise ValueError("stop_price must differ from entry_price")
        return sl_distance
