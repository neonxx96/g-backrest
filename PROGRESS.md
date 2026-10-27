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
| **Overnight Paper Marathon** | `RUNNING` | 7 validated pairs in Docker (ZEC SELECT, BNB/ENA/WLD/UNI/TIA/TRX EXPLORE) on $1,000. |
| **Design System & Tokens** | `READY` | shadcn/ui primitives, 28px Dockview tabs, 4 theme presets, lint ratchet (1031 baseline). |

---

## 2. Completed Milestones

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
