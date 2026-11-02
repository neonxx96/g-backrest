# Задача 009: Закрытие runtime-хвостов SignalScript v0.1

## Статус

- **Status:** IN_PROGRESS
- **Owner:** Codex
- **Source:** handoff Kimi от 2026-11-02

## Цель

Закрыть стартовый этап v0.1: исключить потери кластерных aggTrades при реконнекте recorder, убрать блокировку event loop при Parquet flush под марафоном из 20 пар и подтвердить пользовательские сценарии paper-only.

## Разрешённые файлы

- `backend/app/services/recorder.py`
- `backend/tests/test_recorder_runtime.py`
- `backend/tests/test_v01_runtime_verification.py`
- `backend/tests/test_runtime_responsiveness.py`
- `backend/app/routers/backtest.py`
- `backend/app/routers/overnight_pilot.py`
- `backend/app/routers/monitoring.py`
- `backend/app/routers/paper_trading_router.py`
- `backend/app/services/live_paper_runner.py`
- `scripts/verify_v01_runtime.py`
- `docs/ARCHITECTURE.md`
- `docs/SYSTEM_WORKING_MAP.md`
- `docs/CODEMAP.md`
- `PROGRESS.md`
- `HANDOFF.md`
- `tasks/009-v01-runtime-closeout.md`
- `docs/superpowers/plans/2026-11-02-v01-runtime-closeout.md`

## Вне рамок

- Реальные биржевые ордера.
- Изменение портов `8000`, `7100` или пути `data/signals.db`.
- Изменение стратегий, риск-лимитов, раскладок или UI.
- Рефакторинг standalone recorder и соседних сервисов.

## Критерии приёмки

1. Recorder использует Binance Futures `aggTrade` ID и восполняет пропуск REST `/fapi/v1/aggTrades` перед обработкой live-потока после старта/реконнекта без дублей.
2. Parquet flush не выполняет pandas/файловый I/O в event loop и не запускается конкурентно.
3. За 30 минут BTCUSDT scale=1 не появляются пропущенные 5m свечи после начала окна наблюдения, объём текущей свечи растёт.
4. Под работающим марафоном 10 минут: `/api/health` median < 300 ms, p95 < 800 ms.
5. Пользовательские сценарии v0.1 подтверждены доступными автоматизированными и runtime-проверками; ограничения наблюдения отражены честно.
6. `powershell -ExecutionPolicy Bypass -File scripts/check.ps1` завершается `ALL QUALITY CHECKS PASSED. READY TO COMMIT`.

