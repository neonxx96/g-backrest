import asyncio
from types import SimpleNamespace

import pytest

from backend.app.services.overnight_pilot import (
    OvernightPilotConfig,
    OvernightPilotManager,
    PilotSession,
)


def _backtest(strategy: str, *, net: float, pf: float, trades: int, dd: float):
    return {
        "meta": {"strategy_type": strategy, "closed_candles_only": True},
        "summary": {
            "net_pnl_usd": net,
            "profit_factor": pf,
            "total_trades": trades,
            "max_drawdown_pct": dd,
        },
        "trades": [],
    }


def test_challenger_evaluation_does_not_mutate_running_incumbent(monkeypatch):
    manager = OvernightPilotManager()
    config = OvernightPilotConfig(symbol="BTCUSDT", strategy_type="ema_trend")
    runner = SimpleNamespace(is_running=True, strategy_type="ema_trend")
    session = PilotSession(
        config=config,
        runner=runner,
        backtest=_backtest("ema_trend", net=2.0, pf=1.15, trades=20, dd=2.0),
    )
    manager.sessions["BTCUSDT"] = session
    calls = {"backtest": 0, "forecast": 0}

    async def fake_backtest(request):
        calls["backtest"] += 1
        assert request.strategy_type == "ema_pullback"
        return _backtest("ema_pullback", net=8.0, pf=1.45, trades=24, dd=1.8)

    async def fake_forecast(symbol, timeframe, strategy_type, strategy_params):
        calls["forecast"] += 1
        assert (symbol, timeframe, strategy_type) == ("BTCUSDT", "15m", "ema_pullback")
        return {"data_status": "connected", "base_scenario": {"direction": "LONG"}}

    monkeypatch.setattr("backend.app.services.overnight_pilot.run_backtest", fake_backtest)
    monkeypatch.setattr("backend.app.services.overnight_pilot.compute_probabilistic_forecast", fake_forecast)

    first = asyncio.run(manager.evaluate_challenger("BTCUSDT", "ema_pullback"))
    second = asyncio.run(manager.evaluate_challenger("BTCUSDT", "ema_pullback"))

    assert first["recommendation"] == "CANDIDATE"
    assert second["job_id"] == first["job_id"]
    assert second["deduplicated"] is True
    assert calls == {"backtest": 1, "forecast": 1}
    assert session.config.strategy_type == "ema_trend"
    assert runner.strategy_type == "ema_trend"


def test_challenger_rejects_disconnected_forecast(monkeypatch):
    manager = OvernightPilotManager()
    session = PilotSession(
        config=OvernightPilotConfig(symbol="ETHUSDT", strategy_type="ema_trend"),
        runner=SimpleNamespace(is_running=True, strategy_type="ema_trend"),
        backtest=_backtest("ema_trend", net=-1.0, pf=0.8, trades=20, dd=3.0),
    )
    manager.sessions["ETHUSDT"] = session

    async def fake_backtest(request):
        return _backtest(request.strategy_type, net=10.0, pf=1.5, trades=30, dd=1.0)

    async def fake_forecast(*args, **kwargs):
        return {"data_status": "stale", "base_scenario": {"direction": "LONG"}}

    monkeypatch.setattr("backend.app.services.overnight_pilot.run_backtest", fake_backtest)
    monkeypatch.setattr("backend.app.services.overnight_pilot.compute_probabilistic_forecast", fake_forecast)

    result = asyncio.run(manager.evaluate_challenger("ETHUSDT", "ema_pullback"))

    assert result["recommendation"] == "REJECT"
    assert "forecast" in result["reason"].lower()
    assert session.config.strategy_type == "ema_trend"


def test_challenger_requires_existing_pair_and_different_catalog_strategy():
    manager = OvernightPilotManager()
    manager.sessions["BTCUSDT"] = PilotSession(
        OvernightPilotConfig(symbol="BTCUSDT", strategy_type="ema_trend")
    )

    with pytest.raises(ValueError, match="not found"):
        asyncio.run(manager.evaluate_challenger("UNKNOWNUSDT", "ema_pullback"))
    with pytest.raises(ValueError, match="different"):
        asyncio.run(manager.evaluate_challenger("BTCUSDT", "ema_trend"))
    with pytest.raises(ValueError, match="unknown paper strategy"):
        asyncio.run(manager.evaluate_challenger("BTCUSDT", "invented_ai_strategy"))


def test_pair_challenger_api_submits_and_lists_results(monkeypatch):
    from backend.app.routers.overnight_pilot import (
        ChallengerRequest,
        get_pair_challengers,
        promote_pair_challenger,
        submit_pair_challenger,
    )
    from backend.app.services.overnight_pilot import overnight_pilot_manager

    result = {
        "job_id": "job-1",
        "symbol": "BTCUSDT",
        "challenger_strategy": "ema_pullback",
        "recommendation": "CANDIDATE",
    }
    session = PilotSession(OvernightPilotConfig(symbol="BTCUSDT", strategy_type="ema_trend"))
    session.challengers["job-1"] = result
    monkeypatch.setattr(overnight_pilot_manager, "sessions", {"BTCUSDT": session})

    async def fake_evaluate(symbol, strategy_type):
        assert (symbol, strategy_type) == ("BTCUSDT", "ema_pullback")
        return result

    monkeypatch.setattr(overnight_pilot_manager, "evaluate_challenger", fake_evaluate)

    def fake_promote(symbol, job_id, automatic=False):
        assert (symbol, job_id, automatic) == ("BTCUSDT", "job-1", False)
        return {**result, "promotion_status": "APPLIED"}

    monkeypatch.setattr(overnight_pilot_manager, "promote_challenger", fake_promote)

    submitted = asyncio.run(
        submit_pair_challenger("btcusdt", ChallengerRequest(strategy_type="ema_pullback"))
    )
    listed = asyncio.run(get_pair_challengers("btcusdt"))
    promoted = asyncio.run(promote_pair_challenger("btcusdt", "job-1"))

    assert submitted == result
    assert listed == {"symbol": "BTCUSDT", "challengers": [result], "count": 1}
    assert promoted["promotion_status"] == "APPLIED"


def test_auto_switch_waits_for_flat_position_then_applies_candidate():
    manager = OvernightPilotManager()
    config = OvernightPilotConfig(
        symbol="BTCUSDT",
        strategy_type="ema_trend",
        auto_strategy_switch=True,
    )
    position = SimpleNamespace(closed=False, qty=1.0)
    paper_session = SimpleNamespace(positions={"BTCUSDT": position})
    runner = SimpleNamespace(
        is_running=True,
        strategy_type="ema_trend",
        config_fingerprint="old",
        session=paper_session,
        indicator_candle_close_time=123,
        _last_entry_candle=100,
    )
    session = PilotSession(
        config=config,
        runner=runner,
        config_fingerprint="old",
        backtest=_backtest("ema_trend", net=2.0, pf=1.15, trades=20, dd=2.0),
        forecast={"data_status": "connected"},
    )
    result = {
        "job_id": "candidate-1",
        "recommendation": "CANDIDATE",
        "challenger_strategy": "ema_pullback",
        "backtest": _backtest("ema_pullback", net=8.0, pf=1.45, trades=24, dd=1.8),
        "forecast": {"data_status": "connected", "base_scenario": {"direction": "LONG"}},
    }
    session.challengers[result["job_id"]] = result
    manager.sessions["BTCUSDT"] = session

    waiting = manager.promote_challenger("BTCUSDT", "candidate-1", automatic=True)

    assert waiting["promotion_status"] == "WAITING_FOR_FLAT"
    assert session.config.strategy_type == "ema_trend"
    assert runner.strategy_type == "ema_trend"

    position.closed = True
    applied = manager.promote_challenger("BTCUSDT", "candidate-1", automatic=True)

    assert applied["promotion_status"] == "APPLIED"
    assert session.config.strategy_type == "ema_pullback"
    assert runner.strategy_type == "ema_pullback"
    assert session.backtest is result["backtest"]
    assert session.forecast is result["forecast"]
    assert runner.config_fingerprint == session.config_fingerprint
    assert runner._last_entry_candle == 123


def test_automatic_promotion_requires_explicit_session_setting():
    manager = OvernightPilotManager()
    session = PilotSession(
        config=OvernightPilotConfig(symbol="BTCUSDT", strategy_type="ema_trend"),
        runner=SimpleNamespace(is_running=True, strategy_type="ema_trend"),
    )
    session.challengers["candidate-1"] = {
        "job_id": "candidate-1",
        "recommendation": "CANDIDATE",
        "challenger_strategy": "ema_pullback",
        "backtest": {},
        "forecast": {"data_status": "connected"},
    }
    manager.sessions["BTCUSDT"] = session

    result = manager.promote_challenger("BTCUSDT", "candidate-1", automatic=True)

    assert result["promotion_status"] == "AWAITING_APPROVAL"
    assert session.config.strategy_type == "ema_trend"


def test_challenger_loop_evaluates_alternative_while_runner_is_active(monkeypatch):
    manager = OvernightPilotManager()
    manager.CHALLENGER_INTERVAL_SEC = 0
    runner = SimpleNamespace(is_running=True)
    session = PilotSession(
        config=OvernightPilotConfig(symbol="BTCUSDT", strategy_type="ema_trend"),
        runner=runner,
    )
    seen = []

    async def fake_evaluate(symbol, strategy_type):
        seen.append((symbol, strategy_type))
        runner.is_running = False
        return {"recommendation": "KEEP"}

    monkeypatch.setattr(manager, "evaluate_challenger", fake_evaluate)

    asyncio.run(manager._challenger_loop(session, initial_delay=0))

    assert len(seen) == 1
    assert seen[0][0] == "BTCUSDT"
    assert seen[0][1] != "ema_trend"
