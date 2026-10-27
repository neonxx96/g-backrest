# ==============================================================================
# SignalScript Quality Gate Check (scripts/check.ps1)
# MANDATORY: Every agent must run this script and get a green result before committing.
# ==============================================================================

[CmdletBinding()]
param(
    [switch]$SkipBuild = $false
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $ProjectRoot

# The managed Windows sandbox denies atomic replace operations in the default
# package Temp directory. Keep pytest's temporary files inside the repository,
# where recorder and other filesystem tests have normal write/rename semantics.
$pytestTemp = Join-Path $ProjectRoot ".pytest-temp"
New-Item -ItemType Directory -Force -Path $pytestTemp | Out-Null
$env:TEMP = $pytestTemp
$env:TMP = $pytestTemp

function Test-LocalHttp {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url
    )

    try {
        $null = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
        return $true
    } catch {
        # Any HTTP response, including 4xx/5xx, proves that the local server
        # is listening. Connection and timeout failures are the only negative.
        return ($null -ne $_.Exception.Response)
    }
}

function Get-UiSmokeArgs {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Part
    )

    $args = @("--part", $Part)
    $backendReady = Test-LocalHttp -Url "http://127.0.0.1:8000/api/health"
    $frontendReady = (Test-LocalHttp -Url "http://localhost:7100/") -or (Test-LocalHttp -Url "http://127.0.0.1:7100/") -or (Test-LocalHttp -Url "http://127.0.0.1:5173/")
    if ($backendReady -and $frontendReady) {
        Write-Host "        (reusing healthy local servers; autostart disabled)" -ForegroundColor DarkGray
        $args += "--no-autostart"
    } else {
        Write-Host "        (local dev servers are started automatically if they are not running)" -ForegroundColor DarkGray
    }
    return $args
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "🚀 SignalScript Pre-Commit Verification Gate" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 0. Single-backend invariant: two concurrent backend/main.py processes
#    fight over the Telegram bot token, double-run the market scanner and
#    append to the same legacy Parquet recorder files. A .venv shim launches
#    the real interpreter as a child, so count only instance roots (a matched
#    process whose parent is not itself a matched backend process).
$matched = @()
try {
    $matched = @(Get-CimInstance Win32_Process -Filter "Name LIKE 'python%'" -ErrorAction Stop | Where-Object {
        $_.CommandLine -match 'backend[/\\]main\.py'
    })
} catch {
    $matched = @()
}
$matchedPids = @{}
foreach ($p in $matched) { $matchedPids[[int]$p.ProcessId] = $true }
$backendInstances = @($matched | Where-Object { -not $matchedPids.ContainsKey([int]$_.ParentProcessId) })
if ($backendInstances.Count -gt 1) {
    $info = ($matched | ForEach-Object { "$($_.ProcessId) (parent $($_.ParentProcessId))" }) -join ", "
    Write-Host "`n❌ [FAIL] Обнаружено $($backendInstances.Count) логических backend-процессов (разрешён ровно один)." -ForegroundColor Red
    Write-Host "  Процессы: $info" -ForegroundColor Red
    Write-Host "Остановите лишние: Stop-Process -Id <PID> -Force, затем повторите." -ForegroundColor Yellow
    exit 1
}

# 0b. Детект зависания startup: backend-процесс есть, но HTTP не поднимается
#     (инцидент 2026-10-22: процесс крутил CPU без слушающего порта, марафон
#     простаивал часами). Ждём до 60 c, затем падаем с диагностикой backend.log.
if ($backendInstances.Count -eq 1) {
    $hangDeadline = (Get-Date).AddSeconds(60)
    $backendHealthy = $false
    while ((Get-Date) -lt $hangDeadline) {
        if (Test-LocalHttp -Url "http://127.0.0.1:8000/api/health") {
            $backendHealthy = $true
            break
        }
        Start-Sleep -Seconds 5
    }
    if (-not $backendHealthy) {
        Write-Host "`n❌ [FAIL] Backend-процесс $($backendInstances[0].ProcessId) запущен, но /api/health не отвечает (>60 c)." -ForegroundColor Red
        Write-Host "  Похоже на зависание startup до bind HTTP. Диагностика:" -ForegroundColor Yellow
        $logPath = Join-Path $ProjectRoot "backend.log"
        if (Test-Path $logPath) {
            Write-Host "  --- backend.log (последние 12 строк) ---" -ForegroundColor DarkGray
            Get-Content $logPath -Tail 12 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
        } else {
            Write-Host "  backend.log не найден — процесс мог стартовать не из корня проекта." -ForegroundColor DarkGray
        }
        Write-Host "  Проверьте: Get-NetTCPConnection -State Listen | ? OwningProcess -eq $($backendInstances[0].ProcessId)" -ForegroundColor Yellow
        exit 1
    }
}

# 1. Python Unit Tests (pytest backend/tests)
Write-Host "`n[1/6] Running Python unit tests (pytest)...\n        (includes the golden backtester characterization test)" -ForegroundColor Yellow
$pytestCmd = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $pytestCmd)) {
    $pytestCmd = "python"
}

& $pytestCmd -m pytest
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ [FAIL] Pytest unit tests failed. Commit rejected." -ForegroundColor Red
    exit 1
}
Write-Host "✅ [PASS] Python unit tests passed." -ForegroundColor Green

# 2. Frontend layout recovery unit tests
Write-Host "`n[2/6] Checking frontend layout recovery (node --test)..." -ForegroundColor Yellow
node --test `
    (Join-Path $ProjectRoot "frontend\src\components\docking\layoutRecovery.test.js") `
    (Join-Path $ProjectRoot "frontend\src\services\marketTruth.test.js")
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ [FAIL] Frontend layout recovery tests failed. Commit rejected." -ForegroundColor Red
    exit 1
}
Write-Host "✅ [PASS] Frontend layout recovery tests passed." -ForegroundColor Green

# 3. Frontend Production Build Check
if (-not $SkipBuild) {
    Write-Host "`n[3/6] Checking Frontend production build (npm run build)..." -ForegroundColor Yellow
    npm --prefix frontend run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`n❌ [FAIL] Frontend build failed with syntax or bundling errors. Commit rejected." -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ [PASS] Frontend build succeeded." -ForegroundColor Green

    # 3b. Design System Lint (Ratchet)
    Write-Host "`n[3b] Checking Design System rules & ratchet (node scripts/design_lint.mjs)..." -ForegroundColor Yellow
    node (Join-Path $ProjectRoot "scripts\design_lint.mjs")
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`n❌ [FAIL] Design system lint failed (regressions or unbaselined violations detected). Commit rejected." -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ [PASS] Design system rules verified (no regressions)." -ForegroundColor Green
} else {
    Write-Host "`n[3/6] Skipping Frontend build (-SkipBuild specified)." -ForegroundColor DarkGray
}

# 4. Critical Component Live Smoke Test (Chart, DOM, Scanner, Recorder, Journal)
Write-Host "`n[4/6] Running Critical Parts Smoke Test (DOM, Chart, Scanner, Recorder, Journal)..." -ForegroundColor Yellow
& $pytestCmd (Join-Path $ProjectRoot "scripts\smoke_critical_parts.py")
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ [FAIL] Critical component smoke test failed. Check backend daemon and try again." -ForegroundColor Red
    exit 1
}
Write-Host "✅ [PASS] All critical components verified." -ForegroundColor Green

# 5. UI Smoke Test on Playwright — BLOCKING part
#    Page opens, chart + order-book canvases render, no console/page errors, symbol switch works.
#    Tolerant to an unreachable Binance: the UI may show 'disconnected', but must not crash.
Write-Host "`n[5/6] Running BLOCKING UI smoke (Playwright: page, canvases, console, symbol switch)..." -ForegroundColor Yellow
$blockingSmokeArgs = Get-UiSmokeArgs -Part "blocking"
& $pytestCmd (Join-Path $ProjectRoot "scripts\smoke_ui_playwright.py") @blockingSmokeArgs
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ [FAIL] BLOCKING UI smoke test failed. Commit rejected." -ForegroundColor Red
    exit 1
}
Write-Host "✅ [PASS] Blocking UI smoke passed (page, canvases, console, symbol switch)." -ForegroundColor Green

# 6. UI Smoke Test on Playwright — LIVE part (advisory only, never blocks the commit)
#    Checks that a Binance WebSocket is connected and prints are arriving.
Write-Host "`n[6/6] Running LIVE UI check (Playwright: Binance WS connected, prints arriving)..." -ForegroundColor Yellow
$liveSmokeArgs = Get-UiSmokeArgs -Part "live"
& $pytestCmd (Join-Path $ProjectRoot "scripts\smoke_ui_playwright.py") @liveSmokeArgs
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  [WARN] LIVE UI check reported an unexpected error (non-blocking)." -ForegroundColor DarkYellow
} else {
    Write-Host "✅ [PASS] Live UI check finished (warnings about an unreachable exchange are non-blocking)." -ForegroundColor Green
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "🎉 ALL QUALITY CHECKS PASSED. READY TO COMMIT." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
exit 0
