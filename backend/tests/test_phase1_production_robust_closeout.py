"""ROADMAP Фаза 1.1–1.2 (closeout 2026-10-24): production_robust + Night Pilot CLI.

Подтверждает кодом:
1. Параметры пресета production_robust (включая paper/consultative-only).
2. RSI-полоса 42–58 для confluence_ema сквозь цепочку:
   BacktestParams (preflight) → forecast (strategy_params) → движок бэктеста → LivePaperRunner.
3. CLI-контракт scripts/night-pilot.ps1 (порт 8000, preflight-гейт, sentinel,
   morning-таблица без подмены отсутствующих данных нулями).

Дублирования нет: параметры геометрии покрыты в test_overnight_pilot.py,
live-полоса 42–58 — в test_production_robust_live_runner_enforces_neutral_rsi_band_42_58.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pandas as pd

import backend.app.services.overnight_pilot as overnight_module
from backend.app.services.overnight_pilot import OvernightPilotConfig, OvernightPilotManager
from backend.app.services.orderflow_backtester import OrderFlowBacktester

REPO_ROOT = Path(__file__).resolve().parents[2]
NIGHT_PILOT_PS1 = REPO_ROOT / "scripts" / "night-pilot.ps1"


# ---------------------------------------------------------------------------
# 1. Пресет production_robust: параметры + paper/consultative-only
# ---------------------------------------------------------------------------

def test_production_robust_is_paper_consultative_only():
    """Пресет не включает ни авто-торговлю AI, ни каких-либо real-order контрактов:
    OvernightPilotConfig по построению paper-only (LivePaperRunner + PaperTradingSession),
    поэтому достаточно зафиксировать ai_control=False и исторические стратегии."""
    configs = OvernightPilotManager.production_robust_configs()

    assert len(configs) == 3
    assert [c.symbol for c in configs] == ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
    assert all(c.ai_control is False for c in configs)
    assert all(c.strategy_type in overnight_module.HISTORICAL_STRATEGIES for c in configs)
    # RSI-фильтр включён во всех трёх конфигах — полоса 42–58 применяется движком.
    assert all(c.use_rsi_filter is True for c in configs)


# ---------------------------------------------------------------------------
# 2. RSI 42–58: движок бэктеста (ось BacktestParams) и цепочка preflight/forecast
# ---------------------------------------------------------------------------

def _confluence_frame() -> pd.DataFrame:
    """Синтетический 15m-фрейм, проходящий целостность OHLCV (по образцу test_ema_trend_live)."""
    rows = []
    for i in range(60):
        close = 100.0 + i * 0.1
        rows.append({
            "timestamp": 1_790_000_000_000 + i * 900_000,
            "open": close - 0.05, "high": close + 0.1, "low": close - 0.1,
            "close": close, "volume": 1000.0, "delta": 1.0,
        })
    df = pd.DataFrame(rows)
    return OrderFlowBacktester(initial_capital=1000).calculate_indicators(df)


def _with_last_rsi(frame: pd.DataFrame, rsi: float) -> pd.DataFrame:
    frame = frame.copy()
    frame.iloc[len(frame) - 1, frame.columns.get_loc("rsi")] = rsi
    return frame


def test_backtest_engine_rejects_confluence_rsi_outside_42_58():
    bt = OrderFlowBacktester(initial_capital=1000)
    diag = bt.explain_latest_signal(
        _with_last_rsi(_confluence_frame(), 70.0),
        strategy_type="confluence_ema",
        use_rsi_filter=True,
    )
    assert "rsi_filter" in diag["failed_checks"]
    rejection = next(r for r in diag["rejections"] if r["filter"] == "rsi_filter")
    assert rejection["operator"] == "within"
    assert rejection["threshold"] == [42.0, 58.0]


def test_backtest_engine_accepts_confluence_rsi_inside_42_58():
    bt = OrderFlowBacktester(initial_capital=1000)
    diag = bt.explain_latest_signal(
        _with_last_rsi(_confluence_frame(), 50.0),
        strategy_type="confluence_ema",
        use_rsi_filter=True,
    )
    # Полоса пройдена; другие проверки стратегии (кросс/объём) могут отклонять — это ок.
    assert "rsi_filter" not in diag["failed_checks"]
    assert diag["observed"]["rsi"] == 50.0


def test_rsi_flag_flows_from_preset_into_preflight_and_forecast(monkeypatch):
    """Preflight маппит production_robust в BacktestParams и strategy_params forecast
    с явным use_rsi_filter=True — та же полоса 42–58, что в движке и live-раннере."""
    captured_backtests: list = []
    captured_forecasts: list = []

    async def fake_run_backtest(req):
        captured_backtests.append(req)
        return {
            "meta": {"candles": 2880, "symbol": req.symbol, "timeframe": req.timeframe},
            "data_engine": {},
            "summary": {},
        }

    async def fake_optimize_backtest(req):  # pragma: no cover - контракт не меняется
        return {"meta": {}, "before_optimization": {}, "after_optimization": {}, "oos": {}}

    async def fake_forecast(symbol, timeframe, **kwargs):
        captured_forecasts.append({"symbol": symbol, **kwargs})
        return {"data_status": "connected", "base_scenario": {"direction": "NO_TRADE"}}

    monkeypatch.setattr(overnight_module, "run_backtest", fake_run_backtest)
    monkeypatch.setattr(overnight_module, "optimize_backtest", fake_optimize_backtest)
    monkeypatch.setattr(overnight_module, "compute_probabilistic_forecast", fake_forecast)
    monkeypatch.setattr(OvernightPilotManager, "_record_run_event", lambda *a, **k: None)

    configs = OvernightPilotManager.production_robust_configs()
    manager = OvernightPilotManager()
    asyncio.run(manager._prepare(configs))

    assert len(captured_backtests) == 3 and len(captured_forecasts) == 3
    for req in captured_backtests:
        params = req.params
        assert params.use_rsi_filter is True
        assert req.strategy_type == "confluence_ema"
        # Ключевые параметры пресета доезжают до BacktestParams без искажений.
        assert params.volume_multiplier == 1.25
        assert params.stop_loss_pct == 0.8
        assert params.take_profit_pct == 2.2
        assert params.min_density_usd == 150000.0
    for call in captured_forecasts:
        sp = call["strategy_params"]
        assert sp["use_rsi_filter"] is True
        assert sp["strategy_type"] == "confluence_ema"
        assert sp["volume_multiplier"] == 1.25
        assert call["strategy_type"] == "confluence_ema"


# ---------------------------------------------------------------------------
# 3. CLI-контракт scripts/night-pilot.ps1 (Night Pilot CLI)
# ---------------------------------------------------------------------------

def _ps1() -> str:
    return NIGHT_PILOT_PS1.read_text(encoding="utf-8")


def test_night_pilot_cli_contract():
    text = _ps1()
    # Порт по умолчанию 8000 и ApiBase деривируется от него.
    assert "[int]$Port = 8000" in text
    assert 'http://127.0.0.1:$Port' in text
    # Действия preflight/start/report/stop/status и маппинг пресета на эндпоинты.
    for action in ("'preflight'", "'start'", "'report'", "'status'", "'stop'"):
        assert action in text
    assert "Replace('_', '-')" in text  # production_robust → production-robust/*
    # Обязательный успешный preflight перед start.
    assert "No current successful preflight is available" in text
    # Warning Sentinel: блокировки входов и fee drag.
    assert "HIGH NO_ENTRY COUNT" in text
    assert "FEE DRAG DETECTED" in text
    # Morning-таблица: отсутствующие WinRate/NetPnL/TotalFees показываются как '—',
    # а не подменяются нулями (truth-first).
    assert "if ($null -eq $_.paper_win_rate_pct) { '—' }" in text
    assert "if ($null -eq $_.paper_pnl) { '—' }" in text
    assert "if ($null -eq $_.paper_total_fees) { '—' }" in text
