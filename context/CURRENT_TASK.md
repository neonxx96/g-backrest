# Current Task: Closeout ROADMAP Фазы 1.1–1.2 — production_robust + Night Pilot CLI (2026-10-24)

## Status
- **Priority**: DONE
- **Agent**: Kimi Work (main)
- **Branch**: `agent/kimi/phase1-production-robust-closeout`
- **Task file**: `tasks/003-phase1-production-robust-closeout.md`

## Completed
- ✅ Пресет `production_robust` подтверждён кодом и тестами: vol_mult 1.25, RSI-фильтр ON
  (полоса 42–58 в движке для confluence_ema), SL 0.8 / TP 2.2 (R:R 2.75), BTC/ETH/SOL,
  ai_control=False (paper/consultative-only)
- ✅ RSI 42–58 прослежена сквозь цепочку: BacktestParams (preflight `_prepare`) →
  forecast `strategy_params` → движок бэктеста → LivePaperRunner; полоса уже была в коде,
  дублирования не внесено; новые точечные тесты `backend/tests/test_phase1_production_robust_closeout.py` (5 passed)
- ✅ `scripts/night-pilot.ps1`: дефект morning-таблицы закрыт — отсутствующие WinRate/NetPnL/TotalFees
  показываются как «—», а не 0.0; порт 8000, preflight-гейт, sentinel (NO_ENTRY + FEE DRAG) подтверждены
- ✅ Gate зелёный перед коммитом

## Notes
- `context/CURRENT_TASK.md` в рабочем дереве содержал случайно вставленный markmap-SVG
  (незакоммиченная порча); восстановлен осмысленный формат по правилам проекта.
- Активный марафон 14/14 и live-раннер НЕ тронуты; backend не перезапускался.

## Next
- Отдельная задача (по команде Di): paper-марафон 3–5 суток на production_robust /
  продолжение текущего теста; критерии 1.3/1.4 (PF ≥ 1.2, max DD, fee drag) — на утверждении Di.
