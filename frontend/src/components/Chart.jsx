import React, { useEffect, useRef, useState, useCallback } from 'react';
import { init, dispose, registerOverlay, registerIndicator } from 'klinecharts';
import { 
  Minus, 
  MoveRight, 
  Square, 
  Hash, 
  Trash2, 
  Magnet, 
  Save,
  Ruler,
  TrendingUp,
  X,
  RotateCcw,
  Eye,
  Check,
  BarChart3,
  Loader2
} from 'lucide-react';

const API_BASE = "/api";

// 1. Register custom 'rect' (Zone/Imbalance box) overlay
try {
  registerOverlay({
    name: 'rect',
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates }) => {
      if (coordinates && coordinates.length > 1) {
        const x = Math.min(coordinates[0].x, coordinates[1].x);
        const y = Math.min(coordinates[0].y, coordinates[1].y);
        const width = Math.abs(coordinates[0].x - coordinates[1].x);
        const height = Math.abs(coordinates[0].y - coordinates[1].y);
        return [
          {
            type: 'polygon',
            attrs: {
              coordinates: [
                { x, y },
                { x: x + width, y },
                { x: x + width, y: y + height },
                { x, y: y + height }
              ]
            },
            styles: {
              style: 'stroke_fill',
              color: 'rgba(38, 166, 154, 0.12)',
              borderColor: '#26a69a',
              borderSize: 1
            }
          }
        ];
      }
      return [];
    }
  });
} catch (_) {}

// 2. Register custom 'measure' (Ruler: Price Diff & % Change) overlay
try {
  registerOverlay({
    name: 'measure',
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates && coordinates.length > 1 && overlay.points && overlay.points.length > 1) {
        const p1 = overlay.points[0];
        const p2 = overlay.points[1];
        const x = Math.min(coordinates[0].x, coordinates[1].x);
        const y = Math.min(coordinates[0].y, coordinates[1].y);
        const width = Math.abs(coordinates[0].x - coordinates[1].x);
        const height = Math.abs(coordinates[0].y - coordinates[1].y);

        const v1 = Number(p1.value) || 0;
        const v2 = Number(p2.value) || 0;
        const priceDiff = v2 - v1;
        const pctDiff = v1 !== 0 ? ((priceDiff / v1) * 100) : 0;
        const isUp = priceDiff >= 0;
        const fillColor = isUp ? 'rgba(38, 166, 154, 0.16)' : 'rgba(239, 83, 80, 0.16)';
        const strokeColor = isUp ? '#26a69a' : '#ef5350';
        const sign = isUp ? '+' : '';
        const labelText = `${sign}${priceDiff.toFixed(2)} (${sign}${pctDiff.toFixed(2)}%)`;

        return [
          {
            type: 'polygon',
            attrs: {
              coordinates: [
                { x, y },
                { x: x + width, y },
                { x: x + width, y: y + height },
                { x, y: y + height }
              ]
            },
            styles: {
              style: 'stroke_fill',
              color: fillColor,
              borderColor: strokeColor,
              borderSize: 1,
              borderStyle: 'dashed'
            }
          },
          {
            type: 'text',
            attrs: {
              x: coordinates[1].x,
              y: coordinates[1].y - (isUp ? 10 : -16),
              text: labelText,
              align: 'center'
            },
            styles: {
              color: '#ffffff',
              backgroundColor: strokeColor,
              padding: 4,
              borderRadius: 2
            }
          }
        ];
      }
      return [];
    }
  });
} catch (_) {}

// 2b. Register custom 'btSignal' (Backtest BUY/SELL markers)
try {
  registerOverlay({
    name: 'btSignal',
    totalStep: 2,
    lock: true,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, overlay }) => {
      if (!coordinates || coordinates.length === 0) return [];
      const { x, y } = coordinates[0];
      const ext = overlay.extendData || {};
      const isBuy = ext.type === 'BUY';
      const color = isBuy ? '#26a69a' : '#ef5350';
      const gap = 5;   // pixels between candle extreme and arrow
      const h = 11;
      const w = 7;
      const tri = isBuy
        // arrow pointing up, strictly below the candle low
        ? [{ x, y: y + gap }, { x: x - w, y: y + gap + h }, { x: x + w, y: y + gap + h }]
        // arrow pointing down, strictly above the candle high
        : [{ x, y: y - gap }, { x: x - w, y: y - gap - h }, { x: x + w, y: y - gap - h }];
      const textY = isBuy ? y + gap + h + 4 : y - gap - h - 4;
      return [
        {
          type: 'polygon',
          attrs: { coordinates: tri },
          styles: { style: 'stroke_fill', color, borderColor: '#ffffff', borderSize: 0.5 },
          ignoreEvent: false
        },
        {
          type: 'text',
          attrs: {
            x,
            y: textY,
            text: Number(ext.price || 0).toFixed(ext.price >= 100 ? 1 : 4),
            align: 'center',
            baseline: isBuy ? 'top' : 'bottom'
          },
          styles: { color, size: 9, backgroundColor: 'transparent' },
          ignoreEvent: true
        }
      ];
    }
  });
} catch (_) {}

// 3. Register custom 'liqMarker' (Live Liquidations on Chart)
try {
  registerOverlay({
    name: 'liqMarker',
    totalStep: 2,
    lock: true,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, overlay }) => {
      if (!coordinates || coordinates.length === 0) return [];
      const { x, y } = coordinates[0];
      const side = overlay.extendData?.side || 'BUY';
      const usd = Number(overlay.extendData?.usd_amount || 0);
      const isShortLiq = side === 'BUY'; // Buy liquidation order = short position got liquidated
      const color = isShortLiq ? '#00e676' : '#ff1744';
      const radius = Math.min(13, Math.max(5, Math.log10(Math.max(1000, usd)) * 2.2));
      const usdFormatted = usd >= 1000000 ? `$${(usd / 1000000).toFixed(2)}M` : `$${Math.round(usd / 1000)}k`;
      const labelText = isShortLiq ? `💀 SHORT ${usdFormatted}` : `💀 LONG ${usdFormatted}`;

      const figures = [
        // Outer glowing halo
        {
          type: 'circle',
          attrs: { x, y, r: radius + 4 },
          styles: {
            style: 'stroke_fill',
            color: isShortLiq ? 'rgba(0, 230, 118, 0.22)' : 'rgba(255, 23, 68, 0.22)',
            borderColor: color,
            borderSize: 1.5
          }
        },
        // Inner bright core
        {
          type: 'circle',
          attrs: { x, y, r: radius * 0.55 },
          styles: {
            style: 'fill',
            color
          }
        }
      ];

      // Pill label for liquidations >= $20k
      if (usd >= 20000) {
        figures.push({
          type: 'text',
          attrs: {
            x,
            y: y - radius - 5,
            text: ` ${labelText} `,
            align: 'center',
            baseline: 'bottom'
          },
          styles: {
            color: '#ffffff',
            backgroundColor: isShortLiq ? '#059669' : '#dc2626',
            borderColor: color,
            borderSize: 0.5,
            size: 9.5,
            padding: 2.5,
            borderRadius: 2
          }
        });
      }

      return figures;
    }
  });
} catch (_) {}

// 4. Register custom 'densityHeatmap' (Clean Orderbook Density Line/Shelf)
try {
  registerOverlay({
    name: 'densityHeatmap',
    totalStep: 2,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, overlay }) => {
      if (!coordinates || coordinates.length === 0) return [];
      const { x, y } = coordinates[0];
      const side = overlay.extendData?.side || 'bid';
      const volUsd = overlay.extendData?.volume_usd || 0;
      const isBid = side === 'bid';
      const alpha = Math.min(0.40, Math.max(0.12, (volUsd / 600000) * 0.35));
      const color = isBid ? `rgba(38, 166, 154, ${alpha})` : `rgba(239, 83, 80, ${alpha})`;
      const width = 28;
      const height = 2;
      return [
        {
          type: 'rect',
          attrs: {
            x: x - width / 2,
            y: y - height / 2,
            width,
            height
          },
          styles: {
            style: 'fill',
            color
          }
        }
      ];
    }
  });
} catch (_) {}

// 5. Register custom 'strategyLevelZone' (Strategy Entry Zone + Badge)
try {
  registerOverlay({
    name: 'strategyLevelZone',
    totalStep: 2,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, bounding, overlay }) => {
      if (!coordinates || coordinates.length === 0) return [];
      const { y } = coordinates[0];
      const ext = overlay.extendData || {};
      const isBuy = ext.type === 'BUY' || ext.side === 'BUY';
      const label = ext.label || (isBuy ? 'BUY ZONE: Wall $1.2M' : 'SHORT: Delta Div');
      const color = isBuy ? '#26a69a' : '#ef5350';
      const fillColor = isBuy ? 'rgba(38, 166, 154, 0.16)' : 'rgba(239, 83, 80, 0.16)';
      const width = (bounding && bounding.width) ? bounding.width : 2200;
      const zoneHeight = 16;
      return [
        {
          type: 'rect',
          attrs: {
            x: 0,
            y: y - zoneHeight / 2,
            width,
            height: zoneHeight
          },
          styles: {
            style: 'fill',
            color: fillColor
          }
        },
        {
          type: 'line',
          attrs: {
            coordinates: [
              { x: 0, y },
              { x: width, y }
            ]
          },
          styles: {
            color,
            size: 1.5,
            style: 'dashed'
          }
        },
        {
          type: 'text',
          attrs: {
            x: 18,
            y: y - 8,
            text: ` ${label} `,
            align: 'left',
            baseline: 'middle'
          },
          styles: {
            color: '#ffffff',
            backgroundColor: color,
            size: 9.5,
            padding: 3,
            borderRadius: 2
          }
        }
      ];
    }
  });
} catch (_) {}

// 6. Register custom 'orderbookWall' (OrderBook Densities > $1M with right-aligned badge)
try {
  registerOverlay({
    name: 'orderbookWall',
    totalStep: 2,
    lock: true,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, bounding, overlay }) => {
      if (!coordinates || coordinates.length === 0) return [];
      const { y } = coordinates[0];
      const ext = overlay.extendData || {};
      const isBuy = ext.side === 'BUY' || ext.side === 'bid';
      const volUsd = ext.volume_usd || 0;
      const volFormatted = volUsd >= 1000000 
        ? `$${(volUsd / 1000000).toFixed(2)}M` 
        : `$${Math.round(volUsd / 1000)}k`;
      const badgeText = isBuy ? `[BUY WALL ${volFormatted}]` : `[SELL WALL ${volFormatted}]`;
      const color = isBuy ? '#26a69a' : '#ef5350';
      const width = (bounding && bounding.width) ? bounding.width : 2200;

      return [
        {
          type: 'line',
          attrs: {
            coordinates: [
              { x: 0, y },
              { x: width, y }
            ]
          },
          styles: {
            color,
            size: 1.5,
            style: 'solid'
          }
        },
        {
          type: 'text',
          attrs: {
            x: Math.max(100, width - 12),
            y: y,
            text: ` ${badgeText} `,
            align: 'right',
            baseline: 'middle'
          },
          styles: {
            color: '#ffffff',
            backgroundColor: color,
            size: 10,
            padding: 3,
            borderRadius: 2
          }
        }
      ];
    }
  });
} catch (_) {}

// 5. Register custom 'CVD' (Cumulative Volume Delta) sub-pane indicator
try {
  registerIndicator({
    name: 'CVD',
    shortName: 'CVD (Дельта)',
    shouldFormatBigNumber: true,
    precision: 1,
    figures: [
      {
        key: 'delta',
        title: 'Δ: ',
        type: 'bar',
        baseValue: 0,
        styles: (data) => {
          const d = data.current?.indicatorData?.delta ?? 0;
          return {
            color: d >= 0 ? 'rgba(38, 166, 154, 0.55)' : 'rgba(239, 83, 80, 0.55)'
          };
        }
      },
      {
        key: 'cvd',
        title: 'CVD: ',
        type: 'line',
        styles: () => ({ color: '#38bdf8', size: 1.5 })
      }
    ],
    calc: (dataList) => {
      let cum = 0;
      return dataList.map(k => {
        const rng = Math.max(1e-9, (k.high || 0) - (k.low || 0));
        const buyRatio = ((k.close || 0) - (k.low || 0)) / rng;
        const delta = (2 * buyRatio - 1) * (k.volume || 0);
        cum += delta;
        return { delta, cvd: cum };
      });
    }
  });
} catch (_) {}

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

function buildChartStyles(uiConfig = {}) {
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
        { style: 'solid', size: emaWidth, color: emaColors[0] || '#38bdf8' },
        { style: 'solid', size: emaWidth, color: emaColors[1] || '#f59e0b' },
        { style: 'solid', size: emaWidth, color: emaColors[2] || '#a855f7' }
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

const USER_DRAWING_TYPES = new Set([
  'segment', 'straightLine', 'horizontalStraightLine', 'verticalStraightLine',
  'rayLine', 'arrow', 'priceLine', 'priceCoordinate', 'rect', 'fibonacciLine', 'measure'
]);

export default function Chart({ 
  chartId = "primary", 
  symbol = "BTCUSDT", 
  timeframe = "15m", 
  userId = "0", 
  titlePrefix = "", 
  onTimeframeChange,
  backtestSignals = null,
  showBacktestSignals = true,
  strategyLevels = [],
  uiConfig = null
}) {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const wsRef = useRef(null);
  const selectedOverlayId = useRef(null);
  const trackedOverlays = useRef(new Map()); // id -> overlay data
  const drawingHistory = useRef([]); // history stack of overlay IDs for Ctrl+Z undo
  const btOverlayIds = useRef([]); // backtest signal overlays (never saved as drawings)
  const activeStrategyLevelOverlays = useRef([]); // strategy entry zones (never saved as drawings)
  const lastScrolledResult = useRef(null);
  const [klinesVersion, setKlinesVersion] = useState(0);
  const [btTooltip, setBtTooltip] = useState(null);
  
  const prevSymbolRef = useRef(symbol);
  const prevTimeframeRef = useRef(timeframe);

  const [chartReady, setChartReady] = useState(0);
  const [activeTool, setActiveTool] = useState(null);
  const [magnetEnabled, setMagnetEnabled] = useState(false);
  const [indicators, setIndicators] = useState({
    ema: uiConfig?.emaEnabled !== false,
    vol: uiConfig?.subpanes?.vol !== false,
    cvd: Boolean(uiConfig?.subpanes?.cvd),
    rsi: Boolean(uiConfig?.subpanes?.rsi),
    macd: Boolean(uiConfig?.subpanes?.macd),
    vwap: false
  });
  const [statusMsg, setStatusMsg] = useState("");
  const [errorDetails, setErrorDetails] = useState(null);

  // Stage 3: Heatmap (default OFF for clean chart), Liquidations, VWAP, Storage info
  const [showHeatmap, setShowHeatmap] = useState(() => localStorage.getItem('chart_heatmap') === 'true');
  const [showLiquidations, setShowLiquidations] = useState(() => localStorage.getItem('chart_liquidations') !== 'false');
  const [showVwap, setShowVwap] = useState(() => localStorage.getItem('chart_vwap') === 'true');
  const [showWalls, setShowWalls] = useState(() => localStorage.getItem('chart_walls') !== 'false');
  const [minLiqUsd, setMinLiqUsd] = useState(20000);
  const [heatmapMinUsd, setHeatmapMinUsd] = useState(50000);
  const [storageInfo, setStorageInfo] = useState({ earliest: '', usage: '' });
  const activeLiqOverlays = useRef([]);
  const activeHeatmapOverlays = useRef([]);
  const activeWallOverlays = useRef([]);
  const vwapLineOverlay = useRef(null);
  const currentKlines = useRef([]);

  // Context Menu & Level Inspector State (ТАКТ 3)
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, price: null });
  const [levelInspectorData, setLevelInspectorData] = useState(null);
  const [inspectingLevel, setInspectingLevel] = useState(false);

  const handleInspectLevel = useCallback(async (targetPrice) => {
    let p = targetPrice;
    if (!p && currentKlines.current.length > 0) {
      p = currentKlines.current[currentKlines.current.length - 1].close;
    }
    if (!p) return;
    setInspectingLevel(true);
    setStatusMsg(`Анализ отскоков от $${p.toFixed(1)}...`);
    try {
      const res = await fetch(`${API_BASE}/backtest/inspect-level`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          timeframe,
          price: Number(p),
          days: 14,
          tolerance_pct: 0.35
        })
      });
      if (res.ok) {
        const data = await res.json();
        setLevelInspectorData(data);
        setStatusMsg(`Уровень $${p.toFixed(1)}: ${data.bounce_winrate_pct}% отскоков`);
      } else {
        setStatusMsg("Ошибка анализа уровня");
      }
    } catch (err) {
      console.error('Inspect level error:', err);
      setStatusMsg("Сбой запроса анализа уровня");
    } finally {
      setInspectingLevel(false);
      setTimeout(() => setStatusMsg(""), 2500);
    }
  }, [symbol, timeframe]);

  // Initialize KLineChart instance with ResizeObserver (ТАКТ 1)
  useEffect(() => {
    if (!chartContainerRef.current) return;
    
    try {
      dispose(chartContainerRef.current);
    } catch (_) {}

    const chart = init(chartContainerRef.current);
    chartRef.current = chart;
    window.__chart = chart;

    // Apply initial theme styles
    chart.setStyles(buildChartStyles(uiConfig || {}));

    // Set timezone to Europe/Kyiv
    try {
      chart.setTimezone('Europe/Kyiv');
    } catch (e) {
      console.warn("Timezone set warning:", e);
    }

    // Default indicators based on initial uiConfig
    try {
      if (uiConfig?.emaEnabled !== false) {
        chart.createIndicator({
          name: 'EMA',
          calcParams: uiConfig?.emaPeriods || [9, 21, 50]
        }, true, { id: 'candle_pane' });
      }
      if (uiConfig?.subpanes?.vol !== false) {
        chart.createIndicator('VOL', false, { id: 'pane_vol', height: 70 });
      }
      if (uiConfig?.subpanes?.cvd) {
        chart.createIndicator('CVD', false, { id: 'pane_cvd', height: 75 });
      }
      if (uiConfig?.subpanes?.rsi) {
        chart.createIndicator('RSI', false, { id: 'pane_rsi', height: 70 });
      }
      if (uiConfig?.subpanes?.macd) {
        chart.createIndicator('MACD', false, { id: 'pane_macd', height: 75 });
      }
    } catch (e) {
      console.warn("Indicator init warning:", e);
    }

    // Crosshair Sync: subscribe to mouse crosshair movement
    chart.subscribeAction('onCrosshairChange', (data) => {
      const ts = data?.kLineData?.timestamp || null;
      window.dispatchEvent(new CustomEvent('crosshair-sync', {
        detail: { chartId, timestamp: ts }
      }));
    });

    setChartReady(prev => prev + 1);

    let rafId = null;
    const handleResize = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (chartRef.current) {
          try { chartRef.current.resize(); } catch (_) {}
        }
      });
    };

    window.addEventListener('resize', handleResize);

    // ResizeObserver for Dual-Pane 50/50 split and collapsible panels
    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && chartContainerRef.current) {
      ro = new ResizeObserver(() => handleResize());
      ro.observe(chartContainerRef.current);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      if (ro) ro.disconnect();
      try {
        dispose(chartContainerRef.current);
      } catch (_) {}
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dynamically apply uiConfig changes on the fly (theme, opacity, EMA, subpanes, precision)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !uiConfig) return;

    try {
      chart.setStyles(buildChartStyles(uiConfig));
    } catch (_) {}

    // Precision
    try {
      if (uiConfig.pricePrecision && uiConfig.pricePrecision !== 'auto') {
        chart.setPriceVolumePrecision(Number(uiConfig.pricePrecision), 2);
      } else {
        const p = symbol.includes('BTC') ? 1 : symbol.includes('ETH') || symbol.includes('SOL') ? 2 : 4;
        chart.setPriceVolumePrecision(p, 2);
      }
    } catch (_) {}

    // Sync EMA
    try {
      const wantEma = uiConfig.emaEnabled !== false;
      const emaLines = (uiConfig.emaColors || ['#38bdf8', '#f59e0b', '#a855f7']).map(color => ({
        style: 'solid',
        size: uiConfig.emaWidth ?? 1.5,
        color
      }));
      if (wantEma) {
        if (!indicators.ema) {
          chart.createIndicator({
            name: 'EMA',
            calcParams: uiConfig.emaPeriods || [9, 21, 50],
            styles: { lines: emaLines }
          }, true, { id: 'candle_pane' });
        } else {
          chart.overrideIndicator({
            name: 'EMA',
            calcParams: uiConfig.emaPeriods || [9, 21, 50],
            styles: { lines: emaLines }
          }, 'candle_pane');
        }
      } else if (indicators.ema) {
        chart.removeIndicator('candle_pane', 'EMA');
      }
    } catch (_) {}

    // Sync subpanes (VOL, CVD, RSI, MACD)
    const sp = uiConfig.subpanes || {};
    const syncPane = (key, indName, paneId, height = 70) => {
      const want = Boolean(sp[key]);
      const has = Boolean(indicators[key]);
      try {
        if (want && !has) {
          chart.createIndicator(indName, false, { id: paneId, height });
        } else if (!want && has) {
          chart.removeIndicator(paneId, indName);
        }
      } catch (_) {}
    };
    syncPane('vol', 'VOL', 'pane_vol', 70);
    syncPane('cvd', 'CVD', 'pane_cvd', 75);
    syncPane('rsi', 'RSI', 'pane_rsi', 70);
    syncPane('macd', 'MACD', 'pane_macd', 75);

    setIndicators(prev => ({
      ...prev,
      ema: uiConfig.emaEnabled !== false,
      vol: Boolean(sp.vol),
      cvd: Boolean(sp.cvd),
      rsi: Boolean(sp.rsi),
      macd: Boolean(sp.macd)
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiConfig, symbol]);

  // Save drawings for a specific symbol/timeframe (e.g. before coin switch)
  const saveDrawingsFor = useCallback((targetSymbol, targetTimeframe) => {
    if (!chartRef.current) return;
    const sym = (targetSymbol || symbol).toUpperCase();
    const tf = targetTimeframe || timeframe;
    
    const saveList = [];
    
    // Method 1: Check internal _chartStore overlay instance map
    try {
      const store = chartRef.current._chartStore?.getOverlayStore();
      if (store && store._instances) {
        for (const instances of store._instances.values()) {
          instances.forEach(inst => {
            if (inst && inst.points && inst.points.length > 0) {
              if (inst.id !== 'sync_crosshair_marker' && USER_DRAWING_TYPES.has(inst.name)) {
                saveList.push({
                  name: inst.name,
                  points: inst.points,
                  styles: inst.styles
                });
              }
            }
          });
        }
      }
    } catch (_) {}

    // Method 2: Fallback to trackedOverlays ref if store not directly accessible
    if (saveList.length === 0 && trackedOverlays.current.size > 0) {
      for (const [id, data] of trackedOverlays.current.entries()) {
        if (id === 'sync_crosshair_marker') continue;
        const inst = chartRef.current.getOverlayById(id);
        if (inst && inst.points && inst.points.length > 0 && USER_DRAWING_TYPES.has(inst.name)) {
          saveList.push({
            name: inst.name || data.name,
            points: inst.points,
            styles: inst.styles
          });
        } else if (data && data.points && USER_DRAWING_TYPES.has(data.name)) {
          saveList.push(data);
        }
      }
    }

    fetch(`${API_BASE}/drawings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        symbol: sym,
        timeframe: tf,
        elements_json: JSON.stringify(saveList)
      })
    })
    .then(res => res.json())
    .then(() => {
      setStatusMsg("Сохранено!");
      setTimeout(() => setStatusMsg(""), 1200);
    })
    .catch(() => {});
  }, [symbol, timeframe, userId]);

  // Save current active drawings
  const saveDrawings = useCallback(() => {
    saveDrawingsFor(symbol, timeframe);
  }, [saveDrawingsFor, symbol, timeframe]);

  // Load drawings from backend
  const loadDrawings = useCallback(() => {
    if (!chartRef.current) return;
    
    fetch(`${API_BASE}/drawings?symbol=${symbol}&timeframe=${timeframe}&user_id=${userId}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.elements_json && chartRef.current) {
          try {
            const list = JSON.parse(data.elements_json);
            if (Array.isArray(list)) {
              // Remove ONLY tracked user drawings so liquidations & heatmap aren't wiped
              for (const id of trackedOverlays.current.keys()) {
                try {
                  chartRef.current.removeOverlay({ id });
                } catch (_) {}
              }
              trackedOverlays.current.clear();
              drawingHistory.current = [];
              selectedOverlayId.current = null;

              list.forEach(overlay => {
                if (!overlay || !overlay.name || !USER_DRAWING_TYPES.has(overlay.name)) return;
                const id = chartRef.current.createOverlay({
                  ...overlay,
                  onSelected: (e) => {
                    selectedOverlayId.current = e.overlay.id;
                    return true;
                  },
                  onDeselected: () => {
                    selectedOverlayId.current = null;
                    return true;
                  }
                });
                if (id) {
                  trackedOverlays.current.set(id, overlay);
                  drawingHistory.current.push(id);
                }
              });
            }
          } catch (e) {
            console.error("Failed to parse drawings:", e);
          }
        }
      })
      .catch(e => console.error("Could not load drawings:", e));
  }, [symbol, timeframe, userId]);

  // Undo last drawn figure (Ctrl+Z)
  const handleUndo = useCallback(() => {
    if (!chartRef.current) return;
    if (drawingHistory.current.length > 0) {
      const lastId = drawingHistory.current.pop();
      try {
        chartRef.current.removeOverlay({ id: lastId });
      } catch (_) {}
      trackedOverlays.current.delete(lastId);
      if (selectedOverlayId.current === lastId) {
        selectedOverlayId.current = null;
      }
      saveDrawings();
      setStatusMsg("Отменено (Ctrl+Z)");
      setTimeout(() => setStatusMsg(""), 1200);
    }
  }, [saveDrawings]);

  // Hotkey listener for Ctrl+Z (Undo), Delete/Backspace on active overlay & Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Ctrl+Z or Cmd+Z: Undo last drawing figure
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я')) {
        e.preventDefault();
        handleUndo();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedOverlayId.current && chartRef.current) {
          try {
            chartRef.current.removeOverlay({ id: selectedOverlayId.current });
            trackedOverlays.current.delete(selectedOverlayId.current);
            selectedOverlayId.current = null;
            saveDrawings();
          } catch (_) {}
        }
      } else if (e.key === 'Escape') {
        setActiveTool(null);
        setContextMenu({ visible: false, x: 0, y: 0 });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [symbol, timeframe, userId, saveDrawings, handleUndo]);

  // Global event listener for Undo
  useEffect(() => {
    const onUndo = () => handleUndo();
    window.addEventListener('chart-undo-drawing', onUndo);
    return () => window.removeEventListener('chart-undo-drawing', onUndo);
  }, [handleUndo]);

  // Crosshair synchronization listener from other chart in dual-pane
  useEffect(() => {
    const handleSync = (e) => {
      if (!chartRef.current) return;
      const { chartId: sourceId, timestamp } = e.detail || {};
      if (sourceId && sourceId !== chartId) {
        try {
          const syncId = 'sync_crosshair_marker';
          if (timestamp) {
            const existing = chartRef.current.getOverlayById(syncId);
            if (existing) {
              chartRef.current.overrideOverlay({
                id: syncId,
                points: [{ timestamp }]
              });
            } else {
              chartRef.current.createOverlay({
                name: 'verticalStraightLine',
                id: syncId,
                points: [{ timestamp }],
                lock: true,
                needDefaultPointFigure: false,
                needDefaultXAxisFigure: false,
                needDefaultYAxisFigure: false,
                styles: {
                  line: {
                    color: '#ff9800',
                    size: 1,
                    style: 'dashed'
                  }
                }
              });
            }
          } else {
            chartRef.current.removeOverlay({ id: syncId });
          }
        } catch (_) {}
      }
    };

    window.addEventListener('crosshair-sync', handleSync);
    return () => window.removeEventListener('crosshair-sync', handleSync);
  }, [chartId]);

  // Save current drawings before switching symbol/timeframe or on unmount
  useEffect(() => {
    if (prevSymbolRef.current !== symbol || prevTimeframeRef.current !== timeframe) {
      if (prevSymbolRef.current && prevTimeframeRef.current) {
        saveDrawingsFor(prevSymbolRef.current, prevTimeframeRef.current);
      }
      prevSymbolRef.current = symbol;
      prevTimeframeRef.current = timeframe;
    }
  }, [symbol, timeframe, saveDrawingsFor]);

  useEffect(() => {
    return () => {
      if (prevSymbolRef.current && prevTimeframeRef.current) {
        saveDrawingsFor(prevSymbolRef.current, prevTimeframeRef.current);
      }
    };
  }, [saveDrawingsFor]);

  // Recenter chart to real time on Space key
  useEffect(() => {
    const handleRecenter = () => {
      if (chartRef.current) {
        try {
          chartRef.current.scrollToRealTime();
          setStatusMsg("Центрировано на текущей цене");
          setTimeout(() => setStatusMsg(""), 1200);
        } catch (_) {}
      }
    };
    window.addEventListener('recenter-market-price', handleRecenter);
    return () => window.removeEventListener('recenter-market-price', handleRecenter);
  }, []);

  // Update VWAP Overlay
  const updateVwapOverlay = useCallback((klinesData) => {
    if (!chartRef.current || !showVwap) return;
    const klines = klinesData || currentKlines.current;
    if (!klines || klines.length < 2) return;

    try {
      let cumPV = 0;
      let cumV = 0;
      const vwapPoints = [];
      klines.forEach(k => {
        const tp = (k.high + k.low + k.close) / 3;
        cumPV += tp * k.volume;
        cumV += k.volume;
        const vwapVal = cumV > 0 ? cumPV / cumV : k.close;
        vwapPoints.push({ timestamp: k.timestamp, value: vwapVal });
      });

      if (vwapLineOverlay.current) {
        try { chartRef.current.removeOverlay({ id: vwapLineOverlay.current }); } catch (_) {}
      }

      if (vwapPoints.length >= 2) {
        const p1 = vwapPoints[0];
        const p2 = vwapPoints[vwapPoints.length - 1];
        const id = chartRef.current.createOverlay({
          name: 'segment',
          points: [p1, p2],
          styles: {
            line: { color: '#ffb300', size: 2, style: 'solid' }
          }
        });
        vwapLineOverlay.current = id;
      }
    } catch (_) {}
  }, [showVwap]);

  // Load and render Liquidations on Chart
  const loadLiquidations = useCallback(async () => {
    if (!chartRef.current || !showLiquidations) {
      activeLiqOverlays.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
      activeLiqOverlays.current = [];
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/liquidations?symbol=${symbol}&min_usd=${minLiqUsd}&limit=50`);
      if (!res.ok) return;
      const data = await res.json();

      activeLiqOverlays.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
      activeLiqOverlays.current = [];

      if (Array.isArray(data)) {
        data.forEach(evt => {
          const id = chartRef.current.createOverlay({
            name: 'liqMarker',
            points: [{ timestamp: evt.timestamp, value: evt.price }],
            extendData: { side: evt.side, usd_amount: evt.usd_amount }
          });
          if (id) activeLiqOverlays.current.push(id);
        });
      }
    } catch (_) {}
  }, [symbol, showLiquidations, minLiqUsd]);

  // Load and render Density Heatmap on Chart
  const loadHeatmap = useCallback(async () => {
    if (!chartRef.current || !showHeatmap) {
      activeHeatmapOverlays.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
      activeHeatmapOverlays.current = [];
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/heatmap?symbol=${symbol}&min_usd=${heatmapMinUsd}&limit=350`);
      if (!res.ok) return;
      const data = await res.json();

      activeHeatmapOverlays.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
      activeHeatmapOverlays.current = [];

      if (Array.isArray(data)) {
        data.forEach(pt => {
          const id = chartRef.current.createOverlay({
            name: 'densityHeatmap',
            points: [{ timestamp: pt.timestamp, value: pt.price }],
            extendData: { side: pt.side, volume_usd: pt.volume_usd }
          });
          if (id) activeHeatmapOverlays.current.push(id);
        });
      }
    } catch (_) {}
  }, [symbol, showHeatmap, heatmapMinUsd]);

  // Load and render OrderBook Densities (> $1M) as crisp horizontal levels on Chart (TACT 2)
  const loadOrderBookWalls = useCallback(async () => {
    if (!chartRef.current || !showWalls) {
      activeWallOverlays.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
      activeWallOverlays.current = [];
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/depth?symbol=${symbol}&limit=100`);
      if (!res.ok) return;
      const data = await res.json();
      if (!chartRef.current) return;

      const klines = currentKlines.current;
      if (!klines || klines.length === 0) return;
      const anchorTs = klines[klines.length - 1].timestamp;

      const bids = (data.bids || []).map(([p, q]) => {
        const price = parseFloat(p);
        const qty = parseFloat(q);
        return { price, volume_usd: price * qty, side: 'BUY' };
      });

      const asks = (data.asks || []).map(([p, q]) => {
        const price = parseFloat(p);
        const qty = parseFloat(q);
        return { price, volume_usd: price * qty, side: 'SELL' };
      });

      // Top-3 bids > $1M (fallback >= 400k)
      let bigBids = bids.filter(b => b.volume_usd >= 1000000).sort((a, b) => b.volume_usd - a.volume_usd).slice(0, 3);
      if (bigBids.length === 0) {
        bigBids = bids.filter(b => b.volume_usd >= 400000).sort((a, b) => b.volume_usd - a.volume_usd).slice(0, 2);
      }

      // Top-3 asks > $1M (fallback >= 400k)
      let bigAsks = asks.filter(a => a.volume_usd >= 1000000).sort((a, b) => b.volume_usd - a.volume_usd).slice(0, 3);
      if (bigAsks.length === 0) {
        bigAsks = asks.filter(a => a.volume_usd >= 400000).sort((a, b) => b.volume_usd - a.volume_usd).slice(0, 2);
      }

      const wallsToRender = [...bigBids, ...bigAsks];

      // Remove previous walls
      activeWallOverlays.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
      activeWallOverlays.current = [];

      // Render updated walls
      wallsToRender.forEach(w => {
        try {
          const id = chartRef.current.createOverlay({
            name: 'orderbookWall',
            lock: true,
            points: [{ timestamp: anchorTs, value: w.price }],
            extendData: {
              side: w.side,
              volume_usd: w.volume_usd,
              price: w.price
            }
          });
          if (id) activeWallOverlays.current.push(id);
        } catch (_) {}
      });
    } catch (_) {}
  }, [symbol, showWalls]);

  // Fetch Storage Stats
  useEffect(() => {
    fetch(`${API_BASE}/recorder/status`)
      .then(res => res.json())
      .then(stat => {
        if (stat) {
          setStorageInfo({
            earliest: stat.earliest_recorded_at || '',
            usage: `${stat.used_storage_mb || 0} MB / ${stat.max_storage_gb || 100} GB`
          });
        }
      })
      .catch(() => {});
  }, [symbol]);

  useEffect(() => {
    loadLiquidations();
  }, [loadLiquidations]);

  useEffect(() => {
    loadHeatmap();
  }, [loadHeatmap]);

  useEffect(() => {
    loadOrderBookWalls();
    const wallTimer = setInterval(loadOrderBookWalls, 2500);
    return () => clearInterval(wallTimer);
  }, [loadOrderBookWalls]);

  useEffect(() => {
    updateVwapOverlay();
  }, [updateVwapOverlay]);

  // Close context menu on outside click
  useEffect(() => {
    const handleWindowClick = () => {
      if (contextMenu.visible) {
        setContextMenu({ visible: false, x: 0, y: 0 });
      }
    };
    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, [contextMenu.visible]);

  // Fetch history candles & subscribe live WebSocket
  useEffect(() => {
    if (!chartRef.current || chartReady === 0) return;
    const chart = chartRef.current;
    let isCancelled = false;

    setStatusMsg("Загрузка свечей...");
    setErrorDetails(null);

    const fetchKlines = async () => {
      try {
        let res;
        try {
          res = await fetch(`${API_BASE}/klines?symbol=${symbol}&timeframe=${timeframe}&limit=250`);
        } catch (proxyErr) {
          res = await fetch(`http://127.0.0.1:8000/api/klines?symbol=${symbol}&timeframe=${timeframe}&limit=250`);
        }

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errText}`);
        }

        const data = await res.json();
        if (isCancelled) return;

        if (Array.isArray(data) && data.length > 0) {
          const formattedData = data.map(k => ({
            timestamp: Number(k.timestamp),
            open: Number(k.open),
            high: Number(k.high),
            low: Number(k.low),
            close: Number(k.close),
            volume: Number(k.volume),
            turnover: Number(k.turnover || (k.close * k.volume))
          }));

          currentKlines.current = formattedData;
          chart.applyNewData(formattedData);
          setStatusMsg("");
          setErrorDetails(null);

          // Restore saved drawings, vwap, liquidations, and heatmap
          loadDrawings();
          updateVwapOverlay(formattedData);
          loadLiquidations();
          loadHeatmap();
          setKlinesVersion(v => v + 1);
        } else {
          setStatusMsg("Свечи отсутствуют");
        }
      } catch (err) {
        if (isCancelled) return;
        setStatusMsg("Ошибка загрузки");
        setErrorDetails(err.message || String(err));
      }
    };

    fetchKlines();

    // Live Binance WebSocket Kline stream with instant connection, failover, and heartbeat fallback
    const binanceInterval = timeframe === '45m' ? '15m' : (timeframe === '6h' ? '1h' : timeframe);
    const cleanSym = symbol.toLowerCase();
    const wsEndpoints = [
      `wss://stream.binance.com:9443/ws/${cleanSym}@kline_${binanceInterval}`,
      `wss://fstream.binance.com/ws/${cleanSym}@kline_${binanceInterval}`
    ];
    let endpointIdx = 0;

    let reconnectTimer = null;
    let heartbeatTimer = null;
    let lastTickTime = Date.now();

    const connectWs = () => {
      if (isCancelled) return;
      if (wsRef.current) {
        try { wsRef.current.close(); } catch (_) {}
        wsRef.current = null;
      }

      const activeUrl = wsEndpoints[endpointIdx % wsEndpoints.length];

      try {
        const ws = new WebSocket(activeUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          lastTickTime = Date.now();
        };

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            const k = payload.k || payload;
            if (!k || !chartRef.current) return;
            lastTickTime = Date.now();

            let barTimestamp = Number(k.t);
            // Custom TF bucket alignment
            if (timeframe === '45m') {
              barTimestamp = Math.floor(barTimestamp / (45 * 60 * 1000)) * (45 * 60 * 1000);
            } else if (timeframe === '6h') {
              barTimestamp = Math.floor(barTimestamp / (6 * 3600 * 1000)) * (6 * 3600 * 1000);
            }

            const openP = parseFloat(k.o);
            const highP = parseFloat(k.h);
            const lowP = parseFloat(k.l);
            const closeP = parseFloat(k.c);
            const vol = parseFloat(k.v);
            const turnover = parseFloat(k.q || (closeP * vol));

            const bar = {
              timestamp: barTimestamp,
              open: openP,
              high: highP,
              low: lowP,
              close: closeP,
              volume: vol,
              turnover: turnover
            };

            // Keep currentKlines in sync with live tick: dynamically expand wicks and body on new highs/lows
            const klines = currentKlines.current;
            if (klines && klines.length > 0) {
              const lastBar = klines[klines.length - 1];
              if (lastBar.timestamp === barTimestamp) {
                bar.open = lastBar.open;
                bar.high = Math.max(lastBar.high, highP, closeP);
                bar.low = Math.min(lastBar.low, lowP, closeP);
                klines[klines.length - 1] = bar;
              } else if (barTimestamp > lastBar.timestamp) {
                klines.push(bar);
                if (klines.length > 500) klines.shift();
              }
            }

            chartRef.current.updateData(bar);
          } catch (e) {
            console.warn("WS candle error:", e);
          }
        };

        ws.onerror = () => {
          try { ws.close(); } catch (_) {}
        };

        ws.onclose = () => {
          if (!isCancelled) {
            endpointIdx++;
            reconnectTimer = setTimeout(connectWs, 2000);
          }
        };
      } catch (e) {
        if (!isCancelled) {
          endpointIdx++;
          reconnectTimer = setTimeout(connectWs, 2500);
        }
      }
    };

    connectWs();

    // Heartbeat fallback: checks every 3s; if no tick received for > 4.5s, polls REST endpoint
    heartbeatTimer = setInterval(async () => {
      if (isCancelled || !chartRef.current) return;
      if (Date.now() - lastTickTime > 4500) {
        try {
          const r = await fetch(`${API_BASE}/klines?symbol=${symbol}&timeframe=${timeframe}&limit=2`);
          if (r.ok) {
            const data = await r.json();
            if (Array.isArray(data) && data.length > 0) {
              const latest = data[data.length - 1];
              const bar = {
                timestamp: Number(latest.timestamp),
                open: Number(latest.open),
                high: Number(latest.high),
                low: Number(latest.low),
                close: Number(latest.close),
                volume: Number(latest.volume),
                turnover: Number(latest.turnover || (latest.close * latest.volume))
              };
              chartRef.current.updateData(bar);
              lastTickTime = Date.now();
            }
          }
        } catch (_) {}

        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          endpointIdx++;
          connectWs();
        }
      }
    }, 3000);

    return () => {
      isCancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch (_) {}
        wsRef.current = null;
      }
    };
  }, [symbol, timeframe, chartReady, loadDrawings]);

  // Backtest signals: draw BUY/SELL markers, clear on symbol change / re-run / hide
  const clearBacktestSignals = useCallback(() => {
    if (chartRef.current) {
      btOverlayIds.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
    }
    btOverlayIds.current = [];
    setBtTooltip(null);
  }, []);

  useEffect(() => {
    clearBacktestSignals();
    const chart = chartRef.current;
    const klines = currentKlines.current;
    if (!chart || !showBacktestSignals || !backtestSignals || !Array.isArray(backtestSignals.signals)) return;
    if (backtestSignals.symbol && backtestSignals.symbol !== symbol.toUpperCase()) return;
    if (!klines || klines.length === 0) return;

    const firstTs = klines[0].timestamp;
    const lastTs = klines[klines.length - 1].timestamp;
    const barMs = klines.length > 1 ? klines[1].timestamp - klines[0].timestamp : 60000;

    // Snap signal time to the candle that contains it (binary search for last bar <= time)
    const findBar = (t) => {
      if (t < firstTs || t > lastTs + barMs) return null;
      let lo = 0, hi = klines.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (klines[mid].timestamp <= t) lo = mid; else hi = mid - 1;
      }
      return klines[lo];
    };

    const container = chartContainerRef.current;
    const showTip = (sig) => (e) => {
      const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
      const px = (e && e.pageX != null) ? e.pageX - rect.left - window.scrollX : (e?.x || 0);
      const py = (e && e.pageY != null) ? e.pageY - rect.top - window.scrollY : (e?.y || 0);
      setBtTooltip({ x: px, y: py, sig });
      return true;
    };

    let lastBarTs = null;
    backtestSignals.signals.forEach(sig => {
      const bar = findBar(sig.time);
      if (!bar) return;
      lastBarTs = bar.timestamp;
      const isBuy = sig.type === 'BUY';
      try {
        const id = chart.createOverlay({
          name: 'btSignal',
          lock: true,
          points: [{ timestamp: bar.timestamp, value: isBuy ? bar.low : bar.high }],
          extendData: { type: sig.type, price: sig.price },
          onMouseEnter: showTip(sig),
          onClick: showTip(sig),
          onMouseLeave: () => { setBtTooltip(null); return true; }
        });
        if (id) btOverlayIds.current.push(id);
      } catch (_) {}
    });

    // Reveal the newest marker once per new result (not on every redraw)
    if (lastBarTs && lastScrolledResult.current !== backtestSignals) {
      lastScrolledResult.current = backtestSignals;
      try { chart.scrollToTimestamp(Math.min(lastBarTs + 14 * barMs, lastTs), 200); } catch (_) {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backtestSignals, showBacktestSignals, symbol, timeframe, klinesVersion, chartReady]);

  // Strategy Key Entry Levels (Semi-transparent Zones with Badges: BUY ZONE: Wall $1.2M / SHORT: Delta Div)
  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;
    const klines = currentKlines.current;

    activeStrategyLevelOverlays.current.forEach(id => {
      try { chart.removeOverlay({ id }); } catch (_) {}
    });
    activeStrategyLevelOverlays.current = [];

    if (!Array.isArray(strategyLevels) || strategyLevels.length === 0 || !klines || klines.length === 0) {
      return;
    }

    const anchorTs = klines[klines.length - 1].timestamp;

    strategyLevels.forEach(lvl => {
      const p = Number(lvl.price);
      if (!p || !Number.isFinite(p)) return;
      try {
        const id = chart.createOverlay({
          name: 'strategyLevelZone',
          lock: true,
          points: [{ timestamp: anchorTs, value: p }],
          extendData: {
            type: lvl.type || 'BUY',
            label: lvl.label || (lvl.type === 'BUY' ? 'BUY ZONE: Wall $1.2M' : 'SHORT: Delta Div'),
            price: p
          }
        });
        if (id) activeStrategyLevelOverlays.current.push(id);
      } catch (_) {}
    });
  }, [strategyLevels, symbol, timeframe, klinesVersion, chartReady]);

  // Drawing tool selection
  const handleSelectTool = (toolName) => {
    if (!chartRef.current) return;
    setActiveTool(toolName);
    const overlayId = chartRef.current.createOverlay({
      name: toolName,
      lock: false,
      mode: magnetEnabled ? 'strong_magnet' : 'normal',
      onDrawEnd: (e) => {
        setActiveTool(null);
        if (e && e.overlay) {
          trackedOverlays.current.set(e.overlay.id, {
            name: e.overlay.name,
            points: e.overlay.points,
            styles: e.overlay.styles
          });
          if (!drawingHistory.current.includes(e.overlay.id)) {
            drawingHistory.current.push(e.overlay.id);
          }
        }
        setTimeout(() => {
          saveDrawings();
        }, 50);
        return true;
      },
      onSelected: (e) => {
        selectedOverlayId.current = e.overlay.id;
        return true;
      },
      onDeselected: () => {
        selectedOverlayId.current = null;
        return true;
      }
    });
    if (overlayId) {
      trackedOverlays.current.set(overlayId, { name: toolName });
      drawingHistory.current.push(overlayId);
    }
  };

  const handleClearDrawings = () => {
    if (!chartRef.current) return;
    for (const id of trackedOverlays.current.keys()) {
      try {
        chartRef.current.removeOverlay({ id });
      } catch (_) {}
    }
    trackedOverlays.current.clear();
    drawingHistory.current = [];
    selectedOverlayId.current = null;
    setActiveTool(null);
    saveDrawings();
    setStatusMsg("Разметка очищена");
    setTimeout(() => setStatusMsg(""), 1200);
  };

  // Toggle indicators
  const toggleIndicator = (name) => {
    if (!chartRef.current) return;
    const chart = chartRef.current;
    
    if (name === 'rsi') {
      if (indicators.rsi) {
        try { chart.removeIndicator('pane_rsi', 'RSI'); } catch (_) {}
        try { chart.removeIndicator({ name: 'RSI' }); } catch (_) {}
      } else {
        chart.createIndicator('RSI', false, { id: 'pane_rsi', height: 70 });
      }
      setIndicators(prev => ({ ...prev, rsi: !prev.rsi }));
    } else if (name === 'macd') {
      if (indicators.macd) {
        try { chart.removeIndicator('pane_macd', 'MACD'); } catch (_) {}
        try { chart.removeIndicator({ name: 'MACD' }); } catch (_) {}
      } else {
        chart.createIndicator('MACD', false, { id: 'pane_macd', height: 75 });
      }
      setIndicators(prev => ({ ...prev, macd: !prev.macd }));
    } else if (name === 'cvd') {
      if (indicators.cvd) {
        try { chart.removeIndicator('pane_cvd', 'CVD'); } catch (_) {}
        try { chart.removeIndicator({ name: 'CVD' }); } catch (_) {}
      } else {
        chart.createIndicator('CVD', false, { id: 'pane_cvd', height: 75 });
      }
      setIndicators(prev => ({ ...prev, cvd: !prev.cvd }));
    } else if (name === 'ema') {
      if (indicators.ema) {
        chart.removeIndicator('candle_pane', 'EMA');
      } else {
        chart.createIndicator({
          name: 'EMA',
          calcParams: uiConfig?.emaPeriods || [9, 21, 50]
        }, true, { id: 'candle_pane' });
      }
      setIndicators(prev => ({ ...prev, ema: !prev.ema }));
    } else if (name === 'vol') {
      if (indicators.vol) {
        try { chart.removeIndicator('pane_vol', 'VOL'); } catch (_) {}
        try { chart.removeIndicator({ name: 'VOL' }); } catch (_) {}
      } else {
        chart.createIndicator('VOL', false, { id: 'pane_vol', height: 70 });
      }
      setIndicators(prev => ({ ...prev, vol: !prev.vol }));
    } else if (name === 'vwap') {
      const nextVwap = !showVwap;
      setShowVwap(nextVwap);
      setIndicators(prev => ({ ...prev, vwap: nextVwap }));
      localStorage.setItem('chart_vwap', nextVwap ? 'true' : 'false');
      if (!nextVwap && vwapLineOverlay.current) {
        try { chart.removeOverlay({ id: vwapLineOverlay.current }); } catch (_) {}
        vwapLineOverlay.current = null;
      } else {
        updateVwapOverlay();
      }
    }
  };

  // Right-Click Context Menu handler (Task 6 & ТАКТ 3)
  const handleContextMenu = (e) => {
    e.preventDefault();
    const bounds = chartContainerRef.current?.getBoundingClientRect();
    if (!bounds) return;

    const relX = e.clientX - bounds.left;
    const relY = e.clientY - bounds.top;

    let clickedPrice = null;
    if (chartRef.current) {
      try {
        if (typeof chartRef.current.convertFromPixel === 'function') {
          const pt = chartRef.current.convertFromPixel({ x: relX, y: relY }, { paneId: 'candle_pane' });
          if (pt && typeof pt.value === 'number') {
            clickedPrice = pt.value;
          }
        }
      } catch (_) {}
    }

    if (!clickedPrice && currentKlines.current.length > 0) {
      clickedPrice = currentKlines.current[currentKlines.current.length - 1].close;
    }

    // Constrain context menu within canvas
    const x = Math.min(e.clientX, bounds.right - 230);
    const y = Math.min(e.clientY, bounds.bottom - 280);

    setContextMenu({ visible: true, x, y, price: clickedPrice });
  };


  const handleResetScale = () => {
    if (chartRef.current) {
      chartRef.current.scrollToRealTime();
      setContextMenu({ visible: false, x: 0, y: 0 });
      setStatusMsg("Масштаб сброшен");
      setTimeout(() => setStatusMsg(""), 1200);
    }
  };

  return (
    <div
      style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-subtle)', color: 'var(--text-main)' }}
      className="flex flex-col h-full w-full select-none border overflow-hidden relative font-sans"
    >
      {/* Top Drawing & Indicator Bar (Tealstreet/Tiger style: ultra compact, flat, responsive) */}
      <div
        style={{ backgroundColor: 'var(--bg-panel-header)', borderColor: 'var(--border-subtle)' }}
        className="flex items-center justify-between px-2 py-1 border-b text-xs gap-1 overflow-x-auto"
      >
        {/* Drawing Tools */}
        <div className="flex items-center space-x-0.5 shrink-0">
          {titlePrefix && (
            <div className="flex items-center space-x-1 mr-1 shrink-0 font-mono">
              <span className="px-1.5 py-0.2 rounded bg-[#182030] text-[#38bdf8] font-bold text-[10px] border border-[#2b3955]">
                {titlePrefix} ({timeframe})
              </span>
              {onTimeframeChange && (
                <div className="flex items-center space-x-0.5 ml-0.5">
                  {["1m", "5m", "15m", "1h"].map(tf => (
                    <button
                      key={tf}
                      onClick={() => onTimeframeChange(tf)}
                      className={`px-1 py-0.2 rounded text-[9.5px] transition ${timeframe === tf ? 'bg-[#2563eb] text-white font-bold' : 'text-[#787f91] hover:text-white'}`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button 
            title="Трендовая линия (Отрезок)" 
            onClick={() => handleSelectTool('segment')}
            className={`px-1.5 py-0.5 rounded text-[10.5px] font-mono flex items-center transition ${activeTool === 'segment' ? 'bg-[#2563eb] text-white' : 'text-[#787f91] hover:bg-[#161922] hover:text-white'}`}
          >
            <Minus size={12} className="mr-0.5" />
            <span className="hidden 2xl:inline">Линия</span>
          </button>
          
          <button 
            title="Горизонтальный уровень (Price Line)" 
            onClick={() => handleSelectTool('horizontalStraightLine')}
            className={`px-1.5 py-0.5 rounded text-[10.5px] font-mono flex items-center transition ${activeTool === 'horizontalStraightLine' ? 'bg-[#2563eb] text-white' : 'text-[#787f91] hover:bg-[#161922] hover:text-white'}`}
          >
            <span className="font-mono text-xs mr-0.5">—</span>
            <span className="hidden 2xl:inline">Уровень</span>
          </button>

          <button 
            title="Луч (Ray Line)" 
            onClick={() => handleSelectTool('rayLine')}
            className={`p-1 rounded transition ${activeTool === 'rayLine' ? 'bg-[#2563eb] text-white' : 'text-[#787f91] hover:bg-[#161922] hover:text-white'}`}
          >
            <MoveRight size={12} />
          </button>

          <button 
            title="Прямоугольник (Зона плотности / имбаланс)" 
            onClick={() => handleSelectTool('rect')}
            className={`p-1 rounded transition ${activeTool === 'rect' ? 'bg-[#2563eb] text-white' : 'text-[#787f91] hover:bg-[#161922] hover:text-white'}`}
          >
            <Square size={11} />
          </button>

          <button 
            title="Уровни Фибоначчи" 
            onClick={() => handleSelectTool('fibonacciLine')}
            className={`p-1 rounded transition ${activeTool === 'fibonacciLine' ? 'bg-[#2563eb] text-white' : 'text-[#787f91] hover:bg-[#161922] hover:text-white'}`}
          >
            <Hash size={11} />
          </button>

          <button 
            title="Линейка (Замер % и пунктов)" 
            onClick={() => handleSelectTool('measure')}
            className={`p-1 rounded transition ${activeTool === 'measure' ? 'bg-[#2563eb] text-white' : 'text-[#787f91] hover:bg-[#161922] hover:text-white'}`}
          >
            <Ruler size={12} />
          </button>

          <div className="h-3.5 w-px bg-[#1f2430] mx-0.5" />

          <button 
            title={magnetEnabled ? "Магнит включен (к свечам)" : "Магнит выключен"} 
            onClick={() => setMagnetEnabled(!magnetEnabled)}
            className={`p-1 rounded transition ${magnetEnabled ? 'bg-[#26a69a] text-white' : 'text-[#787f91] hover:bg-[#161922] hover:text-white'}`}
          >
            <Magnet size={12} />
          </button>

          <button 
            title="Отменить последнее действие (Ctrl+Z)" 
            onClick={handleUndo}
            className="p-1 rounded text-[#787f91] hover:text-[#ff9800] hover:bg-[#ff980018] transition"
          >
            <RotateCcw size={12} />
          </button>

          <button 
            title="Очистить все рисунки" 
            onClick={handleClearDrawings}
            className="p-1 rounded text-[#787f91] hover:text-[#ef5350] hover:bg-[#ef535018] transition"
          >
            <Trash2 size={12} />
          </button>

          <button 
            title="Сохранить рисунки" 
            onClick={saveDrawings}
            className="p-1 rounded text-[#787f91] hover:text-[#26a69a] hover:bg-[#26a69a18] transition"
          >
            <Save size={12} />
          </button>
        </div>

        {/* Indicators, Overlays and Storage Status */}
        <div className="flex items-center space-x-1 font-mono-numbers shrink-0">
          {statusMsg && (
            <span className="text-[#f59e0b] text-[10px] font-mono animate-pulse mr-1">{statusMsg}</span>
          )}
          
          <button 
            title="Тепловая карта плотностей стакана во времени"
            onClick={() => {
              const next = !showHeatmap;
              setShowHeatmap(next);
              localStorage.setItem('chart_heatmap', next ? 'true' : 'false');
            }}
            className={`px-1 py-0.2 rounded text-[9.5px] font-mono transition flex items-center ${showHeatmap ? 'bg-[#ff980022] text-[#ff9800] border border-[#ff980050]' : 'text-[#60697b] hover:text-white'}`}
          >
            <span>🔥</span>
            <span className="hidden xl:inline ml-0.5">Плотн.</span>
          </button>

          <button 
            title="Маркеры ликвидаций Binance Futures"
            onClick={() => {
              const next = !showLiquidations;
              setShowLiquidations(next);
              localStorage.setItem('chart_liquidations', next ? 'true' : 'false');
            }}
            className={`px-1 py-0.2 rounded text-[9.5px] font-mono transition flex items-center ${showLiquidations ? 'bg-[#ef535022] text-[#ef5350] border border-[#ef535050]' : 'text-[#60697b] hover:text-white'}`}
          >
            <span>💥</span>
            <span className="hidden xl:inline ml-0.5">Ликв.</span>
          </button>

          <div className="h-3 w-px bg-[#1f2430] mx-0.5" />

          <button 
            onClick={() => toggleIndicator('vwap')}
            className={`px-1 py-0.2 rounded text-[9.5px] font-mono transition ${showVwap ? 'bg-[#1e293b] text-[#ffb300] border border-[#ffb30050]' : 'text-[#60697b] hover:text-white'}`}
          >
            VWAP
          </button>

          <button 
            onClick={() => toggleIndicator('ema')}
            className={`px-1 py-0.2 rounded text-[9.5px] font-mono transition ${indicators.ema ? 'bg-[#1e293b] text-[#38bdf8] border border-[#38bdf840]' : 'text-[#60697b] hover:text-white'}`}
          >
            EMA
          </button>

          <button 
            onClick={() => toggleIndicator('vol')}
            className={`px-1 py-0.2 rounded text-[9.5px] font-mono transition ${indicators.vol ? 'bg-[#1e293b] text-[#26a69a] border border-[#26a69a40]' : 'text-[#60697b] hover:text-white'}`}
          >
            VOL
          </button>

          <button 
            onClick={() => toggleIndicator('cvd')}
            className={`px-1 py-0.2 rounded text-[9.5px] font-mono transition ${indicators.cvd ? 'bg-[#1e293b] text-[#00e5ff] border border-[#00e5ff40]' : 'text-[#60697b] hover:text-white'}`}
            title="Кумулятивная дельта объёма (CVD)"
          >
            CVD
          </button>

          <button 
            onClick={() => toggleIndicator('rsi')}
            className={`px-1 py-0.2 rounded text-[9.5px] font-mono transition ${indicators.rsi ? 'bg-[#1e293b] text-[#a855f7] border border-[#a855f740]' : 'text-[#60697b] hover:text-white'}`}
          >
            RSI
          </button>
          
          <button 
            onClick={() => toggleIndicator('macd')}
            className={`px-1 py-0.2 rounded text-[9.5px] font-mono transition ${indicators.macd ? 'bg-[#1e293b] text-[#f59e0b] border border-[#f59e0b40]' : 'text-[#60697b] hover:text-white'}`}
          >
            MACD
          </button>
        </div>
      </div>

      {/* Chart Canvas Area */}
      <div 
        className="flex-1 w-full h-full relative"
        onContextMenu={handleContextMenu}
      >
        <div ref={chartContainerRef} className="w-full h-full" />

        {/* Backtest marker tooltip: reason + PnL */}
        {btTooltip && (
          <div
            className="absolute z-30 pointer-events-none px-2 py-1 rounded border text-[10px] font-mono bg-[#101217] shadow-xl"
            style={{
              left: Math.min(btTooltip.x + 12, (chartContainerRef.current?.clientWidth || 600) - 170),
              top: Math.max(btTooltip.y - 54, 4),
              borderColor: btTooltip.sig.type === 'BUY' ? '#26a69a' : '#ef5350'
            }}
          >
            <div className={btTooltip.sig.type === 'BUY' ? 'text-[#26a69a] font-bold' : 'text-[#ef5350] font-bold'}>
              {btTooltip.sig.label} @ {btTooltip.sig.price}
            </div>
            <div className="text-[#d1d4dc]">Причина: {btTooltip.sig.reason || '—'}</div>
            <div className={(btTooltip.sig.pnl_pct ?? 0) >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}>
              PnL: {(btTooltip.sig.pnl_pct ?? 0) >= 0 ? '+' : ''}{btTooltip.sig.pnl_pct}% (${btTooltip.sig.pnl_usd})
            </div>
          </div>
        )}


        {/* Right-Click Context Menu (Task 6 & ТАКТ 3) */}
        {contextMenu.visible && (
          <div 
            style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
            className="fixed z-50 bg-[#101217] border border-[#1f2430] rounded shadow-2xl py-1 w-52 text-[11px] font-mono text-[#d1d4dc] backdrop-blur-md select-none"
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.price && (
              <>
                <button
                  onClick={() => {
                    const p = contextMenu.price;
                    setContextMenu({ visible: false, x: 0, y: 0 });
                    handleInspectLevel(p);
                  }}
                  className="w-full px-3 py-1.5 text-left bg-[#38bdf815] hover:bg-[#38bdf828] text-[#38bdf8] flex items-center space-x-2 transition font-bold"
                  title="Экспресс-бэктест отскоков и пробоев от этого уровня за 14 дней"
                >
                  <BarChart3 size={13} className="text-[#38bdf8] shrink-0" />
                  <span className="truncate">
                    📊 Отскоки ${contextMenu.price >= 1000 ? contextMenu.price.toFixed(1) : contextMenu.price.toFixed(3)}
                  </span>
                </button>
                <div className="h-px bg-[#161820] my-1" />
              </>
            )}

            <button
              onClick={handleResetScale}
              className="w-full px-3 py-1.5 text-left hover:bg-[#191c26] hover:text-white flex items-center space-x-2 transition"
            >
              <RotateCcw size={12} className="text-[#38bdf8]" />
              <span>Сбросить масштаб цены</span>
            </button>

            <button
              onClick={() => {
                handleClearDrawings();
                setContextMenu({ visible: false, x: 0, y: 0 });
              }}
              className="w-full px-3 py-1.5 text-left hover:bg-[#ef535018] text-[#ef5350] flex items-center space-x-2 transition"
            >
              <Trash2 size={12} />
              <span>Удалить все объекты</span>
            </button>

            <div className="h-px bg-[#161820] my-1" />

            <button
              onClick={() => {
                setMagnetEnabled(!magnetEnabled);
                setContextMenu({ visible: false, x: 0, y: 0 });
              }}
              className="w-full px-3 py-1.5 text-left hover:bg-[#191c26] text-[#787f91] hover:text-white flex items-center justify-between transition"
            >
              <span className="flex items-center space-x-2">
                <Magnet size={12} className={magnetEnabled ? "text-[#26a69a]" : "text-[#787f91]"} />
                <span>Магнит к свечам</span>
              </span>
              {magnetEnabled && <Check size={11} className="text-[#26a69a]" />}
            </button>

            <button
              onClick={() => {
                toggleIndicator('ema');
                setContextMenu({ visible: false, x: 0, y: 0 });
              }}
              className="w-full px-3 py-1.5 text-left hover:bg-[#191c26] text-[#787f91] hover:text-white flex items-center justify-between transition"
            >
              <span>Показать EMA(20)</span>
              {indicators.ema && <Check size={11} className="text-[#38bdf8]" />}
            </button>

            <button
              onClick={() => {
                toggleIndicator('vol');
                setContextMenu({ visible: false, x: 0, y: 0 });
              }}
              className="w-full px-3 py-1.5 text-left hover:bg-[#191c26] text-[#787f91] hover:text-white flex items-center justify-between transition"
            >
              <span>Показать объём (VOL)</span>
              {indicators.vol && <Check size={11} className="text-[#26a69a]" />}
            </button>

            <div className="h-px bg-[#161820] my-1" />

            <button
              onClick={() => setContextMenu({ visible: false, x: 0, y: 0 })}
              className="w-full px-3 py-1 text-left text-[#60697b] hover:text-white text-[10px]"
            >
              ✕ Закрыть
            </button>
          </div>
        )}

        {/* Level Inspector Result Card (ТАКТ 3) */}
        {levelInspectorData && (
          <div className="absolute top-12 right-4 z-40 bg-[#0c0f17]/95 border border-[#38bdf880] rounded shadow-2xl p-3 w-80 text-xs font-mono text-white backdrop-blur-md animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-1.5 border-b border-[#1f2430] mb-2">
              <div className="flex items-center gap-1.5 font-bold text-[#38bdf8]">
                <BarChart3 size={14} />
                <span>Отскоки от уровня ${levelInspectorData.level_price?.toFixed(1)}</span>
              </div>
              <button 
                onClick={() => setLevelInspectorData(null)} 
                className="text-[#787f91] hover:text-white cursor-pointer px-1"
              >
                ✕
              </button>
            </div>
            
            <div className="grid grid-cols-3 gap-1.5 mb-2 text-center">
              <div className="bg-[#141822] p-1.5 rounded">
                <div className="text-[9px] text-[#787f91]">КАСАНИЙ</div>
                <div className="text-sm font-bold text-white">{levelInspectorData.total_touches}</div>
              </div>
              <div className="bg-[#141822] p-1.5 rounded">
                <div className="text-[9px] text-[#787f91]">WINRATE</div>
                <div className={`text-sm font-bold ${levelInspectorData.bounce_winrate_pct >= 55 ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
                  {levelInspectorData.bounce_winrate_pct}%
                </div>
              </div>
              <div className="bg-[#141822] p-1.5 rounded">
                <div className="text-[9px] text-[#787f91]">СР. ИМПУЛЬС</div>
                <div className="text-sm font-bold text-[#26a69a]">+{levelInspectorData.avg_bounce_pnl_pct}%</div>
              </div>
            </div>

            <div className="text-[10px] text-[#94a3b8] bg-[#07090e] p-2 rounded border border-[#1e2330] leading-relaxed mb-2">
              {levelInspectorData.recommendation}
            </div>

            <div className="flex items-center justify-between text-[9px] text-[#64748b]">
              <span>Период: {levelInspectorData.days}дн ({levelInspectorData.timeframe})</span>
              <span>Отскоков: {levelInspectorData.bounces_count} / Пробоев: {levelInspectorData.breakouts_count}</span>
            </div>
          </div>
        )}


        {errorDetails && (
          <div className="absolute top-3 left-3 bg-[#181014] border border-[#ef535040] text-[#ef5350] px-3 py-2 rounded text-xs max-w-md shadow-xl backdrop-blur-md z-30">
            <div className="flex items-center justify-between font-bold mb-1">
              <span>Ошибка подключения Binance Futures</span>
              <button onClick={() => setErrorDetails(null)} className="text-[#848e9c] hover:text-white">
                <X size={12} />
              </button>
            </div>
            <div className="font-mono text-[10px] break-words opacity-90">{errorDetails}</div>
          </div>
        )}
      </div>
    </div>
  );
}
