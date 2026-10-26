import { THEMES, THEME_ALIASES, DEFAULT_THEME_ID } from './themeMeta.js';
import { themeBridge } from './themeBridge.js';

export { THEMES, THEME_ALIASES, DEFAULT_THEME_ID, themeBridge };

export const THEME_PRESETS = {
  graphite: { id: 'night', name: 'Graphite' },
  signal: { id: 'neon', name: 'Signal' },
  cyan_night: { id: 'night', name: 'Cyan Night' },
};

export const LIQUIDATION_PALETTES = {
  muted: { id: 'muted', name: 'Muted' },
  vivid: { id: 'vivid', name: 'Vivid' },
  acid: { id: 'acid', name: 'Acid' },
};

export const CANDLE_MODES = {
  color: { id: 'color', name: 'Цветные' },
  hollow: { id: 'hollow', name: 'Полые' },
  mono: { id: 'mono', name: 'Моно' },
};

export function applyThemeToDOM(settings = {}) {
  const theme = settings.theme || DEFAULT_THEME_ID;
  themeBridge.setTheme(theme, true);
  if (typeof document !== 'undefined') {
    if (settings.liqPalette) {
      document.documentElement.setAttribute('data-liq-palette', settings.liqPalette);
    }
    if (settings.candleMode) {
      document.documentElement.setAttribute('data-candle-mode', settings.candleMode);
    }
    if (settings.layerOpacity !== undefined) {
      document.documentElement.style.setProperty('--layer-opacity', String(settings.layerOpacity / 100));
    }
  }
}
