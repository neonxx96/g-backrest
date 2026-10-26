"""Контрактные тесты Warning Sentinel (задача 7.2).

Чистые функции evaluate_sentinel / filter_by_cooldown (конвенция проекта).
"""

from __future__ import annotations

from backend.app.services.warning_sentinel import (
    SentinelConfig,
    SentinelService,
    evaluate_sentinel,
    filter_by_cooldown,
    filter_persistent_disconnects,
)


def _paper(**kw):
    base = {
        "session_id": "paper_x", "is_halted": False, "halt_reason": None,
        "data_status": None, "closed_trades": [],
    }
    base.update(kw)
    return base


def _marathon(sym="BTCUSDT", **kw):
    base = {
        "symbol": sym, "session_id": f"ovn_{sym}", "data_status": "connected",
        "error_count": 0, "balance": 10000.0, "start_balance": 10000.0,
    }
    base.update(kw)
    return base


class TestEvaluate:
    def test_quiet_system_has_no_alerts(self):
        snap = {"paper": _paper(), "marathon": [_marathon()]}
        assert evaluate_sentinel(snap) == []

    def test_paper_halted_is_critical(self):
        snap = {"paper": _paper(is_halted=True, halt_reason="daily loss limit"), "marathon": []}
        alerts = evaluate_sentinel(snap)
        assert len(alerts) == 1
        assert alerts[0]["key"] == "PAPER_HALTED"
        assert alerts[0]["level"] == "critical"
        assert "daily loss limit" in alerts[0]["message"]

    def test_feed_disconnect_per_scope(self):
        snap = {
            "paper": _paper(data_status="disconnected"),
            "marathon": [_marathon("ETHUSDT", data_status="stale")],
        }
        keys = {a["key"] for a in evaluate_sentinel(snap)}
        assert keys == {"FEED_DISCONNECT:paper", "FEED_DISCONNECT:marathon:ETHUSDT"}
        # None (unknown) — не алерт
        assert evaluate_sentinel({"paper": _paper(), "marathon": [_marathon("SOLUSDT", data_status=None)]}) == []

    def test_marathon_errors_above_threshold(self):
        cfg = SentinelConfig(max_errors=5)
        snap = {"paper": _paper(), "marathon": [_marathon(error_count=6)]}
        alerts = evaluate_sentinel(snap, cfg)
        assert [a["key"] for a in alerts] == ["MARATHON_ERRORS:BTCUSDT"]

    def test_drawdown_threshold(self):
        cfg = SentinelConfig(drawdown_pct=5.0)
        ok = {"paper": _paper(), "marathon": [_marathon(balance=9600.0)]}   # -4%
        bad = {"paper": _paper(), "marathon": [_marathon(balance=9400.0)]}  # -6%
        assert evaluate_sentinel(ok, cfg) == []
        alerts = evaluate_sentinel(bad, cfg)
        assert alerts[0]["key"] == "EQUITY_DRAWDOWN:BTCUSDT"
        assert "6.00%" in alerts[0]["message"]
        # нулевые старты — правило молчит (нет базы для %)
        zero = {"paper": _paper(), "marathon": [_marathon(balance=0.0, start_balance=0.0)]}
        assert evaluate_sentinel(zero, cfg) == []

    def test_loss_streak(self):
        cfg = SentinelConfig(loss_streak=3)
        trades = [{"net_pnl": -1.0}, {"net_pnl": -2.0}, {"net_pnl": -0.5}, {"net_pnl": 5.0}]
        snap = {"paper": _paper(closed_trades=trades), "marathon": []}
        assert evaluate_sentinel(snap, cfg) == []  # последняя прибыльная — серия 2
        snap["paper"]["closed_trades"] = [{"net_pnl": -1.0}, {"net_pnl": -2.0}, {"net_pnl": -0.5}]
        alerts = evaluate_sentinel(snap, cfg)
        assert [a["key"] for a in alerts] == ["LOSS_STREAK"]


class TestCooldown:
    def test_cooldown_suppresses_repeat(self):
        alerts = [{"key": "PAPER_HALTED", "level": "critical", "message": "x"}]
        now = 1000.0
        first = filter_by_cooldown(alerts, {}, now, cooldown_s=300)
        assert len(first) == 1
        last = {"PAPER_HALTED": now}
        # внутри cooldown — подавлен
        assert filter_by_cooldown(alerts, last, now + 299, cooldown_s=300) == []
        # после cooldown — снова пропускаем
        again = filter_by_cooldown(alerts, last, now + 301, cooldown_s=300)
        assert len(again) == 1

    def test_independent_keys_do_not_block_each_other(self):
        alerts = [
            {"key": "A", "level": "warning", "message": ""},
            {"key": "B", "level": "warning", "message": ""},
        ]
        out = filter_by_cooldown(alerts, {"A": 95.0}, now=100.0, cooldown_s=10)
        assert [a["key"] for a in out] == ["B"]  # A отправлен 5 с назад — в кулдауне


class TestPersistentDisconnects:
    def test_first_tick_is_grace_second_alerts(self):
        seen: set = set()
        disc = {"key": "FEED_DISCONNECT:marathon:BTCUSDT", "level": "warning", "message": ""}
        halt = {"key": "PAPER_HALTED", "level": "critical", "message": ""}
        # первый тик: disconnect гасится grace, прочие правила — сразу
        assert filter_persistent_disconnects([disc, halt], seen) == [halt]
        # второй тик подряд: disconnect проходит
        assert filter_persistent_disconnects([disc], seen) == [disc]
        # пропал и вернулся — снова grace
        assert filter_persistent_disconnects([], seen) == []
        assert filter_persistent_disconnects([disc], seen) == []


class TestServiceState:
    def test_get_status_shape(self):
        svc = SentinelService()
        st = svc.get_status()
        for k in ("enabled", "running", "interval_s", "cooldown_s", "recent_alerts", "last_snapshot"):
            assert k in st
        assert st["recent_alerts"] == []
