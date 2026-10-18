/**
 * Dual-Source Market Data Pipeline with Failover
 * 
 * Primary Source: SignalScript FastAPI Backend (/api/klines)
 * Fallback Source (Failover): Binance Public Futures/Spot API (fapi.binance.com)
 * 
 * Normalizes all output into standard Kline format:
 * { timestamp, open, high, low, close, volume, turnover }
 */

const API_BASE = '/api';
const DIRECT_BACKEND_BASE = 'http://127.0.0.1:8000/api';

/**
 * Timeframe -> milliseconds (deep-history window math).
 */
export const TF_MS = {
  '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000, '30m': 1800000,
  '45m': 2700000, '1h': 3600000, '2h': 7200000, '4h': 14400000,
  '6h': 21600000, '12h': 43200000, '1d': 86400000, '1w': 604800000
};

/**
 * Binance public REST maximum bars per single request
 * (Futures allows 1500, Spot/Vision 1000 — 1000 is the safe common cap).
 */
const BINANCE_MAX_CHUNK = 1000;

/**
 * Safety cap for client-side paginated failover range fetch (base bars).
 */
const FAILOVER_RANGE_CAP = 50000;

/**
 * Maps terminal timeframe string to Binance valid interval
 */
export function mapTimeframeToBinance(tf) {
  const map = {
    '1m': '1m',
    '3m': '3m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '45m': '15m',
    '1h': '1h',
    '2h': '2h',
    '4h': '4h',
    '6h': '1h',
    '12h': '12h',
    '1d': '1d',
    '1w': '1w'
  };
  return map[tf] || '15m';
}

/**
 * Normalizes candle item (object or array) into KlineCharts v9 format
 */
export function normalizeCandle(k) {
  if (!k) return null;

  let timestamp, open, high, low, close, volume, turnover;

  if (Array.isArray(k)) {
    // Binance format: [openTime, open, high, low, close, volume, closeTime, quoteAssetVolume, ...]
    timestamp = Number(k[0]);
    open = Number(k[1]);
    high = Number(k[2]);
    low = Number(k[3]);
    close = Number(k[4]);
    volume = Number(k[5]);
    turnover = Number(k[7] || (close * volume));
  } else if (typeof k === 'object') {
    timestamp = Number(k.timestamp || k.openTime || k.time || 0);
    open = Number(k.open);
    high = Number(k.high);
    low = Number(k.low);
    close = Number(k.close);
    volume = Number(k.volume || 0);
    turnover = Number(k.turnover || (close * volume));
  } else {
    return null;
  }

  if (
    !Number.isFinite(timestamp) || timestamp <= 0 ||
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close)
  ) {
    return null;
  }

  return { timestamp, open, high, low, close, volume, turnover };
}

/**
 * Helper to fetch with timeout via AbortController
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 3500) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

/**
 * Resamples base-timeframe candles into a custom timeframe (45m, 6h).
 * Deterministic pure grouping: buckets align to epoch multiples of targetTfMs
 * (identical to the backend pandas resample closed='left', label='left').
 */
export function resampleCandles(candles, targetTfMs) {
  if (!Array.isArray(candles) || candles.length === 0 || !targetTfMs) return [];
  const groups = new Map();
  for (const c of candles) {
    if (!c || c.timestamp == null) continue;
    const bucket = Math.floor(c.timestamp / targetTfMs) * targetTfMs;
    let g = groups.get(bucket);
    if (!g) { g = []; groups.set(bucket, g); }
    g.push(c);
  }
  const out = [];
  const buckets = Array.from(groups.keys()).sort((a, b) => a - b);
  for (const bucket of buckets) {
    const g = groups.get(bucket);
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    let turnover = 0;
    for (const c of g) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      volume += Number(c.volume) || 0;
      turnover += Number(c.turnover) || 0;
    }
    const first = g[0];
    const last = g[g.length - 1];
    out.push({
      timestamp: bucket,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
      turnover
    });
  }
  return out;
}

/**
 * Fetch a [startTime, endTime] range of raw Binance klines with chunked
 * forward pagination via startTime (each request <= BINANCE_MAX_CHUNK bars).
 * Deterministic: no synthetic rows — only real Binance REST data.
 */
async function fetchBinanceRangeRaw({ symbol, interval, startTime, endTime }) {
  const urls = [
    'https://fapi.binance.com/fapi/v1/klines',
    'https://api.binance.com/api/v3/klines',
    'https://data-api.binance.vision/api/v3/klines'
  ];
  const startTs = Number(startTime);
  const endTs = endTime != null ? Number(endTime) : null;
  for (const u of urls) {
    const rows = [];
    let cursor = startTs;
    let ok = true;
    while (true) {
      let qs = `symbol=${symbol}&interval=${interval}&startTime=${cursor}&limit=${BINANCE_MAX_CHUNK}`;
      if (endTs != null) qs += `&endTime=${endTs}`;
      let data;
      try {
        const res = await fetchWithTimeout(`${u}?${qs}`, { headers: { Accept: 'application/json' } }, 8000);
        if (!res.ok) { ok = false; break; }
        data = await res.json();
        if (!Array.isArray(data)) { ok = false; break; }
      } catch (_) { ok = false; break; }
      if (!data.length) break;
      rows.push(...data);
      cursor = Number(data[data.length - 1][0]) + 1;
      if (data.length < BINANCE_MAX_CHUNK) break;
      if (endTs != null && cursor > endTs) break;
      if (rows.length >= FAILOVER_RANGE_CAP) break;
    }
    if (ok && rows.length) return rows;
  }
  return [];
}

/**
 * Fetch klines with dual-source fallback
 * @param {Object} params - { symbol, timeframe, limit, startTime, endTime, timeoutMs }
 *   - startTime/endTime (UTC ms) request a DEEP HISTORY WINDOW [startTime, endTime]:
 *     the backend paginates server-side (up to 1500 bars per Binance request),
 *     the Binance failover paginates client-side. `limit` is ignored in deep mode.
 * @returns {Promise<{ candles: Array, source: string }>}
 */
export async function fetchKlinesDualSource({
  symbol = 'BTCUSDT',
  timeframe = '15m',
  limit = 250,
  startTime = null,
  endTime = null,
  timeoutMs = 3500
} = {}) {
  const cleanSymbol = (symbol || 'BTCUSDT').toUpperCase().trim();
  const binanceTf = mapTimeframeToBinance(timeframe);
  const tfMs = TF_MS[timeframe] || 900000;
  const isCustomTf = timeframe === '45m' || timeframe === '6h';
  const customMult = timeframe === '6h' ? 6 : (timeframe === '45m' ? 3 : 1);

  // ---------- Deep history window mode ([startTime, endTime]) ----------
  if (startTime != null) {
    const startTs = Number(startTime);
    const endTs = endTime != null ? Number(endTime) : Date.now();

    // 1. Primary: FastAPI backend (server-side pagination + 45m/6h resampling)
    let deepQs = `symbol=${cleanSymbol}&timeframe=${timeframe}&limit=1500&start_time=${startTs}`;
    if (endTime != null) deepQs += `&end_time=${endTs}`;
    const deepUrls = [
      `${API_BASE}/klines?${deepQs}`,
      `${DIRECT_BACKEND_BASE}/klines?${deepQs}`
    ];

    for (const url of deepUrls) {
      try {
        const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 45000);
        if (res.ok) {
          const raw = await res.json();
          if (Array.isArray(raw) && raw.length > 0) {
            const candles = raw
              .map(normalizeCandle)
              .filter(Boolean)
              .filter(c => c.timestamp >= startTs && c.timestamp <= endTs);
            if (candles.length > 0) {
              candles.sort((a, b) => a.timestamp - b.timestamp);
              return { candles, source: 'backend' };
            }
          }
        }
      } catch (_) {
        // fall through to the next backend url / Binance failover
      }
    }

    // 2. Failover: Binance public REST, chunked client-side pagination.
    //    Non-native intervals (45m, 6h) are resampled from the base timeframe.
    const baseRows = await fetchBinanceRangeRaw({
      symbol: cleanSymbol,
      interval: binanceTf,
      startTime: startTs - tfMs, // one base bar back so the first resampled group is complete
      endTime: endTs
    });
    let candles = baseRows.map(normalizeCandle).filter(Boolean);
    if (candles.length > 0) {
      if (isCustomTf) candles = resampleCandles(candles, tfMs);
      candles = candles.filter(c => c.timestamp >= startTs && c.timestamp <= endTs);
      if (candles.length > 0) {
        candles.sort((a, b) => a.timestamp - b.timestamp);
        return { candles, source: 'binance-failover' };
      }
    }
    throw new Error(
      `Не удалось загрузить историю ${cleanSymbol} ${timeframe}: бэкенд и резервный Binance недоступны`
    );
  }

  // ---------- Latest-batch mode (no startTime): previous behavior ----------
  let backendQs = `symbol=${cleanSymbol}&timeframe=${timeframe}&limit=${limit}`;
  if (endTime != null) backendQs += `&end_time=${Number(endTime)}`;
  const backendUrls = [
    `${API_BASE}/klines?${backendQs}`,
    `${DIRECT_BACKEND_BASE}/klines?${backendQs}`
  ];

  for (const url of backendUrls) {
    try {
      const res = await fetchWithTimeout(url, { headers: { 'Accept': 'application/json' } }, timeoutMs);
      if (res.ok) {
        const raw = await res.json();
        if (Array.isArray(raw) && raw.length > 0) {
          const candles = raw.map(normalizeCandle).filter(Boolean);
          if (candles.length > 0) {
            candles.sort((a, b) => a.timestamp - b.timestamp);
            return { candles, source: 'backend' };
          }
        }
      }
    } catch (_) {
      // Backend not responding or timed out, continue to next backend url or failover
    }
  }

  // 2. Fallback / Failover Source: Binance Public API (Futures -> Spot -> Vision)
  //    45m/6h fetch their base timeframe (x3 / x6 bars) and resample client-side.
  const failoverLimit = limit * customMult;
  const failoverUrls = [
    `https://fapi.binance.com/fapi/v1/klines?symbol=${cleanSymbol}&interval=${binanceTf}&limit=${failoverLimit}`,
    `https://api.binance.com/api/v3/klines?symbol=${cleanSymbol}&interval=${binanceTf}&limit=${failoverLimit}`,
    `https://data-api.binance.vision/api/v3/klines?symbol=${cleanSymbol}&interval=${binanceTf}&limit=${failoverLimit}`
  ];

  let lastFailoverError = null;

  for (const fUrl of failoverUrls) {
    try {
      const fRes = await fetchWithTimeout(fUrl, { headers: { 'Accept': 'application/json' } }, 4500);
      if (fRes.ok) {
        const rawF = await fRes.json();
        if (Array.isArray(rawF) && rawF.length > 0) {
          let candles = rawF.map(normalizeCandle).filter(Boolean);
          if (isCustomTf) {
            candles = resampleCandles(candles, tfMs).slice(-limit);
          }
          if (candles.length > 0) {
            candles.sort((a, b) => a.timestamp - b.timestamp);
            return { candles, source: 'binance-failover' };
          }
        }
      }
    } catch (fErr) {
      lastFailoverError = fErr;
    }
  }

  throw new Error(
    `Не удалось загрузить свечи для ${cleanSymbol}: первичный бэкенд и резервный шлюз Binance недоступны (${lastFailoverError ? lastFailoverError.message : 'timeout'})`
  );
}

export default {
  fetchKlinesDualSource,
  normalizeCandle,
  mapTimeframeToBinance,
  resampleCandles,
  TF_MS
};
