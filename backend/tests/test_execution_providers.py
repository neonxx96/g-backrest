import pytest

from backend.app.services.execution import PaperSandboxProvider
from backend.app.services.paper_trading import PaperTradingSession


def test_paper_provider_preserves_net_pnl_accounting_invariant():
    provider = PaperSandboxProvider(initial_balance=1000, default_leverage=10)
    provider.open_position("BTCUSDT", "LONG", entry_price=100, quantity=1, maker=False, context={"cvd": 12})
    trade = provider.close_position("BTCUSDT", exit_price=110, maker=False)
    assert trade.gross_pnl == pytest.approx(10.0)
    assert trade.net_pnl == pytest.approx(trade.gross_pnl - trade.total_fees)
    assert trade.context_snapshot["cvd"] == 12


def test_paper_provider_applies_funding_to_total_fees_and_releases_margin():
    provider = PaperSandboxProvider(initial_balance=1000, default_leverage=10)
    provider.open_position("BTCUSDT", "SHORT", entry_price=100, quantity=2)
    assert provider.snapshot().used_margin == pytest.approx(20.0)
    provider.apply_funding("BTCUSDT", rate=0.001)
    trade = provider.close_position("BTCUSDT", exit_price=100)
    assert trade.total_fees > 0
    assert provider.snapshot().used_margin == pytest.approx(0.0)


def test_paper_session_fee_configuration_uses_backtest_percentage_convention():
    session = PaperTradingSession()

    session.set_fee_rates_percent(maker_fee_pct=0.02, taker_fee_pct=0.05)

    assert session.maker_fee == pytest.approx(0.0002)
    assert session.taker_fee == pytest.approx(0.0005)
