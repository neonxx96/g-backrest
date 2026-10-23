"""
Realistic Execution Engine (MODULARIZATION_PLAN п.3, слайс 6.4).

Симуляция исполнения ордеров выносится из OrderFlowBacktester.run_backtest
ДОСЛОВНО (комиссии Maker/Taker, slippage ticks, Multi-TP scaling out, trailing,
динамические SL-режимы, time-stop, MFE/MAE, контекст-снапшоты — поведение 1:1).

Отличия от оригинала (семантически нейтральные):
- `self._estimate_tick_size(...)` -> модульная `_estimate_tick_size(...)`
  (staticmethod без состояния, тело скопировано дословно);
- входные данные приходят через namespace `bars` (массивы numpy) и `cfg`
  (скалярные параметры исполнения) — имена атрибутов совпадают с локальными
  именами оригинала, распаковка в преамбуле.

Возвращает SimpleNamespace: trades, equity_curve, capital, gross_capital,
total_fees_usd, total_slippage_usd.
"""
from types import SimpleNamespace
from typing import Any, Dict, List

import numpy as np


def _estimate_tick_size(price: float) -> float:
    """Estimates exchange price tick size and realistic impulse tick unit."""
    if price <= 0:
        return 0.01
    if price >= 10000:
        base_tick = 0.5
    elif price >= 1000:
        base_tick = 0.1
    elif price >= 10:
        base_tick = 0.01
    elif price >= 1:
        base_tick = 0.001
    else:
        base_tick = 0.0001
    # On impulse/liquidation cascades, 1 effective slippage tick is at least 1.5 bps (0.015%) of price
    return max(base_tick, price * 0.00015)


def simulate_execution(
    signals: np.ndarray,
    bars: SimpleNamespace,
    cfg: SimpleNamespace,
) -> SimpleNamespace:
    """Симуляция исполнения по сигналам. Тело — дословный перенос из run_backtest."""
    ts_vals = bars.ts_vals
    open_vals = bars.open_vals
    high_vals = bars.high_vals
    low_vals = bars.low_vals
    close_vals = bars.close_vals
    volume_vals = bars.volume_vals
    delta_vals = bars.delta_vals
    cvd_vals = bars.cvd_vals
    cvd_ema14_vals = bars.cvd_ema14_vals
    atr_vals = bars.atr_vals
    oi_delta_vals = bars.oi_delta_vals
    low_min10_vals = bars.low_min10_vals
    high_max10_vals = bars.high_max10_vals
    low_min6_vals = bars.low_min6_vals
    high_max6_vals = bars.high_max6_vals
    cvd_min6_vals = bars.cvd_min6_vals
    cvd_max6_vals = bars.cvd_max6_vals

    initial_capital = cfg.initial_capital
    maker_rate = cfg.maker_rate
    taker_rate = cfg.taker_rate
    slip_ticks = cfg.slip_ticks
    leverage = cfg.leverage
    use_multi_tp = cfg.use_multi_tp
    use_trailing = cfg.use_trailing
    use_atr_sl = cfg.use_atr_sl
    trailing_pct = cfg.trailing_pct
    use_dynamic_breakeven = cfg.use_dynamic_breakeven
    dynamic_be_trigger_r = cfg.dynamic_be_trigger_r
    use_time_stop = cfg.use_time_stop
    time_stop_minutes = cfg.time_stop_minutes
    time_stop_min_r = cfg.time_stop_min_r
    use_maker_exits = cfg.use_maker_exits
    sl_mode = cfg.sl_mode
    wall_sl_offset_ticks = cfg.wall_sl_offset_ticks
    atr_multiplier = cfg.atr_multiplier
    stop_loss_pct = cfg.stop_loss_pct
    take_profit_pct = cfg.take_profit_pct
    tp2_mode = cfg.tp2_mode
    tp1_rr_ratio = cfg.tp1_rr_ratio
    tp1_pct = cfg.tp1_pct
    tp1_atr_mult = cfg.tp1_atr_mult
    risk_per_trade_pct = cfg.risk_per_trade_pct
    fast_eval = cfg.fast_eval
    trades: List[Dict[str, Any]] = []
    capital = float(initial_capital)
    gross_capital = float(initial_capital)
    total_fees_usd = 0.0
    total_slippage_usd = 0.0

    equity_curve = [{"time": int(ts_vals[0]), "equity": round(capital, 2), "gross_equity": round(gross_capital, 2)}]

    in_pos = False
    pos_dir = 0
    entry_price = 0.0
    entry_time = None
    tp1_price = 0.0
    tp2_price = 0.0
    sl_price = 0.0
    trailing_sl = 0.0
    max_favorable = 0.0
    mfe_price = 0.0   # лучшая цена в сторону позиции за жизнь сделки (SRS M6.2b)
    mae_price = 0.0   # худшая цена против позиции
    initial_pos_size = 0.0
    remaining_fraction = 1.0
    tp1_filled = False
    dynamic_be_triggered = False
    entry_sl_dist = 0.0
    realized_leg1_gross_usd = 0.0
    realized_leg1_fee_usd = 0.0
    entry_fee_usd = 0.0
    entry_context_snapshot = None

    safe_lev = max(1.0, float(leverage))

    for i in range(len(ts_vals)):  # оригинал: range(len(data)) — все массивы bars из той же data, длина идентична
        cur_time = int(ts_vals[i])
        open_p = float(open_vals[i])
        high_p = float(high_vals[i])
        low_p = float(low_vals[i])
        close_p = float(close_vals[i])
        sig = int(signals[i])

        # 1. Check Active Position Exits (TP1 Scaling Out, Breakeven SL, TP2, or Stop Loss with Slippage Ticks)
        if in_pos and entry_price > 0:
            # MFE/MAE excursion tracking (per-bar extremes against entry)
            if pos_dir == 1:
                mfe_price = max(mfe_price, high_p)
                mae_price = min(mae_price, low_p) if mae_price > 0 else low_p
            else:
                mfe_price = min(mfe_price, low_p) if mfe_price > 0 else low_p
                mae_price = max(mae_price, high_p)

            tick_unit = _estimate_tick_size(entry_price)
            stop_slippage_abs = tick_unit * slip_ticks

            # Step 1A: Check TP1 (50% volume scaling out + move SL to Breakeven) if Multi-TP enabled
            if use_multi_tp and not tp1_filled:
                tp1_hit = (pos_dir == 1 and high_p >= tp1_price) or (pos_dir == -1 and low_p <= tp1_price)
                # Only trigger TP1 first if SL wasn't hit on open before TP1
                sl_hit_same_bar = (pos_dir == 1 and low_p <= sl_price) or (pos_dir == -1 and high_p >= sl_price)
                if tp1_hit and not sl_hit_same_bar:
                    leg1_size = initial_pos_size * 0.5
                    leg1_ret = ((tp1_price - entry_price) / entry_price) if pos_dir == 1 else ((entry_price - tp1_price) / entry_price)
                    realized_leg1_gross_usd = leg1_size * leg1_ret
                    # TP1 is a limit order -> Maker fee
                    realized_leg1_fee_usd = leg1_size * maker_rate
                    tp1_filled = True
                    remaining_fraction = 0.5
                    # Move Stop-Loss of remaining 50% to Breakeven (+ tiny fee offset)
                    be_offset = entry_price * maker_rate
                    sl_price = (entry_price + be_offset) if pos_dir == 1 else max(1e-8, entry_price - be_offset)
                    trailing_sl = sl_price

            # Step 1A2: Dynamic Breakeven (+0.5R MFE protection)
            if use_dynamic_breakeven and not dynamic_be_triggered and sl_dist > 0:
                fee_buffer = entry_price * (taker_rate * 2.0)
                if pos_dir == 1:
                    if (high_p - entry_price) >= dynamic_be_trigger_r * sl_dist:
                        dynamic_be_triggered = True
                        be_sl = entry_price + fee_buffer + tick_unit
                        if be_sl > sl_price:
                            sl_price = be_sl
                            trailing_sl = max(trailing_sl, sl_price)
                elif pos_dir == -1:
                    if (entry_price - low_p) >= dynamic_be_trigger_r * sl_dist:
                        dynamic_be_triggered = True
                        be_sl = entry_price - fee_buffer - tick_unit
                        if sl_price <= 0 or be_sl < sl_price:
                            sl_price = be_sl
                            trailing_sl = min(trailing_sl, sl_price)

            exit_price = None
            exit_reason = ""
            is_stop_exit = False

            # Step 1B: Trailing Stop update
            if use_trailing and trailing_sl > 0:
                if pos_dir == 1:
                    if high_p > max_favorable:
                        max_favorable = high_p
                        new_sl = max_favorable * (1.0 - (trailing_pct / 100.0))
                        if new_sl > trailing_sl:
                            trailing_sl = new_sl
                    if low_p <= trailing_sl:
                        # Fix 4 (STRATEGY_WEAKNESSES): with use_maker_exits the trailing
                        # exit is a resting limit order at the trail price (maker, no slippage).
                        exit_price = trailing_sl if use_maker_exits else max(1e-8, trailing_sl - stop_slippage_abs)
                        exit_reason = "Trailing Stop"
                        is_stop_exit = True
                elif pos_dir == -1:
                    if low_p < max_favorable:
                        max_favorable = low_p
                        new_sl = max_favorable * (1.0 + (trailing_pct / 100.0))
                        if new_sl < trailing_sl:
                            trailing_sl = new_sl
                    if high_p >= trailing_sl:
                        exit_price = trailing_sl if use_maker_exits else trailing_sl + stop_slippage_abs
                        exit_reason = "Trailing Stop"
                        is_stop_exit = True

            # Step 1C: Check Stop Loss / Breakeven Stop or Final TP2
            if exit_price is None:
                if pos_dir == 1:
                    if low_p <= sl_price:
                        exit_price = max(1e-8, sl_price - stop_slippage_abs)
                        exit_reason = "Dynamic Breakeven" if dynamic_be_triggered else ("TP1 + Breakeven" if tp1_filled else "Stop Loss")
                        is_stop_exit = True
                    elif high_p >= tp2_price:
                        exit_price = tp2_price
                        exit_reason = "TP1 + TP2 (Scaling Out)" if tp1_filled else "Take Profit"
                        is_stop_exit = False
                elif pos_dir == -1:
                    if high_p >= sl_price:
                        exit_price = sl_price + stop_slippage_abs
                        exit_reason = "Dynamic Breakeven" if dynamic_be_triggered else ("TP1 + Breakeven" if tp1_filled else "Stop Loss")
                        is_stop_exit = True
                    elif low_p <= tp2_price:
                        exit_price = tp2_price
                        exit_reason = "TP1 + TP2 (Scaling Out)" if tp1_filled else "Take Profit"
                        is_stop_exit = False

            # Step 1C2: Fix 3 (STRATEGY_WEAKNESSES) — time-stop: market exit when the
            # trade failed to reach +time_stop_min_r within time_stop_minutes.
            if exit_price is None and use_time_stop and entry_time is not None and entry_sl_dist > 0:
                elapsed_ms = int(cur_time) - int(entry_time)
                if elapsed_ms >= int(time_stop_minutes) * 60_000:
                    unrealized_r = (((close_p - entry_price) * pos_dir) / entry_sl_dist)
                    if unrealized_r < float(time_stop_min_r):
                        exit_price = close_p
                        exit_reason = "Time Stop"
                        is_stop_exit = True

            # Step 1D: Process Final Exit
            if exit_price is not None:
                rem_size = initial_pos_size * remaining_fraction
                maker_trailing_exit = is_stop_exit and use_maker_exits and exit_reason == "Trailing Stop"
                if is_stop_exit and not maker_trailing_exit:
                    # Reference un-slipped stop price to measure exact slippage cost;
                    # a Time Stop exits at the bar close, so its slippage is zero by construction.
                    ref_stop_p = (
                        trailing_sl if exit_reason == "Trailing Stop"
                        else exit_price if exit_reason == "Time Stop"
                        else sl_price
                    )
                    unslipped_ret = ((ref_stop_p - entry_price) / entry_price) if pos_dir == 1 else ((entry_price - ref_stop_p) / entry_price)
                    actual_ret = ((exit_price - entry_price) / entry_price) if pos_dir == 1 else ((entry_price - exit_price) / entry_price)
                    leg2_gross_usd = rem_size * unslipped_ret
                    slippage_cost_usd = max(0.0, rem_size * (unslipped_ret - actual_ret))
                    # Market Stop Loss / Time Stop pays Taker fee
                    leg2_fee_usd = rem_size * taker_rate
                else:
                    actual_ret = ((exit_price - entry_price) / entry_price) if pos_dir == 1 else ((entry_price - exit_price) / entry_price)
                    leg2_gross_usd = rem_size * actual_ret
                    slippage_cost_usd = 0.0
                    # Limit TP2 / maker trailing exit pays Maker fee
                    leg2_fee_usd = rem_size * maker_rate

                trade_gross_pnl_usd = realized_leg1_gross_usd + leg2_gross_usd
                trade_fee_usd = entry_fee_usd + realized_leg1_fee_usd + leg2_fee_usd
                trade_net_pnl_usd = trade_gross_pnl_usd - trade_fee_usd - slippage_cost_usd

                trade_net_pnl_pct = (trade_net_pnl_usd / max(1e-9, initial_pos_size / safe_lev)) * 100.0
                trade_gross_pnl_pct = (trade_gross_pnl_usd / max(1e-9, initial_pos_size / safe_lev)) * 100.0

                capital = max(100.0, capital + trade_net_pnl_usd)
                gross_capital = max(100.0, gross_capital + trade_gross_pnl_usd)
                total_fees_usd += trade_fee_usd
                total_slippage_usd += slippage_cost_usd

                trades.append({
                    "entry_time": entry_time,
                    "exit_time": cur_time,
                    "direction": "LONG" if pos_dir == 1 else "SHORT",
                    "entry_price": round(entry_price, 4),
                    "exit_price": round(exit_price, 4),
                    "gross_pnl_usd": round(trade_gross_pnl_usd, 2),
                    "gross_pnl_pct": round(trade_gross_pnl_pct, 2),
                    "fee_paid_usd": round(trade_fee_usd, 2),
                    "slippage_cost_usd": round(slippage_cost_usd, 2),
                    "pnl_usd": round(trade_net_pnl_usd, 2),
                    "pnl_pct": round(trade_net_pnl_pct, 2),
                    "mfe": round(((mfe_price - entry_price) / entry_price) * 100.0 * pos_dir, 2) if mfe_price > 0 else 0.0,
                    "mae": round(((mae_price - entry_price) / entry_price) * 100.0 * pos_dir, 2) if mae_price > 0 else 0.0,
                    "fee_drag_pct": round(((trade_fee_usd + slippage_cost_usd) / max(1e-9, initial_pos_size / safe_lev)) * 100.0, 2),
                    "tp1_hit": bool(tp1_filled),
                    "exit_reason": exit_reason,
                    "context_snapshot": entry_context_snapshot or {
                        "imbalance_ratio": 1.0,
                        "imbalance_group": "< 1.5x (Нейтральный)",
                        "poc_position": "На уровне POC",
                        "cvd_trend": "CVD > EMA",
                        "cvd_divergence": "Без дивергенции",
                        "oi_status": "Флэт OI",
                        "wall_type": "Без крупной стенки",
                        "turnover_usd": 0
                    }
                })
                in_pos = False
                entry_context_snapshot = None
                equity_curve.append({
                    "time": cur_time,
                    "equity": round(capital, 2),
                    "gross_equity": round(gross_capital, 2)
                })

        # 2. Check New Entry if flat
        if not in_pos and sig != 0 and close_p > 0:
            pos_dir = int(sig)
            entry_price = close_p
            entry_time = cur_time
            # Preserve legacy fixed-notional behavior unless an explicit
            # risk budget is supplied by the unified overnight config.
            initial_pos_size = capital * safe_lev
            remaining_fraction = 1.0
            tp1_filled = False
            dynamic_be_triggered = False
            mfe_price = entry_price
            mae_price = entry_price
            realized_leg1_gross_usd = 0.0
            realized_leg1_fee_usd = 0.0
            # Limit entry at liquidity density pays Maker fee (0.02% default)
            entry_fee_usd = initial_pos_size * maker_rate

            # Capture cluster and indicator context snapshot (skipped in fast_eval mode)
            if not fast_eval:
                vol_i = float(volume_vals[i]) if not np.isnan(volume_vals[i]) else 1.0
                delta_i = float(delta_vals[i]) if not np.isnan(delta_vals[i]) else 0.0
                buy_vol = max(0.0, (vol_i + delta_i) / 2.0)
                sell_vol = max(1e-9, vol_i - buy_vol)
                imb_ratio = (buy_vol / sell_vol) if pos_dir == 1 else (sell_vol / max(1e-9, buy_vol))

                if imb_ratio >= 3.0:
                    imb_group = "> 3:1 (Сильный дисбаланс)"
                elif imb_ratio >= 1.5:
                    imb_group = "1.5x - 3.0x (Умеренный)"
                else:
                    imb_group = "< 1.5x (Нейтральный)"

                prev_idx = max(0, i - 1)
                prev_poc = (
                    float(open_vals[prev_idx])
                    + 2.0 * float(close_vals[prev_idx])
                    + float(high_vals[prev_idx])
                    + float(low_vals[prev_idx])
                ) / 5.0
                if entry_price > prev_poc * 1.0006:
                    poc_pos = "Выше POC"
                elif entry_price < prev_poc * 0.9994:
                    poc_pos = "Ниже POC"
                else:
                    poc_pos = "На уровне POC"

                cur_cvd = float(cvd_vals[i]) if not np.isnan(cvd_vals[i]) else 0.0
                cur_cvd_ema = float(cvd_ema14_vals[i]) if not np.isnan(cvd_ema14_vals[i]) else 0.0
                cvd_trend = "CVD > EMA" if cur_cvd >= cur_cvd_ema else "CVD <= EMA"

                if i >= 2:
                    min_p = float(low_min6_vals[i])
                    max_p = float(high_max6_vals[i])
                    min_c = float(cvd_min6_vals[i])
                    max_c = float(cvd_max6_vals[i])
                    if pos_dir == 1 and low_p <= min_p and cur_cvd > min_c:
                        cvd_div = "Бычья дивергенция"
                    elif pos_dir == -1 and high_p >= max_p and cur_cvd < max_c:
                        cvd_div = "Медвежья дивергенция"
                    else:
                        cvd_div = "Без дивергенции"
                else:
                    cvd_div = "Без дивергенции"

                cur_oi_d = float(oi_delta_vals[i]) if np.isfinite(oi_delta_vals[i]) else None
                if cur_oi_d is None:
                    oi_status = "Unavailable"
                elif cur_oi_d > 0.5:
                    oi_status = "Набор OI (Expansion)"
                elif cur_oi_d is not None and cur_oi_d < -0.5:
                    oi_status = "Сброс OI (Flush)"
                else:
                    oi_status = "Флэт OI"

                turnover_bar = close_p * vol_i
                if turnover_bar >= 1_000_000:
                    wall_type = "Стенка > $1M"
                elif turnover_bar >= 400_000:
                    wall_type = "Стенка $400k-$1M"
                else:
                    wall_type = "Без крупной стенки"

                entry_context_snapshot = {
                    "imbalance_ratio": round(float(imb_ratio), 2),
                    "imbalance_group": imb_group,
                    "poc_position": poc_pos,
                    "cvd_trend": cvd_trend,
                    "cvd_divergence": cvd_div,
                    "oi_status": oi_status,
                    "wall_type": wall_type,
                    "turnover_usd": round(float(turnover_bar), 0)
                }

            cur_atr = float(atr_vals[i]) if not np.isnan(atr_vals[i]) else 0.0
            tick_unit_entry = _estimate_tick_size(entry_price)

            # Dynamic Stop-Loss Mode: 'fixed_pct' | 'behind_wall' | 'atr_volatility'
            if (sl_mode == "atr_volatility" or use_atr_sl) and cur_atr > 0 and entry_price > 0:
                sl_dist = cur_atr * max(0.5, min(5.0, float(atr_multiplier)))
            elif sl_mode == "behind_wall" and entry_price > 0:
                offset_abs = max(1, int(wall_sl_offset_ticks or 3)) * tick_unit_entry
                if pos_dir == 1:
                    wall_anchor = min(low_p, float(low_min6_vals[i]))
                    sl_dist = max(entry_price * 0.0015, (entry_price - wall_anchor) + offset_abs)
                else:
                    wall_anchor = max(high_p, float(high_max6_vals[i]))
                    sl_dist = max(entry_price * 0.0015, (wall_anchor - entry_price) + offset_abs)
                sl_dist = min(sl_dist, entry_price * 0.025)
            else:
                sl_dist = entry_price * (max(0.05, float(stop_loss_pct)) / 100.0)

            if risk_per_trade_pct is not None:
                risk_budget = capital * (float(risk_per_trade_pct) / 100.0)
                # `initial_pos_size` is quote-currency notional throughout
                # the execution engine. Convert the absolute stop distance
                # to a price fraction before sizing; dividing by the raw
                # price distance would size in base units and make PnL
                # artificially tiny for high-priced instruments.
                stop_fraction = max(sl_dist / max(entry_price, 1e-9), 1e-9)
                initial_pos_size = min(
                    capital * safe_lev,
                    risk_budget / stop_fraction,
                )
                entry_fee_usd = initial_pos_size * maker_rate

            # TP2 distance: either explicit take_profit_pct or opposite_wall / R:R target
            base_tp2_dist = entry_price * (max(0.1, float(take_profit_pct)) / 100.0)
            if tp2_mode == "opposite_wall" and i >= 6:
                opp_wall = float(high_max10_vals[i]) if pos_dir == 1 else float(low_min10_vals[i])
                wall_dist = abs(opp_wall - entry_price) * 0.96
                tp2_dist = max(sl_dist * 1.6, wall_dist if wall_dist > sl_dist * 1.2 else base_tp2_dist)
            else:
                tp2_dist = base_tp2_dist

            # TP1 distance: R:R based (e.g. 1:1.5) or +0.6% / 1.5 ATR, capped at 70% of TP2
            rr_tp1_dist = sl_dist * max(0.8, float(tp1_rr_ratio or 1.5))
            atr_tp1_dist = (cur_atr * float(tp1_atr_mult)) if cur_atr > 0 else (entry_price * (float(tp1_pct) / 100.0))
            pct_tp1_dist = entry_price * (max(0.15, float(tp1_pct)) / 100.0)
            tp1_dist = min(tp2_dist * 0.70, max(pct_tp1_dist, min(rr_tp1_dist, max(pct_tp1_dist, atr_tp1_dist))))

            if pos_dir == 1:
                tp1_price = entry_price + tp1_dist
                tp2_price = entry_price + tp2_dist
                sl_price = max(1e-8, entry_price - sl_dist)
                trailing_sl = sl_price
                max_favorable = entry_price
            else:
                tp1_price = max(1e-8, entry_price - tp1_dist)
                tp2_price = max(1e-8, entry_price - tp2_dist)
                sl_price = entry_price + sl_dist
                trailing_sl = sl_price
                max_favorable = entry_price

            entry_sl_dist = sl_dist
            in_pos = True

    return SimpleNamespace(
        trades=trades,
        equity_curve=equity_curve,
        capital=capital,
        gross_capital=gross_capital,
        total_fees_usd=total_fees_usd,
        total_slippage_usd=total_slippage_usd,
    )
