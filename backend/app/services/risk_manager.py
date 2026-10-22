"""Risk Manager (SRS M4.2c / M4.3) — Compounding с дневным DD-лимитом и
многоуровневый Kill Switch. Чистая state-machine логика без ордеров:
решения (allowed/blocked, эскалация) детерминированы от последовательности
обновлений equity. Truth-first: блокировка снимается только явным unlock
с причиной или новым торговым днём (для дневного гарда).

Уровни Kill Switch (от high-water mark):
- WARNING   (default −3%): сигнал тревоги, входы разрешены;
- HALT_NEW  (default −5%): новые входы заблокированы, открытые позиции живут;
- FLATTEN   (default −10%): эскалация «закрыть всё», входы заблокированы,
  снятие — только ручной unlock с причиной.
Дополнительно поддерживается абсолютный $-порог просадки.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List, Optional, Sequence, Tuple

LEVEL_WARNING = "WARNING"
LEVEL_HALT_NEW = "HALT_NEW"
LEVEL_FLATTEN = "FLATTEN"

_LEVEL_ORDER = {LEVEL_WARNING: 1, LEVEL_HALT_NEW: 2, LEVEL_FLATTEN: 3}
# Уровни, при которых новые входы заблокированы
_BLOCKING = (LEVEL_HALT_NEW, LEVEL_FLATTEN)

DEFAULT_LEVELS: Tuple[Tuple[float, str], ...] = (
    (3.0, LEVEL_WARNING),
    (5.0, LEVEL_HALT_NEW),
    (10.0, LEVEL_FLATTEN),
)


@dataclass(frozen=True)
class KillSwitchEvent:
    level: str
    threshold_pct: float
    drawdown_pct: float
    high_water_mark: float
    equity: float
    ts: int
    action: str  # "alert" | "block_new_entries" | "flatten_all"


class MultiLevelKillSwitch:
    """Многоуровневый kill switch по просадке от HWM. Каждый уровень срабатывает
    один раз до unlock/rebase; активен наивысший сработавший уровень."""

    def __init__(
        self,
        levels: Sequence[Tuple[float, str]] = DEFAULT_LEVELS,
        usd_threshold: Optional[float] = None,
    ):
        if not levels:
            raise ValueError("levels must not be empty")
        cleaned = []
        for pct, name in levels:
            if pct <= 0:
                raise ValueError("level thresholds must be positive")
            if name not in _LEVEL_ORDER:
                raise ValueError(f"unknown level: {name}")
            cleaned.append((float(pct), name))
        # Уровни должны эскалировать по глубине просадки строго вверх по severity
        cleaned.sort(key=lambda item: item[0])
        for (pct_a, name_a), (pct_b, name_b) in zip(cleaned, cleaned[1:]):
            if _LEVEL_ORDER[name_b] < _LEVEL_ORDER[name_a]:
                raise ValueError("levels must escalate in severity with drawdown depth")
        self.levels: Tuple[Tuple[float, str], ...] = tuple(cleaned)
        if usd_threshold is not None and usd_threshold <= 0:
            raise ValueError("usd_threshold must be positive")
        self.usd_threshold = float(usd_threshold) if usd_threshold is not None else None

        self.high_water_mark: Optional[float] = None
        self._fired: List[str] = []
        self.events: List[KillSwitchEvent] = []

    @staticmethod
    def _action_for(level: str) -> str:
        return {
            LEVEL_WARNING: "alert",
            LEVEL_HALT_NEW: "block_new_entries",
            LEVEL_FLATTEN: "flatten_all",
        }[level]

    def update(self, equity: float, ts: int) -> Optional[KillSwitchEvent]:
        """Обновление equity. Возвращает событие, если на этом тике сработал
        НОВЫЙ (наивысший из несработавших) уровень, иначе None."""
        if equity <= 0:
            raise ValueError("equity must be positive")
        if self.high_water_mark is None:
            self.high_water_mark = float(equity)
            return None
        if equity > self.high_water_mark:
            self.high_water_mark = float(equity)
            return None

        dd_pct = (self.high_water_mark - equity) / self.high_water_mark * 100.0
        dd_usd = self.high_water_mark - equity

        newly = None
        for pct, name in self.levels:
            hit = dd_pct >= pct or (self.usd_threshold is not None and dd_usd >= self.usd_threshold)
            if hit and name not in self._fired:
                self._fired.append(name)
                if newly is None or _LEVEL_ORDER[name] > _LEVEL_ORDER[newly[1]]:
                    newly = (pct, name)
        if newly is None:
            return None
        pct, name = newly
        event = KillSwitchEvent(
            level=name, threshold_pct=pct, drawdown_pct=round(dd_pct, 4),
            high_water_mark=self.high_water_mark, equity=float(equity), ts=int(ts),
            action=self._action_for(name),
        )
        self.events.append(event)
        return event

    @property
    def active_level(self) -> Optional[str]:
        if not self._fired:
            return None
        return max(self._fired, key=lambda name: _LEVEL_ORDER[name])

    @property
    def current_action(self) -> str:
        level = self.active_level
        return self._action_for(level) if level else "none"

    @property
    def is_entry_allowed(self) -> bool:
        return self.active_level not in _BLOCKING

    def unlock(self, reason: str, ts: int, rebase_hwm: Optional[float] = None) -> None:
        """Ручная разблокировка: обязательна непустая причина (audit trail).
        rebase_hwm — новая точка отсчёта HWM (обычно текущая equity)."""
        if not reason or not reason.strip():
            raise ValueError("unlock reason must be non-empty")
        self._fired.clear()
        if rebase_hwm is not None:
            if rebase_hwm <= 0:
                raise ValueError("rebase_hwm must be positive")
            self.high_water_mark = float(rebase_hwm)


class DailyDrawdownGuard:
    """Строгий дневной DD-лимит (SRS M4.2c): при просадке от equity начала
    дня (UTC) >= limit новые входы блокируются до конца дня. Сброс — новый день."""

    def __init__(self, daily_limit_pct: float = 3.0):
        if daily_limit_pct <= 0:
            raise ValueError("daily_limit_pct must be positive")
        self.daily_limit_pct = float(daily_limit_pct)
        self._day: Optional[str] = None
        self._day_start_equity: Optional[float] = None
        self._halted = False

    @staticmethod
    def _day_of(ts_ms: int) -> str:
        return datetime.fromtimestamp(ts_ms / 1000.0, tz=timezone.utc).strftime("%Y-%m-%d")

    def update(self, equity: float, ts_ms: int) -> bool:
        """Возвращает True, если новые входы разрешены после этого обновления."""
        if equity <= 0:
            raise ValueError("equity must be positive")
        day = self._day_of(ts_ms)
        if day != self._day:
            self._day = day
            self._day_start_equity = float(equity)
            self._halted = False
            return True
        dd_pct = (self._day_start_equity - equity) / self._day_start_equity * 100.0
        if dd_pct >= self.daily_limit_pct:
            self._halted = True
        return not self._halted

    @property
    def is_entry_allowed(self) -> bool:
        return not self._halted

    @property
    def day_start_equity(self) -> Optional[float]:
        return self._day_start_equity


class CompoundingRiskEngine:
    """Compounding-профиль (SRS M4.2c): риск-бюджет всегда считается от ТЕКУЩЕЙ
    equity (прибыль реинвестируется), но дневной гард жёстко обнуляет бюджет
    при пробое дневного DD-лимита."""

    def __init__(self, base_risk_pct: float = 1.0, daily_limit_pct: float = 3.0):
        if base_risk_pct <= 0:
            raise ValueError("base_risk_pct must be positive")
        self.base_risk_pct = float(base_risk_pct)
        self.guard = DailyDrawdownGuard(daily_limit_pct)

    def risk_budget(self, equity: float, ts_ms: int) -> float:
        """Бюджет риска на сделку в USD: equity × base_risk_pct%, либо 0 при
        сработавшем дневном DD-лимите."""
        if not self.guard.update(equity, ts_ms):
            return 0.0
        return equity * (self.base_risk_pct / 100.0)

    @property
    def is_entry_allowed(self) -> bool:
        return self.guard.is_entry_allowed
