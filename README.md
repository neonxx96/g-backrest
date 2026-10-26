# 🚀 Signal Script: Торговый терминал, Сканер Binance Futures и Quant Engine

> **ЕДИНЫЙ ИСТОЧНИК ПРАВИЛ:** Все правила архитектуры, стек, регламент Git и шлюз качества зафиксированы в [AGENTS.md](file:///d:/AI_agent_space/gemini/AGENTS.md).

Профессиональное приложение для крипто-фьючерсного трейдинга и алго-исследований:
- Сканирует рынок **Binance USDT-M Futures** (топ-150 пар по объему).
- Рассчитывает индикаторы в реальном времени: **EMA(20/50), всплеск объема (xN), RSI, CVD (Cumulative Volume Delta), ATR, волатильность**.
- Квантовый риск-движок: **Net Expectancy ($E_R$), Market Regime Classifier (5m/15m), Microstructure Gate (L2 depth + CVD absorption), Portfolio Heat (1.25%)**.
- Высокоскоростной веб-интерфейс на **React 19 + Vite + Dockview**: многооконная мозаика, график **KLineCharts v9**, Canvas 2D стакан (L2 Depth) с подсветкой плотностей, лента сделок Time & Sales, журнал решений (Decision Journal).
- Интеграция с **OpenRouter AI Copilot / Sentinel** для контекстного анализа ситуаций.

---

## 🛠️ Стек технологий и порты

- **Backend:** Python 3.11+, FastAPI (`uvicorn`), SQLite (`SQLAlchemy 2.0` + `aiosqlite`), Pandas/Numpy/PyArrow.
  - **Порт бэкенда:** строго `http://127.0.0.1:8000`
  - **База данных:** `data/signals.db`
- **Frontend:** React 19, Vite, KLineCharts v9.8.12, Dockview React, Tailwind CSS 4, Zustand 5.
  - **Порт фронтенда:** строго `http://localhost:7100` (`http://127.0.0.1:7100`)
- **Данные:** Публичный Binance Futures API (REST + WebSocket), локальный OrderFlow Parquet Lake (`data/lake/`, `data/recorded/`).

---

## 💻 Быстрый запуск

### 1-клик запуск (Windows PowerShell)
```powershell
cd d:\AI_agent_space\gemini
.\run_app.ps1
```
*Запускает FastAPI на порту 8000, Vite на порту 7100 и открывает браузер.*

Остановка:
```powershell
.\stop_app.ps1
```

### Ручной запуск (в двух терминалах)
```powershell
# Терминал 1 (Бэкенд):
.\.venv\Scripts\python.exe backend/main.py

# Терминал 2 (Фронтенд):
cd frontend
npm run dev -- --host 127.0.0.1 --port 7100
```

---

## 🛡️ Единый шлюз качества (Pre-Commit Verification)

Перед любым коммитом обязателен запуск проверочного шлюза:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/check.ps1
```
Шлюз проверяет: `pytest backend/tests` (570+ тестов) $\rightarrow$ тесты раскладок Dockview $\rightarrow$ `npm run build` $\rightarrow$ смоук критических модулей (DOM, Chart, Scanner, Recorder, Journal) $\rightarrow$ Playwright UI смоук $\rightarrow$ проверка живого Binance WS.

Коммит разрешен только при получении строки:
`🎉 ALL QUALITY CHECKS PASSED. READY TO COMMIT.` (Exit Code = 0).

---

## 📚 Документация проекта

- [AGENTS.md](file:///d:/AI_agent_space/gemini/AGENTS.md) — Главная конституция проекта, правила кода и Git.
- [HANDOFF.md](file:///d:/AI_agent_space/gemini/HANDOFF.md) — Протокол передачи смены между агентами (активные 3 смены).
- [PROGRESS.md](file:///d:/AI_agent_space/gemini/PROGRESS.md) — Текущий статус подсистем и пройденные вехи.
- [docs/DECISIONS.md](file:///d:/AI_agent_space/gemini/docs/DECISIONS.md) — Реестр разрешенных противоречий и архитектурных решений.
- [docs/MODULARIZATION_PLAN.md](file:///d:/AI_agent_space/gemini/docs/MODULARIZATION_PLAN.md) — План модульного рефакторинга бэкенда.
- [docs/WIN_RATE_IMPROVEMENT_PLAN.md](file:///d:/AI_agent_space/gemini/docs/WIN_RATE_IMPROVEMENT_PLAN.md) — План квантовой оптимизации и расчета Expectancy.
- [DEPLOY.md](file:///d:/AI_agent_space/gemini/DEPLOY.md) — Развертывание в Docker и Proxmox.
- `docs/archive/` — Исторический архив старых отчетов, спецификаций и смен.
