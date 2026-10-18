"""
Deterministic Single-Limit-Order Fill Simulator ("Here & Now Backtest").

Quant constraints (hard invariants):
1. Zero look-ahead bias:
   - Only bars with open_time (timestamp, ms UTC) STRICTLY GREATER than created_at_ts are simulated.
   - Decision is assumed to be made before the open of the next bar.
2. Limit entry:
   - BUY  fills when bar.low  <= entry_price, fill price = entry_price (maker).
   - SELL fills when bar.high >= entry_price, fill price = entry_price (maker).
3. Exits:
   - TP hit  -> limit order, fill at tp_price, maker fee, no slippage.
     BUY: high >= tp | SELL: low <= tp
   - SL hit  -> market order, fill at sl_price, taker fee, adverse slippage.
     BUY: low <= sl | SELL: high >= sl
   - Tie-break (TP and SL touched in the SAME bar): conservative -> SL first (worst case),
     unless bar.open is already beyond one of the levels (gap handling).
4. Determinism:
   - Pure function, no randomness, no wall clock, no network.
"""

from dataclasses import dataclass
from typing import Optional, Any
import pandas as pd

EXIT_TP = "tp"
EXIT_SL = "sl"
EXIT_OPEN = "open"
EXIT_NO_FILL = "no_fill"


@dataclass(frozen=True)
class LimitSetupParams:
    """Immutable simulation input (mirrors the API request payload)."""
    symbol: str
    side: str            # "BUY" | "SELL"
    entry_price: float
    sl_price: float
    tp_price: float
    size: float          # base asset quantity
    created_at_ts: int   # UTC ms
    max_bars: int        # simulation window in bars
    maker_fee_pct: float = 0.02
    taker_fee_pct: float = 0.05
    slippage_ticks: float = 1.0
    tick_size: float = 0.01


@dataclass(frozen=True)
class LimitSetupResult:
    """Immutable simulation output."""
    filled: bool
    entry_price: float
    entry_bar_ts: Optional[int]
    exit_price: Optional[float]
    exit_bar_ts: Optional[int]
    exit_reason: str     # "tp" | "sl" | "open" | "no_fill"
    bars_held: int
    gross_pnl: float
    fees_paid: float
    slippage_cost: float
    net_pnl: float
    net_pnl_r: float


def _row_val(row: Any, col: str) -> float:
    """Extracts a float value from a pandas Series row safely."""
    v = row[col]
    if v is None or pd.isna(v):
        return 0.0
    return float(v)


def _row_ts(row: Any) -> int:
    """Extracts bar open timestamp (UTC ms) from a pandas row."""
    return int(row["timestamp"])


def simulate_limit_setup(df: pd.DataFrame, params: LimitSetupParams) -> LimitSetupResult:
    """
    Simulates a single limit order setup against historical 1m bars.

    df must contain columns: timestamp (int ms), open, high, low, close (floats).
    Bars with timestamp <= params.created_at_ts are strictly ignored (anti look-ahead).
    """
    is_long = params.side.upper() == "BUY"

    # --- 1. Anti look-ahead filter -------------------------------------------
    bars = df[df["timestamp"] > params.created_at_ts]
    bars = bars.head(params.max_bars)

    maker_rate = max(0.0, float(params.maker_fee_pct)) / 100.0
    taker_rate = max(0.0, float(params.taker_fee_pct)) / 100.0
    slippage = max(0.0, float(params.slippage_ticks)) * float(params.tick_size)

    filled = False
    entry_price = 0.0
    entry_ts: Optional[int] = None
    exit_price: Optional[float] = None
    exit_ts: Optional[int] = None
    exit_reason = EXIT_NO_FILL
    bars_held = 0

    last_close = 0.0
    last_ts: Optional[int] = None

    for _, row in bars.iterrows():
        bar_open = _row_val(row, "open")
        bar_high = _row_val(row, "high")
        bar_low = _row_val(row, "low")
        bar_close = _row_val(row, "close")
        bar_ts = _row_ts(row)
        last_close = bar_close
        last_ts = bar_ts

        # --- 2. Entry --------------------------------------------------------
        if not filled:
            if is_long:
                if bar_low <= params.entry_price:
                    filled = True
                    entry_price = params.entry_price
                    entry_ts = bar_ts
            else:
                if bar_high >= params.entry_price:
                    filled = True
                    entry_price = params.entry_price
                    entry_ts = bar_ts

            if not filled:
                continue

            # Entry and exit can happen in the SAME bar.
            hit_sl = (bar_low <= params.sl_price) if is_long else (bar_high >= params.sl_price)
            hit_tp = (bar_high >= params.tp_price) if is_long else (bar_low <= params.tp_price)

            if hit_sl and hit_tp:
                # --- Tie-break: conservative SL first, unless gap puts open beyond a level
                if is_long:
                    if bar_open <= params.sl_price:
                        # Gapped below SL before entry -> immediate stop at open
                        exit_reason = EXIT_SL
                        exit_price = min(bar_open, params.sl_price)
                    elif bar_open >= params.tp_price:
                        # Price opened above TP and dropped to entry (fill).
                        # TP was crossed BEFORE entry, so at fill time TP is already behind us.
                        # Since low <= SL, the trade necessarily hits SL.
                        exit_reason = EXIT_SL
                        exit_price = params.sl_price
                    else:
                        # Both touched inside the bar -> conservative SL first
                        exit_reason = EXIT_SL
                        exit_price = params.sl_price
                else:
                    if bar_open >= params.sl_price:
                        # Gapped above SL before entry -> immediate stop at open
                        exit_reason = EXIT_SL
                        exit_price = max(bar_open, params.sl_price)
                    elif bar_open <= params.tp_price:
                        # Price opened below TP and rose to entry (fill).
                        # TP was crossed BEFORE entry (for a short, TP is below entry).
                        # Since high >= SL, the trade necessarily hits SL.
                        exit_reason = EXIT_SL
                        exit_price = params.sl_price
                    else:
                        # Both touched inside the bar -> conservative SL first
                        exit_reason = EXIT_SL
                        exit_price = params.sl_price
            elif hit_sl:
                exit_reason = EXIT_SL
                if is_long and bar_open < params.sl_price:
                    exit_price = bar_open          # gapped below SL -> fill at open
                elif (not is_long) and bar_open > params.sl_price:
                    exit_price = bar_open          # gapped above SL -> fill at open
                else:
                    exit_price = params.sl_price
            elif hit_tp:
                exit_reason = EXIT_TP
                if is_long and bar_open > params.tp_price:
                    exit_price = bar_open          # gapped above TP -> fill at open
                elif (not is_long) and bar_open < params.tp_price:
                    exit_price = bar_open          # gapped below TP -> fill at open
                else:
                    exit_price = params.tp_price
            else:
                bars_held = 1
                continue

            exit_ts = bar_ts
            break

        # --- 3. Subsequent bars: exit checks ----------------------------------
        bars_held += 1
        hit_sl = (bar_low <= params.sl_price) if is_long else (bar_high >= params.sl_price)
        hit_tp = (bar_high >= params.tp_price) if is_long else (bar_low <= params.tp_price)

        if hit_sl and hit_tp:
            # Tie-break: conservative SL first, gap-aware
            if is_long:
                if bar_open <= params.sl_price:
                    exit_price = min(bar_open, params.sl_price)
                else:
                    exit_price = params.sl_price
            else:
                if bar_open >= params.sl_price:
                    exit_price = max(bar_open, params.sl_price)
                else:
                    exit_price = params.sl_price
            exit_reason = EXIT_SL
        elif hit_sl:
            exit_reason = EXIT_SL
            if is_long and bar_open < params.sl_price:
                exit_price = bar_open
            elif (not is_long) and bar_open > params.sl_price:
                exit_price = bar_open
            else:
                exit_price = params.sl_price
        elif hit_tp:
            exit_reason = EXIT_TP
            if is_long and bar_open > params.tp_price:
                exit_price = bar_open
            elif (not is_long) and bar_open < params.tp_price:
                exit_price = bar_open
            else:
                exit_price = params.tp_price
        else:
            continue

        exit_ts = bar_ts
        break

    # --- 4. No fill ------------------------------------------------------------
    if not filled:
        return LimitSetupResult(
            filled=False,
            entry_price=0.0,
            entry_bar_ts=None,
            exit_price=None,
            exit_bar_ts=None,
            exit_reason=EXIT_NO_FILL,
            bars_held=0,
            gross_pnl=0.0,
            fees_paid=0.0,
            slippage_cost=0.0,
            net_pnl=0.0,
            net_pnl_r=0.0,
        )

    # --- 5. Time-out exit --------------------------------------------------------
    if exit_ts is None:
        exit_reason = EXIT_OPEN
        exit_price = last_close
        exit_ts = last_ts

    # --- 6. Fees & PnL -----------------------------------------------------------
    fee_entry = entry_price * params.size * maker_rate
    if exit_reason == EXIT_TP:
        fee_exit_rate = maker_rate
        slippage_cost = 0.0
    elif exit_reason == EXIT_SL:
        fee_exit_rate = taker_rate
        slippage_cost = slippage * params.size
    else:  # EXIT_OPEN
        fee_exit_rate = taker_rate
        slippage_cost = 0.0
    fee_exit = (exit_price or 0.0) * params.size * fee_exit_rate

    if is_long:
        gross_pnl = ((exit_price or 0.0) - entry_price) * params.size
    else:
        gross_pnl = (entry_price - (exit_price or 0.0)) * params.size

    net_pnl = gross_pnl - fee_entry - fee_exit - slippage_cost

    risk = abs(params.entry_price - params.sl_price)
    net_pnl_r = (net_pnl / risk) if risk > 0 else 0.0

    return LimitSetupResult(
        filled=True,
        entry_price=entry_price,
        entry_bar_ts=entry_ts,
        exit_price=exit_price,
        exit_bar_ts=exit_ts,
        exit_reason=exit_reason,
        bars_held=bars_held,
        gross_pnl=round(gross_pnl, 8),
        fees_paid=round(fee_entry + fee_exit, 8),
        slippage_cost=round(slippage_cost, 8),
        net_pnl=round(net_pnl, 8),
        net_pnl_r=round(net_pnl_r, 8),
    )


