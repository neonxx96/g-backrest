/**
 * High-Performance Trades Store (Zustand)
 * Manages Binance Futures @aggTrade WebSocket streams with ring-buffer memory safety.
 * Supports reference-counted symbol subscriptions, high-frequency batching, and zero-latency audio hooks.
 */

import { create } from 'zustand';
import { useMarketDataStore } from './marketDataStore';

const MAX_TRADES = 500; // Ring buffer limit per symbol to prevent memory leaks

// Formatter helper for compact numbers
export const formatCompact = (num, decimals = 1) => {
  if (num == null || isNaN(num)) return '0';
  const abs = Math.abs(num);
  if (abs >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(decimals)}B`;
  if (abs >= 1_000_000) return `${(num / 1_000_000).toFixed(decimals)}M`;
  if (abs >= 1_000) return `${(num / 1_000).toFixed(decimals)}K`;
  return num.toFixed(decimals);
};

export const formatPrice = (price) => {
  if (price == null || isNaN(price)) return '0.00';
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(2);
  if (price >= 0.01) return price.toFixed(4);
  return price.toFixed(6);
};

// WebSocket connection registry: symbol -> { ws, refCount, reconnectTimer, buffer, flushTimer }
const socketRegistry = new Map();

// Trade listeners: Set of callback functions (trade) => void
const tradeListeners = new Set();

export const useTradesStore = create((set, get) => ({
  // Map of symbol -> Array of trades (newest first, up to MAX_TRADES)
  tradesBySymbol: {},
  // Connection status per symbol: symbol -> 'connected' | 'connecting' | 'disconnected'
  connectionStatus: {},

  // Register a raw trade listener for zero-latency audio or canvas
  addTradeListener: (callback) => {
    tradeListeners.add(callback);
    return () => tradeListeners.delete(callback);
  },

  // Get raw trades for a symbol (for canvas renderers)
  getTrades: (symbol) => {
    return get().tradesBySymbol[symbol] || [];
  },

  // Clear trades for a symbol
  clearTrades: (symbol) => {
    set((state) => ({
      tradesBySymbol: {
        ...state.tradesBySymbol,
        [symbol]: []
      }
    }));
    const reg = socketRegistry.get(symbol.toUpperCase());
    if (reg) {
      reg.buffer = [];
    }
  },

  /**
   * Subscribe to trades for a given symbol
   * @param {string} symbol - e.g. 'BTCUSDT'
   * @param {string} listenerId - unique panel id
   */
  subscribeSymbol: (symbol, listenerId) => {
    if (!symbol) return;
    const cleanSym = symbol.toUpperCase();

    let reg = socketRegistry.get(cleanSym);
    if (!reg) {
      reg = {
        symbol: cleanSym,
        listeners: new Set(),
        ws: null,
        reconnectTimer: null,
        buffer: get().tradesBySymbol[cleanSym] ? [...get().tradesBySymbol[cleanSym]] : [],
        pendingIncoming: [],
        flushTimer: null,
        simInterval: null,
        isClosing: false
      };
      socketRegistry.set(cleanSym, reg);
    }

    reg.listeners.add(listenerId);

    // If socket is already open/connecting, nothing else needed
    if (reg.ws && (reg.ws.readyState === WebSocket.OPEN || reg.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    // Fetch real recent aggTrades from Binance REST so tape shows genuine market prints immediately
    if (reg.buffer.length === 0) {
      fetch(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${cleanSym}&limit=60`)
        .then((r) => (r.ok ? r.json() : []))
        .then((list) => {
          if (reg.isClosing || !Array.isArray(list) || list.length === 0) return;
          if (reg.buffer.length > 0) return; // WS already populated
          const realSeeds = list
            .slice()
            .reverse()
            .map((raw) => {
              const price = parseFloat(raw.p);
              const size = parseFloat(raw.q);
              const isBuyerMaker = Boolean(raw.m);
              return {
                id: raw.a || `${raw.T}_${price}_${size}`,
                symbol: cleanSym,
                price,
                size,
                usd: price * size,
                time: Number(raw.T) || Date.now(),
                isBuyerMaker,
                side: isBuyerMaker ? 'SELL' : 'BUY'
              };
            });
          reg.buffer = realSeeds.slice(0, MAX_TRADES);
          set((state) => ({
            tradesBySymbol: { ...state.tradesBySymbol, [cleanSym]: reg.buffer }
          }));
        })
        .catch(() => {});
    }

    // Connect WebSocket with clean auto-reconnect
    const connectWs = () => {
      if (reg.isClosing || reg.listeners.size === 0) return;
      if (reg.reconnectTimer) {
        clearTimeout(reg.reconnectTimer);
        reg.reconnectTimer = null;
      }
      if (reg.ws) {
        try {
          reg.ws.onopen = null;
          reg.ws.onmessage = null;
          reg.ws.onerror = null;
          reg.ws.onclose = null;
          reg.ws.close();
        } catch (_) {}
        reg.ws = null;
      }

      set((state) => ({
        connectionStatus: { ...state.connectionStatus, [cleanSym]: 'connecting' }
      }));

      const lower = cleanSym.toLowerCase();
      const wsUrl = `wss://fstream.binance.com/ws/${lower}@aggTrade`;

      try {
        const ws = new WebSocket(wsUrl);
        reg.ws = ws;

        ws.onopen = () => {
          if (reg.isClosing || reg.ws !== ws) {
            try { ws.close(); } catch (_) {}
            return;
          }
          set((state) => ({
            connectionStatus: { ...state.connectionStatus, [cleanSym]: 'connected' }
          }));
        };

        ws.onmessage = (event) => {
          if (reg.isClosing || reg.ws !== ws) return;
          try {
            const raw = JSON.parse(event.data);
            if (!raw || !raw.p || !raw.q) return;

            const price = parseFloat(raw.p);
            const size = parseFloat(raw.q);
            const usd = price * size;
            const time = Number(raw.T) || Date.now();
            const isBuyerMaker = Boolean(raw.m);
            const side = isBuyerMaker ? 'SELL' : 'BUY';

            const trade = {
              id: raw.a || `${time}_${price}_${size}`,
              symbol: cleanSym,
              price,
              size,
              usd,
              time,
              isBuyerMaker,
              side
            };

            // Notify raw trade listeners immediately for zero-latency audio
            tradeListeners.forEach((fn) => {
              try {
                fn(trade);
              } catch (_) {}
            });

            // Push to pending buffer
            reg.pendingIncoming.push(trade);

            // Flush batched updates every 50ms (~20 FPS) to avoid React tree thrashing
            if (!reg.flushTimer) {
              reg.flushTimer = setTimeout(() => {
                reg.flushTimer = null;
                if (reg.pendingIncoming.length === 0) return;

                const incoming = reg.pendingIncoming;
                reg.pendingIncoming = [];

                incoming.reverse();
                reg.buffer = [...incoming, ...reg.buffer].slice(0, MAX_TRADES);

                set((state) => ({
                  tradesBySymbol: {
                    ...state.tradesBySymbol,
                    [cleanSym]: reg.buffer
                  }
                }));
              }, 50);
            }
          } catch (_) {}
        };

        ws.onerror = () => {
          try { ws.close(); } catch (_) {}
        };

        ws.onclose = () => {
          if (reg.isClosing || reg.ws !== ws) return;
          set((state) => ({
            connectionStatus: { ...state.connectionStatus, [cleanSym]: 'disconnected' }
          }));

          if (!reg.reconnectTimer && reg.listeners.size > 0) {
            reg.reconnectTimer = setTimeout(() => {
              reg.reconnectTimer = null;
              connectWs();
            }, 2000);
          }
        };
      } catch (err) {
        if (!reg.isClosing && reg.listeners.size > 0) {
          reg.reconnectTimer = setTimeout(() => {
            reg.reconnectTimer = null;
            connectWs();
          }, 2500);
        }
      }
    };

    reg.onNetworkOnline = () => {
      if (!reg.isClosing && reg.listeners.size > 0) {
        connectWs();
      }
    };
    window.addEventListener('online', reg.onNetworkOnline);

    connectWs();
  },

  /**
   * Unsubscribe a panel listener from a symbol
   */
  unsubscribeSymbol: (symbol, listenerId) => {
    if (!symbol) return;
    const cleanSym = symbol.toUpperCase();
    const reg = socketRegistry.get(cleanSym);
    if (!reg) return;

    reg.listeners.delete(listenerId);

    // If no more listeners for this symbol, close socket and clean up
    if (reg.listeners.size === 0) {
      reg.isClosing = true;
      if (reg.onNetworkOnline) {
        window.removeEventListener('online', reg.onNetworkOnline);
      }
      if (reg.reconnectTimer) clearTimeout(reg.reconnectTimer);
      if (reg.flushTimer) clearTimeout(reg.flushTimer);
      if (reg.simInterval) clearInterval(reg.simInterval);
      if (reg.ws) {
        try {
          reg.ws.onopen = null;
          reg.ws.onmessage = null;
          reg.ws.onerror = null;
          reg.ws.onclose = null;
          reg.ws.close();
        } catch (_) {}
        reg.ws = null;
      }
      socketRegistry.delete(cleanSym);

      set((state) => {
        const nextStatus = { ...state.connectionStatus, [cleanSym]: 'disconnected' };
        const nextTrades = { ...state.tradesBySymbol };
        // Evict inactive symbol buffers if more than 8 symbols cached to prevent memory growth
        const keys = Object.keys(nextTrades);
        if (keys.length > 8) {
          for (const k of keys) {
            if (k !== cleanSym && !socketRegistry.has(k)) {
              delete nextTrades[k];
              if (Object.keys(nextTrades).length <= 6) break;
            }
          }
        }
        return {
          connectionStatus: nextStatus,
          tradesBySymbol: nextTrades
        };
      });
    }
  }
}));
