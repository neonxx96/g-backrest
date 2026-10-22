# 🗺️ ROADMAP SignalScript v2.0 — мастер-план, синхронизированный с SRS v1.0

> **Версия:** 2.0 (переписан под SRS)  
> **Дата:** 2026-10-22  
> **Источник требований:** [docs/specs/srs-v1.0.md](docs/specs/srs-v1.0.md) (Approved for Implementation)  
> **Карта кода:** [CODEGRAPH.md](CODEGRAPH.md) (ноды/слои ссылаются туда)  
> **Статус:** 🟡 НА РЕДАКТИРОВАНИИ — Di правит приоритеты в разделе «Решения Di»  
> **История:** v1.0 → v2.0: разнесён по модулям SRS M1–M6, добавлена матрица трассировки SRS ↔ код, учтены guards единого бэкенда (f033956).

---

## 0. Инварианты (конституция проекта, выровнена с SRS §1.1)

1. **Truth-First & No-Fake Data** (SRS 1.1.1): никаких синтетических данных и OHLC-прокси для L2/ликвидности; отсутствие данных = явное `No data`.
2. **Deterministic Engine** (SRS 1.1.2): входы/выходы — только через `UnifiedTradeSignal`; LLM — строго advisory (советы, тюнинг параметров, отчёты).
3. **Multi-Regime Consistency** (SRS 1.1.3): одна стратегия (`UnifiedTradeSignal`) исполняется одинаково в History → Walk-Forward/OOS → Live Paper.
4. **Isolated Layers** (SRS 1.1.4): backend / scripts / frontend строго разделены; `execution_simulator.py` — неизменяем.
5. **Строго консультативно:** никаких реальных ордеров и ключей.
6. **Строго один backend-процесс** (guard: check.ps1 шаг 0; AGENTS.md §6).
7. **Единый шлюз качества:** `scripts/check.ps1` зелёный перед любым коммитом.
8. **Файлы-гиганты** не дробить вне `docs/MODULARIZATION_PLAN.md`.

---

## 1. Трассировка SRS ↔ код (сверено с CODEGRAPH, 2026-10-22)

Легенда: ✅ done · 🟡 partial · ❌ missing · 🔲 superseded (перекрыто новым рекордером)

| SRS | Требование | Статус | Ноды в CODEGRAPH | Закрывается |
|---|---|---|---|---|
| **M1.1** | Историческое хранилище: дневные Parquet + Data Manifest (диапазоны, гэпы, типы) | 🟡 | `REC`: recorder S1 — immutable lake, SHA-256 манифесты, gap-журнал; но layout не daily-files, Data Manifest не машиночитаемый для истории | Фаза 2 |
| **M1.2** | Footprint/TPO только из aggTrades; `poc_price=null` при отсутствии; TVAH/TPOC/TVAL | 🟡 | `SRV/cluster_engine.py` (poc_price, delta, cvd есть; TVAH/TVAL, stacked_imbalance частично); `CMP/FootprintClusters.jsx` — автономен, не в свечах; null-контракт POC не зафиксирован тестом | Фаза 4 |
| **M1.3** | Recorder по активному Watchlist; Wall TTL (сек); Auto-режим (99-й перцентиль/K×median) + Manual (≥$500k, TTL≥15с) | 🟡 | `SRV/recorder.py` — фиксированный focus_symbols (🔲 заменяется REC); Wall TTL живёт только в `CMP/OrderBookDOM.jsx` (клиент); auto-режима квантиля нет | Фаза 2 |
| **M2.1** | Indicator Registry: EMA, RSI, ATR, VWAP, CVD, VolumeSpike, OI | 🟡 | `SRV/indicators/registry.py` + plugins есть; VWAP/OI-плагины требуют проверки полноты | Фаза 3 |
| **M2.2** | Entry Modes: Breakout / Bounce | ✅ | `orderflow_backtester.py`: `entry_mode` = `limit_bounce`/`breakout`/`cvd_absorption` | — |
| **M2.3** | Strict AND + Weighted Confluence (Σw=1, порог ~0.65) | ❌ | Strict AND — в фильтрах бэктестера; взвешенного скоринга нет (`engine/` — нет confluence_score) | Фаза 3 |
| **M2.4** | SL/TP bounds; динамический SL: Fixed % / Behind Wall / ATR-based | ✅ | `orderflow_backtester.py:434`: `sl_mode` = `fixed_pct`/`behind_wall`/`atr_volatility` | — |
| **M2.5** | `UnifiedTradeSignal` с `entry_reason` list + `exit_reason` | ✅ | `ENG/trade_contract.py` (fan-in 7, тесты) | — |
| **M3.1** | Комиссии maker/taker, slippage, Fee Drag % | ✅ | `EXE/execution_simulator.py` + `fee_drag` в UI/отчётах | — |
| **M3.2** | RegimeClassifier; Train/Validation/Holdout | ✅ | `ENG/regime_classifier.py`, `ENG/walk_forward_engine.py`, optimizer OOS+holdout | — |
| **M3.3** | Verdict v2: PASS/WARNING/BLOCK; блок при NetPnL<0, малой выборке, TOXIC; флаг `L2 History: No data` | 🟡 | Блок-вердикт есть в pilot; трёхуровневый traffic-light и WARNING-уровень не формализованы | Фаза 3 |
| **M4.1** | Position Modes: One-Way (с DCA/reversal) и Hedge Mode | ❌ | `SRV/paper_trading.py`, `live_paper_runner.py` — только one-way | Фаза 5 |
| **M4.2** | Position Sizer: Fixed Fractional 1%; Budgeted DCA (риск лестницы ≤1%); Signal Quality Multiplier (0.5–1.2×); Max Portfolio Heat; Compounding с дневным DD-лимитом | 🟡 | Fixed Fractional есть (`risk_per_trade_pct`, фикс формулы риска в бэктестере); DCA-лестница, quality multiplier, heat, compounding — отсутствуют | Фаза 5 |
| **M4.3** | Kill Switch: −3%/−5%/−10% или $-порог | 🟡 | Kill-switch есть (test_paper_kill_switch_and_forecast); многоуровневые пороги не настроены | Фаза 5 |
| **M5.1** | Quant Sweep Optimizer: grid + пермутaции, Top 1–10 leaderboard | 🟡 | `ENG/optimizer.py` (genetic), `SRV/think_optimizer.py`, grid в `BacktestPanel.jsx`; ранжированный Top-10 лидерборд как артефакт — нет | Фаза 6 |
| **M5.2** | AI Copilot: human-readable отчёты, кнопка «Apply Strategy #X» в 1 клик; AI строго advisory | 🟡 | `API/ai_copilot.py`, `CMP/AICopilotSidebar.jsx`, OpenRouter-каскад с бюджетом; Apply есть в pilot wizard, но не в AI Copilot | Фаза 6 |
| **M6.1** | Dockview LEGO-layout: floating windows, табы, 2-й монитор, persistence SQLite+localStorage | ✅ | `DCK/TerminalDockview.jsx`, `STO/layoutStore.js`, `API/workspaces.py`; `layoutRecovery.js` (новое) | — |
| **M6.2** | Chart: слои Heatmap/Densities, Liquidations, TPO, Forecast Bands, Signals, Regime; под-панели CVD/OI/RSI; тултип сделки (entry reasons, exit, fees, Fee Drag%, MFE, MAE, regime) | 🟡 | `CMP/Chart.jsx`: конус, SMC, RR-box, бэктест-трейды есть; TPO-слоя нет, OI под-панели нет, MFE/MAE в тултипе нет | Фаза 4 |
| **M6.3** | DOM & Tape высокой производительности | ✅ | `CMP/OrderBookDOM.jsx`, `DCK/TradesWidget.jsx` (Canvas 2D) | — |
| **M6.4** | Эргономика: пресеты, color-linking, help-tooltips (?) на каждый параметр | 🟡 | `STO/colorLinksStore.js`, пресеты есть; help-tooltips — нет | Фаза 6 |
| **QA** | ≥80 pytest, build+gate зелёные | ✅ | 212 passed / 28 skipped; gate зелёный | — |

**Вывод сверки:** фундамент (M2.2, M2.4, M2.5, M3.1, M3.2, M6.1, M6.3, QA) готов. Крупнейшие провалы: **M2.3** (weighted confluence), **M4.1/M4.2** (hedge mode + position sizer) — оба блокируют «institutional-grade» из SRS. Средние: M1.2/M1.3 (TPO + watchlist-recorder), M3.3 (verdict v2), M6.2 (слои графика).

---

## 2. РОАДМАП (по фазам; исполняется после утверждения Di)

### ✅ ФАЗА 0 — Стабилизация (ВЫПОЛНЕНО 2026-10-22)
- [x] 0.1 Разобрать рабочее дерево → коммит 29c5f5c + merge a17a128 в main
- [x] 0.2 Один backend: убиты 2 известных + 6 зомби-процессов; один backend на 8000, vite 5173 → прокси 8000; `.env` = 8000; guards (check.ps1 шаг 0, run_app.ps1, AGENTS.md §6) → коммит f033956
- [x] 0.3 Свежий gate-зелёный бейзлайн (212 тестов)
- [x] 0.4 ROADMAP.md v1 + CODEGRAPH.md (212 нод, 370 связей)
- [x] 0.5 SRS v1.0 принят в docs/specs, трассировка с CODEGRAPH (этот файл, v2.0)

### 🌙 ФАЗА 1 — Paper Trading: production_robust + марафон (M3.3/M4 в bootstrap)
- [x] 1.1 Пресет `production_robust`: vol_mult 1.25, RSI 42–58, R:R ≥ 2.75:1, TP ≥ 2.2%, SL 0.75–0.80% в `overnight_pilot.py` + тест (2026-10-22, ветка `agent/kimi/phase1-paper-production-robust`: пресет уже соответствовал, добавлен тест RSI-полосы 42–58 в live runner)
- [x] 1.2 `night-pilot.ps1`: запуск production_robust на 8000 для BTC/ETH/SOL; WinRate/Net PnL по монетам, Warning Sentinel (2026-10-22: preflight+start, session_id `overnight_*_1792680718`, data=connected, errors=0; внимание — исторический ROI пресета отрицательный: BTC −4.72%, ETH −4.01%, SOL −3.96%)
- [ ] 1.3 Paper-марафон 3–5 суток; morning reports в `docs/PAPER_MARATHON.md`
- [ ] 1.4 Критерии перехода (Di утверждает): PF ≥ 1.2, max DD ≤ X%, fee drag < Y%

### 📦 ФАЗА 2 — Recorder production + M1.3 (SRS Data Ingestion)
- [x] 2.1 **Локальный приём recorder в эксплуатацию** (решение Di 2026-10-22: деплой на сервер отложен до полной готовности проекта; машина работает 24/7): запуск нового recorder локально (`run_recorder.ps1` или Docker Desktop), 48 ч параллельно со старым, сверка gap-журнала, только потом старый recorder выключить (2026-10-22: `scripts/run_recorder.ps1` + `recorder.local.yaml`, запущен PID-файлом, soak 48 ч идёт; сеть рвётся раз в ~1–2 мин, reconnect+gap-журнал работают — сверить перед выключением старого)
- [x] 2.2 **M1.3a:** watchlist-driven подписки — recorder читает активный WatchlistWidget, а не фиксированный список (2026-10-22: backend публикует `data/active_watchlist.json` из background_worker; recorder мержит tier1+watchlist и ротирует подписки на лету)
- [x] 2.3 **M1.3b:** Wall TTL на бэкенде (persist, API) + Auto-режим плотности (99-й перцентиль / K×median за N мин) рядом с Manual ≥$500k/TTL≥15с (2026-10-22: `wall_settings.py` + `/api/walls/*`; в продакшен попадёт после штатного рестарта backend)
- [x] 2.4 **M1.1:** машиночитаемый Data Manifest (диапазоны, гэпы, типы данных) поверх lake; выравнивание layout под SRS (2026-10-22: `recorder/manifest.py`, `python -m recorder manifest` → `data/data_manifest.json`)
- [ ] 2.5 Replay-плеер из lake (Play/Pause/Step/скорость) — опция: влить `agent/cline/replay-engine`
- [ ] 2.6 L2-honest бэктест density/wall стратегий после ≥7 дней lake

### ⚙️ ФАЗА 3 — Strategy Engine: M2.3 + M3.3 + правки по квантовому отчёту
- [x] 3.1 **M2.3:** Weighted Confluence engine — веса wᵢ (Σ=1), динамический порог (≈0.65), скор в `UnifiedTradeSignal`; в UI — редактор весов (2026-10-22, main: `engine/confluence.py` Strict AND + weighted, поле `confluence_score`, API `/api/confluence/*`, persist `data/confluence_weights.json`, редактор — вкладка Confluence в SettingsModal; 12 тестов)
- [x] 3.2 **M3.3:** Verdict v2 traffic-light (PASS/WARNING/BLOCK) как формальный контракт + API + плашки в wizard; WARNING при PF 1.0–1.2, малой выборке (2026-10-22, main: `engine/verdict.py`, `/api/verdict/evaluate`, поле `verdict` в строках статуса пилота, `VerdictBadge` в OvernightPilotPanel; BLOCK при NetPnL<0/<10 сделок/TOXIC, WARNING при PF 1.0–1.2/<30 сделок/`L2 History: No data`; 13 тестов)
- [ ] 3.3 Правки по STRATEGY_WEAKNESSES: авто-BE при +0.5R, adaptive wall, time-stop 45 мин, maker-выходы; матрица «было/стало» по 8×3
- [ ] 3.4 Limit-order fill simulator для «Тест сетапа» (ветка `agent/cline/limit-fill-simulator`)
- [x] 3.5 **M2.1:** довести registry: VWAP, OI-плагины до полного набора SRS + тесты (2026-10-22, main: VWAP был полон; добавлен `plugins/open_interest.py` — truth-first, без OI-колонки ничего не синтезирует; registry покрывает полный набор M2.1: EMA/RSI/ATR/VWAP/CVD/VolumeSpike/OI; 7 тестов)

### 📊 ФАЗА 4 — Order Flow визуал: M1.2 + M6.2
- [ ] 4.1 **M1.2a:** TPO/Volume Profile: TVAH/TPOC/TVAL из агрегированных распределений; `poc_price=null` при отсутствии aggTrades (тест-контракт)
- [ ] 4.2 **M1.2b:** Footprint внутри свечей KLineCharts (влить `FootprintClusters.jsx` в полотно); stacked_imbalance, absorption метрики
- [ ] 4.3 **M6.2a:** слои-тумблы графика: TPO Profile, Liquidations, Forecast Bands, Regime (часть есть — довести до SRS-набора)
- [ ] 4.4 **M6.2b:** под-панели CVD / OI / RSI синхронно; тултип сделки: entry reasons, exit trigger, fees, Fee Drag%, MFE, MAE, regime
- [ ] 4.5 Непрерывная WebGL-heatmap вместо дискретных полигонов

### 🧱 ФАЗА 5 — Risk Manager: M4.1/M4.2/M4.3 (крупнейший SRS-гэп)
- [ ] 5.1 **M4.2a:** Position Sizer поверх execution_simulator (без его изменения): Fixed Fractional (есть), Budgeted DCA-лестница (суммарный риск ≤1%), Max Portfolio Heat
- [ ] 5.2 **M4.2b:** Signal Quality Multiplier по Confluence Score (0.5–1.2×) — потребитель Фазы 3.1
- [ ] 5.3 **M4.2c:** Compounding-профиль со строгим дневным DD-лимитом
- [ ] 5.4 **M4.3:** многоуровневый kill switch (−3%/−5%/−10%/$) с эскалацией и разблокировкой
- [ ] 5.5 **M4.1:** Hedge Mode (Long+Short по разным суб-стратегиям) — отдельные суб-кошельки маржи
- [ ] 5.6 Валидация всего M4 на марафоне Фазы 1 (сравнение sizing-режимов)

### 🤖 ФАЗА 6 — AI & Quant Sweep: M5 + M6.4
- [ ] 6.1 **M5.1:** Quant Sweep leaderboard Top 1–10 (net expectancy, PF, drawdown) как артефакт отчёта
- [ ] 6.2 **M5.2:** «Apply Strategy #X» в AI Copilot в 1 клик (инъекция параметров в форму); AI строго advisory
- [ ] 6.3 **M6.4:** help-tooltips (?) на каждый параметр форм; plain-language подсказки
- [ ] 6.4 Модуляризация по MODULARIZATION_PLAN (сильная модель, golden-тесты); PDF/HTML отчёт бэктеста
- [ ] 6.5 PDF-отчёт: equity, Monte-Carlo, тепловая карта по дням/часам

### 🚀 ФАЗА 7 — Продукт (после успешного марафона; деплой ОТЛОЖЕН — решение Di 2026-10-22: перенос на сервер только когда проект полностью функционален; всё работает локально на этой машине 24/7)
- [ ] 7.1 ⏸ **Деплой (Proxmox/Docker, DEPLOY.md), Cloudflare Tunnel** — отложен до готовности проекта; до тех пор run_app.ps1 + не выключать машину
- [ ] 7.2 Алерты наружу: Telegram-расширения, web-push, Warning Sentinel
- [ ] 7.3 Дневник трейдера v2: связка paper-сделок с decision_logs, пост-сессионный разбор
- [ ] 7.4 Решение Di о горизонте: остаёмся консультативными / read-only кабинет

---

## 3. Правила исполнения (для агентов)
1. Одна фаза = одна сессия, ветка `agent/<инструмент>/<фаза>`; модель по AGENTS.md §4.
2. Старт фазы: HANDOFF + `git status` + `check.ps1` (шаг 0 теперь ловит двойной backend). Финал: отчёт по шаблону AGENTS.md §7 + HANDOFF.
3. Каждый пункт, трогающий деньги/риск/исполнение (M3, M4, M2.5) — сначала тесты, потом код.
4. Пункты с пометкой SRS — приёмка строго по формулировке SRS; расхождение → в «Решения Di».
5. Вести SDD-леджер: `.superpowers/sdd/<план>/progress.md` по образцу 2026-10-21-paper-telemetry-data-truth.

## 4. Решения Di (журнал правок роадмапа)

### [2026-10-22] Решение D1 — локальный режим, без сервера
> «пока что деплоить на сервере не будем, всё будет работать локально на этой машине, только после того как проект будет готов и будет полностью функционален мы его перенесем на сервер, а пока что тут я просто не буду выключать эту машину» — Di

**Последствия в роадмапе:**
- Фаза 2.1 переключена на локальный приём recorder (48 ч параллельного прогона на этой машине).
- Фаза 7.1 (деплой) заморожена до полной готовности; эксплуатация — через `run_app.ps1`, машина не выключается.
- Recorder, Night Pilot, paper-марафон и накопление L2-lake идут локально; лимит lake 50 GiB остаётся актуальным (следить за диском). 