# Task 005: Блок 2 — Селективный динамический расчёт SL/TP через конус волатильности (ATR) и уровни Liquidity Magnet

- **Класс задачи**: `expert`
- **Связанный мастер-план**: `docs/superpowers/plans/2026-10-25-positive-trading-roadmap.md` (Блок 2)
- **Статус**: IN_PROGRESS

## 1. Цель задачи
Реализовать адаптивный выбор и расчёт уровней Stop-Loss / Take-Profit (`sl_tp_mode`: `fixed` | `atr_cone` | `magnet_hybrid` | `auto_calibrated`) в зависимости от структуры ликвидности конкретной пары:
1. На глубоких стаканах (`BTCUSDT`, `ETHUSDT`, `BNBUSDT`, `XRPUSDT`) крупные лимитные плотности в L2-стакане работают как реальные магниты цены (`magnet_hybrid` — стоп по ATR/за плотность, тейк на 2–3 тика перед лимитной стенкой при условии `effective_rr >= 1.8`).
2. На высоковолатильных альткоинах (`SOLUSDT`, `DOGEUSDT`, `SUIUSDT`, `NEARUSDT`), где стенки в стакане часто спуфятся, применяется чистый конус волатильности (`atr_cone` — стоп за границей шума `k_sl * ATR_14`, тейк по границе `1σ/1.5σ` конуса с контролем Fee-Aware R:R).
3. В режиме `auto_calibrated` бэктестер и ночной пилот автоматически сравнивают `fixed`, `atr_cone` и `magnet_hybrid` на историческом окне конкретной монеты (без заглядывания в будущее) и выбирают режим с лучшим Net Profit Factor.
4. При `sl_tp_mode="fixed"` (по умолчанию) поведение бэктестера остаётся 100% идентичным эталонным тестам (`test_golden_backtest.py`).

## 2. Затрагиваемые файлы
- `backend/app/engine/dynamic_sl_tp.py` (новый модуль селективного расчёта SL/TP и автокалибровки по парам)
- `backend/app/engine/execution.py` (поддержка `tp2_mode="atr_cone"` и `magnet_hybrid` в симуляторе исполнения)
- `backend/app/services/orderflow_backtester.py` (параметр `sl_tp_mode`, автокалибровка на train-окне без look-ahead)
- `backend/app/routers/backtest.py` (поддержка `sl_tp_mode` в `BacktestRequest`)
- `backend/app/services/live_paper_runner.py` (применение `sl_tp_mode` с реальным ATR и live L2-стенками в `_detect_setup` / `_historical_signal`)
- `backend/app/services/overnight_pilot.py` (назначение оптимального `sl_tp_mode` в `SYMBOL_PRESETS` по парам)
- `backend/app/services/ai_copilot_service.py` (обогащение `synthesize_sl_tp_prices` селективным режимом)
- `backend/tests/test_selective_dynamic_sl_tp.py` (юнит-тесты Блока 2)
