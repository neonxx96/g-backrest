/**
 * Единая сводка paper-торговли «по парам»: марафон (Overnight Pilot) + live-раннер.
 * Одна строка = одна пара: источник(и), стратегия, статус, equity, PnL.
 * Truth-first: отсутствующие значения — null, никаких подмен нулями.
 */

const num = (v) => (v == null || !isFinite(Number(v)) ? null : Number(v));

/**
 * @param pilotStatus  ответ /api/overnight-pilot/status
 * @param liveRunner   runner из /api/paper-trading/live/status (или null)
 * @returns массив строк сводки, отсортированный по symbol
 */
export function collectPaperPairs(pilotStatus, liveRunner) {
  const pairs = new Map();

  for (const [sym, s] of Object.entries(pilotStatus?.sessions || {})) {
    if (!sym) continue;
    const p = s?.paper || {};
    const closedList = p.closed_trades || [];
    const wins = closedList.filter((t) => Number(t?.net_pnl ?? 0) > 0).length;
    pairs.set(sym, {
      symbol: sym,
      sources: ['marathon'],
      strategy: p.strategy_type || s?.strategy_type || null,
      timeframe: p.timeframe || s?.config?.timeframe || null,
      leverage: num(p.leverage ?? s?.config?.leverage),
      aiControl: Boolean(s?.config?.ai_control),
      running: Boolean(p.is_running),
      dataStatus: p.data_status || null,
      equity: num(p.current_equity),
      realizedPnl: num(p.realized_pnl),
      unrealizedPnl: num(p.unrealized_pnl),
      roiPct: num(p.roi_pct),
      openCount: (p.open_positions || []).length,
      closedCount: num(p.closed_trades_count) ?? closedList.length,
      winRatePct: closedList.length > 0 ? Math.round((wins / closedList.length) * 1000) / 10 : null,
      backtestNetUsd: num(s?.backtest?.summary?.net_pnl_usd),
      lastOptimizationAt: s?.last_optimization_at ?? null
    });
  }

  if (liveRunner?.symbol) {
    const sym = liveRunner.symbol;
    const existing = pairs.get(sym);
    if (existing) {
      existing.sources.push('live');
      if (!existing.strategy) existing.strategy = liveRunner.strategy_type || null;
      if (!existing.timeframe) existing.timeframe = liveRunner.timeframe || null;
      if (existing.leverage == null) existing.leverage = num(liveRunner.leverage);
      if (liveRunner.ai_control) existing.aiControl = true;
      existing.running = existing.running || Boolean(liveRunner.is_running);
    } else {
      pairs.set(sym, {
        symbol: sym,
        sources: ['live'],
        strategy: liveRunner.strategy_type || null,
        timeframe: liveRunner.timeframe || null,
        leverage: num(liveRunner.leverage),
        aiControl: Boolean(liveRunner.ai_control),
        running: Boolean(liveRunner.is_running),
        dataStatus: null,
        equity: num(liveRunner.current_equity ?? liveRunner.equity),
        realizedPnl: num(liveRunner.realized_pnl),
        unrealizedPnl: num(liveRunner.unrealized_pnl),
        roiPct: num(liveRunner.roi_pct),
        openCount: Array.isArray(liveRunner.positions) ? liveRunner.positions.length : 0,
        closedCount: num(liveRunner.closed_trades_count) ?? (Array.isArray(liveRunner.closed_trades) ? liveRunner.closed_trades.length : 0),
        winRatePct: null,
        backtestNetUsd: null,
        lastOptimizationAt: null
      });
    }
  }

  return [...pairs.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** Совокупный PnL строки (realized + unrealized), null если оба неизвестны. */
export function pairTotalPnl(pair) {
  if (pair?.realizedPnl == null && pair?.unrealizedPnl == null) return null;
  return (pair?.realizedPnl ?? 0) + (pair?.unrealizedPnl ?? 0);
}
