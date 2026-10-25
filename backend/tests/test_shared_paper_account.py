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
