"""
Execution Simulator: Deterministic Order Matching & Latency Model
=================================================================
Simulates realistic order execution over a stream of `ReplayEvent` objects
produced by `ReplayEngine.stream()`.

CORE GUARANTEES (Category Invariants):
1. Zero Look-Ahead: an order can ONLY interact with events where
   `event.timestamp >= order_active_ts`.
2. Deterministic: no `random()` anywhere. Ties resolved conservatively
   (worst-case fill for the trader).
3. Golden-baseline isolation: this module never imports or modifies
   `orderflow_backtester.py` or `limit_fill_simulator.py`.
"""
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Iterator, List, Optional, Tuple

logger = logging.getLogger(__name__)


# --- Default fees (parameterizable) ------------------------------------------
DEFAULT_MAKER_FEE = 0.0002  # 0.02%
DEFAULT_TAKER_FEE = 0.0005  # 0.05%

# --- Default latency (parameterizable) ---------------------------------------
DEFAULT_SIGNAL_LAG_MS = 100
DEFAULT_ORDER_RTT_MS = 50


class OrderStatus(str, Enum):
    PENDING = "PENDING"          # signal generated, not yet on the exchange
    ACTIVE = "ACTIVE"            # registered in the book (queueing)
    PARTIALLY_FILLED = "PARTIALLY_FILLED"
    FILLED = "FILLED"
    CANCELLED = "CANCELLED"
    REJECTED = "REJECTED"


class OrderSide(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class OrderType(str, Enum):
    LIMIT = "LIMIT"
    MARKET = "MARKET"


@dataclass
class Fill:
    timestamp: int
    price: float
    quantity: float
    fee: float
    liquidity: str

    @property
    def notional(self) -> float:
        return self.price * self.quantity


@dataclass
class OrderConfig:
    """User-provided order request."""
    signal_ts: int
    side: OrderSide
    order_type: OrderType
    price: float
    quantity: float
    signal_lag_ms: int = DEFAULT_SIGNAL_LAG_MS
    order_rtt_ms: int = DEFAULT_ORDER_RTT_MS
    maker_fee: float = DEFAULT_MAKER_FEE
    taker_fee: float = DEFAULT_TAKER_FEE

    @property
    def order_active_ts(self) -> int:
        """The exact timestamp the order hits the exchange matching engine."""
        return self.signal_ts + self.signal_lag_ms + self.order_rtt_ms


@dataclass
class OrderState:
    status: OrderStatus = OrderStatus.PENDING
    filled_qty: float = 0.0
    remaining_qty: float = 0.0
    queue_ahead: float = 0.0
    fills: List[Fill] = field(default_factory=list)

    @property
    def avg_fill_price(self) -> float:
        if not self.fills:
            return 0.0
        return sum(f.notional for f in self.fills) / sum(f.quantity for f in self.fills)

    @property
    def total_fee(self) -> float:
        return sum(f.fee for f in self.fills)


@dataclass
class ExecutionResult:
    """Immutable outcome of a full simulation run."""
    order_state: OrderState
    exit_reason: Optional[str] = None
    realized_net_pnl: float = 0.0

    def __repr__(self) -> str:
        return (f"ExecutionResult(status={self.order_state.status}, "
                f"filled={self.order_state.filled_qty:.4f}, "
                f"avg_px={self.order_state.avg_fill_price:.2f}, "
                f"net_pnl={self.realized_net_pnl:.4f})")


# ============================================================================ #
#  Core Simulator Logic
# ============================================================================ #
class ExecutionSimulator:
    """
    Consumes a chronological event stream and simulates order execution.
    """

    def __init__(self, config: OrderConfig):
        self.cfg = config
        self.state = OrderState(remaining_qty=config.quantity)
        self.exit_reason: Optional[str] = None
        self._active_ts = config.order_active_ts
        self._last_bids: List[Tuple[float, float]] = []
        self._last_asks: List[Tuple[float, float]] = []
        self._queue_initialized = False

    def run(self, events: Iterator) -> ExecutionResult:
        """Process the full event stream until order is filled/cancelled."""
        for event in events:
            if self.state.status in (OrderStatus.FILLED, OrderStatus.CANCELLED):
                break
            self.process_event(event)
        self._finalize()
        return ExecutionResult(
            order_state=self.state,
            exit_reason=self.exit_reason,
            realized_net_pnl=self._compute_net_pnl(),
        )

    def process_event(self, event) -> None:
        """Process a single ReplayEvent. Zero look-ahead enforced here."""
        if event.timestamp < self._active_ts:
            return

        if event.kind == "depth":
            self._on_depth(event)
        elif event.kind == "trade":
            self._on_trade(event)

    def _on_depth(self, event) -> None:
        self._last_bids = [(float(p), float(q)) for p, q in event.payload["bids"]]
        self._last_asks = [(float(p), float(q)) for p, q in event.payload["asks"]]
        self._sort_book()
        if (not self._queue_initialized
                and self.state.status == OrderStatus.PENDING
                and self.cfg.order_type == OrderType.LIMIT):
            self._init_queue_position()

    def _sort_book(self) -> None:
        self._last_bids = sorted(self._last_bids, key=lambda x: x[0], reverse=True)
        self._last_asks = sorted(self._last_asks, key=lambda x: x[0])

    def _init_queue_position(self) -> None:
        """Capture queue_ahead = total volume at our limit price."""
        p = self.cfg.price
        vol = 0.0
        if self.cfg.side == OrderSide.BUY:
            for bp, bq in self._last_bids:
                if abs(bp - p) < 1e-9:
                    vol = bq
                    break
        else:
            for ap, aq in self._last_asks:
                if abs(ap - p) < 1e-9:
                    vol = aq
                    break
        self.state.queue_ahead = vol
        self._queue_initialized = True
        if self._is_order_placeable():
            self.state.status = OrderStatus.ACTIVE
        else:
            self.state.status = OrderStatus.REJECTED

    def _is_order_placeable(self) -> bool:
        """Conservative check: limit order must not be immediately crossable."""
        if self.cfg.order_type != OrderType.LIMIT:
            return True
        if self.cfg.side == OrderSide.BUY:
            if not self._last_asks:
                return True
            return self._last_asks[0][0] > self.cfg.price
        else:
            if not self._last_bids:
                return True
            return self._last_bids[0][0] < self.cfg.price

    def _on_trade(self, event) -> None:
        if self.cfg.order_type == OrderType.LIMIT:
            self._on_trade_limit(event)
        else:
            self._on_trade_market(event)

    def _on_trade_limit(self, event) -> None:
        price = float(event.payload["price"])
        qty = float(event.payload["quantity"])
        p = self.cfg.price

        if self.state.status == OrderStatus.REJECTED:
            return

        if self.cfg.side == OrderSide.BUY:
            if price > p + 1e-9:
                return  # price above our bid — irrelevant
            if price < p - 1e-9:
                # Price strictly through our level — instant fill of remainder.
                self._fill(self.state.remaining_qty, p, "maker")
                self.exit_reason = "price_crossed"
                return
            # price == p: consume queue
            self._consume_queue(qty)
        else:  # SELL
            if price < p - 1e-9:
                return  # price below our ask — irrelevant
            if price > p + 1e-9:
                self._fill(self.state.remaining_qty, p, "maker")
                self.exit_reason = "price_crossed"
                return
            self._consume_queue(qty)

    def _consume_queue(self, trade_qty: float) -> None:
        """Standard queue position decrement."""
        if self.state.queue_ahead > 0:
            consumed = min(self.state.queue_ahead, trade_qty)
            self.state.queue_ahead -= consumed
            residual = trade_qty - consumed
            if residual > 0 and self.state.remaining_qty > 0:
                fill_qty = min(self.state.remaining_qty, residual)
                self._fill(fill_qty, self.cfg.price, "maker")
                if self.state.remaining_qty <= 1e-9:
                    self.exit_reason = "queue_exhausted"
        else:
            fill_qty = min(self.state.remaining_qty, trade_qty)
            if fill_qty > 0:
                self._fill(fill_qty, self.cfg.price, "maker")
                if self.state.remaining_qty <= 1e-9:
                    self.exit_reason = "queue_exhausted"

    def _on_trade_market(self, event) -> None:
        self._execute_market_order()

    def _execute_market_order(self) -> None:
        if self.state.status in (OrderStatus.FILLED, OrderStatus.REJECTED):
            return

        book = self._last_asks if self.cfg.side == OrderSide.BUY else self._last_bids
        if not book:
            self.state.status = OrderStatus.REJECTED
            self.exit_reason = "no_liquidity"
            return

        remaining = self.state.remaining_qty
        gross_cost = 0.0
        filled = 0.0
        worst_price = book[-1][0]

        for level_price, level_qty in book:
            if remaining <= 1e-9:
                break
            take = min(remaining, level_qty)
            gross_cost += take * level_price
            filled += take
            remaining -= take

        if remaining > 1e-9:
            shortfall = remaining
            tick_penalty = worst_price * 0.0001
            penalty_price = (worst_price + tick_penalty
                             if self.cfg.side == OrderSide.BUY
                             else worst_price - tick_penalty)
            gross_cost += shortfall * penalty_price
            filled += shortfall

        avg_px = gross_cost / filled if filled > 0 else 0.0
        self._fill(filled, avg_px, "taker")
        self.exit_reason = "depth_walk"

    def _fill(self, qty: float, price: float, liquidity: str) -> None:
        qty = min(qty, self.state.remaining_qty)
        if qty <= 0:
            return
        fee_rate = self.cfg.maker_fee if liquidity == "maker" else self.cfg.taker_fee
        notional = qty * price
        fee = notional * fee_rate
        self.state.fills.append(Fill(
            timestamp=0, price=price, quantity=qty, fee=fee, liquidity=liquidity,
        ))
        self.state.filled_qty += qty
        self.state.remaining_qty -= qty
        if self.state.remaining_qty <= 1e-9:
            self.state.remaining_qty = 0.0
            self.state.status = OrderStatus.FILLED
        else:
            self.state.status = OrderStatus.PARTIALLY_FILLED

    def _compute_net_pnl(self) -> float:
        total_fee = self.state.total_fee
        total_notional = sum(f.notional for f in self.state.fills)
        return -total_notional - total_fee

    def _finalize(self) -> None:
        if self.state.status == OrderStatus.PENDING:
            self.state.status = OrderStatus.CANCELLED
            self.exit_reason = "eod"


def simulate_order(
    events: Iterator,
    signal_ts: int,
    side: str,
    order_type: str,
    price: float,
    quantity: float,
    signal_lag_ms: int = DEFAULT_SIGNAL_LAG_MS,
    order_rtt_ms: int = DEFAULT_ORDER_RTT_MS,
    maker_fee: float = DEFAULT_MAKER_FEE,
    taker_fee: float = DEFAULT_TAKER_FEE,
) -> ExecutionResult:
    """Convenience wrapper to simulate a single order."""
    cfg = OrderConfig(
        signal_ts=signal_ts,
        side=OrderSide(side),
        order_type=OrderType(order_type),
        price=price,
        quantity=quantity,
        signal_lag_ms=signal_lag_ms,
        order_rtt_ms=order_rtt_ms,
        maker_fee=maker_fee,
        taker_fee=taker_fee,
    )
    sim = ExecutionSimulator(cfg)
    return sim.run(events)





