# PROGRESS.md — Текущий статус разработки SignalScript

> **ЕДИНЫЙ ИСТОЧНИК ПРАВИЛ:** [AGENTS.md](file:///d:/AI_agent_space/gemini/AGENTS.md).
> Полный архив ранних отчетов (MVP фазы) сохранен в [docs/archive/PROGRESS_20261018.md](file:///d:/AI_agent_space/gemini/docs/archive/PROGRESS_20261018.md).

---

## 1. Текущий статус системы (Октябрь 2026, Этап Квантовой Трансформации)

| Модуль / Подсистема | Статус | Детали реализации |
|---|---|---|
| **Frontend Core & Charts** | `READY` | React 19, KLineCharts v9, Canvas 2D стакан с кластерами и подсветкой плотностей, лента сделок, скринер спарклайнов. Порт `7100`. |
| **Backend Core & DB** | `READY` | FastAPI на `uvicorn` (порт `8000`), aiosqlite `data/signals.db`. Миграция `paper_trade_records` с поддержкой Expectancy. |
| **Order Flow Lake & Recorder** | `READY` | Ring-buffer в `data/spool/`, Parquet Lake `data/lake/`, суточные файлы `data/recorded/` по 16 парам. |
| **Market Regime Classifier** | `ACTIVE` | Двухтаймфреймовый (5m/15m) Choppiness Index (CI-14), ATR/BBW перцентили. Блокирует тренд в боковике и контртренд в импульсе. |
| **Microstructure Gate** | `ACTIVE` | Проверка спреда, глубины коридора 0.5%, дисбаланса стакана $I_{depth}$ и дивергенции CVD перед открытием позиции. |
| **Risk Engine & Sizing** | `ACTIVE` | Сайзинг строго от Stop Loss с вычетом комиссий (Taker 0.05% x 2) и проскальзывания. Portfolio Heat 1.25% с учетом висящих лимиток. |
| **Circuit Breakers** | `ACTIVE` | Защитное отключение при дневной просадке >= 3.0% или 4 убыточных сделках подряд. |
| **Position Sentinel** | `ACTIVE` | Dynamic Breakeven (+1.0R с учетом издержек), Step-Lock уровни (1.2R / 1.8R), сброс 50% при неблагоприятном ордерфлоу от +0.7R. |
| **Pyramiding (Доборы)** | `DISABLED` | `ENABLE_PYRAMIDING = False` строго соблюдается до этапа сравнительного бэктестирования. |
| **Trade Post-Mortem & Analytics** | `ACTIVE` | Авто-анализ MFE/MAE, Fee Burden Index, классификация причин потерь, вкладка UI «Аналитика & Винрейт». |
| **Strategy & TF Pair Selector** | `ACTIVE` | Автоподбор стратегий/ТФ под монеты с OOS-валидацией (TRAIN 70% / OOS 30%). 1-клик API и UI запуск. |
| **Overnight Paper Marathon** | `RUNNING` | 7 валидированных пар в Docker (ZECUSDT SELECT, BNB/ENA/WLD/UNI/TIA/TRX EXPLORE) на $1000. |

---

## 2. Последние пройденные контрольные вехи

1. **Задача 007 (Chart Engine & Footprint)**:
   - Внедрена кастомная отрисовка футпринта на Canvas KLineCharts, мозаичные панели Dockview, устранена утечка ре-рендеров.
2. **Задача 008 (Expectancy & Quantum Risk Engine)**:
   - Полный отказ от ориентации на сырой Win Rate.
   - Переход на Net Expectancy ($E_R > 0$) с явным учетом издержек, проскальзывания и рыночных фаз.
   - Разделение биржевого залогового плеча (`leverage`) и отношения номинала к капиталу (`effective_leverage`).
3. **Pre-Paper Run целевой аудит**:
   - Верифицированы все пути входа через `LivePaperRunner` без байпаса.
   - Включен учет зарезервированного риска активных входных лимитных заявок в общий лимит Portfolio Heat.
   - Единый проверочный шлюз `scripts/check.ps1` подтвержден (Exit Code = 0).

---

## 3. Следующие шаги
- Запуск целевого ночного paper-марафона на корзине 8 топ-ликвидных монет (`BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `BNBUSDT`, `XRPUSDT`, `DOGEUSDT`, `SUIUSDT`, `NEARUSDT`) на депозите $1,000 с лимитом риска 0.35% на сделку.
- Сравнительный бэктест старой версии (v1.0) и квантовой (v2.0) на одном историческом срезе данных.
