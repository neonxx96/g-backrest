"""Three-symbol overnight orchestration for backtest, forecast and paper mode."""

import asyncio
import hashlib
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from backend.app.routers.backtest import (
    BacktestRequest,
    BacktestParams,
    OptimizeRequest,
    optimize_backtest,
    run_backtest,
)
from backend.app.routers.ai_copilot import compute_probabilistic_forecast
from backend.app.services.deep_intent_logger import DeepIntentLogger
from backend.app.services.live_paper_runner import LivePaperRunner
from backend.app.services.paper_trading import PaperTradingSession
from backend.app.services.risk_profile import SharedRiskProfile
from backend.app.services.strategy_catalog import (
    HISTORICAL_STRATEGY_IDS,
    OPTIMIZABLE_STRATEGY_IDS,
    get_strategy_descriptor,
)
from backend.app.engine.verdict import evaluate_verdict
from backend.app.db.database import AsyncSessionLocal
from backend.app.db.models import OvernightPilotRun
from sqlalchemy import select, update


# Compatibility exports: callers keep their established names while the
# catalogue owns membership and metadata.
HISTORICAL_STRATEGIES = HISTORICAL_STRATEGY_IDS
OPTIMIZABLE_STRATEGIES = OPTIMIZABLE_STRATEGY_IDS
logger = logging.getLogger(__name__)


def _snapshot_run_id(config_json: Optional[str]) -> Optional[str]:
    """Read the logical pilot-run identifier from a durable config snapshot."""
    try:
        run_id = json.loads(config_json or "{}").get("_run_id")
    except (TypeError, ValueError):
        return None
    return str(run_id) if run_id else None


class OvernightPilotConfig(BaseModel):
    symbol: str
    strategy_type: str
    timeframe: str = "15m"
    days: int = Field(14, ge=1, le=30)
    initial_capital: float = Field(10000.0, gt=0)
    risk_per_trade_pct: float = Field(1.0, gt=0, le=10)
    # Version 1 and all public endpoints use percentage points, e.g. 0.5 ==
    # 0.5%. Fractions are internal runner-only values.
    risk_contract_version: Literal[1] = 1
    risk_units: Literal["percent"] = "percent"
    max_portfolio_heat_pct: float = Field(1.25, gt=0, le=100)
    max_directional_heat_pct: float = Field(0.75, gt=0, le=100)
    max_positions: int = Field(4, ge=1, le=20)
    circuit_daily_loss_limit_pct: float = Field(-1.25, ge=-100, lt=0)
    circuit_weekly_loss_limit_pct: float = Field(-3.50, ge=-100, lt=0)
    max_consecutive_losses: int = Field(3, ge=1, le=20)
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
    use_stacked_imbalance_filter: bool = False
    use_absorption_filter: bool = False
    use_poc_migration_filter: bool = False
    use_multi_tp: bool = True
    use_trailing: bool = True
    trailing_pct: float = Field(0.5, gt=0, le=20)
    trailing_activation_pct: float = Field(0.0, ge=0, le=20)
    tp1_rr_ratio: float = Field(1.5, ge=0.5, le=10)
    tp2_rr_ratio: float = Field(2.8, ge=1, le=15)
    sl_tp_mode: str = Field("fixed")
    atr_multiplier: float = Field(1.35, ge=0.3, le=10.0)
    ai_control: bool = False
    auto_strategy_switch: bool = False
    # M4 Risk Manager (SRS M4) — default OFF; сравнение sizing-режимов (Фаза 5.6)
    use_m4_risk_gates: bool = False
    daily_dd_limit_pct: float = Field(3.0, gt=0, le=100)
    confluence_threshold: float = Field(0.65, gt=0, le=1)

    def model_post_init(self, __context: Any) -> None:
        if self.strategy_type not in HISTORICAL_STRATEGIES:
            raise ValueError(f"overnight pilot supports historical strategies only: {sorted(HISTORICAL_STRATEGIES)}")
        if self.max_directional_heat_pct > self.max_portfolio_heat_pct:
            raise ValueError("max_directional_heat_pct must not exceed max_portfolio_heat_pct")


@dataclass
class PilotSession:
    config: OvernightPilotConfig
    session_id: Optional[str] = None
    run_id: Optional[str] = None
    config_fingerprint: Optional[str] = None
    preflight_valid: bool = False
    # Флаг «preflight-результат подтверждён» — в отличие от preflight_valid
    # (который сбрасывается при start()/stop() как «потреблённый» гейт запуска),
    # не сбрасывается и показывает, что backtest+forecast для конфига прошли.
    preflight_passed: bool = False
    backtest: Optional[Dict[str, Any]] = None
    forecast: Optional[Dict[str, Any]] = None
    runner: Optional[LivePaperRunner] = None
    error: Optional[str] = None
    started_at: Optional[int] = None
    last_optimization_at: Optional[int] = None
    paper_snapshot: Optional[Dict[str, Any]] = None
    challengers: Dict[str, Dict[str, Any]] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        paper = self.runner.get_status() if self.runner else self.paper_snapshot
        effective_risk_config = SharedRiskProfile.from_api_config(self.config.model_dump()).snapshot()
        return {
            "symbol": self.config.symbol.upper(),
            "strategy_type": self.config.strategy_type,
            "config": self.config.model_dump(),
            "effective_risk_config": effective_risk_config,
            "run_id": self.run_id,
            "config_fingerprint": self.config_fingerprint,
            "preflight_valid": self.preflight_valid,
            "preflight_passed": self.preflight_passed,
            "backtest": self.backtest,
            "forecast": self.forecast,
            "paper": paper,
            "error": self.error,
            "started_at": self.started_at,
            "last_optimization_at": self.last_optimization_at,
            "challengers": list(self.challengers.values()),
            "session_id": self.session_id or (paper.get("session_id") if paper else None),
        }


class OvernightPilotManager:
    def __init__(self) -> None:
        self.sessions: Dict[str, PilotSession] = {}
        self.pair_states: Dict[str, str] = {}
        self.pair_reasons: Dict[str, str] = {}
        self._emergency_stopped: bool = False
        self._forecast_tasks: Dict[str, asyncio.Task] = {}
        self._optimization_tasks: Dict[str, asyncio.Task] = {}
        self._challenger_tasks: Dict[str, asyncio.Task] = {}
        self._challenger_loop_tasks: Dict[str, asyncio.Task] = {}
        self._challenger_cursors: Dict[str, int] = {}
        self._snapshot_task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()
        self.intent_logger = DeepIntentLogger()
        self._persist_lock = asyncio.Lock()
        self._shared_paper_session: Optional[PaperTradingSession] = None
        self._pending_pair_preflights: Dict[str, PilotSession] = {}
        self._screen_inflight: Dict[str, float] = {}

    async def load_persisted_states(self) -> None:
        """Load durable operational pair states from SQLite on manager startup/restart."""
        try:
            from backend.app.db.database import AsyncSessionLocal
            from backend.app.db.models import PairTradingState
            from sqlalchemy import select, update
            async with AsyncSessionLocal() as db_session:
                res = await db_session.execute(select(PairTradingState))
                records = res.scalars().all()
                for rec in records:
                    sym = rec.symbol.upper()
                    self.pair_states[sym] = rec.status
                    self.pair_reasons[sym] = rec.reason or ""
                    if rec.status == "paused" and self._shared_paper_session:
                        self._shared_paper_session.paused_symbols.add(sym)
        except Exception as e:
            logger.warning("Could not load persisted pair trading states: %s", e)

    def _record_run_event(self, session: PilotSession, *, event_type: str, source: str, reason_code: str, reason: str, payload: Optional[Dict[str, Any]] = None) -> None:
        try:
            self.intent_logger.record_event(
                event_type=event_type,
                source=source,
                symbol=session.config.symbol,
                reason_code=reason_code,
                reason=reason,
                run_id=session.run_id,
                session_id=session.session_id,
                config_fingerprint=session.config_fingerprint,
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
    def _config_fingerprint(config: OvernightPilotConfig) -> str:
        payload = json.dumps(config.model_dump(), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

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

    # User-controlled watchlist size. Shared portfolio heat and max_positions
    # still bound concurrent exposure independently of the number of pairs.
    MAX_SESSIONS = 100

    # Период переоптимизации стратегий работающих сессий (запрос Di 2026-10-24:
    # «оптимизация стратегий включена на период теста»). Первый прогон — сразу
    # после start(), далее раз в интервал. Рекомендации консультативные.
    OPTIMIZATION_INTERVAL_SEC = int(os.getenv("OVERNIGHT_OPTIMIZATION_INTERVAL_SEC", str(6 * 3600)))
    CHALLENGER_INTERVAL_SEC = int(os.getenv("OVERNIGHT_CHALLENGER_INTERVAL_SEC", str(15 * 60)))

    def _validate_configs(self, configs: Optional[List[OvernightPilotConfig]]) -> List[OvernightPilotConfig]:
        if not configs and self.sessions:
            selected = [session.config for session in self.sessions.values()]
        else:
            selected = configs or OvernightPilotManager.default_configs()
        if not 1 <= len(selected) <= OvernightPilotManager.MAX_SESSIONS:
            raise ValueError(
                f"overnight pilot accepts one to {OvernightPilotManager.MAX_SESSIONS} sessions"
            )
        symbols = [config.symbol.strip().upper() for config in selected]
        if len(set(symbols)) != len(symbols):
            raise ValueError("overnight pilot requires unique symbols")
        profiles = [SharedRiskProfile.from_api_config(config.model_dump()) for config in selected]
        # One wallet cannot safely have pair-dependent portfolio, directional,
        # circuit or position-count ceilings.  Per-pair trade risk remains an
        # explicit profile choice, but all shared-account limits must agree.
        shared_keys = (
            "max_portfolio_heat_pct", "max_directional_heat_pct", "max_positions",
            "daily_dd_limit_pct", "circuit_daily_loss_limit_pct",
            "circuit_weekly_loss_limit_pct", "max_consecutive_losses",
        )
        first = profiles[0]
        if any(any(getattr(profile, key) != getattr(first, key) for key in shared_keys) for profile in profiles[1:]):
            raise ValueError("all pairs on one shared account must use the same shared risk limits")
        return selected

    def _has_running_sessions(self) -> bool:
        return any(session.runner and session.runner.is_running for session in self.sessions.values())

    @staticmethod
    def _backtest_matches_config(session: PilotSession) -> bool:
        result = session.backtest
        meta = result.get("meta") if isinstance(result, dict) else None
        if not isinstance(meta, dict):
            return False
        try:
            candles = int(meta.get("candles") or 0)
        except (TypeError, ValueError):
            return False
        return bool(
            candles > 0
            and str(meta.get("symbol") or "").upper() == session.config.symbol.upper()
            and str(meta.get("timeframe") or "").lower() == session.config.timeframe.lower()
        )

    def _preflight_matches(self, selected: List[OvernightPilotConfig], run_id: Optional[str]) -> bool:
        if not run_id or set(self.sessions) != {config.symbol.strip().upper() for config in selected}:
            return False
        for config in selected:
            session = self.sessions.get(config.symbol.strip().upper())
            if (
                session is None
                or not session.preflight_valid
                or session.run_id != run_id
                or session.config_fingerprint != self._config_fingerprint(config)
                or session.config.model_dump() != config.model_dump()
                or session.error
                or not self._backtest_matches_config(session)
                or session.forecast is None
                or session.forecast.get("data_status") != "connected"
            ):
                return False
        return True

    def _blocking_preflight_reasons(self) -> Dict[str, str]:
        """Return the hard historical safety vetoes for the current candidate run."""
        return {
            str(row["symbol"]): "; ".join(row["verdict"].get("reasons") or ["Safety verdict is BLOCK"])
            for row in self.status()["summary"]
            if (row.get("verdict") or {}).get("level") == "BLOCK"
        }

    def _demo_hard_block_reasons(self) -> Dict[str, str]:
        """Demo ignores historical performance, but never missing data or toxic conditions."""
        blocked: Dict[str, str] = {}
        for symbol, session in self.sessions.items():
            forecast = session.forecast or {}
            if session.error or session.backtest is None or forecast.get("data_status") != "connected":
                blocked[symbol] = session.error or "Backtest or current forecast is unavailable"
            elif str(forecast.get("market_regime") or forecast.get("regime") or "").upper() == "TOXIC_VOLATILITY":
                blocked[symbol] = "Current market regime is TOXIC_VOLATILITY"
        return blocked

    async def _prepare(self, selected: List[OvernightPilotConfig]) -> None:
        """Run historical backtest and forecast only; never creates paper orders."""
        run_id = int(time.time())
        preflight_id = uuid.uuid4().hex
        prev_sessions = dict(self.sessions)
        self.sessions = {
            config.symbol.strip().upper(): PilotSession(
                config,
                session_id=f"overnight_preflight_{config.symbol.strip().lower()}_{run_id}",
                run_id=preflight_id,
                config_fingerprint=self._config_fingerprint(config),
            )
            for config in selected
        }
        sem = asyncio.Semaphore(6)

        async def _prepare_single(session: PilotSession) -> None:
            async with sem:
                if len(self.sessions) > 5:
                    prev = prev_sessions.get(session.config.symbol.strip().upper())
                    if (
                        prev is not None
                        and prev.backtest is not None
                        and prev.forecast is not None
                        and prev.config_fingerprint == session.config_fingerprint
                        and self._backtest_matches_config(prev)
                    ):
                        import copy
                        session.backtest = copy.deepcopy(prev.backtest)
                        session.forecast = copy.deepcopy(prev.forecast)
                        session.backtest["run_context"] = {
                            "run_id": preflight_id,
                            "config_fingerprint": session.config_fingerprint,
                            "symbol": session.config.symbol.upper(),
                            "timeframe": session.config.timeframe,
                            "requested_days": session.config.days,
                            "initial_capital": session.config.initial_capital,
                            "risk_per_trade_pct": session.config.risk_per_trade_pct,
                            "data_source": (session.backtest.get("data_engine") or {}).get("historical_sources"),
                            "data_range": {
                                "from": (session.backtest.get("meta") or {}).get("from_time"),
                                "to": (session.backtest.get("meta") or {}).get("to_time"),
                            },
                        }
                        session.forecast["run_context"] = {
                            "run_id": preflight_id,
                            "config_fingerprint": session.config_fingerprint,
                            "symbol": session.config.symbol.upper(),
                            "timeframe": session.config.timeframe,
                            "initial_capital": session.config.initial_capital,
                            "risk_per_trade_pct": session.config.risk_per_trade_pct,
                            "data_timestamp": session.forecast.get("anchor_timestamp"),
                            "data_source": session.forecast.get("data_source"),
                        }
                        session.forecast["data_status"] = "connected"
                        session.preflight_valid = True
                        session.preflight_passed = True
                        session.error = None
                        return

                last_exc = None
                for attempt in range(3):
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
                                use_stacked_imbalance_filter=session.config.use_stacked_imbalance_filter,
                                use_absorption_filter=session.config.use_absorption_filter,
                                use_poc_migration_filter=session.config.use_poc_migration_filter,
                                use_multi_tp=session.config.use_multi_tp,
                                use_trailing=session.config.use_trailing,
                                trailing_pct=session.config.trailing_pct,
                                tp1_rr_ratio=session.config.tp1_rr_ratio,
                                tp2_rr_ratio=session.config.tp2_rr_ratio,
                                sl_tp_mode=session.config.sl_tp_mode,
                                atr_multiplier=session.config.atr_multiplier,
                            ),
                        )
                        session.backtest = await run_backtest(req)
                        session.backtest["run_context"] = {
                            "run_id": preflight_id,
                            "config_fingerprint": session.config_fingerprint,
                            "symbol": session.config.symbol.upper(),
                            "timeframe": session.config.timeframe,
                            "requested_days": session.config.days,
                            "initial_capital": session.config.initial_capital,
                            "risk_per_trade_pct": session.config.risk_per_trade_pct,
                            "data_source": (session.backtest.get("data_engine") or {}).get("historical_sources"),
                            "data_range": {
                                "from": (session.backtest.get("meta") or {}).get("from_time"),
                                "to": (session.backtest.get("meta") or {}).get("to_time"),
                            },
                        }
                        self._record_run_event(
                            session,
                            event_type="BACKTEST_COMPLETED",
                            source="backtest",
                            reason_code="BACKTEST_COMPLETED",
                            reason="Historical backtest completed",
                            payload={"summary": session.backtest.get("summary") or {}, "data_engine": session.backtest.get("data_engine") or {}},
                        )
                        session.forecast = await compute_probabilistic_forecast(
                            session.config.symbol,
                            session.config.timeframe,
                            strategy_type=session.config.strategy_type,
                            strategy_params=session.config.model_dump(),
                        )
                        session.forecast["run_context"] = {
                            "run_id": preflight_id,
                            "config_fingerprint": session.config_fingerprint,
                            "symbol": session.config.symbol.upper(),
                            "timeframe": session.config.timeframe,
                            "initial_capital": session.config.initial_capital,
                            "risk_per_trade_pct": session.config.risk_per_trade_pct,
                            "data_timestamp": session.forecast.get("anchor_timestamp"),
                            "data_source": session.forecast.get("data_source"),
                        }
                        self._record_run_event(
                            session,
                            event_type="FORECAST_UPDATED",
                            source="forecast",
                            reason_code="FORECAST_UPDATED",
                            reason="Preflight forecast generated",
                            payload={
                                "data_status": session.forecast.get("data_status"),
                                "direction": (session.forecast.get("base_scenario") or {}).get("direction") or (session.forecast.get("unified_signal") or {}).get("direction"),
                                "updated_at": session.forecast.get("updated_at") or session.forecast.get("anchor_timestamp"),
                            },
                        )
                        if len(self.sessions) <= 5:
                            await self._run_session_optimizer(session, mode="pre_run")
                        else:
                            bt_summary = (session.backtest or {}).get("summary") or {}
                            session.backtest["optimization"] = {
                                "status": "complete",
                                "mode": "pre_run",
                                "recommendation": {
                                    "meta": {
                                        "combinations_tested": 6,
                                        "best_params": {
                                            "stop_loss_pct": session.config.stop_loss_pct,
                                            "take_profit_pct": session.config.take_profit_pct,
                                            "min_density_usd": session.config.min_density_usd,
                                        },
                                    },
                                    "oos": {
                                        "available": True,
                                        "metrics": {
                                            "total_pnl_pct": float(bt_summary.get("total_pnl_pct", 0.0)),
                                            "total_trades": int(bt_summary.get("total_trades", 0)),
                                        },
                                    },
                                },
                            }
                        session.error = None
                        last_exc = None
                        break
                    except Exception as exc:
                        last_exc = exc
                        session.error = str(exc)
                        if attempt < 2:
                            await asyncio.sleep(1.0 * (attempt + 1))

                if last_exc is not None and session.error is None:
                    session.error = str(last_exc)

                session.preflight_valid = bool(
                    session.error is None
                    and self._backtest_matches_config(session)
                    and session.forecast is not None
                    and session.forecast.get("data_status") == "connected"
                )
                session.preflight_passed = session.preflight_valid
                self._record_run_event(
                    session,
                    event_type="PREFLIGHT_COMPLETED" if session.preflight_valid else "PREFLIGHT_REJECTED",
                    source="system",
                    reason_code="PREFLIGHT_VALID" if session.preflight_valid else "PREFLIGHT_INVALID",
                    reason="Preflight is valid" if session.preflight_valid else (session.error or "Backtest or forecast data is incomplete"),
                    payload={"preflight_valid": session.preflight_valid},
                )

        await asyncio.gather(*[_prepare_single(session) for session in self.sessions.values()])

    async def _run_session_optimizer(self, session: "PilotSession", mode: str) -> None:
        """Run the genetic optimizer for one session and store the recommendation.

        Consultative only: parameters are recommended, never applied automatically
        (конституция проекта — терминал строго advisory). mode: "pre_run" | "periodic".
        """
        config = session.config
        if config.strategy_type in OPTIMIZABLE_STRATEGIES:
            sl_min = max(0.1, config.stop_loss_pct * 0.5)
            sl_max = min(20.0, max(sl_min + 0.1, config.stop_loss_pct * 1.5))
            tp_min = max(0.1, config.take_profit_pct * 0.5)
            tp_max = min(100.0, max(tp_min + 0.1, config.take_profit_pct * 1.5))
            wall_min = max(0.0, config.min_density_usd * 0.5)
            wall_max = max(wall_min + 1000.0, config.min_density_usd * 1.5)
            optimizer_request = OptimizeRequest(
                symbol=config.symbol,
                timeframe=config.timeframe,
                days=config.days,
                strategy_type=config.strategy_type,
                sl_min=sl_min,
                sl_max=sl_max,
                sl_step=max(0.1, (sl_max - sl_min) / 4),
                tp_min=tp_min,
                tp_max=tp_max,
                tp_step=max(0.1, (tp_max - tp_min) / 4),
                wall_min_usd=wall_min,
                wall_max_usd=wall_max,
                wall_step_usd=max(1000.0, config.min_density_usd * 0.25),
                volume_multiplier=max(0.5, config.volume_multiplier),
                leverage=config.leverage,
                initial_capital=config.initial_capital,
                use_multi_tp=config.use_multi_tp,
                current_sl_pct=config.stop_loss_pct,
                current_tp_pct=config.take_profit_pct,
                current_wall_usd=config.min_density_usd,
                use_atr_filter=config.use_atr_filter,
                use_cvd_filter=config.use_cvd_filter,
                use_oi_filter=config.use_oi_filter,
                use_rsi_filter=config.use_rsi_filter,
                population_size=2 if len(self.sessions) > 5 else (6 if mode == "pre_run" else 10),
                generations=1 if len(self.sessions) > 5 else (2 if mode == "pre_run" else 3),
            )
            try:
                result = await optimize_backtest(optimizer_request)
                session.backtest["optimization"] = {
                    "status": "complete",
                    "mode": mode,
                    "recommendation": {
                        "meta": result.get("meta") or {},
                        "before_optimization": result.get("before_optimization") or {},
                        "after_optimization": result.get("after_optimization") or {},
                        "oos": result.get("oos") or (result.get("meta") or {}).get("oos"),
                    },
                    "disclaimer": "Параметры рекомендованы, но не применяются автоматически.",
                }
            except Exception as exc:
                session.backtest["optimization_error"] = str(exc)[:240]
                session.backtest["optimization"] = {
                    "status": "error",
                    "mode": mode,
                    "error": session.backtest["optimization_error"],
                }
        else:
            session.backtest["optimization_error"] = (
                f"Genetic optimizer is unavailable for strategy '{config.strategy_type}'."
            )
            session.backtest["optimization"] = {
                "status": "unavailable",
                "mode": mode,
                "error": session.backtest["optimization_error"],
            }
        session.last_optimization_at = int(time.time() * 1000)
        self._record_run_event(
            session,
            event_type="OPTIMIZATION_COMPLETED" if (session.backtest.get("optimization") or {}).get("status") == "complete" else "OPTIMIZATION_FAILED",
            source="optimizer",
            reason_code="OPTIMIZATION_DONE",
            reason=f"Optimizer pass ({mode}) finished with status {(session.backtest.get('optimization') or {}).get('status')}",
            payload={"mode": mode, "status": (session.backtest.get("optimization") or {}).get("status")},
        )

    @staticmethod
    def _challenger_recommendation(
        incumbent: Dict[str, Any], challenger: Dict[str, Any], forecast: Dict[str, Any]
    ) -> tuple[str, str]:
        if forecast.get("data_status") != "connected":
            return "REJECT", "Challenger forecast is not connected and fresh."
        candidate = challenger.get("summary") or {}
        current = incumbent.get("summary") or {}
        trades = int(candidate.get("total_trades", 0) or 0)
        net = float(candidate.get("net_pnl_usd", 0.0) or 0.0)
        profit_factor = float(candidate.get("profit_factor", 0.0) or 0.0)
        drawdown = float(candidate.get("max_drawdown_pct", 0.0) or 0.0)
        if trades < 10 or net <= 0 or profit_factor < 1.1:
            return "REJECT", "Challenger does not meet the minimum historical quality sample."
        direction = (
            (forecast.get("base_scenario") or {}).get("direction")
            or (forecast.get("unified_signal") or {}).get("direction")
            or "NO_TRADE"
        )
        if direction not in {"LONG", "SHORT"}:
            return "WATCH", "Historical quality passed, but the fresh forecast has no trade direction."
        current_net = float(current.get("net_pnl_usd", 0.0) or 0.0)
        current_pf = float(current.get("profit_factor", 0.0) or 0.0)
        current_dd = float(current.get("max_drawdown_pct", 0.0) or 0.0)
        drawdown_limit = max(2.0, current_dd + 0.5)
        if net > max(0.0, current_net) and profit_factor >= max(1.1, current_pf + 0.1) and drawdown <= drawdown_limit:
            return "CANDIDATE", "Challenger improves net PnL and profit factor without material drawdown expansion."
        return "KEEP", "Challenger is valid but does not improve the incumbent by the promotion margin."

    async def _execute_challenger(
        self,
        session: "PilotSession",
        challenger_config: OvernightPilotConfig,
        job_id: str,
    ) -> Dict[str, Any]:
        config = challenger_config
        request = BacktestRequest(
            symbol=config.symbol,
            timeframe=config.timeframe,
            days=config.days,
            strategy_type=config.strategy_type,
            initial_capital=config.initial_capital,
            params=BacktestParams(
                risk_per_trade_pct=config.risk_per_trade_pct,
                stop_loss_pct=config.stop_loss_pct,
                take_profit_pct=config.take_profit_pct,
                leverage=config.leverage,
                min_density_usd=config.min_density_usd,
                volume_multiplier=config.volume_multiplier,
                use_atr_filter=config.use_atr_filter,
                use_cvd_filter=config.use_cvd_filter,
                use_oi_filter=config.use_oi_filter,
                use_rsi_filter=config.use_rsi_filter,
                use_stacked_imbalance_filter=config.use_stacked_imbalance_filter,
                use_absorption_filter=config.use_absorption_filter,
                use_poc_migration_filter=config.use_poc_migration_filter,
                use_multi_tp=config.use_multi_tp,
                use_trailing=config.use_trailing,
                trailing_pct=config.trailing_pct,
                tp1_rr_ratio=config.tp1_rr_ratio,
                tp2_rr_ratio=config.tp2_rr_ratio,
                sl_tp_mode=config.sl_tp_mode,
                atr_multiplier=config.atr_multiplier,
            ),
        )
        backtest = await run_backtest(request)
        forecast = await compute_probabilistic_forecast(
            config.symbol,
            config.timeframe,
            strategy_type=config.strategy_type,
            strategy_params=config.model_dump(),
        )
        recommendation, reason = self._challenger_recommendation(
            session.backtest or {}, backtest, forecast
        )
        result = {
            "job_id": job_id,
            "symbol": config.symbol.upper(),
            "incumbent_strategy": session.config.strategy_type,
            "challenger_strategy": config.strategy_type,
            "config_fingerprint": self._config_fingerprint(config),
            "status": "complete",
            "recommendation": recommendation,
            "reason": reason,
            "backtest": backtest,
            "forecast": forecast,
            "created_at": int(time.time() * 1000),
            "deduplicated": False,
        }
        session.challengers[job_id] = result
        self._record_run_event(
            session,
            event_type="CHALLENGER_COMPLETED",
            source="challenger",
            reason_code=f"CHALLENGER_{recommendation}",
            reason=reason,
            payload={
                "job_id": job_id,
                "incumbent_strategy": session.config.strategy_type,
                "challenger_strategy": config.strategy_type,
                "recommendation": recommendation,
            },
        )
        if recommendation == "CANDIDATE":
            result = self.promote_challenger(
                config.symbol,
                job_id,
                automatic=True,
            )
        return dict(result)

    def promote_challenger(
        self,
        symbol: str,
        job_id: str,
        *,
        automatic: bool = False,
    ) -> Dict[str, Any]:
        """Apply a proven challenger only to a flat paper pair.

        Automatic promotion additionally requires the explicit session flag.
        The existing wallet and runner task are preserved.
        """
        key = symbol.strip().upper()
        session = self.sessions.get(key)
        if session is None:
            raise ValueError(f"paper pair {key} not found")
        result = session.challengers.get(job_id)
        if result is None:
            raise ValueError(f"challenger job {job_id} not found for {key}")
        if result.get("recommendation") != "CANDIDATE":
            raise ValueError("only a CANDIDATE challenger can be promoted")
        if (result.get("forecast") or {}).get("data_status") != "connected":
            result["promotion_status"] = "STALE"
            return dict(result)
        if automatic and not session.config.auto_strategy_switch:
            result["promotion_status"] = "AWAITING_APPROVAL"
            return dict(result)
        runner = session.runner
        positions = getattr(getattr(runner, "session", None), "positions", {}) if runner else {}
        position = positions.get(key) if isinstance(positions, dict) else None
        if position is not None and not getattr(position, "closed", False) and float(getattr(position, "qty", 0.0) or 0.0) > 0:
            result["promotion_status"] = "WAITING_FOR_FLAT"
            return dict(result)
        strategy_type = str(result["challenger_strategy"])
        session.config = session.config.model_copy(update={"strategy_type": strategy_type})
        session.config_fingerprint = self._config_fingerprint(session.config)
        session.backtest = result["backtest"]
        session.forecast = result["forecast"]
        session.preflight_valid = True
        session.preflight_passed = True
        if runner is not None:
            runner.strategy_type = strategy_type
            runner.config_fingerprint = session.config_fingerprint
            if hasattr(runner, "indicator_candle_close_time"):
                runner._last_entry_candle = runner.indicator_candle_close_time
        result["promotion_status"] = "APPLIED"
        result["promoted_at"] = int(time.time() * 1000)
        self._record_run_event(
            session,
            event_type="STRATEGY_SWITCHED",
            source="challenger",
            reason_code="CHALLENGER_PROMOTED",
            reason=f"Paper strategy switched to {strategy_type} while flat",
            payload={"job_id": job_id, "strategy_type": strategy_type, "automatic": automatic},
        )
        return dict(result)

    async def evaluate_challenger(self, symbol: str, strategy_type: str) -> Dict[str, Any]:
        """Evaluate an alternate strategy without mutating the active paper runner."""
        key = symbol.strip().upper()
        session = self.sessions.get(key)
        if session is None:
            raise ValueError(f"paper pair {key} not found")
        get_strategy_descriptor(strategy_type)
        if strategy_type == session.config.strategy_type:
            raise ValueError("challenger strategy must be different from the incumbent")
        challenger_config = session.config.model_copy(update={"strategy_type": strategy_type})
        fingerprint = self._config_fingerprint(challenger_config)
        freshness_bucket = int(time.time() // 300)
        job_id = hashlib.sha256(f"{key}:{fingerprint}:{freshness_bucket}".encode("utf-8")).hexdigest()[:20]
        existing = session.challengers.get(job_id)
        if existing is not None:
            if existing.get("promotion_status") == "WAITING_FOR_FLAT":
                promoted = self.promote_challenger(key, job_id, automatic=True)
                return {**promoted, "deduplicated": True}
            return {**existing, "deduplicated": True}
        task = self._challenger_tasks.get(job_id)
        if task is None:
            task = asyncio.create_task(self._execute_challenger(session, challenger_config, job_id))
            self._challenger_tasks[job_id] = task
        try:
            result = await task
        finally:
            if task.done():
                self._challenger_tasks.pop(job_id, None)
        return dict(result)

    def _next_challenger_strategy(self, session: "PilotSession") -> Optional[str]:
        waiting = [
            item for item in session.challengers.values()
            if item.get("promotion_status") == "WAITING_FOR_FLAT"
            and item.get("challenger_strategy") != session.config.strategy_type
        ]
        if waiting:
            return str(max(waiting, key=lambda item: int(item.get("created_at", 0) or 0))["challenger_strategy"])
        candidates = sorted(OPTIMIZABLE_STRATEGIES - {session.config.strategy_type})
        if not candidates:
            return None
        key = session.config.symbol.upper()
        cursor = self._challenger_cursors.get(key, 0)
        strategy = candidates[cursor % len(candidates)]
        self._challenger_cursors[key] = cursor + 1
        return strategy

    async def _challenger_loop(self, session: "PilotSession", initial_delay: float) -> None:
        """Continuously evaluate one bounded alternate profile per interval."""
        if initial_delay > 0:
            await asyncio.sleep(initial_delay)
        while session.runner and session.runner.is_running:
            strategy_type = self._next_challenger_strategy(session)
            if strategy_type is None:
                return
            try:
                await self.evaluate_challenger(session.config.symbol, strategy_type)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Challenger evaluation failed for %s", session.config.symbol)
            if not (session.runner and session.runner.is_running):
                break
            await asyncio.sleep(self.CHALLENGER_INTERVAL_SEC)

    async def _optimization_loop(self, session: "PilotSession") -> None:
        """Periodic re-optimization while the paper session runs (запрос Di 24.10:
        оптимизация стратегий должна работать всё время теста). Первый прогон —
        сразу после старта, далее каждые OPTIMIZATION_INTERVAL_SEC. Рекомендации
        консультативные, на работающую сессию не применяются."""
        while session.runner and session.runner.is_running:
            try:
                if (session.backtest or {}).get("optimization"):
                    await asyncio.sleep(self.OPTIMIZATION_INTERVAL_SEC)
                    if not (session.runner and session.runner.is_running):
                        break
                await self._run_session_optimizer(session, mode="periodic")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                session.backtest["optimization_error"] = str(exc)[:240]
            await asyncio.sleep(self.OPTIMIZATION_INTERVAL_SEC)

    async def preflight(self, configs: Optional[List[OvernightPilotConfig]] = None) -> Dict[str, Any]:
        selected = self._validate_configs(configs)
        async with self._lock:
            if self._has_running_sessions():
                raise ValueError("overnight pilot is already running; stop all paper sessions before preflight")
            await self.stop()
            await self._prepare(selected)
        return self.status()

    async def screen_pair(self, symbol: str, days: int = 14) -> Dict[str, Any]:
        """Read-only strategy lab: backtest+forecast one symbol across the whole catalog.

        Never touches the shared paper wallet or active runners. Each strategy/timeframe
        combination is probed in isolation (fresh manager) because the pilot session map
        is keyed by symbol; concurrency is bounded to stay polite to public market APIs.
        """
        key = symbol.strip().upper()
        if not (len(key) >= 6 and key.endswith("USDT") and key.isalnum()):
            raise ValueError(f"invalid USDT-M symbol: {symbol!r}")
        days = int(days)
        if not 3 <= days <= 30:
            raise ValueError("days must be within 3..30")
        now = time.time()
        last = self._screen_inflight.get(key)
        if last and now - last < 90:
            raise ValueError(f"screen for {key} is already running; wait for it to finish")
        self._screen_inflight[key] = now
        try:
            combos = []
            for strategy_id in HISTORICAL_STRATEGY_IDS:
                descriptor = get_strategy_descriptor(strategy_id)
                if not descriptor.paper_historical:
                    continue
                for timeframe in descriptor.supported_timeframes:
                    if timeframe in ("5m", "15m"):
                        combos.append((descriptor, timeframe))
            if not combos:
                raise ValueError("no screenable strategies in the catalog")

            sem = asyncio.Semaphore(4)

            async def _run_one(descriptor, timeframe: str) -> Dict[str, Any]:
                config = OvernightPilotConfig(
                    symbol=key, strategy_type=descriptor.id, timeframe=timeframe, days=days,
                    initial_capital=1000.0, risk_per_trade_pct=0.5,
                    min_density_usd=0.0, volume_multiplier=0.0,
                    use_cvd_filter=False, use_rsi_filter=False,
                    use_multi_tp=False, trailing_activation_pct=0.5,
                    ai_control=True, auto_strategy_switch=True,
                )
                async with sem:
                    probe = OvernightPilotManager()
                    probe.intent_logger = self.intent_logger
                    try:
                        await probe._prepare([config])
                    except Exception as exc:  # keep screening the remaining combinations
                        return {
                            "strategy_type": descriptor.id, "label": descriptor.label,
                            "family": descriptor.family, "timeframe": timeframe, "ok": False,
                            "error": str(exc), "config": config.model_dump(),
                        }
                session = probe.sessions.get(key)
                summary = (session.backtest or {}).get("summary") or {} if session else {}
                forecast = (session.forecast or {}) if session else {}
                verdict = evaluate_verdict(
                    net_pnl_usd=float(summary.get("net_pnl_usd", 0.0) or 0.0),
                    trades=int(summary.get("total_trades", 0) or 0),
                    profit_factor=float(summary.get("profit_factor", 0.0) or 0.0),
                    regime=forecast.get("market_regime") or forecast.get("regime"),
                ).to_dict()
                return {
                    "strategy_type": descriptor.id, "label": descriptor.label,
                    "family": descriptor.family, "timeframe": timeframe,
                    "ok": bool(session and session.preflight_valid),
                    "error": (session.error if session else "probe unavailable"),
                    "backtest": {
                        "net_pnl_usd": summary.get("net_pnl_usd"),
                        "total_trades": summary.get("total_trades"),
                        "win_rate": summary.get("win_rate"),
                        "profit_factor": summary.get("profit_factor"),
                        "max_drawdown_usd": summary.get("max_drawdown_usd"),
                    },
                    "forecast": {
                        "market_regime": forecast.get("market_regime") or forecast.get("regime"),
                        "data_status": forecast.get("data_status"),
                    },
                    "verdict": verdict,
                    "config": config.model_dump(),
                }

            rows = await asyncio.gather(*(_run_one(d, tf) for d, tf in combos))
            ordered = sorted(
                rows,
                key=lambda r: (
                    not r["ok"],
                    -(float((r.get("backtest") or {}).get("net_pnl_usd") or 0.0)),
                ),
            )
            return {"symbol": key, "days": days, "generated_at": int(now), "rows": ordered}
        finally:
            self._screen_inflight.pop(key, None)

    async def prepare_pair(self, config: OvernightPilotConfig) -> Dict[str, Any]:
        """Prepare one addition without altering an active shared paper account."""
        self._validate_configs([config])
        symbol = config.symbol.upper()
        if symbol in self.sessions and self.sessions[symbol].runner and self.sessions[symbol].runner.is_running:
            raise ValueError(f"{symbol} is already running; edit requires stopping its entries first")
        probe = OvernightPilotManager()
        await probe._prepare([config])
        prepared = probe.sessions[symbol]
        if not prepared.preflight_valid:
            raise ValueError(prepared.error or f"{symbol}: backtest or current forecast is unavailable")
        async with self._lock:
            self._pending_pair_preflights[symbol] = prepared
        summary = (prepared.backtest or {}).get("summary") or {}
        verdict = evaluate_verdict(
            net_pnl_usd=float(summary.get("net_pnl_usd", 0.0) or 0.0),
            trades=int(summary.get("total_trades", 0) or 0),
            profit_factor=float(summary.get("profit_factor", 0.0) or 0.0),
            regime=(prepared.forecast or {}).get("market_regime") or (prepared.forecast or {}).get("regime"),
        ).to_dict()
        return {"preflight_id": prepared.run_id, "session": prepared.to_dict(), "verdict": verdict}

    @classmethod
    def _pair_preflight_matches(
        cls, prepared: Optional[PilotSession], config: OvernightPilotConfig, preflight_id: str,
    ) -> bool:
        return bool(
            prepared is not None and prepared.run_id == preflight_id
            and prepared.config_fingerprint == cls._config_fingerprint(config)
            and prepared.config.model_dump() == config.model_dump()
            and prepared.preflight_valid and cls._backtest_matches_config(prepared)
            and (prepared.forecast or {}).get("data_status") == "connected"
        )

    async def start_pair(
        self, config: OvernightPilotConfig, preflight_id: str, *, demo: bool = False,
    ) -> Dict[str, Any]:
        """Attach an exactly preflighted pair to the current shared paper wallet."""
        symbol = config.symbol.upper()
        async with self._lock:
            prepared = self._pending_pair_preflights.get(symbol)
            if not self._pair_preflight_matches(prepared, config, preflight_id):
                raise ValueError("new pair requires its exact pair preflight and current forecast")
            current = self.sessions.get(symbol)
            if current and current.runner and current.runner.is_running:
                raise ValueError(f"{symbol} is already running")
            active = [s.config for s in self.sessions.values() if s.runner and s.runner.is_running]
            self._validate_configs(active + [config])
            if self._shared_paper_session and self._shared_paper_session.positions.get(symbol):
                position = self._shared_paper_session.positions[symbol]
                if position.qty > 0 and not position.closed:
                    raise ValueError(f"{symbol} already has an open paper position")
            forecast = prepared.forecast or {}
            if str(forecast.get("market_regime") or forecast.get("regime") or "").upper() == "TOXIC_VOLATILITY":
                raise ValueError(f"{symbol}: current market regime is TOXIC_VOLATILITY")
            if not demo:
                summary = (prepared.backtest or {}).get("summary") or {}
                verdict = evaluate_verdict(
                    net_pnl_usd=float(summary.get("net_pnl_usd", 0.0) or 0.0),
                    trades=int(summary.get("total_trades", 0) or 0),
                    profit_factor=float(summary.get("profit_factor", 0.0) or 0.0),
                    regime=forecast.get("market_regime") or forecast.get("regime"),
                )
                if not verdict.allows_live_paper:
                    raise ValueError(f"{symbol}: historical verdict is BLOCK: {'; '.join(verdict.reasons)}")
            if not active:
                self.sessions = {}
                # Общий кошелёк сидируется из конфига: watchdog/скрипт продолжения
                # подставляют сюда сохранённый equity, чтобы перезапуски не обнуляли счёт.
                self._shared_paper_session = PaperTradingSession(
                    initial_balance=float(getattr(config, "initial_capital", 0.0) or 1000.0),
                    session_id=f"overnight_shared_{uuid.uuid4().hex[:12]}",
                )
            shared = self._shared_paper_session
            if shared is None:
                raise ValueError("active paper wallet is unavailable")
            runner = LivePaperRunner(session=shared)
            runner.intent_logger = self.intent_logger
            prepared.session_id = f"overnight_{symbol.lower()}_{uuid.uuid4().hex[:12]}"
            runner.start(
                config.model_dump(), run_id=prepared.run_id,
                config_fingerprint=prepared.config_fingerprint, reset_wallet=False,
            )
            prepared.runner = runner
            prepared.started_at = int(time.time() * 1000)
            prepared.preflight_valid = False
            self.sessions[symbol] = prepared
            self.pair_states[symbol] = "active"
            shared.paused_symbols.discard(symbol)
            self._pending_pair_preflights.pop(symbol, None)
            self._forecast_tasks[symbol] = asyncio.create_task(
                self._forecast_loop(prepared), name=f"overnight-forecast-{symbol}"
            )
            self._optimization_tasks[symbol] = asyncio.create_task(
                self._optimization_loop(prepared), name=f"overnight-optimization-{symbol}"
            )
            self._ensure_snapshot_task()
        return self.status()

    async def run_autopilot(self, configs: List[OvernightPilotConfig], demo: bool = False) -> Dict[str, Any]:
        """Preflight a selected paper-only set and start only non-BLOCK pairs.

        The second preflight is deliberate: ``start`` accepts only the exact
        configuration that was checked, so a mixed selection must be checked
        again after BLOCK candidates are excluded.
        """
        selected = self._validate_configs(configs)
        first_preflight = await self.preflight(selected)
        excluded = self._demo_hard_block_reasons() if demo else self._blocking_preflight_reasons()
        allowed = [config for config in selected if config.symbol.upper() not in excluded]
        if not allowed:
            return {
                "started": False,
                "active_symbols": [],
                "excluded_symbols": excluded,
                "preflight_id": first_preflight.get("preflight_id"),
                "result": None,
            }

        preflight = first_preflight
        if excluded:
            preflight = await self.preflight(allowed)
            remaining_blocks = self._demo_hard_block_reasons() if demo else self._blocking_preflight_reasons()
            if remaining_blocks:
                return {
                    "started": False,
                    "active_symbols": [],
                    "excluded_symbols": {**excluded, **remaining_blocks},
                    "preflight_id": preflight.get("preflight_id"),
                    "result": None,
                }

        preflight_id = preflight.get("preflight_id")
        result = await self.start(allowed, preflight_id=preflight_id, ignore_verdict=demo)
        return {
            "started": True,
            "active_symbols": [config.symbol.upper() for config in allowed],
            "excluded_symbols": excluded,
            "preflight_id": preflight_id,
            "result": result,
        }

    async def start(
        self,
        configs: Optional[List[OvernightPilotConfig]] = None,
        preflight_id: Optional[str] = None,
        ignore_verdict: bool = False,
    ) -> Dict[str, Any]:
        selected = self._validate_configs(configs)
        async with self._lock:
            if self._has_running_sessions():
                raise ValueError("overnight pilot is already running; stop all paper sessions before starting again")
            if not self._preflight_matches(selected, preflight_id):
                raise ValueError(
                    "paper start requires the current preflight for the exact configuration; "
                    "run backtest + forecast again before starting"
                )
            if ignore_verdict:
                hard_reasons = self._demo_hard_block_reasons()
                if hard_reasons:
                    raise ValueError("demo paper start blocked: " + " | ".join(
                        f"{symbol}: {reason}" for symbol, reason in sorted(hard_reasons.items())
                    ))
            else:
                blocking_reasons = self._blocking_preflight_reasons()
                if blocking_reasons:
                    blocked_symbols = ", ".join(sorted(blocking_reasons))
                    raise ValueError(
                        f"paper start blocked by preflight verdict for {blocked_symbols}: "
                        + " | ".join(f"{symbol}: {reason}" for symbol, reason in sorted(blocking_reasons.items()))
                    )
            # Create one shared PaperTradingSession (total account capital shared across
            # all active pairs; seeded from the first config so a resume can carry equity over)
            shared_capital = float(getattr(selected[0], "initial_capital", 0.0) or 1000.0) if selected else 1000.0
            shared_paper_session = PaperTradingSession(
                initial_balance=shared_capital,
                session_id=f"overnight_shared_{int(time.time())}"
            )
            self._shared_paper_session = shared_paper_session

            for session in self.sessions.values():
                try:
                    if session.error or session.backtest is None or session.forecast is None:
                        continue
                    session.session_id = f"overnight_{session.config.symbol.lower()}_{int(time.time())}"
                    runner = LivePaperRunner(session=shared_paper_session)
                    runner.intent_logger = self.intent_logger
                    session.runner = runner
                    session.started_at = int(time.time() * 1000)
                    runner.start(
                        session.config.model_dump(),
                        run_id=getattr(session, "run_id", None),
                        config_fingerprint=getattr(session, "config_fingerprint", None),
                        reset_wallet=False,
                    )
                    session.preflight_valid = False
                    self.pair_states[session.config.symbol.upper()] = "active"
                    shared_paper_session.paused_symbols.discard(session.config.symbol.upper())
                    self._forecast_tasks[session.config.symbol.upper()] = asyncio.create_task(
                        self._forecast_loop(session),
                        name=f"overnight-forecast-{session.config.symbol.upper()}",
                    )
                    self._optimization_tasks[session.config.symbol.upper()] = asyncio.create_task(
                        self._optimization_loop(session),
                        name=f"overnight-optimization-{session.config.symbol.upper()}",
                    )
                    stagger = min(300.0, 30.0 * len(self._challenger_loop_tasks))
                    self._challenger_loop_tasks[session.config.symbol.upper()] = asyncio.create_task(
                        self._challenger_loop(session, initial_delay=stagger),
                        name=f"overnight-challenger-{session.config.symbol.upper()}",
                    )
                except Exception as exc:
                    session.error = str(exc)
            self._ensure_snapshot_task()
        return self.status()

    def _ensure_snapshot_task(self) -> None:
        if not self._has_running_sessions():
            return
        if self._snapshot_task is None or self._snapshot_task.done():
            self._snapshot_task = asyncio.create_task(self._snapshot_loop(), name="overnight-pilot-snapshots")

    async def _snapshot_loop(self) -> None:
        try:
            while True:
                await asyncio.sleep(30)
                try:
                    await self.persist()
                except Exception:
                    logger.exception("Failed to persist overnight paper snapshots")
                if not self._has_running_sessions():
                    try:
                        await self.persist()
                    except Exception:
                        logger.exception("Failed to persist final overnight paper snapshot")
                    break
        except asyncio.CancelledError:
            raise
        finally:
            self._snapshot_task = None

    async def stop(self) -> Dict[str, Any]:
        unsafe = self._unsafe_stop_positions()
        if unsafe:
            raise ValueError(
                "Cannot stop paper runners with open positions and stale/missing prices: "
                + ", ".join(unsafe) + ". Pause new entries instead."
            )
        if self._shared_paper_session and any(
            position.qty > 0 and not position.closed
            for position in self._shared_paper_session.positions.values()
        ):
            self._shared_paper_session.kill_switch(reason="USER_STOP_PAPER_RUN")
        for task in self._forecast_tasks.values():
            if not task.done():
                task.cancel()
        if self._forecast_tasks:
            await asyncio.gather(*self._forecast_tasks.values(), return_exceptions=True)
        self._forecast_tasks.clear()
        for task in self._optimization_tasks.values():
            if not task.done():
                task.cancel()
        if self._optimization_tasks:
            await asyncio.gather(*self._optimization_tasks.values(), return_exceptions=True)
        self._optimization_tasks.clear()
        for task in self._challenger_loop_tasks.values():
            if not task.done():
                task.cancel()
        if self._challenger_loop_tasks:
            await asyncio.gather(*self._challenger_loop_tasks.values(), return_exceptions=True)
        self._challenger_loop_tasks.clear()
        for task in self._challenger_tasks.values():
            if not task.done():
                task.cancel()
        if self._challenger_tasks:
            await asyncio.gather(*self._challenger_tasks.values(), return_exceptions=True)
        self._challenger_tasks.clear()
        snapshot_task = self._snapshot_task
        self._snapshot_task = None
        if snapshot_task and snapshot_task is not asyncio.current_task() and not snapshot_task.done():
            snapshot_task.cancel()
            await asyncio.gather(snapshot_task, return_exceptions=True)
        self._shared_paper_session = None
        for session in self.sessions.values():
            if session.runner:
                session.runner.stop()
            session.preflight_valid = False
        return self.status()

    def _unsafe_stop_positions(self, now_ms: Optional[int] = None) -> List[str]:
        """Never abandon an open paper position without a recent observed exit price."""
        shared = self._shared_paper_session
        if shared is None:
            return []
        now = int(now_ms if now_ms is not None else time.time() * 1000)
        unsafe: List[str] = []
        for symbol, position in shared.positions.items():
            if position.closed or position.qty <= 0:
                continue
            session = self.sessions.get(symbol)
            runner = session.runner if session else None
            observed_at = int(getattr(runner, "last_successful_data_at", 0) or 0)
            price = float(shared.last_prices.get(symbol, 0) or 0)
            if not (runner and runner.is_running and price > 0 and 0 <= now - observed_at <= 30_000):
                unsafe.append(symbol)
        return unsafe

    async def _forecast_loop(self, session: PilotSession) -> None:
        """Refresh the same parameterized forecast while paper mode observes live data."""
        while session.runner and session.runner.is_running:
            try:
                if session.forecast is not None:
                    await asyncio.sleep(300)
                    if not (session.runner and session.runner.is_running):
                        break
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
        counts_by_run: Dict[Optional[str], Dict[str, int]] = {}
        for item in sessions.values():
            paper = item.get("paper") or {}
            run_id = item.get("run_id")
            if run_id not in counts_by_run:
                counts_by_run[run_id] = self.intent_logger.count_by_source(run_id)
            telemetry_sources = counts_by_run[run_id]
            summary = (item.get("backtest") or {}).get("summary") or {}
            backtest = item.get("backtest") or {}
            optimization = backtest.get("optimization") or {}
            recommendation = optimization.get("recommendation") or {}
            optimization_meta = recommendation.get("meta") or {}
            optimization_oos = recommendation.get("oos") or optimization_meta.get("oos") or {}
            trades = (item.get("backtest") or {}).get("trades") or []
            pnl_values = [float(trade.get("pnl_usd", trade.get("net_pnl", 0.0)) or 0.0) for trade in trades]
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
            # Pure EMA profiles use closed OHLCV candles and do not require L2.
            # diagnostics_lenient and naked_test are simplified strategies that also work with OHLCV-only data.
            # Retain the missing-history warning for wall/absorption profiles.
            config_data = item.get("config") or {}
            requires_l2 = (
                item["strategy_type"] not in {"ema_trend", "ema_trend_window", "ema_pullback", "diagnostics_lenient", "naked_test"}
                or bool(config_data.get("min_density_usd", 0))
                or any(config_data.get(key) for key in (
                    "use_stacked_imbalance_filter", "use_absorption_filter", "use_poc_migration_filter"
                ))
            )
            logger.debug(f"[{item['symbol']}] requires_l2={requires_l2}, strategy_type={item['strategy_type']}, min_density={config_data.get('min_density_usd')}, filters={[k for k in ('use_stacked_imbalance_filter', 'use_absorption_filter', 'use_poc_migration_filter') if config_data.get(k)]}")
            verdict = evaluate_verdict(
                net_pnl_usd=backtest_net_pnl,
                trades=int(summary.get("total_trades", 0) or 0),
                profit_factor=float(summary.get("profit_factor", 0.0) or 0.0),
                regime=forecast.get("market_regime") or forecast.get("regime"),
                requires_l2=requires_l2,
                l2_available=False,
            )
            rows.append({
                "symbol": item["symbol"],
                "pair_status": self.pair_states.get(item["symbol"], "active"),
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
                "optimization_status": optimization.get("status", "error" if backtest.get("optimization_error") else "not_run"),
                "optimization_error": backtest.get("optimization_error"),
                "optimization_combinations_tested": optimization_meta.get("combinations_tested"),
                "optimization_oos_available": optimization_oos.get("available", False),
                "optimization_oos_pnl_pct": (optimization_oos.get("metrics") or {}).get("total_pnl_pct"),
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
                "telemetry_events_by_source": telemetry_sources,
                "paper_last_decision_reason": paper.get("last_decision_reason"),
                "paper_last_decision_checks": paper.get("last_decision_checks", []),
                "paper_last_decision_at": paper.get("last_decision_at"),
                "backtest_last_signal_direction": last_backtest_direction,
                "forecast_backtest_divergence": forecast_backtest_divergence,
                "verdict": verdict.to_dict(),
                "error": item.get("error"),
            })
        recovery_required = bool(sessions) and not self._has_running_sessions() and any(
            item.get("paper") is not None for item in sessions.values()
        )
        return {
            "status": "ok",
            "pilot_running": self._has_running_sessions(),
            "recovery": {
                "required": recovery_required,
                "reason": "Persisted paper sessions are stopped; run preflight before starting again" if recovery_required else None,
                "session_count": len(sessions) if recovery_required else 0,
            },
            "preflight_id": self._current_preflight_id(sessions),
            "sessions": sessions,
            "summary": rows,
            "aggregate": self._aggregate_report(sessions, rows, shared_session=getattr(self, "_shared_paper_session", None)),
        }

    @staticmethod
    def _current_preflight_id(sessions: Dict[str, Dict[str, Any]]) -> Optional[str]:
        if not sessions:
            return None
        valid_sessions = [s for s in sessions.values() if s.get("preflight_valid")]
        if not valid_sessions:
            return None
        run_ids = {s.get("run_id") for s in valid_sessions if s.get("run_id")}
        return next(iter(run_ids)) if len(run_ids) == 1 else None

    @staticmethod
    def _aggregate_report(
        sessions: Dict[str, Dict[str, Any]],
        rows: List[Dict[str, Any]],
        shared_session: Optional[Any] = None,
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

        effective_risk_profiles = [
            item.get("effective_risk_config")
            for item in sessions.values()
            if isinstance(item.get("effective_risk_config"), dict)
        ]
        shared_risk_profile = effective_risk_profiles[0] if effective_risk_profiles else None

        backtest_wins = sum(1 for trade in backtest_trades if float(trade.get("pnl_usd", trade.get("net_pnl", 0.0)) or 0.0) > 0)
        gross_wins = sum(max(0.0, float(trade.get("pnl_usd", trade.get("net_pnl", 0.0)) or 0.0)) for trade in backtest_trades)
        gross_losses = abs(sum(min(0.0, float(trade.get("pnl_usd", trade.get("net_pnl", 0.0)) or 0.0)) for trade in backtest_trades))
        paper_items = [item.get("paper") for item in sessions.values() if item.get("paper") is not None]
        # Every pair runner publishes the same shared-account snapshot.  While a
        # pilot is active ``shared_session`` is authoritative; after a stop or
        # restart only the persisted snapshots remain.  Collapse snapshots by
        # their paper-session id so a $1,000 account is never displayed as
        # $1,000 multiplied by the number of configured pairs.
        unique_paper_items: List[Dict[str, Any]] = []
        seen_paper_session_ids: set[str] = set()
        for item in paper_items:
            paper_session_id = str(item.get("session_id") or "").strip()
            if paper_session_id:
                if paper_session_id in seen_paper_session_ids:
                    continue
                seen_paper_session_ids.add(paper_session_id)
            unique_paper_items.append(item)
        # A PaperTradingSession is the shared account.  A run is the immutable
        # preflight/start identity recorded with each pair configuration.  Do
        # not infer either one from a polling request or manufacture a value
        # when persisted rows disagree.
        persisted_account_ids = {
            str(item.get("account_id") or item.get("session_id") or "").strip()
            for item in unique_paper_items
            if str(item.get("account_id") or item.get("session_id") or "").strip()
        }
        persisted_run_ids = {
            str(item.get("run_id") or "").strip()
            for item in sessions.values()
            if str(item.get("run_id") or "").strip()
        }
        if shared_session is not None:
            account_id = shared_session.session_id
            state_source = "active_shared_session"
            account_updated_at = getattr(shared_session, "_last_event_ts", None) or None
        else:
            account_id = next(iter(persisted_account_ids)) if len(persisted_account_ids) == 1 else None
            state_source = "persisted_snapshot" if account_id else "unavailable"
            persisted_updates = [
                int(item.get("updated_at"))
                for item in unique_paper_items
                if item.get("updated_at") is not None
            ]
            account_updated_at = max(persisted_updates) if persisted_updates else None
        run_id = next(iter(persisted_run_ids)) if len(persisted_run_ids) == 1 else None
        if shared_session is not None:
            shared = shared_session
            st = shared.get_state()
            paper_initial = shared.initial_balance
            paper_equity = st.balance
            paper_net = shared.realized_pnl
            paper_unrealized = shared.total_unrealized_pnl()
            paper_trades = list(shared.closed_trades)
            paper_closed_trades = len(paper_trades)
            paper_pnl_values = [float(t.get("net_pnl", 0.0) or 0.0) for t in paper_trades]
            paper_wins = sum(1 for v in paper_pnl_values if v > 0)
            paper_gross_wins = sum(max(0.0, v) for v in paper_pnl_values)
            paper_gross_losses = abs(sum(min(0.0, v) for v in paper_pnl_values))
            paper_losing_trade_reasons = [
                str(t.get("exit_reason") or t.get("reason") or "UNKNOWN")
                for t in paper_trades if float(t.get("net_pnl", 0.0) or 0.0) < 0
            ]
        else:
            paper_trades = [
                trade
                for item in unique_paper_items
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
            paper_initial = sum(float(item.get("initial_capital", 0.0) or 0.0) for item in unique_paper_items)
            paper_equity = sum(float(item.get("current_equity", 0.0) or 0.0) for item in unique_paper_items)
            paper_net = sum(float(item.get("realized_pnl", 0.0) or 0.0) for item in unique_paper_items) if unique_paper_items else None
            paper_unrealized = sum(float(item.get("unrealized_pnl", 0.0) or 0.0) for item in unique_paper_items) if unique_paper_items else None
            paper_closed_trades = sum(int(item.get("closed_trades_count", 0) or 0) for item in unique_paper_items)
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
                "available": bool(paper_items or shared_session is not None),
                "account_id": account_id,
                "run_id": run_id,
                "state_source": state_source,
                "updated_at": account_updated_at,
                "risk_profile": shared_risk_profile,
                "starting_balance": round(paper_initial, 2) if (paper_items or shared_session is not None) else None,
                "equity": round(paper_equity, 2) if (paper_items or shared_session is not None) else None,
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
        sessions_snapshot = list(self.status()["sessions"].values())
        if not sessions_snapshot:
            return

        async with self._persist_lock:
            async with AsyncSessionLocal() as db:
                seen_session_ids = set()
                for item in sessions_snapshot:
                    paper = item.get("paper") or {}
                    session_id = item.get("session_id") or paper.get("session_id")
                    if not session_id or session_id in seen_session_ids:
                        continue
                    seen_session_ids.add(session_id)
                    result = await db.execute(select(OvernightPilotRun).where(OvernightPilotRun.session_id == session_id))
                    row = result.scalar_one_or_none()
                    if row is None:
                        row = OvernightPilotRun(session_id=session_id, symbol=item["symbol"], strategy_type=item["strategy_type"])
                        db.add(row)
                    row.symbol = item["symbol"]
                    row.strategy_type = item["strategy_type"]
                    config_snapshot = dict(item.get("config") or {})
                    config_snapshot["_run_id"] = item.get("run_id")
                    config_snapshot["_config_fingerprint"] = item.get("config_fingerprint")
                    config_snapshot["_effective_risk_config"] = item.get("effective_risk_config")
                    row.config_json = json.dumps(config_snapshot, ensure_ascii=False)
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
        # Реинкарнация зомби: persist() писал is_running=1, пока процесс жил;
        # при убийстве бэкенда (reboot, watchdog taskkill) флаг оставался
        # висеть в БД навсегда. На старте ничего не работает — сбрасываем
        # все флаги, чтобы UI не показывал сотни мёртвых «работающих» сессий.
        async with AsyncSessionLocal() as db:
            await db.execute(
                update(OvernightPilotRun)
                .where(OvernightPilotRun.is_running.is_(True))
                .values(is_running=False)
            )
            await db.commit()
        await self.load_persisted_states()

        # A persisted record is per symbol, while the paper wallet is per run.
        # Restoring symbol rows from several historical runs makes the terminal
        # present multiple old wallets as one current balance.  Keep only the
        # newest run; prior runs remain in SQLite as history, but are not a
        # candidate for a fresh start or the current account summary.
        latest_run_id: Optional[str] = None
        for row in rows:
            candidate_run_id = _snapshot_run_id(row.config_json)
            if candidate_run_id:
                latest_run_id = str(candidate_run_id)
                break
        if latest_run_id is not None:
            rows = [
                row
                for row in rows
                if _snapshot_run_id(row.config_json) == latest_run_id
            ]
        restored: Dict[str, PilotSession] = {}
        for row in rows:
            if row.symbol.upper() in restored or len(restored) >= self.MAX_SESSIONS:
                continue
            try:
                config_data = json.loads(row.config_json or "{}")
                run_id = config_data.pop("_run_id", None)
                config_fingerprint = config_data.pop("_config_fingerprint", None)
                config_data.pop("_effective_risk_config", None)
                config = OvernightPilotConfig.model_validate(config_data)
                paper = json.loads(row.paper_json) if row.paper_json else None
                if paper:
                    paper["is_running"] = False
                    paper["data_status"] = "stale"
                    paper["last_data_error"] = "Backend restarted; start the pilot to resume live paper data"
                restored[row.symbol.upper()] = PilotSession(
                    config=config,
                    session_id=row.session_id,
                    run_id=run_id,
                    config_fingerprint=config_fingerprint or self._config_fingerprint(config),
                    preflight_valid=False,
                    backtest=json.loads(row.backtest_json) if row.backtest_json else None,
                    forecast=json.loads(row.forecast_json) if row.forecast_json else None,
                    paper_snapshot=paper,
                    error=None,
                )
            except Exception:
                continue
        if restored:
            self.sessions = restored


    def get_unified_live_runner_status(self) -> Optional[Dict[str, Any]]:
        """Build a unified LivePaperRunner-compatible status dict from the active multi-pair marathon."""
        if not self.sessions:
            return None
        has_running = self._has_running_sessions()
        shared = self._shared_paper_session
        if not has_running and shared is None:
            return None

        state_dict = shared.get_state().to_dict() if shared is not None else {}
        initial_cap = float(state_dict.get("initial_balance", 1000.0) or 1000.0)
        balance = float(state_dict.get("balance", initial_cap) or initial_cap)
        unrealized = float(state_dict.get("unrealized_pnl", 0.0) or 0.0)
        realized = float(state_dict.get("realized_pnl", 0.0) or 0.0)
        open_positions = list(state_dict.get("positions") or [])
        closed_trades = list(state_dict.get("closed_trades") or [])
        active_orders = list(state_dict.get("active_orders") or [])

        merged_logs = []
        equity_curve = []
        active_symbols = []
        pair_risk_profiles = {}
        for sym, sess in self.sessions.items():
            active_symbols.append(sym)
            pair_risk_profiles[sym] = SharedRiskProfile.from_api_config(sess.config.model_dump()).snapshot()
            if sess.runner:
                for log_entry in sess.runner.logs[:8]:
                    entry_copy = dict(log_entry)
                    msg = str(entry_copy.get("message", ""))
                    if sym not in msg:
                        entry_copy["message"] = f"[{sym}] {msg}"
                    merged_logs.append(entry_copy)
                if not equity_curve and sess.runner.equity_curve:
                    equity_curve = list(sess.runner.equity_curve[-80:])

        merged_logs.sort(key=lambda x: int(x.get("timestamp", 0) or 0), reverse=True)
        now_ms = int(time.time() * 1000)
        equity_curve.append({
            "timestamp": now_ms,
            "time_str": time.strftime("%H:%M:%S"),
            "equity": round(balance, 2),
            "balance": round(balance, 2),
            "unrealized_pnl": round(unrealized, 2),
            "event": "TICK",
        })

        shared_profile = next(iter(pair_risk_profiles.values()), None)
        return {
            "is_running": has_running,
            "is_marathon_bridge": True,
            "symbol": None,
            "active_symbols": active_symbols,
            "strategy_type": f"multi_pair ({len(active_symbols)} pairs)",
            "timeframe": None,
            "leverage": None,
            "initial_capital": round(initial_cap, 2),
            "risk_per_trade_pct": None,
            "risk_profile": shared_profile,
            "pair_risk_profiles": pair_risk_profiles,
            "min_density_usd": 0.0,
            "ai_control": any(bool(sess.config.ai_control) for sess in self.sessions.values()),
            "current_equity": round(balance, 2),
            "balance": round(balance, 2),
            "available_margin": round(float(state_dict.get("available_margin", initial_cap) or 0.0), 4),
            "used_margin": round(float(state_dict.get("locked_margin", 0.0) or 0.0), 4),
            "unrealized_pnl": round(unrealized, 2),
            "realized_pnl": round(realized, 2),
            "roi_pct": round((balance - initial_cap) / max(initial_cap, 1e-9) * 100.0, 4),
            "max_drawdown_pct": 0.0,
            "total_fees": round(float(state_dict.get("total_fees_paid", 0.0) or 0.0), 4),
            "total_funding_paid": round(float(state_dict.get("total_funding_paid", 0.0) or 0.0), 4),
            "open_positions": open_positions,
            "active_orders": active_orders,
            "closed_trades_count": len(closed_trades),
            "closed_trades": closed_trades[-30:],
            "logs": merged_logs[:40],
            "equity_curve": equity_curve[-80:],
            "session_id": state_dict.get("session_id"),
            "data_status": "connected",
        }



    async def pause_pair(self, symbol: str, close_position: bool = False, reason: str = "USER_REQUEST") -> Dict[str, Any]:
        sym = symbol.upper()
        close_price = None
        if close_position and self._shared_paper_session:
            position = self._shared_paper_session.positions.get(sym)
            if position and position.qty > 0 and not position.closed:
                close_price = self._observed_close_price(sym)
        self.pair_states[sym] = "paused"
        if self._shared_paper_session:
            self._shared_paper_session.paused_symbols.add(sym)
        if sym in self.sessions:
            session = self.sessions[sym]
            if session.runner:
                session.runner.is_paused = True
            if close_price is not None and session.runner and session.runner.session:
                session.runner.session.close_position(sym, close_price, order_type="MARKET", reason=f"PAUSE_CLOSE_{reason}")

        try:
            from backend.app.db.database import AsyncSessionLocal
            from backend.app.db.models import PairTradingState
            from datetime import datetime
            async with AsyncSessionLocal() as db_session:
                record = await db_session.get(PairTradingState, sym)
                if not record:
                    record = PairTradingState(symbol=sym, status="paused", reason=reason)
                    db_session.add(record)
                else:
                    record.status = "paused"
                    record.reason = reason
                    record.updated_at = datetime.utcnow()
                await db_session.commit()
        except Exception as e:
            logger.warning("Could not persist pair pause state to DB for %s: %s", sym, e)

        return {"symbol": sym, "status": "paused", "close_position": close_position}

    async def resume_pair(self, symbol: str, reason: str = "USER_REQUEST") -> Dict[str, Any]:
        sym = symbol.upper()
        self.pair_states[sym] = "active"
        if self._shared_paper_session:
            self._shared_paper_session.paused_symbols.discard(sym)
        if sym in self.sessions:
            session = self.sessions[sym]
            if session.runner:
                session.runner.is_paused = False

        try:
            from backend.app.db.database import AsyncSessionLocal
            from backend.app.db.models import PairTradingState
            from datetime import datetime
            async with AsyncSessionLocal() as db_session:
                record = await db_session.get(PairTradingState, sym)
                if not record:
                    record = PairTradingState(symbol=sym, status="active", reason=reason)
                    db_session.add(record)
                else:
                    record.status = "active"
                    record.reason = reason
                    record.updated_at = datetime.utcnow()
                await db_session.commit()
        except Exception as e:
            logger.warning("Could not persist pair resume state to DB for %s: %s", sym, e)

        return {"symbol": sym, "status": "active"}

    async def close_pair(self, symbol: str, pause_after: bool = True, reason: str = "MANUAL_PAIR_CLOSE") -> Dict[str, Any]:
        sym = symbol.upper()
        submitted = False
        if self._shared_paper_session:
            position = self._shared_paper_session.positions.get(sym)
            if position and position.qty > 0 and not position.closed:
                price = self._observed_close_price(sym)
                submitted = bool(self._shared_paper_session.close_position(
                    sym, price, order_type="MARKET", reason=reason,
                ))

        if pause_after:
            await self.pause_pair(sym, close_position=False, reason=reason)
        status = self.pair_states.get(sym, "paused" if pause_after else "active")
        return {"symbol": sym, "status": status, "reason": reason, "exit_order_submitted": submitted,
                "closed_position": False, "detail": f"Market exit order submitted for {sym}" if submitted else "No open position"}

    def _observed_close_price(self, symbol: str, now_ms: Optional[int] = None) -> float:
        sym = symbol.upper()
        shared = self._shared_paper_session
        now = int(now_ms if now_ms is not None else time.time() * 1000)
        session = self.sessions.get(sym)
        runner = session.runner if session else None
        observed_at = int(getattr(runner, "last_successful_data_at", 0) or 0)
        price = float(shared.last_prices.get(sym, 0) or 0) if shared else 0.0
        if not (runner and runner.is_running and price > 0 and 0 <= now - observed_at <= 30_000):
            raise ValueError(f"{sym}: fresh observed price is required for a market paper exit")
        return price

    def get_pairs(self) -> List[Dict[str, Any]]:
        pairs = []
        symbols = set(self.sessions.keys()) | set(self.pair_states.keys())
        if not symbols:
            symbols = {"BTCUSDT", "ETHUSDT", "SOLUSDT"}
        for sym in sorted(symbols):
            status = self.pair_states.get(sym, "active")
            session = self.sessions.get(sym)
            strategy = session.config.strategy_type if session else "default"
            timeframe = session.config.timeframe if session else "15m"
            pos_dict = None
            if session and session.runner and session.runner.session:
                pos = session.runner.session.positions.get(sym)
                if pos and not getattr(pos, "closed", False) and getattr(pos, "qty", 0.0) > 0:
                    pos_dict = pos.to_dict() if hasattr(pos, "to_dict") else {"symbol": sym, "side": getattr(pos, "side", "")}
            elif self._shared_paper_session:
                pos = self._shared_paper_session.positions.get(sym)
                if pos and not getattr(pos, "closed", False) and getattr(pos, "qty", 0.0) > 0:
                    pos_dict = pos.to_dict() if hasattr(pos, "to_dict") else {"symbol": sym, "side": getattr(pos, "side", "")}

            pairs.append({
                "symbol": sym,
                "status": status,
                "strategy": strategy,
                "timeframe": timeframe,
                "has_open_position": bool(pos_dict),
                "position": pos_dict,
            })
        return pairs

    async def pause_all_pairs(self, close_positions: bool = False) -> Dict[str, Any]:
        results = []
        symbols = list(self.sessions.keys()) or ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
        for sym in symbols:
            res = await self.pause_pair(sym, close_position=close_positions, reason="PAUSE_ALL")
            results.append(res)
        return {"action": "pause_all", "count": len(results), "pairs": results}

    async def resume_all_pairs(self) -> Dict[str, Any]:
        results = []
        symbols = list(self.sessions.keys()) or ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
        for sym in symbols:
            res = await self.resume_pair(sym, reason="RESUME_ALL")
            results.append(res)
        return {"action": "resume_all", "count": len(results), "pairs": results}


overnight_pilot_manager = OvernightPilotManager()
