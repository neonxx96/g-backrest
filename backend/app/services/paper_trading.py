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
    fees_paid: float = 0.0
    closed: bool = False

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
        initial_balance: float = 10000.0,
        risk_per_trade_pct: float = 0.01,
        maker_fee: float = DEFAULT_MAKER_FEE,
        taker_fee: float = DEFAULT_TAKER_FEE,
        signal_lag_ms: int = DEFAULT_SIGNAL_LAG_MS,
        order_rtt_ms: int = DEFAULT_ORDER_RTT_MS,
        session_id: Optional[str] = None,
    ):
        self.session_id = session_id or f"paper_{int(time.time() * 1000)}"
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

        # Live state
        self.orders: Dict[str, PaperOrder] = {}
        self.positions: Dict[str, PaperPosition] = {}  # key: symbol
        self.last_prices: Dict[str, float] = {}
        self._last_event_ts = 0

        # Early Exit Engine (MFE/MAE tracker + alert rule engine)
        self.early_exit_engine = EarlyExitEngine()


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
        )
        # Persist stop for R-based metrics on the eventual position.
        po.stop_price = float(stop_price)
        self.orders[order_id] = po
        logger.info(
            f"[PaperSession {self.session_id}] {role.upper()} order {order_id} "
            f"placed: {side} {order_type} {quantity} {symbol} @ {price} "
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
            )
            self.positions[symbol] = pos

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

        logger.info(
            f"[PaperSession {self.session_id}] ENTRY fill {symbol}: "
            f"+{qty} @ {price} fee={fee:.6f} -> pos_qty={pos.qty:.6f} avg={pos.avg_entry_price:.2f}"
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
        pos.qty -= close_qty

        # Release margin
        margin_released = pos.avg_entry_price * close_qty
        self.locked_margin = max(0.0, self.locked_margin - margin_released)
        self.available_margin += margin_released + net

        logger.info(
            f"[PaperSession {self.session_id}] EXIT fill {symbol}: "
            f"-{close_qty} @ {price} fee={fee:.6f} net={net:.4f} -> realized={self.realized_pnl:.4f}"
        )

        if pos.qty <= 1e-9:
            pos.qty = 0.0
            pos.closed = True
            # Remove from Early Exit Engine
            self.early_exit_engine.remove_position(symbol)
            logger.info(f"[PaperSession {self.session_id}] POSITION CLOSED {symbol}: fees={pos.fees_paid:.6f}")


    # ------------------------------------------------------------------ #
    #  State snapshot
    # ------------------------------------------------------------------ #
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
        )





