# HANDOFF.md — Протокол передачи контекста между агентами

> **ЕДИНЫЙ ИСТОЧНИК ПРАВИЛ:** Основные архитектурные, инженерные правила, стек технологий, правила Git и шлюз качества определены в [AGENTS.md](file:///d:/AI_agent_space/gemini/AGENTS.md). Все требования обязательны к исполнению.
> Перед началом любой сессии: прочитать [AGENTS.md](file:///d:/AI_agent_space/gemini/AGENTS.md) и этот файл, выполнить `git status`, затем запустить `powershell -ExecutionPolicy Bypass -File scripts/check.ps1`. Агенты работают **строго последовательно** и никогда одновременно.
> Полный исторический архив передач смен хранится в [docs/archive/HANDOFF_20261018_20261026.md](file:///d:/AI_agent_space/gemini/docs/archive/HANDOFF_20261018_20261026.md).

---

## Antigravity — Упаковка SignalScript в Docker-контейнеры и One-Click PWA Launcher (2026-10-27, 00:15 Киев)

- **Ветка:** \gent/antigravity/docker- **Статус качества:** \🎉 ALL QUALITY CHECKS PASSED. READY TO COMMIT.\ (Шлюз \scripts/check.ps1\ зелёный: 573 pytest passed, 85 layout tests, production build OK, 8/8 critical components smoke OK, Playwright blocking + live UI OK). Внутри Linux-контейнера \check.sh --backend-only\: 601 passed, 0 failed.
- **Сделано**:
  1. **Инвентаризация и аудит**: сформирован [docs/DOCKER_AUDIT.md](docs/DOCKER_AUDIT.md) с полным списком PowerShell/Windows-зависимостей, портов (:8000, :7100), томов (\data/\), и обоснованием архитектуры Nginx.
  2. **Dockerfile бэкенда**: \python:3.11-slim\, non-root пользователь \ppuser\ (UID 1000), зависимости из equirements.txt\, healthcheck \/api/health\.
  3. **Dockerfile фронтенда & Nginx**: multi-stage сборка Vite, легковесная раздача через Nginx Alpine на порту 7100 с обратным проксированием \/api/\ и \/ws/\ на бэкенд.
  4. **docker-compose.yml**: 2 сервиса (\signalscript_backend\, \signalscript_frontend\), bridge-сеть \signalscript_net\, том \./data:/app/data\, estart: unless-stopped\, \env_file: .env.example\.
  5. **.dockerignore**: строго исключены \.env\, \data/\, \.venv\, ode_modules\, \.git\, кэши. Секреты и база не запекаются в образ.
  6. **PWA & Service Worker**: \manifest.json\ в режиме standalone, \sw.js\ кеширует только UI-оболочку и строго обходит real-time рыночные данные, стакан, сделки и WebSocket Binance.
  7. **One-Click Launcher & ярлык**: \start_terminal.bat\ (проверка/старт Docker Desktop, \docker compose up -d\, опрос :7100, запуск окна \msedge --app=http://localhost:7100\). Создан ярлык на рабочем столе \SignalScript Terminal.lnk\ с иконкой \ssets/terminal.ico\.
  8. **check.sh**: Linux/контейнерный аналог \scripts/check.ps1\.
  9. **Документация**: [docs/DOCKER.md](docs/DOCKER.md) с командами запуска, логов, остановки, обновления и бэкапа.

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
