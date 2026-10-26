// Квант-слой плотностей (LiquidityWallStore) — единый источник «стенок» стакана
// для графика (On-Chart DOM, heatmap) и для алгоритмических стратегий.
//
// ЧЕСТНОСТЬ ДАННЫХ:
//  * Только реальные уровни книги, переданные ingest(). Ничего не выдумывается:
//    пустая книга -> пустой список стенок.
//  * Время жизни = время наблюдения С НАШЕЙ СТОРОНЫ. Стенка, уже стоявшая в первом
//    снимке, имеет ageIsLowerBound=true: реальный возраст >= lifetimeSec.
//  * Точность времени появления/исчезновения = интервал опроса (meta.sampleMs).
//  * spoofScore — эвристика (0..1), не факт: «заявку сняли, не дав цене дойти до неё,
//    и она жила недолго / была близко к цене». null = у уровня нет истории снятий.
//
// Структура стенки (контракт для стратегий):
//  { id, price, side:'bid'|'ask', volumeUsd, peakUsd, depthShare, firstSeenTs,
//    lastSeenTs, lifetimeSec, ageIsLowerBound, distanceTicks, spoofScore, isTested }

import { create } from 'zustand';

const DEFAULTS = {
  minUsd: 250_000,        // порог появления стенки
  keepRatio: 0.5,         // гистерезис: стенка живёт, пока usd >= minUsd * keepRatio
  spoofMaxLifeMs: 15_000, // чем короче жизнь снятой стенки — тем подозрительнее
  spoofNearTicks: 40,     // чем ближе к цене в момент снятия — тем подозрительнее
  maxEvents: 60,
};

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const keyOf = (side, price) => `${side}:${price}`;

/** Группировка сырых уровней [[price, qty], ...] в бины шага binSize (bid — floor, ask — ceil). */
export function binLevels(levels, side, binSize) {
  const bins = new Map();
  if (!Array.isArray(levels)) return bins;
  for (const lv of levels) {
    const p = Number(lv?.[0]);
    const q = Number(lv?.[1]);
    if (!Number.isFinite(p) || !Number.isFinite(q) || p <= 0 || q <= 0) continue;
    let bp = p;
    if (binSize > 0) {
      const n = side === 'bid' ? Math.floor(p / binSize + 1e-9) : Math.ceil(p / binSize - 1e-9);
      bp = Number((n * binSize).toPrecision(12));
    }
    bins.set(bp, (bins.get(bp) || 0) + p * q);
  }
  return bins;
}

export function createWallTracker(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const walls = new Map();      // key -> активная стенка
  const pullHistory = new Map(); // key -> максимальный spoofScore прошлых снятий
  let events = [];
  let ingests = 0;
  let lastTs = null;
  let prevTs = null;

  const pushEvent = (e) => {
    events.push(e);
    if (events.length > cfg.maxEvents) events = events.slice(-cfg.maxEvents);
  };

  /**
   * @param {{ts:number, bids:Array<[number,number]>, asks:Array<[number,number]>,
   *          tick?:number, binSize?:number, minUsd?:number}} book
   */
  function ingest(book) {
    const ts = Number.isFinite(Number(book?.ts)) ? Number(book.ts) : Date.now();
    const tick = Number(book?.tick) > 0 ? Number(book.tick) : null;
    const minUsd = Number(book?.minUsd) > 0 ? Number(book.minUsd) : cfg.minUsd;
    const keepUsd = minUsd * cfg.keepRatio;
    const bidBins = binLevels(book?.bids, 'bid', book?.binSize);
    const askBins = binLevels(book?.asks, 'ask', book?.binSize);

    let bestBid = 0;
    let bestAsk = Infinity;
    for (const p of bidBins.keys()) if (p > bestBid) bestBid = p;
    for (const p of askBins.keys()) if (p < bestAsk) bestAsk = p;
    const hasBook = bestBid > 0 && Number.isFinite(bestAsk);
    const mid = hasBook ? (bestBid + bestAsk) / 2 : null;

    let totalUsd = 0;
    bidBins.forEach((u) => { totalUsd += u; });
    askBins.forEach((u) => { totalUsd += u; });

    const first = ingests === 0;
    const seen = new Set();
    const consider = (bins, side) => {
      bins.forEach((usd, price) => {
        const k = keyOf(side, price);
        const w = walls.get(k);
        if (w) {
          if (usd >= keepUsd) {
            w.volumeUsd = usd;
            w.peakUsd = Math.max(w.peakUsd, usd);
            w.lastSeenTs = ts;
            seen.add(k);
          }
        } else if (usd >= minUsd) {
          walls.set(k, {
            id: k, price, side, volumeUsd: usd, peakUsd: usd,
            firstSeenTs: ts, lastSeenTs: ts, fromSnapshot: first, isTested: false,
            lastDistanceTicks: tick && mid ? Math.abs(price - mid) / tick : null,
          });
          seen.add(k);
        }
      });
    };
    consider(bidBins, 'bid');
    consider(askBins, 'ask');

    // Стенки, исчезнувшие из книги: съедены (цена дошла) или сняты (спуф-подозрение).
    if (hasBook) {
      for (const [k, w] of walls) {
        if (seen.has(k)) continue;
        const reached = w.side === 'bid' ? bestBid <= w.price : bestAsk >= w.price;
        const lifeMs = ts - w.firstSeenTs;
        if (reached || w.isTested) {
          pushEvent({ type: 'WALL_CONSUMED', ts, id: k, price: w.price, side: w.side, usd: w.peakUsd, lifeSec: lifeMs / 1000 });
        } else {
          const nearTicks = w.lastDistanceTicks;
          const shortLife = 1 - clamp01(lifeMs / cfg.spoofMaxLifeMs);
          const proximity = nearTicks == null ? 0.5 : clamp01(1 - nearTicks / cfg.spoofNearTicks);
          const score = Number(clamp01(0.6 * shortLife + 0.4 * proximity).toFixed(3));
          pullHistory.set(k, Math.max(pullHistory.get(k) || 0, score));
          pushEvent({
            type: score >= 0.6 ? 'SPOOF_SUSPECT' : 'WALL_PULLED',
            ts, id: k, price: w.price, side: w.side, usd: w.peakUsd, lifeSec: lifeMs / 1000, spoofScore: score,
          });
        }
        walls.delete(k);
      }
      // Обновляем «тронута ли цена» и расстояние для живых стенок.
      for (const w of walls.values()) {
        if (w.side === 'bid' ? bestBid <= w.price : bestAsk >= w.price) w.isTested = true;
        w.lastDistanceTicks = tick && mid ? Math.abs(w.price - mid) / tick : w.lastDistanceTicks;
      }
    }

    prevTs = lastTs;
    lastTs = ts;
    ingests += 1;
    return { mid, bestBid: hasBook ? bestBid : null, bestAsk: hasBook ? bestAsk : null, totalUsd };
  }

  function getWalls() {
    const now = lastTs;
    let total = 0;
    walls.forEach((w) => { total += w.volumeUsd; });
    const list = [];
    for (const w of walls.values()) {
      list.push({
        id: w.id,
        price: w.price,
        side: w.side,
        volumeUsd: w.volumeUsd,
        peakUsd: w.peakUsd,
        depthShare: total > 0 ? w.volumeUsd / total : 0,
        firstSeenTs: w.firstSeenTs,
        lastSeenTs: w.lastSeenTs,
        lifetimeSec: now == null ? 0 : Math.max(0, (now - w.firstSeenTs) / 1000),
        ageIsLowerBound: w.fromSnapshot,
        distanceTicks: w.lastDistanceTicks,
        spoofScore: pullHistory.has(w.id) ? pullHistory.get(w.id) : null,
        isTested: w.isTested,
      });
    }
    list.sort((a, b) => b.volumeUsd - a.volumeUsd);
    return list;
  }

  return {
    ingest,
    getWalls,
    getEvents: () => events.slice(),
    getMeta: () => ({ ingests, lastTs, sampleMs: prevTs != null && lastTs != null ? lastTs - prevTs : null }),
    reset() { walls.clear(); pullHistory.clear(); events = []; ingests = 0; lastTs = null; prevTs = null; },
  };
}

// --- Zustand-обёртка: по трекеру на символ -----------------------------------------
const trackers = new Map();
const trackerFor = (symbol) => {
  const s = String(symbol || '').toUpperCase();
  if (!trackers.has(s)) trackers.set(s, createWallTracker());
  return trackers.get(s);
};

export const useLiquidityWallStore = create((set) => ({
  // symbol -> { walls, events, meta, mid, bestBid, bestAsk, source }
  bySymbol: {},

  ingestBook: (symbol, book, source = 'rest') => {
    const s = String(symbol || '').toUpperCase();
    if (!s) return;
    const tr = trackerFor(s);
    const snap = tr.ingest(book);
    set((st) => ({
      bySymbol: {
        ...st.bySymbol,
        [s]: {
          walls: tr.getWalls(),
          events: tr.getEvents(),
          meta: tr.getMeta(),
          mid: snap.mid, bestBid: snap.bestBid, bestAsk: snap.bestAsk,
          source,
        },
      },
    }));
  },

  resetSymbol: (symbol) => {
    const s = String(symbol || '').toUpperCase();
    trackers.get(s)?.reset();
    set((st) => {
      const next = { ...st.bySymbol };
      delete next[s];
      return { bySymbol: next };
    });
  },
}));

/** Точка доступа для алгоритмов: активные стенки символа (пусто, если данных нет). */
export function getWallsForSymbol(symbol) {
  return useLiquidityWallStore.getState().bySymbol[String(symbol || '').toUpperCase()]?.walls || [];
}
