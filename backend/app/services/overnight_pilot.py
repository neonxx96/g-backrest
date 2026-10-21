"""Three-symbol overnight orchestration for backtest, forecast and paper mode."""

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from backend.app.routers.backtest import BacktestRequest, BacktestParams, run_backtest
from backend.app.routers.ai_copilot import compute_probabilistic_forecast
from backend.app.services.deep_intent_logger import DeepIntentLogger
from backend.app.services.live_paper_runner import LivePaperRunner
from backend.app.services.paper_trading import PaperTradingSession
from backend.app.db.database import AsyncSessionLocal
from backend.app.db.models import OvernightPilotRun
from sqlalchemy import select


HISTORICAL_STRATEGIES = {"confluence_ema", "cvd_absorption", "cluster_volume_bounce", "diagnostics_lenient", "naked_test"}


class OvernightPilotConfig(BaseModel):
    symbol: str
    strategy_type: str
    timeframe: str = "15m"
    days: int = Field(14, ge=1, le=30)
    initial_capital: float = Field(10000.0, gt=0)
    risk_per_trade_pct: float = Field(1.0, gt=0, le=10)
    stop_loss_pct: float = Field(0.8, gt=0, le=50)
    take_profit_pct: float = Field(1.6, gt=0, le=200)
    leverage: float = Field(2.0, ge=1, le=125)
    duration_hours: float = Field(24.0, gt=0, le=168)
    min_density_usd: float = Field(500000.0, ge=0)
    volume_multiplier: float = Field(1.3, ge=0, le=20)
    use_atr_filter: bool = True
    use_cvd_filter: bool = True
    use_oi_filter: bool = False
    use_rsi_filter: bool = True
    use_multi_tp: bool = True
    use_trailing: bool = True
    trailing_pct: float = Field(0.5, gt=0, le=20)
    trailing_activation_pct: float = Field(0.0, ge=0, le=20)
    tp1_rr_ratio: float = Field(1.5, ge=0.5, le=10)
    tp2_rr_ratio: float = Field(2.8, ge=1, le=15)
    ai_control: bool = False

    def model_post_init(self, __context: Any) -> None:
        if self.strategy_type not in HISTORICAL_STRATEGIES:
            raise ValueError(f"overnight pilot supports historical strategies only: {sorted(HISTORICAL_STRATEGIES)}")


@dataclass
class PilotSession:
    config: OvernightPilotConfig
    session_id: Optional[str] = None
    backtest: Optional[Dict[str, Any]] = None
    forecast: Optional[Dict[str, Any]] = None
    runner: Optional[LivePaperRunner] = None
    error: Optional[str] = None
    started_at: Optional[int] = None
    paper_snapshot: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        paper = self.runner.get_status() if self.runner else self.paper_snapshot
        return {
            "symbol": self.config.symbol.upper(),
            "strategy_type": self.config.strategy_type,
            "config": self.config.model_dump(),
            "backtest": self.backtest,
            "forecast": self.forecast,
            "paper": paper,
            "error": self.error,
            "started_at": self.started_at,
            "session_id": paper.get("session_id") if paper else self.session_id,
        }


class OvernightPilotManager:
    def __init__(self) -> None:
        self.sessions: Dict[str, PilotSession] = {}
        self._forecast_tasks: Dict[str, asyncio.Task] = {}
        self._lock = asyncio.Lock()
        self.intent_logger = DeepIntentLogger()

    def _record_run_event(self, session: PilotSession, *, event_type: str, source: str, reason_code: str, reason: str, payload: Optional[Dict[str, Any]] = None) -> None:
        try:
            self.intent_logger.record_event(
                event_type=event_type,
                source=source,
                symbol=session.config.symbol,
                reason_code=reason_code,
                reason=reason,
                run_id=getattr(session, "run_id", None),
                session_id=session.session_id,
                config_fingerprint=getattr(session, "config_fingerprint", None),
                strategy=session.config.strategy_type,
                timeframe=session.config.timeframe,
                checks=[],
                observed={},
                trade_id=None,
                payload=payload,
            )
        except OSError:
            logger.exception("Unable to write %s telemetry for %s", source, session.config.symbol)

    @staticmethod
    def default_configs() -> List[OvernightPilotConfig]:
        return [
            OvernightPilotConfig(symbol="BTCUSDT", strategy_type="confluence_ema", timeframe="15m", risk_per_trade_pct=1.0, stop_loss_pct=0.8, take_profit_pct=1.6, leverage=2),
            OvernightPilotConfig(symbol="ETHUSDT", strategy_type="cvd_absorption", timeframe="15m", risk_per_trade_pct=0.75, stop_loss_pct=0.65, take_profit_pct=1.8, leverage=2),
            OvernightPilotConfig(symbol="SOLUSDT", strategy_type="cluster_volume_bounce", timeframe="5m", risk_per_trade_pct=0.5, stop_loss_pct=1.0, take_profit_pct=2.2, leverage=1),
        ]

    @staticmethod
    def diversified_paper_configs() -> List[OvernightPilotConfig]:
        """24-hour virtual-only version of the three-strategy night plan."""
        return [
            OvernightPilotConfig(symbol="BTCUSDT", strategy_type="confluence_ema", timeframe="15m", days=14, initial_capital=1000.0, risk_per_trade_pct=1.0, stop_loss_pct=0.8, take_profit_pct=1.6, leverage=2),
            OvernightPilotConfig(symbol="ETHUSDT", strategy_type="cvd_absorption", timeframe="15m", days=14, initial_capital=1000.0, risk_per_trade_pct=0.75, stop_loss_pct=0.65, take_profit_pct=1.8, leverage=2),
            OvernightPilotConfig(symbol="SOLUSDT", strategy_type="cluster_volume_bounce", timeframe="5m", days=14, initial_capital=1000.0, risk_per_trade_pct=0.5, stop_loss_pct=1.0, take_profit_pct=2.2, leverage=1),
        ]

    @staticmethod
    def diagnostics_lenient_configs() -> List[OvernightPilotConfig]:
        """Short, paper-only execution diagnostic using real Binance OHLCV."""
        common = {
            "strategy_type": "diagnostics_lenient",
            "timeframe": "5m",
            "days": 7,
            "risk_per_trade_pct": 0.25,
            "stop_loss_pct": 0.5,
            "take_profit_pct": 0.75,
            "leverage": 1.0,
            "duration_hours": 1.5,
            "min_density_usd": 0.0,
            "volume_multiplier": 0.5,
            "use_atr_filter": False,
            "use_cvd_filter": False,
            "use_oi_filter": False,
            "use_rsi_filter": False,
            "ai_control": False,
        }
        return [OvernightPilotConfig(symbol=symbol, **common) for symbol in ("BTCUSDT", "ETHUSDT", "SOLUSDT")]

    @staticmethod
    def naked_test_configs() -> List[OvernightPilotConfig]:
        """15-minute paper-only EMA-cross probe with every confirmation gate disabled."""
        common = {
            "strategy_type": "naked_test",
            "timeframe": "5m",
            "days": 7,
            "risk_per_trade_pct": 0.25,
            "stop_loss_pct": 0.5,
            "take_profit_pct": 0.75,
            "leverage": 1.0,
            "duration_hours": 0.25,
            "min_density_usd": 0.0,
            "volume_multiplier": 0.0,
            "use_atr_filter": False,
            "use_cvd_filter": False,
            "use_oi_filter": False,
            "use_rsi_filter": False,
            "ai_control": False,
        }
        return [OvernightPilotConfig(symbol=symbol, **common) for symbol in ("BTCUSDT", "ETHUSDT", "SOLUSDT")]

    @staticmethod
    def production_robust_configs() -> List[OvernightPilotConfig]:
        """Fee-aware 15m paper preset for the production paper pilot only."""
        common = {
            "strategy_type": "confluence_ema",
            "timeframe": "15m",
            "days": 30,
            "risk_per_trade_pct": 0.5,
            "leverage": 2.0,
            "stop_loss_pct": 0.8,
            "take_profit_pct": 2.2,
            "min_density_usd": 150000.0,
            "volume_multiplier": 1.25,
            "use_atr_filter": True,
            "use_cvd_filter": True,
            "use_oi_filter": False,
            "use_rsi_filter": True,
            "use_multi_tp": True,
            "use_trailing": True,
            "trailing_pct": 0.5,
            "trailing_activation_pct": 0.5,
            "ai_control": False,
        }
        return [OvernightPilotConfig(symbol=symbol, **common) for symbol in ("BTCUSDT", "ETHUSDT", "SOLUSDT")]

    @staticmethod
    def optimal_live_configs() -> List[OvernightPilotConfig]:
        """Fee-aware 24h paper-only preset with a $1,000 virtual wallet per symbol."""
        common = {
            "strategy_type": "confluence_ema",
            "timeframe": "15m",
            "days": 30,
            "initial_capital": 1000.0,
            "risk_per_trade_pct": 0.5,
            "leverage": 2.0,
            "stop_loss_pct": 0.8,
            "take_profit_pct": 2.2,
            "min_density_usd": 150000.0,
            "volume_multiplier": 1.2,
            "use_atr_filter": True,
            "use_cvd_filter": True,
            "use_oi_filter": False,
            "use_rsi_filter": True,
            "use_multi_tp": True,
            "use_trailing": True,
            "trailing_pct": 0.5,
            "trailing_activation_pct": 0.5,
            "ai_control": False,
        }
        return [OvernightPilotConfig(symbol=symbol, **common) for symbol in ("BTCUSDT", "ETHUSDT", "SOLUSDT")]

    def set_preflight(self, symbol: str, backtest: Dict[str, Any], forecast: Dict[str, Any]) -> None:
        key = symbol.upper()
        session = self.sessions.get(key)
        if session is None:
            session = PilotSession(next(config for config in self.default_configs() if config.symbol == key))
            self.sessions[key] = session
        session.backtest = backtest
        session.forecast = forecast

    @staticmethod
    def _validate_configs(configs: Optional[List[OvernightPilotConfig]]) -> List[OvernightPilotConfig]:
        selected = configs or OvernightPilotManager.default_configs()
        if not 1 <= len(selected) <= 3:
            raise ValueError("overnight pilot accepts one to three sessions")
        symbols = [config.symbol.strip().upper() for config in selected]
        if len(set(symbols)) != len(symbols):
            raise ValueError("overnight pilot requires unique symbols")
        return selected

    def _has_running_sessions(self) -> bool:
        return any(session.runner and session.runner.is_running for session in self.sessions.values())

    async def _prepare(self, selected: List[OvernightPilotConfig]) -> None:
        """Run historical backtest and forecast only; never creates paper orders."""
        run_id = int(time.time())
        self.sessions = {
            config.symbol.strip().upper(): PilotSession(
                config,
                session_id=f"overnight_preflight_{config.symbol.strip().lower()}_{run_id}",
            )
            for config in selected
        }
        for session in self.sessions.values():
            try:
                req = BacktestRequest(
                    symbol=session.config.symbol,
                    timeframe=session.config.timeframe,
                    days=session.config.days,
                    strategy_type=session.config.strategy_type,
                    initial_capital=session.config.initial_capital,
                    params=BacktestParams(
                        risk_per_trade_pct=session.config.risk_per_trade_pct,
                        stop_loss_pct=session.config.stop_loss_pct,
                        take_profit_pct=session.config.take_profit_pct,
                        leverage=session.config.leverage,
                        min_density_usd=session.config.min_density_usd,
                        volume_multiplier=session.config.volume_multiplier,
                        use_atr_filter=session.config.use_atr_filter,
                        use_cvd_filter=session.config.use_cvd_filter,
                        use_oi_filter=session.config.use_oi_filter,
                        use_rsi_filter=session.config.use_rsi_filter,
                        use_multi_tp=session.config.use_multi_tp,
                        use_trailing=session.config.use_trailing,
                        trailing_pct=session.config.trailing_pct,
                        tp1_rr_ratio=session.config.tp1_rr_ratio,
                        tp2_rr_ratio=session.config.tp2_rr_ratio,
                    ),
                )
                session.backtest = await run_backtest(req)
                self._record_run_event(
                    session, event_type="BACKTEST_COMPLETED", source="backtest",
                    reason_code="BACKTEST_COMPLETED", reason="Historical backtest completed",
                    payload={"summary": session.backtest.get("summary") or {}, "data_engine": session.backtest.get("data_engine") or {}},
                )
                session.forecast = await compute_probabilistic_forecast(
                    session.config.symbol,
                    session.config.timeframe,
                    strategy_type=session.config.strategy_type,
                    strategy_params=session.config.model_dump(),
                )
                self._record_run_event(
                    session, event_type="FORECAST_UPDATED", source="forecast",
                    reason_code="FORECAST_UPDATED", reason="Preflight forecast generated",
                    payload={"data_status": session.forecast.get("data_status"),
                             "direction": (session.forecast.get("base_scenario") or {}).get("direction") or (session.forecast.get("unified_signal") or {}).get("direction"),
                             "updated_at": session.forecast.get("updated_at") or session.forecast.get("anchor_timestamp")},
                )
            except Exception as exc:
                session.error = str(exc)

    async def preflight(self, configs: Optional[List[OvernightPilotConfig]] = None) -> Dict[str, Any]:
        selected = self._validate_configs(configs)
        async with self._lock:
            if self._has_running_sessions():
                raise ValueError("overnight pilot is already running; stop all paper sessions before preflight")
            await self.stop()
            await self._prepare(selected)
        return self.status()

    async def start(self, configs: Optional[List[OvernightPilotConfig]] = None) -> Dict[str, Any]:
        selected = self._validate_configs(configs)
        async with self._lock:
            if self._has_running_sessions():
                raise ValueError("overnight pilot is already running; stop all paper sessions before starting again")
            await self.stop()
            matches_preflight = (
                set(self.sessions) == {config.symbol.strip().upper() for config in selected}
                and all(
                    self.sessions[symbol].config.model_dump() == config.model_dump()
                    and self.sessions[symbol].backtest is not None
                    and self.sessions[symbol].forecast is not None
                    for symbol, config in ((config.symbol.strip().upper(), config) for config in selected)
                )
            )
            if not matches_preflight:
                await self._prepare(selected)
            for session in self.sessions.values():
                try:
                    if session.error or session.backtest is None or session.forecast is None:
                        continue
                    paper_session = PaperTradingSession(initial_balance=session.config.initial_capital, session_id=f"overnight_{session.config.symbol.lower()}_{int(time.time())}")
                    session.session_id = paper_session.session_id
                    runner = LivePaperRunner(session=paper_session)
                    runner.intent_logger = self.intent_logger
                    session.runner = runner
                    session.started_at = int(time.time() * 1000)
                    runner.start(
                        session.config.model_dump(),
                        run_id=getattr(session, "run_id", None),
                        config_fingerprint=getattr(session, "config_fingerprint", None),
                    )
                    self._forecast_tasks[session.config.symbol.upper()] = asyncio.create_task(
                        self._forecast_loop(session),
                        name=f"overnight-forecast-{session.config.symbol.upper()}",
                    )
                except Exception as exc:
                    session.error = str(exc)
        return self.status()

    async def stop(self) -> Dict[str, Any]:
        for task in self._forecast_tasks.values():
            if not task.done():
                task.cancel()
        if self._forecast_tasks:
            await asyncio.gather(*self._forecast_tasks.values(), return_exceptions=True)
        self._forecast_tasks.clear()
        for session in self.sessions.values():
            if session.runner:
                session.runner.stop()
        return self.status()

    async def _forecast_loop(self, session: PilotSession) -> None:
        """Refresh the same parameterized forecast while paper mode observes live data."""
        while session.runner and session.runner.is_running:
            try:
                forecast = await compute_probabilistic_forecast(
                    session.config.symbol,
                    session.config.timeframe,
                    strategy_type=session.config.strategy_type,
                    strategy_params=session.config.model_dump(),
                )
                forecast["updated_at"] = int(time.time() * 1000)
                session.forecast = forecast
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                message = str(exc)[:180]
                session.error = f"Forecast refresh failed: {message}"
                if session.forecast is not None:
                    session.forecast = {
                        **session.forecast,
                        "data_status": "stale",
                        "last_data_error": message,
                        "updated_at": int(time.time() * 1000),
                    }
            await asyncio.sleep(300)

    def status(self) -> Dict[str, Any]:
        sessions = {key: session.to_dict() for key, session in self.sessions.items()}
        rows = []
        for item in sessions.values():
            summary = (item.get("backtest") or {}).get("summary") or {}
            trades = (item.get("backtest") or {}).get("trades") or []
            pnl_values = [float(trade.get("pnl_usd", trade.get("net_pnl", 0.0)) or 0.0) for trade in trades]
            paper = item.get("paper") or {}
            forecast = item.get("forecast") or {}
            base_scenario = forecast.get("base_scenario") or {}
            unified_signal = forecast.get("unified_signal") or {}
            trading_idea = forecast.get("trading_idea") or {}
            forecast_direction = (
                base_scenario.get("direction")
                or unified_signal.get("direction")
                or "NO_TRADE"
            )
            forecast_reason = (
                base_scenario.get("reason")
                or unified_signal.get("reason")
                or forecast.get("reason")
            )
            last_backtest_direction = str(trades[-1].get("direction", "")).upper() if trades else None
            paper_trades = paper.get("closed_trades") or []
            backtest_initial = float(item["config"].get("initial_capital", 0.0) or 0.0)
            backtest_net_pnl = float(summary.get("net_pnl_usd", 0.0) or 0.0)
            paper_pnl_values = [
                float(trade.get("net_pnl", trade.get("pnl_usd", 0.0)) or 0.0)
                for trade in paper_trades
            ]
            paper_gross_pnl = sum(float(trade.get("gross_pnl", 0.0) or 0.0) for trade in paper_trades)
            paper_gross_wins = sum(max(0.0, value) for value in paper_pnl_values)
            paper_gross_losses = abs(sum(min(0.0, value) for value in paper_pnl_values))
            forecast_backtest_divergence = bool(
                forecast_direction in ("LONG", "SHORT")
                and last_backtest_direction in ("LONG", "SHORT")
                and forecast_direction != last_backtest_direction
            )
            rows.append({
                "symbol": item["symbol"],
                "strategy_type": item["strategy_type"],
                "session_id": item.get("session_id"),
                "backtest_net_pnl": backtest_net_pnl,
                "backtest_roi_pct": round(backtest_net_pnl / backtest_initial * 100.0, 4) if backtest_initial else 0.0,
                "backtest_win_rate_pct": summary.get("win_rate_pct", 0.0),
                "backtest_profit_factor": summary.get("profit_factor", 0.0),
                "backtest_max_drawdown_pct": summary.get("max_drawdown_pct", 0.0),
                "backtest_trades": summary.get("total_trades", 0),
                "backtest_average_trade_usd": round(sum(pnl_values) / len(pnl_values), 2) if pnl_values else 0.0,
                "backtest_best_trade_usd": round(max(pnl_values), 2) if pnl_values else 0.0,
                "backtest_worst_trade_usd": round(min(pnl_values), 2) if pnl_values else 0.0,
                "forecast_direction": forecast_direction,
                "forecast_regime": forecast.get("market_regime") or forecast.get("regime"),
                "forecast_reason": forecast_reason or trading_idea.get("reasoning"),
                "forecast_confidence": base_scenario.get("confidence", forecast.get("confidence")),
                "forecast_entry": base_scenario.get("entry", forecast.get("entry", trading_idea.get("entry_price"))),
                "forecast_stop_loss": base_scenario.get("stop_loss", forecast.get("stop_loss", trading_idea.get("sl_price"))),
                "forecast_take_profit": base_scenario.get("take_profit", forecast.get("take_profit", trading_idea.get("tp2_price"))),
                "forecast_tp1": base_scenario.get("tp1", forecast.get("tp1", trading_idea.get("tp1_price"))),
                "forecast_tp2": base_scenario.get("tp2", forecast.get("tp2", trading_idea.get("tp2_price"))),
                "forecast_breakeven": base_scenario.get("breakeven", forecast.get("breakeven", trading_idea.get("breakeven_price"))),
                "forecast_updated_at": forecast.get("updated_at"),
                "forecast_no_trade_count": 1 if forecast_direction == "NO_TRADE" else 0,
                "forecast_data_status": forecast.get("data_status", "unknown"),
                "paper_equity": paper.get("current_equity"),
                "paper_starting_balance": paper.get("initial_capital", item["config"].get("initial_capital")),
                "paper_roi_pct": paper.get("roi_pct"),
                "paper_max_drawdown_pct": paper.get("max_drawdown_pct"),
                "paper_pnl": paper.get("realized_pnl"),
                "paper_gross_pnl": round(paper_gross_pnl, 2),
                "paper_total_fees": paper.get("total_fees", 0.0),
                "paper_unrealized_pnl": paper.get("unrealized_pnl"),
                "paper_closed_trades": len(paper_trades),
                "paper_win_rate_pct": round(
                    sum(1 for value in paper_pnl_values if value > 0) / len(paper_pnl_values) * 100.0,
                    2,
                ) if paper_pnl_values else 0.0,
                "paper_profit_factor": round(paper_gross_wins / paper_gross_losses, 4)
                if paper_gross_losses else (999.0 if paper_gross_wins else 0.0),
                "paper_average_trade_usd": round(sum(paper_pnl_values) / len(paper_pnl_values), 2)
                if paper_pnl_values else 0.0,
                "paper_best_trade_usd": round(max(paper_pnl_values), 2) if paper_pnl_values else 0.0,
                "paper_worst_trade_usd": round(min(paper_pnl_values), 2) if paper_pnl_values else 0.0,
                "paper_average_risk_pct": paper.get("average_risk_pct", item["config"].get("risk_per_trade_pct")),
                "paper_losing_trade_reasons": paper.get("losing_trade_reasons", []),
                "paper_data_status": paper.get("data_status", "unknown"),
                "paper_errors": paper.get("data_error_count", 0),
                "paper_consecutive_data_errors": paper.get("consecutive_data_errors"),
                "paper_last_data_error": paper.get("last_data_error"),
                "paper_last_data_error_at": paper.get("last_data_error_at"),
                "paper_last_successful_data_at": paper.get("last_successful_data_at"),
                "paper_reconnect_count": paper.get("reconnect_count"),
                "paper_indicator_status": paper.get("indicator_data_status"),
                "paper_indicator_freshness": paper.get("indicator_freshness"),
                "paper_indicator_data_age_ms": paper.get("indicator_data_age_ms"),
                "paper_entry_ready": paper.get("entry_ready"),
                "paper_telemetry_status": paper.get("telemetry_status"),
                "paper_no_trade_count": paper.get("no_trade_count", 0),
                "paper_evaluations": paper.get("evaluations"),
                "paper_blocked_evaluations": paper.get("blocked_evaluations"),
                "paper_filter_rejection_total": paper.get("filter_rejection_total"),
                "paper_rejection_counts": paper.get("rejection_counts", {}),
                "telemetry_events_by_source": self.intent_logger.count_by_source(item.get("run_id")),
                "paper_last_decision_reason": paper.get("last_decision_reason"),
                "paper_last_decision_checks": paper.get("last_decision_checks", []),
                "paper_last_decision_at": paper.get("last_decision_at"),
                "backtest_last_signal_direction": last_backtest_direction,
                "forecast_backtest_divergence": forecast_backtest_divergence,
                "error": item.get("error"),
            })
        return {
            "status": "ok",
            "sessions": sessions,
            "summary": rows,
            "aggregate": self._aggregate_report(sessions, rows),
        }

    @staticmethod
    def _aggregate_report(
        sessions: Dict[str, Dict[str, Any]],
        rows: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Build the morning report without mixing historical and live metrics."""

        def unique_extreme_symbol(items: List[Dict[str, Any]], field: str, *, highest: bool) -> Optional[str]:
            """Return a leader only when one symbol clearly wins the comparison."""
            if not items:
                return None
            values = [float(item.get(field, 0.0) or 0.0) for item in items]
            extreme = max(values) if highest else min(values)
            matches = [item for item, value in zip(items, values) if value == extreme]
            return matches[0].get("symbol") if len(matches) == 1 else None

        backtest_trades: List[Dict[str, Any]] = []
        backtest_net = 0.0
        backtest_initial = 0.0
        backtest_drawdown = 0.0
        for item in sessions.values():
            config = item.get("config") or {}
            summary = (item.get("backtest") or {}).get("summary") or {}
            trades = (item.get("backtest") or {}).get("trades") or []
            backtest_trades.extend(trades)
            backtest_net += float(summary.get("net_pnl_usd", 0.0) or 0.0)
            backtest_initial += float(config.get("initial_capital", 0.0) or 0.0)
            # Each session reports drawdown as a magnitude; tolerate legacy negative snapshots.
            backtest_drawdown = max(backtest_drawdown, abs(float(summary.get("max_drawdown_pct", 0.0) or 0.0)))

        backtest_wins = sum(1 for trade in backtest_trades if float(trade.get("pnl_usd", trade.get("net_pnl", 0.0)) or 0.0) > 0)
        gross_wins = sum(max(0.0, float(trade.get("pnl_usd", trade.get("net_pnl", 0.0)) or 0.0)) for trade in backtest_trades)
        gross_losses = abs(sum(min(0.0, float(trade.get("pnl_usd", trade.get("net_pnl", 0.0)) or 0.0)) for trade in backtest_trades))
        paper_items = [item.get("paper") for item in sessions.values() if item.get("paper") is not None]
        paper_trades = [
            trade
            for item in paper_items
            for trade in (item.get("closed_trades") or [])
        ]
        paper_pnl_values = [
            float(trade.get("net_pnl", trade.get("pnl_usd", 0.0)) or 0.0)
            for trade in paper_trades
        ]
        paper_losing_trade_reasons = [
            str(trade.get("exit_reason") or trade.get("reason") or "UNKNOWN")
            for trade in paper_trades
            if float(trade.get("net_pnl", trade.get("pnl_usd", 0.0)) or 0.0) < 0
        ]
        paper_wins = sum(1 for value in paper_pnl_values if value > 0)
        paper_gross_wins = sum(max(0.0, value) for value in paper_pnl_values)
        paper_gross_losses = abs(sum(min(0.0, value) for value in paper_pnl_values))
        paper_initial = sum(float(item.get("initial_capital", 0.0) or 0.0) for item in paper_items)
        paper_equity = sum(float(item.get("current_equity", 0.0) or 0.0) for item in paper_items)
        paper_net = sum(float(item.get("realized_pnl", 0.0) or 0.0) for item in paper_items) if paper_items else None
        paper_unrealized = sum(float(item.get("unrealized_pnl", 0.0) or 0.0) for item in paper_items) if paper_items else None
        paper_closed_trades = sum(int(item.get("closed_trades_count", 0) or 0) for item in paper_items)
        paper_drawdown = max(
            (abs(float(item.get("max_drawdown_pct", 0.0) or 0.0)) for item in paper_items),
            default=None,
        )
        paper_risk_values = []
        for session_item in sessions.values():
            paper_item = session_item.get("paper")
            if paper_item is None:
                continue
            configured_risk = (session_item.get("config") or {}).get("risk_per_trade_pct")
            risk_value = paper_item.get("average_risk_pct", configured_risk)
            if risk_value is not None:
                paper_risk_values.append(float(risk_value or 0.0))
        forecast_no_trade = sum(int(row.get("forecast_no_trade_count", 0) or 0) for row in rows)
        forecast_no_trade_reasons = {
            row["symbol"]: row.get("forecast_reason")
            for row in rows
            if row.get("forecast_direction") == "NO_TRADE" and row.get("forecast_reason")
        }
        paper_no_trade = sum(int(row.get("paper_no_trade_count", 0) or 0) for row in rows)
        telemetry_sources: Dict[str, int] = {"backtest": 0, "forecast": 0, "paper": 0, "system": 0}
        for row in rows:
            for source, count in (row.get("telemetry_events_by_source") or {}).items():
                telemetry_sources[str(source)] = telemetry_sources.get(str(source), 0) + int(count or 0)
        paper_rejection_counts: Dict[str, int] = {}
        for row in rows:
            for reason, count in (row.get("paper_rejection_counts") or {}).items():
                paper_rejection_counts[str(reason)] = paper_rejection_counts.get(str(reason), 0) + int(count or 0)
        error_count = sum(int(row.get("paper_errors", 0) or 0) for row in rows)
        paper_rows = [
            row
            for row in rows
            if row.get("paper_pnl") is not None and int(row.get("paper_closed_trades", 0) or 0) > 0
        ]
        return {
            "backtest": {
                "net_pnl_usd": round(backtest_net, 2),
                "roi_pct": round(backtest_net / backtest_initial * 100.0, 4) if backtest_initial else 0.0,
                "trades": len(backtest_trades),
                "win_rate_pct": round(backtest_wins / len(backtest_trades) * 100.0, 2) if backtest_trades else 0.0,
                "profit_factor": round(gross_wins / gross_losses, 4) if gross_losses else (None if not gross_wins else None),
                "max_drawdown_pct": round(backtest_drawdown, 4),
            },
            "forecast": {
                "no_trade_count": forecast_no_trade,
                "no_trade_reasons": forecast_no_trade_reasons,
                "direction_counts": {
                    direction: sum(1 for row in rows if row.get("forecast_direction") == direction)
                    for direction in ("LONG", "SHORT", "NO_TRADE")
                },
            },
            "paper": {
                "available": bool(paper_items),
                "starting_balance": round(paper_initial, 2) if paper_items else None,
                "equity": round(paper_equity, 2) if paper_items else None,
                "net_pnl_usd": round(paper_net, 2) if paper_net is not None else None,
                "unrealized_pnl_usd": round(paper_unrealized, 2) if paper_unrealized is not None else None,
                "roi_pct": round(paper_net / paper_initial * 100.0, 4) if paper_net is not None and paper_initial else None,
                "closed_trades": paper_closed_trades,
                "win_rate_pct": round(paper_wins / len(paper_pnl_values) * 100.0, 2)
                if paper_pnl_values else 0.0,
                "profit_factor": round(paper_gross_wins / paper_gross_losses, 4)
                if paper_gross_losses else (999.0 if paper_gross_wins else 0.0),
                "average_trade_usd": round(sum(paper_pnl_values) / len(paper_pnl_values), 2)
                if paper_pnl_values else 0.0,
                "best_trade_usd": round(max(paper_pnl_values), 2) if paper_pnl_values else 0.0,
                "worst_trade_usd": round(min(paper_pnl_values), 2) if paper_pnl_values else 0.0,
                "max_drawdown_pct": round(paper_drawdown, 4) if paper_drawdown is not None else None,
                "average_risk_pct": round(sum(paper_risk_values) / len(paper_risk_values), 4) if paper_risk_values else None,
                "no_trade_count": paper_no_trade,
                "rejection_counts": dict(sorted(paper_rejection_counts.items(), key=lambda item: (-item[1], item[0]))),
                "losing_trade_reasons": paper_losing_trade_reasons[-20:],
            },
            "data": {"error_count": error_count, "statuses": {row["symbol"]: row.get("paper_data_status") or row.get("forecast_data_status") for row in rows}},
            "telemetry": {"events_by_source": telemetry_sources},
            "best_backtest_symbol": unique_extreme_symbol(rows, "backtest_net_pnl", highest=True),
            "worst_backtest_symbol": unique_extreme_symbol(rows, "backtest_net_pnl", highest=False),
            "best_paper_symbol": unique_extreme_symbol(paper_rows, "paper_pnl", highest=True),
            "worst_paper_symbol": unique_extreme_symbol(paper_rows, "paper_pnl", highest=False),
        }

    async def persist(self) -> None:
        """Persist configs and latest snapshots without storing market data."""
        async with AsyncSessionLocal() as db:
            for item in self.status()["sessions"].values():
                paper = item.get("paper") or {}
                session_id = item.get("session_id") or paper.get("session_id")
                if not session_id:
                    continue
                result = await db.execute(select(OvernightPilotRun).where(OvernightPilotRun.session_id == session_id))
                row = result.scalar_one_or_none()
                if row is None:
                    row = OvernightPilotRun(session_id=session_id, symbol=item["symbol"], strategy_type=item["strategy_type"])
                    db.add(row)
                row.symbol = item["symbol"]
                row.strategy_type = item["strategy_type"]
                row.config_json = json.dumps(item.get("config") or {}, ensure_ascii=False)
                row.backtest_json = json.dumps(item.get("backtest"), ensure_ascii=False) if item.get("backtest") is not None else None
                row.forecast_json = json.dumps(item.get("forecast"), ensure_ascii=False) if item.get("forecast") is not None else None
                row.paper_json = json.dumps(paper, ensure_ascii=False) if paper else None
                row.is_running = bool(paper.get("is_running", False))
            await db.commit()

    async def restore(self) -> None:
        """Restore the latest pilot snapshots after a backend restart.

        A restored snapshot is intentionally marked stale and is not presented
        as a live runner. The operator can explicitly start a new live paper
        loop after verifying the feed and configuration.
        """
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(OvernightPilotRun).order_by(OvernightPilotRun.updated_at.desc()))
            rows = result.scalars().all()
        restored: Dict[str, PilotSession] = {}
        for row in rows:
            if row.symbol.upper() in restored or len(restored) >= 3:
                continue
            try:
                config = OvernightPilotConfig.model_validate(json.loads(row.config_json or "{}"))
                paper = json.loads(row.paper_json) if row.paper_json else None
                if paper:
                    paper["is_running"] = False
                    paper["data_status"] = "stale"
                    paper["last_data_error"] = "Backend restarted; start the pilot to resume live paper data"
                restored[row.symbol.upper()] = PilotSession(
                    config=config,
                    session_id=row.session_id,
                    backtest=json.loads(row.backtest_json) if row.backtest_json else None,
                    forecast=json.loads(row.forecast_json) if row.forecast_json else None,
                    paper_snapshot=paper,
                    error=None,
                )
            except Exception:
                continue
        if restored:
            self.sessions = restored


overnight_pilot_manager = OvernightPilotManager()
