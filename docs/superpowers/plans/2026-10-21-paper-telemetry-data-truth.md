# Paper Telemetry and Data-Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make each paper/backtest/forecast decision auditable against one immutable run/configuration identity, with correctly defined evaluation and feed-health counters, without changing trading strategy math.

**Architecture:** Extend the existing append-only `deep_intent_log.jsonl` contract and `DeepIntentLogger`; pass existing pilot `run_id` and config fingerprint into each paper runner; expose typed events and health counters via read-only status/events APIs. Keep market execution in `LivePaperRunner` and persistence in `OvernightPilotManager`; do not add a database or a second event store.

**Tech Stack:** Python 3.11, FastAPI, Pydantic v2, existing JSONL logger, pytest, existing React/Tailwind API consumers (no UI changes in this slice).

**Spec:** `docs/superpowers/specs/2026-10-21-paper-telemetry-data-truth-design.md`

## Global Constraints

- Never generate synthetic market prices or submit real exchange orders.
- Preserve existing strategy, risk, and execution math; only gate new entries on stale/invalid data.
- Preserve append-only history; legacy lines are `legacy`/`unknown` and never attributed to a current run.
- The confirmed sandbox accounting invariant is `net_pnl = gross_pnl - total_fees`; do not deduct slippage a second time.
- `GET /api/overnight-pilot/status` remains read-only; snapshot writes stay in explicit lifecycle/background persistence.
- Backend port remains 8000, frontend 5173, and SQLite remains `data/signals.db`.
- Preserve unrelated working-tree and Antigravity changes; stage only files owned by each task.

## Review Focus

- Partial current OHLCV candle is evaluated more than once or counted as a closed candle — pin to candle-close semantics and a same-candle repeated-tick test (Task 3).
- Transport says connected while OHLCV is stale/invalid — pin separate freshness state and block only new entries (Task 4).
- Legacy/malformed JSONL or disk write failure corrupts events or trading state — pin line-isolated read and explicit degraded logger state (Task 1).
- A run reuses data from another symbol/config/preflight — pin unique run ID, canonical fingerprint, and exact event filtering (Tasks 2 and 5).
- Open position is closed or marked PnL using stale/fabricated price — pin that no exit occurs until the next fresh valid price (Task 4).

---

### Task 1: Versioned, resilient JSONL event contract

**Files:**
- Modify: `backend/app/services/deep_intent_logger.py`
- Test: `backend/tests/test_deep_intent_logging.py`

**Interfaces:**
- Produce `DeepIntentLogger.record_event(*, event_type: str, source: str, symbol: str, reason_code: str, reason: str, run_id: Optional[str], session_id: Optional[str], config_fingerprint: Optional[str], strategy: Optional[str], timeframe: Optional[str], checks: Optional[list], observed: Optional[dict], trade_id: Optional[str], payload: Optional[dict]) -> dict`.
- Keep a compatibility adapter for the current `record(intent, symbol, session_id, reason, context)` callers until Task 2 migrates them; resulting rows are explicitly marked legacy/unknown when identity is unavailable.
- Produce filtered, bounded `read_recent(limit, *, run_id=None, symbol=None, source=None, event_type=None) -> list[dict]`; malformed lines are skipped without hiding valid neighboring events.

- [ ] **Step 1: Write failing logger contract tests** for schema version/event ID/UTC timestamp, append-only behavior, malformed-line tolerance, legacy-row labeling, filters, and injected `OSError` on append.
- [ ] **Step 2: Run `pytest backend/tests/test_deep_intent_logging.py -q`** and verify the new assertions fail for missing fields/behavior.
- [ ] **Step 3: Implement `record_event` and the compatibility adapter** in `deep_intent_logger.py`. Generate unique event IDs; never rewrite existing JSONL; raise a specific write error rather than swallowing disk failures.
- [ ] **Step 4: Implement bounded filtered line reads** with per-line JSON decoding and explicit legacy normalization. Do not load or rewrite the entire file to append.
- [ ] **Step 5: Re-run `pytest backend/tests/test_deep_intent_logging.py -q`**; all logger tests pass and old call sites remain compatible.
- [ ] **Step 6: Commit only logger and its tests** as `feat: version paper intent telemetry events` after `scripts/check.ps1` passes.

### Task 2: Run identity and lifecycle event attribution

**Files:**
- Modify: `backend/app/services/live_paper_runner.py`
- Modify: `backend/app/services/overnight_pilot.py`
- Test: `backend/tests/test_deep_intent_logging.py`
- Test: `backend/tests/test_overnight_pilot.py`

**Interfaces:**
- Extend `LivePaperRunner.start(config: Dict[str, Any], *, run_id: Optional[str] = None, config_fingerprint: Optional[str] = None) -> Dict[str, Any]` without breaking standalone callers.
- Add `run_id`, `config_fingerprint`, and `telemetry_status` to runner status. `OvernightPilotManager.start()` passes the exact identity already held by its validated `PilotSession`.
- Every event emitted by runner or manager uses the Task 1 `record_event` contract and carries source, run identity, symbol, strategy, timeframe, and stable reason code.

- [ ] **Step 1: Add failing tests** asserting preflight IDs/fingerprints reach runner status and `RUN_STARTED`, `DECISION_SKIPPED`, `SIGNAL_ACCEPTED`, `POSITION_OPENED`, `POSITION_UPDATED`, `POSITION_CLOSED`, and `RUN_STOPPED` events for a known run.
- [ ] **Step 2: Run the targeted logger and pilot tests** and confirm identity/event assertions fail before implementation.
- [ ] **Step 3: Pass identity through pilot start** and centralize runner event context so no paper event silently omits run/config identity.
- [ ] **Step 4: Emit lifecycle/decision events at existing state transitions**; include the original `trade_id` consistently across entry, management, and close; include measured checks/observed values on a rejection.
- [ ] **Step 5: Test two identical-config preflights** produce different run IDs but the same fingerprint, and a changed parameter produces a different fingerprint and invalidates the prior preflight.
- [ ] **Step 6: Run targeted tests and commit only owned files** as `feat: correlate paper decisions with run identity` after the full quality gate.

### Task 3: Candle-based evaluation and rejection counters

**Files:**
- Modify: `backend/app/services/live_paper_runner.py`
- Test: `backend/tests/test_deep_intent_logging.py`
- Test: `backend/tests/test_live_paper_and_openrouter.py`

**Interfaces:**
- Expose `evaluations`, `blocked_evaluations`, `filter_rejection_total`, and `rejection_counts` separately in `LivePaperRunner.get_status()`.
- Use an evaluation identity `(run_id, symbol, timeframe, candle_close_time)`; one closed-candle evaluation increments `evaluations` exactly once. Multiple rejected filters increment their individual reason counters once for that evaluation; invalid-data evaluations use data-quality reason codes, not strategy rejection counts.

- [ ] **Step 1: Add failing counter tests** for repeated ticks on one candle, multiple simultaneous failed filters, a later candle, and invalid indicator data.
- [ ] **Step 2: Inspect/confirm timestamp semantics in `fetch_history`** and add a focused test proving the currently forming candle is not treated as finalized; use the last fully closed candle for signal evaluation while live price remains available for position management.
- [ ] **Step 3: Run the focused tests** and confirm duplicate/partial candle cases fail.
- [ ] **Step 4: Replace signature-based counting in `_record_no_entry`** with the closed-candle evaluation key; publish `DECISION_SKIPPED` once per evaluation while retaining separately rate-limited human logs.
- [ ] **Step 5: Verify exact counts**: repeat tick adds zero, next closed candle adds one evaluation, two rejected checks add two filter rejections but one blocked evaluation.
- [ ] **Step 6: Run targeted tests and commit only owned files** as `fix: count paper rejections per closed candle` after the full quality gate.

### Task 4: Feed freshness, error counters, and safe stale behavior

**Files:**
- Modify: `backend/app/services/live_paper_runner.py`
- Test: `backend/tests/test_live_paper_and_openrouter.py`
- Test: `backend/tests/test_market_data_truth_contract.py`

**Interfaces:**
- Add status fields `data_error_count`, `consecutive_data_errors`, `last_data_error`, `last_data_error_at`, `last_successful_data_at`, `reconnect_count`, transport `data_status`, indicator `indicator_data_status`/freshness, and `telemetry_status`.
- Count transport exceptions, invalid/non-finite/non-positive prices, OHLCV validation failures, and history-fetch failures exactly once at their respective boundary. A successful fresh and validated update resets only the consecutive counter.

- [ ] **Step 1: Add failing tests** for an exception, invalid price, OHLCV integrity failure, valid recovery, connected transport with stale indicators, and stale data while a position is open.
- [ ] **Step 2: Run the feed-truth tests** and verify the status/counter and stale-entry assertions fail.
- [ ] **Step 3: Centralize feed failure/recovery recording** so each failure has timestamp/code, increments total and consecutive once, emits `FEED_STATUS_CHANGED` only on a state transition, and never reports `ready` from transport state alone.
- [ ] **Step 4: Gate only new entries on fresh valid data**. Do not call position exit/mark-to-market code using stale or fabricated prices; retain the position and process protection on the next fresh valid market update.
- [ ] **Step 5: Add `telemetry_status=degraded` on logger write failure** without propagating it into strategy state, order size, or PnL; prove the session loop remains observable.
- [ ] **Step 6: Verify failure/recovery/stale-position tests and commit only owned files** as `fix: report feed health and block stale entries` after the full quality gate.

### Task 5: Read-only event query and pilot status contract

**Files:**
- Modify: `backend/app/services/deep_intent_logger.py`
- Modify: `backend/app/services/overnight_pilot.py`
- Modify: `backend/app/routers/overnight_pilot.py`
- Test: `backend/tests/test_overnight_pilot.py`
- Test: `backend/tests/test_overnight_pilot_ui_contract.py`

**Interfaces:**
- Add `GET /api/overnight-pilot/events` with optional `run_id`, `symbol`, `source`, `event_type`, and bounded `limit` query parameters. Return `{events, count, filters}`; never infer current run identity for legacy records.
- Add per-session and aggregate telemetry totals, freshness and `telemetry_status` from runner snapshots; keep Backtest, Forecast, Paper, and System source totals separate.
- Preserve `GET /api/overnight-pilot/status` as a pure read. Existing controlled `persist()`/background snapshot writes remain the only persistence paths.

- [ ] **Step 1: Add failing route/status contract tests** for filtering, bounded limit, legacy exclusion from run-scoped queries, separate source aggregates, and GET status causing no persistence call.
- [ ] **Step 2: Run the focused route/status tests** and verify they fail before implementation.
- [ ] **Step 3: Implement the filtered events route** using the Task 1 reader; validate `limit` (1–500), normalize symbol, and return newest matching events without mutating the log.
- [ ] **Step 4: Publish exact runner health/counter fields** in summary and aggregate without converting missing values to zero or merging historical backtest and paper trades.
- [ ] **Step 5: Add regression assertions** that repeated status GETs do not invoke `persist()` and restored snapshots are `stale`, not `running`.
- [ ] **Step 6: Run targeted API tests and commit only owned files** as `feat: expose run-scoped paper telemetry` after the full quality gate.

### Task 6: End-to-end telemetry/accounting verification and handoff

**Files:**
- Modify: only the smallest relevant test fixtures found during Tasks 1–5
- Test: `backend/tests/test_deep_intent_logging.py`
- Test: `backend/tests/test_execution_providers.py`
- Test: `backend/tests/test_overnight_pilot.py`
- Update: `AI_HANDOFF.md` with verified Slice 1 implementation and limitations

- [ ] **Step 1: Add a deterministic integration test** that starts a paper runner with a test logger, records a rejection and a complete paper trade lifecycle, and verifies every event shares the run identity and links by `trade_id`.
- [ ] **Step 2: Assert the accounting invariant** `net_pnl == gross_pnl - total_fees` on the exact closed event and underlying `PaperSandboxProvider` trade; verify slippage is not subtracted twice.
- [ ] **Step 3: Assert a feed failure/recovery sequence** increments the correct error counters, blocks new entries while stale, and resumes only on real valid data.
- [ ] **Step 4: Run targeted tests, then the full gate** `powershell -ExecutionPolicy Bypass -File scripts/check.ps1`; require the final `ALL QUALITY CHECKS PASSED. READY TO COMMIT.` line.
- [ ] **Step 5: Update `AI_HANDOFF.md`** with actual verification counts, endpoints/event schema, unresolved limitations, and the fact that no runtime restart/positive-performance claim is included.
- [ ] **Step 6: Commit the final integration/handoff changes** as `test: verify run-scoped paper telemetry lifecycle` after rerunning the full quality gate; report full output summary and list untested manual/live scenarios.

## Execution Safety

The current workspace has unrelated dirty and untracked files, including changes in several target modules. Before Task 1, inspect the relevant `git diff` and tests to establish ownership; do not overwrite or stage pre-existing edits. If a requested hunk overlaps another agent's uncommitted work and cannot be safely composed, stop and ask the user rather than resetting, stashing, or committing those files. Do not restart/stop the active Night Pilot; tests use injected providers and temporary JSONL paths.
