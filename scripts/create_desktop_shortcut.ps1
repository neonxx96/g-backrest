# ==============================================================================
# Create Desktop Shortcut for SignalScript Terminal
# ==============================================================================
$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$DesktopPath = [Environment]::GetFolderPath("Desktop")

$ShortcutFile = Join-Path $DesktopPath "SignalScript Terminal.lnk"
$TargetFile = Join-Path $ProjectRoot "start_terminal.bat"
$IconFile = Join-Path $ProjectRoot "assets\terminal.ico"

$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut($ShortcutFile)
$Shortcut.TargetPath = $TargetFile
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.Description = "SignalScript Trading Terminal"
if (Test-Path $IconFile) {
    $Shortcut.IconLocation = "$IconFile,0"
}
$Shortcut.Save()

Write-Host "✅ Ярлык успешно создан на рабочем столе: $ShortcutFile" -ForegroundColor Green
