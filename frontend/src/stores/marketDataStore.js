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

const WS_MINI_TICKER_URL = 'wss://fstream.binance.com/ws/!miniTicker@arr';

const INITIAL_TICKERS = {
  BTCUSDT: { symbol: 'BTCUSDT', price: 81300.0, open24h: 80100.0, high24h: 82500.0, low24h: 79800.0, change24hPct: 1.5, volumeUsd: 15400000000, ts: Date.now() },
  ETHUSDT: { symbol: 'ETHUSDT', price: 2610.0, open24h: 2580.0, high24h: 2650.0, low24h: 2540.0, change24hPct: 1.16, volumeUsd: 6800000000, ts: Date.now() },
  SOLUSDT: { symbol: 'SOLUSDT', price: 162.5, open24h: 158.0, high24h: 165.0, low24h: 155.0, change24hPct: 2.85, volumeUsd: 3200000000, ts: Date.now() },
  BNBUSDT: { symbol: 'BNBUSDT', price: 595.0, open24h: 602.0, high24h: 610.0, low24h: 590.0, change24hPct: -1.16, volumeUsd: 850000000, ts: Date.now() },
  DOGEUSDT: { symbol: 'DOGEUSDT', price: 0.142, open24h: 0.148, high24h: 0.155, low24h: 0.138, change24hPct: -4.05, volumeUsd: 920000000, ts: Date.now() },
  XRPUSDT: { symbol: 'XRPUSDT', price: 0.548, open24h: 0.540, high24h: 0.560, low24h: 0.535, change24hPct: 1.48, volumeUsd: 740000000, ts: Date.now() },
  SUIUSDT: { symbol: 'SUIUSDT', price: 2.15, open24h: 2.05, high24h: 2.25, low24h: 2.00, change24hPct: 4.88, volumeUsd: 610000000, ts: Date.now() },
  NEARUSDT: { symbol: 'NEARUSDT', price: 4.85, open24h: 4.70, high24h: 5.10, low24h: 4.60, change24hPct: 3.19, volumeUsd: 350000000, ts: Date.now() }
};

export const useMarketDataStore = create((set, get) => {
  let ws = null;
  let reconnectTimer = null;
  let batchBuffer = new Map();
  let flushTimer = null;

  return {
    // Map of symbol -> { symbol, price, open24h, high24h, low24h, change24hPct, volumeUsd, ts }
    tickers: { ...INITIAL_TICKERS },
    tickersList: Object.values(INITIAL_TICKERS),
    isConnected: false,
    lastUpdateTs: Date.now(),

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
