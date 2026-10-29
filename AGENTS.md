# AGENTS.md — Canonical Agent Operating Constitution

> **CORE PROTOCOL:** SignalScript relies on sequential execution across AI agents (Codex, Antigravity, Cline, Kimi). Before changing files, read `HANDOFF.md` and run `git status`. Choose checks proportionally: focused checks during implementation; run the full quality gate at a task checkpoint and before commit. Never run overlapping agents or change the same files concurrently.

---

## 1. Project Overview & Architecture
SignalScript is a 24/7 crypto-futures advisory and paper-trading terminal with an integrated quantum risk engine.
- **Strictly Advisory/Paper:** Pure market analysis, paper execution, and alerting. Real order submission to exchanges is **strictly forbidden**.
- **Quantum Core:** Net Expectancy ($E_R > 0$), Market Regime Classifier (5m/15m Choppiness Index + ATR/BBW percentiles), Microstructure Gate (L2 depth + CVD absorption), Risk Sizing from Stop Loss (Portfolio Heat 1.25%, Directional 0.75%).
- **UI Architecture:** High-density desktop workspace on React 19 + Vite + Dockview React (28px tab headers, multi-panel mosaic) + KLineCharts v9 + Canvas 2D OrderBook DOM & Footprint.

---

## 2. Tech Stack & Environment Invariants

| Layer | Technology | Actual Version | Key Constraints & Invariants |
|---|---|---|---|
| **Backend** | Python / FastAPI (`uvicorn`) | `3.11.9` / `0.143.3` | Port **`8000`** strictly. Asynchronous REST + WebSocket. |
| **Database** | SQLite (`SQLAlchemy` + `aiosqlite`) | `2.1.5` / `0.22.1` | Path **`data/signals.db`** strictly. Zero data loss on schema migration. |
| **Frontend** | React / Vite / Tailwind CSS | `19.2.8` / `8.3.4` / `4.3.3` | Port **`7100`** strictly. Functional components, Zustand 5 stores. |
| **Charts** | KLineCharts | `9.8.12` | **Strictly v9 API** (`createOverlay`, `overrideOverlay`, `applyNewData`). |
| **Docking** | dockview-react | `8.6.0` | Multi-pane grid with tab headers fixed at 28px (`--dv-*` overrides). |
| **Design** | shadcn/ui + CSS tokens | Custom density | Strictly semantic tokens (`bg-card`, `text-bull`, etc.). No raw colors. |
| **Exchange** | Binance Futures USDT-M | Public REST/WS | Public contract endpoints (`fapi.binance.com`, `fstream.binance.com`). |

---

## 3. Essential Commands (Exact & Copyable)

### Launch Development Stack (PowerShell)
```powershell
# Run both servers with 1-click launcher:
.\run_app.ps1

# Or manual execution in separate terminals:
.\.venv\Scripts\python.exe backend/main.py               # http://127.0.0.1:8000
npm --prefix frontend run dev -- --host 127.0.0.1 --port 7100  # http://localhost:7100
```

### Production Docker Stack
```powershell
docker compose up -d --build
# Services: signalscript_backend (:8000), signalscript_frontend (:7100)
```

### Mandatory Quality Gate (Run before ANY commit)
```powershell
powershell -ExecutionPolicy Bypass -File scripts/check.ps1
```
*Gate executes: Pytest (Host & Linux Docker) -> Vite Build & Math Tests -> Design Lint Ratchet -> Docs & CodeMap Check -> Smoke Critical Parts -> Playwright UI Smoke -> Live Binance WebSocket.*
*Commit is permitted ONLY when the gate exits with code 0 (`ALL QUALITY CHECKS PASSED. READY TO COMMIT`).*

---

## 4. Code Invariants & Strict Prohibitions

1. **NO Live Order Placement:** Never implement automated real order execution. Terminal is strictly advisory and paper-trading.
2. **NO Synthetic/Mock Market Feeds:** No `Math.random()` in DOM, charts, or tape. Always handle disconnected status explicitly and reconnect via real REST/WS.
3. **NO Port or Path Deviations:** Ports `8000` and `7100`, and database `data/signals.db` must never be altered.
4. **NO Raw Tailwind Palette Colors:** Never use raw colors (`bg-gray-800`, `text-zinc-400`, `border-slate-700`). Use semantic tokens (`bg-background`, `bg-card`, `text-foreground`, `border-border`, `text-bull`, `text-bear`, `bg-primary`).
5. **NO Unsolicited Giant-File Refactoring:** Do not fragment `Chart.jsx`, `BacktestPanel.jsx`, or `orderflow_backtester.py` without an explicit task spec following [`docs/MODULARIZATION_PLAN.md`](docs/MODULARIZATION_PLAN.md).
6. **Strict Single Backend Process:** Only one instance of `backend/main.py` may run at any time (`netstat -ano | findstr ":8000"`).

## 5. Agent Routing

- Minimize verified-work cost. Keep one primary agent; work sequentially.
- Use runtime-supported controls; never claim a switch. Prefer Codex `Default` or [`docs/AGENT_ROUTING.md`](docs/AGENT_ROUTING.md).
- Use moderate effort normally; escalate only for evidenced ambiguity, repeated failure, cross-system impact, security, migration, or financial risk. Use bounded, non-overlapping subagents only when valuable. Run focused checks first and the full gate before commit.
- Do not use project API keys, paid calls, credits, or paid/speed settings without authorization. Report actual checks and limitations concisely.

---

## 6. Repository Map & Where to Look

- `backend/main.py`: FastAPI entrypoint, lifespan startup tasks, WebSocket listeners.
- `backend/app/services/`: Core logic (`risk_engine.py`, `regime_classifier.py`, `overnight_pilot.py`, `scanner.py`, `recorder.py`, `binance_service.py`).
- `backend/app/routers/`: HTTP endpoints (`backtest.py`, `journal.py`, `overnight_pilot.py`, `ai_copilot.py`, `data_routes.py`).
- `frontend/src/App.jsx`: Main UI host, top bar, hotkeys, modals.
- `frontend/src/components/docking/`: Dockview panels (`TerminalDockview.jsx`, `TradeHistoryWidget.jsx`, `ScreenerWidget.jsx`, `FootprintPanel.jsx`).
- `frontend/src/components/ui/`: Canonical design system primitives (`button.jsx`, `dialog.jsx`, `checkbox.jsx`, `number-input.jsx`, `tabs.jsx`).
- `frontend/src/index.css`: Global styles, CSS variable tokens, Dockview `--dv-*` overrides.
- `scripts/check.ps1`: Single quality gate script (UTF-8 BOM preserved).
- `tasks/`: Isolated task specifications (`tasks/<id>-<name>.md`, template: `tasks/TEMPLATE.md`).
- `context/`: Runtime coordination (`CURRENT_TASK.md`, `WORK_QUEUE.md`, `COORDINATION_STATE.json`).

---

## 7. Documentation Maintenance Rule
For structure/flow changes update [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). For public interfaces, cross-module flows, ownership, data/config contracts or user workflows update [`docs/SYSTEM_WORKING_MAP.md`](docs/SYSTEM_WORKING_MAP.md). Regenerate [`docs/CODEMAP.md`](docs/CODEMAP.md); update [`docs/ROADMAP.md`](docs/ROADMAP.md) and [`PROGRESS.md`](PROGRESS.md) when task status changes.
Enforced automatically in `scripts/check.ps1` via `python scripts/check_docs.py`.

---

## 8. Deep Documentation Directory (`docs/`)

- **Design:** [`docs/design/DESIGN_GUIDE.md`](docs/design/DESIGN_GUIDE.md).
- **Git rules:** [`docs/GIT_AND_DEV_RULES.md`](docs/GIT_AND_DEV_RULES.md).
- **Routing:** [`docs/AGENT_ROUTING.md`](docs/AGENT_ROUTING.md), [`docs/MODEL_ROUTING.md`](docs/MODEL_ROUTING.md).
- **History and roadmap:** [`docs/HISTORY.md`](docs/HISTORY.md), [`docs/ROADMAP.md`](docs/ROADMAP.md), [`docs/DECISIONS.md`](docs/DECISIONS.md).
- **Maps:** [`docs/CODEMAP.md`](docs/CODEMAP.md), [`docs/SYSTEM_WORKING_MAP.md`](docs/SYSTEM_WORKING_MAP.md).
- **Product:** [`docs/USER_INTENTS.md`](docs/USER_INTENTS.md), [`docs/WIN_RATE_IMPROVEMENT_PLAN.md`](docs/WIN_RATE_IMPROVEMENT_PLAN.md), [`docs/MODULARIZATION_PLAN.md`](docs/MODULARIZATION_PLAN.md).
- **Deployment:** [`docs/DOCKER.md`](docs/DOCKER.md), [`DEPLOY.md`](DEPLOY.md).
