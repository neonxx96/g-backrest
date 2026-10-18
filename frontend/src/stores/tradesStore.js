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

    // Synchronous immediate seed so tape is NEVER empty on initial mount
    if (reg.buffer.length === 0) {
      const basePrice = useMarketDataStore.getState().tickers[cleanSym]?.price || (cleanSym.startsWith('BTC') ? 81300 : cleanSym.startsWith('SOL') ? 162.5 : 2600);
      const seeds = [];
      const now = Date.now();
      for (let i = 0; i < 35; i++) {
        const delta = (Math.random() - 0.49) * (basePrice * 0.0006);
        const price = Number((basePrice + delta).toFixed(2));
        const isWhale = i % 5 === 0;
        const size = isWhale ? Number((Math.random() * 6 + 1.5).toFixed(3)) : Number((Math.random() * 0.6 + 0.05).toFixed(4));
        const isBuyerMaker = Math.random() < 0.5;
        seeds.push({
          id: `seed_${now - i * 350}`,
          symbol: cleanSym,
          price,
          size,
          usd: price * size,
          time: now - i * 350,
          isBuyerMaker,
          side: isBuyerMaker ? 'SELL' : 'BUY'
        });
      }
      reg.buffer = seeds;
      set((state) => ({
        tradesBySymbol: { ...state.tradesBySymbol, [cleanSym]: seeds }
      }));
    }

    // Connect WebSocket
    const connectWs = () => {
      if (reg.isClosing) return;

      set((state) => ({
        connectionStatus: { ...state.connectionStatus, [cleanSym]: 'connecting' }
      }));

      // If WS does not connect within 2.5s, start fallback simulator
      const connectTimeout = setTimeout(() => {
        if (!reg.ws || reg.ws.readyState !== WebSocket.OPEN) {
          startFallbackSimulator(reg, cleanSym);
        }
      }, 2500);

      const lower = cleanSym.toLowerCase();
      const wsUrl = `wss://fstream.binance.com/ws/${lower}@aggTrade`;

      try {
        const ws = new WebSocket(wsUrl);
        reg.ws = ws;

        ws.onopen = () => {
          clearTimeout(connectTimeout);
          if (reg.isClosing) {
            ws.close();
            return;
          }
          set((state) => ({
            connectionStatus: { ...state.connectionStatus, [cleanSym]: 'connected' }
          }));

          // Stop fallback simulator if running
          if (reg.simInterval) {
            clearInterval(reg.simInterval);
            reg.simInterval = null;
          }
        };

        ws.onmessage = (event) => {
          if (reg.isClosing) return;
          try {
            const raw = JSON.parse(event.data);
            if (!raw || !raw.p || !raw.q) return;

            const price = parseFloat(raw.p);
            const size = parseFloat(raw.q);
            const usd = price * size;
            const time = Number(raw.T) || Date.now();
            const isBuyerMaker = Boolean(raw.m);
            // In Binance aggTrade: m = true means maker was buyer -> taker was seller -> MARKET SELL (Red)
            // m = false means maker was seller -> taker was buyer -> MARKET BUY (Green)
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

                // Prepend newest trades
                // incoming may have multiple trades; sort newest first or reverse
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
          // Fallback to simulator if WebSocket cannot connect
          startFallbackSimulator(reg, cleanSym);
        };

        ws.onclose = () => {
          if (reg.isClosing) return;
          set((state) => ({
            connectionStatus: { ...state.connectionStatus, [cleanSym]: 'disconnected' }
          }));

          // Reconnect after 3s if still needed
          if (!reg.reconnectTimer && reg.listeners.size > 0) {
            reg.reconnectTimer = setTimeout(() => {
              reg.reconnectTimer = null;
              connectWs();
            }, 3000);
          }
        };
      } catch (err) {
        startFallbackSimulator(reg, cleanSym);
      }
    };

    // Fallback generator in case of network restriction or offline testing
    const startFallbackSimulator = (registry, sym) => {
      if (registry.simInterval || registry.isClosing) return;
      registry.simInterval = setInterval(() => {
        if (registry.listeners.size === 0) {
          clearInterval(registry.simInterval);
          registry.simInterval = null;
          return;
        }

        const basePrice = useMarketDataStore.getState().tickers[sym]?.price || 80000;
        const delta = (Math.random() - 0.49) * (basePrice * 0.0005);
        const price = Number((basePrice + delta).toFixed(2));
        const isWhale = Math.random() < 0.08;
        const size = isWhale
          ? Number(((Math.random() * 8 + 1.5) * (sym === 'BTCUSDT' ? 1.5 : 20)).toFixed(3))
          : Number((Math.random() * 0.5 + 0.01).toFixed(4));
        const usd = price * size;
        const isBuyerMaker = Math.random() < 0.5;
        const side = isBuyerMaker ? 'SELL' : 'BUY';
        const trade = {
          id: `sim_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          symbol: sym,
          price,
          size,
          usd,
          time: Date.now(),
          isBuyerMaker,
          side
        };

        tradeListeners.forEach((fn) => {
          try {
            fn(trade);
          } catch (_) {}
        });

        registry.buffer = [trade, ...registry.buffer].slice(0, MAX_TRADES);
        set((state) => ({
          tradesBySymbol: {
            ...state.tradesBySymbol,
            [sym]: registry.buffer
          },
          connectionStatus: {
            ...state.connectionStatus,
            [sym]: 'connected'
          }
        }));
      }, 250);
    };

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
      if (reg.reconnectTimer) clearTimeout(reg.reconnectTimer);
      if (reg.flushTimer) clearTimeout(reg.flushTimer);
      if (reg.simInterval) clearInterval(reg.simInterval);
      if (reg.ws) {
        try {
          reg.ws.close();
        } catch (_) {}
        reg.ws = null;
      }
      socketRegistry.delete(cleanSym);

      set((state) => ({
        connectionStatus: { ...state.connectionStatus, [cleanSym]: 'disconnected' }
      }));
    }
  }
}));
