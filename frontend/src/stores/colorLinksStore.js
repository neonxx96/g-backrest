/**
 * Color Links Store (Zustand)
 * Manages 10 discrete color channels (c1..c10) and widget channel bindings.
 *
 * BEHAVIOR SPECIFICATION (Requirement 3):
 * - If a widget has a color channel assigned (e.g. 'c1'), clicking a coin in any
 *   widget bound to 'c1' updates the symbol for ALL widgets bound to 'c1'.
 * - If a widget has NO color ('none' / null), it operates COMPLETELY INDEPENDENTLY:
 *   it maintains its own private symbol and ignores channel broadcast updates.
 * - Binding to a channel is toggled explicitly via the header channel dropdown/pill.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const COLOR_CHANNELS = [
  { id: 'c1', name: 'Синий', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.2)', border: '#3b82f6' },
  { id: 'c2', name: 'Зеленый', color: '#10b981', bg: 'rgba(16, 185, 129, 0.2)', border: '#10b981' },
  { id: 'c3', name: 'Оранжевый', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.2)', border: '#f59e0b' },
  { id: 'c4', name: 'Фиолетовый', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.2)', border: '#8b5cf6' },
  { id: 'c5', name: 'Желтый', color: '#eab308', bg: 'rgba(234, 179, 8, 0.2)', border: '#eab308' },
  { id: 'c6', name: 'Бирюзовый', color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.2)', border: '#06b6d4' },
  { id: 'c7', name: 'Красный', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.2)', border: '#ef4444' },
  { id: 'c8', name: 'Розовый', color: '#ec4899', bg: 'rgba(236, 72, 153, 0.2)', border: '#ec4899' },
  { id: 'c9', name: 'Серый', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.2)', border: '#94a3b8' },
  { id: 'c10', name: 'Лайм', color: '#84cc16', bg: 'rgba(132, 204, 22, 0.2)', border: '#84cc16' }
];

const DEFAULT_CHANNELS = {
  c1: 'BTCUSDT',
  c2: 'ETHUSDT',
  c3: 'SOLUSDT',
  c4: 'BNBUSDT',
  c5: 'DOGEUSDT',
  c6: 'XRPUSDT',
  c7: 'SUIUSDT',
  c8: 'NEARUSDT',
  c9: 'PEPEUSDT',
  c10: 'AVAXUSDT'
};

export const useColorLinksStore = create(
  persist(
    (set, get) => ({
  // 10 channels mapping: channelId -> symbol
  channels: { ...DEFAULT_CHANNELS },

  // Panel bindings: panelId -> channelId | null (null = Independent / No color)
  panelBindings: {
    chart_main: 'c1',
    orderbook_main: 'c1',
    watchlist_main: 'c1',
    signals_main: 'c1',
    trades_main: 'c1',
    chart_ltf: 'c1'
  },

  // Private symbols for unlinked (no-color) panels
  panelPrivateSymbols: {},

  // Narrow selector helper: get symbol for a specific panel
  getPanelSymbol: (panelId, fallback = 'BTCUSDT') => {
    const state = get();
    const channelId = state.panelBindings[panelId];
    if (channelId && state.channels[channelId]) {
      return state.channels[channelId];
    }
    return state.panelPrivateSymbols[panelId] || fallback;
  },

  // Update symbol for a channel (broadcasts to all widgets on that channel)
  setChannelSymbol: (channelId, symbol) => {
    if (!channelId || !symbol) return;
    const cleanSym = symbol.toUpperCase().trim();
    set((state) => ({
      channels: {
        ...state.channels,
        [channelId]: cleanSym
      }
    }));
  },

  // Change or remove a widget's channel binding
  setPanelChannel: (panelId, channelId) => {
    set((state) => ({
      panelBindings: {
        ...state.panelBindings,
        [panelId]: channelId || null
      }
    }));
  },

  // Dispatch symbol change from a specific widget
  dispatchSymbolChange: (panelId, symbol) => {
    const cleanSym = symbol.toUpperCase().trim();
    const state = get();
    const channelId = state.panelBindings[panelId];
    if (channelId) {
      // Linked mode: update the channel so ALL widgets on this channel sync
      state.setChannelSymbol(channelId, cleanSym);
    } else {
      // Independent mode: update ONLY this panel's private symbol
      set((prev) => ({
        panelPrivateSymbols: {
          ...prev.panelPrivateSymbols,
          [panelId]: cleanSym
        }
      }));
    }
  },

  // Bulk import color links (e.g. from SQLite workspace load)
  importColorLinks: (importedLinks, panelBindings = null) => {
    set((state) => ({
      channels: {
        ...state.channels,
        ...(importedLinks || {})
      },
      panelBindings: panelBindings
        ? { ...state.panelBindings, ...panelBindings }
        : state.panelBindings
    }));
  }
}),
    {
      name: 'signalscript_color_links',
      partialize: (state) => ({
        channels: state.channels,
        panelBindings: state.panelBindings,
        panelPrivateSymbols: state.panelPrivateSymbols
      })
    }
  )
);

if (typeof window !== 'undefined') {
  window.useColorLinksStore = useColorLinksStore;
}
