# Model Routing & Multi-Agent Protocol

This document defines how AI agents (Codex, Antigravity, Cline, Kimi) are routed and coordinated across tasks in SignalScript.

---

## 1. Sequential Multi-Agent Execution Rule

- **Strictly Sequential:** Multiple agents **NEVER** run simultaneously on this repository.
- **Handshake Protocol:**
  1. Read `HANDOFF.md` at the project root to inspect the current state and active branch.
  2. Run `git status` to verify a clean working tree.
  3. Run `powershell -ExecutionPolicy Bypass -File scripts/check.ps1` to ensure the gate is passing (Exit Code = 0).
  4. Perform the assigned task adhering to the strict file whitelist.
  5. Conclude by updating `HANDOFF.md` with an empirical completion report.

---

## 2. Model Routing Classes (`config/model-routing.json`)

The single source of truth for model assignment is [`config/model-routing.json`](../config/model-routing.json). The router script `scripts/cline-auto.ps1` reads this configuration automatically.

| Class | Target Models | Scope & Use Case |
|---|---|---|
| `routine` | `google/gemma-2-9b-it:free`, `gpt-4o-mini` | Documentation updates, CSS/Tailwind token adjustments, lightweight isolated UI tweaks. |
| `standard` | `meta-llama/llama-3.1-8b-instruct`, `claude-3.5-haiku` | Feature implementation, component creation, non-critical frontend/backend logic without touching the financial core. |
| `expert` | `anthropic/claude-3.5-sonnet`, `gemini-2.5-pro`, `o1/o3-mini`, `gpt-4o` | Indicator mathematics, order flow backtest engine, risk engine calculations, WebSocket pipelines, database schema migrations. |
| `review` | `anthropic/claude-3.5-haiku` | Final diff review and sanity checks before merging critical financial modules. |

---

## 3. Automation Router (`scripts/cline-auto.ps1`)

To invoke tasks with automatic model selection:
```powershell
# Dry run check of model classification:
powershell -ExecutionPolicy Bypass -File scripts/cline-auto.ps1 -TaskFile tasks/003-my-task.md -DryRun

# Execute task with automated routing:
powershell -ExecutionPolicy Bypass -File scripts/cline-auto.ps1 -TaskFile tasks/003-my-task.md
```

If task complexity increases during execution beyond the assigned tier, the agent must halt with the marker `ESCALATE_MODEL` rather than switching mid-task.
