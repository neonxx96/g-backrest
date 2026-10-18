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

export const useMarketDataStore = create((set, get) => {
  let ws = null;
  let reconnectTimer = null;
  let batchBuffer = new Map();
  let flushTimer = null;

  return {
    // Map of symbol -> { symbol, price, open24h, high24h, low24h, change24hPct, volumeUsd, ts }
    tickers: {},
    tickersList: [],
    isConnected: false,
    lastUpdateTs: 0,

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
        };

        ws.onclose = () => {
          set({ isConnected: false });
          if (!reconnectTimer) {
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              get().initMiniTickerStream();
            }, 3000);
          }
        };
      } catch (err) {
        console.warn('MiniTicker stream error:', err);
      }
    },

    disconnectStream: () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (flushTimer) clearTimeout(flushTimer);
      if (ws) {
        ws.close();
        ws = null;
      }
      set({ isConnected: false });
    }
  };
});
