import React, { useEffect, useRef, useState, useCallback } from 'react';
import { init, dispose, registerOverlay } from 'klinecharts';
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
  Check
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

// Tealstreet dark minimal theme configuration
const THEME_STYLES = {
  grid: {
    show: true,
    horizontal: { color: '#12141c', style: 'dash', size: 1, dashedValue: [2, 4] },
    vertical: { color: '#12141c', style: 'dash', size: 1, dashedValue: [2, 4] }
  },
  candle: {
    type: 'candle_solid',
    bar: {
      upColor: '#26a69a',
      downColor: '#ef5350',
      noChangeColor: '#787f91',
      upBorderColor: '#26a69a',
      downBorderColor: '#ef5350',
      noChangeBorderColor: '#787f91',
      upWickColor: '#26a69a',
      downWickColor: '#ef5350',
      noChangeWickColor: '#787f91'
    },
    priceMark: {
      show: true,
      high: { show: true, color: '#787f91', textSize: 10 },
      low: { show: true, color: '#787f91', textSize: 10 },
      last: {
        show: true,
        upColor: '#26a69a',
        downColor: '#ef5350',
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
      upColor: 'rgba(38, 166, 154, 0.25)',
      downColor: 'rgba(239, 83, 80, 0.25)',
      noChangeColor: 'rgba(120, 127, 145, 0.25)'
    }],
    lines: [
      { style: 'solid', size: 1.5, color: '#38bdf8' }, // EMA 20 Cyan/Blue
      { style: 'solid', size: 1.5, color: '#f59e0b' }, // EMA 50 Amber
      { style: 'solid', size: 1.5, color: '#a855f7' }  // Purple
    ]
  },
  xAxis: {
    axisLine: { show: true, color: '#161922' },
    tickLine: { show: true, color: '#161922' },
    tickText: { color: '#60697b', size: 10, family: 'var(--font-mono)' }
  },
  yAxis: {
    axisLine: { show: true, color: '#161922' },
    tickLine: { show: true, color: '#161922' },
    tickText: { color: '#60697b', size: 10, family: 'var(--font-mono)' }
  },
  crosshair: {
    show: true,
    horizontal: { show: true, line: { color: '#2a3142', style: 'dash', dashedValue: [3, 3] }, text: { color: '#ffffff', backgroundColor: '#181c26' } },
    vertical: { show: true, line: { color: '#2a3142', style: 'dash', dashedValue: [3, 3] }, text: { color: '#ffffff', backgroundColor: '#181c26' } }
  }
};

export default function Chart({ symbol = "BTCUSDT", timeframe = "15m", userId = "0" }) {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const wsRef = useRef(null);
  const selectedOverlayId = useRef(null);
  const trackedOverlays = useRef(new Map()); // id -> overlay data
  
  const [chartReady, setChartReady] = useState(0);
  const [activeTool, setActiveTool] = useState(null);
  const [magnetEnabled, setMagnetEnabled] = useState(false);
  const [indicators, setIndicators] = useState({ ema: true, vol: true, rsi: true, macd: true });
  const [statusMsg, setStatusMsg] = useState("");
  const [errorDetails, setErrorDetails] = useState(null);

  // Context Menu State (Task 6)
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0 });

  // Initialize KLineChart instance
  useEffect(() => {
    if (!chartContainerRef.current) return;
    
    try {
      dispose(chartContainerRef.current);
    } catch (_) {}

    const chart = init(chartContainerRef.current);
    chartRef.current = chart;
    window.__chart = chart;

    // Apply custom dark theme
    chart.setStyles(THEME_STYLES);

    // Set timezone to Europe/Kyiv
    try {
      chart.setTimezone('Europe/Kyiv');
    } catch (e) {
      console.warn("Timezone set warning:", e);
    }

    // Default indicators: EMA on candles, Volume, RSI, MACD sub-panes
    try {
      chart.createIndicator('EMA', true, { id: 'candle_pane' });
      chart.createIndicator('VOL', false);
      chart.createIndicator('RSI', false);
      chart.createIndicator('MACD', false);
    } catch (e) {
      console.warn("Indicator init warning:", e);
    }

    setChartReady(prev => prev + 1);

    const handleResize = () => {
      if (chartRef.current) chartRef.current.resize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      try {
        dispose(chartContainerRef.current);
      } catch (_) {}
      chartRef.current = null;
    };
  }, []);

  // Save drawings to backend
  const saveDrawings = useCallback(() => {
    if (!chartRef.current) return;
    
    const saveList = [];
    
    // Method 1: Check internal _chartStore overlay instance map
    try {
      const store = chartRef.current._chartStore?.getOverlayStore();
      if (store && store._instances) {
        for (const instances of store._instances.values()) {
          instances.forEach(inst => {
            if (inst && inst.points && inst.points.length > 0) {
              saveList.push({
                name: inst.name,
                points: inst.points,
                styles: inst.styles
              });
            }
          });
        }
      }
    } catch (_) {}

    // Method 2: Fallback to trackedOverlays ref if store not directly accessible
    if (saveList.length === 0 && trackedOverlays.current.size > 0) {
      for (const [id, data] of trackedOverlays.current.entries()) {
        const inst = chartRef.current.getOverlayById(id);
        if (inst && inst.points && inst.points.length > 0) {
          saveList.push({
            name: inst.name || data.name,
            points: inst.points,
            styles: inst.styles
          });
        } else if (data && data.points) {
          saveList.push(data);
        }
      }
    }

    fetch(`${API_BASE}/drawings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        symbol: symbol.toUpperCase(),
        timeframe,
        elements_json: JSON.stringify(saveList)
      })
    })
    .then(res => res.json())
    .then(() => {
      setStatusMsg("Сохранено!");
      setTimeout(() => setStatusMsg(""), 1500);
    })
    .catch(() => {});
  }, [symbol, timeframe, userId]);

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
              chartRef.current.removeOverlay();
              trackedOverlays.current.clear();
              list.forEach(overlay => {
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

  // Hotkey listener for Delete/Backspace on active overlay & Escape to cancel tool / context menu
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

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
  }, [symbol, timeframe, userId, saveDrawings]);

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

          chart.applyNewData(formattedData);
          setStatusMsg("");
          setErrorDetails(null);

          // Restore saved drawings for this symbol & TF
          loadDrawings();
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

    // Live Binance WebSocket Kline stream
    const binanceInterval = timeframe === '45m' ? '15m' : (timeframe === '6h' ? '1h' : timeframe);
    const cleanSym = symbol.toLowerCase();
    const wsUrl = `wss://fstream.binance.com/ws/${cleanSym}@kline_${binanceInterval}`;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          const k = payload.k;
          if (!k || !chartRef.current) return;

          const bar = {
            timestamp: Number(k.t),
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            turnover: parseFloat(k.q)
          };

          chartRef.current.updateData(bar);
        } catch (e) {
          console.warn("WS candle error:", e);
        }
      };
    } catch (e) {
      console.warn("WebSocket init error:", e);
    }

    return () => {
      isCancelled = true;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [symbol, timeframe, chartReady, loadDrawings]);

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
        }
        saveDrawings();
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
    }
  };

  const handleClearDrawings = () => {
    if (!chartRef.current) return;
    chartRef.current.removeOverlay();
    trackedOverlays.current.clear();
    selectedOverlayId.current = null;
    setActiveTool(null);
    saveDrawings();
  };

  // Toggle indicators
  const toggleIndicator = (name) => {
    if (!chartRef.current) return;
    const chart = chartRef.current;
    
    if (name === 'rsi') {
      if (indicators.rsi) {
        chart.removeIndicator({ name: 'RSI' });
      } else {
        chart.createIndicator('RSI', false);
      }
      setIndicators(prev => ({ ...prev, rsi: !prev.rsi }));
    } else if (name === 'macd') {
      if (indicators.macd) {
        chart.removeIndicator({ name: 'MACD' });
      } else {
        chart.createIndicator('MACD', false);
      }
      setIndicators(prev => ({ ...prev, macd: !prev.macd }));
    } else if (name === 'ema') {
      if (indicators.ema) {
        chart.removeIndicator('candle_pane', 'EMA');
      } else {
        chart.createIndicator('EMA', true, { id: 'candle_pane' });
      }
      setIndicators(prev => ({ ...prev, ema: !prev.ema }));
    } else if (name === 'vol') {
      if (indicators.vol) {
        chart.removeIndicator({ name: 'VOL' });
      } else {
        chart.createIndicator('VOL', false);
      }
      setIndicators(prev => ({ ...prev, vol: !prev.vol }));
    }
  };

  // Right-Click Context Menu handler (Task 6)
  const handleContextMenu = (e) => {
    e.preventDefault();
    const bounds = chartContainerRef.current?.getBoundingClientRect();
    if (!bounds) return;

    // Constrain context menu within canvas
    const x = Math.min(e.clientX, bounds.right - 190);
    const y = Math.min(e.clientY, bounds.bottom - 220);

    setContextMenu({ visible: true, x, y });
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
    <div className="flex flex-col h-full w-full bg-[#0c0e12] text-[#d1d4dc] select-none border border-[#161922] overflow-hidden relative font-sans">
      {/* Top Drawing & Indicator Bar (Tealstreet style: ultra compact, flat, 1px lines) */}
      <div className="flex items-center justify-between px-2.5 py-1 bg-[#101217] border-b border-[#161922] text-xs">
        {/* Drawing Tools */}
        <div className="flex items-center space-x-0.5">
          <button 
            title="Трендовая линия (Отрезок)" 
            onClick={() => handleSelectTool('segment')}
            className={`px-2 py-0.5 rounded text-[11px] font-mono flex items-center transition ${activeTool === 'segment' ? 'bg-[#2563eb] text-white' : 'text-[#787f91] hover:bg-[#161922] hover:text-white'}`}
          >
            <Minus size={13} className="mr-1" />
            <span>Линия</span>
          </button>
          
          <button 
            title="Горизонтальный уровень (Price Line)" 
            onClick={() => handleSelectTool('horizontalStraightLine')}
            className={`px-2 py-0.5 rounded text-[11px] font-mono flex items-center transition ${activeTool === 'horizontalStraightLine' ? 'bg-[#2563eb] text-white' : 'text-[#787f91] hover:bg-[#161922] hover:text-white'}`}
          >
            <span className="font-mono text-xs mr-1">—</span>
            <span>Уровень</span>
          </button>

          <button 
            title="Луч (Ray Line)" 
            onClick={() => handleSelectTool('rayLine')}
            className={`p-1 rounded transition ${activeTool === 'rayLine' ? 'bg-[#2563eb] text-white' : 'text-[#787f91] hover:bg-[#161922] hover:text-white'}`}
          >
            <MoveRight size={13} />
          </button>

          <button 
            title="Прямоугольник (Зона плотности / имбаланс)" 
            onClick={() => handleSelectTool('rect')}
            className={`p-1 rounded transition ${activeTool === 'rect' ? 'bg-[#2563eb] text-white' : 'text-[#787f91] hover:bg-[#161922] hover:text-white'}`}
          >
            <Square size={12} />
          </button>

          <button 
            title="Уровни Фибоначчи" 
            onClick={() => handleSelectTool('fibonacciLine')}
            className={`p-1 rounded transition ${activeTool === 'fibonacciLine' ? 'bg-[#2563eb] text-white' : 'text-[#787f91] hover:bg-[#161922] hover:text-white'}`}
          >
            <Hash size={12} />
          </button>

          <button 
            title="Линейка (Замер % и пунктов)" 
            onClick={() => handleSelectTool('measure')}
            className={`p-1 rounded transition ${activeTool === 'measure' ? 'bg-[#2563eb] text-white' : 'text-[#787f91] hover:bg-[#161922] hover:text-white'}`}
          >
            <Ruler size={13} />
          </button>

          <div className="h-3.5 w-px bg-[#1f2430] mx-1" />

          <button 
            title={magnetEnabled ? "Магнит включен (к свечам)" : "Магнит выключен"} 
            onClick={() => setMagnetEnabled(!magnetEnabled)}
            className={`p-1 rounded transition ${magnetEnabled ? 'bg-[#26a69a] text-white' : 'text-[#787f91] hover:bg-[#161922] hover:text-white'}`}
          >
            <Magnet size={13} />
          </button>

          <button 
            title="Очистить все рисунки" 
            onClick={handleClearDrawings}
            className="p-1 rounded text-[#787f91] hover:text-[#ef5350] hover:bg-[#ef535018] transition"
          >
            <Trash2 size={13} />
          </button>

          <button 
            title="Сохранить рисунки" 
            onClick={saveDrawings}
            className="p-1 rounded text-[#787f91] hover:text-[#26a69a] hover:bg-[#26a69a18] transition"
          >
            <Save size={13} />
          </button>
        </div>

        {/* Indicators and Status */}
        <div className="flex items-center space-x-1 font-mono-numbers">
          {statusMsg && (
            <span className="text-[#f59e0b] text-[10px] font-mono animate-pulse mr-1">{statusMsg}</span>
          )}
          
          <button 
            onClick={() => toggleIndicator('ema')}
            className={`px-1.5 py-0.2 rounded text-[10px] font-mono transition ${indicators.ema ? 'bg-[#1e293b] text-[#38bdf8] border border-[#38bdf840]' : 'text-[#60697b] hover:text-white'}`}
          >
            EMA
          </button>

          <button 
            onClick={() => toggleIndicator('vol')}
            className={`px-1.5 py-0.2 rounded text-[10px] font-mono transition ${indicators.vol ? 'bg-[#1e293b] text-[#26a69a] border border-[#26a69a40]' : 'text-[#60697b] hover:text-white'}`}
          >
            VOL
          </button>

          <button 
            onClick={() => toggleIndicator('rsi')}
            className={`px-1.5 py-0.2 rounded text-[10px] font-mono transition ${indicators.rsi ? 'bg-[#1e293b] text-[#a855f7] border border-[#a855f740]' : 'text-[#60697b] hover:text-white'}`}
          >
            RSI
          </button>
          
          <button 
            onClick={() => toggleIndicator('macd')}
            className={`px-1.5 py-0.2 rounded text-[10px] font-mono transition ${indicators.macd ? 'bg-[#1e293b] text-[#f59e0b] border border-[#f59e0b40]' : 'text-[#60697b] hover:text-white'}`}
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

        {/* Right-Click Context Menu (Task 6) */}
        {contextMenu.visible && (
          <div 
            style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
            className="fixed z-50 bg-[#101217] border border-[#1f2430] rounded shadow-2xl py-1 w-48 text-[11px] font-mono text-[#d1d4dc] backdrop-blur-md select-none"
            onClick={(e) => e.stopPropagation()}
          >
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
