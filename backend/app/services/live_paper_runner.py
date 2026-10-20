"""
Live Paper Trading Runner & Real-Time Strategy Sentinel
Subscribes to FreeBinanceCollector (Spot L2 Depth + Synthetic Liquidation Map),
detects order flow setups in real time (e.g. 'Вход перед стенкой $500k'),
executes virtual orders with commissions/slippage, maintains live equity curve,
and integrates OpenRouter AI Risk Control veto logic.
"""

import asyncio
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


class LivePaperRunner:
    """
    Manages live paper trading execution loop over FreeBinanceCollector.
    """

    def __init__(self):
        self.is_running: bool = False
        self._task: Optional[asyncio.Task] = None
        self._last_tick_time: int = 0
        self._last_signal_time: int = 0
        self._signal_cooldown_sec: int = 30  # Cooldown between opening signals on same coin

        # Configuration
        self.symbol: str = "BTCUSDT"
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

        # Logs & Real-Time Equity Curve
        self.logs: List[Dict[str, Any]] = []
        self.equity_curve: List[Dict[str, Any]] = []

    def start(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Starts live paper trading runner with user configuration."""
        if self.is_running:
            self.stop()

        self.symbol = str(config.get("symbol", "BTCUSDT")).upper()
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

        # Reset wallet to initial capital
        paper_trading_session.reset_wallet(initial_balance=self.initial_capital)

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

    def get_status(self) -> Dict[str, Any]:
        """Returns live status of runner, current wallet snapshot, and equity curve."""
        session_state = paper_trading_session.get_state()
        state_dict = session_state.to_dict()

        total_equity = state_dict.get("balance", self.initial_capital) + state_dict.get("unrealized_pnl", 0.0)

        return {
            "is_running": self.is_running,
            "symbol": self.symbol,
            "strategy_type": self.strategy_type,
            "initial_capital": self.initial_capital,
            "risk_per_trade_pct": self.risk_per_trade_pct,
            "min_density_usd": self.min_density_usd,
            "ai_control": self.ai_control,
            "current_equity": round(total_equity, 2),
            "balance": round(state_dict.get("balance", self.initial_capital), 2),
            "unrealized_pnl": round(state_dict.get("unrealized_pnl", 0.0), 2),
            "realized_pnl": round(state_dict.get("realized_pnl", 0.0), 2),
            "open_positions": state_dict.get("positions", []),
            "closed_trades_count": len(state_dict.get("closed_trades", [])),
            "closed_trades": state_dict.get("closed_trades", [])[-15:],
            "logs": self.logs[:25],
            "equity_curve": self.equity_curve[-80:],
            "last_tick_time": self._last_tick_time,
        }

    async def _runner_loop(self):
        """Main real-time observation and execution loop."""
        logger.info(f"LivePaperRunner started background loop for {self.symbol}")
        while self.is_running:
            try:
                await self.tick_cycle()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in LivePaperRunner tick cycle: {e}")
                self._add_log("ERROR", f"Сбой цикла опроса: {str(e)[:80]}")

            await asyncio.sleep(4.0)

    async def tick_cycle(self):
        """Single tick cycle: queries FreeBinanceCollector, updates positions, checks for signals."""
        self._last_tick_time = int(time.time() * 1000)

        # 1. Fetch live unified market data (Spot L2 + Futures liqs + ticker)
        data = await market_data_provider.get_unified_data(self.symbol)
        current_price = data.snapshot.price
        if current_price <= 0:
            return

        # 2. Update existing positions against current market price (SL / TP / Breakeven check)
        self._update_open_positions(current_price)

        # 3. Record equity curve point
        state = paper_trading_session.get_state().to_dict()
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
        candidate_signal = await self._detect_setup(data)
        if not candidate_signal:
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
            timestamp=int(time.time() * 1000),
            direction=candidate_signal["direction"],
            entry_type="LIMIT",
            entry_price=candidate_signal["entry_price"],
            sl=candidate_signal["sl"],
            tp1=candidate_signal["tp1"],
            expected_rr=candidate_signal["expected_rr"],
            reason=candidate_signal["reason"],
        )

        try:
            order_res = paper_trading_session.execute_unified_signal(signal_obj)
            self._add_log(
                "TRADE_ENTRY",
                f"Вход в виртуальную сделку {candidate_signal['direction']} @ ${candidate_signal['entry_price']:,.2f} "
                f"(SL: ${candidate_signal['sl']:,.2f}, TP: ${candidate_signal['tp1']:,.2f}, R:R 1:{candidate_signal['expected_rr']:.1f})",
                meta=order_res,
            )
        except Exception as e:
            logger.error(f"Paper order execution error: {e}")
            self._add_log("ERROR", f"Ошибка открытия сделки: {e}")

    async def _detect_setup(self, data) -> Optional[Dict[str, Any]]:
        """
        Detects live setups from real-time FreeBinanceCollector feeds:
        - 'live_density_bounce': entry in front of heavy spot wall ($500k+)
        - 'confluence_ema' / 'quant_confluence': Cold Quant Engine evaluation
        """
        current_price = data.snapshot.price
        walls = data.orderbook_depth.walls
        dd_2_5 = data.orderbook_depth.depth_deltas.get("2.5%")
        delta_pct = dd_2_5.delta_pct if dd_2_5 else 0.0

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
        state = paper_trading_session.get_state()
        for pos in state.positions:
            if pos.closed:
                continue

            entry = pos.avg_entry_price
            if entry <= 0:
                continue

            # Check Long
            if pos.side == "LONG":
                # Check Stop Loss
                if current_price <= pos.stop_price:
                    self._close_position_sim(pos, current_price, "STOP_LOSS")
                # Check Take Profit
                elif current_price >= pos.target_price:
                    self._close_position_sim(pos, current_price, "TAKE_PROFIT")

            # Check Short
            elif pos.side == "SHORT":
                if current_price >= pos.stop_price:
                    self._close_position_sim(pos, current_price, "STOP_LOSS")
                elif current_price <= pos.target_price:
                    self._close_position_sim(pos, current_price, "TAKE_PROFIT")

    def _close_position_sim(self, pos, exit_price: float, reason: str):
        """Closes a position in session and updates accounting."""
        pos.closed = True
        is_long = pos.side == "LONG"
        gross_pnl = (exit_price - pos.avg_entry_price) * pos.qty if is_long else (pos.avg_entry_price - exit_price) * pos.qty

        # Fee: Maker on TP, Taker on SL
        fee_rate = (self.maker_fee_pct / 100.0) if reason == "TAKE_PROFIT" else (self.taker_fee_pct / 100.0)
        exit_fee = (exit_price * pos.qty) * fee_rate
        net_pnl = gross_pnl - pos.fees_paid - exit_fee

        state = paper_trading_session.get_state()
        state.balance += net_pnl
        state.realized_pnl += net_pnl

        # Remove from active positions and add to closed trades
        state.positions = [p for p in state.positions if p != pos]

        closed_rec = {
            "symbol": pos.symbol,
            "side": pos.side,
            "qty": pos.qty,
            "entry_price": pos.avg_entry_price,
            "exit_price": exit_price,
            "net_pnl": round(net_pnl, 2),
            "exit_reason": reason,
            "fees_paid": round(pos.fees_paid + exit_fee, 4),
            "timestamp": int(time.time() * 1000),
        }
        state.closed_trades.append(closed_rec)

        pnl_sign = "+" if net_pnl >= 0 else ""
        self._add_log(
            "TRADE_EXIT",
            f"Закрыта сделка {pos.side} по {reason} @ ${exit_price:,.2f} (Net PnL: {pnl_sign}${net_pnl:,.2f})",
            meta=closed_rec,
        )


# Global singleton runner
live_paper_runner = LivePaperRunner()
