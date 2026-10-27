# SignalScript Code Map

> Generated automatically by `scripts/gen_codemap.py`. Do not edit manually.
> Run `python scripts/gen_codemap.py` to regenerate.

---

## 1. Backend & Quantitative Python Modules

### `backend/app/adapters/exchange/__init__.py`
- **Dependencies:** `backend.app.adapters.exchange.base.BaseExchangeAdapter`, `backend.app.adapters.exchange.binance.BinanceAdapter`, `backend.app.adapters.exchange.bybit.BybitAdapter`

### `backend/app/adapters/exchange/base.py`
- **Symbols:** `class BaseExchangeAdapter (name, fetch_klines, fetch_order_book, fetch_24h_tickers...)`
- **Dependencies:** `abc.ABC`, `abc.abstractmethod`, `pandas`, `typing.Any`, `typing.Dict`, `typing.List`, `typing.Optional`

### `backend/app/adapters/exchange/binance.py`
- **Symbols:** `class BinanceAdapter (__init__, name, get_ws_url, get_session...)`
- **Dependencies:** `aiohttp`, `asyncio`, `backend.app.adapters.exchange.base.BaseExchangeAdapter`, `backend.app.config.BINANCE_API_KEY`, `pandas`, `typing.Any`, `typing.Dict`, `typing.List`

### `backend/app/adapters/exchange/bybit.py`
- **Symbols:** `class BybitAdapter (__init__, name, get_ws_url, get_session...)`
- **Dependencies:** `aiohttp`, `backend.app.adapters.exchange.base.BaseExchangeAdapter`, `pandas`, `typing.Any`, `typing.Dict`, `typing.List`, `typing.Optional`

### `backend/app/api/data_routes.py`
- **Symbols:** `class BacktestRequestSchema`, `class RecorderConfigSchema`, `func export_recorded_data`, `func get_clusters`, `func get_recorder_status`, `func get_tpo_profile`, `func update_recorder_config`
- **Dependencies:** `backend.app.services.binance_service.binance_service`, `backend.app.services.orderflow_backtester.orderflow_backtester`, `backend.app.services.recorder.recorder`, `fastapi.APIRouter`, `fastapi.BackgroundTasks`, `fastapi.HTTPException`, `fastapi.Query`, `fastapi.responses.FileResponse`

### `backend/app/api/routes.py`
- **Symbols:** `class DrawingSaveSchema`, `class SettingsSchema`, `class SignalCreateSchema`, `func create_signal`, `func get_coin_settings`, `func get_depth`, `func get_drawings`, `func get_heatmap`, `func get_indicators`, `func get_klines`
- **Dependencies:** `backend.app.db.database.get_db`, `backend.app.db.models.DrawingData`, `backend.app.db.models.LiquidationEvent`, `backend.app.db.models.SignalHistory`, `backend.app.db.models.UserSetting`, `backend.app.services.binance_service.binance_service`, `backend.app.services.bot.broadcast_signal`, `backend.app.services.drawing_persistence.choose_latest_drawing`

### `backend/app/config.py`
- **Dependencies:** `dotenv.load_dotenv`, `os`, `pathlib.Path`

### `backend/app/db/database.py`
- **Symbols:** `func get_db`, `func init_db`, `func set_sqlite_pragma`
- **Dependencies:** `backend.app.config.DATABASE_URL`, `backend.app.db.models.Base`, `backend.app.db.models.UserSetting`, `sqlalchemy.event`, `sqlalchemy.ext.asyncio.AsyncSession`, `sqlalchemy.ext.asyncio.create_async_engine`, `sqlalchemy.orm.sessionmaker`, `sqlalchemy.pool.NullPool`

### `backend/app/db/models.py`
- **Symbols:** `class DecisionLog`, `class DrawingData`, `class LiquidationEvent`, `class OvernightPilotRun`, `class PairTradingState`, `class PaperTradeRecord`, `class SignalHistory`, `class StrategyPreset`, `class UserSetting`, `class Workspace`
- **Dependencies:** `datetime.datetime`, `sqlalchemy.Boolean`, `sqlalchemy.Column`, `sqlalchemy.DateTime`, `sqlalchemy.Float`, `sqlalchemy.Index`, `sqlalchemy.Integer`, `sqlalchemy.String`

### `backend/app/engine/__init__.py`
- **Dependencies:** `backend.app.engine.indicators.compute_atr`, `backend.app.engine.indicators.compute_bollinger_bands`, `backend.app.engine.indicators.compute_cvd`, `backend.app.engine.indicators.compute_ema`, `backend.app.engine.indicators.compute_indicators`, `backend.app.engine.indicators.compute_macd`, `backend.app.engine.indicators.compute_rsi`, `backend.app.engine.indicators.compute_supertrend`

### `backend/app/engine/background_worker.py`
- **Symbols:** `class BackgroundWorker (__init__, semaphore, register_websocket, unregister_websocket...)`, `func background_auto_trade_allowed`
- **Dependencies:** `asyncio`, `backend.app.engine.regime_classifier.MarketRegime`, `backend.app.engine.regime_classifier.regime_classifier`, `backend.app.engine.trade_contract.UnifiedTradeSignal`, `backend.app.engine.walk_forward_engine.walk_forward_engine`, `backend.app.services.historical_data_loader.historical_loader`, `backend.app.services.orderflow_backtester.OrderFlowBacktester`, `fastapi.WebSocket`

### `backend/app/engine/cluster_filters.py`
- **Symbols:** `func check_cluster_filters_at_bar`, `func compute_bar_cluster_arrays`, `func compute_fee_aware_rr_bounds`
- **Dependencies:** `numpy`, `pandas`, `types.SimpleNamespace`, `typing.Any`, `typing.Dict`, `typing.List`, `typing.Optional`, `typing.Tuple`

### `backend/app/engine/confluence.py`
- **Symbols:** `class ConfluenceConfigError`, `class ConfluenceConfigStore (__init__, scorer_for, get, update)`, `class ConfluenceVerdict`, `class FactorOutcome`, `class WeightedConfluenceScorer (__init__, score)`, `func validate_weights`
- **Dependencies:** `__future__.annotations`, `dataclasses.dataclass`, `dataclasses.field`, `json`, `logging`, `pathlib.Path`, `typing.Any`, `typing.Dict`

### `backend/app/engine/dynamic_sl_tp.py`
- **Symbols:** `func calibrate_best_sl_tp_mode_for_df`, `func compute_dynamic_sl_tp_levels`, `func recommend_pair_sl_tp_mode`
- **Dependencies:** `backend.app.engine.cluster_filters.compute_fee_aware_rr_bounds`, `backend.app.engine.execution._estimate_tick_size`, `math`, `typing.Any`, `typing.Dict`, `typing.Optional`

### `backend/app/engine/execution.py`
- **Symbols:** `func simulate_execution`
- **Dependencies:** `numpy`, `types.SimpleNamespace`, `typing.Any`, `typing.Dict`, `typing.List`

### `backend/app/engine/indicators.py`
- **Symbols:** `func compute_atr`, `func compute_bollinger_bands`, `func compute_cvd`, `func compute_ema`, `func compute_indicators`, `func compute_macd`, `func compute_rsi`, `func compute_supertrend`
- **Dependencies:** `numpy`, `pandas`, `typing.Any`, `typing.Dict`, `typing.Optional`

### `backend/app/engine/monte_carlo.py`
- **Symbols:** `func run_monte_carlo_simulation`
- **Dependencies:** `numpy`, `typing.Any`, `typing.Dict`, `typing.List`, `typing.Optional`

### `backend/app/engine/optimizer.py`
- **Symbols:** `class WalkForwardOptimizer (__init__, generate_ema_trend_signals, generate_supertrend_signals, run_strategy_vectorized...)`, `func compute_institutional_score`, `func evaluate_vectorized_signals`, `func generate_walk_forward_windows`, `func split_train_oos`
- **Dependencies:** `backend.app.engine.indicators.compute_atr`, `backend.app.engine.indicators.compute_cvd`, `backend.app.engine.indicators.compute_ema`, `backend.app.engine.indicators.compute_rsi`, `backend.app.engine.indicators.compute_supertrend`, `itertools`, `math`, `numpy`

### `backend/app/engine/regime_classifier.py`
- **Symbols:** `class MarketRegime`, `class RegimeClassifier (__init__, compute_features, classify_series, classify_current)`
- **Dependencies:** `enum.Enum`, `numpy`, `pandas`, `typing.Any`, `typing.Dict`, `typing.Optional`, `typing.Tuple`, `typing.Union`

### `backend/app/engine/strategies.py`
- **Symbols:** `func compute_raw_signal`
- **Dependencies:** `types.SimpleNamespace`

### `backend/app/engine/sweep_leaderboard.py`
- **Symbols:** `class SweepLeaderboardStore (__init__, record_run, latest, list_runs)`, `func build_leaderboard_entries`
- **Dependencies:** `__future__.annotations`, `json`, `pathlib.Path`, `time`, `typing.Any`, `typing.Dict`, `typing.List`, `typing.Optional`

### `backend/app/engine/trade_contract.py`
- **Symbols:** `class UnifiedTradeSignal (clean_symbol, clean_direction, clean_entry_type, normalize_reason...)`, `func from_backtest_setup`, `func from_backtest_trade`, `func from_paper_order`, `func from_scanner_signal`, `func to_paper_order_request`
- **Dependencies:** `__future__.annotations`, `hashlib`, `pydantic.BaseModel`, `pydantic.Field`, `pydantic.field_validator`, `time`, `typing.Any`, `typing.Dict`

### `backend/app/engine/verdict.py`
- **Symbols:** `class Verdict (allows_live_paper, to_dict)`, `class VerdictLevel`, `func evaluate_verdict`
- **Dependencies:** `__future__.annotations`, `dataclasses.dataclass`, `dataclasses.field`, `enum.Enum`, `typing.List`, `typing.Optional`

### `backend/app/engine/walk_forward_engine.py`
- **Symbols:** `class WalkForwardEngine (__init__, get_adapted_parameters, is_trade_allowed, train_walk_forward...)`
- **Dependencies:** `asyncio`, `backend.app.engine.regime_classifier.MarketRegime`, `backend.app.engine.regime_classifier.regime_classifier`, `backend.app.services.historical_data_loader.historical_loader`, `backend.app.services.orderflow_backtester.OrderFlowBacktester`, `logging`, `numpy`, `pandas`

### `backend/app/logging_setup.py`
- **Symbols:** `class PROCESS_MEMORY_COUNTERS_EX`, `func get_memory_stats`, `func setup_stress_logging`
- **Dependencies:** `ctypes`, `ctypes.wintypes`, `logging`, `os`, `pathlib.Path`, `sys`, `typing.Any`, `typing.Dict`

### `backend/app/routers/adaptive_router.py`
- **Symbols:** `class OptimizeWeightsRequest`, `func get_market_regime`, `func get_strategy_weights`, `func optimize_regime_weights`
- **Dependencies:** `backend.app.engine.regime_classifier.MarketRegime`, `backend.app.engine.regime_classifier.regime_classifier`, `backend.app.engine.walk_forward_engine.walk_forward_engine`, `backend.app.services.historical_data_loader.historical_loader`, `fastapi.APIRouter`, `fastapi.HTTPException`, `fastapi.Query`, `pydantic.BaseModel`

### `backend/app/routers/ai_copilot.py`
- **Symbols:** `class AIChatRequest`, `class AIOptimizeRequest`, `class ForecastRequest`, `class MarketAnalysisRequest`, `class ValidateKeyRequest`, `func chat_with_copilot`, `func get_forecast_query`, `func get_market_analysis`, `func list_ai_models`, `func optimize_strategy`
- **Dependencies:** `aiohttp`, `backend.app.config.OPENROUTER_API_KEY`, `backend.app.config.OPENROUTER_MODEL`, `backend.app.routers.backtest.build_response`, `backend.app.routers.backtest.fetch_history`, `backend.app.services.ai_copilot_service._classify_health_meter`, `backend.app.services.ai_copilot_service.build_expected_move_cone`, `backend.app.services.ai_copilot_service.build_expected_value`

### `backend/app/routers/ai_settings.py`
- **Symbols:** `class AIConfigRequest`, `func get_config`, `func get_models`, `func save_config`, `func test_connection`
- **Dependencies:** `backend.app.services.openrouter_client.openrouter_client`, `backend.app.services.openrouter_service.openrouter_model_hub`, `fastapi.APIRouter`, `fastapi.HTTPException`, `pydantic.BaseModel`, `pydantic.Field`, `time`, `typing.List`

### `backend/app/routers/backtest.py`
- **Symbols:** `class BacktestParams`, `class BacktestReportRequest`, `class BacktestRequest`, `class InspectLevelRequest`, `class LimitSetupRequest`, `class LimitSetupResponse`, `class OptimizeRequest`, `func build_response`, `func export_backtest_report`, `func export_backtest_report_html`
- **Dependencies:** `aiohttp`, `asyncio`, `backend.app.adapters.exchange.binance.BINANCE_FUTURES_REST`, `backend.app.services.backtest_report.render_backtest_report_html`, `backend.app.services.backtest_report.render_backtest_report_pdf`, `backend.app.services.binance_service.binance_service`, `backend.app.services.orderflow_backtester.OrderFlowBacktester`, `backend.app.services.orderflow_backtester.orderflow_backtester`

### `backend/app/routers/confluence.py`
- **Symbols:** `class ConfluenceScorePayload`, `class ConfluenceWeightsPayload`, `func get_weights`, `func list_factors`, `func put_weights`, `func score_factors`
- **Dependencies:** `__future__.annotations`, `backend.app.config.DATA_DIR`, `backend.app.engine.confluence.ConfluenceConfigError`, `backend.app.engine.confluence.ConfluenceConfigStore`, `backend.app.engine.confluence.DEFAULT_REQUIRED`, `backend.app.engine.confluence.DEFAULT_THRESHOLD`, `backend.app.engine.confluence.DEFAULT_WEIGHTS`, `backend.app.engine.confluence.KNOWN_FACTORS`

### `backend/app/routers/drawings.py`
- **Symbols:** `class DrawingSaveSchema`, `func delete_drawings`, `func get_drawings`, `func save_drawings`
- **Dependencies:** `backend.app.db.database.get_db`, `backend.app.db.models.DrawingData`, `backend.app.services.drawing_persistence.choose_latest_drawing`, `datetime.datetime`, `fastapi.APIRouter`, `fastapi.Depends`, `fastapi.HTTPException`, `fastapi.Query`

### `backend/app/routers/journal.py`
- **Symbols:** `class DecisionLogCreateRequest`, `class DecisionLogUpdateRequest`, `class SecondOpinionRequest`, `class StrategyPresetRequest`, `func ask_openrouter_second_opinion`, `func create_decision_log`, `func delete_strategy_preset`, `func ensure_seed_data`, `func export_decision_logs_csv`, `func gather_market_context`
- **Dependencies:** `aiohttp`, `backend.app.config.OPENROUTER_API_KEY`, `backend.app.config.OPENROUTER_MODEL`, `backend.app.db.database.AsyncSessionLocal`, `backend.app.db.models.DecisionLog`, `backend.app.db.models.SignalHistory`, `backend.app.db.models.StrategyPreset`, `backend.app.services.binance_service.binance_service`

### `backend/app/routers/monitoring.py`
- **Symbols:** `class SetMonitoredTickersRequest`, `class ToggleTickerRequest`, `func get_monitoring_state`, `func get_sentinel_status`, `func get_system_monitoring_state`, `func monitoring_websocket_endpoint`, `func set_monitored_tickers`, `func toggle_ticker_monitoring`
- **Dependencies:** `backend.app.engine.background_worker.background_worker`, `backend.app.services.paper_trading.paper_trading_session`, `backend.app.services.warning_sentinel.warning_sentinel`, `fastapi.APIRouter`, `fastapi.WebSocket`, `fastapi.WebSocketDisconnect`, `pydantic.BaseModel`, `pydantic.Field`

### `backend/app/routers/overnight_pilot.py`
- **Symbols:** `class AutoSelectRequest`, `class ClosePairRequest`, `class PausePairRequest`, `func auto_select_and_start`, `func emergency_close_pair`, `func get_diversified_paper_defaults`, `func get_last_auto_selection`, `func get_overnight_defaults`, `func get_overnight_status`, `func get_pairs_status`
- **Dependencies:** `backend.app.services.deep_intent_logger.DeepIntentLogger`, `backend.app.services.overnight_pilot.OvernightPilotConfig`, `backend.app.services.overnight_pilot.overnight_pilot_manager`, `backend.app.services.pair_selector.build_pilot_configs`, `backend.app.services.pair_selector.load_last_selection`, `backend.app.services.pair_selector.run_selection`, `fastapi.APIRouter`, `fastapi.HTTPException`

### `backend/app/routers/paper_trading_router.py`
- **Symbols:** `class AIRiskEvalRequest`, `class DepositRequest`, `class KillSwitchRequest`, `class LiveStartRequest`, `class OrderSignalRequest`, `class ResetWalletRequest`, `func deposit_live_paper_wallet`, `func deposit_paper_wallet`, `func evaluate_ai_trade_risk`, `func get_ai_model_chain_status`
- **Dependencies:** `backend.app.engine.trade_contract.UnifiedTradeSignal`, `backend.app.services.live_paper_runner.live_paper_runner`, `backend.app.services.openrouter_client.openrouter_client`, `backend.app.services.paper_trading.paper_trading_session`, `fastapi.APIRouter`, `fastapi.HTTPException`, `pydantic.BaseModel`, `pydantic.Field`

### `backend/app/routers/quant_router.py`
- **Symbols:** `class ThinkOptimizeRequest`, `func build_think_optimize_request`, `func commit_to_quarantine`, `func evaluate_quant_signal`, `func get_design_overlay`, `func get_liquidation_estimates`, `func get_market_prompt`, `func get_orderbook_depth`, `func get_unified_market_data`, `func list_quarantine_records`
- **Dependencies:** `backend.app.routers.backtest.OptimizeRequest`, `backend.app.routers.backtest.optimize_backtest`, `backend.app.services.design_contracts.DesignOverlayPayload`, `backend.app.services.design_contracts.build_design_overlay`, `backend.app.services.market_data_factory.market_data_provider`, `backend.app.services.market_data_provider.LiqEstimatesData`, `backend.app.services.market_data_provider.MarketSnapshot`, `backend.app.services.market_data_provider.OrderBookDepthData`

### `backend/app/routers/replay.py`
- **Symbols:** `func paginate_events`, `func replay_events`
- **Dependencies:** `__future__.annotations`, `backend.app.services.replay_engine.ReplayEngine`, `fastapi.APIRouter`, `fastapi.HTTPException`, `fastapi.Query`, `logging`, `typing.Any`, `typing.Dict`

### `backend/app/routers/risk.py`
- **Symbols:** `class DcaLadderRequest`, `class FixedFractionalRequest`, `class HeatCheckRequest`, `func dca_ladder`, `func heat_check`, `func position_size`
- **Dependencies:** `__future__.annotations`, `backend.app.services.position_sizer.PositionSizer`, `dataclasses.asdict`, `fastapi.APIRouter`, `pydantic.BaseModel`, `pydantic.Field`, `typing.List`, `typing.Optional`

### `backend/app/routers/sweep.py`
- **Symbols:** `class SweepRunRequest`, `func get_leaderboard`, `func list_runs`, `func run_sweep`
- **Dependencies:** `__future__.annotations`, `backend.app.engine.optimizer.WalkForwardOptimizer`, `backend.app.engine.sweep_leaderboard.SweepLeaderboardStore`, `fastapi.APIRouter`, `fastapi.HTTPException`, `fastapi.Query`, `pathlib.Path`, `pydantic.BaseModel`

### `backend/app/routers/verdict.py`
- **Symbols:** `class VerdictRequest`, `func evaluate`
- **Dependencies:** `__future__.annotations`, `backend.app.engine.verdict.evaluate_verdict`, `fastapi.APIRouter`, `pydantic.BaseModel`, `typing.Optional`

### `backend/app/routers/walls.py`
- **Symbols:** `class WallObservationPayload`, `class WallSettingsPayload`, `class WallUpdatePayload`, `func get_wall_settings`, `func observe_wall_size`, `func put_wall_settings`, `func qualified_walls`, `func track_wall`
- **Dependencies:** `__future__.annotations`, `backend.app.config.DATA_DIR`, `backend.app.services.wall_settings.AutoDensityCalibrator`, `backend.app.services.wall_settings.WallSettings`, `backend.app.services.wall_settings.WallSettingsStore`, `backend.app.services.wall_settings.WallTracker`, `fastapi.APIRouter`, `pydantic.BaseModel`

### `backend/app/routers/workspaces.py`
- **Symbols:** `class SaveWorkspacePayload`, `class WorkspaceDetail`, `class WorkspaceItem`, `func delete_workspace`, `func ensure_default_workspaces`, `func get_db`, `func get_workspace`, `func list_workspaces`, `func save_workspace`
- **Dependencies:** `backend.app.db.database.AsyncSessionLocal`, `backend.app.db.models.Workspace`, `datetime.datetime`, `fastapi.APIRouter`, `fastapi.Depends`, `fastapi.HTTPException`, `json`, `pydantic.BaseModel`

### `backend/app/services/ai_copilot_service.py`
- **Symbols:** `func build_expected_move_cone`, `func build_expected_value`, `func build_forecast_fan`, `func build_forecast_signal`, `func build_liquidity_magnet`, `func build_support_resistance`, `func classify_forecast_regime`, `func compute_atr14`, `func compute_health_score`, `func compute_market_metrics`
- **Dependencies:** `backend.app.config.OPENROUTER_API_KEY`, `backend.app.config.OPENROUTER_MODEL`, `backend.app.routers.backtest.fetch_history`, `backend.app.services.orderflow_backtester.OrderFlowBacktester`, `fastapi.HTTPException`, `json`, `logging`, `math`

### `backend/app/services/ai_service.py`
- **Symbols:** `class OpenRouterAIService (__init__, get_effective_models, query_with_fallback, get_second_opinion)`
- **Dependencies:** `aiohttp`, `asyncio`, `backend.app.config.OPENROUTER_API_KEY`, `backend.app.config.OPENROUTER_FREE_MODELS`, `backend.app.config.OPENROUTER_MODEL`, `json`, `logging`, `os`

### `backend/app/services/backtest_report.py`
- **Symbols:** `func render_backtest_report_html`, `func render_backtest_report_pdf`
- **Dependencies:** `__future__.annotations`, `datetime.datetime`, `datetime.timezone`, `html.escape`, `io`, `math`, `matplotlib`, `matplotlib.backends.backend_pdf.PdfPages`

### `backend/app/services/binance_service.py`
- **Symbols:** `class BinanceService (__init__, get_session, close, fetch_24h_tickers...)`
- **Dependencies:** `aiohttp`, `asyncio`, `backend.app.adapters.exchange.BinanceAdapter`, `backend.app.config.BINANCE_API_KEY`, `backend.app.db.database.AsyncSessionLocal`, `backend.app.db.models.LiquidationEvent`, `datetime.datetime`, `datetime.timedelta`

### `backend/app/services/bot.py`
- **Symbols:** `func broadcast_alert`, `func broadcast_signal`, `func get_bot`, `func start_bot_polling`
- **Dependencies:** `aiogram.Bot`, `aiogram.Dispatcher`, `aiogram.enums.ParseMode`, `aiogram.filters.Command`, `aiogram.filters.CommandStart`, `aiogram.types`, `aiogram.types.InlineKeyboardButton`, `aiogram.types.InlineKeyboardMarkup`

### `backend/app/services/cluster_engine.py`
- **Symbols:** `class ClusterCell (total_volume, delta, imbalance)`, `class ClusterEngine (__init__, aggregate_trades, volume_profile, detect_walls...)`, `class Footprint`, `class LiquidationLevel`, `class TradeEvent`, `class VolumeProfile`, `class Wall`
- **Dependencies:** `dataclasses.dataclass`, `typing.Dict`, `typing.Iterable`, `typing.List`, `typing.Sequence`, `typing.Tuple`

### `backend/app/services/coingecko.py`
- **Symbols:** `class CoinGeckoService (__init__, get_market_caps, get_symbol_mcap)`
- **Dependencies:** `aiohttp`, `logging`, `time`, `typing.Dict`, `typing.Optional`

### `backend/app/services/deep_history.py`
- **Symbols:** `class ArchiveSpec`, `class BinanceVisionIngestor (__init__, monthly_specs, estimate_month, ingest_month...)`, `func aggregate_footprints`, `func aggregate_price_levels`, `func build_footprint_1m`, `func build_price_levels_1m`, `func write_manifest`
- **Dependencies:** `__future__.annotations`, `collections.defaultdict`, `dataclasses.dataclass`, `datetime.datetime`, `datetime.timezone`, `decimal.Decimal`, `decimal.ROUND_FLOOR`, `hashlib`

### `backend/app/services/deep_intent_logger.py`
- **Symbols:** `class DeepIntentLogWriteError`, `class DeepIntentLogger (__init__, record_event, record, read_recent...)`
- **Dependencies:** `backend.app.config.BASE_DIR`, `collections.deque`, `datetime.datetime`, `datetime.timezone`, `json`, `pathlib.Path`, `threading`, `typing.Any`

### `backend/app/services/design_contracts.py`
- **Symbols:** `class DesignDepthDeltas`, `class DesignDepthWall`, `class DesignLiqLevel`, `class DesignOverlayPayload`, `func build_design_overlay`
- **Dependencies:** `backend.app.services.market_data_provider.LiqEstimatesData`, `backend.app.services.market_data_provider.OrderBookDepthData`, `pydantic.BaseModel`, `pydantic.Field`, `typing.List`, `typing.Literal`

### `backend/app/services/drawing_persistence.py`
- **Symbols:** `func choose_latest_drawing`
- **Dependencies:** `datetime.datetime`, `datetime.timezone`, `typing.Any`, `typing.Iterable`, `typing.Optional`

### `backend/app/services/early_exit_engine.py`
- **Symbols:** `class EarlyExitEngine (__init__, register_position, remove_position, on_price_update...)`, `class PositionTrackState (current_pnl, time_in_trade_sec, current_pnl_r, mfe_r...)`, `func clamp_protective_stop`
- **Dependencies:** `dataclasses.dataclass`, `dataclasses.field`, `logging`, `time`, `typing.Any`, `typing.Dict`, `typing.List`, `typing.Optional`

### `backend/app/services/execution/__init__.py`
- **Dependencies:** `base.BaseExecutionProvider`, `base.ExecutionSnapshot`, `base.ExecutionTrade`, `exchange.ExchangeLiveProvider`, `paper.PaperSandboxProvider`

### `backend/app/services/execution/base.py`
- **Symbols:** `class BaseExecutionProvider (open_position, close_position, snapshot)`, `class ExecutionSnapshot`, `class ExecutionTrade`
- **Dependencies:** `abc.ABC`, `abc.abstractmethod`, `dataclasses.dataclass`, `dataclasses.field`, `typing.Any`, `typing.Dict`

### `backend/app/services/execution/exchange.py`
- **Symbols:** `class ExchangeLiveProvider (open_position, close_position, snapshot)`
- **Dependencies:** `base.BaseExecutionProvider`, `base.ExecutionSnapshot`, `base.ExecutionTrade`, `typing.Any`

### `backend/app/services/execution/paper.py`
- **Symbols:** `class PaperSandboxProvider (__init__, open_position, apply_funding, close_position...)`, `class _Position`
- **Dependencies:** `backend.app.services.paper_trading.PaperTradingSession`, `base.BaseExecutionProvider`, `base.ExecutionSnapshot`, `base.ExecutionTrade`, `dataclasses.dataclass`, `dataclasses.field`, `typing.Any`, `typing.Dict`

### `backend/app/services/execution_simulator.py`
- **Symbols:** `class ExecutionResult (__repr__)`, `class ExecutionSimulator (__init__, run, process_event)`, `class Fill (notional)`, `class OrderConfig (order_active_ts)`, `class OrderSide`, `class OrderState (avg_fill_price, total_fee)`, `class OrderStatus`, `class OrderType`, `func simulate_order`
- **Dependencies:** `dataclasses.dataclass`, `dataclasses.field`, `enum.Enum`, `logging`, `typing.Iterator`, `typing.List`, `typing.Optional`, `typing.Tuple`

### `backend/app/services/free_binance_collector.py`
- **Symbols:** `class FreeBinanceSelfCollector (__init__, provider_id, close, get_orderbook_depth...)`
- **Dependencies:** `aiohttp`, `asyncio`, `backend.app.services.market_data_provider.DepthDeltaSummary`, `backend.app.services.market_data_provider.IMarketDataProvider`, `backend.app.services.market_data_provider.LiqEstimatesData`, `backend.app.services.market_data_provider.LiqLevelEstimate`, `backend.app.services.market_data_provider.MarketSnapshot`, `backend.app.services.market_data_provider.OrderBookDepthData`

### `backend/app/services/hedge_ledger.py`
- **Symbols:** `class HedgeLedger (__init__, create_wallet, wallet, wallets...)`, `class SubWallet (margin_free, equity)`
- **Dependencies:** `dataclasses.dataclass`, `dataclasses.field`, `typing.Dict`, `typing.List`, `typing.Optional`

### `backend/app/services/historical_data_loader.py`
- **Symbols:** `class HistoricalDataLoader (__init__, get_cache_path, timeframe_to_ms, raw_to_dataframe...)`
- **Dependencies:** `aiohttp`, `asyncio`, `json`, `logging`, `math`, `numpy`, `os`, `pandas`

### `backend/app/services/indicators/__init__.py`
- **Symbols:** `func check_cvd_divergence`, `func check_ema20_cross`, `func check_rsi_condition`, `func check_volume_spike`, `func check_vwap_signal`, `func compute_indicators`
- **Dependencies:** `backend.app.services.indicators.base.BaseIndicator`, `backend.app.services.indicators.normalization.format_normalized_display`, `backend.app.services.indicators.normalization.normalize_series`, `backend.app.services.indicators.registry.IndicatorRegistry`, `backend.app.services.indicators.registry.registry`, `backend.app.services.regime_classifier.MarketRegime`, `backend.app.services.regime_classifier.bollinger_width`, `backend.app.services.regime_classifier.choppiness_index`

### `backend/app/services/indicators/base.py`
- **Symbols:** `class BaseIndicator (name, display_name, description, params_schema...)`
- **Dependencies:** `abc.ABC`, `abc.abstractmethod`, `pandas`, `typing.Any`, `typing.Dict`, `typing.Optional`

### `backend/app/services/indicators/normalization.py`
- **Symbols:** `func format_normalized_display`, `func normalize_series`
- **Dependencies:** `numpy`, `pandas`, `typing.Any`, `typing.Dict`, `typing.Optional`

### `backend/app/services/indicators/plugins/atr.py`
- **Symbols:** `class ATRIndicator (name, display_name, description, params_schema...)`
- **Dependencies:** `backend.app.services.indicators.base.BaseIndicator`, `pandas`, `typing.Any`, `typing.Dict`, `typing.Optional`

### `backend/app/services/indicators/plugins/cvd.py`
- **Symbols:** `class CVDIndicator (name, display_name, description, params_schema...)`
- **Dependencies:** `backend.app.services.indicators.base.BaseIndicator`, `pandas`, `typing.Any`, `typing.Dict`, `typing.Optional`

### `backend/app/services/indicators/plugins/ema.py`
- **Symbols:** `class EMAIndicator (name, display_name, description, params_schema...)`
- **Dependencies:** `backend.app.services.indicators.base.BaseIndicator`, `pandas`, `typing.Any`, `typing.Dict`, `typing.Optional`

### `backend/app/services/indicators/plugins/open_interest.py`
- **Symbols:** `class OpenInterestIndicator (name, display_name, description, params_schema...)`
- **Dependencies:** `backend.app.services.indicators.base.BaseIndicator`, `numpy`, `pandas`, `typing.Any`, `typing.Dict`, `typing.Optional`

### `backend/app/services/indicators/plugins/rsi.py`
- **Symbols:** `class RSIIndicator (name, display_name, description, params_schema...)`
- **Dependencies:** `backend.app.services.indicators.base.BaseIndicator`, `numpy`, `pandas`, `typing.Any`, `typing.Dict`, `typing.Optional`

### `backend/app/services/indicators/plugins/volume_spike.py`
- **Symbols:** `class VolumeSpikeIndicator (name, display_name, description, params_schema...)`
- **Dependencies:** `backend.app.services.indicators.base.BaseIndicator`, `numpy`, `pandas`, `typing.Any`, `typing.Dict`, `typing.Optional`

### `backend/app/services/indicators/plugins/vwap.py`
- **Symbols:** `class VWAPIndicator (name, display_name, description, params_schema...)`
- **Dependencies:** `backend.app.services.indicators.base.BaseIndicator`, `numpy`, `pandas`, `typing.Any`, `typing.Dict`, `typing.Optional`

### `backend/app/services/indicators/registry.py`
- **Symbols:** `class IndicatorRegistry (__init__, register, get, list_indicators...)`
- **Dependencies:** `backend.app.services.indicators.base.BaseIndicator`, `importlib`, `inspect`, `logging`, `pandas`, `pathlib.Path`, `typing.Any`, `typing.Dict`

### `backend/app/services/limit_fill_simulator.py`
- **Symbols:** `class LimitSetupParams`, `class LimitSetupResult`, `func simulate_limit_setup`
- **Dependencies:** `dataclasses.dataclass`, `pandas`, `typing.Any`, `typing.Optional`

### `backend/app/services/live_paper_runner.py`
- **Symbols:** `class LivePaperRunner (__init__, start, stop, get_status...)`
- **Dependencies:** `asyncio`, `backend.app.engine.trade_contract.UnifiedTradeSignal`, `backend.app.services.deep_intent_logger.DeepIntentLogger`, `backend.app.services.market_data_factory.market_data_provider`, `backend.app.services.openrouter_client.openrouter_client`, `backend.app.services.paper_trading.paper_trading_session`, `backend.app.services.position_sizer.PositionSizer`, `backend.app.services.quant_engine.quant_engine`

### `backend/app/services/market_data_factory.py`
- **Symbols:** `class ExternalPremiumAdapter (__init__, provider_id, get_orderbook_depth, get_liquidation_estimates...)`, `func get_market_data_provider`
- **Dependencies:** `backend.app.services.free_binance_collector.FreeBinanceSelfCollector`, `backend.app.services.market_data_provider.IMarketDataProvider`, `backend.app.services.market_data_provider.LiqEstimatesData`, `backend.app.services.market_data_provider.MarketSnapshot`, `backend.app.services.market_data_provider.OrderBookDepthData`, `backend.app.services.market_data_provider.UnifiedMarketDataResponse`, `os`, `typing.Optional`

### `backend/app/services/market_data_provider.py`
- **Symbols:** `class DepthDeltaSummary`, `class IMarketDataProvider (provider_id, get_orderbook_depth, get_liquidation_estimates, get_market_snapshot...)`, `class LiqEstimatesData`, `class LiqLevelEstimate`, `class MarketSnapshot`, `class OrderBookDepthData`, `class OrderBookLevel`, `class UnifiedMarketDataResponse`
- **Dependencies:** `abc.ABC`, `abc.abstractmethod`, `pydantic.BaseModel`, `pydantic.Field`, `typing.Any`, `typing.Dict`, `typing.List`, `typing.Literal`

### `backend/app/services/openrouter_client.py`
- **Symbols:** `class OpenRouterClient (__init__, is_paid_model, can_use_paid_models, get_available_models...)`
- **Dependencies:** `aiohttp`, `asyncio`, `backend.app.config.OPENROUTER_API_KEY`, `backend.app.config.OPENROUTER_DAILY_BUDGET_USD`, `backend.app.config.OPENROUTER_FALLBACK_MODEL`, `backend.app.config.OPENROUTER_FREE_MODELS`, `backend.app.config.OPENROUTER_PRIMARY_MODEL`, `backend.app.config.OPENROUTER_TIMEOUT_SEC`

### `backend/app/services/openrouter_service.py`
- **Symbols:** `class OpenRouterModelHub (__init__, fetch_available_models, get_config, save_config)`
- **Dependencies:** `aiohttp`, `backend.app.config.BASE_DIR`, `backend.app.config.OPENROUTER_API_KEY`, `json`, `pathlib.Path`, `time`, `typing.Any`, `typing.Awaitable`

### `backend/app/services/orderflow_backtester.py`
- **Symbols:** `class OrderFlowBacktester (__init__, validate_ohlcv_integrity, calculate_indicators, evaluate_latest_signal...)`
- **Dependencies:** `backend.app.engine.cluster_filters.check_cluster_filters_at_bar`, `backend.app.engine.cluster_filters.compute_bar_cluster_arrays`, `backend.app.engine.cluster_filters.compute_fee_aware_rr_bounds`, `backend.app.engine.execution.simulate_execution`, `backend.app.engine.monte_carlo.run_monte_carlo_simulation`, `backend.app.engine.strategies.compute_raw_signal`, `math`, `numpy`

### `backend/app/services/overnight_pilot.py`
- **Symbols:** `class OvernightPilotConfig (model_post_init)`, `class OvernightPilotManager (__init__, load_persisted_states, default_configs, diversified_paper_configs...)`, `class PilotSession (to_dict)`
- **Dependencies:** `asyncio`, `backend.app.db.database.AsyncSessionLocal`, `backend.app.db.models.OvernightPilotRun`, `backend.app.engine.verdict.evaluate_verdict`, `backend.app.routers.ai_copilot.compute_probabilistic_forecast`, `backend.app.routers.backtest.BacktestParams`, `backend.app.routers.backtest.BacktestRequest`, `backend.app.routers.backtest.OptimizeRequest`

### `backend/app/services/pair_selector.py`
- **Symbols:** `func build_pilot_configs`, `func evaluate_symbol_sync`, `func is_qualified`, `func load_last_selection`, `func pick_best`, `func run_selection`, `func split_train_oos`, `func summarize`
- **Dependencies:** `__future__.annotations`, `json`, `pathlib.Path`, `time`, `typing.Any`, `typing.Dict`, `typing.List`, `typing.Optional`

### `backend/app/services/paper_trading.py`
- **Symbols:** `class PaperOrder`, `class PaperOrderRole`, `class PaperPosition (risk_amount, unrealized_pnl)`, `class PaperSessionState (to_dict)`, `class PaperTradingSession (__init__, set_lifecycle_listener, set_fee_rates_percent, calculate_position_size...)`
- **Dependencies:** `backend.app.services.early_exit_engine.EarlyExitEngine`, `backend.app.services.execution_simulator.DEFAULT_MAKER_FEE`, `backend.app.services.execution_simulator.DEFAULT_ORDER_RTT_MS`, `backend.app.services.execution_simulator.DEFAULT_SIGNAL_LAG_MS`, `backend.app.services.execution_simulator.DEFAULT_TAKER_FEE`, `backend.app.services.execution_simulator.ExecutionSimulator`, `backend.app.services.execution_simulator.OrderConfig`, `backend.app.services.execution_simulator.OrderSide`

### `backend/app/services/position_sizer.py`
- **Symbols:** `class DcaLeg`, `class DcaPlan`, `class PositionSizer (__init__, fixed_fractional, budgeted_dca_ladder, portfolio_heat...)`
- **Dependencies:** `dataclasses.dataclass`, `dataclasses.field`, `typing.List`, `typing.Optional`, `typing.Sequence`, `typing.Tuple`

### `backend/app/services/quant_engine.py`
- **Symbols:** `class Core3MathReport`, `class MarketSnapshotPrompt`, `class QuantEngine (__init__, evaluate_core3_math, build_snapshot_prompt, save_to_quarantine...)`, `class QuarantineSignalRecord`
- **Dependencies:** `backend.app.services.market_data_factory.market_data_provider`, `backend.app.services.market_data_provider.LiqEstimatesData`, `backend.app.services.market_data_provider.MarketSnapshot`, `backend.app.services.market_data_provider.OrderBookDepthData`, `backend.app.services.market_data_provider.UnifiedMarketDataResponse`, `datetime.datetime`, `json`, `logging`

### `backend/app/services/recorder.py`
- **Symbols:** `class OrderFlowRecorder (__init__, get_base_price_step, get_price_bucket, record_agg_trade...)`, `func annotate_cluster_metrics`
- **Dependencies:** `asyncio`, `backend.app.config.FOCUS_SYMBOLS`, `backend.app.config.MAX_STORAGE_GB`, `backend.app.config.RECORDED_DATA_DIR`, `backend.app.config.WATCHLIST_SYMBOLS`, `datetime.date`, `datetime.datetime`, `json`

### `backend/app/services/regime_classifier.py`
- **Symbols:** `class MarketRegime`, `func bollinger_width`, `func calculate_adx`, `func calculate_true_range`, `func choppiness_index`, `func classify_market_regime`, `func compute_order_book_imbalance`, `func microstructure_gate`, `func rolling_percentile_rank`
- **Dependencies:** `__future__.annotations`, `enum`, `logging`, `math`, `numpy`, `pandas`, `typing.Any`, `typing.Dict`

### `backend/app/services/replay_engine.py`
- **Symbols:** `class ReplayEngine (__init__, build_events, stream)`, `class ReplayEvent (__init__, __repr__)`, `func book_to_lists`
- **Dependencies:** `backend.app.config.RECORDED_DATA_DIR`, `json`, `logging`, `pandas`, `pathlib.Path`, `typing.Any`, `typing.Iterator`, `typing.List`

### `backend/app/services/risk_engine.py`
- **Symbols:** `func adjusted_risk_pct`, `func calc_position_by_risk`, `func calc_pyramid_add_qty`, `func can_add_pyramid_layer`, `func can_open_position`, `func check_circuit_breaker`, `func floor_to_step`, `func select_max_leverage`
- **Dependencies:** `__future__.annotations`, `logging`, `math`, `typing.Any`, `typing.Dict`, `typing.List`, `typing.Optional`, `typing.Tuple`

### `backend/app/services/risk_manager.py`
- **Symbols:** `class CompoundingRiskEngine (__init__, risk_budget, is_entry_allowed)`, `class DailyDrawdownGuard (__init__, update, is_entry_allowed, day_start_equity)`, `class KillSwitchEvent`, `class MultiLevelKillSwitch (__init__, update, active_level, current_action...)`
- **Dependencies:** `dataclasses.dataclass`, `dataclasses.field`, `datetime.datetime`, `datetime.timezone`, `typing.List`, `typing.Optional`, `typing.Sequence`, `typing.Tuple`

### `backend/app/services/runtime_binding.py`
- **Symbols:** `func find_available_port`, `func is_healthy_backend_running`, `func persist_runtime_port`, `func persist_runtime_port_guarded`
- **Dependencies:** `__future__.annotations`, `json`, `logging`, `pathlib.Path`, `socket`, `urllib.request`

### `backend/app/services/scanner.py`
- **Symbols:** `class MarketScanner (__init__, is_in_cooldown, update_cooldown, get_active_settings...)`
- **Dependencies:** `asyncio`, `backend.app.db.database.AsyncSessionLocal`, `backend.app.db.models.DecisionLog`, `backend.app.db.models.SignalHistory`, `backend.app.db.models.UserSetting`, `backend.app.services.binance_service.binance_service`, `backend.app.services.bot.broadcast_signal`, `backend.app.services.coingecko.coingecko_service`

### `backend/app/services/session_review.py`
- **Symbols:** `func build_session_review`, `func collect_review_trades`, `func find_decision_for_trade`, `func link_trades_to_decisions`, `func summarize_session`
- **Dependencies:** `__future__.annotations`, `typing.Any`, `typing.Dict`, `typing.List`, `typing.Optional`

### `backend/app/services/think_optimizer.py`
- **Symbols:** `func analyze_post_mortem`
- **Dependencies:** `typing.Any`, `typing.Dict`

### `backend/app/services/tpo_profile.py`
- **Symbols:** `class ProfileRow`, `class TpoProfile (to_dict)`, `func build_tpo_profile`, `func infer_tick_size`, `func list_recorded_dates`, `func load_recorded_trades`
- **Dependencies:** `dataclasses.asdict`, `dataclasses.dataclass`, `dataclasses.field`, `numpy`, `pandas`, `pathlib.Path`, `typing.List`, `typing.Optional`

### `backend/app/services/trade_postmortem_service.py`
- **Symbols:** `func analyze_from_db`, `func analyze_trades`, `func classify_loss`
- **Dependencies:** `__future__.annotations`, `collections.Counter`, `collections.defaultdict`, `typing.Any`, `typing.Dict`, `typing.Iterable`, `typing.List`, `typing.Optional`

### `backend/app/services/wall_settings.py`
- **Symbols:** `class AutoDensityCalibrator (compute, effective_threshold)`, `class TrackedWall`, `class WallSettings (__post_init__)`, `class WallSettingsStore (__init__, get, update)`, `class WallTracker (__init__, update, qualified_walls)`
- **Dependencies:** `__future__.annotations`, `dataclasses.asdict`, `dataclasses.dataclass`, `dataclasses.field`, `json`, `logging`, `math`, `pathlib.Path`

### `backend/app/services/warning_sentinel.py`
- **Symbols:** `class SentinelConfig`, `class SentinelService (collect_snapshot, run_once, start, stop...)`, `func evaluate_sentinel`, `func filter_by_cooldown`, `func filter_persistent_disconnects`
- **Dependencies:** `__future__.annotations`, `asyncio`, `dataclasses.dataclass`, `dataclasses.field`, `logging`, `os`, `time`, `typing.Any`

### `backend/app/utils.py`
- **Symbols:** `func format_kyiv`, `func format_kyiv_time`, `func now_kyiv`
- **Dependencies:** `datetime.datetime`, `typing.Optional`, `zoneinfo.ZoneInfo`

### `engine/backtester.py`
- **Symbols:** `class Backtester (__init__, run)`
- **Dependencies:** `numpy`, `pandas`, `typing.Any`, `typing.Dict`, `typing.List`

### `engine/crypto_lake_loader.py`
- **Symbols:** `class CryptoLakeLoader (__init__, load_trades_file, resample_trades_to_ohlcv_delta, load_orderbook_snapshots)`
- **Dependencies:** `numpy`, `os`, `pandas`, `typing.Any`, `typing.Dict`, `typing.Optional`

### `engine/data_loader.py`
- **Symbols:** `class DataLoader (__init__, get_cache_path, fetch_historical_ohlcv, load_cryptodatadownload_csv...)`
- **Dependencies:** `ccxt`, `datetime.datetime`, `datetime.timedelta`, `io`, `os`, `pandas`, `sys`, `time`

### `engine/indicators.py`
- **Symbols:** `func add_all_indicators`
- **Dependencies:** `numpy`, `pandas`, `ta`

### `engine/optimizer.py`
- **Symbols:** `class StrategyOptimizer (__init__, optimize)`
- **Dependencies:** `engine.backtester.Backtester`, `itertools`, `pandas`, `typing.Any`, `typing.Dict`, `typing.List`

### `engine/scanner.py`
- **Symbols:** `class RealtimeScanner (__init__, scan_symbol, scan_watchlist)`
- **Dependencies:** `datetime.datetime`, `engine.data_loader.DataLoader`, `engine.indicators.add_all_indicators`, `engine.volume_profile.VolumeProfileEngine`, `io`, `pandas`, `strategies.cluster_breakout_strategy.ClusterAbsorptionStrategy`, `strategies.mtf_pullback.MTFPullbackStrategy`

### `engine/strategy_base.py`
- **Symbols:** `class BaseStrategy (__init__, generate_signals, apply_risk_levels)`
- **Dependencies:** `abc.ABC`, `abc.abstractmethod`, `numpy`, `pandas`

### `engine/volume_profile.py`
- **Symbols:** `class VolumeProfileEngine (calculate_session_profile, calculate_candle_delta_and_cvd)`
- **Dependencies:** `numpy`, `pandas`, `typing.Any`, `typing.Dict`, `typing.Tuple`

### `recorder/__main__.py`
- **Symbols:** `func main`
- **Dependencies:** `__future__.annotations`, `argparse`, `asyncio`, `config.load_config`, `json`, `logging`, `pathlib.Path`, `service.RecorderService`

### `recorder/config.py`
- **Symbols:** `class RecorderConfig`, `func load_config`
- **Dependencies:** `__future__.annotations`, `dataclasses.dataclass`, `dataclasses.field`, `pathlib.Path`, `typing.Any`, `yaml`

### `recorder/events.py`
- **Symbols:** `func normalize_agg_trade`, `func normalize_message`
- **Dependencies:** `__future__.annotations`, `time`, `typing.Any`

### `recorder/gaps.py`
- **Symbols:** `class GapJournal (__init__, record)`
- **Dependencies:** `__future__.annotations`, `json`, `pathlib.Path`, `typing.Any`

### `recorder/manifest.py`
- **Symbols:** `func build_data_manifest`, `func write_data_manifest`
- **Dependencies:** `__future__.annotations`, `datetime.datetime`, `datetime.timezone`, `json`, `pathlib.Path`, `typing.Any`

### `recorder/service.py`
- **Symbols:** `class DiskPolicy (__init__, allows)`, `class RecorderService (__init__, process_message, flush, status...)`
- **Dependencies:** `__future__.annotations`, `asyncio`, `events.normalize_message`, `gaps.GapJournal`, `json`, `logging`, `pathlib.Path`, `storage.LakeWriter`

### `recorder/storage.py`
- **Symbols:** `class LakeWriter (__init__, close_segment)`, `class SpoolJournal (__init__, append, flush, close...)`
- **Dependencies:** `__future__.annotations`, `datetime.datetime`, `datetime.timezone`, `hashlib`, `json`, `os`, `pathlib.Path`, `pyarrow`

### `strategies/cluster_breakout_strategy.py`
- **Symbols:** `class ClusterAbsorptionStrategy (__init__, generate_signals)`
- **Dependencies:** `engine.strategy_base.BaseStrategy`, `engine.volume_profile.VolumeProfileEngine`, `numpy`, `pandas`

### `strategies/mtf_pullback.py`
- **Symbols:** `class MTFPullbackStrategy (__init__, generate_signals)`
- **Dependencies:** `engine.strategy_base.BaseStrategy`, `numpy`, `pandas`

## 2. Frontend React / Vite Modules

### `frontend/src/App.jsx`
- **Exports:** `export App`
- **Imports:** `./components/BacktestPanel`, `./components/Chart`, `./components/IndicatorsModal`, `./components/OrderBookDOM`, `./components/ScalperTradeDesk`, `./components/SettingsModal`

### `frontend/src/components/AICopilotSidebar.jsx`
- **Exports:** `export AICopilotSidebar`
- **Imports:** `../stores/backtestStore`, `./copilot/AnalysisResults`, `./copilot/ChatMessages`, `./copilot/CopilotHeader`, `./copilot/DataFeedContextCard`, `./copilot/ExpressAnalysisCard`

### `frontend/src/components/AIEngineSettings.jsx`
- **Exports:** `export AIEngineSettings`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/app/AppTopBar.jsx`
- **Exports:** `export AppTopBar`
- **Imports:** `../../stores/alertsStore`, `../../stores/layoutStore`, `./constants`, `@/components/ui/dropdown-menu`, `lucide-react`, `react`

### `frontend/src/components/app/constants.js`
- **Exports:** `export POPULAR_SYMBOLS`, `export THEME_BADGE`, `export TIMEFRAMES`

### `frontend/src/components/app/ModalsHost.jsx`
- **Exports:** `export ModalsHost`
- **Imports:** `../../services/marketTruth`, `../AICopilotSidebar`, `../DecisionJournalModal`, `../IndicatorsModal`, `../ReplayModal`, `../SettingsModal`

### `frontend/src/components/AssistantHUD.jsx`
- **Exports:** `export AssistantHUD`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/backtest/constants.js`
- **Exports:** `export STRATEGIES`, `export TIMEFRAMES`

### `frontend/src/components/backtest/fields.jsx`
- **Exports:** `export InfoTip`, `export NumField`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/backtest/format.js`
- **Exports:** `export fmtPrice`, `export fmtTime`

### `frontend/src/components/backtest/MonteCarloEquityChart.jsx`
- **Exports:** `export MonteCarloEquityChart`

### `frontend/src/components/chart/BtTooltipOverlay.jsx`
- **Exports:** `export BtTooltipOverlay`
- **Imports:** `react`

### `frontend/src/components/chart/ChartContextMenu.jsx`
- **Exports:** `export ChartContextMenu`, `export useChartContextMenu`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/chart/ChartLegend.jsx`
- **Exports:** `export ChartLegend`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/chart/chartStyles.js`
- **Exports:** `export buildChartStyles`
- **Imports:** `../../theme/themeBridge.js`

### `frontend/src/components/chart/ChartToolbar.jsx`
- **Exports:** `export ChartToolbar`
- **Imports:** `../../services/crosshairBus`, `../docking/ChannelSelector`, `./useChartOverlays.js`, `@/components/ui/dropdown-menu`, `@/components/ui/popover`, `lucide-react`

### `frontend/src/components/chart/densityHeatmapMath.js`
- **Exports:** `export maxVolumeOf`, `export pointStyle`, `export selectDensityPoints`, `export splatGeometry`

### `frontend/src/components/chart/engine/ChartEngine.js`
- **Exports:** `export CHART_ENGINE_METHODS`, `export missingEngineMethods`

### `frontend/src/components/chart/engine/KLineChartsV9Adapter.js`
- **Exports:** `export createKLineChartsV9Adapter`
- **Imports:** `../chartStyles.js`, `klinecharts`

### `frontend/src/components/chart/FootprintCanvasLayer.jsx`
- **Exports:** `export DEFAULT_FP_SETTINGS`, `export FootprintCanvasLayer`
- **Imports:** `../../services/marketDataFetcher.js`, `../../theme/themeBridge.js`, `../docking/footprintGrid.js`, `../ui/slider.jsx`, `./footprintLayerMath.js`, `./onChartDomMath.js`

### `frontend/src/components/chart/footprintLayerMath.js`
- **Exports:** `export CLUSTER_BUCKET_MS`, `export computeBarMetrics`, `export computeNakedPocs`, `export createFrameStats`, `export isTfSupported`, `export lodFor`, `export mergeClustersToTf`, `export rebinLevels`
- **Imports:** `../docking/footprintGrid.js`

### `frontend/src/components/chart/IndicatorsDock.jsx`
- **Exports:** `export IndicatorsDock`
- **Imports:** `../indicators/IndicatorSettingsDialog`, `../indicators/IndicatorsModal`, `react`

### `frontend/src/components/chart/labelLayout.js`
- **Exports:** `export PRIORITY_RANKS`, `export formatLabelAmount`, `export layoutLabels`

### `frontend/src/components/chart/LiquidationHeatmapGL.jsx`
- **Exports:** `export LiquidationHeatmapGL`
- **Imports:** `../ui/slider.jsx`, `./liquidationHeatmapMath.js`, `react`, `react-dom`

### `frontend/src/components/chart/liquidationHeatmapMath.js`
- **Exports:** `export PALETTES`, `export liquidationSplatGeometry`, `export liquidationsToHeatmapPoints`, `export samplePalette`

### `frontend/src/components/chart/livePositions.js`
- **Exports:** `export collectOpenPositions`

### `frontend/src/components/chart/OnChartDOM.jsx`
- **Exports:** `export DEFAULT_DOM_SETTINGS`, `export OnChartDOM`
- **Imports:** `../../services/crosshairBus.js`, `../../stores/liquidityWallStore.js`, `../../theme/themeBridge.js`, `../ui/slider.jsx`, `./onChartDomMath.js`, `lucide-react`

### `frontend/src/components/chart/onChartDomMath.js`
- **Exports:** `export barLength`, `export buildDomBins`, `export estimateTick`, `export fmtLife`, `export fmtUsdCompact`, `export hexToRgba`, `export niceBinSize`
- **Imports:** `../../stores/liquidityWallStore.js`

### `frontend/src/components/chart/PositionSetupHUD.jsx`
- **Exports:** `export PositionSetupHUD`
- **Imports:** `lucide-react`

### `frontend/src/components/chart/registerCustomElements.js`
- **Imports:** `../../stores/tradeOverlayStore`, `klinecharts`

### `frontend/src/components/chart/SaveTemplateModal.jsx`
- **Exports:** `export SaveTemplateModal`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/chart/ToxicVolatilityOverlay.jsx`
- **Exports:** `export ToxicVolatilityOverlay`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/chart/useChartAnnotations.js`
- **Exports:** `export useChartAnnotations`
- **Imports:** `../../services/marketDataFetcher`, `../../stores/marketDataStore`, `../../stores/tradesStore`, `../../utils/chartAnnotations`, `./livePositions`, `react`

### `frontend/src/components/chart/useChartDrawings.js`
- **Exports:** `export useChartDrawings`
- **Imports:** `../../config/drawingTemplates`, `../../stores/tradeOverlayStore`, `react`

### `frontend/src/components/chart/useChartIndicators.js`
- **Exports:** `export useChartIndicators`
- **Imports:** `../../config/indicatorsRegistry`, `./chartStyles.js`, `react`

### `frontend/src/components/chart/useChartLifecycle.js`
- **Exports:** `export useChartLifecycle`
- **Imports:** `../../services/crosshairBus`, `../../services/marketDataFetcher`, `../../theme/themeBridge.js`, `./engine/KLineChartsV9Adapter.js`, `react`

### `frontend/src/components/chart/useChartOverlays.js`
- **Exports:** `export TPO_SETTINGS_DEFAULTS`, `export WALL_SETTINGS_DEFAULTS`, `export useChartOverlays`
- **Imports:** `./densityHeatmapMath.js`, `react`

### `frontend/src/components/chart/useSecondOpinion.js`
- **Exports:** `export useSecondOpinion`
- **Imports:** `../../stores/tradeOverlayStore`, `react`

### `frontend/src/components/Chart.jsx`
- **Exports:** `export Chart`
- **Imports:** `../config/indicatorsRegistry`, `../services/marketDataFetcher`, `../stores/backtestStore`, `../stores/colorLinksStore`, `../stores/layoutStore`, `../stores/marketDataStore`

### `frontend/src/components/ConfluenceWeightsEditor.jsx`
- **Exports:** `export ConfluenceWeightsEditor`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/copilot/AnalysisResults.jsx`
- **Exports:** `export AnalysisResults`
- **Imports:** `./ExpectedValueCard`, `./LiquidityMagnetCard`, `./TradeSetupCard`, `./VolatilityConeCard`, `react`

### `frontend/src/components/copilot/ChatMessages.jsx`
- **Exports:** `export ChatMessages`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/copilot/CopilotHeader.jsx`
- **Exports:** `export CopilotHeader`
- **Imports:** `./constants`, `lucide-react`, `react`

### `frontend/src/components/copilot/DataFeedContextCard.jsx`
- **Exports:** `export DataFeedContextCard`
- **Imports:** `react`

### `frontend/src/components/copilot/ExpectedValueCard.jsx`
- **Exports:** `export ExpectedValueCard`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/copilot/ExpressAnalysisCard.jsx`
- **Exports:** `export ExpressAnalysisCard`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/copilot/HealthMeterCard.jsx`
- **Exports:** `export HealthMeterCard`
- **Imports:** `react`

### `frontend/src/components/copilot/LiquidityMagnetCard.jsx`
- **Exports:** `export LiquidityMagnetCard`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/copilot/QuickPromptChips.jsx`
- **Exports:** `export QuickPromptChips`
- **Imports:** `react`

### `frontend/src/components/copilot/SweepLeaderboardCard.jsx`
- **Exports:** `export SweepLeaderboardCard`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/copilot/TradeSetupCard.jsx`
- **Exports:** `export TradeSetupCard`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/copilot/VolatilityConeCard.jsx`
- **Exports:** `export VolatilityConeCard`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/DecisionJournalModal.jsx`
- **Exports:** `export DecisionJournalModal`
- **Imports:** `./SessionReviewPanel`, `./ui/SymbolLink.jsx`, `./ui/select.jsx`, `lucide-react`, `react`

### `frontend/src/components/DepthHeatmapGL.jsx`
- **Exports:** `export DepthHeatmapGL`
- **Imports:** `./chart/densityHeatmapMath.js`, `react`

### `frontend/src/components/design-previews/ChartCanvasOverlay.jsx`
- **Exports:** `export ChartCanvasOverlay`
- **Imports:** `../../theme/themeBridge`, `../chart/labelLayout.js`, `react`

### `frontend/src/components/design-previews/LayerToolbar.jsx`
- **Exports:** `export LayerToolbar`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/design-previews/LiqAnalyticsPanel.jsx`
- **Exports:** `export LiqAnalyticsPanel`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/design-previews/QuantDecisionConsilium.jsx`
- **Exports:** `export QuantDecisionConsilium`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/docking/AlertsModal.jsx`
- **Exports:** `export AlertsModal`
- **Imports:** `../../services/marketTruth.js`, `../../stores/alertsStore`, `../ui/select.jsx`, `lucide-react`, `react`

### `frontend/src/components/docking/AutoSelectPanel.jsx`
- **Exports:** `export AutoSelectPanel`
- **Imports:** `@/components/ui/checkbox`, `react`

### `frontend/src/components/docking/ChannelSelector.jsx`
- **Exports:** `export ChannelSelector`
- **Imports:** `../../stores/colorLinksStore`, `lucide-react`, `react`

### `frontend/src/components/docking/footprintGrid.js`
- **Exports:** `export IMBALANCE_RATIO`, `export buildFootprintGrid`, `export buildSessionProfile`, `export cellIntensity`, `export cellSide`, `export detectImbalance`, `export fmtTime`, `export fmtVol`

### `frontend/src/components/docking/FootprintPanel.jsx`
- **Exports:** `export FootprintPanel`
- **Imports:** `../../stores/colorLinksStore`, `./ChannelSelector`, `./footprintGrid`, `lucide-react`, `react`

### `frontend/src/components/docking/layoutRecovery.js`
- **Exports:** `export persistChartPanelTimeframe`, `export persistDockviewLayoutLocally`, `export readCachedDockviewLayout`, `export readChartPanelTimeframe`, `export resolveDockviewLayout`

### `frontend/src/components/docking/layoutSanitizer.js`
- **Exports:** `export DOCKVIEW_COMPONENT_IDS`, `export sanitizeDockviewLayout`

### `frontend/src/components/docking/marathonFeed.js`
- **Exports:** `export collectMarathonPositions`, `export collectMarathonTrades`, `export hasMarathonData`, `export mergePaperLists`

### `frontend/src/components/docking/PairControlRowActions.jsx`
- **Exports:** `export PairControlRowActions`
- **Imports:** `@/components/ui/alert-dialog`, `@/components/ui/badge`, `@/components/ui/button`, `@/components/ui/checkbox`, `@/components/ui/tooltip`, `lucide-react`

### `frontend/src/components/docking/paperPairs.js`
- **Exports:** `export AVAILABLE_STRATEGIES`, `export POPULAR_COINS`, `export collectCandidateSetups`, `export collectPaperPairs`, `export filterPaperPairs`, `export pairTotalPnl`, `export sortPaperPairs`

### `frontend/src/components/docking/Placeholders.jsx`
- **Exports:** `export CvdPlaceholderWidget`
- **Imports:** `../../stores/colorLinksStore`, `./ChannelSelector`, `lucide-react`, `react`

### `frontend/src/components/docking/PostMortemAnalyticsTab.jsx`
- **Exports:** `export PostMortemAnalyticsTab`
- **Imports:** `./AutoSelectPanel`, `react`

### `frontend/src/components/docking/PresetBar.jsx`
- **Exports:** `export PresetBar`
- **Imports:** `../../stores/layoutStore`, `lucide-react`, `react`

### `frontend/src/components/docking/ScreenerWidget.jsx`
- **Exports:** `export ScreenerWidget`
- **Imports:** `../../config/coinLibrary`, `../../stores/colorLinksStore`, `../../stores/marketDataStore`, `./ChannelSelector`, `lucide-react`, `react`

### `frontend/src/components/docking/TerminalDockview.jsx`
- **Exports:** `export TerminalDockview`
- **Imports:** `../../services/marketTruth.js`, `../../stores/backtestStore`, `../../stores/colorLinksStore`, `../../stores/layoutStore`, `../../stores/quantStore`, `../../stores/tradeOverlayStore`

### `frontend/src/components/docking/TradeHistoryWidget.jsx`
- **Exports:** `export TradeHistoryWidget`
- **Imports:** `../../stores/backtestStore`, `../../stores/colorLinksStore`, `./PairControlRowActions`, `./PostMortemAnalyticsTab`, `./marathonFeed`, `./paperPairs`

### `frontend/src/components/docking/TradesSettings.jsx`
- **Exports:** `export DEFAULT_TRADES_SETTINGS`, `export TradesSettings`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/docking/TradesWidget.jsx`
- **Exports:** `export TradesWidget`
- **Imports:** `../../hooks/useTradeAudioAlerts`, `../../services/crosshairBus`, `../../stores/colorLinksStore`, `../../stores/tradesStore`, `../../theme/themeBridge`, `./ChannelSelector`

### `frontend/src/components/docking/WatchlistWidget.jsx`
- **Imports:** `./ScreenerWidget`

### `frontend/src/components/docking/WidgetHubModal.jsx`
- **Exports:** `export WidgetHubModal`
- **Imports:** `../../stores/layoutStore`, `lucide-react`, `react`

### `frontend/src/components/docking/WorkspaceScroller.jsx`
- **Exports:** `export WorkspaceScroller`
- **Imports:** `../../stores/layoutStore`, `../../theme/screenTiers`, `react`

### `frontend/src/components/dom/constants.js`
- **Exports:** `export BUFFER_ROWS`, `export ROW_HEIGHT`, `export SCALE_OPTIONS`, `export TOTAL_ROWS`

### `frontend/src/components/dom/DOMControlsHeader.jsx`
- **Exports:** `export DOMControlsHeader`
- **Imports:** `./constants`, `lucide-react`, `react`

### `frontend/src/components/dom/useAggregatedOrderbook.js`
- **Exports:** `export useAggregatedOrderbook`
- **Imports:** `../../utils/orderbookLogic`, `../../utils/sound`, `react`

### `frontend/src/components/dom/useDepthStream.js`
- **Exports:** `export useDepthStream`
- **Imports:** `./constants`, `react`

### `frontend/src/components/ErrorBoundary.jsx`
- **Exports:** `export ErrorBoundary`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/indicators/ActiveIndicatorStack.jsx`
- **Exports:** `export ActiveIndicatorStack`
- **Imports:** `../../config/indicatorsRegistry`, `lucide-react`, `react`

### `frontend/src/components/indicators/IndicatorSettingsDialog.jsx`
- **Exports:** `export IndicatorSettingsDialog`
- **Imports:** `../../config/indicatorsRegistry`, `../ui/slider.jsx`, `lucide-react`, `react`

### `frontend/src/components/indicators/IndicatorsModal.jsx`
- **Exports:** `export IndicatorsModal`
- **Imports:** `../../config/indicatorsRegistry`, `lucide-react`, `react`

### `frontend/src/components/IndicatorsModal.jsx`
- **Exports:** `export DEFAULT_INDICATORS_CONFIG`, `export DEFAULT_INDICATORS_SETTINGS`, `export IndicatorsModal`, `export loadChartIndicators`, `export saveChartIndicators`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/LivePaperTradingView.jsx`
- **Exports:** `export LiveEquityChart`, `export LivePaperTradingControls`, `export LivePaperTradingResults`
- **Imports:** `../stores/backtestStore`, `./ui/SymbolLink.jsx`, `./ui/alert-dialog.jsx`, `./ui/badge.jsx`, `./ui/button.jsx`, `lucide-react`

### `frontend/src/components/OrderBook.jsx`
- **Exports:** `export OrderBook`
- **Imports:** `../utils/orderbookLogic`, `../utils/sound`, `lucide-react`, `react`

### `frontend/src/components/OrderBookCanvasLadder.jsx`
- **Exports:** `export OrderBookCanvasLadder`
- **Imports:** `../services/crosshairBus`, `../stores/tradeOverlayStore`, `../theme/themeBridge`, `react`

### `frontend/src/components/OrderBookDOM.jsx`
- **Exports:** `export OrderBookDOM`
- **Imports:** `./OrderBookCanvasLadder`, `./dom/DOMControlsHeader`, `./dom/constants`, `./dom/useAggregatedOrderbook`, `./dom/useDepthStream`, `lucide-react`

### `frontend/src/components/OvernightPilotPanel.jsx`
- **Exports:** `export OvernightPilotPanel`
- **Imports:** `./ui/SymbolLink.jsx`, `./ui/alert-dialog.jsx`, `./ui/badge.jsx`, `./ui/button.jsx`, `react`

### `frontend/src/components/PaperTradePanel.jsx`
- **Exports:** `export PaperTradePanel`
- **Imports:** `react`

### `frontend/src/components/RecorderModal.jsx`
- **Exports:** `export RecorderModal`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/ReplayModal.jsx`
- **Exports:** `export ReplayModal`
- **Imports:** `../features/replay/replayPlayerMath.js`, `lucide-react`, `react`

### `frontend/src/components/ScalperTradeDesk.jsx`
- **Exports:** `export ScalperTradeDesk`
- **Imports:** `../utils/sound`, `lucide-react`, `react`

### `frontend/src/components/SessionReviewPanel.jsx`
- **Exports:** `export SessionReviewPanel`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/settings/AppearanceTab.jsx`
- **Exports:** `export AppearanceTab`
- **Imports:** `../../theme/screenTiers`, `../../theme/themeBridge`, `../ui/slider.jsx`, `./uiConfig`, `react`

### `frontend/src/components/settings/ChartsTab.jsx`
- **Exports:** `export ChartsTab`
- **Imports:** `@/components/ui/checkbox`, `@/components/ui/input`, `@/components/ui/number-input`, `react`

### `frontend/src/components/settings/constants.js`
- **Exports:** `export OVERRIDE_COINS`, `export TIMEFRAMES`

### `frontend/src/components/settings/OrderflowTab.jsx`
- **Exports:** `export OrderflowTab`
- **Imports:** `../ui/slider.jsx`, `@/components/ui/input`, `@/components/ui/number-input`, `react`

### `frontend/src/components/settings/ScannerTab.jsx`
- **Exports:** `export ScannerTab`
- **Imports:** `./constants`, `@/components/ui/input`, `@/components/ui/number-input`, `lucide-react`, `react`

### `frontend/src/components/settings/uiConfig.js`
- **Exports:** `export DEFAULT_UI_CONFIG`, `export MONO_FONTS`, `export THEME_PRESETS`, `export applyTheme`, `export applyUiConfigToDOM`, `export loadLocalUiConfig`
- **Imports:** `../../theme/themeBridge.js`, `../../theme/themeMeta.js`

### `frontend/src/components/settings/VisibilityTab.jsx`
- **Exports:** `export DEFAULT_VISIBILITY`, `export VISIBILITY_PRESETS`, `export VisibilityTab`, `export persistVisibility`, `export readStoredVisibility`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/SettingsModal.jsx`
- **Exports:** `export SettingsModal`
- **Imports:** `./AIEngineSettings`, `./ConfluenceWeightsEditor`, `./settings/AppearanceTab`, `./settings/ChartsTab`, `./settings/OrderflowTab`, `./settings/ScannerTab`

### `frontend/src/components/SignalsFeed.jsx`
- **Exports:** `export SignalsFeed`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/Tape.jsx`
- **Exports:** `export Tape`
- **Imports:** `lucide-react`, `react`

### `frontend/src/components/ui/accordion.jsx`
- **Imports:** `@/lib/utils`, `@radix-ui/react-accordion`, `lucide-react`, `react`

### `frontend/src/components/ui/alert-dialog.jsx`
- **Imports:** `@/components/ui/button`, `@/lib/utils`, `@radix-ui/react-alert-dialog`, `react`

### `frontend/src/components/ui/badge.jsx`
- **Imports:** `@/lib/utils`, `class-variance-authority`, `react`

### `frontend/src/components/ui/button.jsx`
- **Imports:** `@/lib/utils`, `@radix-ui/react-slot`, `class-variance-authority`, `react`

### `frontend/src/components/ui/card.jsx`
- **Imports:** `@/lib/utils`, `react`

### `frontend/src/components/ui/checkbox.jsx`
- **Imports:** `@/lib/utils`, `@radix-ui/react-checkbox`, `lucide-react`, `react`

### `frontend/src/components/ui/context-menu.jsx`
- **Imports:** `@/lib/utils`, `@radix-ui/react-context-menu`, `lucide-react`, `react`

### `frontend/src/components/ui/customPrimitives.jsx`
- **Exports:** `export EmptyState`, `export Kbd`, `export KpiCard`, `export SectionHeader`, `export StatusDot`
- **Imports:** `@/lib/utils`, `react`

### `frontend/src/components/ui/DataTableHeader.jsx`
- **Exports:** `export DataTableHeader`
- **Imports:** `@/components/ui/checkbox`, `@/components/ui/dropdown-menu`, `lucide-react`, `react`

### `frontend/src/components/ui/dialog.jsx`
- **Imports:** `@/lib/utils`, `@radix-ui/react-dialog`, `lucide-react`, `react`

### `frontend/src/components/ui/dropdown-menu.jsx`
- **Imports:** `@/lib/utils`, `@radix-ui/react-dropdown-menu`, `lucide-react`, `react`

### `frontend/src/components/ui/input.jsx`
- **Imports:** `@/lib/utils`, `react`

### `frontend/src/components/ui/label.jsx`
- **Imports:** `@/lib/utils`, `@radix-ui/react-label`, `class-variance-authority`, `react`

### `frontend/src/components/ui/number-input.jsx`
- **Imports:** `./input`, `@/lib/utils`, `react`

### `frontend/src/components/ui/popover.jsx`
- **Imports:** `@/lib/utils`, `@radix-ui/react-popover`, `react`

### `frontend/src/components/ui/scroll-area.jsx`
- **Imports:** `@/lib/utils`, `@radix-ui/react-scroll-area`, `react`

### `frontend/src/components/ui/section-header.jsx`
- **Exports:** `export SectionHeader`
- **Imports:** `react`

### `frontend/src/components/ui/select.jsx`
- **Imports:** `@/lib/utils`, `@radix-ui/react-select`, `lucide-react`, `react`

### `frontend/src/components/ui/separator.jsx`
- **Imports:** `@/lib/utils`, `@radix-ui/react-separator`, `react`

### `frontend/src/components/ui/slider.jsx`
- **Imports:** `@/lib/utils`, `@radix-ui/react-slider`, `react`

### `frontend/src/components/ui/switch.jsx`
- **Imports:** `@/lib/utils`, `@radix-ui/react-switch`, `react`

### `frontend/src/components/ui/SymbolLink.jsx`
- **Exports:** `export SymbolLink`
- **Imports:** `../../stores/colorLinksStore`, `react`

### `frontend/src/components/ui/table.jsx`
- **Imports:** `@/lib/utils`, `react`

### `frontend/src/components/ui/tabs.jsx`
- **Imports:** `@/lib/utils`, `@radix-ui/react-tabs`, `react`

### `frontend/src/components/ui/toggle-group.jsx`
- **Imports:** `@/components/ui/toggle`, `@/lib/utils`, `@radix-ui/react-toggle-group`, `react`

### `frontend/src/components/ui/toggle.jsx`
- **Imports:** `@/lib/utils`, `@radix-ui/react-toggle`, `class-variance-authority`, `react`

### `frontend/src/components/ui/tooltip.jsx`
- **Imports:** `@/lib/utils`, `@radix-ui/react-tooltip`, `react`

### `frontend/src/components/ui/useTableColumns.js`
- **Exports:** `export useTableColumns`
- **Imports:** `react`

### `frontend/src/components/UiKitShowcase.jsx`
- **Exports:** `export UiKitShowcase`
- **Imports:** `@/components/ui/badge`, `@/components/ui/button`, `@/components/ui/customPrimitives`, `@/components/ui/input`, `@/components/ui/tooltip`, `@/theme/themeBridge`

### `frontend/src/config/coinLibrary.js`
- **Exports:** `export COIN_REGISTRY`, `export DEFAULT_FOCUS_LIST`, `export EXCHANGES`, `export getCoinMeta`

### `frontend/src/config/drawingTemplates.js`
- **Exports:** `export PRESEEDED_SMC_TEMPLATES`, `export deleteCustomTemplate`, `export getAllTemplates`, `export getStyleMemory`, `export saveCustomTemplate`, `export saveStyleMemory`

### `frontend/src/config/indicatorsRegistry.js`
- **Exports:** `export DEFAULT_ACTIVE_INDICATORS`, `export INDICATORS_REGISTRY`, `export INDICATOR_CATEGORIES`

### `frontend/src/DesignShowcase.jsx`
- **Exports:** `export DesignShowcase`
- **Imports:** `./components/design-previews/ChartCanvasOverlay`, `./components/design-previews/LayerToolbar`, `./components/design-previews/LiqAnalyticsPanel`, `./components/design-previews/QuantDecisionConsilium`, `./theme/themes`, `lucide-react`

### `frontend/src/features/pilot/api.js`
- **Exports:** `export pilotApi`

### `frontend/src/features/pilot/model.js`
- **Exports:** `export STRATEGIES`, `export allocateCapital`, `export configKey`, `export describePilotEvent`, `export hasRunning`, `export optimizedPatch`, `export optimizerRequest`, `export paperStatusLabel`

### `frontend/src/features/pilot/PilotConfig.jsx`
- **Exports:** `export NumberField`, `export PilotConfig`, `export button`, `export control`
- **Imports:** `./model.js`, `react`

### `frontend/src/features/pilot/PilotDashboard.jsx`
- **Exports:** `export PilotDashboard`
- **Imports:** `./PilotResults.jsx`, `./model.js`, `react`

### `frontend/src/features/pilot/PilotResults.jsx`
- **Exports:** `export Forecast`, `export Metrics`, `export PilotResults`, `export Report`, `export number`, `export time`
- **Imports:** `./PilotConfig.jsx`, `./model.js`, `react`

### `frontend/src/features/pilot/PilotWorkspace.jsx`
- **Exports:** `export PilotDialog`, `export PilotWorkspace`
- **Imports:** `./PilotConfig.jsx`, `./PilotDashboard.jsx`, `./PilotResults.jsx`, `./model.js`, `./store.js`, `react`

### `frontend/src/features/pilot/store.js`
- **Exports:** `export createPilotStore`
- **Imports:** `./api.js`, `./model.js`, `zustand/middleware`, `zustand/vanilla`

### `frontend/src/features/replay/replayPlayerMath.js`
- **Exports:** `export BOOK_LEVELS`, `export PRICE_SERIES_MAX`, `export advancePlayback`, `export applyReplayEvent`, `export bookToBars`, `export createInitialPlayerState`, `export cvdOf`

### `frontend/src/hooks/useTradeAudioAlerts.js`
- **Exports:** `export useTradeAudioAlerts`
- **Imports:** `react`

### `frontend/src/lib/utils.js`
- **Exports:** `export cn`
- **Imports:** `clsx`, `tailwind-merge`

### `frontend/src/main.jsx`
- **Imports:** `./App.jsx`, `./DesignShowcase.jsx`, `./components/ErrorBoundary.jsx`, `react`, `react-dom/client`

### `frontend/src/services/crosshairBus.js`
- **Exports:** `export crosshairBus`

### `frontend/src/services/marketDataFetcher.js`
- **Exports:** `export TF_MS`, `export getCandlesFromCache`, `export mapTimeframeToBinance`, `export normalizeCandle`, `export resampleCandles`, `export saveCandlesToCache`

### `frontend/src/services/marketTruth.js`
- **Exports:** `export getUsableMarketPrice`, `export resolveAlertPriceInput`

### `frontend/src/stores/alertsStore.js`
- **Exports:** `export useAlertsStore`
- **Imports:** `zustand`

### `frontend/src/stores/colorLinksStore.js`
- **Exports:** `export COLOR_CHANNELS`, `export useColorLinksStore`
- **Imports:** `zustand`, `zustand/middleware`

### `frontend/src/stores/layoutStore.js`
- **Exports:** `export useLayoutStore`
- **Imports:** `../components/docking/layoutRecovery.js`, `zustand`

### `frontend/src/stores/liquidityWallStore.js`
- **Exports:** `export binLevels`, `export createWallTracker`, `export getWallsForSymbol`, `export useLiquidityWallStore`
- **Imports:** `zustand`

### `frontend/src/stores/marketDataStore.js`
- **Exports:** `export useMarketDataStore`
- **Imports:** `../config/coinLibrary.js`, `../utils/researchVerdict.js`, `zustand`

### `frontend/src/stores/quantStore.js`
- **Exports:** `export useQuantStore`
- **Imports:** `zustand`, `zustand/middleware`

### `frontend/src/stores/tradeOverlayStore.js`
- **Exports:** `export calculatePositionMetrics`, `export useTradeOverlayStore`
- **Imports:** `zustand`

### `frontend/src/stores/tradesStore.js`
- **Exports:** `export formatCompact`, `export formatPrice`, `export useTradesStore`
- **Imports:** `./marketDataStore`, `zustand`

### `frontend/src/theme/screenTiers.js`
- **Exports:** `export SCREEN_TIERS`, `export calculateAutoScale`, `export getTierForWidth`

### `frontend/src/theme/themeBridge.js`
- **Exports:** `export themeBridge`
- **Imports:** `./screenTiers.js`, `./themeMeta.js`

### `frontend/src/theme/themeMeta.js`
- **Exports:** `export DEFAULT_THEME_ID`, `export THEMES`, `export THEME_ALIASES`

### `frontend/src/theme/themes.js`
- **Exports:** `export CANDLE_MODES`, `export LIQUIDATION_PALETTES`, `export THEME_PRESETS`, `export applyThemeToDOM`
- **Imports:** `./themeBridge.js`, `./themeMeta.js`

### `frontend/src/utils/chartAnnotations.js`
- **Exports:** `export clearBacktestTrades`, `export clearLiveSignals`, `export clearWhaleTrades`, `export renderBacktestTrades`, `export renderLiveSignals`, `export renderWhaleTrades`

### `frontend/src/utils/orderbookLogic.js`
- **Exports:** `export aggregateDepth`, `export detectSpoofOrFill`, `export evaluateProximityAlert`

### `frontend/src/utils/researchVerdict.js`
- **Exports:** `export buildResearchVerdict`, `export deterministicSignalId`

### `frontend/src/utils/sound.js`
- **Exports:** `export soundManager`
