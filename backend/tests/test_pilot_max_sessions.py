"""Тест лимита OvernightPilotManager.MAX_SESSIONS (запрос Di 2026-10-23:
scalp-прогон по 5–7 волатильным фьючерсам за одну ночь)."""
import pytest

from backend.app.services.overnight_pilot import OvernightPilotConfig, OvernightPilotManager


def _configs(n: int) -> list:
    symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "BNBUSDT", "LINKUSDT", "ADAUSDT"]
    return [OvernightPilotConfig(symbol=s, strategy_type="ema_trend") for s in symbols[:n]]


def test_seven_sessions_accepted():
    manager = OvernightPilotManager()
    manager._validate_configs(_configs(7))  # не должно поднять ValueError


def test_eight_sessions_rejected():
    manager = OvernightPilotManager()
    with pytest.raises(ValueError, match="one to 7 sessions"):
        manager._validate_configs(_configs(8))


def test_single_session_still_accepted():
    manager = OvernightPilotManager()
    manager._validate_configs(_configs(1))
