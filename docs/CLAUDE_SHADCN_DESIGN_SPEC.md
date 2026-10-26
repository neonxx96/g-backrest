# PROMPT FOR CLAUDE: Design Architecture & shadcn/ui Migration Plan for SignalScript Terminal

> **Назначение файла:** Этот документ передаётся в чат Claude (Claude 3.7 Sonnet / Claude 3.5 Sonnet) для получения экспертного архитектурного ревью, детального промпта для кодинга и пошагового плана миграции UI на дизайн-систему **shadcn/ui (Tailwind CSS v4 + React 19)** без регрессий в финансовом терминале.

---

## 1. Контекст проекта и специфика терминала

**SignalScript** — это высокопроизводительный веб-терминал для профессионального анализа ликвидности и потока ордеров (Order Flow Terminal) криптовалютных фьючерсов Binance Futures (уровня **CScalp, TigerTrade, ATAS, Coinglass**).

### Ключевые архитектурные ограничения:
1. **Только Advisory / Paper Trading:** Никакой прямой автоторговли реальными деньгами.
2. **Стек фронтенда:**
   - **React:** `19.2.8` (функциональные компоненты, хуки React 19).
   - **Сборщик:** Vite `8.3.0` + `@tailwindcss/vite` (Tailwind CSS `v4.3.3`).
   - **Оконная мозаика:** `dockview-react` `8.6.0` (drag-and-drop сплиты, вкладки, плавающие окна).
   - **Графики:** `klinecharts` `9.8.12` (v9 API, строгий адаптер `ChartEngine.js`).
   - **Высокочастотная графика:** Поверх KLineCharts наложен сэндвич из нескольких холстов:
     - `Canvas 2D` для футпринта кластеров (Bid x Ask, дельта, Naked POC).
     - `Canvas 2D` для скальперского стакана CScalp (с таймерами плотностей и пузырями сделок).
     - `WebGL` шейдер для тепловой карты ликвидаций (Coinglass style).
   - **Стейт-менеджер:** `zustand` `5.0.15` (транзиентные обновления через `useStore.getState()` для холстов с частотой 60 FPS без ре-рендера React-дерева).
   - **Иконки:** `lucide-react` `1.59.0`.
   - **Шрифты:** `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono` (строго моноширинные числа для цен и объемов).
3. **Порты и среда:**
   - Фронтенд работает на порту `7100` (`http://localhost:7100/`), бэкенд FastAPI на порту `8000`.
   - Проект развернут в Docker (`signalscript_frontend` + `signalscript_backend`).
   - Единый шлюз качества: `powershell -ExecutionPolicy Bypass -File scripts/check.ps1` (611 pytest, Vite build, Playwright E2E UI smoke).

---

## 2. Как устроен UI сейчас (Текущий дизайн)

### 2.1. Оконная система (Docking Layout)
Всё рабочее пространство управляется `TerminalDockview.jsx` на базе `dockview-react`:
- **Верхний бар (Top Navigation Bar):**
  - Выбор тикера (`BTCUSDT`, `ETHUSDT`...), цветовой канал линковки (c1–c4).
  - Таймфреймы: `1m`, `3m`, `5m`, `15m`, `1h`, `4h`, `1d`.
  - Переключатель слоев графика: Кластера (Footprint), On-Chart DOM, Карта ликвидаций (WebGL), Индикаторы (EMA, RSI, CVD, VWAP).
  - Кнопки пресетов раскладок (Default, Scalper, Analytics, Replay).
  - Кнопки быстрого открытия модалок: `[+ Виджеты]`, `[Журнал решений]`, `[Настройки]`.
- **Панели Dockview:**
  1. `chart` — главный холст KLineCharts + Footprint + Liquidation Heatmap.
  2. `orderbook` — скальперский стакан CScalp на Canvas 2D (`OrderBookDOM.jsx` / `OrderBookCanvasLadder.jsx`).
  3. `trades` — лента сделок Time & Sales на Canvas.
  4. `screener` / `watchlist` — скринер рынка со спарклайнами.
  5. `tradehistory` — институциональный виджет **«Демо-торговля & Сделки (20 пар)»** (`TradeHistoryWidget.jsx`):
     - Вкладка *«По парам (20)»* — карточки и таблица запущенных сессий марафона.
     - Вкладка *«Активные позиции»* — плавающий PnL, точки входа, SL/TP, статус AI Sentinel.
     - Вкладка *«Закрытые сделки»* — история из SQLite с фильтрами по периодам (24ч, 7д, 30д, всё время), сортировка по PnL/дате, экспорт CSV.
     - Вкладка *«Аналитика & Винрейт»* (`PostMortemAnalyticsTab.jsx`) — причины потерь (MFE Reversal, Fee Drag, Time-Stop), Fee Burden Index, матожидание $E_R$ и панель автоподбора стратегий `AutoSelectPanel.jsx`.
     - Вкладка *«Квант-режимы & Прогнозы»* — Walk-Forward режимы рынка (Trend, Chop, Toxic).

### 2.2. Цветовая модель и темы (`frontend/src/index.css`)
- Темы переключаются через атрибут `[data-theme="tealstreet"]`, `[data-theme="tiger"]`, `[data-theme="bloomberg"]`.
- Базовые CSS-переменные:
  - Фон: `--bg-root: #08090c`, `--bg-panel: #0c0e12`, `--bg-subtle: #14171f`.
  - Границы: `--border-subtle: #161820`, `--border-active: #252b38`.
  - Текст: `--text-main: #d1d4dc`, `--text-muted: #787f91`, `--text-dim: #4b5563`.
  - Трейдинговые цвета: `--color-bull: #26a69a` (бычий), `--color-bear: #ef5350` (медвежий), `--color-density-gold: #ffb300` (стенка в стакане).
- **Проблема текущего UI:** Множество самописных кнопок, инпутов, селектов и модальных окон сверстаны «вручную» на инлайн-классах Tailwind (`px-2.5 py-1 rounded text-xs font-mono bg-neutral-800...`). Нет единой библиотеки примитивов форм, выпадающих списков, тултипов, аккордеонов, диалогов и контекстных меню.

---

## 3. Цель миграции: Внедрение shadcn/ui

Мы хотим перевести весь интерфейс управления, модалки, панели, таблицы и контролы на **shadcn/ui**, сохранив при этом:
1. **60 FPS графику Canvas/WebGL** (никакого оверхенда над KLineCharts и DOM-стаканом).
2. **Плотную профессиональную компоновку (Ultra-Dense Dark FinTech UI)** — размер шрифтов `10px–12px`, компактные паддинги `p-1 / p-1.5`, строгий моноширинный вид чисел.
3. **Поддержку Tailwind CSS v4** (`@tailwindcss/vite` без устаревшего `tailwind.config.js`).
4. **Совместимость с React 19**.

---

## 4. Что требуется спросить у Claude (Запрос к модели)

Скопируй приведенный ниже блок и отправь Claude:

```markdown
Привет, Claude! 
Мы разрабатываем высоконагруженный крипто-терминал потока ордеров SignalScript (React 19, Vite, Tailwind CSS v4, dockview-react, Zustand 5, KLineCharts v9 Canvas 2D/WebGL).

Мы хотим внедрить дизайн-систему shadcn/ui (New York style, Zinc/Dark тема) для всех UI-компонентов (модалки, тулбары, табы, выпадающие меню, бейджи, ползунки, тултипы, карточки аналитики), сделав интерфейс монолитным, стильным и похожим на элитные финансовые терминалы (Bloomberg Terminal / TradingView / TigerTrade / Linear App).

Пожалуйста, изучи архитектуру нашего проекта и дай нам:

### 1. Архитектурную настройку shadcn/ui под наш стек:
- Как правильно инициализировать shadcn/ui в проекте с **Tailwind CSS v4** (`@tailwindcss/vite`) и **React 19** без ломки `@import "tailwindcss";` и существующих токенов `--bg-root`, `--color-bull`, `--color-bear`?
- Какая конфигурация `components.json` и `path aliases` (`@/components/ui`) должна быть в `vite.config.js` и `jsconfig.json`?
- Как подружить CSS-переменные shadcn/ui (`--background`, `--foreground`, `--card`, `--primary`...) с нашими терминальными переменными и темами (`tealstreet`, `tiger`, `bloomberg`)?

### 2. Спецификацию плотного финансового стиля (Ultra-Dense FinTech Theme):
- Стандартный shadcn/ui рассчитан на SaaS/веб-сайты с крупными кнопками (h-10, h-9) и отступами. Для трейдинга это не годится — нужен сверхплотный масштаб:
  - Кнопки: `h-6 / h-7`, `text-[11px]`, `px-2`.
  - Инпуты и селекты: `h-6`, компактный padding, моноширинный шрифт `font-mono`.
  - Таблицы: строки высотой `24px–28px`, sticky заголовки, tabular-nums.
  - Тултипы с нулевой задержкой для кнопок графических слоев.
- Как глобально или через CVA (class-variance-authority) настроить варианты размеров `size="dense"` или `size="xs"` для Button, Input, Select, Dialog, Tabs, Badge?

### 3. Приоритетный план поэтапной миграции компонентов:
Разбей процесс на 4 безопасных шага без регрессий:
- **Шаг 1**: Фундамент (установка `@radix-ui`, `clsx`, `tailwind-merge`, `cva`, `components.json`, маппинг CSS токенов).
- **Шаг 2**: Базовые примитивы (Button, Badge, Tooltip, Input, Select, Switch, Slider, Tabs).
- **Шаг 3**: Модальные окна (WidgetHubModal, SettingsModal, DecisionJournalModal, AlertsModal).
- **Шаг 4**: Институциональный виджет TradeHistoryWidget & PostMortemAnalyticsTab (карточки KPI, аккордеоны причин потерь, таблица позиций с цветными бейджами статусов).

### 4. Готовый пример рефакторинга ключевого компонента:
Покажи, как должен выглядеть переписанный с использованием shadcn/ui компонент `AutoSelectPanel.jsx` (или `PostMortemAnalyticsTab.jsx`) — чистый код с `Card`, `Button`, `Badge`, `Table`, `Tooltip`, доступный и красивый.

### 5. Готовый промпт для AI-кодера (Antigravity / Cline):
Сформируй четкую пошаговую инструкцию-промпт, которую я смогу передать агенту для автономного исполнения Шага 1 и Шага 2 без поломки сборки (`scripts/check.ps1`).
```

---

## 5. Важные технические нюансы для Claude
- В Tailwind v4 директивы `@tailwind base;` устарели, используется `@import "tailwindcss";`.
- В проекте используется `@tailwindcss/vite` вместо `postcss.config.js`.
- Все числа PnL, цен и объемов должны использовать класс `font-mono font-medium tabular-nums`.
- Стакан CScalp и график KLineCharts рендерятся в нативные `<canvas>`, shadcn/ui управляет исключительно UI-обвязкой, панелями, тулбарами, модалками и таблицами вокруг них.
