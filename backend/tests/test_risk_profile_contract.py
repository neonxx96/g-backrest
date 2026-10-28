import pytest

from backend.app.services.risk_engine import calc_position_by_risk, can_open_position
from backend.app.services.risk_profile import SharedRiskProfile
from backend.app.services.overnight_pilot import OvernightPilotConfig, OvernightPilotManager, PilotSession
from backend.app.services.position_sizer import PositionSizer


def test_percent_api_contract_normalizes_half_percent_to_five_dollar_budget():
    profile = SharedRiskProfile.from_api_config({"risk_per_trade_pct": 0.5})

    assert profile.risk_per_trade_fraction == pytest.approx(0.005)
    assert 1000.0 * profile.risk_per_trade_fraction == pytest.approx(5.0)

    sized = calc_position_by_risk(
        equity=1000.0, risk_pct=profile.risk_per_trade_fraction,
        entry=100.0, stop=98.0, side="LONG", step_size=0.01,
        min_notional=5.0, max_leverage=5.0, taker_fee_pct=0.05, slippage_bps=2.0,
    )
    assert sized is not None
    assert sized["risk_usd"] <= 5.0
    assert sized["structural_risk_usd"] < sized["risk_usd"]

    m4_budget, multiplier = PositionSizer().adjusted_risk_budget_fraction(
        1000.0, profile.risk_per_trade_fraction, confluence_score=1.0
    )
    assert multiplier == pytest.approx(1.0)
    assert m4_budget == pytest.approx(5.0)


def test_default_heat_limits_and_small_percent_risk_use_explicit_units():
    profile = SharedRiskProfile.from_api_config({"risk_per_trade_pct": 0.15})

    assert profile.risk_per_trade_fraction == pytest.approx(0.0015)
    assert 1_000.0 * profile.max_portfolio_heat_fraction == pytest.approx(12.50)
    assert 1_000.0 * profile.max_directional_heat_fraction == pytest.approx(7.50)


def test_profile_rejects_ambiguous_fraction_units_and_enforces_pending_heat():
    with pytest.raises(ValueError, match="risk_units"):
        SharedRiskProfile.from_api_config({"risk_per_trade_pct": 0.5, "risk_units": "fraction"})

    profile = SharedRiskProfile.from_api_config({"risk_per_trade_pct": 0.5})
    allowed, reason = can_open_position(
        new_risk_usd=5.0, new_side="LONG", open_positions=[], equity=1000.0,
        pending_orders=[{"role": "ENTRY", "status": "PENDING", "side": "BUY", "reserved_risk": 4.0}],
        max_positions=profile.max_positions,
        max_portfolio_heat_pct=profile.max_portfolio_heat_fraction,
        max_directional_heat_pct=profile.max_directional_heat_fraction,
    )
    assert not allowed
    assert reason.startswith("DIRECTIONAL_HEAT_EXCEEDED")


def test_directional_residual_budget_refuses_second_full_long_without_hidden_resize():
    """A 0.5% first LONG leaves only $2.50 under the $7.50 directional ceiling.

    The current policy is explicit refusal, not an implicit second-size rewrite.
    A caller wanting a smaller order must re-run sizing with an explicit budget.
    """
    profile = SharedRiskProfile.from_api_config({"risk_per_trade_pct": 0.5})
    first_allowed, _ = can_open_position(
        new_risk_usd=5.0, new_side="LONG", open_positions=[], equity=1000.0,
        max_positions=profile.max_positions,
        max_portfolio_heat_pct=profile.max_portfolio_heat_fraction,
        max_directional_heat_pct=profile.max_directional_heat_fraction,
    )
    assert first_allowed

    second_allowed, reason = can_open_position(
        new_risk_usd=5.0, new_side="LONG",
        open_positions=[{"symbol": "BTCUSDT", "side": "LONG", "risk_usd": 5.0}],
        equity=1000.0,
        max_positions=profile.max_positions,
        max_portfolio_heat_pct=profile.max_portfolio_heat_fraction,
        max_directional_heat_pct=profile.max_directional_heat_fraction,
    )
    assert not second_allowed
    assert reason.startswith("DIRECTIONAL_HEAT_EXCEEDED")


def test_pilot_snapshot_records_effective_fractional_risk_contract():
    snapshot = PilotSession(
        OvernightPilotConfig(symbol="BTCUSDT", strategy_type="ema_trend", risk_per_trade_pct=0.5)
    ).to_dict()["effective_risk_config"]

    assert snapshot["risk_contract_version"] == 1
    assert snapshot["risk_units"] == "percent"
    assert snapshot["risk_per_trade_fraction"] == pytest.approx(0.005)
    assert snapshot["max_portfolio_heat_fraction"] == pytest.approx(0.0125)
    assert snapshot["max_directional_heat_fraction"] == pytest.approx(0.0075)


def test_shared_account_rejects_conflicting_portfolio_limits_but_allows_pair_risk():
    manager = OvernightPilotManager()
    btc = OvernightPilotConfig(symbol="BTCUSDT", strategy_type="ema_trend", risk_per_trade_pct=0.5)
    eth = OvernightPilotConfig(symbol="ETHUSDT", strategy_type="ema_trend", risk_per_trade_pct=0.25)
    assert manager._validate_configs([btc, eth]) == [btc, eth]

    with pytest.raises(ValueError, match="same shared risk limits"):
        manager._validate_configs([btc, eth.model_copy(update={"max_portfolio_heat_pct": 2.0})])
