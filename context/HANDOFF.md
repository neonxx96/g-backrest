# HANDOFF.md — Протокол передачи смены

## Текущий статус: Ветка `design/shadcn-themes`
- **Выполненные заходы**:
  - **Заход 0–4**: Установка shadcn-инфраструктуры, единый синглтон `themeBridge`, каталог примитивов shadcn/ui (`button`, `badge`, `tooltip`, `dialog`, `tabs`, `table`, `input`, `select` и др.), ленивая витрина `/?ui-kit=1`.
  - **Заход A («Стабильность, масштаб, высота рабочей области»)**:
    - Ресайз с rAF и дебаунсом (аллокации bitmap снижены с 27.4 до 3.5), тиры экранов S/M/L/XL/XXL, масштаб UI 70%–160%, профили видимости интерфейса, нижняя ручка расширения высоты workspace до 8000px.
  - **Заход B («Шапка графика, DOM, перекрестие, таблицы, старт/стоп по паре»)**:
    - Двухрядная шапка графика, единые стили кроссхейра, синхронизация DOM-стакана, пер-парные пауза/возобновление/закрытие в бэкенде и UI.
  - **Заход C («Дефекты со скриншотов, закрепление дизайн-системы, B4»)**:
    - Устранение дефектов канваса и перекрытий HUD, codify design-систему в правилах (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`), линтер дизайн-системы с храповиком (`design_lint.mjs`).
  - **Заход D («Верификация, доработка B4, видимый лук Dockview + база, выжигание нарушений»)**:
    - **D0 (Gate & Регрессии)**: Добавлен шаг [1b] (pytest внутри Linux-контейнера `signalscript_backend`), сохранение UTF-8 BOM в `check.ps1`, guard ресайза канваса в `TradesWidget`, failover Binance Spot WS + REST fallback в `marketDataStore.js`, удаление дублирующего `design/DESIGN_GUIDE.md` (оставлен единый `docs/design/DESIGN_GUIDE.md`). Сняты скриншоты в `artifacts/design/c0/`.
    - **D1 (B4 Persistence & Pair-level Controls)**: Добавлено восстановление `load_persisted_states()` в `OvernightPilotManager`, 404/409 валидация, флаг `pause_after` в `close_pair()`. В UI: `PairControlRowActions.jsx` (`size="icon-xs"`), таблица пар с бейджами статуса и модалкой закрытия с чекбоксом паузы, кнопки «Пауза для всех» и «Возобновить все». Регрессионные тесты в Docker пройдены.
    - **D2 (Dockview Theme Overrides & Base Styling)**: Переопределение `--dv-*` переменных на `.dockview-theme-dark`: высота табов строго 28px, нижний 2px акцентный индикатор активного таба, 1px разделители и сэши с 6px grab zone, 12% акцентный drag overlay, 8px скроллбары, `tabular-nums` для таблиц, `SectionHeader`. Проверено на всех 4 темах (night, day, neon, mono) и разрешениях (1920x1080, 1366x768). Скриншоты в `artifacts/design/d/dockview_*`.
    - **D3 (Выжигание нарушений и храповик)**: Разработан скрипт `scripts/codemod_design_tokens.mjs`. Устранено 998 нарушений сырых цветов Tailwind в 4 пачки: настройки/модалки, dockview-виджеты, тулбар/оверлеи графика, остальные компоненты. Бейзлайн снижен с 2029 до 1031.
    - **D4 (Замена инпутов, чекбоксов и модалок)**:
      - `D4-inputs`: создан `NumberInput.jsx`, мигрированы инпуты в бэктесте, истории сделок, вкладках настроек.
      - `D4-checkboxes`: замена сырых чекбоксов на shadcn `Checkbox` (`onCheckedChange`) в бэктесте, таблицах, авто-селекте.
      - `D4-modals`: стандартный оверлей `bg-black/80 backdrop-blur-xs`, контейнер `bg-card text-foreground border-border`, кнопки shadcn `Button` и токенизированные табы в `SettingsModal.jsx`, `DecisionJournalModal.jsx`, `IndicatorsModal.jsx`.

## Шлюз качества check.ps1
- `🎉 ALL QUALITY CHECKS PASSED. READY TO COMMIT.` (EXIT_CODE=0):
  - [1/6] Pytest хоста: 616 passed.
  - [1b] Pytest Linux Docker-контейнера: 616 passed.
  - [2/6] Vite frontend build: built in 681ms.
  - [3b] Design System Linter: 1031 violations across 73 files (0 regressions against ratchet).
  - [4/6] Smoke critical parts (DOM, Chart, Scanner, Recorder, Journal, Presets, Settings, Quarantine): PASSED.
  - [5/6] Playwright UI smoke (canvases rect*dpr, no console errors, topbar 1366px fit, symbol switch): PASSED.
  - [6/6] Binance Live WebSocket check: frames received, PASSED.

## Как собрать и запустить в Docker
```powershell
docker compose build frontend
docker compose up -d
# Frontend: http://localhost:7100
# Backend: http://localhost:8000
# UI-Kit Showcase: http://localhost:7100/?ui-kit=1
```
