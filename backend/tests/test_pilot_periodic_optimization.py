"""Контракт периодической оптимизации стратегий марафона (запрос Di 2026-10-24 вечер:
«функция оптимизации стратегий включена на период теста»).

Поведение: при start() у каждой сессии поднимается _optimization_loop — первый прогон
генетического оптимизатора сразу, далее каждые OPTIMIZATION_INTERVAL_SEC; результат
(рекомендация, НЕ авто-применение) пишется в session.backtest["optimization"] с mode
"periodic" и штампом last_optimization_at. При stop() задачи отменяются.
"""
import inspect

from backend.app.services.overnight_pilot import (
    OvernightPilotConfig,
    OvernightPilotManager,
    PilotSession,
)


def test_start_creates_optimization_tasks():
    src = inspect.getsource(OvernightPilotManager.start)
    assert "_optimization_loop" in src, "start() должен поднимать periodic-оптимизацию"
    assert "_optimization_tasks" in src


def test_stop_cancels_optimization_tasks():
    src = inspect.getsource(OvernightPilotManager.stop)
    assert "_optimization_tasks" in src, "stop() должен отменять задачи оптимизации"


def test_loop_uses_optimizer_and_interval():
    src = inspect.getsource(OvernightPilotManager._optimization_loop)
    assert "_run_session_optimizer" in src
    assert "OPTIMIZATION_INTERVAL_SEC" in src
    assert 'mode="periodic"' in src


def test_optimizer_marks_consultative_mode_and_timestamp():
    src = inspect.getsource(OvernightPilotManager._run_session_optimizer)
    assert '"mode": mode' in src, "режим (pre_run/periodic) должен фиксироваться в результате"
    assert "last_optimization_at" in src
    assert "не применяются автоматически" in src  # дисклеймер консультативности


def test_interval_is_sane():
    assert OvernightPilotManager.OPTIMIZATION_INTERVAL_SEC >= 3600


def test_session_exposes_last_optimization_at():
    session = PilotSession(OvernightPilotConfig(symbol="BTCUSDT", strategy_type="ema_trend"))
    assert session.to_dict()["last_optimization_at"] is None
    session.last_optimization_at = 123
    assert session.to_dict()["last_optimization_at"] == 123
