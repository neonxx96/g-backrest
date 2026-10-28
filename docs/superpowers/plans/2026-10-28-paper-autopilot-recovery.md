# Paper Autopilot Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing multi-pair paper autopilot truthful after a restart and startable through a guarded AI-selection/preflight flow.

**Architecture:** Extend `OvernightPilotManager` rather than creating another runner. The backend exposes an explicit recovery state and an autopilot operation which filters BLOCK verdicts after preflight; `TradeHistoryWidget` renders that state and continues using the established pilot-status/chart-overlay contracts.

**Tech Stack:** Python/FastAPI/Pydantic/pytest; React/Vite/node:test.

**Spec:** `docs/superpowers/specs/2026-10-28-paper-autopilot-recovery-design.md`

## Global Constraints

- Paper only; no exchange order submission.
- Preserve the shared virtual account, risk limits, wallet/history/layout, and durable records.
- A BLOCK preflight verdict is not auto-started.
- Do not automatically resume a persisted run after a backend restart.

## Review Focus

- Restarted/persisted candidates must not claim `RUNNING`; covered by Task 1 status test.
- Mixed allowed/BLOCK selection must start only the allowed exact preflight set; covered by Task 2.
- All-BLOCK selection must start nothing and return an explanation; covered by Task 2.
- Open positions continue to reach the existing chart normalizer unchanged; covered by Task 3 node test.
- Failed selection/preflight presents an error rather than a success state; covered by Task 3 UI model test.

---

### Task 1: Recovery-state contract

**Files:**
- Modify: `backend/app/services/overnight_pilot.py`
- Test: `backend/tests/test_overnight_pilot.py`

**Interfaces:**
- Produces `status()["recovery"]` with `required`, `reason`, and `session_count`.

- [ ] Write a failing test for persisted sessions without running runners returning `recovery.required=True`.
- [ ] Run the focused pytest case and verify it fails because no recovery contract exists.
- [ ] Add the minimal derived recovery contract to `OvernightPilotManager.status()`.
- [ ] Run the focused pytest case and verify it passes.

### Task 2: Guarded AI autopilot start

**Files:**
- Modify: `backend/app/services/overnight_pilot.py`
- Modify: `backend/app/routers/overnight_pilot.py`
- Test: `backend/tests/test_overnight_pilot.py`

**Interfaces:**
- Produces a paper-only response `{started, active_symbols, excluded_symbols, preflight_id}`.

- [ ] Write failing tests for mixed allowed/BLOCK and all-BLOCK selections.
- [ ] Run those tests and verify they fail because the endpoint/manager operation does not exist.
- [ ] Implement the operation using existing selection, preflight matching, and `start`; never change a BLOCK verdict.
- [ ] Run the focused backend tests and verify they pass.

### Task 3: Truthful UI recovery and position visibility

**Files:**
- Modify: `frontend/src/components/docking/TradeHistoryWidget.jsx`
- Modify: `frontend/src/components/docking/marathonFeed.js`
- Test: `frontend/src/components/docking/marathonFeed.test.js`
- Test: `frontend/src/features/pilot/pilot.test.js`

**Interfaces:**
- Consumes `pilotStatus.recovery` and existing `sessions[*].paper.open_positions`.

- [ ] Write failing tests for recovery copy and chart-ready position collection.
- [ ] Run focused node tests and verify the missing behavior fails.
- [ ] Render recovery state and preserve chart position flow without synthesizing positions.
- [ ] Run frontend focused tests and Vite build.

### Task 4: Verification and documentation

**Files:**
- Modify: `HANDOFF.md`
- Modify: `PROGRESS.md`
- Regenerate: `docs/CODEMAP.md`

- [ ] Run focused Python and frontend regressions.
- [ ] Run one full `scripts/check.ps1` gate with complete log and recorded exit code.
- [ ] Document verified behavior and any Docker/runtime limitation.
