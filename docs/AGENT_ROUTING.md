# Runtime-Aware Model and Agent Routing

This is the detailed guide for the project-wide policy in [`AGENTS.md`](../AGENTS.md). It applies across Codex, Antigravity, Cline, Kimi, and other agents. The runtime is the source of truth for what controls and models are available.

## Default operating mode

- Keep one primary agent responsible for task integrity, integration, and final verification. Work sequentially by default, in line with the repository's coordination rule.
- Prefer moderate reasoning effort for ordinary tasks. Do not use high, extra-high, or maximum effort across an entire goal by default.
- Optimize total cost of a successfully completed and verified block. A small targeted check can be cheaper overall than a weak attempt followed by retries.
- In Codex, use its built-in `Default` model mode as the primary route. This lets Codex choose from its available models and reasoning levels for the task. A manually selected model is retained, so return to `Default` when automatic routing is wanted again.
- Do not add a project-local router, model profile, API integration, or other routing infrastructure. The repository rules guide the agent; they do not control Codex's model picker or change account/workspace settings.

## Manual fallback for other agents or explicit overrides

Use these lanes only when Codex `Default` is unavailable or when a different agent/runtime needs a concrete model choice. Model names and effort values are preferences; only select options the active runtime offers.

| Work | Preferred capability | Guidance |
|---|---|---|
| Search, concise evidence, bounded extraction | Fast/low-cost model, low effort | Keep the result focused and cite relevant paths/lines. |
| Small documentation, label, style, or isolated change | Fast/low-cost model, low or medium effort | Use when the task is clear and local. |
| Related component changes, tests, integration, design-system consistency | Primary workhorse model, medium effort | Keep one agent responsible for the complete change. |
| Difficult diagnosis, state architecture, cross-module behavior, concurrency | Primary workhorse model, high effort if needed | Escalate based on evidence and task risk, not habit. |
| Critical financial/risk calculations, security, data migrations | Strongest suitable capability available, elevated effort as needed | Verify with focused tests and the required project gate. |
| Complex unresolved issue after simpler approaches failed | Frontier model, if selectable | Use only when concrete evidence shows the normal route is insufficient. |

If a fixed model is needed, prefer GPT-6.1 Sol at medium effort for the main implementation when available. The other preferred lanes are:

| Route | Model and effort | Use |
|---|---|---|
| Quick | GPT-6 Luna, low/medium | Small, clear documentation, labels, isolated styles, or bounded fact-finding. |
| UI | GPT-6.1 Terra, low/medium | Visual inspection, browser work, and contained UI corrections. |
| Main | GPT-6.1 Sol, medium | Normal implementation, connected components, integration, and focused tests. |
| Deep | GPT-6.1 Sol, high | Difficult diagnosis, ambiguous state, cross-module failures, or critical calculations after evidence shows medium effort is insufficient. |
| Exceptional | GPT-6 Astra, high | A high-impact, unresolved problem or architecture arbitration after the normal route has failed. |

## Adaptive routing during a task

1. In Codex, keep `Default` selected so the built-in selector can route as the task develops. Do not manually pin a model for the whole project goal unless the user asks or `Default` is unavailable.
2. For other agents, or when an explicit override is needed, classify the next substantial work block using the fallback table. Make the route decision once for that block; do not reconsider after every small action.
3. Reassess if a local edit expands across subsystems, financial/security/migration risk appears, or the same approach fails again. Use the least costly route capable of handling the new block.
4. If an actual model/effort control exists, switch only at a meaningful block boundary and only when the runtime confirms the change. Keep the primary agent responsible for integration and final checks.
5. If no in-session switch is available but sequential model-selected delegation is available, delegate only a bounded block with clear inputs, constraints, and acceptance criteria. Wait for it to finish before starting another. The repository forbids concurrent agents and overlapping edits. Delegate only when the expected benefit outweighs added context and review cost.
6. If neither control is available, continue with the current model. Mention this limitation once when it affects routing; do not stop work or invent a router.
7. After resolving an exceptional block, return to `Default` in Codex or the normal route in other agents. Do not keep high effort active for an entire `/goal` by default.

Use only models and effort levels offered by the active runtime. Relative cost and quota assumptions are unverified unless an account tool reports them. Never claim a switch that did not occur.

## Escalation

Escalate when there is material ambiguity, security or financial impact, a migration, cross-subsystem behavior, or repeated failure with the same cause. Before escalating, state the concrete problem, collect the smallest useful evidence, and rule out an obvious environment issue. Do not repeat an approach that evidence has already disproved. Return to the normal level after resolving the high-risk block when the runtime permits.

## Subagents

Use subagents only when independent work makes the result meaningfully faster or more reliable. The repository defaults to sequential, non-concurrent agent execution: do not run project agents in parallel or permit overlapping edits. Give each subagent a narrow objective, required files, constraints, and acceptance criteria. Minimize shared context. The primary agent remains accountable and checks the resulting diff and evidence; an agent's opinion does not replace tests or browser verification.

## Context and verification economy

- Read root `HANDOFF.md` and run `git status` before modifying files. Use `ROADMAP.md` and `CODEMAP.md` to find relevant work and symbols; inspect source as the authority.
- Read only relevant files and ranges. Avoid re-reading unchanged large files, loading archives/generated output/lockfiles/logs in full, or repeating broad exploration without a concrete reason.
- Use focused checks first. Run the full `scripts/check.ps1` gate at meaningful checkpoints and before commit as required by the task and repository rules. Do not run the full gate after each cosmetic adjustment or repeatedly without a reason.
- Keep successful command output brief, but retain enough failure output and traceback to diagnose the issue. Report only checks actually run.
- Update documentation for completed logical blocks according to `AGENTS.md`; do not touch every project document for a cosmetic patch.

## Limits and paid usage

- Use account limits only from a tool that actually exposes them. Never estimate exact remaining tokens, cost, or savings without evidence; use relative effort (low/medium/high) if exact figures are unavailable.
- Do not use project API keys for development or trigger additional paid model/API calls, purchase credits, or change paid/speed settings without explicit authorization.
- Avoid narrating routine model choices. In the handoff, report the result, checks actually run, material limitations, and next block; mention routing only when a meaningful change or constraint occurred.
- When asked to continue a `/goal`, carry it through independent blocks without pausing for confirmation after each step. Ask only for a decision that would materially change scope or authority.
