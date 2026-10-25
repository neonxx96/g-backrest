// Математика On-Chart DOM (чистые функции, без DOM/React — тестируются node --test).
import { binLevels } from '../../stores/liquidityWallStore.js';

const NICE = [1, 2, 5];

/** Оценка тика по реальным уровням книги: минимальный положительный шаг между соседними ценами. */
export function estimateTick(levels) {
  if (!Array.isArray(levels) || levels.length < 2) return null;
  const prices = levels.map((l) => Number(l?.[0])).filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  let min = Infinity;
  for (let i = 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 1e-12 && d < min) min = d;
  }
  return Number.isFinite(min) ? Number(min.toPrecision(8)) : null;
}

/** Шаг агрегации (кратный тику, 1/2/5·10^k), при котором строка не ниже minRowPx пикселей. */
export function niceBinSize(pxPerPrice, minRowPx, tick) {
  if (!(pxPerPrice > 0) || !(tick > 0)) return tick || 0;
  const needed = minRowPx / pxPerPrice;          // цена, соответствующая minRowPx
  if (needed <= tick) return tick;
  const ratio = needed / tick;
  const exp = Math.floor(Math.log10(ratio));
  for (const e of [exp, exp + 1]) {
    for (const m of NICE) {
      const mult = m * 10 ** e;
      if (mult >= ratio - 1e-9) return Number((mult * tick).toPrecision(10));
    }
  }
  return Number((10 ** (exp + 1) * tick).toPrecision(10));
}

/** Длина полосы в пикселях: линейная или логарифмическая шкала (гасит единичные аномалии). */
export function barLength(usd, maxUsd, lengthPx, logScale) {
  if (!(usd > 0) || !(maxUsd > 0) || !(lengthPx > 0)) return 0;
  const share = logScale
    ? Math.log10(1 + usd) / Math.log10(1 + maxUsd)
    : usd / maxUsd;
  return Math.max(1, Math.min(1, share) * lengthPx);
}

/** Бины DOM: массив {price, side, usd}, отсортирован по цене убыванию. */
export function buildDomBins(bids, asks, binSize) {
  const out = [];
  binLevels(bids, 'bid', binSize).forEach((usd, price) => out.push({ price, side: 'bid', usd }));
  binLevels(asks, 'ask', binSize).forEach((usd, price) => out.push({ price, side: 'ask', usd }));
  out.sort((a, b) => b.price - a.price);
  return out;
}

export function hexToRgba(hex, alpha = 1) {
  if (typeof hex !== 'string' || !hex.startsWith('#')) return hex;
  const h = hex.slice(1);
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function fmtUsdCompact(usd) {
  if (!(usd > 0)) return '';
  if (usd >= 1e9) return `${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `${(usd / 1e6).toFixed(2)}M`;
  if (usd >= 1e3) return `${(usd / 1e3).toFixed(usd >= 1e4 ? 0 : 1)}K`;
  return `${Math.round(usd)}`;
}

export function fmtLife(sec, lowerBound) {
  if (!Number.isFinite(sec)) return '';
  const s = Math.floor(sec);
  const t = s >= 3600 ? `${Math.floor(s / 3600)}ч` : s >= 60 ? `${Math.floor(s / 60)}м${String(s % 60).padStart(2, '0')}` : `${s}с`;
  return lowerBound ? `≥${t}` : t;
}
