@echo off
rem Демо-вотчдог SignalScript: держит бэкенд и демо-пары живыми.
rem Запуск: двойной клик по этому файлу. Остановка: .venv\Scripts\python.exe scripts\demo_watchdog.py --stop
cd /d %~dp0
".venv\Scripts\python.exe" scripts\start_watchdog.py
