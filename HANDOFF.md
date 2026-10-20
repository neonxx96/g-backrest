# HANDOFF.md — Протокол передачи контекста между агентами

> Перед началом работы: прочитать `AGENTS.md` и этот файл, выполнить `git status`, затем запустить `powershell -ExecutionPolicy Bypass -File scripts/check.ps1`. Агенты работают строго последовательно.

## 🚦 Текущий статус

- **ACTIVE_AGENT:** `none`
- **Текущая ветка:** `agent/antigravity/paper-trading-openrouter`
- **Последняя подтверждённая полная проверка:** `2026-10-20`, `scripts/check.ps1` — **PASS**: 103/103 pytest, frontend production build, 8/8 critical API smoke, blocking и live Playwright smoke (`ALL QUALITY CHECKS PASSED. READY TO COMMIT.`).

## ✅ Подтверждённое состояние

1. **Честное разделение бэктеста и симулятора:**
   - **Historical OHLCV Backtest:** в режиме истории скрыты L2-фильтры стакана (стенки и время жизни), выводятся честный информационный баннер и свечные индикаторы (ATR, RSI, поглощение объёма Price Action). Актуальный тикер синхронизирован без рассинхрона.
   - **Live Paper Trading (Симулятор):** режим работы со стартовым балансом ($10,000 по умолчанию) и настраиваемым риском на сделку (1.0%). Движок `LivePaperRunner` подписывается на `FreeBinanceCollector` (Live L2 стакан + Liquidation Map), детектирует сетапы («Вход перед стенкой $500k+» и Quant Confluence 3 ядра), списывает маржу с виртуального баланса с учетом комиссий Maker/Taker и проскальзывания, строит интерактивную SVG equity-кривую в реальном времени.
2. **Layout & State Persistence (Полное сохранение состояния интерфейса):**
   - `App.jsx`: сохранение активного `symbol`, `timeframe`, состояния открытых панелей (`showBacktest`, `showAICopilot`, `showDecisionJournal`) в `localStorage`.
   - `colorLinksStore.js`: сохранение 10 цветовых каналов, привязок панелей (`panelBindings`) и локальных тикеров через Zustand `persist` (`signalscript_color_links`).
   - `layoutStore.js`: сохранение активного пресета (`signalscript_active_preset`) и локального снапшота раскладки dockview (`signalscript_last_dockview_layout`).
   - `quantStore.js`: сохранение настроек слоев, плеч 25x-100x, фильтра плотностей, прозрачности и палитры через Zustand `persist` (`signalscript_quant_storage`).
   - `backtestStore.js`: сохранение выбранного режима (`mode`), параметров по тикерам и конфигурации `livePaperConfig` через Zustand `persist` (`signalscript_backtest_storage`).
3. **Надёжная цепочка моделей (Model Cascade) для AI Copilot & Risk Officer:**
   - Сервис `backend/app/services/openrouter_client.py`:
     1. Многоуровневый каскад: **Primary (платная дешёвая: `deepseek/deepseek-v4.1-flash`)** $\rightarrow$ **Fallback (Free Models Router OpenRouter: `openrouter/free` и пул бесплатных моделей)** $\rightarrow$ **детерминированный Cold Quant Fallback (`local_quant_fallback`)**.
     2. Кэш доступности OpenRouter Models API (`https://openrouter.ai/api/v1/models`) на 1 час (3600 с). Недоступные модели отсекаются до сетевого вызова.
     3. Обработка ошибок: HTTP 402 (исчерпание баланса) немедленно переходит к бесплатным fallback-моделям без повторов; HTTP 429 повторяется с экспоненциальной задержкой не более 2 раз; таймаут 20.0 с.
     4. Телеметрия каждого вызова: `model`, `latency_ms`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost`, `status`, `fallback`, `fallback_reason` + буфер истории вызовов.
     5. Суточный потолок расходов (`OPENROUTER_DAILY_BUDGET_USD` в `config.py`): при превышении платные модели блокируются, вызовы автоматически направляются на бесплатный роутер.
     6. Эндпоинт `GET /api/paper-trading/ai-model-chain-status` для аудита расходов и состояния кэша моделей.
     7. UI-индикация в `LivePaperTradingView.jsx` и `Chart.jsx`: отображение ответившей модели, статуса `[Primary]` / `[Fallback]`, задержки вызова. При полном отказе сети выводится честное `"AI недоступен"`.
     8. 8 юнит-тестов с моками сети в `backend/tests/test_openrouter_chain.py` (все 8 зелёные).
4. **Компоненты интерфейса:**
   - В `BacktestPanel.jsx` добавлена кнопка переключения режима `⚡ Симулятор (Paper)`.
   - Создан компонент `LivePaperTradingView.jsx` с контролами `LivePaperTradingControls` и визуализатором `LivePaperTradingResults` (KPI-карточки баланса/equity/PnL, SVG equity chart, таблицы открытых/закрытых сделок и лог AI).

## 🔒 Ограничения

- Никаких реальных ордеров, ключей или случайных данных рынка (строго консультативный терминал).
- Не изменять `backend/app/engine/` и `backend/app/services/execution_simulator.py`.
- Порты строго: backend `8000`, frontend `5173`; SQLite: `data/signals.db`.
- Перед каждым коммитом обязателен полный прогон `scripts/check.ps1`.
