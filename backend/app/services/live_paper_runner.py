"""
Live Paper Trading Runner & Real-Time Strategy Sentinel
Subscribes to FreeBinanceCollector (Spot L2 Depth + Synthetic Liquidation Map),
detects order flow setups in real time (e.g. 'Вход перед стенкой $500k'),
executes virtual orders with commissions/slippage, maintains live equity curve,
and integrates OpenRouter AI Risk Control veto logic.
"""

import asyncio
import json
import logging
import time
from typing import Dict, Any, List, Optional
from datetime import datetime

from backend.app.services.market_data_factory import market_data_provider
from backend.app.services.quant_engine import quant_engine
from backend.app.services.openrouter_client import openrouter_client
from backend.app.services.paper_trading import paper_trading_session
from backend.app.engine.trade_contract import UnifiedTradeSignal

logger = logging.getLogger("SignalScript.LivePaperRunner")

# These profiles are evaluated from the same real OHLCV frame in historical
# backtest, forecast, and live paper mode. Keep the list explicit so a new
# diagnostic profile cannot silently stop at the live execution boundary.
PAPER_HISTORICAL_STRATEGIES = frozenset({
    "confluence_ema",
    "cvd_absorption",
    "cluster_volume_bounce",
    "diagnostics_lenient",
    "naked_test",
})


class LivePaperRunner:
    """
    Manages live paper trading execution loop over FreeBinanceCollector.
    """

    def __init__(self, session=None):
        self.session = session or paper_trading_session
        self.is_running: bool = False
        self._task: Optional[asyncio.Task] = None
        self._last_tick_time: int = 0
        self._last_signal_time: int = 0
        self._signal_cooldown_sec: int = 30  # Cooldown between opening signals on same coin

        # Configuration
        self.symbol: str = "BTCUSDT"
        self.timeframe: str = "15m"
        self.strategy_type: str = "live_density_bounce"
        self.initial_capital: float = 10000.0
        self.risk_per_trade_pct: float = 1.0  # 1% per trade
        self.min_density_usd: float = 500000.0  # e.g. $500k wall
        self.ai_control: bool = False
        self.stop_loss_pct: float = 0.8
        self.take_profit_pct: float = 1.6
        self.leverage: float = 2.0
        self.maker_fee_pct: float = 0.02
        self.taker_fee_pct: float = 0.05
        self.slippage_ticks: int = 2
        self.duration_hours: float = 24.0
        self.volume_multiplier: float = 1.3
        self.use_atr_filter: bool = False
        self.use_cvd_filter: bool = False
        self.use_oi_filter: bool = False
        self.use_rsi_filter: bool = False
        self.use_multi_tp: bool = True
        self.use_trailing: bool = True
        self.trailing_pct: float = 0.5
        self.tp1_rr_ratio: float = 1.5
        self.tp2_rr_ratio: float = 2.8
        self._last_funding_timestamp: int = 0
        self._last_funding_rate: float = 0.0
        self.started_at: float = 0.0
        self.data_status: str = "disconnected"
        self.last_data_error: Optional[str] = None
        self.data_error_count: int = 0
        self.no_trade_count: int = 0
        self.last_decision_reason: Optional[str] = None
        self.last_decision_checks: List[str] = []
        self.last_decision_at: int = 0
        self.indicator_data_status: str = "stale"
        self.indicator_last_update: int = 0
        self._indicator_context: Optional[Dict[str, Any]] = None
        self._indicator_context_at: float = 0.0
        self._last_rejection_signature: Optional[str] = None
        self._last_rejection_log_at: float = 0.0
        self._last_rejection_count_key: Optional[str] = None
        self.rejection_counts: Dict[str, int] = {}

        # Logs & Real-Time Equity Curve
        self.logs: List[Dict[str, Any]] = []
        self.equity_curve: List[Dict[str, Any]] = []

    def start(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Starts live paper trading runner with user configuration."""
        if self.is_running:
            self.stop()

        self.symbol = str(config.get("symbol", "BTCUSDT")).upper()
        self.timeframe = str(config.get("timeframe", "15m"))
        self.strategy_type = str(config.get("strategy_type", "live_density_bounce"))
        self.initial_capital = float(config.get("initial_capital", 10000.0))
        self.risk_per_trade_pct = float(config.get("risk_per_trade_pct", 1.0))
        self.min_density_usd = float(config.get("min_density_usd", 500000.0))
        self.ai_control = bool(config.get("ai_control", False))
        self.stop_loss_pct = float(config.get("stop_loss_pct", 0.8))
        self.take_profit_pct = float(config.get("take_profit_pct", 1.6))
        self.leverage = float(config.get("leverage", 2.0))
        self.maker_fee_pct = float(config.get("maker_fee_pct", 0.02))
        self.taker_fee_pct = float(config.get("taker_fee_pct", 0.05))
        self.slippage_ticks = int(config.get("slippage_ticks", 2))
        self.duration_hours = float(config.get("duration_hours", 24.0))
        self.volume_multiplier = float(config.get("volume_multiplier", 1.3))
        self.use_atr_filter = bool(config.get("use_atr_filter", False))
        self.use_cvd_filter = bool(config.get("use_cvd_filter", False))
        self.use_oi_filter = bool(config.get("use_oi_filter", False))
        self.use_rsi_filter = bool(config.get("use_rsi_filter", False))
        self.use_multi_tp = bool(config.get("use_multi_tp", True))
        self.use_trailing = bool(config.get("use_trailing", True))
        self.trailing_pct = float(config.get("trailing_pct", 0.5))
        self.tp1_rr_ratio = float(config.get("tp1_rr_ratio", 1.5))
        self.tp2_rr_ratio = float(config.get("tp2_rr_ratio", 2.8))
        self._last_funding_timestamp = 0
        self._last_funding_rate = 0.0
        self.started_at = time.time()
        self.data_status = "stale"
        self.last_data_error = None
        self.data_error_count = 0
        self.no_trade_count = 0
        self.last_decision_reason = None
        self.last_decision_checks = []
        self.last_decision_at = 0
        self.indicator_data_status = "stale"
        self.indicator_last_update = 0
        self._indicator_context = None
        self._indicator_context_at = 0.0
        self._last_rejection_signature = None
        self._last_rejection_log_at = 0.0
        self._last_rejection_count_key = None
        self.rejection_counts = {}

        # Reset wallet to initial capital
        self.session.reset_wallet(initial_balance=self.initial_capital)
        # UI/config values are percentages (1.0 = 1%); PaperTradingSession
        # stores the fraction used by its position-size formula.
        self.session.risk_per_trade_pct = self.risk_per_trade_pct / 100.0
        self.session.leverage = max(1.0, self.leverage)

        self.is_running = True
        self.logs = []
        self.equity_curve = [
            {
                "timestamp": int(time.time() * 1000),
                "time_str": datetime.now().strftime("%H:%M:%S"),
                "equity": self.initial_capital,
                "balance": self.initial_capital,
                "unrealized_pnl": 0.0,
                "event": "START",
            }
        ]

        self._add_log("SYSTEM", f"Симулятор Paper Trading запущен для {self.symbol} (${self.initial_capital:,.2f})")
        if self.ai_control:
            self._add_log("AI_COPILOT", "Режим «AI Контроль сделок» АКТИВЕН (OpenRouter Sentinel)")

        # Start background loop
        try:
            loop = asyncio.get_running_loop()
            self._task = loop.create_task(self._runner_loop())
        except RuntimeError:
            self._task = None
        return self.get_status()

    def stop(self) -> Dict[str, Any]:
        """Stops live paper trading runner."""
        self.is_running = False
        if self._task and not self._task.done():
            self._task.cancel()
            self._task = None
        self._add_log("SYSTEM", "Симулятор Paper Trading остановлен пользователем")
        return self.get_status()

    def _add_log(self, category: str, message: str, meta: Optional[Dict[str, Any]] = None):
        """Appends log entry with timestamp."""
        entry = {
            "timestamp": int(time.time() * 1000),
            "time_str": datetime.now().strftime("%H:%M:%S"),
            "category": category,
            "message": message,
            "meta": meta or {},
        }
        self.logs.insert(0, entry)
        if len(self.logs) > 100:
            self.logs = self.logs[:100]

    def _record_no_entry(self, diagnostic: Dict[str, Any]) -> None:
        """Publish a rate-limited, measured rejection trace for paper diagnostics."""
        rejections = list(diagnostic.get("rejections") or [])
        fragments: List[str] = []
        for item in rejections[:4]:
            name = item.get("filter", "strategy_conditions")
            actual = item.get("actual")
            operator = item.get("operator", "")
            threshold = item.get("threshold")
            if operator == ">=" and isinstance(actual, (int, float)) and isinstance(threshold, (int, float)):
                fragments.append(f"{name} ({actual:.2f} < {threshold:.2f})")
            elif operator == "<=" and isinstance(actual, (int, float)) and isinstance(threshold, (int, float)):
                fragments.append(f"{name} ({actual:.2f} > {threshold:.2f})")
            else:
                fragments.append(f"{name} ({actual} {operator} {threshold})")
        message = "Blocked by: " + ("; ".join(fragments) if fragments else diagnostic.get("reason", "strategy_conditions"))
        self.last_decision_checks = list(dict.fromkeys(diagnostic.get("failed_checks") or []))
        self.last_decision_reason = diagnostic.get("reason") or message
        self.last_decision_at = self._last_tick_time
        signature = json.dumps(rejections or self.last_decision_checks, sort_keys=True, ensure_ascii=False, default=str)
        count_key = f"{self.indicator_last_update}:{signature}"
        if count_key != self._last_rejection_count_key:
            for item in rejections:
                filter_name = str(item.get("filter") or "strategy_conditions")
                self.rejection_counts[filter_name] = self.rejection_counts.get(filter_name, 0) + 1
            self._last_rejection_count_key = count_key
        now = time.time()
        if signature != self._last_rejection_signature or now - self._last_rejection_log_at >= 30.0:
            self._add_log("NO_ENTRY", message, meta={"rejections": rejections, "observed": diagnostic.get("observed") or {}})
            logger.info("[%s] %s", self.symbol, message)
            self._last_rejection_signature = signature
            self._last_rejection_log_at = now

    def get_status(self) -> Dict[str, Any]:
        """Returns live status of runner, current wallet snapshot, and equity curve."""
        session_state = self.session.get_state()
        state_dict = session_state.to_dict()
        duration_remaining_seconds = None
        if self.duration_hours > 0 and self.started_at:
            duration_remaining_seconds = max(
                0,
                int(self.duration_hours * 3600 - (time.time() - self.started_at)),
            )

        total_equity = state_dict.get("balance", self.initial_capital) + state_dict.get("unrealized_pnl", 0.0)
        equity_values = [float(point.get("equity", self.initial_capital)) for point in self.equity_curve]
        peak_equity = self.initial_capital
        max_drawdown_pct = 0.0
        for value in equity_values:
            peak_equity = max(peak_equity, value)
            if peak_equity > 0:
                max_drawdown_pct = max(max_drawdown_pct, (peak_equity - value) / peak_equity * 100.0)
        closed_trades = state_dict.get("closed_trades", [])
        losing_trade_reasons = [
            {"exit_reason": trade.get("exit_reason", "UNKNOWN"), "net_pnl": trade.get("net_pnl", 0.0)}
            for trade in closed_trades
            if float(trade.get("net_pnl", 0.0) or 0.0) < 0
        ][-10:]

        return {
            "is_running": self.is_running,
            "symbol": self.symbol,
            "strategy_type": self.strategy_type,
            "timeframe": self.timeframe,
            "initial_capital": self.initial_capital,
            "risk_per_trade_pct": self.risk_per_trade_pct,
            "min_density_usd": self.min_density_usd,
            "ai_control": self.ai_control,
            "current_equity": round(total_equity, 2),
            "balance": round(state_dict.get("balance", self.initial_capital), 2),
            "available_margin": round(float(state_dict.get("available_margin", self.initial_capital) or 0.0), 4),
            "used_margin": round(float(state_dict.get("locked_margin", 0.0) or 0.0), 4),
            "unrealized_pnl": round(state_dict.get("unrealized_pnl", 0.0), 2),
            "realized_pnl": round(state_dict.get("realized_pnl", 0.0), 2),
            "roi_pct": round((total_equity - self.initial_capital) / max(self.initial_capital, 1e-9) * 100.0, 4),
            "max_drawdown_pct": round(max_drawdown_pct, 4),
            "total_fees": round(float(state_dict.get("total_fees_paid", 0.0) or 0.0), 4),
            "total_funding_paid": round(float(state_dict.get("total_funding_paid", 0.0) or 0.0), 4),
            "funding_rate": round(self._last_funding_rate, 8),
            "average_risk_pct": round(self.risk_per_trade_pct, 4),
            "losing_trade_reasons": losing_trade_reasons,
            "open_positions": state_dict.get("positions", []),
            "closed_trades_count": len(state_dict.get("closed_trades", [])),
            "closed_trades": state_dict.get("closed_trades", [])[-15:],
            "logs": self.logs[:25],
            "equity_curve": self.equity_curve[-80:],
            "last_tick_time": self._last_tick_time,
            "session_id": state_dict.get("session_id"),
            "data_status": self.data_status,
            "last_data_error": self.last_data_error,
            "data_error_count": self.data_error_count,
            "no_trade_count": self.no_trade_count,
            "rejection_counts": dict(sorted(self.rejection_counts.items(), key=lambda item: (-item[1], item[0]))),
            "last_decision_reason": self.last_decision_reason,
            "last_decision_checks": self.last_decision_checks,
            "last_decision_at": self.last_decision_at,
            "indicator_data_status": self.indicator_data_status,
            "indicator_last_update": self.indicator_last_update,
            "duration_hours": self.duration_hours,
            "started_at": int(self.started_at * 1000) if self.started_at else None,
            "duration_remaining_seconds": duration_remaining_seconds,
        }

    async def _runner_loop(self):
        """Main real-time observation and execution loop."""
        logger.info(f"LivePaperRunner started background loop for {self.symbol}")
        while self.is_running:
            try:
                if self.duration_hours > 0 and self.started_at and (time.time() - self.started_at) >= self.duration_hours * 3600:
                    self._add_log("SYSTEM", f"Paper-сессия автоматически остановлена после {self.duration_hours:g} ч")
                    self.stop()
                    break
                await self.tick_cycle()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in LivePaperRunner tick cycle: {e}")
                self.data_status = "disconnected"
                self.last_data_error = str(e)[:160]
                self.data_error_count += 1
                self._add_log("ERROR", f"Сбой цикла опроса: {str(e)[:80]}")

            await asyncio.sleep(4.0)

    async def tick_cycle(self):
        """Single tick cycle: queries FreeBinanceCollector, updates positions, checks for signals."""
        self._last_tick_time = int(time.time() * 1000)

        # 1. Fetch live unified market data (Spot L2 + Futures liqs + ticker)
        data = await market_data_provider.get_unified_data(self.symbol)
        self.data_status = "connected"
        self.last_data_error = None
        current_price = data.snapshot.price
        if current_price <= 0:
            return

        # Forward the actual Binance price and current L2 book into the shared
        # paper execution simulator before strategy/position decisions.
        self.session.process_market_tick(
            self.symbol,
            current_price,
            bids=data.orderbook_depth.bids,
            asks=data.orderbook_depth.asks,
            timestamp=self._last_tick_time,
        )
        now_ms = self._last_tick_time
        if self._last_funding_timestamp == 0:
            self._last_funding_timestamp = now_ms
        elif now_ms - self._last_funding_timestamp >= 8 * 60 * 60 * 1000:
            payment = self.session.apply_funding(self.symbol, float(data.snapshot.funding_rate), now_ms)
            self._add_log("FUNDING", f"Funding settlement: {payment:+.4f} USDT", meta={"funding_rate": float(data.snapshot.funding_rate), "payment": payment})
            self._last_funding_timestamp = now_ms
        self._last_funding_rate = float(data.snapshot.funding_rate)

        # 2. Update existing positions against current market price (SL / TP / Breakeven check)
        self._update_open_positions(current_price)

        # 3. Record equity curve point
        state = self.session.get_state().to_dict()
        equity = state.get("balance", self.initial_capital) + state.get("unrealized_pnl", 0.0)
        self.equity_curve.append(
            {
                "timestamp": self._last_tick_time,
                "time_str": datetime.now().strftime("%H:%M:%S"),
                "equity": round(equity, 2),
                "balance": round(state.get("balance", self.initial_capital), 2),
                "unrealized_pnl": round(state.get("unrealized_pnl", 0.0), 2),
                "price": current_price,
            }
        )
        if len(self.equity_curve) > 200:
            self.equity_curve = self.equity_curve[-200:]

        # 4. Check if cooldown has elapsed and no active position for this coin
        active_positions = state.get("positions", [])
        has_pos_for_symbol = any(p.get("symbol") == self.symbol for p in active_positions)
        now_sec = time.time()

        if has_pos_for_symbol or (now_sec - self._last_signal_time < self._signal_cooldown_sec):
            return

        # 5. Search for trade setups matching selected strategy
        indicator_context = await self._load_indicator_context()
        candidate_signal = await self._detect_setup(data, indicator_context)
        if not candidate_signal:
            self.no_trade_count += 1
            if indicator_context is not None:
                from backend.app.services.orderflow_backtester import OrderFlowBacktester

                diagnostic = OrderFlowBacktester(initial_capital=self.initial_capital).explain_latest_signal(
                    indicator_context["frame"],
                    strategy_type=self.strategy_type,
                    volume_multiplier=self.volume_multiplier,
                    min_density_usd=self.min_density_usd,
                    use_atr_filter=self.use_atr_filter,
                    use_cvd_filter=self.use_cvd_filter,
                    use_oi_filter=self.use_oi_filter,
                    use_rsi_filter=self.use_rsi_filter,
                )
                failed_checks = list(diagnostic.get("failed_checks") or [])
                if self.strategy_type == "cluster_volume_bounce" and diagnostic.get("status") == "SIGNAL":
                    failed_checks.append("live_orderbook_wall")
                if self.strategy_type == "cluster_volume_bounce" and diagnostic.get("status") == "SIGNAL":
                    diagnostic = {
                        **diagnostic,
                        "reason": "NO_TRADE: OHLCV-сигнал есть, но live-плотность стакана не подтверждена.",
                        "failed_checks": failed_checks,
                        "rejections": [*(diagnostic.get("rejections") or []), {"filter": "live_orderbook_wall", "actual": "no matching wall", "operator": "requires", "threshold": f"${self.min_density_usd:,.0f}"}],
                    }
                self._record_no_entry(diagnostic)
            else:
                self._record_no_entry({
                    "reason": "NO_TRADE: OHLCV-индикаторы недоступны или не прошли проверку целостности.",
                    "failed_checks": ["indicator_data"],
                    "rejections": [{"filter": "indicator_data", "actual": self.indicator_data_status, "operator": "requires", "threshold": "connected"}],
                    "observed": {"last_data_error": self.last_data_error},
                })
            return

        self._last_signal_time = now_sec

        # 6. AI Risk Control VETO check via OpenRouter (if enabled)
        if self.ai_control:
            self._add_log("AI_COPILOT", f"Проверка AI-риск-менеджером сетапа {candidate_signal['direction']}...")
            setup_dict = {
                "direction": candidate_signal["direction"],
                "entry_price": candidate_signal["entry_price"],
                "stop_loss": candidate_signal["sl"],
                "take_profit": candidate_signal["tp1"],
                "rr_ratio": candidate_signal["expected_rr"],
                "reason": "; ".join(candidate_signal["reason"]),
            }
            snapshot_dict = {
                "price": current_price,
                "depth_delta_pct": data.orderbook_depth.depth_deltas.get("2.5%", {}).delta_pct if data.orderbook_depth.depth_deltas.get("2.5%") else 0.0,
                "strongest_magnet": "SHORTS_ABOVE" if data.liq_estimates.shorts_above_usd >= data.liq_estimates.longs_below_usd else "LONGS_BELOW",
                "funding_rate": data.snapshot.funding_rate,
                "atr": current_price * 0.006,  # 0.6% baseline ATR approx
            }

            ai_eval = await openrouter_client.evaluate_trade_risk(
                symbol=self.symbol,
                setup=setup_dict,
                market_snapshot=snapshot_dict,
            )

            if ai_eval.get("veto", False):
                self._add_log(
                    "AI_VETO",
                    f"⛔ AI НАЛОЖИЛ ВЕТО: {ai_eval.get('reason', 'Высокий риск')}",
                    meta={"ai_eval": ai_eval},
                )
                return
            else:
                self._add_log(
                    "AI_CONFIRM",
                    f"✓ AI ОДОБРИЛ ВХОД: {ai_eval.get('reason', 'Сетап подтвержден')}",
                    meta={"ai_eval": ai_eval},
                )

        # 7. Execute virtual order into Paper Trading Session
        signal_obj = UnifiedTradeSignal(
            symbol=self.symbol,
            timeframe=self.timeframe,
            timestamp=int(time.time() * 1000),
            direction=candidate_signal["direction"],
            entry_type="LIMIT",
            entry_price=candidate_signal["entry_price"],
            sl=candidate_signal["sl"],
            tp1=candidate_signal["tp1"],
            tp2=candidate_signal.get("tp2"),
            expected_rr=candidate_signal["expected_rr"],
            leverage=self.leverage,
            risk_pct=self.risk_per_trade_pct,
            strategy_type=self.strategy_type,
            data_source="binance_live_l2_ohlcv",
            context_snapshot={
                "price": current_price,
                "funding_rate": float(data.snapshot.funding_rate),
                "depth_delta_pct": float(data.orderbook_depth.depth_deltas.get("2.5%").delta_pct) if data.orderbook_depth.depth_deltas.get("2.5%") else 0.0,
                "indicator_timestamp": self.indicator_last_update,
                "strategy": self.strategy_type,
            },
            reason=candidate_signal["reason"],
        )

        try:
            order_res = self.session.execute_unified_signal(signal_obj)
            self._add_log(
                "TRADE_ENTRY",
                f"Вход в виртуальную сделку {candidate_signal['direction']} @ ${candidate_signal['entry_price']:,.2f} "
                f"(SL: ${candidate_signal['sl']:,.2f}, TP: ${candidate_signal['tp1']:,.2f}, R:R 1:{candidate_signal['expected_rr']:.1f})",
                meta=order_res,
            )
        except Exception as e:
            logger.error(f"Paper order execution error: {e}")
            self._add_log("ERROR", f"Ошибка открытия сделки: {e}")

    async def _load_indicator_context(self) -> Optional[Dict[str, Any]]:
        """Load the same real OHLCV-derived indicators used by the historical engine.

        The live runner may combine this context with live L2 walls, but never
        substitutes a different strategy when the historical feed is stale.
        """
        now = time.time()
        if self._indicator_context is not None and now - self._indicator_context_at < 60.0:
            return self._indicator_context

        try:
            from backend.app.routers.backtest import fetch_history
            from backend.app.services.orderflow_backtester import OrderFlowBacktester

            frame = await fetch_history(self.symbol, self.timeframe, days=2)
            validation = OrderFlowBacktester.validate_ohlcv_integrity(frame, min_bars=60)
            if not validation["valid"]:
                self.indicator_data_status = "invalid"
                self.last_data_error = "OHLCV integrity: " + "; ".join(validation["issues"][:2])
                self._add_log("INDICATOR_ERROR", self.last_data_error, meta=validation)
                return None

            enriched = OrderFlowBacktester(initial_capital=self.initial_capital).calculate_indicators(frame)
            latest = enriched.iloc[-1].to_dict()
            previous = enriched.iloc[-2].to_dict()
            self._indicator_context = {"latest": latest, "previous": previous, "frame": enriched}
            self._indicator_context_at = now
            self.indicator_data_status = "connected"
            self.indicator_last_update = int(latest.get("timestamp", time.time() * 1000))
            return self._indicator_context
        except Exception as exc:
            self.indicator_data_status = "disconnected"
            self._indicator_context = None
            self._add_log("INDICATOR_ERROR", f"Не удалось обновить OHLCV-индикаторы: {str(exc)[:120]}")
            return None

    def _passes_live_indicator_filters(self, context: Dict[str, Any], direction: int) -> bool:
        """Apply the historical backtest filter suite to a live candle context."""
        latest = context["latest"]
        previous = context["previous"]
        if self.use_atr_filter and float(latest.get("atr_ema20", 0.0)) > 0:
            if float(latest.get("atr", 0.0)) > 2.0 * float(latest["atr_ema20"]):
                return False

        if self.use_cvd_filter:
            delta = float(latest.get("delta", 0.0))
            cvd = float(latest.get("cvd", 0.0))
            cvd_ema = float(latest.get("cvd_ema14", 0.0))
            if direction > 0:
                bull_div = (
                    float(latest.get("low", 0.0)) <= float(latest.get("low_min6", 0.0))
                    and cvd > float(latest.get("cvd_min6", 0.0))
                ) or (
                    float(latest.get("close", 0.0)) < float(previous.get("close", 0.0))
                    and cvd > float(previous.get("cvd", 0.0))
                )
                if not (delta > 0 and (cvd >= cvd_ema or bull_div)):
                    return False
            else:
                bear_div = (
                    float(latest.get("high", 0.0)) >= float(latest.get("high_max6", 0.0))
                    and cvd < float(latest.get("cvd_max6", 0.0))
                ) or (
                    float(latest.get("close", 0.0)) > float(previous.get("close", 0.0))
                    and cvd < float(previous.get("cvd", 0.0))
                )
                if not (delta < 0 and (cvd <= cvd_ema or bear_div)):
                    return False

        if self.use_oi_filter and float(latest.get("oi_delta", 0.0)) < 0:
            return False

        if self.use_rsi_filter:
            rsi = float(latest.get("rsi", 50.0))
            if self.strategy_type == "confluence_ema":
                return 42 <= rsi <= 58
            previous_rsi = float(previous.get("rsi", 50.0))
            if direction > 0:
                return rsi <= 42 or (previous_rsi <= 36 and rsi >= 30)
            return rsi >= 58 or (previous_rsi >= 64 and rsi <= 70)
        return True

    def _historical_signal(self, current_price: float, direction: int, reason: List[str]) -> Dict[str, Any]:
        sign = 1 if direction > 0 else -1
        entry = float(current_price)
        sl = round(entry * (1 - sign * self.stop_loss_pct / 100.0), 8)
        sl_distance = abs(entry - sl)
        configured_tp_distance = entry * self.take_profit_pct / 100.0
        tp1_distance = min(configured_tp_distance, sl_distance * max(1.0, self.tp1_rr_ratio)) if self.use_multi_tp else configured_tp_distance
        tp2_distance = max(configured_tp_distance, sl_distance * max(self.tp2_rr_ratio, self.tp1_rr_ratio)) if self.use_multi_tp else configured_tp_distance
        tp = round(entry + sign * tp1_distance, 8)
        tp2 = round(entry + sign * tp2_distance, 8) if self.use_multi_tp else None
        return {
            "direction": "LONG" if direction > 0 else "SHORT",
            "entry_price": entry,
            "sl": sl,
            "tp1": tp,
            "tp2": tp2,
            "expected_rr": max(1.0, self.take_profit_pct / max(self.stop_loss_pct, 1e-9)),
            "reason": reason,
        }

    async def _detect_setup(self, data, indicator_context: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        """
        Detects live setups from real-time FreeBinanceCollector feeds:
        - 'live_density_bounce': entry in front of heavy spot wall ($500k+)
        - 'confluence_ema' / 'quant_confluence': Cold Quant Engine evaluation
        """
        current_price = data.snapshot.price
        walls = data.orderbook_depth.walls
        dd_2_5 = data.orderbook_depth.depth_deltas.get("2.5%")
        delta_pct = dd_2_5.delta_pct if dd_2_5 else 0.0

        # These are the three strategies used by the overnight pilot. Their
        # live decisions must remain aligned with the historical OHLCV engine.
        if self.strategy_type in PAPER_HISTORICAL_STRATEGIES:
            if indicator_context is None:
                return None
            from backend.app.services.orderflow_backtester import OrderFlowBacktester
            historical_signal = OrderFlowBacktester(initial_capital=self.initial_capital).evaluate_latest_signal(
                indicator_context["frame"],
                strategy_type=self.strategy_type,
                volume_multiplier=self.volume_multiplier,
                min_density_usd=self.min_density_usd,
                use_atr_filter=self.use_atr_filter,
                use_cvd_filter=self.use_cvd_filter,
                use_oi_filter=self.use_oi_filter,
                use_rsi_filter=self.use_rsi_filter,
            )
            if historical_signal is None:
                return None
            if self.strategy_type == "cluster_volume_bounce":
                candidate_walls = [wall for wall in walls if wall.price > 0 and wall.size * wall.price >= self.min_density_usd]
                wall = min(candidate_walls, key=lambda item: abs(item.price - current_price), default=None)
                if wall is None or not (0.05 <= abs(current_price - wall.price) / current_price * 100.0 <= 1.5):
                    return None
                wall_direction = "LONG" if wall.price < current_price else "SHORT"
                if wall_direction != historical_signal["direction"]:
                    return None
                historical_signal["reasons"].append(f"Live density wall ${wall.size * wall.price:,.0f}")
            direction = 1 if historical_signal["direction"] == "LONG" else -1
            return self._historical_signal(current_price, direction, historical_signal["reasons"])

        # Historical strategy profiles reuse the same live data contract but keep
        # distinct entry logic so the overnight pilot compares real alternatives.
        if self.strategy_type == "cvd_absorption":
            cvd = float(data.snapshot.cvd_value)
            if abs(delta_pct) >= 8.0 and ((cvd > 0 and delta_pct > 0) or (cvd < 0 and delta_pct < 0)):
                direction = "LONG" if delta_pct > 0 else "SHORT"
                sign = 1 if direction == "LONG" else -1
                entry = current_price
                sl = round(entry * (1 - sign * self.stop_loss_pct / 100.0), 8)
                tp = round(entry * (1 + sign * self.take_profit_pct / 100.0), 8)
                return {
                    "direction": direction,
                    "entry_price": entry,
                    "sl": sl,
                    "tp1": tp,
                    "expected_rr": max(1.0, self.take_profit_pct / self.stop_loss_pct),
                    "reason": [f"CVD absorption confirmation: {cvd:+.2f}", f"Depth delta: {delta_pct:+.2f}%"],
                }

        if self.strategy_type == "cluster_volume_bounce":
            candidate_walls = [wall for wall in walls if wall.price > 0 and wall.size * wall.price >= self.min_density_usd]
            if candidate_walls:
                wall = min(candidate_walls, key=lambda item: abs(item.price - current_price))
                direction = "LONG" if wall.price < current_price else "SHORT"
                distance_pct = abs(current_price - wall.price) / current_price * 100.0
                if 0.05 <= distance_pct <= 1.5:
                    sign = 1 if direction == "LONG" else -1
                    entry = current_price
                    sl = round(entry * (1 - sign * self.stop_loss_pct / 100.0), 8)
                    tp = round(entry * (1 + sign * self.take_profit_pct / 100.0), 8)
                    return {
                        "direction": direction,
                        "entry_price": entry,
                        "sl": sl,
                        "tp1": tp,
                        "expected_rr": max(1.0, self.take_profit_pct / self.stop_loss_pct),
                        "reason": [f"Cluster wall ${wall.size * wall.price:,.0f} @ ${wall.price:,.4f}", f"Distance: {distance_pct:.2f}%"],
                    }

        # Strategy 1: Live Density Bounce (Вход перед стенкой)
        if self.strategy_type in ("live_density_bounce", "spot_wall_bounce"):
            # Find significant walls (> min_density_usd)
            significant_walls = [w for w in walls if (w.size * w.price) >= self.min_density_usd]

            # Check bid walls (Long bounce setup)
            bid_walls = [w for w in significant_walls if w.price < current_price]
            # Check ask walls (Short bounce setup)
            ask_walls = [w for w in significant_walls if w.price > current_price]

            # Long bounce: nearest bid wall within 0.1% to 1.5% below price and positive delta
            if bid_walls and delta_pct > -10.0:
                strongest_bid = max(bid_walls, key=lambda w: w.size * w.price)
                dist_pct = (current_price - strongest_bid.price) / current_price * 100.0
                if 0.08 <= dist_pct <= 1.5:
                    sl_price = round(strongest_bid.price * (1.0 - (self.stop_loss_pct / 100.0)), 2)
                    tp_price = round(current_price * (1.0 + (self.take_profit_pct / 100.0)), 2)
                    risk = current_price - sl_price
                    reward = tp_price - current_price
                    rr = round(reward / risk, 2) if risk > 0 else 1.0

                    wall_usd = strongest_bid.size * strongest_bid.price
                    return {
                        "direction": "LONG",
                        "entry_price": current_price,
                        "sl": sl_price,
                        "tp1": tp_price,
                        "expected_rr": max(rr, 1.5),
                        "reason": [
                            f"Стенка бидов ${wall_usd / 1e3:.0f}k @ ${strongest_bid.price} ({dist_pct:.2f}% ниже)",
                            f"Дисбаланс глубины 2.5%: {delta_pct:+.1f}%",
                        ],
                    }

            # Short bounce: nearest ask wall within 0.1% to 1.5% above price and negative delta
            if ask_walls and delta_pct < 10.0:
                strongest_ask = max(ask_walls, key=lambda w: w.size * w.price)
                dist_pct = (strongest_ask.price - current_price) / current_price * 100.0
                if 0.08 <= dist_pct <= 1.5:
                    sl_price = round(strongest_ask.price * (1.0 + (self.stop_loss_pct / 100.0)), 2)
                    tp_price = round(current_price * (1.0 - (self.take_profit_pct / 100.0)), 2)
                    risk = sl_price - current_price
                    reward = current_price - tp_price
                    rr = round(reward / risk, 2) if risk > 0 else 1.0

                    wall_usd = strongest_ask.size * strongest_ask.price
                    return {
                        "direction": "SHORT",
                        "entry_price": current_price,
                        "sl": sl_price,
                        "tp1": tp_price,
                        "expected_rr": max(rr, 1.5),
                        "reason": [
                            f"Стенка асков ${wall_usd / 1e3:.0f}k @ ${strongest_ask.price} ({dist_pct:.2f}% выше)",
                            f"Дисбаланс глубины 2.5%: {delta_pct:+.1f}%",
                        ],
                    }

        # Strategy 2: Cold Quant Confluence Engine
        core3 = quant_engine.evaluate_core3_math(data)
        if core3.verdict == "READY_FOR_PAPER":
            direction = "LONG" if core3.depth_bias == "BULLISH_SUPPORT" or core3.strongest_liq_magnet == "SHORTS_ABOVE" else "SHORT"
            return {
                "direction": direction,
                "entry_price": core3.suggested_entry,
                "sl": core3.suggested_stop_loss,
                "tp1": core3.suggested_take_profit,
                "expected_rr": core3.risk_reward_ratio,
                "reason": core3.verdict_reasons,
            }

        return None

    def _update_open_positions(self, current_price: float):
        """Simulates price ticks against open positions: triggers Stop Loss / Take Profit / Trailing."""
        self.session.check_dynamic_breakeven(self.symbol, current_price)
        for symbol, pos in list(self.session.positions.items()):
            if symbol != self.symbol:
                continue
            if pos.closed:
                continue

            entry = pos.avg_entry_price
            if entry <= 0:
                continue

            if self.use_trailing and self.trailing_pct > 0:
                trail_fraction = self.trailing_pct / 100.0
                if pos.side == "LONG":
                    pos.trailing_high_price = max(pos.trailing_high_price or entry, current_price)
                    trailing_stop = pos.trailing_high_price * (1.0 - trail_fraction)
                    if trailing_stop > pos.stop_price:
                        pos.stop_price = trailing_stop
                elif pos.side == "SHORT":
                    pos.trailing_low_price = min(pos.trailing_low_price or entry, current_price)
                    trailing_stop = pos.trailing_low_price * (1.0 + trail_fraction)
                    if pos.stop_price <= 0 or trailing_stop < pos.stop_price:
                        pos.stop_price = trailing_stop

            # Check Long
            if pos.side == "LONG":
                # Check Stop Loss
                if current_price <= pos.stop_price:
                    self.session.close_position(symbol, current_price, order_type="MARKET", reason="STOP_LOSS", signal_ts=self._last_tick_time)
                # Check Take Profit
                elif current_price >= pos.target_price:
                    if self.use_multi_tp and not pos.tp1_filled and pos.tp2_price > pos.target_price:
                        self.session.close_position(symbol, current_price, order_type="LIMIT", reason="TP1_PARTIAL", signal_ts=self._last_tick_time, quantity=max(pos.qty * 0.5, 1e-12))
                        pos.tp1_filled = True
                        self.session.check_dynamic_breakeven(symbol, current_price)
                        pos.target_price = pos.tp2_price
                    else:
                        self.session.close_position(symbol, current_price, order_type="LIMIT", reason="TAKE_PROFIT", signal_ts=self._last_tick_time)

            # Check Short
            elif pos.side == "SHORT":
                if current_price >= pos.stop_price:
                    self.session.close_position(symbol, current_price, order_type="MARKET", reason="STOP_LOSS", signal_ts=self._last_tick_time)
                elif current_price <= pos.target_price:
                    if self.use_multi_tp and not pos.tp1_filled and pos.tp2_price < pos.target_price:
                        self.session.close_position(symbol, current_price, order_type="LIMIT", reason="TP1_PARTIAL", signal_ts=self._last_tick_time, quantity=max(pos.qty * 0.5, 1e-12))
                        pos.tp1_filled = True
                        self.session.check_dynamic_breakeven(symbol, current_price)
                        pos.target_price = pos.tp2_price
                    else:
                        self.session.close_position(symbol, current_price, order_type="LIMIT", reason="TAKE_PROFIT", signal_ts=self._last_tick_time)

# Global singleton runner
live_paper_runner = LivePaperRunner()
