import pytest
from backend.app.services.openrouter_client import openrouter_client
from backend.app.services.live_paper_runner import live_paper_runner
from backend.app.services.paper_trading import paper_trading_session


@pytest.mark.anyio
async def test_openrouter_client_fallback_logic():
    # Setup with good R:R and favorable depth delta -> CONFIRM
    setup = {
        "direction": "LONG",
        "entry_price": 80000.0,
        "stop_loss": 79000.0,
        "take_profit": 83000.0,
        "rr_ratio": 3.0,
        "reason": "Bounce off bid wall $1.2M",
    }
    snapshot = {
        "price": 80000.0,
        "depth_delta_pct": 18.5,
        "strongest_magnet": "SHORTS_ABOVE",
        "funding_rate": 0.0001,
        "atr": 300.0,
    }
    eval_res = await openrouter_client.evaluate_trade_risk("BTCUSDT", setup, snapshot)
    assert eval_res["veto"] is False
    assert eval_res["verdict"] == "CONFIRM"
    assert "Квант-фильтр" in eval_res["reason"]

    # Setup with poor R:R (< 1.5) -> VETO
    bad_rr_setup = {
        "direction": "LONG",
        "entry_price": 80000.0,
        "stop_loss": 79500.0,
        "take_profit": 80300.0,
        "rr_ratio": 0.6,
        "reason": "Scalp",
    }
    eval_bad_rr = await openrouter_client.evaluate_trade_risk("BTCUSDT", bad_rr_setup, snapshot)
    assert eval_bad_rr["veto"] is True
    assert eval_bad_rr["verdict"] == "VETO"

    # Setup with adverse depth delta opposing direction -> VETO
    adverse_delta_snapshot = {
        "price": 80000.0,
        "depth_delta_pct": -35.0,  # heavy ask pressure against long
        "strongest_magnet": "LONGS_BELOW",
        "funding_rate": 0.0001,
        "atr": 300.0,
    }
    eval_adverse = await openrouter_client.evaluate_trade_risk("BTCUSDT", setup, adverse_delta_snapshot)
    assert eval_adverse["veto"] is True
    assert eval_adverse["verdict"] == "VETO"


def test_live_paper_runner_start_stop_lifecycle():
    config = {
        "symbol": "BTCUSDT",
        "strategy_type": "live_density_bounce",
        "initial_capital": 10000.0,
        "risk_per_trade_pct": 1.0,
        "min_density_usd": 500000.0,
        "ai_control": True,
        "stop_loss_pct": 0.8,
        "take_profit_pct": 1.6,
        "leverage": 2.0,
    }

    start_res = live_paper_runner.start(config)
    assert start_res["is_running"] is True
    assert start_res["symbol"] == "BTCUSDT"
    assert start_res["initial_capital"] == 10000.0
    assert start_res["ai_control"] is True
    assert len(start_res["equity_curve"]) >= 1

    status = live_paper_runner.get_status()
    assert status["is_running"] is True
    assert status["current_equity"] >= 0

    stop_res = live_paper_runner.stop()
    assert stop_res["is_running"] is False
