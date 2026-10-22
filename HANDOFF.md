# HANDOFF.md — Протокол передачи контекста между агентами

> Перед началом работы: прочитать `AGENTS.md` и этот файл, выполнить `git status`, затем запустить `powershell -ExecutionPolicy Bypass -File scripts/check.ps1`. Агенты работают строго последовательно.

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
