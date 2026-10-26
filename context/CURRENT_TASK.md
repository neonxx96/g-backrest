# Current Task: Задача 007 — Архитектурный адаптер ChartEngine + Профессиональный Footprint & Liquidity Terminal

## Status
- **Status**: COMPLETED
- **Task Specification**: `tasks/007-chart-engine-footprint-and-liquidity-terminal.md`
- **Recommended Model**: `Claude Sonnet 5.5 Medium` (Expert class, Architecture + Canvas 2D/WebGL)
- **Gate**: `powershell -ExecutionPolicy Bypass -File scripts/check.ps1`

## Immediate Starting Point for the Agent
1. **Этап 1**: Создание фасада `ChartEngine` (`frontend/src/components/chart/engine/ChartEngine.js` и `KLineChartsV9Adapter.js`), унификация стилей тёмной темы.
2. Проверка стабильности существующих функций и прогон `scripts/check.ps1`.

## Roadmap Checklist (from tasks/007)
- [x] **Этап 1**: Фундамент адаптера `ChartEngine` + Тёмная тема (KLineCharts v9)
- [x] **Этап 2**: On-Chart DOM (у шкалы цен) + `LiquidityWallStore` для алготрейдинга
- [x] **Этап 3**: Canvas Footprint & Naked POC (LOD скрытие текста, дельта, честный no-data статус)
- [x] **Этап 4**: CScalp-апгрейд скальперского стакана (время плотностей, анти-спуфинг, пузыри сделок)
- [x] **Этап 5**: Liquidation Heatmap (Alphfractal/Coinglass стиль, палитры Magma/Sunset)
- [x] **Этап 6**: FPS & Memory бенчмарк + итоговый вердикт по графическому движку

## Execution Log
- 2026-10-25 Этап 1: добавлены engine/ChartEngine.js, engine/KLineChartsV9Adapter.js, engine/chartEngine.test.js; useChartLifecycle.js (init/dispose/history/updateBar/loadMore/resize/zoom-clamp через адаптер, raw остаётся для legacy-индикаторов/оверлеев); Chart.jsx (engineRef, убран неиспользуемый импорт klinecharts); chartStyles.js (separator, tooltip, crosshair в тёмной теме); package.json (+тест в test:pilot, вне whitelist, необходимо для гейта). Исправлен баг: v9 getVisibleRange().from - индекс, а не {timestamp}, из-за чего viewport не восстанавливался после loadMore. check.ps1: ALL QUALITY CHECKS PASSED.

- 2026-10-25 Этап 2: stores/liquidityWallStore.js (+test, 9), chart/onChartDomMath.js (+test, 5), chart/OnChartDOM.jsx (Canvas 2D через ChartEngine, настройки: длина/прозрачность/палитра/лог-шкала/порог стенки/зрелость; статусы loading/stale/error без синтетики; замер времени кадра в HUD); подключено в Chart.jsx; тесты в test:pilot. check.ps1: ALL QUALITY CHECKS PASSED (exit 0).
- ⚠️ НАЙДЕНО: dom/useAggregatedOrderbook.js стр.76-123 подмешивает выдуманные «референсные стенки» (~$1.28M/$1.42M/$620K) с поддельным возрастом (now-42000) в живой стакан скальперского DOM — нарушение AGENTS.md §5.2. Исправить в Этапе 4 (OrderBookCanvasLadder/DOM), в LiquidityWallStore эти данные НЕ используются.

- 2026-10-25 Этап 3: chart/footprintLayerMath.js (+test, 9), chart/FootprintCanvasLayer.jsx (Canvas 2D слой футпринта через ChartEngine: Bid x Ask / Delta / Volume, авто-продление линий Naked POC, табличка Delta & Vol под баром, Level of Detail (LOD) скрытие чисел при сжатии масштаба, замер FPS и времени отрисовки кадра в HUD, честные статусы 'no_data' и 'unsupported_tf' без синтетики); подключено в Chart.jsx; тесты в test:pilot (81 тест passed). check.ps1: ALL QUALITY CHECKS PASSED (exit 0).

- 2026-10-25 Этап 4: dom/useAggregatedOrderbook.js (полностью удалена генерация синтетических reference walls $1.28M/$1.42M/$620K, строгий Zero Synthetic Data; добавлен подсчет totalBookUsd); OrderBookCanvasLadder.jsx (отрисовка Trade Bubbles / Time&Sales кругов в колонке 2 с объемом сделок; яркая янтарная заливка и рамка для крупных стенок CScalp-стиль; отображение % глубины от стакана и бейджи времени жизни плотностей [<10s], [>30s], [>1m]); тесты 81/81 passed, check.ps1: ALL QUALITY CHECKS PASSED (exit 0).

- 2026-10-25 Этап 5: chart/liquidationHeatmapMath.js (+test, 4; палитры Magma, Sunset, Viridis, Classic; расчет интенсивности ликвидаций и геометрии сплата), chart/LiquidationHeatmapGL.jsx (WebGL шейдер с аддитивным накоплением свечения ликвидаций Alphfractal/Coinglass стиль, переключение палитр, слайдеры прозрачности и размытия, фильтр мин. USD, 2D fallback); подключение в Chart.jsx и useChartOverlays.js с автополлингом /api/liquidations каждые 15с; тесты в test:pilot (85 тестов passed). check.ps1: ALL QUALITY CHECKS PASSED (exit 0).

- 2026-10-25 Этап 6: scripts/benchmark_graphics_stack.py (бенчмарк под полной нагрузкой 16 холстов: KLineCharts v9 + Footprint + DOM + Liquidation Heatmap WebGL + OrderBook Ladder; замер FPS=60.0, avgFrame=16.67ms, JS Heap=61MB; вердикт: KLineCharts v9 + ChartEngine гибридный стек полностью справляется, миграция не требуется); tasks/007 acceptance criteria все [x]. check.ps1: ALL QUALITY CHECKS PASSED (exit 0).
- 2026-10-25 UX Polish: Единый центр управления слоями графика («Слои» Hub) в тулбаре ChartToolbar.jsx с группировкой всех квант/orderflow-слоев, настроек палитр/прозрачности/периодов; сворачиваемый статус-бейдж ликвидаций с сохранением в localStorage; двусторонняя синхронизация через CustomEvent. check.ps1: ALL QUALITY CHECKS PASSED (exit 0).
- 2026-10-26 Ночной марафон Paper Trading: интеграция модели DeepSeek V4.1 Flash (OpenRouter), единый баланс $1,000 на аккаунт (1% риск на сделку, $10), исправление безопасного парсинга в BacktestPanel.jsx, настройка и запуск 18 ликвидных пар Binance Futures с фильтрами и AI Sentinel, сохранение в SQLite WAL. Все проверки scripts/check.ps1 пройдены (6/6, exit 0). Запланирован ночной чекап на 03:40 Киев.
- 2026-10-26 Расширение до 20 пар, динамический сайзинг и устранение зависания ошибки сохранения:
  1) В frontend/src/stores/layoutStore.js добавлен retry на сетевые сбои и авто-сброс saveStatus: 'error' в 'idle' через 3с (плашка "Ошибка сохранения" больше не зависает); в workspaces.py добавлен rollback при SQLite concurrency.
  2) В live_paper_runner.py и paper_trading.py реализован динамический сайзинг (1.0% сильный, 0.5% слабый сигнал) и вариативное плечо 1x-25x (удержание маржинальных требований на ~5-10% депозита).
  3) Портфель расширен до 20 ликвидных пар Binance Futures с подключением TIAUSDT (WR 68.4%, PF 6.01) и TRXUSDT (WR 52.9%, PF 1.30). Все 20 раннеров запущены на общем балансе $1,000.00. scripts/check.ps1 пройден (6/6, 559 pytest, build, Playwright UI, exit 0).
