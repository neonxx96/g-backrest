"""Tests for M4 Risk Manager gates inside LivePaperRunner (roadmap phase 5.6).

Gates are flag-gated (default OFF): with use_m4_risk_gates=False the runner
must behave exactly as before. Tests wire the M4 components manually and call
the pure gate helper _m4_check_entry — no event loop, no network.
"""

from types import SimpleNamespace

import pytest
import time

from backend.app.services.live_paper_runner import LivePaperRunner
from backend.app.services.paper_trading import PaperTradingSession
from backend.app.services.position_sizer import PositionSizer
from backend.app.services.risk_manager import DailyDrawdownGuard, MultiLevelKillSwitch

T0 = 1_760_000_000_000


def _runner() -> LivePaperRunner:
    runner = LivePaperRunner(session=PaperTradingSession(initial_balance=10_000.0))
    runner.risk_per_trade_pct = 1.0
    runner.max_portfolio_heat_pct = 6.0
    runner.daily_dd_limit_pct = 3.0
    runner.confluence_threshold = 0.65
    return runner


def _enable_m4(runner: LivePaperRunner) -> None:
    runner.use_m4_risk_gates = True
    runner._m4_kill_switch = MultiLevelKillSwitch()
    runner._m4_day_guard = DailyDrawdownGuard(runner.daily_dd_limit_pct)
    runner._m4_sizer = PositionSizer(max_portfolio_heat_pct=runner.max_portfolio_heat_pct)


def test_gates_disabled_by_default_allow_entry():
    runner = _runner()
    assert runner.use_m4_risk_gates is False
    assert runner._m4_kill_switch is None
    assert runner._m4_check_entry() is None


def test_daily_dd_limit_blocks_entry():
    runner = _runner()
    _enable_m4(runner)
    now_ms = int(time.time() * 1000)
    runner._m4_day_guard.update(10_000.0, now_ms)   # база дня = 10k
    runner.session.realized_pnl = -400.0            # -4% при лимите 3%

    block = runner._m4_check_entry()

    assert block is not None and block[0] == "daily_dd_limit"
    assert "дневной DD-лимит" in block[1]


def test_kill_switch_blocks_and_logs_event():
    runner = _runner()
    _enable_m4(runner)
    runner._m4_kill_switch.update(10_000.0, T0)      # HWM
    runner._m4_day_guard.update(10_000.0, T0)
    runner.session.realized_pnl = -600.0             # -6% -> HALT_NEW

    block = runner._m4_check_entry()

    assert block is not None and block[0] == "kill_switch"
    assert runner._m4_kill_switch.active_level == "HALT_NEW"
    assert any(log["category"] == "M4_KILL_SWITCH" for log in runner.logs)


def test_portfolio_heat_blocks_entry():
    runner = _runner()
    _enable_m4(runner)
    # Открытый риск $550 (5.5%) + новый $100 (1%) = 6.5% > 6%
    runner.session.positions["ETHUSDT"] = SimpleNamespace(risk_amount=550.0, closed=False)

    block = runner._m4_check_entry()

    assert block is not None and block[0] == "portfolio_heat"
    assert "portfolio heat" in block[1]


def test_healthy_state_allows_entry():
    runner = _runner()
    _enable_m4(runner)
    runner.session.positions["ETHUSDT"] = SimpleNamespace(risk_amount=100.0, closed=False)

    assert runner._m4_check_entry() is None


def test_m4_status_block_in_get_status():
    runner = _runner()
    _enable_m4(runner)
    status = runner.get_status()

    assert status["m4_risk_gates"]["enabled"] is True
    assert status["m4_risk_gates"]["kill_switch_action"] == "none"
    assert status["m4_risk_gates"]["daily_dd_halted"] is False


def test_execute_unified_signal_forwards_quantity():
    from unittest.mock import patch

    from backend.app.engine.trade_contract import UnifiedTradeSignal

    session = PaperTradingSession(initial_balance=10_000.0)
    signal = UnifiedTradeSignal(
        symbol="BTCUSDT", timeframe="15m", timestamp=T0, direction="LONG",
        entry_type="LIMIT", entry_price=100.0, sl=99.0, tp1=102.0,
        expected_rr=2.0, leverage=1.0, risk_pct=1.0,
        strategy_type="confluence_ema", data_source="test", reason=["t"],
    )

    with patch.object(session, "execute_trade_signal", return_value={"status": "OK"}) as mocked:
        session.execute_unified_signal(signal, quantity=12.5)
        assert mocked.call_args.kwargs["quantity"] == 12.5

    with patch.object(session, "execute_trade_signal", return_value={"status": "OK"}) as mocked:
        session.execute_unified_signal(signal)
        assert mocked.call_args.kwargs["quantity"] is None
