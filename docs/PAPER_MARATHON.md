# PAPER_MARATHON.md — Журнал paper-марафона (Фаза 1.3 / валидация 5.6)

> Morning reports и ключевые события марафона production_robust на BTC/ETH/SOL.
> Команда отчёта: `scripts/night-pilot.ps1 -Action report` (read-only).

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
  `scripts/run_app.ps1` под Windows PowerShell 5.1 сломан (UTF-8 без BOM + кириллица → parse error) — отдельная задача.
- Recorder-soak (`scripts/run_recorder.ps1`, до ~24.10) — независимый процесс, рестарт backend его не затрагивает.
- Не запускать второй backend: gate (check.ps1 шаг 0) падает при >1 процессе.
