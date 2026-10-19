# HANDOFF.md — Протокол передачи контекста между агентами

> Перед началом работы: прочитать `AGENTS.md` и этот файл, выполнить `git status`, затем запустить `powershell -ExecutionPolicy Bypass -File scripts/check.ps1`. Агенты работают строго последовательно.

## 🚦 Текущий статус

- **ACTIVE_AGENT:** `none`
- **Текущая ветка:** `agent/deepseek/adaptive-quant`
- **Базовый коммит:** `284b1d1` — Walk-Forward Optimizer, динамические веса стратегий и защита от токсичного режима.
- **Последняя подтверждённая полная проверка:** `2026-10-20`, `scripts/check.ps1` — **PASS**: 86/86 pytest, frontend production build, 7/7 critical API smoke, blocking и live Playwright smoke.

## ✅ Подтверждённое состояние

1. **Paper Trading v0.1:** виртуальный баланс, комиссии maker/taker, MFE/MAE, закрытые сделки, kill switch, reset/resume.
2. **Forecast bands:** вероятностный прогноз и контракт валидации покрыты тестами.
3. **RegimeClassifier + Walk-Forward:** режимы `FLAT_DENSE`, `TREND_IMPULSE`, `TOXIC_VOLATILITY`; последний блокирует новые paper-входы.
4. **UnifiedTradeSignal:** background worker и ручной Paper API создают/исполняют единый контракт; reason нормализуется в список условий.

## 🐞 Диагностика Quality Gate

`test_get_monitoring_state_endpoint[asyncio]` не имеет дефекта в приложении. В sandbox-процессе Windows loopback `socket.connect()` получает `WinError 10013`; Python реализует `socket.socketpair()` через loopback connect/accept, поэтому AnyIO зависал ещё при создании event loop. В обычном локальном запуске тест проходит за ~1.1 с, а полный pytest — 82/82.

Если `check.ps1` зависает на UI: проверить `5173`. В этой сессии прежний Vite-listener на PID `34048` принимал порт, но TCP соединения оставались `SYN_SENT`; после разрешённого перезапуска свежий Vite ответил `HTTP 200`, а UI smoke прошёл.

## 🎯 Утверждённая архитектура: один движок, три режима

Код стратегии должен использовать единый `UnifiedTradeSignal` в трёх последовательных режимах:

1. **History:** детерминированный backtest.
2. **Validation:** walk-forward / out-of-sample проверка.
3. **Paper:** live симуляция без реальных ордеров.

Каждый сигнал обязан иметь детерминированный `reason`: структурированный список сработавших условий и фактических значений. Эти данные нужны для пользовательской объяснимости, Reality Mirror и будущего авто-тюнинга.

## ⏭️ Следующие утверждённые этапы

1. **Этап 2 — Unified Pipeline:** завершён (`824b474`). Paper-входы background worker теперь проходят через `UnifiedTradeSignal`; `reason` хранится списком условий. UI использует относительный `/api` и реальный session status.
2. **Этап 3 — Reality Mirror:** завершён. Закрытая paper-сделка хранит Net PnL с обеими комиссиями, Fee Drag, MFE, MAE и флаг Profit Bleed. Таблица их отображает; chart показывает приглушённые paper-маркеры и tooltip с причиной/метриками.
3. **Следующий безопасный шаг:** вручную прогнать несколько paper-сделок на BTCUSDT и сравнить историю/маркеры с реальным event stream. Автоторговлю не включать.
4. **Truth-first MVP:** History Backtest отделяет `entry_reason` от `exit_reason` и публикует `data_availability`; Historical L2 обозначается `No data (OHLCV only)`. UI Verdict блокирует токсичный режим и отрицательный Net PnL.

## 🔒 Ограничения

- Никаких реальных ордеров, ключей или случайных данных рынка.
- Не изменять `backend/app/services/execution_simulator.py`.
- Порты строго: backend `8000`, frontend `5173`; SQLite: `data/signals.db`.
- Перед каждым коммитом нужен полный `scripts/check.ps1`.
