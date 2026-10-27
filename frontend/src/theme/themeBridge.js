import { THEMES, THEME_ALIASES, DEFAULT_THEME_ID } from './themeMeta.js';
import { getTierForWidth, calculateAutoScale } from './screenTiers.js';

const STORAGE_KEY = 'signalscript_theme_id';
const SCALE_KEY = 'signalscript_ui_scale';
const SCALE_MODE_KEY = 'signalscript_scale_mode';
const DENSITY_KEY = 'signalscript_ui_density';

class ThemeBridge {
  constructor() {
    this.currentTheme = DEFAULT_THEME_ID;
    this.tokens = {};
    this.subscribers = new Set();
    this.initialized = false;
    this.uiScale = 1.0;
    this.scaleMode = 'manual'; // 'manual' | 'auto'
    this.density = 'standard'; // 'compact' | 'standard' | 'spacious'
  }

  resolveThemeId(themeId) {
    if (!themeId) return DEFAULT_THEME_ID;
    const lower = String(themeId).toLowerCase();
    if (THEME_ALIASES[lower]) {
      return THEME_ALIASES[lower];
    }
    const found = THEMES.find((t) => t.id === lower);
    return found ? found.id : DEFAULT_THEME_ID;
  }

  init() {
    if (this.initialized || typeof window === 'undefined') return;
    
    // Read stored theme from localStorage or fallback
    let saved = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        const legacy = localStorage.getItem('slab_terminal_theme_settings');
        if (legacy) {
          const parsed = JSON.parse(legacy);
          saved = parsed.theme;
        }
      }
    } catch (_) {}

    const themeId = this.resolveThemeId(saved);
    this.setTheme(themeId, false);

    // Read stored scale & mode
    try {
      const mode = localStorage.getItem(SCALE_MODE_KEY);
      if (mode === 'auto') {
        this.scaleMode = 'auto';
        this.uiScale = calculateAutoScale(window.innerWidth);
      } else {
        const s = localStorage.getItem(SCALE_KEY);
        if (s) this.uiScale = Math.min(1.6, Math.max(0.7, parseFloat(s) || 1.0));
      }
    } catch (_) {}

    // Read stored density
    try {
      const d = localStorage.getItem(DENSITY_KEY);
      if (d && ['compact', 'standard', 'spacious'].includes(d)) {
        this.density = d;
      } else {
        const tier = getTierForWidth(window.innerWidth);
        this.density = tier.defaultDensity;
      }
    } catch (_) {}

    this.applyScaleAndDensityToDOM();
    this.initialized = true;
  }

  setTheme(themeId, persist = true) {
    const targetId = this.resolveThemeId(themeId);
    this.currentTheme = targetId;

    if (persist && typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, targetId);
      } catch (_) {}
    }

    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      root.setAttribute('data-theme', targetId);

      const themeMeta = THEMES.find((t) => t.id === targetId);
      const isDark = themeMeta ? themeMeta.isDark : true;
      if (isDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }

      requestAnimationFrame(() => {
        this.tokens = this.readTokensFromDOM();
        this.notifySubscribers();
      });
    }
  }

  getUiScale() {
    return this.uiScale || 1.0;
  }

  setUiScale(scale, persist = true) {
    const num = Math.min(1.6, Math.max(0.7, Number(scale) || 1.0));
    this.uiScale = Math.round(num * 100) / 100;
    this.scaleMode = 'manual';

    if (persist && typeof window !== 'undefined') {
      try {
        localStorage.setItem(SCALE_KEY, String(this.uiScale));
        localStorage.setItem(SCALE_MODE_KEY, 'manual');
      } catch (_) {}
    }

    this.applyScaleAndDensityToDOM();
  }

  getScaleMode() {
    return this.scaleMode;
  }

  setScaleMode(mode, persist = true) {
    this.scaleMode = mode === 'auto' ? 'auto' : 'manual';
    if (this.scaleMode === 'auto' && typeof window !== 'undefined') {
      this.uiScale = calculateAutoScale(window.innerWidth);
    }
    if (persist && typeof window !== 'undefined') {
      try {
        localStorage.setItem(SCALE_MODE_KEY, this.scaleMode);
        if (this.scaleMode === 'auto') {
          localStorage.setItem(SCALE_KEY, String(this.uiScale));
        }
      } catch (_) {}
    }
    this.applyScaleAndDensityToDOM();
  }

  getDensity() {
    return this.density;
  }

  setDensity(density, persist = true) {
    const valid = ['compact', 'standard', 'spacious'].includes(density) ? density : 'standard';
    this.density = valid;

    if (persist && typeof window !== 'undefined') {
      try {
        localStorage.setItem(DENSITY_KEY, valid);
      } catch (_) {}
    }

    this.applyScaleAndDensityToDOM();
  }

  applyScaleAndDensityToDOM() {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--ui-scale', String(this.uiScale));
    root.setAttribute('data-density', this.density);

    requestAnimationFrame(() => {
      this.tokens = this.readTokensFromDOM();
      this.notifySubscribers();
    });
  }

  readTokensFromDOM() {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return {
        bull: '#10b981',
        bear: '#f43f5e',
        bullSoft: 'rgba(16, 185, 129, 0.14)',
        bearSoft: 'rgba(244, 63, 94, 0.14)',
        densityWall: '#eab308',
        liqLong: '#3b82f6',
        liqShort: '#f97316',
        poc: '#eab308',
        vwap: '#a855f7',
        ema1: '#38bdf8',
        ema2: '#f59e0b',
        ema3: '#a855f7',
        gridLine: 'rgba(30, 36, 48, 0.45)',
        crosshair: '#3a4560',
        background: '#090b0e',
        foreground: '#d1d5db',
        border: '#1e2430',
        mutedForeground: '#717b8c',
        accent: '#192230',
        popover: '#11141a',
        success: '#10b981',
        warning: '#f59e0b',
        info: '#06b6d4',
        gridRgb: '30, 36, 48',
        gridOpacity: 0.35,
        uiScale: 1.0,
        density: 'standard',
      };
    }
    const style = getComputedStyle(document.documentElement);
    const getVal = (varName, fallback = '') => {
      const val = style.getPropertyValue(varName).trim();
      return val || fallback;
    };

    return {
      bull: getVal('--bull', '#10b981'),
      bear: getVal('--bear', '#f43f5e'),
      bullSoft: getVal('--bull-soft', 'rgba(16, 185, 129, 0.14)'),
      bearSoft: getVal('--bear-soft', 'rgba(244, 63, 94, 0.14)'),
      densityWall: getVal('--density-wall', '#eab308'),
      liqLong: getVal('--liq-long', '#3b82f6'),
      liqShort: getVal('--liq-short', '#f97316'),
      poc: getVal('--poc', '#eab308'),
      vwap: getVal('--vwap', '#a855f7'),
      ema1: getVal('--ema-1', '#38bdf8'),
      ema2: getVal('--ema-2', '#f59e0b'),
      ema3: getVal('--ema-3', '#a855f7'),
      gridLine: getVal('--grid-line', 'rgba(30, 36, 48, 0.45)'),
      crosshair: getVal('--crosshair', '#3a4560'),
      background: getVal('--background', '#090b0e'),
      foreground: getVal('--foreground', '#d1d5db'),
      border: getVal('--border', '#1e2430'),
      mutedForeground: getVal('--muted-foreground', '#717b8c'),
      accent: getVal('--accent', '#192230'),
      popover: getVal('--popover', '#11141a'),
      success: getVal('--success', '#10b981'),
      warning: getVal('--warning', '#f59e0b'),
      info: getVal('--info', '#06b6d4'),
      gridRgb: getVal('--grid-rgb', '30, 36, 48'),
      gridOpacity: parseFloat(getVal('--grid-opacity', '0.35')) || 0.35,
      uiScale: this.uiScale || 1.0,
      density: this.density || 'standard',
    };
  }

  getTokens() {
    if (!this.tokens || Object.keys(this.tokens).length === 0) {
      this.tokens = this.readTokensFromDOM();
    }
    return this.tokens;
  }

  getCurrentTheme() {
    return this.currentTheme;
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  notifySubscribers() {
    for (const callback of this.subscribers) {
      try {
        callback(this.tokens, this.currentTheme);
      } catch (e) {
        console.error('Error in theme subscriber:', e);
      }
    }
  }
}

export const themeBridge = new ThemeBridge();
export default themeBridge;

if (typeof window !== 'undefined') {
  themeBridge.init();
}
