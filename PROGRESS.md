# PROGRESS.md — Development Journal & Subsystem Status

> **JOURNAL RULES FOR AGENTS:**
> 1. **Who & When:** Written strictly by the active agent upon successful completion and verification of each task.
> 2. **Entry Format:** `YYYY-MM-DD [AGENT-NAME] Task <ID>: <Summary of what was achieved and verified>`.
> 3. **Subsystem Table:** Update Section 1 table status (`READY`, `ACTIVE`, `IN_PROGRESS`, `DISABLED`) if altered.
> 4. **Verification Requirement:** Every logged milestone must be accompanied by an EXIT_CODE=0 from `scripts/check.ps1`.
> 5. **Zero Secrets:** Never log API tokens, environment dumps, or sensitive user data.

---

## 1. Subsystem Status Matrix (October 2026, Quantum & Design Refinement)

| Subsystem | Status | Implementation Details |
|---|---|---|
| **Frontend Core & Charts** | `READY` | React 19, KLineCharts v9, 2-row toolbar, crosshair bus, Canvas 2D L2 DOM & Footprint. Port `7100`. |
| **Backend Core & DB** | `READY` | FastAPI on `uvicorn` (port `8000`), aiosqlite `data/signals.db` with Expectancy columns. |
| **Order Flow Lake & Recorder** | `READY` | Ring-buffer in `data/spool/`, Parquet Lake `data/lake/`, daily files `data/recorded/`. |
| **Market Regime Classifier** | `ACTIVE` | Dual-timeframe (5m/15m) Choppiness Index (CI-14), ATR/BBW rolling percentiles. |
| **Microstructure Gate** | `ACTIVE` | Spread check, 0.5% corridor depth, book imbalance $I_{depth}$, CVD absorption guard. |
| **Risk Engine & Sizing** | `ACTIVE` | Strict SL-distance sizing with $2 \times Fee$ deduction. Portfolio Heat 1.25%, Directional 0.75%. |
| **Circuit Breakers** | `ACTIVE` | Protective circuit breaker on daily drawdown $\ge 3.0\%$ or 4 consecutive losses. |
| **Position Sentinel** | `ACTIVE` | Dynamic Breakeven (+1.0R with double fee offset), Step-Lock (1.2R / 1.8R), 50% partial drop. |
| **Pyramiding (Adding to size)** | `DISABLED` | `ENABLE_PYRAMIDING = False` strictly enforced pending comparative backtesting. |
| **Trade Post-Mortem & Analytics**| `ACTIVE` | MFE/MAE analysis, Fee Burden Index, loss classification, UI "Аналитика & Винрейт" tab. |
| **Strategy & TF Pair Selector** | `ACTIVE` | Automated strategy/TF selection with Out-Of-Sample validation (70% TRAIN / 30% OOS). |
| **Overnight Paper Marathon** | `ACTIVE` | 13 demo runners on shared account `overnight_shared_1793301106` ($1,000, `dev` branch, launched 2026-10-29); challenger auto-switch enabled per pair, fills pending strategy signals. |
| **Design System & Tokens** | `READY` | shadcn/ui primitives, 28px Dockview tabs, 4 theme presets, lint ratchet (1031 baseline). |

---

## 2. Completed Milestones

- **2026-10-31 [Kimi] Task WIDGET SIZE PERSISTENCE ROOT FIX (AUTOSAVE DEAD SUBSCRIPTION) + PILOT WATCHDOG HARDENING + HEIGHT SLIDER**:
  - User report "размеры виджетов не запоминаются после перезагрузки" root-caused live (Playwright + fetch interception): backend route was healthy (manual POST updated SQLite), `isLayoutLoaded` gate open, no `null-size` skips — yet **zero** `POST /api/workspaces` ever left the browser after sash drags. Root cause: the `onDidLayoutChange` autosave subscription lived inside `onReady`, and React StrictMode's simulated unmount/remount runs the cleanup effect (`dispose`) while dockview-react fires `onReady` only once per instance — so every dev/prod StrictMode mount left the subscription dead. Fix: subscription moved to a `dockviewApi`-state-keyed effect that re-subscribes on every (re)mount. Verified live: resize → `POST /api/workspaces` → SQLite `updated_at` advances; after reload widths `[560,680,680,680,1360]` and slider height `2040px` both restore exactly.
  - Terminal depth control: added the requested floating vertical slider (center-right of the screen, `writing-mode: vertical-lr`, semantic `--primary` accent, 100% = auto … 300%) on top of the sticky handle; writes the same per-preset localStorage key + relayouts dockview; live-verified position and 200% → 2040px.
  - Pilot watchdog hardening (`scripts/demo_watchdog.py`): 3 consecutive failed health cycles (was 2) before killing, and a new `adopt_backend()` probe — if the port-8000 owner already answers `/health` as our backend, the watchdog adopts it (writes `data/backend.pid`) instead of killing a healthy tree; targets the "пары постоянно останавливаются" symptom from multiple launchers fighting over port 8000. `py_compile` clean; watchdog restarted detached.

- **2026-10-31 [Kimi] Task TERMINAL HEIGHT (DEPTH) CONTROL MADE USABLE**:
  - The height controls existed (PresetBar «Авто/+25%/+50%/x2/x3» + bottom drag handle) but were unusable: the no-arg `layout()` bug (fixed earlier today) had broken their effect, and the drag handle rendered below the visible fold at the exact screen bottom — invisible and ungrabbable.
  - `WorkspaceScroller`: handle is now `sticky bottom-0` (always docked at the visible bottom edge of the scroller) and raised to `z-[100]` — dockview sashes carry `z-index: 99` and painted over it, so the hit test landed on a dockview sash instead of the handle.
  - Drag model reworked to virtual extension: the physical mouse cannot pass the screen edge, so holding the cursor at the bottom edge keeps extending the workspace (12px per mousemove, up to 8000px); moving back up shrinks the accumulated extra. Double-click resets to auto. Handle shows a live label («высота терминала», current % when extended).
  - Verified live (Playwright): edge-hold drag 1020→1325px with dockview relayout + localStorage persist; JS dblclick reset → 1020/`auto`; PresetBar +50% → 1530, Авто → 1020. Full gate `scripts/check.ps1` → ALL QUALITY CHECKS PASSED (one prior canvas-metric flake, green on re-run).

- **2026-10-31 [Kimi] Task DOCKVIEW WINDOWS DRAG/RESIZE ROOT FIX (NaN SIZE MODEL)**:
  - User report "окна не двигаются и не меняют размер" root-caused to a dockview-core 8.6 internal defect, verified live (Playwright): every `SplitView.layout()` pass ended with **NaN** in all node sizes. Mechanism: a single non-finite layout input makes `previousSize = Math.max(NaN, 0)` NaN forever, proportions never save, and every later layout re-poisons `viewItem.size`. DOM still distributed (flex fallback masked it), but sashes stayed disabled and `toJSON()` serialized `size:null` — which the autosave persisted, self-sustaining poisoned workspaces (all panels `.dv-disabled` after reload).
  - Fix 1 — vendor patch `frontend/scripts/patch-dockview-core.mjs` (wired into `postinstall`, idempotent, fails loudly on bundle drift): sanitizes non-finite sizes at `SplitView.layout()` entry and ignores `DockviewComponent.layout()` calls with non-finite width/height.
  - Fix 2 — `WorkspaceScroller` called `dockviewApi.layout()` with **no arguments** in 4 places (height preset, drag handle, mouseup, heightPx effect); no-arg calls collapse the shell to minimum sizes and lock a stale inline style via the ResizeObserver feedback loop. Replaced with `relayoutDockview()` passing scroller-measured `layout(width, height, true)`.
  - Defense in depth kept from earlier session: `hasNullSizes()` autosave guard (never persist degenerate serialization), salvage rebuild via `collectSalvagePanels()` for already-poisoned workspaces, rAF degenerate-layout safety net.
  - Verified live: container 1920×1020, finite sizes, 4/4 sashes enabled, tab drag changes layout, sash drag resizes and persists (`scripts/verify_dock_drag_resize.py` — DRAG ✅ RESIZE ✅; resize driven via PointerEvents since CDP mouse drags don't reach dockview's pointerdown). Unit: layoutSanitizer 9/9. Full gate `scripts/check.ps1` → ALL QUALITY CHECKS PASSED.

- **2026-10-31 [Kimi] Task POST-REBOOT RECOVERY + ZOMBIE SESSIONS + DOCKER PORT HIJACK FIX**:
  - Morning post-mortem after the user's break: PC rebooted 2026-10-30 16:50 and took the whole demo stack down for ~22h — nothing auto-started after the reboot. Root-caused and fixed three independent defects:
  - **Zombie pilot sessions**: `persist()` wrote `is_running=1` while the process lived; a killed backend (reboot, watchdog `taskkill`) never reset the flag — 263 stale rows accumulated since 2026-10-20. `OvernightPilotManager.restore()` now reconciles `UPDATE overnight_pilot_runs SET is_running=0` on every backend startup (safe: nothing can be running at startup); regression asserts the UPDATE is issued (`test_restore_rehydrates_snapshot_as_stale_and_keeps_session_id`).
  - **Docker port hijack**: Docker Desktop autostart revived the old `signalscript_backend`/`signalscript_frontend` containers (stale image, no `/pairs/*` routes) which grabbed ports 8000/7100; the watchdog's health-check passed against the stale container and it never started the real backend (404 storm in the log). Fix: `/api/health` now carries a build marker (`BACKEND_BUILD_TAG`); watchdog validates it, detects Docker-family port owners (`com.docker.backend.exe`, `wslrelay.exe`, …) and frees the port via `docker stop` instead of `taskkill`; containers' restart policy set to `no`.
  - **No autostart after reboot**: watchdog gained `--install-autostart`/`--uninstall-autostart` writing a hidden VBS launcher into shell:startup (`SignalScriptDemoWatchdog.vbs`); autostart installed on this machine. Verified end-to-end: watchdog → backend up → 12 pairs resumed on shared account, zombies 263→12 (live sessions only), equity carried at $1000 via `data/demo_wallet.json`.


- **2026-10-29 [Kimi] Task PAIR-LAB-01: Self-service pair screening → paper trading flow**:
  - New read-only lab endpoint `POST /api/overnight-pilot/pairs/screen`: backtest+forecast of one symbol across the whole strategy catalog (per-combo isolated probes, concurrency 4, per-symbol in-flight guard); returns ranked rows with metrics, forecast regime, verdict and an exact reusable config (`ai_control`/`auto_strategy_switch` on).
  - `TradeHistoryWidget`: «Скрининг» button in the add-pair panel renders a per-strategy results table; «Торговать» on a row runs the exact `prepare → start-demo` chain onto the shared paper wallet; if the pair already trades, the row strategy is submitted as a challenger instead (auto-switch applies it when flat). New `PairChallengerQuickTest` in every pair row tests an alternative strategy without stopping the runner. All new UI uses semantic tokens (design-lint ratchet clean).
  - Tests: `backend/tests/test_pair_screen.py` (5 tests: catalog coverage, PnL ordering, no mutation of active sessions, validation, concurrent-run guard).
  - `scripts/check.ps1` exit 0 in `logs/quality-gate-pairlab.log`: host pytest 640 passed, 37 skipped; frontend tests/build, design lint, docs, critical smoke, blocking Playwright and live WebSocket passed. Docker/Linux async coverage unavailable locally.

- **2026-10-29 [Kimi] Task DEV-MERGE-01: Integrate marathon + challenger lines into `dev`**:
  - Committed Codex's pending challenger increment on `dev` (83ac085): catalog-driven alternative evaluation via backtest+forecast every 15 min per active pair, deduplicated by config fingerprint; guarded auto-switch only for flat pairs with fresh forecast and explicit `auto_strategy_switch`; UI shows challenger status and AUTO STRATEGY toggle.
  - Committed Cline's uncommitted marathon work on `feature/diagnostic-paper-run` (1e20107): demo observation keeps historical `SKIP` candidates with real TRAIN/OOS profiles while preserving data/regime/sizing checks; per-pair entry pause; `reconcile_paper_stop` tool.
  - Merged both lines into `dev` (single conflict in `pair_selector.py` resolved as `ai_control=not include_skip_for_demo`, `auto_strategy_switch=True` per merged test contract). Added `playwright`/`pytest-playwright` to `requirements.txt` so a fresh venv passes the blocking UI smoke.
  - Environment note: removing the Codex integration worktree followed its junctions and wiped `.venv`, `frontend/node_modules` and the `data/recorded` lake in the main checkout; all were rebuilt (`venv`+`requirements.txt`, `npm ci`, recorder re-created the lake on backend start). `data/signals.db` and backups were untouched.
  - `scripts/check.ps1` exit **0** in `logs/quality-gate-merge2.log`: host pytest 635 passed, 37 skipped; frontend tests/build, design lint, docs, critical smoke, blocking Playwright and live WebSocket passed. Docker/Linux async coverage unavailable locally.

- **2026-10-29 [Codex] Task MARATHON-03: Demo observation across 15 pairs**:
  - Kept historical `SKIP` profiles eligible for demo observation while preserving current data, toxic-regime, strategy-signal, and risk checks. Added exact per-pair preflight/start to the existing widget, a shared account, and safe per-pair entry pause. Reconciled one orphaned BNB paper position against observed closed 1m market data after a database backup.
  - Runtime: 15/15 paper runners active and data-connected, each with at least one evaluation and a persisted profile fingerprint; 0 new fills so far. Backend/frontend identities and SQLite integrity verified. Current account `overnight_shared_1793263962` remains running.
  - `scripts/check.ps1` exit **0** in `logs/quality-gate-20261029-demo-pairs-4.log`: host pytest 625 passed, 37 skipped; frontend tests/build, design lint, docs, critical smoke, Playwright, and live WebSocket passed. Docker unavailable; Linux async coverage not run.

- **2026-10-28 [Codex] Task PAPER-AUTOPILOT-RECOVERY**:
  - Fixed the AI paper-autopilot chain so auto-selection executes preflight before start, excludes only BLOCK verdicts, rechecks the exact allowed set, and never performs a real order.
  - Persisted paper snapshots now report a truthful recovery-required state after a backend restart instead of presenting stale candidates as a live run. The trade widget renders this state explicitly; active paper positions continue through the existing chart overlay contract.
  - `scripts/check.ps1`: ALL QUALITY CHECKS PASSED. Host pytest 646 passed, 2 skipped; frontend tests/build, design lint, docs, critical smoke, blocking Playwright and live WebSocket passed. Docker/Linux async coverage remained unavailable locally.

- **2026-10-28 [Codex] Task RUNNER-COROUTINE-CLEANUP**:
  - Removed unawaited-coroutine warnings from synchronous paper-fill callbacks. Best-effort SQLite persistence now closes its coroutine when no event loop is present, while async runner paths still schedule it on the active loop.
  - Added a regression that verifies close-event journaling still occurs and no leaked coroutine warning is emitted.
  - `scripts/check.ps1` exit **0**: 609 host pytest passed, 31 skipped, with no pytest warning summary; frontend, lint, docs, critical smoke, blocking Playwright, and live WebSocket passed. Docker/Linux async tests remained unavailable.

- **2026-10-30 [Kimi] Task RELOAD-SAFE DEMO + WATCHDOG**:
  - Root cause of «после обновления страницы тест пропал»: page reload was never the data loss — the demo lives in the backend. Real risks were backend process death (recurring WinError 64 accept-loop deaths of the port-8000 listener, ~every 1-3h on this machine) and backend restarts wiping in-memory sessions; UI failures rendered as silent zeros (banner fix earlier).
  - Added `scripts/demo_watchdog.py` (single-instance, `--stop`, pid files): health-checks `/api/health` every 60s with a two-strike guard (one slow status under load must not kill a healthy server); on real death kills the zombie process tree via tracked PID + port owner, backs up SQLite, restarts `backend/main.py`, then resumes the saved pair set from `data/screen_and_trade_result.json` — topping up missing pairs even while the pilot is running (AVAX re-added this way). Carries wallet equity through restarts via `data/demo_wallet.json`.
  - Backend: fresh shared paper wallets now seed `initial_capital` from config (`start_pair` and `start`) instead of a hardcoded $1,000, so resumes continue the saved equity; test added (`test_shared_paper_wallet_seeds_from_config_initial_capital`).
  - Debug archaeology: Python `subprocess` needs single-slash taskkill/tasklist args (`/PID`, `/FI`) — Git Bash's `//x`→`/x` conversion had masked this; watchdog now uses correct args (fixes phantom `--stop` and duplicate watchdog instances).

- **2026-10-30 [Kimi] Task NIGHT POST-MORTEM + DEMO RESUME**:
  - Night run forensics: trading worked (7 closed trades, engine evaluated ~8,4k signals overnight); the morning UI outage had two separate causes — (1) user browser ran a stale pre-merge frontend bundle, (2) at 10:58 the backend's HTTP accept loop died with WinError 64 (network name no longer available; VPN/adapter event) while the python process kept running, so the API went dark until restart.
  - Added `scripts/screen_and_trade.py resume`: restarts the saved 12-pair set from `data/screen_and_trade_result.json` without re-screening (prepare + start-demo per pair). After the backend restart 8 pairs resumed on a new shared account `overnight_shared_1695eb25e210`; 4 pairs (LINK/SUI/UNI/AVAX) were refused by the live TOXIC_VOLATILITY hard check during the market dump — protective behavior, re-add them later with `resume`.
  - Known limitations recorded: backend listener does not survive WinError 64 (needs watchdog/restart); shared paper wallet is recreated on cold start (account continuity not persisted).

- **2026-10-30 [Kimi] Task OVERNIGHT DEMO VERIFIED + API FAILURE BANNER**:
  - Overnight demo run confirmed working: 7 closed trades across 5 pairs (ETH, BNB, ZEC×2, SUI, AVAX×2) on `overnight_shared_283953d23d55`, equity $994.88, full trade records (entry/exit/target/stop, MFE/MAE, fees) written to SQLite and served by `/api/paper-trading/closed-trades` (93 total with history).
  - Root cause of the "no trades in UI" report: the user's browser rendered an old frontend bundle; additionally `TradeHistoryWidget` never rendered its `error` state, so any API failure showed silent zeros. Added a visible API-failure banner (`api-error-banner`, semantic `destructive` tokens) and pilot-status error tracking.
  - `scripts/screen_and_trade.py` monitor now prints raw position JSON on new opens (runner position keys vary) instead of guessed fields.

- **2026-10-29 [Kimi] Task SCREEN-AND-TRADE DEMO RELAUNCH**:
  - Added `scripts/screen_and_trade.py`: one-command flow for Di — stop pilot → screen candidate pairs across the full 8-strategy × 5m/15m catalog (read-only, probe managers, ai_control configs) → pick best (ok, ≥5 trades, max net PnL) → prepare + start demo sessions on a shared $1,000 account (`duration_hours=168`) → write `data/screen_and_trade_result.json`. Subcommand `monitor [--once|--interval|--rounds]` snapshots status and prints new openings (with SL/TP) and the closed-trade counter to a log file.
  - Relaunched the demo with unique per-pair strategies: 12 running pairs on `overnight_shared_283953d23d55` (BTC/ema_trend 5m, ETH/cvd_absorption 15m, SOL/ema_trend 15m, XRP/ema_trend 15m, BNB/ema_trend_window 5m, DOGE/ema_trend 15m, LINK/ema_trend 15m, ZEC/ema_trend_window 15m, SUI/ema_trend 15m, UNI/ema_trend 15m, AVAX/ema_trend 15m, ADA/ema_trend 15m); NEAR and ENA rejected at start (live TOXIC_VOLATILITY). Runners warm up from 2-day kline history, so entries depend on live signal setups (EMA_CROSS / CROSS_WINDOW / CVD_ABSORPTION_STRUCTURE), not on a timer. Night monitor runs detached to `data/pair_monitor_night.log`.

- **2026-10-28 [Codex] Task QUALITY-GATE-SMOKE-CONTRACT**:
  - Replaced the Chart toolbar's newly added raw “Сейчас” control with the canonical compact `Button`, eliminating the only design-lint regression.
  - Corrected the critical HTTP smoke contract: an empty L2 book from an unreachable public exchange is now accepted as an explicit disconnected response shape, while malformed payloads still fail. Added two regressions for that distinction.
  - `scripts/check.ps1` exit **0**: 608 host pytest passed, 31 skipped; frontend recovery, 89 frontend tests/build, design lint, docs, critical smoke, blocking Playwright, and live WebSocket passed. Docker/Linux async tests remained unavailable.

- **2026-10-27 [Codex] Task CODEX-HANDOFF**:
  - Refreshed the context documents, recorded real runtime model routing, upgraded the deterministic CodeMap generator with caller/callee hints, and confirmed the documentation gate locally.
  - Fixed the quality gate's Node worker restriction by running its two frontend tests sequentially; the complete gate now passes (585 passed, 31 skipped; frontend 7/7 and pilot 85/85; build, lint, docs, critical smoke, Playwright, live WebSocket).
- **2026-10-27 [Antigravity] Task DESIGN-STAGE-D**:
  - Implemented Stage D0-D4: Linux container pytest gate [1b], canvas resize guard in `TradesWidget`, Binance miniTicker failover, per-pair controls (`overnight_pilot.py` + `PairControlRowActions.jsx`), Dockview 28px tabs and theme tokens, codemod migration (-998 raw Tailwind violations eliminated, ratchet locked at 1031), standard Dialog/Tabs/NumberInput migration.
  - Quality gate `scripts/check.ps1`: ALL QUALITY CHECKS PASSED (616 pytest host, 616 pytest Linux Docker, Vite build, UI smoke, live WS).
- **2026-10-27 [Antigravity] Task 008 (Expectancy & Quantum Risk Engine)**:
  - Transitioned from raw Win Rate to Net Expectancy ($E_R > 0$).
  - Implemented `risk_engine.py`, `regime_classifier.py`, `trade_postmortem_service.py`, 1-click auto-select `/api/overnight-pilot/auto-select`.
  - Migrated `data/signals.db` schema non-destructively. Docker stack verified.
- **2026-10-26 [Antigravity] Task 007 (Chart Engine & Footprint)**:
  - Custom canvas rendering for footprint clusters on KLineCharts, Dockview multi-pane mosaic.
- **2026-10-24 [Kimi] Task 003 (Phase 1 Production Robust Closeout)**:
  - Confirmed `production_robust` preset, resolved Night Pilot CLI table formatting for empty fields.
