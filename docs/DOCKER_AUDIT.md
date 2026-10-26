# DOCKER_AUDIT.md — Инвентаризация зависимостей окружения и портов SignalScript

Дата аудита: 2026-10-27  
Ветка: `agent/antigravity/docker`

---

## 1. Скрипты, завязанные на Windows и PowerShell

| Файл | Назначение | Зависимости от Windows / Причина несовместимости с Linux | Решение для Docker / Linux |
|---|---|---|---|
| `scripts/check.ps1` | Единый шлюз качества перед коммитом | Синтаксис PowerShell (`Get-CimInstance`, `Win32_Process`, `Invoke-WebRequest`, пути с `\`) | Создан `scripts/check.sh` (bash-эквивалент с поддержкой `--backend-only`, `--skip-build`) |
| `scripts/run_app.ps1` | Локальный запуск бэкенда и фронтенда | `Get-NetTCPConnection`, `Start-Process`, `powershell.exe` | Заменяется на `docker compose up -d` или `start_terminal.bat` |
| `scripts/night-pilot.ps1` | CLI ночного марафона | PowerShell параметры, Windows WMI детекторы | Запуск внутри контейнера через `python scripts/launch_overnight_8pairs.py` или curl к `/api/overnight-pilot/start` |
| `scripts/run_recorder.ps1` | Запуск автономного рекордера | PowerShell запуск фонового процесса | В контейнере рекордер стартует автоматически как фоновый воркер `backend/main.py` |
| `scripts/launch_qa_terminal.ps1` | Запуск тестового терминала | PowerShell, запуск браузера | Launcher `start_terminal.bat` с Edge/Chrome `--app` |
| `scripts/cline-auto.cmd` / `.ps1` | Авто-маршрутизация задач Cline | PowerShell, cmd.exe | Относится к хост-окружению агентов, в контейнер не помещается |
| `backend/main.py` (L12-17) | Реконфигурация кодировки stdout/stderr | `sys.platform == "win32"` (безопасный `try/except`) | На Linux/Docker игнорируется, работает штатный UTF-8 |
| `backend/app/logging_setup.py` | Цветной вывод логов | Ветка для `win32` | Кроссплатформенно, работает на Linux через ANSI escape |
| `backend/tests/conftest.py` | Sandbox guards | Отключает async-тесты при `sys.platform == "win32"` | В Linux/Docker контейнере тесты выполняются без ограничений Windows Sandbox |
| `scripts/smoke_ui_playwright.py` | UI Playwright smoke | `netstat -ano`, `taskkill` для остановки процессов | В контейнере используется `--no-autostart`, обращение к готовым портам |

---

## 2. Инвентаризация портов и сетевых адресов

| Компонент | Порт | Переменная окружения | Поведение по умолчанию | Требование в контейнере |
|---|---|---|---|---|
| **FastAPI Backend** | `8000` | `BACKEND_PORT`, `BACKEND_HOST` | `127.0.0.1:8000` | В контейнере `BACKEND_HOST=0.0.0.0`, чтобы Nginx и хост могли подключиться; проброс `8000:8000` |
| **Frontend UI (Nginx / Vite)** | `7100` | `FRONTEND_PORT`, `VITE_PORT` | `localhost:7100` | Стандарт SignalScript — строго `7100`. Nginx слушает `7100`, проброс `7100:7100` |
| **API Proxy** | `/api/*` | N/A | Относительный путь `API_BASE = '/api'` | Nginx проксирует `location /api/` на `http://backend:8000/api/` без CORS |
| **WebSocket Stream** | Binance WS | N/A | Прямое исходящее подключение из браузера/бэкенда к `fstream.binance.com:443` | Разрешен исходящий интернет-трафик в Docker bridge-сети |

---

## 3. Пути к данным и томам (Volumes)

| Путь | Назначение | Размер | Поведение в Docker |
|---|---|---|---|
| `./data/signals.db` | База SQLite (журнал решений, сигналы, раскладки dockview) | < 100 MB | Монтируется в томе `./data:/app/data` (сохраняется при пересборках) |
| `./data/recorded/` | Кольцевой буфер тиков и стаканов Parquet | ~48 GB (до 100 GB) | **Строго том** `./data:/app/data`. Исключен из сборки через `.dockerignore` |
| `.env` | Локальные ключи и переменные | < 5 KB | **Исключен из образа** через `.dockerignore`. Передается через `env_file` при `docker compose up` |
| `.venv/`, `node_modules/` | Локальные зависимости хоста | ~3 GB | **Исключены из образа** через `.dockerignore`. Зависимости собираются внутри контейнеров |

---

## 4. Обоснование выбора архитектуры Frontend (Nginx vs Dev-режим)

Для упакованного образа SignalScript выбран **Multi-stage build: сборка через Vite + раздача статики через Nginx на порту 7100**:

1. **Ресурсоемкость и стабильность**:
   - Nginx образ весит ~25 МБ и потребляет ~15 МБ RAM.
   - Node.js dev-сервер в контейнере потребляет 350–500 МБ RAM, создает нагрузку на inotify при наблюдении за файлами и подвержен сбоям WebSocket HMR при запуске через Docker bridge.
2. **Скорость старта**:
   - Nginx стартует за 0.2 секунды. При запуске через `start_terminal.bat` окно терминала открывается мгновенно.
3. **Безупречное проксирование API (Zero-CORS)**:
   - Nginx слушает порт `7100` и локально перенаправляет `/api/` на `http://backend:8000/api/`. Все сетевые запросы из браузера идут на тот же origin (`http://localhost:7100`), что исключает блокировки Mixed Content, CORS и несовпадения сетевых интерфейсов.
4. **PWA Standalone Shell**:
   - Терминал запускается как автономное PWA-приложение (`msedge --app=http://localhost:7100`), где Service Worker кеширует неизменяемую оболочку UI, а живые биржевые котировки идут без задержек.
5. **Локальная разработка**:
   - Разработчики, активно модифицирующие код React компонентов с hot-reload, по-прежнему могут запускать `npm run dev` на хосте, в то время как Docker предоставляет воспроизводимое изолированное окружение для запуска и тестирования.
