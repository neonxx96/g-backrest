# Git Workflow, Development Rules & Reporting Standard

This document details Git branching, commit conventions, process management, token economy, and reporting standards for SignalScript.

---

## 1. Git Workflow & Branching

- **Branch Naming Standard:**
  - Pattern: `agent/<tool>/<short-task-slug>` or `chore/<task-slug>`
  - Examples:
    - `agent/antigravity/ui-journal-filter`
    - `agent/cline/fix-tape-threshold-slider`
    - `chore/codex-handoff`
- **Frequent Atomic Commits:** Commit after each logical step with a clear, descriptive message in English or Russian.
- **Milestone Tagging:** Control milestones are tagged as `stable-YYYYMMDD` (e.g. `stable-20261018`).
- **Never Commit Without Gate:** Always execute `powershell -ExecutionPolicy Bypass -File scripts/check.ps1` before committing.

---

## 2. Process & Port Hygiene

- **Strictly Single Backend Process:**
  - Running multiple instances of `backend/main.py` simultaneously corrupts Telegram polling, duplicates market scanners, and causes file locks on Parquet recorder logs.
  - Step 0 of the verification gate (`scripts/check.ps1`) fails if more than one backend process is detected.
  - Verification command:
    ```powershell
    netstat -ano | findstr ":8000"
    ```
- **Port Invariants:**
  - Backend is strictly bound to port `8000`.
  - Frontend is strictly bound to port `7100`.

---

## 3. Token Economy Guidelines

To maximize efficiency and minimize session cost without degrading quality:
1. **One Task = One Chat Session:** Do not mix multiple tasks in one dialogue. Context across sessions is passed via `HANDOFF.md` and `context/CURRENT_TASK.md`.
2. **Fixed Model per Task:** Do not switch models mid-task; model switching resets prompt caches.
3. **Range Reads for Large Files:** For files exceeding 800 lines (e.g. `Chart.jsx`, `BacktestPanel.jsx`, `orderflow_backtester.py`), read targeted line ranges instead of loading the full file.
4. **Single Read per File:** Store file context in session memory and avoid re-reading identical files.
5. **Concise Command Output:** Filter verbose terminal output (`Select-Object -First 20`, `git diff --stat`, `pytest -q`).
6. **Gate Execution Timing:** Run intermediate targeted unit tests during development (`pytest -k test_name`, `npm run build`), and run the full `scripts/check.ps1` gate once at the end of the step before committing.

---

## 4. Agent Task Completion Report Template

Every completed task must conclude with an empirical report following this structure. The phrase "Done" without concrete command output is rejected:

```markdown
### 📝 Agent Task Report: [Task Name]
- **Agent & Model:** [e.g. Codex (o3-mini) / Antigravity (Gemini 2.5 Pro) / Cline (Claude 3.5 Sonnet)]
- **Branch:** [agent/.../...]

#### 1. Changes Made
- [List of modified files with concise rationale based on git diff --stat]

#### 2. Verification Execution (with actual terminal output)
```powershell
powershell -ExecutionPolicy Bypass -File scripts/check.ps1
# Paste actual terminal output showing EXIT CODE = 0
```

#### 3. Not Checked Manually
- [Honest disclosure of scenarios not covered by automated test suites]

#### 4. Risks & Recommendations for Next Agent
- [Potential side-effects, watch items, or handoff notes]
```
