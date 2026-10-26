from backend.app.services.trade_postmortem_service import analyze_trades, classify_loss


def _t(**kw):
    base = {"symbol": "BTCUSDT", "net_pnl": -1.0, "gross_pnl": -0.5, "fee": 0.5,
            "mfe_r": 0.1, "mae_r": -1.0, "realized_r": -1.0, "reason": "STOP_LOSS",
            "timeframe": "1m", "strategy": "ema", "regime": "RANGE"}
    base.update(kw)
    return base


def test_classify_loss_causes():
    assert classify_loss(_t(net_pnl=2.0)) == "WIN"
    assert classify_loss(_t(gross_pnl=0.2, net_pnl=-0.3)) == "FEE_DRAG"
    assert classify_loss(_t(mfe_r=0.9)) == "MFE_REVERSAL"
    assert classify_loss(_t(reason="SENTINEL_TIME_STOP")) == "STALE_TIME_OUT"
    assert classify_loss(_t(reason="SENTINEL_EARLY_EXIT")) == "ADVERSE_EXIT"
    assert classify_loss(_t(fee=0.01, gross_pnl=-2.0, mfe_r=0.5, mae_r=-0.4)) == "STOP_OUT"
    assert classify_loss(_t(fee=0.01, gross_pnl=-2.0, mae_r=-0.95, mfe_r=0.0)) == "BAD_ENTRY"


def test_analyze_empty():
    r = analyze_trades([])
    assert r["sample_size"] == 0 and r["small_sample"] and r["recommendations"] == []


def test_recommends_higher_tf_on_fee_burden():
    trades = [_t(gross_pnl=-0.5, fee=0.5) for _ in range(6)]
    r = analyze_trades(trades)
    assert r["by_symbol"]["BTCUSDT"]["fee_burden_index"] == 1.0
    assert any("перейти на 3m" in x for x in r["recommendations"])


def test_no_advice_on_tiny_sample_and_none_safe():
    r = analyze_trades([_t(mfe_r=None, mae_r=None, realized_r=None)] * 2)
    assert r["recommendations"] == []
    assert r["overall"]["expectancy_r"] is None
