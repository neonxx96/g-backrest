import pytest
from backend.app.services.paper_trading import PaperTradingSession, PaperOrderRole
from backend.app.services.execution_simulator import OrderStatus
from backend.app.services.risk_engine import can_open_position
from backend.app.services.overnight_pilot import OvernightPilotManager, OvernightPilotConfig


def test_paper_trading_session_pair_pause_blocks_entries():
    session = PaperTradingSession(initial_balance=1000.0)
    session.paused_symbols.add("BTCUSDT")

    # Entry order for paused symbol must be rejected
    with pytest.raises(ValueError, match="PAIR_PAUSED"):
        session.place_order(
            symbol="BTCUSDT",
            side="BUY",
            order_type="LIMIT",
            price=60000.0,
            quantity=0.01,
            role=PaperOrderRole.ENTRY.value,
        )

    # Entry order for non-paused symbol is allowed
    order = session.place_order(
        symbol="ETHUSDT",
        side="BUY",
        order_type="LIMIT",
        price=3000.0,
        quantity=0.1,
        role=PaperOrderRole.ENTRY.value,
    )
    assert order["status"] == OrderStatus.PENDING.value

    # Resume BTCUSDT
    session.paused_symbols.discard("BTCUSDT")
    order_btc = session.place_order(
        symbol="BTCUSDT",
        side="BUY",
        order_type="LIMIT",
        price=60000.0,
        quantity=0.01,
        role=PaperOrderRole.ENTRY.value,
    )
    assert order_btc["status"] == OrderStatus.PENDING.value


def test_risk_engine_can_open_position_respects_paused_symbols():
    open_positions = []
    equity = 1000.0
    new_risk_usd = 5.0

    # Normal pair
    allowed, reason = can_open_position(
        new_risk_usd=new_risk_usd,
        new_side="LONG",
        open_positions=open_positions,
        equity=equity,
        symbol="BTCUSDT",
        paused_symbols={"SOLUSDT"},
    )
    assert allowed is True
    assert reason == "OK"

    # Paused pair
    allowed_paused, reason_paused = can_open_position(
        new_risk_usd=new_risk_usd,
        new_side="LONG",
        open_positions=open_positions,
        equity=equity,
        symbol="SOLUSDT",
        paused_symbols={"SOLUSDT"},
    )
    assert allowed_paused is False
    assert "PAIR_PAUSED" in reason_paused


def test_overnight_pilot_manager_pair_lifecycle():
    import asyncio
    manager = OvernightPilotManager()
    
    # 1. Pause pair
    pause_res = asyncio.run(manager.pause_pair("BTCUSDT", close_position=False, reason="MANUAL_PAUSE"))
    assert pause_res["symbol"] == "BTCUSDT"
    assert pause_res["status"] == "paused"
    assert manager.pair_states["BTCUSDT"] == "paused"

    # 2. Get pairs list
    pairs = manager.get_pairs()
    btc_pair = next((p for p in pairs if p["symbol"] == "BTCUSDT"), None)
    assert btc_pair is not None
    assert btc_pair["status"] == "paused"

    # 3. Resume pair
    resume_res = asyncio.run(manager.resume_pair("BTCUSDT"))
    assert resume_res["symbol"] == "BTCUSDT"
    assert resume_res["status"] == "active"
    assert manager.pair_states["BTCUSDT"] == "active"

    # 4. Emergency close pair
    close_res = asyncio.run(manager.close_pair("BTCUSDT", reason="EMERGENCY_TEST"))
    assert close_res["symbol"] == "BTCUSDT"
    assert close_res["status"] == "closed"


def test_overnight_pilot_batch_pause_and_resume():
    import asyncio
    manager = OvernightPilotManager()
    
    # Pause all
    pause_all_res = asyncio.run(manager.pause_all_pairs())
    assert pause_all_res["action"] == "pause_all"
    assert pause_all_res["count"] >= 3
    for p in pause_all_res["pairs"]:
        assert p["status"] == "paused"

    # Resume all
    resume_all_res = asyncio.run(manager.resume_all_pairs())
    assert resume_all_res["action"] == "resume_all"
    assert resume_all_res["count"] >= 3
    for p in resume_all_res["pairs"]:
        assert p["status"] == "active"
