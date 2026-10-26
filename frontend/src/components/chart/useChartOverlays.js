import { useEffect, useCallback, useRef } from 'react';
import { selectDensityPoints } from './densityHeatmapMath.js';

const API_BASE = "/api";

// Основные настройки TPO/стенок (запрос Di 24.10): хранятся в localStorage,
// меняются из ChartToolbar, применяются при следующей загрузке оверлеев.
export const TPO_SETTINGS_DEFAULTS = { period_minutes: 30, value_area: 0.7, tick_size: null, pin_to_edge: true };
export const WALL_SETTINGS_DEFAULTS = { min_usd: 400000, max_walls: 4 };

const readJsonSetting = (key, fallback) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '{}');
    return { ...fallback, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch (_) {
    return { ...fallback };
  }
};

// Системные оверлеи чарта: VWAP, ликвидации (liqMarker), WebGL-heatmap плотностей
// (точки для DepthHeatmapGL), footprint внутри свечей, TPO/Volume Profile,
// стены стакана (orderbookWall) через WS depth20 + HTTP-fallback.
// Извлечено ДОСЛОВНО из Chart.jsx (слайс 6.4k, п.1 MODULARIZATION_PLAN):
// рефы, колбэки и эффекты перенесены без изменений тел.
// Депсы: chartRef, chartContainerRef, currentKlines, symbol, showVwap,
// showLiquidations, minLiqUsd, showHeatmap, heatmapMinUsd, setDensityPoints,
// showFootprint, showTpo, showWalls, densityMode (все — из Chart.jsx).

export function useChartOverlays({
  chartRef, chartContainerRef, currentKlines, symbol,
  showVwap, showLiquidations, minLiqUsd,
  showHeatmap, heatmapMinUsd, setDensityPoints,
  setLiquidationEvents,
  showFootprint, showTpo, showWalls, densityMode,
}) {
  const depthWsRef = useRef(null);
    const activeLiqOverlays = useRef([]);
    const activeHeatmapOverlays = useRef([]);
    const activeFootprintOverlays = useRef([]);
    const activeTpoOverlays = useRef([]);
    const activeWallOverlays = useRef([]);
    const vwapLineOverlay = useRef(null);

  const densityBudget = useCallback(() => {
    if (densityMode === 'compact') return 24;
    if (densityMode === 'full') return 120;
    const width = chartContainerRef.current?.clientWidth || 1000;
    if (width < 700) return 20;
    if (width < 1100) return 42;
    return 80;
  }, [densityMode]);

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
      if (typeof setLiquidationEvents === 'function') setLiquidationEvents([]);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/liquidations?symbol=${symbol}&min_usd=${minLiqUsd}&limit=300`);
      if (!res.ok) return;
      const data = await res.json();

      if (typeof setLiquidationEvents === 'function' && Array.isArray(data)) {
        setLiquidationEvents(data);
      }

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
  }, [symbol, showLiquidations, minLiqUsd, setLiquidationEvents]);

  // Периодическое обновление ликвидаций и мгновенная реакция на переключение
  useEffect(() => {
    loadLiquidations();
    if (!showLiquidations) return undefined;
    const interval = setInterval(loadLiquidations, 15000);
    return () => clearInterval(interval);
  }, [loadLiquidations, showLiquidations]);

  // Load Density Heatmap points (задача 4.5): точки отдаются в WebGL-heatmap поверх графика
  // force=true — вызов из тумблера: состояние showHeatmap ещё старое, чистим/грузим явно
  const loadHeatmap = useCallback(async (force = false) => {
    if (!chartRef.current || (!showHeatmap && !force)) {
      activeHeatmapOverlays.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
      activeHeatmapOverlays.current = [];
      setDensityPoints([]);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/heatmap?symbol=${symbol}&min_usd=${heatmapMinUsd}&limit=350`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) {
        setDensityPoints(selectDensityPoints(data, densityBudget()));
      }
    } catch (_) {}
  }, [symbol, showHeatmap, heatmapMinUsd, densityBudget]);

  // Load and render Footprint clusters inside candles (SRS M1.2b)
  const loadFootprint = useCallback(async () => {
    if (!chartRef.current || !showFootprint) {
      activeFootprintOverlays.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
      activeFootprintOverlays.current = [];
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/recorder/clusters?symbol=${symbol}&limit=48`);
      if (!res.ok) return;
      const data = await res.json();

      activeFootprintOverlays.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
      activeFootprintOverlays.current = [];

      if (!Array.isArray(data)) return;
      data.forEach(candle => {
        const levels = Array.isArray(candle.levels) ? candle.levels : [];
        if (levels.length === 0) return;
        const maxLevelVol = Math.max(...levels.map(l => (l.buy_vol || 0) + (l.sell_vol || 0)), 0);
        if (maxLevelVol <= 0) return;
        // Якорь — середина диапазона уровней, чтобы createPointFigures получил валидную координату
        const midPrice = (levels[0].price + levels[levels.length - 1].price) / 2;
        const id = chartRef.current.createOverlay({
          name: 'footprintCandle',
          lock: true,
          points: [{ timestamp: candle.timestamp, value: midPrice }],
          extendData: {
            candleTs: candle.timestamp,
            tfMs: 300000,
            levels,
            maxLevelVol,
            stacked: candle.stacked_imbalance || { buy: 0, sell: 0 },
            absorption: Boolean(candle.absorption)
          }
        });
        if (id) activeFootprintOverlays.current.push(id);
      });
    } catch (_) {}
  }, [symbol, showFootprint]);

  // Периодическое обновление футпринта, пока слой включён
  useEffect(() => {
    if (!showFootprint) return;
    loadFootprint();
    const interval = setInterval(loadFootprint, 15000);
    return () => clearInterval(interval);
  }, [showFootprint, loadFootprint]);

  // Load and render TPO/Volume Profile from recorded aggTrades (SRS M1.2a)
  const loadTpoProfile = useCallback(async () => {
    if (!chartRef.current || !showTpo) {
      activeTpoOverlays.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
      activeTpoOverlays.current = [];
      return;
    }

    try {
      const settings = readJsonSetting('chart_tpo_settings', TPO_SETTINGS_DEFAULTS);
      const params = new URLSearchParams({ symbol });
      params.set('period_minutes', String(settings.period_minutes ?? 30));
      params.set('value_area', String(settings.value_area ?? 0.7));
      if (settings.tick_size) params.set('tick_size', String(settings.tick_size));
      const res = await fetch(`${API_BASE}/profile/tpo?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();

      activeTpoOverlays.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
      activeTpoOverlays.current = [];

      if (!data || data.data_available !== true || !Array.isArray(data.rows) || data.rows.length === 0) return;
      const klines = currentKlines.current;
      if (!klines || klines.length === 0) return;
      const anchorTs = klines[klines.length - 1].timestamp;
      const anchorPrice = data.tpoc_price ?? data.poc_price ?? klines[klines.length - 1].close;

      const id = chartRef.current.createOverlay({
        name: 'tpoProfile',
        lock: true,
        points: [{ timestamp: anchorTs, value: anchorPrice }],
        extendData: {
          rows: data.rows,
          poc_price: data.poc_price,
          tpoc_price: data.tpoc_price,
          tvah_price: data.tvah_price,
          tval_price: data.tval_price,
          // Привязка к правому краю видимой области: гистограмма не «уезжает»
          // при скролле по времени (настройка из ChartToolbar).
          pinToEdge: settings.pin_to_edge !== false
        }
      });
      if (id) activeTpoOverlays.current.push(id);
    } catch (_) {}
  }, [symbol, showTpo]);

  // Render parsed orderbook walls on the chart
  const renderOrderBookWalls = useCallback((bidsRaw, asksRaw) => {
    if (!chartRef.current || !showWalls) {
      activeWallOverlays.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
      activeWallOverlays.current = [];
      return;
    }

    const klines = currentKlines.current;
    if (!klines || klines.length === 0) return;
    const anchorTs = klines[klines.length - 1].timestamp;

    const bids = (bidsRaw || []).map(([p, q]) => {
      const price = parseFloat(p);
      const qty = parseFloat(q);
      return { price, volume_usd: price * qty, side: 'BUY' };
    });

    const asks = (asksRaw || []).map(([p, q]) => {
      const price = parseFloat(p);
      const qty = parseFloat(q);
      return { price, volume_usd: price * qty, side: 'SELL' };
    });

    // Порог и бюджет стенок — из настроек ChartToolbar (localStorage),
    // дефолты сохраняют прежнее поведение ($1M top-3 / $400k fallback / top-2).
    const wallSettings = readJsonSetting('chart_walls_settings', WALL_SETTINGS_DEFAULTS);
    const minUsd = Number(wallSettings.min_usd) > 0 ? Number(wallSettings.min_usd) : 400000;

    // Top bids по порогу (fallback >= 400k, затем top 2)
    let bigBids = bids.filter(b => b.volume_usd >= 1000000).sort((a, b) => b.volume_usd - a.volume_usd).slice(0, 3);
    if (bigBids.length === 0) {
      bigBids = bids.filter(b => b.volume_usd >= minUsd).sort((a, b) => b.volume_usd - a.volume_usd).slice(0, 2);
    }
    if (bigBids.length === 0 && bids.length > 0) {
      bigBids = bids.slice().sort((a, b) => b.volume_usd - a.volume_usd).slice(0, 2);
    }

    // Top asks по порогу (fallback >= 400k, затем top 2)
    let bigAsks = asks.filter(a => a.volume_usd >= 1000000).sort((a, b) => b.volume_usd - a.volume_usd).slice(0, 3);
    if (bigAsks.length === 0) {
      bigAsks = asks.filter(a => a.volume_usd >= minUsd).sort((a, b) => b.volume_usd - a.volume_usd).slice(0, 2);
    }
    if (bigAsks.length === 0 && asks.length > 0) {
      bigAsks = asks.slice().sort((a, b) => b.volume_usd - a.volume_usd).slice(0, 2);
    }

    const densityBudget = densityMode === 'full' ? 6 : densityMode === 'compact' ? 2 : ((chartContainerRef.current?.clientWidth || 1000) < 900 ? 2 : 4);
    const maxWalls = Number(wallSettings.max_walls) > 0 ? Number(wallSettings.max_walls) : densityBudget;
    const wallBudget = Math.min(densityBudget, maxWalls);
    const wallsToRender = [...bigBids.slice(0, wallBudget), ...bigAsks.slice(0, wallBudget)];

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
  }, [showWalls, densityMode]);

  // Load and render OrderBook Densities (> $1M) as crisp horizontal levels on Chart (HTTP fallback)
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
      renderOrderBookWalls(data.bids, data.asks);
    } catch (_) {}
  }, [symbol, showWalls, renderOrderBookWalls]);

  // Live WebSocket Depth20 (@depth20@100ms) stream for real-time OrderBook Walls
  useEffect(() => {
    if (!showWalls) {
      if (depthWsRef.current) {
        try { depthWsRef.current.close(); } catch (_) {}
        depthWsRef.current = null;
      }
      activeWallOverlays.current.forEach(id => {
        try { chartRef.current?.removeOverlay({ id }); } catch (_) {}
      });
      activeWallOverlays.current = [];
      return;
    }

    let isSubCancelled = false;
    let lastRenderTs = 0;
    const cleanSym = symbol.toLowerCase().replace(/[^a-z0-9]/g, '');

    const connectDepthWs = () => {
      try {
        const ws = new WebSocket(`wss://fstream.binance.com/ws/${cleanSym}@depth20@100ms`);
        depthWsRef.current = ws;

        ws.onmessage = (event) => {
          if (isSubCancelled || depthWsRef.current !== ws) return;
          const now = Date.now();
          if (now - lastRenderTs < 350) return; // throttle updates to keep 60fps chart rendering
          lastRenderTs = now;
          try {
            const data = JSON.parse(event.data);
            if (data.b && data.a) {
              renderOrderBookWalls(data.b, data.a);
            }
          } catch (_) {}
        };

        ws.onerror = () => {
          try { ws.close(); } catch (_) {}
        };
      } catch (_) {}
    };

    connectDepthWs();

    // Periodic HTTP fallback
    loadOrderBookWalls();
    const wallTimer = setInterval(loadOrderBookWalls, 3000);

    return () => {
      isSubCancelled = true;
      clearInterval(wallTimer);
      if (depthWsRef.current) {
        try { depthWsRef.current.close(); } catch (_) {}
        depthWsRef.current = null;
      }
    };
  }, [symbol, showWalls, renderOrderBookWalls, loadOrderBookWalls]);

  useEffect(() => {
    updateVwapOverlay();
  }, [updateVwapOverlay]);

  // Смена настроек TPO/стенок из ChartToolbar → перезагрузка оверлеев
  useEffect(() => {
    const onSettingsChanged = () => {
      if (showTpo) loadTpoProfile();
      if (showWalls) loadOrderBookWalls();
    };
    window.addEventListener('signalscript:chart-settings-changed', onSettingsChanged);
    return () => window.removeEventListener('signalscript:chart-settings-changed', onSettingsChanged);
  }, [showTpo, showWalls, loadTpoProfile, loadOrderBookWalls]);

  return {
    updateVwapOverlay, loadLiquidations, loadHeatmap, loadFootprint, loadTpoProfile,
    renderOrderBookWalls, loadOrderBookWalls,
    vwapLineOverlay, activeLiqOverlays, activeWallOverlays,
  };
}
