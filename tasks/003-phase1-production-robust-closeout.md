# Задача: Closeout ROADMAP Фазы 1.1–1.2 — production_robust + Night Pilot CLI

> **ПРАВИЛО ОДНОЙ ЗАДАЧИ:** Один файл — одна изолированная задача. Агент берет задачу, переводит её статус в `IN_PROGRESS`, выполняет, прогоняет `scripts/check.ps1` и переводит в `DONE`.

---

## 🎯 1. Цель задачи
Завершить и синхронизировать ROADMAP Фазу 1.1–1.2: подтвердить кодом и тестами пресет
`production_robust` (vol_mult 1.25, RSI 42–58, SL 0.75–0.80%, TP ≥ 2.2%, R:R ≥ 2.75:1,
BTC/ETH/SOL, paper-only) и контракт Night Pilot CLI (`scripts/night-pilot.ps1`), закрыть
оставшийся дефект CLI (morning-таблица подменяла отсутствующие WinRate/NetPnL нулями).

---

## 🤖 2. Рекомендуемый класс модели
- [x] **Сильная модель** (Kimi Work, main):
  * Сквозная RSI-цепочка через три движка (бэктест/forecast/live), интеграционный preflight-маппинг.

---

## 📂 3. Белый список разрешённых файлов (Strict Whitelist)
Агенту **РАЗРЕШЕНО** создавать или модифицировать ТОЛЬКО следующие файлы:
1. `scripts/night-pilot.ps1`
2. `backend/tests/test_phase1_production_robust_closeout.py`
3. `tasks/003-phase1-production-robust-closeout.md`
4. `context/CURRENT_TASK.md`, `context/WORK_QUEUE.md`, `context/COORDINATION_STATE.json`,
   `context/AGENT_MESSAGES.md`
5. `HANDOFF.md`, `ROADMAP.md` (только отметки/секции итогов по 1.1–1.2)

> ⚠️ **ЗАПРЕЩЕНО ТРОГАТЬ:** `execution_simulator.py`, recorder, `Chart.jsx`, `orderflow_backtester.py`
> (RSI-полоса 42–58 уже реализована в движке — дублировать не нужно), активные paper-сессии,
> работающий backend-процесс.

---

## 🚫 4. Что находится ВНЕ рамок задачи (Out of Scope)
- [ ] Не запускать и не останавливать активные paper-сессии; не перезапускать backend.
- [ ] Не запускать марафон 3–5 суток (команда для отдельного запуска — в отчёте, сам не запускаю).
- [ ] Никаких реальных ордеров, API-ключей, деплоя, новых UI-модулей.
- [ ] Не менять молча параметры стратегий (P1-параметры — к обсуждению с Di).

---

## ✅ 5. Критерии приёмки (Acceptance Criteria)
1. `production_robust_configs()` подтверждён кодом: vol_mult=1.25, RSI-фильтр включён
   (полоса 42–58 в движке), SL=0.8, TP=2.2 (R:R=2.75), BTC/ETH/SOL, ai_control=False (paper-only).
2. RSI 42–58 прослежена через BacktestParams (preflight) → forecast strategy_params →
   движок бэктеста (`explain_latest_signal`/`evaluate_latest_signal`) → LivePaperRunner;
   покрыта точечными тестами без дублирования существующих.
3. `scripts/night-pilot.ps1`: порт по умолчанию 8000; production_robust маппится на существующие
   preflight/start/report контракты; обязательный успешный preflight перед start сохранён;
   Warning Sentinel предупреждает о блокировках входов и fee drag; morning-таблица показывает
   отсутствующие WinRate/NetPnL/TotalFees как «—», а не 0.0.
4. Обязательный единый прогон качества:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/check.ps1
   ```
   *Вывод должен завершаться строкой `[OK] ALL QUALITY CHECKS PASSED. READY TO COMMIT.`*

---

## 📋 6. Чек-лист выполнения агентом
- [x] Проверен `HANDOFF.md` перед началом.
- [x] Создана ветка: `agent/kimi/phase1-production-robust-closeout`.
- [x] Внесены изменения строго в файлы из белого списка.
- [x] Выполнен скрипт проверки: `powershell -ExecutionPolicy Bypass -File scripts/check.ps1`.
- [x] Обновлен `HANDOFF.md` с отчетом о проделанной работе.
- [x] Сделан атомарный коммит с осмысленным сообщением.

## Итог
- Статус: DONE (2026-10-24). Подробности — в HANDOFF.md и отчёте агента §7.
