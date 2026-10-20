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
    $frontendReady = Test-LocalHttp -Url "http://127.0.0.1:5173/"
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

# 1. Python Unit Tests (pytest backend/tests)
Write-Host "`n[1/5] Running Python unit tests (pytest)...\n        (includes the golden backtester characterization test)" -ForegroundColor Yellow
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

# 2. Frontend Production Build Check
if (-not $SkipBuild) {
    Write-Host "`n[2/5] Checking Frontend production build (npm run build)..." -ForegroundColor Yellow
    npm --prefix frontend run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`n❌ [FAIL] Frontend build failed with syntax or bundling errors. Commit rejected." -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ [PASS] Frontend build succeeded." -ForegroundColor Green
} else {
    Write-Host "`n[2/5] Skipping Frontend build (-SkipBuild specified)." -ForegroundColor DarkGray
}

# 3. Critical Component Live Smoke Test (Chart, DOM, Scanner, Recorder, Journal)
Write-Host "`n[3/5] Running Critical Parts Smoke Test (DOM, Chart, Scanner, Recorder, Journal)..." -ForegroundColor Yellow
& $pytestCmd (Join-Path $ProjectRoot "scripts\smoke_critical_parts.py")
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ [FAIL] Critical component smoke test failed. Check backend daemon and try again." -ForegroundColor Red
    exit 1
}
Write-Host "✅ [PASS] All critical components verified." -ForegroundColor Green

# 4. UI Smoke Test on Playwright — BLOCKING part
#    Page opens, chart + order-book canvases render, no console/page errors, symbol switch works.
#    Tolerant to an unreachable Binance: the UI may show 'disconnected', but must not crash.
Write-Host "`n[4/5] Running BLOCKING UI smoke (Playwright: page, canvases, console, symbol switch)..." -ForegroundColor Yellow
$blockingSmokeArgs = Get-UiSmokeArgs -Part "blocking"
& $pytestCmd (Join-Path $ProjectRoot "scripts\smoke_ui_playwright.py") @blockingSmokeArgs
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ [FAIL] BLOCKING UI smoke test failed. Commit rejected." -ForegroundColor Red
    exit 1
}
Write-Host "✅ [PASS] Blocking UI smoke passed (page, canvases, console, symbol switch)." -ForegroundColor Green

# 5. UI Smoke Test on Playwright — LIVE part (advisory only, never blocks the commit)
#    Checks that a Binance WebSocket is connected and prints are arriving.
Write-Host "`n[5/5] Running LIVE UI check (Playwright: Binance WS connected, prints arriving)..." -ForegroundColor Yellow
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
