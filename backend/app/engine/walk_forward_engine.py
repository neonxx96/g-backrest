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
            flat_w = {c["name"]: round(1.0 / len(FLAT_CANDIDATES), 4) for c in FLAT_CANDIDATES}
            flat_type_w = {}
            for c in FLAT_CANDIDATES:
                flat_type_w[c["strategy_type"]] = round(flat_type_w.get(c["strategy_type"], 0.0) + flat_w[c["name"]], 4)
            return {
                **FLAT_CANDIDATES[0],
                "regime": regime.value,
                "is_trade_allowed": True,
                "uplift": 0.8,
                "win_rate": 55.0,
                "strategy_weights": flat_w,
                "strategy_type_weights": flat_type_w,
                "primary_strategy_name": FLAT_CANDIDATES[0]["name"],
                "source": "default_flat"
            }
        else:
            trend_w = {c["name"]: round(1.0 / len(TREND_CANDIDATES), 4) for c in TREND_CANDIDATES}
            trend_type_w = {}
            for c in TREND_CANDIDATES:
                trend_type_w[c["strategy_type"]] = round(trend_type_w.get(c["strategy_type"], 0.0) + trend_w[c["name"]], 4)
            return {
                **TREND_CANDIDATES[0],
                "regime": regime.value,
                "is_trade_allowed": True,
                "uplift": 1.2,
                "win_rate": 50.0,
                "strategy_weights": trend_w,
                "strategy_type_weights": trend_type_w,
                "primary_strategy_name": TREND_CANDIDATES[0]["name"],
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

            evaluations = []
            scores = []
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
                    trades = int(summary.get("total_trades", len(bt_res.get("trades", [])) if isinstance(bt_res, dict) else 0))
                    
                    rr = float(cand.get("take_profit_pct", 1.0)) / max(0.01, float(cand.get("stop_loss_pct", 0.5)))
                    uplift = (wr / 100.0) * rr

                    # Uplift with small bonus for positive total PnL
                    if pnl > 0:
                        uplift *= 1.25

                    score = max(0.001, uplift * max(0.1, 1.0 + (pnl / 100.0)))
                    scores.append(score)
                    evaluations.append({
                        "name": cand["name"],
                        "strategy_type": cand["strategy_type"],
                        "win_rate_pct": round(wr, 1),
                        "total_pnl_pct": round(pnl, 2),
                        "total_trades": trades,
                        "uplift": round(uplift, 3),
                        "score": round(score, 4),
                        "params": cand,
                    })
                except Exception as e:
                    logger.debug(f"[WalkForward] Evaluation error for {sym} {regime_val}: {e}")
                    scores.append(0.001)
                    evaluations.append({
                        "name": cand["name"],
                        "strategy_type": cand["strategy_type"],
                        "win_rate_pct": 0.0,
                        "total_pnl_pct": 0.0,
                        "total_trades": 0,
                        "uplift": 0.0,
                        "score": 0.001,
                        "params": cand,
                    })

            # Calculate normalized weights across candidate strategies
            total_score = sum(scores)
            weights = {}
            type_weights = {}
            for ev, sc in zip(evaluations, scores):
                norm_w = round(sc / total_score, 4) if total_score > 0 else round(1.0 / len(evaluations), 4)
                ev["weight"] = norm_w
                weights[ev["name"]] = norm_w
                st_type = ev["strategy_type"]
                type_weights[st_type] = round(type_weights.get(st_type, 0.0) + norm_w, 4)

            # Ensure sum of weights equals 1.0 exactly
            if weights:
                diff = round(1.0 - sum(weights.values()), 4)
                first_k = next(iter(weights.keys()))
                weights[first_k] = round(weights[first_k] + diff, 4)

            best_idx = int(np.argmax(scores))
            best_ev = evaluations[best_idx]
            best_cand = best_ev["params"]

            adapted_config = {
                **best_cand,
                "regime": regime_val,
                "is_trade_allowed": True,
                "uplift": best_ev["uplift"],
                "win_rate": best_ev["win_rate_pct"],
                "pnl_pct": best_ev["total_pnl_pct"],
                "sample_bars": len(regime_slice),
                "strategy_weights": weights,
                "strategy_type_weights": type_weights,
                "candidate_evaluations": evaluations,
                "primary_strategy_name": best_cand["name"],
                "updated_at": int(time.time() * 1000)
            }

            self.adapted_cache[(sym, regime_val)] = adapted_config
            results[regime_val] = adapted_config
            logger.info(
                f"[WalkForward] {sym} [{regime_val}] adapted to '{best_cand['name']}' "
                f"(Uplift: {adapted_config['uplift']:.2f}, WR: {best_ev['win_rate_pct']:.1f}%, PnL: {best_ev['total_pnl_pct']:+.2f}%)"
            )

        # TOXIC_VOLATILITY is strictly NO_TRADE
        self.adapted_cache[(sym, MarketRegime.TOXIC_VOLATILITY.value)] = {
            "regime": MarketRegime.TOXIC_VOLATILITY.value,
            "strategy_type": "none",
            "is_trade_allowed": False,
            "reason": "Токсичная волатильность: Торговые входы блокированы",
            "strategy_weights": {cand["name"]: 0.0 for cand in FLAT_CANDIDATES + TREND_CANDIDATES},
            "strategy_type_weights": {},
            "candidate_evaluations": [],
            "primary_strategy_name": "None",
            "updated_at": int(time.time() * 1000)
        }
        results[MarketRegime.TOXIC_VOLATILITY.value] = self.adapted_cache[(sym, MarketRegime.TOXIC_VOLATILITY.value)]

        self.last_adaptation_ts[sym] = int(time.time() * 1000)
        return results

    def get_strategy_weights(self, symbol: str, regime: MarketRegime) -> Dict[str, float]:
        """Returns normalized strategy weights for the specified symbol and market regime."""
        cfg = self.get_adapted_parameters(symbol, regime)
        return cfg.get("strategy_weights", {})

    def get_strategy_type_weights(self, symbol: str, regime: MarketRegime) -> Dict[str, float]:
        """Returns aggregated strategy type weights (e.g. confluence_ema, density_bounce)."""
        cfg = self.get_adapted_parameters(symbol, regime)
        return cfg.get("strategy_type_weights", {})

    def get_active_regime_and_weights(self, symbol: str, df: Optional[pd.DataFrame] = None) -> Dict[str, Any]:
        """
        Classifies current regime for symbol and returns the regime metrics along with
        optimized strategy weights and chosen primary parameters.
        """
        sym = symbol.strip().upper()
        if df is not None and not df.empty:
            regime, metrics = regime_classifier.classify_current(df)
        else:
            regime = MarketRegime.FLAT_DENSE
            metrics = {"regime": regime.value, "is_trade_allowed": True, "source": "default"}

        cfg = self.get_adapted_parameters(sym, regime)
        return {
            "symbol": sym,
            "regime": regime.value,
            "is_trade_allowed": cfg.get("is_trade_allowed", True),
            "primary_strategy_name": cfg.get("primary_strategy_name", cfg.get("name")),
            "strategy_type": cfg.get("strategy_type"),
            "strategy_weights": cfg.get("strategy_weights", {}),
            "strategy_type_weights": cfg.get("strategy_type_weights", {}),
            "uplift": cfg.get("uplift", 0.0),
            "win_rate": cfg.get("win_rate", 0.0),
            "take_profit_pct": cfg.get("take_profit_pct", 0.0),
            "stop_loss_pct": cfg.get("stop_loss_pct", 0.0),
            "metrics": metrics,
            "last_adapted_ts": self.last_adaptation_ts.get(sym, int(time.time() * 1000))
        }

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
