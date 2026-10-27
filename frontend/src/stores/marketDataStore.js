/**
 * Market Data Store (Zustand)
 *
 * SOURCE OF WATCHLIST DATA (Requirement 4):
 * Stream Used: Binance Futures WebSocket `wss://fstream.binance.com/ws/!miniTicker@arr`
 * This is the official aggregate multi-symbol 24hr miniTicker stream for all USDT-M Futures.
 * Instead of establishing hundreds of individual socket connections per pair, this SINGLE
 * aggregate connection delivers 24hr price, percentage change, and volume updates for ALL
 * ~350+ trading pairs concurrently every 1000ms.
 */

import { create } from 'zustand';
import { DEFAULT_FOCUS_LIST } from '../config/coinLibrary.js';
import { deterministicSignalId } from '../utils/researchVerdict.js';

const WS_MINI_TICKER_URL = 'wss://fstream.binance.com/ws/!miniTicker@arr';
// REST-фолбэк: некоторые сети/клиенты открывают WS к Binance, но не пропускают
// кадры потока (зависает «Подключение к WebSocket...» при живом сокете).
// Binance REST отдаёт CORS * — честный запасной канал тех же реальных данных.
const REST_24HR_URL = 'https://fapi.binance.com/fapi/v1/ticker/24hr';

// Empty until real exchange data arrives; never seed tradable-looking prices.
const INITIAL_TICKERS = {};

const getInitialMonitored = () => {
  try {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('ss_monitored_tickers') : null;
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (_) {}
  return [...DEFAULT_FOCUS_LIST];
};

export const useMarketDataStore = create((set, get) => {
  let ws = null;
  let reconnectTimer = null;
  let batchBuffer = new Map();
  let flushTimer = null;
  let watchdog = null;
  let lastMessageAt = 0;
  let reconnectAttempts = 0;
  let stopped = false;
  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    const delay = Math.min(30000, 2500 * 2 ** Math.min(reconnectAttempts++, 4));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      get().initMiniTickerStream();
    }, delay);
  };

  let monitoringWs = null;
  let monitoringReconnectTimer = null;
  let restFallbackInFlight = false;

  const pollRestFallback = async () => {
    if (restFallbackInFlight || stopped) return;
    if (typeof window === 'undefined' || typeof fetch !== 'function') return;
    if (Date.now() - lastMessageAt < 10000) return; // WS жив — фолбэк не нужен
    restFallbackInFlight = true;
    try {
      const resp = await fetch(REST_24HR_URL, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const arr = await resp.json();
      if (!Array.isArray(arr)) throw new Error('bad payload');

      const now = Date.now();
      const next = { ...get().tickers };
      for (const item of arr) {
        const sym = item.symbol;
        if (!sym || !sym.endsWith('USDT') || sym.includes('_')) continue;
        const c = parseFloat(item.lastPrice) || 0;
        const o = parseFloat(item.openPrice) || 0;
        const q = parseFloat(item.quoteVolume) || 0;
        const h = parseFloat(item.highPrice) || 0;
        const l = parseFloat(item.lowPrice) || 0;
        if (![c, o, q, h, l].every(Number.isFinite) || c <= 0 || o <= 0) continue;
        const changePct = parseFloat(item.priceChangePercent);
        next[sym] = {
          symbol: sym,
          price: c,
          open24h: o,
          high24h: h,
          low24h: l,
          change24hPct: Number.isFinite(changePct) ? changePct : Number((((c - o) / o) * 100).toFixed(2)),
          volumeUsd: q,
          ts: now
        };
      }
      set({
        tickers: next,
        tickersList: Object.values(next),
        isConnected: true,
        dataSource: 'rest',
        lastUpdateTs: now
      });
    } catch (_) {
      // Честный статус: ни WS, ни REST недоступны
      if (Date.now() - lastMessageAt > 30000) set({ isConnected: false });
    } finally {
      restFallbackInFlight = false;
    }
  };

  return {
    // Map of symbol -> { symbol, price, open24h, high24h, low24h, change24hPct, volumeUsd, ts }
    tickers: { ...INITIAL_TICKERS },
    tickersList: Object.values(INITIAL_TICKERS),
    isConnected: false,
    // 'ws' | 'rest' — какой канал сейчас питает скринер
    dataSource: 'ws',
    lastUpdateTs: null,

    // Monitored Focus Tickers & Background Telemetry
    monitoredTickers: getInitialMonitored(),
    monitoringStatuses: {}, // ticker -> { state, step, pnl_pct, signal, timestamp }

    isTickerMonitored: (symbol) => {
      if (!symbol) return false;
      return get().monitoredTickers.includes(symbol.toUpperCase().trim());
    },

    toggleMonitorTicker: async (symbol) => {
      const sym = symbol.toUpperCase().trim();
      const current = get().monitoredTickers;
      const isMonitored = current.includes(sym);
      const next = isMonitored ? current.filter((s) => s !== sym) : [...current, sym];

      set({ monitoredTickers: next });
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem('ss_monitored_tickers', JSON.stringify(next));
        }
      } catch (_) {}

      // Inform backend background worker
      try {
        await fetch('/api/screener/monitoring/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker: sym, monitored: !isMonitored })
        });
      } catch (err) {
        console.debug('Failed to sync monitor toggle to backend:', err);
      }
    },

    setMonitoredTickers: async (tickers) => {
      const clean = Array.isArray(tickers) ? tickers.map((s) => s.toUpperCase().trim()) : [];
      set({ monitoredTickers: clean });
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem('ss_monitored_tickers', JSON.stringify(clean));
        }
      } catch (_) {}

      try {
        await fetch('/api/screener/monitoring', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tickers: clean })
        });
      } catch (err) {
        console.debug('Failed to sync monitored tickers to backend:', err);
      }
    },

    setMonitoringStatus: (ticker, statusObj) => {
      set((state) => ({
        monitoringStatuses: {
          ...state.monitoringStatuses,
          [ticker.toUpperCase()]: {
            ...state.monitoringStatuses[ticker.toUpperCase()],
            ...statusObj,
            updatedAt: Date.now()
          }
        }
      }));
    },

    connectMonitoringStream: () => {
      if (typeof window === 'undefined') return;
      if (monitoringWs && (monitoringWs.readyState === WebSocket.OPEN || monitoringWs.readyState === WebSocket.CONNECTING)) {
        return;
      }

      // Initial HTTP fetch of current statuses
      fetch('/api/screener/monitoring')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && data.statuses) {
            set({ monitoringStatuses: data.statuses });
          }
          if (data && Array.isArray(data.monitored_tickers) && data.monitored_tickers.length > 0) {
            // Merge with local storage if needed
          }
        })
        .catch(() => {});

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/screener/monitoring/ws`;

      try {
        monitoringWs = new WebSocket(wsUrl);

        monitoringWs.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'init' && data.statuses) {
              set({ monitoringStatuses: data.statuses });
            } else if (data.type === 'status_update' && data.ticker) {
              get().setMonitoringStatus(data.ticker, data);
            }
          } catch (_) {}
        };

        monitoringWs.onclose = () => {
          monitoringWs = null;
          if (!monitoringReconnectTimer) {
            monitoringReconnectTimer = setTimeout(() => {
              monitoringReconnectTimer = null;
              get().connectMonitoringStream();
            }, 3000);
          }
        };

        monitoringWs.onerror = () => {
          try { monitoringWs.close(); } catch (_) {}
        };
      } catch (err) {
        console.debug('Monitoring WS init error:', err);
      }
    },

    // Real-time signals state (Requirement 3)
    liveSignals: [],
    showLiveSignals: true,

    addLiveSignal: (signal) => {
      set((state) => {
        const id = signal.id || deterministicSignalId(signal);
        const newSig = { ...signal, id, receivedAt: Date.now() };
        // Maintain last 50 signals
        const updated = [newSig, ...state.liveSignals.filter((s) => s.id !== id)].slice(0, 50);
        return { liveSignals: updated };
      });
    },

    setLiveSignals: (signals) => set({ liveSignals: Array.isArray(signals) ? signals : [] }),
    clearLiveSignals: () => set({ liveSignals: [] }),
    toggleLiveSignals: () => set((state) => ({ showLiveSignals: !state.showLiveSignals })),
    setShowLiveSignals: (show) => set({ showLiveSignals: Boolean(show) }),

    initMiniTickerStream: () => {
      stopped = false;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
      }

      try {
        ws = new WebSocket(WS_MINI_TICKER_URL);
        const socket = ws;
        lastMessageAt = Date.now();
        watchdog = setInterval(() => {
          if (Date.now() - lastMessageAt > 10000) {
            // WS-поток молчит (сокет может быть открыт, но кадры не идут) —
            // подпитываем скринер теми же реальными данными через REST.
            pollRestFallback();
          }
          if (Date.now() - lastMessageAt > 30000) {
            set({ isConnected: false });
            socket.close();
          }
        }, 5000);

        ws.onopen = () => {
          set({ isConnected: false });
        };

        ws.onmessage = (event) => {
          try {
            const rawArray = JSON.parse(event.data);
            if (!Array.isArray(rawArray)) return;

            const now = Date.now();
            let accepted = false;
            for (const item of rawArray) {
              const sym = item.s;
              if (!sym || !sym.endsWith('USDT')) continue;

              const c = parseFloat(item.c) || 0;
              const o = parseFloat(item.o) || 0;
              const q = parseFloat(item.q) || 0; // 24h turnover in USDT
              const h = parseFloat(item.h) || 0;
              const l = parseFloat(item.l) || 0;
              if (![c, o, q, h, l].every(Number.isFinite) || c <= 0 || o <= 0 || h <= 0 || l <= 0 || q < 0) continue;
              accepted = true;
              const changePct = o > 0 ? ((c - o) / o) * 100 : 0;

              batchBuffer.set(sym, {
                symbol: sym,
                price: c,
                open24h: o,
                high24h: h,
                low24h: l,
                change24hPct: Number(changePct.toFixed(2)),
                volumeUsd: q,
                ts: now
              });
            }
            if (!accepted) return;
            lastMessageAt = now;
            reconnectAttempts = 0;
            set({ isConnected: true });

            // Flush batched updates every 350ms to keep React UI smooth without micro-re-renders
            if (!flushTimer) {
              flushTimer = setTimeout(() => {
                flushTimer = null;
                const currentTickers = { ...get().tickers };
                for (const [sym, data] of batchBuffer.entries()) {
                  currentTickers[sym] = data;
                }
                batchBuffer.clear();

                const list = Object.values(currentTickers);
                set({
                  tickers: currentTickers,
                  tickersList: list,
                  dataSource: 'ws',
                  lastUpdateTs: Date.now()
                });
              }, 350);
            }
          } catch (_) {}
        };

        ws.onerror = () => {
          set({ isConnected: false });
          try { socket.close(); } catch (_) {}
        };

        ws.onclose = () => {
          clearInterval(watchdog);
          watchdog = null;
          ws = null;
          set({ isConnected: false });
          scheduleReconnect();
        };
      } catch (err) {
        console.debug('MiniTicker stream offline/failover:', err);
        set({ isConnected: false });
        scheduleReconnect();
      }

      if (typeof window !== 'undefined' && !window.__miniTickerOnlineRegistered) {
        window.__miniTickerOnlineRegistered = true;
        window.addEventListener('online', () => {
          if (!stopped) get().initMiniTickerStream();
        });
      }
    },

    disconnectStream: () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (flushTimer) clearTimeout(flushTimer);
      if (watchdog) clearInterval(watchdog);
      reconnectTimer = flushTimer = watchdog = null;
      batchBuffer.clear();
      if (ws) {
        try {
          ws.onopen = null;
          ws.onmessage = null;
          ws.onerror = null;
          ws.onclose = null;
          ws.close();
        } catch (_) {}
        ws = null;
      }
      set({ isConnected: false });
    }
  };
});

// Dev-отладка: доступ к стору из консоли/авто-тестов (только в dev-сборке).
if (typeof window !== 'undefined' && import.meta.env && import.meta.env.DEV) {
  window.__marketDataStore = useMarketDataStore;
}
