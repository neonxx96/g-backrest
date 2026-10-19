const stableText = (value) => Array.isArray(value) ? value.join('|') : String(value ?? '');

export function deterministicSignalId(signal = {}) {
  const text = [signal.symbol, signal.timestamp, signal.direction, stableText(signal.reason)].join('|');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `sig_${(hash >>> 0).toString(36)}`;
}

export function buildResearchVerdict({ netPnlUsd = 0, feeDragPct = 0, profitBleedPct = 0, regime = 'NO_DATA', hasL2History = false } = {}) {
  const l2Label = hasL2History ? 'L2 History: available' : 'L2 History: No data (OHLCV only)';
  if (String(regime).toUpperCase() === 'TOXIC_VOLATILITY' || Number(netPnlUsd) < 0) {
    return { level: 'BLOCK', label: 'НЕ ТОРГОВАТЬ / БЛОКИРОВКА', l2Label };
  }
  if (!hasL2History || Number(feeDragPct) >= 25 || Number(profitBleedPct) >= 20 || regime === 'NO_DATA') {
    return { level: 'WARN', label: 'ТРЕБУЕТ НАСТРОЙКИ ПАРАМЕТРОВ', l2Label };
  }
  return { level: 'READY', label: 'ГОТОВО К LIVE PAPER', l2Label };
}
