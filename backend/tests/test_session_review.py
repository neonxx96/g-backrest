"""Контрактные тесты пост-сессионного разбора (задача 7.3).

Чистые функции session_review без БД (конвенция проекта).
"""

from __future__ import annotations

from backend.app.services.session_review import (
    build_session_review,
    find_decision_for_trade,
    link_trades_to_decisions,
    summarize_session,
)


def _trade(sym: str, entry_ts: int, net: float, mfe_r: float = 0.0, bleed: bool = False):
    return {
        "symbol": sym, "side": "LONG", "net_pnl": net, "mfe_r": mfe_r,
        "profit_bleed": bleed, "entry_ts": entry_ts, "exit_ts": entry_ts + 60_000,
    }


def _decision(id_: int, sym: str, ts: int, etype: str = "SIGNAL", decision: str = "ENTERED"):
    return {
        "id": id_, "symbol": sym, "timestamp_ms": ts, "event_type": etype,
        "user_decision": decision, "direction": "LONG", "price": 0.0, "notes": "",
    }


class TestFindDecision:
    def test_latest_decision_inside_lag_window(self):
        trade = _trade("BTCUSDT", 1_000_000, 10.0)
        decisions = [
            _decision(1, "BTCUSDT", 900_000),      # старше лага (15 мин) — не берём
            _decision(2, "BTCUSDT", 995_000),      # подходит
            _decision(3, "BTCUSDT", 999_000),    # самое позднее — берём его
        ]
        found = find_decision_for_trade(trade, decisions)
        assert found["id"] == 3

    def test_decision_after_entry_is_ignored(self):
        trade = _trade("BTCUSDT", 1_000_000, 10.0)
        decisions = [_decision(1, "BTCUSDT", 1_000_001)]
        assert find_decision_for_trade(trade, decisions) is None

    def test_symbol_and_type_filters(self):
        trade = _trade("BTCUSDT", 1_000_000, 10.0)
        decisions = [
            _decision(1, "ETHUSDT", 999_000),                      # другой символ
            _decision(2, "BTCUSDT", 999_000, etype="AI_OPINION"),  # не вход-кандидат
        ]
        assert find_decision_for_trade(trade, decisions) is None

    def test_symbol_case_insensitive(self):
        trade = _trade("btcusdt", 1_000_000, 10.0)
        decisions = [_decision(1, "BTCUSDT", 999_000)]
        assert find_decision_for_trade(trade, decisions)["id"] == 1

    def test_custom_lag(self):
        trade = _trade("BTCUSDT", 1_000_000, 10.0)
        decisions = [_decision(1, "BTCUSDT", 400_000)]  # 600 с (10 мин) до входа
        assert find_decision_for_trade(trade, decisions)["id"] == 1                    # дефолт 15 мин — подходит
        assert find_decision_for_trade(trade, decisions, max_lag_ms=300_000) is None  # кастом 5 мин — мимо


class TestSummarize:
    def test_match_rate_and_pnl_buckets(self):
        trades = [
            _trade("BTCUSDT", 1_000_000, 50.0, mfe_r=1.0),   # matched ENTERED
            _trade("ETHUSDT", 2_000_000, -20.0),            # matched SKIPPED
            _trade("SOLUSDT", 3_000_000, 30.0),             # unmatched
        ]
        decisions = [
            _decision(1, "BTCUSDT", 999_000, decision="ENTERED"),
            _decision(2, "ETHUSDT", 1_999_000, decision="SKIPPED"),
        ]
        pairs = link_trades_to_decisions(trades, decisions)
        s = summarize_session(pairs)
        assert s["trades_total"] == 3
        assert s["trades_matched"] == 2
        assert s["match_rate_pct"] == 66.7
        assert s["pnl"]["net_all"] == 60.0
        assert s["pnl"]["net_matched"] == 30.0
        assert s["pnl"]["net_unmatched"] == 30.0
        assert s["pnl"]["net_entered_decisions"] == 50.0
        assert s["pnl"]["net_skipped_decisions"] == -20.0
        # SKIPPED-решение оказалось убыточным: «избежанный убыток», не упущенная прибыль
        assert s["skipped_opportunity_pnl"] == -20.0
        assert s["decisions"] == {"entered": 1, "skipped": 1, "pending": 0}

    def test_empty_session_is_zeroes(self):
        s = summarize_session([])
        assert s["trades_total"] == 0
        assert s["match_rate_pct"] == 0.0
        assert s["pnl"]["net_all"] == 0.0
        assert s["win_rate_matched_pct"] == 0.0

    def test_profit_bleed_counting(self):
        trades = [
            _trade("BTCUSDT", 1_000_000, -5.0, mfe_r=0.8, bleed=True),
            _trade("ETHUSDT", 2_000_000, 5.0, mfe_r=0.1),
        ]
        decisions = [
            _decision(1, "BTCUSDT", 999_000),
            _decision(2, "ETHUSDT", 1_999_000),
        ]
        s = summarize_session(link_trades_to_decisions(trades, decisions))
        assert s["profit_bleed_count"] == 1
        assert s["avg_mfe_r_matched"] == round((0.8 + 0.1) / 2, 4)

    def test_build_session_review_shape(self):
        review = build_session_review([_trade("BTCUSDT", 1_000_000, 5.0)], [])
        assert set(review) == {"summary", "pairs", "max_lag_ms"}
        assert review["pairs"][0]["decision"] is None
        assert review["summary"]["trades_total"] == 1
