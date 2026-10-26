"""P0 (night test 23-24.10): моментум/кросс-стратегии входят по рынку.

Баг: ema_trend выставлял BUY LIMIT по цене сигнала; при росте рынка лимит
не исполнялся часами (сигнал сгорал), тогда как SELL LIMIT исполнялся
мгновенно — асимметрия теряла лонг-сигналы. Wall-bounce стратегии
намеренно ждут у стенки и остаются лимитными.
"""
from types import SimpleNamespace

from pytest import approx

from backend.app.services.execution_simulator import OrderStatus, simulate_order
from backend.app.services.live_paper_runner import MARKET_ENTRY_STRATEGIES


def _ev(ts, kind, payload):
    return SimpleNamespace(timestamp=ts, kind=kind, payload=payload)


def test_momentum_strategies_use_market_entry():
    for strategy in ("ema_trend", "confluence_ema", "cvd_absorption", "diagnostics_lenient", "naked_test"):
        assert strategy in MARKET_ENTRY_STRATEGIES, f"{strategy} должен входить по рынку"


def test_wall_bounce_strategies_stay_limit():
    for strategy in ("live_density_bounce", "spot_wall_bounce", "cluster_volume_bounce"):
        assert strategy not in MARKET_ENTRY_STRATEGIES, f"{strategy} должен остаться лимитным"


def test_market_entry_fills_instantly_on_next_mark():
    events = iter([
        _ev(200, "depth", {"bids": [(99.0, 10.0)], "asks": [(101.0, 10.0)]}),
        _ev(200, "mark", {"price": 100.5}),
    ])
    res = simulate_order(events, signal_ts=0, side="BUY", order_type="MARKET", price=100.0, quantity=1.0)
    assert res.order_state.status == OrderStatus.FILLED
    assert res.order_state.filled_qty == approx(1.0)


def test_limit_entry_above_running_market_stays_pending():
    """Механика P0-бага: BUY LIMIT ниже бегущей цены не исполняется (maker)."""
    events = iter([
        _ev(200, "depth", {"bids": [(99.0, 10.0)], "asks": [(101.0, 10.0)]}),
        _ev(200, "mark", {"price": 100.5}),
        _ev(300, "mark", {"price": 100.6}),
    ])
    res = simulate_order(events, signal_ts=0, side="BUY", order_type="LIMIT", price=100.0, quantity=1.0)
    assert res.order_state.filled_qty == 0.0
    assert res.order_state.status in (OrderStatus.ACTIVE, OrderStatus.PENDING)
