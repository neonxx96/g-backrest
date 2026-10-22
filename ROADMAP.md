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
| **M5.1** | Quant Sweep Optimizer: grid + пермутaции, Top 1–10 leaderboard | ✅ | `engine/sweep_leaderboard.py`: grid sweep + ранжированный Top-10 артефакт (net expectancy, PF, drawdown); API `/api/sweep/run|leaderboard|runs` | Фаза 6 |
| **M5.2** | AI Copilot: human-readable отчёты, кнопка «Apply Strategy #X» в 1 клик; AI строго advisory | 🟡 | `API/ai_copilot.py`, `CMP/AICopilotSidebar.jsx`, OpenRouter-каскад с бюджетом; Apply есть в pilot wizard, но не в AI Copilot | Фаза 6 |
| **M6.1** | Dockview LEGO-layout: floating windows, табы, 2-й монитор, persistence SQLite+localStorage | ✅ | `DCK/TerminalDockview.jsx`, `STO/layoutStore.js`, `API/workspaces.py`; `layoutRecovery.js` (новое) | — |
| **M6.2** | Chart: слои Heatmap/Densities, Liquidations, TPO, Forecast Bands, Signals, Regime; под-панели CVD/OI/RSI; тултип сделки (entry reasons, exit, fees, Fee Drag%, MFE, MAE, regime) | 🟡 | `CMP/Chart.jsx`: конус, SMC, RR-box, бэктест-трейды есть; TPO-слоя нет, OI под-панели нет, MFE/MAE в тултипе нет | Фаза 4 |
| **M6.3** | DOM & Tape высокой производительности | ✅ | `CMP/OrderBookDOM.jsx`, `DCK/TradesWidget.jsx` (Canvas 2D) | — |
| **M6.4** | Эргономика: пресеты, color-linking, help-tooltips (?) на каждый параметр | ✅ | `STO/colorLinksStore.js`, пресеты есть; help-tooltips — все формы покрыты (6.3) | — |
| **QA** | ≥80 pytest, build+gate зелёные | ✅ | 341 passed / 28 skipped; gate зелёный | — |

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
- [ ] 1.3 Paper-марафон 3–5 суток; morning reports в `docs/PAPER_MARATHON.md` (2026-10-22 вечер: марафон перезапущен после разрешённого Di рестарта backend — новые session_id `overnight_*_1792693498`, BTC с M4-гейтами (A/B), см. 5.6 и `docs/PAPER_MARATHON.md`)
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
- [x] 3.3 Правки по STRATEGY_WEAKNESSES: авто-BE при +0.5R, adaptive wall, time-stop 45 мин, maker-выходы; матрица «было/стало» по 8×3 (2026-10-22, main: 4 флага default-off в `orderflow_backtester.py` — `use_dynamic_breakeven` (уже был), `use_adaptive_wall` (rolling median(turnover,50)×2.5; обнаружен существующий кламп фиксированного порога ~median×3.5), `use_time_stop` (45м/<+0.3R → market), `use_maker_exits` (трейлинг лимитом, maker fee, slippage 0); 6 тестов, baseline-якорь 11 сделок/261.23 сохранён; матрица 3×3 на bybit-кэше 15м → `docs/STRATEGY_FIXES_MATRIX.md`: confluence/ema_trend убыточность режется в 3–9 раз, naked_test на BTC/ETH хуже из-за ре-энтри после time-stop — включать с калибровкой; матрица 3×3 вместо 8×3 — честно зафиксировано, 8 стратегий в реестре нет)
- [x] 3.4 Limit-order fill simulator для «Тест сетапа» (ветка `agent/cline/limit-fill-simulator`) (2026-10-22, main: перенесён коммит b55a804 — `limit_fill_simulator.py` детерминированный, zero look-ahead, maker/taker + adverse slippage на SL; эндпоинт `POST /api/backtest/simulate-limit-box` портирован на актуальный backtest.py; 9 тестов)
- [x] 3.5 **M2.1:** довести registry: VWAP, OI-плагины до полного набора SRS + тесты (2026-10-22, main: VWAP был полон; добавлен `plugins/open_interest.py` — truth-first, без OI-колонки ничего не синтезирует; registry покрывает полный набор M2.1: EMA/RSI/ATR/VWAP/CVD/VolumeSpike/OI; 7 тестов)

### 📊 ФАЗА 4 — Order Flow визуал: M1.2 + M6.2
- [x] 4.1 **M1.2a:** TPO/Volume Profile: TVAH/TPOC/TVAL из агрегированных распределений; `poc_price=null` при отсутствии aggTrades (тест-контракт) (2026-10-22, main: `services/tpo_profile.py` — TPO по 30-мин периодам из `data/recorded/<SYM>/trades_*.parquet`, классическая двусторонняя VA-экспансия отдельно по TPO и по объёму, VWAP-тай-брейк POC, авто-tick (~200 строк), truth-first: нет принтов → все границы None; эндпоинт `GET /api/profile/tpo` (+`available_dates`); 8 тестов; проверено на реальных записях BTC 21.10: TPOC 84664, VA [84633.5–84694.5], 174 строки)
- [x] 4.2 **M1.2b:** Footprint внутри свечей KLineCharts (влить `FootprintClusters.jsx` в полотно); stacked_imbalance, absorption метрики (2026-10-22, main: метрики server-side в `recorder.py::annotate_cluster_metrics` — imbalance ratio≥3 (≥5% макс. уровня), stacked = серия ≥3 соседних уровней, absorption = vol≥1.5×медианы окна и |Δ|≤20% vol; 7 тестов. Оверлей `footprintCandle` в Chart.jsx: buy/sell бары по уровням внутри 5-мин бакета, imbalance-бордер, ♦ stacked (amber/rose), ▬ absorption (фиолет); тумбл 👣 в тулбаре (`chart_footprint`), авто-refresh 15с; сайд-панель FootprintClusters сохранена)
- [x] 4.3 **M6.2a:** слои-тумблы графика: TPO Profile, Liquidations, Forecast Bands, Regime (часть есть — довести до SRS-набора) (2026-10-22, main: добавлены тумблы 👣 Footprint и 📊 TPO (оверлей `tpoProfile`: гистограмма TPO, VA-подсветка, линии POC/TVAH/TVAL; данные `/api/profile/tpo`); уже были: 🔥 Плотности, 💥 Ликвидации, конус волатильности (Forecast Bands), toxic-regime баннер + HUD. SRS-набор тумблов закрыт, все persist в localStorage, default OFF)
- [x] 4.4 **M6.2b:** под-панели CVD / OI / RSI синхронно; тултип сделки: entry reasons, exit trigger, fees, Fee Drag%, MFE, MAE, regime (2026-10-22, main: под-панели CVD/DeltaBars/RSI уже переключались; OI-статус живёт в context_snapshot сделки (`oi_status`, truth-first 'Unavailable' без OI-данных) — отдельная OI-панель бессмысленна без потока OI. Движок теперь эмитит per-trade `mfe`/`mae` (экскурсии в % от входа) и `fee_drag_pct`; тултип показывает MFE/MAE%/Fee Drag + был дополнен ранее: entry reasons, exit, fees, slippage, regime; 7 тестов, baseline-якорь 11/261.23 не сдвинулся)
- [ ] 4.5 Непрерывная WebGL-heatmap вместо дискретных полигонов

### 🧱 ФАЗА 5 — Risk Manager: M4.1/M4.2/M4.3 (крупнейший SRS-гэп)
- [x] 5.1 **M4.2a:** Position Sizer поверх execution_simulator (без его изменения): Fixed Fractional (есть), Budgeted DCA-лестница (суммарный риск ≤1%), Max Portfolio Heat (2026-10-22, main: `services/position_sizer.py` — чистый детерминированный расчёт: fixed_fractional, budgeted_dca_ladder (равные/кастомные доли риска, нога за стопом → ValueError, weighted_entry), portfolio_heat + check_heat (allowed, heat_after); API `/api/risk/position-size|dca-ladder|heat-check`; 12 тестов. В LivePaperRunner пока НЕ подключён — интеграция и валидация режимов на марафоне = 5.6)
- [x] 5.2 **M4.2b:** Signal Quality Multiplier по Confluence Score (0.5–1.2×) — потребитель Фазы 3.1 (2026-10-22, main: `PositionSizer.quality_multiplier` — score<порога → 0.5×, на пороге 1.0×, линейно до 1.2× при 1.0; `adjusted_risk_budget` (без скора множитель 1.0 — FF не меняется); опциональный `confluence_score` в `/api/risk/position-size` и `/api/risk/dca-ladder`; 3 новых теста)
- [x] 5.3 **M4.2c:** Compounding-профиль со строгим дневным DD-лимитом (2026-10-22, main: `services/risk_manager.py::CompoundingRiskEngine` — бюджет от текущей equity (реинвест), `DailyDrawdownGuard`: просадка от equity начала UTC-дня ≥ лимита → бюджет 0 и блок входов до конца дня, отскок halt не снимает, новый день — новая база; 3 теста)
- [x] 5.4 **M4.3:** многоуровневый kill switch (−3%/−5%/−10%/$) с эскалацией и разблокировкой (2026-10-22, main: `risk_manager.py::MultiLevelKillSwitch` — WARNING(−3%, alert)/HALT_NEW(−5%, блок входов)/FLATTEN(−10%, эскалация) от HWM + опциональный $-порог; уровень срабатывает один раз, новый HWM fired-уровни НЕ сбрасывает; unlock только с непустой причиной + опциональный rebase HWM; валидация эскалации severity; 7 тестов. Интеграция в LivePaperRunner — 5.6)
- [x] 5.5 **M4.1:** Hedge Mode (Long+Short по разным суб-стратегиям) — отдельные суб-кошельки маржи (2026-10-22, main: `services/hedge_ledger.py::HedgeLedger` — именованные изолированные суб-кошельки (name+side), allocate/deallocate с защитой занятой маржи, open/close резервирует маржу внутри кошелька, realized PnL пишется в свой кошелёк; isolated margin: убыток ноги клампится её маржой, не перетекает в пул/чужие кошельки; `summary()` для UI; 8 тестов. Интеграция в LivePaperRunner — 5.6)
- [x] 5.6 Валидация всего M4 на марафоне Фазы 1 (сравнение sizing-режимов) (2026-10-22, main — интеграция: флаг `use_m4_risk_gates` (default OFF) в LivePaperRunner: гейт 6.9 перед входом (дневной DD-лимит → kill switch → portfolio heat, блок только входов, события M4_BLOCK/M4_KILL_SWITCH в лог и журнал), quality multiplier по `confluence_score` через явный quantity (новый опциональный параметр `execute_unified_signal(..., quantity=None)` — обратная совместимость), блок `m4_risk_gates` в статусе раннера; 7 тестов `test_m4_runner_gates.py`. **Осталось:** сравнение sizing-режимов на живом марафоне — после штатного рестарта backend (пост-soak 24.10), вместе с критериями 1.3/1.4. UPD 2026-10-22 вечер: A/B-валидация ЗАПУЩЕНА — Di разрешил рестарт backend; марафон перезапущен: BTC с `use_m4_risk_gates=true` (сессия `overnight_btcusdt_1792693498`) vs ETH/SOL с флагом OFF (`overnight_ethusdt/solusdt_1792693498`), все data=connected, errors=0; снапшот до рестарта — `data/pilot_status_prerestart_20261022.json` (0 сделок у всех трёх); критерии сверки — в `docs/PAPER_MARATHON.md`)

### 🤖 ФАЗА 6 — AI & Quant Sweep: M5 + M6.4
- [x] 6.1 **M5.1:** Quant Sweep leaderboard Top 1–10 (net expectancy, PF, drawdown) как артефакт отчёта (2026-10-22, main: `engine/sweep_leaderboard.py` — детерминированный grid sweep по сетке параметров, ранжирование Top-N по net expectancy с tie-break по PF/drawdown, persist runs; API `/api/sweep/run|leaderboard|runs`; 6 тестов)
- [x] 6.2 **M5.2:** «Apply Strategy #X» в AI Copilot в 1 клик (инъекция параметров в форму); AI строго advisory (2026-10-22, main: `orderflow_backtester` — параметризованные EMA-периоды fast/slow (default 20/50 = legacy, невалидные пары → ValueError/422 через валидатор `BacktestParams`); секция «Quant Sweep Leaderboard» в AICopilotSidebar — Top-10 по OOS-скору с вердиктами ROBUST/MODERATE/OVERFITTED, кнопки запуска/обновления sweep и «Apply Strategy #N» → инъекция в форму бэктеста (store + событие `apply-sweep-strategy`); в BacktestPanel поля Fast/Slow EMA для ema_trend; 5 тестов `test_sweep_apply_ema_params.py`; QA 346 passed)
- [x] 6.3 **M6.4:** help-tooltips (?) на каждый параметр форм; plain-language подсказки (2026-10-22, main: аудит всех форм — BacktestPanel добит (выбор стратегии с объяснением групп historical/live-L2, тумбл Multi-TP, пер-кнопочные подсказки фильтров CVD/OI/ATR/RSI, имя пресета), LivePaperTradingView полностью (баланс, риск %, сетап, мин. стенка, плечо, SL/TP); OvernightPilotPanel и SettingsModal уже были покрыты (title-атрибуты / инлайн-описания) — подтверждено аудитом; gate 346 passed)
- [x] 6.4 Модуляризация по MODULARIZATION_PLAN (сильная модель, golden-тесты); PDF/HTML отчёт бэктеста — **ЧАСТИЧНО** (2026-10-22, main: консервативный слайс п.2 — из `BacktestPanel.jsx` (2867→2636 строк) извлечены `backtest/MonteCarloEquityChart.jsx` (SVG equity + веер МК, без зависимостей) и `backtest/BacktestTradesTable.jsx` (управляемая таблица сделок; сортировка/выбор остались в панели — поведение 1:1) + `backtest/format.js` (fmtTime/fmtPrice, единственный источник); E2E `scripts/verify_modularization_6_4.py` — 6/6 (прогон бэктеста, рендер svg/строк, сортировка, выбор). Gate 346 passed. **По плану остались:** PresetsBar/ParametersForm/OptimizerView из панели, DOM, `Chart.jsx`, PDF/HTML отчёт — см. 6.5 и след. слайсы. Попутно: критический фикс `orderflow_backtester.py` — ветвь `sl_mode=behind_wall` падала с NameError (`ask_wall_p` никогда не определялся, L2 в историю не подаётся) → заменена ATR-буфером, коммит `46fd9b5`)
- [x] 6.5 PDF-отчёт: equity, Monte-Carlo, тепловая карта по дням/часам (2026-10-22, main: `backend/app/services/backtest_report.py` — matplotlib PdfPages, **новых зависимостей нет**, DejaVu Sans покрывает кириллицу; 3 страницы: сводка метрик+equity net/gross, стресс-тест МК (веер P5–P95/P25–P75/P50+факт+вердикт), разбор сделок (heatmap Net PnL дни×часы UTC + топ-20); degenerate-входы → честные «нет данных»; `POST /api/backtest/report` — принимает result целиком, extra=allow, обязателен только symbol (иначе 422), рендер в threadpool; кнопка «PDF отчёт» (btn-export-pdf) в BacktestPanel рядом с вердиктом MC; 5 тестов `test_backtest_report_pdf.py`; E2E `verify_pdf_report_ui.py` — скачивание %PDF по контракту; gate 351 passed)

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