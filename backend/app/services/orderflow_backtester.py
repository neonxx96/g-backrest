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

        # Delta & CVD
        if 'delta' not in data.columns and 'taker_buy_volume' in data.columns:
            data['delta'] = (2.0 * data['taker_buy_volume']) - data['volume']
        elif 'delta' not in data.columns:
            # Synthetic delta based on candle body & volume
            body = data['close'] - data['open']
            rng = data['high'] - data['low'].replace(0, np.nan)
            data['delta'] = (body / rng).fillna(0) * data['volume']

        data['cvd'] = data['delta'].cumsum()

        # RSI 14
        delta_p = data['close'].diff()
        gain = delta_p.clip(lower=0)
        loss = -delta_p.clip(upper=0)
        avg_gain = gain.ewm(alpha=1/14, min_periods=14, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1/14, min_periods=14, adjust=False).mean()
        rs = avg_gain / avg_loss.replace(0, np.nan)
        data['rsi'] = 100 - (100 / (1 + rs))

        # ATR 14
        h_l = data['high'] - data['low']
        h_pc = (data['high'] - data['close'].shift(1)).abs()
        l_pc = (data['low'] - data['close'].shift(1)).abs()
        tr = pd.concat([h_l, h_pc, l_pc], axis=1).max(axis=1)
        data['atr'] = tr.rolling(window=14).mean()

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

        data = self.calculate_indicators(df)
        
        # Generate Signals based on strategy type
        # 1: Long, -1: Short, 0: Neutral
        signals = np.zeros(len(data))

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

        for i in range(50, len(data)):
            c = close_vals[i]
            prev_c = close_vals[i-1]
            ema = ema20_vals[i]
            prev_ema = ema20_vals[i-1]
            v_rat = vol_ratio_vals[i] if not np.isnan(vol_ratio_vals[i]) else 1.0
            rsi = rsi_vals[i] if not np.isnan(rsi_vals[i]) else 50.0
            delta = delta_vals[i]

            if strategy_type == "confluence_ema":
                # EMA(20) Bounce/Cross + Volume Spike + Delta Confirmation
                if prev_c <= prev_ema and c > ema and v_rat >= volume_multiplier and delta > 0 and 40 <= rsi <= 65:
                    signals[i] = 1
                elif prev_c >= prev_ema and c < ema and v_rat >= volume_multiplier and delta < 0 and 35 <= rsi <= 60:
                    signals[i] = -1

            elif strategy_type == "ema_trend":
                # EMA20 crosses EMA50 in direction of delta with volume confirmation
                cross_up = ema20_vals[i-1] <= ema50_vals[i-1] and ema20_vals[i] > ema50_vals[i]
                cross_dn = ema20_vals[i-1] >= ema50_vals[i-1] and ema20_vals[i] < ema50_vals[i]
                if cross_up and v_rat >= volume_multiplier and delta > 0:
                    signals[i] = 1
                elif cross_dn and v_rat >= volume_multiplier and delta < 0:
                    signals[i] = -1

            elif strategy_type == "delta_absorption":
                # Delta Absorption: Local extreme with CVD divergence
                local_min_price = min(low_vals[i-10:i])
                local_min_cvd = min(cvd_vals[i-10:i])
                if low_vals[i] <= local_min_price and cvd_vals[i] > local_min_cvd and delta > 0 and rsi < 40 and v_rat >= volume_multiplier:
                    signals[i] = 1
                local_max_price = max(high_vals[i-10:i])
                local_max_cvd = max(cvd_vals[i-10:i])
                if high_vals[i] >= local_max_price and cvd_vals[i] < local_max_cvd and delta < 0 and rsi > 60 and v_rat >= volume_multiplier:
                    signals[i] = -1

            elif strategy_type == "density_bounce":
                # Liquidity bounce proxy: pin-bar rejection with delta confirmation on big turnover
                turnover = c * volume_vals[i]
                if turnover >= min_density_usd:
                    is_pinbar_bull = (c - low_vals[i]) > 2 * (high_vals[i] - c) and delta > 0
                    is_pinbar_bear = (high_vals[i] - c) > 2 * (c - low_vals[i]) and delta < 0
                    if is_pinbar_bull and v_rat >= volume_multiplier and rsi < 40:
                        signals[i] = 1
                    elif is_pinbar_bear and v_rat >= volume_multiplier and rsi > 60:
                        signals[i] = -1


        # Simulate Execution
        trades = []
        capital = self.initial_capital
        equity_curve = [{"time": int(data.iloc[0]['timestamp']), "equity": capital}]
        
        in_pos = False
        pos_dir = 0
        entry_price = 0.0
        entry_time = None
        tp_price = 0.0
        sl_price = 0.0
        trailing_sl = 0.0
        max_favorable = 0.0
        pos_size = 0.0

        for i in range(len(data)):
            row = data.iloc[i]
            cur_time = int(row['timestamp'])
            open_p = row['open']
            high_p = row['high']
            low_p = row['low']
            close_p = row['close']
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
                        "exit_reason": exit_reason
                    })
                    in_pos = False
                    equity_curve.append({"time": cur_time, "equity": round(capital, 2)})

            # 2. Check Entry if flat
            if not in_pos and sig != 0:
                pos_dir = int(sig)
                entry_price = close_p * (1.0 + (self.slippage_pct if pos_dir == 1 else -self.slippage_pct))
                entry_time = cur_time
                pos_size = capital * leverage

                if pos_dir == 1:
                    tp_price = entry_price * (1.0 + (take_profit_pct / 100.0))
                    sl_price = entry_price * (1.0 - (stop_loss_pct / 100.0))
                    trailing_sl = sl_price
                    max_favorable = entry_price
                else:
                    tp_price = entry_price * (1.0 - (take_profit_pct / 100.0))
                    sl_price = entry_price * (1.0 + (stop_loss_pct / 100.0))
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
            "trades": trades[-1000:]
        }

orderflow_backtester = OrderFlowBacktester()
