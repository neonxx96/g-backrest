"""
risk_engine.py — Portfolio Risk Engine, Sizing by Stop Distance, Correlation Penalty & Circuit Breaker
====================================================================================================
Implements institutional quantitative risk controls for Binance Futures USDT-M paper/live trading:
1. Strict Fixed-Fractional Sizing from Stop Distance: Qty = (Equity * RiskPct) / |Entry - Stop|
2. Portfolio Heat & Directional Heat Enforcement (Max 1.25% total risk, Max 0.75% single direction)
3. Maximum Concurrent Open Positions: 4
4. Dynamic Effective Leverage Cap (Max 5.0x under standard conditions)
5. Correlation Penalty: Lambda-damped risk reduction for simultaneous correlated crypto assets
6. Circuit Breaker: Daily loss limit (-1.25%), Weekly loss limit (-3.50%), 3 consecutive stops
7. Safe Pyramiding Verification: Add-ons only when total chain risk at stop <= initial risk budget
"""
from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


def floor_to_step(value: float, step: float) -> float:
    """Floor value to exchange lot size / step size."""
    if step <= 0.0 or not math.isfinite(value) or value <= 0.0:
        return 0.0
    precision = max(0, -int(math.floor(math.log10(step)))) if step < 1.0 else 0
    steps = math.floor(value / step + 1e-9)
    return round(steps * step, precision)


def calc_position_by_risk(
    equity: float,
    risk_pct: float,
    entry: float,
    stop: float,
    side: str,
    step_size: float = 0.001,
    min_notional: float = 5.0,
    max_leverage: float = 5.0,
    taker_fee_pct: float = 0.05,
    slippage_bps: float = 2.0,
) -> Optional[Dict[str, Any]]:
    """
    Fixed-Fractional position sizing strictly derived from structural Stop Loss distance,
    incorporating round-trip trading commissions and expected slippage friction:
    Total unit risk distance = |Entry - Stop| + Entry * (2 * taker_fee + slippage_bps/10,000).
    Leverage is an output consequence, NOT a target parameter.
    """
    if equity <= 0 or entry <= 0 or stop <= 0 or risk_pct <= 0:
        return None

    structural_distance = abs(entry - stop)
    if structural_distance <= 0:
        return None

    # Costs per unit: round-trip taker fee + estimated entry/exit slippage
    fee_rate = 2.0 * (taker_fee_pct / 100.0) if taker_fee_pct > 0.001 else 2.0 * taker_fee_pct
    friction_rate = fee_rate + (slippage_bps / 10_000.0)
    effective_stop_distance = structural_distance + (entry * friction_rate)

    risk_usd = equity * risk_pct
    raw_qty = risk_usd / effective_stop_distance
    qty = floor_to_step(raw_qty, step_size)
    if qty <= 0:
        return None

    notional = qty * entry
    effective_leverage = notional / equity

    if notional < min_notional:
        logger.debug(f"[RiskEngine] Notional ${notional:.2f} below minNotional ${min_notional:.2f}")
        return None

    if effective_leverage > max_leverage:
        # Scale back quantity to satisfy max_leverage limit
        max_notional = equity * max_leverage
        qty = floor_to_step(max_notional / entry, step_size)
        if qty <= 0:
            return None
        notional = qty * entry
        effective_leverage = notional / equity
        if notional < min_notional:
            return None

    total_risk_with_costs = qty * effective_stop_distance

    return {
        "qty": qty,
        "entry": entry,
        "stop": stop,
        "side": side.upper(),
        "notional": notional,
        "risk_usd": total_risk_with_costs,
        "structural_risk_usd": qty * structural_distance,
        "risk_pct": total_risk_with_costs / equity,
        "leverage": effective_leverage,
        "effective_leverage": effective_leverage,
        "stop_distance": structural_distance,
        "stop_distance_pct": (structural_distance / entry) * 100.0,
        "effective_stop_distance": effective_stop_distance,
    }


def adjusted_risk_pct(
    base_risk_pct: float,
    new_symbol: str,
    new_side: str,
    open_positions: List[Dict[str, Any]],
    corr_matrix: Optional[Dict[str, Dict[str, float]]] = None,
    lambda_corr: float = 0.6,
) -> float:
    """
    Penalizes risk when opening additional correlated crypto assets on the same side.
    If BTC is already LONG, opening ETH/SOL LONG gets a reduced risk budget.
    """
    same_side = [
        p for p in open_positions
        if str(p.get("side", "")).upper() == new_side.upper()
        and p.get("symbol") != new_symbol
    ]
    if not same_side:
        return base_risk_pct

    if not corr_matrix:
        # Default crypto inter-asset correlation assumption is 0.75 if matrix not supplied
        avg_rho = 0.75
    else:
        rhos = []
        for p in same_side:
            sym = p.get("symbol")
            rho = corr_matrix.get(new_symbol, {}).get(sym, 0.75)
            rhos.append(abs(float(rho)))
        avg_rho = sum(rhos) / len(rhos) if rhos else 0.75

    discount = max(0.20, 1.0 - (lambda_corr * avg_rho))
    return base_risk_pct * discount


def can_open_position(
    new_risk_usd: float,
    new_side: str,
    open_positions: List[Dict[str, Any]],
    equity: float,
    pending_orders: Optional[List[Dict[str, Any]]] = None,
    max_positions: int = 4,
    max_portfolio_heat_pct: float = 0.0125,     # 1.25% ($12.50 on $1,000)
    max_directional_heat_pct: float = 0.0075,   # 0.75% ($7.50 on $1,000)
) -> Tuple[bool, str]:
    """
    Verifies that adding a new position respects concurrent position counts,
    aggregate Portfolio Heat (including active positions + reserved risk in pending entry orders),
    and Directional Heat limits.
    """
    pending_entries = [
        o for o in (pending_orders or [])
        if str(o.get("role", "")).upper() in ("ENTRY", "PAPERORDERROLE.ENTRY")
        and str(o.get("status", "")).upper() in ("PENDING", "ACTIVE", "PARTIALLY_FILLED", "ORDERSTATUS.PENDING", "ORDERSTATUS.ACTIVE")
    ]

    total_active_count = len(open_positions) + len(pending_entries)
    if total_active_count >= max_positions:
        return False, f"MAX_CONCURRENT_POSITIONS_REACHED ({total_active_count}/{max_positions})"

    current_portfolio_heat = sum(float(p.get("risk_usd", 0.0)) for p in open_positions)
    current_portfolio_heat += sum(float(o.get("reserved_risk", 0.0)) for o in pending_entries)

    max_heat_usd = equity * max_portfolio_heat_pct
    if (current_portfolio_heat + new_risk_usd) > (max_heat_usd + 1e-9):
        return False, f"PORTFOLIO_HEAT_EXCEEDED (Total: ${current_portfolio_heat + new_risk_usd:.2f} > Limit: ${max_heat_usd:.2f})"

    current_side_heat = sum(
        float(p.get("risk_usd", 0.0))
        for p in open_positions
        if str(p.get("side", "")).upper() == new_side.upper()
    )
    current_side_heat += sum(
        float(o.get("reserved_risk", 0.0))
        for o in pending_entries
        if str(o.get("side", "")).upper() in (new_side.upper(), ("BUY" if new_side.upper() == "LONG" else "SELL"))
    )

    max_directional_usd = equity * max_directional_heat_pct
    if (current_side_heat + new_risk_usd) > (max_directional_usd + 1e-9):
        return False, f"DIRECTIONAL_HEAT_EXCEEDED ({new_side}: ${current_side_heat + new_risk_usd:.2f} > Limit: ${max_directional_usd:.2f})"

    return True, "OK"


def check_circuit_breaker(
    day_pnl_pct: float,
    consecutive_losses: int,
    week_pnl_pct: float = 0.0,
    daily_loss_limit_pct: float = -1.25,
    weekly_loss_limit_pct: float = -3.50,
    max_consecutive_losses: int = 3,
) -> Tuple[bool, str]:
    """
    Emergency pause trigger when portfolio loss limits are reached.
    """
    if day_pnl_pct <= daily_loss_limit_pct:
        return True, f"DAILY_LOSS_LIMIT_REACHED ({day_pnl_pct:.2f}% <= {daily_loss_limit_pct:.2f}%)"

    if consecutive_losses >= max_consecutive_losses:
        return True, f"CONSECUTIVE_LOSS_LIMIT_REACHED ({consecutive_losses} consecutive losses)"

    if week_pnl_pct <= weekly_loss_limit_pct:
        return True, f"WEEKLY_LOSS_LIMIT_REACHED ({week_pnl_pct:.2f}% <= {weekly_loss_limit_pct:.2f}%)"

    return False, "OK"


def select_max_leverage(regime: str, atr_pct: float = 50.0, spread_bps: float = 2.0) -> float:
    """
    Returns the dynamic technical leverage ceiling based on the prevailing market regime.
    """
    reg = str(regime or "").upper()
    if reg in ("TOXIC_DEADZONE", "NO_TRADE"):
        return 0.0
    if reg == "VOLATILITY_EXPANSION":
        return 2.0
    if reg == "RANGE_CHOP":
        return 3.0
    if reg in ("TREND_UP", "TREND_DOWN"):
        if atr_pct >= 80.0 or spread_bps > 3.0:
            return 3.0
        if atr_pct <= 40.0:
            return 5.0
        return 4.0
    return 3.0


# --- Phase 2: Safe Pyramiding to Winners --------------------------------------

ENABLE_PYRAMIDING: bool = False  # STRICT SAFETY: Disabled by default until base edge validated on 200+ demo trades

def can_add_pyramid_layer(
    position: Dict[str, Any],
    regime: str,
    mfe_r: float,
    microstructure_ok: bool = True,
    max_adds: int = 2,
    enable_pyramiding: bool = ENABLE_PYRAMIDING,
) -> Tuple[bool, str]:
    """
    Validates whether adding an additional layer to a winning position is permitted.
    STRICT INVARIANT: Add-on only in established trend, only after MFE >= 1.0R,
    and only when current stop is already strictly in positive/fee-aware territory.
    """
    if not enable_pyramiding:
        return False, "PYRAMIDING_DISABLED_BY_FLAG"

    reg = str(regime or "").upper()
    if reg not in ("TREND_UP", "TREND_DOWN"):
        return False, "PYRAMID_ONLY_IN_TREND"

    side = str(position.get("side", "")).upper()
    if side == "LONG" and reg != "TREND_UP":
        return False, "REGIME_SIDE_MISMATCH"
    if side == "SHORT" and reg != "TREND_DOWN":
        return False, "REGIME_SIDE_MISMATCH"

    if mfe_r < 1.0:
        return False, f"MFE_BELOW_1R ({mfe_r:.2f} < 1.0R)"

    adds_done = int(position.get("adds_done", 0))
    if adds_done >= max_adds:
        return False, f"MAX_ADDS_REACHED ({adds_done}/{max_adds})"

    entry1 = float(position.get("avg_entry_price", position.get("entry", 0.0)))
    stop = float(position.get("stop_price", position.get("current_stop", 0.0)))

    if side == "LONG" and stop <= entry1:
        return False, "STOP_NOT_IN_PROFIT"
    if side == "SHORT" and stop >= entry1:
        return False, "STOP_NOT_IN_PROFIT"

    if not microstructure_ok:
        return False, "MICROSTRUCTURE_VETO_ON_ADD"

    return True, "OK"


def calc_pyramid_add_qty(
    equity: float,
    position: Dict[str, Any],
    add_entry: float,
    step_size: float = 0.001,
    min_notional: float = 5.0,
    max_chain_risk_pct: float = 0.005,  # 0.5% max risk for entire pyramid chain
) -> Optional[Dict[str, Any]]:
    """
    Calculates add-on quantity ensuring that if the unified stop is hit,
    the total net PnL across all legs remains >= 0 or strictly within initial risk budget.
    """
    side = str(position.get("side", "")).upper()
    entry1 = float(position.get("avg_entry_price", position.get("entry", 0.0)))
    qty1 = float(position.get("qty", 0.0))
    stop = float(position.get("stop_price", position.get("current_stop", 0.0)))

    if side == "LONG":
        existing_profit_per_unit = max(0.0, stop - entry1)
        add_risk_dist = add_entry - stop
    else:
        existing_profit_per_unit = max(0.0, entry1 - stop)
        add_risk_dist = stop - add_entry

    if existing_profit_per_unit <= 0.0 or add_risk_dist <= 0.0:
        return None

    # Condition: Loss_new <= Profit_existing
    qty_profit_neutral = qty1 * existing_profit_per_unit / add_risk_dist

    # Half the previous layer's risk budget
    prev_risk_usd = float(position.get("last_add_risk_usd", equity * 0.0035))
    qty_risk_budget = (prev_risk_usd * 0.5) / add_risk_dist

    # Maximum 50% of base quantity
    qty_half_cap = qty1 * 0.5

    qty_raw = min(qty_profit_neutral, qty_risk_budget, qty_half_cap)
    qty = floor_to_step(qty_raw, step_size)
    if qty <= 0:
        return None

    notional = qty * add_entry
    if notional < min_notional:
        return None

    total_qty = qty1 + qty
    avg_entry = (qty1 * entry1 + qty * add_entry) / total_qty

    return {
        "add_qty": qty,
        "add_entry": add_entry,
        "total_qty": total_qty,
        "avg_entry": avg_entry,
        "add_risk_usd": qty * add_risk_dist,
        "effective_leverage": (total_qty * add_entry) / equity,
    }
