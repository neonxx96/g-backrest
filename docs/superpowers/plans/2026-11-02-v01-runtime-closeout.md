# SignalScript v0.1 Runtime Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the embedded order-flow recorder gap-recovering and non-blocking, then produce measured evidence that the v0.1 paper-trading workflows remain healthy.

**Architecture:** Keep the existing embedded recorder and its in-memory footprint API. Change its trade source to Binance Futures aggregate trades, track per-symbol IDs, bridge every connection with REST before accepting live events, and serialize Parquet snapshots through one background thread job so pandas never blocks the asyncio loop.

**Tech Stack:** Python 3.11, asyncio, aiohttp, websockets, pandas/Parquet, FastAPI, pytest, PowerShell runtime probes.

**Spec:** `tasks/009-v01-runtime-closeout.md`

## Global Constraints

- Advisory and paper trading only; never submit a real exchange order.
- Backend stays on port `8000`, frontend on `7100`, SQLite at `data/signals.db`.
- Only one backend process may run.
- Preserve the running marathon; rely on the watchdog for a required controlled restart.
- Execute sequentially without overlapping agents or concurrent edits.

## Review Focus

- REST bridge pagination longer than 1,000 aggTrades must continue until the captured live boundary.
- Duplicate REST/live aggregate IDs must be ignored without losing later trades.
- A failed REST bridge must reconnect instead of silently starting a gapped live stream.
- Trades arriving during an in-flight flush must remain buffered for the next snapshot.
- Cancellation/shutdown must await any active flush and leave no orphan thread task.

---

### Task 1: Gap-free aggregate-trade ingestion

**Files:**
- Modify: `backend/app/services/recorder.py`
- Create: `backend/tests/test_recorder_runtime.py`

**Interfaces:**
- Produces: `record_agg_trade(..., agg_trade_id: int | None = None) -> bool`
- Produces: `_backfill_symbol(session, symbol, through_id) -> int`
- Produces: per-symbol last-seen ID state used by REST and WebSocket ingestion.

- [ ] Write tests proving ordered acceptance, duplicate rejection, multi-page REST recovery, and REST failure propagation.
- [ ] Run the focused tests and verify they fail for missing ID/backfill behavior.
- [ ] Subscribe to `@aggTrade`, capture the first live message as a boundary, REST-backfill from the last ID through that boundary, then ingest buffered live messages in ID order.
- [ ] Run the focused tests and the existing footprint tests.

### Task 2: Non-blocking serialized Parquet flush

**Files:**
- Modify: `backend/app/services/recorder.py`
- Modify: `backend/tests/test_recorder_runtime.py`

**Interfaces:**
- Produces: `_schedule_flush() -> asyncio.Task | None`
- Produces: `_await_flush() -> None`
- Keeps `flush_buffers()` as synchronous disk implementation operating on detached snapshots.

- [ ] Write tests proving flush work runs off the event-loop thread, only one flush runs at once, and newly arriving records survive an active flush.
- [ ] Run focused tests and verify the new assertions fail.
- [ ] Atomically detach buffers, serialize one `asyncio.to_thread` flush, and merge snapshots back on failure.
- [ ] Await the active flush during reconnect and shutdown; run focused and backend test suites.

### Task 3: Runtime verification and user-flow regression

**Files:**
- Create: `scripts/verify_v01_runtime.py`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SYSTEM_WORKING_MAP.md`
- Regenerate: `docs/CODEMAP.md`
- Modify: `PROGRESS.md`
- Modify: `HANDOFF.md`
- Modify: `tasks/009-v01-runtime-closeout.md`

**Interfaces:**
- Produces a JSON evidence report with health latency distribution, cluster continuity, and forming-candle growth.

- [ ] Add tests or self-checks for percentile and 5m continuity calculations before the runtime probe.
- [ ] Perform a controlled backend restart only after confirming watchdog state and one backend owner.
- [ ] Observe clusters for 30 minutes and health for 10 minutes under the marathon; save exact measurements.
- [ ] Run `scripts/check_night_widgets.py` and verify start/resume, reload persistence, emergency stop/reset affordances, and closed-trade/night-log reconciliation without fabricating fills.
- [ ] Update architecture, working map, CodeMap, progress, task status, and handoff with exact evidence and limitations.
- [ ] Run the full quality gate, commit, and push `dev` only if it is green.

## Self-review

- All three Kimi acceptance groups map to Tasks 1–3.
- No strategy, UI, port, database schema, or real-order behavior is changed.
- Gap recovery and event-loop relief are independently testable before runtime restart.
- Runtime claims require captured measurements; unavailable scenarios are reported as limitations, not inferred success.

