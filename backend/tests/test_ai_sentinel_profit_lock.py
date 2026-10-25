"""Unit tests for Block 3: AI Copilot & Quant Position Sentinel for Profit Retention."""

from backend.app.services.early_exit_engine import (
    EarlyExitEngine,
    clamp_protective_stop,
)
from backend.app.services.openrouter_client import OpenRouterClient


def _drive_pure_coro(coro):
    """Drive an async coroutine whose awaits are all pure/mocked without creating an OS socket event loop."""
    try:
        coro.send(None)
    except StopIteration as stop:
        return stop.value
    raise RuntimeError("Coroutine yielded an unmocked future")


def test_clamp_protective_stop_never_widens_risk_or_crosses_market():
    """Safety Clamp Invariant: stop-loss can ONLY tighten in the direction of profit
    and can NEVER cross current market price."""
    # LONG position: current SL = 99.0, current price = 102.0
    # Attempt to widen SL to 98.0 -> rejected, stays 99.0
    assert clamp_protective_stop("LONG", 99.0, 98.0, 102.0, tick_size=0.1) == 99.0
    # Attempt to tighten SL to 100.5 -> accepted
    assert clamp_protective_stop("LONG", 99.0, 100.5, 102.0, tick_size=0.1) == 100.5
    # Attempt to set SL above current price (103.0) -> clamped below current price (102.0 - 0.1 = 101.9)
    assert clamp_protective_stop("LONG", 99.0, 103.0, 102.0, tick_size=0.1) == 101.9

    # SHORT position: current SL = 101.0, current price = 98.0
    # Attempt to widen SL to 102.0 -> rejected, stays 101.0
    assert clamp_protective_stop("SHORT", 101.0, 102.0, 98.0, tick_size=0.1) == 101.0
    # Attempt to tighten SL to 99.5 -> accepted
    assert clamp_protective_stop("SHORT", 101.0, 99.5, 98.0, tick_size=0.1) == 99.5
    # Attempt to set SL below current price (97.0) -> clamped above current price (98.0 + 0.1 = 98.1)
    assert clamp_protective_stop("SHORT", 101.0, 97.0, 98.0, tick_size=0.1) == 98.1


def test_tier1_quant_profit_lock_breakeven_and_step_locks():
    """Tier 1 Cold Quant Sentinel moves SL to fee-adjusted breakeven at +0.8R,
    Step-Lock L1 (+0.4R) at +1.2R MFE, and Step-Lock L2 (+0.9R) at +1.8R MFE."""
    engine = EarlyExitEngine()
    # Entry = 100.0, qty = 10.0, risk_amount = 10.0 USDT (1R = $1.0 price move, initial SL = 99.0)
    track = engine.register_position(
        symbol="BTCUSDT",
        side="LONG",
        entry_price=100.0,
        entry_ts=1_000_000,
        qty=10.0,
        risk_amount=10.0,
    )
    cur_sl = 99.0

    # 1. Reach +0.85R (price = 100.85) -> MOVE_SL_BREAKEVEN
    engine.on_price_update("BTCUSDT", 100.85, 1_010_000)
    res_be = engine.evaluate_profit_lock_action(track, cur_sl, taker_fee_pct=0.05, tick_size=0.01)
    assert res_be["action"] == "MOVE_SL_BREAKEVEN"
    assert res_be["new_stop_price"] > 100.0
    cur_sl = res_be["new_stop_price"]

    # 2. Reach +1.30R (price = 101.30) -> STEP_LOCK_SL Level 1 (+0.40R -> SL = 100.40)
    engine.on_price_update("BTCUSDT", 101.30, 1_020_000)
    res_l1 = engine.evaluate_profit_lock_action(track, cur_sl, taker_fee_pct=0.05, tick_size=0.01)
    assert res_l1["action"] == "STEP_LOCK_SL"
    assert abs(res_l1["new_stop_price"] - 100.40) < 1e-6
    assert track.step_lock_level == 1
    cur_sl = res_l1["new_stop_price"]

    # 3. Reach +1.90R (price = 101.90) -> STEP_LOCK_SL Level 2 (+0.90R -> SL = 100.90)
    engine.on_price_update("BTCUSDT", 101.90, 1_030_000)
    res_l2 = engine.evaluate_profit_lock_action(track, cur_sl, taker_fee_pct=0.05, tick_size=0.01)
    assert res_l2["action"] == "STEP_LOCK_SL"
    assert abs(res_l2["new_stop_price"] - 100.90) < 1e-6
    assert track.step_lock_level == 2


def test_tier1_absorption_reversal_locks_partial_50():
    """When position has MFE >= 0.7R and opposing absorption/heavy adverse delta appears,
    Sentinel triggers PARTIAL_CLOSE_50 and locks stop in profit."""
    engine = EarlyExitEngine()
    track = engine.register_position(
        symbol="ETHUSDT",
        side="LONG",
        entry_price=2000.0,
        entry_ts=1_000_000,
        qty=1.0,
        risk_amount=20.0,  # 1R = $20
    )
    # Price hits +0.9R ($2018)
    engine.on_price_update("ETHUSDT", 2018.0, 1_015_000)
    res = engine.evaluate_profit_lock_action(
        track,
        1980.0,
        latest_orderflow_data={"depth_delta_pct": -24.0, "opposing_absorption": True},
    )
    assert res["action"] == "PARTIAL_CLOSE_50"
    assert res["new_stop_price"] > 2000.0
    assert track.partial_profit_taken is True


def test_tier2_openrouter_sentinel_parses_llm_and_enforces_safety_clamp(monkeypatch):
    """OpenRouterClient.evaluate_open_position_sentinel parses LLM response and clamps any invalid SL."""
    client = OpenRouterClient(api_key="test-key")

    async def fake_chat_completion(**kwargs):
        # LLM tries to suggest widening SL to 95.0 on a LONG whose current SL is 99.0!
        return {
            "content": (
                "ACTION: TIGHTEN_SL\n"
                "SUGGESTED_SL: 95.0\n"
                "CONFIDENCE: 0.91\n"
                "REASON: Фиксируем часть профита на замедлении ленты."
            ),
            "model": "deepseek/deepseek-v4.1-flash",
            "latency_ms": 120,
            "cost": 0.0001,
            "fallback": False,
        }

    monkeypatch.setattr(client, "chat_completion", fake_chat_completion)
    res = _drive_pure_coro(
        client.evaluate_open_position_sentinel(
            symbol="SOLUSDT",
            position_info={
                "side": "LONG",
                "entry_price": 100.0,
                "current_price": 102.0,
                "stop_price": 99.0,
                "target_price": 105.0,
                "mfe_r": 1.1,
                "current_pnl_r": 1.0,
                "time_in_trade_sec": 95,
            },
            market_snapshot={"price": 102.0, "depth_delta_pct": -5.0},
        )
    )
    assert res["action"] == "TIGHTEN_SL"
    # Clamped so it never widens below 99.0!
    assert res["suggested_sl"] == 99.0


def test_tier2_openrouter_sentinel_cold_quant_fallback_when_no_api_key(monkeypatch):
    """When OpenRouter is unavailable / has no API key, evaluate_open_position_sentinel
    deterministically falls back to _sentinel_quant_fallback."""
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    client = OpenRouterClient(api_key="")
    client.api_key = ""
    res = _drive_pure_coro(
        client.evaluate_open_position_sentinel(
            symbol="BTCUSDT",
            position_info={
                "side": "LONG",
                "entry_price": 60000.0,
                "current_price": 60900.0,
                "stop_price": 59500.0,
                "initial_stop_price": 59500.0,
                "target_price": 61500.0,
                "mfe_r": 1.4,
                "current_pnl_r": 1.2,
                "time_in_trade_sec": 180,
            },
            market_snapshot={"price": 60900.0, "depth_delta_pct": 4.0},
        )
    )
    assert res["fallback"] is True
    assert res["model"] == "local_quant_sentinel"
    assert res["action"] == "TIGHTEN_SL"
    assert res["suggested_sl"] > 60000.0
