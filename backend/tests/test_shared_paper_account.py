import pytest
import asyncio
from backend.app.services.overnight_pilot import OvernightPilotConfig, OvernightPilotManager
from backend.app.services.paper_trading import PaperTradingSession
from backend.app.services.live_paper_runner import LivePaperRunner

def test_shared_paper_session_aggregates_total_capital_1000():
    manager = OvernightPilotManager()
    shared = PaperTradingSession(initial_balance=1000.0, session_id="test_shared_1000")
    manager._shared_paper_session = shared

    # Simulate 3 runners sharing this session
    r1 = LivePaperRunner(session=shared)
    r1.symbol = "BTCUSDT"
    r1.start({"symbol": "BTCUSDT", "initial_capital": 1000.0, "risk_per_trade_pct": 1.0}, reset_wallet=False)

    r2 = LivePaperRunner(session=shared)
    r2.symbol = "ETHUSDT"
    r2.start({"symbol": "ETHUSDT", "initial_capital": 1000.0, "risk_per_trade_pct": 1.0}, reset_wallet=False)

    r3 = LivePaperRunner(session=shared)
    r3.symbol = "SOLUSDT"
    r3.start({"symbol": "SOLUSDT", "initial_capital": 1000.0, "risk_per_trade_pct": 1.0}, reset_wallet=False)

    # Initial balance must strictly be 1000.0 (not 3000.0!)
    assert shared.initial_balance == 1000.0
    assert shared.available_margin == 1000.0

    # Simulate trade on BTCUSDT
    shared.positions["BTCUSDT"] = type("Pos", (), {
        "closed": False,
        "symbol": "BTCUSDT",
        "side": "LONG",
        "qty": 0.01,
        "avg_entry_price": 50000.0,
        "margin_used": 100.0,
        "fees_paid": 0.5,
        "risk_amount": 10.0,
        "entry_ts": 1000,
        "stop_price": 49000.0,
        "initial_stop_price": 49000.0,
        "breakeven_triggered": False,
        "unrealized_pnl": lambda self, price: 20.0,
    })()
    shared.last_prices["BTCUSDT"] = 52000.0

    st = r1.get_status()
    assert len(st["open_positions"]) == 1
    assert st["open_positions"][0]["symbol"] == "BTCUSDT"

    # ETH runner should see NO open positions for ETH
    st2 = r2.get_status()
    assert len(st2["open_positions"]) == 0

    # Aggregate status must report initial_capital = 1000.0
    report = manager._aggregate_report({}, [], shared_session=shared)
    assert report["paper"]["starting_balance"] == 1000.0
    assert report["paper"]["equity"] >= 1000.0


def test_shared_paper_session_isolates_cross_symbol_ticks():
    """Ensure OPUSDT ticks ($0.11) do NOT corrupt or reject BTCUSDT ($50,000) working orders."""
    from backend.app.services.execution_simulator import OrderStatus

    session = PaperTradingSession(initial_balance=1000.0, session_id="test_cross_symbol_isolation")
    # Place a LIMIT BUY order on BTCUSDT at 50,000
    res = session.execute_trade_signal(
        symbol="BTCUSDT",
        side="BUY",
        price=50000.0,
        stop_price=49000.0,
        target_price=52000.0,
        order_type="LIMIT",
        signal_ts=1000,
    )
    assert res.get("status") in (OrderStatus.PENDING.value, OrderStatus.ACTIVE.value)
    order_id = res["order_id"]
    po = session.orders[order_id]

    # Advance time and send ticks for OPUSDT (price $0.11)
    session.process_market_tick(
        symbol="OPUSDT",
        price=0.11,
        bids=[(0.110, 1000.0), (0.109, 2000.0)],
        asks=[(0.111, 1000.0), (0.112, 2000.0)],
        timestamp=2000,
    )

    # BTCUSDT order MUST NOT be affected (not rejected, not filled with 0.11 price)
    assert po.sim.state.status in (OrderStatus.PENDING, OrderStatus.ACTIVE)
    assert po.sim.state.filled_qty == 0.0

    from types import SimpleNamespace

    # Book init with passive non-crossable spread (best ask > limit price 50000)
    session.process_market_tick(
        symbol="BTCUSDT",
        price=50005.0,
        bids=[(50000.0, 1.0)],
        asks=[(50005.0, 1.0)],
        timestamp=3000,
    )
    assert po.sim.state.status == OrderStatus.ACTIVE

    # Now trade arrives at 50000 (filling our limit order)
    session.process_event(SimpleNamespace(
        timestamp=4000,
        kind="trade",
        symbol="BTCUSDT",
        payload={"price": 50000.0, "quantity": 2.0, "side": "SELL"},
    ))

    # Order should now be filled correctly for BTCUSDT without slippage rejection
    assert po.sim.state.status == OrderStatus.FILLED
    assert "BTCUSDT" in session.positions
    assert session.positions["BTCUSDT"].qty > 0
    assert abs(session.positions["BTCUSDT"].avg_entry_price - 50000.0) < 1e-6


def test_archived_multi_pair_status_does_not_sum_one_shared_balance_per_symbol():
    """Stopped runner snapshots still represent one account, not N virtual wallets."""
    manager = OvernightPilotManager()
    sessions = {
        symbol: {
            "config": {"initial_capital": 1000.0, "risk_per_trade_pct": 0.5},
            "paper": {
                "session_id": "overnight_shared_demo",
                "initial_capital": 1000.0,
                "current_equity": 1000.0,
                "realized_pnl": 0.0,
                "unrealized_pnl": 0.0,
                "closed_trades": [],
            },
        }
        for symbol in ("BTCUSDT", "ETHUSDT", "SOLUSDT")
    }

    report = manager._aggregate_report(sessions, [], shared_session=None)

    assert report["paper"]["starting_balance"] == 1000.0
    assert report["paper"]["equity"] == 1000.0


def test_shared_account_status_keeps_account_and_run_identities_distinct():
    """The shared wallet is an account; the preflight/start token is a run."""
    manager = OvernightPilotManager()
    sessions = {
        symbol: {
            "run_id": "run_immutable_1",
            "config": {"initial_capital": 1000.0, "risk_per_trade_pct": 0.5},
            "paper": {
                "session_id": "overnight_shared_account_1",
                "initial_balance": 1000.0,
                "balance": 998.5,
                "current_equity": 998.5,
                "realized_pnl": -1.5,
                "unrealized_pnl": 0.0,
                "closed_trades": [],
            },
        }
        for symbol in ("BTCUSDT", "ETHUSDT")
    }

    report = manager._aggregate_report(sessions, [], shared_session=None)

    assert report["paper"]["account_id"] == "overnight_shared_account_1"
    assert report["paper"]["run_id"] == "run_immutable_1"
    assert report["paper"]["state_source"] == "persisted_snapshot"
    assert report["paper"]["equity"] == 998.5


def test_paper_session_status_exposes_legacy_account_identity_compatibly():
    session = PaperTradingSession(initial_balance=100.0, session_id="legacy_local_account")

    state = session.get_state().to_dict()

    assert state["session_id"] == "legacy_local_account"
    assert state["account_id"] == "legacy_local_account"
