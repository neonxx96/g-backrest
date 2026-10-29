# SignalScript: рабочая карта системы

Этот документ — точка входа перед изменением функционального блока. Он не
заменяет [ARCHITECTURE.md](ARCHITECTURE.md): там стабильные границы и потоки;
не заменяет [CODEMAP.md](CODEMAP.md): он автоматически перечисляет символы.
Здесь указано, где менять поведение и что обязательно проверить рядом.

## Быстрый выбор области

| Если нужно изменить… | Сначала читать | Затем проверить |
| --- | --- | --- |
| запуск, preflight, добавление/паузу/закрытие пары | `backend/app/routers/overnight_pilot.py`, `backend/app/services/overnight_pilot.py` | `backend/tests/test_overnight_pilot.py`, `test_pilot_max_sessions.py` |
| paper-ордер, позицию, SL/TP, kill switch или запись сделки | `paper_trading_router.py`, `paper_trading.py`, `live_paper_runner.py` | `test_paper_trading.py`, `test_paper_position_management.py`, `test_paper_kill_switch_and_forecast.py` |
| риск, размер позиции, плечо или pyramiding | `risk_profile.py`, `risk_engine.py`, `live_paper_runner.py` | `test_risk_profile_contract.py`, `test_execution_risk_hardening.py` |
| каталог, описание или доступность стратегии | `strategy_catalog.py`, затем `pair_selector.py`, `overnight_pilot.py`, `live_paper_runner.py` | `test_strategy_catalog.py`, `test_pair_selector_configs.py` |
| исторический подбор стратегии для пары | `pair_selector.py`, `strategy_catalog.py`, `orderflow_backtester.py`, `routers/backtest.py` | `test_pair_selector_configs.py`, `test_strategy_catalog.py` |
| фильтры рынка, L2/CVD, режим или admission | `regime_classifier.py`, `microstructure_gate.py`, `engine/verdict.py`, `overnight_pilot.py` | `test_market_snapshot_contract.py`, `test_paper_feed_health.py` |
| экран марафона, таблицу пар или UI управления | `TradeHistoryWidget.jsx`, `paperPairs.js`, `marathonFeed.js`, `OvernightPilotPanel.jsx` | соответствующие `*.test.js`, затем Vite build |
| историю и пост-мортем сделок | `db/models.py`, `recorder.py`, `trade_postmortem_service.py`, `paper_trading_router.py` | `test_trade_postmortem.py`, миграционные тесты |

## Владельцы и контракты

| Блок | Назначение и ключевые точки | Вход → выход |
| --- | --- | --- |
| Pilot API | `overnight_pilot.py`: `/strategies`, `/preflight`, `/start`, `/auto-select`, `/pairs` pause/resume/close | catalogue/status/config → JSON metadata, status/preflight с `config_fingerprint` |
| Pilot manager | `OvernightPilotManager`: валидирует общие лимиты, запускает backtest/forecast, создаёт shared wallet и runner на пару | список конфигов → `PilotSession`, task-циклы, persisted snapshot |
| Strategy catalogue | `strategy_catalog.py` — versioned metadata и capability flags для всех historical paper strategies; это единственный источник состава списков | stable ID → metadata, selector/optimizer/runner capability |
| Selection | `run_selection()` выбирает только catalogue candidates, ищет strategy/TF/SL/TP на TRAIN и проверяет OOS; `build_pilot_configs()` создаёт профиль | закрытые OHLCV → `SELECT`/`EXPLORE`/`SKIP`/`NO_DATA` |
| Paper execution | `PaperTradingSession` хранит один виртуальный счёт; `LivePaperRunner` получает сигнал, применяет риски, открывает/ведёт/закрывает позицию и журналирует решение | runner config + market snapshot → position/orders/trades/status |
| Risk | `SharedRiskProfile` нормализует публичные проценты; `risk_engine.py` считает размер от SL, portfolio/directional heat, circuit breaker и добавление слоя | balance, stop, positions, regime → allow/reject и quantity |
| Market quality | `regime_classifier.py` классифицирует CI/ATR/BBW и microstructure; provider/collector отмечают свежесть и полноту данных | OHLCV/L2/CVD → regime, data status, gate reason |
| Frontend | `OvernightPilotPanel` управляет preflight/start; `TradeHistoryWidget` отображает shared account; `paperPairs.js` формирует строки; `marathonFeed.js` устраняет дубли общего счёта | API status/events → user-visible rows, positions, PnL |

## Сквозные сценарии

### 1. Подготовка и запуск paper-марафона

1. UI или клиент отправляет `OvernightPilotConfig` в `/preflight`.
2. `OvernightPilotManager._prepare()` запускает backtest и свежий forecast; конфиг получает fingerprint и run id.
3. `/start` принимает только точно совпадающий preflight. Manager создаёт один `PaperTradingSession` и один `LivePaperRunner` на каждую пару.
4. `LivePaperRunner` получает реальные публичные market-data snapshots, но никогда не вызывает приватный exchange-order API.
5. Статус manager-а агрегируется без умножения общего баланса на число пар и показывается в `TradeHistoryWidget`.

### 2. Admission: история не равна критической безопасности

- `SELECT`/`EXPLORE`/`SKIP`/`BLOCK` — результат исторической оценки и OOS-качества.
- В demo-наблюдении историческая метка может быть информационной, но не отменяет технические veto: отсутствующие данные, несовпадающий или устаревший preflight, disconnected forecast, `TOXIC_VOLATILITY`, отсутствие сигнала, sizing и shared-risk limits.
- Любое изменение порогов должно быть явным конфигом, отображаться в UI, попадать в fingerprint и иметь тест для стандартного, diagnostic и observation режимов. Не добавлять скрытый endpoint, отключающий проверки.

### 3. Подбор стратегии без остановки действующей пары

1. `pair_selector.run_selection()` или новый challenger-сервис работает на закрытых исторических свечах и не трогает активный runner.
2. Результат хранит dataset window, strategy parameters, TRAIN/OOS и версию оценки.
3. Новая конфигурация становится кандидатом; заменить действующую можно только отдельным действием после свежего preflight и risk validation.

### 4. Сделка и пост-мортем

1. `LivePaperRunner` фиксирует reason, risk budget, entry/exit и MFE/MAE в `paper_trade_records`.
2. `trade_postmortem_service.analyze_from_db()` группирует результаты и причины потерь.
3. `GET /api/paper-trading/analytics/post-mortem` передаёт аналитику вкладке истории сделок.

## Матрица изменения

| Намерение | Минимальный набор затрагиваемых контрактов | Проверка |
| --- | --- | --- |
| новая стратегия | `strategy_catalog.py`, registry в backtest/runner, стратегия, UI options | catalogue metadata + deterministic backtest + selector + runner adapter |
| новый параметр позиции | `OvernightPilotConfig`, fingerprint, runner, UI form, persistence | config validation + stale preflight + paper position test |
| новый admission-порог | mode policy, verdict explanation, UI visibility | standard/observation mode + hard-veto regression |
| изменение общей суммы риска | `SharedRiskProfile`, risk engine, manager validation, status | percent-vs-fraction + shared-account regression |
| изменение общего счёта или агрегатов | paper session, manager aggregate, `marathonFeed.js` | singleton account + UI feed unit test |
| изменение market-data поля | provider/collector, data-status contract, consumer | snapshot-contract + disconnected-data regression |

## Обязанность обновления

Обновляйте эту карту в том же коммите, если меняются public route, межмодульный поток, владелец функции, конфигурационный/данный контракт или пользовательский сценарий. Локальный рефакторинг с сохранением контракта не требует обновления. Всегда обновляйте `ARCHITECTURE.md` для изменения устойчивой структуры или потоков и регенерируйте `CODEMAP.md` для изменения исходного API.
