/**
 * KLineCharts v9 Signal & Backtest Annotation Engine
 * Renders backtest trades and real-time algorithmic signals directly onto the
 * KLineCharts canvas using native overlays/shapes (Zero React DOM bloat).
 */

/**
 * Creates an overlay on the chart using v9 API with fallback to v8 shape API.
 */
function safeCreateOverlay(chart, overlayConfig) {
  if (!chart) return null;
  if (typeof chart.createOverlay === 'function') {
    return chart.createOverlay(overlayConfig);
  }
  if (typeof chart.createShape === 'function') {
    return chart.createShape(overlayConfig);
  }
  return null;
}

/**
 * Removes an overlay from the chart.
 */
function safeRemoveOverlay(chart, overlayId) {
  if (!chart || !overlayId) return;
  if (typeof chart.removeOverlay === 'function') {
    chart.removeOverlay(overlayId);
  } else if (typeof chart.removeShape === 'function') {
    chart.removeShape(overlayId);
  }
}

/**
 * Renders backtest trades on the chart.
 * 
 * Each trade object:
 * - entry_time: timestamp (ms)
 * - entry_price: number
 * - exit_time: timestamp (ms)
 * - exit_price: number
 * - side: 'Long' | 'Short' | 'BUY' | 'SELL'
 * - pnl_percent: number (e.g. 1.5 for +1.5%)
 * 
 * Visuals:
 * - Entry: Up-Arrow (green) for Long / Down-Arrow (red) for Short
 * - Exit: Dashed connecting line + small PnL text badge (+1.5% / -0.5%)
 */
export function renderBacktestTrades(chart, trades = [], options = {}) {
  if (!chart || !Array.isArray(trades) || trades.length === 0) {
    return [];
  }

  const createdIds = [];
  const { onTradeClick, onTradeHover } = options;

  trades.forEach((trade) => {
    const entryTs = Number(trade.entry_time);
    const exitTs = Number(trade.exit_time || trade.entry_time);
    const entryPrice = Number(trade.entry_price);
    const exitPrice = Number(trade.exit_price ?? trade.entry_price);
    const side = String(trade.side || trade.direction || trade.type || 'BUY').toUpperCase();
    const isLong = side === 'LONG' || side === 'BUY';
    const pnlPct = Number(trade.pnl_percent ?? trade.pnl_pct ?? 0);
    const pnlUsd = Number(trade.pnl_usd ?? 0);
    const isWin = pnlPct >= 0;

    // Use registered 'backtestTradeLine' overlay if available
    try {
      const id = safeCreateOverlay(chart, {
        name: 'backtestTradeLine',
        lock: true,
        points: [
          { timestamp: entryTs, value: entryPrice },
          { timestamp: exitTs, value: exitPrice }
        ],
        extendData: {
          ...trade,
          direction: isLong ? 'LONG' : 'SHORT',
          type: isLong ? 'BUY' : 'SELL',
          entry_price: entryPrice,
          exit_price: exitPrice,
          pnl_pct: pnlPct,
          pnl_usd: pnlUsd,
          reason: trade.reason || (isWin ? 'TP' : 'SL')
        },
        onClick: (e) => {
          if (typeof onTradeClick === 'function') {
            onTradeClick(trade, e);
          }
          return true;
        },
        onMouseEnter: (e) => {
          if (typeof onTradeHover === 'function') {
            onTradeHover(trade, e);
          }
          return true;
        }
      });

      if (id) {
        createdIds.push(id);
      }
    } catch (err) {
      // Fallback: standard segment overlay if custom is not registered
      try {
        const segId = safeCreateOverlay(chart, {
          name: 'segment',
          lock: true,
          points: [
            { timestamp: entryTs, value: entryPrice },
            { timestamp: exitTs, value: exitPrice }
          ],
          styles: {
            line: {
              style: 'dashed',
              dashedValue: [4, 3],
              color: isWin ? '#10b981' : '#ef4444',
              size: 1.5
            }
          }
        });
        if (segId) createdIds.push(segId);
      } catch (_) {}
    }
  });

  return createdIds;
}

/**
 * Clears previously rendered backtest trade overlays.
 */
export function clearBacktestTrades(chart, overlayIds = []) {
  if (!chart || !Array.isArray(overlayIds)) return;
  overlayIds.forEach((id) => {
    safeRemoveOverlay(chart, id);
  });
}

/**
 * Renders real-time algorithmic signals (live signals) at the live edge of the chart.
 * 
 * Signal object:
 * - time / timestamp: number
 * - type / side: 'BUY' | 'SELL' | 'LONG' | 'SHORT'
 * - price: number
 * - label / reason: string
 */
export function renderLiveSignals(chart, signals = [], symbol = '', options = {}) {
  if (!chart || !Array.isArray(signals) || signals.length === 0) {
    return [];
  }

  const createdIds = [];
  const targetSymbol = symbol ? symbol.toUpperCase() : null;

  signals.forEach((sig) => {
    if (targetSymbol && sig.symbol && sig.symbol.toUpperCase() !== targetSymbol) {
      return;
    }

    const ts = Number(sig.time || sig.timestamp || Date.now());
    const price = Number(sig.price || 0);
    const side = String(sig.type || sig.side || sig.direction || 'BUY').toUpperCase();
    const isBuy = side.includes('BUY') || side.includes('LONG') || side.includes('BULL');

    try {
      const id = safeCreateOverlay(chart, {
        name: 'btSignal',
        lock: true,
        points: [{ timestamp: ts, value: price }],
        extendData: {
          type: isBuy ? 'BUY' : 'SELL',
          price,
          reason: sig.reason || sig.description || (isBuy ? 'LONG' : 'SHORT')
        }
      });
      if (id) createdIds.push(id);
    } catch (_) {}
  });

  return createdIds;
}

/**
 * Clears real-time live signal overlays.
 */
export function clearLiveSignals(chart, overlayIds = []) {
  if (!chart || !Array.isArray(overlayIds)) return;
  overlayIds.forEach((id) => {
    safeRemoveOverlay(chart, id);
  });
}
