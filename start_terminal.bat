@echo off
setlocal enabledelayedexpansion
title SignalScript Terminal Launcher

echo ==========================================================
echo        SignalScript Terminal - One-Click Launcher
echo ==========================================================
echo.

cd /d "%~dp0"

:: 1. Check if Docker daemon is running
echo [1/4] Checking Docker status...
docker info >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Docker daemon is not active. Starting Docker Desktop...
    set "DOCKER_EXE="
    if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
        set "DOCKER_EXE=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
    ) else if exist "%LocalAppData%\Programs\Docker\Docker\Docker Desktop.exe" (
        set "DOCKER_EXE=%LocalAppData%\Programs\Docker\Docker\Docker Desktop.exe"
    )

    if defined DOCKER_EXE (
        start "" "!DOCKER_EXE!"
        echo Waiting for Docker daemon to become ready (up to 90s)...
        set /a DOCKER_WAIT=0
        :wait_docker_loop
        timeout /t 3 /nobreak >nul
        docker info >nul 2>&1
        if !ERRORLEVEL! EQU 0 (
            echo Docker daemon is ready.
            goto docker_ready
        )
        set /a DOCKER_WAIT+=3
        if !DOCKER_WAIT! GEQ 90 (
            echo [ERROR] Docker Desktop did not start within 90 seconds.
            echo Please start Docker Desktop manually and run this script again.
            pause
            exit /b 1
        )
        goto wait_docker_loop
    ) else (
        echo [ERROR] Docker Desktop executable not found.
        echo Please ensure Docker Desktop is installed and running.
        pause
        exit /b 1
    )
) else (
    echo Docker daemon is ready.
)

:docker_ready

:: 2. Launch services via docker compose
echo.
echo [2/4] Starting SignalScript containers via docker compose...
docker compose up -d
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker compose up failed. Check configuration and logs.
    pause
    exit /b %ERRORLEVEL%
)

:: 3. Wait for frontend to become healthy on http://localhost:7100
echo.
echo [3/4] Waiting for SignalScript Terminal UI (http://localhost:7100)...
set /a ATTEMPTS=0
:wait_frontend_loop
curl -s -f -I http://localhost:7100/ >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Terminal UI is ready!
    goto open_app
)
timeout /t 2 /nobreak >nul
set /a ATTEMPTS+=1
if !ATTEMPTS! GEQ 30 (
    echo [WARNING] Port 7100 did not respond within 60s, attempting to open anyway...
    goto open_app
)
goto wait_frontend_loop

:open_app
:: 4. Open in standalone application window
echo.
echo [4/4] Opening SignalScript Terminal application window...
set "BROWSER_CMD="

:: Check Microsoft Edge (built-in on Windows 10/11)
where msedge >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set "BROWSER_CMD=start msedge --app=http://localhost:7100"
    goto launch_browser
)
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_CMD=start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:7100"
    goto launch_browser
)
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_CMD=start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:7100"
    goto launch_browser
)

:: Check Google Chrome fallback
where chrome >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set "BROWSER_CMD=start chrome --app=http://localhost:7100"
    goto launch_browser
)
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_CMD=start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app=http://localhost:7100"
    goto launch_browser
)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_CMD=start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --app=http://localhost:7100"
    goto launch_browser
)

:: Default browser fallback
set "BROWSER_CMD=start http://localhost:7100"

:launch_browser
%BROWSER_CMD%
echo.
echo SignalScript Terminal started successfully.
timeout /t 3 /nobreak >nul
exit /b 0
