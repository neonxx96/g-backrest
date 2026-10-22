"""Verdict v2 — Safety Gateway (SRS M3.3).

Formal traffic-light contract that gates Live Paper activation:

- BLOCK 🔴  — hard stop: negative Net PnL after fees, insufficient sample,
  or an active TOXIC_VOLATILITY regime.
- WARNING 🟡 — proceed with caution: marginal profit factor (1.0–1.2),
  small (but not insufficient) sample, or the strategy needs L2 order book
  history that is not available (`L2 History: No data` flag).
- PASS 🟢   — all safety checks green.

Sample-size reconciliation (SRS vs ROADMAP 3.2): fewer than
``INSUFFICIENT_TRADES`` trades is a hard BLOCK ("insufficient"); between that
and ``SMALL_SAMPLE_TRADES`` is a WARNING ("small sample").
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional


class VerdictLevel(str, Enum):
    PASS = "PASS"
    WARNING = "WARNING"
    BLOCK = "BLOCK"


TOXIC_REGIME = "TOXIC_VOLATILITY"

INSUFFICIENT_TRADES = 10
SMALL_SAMPLE_TRADES = 30
MARGINAL_PF_LOW = 1.0
MARGINAL_PF_HIGH = 1.2


@dataclass(frozen=True)
class Verdict:
    level: VerdictLevel
    reasons: List[str] = field(default_factory=list)
    flags: List[str] = field(default_factory=list)

    @property
    def allows_live_paper(self) -> bool:
        """Hard gate: only BLOCK vetoes Live Paper activation."""
        return self.level is not VerdictLevel.BLOCK

    def to_dict(self) -> dict:
        return {
            "level": self.level.value,
            "reasons": list(self.reasons),
            "flags": list(self.flags),
            "allows_live_paper": self.allows_live_paper,
        }


def evaluate_verdict(
    *,
    net_pnl_usd: float,
    trades: int,
    profit_factor: Optional[float] = None,
    regime: Optional[str] = None,
    requires_l2: bool = False,
    l2_available: bool = True,
) -> Verdict:
    """Evaluates the Verdict v2 traffic-light for a backtest/preflight result."""
    block_reasons: List[str] = []
    warning_reasons: List[str] = []
    flags: List[str] = []

    if float(net_pnl_usd) < 0:
        block_reasons.append(f"Net PnL after fees is negative ({float(net_pnl_usd):.2f} USD)")

    if int(trades) < INSUFFICIENT_TRADES:
        block_reasons.append(f"Insufficient sample: {int(trades)} trades < {INSUFFICIENT_TRADES}")
    elif int(trades) < SMALL_SAMPLE_TRADES:
        warning_reasons.append(f"Small sample: {int(trades)} trades < {SMALL_SAMPLE_TRADES}")

    if regime and str(regime).upper() == TOXIC_REGIME:
        block_reasons.append(f"Market regime is {TOXIC_REGIME}")

    if requires_l2 and not l2_available:
        flags.append("L2 History: No data")
        warning_reasons.append("Strategy requires L2 order book data missing on historical dataset")

    if profit_factor is not None and MARGINAL_PF_LOW <= float(profit_factor) < MARGINAL_PF_HIGH:
        warning_reasons.append(f"Marginal profit factor {float(profit_factor):.2f} in [1.0, 1.2)")

    if block_reasons:
        return Verdict(level=VerdictLevel.BLOCK, reasons=block_reasons + warning_reasons, flags=flags)
    if warning_reasons:
        return Verdict(level=VerdictLevel.WARNING, reasons=warning_reasons, flags=flags)
    return Verdict(level=VerdictLevel.PASS, reasons=["All safety checks green"], flags=flags)
