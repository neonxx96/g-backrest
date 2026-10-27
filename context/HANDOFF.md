# HANDOFF.md — Протокол передачи смены

## Текущий статус: Ветка `design/shadcn-themes`
- **Выполненные этапы**:
  - **Этап 0**: Разведка хардкодов и конфликтов.
  - **Этап 1**: Установка `clsx`, `tailwind-merge`, `cva`, `tw-animate-css`, `components.json`, `jsconfig.json`, `@theme inline` в `index.css`, `tokens.css`.
  - **Этап 2**: Единый синглтон `themeBridge`, устранение дублирования старой системы тем (`tokens.css` удален, `themes.js` облегчен до метаданных), динамическая подписка KLineCharts и Canvas (стакан, лента, on-chart DOM, футпринт).
  - **Этап 3**: Генерация полного каталога плотных примитивов shadcn/ui (`button`, `badge`, `tooltip`, `dialog`, `alert-dialog`, `tabs`, `table`, `input`, `select` и др.), кастомные компоненты `KpiCard`, `EmptyState`, `Kbd`, `StatusDot`, ленивая витрина `/?ui-kit=1`.
  - **Этап 4**: Оптимизация верхней панели, разделение Emergency Stop через `AlertDialog`, устранение обрезания подписей в DOM и ленте.
  - **Блоки A-G**: Проверка Docker-совместимости, локальные шрифты `@fontsource`, lazy loading dev-витрины (бандл изолирован), захват скриншотов всех 4 тем (`theme-night.png`, `theme-neon.png`, `theme-mono.png`, `theme-day.png`, `ui-kit-night.png`, `ui-kit-day.png`) в `artifacts/design/`.

## Шлюз качества check.ps1
- `🎉 ALL QUALITY CHECKS PASSED. READY TO COMMIT.` (611 pytest, prebuild unit-тесты, Vite build, smoke критических систем, Playwright UI blocking & live).

## Как собрать и запустить в Docker
```powershell
docker compose build frontend
docker compose up -d
# Frontend: http://localhost:7100
# Backend: http://localhost:8000
# UI-Kit Showcase: http://localhost:7100/?ui-kit=1
```
