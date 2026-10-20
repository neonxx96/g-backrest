from backend.app.services.think_optimizer import analyze_post_mortem
from backend.app.routers.quant_router import ThinkOptimizeRequest, build_think_optimize_request


def test_post_mortem_suggests_wider_stop_when_stopouts_dominate():
    result = analyze_post_mortem({
        "symbol": "BTCUSDT",
        "current": {"stop_loss_pct": 0.4, "take_profit_pct": 1.2, "leverage": 5},
        "trades": [
            {"pnl_usd": -4, "exit_reason": "Stop Loss"},
            {"pnl_usd": -3, "exit_reason": "Stop Loss"},
            {"pnl_usd": 5, "exit_reason": "Take Profit"},
        ],
    })
    assert result["mode"] == "post_mortem"
    assert result["patch"]["stop_loss_pct"] == 0.65
    assert result["evidence"]["stop_loss_exits"] == 2


def test_think_optimize_forwards_current_strategy_settings_to_existing_optimizer():
    request = build_think_optimize_request(ThinkOptimizeRequest(
        symbol="ETHUSDT",
        timeframe="15m",
        days=14,
        strategy_type="cvd_absorption",
        current={
            "stop_loss_pct": 0.7,
            "take_profit_pct": 1.9,
            "min_density_usd": 850000,
            "leverage": 3,
            "use_cvd_filter": True,
            "unknown_secret": "ignored",
        },
    ))

    assert request.symbol == "ETHUSDT"
    assert request.timeframe == "15m"
    assert request.days == 14
    assert request.strategy_type == "cvd_absorption"
    assert request.current_sl_pct == 0.7
    assert request.current_tp_pct == 1.9
    assert request.current_wall_usd == 850000
    assert request.leverage == 3
    assert request.use_cvd_filter is True
    assert not hasattr(request, "unknown_secret")
