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
 * Fetch klines with dual-source fallback
 * @param {Object} params - { symbol, timeframe, limit, timeoutMs }
 * @returns {Promise<{ candles: Array, source: string }>}
 */
export async function fetchKlinesDualSource({
  symbol = 'BTCUSDT',
  timeframe = '15m',
  limit = 250,
  timeoutMs = 3500
} = {}) {
  const cleanSymbol = (symbol || 'BTCUSDT').toUpperCase().trim();
  const binanceTf = mapTimeframeToBinance(timeframe);

  // 1. Try Primary Source (FastAPI Backend via proxy or direct port)
  const backendUrls = [
    `${API_BASE}/klines?symbol=${cleanSymbol}&timeframe=${timeframe}&limit=${limit}`,
    `${DIRECT_BACKEND_BASE}/klines?symbol=${cleanSymbol}&timeframe=${timeframe}&limit=${limit}`
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
  const failoverUrls = [
    `https://fapi.binance.com/fapi/v1/klines?symbol=${cleanSymbol}&interval=${binanceTf}&limit=${limit}`,
    `https://api.binance.com/api/v3/klines?symbol=${cleanSymbol}&interval=${binanceTf}&limit=${limit}`,
    `https://data-api.binance.vision/api/v3/klines?symbol=${cleanSymbol}&interval=${binanceTf}&limit=${limit}`
  ];

  let lastFailoverError = null;

  for (const fUrl of failoverUrls) {
    try {
      const fRes = await fetchWithTimeout(fUrl, { headers: { 'Accept': 'application/json' } }, 4500);
      if (fRes.ok) {
        const rawF = await fRes.json();
        if (Array.isArray(rawF) && rawF.length > 0) {
          const candles = rawF.map(normalizeCandle).filter(Boolean);
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
  mapTimeframeToBinance
};
