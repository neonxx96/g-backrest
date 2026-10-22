#Requires -Version 5.1
<#
.SYNOPSIS
    Local recorder service control (ROADMAP 2.1, decision D1: local-only mode).

.DESCRIPTION
    Starts/stops the standalone recorder package locally against recorder.local.yaml.
    The recorder writes the immutable Parquet lake under data/lake and follows the
    active watchlist via data/active_watchlist.json (M1.3a).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/run_recorder.ps1 -Action start
    powershell -ExecutionPolicy Bypass -File scripts/run_recorder.ps1 -Action status
    powershell -ExecutionPolicy Bypass -File scripts/run_recorder.ps1 -Action stop
#>
param(
    [ValidateSet('start', 'stop', 'status')]
    [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$PidFile = Join-Path $Root 'data\recorder.local.pid'
$LogFile = Join-Path $Root 'data\recorder.local.log'
$Python = Join-Path $Root '.venv\Scripts\python.exe'
$Config = Join-Path $Root 'recorder.local.yaml'

function Get-RecorderProcess {
    if (-not (Test-Path $PidFile)) { return $null }
    $pidValue = [int](Get-Content $PidFile -Raw).Trim()
    $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    return $proc
}

switch ($Action) {
    'status' {
        $proc = Get-RecorderProcess
        if ($proc) {
            Write-Output "recorder: RUNNING (PID $($proc.Id), started $($proc.StartTime))"
        } else {
            Write-Output 'recorder: NOT RUNNING'
        }
        & $Python -m recorder status --config $Config
    }
    'start' {
        $existing = Get-RecorderProcess
        if ($existing) {
            Write-Output "recorder already RUNNING (PID $($existing.Id)); skipping start"
            exit 0
        }
        $proc = Start-Process -FilePath $Python `
            -ArgumentList '-m','recorder','run','--config', $Config `
            -WorkingDirectory $Root `
            -RedirectStandardOutput $LogFile `
            -RedirectStandardError "$LogFile.err" `
            -WindowStyle Hidden -PassThru
        Set-Content -Path $PidFile -Value $proc.Id
        Write-Output "recorder: STARTED (PID $($proc.Id)), log: $LogFile"
    }
    'stop' {
        $proc = Get-RecorderProcess
        if ($proc) {
            Stop-Process -Id $proc.Id -Force
            Remove-Item $PidFile -ErrorAction SilentlyContinue
            Write-Output "recorder: STOPPED (PID $($proc.Id))"
        } else {
            Write-Output 'recorder: NOT RUNNING'
        }
    }
}
