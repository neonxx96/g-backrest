"""
Walk-Forward Engine (Adaptive Brain)
====================================
Implements rolling In-Sample (72h) regime-segmented walk-forward adaptation:
1. Slices historical Parquet data into MarketRegime regimes using RegimeClassifier.
2. For each regime (FLAT_DENSE, TREND_IMPULSE), runs OrderFlowBacktester to find parameters
   maximizing Uplift = (WinRate / 100) * (TakeProfit / StopLoss).
3. If regime is TOXIC_VOLATILITY, enforces strict NO_TRADE gate.
4. Caches adapted parameters per (symbol, regime) for real-time execution in BackgroundWorker.
"""

import time
import logging
from typing import Dict, Any, List, Optional, Tuple
import pandas as pd
import numpy as np

from backend.app.services.historical_data_loader import historical_loader
from backend.app.services.orderflow_backtester import OrderFlowBacktester
from backend.app.engine.regime_classifier import MarketRegime, regime_classifier

logger = logging.getLogger("SignalScript.WalkForwardEngine")

# Institutional parameter search grids per regime
FLAT_CANDIDATES = [
    {
        "name": "Flat Micro-Scalp (Tight Bounds)",
        "strategy_type": "density_bounce",
        "take_profit_pct": 0.45,
        "stop_loss_pct": 0.25,
        "use_multi_tp": True,
        "tp1_rr_ratio": 1.4,
        "sl_mode": "fixed_pct",
        "use_cvd_filter": True,
        "use_atr_filter": True,
        "use_rsi_filter": True,
        "leverage": 2.0,
    },
    {
        "name": "Flat Dense Absorption",
        "strategy_type": "delta_absorption",
        "take_profit_pct": 0.65,
        "stop_loss_pct": 0.35,
        "use_multi_tp": True,
        "tp1_rr_ratio": 1.5,
        "sl_mode": "behind_wall",
        "wall_sl_offset_ticks": 3,
        "use_cvd_filter": True,
        "use_atr_filter": True,
        "use_rsi_filter": True,
        "leverage": 2.0,
    },
    {
        "name": "Flat Channel Mean-Reversion",
        "strategy_type": "confluence_ema",
        "take_profit_pct": 0.85,
        "stop_loss_pct": 0.45,
        "use_multi_tp": True,
        "tp1_rr_ratio": 1.5,
        "sl_mode": "fixed_pct",
        "use_cvd_filter": True,
        "use_atr_filter": True,
        "use_rsi_filter": True,
        "leverage": 2.0,
    },
]

TREND_CANDIDATES = [
    {
        "name": "Trend Momentum Breakout (1:2 R:R)",
        "strategy_type": "confluence_ema",
        "take_profit_pct": 1.6,
        "stop_loss_pct": 0.7,
        "use_multi_tp": True,
        "tp1_rr_ratio": 1.8,
        "sl_mode": "atr_volatility",
        "use_cvd_filter": True,
        "use_atr_filter": True,
        "use_rsi_filter": False,
        "leverage": 2.0,
    },
    {
        "name": "Trend Extension Impulse (1:2.5 R:R)",
        "strategy_type": "wall_breakout",
        "take_profit_pct": 2.2,
        "stop_loss_pct": 0.85,
        "use_multi_tp": True,
        "tp1_rr_ratio": 2.0,
        "sl_mode": "atr_volatility",
        "use_cvd_filter": True,
        "use_atr_filter": True,
        "use_rsi_filter": False,
        "leverage": 2.0,
    },
    {
        "name": "Trend Swing Expansion (1:3 R:R)",
        "strategy_type": "confluence_ema",
        "take_profit_pct": 3.0,
        "stop_loss_pct": 1.0,
        "use_multi_tp": True,
        "tp1_rr_ratio": 2.5,
        "sl_mode": "atr_volatility",
        "use_cvd_filter": True,
        "use_atr_filter": True,
        "use_rsi_filter": False,
        "leverage": 1.5,
    },
]


class WalkForwardEngine:
    """
    Manages Walk-Forward parameter adaptation segmented by market regimes.
    """

    def __init__(self):
        # Cache key: (symbol, regime) -> dict of optimal parameters & metrics
        self.adapted_cache: Dict[Tuple[str, str], Dict[str, Any]] = {}
        self.last_adaptation_ts: Dict[str, int] = {}

    def get_adapted_parameters(self, symbol: str, regime: MarketRegime) -> Dict[str, Any]:
        """
        Retrieves optimal parameters for the given (symbol, regime) pair.
        Returns strict NO_TRADE configuration if regime == TOXIC_VOLATILITY.
        """
        sym = symbol.strip().upper()
        if regime == MarketRegime.TOXIC_VOLATILITY:
            return {
                "regime": regime.value,
                "strategy_type": "none",
                "is_trade_allowed": False,
                "reason": "Токсичный рынок: Аномальный ATR при разреженном стакане (NO_TRADE)",
                "take_profit_pct": 0.0,
                "stop_loss_pct": 0.0,
                "leverage": 1.0
            }

        key = (sym, regime.value)
        if key in self.adapted_cache:
            return self.adapted_cache[key]

        # Robust defaults if adaptation hasn't run yet
        if regime == MarketRegime.FLAT_DENSE:
            return {
                **FLAT_CANDIDATES[0],
                "regime": regime.value,
                "is_trade_allowed": True,
                "uplift": 0.8,
                "win_rate": 55.0,
                "source": "default_flat"
            }
        else:
            return {
                **TREND_CANDIDATES[0],
                "regime": regime.value,
                "is_trade_allowed": True,
                "uplift": 1.2,
                "win_rate": 50.0,
                "source": "default_trend"
            }

    def is_trade_allowed(self, symbol: str, regime: MarketRegime) -> Tuple[bool, str]:
        """
        Quick check whether entries are permitted for symbol under current regime.
        """
        if regime == MarketRegime.TOXIC_VOLATILITY:
            return False, f"[{symbol}] TOXIC_VOLATILITY: Входы заблокированы из-за вакуума ликвидности"
        return True, "Trading allowed"

    async def train_walk_forward(self, symbol: str, hours: int = 72) -> Dict[str, Any]:
        """
        Runs Walk-Forward In-Sample adaptation across 72h historical data:
        1. Ingests 5m data.
        2. Vectorized regime classification of all bars.
        3. Backtests candidate parameter sets per regime to maximize Uplift = WinRate * R:R.
        4. Caches optimal parameters.
        """
        sym = symbol.strip().upper()
        days = max(1, int(np.ceil(hours / 24.0)))

        df = await historical_loader.load_dataset_async(
            symbol=sym,
            timeframe="5m",
            days=days,
            force_refresh=False
        )

        if df is None or len(df) < 50:
            logger.warning(f"[WalkForward] Insufficient candles for {sym} ({len(df) if df is not None else 0})")
            return {}

        # Classify all bars vectorially
        regimes_series = regime_classifier.classify_series(df)
        df_annotated = df.copy()
        df_annotated["regime"] = regimes_series

        results = {}
        backtester = OrderFlowBacktester(
            initial_capital=10000.0,
            maker_fee_pct=0.02,
            taker_fee_pct=0.05,
            slippage_ticks=2
        )

        # Optimize for FLAT_DENSE and TREND_IMPULSE
        for regime, candidates in [
            (MarketRegime.FLAT_DENSE, FLAT_CANDIDATES),
            (MarketRegime.TREND_IMPULSE, TREND_CANDIDATES),
        ]:
            regime_val = regime.value
            regime_slice = df_annotated[df_annotated["regime"] == regime_val]

            # If slice has enough continuous bars, run backtest on slice; otherwise on whole df with regime filter
            test_df = regime_slice if len(regime_slice) >= 40 else df_annotated

            best_cand = candidates[0]
            best_uplift = -1.0
            best_win_rate = 0.0
            best_pnl = 0.0

            for cand in candidates:
                kw = {k: v for k, v in cand.items() if k not in ("name",)}
                try:
                    bt_res = backtester.run_backtest(
                        df=test_df,
                        compute_monte_carlo=False,
                        fast_eval=True,
                        **kw
                    )
                    summary = bt_res.get("summary", {}) if isinstance(bt_res, dict) else {}
                    wr = float(summary.get("win_rate_pct", 0.0))
                    pnl = float(summary.get("total_pnl_pct", 0.0))
                    
                    rr = float(cand.get("take_profit_pct", 1.0)) / max(0.01, float(cand.get("stop_loss_pct", 0.5)))
                    uplift = (wr / 100.0) * rr

                    # Uplift with small bonus for positive total PnL
                    if pnl > 0:
                        uplift *= 1.25

                    if uplift > best_uplift:
                        best_uplift = uplift
                        best_win_rate = wr
                        best_pnl = pnl
                        best_cand = cand
                except Exception as e:
                    logger.debug(f"[WalkForward] Evaluation error for {sym} {regime_val}: {e}")

            adapted_config = {
                **best_cand,
                "regime": regime_val,
                "is_trade_allowed": True,
                "uplift": round(best_uplift, 3),
                "win_rate": round(best_win_rate, 1),
                "pnl_pct": round(best_pnl, 2),
                "sample_bars": len(regime_slice),
                "updated_at": int(time.time() * 1000)
            }

            self.adapted_cache[(sym, regime_val)] = adapted_config
            results[regime_val] = adapted_config
            logger.info(
                f"[WalkForward] {sym} [{regime_val}] adapted to '{best_cand['name']}' "
                f"(Uplift: {adapted_config['uplift']:.2f}, WR: {best_win_rate:.1f}%, PnL: {best_pnl:+.2f}%)"
            )

        # TOXIC_VOLATILITY is strictly NO_TRADE
        self.adapted_cache[(sym, MarketRegime.TOXIC_VOLATILITY.value)] = {
            "regime": MarketRegime.TOXIC_VOLATILITY.value,
            "strategy_type": "none",
            "is_trade_allowed": False,
            "reason": "Токсичная волатильность: Торговые входы блокированы",
            "updated_at": int(time.time() * 1000)
        }
        results[MarketRegime.TOXIC_VOLATILITY.value] = self.adapted_cache[(sym, MarketRegime.TOXIC_VOLATILITY.value)]

        self.last_adaptation_ts[sym] = int(time.time() * 1000)
        return results

    async def run_adaptation_pass(self, symbols: List[str]) -> Dict[str, Any]:
        """Runs adaptation for multiple coins."""
        all_results = {}
        for s in symbols:
            try:
                res = await self.train_walk_forward(s, hours=72)
                all_results[s] = res
            except Exception as e:
                logger.error(f"[WalkForward] Pass failed for {s}: {e}", exc_info=True)
        return all_results


# Singleton instance
walk_forward_engine = WalkForwardEngine()
