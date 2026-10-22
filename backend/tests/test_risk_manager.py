"""Tests for Risk Manager (SRS M4.2c/M4.3, roadmap phases 5.3/5.4):
multi-level kill switch with escalation & unlock, daily DD guard, compounding budget."""

import pytest

from backend.app.services.risk_manager import (
    CompoundingRiskEngine,
    DailyDrawdownGuard,
    MultiLevelKillSwitch,
)

DAY_MS = 86_400_000
T0 = 1_760_000_000_000  # произвольная полночь- aligned метка не нужна — гард берёт UTC-дату


# --- MultiLevelKillSwitch -----------------------------------------------------

def test_kill_switch_escalates_through_levels():
    ks = MultiLevelKillSwitch()  # 3% warn / 5% halt / 10% flatten
    assert ks.update(10_000.0, T0) is None        # HWM = 10k
    assert ks.update(9_800.0, T0 + 1) is None     # -2% — тишина

    ev = ks.update(9_600.0, T0 + 2)               # -4% -> WARNING
    assert ev is not None and ev.level == "WARNING" and ev.action == "alert"
    assert ks.is_entry_allowed is True

    ev = ks.update(9_400.0, T0 + 3)               # -6% -> HALT_NEW
    assert ev.level == "HALT_NEW" and ev.action == "block_new_entries"
    assert ks.is_entry_allowed is False

    ev = ks.update(8_900.0, T0 + 4)               # -11% -> FLATTEN
    assert ev.level == "FLATTEN" and ev.action == "flatten_all"
    assert ks.is_entry_allowed is False
    assert ks.active_level == "FLATTEN"


def test_kill_switch_level_fires_once_and_jump_skips():
    ks = MultiLevelKillSwitch()
    ks.update(10_000.0, T0)
    ev = ks.update(8_900.0, T0 + 1)   # сразу -11%: наивысший новый уровень
    assert ev.level == "FLATTEN"
    # Дальнейшие обновления не порождают повторных событий
    assert ks.update(8_800.0, T0 + 2) is None
    # ...но более глубокий уровень (если бы был) — нет; все уже сработали
    assert [e.level for e in ks.events] == ["FLATTEN"]


def test_kill_switch_new_hwm_does_not_reset_fired_levels():
    ks = MultiLevelKillSwitch()
    ks.update(10_000.0, T0)
    ks.update(9_400.0, T0 + 1)   # HALT_NEW fired
    ks.update(10_500.0, T0 + 2)  # новый HWM — уровень НЕ сбрасывается
    assert ks.active_level == "HALT_NEW"
    assert ks.is_entry_allowed is False


def test_kill_switch_unlock_requires_reason_and_rebases():
    ks = MultiLevelKillSwitch()
    ks.update(10_000.0, T0)
    ks.update(8_900.0, T0 + 1)
    assert ks.active_level == "FLATTEN"

    with pytest.raises(ValueError):
        ks.unlock("", T0 + 2)
    with pytest.raises(ValueError):
        ks.unlock("   ", T0 + 2)

    ks.unlock("Di: ручная проверка, рынок стабилизировался", T0 + 2, rebase_hwm=8_900.0)
    assert ks.active_level is None
    assert ks.is_entry_allowed is True
    # Просадка от нового HWM считается заново
    assert ks.update(8_800.0, T0 + 3) is None  # -1.1% от 8900


def test_kill_switch_usd_threshold():
    ks = MultiLevelKillSwitch(levels=[(50.0, "HALT_NEW")], usd_threshold=500.0)
    ks.update(10_000.0, T0)
    ev = ks.update(9_499.0, T0 + 1)  # -$501 при -5.01% < 50% — сработал $-порог
    assert ev is not None and ev.level == "HALT_NEW"


def test_kill_switch_validation():
    with pytest.raises(ValueError):
        MultiLevelKillSwitch(levels=[])
    with pytest.raises(ValueError):
        MultiLevelKillSwitch(levels=[(0.0, "WARNING")])
    with pytest.raises(ValueError):
        MultiLevelKillSwitch(levels=[(3.0, "FLATTEN"), (10.0, "WARNING")])  # де-эскалация
    with pytest.raises(ValueError):
        MultiLevelKillSwitch(usd_threshold=-1.0)
    ks = MultiLevelKillSwitch()
    with pytest.raises(ValueError):
        ks.update(0.0, T0)


# --- DailyDrawdownGuard ---------------------------------------------------------

def test_daily_guard_halts_at_limit_and_resets_next_day():
    guard = DailyDrawdownGuard(daily_limit_pct=3.0)
    assert guard.update(10_000.0, T0) is True            # старт дня
    assert guard.update(9_800.0, T0 + 1) is True         # -2%
    assert guard.update(9_699.0, T0 + 2) is False        # -3.01% -> halt
    assert guard.is_entry_allowed is False
    assert guard.update(9_900.0, T0 + 3) is False        # отскок внутри дня halt не снимает

    next_day = T0 + DAY_MS
    assert guard.update(9_900.0, next_day) is True       # новый день — новая база
    assert guard.is_entry_allowed is True
    assert guard.day_start_equity == 9_900.0


def test_daily_guard_validation():
    with pytest.raises(ValueError):
        DailyDrawdownGuard(daily_limit_pct=0.0)
    guard = DailyDrawdownGuard()
    with pytest.raises(ValueError):
        guard.update(-5.0, T0)


# --- CompoundingRiskEngine -------------------------------------------------------

def test_compounding_budget_grows_with_equity_and_halts_on_dd():
    engine = CompoundingRiskEngine(base_risk_pct=1.0, daily_limit_pct=3.0)
    assert engine.risk_budget(10_000.0, T0) == pytest.approx(100.0)
    # Compounding: бюджет от текущей equity, а не от стартовой
    assert engine.risk_budget(12_000.0, T0 + 1) == pytest.approx(120.0)
    # Просадка дня ниже лимита — бюджет от текущей equity
    assert engine.risk_budget(11_700.0, T0 + 2) == pytest.approx(117.0)
    # Пробой дневного лимита (от 10k старта дня) — бюджет ноль
    assert engine.risk_budget(9_600.0, T0 + 3) == 0.0
    assert engine.is_entry_allowed is False
    assert engine.risk_budget(9_650.0, T0 + 4) == 0.0


def test_compounding_engine_validation():
    with pytest.raises(ValueError):
        CompoundingRiskEngine(base_risk_pct=0.0)
