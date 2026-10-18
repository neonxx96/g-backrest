"""
Background Worker Engine for Parallel Market Monitoring & Continuous Quant Forecasting.
Manages a focus list of monitored tickers (BTC, SOL, LINK, ADA, SUI, UNI, ZEC),
limiting concurrency via asyncio.Semaphore to prevent CPU overload and exchange rate-limiting.
Streams real-time progress and telemetry updates to frontend clients via WebSockets.
"""

import asyncio
import logging
import time
from typing import Dict, Any, List, Set, Optional
import pandas as pd
import numpy as np
from fastapi import WebSocket

from backend.app.services.historical_data_loader import historical_loader
from backend.app.services.orderflow_backtester import OrderFlowBacktester

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


class BackgroundWorker:
    """
    Parallel background processing engine for active coin monitoring.
    Only computes order flow analytics, backtests, and forecast models
    for coins explicitly selected by the trader.
    """

    def __init__(self, max_concurrency: int = 3, cycle_interval_sec: int = 300):
        self.max_concurrency = max_concurrency
        self.cycle_interval_sec = cycle_interval_sec
        self.semaphore = asyncio.Semaphore(max_concurrency)
        
        self.monitored_tickers: Set[str] = set(DEFAULT_FOCUS_LIST)
        self.active_tasks: Dict[str, asyncio.Task] = {}
        self.task_statuses: Dict[str, Dict[str, Any]] = {}
        self.connected_websockets: Set[WebSocket] = set()

        self._main_loop_task: Optional[asyncio.Task] = None
        self._running: bool = False

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

    async def _process_ticker(self, ticker: str):
        """
        Processes a single ticker with concurrency limiting via Semaphore:
        1. Fetch latest historical data & footprint clusters (Parquet cache)
        2. Run active confluence backtest strategy
        3. Prepare forecast metrics and delta bias
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

            # Step 2: Continuous Backtesting
            await self.broadcast_status(ticker, {
                "state": "backtesting",
                "step": f"Бэктест квант-стратегии (CVD+EMA+ATR)..."
            })

            # Run orderflow backtester on real data
            backtester = OrderFlowBacktester(
                initial_capital=10000.0,
                maker_fee_pct=0.02,
                taker_fee_pct=0.05,
                slippage_ticks=2
            )

            # Strategy parameters matching conservative defaults
            bt_res = backtester.run_strategy(
                df=df,
                strategy_type="confluence_ema",
                stop_loss_pct=0.6,
                take_profit_pct=1.8,
                min_density_usd=100000.0,
                volume_multiplier=1.0,
                leverage=3.0,
                use_multi_tp=True,
                tp1_rr_ratio=1.5,
                sl_mode="fixed_pct",
                min_wall_lifetime_sec=15,
                use_cvd_filter=True,
                use_oi_filter=False,
                use_atr_filter=True,
                use_rsi_filter=True
            )

            summary = bt_res.get("summary", {})
            total_pnl = summary.get("total_pnl_pct", 0.0)
            win_rate = summary.get("win_rate_pct", 0.0)
            trades = bt_res.get("trades", [])

            last_signal = "NEUTRAL"
            if trades:
                last_trade = trades[-1]
                last_signal = "LONG" if last_trade.get("type") == "BUY" else "SHORT"

            # Step 3: Predictive Forecasting & Telemetry
            await self.broadcast_status(ticker, {
                "state": "forecasting",
                "step": f"Синтез прогнозного конуса волатильности..."
            })

            # Calculate forecast bias from latest indicators
            last_close = float(df["close"].iloc[-1])
            vol_delta = float(df["volume_delta"].tail(10).sum()) if "volume_delta" in df.columns else 0.0
            forecast_trend = "BULLISH" if vol_delta > 0 else "BEARISH" if vol_delta < 0 else "FLAT"

            # Brief pacing for realistic async scheduling
            await asyncio.sleep(0.15)

            # Step 4: Completed
            await self.broadcast_status(ticker, {
                "state": "completed",
                "step": f"Готово: PnL {total_pnl:+.2f}%, WR {win_rate:.0f}%, Сигнал: {last_signal}",
                "pnl_pct": total_pnl,
                "win_rate_pct": win_rate,
                "signal": last_signal,
                "forecast_trend": forecast_trend,
                "last_price": last_close
            })
            logger.info(f"[{ticker}] Quant cycle complete: PnL {total_pnl:+.2f}%, WinRate {win_rate}%")

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
        """Master background loop running every cycle_interval_sec."""
        logger.info(f"Parallel Background Worker running (interval={self.cycle_interval_sec}s, max_concurrency={self.max_concurrency}).")
        await asyncio.sleep(3)  # Initial grace period after server boot

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

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in master background worker loop: {e}", exc_info=True)

            # Wait for next cycle
            await asyncio.sleep(self.cycle_interval_sec)

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
