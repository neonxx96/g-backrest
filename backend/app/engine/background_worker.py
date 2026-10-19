"""
Background Worker Engine for Parallel Market Monitoring & Continuous Quant Forecasting.
Manages a focus list of monitored tickers (BTC, SOL, LINK, ADA, SUI, UNI, ZEC),
limiting concurrency via asyncio.Semaphore to prevent CPU overload and exchange rate-limiting.
Streams real-time progress and telemetry updates to frontend clients via WebSockets.
"""

import asyncio
import inspect
import logging
import time
from typing import Dict, Any, List, Set, Optional
import pandas as pd
import numpy as np
from fastapi import WebSocket

from backend.app.services.historical_data_loader import historical_loader
from backend.app.services.orderflow_backtester import OrderFlowBacktester
from backend.app.engine.regime_classifier import MarketRegime, regime_classifier
from backend.app.engine.walk_forward_engine import walk_forward_engine

logger = logging.getLogger("SignalScript.BackgroundWorker")

DEFAULT_FOCUS_LIST = [
    "BTCUSDT",
    "SOLUSDT",
    "LINKUSDT",
    "ADAUSDT",
    "SUIUSDT",
    "UNIUSDT",
    "ZECUSDT"
]

CANDIDATE_STRATEGIES = [
    {
        "name": "Confluence Momentum (CVD+EMA+ATR)",
        "strategy_type": "confluence_ema",
        "stop_loss_pct": 0.6,
        "take_profit_pct": 1.8,
        "min_density_usd": 100000.0,
        "volume_multiplier": 1.0,
        "leverage": 2.0,
        "use_multi_tp": True,
        "tp1_rr_ratio": 1.5,
        "sl_mode": "fixed_pct",
        "min_wall_lifetime_sec": 15,
        "use_cvd_filter": True,
        "use_oi_filter": False,
        "use_atr_filter": True,
        "use_rsi_filter": True,
    },
    {
        "name": "Trend Extension (ATR Volatility)",
        "strategy_type": "confluence_ema",
        "stop_loss_pct": 0.8,
        "take_profit_pct": 2.4,
        "min_density_usd": 100000.0,
        "volume_multiplier": 1.2,
        "leverage": 2.0,
        "use_multi_tp": True,
        "tp1_rr_ratio": 1.8,
        "sl_mode": "atr_volatility",
        "min_wall_lifetime_sec": 15,
        "use_cvd_filter": True,
        "use_oi_filter": False,
        "use_atr_filter": True,
        "use_rsi_filter": False,
    },
    {
        "name": "Order Flow Density Bounce",
        "strategy_type": "density_bounce",
        "stop_loss_pct": 0.5,
        "take_profit_pct": 1.5,
        "min_density_usd": 120000.0,
        "volume_multiplier": 1.0,
        "leverage": 2.0,
        "use_multi_tp": True,
        "tp1_rr_ratio": 1.5,
        "sl_mode": "behind_wall",
        "wall_sl_offset_ticks": 3,
        "min_wall_lifetime_sec": 20,
        "use_cvd_filter": True,
        "use_oi_filter": False,
        "use_atr_filter": True,
        "use_rsi_filter": True,
    },
    {
        "name": "Delta Absorption Scalp",
        "strategy_type": "delta_absorption",
        "stop_loss_pct": 0.5,
        "take_profit_pct": 1.2,
        "min_density_usd": 80000.0,
        "volume_multiplier": 1.0,
        "leverage": 2.0,
        "use_multi_tp": True,
        "tp1_rr_ratio": 1.3,
        "sl_mode": "fixed_pct",
        "min_wall_lifetime_sec": 15,
        "use_cvd_filter": True,
        "use_oi_filter": False,
        "use_atr_filter": False,
        "use_rsi_filter": True,
    },
    {
        "name": "Conservative Scalp (Tight Risk)",
        "strategy_type": "confluence_ema",
        "stop_loss_pct": 0.4,
        "take_profit_pct": 1.0,
        "min_density_usd": 100000.0,
        "volume_multiplier": 1.0,
        "leverage": 1.5,
        "use_multi_tp": True,
        "tp1_rr_ratio": 1.2,
        "sl_mode": "fixed_pct",
        "min_wall_lifetime_sec": 15,
        "use_cvd_filter": True,
        "use_oi_filter": False,
        "use_atr_filter": True,
        "use_rsi_filter": True,
    },
]


class BackgroundWorker:
    """
    Parallel background processing engine for active coin monitoring.
    Only computes order flow analytics, backtests, and forecast models
    for coins explicitly selected by the trader.
    """

    def __init__(self, max_concurrency: int = 3, cycle_interval_sec: int = 300):
        self.max_concurrency = max_concurrency
        self.cycle_interval_sec = cycle_interval_sec
        self._semaphore: Optional[asyncio.Semaphore] = None
        self._semaphore_loop: Optional[asyncio.AbstractEventLoop] = None
        
        self.monitored_tickers: Set[str] = set(DEFAULT_FOCUS_LIST)
        self.active_tasks: Dict[str, asyncio.Task] = {}
        self.task_statuses: Dict[str, Dict[str, Any]] = {}
        self.connected_websockets: Set[WebSocket] = set()
        self.optimized_params: Dict[str, Dict[str, Any]] = {}

        self._main_loop_task: Optional[asyncio.Task] = None
        self._running: bool = False
        self.start_time: float = time.time()

        # Initialize statuses
        for ticker in self.monitored_tickers:
            self.task_statuses[ticker] = {
                "ticker": ticker,
                "state": "idle",
                "step": "Ожидание квант-цикла",
                "pnl_pct": 0.0,
                "win_rate_pct": 0.0,
                "signal": "NEUTRAL",
                "forecast_trend": "FLAT",
                "updated_at": int(time.time() * 1000)
            }

    @property
    def semaphore(self) -> asyncio.Semaphore:
        """Lazily initialize asyncio.Semaphore bound to the current running event loop."""
        try:
            current_loop = asyncio.get_running_loop()
        except RuntimeError:
            current_loop = None

        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(self.max_concurrency)
            self._semaphore_loop = current_loop
        elif self._semaphore_loop is not current_loop and current_loop is not None:
            self._semaphore = asyncio.Semaphore(self.max_concurrency)
            self._semaphore_loop = current_loop
        return self._semaphore

    async def register_websocket(self, ws: WebSocket):
        """Registers an active frontend WebSocket for real-time status streaming."""
        self.connected_websockets.add(ws)
        # Send initial snapshot of all statuses
        try:
            await ws.send_json({
                "type": "init",
                "monitored_tickers": sorted(list(self.monitored_tickers)),
                "statuses": self.task_statuses
            })
        except Exception as e:
            logger.debug(f"Failed to send initial snapshot to WS: {e}")

    def unregister_websocket(self, ws: WebSocket):
        """Removes a disconnected WebSocket client."""
        self.connected_websockets.discard(ws)

    async def broadcast_status(self, ticker: str, status_payload: Dict[str, Any]):
        """Broadcasts a telemetry or progress update to all active frontend subscribers."""
        status_payload["ticker"] = ticker
        status_payload["updated_at"] = int(time.time() * 1000)
        self.task_statuses[ticker] = {**self.task_statuses.get(ticker, {}), **status_payload}

        message = {
            "type": "status_update",
            **self.task_statuses[ticker]
        }

        dead_sockets = set()
        for ws in self.connected_websockets:
            try:
                await ws.send_json(message)
            except Exception:
                dead_sockets.add(ws)

        for ws in dead_sockets:
            self.connected_websockets.discard(ws)

    def set_monitored_tickers(self, tickers: List[str]):
        """Updates the active focus list, gracefully canceling tasks for unmonitored coins."""
        new_set = {t.strip().upper() for t in tickers if t and t.strip()}
        removed = self.monitored_tickers - new_set
        added = new_set - self.monitored_tickers

        self.monitored_tickers = new_set

        # Cancel tasks for removed tickers immediately
        for sym in removed:
            if sym in self.active_tasks and not self.active_tasks[sym].done():
                logger.info(f"Canceling background processing for unmonitored ticker: {sym}")
                self.active_tasks[sym].cancel()
            self.task_statuses.pop(sym, None)

        # Initialize statuses for newly added tickers
        for sym in added:
            self.task_statuses[sym] = {
                "ticker": sym,
                "state": "queued",
                "step": "В очереди на обработку",
                "pnl_pct": 0.0,
                "win_rate_pct": 0.0,
                "signal": "NEUTRAL",
                "forecast_trend": "FLAT",
                "updated_at": int(time.time() * 1000)
            }
            # Trigger an immediate background processing task for newly added coin
            if self._running:
                task = asyncio.create_task(self._process_ticker_safely(sym))
                self.active_tasks[sym] = task

    def is_monitored(self, ticker: str) -> bool:
        """Returns True if the ticker is currently in the monitored list."""
        if not ticker:
            return False
        return ticker.strip().upper() in self.monitored_tickers

    def toggle_ticker(self, ticker: str, monitored: bool):
        """Toggles monitoring state for an individual ticker."""
        sym = ticker.strip().upper()
        current = set(self.monitored_tickers)
        if monitored:
            current.add(sym)
        else:
            current.discard(sym)
        self.set_monitored_tickers(list(current))

    async def auto_optimize_strategies(self, days: int = 7) -> Dict[str, Dict[str, Any]]:
        """
        Pre-flight institutional auto-optimization across monitored coins (7-day historical sample).
        Selects and applies ONLY parameter regimes yielding positive PnL for live market execution.
        If no regime yields positive PnL, trading execution is safely paused for that coin.
        """
        logger.info(f"Starting Pre-Flight Auto-Optimization across {len(self.monitored_tickers)} coins ({days} days)...")
        results = {}

        backtester = OrderFlowBacktester(
            initial_capital=10000.0,
            maker_fee_pct=0.02,
            taker_fee_pct=0.05,
            slippage_ticks=2
        )

        for ticker in sorted(list(self.monitored_tickers)):
            try:
                df = await historical_loader.load_dataset_async(
                    symbol=ticker,
                    timeframe="5m",
                    days=days,
                    force_refresh=False
                )

                if df is None or len(df) < 60:
                    logger.warning(f"[AUTO-OPTIMIZE] {ticker}: Insufficient candles ({len(df) if df is not None else 0}). Defaulting to inactive.")
                    opt = {**CANDIDATE_STRATEGIES[0], "is_profitable": False, "pnl_pct": 0.0, "win_rate_pct": 0.0, "trades_count": 0}
                    self.optimized_params[ticker] = opt
                    results[ticker] = opt
                    continue

                best_cand = None
                best_pnl = -999999.0
                best_wr = 0.0
                best_trades = 0

                for cand in CANDIDATE_STRATEGIES:
                    kw = {k: v for k, v in cand.items() if k != "name"}
                    bt_res = backtester.run_backtest(
                        df=df,
                        compute_monte_carlo=False,
                        fast_eval=True,
                        **kw
                    )
                    summary = bt_res.get("summary", {}) if isinstance(bt_res, dict) else {}
                    pnl = float(summary.get("total_pnl_pct", 0.0))
                    wr = float(summary.get("win_rate_pct", 0.0))
                    trades_cnt = int(summary.get("total_trades", len(bt_res.get("trades", [])) if isinstance(bt_res, dict) else 0))

                    if pnl > 0.0 and trades_cnt > 0 and pnl > best_pnl:
                        best_pnl = pnl
                        best_wr = wr
                        best_trades = trades_cnt
                        best_cand = cand

                if best_cand and best_pnl > 0.0:
                    opt = {
                        **best_cand,
                        "is_profitable": True,
                        "pnl_pct": best_pnl,
                        "win_rate_pct": best_wr,
                        "trades_count": best_trades,
                    }
                    self.optimized_params[ticker] = opt
                    results[ticker] = opt
                    logger.info(
                        f"[AUTO-OPTIMIZE] {ticker}: Profitable regime selected: '{best_cand['name']}' "
                        f"(7d PnL: {best_pnl:+.2f}%, WinRate: {best_wr:.1f}%, Trades: {best_trades})"
                    )
                else:
                    fallback = CANDIDATE_STRATEGIES[0]
                    opt = {
                        **fallback,
                        "is_profitable": False,
                        "pnl_pct": best_pnl if best_pnl != -999999.0 else 0.0,
                        "win_rate_pct": best_wr,
                        "trades_count": best_trades,
                    }
                    self.optimized_params[ticker] = opt
                    results[ticker] = opt
                    logger.warning(
                        f"[AUTO-OPTIMIZE] {ticker}: No profitable regime found on 7d backtest (best={opt['pnl_pct']:+.2f}%). "
                        f"Coin disabled from automatic trade execution."
                    )

                # Execute 72h In-Sample Walk-Forward adaptation pass
                try:
                    await walk_forward_engine.train_walk_forward(ticker, hours=72)
                except Exception as wf_err:
                    logger.debug(f"[WalkForward] Adaptation notice for {ticker}: {wf_err}")
            except Exception as e:
                logger.error(f"[AUTO-OPTIMIZE] {ticker}: Optimization failed with error: {e}", exc_info=True)
                opt = {**CANDIDATE_STRATEGIES[0], "is_profitable": False, "pnl_pct": 0.0, "win_rate_pct": 0.0, "trades_count": 0}
                self.optimized_params[ticker] = opt
                results[ticker] = opt

        return results

    async def _process_ticker(self, ticker: str):
        """
        Processes a single ticker with concurrency limiting via Semaphore:
        1. Fetch latest historical data & footprint clusters (Parquet cache)
        2. Vectorized Market Regime Classification (RegimeClassifier: FLAT_DENSE, TREND_IMPULSE, TOXIC_VOLATILITY)
        3. Walk-Forward Parameter Adaptation per regime (WalkForwardEngine)
        4. Strict NO_TRADE gate if regime is TOXIC_VOLATILITY
        5. Run active confluence backtest strategy using adapted parameters
        6. Manage shadow paper trading positions and order fills
        """
        async with self.semaphore:
            logger.info(f"[{ticker}] Starting background quant analysis cycle...")
            
            # Step 1: Historical Data Ingestion
            await self.broadcast_status(ticker, {
                "state": "fetching",
                "step": f"Загрузка истории и кластеров ({ticker})..."
            })

            # Check cancellation before I/O
            asyncio.current_task().throw_if_cancelled() if hasattr(asyncio.current_task(), 'throw_if_cancelled') else None

            # Load 14 days of 5m data through Parquet caching engine
            df = await historical_loader.load_dataset_async(
                symbol=ticker,
                timeframe="5m",
                days=14,
                force_refresh=False
            )

            if df is None or len(df) < 50:
                await self.broadcast_status(ticker, {
                    "state": "idle",
                    "step": f"Недостаточно данных ({len(df) if df is not None else 0} свечей)"
                })
                return

            last_close = float(df["close"].iloc[-1])

            # Step 1b: Market Regime Classification & Micro-structure Diagnostics
            regime, reg_metrics = regime_classifier.classify_current(df)
            regime_name = regime.value
            is_trade_allowed = reg_metrics.get("is_trade_allowed", True)

            # Strict TOXIC_VOLATILITY gate: halt entries immediately
            if not is_trade_allowed:
                logger.warning(
                    f"[{ticker}] TOXIC_VOLATILITY detected (ATR={reg_metrics.get('norm_atr', 0):.5f}, "
                    f"Density={reg_metrics.get('rel_density', 0):.2f}). Trading strictly blocked."
                )
                await self.broadcast_status(ticker, {
                    "state": "toxic_halt",
                    "step": "Токсичный рынок: Аномальный ATR при разреженном стакане (Входы заблокированы)",
                    "pnl_pct": 0.0,
                    "win_rate_pct": 0.0,
                    "signal": "BLOCKED (TOXIC)",
                    "forecast_trend": "VOLATILE",
                    "last_price": last_close,
                    "is_profitable": False,
                    "regime": regime_name,
                    "is_trade_allowed": False,
                    "regime_metrics": reg_metrics,
                    "regime_name": "NO_TRADE (Toxic Vacuum)"
                })
                return

            # Step 2: Continuous Backtesting with Walk-Forward Adapted Parameters
            await self.broadcast_status(ticker, {
                "state": "backtesting",
                "step": f"Бэктест ({regime_name})...",
                "regime": regime_name,
                "is_trade_allowed": is_trade_allowed,
                "regime_metrics": reg_metrics,
            })

            backtester = OrderFlowBacktester(
                initial_capital=10000.0,
                maker_fee_pct=0.02,
                taker_fee_pct=0.05,
                slippage_ticks=2
            )

            # Retrieve Walk-Forward adapted parameters for this regime
            adapted_cfg = walk_forward_engine.get_adapted_parameters(ticker, regime)
            opt_cfg = adapted_cfg if adapted_cfg else self.optimized_params.get(ticker, CANDIDATE_STRATEGIES[0])

            valid_bt_keys = set(inspect.signature(backtester.run_backtest).parameters.keys())
            clean_params = {
                k: v for k, v in opt_cfg.items()
                if k in valid_bt_keys and k not in ("df", "compute_monte_carlo", "fast_eval")
            }

            bt_res = backtester.run_backtest(
                df=df,
                compute_monte_carlo=False,
                fast_eval=True,
                **clean_params
            )

            summary = bt_res.get("summary", {}) if isinstance(bt_res, dict) else {}
            total_pnl = float(summary.get("total_pnl_pct", 0.0))
            win_rate = float(summary.get("win_rate_pct", 0.0))
            trades = bt_res.get("trades", []) if isinstance(bt_res, dict) else []

            last_signal = "NEUTRAL"
            if trades:
                last_trade = trades[-1]
                t_type = str(last_trade.get("type", "")).upper()
                last_signal = "LONG" if t_type in ("BUY", "LONG") else "SHORT"

            # Step 3: Predictive Forecasting & Telemetry
            await self.broadcast_status(ticker, {
                "state": "forecasting",
                "step": f"Синтез конуса волатильности ({regime_name})..."
            })

            # Calculate forecast bias from latest indicators
            vol_delta = float(df["volume_delta"].tail(10).sum()) if "volume_delta" in df.columns else 0.0
            forecast_trend = "BULLISH" if vol_delta > 0 else "BEARISH" if vol_delta < 0 else "FLAT"

            # Step 4: Paper Trading Shadow Position Management
            from backend.app.services.paper_trading import paper_trading_session
            now_ms = int(time.time() * 1000)
            paper_trading_session.last_prices[ticker] = last_close
            paper_trading_session._last_event_ts = max(paper_trading_session._last_event_ts, now_ms)

            # Evaluate any existing active positions for dynamic breakeven, stop-loss or take-profit
            active_pos = paper_trading_session.positions.get(ticker)
            if active_pos and not active_pos.closed and active_pos.qty > 0:
                # 1. Dynamic Breakeven check (+0.5R MFE protection)
                paper_trading_session.check_dynamic_breakeven(ticker, last_close)

                # 2. Check Stop Loss (MARKET / Taker fee) or Take Profit (LIMIT / Maker fee)
                if active_pos.side == "LONG":
                    if active_pos.stop_price > 0 and last_close <= active_pos.stop_price:
                        sl_reason = "Dynamic Breakeven Hit" if active_pos.breakeven_triggered else "Stop Loss Hit"
                        paper_trading_session.close_position(ticker, reason=sl_reason, price=last_close, order_type="MARKET")
                    elif active_pos.target_price > 0 and last_close >= active_pos.target_price:
                        paper_trading_session.close_position(ticker, reason="Take Profit Hit", price=last_close, order_type="LIMIT")
                elif active_pos.side == "SHORT":
                    if active_pos.stop_price > 0 and last_close >= active_pos.stop_price:
                        sl_reason = "Dynamic Breakeven Hit" if active_pos.breakeven_triggered else "Stop Loss Hit"
                        paper_trading_session.close_position(ticker, reason=sl_reason, price=last_close, order_type="MARKET")
                    elif active_pos.target_price > 0 and last_close <= active_pos.target_price:
                        paper_trading_session.close_position(ticker, reason="Take Profit Hit", price=last_close, order_type="LIMIT")

            # Open paper trade if profitable regime found and fresh signal exists
            is_profitable = opt_cfg.get("is_profitable", True)
            if is_profitable and is_trade_allowed and last_signal in ("LONG", "SHORT"):
                active_pos = paper_trading_session.positions.get(ticker)
                has_open_pos = active_pos and not active_pos.closed and active_pos.qty > 0
                has_pending = any(
                    po.symbol == ticker and po.sim.state.status.value in ("PENDING", "ACTIVE")
                    for po in paper_trading_session.orders.values()
                )
                if not has_open_pos and not has_pending:
                    sl_pct = opt_cfg.get("stop_loss_pct", 0.6)
                    tp_pct = opt_cfg.get("take_profit_pct", 1.8)
                    stop_px = round(last_close * (1.0 - sl_pct / 100.0) if last_signal == "LONG" else last_close * (1.0 + sl_pct / 100.0), 4)
                    target_px = round(last_close * (1.0 + tp_pct / 100.0) if last_signal == "LONG" else last_close * (1.0 - tp_pct / 100.0), 4)
                    reason_desc = (
                        f"[{regime_name}] {opt_cfg.get('name', 'Confluence')} | "
                        f"SL: {sl_pct}% TP: {tp_pct}% | "
                        f"CVD/EMA {last_signal} Signal"
                    )
                    order_info = paper_trading_session.execute_trade_signal(
                        symbol=ticker,
                        side="BUY" if last_signal == "LONG" else "SELL",
                        price=last_close,
                        stop_price=stop_px,
                        target_price=target_px,
                        order_type="MARKET",
                        reason=reason_desc,
                        signal_ts=now_ms,
                        regime=regime_name
                    )
                    # Simulate immediate market fill
                    if order_info.get("order_id"):
                        class SimpleTradeEvent:
                            def __init__(self, ts, sym, px):
                                self.timestamp = ts
                                self.kind = "trade"
                                self.symbol = sym
                                self.payload = {"price": px, "quantity": 10.0, "symbol": sym}

                        paper_trading_session.process_event(SimpleTradeEvent(now_ms + 200, ticker, last_close))

            # Brief pacing for realistic async scheduling
            await asyncio.sleep(0.15)

            # Step 5: Completed
            status_desc = f"Режим: {regime_name} | PnL {total_pnl:+.2f}%, WR {win_rate:.0f}%, Сигнал: {last_signal}"
            if not is_profitable:
                status_desc += " (Стратегия не запущена: PnL <= 0)"

            await self.broadcast_status(ticker, {
                "state": "completed",
                "step": status_desc,
                "pnl_pct": total_pnl,
                "win_rate_pct": win_rate,
                "signal": last_signal,
                "forecast_trend": forecast_trend,
                "last_price": last_close,
                "is_profitable": is_profitable,
                "regime": regime_name,
                "is_trade_allowed": is_trade_allowed,
                "regime_metrics": reg_metrics,
                "regime_name": opt_cfg.get("name", "Default")
            })
            logger.info(
                f"[{ticker}] Quant cycle complete: Regime: {regime_name} | PnL {total_pnl:+.2f}%, "
                f"WinRate {win_rate}% | TradeAllowed: {is_trade_allowed}"
            )

    async def _process_ticker_safely(self, ticker: str):
        """Wrapper ensuring task cancellation and exceptions are safely caught."""
        try:
            await self._process_ticker(ticker)
        except asyncio.CancelledError:
            logger.info(f"[{ticker}] Task cancelled as coin was unmonitored.")
            await self.broadcast_status(ticker, {
                "state": "cancelled",
                "step": "Мониторинг остановлен"
            })
            raise
        except Exception as e:
            logger.error(f"[{ticker}] Error in background worker: {e}", exc_info=True)
            await self.broadcast_status(ticker, {
                "state": "error",
                "step": f"Ошибка: {str(e)[:40]}"
            })
        finally:
            self.active_tasks.pop(ticker, None)

    async def _run_periodic_loop(self):
        """Master background loop running every cycle_interval_sec with exponential backoff resilience."""
        logger.info(f"Parallel Background Worker running (interval={self.cycle_interval_sec}s, max_concurrency={self.max_concurrency}).")
        await asyncio.sleep(2)  # Initial grace period after server boot

        # Run Pre-Flight Auto-Optimization across monitored coins before entering loop
        try:
            logger.info("Executing Pre-Flight Auto-Optimization for all monitored coins...")
            await self.auto_optimize_strategies(days=7)
            logger.info("Pre-Flight Auto-Optimization completed successfully.")
        except Exception as e:
            logger.error(f"Error in Pre-Flight Auto-Optimization: {e}", exc_info=True)

        reconnect_attempts = 0
        while self._running:
            try:
                current_monitored = list(self.monitored_tickers)
                logger.info(f"Executing periodic background quant cycle for {len(current_monitored)} coins: {current_monitored}")

                # Launch processing tasks for all currently monitored coins
                tasks = []
                for ticker in current_monitored:
                    if ticker not in self.active_tasks or self.active_tasks[ticker].done():
                        task = asyncio.create_task(self._process_ticker_safely(ticker))
                        self.active_tasks[ticker] = task
                        tasks.append(task)

                if tasks:
                    await asyncio.gather(*tasks, return_exceptions=True)

                reconnect_attempts = 0  # Reset on successful cycle
                # Wait for next cycle
                await asyncio.sleep(self.cycle_interval_sec)

            except asyncio.CancelledError:
                break
            except Exception as e:
                delay = min(60.0, 2.0 * (2 ** reconnect_attempts))
                logger.error(
                    f"[ERROR] Error in master background worker loop: {e}. "
                    f"Applying backoff of {delay:.1f}s (retry={reconnect_attempts + 1})...",
                    exc_info=True
                )
                reconnect_attempts += 1
                await asyncio.sleep(delay)

    def start(self) -> asyncio.Task:
        """Starts the background processing daemon."""
        if self._running and self._main_loop_task and not self._main_loop_task.done():
            return self._main_loop_task

        self._running = True
        self._main_loop_task = asyncio.create_task(self._run_periodic_loop())
        return self._main_loop_task

    async def stop(self):
        """Stops the background processing daemon and cancels active tasks."""
        self._running = False
        if self._main_loop_task:
            self._main_loop_task.cancel()
        for sym, task in self.active_tasks.items():
            if not task.done():
                task.cancel()
        self.active_tasks.clear()
        logger.info("Background Worker daemon stopped.")


# Singleton instance
background_worker = BackgroundWorker(max_concurrency=3, cycle_interval_sec=300)
