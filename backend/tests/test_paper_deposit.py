"""Контрактные тесты пополнения виртуального кошелька (paper money).

Deposit — осознанная возможность терминала: баланс всегда виртуальный
(execution_simulator, без реальных ключей — инвариант AGENTS.md §5.1),
пополнение не трогает позиции/ордера/историю, только увеличивает базу кошелька.
"""

from __future__ import annotations

import pytest

from backend.app.services.paper_trading import PaperTradingSession


def _session(balance: float = 10000.0) -> PaperTradingSession:
    return PaperTradingSession(initial_balance=balance, session_id="test_deposit")


def test_deposit_increases_base_and_available_margin():
    s = _session()
    before_margin = s.available_margin
    res = s.deposit(2500.0, reason="Test top-up")

    assert res["deposited"] == 2500.0
    assert s.initial_balance == 12500.0
    assert s.available_margin == before_margin + 2500.0
    assert res["initial_balance"] == 12500.0
    assert res["reason"] == "Test top-up"


def test_deposit_does_not_touch_trading_state():
    s = _session()
    s.deposit(500.0)
    # Позиции/ордера/история не тронуты
    assert s.positions == {}
    assert s.orders == {}
    assert s.closed_trades == []
    assert s.realized_pnl == 0.0
    assert s.locked_margin == 0.0


def test_deposit_rejects_non_positive_and_non_finite():
    s = _session()
    for bad in (0.0, -100.0, float("nan"), float("inf")):
        with pytest.raises(ValueError):
            s.deposit(bad)
    assert s.initial_balance == 10000.0
    assert s.available_margin == 10000.0


def test_balance_identity_holds_after_deposit():
    """balance = initial_balance + realized + unrealized — инвариант get_state()."""
    s = _session()
    s.deposit(1000.0)
    state = s.get_state().to_dict()
    expected = state["initial_balance"] + state["realized_pnl"] + state["unrealized_pnl"]
    assert abs(state["balance"] - expected) < 1e-9


def test_deposit_default_reason():
    s = _session()
    res = s.deposit(100.0)
    assert res["reason"] == "Manual top-up"


def test_reset_after_deposit_returns_to_strict_balance():
    s = _session()
    s.deposit(5000.0)
    s.reset_wallet(10000.0)
    assert s.initial_balance == 10000.0
    assert s.available_margin == 10000.0
