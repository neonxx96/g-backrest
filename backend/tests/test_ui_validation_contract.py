import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from backend.app.routers.backtest import (
    run_backtest,
    optimize_backtest,
    BacktestRequest,
    BacktestParams,
    OptimizeRequest,
)


@pytest.mark.anyio
async def test_reject_live_density_bounce_in_run():
    req = BacktestRequest(
        symbol="BTCUSDT",
        timeframe="5m",
        days=7,
        strategy_type="live_density_bounce",
        params=BacktestParams()
    )
    with pytest.raises(HTTPException) as exc_info:
        await run_backtest(req)
    assert exc_info.value.status_code == 400
    assert "исключительно в реальном времени" in exc_info.value.detail or "Исторический бэктест недоступен" in exc_info.value.detail


@pytest.mark.anyio
async def test_reject_live_wall_breakout_in_optimize():
    req = OptimizeRequest(
        symbol="BTCUSDT",
        timeframe="5m",
        days=7,
        strategy_type="live_wall_breakout"
    )
    with pytest.raises(HTTPException) as exc_info:
        await optimize_backtest(req)
    assert exc_info.value.status_code == 400
    assert "Оптимизация на истории недоступна" in exc_info.value.detail


@pytest.mark.parametrize("invalid_field,invalid_val,expected_loc", [
    ("stop_loss_pct", -1.0, "stop_loss_pct"),
    ("stop_loss_pct", 0.0, "stop_loss_pct"),
    ("stop_loss_pct", 60.0, "stop_loss_pct"),
    ("take_profit_pct", -0.5, "take_profit_pct"),
    ("take_profit_pct", 0.0, "take_profit_pct"),
    ("take_profit_pct", 250.0, "take_profit_pct"),
    ("leverage", 0.0, "leverage"),
    ("leverage", 150.0, "leverage"),
])
def test_pydantic_parameter_bounds_validation(invalid_field, invalid_val, expected_loc):
    params_kwargs = {
        "stop_loss_pct": 0.8,
        "take_profit_pct": 1.5,
        "min_density_usd": 100000.0,
        "volume_multiplier": 1.0,
        "leverage": 1.0
    }
    params_kwargs[invalid_field] = invalid_val

    with pytest.raises(ValidationError) as exc_info:
        BacktestParams(**params_kwargs)
    errors = exc_info.value.errors()
    assert any(expected_loc in e.get("loc", ()) for e in errors)


@pytest.mark.parametrize("invalid_days", [0, -5, 31, 100])
def test_pydantic_days_bounds_validation(invalid_days):
    with pytest.raises(ValidationError) as exc_info:
        BacktestRequest(
            symbol="BTCUSDT",
            timeframe="5m",
            days=invalid_days,
            strategy_type="confluence_ema"
        )
    errors = exc_info.value.errors()
    assert any("days" in e.get("loc", ()) for e in errors)

