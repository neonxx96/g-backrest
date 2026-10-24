"""Тест лимита OvernightPilotManager.MAX_SESSIONS (расширение Di 2026-10-24:
прогон до 14 волатильных фьючерсов одновременно)."""
import pytest

from backend.app.services.overnight_pilot import OvernightPilotConfig, OvernightPilotManager

SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "BNBUSDT",
           "LINKUSDT", "ZECUSDT", "NEARUSDT", "ENAUSDT", "WLDUSDT", "SUIUSDT",
           "UNIUSDT", "AVAXUSDT", "ADAUSDT"]


def _configs(n: int) -> list:
    return [OvernightPilotConfig(symbol=s, strategy_type="ema_trend") for s in SYMBOLS[:n]]


def test_fourteen_sessions_accepted():
    manager = OvernightPilotManager()
    manager._validate_configs(_configs(14))  # не должно поднять ValueError


def test_fifteen_sessions_rejected():
    manager = OvernightPilotManager()
    with pytest.raises(ValueError, match="one to 14 sessions"):
        manager._validate_configs(_configs(15))


def test_single_session_still_accepted():
    manager = OvernightPilotManager()
    manager._validate_configs(_configs(1))
