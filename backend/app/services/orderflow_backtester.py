"""
Order Flow & Institutional Quant Strategy Backtester
Implements:
1. Realistic Execution Engine:
   - Maker Fee (0.02%) for limit entries at density walls & limit TP exits
   - Taker Fee (0.05%) for market Stop-Loss / Trailing / Breakeven exits
   - Impulse / Liquidation Slippage (1-3 ticks) on Stop-Loss triggers
   - Multi-TP Scaling Out: TP1 (50% volume at +0.6% / 1.5 ATR) + move SL to Breakeven, TP2 (50% remainder)
2. Fast Heuristic Genetic Optimizer (50-100 evaluations, < 3 seconds):
   - Optimizes SL (0.2%-1.2%), TP (0.5%-3.0%), Min Wall ($300k-$3M), CVD slope filter, and ATR period
   - Fitness Function: Sharpe / Sortino maximization with strict penalty for Max Drawdown > 5%
3. Monte Carlo Robustness Stress-Test (500 Bootstrap & Permutation runs):
   - Probability of Drawdown > 10%, Expected Worst-Case DD, Median PnL, Fan Chart quantiles, and Robustness Verdict
"""

import math
import random
import time
from typing import Dict, List, Any, Optional, Tuple
import pandas as pd
import numpy as np


class OrderFlowBacktester:
    def __init__(
        self,
        initial_capital: float = 10000.0,
        fee_pct: float = 0.05,          # Legacy fallback taker fee (%)
        slippage_pct: float = 0.02,     # Legacy fallback slippage (%)
        maker_fee_pct: float = 0.02,    # 0.02% maker fee for limit entries/exits
        taker_fee_pct: float = 0.05,    # 0.05% taker fee for market SL exits
        slippage_ticks: int = 2,        # 1-3 ticks slippage on impulsive stops
    ):
        self.initial_capital = float(initial_capital) if initial_capital > 0 else 10000.0
        self.fee_pct = float(fee_pct) / 100.0
        self.slippage_pct = float(slippage_pct) / 100.0
        self.maker_fee_rate = max(0.0, float(maker_fee_pct)) / 100.0
        self.taker_fee_rate = max(0.0, float(taker_fee_pct)) / 100.0
        self.slippage_ticks = max(0, int(slippage_ticks))

    @staticmethod
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

    @staticmethod
    def validate_ohlcv_integrity(data: pd.DataFrame, min_bars: int = 2) -> Dict[str, Any]:
        """Validate the real OHLCV contract before indicators or signals run."""
        if data is None or data.empty:
            return {"valid": False, "issues": ["OHLCV is empty"], "bars": 0}
        issues: List[str] = []
        required = ("timestamp", "open", "high", "low", "close", "volume")
        for column in required:
            if column not in data.columns:
                issues.append(f"missing required column: {column}")
                continue
            values = pd.to_numeric(data[column], errors="coerce")
            if not np.isfinite(values.to_numpy(dtype=float)).all():
                issues.append(f"{column} contains non-finite values")
        if len(data) < min_bars:
            issues.append(f"insufficient bars: {len(data)} < {min_bars}")
        if "timestamp" in data.columns and len(data) >= 2:
            timestamps = pd.to_numeric(data["timestamp"], errors="coerce")
            if timestamps.notna().all() and not timestamps.is_monotonic_increasing:
                issues.append("timestamp is not monotonic")
        return {"valid": not issues, "issues": issues, "bars": len(data)}

    def calculate_indicators(
        self,
        df: pd.DataFrame,
        atr_period: int = 14,
        cvd_ema_period: int = 14,
    ) -> pd.DataFrame:
        """Enriches dataframe with EMA, RSI, Volume MA, Delta, CVD, and ATR."""
        data = df.copy()
        atr_p = max(3, int(atr_period))
        cvd_p = max(3, int(cvd_ema_period))

        # EMA 20 / EMA 50
        data['ema20'] = data['close'].ewm(span=20, adjust=False).mean()
        data['ema50'] = data['close'].ewm(span=50, adjust=False).mean()

        # Volume MA 20 & Volume Ratio
        data['vol_ma20'] = data['volume'].rolling(window=20, min_periods=1).mean()
        safe_vol_ma = data['vol_ma20'].replace(0, np.nan)
        data['vol_ratio'] = (data['volume'] / safe_vol_ma).fillna(1.0)

        # Delta & CVD & CVD EMA
        if 'delta' not in data.columns and 'taker_buy_volume' in data.columns:
            data['delta'] = (2.0 * data['taker_buy_volume']) - data['volume']
        elif 'delta' not in data.columns and 'taker_buy_base_volume' in data.columns:
            data['delta'] = (2.0 * data['taker_buy_base_volume']) - data['volume']
        elif 'delta' not in data.columns:
            body = data['close'] - data['open']
            rng = (data['high'] - data['low']).replace(0, np.nan)
            data['delta'] = (body / rng).fillna(0.0) * data['volume']

        data['cvd'] = data['delta'].cumsum()
        data['cvd_ema14'] = data['cvd'].ewm(span=cvd_p, adjust=False).mean()
        data['cvd_slope'] = data['cvd_ema14'].diff(3).fillna(0.0)

        # Open Interest is optional historical data. Never derive a proxy from
        # volume/delta: downstream OI filters must know when the feed is absent.
        if 'oi' in data.columns:
            data['oi'] = pd.to_numeric(data['oi'], errors='coerce')
            data['oi_delta'] = data['oi'].diff()
            data['oi_available'] = data['oi'].notna()
        elif 'open_interest' in data.columns:
            data['oi'] = pd.to_numeric(data['open_interest'], errors='coerce')
            data['oi_delta'] = data['oi'].diff()
            data['oi_available'] = data['oi'].notna()
        else:
            data['oi'] = np.nan
            data['oi_delta'] = np.nan
            data['oi_available'] = False

        # RSI 14
        delta_p = data['close'].diff()
        gain = delta_p.clip(lower=0.0)
        loss = -delta_p.clip(upper=0.0)
        avg_gain = gain.ewm(alpha=1.0 / 14.0, min_periods=14, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1.0 / 14.0, min_periods=14, adjust=False).mean()
        rs = avg_gain / avg_loss.replace(0, np.nan)
        data['rsi'] = (100.0 - (100.0 / (1.0 + rs))).fillna(50.0)

        # ATR(atr_period) & ATR EMA 20
        h_l = data['high'] - data['low']
        h_pc = (data['high'] - data['close'].shift(1)).abs()
        l_pc = (data['low'] - data['close'].shift(1)).abs()
        tr = pd.concat([h_l, h_pc, l_pc], axis=1).max(axis=1)
        data['atr'] = tr.ewm(alpha=1.0 / float(atr_p), min_periods=atr_p, adjust=False).mean().bfill().fillna(0.0)
        data['atr_ema20'] = data['atr'].ewm(span=20, adjust=False).mean().bfill().fillna(0.0)

        # Precompute rolling 10-bar and 6-bar extrema for ultra-fast signal evaluation
        data['low_min10'] = data['low'].shift(1).rolling(10, min_periods=1).min().bfill()
        data['high_max10'] = data['high'].shift(1).rolling(10, min_periods=1).max().bfill()
        data['cvd_min10'] = data['cvd'].shift(1).rolling(10, min_periods=1).min().bfill()
        data['cvd_max10'] = data['cvd'].shift(1).rolling(10, min_periods=1).max().bfill()
        data['low_min6'] = data['low'].shift(1).rolling(6, min_periods=1).min().bfill()
        data['high_max6'] = data['high'].shift(1).rolling(6, min_periods=1).max().bfill()
        data['cvd_min6'] = data['cvd'].shift(1).rolling(6, min_periods=1).min().bfill()
        data['cvd_max6'] = data['cvd'].shift(1).rolling(6, min_periods=1).max().bfill()
        data['_atr_p'] = atr_p
        data['_cvd_p'] = cvd_p

        return data

    def evaluate_latest_signal(
        self,
        data: pd.DataFrame,
        strategy_type: str = "confluence_ema",
        volume_multiplier: float = 1.3,
        min_density_usd: float = 0.0,
        use_atr_filter: bool = False,
        use_cvd_filter: bool = False,
        use_oi_filter: bool = False,
        use_rsi_filter: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """Evaluate the latest fully formed candle with the backtest signal rules.

        This is intentionally a pure signal evaluator shared by forecast and
        live paper mode. It does not execute an order and does not look ahead.
        ``cluster_volume_bounce`` maps to the historical ``density_bounce``
        profile because historical OHLCV has no L2 wall stream.
        """
        if data is None or len(data) < 2:
            return None
        integrity = self.validate_ohlcv_integrity(data)
        if not integrity["valid"]:
            return None
        frame = data if "low_min10" in data.columns else self.calculate_indicators(data)
        if len(frame) < 2:
            return None
        cur = frame.iloc[-1]
        prev = frame.iloc[-2]
        profile = "density_bounce" if strategy_type == "cluster_volume_bounce" else strategy_type
        close = float(cur.get("close", 0.0))
        previous_close = float(prev.get("close", 0.0))
        volume = float(cur.get("volume", 0.0))
        turnover = close * volume
        passes_wall = min_density_usd <= 0 or turnover >= min_density_usd
        volume_ok = profile in {"diagnostics_lenient", "naked_test"} or float(cur.get("vol_ratio", 0.0)) >= float(volume_multiplier)
        delta = float(cur.get("delta", 0.0))
        rsi = float(cur.get("rsi", 50.0))
        direction = 0
        reasons: List[str] = []

        if profile == "confluence_ema":
            if passes_wall and previous_close <= float(prev.get("ema20", 0.0)) and close > float(cur.get("ema20", 0.0)) and volume_ok and delta > 0 and 40 <= rsi <= 65:
                direction = 1
                reasons = ["EMA20 cross up", f"Volume ratio {float(cur.get('vol_ratio', 0.0)):.2f}x", f"Delta {delta:+.2f}"]
            elif passes_wall and previous_close >= float(prev.get("ema20", 0.0)) and close < float(cur.get("ema20", 0.0)) and volume_ok and delta < 0 and 35 <= rsi <= 60:
                direction = -1
                reasons = ["EMA20 cross down", f"Volume ratio {float(cur.get('vol_ratio', 0.0)):.2f}x", f"Delta {delta:+.2f}"]
        elif profile == "diagnostics_lenient":
            # Diagnostic-only profile: keeps real OHLCV/EMA/delta inputs but
            # intentionally drops production-only confirmation gates so the
            # paper execution lifecycle can be exercised in a short run.
            if passes_wall and volume_ok and delta != 0:
                direction = 1 if close >= float(cur.get("ema20", close)) else -1
                reasons = ["Diagnostics EMA bias", f"Volume ratio {float(cur.get('vol_ratio', 0.0)):.2f}x", f"Delta {delta:+.2f}"]
        elif profile == "naked_test":
            # Deliberately minimal, paper-only pipeline probe. It is not a
            # production strategy: the current EMA20 side is the only gate.
            # Unlike an event-only cross, this lets a short run prove that
            # entry -> exit -> PnL plumbing works in a quiet market.
            if close >= float(cur.get("ema20", 0.0)):
                direction = 1
                reasons = ["Naked EMA20 bullish side"]
            else:
                direction = -1
                reasons = ["Naked EMA20 bearish side"]
        elif profile in ("delta_absorption", "cvd_absorption"):
            if passes_wall and float(cur.get("low", 0.0)) <= float(cur.get("low_min10", 0.0)) and float(cur.get("cvd", 0.0)) > float(cur.get("cvd_min10", 0.0)) and delta > 0 and rsi < 42 and volume_ok:
                direction = 1
                reasons = ["CVD absorption at local low", f"CVD {float(cur.get('cvd', 0.0)):+.2f}", f"Volume ratio {float(cur.get('vol_ratio', 0.0)):.2f}x"]
            elif passes_wall and float(cur.get("high", 0.0)) >= float(cur.get("high_max10", 0.0)) and float(cur.get("cvd", 0.0)) < float(cur.get("cvd_max10", 0.0)) and delta < 0 and rsi > 58 and volume_ok:
                direction = -1
                reasons = ["CVD absorption at local high", f"CVD {float(cur.get('cvd', 0.0)):+.2f}", f"Volume ratio {float(cur.get('vol_ratio', 0.0)):.2f}x"]
        elif profile in ("density_bounce", "limit_bounce"):
            bullish_pin = (close - float(cur.get("low", 0.0))) > 1.8 * (float(cur.get("high", 0.0)) - close) and delta > 0
            bearish_pin = (float(cur.get("high", 0.0)) - close) > 1.8 * (close - float(cur.get("low", 0.0))) and delta < 0
            if passes_wall and bullish_pin and volume_ok and rsi < 44:
                direction = 1
                reasons = ["OHLCV bullish pinbar", f"Volume ratio {float(cur.get('vol_ratio', 0.0)):.2f}x", f"Delta {delta:+.2f}"]
            elif passes_wall and bearish_pin and volume_ok and rsi > 56:
                direction = -1
                reasons = ["OHLCV bearish pinbar", f"Volume ratio {float(cur.get('vol_ratio', 0.0)):.2f}x", f"Delta {delta:+.2f}"]

        if not direction:
            return None
        if use_atr_filter and float(cur.get("atr_ema20", 0.0)) > 0 and float(cur.get("atr", 0.0)) > 2.0 * float(cur.get("atr_ema20", 0.0)):
            return None
        if use_cvd_filter:
            cvd = float(cur.get("cvd", 0.0))
            cvd_ema = float(cur.get("cvd_ema14", 0.0))
            if direction > 0:
                bull_div = (float(cur.get("low", 0.0)) <= float(cur.get("low_min6", 0.0)) and cvd > float(cur.get("cvd_min6", 0.0))) or (close < previous_close and cvd > float(prev.get("cvd", 0.0)))
                if not (delta > 0 and (cvd >= cvd_ema or bull_div)):
                    return None
            else:
                bear_div = (float(cur.get("high", 0.0)) >= float(cur.get("high_max6", 0.0)) and cvd < float(cur.get("cvd_max6", 0.0))) or (close > previous_close and cvd < float(prev.get("cvd", 0.0)))
                if not (delta < 0 and (cvd <= cvd_ema or bear_div)):
                    return None
        if use_oi_filter:
            oi_delta = cur.get("oi_delta")
            if not bool(cur.get("oi_available", pd.notna(oi_delta))) or pd.isna(oi_delta) or float(oi_delta) < 0:
                return None
        if use_rsi_filter:
            if profile == "confluence_ema":
                if not 42 <= rsi <= 58:
                    return None
            else:
                previous_rsi = float(prev.get("rsi", 50.0))
                if direction > 0 and not (rsi <= 42 or (previous_rsi <= 36 and rsi >= 30)):
                    return None
                if direction < 0 and not (rsi >= 58 or (previous_rsi >= 64 and rsi <= 70)):
                    return None
        return {"direction": "LONG" if direction > 0 else "SHORT", "reasons": reasons, "timestamp": int(cur.get("timestamp", 0))}

    def explain_latest_signal(
        self,
        data: pd.DataFrame,
        strategy_type: str = "confluence_ema",
        volume_multiplier: float = 1.3,
        min_density_usd: float = 0.0,
        use_atr_filter: bool = False,
        use_cvd_filter: bool = False,
        use_oi_filter: bool = False,
        use_rsi_filter: bool = False,
    ) -> Dict[str, Any]:
        """Explain the latest decision without changing signal semantics.

        This is a diagnostics-only companion to ``evaluate_latest_signal`` for
        live paper UI. It never creates orders and deliberately reports the
        observable gates that prevented a signal instead of fabricating one.
        """
        if data is None or len(data) < 2:
            return {"status": "NO_TRADE", "reason": "NO_TRADE: недостаточно свечей для проверки.", "failed_checks": ["history"], "rejections": [], "observed": {}}
        integrity = self.validate_ohlcv_integrity(data)
        if not integrity["valid"]:
            return {
                "status": "NO_TRADE",
                "reason": "NO_TRADE: некорректный OHLCV — " + "; ".join(integrity["issues"][:2]),
                "failed_checks": ["data_integrity"],
                "rejections": [{"filter": "data_integrity", "actual": integrity["bars"], "operator": "valid", "threshold": False, "issues": integrity["issues"]}],
                "observed": {"bars": integrity["bars"]},
            }
        frame = data if "low_min10" in data.columns else self.calculate_indicators(data)
        if len(frame) < 2:
            return {"status": "NO_TRADE", "reason": "NO_TRADE: индикаторы ещё не готовы.", "failed_checks": ["indicators"], "rejections": [], "observed": {}}

        cur = frame.iloc[-1]
        prev = frame.iloc[-2]
        profile = "density_bounce" if strategy_type == "cluster_volume_bounce" else strategy_type
        close = float(cur.get("close", 0.0))
        previous_close = float(prev.get("close", 0.0))
        volume_ratio = float(cur.get("vol_ratio", 0.0))
        delta = float(cur.get("delta", 0.0))
        rsi = float(cur.get("rsi", 50.0))
        turnover = close * float(cur.get("volume", 0.0))
        failed: List[str] = []
        rejections: List[Dict[str, Any]] = []

        def reject(name: str, actual: Any, operator: str, threshold: Any, **extra: Any) -> None:
            failed.append(name)
            rejections.append({"filter": name, "actual": actual, "operator": operator, "threshold": threshold, **extra})

        if min_density_usd > 0 and turnover < min_density_usd:
            reject("minimum_turnover", round(turnover, 2), ">=", float(min_density_usd))

        if profile not in {"diagnostics_lenient", "naked_test"} and volume_ratio < float(volume_multiplier):
            reject("volume_multiplier", round(volume_ratio, 4), ">=", float(volume_multiplier))
        if profile == "confluence_ema":
            cross_up = previous_close <= float(prev.get("ema20", 0.0)) and close > float(cur.get("ema20", 0.0))
            cross_down = previous_close >= float(prev.get("ema20", 0.0)) and close < float(cur.get("ema20", 0.0))
            if not (cross_up or cross_down):
                reject("ema20_cross", round(close, 8), "crosses", round(float(cur.get("ema20", 0.0)), 8), previous_close=round(previous_close, 8), previous_ema20=round(float(prev.get("ema20", 0.0)), 8))
            if delta == 0:
                reject("delta_direction", round(delta, 4), "!=", 0.0)
            if not (35 <= rsi <= 65):
                reject("base_rsi_band", round(rsi, 4), "within", [35.0, 65.0])
        elif profile in ("delta_absorption", "cvd_absorption"):
            absorption = (
                float(cur.get("low", 0.0)) <= float(cur.get("low_min10", 0.0))
                and float(cur.get("cvd", 0.0)) > float(cur.get("cvd_min10", 0.0))
                and delta > 0
                and rsi < 42
            ) or (
                float(cur.get("high", 0.0)) >= float(cur.get("high_max10", 0.0))
                and float(cur.get("cvd", 0.0)) < float(cur.get("cvd_max10", 0.0))
                and delta < 0
                and rsi > 58
            )
            if not absorption:
                reject("cvd_absorption_structure", round(delta, 4), "requires", "local price extreme + opposing CVD divergence", rsi=round(rsi, 4), cvd=round(float(cur.get("cvd", 0.0)), 4))
        elif profile in ("density_bounce", "limit_bounce"):
            bullish_pin = (close - float(cur.get("low", 0.0))) > 1.8 * (float(cur.get("high", 0.0)) - close) and delta > 0
            bearish_pin = (float(cur.get("high", 0.0)) - close) > 1.8 * (close - float(cur.get("low", 0.0))) and delta < 0
            if not (bullish_pin and rsi < 44 or bearish_pin and rsi > 56):
                reject("pinbar_and_rsi", round(rsi, 4), "requires", "pinbar + RSI extreme", delta=round(delta, 4))
        elif profile == "diagnostics_lenient":
            if delta == 0:
                reject("delta_direction", round(delta, 4), "!=", 0.0)
        elif profile == "naked_test":
            # A naked probe always yields a direction from a valid candle;
            # remaining NO_TRADE states are data-integrity failures above.
            pass

        if use_atr_filter and float(cur.get("atr_ema20", 0.0)) > 0 and float(cur.get("atr", 0.0)) > 2.0 * float(cur.get("atr_ema20", 0.0)):
            reject("atr_filter", round(float(cur.get("atr", 0.0)), 8), "<=", round(2.0 * float(cur.get("atr_ema20", 0.0)), 8))
        if use_oi_filter:
            oi_delta = cur.get("oi_delta")
            oi_available = bool(cur.get("oi_available", pd.notna(oi_delta))) and pd.notna(oi_delta)
            if not oi_available:
                reject("oi_filter", None, "available and >=", 0.0)
            elif float(oi_delta) < 0:
                reject("oi_filter", round(float(oi_delta), 4), ">=", 0.0)
        if use_cvd_filter and delta == 0:
            reject("cvd_filter", round(delta, 4), "!=", 0.0)
        if use_rsi_filter:
            if profile == "confluence_ema" and not 42 <= rsi <= 58:
                reject("rsi_filter", round(rsi, 4), "within", [42.0, 58.0])
            elif profile not in {"confluence_ema", "naked_test"} and not (rsi <= 42 or rsi >= 58):
                reject("rsi_filter", round(rsi, 4), "outside", [42.0, 58.0])

        signal = self.evaluate_latest_signal(
            frame,
            strategy_type=strategy_type,
            volume_multiplier=volume_multiplier,
            min_density_usd=min_density_usd,
            use_atr_filter=use_atr_filter,
            use_cvd_filter=use_cvd_filter,
            use_oi_filter=use_oi_filter,
            use_rsi_filter=use_rsi_filter,
        )
        observed = {"close": close, "volume_ratio": round(volume_ratio, 4), "delta": round(delta, 4), "rsi": round(rsi, 4), "turnover": round(turnover, 2)}
        if signal:
            return {"status": "SIGNAL", "direction": signal["direction"], "reason": "SIGNAL: все фильтры пройдены.", "failed_checks": [], "rejections": [], "observed": observed}
        unique_failed = list(dict.fromkeys(failed)) or ["strategy_conditions"]
        return {
            "status": "NO_TRADE",
            "reason": "NO_TRADE: не пройдены условия — " + ", ".join(unique_failed[:4]),
            "failed_checks": unique_failed,
            "rejections": rejections,
            "observed": observed,
        }

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
        # ТАКТ 1: Realistic Execution Engine & Multi-TP Scaling Out
        maker_fee_pct: Optional[float] = None,
        taker_fee_pct: Optional[float] = None,
        slippage_ticks: Optional[int] = None,
        use_multi_tp: bool = True,
        tp1_pct: float = 0.6,
        tp1_atr_mult: float = 1.5,
        atr_period: int = 14,
        cvd_ema_period: int = 14,
        compute_monte_carlo: bool = True,
        fast_eval: bool = False,
        # Ночной спринт ТАКТ 1: Расширенный конфигуратор стратегии
        entry_mode: Optional[str] = None,          # 'limit_bounce' | 'breakout' | 'cvd_absorption'
        sl_mode: str = "fixed_pct",                # 'fixed_pct' | 'behind_wall' | 'atr_volatility'
        wall_sl_offset_ticks: int = 3,             # offset in ticks behind the wall when sl_mode == 'behind_wall'
        tp1_rr_ratio: float = 1.5,                 # TP1 R:R target (e.g. 1:1.5) for 50% volume + Breakeven
        tp2_mode: str = "trend_rr",                # 'trend_rr' | 'opposite_wall'
        tp2_rr_ratio: float = 2.8,                 # TP2 R:R target (e.g. 1:2.8)
        min_wall_lifetime_sec: int = 30,           # Spoofing filter: min wall hold time (10..60 sec)
        use_dynamic_breakeven: bool = False,       # Move SL to Breakeven (+2*Fee+1tick) when MFE >= +0.5R
        dynamic_be_trigger_r: float = 0.5,
        risk_per_trade_pct: Optional[float] = None,
        # STRATEGY_WEAKNESSES fixes (docs/STRATEGY_WEAKNESSES_AND_UPGRADES.md), all default-off
        use_adaptive_wall: bool = False,           # Fix 2: dynamic_wall = rolling median(turnover, window) * mult
        adaptive_wall_mult: float = 2.5,
        adaptive_wall_window: int = 50,
        use_time_stop: bool = False,               # Fix 3: market exit if trade < +min_r after N minutes
        time_stop_minutes: int = 45,
        time_stop_min_r: float = 0.3,
        use_maker_exits: bool = False,             # Fix 4: trailing exits as limit orders (maker, no slippage)
        # EMA Trend periods (M5.2 sweep apply): defaults 20/50 keep legacy behavior
        fast_period: int = 20,                     # EMA fast span used by ema_trend/confluence baseline
        slow_period: int = 50,                     # EMA slow span; must be strictly greater than fast_period
    ) -> Dict[str, Any]:
        """
        Executes realistic institutional order-flow backtest with:
        - Maker/Taker fees & tick-based stop slippage
        - Entry modes: Limit Bounce, Wall Breakout, CVD Absorption
        - Dynamic Stop-Loss: Fixed %, Behind Wall (+ tick offset), or Volatility ATR (1.0x-3.0x)
        - Multi-TP scaling out (TP1 50% at 1:1.5 R:R + Breakeven SL, TP2 50% remainder)
        - Spoofing & Wall Lifetime filter (10..60 sec)
        - Monte Carlo 500-run bootstrap robustness stress-test
        """
        if df is None or df.empty or len(df) < 60:
            return {"error": "Недостаточно свечей для бэктеста (минимум 60)"}

        fast_ema_span = int(fast_period)
        slow_ema_span = int(slow_period)
        if fast_ema_span < 2 or slow_ema_span <= fast_ema_span:
            raise ValueError(
                f"EMA periods invalid: fast_period={fast_ema_span} must be >= 2 and "
                f"strictly less than slow_period={slow_ema_span}"
            )

        # Map entry_mode aliases to canonical strategy_type if specified
        eff_strategy = strategy_type
        if entry_mode:
            em = entry_mode.lower().strip()
            if em in ("limit_bounce", "density_bounce"):
                eff_strategy = "density_bounce"
            elif em in ("breakout", "wall_breakout"):
                eff_strategy = "wall_breakout"
            elif em in ("cvd_absorption", "delta_absorption"):
                eff_strategy = "delta_absorption"

        if use_atr_sl and sl_mode == "fixed_pct":
            sl_mode = "atr_volatility"

        maker_rate = (float(maker_fee_pct) / 100.0) if maker_fee_pct is not None else self.maker_fee_rate
        taker_rate = (float(taker_fee_pct) / 100.0) if taker_fee_pct is not None else self.taker_fee_rate
        slip_ticks = int(slippage_ticks) if slippage_ticks is not None else self.slippage_ticks
        slip_ticks = max(0, min(20, slip_ticks))
        wall_life_sec = max(10, min(60, int(min_wall_lifetime_sec or 30)))

        already_enriched = (
            'low_min10' in df.columns
            and int(df['_atr_p'].iloc[0]) == int(atr_period)
            and int(df['_cvd_p'].iloc[0]) == int(cvd_ema_period)
        )
        data = df if already_enriched else self.calculate_indicators(df, atr_period=atr_period, cvd_ema_period=cvd_ema_period)

        # M5.2: переопределение EMA-периодов для sweep-apply (по умолчанию 20/50 — код не изменён).
        # Copy before mutation: already_enriched path reuses the caller-owned dataframe.
        if (fast_ema_span, slow_ema_span) != (20, 50):
            data = data.copy()
            data['ema20'] = data['close'].ewm(span=fast_ema_span, adjust=False).mean()
            data['ema50'] = data['close'].ewm(span=slow_ema_span, adjust=False).mean()

        signals = np.zeros(len(data), dtype=np.int8)

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
        low_min10_vals = data['low_min10'].values
        high_max10_vals = data['high_max10'].values
        cvd_min10_vals = data['cvd_min10'].values
        cvd_max10_vals = data['cvd_max10'].values
        low_min6_vals = data['low_min6'].values
        high_max6_vals = data['high_max6'].values
        cvd_min6_vals = data['cvd_min6'].values
        cvd_max6_vals = data['cvd_max6'].values

        # Adaptive turnover scaling so high wall thresholds ($300k-$3M) work across all timeframes
        median_turnover = float(np.nanmedian(close_vals * volume_vals)) if len(close_vals) > 0 else 0.0
        effective_min_wall = float(min_density_usd)
        if effective_min_wall > 0 and median_turnover > 0 and effective_min_wall > median_turnover * 4.5:
            effective_min_wall = median_turnover * min(3.5, 0.8 + (effective_min_wall / 3_000_000.0) * 2.2)

        # Fix 2 (STRATEGY_WEAKNESSES): per-bar adaptive wall threshold from a rolling
        # median of bar turnover. Warmup bars have no median -> honestly no wall gate.
        adaptive_wall_vals: Optional[np.ndarray] = None
        if use_adaptive_wall:
            turnover_series = close_vals * volume_vals
            adaptive_wall_vals = (
                pd.Series(turnover_series)
                .rolling(window=max(2, int(adaptive_wall_window)), min_periods=max(2, int(adaptive_wall_window)))
                .median()
                .values
                * max(0.1, float(adaptive_wall_mult))
            )

        # Spoofing & Wall Lifetime filter: higher min_wall_lifetime_sec (e.g. 45-60s) requires sustained multi-bar volume
        lifetime_factor = 1.0 + max(0.0, (wall_life_sec - 30.0) / 150.0)

        for i in range(50, len(data)):
            c = float(close_vals[i])
            prev_c = float(close_vals[i - 1])
            ema = float(ema20_vals[i])
            prev_ema = float(ema20_vals[i - 1])
            v_rat = float(vol_ratio_vals[i])
            prev_v_rat = float(vol_ratio_vals[i - 1])
            rsi = float(rsi_vals[i])
            delta = float(delta_vals[i])

            turnover = c * float(volume_vals[i])
            if adaptive_wall_vals is not None:
                bar_wall = float(adaptive_wall_vals[i])
                passes_wall = np.isfinite(bar_wall) and turnover >= bar_wall
            else:
                passes_wall = (effective_min_wall <= 0) or (turnover >= effective_min_wall)
            # Wall hold verification: if min_wall_lifetime_sec > 35s, ensure previous bar was not an isolated spoof flash
            passes_lifetime = True if wall_life_sec <= 35 else ((v_rat + prev_v_rat) * 0.5 >= volume_multiplier * 0.75 * lifetime_factor)

            raw_signal = 0

            if eff_strategy == "confluence_ema":
                if passes_wall and passes_lifetime and prev_c <= prev_ema and c > ema and v_rat >= volume_multiplier and delta > 0 and 40 <= rsi <= 65:
                    raw_signal = 1
                elif passes_wall and passes_lifetime and prev_c >= prev_ema and c < ema and v_rat >= volume_multiplier and delta < 0 and 35 <= rsi <= 60:
                    raw_signal = -1

            elif eff_strategy == "ema_trend":
                cross_up = ema20_vals[i - 1] <= ema50_vals[i - 1] and ema20_vals[i] > ema50_vals[i]
                cross_dn = ema20_vals[i - 1] >= ema50_vals[i - 1] and ema20_vals[i] < ema50_vals[i]
                if passes_wall and passes_lifetime and cross_up and v_rat >= volume_multiplier and delta > 0:
                    raw_signal = 1
                elif passes_wall and passes_lifetime and cross_dn and v_rat >= volume_multiplier and delta < 0:
                    raw_signal = -1

            elif eff_strategy in ("delta_absorption", "cvd_absorption"):
                if passes_wall and passes_lifetime and low_vals[i] <= low_min10_vals[i] and cvd_vals[i] > cvd_min10_vals[i] and delta > 0 and rsi < 42 and v_rat >= volume_multiplier:
                    raw_signal = 1
                elif passes_wall and passes_lifetime and high_vals[i] >= high_max10_vals[i] and cvd_vals[i] < cvd_max10_vals[i] and delta < 0 and rsi > 58 and v_rat >= volume_multiplier:
                    raw_signal = -1

            elif eff_strategy in ("density_bounce", "limit_bounce"):
                if passes_wall and passes_lifetime:
                    is_pinbar_bull = (c - low_vals[i]) > 1.8 * (high_vals[i] - c) and delta > 0
                    is_pinbar_bear = (high_vals[i] - c) > 1.8 * (c - low_vals[i]) and delta < 0
                    if is_pinbar_bull and v_rat >= volume_multiplier and rsi < 44:
                        raw_signal = 1
                    elif is_pinbar_bear and v_rat >= volume_multiplier and rsi > 56:
                        raw_signal = -1

            elif eff_strategy == "diagnostics_lenient":
                if passes_wall and passes_lifetime and delta != 0:
                    raw_signal = 1 if c >= ema else -1

            elif eff_strategy == "naked_test":
                raw_signal = 1 if c >= ema else -1

            elif eff_strategy in ("wall_breakout", "breakout"):
                # Пробой плотности (Wall Breakout): импульсный пробой локального экстремума/стенки на повышенном объёме и дельте
                if passes_wall and passes_lifetime:
                    if c > high_max6_vals[i] and delta > 0 and v_rat >= max(1.1, volume_multiplier) and 48 <= rsi <= 74:
                        raw_signal = 1
                    elif c < low_min6_vals[i] and delta < 0 and v_rat >= max(1.1, volume_multiplier) and 26 <= rsi <= 52:
                        raw_signal = -1

            # CONFLUENCE FILTER SUITE VALIDATION
            if raw_signal != 0:
                cur_atr = float(atr_vals[i])
                cur_atr_ema = float(atr_ema20_vals[i])
                cur_cvd = float(cvd_vals[i])
                cur_cvd_ema = float(cvd_ema14_vals[i])
                cur_oi_delta = float(oi_delta_vals[i]) if np.isfinite(oi_delta_vals[i]) else float("nan")

                allowed = True

                if use_atr_filter and cur_atr_ema > 0:
                    if cur_atr > 2.0 * cur_atr_ema:
                        allowed = False

                if allowed and use_cvd_filter:
                    if raw_signal == 1:
                        bull_div = (low_vals[i] <= low_min6_vals[i] and cur_cvd > cvd_min6_vals[i]) or (c < prev_c and cur_cvd > cvd_vals[i - 1])
                        if not (delta > 0 and (cur_cvd >= cur_cvd_ema or bull_div)):
                            allowed = False
                    elif raw_signal == -1:
                        bear_div = (high_vals[i] >= high_max6_vals[i] and cur_cvd < cvd_max6_vals[i]) or (c > prev_c and cur_cvd < cvd_vals[i - 1])
                        if not (delta < 0 and (cur_cvd <= cur_cvd_ema or bear_div)):
                            allowed = False

                if allowed and use_oi_filter:
                    if not np.isfinite(cur_oi_delta) or cur_oi_delta < 0:
                        allowed = False

                if allowed and use_rsi_filter:
                    if eff_strategy == "confluence_ema":
                        allowed = 42 <= rsi <= 58
                    else:
                        prev_rsi = float(rsi_vals[i - 1])
                        if raw_signal == 1:
                            if not (rsi <= 42 or (prev_rsi <= 36 and rsi >= 30)):
                                allowed = False
                        elif raw_signal == -1:
                            if not (rsi >= 58 or (prev_rsi >= 64 and rsi <= 70)):
                                allowed = False

                if allowed:
                    signals[i] = raw_signal

        # Simulate Realistic Execution with Maker/Taker Fees, Slippage Ticks & Multi-TP Scaling Out
        trades: List[Dict[str, Any]] = []
        capital = float(self.initial_capital)
        gross_capital = float(self.initial_capital)
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

        for i in range(len(data)):
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

                tick_unit = self._estimate_tick_size(entry_price)
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
                tick_unit_entry = self._estimate_tick_size(entry_price)

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

        # Aggregate Statistics (zero-division safe)
        total_trades = len(trades)
        wins = [t for t in trades if t['pnl_usd'] > 0]
        losses = [t for t in trades if t['pnl_usd'] <= 0]
        win_rate = round((len(wins) / total_trades) * 100.0, 2) if total_trades > 0 else 0.0

        total_profit = sum(t['pnl_usd'] for t in wins)
        total_loss = abs(sum(t['pnl_usd'] for t in losses))
        profit_factor = round(total_profit / total_loss, 2) if total_loss > 1e-9 else (999.0 if total_profit > 0 else 0.0)

        # Max drawdown on net equity curve
        peak = self.initial_capital
        max_dd_usd = 0.0
        max_dd_pct = 0.0
        for pt in equity_curve:
            eq = float(pt['equity'])
            if eq > peak:
                peak = eq
            dd_usd = peak - eq
            dd_pct = (dd_usd / peak) * 100.0 if peak > 0 else 0.0
            if dd_pct > max_dd_pct:
                max_dd_pct = dd_pct
                max_dd_usd = dd_usd

        net_pnl = round(capital - self.initial_capital, 2)
        roi_pct = round((net_pnl / max(1e-9, self.initial_capital)) * 100.0, 2)
        gross_pnl = round(gross_capital - self.initial_capital, 2)
        gross_roi_pct = round((gross_pnl / max(1e-9, self.initial_capital)) * 100.0, 2)

        if max_dd_usd > 1e-6:
            recovery_factor = round(net_pnl / max_dd_usd, 2)
        else:
            recovery_factor = round(max(0.0, roi_pct), 2)

        # Sharpe & Sortino ratios
        sharpe_ratio, sortino_ratio = self._calc_sharpe_sortino(equity_curve)

        # Confluence matrix (skipped when fast_eval=True)
        confluence_matrix = [] if fast_eval else self.calculate_confluence_matrix(trades)

        # Monte Carlo Robustness Stress-Test (500 runs)
        monte_carlo = (
            self.run_monte_carlo(trades, self.initial_capital, n_simulations=500, actual_equity_curve=equity_curve)
            if (compute_monte_carlo and not fast_eval)
            else None
        )

        # ТАКТ 1 & ТАКТ 2: Build transparent Data Feed Context & Active Position Setup for visual chart projection
        data_feed_context = None
        active_position_setup = None
        if not fast_eval and len(close_vals) > 10:
            last_idx = len(close_vals) - 1
            last_p = float(close_vals[last_idx])
            price_dec = 1 if last_p >= 100 else 4
            last_atr = float(atr_vals[last_idx]) if not np.isnan(atr_vals[last_idx]) else (last_p * 0.004)
            last_cvd = float(cvd_vals[last_idx]) if not np.isnan(cvd_vals[last_idx]) else 0.0
            last_cvd_ema = float(cvd_ema14_vals[last_idx]) if not np.isnan(cvd_ema14_vals[last_idx]) else 0.0

            if last_p <= float(low_min6_vals[last_idx]) and last_cvd > float(cvd_min6_vals[last_idx]):
                div_status = "Бычья дивергенция (Поглощение лимитками Bid)"
            elif last_p >= float(high_max6_vals[last_idx]) and last_cvd < float(cvd_max6_vals[last_idx]):
                div_status = "Медвежья дивергенция (Скрытые продажи Ask)"
            elif last_cvd >= last_cvd_ema:
                div_status = "CVD > EMA(14) (Доминируют покупатели)"
            else:
                div_status = "CVD < EMA(14) (Давление продавцов)"

            oi_slice = oi_delta_vals[max(0, last_idx - 12) : last_idx + 1]
            oi_available = bool(data["oi_available"].iloc[last_idx]) and np.isfinite(oi_slice).any()
            if oi_available:
                oi_1h_sum = float(np.nansum(oi_slice))
                oi_base = float(data["oi"].iloc[last_idx])
                oi_1h_pct = round((oi_1h_sum / max(1.0, oi_base)) * 100.0, 2) if oi_base > 0 else None
            else:
                oi_1h_pct = None
            if oi_1h_pct is None:
                oi_label = "Unavailable (no historical OI)"
            elif oi_1h_pct > 0.05:
                oi_label = f"Приток капитала (+{oi_1h_pct}%)"
            elif oi_1h_pct < -0.05:
                oi_label = f"Отток / Разгрузка ({oi_1h_pct}%)"
            else:
                oi_label = f"Нейтральный баланс ({oi_1h_pct:+.2f}%)"

            tick_sz = self._estimate_tick_size(last_p)
            atr_usd_val = round(last_atr, price_dec)
            atr_pct_val = round((last_atr / max(1e-9, last_p)) * 100.0, 2)
            atr_ticks_val = int(round(last_atr / max(1e-9, tick_sz)))
            data_feed_context = {
                "current_price": round(last_p, price_dec),
                "top_bid_wall_price": None,
                "top_bid_wall_usd": None,
                "top_bid_dist_pct": None,
                "top_ask_wall_price": None,
                "top_ask_wall_usd": None,
                "top_ask_dist_pct": None,
                "cvd_current": round(last_cvd, 1),
                "cvd_ema14": round(last_cvd_ema, 1),
                "cvd_divergence_status": div_status,
                "oi_1h_delta_pct": oi_1h_pct,
                "oi_status": oi_label,
                "atr_14_usd": atr_usd_val,
                "atr_14_pct": atr_pct_val,
                "atr_14_ticks": atr_ticks_val,
                "orderbook_walls": {
                    "available": False,
                    "source": None,
                    "reason": "Historical L2 order-book snapshots are not supplied to this backtest.",
                },
                "cvd_footprint": {
                    "cvd_current": round(last_cvd, 1),
                    "cvd_ema14": round(last_cvd_ema, 1),
                    "divergence_status": div_status,
                },
                "open_interest": {
                    "oi_1h_delta_pct": oi_1h_pct,
                    "flow_status": oi_label,
                    "available": oi_available,
                },
                "volatility_atr": {
                    "atr_14_usd": atr_usd_val,
                    "atr_14_pct": atr_pct_val,
                    "atr_14_ticks": atr_ticks_val,
                    "tick_size": tick_sz,
                },
            }

            # Build Active Position Setup around current price for immediate Chart & DOM rendering
            setup_dir = "LONG" if last_cvd >= last_cvd_ema else "SHORT"
            if trades:
                setup_dir = trades[-1]["direction"]
            order_kind = "STOP" if eff_strategy in ("wall_breakout", "breakout") else "LIMIT"
            entry_lvl = round(last_p * (0.9992 if setup_dir == "LONG" else 1.0008), price_dec)

            if sl_mode == "atr_volatility" or use_atr_sl:
                setup_sl_dist = max(last_p * 0.002, last_atr * float(atr_multiplier))
            elif sl_mode == "behind_wall":
                setup_sl_dist = max(last_p * 0.0025, abs(entry_lvl - (bid_wall_p if setup_dir == "LONG" else ask_wall_p)) + tick_sz * max(1, int(wall_sl_offset_ticks or 3)))
            else:
                setup_sl_dist = entry_lvl * (max(0.15, float(stop_loss_pct)) / 100.0)

            setup_tp1_dist = setup_sl_dist * max(1.0, float(tp1_rr_ratio or 1.5))
            setup_tp2_dist = max(setup_tp1_dist * 1.5, entry_lvl * (max(0.4, float(take_profit_pct)) / 100.0))
            rr_val = round(setup_tp2_dist / max(1e-9, setup_sl_dist), 2)

            if setup_dir == "LONG":
                sl_lvl = round(entry_lvl - setup_sl_dist, price_dec)
                tp1_lvl = round(entry_lvl + setup_tp1_dist, price_dec)
                tp2_lvl = round(entry_lvl + setup_tp2_dist, price_dec)
            else:
                sl_lvl = round(entry_lvl + setup_sl_dist, price_dec)
                tp1_lvl = round(entry_lvl - setup_tp1_dist, price_dec)
                tp2_lvl = round(entry_lvl - setup_tp2_dist, price_dec)

            sl_pct_val = round(abs(entry_lvl - sl_lvl) / max(1e-9, entry_lvl) * 100.0, 2)
            tp1_pct_val = round(abs(tp1_lvl - entry_lvl) / max(1e-9, entry_lvl) * 100.0, 2)
            tp2_pct_val = round(abs(tp2_lvl - entry_lvl) / max(1e-9, entry_lvl) * 100.0, 2)
            risk_usd_val = round(self.initial_capital * safe_lev * (sl_pct_val / 100.0), 1)

            active_position_setup = {
                "direction": setup_dir,
                "order_type": f"{'BUY' if setup_dir == 'LONG' else 'SELL'} {order_kind}",
                "entry_price": entry_lvl,
                "sl_price": sl_lvl,
                "sl_pct": sl_pct_val,
                "sl_risk_usd": risk_usd_val,
                "tp1_price": tp1_lvl,
                "tp1_pct": tp1_pct_val,
                "tp1_rr": round(float(tp1_rr_ratio or 1.5), 2),
                "tp2_price": tp2_lvl,
                "tp2_pct": tp2_pct_val,
                "rr_ratio": rr_val,
                "rr_label": f"1:{rr_val}",
                "sl_mode": sl_mode,
                "entry_mode": entry_mode or eff_strategy,
                "min_wall_lifetime_sec": wall_life_sec,
            }

        return {
            "strategy": eff_strategy,
            "initial_capital": self.initial_capital,
            "final_equity": round(capital, 2),
            "gross_final_equity": round(gross_capital, 2),
            "net_pnl": net_pnl,
            "roi_pct": roi_pct,
            "gross_pnl": gross_pnl,
            "gross_roi_pct": gross_roi_pct,
            "total_fees_usd": round(total_fees_usd, 2),
            "total_slippage_usd": round(total_slippage_usd, 2),
            "total_exchange_cost_usd": round(total_fees_usd + total_slippage_usd, 2),
            "recovery_factor": recovery_factor,
            "sharpe_ratio": sharpe_ratio,
            "sortino_ratio": sortino_ratio,
            "total_trades": total_trades,
            "wins_count": len(wins),
            "losses_count": len(losses),
            "win_rate_pct": win_rate,
            "profit_factor": profit_factor,
            "max_drawdown_pct": round(max_dd_pct, 2),
            "max_drawdown_usd": round(max_dd_usd, 2),
            "execution_config": {
                "maker_fee_pct": round(maker_rate * 100.0, 4),
                "taker_fee_pct": round(taker_rate * 100.0, 4),
                "slippage_ticks": slip_ticks,
                "use_multi_tp": bool(use_multi_tp),
                "tp1_pct": float(tp1_pct),
                "tp1_atr_mult": float(tp1_atr_mult),
                "entry_mode": entry_mode or eff_strategy,
                "sl_mode": sl_mode,
                "wall_sl_offset_ticks": int(wall_sl_offset_ticks or 3),
                "tp1_rr_ratio": float(tp1_rr_ratio or 1.5),
                "tp2_mode": tp2_mode,
                "min_wall_lifetime_sec": wall_life_sec,
            },
            "data_feed_context": data_feed_context,
            "active_position_setup": active_position_setup,
            "equity_curve": equity_curve,
            "trades": trades[-1000:],
            "confluence_matrix": confluence_matrix,
            "monte_carlo": monte_carlo,
        }

    @staticmethod
    def _calc_sharpe_sortino(equity_curve: List[Dict[str, Any]]) -> Tuple[float, float]:
        if not equity_curve or len(equity_curve) < 3:
            return 0.0, 0.0
        eq = np.array([float(p["equity"]) for p in equity_curve], dtype=float)
        denom = np.where(eq[:-1] <= 1e-9, 1.0, eq[:-1])
        rets = np.diff(eq) / denom
        if len(rets) < 2:
            return 0.0, 0.0
        mean_ret = float(np.mean(rets))
        std_ret = float(np.std(rets))
        sharpe = (mean_ret / std_ret * math.sqrt(len(rets))) if std_ret > 1e-12 else 0.0

        downside_sq = np.minimum(0.0, rets) ** 2
        downside_dev = math.sqrt(float(np.mean(downside_sq)))
        if downside_dev > 1e-9:
            sortino = mean_ret / downside_dev * math.sqrt(len(rets))
        else:
            sortino = sharpe * 1.35 if mean_ret > 0 else 0.0

        s_clean = max(-25.0, min(25.0, float(sharpe))) if math.isfinite(sharpe) else 0.0
        so_clean = max(-25.0, min(25.0, float(sortino))) if math.isfinite(sortino) else 0.0
        return round(s_clean, 2), round(so_clean, 2)

    def run_monte_carlo(
        self,
        trades: List[Dict[str, Any]],
        initial_capital: float = 10000.0,
        n_simulations: int = 500,
        actual_equity_curve: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        ТАКТ 3: Monte Carlo Stress-Test (500 Bootstrap & Permutation runs).
        Computes:
        - Probability of Drawdown > 10%
        - Expected Worst-Case Drawdown (95th / 99th percentile)
        - Median PnL (% and $)
        - Robustness Score & Verdict (Robust vs Overfitted)
        - Fan Chart data (p5, p25, p50, p75, p95 + sample paths) for visual rendering
        """
        n_sims = max(50, int(n_simulations))
        cap0 = max(100.0, float(initial_capital))

        if not trades:
            return {
                "simulations_count": n_sims,
                "prob_drawdown_gt_10_pct": 0.0,
                "worst_case_dd_pct": 0.0,
                "median_pnl_pct": 0.0,
                "median_pnl_usd": 0.0,
                "p5_pnl_pct": 0.0,
                "p95_pnl_pct": 0.0,
                "randomized_win_rate_p10_pct": 0.0,
                "randomized_win_rate_median_pct": 0.0,
                "robustness_score": 0,
                "verdict": "OVERFITTED",
                "badge_text": "⚠️ Риск переподгонки (Overfitted)",
                "reason": "Недостаточно сделок для подтверждения статистической устойчивости.",
                "fan_chart": [],
                "sample_paths": [],
            }

        pnl_usd_arr = np.array([float(t.get("pnl_usd", 0.0)) for t in trades], dtype=float)
        n_trades = len(pnl_usd_arr)
        rng = np.random.default_rng(42)

        # Generate 500 trajectories:
        # Half exact permutations (order stress-test for path drawdown) +
        # Half bootstrap resampling with replacement (for WinRate & PnL distribution stress-test)
        n_perm = n_sims // 2
        n_boot = n_sims - n_perm

        sim_equities = np.zeros((n_sims, n_trades + 1), dtype=float)
        sim_equities[:, 0] = cap0
        sim_win_rates = np.zeros(n_sims, dtype=float)
        sim_max_dds = np.zeros(n_sims, dtype=float)

        for s in range(n_sims):
            if s < n_perm:
                sampled = rng.permutation(pnl_usd_arr)
            else:
                idx = rng.integers(0, n_trades, size=n_trades)
                sampled = pnl_usd_arr[idx]

            eq_path = cap0 + np.cumsum(sampled)
            eq_path = np.maximum(100.0, eq_path)
            sim_equities[s, 1:] = eq_path

            wins_s = int(np.sum(sampled > 0))
            sim_win_rates[s] = (wins_s / max(1, n_trades)) * 100.0

            # Compute Max Drawdown (%) of this trajectory
            full_path = sim_equities[s]
            peaks = np.maximum.accumulate(full_path)
            dds = np.where(peaks > 0, (peaks - full_path) / peaks * 100.0, 0.0)
            sim_max_dds[s] = float(np.max(dds))

        final_pnls_usd = sim_equities[:, -1] - cap0
        final_pnls_pct = (final_pnls_usd / cap0) * 100.0

        prob_dd_gt_10 = float(np.mean(sim_max_dds > 10.0) * 100.0)
        worst_case_dd = float(np.percentile(sim_max_dds, 95))
        median_pnl_pct = float(np.median(final_pnls_pct))
        median_pnl_usd = float(np.median(final_pnls_usd))
        p5_pnl_pct = float(np.percentile(final_pnls_pct, 5))
        p95_pnl_pct = float(np.percentile(final_pnls_pct, 95))
        wr_p10 = float(np.percentile(sim_win_rates, 10))
        wr_median = float(np.median(sim_win_rates))

        # Check outlier dependency: does removing top 2 winning trades destroy profitability?
        sorted_pnls = np.sort(pnl_usd_arr)
        pnl_without_top2 = float(np.sum(sorted_pnls[:-2])) if n_trades > 2 else -1.0
        total_actual_pnl = float(np.sum(pnl_usd_arr))
        outlier_dependent = (total_actual_pnl <= 0) or (n_trades <= 3) or (n_trades >= 5 and pnl_without_top2 < 0 and total_actual_pnl > 0)

        # ТАКТ 3.2: Verdict logic
        # Robust if randomized winrate stays >= 50% (or median WR >= 50% and not dependent on 1-2 outlier trades)
        is_robust = (wr_median >= 50.0 and wr_p10 >= 45.0 and not outlier_dependent and median_pnl_pct > 0)
        if is_robust:
            verdict = "ROBUST"
            badge_text = "✅ Устойчива к рынку (Robust)"
            score = min(98, max(72, int(65 + (wr_median - 50.0) * 1.1 + min(15.0, median_pnl_pct) - prob_dd_gt_10 * 0.2)))
            reason = (
                f"При 500 перестановках Монте-Карло медианный WinRate держится на уровне {wr_median:.1f}% "
                f"(нижний квантиль {wr_p10:.1f}%), а прибыль сохраняется даже без топ-2 сделок."
            )
        else:
            verdict = "OVERFITTED"
            badge_text = "⚠️ Риск переподгонки (Overfitted)"
            score = max(18, min(58, int(45 + (wr_median - 50.0) * 0.8 - (15 if outlier_dependent else 0))))
            if outlier_dependent and total_actual_pnl > 0:
                reason = "Результат стратегии критически зависит от 1–2 случайных прибыльных сделок или малой выборки."
            else:
                reason = (
                    f"При рандомизации сделок WinRate опускается до {wr_p10:.1f}% (медиана {wr_median:.1f}%), "
                    f"ожидаемый Worst-Case DD достигает -{worst_case_dd:.1f}%."
                )

        # Build Fan Chart points (up to 30 steps along trade index)
        step_indices = np.linspace(0, n_trades, num=min(n_trades + 1, 30), dtype=int)
        step_indices = np.unique(step_indices)

        actual_eq_step = cap0 + np.concatenate(([0.0], np.cumsum(pnl_usd_arr)))
        gross_pnl_arr = np.array([float(t.get("gross_pnl_usd", t.get("pnl_usd", 0.0))) for t in trades], dtype=float)
        gross_eq_step = cap0 + np.concatenate(([0.0], np.cumsum(gross_pnl_arr)))

        fan_chart = []
        for idx in step_indices:
            col = sim_equities[:, idx]
            fan_chart.append({
                "step": int(idx),
                "actual": round(float(actual_eq_step[idx]), 2),
                "gross": round(float(gross_eq_step[idx]), 2),
                "p5": round(float(np.percentile(col, 5)), 2),
                "p25": round(float(np.percentile(col, 25)), 2),
                "p50": round(float(np.percentile(col, 50)), 2),
                "p75": round(float(np.percentile(col, 75)), 2),
                "p95": round(float(np.percentile(col, 95)), 2),
            })

        sample_paths = []
        for s_idx in range(min(10, n_sims)):
            sample_paths.append([round(float(sim_equities[s_idx, idx]), 2) for idx in step_indices])

        return {
            "simulations_count": n_sims,
            "prob_drawdown_gt_10_pct": round(prob_dd_gt_10, 1),
            "worst_case_dd_pct": round(worst_case_dd, 2),
            "median_pnl_pct": round(median_pnl_pct, 2),
            "median_pnl_usd": round(median_pnl_usd, 2),
            "p5_pnl_pct": round(p5_pnl_pct, 2),
            "p95_pnl_pct": round(p95_pnl_pct, 2),
            "randomized_win_rate_p10_pct": round(wr_p10, 1),
            "randomized_win_rate_median_pct": round(wr_median, 1),
            "robustness_score": int(score),
            "verdict": verdict,
            "badge_text": badge_text,
            "reason": reason,
            "fan_chart": fan_chart,
            "sample_paths": sample_paths,
        }

    def run_genetic_optimization(
        self,
        df: pd.DataFrame,
        strategy_type: str = "delta_absorption",
        sl_range: Tuple[float, float] = (0.2, 1.2),
        tp_range: Tuple[float, float] = (0.5, 3.0),
        wall_range_usd: Tuple[float, float] = (300000.0, 3000000.0),
        leverage: float = 2.0,
        volume_multiplier: float = 1.0,
        maker_fee_pct: float = 0.02,
        taker_fee_pct: float = 0.05,
        slippage_ticks: int = 2,
        use_multi_tp: bool = True,
        baseline_params: Optional[Dict[str, Any]] = None,
        population_size: int = 14,
        generations: int = 5,
        oos_ratio: float = 0.30,
        min_oos_candles: int = 100,
    ) -> Dict[str, Any]:
        """
        ТАКТ 2: Fast Heuristic Genetic / Bayesian Optimizer (50-100 evaluations in < 3 seconds).
        Optimizes:
        - stop_loss_pct (0.2% - 1.2%)
        - take_profit_pct (0.5% - 3.0%)
        - min_density_usd ($300k - $3M)
        - use_cvd_filter (CVD delta slope filter)
        - atr_period (7 - 21)
        Fitness Function:
        - Maximizes Sharpe & Sortino Ratio with strict penalty for Max Drawdown > 5%
        """
        t0 = time.perf_counter()
        rng = random.Random(42)

        # The outer chronological holdout is excluded from both genome search
        # and walk-forward scoring; it is inspected only after selection.
        ratio = min(0.5, max(0.1, float(oos_ratio)))
        split_idx = int(len(df) * (1.0 - ratio))
        train_df = df.iloc[:split_idx].reset_index(drop=True)
        oos_df = df.iloc[split_idx:].reset_index(drop=True)
        oos_warning: Optional[str] = None
        if len(train_df) < 100 or len(oos_df) < max(100, int(min_oos_candles)):
            oos_warning = (
                f"Недостаточно данных для финального holdout: train={len(train_df)}, "
                f"oos={len(oos_df)}, требуется минимум 100 свечей train и "
                f"{max(100, int(min_oos_candles))} holdout-свечей."
            )

        sl_lo, sl_hi = min(sl_range), max(sl_range)
        tp_lo, tp_hi = min(tp_range), max(tp_range)
        w_lo, w_hi = min(wall_range_usd), max(wall_range_usd)

        # Precompute indicator dataframes for candidate (atr_period, cvd_ema_period) pairs for sub-second speed
        atr_choices = [10, 14, 18, 21]
        cvd_choices = [10, 14, 20]
        df_cache: Dict[Tuple[int, int], pd.DataFrame] = {}
        for ap in atr_choices:
            for cp in cvd_choices:
                df_cache[(ap, cp)] = self.calculate_indicators(train_df, atr_period=ap, cvd_ema_period=cp)
        fold_bounds = [
            (int(len(train_df) * 0.25), int(len(train_df) * 0.40)),
            (int(len(train_df) * 0.40), int(len(train_df) * 0.55)),
            (int(len(train_df) * 0.55), int(len(train_df) * 0.70)),
        ]

        # 1. Evaluate Baseline ("Before Optimization")
        base_cfg = baseline_params or {}
        base_sl = float(base_cfg.get("stop_loss_pct", 0.8))
        base_tp = float(base_cfg.get("take_profit_pct", 1.5))
        base_wall = float(base_cfg.get("min_density_usd", 300000.0))
        base_cvd = bool(base_cfg.get("use_cvd_filter", False))
        base_atr_p = int(base_cfg.get("atr_period", 14))
        base_atr_filter = bool(base_cfg.get("use_atr_filter", False))
        base_oi_filter = bool(base_cfg.get("use_oi_filter", False))
        base_rsi_filter = bool(base_cfg.get("use_rsi_filter", False))
        risk_per_trade_pct = base_cfg.get("risk_per_trade_pct")
        base_atr_sl = bool(base_cfg.get("use_atr_sl", False))
        base_atr_multiplier = float(base_cfg.get("atr_multiplier", 1.5))
        use_trailing = bool(base_cfg.get("use_trailing", True))
        trailing_pct = float(base_cfg.get("trailing_pct", 0.5))
        use_dynamic_breakeven = bool(base_cfg.get("use_dynamic_breakeven", False))
        dynamic_be_trigger_r = float(base_cfg.get("dynamic_be_trigger_r", 0.5))
        tp1_pct = float(base_cfg.get("tp1_pct", 0.6))
        tp1_atr_mult = float(base_cfg.get("tp1_atr_mult", 1.5))

        baseline_fold_raw = []
        baseline_fold_df = df_cache.get((base_atr_p, 14), df_cache[(14, 14)])
        for fold_start, fold_end in fold_bounds:
            if fold_end <= fold_start:
                continue
            baseline_fold_raw.append(self.run_backtest(
                baseline_fold_df.iloc[fold_start:fold_end].reset_index(drop=True),
                strategy_type=strategy_type,
                take_profit_pct=base_tp,
                stop_loss_pct=base_sl,
                use_trailing=use_trailing,
                trailing_pct=trailing_pct,
                leverage=leverage,
                volume_multiplier=volume_multiplier,
                min_density_usd=base_wall,
                use_cvd_filter=base_cvd,
                use_atr_filter=base_atr_filter,
                use_atr_sl=base_atr_sl,
                atr_multiplier=base_atr_multiplier,
                use_oi_filter=base_oi_filter,
                use_rsi_filter=base_rsi_filter,
                maker_fee_pct=maker_fee_pct,
                taker_fee_pct=taker_fee_pct,
                slippage_ticks=slippage_ticks,
                use_multi_tp=use_multi_tp,
                tp1_pct=tp1_pct,
                tp1_atr_mult=tp1_atr_mult,
                atr_period=base_atr_p,
                compute_monte_carlo=False,
                fast_eval=True,
                risk_per_trade_pct=risk_per_trade_pct,
                use_dynamic_breakeven=use_dynamic_breakeven,
                dynamic_be_trigger_r=dynamic_be_trigger_r,
            ))
        baseline_wf_raw = {
            "total_trades": sum(int(item.get("total_trades", 0)) for item in baseline_fold_raw),
            "net_pnl": sum(float(item.get("net_pnl", 0.0)) for item in baseline_fold_raw),
            "gross_pnl": sum(float(item.get("gross_pnl", 0.0)) for item in baseline_fold_raw),
            "total_fees_usd": sum(float(item.get("total_fees_usd", 0.0)) for item in baseline_fold_raw),
            "total_slippage_usd": sum(float(item.get("total_slippage_usd", 0.0)) for item in baseline_fold_raw),
        }
        for key in ("roi_pct", "win_rate_pct", "profit_factor", "max_drawdown_pct", "recovery_factor", "sharpe_ratio", "sortino_ratio"):
            baseline_wf_raw[key] = float(np.mean([float(item.get(key, 0.0) or 0.0) for item in baseline_fold_raw])) if baseline_fold_raw else 0.0
        baseline_wf_raw["wins_count"] = sum(int(item.get("wins_count", 0)) for item in baseline_fold_raw)
        baseline_wf_raw["losses_count"] = sum(int(item.get("losses_count", 0)) for item in baseline_fold_raw)

        evaluated_cache: Dict[Tuple[Any, ...], Dict[str, Any]] = {}
        all_rows: List[Dict[str, Any]] = []
        best_raw: Optional[Dict[str, Any]] = None
        best_row: Optional[Dict[str, Any]] = None
        best_fitness = -1e18

        def random_genome() -> Dict[str, Any]:
            sl = round(rng.uniform(sl_lo, sl_hi) / 0.05) * 0.05
            tp = round(rng.uniform(tp_lo, tp_hi) / 0.1) * 0.1
            wall = round(rng.uniform(w_lo, w_hi) / 50000.0) * 50000.0
            return {
                "stop_loss_pct": round(max(0.15, min(2.5, sl)), 2),
                "take_profit_pct": round(max(0.4, min(5.0, tp)), 2),
                "min_density_usd": round(max(0.0, wall), 0),
                "use_cvd_filter": rng.choice([True, False]),
                "atr_period": rng.choice(atr_choices),
                "cvd_ema_period": rng.choice(cvd_choices),
            }

        def evaluate_genome(g: Dict[str, Any], gen_idx: int) -> Dict[str, Any]:
            nonlocal best_raw, best_row, best_fitness
            key = (
                g["stop_loss_pct"],
                g["take_profit_pct"],
                g["min_density_usd"],
                g["use_cvd_filter"],
                g["atr_period"],
                g["cvd_ema_period"],
            )
            if key in evaluated_cache:
                return evaluated_cache[key]

            cached_df = df_cache.get((g["atr_period"], g["cvd_ema_period"]), df_cache[(14, 14)])
            # Three expanding development windows: validation windows advance
            # in time and never overlap the final holdout.
            fold_results: List[Dict[str, Any]] = []
            enriched_dev = cached_df
            for fold_start, fold_end in fold_bounds:
                if fold_end <= fold_start:
                    continue
                fold_df = enriched_dev.iloc[fold_start:fold_end].reset_index(drop=True)
                fold_raw = self.run_backtest(
                    fold_df,
                    strategy_type=strategy_type,
                    take_profit_pct=g["take_profit_pct"],
                    stop_loss_pct=g["stop_loss_pct"],
                    use_trailing=use_trailing,
                    trailing_pct=trailing_pct,
                    leverage=leverage,
                    volume_multiplier=volume_multiplier,
                    min_density_usd=g["min_density_usd"],
                    use_cvd_filter=g["use_cvd_filter"],
                    use_atr_filter=base_atr_filter,
                    use_atr_sl=base_atr_sl,
                    atr_multiplier=base_atr_multiplier,
                    use_oi_filter=base_oi_filter,
                    use_rsi_filter=base_rsi_filter,
                    maker_fee_pct=maker_fee_pct,
                    taker_fee_pct=taker_fee_pct,
                    slippage_ticks=slippage_ticks,
                    use_multi_tp=use_multi_tp,
                    tp1_pct=tp1_pct,
                    tp1_atr_mult=tp1_atr_mult,
                    atr_period=g["atr_period"],
                    cvd_ema_period=g["cvd_ema_period"],
                    compute_monte_carlo=False,
                    fast_eval=True,
                    risk_per_trade_pct=risk_per_trade_pct,
                    use_dynamic_breakeven=use_dynamic_breakeven,
                    dynamic_be_trigger_r=dynamic_be_trigger_r,
                )
                fold_results.append(fold_raw)

            def mean_metric(key: str) -> float:
                return float(np.mean([float(item.get(key, 0.0) or 0.0) for item in fold_results])) if fold_results else 0.0

            total_trades = sum(int(item.get("total_trades", 0)) for item in fold_results)
            sharpe = mean_metric("sharpe_ratio")
            sortino = mean_metric("sortino_ratio")
            pf = min(25.0, mean_metric("profit_factor"))
            pnl_pct = mean_metric("roi_pct")
            max_dd = mean_metric("max_drawdown_pct")
            wr = mean_metric("win_rate_pct")
            raw = {
                "total_trades": total_trades,
                "roi_pct": pnl_pct,
                "net_pnl": sum(float(item.get("net_pnl", 0.0)) for item in fold_results),
                "gross_pnl": sum(float(item.get("gross_pnl", 0.0)) for item in fold_results),
                "total_fees_usd": sum(float(item.get("total_fees_usd", 0.0)) for item in fold_results),
                "total_slippage_usd": sum(float(item.get("total_slippage_usd", 0.0)) for item in fold_results),
                "win_rate_pct": wr,
                "profit_factor": pf,
                "max_drawdown_pct": max_dd,
                "recovery_factor": mean_metric("recovery_factor"),
                "sharpe_ratio": sharpe,
                "sortino_ratio": sortino,
                "wins_count": sum(int(item.get("wins_count", 0)) for item in fold_results),
                "losses_count": sum(int(item.get("losses_count", 0)) for item in fold_results),
            }

            # Fitness Function: Maximize Sharpe & Sortino with strict penalty if Max Drawdown > 5%
            if total_trades == 0:
                fitness = -500.0
            else:
                dd_penalty = max(0.0, max_dd - 5.0) * 3.5
                trade_bonus = min(1.5, total_trades * 0.15)
                fitness = (0.55 * sharpe) + (0.45 * sortino) + (0.35 * pf) + (0.08 * pnl_pct) + trade_bonus - dd_penalty

            row = {
                "stop_loss_pct": g["stop_loss_pct"],
                "take_profit_pct": g["take_profit_pct"],
                "min_density_usd": g["min_density_usd"],
                "use_cvd_filter": g["use_cvd_filter"],
                "atr_period": g["atr_period"],
                "cvd_ema_period": g["cvd_ema_period"],
                "volume_multiplier": volume_multiplier,
                "leverage": leverage,
                "total_pnl_pct": round(pnl_pct, 2),
                "net_pnl_usd": round(float(raw.get("net_pnl", 0.0)), 2),
                "gross_pnl_usd": round(float(raw.get("gross_pnl", 0.0)), 2),
                "total_fees_usd": round(float(raw.get("total_fees_usd", 0.0)), 2),
                "total_slippage_usd": round(float(raw.get("total_slippage_usd", 0.0)), 2),
                "win_rate_pct": round(wr, 2),
                "profit_factor": round(float(raw.get("profit_factor", 0.0)), 2),
                "max_drawdown_pct": round(max_dd, 2),
                "recovery_factor": round(float(raw.get("recovery_factor", 0.0)), 2),
                "total_trades": total_trades,
                "winning_trades": int(raw.get("wins_count", 0)),
                "losing_trades": int(raw.get("losses_count", 0)),
                "sharpe_ratio": round(sharpe, 2),
                "sortino_ratio": round(sortino, 2),
                "fitness_score": round(fitness, 3),
                "generation": gen_idx,
                "walk_forward_fold_metrics": [
                    {
                        "train_from_time": int(train_df["timestamp"].iloc[0]),
                        "train_to_time": int(train_df["timestamp"].iloc[fold_bounds[i][0] - 1]),
                        "validation_from_time": int(train_df.iloc[fold_bounds[i][0]]["timestamp"]),
                        "validation_to_time": int(train_df.iloc[fold_bounds[i][1] - 1]["timestamp"]),
                        "candles": fold_bounds[i][1] - fold_bounds[i][0],
                        "total_trades": int(item.get("total_trades", 0)),
                        "net_pnl_usd": round(float(item.get("net_pnl", 0.0)), 2),
                        "total_fees_usd": round(float(item.get("total_fees_usd", 0.0)), 2),
                        "total_slippage_usd": round(float(item.get("total_slippage_usd", 0.0)), 2),
                        "win_rate_pct": round(float(item.get("win_rate_pct", 0.0)), 2),
                        "profit_factor": round(float(item.get("profit_factor", 0.0)), 2),
                        "max_drawdown_pct": round(float(item.get("max_drawdown_pct", 0.0)), 2),
                    }
                    for i, item in enumerate(fold_results)
                ],
            }
            evaluated_cache[key] = row
            all_rows.append(row)

            if best_raw is None or fitness > best_fitness:
                best_fitness = fitness
                best_raw = raw
                best_row = row

            return row

        # Seed initial population (include smart anchors + random genomes)
        population: List[Dict[str, Any]] = [
            {
                "stop_loss_pct": round(max(sl_lo, min(sl_hi, 0.4)), 2),
                "take_profit_pct": round(max(tp_lo, min(tp_hi, 1.5)), 2),
                "min_density_usd": round(w_lo, 0),
                "use_cvd_filter": True,
                "atr_period": 14,
                "cvd_ema_period": 14,
            },
            {
                "stop_loss_pct": round(max(sl_lo, min(sl_hi, 0.6)), 2),
                "take_profit_pct": round(max(tp_lo, min(tp_hi, 1.8)), 2),
                "min_density_usd": round((w_lo + w_hi) * 0.35, 0),
                "use_cvd_filter": False,
                "atr_period": 10,
                "cvd_ema_period": 14,
            },
            {
                "stop_loss_pct": round(max(sl_lo, min(sl_hi, 0.3)), 2),
                "take_profit_pct": round(max(tp_lo, min(tp_hi, 1.2)), 2),
                "min_density_usd": round(w_lo, 0),
                "use_cvd_filter": False,
                "atr_period": 14,
                "cvd_ema_period": 10,
            },
        ]
        while len(population) < population_size:
            population.append(random_genome())

        for gen in range(1, generations + 1):
            scored = [evaluate_genome(ind, gen) for ind in population]
            scored.sort(key=lambda r: r["fitness_score"], reverse=True)
            elites = scored[: max(3, population_size // 3)]

            if gen == generations:
                break

            next_pop: List[Dict[str, Any]] = []
            # Keep top 2 elites unchanged (Elitism)
            for el in elites[:2]:
                next_pop.append({
                    "stop_loss_pct": el["stop_loss_pct"],
                    "take_profit_pct": el["take_profit_pct"],
                    "min_density_usd": el["min_density_usd"],
                    "use_cvd_filter": el["use_cvd_filter"],
                    "atr_period": el["atr_period"],
                    "cvd_ema_period": el["cvd_ema_period"],
                })

            # Crossover + Mutation to fill the rest of the generation
            while len(next_pop) < population_size:
                p1 = rng.choice(elites)
                p2 = rng.choice(elites)
                child = {
                    "stop_loss_pct": p1["stop_loss_pct"] if rng.random() < 0.5 else p2["stop_loss_pct"],
                    "take_profit_pct": p1["take_profit_pct"] if rng.random() < 0.5 else p2["take_profit_pct"],
                    "min_density_usd": p1["min_density_usd"] if rng.random() < 0.5 else p2["min_density_usd"],
                    "use_cvd_filter": p1["use_cvd_filter"] if rng.random() < 0.5 else p2["use_cvd_filter"],
                    "atr_period": p1["atr_period"] if rng.random() < 0.5 else p2["atr_period"],
                    "cvd_ema_period": p1["cvd_ema_period"] if rng.random() < 0.5 else p2["cvd_ema_period"],
                }
                # Gaussian / Discrete Mutation
                if rng.random() < 0.65:
                    child["stop_loss_pct"] = round(
                        max(sl_lo, min(sl_hi, child["stop_loss_pct"] + rng.choice([-0.15, -0.1, -0.05, 0.05, 0.1, 0.15]))),
                        2,
                    )
                if rng.random() < 0.65:
                    child["take_profit_pct"] = round(
                        max(tp_lo, min(tp_hi, child["take_profit_pct"] + rng.choice([-0.4, -0.2, 0.2, 0.4, 0.6]))),
                        2,
                    )
                if rng.random() < 0.55:
                    child["min_density_usd"] = round(
                        max(w_lo, min(w_hi, child["min_density_usd"] + rng.choice([-250000, -100000, 100000, 250000, 500000]))),
                        0,
                    )
                if rng.random() < 0.3:
                    child["use_cvd_filter"] = not child["use_cvd_filter"]
                if rng.random() < 0.3:
                    child["atr_period"] = rng.choice(atr_choices)
                next_pop.append(child)

            population = next_pop

        # Sort all unique evaluated genomes by fitness_score, profit_factor, and sharpe_ratio
        all_rows.sort(
            key=lambda r: (
                1 if r["total_trades"] > 0 else 0,
                r["fitness_score"],
                r["profit_factor"],
                r["sharpe_ratio"],
                r["total_pnl_pct"],
            ),
            reverse=True,
        )
        for idx, r in enumerate(all_rows, start=1):
            r["rank"] = idx

        # Run full backtest + Monte Carlo on the winning genome
        if best_row is not None:
            win_df = df_cache.get((best_row["atr_period"], best_row["cvd_ema_period"]), df_cache[(14, 14)])
            best_raw = self.run_backtest(
                win_df,
                strategy_type=strategy_type,
                take_profit_pct=best_row["take_profit_pct"],
                stop_loss_pct=best_row["stop_loss_pct"],
                use_trailing=use_trailing,
                trailing_pct=trailing_pct,
                leverage=leverage,
                volume_multiplier=volume_multiplier,
                min_density_usd=best_row["min_density_usd"],
                use_cvd_filter=best_row["use_cvd_filter"],
                use_atr_filter=base_atr_filter,
                use_atr_sl=base_atr_sl,
                atr_multiplier=base_atr_multiplier,
                use_oi_filter=base_oi_filter,
                use_rsi_filter=base_rsi_filter,
                maker_fee_pct=maker_fee_pct,
                taker_fee_pct=taker_fee_pct,
                slippage_ticks=slippage_ticks,
                use_multi_tp=use_multi_tp,
                tp1_pct=tp1_pct,
                tp1_atr_mult=tp1_atr_mult,
                atr_period=best_row["atr_period"],
                cvd_ema_period=best_row["cvd_ema_period"],
                compute_monte_carlo=True,
                fast_eval=False,
                risk_per_trade_pct=risk_per_trade_pct,
                use_dynamic_breakeven=use_dynamic_breakeven,
                dynamic_be_trigger_r=dynamic_be_trigger_r,
            )

        def metric_card(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
            raw = raw or {}
            return {
                "total_pnl_pct": round(float(raw.get("roi_pct", 0.0)), 2),
                "net_pnl_usd": round(float(raw.get("net_pnl", 0.0)), 2),
                "gross_pnl_usd": round(float(raw.get("gross_pnl", 0.0)), 2),
                "total_fees_usd": round(float(raw.get("total_fees_usd", 0.0)), 2),
                "total_slippage_usd": round(float(raw.get("total_slippage_usd", 0.0)), 2),
                "win_rate_pct": round(float(raw.get("win_rate_pct", 0.0)), 2),
                "profit_factor": round(float(raw.get("profit_factor", 0.0)), 2),
                "max_drawdown_pct": round(float(raw.get("max_drawdown_pct", 0.0)), 2),
                "recovery_factor": round(float(raw.get("recovery_factor", 0.0)), 2),
                "sharpe_ratio": round(float(raw.get("sharpe_ratio", 0.0)), 2),
                "sortino_ratio": round(float(raw.get("sortino_ratio", 0.0)), 2),
                "total_trades": int(raw.get("total_trades", 0)),
            }

        oos_result: Dict[str, Any] = {
            "available": False,
            "evidence_status": "insufficient_evidence",
            "train_candles": len(train_df),
            "oos_candles": len(oos_df),
            "train_from_time": int(train_df["timestamp"].iloc[0]) if not train_df.empty and "timestamp" in train_df else None,
            "train_to_time": int(train_df["timestamp"].iloc[-1]) if not train_df.empty and "timestamp" in train_df else None,
            "oos_from_time": int(oos_df["timestamp"].iloc[0]) if not oos_df.empty and "timestamp" in oos_df else None,
            "oos_to_time": int(oos_df["timestamp"].iloc[-1]) if not oos_df.empty and "timestamp" in oos_df else None,
            "metrics": None,
            "baseline_metrics": None,
            "warning": oos_warning,
        }
        if not oos_warning and best_row is not None:
            oos_df_cache = self.calculate_indicators(
                df,
                atr_period=best_row["atr_period"],
                cvd_ema_period=best_row["cvd_ema_period"],
            ).iloc[split_idx:].reset_index(drop=True)
            oos_raw = self.run_backtest(
                oos_df_cache,
                strategy_type=strategy_type,
                take_profit_pct=best_row["take_profit_pct"],
                stop_loss_pct=best_row["stop_loss_pct"],
                use_trailing=use_trailing,
                trailing_pct=trailing_pct,
                leverage=leverage,
                volume_multiplier=volume_multiplier,
                min_density_usd=best_row["min_density_usd"],
                use_cvd_filter=best_row["use_cvd_filter"],
                use_atr_filter=base_atr_filter,
                use_atr_sl=base_atr_sl,
                atr_multiplier=base_atr_multiplier,
                use_oi_filter=base_oi_filter,
                use_rsi_filter=base_rsi_filter,
                maker_fee_pct=maker_fee_pct,
                taker_fee_pct=taker_fee_pct,
                slippage_ticks=slippage_ticks,
                use_multi_tp=use_multi_tp,
                tp1_pct=tp1_pct,
                tp1_atr_mult=tp1_atr_mult,
                atr_period=best_row["atr_period"],
                cvd_ema_period=best_row["cvd_ema_period"],
                compute_monte_carlo=False,
                fast_eval=False,
                risk_per_trade_pct=risk_per_trade_pct,
                use_dynamic_breakeven=use_dynamic_breakeven,
                dynamic_be_trigger_r=dynamic_be_trigger_r,
            )
            baseline_oos_cache = self.calculate_indicators(
                df, atr_period=base_atr_p, cvd_ema_period=14
            ).iloc[split_idx:].reset_index(drop=True)
            baseline_oos_raw = self.run_backtest(
                baseline_oos_cache,
                strategy_type=strategy_type,
                take_profit_pct=base_tp,
                stop_loss_pct=base_sl,
                use_trailing=use_trailing,
                trailing_pct=trailing_pct,
                leverage=leverage,
                volume_multiplier=volume_multiplier,
                min_density_usd=base_wall,
                use_cvd_filter=base_cvd,
                use_atr_filter=base_atr_filter,
                use_atr_sl=base_atr_sl,
                atr_multiplier=base_atr_multiplier,
                use_oi_filter=base_oi_filter,
                use_rsi_filter=base_rsi_filter,
                maker_fee_pct=maker_fee_pct,
                taker_fee_pct=taker_fee_pct,
                slippage_ticks=slippage_ticks,
                use_multi_tp=use_multi_tp,
                tp1_pct=tp1_pct,
                tp1_atr_mult=tp1_atr_mult,
                atr_period=base_atr_p,
                compute_monte_carlo=False,
                fast_eval=False,
                risk_per_trade_pct=risk_per_trade_pct,
                use_dynamic_breakeven=use_dynamic_breakeven,
                dynamic_be_trigger_r=dynamic_be_trigger_r,
            )
            oos_result["baseline_trade_count"] = int(baseline_oos_raw.get("total_trades", 0))
            oos_trade_count = int(oos_raw.get("total_trades", 0))
            if oos_trade_count >= 20:
                oos_result["available"] = True
                oos_result["evidence_status"] = "sufficient_evidence"
                oos_result["metrics"] = metric_card(oos_raw)
                if int(baseline_oos_raw.get("total_trades", 0)) >= 20:
                    oos_result["baseline_metrics"] = metric_card(baseline_oos_raw)
            else:
                oos_result["warning"] = (
                    f"Недостаточно закрытых сделок в holdout: {oos_trade_count} < 20 "
                    f"при {len(oos_df)} свечах. Метрики не считаются подтверждёнными."
                )
            oos_result["trade_count"] = oos_trade_count
        oos_result["walk_forward_folds"] = (best_row or {}).get("walk_forward_fold_metrics", [])

        walk_forward_result = {
            "fold_count": len((best_row or {}).get("walk_forward_fold_metrics", [])),
            "folds": (best_row or {}).get("walk_forward_fold_metrics", []),
            "selection_basis": "mean chronological validation fitness across expanding development windows",
        }

        elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)

        before_card = {
            "stop_loss_pct": base_sl,
            "take_profit_pct": base_tp,
            "min_density_usd": base_wall,
            "use_cvd_filter": base_cvd,
            "atr_period": base_atr_p,
            "total_pnl_pct": round(float(baseline_wf_raw.get("roi_pct", 0.0)), 2),
            "net_pnl_usd": round(float(baseline_wf_raw.get("net_pnl", 0.0)), 2),
            "gross_pnl_usd": round(float(baseline_wf_raw.get("gross_pnl", 0.0)), 2),
            "total_fees_usd": round(float(baseline_wf_raw.get("total_fees_usd", 0.0)), 2),
            "total_slippage_usd": round(float(baseline_wf_raw.get("total_slippage_usd", 0.0)), 2),
            "win_rate_pct": round(float(baseline_wf_raw.get("win_rate_pct", 0.0)), 2),
            "profit_factor": round(float(baseline_wf_raw.get("profit_factor", 0.0)), 2),
            "max_drawdown_pct": round(float(baseline_wf_raw.get("max_drawdown_pct", 0.0)), 2),
            "recovery_factor": round(float(baseline_wf_raw.get("recovery_factor", 0.0)), 2),
            "sharpe_ratio": round(float(baseline_wf_raw.get("sharpe_ratio", 0.0)), 2),
            "sortino_ratio": round(float(baseline_wf_raw.get("sortino_ratio", 0.0)), 2),
            "total_trades": int(baseline_wf_raw.get("total_trades", 0)),
        }
        after_card = best_row or (all_rows[0] if all_rows else before_card)

        return {
            "rows": all_rows,
            "top_setups": all_rows[:5],
            "best_raw": best_raw,
            "best_params": after_card,
            "before_optimization": before_card,
            "after_optimization": after_card,
            "iterations_count": len(all_rows),
            "generations": generations,
            "elapsed_ms": elapsed_ms,
            "oos": oos_result,
            "walk_forward": walk_forward_result,
        }

    def calculate_confluence_matrix(self, trades: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Aggregates orderflow trades by context conditions (imbalances, POC, CVD, OI, walls)
        and computes WinRate, Profit Factor, sample size, and recommended filters.
        """
        if not trades:
            return []

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

            full_combo = f"{imb} + {cvd} + {oi}"
            record(full_combo, {"imbalance": imb, "cvd": cvd, "oi": oi, "poc": poc, "wall": wall}, t)
            record(f"{imb} + {wall}", {"imbalance": imb, "wall": wall}, t)
            record(f"{cvd} + {poc}", {"cvd": cvd, "poc": poc}, t)

            if div != "Без дивергенции":
                record(f"{div} + {oi}", {"divergence": div, "oi": oi}, t)
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
            if loss_sum > 1e-9:
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

        matrix.sort(
            key=lambda m: (
                1 if m["grade"] == "High Probability" else (0.5 if m["grade"] == "Moderate" else 0),
                m["win_rate_pct"],
                m["profit_factor"],
                m["total_trades"]
            ),
            reverse=True
        )
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
        """
        if df is None or df.empty or level_price <= 0:
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
        ts_vals = df['timestamp'].values

        n = len(df)
        touches = []
        last_touch_bar = -10

        for i in range(1, n - lookforward_bars):
            if i - last_touch_bar < 4:
                continue

            h = high_vals[i]
            l = low_vals[i]

            if l <= upper_band and h >= lower_band:
                prev_c = close_vals[i - 1]
                is_support_test = prev_c >= level_price
                touch_type = "Поддержка (LONG)" if is_support_test else "Сопротивление (SHORT)"

                forward_highs = high_vals[i + 1 : i + 1 + lookforward_bars]
                forward_lows = low_vals[i + 1 : i + 1 + lookforward_bars]

                if is_support_test:
                    max_rebound = (max(forward_highs) - level_price) / level_price * 100.0
                    max_penetration = (level_price - min(forward_lows)) / level_price * 100.0
                    is_bounce = max_rebound >= 0.7 and max_penetration <= (tolerance_pct * 1.6)
                    pnl_move = round(max_rebound if is_bounce else -max_penetration, 2)
                else:
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
