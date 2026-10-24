"""
Регрессионные тесты управления paper-позицией (аудит 24.10.2026).

Найденные в ночном марафоне дефекты:
1. tp2_price терялся при создании позиции в _apply_entry_fill (поле не передавалось
   в конструктор PaperPosition) → multi-TP молча деградировал в один TP,
   каждый тик с ценой >= target ставил ПОЛНЫЙ exit-ордер (12+ дублей за минуту).
2. close_position не отменял working exit-ордера → конкурирующие выходы копились;
   при пробое цены обратно через уровень возможен oversell сверх qty позиции.
3. Fill MARKET-входа шёл по глубине стакана момента исполнения и мог уйти от цены
   сигнала на сотни bp (SUI: сигнал 0.9300 → fill 0.9357). Guard max_entry_slippage_pct
   отклоняет такой fill: SL/TP сетапа посчитаны от цены сигнала и уже невалидны.
"""
import unittest

from backend.app.services.execution_simulator import OrderStatus
from backend.app.services.live_paper_runner import LivePaperRunner
from backend.app.services.paper_trading import PaperOrderRole, PaperTradingSession


class MockEvent:
    """ReplayEvent-compatible mock."""

    def __init__(self, timestamp: int, kind: str, payload: dict, symbol: str = None):
        self.timestamp = timestamp
        self.kind = kind
        self.payload = payload
        self.symbol = symbol


def make_session() -> PaperTradingSession:
    return PaperTradingSession(
        initial_balance=10000.0,
        risk_per_trade_pct=0.01,
        maker_fee=0.0002,
        taker_fee=0.0005,
        signal_lag_ms=100,
        order_rtt_ms=50,
        session_id="test_pos_mgmt",
    )


class TestTp2SurvivesEntryFill(unittest.TestCase):
    """tp2_price из entry-ордера должен попадать в позицию (regression #1)."""

    def _fill_long_entry(self, session: PaperTradingSession, tp2_price: float):
        # LIMIT BUY 1.0 @ 100.0, active_ts = 1000+100+50 = 1150
        session.place_order(
            symbol="BTCUSDT", side="BUY", order_type="LIMIT",
            price=100.0, quantity=1.0,
            role=PaperOrderRole.ENTRY.value,
            stop_price=99.6, target_price=100.6, tp2_price=tp2_price,
            signal_ts=1000,
        )
        session.process_event(MockEvent(1150, "depth", {
            "bids": [(100.0, 5.0), (99.9, 10.0)],
            "asks": [(100.1, 10.0)],
        }))
        session.process_event(MockEvent(1200, "trade", {"price": 100.0, "quantity": 6.0}, symbol="BTCUSDT"))

    def test_tp2_price_reaches_position(self):
        session = make_session()
        self._fill_long_entry(session, tp2_price=101.2)
        pos = session.positions.get("BTCUSDT")
        self.assertIsNotNone(pos)
        self.assertAlmostEqual(pos.target_price, 100.6)
        self.assertAlmostEqual(pos.tp2_price, 101.2)  # раньше: 0.0
        self.assertFalse(pos.tp1_filled)

    def test_multi_tp_partial_flow_via_runner(self):
        """С tp2 в позиции раннер ставит TP1_PARTIAL на 50%, а не полный TAKE_PROFIT."""
        session = make_session()
        self._fill_long_entry(session, tp2_price=101.2)
        pos = session.positions["BTCUSDT"]

        runner = LivePaperRunner(session=session)
        runner.symbol = "BTCUSDT"
        runner.use_multi_tp = True
        runner.use_trailing = False

        before = len(session.orders)
        runner._update_open_positions(100.7)  # цена >= tp1 (100.6), < tp2 (101.2)

        new_orders = list(session.orders.values())[before:]
        self.assertEqual(len(new_orders), 1)
        partial = new_orders[0]
        self.assertEqual(partial.reason, "TP1_PARTIAL")
        self.assertAlmostEqual(partial.sim.cfg.quantity, 0.5)
        self.assertTrue(pos.tp1_filled)
        self.assertAlmostEqual(pos.target_price, 101.2)


class TestExitOrderReplaceSemantics(unittest.TestCase):
    """Новый exit-ордер заменяет working exit, а не копится рядом (regression #2)."""

    def _open_long(self, session: PaperTradingSession):
        session.place_order(
            symbol="BTCUSDT", side="BUY", order_type="LIMIT",
            price=100.0, quantity=1.0,
            role=PaperOrderRole.ENTRY.value,
            stop_price=99.6, target_price=100.6, tp2_price=101.2,
            signal_ts=1000,
        )
        session.process_event(MockEvent(1150, "depth", {
            "bids": [(100.0, 5.0), (99.9, 10.0)],
            "asks": [(100.1, 10.0)],
        }))
        session.process_event(MockEvent(1200, "trade", {"price": 100.0, "quantity": 6.0}, symbol="BTCUSDT"))

    def _working_exit_orders(self, session: PaperTradingSession):
        return [
            o for o in session.orders.values()
            if o.role == PaperOrderRole.EXIT
            and o.sim.state.status in (OrderStatus.PENDING, OrderStatus.ACTIVE, OrderStatus.PARTIALLY_FILLED)
        ]

    def test_repeated_take_profit_replaces_not_stacks(self):
        session = make_session()
        self._open_long(session)
        session.close_position("BTCUSDT", 100.7, order_type="LIMIT", reason="TAKE_PROFIT", signal_ts=2000)
        session.close_position("BTCUSDT", 100.8, order_type="LIMIT", reason="TAKE_PROFIT", signal_ts=3000)
        session.close_position("BTCUSDT", 100.9, order_type="LIMIT", reason="TAKE_PROFIT", signal_ts=4000)

        working = self._working_exit_orders(session)
        self.assertEqual(len(working), 1)  # раньше: 3 конкурирующих TP-ордера
        self.assertAlmostEqual(working[0].sim.cfg.price, 100.9)
        cancelled = [
            o for o in session.orders.values()
            if o.role == PaperOrderRole.EXIT and o.sim.state.status == OrderStatus.CANCELLED
        ]
        self.assertEqual(len(cancelled), 2)

    def test_stop_close_cancels_working_take_profit(self):
        """MARKET-стоп отменяет живой TP-ордер до исполнения (oversell-защита)."""
        session = make_session()
        self._open_long(session)
        session.close_position("BTCUSDT", 100.7, order_type="LIMIT", reason="TAKE_PROFIT", signal_ts=2000)
        session.close_position("BTCUSDT", 99.5, order_type="MARKET", reason="STOP_LOSS", signal_ts=3000)

        working = self._working_exit_orders(session)
        self.assertEqual(len(working), 1)  # только сам MARKET-стоп
        self.assertEqual(working[0].sim.cfg.order_type.value, "MARKET")
        cancelled = [
            o for o in session.orders.values()
            if o.role == PaperOrderRole.EXIT and o.sim.state.status == OrderStatus.CANCELLED
        ]
        self.assertEqual(len(cancelled), 1)  # TP @100.7 отменён
        self.assertEqual(cancelled[0].sim.cfg.price, 100.7)

        # стоп исполняется: fill MARKET SELL 1.0 по бидам
        session.process_event(MockEvent(3150, "depth", {
            "bids": [(99.5, 10.0)],
            "asks": [(99.6, 10.0)],
        }))
        session.process_event(MockEvent(3200, "trade", {"price": 99.5, "quantity": 5.0}, symbol="BTCUSDT"))

        self.assertEqual(self._working_exit_orders(session), [])
        pos = session.positions["BTCUSDT"]
        self.assertTrue(pos.closed)


class TestEntrySlippageGuard(unittest.TestCase):
    """Fill MARKET-входа дальше max_entry_slippage_pct от цены сигнала отклоняется."""

    def _place_market_buy(self, session: PaperTradingSession):
        session.place_order(
            symbol="BTCUSDT", side="BUY", order_type="MARKET",
            price=100.0, quantity=2.0,
            role=PaperOrderRole.ENTRY.value,
            stop_price=99.6, target_price=100.6,
            signal_ts=1000,
        )

    def _fill_market(self, session: PaperTradingSession, ask_top: float):
        session.process_event(MockEvent(1150, "depth", {
            "bids": [(99.9, 10.0)],
            "asks": [(ask_top, 1.0), (ask_top + 0.1, 10.0)],
        }))
        session.process_event(MockEvent(1200, "trade", {"price": ask_top, "quantity": 1.0}, symbol="BTCUSDT"))

    def test_stale_snapshot_fill_rejected(self):
        session = make_session()
        session.max_entry_slippage_pct = 0.4  # %
        self._place_market_buy(session)
        self._fill_market(session, ask_top=100.8)  # avg fill ≈ 100.85 → 0.85% > 0.4%

        self.assertNotIn("BTCUSDT", session.positions)
        entry = [o for o in session.orders.values() if o.role == PaperOrderRole.ENTRY][0]
        self.assertEqual(entry.sim.state.status, OrderStatus.REJECTED)
        # резервированный маржин вернулся
        self.assertAlmostEqual(session.available_margin, 10000.0)

    def test_normal_fill_accepted(self):
        session = make_session()
        session.max_entry_slippage_pct = 0.4
        self._place_market_buy(session)
        self._fill_market(session, ask_top=100.2)  # avg fill ≈ 100.25 → 0.25% < 0.4%

        pos = session.positions.get("BTCUSDT")
        self.assertIsNotNone(pos)
        self.assertGreater(pos.qty, 0.0)

    def test_guard_disabled_by_default(self):
        session = make_session()
        self.assertEqual(session.max_entry_slippage_pct, 0.0)
        self._place_market_buy(session)
        self._fill_market(session, ask_top=100.8)
        self.assertIn("BTCUSDT", session.positions)


if __name__ == "__main__":
    unittest.main()
