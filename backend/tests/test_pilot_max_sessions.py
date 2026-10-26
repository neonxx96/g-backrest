"""Тест лимита OvernightPilotManager.MAX_SESSIONS (расширение Di 2026-10-24 вечер:
тест на 20 объёмных волатильных фьючерсов с бэктест-подбором стратегии;
ранее — 14, расширение прогона 2026-10-24 день)."""
import pytest

from backend.app.services.overnight_pilot import OvernightPilotConfig, OvernightPilotManager

SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "BNBUSDT",
           "LINKUSDT", "ZECUSDT", "NEARUSDT", "ENAUSDT", "WLDUSDT", "SUIUSDT",
           "UNIUSDT", "AVAXUSDT", "ADAUSDT", "TAOUSDT", "ARBUSDT", "AAVEUSDT",
           "TIAUSDT", "HYPEUSDT", "INJUSDT"]


def _configs(n: int) -> list:
    return [OvernightPilotConfig(symbol=s, strategy_type="ema_trend") for s in SYMBOLS[:n]]


def test_twenty_sessions_accepted():
    manager = OvernightPilotManager()
    manager._validate_configs(_configs(20))  # не должно поднять ValueError


def test_twenty_one_sessions_rejected():
    manager = OvernightPilotManager()
    with pytest.raises(ValueError, match="one to 20 sessions"):
        manager._validate_configs(_configs(21))


def test_single_session_still_accepted():
    manager = OvernightPilotManager()
    manager._validate_configs(_configs(1))
