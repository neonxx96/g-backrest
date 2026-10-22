import pytest

from backend.app.engine.verdict import (
    INSUFFICIENT_TRADES,
    SMALL_SAMPLE_TRADES,
    VerdictLevel,
    evaluate_verdict,
)


def test_pass_when_all_checks_green():
    verdict = evaluate_verdict(net_pnl_usd=150.0, trades=45, profit_factor=1.6, regime="TREND_IMPULSE")

    assert verdict.level is VerdictLevel.PASS
    assert verdict.allows_live_paper is True
    assert verdict.flags == []


def test_block_on_negative_net_pnl_after_fees():
    verdict = evaluate_verdict(net_pnl_usd=-0.01, trades=45, profit_factor=0.9)

    assert verdict.level is VerdictLevel.BLOCK
    assert verdict.allows_live_paper is False
    assert any("negative" in r for r in verdict.reasons)


def test_block_on_insufficient_sample():
    verdict = evaluate_verdict(net_pnl_usd=100.0, trades=INSUFFICIENT_TRADES - 1, profit_factor=2.0)

    assert verdict.level is VerdictLevel.BLOCK
    assert any("Insufficient sample" in r for r in verdict.reasons)


def test_block_on_toxic_volatility_regime():
    verdict = evaluate_verdict(net_pnl_usd=100.0, trades=50, profit_factor=2.0, regime="TOXIC_VOLATILITY")

    assert verdict.level is VerdictLevel.BLOCK
    assert any("TOXIC_VOLATILITY" in r for r in verdict.reasons)


def test_warning_on_small_sample():
    verdict = evaluate_verdict(net_pnl_usd=100.0, trades=SMALL_SAMPLE_TRADES - 1, profit_factor=2.0)

    assert verdict.level is VerdictLevel.WARNING
    assert verdict.allows_live_paper is True
    assert any("Small sample" in r for r in verdict.reasons)


@pytest.mark.parametrize("pf", [1.0, 1.1, 1.19])
def test_warning_on_marginal_profit_factor(pf):
    verdict = evaluate_verdict(net_pnl_usd=100.0, trades=50, profit_factor=pf)

    assert verdict.level is VerdictLevel.WARNING
    assert any("Marginal profit factor" in r for r in verdict.reasons)


def test_profit_factor_12_is_not_marginal():
    verdict = evaluate_verdict(net_pnl_usd=100.0, trades=50, profit_factor=1.2)

    assert verdict.level is VerdictLevel.PASS


def test_l2_missing_flag_raises_warning_not_block():
    verdict = evaluate_verdict(net_pnl_usd=100.0, trades=50, profit_factor=2.0, requires_l2=True, l2_available=False)

    assert verdict.level is VerdictLevel.WARNING
    assert "L2 History: No data" in verdict.flags
    assert verdict.allows_live_paper is True


def test_l2_flag_absent_when_data_available_or_not_required():
    assert evaluate_verdict(net_pnl_usd=100.0, trades=50, requires_l2=True, l2_available=True).flags == []
    assert evaluate_verdict(net_pnl_usd=100.0, trades=50, requires_l2=False, l2_available=False).flags == []


def test_block_reasons_include_warnings_for_context():
    verdict = evaluate_verdict(net_pnl_usd=-5.0, trades=5, profit_factor=1.1, requires_l2=True, l2_available=False)

    assert verdict.level is VerdictLevel.BLOCK
    assert any("Marginal profit factor" in r for r in verdict.reasons)
    assert "L2 History: No data" in verdict.flags


def test_pilot_status_row_carries_verdict_v2():
    from backend.app.services.overnight_pilot import OvernightPilotConfig, OvernightPilotManager

    manager = OvernightPilotManager()
    manager.set_preflight(
        "BTCUSDT",
        {"summary": {"net_pnl_usd": 120.0, "total_trades": 40, "profit_factor": 1.5}, "trades": []},
        {"market_regime": "FLAT_DENSE"},
    )

    row = next(r for r in manager.status()["summary"] if r["symbol"] == "BTCUSDT")
    verdict = row["verdict"]

    assert verdict["level"] == "WARNING"  # L2 history honestly missing on OHLCV backtest
    assert "L2 History: No data" in verdict["flags"]
    assert verdict["allows_live_paper"] is True


def test_pilot_status_row_blocks_on_negative_pnl():
    from backend.app.services.overnight_pilot import OvernightPilotManager

    manager = OvernightPilotManager()
    manager.set_preflight(
        "ETHUSDT",
        {"summary": {"net_pnl_usd": -50.0, "total_trades": 40, "profit_factor": 0.8}, "trades": []},
        {"market_regime": "FLAT_DENSE"},
    )

    row = next(r for r in manager.status()["summary"] if r["symbol"] == "ETHUSDT")

    assert row["verdict"]["level"] == "BLOCK"
    assert row["verdict"]["allows_live_paper"] is False
