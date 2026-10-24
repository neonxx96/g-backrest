// Чистая логика Footprint-грида (кластеры по свечам из /api/recorder/clusters).
// Truth-first: ничего не синтезируем — пустые ячейки = null.

export const IMBALANCE_RATIO = 3;

/** Компактный формат объёма: 1.5K / 2.3M / 47.1 / 0.03 */
export function fmtVol(v) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

/** HH:MM (UTC) из epoch-ms. */
export function fmtTime(ts) {
  if (ts == null || !isFinite(ts)) return '—';
  return new Date(ts).toISOString().slice(11, 16);
}

/** Сторона перекоса уровня: ratio >= 3 и объём значим (внешний min_significant). */
export function detectImbalance(buy, sell, minSignificant) {
  const b = buy || 0;
  const s = sell || 0;
  const max = Math.max(b, s);
  if (max < (minSignificant || 0)) return null;
  if (s === 0 && b > 0) return 'buy';
  if (b === 0 && s > 0) return 'sell';
  if (b / s >= IMBALANCE_RATIO) return 'buy';
  if (s / b >= IMBALANCE_RATIO) return 'sell';
  return null;
}

/**
 * Сборка грида: строки = объединение ценовых уровней (по убыванию),
 * столбцы = свечи (старые -> новые). Каждая ячейка: {buy, sell, delta, vol, imbalance} | null.
 */
export function buildFootprintGrid(candles, maxBars = 14) {
  const bars = Array.isArray(candles) ? candles.slice(-maxBars) : [];
  if (bars.length === 0) {
    return { bars: [], rows: [], cvd: 0, totalVolume: 0 };
  }

  const priceSet = new Set();
  bars.forEach((c) => (c?.levels || []).forEach((l) => priceSet.add(Number(l.price))));
  const prices = [...priceSet].sort((a, b) => b - a);

  const rows = prices.map((price) => ({
    price,
    isPoc: bars.some((c) => c && Number(c.poc_price) === price),
    cells: bars.map((c) => {
      if (!c) return null;
      const lvl = (c.levels || []).find((l) => Number(l.price) === price);
      if (!lvl) return null;
      const buy = Number(lvl.buy_vol) || 0;
      const sell = Number(lvl.sell_vol) || 0;
      return {
        buy,
        sell,
        delta: Number(lvl.delta) || buy - sell,
        vol: buy + sell,
        imbalance: lvl.imbalance ?? null
      };
    })
  }));

  const cvd = bars.reduce((acc, c) => acc + (Number(c?.total_delta) || 0), 0);
  const totalVolume = bars.reduce((acc, c) => acc + (Number(c?.total_volume) || 0), 0);
  return { bars, rows, cvd, totalVolume };
}

/** Цветовая доминанта ячейки: 'buy' | 'sell' | null (по знаку дельты уровня). */
export function cellSide(cell) {
  if (!cell) return null;
  if (cell.delta > 0) return 'buy';
  if (cell.delta < 0) return 'sell';
  return null;
}

/** Интенсивность фона ячейки 0..1 — доля объёма уровня от максимума в свече. */
export function cellIntensity(cell, candleMaxVol) {
  if (!cell || !candleMaxVol) return 0;
  return Math.min(1, cell.vol / candleMaxVol);
}
