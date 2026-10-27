import pytest
from fastapi import HTTPException
from backend.app.services.paper_trading import PaperTradingSession, PaperOrderRole
from backend.app.services.execution_simulator import OrderStatus
from backend.app.services.risk_engine import can_open_position
from backend.app.services.overnight_pilot import OvernightPilotManager, overnight_pilot_manager
from backend.app.routers.overnight_pilot import (
    pause_trading_pair,
    resume_trading_pair,
    emergency_close_pair,
    get_pairs_status,
    PausePairRequest,
    ClosePairRequest,
)


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


@pytest.mark.anyio
async def test_overnight_pilot_manager_pair_lifecycle_and_idempotence():
    manager = OvernightPilotManager()

    # 1. Pause pair
    pause_res = await manager.pause_pair("BTCUSDT", close_position=False, reason="MANUAL_PAUSE")
    assert pause_res["symbol"] == "BTCUSDT"
    assert pause_res["status"] == "paused"
    assert manager.pair_states["BTCUSDT"] == "paused"

    # Idempotent pause
    pause_res_2 = await manager.pause_pair("BTCUSDT", close_position=False, reason="MANUAL_PAUSE_AGAIN")
    assert pause_res_2["status"] == "paused"

    # 2. Get pairs list
    pairs = manager.get_pairs()
    btc_pair = next((p for p in pairs if p["symbol"] == "BTCUSDT"), None)
    assert btc_pair is not None
    assert btc_pair["status"] == "paused"

    # 3. Resume pair
    resume_res = await manager.resume_pair("BTCUSDT")
    assert resume_res["symbol"] == "BTCUSDT"
    assert resume_res["status"] == "active"
    assert manager.pair_states["BTCUSDT"] == "active"

    # Idempotent resume
    resume_res_2 = await manager.resume_pair("BTCUSDT")
    assert resume_res_2["status"] == "active"

    # 4. Emergency close pair with pause_after=True
    close_res = await manager.close_pair("BTCUSDT", pause_after=True, reason="MANUAL_PAIR_CLOSE")
    assert close_res["symbol"] == "BTCUSDT"
    assert close_res["status"] == "paused"
    assert close_res["reason"] == "MANUAL_PAIR_CLOSE"

    # 5. Close pair with pause_after=False
    await manager.resume_pair("BTCUSDT")
    close_no_pause = await manager.close_pair("BTCUSDT", pause_after=False, reason="TEST_CLOSE")
    assert close_no_pause["status"] == "active"


@pytest.mark.anyio
async def test_manager_restart_persistence():
    manager_1 = OvernightPilotManager()
    await manager_1.pause_pair("ZECUSDT", close_position=False, reason="PERSISTENCE_TEST_KEY")

    # Simulate fresh manager on backend restart
    manager_2 = OvernightPilotManager()
    assert "ZECUSDT" not in manager_2.pair_states or manager_2.pair_states.get("ZECUSDT") != "paused"

    # Load from DB
    await manager_2.load_persisted_states()
    assert manager_2.pair_states.get("ZECUSDT") == "paused"
    assert manager_2.pair_reasons.get("ZECUSDT") == "PERSISTENCE_TEST_KEY"

    # Clean up state
    await manager_2.resume_pair("ZECUSDT")


@pytest.mark.anyio
async def test_api_routes_404_and_emergency_stop_guard():
    # 1. 404 on unknown symbol
    with pytest.raises(HTTPException) as exc_pause_404:
        await pause_trading_pair("UNKNOWN_NONEXISTENT_XYZ", PausePairRequest())
    assert exc_pause_404.value.status_code == 404
    assert "not found" in exc_pause_404.value.detail

    with pytest.raises(HTTPException) as exc_resume_404:
        await resume_trading_pair("UNKNOWN_NONEXISTENT_XYZ")
    assert exc_resume_404.value.status_code == 404

    with pytest.raises(HTTPException) as exc_close_404:
        await emergency_close_pair("UNKNOWN_NONEXISTENT_XYZ", ClosePairRequest())
    assert exc_close_404.value.status_code == 404

    # 2. Emergency stop blocks individual pair resume
    overnight_pilot_manager._emergency_stopped = True
    try:
        with pytest.raises(HTTPException) as exc_blocked:
            await resume_trading_pair("BTCUSDT")
        assert exc_blocked.value.status_code == 409
        assert "blocked" in exc_blocked.value.detail
    finally:
        overnight_pilot_manager._emergency_stopped = False

    # 3. Successful pause & resume via router handlers
    res_pause = await pause_trading_pair("BTCUSDT", PausePairRequest(close_position=False, reason="ROUTER_TEST"))
    assert res_pause["status"] == "paused"

    res_resume = await resume_trading_pair("BTCUSDT")
    assert res_resume["status"] == "active"
