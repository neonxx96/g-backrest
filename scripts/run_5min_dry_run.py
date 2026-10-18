"""
Institutional Paper Trading Stress Test & 5-Minute Health Check (Dry Run)
========================================================================
Execution Specifications:
- Focus Coins: BTCUSDT, SOLUSDT, LINKUSDT, ADAUSDT, SUIUSDT, UNIUSDT, ZECUSDT.
- Virtual Wallet: Exactly $100.00 USD initial capital.
- Risk Sizing: 2% ($2.00) max risk per trade.
- Taker Fee: 0.04% (0.0004) deduction on aggressive fills.
- Duration: Exactly 300 seconds (5 minutes).
- Logging: backend/logs/stress_test.log ([INFO], [TRADE], [WARNING], [ERROR]).
- Telemetry: RSS memory (Win32), Python heap (tracemalloc), WS stream frames, trades & fees.
"""

import os
import sys
import json
import time
import asyncio
import logging
import tracemalloc
from pathlib import Path
from typing import Dict, List, Any, Optional

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import websockets
from backend.app.logging_setup import setup_stress_logging, get_memory_stats, STRESS_LOG_FILE
from backend.app.services.paper_trading import PaperTradingSession, PaperOrderRole
from backend.app.engine.background_worker import BackgroundWorker, DEFAULT_FOCUS_LIST
from backend.app.services.historical_data_loader import historical_loader

logger = logging.getLogger("SignalScript.StressTest")

FOCUS_COINS = ["BTCUSDT", "SOLUSDT", "LINKUSDT", "ADAUSDT", "SUIUSDT", "UNIUSDT", "ZECUSDT"]
DURATION_SECONDS = 300  # 5 minutes
TELEMETRY_INTERVAL_SECONDS = 30


class LiveMarketEvent:
    """Wrapper matching the ReplayEvent protocol for real-time WebSocket feeds."""
    def __init__(self, timestamp: int, kind: str, payload: dict, symbol: str):
        self.timestamp = timestamp
        self.kind = kind
        self.payload = payload
        self.symbol = symbol


class StressTestRunner:
    def __init__(self, duration_sec: int = DURATION_SECONDS):
        self.duration_sec = duration_sec
        self.start_time: float = 0.0
        self.is_running: bool = False
        
        # Virtual Wallet ($100.00 USD, 2% risk, 0.04% taker fee)
        self.session = PaperTradingSession(
            initial_balance=100.0,
            risk_per_trade_pct=0.02,
            taker_fee=0.0004,
            maker_fee=0.0002,
            session_id=f"stress_{int(time.time())}"
        )
        
        # Parallel Background Quant Worker
        self.worker = BackgroundWorker(max_concurrency=3, cycle_interval_sec=120)
        self.worker.set_monitored_tickers(FOCUS_COINS)

        # Telemetry & Diagnostics
        self.total_ws_frames: int = 0
        self.total_trades_received: int = 0
        self.total_depth_received: int = 0
        self.ws_reconnects: int = 0
        self.exceptions_caught: List[Dict[str, Any]] = []
        self.telemetry_snapshots: List[Dict[str, Any]] = []
        self.initial_memory: Dict[str, float] = {}

    async def _run_ws_feed(self):
        """Streams live trades and orderbook snapshots from Binance Futures with exponential backoff."""
        ws_url = "wss://fstream.binance.com/ws"
        reconnect_attempts = 0
        base_delay = 2.0
        max_delay = 60.0

        # Subscribe to trades and 20-level depth for all 7 focus coins
        sub_params = []
        for sym in FOCUS_COINS:
            s_lower = sym.lower()
            sub_params.append(f"{s_lower}@trade")
            sub_params.append(f"{s_lower}@depth20@500ms")

        while self.is_running:
            try:
                logger.info(f"[INFO] Connecting to Binance Live Futures WS: {ws_url} ({len(sub_params)} streams)...")
                async with websockets.connect(ws_url, ping_interval=20, ping_timeout=15, max_size=10*1024*1024) as ws:
                    reconnect_attempts = 0
                    sub_msg = {"method": "SUBSCRIBE", "params": sub_params, "id": 777}
                    await ws.send(json.dumps(sub_msg))
                    logger.info(f"[INFO] Successfully subscribed to {len(sub_params)} market data streams.")

                    test_order_placed = False

                    while self.is_running:
                        try:
                            msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
                        except asyncio.TimeoutError:
                            continue

                        self.total_ws_frames += 1
                        data = json.loads(msg)
                        
                        stream_name = data.get("stream", "")
                        payload = data.get("data", data)
                        event_type = payload.get("e", "")

                        # 1. Trade Event
                        if event_type in ("trade", "aggTrade") or "@trade" in stream_name.lower():
                            sym = payload.get("s")
                            p = float(payload.get("p", 0))
                            q = float(payload.get("q", 0))
                            ts = int(payload.get("T", payload.get("E", int(time.time() * 1000))))
                            if sym and p > 0:
                                self.total_trades_received += 1
                                evt = LiveMarketEvent(ts, "trade", {"price": p, "quantity": q, "symbol": sym}, sym)
                                self.session.process_event(evt)

                        # 2. Depth Event
                        elif "b" in payload and "a" in payload:
                            sym = payload.get("s") or (stream_name.split("@")[0].upper() if "@" in stream_name else "")
                            bids = [[float(bp), float(bq)] for bp, bq in payload.get("b", [])[:10]]
                            asks = [[float(ap), float(aq)] for ap, aq in payload.get("a", [])[:10]]
                            ts = int(payload.get("E", int(time.time() * 1000)))
                            if sym and (bids or asks):
                                self.total_depth_received += 1
                                evt = LiveMarketEvent(ts, "depth", {"bids": bids, "asks": asks, "symbol": sym}, sym)
                                self.session.process_event(evt)

                        # 3. Trigger a realistic live test trade once liquidity and prices are established
                        if not test_order_placed and self.total_trades_received > 20 and self.total_depth_received > 20:
                            test_sym = "SOLUSDT"
                            px = self.session.last_prices.get(test_sym, 0.0)
                            if px > 0:
                                test_order_placed = True
                                # Stop loss set at 1.5% below entry
                                stop_px = round(px * 0.985, 2)
                                qty = self.session.calculate_position_size(test_sym, px, stop_px)
                                logger.info(
                                    f"[TRADE] Placing initial stress test order: BUY {qty:.4f} {test_sym} @ {px:.2f} "
                                    f"(SL: {stop_px:.2f}, Risk Budget: $2.00, Avail Margin: ${self.session.available_margin:.2f})"
                                )
                                self.session.place_order(
                                    symbol=test_sym,
                                    side="BUY",
                                    order_type="MARKET",
                                    price=px,
                                    quantity=qty,
                                    role=PaperOrderRole.ENTRY.value,
                                    stop_price=stop_px,
                                    signal_ts=int(time.time() * 1000)
                                )

            except asyncio.CancelledError:
                break
            except Exception as e:
                self.ws_reconnects += 1
                self.exceptions_caught.append({"type": "WS_DISCONNECT", "error": str(e), "ts": time.time()})
                delay = min(max_delay, base_delay * (2 ** reconnect_attempts))
                logger.warning(
                    f"[WARNING] WS disconnect in stress test: {e}. "
                    f"Reconnecting in {delay:.1f}s (reconnect_attempt={self.ws_reconnects})...",
                    exc_info=True
                )
                reconnect_attempts += 1
                await asyncio.sleep(delay)

    async def _run_telemetry_monitor(self):
        """Periodically measures and logs system memory, wallet balance, and event stream telemetry."""
        while self.is_running:
            await asyncio.sleep(TELEMETRY_INTERVAL_SECONDS)
            if not self.is_running:
                break

            elapsed = int(time.time() - self.start_time)
            remaining = max(0, self.duration_sec - elapsed)
            mem = get_memory_stats()
            heap_cur, heap_peak = tracemalloc.get_traced_memory()
            state = self.session.get_state()

            snapshot = {
                "elapsed_sec": elapsed,
                "remaining_sec": remaining,
                "rss_mb": mem.get("rss_mb", 0.0),
                "peak_rss_mb": mem.get("peak_rss_mb", 0.0),
                "heap_current_mb": round(heap_cur / (1024 * 1024), 2),
                "heap_peak_mb": round(heap_peak / (1024 * 1024), 2),
                "wallet_balance": round(state.balance, 4),
                "available_margin": round(state.available_margin, 4),
                "locked_margin": round(state.locked_margin, 4),
                "realized_pnl": round(state.realized_pnl, 4),
                "unrealized_pnl": round(state.unrealized_pnl, 4),
                "total_fees_paid": round(state.total_fees_paid, 6),
                "open_positions": len(state.positions),
                "closed_trades": len(state.closed_trades),
                "ws_frames": self.total_ws_frames,
                "trades_received": self.total_trades_received,
                "depth_received": self.total_depth_received,
                "reconnects": self.ws_reconnects,
            }
            self.telemetry_snapshots.append(snapshot)

            logger.info(
                f"[INFO] Telemetry Checkpoint [{elapsed}s/{self.duration_sec}s]: "
                f"RSS={snapshot['rss_mb']}MB, Heap={snapshot['heap_current_mb']}MB (Peak={snapshot['heap_peak_mb']}MB) | "
                f"Balance=${snapshot['wallet_balance']:.4f} (Realized=${snapshot['realized_pnl']:+.4f}, "
                f"Unrealized=${snapshot['unrealized_pnl']:+.4f}, Fees=${snapshot['total_fees_paid']:.6f}) | "
                f"OpenPos={snapshot['open_positions']}, ClosedTrades={snapshot['closed_trades']} | "
                f"WS Frames={snapshot['ws_frames']} (Trades={snapshot['trades_received']}, Depth={snapshot['depth_received']})"
            )

    async def run(self):
        tracemalloc.start()
        setup_stress_logging(STRESS_LOG_FILE)
        self.initial_memory = get_memory_stats()
        self.start_time = time.time()
        self.is_running = True

        logger.info("=" * 80)
        logger.info(f"[INFO] BOOT: Initializing 5-minute Paper Trading Stress Test & Health Check")
        logger.info(f"[INFO] Monitored Coins: {FOCUS_COINS}")
        logger.info(f"[INFO] Starting Capital: ${self.session.initial_balance:.2f} USD Virtual Wallet")
        logger.info(f"[INFO] Risk Sizing: {self.session.risk_per_trade_pct * 100:.1f}% per trade ($2.00 initial risk budget)")
        logger.info(f"[INFO] Fee Structure: Taker={self.session.taker_fee * 100:.2f}% (0.04%), Maker={self.session.maker_fee * 100:.2f}% (0.02%)")
        logger.info(f"[INFO] Planned Duration: {self.duration_sec} seconds (5 minutes)")
        logger.info(f"[INFO] Initial Memory: RSS={self.initial_memory.get('rss_mb', 0)}MB")
        logger.info("=" * 80)

        # 1. Start parallel background quant worker
        logger.info("[INFO] Starting Background Quant Worker loop...")
        worker_task = self.worker.start()

        # 2. Start WebSocket multi-stream feed
        ws_task = asyncio.create_task(self._run_ws_feed())

        # 3. Start Telemetry Monitor
        telemetry_task = asyncio.create_task(self._run_telemetry_monitor())

        try:
            # Run for exactly duration_sec seconds
            await asyncio.sleep(self.duration_sec)
        except asyncio.CancelledError:
            logger.info("[INFO] Stress test received cancellation.")
        finally:
            self.is_running = False
            logger.info("[INFO] Stopping stress test services and flushing state...")

            # Gracefully cancel background tasks
            ws_task.cancel()
            telemetry_task.cancel()
            await self.worker.stop()

            try:
                await asyncio.gather(ws_task, telemetry_task, return_exceptions=True)
            except Exception:
                pass

        # Final Telemetry Collection
        final_mem = get_memory_stats()
        heap_cur, heap_peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        final_state = self.session.get_state()
        elapsed_actual = time.time() - self.start_time

        summary = {
            "test_status": "COMPLETED",
            "duration_planned_sec": self.duration_sec,
            "duration_actual_sec": round(elapsed_actual, 2),
            "monitored_coins": FOCUS_COINS,
            "virtual_wallet": {
                "initial_balance_usd": self.session.initial_balance,
                "final_balance_usd": round(final_state.balance, 4),
                "available_margin_usd": round(final_state.available_margin, 4),
                "locked_margin_usd": round(final_state.locked_margin, 4),
                "realized_pnl_usd": round(final_state.realized_pnl, 4),
                "unrealized_pnl_usd": round(final_state.unrealized_pnl, 4),
                "total_fees_paid_usd": round(final_state.total_fees_paid, 6),
                "open_positions": final_state.positions,
                "closed_trades": final_state.closed_trades,
            },
            "memory_profiling": {
                "initial_rss_mb": self.initial_memory.get("rss_mb", 0.0),
                "final_rss_mb": final_mem.get("rss_mb", 0.0),
                "rss_delta_mb": round(final_mem.get("rss_mb", 0.0) - self.initial_memory.get("rss_mb", 0.0), 2),
                "peak_rss_mb": final_mem.get("peak_rss_mb", 0.0),
                "heap_current_mb": round(heap_cur / (1024 * 1024), 2),
                "heap_peak_mb": round(heap_peak / (1024 * 1024), 2),
            },
            "websocket_telemetry": {
                "total_frames_received": self.total_ws_frames,
                "total_trades_received": self.total_trades_received,
                "total_depth_received": self.total_depth_received,
                "reconnections_count": self.ws_reconnects,
            },
            "exceptions_caught_count": len(self.exceptions_caught),
            "exceptions_caught": self.exceptions_caught,
            "telemetry_checkpoints_count": len(self.telemetry_snapshots),
        }

        # Write summary JSON
        summary_path = STRESS_LOG_FILE.parent / "stress_test_summary.json"
        with open(summary_path, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2)

        logger.info("=" * 80)
        logger.info(f"[INFO] 5-MINUTE STRESS TEST COMPLETED SUCCESSFULLY in {elapsed_actual:.1f}s")
        logger.info(f"[INFO] Memory Profile: Start RSS={summary['memory_profiling']['initial_rss_mb']}MB, "
                    f"Final RSS={summary['memory_profiling']['final_rss_mb']}MB, "
                    f"Peak RSS={summary['memory_profiling']['peak_rss_mb']}MB, "
                    f"Heap Peak={summary['memory_profiling']['heap_peak_mb']}MB")
        logger.info(f"[INFO] Virtual Balance: ${summary['virtual_wallet']['final_balance_usd']:.4f} "
                    f"(Realized=${summary['virtual_wallet']['realized_pnl_usd']:+.4f}, "
                    f"Unrealized=${summary['virtual_wallet']['unrealized_pnl_usd']:+.4f}, "
                    f"Fees=${summary['virtual_wallet']['total_fees_paid_usd']:.6f})")
        logger.info(f"[INFO] Market Stream: {summary['websocket_telemetry']['total_frames_received']} total frames "
                    f"({summary['websocket_telemetry']['total_trades_received']} trades, "
                    f"{summary['websocket_telemetry']['total_depth_received']} depth snapshots, "
                    f"reconnections={summary['websocket_telemetry']['reconnections_count']})")
        logger.info(f"[INFO] Exceptions Caught: {len(self.exceptions_caught)}")
        logger.info(f"[INFO] Log file: {STRESS_LOG_FILE.resolve()}")
        logger.info(f"[INFO] Summary file: {summary_path.resolve()}")
        logger.info("=" * 80)

        return summary


async def main():
    runner = StressTestRunner(duration_sec=DURATION_SECONDS)
    summary = await runner.run()
    print("\n--- STRESS TEST SUMMARY JSON ---")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
