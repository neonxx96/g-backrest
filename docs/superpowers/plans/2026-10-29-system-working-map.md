# System Working Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a maintained subsystem working map and remove verified diagnostic runtime clutter.

**Architecture:** `ARCHITECTURE.md` remains stable design, `CODEMAP.md` remains generated source inventory, and `SYSTEM_WORKING_MAP.md` records responsibilities, flows and focused verification. The existing documentation gate ensures the map exists.

**Tech Stack:** Markdown, Python documentation gate, FastAPI, React 19, SQLite.

**Spec:** `docs/superpowers/specs/2026-10-29-system-working-map-design.md`

## Global Constraints

- Paper-only: never add live exchange order submission.
- Keep backend `8000`, frontend `7100`, and `data/signals.db` unchanged.
- Do not touch the active paper runners or uncommitted work in the original checkout.

## Review Focus

- A new route or configuration field must identify its backend owner, frontend consumer and focused test.
- Historical selection labels must not be represented as permission to bypass data/risk safety checks.
- Runtime status dumps must not be recommitted.

---

### Task 1: Publish and enforce the working map

**Files:**
- Create: `docs/SYSTEM_WORKING_MAP.md`
- Modify: `AGENTS.md`, `scripts/check_docs.py`, `.gitignore`
- Delete: `status.json`, `status2.json`, `scripts/run_diag_final.py`

**Interfaces:**
- Consumes: existing routes, services, React panels and focused tests.
- Produces: a human-maintained change map that the existing documentation gate requires.

- [x] Add `docs/SYSTEM_WORKING_MAP.md` to `REQUIRED_DOCS` and run the gate red.
- [x] Create the map with ownership tables, verified flows, safety distinction and change matrix.
- [x] Update `AGENTS.md` with the maintenance trigger and ignore root runtime status snapshots.
- [x] Delete the two verified runtime snapshot files and the empty diagnostic script.
- [x] Run `python scripts/check_docs.py` and the focused documentation diff review.
- [ ] Commit the isolated increment.
