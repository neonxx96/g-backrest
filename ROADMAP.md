# 🗺️ ROADMAP SignalScript — мастер-план развития приложения

> **Версия:** 1.0 (черновик для правки Di)  
> **Дата:** 2026-10-22  
> **Автор:** новый агент (ревью кодовой базы, HANDOFF, QA-аудитов и плановых документов)  
> **Статус:** 🟡 НА РЕДАКТИРОВАНИИ — Di правит приоритеты/состав, агент потом исполняет

---

## 0. Контекст: что это за проект и какие инварианты неприкосновенны

**SignalScript** — консультативный крипто-фьючерсный терминал (Binance USDT-M): график KLineCharts, живой стакан L2, лента сделок, скринер, честный бэктестер, paper-симулятор (Night Pilot), AI-второе мнение (OpenRouter-каскад с бюджетом), standalone market-data recorder в immutable data lake.

**Инварианты (менять только с согласия Di):**
1. **Строго консультативно.** Никаких реальных ордеров, ключей, автоторговли.
2. **Zero bullshit data.** Никаких `Math.random()` в рыночных данных; при обрыве — честный `disconnected` и реконнект.
3. **Zero look-ahead.** Никакой аналитике нельзя заглядывать в будущие бары.
4. **Порты:** backend `8000`, frontend `5173` (сейчас введён dynamic binding — см. риск R2), SQLite `data/signals.db`.
5. **Единый шлюз качества:** перед любым коммитом — `scripts/check.ps1` зелёный.
6. **Файлы-гиганты** (`Chart.jsx`, `BacktestPanel.jsx`, `orderflow_backtester.py`, `OrderBookDOM.jsx`) не дробить «заодно» — только по `docs/MODULARIZATION_PLAN.md` и под зелёными тестами.

---

## 1. Текущее состояние (факт, подтверждённый проверкой 2026-10-22)

| Проверка | Результат |
|---|---|
| `pytest backend/tests` | ✅ **212 passed, 28 skipped** |
| Фронтенд `http://127.0.0.1:5173` | ✅ жив (HTTP 200) |
| Backend runtime (dynamic port `8002` по `data/backend_runtime.json`) | ✅ `/api/health` = ok, WS connected, 150 символов |
| Ветка / рабочее дерево | ⚠️ `agent/codex/recorder`, **17 изменённых файлов не закоммичены** + untracked (в т.ч. чужие/частичные работы) |
| Gate `check.ps1` (полный) | 🟡 не гонялся этой сессией; последний подтверждённый PASS — 137 passed (2026-10-20, HANDOFF) |

### Что реально сделано и работает
- **Терминал:** график + 12 оверлеев (SMC, Risk/Reward, конус волатильности, бэктест-трейды), DOM Canvas 2D со спуф-детектором, лента сделок со звуком, скринер со спарклайнами, dockview-раскладки с сохранением, 3 темы.
- **Честный бэктест:** execution simulator (комиссии Maker/Taker, slippage, multi-TP, BE/trailing), золотые тесты, walk-forward + OOS/holdout в оптимизаторе, RegimeClassifier (FLAT_DENSE / TREND_IMPULSE / TOXIC_VOLATILITY), truth-контракт (`data_availability`, отдельные entry/exit reasons).
- **Paper Trading:** `LivePaperRunner`, Overnight Pilot (wizard: конфигурация → checks → оптимизация → запуск), run-scoped телеметрия (JSONL deep intent log), feed-health, kill-switch, NO_TRADE-диагностика, morning report (Backtest/Forecast/Paper раздельно).
- **AI-контур:** OpenRouter-каскад (платный → free → локальный fallback), дневной бюджет, модель-хаб с кешем, телеметрия стоимости, «второе мнение» с фактологическим промптом.
- **Recorder S1 (новый):** отдельный процесс, канонический envelope, Binance-нормализаторы (aggressor side!), fsync spool, immutable zstd Parquet + SHA-256 манифесты, gap-журнал, 50 GiB disk policy, CLI `run|status`, Docker-файлы. Покрыт тестами.
- **Документация/процесс:** AGENTS.md, HANDOFF.md, DECISIONS.md, QA_BUGS_AUDIT, MODULARIZATION_PLAN, superpowers specs/plans — живые и актуальные.

### Известные проблемы (честный список)
- **R1. Dirty tree.** 17 modified + untracked файлов без коммита; смешанное владение (Antigravity-правки + recorder-ветка). Риск потерять работу или закоммитить чужое.
- **R2. Два backend-процесса** (старый listener на `8000` PID 57480 и новый runtime `8002`). Рассинхрон API, путаница в CLI/скриптах.
- **R3. Recorder не задеплоен** на сервер (нет SSH/Docker target). Старый recorder с дырами (gap 5ч50м 19.10, ETH depth 18ч40м 17–18.10) всё ещё единственный источник истории.
- **R4. Все стратегии в квантовом свипе (7 дней) — net-negative** (STRATEGY_WEAKNESSES_AND_UPGRADES.md): fee drag 118–2481% от gross PnL, MFE bleed до 31%, серии до 15 лоссов. План правок (BE@0.5R, adaptive wall, time-stop, maker-выходы) описан, пресет `production_robust` — не внедрён (следующий шаг из AI_HANDOFF).
- **R5. Ночной пилот на старом коде:** runtime `8002` не перезапускался, новые поля/телеметрия появятся только после штатного рестарта.
- **R6. QA-аудит показывал 404 `/api/monitoring/state`** (19.10; роутер `monitoring.py` уже есть — проверить, закрыт ли дефект).
- **R7. Мусор в корне репо:** логи, скриншоты, `calibration_results.json`, `check_pilot.py`, `моя комора/` — гигиена репозитория.
- **R8. Открытые бэклоги из docs:** Volume Profile/TPO (0%), footprint внутри свечей (автономный компонент), непрерывная WebGL-heatmap, тиковый реплей-плеер, мультибиржевая агрегация, PDF/HTML-отчёт бэктеста, limit-order fill simulator для «Тест сетапа» (ветки `agent/cline/replay-engine`, `limit-fill-simulator`, `live-assistant`, `footprint-history` — судьба не зафиксирована).

---

## 2. РОАДМАП (правится Di; агент исполняет после утверждения)

### 🔧 ФАЗА 0 — Стабилизация и гигиена (1 сессия, перед всем остальным)
- [ ] **0.1 Разобрать рабочее дерево:** пройтись по 17 modified + untracked, закоммитить атомарно по владельцам/смыслу или откатить. Зафиксировать в HANDOFF, кто и что оставил.
- [ ] **0.2 Backend-слияние процессов:** штатно остановить старый listener `8000`, оставить один runtime (либо осознанно принять dynamic binding и обновить AGENTS.md/скрипты/доки — сейчас инвариант «строго 8000» противоречит коду).
- [ ] **0.3 Повторить полный `check.ps1`** и зафиксировать свежий бейзлайн (цель: зелёный + 212 тестов).
- [ ] **0.4 Гигиена репо:** логи/скриншоты/json-мусор → `artifacts/` или `.gitignore`; решить судьбу `context/qa`, `calibration_results.json`.
- [ ] **0.5 Закрыть R6:** проверить `/api/monitoring/state`, если 404 — починить + регрессионный тест.
- [ ] **0.6 Решение по веткам:** судьба `agent/cline/*` (replay-engine, limit-fill-simulator, live-assistant, footprint-history) — merge / доработать / закрыть. Тег `stable-20261022` после Фазы 0.

### 🌙 ФАЗА 1 — Paper Trading: от «работает» до «можно верить» (приоритет №1 по AI_HANDOFF)
- [ ] **1.1 Прессет `production_robust`:** vol_mult 1.25, RSI 42–58, R:R ≥ 2.75:1, TP ≥ 2.2%, SL 0.75–0.80% в `overnight_pilot.py` + тест.
- [ ] **1.2 CLI:** `night-pilot.ps1` — запуск production_robust на актуальном runtime для BTC/ETH/SOL; вывод WinRate/Net PnL по монетам, Warning Sentinel при блокировке входов.
- [ ] **1.3 Штатный рестарт runtime** (в окне без активных сессий): поднять новый код (run_id, телеметрия, feed-health, aggregate morning report).
- [ ] **1.4 Довести до коммита текущий telemetry-slice** (uncommitted changes в overnight_pilot/live_paper_runner) — он уже протестирован, надо закрыть.
- [ ] **1.5 Марафон paper-сессий:** ≥ 3–5 суток непрерывного прогона по 3+ монетам; ежедневные morning reports; сводная таблица в `docs/PAPER_MARATHON.md`.
- [ ] **1.6 Критерии перехода к Фазе 3 (Di утверждает пороги):** profit factor ≥ 1.2, max DD ≤ X%, fee drag < Y% от gross, отсутствие инцидентов data-truth.

### 📦 ФАЗА 2 — Recorder в продакшен + честный L2-бэктест
- [ ] **2.1 Деплой:** получить от Di SSH/Docker target (hostname/IP, user, port) или Docker context; remote build/up `Dockerfile.recorder` + compose; smoke/status.
- [ ] **2.2 Параллельная эксплуатация:** новый recorder ≥ 48 ч рядом со старым; сверка gap-журнала; только потом старый recorder выключить (решение 9 из DECISIONS.md).
- [ ] **2.3 Replay-плеер:** восстановить/интегрировать `agent/cline/replay-engine` поверх нового lake: Play/Pause/Step/скорость, стакан+лента в прошлом.
- [ ] **2.4 L2-honest стратегии:** после накопления ≥ 7 дней lake — реальный бэктест `density_bounce`/`wall_breakout` на исторических стаканах (убрать свечной суррогат), сравнение с суррогатной моделью.
- [ ] **2.5 Подпитка live-терминала:** heatmap/footprint читают из lake вместо старого recorder.

### ⚙️ ФАЗА 3 — Качество исполнения стратегий (квантовый контур)
- [ ] **3.1 Правки по STRATEGY_WEAKNESSES:** авто-BE при +0.5R; adaptive wall (`median(Volume*Close,50)*2.5`); time-stop 45 мин без +0.3R; лимитные maker-выходы вместо taker-trailing.
- [ ] **3.2 Валидация каждой правки:** walk-forward + OOS + режимы RegimeClassifier; матрица «было/стало» по 8 монетам × 3 стратегиям (как в квантовом свипе).
- [ ] **3.3 Limit-order fill simulator:** «Тест сетапа» в HUD проверяет одиночный лимитный ордер по цене entry (ветка `agent/cline/limit-fill-simulator`), а не только стратегию за 14 дней.
- [ ] **3.4 Early-exit / live-assistant:** интегрировать `early_exit_engine`, `execution`-провайдеров из соответствующих веток, если Di подтверждает.

### 📊 ФАЗА 4 — Аналитический контур (глубина терминала)
- [ ] **4.1 Volume Profile / TPO:** дневной/сессионный профиль, VAH/VAL/POC оверлеем на графике.
- [ ] **4.2 Footprint в свечах:** встроить `FootprintClusters` в полотно KLineCharts (сейчас автономный компонент).
- [ ] **4.3 Непрерывная heatmap:** WebGL/2D-слой под свечами вместо дискретных полигонов.
- [ ] **4.4 Мультибиржа:** дожать `BybitAdapter` до live-режима (WS depth/trades), агрегированный кросс-биржевой стакан; OKX — по желанию Di.
- [ ] **4.5 CVD/OI подвалы:** мультибиржевая дельта, побарный график Open Interest.

### 🧹 ФАЗА 5 — Модуляризация и отчётность
- [ ] **5.1 По `docs/MODULARIZATION_PLAN.md`:** дробить файлы-гиганты строго по плану, сильной моделью, побитовые golden-тесты до/после. Порядок: `orderflow_backtester.py` → `BacktestPanel.jsx` → `OrderBookDOM.jsx` → `Chart.jsx` (рискованнее всего).
- [ ] **5.2 PDF/HTML отчёт бэктеста:** equity, Monte-Carlo просадки, тепловая карта доходности по дням/часам.
- [ ] **5.3 Перфоманс:** вынести парсинг WS-стакана с клиента (Web Worker или бэкенд-прокси нормализованных диффов 100–250 мс), если Фаза 1.5 покажет проблемы на длительной сессии.

### 🚀 ФАЗА 6 — Продуктовая обвязка (после успешного paper-марафона)
- [ ] **6.1 Деплой терминала:** Proxmox/Docker по `DEPLOY.md`, Cloudflare Tunnel, автообновление.
- [ ] **6.2 Алерты:** Telegram-расширения (сигналы сканера уже есть), web-push, Warning Sentinel наружу.
- [ ] **6.3 Дневник трейдера v2:** связка paper-сделок с ручными решениями из `decision_logs`, пост-сессионный разбор.
- [ ] **6.4 Решение о следующем горизонте** (Di): остаёмся консультативными / добавляем read-only биржевой кабинет (балансы, позиции без ключей с правами торговли) — строго без нарушения инварианта №1.

---

## 3. Правила игры для агентов, исполняющих роадмап
1. Одна фаза = одна сессия/ветка `agent/<инструмент>/<фаза>`, модель по таблице AGENTS.md §4.
2. Перед стартом фазы: `HANDOFF.md` + `git status` + `check.ps1`; после: отчёт по шаблону AGENTS.md §7 и обновление HANDOFF.
3. Не смешивать фазы в одном чате; контекст передаётся только через файлы.
4. Каждый пункт роадмапа, который трогает деньги/риск/исполнение, — сначала тесты, потом код.
5. Любое отклонение от роадмапа — фиксируется в этом файле (раздел «Решения Di» ниже).

## 4. Решения Di (журнал правок роадмапа)
- *пусто — сюда Di вносит правки, приоритеты, отмены пунктов*
