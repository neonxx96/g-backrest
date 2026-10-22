export function deriveBacktestStrategyLevels(backtestResult) {
  const signals = Array.isArray(backtestResult?.signals) ? backtestResult.signals : [];
  const seen = new Set();
  const levels = [];

  for (const signal of [...signals].reverse()) {
    const price = Number(signal?.price);
    if (!Number.isFinite(price) || price <= 0 || seen.has(price)) continue;
    seen.add(price);
    const isBuy = signal.type === 'BUY';
    const reason = signal.reason || (isBuy ? 'Signal' : 'Exit signal');
    levels.push({
      price,
      type: signal.type,
      label: isBuy ? `BUY ZONE: Wall ${reason}` : `SHORT: ${reason}`,
      reason: signal.reason,
    });
    if (levels.length >= 3) break;
  }

  return levels;
}
