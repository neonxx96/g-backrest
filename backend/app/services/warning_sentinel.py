"""Warning Sentinel (задача 7.2): фоновый сторож системных событий.

Правила (чистые, тестируемые без asyncio/БД):
- PAPER_HALTED      — kill switch demo paper-сессии (critical)
- FEED_DISCONNECTED — data_status != connected у demo paper или марафона (warning)
- MARATHON_ERRORS   — error_count сессии марафона выше порога (warning)
- EQUITY_DRAWDOWN   — просадка баланса марафонной сессии >= dd_pct от старта (critical)
- LOSS_STREAK       — последние N закрытых сделок подряд в минус (warning)

Диспетчеризация: cooldown по ключу алерта (дефолт 300 с) + rate-limit Telegram.
Состояние алертов доступно через get_status() (для /api/sentinel/status).
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

SENTINEL_ENABLED = os.getenv("SENTINEL_ENABLED", "1") not in ("0", "false", "no")
SENTINEL_INTERVAL_S = float(os.getenv("SENTINEL_INTERVAL_S", "30"))
COOLDOWN_S = float(os.getenv("SENTINEL_COOLDOWN_S", "300"))
MAX_RECENT_ALERTS = 50


@dataclass(frozen=True)
class SentinelConfig:
    drawdown_pct: float = 5.0       # порог просадки баланса марафона, %
    max_errors: int = 5             # допустимый error_count марафонной сессии
    loss_streak: int = 5            # серия убыточных сделок подряд
    cooldown_s: float = COOLDOWN_S


def evaluate_sentinel(snapshot: Dict[str, Any], cfg: SentinelConfig = SentinelConfig()) -> List[Dict[str, Any]]:
    """Чистая оценка правил. snapshot — плоский dict (см. collect_snapshot)."""
    alerts: List[Dict[str, Any]] = []
    paper = snapshot.get("paper") or {}
    marathon = snapshot.get("marathon") or []

    if paper.get("is_halted"):
        alerts.append({
            "key": "PAPER_HALTED",
            "level": "critical",
            "message": f"⛔ Kill switch: demo paper-сессия остановлена ({paper.get('halt_reason') or 'без причины'})",
        })

    statuses = [("paper", paper.get("data_status"), paper.get("session_id"))]
    for s in marathon:
        statuses.append((f"marathon:{s.get('symbol')}", s.get("data_status"), s.get("session_id")))
    for scope, st, sid in statuses:
        if st and st != "connected":
            alerts.append({
                "key": f"FEED_DISCONNECT:{scope}",
                "level": "warning",
                "message": f"⚠️ Поток данных {scope} в статусе {st} (сессия {sid})",
            })

    for s in marathon:
        errs = int(s.get("error_count") or 0)
        if errs > cfg.max_errors:
            alerts.append({
                "key": f"MARATHON_ERRORS:{s.get('symbol')}",
                "level": "warning",
                "message": f"⚠️ {s.get('symbol')}: {errs} ошибок марафонной сессии (порог {cfg.max_errors})",
            })
        start = float(s.get("start_balance") or 0.0)
        bal = float(s.get("balance") or 0.0)
        if start > 0 and bal > 0:
            dd = (start - bal) / start * 100.0
            if dd >= cfg.drawdown_pct:
                alerts.append({
                    "key": f"EQUITY_DRAWDOWN:{s.get('symbol')}",
                    "level": "critical",
                    "message": f"🔻 {s.get('symbol')}: просадка баланса {dd:.2f}% (порог {cfg.drawdown_pct}%)",
                })

    trades = paper.get("closed_trades") or []
    streak: List[float] = []
    for t in reversed(trades[-cfg.loss_streak:]):
        streak.append(float(t.get("net_pnl") or 0.0))
    if len(streak) == cfg.loss_streak and all(v < 0 for v in streak):
        alerts.append({
            "key": "LOSS_STREAK",
            "level": "warning",
            "message": f"📉 {cfg.loss_streak} убыточных сделок подряд в demo paper-сессии",
        })

    return alerts


def filter_by_cooldown(alerts: List[Dict[str, Any]], last_sent: Dict[str, float],
                       now: float, cooldown_s: float = COOLDOWN_S) -> List[Dict[str, Any]]:
    """Оставляет алерты, чей ключ не отправлялся в пределах cooldown.
    Ключ без записи истории (None) — всегда пропускается (первый алерт)."""
    out = []
    for a in alerts:
        sent_at = last_sent.get(a["key"])
        if sent_at is None or now - sent_at >= cooldown_s:
            out.append(a)
    return out


def filter_persistent_disconnects(alerts: List[Dict[str, Any]],
                                seen: set) -> List[Dict[str, Any]]:
    """FEED_DISCONNECT пропускает только со второго тика подряд.

    Раннеры марафона проводят первые секунды в stale/disconnected (прогрев
    буферов) — одиночный stale на старте не алерт. seen — накопленное
    множество ключей disconnect-предыдущего тика (мутирует вызывателем).
    """
    current: set = set()
    out = []
    for a in alerts:
        if not a["key"].startswith("FEED_DISCONNECT:"):
            out.append(a)
            continue
        current.add(a["key"])
        if a["key"] in seen:  # второй тик подряд — реальный обрыв
            out.append(a)
    seen.clear()
    seen.update(current)
    return out


@dataclass
class SentinelService:
    cfg: SentinelConfig = field(default_factory=SentinelConfig)
    _last_sent: Dict[str, float] = field(default_factory=dict)
    _disconnect_seen: set = field(default_factory=set)
    recent_alerts: List[Dict[str, Any]] = field(default_factory=list)
    _task: Optional[asyncio.Task] = None
    _running: bool = False
    last_run_ts: float = 0.0
    last_snapshot: Dict[str, Any] = field(default_factory=dict)

    def collect_snapshot(self) -> Dict[str, Any]:
        """Собирает состояние из demo paper-сессии и менеджера марафона."""
        from backend.app.services.overnight_pilot import overnight_pilot_manager
        from backend.app.services.paper_trading import paper_trading_session

        state = paper_trading_session.get_state()
        d = state.to_dict() if hasattr(state, "to_dict") else dict(state)
        snapshot: Dict[str, Any] = {
            "paper": {
                "session_id": d.get("session_id"),
                "is_halted": bool(d.get("is_halted")),
                "halt_reason": d.get("halt_reason"),
                "data_status": d.get("data_status"),
                "closed_trades": d.get("closed_trades") or [],
            },
            "marathon": [],
        }
        try:
            status = overnight_pilot_manager.status() or {}
            sessions = status.get("sessions") or {}
            if isinstance(sessions, list):
                sessions = {s.get("symbol"): s for s in sessions if isinstance(s, dict)}
            for sym, item in sessions.items():
                paper = (item or {}).get("paper") or {}
                cfg = (item or {}).get("config") or {}
                snapshot["marathon"].append({
                    "symbol": sym,
                    "session_id": (item or {}).get("session_id"),
                    "data_status": paper.get("data_status"),
                    "error_count": paper.get("error_count") or (item or {}).get("error_count") or 0,
                    "balance": paper.get("balance"),
                    "start_balance": cfg.get("initial_capital"),
                })
        except Exception:
            logger.exception("sentinel: failed to collect marathon status")
        return snapshot

    async def run_once(self) -> List[Dict[str, Any]]:
        now = time.time()
        snapshot = self.collect_snapshot()
        self.last_snapshot = snapshot
        self.last_run_ts = now
        alerts = evaluate_sentinel(snapshot, self.cfg)
        alerts = filter_persistent_disconnects(alerts, self._disconnect_seen)
        fresh = filter_by_cooldown(alerts, self._last_sent, now, self.cfg.cooldown_s)
        for a in fresh:
            self._last_sent[a["key"]] = now
            self.recent_alerts.append({**a, "ts": now})
        if len(self.recent_alerts) > MAX_RECENT_ALERTS:
            self.recent_alerts = self.recent_alerts[-MAX_RECENT_ALERTS:]
        if fresh:
            try:
                from backend.app.services.bot import broadcast_alert
                for a in fresh:
                    await broadcast_alert(a["message"])
            except Exception:
                logger.exception("sentinel: alert dispatch failed")
        return fresh

    async def _loop(self) -> None:
        while self._running:
            try:
                await self.run_once()
            except Exception:
                logger.exception("sentinel loop iteration failed")
            await asyncio.sleep(SENTINEL_INTERVAL_S)

    def start(self) -> None:
        if not SENTINEL_ENABLED or self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("[sentinel] started (interval %.0fs, cooldown %.0fs)", SENTINEL_INTERVAL_S, self.cfg.cooldown_s)

    def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None

    def get_status(self) -> Dict[str, Any]:
        return {
            "enabled": SENTINEL_ENABLED,
            "running": self._running,
            "interval_s": SENTINEL_INTERVAL_S,
            "cooldown_s": self.cfg.cooldown_s,
            "last_run_ts": self.last_run_ts,
            "recent_alerts": list(self.recent_alerts),
            "last_snapshot": self.last_snapshot,
        }


warning_sentinel = SentinelService()
