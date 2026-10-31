# SignalScript Code Map

> Generated automatically by `scripts/gen_codemap.py`; do not edit manually.
> Python uses `ast`; JS/TS uses deterministic export/import/call regexes.
> Run `python scripts/gen_codemap.py`; use `--check` in CI.

Each entry is `file → public symbols → direct call targets/imports → importing callers`.
JS/TS call targets are lexical candidates, not a type-resolved call graph.

## 1. Python modules

### `backend/app/__init__.py`
- **Public symbols:** —
- **Calls / imports:** —
- **Imported by:** —

### `backend/app/adapters/exchange/__init__.py`
- **Public symbols:** —
- **Calls / imports:** `backend.app.adapters.exchange.base.BaseExchangeAdapter`, `backend.app.adapters.exchange.binance.BinanceAdapter`, `backend.app.adapters.exchange.bybit.BybitAdapter`
- **Imported by:** —

### `backend/app/adapters/exchange/base.py`
- **Public symbols:** `BaseExchangeAdapter`
- **Calls / imports:** `abc.ABC`, `abc.abstractmethod`, `pandas`, `typing.Any`, `typing.Dict`, `typing.List`, `typing.Optional`
- **Imported by:** `backend/app/adapters/exchange/__init__.py`, `backend/app/adapters/exchange/binance.py`, `backend/app/adapters/exchange/bybit.py`

### `backend/app/adapters/exchange/binance.py`
- **Public symbols:** `BinanceAdapter`
- **Calls / imports:** `ClientSession`, `ClientTimeout`, `DataFrame`, `ValueError`, `agg`, `append`, `close`, `cumsum`, `dict`, `drop_duplicates`, …
- **Imported by:** `backend/app/adapters/exchange/__init__.py`, `backend/app/routers/backtest.py`

### `backend/app/adapters/exchange/bybit.py`
- **Public symbols:** `BybitAdapter`
- **Calls / imports:** `ClientSession`, `ClientTimeout`, `DataFrame`, `ValueError`, `agg`, `append`, `close`, `cumsum`, `dropna`, `endswith`, …
- **Imported by:** `backend/app/adapters/exchange/__init__.py`

### `backend/app/api/__init__.py`
- **Public symbols:** —
- **Calls / imports:** —
- **Imported by:** —

### `backend/app/api/data_routes.py`
- **Public symbols:** `BacktestRequestSchema`, `RecorderConfigSchema`, `export_recorded_data`, `get_clusters`, `get_recorder_status`, `get_tpo_profile`, `update_recorder_config`
- **Calls / imports:** `APIRouter`, `FileResponse`, `HTTPException`, `Query`, `build_tpo_profile`, `exists`, `export_dataset_zip`, `get`, `get_clusters_for_chart`, `get_storage_stats`, …
- **Imported by:** —

### `backend/app/api/routes.py`
- **Public symbols:** `DrawingSaveSchema`, `SettingsSchema`, `SignalCreateSchema`, `create_signal`, `get_coin_settings`, `get_depth`, `get_drawings`, `get_heatmap`, `get_indicators`, `get_klines`, …
- **Calls / imports:** `APIRouter`, `Depends`, `DrawingData`, `HTTPException`, `Query`, `SignalHistory`, `UserSetting`, `add`, `all`, `append`, …
- **Imported by:** —

### `backend/app/config.py`
- **Public symbols:** —
- **Calls / imports:** `Path`, `float`, `getenv`, `int`, `load_dotenv`, `mkdir`, `resolve`, `split`, `strip`, `upper`
- **Imported by:** `backend/app/adapters/exchange/binance.py`, `backend/app/db/database.py`, `backend/app/routers/ai_copilot.py`, `backend/app/routers/confluence.py`, `backend/app/routers/journal.py`, `backend/app/routers/walls.py`, `backend/app/services/ai_copilot_service.py`, `backend/app/services/ai_service.py`, …

### `backend/app/db/__init__.py`
- **Public symbols:** —
- **Calls / imports:** —
- **Imported by:** —

### `backend/app/db/database.py`
- **Public symbols:** `get_db`, `init_db`, `set_sqlite_pragma`
- **Calls / imports:** `AsyncSessionLocal`, `UserSetting`, `add`, `begin`, `close`, `commit`, `create_async_engine`, `cursor`, `execute`, `get_columns`, …
- **Imported by:** `backend/app/api/routes.py`, `backend/app/routers/drawings.py`, `backend/app/routers/journal.py`, `backend/app/routers/workspaces.py`, `backend/app/services/binance_service.py`, `backend/app/services/bot.py`, `backend/app/services/overnight_pilot.py`, `backend/app/services/scanner.py`

### `backend/app/db/models.py`
- **Public symbols:** `DecisionLog`, `DrawingData`, `LiquidationEvent`, `OvernightPilotRun`, `PairTradingState`, `PaperTradeRecord`, `SignalHistory`, `StrategyPreset`, `UserSetting`, `Workspace`
- **Calls / imports:** `Column`, `Index`, `declarative_base`
- **Imported by:** `backend/app/api/routes.py`, `backend/app/db/database.py`, `backend/app/routers/drawings.py`, `backend/app/routers/journal.py`, `backend/app/routers/workspaces.py`, `backend/app/services/binance_service.py`, `backend/app/services/bot.py`, `backend/app/services/overnight_pilot.py`, …

### `backend/app/engine/__init__.py`
- **Public symbols:** —
- **Calls / imports:** `extend`
- **Imported by:** —

### `backend/app/engine/background_worker.py`
- **Public symbols:** `BackgroundWorker`, `background_auto_trade_allowed`
- **Calls / imports:** `BackgroundWorker`, `OrderFlowBacktester`, `Semaphore`, `SimpleTradeEvent`, `UnifiedTradeSignal`, `add`, `any`, `append`, `auto_optimize_strategies`, `background_auto_trade_allowed`, …
- **Imported by:** `backend/app/routers/monitoring.py`

### `backend/app/engine/cluster_filters.py`
- **Public symbols:** `check_cluster_filters_at_bar`, `compute_bar_cluster_arrays`, `compute_fee_aware_rr_bounds`
- **Calls / imports:** `Series`, `SimpleNamespace`, `abs`, `append`, `astype`, `bool`, `clip`, `fillna`, `float`, `get`, …
- **Imported by:** `backend/app/engine/dynamic_sl_tp.py`, `backend/app/services/orderflow_backtester.py`

### `backend/app/engine/confluence.py`
- **Public symbols:** `ConfluenceConfigError`, `ConfluenceConfigStore`, `ConfluenceVerdict`, `FactorOutcome`, `WeightedConfluenceScorer`, `validate_weights`
- **Calls / imports:** `ConfluenceConfigError`, `ConfluenceVerdict`, `FactorOutcome`, `Path`, `WeightedConfluenceScorer`, `abs`, `append`, `bool`, `dataclass`, `dict`, …
- **Imported by:** `backend/app/routers/confluence.py`

### `backend/app/engine/dynamic_sl_tp.py`
- **Public symbols:** `calibrate_best_sl_tp_mode_for_df`, `compute_dynamic_sl_tp_levels`, `recommend_pair_sl_tp_mode`
- **Calls / imports:** `abs`, `compute_fee_aware_rr_bounds`, `dict`, `float`, `frozenset`, `get`, `int`, `items`, `len`, `lower`, …
- **Imported by:** —

### `backend/app/engine/execution.py`
- **Public symbols:** `simulate_execution`
- **Calls / imports:** `SimpleNamespace`, `abs`, `append`, `bool`, `compute_dynamic_sl_tp_levels`, `float`, `get`, `getattr`, `int`, `isfinite`, …
- **Imported by:** `backend/app/engine/dynamic_sl_tp.py`, `backend/app/services/orderflow_backtester.py`

### `backend/app/engine/indicators.py`
- **Public symbols:** `compute_atr`, `compute_bollinger_bands`, `compute_cvd`, `compute_ema`, `compute_indicators`, `compute_macd`, `compute_rsi`, `compute_supertrend`
- **Calls / imports:** `DataFrame`, `abs`, `bfill`, `clip`, `compute_atr`, `compute_bollinger_bands`, `compute_cvd`, `compute_ema`, `compute_macd`, `compute_rsi`, …
- **Imported by:** `backend/app/engine/__init__.py`, `backend/app/engine/optimizer.py`

### `backend/app/engine/monte_carlo.py`
- **Public symbols:** `run_monte_carlo_simulation`
- **Calls / imports:** `accumulate`, `append`, `array`, `concatenate`, `cumsum`, `default_rng`, `float`, `get`, `int`, `integers`, …
- **Imported by:** `backend/app/services/orderflow_backtester.py`

### `backend/app/engine/optimizer.py`
- **Public symbols:** `WalkForwardOptimizer`, `compute_institutional_score`, `evaluate_vectorized_signals`, `generate_walk_forward_windows`, `split_train_oos`
- **Calls / imports:** `DataFrame`, `WalkForwardOptimizer`, `abs`, `accumulate`, `append`, `astype`, `compute_cvd`, `compute_ema`, `compute_institutional_score`, `compute_supertrend`, …
- **Imported by:** `backend/app/routers/sweep.py`

### `backend/app/engine/regime_classifier.py`
- **Public symbols:** `MarketRegime`, `RegimeClassifier`
- **Calls / imports:** `DataFrame`, `RegimeClassifier`, `Series`, `abs`, `apply`, `arange`, `astype`, `compute_features`, `copy`, `cumsum`, …
- **Imported by:** `backend/app/engine/background_worker.py`, `backend/app/engine/walk_forward_engine.py`, `backend/app/routers/adaptive_router.py`

### `backend/app/engine/strategies.py`
- **Public symbols:** `compute_raw_signal`
- **Calls / imports:** `max`, `range`
- **Imported by:** `backend/app/services/orderflow_backtester.py`

### `backend/app/engine/sweep_leaderboard.py`
- **Public symbols:** `SweepLeaderboardStore`, `build_leaderboard_entries`
- **Calls / imports:** `Path`, `ValueError`, `append`, `build_leaderboard_entries`, `dumps`, `enumerate`, `exists`, `get`, `int`, `items`, …
- **Imported by:** `backend/app/routers/sweep.py`

### `backend/app/engine/trade_contract.py`
- **Public symbols:** `UnifiedTradeSignal`, `from_backtest_setup`, `from_backtest_trade`, `from_paper_order`, `from_scanner_signal`, `to_paper_order_request`
- **Calls / imports:** `Field`, `UnifiedTradeSignal`, `ValueError`, `abs`, `encode`, `field_validator`, `float`, `get`, `hexdigest`, `int`, …
- **Imported by:** `backend/app/engine/__init__.py`, `backend/app/engine/background_worker.py`, `backend/app/routers/paper_trading_router.py`, `backend/app/services/live_paper_runner.py`

### `backend/app/engine/verdict.py`
- **Public symbols:** `Verdict`, `VerdictLevel`, `evaluate_verdict`
- **Calls / imports:** `Verdict`, `append`, `dataclass`, `field`, `float`, `int`, `list`, `str`, `upper`
- **Imported by:** `backend/app/routers/verdict.py`, `backend/app/services/overnight_pilot.py`

### `backend/app/engine/walk_forward_engine.py`
- **Public symbols:** `WalkForwardEngine`
- **Calls / imports:** `OrderFlowBacktester`, `WalkForwardEngine`, `append`, `argmax`, `ceil`, `classify_current`, `classify_series`, `copy`, `debug`, `error`, …
- **Imported by:** `backend/app/engine/background_worker.py`, `backend/app/routers/adaptive_router.py`

### `backend/app/logging_setup.py`
- **Public symbols:** `PROCESS_MEMORY_COUNTERS_EX`, `get_memory_stats`, `setup_stress_logging`
- **Calls / imports:** `FileHandler`, `Formatter`, `GetCurrentProcess`, `POINTER`, `PROCESS_MEMORY_COUNTERS_EX`, `Path`, `StreamHandler`, `addHandler`, `any`, `byref`, …
- **Imported by:** —

### `backend/app/routers/__init__.py`
- **Public symbols:** —
- **Calls / imports:** —
- **Imported by:** —

### `backend/app/routers/adaptive_router.py`
- **Public symbols:** `OptimizeWeightsRequest`, `get_market_regime`, `get_strategy_weights`, `optimize_regime_weights`
- **Calls / imports:** `APIRouter`, `Field`, `HTTPException`, `Query`, `classify_current`, `get`, `get_active_regime_and_weights`, `int`, `len`, `load_dataset_async`, …
- **Imported by:** —

### `backend/app/routers/ai_copilot.py`
- **Public symbols:** `AIChatRequest`, `AIOptimizeRequest`, `ForecastRequest`, `MarketAnalysisRequest`, `ValidateKeyRequest`, `chat_with_copilot`, `get_forecast_query`, `get_market_analysis`, `list_ai_models`, `optimize_strategy`, …
- **Calls / imports:** `APIRouter`, `ClientSession`, `ClientTimeout`, `Field`, `HTTPException`, `OrderFlowBacktester`, `abs`, `append`, `bool`, `build_expected_move_cone`, …
- **Imported by:** `backend/app/services/overnight_pilot.py`

### `backend/app/routers/ai_settings.py`
- **Public symbols:** `AIConfigRequest`, `get_config`, `get_models`, `save_config`, `test_connection`
- **Calls / imports:** `APIRouter`, `Field`, `chat_completion`, `fetch_available_models`, `get`, `get_config`, `int`, `model_dump`, `perf_counter`, `post`, …
- **Imported by:** —

### `backend/app/routers/backtest.py`
- **Public symbols:** `BacktestParams`, `BacktestReportRequest`, `BacktestRequest`, `InspectLevelRequest`, `LimitSetupRequest`, `LimitSetupResponse`, `OptimizeRequest`, `build_response`, `export_backtest_report`, `export_backtest_report_html`, …
- **Calls / imports:** `APIRouter`, `BacktestParams`, `ClientTimeout`, `DataFrame`, `Field`, `HTTPException`, `LimitSetupParams`, `LimitSetupResponse`, `OrderFlowBacktester`, `Response`, …
- **Imported by:** `backend/app/routers/ai_copilot.py`, `backend/app/routers/quant_router.py`, `backend/app/services/ai_copilot_service.py`, `backend/app/services/overnight_pilot.py`

### `backend/app/routers/confluence.py`
- **Public symbols:** `ConfluenceScorePayload`, `ConfluenceWeightsPayload`, `get_weights`, `list_factors`, `put_weights`, `score_factors`
- **Calls / imports:** `APIRouter`, `ConfluenceConfigStore`, `Field`, `HTTPException`, `dict`, `get`, `list`, `post`, `put`, `score`, …
- **Imported by:** —

### `backend/app/routers/drawings.py`
- **Public symbols:** `DrawingSaveSchema`, `delete_drawings`, `get_drawings`, `save_drawings`
- **Calls / imports:** `APIRouter`, `Depends`, `DrawingData`, `Query`, `add`, `all`, `choose_latest_drawing`, `commit`, `delete`, `execute`, …
- **Imported by:** —

### `backend/app/routers/journal.py`
- **Public symbols:** `DecisionLogCreateRequest`, `DecisionLogUpdateRequest`, `SecondOpinionRequest`, `StrategyPresetRequest`, `ask_openrouter_second_opinion`, `create_decision_log`, `delete_strategy_preset`, `ensure_seed_data`, `export_decision_logs_csv`, `gather_market_context`, …
- **Calls / imports:** `APIRouter`, `AsyncSessionLocal`, `DecisionLog`, `Field`, `HTTPException`, `OrderFlowBacktester`, `Query`, `StrategyPreset`, `StreamingResponse`, `StringIO`, …
- **Imported by:** —

### `backend/app/routers/monitoring.py`
- **Public symbols:** `SetMonitoredTickersRequest`, `ToggleTickerRequest`, `get_monitoring_state`, `get_sentinel_status`, `get_system_monitoring_state`, `monitoring_websocket_endpoint`, `set_monitored_tickers`, `toggle_ticker_monitoring`
- **Calls / imports:** `APIRouter`, `Field`, `accept`, `done`, `get`, `get_state`, `get_status`, `getattr`, `isinstance`, `len`, …
- **Imported by:** —

### `backend/app/routers/overnight_pilot.py`
- **Public symbols:** `AutoSelectRequest`, `ChallengerRequest`, `ClosePairRequest`, `PairScreenRequest`, `PausePairRequest`, `auto_select_and_start`, `emergency_close_pair`, `get_diversified_paper_defaults`, `get_last_auto_selection`, `get_overnight_defaults`, …
- **Calls / imports:** `APIRouter`, `AutoSelectRequest`, `ClosePairRequest`, `DeepIntentLogger`, `Field`, `HTTPException`, `OvernightPilotConfig`, `PausePairRequest`, `build_pilot_configs`, `close_pair`, …
- **Imported by:** —

### `backend/app/routers/paper_trading_router.py`
- **Public symbols:** `AIRiskEvalRequest`, `DepositRequest`, `KillSwitchRequest`, `LiveStartRequest`, `OrderSignalRequest`, `ResetWalletRequest`, `deposit_live_paper_wallet`, `deposit_paper_wallet`, `evaluate_ai_trade_risk`, `get_ai_model_chain_status`, …
- **Calls / imports:** `APIRouter`, `AsyncSessionLocal`, `Field`, `HTTPException`, `KillSwitchRequest`, `ResetWalletRequest`, `UnifiedTradeSignal`, `abs`, `all`, `analyze_from_db`, …
- **Imported by:** —

### `backend/app/routers/quant_router.py`
- **Public symbols:** `ThinkOptimizeRequest`, `build_think_optimize_request`, `commit_to_quarantine`, `evaluate_quant_signal`, `get_design_overlay`, `get_liquidation_estimates`, `get_market_prompt`, `get_orderbook_depth`, `get_unified_market_data`, `list_quarantine_records`, …
- **Calls / imports:** `APIRouter`, `Field`, `HTTPException`, `OptimizeRequest`, `Query`, `analyze_post_mortem`, `build_design_overlay`, `build_snapshot_prompt`, `build_think_optimize_request`, `evaluate_core3_math`, …
- **Imported by:** —

### `backend/app/routers/replay.py`
- **Public symbols:** `paginate_events`, `replay_events`
- **Calls / imports:** `APIRouter`, `HTTPException`, `Query`, `ReplayEngine`, `ValueError`, `build_events`, `exception`, `get`, `getLogger`, `len`, …
- **Imported by:** —

### `backend/app/routers/risk.py`
- **Public symbols:** `DcaLadderRequest`, `FixedFractionalRequest`, `HeatCheckRequest`, `dca_ladder`, `heat_check`, `position_size`
- **Calls / imports:** `APIRouter`, `Field`, `HTTPException`, `PositionSizer`, `abs`, `adjusted_risk_budget`, `asdict`, `budgeted_dca_ladder`, `check_heat`, `portfolio_heat`, …
- **Imported by:** —

### `backend/app/routers/sweep.py`
- **Public symbols:** `SweepRunRequest`, `get_leaderboard`, `list_runs`, `run_sweep`
- **Calls / imports:** `APIRouter`, `Field`, `HTTPException`, `Path`, `Query`, `SweepLeaderboardStore`, `WalkForwardOptimizer`, `fetch_history`, `get`, `latest`, …
- **Imported by:** —

### `backend/app/routers/verdict.py`
- **Public symbols:** `VerdictRequest`, `evaluate`
- **Calls / imports:** `APIRouter`, `evaluate_verdict`, `post`, `to_dict`
- **Imported by:** —

### `backend/app/routers/walls.py`
- **Public symbols:** `WallObservationPayload`, `WallSettingsPayload`, `WallUpdatePayload`, `get_wall_settings`, `observe_wall_size`, `put_wall_settings`, `qualified_walls`, `track_wall`
- **Calls / imports:** `APIRouter`, `AutoDensityCalibrator`, `Field`, `WallSettings`, `WallSettingsStore`, `WallTracker`, `append`, `compute`, `effective_threshold`, `float`, …
- **Imported by:** —

### `backend/app/routers/workspaces.py`
- **Public symbols:** `SaveWorkspacePayload`, `WorkspaceDetail`, `WorkspaceItem`, `delete_workspace`, `ensure_default_workspaces`, `get_db`, `get_workspace`, `list_workspaces`, `save_workspace`
- **Calls / imports:** `APIRouter`, `AsyncSessionLocal`, `Depends`, `HTTPException`, `Workspace`, `WorkspaceDetail`, `WorkspaceItem`, `add`, `all`, `asc`, …
- **Imported by:** —

### `backend/app/services/__init__.py`
- **Public symbols:** —
- **Calls / imports:** —
- **Imported by:** —

### `backend/app/services/ai_copilot_service.py`
- **Public symbols:** `build_expected_move_cone`, `build_expected_value`, `build_forecast_fan`, `build_forecast_signal`, `build_liquidity_magnet`, `build_support_resistance`, `classify_forecast_regime`, `compute_atr14`, `compute_health_score`, `compute_market_metrics`, …
- **Calls / imports:** `AsyncSessionLocal`, `DecisionLog`, `HTTPException`, `OrderFlowBacktester`, `RegimeClassifier`, `UnifiedTradeSignal`, `abs`, `add`, `any`, `append`, …
- **Imported by:** `backend/app/routers/ai_copilot.py`

### `backend/app/services/ai_service.py`
- **Public symbols:** `OpenRouterAIService`
- **Calls / imports:** `ClientSession`, `ClientTimeout`, `OpenRouterAIService`, `append`, `dumps`, `enumerate`, `get`, `getLogger`, `get_effective_models`, `info`, …
- **Imported by:** —

### `backend/app/services/backtest_report.py`
- **Public symbols:** `render_backtest_report_html`, `render_backtest_report_pdf`
- **Calls / imports:** `BytesIO`, `PdfPages`, `abs`, `add_axes`, `any`, `append`, `arange`, `array`, `auto_set_font_size`, `axhline`, …
- **Imported by:** `backend/app/routers/backtest.py`

### `backend/app/services/binance_service.py`
- **Public symbols:** `BinanceService`
- **Calls / imports:** `AsyncSessionLocal`, `BinanceAdapter`, `BinanceService`, `ClientSession`, `ClientTimeout`, `LiquidationEvent`, `add_all`, `append`, `close`, `commit`, …
- **Imported by:** `backend/app/api/data_routes.py`, `backend/app/api/routes.py`, `backend/app/routers/ai_copilot.py`, `backend/app/routers/backtest.py`, `backend/app/routers/journal.py`, `backend/app/services/scanner.py`

### `backend/app/services/bot.py`
- **Public symbols:** `broadcast_alert`, `broadcast_signal`, `get_bot`, `start_bot_polling`
- **Calls / imports:** `AsyncSessionLocal`, `Bot`, `Command`, `CommandStart`, `Dispatcher`, `InlineKeyboardButton`, `InlineKeyboardMarkup`, `UserSetting`, `add`, `all`, …
- **Imported by:** `backend/app/api/routes.py`, `backend/app/services/scanner.py`

### `backend/app/services/cluster_engine.py`
- **Public symbols:** `ClusterCell`, `ClusterEngine`, `Footprint`, `LiquidationLevel`, `TradeEvent`, `VolumeProfile`, `Wall`
- **Calls / imports:** `ClusterCell`, `Footprint`, `LiquidationLevel`, `ValueError`, `VolumeProfile`, `Wall`, `abs`, `add`, `append`, `dataclass`, …
- **Imported by:** —

### `backend/app/services/coingecko.py`
- **Public symbols:** `CoinGeckoService`
- **Calls / imports:** `ClientSession`, `ClientTimeout`, `CoinGeckoService`, `copy`, `float`, `get`, `getLogger`, `info`, `json`, `len`, …
- **Imported by:** `backend/app/services/scanner.py`

### `backend/app/services/deep_history.py`
- **Public symbols:** `ArchiveSpec`, `BinanceVisionIngestor`, `aggregate_footprints`, `aggregate_price_levels`, `build_footprint_1m`, `build_price_levels_1m`, `write_manifest`
- **Calls / imports:** `ArchiveSpec`, `DataFrame`, `Decimal`, `Path`, `Series`, `Session`, `ValueError`, `ZipFile`, `abs`, `agg`, …
- **Imported by:** —

### `backend/app/services/deep_intent_logger.py`
- **Public symbols:** `DeepIntentLogWriteError`, `DeepIntentLogger`
- **Calls / imports:** `DeepIntentLogWriteError`, `Lock`, `append`, `decode`, `deque`, `dict`, `dumps`, `exists`, `get`, `isinstance`, …
- **Imported by:** `backend/app/routers/overnight_pilot.py`, `backend/app/services/live_paper_runner.py`, `backend/app/services/overnight_pilot.py`

### `backend/app/services/design_contracts.py`
- **Public symbols:** `DesignDepthDeltas`, `DesignDepthWall`, `DesignLiqLevel`, `DesignOverlayPayload`, `build_design_overlay`
- **Calls / imports:** `DesignDepthDeltas`, `DesignDepthWall`, `DesignLiqLevel`, `DesignOverlayPayload`, `Field`, `delta`, `float`, `get`, `max`
- **Imported by:** `backend/app/routers/quant_router.py`

### `backend/app/services/drawing_persistence.py`
- **Public symbols:** `choose_latest_drawing`
- **Calls / imports:** `getattr`, `list`, `max`, `replace`
- **Imported by:** `backend/app/api/routes.py`, `backend/app/routers/drawings.py`

### `backend/app/services/early_exit_engine.py`
- **Public symbols:** `EarlyExitEngine`, `PositionTrackState`, `clamp_protective_stop`
- **Calls / imports:** `PositionTrackState`, `any`, `append`, `bool`, `clamp_protective_stop`, `dict`, `evaluate_position`, `extend`, `field`, `float`, …
- **Imported by:** `backend/app/services/paper_trading.py`

### `backend/app/services/execution/__init__.py`
- **Public symbols:** —
- **Calls / imports:** `base.BaseExecutionProvider`, `base.ExecutionSnapshot`, `base.ExecutionTrade`, `exchange.ExchangeLiveProvider`, `paper.PaperSandboxProvider`
- **Imported by:** —

### `backend/app/services/execution/base.py`
- **Public symbols:** `BaseExecutionProvider`, `ExecutionSnapshot`, `ExecutionTrade`
- **Calls / imports:** `dataclass`, `field`
- **Imported by:** —

### `backend/app/services/execution/exchange.py`
- **Public symbols:** `ExchangeLiveProvider`
- **Calls / imports:** `NotImplementedError`
- **Imported by:** —

### `backend/app/services/execution/paper.py`
- **Public symbols:** `PaperSandboxProvider`
- **Calls / imports:** `ExecutionSnapshot`, `ExecutionTrade`, `PaperTradingSession`, `ValueError`, `dict`, `field`, `float`, `get`, `max`, `pop`, …
- **Imported by:** —

### `backend/app/services/execution_simulator.py`
- **Public symbols:** `ExecutionResult`, `ExecutionSimulator`, `Fill`, `OrderConfig`, `OrderSide`, `OrderState`, `OrderStatus`, `OrderType`, `simulate_order`
- **Calls / imports:** `ExecutionResult`, `ExecutionSimulator`, `Fill`, `OrderConfig`, `OrderSide`, `OrderState`, `OrderType`, `abs`, `append`, `field`, …
- **Imported by:** `backend/app/services/paper_trading.py`

### `backend/app/services/free_binance_collector.py`
- **Public symbols:** `FreeBinanceSelfCollector`
- **Calls / imports:** `ClientSession`, `ClientTimeout`, `DepthDeltaSummary`, `LiqEstimatesData`, `LiqLevelEstimate`, `MarketSnapshot`, `OrderBookDepthData`, `OrderBookLevel`, `UnifiedMarketDataResponse`, `ValueError`, …
- **Imported by:** `backend/app/services/market_data_factory.py`

### `backend/app/services/hedge_ledger.py`
- **Public symbols:** `HedgeLedger`, `SubWallet`
- **Calls / imports:** `SubWallet`, `ValueError`, `float`, `list`, `max`, `round`, `strip`, `sum`, `upper`, `values`, …
- **Imported by:** —

### `backend/app/services/historical_data_loader.py`
- **Public symbols:** `HistoricalDataLoader`
- **Calls / imports:** `ClientSession`, `ClientTimeout`, `DataFrame`, `HistoricalDataLoader`, `Path`, `append`, `astype`, `clip`, `concat`, `debug`, …
- **Imported by:** `backend/app/engine/background_worker.py`, `backend/app/engine/walk_forward_engine.py`, `backend/app/routers/adaptive_router.py`

### `backend/app/services/indicators/__init__.py`
- **Public symbols:** `check_cvd_divergence`, `check_ema20_cross`, `check_rsi_condition`, `check_volume_spike`, `check_vwap_signal`, `compute_indicators`
- **Calls / imports:** `check_signal`, `compute_all`, `get`
- **Imported by:** —

### `backend/app/services/indicators/base.py`
- **Public symbols:** `BaseIndicator`
- **Calls / imports:** `get`, `items`
- **Imported by:** `backend/app/services/indicators/__init__.py`, `backend/app/services/indicators/plugins/atr.py`, `backend/app/services/indicators/plugins/cvd.py`, `backend/app/services/indicators/plugins/ema.py`, `backend/app/services/indicators/plugins/open_interest.py`, `backend/app/services/indicators/plugins/rsi.py`, `backend/app/services/indicators/plugins/volume_spike.py`, `backend/app/services/indicators/plugins/vwap.py`, …

### `backend/app/services/indicators/normalization.py`
- **Public symbols:** `format_normalized_display`, `normalize_series`
- **Calls / imports:** `apply`, `fillna`, `len`, `max`, `mean`, `replace`, `rolling`, `std`, `sum`
- **Imported by:** `backend/app/services/indicators/__init__.py`

### `backend/app/services/indicators/plugins/atr.py`
- **Public symbols:** `ATRIndicator`
- **Calls / imports:** `abs`, `concat`, `copy`, `float`, `get`, `int`, `isna`, `len`, `max`, `mean`, …
- **Imported by:** —

### `backend/app/services/indicators/plugins/cvd.py`
- **Public symbols:** `CVDIndicator`
- **Calls / imports:** `copy`, `cumsum`, `float`, `len`
- **Imported by:** —

### `backend/app/services/indicators/plugins/ema.py`
- **Public symbols:** `EMAIndicator`
- **Calls / imports:** `copy`, `ewm`, `float`, `get`, `int`, `len`, `mean`
- **Imported by:** —

### `backend/app/services/indicators/plugins/open_interest.py`
- **Public symbols:** `OpenInterestIndicator`
- **Calls / imports:** `copy`, `diff`, `float`, `get`, `int`, `isna`, `len`, `max`, `replace`, `shift`, …
- **Imported by:** —

### `backend/app/services/indicators/plugins/rsi.py`
- **Public symbols:** `RSIIndicator`
- **Calls / imports:** `clip`, `copy`, `diff`, `ewm`, `float`, `get`, `int`, `isna`, `len`, `mean`, …
- **Imported by:** —

### `backend/app/services/indicators/plugins/volume_spike.py`
- **Public symbols:** `VolumeSpikeIndicator`
- **Calls / imports:** `copy`, `float`, `get`, `int`, `isna`, `len`, `mean`, `replace`, `rolling`
- **Imported by:** —

### `backend/app/services/indicators/plugins/vwap.py`
- **Public symbols:** `VWAPIndicator`
- **Calls / imports:** `abs`, `copy`, `cumsum`, `float`, `get`, `int`, `len`, `replace`, `rolling`, `sum`
- **Imported by:** —

### `backend/app/services/indicators/registry.py`
- **Public symbols:** `IndicatorRegistry`
- **Calls / imports:** `IndicatorRegistry`, `Path`, `append`, `attr`, `auto_discover`, `compute`, `debug`, `dir`, `error`, `exists`, …
- **Imported by:** `backend/app/api/routes.py`, `backend/app/services/indicators/__init__.py`

### `backend/app/services/limit_fill_simulator.py`
- **Public symbols:** `LimitSetupParams`, `LimitSetupResult`, `simulate_limit_setup`
- **Calls / imports:** `LimitSetupResult`, `abs`, `dataclass`, `float`, `head`, `int`, `isna`, `iterrows`, `max`, `min`, …
- **Imported by:** —

### `backend/app/services/live_paper_runner.py`
- **Public symbols:** `LivePaperRunner`
- **Calls / imports:** `AsyncSessionLocal`, `DailyDrawdownGuard`, `DataFrame`, `DecisionLog`, `DeepIntentLogger`, `EarlyExitEngine`, `LivePaperRunner`, `MultiLevelKillSwitch`, `OrderFlowBacktester`, `PaperTradeRecord`, …
- **Imported by:** `backend/app/routers/paper_trading_router.py`, `backend/app/services/overnight_pilot.py`

### `backend/app/services/market_data_factory.py`
- **Public symbols:** `ExternalPremiumAdapter`, `get_market_data_provider`
- **Calls / imports:** `ExternalPremiumAdapter`, `FreeBinanceSelfCollector`, `get_liquidation_estimates`, `get_market_data_provider`, `get_market_snapshot`, `get_orderbook_depth`, `get_unified_data`, `getenv`, `lower`
- **Imported by:** `backend/app/routers/quant_router.py`, `backend/app/services/live_paper_runner.py`, `backend/app/services/quant_engine.py`

### `backend/app/services/market_data_provider.py`
- **Public symbols:** `DepthDeltaSummary`, `IMarketDataProvider`, `LiqEstimatesData`, `LiqLevelEstimate`, `MarketSnapshot`, `OrderBookDepthData`, `OrderBookLevel`, `UnifiedMarketDataResponse`
- **Calls / imports:** `Field`
- **Imported by:** `backend/app/routers/quant_router.py`, `backend/app/services/design_contracts.py`, `backend/app/services/free_binance_collector.py`, `backend/app/services/market_data_factory.py`, `backend/app/services/quant_engine.py`

### `backend/app/services/openrouter_client.py`
- **Public symbols:** `OpenRouterClient`
- **Calls / imports:** `ClientSession`, `ClientTimeout`, `OpenRouterClient`, `abs`, `append`, `bool`, `build_candidate_chain`, `can_use_paid_models`, `chat_completion`, `clamp_protective_stop`, …
- **Imported by:** `backend/app/routers/ai_settings.py`, `backend/app/routers/paper_trading_router.py`, `backend/app/services/live_paper_runner.py`

### `backend/app/services/openrouter_service.py`
- **Public symbols:** `OpenRouterModelHub`
- **Calls / imports:** `ClientSession`, `ClientTimeout`, `OpenRouterModelHub`, `append`, `bool`, `dumps`, `endswith`, `fetcher`, `float`, `fromkeys`, …
- **Imported by:** `backend/app/routers/ai_settings.py`

### `backend/app/services/orderflow_backtester.py`
- **Public symbols:** `OrderFlowBacktester`
- **Calls / imports:** `OrderFlowBacktester`, `Random`, `Series`, `SimpleNamespace`, `ValueError`, `abs`, `all`, `any`, `append`, `array`, …
- **Imported by:** `backend/app/api/data_routes.py`, `backend/app/engine/background_worker.py`, `backend/app/engine/walk_forward_engine.py`, `backend/app/routers/ai_copilot.py`, `backend/app/routers/backtest.py`, `backend/app/routers/journal.py`, `backend/app/services/ai_copilot_service.py`

### `backend/app/services/overnight_pilot.py`
- **Public symbols:** `OvernightPilotConfig`, `OvernightPilotManager`, `PilotSession`
- **Calls / imports:** `AsyncSessionLocal`, `BacktestParams`, `BacktestRequest`, `DeepIntentLogger`, `Field`, `LivePaperRunner`, `Lock`, `OptimizeRequest`, `OvernightPilotConfig`, `OvernightPilotManager`, …
- **Imported by:** `backend/app/routers/journal.py`, `backend/app/routers/overnight_pilot.py`

### `backend/app/services/pair_selector.py`
- **Public symbols:** `build_pilot_configs`, `evaluate_symbol_sync`, `is_qualified`, `load_last_selection`, `pick_best`, `run_selection`, `split_train_oos`, `summarize`
- **Calls / imports:** `OrderFlowBacktester`, `Path`, `append`, `copy`, `dict`, `dumps`, `fetch_history`, `float`, `get`, `int`, …
- **Imported by:** `backend/app/routers/overnight_pilot.py`

### `backend/app/services/paper_trading.py`
- **Public symbols:** `PaperOrder`, `PaperOrderRole`, `PaperPosition`, `PaperSessionState`, `PaperTradingSession`
- **Calls / imports:** `EarlyExitEngine`, `ExecutionSimulator`, `OrderConfig`, `OrderSide`, `OrderType`, `PaperOrder`, `PaperOrderRole`, `PaperPosition`, `PaperSessionState`, `PaperTradingSession`, …
- **Imported by:** `backend/app/routers/journal.py`, `backend/app/routers/monitoring.py`, `backend/app/routers/paper_trading_router.py`, `backend/app/services/execution/paper.py`, `backend/app/services/live_paper_runner.py`, `backend/app/services/overnight_pilot.py`

### `backend/app/services/position_sizer.py`
- **Public symbols:** `DcaLeg`, `DcaPlan`, `PositionSizer`
- **Calls / imports:** `DcaLeg`, `DcaPlan`, `ValueError`, `abs`, `any`, `append`, `dataclass`, `enumerate`, `field`, `float`, …
- **Imported by:** `backend/app/routers/risk.py`, `backend/app/services/live_paper_runner.py`

### `backend/app/services/quant_engine.py`
- **Public symbols:** `Core3MathReport`, `MarketSnapshotPrompt`, `QuantEngine`, `QuarantineSignalRecord`
- **Calls / imports:** `Core3MathReport`, `MarketSnapshotPrompt`, `Path`, `QuantEngine`, `QuarantineSignalRecord`, `abs`, `append`, `chr`, `dump`, `error`, …
- **Imported by:** `backend/app/routers/quant_router.py`, `backend/app/services/live_paper_runner.py`

### `backend/app/services/recorder.py`
- **Public symbols:** `OrderFlowRecorder`, `annotate_cluster_metrics`
- **Calls / imports:** `DataFrame`, `OrderFlowRecorder`, `ZipFile`, `abs`, `add`, `annotate_cluster_metrics`, `append`, `bool`, `cancel`, `check_and_rotate_storage`, …
- **Imported by:** `backend/app/api/data_routes.py`, `backend/app/api/routes.py`

### `backend/app/services/regime_classifier.py`
- **Public symbols:** `MarketRegime`, `bollinger_width`, `calculate_adx`, `calculate_true_range`, `choppiness_index`, `classify_market_regime`, `compute_order_book_imbalance`, `microstructure_gate`, `rolling_percentile_rank`
- **Calls / imports:** `Series`, `abs`, `apply`, `bfill`, `bollinger_width`, `calculate_adx`, `calculate_true_range`, `choppiness_index`, `compute_order_book_imbalance`, `concat`, …
- **Imported by:** `backend/app/services/indicators/__init__.py`, `backend/app/services/live_paper_runner.py`

### `backend/app/services/replay_engine.py`
- **Public symbols:** `ReplayEngine`, `ReplayEvent`, `book_to_lists`
- **Calls / imports:** `Path`, `ReplayEvent`, `append`, `book_to_lists`, `bool`, `build_events`, `enumerate`, `exists`, `float`, `getLogger`, …
- **Imported by:** `backend/app/routers/replay.py`

### `backend/app/services/risk_engine.py`
- **Public symbols:** `adjusted_risk_pct`, `calc_position_by_risk`, `calc_pyramid_add_qty`, `can_add_pyramid_layer`, `can_open_position`, `check_circuit_breaker`, `floor_to_step`, `select_max_leverage`
- **Calls / imports:** `abs`, `append`, `debug`, `float`, `floor`, `floor_to_step`, `get`, `getLogger`, `int`, `isfinite`, …
- **Imported by:** `backend/app/services/live_paper_runner.py`

### `backend/app/services/risk_manager.py`
- **Public symbols:** `CompoundingRiskEngine`, `DailyDrawdownGuard`, `KillSwitchEvent`, `MultiLevelKillSwitch`
- **Calls / imports:** `DailyDrawdownGuard`, `KillSwitchEvent`, `ValueError`, `append`, `clear`, `dataclass`, `float`, `fromtimestamp`, `int`, `max`, …
- **Imported by:** `backend/app/services/live_paper_runner.py`

### `backend/app/services/risk_profile.py`
- **Public symbols:** `SharedRiskProfile`
- **Calls / imports:** `ValueError`, `cls`, `dataclass`, `float`, `get`, `int`, `str`, `validate`
- **Imported by:** `backend/app/services/live_paper_runner.py`, `backend/app/services/overnight_pilot.py`, `backend/app/services/paper_trading.py`

### `backend/app/services/runtime_binding.py`
- **Public symbols:** `find_available_port`, `is_healthy_backend_running`, `persist_runtime_port`, `persist_runtime_port_guarded`
- **Calls / imports:** `RuntimeError`, `ValueError`, `append`, `bind`, `decode`, `dumps`, `enumerate`, `exists`, `get`, `getLogger`, …
- **Imported by:** —

### `backend/app/services/scanner.py`
- **Public symbols:** `MarketScanner`
- **Calls / imports:** `AsyncSessionLocal`, `DecisionLog`, `MarketScanner`, `Semaphore`, `SignalHistory`, `UserSetting`, `abs`, `add`, `append`, `broadcast_signal`, …
- **Imported by:** `backend/app/api/routes.py`

### `backend/app/services/session_review.py`
- **Public symbols:** `build_session_review`, `collect_review_trades`, `find_decision_for_trade`, `link_trades_to_decisions`, `summarize_session`
- **Calls / imports:** `ValueError`, `append`, `find_decision_for_trade`, `float`, `get`, `isinstance`, `len`, `link_trades_to_decisions`, `list`, `round`, …
- **Imported by:** `backend/app/routers/journal.py`

### `backend/app/services/strategy_catalog.py`
- **Public symbols:** `StrategyDescriptor`, `get_strategy_catalog`, `get_strategy_descriptor`
- **Calls / imports:** `StrategyDescriptor`, `ValueError`, `asdict`, `dataclass`, `frozenset`, `list`, `to_dict`, `tuple`
- **Imported by:** `backend/app/routers/overnight_pilot.py`, `backend/app/services/live_paper_runner.py`, `backend/app/services/overnight_pilot.py`, `backend/app/services/pair_selector.py`

### `backend/app/services/think_optimizer.py`
- **Public symbols:** `analyze_post_mortem`
- **Calls / imports:** `append`, `dict`, `float`, `get`, `len`, `list`, `lower`, `max`, `round`, `str`
- **Imported by:** `backend/app/routers/quant_router.py`

### `backend/app/services/tpo_profile.py`
- **Public symbols:** `ProfileRow`, `TpoProfile`, `build_tpo_profile`, `infer_tick_size`, `list_recorded_dates`, `load_recorded_trades`
- **Calls / imports:** `Path`, `ProfileRow`, `TpoProfile`, `ValueError`, `abs`, `argmax`, `array`, `asdict`, `astype`, `copy`, …
- **Imported by:** —

### `backend/app/services/trade_postmortem_service.py`
- **Public symbols:** `analyze_from_db`, `analyze_trades`, `classify_loss`
- **Calls / imports:** `AsyncSessionLocal`, `Counter`, `abs`, `all`, `analyze_trades`, `append`, `asc`, `classify_loss`, `defaultdict`, `dict`, …
- **Imported by:** —

### `backend/app/services/wall_settings.py`
- **Public symbols:** `AutoDensityCalibrator`, `TrackedWall`, `WallSettings`, `WallSettingsStore`, `WallTracker`
- **Calls / imports:** `Path`, `TrackedWall`, `ValueError`, `WallSettings`, `asdict`, `ceil`, `compute`, `dumps`, `float`, `get`, …
- **Imported by:** `backend/app/routers/walls.py`

### `backend/app/services/warning_sentinel.py`
- **Public symbols:** `SentinelConfig`, `SentinelService`, `evaluate_sentinel`, `filter_by_cooldown`, `filter_persistent_disconnects`
- **Calls / imports:** `SentinelConfig`, `SentinelService`, `add`, `all`, `append`, `bool`, `broadcast_alert`, `cancel`, `clear`, `collect_snapshot`, …
- **Imported by:** `backend/app/routers/monitoring.py`

### `backend/app/utils.py`
- **Public symbols:** `format_kyiv`, `format_kyiv_time`, `now_kyiv`
- **Calls / imports:** `ZoneInfo`, `astimezone`, `now`, `now_kyiv`, `replace`, `strftime`
- **Imported by:** `backend/app/api/routes.py`, `backend/app/services/bot.py`

### `engine/backtester.py`
- **Public symbols:** `Backtester`
- **Calls / imports:** `DataFrame`, `abs`, `accumulate`, `append`, `array`, `copy`, `float`, `generate_signals`, `get`, `int`, …
- **Imported by:** `engine/optimizer.py`

### `engine/crypto_lake_loader.py`
- **Public symbols:** `CryptoLakeLoader`
- **Calls / imports:** `abspath`, `count`, `cumsum`, `dirname`, `dropna`, `endswith`, `join`, `lower`, `makedirs`, `next`, …
- **Imported by:** —

### `engine/data_loader.py`
- **Public symbols:** `DataLoader`
- **Calls / imports:** `DataFrame`, `ValueError`, `abspath`, `copy`, `dirname`, `drop_duplicates`, `exchange_class`, `exists`, `extend`, `fetch_ohlcv`, …
- **Imported by:** `engine/scanner.py`

### `engine/indicators.py`
- **Public symbols:** `add_all_indicators`
- **Calls / imports:** `AverageTrueRange`, `BollingerBands`, `EMAIndicator`, `MACD`, `RSIIndicator`, `average_true_range`, `bollinger_hband`, `bollinger_lband`, `bollinger_mavg`, `cumsum`, …
- **Imported by:** `engine/scanner.py`

### `engine/optimizer.py`
- **Public symbols:** `StrategyOptimizer`
- **Calls / imports:** `Backtester`, `append`, `dict`, `keys`, `list`, `product`, `run`, `sort`, `strategy_class`, `values`, …
- **Imported by:** —

### `engine/scanner.py`
- **Public symbols:** `RealtimeScanner`
- **Calls / imports:** `DataLoader`, `MTFPullbackStrategy`, `add_all_indicators`, `align_multi_timeframe`, `append`, `fetch_historical_ohlcv`, `generate_signals`, `isna`, `now`, `reconfigure`, …
- **Imported by:** —

### `engine/strategy_base.py`
- **Public symbols:** `BaseStrategy`
- **Calls / imports:** `get`
- **Imported by:** `strategies/cluster_breakout_strategy.py`, `strategies/mtf_pullback.py`

### `engine/volume_profile.py`
- **Public symbols:** `VolumeProfileEngine`
- **Calls / imports:** `argmax`, `copy`, `cumsum`, `fillna`, `iterrows`, `linspace`, `max`, `mean`, `min`, `range`, …
- **Imported by:** `engine/scanner.py`, `strategies/cluster_breakout_strategy.py`

### `recorder/__init__.py`
- **Public symbols:** —
- **Calls / imports:** —
- **Imported by:** —

### `recorder/__main__.py`
- **Public symbols:** `main`
- **Calls / imports:** `ArgumentParser`, `Path`, `RecorderService`, `SystemExit`, `add_argument`, `basicConfig`, `build_binance_url`, `close`, `dumps`, `load_config`, …
- **Imported by:** —

### `recorder/config.py`
- **Public symbols:** `RecorderConfig`, `load_config`
- **Calls / imports:** `Path`, `RecorderConfig`, `dataclass`, `field`, `get`, `int`, `read_text`, `safe_load`, `str`, `tuple`, …
- **Imported by:** —

### `recorder/events.py`
- **Public symbols:** `normalize_agg_trade`, `normalize_message`
- **Calls / imports:** `ValueError`, `bool`, `float`, `get`, `int`, `monotonic_ns`, `normalize_agg_trade`, `str`, `time_ns`, `upper`
- **Imported by:** —

### `recorder/gaps.py`
- **Public symbols:** `GapJournal`
- **Calls / imports:** `Path`, `dumps`, `flush`, `get`, `mkdir`, `open`, `write`
- **Imported by:** —

### `recorder/manifest.py`
- **Public symbols:** `build_data_manifest`, `write_data_manifest`
- **Calls / imports:** `Path`, `add`, `append`, `build_data_manifest`, `dumps`, `get`, `glob`, `int`, `items`, `len`, …
- **Imported by:** —

### `recorder/service.py`
- **Public symbols:** `DiskPolicy`, `RecorderService`
- **Calls / imports:** `DiskPolicy`, `GapJournal`, `LakeWriter`, `Path`, `SpoolJournal`, `ValueError`, `add`, `allows`, `append`, `bool`, …
- **Imported by:** —

### `recorder/storage.py`
- **Public symbols:** `LakeWriter`, `SpoolJournal`
- **Calls / imports:** `FileExistsError`, `Path`, `ValueError`, `close`, `dumps`, `exists`, `fileno`, `flush`, `from_pylist`, `fromtimestamp`, …
- **Imported by:** —

### `strategies/cluster_breakout_strategy.py`
- **Public symbols:** `ClusterAbsorptionStrategy`
- **Calls / imports:** `Series`, `all`, `apply_risk_levels`, `calculate_candle_delta_and_cvd`, `copy`, `get`, `min`, `shift`, `super`, `update`
- **Imported by:** `engine/scanner.py`

### `strategies/mtf_pullback.py`
- **Public symbols:** `MTFPullbackStrategy`
- **Calls / imports:** `Series`, `all`, `apply_risk_levels`, `get`, `isna`, `min`, `shift`, `super`, `update`
- **Imported by:** `engine/scanner.py`

## 2. Frontend JS/TS modules

### `frontend/src/App.jsx`
- **Public symbols:** `App`
- **Calls / imports:** `App`, `Boolean`, `Chart`, `Configuration`, `CustomEvent`, `Dockview`, `Guard`, `Modal`, `Notification`, `Number`, …
- **Imported by:** —

### `frontend/src/components/AICopilotSidebar.jsx`
- **Public symbols:** `AICopilotSidebar`
- **Calls / imports:** `AICopilotSidebar`, `Boolean`, `CustomEvent`, `Error`, `Number`, `Sidebar`, `abs`, `async`, `clearInterval`, `dispatchEvent`, …
- **Imported by:** —

### `frontend/src/components/AIEngineSettings.jsx`
- **Public symbols:** `AIEngineSettings`
- **Calls / imports:** `AIEngineSettings`, `Error`, `Flash`, `Number`, `all`, `async`, `fetch`, `filter`, `finally`, `includes`, …
- **Imported by:** —

### `frontend/src/components/app/AppTopBar.jsx`
- **Public symbols:** `AppTopBar`
- **Calls / imports:** `AI`, `AppTopBar`, `Flow`, `Modal`, `Quarantine`, `ResizeObserver`, `Sales`, `Search`, `cancelAnimationFrame`, `disconnect`, …
- **Imported by:** —

### `frontend/src/components/app/constants.js`
- **Public symbols:** `POPULAR_SYMBOLS`, `THEME_BADGE`, `TIMEFRAMES`
- **Calls / imports:** `App`, `jsx`
- **Imported by:** —

### `frontend/src/components/app/ModalsHost.jsx`
- **Public symbols:** `ModalsHost`
- **Calls / imports:** `Modal`, `ModalsHost`, `Notifications`, `Space`, `getUsableMarketPrice`, `jsx`, `map`, `onRemoveToast`, `onToastClick`, `player`, …
- **Imported by:** —

### `frontend/src/components/AssistantHUD.jsx`
- **Public symbols:** `AssistantHUD`
- **Calls / imports:** `AssistantHUD`, `Boolean`, `CustomEvent`, `Hints`, `Indication`, `MAE`, `MFE`, `Number`, `Projection`, `async`, …
- **Imported by:** —

### `frontend/src/components/backtest/BacktestOptimizerView.jsx`
- **Public symbols:** `BacktestOptimizerView`
- **Calls / imports:** `ATR`, `BacktestOptimizerView`, `applyConfluenceSetup`, `jsx`, `map`, `onApplyConfluenceSetup`, `onApplySetup`, `return`, `round`, `slice`, …
- **Imported by:** —

### `frontend/src/components/backtest/BacktestParametersForm.jsx`
- **Public symbols:** `BacktestParametersForm`
- **Calls / imports:** `ATR`, `BacktestParametersForm`, `Banner`, `Boolean`, `Fast`, `Filters`, `Period`, `Sentinel`, `Trend`, `Volume`, …
- **Imported by:** —

### `frontend/src/components/backtest/BacktestPresetsBar.jsx`
- **Public symbols:** `BacktestPresetsBar`
- **Calls / imports:** `BacktestPresetsBar`, `jsx`, `map`, `onNameChange`, `onSelectPreset`, `return`, `trim`
- **Imported by:** —

### `frontend/src/components/backtest/BacktestTradesTable.jsx`
- **Public symbols:** `BacktestTradesTable`
- **Calls / imports:** `BacktestTradesTable`, `String`, `fmtPrice`, `fmtTime`, `jsx`, `map`, `onSelect`, `onSort`, `return`, `sortIcon`, …
- **Imported by:** —

### `frontend/src/components/backtest/constants.js`
- **Public symbols:** `STRATEGIES`, `TIMEFRAMES`
- **Calls / imports:** `Absorption`, `Bounce`, `EMA`, `Engine`, `Pullback`, `Sentinel`, `Window`, `jsx`
- **Imported by:** —

### `frontend/src/components/backtest/fields.jsx`
- **Public symbols:** `InfoTip`, `NumField`
- **Calls / imports:** `InfoTip`, `NumField`, `Number`, `jsx`, `onChange`, `preventDefault`, `return`, `setShow`, `stopPropagation`, `useState`
- **Imported by:** —

### `frontend/src/components/backtest/format.js`
- **Public symbols:** `fmtPrice`, `fmtTime`
- **Calls / imports:** `Date`, `jsx`, `toFixed`, `toLocaleString`
- **Imported by:** —

### `frontend/src/components/backtest/MonteCarloEquityChart.jsx`
- **Public symbols:** `MonteCarloEquityChart`
- **Calls / imports:** `Curve`, `MonteCarloEquityChart`, `buildBandPolygon`, `buildLine`, `forEach`, `join`, `jsx`, `map`, `max`, `min`, …
- **Imported by:** —

### `frontend/src/components/BacktestModal.jsx`
- **Public symbols:** `BacktestModal`
- **Calls / imports:** `Absorption`, `BacktestModal`, `Date`, `EMA`, `Error`, `Loss`, `Number`, `PnL`, `Profit`, `Stop`, …
- **Imported by:** —

### `frontend/src/components/BacktestPanel.jsx`
- **Public symbols:** `BacktestPanel`, `formatBacktestError`
- **Calls / imports:** `ATR`, `BTC`, `BacktestOptimizerView`, `BacktestPanel`, `BacktestParametersForm`, `BacktestPresetsBar`, `Blob`, `Boolean`, `Card`, `CustomEvent`, …
- **Imported by:** —

### `frontend/src/components/BacktestTradeTimeline.jsx`
- **Public symbols:** `BacktestTradeTimeline`
- **Calls / imports:** `BacktestTradeTimeline`, `Date`, `Event`, `Number`, `String`, `find`, `floor`, `formatClock`, `formatDuration`, `formatPrice`, …
- **Imported by:** —

### `frontend/src/components/chart/BtTooltipOverlay.jsx`
- **Public symbols:** `BtTooltipOverlay`
- **Calls / imports:** `BtTooltipOverlay`, `Number`, `btTooltip`, `chartContainerRef`, `isArray`, `join`, `jsx`, `max`, `min`, `return`, …
- **Imported by:** —

### `frontend/src/components/chart/ChartContextMenu.jsx`
- **Public symbols:** `ChartContextMenu`, `useChartContextMenu`
- **Calls / imports:** `Card`, `ChartContextMenu`, `EMA`, `Menu`, `Number`, `State`, `activeIndicators`, `addEventListener`, `async`, `convertFromPixel`, …
- **Imported by:** —

### `frontend/src/components/chart/ChartLegend.jsx`
- **Public symbols:** `ChartLegend`
- **Calls / imports:** `ChartLegend`, `Number`, `filter`, `fmtPrice`, `fmtVol`, `isFinite`, `join`, `map`, `onOpenSettings`, `onRemove`, …
- **Imported by:** —

### `frontend/src/components/chart/chartStyles.js`
- **Public symbols:** `buildChartStyles`
- **Calls / imports:** `buildChartStyles`, `getTokens`, `hexToRgba`, `isNaN`, `join`, `map`, `parseInt`, `replace`, `rgba`, `split`, …
- **Imported by:** —

### `frontend/src/components/chart/ChartToolbar.jsx`
- **Public symbols:** `ChartToolbar`
- **Calls / imports:** `ChartToolbar`, `Concepts`, `CustomEvent`, `EMA`, `Number`, `ResizeObserver`, `Reward`, `String`, `Style`, `ToggleGroup`, …
- **Imported by:** —

### `frontend/src/components/chart/densityHeatmapMath.js`
- **Public symbols:** `maxVolumeOf`, `pointStyle`, `selectDensityPoints`, `splatGeometry`
- **Calls / imports:** `Map`, `Number`, `adaptDensityPoints`, `ceil`, `floor`, `forEach`, `has`, `isArray`, `max`, `maxVolumeOf`, …
- **Imported by:** —

### `frontend/src/components/chart/engine/ChartEngine.js`
- **Public symbols:** `CHART_ENGINE_METHODS`, `missingEngineMethods`
- **Calls / imports:** `Viewport`, `filter`, `freeze`, `missingEngineMethods`, `number`
- **Imported by:** —

### `frontend/src/components/chart/engine/KLineChartsV9Adapter.js`
- **Public symbols:** `createKLineChartsV9Adapter`
- **Calls / imports:** `Set`, `add`, `applyNewData`, `buildChartStyles`, `cancelAnimationFrame`, `cb`, `clear`, `clearData`, `convertFromPixel`, `convertToPixel`, …
- **Imported by:** —

### `frontend/src/components/chart/FootprintCanvasLayer.jsx`
- **Public symbols:** `DEFAULT_FP_SETTINGS`, `FootprintCanvasLayer`
- **Calls / imports:** `Ask`, `Bid`, `Error`, `FootprintCanvasLayer`, `Number`, `POC`, `String`, `URLSearchParams`, `abs`, `async`, …
- **Imported by:** —

### `frontend/src/components/chart/footprintLayerMath.js`
- **Public symbols:** `CLUSTER_BUCKET_MS`, `computeBarMetrics`, `computeNakedPocs`, `createFrameStats`, `isTfSupported`, `lodFor`, `mergeClustersToTf`, `rebinLevels`
- **Calls / imports:** `Map`, `Number`, `Set`, `add`, `avg`, `computeBarMetrics`, `computeNakedPocs`, `createFrameStats`, `detectImbalance`, `floor`, …
- **Imported by:** —

### `frontend/src/components/chart/IndicatorsDock.jsx`
- **Public symbols:** `IndicatorsDock`
- **Calls / imports:** `Boolean`, `ChartLegend`, `IndicatorsDock`, `find`, `handleSaveSettings`, `return`, `setIsCatalogOpen`, `setSettingsDialogIndId`
- **Imported by:** —

### `frontend/src/components/chart/labelLayout.js`
- **Public symbols:** `PRIORITY_RANKS`, `formatLabelAmount`, `layoutLabels`
- **Calls / imports:** `N`, `Number`, `abs`, `filter`, `forEach`, `formatLabelAmount`, `isArray`, `isFinite`, `layoutLabels`, `map`, …
- **Imported by:** —

### `frontend/src/components/chart/LiquidationHeatmapGL.jsx`
- **Public symbols:** `LiquidationHeatmapGL`
- **Calls / imports:** `CustomEvent`, `Float32Array`, `LiquidationHeatmapGL`, `Map`, `Number`, `ResizeObserver`, `String`, `addColorStop`, `addEventListener`, `arc`, …
- **Imported by:** —

### `frontend/src/components/chart/liquidationHeatmapMath.js`
- **Public symbols:** `PALETTES`, `liquidationSplatGeometry`, `liquidationsToHeatmapPoints`, `samplePalette`
- **Calls / imports:** `Classic`, `Number`, `String`, `ef5350`, `floor`, `isArray`, `isFinite`, `liquidationSplatGeometry`, `liquidationsToHeatmapPoints`, `map`, …
- **Imported by:** —

### `frontend/src/components/chart/livePositions.js`
- **Public symbols:** `collectOpenPositions`
- **Calls / imports:** `Number`, `String`, `collectOpenPositions`, `entries`, `isArray`, `isFinite`, `normalize`, `positionList`, `push`, `status`, …
- **Imported by:** —

### `frontend/src/components/chart/OnChartDOM.jsx`
- **Public symbols:** `DEFAULT_DOM_SETTINGS`, `OnChartDOM`
- **Calls / imports:** `Error`, `Futures`, `Map`, `OnChartDOM`, `String`, `abs`, `addColorStop`, `async`, `barLength`, `beginPath`, …
- **Imported by:** —

### `frontend/src/components/chart/onChartDomMath.js`
- **Public symbols:** `barLength`, `buildDomBins`, `estimateTick`, `fmtLife`, `fmtUsdCompact`, `hexToRgba`, `niceBinSize`
- **Calls / imports:** `DOM`, `Number`, `String`, `barLength`, `binLevels`, `buildDomBins`, `estimateTick`, `filter`, `floor`, `fmtLife`, …
- **Imported by:** —

### `frontend/src/components/chart/PositionSetupHUD.jsx`
- **Public symbols:** `PositionSetupHUD`
- **Calls / imports:** `AI`, `CustomEvent`, `Number`, `OI`, `PositionSetupHUD`, `dispatchEvent`, `handleDecisionFromOpinion`, `jsx`, `return`, `round`, …
- **Imported by:** —

### `frontend/src/components/chart/registerCustomElements.js`
- **Public symbols:** —
- **Calls / imports:** `ATR`, `Badge`, `CVD`, `Line`, `Number`, `String`, `Zone`, `abs`, `badge`, `calculatePositionMetrics`, …
- **Imported by:** —

### `frontend/src/components/chart/SaveTemplateModal.jsx`
- **Public symbols:** `SaveTemplateModal`
- **Calls / imports:** `Modal`, `SaveTemplateModal`, `activeDrawingStyle`, `jsx`, `return`, `setNewTemplateName`, `setShowSaveTemplateModal`, `trim`
- **Imported by:** —

### `frontend/src/components/chart/ToxicVolatilityOverlay.jsx`
- **Public symbols:** `ToxicVolatilityOverlay`
- **Calls / imports:** `ToxicVolatilityOverlay`, `isToxicDismissed`, `jsx`, `onDismiss`, `return`
- **Imported by:** —

### `frontend/src/components/chart/useChartAnnotations.js`
- **Public symbols:** `useChartAnnotations`
- **Calls / imports:** `Boolean`, `Box`, `Levels`, `Number`, `Trade`, `abs`, `addEventListener`, `addTradeListener`, `all`, `async`, …
- **Imported by:** —

### `frontend/src/components/chart/useChartDrawings.js`
- **Public symbols:** `useChartDrawings`
- **Calls / imports:** `JSON`, `Map`, `Number`, `Set`, `Z`, `addEventListener`, `calculatePositionMetrics`, `cancelActiveDrawing`, `clear`, `createOverlay`, …
- **Imported by:** —

### `frontend/src/components/chart/useChartIndicators.js`
- **Public symbols:** `useChartIndicators`
- **Calls / imports:** `FIX`, `Map`, `Number`, `apply`, `buildChartStyles`, `chartIndicators`, `createIndicator`, `filter`, `forEach`, `get`, …
- **Imported by:** —

### `frontend/src/components/chart/useChartLifecycle.js`
- **Public symbols:** `useChartLifecycle`
- **Calls / imports:** `CustomEvent`, `Number`, `ResizeObserver`, `Set`, `String`, `WebSocket`, `addEventListener`, `async`, `cancelAnimationFrame`, `clear`, …
- **Imported by:** —

### `frontend/src/components/chart/useChartOverlays.js`
- **Public symbols:** `TPO_SETTINGS_DEFAULTS`, `WALL_SETTINGS_DEFAULTS`, `useChartOverlays`
- **Calls / imports:** `Boolean`, `Chart`, `ChartToolbar`, `Densities`, `Depth20`, `Number`, `String`, `URLSearchParams`, `WebSocket`, `addEventListener`, …
- **Imported by:** —

### `frontend/src/components/chart/useSecondOpinion.js`
- **Public symbols:** `useSecondOpinion`
- **Calls / imports:** `CustomEvent`, `Number`, `Opinion`, `abs`, `async`, `currentKlines`, `dispatchEvent`, `error`, `fetch`, `getState`, …
- **Imported by:** —

### `frontend/src/components/Chart.jsx`
- **Public symbols:** `Chart`
- **Calls / imports:** `Bar`, `Boolean`, `Chart`, `ChartEngine`, `CustomEvent`, `Heatmap`, `Inspector`, `POC`, `Stack`, `State`, …
- **Imported by:** —

### `frontend/src/components/ConfluenceWeightsEditor.jsx`
- **Public symbols:** `ConfluenceWeightsEditor`
- **Calls / imports:** `Boolean`, `Confluence`, `ConfluenceWeightsEditor`, `Error`, `Number`, `abs`, `async`, `editor`, `entries`, `fetch`, …
- **Imported by:** —

### `frontend/src/components/copilot/AnalysisResults.jsx`
- **Public symbols:** `AnalysisResults`
- **Calls / imports:** `AnalysisResults`, `Copilot`, `return`
- **Imported by:** —

### `frontend/src/components/copilot/ChatMessages.jsx`
- **Public symbols:** `ChatMessages`
- **Calls / imports:** `ChatMessages`, `Copilot`, `Flow`, `endsWith`, `exec`, `map`, `push`, `renderFormattedText`, `return`, `slice`, …
- **Imported by:** —

### `frontend/src/components/copilot/constants.js`
- **Public symbols:** —
- **Calls / imports:** `Cascade`, `Copilot`, `Flash`, `OpenRouter`
- **Imported by:** —

### `frontend/src/components/copilot/CopilotHeader.jsx`
- **Public symbols:** `CopilotHeader`
- **Calls / imports:** `ACTIVE`, `Copilot`, `CopilotHeader`, `Key`, `map`, `onApiKeyChange`, `onModelChange`, `return`
- **Imported by:** —

### `frontend/src/components/copilot/DataFeedContextCard.jsx`
- **Public symbols:** `DataFeedContextCard`
- **Calls / imports:** `ATR`, `DataFeedContextCard`, `Interest`, `dfc`, `return`, `toFixed`
- **Imported by:** —

### `frontend/src/components/copilot/ExpectedValueCard.jsx`
- **Public symbols:** `ExpectedValueCard`
- **Calls / imports:** `ExpectedValueCard`, `return`, `underpowered`
- **Imported by:** —

### `frontend/src/components/copilot/ExpressAnalysisCard.jsx`
- **Public symbols:** `ExpressAnalysisCard`
- **Calls / imports:** `ExpressAnalysisCard`, `return`
- **Imported by:** —

### `frontend/src/components/copilot/HealthMeterCard.jsx`
- **Public symbols:** `HealthMeterCard`
- **Calls / imports:** `AICopilotSidebar`, `HealthMeterCard`, `Meter`, `Number`, `max`, `min`, `return`
- **Imported by:** —

### `frontend/src/components/copilot/LiquidityMagnetCard.jsx`
- **Public symbols:** `LiquidityMagnetCard`
- **Calls / imports:** `Asks`, `Bids`, `LiquidityMagnetCard`, `Ratio`, `return`, `toFixed`
- **Imported by:** —

### `frontend/src/components/copilot/QuickPromptChips.jsx`
- **Public symbols:** `QuickPromptChips`
- **Calls / imports:** `QuickPromptChips`, `map`, `onPrompt`, `return`
- **Imported by:** —

### `frontend/src/components/copilot/SweepLeaderboardCard.jsx`
- **Public symbols:** `SweepLeaderboardCard`
- **Calls / imports:** `Cross`, `SweepLeaderboardCard`, `map`, `onApplyEntry`, `return`, `round`, `slice`
- **Imported by:** —

### `frontend/src/components/copilot/TradeSetupCard.jsx`
- **Public symbols:** `TradeSetupCard`
- **Calls / imports:** `SL`, `TP1`, `TP2`, `TradeSetupCard`, `return`
- **Imported by:** —

### `frontend/src/components/copilot/VolatilityConeCard.jsx`
- **Public symbols:** `VolatilityConeCard`
- **Calls / imports:** `VolatilityConeCard`, `return`, `toFixed`
- **Imported by:** —

### `frontend/src/components/DecisionJournalModal.jsx`
- **Public symbols:** `DecisionJournalModal`
- **Calls / imports:** `CSV`, `Date`, `DecisionJournalModal`, `Number`, `Set`, `URLSearchParams`, `addEventListener`, `appendChild`, `async`, `blob`, …
- **Imported by:** —

### `frontend/src/components/DepthHeatmapGL.jsx`
- **Public symbols:** `DepthHeatmapGL`
- **Calls / imports:** `DepthHeatmapGL`, `Float32Array`, `Map`, `ResizeObserver`, `addColorStop`, `arc`, `attachShader`, `beginPath`, `bindBuffer`, `blendFunc`, …
- **Imported by:** —

### `frontend/src/components/design-previews/ChartCanvasOverlay.jsx`
- **Public symbols:** `ChartCanvasOverlay`
- **Calls / imports:** `Asks`, `Background`, `Bids`, `ChartCanvasOverlay`, `Heatmap`, `Levels`, `Line`, `Map`, `N`, `Number`, …
- **Imported by:** —

### `frontend/src/components/design-previews/index.js`
- **Public symbols:** —
- **Calls / imports:** `mean`, `tier`
- **Imported by:** —

### `frontend/src/components/design-previews/LayerToolbar.jsx`
- **Public symbols:** `LayerToolbar`
- **Calls / imports:** `Bar`, `Component`, `LayerToolbar`, `Opacity`, `Toggles`, `gradient`, `map`, `onLayerToggle`, `onLeverageToggle`, `onMinWallChange`, …
- **Imported by:** —

### `frontend/src/components/design-previews/LiqAnalyticsPanel.jsx`
- **Public symbols:** `LiqAnalyticsPanel`
- **Calls / imports:** `Cards`, `Component`, `Container`, `Delta`, `ESTIMATED`, `LiqAnalyticsPanel`, `Price`, `book`, `formatUSD`, `map`, …
- **Imported by:** —

### `frontend/src/components/design-previews/QuantDecisionConsilium.jsx`
- **Public symbols:** `QuantDecisionConsilium`
- **Calls / imports:** `Button`, `Delta`, `Generator`, `Magnet`, `QuantDecisionConsilium`, `map`, `return`, `rgba`, `setCopied`, `setShowPromptDetails`, …
- **Imported by:** —

### `frontend/src/components/docking/AlertsModal.jsx`
- **Public symbols:** `AlertsModal`
- **Calls / imports:** `AlertsModal`, `Modal`, `Number`, `String`, `addAlert`, `closeAlertsModal`, `filter`, `includes`, `isFinite`, `map`, …
- **Imported by:** —

### `frontend/src/components/docking/AutoSelectPanel.jsx`
- **Public symbols:** `AutoSelectPanel`
- **Calls / imports:** `AutoSelectPanel`, `Error`, `async`, `fetch`, `filter`, `join`, `json`, `loadLast`, `map`, `return`, …
- **Imported by:** —

### `frontend/src/components/docking/ChannelSelector.jsx`
- **Public symbols:** `ChannelSelector`
- **Calls / imports:** `ChannelSelector`, `addEventListener`, `contains`, `find`, `it`, `map`, `removeEventListener`, `return`, `rgba`, `setIsOpen`, …
- **Imported by:** —

### `frontend/src/components/docking/footprintGrid.js`
- **Public symbols:** `IMBALANCE_RATIO`, `buildFootprintGrid`, `buildSessionProfile`, `cellIntensity`, `cellSide`, `detectImbalance`, `fmtTime`, `fmtVol`
- **Calls / imports:** `Date`, `MM`, `Number`, `Set`, `abs`, `add`, `buildFootprintGrid`, `buildSessionProfile`, `cellIntensity`, `cellSide`, …
- **Imported by:** —

### `frontend/src/components/docking/FootprintPanel.jsx`
- **Public symbols:** `FootprintPanel`
- **Calls / imports:** `Binance`, `Date`, `FootprintPanel`, `Number`, `Set`, `Stacked`, `String`, `URLSearchParams`, `abs`, `async`, …
- **Imported by:** —

### `frontend/src/components/docking/layoutRecovery.js`
- **Public symbols:** `hasRenderableTerminalPanel`, `persistChartPanelTimeframe`, `persistDockviewLayoutLocally`, `readCachedDockviewLayout`, `readChartPanelTimeframe`, `resolveDockviewLayout`
- **Calls / imports:** `Boolean`, `Set`, `getItem`, `has`, `hasRenderableTerminalPanel`, `isDockviewLayout`, `parse`, `persistChartPanelTimeframe`, `persistDockviewLayoutLocally`, `readCachedDockviewLayout`, …
- **Imported by:** —

### `frontend/src/components/docking/layoutSanitizer.js`
- **Public symbols:** `DOCKVIEW_COMPONENT_IDS`, `collectSalvagePanels`, `hasNullSizes`, `normalizeDockviewSizes`, `sanitizeDockviewLayout`
- **Calls / imports:** `Number`, `Set`, `add`, `assign`, `collectSalvagePanels`, `entries`, `filter`, `forEach`, `has`, `hasNullSizes`, …
- **Imported by:** —

### `frontend/src/components/docking/marathonFeed.js`
- **Public symbols:** `collectMarathonPositions`, `collectMarathonTrades`, `getPilotRunState`, `getSharedPilotAccount`, `hasMarathonData`, `mergePaperLists`
- **Calls / imports:** `Boolean`, `Number`, `collectMarathonPositions`, `collectMarathonTrades`, `flatMap`, `getPilotRunState`, `getSharedPilotAccount`, `hasMarathonData`, `isFinite`, `keys`, …
- **Imported by:** —

### `frontend/src/components/docking/PairControlRowActions.jsx`
- **Public symbols:** `PairControlRowActions`
- **Calls / imports:** `Boolean`, `PairControlRowActions`, `async`, `encodeURIComponent`, `fetch`, `notifyChange`, `onRefresh`, `onStateChanged`, `return`, `setBusy`, …
- **Imported by:** —

### `frontend/src/components/docking/paperPairs.js`
- **Public symbols:** `AVAILABLE_STRATEGIES`, `POPULAR_COINS`, `collectCandidateSetups`, `collectPaperPairs`, `filterPaperPairs`, `pairTotalPnl`, `sortPaperPairs`
- **Calls / imports:** `Boolean`, `Map`, `Number`, `String`, `abs`, `collectCandidateSetups`, `collectPaperPairs`, `entries`, `filter`, `filterPaperPairs`, …
- **Imported by:** —

### `frontend/src/components/docking/Placeholders.jsx`
- **Public symbols:** `CvdPlaceholderWidget`
- **Calls / imports:** `CVD`, `CvdPlaceholderWidget`, `getPanelSymbol`, `return`, `useColorLinksStore`
- **Imported by:** —

### `frontend/src/components/docking/PostMortemAnalyticsTab.jsx`
- **Public symbols:** `PostMortemAnalyticsTab`
- **Calls / imports:** `E`, `Error`, `Kpi`, `Number`, `PostMortemAnalyticsTab`, `async`, `clearInterval`, `entries`, `fetch`, `fmt`, …
- **Imported by:** —

### `frontend/src/components/docking/PresetBar.jsx`
- **Public symbols:** `PresetBar`
- **Calls / imports:** `CustomEvent`, `Layers`, `Number`, `PresetBar`, `alert`, `async`, `button`, `confirm`, `deletePreset`, `dispatchEvent`, …
- **Imported by:** —

### `frontend/src/components/docking/ScreenerWidget.jsx`
- **Public symbols:** `ScreenerWidget`
- **Calls / imports:** `Map`, `Number`, `REST`, `Screener`, `ScreenerWidget`, `Set`, `Sparkline`, `add`, `arr`, `connectMonitoringStream`, …
- **Imported by:** —

### `frontend/src/components/docking/TerminalDockview.jsx`
- **Public symbols:** `TerminalDockview`
- **Calls / imports:** `ChartDockPanel`, `DOM`, `LTF`, `LiqAnalyticsDockPanel`, `Number`, `OrderBookDockPanel`, `ResizeObserver`, `Set`, `SignalsDockPanel`, `TerminalDockview`, …
- **Imported by:** —

### `frontend/src/components/docking/TradeHistoryWidget.jsx`
- **Public symbols:** `TradeHistoryWidget`
- **Calls / imports:** `Boolean`, `CustomEvent`, `Date`, `Error`, `Map`, `Number`, `PairChallengerQuickTest`, `Pilot`, `Set`, `String`, …
- **Imported by:** —

### `frontend/src/components/docking/TradesSettings.jsx`
- **Public symbols:** `DEFAULT_TRADES_SETTINGS`, `TradesSettings`
- **Calls / imports:** `Boom`, `COIN`, `Chime`, `Pop`, `TradesSettings`, `USD`, `handleChange`, `map`, `max`, `onTestSound`, …
- **Imported by:** —

### `frontend/src/components/docking/TradesWidget.jsx`
- **Public symbols:** `TradesWidget`
- **Calls / imports:** `Alerts`, `Date`, `ResizeObserver`, `Sales`, `String`, `TradesWidget`, `abs`, `addTradeListener`, `applyResize`, `cancelAnimationFrame`, …
- **Imported by:** —

### `frontend/src/components/docking/WatchlistWidget.jsx`
- **Public symbols:** —
- **Calls / imports:** `./ScreenerWidget`
- **Imported by:** —

### `frontend/src/components/docking/WidgetHubModal.jsx`
- **Public symbols:** `WidgetHubModal`
- **Calls / imports:** `Modal`, `WidgetHubModal`, `addWidgetPanel`, `closeWidgetHub`, `handleSelect`, `map`, `return`, `useLayoutStore`
- **Imported by:** —

### `frontend/src/components/docking/WorkspaceScroller.jsx`
- **Public symbols:** `WorkspaceScroller`
- **Calls / imports:** `Handle`, `Number`, `ResizeObserver`, `S`, `String`, `WorkspaceScroller`, `addEventListener`, `applyHeightPercent`, `auto`, `cancelAnimationFrame`, …
- **Imported by:** —

### `frontend/src/components/dom/constants.js`
- **Public symbols:** `BUFFER_ROWS`, `ROW_HEIGHT`, `SCALE_OPTIONS`, `TOTAL_ROWS`
- **Calls / imports:** —
- **Imported by:** —

### `frontend/src/components/dom/DOMControlsHeader.jsx`
- **Public symbols:** `DOMControlsHeader`
- **Calls / imports:** `Aggregation`, `DOMControlsHeader`, `Number`, `jsx`, `map`, `max`, `onClusterMode`, `onDensityThreshold`, `onMegaWall`, `onRowHeight`, …
- **Imported by:** —

### `frontend/src/components/dom/useAggregatedOrderbook.js`
- **Public symbols:** `useAggregatedOrderbook`
- **Calls / imports:** `First`, `Map`, `Number`, `Set`, `abs`, `add`, `alerts`, `delete`, `detectSpoofOrFill`, `entries`, …
- **Imported by:** —

### `frontend/src/components/dom/useDepthStream.js`
- **Public symbols:** `useDepthStream`
- **Calls / imports:** `Number`, `WebSocket`, `addEventListener`, `applyDepthSnapshot`, `clear`, `clearInterval`, `clearTimeout`, `close`, `connectDepthWs`, `connectTradeWs`, …
- **Imported by:** —

### `frontend/src/components/ErrorBoundary.jsx`
- **Public symbols:** `ErrorBoundary`
- **Calls / imports:** `Boolean`, `String`, `componentDidCatch`, `constructor`, `error`, `fallback`, `getDerivedStateFromError`, `onError`, `onReset`, `reload`, …
- **Imported by:** —

### `frontend/src/components/indicators/ActiveIndicatorStack.jsx`
- **Public symbols:** `ActiveIndicatorStack`
- **Calls / imports:** `ActiveIndicatorStack`, `map`, `onOpenSettings`, `onRemoveIndicator`, `onToggleVisibility`, `return`, `stopPropagation`
- **Imported by:** —

### `frontend/src/components/indicators/IndicatorSettingsDialog.jsx`
- **Public symbols:** `IndicatorSettingsDialog`
- **Calls / imports:** `IndicatorSettingsDialog`, `handleInputChange`, `handleStyleChange`, `map`, `onClose`, `onSave`, `parseFloat`, `preventDefault`, `return`, `setActiveTab`, …
- **Imported by:** —

### `frontend/src/components/indicators/IndicatorsModal.jsx`
- **Public symbols:** `IndicatorsModal`
- **Calls / imports:** `IndicatorsModal`, `Set`, `filter`, `getCategoryIcon`, `has`, `includes`, `map`, `onAddIndicator`, `onClose`, `onOpenSettings`, …
- **Imported by:** —

### `frontend/src/components/IndicatorsModal.jsx`
- **Public symbols:** `DEFAULT_INDICATORS_CONFIG`, `DEFAULT_INDICATORS_SETTINGS`, `IndicatorsModal`, `loadChartIndicators`, `saveChartIndicators`
- **Calls / imports:** `ATR`, `Boolean`, `Control`, `IndicatorsModal`, `MACD`, `Number`, `RSI`, `Ribbon`, `Tabs`, `VWAP`, …
- **Imported by:** —

### `frontend/src/components/LivePaperTradingView.jsx`
- **Public symbols:** `LiveEquityChart`, `LivePaperTradingControls`, `LivePaperTradingResults`
- **Calls / imports:** `API`, `Boolean`, `Curve`, `Date`, `Equity`, `L2`, `LiveEquityChart`, `LivePaperTradingControls`, `LivePaperTradingResults`, `Loss`, …
- **Imported by:** —

### `frontend/src/components/OrderBook.jsx`
- **Public symbols:** `OrderBook`
- **Calls / imports:** `Aggregation`, `Aggregator`, `Asks`, `Bids`, `Latching`, `Map`, `Number`, `OrderBook`, `Set`, `WebSocket`, …
- **Imported by:** —

### `frontend/src/components/OrderBookCanvasLadder.jsx`
- **Public symbols:** `OrderBookCanvasLadder`
- **Calls / imports:** `Bubbles`, `Cluster`, `Column`, `ENTRY`, `Number`, `OrderBookCanvasLadder`, `OrderBookDOM`, `Price`, `Projection`, `SL`, …
- **Imported by:** —

### `frontend/src/components/OrderBookDOM.jsx`
- **Public symbols:** `OrderBookDOM`
- **Calls / imports:** `Container`, `DOMControlsHeader`, `Header`, `Map`, `Number`, `OrderBookDOM`, `Overlay`, `ResizeObserver`, `ScalperTradeDesk`, `String`, …
- **Imported by:** —

### `frontend/src/components/OvernightPilotPanel.jsx`
- **Public symbols:** `OvernightPilotPanel`
- **Calls / imports:** `AppliedProfile`, `BacktestQuality`, `Boolean`, `ChallengerStatus`, `ClientAggregate`, `Date`, `Error`, `ForecastCard`, `Metric`, `Number`, …
- **Imported by:** —

### `frontend/src/components/PaperTradePanel.jsx`
- **Public symbols:** `PaperTradePanel`
- **Calls / imports:** `Number`, `PaperTradePanel`, `abs`, `fmtUsd`, `isFinite`, `map`, `return`, `toFixed`, `toLocaleString`
- **Imported by:** —

### `frontend/src/components/RecorderModal.jsx`
- **Public symbols:** `RecorderModal`
- **Calls / imports:** `RecorderModal`, `clearInterval`, `error`, `fetch`, `fetchStats`, `handleExport`, `json`, `map`, `max`, `min`, …
- **Imported by:** —

### `frontend/src/components/ReplayModal.jsx`
- **Public symbols:** `ReplayModal`
- **Calls / imports:** `Date`, `ReplayModal`, `String`, `URLSearchParams`, `advancePlayback`, `applyReplayEvent`, `async`, `beginPath`, `bookToBars`, `clearInterval`, …
- **Imported by:** —

### `frontend/src/components/ScalperTradeDesk.jsx`
- **Public symbols:** `ScalperTradeDesk`
- **Calls / imports:** `Bar`, `DOM`, `E`, `Number`, `PnL`, `Presets`, `Q`, `Risk`, `ScalperTradeDesk`, `Size`, …
- **Imported by:** —

### `frontend/src/components/SessionReviewPanel.jsx`
- **Public symbols:** `SessionReviewPanel`
- **Calls / imports:** `Date`, `Number`, `SessionReviewPanel`, `Stat`, `String`, `async`, `fetch`, `fetchReview`, `fmtTime`, `fmtUsd`, …
- **Imported by:** —

### `frontend/src/components/settings/AppearanceTab.jsx`
- **Public symbols:** `AppearanceTab`
- **Calls / imports:** `AppearanceTab`, `Density`, `Number`, `abs`, `calculateAutoScale`, `getDensity`, `getScaleMode`, `getUiScale`, `handleDensityChange`, `handleScaleChange`, …
- **Imported by:** —

### `frontend/src/components/settings/ChartsTab.jsx`
- **Public symbols:** `ChartsTab`
- **Calls / imports:** `Boolean`, `ChartsTab`, `RSI`, `VOL`, `map`, `max`, `parseInt`, `return`, `updateUi`
- **Imported by:** —

### `frontend/src/components/settings/constants.js`
- **Public symbols:** `OVERRIDE_COINS`, `TIMEFRAMES`
- **Calls / imports:** —
- **Imported by:** —

### `frontend/src/components/settings/OrderflowTab.jsx`
- **Public symbols:** `OrderflowTab`
- **Calls / imports:** `L2`, `Number`, `OrderflowTab`, `map`, `max`, `return`, `toFixed`, `updateUi`
- **Imported by:** —

### `frontend/src/components/settings/ScannerTab.jsx`
- **Public symbols:** `ScannerTab`
- **Calls / imports:** `Parquet`, `ScannerTab`, `Score`, `handleChange`, `handleCoinOverrideChange`, `map`, `parseFloat`, `parseInt`, `replace`, `return`, …
- **Imported by:** —

### `frontend/src/components/settings/uiConfig.js`
- **Public symbols:** `DEFAULT_UI_CONFIG`, `MONO_FONTS`, `THEME_PRESETS`, `applyTheme`, `applyUiConfigToDOM`, `loadLocalUiConfig`
- **Calls / imports:** `Mono`, `String`, `applyTheme`, `applyUiConfigToDOM`, `getItem`, `isArray`, `loadLocalUiConfig`, `parse`, `resolveThemeId`, `setItem`, …
- **Imported by:** —

### `frontend/src/components/settings/VisibilityTab.jsx`
- **Public symbols:** `DEFAULT_VISIBILITY`, `VISIBILITY_PRESETS`, `VisibilityTab`, `persistVisibility`, `readStoredVisibility`
- **Calls / imports:** `CustomEvent`, `VisibilityTab`, `dispatchEvent`, `entries`, `getItem`, `handleApplyPreset`, `handleToggle`, `map`, `parse`, `persistVisibility`, …
- **Imported by:** —

### `frontend/src/components/SettingsModal.jsx`
- **Public symbols:** `SettingsModal`
- **Calls / imports:** `Number`, `SQLite`, `SettingsModal`, `VISIBILITY`, `applyUiConfigToDOM`, `error`, `fetch`, `json`, `keys`, `map`, …
- **Imported by:** —

### `frontend/src/components/SignalsFeed.jsx`
- **Public symbols:** `SignalsFeed`
- **Calls / imports:** `Date`, `Header`, `SignalsFeed`, `clearInterval`, `error`, `fetch`, `fetchSignals`, `includes`, `isArray`, `json`, …
- **Imported by:** —

### `frontend/src/components/Tape.jsx`
- **Public symbols:** `Tape`
- **Calls / imports:** `Bar`, `Date`, `Number`, `String`, `Tape`, `WebSocket`, `clearInterval`, `close`, `fetch`, `filter`, …
- **Imported by:** —

### `frontend/src/components/ui/accordion.jsx`
- **Public symbols:** —
- **Calls / imports:** `cn`, `forwardRef`
- **Imported by:** —

### `frontend/src/components/ui/alert-dialog.jsx`
- **Public symbols:** —
- **Calls / imports:** `buttonVariants`, `cn`, `forwardRef`
- **Imported by:** —

### `frontend/src/components/ui/badge.jsx`
- **Public symbols:** —
- **Calls / imports:** `Badge`, `badgeVariants`, `cn`, `cva`, `return`
- **Imported by:** —

### `frontend/src/components/ui/button.jsx`
- **Public symbols:** —
- **Calls / imports:** `buttonVariants`, `cn`, `cva`, `forwardRef`, `return`
- **Imported by:** —

### `frontend/src/components/ui/card.jsx`
- **Public symbols:** —
- **Calls / imports:** `cn`, `forwardRef`
- **Imported by:** —

### `frontend/src/components/ui/checkbox.jsx`
- **Public symbols:** —
- **Calls / imports:** `cn`, `forwardRef`
- **Imported by:** —

### `frontend/src/components/ui/context-menu.jsx`
- **Public symbols:** —
- **Calls / imports:** `cn`, `forwardRef`, `return`
- **Imported by:** —

### `frontend/src/components/ui/customPrimitives.jsx`
- **Public symbols:** `EmptyState`, `Kbd`, `KpiCard`, `SectionHeader`, `StatusDot`
- **Calls / imports:** `EmptyState`, `Kbd`, `KpiCard`, `SectionHeader`, `StatusDot`, `cn`, `return`
- **Imported by:** —

### `frontend/src/components/ui/DataTableHeader.jsx`
- **Public symbols:** `DataTableHeader`
- **Calls / imports:** `Boolean`, `DataTableHeader`, `String`, `addEventListener`, `handleDragOver`, `handleDragStart`, `handleDrop`, `map`, `onReorder`, `onResize`, …
- **Imported by:** —

### `frontend/src/components/ui/dialog.jsx`
- **Public symbols:** —
- **Calls / imports:** `cn`, `forwardRef`
- **Imported by:** —

### `frontend/src/components/ui/dropdown-menu.jsx`
- **Public symbols:** —
- **Calls / imports:** `cn`, `forwardRef`, `return`, `var`
- **Imported by:** —

### `frontend/src/components/ui/input.jsx`
- **Public symbols:** —
- **Calls / imports:** `cn`, `forwardRef`, `return`
- **Imported by:** —

### `frontend/src/components/ui/label.jsx`
- **Public symbols:** —
- **Calls / imports:** `cn`, `cva`, `forwardRef`, `labelVariants`
- **Imported by:** —

### `frontend/src/components/ui/number-input.jsx`
- **Public symbols:** —
- **Calls / imports:** `cn`, `forwardRef`, `return`
- **Imported by:** —

### `frontend/src/components/ui/popover.jsx`
- **Public symbols:** —
- **Calls / imports:** `cn`, `forwardRef`
- **Imported by:** —

### `frontend/src/components/ui/scroll-area.jsx`
- **Public symbols:** —
- **Calls / imports:** `cn`, `forwardRef`
- **Imported by:** —

### `frontend/src/components/ui/section-header.jsx`
- **Public symbols:** `SectionHeader`
- **Calls / imports:** `SectionHeader`, `return`
- **Imported by:** —

### `frontend/src/components/ui/select.jsx`
- **Public symbols:** —
- **Calls / imports:** `cn`, `forwardRef`, `var`
- **Imported by:** —

### `frontend/src/components/ui/separator.jsx`
- **Public symbols:** —
- **Calls / imports:** `cn`, `forwardRef`
- **Imported by:** —

### `frontend/src/components/ui/slider.jsx`
- **Public symbols:** —
- **Calls / imports:** `cn`, `forwardRef`
- **Imported by:** —

### `frontend/src/components/ui/switch.jsx`
- **Public symbols:** —
- **Calls / imports:** `cn`, `forwardRef`
- **Imported by:** —

### `frontend/src/components/ui/SymbolLink.jsx`
- **Public symbols:** `SymbolLink`
- **Calls / imports:** `String`, `SymbolLink`, `find`, `focusSymbol`, `getState`, `onClick`, `return`, `setChannelSymbol`, `stopPropagation`, `toUpperCase`, …
- **Imported by:** —

### `frontend/src/components/ui/table.jsx`
- **Public symbols:** —
- **Calls / imports:** `cn`, `forwardRef`, `has`
- **Imported by:** —

### `frontend/src/components/ui/tabs.jsx`
- **Public symbols:** —
- **Calls / imports:** `cn`, `forwardRef`
- **Imported by:** —

### `frontend/src/components/ui/toggle-group.jsx`
- **Public symbols:** —
- **Calls / imports:** `cn`, `createContext`, `forwardRef`, `return`, `toggleVariants`, `useContext`
- **Imported by:** —

### `frontend/src/components/ui/toggle.jsx`
- **Public symbols:** —
- **Calls / imports:** `cn`, `cva`, `forwardRef`, `toggleVariants`
- **Imported by:** —

### `frontend/src/components/ui/tooltip.jsx`
- **Public symbols:** —
- **Calls / imports:** `cn`, `forwardRef`
- **Imported by:** —

### `frontend/src/components/ui/useTableColumns.js`
- **Public symbols:** `useTableColumns`
- **Calls / imports:** `Map`, `delete`, `filter`, `forEach`, `fromEntries`, `get`, `getItem`, `has`, `isArray`, `map`, …
- **Imported by:** —

### `frontend/src/components/UiKitShowcase.jsx`
- **Public symbols:** `UiKitShowcase`
- **Calls / imports:** `Active`, `Kit`, `UiKitShowcase`, `getCurrentTheme`, `map`, `return`, `setTheme`
- **Imported by:** —

### `frontend/src/config/coinLibrary.js`
- **Public symbols:** `COIN_REGISTRY`, `DEFAULT_FOCUS_LIST`, `EXCHANGES`, `getCoinMeta`
- **Calls / imports:** `Coins`, `getCoinMeta`, `replace`, `slice`, `toUpperCase`, `trim`
- **Imported by:** —

### `frontend/src/config/drawingTemplates.js`
- **Public symbols:** `PRESEEDED_SMC_TEMPLATES`, `deleteCustomTemplate`, `getAllTemplates`, `getStyleMemory`, `saveCustomTemplate`, `saveStyleMemory`
- **Calls / imports:** `Block`, `Box`, `CHoCH`, `FVG`, `Pool`, `SMC`, `deleteCustomTemplate`, `filter`, `getAllTemplates`, `getItem`, …
- **Imported by:** —

### `frontend/src/config/indicatorsRegistry.js`
- **Public symbols:** `DEFAULT_ACTIVE_INDICATORS`, `INDICATORS_REGISTRY`, `INDICATOR_CATEGORIES`
- **Calls / imports:** `Average`, `BOLL`, `CVD`, `DIF`, `Index`, `KLineCharts`, `MACD`, `Number`, `Range`, `VOL`
- **Imported by:** —

### `frontend/src/DesignShowcase.jsx`
- **Public symbols:** `DesignShowcase`
- **Calls / imports:** `Data`, `DesignShowcase`, `addEventListener`, `applyThemeToDOM`, `async`, `error`, `fetch`, `fetchMarketData`, `gradient`, `json`, …
- **Imported by:** —

### `frontend/src/features/pilot/api.js`
- **Public symbols:** `pilotApi`
- **Calls / imports:** `AbortController`, `Error`, `URLSearchParams`, `abort`, `clearTimeout`, `encodeURIComponent`, `fetch`, `json`, `request`, `setTimeout`, …
- **Imported by:** —

### `frontend/src/features/pilot/model.js`
- **Public symbols:** `STRATEGIES`, `allocateCapital`, `configKey`, `describeLatestChallenger`, `describePaperAdmission`, `describePilotEvent`, `describeProfileApplication`, `hasRunning`, `optimizedPatch`, `optimizerRequest`, …
- **Calls / imports:** `Boolean`, `Error`, `Number`, `Pullback`, `Set`, `String`, `Trend`, `Window`, `add`, `allocateCapital`, …
- **Imported by:** —

### `frontend/src/features/pilot/PilotConfig.jsx`
- **Public symbols:** `NumberField`, `PilotConfig`, `button`, `control`
- **Calls / imports:** `Boolean`, `Number`, `NumberField`, `PilotConfig`, `String`, `allocate`, `allocateCapital`, `filter`, `map`, `onChange`, …
- **Imported by:** —

### `frontend/src/features/pilot/PilotDashboard.jsx`
- **Public symbols:** `PilotDashboard`
- **Calls / imports:** `Number`, `PilotDashboard`, `TradeList`, `ceil`, `describePilotEvent`, `entries`, `filter`, `find`, `join`, `map`, …
- **Imported by:** —

### `frontend/src/features/pilot/PilotResults.jsx`
- **Public symbols:** `Forecast`, `Metrics`, `PilotResults`, `Report`, `number`, `time`
- **Calls / imports:** `AppliedProfile`, `Boolean`, `Date`, `Forecast`, `Metrics`, `Number`, `PaperAdmission`, `PilotResults`, `Report`, `applyOptimization`, …
- **Imported by:** —

### `frontend/src/features/pilot/PilotWorkspace.jsx`
- **Public symbols:** `PilotDialog`, `PilotWorkspace`
- **Calls / imports:** `Boolean`, `PilotDialog`, `PilotWorkspace`, `calc`, `canStart`, `clearInterval`, `close`, `configKey`, `createPilotStore`, `createPortal`, …
- **Imported by:** —

### `frontend/src/features/pilot/store.js`
- **Public symbols:** `createPilotStore`
- **Calls / imports:** `Boolean`, `allocateCapital`, `async`, `canStart`, `configKey`, `createJSONStorage`, `createPilotStore`, `createStore`, `defaults`, `events`, …
- **Imported by:** —

### `frontend/src/features/replay/replayPlayerMath.js`
- **Public symbols:** `BOOK_LEVELS`, `PRICE_SERIES_MAX`, `advancePlayback`, `applyReplayEvent`, `bookToBars`, `createInitialPlayerState`, `cvdOf`
- **Calls / imports:** `Number`, `abs`, `advancePlayback`, `applyReplayEvent`, `bookToBars`, `createInitialPlayerState`, `cvdOf`, `filter`, `floor`, `frac`, …
- **Imported by:** —

### `frontend/src/hooks/useTradeAudioAlerts.js`
- **Public symbols:** `useTradeAudioAlerts`
- **Calls / imports:** `AudioCtxClass`, `Whale`, `alarm`, `canPlay`, `close`, `connect`, `createBiquadFilter`, `createGain`, `createOscillator`, `exponentialRampToValueAtTime`, …
- **Imported by:** —

### `frontend/src/lib/utils.js`
- **Public symbols:** `cn`
- **Calls / imports:** `clsx`, `cn`, `twMerge`
- **Imported by:** —

### `frontend/src/main.jsx`
- **Public symbols:** —
- **Calls / imports:** `createRoot`, `getElementById`, `includes`, `render`
- **Imported by:** —

### `frontend/src/services/backtestStrategyLevels.js`
- **Public symbols:** `deriveBacktestStrategyLevels`
- **Calls / imports:** `Number`, `Set`, `add`, `deriveBacktestStrategyLevels`, `has`, `isArray`, `isFinite`, `push`, `reverse`
- **Imported by:** —

### `frontend/src/services/crosshairBus.js`
- **Public symbols:** `crosshairBus`
- **Calls / imports:** `Boolean`, `CrosshairBus`, `CustomEvent`, `React`, `Set`, `add`, `constructor`, `delete`, `dispatchEvent`, `emitSyncState`, …
- **Imported by:** —

### `frontend/src/services/marketDataFetcher.js`
- **Public symbols:** `TF_MS`, `fetchKlinesDualSource`, `getCandlesFromCache`, `mapTimeframeToBinance`, `normalizeCandle`, `resampleCandles`, `saveCandlesToCache`
- **Calls / imports:** `API`, `AbortController`, `Backend`, `Cache`, `Map`, `Number`, `Source`, `abort`, `backend`, `clearTimeout`, …
- **Imported by:** —

### `frontend/src/services/marketTruth.js`
- **Public symbols:** `getUsableMarketPrice`, `resolveAlertPriceInput`
- **Calls / imports:** `Number`, `String`, `getUsableMarketPrice`, `isFinite`, `resolveAlertPriceInput`
- **Imported by:** —

### `frontend/src/stores/alertsStore.js`
- **Public symbols:** `useAlertsStore`
- **Calls / imports:** `CustomEvent`, `Store`, `create`, `dispatchEvent`, `filter`, `get`, `getItem`, `loadInitialAlerts`, `map`, `now`, …
- **Imported by:** —

### `frontend/src/stores/backtestStore.js`
- **Public symbols:** `DEFAULT_LIVE_PAPER_CONFIG`, `DEFAULT_TICKER_PARAMS`, `useBacktestStore`
- **Calls / imports:** `Boolean`, `Error`, `Number`, `abs`, `async`, `create`, `error`, `fetch`, `get`, `getParamsForSymbol`, …
- **Imported by:** —

### `frontend/src/stores/colorLinksStore.js`
- **Public symbols:** `COLOR_CHANNELS`, `useColorLinksStore`
- **Calls / imports:** `CustomEvent`, `SPECIFICATION`, `Store`, `assigned`, `channel`, `channels`, `color`, `create`, `dispatchEvent`, `get`, …
- **Imported by:** —

### `frontend/src/stores/layoutStore.js`
- **Public symbols:** `useLayoutStore`
- **Calls / imports:** `AbortController`, `Error`, `Promise`, `SAFEGUARDS`, `Store`, `abort`, `async`, `autosave`, `clearTimeout`, `create`, …
- **Imported by:** —

### `frontend/src/stores/liquidityWallStore.js`
- **Public symbols:** `binLevels`, `createWallTracker`, `getWallsForSymbol`, `useLiquidityWallStore`
- **Calls / imports:** `Map`, `Number`, `Set`, `String`, `abs`, `add`, `binLevels`, `binSize`, `ceil`, `clamp01`, …
- **Imported by:** —

### `frontend/src/stores/marketDataStore.js`
- **Public symbols:** `useMarketDataStore`
- **Calls / imports:** `Boolean`, `DATA`, `Error`, `Map`, `Number`, `Store`, `WebSocket`, `addEventListener`, `async`, `clear`, …
- **Imported by:** —

### `frontend/src/stores/quantStore.js`
- **Public symbols:** `useQuantStore`
- **Calls / imports:** `Boolean`, `Number`, `all`, `async`, `create`, `error`, `fetch`, `fetchMarketData`, `get`, `json`, …
- **Imported by:** —

### `frontend/src/stores/tradeOverlayStore.js`
- **Public symbols:** `calculatePositionMetrics`, `useTradeOverlayStore`
- **Calls / imports:** `Number`, `Store`, `abs`, `calculatePositionMetrics`, `create`, `getState`, `loops`, `set`, `toFixed`
- **Imported by:** —

### `frontend/src/stores/tradesStore.js`
- **Public symbols:** `formatCompact`, `formatPrice`, `useTradesStore`
- **Calls / imports:** `Boolean`, `Map`, `Number`, `Set`, `Store`, `WebSocket`, `abs`, `add`, `addEventListener`, `clearInterval`, …
- **Imported by:** —

### `frontend/src/theme/screenTiers.js`
- **Public symbols:** `SCREEN_TIERS`, `calculateAutoScale`, `getTierForWidth`
- **Calls / imports:** `HD`, `QHD`, `calculateAutoScale`, `getTierForWidth`
- **Imported by:** —

### `frontend/src/theme/themeBridge.js`
- **Public symbols:** `themeBridge`
- **Calls / imports:** `Number`, `Set`, `String`, `ThemeBridge`, `add`, `applyScaleAndDensityToDOM`, `calculateAutoScale`, `callback`, `constructor`, `delete`, …
- **Imported by:** —

### `frontend/src/theme/themeMeta.js`
- **Public symbols:** `DEFAULT_THEME_ID`, `THEMES`, `THEME_ALIASES`
- **Calls / imports:** —
- **Imported by:** —

### `frontend/src/theme/themes.js`
- **Public symbols:** `CANDLE_MODES`, `LIQUIDATION_PALETTES`, `THEME_PRESETS`, `applyThemeToDOM`
- **Calls / imports:** `String`, `applyThemeToDOM`, `setAttribute`, `setProperty`, `setTheme`
- **Imported by:** —

### `frontend/src/utils/chartAnnotations.js`
- **Public symbols:** `clearBacktestTrades`, `clearLiveSignals`, `clearWhaleTrades`, `renderBacktestTrades`, `renderLiveSignals`, `renderWhaleTrades`
- **Calls / imports:** `Arrow`, `Number`, `String`, `badge`, `badges`, `clearBacktestTrades`, `clearLiveSignals`, `clearWhaleTrades`, `createOverlay`, `createShape`, …
- **Imported by:** —

### `frontend/src/utils/orderbookLogic.js`
- **Public symbols:** `aggregateDepth`, `detectSpoofOrFill`, `evaluateProximityAlert`
- **Calls / imports:** `Asks`, `Bids`, `Map`, `Number`, `PULLED`, `abs`, `aggregateDepth`, `approaching`, `away`, `buckets`, …
- **Imported by:** —

### `frontend/src/utils/researchVerdict.js`
- **Public symbols:** `buildResearchVerdict`, `deterministicSignalId`
- **Calls / imports:** `Number`, `String`, `buildResearchVerdict`, `charCodeAt`, `data`, `deterministicSignalId`, `imul`, `isArray`, `join`, `stableText`, …
- **Imported by:** —

### `frontend/src/utils/sound.js`
- **Public symbols:** `soundManager`
- **Calls / imports:** `AudioContextClass`, `arpeggio`, `connect`, `createGain`, `createOscillator`, `exponentialRampToValueAtTime`, `forEach`, `getAudioContext`, `getItem`, `ping`, …
- **Imported by:** —
