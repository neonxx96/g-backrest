# Work Queue

This is the shared queue for LibreChat, Cline, and Antigravity.

## Statuses

- `DRAFT` — task is being prepared.
- `IN_PROGRESS` — currently being implemented by the active agent.
- `READY_FOR_CLINE` — Cline may claim the task.
- `READY_FOR_ANTIGRAVITY` — Antigravity reviews or implements the explicitly assigned part.
- `NEEDS_USER_DECISION` — work pauses for a product, design, or architecture decision.
- `DONE` — acceptance criteria and checks passed.

## Master Plan Reference

- Полный план по блокам: [`docs/archive/superpowers/plans/2026-10-25-positive-trading-roadmap.md`](file:///d:/AI_agent_space/gemini/docs/archive/superpowers/plans/2026-10-25-positive-trading-roadmap.md)
- Действующий квантовый план оптимизации: [`docs/WIN_RATE_IMPROVEMENT_PLAN.md`](file:///d:/AI_agent_space/gemini/docs/WIN_RATE_IMPROVEMENT_PLAN.md)

## Active & Prioritized Queue (по блокам, утверждено Di 2026-10-25)

1. `DONE` — **БЛОК 1 (`tasks/004-block1-footprint-and-cluster-strategies.md`)**:
   - **1.1. Удобные и настраиваемые Кластера (`FootprintPanel` + `/api/recorder/clusters`)**: режимы отображения (`Bid×Ask`, `Delta`, `Volume`, `Imbalance`), шаг агрегации цены (`1x/2x/5x/10x`), настройка порогов имбаланса/stacked/absorption, подсветка POC внутри каждой свечи, боковой профиль объёма.
   - **1.2. Подключение кластерных индикаторов к стратегиям (`cluster_filters.py`)**: фильтры `use_stacked_imbalance_filter`, `use_absorption_filter`, `use_poc_migration_filter` в `OrderFlowBacktester`, `strategies.py`, `LivePaperRunner` и `OvernightPilot`.
   - **1.3. Оптимизация базового R:R в стратегиях (Fee-Aware R:R Engine)**: параметризация оптимизатора через `(stop_loss_pct, rr_ratio)`, защита от Fee Drag и автоматический подбор R:R `2.0..3.5` с Multi-TP.
   - **1.4. Фикс загрузки истории свечей при сдвиге часов ПК и обрезки кнопок тулбара (`ChartToolbar.jsx`, `marketDataFetcher.js`, `binance.py`, `routes.py`, `historical_data_loader.py`)**.

2. `DONE` — **БЛОК 2 (`tasks/005-block2-selective-dynamic-sl-tp.md`)**:
   - Селективный динамический расчет SL/TP (`sl_tp_mode`: `fixed` | `atr_cone` | `magnet_hybrid` | `auto_calibrated`).
   - Применение `magnet_hybrid` (ATR + Liquidity Magnet из стакана) для глубоких стаканов (`BTC`, `ETH`, `BNB`, `XRP`), `atr_cone` — для волатильных альткоинов, `auto_calibrated` — автовыбор по результатам бэктест-калибровки на конкретной паре (70% train-срез, Zero Look-Ahead).

3. `DONE` — **БЛОК 3 (`tasks/006-block3-ai-sentinel-profit-retention.md`)**:
   - Двухуровневое удержание прибыли (борьба с MFE Bleed):
     - Уровень 1 (Quant 0ms): Fee-Adjusted Breakeven, Step-Lock MFE Trailing, Smart Time-Stop + реакция на встречную кластерную Absorption (`evaluate_profit_lock_action`).
     - Уровень 2 (Event-Driven OpenRouter AI Sentinel): вызов по триггерам `EarlyExitEngine` с безопасным контрактом (`HOLD`, `TIGHTEN_SL`, `PARTIAL_CLOSE_50`, `EARLY_EXIT_MARKET`) и жестким запретом на расширение риска (`clamp_protective_stop`).


5. `IN_PROGRESS` — **БЛОК 5 (Задача 008: Expectancy, Regime Classifier, Post-Mortem & Pair Selector)**:
   - ✅ Квантовый риск-движок (`risk_engine.py`): сайзинг от Stop Loss, Portfolio Heat 1.25%, потолок плеча 5.0x.
   - ✅ Двухтаймфреймовый классификатор рыночных фаз (`regime_classifier.py`) и микроструктурный фильтр стакана.
   - ✅ Долговечное хранение метрик качества исполнения ($MFE_R$, $MAE_R$, $E_R$) в `signals.db`.
   - ✅ Сервис пост-мортем анализа закрытых сделок (`trade_postmortem_service.py`) и эндпоинт `/api/paper-trading/analytics/post-mortem`.
   - ✅ Вкладка «Аналитика & Винрейт» (`PostMortemAnalyticsTab.jsx`) с визуализацией причин потерь и рекомендаций.
   - ✅ Селектор стратегий под монеты с OOS-валидацией (`pair_selector.py`) и 1-клик запуск марафона (`/api/overnight-pilot/auto-select`).
   - 🔄 **Текущий этап**: Ночной марафон на 7 отобранных парах (ZEC, BNB, ENA, WLD, UNI, TIA, TRX) в Docker.

4. `READY_FOR_CLINE` — **БЛОК 4 (Редизайн UI на shadcn/ui и темная тема)**:
   - ✅ **Функционал модуля «По парам» и «Претенденты» готов**: сортировка, sticky-колонка, фильтры, быстрый выбор популярных монет, сетапы конуса и стакана.
   - ⏸ **Оформление и дизайн**: запланировано для выполнения в отдельной сессии/чате с подключением библиотеки дизайна shadcn/ui (Vite Dark Mode) согласно документации пользователя.

## Completed Tasks

- `DONE` — **003-phase1-production-robust-closeout** (`tasks/003-phase1-production-robust-closeout.md`)
- `DONE` — **004-block1-footprint-and-cluster-strategies** (`tasks/004-block1-footprint-and-cluster-strategies.md`)
- `DONE` — **005-block2-selective-dynamic-sl-tp** (`tasks/005-block2-selective-dynamic-sl-tp.md`)
- `DONE` — **006-block3-ai-sentinel-profit-retention** (`tasks/006-block3-ai-sentinel-profit-retention.md`)

## Rules

1. Only one agent may have an active task at a time.
2. The task file is the authority for scope, allowed files, acceptance criteria, and tests.
3. Agents must append their report to `HANDOFF.md` and run `scripts/check.ps1` before committing.
