# HANDOFF.md — Current Repository Snapshot

## State

- **Branch / HEAD:** `chore/codex-handoff`; read the current immutable hash with `git rev-parse --short HEAD`.
- **Working tree:** clean. `terminal_workspace.code-workspace` is intentionally ignored as a local editor artifact.
- **Running:** one logical backend root (`backend/main.py`) on `8000` and Vite on `7100`; both returned HTTP 200 during the final gate.

## Verification

- `python scripts/gen_codemap.py` generated a deterministic 1532-line map.
- Full quality gate passed: host pytest **585 passed, 31 skipped, 9 warnings**; frontend recovery tests **7/7**; pilot/math tests **85/85**; Vite build, design lint, docs, critical smoke, blocking Playwright, and live WebSocket all passed. Docker Linux pytest remained unavailable and is reported as a non-blocking warning.
- Current tracked files contain no common credential pattern. Git history has one candidate secret in `backend/app/config.py` at `833f789…`; rotate/clean only with explicit approval.

## Known issues

1. Host pytest still emits unawaited-coroutine warnings in `live_paper_runner.py` and an `aiosqlite` thread warning.
2. Linux-container pytest is skipped when Docker is unavailable.

## First tasks for the next agent

1. `NEXT-01` (M): ratchet down remaining design-token violations with focused lint output.
2. `NEXT-02` (L): plan/split the historical A/B performance comparison before implementation.
3. Investigate the existing pytest warnings as a separate bug-fix task; do not suppress them.

## Handoff conclusion

The repository is documented, generated maps are fresh, the quality gate is green, and the next chat can start feature work from `ROADMAP.md` without reopening this thread.
