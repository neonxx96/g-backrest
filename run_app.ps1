# =======================================================
# Signal Script - 1-Click Startup Script (Windows PowerShell)
# =======================================================

$ErrorActionPreference = "Stop"

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Starting Signal Script - Binance Trading Assistant  " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

$root = $PSScriptRoot
$venvPython = Join-Path $root ".venv\Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    Write-Host "[!] Virtual environment (.venv) not detected. Using system python..." -ForegroundColor Yellow
    $venvPython = "python"
}

# 1. Start Backend (guard: only one backend instance is ever allowed —
#    two processes corrupt Telegram polling, the scanner and the Parquet recorder).
#    A .venv shim launches the real interpreter as a child, so count only
#    instance roots (a matched process whose parent is not a matched backend).
$matched = @(Get-CimInstance Win32_Process -Filter "Name LIKE 'python%'" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -match 'backend[/\\]main\.py'
})
$matchedPids = @{}
foreach ($p in $matched) { $matchedPids[[int]$p.ProcessId] = $true }
$existingBackend = @($matched | Where-Object { -not $matchedPids.ContainsKey([int]$_.ParentProcessId) })
function Test-SignalScriptBackend {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/health" -TimeoutSec 3
        return $health.status -eq "ok" -and $health.service -eq "signalscript-backend"
    } catch { return $false }
}

function Test-SignalScriptFrontend {
    try {
        $identity = Invoke-RestMethod -Uri "http://localhost:7100/signalscript-identity.json" -TimeoutSec 3
        return $identity.service -eq "signalscript-frontend" -and $identity.contract_version -eq 1
    } catch { return $false }
}

$backendPort = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if ($existingBackend.Count -gt 0 -and (Test-SignalScriptBackend)) {
    Write-Host "[1/2] Backend уже запущен (PID: $($existingBackend[0].ProcessId)) — пропускаю запуск второго экземпляра." -ForegroundColor Yellow
} elseif ($backendPort) {
    throw "Port 8000 is occupied by an unverified process; refusing to start or terminate it."
} else {
    Write-Host "[1/2] Starting FastAPI Backend on http://127.0.0.1:8000..." -ForegroundColor Green
    $backendProc = Start-Process -FilePath $venvPython -ArgumentList "backend/main.py" -WorkingDirectory $root -PassThru -WindowStyle Minimized
}

# 2. Start Frontend (guard: Vite is strict on 7100 and never falls back)
$viteBusy = Get-NetTCPConnection -LocalPort 7100 -State Listen -ErrorAction SilentlyContinue
if ($viteBusy) {
    if (-not (Test-SignalScriptFrontend)) {
        throw "Port 7100 is occupied by an unverified process; refusing to start or terminate it."
    }
    Write-Host "[2/2] SignalScript frontend уже слушает порт 7100 (PID: $($viteBusy[0].OwningProcess)) — пропускаю запуск второго Vite." -ForegroundColor Yellow
} else {
    Write-Host "[2/2] Starting React Vite Frontend on http://localhost:7100..." -ForegroundColor Green
    $frontendProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev -- --host 127.0.0.1 --port 7100 --strictPort" -WorkingDirectory (Join-Path $root "frontend") -PassThru -WindowStyle Minimized
}

Start-Sleep -Seconds 3

Write-Host ""
Write-Host "======================================================" -ForegroundColor Green
Write-Host "  Signal Script is successfully running!" -ForegroundColor Green
Write-Host "  -> Terminal Web UI: http://localhost:7100" -ForegroundColor White
Write-Host "  -> Backend API:     http://127.0.0.1:8000/docs" -ForegroundColor White
Write-Host "  -> To stop:         run .\stop_app.ps1" -ForegroundColor Yellow
Write-Host "======================================================" -ForegroundColor Green

# 3. Open Web UI in default browser
Start-Process "http://localhost:7100"
