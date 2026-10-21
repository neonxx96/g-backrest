import pytest
from fastapi import HTTPException

from backend.app.routers import overnight_pilot as routes
from backend.app.services.deep_intent_logger import DeepIntentLogger
from backend.app.services.overnight_pilot import OvernightPilotConfig, OvernightPilotManager, PilotSession


def test_events_route_filters_scope_and_bound_limit(tmp_path, monkeypatch):
    logger = DeepIntentLogger(tmp_path / "events.jsonl")
    common = {
        "symbol": "BTCUSDT", "reason_code": "EMA", "reason": "rejected",
        "run_id": "run-a", "session_id": "session-a", "config_fingerprint": "fp-a",
        "strategy": "confluence_ema", "timeframe": "5m", "checks": [], "observed": {},
        "trade_id": None, "payload": {},
    }
    logger.record_event(**common, event_type="DECISION_SKIPPED", source="paper")
    logger.record_event(**{**common, "run_id": "run-b", "symbol": "ETHUSDT"}, event_type="POSITION_OPENED", source="paper")
    logger.record(intent="SKIPPED", symbol="BTCUSDT", session_id="legacy", reason="old record")
    monkeypatch.setattr(routes.overnight_pilot_manager, "intent_logger", logger, raising=False)

    result = routes.get_paper_events(run_id="run-a", symbol="btcUsdt", source="paper", event_type="DECISION_SKIPPED", limit=10)
    assert result["count"] == 1
    assert result["events"][0]["run_id"] == "run-a"
    assert result["filters"]["symbol"] == "BTCUSDT"
    assert routes.get_paper_events(run_id="run-a", source="system")["count"] == 0
    with pytest.raises(HTTPException):
        routes.get_paper_events(limit=0)
    with pytest.raises(HTTPException) as error:
        routes.get_paper_events(limit=501)
    assert error.value.status_code == 422


def test_run_telemetry_source_totals_remain_separate(tmp_path):
    manager = OvernightPilotManager()
    manager.intent_logger = DeepIntentLogger(tmp_path / "events.jsonl")
    config = OvernightPilotConfig(symbol="BTCUSDT", strategy_type="confluence_ema")
    session = PilotSession(config=config, run_id="run-a", config_fingerprint="fp-a", preflight_valid=False)
    session.backtest = {"summary": {}, "trades": []}
    session.forecast = {"data_status": "connected"}
    session.paper_snapshot = {
        "is_running": False, "data_status": "connected", "indicator_data_status": "connected",
        "evaluations": 7, "blocked_evaluations": 5, "filter_rejection_total": 9,
        "data_error_count": 2, "consecutive_data_errors": 0, "last_successful_data_at": 123,
        "indicator_data_age_ms": 1000, "telemetry_status": "healthy", "entry_ready": True,
    }
    manager.sessions["BTCUSDT"] = session
    for source in ("backtest", "forecast", "paper", "paper", "system"):
        manager.intent_logger.record_event(
            event_type="TEST", source=source, symbol="BTCUSDT", reason_code="TEST", reason="test",
            run_id="run-a", session_id=None, config_fingerprint="fp-a", strategy="confluence_ema",
            timeframe="15m", checks=[], observed={}, trade_id=None, payload={},
        )

    status = manager.status()
    row = status["summary"][0]
    assert row["paper_evaluations"] == 7
    assert row["paper_filter_rejection_total"] == 9
    assert row["paper_telemetry_status"] == "healthy"
    assert row["telemetry_events_by_source"] == {"backtest": 1, "forecast": 1, "paper": 2, "system": 1}
    assert status["aggregate"]["telemetry"]["events_by_source"] == {"backtest": 1, "forecast": 1, "paper": 2, "system": 1}


def test_status_route_is_read_only(monkeypatch):
    calls = {"persist": 0}
    monkeypatch.setattr(routes.overnight_pilot_manager, "status", lambda: {"status": "ok"})

    async def persist():
        calls["persist"] += 1

    monkeypatch.setattr(routes.overnight_pilot_manager, "persist", persist)
    status = routes.get_overnight_status()
    with pytest.raises(StopIteration) as result:
        status.send(None)
    assert result.value.value == {"status": "ok"}
    assert calls["persist"] == 0
