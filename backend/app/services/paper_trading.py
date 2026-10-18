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
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional

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
    target_price: float = 0.0
    fees_paid: float = 0.0
    closed: bool = False
    reason: str = "Technical Signal"

    @property
    def risk_amount(self) -> float:
        """R in absolute USDT: distance to stop * qty (fallback: notional * 0.005)."""
        if self.stop_price > 0 and self.avg_entry_price > 0:
            return abs(self.avg_entry_price - self.stop_price) * self.qty
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
    stop_price: float = 0.0
    target_price: float = 0.0


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
    positions: List[dict] = field(default_factory=list)
    active_orders: List[dict] = field(default_factory=list)
    closed_trades: List[dict] = field(default_factory=list)
    total_fees_paid: float = 0.0
    uptime_seconds: int = 0

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "initial_balance": self.initial_balance,
            "available_margin": self.available_margin,
            "locked_margin": self.locked_margin,
            "realized_pnl": self.realized_pnl,
            "unrealized_pnl": self.unrealized_pnl,
            "balance": self.balance,
            "positions": self.positions,
            "active_orders": self.active_orders,
            "closed_trades": self.closed_trades,
            "total_fees_paid": self.total_fees_paid,
            "uptime_seconds": self.uptime_seconds,
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
        taker_fee: float = 0.0004,
        signal_lag_ms: int = DEFAULT_SIGNAL_LAG_MS,
        order_rtt_ms: int = DEFAULT_ORDER_RTT_MS,
        session_id: Optional[str] = None,
    ):
        self.session_id = session_id or f"paper_{int(time.time() * 1000)}"
        self.start_time = time.time()
        self.initial_balance = float(initial_balance)
        self.risk_per_trade_pct = float(risk_per_trade_pct)
        self.maker_fee = maker_fee
        self.taker_fee = taker_fee
        self.signal_lag_ms = signal_lag_ms
        self.order_rtt_ms = order_rtt_ms

        # Balance accounting (all in USDT)
        self.realized_pnl = 0.0
        self.available_margin = float(initial_balance)
        self.locked_margin = 0.0
        self.total_fees_paid = 0.0

        # Live state
        self.orders: Dict[str, PaperOrder] = {}
        self.positions: Dict[str, PaperPosition] = {}  # key: symbol
        self.closed_trades: List[dict] = []
        self.last_prices: Dict[str, float] = {}
        self._last_event_ts = 0

        # Early Exit Engine (MFE/MAE tracker + alert rule engine)
        self.early_exit_engine = EarlyExitEngine()

    def calculate_position_size(
        self,
        symbol: str,
        entry_price: float,
        stop_price: float = 0.0,
        risk_pct: Optional[float] = None,
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
        max_qty = max(0.0, self.available_margin / entry_price)
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
    ) -> dict:
        """
        Create a virtual order. Returns an order info dict.
        Deterministic: order_id is derived from a monotonic counter, not uuid.
        """
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
        )
        self.orders[order_id] = po

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
        }

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
        if kind == "trade":
            price = float(event.payload.get("price", 0.0))
            symbol = getattr(event, "symbol", None) or event.payload.get("symbol")
            if symbol and price > 0:
                self.last_prices[symbol] = price

                # --- Early Exit Engine integration (MFE/MAE + alerts) ---
                self.early_exit_engine.on_price_update(symbol, price, ts)
                track = self.early_exit_engine.tracks.get(symbol)
                if track:
                    self.early_exit_engine.evaluate_position(track)
                # --------------------------------------------------------


        # Forward to all working orders (snapshot — orders may complete mid-loop)
        for po in list(self.orders.values()):
            if po.sim.state.status in (OrderStatus.FILLED, OrderStatus.REJECTED):
                continue
            prev_filled = po.sim.state.filled_qty
            po.sim.process_event(event)
            if po.sim.state.filled_qty > prev_filled + 1e-12:
                self._on_order_fill(po)

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
        if po.role == PaperOrderRole.ENTRY:
            self._apply_entry_fill(symbol, po, price, qty, fee)
        else:
            self._apply_exit_fill(symbol, po, price, qty, fee)

    def _apply_entry_fill(self, symbol: str, po: PaperOrder, price: float, qty: float, fee: float) -> None:
        pos = self.positions.get(symbol)
        entry_side = po.sim.cfg.side.value  # BUY -> LONG, SELL -> SHORT
        pos_side = "LONG" if entry_side == "BUY" else "SHORT"

        if pos is None or pos.closed or pos.qty <= 0:
            pos = PaperPosition(
                symbol=symbol,
                side=pos_side,
                qty=0.0,
                avg_entry_price=0.0,
                entry_ts=po.created_ts,
                stop_price=getattr(po, "stop_price", 0.0),
                target_price=getattr(po, "target_price", 0.0),
                reason=getattr(po, "reason", "Technical Signal"),
            )
            self.positions[symbol] = pos
        else:
            pos.reason = getattr(po, "reason", pos.reason)
            if getattr(po, "stop_price", 0.0) > 0:
                pos.stop_price = po.stop_price
            if getattr(po, "target_price", 0.0) > 0:
                pos.target_price = po.target_price

        if pos.side != pos_side:
            logger.warning(f"[PaperSession] conflicting side for {symbol}: {pos.side} vs {pos_side}")
            return

        # Weighted average entry price
        total_qty = pos.qty + qty
        pos.avg_entry_price = ((pos.avg_entry_price * pos.qty) + (price * qty)) / total_qty
        pos.qty = total_qty
        pos.fees_paid += fee
        pos.entry_ts = pos.entry_ts or po.created_ts

        # Lock margin for the position (entry notional as margin)
        margin_used = price * qty
        self.locked_margin += margin_used
        self.available_margin -= margin_used
        self.total_fees_paid += fee

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


    def _apply_exit_fill(self, symbol: str, po: PaperOrder, price: float, qty: float, fee: float) -> None:
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
        if pos.side == "LONG":
            gross = (price - pos.avg_entry_price) * close_qty
        else:
            gross = (pos.avg_entry_price - price) * close_qty
        net = gross - fee
        self.realized_pnl += net
        pos.fees_paid += fee
        self.total_fees_paid += fee
        pos.qty -= close_qty

        pnl_pct = ((price - pos.avg_entry_price) / pos.avg_entry_price * 100.0) if pos.side == "LONG" else ((pos.avg_entry_price - price) / pos.avg_entry_price * 100.0)
        exit_reason = getattr(po, "reason", "Exit Target/Stop")

        # Record closed trade
        self.closed_trades.append({
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
            "reason": exit_reason,
            "entry_reason": getattr(pos, "reason", "Technical Signal"),
            "entry_ts": pos.entry_ts,
            "exit_ts": self._last_event_ts,
        })

        # Cap closed trades buffer to prevent memory leakage
        if len(self.closed_trades) > 1000:
            self.closed_trades = self.closed_trades[-1000:]

        # Release margin
        margin_released = pos.avg_entry_price * close_qty
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
    ) -> dict:
        """
        Executes a trade signal applying risk position sizing, stop/target, reason, and margin rules.
        """
        if quantity is None or quantity <= 0:
            quantity = self.calculate_position_size(symbol, price, stop_price)

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
        )

    def close_position(
        self,
        symbol: str,
        price: float,
        order_type: str = "LIMIT",
        reason: str = "Position Exit",
        signal_ts: Optional[int] = None,
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
            quantity=pos.qty,
            role=PaperOrderRole.EXIT.value,
            reason=reason,
            signal_ts=signal_ts,
        )

    def reset_wallet(self, initial_balance: float = 100.0) -> None:
        """Strictly resets the paper trading virtual wallet to initial_balance ($100.00 USD)."""
        self.initial_balance = float(initial_balance)
        self.available_margin = float(initial_balance)
        self.locked_margin = 0.0
        self.realized_pnl = 0.0
        self.total_fees_paid = 0.0
        self.start_time = time.time()
        self.positions.clear()
        self.orders.clear()
        self.closed_trades.clear()
        self.early_exit_engine.tracks.clear()
        logger.info(f"[TRADE] Virtual wallet reset strictly to ${self.initial_balance:.2f} USD | reason='Admin Reset'")

    def unrealized_pnl_for(self, symbol: str) -> float:
        pos = self.positions.get(symbol)
        if pos is None or pos.closed:
            return 0.0
        last = self.last_prices.get(symbol, 0.0)
        return pos.unrealized_pnl(last)

    def total_unrealized_pnl(self) -> float:
        return sum(self.unrealized_pnl_for(sym) for sym in self.positions)

    def get_state(self) -> PaperSessionState:
        unrealized = self.total_unrealized_pnl()
        balance = self.initial_balance + self.realized_pnl + unrealized
        positions = []
        for sym, pos in self.positions.items():
            if pos.closed:
                continue
            positions.append({
                "symbol": sym,
                "side": pos.side,
                "qty": pos.qty,
                "avg_entry_price": pos.avg_entry_price,
                "entry_ts": pos.entry_ts,
                "stop_price": pos.stop_price,
                "target_price": getattr(pos, "target_price", 0.0),
                "reason": getattr(pos, "reason", "Technical Signal"),
                "fees_paid": pos.fees_paid,
                "risk_amount": pos.risk_amount,
                "unrealized_pnl": self.unrealized_pnl_for(sym),
                "last_price": self.last_prices.get(sym, 0.0),
            })
        active_orders = []
        for po in self.orders.values():
            if po.sim.state.status in (OrderStatus.FILLED, OrderStatus.REJECTED, OrderStatus.CANCELLED):
                continue
            active_orders.append(self._order_info(po))
        uptime = int(time.time() - getattr(self, "start_time", time.time()))
        return PaperSessionState(
            session_id=self.session_id,
            initial_balance=self.initial_balance,
            available_margin=self.available_margin,
            locked_margin=self.locked_margin,
            realized_pnl=self.realized_pnl,
            unrealized_pnl=unrealized,
            balance=balance,
            positions=positions,
            active_orders=active_orders,
            closed_trades=list(self.closed_trades),
            total_fees_paid=self.total_fees_paid,
            uptime_seconds=uptime,
        )


paper_trading_session = PaperTradingSession()






