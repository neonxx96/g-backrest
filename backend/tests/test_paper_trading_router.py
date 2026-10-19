import pytest
from backend.app.routers.paper_trading_router import (
    get_paper_trading_status,
    reset_paper_wallet,
    place_paper_order,
    ResetWalletRequest,
    OrderSignalRequest
)
from backend.app.services.paper_trading import paper_trading_session


@pytest.mark.anyio
async def test_paper_trading_status_endpoint():
    res = await get_paper_trading_status()
    assert res["status"] == "ok"
    assert "balance" in res
    assert "available_margin" in res
    assert "locked_margin" in res
    assert "positions" in res
    assert "closed_trades" in res
    assert "uptime_seconds" in res
    assert res["initial_balance"] == 100.0


@pytest.mark.anyio
async def test_paper_trading_reset_endpoint():
    res = await reset_paper_wallet(ResetWalletRequest(initial_balance=100.0))
    assert res["status"] == "ok"
    assert res["state"]["balance"] == 100.0
    assert len(res["state"]["positions"]) == 0
    assert len(res["state"]["closed_trades"]) == 0


@pytest.mark.anyio
async def test_paper_trading_place_order_endpoint():
    await reset_paper_wallet(ResetWalletRequest(initial_balance=100.0))
    order_req = OrderSignalRequest(
        symbol="BTCUSDT",
        side="BUY",
        price=60000.0,
        stop_price=59000.0,
        target_price=62000.0,
        order_type="MARKET",
        reason=["EMA crossover + Volume surge", "CVD slope = +21.5"]
    )
    res = await place_paper_order(order_req)
    assert res["status"] == "ok"
    assert "order" in res
    assert res["order"]["symbol"] == "BTCUSDT"
    assert "EMA crossover + Volume surge" in res["order"]["reason"]
    assert "CVD slope = +21.5" in res["order"]["reason"]

    # Reset again to leave clean state
    await reset_paper_wallet(ResetWalletRequest(initial_balance=100.0))
