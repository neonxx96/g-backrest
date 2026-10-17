"""
Order Flow & Quant Strategy Backtester
Implements:
1. Liquidity Wall / Order Book Density Bounce
2. Delta Absorption & CVD Divergence
3. Multi-Timeframe Confluence (EMA20 + Volume Spike + RSI)
"""

import math
from typing import Dict, List, Any, Optional
import pandas as pd
import numpy as np

class OrderFlowBacktester:
    def __init__(
        self,
        initial_capital: float = 10000.0,
        fee_pct: float = 0.05,        # 0.05% taker fee
        slippage_pct: float = 0.02,   # 0.02% estimated slippage
    ):
        self.initial_capital = initial_capital
        self.fee_pct = fee_pct / 100.0
        self.slippage_pct = slippage_pct / 100.0

    def calculate_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Enriches dataframe with EMA, RSI, Volume MA, Delta and CVD."""
        data = df.copy()
        
        # EMA 20 / EMA 50
        data['ema20'] = data['close'].ewm(span=20, adjust=False).mean()
        data['ema50'] = data['close'].ewm(span=50, adjust=False).mean()

        # Volume MA 20 & Volume Ratio
        data['vol_ma20'] = data['volume'].rolling(window=20).mean()
        data['vol_ratio'] = data['volume'] / data['vol_ma20'].replace(0, np.nan)

        # Delta & CVD & CVD EMA 14
        if 'delta' not in data.columns and 'taker_buy_volume' in data.columns:
            data['delta'] = (2.0 * data['taker_buy_volume']) - data['volume']
        elif 'delta' not in data.columns and 'taker_buy_base_volume' in data.columns:
            data['delta'] = (2.0 * data['taker_buy_base_volume']) - data['volume']
        elif 'delta' not in data.columns:
            # Synthetic delta based on candle body & volume
            body = data['close'] - data['open']
            rng = data['high'] - data['low'].replace(0, np.nan)
            data['delta'] = (body / rng).fillna(0) * data['volume']

        data['cvd'] = data['delta'].cumsum()
        data['cvd_ema14'] = data['cvd'].ewm(span=14, adjust=False).mean()

        # Open Interest (real or synthetic)
        if 'oi' in data.columns:
            data['oi_delta'] = data['oi'].diff().fillna(0)
        elif 'open_interest' in data.columns:
            data['oi'] = data['open_interest']
            data['oi_delta'] = data['oi'].diff().fillna(0)
        else:
            # Synthetic OI tracking aggressive flow accumulation vs liquidation/exhaustion
            data['oi'] = (data['delta'].abs() * 0.5 + data['volume'] * 0.1).cumsum()
            data['oi_delta'] = data['oi'].diff().fillna(0)

        # RSI 14
        delta_p = data['close'].diff()
        gain = delta_p.clip(lower=0)
        loss = -delta_p.clip(upper=0)
        avg_gain = gain.ewm(alpha=1/14, min_periods=14, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1/14, min_periods=14, adjust=False).mean()
        rs = avg_gain / avg_loss.replace(0, np.nan)
        data['rsi'] = 100 - (100 / (1 + rs))

        # ATR 14 & ATR EMA 20
        h_l = data['high'] - data['low']
        h_pc = (data['high'] - data['close'].shift(1)).abs()
        l_pc = (data['low'] - data['close'].shift(1)).abs()
        tr = pd.concat([h_l, h_pc, l_pc], axis=1).max(axis=1)
        data['atr'] = tr.ewm(alpha=1/14, min_periods=14, adjust=False).mean()
        data['atr_ema20'] = data['atr'].ewm(span=20, adjust=False).mean()

        return data

    def run_backtest(
        self,
        df: pd.DataFrame,
        strategy_type: str = "confluence_ema",
        take_profit_pct: float = 1.5,
        stop_loss_pct: float = 0.8,
        use_trailing: bool = True,
        trailing_pct: float = 0.5,
        leverage: float = 1.0,
        density_threshold_usd: float = 100000.0,
        volume_multiplier: float = 1.3,
        min_density_usd: float = 0.0,
        # Confluence Filter Suite
        use_atr_filter: bool = False,
        use_atr_sl: bool = False,
        atr_multiplier: float = 1.5,
        use_cvd_filter: bool = False,
        use_oi_filter: bool = False,
        use_rsi_filter: bool = False,
    ) -> Dict[str, Any]:
        """
        Executes backtest on dataframe for chosen order flow strategy.
        Returns full statistics, equity curve, and trade log.

        NOTE: only OHLCV + taker-buy delta are available historically, so
        `min_density_usd` is applied as a proxy: minimal USD turnover
        (close * volume) of the rejection candle ("wall was real and traded").
        """
        if df.empty or len(df) < 60:
            return {"error": "Недостаточно свечей для бэктеста (минимум 60)"}

        data = df if ('ema50' in df.columns and 'atr_ema20' in df.columns and 'cvd_ema14' in df.columns) else self.calculate_indicators(df)
        
        # Generate Signals based on strategy type
        # 1: Long, -1: Short, 0: Neutral
        signals = np.zeros(len(data))

        ts_vals = data['timestamp'].values
        close_vals = data['close'].values
        open_vals = data['open'].values
        high_vals = data['high'].values
        low_vals = data['low'].values
        ema20_vals = data['ema20'].values
        ema50_vals = data['ema50'].values
        vol_ratio_vals = data['vol_ratio'].values
        volume_vals = data['volume'].values
        rsi_vals = data['rsi'].values
        delta_vals = data['delta'].values
        cvd_vals = data['cvd'].values
        cvd_ema14_vals = data['cvd_ema14'].values
        atr_vals = data['atr'].values
        atr_ema20_vals = data['atr_ema20'].values
        oi_delta_vals = data['oi_delta'].values

        for i in range(50, len(data)):
            c = close_vals[i]
            prev_c = close_vals[i-1]
            ema = ema20_vals[i]
            prev_ema = ema20_vals[i-1]
            v_rat = vol_ratio_vals[i] if not np.isnan(vol_ratio_vals[i]) else 1.0
            rsi = rsi_vals[i] if not np.isnan(rsi_vals[i]) else 50.0
            delta = delta_vals[i]

            turnover = c * volume_vals[i]
            passes_wall = (min_density_usd <= 0) or (turnover >= min_density_usd)

            raw_signal = 0

            if strategy_type == "confluence_ema":
                # EMA(20) Bounce/Cross + Volume Spike + Delta Confirmation
                if passes_wall and prev_c <= prev_ema and c > ema and v_rat >= volume_multiplier and delta > 0 and 40 <= rsi <= 65:
                    raw_signal = 1
                elif passes_wall and prev_c >= prev_ema and c < ema and v_rat >= volume_multiplier and delta < 0 and 35 <= rsi <= 60:
                    raw_signal = -1

            elif strategy_type == "ema_trend":
                # EMA20 crosses EMA50 in direction of delta with volume confirmation
                cross_up = ema20_vals[i-1] <= ema50_vals[i-1] and ema20_vals[i] > ema50_vals[i]
                cross_dn = ema20_vals[i-1] >= ema50_vals[i-1] and ema20_vals[i] < ema50_vals[i]
                if passes_wall and cross_up and v_rat >= volume_multiplier and delta > 0:
                    raw_signal = 1
                elif passes_wall and cross_dn and v_rat >= volume_multiplier and delta < 0:
                    raw_signal = -1

            elif strategy_type == "delta_absorption":
                # Delta Absorption: Local extreme with CVD divergence
                local_min_price = min(low_vals[i-10:i])
                local_min_cvd = min(cvd_vals[i-10:i])
                if passes_wall and low_vals[i] <= local_min_price and cvd_vals[i] > local_min_cvd and delta > 0 and rsi < 40 and v_rat >= volume_multiplier:
                    raw_signal = 1
                local_max_price = max(high_vals[i-10:i])
                local_max_cvd = max(cvd_vals[i-10:i])
                if passes_wall and high_vals[i] >= local_max_price and cvd_vals[i] < local_max_cvd and delta < 0 and rsi > 60 and v_rat >= volume_multiplier:
                    raw_signal = -1

            elif strategy_type == "density_bounce":
                # Liquidity bounce proxy: pin-bar rejection with delta confirmation on big turnover
                if passes_wall:
                    is_pinbar_bull = (c - low_vals[i]) > 2 * (high_vals[i] - c) and delta > 0
                    is_pinbar_bear = (high_vals[i] - c) > 2 * (c - low_vals[i]) and delta < 0
                    if is_pinbar_bull and v_rat >= volume_multiplier and rsi < 40:
                        raw_signal = 1
                    elif is_pinbar_bear and v_rat >= volume_multiplier and rsi > 60:
                        raw_signal = -1

            # CONFLUENCE FILTER SUITE VALIDATION
            if raw_signal != 0:
                cur_atr = atr_vals[i] if not np.isnan(atr_vals[i]) else 0.0
                cur_atr_ema = atr_ema20_vals[i] if not np.isnan(atr_ema20_vals[i]) else 0.0
                cur_cvd = cvd_vals[i]
                cur_cvd_ema = cvd_ema14_vals[i]
                cur_oi_delta = oi_delta_vals[i] if not np.isnan(oi_delta_vals[i]) else 0.0

                allowed = True

                # 1. ATR Volatility Spike Filter:
                # Block entry if current ATR > 2 * EMA(ATR, 20) (impulsive spike / abnormal spread)
                if use_atr_filter and cur_atr_ema > 0:
                    if cur_atr > 2.0 * cur_atr_ema:
                        allowed = False

                # 2. Cumulative Delta (CVD) Absorption / Trend Confirmation:
                # LONG: candle delta > 0 AND (CVD > EMA(CVD, 14) or bullish delta divergence)
                # SHORT: candle delta < 0 AND (CVD < EMA(CVD, 14) or bearish delta divergence)
                if allowed and use_cvd_filter:
                    if raw_signal == 1:
                        prev_min_p = min(low_vals[max(0, i-6):i])
                        prev_min_cvd = min(cvd_vals[max(0, i-6):i])
                        bull_div = (low_vals[i] <= prev_min_p and cur_cvd > prev_min_cvd) or (c < prev_c and cur_cvd > cvd_vals[i-1])
                        if not (delta > 0 and (cur_cvd >= cur_cvd_ema or bull_div)):
                            allowed = False
                    elif raw_signal == -1:
                        prev_max_p = max(high_vals[max(0, i-6):i])
                        prev_max_cvd = max(cvd_vals[max(0, i-6):i])
                        bear_div = (high_vals[i] >= prev_max_p and cur_cvd < prev_max_cvd) or (c > prev_c and cur_cvd < cvd_vals[i-1])
                        if not (delta < 0 and (cur_cvd <= cur_cvd_ema or bear_div)):
                            allowed = False

                # 3. Open Interest (OI) Filter:
                # Entry allowed only if OI is growing or stable (delta_OI >= 0)
                if allowed and use_oi_filter:
                    if cur_oi_delta < 0:
                        allowed = False

                # 4. RSI Extremum Filter:
                # LONG: RSI < 40 or recovering from oversold (rsi_prev < 35 and rsi >= 30)
                # SHORT: RSI > 60 or falling from overbought (rsi_prev > 65 and rsi <= 70)
                if allowed and use_rsi_filter:
                    prev_rsi = rsi_vals[i-1] if not np.isnan(rsi_vals[i-1]) else 50.0
                    if raw_signal == 1:
                        if not (rsi <= 40 or (prev_rsi <= 35 and rsi >= 30)):
                            allowed = False
                    elif raw_signal == -1:
                        if not (rsi >= 60 or (prev_rsi >= 65 and rsi <= 70)):
                            allowed = False

                if allowed:
                    signals[i] = raw_signal


        # Simulate Execution
        trades = []
        capital = self.initial_capital
        equity_curve = [{"time": int(ts_vals[0]), "equity": capital}]
        
        in_pos = False
        pos_dir = 0
        entry_price = 0.0
        entry_time = None
        tp_price = 0.0
        sl_price = 0.0
        trailing_sl = 0.0
        max_favorable = 0.0
        pos_size = 0.0
        entry_context_snapshot = None

        for i in range(len(data)):
            cur_time = int(ts_vals[i])
            open_p = float(open_vals[i])
            high_p = float(high_vals[i])
            low_p = float(low_vals[i])
            close_p = float(close_vals[i])
            sig = signals[i]

            # 1. Check Exit if in position
            if in_pos:
                exit_price = None
                exit_reason = ""

                # Trailing stop update
                if use_trailing and trailing_sl > 0:
                    if pos_dir == 1:
                        if high_p > max_favorable:
                            max_favorable = high_p
                            new_sl = max_favorable * (1.0 - (trailing_pct / 100.0))
                            if new_sl > trailing_sl:
                                trailing_sl = new_sl
                        if low_p <= trailing_sl:
                            exit_price = trailing_sl * (1.0 - self.slippage_pct)
                            exit_reason = "Trailing Stop"
                    elif pos_dir == -1:
                        if low_p < max_favorable:
                            max_favorable = low_p
                            new_sl = max_favorable * (1.0 + (trailing_pct / 100.0))
                            if new_sl < trailing_sl:
                                trailing_sl = new_sl
                        if high_p >= trailing_sl:
                            exit_price = trailing_sl * (1.0 + self.slippage_pct)
                            exit_reason = "Trailing Stop"

                # Check fixed TP & SL if not exited by trailing
                if exit_price is None:
                    if pos_dir == 1:
                        if low_p <= sl_price:
                            exit_price = sl_price * (1.0 - self.slippage_pct)
                            exit_reason = "Stop Loss"
                        elif high_p >= tp_price:
                            exit_price = tp_price * (1.0 - self.slippage_pct)
                            exit_reason = "Take Profit"
                    elif pos_dir == -1:
                        if high_p >= sl_price:
                            exit_price = sl_price * (1.0 + self.slippage_pct)
                            exit_reason = "Stop Loss"
                        elif low_p <= tp_price:
                            exit_price = tp_price * (1.0 + self.slippage_pct)
                            exit_reason = "Take Profit"

                # Process Exit
                if exit_price is not None:
                    pnl_pct = ((exit_price - entry_price) / entry_price) if pos_dir == 1 else ((entry_price - exit_price) / entry_price)
                    pnl_usd = (pos_size * pnl_pct) - (pos_size * self.fee_pct * 2)
                    capital += pnl_usd
                    trades.append({
                        "entry_time": entry_time,
                        "exit_time": cur_time,
                        "direction": "LONG" if pos_dir == 1 else "SHORT",
                        "entry_price": round(entry_price, 4),
                        "exit_price": round(exit_price, 4),
                        "pnl_usd": round(pnl_usd, 2),
                        "pnl_pct": round(pnl_pct * 100.0 * leverage, 2),
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
                    equity_curve.append({"time": cur_time, "equity": round(capital, 2)})

            # 2. Check Entry if flat
            if not in_pos and sig != 0:
                pos_dir = int(sig)
                entry_price = close_p * (1.0 + (self.slippage_pct if pos_dir == 1 else -self.slippage_pct))
                entry_time = cur_time
                pos_size = capital * leverage

                # Capture cluster and indicator context snapshot
                vol_i = float(volume_vals[i]) if not np.isnan(volume_vals[i]) else 1.0
                delta_i = float(delta_vals[i]) if not np.isnan(delta_vals[i]) else 0.0
                buy_vol = max(0.0, (vol_i + delta_i) / 2.0)
                sell_vol = max(1e-9, vol_i - buy_vol)
                if pos_dir == 1:
                    imb_ratio = buy_vol / sell_vol
                else:
                    imb_ratio = sell_vol / buy_vol

                if imb_ratio >= 3.0:
                    imb_group = "> 3:1 (Сильный дисбаланс)"
                elif imb_ratio >= 1.5:
                    imb_group = "1.5x - 3.0x (Умеренный)"
                else:
                    imb_group = "< 1.5x (Нейтральный)"

                # POC of previous candle: (O + 2*C + H + L) / 5
                prev_idx = max(0, i - 1)
                prev_poc = (float(open_vals[prev_idx]) + 2.0 * float(close_vals[prev_idx]) + float(high_vals[prev_idx]) + float(low_vals[prev_idx])) / 5.0
                if entry_price > prev_poc * 1.0006:
                    poc_pos = "Выше POC"
                elif entry_price < prev_poc * 0.9994:
                    poc_pos = "Ниже POC"
                else:
                    poc_pos = "На уровне POC"

                # CVD and EMA(14)
                cur_cvd = float(cvd_vals[i]) if not np.isnan(cvd_vals[i]) else 0.0
                cur_cvd_ema = float(cvd_ema14_vals[i]) if not np.isnan(cvd_ema14_vals[i]) else 0.0
                cvd_trend = "CVD > EMA" if cur_cvd >= cur_cvd_ema else "CVD <= EMA"

                # CVD Divergence (last 6 candles)
                lookback = min(6, i)
                if lookback >= 2:
                    min_p = min(low_vals[i-lookback:i])
                    max_p = max(high_vals[i-lookback:i])
                    min_c = min(cvd_vals[i-lookback:i])
                    max_c = max(cvd_vals[i-lookback:i])
                    if pos_dir == 1 and low_p <= min_p and cur_cvd > min_c:
                        cvd_div = "Бычья дивергенция"
                    elif pos_dir == -1 and high_p >= max_p and cur_cvd < max_c:
                        cvd_div = "Медвежья дивергенция"
                    else:
                        cvd_div = "Без дивергенции"
                else:
                    cvd_div = "Без дивергенции"

                # Open Interest
                cur_oi_d = float(oi_delta_vals[i]) if not np.isnan(oi_delta_vals[i]) else 0.0
                if cur_oi_d > 0.5:
                    oi_status = "Набор OI (Expansion)"
                elif cur_oi_d < -0.5:
                    oi_status = "Сброс OI (Flush)"
                else:
                    oi_status = "Флэт OI"

                # Wall / OrderBook Density
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

                cur_atr = atr_vals[i] if not np.isnan(atr_vals[i]) else 0.0
                if use_atr_sl and cur_atr > 0 and entry_price > 0:
                    sl_dist = cur_atr * atr_multiplier
                else:
                    sl_dist = entry_price * (stop_loss_pct / 100.0)

                if pos_dir == 1:
                    tp_price = entry_price * (1.0 + (take_profit_pct / 100.0))
                    sl_price = max(0.0, entry_price - sl_dist)
                    trailing_sl = sl_price
                    max_favorable = entry_price
                else:
                    tp_price = max(0.0, entry_price * (1.0 - (take_profit_pct / 100.0)))
                    sl_price = entry_price + sl_dist
                    trailing_sl = sl_price
                    max_favorable = entry_price

                in_pos = True

        # Calculate metrics
        total_trades = len(trades)
        wins = [t for t in trades if t['pnl_usd'] > 0]
        losses = [t for t in trades if t['pnl_usd'] <= 0]
        win_rate = round((len(wins) / total_trades) * 100, 2) if total_trades > 0 else 0.0

        total_profit = sum(t['pnl_usd'] for t in wins)
        total_loss = abs(sum(t['pnl_usd'] for t in losses))
        profit_factor = round(total_profit / total_loss, 2) if total_loss > 0 else (999.0 if total_profit > 0 else 0.0)

        # Max drawdown
        peak = self.initial_capital
        max_dd_usd = 0.0
        max_dd_pct = 0.0
        for pt in equity_curve:
            eq = pt['equity']
            if eq > peak:
                peak = eq
            dd_usd = peak - eq
            dd_pct = (dd_usd / peak) * 100 if peak > 0 else 0
            if dd_pct > max_dd_pct:
                max_dd_pct = dd_pct
                max_dd_usd = dd_usd

        net_pnl = round(capital - self.initial_capital, 2)
        roi_pct = round((net_pnl / self.initial_capital) * 100, 2)

        # Confluence matrix
        confluence_matrix = self.calculate_confluence_matrix(trades)

        return {
            "strategy": strategy_type,
            "initial_capital": self.initial_capital,
            "final_equity": round(capital, 2),
            "net_pnl": net_pnl,
            "roi_pct": roi_pct,
            "total_trades": total_trades,
            "wins_count": len(wins),
            "losses_count": len(losses),
            "win_rate_pct": win_rate,
            "profit_factor": profit_factor,
            "max_drawdown_pct": round(max_dd_pct, 2),
            "max_drawdown_usd": round(max_dd_usd, 2),
            "equity_curve": equity_curve,
            "trades": trades[-1000:],
            "confluence_matrix": confluence_matrix
        }

    def calculate_confluence_matrix(self, trades: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Aggregates orderflow trades by context conditions (imbalances, POC, CVD, OI, walls)
        and computes WinRate, Profit Factor, sample size, and recommended filters.
        """
        if not trades:
            return []

        # Buckets for grouping
        groups: Dict[str, Dict[str, Any]] = {}

        def record(combo_name: str, factors: Dict[str, Any], t: Dict[str, Any]):
            if combo_name not in groups:
                groups[combo_name] = {
                    "condition_name": combo_name,
                    "factors": factors,
                    "trades": []
                }
            groups[combo_name]["trades"].append(t)

        for t in trades:
            ctx = t.get("context_snapshot") or {}
            imb = ctx.get("imbalance_group", "< 1.5x (Нейтральный)")
            poc = ctx.get("poc_position", "На уровне POC")
            cvd = ctx.get("cvd_trend", "CVD > EMA")
            div = ctx.get("cvd_divergence", "Без дивергенции")
            oi = ctx.get("oi_status", "Флэт OI")
            wall = ctx.get("wall_type", "Без крупной стенки")

            # 1. Full primary combination
            full_combo = f"{imb} + {cvd} + {oi}"
            record(full_combo, {"imbalance": imb, "cvd": cvd, "oi": oi, "poc": poc, "wall": wall}, t)

            # 2. Imbalance + Wall
            record(f"{imb} + {wall}", {"imbalance": imb, "wall": wall}, t)

            # 3. CVD Trend + POC position
            record(f"{cvd} + {poc}", {"cvd": cvd, "poc": poc}, t)

            # 4. CVD Divergence + OI Status
            if div != "Без дивергенции":
                record(f"{div} + {oi}", {"divergence": div, "oi": oi}, t)

            # 5. Wall + OI Expansion
            if "Стенка" in wall:
                record(f"{wall} + {oi}", {"wall": wall, "oi": oi}, t)

        matrix = []
        for combo_name, data in groups.items():
            t_list = data["trades"]
            total_n = len(t_list)
            if total_n == 0:
                continue

            wins_n = sum(1 for tr in t_list if tr.get("pnl_usd", 0) > 0)
            wr = round((wins_n / total_n) * 100.0, 1)

            profit_sum = sum(tr.get("pnl_usd", 0) for tr in t_list if tr.get("pnl_usd", 0) > 0)
            loss_sum = abs(sum(tr.get("pnl_usd", 0) for tr in t_list if tr.get("pnl_usd", 0) <= 0))
            if loss_sum > 0:
                pf = round(profit_sum / loss_sum, 2)
            else:
                pf = 9.99 if profit_sum > 0 else 0.0

            avg_pnl = round(sum(tr.get("pnl_pct", 0) for tr in t_list) / total_n, 2)

            grade = "High Probability" if (wr >= 60.0 and total_n >= 3) else ("Moderate" if wr >= 45.0 else "Low")

            factors = data["factors"]
            recommended = {
                "use_cvd_filter": "CVD > EMA" in factors.values(),
                "use_oi_filter": "Набор OI (Expansion)" in factors.values(),
                "use_atr_filter": True,
                "min_density_usd": 1000000.0 if "Стенка > $1M" in factors.values() else (400000.0 if "Стенка $400k-$1M" in factors.values() else 0.0),
                "volume_multiplier": 1.5 if "> 3:1" in str(factors) else 1.2
            }

            matrix.append({
                "condition_name": combo_name,
                "factors": factors,
                "total_trades": total_n,
                "win_trades": wins_n,
                "win_rate_pct": wr,
                "profit_factor": pf,
                "avg_pnl_pct": avg_pnl,
                "grade": grade,
                "recommended_filters": recommended
            })

        # Sort: High Probability first, then by win rate and profit factor
        matrix.sort(key=lambda m: (1 if m["grade"] == "High Probability" else (0.5 if m["grade"] == "Moderate" else 0), m["win_rate_pct"], m["profit_factor"], m["total_trades"]), reverse=True)
        return matrix[:15]

    def inspect_level_bounces(
        self,
        df: pd.DataFrame,
        level_price: float,
        tolerance_pct: float = 0.35,
        lookforward_bars: int = 6
    ) -> Dict[str, Any]:
        """
        Express backtest of historical price bounces and breakouts from a specified price level.
        Detects candle touches and tests whether price bounced away (>= +0.8%) or broke through.
        """
        if df.empty or level_price <= 0:
            return {
                "level_price": level_price,
                "total_touches": 0,
                "bounces_count": 0,
                "breakouts_count": 0,
                "bounce_winrate_pct": 0.0,
                "avg_bounce_pnl_pct": 0.0,
                "touches": [],
                "recommendation": "Недостаточно данных для анализа уровня"
            }

        tol = (tolerance_pct / 100.0)
        upper_band = level_price * (1.0 + tol)
        lower_band = level_price * (1.0 - tol)

        high_vals = df['high'].values
        low_vals = df['low'].values
        close_vals = df['close'].values
        open_vals = df['open'].values
        ts_vals = df['timestamp'].values

        n = len(df)
        touches = []
        last_touch_bar = -10

        for i in range(1, n - lookforward_bars):
            # Cooldown between touches
            if i - last_touch_bar < 4:
                continue

            h = high_vals[i]
            l = low_vals[i]

            # Candle touches the level band
            if l <= upper_band and h >= lower_band:
                prev_c = close_vals[i - 1]
                # Approach direction: from above (support test) or from below (resistance test)
                is_support_test = prev_c >= level_price
                touch_type = "Поддержка (LONG)" if is_support_test else "Сопротивление (SHORT)"

                # Look forward to evaluate bounce vs breakout
                forward_highs = high_vals[i+1 : i+1+lookforward_bars]
                forward_lows = low_vals[i+1 : i+1+lookforward_bars]

                if is_support_test:
                    # Bounce needs upward movement >= +0.7% without breaking below tolerance * 1.5
                    max_rebound = (max(forward_highs) - level_price) / level_price * 100.0
                    max_penetration = (level_price - min(forward_lows)) / level_price * 100.0
                    is_bounce = max_rebound >= 0.7 and max_penetration <= (tolerance_pct * 1.6)
                    pnl_move = round(max_rebound if is_bounce else -max_penetration, 2)
                else:
                    # Resistance test: downward movement >= -0.7%
                    max_rebound = (level_price - min(forward_lows)) / level_price * 100.0
                    max_penetration = (max(forward_highs) - level_price) / level_price * 100.0
                    is_bounce = max_rebound >= 0.7 and max_penetration <= (tolerance_pct * 1.6)
                    pnl_move = round(max_rebound if is_bounce else -max_penetration, 2)

                touches.append({
                    "timestamp": int(ts_vals[i]),
                    "candle_time": str(pd.to_datetime(ts_vals[i], unit='ms')),
                    "test_type": touch_type,
                    "outcome": "Отскок (Bounce)" if is_bounce else "Пробой (Breakout)",
                    "max_movement_pct": pnl_move
                })
                last_touch_bar = i

        total_touches = len(touches)
        bounces = [t for t in touches if "Отскок" in t["outcome"]]
        breakouts = [t for t in touches if "Пробой" in t["outcome"]]
        bounces_count = len(bounces)
        breakouts_count = len(breakouts)

        bounce_wr = round((bounces_count / total_touches * 100.0), 1) if total_touches > 0 else 0.0
        avg_bounce_pnl = round(sum(t["max_movement_pct"] for t in bounces) / bounces_count, 2) if bounces_count > 0 else 0.0

        if total_touches >= 5 and bounce_wr >= 60.0:
            rec = f"✅ Сильный рабочий уровень ${level_price:.2f}: отскоки отрабатывают в {bounce_wr}% случаев (средний импульс +{avg_bounce_pnl}%). Рекомендуется лимитный вход на отскок со стопом {tolerance_pct * 1.5:.2f}%."
        elif total_touches >= 3 and bounce_wr >= 45.0:
            rec = f"⚠️ Умеренный уровень ${level_price:.2f}: WinRate отскока {bounce_wr}% ({bounces_count}/{total_touches}). Требуется обязательное подтверждение поглощением дельты (CVD) в стакане."
        elif total_touches > 0:
            rec = f"🛑 Пробойный уровень ${level_price:.2f}: отскоки всего {bounce_wr}%, преобладают импульсные пробои ({breakouts_count} из {total_touches}). Опасен для отскока, предпочтителен вход на пробой."
        else:
            rec = f"ℹ️ На уровне ${level_price:.2f} за выбранный период не зафиксировано касаний."

        return {
            "level_price": level_price,
            "total_touches": total_touches,
            "bounces_count": bounces_count,
            "breakouts_count": breakouts_count,
            "bounce_winrate_pct": bounce_wr,
            "avg_bounce_pnl_pct": avg_bounce_pnl,
            "recommendation": rec,
            "touches": touches[-30:]
        }

orderflow_backtester = OrderFlowBacktester()

