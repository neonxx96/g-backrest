# HANDOFF.md — Протокол передачи контекста между агентами

> **ЕДИНЫЙ ИСТОЧНИК ПРАВИЛ:** Основные архитектурные, инженерные правила, стек технологий, правила Git и шлюз качества определены в [AGENTS.md](file:///d:/AI_agent_space/gemini/AGENTS.md). Все требования обязательны к исполнению.
> Перед началом любой сессии: прочитать [AGENTS.md](file:///d:/AI_agent_space/gemini/AGENTS.md) и этот файл, выполнить `git status`, затем запустить `powershell -ExecutionPolicy Bypass -File scripts/check.ps1`. Агенты работают **строго последовательно** и никогда одновременно.
> Полный исторический архив передач смен хранится в [docs/archive/HANDOFF_20261018_20261026.md](file:///d:/AI_agent_space/gemini/docs/archive/HANDOFF_20261018_20261026.md).

---

## Antigravity — Post-mortem аналитика и селектор стратегий по парам (2026-10-27, 01:10 Киев)

- **Ветка:** `agent/antigravity/postmortem-analyzer` (коммиты b2842fa, 596edb6, 2f0f2b7 + docs)
- **Сделано:** `trade_postmortem_service.py` + `GET /api/paper-trading/analytics/post-mortem`; вкладка «Аналитика & Винрейт»; `scripts/select_pair_strategies.py` (TRAIN/OOS). Тесты: test_trade_postmortem.py, test_select_pair_strategies.py.
- **Факты:** 82 старые сделки: WR 36.6%, PF 0.52, FBI 0.87, основная причина потерь STOP_OUT. Селектор: подтверждена OOS только ZECUSDT.
- **Риски / следующему агенту:** (1) Docker-контейнеры нужно пересобрать, чтобы увидеть новый API/UI (не перезапускал — compose в main расходится с работающим). (2) Пилот сейчас 14 пар на ema_trend, 13 из них verdict BLOCK — рекомендовано оставить только SELECT-пары. (3) Этап 6 (A/B старой/новой версии) ждёт >= 30 закрытых сделок новой версии.

---

## Antigravity — Целевой аудит и квантовая верификация риск-ядра (2026-10-26, 23:25 Киев)

- **Ветка:** `agent/antigravity/chart-engine-footprint` (коммит `777f498`)
- **Статус качества:** `🎉 ALL QUALITY CHECKS PASSED. READY TO COMMIT.` (Шлюз `scripts/check.ps1`: 573 pytest passed, 0 failed, 85 layout/pilot passed, Vite build OK, 8/8 critical smoke passed, Playwright blocking + live OK).
- **Сделано**:
  1. **Аудит точек вызова квантовых модулей**:
     - `LivePaperRunner` L980-L1130 вызывает `classify_market_regime`, `microstructure_gate`, `calc_position_by_risk`, `can_open_position` и `check_circuit_breaker`. Блокировки логируют структурированный `veto_reason` (`REGIME_VETO`, `MICROSTRUCTURE_VETO`, `PORTFOLIO_HEAT_VETO`).
  2. **Стопы и Trailing**:
     - Подтверждено: старый перенос SL на +0.4R полностью отключен.
     - Dynamic Breakeven срабатывает при $+1.0R$ со смещением на покрытие двойной комиссии ($2 \times Fee + 1\,tick$).
     - Ступенчатый трейлинг закреплен в `EarlyExitEngine` (Step-Lock 1.2R / 1.8R, частичный сброс 50% при встречной абсорбции от 0.7R).
     - Нулевой внутрисвечной look-ahead подтвержден тиковым симулятором.
  3. **Сайзинг и Portfolio Heat с учетом висящих лимитных ордеров**:
     - В формулу сайзинга включены $2 \times Fee$ и проскальзывание в тиках; количество округляется вниз (`floor`) по шагу инструмента.
     - В `can_open_position` передаются `pending_orders`: зарезервированный риск лимиток суммируется с открытыми позициями в бюджетах 1.25% (портфель) и 0.75% (направление).
  4. **Журнал и Expectancy**:
     - `initial_risk_usd` фиксируется при входе и пропорционально уменьшается при частичных выходах.
     - Схема базы `signals.db` мигрирована: новые колонки имеют `NULL` по умолчанию (без фальсификации нулями). В UI выводится количество сделок и период.

---

## Antigravity — Реализация квантовой трансформации: Expectancy-ориентированный риск-движок, классификатор режимов и микроструктурный фильтр (2026-10-26, 23:05 Киев)

- **Ветка:** `agent/antigravity/chart-engine-footprint` (коммит `759c472`)
- **Статус качества:** `🎉 ALL QUALITY CHECKS PASSED. READY TO COMMIT.`
- **Сделано**:
  1. Смена целевой метрики на Net Expectancy ($E_R$).
  2. Реализован модуль `risk_engine.py` (сайзинг от SL, корреляционный штраф, лимиты heat, circuit breaker).
  3. Реализован модуль `regime_classifier.py` (двухтаймфреймовый CI-14, перцентили волатильности).
  4. Микроструктурный гейт дисбаланса стакана и абсорбции CVD.
  5. Разделение биржевого плеча и эффективного плеча.
  6. Безопасная миграция базы SQLite `data/signals.db`.
  7. Скрипт запуска топ-8 ликвидных пар `scripts/launch_overnight_8pairs.py`.

---

## Antigravity — План ситуационного анализа рынка и адаптивного повышения винрейта (2026-10-26, 18:05 Киев)

- **Ветка:** `agent/antigravity/chart-engine-footprint` (коммит `c1f0cc3`)
- **Статус качества:** `🎉 ALL QUALITY CHECKS PASSED. READY TO COMMIT.`
- **Сделано**:
  1. Диагностика телеметрии первых 60+ закрытых сделок (выявлены Fee Drag, MFE Bleed, Regime Mismatch, Adverse Order Flow).
  2. Разработан архитектурный документ [docs/WIN_RATE_IMPROVEMENT_PLAN.md](file:///d:/AI_agent_space/gemini/docs/WIN_RATE_IMPROVEMENT_PLAN.md).
  3. Сформирована изолированная задача [tasks/008-situation-analysis-and-winrate-boost.md](file:///d:/AI_agent_space/gemini/tasks/008-situation-analysis-and-winrate-boost.md).
  4. Обновлен мастер-контекст [context/CURRENT_TASK.md](file:///d:/AI_agent_space/gemini/context/CURRENT_TASK.md).
