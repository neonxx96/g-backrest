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
