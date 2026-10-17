# 🚀 Signal Script: Торговый терминал, Сканер Binance Futures и Telegram-Алерты

Профессиональное MVP приложение для крипто-фьючерсного трейдера:
- Сканирует рынок **Binance USDT-M Futures** (топ-150 пар по объему).
- Рассчитывает индикаторы в реальном времени: **EMA(20) кросс, всплеск объема (xN), RSI экстремумы, CVD (Cumulative Volume Delta) и волатильность**.
- Учитывает **24ч изменение цены, Open Interest, сумму ликвидаций** (через живой WebSocket) и **рыночную капитализацию** (CoinGecko).
- Шлёт карточки сигналов в **Telegram бот** со ссылкой на интерактивный график.
- Легкий веб-интерфейс на **React + Vite** с графиком **KLineChart** (удобное рисование уровней, лучей, фибо, прямоугольников с сохранением в профиль) и **живым стаканом (L2 Depth)** с подсветкой плотностей и таймером жизни заявки.

---

## 🛠️ Стек технологий
- **Backend:** Python 3.11+, FastAPI, asyncio, aiogram 3, SQLite (SQLAlchemy + aiosqlite), pandas/numpy
- **Frontend:** React + Vite, KLineChart (v10), Tailwind CSS, Lucide Icons
- **Данные:** Публичный Binance Futures API (REST + WebSocket), CoinGecko API (с кэшированием)
- **Деплой:** Docker, Docker Compose, Proxmox VE, Cloudflare Tunnel

---

## ⚙️ Переменные окружения (`.env`)

Все секреты и параметры хранятся в файле `.env` в корне проекта (образец в `.env.example`):

| Переменная | Описание | Значение по умолчанию |
|---|---|---|
| `BINANCE_API_KEY` | API-ключ Binance (опционально, публичные данные работают без него) | `T1jRxJf...` |
| `BINANCE_API_SECRET` | Секретный ключ Binance | `fI9PNV8...` |
| `TELEGRAM_BOT_TOKEN` | Токен Telegram-бота от @BotFather | `5122605345:AAGyu...` |
| `BACKEND_HOST` | Хост для запуска FastAPI сервера | `127.0.0.1` |
| `BACKEND_PORT` | Порт бэкенда | `8000` |
| `FRONTEND_URL` | Адрес фронтенда (для формирования ссылок в боте) | `http://localhost:5173` |
| `DATABASE_URL` | Путь к базе SQLite | `sqlite+aiosqlite:///./data/signals.db` |
| `LOG_LEVEL` | Уровень логирования (`INFO` / `DEBUG`) | `INFO` |

---

## 💻 Пошаговый запуск на Windows (Локально)

### Шаг 1: Клонирование репозитория и окружение
```powershell
cd d:\AI_agent_space\gemini

# Создание виртуального окружения (если еще не создано)
python -m venv .venv
.\.venv\Scripts\activate

# Установка зависимостей бэкенда
pip install -r requirements.txt
pip install fastapi "uvicorn[standard]" aiogram aiosqlite sqlalchemy aiohttp pydantic python-dotenv websockets greenlet pytest
```

### Шаг 2: Установка зависимостей фронтенда
```powershell
cd frontend
npm install
cd ..
```

---

### Шаг 3: Запуск Бэкенда (Терминал 1)
В первом окне PowerShell:
```powershell
cd d:\AI_agent_space\gemini
.\.venv\Scripts\python.exe backend/main.py
```
* Бэкенд запустится на `http://127.0.0.1:8000`.
* Автоматически подключится стрим ликвидаций Binance WebSocket `!forceOrder@arr`.
* Запустится Telegram-бот (начнет слушать команды `/start`, `/status`, `/filters`).
* Запустится периодический сканер рынка (каждую минуту).

---

### Шаг 4: Запуск Веб-Интерфейса (Терминал 2)
Во втором окне PowerShell:
```powershell
cd d:\AI_agent_space\gemini\frontend
npm run dev
```
* Фронтенд запустится на **`http://localhost:5173`**.
* Откройте этот адрес в браузере.

---

## 🎯 Проверка работы (Критерии MVP)

1. **Проверка автотестов индикаторов и фильтров:**
   ```powershell
   .\.venv\Scripts\python.exe -m pytest backend/tests -v
   ```
   *(5 из 5 тестов проходят успешно: EMA cross, Volume spike, RSI, CVD, Cooldown).*

2. **Проверка консольного сканера:**
   ```powershell
   .\.venv\Scripts\python.exe test_scanner_cli.py
   ```
   *(Подключается к Binance REST, выводит статус и активные настройки).*

3. **Веб-интерфейс `http://localhost:5173`:**
   * **График KLineChart:** свечи подгружаются с Binance, в реальном времени тикают по WebSocket.
   * **Таймфреймы:** быстрое переключение `1m, 15m, 30m, 45m, 1h, 4h, 6h` (45m и 6h собираются бэкендом).
   * **Рисование:** кнопки отрезков, лучей, уровней, прямоугольников и Фибоначчи в верхней панели. Рисунки автоматически сохраняются по монете и ТФ в базу данных при нажатии кнопки сохранения.
   * **Стакан (Depth L2):** справа отображаются реальные заявки Binance, крупные плотности подсвечиваются золотым/бирюзовым цветом, рядом пишется таймер жизни заявки (`1m 45s`), переключатель `COIN / USDT`.
   * **Быстрые настройки:** кнопка «Настройки» в шапке открывает окно фильтров. Изменения сохраняются в базу и применяются сканером мгновенно без перезапуска сервера.

4. **Telegram Бот (`@BehanceGoTopPro_bot`):**
   * Откройте диалог с ботом и нажмите `/start`.
   * Бот зарегистрирует ваш Telegram ID и пришлет персональную ссылку на веб-терминал.
   * При срабатывании условий бот присылает уведомление с кнопкой прямого перехода на график монеты.

---

## 🐳 Запуск через Docker и Деплой на Proxmox
Подробная инструкция по развертыванию контейнеров на сервере с Proxmox и безопасной публикации в интернет через Cloudflare Tunnel находится в файле **[`DEPLOY.md`](file:///d:/AI_agent_space/gemini/DEPLOY.md)**.
