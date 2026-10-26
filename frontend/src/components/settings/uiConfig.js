// UI-конфигурация терминала: дефолты, темы, шрифты, localStorage/DOM-синхронизация.
// Вынесено из SettingsModal.jsx (слайс 8, MODULARIZATION_PLAN п.8) — тела дословно, поведение 1:1.

export const DEFAULT_UI_CONFIG = {
  theme: 'tealstreet', // 'tealstreet' | 'tiger' | 'bloomberg'
  fontFamily: 'JetBrains Mono', // 'JetBrains Mono' | 'Roboto Mono' | 'Fira Code' | 'Consolas'
  gridOpacity: 0.22, // 0.05 .. 0.60
  candleOpacity: 1.0, // 0.40 .. 1.00
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
  pricePrecision: 'auto', // 'auto' | 1 | 2 | 4 | 6
  tickStep: 1, // 1 | 2 | 5 | 10 | 50 | 100
  densityThresholdUsd: 50000,
  tapeMinUsd: 5000,
  wallLifetimeSec: 60,
  spoofDistancePct: 0.35,
  fillRatio: 0.5
};

export const THEME_PRESETS = {
  tealstreet: {
    id: 'tealstreet',
    name: 'Tealstreet Pro',
    badge: 'Default',
    desc: 'Глубокий тёмно-серый графит (#08090c), приглушённые свечи, тонкая сетка.',
    bgRoot: '#08090c',
    bgPanel: '#0c0e12',
    bgHeader: '#101217',
    border: '#161820',
    textMain: '#d1d4dc',
    bull: '#26a69a',
    bear: '#ef5350',
    accent: '#38bdf8',
    gridRgb: '22, 26, 38'
  },
  tiger: {
    id: 'tiger',
    name: 'Tiger Deep Dark',
    badge: 'Pro Flow',
    desc: 'Ультратёмный обсидиан (#030406), контрастные уровни, неоновая подсветка объёмов.',
    bgRoot: '#030406',
    bgPanel: '#06080c',
    bgHeader: '#0a0d14',
    border: '#141c2b',
    textMain: '#e2e8f0',
    bull: '#00f5d4',
    bear: '#ff2a6d',
    accent: '#00e5ff',
    gridRgb: '0, 229, 255'
  },
  bloomberg: {
    id: 'bloomberg',
    name: 'Bloomberg Terminal',
    badge: 'Amber',
    desc: 'Классический янтарно-чёрный монохром (#000000), высокая контрастность цифр.',
    bgRoot: '#000000',
    bgPanel: '#050505',
    bgHeader: '#0c0b08',
    border: '#332400',
    textMain: '#ff9800',
    bull: '#00e676',
    bear: '#ff3d00',
    accent: '#fbbf24',
    gridRgb: '255, 152, 0'
  }
};

export const MONO_FONTS = [
  { id: 'JetBrains Mono', label: 'JetBrains Mono', stack: "'JetBrains Mono', Consolas, monospace" },
  { id: 'Roboto Mono', label: 'Roboto Mono', stack: "'Roboto Mono', Consolas, monospace" },
  { id: 'Fira Code', label: 'Fira Code', stack: "'Fira Code', Consolas, monospace" },
  { id: 'Consolas', label: 'Consolas', stack: "Consolas, 'Courier New', monospace" }
];

export function loadLocalUiConfig() {
  try {
    const raw = localStorage.getItem('signalscript_ui_config');
    const savedTheme = localStorage.getItem('signalscript_theme');
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      ...DEFAULT_UI_CONFIG,
      ...parsed,
      theme: parsed.theme || savedTheme || DEFAULT_UI_CONFIG.theme,
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

export function applyUiConfigToDOM(cfg) {
  if (typeof document === 'undefined') return;
  const merged = { ...DEFAULT_UI_CONFIG, ...(cfg || {}) };
  const preset = THEME_PRESETS[merged.theme] || THEME_PRESETS.tealstreet;
  const root = document.documentElement;

  root.setAttribute('data-theme', preset.id);
  root.style.setProperty('--bg-root', preset.bgRoot);
  root.style.setProperty('--bg-panel', preset.bgPanel);
  root.style.setProperty('--bg-panel-header', preset.bgHeader);
  root.style.setProperty('--border-subtle', preset.border);
  root.style.setProperty('--text-main', preset.textMain);
  root.style.setProperty('--color-bull', preset.bull);
  root.style.setProperty('--color-bear', preset.bear);
  root.style.setProperty('--color-accent', preset.accent);
  root.style.setProperty('--grid-rgb', preset.gridRgb);
  root.style.setProperty('--grid-opacity', String(merged.gridOpacity ?? 0.22));
  root.style.setProperty('--candle-opacity', String(merged.candleOpacity ?? 1.0));

  const fontObj = MONO_FONTS.find(f => f.id === merged.fontFamily) || MONO_FONTS[0];
  root.style.setProperty('--font-mono', fontObj.stack);

  try {
    localStorage.setItem('signalscript_ui_config', JSON.stringify(merged));
    localStorage.setItem('signalscript_theme', preset.id);
  } catch (_) {}
}
