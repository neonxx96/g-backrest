# HANDOFF.md — Протокол передачи контекста между агентами

> Перед началом работы: прочитать `AGENTS.md` и этот файл, выполнить `git status`, затем запустить `powershell -ExecutionPolicy Bypass -File scripts/check.ps1`. Агенты работают строго последовательно.

## Kimi Work consolidation — 2026-10-22

- **Сделано:** консолидация в один backend. Остановлены оба прежних процесса (8000 PID 57480, 8002 PID 15608) и мусорный Vite 5177; запущен единый backend на **8000** (код main, aggregate morning report активен) и Vite 5173 с прокси на 8000. `.env` возвращён на `BACKEND_PORT=8000`.
- **Вскрыто и устранено:** 6 зомби-пар backend-процессов от 20.10 (12 PID, слушателей не имели, но поллили Telegram и грузили сканер/рекордер). Убиты; жив один логический instance (пара .venv-шим + интерпретатор — это норма, `uv`-venv запускает реальный python ребёнком).
- **Guards (пайплайн-русет против двойного backend):** `scripts/check.ps1` шаг 0 — gate падает при >1 логическом backend-процессе (считает instance roots, не OS-процессы); `run_app.ps1` пропускает запуск backend/frontend, если они уже живы; правило зафиксировано в AGENTS.md §6.
- **Сессии Night Pilot:** при рестарте backend восстановил 3 paper-снапшота от 20.10 (BTC/ETH/SOL, SOL realized -50.5) в статусе stale по Reload-контракту — это исторические записи, live-runner'ов нет.
- **Gate:** полный `check.ps1` после правок — PASS. См. также ROADMAP.md (Фаза 0) и CODEGRAPH.md.

## Codex continuation — 2026-10-20

- **ACTIVE_AGENT:** `codex`
- **Ветка:** `agent/codex/recorder`
- **Night Pilot:** заново запущены три paper-сессии на текущем runtime через `preflight → start`: BTCUSDT `overnight_btcusdt_1792521744`, ETHUSDT `overnight_ethusdt_1792521744`, SOLUSDT `overnight_solusdt_1792521744`; runtime-проверка: `Running=True`, `Data=connected`, `errors=0`, equity `$10000` каждая.
- **Live poll:** последующая read-only проверка подтвердила те же session_id, `forecast/paper=connected`, equity `$10000`, `errors=0`; `aggregate=False`, потому что порт `8000` обслуживает старый listener PID `57480`.
- **Проверка:** `scripts/check.ps1` — PASS: `133 passed, 26 skipped` из 159 собранных тестов, frontend build, 8/8 critical smoke, blocking UI smoke и live Binance WS smoke. Локальный socket smoke запускался с разрешением на localhost-доступ; без него Windows sandbox возвращает `WinError 10013`.
- **OOS optimizer:** генетический `/api/backtest/optimize` теперь ищет параметры только на chronological train-части (по умолчанию 70%) и отдельно прогоняет лучший набор на отложенной OOS-части; ответ содержит `oos.available`, границы времени, метрики и честный `warning` при малой выборке. BacktestPanel и OvernightPilotPanel показывают OOS явно как проверку, а не как часть подбора. Добавлены `test_genetic_optimizer_oos.py` (2 теста на отсутствие leakage и insufficient history).
- **Truthful market UI:** `ScreenerWidget.jsx` больше не строит синтетическую sparkline из 24h OHLC — до получения реальных Binance 1h klines показывается пустое состояние. В `OrderBookDOM.jsx` и `Tape.jsx` удалены случайные идентификаторы сделок; fallback-ключи теперь детерминированы по реальному payload.
- **UI smoke после truth-first правки:** production build PASS; blocking smoke PASS (13 canvas, chart/DOM видимы, переключение BTC→ETH, 0 console/page errors); live smoke PASS (Binance WS frames получены). Автоматический autostart-режим `check.ps1` в одной попытке завис на уже занятом/невидимом sandbox-порту 5173, поэтому smoke повторён с `--no-autostart` против чисто поднятого frontend.
- **Persistence E2E:** `scripts/test_stage2_frontend_isolation.py` PASS — per-symbol параметры BTC/SOL/LINK изолированы, восстановлены после F5, quick backtest для SOL прошёл (37 trades), console errors=0.
- **CLI fallback report:** `scripts/night-pilot.ps1 -Action report` теперь при старом backend без `aggregate` строит client-derived сводку из раздельных summary rows (Backtest / Forecast / Paper), не смешивая их и не подменяя отсутствующие данные нулями; server-native aggregate остаётся после штатного рестарта.
- **Последнее изменение:** добавлен раздельный агрегированный morning report в `OvernightPilotManager.status()` (`aggregate.backtest`, `aggregate.forecast`, `aggregate.paper`, `aggregate.data`, best/worst symbols) и отображение в `OvernightPilotPanel.jsx`; тест — `test_pilot_status_exposes_separate_aggregate_morning_report`.
- **Quality-gate anti-hang:** `scripts/check.ps1` проверяет локальные `/api/health` и frontend перед Playwright smoke; при уже работающих серверах передаёт `--no-autostart`, предотвращая второй Vite/backend и зависание на ожидании порта. Полный gate после правки: `133 passed, 26 skipped`, build, critical, blocking и live WS — PASS.
- **Legacy aggregate UI fallback:** `OvernightPilotPanel.jsx` теперь показывает client-derived сводку Backtest / Forecast / Paper с явной пометкой источника, если старый backend ещё не отдаёт `aggregate`; production build и полный gate после правки — PASS.
- **Fallback null safety:** client-derived Paper values теперь показывают `—` при отсутствии paper-данных, а не ложный `$0.00`; production build и `git diff --check` после правки — PASS.
- **Trade timeline readability:** последние backtest-сделки в `OvernightPilotPanel.jsx` теперь показывают локальные дату/время входа и выхода, длительность и `exit_reason`; targeted blocking UI smoke после правки — PASS.
- **Latest full gate:** после fallback/null-safety/timeline изменений повторно подтверждено `133 passed, 26 skipped`, frontend build, critical smoke, blocking UI smoke и live Binance WS — `ALL QUALITY CHECKS PASSED. READY TO COMMIT.`
- **Quant alignment:** forecast теперь создаёт `UnifiedTradeSignal` через `build_forecast_signal()` и сохраняет выбранные `leverage` и `risk_per_trade_pct`; регрессионный тест `test_forecast_signal_parameters_preserve_leverage_and_risk` зелёный.
- **Night Pilot CLI guard:** `scripts/night-pilot.ps1 start` теперь отклоняет частично запущенный пилот, а `preflight` отклоняет сессию без backtest или forecast.
- **Paper accounting visibility:** `LivePaperRunner.get_status()` теперь публикует `available_margin`, `used_margin` и `funding_rate`; `LivePaperTradingView.jsx` и `OvernightPilotPanel.jsx` их отображают. Текущий backend-процесс загружен до этой правки, поэтому runtime-поля появятся после следующего рестарта.
- **Backtest readability:** `OvernightPilotPanel.jsx` теперь показывает последние 5 исторических сделок с направлением, входом, выходом, длительностью и PnL, используя реальные `entry_time/exit_time` и `exit_reason`.
- **Paper morning report:** `OvernightPilotManager.status()` и `OvernightPilotPanel.jsx` теперь отдельно считают и показывают paper win rate, profit factor, среднюю, лучшую и худшую закрытую сделку; добавлен регрессионный тест `test_pilot_morning_report_exposes_paper_trade_quality`.
- **Forecast regime:** `compute_probabilistic_forecast()` теперь возвращает общий `market_regime` и `regime_metrics` из `RegimeClassifier` (`FLAT_DENSE`, `TREND_IMPULSE`, `TOXIC_VOLATILITY`); карточка forecast показывает режим, добавлен контрактный тест `test_forecast_regime_contract_exposes_classifier_label_and_metrics`.
- **Reload contract:** добавлен тест `test_restore_rehydrates_snapshot_as_stale_and_keeps_session_id`, фиксирующий восстановление persisted backtest/forecast/paper snapshot с тем же `session_id` и честным статусом `stale` после backend restart.
- **Risk sizing correction:** исправлена критичная формула в `OrderFlowBacktester`: при заданном `risk_per_trade_pct` абсолютная дистанция SL сначала переводится в долю цены, затем рассчитывается quote-notional. Ранее позиции были примерно в 100 раз меньше на дорогих инструментах; добавлен `test_explicit_risk_budget_sizes_notional_instead_of_base_units`.
- **Paper leverage parity:** `PaperTradingSession` теперь учитывает leverage в ограничении размера позиции и блокировке/освобождении маржи, а `UnifiedTradeSignal` и `LivePaperRunner` прокидывают выбранное плечо в симулятор; добавлен `test_position_sizing_uses_leverage_only_for_margin_cap`. PnL не умножается на плечо, leverage влияет на требуемую маржу.
- **Paper journal visibility:** `OvernightPilotPanel.jsx` теперь отдельно показывает закрытые paper-сделки и открытые виртуальные позиции: время входа/выхода, длительность, цены, PnL и причины. `OvernightPilotManager.status()` дополнительно заполняет Entry/SL/TP1/TP2/BE в summary из `trading_idea`, если их нет в `base_scenario`; добавлен `test_pilot_summary_uses_trading_idea_levels_when_forecast_has_no_base_levels`.
- **ROI precision:** Night Pilot пересчитывает `backtest_roi_pct` из net PnL и стартового капитала с точностью 4 знака, чтобы малые результаты не отображались как `0.0%`; CLI и панель показывают до 3 знаков. Добавлен `test_pilot_summary_keeps_small_backtest_roi_visible`.
- **Morning report risk/losses:** aggregate paper report теперь включает средний риск по конфигурациям и последние причины убыточных сделок; если старый snapshot не содержит `average_risk_pct`, используется риск из сохранённого config. Панель отображает `Risk` и `Loss reasons`.
- **NO_TRADE diagnostics:** `OrderFlowBacktester.explain_latest_signal()` объясняет, какие проверки не прошёл последний полностью сформированный бар, не меняя правила входа; `LivePaperRunner.get_status()` публикует `last_decision_reason`, `last_decision_checks` и время решения. `OvernightPilotPanel.jsx` показывает причину ожидания рядом с каждой paper-сессией; добавлены целевой тест и контракт статуса. Уже запущенный ночной процесс потребует штатного рестарта, чтобы начать публиковать новые поля.
- **Night report clarity:** сводка `OvernightPilotPanel.jsx` и `scripts/night-pilot.ps1` теперь отдельно показывают `Forecast NO_TRADE` и `Paper no-entry`, а также paper PnL и последнюю причину решения; эти поля прокинуты в строки агрегированного статуса.
- **Think optimizer alignment:** `POST /api/quant/think-optimize` теперь передаёт в существующий `/api/backtest/optimize` текущие настройки стратегии и фильтры, включая алиасы пользовательских полей `stop_loss_pct`, `take_profit_pct` и `min_density_usd`; неизвестные поля отбрасываются. Добавлен контрактный тест `test_think_optimize_forwards_current_strategy_settings_to_existing_optimizer`.
- **Think optimizer UI:** в каждой карточке `OvernightPilotPanel.jsx` добавлена кнопка запуска pre-run оптимизации по выбранной стратегии; результат показывает Before/After, SL/TP/Wall и явно сообщает, что параметры не применяются автоматически.
- **Safe optimizer apply:** результат optimizer теперь можно применить только к конфигурации следующего запуска; при активной paper-сессии кнопка заблокирована и настройки текущего runner не изменяются. После применения UI просит повторить preflight.
- **Forecast diagnostics:** `compute_probabilistic_forecast()` теперь возвращает `decision_diagnostic` с `failed_checks`, `observed` и объяснением `NO_TRADE`; карточка forecast показывает непройденные фильтры рядом с причиной ожидания. Полный gate после правки: `130 passed, 26 skipped`.
- **Morning forecast reasons:** aggregate-отчёт Night Pilot теперь содержит `forecast.no_trade_reasons` по символам и отображает их в блоке Live Forecast; добавлен регрессионный тест.
- **Paper countdown:** `LivePaperRunner.get_status()` публикует `started_at` и `duration_remaining_seconds`; карточка Night Pilot показывает оставшееся время до автоматической остановки. Контракт статуса покрыт тестом.
- **Restart guard:** backend отклоняет `start/preflight`, если хотя бы одна paper-сессия уже работает; UI блокирует эти кнопки и оставляет явную кнопку остановки. Добавлен тест `_has_running_sessions()`.
- **Strategy selector:** карточки Night Pilot теперь позволяют выбрать одну из трёх стратегий, поддержанных одновременно историческим backtest и live paper runner; смена сохраняется в конфигурации и применяется только после нового preflight.
- **Morning report CLI:** `scripts/night-pilot.ps1 -Action report` добавляет read-only сводку Backtest / Forecast / Paper с причинами `NO_TRADE` и потерями; старый backend без aggregate не маскирует данные нулями, а выводит честное предупреждение до рестарта.
- **Важно:** backend не перезапускать во время ночного теста без необходимости. Текущий процесс был запущен до добавления aggregate-контракта; новый ключ появится после следующего штатного рестарта.
- **Dynamic runtime binding:** `backend/main.py` теперь выбирает первый свободный TCP-порт начиная с `BACKEND_PORT`, сохраняет активный endpoint в `.env` (`BACKEND_PORT` и `VITE_BACKEND_PORT`) и `data/backend_runtime.json`; `frontend/vite.config.js` читает этот порт для proxy. Старый backend на `8000` не прерывается. Проверено: новый backend на `8002` отдаёт native aggregate, Vite proxy на `5177` возвращает `status=ok`, `aggregate=true`.
- **Dynamic binding tests:** добавлен `backend/tests/test_runtime_binding.py`; после изменения полный gate — `135 passed, 26 skipped`, frontend build, critical, blocking и live WS smoke — PASS.
- **Dynamic CLI discovery:** `scripts/night-pilot.ps1` без `-ApiBase` теперь читает `data/backend_runtime.json` и обращается к актуальному backend (проверено на `8002`); явный `-ApiBase` сохранён для диагностики старого runtime.
- **Paper ranking guard:** агрегированный morning report теперь передаёт `paper_closed_trades` по каждой сессии и не назначает `best_paper_symbol` / `worst_paper_symbol`, пока нет закрытых paper-сделок; открытая позиция и unrealized equity не считаются закрытым результатом. Targeted: `12 passed, 4 skipped`; полный gate после правки: `137 passed, 26 skipped`, build, critical, blocking UI и live WS — PASS. Уже работающий runtime `8002` не перезапускался, чтобы не прерывать ночной тест.
- **Open paper position clarity:** `OvernightPilotPanel.jsx` в журнале paper теперь показывает для открытой позиции entry→current, длительность, SL, TP1/TP2, состояние BE, qty и unrealized PnL; полный gate после правки: `137 passed, 26 skipped`, build, critical, blocking UI и live WS — PASS. Backend runtime во время ночного теста не перезапускался.
- **Aggregate drawdown correctness:** morning report нормализует legacy negative drawdown snapshots и считает worst-case `Max DD` по независимым backtest/paper-сессиям вместо ошибочного `0%`; добавлены assertions в `test_overnight_pilot.py`. Полный gate: `137 passed, 26 skipped`, build, critical, blocking UI и live WS — PASS.
- **Realized vs floating clarity:** summary и aggregate теперь отдельно публикуют `paper_unrealized_pnl` / `unrealized_pnl_usd`; UI подписывает `Realized PnL`, `Floating` и `Equity`, чтобы открытая позиция не выглядела как закрытая прибыль. Полный gate: `137 passed, 26 skipped`, build, critical, blocking UI и live WS — PASS. Runtime `8002` не перезапускался во время ночного теста.
- **Legacy runtime floating fallback:** `OvernightPilotPanel.jsx` вычисляет Floating PnL из `Equity - Starting balance - Realized PnL`, если старый backend ещё не отдаёт `unrealized_pnl`; текущий тест теперь показывает плавающий результат без рестарта. Полный gate: `137 passed, 26 skipped`, build, critical, blocking UI и live WS — PASS.

## 🚦 Текущий статус

- **ACTIVE_AGENT:** `none`
- **Текущая ветка:** `agent/antigravity/paper-trading-openrouter`
- **Последняя подтверждённая полная проверка:** `2026-10-20`, `scripts/check.ps1` — **PASS**: 103/103 pytest, frontend production build, 8/8 critical API smoke, blocking и live Playwright smoke (`ALL QUALITY CHECKS PASSED. READY TO COMMIT.`).

## ✅ Подтверждённое состояние

1. **Честное разделение бэктеста и симулятора:**
   - **Historical OHLCV Backtest:** в режиме истории скрыты L2-фильтры стакана (стенки и время жизни), выводятся честный информационный баннер и свечные индикаторы (ATR, RSI, поглощение объёма Price Action). Актуальный тикер синхронизирован без рассинхрона.
   - **Live Paper Trading (Симулятор):** режим работы со стартовым балансом ($10,000 по умолчанию) и настраиваемым риском на сделку (1.0%). Движок `LivePaperRunner` подписывается на `FreeBinanceCollector` (Live L2 стакан + Liquidation Map), детектирует сетапы («Вход перед стенкой $500k+» и Quant Confluence 3 ядра), списывает маржу с виртуального баланса с учетом комиссий Maker/Taker и проскальзывания, строит интерактивную SVG equity-кривую в реальном времени.
2. **Layout & State Persistence (Полное сохранение состояния интерфейса):**
   - `App.jsx`: сохранение активного `symbol`, `timeframe`, состояния открытых панелей (`showBacktest`, `showAICopilot`, `showDecisionJournal`) в `localStorage`.
   - `colorLinksStore.js`: сохранение 10 цветовых каналов, привязок панелей (`panelBindings`) и локальных тикеров через Zustand `persist` (`signalscript_color_links`).
   - `layoutStore.js`: сохранение активного пресета (`signalscript_active_preset`) и локального снапшота раскладки dockview (`signalscript_last_dockview_layout`).
   - `quantStore.js`: сохранение настроек слоев, плеч 25x-100x, фильтра плотностей, прозрачности и палитры через Zustand `persist` (`signalscript_quant_storage`).
   - `backtestStore.js`: сохранение выбранного режима (`mode`), параметров по тикерам и конфигурации `livePaperConfig` через Zustand `persist` (`signalscript_backtest_storage`).
3. **Надёжная цепочка моделей (Model Cascade) для AI Copilot & Risk Officer:**
   - Сервис `backend/app/services/openrouter_client.py`:
     1. Многоуровневый каскад: **Primary (платная дешёвая: `deepseek/deepseek-v4.1-flash`)** $\rightarrow$ **Fallback (Free Models Router OpenRouter: `openrouter/free` и пул бесплатных моделей)** $\rightarrow$ **детерминированный Cold Quant Fallback (`local_quant_fallback`)**.
     2. Кэш доступности OpenRouter Models API (`https://openrouter.ai/api/v1/models`) на 1 час (3600 с). Недоступные модели отсекаются до сетевого вызова.
     3. Обработка ошибок: HTTP 402 (исчерпание баланса) немедленно переходит к бесплатным fallback-моделям без повторов; HTTP 429 повторяется с экспоненциальной задержкой не более 2 раз; таймаут 20.0 с.
     4. Телеметрия каждого вызова: `model`, `latency_ms`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost`, `status`, `fallback`, `fallback_reason` + буфер истории вызовов.
     5. Суточный потолок расходов (`OPENROUTER_DAILY_BUDGET_USD` в `config.py`): при превышении платные модели блокируются, вызовы автоматически направляются на бесплатный роутер.
     6. Эндпоинт `GET /api/paper-trading/ai-model-chain-status` для аудита расходов и состояния кэша моделей.
     7. UI-индикация в `LivePaperTradingView.jsx` и `Chart.jsx`: отображение ответившей модели, статуса `[Primary]` / `[Fallback]`, задержки вызова. При полном отказе сети выводится честное `"AI недоступен"`.
     8. 8 юнит-тестов с моками сети в `backend/tests/test_openrouter_chain.py` (все 8 зелёные).
4. **Компоненты интерфейса:**
   - В `BacktestPanel.jsx` добавлена кнопка переключения режима `⚡ Симулятор (Paper)`.
   - Создан компонент `LivePaperTradingView.jsx` с контролами `LivePaperTradingControls` и визуализатором `LivePaperTradingResults` (KPI-карточки баланса/equity/PnL, SVG equity chart, таблицы открытых/закрытых сделок и лог AI).

## 🔒 Ограничения

- Никаких реальных ордеров, ключей или случайных данных рынка (строго консультативный терминал).
- Не изменять `backend/app/engine/` и `backend/app/services/execution_simulator.py`.
- Порты строго: backend `8000`, frontend `5173`; SQLite: `data/signals.db`.
- Перед каждым коммитом обязателен полный прогон `scripts/check.ps1`.

## Recorder S0 handoff — 2026-10-20

- **ACTIVE_AGENT:** `codex`
- **Ветка:** `agent/codex/recorder`
- **Сделано:** read-only аудит старого recorder и фактических Parquet-файлов; архитектурное решение нового отдельного recorder добавлено в `DECISIONS.md`.
- **Подтверждённые разрывы:** общий gap около 5 ч 50 мин 19 Oct 2026; ETH depth gap около 18 ч 40 мин 17–18 Oct 2026.
- **Данные не менялись:** `data/recorded`, backups и backend history не удалялись, не перемещались и не перезаписывались.
- **Следующий шаг:** S1 — отдельный пакет recorder с envelope, config, spool, norm Parquet, gaps и Binance trade/book_ticker/mark_price/liquidation/kline_1m, без подключения к FastAPI.
- **S1 progress:** новый пакет `recorder/` уже содержит канонический envelope, Binance normalizers, fsync spool, immutable zstd Parquet + SHA-256 manifest, gap journal и YAML config; покрытие — 6 тестов. WebSocket process, CLI/status и disk policy ещё не завершены.
- **S1 completed:** WebSocket process, `python -m recorder run|status`, 50 GiB disk policy, closed-kline filtering, heartbeat/status, Dockerfile/Compose и Windows start/stop scripts добавлены; полный `scripts/check.ps1` — PASS (111 tests, build, smoke, UI and live WS checks).
- **Deployment blocker:** локально доступен только Docker Desktop (`desktop-linux`); серверный SSH/Docker target не обнаружен. После предоставления hostname/IP, user и port либо Docker context выполнить remote build/up и smoke/status check.
