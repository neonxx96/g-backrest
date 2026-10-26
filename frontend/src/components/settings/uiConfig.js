import { THEMES, THEME_ALIASES } from '../../theme/themeMeta.js';
import { themeBridge } from '../../theme/themeBridge.js';

export const DEFAULT_UI_CONFIG = {
  theme: 'night', // 'night' | 'neon' | 'mono' | 'day'
  fontFamily: 'IBM Plex Mono',
  gridOpacity: 0.22,
  candleOpacity: 1.0,
  emaEnabled: true,
  emaPeriods: [9, 21, 50],
  emaColors: ['#38bdf8', '#f59e0b', '#a855f7'],
  emaWidth: 1.5,
  subpanes: {
    vol: true,
    cvd: true,
    rsi: false,
    macd: false
  },
  pricePrecision: 'auto',
  tickStep: 1,
  densityThresholdUsd: 50000,
  tapeMinUsd: 5000,
  wallLifetimeSec: 60,
  spoofDistancePct: 0.35,
  fillRatio: 0.5
};

export const THEME_PRESETS = {
  night: {
    id: 'night',
    name: 'Ночная',
    badge: 'По умолчанию',
    desc: 'Сине-графитовая тёмная тема, спокойный контраст, акцент циан.',
    bgRoot: '#090b0e',
    bgPanel: '#0d1015',
    textMain: '#d1d5db',
    bull: '#10b981',
    bear: '#f43f5e',
    accent: '#06b6d4',
  },
  neon: {
    id: 'neon',
    name: 'Яркая',
    badge: 'Скальпинг',
    desc: 'Глубокий чёрный фон, насыщенные кислотные ликвидации и сигналы.',
    bgRoot: '#040507',
    bgPanel: '#080a0f',
    textMain: '#f1f5f9',
    bull: '#00f5d4',
    bear: '#ff2a6d',
    accent: '#00f0ff',
  },
  mono: {
    id: 'mono',
    name: 'Монохромная',
    badge: 'Минимализм',
    desc: 'Шкала нейтральных серых тонов, контраст яркостью, акцент янтарь.',
    bgRoot: '#0b0c0e',
    bgPanel: '#111215',
    textMain: '#e4e4e7',
    bull: '#10b981',
    bear: '#f43f5e',
    accent: '#f59e0b',
  },
  day: {
    id: 'day',
    name: 'Дневная',
    badge: 'Светлая',
    desc: 'Мягкий светлый фон, сбалансированная контрастность без слепящего белого.',
    bgRoot: '#f8fafc',
    bgPanel: '#ffffff',
    textMain: '#0f172a',
    bull: '#059669',
    bear: '#e11d48',
    accent: '#0284c7',
  },
};

export const MONO_FONTS = [
  { id: 'IBM Plex Mono', name: 'IBM Plex Mono (Стандарт)', sample: '1,234.50' },
  { id: 'JetBrains Mono', name: 'JetBrains Mono', sample: '1,234.50' },
  { id: 'Roboto Mono', name: 'Roboto Mono', sample: '1,234.50' },
  { id: 'Consolas', name: 'Consolas', sample: '1,234.50' }
];

export function applyTheme(themeId) {
  const resolved = themeBridge.resolveThemeId(themeId);
  themeBridge.setTheme(resolved, true);
}

export function applyUiConfigToDOM(cfg) {
  if (typeof document === 'undefined') return;
  const merged = { ...DEFAULT_UI_CONFIG, ...(cfg || {}) };
  const resolvedTheme = themeBridge.resolveThemeId(merged.theme);
  themeBridge.setTheme(resolvedTheme, false);

  const root = document.documentElement;
  root.style.setProperty('--grid-opacity', String(merged.gridOpacity ?? 0.22));
  root.style.setProperty('--candle-opacity', String(merged.candleOpacity ?? 1.0));

  try {
    localStorage.setItem('signalscript_ui_config', JSON.stringify(merged));
  } catch (_) {}
}

export function loadLocalUiConfig() {
  try {
    const raw = localStorage.getItem('signalscript_ui_config');
    const savedTheme = localStorage.getItem('signalscript_theme');
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      ...DEFAULT_UI_CONFIG,
      ...parsed,
      theme: themeBridge.resolveThemeId(parsed.theme || savedTheme || DEFAULT_UI_CONFIG.theme),
      subpanes: {
        ...DEFAULT_UI_CONFIG.subpanes,
        ...(parsed.subpanes || {})
      },
      emaPeriods: Array.isArray(parsed.emaPeriods) && parsed.emaPeriods.length === 3
        ? parsed.emaPeriods
        : DEFAULT_UI_CONFIG.emaPeriods,
      emaColors: Array.isArray(parsed.emaColors) && parsed.emaColors.length === 3
        ? parsed.emaColors
        : DEFAULT_UI_CONFIG.emaColors
    };
  } catch (_) {
    return { ...DEFAULT_UI_CONFIG };
  }
}
