// Стили графика KLineCharts.
// Цвета и токены берутся динамически из themeBridge (единый источник правды).
import { themeBridge } from '../../theme/themeBridge.js';

function hexToRgba(hex, alpha = 1) {
  if (!hex || typeof hex !== 'string') return hex;
  if (!hex.startsWith('#')) {
    if (hex.startsWith('rgba') || hex.startsWith('rgb')) {
      return hex;
    }
    return hex;
  }
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return hex;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Базовые тёмные токены терминала (общие для графиков).
const DARK = {
  border: '#1f2638',
  crosshair: '#3a4560',
  label: '#141a26',
  text: '#9ca3af'
};

export function buildChartStyles(uiConfig = {}) {
  const tokens = themeBridge.getTokens();
  const gridOpacity = uiConfig.gridOpacity ?? tokens.gridOpacity ?? 0.22;
  const candleOpacity = uiConfig.candleOpacity ?? 1.0;
  const emaColors = uiConfig.emaColors || [tokens.ema1 || '#38bdf8', tokens.ema2 || '#f59e0b', tokens.ema3 || '#a855f7'];
  const emaWidth = uiConfig.emaWidth ?? 1.5;

  const bull = tokens.bull || '#10b981';
  const bear = tokens.bear || '#f43f5e';
  const gridRgb = tokens.gridRgb || '30, 36, 48';
  const tickColor = tokens.mutedForeground || '#60697b';

  const gridColor = `rgba(${gridRgb}, ${gridOpacity})`;
  const upCol = hexToRgba(bull, candleOpacity);
  const dnCol = hexToRgba(bear, candleOpacity);

  return {
    grid: {
      show: true,
      horizontal: { color: gridColor, style: 'dash', size: 1, dashedValue: [2, 4] },
      vertical: { color: gridColor, style: 'dash', size: 1, dashedValue: [2, 4] }
    },
    candle: {
      type: 'candle_solid',
      tooltip: { text: { color: tokens.foreground || DARK.text, size: 11, family: 'var(--font-mono)' } },
      bar: {
        upColor: upCol,
        downColor: dnCol,
        noChangeColor: '#787f91',
        upBorderColor: bull,
        downBorderColor: bear,
        noChangeBorderColor: '#787f91',
        upWickColor: bull,
        downWickColor: bear,
        noChangeWickColor: '#787f91'
      },
      priceMark: {
        show: true,
        high: { show: true, color: tickColor, textSize: 10 },
        low: { show: true, color: tickColor, textSize: 10 },
        last: {
          show: true,
          upColor: bull,
          downColor: bear,
          noChangeColor: '#787f91',
          line: { show: true, style: 'dash', dashedValue: [3, 3], size: 1 },
          text: { show: true, color: '#ffffff', size: 11, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 }
        }
      }
    },
    indicator: {
      tooltip: { text: { color: tokens.foreground || DARK.text, size: 11, family: 'var(--font-mono)' } },
      bars: [{
        style: 'fill',
        borderStyle: 'solid',
        borderSize: 1,
        borderDashedValue: [2, 2],
        upColor: hexToRgba(bull, 0.7),
        downColor: hexToRgba(bear, 0.7),
        noChangeColor: '#888888'
      }],
      lines: [
        { style: 'solid', smooth: false, size: emaWidth, dashedValue: [2, 2], color: emaColors[0] },
        { style: 'solid', smooth: false, size: emaWidth, dashedValue: [2, 2], color: emaColors[1] },
        { style: 'solid', smooth: false, size: emaWidth, dashedValue: [2, 2], color: emaColors[2] }
      ]
    },
    xAxis: {
      tickText: { color: tickColor, size: 10, family: 'var(--font-mono)' },
      axisLine: { color: tokens.border || DARK.border, size: 1 }
    },
    yAxis: {
      tickText: { color: tickColor, size: 10, family: 'var(--font-mono)' },
      axisLine: { color: tokens.border || DARK.border, size: 1 }
    },
    separator: {
      size: 1,
      color: DARK.border,
      fill: true,
      activeBackgroundColor: 'rgba(56, 189, 248, 0.15)'
    },
    crosshair: {
      show: true,
      horizontal: {
        show: true,
        line: { show: true, style: 'dash', dashedValue: [4, 4], size: 1, color: tokens.crosshair || DARK.crosshair },
        text: {
          show: true,
          color: '#ffffff',
          size: 10,
          family: 'var(--font-mono)',
          paddingLeft: 4,
          paddingRight: 4,
          paddingTop: 2,
          paddingBottom: 2,
          borderSize: 1,
          borderColor: tokens.border || DARK.border,
          borderRadius: 2,
          backgroundColor: DARK.label
        }
      },
      vertical: {
        show: true,
        line: { show: true, style: 'dash', dashedValue: [4, 4], size: 1, color: tokens.crosshair || DARK.crosshair },
        text: {
          show: true,
          color: '#ffffff',
          size: 10,
          family: 'var(--font-mono)',
          paddingLeft: 4,
          paddingRight: 4,
          paddingTop: 2,
          paddingBottom: 2,
          borderSize: 1,
          borderColor: tokens.border || DARK.border,
          borderRadius: 2,
          backgroundColor: DARK.label
        }
      }
    }
  };
}
