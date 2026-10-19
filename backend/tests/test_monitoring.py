import pytest
from backend.app.routers.monitoring import (
    get_monitoring_state,
    get_system_monitoring_state,
    toggle_ticker_monitoring,
    set_monitored_tickers,
    ToggleTickerRequest,
    SetMonitoredTickersRequest,
)
from backend.app.engine.background_worker import BackgroundWorker, DEFAULT_FOCUS_LIST


@pytest.mark.anyio
async def test_get_monitoring_state_endpoint():
    res = await get_monitoring_state()
    assert "monitored_tickers" in res
    assert "statuses" in res
    assert "active_tasks_count" in res
    assert "BTCUSDT" in res["monitored_tickers"]


@pytest.mark.anyio
async def test_get_system_monitoring_state_endpoint():
    res = await get_system_monitoring_state()
    assert res["status"] == "ok"
    assert "uptime" in res
    assert res["uptime"] >= 0
    assert "active_workers" in res
    assert "monitored_tickers" in res
    assert "statuses" in res
    assert "BTCUSDT" in res["monitored_tickers"]


@pytest.mark.anyio
async def test_toggle_monitoring_endpoint():
    test_ticker = "DOGEUSDT"
    res_on = await toggle_ticker_monitoring(ToggleTickerRequest(ticker=test_ticker, monitored=True))
    assert res_on["status"] == "ok"
    assert test_ticker in res_on["monitored_tickers"]

    res_off = await toggle_ticker_monitoring(ToggleTickerRequest(ticker=test_ticker, monitored=False))
    assert res_off["status"] == "ok"
    assert test_ticker not in res_off["monitored_tickers"]


@pytest.mark.anyio
async def test_set_monitored_tickers_endpoint():
    custom_list = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
    res = await set_monitored_tickers(SetMonitoredTickersRequest(tickers=custom_list))
    assert res["status"] == "ok"
    assert set(res["monitored_tickers"]) == set(custom_list)

    # Restore default focus coins
    await set_monitored_tickers(SetMonitoredTickersRequest(tickers=DEFAULT_FOCUS_LIST))


@pytest.mark.anyio
async def test_background_worker_concurrency_and_cancellation():
    worker = BackgroundWorker(max_concurrency=2, cycle_interval_sec=3600)
    worker.set_monitored_tickers(["BTCUSDT", "SOLUSDT"])
    assert worker.is_monitored("BTCUSDT")
    assert worker.is_monitored("SOLUSDT")
    assert not worker.is_monitored("XRPUSDT")

    # Toggle off SOLUSDT
    worker.toggle_ticker("SOLUSDT", False)
    assert not worker.is_monitored("SOLUSDT")
