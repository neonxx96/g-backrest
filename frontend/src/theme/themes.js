/**
 * slab_terminal Theme & Preset definitions
 * Reference: design/THEMES_AND_PRESETS.md and design/ADDENDUM_01_REFERENCES_AND_PRESETS.md
 */

export const THEME_PRESETS = {
  graphite: {
    id: 'graphite',
    name: 'Graphite',
    description: 'Монохромный, нейтральный тёмный (по умолчанию)',
    defaultLiqPalette: 'muted',
    defaultCandleMode: 'color',
    colors: {
      bg: '#111315',
      panel: '#16191c',
      raised: '#1c2024',
      grid: '#1f2428',
      border: '#2a3035',
      text1: '#c4c9ce',
      text2: '#8c949b',
      text3: '#646c73',
      accent: '#93a5b4',
      up: '#78a392',
      down: '#b8776f',
      warn: '#b9a46d',
      blocked: '#b8776f',
      ok: '#78a392',
      candleUp: '#78a392',
      candleDown: '#b8776f',
      candleUpBorder: '#78a392',
      candleWick: '#8c949b',
      zoneDemand: 'rgba(120, 163, 146, 0.05)',
      zoneSupply: 'rgba(184, 119, 111, 0.05)',
    },
  },
  signal: {
    id: 'signal',
    name: 'Signal',
    description: 'Яркий, максимальная заметность слоев данных',
    defaultLiqPalette: 'vivid',
    defaultCandleMode: 'color',
    colors: {
      bg: '#0b0d10',
      panel: '#10141a',
      raised: '#161b22',
      grid: '#1a2028',
      border: '#272f39',
      text1: '#cdd3da',
      text2: '#8f99a5',
      text3: '#636d79',
      accent: '#86a9d4',
      up: '#46c99a',
      down: '#e4786d',
      warn: '#e0b84a',
      blocked: '#e4786d',
      ok: '#46c99a',
      candleUp: '#46c99a',
      candleDown: '#e4786d',
      candleUpBorder: '#46c99a',
      candleWick: '#8f99a5',
      zoneDemand: 'rgba(70, 201, 154, 0.06)',
      zoneSupply: 'rgba(228, 120, 109, 0.06)',
    },
  },
  cyan_night: {
    id: 'cyan_night',
    name: 'Cyan Night',
    description: 'Одногамный бирюзовый, направление свечи через заливку',
    defaultLiqPalette: 'vivid',
    defaultCandleMode: 'hollow',
    colors: {
      bg: '#09141a',
      panel: '#0d1a21',
      raised: '#122630',
      grid: '#16303a',
      border: '#214250',
      text1: '#c2d9df',
      text2: '#7fa3ae',
      text3: '#58767f',
      accent: '#5fd3d9',
      up: '#5fd3d9',
      down: '#cf7a80',
      warn: '#d9b45a',
      blocked: '#cf7a80',
      ok: '#5fd3d9',
      candleUp: '#5fd3d9',
      candleDown: '#3f8d9c',
      candleUpBorder: '#5fd3d9',
      candleWick: '#7fa3ae',
      zoneDemand: 'rgba(95, 211, 217, 0.05)',
      zoneSupply: 'rgba(207, 122, 128, 0.06)',
    },
  },
};

export const LIQUIDATION_PALETTES = {
  muted: {
    id: 'muted',
    name: 'Muted',
    description: 'Приглушенная серебристо-серая гамма (по умолчанию для Graphite)',
    stops: [
      { offset: 0, color: 'transparent' },
      { offset: 0.3, color: 'rgba(120, 130, 150, 0.18)' },
      { offset: 0.6, color: 'rgba(150, 165, 185, 0.40)' },
      { offset: 1.0, color: 'rgba(200, 210, 222, 0.70)' },
    ],
    primary: 'rgba(200, 210, 222, 0.85)',
  },
  vivid: {
    id: 'vivid',
    name: 'Vivid',
    description: 'Пурпур -> фуксия -> оранжевый -> жёлтый (по умолчанию для Signal и Cyan Night)',
    stops: [
      { offset: 0, color: 'transparent' },
      { offset: 0.25, color: '#2b1a5e' },
      { offset: 0.5, color: '#7b2a9c' },
      { offset: 0.72, color: '#d6479a' },
      { offset: 0.88, color: '#f08a3c' },
      { offset: 1.0, color: '#ffd84a' },
    ],
    primary: '#ffd84a',
  },
  acid: {
    id: 'acid',
    name: 'Acid',
    description: 'Глубокий индиго -> фиолетовый -> неон-розовый -> кислотно-лаймовый',
    stops: [
      { offset: 0, color: 'transparent' },
      { offset: 0.25, color: '#1e1b4b' },
      { offset: 0.5, color: '#8b2fc9' },
      { offset: 0.72, color: '#ff3fb4' },
      { offset: 0.9, color: '#c6ff3d' },
      { offset: 1.0, color: '#f4ffd0' },
    ],
    primary: '#c6ff3d',
  },
};

export const CANDLE_MODES = {
  color: { id: 'color', name: 'Color', description: 'Классические свечи по цветам темы' },
  hollow: { id: 'hollow', name: 'Hollow', description: 'Полый контур для роста, заливка для падения' },
  mono: { id: 'mono', name: 'Mono', description: 'Монохромные свечи оттенками серого' },
};

const STORAGE_KEY = 'slab_terminal_theme_settings';

/**
 * Default Theme Settings State
 */
export const DEFAULT_THEME_SETTINGS = {
  theme: 'graphite',
  liqPalette: 'muted',
  candleMode: 'color',
  layerOpacity: 1.0, // 0.5 to 1.0
};

/**
 * Apply settings to DOM root
 */
export function applyThemeToDOM(settings) {
  const root = document.documentElement;
  const theme = settings.theme || 'graphite';
  const liqPalette = settings.liqPalette || 'muted';
  const candleMode = settings.candleMode || 'color';
  const layerOpacity = settings.layerOpacity !== undefined ? settings.layerOpacity : 1.0;

  root.setAttribute('data-theme', theme);
  root.setAttribute('data-liq-palette', liqPalette);
  root.setAttribute('data-candle-mode', candleMode);
  root.style.setProperty('--layer-opacity', String(layerOpacity));
}

/**
 * Load theme settings with API primary and localStorage fallback
 */
export async function loadThemeSettings(workspaceId = 'default_classic') {
  // 1. Try fetching from /api/workspaces
  try {
    const res = await fetch(`/api/workspaces/${workspaceId}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.layout_data?.themeSettings) {
        return { ...DEFAULT_THEME_SETTINGS, ...data.layout_data.themeSettings };
      }
    }
  } catch (err) {
    // API failed or offline - fall through to localStorage
  }

  // 2. Fallback to localStorage
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return { ...DEFAULT_THEME_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (e) {
    // LocalStorage blocked/unavailable
  }

  return { ...DEFAULT_THEME_SETTINGS };
}

/**
 * Save theme settings with API primary and localStorage fallback
 */
export async function saveThemeSettings(newSettings, workspaceId = 'default_classic') {
  const settings = { ...DEFAULT_THEME_SETTINGS, ...newSettings };

  // Save to localStorage immediately as fast local cache
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    // Ignore storage quota/permission error
  }

  // Try persisting to backend workspace
  try {
    const res = await fetch(`/api/workspaces/${workspaceId}`);
    if (res.ok) {
      const current = await res.json();
      const updatedLayout = {
        ...(current.layout_data || {}),
        themeSettings: settings,
      };

      await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: current.id,
          name: current.name,
          layout_data: updatedLayout,
          color_links: current.color_links,
          is_default: current.is_default,
        }),
      });
    }
  } catch (err) {
    // Backend unavailable, fallback stays in localStorage
  }

  return settings;
}
