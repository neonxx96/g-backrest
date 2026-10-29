# SignalScript Engineering Roadmap

## 1. Done (Completed Milestones)

| ID | Description | Affected Files | Priority | Size | Status |
|---|---|---|---|---|---|
| `TASK-001` | Update model routing and documentation structure | `config/model-routing.json`, `docs/` | P2 | S | `DONE` |
| `TASK-002` | Defensive net & circuit breakers for drawdown protection | `backend/app/services/risk_engine.py` | P0 | M | `DONE` |
| `TASK-003` | Production robust baseline preset closeout | `backend/tests/`, `scripts/night-pilot.ps1` | P1 | S | `DONE` |
| `TASK-004` | Order flow footprint clusters & stacked imbalance | `FootprintPanel.jsx`, `cluster_filters.py` | P0 | L | `DONE` |
| `TASK-005` | Selective dynamic SL/TP calculation (ATR cone & magnet hybrid) | `ai_copilot.py`, `orderflow_backtester.py` | P1 | M | `DONE` |
| `TASK-006` | AI Sentinel profit retention & early exit engine | `EarlyExitEngine.py`, `ai_sentinel.py` | P1 | M | `DONE` |
| `TASK-007` | Canvas 2D Footprint chart engine & Dockview integration | `Chart.jsx`, `TerminalDockview.jsx` | P0 | L | `DONE` |
| `TASK-008A` | Quantum Risk Engine & Net Expectancy ($E_R > 0$) | `risk_engine.py`, `regime_classifier.py` | P0 | L | `DONE` |
| `TASK-008B` | Post-mortem trade diagnostic & Fee Burden Index | `trade_postmortem_service.py`, `PostMortemAnalyticsTab.jsx` | P1 | M | `DONE` |
| `TASK-008C` | 1-Click Auto-Select strategy & timeframe calibration | `select_pair_strategies.py`, `overnight_pilot.py` | P0 | M | `DONE` |
| `DESIGN-A` | Responsive canvas resizing, hysteresis, and screen tiers | `useChartLifecycle.js`, `screenTiers.js` | P1 | M | `DONE` |
| `DESIGN-B` | Compact 2-row chart toolbar & Crosshair synchronization bus | `ChartToolbar.jsx`, `crosshairBus.js` | P1 | M | `DONE` |
| `DESIGN-C` | Quality gate ratchet linting & HUD collision elimination | `scripts/design_lint.mjs`, `PositionSetupHUD.jsx` | P1 | M | `DONE` |
| `DESIGN-D0`| Linux container pytest check [1b] & miniTicker WebSocket failover | `scripts/check.ps1`, `marketDataStore.js` | P0 | S | `DONE` |
| `DESIGN-D1`| Pair-level start/pause/close controls with SQLite persistence | `overnight_pilot.py`, `PairControlRowActions.jsx` | P0 | M | `DONE` |
| `DESIGN-D2`| Dockview theme styling (28px tabs, 1px sashes, global tokens) | `frontend/src/index.css`, `section-header.jsx` | P1 | M | `DONE` |
| `DESIGN-D3`| Codemod design token migration (-998 violations eliminated) | 75+ JSX files, `lint-baseline.json` | P1 | L | `DONE` |
| `DESIGN-D4`| Migrate inputs, checkboxes, and modals to shadcn primitives | `number-input.jsx`, `SettingsModal.jsx`, `DecisionJournalModal.jsx` | P1 | M | `DONE` |
| `CODEX-HANDOFF` | Canonical docs, deterministic CodeMap generator, documentation gate, and repository-hygiene audit | `AGENTS.md`, `docs/`, `scripts/gen_codemap.py`, `scripts/check_docs.py`, `.gitignore` | P0 | M | `DONE` |

---

## 2. In Progress

| ID | Description | Affected Files | Priority | Size | Status |
|---|---|---|---|---|---|
| `MARATHON-01` | Guarded AI selection → preflight → shared-$1,000 paper autopilot, with truthful recovery state after backend restart; runtime multi-pair observation remains to be completed | `backend/app/services/overnight_pilot.py`, `backend/app/routers/overnight_pilot.py`, `frontend/src/components/docking/` | P0 | L | `IN_PROGRESS` |
| `MARATHON-02` | Expand liquid crypto candidates and align selector ATR/history-window parameters with paper preflight; ten admitted concurrent pairs still require a safe transition from active positions | `backend/app/services/pair_selector.py`, `backend/app/services/overnight_pilot.py` | P0 | M | `IN_PROGRESS` |
| `PRODUCT-01` | BTCUSDT EMA Trend vertical slice: one closed-candle profile from backtest through scenario and paper admission explanation | `backtest.py`, `ai_copilot_service.py`, `frontend/src/features/pilot/` | P0 | M | `IN_PROGRESS` |
| `PAPER-LAB-01` | Versioned paper-strategy catalogue plus bounded realtime challengers and flat-only automatic strategy promotion for a curated 10–20 pair paper universe | `strategy_catalog.py`, `overnight_pilot.py`, `pair_selector.py`, `live_paper_runner.py`, Pilot UI | P0 | L | `IN_PROGRESS` |

---

## 3. Next (Immediate Priorities for Next Agent)

| ID | Description | Affected Files | Priority | Size | Status |
|---|---|---|---|---|---|
| `NEXT-01` | Eliminate remaining 1031 design system violations in 73 files | `src/components/`, `lint-baseline.json` | P2 | M | `TODO` |
| `NEXT-02` | Comparative A/B performance backtest on historical lake slice | `engine/backtester.py`, `scripts/` | P1 | L | `TODO` |
| `NEXT-03` | Separate backend modularization according to MODULARIZATION_PLAN | `backend/app/services/` | P2 | L | `TODO` |
| `NEXT-04` | Multi-monitor DPI scaling test for floating Dockview windows | `frontend/src/components/docking/` | P2 | S | `TODO` |

---

## 4. Backlog

| ID | Description | Affected Files | Priority | Size | Status |
|---|---|---|---|---|---|
| `BACKLOG-01`| Offload heavy Parquet lake (>2 TB) to dedicated remote server | `recorder/`, `backend/app/config.py` | P2 | L | `BACKLOG` |
| `BACKLOG-02`| Dedicated standalone mobile view (desktop remains >=1280px) | `frontend/` | P3 | L | `BACKLOG` |
| `BACKLOG-03`| Direct Bybit / OKX WebSocket adapter failover pool | `backend/app/services/binance_service.py` | P3 | M | `BACKLOG` |
| `BACKLOG-04`| Complete safe local launcher contract: PowerShell-level identity tests, full-process ownership checks, and a whole-launch mutex. Ports are fixed; this work is not a blocker for product flow. | `run_app.ps1`, launcher tests | P2 | M | `BACKLOG` |

---

## 5. Known Issues & Operational Watchpoints

1. **Local backend.log file lock on Windows:** When `backend/main.py` is running locally, `backend.log` is held open by Python `logging.FileHandler`. Do not attempt to move or rename `backend.log` while the process is active.
2. **Design lint ratchet baseline (1031 violations):** The baseline in `design/lint-baseline.json` is strictly ratchet-down. Any commit introducing a new raw color will fail step `[3b]` of `scripts/check.ps1`.
3. **PowerShell UTF-8 BOM encoding:** `scripts/check.ps1` must maintain UTF-8 BOM (`\xef\xbb\xbf`) to prevent PowerShell parser syntax anomalies on non-English Windows locales.
4. **Pytest warnings:** the host suite passes with unawaited-coroutine warnings in `live_paper_runner.py` and an `aiosqlite` worker thread after an event loop closes.
