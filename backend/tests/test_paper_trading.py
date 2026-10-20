"""
Unit tests for backend/app/services/paper_trading.py

Scenarios (Stage 3 acceptance):
- SHORT entry lifecycle: entry fill -> MFE peak -> MFE_Bleed alert -> exit fill -> close
- Fee deduction from virtual balance (maker fees on both legs)
- MAE tracking (max adverse excursion)
- Time stop alert (>300s in trade with < 0.2R profit)
- Determinism: two identical event streams -> identical results
"""
import unittest

from backend.app.services.paper_trading import PaperOrderRole, PaperTradingSession


class MockEvent:
    """ReplayEvent-compatible mock."""

    def __init__(self, timestamp: int, kind: str, payload: dict, symbol: str = None):
        self.timestamp = timestamp
        self.kind = kind
        self.payload = payload
        self.symbol = symbol


class TestPaperTradingSessionLifecycle(unittest.TestCase):

    def setUp(self):
        self.session = PaperTradingSession(
            initial_balance=10000.0,
            risk_per_trade_pct=0.01,
            maker_fee=0.0002,
            taker_fee=0.0005,
            signal_lag_ms=100,
            order_rtt_ms=50,
            session_id="test_paper_session",
        )

    def _trade(self, ts: int, price: float, qty: float) -> MockEvent:
        return MockEvent(ts, "trade", {"price": price, "quantity": qty}, symbol="BTCUSDT")

    def _short_lifecycle_setup(self) -> str:
        """Place + fill SHORT entry limit order (1.0 @ 100.0, stop 102.0 -> R = 2.0).

        active_ts = 1000 + 100 + 50 = 1150. Depth snapshot at 1150 puts 5.0
        volume ahead of us at the ask level 100.0. Trade of 6.0 at 100.0 drains
        the queue (residual 1.0) and fills our full order quantity.
        """
        self.session.place_order(
            symbol="BTCUSDT", side="SELL", order_type="LIMIT",
            price=100.0, quantity=1.0,
            role=PaperOrderRole.ENTRY.value, stop_price=102.0, signal_ts=1000,
        )
        oid = "po_1_1000"
        self.assertEqual(self.session.orders[oid].sim.state.status.value, "PENDING")

        # Depth at active_ts initializes the queue (ask side for SELL order)
        self.session.process_event(MockEvent(1150, "depth", {
            "bids": [(99.9, 10.0)],
            "asks": [(100.0, 5.0), (100.1, 10.0)],
        }))
        st = self.session.orders[oid].sim.state
        self.assertEqual(st.status.value, "ACTIVE")
        self.assertEqual(st.queue_ahead, 5.0)

        # Trade of 6.0 at our price: consumes 5.0 queue, residual 1.0 fills us
        self.session.process_event(self._trade(1200, 100.0, 6.0))
        st = self.session.orders[oid].sim.state
        self.assertEqual(st.status.value, "FILLED")
        self.assertEqual(st.filled_qty, 1.0)
        return oid

    def test_short_entry_lifecycle(self):
        """SHORT entry -> fill -> MFE peak -> MFE_Bleed alert -> exit fill -> close."""
        self._short_lifecycle_setup()

        state = self.session.get_state()
        self.assertEqual(len(state.positions), 1)
        pos = state.positions[0]
        self.assertEqual(pos["side"], "SHORT")
        self.assertEqual(pos["avg_entry_price"], 100.0)
        self.assertEqual(pos["qty"], 1.0)

        # MFE peak: price drops to 98.5 -> pnl = +1.5 = 0.75R (R = 2.0)
        self.session.process_event(self._trade(1300, 98.5, 10.0))
        track = self.session.early_exit_engine.tracks.get("BTCUSDT")
        self.assertIsNotNone(track)
        self.assertEqual(track.mfe, 1.5)

        # Profit bleeds back to 0.5 (33% of MFE) -> MFE_Bleed alert fires
        self.session.process_event(self._trade(1400, 99.5, 10.0))
        self.assertTrue(any(a["alert_type"] == "MFE_Bleed" for a in track.active_alerts))

        # Exit: BUY limit @99.5, signal 1450 -> active 1600; bids queue 2.0
        self.session.place_order(
            symbol="BTCUSDT", side="BUY", order_type="LIMIT",
            price=99.5, quantity=1.0, role=PaperOrderRole.EXIT.value, signal_ts=1450,
        )
        self.session.process_event(MockEvent(1600, "depth", {
            "bids": [(99.5, 2.0)], "asks": [(99.6, 10.0)],
        }))
        self.session.process_event(self._trade(1650, 99.5, 5.0))
        self.assertEqual(self.session.orders["po_2_1450"].sim.state.status.value, "FILLED")

        state = self.session.get_state()
        self.assertEqual(len(state.positions), 0)
        # Net PnL includes both the entry and exit maker fees.
        self.assertAlmostEqual(state.realized_pnl, 0.4601, places=4)
        closed = state.closed_trades[0]
        self.assertAlmostEqual(closed["net_pnl"], 0.4601, places=4)
        self.assertAlmostEqual(closed["fee_drag"], 0.0399, places=4)
        self.assertEqual(closed["mfe"], 1.5)
        self.assertEqual(closed["mae"], 0.0)
        self.assertFalse(closed["profit_bleed"])

    def test_fee_deduction_from_balance(self):
        """Maker fees must be deducted from the virtual balance on both legs."""
        self._short_lifecycle_setup()

        # Entry fee = 100.0 * 1.0 * 0.0002 = 0.02
        state = self.session.get_state()
        self.assertAlmostEqual(state.positions[0]["fees_paid"], 0.02, places=6)
        self.assertAlmostEqual(state.locked_margin, 100.0, places=6)
        self.assertAlmostEqual(state.realized_pnl, 0.0, places=6)

        # Exit: BUY limit @99.8, signal 1500 -> active 1650; bids queue 2.0
        self.session.place_order(
            symbol="BTCUSDT", side="BUY", order_type="LIMIT",
            price=99.8, quantity=1.0, role=PaperOrderRole.EXIT.value, signal_ts=1500,
        )
        self.session.process_event(MockEvent(1650, "depth", {
            "bids": [(99.8, 2.0)], "asks": [(99.9, 5.0)],
        }))
        self.session.process_event(self._trade(1700, 99.8, 5.0))

        state = self.session.get_state()
        # Exit fee = 99.8 * 1.0 * 0.0002 = 0.01996
        # Net PnL includes entry and exit maker fees: 0.20 - 0.02 - 0.01996.
        self.assertAlmostEqual(state.realized_pnl, 0.16004, places=4)
        # balance = initial + realized (position closed -> unrealized = 0)
        self.assertAlmostEqual(state.balance, 10000.16004, places=4)

    def test_mae_tracking(self):
        """MAE tracks the maximum adverse excursion against the position."""
        self._short_lifecycle_setup()

        # Price moves UP to 100.5 (against SHORT) -> MAE = 0.5
        self.session.process_event(self._trade(1300, 100.5, 5.0))
        track = self.session.early_exit_engine.tracks.get("BTCUSDT")
        self.assertIsNotNone(track)
        self.assertEqual(track.mae, 0.5)

        # Price recovers to 99.5 (favorable) -> MAE must stay at peak 0.5
        self.session.process_event(self._trade(1400, 99.5, 5.0))
        self.assertEqual(track.mae, 0.5)

    def test_time_stop_alert(self):
        """Time stop fires after 300s in trade while profit stays < 0.2R."""
        self._short_lifecycle_setup()

        # Advance 350 seconds; price flat at entry -> pnl = 0.0 < 0.2R = 0.4
        self.session.process_event(self._trade(1000 + 350_000, 100.0, 5.0))
        track = self.session.early_exit_engine.tracks.get("BTCUSDT")
        self.assertIsNotNone(track)
        self.assertGreater(track.time_in_trade_sec, 300)
        self.assertTrue(any(a["alert_type"] == "Time_Stop" for a in track.active_alerts))

    def test_session_determinism(self):
        """Two identical event streams must produce identical session state."""
        results = []
        for _ in range(2):
            session = PaperTradingSession(
                initial_balance=10000.0,
                risk_per_trade_pct=0.01,
                session_id="det_test",
            )
            session.place_order(
                symbol="BTCUSDT", side="SELL", order_type="LIMIT",
                price=100.0, quantity=1.0,
                role=PaperOrderRole.ENTRY.value, stop_price=102.0, signal_ts=1000,
            )
            session.process_event(MockEvent(1150, "depth", {
                "bids": [(99.9, 10.0)], "asks": [(100.0, 5.0)],
            }))
            session.process_event(self._trade(1200, 100.0, 6.0))
            session.process_event(self._trade(1300, 99.0, 5.0))
            state = session.get_state()
            results.append({
                "realized_pnl": state.realized_pnl,
                "locked_margin": state.locked_margin,
                "unrealized_pnl": state.unrealized_pnl,
                "position_qty": state.positions[0]["qty"] if state.positions else 0.0,
            })
        self.assertEqual(results[0], results[1])

    def test_wallet_initialization_and_risk_sizing(self):
        """Virtual wallet initializes with $100.00 and calculates 2% risk sizing."""
        session = PaperTradingSession()
        self.assertEqual(session.initial_balance, 100.0)
        self.assertEqual(session.available_margin, 100.0)
        self.assertEqual(session.risk_per_trade_pct, 0.02)
        self.assertEqual(session.taker_fee, 0.0004)

        # Risk budget = 100.0 * 0.02 = $2.00
        # Entry = 100.0, Stop = 98.0 -> SL dist = 2.0 -> qty = 2.00 / 2.0 = 1.0
        qty = session.calculate_position_size("BTCUSDT", entry_price=100.0, stop_price=98.0)
        self.assertAlmostEqual(qty, 1.0, places=6)

        # Entry = 100.0, Stop = 99.0 -> SL dist = 1.0 -> qty = 2.00 / 1.0 = 2.0
        # Max margin allowed: 100.0 / 100.0 = 1.0 -> bounded to 1.0
        qty_clamped = session.calculate_position_size("BTCUSDT", entry_price=100.0, stop_price=99.0)
        self.assertAlmostEqual(qty_clamped, 1.0, places=6)

    def test_taker_fee_deduction_and_closed_trade_tracking(self):
        """0.04% taker fee deduction and closed trades tracking in state."""
        session = PaperTradingSession(
            initial_balance=100.0,
            risk_per_trade_pct=0.02,
            maker_fee=0.0002,
            taker_fee=0.0004,
            signal_lag_ms=0,
            order_rtt_ms=0,
            session_id="fee_test"
        )
        # Entry MARKET order at price 100.0, qty 0.5 (notional $50.00)
        session.place_order(
            symbol="ETHUSDT",
            side="BUY",
            order_type="MARKET",
            price=100.0,
            quantity=0.5,
            role=PaperOrderRole.ENTRY.value,
            signal_ts=1000
        )
        # Provide ask liquidity
        session.process_event(MockEvent(1000, "depth", {
            "bids": [(99.9, 5.0)],
            "asks": [(100.0, 5.0)]
        }))
        session.process_event(MockEvent(1000, "trade", {"price": 100.0, "quantity": 1.0}, symbol="ETHUSDT"))
        
        # Verify taker fee paid: 50.0 * 0.0004 = 0.02 USDT
        state = session.get_state()
        self.assertEqual(len(state.positions), 1)
        self.assertAlmostEqual(state.positions[0]["fees_paid"], 0.02, places=6)
        self.assertAlmostEqual(state.locked_margin, 50.0, places=6)
        self.assertAlmostEqual(state.available_margin, 50.0, places=6)

        # Exit MARKET order at price 104.0, qty 0.5 (notional $52.00)
        session.place_order(
            symbol="ETHUSDT",
            side="SELL",
            order_type="MARKET",
            price=104.0,
            quantity=0.5,
            role=PaperOrderRole.EXIT.value,
            signal_ts=2000
        )
        session.process_event(MockEvent(2000, "depth", {
            "bids": [(104.0, 5.0)],
            "asks": [(104.1, 5.0)]
        }))
        session.process_event(MockEvent(2000, "trade", {"price": 104.0, "quantity": 1.0}, symbol="ETHUSDT"))

        # Gross PnL = (104 - 100) * 0.5 = +2.00 USDT
        # Exit fee = 52.0 * 0.0004 = 0.0208 USDT
        # Net realized PnL = 2.00 - 0.0200 entry fee - 0.0208 exit fee.
        final_state = session.get_state()
        self.assertEqual(len(final_state.positions), 0)
        self.assertEqual(len(final_state.closed_trades), 1)
        self.assertAlmostEqual(final_state.realized_pnl, 1.9592, places=4)
        self.assertAlmostEqual(final_state.balance, 100.0 + 1.9592, places=4)
        self.assertAlmostEqual(final_state.total_fees_paid, 0.02 + 0.0208, places=4)

    def test_dynamic_breakeven_trigger_on_mfe(self):
        """Dynamic Breakeven moves SL to Entry + 2*Fee + 1tick when MFE reaches +0.5R."""
        session = PaperTradingSession(
            initial_balance=100.0,
            maker_fee=0.0002,
            taker_fee=0.0005,
            signal_lag_ms=0,
            order_rtt_ms=0,
            session_id="be_test"
        )
        # Entry at 100.0 with SL at 98.0 (R = 2.0 USDT)
        session.place_order(
            symbol="BTCUSDT",
            side="BUY",
            order_type="MARKET",
            price=100.0,
            quantity=0.1,
            role=PaperOrderRole.ENTRY.value,
            stop_price=98.0,
            signal_ts=1000
        )
        session.process_event(MockEvent(1000, "depth", {"bids": [(99.9, 1.0)], "asks": [(100.0, 1.0)]}))
        session.process_event(MockEvent(1000, "trade", {"price": 100.0, "quantity": 0.1}, symbol="BTCUSDT"))

        pos = session.positions["BTCUSDT"]
        self.assertEqual(pos.stop_price, 98.0)
        self.assertEqual(pos.initial_stop_price, 98.0)
        self.assertFalse(pos.breakeven_triggered)

        # Small price move to 100.4 (MFE = +0.4, which is 0.2R < 0.5R) -> BE not triggered
        session.process_event(MockEvent(1100, "trade", {"price": 100.4, "quantity": 0.1}, symbol="BTCUSDT"))
        self.assertEqual(pos.stop_price, 98.0)
        self.assertFalse(pos.breakeven_triggered)

        # Price reaches 101.0 (MFE = +1.0, which is 0.5R >= 0.5R) -> Dynamic Breakeven triggered!
        session.process_event(MockEvent(1200, "trade", {"price": 101.0, "quantity": 0.1}, symbol="BTCUSDT"))
        self.assertTrue(pos.breakeven_triggered)

        # Expected SL = Entry (100.0) + (100.0 * 2 * 0.0005) + tick (0.001) = 100.0 + 0.10 + 0.001 = 100.101
        expected_sl = 100.0 + (100.0 * 2.0 * 0.0005) + session.estimate_tick_size(100.0)
        self.assertAlmostEqual(pos.stop_price, expected_sl, places=4)
        self.assertGreater(pos.stop_price, 100.0)  # Strictly above entry

    def test_maker_tp_fee_vs_taker_sl_fee(self):
        """Take Profit executions use LIMIT (Maker fee = 0.02%), while SL uses MARKET (Taker fee = 0.05%)."""
        session = PaperTradingSession(
            initial_balance=100.0,
            maker_fee=0.0002,
            taker_fee=0.0005,
            signal_lag_ms=0,
            order_rtt_ms=0,
            session_id="tp_maker_test"
        )
        # Entry at 100.0, qty 0.1
        session.place_order("SOLUSDT", "BUY", "LIMIT", 100.0, 0.1, PaperOrderRole.ENTRY.value, signal_ts=1000)
        session.process_event(MockEvent(1000, "depth", {"bids": [(99.0, 1.0)], "asks": [(101.0, 1.0)]}))
        # Trade through limit price
        session.process_event(MockEvent(1000, "trade", {"price": 99.5, "quantity": 0.1}, symbol="SOLUSDT"))

        # Close via Take Profit (LIMIT order -> maker fee)
        session.close_position("SOLUSDT", price=105.0, order_type="LIMIT", reason="Take Profit Hit", signal_ts=2000)
        session.process_event(MockEvent(2000, "depth", {"bids": [(104.0, 1.0)], "asks": [(106.0, 1.0)]}))
        session.process_event(MockEvent(2000, "trade", {"price": 105.5, "quantity": 0.1}, symbol="SOLUSDT"))

        state = session.get_state()
        self.assertEqual(len(state.closed_trades), 1)
        closed = state.closed_trades[0]
        # Exit notional = 105.0 * 0.1 = 10.5
        # Maker fee = 10.5 * 0.0002 = 0.0021
        self.assertAlmostEqual(closed["fee"], 0.0021, places=5)
        self.assertEqual(closed["reason"], "Take Profit Hit")

    def test_process_market_tick_forwards_real_price_and_l2(self):
        session = PaperTradingSession(
            initial_balance=1000.0,
            maker_fee=0.0002,
            taker_fee=0.0005,
            signal_lag_ms=0,
            order_rtt_ms=0,
            session_id="live_tick_test",
        )
        session.place_order(
            symbol="BTCUSDT",
            side="BUY",
            order_type="LIMIT",
            price=100.0,
            quantity=1.0,
            role=PaperOrderRole.ENTRY.value,
            stop_price=98.0,
            target_price=104.0,
            signal_ts=1000,
        )
        session.process_market_tick(
            "BTCUSDT",
            100.0,
            bids=[(99.9, 2.0)],
            asks=[(100.1, 2.0)],
            timestamp=1000,
        )
        state = session.get_state()
        self.assertEqual(len(state.positions), 1)
        self.assertEqual(state.positions[0]["symbol"], "BTCUSDT")
        self.assertAlmostEqual(session.last_prices["BTCUSDT"], 100.0)

    def test_partial_exit_and_funding_are_accounted_separately(self):
        session = PaperTradingSession(
            initial_balance=1000.0,
            maker_fee=0.0002,
            taker_fee=0.0005,
            signal_lag_ms=0,
            order_rtt_ms=0,
            session_id="partial_funding_test",
        )
        session.place_order("BTCUSDT", "BUY", "LIMIT", 100.0, 1.0, PaperOrderRole.ENTRY.value, stop_price=98.0, signal_ts=1000)
        session.process_event(MockEvent(1000, "depth", {"bids": [(99.9, 2.0)], "asks": [(100.1, 2.0)]}))
        session.process_event(self._trade(1000, 100.0, 1.0))
        session.apply_funding("BTCUSDT", 0.001, 2000)
        session.close_position("BTCUSDT", 102.0, order_type="LIMIT", reason="TP1_PARTIAL", signal_ts=3000, quantity=0.5)
        session.process_event(MockEvent(3000, "depth", {"bids": [(101.9, 2.0)], "asks": [(102.1, 2.0)]}))
        session.process_event(self._trade(3000, 102.0, 0.5))
        state = session.get_state()
        self.assertEqual(len(state.positions), 1)
        self.assertAlmostEqual(state.positions[0]["qty"], 0.5)
        self.assertAlmostEqual(state.total_funding_paid, 0.1, places=6)
        self.assertEqual(state.closed_trades[0]["reason"], "TP1_PARTIAL")

    def test_position_sizing_uses_leverage_only_for_margin_cap(self):
        session = PaperTradingSession(initial_balance=1000.0, risk_per_trade_pct=0.01)

        without_leverage = session.calculate_position_size(
            "BTCUSDT", entry_price=100.0, stop_price=99.99, leverage=1.0
        )
        with_leverage = session.calculate_position_size(
            "BTCUSDT", entry_price=100.0, stop_price=99.99, leverage=5.0
        )

        self.assertAlmostEqual(without_leverage, 10.0)
        self.assertAlmostEqual(with_leverage, 50.0)


if __name__ == "__main__":
    unittest.main()

