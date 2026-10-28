"""
Paper Trading Session: Virtual Balance & Shadow Position Manager
================================================================
Manages a virtual trading session on top of `ExecutionSimulator`
(new layer — never modifies the golden-baseline modules below):

- orderflow_backtester.py  (untouched)
- limit_fill_simulator.py  (untouched)
- execution_simulator.py   (untouched — we only CONSUME it)

CORE GUARANTEES (Category Invariants):
1. Zero Look-Ahead: every event is forwarded to the ExecutionSimulator
   which enforces `event.timestamp >= order_active_ts` internally.
2. Deterministic: no `random()` anywhere. All state transitions are pure
   functions of the event stream.
3. Balance accounting: `available_margin`, `locked_margin`, `realized_pnl`
   and `unrealized_pnl` are updated on every partial/full fill and on
   every price tick.
"""
import logging
import math
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

from backend.app.services.early_exit_engine import EarlyExitEngine
from backend.app.services.execution_simulator import (
    DEFAULT_MAKER_FEE,
    DEFAULT_ORDER_RTT_MS,
    DEFAULT_SIGNAL_LAG_MS,
    DEFAULT_TAKER_FEE,
    ExecutionSimulator,
    OrderConfig,
    OrderSide,
    OrderStatus,
    OrderType,
)
from backend.app.services.risk_profile import SharedRiskProfile

logger = logging.getLogger(__name__)


class PaperOrderRole(str, Enum):
    ENTRY = "entry"
    EXIT = "exit"


@dataclass
class PaperPosition:
    """An open virtual position (may be partially filled / accumulated)."""
    symbol: str
    side: str  # "LONG" | "SHORT"
    qty: float = 0.0
    avg_entry_price: float = 0.0
    entry_ts: int = 0
    stop_price: float = 0.0
    initial_stop_price: float = 0.0
    target_price: float = 0.0
    tp2_price: float = 0.0
    tp1_filled: bool = False
    trailing_high_price: float = 0.0
    trailing_low_price: float = 0.0
    fees_paid: float = 0.0
    slippage_paid: float = 0.0
    closed: bool = False
    breakeven_triggered: bool = False
    reason: str = "Technical Signal"
    context_snapshot: Optional[Dict[str, Any]] = None
    leverage: float = 1.0
    effective_leverage: float = 1.0
    regime: str = "NO_TRADE"
    expected_rr: float = 1.5
    margin_used: float = 0.0
    initial_risk_usd: float = 0.0

    @property
    def risk_amount(self) -> float:
        """R in absolute USDT: distance to initial stop * qty (fallback: notional * 0.005)."""
        ref_stop = self.initial_stop_price if self.initial_stop_price > 0 else self.stop_price
        if ref_stop > 0 and self.avg_entry_price > 0:
            return abs(self.avg_entry_price - ref_stop) * self.qty
        return self.avg_entry_price * self.qty * 0.005

    def unrealized_pnl(self, last_price: float) -> float:
        if self.qty <= 0 or self.avg_entry_price <= 0:
            return 0.0
        if self.side == "LONG":
            gross = (last_price - self.avg_entry_price) * self.qty
        else:
            gross = (self.avg_entry_price - last_price) * self.qty
        return gross - self.fees_paid


@dataclass
class PaperOrder:
    """A virtual order proxied into the ExecutionSimulator."""
    order_id: str
    symbol: str
    role: PaperOrderRole
    sim: ExecutionSimulator
    created_ts: int
    last_fill_idx: int = 0  # how many sim.state.fills already accounted
    reason: str = "Technical Signal"
    context_snapshot: Optional[Dict[str, Any]] = None
    tp2_price: float = 0.0
    stop_price: float = 0.0
    target_price: float = 0.0
    leverage: float = 1.0
    reserved_margin: float = 0.0
    reserved_risk: float = 0.0


@dataclass
class PaperSessionState:
    """Serializable snapshot of the session (for REST / WebSocket)."""
    session_id: str
    initial_balance: float
    available_margin: float
    locked_margin: float
    realized_pnl: float
    unrealized_pnl: float
    balance: float
    reserved_margin: float = 0.0
    reserved_risk: float = 0.0
    positions: List[dict] = field(default_factory=list)
    active_orders: List[dict] = field(default_factory=list)
    closed_trades: List[dict] = field(default_factory=list)
    total_fees_paid: float = 0.0
    total_slippage_paid: float = 0.0
    total_funding_paid: float = 0.0
    uptime_seconds: int = 0
    is_halted: bool = False
    halt_reason: Optional[str] = None
    halt_ts: Optional[int] = None
    updated_at: Optional[int] = None

    def to_dict(self) -> dict:
        return {
            # ``session_id`` is retained for legacy consumers.  The explicit
            # alias makes it clear that this stable wallet identity is not a
            # per-request status identifier.
            "session_id": self.session_id,
            "account_id": self.session_id,
            "initial_balance": self.initial_balance,
            "available_margin": self.available_margin,
            "locked_margin": self.locked_margin,
            "realized_pnl": self.realized_pnl,
            "unrealized_pnl": self.unrealized_pnl,
            "balance": self.balance,
            "reserved_margin": self.reserved_margin,
            "reserved_risk": self.reserved_risk,
            "positions": self.positions,
            "active_orders": self.active_orders,
            "closed_trades": self.closed_trades,
            "total_fees_paid": self.total_fees_paid,
            "total_slippage_paid": self.total_slippage_paid,
            "total_funding_paid": self.total_funding_paid,
            "uptime_seconds": self.uptime_seconds,
            "is_halted": self.is_halted,
            "halt_reason": self.halt_reason,
            "halt_ts": self.halt_ts,
            "updated_at": self.updated_at,
        }


class PaperTradingSession:
    """
    Virtual trading session.

    Lifecycle:
      place_order(entry) -> feed events -> position opens on fills
      -> place_order(exit) -> feed events -> position closes -> PnL realized.
    """

    def __init__(
        self,
        initial_balance: float = 100.0,
        risk_per_trade_pct: float = 0.02,
        maker_fee: float = DEFAULT_MAKER_FEE,
        taker_fee: float = DEFAULT_TAKER_FEE,
        signal_lag_ms: int = DEFAULT_SIGNAL_LAG_MS,
        order_rtt_ms: int = DEFAULT_ORDER_RTT_MS,
        session_id: Optional[str] = None,
    ):
        self.session_id = session_id or f"paper_{int(time.time() * 1000)}"
        self.start_time = time.time()
        self.initial_balance = float(initial_balance)
        self.risk_per_trade_pct = float(risk_per_trade_pct)
        self.leverage = 1.0
        self.maker_fee = maker_fee
        self.taker_fee = taker_fee
        self.signal_lag_ms = signal_lag_ms
        self.order_rtt_ms = order_rtt_ms
        # Максимальное отклонение fill'а входа от цены сигнала, % (0 = guard выключен).
        # Защита от протухших снапшотов: уровни SL/TP считаются от цены сигнала,
        # и вход с отклонением больше порога делает сетап бессмысленным/убыточным.
        self.max_entry_slippage_pct: float = 0.0

        # Balance accounting (all in USDT)
        self.realized_pnl = 0.0
        self.available_margin = float(initial_balance)
        self.locked_margin = 0.0
        self.total_fees_paid = 0.0
        self.total_slippage_paid = 0.0
        self.total_funding_paid = 0.0

        # Live state
        self.orders: Dict[str, PaperOrder] = {}
        self.positions: Dict[str, PaperPosition] = {}  # key: symbol
        self.closed_trades: List[dict] = []
        self.last_prices: Dict[str, float] = {}
        self.last_market_slippage_bps: Dict[str, float] = {}
        self._last_event_ts = 0
        self._closure_sequence = 0
        self._lifecycle_listener: Optional[Callable[[str, Dict[str, Any]], None]] = None

        # Early Exit Engine (MFE/MAE tracker + alert rule engine)
        self.early_exit_engine = EarlyExitEngine()

        # Kill Switch / Circuit Breaker State
        self.is_halted: bool = False
        self.halt_reason: Optional[str] = None
        self.halt_ts: Optional[int] = None
        self.paused_symbols: set = set()

    def set_lifecycle_listener(
        self,
        listener: Optional[Callable[[str, Dict[str, Any]], None]],
    ) -> None:
        """Attach the runner-owned observer for fills that change trade state."""
        self._lifecycle_listener = listener

    def _append_closed_trade(self, trade: Dict[str, Any]) -> None:
        """Store one realized exit and notify telemetry at the same state boundary."""
        self._closure_sequence += 1
        trade["closure_id"] = f"{self.session_id}:{self._closure_sequence}"
        self.closed_trades.append(trade)
        if len(self.closed_trades) > 1000:
            self.closed_trades = self.closed_trades[-1000:]
        if self._lifecycle_listener is None:
            return
        try:
            self._lifecycle_listener("POSITION_EXIT_FILLED", dict(trade))
        except Exception:
            logger.exception("[PaperSession] lifecycle listener failed for %s", trade.get("symbol"))

    def set_fee_rates_percent(self, maker_fee_pct: float, taker_fee_pct: float) -> None:
        """Apply the API/backtest fee convention (percent, e.g. 0.05 = 5 bps)."""
        self.maker_fee = max(0.0, float(maker_fee_pct)) / 100.0
        self.taker_fee = max(0.0, float(taker_fee_pct)) / 100.0

    def calculate_position_size(
        self,
        symbol: str,
        entry_price: float,
        stop_price: float = 0.0,
        risk_pct: Optional[float] = None,
        leverage: Optional[float] = None,
    ) -> float:
        """
        Calculate trade position size using institutional risk management:
        Risk budget = available_margin * risk_per_trade_pct (default: 2% -> $2.00 on $100.00 wallet).
        If stop_price > 0: quantity = risk_budget / abs(entry_price - stop_price).
        If stop_price is not provided: uses a conservative 1.5% stop distance.
        Max order quantity is bounded so notional cost never exceeds available margin.
        """
        if entry_price <= 0:
            return 0.0
        pct = risk_pct if risk_pct is not None else self.risk_per_trade_pct
        risk_budget = self.available_margin * pct

        if stop_price > 0 and abs(entry_price - stop_price) > 1e-9:
            sl_distance = abs(entry_price - stop_price)
        else:
            sl_distance = entry_price * 0.015

        qty = risk_budget / sl_distance
        effective_leverage = max(1.0, float(leverage if leverage is not None else self.leverage))
        max_qty = max(0.0, self.available_margin * effective_leverage / entry_price)
        return min(qty, max_qty)

    # ------------------------------------------------------------------ #
    #  Order placement (proxy into ExecutionSimulator)
    # ------------------------------------------------------------------ #
    def place_order(
        self,
        symbol: str,
        side: str,
        order_type: str,
        price: float,
        quantity: float,
        role: str = PaperOrderRole.ENTRY.value,
        stop_price: float = 0.0,
        target_price: float = 0.0,
        reason: str = "Technical Signal",
        signal_ts: Optional[int] = None,
        regime: Optional[str] = None,
        context_snapshot: Optional[Dict[str, Any]] = None,
        tp2_price: float = 0.0,
        leverage: float = 1.0,
        risk_pct: Optional[float] = None,
    ) -> dict:
        """
        Create a virtual order. Returns an order info dict.
        Deterministic: order_id is derived from a monotonic counter, not uuid.
        """
        if self.is_halted and role == PaperOrderRole.ENTRY.value:
            logger.warning(f"[KILL_SWITCH] Entry order rejected: system is HALTED ({self.halt_reason})")
            raise ValueError(f"System is HALTED: {self.halt_reason}")

        if role == PaperOrderRole.ENTRY.value and symbol.upper() in self.paused_symbols:
            logger.warning(f"[PAIR_CONTROL] Entry order rejected for {symbol}: PAIR_PAUSED")
            raise ValueError(f"Trading paused for {symbol}: PAIR_PAUSED")

        if role == PaperOrderRole.ENTRY.value and regime and str(regime).upper() == "TOXIC_VOLATILITY":
            logger.warning(f"[TRADE] Entry order rejected for {symbol}: TOXIC_VOLATILITY regime blocks entries")
            raise ValueError(f"Trading blocked: TOXIC_VOLATILITY regime for {symbol}")

        if role == PaperOrderRole.ENTRY.value:
            position = self.positions.get(symbol)
            if position and not position.closed and position.qty > 0:
                raise ValueError(f"entry_already_open: {symbol}")
            if any(
                order.symbol == symbol
                and order.role == PaperOrderRole.ENTRY
                and order.sim.state.status in (OrderStatus.PENDING, OrderStatus.ACTIVE, OrderStatus.PARTIALLY_FILLED)
                for order in self.orders.values()
            ):
                raise ValueError(f"entry_already_working: {symbol}")

            if not all(math.isfinite(float(value)) for value in (price, quantity, stop_price, leverage)) or price <= 0 or quantity <= 0:
                raise ValueError(f"invalid_entry_size: {symbol}")
            effective_leverage = max(1.0, float(leverage))
            stop_distance = abs(float(price) - float(stop_price)) if stop_price > 0 else float(price) * 0.015
            risk_amount = float(quantity) * stop_distance
            effective_risk_pct = risk_pct if risk_pct is not None else self.risk_per_trade_pct
            risk_budget = max(0.0, self.initial_balance + self.realized_pnl) * max(0.0, effective_risk_pct)
            if risk_amount > risk_budget + 1e-9:
                raise ValueError(f"risk_budget_exceeded: {symbol} ({risk_amount:.4f} > {risk_budget:.4f})")
            required_margin = float(price) * float(quantity) / effective_leverage
            if required_margin > self.available_margin + 1e-9:
                raise ValueError(f"insufficient_margin: {symbol}")

        if role == PaperOrderRole.EXIT.value:
            # Replace-семантика: не копим конкурирующие exit-ордера по одной позиции.
            # Ранее каждый тик с ценой >= target ставил новый TP-ордер (12+ дублей
            # за минуту); при пробое цены обратно через уровень это дало бы серию
            # fill'ов сверх qty позиции (oversell). Сначала отменяем working-выходы.
            for existing_id, existing in list(self.orders.items()):
                if (
                    existing.symbol == symbol
                    and existing.role == PaperOrderRole.EXIT
                    and existing.sim.state.status in (OrderStatus.PENDING, OrderStatus.ACTIVE, OrderStatus.PARTIALLY_FILLED)
                ):
                    self.cancel_order(existing_id)

        ts = signal_ts if signal_ts is not None else self._last_event_ts
        cfg = OrderConfig(
            signal_ts=int(ts),
            side=OrderSide(side),
            order_type=OrderType(order_type),
            price=float(price),
            quantity=float(quantity),
            signal_lag_ms=self.signal_lag_ms,
            order_rtt_ms=self.order_rtt_ms,
            maker_fee=self.maker_fee,
            taker_fee=self.taker_fee,
            symbol=symbol,
        )
        # Deterministic id: seq counter + ts (no uuid/random).
        seq = len(self.orders) + 1
        order_id = f"po_{seq}_{int(ts)}"
        sim = ExecutionSimulator(cfg)
        po = PaperOrder(
            order_id=order_id,
            symbol=symbol,
            role=PaperOrderRole(role),
            sim=sim,
            created_ts=int(ts),
            reason=reason,
            stop_price=float(stop_price),
            target_price=float(target_price),
            tp2_price=float(tp2_price),
            leverage=max(1.0, float(leverage)),
            context_snapshot=context_snapshot,
            reserved_margin=required_margin if role == PaperOrderRole.ENTRY.value else 0.0,
            reserved_risk=risk_amount if role == PaperOrderRole.ENTRY.value else 0.0,
        )
        self.orders[order_id] = po
        if po.role == PaperOrderRole.ENTRY:
            self.available_margin -= po.reserved_margin
            self.locked_margin += po.reserved_margin

        # Prune old completed orders if orders buffer exceeds 2000
        if len(self.orders) > 2000:
            active = {k: v for k, v in self.orders.items() if v.sim.state.status in (OrderStatus.PENDING, OrderStatus.ACTIVE, OrderStatus.PARTIALLY_FILLED)}
            completed = [(k, v) for k, v in self.orders.items() if k not in active][-500:]
            self.orders = {**dict(completed), **active}

        logger.info(
            f"[TRADE] ORDER PLACED [{self.session_id}] {role.upper()} order {order_id}: "
            f"{side} {order_type} {quantity:.6f} {symbol} @ {price:.4f} | reason='{reason}' "
            f"(active_ts={cfg.order_active_ts})"
        )
        return self._order_info(po)

    def _order_info(self, po: PaperOrder) -> dict:
        st = po.sim.state
        return {
            "order_id": po.order_id,
            "symbol": po.symbol,
            "role": po.role.value,
            "side": po.sim.cfg.side.value,
            "order_type": po.sim.cfg.order_type.value,
            "price": po.sim.cfg.price,
            "quantity": po.sim.cfg.quantity,
            "status": st.status.value,
            "filled_qty": st.filled_qty,
            "remaining_qty": st.remaining_qty,
            "queue_ahead": st.queue_ahead,
            "active_ts": po.sim.cfg.order_active_ts,
            "created_ts": po.created_ts,
            "reason": po.reason,
            "stop_price": po.stop_price,
            "target_price": po.target_price,
            "tp2_price": po.tp2_price,
            "context_snapshot": po.context_snapshot,
            "reserved_margin": po.reserved_margin,
            "reserved_risk": po.reserved_risk,
        }

    def _release_entry_reservation(self, po: PaperOrder) -> None:
        if po.role != PaperOrderRole.ENTRY:
            return
        self.available_margin += po.reserved_margin
        self.locked_margin = max(0.0, self.locked_margin - po.reserved_margin)
        po.reserved_margin = 0.0
        po.reserved_risk = 0.0

    def cancel_order(self, order_id: str) -> bool:
        """Cancel a working virtual order and release unfilled entry collateral."""
        po = self.orders.get(order_id)
        if po is None or po.sim.state.status in (OrderStatus.FILLED, OrderStatus.REJECTED, OrderStatus.CANCELLED):
            return False
        po.sim.state.status = OrderStatus.CANCELLED
        self._release_entry_reservation(po)
        return True

    @staticmethod
    def estimate_tick_size(price: float) -> float:
        """Estimates minimum tick size for crypto assets."""
        if price <= 0:
            return 0.01
        if price >= 10000:
            return 0.1
        elif price >= 1000:
            return 0.01
        elif price >= 10:
            return 0.001
        elif price >= 1:
            return 0.0001
        else:
            return 0.00001

    def check_dynamic_breakeven(self, symbol: str, current_price: float, be_r_trigger: float = 0.5) -> bool:
        """
        Dynamic Breakeven (MFE Bleed Protection):
        When floating profit reaches +0.5R (where R = abs(entry - initial_sl)),
        Stop-Loss is automatically moved to Breakeven:
        Entry + (Fee * 2) + 1 tick (Long)
        Entry - (Fee * 2) - 1 tick (Short)
        Accounts for double fee + tick size so net outcome is strictly zero or slight profit.
        """
        pos = self.positions.get(symbol)
        if not pos or pos.closed or pos.qty <= 0 or current_price <= 0:
            return False

        if pos.breakeven_triggered:
            return False

        ref_sl = pos.initial_stop_price if pos.initial_stop_price > 0 else pos.stop_price
        if ref_sl <= 0 or abs(pos.avg_entry_price - ref_sl) < 1e-9:
            r_dist = pos.avg_entry_price * 0.015
        else:
            r_dist = abs(pos.avg_entry_price - ref_sl)

        entry = pos.avg_entry_price
        fee_rate = self.taker_fee * 2.0
        fee_offset = entry * fee_rate
        tick = self.estimate_tick_size(entry)
        trigger_dist = float(be_r_trigger) * r_dist

        if pos.side == "LONG":
            floating_pnl_dist = current_price - entry
            if floating_pnl_dist >= trigger_dist:
                new_sl = entry + fee_offset + tick
                pos.breakeven_triggered = True
                if new_sl > pos.stop_price:
                    old_sl = pos.stop_price
                    pos.stop_price = new_sl
                    logger.info(
                        f"[TRADE] DYNAMIC BREAKEVEN [{self.session_id}] {symbol} LONG: "
                        f"MFE reached +{be_r_trigger:.2f}R (+{floating_pnl_dist:.4f} >= {trigger_dist:.4f}). "
                        f"SL moved {old_sl:.4f} -> {new_sl:.4f} (+2*Fee+1tick) | reason='Dynamic Breakeven (MFE Bleed Protection)'"
                    )
                    return True
        elif pos.side == "SHORT":
            floating_pnl_dist = entry - current_price
            if floating_pnl_dist >= trigger_dist:
                new_sl = entry - fee_offset - tick
                pos.breakeven_triggered = True
                if pos.stop_price <= 0 or new_sl < pos.stop_price:
                    old_sl = pos.stop_price
                    pos.stop_price = new_sl
                    logger.info(
                        f"[TRADE] DYNAMIC BREAKEVEN [{self.session_id}] {symbol} SHORT: "
                        f"MFE reached +{be_r_trigger:.2f}R (+{floating_pnl_dist:.4f} >= {trigger_dist:.4f}). "
                        f"SL moved {old_sl:.4f} -> {new_sl:.4f} (-2*Fee-1tick) | reason='Dynamic Breakeven (MFE Bleed Protection)'"
                    )
                    return True

        return False

    # ------------------------------------------------------------------ #
    #  Event feeding
    # ------------------------------------------------------------------ #
    def process_event(self, event) -> None:
        """
        Feed one ReplayEvent into the session.
        Every working order's simulator receives the event (zero look-ahead
        is enforced inside ExecutionSimulator.process_event).
        """
        ts = int(getattr(event, "timestamp", 0))
        self._last_event_ts = max(self._last_event_ts, ts)

        kind = getattr(event, "kind", "")
        if kind in ("trade", "mark"):
            price = float(event.payload.get("price", 0.0))
            symbol = getattr(event, "symbol", None) or event.payload.get("symbol")
            if symbol and price > 0:
                self.last_prices[symbol] = price

                # Check Dynamic Breakeven (+0.5R MFE protection)
                self.check_dynamic_breakeven(symbol, price)

                # --- Early Exit Engine integration (MFE/MAE + alerts) ---
                self.early_exit_engine.on_price_update(symbol, price, ts)
                track = self.early_exit_engine.tracks.get(symbol)
                if track:
                    self.early_exit_engine.evaluate_position(track)
                # --------------------------------------------------------


        ev_symbol = getattr(event, "symbol", None) or (getattr(event, "payload", {}) or {}).get("symbol")

        # Forward to all working orders matching this event's symbol (snapshot — orders may complete mid-loop)
        for po in list(self.orders.values()):
            if ev_symbol and po.symbol and str(ev_symbol).upper() != str(po.symbol).upper():
                continue
            if po.sim.state.status in (OrderStatus.FILLED, OrderStatus.REJECTED, OrderStatus.CANCELLED):
                if po.sim.state.status in (OrderStatus.REJECTED, OrderStatus.CANCELLED):
                    self._release_entry_reservation(po)
                continue
            prev_filled = po.sim.state.filled_qty
            po.sim.process_event(event)
            if po.sim.state.filled_qty > prev_filled + 1e-12:
                self._on_order_fill(po)
            if po.sim.state.status in (OrderStatus.REJECTED, OrderStatus.CANCELLED):
                self._release_entry_reservation(po)

    def process_market_tick(
        self,
        symbol: str,
        price: float,
        bids: Optional[List[tuple]] = None,
        asks: Optional[List[tuple]] = None,
        timestamp: Optional[int] = None,
        market_slippage_bps: float = 0.0,
    ) -> None:
        """Feed one real live price/depth observation into the paper engine.

        The live adapter does not invent a candle or quote. It forwards the
        observed Binance price and current L2 snapshot to the same execution
        simulator used by replay/backtest paper tests.
        """
        if price <= 0:
            return
        from types import SimpleNamespace

        ts = int(timestamp if timestamp is not None else time.time() * 1000)
        self.last_market_slippage_bps[symbol] = max(0.0, float(market_slippage_bps))
        def _book_levels(levels):
            normalized = []
            for level in levels or []:
                if hasattr(level, "price") and hasattr(level, "size"):
                    normalized.append((float(level.price), float(level.size)))
                else:
                    normalized.append((float(level[0]), float(level[1])))
            return normalized

        self.process_event(SimpleNamespace(
            timestamp=ts,
            kind="depth",
            symbol=symbol,
            payload={"bids": _book_levels(bids), "asks": _book_levels(asks)},
        ))
        self.process_event(SimpleNamespace(
            timestamp=ts,
            kind="mark",
            symbol=symbol,
            payload={
                "price": float(price),
                "market_slippage_bps": max(0.0, float(market_slippage_bps)),
            },
        ))

    def _on_order_fill(self, po: PaperOrder) -> None:
        """Account for newly appeared fills of an order."""
        st = po.sim.state
        new_fills = st.fills[po.last_fill_idx:]
        po.last_fill_idx = len(st.fills)
        for fill in new_fills:
            self._apply_fill(po, fill)

    def _apply_fill(self, po: PaperOrder, fill) -> None:
        """Apply one Fill to the virtual balance / position book."""
        symbol = po.symbol
        price = float(fill.price)
        qty = float(fill.quantity)
        fee = float(fill.fee)
        slippage_cost = float(getattr(fill, "slippage_cost", 0.0))
        if po.role == PaperOrderRole.ENTRY:
            self._apply_entry_fill(symbol, po, price, qty, fee, slippage_cost)
        else:
            self._apply_exit_fill(symbol, po, price, qty, fee, slippage_cost)

    def _apply_entry_fill(self, symbol: str, po: PaperOrder, price: float, qty: float, fee: float, slippage_cost: float) -> None:
        # Guard протухшего снапшота: fill сильно ушёл от цены сигнала — сетап
        # (SL/TP посчитаны от цены сигнала) уже невалиден; отклоняем fill входа.
        max_slip_pct = float(getattr(self, "max_entry_slippage_pct", 0.0) or 0.0)
        ref_price = float(po.sim.cfg.price)
        if max_slip_pct > 0 and ref_price > 0:
            deviation_pct = abs(float(price) - ref_price) / ref_price * 100.0
            if deviation_pct > max_slip_pct:
                po.sim.state.status = OrderStatus.REJECTED
                self._release_entry_reservation(po)
                logger.warning(
                    f"[TRADE] ENTRY fill REJECTED [{self.session_id}] {symbol}: "
                    f"fill {price:.6f} отклоняется от цены сигнала {ref_price:.6f} "
                    f"на {deviation_pct:.3f}% > max_entry_slippage_pct={max_slip_pct:.3f}% | reason='{po.reason}'"
                )
                return
        pos = self.positions.get(symbol)
        entry_side = po.sim.cfg.side.value  # BUY -> LONG, SELL -> SHORT
        pos_side = "LONG" if entry_side == "BUY" else "SHORT"

        if pos is None or pos.closed or pos.qty <= 0:
            stop_px = float(getattr(po, "stop_price", 0.0))
            snap = getattr(po, "context_snapshot", {}) or {}
            pos_regime = snap.get("regime") or "NO_TRADE"
            pos_eff_lev = float(snap.get("effective_leverage") or 0.0)
            pos_expected_rr = float(snap.get("expected_rr") or 1.5)
            pos = PaperPosition(
                symbol=symbol,
                side=pos_side,
                qty=0.0,
                avg_entry_price=0.0,
                entry_ts=po.created_ts,
                stop_price=stop_px,
                initial_stop_price=stop_px,
                target_price=float(getattr(po, "target_price", 0.0)),
                tp2_price=float(getattr(po, "tp2_price", 0.0)),
                reason=getattr(po, "reason", "Technical Signal"),
                breakeven_triggered=False,
                leverage=max(1.0, float(getattr(po, "leverage", 1.0))),
                effective_leverage=pos_eff_lev,
                regime=pos_regime,
                expected_rr=pos_expected_rr,
                context_snapshot=po.context_snapshot,
            )
            self.positions[symbol] = pos
        else:
            pos.reason = getattr(po, "reason", pos.reason)
            if getattr(po, "stop_price", 0.0) > 0 and pos.stop_price <= 0:
                pos.stop_price = float(po.stop_price)
                pos.initial_stop_price = float(po.stop_price)
            if getattr(po, "target_price", 0.0) > 0:
                pos.target_price = float(po.target_price)
            if getattr(po, "tp2_price", 0.0) > 0:
                pos.tp2_price = float(po.tp2_price)
            if getattr(po, "context_snapshot", None):
                pos.context_snapshot = po.context_snapshot
                snap = po.context_snapshot
                if "regime" in snap:
                    pos.regime = str(snap["regime"])
                if "effective_leverage" in snap:
                    pos.effective_leverage = float(snap["effective_leverage"])
                if "expected_rr" in snap:
                    pos.expected_rr = float(snap["expected_rr"])

        if pos.side != pos_side:
            logger.warning(f"[PaperSession] conflicting side for {symbol}: {pos.side} vs {pos_side}")
            return

        # Weighted average entry price
        total_qty = pos.qty + qty
        pos.avg_entry_price = ((pos.avg_entry_price * pos.qty) + (price * qty)) / total_qty
        pos.qty = total_qty
        pos.fees_paid += fee
        pos.slippage_paid += slippage_cost
        pos.entry_ts = pos.entry_ts or po.created_ts

        # Convert only this fill's pending collateral to position margin.
        reserved_slice = min(po.reserved_margin, po.sim.cfg.price * qty / po.leverage)
        po.reserved_margin = max(0.0, po.reserved_margin - reserved_slice)
        risk_distance = abs(po.sim.cfg.price - po.stop_price) if po.stop_price > 0 else po.sim.cfg.price * 0.015
        po.reserved_risk = max(0.0, po.reserved_risk - risk_distance * qty)

        # Lock margin for the position (entry notional as margin)
        margin_used = price * qty / max(1.0, pos.leverage)
        pos.margin_used += margin_used
        self.locked_margin += margin_used - reserved_slice
        self.available_margin += reserved_slice - margin_used
        self.total_fees_paid += fee
        self.total_slippage_paid += slippage_cost

        # Fixed structural risk dollar amount at entry (locked permanently for R calculations)
        if pos.initial_risk_usd <= 0.0:
            init_sl = pos.initial_stop_price if pos.initial_stop_price > 0 else pos.stop_price
            dist = abs(pos.avg_entry_price - init_sl) if init_sl > 0 else (pos.avg_entry_price * 0.015)
            pos.initial_risk_usd = max(1e-6, dist * pos.qty)

        logger.info(
            f"[TRADE] ENTRY fill [{self.session_id}] {symbol}: "
            f"+{qty:.6f} @ {price:.4f} fee={fee:.6f} -> pos_qty={pos.qty:.6f} avg={pos.avg_entry_price:.4f} | reason='{pos.reason}'"
        )

        # Register/Update position in the Early Exit Engine
        self.early_exit_engine.register_position(
            symbol=symbol,
            side=pos.side,
            entry_price=pos.avg_entry_price,
            entry_ts=pos.entry_ts,
            qty=pos.qty,
            risk_amount=pos.risk_amount,
        )


    def _apply_exit_fill(self, symbol: str, po: PaperOrder, price: float, qty: float, fee: float, slippage_cost: float) -> None:
        pos = self.positions.get(symbol)
        if pos is None or pos.closed or pos.qty <= 0:
            logger.warning(f"[PaperSession] exit fill without open position: {symbol}")
            return

        exit_side = po.sim.cfg.side.value  # SELL closes LONG, BUY closes SHORT
        expected = "SELL" if pos.side == "LONG" else "BUY"
        if exit_side != expected:
            logger.warning(f"[PaperSession] exit side mismatch for {symbol}: {exit_side} vs {expected}")
            return

        close_qty = min(qty, pos.qty)
        open_qty_before_exit = pos.qty
        # Allocate entry fees proportionally so Net PnL stays truthful on partial exits.
        entry_fee_share = pos.fees_paid * (close_qty / open_qty_before_exit) if open_qty_before_exit > 0 else 0.0
        entry_slippage_share = pos.slippage_paid * (close_qty / open_qty_before_exit) if open_qty_before_exit > 0 else 0.0
        if pos.side == "LONG":
            gross = (price - pos.avg_entry_price) * close_qty
        else:
            gross = (pos.avg_entry_price - price) * close_qty
        net = gross - entry_fee_share - fee
        self.realized_pnl += net
        pos.fees_paid = max(0.0, pos.fees_paid - entry_fee_share)
        pos.slippage_paid = max(0.0, pos.slippage_paid - entry_slippage_share)
        self.total_fees_paid += fee
        self.total_slippage_paid += slippage_cost
        pos.qty -= close_qty

        pnl_pct = ((price - pos.avg_entry_price) / pos.avg_entry_price * 100.0) if pos.side == "LONG" else ((pos.avg_entry_price - price) / pos.avg_entry_price * 100.0)
        exit_reason = getattr(po, "reason", "Exit Target/Stop")

        track = self.early_exit_engine.tracks.get(symbol)
        fee_drag = entry_fee_share + fee
        # Record closed trade with the completed Reality Mirror metrics.
        is_final_exit = pos.qty - close_qty <= 1e-9

        initial_sl = pos.initial_stop_price if pos.initial_stop_price > 0 else pos.stop_price
        r_dist = abs(pos.avg_entry_price - initial_sl) if initial_sl > 0 else (pos.avg_entry_price * 0.015)
        # Allocate initial risk proportionally to the fraction of position being closed
        risk_usd_initial = max(1e-6, (pos.initial_risk_usd * (close_qty / open_qty_before_exit)) if (pos.initial_risk_usd > 0 and open_qty_before_exit > 0) else (r_dist * close_qty))
        if pos.initial_risk_usd > 0:
            pos.initial_risk_usd = max(0.0, pos.initial_risk_usd - risk_usd_initial)
        realized_r = net / risk_usd_initial
        mfe_r = round(track.mfe_r, 4) if (track and track.risk_amount > 0) else round((track.mfe / risk_usd_initial), 4) if track else 0.0
        mae_r = round(track.mae_r, 4) if (track and track.risk_amount > 0) else round((track.mae / risk_usd_initial), 4) if track else 0.0
        expected_r = float(getattr(pos, "expected_rr", 1.5))
        regime_val = getattr(pos, "regime", "NO_TRADE")
        exchange_leverage = float(getattr(pos, "leverage", 1.0))
        effective_lev = float(getattr(pos, "effective_leverage", (close_qty * pos.avg_entry_price) / max(1.0, self.available_margin)))

        self._append_closed_trade({
            "symbol": symbol,
            "side": pos.side,
            "qty": close_qty,
            "entry_price": pos.avg_entry_price,
            "exit_price": price,
            "target_price": getattr(pos, "target_price", price),
            "stop_price": pos.stop_price,
            "gross_pnl": gross,
            "net_pnl": net,
            "pnl_percent": round(pnl_pct, 2),
            "fee": fee,
            "fee_drag": fee_drag,
            "slippage_cost": entry_slippage_share + slippage_cost,
            "mfe": track.mfe if track else 0.0,
            "mae": track.mae if track else 0.0,
            "mfe_r": mfe_r,
            "mae_r": mae_r,
            "expected_r": expected_r,
            "realized_r": round(realized_r, 4),
            "regime": regime_val,
            "leverage": exchange_leverage,
            "effective_leverage": round(effective_lev, 2),
            "risk_usd": round(risk_usd_initial, 2),
            "profit_bleed": bool(track and track.mfe_r >= 0.5 and net <= 0.0),
            "reason": exit_reason,
            "entry_reason": getattr(pos, "reason", "Technical Signal"),
            "context_snapshot": getattr(pos, "context_snapshot", None),
            "tp1_filled": bool(getattr(pos, "tp1_filled", False)),
            "entry_ts": pos.entry_ts,
            "exit_ts": self._last_event_ts,
            "is_final_exit": is_final_exit,
        })

        # Release margin
        margin_released = pos.margin_used * (close_qty / open_qty_before_exit) if open_qty_before_exit > 0 else 0.0
        pos.margin_used = max(0.0, pos.margin_used - margin_released)
        self.locked_margin = max(0.0, self.locked_margin - margin_released)
        self.available_margin += margin_released + net

        logger.info(
            f"[TRADE] EXIT fill [{self.session_id}] {symbol}: "
            f"-{close_qty:.6f} @ {price:.4f} fee={fee:.6f} net={net:.4f} ({pnl_pct:+.2f}%) -> realized={self.realized_pnl:.4f} | reason='{exit_reason}'"
        )

        if pos.qty <= 1e-9:
            pos.qty = 0.0
            pos.closed = True
            # Remove from Early Exit Engine
            self.early_exit_engine.remove_position(symbol)
            logger.info(f"[TRADE] POSITION CLOSED [{self.session_id}] {symbol}: fees={pos.fees_paid:.6f} total_realized={self.realized_pnl:+.4f} | reason='{exit_reason}'")


    # ------------------------------------------------------------------ #
    #  State snapshot & High-Level Trade Execution
    # ------------------------------------------------------------------ #
    def execute_trade_signal(
        self,
        symbol: str,
        side: str,
        price: float,
        stop_price: float = 0.0,
        target_price: float = 0.0,
        quantity: Optional[float] = None,
        order_type: str = "LIMIT",
        reason: str = "Algorithm Signal",
        signal_ts: Optional[int] = None,
        regime: Optional[str] = None,
        context_snapshot: Optional[Dict[str, Any]] = None,
        tp2_price: float = 0.0,
        leverage: float = 1.0,
        risk_pct: Optional[float] = None,
    ) -> dict:
        """
        Executes a trade signal applying risk position sizing, stop/target, reason, and margin rules.
        Rejects signal immediately if market regime is TOXIC_VOLATILITY.
        """
        if self.is_halted:
            logger.warning(f"[KILL_SWITCH] Rejected signal for {symbol}: system is HALTED ({self.halt_reason})")
            return {"status": "REJECTED", "reason": f"System HALTED: {self.halt_reason}"}

        if price <= 0 or stop_price <= 0 or target_price <= 0:
            logger.warning(f"[TRADE] Rejected signal for {symbol}: invalid entry/SL/TP (price={price}, sl={stop_price}, tp={target_price})")
            return {"status": "REJECTED", "reason": "invalid_entry_sl_tp"}

        side_up = str(side).upper()
        if side_up in ("BUY", "LONG"):
            if not (stop_price < price < target_price):
                logger.warning(f"[TRADE] Rejected LONG signal for {symbol}: invalid price geometry (sl={stop_price} < price={price} < tp={target_price})")
                return {"status": "REJECTED", "reason": "invalid_long_geometry"}
        elif side_up in ("SELL", "SHORT"):
            if not (target_price < price < stop_price):
                logger.warning(f"[TRADE] Rejected SHORT signal for {symbol}: invalid price geometry (tp={target_price} < price={price} < sl={stop_price})")
                return {"status": "REJECTED", "reason": "invalid_short_geometry"}

        if regime and str(regime).upper() == "TOXIC_VOLATILITY":
            logger.warning(f"[TRADE] Rejected signal for {symbol}: TOXIC_VOLATILITY regime blocks entries | reason='{reason}'")
            return {"status": "REJECTED", "reason": "toxic_volatility_blocked"}

        if quantity is None or quantity <= 0:
            quantity = self.calculate_position_size(symbol, price, stop_price, risk_pct=risk_pct, leverage=leverage)

        if quantity <= 0:
            logger.warning(f"[TRADE] Rejected signal for {symbol}: insufficient margin or zero size | reason='{reason}'")
            return {"status": "REJECTED", "reason": "insufficient_margin"}

        return self.place_order(
            symbol=symbol,
            side=side,
            order_type=order_type,
            price=price,
            quantity=quantity,
            role=PaperOrderRole.ENTRY.value,
            stop_price=stop_price,
            target_price=target_price,
            reason=reason,
            signal_ts=signal_ts,
            context_snapshot=context_snapshot,
            tp2_price=tp2_price,
            leverage=leverage,
            risk_pct=risk_pct,
        )

    def execute_unified_signal(self, signal, regime: Optional[str] = None, quantity: Optional[float] = None) -> dict:
        """Execute an entry only through the shared History/Validation/Paper contract."""
        from backend.app.engine.trade_contract import UnifiedTradeSignal, to_paper_order_request

        if not isinstance(signal, UnifiedTradeSignal):
            raise TypeError("Paper entries require a UnifiedTradeSignal")

        payload = to_paper_order_request(signal, quantity=quantity)
        payload["regime"] = regime
        raw_risk = getattr(signal, "risk_pct", None)
        risk_fraction = (
            SharedRiskProfile.from_api_config({"risk_per_trade_pct": raw_risk}).risk_per_trade_fraction
            if raw_risk is not None
            else None
        )
        return self.execute_trade_signal(
            **payload,
            signal_ts=signal.timestamp,
            context_snapshot=getattr(signal, "context_snapshot", None),
            tp2_price=float(getattr(signal, "tp2", None) or 0.0),
            leverage=max(1.0, float(getattr(signal, "leverage", 1.0) or 1.0)),
            risk_pct=risk_fraction,
        )

    def close_position(
        self,
        symbol: str,
        price: float,
        order_type: str = "LIMIT",
        reason: str = "Position Exit",
        signal_ts: Optional[int] = None,
        quantity: Optional[float] = None,
    ) -> Optional[dict]:
        """
        Closes an existing virtual position for a given symbol.
        """
        pos = self.positions.get(symbol)
        if not pos or pos.closed or pos.qty <= 0:
            return None
        exit_side = "SELL" if pos.side == "LONG" else "BUY"
        return self.place_order(
            symbol=symbol,
            side=exit_side,
            order_type=order_type,
            price=price,
            quantity=min(pos.qty, float(quantity)) if quantity is not None else pos.qty,
            role=PaperOrderRole.EXIT.value,
            reason=reason,
            signal_ts=signal_ts,
        )

    def kill_switch(self, reason: str = "EMERGENCY STOP triggered by user") -> dict:
        """
        Emergency Kill Switch:
        1. Immediately sets system status to HALTED.
        2. Cancels all pending and active unfilled orders.
        3. Closes all active open positions at current market price (Market exit, Taker fee).
        4. Logs halt event and records reason.
        """
        self.is_halted = True
        self.halt_reason = reason
        self.halt_ts = int(time.time() * 1000)

        # 1. Cancel all unfilled active orders
        cancelled_orders = 0
        for po in list(self.orders.values()):
            if po.sim.state.status in (OrderStatus.PENDING, OrderStatus.ACTIVE, OrderStatus.PARTIALLY_FILLED):
                if self.cancel_order(po.order_id):
                    cancelled_orders += 1

        # 2. Close all open positions at market price
        closed_positions_count = 0
        now_ts = int(time.time() * 1000)
        for sym, pos in list(self.positions.items()):
            if pos.qty > 0 and not pos.closed:
                observed_price = self.last_prices.get(sym, pos.avg_entry_price)
                slippage_bps = self.last_market_slippage_bps.get(sym, 0.0)
                market_price = observed_price * (
                    1.0 - slippage_bps / 10_000.0
                    if pos.side == "LONG"
                    else 1.0 + slippage_bps / 10_000.0
                )
                close_qty = pos.qty
                slippage_cost = close_qty * abs(observed_price - market_price)
                fee = market_price * close_qty * self.taker_fee
                if pos.side == "LONG":
                    gross = (market_price - pos.avg_entry_price) * close_qty
                    pnl_pct = ((market_price - pos.avg_entry_price) / pos.avg_entry_price * 100.0) if pos.avg_entry_price > 0 else 0.0
                else:
                    gross = (pos.avg_entry_price - market_price) * close_qty
                    pnl_pct = ((pos.avg_entry_price - market_price) / pos.avg_entry_price * 100.0) if pos.avg_entry_price > 0 else 0.0
                entry_fee = pos.fees_paid
                entry_slippage = pos.slippage_paid
                net = gross - entry_fee - fee

                self.realized_pnl += net
                pos.fees_paid = 0.0
                pos.slippage_paid = 0.0
                self.total_fees_paid += fee
                self.total_slippage_paid += slippage_cost
                pos.qty = 0.0
                pos.closed = True

                initial_sl = pos.initial_stop_price if pos.initial_stop_price > 0 else pos.stop_price
                r_dist = abs(pos.avg_entry_price - initial_sl) if initial_sl > 0 else (pos.avg_entry_price * 0.015)
                risk_usd_initial = max(1e-6, r_dist * close_qty)
                realized_r = net / risk_usd_initial
                track = self.early_exit_engine.tracks.get(sym)
                mfe_r = round(track.mfe_r, 4) if (track and track.risk_amount > 0) else round((track.mfe / risk_usd_initial), 4) if track else 0.0
                mae_r = round(track.mae_r, 4) if (track and track.risk_amount > 0) else round((track.mae / risk_usd_initial), 4) if track else 0.0
                expected_r = float(getattr(pos, "expected_rr", 1.5))
                regime_val = getattr(pos, "regime", "NO_TRADE")
                exchange_leverage = float(getattr(pos, "leverage", 1.0))
                effective_lev = float(getattr(pos, "effective_leverage", (close_qty * pos.avg_entry_price) / max(1.0, self.available_margin)))

                self._append_closed_trade({
                    "symbol": sym,
                    "side": pos.side,
                    "qty": close_qty,
                    "entry_price": pos.avg_entry_price,
                    "exit_price": market_price,
                    "target_price": getattr(pos, "target_price", market_price),
                    "stop_price": pos.stop_price,
                    "gross_pnl": gross,
                    "net_pnl": net,
                    "pnl_percent": round(pnl_pct, 2),
                    "fee": fee,
                    "fee_drag": entry_fee + fee,
                    "slippage_cost": entry_slippage + slippage_cost,
                    "mfe": track.mfe if track else 0.0,
                    "mae": track.mae if track else 0.0,
                    "mfe_r": mfe_r,
                    "mae_r": mae_r,
                    "expected_r": expected_r,
                    "realized_r": round(realized_r, 4),
                    "regime": regime_val,
                    "leverage": exchange_leverage,
                    "effective_leverage": round(effective_lev, 2),
                    "risk_usd": round(risk_usd_initial, 2),
                    "profit_bleed": bool(track and track.mfe_r >= 0.5 and net <= 0.0),
                    "reason": f"KILL_SWITCH: {reason}",
                    "entry_reason": getattr(pos, "reason", "Technical Signal"),
                    "entry_ts": pos.entry_ts,
                    "exit_ts": now_ts,
                    "is_final_exit": True,
                })

                margin_released = pos.margin_used
                pos.margin_used = 0.0
                self.locked_margin = max(0.0, self.locked_margin - margin_released)
                self.available_margin += margin_released + net
                self.early_exit_engine.remove_position(sym)
                closed_positions_count += 1

        logger.critical(
            f"[KILL_SWITCH] Emergency Kill Switch activated: '{reason}'. "
            f"Cancelled {cancelled_orders} orders, closed {closed_positions_count} open positions."
        )
        return {
            "status": "HALTED",
            "reason": reason,
            "halt_ts": self.halt_ts,
            "cancelled_orders": cancelled_orders,
            "closed_positions": closed_positions_count,
            "state": self.get_state().to_dict(),
        }

    def resume(self, reason: str = "Manual Resume") -> dict:
        """Resumes trading after a Kill Switch halt."""
        self.is_halted = False
        self.halt_reason = None
        self.halt_ts = None
        logger.info(f"[KILL_SWITCH] Trading resumed: '{reason}'")
        return {
            "status": "ACTIVE",
            "state": self.get_state().to_dict(),
        }

    def deposit(self, amount: float, reason: str = "Manual top-up") -> dict:
        """Пополнение виртуального кошелька (paper money).

        Не трогает позиции, ордера и историю сделок — только увеличивает
        базу кошелька и доступную маржу. Полностью виртуально: реальных
        денег и ключей не существует (инвариант AGENTS.md §5.1).
        """
        amount = float(amount)
        if not math.isfinite(amount) or amount <= 0:
            raise ValueError("Deposit amount must be a positive finite number")
        self.initial_balance += amount
        self.available_margin += amount
        self._last_event_ts = int(time.time() * 1000)
        logger.info(
            f"[TRADE] Virtual wallet topped up +${amount:.2f} USD "
            f"(balance base now ${self.initial_balance:.2f}) | reason='{reason}'"
        )
        return {
            "deposited": amount,
            "initial_balance": self.initial_balance,
            "available_margin": self.available_margin,
            "reason": reason,
        }

    def reset_wallet(self, initial_balance: float = 100.0) -> None:
        """Strictly resets the paper trading virtual wallet to initial_balance ($100.00 USD)."""
        self.initial_balance = float(initial_balance)
        self.available_margin = float(initial_balance)
        self.locked_margin = 0.0
        self.realized_pnl = 0.0
        self.total_fees_paid = 0.0
        self.total_slippage_paid = 0.0
        self.start_time = time.time()
        self.is_halted = False
        self.halt_reason = None
        self.halt_ts = None
        self.positions.clear()
        self.orders.clear()
        self.closed_trades.clear()
        self.last_market_slippage_bps.clear()
        self.early_exit_engine.tracks.clear()
        logger.info(f"[TRADE] Virtual wallet reset strictly to ${self.initial_balance:.2f} USD | reason='Admin Reset'")

    def unrealized_pnl_for(self, symbol: str) -> float:
        pos = self.positions.get(symbol)
        if pos is None or pos.closed:
            return 0.0
        last = self.last_prices.get(symbol, 0.0)
        return pos.unrealized_pnl(last)

    def apply_funding(self, symbol: str, funding_rate: float, timestamp: Optional[int] = None) -> float:
        """Apply one funding settlement to the virtual balance."""
        pos = self.positions.get(symbol)
        if not pos or pos.closed or pos.qty <= 0 or not funding_rate:
            return 0.0
        payment = pos.avg_entry_price * pos.qty * float(funding_rate)
        if pos.side == "SHORT":
            payment = -payment
        self.realized_pnl -= payment
        self.available_margin -= payment
        self.total_funding_paid += payment
        self.total_fees_paid += abs(payment)
        self._last_event_ts = max(self._last_event_ts, int(timestamp or time.time() * 1000))
        return payment

    def total_unrealized_pnl(self) -> float:
        return sum(self.unrealized_pnl_for(sym) for sym in self.positions)

    def get_state(self) -> PaperSessionState:
        unrealized = self.total_unrealized_pnl()
        balance = self.initial_balance + self.realized_pnl + unrealized
        positions = []
        for sym, pos in self.positions.items():
            if pos.closed:
                continue
            track = self.early_exit_engine.tracks.get(sym)
            positions.append({
                "symbol": sym,
                "side": pos.side,
                "qty": pos.qty,
                "avg_entry_price": pos.avg_entry_price,
                "entry_ts": pos.entry_ts,
                "stop_price": pos.stop_price,
                "initial_stop_price": pos.initial_stop_price,
                "breakeven_triggered": pos.breakeven_triggered,
                "target_price": getattr(pos, "target_price", 0.0),
                "tp2_price": getattr(pos, "tp2_price", 0.0),
                "tp1_filled": bool(getattr(pos, "tp1_filled", False)),
                "context_snapshot": getattr(pos, "context_snapshot", None),
                "reason": getattr(pos, "reason", "Technical Signal"),
                "fees_paid": pos.fees_paid,
                "risk_amount": pos.risk_amount,
                "unrealized_pnl": self.unrealized_pnl_for(sym),
                "last_price": self.last_prices.get(sym, 0.0),
                "mfe": track.mfe if track else 0.0,
                "mae": track.mae if track else 0.0,
                "mfe_r": round(track.mfe_r, 2) if track else 0.0,
                "current_pnl_r": round(track.current_pnl_r, 2) if track else 0.0,
                "active_alerts": list(track.active_alerts) if track else [],
            })
        active_orders = []
        reserved_margin = 0.0
        reserved_risk = 0.0
        for po in self.orders.values():
            if po.sim.state.status in (OrderStatus.FILLED, OrderStatus.REJECTED, OrderStatus.CANCELLED):
                continue
            active_orders.append(self._order_info(po))
            reserved_margin += po.reserved_margin
            reserved_risk += po.reserved_risk
        uptime = int(time.time() - getattr(self, "start_time", time.time()))
        return PaperSessionState(
            session_id=self.session_id,
            initial_balance=self.initial_balance,
            available_margin=self.available_margin,
            locked_margin=self.locked_margin,
            realized_pnl=self.realized_pnl,
            unrealized_pnl=unrealized,
            balance=balance,
            reserved_margin=reserved_margin,
            reserved_risk=reserved_risk,
            positions=positions,
            active_orders=active_orders,
            closed_trades=list(self.closed_trades),
            total_fees_paid=self.total_fees_paid,
            total_slippage_paid=self.total_slippage_paid,
            total_funding_paid=self.total_funding_paid,
            uptime_seconds=uptime,
            is_halted=self.is_halted,
            halt_reason=self.halt_reason,
            halt_ts=self.halt_ts,
            updated_at=self._last_event_ts or None,
        )


paper_trading_session = PaperTradingSession()






