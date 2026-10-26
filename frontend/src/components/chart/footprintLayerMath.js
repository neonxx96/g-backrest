// Чистая математика Footprint Canvas-слоя (без DOM/React, тестируется node --test).
// Источник — реальные кластеры рекордера (5-мин корзины). Ничего не выдумывается:
// из OHLCV кластеры НЕ строятся; нет корзин — нет кластеров.
import { detectImbalance } from '../docking/footprintGrid.js';

export const CLUSTER_BUCKET_MS = 300_000;

/** Можно ли честно собрать бар данного ТФ из 5-минутных корзин. */
export function isTfSupported(tfMs, bucketMs = CLUSTER_BUCKET_MS) {
  return Number.isFinite(tfMs) && tfMs >= bucketMs && tfMs % bucketMs === 0;
}

/** Группировка уровней по шагу цены (rebin). Возвращает массив по убыванию цены. */
export function rebinLevels(levels, binSize) {
  const map = new Map();
  for (const l of levels || []) {
    const p = Number(l?.price);
    if (!Number.isFinite(p)) continue;
    const bp = binSize > 0 ? Number((Math.round(p / binSize) * binSize).toPrecision(12)) : p;
    const slot = map.get(bp) || { price: bp, buy: 0, sell: 0 };
    slot.buy += Number(l.buy_vol ?? l.buy) || 0;
    slot.sell += Number(l.sell_vol ?? l.sell) || 0;
    map.set(bp, slot);
  }
  return [...map.values()]
    .map((s) => ({ ...s, vol: s.buy + s.sell, delta: s.buy - s.sell }))
    .sort((a, b) => b.price - a.price);
}

/**
 * Склейка 5-мин корзин в бары графика (tfMs кратен 5м).
 * Возвращает [{timestamp, levels(raw merged), coverage, expected, partial}] по возрастанию времени.
 * partial=true — корзин меньше, чем нужно (рекордер включился посреди бара); живой (последний)
 * бар partial не считается, пока он ещё не закрылся.
 */
export function mergeClustersToTf(clusters, tfMs, nowTs = Date.now(), bucketMs = CLUSTER_BUCKET_MS) {
  if (!Array.isArray(clusters) || !isTfSupported(tfMs, bucketMs)) return [];
  const expected = tfMs / bucketMs;
  const groups = new Map();
  for (const c of clusters) {
    const ts = Number(c?.timestamp);
    if (!Number.isFinite(ts)) continue;
    const barTs = Math.floor(ts / tfMs) * tfMs;
    const g = groups.get(barTs) || { timestamp: barTs, levels: new Map(), buckets: new Set() };
    g.buckets.add(ts);
    for (const l of c.levels || []) {
      const p = Number(l.price);
      if (!Number.isFinite(p)) continue;
      const s = g.levels.get(p) || { price: p, buy_vol: 0, sell_vol: 0 };
      s.buy_vol += Number(l.buy_vol) || 0;
      s.sell_vol += Number(l.sell_vol) || 0;
      g.levels.set(p, s);
    }
    groups.set(barTs, g);
  }
  return [...groups.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((g) => {
      const isLive = nowTs < g.timestamp + tfMs;
      const coverage = g.buckets.size;
      return {
        timestamp: g.timestamp,
        levels: [...g.levels.values()],
        coverage,
        expected,
        partial: !isLive && coverage < expected,
      };
    });
}

/** Метрики бара после ребиннинга: POC, дельта, объём, имбалансы по уровням. */
export function computeBarMetrics(levels, imbalanceRatio = 3, minSignificantShare = 0.1) {
  if (!levels.length) return { poc: null, delta: 0, total: 0, buyTotal: 0, sellTotal: 0, maxVol: 0, levels: [] };
  let maxVol = 0;
  let poc = levels[0];
  let buyTotal = 0;
  let sellTotal = 0;
  for (const l of levels) {
    if (l.vol > maxVol) { maxVol = l.vol; poc = l; }
    buyTotal += l.buy;
    sellTotal += l.sell;
  }
  const minSig = maxVol * minSignificantShare;
  const out = levels.map((l) => ({
    ...l,
    imbalance: detectImbalance(l.buy, l.sell, minSig, imbalanceRatio),
    isPoc: l.price === poc.price,
  }));
  return {
    poc: poc.price, delta: buyTotal - sellTotal, total: buyTotal + sellTotal,
    buyTotal, sellTotal, maxVol, levels: out,
  };
}

/**
 * Naked POC: POC бара, который цена в последующих барах так и не коснулась.
 * candles — реальные свечи графика [{timestamp, high, low}]. Ничего не продлевается за пределы данных.
 */
export function computeNakedPocs(pocBars, candles, tfMs) {
  const sorted = [...(candles || [])].sort((a, b) => a.timestamp - b.timestamp);
  const res = [];
  for (const b of pocBars) {
    if (b.poc == null) continue;
    let touchedTs = null;
    for (const c of sorted) {
      if (c.timestamp < b.timestamp + tfMs) continue; // только последующие бары
      if (c.low <= b.poc && b.poc <= c.high) { touchedTs = c.timestamp; break; }
    }
    res.push({ price: b.poc, fromTs: b.timestamp, touchedTs, isNaked: touchedTs == null });
  }
  return res;
}

/**
 * Level of Detail по размеру ячейки в пикселях.
 * 'heat' — только цветная заливка; 'text' — числа; 'none' — слишком мелко, рисуем только профиль.
 */
export function lodFor(colW, rowH) {
  if (colW < 5 || rowH < 2) return { cells: 'none', text: false, plate: false, outline: false };
  const text = rowH >= 10 && colW >= 52;
  return {
    cells: 'heat',
    text,
    plate: colW >= 44,
    outline: colW >= 14 && rowH >= 4,
  };
}

/** Скользящая статистика времени кадра. */
export function createFrameStats(size = 30) {
  const buf = [];
  return {
    push(ms) { buf.push(ms); if (buf.length > size) buf.shift(); },
    last() { return buf.length ? buf[buf.length - 1] : 0; },
    avg() { return buf.length ? buf.reduce((a, b) => a + b, 0) / buf.length : 0; },
    max() { return buf.length ? Math.max(...buf) : 0; },
  };
}
