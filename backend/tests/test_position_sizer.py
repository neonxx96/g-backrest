"""Tests for Position Sizer (SRS M4.2a, roadmap phase 5.1):
Fixed Fractional, Budgeted DCA ladder (total risk <= budget), Max Portfolio Heat."""

import pytest

from backend.app.services.position_sizer import PositionSizer


@pytest.fixture
def sizer():
    return PositionSizer(max_portfolio_heat_pct=6.0)


# --- Fixed Fractional ---------------------------------------------------------

def test_fixed_fractional_known_numbers(sizer):
    # equity 10_000, риск 1% = $100; |100 - 99| = 1 -> qty = 100
    qty = sizer.fixed_fractional(equity=10_000.0, entry_price=100.0, stop_price=99.0, risk_pct=1.0)
    assert qty == pytest.approx(100.0)


def test_fixed_fractional_scales_with_risk_pct(sizer):
    q1 = sizer.fixed_fractional(10_000.0, 100.0, 99.5, risk_pct=1.0)
    q2 = sizer.fixed_fractional(10_000.0, 100.0, 99.5, risk_pct=0.5)
    assert q1 == pytest.approx(2.0 * q2)


def test_fixed_fractional_rejects_bad_input(sizer):
    with pytest.raises(ValueError):
        sizer.fixed_fractional(0.0, 100.0, 99.0)
    with pytest.raises(ValueError):
        sizer.fixed_fractional(10_000.0, 100.0, 100.0)  # стоп == вход
    with pytest.raises(ValueError):
        sizer.fixed_fractional(10_000.0, 100.0, 99.0, risk_pct=0.0)


# --- Budgeted DCA ladder -------------------------------------------------------

def test_dca_total_risk_never_exceeds_budget(sizer):
    plan = sizer.budgeted_dca_ladder(
        symbol="BTCUSDT", side="LONG", equity=10_000.0,
        entry_price=100.0, stop_price=97.0,
        leg_offsets_pct=[0.0, 0.5, 1.0, 1.5],
    )
    # Бюджет = 1% × 10k = $100 — суммарный риск лестницы строго внутри бюджета
    assert plan.budget_usd == pytest.approx(100.0)
    assert plan.total_risk_usd == pytest.approx(100.0)
    assert len(plan.legs) == 4
    # Цены ног убывают для LONG, weighted entry между входом и последней ногой
    prices = [leg.price for leg in plan.legs]
    assert prices == sorted(prices, reverse=True)
    assert prices[-1] < plan.weighted_entry < 100.0
    # Каждая нога несёт равную долю риска ($25)
    assert all(leg.risk_usd == pytest.approx(25.0) for leg in plan.legs)


def test_dca_custom_risk_shares(sizer):
    plan = sizer.budgeted_dca_ladder(
        symbol="ETHUSDT", side="LONG", equity=10_000.0,
        entry_price=100.0, stop_price=98.0,
        leg_offsets_pct=[0.0, 1.0],
        leg_risk_shares=[0.75, 0.25],
    )
    assert plan.legs[0].risk_usd == pytest.approx(75.0)
    assert plan.legs[1].risk_usd == pytest.approx(25.0)
    assert plan.total_risk_usd == pytest.approx(100.0)


def test_dca_short_symmetry(sizer):
    long_plan = sizer.budgeted_dca_ladder(
        symbol="BTCUSDT", side="LONG", equity=10_000.0,
        entry_price=100.0, stop_price=98.0, leg_offsets_pct=[0.0, 1.0],
    )
    short_plan = sizer.budgeted_dca_ladder(
        symbol="BTCUSDT", side="SHORT", equity=10_000.0,
        entry_price=100.0, stop_price=102.0, leg_offsets_pct=[0.0, 1.0],
    )
    assert short_plan.total_risk_usd == pytest.approx(long_plan.total_risk_usd)
    assert short_plan.total_quantity == pytest.approx(long_plan.total_quantity, rel=1e-6)
    # Для SHORT ноги растут вверх, weighted entry выше входа
    assert short_plan.weighted_entry > 100.0


def test_dca_rejects_leg_beyond_stop(sizer):
    with pytest.raises(ValueError, match="beyond the stop"):
        sizer.budgeted_dca_ladder(
            symbol="BTCUSDT", side="LONG", equity=10_000.0,
            entry_price=100.0, stop_price=97.0,
            leg_offsets_pct=[0.0, 3.5],  # 100*(1-0.035)=96.5 < 97 — нога за стопом
        )


def test_dca_validation(sizer):
    with pytest.raises(ValueError):
        sizer.budgeted_dca_ladder("X", "LONG", 10_000.0, 100.0, 101.0, [0.0])  # стоп выше входа у LONG
    with pytest.raises(ValueError):
        sizer.budgeted_dca_ladder("X", "SHORT", 10_000.0, 100.0, 99.0, [0.0])  # стоп ниже входа у SHORT
    with pytest.raises(ValueError):
        sizer.budgeted_dca_ladder("X", "LONG", 10_000.0, 100.0, 99.0, [1.0, 0.5])  # offsets не растут
    with pytest.raises(ValueError):
        sizer.budgeted_dca_ladder("X", "LONG", 10_000.0, 100.0, 99.0, [0.0, 1.0], leg_risk_shares=[0.5, 0.6])
    with pytest.raises(ValueError):
        sizer.budgeted_dca_ladder("X", "LONG", 10_000.0, 100.0, 99.0, [])


# --- Max Portfolio Heat ---------------------------------------------------------

def test_portfolio_heat_sums_open_risks(sizer):
    assert sizer.portfolio_heat([100.0, 50.0, 150.0], equity=10_000.0) == pytest.approx(3.0)
    assert sizer.portfolio_heat([], equity=10_000.0) == 0.0


def test_check_heat_blocks_above_limit(sizer):
    # Открыто $500 риска (5%), новый $150 (1.5%) -> 6.5% > 6% — блок
    allowed, heat_after = sizer.check_heat([500.0], equity=10_000.0, new_risk_usd=150.0)
    assert allowed is False
    assert heat_after == pytest.approx(6.5)

    allowed, heat_after = sizer.check_heat([500.0], equity=10_000.0, new_risk_usd=99.0)
    assert allowed is True
    assert heat_after == pytest.approx(5.99)


def test_check_heat_custom_limit_and_validation(sizer):
    allowed, _ = sizer.check_heat([100.0], 10_000.0, 50.0, max_heat_pct=2.0)
    assert allowed is True
    with pytest.raises(ValueError):
        sizer.check_heat([], 10_000.0, -1.0)
    with pytest.raises(ValueError):
        PositionSizer(max_portfolio_heat_pct=0.0)


def test_risk_router_registered():
    from backend.app.routers.risk import router

    paths = {r.path for r in router.routes}
    assert paths == {"/api/risk/position-size", "/api/risk/dca-ladder", "/api/risk/heat-check"}


# --- Signal Quality Multiplier (SRS M4.2b) --------------------------------------

def test_quality_multiplier_srs_band(sizer):
    # Ниже порога 0.65 -> 0.5x; на пороге -> 1.0x; при 1.0 -> 1.2x
    assert sizer.quality_multiplier(0.3) == 0.5
    assert sizer.quality_multiplier(0.6499) == 0.5
    assert sizer.quality_multiplier(0.65) == pytest.approx(1.0)
    assert sizer.quality_multiplier(1.0) == pytest.approx(1.2)
    # Линейность между порогом и 1.0: середина полосы -> 1.1
    assert sizer.quality_multiplier(0.825) == pytest.approx(1.1)


def test_quality_multiplier_validation(sizer):
    with pytest.raises(ValueError):
        sizer.quality_multiplier(-0.1)
    with pytest.raises(ValueError):
        sizer.quality_multiplier(1.01)
    with pytest.raises(ValueError):
        sizer.quality_multiplier(0.8, threshold=0.0)


def test_adjusted_risk_budget_with_and_without_score(sizer):
    # Без скора — чистый Fixed Fractional, множитель 1.0
    budget, mult = sizer.adjusted_risk_budget(10_000.0, 1.0, confluence_score=None)
    assert budget == pytest.approx(100.0) and mult == 1.0

    # Сильный сигнал 1.0 -> 1.2x бюджета
    budget, mult = sizer.adjusted_risk_budget(10_000.0, 1.0, confluence_score=1.0)
    assert budget == pytest.approx(120.0) and mult == pytest.approx(1.2)

    # Слабый сигнал ниже порога -> 0.5x
    budget, mult = sizer.adjusted_risk_budget(10_000.0, 1.0, confluence_score=0.4)
    assert budget == pytest.approx(50.0) and mult == 0.5
