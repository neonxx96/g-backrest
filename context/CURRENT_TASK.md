# Current Task: Задача 008 — Квантовая трансформация: Expectancy Engine, Market Regime Classifier и Risk Engine

## Status
- **Status**: IN_PROGRESS (Этапы 1–3 завершены, тесты 100% зеленые)
- **Task Specification**: `tasks/008-situation-analysis-and-winrate-boost.md`
- **Architectural Plan**: `docs/WIN_RATE_IMPROVEMENT_PLAN.md` & `QUANT_TRANSFORMATION_PLAN.md`
- **Recommended Model**: `Claude Sonnet 3.5 / Expert` (Quantitative Analysis, Risk & Microstructure)
- **Gate**: `powershell -ExecutionPolicy Bypass -File scripts/check.ps1`

## Immediate Starting Point for the Agent
1. **Текущий статус**:
   - Реализован квантовый риск-движок (`risk_engine.py`) со строгим сайзингом от дистанции SL, лимитом Portfolio Heat (1.25%), Directional Heat (0.75%), динамическим штрафом за корреляцию ($\lambda=0.6$) и потолком плеча 5.0x.
   - Реализован двухтаймфреймовый классификатор рыночных фаз (`regime_classifier.py`) с Choppiness Index (CI-14), 288-барным скользящим перцентилем ATR и BBW, а также Microstructure Gate (спред <= 5 bps, глубина >= $5k, дисбаланс $I_{depth}$, CVD-абсорбция).
   - База SQLite мигрирована без потери истории сделок.
   - В UI выведено матожидание `Expectancy (R)`.
   - Шлюз `scripts/check.ps1` полностью пройден (570 тестов pytest, 85 тестов frontend, critical smoke 8/8, Playwright blocking + live 100% OK).
   - Сформирован скрипт запуска пула из топ-8 ликвидных пар `scripts/launch_overnight_8pairs.py`.
2. **Следующие шаги реализации**:
   - Запуск ночного марафона по топ-8 парам на 5m/15m.
   - Сбор сравнительной статистики телеметрии (старая версия vs новая) на одинаковом историческом срезе данных.
   - Пост-мортем анализ сделок (`trade_postmortem_service.py`) с детальным анализом MFE/MAE распределения.

## Roadmap Checklist
- [x] **Этап 0**: Диагностика узких мест по закрытым сделкам (Fee Drag, MFE Bleed, боковик, спуфинг)
- [x] **Этап 1**: Разработка математической квант-модели и архитектурного плана (`QUANT_TRANSFORMATION_PLAN.md`)
- [x] **Этап 2**: Квантовый риск-движок (`risk_engine.py`): сайзинг от SL, Portfolio Heat (1.25%), корреляционный дисконт, Circuit Breakers, флаг Pyramiding=False
- [x] **Этап 3**: Классификатор рыночных фаз (`regime_classifier.py`) и микроструктурный фильтр (`microstructure_gate`)
- [x] **Этап 4**: Миграция схемы `paper_trade_records` в SQLite (`signals.db`), адаптация `paper_trading.py` и `live_paper_runner.py` для раздельного хранения плеча биржи и effective_leverage, расчет `mfe_r`, `mae_r`, `realized_r`, `expected_r`
- [x] **Этап 5**: Отображение Net Expectancy ($E_R$) в `TradeHistoryWidget.jsx`
- [ ] **Этап 6**: Сравнительный бэктест/демо-тест старой и новой версии на одинаковых рыночных данных
- [x] **Этап 7**: Пост-мортем анализатор закрытых сделок (`trade_postmortem_service.py`) с детальной MFE/MAE аналитикой

## Execution Log
- 2026-10-26 Задача 008: Завершена реализация квантового ядра терминала. Реализован `backend/app/services/risk_engine.py` и `backend/app/services/regime_classifier.py`. Интегрированы в `live_paper_runner.py` и `paper_trading.py`. Проведена безопасная миграция `data/signals.db` с сохранением всех 82 сделок. Добавлены 10 модульных тестов `test_risk_engine_and_regime.py`. Единый шлюз качества `scripts/check.ps1` успешно пройден (0 ошибок).
- 2026-10-27 Этап 7: добавлен backend/app/services/trade_postmortem_service.py (классификация потерь FEE_DRAG/MFE_REVERSAL/STALE_TIME_OUT/ADVERSE_EXIT/BAD_ENTRY/STOP_OUT, MFE/MAE, Fee Burden Index, рекомендации по ТФ/стратегии), эндпоинт GET /api/paper-trading/analytics/post-mortem?period=&symbol=, тесты test_trade_postmortem.py (4). На реальной БД (82 сделки): WR 36.6%, FBI 0.87, главная причина потерь STOP_OUT (30), затем FEE_DRAG (10).
