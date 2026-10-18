[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$TaskFile,

    [Parameter(Mandatory = $false)]
    [string]$Prompt,

    [Parameter(Mandatory = $false)]
    [ValidateSet('routine', 'standard', 'expert', 'review')]
    [string]$Route,

    [Parameter(Mandatory = $false)]
    [string]$ModelOverride,

    [Parameter(Mandatory = $false)]
    [switch]$DryRun,

    [Parameter(Mandatory = $false)]
    [switch]$AutoApprove
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RoutingConfigPath = Join-Path $ProjectRoot 'config\model-routing.json'
$LogPath = Join-Path $ProjectRoot 'context\ROUTING_LOG.md'

if (-not (Test-Path -LiteralPath $RoutingConfigPath)) {
    throw "Routing config not found: $RoutingConfigPath"
}

$config = Get-Content -Raw -LiteralPath $RoutingConfigPath | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($TaskFile) -and [string]::IsNullOrWhiteSpace($Prompt)) {
    throw 'Provide -TaskFile or -Prompt.'
}

if (-not [string]::IsNullOrWhiteSpace($TaskFile)) {
    $taskPath = $TaskFile
    if (-not [System.IO.Path]::IsPathRooted($taskPath)) {
        $taskPath = Join-Path $ProjectRoot $taskPath
    }
    if (-not (Test-Path -LiteralPath $taskPath)) {
        throw "Task file not found: $taskPath"
    }
    $taskText = Get-Content -Raw -LiteralPath $taskPath
    $resolvedTaskPath = (Resolve-Path -LiteralPath $taskPath).Path
    $taskLabel = $resolvedTaskPath.Substring($ProjectRoot.Length).TrimStart([char[]](92, 47))
} else {
    $taskText = $Prompt
    $taskLabel = 'inline prompt'
}

function Test-KeywordMatch([string]$Text, [object]$Words) {
    foreach ($word in $Words) {
        if ($Text.IndexOf([string]$word, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
            return $true
        }
    }
    return $false
}

$detectedRoute = $config.defaultRoute
$reason = 'Default route: normal implementation.'

if ([string]::IsNullOrWhiteSpace($Route)) {
    if (Test-KeywordMatch $taskText $config.keywords.review) {
        $detectedRoute = 'review'
        $reason = 'Review/audit language detected.'
    } elseif (Test-KeywordMatch $taskText $config.keywords.expert) {
        $detectedRoute = 'expert'
        $reason = 'Risk-sensitive or technically complex keywords detected.'
    } elseif (Test-KeywordMatch $taskText $config.keywords.routine) {
        $detectedRoute = 'routine'
        $reason = 'Routine documentation, text, styling, or isolated UI keywords detected.'
    }
} else {
    $detectedRoute = $Route
    $reason = 'Route explicitly supplied by the caller.'
}

$routeConfig = $config.routes.$detectedRoute
$model = if ([string]::IsNullOrWhiteSpace($ModelOverride)) { $routeConfig.model } else { $ModelOverride }
$provider = $routeConfig.provider

$contextParts = @()
foreach ($relativePath in @('AGENTS.md', 'HANDOFF.md', 'context\CURRENT_TASK.md')) {
    $contextPath = Join-Path $ProjectRoot $relativePath
    if (Test-Path -LiteralPath $contextPath) {
        $contextParts += "===== $relativePath =====`n" + (Get-Content -Raw -LiteralPath $contextPath)
    }
}

$fullPrompt = @"
You are working in $ProjectRoot.

AUTOMATIC MODEL ROUTING
- Route: $detectedRoute
- Model: $model
- Reason: $reason
- Task: $taskLabel

Read the project rules below before changing anything. Work only within the task scope. Do not change model during this task. If the task is materially more complex than the selected route, stop and report ESCALATE_MODEL instead of silently continuing.

$($contextParts -join "`n`n")

===== TASK =====
$taskText

When finished, run the required project checks, report the actual output, list changed files, and update HANDOFF.md according to the project protocol.
"@

$timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$logEntry = "`n### $timestamp`n- Task: ``$taskLabel```n- Route: **$detectedRoute**`n- Model: ``$model```n- Reason: $reason`n"

if (-not (Test-Path -LiteralPath (Split-Path -Parent $LogPath))) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogPath) | Out-Null
}
if (-not (Test-Path -LiteralPath $LogPath)) {
    Set-Content -Encoding UTF8 -LiteralPath $LogPath -Value "# Cline Automatic Routing Log`r`n"
}
Add-Content -Encoding UTF8 -LiteralPath $LogPath -Value $logEntry

Write-Output "ROUTE=$detectedRoute"
Write-Output "MODEL=$model"
Write-Output "PROVIDER=$provider"
Write-Output "REASON=$reason"

if ($DryRun) {
    Write-Output 'DRY_RUN=true; Cline was not started.'
    exit 0
}

$cline = Get-Command cline -ErrorAction SilentlyContinue
if ($null -eq $cline) {
    throw 'Cline CLI was not found on PATH. Install/login Cline CLI, then rerun this script. Dry-run classification is still available with -DryRun.'
}

$oldProvider = $env:CLINE_PROVIDER
try {
    $env:CLINE_PROVIDER = $provider
    $approval = if ($AutoApprove) { 'true' } else { 'false' }
    & $cline.Source '--model' $model '--auto-approve' $approval $fullPrompt
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
} finally {
    if ($null -eq $oldProvider) {
        Remove-Item Env:CLINE_PROVIDER -ErrorAction SilentlyContinue
    } else {
        $env:CLINE_PROVIDER = $oldProvider
    }
}
