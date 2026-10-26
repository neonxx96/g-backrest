import { THEMES, THEME_ALIASES, DEFAULT_THEME_ID } from './themeMeta.js';

const STORAGE_KEY = 'signalscript_theme_id';

class ThemeBridge {
  constructor() {
    this.currentTheme = DEFAULT_THEME_ID;
    this.tokens = {};
    this.subscribers = new Set();
    this.initialized = false;
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
        // Check older storage key
        const legacy = localStorage.getItem('slab_terminal_theme_settings');
        if (legacy) {
          const parsed = JSON.parse(legacy);
          saved = parsed.theme;
        }
      }
    } catch (e) {
      // storage unavailable
    }

    const themeId = this.resolveThemeId(saved);
    this.setTheme(themeId, false);
    this.initialized = true;
  }

  setTheme(themeId, persist = true) {
    const targetId = this.resolveThemeId(themeId);
    this.currentTheme = targetId;

    if (persist && typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, targetId);
      } catch (e) {
        // ignore
      }
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

      // Read computed tokens on the next animation frame once DOM applies styles
      requestAnimationFrame(() => {
        this.tokens = this.readTokensFromDOM();
        this.notifySubscribers();
      });
    }
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
      crosshair: getVal('--crosshair', '#475569'),
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

if (typeof window !== 'undefined') {
  themeBridge.init();
}
