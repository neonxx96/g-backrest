# HANDOFF.md — Протокол передачи смены

## Текущий статус: Ветка `design/shadcn-themes`
- **Выполненные этапы**:
  - **Этап 0**: Разведка хардкодов и конфликтов.
  - **Этап 1**: Установка `clsx`, `tailwind-merge`, `cva`, `tw-animate-css`, `components.json`, `jsconfig.json`, `@theme inline` в `index.css`, `tokens.css`.
  - **Этап 2**: Единый синглтон `themeBridge`, устранение дублирования старой системы тем (`tokens.css` удален, `themes.js` облегчен до метаданных), динамическая подписка KLineCharts и Canvas (стакан, лента, on-chart DOM, футпринт).
  - **Этап 3**: Генерация полного каталога плотных примитивов shadcn/ui (`button`, `badge`, `tooltip`, `dialog`, `alert-dialog`, `tabs`, `table`, `input`, `select` и др.), кастомные компоненты `KpiCard`, `EmptyState`, `Kbd`, `StatusDot`, ленивая витрина `/?ui-kit=1`.
  - **Этап 4**: Оптимизация верхней панели, разделение Emergency Stop через `AlertDialog`, устранение обрезания подписей в DOM и ленте.
  - **Блоки A-G**: Проверка Docker-совместимости, локальные шрифты `@fontsource`, lazy loading dev-витрины (бандл изолирован), захват скриншотов всех 4 тем (`theme-night.png`, `theme-neon.png`, `theme-mono.png`, `theme-day.png`, `ui-kit-night.png`, `ui-kit-day.png`) в `artifacts/design/`.
  - **Заход A («Стабильность, масштаб, высота рабочей области»)**:
    - **A1**: Устранено дёргание и лаги при ресайзе окна. Внедрен `rAF` + trailing debounce 120ms в `useChartLifecycle.js`, `TradesWidget.jsx`, `OrderBookCanvasLadder.jsx`, `FootprintCanvasLayer.jsx`, `OnChartDOM.jsx`. Частота аллокаций bitmap снижена с 27.4 до 3.5 операций на жест ресайза. Добавлен гистерезис переключения тиров в `AppTopBar.jsx` (24px) и `ChartToolbar.jsx` (20px).
    - **A2**: Создана система тиров экранов (`screenTiers.js`: S/M/L/XL/XXL). Внедрен масштаб UI (70%–160%), плотности (`compact`, `standard`, `spacious`) с переменными `--ui-scale`, `--control-h`, `--row-h`, `--space`. Обновлен `AppearanceTab.jsx`. Создана вкладка `VisibilityTab.jsx` с переключением 11 элементов и 3 профилями (Полный/Рабочий/Минимум). Хоткеи: `Alt+=`, `Alt+-`, `Alt+0`, `Alt+Z` (Zen-режим со скрытием шапки и floating pill возврата).
    - **A3**: Реализован `WorkspaceScroller.jsx` с нижней ручкой `workspace-height-handle` (`ns-resize`, мин. высота по экрану, макс. 8000px), автоскроллом при драге ближе 40px к низу и сохранением высоты в `localStorage` на пресет. В `PresetBar.jsx` встроено меню быстрого выбора высоты (`Авто`, `+25%`, `+50%`, `x2`, `x3`).
    - **Canvas & WebGL**: Размер строк и шрифты в `OrderBookCanvasLadder`, `TradesWidget`, `FootprintCanvasLayer` динамически масштабируются с `tokens.uiScale`.
    - **Верификация и скриншоты**: Снято 12 адаптивных скриншотов по 8 десктопным разрешениям (от 1366x768 до 3840x2160, темы night и day, масштабы 70%, 100%, 150%) в `artifacts/design/adaptive/`.

## Шлюз качества check.ps1
- `🎉 ALL QUALITY CHECKS PASSED. READY TO COMMIT.` (EXIT_CODE=0: 611 pytest, prebuild unit-тесты, Vite build, smoke критических систем, Playwright UI blocking & live).

## Как собрать и запустить в Docker
```powershell
docker compose build frontend
docker compose up -d
# Frontend: http://localhost:7100
# Backend: http://localhost:8000
# UI-Kit Showcase: http://localhost:7100/?ui-kit=1
```
