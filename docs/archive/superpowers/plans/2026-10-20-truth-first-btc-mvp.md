# Truth-first BTCUSDT MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the BTCUSDT History → Walk-Forward/Regime → Paper workflow display only sourced data, explain every trade, and return a deterministic Paper-readiness verdict.

**Architecture:** Preserve the execution simulator and its numerical behavior. Add truth metadata and entry/exit explanations at the router/contract boundary, then consume that contract in the existing React panels and KLineCharts overlays. Missing L2 history is modeled explicitly instead of estimated or hidden.

**Tech Stack:** Python 3.11, FastAPI/Pydantic, React 19, Zustand, KLineCharts v9, pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-19-truth-first-btc-mvp-design.md`

## Global Constraints

- Do not edit `backend/app/services/execution_simulator.py`.
- No real orders, keys, random market data, or invented UI metrics.
- Backend port 8000, frontend port 5173, SQLite path `data/signals.db`.
- `UnifiedTradeSignal` is mandatory for every Paper entry.

## Review Focus

- A manual Paper signal with an invalid stop/target must fail through the contract validator.
- A historical trade must never expose exit text as its entry explanation.
- Historical L2 absence must be visible in API, panel, and verdict.
- A negative Net PnL or toxic regime must always block Live Paper.
- Signal fallback IDs must be stable for identical payloads.

### Task 1: Truthful backend response and Paper boundary

**Files:**
- Modify: `backend/app/engine/trade_contract.py`
- Modify: `backend/app/routers/paper_trading_router.py`
- Modify: `backend/app/routers/backtest.py`
- Test: `backend/tests/test_trade_contract.py`
- Test: `backend/tests/test_paper_trading_router.py`
- Test: `backend/tests/test_ui_validation_contract.py`

- [ ] Write failing tests for list-based manual reasons, separated `entry_reason` / `exit_reason`, and an explicit historical-L2-unavailable response.
- [ ] Run the selected pytest tests and confirm they fail for missing behavior.
- [ ] Convert `OrderSignalRequest` to a `UnifiedTradeSignal` and call `execute_unified_signal`.
- [ ] Add deterministic entry-reason projection and `data_availability` to backtest response without changing simulator calculations.
- [ ] Run selected tests and commit the backend contract change.

### Task 2: Deterministic verdict and honest panel data

**Files:**
- Create: `frontend/src/utils/researchVerdict.js`
- Modify: `frontend/src/components/BacktestPanel.jsx`
- Modify: `frontend/src/stores/marketDataStore.js`
- Test: `frontend/src/utils/researchVerdict.test.js`

- [ ] Write failing Node tests for ready/warn/block verdicts and deterministic IDs.
- [ ] Run the Node test and confirm it fails.
- [ ] Implement the pure verdict/ID helpers.
- [ ] Replace all context-card numeric fallbacks with `No data`; display L2-history status and verdict.
- [ ] Run Node tests and frontend build; commit UI truthfulness changes.

### Task 3: Chart layer status, trade inspection, and focus event

**Files:**
- Modify: `frontend/src/components/Chart.jsx`
- Modify: `frontend/src/components/BacktestPanel.jsx`
- Test: `scripts/smoke_ui_playwright.py`

- [ ] Add explicit layer availability labels for Heatmap, Liquidations, Forecast, Signals, and Regime.
- [ ] Extend the existing tooltip with entry/exit reasons, gross/net PnL, fee drag, MFE/MAE, and regime.
- [ ] Dispatch a selected-backtest-trade event from a table row and scroll/highlight the matching chart time.
- [ ] Extend Playwright smoke with data-testid assertions for the verdict, layer controls, and trade focus.
- [ ] Run targeted UI smoke, full quality gate, update documentation, and commit.

### Task 4: Localhost evidence run and handoff

**Files:**
- Modify: `DECISIONS.md`
- Modify: `HANDOFF.md`
- Create: `artifacts/truth-first-btc-mvp.png`

- [ ] Start/reuse localhost services and call History Backtest, adaptive regime, weights, and optimizer for BTCUSDT 5m/15m.
- [ ] Exercise the same backtest flow in Playwright, turn on all available layers, select a trade, capture a screenshot.
- [ ] Run `scripts/check.ps1`; record exact output and factual limitations in HANDOFF.
- [ ] Commit documentation and evidence references.
