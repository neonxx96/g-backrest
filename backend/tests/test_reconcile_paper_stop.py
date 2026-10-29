from scripts.reconcile_paper_stop import first_exit_bar, build_recovery_trade


def test_recovery_uses_first_closed_bar_crossing_stop_after_last_tick():
    position = {"side": "LONG", "stop_price": 101.0, "target_price": 110.0}
    bars = [
        [120_000, "103", "104", "102", "103", "1", 179_999],
        [180_000, "102", "103", "100", "100.5", "1", 239_999],
        [240_000, "100", "111", "99", "110", "1", 299_999],
    ]
    result = first_exit_bar(position, bars, last_tick_ms=90_000, now_ms=300_000)
    assert result == (100.5, 239_999, "RECOVERY_STOP_CROSS_1M_CLOSE")


def test_recovery_trade_subtracts_entry_and_exit_fees_once():
    position = {
        "symbol": "BNBUSDT", "side": "LONG", "qty": 0.1,
        "avg_entry_price": 100.0, "entry_ts": 1_000,
        "fees_paid": 0.005, "stop_price": 99.0,
        "target_price": 102.0, "risk_amount": 0.1,
    }
    trade = build_recovery_trade(position, 101.0, 2_000, "RECOVERY_STOP_CROSS_1M_CLOSE")
    assert round(trade["gross_pnl"], 6) == 0.1
    assert round(trade["fee_drag"], 6) == round(0.005 + 101.0 * 0.1 * 0.0005, 6)
    assert round(trade["net_pnl"], 6) == round(trade["gross_pnl"] - trade["fee_drag"], 6)
