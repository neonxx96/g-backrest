param(
    [string]$Config = "recorder.yaml"
)

$ErrorActionPreference = "Stop"
& .\.venv\Scripts\python.exe -m recorder run --config $Config
