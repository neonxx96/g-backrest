# Agent Model Routing & Reasoning Effort (Codex & Multi-Agent)

> **NOTICE FOR CODEX:** This document is a structured template. Fill in the specific OpenAI / Codex models (e.g. `o3-mini`, `gpt-4o`, `gpt-4.5`) and reasoning effort levels based on your active runtime configuration.

---

## 1. Task Type to Model Mapping

| Task Category | Role Description | Target Model (Fill in) | Reasoning Effort | Example Scope |
|---|---|---|---|---|
| **Routine / Formatting** | Quick text, styling & doc edits | `[TO_BE_FILLED_BY_CODEX]` | `low` | Tailwind tokens, markdown docs, comments, small typo fixes. |
| **Standard Feature** | Non-critical UI & glue code | `[TO_BE_FILLED_BY_CODEX]` | `medium` | Adding new UI components, form inputs, route bindings, data formatting. |
| **Expert Financial** | Core quant math, PnL & risk | `[TO_BE_FILLED_BY_CODEX]` | `high` | Risk engine, expectancy formulas, slippage model, WebSocket reconnects. |
| **Review & Security** | Final pre-commit diff review | `[TO_BE_FILLED_BY_CODEX]` | `medium` | Diff reviews on financial and DB migration files. |

---

## 2. Escalation Rules

1. If an assigned routine/standard task encounters unexpected architectural complexity, race conditions, or financial math modifications, halt immediately with the marker `ESCALATE_MODEL`.
2. Do not switch models mid-step within a single chat session. Close the step cleanly or request escalation.

---

## 3. Budget & Token Conservation Rules

- Maintain focused, single-task sessions.
- Read large files (>800 lines) by specific line ranges only.
- Run `scripts/check.ps1` once at the conclusion of a step before commit, rather than after every trivial edit.
