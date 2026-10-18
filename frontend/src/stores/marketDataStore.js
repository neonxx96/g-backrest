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
import { DEFAULT_FOCUS_LIST } from '../config/coinLibrary';

const WS_MINI_TICKER_URL = 'wss://fstream.binance.com/ws/!miniTicker@arr';

const INITIAL_TICKERS = {
  BTCUSDT: { symbol: 'BTCUSDT', price: 81300.0, open24h: 80100.0, high24h: 82500.0, low24h: 79800.0, change24hPct: 1.5, volumeUsd: 15400000000, ts: Date.now() },
  ETHUSDT: { symbol: 'ETHUSDT', price: 2610.0, open24h: 2580.0, high24h: 2650.0, low24h: 2540.0, change24hPct: 1.16, volumeUsd: 6800000000, ts: Date.now() },
  SOLUSDT: { symbol: 'SOLUSDT', price: 162.5, open24h: 158.0, high24h: 165.0, low24h: 155.0, change24hPct: 2.85, volumeUsd: 3200000000, ts: Date.now() },
  LINKUSDT: { symbol: 'LINKUSDT', price: 18.45, open24h: 17.80, high24h: 18.90, low24h: 17.50, change24hPct: 3.65, volumeUsd: 850000000, ts: Date.now() },
  ADAUSDT: { symbol: 'ADAUSDT', price: 0.655, open24h: 0.640, high24h: 0.670, low24h: 0.630, change24hPct: 2.34, volumeUsd: 620000000, ts: Date.now() },
  SUIUSDT: { symbol: 'SUIUSDT', price: 2.15, open24h: 2.05, high24h: 2.25, low24h: 2.00, change24hPct: 4.88, volumeUsd: 610000000, ts: Date.now() },
  UNIUSDT: { symbol: 'UNIUSDT', price: 9.85, open24h: 9.40, high24h: 10.10, low24h: 9.20, change24hPct: 4.78, volumeUsd: 480000000, ts: Date.now() },
  ZECUSDT: { symbol: 'ZECUSDT', price: 34.20, open24h: 33.10, high24h: 35.50, low24h: 32.80, change24hPct: 3.32, volumeUsd: 290000000, ts: Date.now() },
  BNBUSDT: { symbol: 'BNBUSDT', price: 595.0, open24h: 602.0, high24h: 610.0, low24h: 590.0, change24hPct: -1.16, volumeUsd: 850000000, ts: Date.now() },
  DOGEUSDT: { symbol: 'DOGEUSDT', price: 0.142, open24h: 0.148, high24h: 0.155, low24h: 0.138, change24hPct: -4.05, volumeUsd: 920000000, ts: Date.now() },
  XRPUSDT: { symbol: 'XRPUSDT', price: 0.548, open24h: 0.540, high24h: 0.560, low24h: 0.535, change24hPct: 1.48, volumeUsd: 740000000, ts: Date.now() },
  NEARUSDT: { symbol: 'NEARUSDT', price: 4.85, open24h: 4.70, high24h: 5.10, low24h: 4.60, change24hPct: 3.19, volumeUsd: 350000000, ts: Date.now() }
};

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

  let monitoringWs = null;
  let monitoringReconnectTimer = null;

  return {
    // Map of symbol -> { symbol, price, open24h, high24h, low24h, change24hPct, volumeUsd, ts }
    tickers: { ...INITIAL_TICKERS },
    tickersList: Object.values(INITIAL_TICKERS),
    isConnected: false,
    lastUpdateTs: Date.now(),

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
        const id = signal.id || `${signal.symbol}_${signal.timestamp || Date.now()}_${Math.random()}`;
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
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
      }

      try {
        ws = new WebSocket(WS_MINI_TICKER_URL);

        ws.onopen = () => {
          set({ isConnected: true });
        };

        ws.onmessage = (event) => {
          try {
            const rawArray = JSON.parse(event.data);
            if (!Array.isArray(rawArray)) return;

            const now = Date.now();
            for (const item of rawArray) {
              const sym = item.s;
              if (!sym || !sym.endsWith('USDT')) continue;

              const c = parseFloat(item.c) || 0;
              const o = parseFloat(item.o) || 0;
              const q = parseFloat(item.q) || 0; // 24h turnover in USDT
              const h = parseFloat(item.h) || 0;
              const l = parseFloat(item.l) || 0;
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
                  lastUpdateTs: Date.now()
                });
              }, 350);
            }
          } catch (_) {}
        };

        ws.onerror = () => {
          set({ isConnected: false });
          try { ws.close(); } catch (_) {}
        };

        ws.onclose = () => {
          ws = null;
          set({ isConnected: false });
          if (!reconnectTimer) {
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              get().initMiniTickerStream();
            }, 2500);
          }
        };
      } catch (err) {
        console.warn('MiniTicker stream error:', err);
      }

      if (typeof window !== 'undefined' && !window.__miniTickerOnlineRegistered) {
        window.__miniTickerOnlineRegistered = true;
        window.addEventListener('online', () => {
          get().initMiniTickerStream();
        });
      }
    },

    disconnectStream: () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (flushTimer) clearTimeout(flushTimer);
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
