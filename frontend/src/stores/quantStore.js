import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useQuantStore = create(
  persist(
    (set, get) => ({
      symbol: 'BTCUSDT',
      loading: false,
      unifiedData: null,
      core3Report: null,
      promptData: null,
      quarantineSaved: false,
      isCommitting: false,

      // Global Visibility Controls
      showLiqLayers: true,
      showLiqPanel: false,

      // Layer toggles
      layers: {
        liqHeatmap: true,
        liqLevels: true,
        obDepth: true,
        obProfile: true,
      },

      // Leverage filters
      leverages: {
        '25x': true,
        '50x': true,
        '75x': true,
        '100x': true,
      },

      // Wall multiplier & rendering adjustments
      minWallMultiplier: 2.5,
      wallLineThickness: 2,
      layerOpacity: 100,
      liqPalette: 'vivid',

      // Actions
      setSymbol: (symbol) => {
        if (!symbol) return;
        const sym = symbol.toUpperCase();
        if (get().symbol !== sym) {
          set({ symbol: sym, quarantineSaved: false });
          get().fetchMarketData(sym);
        }
      },

      fetchMarketData: async (targetSymbol) => {
        const sym = (targetSymbol || get().symbol || 'BTCUSDT').toUpperCase();
        set({ loading: true, quarantineSaved: false });

        try {
          const [resUnified, resEval, resPrompt] = await Promise.all([
            fetch(`/api/quant/unified?symbol=${sym}`).then((r) => (r.ok ? r.json() : null)),
            fetch(`/api/quant/evaluate?symbol=${sym}`).then((r) => (r.ok ? r.json() : null)),
            fetch(`/api/quant/prompt?symbol=${sym}`).then((r) => (r.ok ? r.json() : null)),
          ]);

          set({
            unifiedData: resUnified || get().unifiedData,
            core3Report: resEval || get().core3Report,
            promptData: resPrompt || get().promptData,
          });
        } catch (err) {
          console.warn('Failed to fetch quant market data:', err);
        } finally {
          set({ loading: false });
        }
      },

      commitQuarantine: async (targetSymbol) => {
        const sym = (targetSymbol || get().symbol || 'BTCUSDT').toUpperCase();
        set({ isCommitting: true });
        try {
          const res = await fetch(`/api/quant/quarantine?symbol=${sym}`, { method: 'POST' });
          if (res.ok) {
            set({ quarantineSaved: true });
            return await res.json();
          }
        } catch (err) {
          console.error('Failed to commit quarantine signal:', err);
        } finally {
          set({ isCommitting: false });
        }
        return null;
      },

      toggleLayer: (key) =>
        set((state) => ({
          layers: { ...state.layers, [key]: !state.layers[key] },
        })),

      toggleLeverage: (lev) =>
        set((state) => ({
          leverages: { ...state.leverages, [lev]: !state.leverages[lev] },
        })),

      setMinWallMultiplier: (minWallMultiplier) => set({ minWallMultiplier: Number(minWallMultiplier) || 2.5 }),
      setWallLineThickness: (wallLineThickness) => set({ wallLineThickness: Number(wallLineThickness) || 2 }),
      setLayerOpacity: (layerOpacity) => set({ layerOpacity: Number(layerOpacity) || 100 }),
      setLiqPalette: (liqPalette) => set({ liqPalette }),
      toggleLiqLayers: () => set((state) => ({ showLiqLayers: !state.showLiqLayers })),
      toggleLiqPanel: () => set((state) => ({ showLiqPanel: !state.showLiqPanel })),
      setShowLiqPanel: (showLiqPanel) => set({ showLiqPanel: Boolean(showLiqPanel) }),
      setShowLiqLayers: (showLiqLayers) => set({ showLiqLayers: Boolean(showLiqLayers) }),
    }),
    {
      name: 'signalscript_quant_storage',
      partialize: (state) => ({
        symbol: state.symbol,
        showLiqLayers: state.showLiqLayers,
        showLiqPanel: state.showLiqPanel,
        layers: state.layers,
        leverages: state.leverages,
        minWallMultiplier: state.minWallMultiplier,
        wallLineThickness: state.wallLineThickness,
        layerOpacity: state.layerOpacity,
        liqPalette: state.liqPalette,
      }),
    }
  )
);
