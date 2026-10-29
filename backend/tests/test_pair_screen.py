"""Скрининг пары по каталогу стратегий: read-only лаборатория перед paper-запуском."""
import asyncio

import pytest

from backend.app.services import overnight_pilot as overnight_module
from backend.app.services.overnight_pilot import OvernightPilotConfig, OvernightPilotManager
from backend.app.services.strategy_catalog import HISTORICAL_STRATEGY_IDS, get_strategy_descriptor


class QuietLogger:
    def count_by_source(self, *_):
        return {}


def _fake_prepare_factory(pnl_by_strategy: dict):
    async def fake_prepare(self, selected):
        for config in selected:
            fingerprint = self._config_fingerprint(config)
            self.sessions[config.symbol] = overnight_module.PilotSession(
                config, run_id="screen-1", config_fingerprint=fingerprint, preflight_valid=True,
                backtest={
                    "summary": {
                        "net_pnl_usd": float(pnl_by_strategy.get(config.strategy_type, -1.0)),
                        "total_trades": 12,
                        "win_rate": 55.0,
                        "profit_factor": 1.4,
                        "max_drawdown_usd": -3.5,
                    },
                    "meta": {"candles": 300, "symbol": config.symbol, "timeframe": config.timeframe},
                },
                forecast={"data_status": "connected", "market_regime": "TRENDING"},
            )
    return fake_prepare


def test_screen_covers_whole_catalog(monkeypatch):
    async def scenario():
        monkeypatch.setattr(OvernightPilotManager, "_prepare", _fake_prepare_factory({}))
        manager = OvernightPilotManager()
        manager.intent_logger = QuietLogger()
        result = await manager.screen_pair("BTCUSDT", days=14)
        assert result["symbol"] == "BTCUSDT"
        expected = sum(
            1 for sid in HISTORICAL_STRATEGY_IDS
            for tf in get_strategy_descriptor(sid).supported_timeframes
            if get_strategy_descriptor(sid).paper_historical and tf in ("5m", "15m")
        )
        assert len(result["rows"]) == expected
        combos = {(r["strategy_type"], r["timeframe"]) for r in result["rows"]}
        for sid in HISTORICAL_STRATEGY_IDS:
            descriptor = get_strategy_descriptor(sid)
            if descriptor.paper_historical:
                for tf in descriptor.supported_timeframes:
                    if tf in ("5m", "15m"):
                        assert (sid, tf) in combos
        assert all(r["ok"] for r in result["rows"])
        assert all(r["verdict"] for r in result["rows"])
    asyncio.run(scenario())


def test_screen_rows_sorted_by_net_pnl_desc(monkeypatch):
    async def scenario():
        pnl = {"ema_trend": 42.0, "ema_pullback": 7.5, "confluence_ema": -9.0}
        monkeypatch.setattr(OvernightPilotManager, "_prepare", _fake_prepare_factory(pnl))
        manager = OvernightPilotManager()
        manager.intent_logger = QuietLogger()
        result = await manager.screen_pair("SOLUSDT")
        pnls = [r["backtest"]["net_pnl_usd"] for r in result["rows"]]
        assert pnls == sorted(pnls, reverse=True)
        assert result["rows"][0]["strategy_type"] == "ema_trend"
    asyncio.run(scenario())


def test_screen_never_mutates_active_sessions(monkeypatch):
    async def scenario():
        monkeypatch.setattr(OvernightPilotManager, "_prepare", _fake_prepare_factory({}))
        manager = OvernightPilotManager()
        manager.intent_logger = QuietLogger()
        manager.sessions["ETHUSDT"] = overnight_module.PilotSession(
            OvernightPilotConfig(symbol="ETHUSDT", strategy_type="ema_trend")
        )
        before = set(manager.sessions)
        await manager.screen_pair("ETHUSDT")
        assert set(manager.sessions) == before
    asyncio.run(scenario())


def test_screen_rejects_invalid_symbol_and_days(monkeypatch):
    async def scenario():
        monkeypatch.setattr(OvernightPilotManager, "_prepare", _fake_prepare_factory({}))
        manager = OvernightPilotManager()
        manager.intent_logger = QuietLogger()
        with pytest.raises(ValueError, match="invalid USDT-M symbol"):
            await manager.screen_pair("btc..usdt")
        with pytest.raises(ValueError, match="invalid USDT-M symbol"):
            await manager.screen_pair("BTC")
        with pytest.raises(ValueError, match="days must be within"):
            await manager.screen_pair("BTCUSDT", days=60)
    asyncio.run(scenario())


def test_screen_rejects_concurrent_second_run(monkeypatch):
    async def scenario():
        started = []

        async def slow_prepare(self, selected):
            started.append(selected[0].symbol)
            await asyncio.sleep(0.05)
            await _fake_prepare_factory({})(self, selected)

        monkeypatch.setattr(OvernightPilotManager, "_prepare", slow_prepare)
        manager = OvernightPilotManager()
        manager.intent_logger = QuietLogger()
        first = asyncio.create_task(manager.screen_pair("DOGEUSDT"))
        await asyncio.sleep(0)
        with pytest.raises(ValueError, match="already running"):
            await manager.screen_pair("DOGEUSDT")
        result = await first
        assert result["symbol"] == "DOGEUSDT"
        assert started and all(sym == "DOGEUSDT" for sym in started)
        assert len(started) == len(result["rows"])
    asyncio.run(scenario())
