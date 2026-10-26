"""Tests for Hedge Mode ledger (SRS M4.1, roadmap phase 5.5):
isolated margin sub-wallets for simultaneous LONG/SHORT sub-strategies."""

import pytest

from backend.app.services.hedge_ledger import HedgeLedger


@pytest.fixture
def ledger():
    h = HedgeLedger(total_balance=1_000.0)
    h.create_wallet("long:trend", "LONG")
    h.create_wallet("short:scalp", "SHORT")
    return h


def test_long_and_short_coexist_with_isolated_margin(ledger):
    ledger.allocate("long:trend", 400.0)
    ledger.allocate("short:scalp", 300.0)
    assert ledger.unallocated == pytest.approx(300.0)

    # Одновременные позиции в РАЗНЫЕ стороны — маржа резервируется изолированно
    ledger.open_position("long:trend", 250.0)
    ledger.open_position("short:scalp", 200.0)
    assert ledger.wallet("long:trend").margin_free == pytest.approx(150.0)
    assert ledger.wallet("short:scalp").margin_free == pytest.approx(100.0)
    assert ledger.unallocated == pytest.approx(300.0)  # пул не тронут

    # Закрытие с PnL пишется в СВОЙ кошелёк
    ledger.close_position("long:trend", 250.0, realized_pnl=+30.0)
    ledger.close_position("short:scalp", 200.0, realized_pnl=-25.0)
    assert ledger.wallet("long:trend").realized_pnl == pytest.approx(30.0)
    assert ledger.wallet("short:scalp").realized_pnl == pytest.approx(-25.0)
    assert ledger.wallet("long:trend").equity == pytest.approx(430.0)
    assert ledger.wallet("short:scalp").equity == pytest.approx(275.0)


def test_allocate_cannot_exceed_unallocated_pool(ledger):
    ledger.allocate("long:trend", 800.0)
    with pytest.raises(ValueError, match="insufficient unallocated"):
        ledger.allocate("short:scalp", 200.01)


def test_deallocate_blocked_for_margin_in_use(ledger):
    ledger.allocate("long:trend", 400.0)
    ledger.open_position("long:trend", 300.0)
    with pytest.raises(ValueError, match="margin in use"):
        ledger.deallocate("long:trend", 150.0)  # free только 100
    ledger.deallocate("long:trend", 100.0)      # ровно free — можно
    assert ledger.wallet("long:trend").margin_allocated == pytest.approx(300.0)


def test_open_position_blocked_beyond_wallet_margin(ledger):
    ledger.allocate("short:scalp", 100.0)
    with pytest.raises(ValueError, match="margin exceeded"):
        ledger.open_position("short:scalp", 100.01)


def test_isolated_loss_clamped_at_leg_margin(ledger):
    ledger.allocate("long:trend", 200.0)
    ledger.allocate("short:scalp", 200.0)
    ledger.open_position("long:trend", 150.0)
    # Катастрофический убыток -300 при марже ноги 150: бронируется только -150,
    # излишек НЕ перетекает ни в пул, ни в чужой кошелёк
    booked = ledger.close_position("long:trend", 150.0, realized_pnl=-300.0)
    assert booked == pytest.approx(-150.0)
    assert ledger.wallet("long:trend").realized_pnl == pytest.approx(-150.0)
    assert ledger.wallet("short:scalp").realized_pnl == 0.0
    assert ledger.summary()["total_realized_pnl"] == pytest.approx(-150.0)


def test_close_without_open_position_rejected(ledger):
    ledger.allocate("long:trend", 100.0)
    with pytest.raises(ValueError, match="no open positions"):
        ledger.close_position("long:trend", 50.0, 10.0)


def test_wallet_and_ledger_validation():
    h = HedgeLedger(500.0)
    h.create_wallet("a", "LONG")
    with pytest.raises(ValueError):
        h.create_wallet("a", "SHORT")            # дубликат имени
    with pytest.raises(ValueError):
        h.create_wallet("b", "SIDEWAYS")         # плохая сторона
    with pytest.raises(ValueError):
        h.wallet("nope")                          # неизвестный кошелёк
    with pytest.raises(ValueError):
        HedgeLedger(0.0)
    with pytest.raises(ValueError):
        h.allocate("a", -5.0)


def test_unallocated_reflects_realized_pnl(ledger):
    ledger.allocate("long:trend", 500.0)
    ledger.open_position("long:trend", 500.0)
    ledger.close_position("long:trend", 500.0, realized_pnl=+100.0)
    # Пул = 1000 + 100 (pnl) - 500 (allocated) = 600
    assert ledger.unallocated == pytest.approx(600.0)
    summary = ledger.summary()
    assert summary["total_realized_pnl"] == pytest.approx(100.0)
    assert summary["wallets"][0]["side"] == "LONG"
