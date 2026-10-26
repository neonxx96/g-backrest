# run_app.ps1 — запуск SignalScript: backend (:8000) + frontend (:7100).
# Безопасен к повторному запуску: компонент пропускается, если его порт уже занят.
# Требование кодировки (AGENTS.md): файл сохранён как UTF-8 with BOM — не менять!

[CmdletBinding()]
param(
    [switch]$SkipFrontend
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

function Test-PortListening {
    param([int]$Port)
    $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    return ($null -ne $conn)
}

function Test-BackendHealthy {
    try {
        $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 3
        return ($r.status -eq 'ok')
    } catch {
        return $false
    }
}

# --- Backend ---
$backendStarted = $false
if (Test-PortListening -Port 8000) {
    if (Test-BackendHealthy) {
        Write-Host '[run_app] Backend уже работает на :8000 (health ok) — пропуск запуска.'
        $backendStarted = $true
    } else {
        Write-Warning '[run_app] Порт :8000 занят, но /api/health не отвечает. Убейте зависший процесс вручную (Get-NetTCPConnection -State Listen -LocalPort 8000). Backend НЕ запущен.'
    }
} else {
    Write-Host '[run_app] Старт backend ...'
    Start-Process -FilePath "$ProjectRoot\.venv\Scripts\python.exe" `
        -ArgumentList 'backend/main.py' `
        -WorkingDirectory $ProjectRoot `
        -RedirectStandardOutput "$ProjectRoot\backend-runtime.stdout.log" `
        -RedirectStandardError "$ProjectRoot\backend-runtime.stderr.log" `
        -WindowStyle Hidden
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        if (Test-BackendHealthy) { $backendStarted = $true; break }
        Start-Sleep -Seconds 2
    }
    if ($backendStarted) { Write-Host '[run_app] Backend поднят (health ok).' }
    else { Write-Error '[run_app] Backend не поднялся за 60 c — см. backend-runtime.stderr.log' }
}

# --- Frontend ---
if (-not $SkipFrontend) {
    if (Test-PortListening -Port 7100) {
        Write-Host '[run_app] Frontend уже работает на :7100 — пропуск запуска.'
    } else {
        Write-Host '[run_app] Старт frontend (npm run dev) ...'
        Start-Process -FilePath 'npm' -ArgumentList 'run dev -- --host 127.0.0.1 --port 7100' `
            -WorkingDirectory "$ProjectRoot\frontend" -WindowStyle Minimized
    }
}

Write-Host '[run_app] Готово. Терминал: http://127.0.0.1:7100 (http://localhost:7100)'
