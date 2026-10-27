# AGENTS.md — Canonical Agent Operating Constitution

> **CORE PROTOCOL:** SignalScript relies on sequential, non-concurrent execution across AI agents (Codex, Antigravity, Cline, Kimi). Before writing any code: read `HANDOFF.md`, run `git status`, and run `powershell -ExecutionPolicy Bypass -File scripts/check.ps1`.

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

---

## 5. Repository Map & Where to Look

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

## 6. Documentation Maintenance Rule
Any change altering directory structure, public interfaces, data flows, or task status must in the same commit:
(a) Update [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) on structure/flows changes;
(b) Run `python scripts/gen_codemap.py` to regenerate [`docs/CODEMAP.md`](docs/CODEMAP.md);
(c) Update task status in [`docs/ROADMAP.md`](docs/ROADMAP.md);
(d) Add a chronological entry to [`PROGRESS.md`](PROGRESS.md).
Enforced automatically in `scripts/check.ps1` via `python scripts/check_docs.py`.

---

## 7. Deep Documentation Directory (`docs/`)

- **Design System Guide:** [`docs/design/DESIGN_GUIDE.md`](docs/design/DESIGN_GUIDE.md) (token specifications, component catalog, density rules).
- **Git & Dev Rules:** [`docs/GIT_AND_DEV_RULES.md`](docs/GIT_AND_DEV_RULES.md) (branch naming, commit hygiene, token economy, report template).
- **Model Routing:** [`docs/MODEL_ROUTING.md`](docs/MODEL_ROUTING.md) (model tiering, Cline routing, sequential execution).
- **Agent Routing Stub:** [`docs/AGENT_ROUTING.md`](docs/AGENT_ROUTING.md) (Codex model assignment & reasoning effort template).
- **History & ADR-Lite:** [`docs/HISTORY.md`](docs/HISTORY.md) (architectural decisions, failed experiments, pitfalls).
- **Engineering Roadmap:** [`docs/ROADMAP.md`](docs/ROADMAP.md) (real roadmap: done, in progress, next, backlog).
- **Code Map:** [`docs/CODEMAP.md`](docs/CODEMAP.md) (auto-generated symbols and dependencies map).
- **User Intent Scenarios:** [`docs/USER_INTENTS.md`](docs/USER_INTENTS.md) (overnight pilot, post-mortem analytics, Docker runs).
- **Quantum Transformation:** [`docs/WIN_RATE_IMPROVEMENT_PLAN.md`](docs/WIN_RATE_IMPROVEMENT_PLAN.md) (expectancy and risk engine).
- **Modularization Roadmap:** [`docs/MODULARIZATION_PLAN.md`](docs/MODULARIZATION_PLAN.md) (backend architecture decomposition plan).
- **Docker Deployment:** [`docs/DOCKER.md`](docs/DOCKER.md) & [`DEPLOY.md`](DEPLOY.md) (container operations, Proxmox/Cloudflare setups).
- **Architecture Decisions:** [`docs/DECISIONS.md`](docs/DECISIONS.md) (historical decision log).
