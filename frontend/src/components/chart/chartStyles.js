// Стили графика KLineCharts (темы tealstreet/tiger/bloomberg).
// Извлечено ДОСЛОВНО из Chart.jsx (слайс 6.4l, п.1 MODULARIZATION_PLAN):
// hexToRgba + buildChartStyles — без изменений тел. Импортёры: Chart.jsx,
// chart/useChartLifecycle.js (apply initial theme styles).

function hexToRgba(hex, alpha = 1) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return hex;
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return hex;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function buildChartStyles(uiConfig = {}) {
  const theme = uiConfig.theme || 'tealstreet';
  const gridOpacity = uiConfig.gridOpacity ?? 0.22;
  const candleOpacity = uiConfig.candleOpacity ?? 1.0;
  const emaColors = uiConfig.emaColors || ['#38bdf8', '#f59e0b', '#a855f7'];
  const emaWidth = uiConfig.emaWidth ?? 1.5;

  const palette = theme === 'tiger'
    ? { bull: '#00f5d4', bear: '#ff2a6d', gridRgb: '0, 229, 255', axis: '#141c2b', tick: '#64748b' }
    : theme === 'bloomberg'
    ? { bull: '#00e676', bear: '#ff3d00', gridRgb: '255, 152, 0', axis: '#332400', tick: '#b45309' }
    : { bull: '#26a69a', bear: '#ef5350', gridRgb: '120, 135, 165', axis: '#161922', tick: '#60697b' };

  const gridColor = `rgba(${palette.gridRgb}, ${gridOpacity})`;
  const upCol = hexToRgba(palette.bull, candleOpacity);
  const dnCol = hexToRgba(palette.bear, candleOpacity);

  return {
    grid: {
      show: true,
      horizontal: { color: gridColor, style: 'dash', size: 1, dashedValue: [2, 4] },
      vertical: { color: gridColor, style: 'dash', size: 1, dashedValue: [2, 4] }
    },
    candle: {
      type: 'candle_solid',
      bar: {
        upColor: upCol,
        downColor: dnCol,
        noChangeColor: '#787f91',
        upBorderColor: palette.bull,
        downBorderColor: palette.bear,
        noChangeBorderColor: '#787f91',
        upWickColor: palette.bull,
        downWickColor: palette.bear,
        noChangeWickColor: '#787f91'
      },
      priceMark: {
        show: true,
        high: { show: true, color: palette.tick, textSize: 10 },
        low: { show: true, color: palette.tick, textSize: 10 },
        last: {
          show: true,
          upColor: palette.bull,
          downColor: palette.bear,
          noChangeColor: '#787f91',
          line: { show: true, style: 'dash', dashedValue: [3, 3], size: 1 },
          text: { show: true, color: '#ffffff', size: 11, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 }
        }
      }
    },
    indicator: {
      bars: [{
        style: 'fill',
        borderStyle: 'solid',
        borderSize: 1,
        upColor: hexToRgba(palette.bull, 0.28),
        downColor: hexToRgba(palette.bear, 0.28),
        noChangeColor: 'rgba(120, 127, 145, 0.25)'
      }],
      lines: [
        { style: 'solid', smooth: false, size: emaWidth, color: emaColors[0] || '#38bdf8', dashedValue: [2, 2] },
        { style: 'solid', smooth: false, size: emaWidth, color: emaColors[1] || '#f59e0b', dashedValue: [2, 2] },
        { style: 'solid', smooth: false, size: emaWidth, color: emaColors[2] || '#a855f7', dashedValue: [2, 2] }
      ]
    },
    xAxis: {
      axisLine: { show: true, color: palette.axis },
      tickLine: { show: true, color: palette.axis },
      tickText: { color: palette.tick, size: 10, family: 'var(--font-mono)' }
    },
    yAxis: {
      axisLine: { show: true, color: palette.axis },
      tickLine: { show: true, color: palette.axis },
      tickText: { color: palette.tick, size: 10, family: 'var(--font-mono)' }
    },
    crosshair: {
      show: true,
      horizontal: { show: true, line: { color: '#2a3142', style: 'dash', dashedValue: [3, 3] }, text: { color: '#ffffff', backgroundColor: '#181c26' } },
      vertical: { show: true, line: { color: '#2a3142', style: 'dash', dashedValue: [3, 3] }, text: { color: '#ffffff', backgroundColor: '#181c26' } }
    }
  };
}
