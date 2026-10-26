# Задача: Блок 1 — Удобные настраиваемые Кластера + Кластерные фильтры в стратегиях + Оптимизация R:R

> **ПРАВИЛО ОДНОЙ ЗАДАЧИ:** Один файл — одна изолированная задача. Агент берет задачу, переводит её статус в `IN_PROGRESS`, выполняет, прогоняет `scripts/check.ps1` и переводит в `DONE`.

---

## 🎯 1. Цель задачи
Реализовать **Блок 1** плана `docs/superpowers/plans/2026-10-25-positive-trading-roadmap.md`:
1. **Сделать панель Кластеров (`FootprintPanel.jsx`) удобной, красивой и настраиваемой:**
   - Добавить настройки шага агрегации цены (`scale: 1x, 2x, 5x, 10x`), режима отображения ячеек (`Bid×Ask`, `Delta`, `Volume`, `Imbalance`), числа свечей (`10, 14, 20, 30`) и порога имбаланса (`200%, 300%, 400%`).
   - Выделить POC внутри каждой отдельной свечи, добавить индикацию миграции POC и боковой мини-профиль объёма за видимое окно.
2. **Подключить кластерные индикаторы напрямую к стратегиям и бэктестеру:**
   - Реализовать модуль `backend/app/engine/cluster_filters.py` (Zero Look-Ahead) с 3 фильтрами:
     - `use_stacked_imbalance_filter` (подтверждение импульса серией имбалансов / доминантой дельты);
     - `use_absorption_filter` (лимитное поглощение на откатах/уровнях);
     - `use_poc_migration_filter` (фильтр направления смещения объёмного центра свечей).
   - Пробросить фильтры в `strategies.py`, `orderflow_backtester.py`, `live_paper_runner.py`, `overnight_pilot.py`.
3. **Оптимизировать базовое соотношение Risk:Reward в стратегии и оптимизаторе:**
   - Внедрить Fee-Aware R:R оптимизацию: подбор пары `(stop_loss_pct, rr_ratio)` с защитой от Fee Drag (требование `R:R >= 2.0` при коротких стопах и автоматическая привязка `tp1_rr_ratio` / `tp2_rr_ratio`).
4. **Исправить инфраструктурный баг `scripts/check.ps1`:**
   - Обернуть `Get-CimInstance Win32_Process` в `try/catch`, чтобы шлюз качества не падал при ограниченных правах WMI/CIM.

---

## 🤖 2. Рекомендуемый класс модели
- [x] **Сильная модель (Expert)**:
  * Математика кластерных индикаторов, логика бэктеста и оптимизатора R:R, связка с live-раннером и UI футпринта.

---

## 📂 3. Белый список разрешённых файлов (Strict Whitelist)
1. `scripts/check.ps1`
2. `backend/app/services/recorder.py`
3. `backend/app/api/data_routes.py`
4. `backend/app/engine/cluster_filters.py` (новый)
5. `backend/app/engine/strategies.py`
6. `backend/app/services/orderflow_backtester.py`
7. `backend/app/routers/backtest.py`
8. `backend/app/services/live_paper_runner.py`
9. `backend/app/services/overnight_pilot.py`
10. `frontend/src/components/docking/footprintGrid.js`
11. `frontend/src/components/docking/FootprintPanel.jsx`
12. `backend/tests/test_cluster_filters_and_rr.py` (новый)
13. `frontend/src/components/docking/footprintGrid.test.js` (новый или обновлённый тест)

---

## 🚫 4. Что находится ВНЕ рамок задачи (Out of Scope)
- [x] Не менять глобальную дизайн-систему терминала (отложено до Блока 4).
- [x] Не менять сетевые порты (`8000`, `5173`) и путь к базе (`data/signals.db`).
- [x] Не использовать `Math.random()` для генерации котировок или кластеров.

---

## ✅ 5. Критерии приёмки (Acceptance Criteria)
1. В `FootprintPanel` работает настройка шага агрегации цены, переключение режимов (`Bid×Ask`, `Delta`, `Volume`, `Imbalance`), пороги имбаланса, подсветка POC каждой свечи и боковой профиль объёма.
2. Стратегии в `OrderFlowBacktester` и `LivePaperRunner` поддерживают `use_stacked_imbalance_filter`, `use_absorption_filter`, `use_poc_migration_filter` без заглядывания в будущее (Zero Look-Ahead).
3. Оптимизатор подбирает `R:R` с защитой от Fee Drag, отсекая заведомо убыточные из-за комиссий мелкие тейки.
4. Все новые и существующие тесты проходят зелёным (`pytest` + `node --test` + `npm run build`).
