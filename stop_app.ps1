# =======================================================
# Signal Script - 1-Click Stop Script (Windows PowerShell)
# =======================================================

Write-Host "Stopping Signal Script processes..." -ForegroundColor Yellow

$killed = 0

# Stop Python backend processes
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -like "*backend/main.py*" -or $_.CommandLine -like "*backend\main.py*" -or $_.ExecutablePath -like "*gemini\.venv*") {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        $killed++
    }
}

# Stop Node frontend dev server
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -like "*vite*" -or $_.ExecutablePath -like "*gemini*") {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        $killed++
    }
}

Write-Host "Stopped $killed running Signal Script processes." -ForegroundColor Green
Write-Host "Backend and Frontend have been cleanly shut down." -ForegroundColor Cyan
