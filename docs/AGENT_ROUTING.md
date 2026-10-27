# Agent Routing for This Codex Runtime

## Task → role → model → reasoning effort

| Task type | Role | Model | Effort | Escalate when |
|---|---|---|---|---|
| Search, code reading, concise evidence | Explorer | `gpt-6-luna` | `low` | Two failed targeted checks or financial/architecture scope appears. |
| Small isolated implementation, docs, tests | Implementer | `gpt-6.1-sol` | `medium` | Two failed implementation/test attempts. |
| Diff and regression/security review | Reviewer | `gpt-6.1-sol` | `medium` | Risk, migration, or unresolved finding needs design work. |
| Quant math, migration, concurrency, architecture | Debugger / architect | `gpt-6-astra` | `high` | Only after two concrete failures or an explicitly high-risk decision. |

Available in this runtime: `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`. The runtime labels Luna as fast/affordable, Sol as workhorse, Astra as frontier; relative pricing, quotas, and `/model` metadata are **UNVERIFIED**.

## Escalation rules

1. Use one agent per isolated task; do not overlap files or run concurrent project agents.
2. Start at the cheapest capable route. Escalate only after two failed checks, not from uncertainty.
3. Route `S` to Luna/Sol, `M` to Sol, and split `L` into `M` tasks; use Astra only for the defined high-risk exception.
4. A fresh reviewer examines the diff and verification evidence; it is not the implementation author.

## Budget rules

- Return exploration as no more than 15 lines with `file:line` references.
- Read only the files named by `HANDOFF.md`, `ROADMAP.md`, and `CODEMAP.md`; use line ranges for large files.
- Run focused checks first and the full gate only before handoff/commit.
- No project-local Codex profile configuration was created: the supported project schema is **UNVERIFIED** in this runtime. Do not invent a `.codex` format.
