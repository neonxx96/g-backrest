# DOCKER.md — Руководство по развертыванию и эксплуатации SignalScript в Docker

SignalScript полностью упакован в легковесные контейнеры для разработки и запуска с автоматическим пробросом портов и монтированием томов данных.

---

## 1. Архитектура сервисов и порты

| Сервис | Контейнер | Внутренний порт | Внешний порт | Образ / База | Описание |
|---|---|---|---|---|---|
| **backend** | `signalscript_backend` | `8000` | `http://localhost:8000` | `python:3.11-slim` | FastAPI REST API, WebSocket-демоны Binance, сканер, paper-trading, рекордер |
| **frontend** | `signalscript_frontend` | `7100` | `http://localhost:7100` | `nginx:alpine` | Nginx reverse-proxy + Vite production bundle, PWA shell, статический веб-сервер |

- **Сеть**: bridge-сеть `signalscript_net` между сервисами.
- **Том данных**: `./data:/app/data` (база SQLite `signals.db` и Parquet кольцевой буфер `data/recorded/` переживают пересборку и перезапуск контейнеров).
- **Пользователь**: `appuser` (UID 1000, non-root) в бэкенд-контейнере.
- **Безопасность ключей**: `.dockerignore` строго исключает `.env`, `data/`, `.git`, `.venv` из контекста сборки. Секреты и ключи никогда не запекаются в образ.

---

## 2. Быстрый запуск одной кнопкой (Windows Launcher)

Для запуска одной кнопкой используйте ярлык на рабочем столе **SignalScript Terminal** или запустите батник:
```cmd
start_terminal.bat
```

Что делает лаунчер:
1. Проверяет статус Docker Desktop (запускает его в фоновом режиме, если он был выключен, и дожидается готовности сокета).
2. Выполняет `docker compose up -d`.
3. Опрашивает `http://localhost:7100` до успешного ответа HTTP 200.
4. Открывает интерфейс терминала в отдельном изолированном окне приложения (`msedge --app=http://localhost:7100` или Google Chrome App Mode).

---

## 3. Команды для ежедневной работы

### Запуск в фоне
```bash
docker compose up -d
```

### Запуск со сборкой (при изменении кода)
```bash
docker compose up -d --build
```

### Остановка сервисов
```bash
docker compose down
```

### Остановка с удалением сиротских контейнеров
```bash
docker compose down --remove-orphans
```

### Просмотр логов в реальном времени
```bash
# Все сервисы:
docker compose logs -f

# Только бэкенд:
docker compose logs -f backend

# Только фронтенд (Nginx):
docker compose logs -f frontend
```

### Проверка статуса здоровья (Healthcheck)
```bash
docker compose ps
```

---

## 4. Запуск шлюза качества внутри контейнера

Для запуска полного набора тестов (`pytest`) внутри изолированного Linux-контейнера:
```bash
# Запуск через docker compose exec:
docker compose exec backend ./scripts/check.sh --backend-only

# Или прямой запуск pytest в контейнере:
docker compose exec backend pytest backend/tests
```

---

## 5. Бэкап и восстановление данных (`data/`)

Папка `data/` содержит:
- `data/signals.db` — базу данных сигналов, настроек, пресетов и журнала решений.
- `data/recorded/` — Parquet-файлы глубины рынка L2 и сделок.

### Создание резервной копии:
```bash
# Остановка записи для консистентного снапшота базы
docker compose stop backend

# Архивирование папки data (на хосте)
tar -czvf data_backup_$(date +%Y%m%d_%H%M%S).tar.gz data/

# Возобновление работы
docker compose start backend
```

### Восстановление из архива:
```bash
docker compose down
tar -xzvf data_backup_YYYYMMDD_HHMMSS.tar.gz
docker compose up -d
```

---

## 6. Переменные окружения (.env)

Переменные считываются из `.env` при старте контейнера (шаблон — `.env.example`):

| Переменная | Значение по умолчанию | Описание |
|---|---|---|
| `BACKEND_HOST` | `0.0.0.0` | Сетевой интерфейс прослушивания внутри контейнера |
| `BACKEND_PORT` | `8000` | Внутренний и внешний порт FastAPI API |
| `FRONTEND_PORT` | `7100` | Внутренний и внешний порт Nginx веб-сервера |
| `FRONTEND_URL` | `http://localhost:7100` | URL фронтенда для CORS |
| `DATABASE_URL` | `sqlite+aiosqlite:///./data/signals.db` | Строка подключения SQLAlchemy |
| `MAX_STORAGE_GB` | `100.0` | Квота дискового пространства под Parquet-тиковые данные |
| `FOCUS_SYMBOLS` | `BTCUSDT,ETHUSDT,SOLUSDT,DOGEUSDT,XRPUSDT` | Список приоритетных монет для записи стакана и ленты |
| `WATCHLIST_SYMBOLS` | `BNBUSDT,SUIUSDT,NEARUSDT` | Вторичный список мониторинга |
| `BINANCE_API_KEY` | *(пусто)* | Опциональный публичный/тестовый ключ Binance |
| `BINANCE_API_SECRET` | *(пусто)* | Опциональный секрет Binance |
| `TELEGRAM_BOT_TOKEN`| *(пусто)* | Токен бота от @BotFather для отправки сигналов |
| `OPENROUTER_API_KEY`| *(пусто)* | Опциональный ключ OpenRouter для AI Copilot |
| `OPENROUTER_MODEL`  | `deepseek/deepseek-v4.1-flash` | Модель AI-ассистента |
| `LOG_LEVEL`         | `INFO` | Уровень логирования (`DEBUG`, `INFO`, `WARNING`, `ERROR`) |
