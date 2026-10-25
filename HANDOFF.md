# HANDOFF.md — Протокол передачи контекста между агентами

> Перед началом работы: прочитать `AGENTS.md` и этот файл, выполнить `git status`, затем запустить `powershell -ExecutionPolicy Bypass -File scripts/check.ps1`. Агенты работают строго последовательно.

## Kimi — разбор ночного марафона + фикс equity + ema_pullback + новый марафон A/B 2026-10-25 (утро, HEAD 1eeb2ff)

- **Задача Di (07:26):** «скрипт работал всю ночь — проверь функции, найди баги и почини; проработай стратегии и причины входа детальнее; статистика и счёт». Ночной марафон 14 пар (`1792862665`, SL 0.4/TP 0.8): 5 закрытых сделок, win rate 40%, PF 8.18, aggregate +87.58 на 14000; DOGE +19.4% (1 открытая LONG), ENA +85.87 net; 9 пар — 146/146 блокировок входа (фильтр `ema_cross`, известное свойство ema_trend на 5m, не баг).
- **БАГ equity ИСПРАВЛЕН (`f681d1c`):** `paper_trading.get_state()` возвращает `balance = initial + realized + unrealized` (инвариант, тест `test_balance_identity_holds_after_deposit` — семантику источника НЕ менять), а `live_paper_runner.get_status()` прибавлял unrealized ЕЩЁ РАЗ. Живое доказательство (DOGE): balance=1097.13, unrealized=97.26 → reported equity=1194.39 (двойной счёт). Фикс + регрессионный тест `test_status_equity_does_not_double_count_unrealized` (10 passed, 1 skipped).
- **ENA-аномалия (стоп 0.19940 > exit 0.19506) объяснена:** 20 дублирующих EXIT-ордеров + выход MARKET 0.1900 с филлом 0.1951 — проскальзывание после MFE 12.9R на СТАРОМ коде; лечится вчерашним `30e0510` (tp2 + exit-replace + slippage-guard), задеплоено этим рестартом.
- **Новая стратегия `ema_pullback` (`e364794`):** отскок к EMA20 внутри тренда (trend/touch/reject + объём + дельта). Полный контур: движок (`strategies.py`), бэктестер (evaluate/explain + reject-фильтры trend_structure/ema20_touch_reject/delta_direction), пилот (historical+optimizable), live-раннер, реестр `/api/backtest`, AI-копайлот, фронт (STRATEGY_OPTIONS). 7 тестов `test_ema_pullback_live.py`.
- **Честная эмпирика (`scripts/_tmp_pullback_eval.py`, временный):** наивный ema_pullback на 14 парах/7 днях 5m даёт сделок в 3-8 раз больше (33-136 vs 12-26), но почти везде убыточен, DD до 47% → В КАТАЛОГЕ для ручного бэктеста/sweep/AI, НЕ дефолт. Сетка RR для ema_trend: 0.5/1.5 лучший для BTC/BNB/ZEC; 0.8/2.2 наименее плохой для остальных; 0.4/0.8 — XRP/LINK. Выборка 13-26 сделок/пару — граничит с оверфиттингом, выводы «наименее плохой», не «прибыльный».
- **UI (`1eeb2ff`):** в TradeHistoryWidget колонка причин разделена: «Вход: {entry_reason}» (emerald) / «Выход: {reason}» — раньше показывалась только причина выхода как единственная.
- **РЕСТАРТ backend ВЫПОЛНЕН (Di: «почини и проработай»):** старый PID 40088 убит → новый на :8000. ⚠️ При старте вторичный инстанс перезаписал `.env` на порт 8001 (механизм роуминга `runtime_binding.py`); `.env` возвращён на 8000/8000, backend работает строго на :8000. Live-раннер Di (BTC live_density_bounce) погиб при рестарте — поднимать не стал (решение Di).
- **НОВЫЙ МАРАФОН ЗАПУЩЕН (`1792909689`, 168 ч):** 14 пар, ema_trend, $1k×14, lev 10, risk 1%, multi_tp, 5m. **A/B калибровка SL/TP:** группа A (SL 0.5/TP 1.5) = BTC, BNB, ZEC, XRP, LINK, NEAR, WLD; группа B (SL 0.8/TP 2.2) = ETH, SOL, AVAX, DOGE, SUI, UNI, ENA. M4-гейты включены ТОЛЬКО у BTC (A/B фазы 5.6). Preflight 14/14 valid (ZEC PF 1.44, NEAR 1.13 — единственные ≥1 на 7 днях). Первые минуты: все data=connected, errors=0, balance=1000.
- **Проверки:** полный `scripts/check.ps1` → 🎉 ALL QUALITY CHECKS PASSED (перед коммитами). Команды старта марафона см. `scripts/_tmp_marathon_ab.py` (временный, не коммитить).
- ⚠️ Untracked-мусор (`_tmp_*`, `context/qa/`, `моя комора/`, `calibration_results.json`, `check_pilot.py`) — не коммитить.

## Kimi — аудит стопов/тейков/PnL + маркеры сделок + настройки TPO/стен 2026-10-24 (вечер, HEAD 30e0510)

- **Задача Di (22:23):** «проверь чтобы правильно работали стопы тейки, отмечались точки входа/выхода, правильно считался PnL, позицией правильно управляет AI, стены/TPO не должны летать при скролле, дай основные настройки». Проведён полный аудит, 3 реальных бага найдены и исправлены (`30e0510`):
  1. **`tp2_price` терялся:** `paper_trading.py::_apply_entry_fill` не передавал `tp2_price` в конструктор PaperPosition (поле есть в датаклассе). Multi-TP деградировал в один TP — каждый тик с ценой ≥ target ставил ПОЛНЫЙ exit-ордер (у SUI 24 дубля за 2.5 мин). Исправлено.
  2. **Спам exit-ордеров:** в `place_order` добавлена replace-семантика — перед созданием EXIT-ордера отменяются working exit-ордера той же пары (защита от oversell сверх qty).
  3. **Протухшие снапшоты при входе:** SUI fill +0.6% от сигнала (TP1 0.6% — сразу выбит сразу), DOGE −4%. Добавлен guard `max_entry_slippage_pct` (default 0.5%, конфиг-сессии; атрибут сессии default 0.0 = выкл, пробрасывается в `live_paper_runner.start`): вход с fill, отклонившимся от сигнала дальше порога → REJECTED + резерв высвобождается.
- **PnL-аудит:** математика корректна — по всем закрытым сделкам марафона `net == gross − fee_drag` (с точностью до fp; slippage уже внутри gross через цены исполнения). Открытые BE=True со стопом ВЫШЕ входа — корректный breakeven, не баг.
- **Маркеры сделок марафона на графике** (`useChartAnnotations.js`): вход/выход закрытых сделок из `/api/overnight-pilot/status`, мерж с live-раннером, формат совместим (entry_ts/exit_ts/prices). Открытые живые позиции на графике — уже есть (livePosition-оверлей, 9d9009d).
- **TPO привязан к краю** (`registerCustomElements.js` tpoProfile): `pinToEdge` (default true) — гистограмма рисуется от `bounding.width`, а не от якорной свечи → не летает при скролле. Стены (orderbookWall) и так через `yAxis.convertToPixel(price)` (Y pinned, корректно).
- **Настройки TPO/стен на тулбаре графика** (`useChartOverlays.js` + `ChartToolbar.jsx`): шестерёнки ⚙ рядом с TPO и Стенки → поповеры (period_minutes=30, value_area=0.7, tick_size; min_usd=400000, max_walls=4), localStorage `chart_tpo_settings`/`chart_walls_settings`, событие `signalscript:chart-settings-changed` перезагружает оверлеи, параметры уходят в `/api/profile/tpo` (API принимает).
- **Проверки:** `test_paper_position_management.py` 7/7; срез `-k "paper or runner or execution or contract"` 150 passed; `test:pilot` 34/34; полный `scripts/check.ps1` → 🎉 ALL QUALITY CHECKS PASSED. В UI Di (HMR): маркеры, обе шестерёнки, чип марафона на месте.
- ⚠️ **РЕСТАРТ ТРЕБУЕТСЯ:** бэкенд-фиксы (tp2, exit-replace, slippage-guard) вступят в силу только после рестарта backend — он убьёт текущий тест Di (14 пар, `1792862665` от 20:24, PID 40088). Решение за Di; до рестарта фиксы в проде не работают.
- ⚠️ AI-управление позицией: в марафоне `ai_control=false` (детерминированные BE/trailing/early-exit) — входы/выходы AI не ветирует; AI у Di активен в live-раннере (ai_control=true, free-model fallback работает). Включать AI в марафоне — конфиг-решение Di.
- ⚠️ Untracked-мусор (`_tmp_*`, `context/qa/`, `моя комора/`, `calibration_results.json`, `check_pilot.py`) — не коммитить.

## Kimi — панель Футпринт/Кластеры + единый paper-модуль «По парам» 2026-10-24 (вечер, HEAD f301a19)

- **Аннотация Di:** «разберись почему блок Футпринт не работает, сделай как в лучших терминалах; paper-модули объединить — подбор/оптимизация стратегии и запуск торговли по каждой паре, AI помогает подбирать».
- **Диагноз:** док-панель «Футпринт / Кластеры» рисовала СТАТИЧНУЮ заглушку (`FootprintPlaceholderWidget`), а готовый компонент `FootprintClusters.jsx` был мёртвым кодом (нигде не импортировался). Данные `/api/recorder/clusters` при этом живые — но только для 5 focus-символов.
- **Футпринт оживлён (`c9f6884`):**
  - `FootprintPanel.jsx` + чистый `footprintGrid.js` — грид последних 14 свечей: buy×sell по уровням с интенсивностью объёма, imbalance-рамка (ratio ≥ 3, как бэкенд), stacked imbalance ♦N и absorption ▬ в шапке свечи, POC — выделенная строка ◆, CVD окна, LIVE-индикатор, сводка |Δ|/Vol. Символ — через ChannelSelector (цветовой канал), пустое состояние с кнопкой «Включить запись символа» (POST /recorder/config).
  - Мёртвый `FootprintClusters.jsx` удалён; `footprint_placeholder` в map Dockview → FootprintPanel (совместимость с сохранёнными раскладками).
  - Проверено вживую на вкладке Di (HMR): BTCUSDT, CVD +249, ♦4/♦5, ▬, 240 ячеек грида.
- **Бэкенд рекордера (`1719a90`):** `poc_price` в `annotate_cluster_metrics`; footprint-кэш и подписка `@trade` распространены на focus ∪ watchlist (depth20 — только focus); тесты 10/10. ⚠️ Вступит в силу после рестарта backend (в очереди с фиксами стопов/тейков `30e0510`). В .env (не в git) FOCUS_SYMBOLS расширен до 15 пар марафона — тоже подхватится при рестарте.
- **Единый paper-модуль (`f301a19`):** в TradeHistoryWidget новая вкладка **«По парам»** (`paperPairs.js`, тесты 5 шт): одна строка = пара, источники (МАРАФОН/LIVE-бейджи), стратегия/TF/AI, Equity, PnL, ROI, открыто/закрыто, WinRate, статус (RUNNING/DATA!). Кнопки строки: **Бэктест** → график переключается на пару (канал c1) + режим single; **AI-подбор** → режим ai; **Торговать** → live_paper — панель бэктеста открывается с выбранной парой. Проверено вживую: клик по AVAXUSDT переключил график/футпринт на пару и открыл «Настройка paper-торговли» в live_paper; символ возвращён на BTCUSDT.
- **Gate:** `scripts/check.ps1` → 🎉 ALL QUALITY CHECKS PASSED (pytest 341+, test:pilot 48/48, build, smoke, live WS). Тест марафона 14 пар и live-раннер НЕ тронуты, backend не рестартовал.
- **Бэклог пополнен (`context/WORK_QUEUE.md`):** кластерные индикаторы как фильтры в стратегиях (источник данных готов); этап 2 единого paper-модуля (старт/стоп по паре из таблицы, Apply AI-рекомендаций).
- ⚠️ Untracked-мусор (`_tmp_*`, `context/qa/`, `моя комора/`, `calibration_results.json`, `check_pilot.py`) — не коммитить.

## Kimi — фикс «статистика/позиции не видны в виджетах» 2026-10-24 (вечер, HEAD b980256)

- **Жалоба Di:** «не вижу открытых и закрытых позиций в виджетах, статистика не пишется». Причина: `TradeHistoryWidget` опрашивал только одиночный live-раннер (`/api/paper-trading/status`), а реальные сделки шли ночным марафоном (14 пар, `/api/overnight-pilot/status`) и в виджет не попадали; плюс `OvernightPilotPanel` читал открытые позиции из несуществующего ключа `paper.positions` (backend отдаёт `paper.open_positions`) — блок open всегда был 0.
- **Фикс (`b980256`):** виджет теперь мержит позиции/сделки марафона с live-раннером (`marathonFeed.js`, чистая логика + юнит-тесты 5 шт, `test:pilot` 34 passed). Каждая запись марафона помечена бейджем **«МАРАФОН·ТЕСТ»**, в шапке — чип «Марафон (тест): открыто N · закрыто M · Equity $X». Метрики (Win Rate, сделки, Fee Drag) считаются по объединённым paper-системам; баланс тестовый — реальные деньги не используются.
- **Проверено вживую на вкладке Di (HMR подхватил):** чип «Марафон (тест): открыто 3 · закрыто 3 · Equity $14244.51», вкладки «Закрытые сделки (3)» / «Активные позиции (4)». Live-раннер Di (BTCUSDT live_density_bounce) работает параллельно и тоже показывается.
- **Gate зелёный** (341 pytest + build + smoke + live WS). Марафон 14/14 и live-раннер НЕ тронуты, backend не рестартовал. Тест Di (14 пар, запуск `1792862665`, 20:24) продолжает копить статистику.
- ⚠️ Untracked-мусор (`_tmp_*`, `context/qa/`, `моя комора/`, `calibration_results.json`) — не коммитить.

## Kimi — тест Di на 10 пар + бесплатные нейронки везде 2026-10-24 (вечер, HEAD 381131f)

- **Тест ЗАПУЩЕН (12-й запуск `1792858067`):** 10 пар (BTC/ETH/SOL/XRP/BNB/DOGE/NEAR/SUI/AVAX/TIA), ema_trend 5m, $1k×10, 168ч, M4 только BTC (A/B). preflight 10/10 валиден, running 10/10, data connected, errors=0. Конфиги `data/test10_configs.json`, подбор стратегий — `data/sweep20_results.json` (ema_trend победила почти везде; PEPE отсеян win 0%). Запускать повторно: `scripts/_tmp_activate10.py` (временный, не коммитить).
- **AI-фикс (`381131f`):** схемы AI-роутеров дефолтились на ПЛАТНУЮ gemini-2.0-flash-001 — исправлено на бесплатную из .env; чат + live-sentinel через каскад `query_with_fallback` (ошибка/402/429 → следующая бесплатная); UI-дефолт «Авто — бесплатная модель». Ключ Di в .env (живой тест OK, модель flint-v1.0:free). Тесты `test_ai_free_models_default.py` (7 passed).
- **MAX_SESSIONS 14→20** (restore-cap тоже 20) + тесты — headroom под расширения.
- **Рестарт backend 19:0x** (venv-python; SYSTEM Python без uvicorn — известный шум). ⚠️ В .env найден `BACKEND_PORT=8001` (mtime 18:57) — возвращено на 8000/5173 по §5; если Di переносил намеренно — вернуть обратно. Live-раннер DOTUSDT погиб при рестарте (in-memory) — поднять из UI, если нужен.
- **`preflight_passed` в эфире** после рестарта (True у запущенных сессий) — ложная тревога P1 закрыта полностью.
- **Периодическая оптимизация ВКЛЮЧЕНА на ночь (запрос Di, коммиты `8a5353b`/`59b9bdd`):** `_optimization_loop` у каждой сессии — первый прогон генетического оптимизатора сразу после start (подтверждено: 10/10 `mode=periodic, status=complete`), далее каждые 6 ч (env `OVERNIGHT_OPTIMIZATION_INTERVAL_SEC`). Рекомендации консультативные, на сессию НЕ применяются. Важный фикс по пути: `ema_trend` не была в `OPTIMIZABLE_STRATEGIES` — без неё оптимизация молчала бы на 9/10 сессий. Финальный запуск: preflight `9b82e136…`, 10/10 running, ошибок нет. Контракт-тесты: `test_pilot_periodic_optimization.py` (7 passed).

## Kimi — доводка до ума: E2E-прогон всего блока «Бэктест+Прогноз» 2026-10-24 (вечер, HEAD e26a8d5)

- **Задача Di:** «довести до ума проект, чтобы всё работало и можно было оставить тестить». Прогнан E2E весь пользовательский путь бэктеста/прогноза.
- **Все PASSED:** verify_backtest (после калибровки), verify_advanced_backtest (Монте-Карло/оптимизация), verify_backtest_chart_integration, verify_stage3_forecast_cone, verify_html_report_ui, verify_pdf_report_ui, verify_sweep_apply_ui (Apply Strategy #1 → fast=8/slow=26 в форме), verify_honest_backtest_table, verify_modularization_6_4 / 6_4b / 6_4e, verify_closed_trade_invariant (NetPnL == Gross − Fees, diff 0), verify_confluence_matrix.
- **Фиксы E2E-скриптов (`e26a8d5`, только тесты, приложение не тронуто):**
  - `verify_backtest.py` — чек «знак PnL = направлению движения цены» давал ложный фейл на сделках внутри полосы издержек (maker+taker+slippage ~0.1%): добавлен `move_pct` и порог 0.1%.
  - `verify_modularization_6_4b.py` — гонки: селект пресетов читался до async-fetch (поллинг option до 25с); goto падал с ERR_CONNECTION_REFUSED, т.к. vite на 5199 не успевал подняться (ожидание порта); feedback после сохранения ждался 5с (→12с + дебаг-лог). Приложение исправно — пресеты реально грузились и сохранялись.
- **Gate:** `scripts/check.ps1` → 🎉 ALL QUALITY CHECKS PASSED (341 pytest, build, smoke, live WS).
- **Инфраструктура теста НЕ тронута:** марафон 14/14 и ETH live-раннер работают, backend не перезапускался. Один backend на :8000. Dev-серверы почищены (5173/5199 свободны).
- **Дозор теста (17:55, ~2.5 ч 11-го запуска `1792844719`):** инфраструктура чистая (data connected, errors=0, dq=0 у всех 14 сессий), 308 оценок, 5 закрытых сделок. 98% блокировок входов — штатный фильтр `ema_cross` ema_trend (цена в боковике внутри EMA-пояса), далее `volume_multiplier`/`minimum_turnover`. Это не баг — свойство стратегии в боковике (P1); параметры не трогал. Live-раннер сейчас DOTUSDT quant_confluence (Di переключал через UI), 0 сделок по `strategy_conditions`. Полная сводка — `docs/PAPER_MARATHON.md`, запись 24.10 вечер. Утром: `night-pilot.ps1 -Action report`.
- **P1 «preflight_valid=False» расследован и закрыт:** это by-design (гейт потребляется в start()/stop()), а не TTL-баг — ложная тревога ночного теста. Добавлен аддитивный `preflight_passed` в статус сессии (`backend/app/services/overnight_pilot.py` + тест `test_preflight_passed_survives_start_consumption`); в API появится только после следующего рестарта backend — во время марафона НЕ рестартовать.
- **Пункт списка дел (4) «активность стратегии» — расследован до конца, заметка `docs/STRATEGY_FREQUENCY_NOTE_20261024.md`:** редкость входов ema_trend — by-design (EMA20×50 cross = 8–20 событий/3.5 суток на 5m; после фильтров 0–2 входа/сутки). Вариант «переключить марафон на confluence_ema» проверен живым бэктестом — частота ×2, но win rate 12–42% делает её глубоко убыточной на 5m (NetPnL −120…−621 vs −26…−36 у ema_trend, RR 2.75 не спасает). Рекомендация Di: D — ничего не менять, марафон копит выборку; B — новая стратегия ema_pullback как следующая задача, если нужно больше сделок. Параметры не менялись.
- ⚠️ Вкладка Di: символ графика BTCUSDT. Если много мусорных untracked (`_tmp_*`, `context/qa/`, `моя комора/`) — не коммитить.

## Kimi — живые позиции на графике + краш-фикс терминала 2026-10-24 (вечер, HEAD 9d9009d)

- **Задача №1 из приоритетов Di:** отрисовка открытых paper-позиций на графике в реальном времени.
  - `frontend/src/components/chart/livePositions.js` — чистая нормализация открытых позиций из `/api/overnight-pilot/status` (марафон) и `/api/paper-trading/live/status` (live-раннер) по символу графика; truth-first (null вместо синтеза).
  - `registerCustomElements.js` — новый оверлей `livePosition` (13-й): entry сплошная линия + бейдж `[LONG qty @ цена | PnL ±$] · источник`, SL/TP/TP2 пунктиром с бейджами; цвета LONG/SHORT.
  - `useChartAnnotations.js` — поллинг 4 с, перерисовка диффом по данным, кламп entry_ts в видимый диапазон, чистка на смене символа.
  - Тесты `livePositions.test.js` (4 шт) в `test:pilot` (29 passed). Проверено вживую на вкладке Di: BTC LONG марафона рисуется (entry 80832.2 / SL 80459.8 / TP 81267.6, «марафон · ema_trend»).
- **Критический баг (пустой root у Di):** `LivePaperTradingView.jsx:68` — `currentEquity.toFixed is not a function`: точки equity из API приходили с null/строками, неперехваченная ошибка рендера валило ВСЁ приложение (React 19 размонтирует root). Фикс — санитизация points/initialCapital в `LiveEquityChart` (числа или дефолт). Коммит `9d9009d`.
- Коммиты: `6c2ef5d` (фича), `9d9009d` (краш-фикс). Gate зелёный оба раза. Марафон 14/14 и live-раннер НЕ тронуты.
- ⚠️ Вкладка Di: символ графика сейчас BTCUSDT (переключил для проверки). Скриншот через InAppBrowser подвисал (таймаут 15 с) — вкладка при этом работает.

## Kimi — closeout ROADMAP 1.1–1.2: production_robust + Night Pilot CLI 2026-10-24 (день)

- **Ветка:** `agent/kimi/phase1-production-robust-closeout` (от main). Задача: `tasks/003-phase1-production-robust-closeout.md`.
- **1.1 подтверждён кодом:** `production_robust_configs()` — vol_mult 1.25, SL 0.8 / TP 2.2 (R:R 2.75), BTC/ETH/SOL, ai_control=False. RSI-полоса 42–58 для confluence_ema уже реализована во всех трёх движках (`orderflow_backtester` evaluate/explain/main-loop, `live_paper_runner._passes_live_indicator_filters`); дублировать не стал — добавил сквозные тесты.
- **RSI-цепочка зафиксирована тестом:** preflight `_prepare` маппит пресет в `BacktestParams(use_rsi_filter=True, …)` и `strategy_params` forecast; `compute_probabilistic_forecast` передаёт флаг в `evaluate_latest_signal`.
- **1.2 CLI:** в `scripts/night-pilot.ps1` закрыт дефект — `Write-PaperMorningTable` подменяла отсутствующие WinRate/NetPnL/TotalFees нулями → теперь «—» (truth-first). Контракты: порт 8000, `production-robust/*` endpoints, обязательный preflight перед start, sentinel (HIGH NO_ENTRY + FEE DRAG) — подтверждены текст-контрактным тестом.
- **Тесты:** `backend/tests/test_phase1_production_robust_closeout.py` (5 passed); gate зелёный.
- **Активный тест НЕ тронут:** марафон 14/14 и live-раннер работают; backend не перезапускался. Марафон в рамках задачи НЕ запускался — команда для Di ниже.
- **Порча:** `context/CURRENT_TASK.md` в рабочем дереве содержал случайный markmap-SVG (незакоммиченный) — восстановлен осмысленный формат.
- **Команда для отдельного запуска paper-марафона 3–5 суток (после остановки текущего теста Di, НЕ выполнять внутри активного пилота):**
  `powershell -ExecutionPolicy Bypass -File scripts/night-pilot.ps1 -Action preflight -Preset production_robust` → затем `-Action start -Preset production_robust -MonitorMinutes 0`.

## Kimi — аннотации Di + P0-фиксы 2026-10-24 (день, HEAD fd3fcce)

- **Коммиты:** `800bfd7` (REST-фолбэк скринера) → `ce305f6` (аннотации 1–7 + SW) → `fd3fcce` (P0 ночного теста). Gate зелёный оба раза.
- **Аннотации Di (7 шт., закрыты все):**
  - **1 (пустой скринер)** → `800bfd7`: в браузере Kimi WS-колбы к Binance открываются, но кадры не идут. Фолбэк: watchdog-тик marketDataStore при stale >10с дёргает `fapi.binance.com/fapi/v1/ticker/24hr`, `dataSource: 'ws'|'rest'`, бейдж REST в ScreenerWidget (`data-testid="screener-source-rest"`), dev-экспорт `window.__marketDataStore`. Проверено: 746 тикеров, source=rest.
  - **2/3 (две формы добавления виджетов)** → `ce305f6`: кнопка «+ Виджет» убрана из PresetBar.jsx; единственная форма — «+ Виджеты» в топ-баре (testid `widgets-menu-button` сохранён, на него завязан gate-смоук).
  - **4 (непонятно, какая стратегия активна)** → `ce305f6`: TradeHistoryWidget.jsx каждые 3с опрашивает `/api/paper-trading/live/status`, строка `active-strategy-row`: «Стратегия: X • SYMBOL • TF • [плечо Nx] • [AI] • RUNNING/STOPPED» + кнопка `btn-change-strategy` (setMode('live_paper') + событие `signalscript:open-backtest`, слушатель в App.jsx). В `live_paper_runner.get_status` добавлено поле `leverage` (нужен рестарт бэкенда — был).
  - **5 (вьюпорт не к актуальному времени)** → `ce305f6`: кнопка `btn-scroll-to-now` (SkipForward) в ChartToolbar.jsx → `handleScrollToNow` (тот же scrollToRealTime, что Space); в useChartLifecycle.js после applyNewData добавлен `chart.scrollToRealTime()` — вьюпорт к правому краю при смене символа/ТФ.
  - **6/7 (непонятные/наезжающие панели)** → в значительной степени лечились фолбэком + SW-фиксом; проверено по скриншоту вкладки (скринер заполнен, вкладки без наложений). Если Di вернётся с деталями — слушать.
  - **SW (критично, скрытый корень каши модулей):** `sw.js` кешировал ВСЁ подряд, включая `/src/*.jsx` → вкладка получала смесь старых/новых модулей и падала с ПУСТЫМ root. Фикс: bypass кеша для `/src/`, `/node_modules/`, `/@`, `/index.html`; CACHE_NAME → 'signalscript-v2'. Живую вкладку лечить: unregister SW + caches.delete + перезагрузка `?v=N`.
- **P0 из NIGHT_TEST_FINAL_20261024 (оба закрыты, `fd3fcce`):**
  - **P0-1 (воркер спамил общий кошелёк: 685 ENTRY × 13 символов):** корень — `background_worker.py`, quant-цикл вызывал `execute_unified_signal` для любого тикера с сигналом. Добавлен модульный гейт `background_auto_trade_allowed(ticker)`: **ВЫКЛ по умолчанию**; при `BACKGROUND_WORKER_AUTO_TRADE=true` — только символ live-раннера. Тесты: `test_background_worker_auto_trade_gate.py` (4 passed).
  - **P0-2 (ema_trend лимит сгорал):** раннер всегда слал `entry_type="LIMIT"`. Добавлен `MARKET_ENTRY_STRATEGIES = {"confluence_ema","cvd_absorption","diagnostics_lenient","ema_trend","naked_test"}` — для них `entry_type="MARKET"`. Wall-bounce (live_density_bounce, spot_wall_bounce, cluster_volume_bounce) остаются лимитными — решение принято. Тесты: `test_market_entry_strategies.py` (4 passed).
- **Рестарт бэкенда** (после P0-фиксов): убить PID из `netstat :8000` через `powershell -Command "Stop-Process -Id N -Force"` (bash манглит /PID в taskkill), поднять: `Start-Process ... 'C:\Users\danil\AppData\Local\Programs\Python\Python311\python.exe' backend\main.py` — **прод-процесс на СИСТЕМНОМ Python 3.11, не venv**; gate ходит через venv. Подъём ~240с. Логи `logs/backend_20261024b*.log`. В err-логе есть старый `ModuleNotFoundError: uvicorn` — сервер работает, известный шум, не разбирал.
- **Состояние после рестарта:** марафон 14/14 running (ema_trend 5m, $1k×10, 168ч, m4 только у BTC — A/B сохранён), live-раннер ETHUSDT live_density_bounce $1k×10 ai_control=true running; общий paper-кошелёк: balance 1000, 0 позиций, 0 ордеров. Один backend на :8000. Снапшот: `data/pilot_status_prerestart_20261024.json`.
- **Перезапуск марафона — ТОЛЬКО `scripts/_tmp_activate14.py`** (старый `_tmp_activate.py` перезапишет конфиги семёркой — НЕ использовать; временные файлы не коммитить).
- **Не трогал (P1, ждёт разговора о параметрах с Di):** редкость сигналов ema_cross/ema_trend в боковике, minimum_turnover ночью у альтов, preflight_valid=False у работающих сессий — НЕ баг: гейт потребляется в start(); результат проверки теперь дублируется в preflight_passed (фикс 24.10 вечер).

## 📊 ИТОГ ТЕСТА 23–24.10 (финальный отчёт: docs/NIGHT_TEST_FINAL_20261024.md)

- Тест окончен 24.10 12:40; марафон и live-раннер остановлены; дозор отключён.
- Результат: 3 реализованные сделки (+$1.84), 6263 оценок, инфраструктура без падений.
- **P0-баги из прогона:** (1) live-раннер при старте шлёт ордера по ВСЕМ 14 символам
  вотчлиста (685 ENTRY за секунды, реально отработал только BTC); (2) ema_trend ставит
  лимит не по рынку — ночной BNB-лонг не исполнился, сигнал сгорел.
- **P1:** редкость сигналов (ema_cross = 66% блоков), minimum_turnover ночью у альтов,
  preflight_valid=False у работающих сессий — НЕ баг: гейт потребляется в start(); результат проверки теперь дублируется в preflight_passed (фикс 24.10 вечер).
- Сессии марафона остановлены корректно, конфиги в data/scalp_marathon_configs.json.

## 🎯 ЗАДАЧИ НА БУДУЩЕЕ (приоритеты Di, зафиксировано 24.10 08:50)

1. **Отрисовка позиций на графике в реальном времени** (Di, 24.10): точка входа, тейки, стоп —
   видно живую картину по открытым сделкам марафона/live-раннера прямо на chart.
   Зачаток есть: `useChartAnnotations.js` (paperOverlayIds, positionSetupBox, live-сигналы,
   `apply-position-setup` listener) — нужно довести до «позиция открылась → уровни на графике
   сразу; закрылась → итог помечен», для всех активных сессий, без ручного переключения.
2. **Переход на нормальный дизайн** (Di, 24.10): терминал должен выглядеть как продукт,
   единый визуальный язык (пока UI собран по-разному в разных блоках).
3. **Завершить и отполировать блок «Бэктест + Прогноз»** (Di, 24.10): всё настраивается,
   отображается, корректируется и работает без багов, как должно. Торговля уже работает,
   но трудно протестировать/проверить глазами, что каждая мелочь в этом блоке ведёт себя
   правильно → в задачу входит полная ручная E2E-проверка сценариев: параметры → прогон →
   equity/сделки/МК → PDF/HTML → правка параметров → повторный прогон → sweep-лидерборд →
   apply-стратегии.
4. Фоном (техдолг ночи): логика цены входа ema_trend (лимит выше рынка — сигнал BNB не
   исполнился), preflight_valid=False после старта (TTL), guardian не поднимает backend
   автономно, транзиентный фейл BLOCKING UI smoke в gate (2 случая за ночь, не воспроизводится).

## Kimi — расширение прогона до 14 пар 2026-10-24 (08:40)

- **HEAD:** `5db7d18` (MAX_SESSIONS 7→14 + тест, gate зелёный).
- **Новые 7 пар** (отбор по объёму 24ч Binance, классика без токенизированных акций): ZEC, NEAR, ENA, WLD, SUI, UNI, AVAX. Свип 21 прогон (`docs/SWEEP2_20261024.md`, `data/scalp_sweep2.json`): ema_trend лучшая у всех; ZEC +$54 PF 3.99 — звезда.
- **Марафон 14-й запуск**: 14 пар ema_trend 5m, $1k ×10, 168 ч, m4 у BTC — 14/14 running (`data/scalp_marathon_configs.json` обновлён). Вотчлист 14 пар. Live-раннер BTC перезапущен.
- **Дозор** (automation_6c9278a3) обновлён: ждёт 14 сессий и 14 пар; проверочный запуск «OK: всё на месте». Тест безграничный по времени (Di) — дозор работает, отключать по запросу.
- Транзиентный фейл UI smoke в gate повторился и снова не воспроизвёлся (2-й случай за ночь) — задача в списке разбора.

## Kimi — утренние итоги ночного прогона 2026-10-24 (08:15)

- **Инфраструктура — полёт нормальный:** дозор (automation_6c9278a3) 9/9 запусков succeeded за ночь, backend не падал, 7/7 сессий марафона running, вотчлист 7 пар, recorder жив, sentinel 0 ложных. Всё это НЕ причина «одной сделки».
- **Торговая активность — 1 сделка (live-раннер BTC, +$1.99 net, выход по защитному стопу). Марафон: 0 исполненных сделок.** Причины (по логам, 6963 оценок):
  1. **ema_cross** — доминирующий блок: на 5m в ночном боковике пересечений EMA 20/50 почти нет. Это свойство стратегии, не баг.
  2. **volume_multiplier** 0.27–0.33 < 0.50 — рынок ночью тихий, объёмы низкие.
  3. **minimum_turnover** у LINK/DOGE (7k/13k < 50k на тик) — плотность книги мелкая ночью.
  4. **Один сигнал был** (BNB 05:30, cross up) — лимитный ордер выставлен @740.65 **выше рынка** (~739.28) → за ночь не исполнился, позиции нет. ⚠️ Кандидат на фикс: логика цены входа ema_trend (limit не по рынку).
- **AI:** вызовов 0 за ночь — до AI-стадии не дошло ни одного кандидата (это нормально при такой фильтрации).
- **Список дел (приоритет):** (1) логика входа ema_trend — лимит выше рынка; (2) ~~preflight_valid=False у сессий после старта~~ ✅ закрыто 24.10 вечер: это by-design (гейт потребляется start()), ложная тревога снята, результат проверки дублируется в preflight_passed; (3) guardian не поднимает backend автономно; (4) активность стратегии в тихом рынке — обсудить с Di параметры (volume_multiplier/cross-периоды), не менять молча.
- Тест продлён ещё на ~2 часа (08:15–10:15), дозор продолжает работать.

## Kimi — ночной прогон «максимум нагрузки» 2026-10-23 → утро 24.10

- **HEAD:** `7f34046` (main). Коммиты ночи: `d941558` (MAX_SESSIONS=7 + тест), `8256836` + `011b2fd` (актуальные free-модели OpenRouter), `266c562` (openrouter/free не отсекается каталогом), `7f34046` (reasoning-поле как content).
- **⚠️ Процессы:** guardian (venv, PID 37900) дважды НЕ поднял backend после убийства :8000 — backend поднят вручную через Start-Process (лог `logs/backend_20261024.log`). Зомби-guardian на системном Python убит. Guardian-автономность — разобрать отдельной задачей.
- **Работает всю ночь:**
  - **Марафон 13-й запуск** `t_1792786655`: 7 пар (ETH,XRP,BTC,SOL,BNB,DOGE,LINK) ema_trend 5m, $1k x10, SL 0.4/TP 0.8, 168 ч, m4-гейты у BTC. Все running, equity 1000, сделок 0 на момент передачи (стратегия ждёт EMA 20/50-кросс; по бэктесту 20/50 прибыльны ETH +$24.76 PF 1.5, XRP +$7.07).
  - **Demo live-раннер** BTC live_density_bounce 15m $1k x10 ai_control=true — AI SUCCESS через openrouter/free (живой пробник CONFIRM, $0, 629 токенов).
  - Вотчлист мониторинга восстановлен до 7 пар (сбрасывается рестартом — state в памяти, рассмотреть персистентность).
  - Recorder PID 31248, sentinel enabled.
- **Батарея E2E 20/20 PASS** → `docs/MORNING_BATTERY_20261024.md` (14 API + 6 UI: терминал, свечи, переключение символа, бэктест, PDF/HTML-экспорт, журнал).
- **Утром:** `scripts/night-pilot.ps1 -Action report` + сверка AI-логов (`grep AI_CONFIRM\|AI_VETO logs/backend_20261024.log`). Первый gate ночи упал транзиентно на UI smoke — не воспроизвёлся.

## Kimi — ночная симуляция «пользователя» 2026-10-23 (22:30)

- **HEAD:** `628ed27` (deposit пополнения вирт. кошелька) + сводка sweep; тег `stable-20261023` — на `ccaca61` (переставить при следующем коммите, если важно).
- **OpenRouter-ключ Di (тестовый, бесплатные модели)** записан в `.env` (в gitignore; дубликаты вычищены). Backend перезапущен — ключ подхвачен. ⚠️ НЕ коммитить `.env`.
- **Что работает ночью (машина не выключается):**
  - Backend :8000 под guardian-ом (PID меняется при рестартах; guardian `scripts/backend_guardian.py --resume-pilot data/pilot_configs_ab_20261022`).
  - **Марафон 12-й запуск** `overnight_*_1792783031` (BTC с M4-гейтами A/B vs ETH/SOL) — resume через guardian после чистки дублирующих backend-процессов. ВНИМАНИЕ: volume_multiplier live 0.2–0.5 против порога 1.25 → сделок может не быть всю ночь, NO_TRADE — норма, не баг.
  - **Demo live-раннер BTC** `live_density_bounce` (стенки ≥$300k, `ai_control=true`) — живой тест OpenRouter-ключа: каждый сетап проходит AI-риск-менеджер (логи AI_VETO/AI_CONFIRM). Перезапущен в 22:15 после рестарта backend.
  - **Recorder** PID 31248 (`run_recorder.ps1 -Action start`), lake пополняется.
  - Warning Sentinel → Telegram (SENTINEL_ENABLED).
- **Sweep ночной** (24 бэктеста, 8 пар × 3 стратегии): `docs/NIGHT_SWEEP_20261023.md` + `data/night_sweep.json`. Главное: ema_trend — 0 сделок везде; только ADA confluence_ema +$12; рынок спокойный.
- **Deposit (новое, 628ed27):** `PaperTradingSession.deposit()` + `POST /api/paper-trading/deposit` и `/live/deposit` + UI-карточка «Пополнить (вирт.)» в LivePaperTradingResults. ⚠️ Живой backend до следующего рестарта эндпоинты НЕ видит (код закоммичен, процесс старый) — рестартнут при первом падении через guardian.
- **⚠️ Процессы:** была связка guardian 37900 → guardian 31612 (system python!) → backend 4940 (мёртвый дубликат) + backend 1984 (системный python, слушал :8000). Убит 4940 (Telegram-конфликт getUpdates в логах был от двойного backend). Guardian-цепочку НЕ трогал — разобраться днём: почему guardian порождает guardian и почему backend на системном Python.
- **Утро:** марафон + demo-раннер + recorder дадут логи; `scripts/night-pilot.ps1 -Action report` для morning report.

## Kimi — HTML-отчёт бэктеста (закрытие 6.4 «PDF/HTML — ПОЛНОСТЬЮ») — 2026-10-23 (вечер)

- **Что сделано:** `render_backtest_report_html` в `backend/app/services/backtest_report.py` (самодостаточный HTML: inline CSS/SVG, тёмная тема, html.escape, equity-SVG net/gross, МК — бейдж+перцентили, heatmap 7×24 rgba-таблицей, топ-20 сделок); эндпоинт `POST /api/backtest/report-html` (тот же контракт тела, что у PDF, inline text/html); кнопка «HTML отчёт» (`btn-export-html`) в BacktestPanel открывает blob в новой вкладке; 11 тестов `test_backtest_report_html.py`; E2E `scripts/verify_html_report_ui.py` (popup, 4 секции). ROADMAP 6.4 → ПОЛНОСТЬЮ.
- **Backend перезапущен** контрольным убийством PID :8000 — guardian поднял автоматически (фикс resume `263ee5c` валидирован повторно). Новый эндпоинт подхвачен. **Марафон 11-й запуск** `overnight_{btc,eth,sol}usdt_1792780120`: все connected, errors=0, closed=0 (молодой, ~1 ч — оценки NO_TRADE, blocked_evaluations=1 у каждой, ai_control=False).
- **⚠️ Для следующего агента:** A/B-наблюдения марафона начались заново после рестарта — сверка winrate/NetPnL/M4_BLOCK по `docs/PAPER_MARATHON.md` теперь от 18:28 UTC 23.10. Старая история наблюдений (с 22.10) стёрта рестартом — зафиксировано честно.

## Kimi phase-6.4 п.1 — ФИНАЛ (слайсы 7–8: Chart.jsx 996→526) + fix guardian resume — 2026-10-23 (вечер)

- **ACTIVE_AGENT:** `kimi` (main: `263ee5c`, gate **ALL QUALITY CHECKS PASSED**, pytest 453 passed)
- **`Chart.jsx` ЗАВЕРШЁН по п.1 MODULARIZATION_PLAN** (прогресс: 5065→4659→4445→4102→2230→1537→996→**526**; плановые модули `chart/`: useChartLifecycle, useChartOverlays, useChartDrawings, ChartToolbar, PositionSetupHUD, ChartContextMenu + registerCustomElements, chartStyles, useChartAnnotations, useChartIndicators, useSecondOpinion + SaveTemplateModal, BtTooltipOverlay, ToxicVolatilityOverlay, IndicatorsDock). Цель «<350 строк» не достигнута (526) — остаток это оркестрация (пропы-стейт-мосты, canvas-область, AssistantHUD/тулбар-связка); выделение безымянных кусков за рамками плана отложено отдельной задачей при желании.
- **Слайс 7 (`a3be934`, 999→642):** `chart/useChartIndicators.js` (эффект синка chartIndicators, syncIndicatorsWithChart по INDICATORS_REGISTRY, activeIndicatorsRef, add/remove/toggle/save, uiConfig-apply эффект; deps 14 пропов, `setPanelIndicators` — из useLayoutStore в Chart.jsx) + `chart/useSecondOpinion.js` (state secondOpinionData/isAskingOpinion + handleAskSecondOpinion/handleDecisionFromOpinion; deps `{symbol, timeframe, activePositionSetup, localPositionSetup, currentKlines}`). Norm-сверка 10/10 сегментов. **E2E 6_4n 5/5** (каталог: модалка+BOLL в candle_pane; toggle off/on; удаление; второе мнение). Latent-баг `setIndicators` (мёртвая ветка синка chartIndicators) — **ИСПРАВЛЕН** коммитом `21b5a7c` (зеркало в ref, семантика 1:1).
- **Слайс 8 (`dc76459`, 642→526):** четыре управляемых JSX-компонента (дословно): SaveTemplateModal (пропы state из useChartDrawings), BtTooltipOverlay (`btTooltip`+`chartContainerRef`), ToxicVolatilityOverlay (`isToxic*` из useChartAnnotations + onDismiss), IndicatorsDock (стек+каталог+настройки). `AlertTriangle` выпал из импортов Chart.jsx (теперь в ToxicVolatilityOverlay). **E2E 6_4o 4/4** (save-template → дропдаун SMC; каталог через док; pageerror-контроль).
- **fix(guardian) (`263ee5c`):** resume марафона в `scripts/backend_guardian.py` НИКОГДА не работал — 3 дефекта: (1) `pilot_sessions_alive` = `len(sessions)>0` ловил восстановленный снапшот (записи есть, движок is_running=False) → критерий `any(paper.is_running)`; (2) resume только после собственного рестарта backend → добавлена healthy-ветка (не чаще раза в 5 мин); (3) `start` вызывался без `preflight_id` (400) → id берётся из ответа preflight и передаётся параметром. Тесты: `test_guardian_pilot_liveness.py` (5) + `test_guardian_resume_pilot.py` (3). ⚠️ pytest пишет в общий лог guardian-а при вызове resume_pilot из тестов (log() общий файл) — две тестовые строки вычищены из `backend/logs/backend_guardian.log`.
- **⚠️ Операционно:** марафон перезапущен вручную через новый guardian — **9-й запуск**, session_id `overnight_{btc,eth,sol}usdt_1792776853` (A/B: BTC m4=True, ETH/SOL m4=False), все `is_running=True`, data_status=connected. Guardian перезапущен с фиксом (PID см. `Get-CimInstance ... backend_guardian`). Два сиротских backend-дерева убиты (одно держало :8000 без движка марафона) — теперь ровно одно дерево backend + одно guardian-дерево (shim+worker). Gate шаг 0 снова зелёный.
- **Дальше:** по ROADMAP открыты только 7.1 (деплой, отложен Di) и 7.4 (решение Di о горизонте). Сделано дополнительно в этом же слоте: 7.3-дослайс (session review по марафонным сессиям, `851c4b4`, E2E 3/3) и fix latent-бага `setIndicators` (`21b5a7c`). Марафон: 10-й запуск `overnight_*_1792778547` поднят автоматически guardian-ом (валидация фикса end-to-end); наблюдения в `docs/PAPER_MARATHON.md`.

## Kimi phase-6.4 п.1 слайс 6 (Chart.jsx -> chart/useChartAnnotations.js) — 2026-10-23 (вечер)

- **ACTIVE_AGENT:** `kimi` (main: `2845774`, gate **ALL QUALITY CHECKS PASSED**; фронтенд-only слайс — pytest не менялся, 448 passed)
- `Chart.jsx` (**1537→996, −541**; прогресс п.1: 5065→4659→4445→4102→2230→1537→**996**): аннотации/сигнальные оверлеи вынесены в `chart/useChartAnnotations.js` (~570 строк):
  - **Внутри хука (дословно, norm-сверка 554/554):** рефы `btOverlayIds`/`activeStrategyLevelOverlays`/`activeVolatilityConeOverlayId`/`activePositionOverlayId`/`lastScrolledResult`/`paperOverlayIds`/`liveSignalOverlayIds`/`whaleOverlayIds`; state `paperTrades` + `isToxicRegime`/`isToxicDismissed` (возвращаются в Chart.jsx); эффекты: toxic polling 4с, `loadPaperTrades` 5с, `apply-ai-strategy-levels`, конус волатильности (ATR-фан 16 баров из klines + `apply-volatility-cone`/`clear-volatility-cone`), bt-маркеры/линии с тултипом (`clearBacktestSignals`+effect), `focus-backtest-trade`, paper-оверлеи, live-сигналы (`renderLiveSignals`/`clearLiveSignals`), whale ≥$500k (`renderWhaleTrades`/`clearWhaleTrades`, буфер 40), `apply-position-setup` listener, `positionSetupBox` render, `strategyLevels`-зоны. Импорты хука: `utils/chartAnnotations`, `stores/tradesStore`, `stores/marketDataStore`, `TF_MS`.
  - **Депсы (20 пропов):** `{chartRef, chartContainerRef, currentKlines, symbol, timeframe, chartReady, klinesVersion, setStatusMsg, setBtTooltip, setIsConeActive, effectiveBacktestSignals, effectiveShowBtSignals, strategyLevels, liveSignals, showLiveSignals, activePositionSetup, localPositionSetup, setLocalPositionSetup, effectivePositionSetup}`. 🔴 **`setLocalPositionSetup` обязателен** — его state остался в Chart.jsx (handleAskSecondOpinion объявлен ВЫШЕ вызова хука, перенос state сломал бы порядок). Та же ловушка класса, что `wsRef` в слайсе 5: ReferenceError видит только браузер/E2E.
  - **Осталось в Chart.jsx:** `isConeActive` state (проп тулбару/AssistantHUD), `effectivePositionSetup` (конст перенесён выше вызова хука — чистая перестановка), второе мнение handlers (138–208), индикаторы-sync (294–413, 587–745), crosshair-sync/mouseup/recenter/save-drawings (753–853), storageInfo, toggleIndicator, btTooltip state + JSX (тулбар, canvas, тултип bt, toxic-overlay, модалки save-template/индикаторов).
- **E2E:** `scripts/verify_modularization_6_4m.py` — 5/5 PASS (базовая загрузка без pageerror — ловуш ReferenceError-класса; конус on/off по overlay-store; AI-уровни 2→0; positionSetupBox 11→12 + HUD; второе мнение с вердиктом «AI НЕДОСТУПЕН» — фактическая квота OpenRouter).
- Backend/марафон/guardian не тронуты (перезапуск НЕ нужен).
- **Дальше по п.1 (слайс 7):** остаток ~996 строк: useChartIndicators (sync modular indicators 294–413 + 587–745, ~270 строк), второе мнение в hook (138–208), storageInfo effect, JSX-модалки (save-template ~90, btTooltip ~50, toxic overlay ~40). После слайса 7 Chart.jsx ~550; слайс 8 — JSX split (SaveTemplateModal + BtTooltip + ToxicOverlay компоненты) → ~350.

## Kimi phase-6.4 п.1 слайс 5 (Chart.jsx -> chartStyles + useChartLifecycle + PositionSetupHUD) — 2026-10-23 (вечер)

- **ACTIVE_AGENT:** `kimi` (main: `1d54ff0`, gate **ALL QUALITY CHECKS PASSED**; фронтенд-only слайс — pytest не менялся, 448 passed)
- `Chart.jsx` (**2230→1537, −693**; прогресс п.1: 5065→4659→4445→4102→2230→**1537**): три модуля одной экстракцией (скрипт с автонорм-сверкой, удалён):
  - **`chart/chartStyles.js`** (99 строк): `hexToRgba` + `buildChartStyles` (темы tealstreet/tiger/bloomberg) дословно; `buildChartStyles` — **export** (ловушка: тела переносятся без export, сборка rolldown падает MISSING_EXPORT). Импортёры: Chart.jsx (uiConfig-effect), useChartLifecycle (init).
  - **`chart/useChartLifecycle.js`** (~330 строк): константы истории (`INITIAL_HISTORY_BARS`/`LOAD_MORE_WINDOW_BARS`/`HISTORY_FLOOR_DAYS`) + init/dispose/ResizeObserver эффект + fetch/WS эффект (deep load 1500, `chart.loadMore` до дневного пола, live WS kline failover spot/futures, кастомные TF 45m/6h, heartbeat REST 3с). **Депсы пропами: `{chartContainerRef, chartRef, chartId, uiConfig, wsRef, chartReady, setChartReady, setChartInstance, symbol, timeframe, currentKlines, setStatusMsg, setErrorDetails, setKlinesVersion, loadDrawings, updateVwapOverlay, loadLiquidations, loadHeatmap, loadFootprint, loadTpoProfile}`** — 🔴 `wsRef` обязателен (ReferenceError в рантайме иначе; сборка НЕ ловит).
  - **`chart/PositionSetupHUD.jsx`** (~215 строк JSX): HUD сетапа (бейджи Entry/SL/TP1/TP2/R:R, «Тест сетапа», «Спросить мнение») + карточка второго мнения AI — дословно, управляемый компонент; `Loader2`/`Zap` переехали сюда из импортов Chart.jsx.
  - **Норм-сверка: 713/713 строк MATCH.**
- **E2E:** `scripts/verify_modularization_6_4l.py` — 5/5 PASS (deep load ровно 1500 баров + `__historyOldestTs`; ResizeObserver считает ресайзы; apply-position-setup → HUD+бейджи+overlay positionSetupBox 11→12→11, ✕ скрывает; живое второе мнение `/api/journal/second-opinion` → карточка с вердиктом, ✕ закрывает; live-свеча свежая). **Ловушки скрипта:** (1) `__chartResizeCounts` ключ — chartId графика (не 'primary'!): суммировать `Object.values()`; (2) возраст последней свечи 15m до 900 с — норма (проверять > 2 интервалов); (3) вердикт «AI НЕДОСТУПЕН» — живой фактический ответ backend (квота OpenRouter), не баг. Тест-записи в decision_logs НЕ вносятся (кнопки журнала не кликаются).
- Backend/марафон/guardian не тронуты (перезапуск НЕ нужен).
- **Дальше по п.1 (слайс 6):** остатки Chart.jsx (~1537) — bt-сигналы (1357–1470), paper trades (1472–1543), live signals (1545–1566), whales (1568–1599), position-setup box effect + strategy levels (1100–1163), volatility cone + AI levels (507–568), toxic regime (174–196), sync/uiConfig effects (799–957), второе мнение handlers (239–330), бэктест-тултип + модалки JSX. Цель: < 350 строк; вероятный сплит: useChartAnnotations (bt/paper/live/whale) + useChartSignals (cone/AI-levels/toxic) + чистка JSX.

## Kimi phase-6.4 п.1 слайс 4 (Chart.jsx -> chart/registerCustomElements.js + chart/useChartOverlays.js) — 2026-10-23 (вечер)

- **ACTIVE_AGENT:** `kimi` (main: `95cc4f5`, gate **ALL QUALITY CHECKS PASSED**; фронтенд-only слайс — pytest не менялся, 448 passed)
- `Chart.jsx` (**4102→2230, −1872**, прогресс п.1: 5065→4659→4445→4102→**2230**): две части одной экстракцией (скрипт с автонорм-сверкой, временный, удалён):
  - **`chart/registerCustomElements.js`** (~1570 строк): модульная преамбула регистраций дословно — 12 `registerOverlay` (rect, measure, btSignal, whaleTradeMarker, backtestTradeLine, volatilityCone, liqMarker, footprintCandle, tpoProfile, strategyLevelZone, positionSetupBox, orderbookWall) + 4 `registerIndicator` (CVD/DeltaBars/ATR/SuperTrend). Импорты: `registerOverlay, registerIndicator` из klinecharts + `useTradeOverlayStore, calculatePositionMetrics` из stores/tradeOverlayStore (нужны positionSetupBox-регистрации). Подключение из Chart.jsx side-effect импортом; `hexToRgba`/`buildChartStyles` остались в Chart.jsx (используются компонентом). **Ловушка:** при переносе регистраций не забыть, что Chart.jsx использует только `init`/`dispose` — register* убраны из его импорта.
  - **`chart/useChartOverlays.js`** (~370 строк): системные оверлеи — рефы (`activeLiq/Heatmap/Footprint/Tpo/WallOverlays`, `vwapLineOverlay`, `depthWsRef`), `densityBudget`, колбэки `updateVwapOverlay`/`loadLiquidations`/`loadHeatmap`/`loadFootprint`/`loadTpoProfile`/`renderOrderBookWalls`/`loadOrderBookWalls`, эффекты (футпринт-интервал 15 с, WS depth20 + HTTP-fallback таймер 3 с, vwap). Депсы пропами: `{chartRef, chartContainerRef, currentKlines, symbol, showVwap, showLiquidations, minLiqUsd, showHeatmap, heatmapMinUsd, setDensityPoints, showFootprint, showTpo, showWalls, densityMode}`. Возвращает колбэки + `vwapLineOverlay`/`activeLiqOverlays`/`activeWallOverlays` (нужны `toggleIndicator('vwap')` и дальнейшим слайсам). Хук вызван сразу после `useChartDrawings`.
  - **Норм-сверка: 1879/1879 строк MATCH** (построчно vs git HEAD, без ведущих пробелов).
- **E2E:** `scripts/verify_modularization_6_4k.py` — 7/7 PASS (стены default ON ×3–4 от WS/HTTP; VWAP on/off; footprint ×44; tpoProfile ×1; heatmap-canvas `depth-heatmap-gl` on/off; стены off→0→on; liqMarker при пустых данных без падений). **Особенности оригинала 1:1 (НЕ регрессии, не «чинить заодно»):** (1) рантайм-тогл TPO только пишет state/localStorage — `loadTpoProfile` зовётся из fetch-effect свечей, поэтому E2E проверяет через localStorage+reload; (2) heatmap-canvas ищется строго по testid `depth-heatmap-gl` (общее число canvas непостоянно — у KLineCharts панелей по нескольку канвасов). localStorage-снапшот/восстановление — обязательный паттерн.
- Backend/марафон/guardian не тронуты (перезапуск НЕ нужен).
- **Дальше по п.1:** слайс 5 — useChartLifecycle (init/dispose/ResizeObserver/dual-source свечи, 2267–2387+3185–3476 в старой нумерации) + PositionSetupHUD.jsx; останутся bt/paper/live/whale/position/strategy/volcone-эффекты — войдут в lifecycle-слайс или отдельный слайс 6 (btOverlayIds/activeStrategyLevelOverlays/activeVolatilityConeOverlayId/activePositionOverlayId/paperOverlayIds/liveSignalOverlayIds/whaleOverlayIds — все рефы ещё в Chart.jsx 1696–1746). Цель: Chart.jsx < 350 строк.

## Kimi phase-6.4 п.1 слайс 3 (Chart.jsx -> chart/useChartDrawings) — 2026-10-23 (вечер)

- **ACTIVE_AGENT:** `kimi` (main: `eeeffa0`, gate **ALL QUALITY CHECKS PASSED**; фронтенд-only слайс — pytest не менялся, 448 passed)
- `Chart.jsx` (4445→4102, −343): рисование / SMC-шаблоны / undo вынесены в `chart/useChartDrawings.js` (~450 строк) — **хук** (рефы `selectedOverlayId`/`trackedOverlays`/`drawingHistory`/`activeDrawingOverlayId`, state `activeTool`/`drawingTemplates`/`isTemplateMenuOpen`/`activeDrawingStyle`/`showSaveTemplateModal`/`newTemplateName`, `saveDrawingsFor`/`saveDrawings`/`loadDrawings`/`handleUndo`/`cancelActiveDrawing`/`handleSelectTool`/`applyTemplate`/`updateStyle`/`handleSaveCurrentAsTemplate`/`handleClearDrawings`, keydown-эффект Ctrl+Z/Delete/Escape/'i', undo-event-эффект, константа `USER_DRAWING_TYPES`). Тела дословно, norm-сверка git diff **12/12 MATCH**. Депсы хука: `{chartRef, symbol, timeframe, userId, setStatusMsg, magnetEnabled, setContextMenu, setIsCatalogOpen, setSettingsDialogIndId}`. В Chart.jsx хук вызван после `useChartContextMenu`; save-on-switch эффекты идут через возвращённый `saveDrawingsFor`, модалка save-template — через возвращённые state, тулбару/меню — через пропы. `magnetEnabled` остался в Chart (нужен вне хука); `useTradeOverlayStore`/`calculatePositionMetrics` **не удалять** — используются в Chart (1050/1057/1782/3538 в старой нумерации).
- **E2E:** `scripts/verify_modularization_6_4j.py` — 7/7 PASS (инструмент, рисование→сохранение, Ctrl+Z ровно −1, Escape, SMC-шаблон, модалка save-template→дропдаун, очистка через контекст-меню). **Ловушки скрипта (важно для слайса 4+):** (1) 🔴 `page.mouse.click()` НЕ срабатывает на канвасе KLineCharts v9 (сегмент не ставится, POST не уходит) — только явные `mouse.down()`/`mouse.up()` с sleep ≥50 мс; (2) кнопка[0] дропдауна `smc-templates-dropdown` — «+ Сохранить текущий», шаблоны — кнопки без этого текста; (3) сохранение на бэкенде поллить (`wait_drawings_count`), фиксированные слипы недостаточны; (4) снапшот /api/drawings (BTCUSDT/15m/user 0) в начале + восстановление POST в finally. После прогонов drawings возвращены к исходным 11 (`positionSetupBox` ×11).
- Backend/марафон/guardian не тронуты (перезапуск НЕ нужен).
- **Дальше по п.1:** слайс 4 — useChartOverlays; слайс 5 — useChartLifecycle + PositionSetupHUD. Цель: Chart.jsx < 350 строк. Прогресс: 5065 → 4659 (слайс 1) → 4445 (слайс 2) → 4102 (слайс 3).

## Kimi phase-6.4 п.1 слайс 2 (Chart.jsx -> chart/ChartContextMenu) — 2026-10-23 (вечер)

- **ACTIVE_AGENT:** `kimi` (main: `64240a4`, gate **ALL QUALITY CHECKS PASSED**; фронтенд-only слайс — pytest не менялся, 448 passed)
- `Chart.jsx` (4659→4445, −214): контекстное меню (правый клик) и карточка экспресс-инспектора отскоков вынесены в `chart/ChartContextMenu.jsx` — **управляемый компонент + хук `useChartContextMenu`** (state `contextMenu`/`levelInspectorData`/`inspectingLevel`, `handleInspectLevel`, `handleContextMenu`, `handleResetScale`, effect закрытия по клику вне — тела дословно, norm-сверка MATCH; deps хука: `chartContainerRef`, `chartRef`, `currentKlines`, `setStatusMsg`, `symbol`, `timeframe`). JSX 126 строк дословно (отличие только фрагмент-обёртка `<>`). В Chart.jsx: `onContextMenu={handleContextMenu}` и `<ChartContextMenu .../>` (пропы с теми же именами, что в JSX); keydown Escape закрытие меню — через деструктурированный `setContextMenu`. Удалены мёртвые lucide-импорты Trash2/Magnet/Save/Ruler/RotateCcw/Check/BarChart3 (Save/Ruler мертвы уже со слайса 1 — только в комментариях); оставлены X/Loader2/Zap/AlertTriangle.
- **🔴 Latent-баг оригинала (исправлен в слайсе):** JSX меню читал `indicators.ema`/`indicators.vol`, но переменной `indicators` в Chart.jsx никогда не существовало → ReferenceError при первом же открытии меню (меню правого клика падало целиком). Источник истины галочек — `activeIndicators` (тот же паттерн `some(i => i.id === 'ema' && i.enabled !== false)`, что в ChartToolbar); компонент вычисляет `indicators` из пропа `activeIndicators`. E2E подтвердил: галочки EMA/магнит работают.
- **E2E:** `scripts/verify_modularization_6_4i.py` — 5/5 PASS (7 пунктов меню по нативному `contextmenu`-диспатчу на канвас; магнит и EMA переключаются с галочкой и возвратом; «✕ Закрыть» и Escape закрывают; карточка инспектора от живого `POST /api/backtest/inspect-level` — КАСАНИЙ/WINRATE/СР. ИМПУЛЬС, закрытие по ✕). Ловушки скрипта: (1) у «Магнит» иконка Magnet всегда в DOM — галочка Check = второй svg; (2) инспектор искать по `div.w-80` (без якоря матчится предок с текстом всей страницы). Порт 5199 дочищен.
- Backend/марафон/guardian не тронуты (перезапуск НЕ нужен).
- **Дальше по п.1:** слайс 3 — useChartDrawings (рисование/SMC/undo ~2546–2823, 3823–4009 в актуальной нумерации минус ~214); слайс 4 — useChartOverlays; слайс 5 — useChartLifecycle + PositionSetupHUD (HUD — отдельный компонент по плану). Цель: Chart.jsx < 350 строк.

## Kimi phase-6.4 п.1 слайс 1 (Chart.jsx -> chart/ChartToolbar) — 2026-10-23 (вечер)

- **ACTIVE_AGENT:** `kimi` (main: `c6880f2`, gate **ALL QUALITY CHECKS PASSED**; фронтенд-only слайс — pytest не менялся, 448 passed)
- П.1 MODULARIZATION_PLAN открыт (решение Di: «продолжай»). `Chart.jsx` (5065→4659, −406): верхняя полоса инструментов вынесена в `chart/ChartToolbar.jsx` — **управляемый** компонент (все значения и колбэки пропами, ~45 шт.), 441 строка JSX дословно (построчная norm-сверка с оригиналом MATCH 441/441). Все data-testid 1:1 (`tool-risk-reward`, `btn-smc-templates`, `btn-toolbar-*`, `density-mode-control`...). Удалены 12 неиспользуемых lucide-импортов (Minus/MoveRight/Square/Hash/TrendingUp/Eye/MousePointer/Sliders/Bookmark/Palette/Layers/ChevronDown); Trash2/Magnet/Save/Ruler/X/RotateCcw/Check/BarChart3/Loader2/Zap/AlertTriangle используются ниже — оставлены.
- **E2E:** `scripts/verify_modularization_6_4h.py` — 6/6 PASS (12 testid тулбара, выбор/сброс инструмента «Линия»→«Курсор», дропдаун SMC открытие/закрытие, heatmap on/off + localStorage, density-mode compact→auto, каталог индикаторов открытие/закрытие). Ловушка: заголовок модала — «Каталог **технических** индикаторов» (искать по testid `indicators-modal`, закрытие — `btn-close-indicators-modal`). Порт 5199 дочищен.
- Backend/марафон/guardian не тронуты (перезапуск НЕ нужен).
- **Дальше по п.1:** слайс 2 — ChartContextMenu + инспектор отскоков (JSX ~4500–4650 + state 1934+); слайс 3 — useChartDrawings (рисование/SMC/undo ~2546–2823, 3823–4009); слайс 4 — useChartOverlays; слайс 5 — useChartLifecycle (2267–2387, 3185–3476). Цель: Chart.jsx < 350 строк.

## Kimi: защита портов (anti-hijack .env) + Backend Guardian watchdog — 2026-10-23 (вечер)

- **ACTIVE_AGENT:** `kimi` (main: `e08387d`, gate **ALL QUALITY CHECKS PASSED**, pytest **448 passed**, 28 skipped)
- **Anti-hijack портов (корень вчерашнего инцидента закрыт в коде):** `runtime_binding.is_healthy_backend_running()` (GET /api/health, 2 с) + `persist_runtime_port_guarded()` — роуминг-инстанс на НЕ-preferred порту больше НЕ перезаписывает `.env` / `data/backend_runtime.json`, пока primary на preferred порту жив. Биндинг preferred порта персистит без self-probe; роуминг при мёртвом primary персистит (fallback сохранён). `main.py` переведён на guarded-вариант. Тесты: `test_runtime_binding.py` +4 (6/6).
- **Backend Guardian (риск «тихая смерть backend» — рекомендация из 4.5-инцидента):** `scripts/backend_guardian.py` — внешний watchdog: health каждые 120 с, 2 подряд неудачи → рестарт по процедуре 6.1 (Start-Process, логи `backend/logs/backend-runtime.*.log`), лимит 3 рестарта/час (далее HALT с логом), `--resume-pilot data/pilot_configs_ab_20261022.json` восстанавливает марафон (preflight+start с одним телом). **Запущен постоянно** (shim+worker PID 33732/15872, лог `backend/logs/backend_guardian.log`). ⚠️ Теперь при гибели backend марафон поднимется АВТОМАТИЧЕСКИ — A/B-часы считать от guardian-рестарта (маркер `[RESTART]`/`[PILOT]` в логе).
- **Guardian в gate не участвует** (не backend-процесс); check.ps1 зелёный с ним запущенным.
- **Марафон:** без изменений, 8-й запуск жив, guardian — страховка, не вмешательство. **По MODULARIZATION_PLAN остался только п.1 `Chart.jsx`** — 🔴, ждёт явного решения Di.

## Kimi: фикс дрейфа BACKEND_PORT (.env 8001→8000) + фоновый 15m-sync parquet — 2026-10-23 (вечер)

- **ACTIVE_AGENT:** `kimi` (main: `b84e60a`, gate **ALL QUALITY CHECKS PASSED**, pytest **444 passed**, 28 skipped)
- **⚠️ Инцидент дрейфа порта (закрыт):** gate упал на BLOCKING UI smoke — console error «Could not load drawings: Unexpected end of JSON input». Корень: `.env` и `data/backend_runtime.json` были перезаписаны в **15:55:35** значением `BACKEND_PORT=8001` / `VITE_BACKEND_PORT=8001` (механизм dynamic runtime binding из `services/runtime_binding.py` — вероятно, попытка второго старта backend при занятом :8000; процесса на 8001 нет, живой backend — PID-шим 23004 + воркер 37320, старт 15:28, слушает :8000). Vite-прокси `/api` → 8001 → ECONNREFUSED → 502 с пустым телом → падение `res.json()`. Симптом-маска: chart работал (свечи через WS/failover), ломались только REST `/api/*`. **Фикс:** `.env` и `backend_runtime.json` возвращены на 8000 (оба файла вне git). Диагностика на будущее: `curl /api/health` через :5173 → 502 + лог vite `http proxy error ... ECONNREFUSED 127.0.0.1:XXXX` = дрейф порта.
- **Задача 15m-sync (из «Открыто» прошлой записи — ЗАКРЫТО в коде):** `background_worker._sync_marathon_history()` — после gather квант-цикла инкрементальный tail-sync 15m parquet для `MARATHON_SYNC_SYMBOLS=(BTC,ETH,SOL)USDT` через `load_dataset_async(days=14)` под тем же семафором; ошибка одного символа не блокирует остальные. ETH не входит в 5m focus-лист — отдельный синк обязателен. Тесты: `test_marathon_15m_sync.py` (4; async через `asyncio.run`, pytest-asyncio в проекте НЕТ). Ветка `agent/kimi/15m-parquet-sync` влита ff.
- **Backend НЕ перезапускался** (марафон на :8000 жив с 15:28, сигнатуры совместимы) — 15m-sync активируется при следующем естественном рестарте. 15m parquet пока протух для бэктестов, раннеру не мешает (require_fresh).
- **Марафон (8-й запуск, ~3.5 ч):** все 3 сессии connected, errors=0, dq=0, telemetry healthy. BTC eval=1 (открыт LONG, equity 9979), SOL eval=1 (открыта позиция, equity 9953), ETH eval=4 / blocked=4 (гейты, позиции нет), closed=0 у всех. Сделок по-прежнему мало для A/B — morning report 24.10.
- **По MODULARIZATION_PLAN остался только п.1 `Chart.jsx`** — 🔴, ждёт явного решения Di.

## Kimi: фикс марафона evaluations=0 (протухший 15m parquet → require_fresh) — 2026-10-23 (день)

- **ACTIVE_AGENT:** `kimi` (main: `70b0bba`, gate **ALL QUALITY CHECKS PASSED**, pytest 436 passed)
- **Корень бага марафона (два слоя):** (1) `fetch_history()` отдаёт локальный parquet безусловно (fast path, дизайн для бэктестов bounded записанным периодом); (2) background worker обновляет parquet-кэш **только для 5m** — 15m файлы (BTC 21.10 22:20, ETH/SOL 22.10 16:32 +03:00) протухли на ~41 ч. Paper-раннер (15m) получал старые свечи → гейт `indicator_data` отклонял все оценки → evaluations=0, рос только `data_quality_count`. Дедлок `_last_entry_candle` был первым слоем (фикс `be07ec5`), это — второй.
- **Фикс:** `fetch_history(..., require_fresh: bool = False)` — при True parquet/in-memory кэш старше ~2 интервалов = промах, кадр перечитывается с Binance (fallback Futures→Spot→Vision). По умолчанию поведение бэктестов НЕ изменилось; в parquet ничего не пишется (инвариант сохранён). Раннер: `fetch_history(..., require_fresh=True)` (`live_paper_runner._load_indicator_context`). Тесты: `backend/tests/test_fetch_history_freshness.py` — 4/4.
- **Марафон ожил (восьмой запуск, A/B сохранён):** sessions `overnight_{btc,eth,sol}usdt_1792758627`, preflight `3baf27669cb648b2bfae519c688d1cf2`, BTC m4=True. Backend перезапущен на новом коде (~12:28 local, один процесс :8000). Через ~20 мин: ETH evaluations 1→2 (fresh), BTC и SOL — по открытой LONG-позиции, dq=0, errors=0. Детали и критерии A/B — `docs/PAPER_MARATHON.md` (запись 23.10 день).
- **⚠️ API-нюанс:** `/api/overnight-pilot/start` требует тело конфига (как `/preflight`), иначе «No current preflight matches this configuration» — передавать `--data-binary @data/pilot_configs_ab_20261022.json` в обоих запросах.
- **Открыто:** 15m parquet по-прежнему протух (раннеру не мешает, но бэктесты 15m bounded 21–22.10) — кандидат в отдельную задачу: фоновый 15m-sync для marathon-символов через `load_dataset_async`. Сделок мало для A/B-выводов — morning report завтра.
- **По MODULARIZATION_PLAN остался только п.1 `Chart.jsx`** — 🔴, ждёт явного решения Di.

## Kimi phase-6.4 п.3 (orderflow_backtester -> engine/, фин. ядро закрыто) — 2026-10-23 (вечер)

- **ACTIVE_AGENT:** `kimi` (main: `27a1378`, gate **434 passed** = 425 + сборка/смоуки; golden 30/30)
- `orderflow_backtester.py` (2225→1716, −509): вынос в `backend/app/engine/` — `strategies.py` (compute_raw_signal, if/elif-цепочка стратегий дословно), `execution.py` (simulate_execution, симуляция исполнения дословно), `monte_carlo.py` (run_monte_carlo_simulation дословно). Класс OrderFlowBacktester — тонкие делегаты; API и синглтон `orderflow_backtester` неизменны, все 9 импортёров без правок.
- **Метод переноса (обязателен для фин. ядра):** (1) фиксация границ диапазонов якорями, (2) извлечение sed, (3) **построчная norm-сверка с оригиналом до правок** (игнор отступов + единственная sanctioned-замена `self._estimate_tick_size`), (4) только после MATCH — хирургия в сервисе снизу вверх, (5) статический поиск свободных имён AST, (6) прогон golden-сценариев, (7) полный pytest, (8) gate.
- **Задокументированные семантически нейтральные отличия execution.py:** `self._estimate_tick_size`→модульная копия (staticmethod без состояния); `len(data)`→`len(ts_vals)` (массивы из той же data); `float(self.initial_capital)`→`float(initial_capital)` (из cfg). Поймано прогонами и исправлено: `use_atr_sl` не был прокинут в cfg; `safe_lev` использовался в DFC-секции run_backtest — перевычислен после делегирования.
- **Golden-контроль:** test_golden_backtest.py + test_backtest_golden_scenarios.py — 30/30 (фикстура seed 42, побитовое совпадение метрик/MC/exit-reasons). Полный pytest 434 passed, 28 skipped.
- Backend/марафон на :8000 работают на старом коде — сигнатуры совместимы, перезапуск НЕ требуется (подхватится при следующем). **По MODULARIZATION_PLAN остался только п.1 `Chart.jsx`** — 🔴, ждёт отдельного решения Di.

## Kimi phase-6.4 слайс 8 (SettingsModal -> settings/, п.8 закрыт) — 2026-10-23 (день)

- **ACTIVE_AGENT:** `kimi` (main: `a1e5191`, gate **ALL QUALITY CHECKS PASSED**; фронтенд-only слайс — pytest не менялся, 425 passed)
- `SettingsModal.jsx` (932→266, −666) разбит по п.8 MODULARIZATION_PLAN: `settings/uiConfig.js` (DEFAULT_UI_CONFIG/THEME_PRESETS/MONO_FONTS/loadLocalUiConfig/applyUiConfigToDOM — тела дословно), `settings/constants.js` (TIMEFRAMES/OVERRIDE_COINS), управляемые вкладки `AppearanceTab`/`ChartsTab`/`OrderflowTab` ({cfg, updateUi}) и `ScannerTab` ({settings, handleChange, selectedCoin, setSelectedCoin, currentCoinCfg, handleCoinOverrideChange}). Остов: state/fetch/updateUi/handleSave + шапка/таб-бар/футер.
- **Совместимость:** uiConfig-хелперы реэкспортируются из SettingsModal.jsx — `App.jsx` (loadLocalUiConfig/applyUiConfigToDOM) и `ModalsHost` (default) без правок.
- **E2E:** `scripts/verify_modularization_6_4g.py` — 6/6 PASS. Ловушки скрипта: (1) короткие метки ('5m', 'ETH') матчат чужие кнопки тулбара/чарта — все клики и проверки строго в скоупе модала (`div.fixed` с текстом «Центр настроек терминала»); (2) React не ре-рендерит в том же JS-тике — между кликом ETH и чтением label нужен sleep; (3) начальное состояние subpanes приходит с сервера (ui_config user 0) — RSI-проверка сравнивает «до/после», а не абсолют; (4) «Сохранить» пишет в SQLite → снапшот /api/settings?user_id=0 до теста и восстановление после.
- Backend/марафон не тронуты (перезапуск НЕ нужен). **По MODULARIZATION_PLAN остались:** п.3 `orderflow_backtester.py` (фин. ядро — только с golden-тестом побитового совпадения PnL/WinRate/Sharpe) и п.1 `Chart.jsx` — 🔴, ждёт отдельного решения Di.

## Kimi phase-6.4 слайс 7 (AICopilotSidebar -> copilot/, п.7 закрыт) — 2026-10-23 (день)

- **ACTIVE_AGENT:** `kimi` (main: `c124988`, gate **ALL QUALITY CHECKS PASSED**; фронтенд-only слайс — pytest не менялся, 425 passed)
- `AICopilotSidebar.jsx` (1340→585, −755) разбит по п.7 MODULARIZATION_PLAN: управляемые карточки в `frontend/src/components/copilot/` — `CopilotHeader`, `HealthMeterCard`, `ExpressAnalysisCard`, `SweepLeaderboardCard`, `DataFeedContextCard`, `AnalysisResults` (+`TradeSetupCard`, `ExpectedValueCard`, `LiquidityMagnetCard`, `VolatilityConeCard`), `QuickPromptChips`, `ChatMessages`, `constants.js` (AI_MODELS). Сайдбар — только оркестрация состояния/запросов (fetch, streaming-чат, apply-levels, sweep, экспресс-анализ).
- **Совместимость:** сигнатура пропов `isOpen/onClose/symbol/timeframe/onProjectPositionSetup/onApplyLevels` не менялась — `ModalsHost` (слайс 5) потребляет сайдбар без правок. Сентинел data-testid `ai-copilot-sidebar` сохранён.
- **E2E:** `scripts/verify_modularization_6_4f.py` — 5/5 PASS (открытие, sentinel, экспресс-анализ против живого backend — EV-карточка/Magnet/Cone, apply-levels, чат-ответ, закрытие). В скрипт добавлен `wait_for_frontend()` — гонка старта vite (port refused) лечится поллингом порта до goto. Порт 5199 дочищен.
- Backend/марафон не тронуты (перезапуск НЕ нужен). **По плану остались:** п.3 `orderflow_backtester.py` (фин. ядро — только с golden-тестом побитового совпадения PnL/WinRate/Sharpe), п.8 `SettingsModal` (~873 строки). П.1 `Chart.jsx` — 🔴, ждёт отдельного решения Di.

## Kimi phase-6.4 слайс 6 (ai_copilot.py -> сервис, п.6 закрыт) — 2026-10-23 (день)

- **ACTIVE_AGENT:** `kimi` (main: `8ae8d85`, gate **425 passed** = 395 + 30 новых)
- `backend/app/routers/ai_copilot.py` (1507→718) разбит по п.6 MODULARIZATION_PLAN: вычислительное ядро в `backend/app/services/ai_copilot_service.py` (1174 строки) — NLP-парсер, LLM-запрос, квант-хелперы market-analysis и forecast. Тела функций перенесены дословно (поведение 1:1).
- **Совместимость:** роутер реэкспортирует `compute_probabilistic_forecast`/`build_forecast_signal`/`classify_forecast_regime` — импортёры (`services/overnight_pilot.py`, тесты) не менялись. **ВАЖНО:** патчить `fetch_history` в тестах теперь только как `backend.app.services.ai_copilot_service.fetch_history` (старый таргет роутера больше не действует).
- **Дедуп без смены поведения:** ATR(14) и синтез дельты (извлечены в `compute_atr14`/`get_or_synthesize_delta`, у forecast fallback `atr<=0 → price*0.005` через параметр `fallback_price`); EV-dict — единый `build_expected_value` для обеих веток. Fan-points market-analysis и forecast НЕ унифицированы (разные key-наборы) — намеренно.
- **Латентный баг оригинала, сохранён 1:1:** если `binance_service.fetch_order_book` бросает, `bid_items`/`ask_items` остаются несвязанными → NameError в Liquidity Magnet (оригинал падал бы так же). Не чинить заодно — фикс отдельной задачей при желании.
- **Тесты:** `backend/tests/test_ai_copilot_service.py` — 30 контрактных (NLP-парсер, ATR/дельта, метрики, уровни, фаза/сетап LONG/SHORT-геометрия, health-зоны и скор, cone/magnet/EV, forecast-fan, SL/TP-цены, реэкспорты).
- Backend/марафон не тронуты (перезапуск НЕ нужен — роутер подхватится только при рестарте; живой процесс работает на старом коде, что безопасно: сигнатуры совместимы). **По плану остались:** п.3 `orderflow_backtester.py` (только с golden-тестом), п.7 `AICopilotSidebar` (~1052), п.8 `SettingsModal` (~873). П.1 `Chart.jsx` — 🔴, ждёт отдельного решения Di.

## Kimi phase-6.4 слайс 5 (App.jsx -> components/app/, п.5 закрыт) — 2026-10-23 (день)

- **ACTIVE_AGENT:** `kimi` (main: `be17e4a`, gate **395 passed**)
- `App.jsx` (1545→992, −553) разбит по п.5 MODULARIZATION_PLAN: `components/app/AppTopBar.jsx` (управляемая шапка ~470 строк; глобальные сторы `useAlertsStore`/`useLayoutStore` — прямые импорты внутри), `components/app/ModalsHost.jsx` (тосты с `getUsableMarketPrice`, hotkeys-оверлей, AICopilotSidebar, журнал, Replay, индикаторы, алерты; обёртки `onApplyLevels` (pushToast) и `onIndicatorsChange` (saveChartIndicators) перенесены дословно), `components/app/constants.js` (TIMEFRAMES/POPULAR_SYMBOLS/THEME_BADGE).
- В App остались: `handleAddWidget(id)` (единый колбэк пунктов дропдауна «+ Add Widget»: chart→setShowHtfChart+addWidgetPanel('chart'), tpo→'footprint', orderbook/dom→setShowOrderBook+addWidgetPanel(id), trades→setShowTape+addWidgetPanel('trades')), горячие клавиши ↑/↓ по `POPULAR_SYMBOLS` (константа осталась в App — импорт из constants), `THEME_CYCLE` (не выносить — используется в cycleTheme).
- **Чистка импортов:** удалено 26 неиспользуемых иконок lucide (X и Target реально используются — оставлены), default-импорты выносимых модалок; именованные `loadLocalUiConfig/applyUiConfigToDOM/loadChartIndicators/saveChartIndicators` — НЕ трогать.
- **E2E:** `scripts/verify_modularization_6_4e.py` — 6/6 PASS (таймфрейм 5m→active, деноминация USDT, дропдаун→widget-toggle-alerts→alerts-modal, журнал откр/закр, hotkeys-оверлей, центр настроек). Порт 5199 дочищен. **Маркер теста:** активный класс деноминации — `bg-neutral-800`, НЕ `bg-[#2563eb]`.
- **Ловушки слайса:** (1) пути из `components/app/` до сторов — `../../stores/...`; (2) watchlist-pills onClick → `onSymbolChange(sym)` (прокинут из App как setSymbol); (3) liq-panel кнопка — класс `border-[#e879f960]` без опечатки.
- Backend/марафон не тронуты. **По плану остались:** п.3 backend `orderflow_backtester.py` (только с golden-тестом побитового совпадения), п.6 `ai_copilot.py` (~1053 строк), п.7 `AICopilotSidebar`, п.8 `SettingsModal`. П.1 `Chart.jsx` — 🔴, ждёт отдельного решения Di.

## Kimi phase-6.4 слайс 4 (OrderBookDOM -> dom/, п.4 закрыт) — 2026-10-23 (день)

- **ACTIVE_AGENT:** `kimi` (main: `cdc654c`, gate **395 passed**)
- `OrderBookDOM.jsx` (1339→621, −718) разбит по п.4 MODULARIZATION_PLAN: `dom/useDepthStream.js` (REST deep snapshot 8 с + failover, сид aggTrades, WS @depth20@100ms + @aggTrade с автореконнектом; депс эффекта строго [symbol, baseTick]), `dom/useAggregatedOrderbook.js` (агрегация + детекция спуфа, тело useMemo 1:1, мутабельные сторы-refs передаются параметрами), `dom/DOMControlsHeader.jsx` (шапка FPS/агрегация/Центр/Настройки/Закрыть + quick settings), `dom/constants.js`. Canvas-рендер был вынесен ранее (`OrderBookCanvasLadder.jsx`) — это и есть плановый OrderBookCanvas.
- **Ловушка при переносе:** второй `setTimeout` детектора спуфа ставит `dirtyRef.current = true` — при копировании не потерять (поймал до сборки).
- **E2E:** `scripts/verify_modularization_6_4d.py` — 5/5 PASS (лестница 57 sr-only строк, FPS-бейдж, x25, quick settings, сквозной спуф-цикл simulateSpoofWall → spoof-removed-badge). Порт 5199 дочищен.
- Backend/марафон не тронуты. **Дальше по плану:** п.3 `orderflow_backtester.py` (backend, фин. ядро — только с golden-тестом побитового совпадения PnL/WinRate/Sharpe на фиксированных 500 свечах) или п.5 App.jsx (средний риск). П.1 `Chart.jsx` — 🔴, ждёт отдельного решения.

## Kimi phase-6.4 слайс 3 (OptimizerView — п.2 закрыт) — 2026-10-23 (день)

- **ACTIVE_AGENT:** `kimi` (main: `2696582`, gate **395 passed**)
- Из `BacktestPanel.jsx` (2203→1996, −207) извлечён `backtest/BacktestOptimizerView.jsx` — управляемое тело вкладок 'optimizer' (карточки До/После, OOS-валидация, лидерборд генетики top-15) и 'matrix' (связки факторов с кнопкой «Включить»). Принимает `viewTab` + derived-данные (`beforeOpt/afterOpt/oosOpt/gridRows/confluenceMatrix`) и два колбэка; `applySetup`/`applyConfluenceSetup` (store + сеттеры + rerun) остались в панели. Все data-testid 1:1.
- **П.2 MODULARIZATION_PLAN закрыт полностью**: панель 2867→1996 (−871) за 3 слайса; в `backtest/` теперь: MonteCarloEquityChart, BacktestTradesTable, BacktestPresetsBar, BacktestParametersForm, BacktestOptimizerView, format.js, constants.js, fields.jsx.
- **E2E:** `scripts/verify_modularization_6_4c.py` — 6/6 PASS (single-прогон → матрица 15 строк; «Включить» связку → appliedFeedback; генетика на 1 день → card-after-opt + лидерборд 15; «Применить лучший» → appliedFeedback). Порт 5199 дочищен.
- **Ловушка E2E (повторяется):** dockview-sash перехватывает нативные playwright-клики по кнопкам панели → кликать через `page.evaluate(el.click())` (уже в трёх verify-скриптах).
- Backend/марафон не тронуты. **Дальше по плану:** п.3 OrderBookDOM (~850 строк), п.4 `Chart.jsx` — только после явного решения (файл-гигант, AGENTS.md §5.4).

## Kimi phase-6.4 слайс 2 (PresetsBar + ParametersForm) — 2026-10-23 (ночь)

- **ACTIVE_AGENT:** `kimi` (main: `dcade1d`, gate **395 passed**)
- Из `BacktestPanel.jsx` (2690→2203, −487) извлечены по п.2 MODULARIZATION_PLAN: `backtest/BacktestPresetsBar.jsx` и `backtest/BacktestParametersForm.jsx` — оба **управляемые** (пропсы значения+колбэки); вся логика (updateSymbolParam-врапперы, applyPresetByObj, handleSavePreset, store-синхронизация) осталась в панели. Хелперы: `backtest/constants.js` (STRATEGIES/TIMEFRAMES) и `backtest/fields.jsx` (InfoTip+NumField). **ВАЖНО:** у `App.jsx` и `features/pilot/model.js` свои независимые копии STRATEGIES/TIMEFRAMES — не дедуплицировать.
- Поведение 1:1: все data-testid сохранены; стратегия в селекте формы по-прежнему НЕ зовёт updateSymbolParam (оригинальная особенность, не фиксить заодно); `handleStrategyChange` (строка ~424) — мёртвый код, оставлен нетронутым.
- **E2E:** `scripts/verify_modularization_6_4b.py` — 7/7 PASS (пресет-бар, применение пресета → appliedFeedback, сохранение пресета через UI + удаление из SQLite через API в finally, ema_trend→EMA-поля, ручной ввод SL, тоггл CVD, прогон бэктеста + monte-carlo-svg). Порт 5199 дочищен.
- Backend/марафон этим слайсом не тронуты (чистый фронтенд).

## Kimi phase-7.2 (Warning Sentinel) — 2026-10-23 (ночь)

- **ACTIVE_AGENT:** `kimi` (main: коммит feat(7.2), gate **395 passed**)
- `services/warning_sentinel.py`: rule engine (PAPER_HALTED critical / FEED_DISCONNECT warning / MARATHON_ERRORS / EQUITY_DRAWDOWN critical / LOSS_STREAK), cooldown 300 с по ключу, цикл 30 с, диспетчеризация `bot.broadcast_alert` → подписчики Telegram. `GET /api/monitoring/sentinel` — статус/алерты/снапшот. env: SENTINEL_ENABLED/INTERVAL_S/COOLDOWN_S.
- **Ложные срабатывания на старте**: первый прогон дал 3 FEED_DISCONNECT при прогреве раннеров → grace-фильтр (disconnect алертится со 2-го тика подряд, `filter_persistent_disconnects`). Проверено живьём: после рестарта+старта марафона 0 алертов. **⚠️ Ди мог получить 3 тестовых Telegram-сообщения ~00:16 — это был прогон до фикса.**
- **Backend перезапущен 2 раза за 7.2**; марафон — **10-й запуск**: `overnight_{btc,eth,sol}usdt_1792703946`, BTC m4=true, все connected. (Количество рестартов за ночь — 10; A/B-часы снова обнулились, morning report завтра.)
- 10 контрактных тестов (rule engine + cooldown + grace).

## Kimi phase-7.3 (Дневник трейдера v2) — 2026-10-23 (ночь)

- **ACTIVE_AGENT:** `kimi` (main: `377f7fa`)
- Связка paper-сделок с decision_logs: `services/session_review.py` (чистые функции; окно решение→вход 15 мин, регистронезависимо; агрегаты match rate, PnL бакетов, skipped-opportunity, bleed, MFE-R) + `GET /api/journal/session-review` (read-only) + `SessionReviewPanel.jsx` в модалке журнала. 9 тестов, gate **385 passed**.
- **Ограничение (для следующего слайса):** связка только с живой demo paper-сессией (`paper_trading_session.closed_trades` умирают с процессом). Марафонные overnight-сессии хранят deals в менеджере — при желании расширить источник сделок.
- **Backend перезапущен (8-й раз)**, марафон — 8-й запуск: `overnight_{btc,eth,sol}usdt_1792703442`, preflight из API, BTC m4=true, все connected. Morning report завтра.

## Kimi phase-2.5 (Replay-плеер lake) — ЗАКРЫТО — 2026-10-22 (ночь)

- **ACTIVE_AGENT:** `kimi` (main: `5a29623` backend, +UI-коммит этой ночи)
- Полная цепочка 2.5: engine (merge `06c4d72`) → `GET /api/replay/events` (`5a29623`, offset-курсор, limit≤2000, кэш ReplayEngine на процесс) → UI-плеер (`ReplayModal.jsx`, кнопка «⏯ Replay» в топ-баре, Play/Pause/Step/скорость 100–10k ev/s, буферизация страниц с префетчем, canvas price-series кольцо 600, стакан из последнего depth, CVD). Чистая математика — `features/replay/replayPlayerMath.js` (6 тестов, в test:pilot).
- **Баги, найденные живым прогоном:** (1) дефолт ReplayEngine указывал на несуществующий `data/recorder` → `RECORDED_DATA_DIR`; (2) bids/asks в lake-parquet — JSON-строки, итерация портила payload → `book_to_lists`; (3) фикстура ветки пишет list-колонку → numpy array при чтении, `book_to_lists` обрабатывает generic iterable.
- **E2E:** `scripts/verify_replay_ui.py` — PASS (модалка, прогресс, рост trades/depth, Step, смена скорости/символа, закрытие). **Gate:** 376 passed.
- **Backend перезапущен 2 раза этой ночью** (активация эндпоинта + фикс payload). Марафон — **7-й запуск**: `overnight_{btc,eth,sol}usdt_1792702638`, preflight `4a934e55cbfe4fbf9b1d37f7d9bdaa9d`, BTC m4=true, все connected. (Перезапуск марафона снова обнулил A/B-часы — morning report завтра.)
- **Не проверялось:** производительность плеера на окнах >1M событий (BTC total ~4.45M за 6 дней; буфер растёт страницами, фолдинг O(событий) за тик — на 10k ev/s CPU стоит посмотреть при живом использовании).

## Kimi phase-2.5 (replay engine merge) — 2026-10-22 (ночь)

- **ACTIVE_AGENT:** `kimi` (main: merge `06c4d72`)
- Влит `agent/cline/replay-engine` (2 коммита, +425 строк): `services/replay_engine.py` — детерминированный event-stream из recorder Parquet (trades+depth merge по (ts, priority, row_index), tie-break trade-before-depth, zero look-ahead, 9 тестов). Конфликт в `routers/backtest.py` — тривиальный (комментарии), разрешён.
- **Важно:** limit fill simulator (`simulate-limit-box`) уже был в main с 3.4 (`ba83631`) — ветка добавила его же; реально новое — только replay engine.
- **Баг-фикс:** ручная валидация `sl>=tp` в handler отвергала ВСЕ шорты → перенесена в side-aware `model_validator` `LimitSetupRequest` (BUY: sl<tp, SELL: tp<sl) + 5 контрактных тестов `test_limit_setup_request_validation.py`.
- **Gate:** 367 passed (+16), build, smoke, live WS — PASS.
- **Осталось по 2.5:** streaming-эндпоинт `/api/replay/events` (пагинация поверх ReplayEngine) + UI-плеер Play/Pause/Step/скорость (новая dockview-панель или модалка; подписка на эндпоинт, кадры depth → визуализация стакана/ленты).

## Kimi phase-4.5 + инцидент гибели backend + run_app.ps1 — 2026-10-22 (ночь 23:39+)

- **ACTIVE_AGENT:** `kimi` (main)
- **⚠️ Инцидент (не раскрыт):** backend (PID 17784 + дочерний интерпретатор) погиб между 23:33:18 и ~23:35. **Нет traceback в логах, нет shutdown-сообщения uvicorn, нет свежего crash-dump (в CrashDumps только от 20.10), нет WER Application Error.** Ни check.ps1, ни smoke ничего не убивают → похоже на внешнее kill-подобное завершение. Причина НЕ установлена. Если повторится — проверять, кто держал консоли/скрипты (Di?), включить ProcDump или аналог. **Рекомендация: внешний watchdog** (раз в 2–5 мин: нет /api/health → перезапуск по процедуре 6.1) — единственная надёжная защита марафона от тихой смерти процесса.
- **Восстановление (23:39):** backend перезапущен по процедуре 6.1 (Start-Process, логи backend-runtime.*.log). Шим PID 36612, реальный интерпретатор — **дочерний PID 8212** (стандартное поведение .venv-шима; gate считает «логические процессы» по parent — ок). Марафон перезапущен **6-й раз**: preflight `172e77c575a74c83816a87814815bf47`, session_id `overnight_{btc,eth,sol}usdt_1792701661`, BTC `use_m4_risk_gates=true` (конфиг `data/pilot_configs_ab_20261022.json`). Статус после старта: все `data_status=connected`, balance 10000, 0 сделок. Подробности — `docs/PAPER_MARATHON.md`.
- **run_app.ps1 восстановлен** (risk из прошлого отчёта, файл отсутствовал): создан заново, **UTF-8 with BOM** (правило из 6.3!), AST-парсинг проверен, живой прогон проверен (корректно пропустил занятый :8000, поднял/остановлен тестовый frontend). Поднимает backend+frontend, пропускает занятые порта, ждёт /api/health 60 с.
- **Gate после 4.5:** `check.ps1` PASS — **351 passed, 28 skipped**, build (19 JS-тестов в prebuild), smoke, live WS.

## Kimi phase-4.5 (WebGL-heatmap плотностей) — 2026-10-22 (вечер)

- **ACTIVE_AGENT:** `kimi` (main, коммит см. git log)
- **4.5 (ФАЗА 4 ЗАКРЫТА):** дискретные прямоугольники overlay'а `densityHeatmap` заменены непрерывной WebGL-heatmap. `frontend/src/components/DepthHeatmapGL.jsx` — canvas `absolute inset-0 z5 pointer-events-none` поверх chart-wrapper'а: WebGL point sprites (вершинный/фрагментный шейдеры, гауссов спад, аддитивный blend SRC_ALPHA/ONE), батчинг по бакетам радиуса, координаты пакетно через `chart.convertToPixel(pts, {paneId:'candle_pane'})` → **перевод в clip-space обязателен**; честный 2D-fallback (radialGradient, composite 'lighter'). Математика — `frontend/src/components/chart/densityHeatmapMath.js` (чистые функции: maxVolumeOf, pointStyle, selectDensityPoints — бюджет 65% strongest + 45% recent + дедуп, splatGeometry с dpr), юнит-тесты `densityHeatmapMath.test.js` (5 шт., подключены в `test:pilot` → prebuild). Регистрация overlay'а `densityHeatmap` из Chart.jsx удалена, `adaptDensityPoints` → state `densityPoints`.
- **⚠️ Два бага, найденных E2E (оба пофикшены):** (1) пиксели конвертировались в буфер без перевода в clip-space — все сплаты улетали за вьюпорт (glError=0, drawn>0 — молча пусто); (2) тумблер heatmap НЕ вызывал `loadHeatmap` — после загрузки свечей включение тумблера не давало точек вообще (regression при рефакторинге). Паттерн: `loadHeatmap(force)` + `if (next) loadHeatmap(true)` в обработчике.
- **⚠️ Ловушка E2E:** element-screenshot ПРОЗРАЧНОГО WebGL-canvas захватывает контент под ним → размер PNG ничего не доказывает. Правильная проверка: debug-хук `window.__depthHeatmapGL = {mode, points, drawn, glError}` + pixel-scan clip-скриншота страницы (искать bid-teal/ask-red пиксели).
- **E2E:** `scripts/verify_webgl_heatmap_ui.py` — PASS: points=42, drawn=42, glError=0, pixel scan colored=86, зум/скролл жив.
- **Backend НЕ трогали** (марафон A/B работает: `overnight_{btc,eth,sol}usdt_1792698604`, BTC m4=true). Фин. ядро не затронуто.
- **Gate:** `check.ps1` PASS — **351 passed, 28 skipped**, build (19 JS-тестов в prebuild), smoke, live WS (10 сокетов, 1500 свечей на chart_main).

## Kimi phase-6.5 (PDF-отчёт бэктеста) — 2026-10-22 (вечер)

- **ACTIVE_AGENT:** `kimi` (main, коммит `b70e3e7`)
- **6.5:** PDF-отчёт из результата бэктеста. Backend: `services/backtest_report.py` (matplotlib `PdfPages`, зависимостей не добавлялось; DejaVu Sans → кириллица ок, missing-glyph проверен). 3 страницы: (1) сводка — метрики + equity net/gross; (2) Монте-Карло — веер P5–P95/P25–P75, P50, факт, вердикт/скор/худший DD; (3) разбор сделок — **heatmap Net PnL по дням недели × часам UTC** + топ-20 сделок. Все расчёты только из payload, движок не трогает; пустые входы → страницы «нет данных». `POST /api/backtest/report` — payload = result целиком (`extra="allow"`, обязателен только symbol → 422), рендер в `run_in_threadpool`, отдача `application/pdf`. Frontend: кнопка «PDF отчёт» (`btn-export-pdf`) в строке вкладок рядом с бейджем вердикта MC (видна только при наличии result), спиннер + текст ошибки.
- **Тесты:** `test_backtest_report_pdf.py` (5): структура PDF (3 стр. по счётчику `/Type /Page` — pypdf в venv нет), устойчивость к degenerate/битым timestamp-ам, валидация модели. Gate **351 passed** (+5), build, smoke, live WS.
- **E2E:** `scripts/verify_pdf_report_ui.py` — прогон бэктеста → клик → `expect_download` → magic `%PDF-1.4`, имя `backtest_report_BTCUSDT.pdf` по контракту — PASS.
- **⚠️ Ловушка для будущих E2E-прогонов:** `vite.terminate()` убивает только npm-обёртку — node-vite выживает и держит порт 5199 (симптом: `goto` висит/ERR или грузится старый dev-server). В обоих verify-скриптах в `finally` теперь дочистка LISTENING-порта через netstat+taskkill; **важно: из python `shell=True` идёт в cmd.exe — там `taskkill /PID N /F` (один слэш!), `//PID` — ошибка «Invalid argument»**. Плюс добавлено ожидание готовности порта перед goto (гонка после рестарта backend).
- **Backend перезапущен 5-й раз (для активации эндпоинта):** марафон A/B перезапущен, preflight `12f2b5c6a653447dbbd02fdd6ec56a4a`, session_id `overnight_{btc,eth,sol}usdt_1792698604`, BTC `use_m4_risk_gates=true`. На момент рестарта 0 сделок — потерь нет. Эндпоинт проверен живым: `POST /api/backtest/report {"symbol":"BTCUSDT"}` → 200.

## Kimi phase-6.4 (модуляризация п.2) + критический фикс бэктестера — 2026-10-22 (вечер)

- **ACTIVE_AGENT:** `kimi` (main: `46fd9b5` фикс бэкенда, `03f7ca5` модуляризация)
- **6.4 (ЧАСТИЧНО):** консервативный слайс MODULARIZATION_PLAN п.2 под зелёным gate. Из `BacktestPanel.jsx` (2867→2636 строк) извлечены:
  - `frontend/src/components/backtest/MonteCarloEquityChart.jsx` — SVG equity + веер Монте-Карло, default export, без внешних зависимостей;
  - `frontend/src/components/backtest/BacktestTradesTable.jsx` — **управляемый** компонент (`trades/sortField/sortAsc/onSort/selectedId/onSelect`); состояние сортировки и выбора осталось в панели (`tradeSortField/tradeSortAsc/toggleSort/selectedTradeId/focusTradeFromTimeline`) — поведение 1:1;
  - `frontend/src/components/backtest/format.js` — `fmtTime`/`fmtPrice`, единственный источник; локальные копии и мёртвые `ArrowUp/ArrowDown` из панели удалены (`ArrowUpDown` остался — pre-existing unused, не трогал).
  - Прецедент извлечения уже был: `BacktestTradeTimeline.jsx` — повторён его паттерн импортов.
- **E2E:** `scripts/verify_modularization_6_4.py` (playwright, проектный `.venv` — в нём playwright, во встроенном python его НЕТ) — 6/6 зелёных: прогон бэктеста через UI-кнопку `btn-run-single` (это кнопка запуска, не вкладка), рендер `monte-carlo-svg`, строки `backtest-trade-row`, сортировка по «Чистый PnL» меняет порядок, клик по строке даёт подсветку `bg-sky-500/10`. Нюансы: sticky-шапка таблицы перехватывает pointer-клики playwright → клики по `th` и первой строке через `page.evaluate(el.click())`; после рестарта backend график грузится >45 с → таймаут загрузки свечей в скрипте 120 с.
- **⚠️ Критический фикс (фин. ядро):** `orderflow_backtester.py` ветвь `sl_mode=behind_wall` (active_position_setup) падала с **NameError `ask_wall_p`** с 17.10 (коммит `09a0c1d`) — переменные никогда не определены, L2 в историю не подаётся. Любой не-fast прогон с `sl_mode=behind_wall` (дефолт из UI-стора!) → 500. Gate это не ловил (тесты ходят другими ветками). Заменена ATR-буфером (`max(last_p*0.0025, last_atr*atr_multiplier)`). Найдено E2E 6.4 → curl-воспроизведение → фикс → live-проверка 200 (22 сделки, monte_carlo + active_position_setup на месте).
- **Backend перезапущен (необходим для фикса + марафону 0 сделок):** kill обоих PID (шим 71904 + интерпретатор 57360), старт по процедуре из 6.1 (Start-Process, stdout/stderr → backend-runtime.*.log). Марафон A/B перезапущен 4-й раз: preflight_id `479dfc437c194466a30992857f8201dc`, session_id `overnight_{btc,eth,sol}usdt_1792697373`, BTC `use_m4_risk_gates=true` (конфиги — `data/pilot_configs_ab_20261022.json`). Paper-раннер жив (`paper_1792697305487`, balance 100).
- **Gate:** `check.ps1` PASS — **346 passed, 28 skipped**, build, critical, blocking UI, live WS (10 сокетов).
- **Осталось по 6.4/6.5:** остальные модули плана (PresetsBar, ParametersForm, OptimizerView, DOM, `Chart.jsx` — строго сильной моделью, золотые тесты сначала), PDF/HTML отчёт бэктеста.

## Kimi phase-6.3 (M6.4) help-tooltips + фиксы рисков 6.2 — 2026-10-22 (вечер)

- **ACTIVE_AGENT:** `kimi` (main: `4828a87` риски, `cf26d21` тултипы)
- **6.3:** аудит подсказок всех форм. Добавлено: BacktestPanel (выбор стратегии — объяснение групп 🟢historical/🟠live-L2, Multi-TP, per-filter CVD/OI/ATR/RSI, имя пресета), LivePaperTradingView (все поля конфига симулятора). OvernightPilotPanel (title-атрибуты) и SettingsModal (инлайн-описания) уже были покрыты — подтверждено аудитом, не дублировал.
- **Фиксы рисков отчёта 6.2:**
  1. `main.py` — степ-логи startup (`[startup N/7]`) + явный FileHandler для `backend.log`: вскрыто, что `logging.basicConfig` был no-op (root-logger уже настроен импортом `setup_stress_logging` ДО него) — поэтому зависший процесс 21:23 не оставил следов в логе. Теперь лог живой.
  2. `check.ps1` шаг 0b — детект зависания: 1 backend-процесс, но `/api/health` молчит >60 c → FAIL с хвостом backend.log и подсказкой `Get-NetTCPConnection`. Тихие многочасовые простои марафона больше невозможны.
  3. `scripts/verify_sweep_apply_ui.py` — E2E проверка Apply Strategy #X в headless-браузере (sweep через UI-кнопку, apply, store, поля формы) — PASS.
- **⚠️ Кодировка:** `check.ps1` оказался UTF-8 **без BOM** — моя правка с кириллицей сломала парсинг PS 5.1 (та же болезнь, что у `run_app.ps1` из прошлого handoff; самого `run_app.ps1` в scripts/ НЕТ — файл отсутствует, workaround остаётся прямой запуск python). Пофикшено: файл пересохранён UTF-8 with BOM, парсинг проверен AST-парсером. **Правило для всех агентов: любой .ps1 с кириллицей — только UTF-8 with BOM; после правки проверять `[Parser]::ParseFile`.**
- **Gate:** `check.ps1` PASS — **346 passed, 28 skipped**, build, critical, blocking UI, live WS.

## Kimi phase-6.2 (M5.2) Apply Strategy #X — 2026-10-22 (вечер)

- **ACTIVE_AGENT:** `kimi` (main, коммит `ca4bb99`)
- **6.2:** кнопка «Apply Strategy #X» в AI Copilot в 1 клик. Backend: `orderflow_backtester.run_backtest` принимает `fast_period`/`slow_period` (default 20/50 — поведение не изменено; fast≥slow → ValueError; already_enriched df не мутируется — copy перед пересчётом EMA); `BacktestParams` + model_validator → 422. Frontend: секция «Quant Sweep Leaderboard» в `AICopilotSidebar.jsx` (Top-10 по OOS-скору, вердикты, «▶ Запустить sweep», refresh; при пустом сторе — честное empty-state без синтетики), apply пишет в `backtestStore` (`strategy_type=ema_trend`, fast/slow, timeframe) и диспатчит `apply-sweep-strategy` — `BacktestPanel.jsx` слушает и обновляет форму (поля Fast/Slow EMA видны при strategy=ema_trend). AI строго advisory. Тесты: `test_sweep_apply_ema_params.py` (5).
- **⚠️ Во время задачи backend умер второй раз:** процесс 21:23 (шим 82072 + воркер 85804) накапливал CPU (288 с) и 725 МБ, но НЕ держал слушающий порт (HTTP не поднимался; марафон фактически простаивал с момента рестарта). Убит оба PID, поднят заново — health за 10 с. Марафон A/B перезапущен в 3-й раз: preflight_id `08aa4acbf62b48ca9319866b5da52bcd`, session_id `overnight_{btc,eth,sol}usdt_1792694979`, BTC `use_m4_risk_gates=true`, все `data_status=connected`. Equity снова 10000 (в прошлый запуск сделок не было). Критерии сверки — `docs/PAPER_MARATHON.md`.
- **Рекомендация:** если backend снова «жив, но без порта» — сразу смотреть `Get-NetTCPConnection -State Listen` по PID воркера; не ждать. Вероятный след к расследованию: зависание startup до bind uvicorn (Telegram/parquet?).
- **Gate:** `check.ps1` PASS — **346 passed, 28 skipped**, build, critical, blocking UI, live WS — зелёные.

## Kimi phase-6.1 + рестарт backend и A/B-перезапуск марафона — 2026-10-22 (вечер)

- **ACTIVE_AGENT:** `kimi` (main)
- **6.1 (M5.1):** `backend/app/engine/sweep_leaderboard.py` + API `/api/sweep/run|leaderboard|runs` (коммит `d584a20`); M4-поля default-off в `OvernightPilotConfig` (коммит `355cd8c`). Gate PASS; **341 passed, 28 skipped**.
- **Рестарт backend разрешён Di и выполнен:** снапшот марафона до рестарта — `data/pilot_status_prerestart_20261022.json` (все 3 сессии equity 10000, **0 сделок**). Kill по PID из `netstat -ano | findstr ":8000"` (убивать оба PID: .venv-шим + реальный интерпретатор), старт: `powershell -Command "Start-Process -FilePath 'D:\AI_agent_space\gemini\.venv\Scripts\python.exe' -ArgumentList 'backend/main.py' -WorkingDirectory 'D:\AI_agent_space\gemini' -WindowStyle Minimized"`.
- **⚠️ `scripts/run_app.ps1` сломан под Windows PowerShell 5.1** (файл UTF-8 без BOM + кириллица → parse error в 5.1; pwsh на машине нет). Workaround — прямой запуск как выше. Чинить отдельной задачей (пересохранить как UTF-8 with BOM).
- **Марафон перезапущен (A/B для 5.6):** BTC с `use_m4_risk_gates=true` vs ETH/SOL с флагом OFF; session_id `overnight_{btc,eth,sol}usdt_1792693498`, preflight `ece56945259641eca011da92ac3f5614` (исторический PnL пресета отрицательный — известно, не баг). После старта проверено: все три `data_status=connected`, errors=0, у BTC блок `m4_risk_gates.enabled=true`. Критерии сверки — `docs/PAPER_MARATHON.md`.
- **Recorder-soak** (`scripts/run_recorder.ps1`, до ~24.10) рестартом backend не затронут — это отдельный процесс, не трогать.
- **Проверено после рестарта:** `/api/profile/tpo?symbol=BTCUSDT` (data_available, TPOC 81580), `/api/risk/heat-check`, `/api/verdict/evaluate` → PASS.

## Kimi phase-5.1 Position Sizer — 2026-10-22

- **ACTIVE_AGENT:** `kimi` (main)
- **5.1 (M4.2a):** `backend/app/services/position_sizer.py` — чистый расчёт поверх execution_simulator (не тронут): `fixed_fractional` (qty = equity×risk% / |entry−stop|), `budgeted_dca_ladder` (ноги против хода по offsets%, суммарный риск лестницы до общего стопа строго ≤ бюджета; доли риска на ногу, weighted_entry; нога за стопом / shares≠1 / offsets не растут → ValueError — truth-first, молча не чиним), `portfolio_heat` + `check_heat` (allowed, heat_after). API `/api/risk/position-size|dca-ladder|heat-check`, зарегистрирован в main.py (после рестарта). Тесты: `test_position_sizer.py` (12).
- **НЕ подключено:** LivePaperRunner не использует sizer — интеграция sizing-режимов + валидация на марафоне = задача 5.6. Ордеров модуль не создаёт, только расчёты.
- **5.2 (M4.2b), тот же коммит-след:** `PositionSizer.quality_multiplier(score, threshold=0.65)` — SRS-полоса 0.5–1.2× (ниже порога 0.5×, на пороге 1.0×, линейно до 1.2× при score=1.0); `adjusted_risk_budget` без скора оставляет Fixed Fractional нетронутым (mult=1.0). Опциональный `confluence_score` принимают `/api/risk/position-size` и `/api/risk/dca-ladder` (в лестнице бюджет масштабируется до расчёта ног). 15 тестов в test_position_sizer.py.

## Kimi phase-5.3/5.4 Risk Manager — 2026-10-22

- **ACTIVE_AGENT:** `kimi` (main)
- **5.4 (M4.3):** `backend/app/services/risk_manager.py::MultiLevelKillSwitch` — уровни WARNING(−3%, alert) / HALT_NEW(−5%, блок новых входов) / FLATTEN(−10%, эскалация) от high-water mark + опциональный абсолютный $-порог. Дисциплина: уровень срабатывает один раз; новый HWM fired-уровни НЕ сбрасывает; `unlock(reason, ts, rebase_hwm)` требует непустую причину (audit), rebase опционален. Валидация: severity уровней обязана эскалировать с глубиной. 7 тестов.
- **5.3 (M4.2c):** `DailyDrawdownGuard` (просадка от equity начала UTC-дня ≥ лимита → halt до конца дня, отскок halt не снимает, новый день — новая база) + `CompoundingRiskEngine` (бюджет = текущая equity × base%, 0 при halt). 3 теста.
- **НЕ подключено:** оба модуля — чистые state-machine без ордеров; интеграция в LivePaperRunner + UI-индикация = задача 5.6 (вместе с Position Sizer).
- **Gate:** `check.ps1` PASS; `pytest backend/tests` — **316 passed, 28 skipped**.
- **Напоминание:** backend не перезапускать (марафон + soak до 24.10).

## Kimi phase-5.5 Hedge Mode ledger — 2026-10-22

- **ACTIVE_AGENT:** `kimi` (main)
- **5.5 (M4.1):** `backend/app/services/hedge_ledger.py::HedgeLedger` — изолированные суб-кошельки маржи для одновременных LONG/SHORT суб-стратегий: `create_wallet(name, side)`, `allocate/deallocate` (нельзя превысить пул, нельзя снять занятую маржу), `open_position/close_position` резервируют/освобождают маржу внутри кошелька, realized PnL пишется в свой кошелёк. Isolated margin по-честному: убыток ноги клампится её маржой (`booked = max(pnl, -margin)`), излишек не перетекает в пул или чужие кошельки. `summary()` для UI. 8 тестов (`test_hedge_ledger.py`).
- **НЕ подключено:** LivePaperRunner/paper_trading остаются one-way — интеграция hedge-режима в раннер = задача 5.6 (вместе с sizer, quality multiplier, kill switch).
- **Gate:** `check.ps1` PASS; `pytest backend/tests` — **327 passed, 28 skipped**.

## Kimi phase-5.6 M4 интеграция в LivePaperRunner — 2026-10-22

- **ACTIVE_AGENT:** `kimi` (main)
- **5.6:** флаг `use_m4_risk_gates` (default OFF) в LivePaperRunner. Гейт 6.9 перед исполнением входа: `_m4_check_entry()` — дневной DD-лимит → kill switch (новые срабатывания логируются M4_KILL_SWITCH) → portfolio heat (open risk из `PaperPosition.risk_amount`); блок только входов, событие `ENTRY_BLOCKED/M4_RISK_GATE` в журнал. Quality multiplier: при наличии `confluence_score` у сигнала qty считается через `PositionSizer.adjusted_risk_budget` (база — `session.available_margin`, как у штатного сайзинга) и передаётся явно: `execute_unified_signal(signal, quantity=...)` — новый опциональный параметр в paper_trading (None → старое поведение, контракт не сломан). В статусе раннера блок `m4_risk_gates` (enabled, kill_switch_level/action, daily_dd_halted). Equity для гейтов = initial + realized (без unrealized — консервативно). M4-дефолты также в `__init__` (раньше только в start). Тесты: `test_m4_runner_gates.py` (7): default-off пропускает, три гейта блокируют, здоровое состояние пропускает, статус-блок, quantity-passthrough.
- **Осталось по 5.6:** сравнение sizing-режимов на живом марафоне — после штатного рестарта backend (пост-soak 24.10), вместе с критериями Фазы 1.3/1.4. Конфиги марафона флаг не включают — поведение текущих сессий неизменно.
- **Gate:** `check.ps1` PASS; `pytest backend/tests` — **334 passed, 28 skipped**; frontend build PASS.
- **Фаза 5 закрыта по коду (5.1–5.6).** Следующее по роадмапу: Фаза 6 (Quant Sweep leaderboard M5.1, AI Copilot Apply M5.2, help-tooltips M6.4) или 4.5 WebGL-heatmap.
- **Gate:** `check.ps1` PASS; `pytest backend/tests` — **306 passed, 28 skipped**.
- **Напоминание:** backend не перезапускать (марафон + soak до 24.10).

## Kimi phase-4.3/4.4 слои графика + тултип сделки — 2026-10-22

- **ACTIVE_AGENT:** `kimi` (main)
- **4.3 (M6.2a):** SRS-набор тумблов закрыт. Добавлен 📊 **TPO** — оверлей `tpoProfile` (гистограмма TPO влево от последней свечи, VA-подсветка, POC/TVAH/TVAL линии и подписи; данные `/api/profile/tpo`, тумбл persist `chart_tpo`, default OFF). Уже были: 🔥 Плотности, 💥 Ликвидации, 👣 Footprint (4.2), конус волатильности, toxic-regime баннер + HUD.
- **4.4 (M6.2b):** движок `orderflow_backtester` теперь эмитит per-trade `mfe`/`mae` (побарные экскурсии high/low в % от входа, инициализация на баре входа) и `fee_drag_pct` ((fees+slippage)/маржа). Тултип сделки показывает MFE/MAE в % и Fee Drag% (ранее: entry reasons, exit, fees, slippage, regime). OI-панель сознательно не делалась: потока OI нет, статус OI живёт в `context_snapshot.oi_status` (truth-first). Тест `test_trades_carry_mfe_mae_and_fee_drag`; baseline-якорь 11 сделок/261.23 не сдвинулся.
- **Gate:** `check.ps1` PASS; `pytest backend/tests` — **294 passed, 28 skipped**; frontend build PASS.
- **Напоминание:** backend не перезапускать (марафон + soak до 24.10); `/api/profile/tpo` заработает в живом UI после штатного рестарта.

## Kimi phase-4.2 Footprint на графике — 2026-10-22

- **ACTIVE_AGENT:** `kimi` (main)
- **4.2 (M1.2b) метрики (server-side):** `recorder.py::annotate_cluster_metrics` обогащает `/api/recorder/clusters`: `levels[].imbalance` ('buy'/'sell'/None, ratio ≥ 3 и объём ≥ 5% макс. уровня), `stacked_imbalance {buy, sell}` (наибольшие серии ≥ 3 соседних уровней), `absorption` (vol ≥ 1.5× медианы окна и |Δ| ≤ 20% vol). Константы IMBALANCE_RATIO/STACKED_MIN_RUN/ABSORPTION_* вынесены. Тесты: `test_footprint_metrics.py` (7).
- **4.2 UI:** оверлей `footprintCandle` в Chart.jsx — buy/sell бары по уровням внутри 5-мин бакета (ширина ∝ объёму, цвет по дельте), imbalance — яркий бордер, stacked ≥3 — ромб ♦ (amber buy / rose sell) над колонкой, absorption — фиолетовая черта ▬ под колонкой. Тумбл 👣 «Футпр.» в тулбаре (persist `chart_footprint`, default OFF), refresh 15 с, загрузка `/api/recorder/clusters?limit=48`. Сайд-панель FootprintClusters.jsx сохранена как виджет.
- **Gate:** `check.ps1` PASS; `pytest backend/tests` — **293 passed, 28 skipped**; frontend build PASS.
- **Напоминание:** backend не перезапускать (марафон + soak до 24.10); метрики в live-эндпоинте появятся после штатного рестарта. Футпринт рисуется только по свечам, накопленным in-memory recorder'ом (5-мин бакеты, последние 100).

## Kimi phase-4.1 TPO / Volume Profile — 2026-10-22

- **ACTIVE_AGENT:** `kimi` (main)
- **4.1 (M1.2a):** `backend/app/services/tpo_profile.py` — TPO (30-мин периоды, count коснувшихся бакетов) + Volume Profile из реальных записей `data/recorded/<SYM>/trades_*.parquet`. Классическая двусторонняя VA-экспансия (≥70%) отдельно по TPO (TPOC/TVAH/TVAL) и по объёму (POC/VAH/VAL); тай-брейк POC — ближе к VWAP, затем ниже цена. `infer_tick_size` подбирает круглый бакет (~200 строк). Truth-first контракт: нет принтов / все NaN → `poc_price` и все VA-границы = None (JSON null), `data_available=false`.
- **API:** `GET /api/profile/tpo?symbol&date&tick_size&period_minutes&value_area` в `api/data_routes.py` (+`available_dates` для UI-пикера). Активируется после штатного рестарта backend (марафон + soak до 24.10 — не перезапускать).
- **Тесты:** `test_tpo_profile.py` (8) — ручной расчёт TPO/VA, расхождение volume-POC и TPOC, null-контракт, валидация, авто-tick, roundtrip parquet в tmp_path. Проверено на реальных записях BTC 2026-10-21: TPOC 84664, TVAH/TVAL 84694.5/84633.5, 174 строки.
- **Gate:** `check.ps1` PASS; `pytest backend/tests` — **286 passed, 28 skipped**.
- **Дальше (4.2):** Footprint-слой в Chart.jsx на основе `/api/recorder/clusters` + TPO-оверлей на этом профиле.

## Kimi phase-3.3 strategy-weaknesses fixes — 2026-10-22

- **ACTIVE_AGENT:** `kimi` (main)
- **3.3:** 4 флага в `OrderFlowBacktester.run_backtest`, все **default-off** (марафон не тронут): `use_dynamic_breakeven` (авто-BE +0.5R — уже существовал), `use_adaptive_wall` (+`adaptive_wall_mult=2.5`, `adaptive_wall_window=50`) — per-bar rolling median(turnover)×mult вместо фиксированного $-порога; warmup NaN → сигнал не проходит. `use_time_stop` (+`time_stop_minutes=45`, `time_stop_min_r=0.3`) — market-выход по close, reason "Time Stop", taker fee. `use_maker_exits` — трейлинг лимитом по trailing_sl, maker fee, slippage 0.
- **Вскрыто:** фиксированный `min_density_usd` уже клампится внутри кода до ~median(turnover)×3.5 (строки 520–522) — «абсурдный» порог ничего не блокирует; adaptive wall убирает этот костыль полностью. Тесты переписаны под фактическое поведение.
- **Тесты:** `test_strategy_weaknesses_fixes.py` (6): time-stop вход/выкл, maker vs taker трейлинг (slippage/fee), независимость adaptive wall от `min_density_usd` + warmup, BE-флаг не меняет входы, регрессионный якорь golden (11 сделок / net_pnl 261.23 — сверено stash-прогоном с чистым main).
- **Матрица «было/стало»:** `scripts/strategy_fixes_matrix.py` → `docs/STRATEGY_FIXES_MATRIX.md` — 3×3 (BTC/ETH/SOL bybit 15m кэш × confluence_ema/ema_trend/naked_test) вместо 8×3 (8 стратегий в реестре нет). Вывод: confluence/ema_trend — убыточность режется в 3–9 раз; naked_test на BTC/ETH хуже (time-stop → ре-энтри, 157→456 сделок) — для naked_test включать только после калибровки `time_stop_minutes`.
- **Gate:** `check.ps1` PASS; `pytest backend/tests` — **278 passed, 28 skipped**.
- **Не закрыто:** паритет флагов в LivePaperRunner (управление позицией в live пока без time-stop/maker); эндпоинты/флаги активируются после штатного рестарта backend (марафон + soak до 24.10 — не перезапускать).

## Kimi phase-3.4 limit-fill simulator — 2026-10-22

- **ACTIVE_AGENT:** `kimi` (main)
- **3.4:** ветка `agent/cline/limit-fill-simulator` содержала ровно один нужный коммит `b55a804` (от 18.10); перенесён в main без мержа устаревшей ветки: `backend/app/services/limit_fill_simulator.py` (детерминированная симуляция одного limit-ордера по 1m-барам строго после `created_at_ts`, zero look-ahead, maker/taker fees, adverse slippage на SL) + эндпоинт `POST /api/backtest/simulate-limit-box` (портирован на актуальный `backtest.py` с `fetch_history`) + 9 тестов. Старая ветка больше не нужна для этой задачи.
- **Gate:** `check.ps1` PASS; `pytest backend/tests` — **272 passed, 28 skipped**.
- **Напоминание:** backend не перезапускать (paper-марафон + recorder soak до 24.10).

## Kimi phase-3.5 indicator registry — 2026-10-22

- **ACTIVE_AGENT:** `kimi` (main)
- **3.5 (M2.1):** VWAP-плагин проверен и полон. Добавлен OI-плагин `backend/app/services/indicators/plugins/open_interest.py`: truth-first — без реальной колонки `oi`/`open_interest` dataframe возвращается без изменений; при наличии — `oi_delta`, `oi_delta_pct`, сигналы `OI_BUILDUP`/`OI_FLUSH`. Registry теперь покрывает полный SRS-набор M2.1 (EMA, RSI, ATR, VWAP, CVD, VolumeSpike, OI) — зафиксировано тестом `test_registry_covers_full_srs_m21_set`. Тесты: `test_indicator_registry_srs.py` (7).
- **Gate:** `check.ps1` PASS; `pytest backend/tests` — **263 passed, 28 skipped**; frontend build PASS.
- **Напоминание:** backend не перезапускать (paper-марафон + recorder soak до 24.10).

## Kimi phase-3.2 verdict v2 — 2026-10-22

- **ACTIVE_AGENT:** `kimi` (main)
- **3.2 (M3.3) Verdict v2:** `backend/app/engine/verdict.py` — формальный traffic-light контракт: BLOCK (Net PnL < 0 после комиссий / < 10 сделок / TOXIC_VOLATILITY), WARNING (PF ∈ [1.0, 1.2) / 10–29 сделок / стратегия требует L2 при отсутствии L2-истории → флаг `L2 History: No data`), PASS. `allows_live_paper=False` только у BLOCK. API `POST /api/verdict/evaluate`. Интеграция: каждая строка `overnight-pilot/status` теперь несёт `verdict` (для OHLCV-бэктеста wall-стратегий честно стоит WARNING + L2-флаг). UI: `VerdictBadge` (🟢/🟡/🔴 с тултипом причин) в сводке `OvernightPilotPanel.jsx`.
- **Gate:** `check.ps1` PASS; `pytest backend/tests` — **256 passed, 28 skipped**; frontend build PASS.
- **Напоминание:** backend не перезапускать (paper-марафон + recorder soak до 24.10); новые эндпоинты активируются после штатного рестарта.

## Kimi phase-3.1 confluence — 2026-10-22

- **ACTIVE_AGENT:** `kimi` (работаем в `main`, тег `stable-20261022` после слияния фаз 1–2)
- **3.1 (M2.3) Weighted Confluence:** `backend/app/engine/confluence.py` — Strict AND (обязательные факторы, дефолт `wall`) + взвешенный скор мягких факторов; валидация Σw=1, порог по SRS 0.65; `ConfluenceConfigStore` persist `data/confluence_weights.json` per-symbol. Поле `confluence_score` добавлено в `UnifiedTradeSignal` (опциональное, обратная совместимость подтверждена тестами контракта). API `/api/confluence/*` (factors, weights GET/PUT, score). UI: вкладка **Confluence** в SettingsModal (`ConfluenceWeightsEditor.jsx`) — редактор весов с клиентской проверкой Σw=1, нормализацией, порогом, Strict-AND чекбоксами.
- **Важно:** скоринг пока НЕ подключён к OrderFlowBacktester/LivePaperRunner — это отдельный шаг (кандидат на expert-модель, тесты сначала). Эндпоинты появятся в живом backend после штатного рестарта (идёт paper-марафон, не перезапускать).
- **Gate:** `check.ps1` PASS; `pytest backend/tests` — **242 passed, 28 skipped**; frontend build PASS.

## Kimi phase-2 recorder — 2026-10-22

- **ACTIVE_AGENT:** `kimi`
- **Ветка:** `agent/kimi/phase2-recorder`
- **2.1 recorder локально:** `recorder.local.yaml` (lake_root `data/lake`) + `scripts/run_recorder.ps1 -Action start|stop|status`; recorder запущен (PID в `data/recorder.local.pid`, лог `data/recorder.local.log`) параллельно со старым recorder'ом backend'а. **Soak 48 ч до ~2026-10-24 18:12** — потом сверить gap-журнал (`data/gaps/recorder-local-1.jsonl`) и только затем выключать старый. Известное: сетевые обрывы Binance раз в ~1–2 мин (`no close frame received`), reconnect и честный gap-журнал работают.
- **2.2 (M1.3a) watchlist-driven подписки:** `background_worker` публикует активный watchlist в `data/active_watchlist.json` (init + каждый set/toggle); recorder читает файл (`watchlist_file` в конфиге), мержит с tier1 и ротирует подписки на лету закрытием сокета. Тесты: `test_recorder_watchlist.py`, `test_active_watchlist_persistence.py`.
- **2.3 (M1.3b) Wall TTL + Auto-режим:** `backend/app/services/wall_settings.py` (WallSettings persist `data/wall_settings.json`, WallTracker с TTL-квалификацией ≥$500k/15с, AutoDensityCalibrator P99 / K×median с честным fallback на manual при <20 наблюдений) + роутер `/api/walls/*` (settings GET/PUT, observe, track, qualified). Тесты: `test_wall_settings.py` (9). **Живой backend не перезапускался — эндпоинты появятся после штатного рестарта** (сейчас идёт paper-марафон Фазы 1).
- **2.4 (M1.1) Data Manifest:** `recorder/manifest.py`, CLI `python -m recorder manifest --config recorder.local.yaml` → `data/data_manifest.json` (диапазоны ts, row_count, сегменты с sha256, даты, гэпы по symbol/stream). Тесты: `test_recorder_data_manifest.py`.
- **Gate:** `scripts/check.ps1` — PASS; `pytest backend/tests` — **231 passed, 28 skipped** (было 212). Коммит на ветке.
- **Не закрыто из Фазы 2:** 2.5 (replay-плеер), 2.6 (L2-honest бэктест — ждёт ≥7 дней lake). Frontend-привязка DOM к `/api/walls/*` — отдельная задача.

## Kimi phase-1 start — 2026-10-22

- **ACTIVE_AGENT:** `kimi`
- **Ветка:** `agent/kimi/phase1-paper-production-robust`
- **Фаза 1.1 (ROADMAP):** пресет `production_robust` уже соответствовал спецификации (vol_mult 1.25, R:R = 2.2/0.8 = 2.75, SL 0.8, TP 2.2, фильтры ATR/CVD/RSI); добавлен недостающий тест `test_production_robust_live_runner_enforces_neutral_rsi_band_42_58`, фиксирующий RSI-полосу 42–58 в `LivePaperRunner._passes_live_indicator_filters` для `confluence_ema`. Targeted: 21 passed, 6 skipped.
- **Фаза 1.2:** запущен paper-марафон production_robust через `night-pilot.ps1 -Action preflight|start -Preset production_robust -ApiBase http://127.0.0.1:8000`: BTCUSDT/ETHUSDT/SOLUSDT, `confluence_ema` 15m, session_id `overnight_btcusdt_1792680718` / `overnight_ethusdt_1792680718` / `overnight_solusdt_1792680718`, `paper_data_status=connected`, `errors=0`, equity $10000 каждая, риск 0.5%, плечо 2x.
- **⚠️ Предупреждение для следующего агента:** исторический backtest пресета отрицательный (BTC −4.72% / 44 сделки / PF 0.38, ETH −4.01%, SOL −3.96%). Это честные fee-aware результаты, не баг; критерии перехода Фазы 1.4 (PF ≥ 1.2) на текущей геометрии, скорее всего, не выполнятся — morning reports вести по ROADMAP 1.3 и фиксировать расхождение backtest vs live paper.
- **Gate:** полный `scripts/check.ps1` после правок — PASS (`ALL QUALITY CHECKS PASSED. READY TO COMMIT.`).
- **Важно:** не перезапускать backend и не глушить paper-сессии — идёт марафон Фазы 1.3.

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
