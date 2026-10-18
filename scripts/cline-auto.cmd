@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0cline-auto.ps1" %*
exit /b %ERRORLEVEL%
