from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_terminal_liquidity_overlays_use_a_valid_live_price_only():
    dockview = (ROOT / "frontend" / "src" / "components" / "docking" / "TerminalDockview.jsx").read_text(encoding="utf-8")
    alerts = (ROOT / "frontend" / "src" / "components" / "docking" / "AlertsModal.jsx").read_text(encoding="utf-8")
    app = (ROOT / "frontend" / "src" / "App.jsx").read_text(encoding="utf-8")

    assert "getUsableMarketPrice(unifiedData?.snapshot?.price)" in dockview
    assert "|| 82000" not in dockview
    assert "currentPrice = null" in alerts
    assert "'81300'" not in alerts
    assert "getUsableMarketPrice(unifiedData?.snapshot?.price)" in app


def test_strategy_levels_are_not_invented_when_backtest_has_no_signals():
    helper = (ROOT / "frontend" / "src" / "services" / "backtestStrategyLevels.js").read_text(encoding="utf-8")
    app = (ROOT / "frontend" / "src" / "App.jsx").read_text(encoding="utf-8")

    assert "const signals = Array.isArray(backtestResult?.signals) ? backtestResult.signals : []" in helper
    assert "deriveBacktestStrategyLevels(btResult)" in app
    assert "baseP = symbol.includes('BTC')" not in app
