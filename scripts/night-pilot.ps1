[CmdletBinding()]
param(
    [ValidateSet('preflight', 'start', 'status', 'report', 'stop')]
    [string]$Action = 'start',
    [ValidateSet('production_robust', 'diagnostics_lenient', 'naked_test', 'optimal_live', 'diversified_paper', 'default')]
    [string]$Preset = 'diversified_paper',
    [ValidateRange(1, 65535)]
    [int]$Port = 8002,
    [ValidateRange(0, 1440)]
    [int]$MonitorMinutes = 0,
    [string]$ApiBase = ''
)

$ErrorActionPreference = 'Stop'

function Repair-TextEncoding {
    param([AllowNull()][string]$Value)

    if ([string]::IsNullOrEmpty($Value) -or $Value -notmatch '[\u00C3\u00C2\u00D0\u00D1\u00E2]') {
        return $Value
    }

    try {
        $decoded = [System.Text.Encoding]::UTF8.GetString(
            [System.Text.Encoding]::GetEncoding(28591).GetBytes($Value)
        )
        if ($decoded -notmatch '�') {
            return $decoded
        }
    } catch {
        # Keep the original value if the console/server returned an unexpected encoding.
    }
    return $Value
}

if ([string]::IsNullOrWhiteSpace($ApiBase)) {
    $ApiBase = "http://127.0.0.1:$Port"
}

$pilotBase = "$ApiBase/api/overnight-pilot"

function Invoke-PilotJson {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [ValidateSet('Get', 'Post')][string]$Method = 'Get',
        [object]$Body
    )

    $params = @{
        Uri = $Uri
        Method = $Method
        TimeoutSec = 120
        UseBasicParsing = $true
    }
    if ($null -ne $Body) {
        $params.ContentType = 'application/json'
        $params.Body = ($Body | ConvertTo-Json -Depth 12 -Compress)
    }
    return Invoke-RestMethod @params
}

function Write-PilotSummary {
    param([Parameter(Mandatory = $true)][object]$Result)

    Write-Host "Night Pilot: $($Result.status)"
    foreach ($row in @($Result.summary)) {
        $paper = if ($null -eq $row.paper_equity) { 'IDLE' } else { [math]::Round([double]$row.paper_equity, 2) }
        $roi = if ($null -eq $row.backtest_roi_pct) { '—' } else { [math]::Round([double]$row.backtest_roi_pct, 3) }
        $direction = if ($row.forecast_direction) { $row.forecast_direction } else { 'NO_TRADE' }
        $dataStatus = if ($row.paper_data_status -and $row.paper_data_status -ne 'unknown') { $row.paper_data_status } elseif ($row.forecast_data_status) { $row.forecast_data_status } else { 'unknown' }
        $paperPnl = if ($null -eq $row.paper_pnl) { '—' } else { [math]::Round([double]$row.paper_pnl, 2) }
        $forecastNoTrade = if ($null -eq $row.forecast_no_trade_count) { 0 } else { $row.forecast_no_trade_count }
        $paperNoEntry = if ($null -eq $row.paper_no_trade_count) { 0 } else { $row.paper_no_trade_count }
        $optimizerStatus = if ($row.optimization_status) { $row.optimization_status } else { 'not_run' }
        $optimizerOos = if ($null -eq $row.optimization_oos_pnl_pct) { '—' } else { ('{0:N2}%' -f [double]$row.optimization_oos_pnl_pct) }
        Write-Host ("{0,-9} {1,-22} BT trades={2,-4} ROI={3,7}% Forecast={4,-8} Paper={5} PnL={6,7} Data={7}" -f `
            $row.symbol, $row.strategy_type, $row.backtest_trades, $roi, `
            $direction, $paper, $paperPnl, $dataStatus)
        Write-Host ("           Optimizer={0} OOS Net={1} combinations={2}" -f $optimizerStatus, $optimizerOos, $row.optimization_combinations_tested)
        if ($row.optimization_error) { Write-Host "           Optimizer note: $(Repair-TextEncoding ([string]$row.optimization_error))" }
        Write-Host ("           Forecast NO_TRADE={0} | Paper no-entry={1}" -f $forecastNoTrade, $paperNoEntry)
        if ($row.paper_last_decision_reason) { Write-Host "           Decision: $(Repair-TextEncoding ([string]$row.paper_last_decision_reason))" }
        if ($row.error) { Write-Warning "$($row.symbol): $($row.error)" }
    }
}

function Write-WarningSentinel {
    param([Parameter(Mandatory = $true)][object]$Result)

    foreach ($row in @($Result.summary)) {
        $noEntry = if ($null -eq $row.paper_no_trade_count) { 0 } else { [int]$row.paper_no_trade_count }
        $closedTrades = if ($null -eq $row.paper_closed_trades) { 0 } else { [int]$row.paper_closed_trades }
        if ($noEntry -ge 10 -and $closedTrades -eq 0) {
            Write-Warning "[WARNING] HIGH NO_ENTRY COUNT - Check Filters! [$($row.symbol): $noEntry]"
        }
        $netPnl = if ($null -eq $row.paper_pnl) { 0.0 } else { [double]$row.paper_pnl }
        $grossPnl = if ($null -eq $row.paper_gross_pnl) { 0.0 } else { [double]$row.paper_gross_pnl }
        if ($netPnl -lt 0 -and $grossPnl -gt 0) {
            Write-Warning "[WARNING] FEE DRAG DETECTED [$($row.symbol): Gross=$([math]::Round($grossPnl, 2)) Net=$([math]::Round($netPnl, 2))]"
        }
    }
}

function Write-PaperMorningTable {
    param([Parameter(Mandatory = $true)][object]$Result)

    $rows = @($Result.summary | ForEach-Object {
        [PSCustomObject]@{
            Symbol = $_.symbol
            WinRate = ('{0:N2}%' -f $(if ($null -eq $_.paper_win_rate_pct) { 0.0 } else { [double]$_.paper_win_rate_pct }))
            NetPnL = ('$' + ('{0:N2}' -f $(if ($null -eq $_.paper_pnl) { 0.0 } else { [double]$_.paper_pnl })))
            TotalFees = ('$' + ('{0:N2}' -f $(if ($null -eq $_.paper_total_fees) { 0.0 } else { [double]$_.paper_total_fees })))
        }
    })
    if ($rows.Count -gt 0) {
        Write-Host 'Paper results by symbol:'
        $rows | Format-Table -AutoSize | Out-String | Write-Host
    }
}

function Write-PilotReport {
    param([Parameter(Mandatory = $true)][object]$Result)

    Write-Host "Night Pilot morning report: $($Result.status)"
    if ($null -eq $Result.aggregate) {
        Write-Warning "Aggregate report is unavailable in the running backend process. Showing a client-derived aggregate from the separated summary rows; restart backend after the active paper test for the server-native report."
        Write-PilotFallbackAggregate $Result
        Write-PilotSummary $Result
        return
    }
    $bt = $Result.aggregate.backtest
    $fc = $Result.aggregate.forecast
    $paper = $Result.aggregate.paper
    $data = $Result.aggregate.data
    Write-Host ("Backtest: Net PnL={0} ROI={1}% Trades={2} Win={3}% PF={4} MaxDD={5}%" -f `
        [math]::Round([double]$bt.net_pnl_usd, 2), [math]::Round([double]$bt.roi_pct, 3), $bt.trades,
        [math]::Round([double]$bt.win_rate_pct, 2), $bt.profit_factor, [math]::Round([double]$bt.max_drawdown_pct, 3))
    Write-Host ("Forecast: LONG={0} SHORT={1} NO_TRADE={2} DataErrors={3}" -f `
        $fc.direction_counts.LONG, $fc.direction_counts.SHORT, $fc.direction_counts.NO_TRADE, $data.error_count)
    foreach ($reason in @($fc.no_trade_reasons.PSObject.Properties)) {
        Write-Host "  Forecast reason [$($reason.Name)]: $(Repair-TextEncoding ([string]$reason.Value))"
    }
    $paperEquity = if ($null -eq $paper.equity) { '—' } else { [math]::Round([double]$paper.equity, 2) }
    $paperPnl = if ($null -eq $paper.net_pnl_usd) { '—' } else { [math]::Round([double]$paper.net_pnl_usd, 2) }
    $paperRoi = if ($null -eq $paper.roi_pct) { '—' } else { [math]::Round([double]$paper.roi_pct, 3) }
    Write-Host ("Paper: Balance={0} -> Equity={1} NetPnL={2} ROI={3}% Trades={4} Win={5}% PF={6} Risk={7}% NO_ENTRY={8}" -f `
        $paper.starting_balance, $paperEquity, $paperPnl, $paperRoi,
        $paper.closed_trades, [math]::Round([double]$paper.win_rate_pct, 2), $paper.profit_factor,
        $paper.average_risk_pct, $paper.no_trade_count)
    if (@($paper.losing_trade_reasons).Count -gt 0) {
        Write-Host "  Paper loss reasons: $($paper.losing_trade_reasons -join ', ')"
    }
    Write-Host "Per strategy:"
    Write-PilotSummary $Result
    Write-PaperMorningTable $Result
    Write-WarningSentinel $Result
}

function Write-PilotFallbackAggregate {
    param([Parameter(Mandatory = $true)][object]$Result)

    $rows = @($Result.summary)
    if ($rows.Count -eq 0) {
        Write-Warning "No summary rows are available to derive an aggregate report."
        return
    }

    $btNet = ($rows | ForEach-Object { [double]($_.backtest_net_pnl) } | Measure-Object -Sum).Sum
    $btTrades = ($rows | ForEach-Object { [int]($_.backtest_trades) } | Measure-Object -Sum).Sum
    $btWin = if ($btTrades -gt 0) {
        (($rows | ForEach-Object { [double]($_.backtest_win_rate_pct) * [int]($_.backtest_trades) } | Measure-Object -Sum).Sum / $btTrades)
    } else { 0 }
    $paperStarting = ($rows | ForEach-Object { [double]($_.paper_starting_balance) } | Measure-Object -Sum).Sum
    $paperEquity = ($rows | ForEach-Object { [double]($_.paper_equity) } | Measure-Object -Sum).Sum
    $paperPnl = ($rows | ForEach-Object { [double]($_.paper_pnl) } | Measure-Object -Sum).Sum
    $paperNoEntry = ($rows | ForEach-Object { [int]($_.paper_no_trade_count) } | Measure-Object -Sum).Sum
    $forecastNoTrade = ($rows | ForEach-Object { [int]($_.forecast_no_trade_count) } | Measure-Object -Sum).Sum
    $errors = ($rows | ForEach-Object { [int]($_.paper_errors) } | Measure-Object -Sum).Sum
    $directions = @{
        LONG = @($rows | Where-Object { $_.forecast_direction -eq 'LONG' }).Count
        SHORT = @($rows | Where-Object { $_.forecast_direction -eq 'SHORT' }).Count
        NO_TRADE = @($rows | Where-Object { $_.forecast_direction -eq 'NO_TRADE' -or -not $_.forecast_direction }).Count
    }

    Write-Host "Client-derived aggregate (source rows remain separated):"
    Write-Host ("  Backtest: Net PnL={0} Trades={1} Weighted WinRate={2}%" -f `
        [math]::Round($btNet, 2), $btTrades, [math]::Round($btWin, 2))
    Write-Host ("  Forecast: LONG={0} SHORT={1} NO_TRADE={2} DataErrors={3}" -f `
        $directions.LONG, $directions.SHORT, $directions.NO_TRADE, $errors)
    Write-Host ("  Paper: Balance={0} -> Equity={1} NetPnL={2} NO_ENTRY={3}" -f `
        [math]::Round($paperStarting, 2), [math]::Round($paperEquity, 2), [math]::Round($paperPnl, 2), $paperNoEntry)
    Write-Host ("  Forecast NO_TRADE events={0}" -f $forecastNoTrade)
}

try {
    switch ($Action) {
        'status' {
            Write-PilotSummary (Invoke-PilotJson -Uri "$pilotBase/status")
        }
        'report' {
            Write-PilotReport (Invoke-PilotJson -Uri "$pilotBase/status")
        }
        'preflight' {
            $endpoint = if ($Preset -eq 'default') { 'preflight' } else { "$($Preset.Replace('_', '-'))/preflight" }
            $result = Invoke-PilotJson -Uri "$pilotBase/$endpoint" -Method Post
            Write-PilotSummary $result
            Write-WarningSentinel $result
            if (@($result.summary).Count -ne 3) { throw 'Expected three independent pilot summaries.' }
            $incomplete = @($result.sessions.PSObject.Properties | Where-Object {
                    $null -eq $_.Value.backtest -or $null -eq $_.Value.forecast
                })
            if ($incomplete.Count -gt 0) {
                throw "Preflight incomplete for: $($incomplete.Name -join ', ')"
            }
        }
        'start' {
            $endpoint = if ($Preset -eq 'default') { 'start' } else { "$($Preset.Replace('_', '-'))/start" }
            $pilotStatus = Invoke-PilotJson -Uri "$pilotBase/status"
            if (-not $pilotStatus.preflight_id) {
                throw 'No current successful preflight is available. Run -Action preflight with this preset, then start again.'
            }
            $preflightId = [Uri]::EscapeDataString([string]$pilotStatus.preflight_id)
            $result = Invoke-PilotJson -Uri "$pilotBase/$endpoint`?preflight_id=$preflightId" -Method Post
            Write-PilotSummary $result
            Write-WarningSentinel $result
            if (@($result.sessions.PSObject.Properties).Count -ne 3) { throw 'Expected three independent pilot sessions.' }
            $notRunning = @($result.sessions.PSObject.Properties | Where-Object {
                    $null -eq $_.Value.paper -or $_.Value.paper.is_running -ne $true
                })
            if ($notRunning.Count -gt 0) {
                throw "Paper runner did not start for: $($notRunning.Name -join ', ')"
            }
            $until = (Get-Date).AddMinutes($MonitorMinutes)
            while ($MonitorMinutes -gt 0 -and (Get-Date) -lt $until) {
                Start-Sleep -Seconds 60
                $status = Invoke-PilotJson -Uri "$pilotBase/status"
                Write-PilotSummary $status
                Write-WarningSentinel $status
            }
        }
        'stop' {
            Write-PilotSummary (Invoke-PilotJson -Uri "$pilotBase/stop" -Method Post)
        }
    }
} catch {
    Write-Error "Night Pilot $Action failed: $($_.Exception.Message)"
    exit 1
}
