# 🏁 SignalScript v2.0 — Финальная сводка по ROADMAP

> **Дата:** 2026-10-23
> **Stable-точка:** тег `stable-20261023` (main `8430d70`, gate зелёный)
> **Режим эксплуатации:** локальный 24/7 (решение Di D1 2026-10-22 — деплой отложен до полной готовности)

---

## 1. Статус фаз

| Фаза | Содержание | Статус |
|---|---|---|
| **0** Стабилизация | Один backend, guards, gate-бейзлайн, CODEGRAPH/SRS | ✅ 100% |
| **1** Paper trading | production_robust, night-pilot, марафон | 🟡 код готов; 1.3 марафон 3–5 суток — **в процессе**; 1.4 критерии — для утверждения Di |
| **2** Recorder + M1.3 | Локальный приём, watchlist-подписки, Wall TTL, Data Manifest, replay-плеер | ✅ 5/6; 2.6 L2-honest бэктест — ждёт ≥7 дней lake |
| **3** Strategy Engine | Weighted Confluence, Verdict v2 traffic-light, правки по STRATEGY_WEAKNESSES, limit-fill simulator, полный registry индикаторов | ✅ 100% |
| **4** Order Flow визуал | TPO/TVAH/TPOC/TVAL, footprint в свечах, слои графика, WebGL-heatmap | ✅ 100% |
| **5** Risk Manager (M4) | Position Sizer (FF/DCA/Heat), Quality Multiplier, Compounding + дневной DD-гард, многоуровневый kill switch, Hedge Mode | ✅ код 100%; валидация на марафоне — в процессе (5.6 A/B) |
| **6** AI & Quant Sweep | Sweep leaderboard, «Apply Strategy #X», help-tooltips, модуляризация (Chart 5065→526, BacktestPanel 2867→1996, DOM 1339→621), PDF+HTML отчёты | ✅ 100% |
| **7** Продукт | Warning Sentinel (Telegram), дневник v2 с пост-сессионным разбором | 🟡 2/4; 7.1 деплой — заморожен (D1); 7.4 горизонт — решение Di |

**Итого по пунктам роадмапа:** ~33 закрыто, открыто 5: 1.3 (марафон — идёт), 1.4 (критерии перехода), 2.6 (после soak lake), 7.1 (деплой, заморожен), 7.4 (решение Di).

---

## 2. Ключевые метрики качества

- **Тесты:** 453+ passed (бэкенд, pytest; росли от 212 на старте Фазы 0)
- **Gate:** `scripts/check.ps1` — pytest + frontend build + smoke + blocking UI + live WS — зелёный на каждом коммите
- **E2E-верификации (Playwright):** PDF-отчёт, HTML-отчёт, replay-плеер, WebGL-heatmap, слайсы модуляризации 6_4a–6_4n, session-review — все PASS
- **Модуляризация (п.1/п.2/п.4 MODULARIZATION_PLAN):** Chart.jsx 5065→526, BacktestPanel.jsx 2867→1996, OrderBookDOM.jsx 1339→621
- **Guardian:** backend автоподнимается после падения, resume марафона работает (валидировано 2 рестартами)

---

## 3. Что работает прямо сейчас

1. **Backend :8000** под guardian-ом, WS к Binance жив (13 сокетов, принты идут).
2. **Марафон A/B** (задача 1.3/5.6): BTC с M4-гейтами vs ETH/SOL контроль, 11-й запуск `overnight_*_1792780120`; наблюдения — `docs/PAPER_MARATHON.md`, критерии сверки — там же.
3. **Recorder** копит lake локально (soak идёт; следить за диском, лимит 50 GiB).
4. **Warning Sentinel** шлёт алерты в Telegram (0 ложных после старта).
5. **Терминал для Di:** `run_app.ps1` / превью `frontend` — график, DOM, лента, бэктест с МК и PDF/HTML-отчётами, sweep-лидерборд, AI Copilot, журнал с разбором сессий.

## 4. Открытые решения для Di

| # | Вопрос | Контекст |
|---|---|---|
| 1.4 | Критерии перехода paper → «продукт»: PF ≥ 1.2, max DD ≤ X%, fee drag < Y% — утвердить X/Y | После марафона |
| 2.6 | Когда lake ≥7 дней — запустить L2-honest бэктест density/wall стратегий | Автоматически по готовности данных |
| 7.1 | Деплой на Proxmox/Docker + Cloudflare Tunnel | Заморожен решением D1 до полной готовности |
| 7.4 | Горизонт продукта: остаёмся консультативными / read-only кабинет | Любой момент |

## 5. Как запускать

```powershell
# Единый шлюз качества (перед коммитом):
powershell -ExecutionPolicy Bypass -File scripts/check.ps1
# Терминал:
powershell -ExecutionPolicy Bypass -File scripts/run_app.ps1
# (run_app.ps1 сломан под PS 5.1 — workaround: прямой запуск
#  .venv\Scripts\python.exe backend/main.py + cd frontend; npm run dev)
```
