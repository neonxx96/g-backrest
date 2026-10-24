# PAPER_MARATHON.md — Журнал paper-марафона (Фаза 1.3 / валидация 5.6)

> Morning reports и ключевые события марафона production_robust на BTC/ETH/SOL.
> Команда отчёта: `scripts/night-pilot.ps1 -Action report` (read-only).

## 2026-10-23 (~14:50 local) — Morning report по шестому запуску (сессии `1792701661`, ~15 ч прогона)

**Источник:** `night-pilot.ps1 -Action report` (read-only; дефолт порта скрипта исправлен 8002→8000 — AGENTS.md §5.3).

| Символ | Роль | Paper Equity | Сделок | WinRate | Fees | Data |
|---|---|---|---|---|---|---|
| BTCUSDT | тест (M4 ON) | 10000.00 | **0** | — | $0 | connected |
| ETHUSDT | контроль | 10000.00 | **0** | — | $0 | connected |
| SOLUSDT | контроль | 10000.00 | **0** | — | $0 | connected |

- **M4-события (BTC):** 0 — `M4_BLOCK`/`M4_KILL_SWITCH` не регистрировались (нечего блокировать: входов не было).
- **NO_ENTRY=0** у всех трёх — отказов/блокировок входа не было; входы просто не возникали.
- Базовый бэктест 30 дней (референс): BTC ROI −4.72% (44 сделки), ETH −4.01% (41), SOL −3.96% (45); PF ~0.4 — конфиг production_robust на месячном окне истории убыточный, это референс, а не live-результат.
- Forecast: все три NO_TRADE, причина «нет данных по фильтрам — volume_multiplier, ema20_cross (rsi_filter у ETH)». **Вопрос к проверке:** формулировка указывает на отсутствие live-входных данных фильтров, а не на их непрохождение; при 44 сделках/30дн ≈ 1.5/день ноль сделок за 15 ч правдоподобен (~40%), но data-path live-фильтров стоит верифицировать отдельно до выводов по A/B.
- **Вывод по A/B:** дифференциал M4-гейтов не наблюдается (сделок нет у всех). Марафон продолжается; следующий report — утром 24.10 (целевой горизонт 1.3: 3–5 суток).

## 2026-10-22 (23:33–23:39 local) — Третья гибель backend и шестой запуск марафона

**Событие:** backend (PID 17784, шим; интерпретатор — дочерний) **погиб между 23:33:18
(последняя строка лога: scanner pass) и ~23:35** — `curl :8000` → connection refused.
Диагностика: traceback в логах ОТСУТСТВУЕТ (uvicorn не писал shutdown — процесс убит
намертво), свежего crash-dump нет (`python.exe.*.dmp` в CrashDumps — от 20.10), WER
Application Error событий нет, check.ps1/smoke ничего не убивают. Похоже на внешнее
kill-подобное завершение — **причина не установлена, отмечено в HANDOFF**.

**Шестой запуск марафона (A/B-дизайн сохранён, конфиг `data/pilot_configs_ab_20261022.json`):**

| Символ | session_id | use_m4_risk_gates | Роль |
|---|---|---|---|
| BTCUSDT | `overnight_btcusdt_1792701661` | **true** | Тестовая группа |
| ETHUSDT | `overnight_ethusdt_1792701661` | false | Контрольная группа |
| SOLUSDT | `overnight_solusdt_1792701661` | false | Контрольная группа |

- Preflight: `172e77c575a74c83816a87814815bf47` (valid).
- Backend перезапущен 23:39:35 (шим PID 36612, интерпретатор 8212; health ok за ~10 c).
- Состояние после старта: все три `data_status=connected`, balance 10000, 0 сделок
  (пятилетки сессий `1792698604` успели прожить ~15 мин — потерь нет).
- Риск неповторимости: причина гибели процесса неизвестна — рекомендован внешний
  watchdog (см. HANDOFF «Риски»); morning report имеет смысл завтра (`night-pilot.ps1 -Action report`).

## 2026-10-22 (вечер, ~22:50 local) — Второй рестарт backend (зависание без порта)

**Событие:** процесс backend, поднятый при первом рестарте (~21:23), накапливал CPU (288 с)
и память (725 МБ), но **не держал слушающий порт** — HTTP-сервер не поднялся, марафон
фактически простаивал. Обнаружено при падении gate smoke (connection refused).
Убиты оба PID (шим .venv + воркер), backend перезапущен (health за 10 с).
Потерь по сделкам нет: у всех трёх сессий по-прежнему 0 сделок.

**Третий запуск марафона (A/B-дизайн сохранён):**

| Символ | session_id | use_m4_risk_gates | Роль |
|---|---|---|---|
| BTCUSDT | `overnight_btcusdt_1792694979` | **true** | Тестовая группа |
| ETHUSDT | `overnight_ethusdt_1792694979` | false | Контрольная группа |
| SOLUSDT | `overnight_solusdt_1792694979` | false | Контрольная группа |

- Preflight: `08aa4acbf62b48ca9319866b5da52bcd` (исторический PnL пресета тот же: отрицательный, известно).
- Состояние после старта: все три `data_status=connected`, у BTC `m4_risk_gates.enabled=true`.
- След к расследованию зависания: startup до bind uvicorn (Telegram/parquet?) — отдельная задача.

## 2026-10-22 (вечер) — Рестарт backend и A/B-перезапуск марафона

**Событие:** Di разрешил рестарт backend. Марафон, запущенный утром (`overnight_*_1792680718`),
к моменту рестарта имел **0 сделок** по всем трём символам (equity 10000 у всех) —
снапшот до рестарта сохранён: `data/pilot_status_prerestart_20261022.json`.

**Новый запуск (A/B-дизайн для валидации M4, задача 5.6):**

| Символ | session_id | use_m4_risk_gates | Роль |
|---|---|---|---|
| BTCUSDT | `overnight_btcusdt_1792693498` | **true** | Тестовая группа (гейты M4: дневной DD-лимит 3%, kill switch, portfolio heat 6%, quality multiplier) |
| ETHUSDT | `overnight_ethusdt_1792693498` | false | Контрольная группа |
| SOLUSDT | `overnight_solusdt_1792693498` | false | Контрольная группа |

- Preflight: `ece56945259641eca011da92ac3f5614` (valid; исторический PnL пресета отрицательный:
  BTC −4.72%/44t, ETH −4.01%/41t, SOL −3.96%/45t — известно, не баг).
- Конфиг: `production_robust`, duration_hours 96, equity 10000.
- Состояние после старта: все три `data_status=connected`, errors=0.

**Критерии сверки A/B (при появлении сделок):**

1. Winrate и Net PnL: BTC (M4 on) vs среднее ETH/SOL (M4 off).
2. Fee drag (`fee_drag_pct`) по закрытым сделкам.
3. Срабатывания гейтов в логах BTC: события `M4_BLOCK` / `ENTRY_BLOCKED/M4_RISK_GATE` и
   `M4_KILL_SWITCH` — должны появляться только у BTC и только как блоки входов (никогда не блок выходов).
4. Max drawdown: ожидаем ограничение просадки у BTC относительно контроля.

**Операционные заметки:**

- Backend стартует напрямую: `.venv/Scripts/python.exe backend/main.py` (минимизированное окно).
  `scripts/run_app.ps1` восстановлен 2026-10-22 (UTF-8 with BOM, AST-проверка, живой прогон):
  поднимает backend+frontend, пропускает компонент, если порт занят, ждёт /api/health до 60 с.
- Recorder-soak (`scripts/run_recorder.ps1`, до ~24.10) — независимый процесс, рестарт backend его не затрагивает.
- Не запускать второй backend: gate (check.ps1 шаг 0) падает при >1 процессе.

## 2026-10-23 (день, ~13:30–15:50 local) — Корень evaluations=0 найден: протухший 15m parquet; фикс require_fresh; восьмой запуск

**Симптом:** после фикса дедлока (`be07ec5`) раннер стал доходить до загрузки индикаторов, но
все оценки по-прежнему отклонялись: `Blocked by: indicator_data (stale requires fresh)`,
evaluations=0, растёт только `data_quality_count`.

**Корень (два слоя):**

1. `fetch_history()` (backtest.py) имеет fast path: локальный parquet отдаётся безусловно,
   если в нём ≥50 строк (осознанный дизайн — бэктесты ограничены записанным периодом).
2. Но parquet-файлы **15m никто не обновляет**: background worker пишет в кэш только 5m
   (`_process_ticker`/`auto_optimize_strategies`). `BTCUSDT_15m.parquet` кончался
   21.10 22:20 (+03:00), ETH/SOL 15m — 22.10 16:32. Раннер получал свечи ~41-часовой давности,
   гейт свежести (`interval + 60s` на close свечи) отклонял всё.

Изолированный repro: прямой вызов `_load_indicator_context()` → `indicator_last_update
= 1792610100000` (age ≈ 40,8 ч), `indicator_data_status: connected`, fresh check = False.

**Фикс (коммит `70b0bba`):** `fetch_history(..., require_fresh: bool = False)`.
При `require_fresh=True` parquet older ~2 интервалов трактуется как промах (и in-memory TTL
кэш проверяется на свежесть), кадр перечитывается с Binance (fallback-цепочка
Futures→Spot→Vision, 8s таймауты). Бэктесты по умолчанию не меняются — по-прежнему bounded
записанным периодом. Раннер вызывает с `require_fresh=True`. В parquet ничего не дописывается
(инвариант backtest-бounded сохранён). Регрессионные тесты: `test_fetch_history_freshness.py` —
4/4 (stale-served-by-default / stale-skipped-fresh / fresh-served / in-memory не отравлен).
Gate: ALL QUALITY CHECKS PASSED (436 passed), живой WS-smoke 12 сокетов.

**Восьмой запуск марафона (A/B сохранён):**

| Символ | session_id | use_m4_risk_gates | Роль |
|---|---|---|---|
| BTCUSDT | `overnight_btcusdt_1792758627` | **true** | Тестовая группа |
| ETHUSDT | `overnight_ethusdt_1792758627` | false | Контрольная группа |
| SOLUSDT | `overnight_solusdt_1792758627` | false | Контрольная группа |

- Preflight: `3baf27669cb648b2bfae519c688d1cf2`. Backend перезапущен на новом коде
  (~12:28 local, один процесс, health ok).
- **Нюанс API:** `/start` требует тело конфига (как и `/preflight`), иначе fingerprint
  не совпадёт: «No current preflight matches this configuration». Правильно:
  `curl -X POST ".../start?preflight_id=..." --data-binary @data/pilot_configs_ab_20261022.json`.

**Подтверждение оживления (~15:50, через ~20 мин):**

- ETH: evaluations 1→2, `indicator fresh`, entry_ready True, dq=0.
- BTC: evaluations 1, **открыта LONG 0.0765 @ 81698.8** (EMA20 cross up, Volume ratio 6.05x,
  Delta +2011.75), equity 10000.91, есть paper-алерт Time_Stop «Momentum lost» (штата-логика).
- SOL: evaluations 1, **открыта LONG 59.76 @ 104.59** (Volume ratio 1.72x, Delta +11929.10),
  equity 9970.01 (позиция в просадке −0.27R — живой риск, не баг).
- `indicator stale` у BTC/SOL между закрытиями свечей — норма (оценки только на close 15m).

**Критерии сверки A/B из записи 22.10 остаются в силе** (winrate/Net PnL BTC vs ETH+SOL,
fee drag, события M4_BLOCK/M4_KILL_SWITCH только у BTC, max drawdown).

**Открытые наблюдения:**

- 15m parquet до сих пор протух — это не мешает раннеру (require_fresh читает сеть), но
  бэктесты на 15m остаются bounded записями до 21–22.10. Обновлять parquet умеет
  `load_dataset_async(force_refresh=False)` — вопрос отдельной задачи (фоновый sync 15m
  для marathon-символов или on-demand refresh при backtest).
- Сделок пока мало для A/B-выводов — morning report завтра (`night-pilot.ps1 -Action report`).

**Девятый и десятый запуски (23.10 вечер) — fix guardian resume:**

- Найден дефект: guardian-резюм марафона **никогда не работал** (3 причины: критерий
  живости `len(sessions)>0` ловил мёртвый снапшот; resume только после собственного
  рестарта backend; `start` без `preflight_id` → 400). Исправлено в
  `scripts/backend_guardian.py` + 8 тестов (`test_guardian_pilot_liveness.py`,
  `test_guardian_resume_pilot.py`), коммит `263ee5c`.
- 9-й запуск `overnight_*_1792758627` — поднят вручную после чистки двух сиротских
  backend-деревьев (одно держало :8000 без движка марафона). Подтверждение: все
  `is_running=True`, data connected.
- 10-й запуск `overnight_*_1792778547` — **поднят автоматически новым guardian-ом**
  после контрольного рестарта backend (проверка фикса end-to-end: health up ~130 с,
  PILOT_UP ~140 с). Зафиксировано как валидация guardian-fix.
- Разбор сделок (7.3) теперь видит марафон: `/api/journal/session-review?source=all|demo|marathon`
  (commit `851c4b4`) — closed_trades марафонных сессий подтягиваются в журнал разбора.

**Наблюдение за 10-м запуском (~30 мин, 23.10 ~21:20 local):**

| Символ | m4 | evals | blocked | open/closed | Оценка |
|---|---|---|---|---|---|
| BTCUSDT | true | 1 | 1 | 0/0 | NO_TRADE (volume_multiplier, ema20_cross) |
| ETHUSDT | false | 1 | 1 | 0/0 | NO_TRADE (те же фильтры) |
| SOLUSDT | false | 1 | 1 | 0/0 | NO_TRADE (те же фильтры) |

- Отказы — штатные entry-фильтры стратегии (одинаковы у теста и контроля), **не**
  M4_BLOCK. Сделок пока нет — A/B-различий ждём накопления выборки.
- data errors = 0 у всех; оценки идут на close 15m (1 evaluation за ~30 мин — норма).

## 2026-10-24 (вечер, ~17:55 local) — Одиннадцатый запуск: scalp-марафон 14/14 (сессии `1792844719`, старт 15:25)

Конфигурация: 14 символов (BTC/ETH/SOL/XRP/BNB/DOGE/LINK/ZEC/NEAR/ENA/WLD/SUI/UNI/AVAX),
ema_trend 5m, $1k × 10, 168 ч; M4-гейты только у BTC (A/B сохранён). Live-раннер вне марафона:
DOTUSDT quant_confluence 15m $1k×10 ai_control=true (Di переключал через UI). Backend не
перезапускался с 15:25; data_status=connected и data errors=0 у всех 14 сессий — инфраструктура чистая.

**Наблюдение за ~2.5 ч прогона (17:55):**

| Метрика | Значение |
|---|---|
| Всего оценок | 308 (по 3–31 на сессию — оценки на close 5m, запуск молодой) |
| Заблокировано входов | 303 (98.4%) |
| Причина №1 | `ema_cross` — 302 (цена внутри пояса между EMA-зонами, конфликт направлений) |
| Причина №2 | `volume_multiplier` — 99 (коэф. 0.5 vs ночной/дневной оборот) |
| Причина №3 | `minimum_turnover` — 47 |
| Закрытые сделки | 5 (XRP −$5.8, BTC −$16.1, ZEC −$8.4, SUI −$15.6, AVAX −$15.0) |
| Открытые позиции | 0 |

- Блокировки `ema_cross` — **штатный фильтр ema_trend**: вход разрешён только когда цена
  однозначно выше/ниже обеих EMA-зон; в текущем боковике цена ~98% времени внутри пояса.
  Подтверждает P1 «редкость сигналов» из ночного теста 23–24.10 (ema_cross ≈ 66% блоков
  тогда; сейчас ещё выше). Параметры стратегии не менялись — решение об ослаблении фильтра
  / смене стратегии за Di (пороги ROADMAP 1.4).
- A/B: M4_BLOCK/M4_KILL_SWITCH у BTC нет (гейт просто не доходил до проверки — входы режет
  стратегия раньше), выводы о M4 пока преждевременны.
- `preflight_valid=False` у всех сессий — известный P1 (TTL), на live-оценки не влияет.
- Live-раннер DOTUSDT quant_confluence: 0 сделок, отказы `strategy_conditions` — стратегия
  жёсткая, ждём накопления выборки.
- Вывод на утро 25.10: morning report (`night-pilot.ps1 -Action report`) — ожидаем рост
  числа оценок до ~200+/сессия; если сделок снова ≤1–2 за ночь — это не баг инфраструктуры,
  а свойство ema_trend-фильтра в боковике, и вопрос выносится Di как решение по параметрам.
