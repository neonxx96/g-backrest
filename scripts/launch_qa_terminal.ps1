# Launcher for Autonomous QA Monkey Tester in a separate PowerShell window
$Host.UI.RawUI.WindowTitle = "SignalScript Autonomous QA Tester"
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "🚀 SignalScript Autonomous QA Tester & Exploratory Monkey" -ForegroundColor Green
Write-Host "Logs: backend/logs/qa_background_tester.log" -ForegroundColor Yellow
Write-Host "Audit: QA_BUGS_AUDIT.md" -ForegroundColor Yellow
Write-Host "======================================================================" -ForegroundColor Cyan

Set-Location -Path "D:\AI_agent_space\gemini"
& ".\.venv\Scripts\python.exe" "scripts\qa_background_monkey_tester.py"
