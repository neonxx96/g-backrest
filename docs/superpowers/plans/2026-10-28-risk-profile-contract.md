# Risk Profile Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete and prove the versioned paper-risk profile so every new pilot admission uses explicit percentage-point inputs and one shared heat policy.

**Architecture:** `SharedRiskProfile` is the single API/config boundary; it converts percent points to fractions and provides an immutable snapshot. `OvernightPilotConfig`, the shared account gate, and paper runner use that snapshot instead of competing limits.

**Tech Stack:** Python 3.11, FastAPI/Pydantic, pytest.

**Spec:** `docs/ALGO_PAPER_GOAL.md` and the user-approved Stage A contract supplied on 2026-10-28.

## Global Constraints

- Advisory/paper execution only; no live exchange order path.
- API/UI values are percentage points; internal risk-engine values are fractions.
- Default portfolio and directional heat are 1.25% and 0.75%; directional must not exceed portfolio.
- Do not change an active account, run, or persisted state.

## Review Focus

- A profile specifying fractional API units must be rejected rather than silently reinterpreted.
- Pending entries must reserve both portfolio and directional heat.
- Different pair risk budgets may coexist only with identical shared-account limits.
- A snapshot must preserve both public and internal units so a resumed run cannot infer units.
- Invalid directional/portfolio order must fail before runner startup.

---

### Task 1: Verify and complete Stage A risk-profile integration

**Files:**
- Modify: `backend/app/services/risk_profile.py`
- Modify: `backend/app/services/overnight_pilot.py`
- Modify: `backend/app/services/live_paper_runner.py`
- Test: `backend/tests/test_risk_profile_contract.py`
- Test: `backend/tests/test_m4_runner_gates.py`

**Interfaces:**
- Consumes: `SharedRiskProfile.from_api_config(config: dict) -> SharedRiskProfile`.
- Produces: `SharedRiskProfile.snapshot() -> dict` in each new pilot configuration and consistent arguments to `risk_engine.can_open_position`.

- [ ] **Step 1: Run contract tests and identify any incomplete propagation.**

Run: `python -m pytest backend/tests/test_risk_profile_contract.py backend/tests/test_m4_runner_gates.py -q`
Expected: all tests pass.

- [ ] **Step 2: If propagation is incomplete, add a failing test for the precise contract boundary.**

The test must assert only the missing percent-to-fraction conversion, common heat limit, or invalid-profile rejection.

- [ ] **Step 3: Implement the smallest boundary fix.**

Keep conversion exclusively in `SharedRiskProfile`; do not alter active run state or relax admission gates.

- [ ] **Step 4: Run focused risk, runner, and shared-account tests.**

Run: `python -m pytest backend/tests/test_risk_profile_contract.py backend/tests/test_execution_risk_hardening.py backend/tests/test_m4_runner_gates.py backend/tests/test_shared_paper_account.py -q`
Expected: all tests pass.

- [ ] **Step 5: Run the backend suite and document evidence.**

Run: `python -m pytest backend/tests -q`
Expected: all tests pass, with pre-existing warnings reported separately.
