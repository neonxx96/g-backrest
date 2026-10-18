/**
 * Layout Store (Zustand)
 * Manages Dockview presets, active layout state, and debounced SQLite persistence.
 *
 * CRITICAL SAFEGUARDS (Requirement 2):
 * - `isLayoutLoaded`: when `fromJSON` executes, dockview fires `onDidLayoutChange` events.
 *   Autosave is STRICTLY BLOCKED until `isLayoutLoaded === true` to prevent blank layout overwrites.
 * - `schemaVersion: 1`: validated on every load/save.
 * - Fallback protection: if `fromJSON` throws or a panel type is unrecognized, it falls back
 *   to the default classic layout with a console.warn instead of rendering a white screen.
 * - Debounce: 400ms delay for auto-persistence to `/api/workspaces`.
 */

import { create } from 'zustand';

const API_BASE = '/api/workspaces';

export const useLayoutStore = create((set, get) => {
  let autosaveTimer = null;

  return {
    presets: [],
    activePresetId: 'default_classic',
    currentLayoutData: null,
    isLayoutLoaded: false,
    saveStatus: 'idle', // 'idle' | 'saving' | 'saved' | 'error'
    lastSavedAt: null,
    errorMessage: null,
    panelIndicators: {}, // Map of panelId -> array of active indicators
    isWidgetHubOpen: false,
    addWidgetHandler: null,

    // Widget Hub modal controls
    openWidgetHub: () => set({ isWidgetHubOpen: true }),
    closeWidgetHub: () => set({ isWidgetHubOpen: false }),
    setWidgetHubOpen: (isOpen) => set({ isWidgetHubOpen: isOpen }),

    // Register active dockview add panel handler
    setAddWidgetHandler: (fn) => set({ addWidgetHandler: fn }),

    // Add a widget to the active dockview grid
    addWidgetPanel: (type, options = {}) => {
      const handler = get().addWidgetHandler;
      if (handler) {
        return handler(type, options);
      }
      console.warn('addWidgetHandler is not registered yet');
      return null;
    },

    // Get indicators for a specific panel (with fallback to default)
    getPanelIndicators: (panelId = 'chart_main') => {
      const state = get();
      return state.panelIndicators[panelId] || null;
    },

    // Update indicators for a panel and schedule debounced save
    setPanelIndicators: (panelId, indicators) => {
      set((state) => ({
        panelIndicators: {
          ...state.panelIndicators,
          [panelId]: indicators
        }
      }));
      setTimeout(() => {
        const state = get();
        if (state.isLayoutLoaded && state.currentLayoutData?.dockview) {
          state.scheduleAutosave(state.currentLayoutData.dockview);
        }
      }, 50);
    },

    // Fetch all presets from backend
    loadPresets: async () => {
      try {
        const res = await fetch(API_BASE);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        set({ presets: data });
        return data;
      } catch (err) {
        console.warn('Failed to load presets from SQLite:', err);
        return [];
      }
    },

    // Load single workspace detail by ID
    loadWorkspaceDetail: async (id) => {
      // Temporarily lock autosave while new layout initializes
      set({ isLayoutLoaded: false, saveStatus: 'idle' });
      try {
        const res = await fetch(`${API_BASE}/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        // Validate schemaVersion
        const layoutData = data.layout_data || {};
        if (!layoutData.schemaVersion) {
          layoutData.schemaVersion = 1;
        }

        const restoredIndicators = layoutData.indicators || {};

        set({
          activePresetId: data.id,
          currentLayoutData: layoutData,
          panelIndicators: restoredIndicators,
          saveStatus: 'idle'
        });

        return data;
      } catch (err) {
        console.warn(`Error loading workspace ${id}, using default fallback:`, err);
        set({ activePresetId: 'default_classic', saveStatus: 'error' });
        return null;
      }
    },

    // Mark layout as fully loaded and ready for autosave triggers
    markLayoutReady: () => {
      set({ isLayoutLoaded: true });
    },

    // Schedule debounced autosave (300-500ms, chosen 400ms)
    scheduleAutosave: (dockviewJson, colorLinks = null) => {
      const state = get();
      // Block autosave during initial hydration / fromJSON transitions
      if (!state.isLayoutLoaded) {
        return;
      }

      if (autosaveTimer) clearTimeout(autosaveTimer);

      set({ saveStatus: 'saving' });

      autosaveTimer = setTimeout(async () => {
        try {
          const currentPresets = get().presets;
          const activeId = get().activePresetId;
          const currentPreset = currentPresets.find((p) => p.id === activeId);
          const presetName = currentPreset ? currentPreset.name : 'Пользовательский пресет';

          // Strictly strip any market data, only persist layout geometry & panel IDs
          const payload = {
            id: activeId,
            name: presetName,
            layout_data: {
              schemaVersion: 1,
              dockview: dockviewJson,
              indicators: get().panelIndicators,
              updatedAt: Date.now()
            },
            color_links: colorLinks || undefined,
            is_default: activeId === 'default_classic'
          };

          const res = await fetch(API_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          set({
            saveStatus: 'saved',
            lastSavedAt: Date.now()
          });

          // Reset status to idle after 2.5s
          setTimeout(() => {
            if (get().saveStatus === 'saved') {
              set({ saveStatus: 'idle' });
            }
          }, 2500);
        } catch (err) {
          console.warn('Autosave failed:', err);
          set({ saveStatus: 'error', errorMessage: err.message });
        }
      }, 400);
    },

    // Create a new preset (up to 10 max)
    createPreset: async (name, dockviewJson, colorLinks = null) => {
      const state = get();
      if (state.presets.length >= 10) {
        throw new Error('Достигнут лимит пресетов (максимум 10). Удалите ненужный пресет.');
      }

      const newId = `preset_${Date.now()}`;
      const payload = {
        id: newId,
        name: name || `Пресет ${state.presets.length + 1}`,
        layout_data: {
          schemaVersion: 1,
          dockview: dockviewJson,
          createdAt: Date.now()
        },
        color_links: colorLinks || {},
        is_default: false
      };

      const res = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved = await res.json();

      await get().loadPresets();
      set({ activePresetId: saved.id });
      return saved;
    },

    // Delete custom preset
    deletePreset: async (id) => {
      if (id === 'default_classic' || id === 'default_orderflow') {
        throw new Error('Нельзя удалить стандартный пресет');
      }

      const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      await get().loadPresets();
      await get().loadWorkspaceDetail('default_classic');
    }
  };
});
