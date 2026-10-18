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

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "🚀 SignalScript Pre-Commit Verification Gate" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Python Unit Tests (pytest backend/tests)
Write-Host "`n[1/3] Running Python unit tests (pytest)..." -ForegroundColor Yellow
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
    Write-Host "`n[2/3] Checking Frontend production build (npm run build)..." -ForegroundColor Yellow
    npm --prefix frontend run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`n❌ [FAIL] Frontend build failed with syntax or bundling errors. Commit rejected." -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ [PASS] Frontend build succeeded." -ForegroundColor Green
} else {
    Write-Host "`n[2/3] Skipping Frontend build (-SkipBuild specified)." -ForegroundColor DarkGray
}

# 3. Critical Component Live Smoke Test (Chart, DOM, Scanner, Recorder, Journal)
Write-Host "`n[3/3] Running Critical Parts Smoke Test (DOM, Chart, Scanner, Recorder, Journal)..." -ForegroundColor Yellow
& $pytestCmd (Join-Path $ProjectRoot "scripts\smoke_critical_parts.py")
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ [FAIL] Critical component smoke test failed. Check backend daemon and try again." -ForegroundColor Red
    exit 1
}
Write-Host "✅ [PASS] All critical components verified." -ForegroundColor Green

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "🎉 ALL QUALITY CHECKS PASSED. READY TO COMMIT." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
exit 0
