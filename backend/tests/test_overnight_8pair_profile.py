"""Safety contract for the reproducible eight-pair diagnostic launcher."""

import importlib.util
from pathlib import Path


def _load_launcher_module():
    launcher_path = Path(__file__).resolve().parents[2] / "scripts" / "launch_overnight_8pairs.py"
    spec = importlib.util.spec_from_file_location("launch_overnight_8pairs", launcher_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_eight_pair_launcher_uses_safe_shared_account_diagnostic_profile():
    """A launcher regression must not silently re-enable paid AI or unsafe run defaults."""
    launcher = _load_launcher_module()

    configs = launcher.TOP_8_PAIRS_CONFIG
    assert {item["symbol"] for item in configs} == {
        "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
        "XRPUSDT", "DOGEUSDT", "SUIUSDT", "NEARUSDT",
    }
    assert all(item["initial_capital"] == 1000.0 for item in configs)
    assert all(item["risk_per_trade_pct"] == 0.5 for item in configs)
    assert all(item["risk_contract_version"] == 1 for item in configs)
    assert all(item["risk_units"] == "percent" for item in configs)
    assert all(item["max_portfolio_heat_pct"] == 1.25 for item in configs)
    assert all(item["max_directional_heat_pct"] == 0.75 for item in configs)
    assert all(item["max_positions"] == 4 for item in configs)
    assert all(item["duration_hours"] == 8.0 for item in configs)
    assert all(item["leverage"] <= 5.0 for item in configs)
    assert all(item["ai_control"] is False for item in configs)


def test_eight_pair_launcher_starts_with_the_preflight_id(monkeypatch):
    """A successful preflight must be the one consumed by start, not recomputed."""
    launcher = _load_launcher_module()
    requests = []

    def fake_post_json(url, data, timeout=120):
        requests.append((url, data, timeout))
        if url.endswith("/preflight"):
            return {"preflight_id": "validated-run", "valid_sessions": 8, "total_sessions": 8}
        return {"message": "started"}

    monkeypatch.setattr(launcher, "post_json", fake_post_json)
    monkeypatch.setattr(launcher, "get_json", lambda *args, **kwargs: {"sessions": [], "aggregate": {"paper": {"balance": 1000.0}}})
    monkeypatch.setattr(launcher.time, "sleep", lambda *_: None)

    launcher.main()

    start_url, start_body, _ = requests[-1]
    assert start_url.endswith("/start?preflight_id=validated-run")
    assert start_body == {"configs": launcher.TOP_8_PAIRS_CONFIG}


def test_eight_pair_launcher_refuses_to_stop_an_active_paper_run(monkeypatch):
    """A new diagnostic run must never terminate an existing one implicitly."""
    launcher = _load_launcher_module()
    requests = []

    monkeypatch.setattr(launcher, "post_json", lambda *args, **kwargs: requests.append(args))
    monkeypatch.setattr(launcher, "get_json", lambda *args, **kwargs: {"sessions": [{"symbol": "BTCUSDT", "running": True}]})

    launcher.main()

    assert requests == []
