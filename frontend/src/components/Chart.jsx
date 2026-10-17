import React, { useEffect, useRef, useState, useCallback } from 'react';
import { init, dispose } from 'klinecharts';
import { 
  Minus, 
  MoveRight, 
  Square, 
  Hash, 
  Trash2, 
  Magnet, 
  Save,
  Maximize2
} from 'lucide-react';

const API_BASE = "/api";

const THEME_STYLES = {
  grid: {
    show: true,
    horizontal: { color: '#161b26', style: 'dash', size: 1, dashedValue: [3, 3] },
    vertical: { color: '#161b26', style: 'dash', size: 1, dashedValue: [3, 3] }
  },
  candle: {
    type: 'candle_solid',
    bar: {
      upColor: '#00c087',
      downColor: '#f6465d',
      noChangeColor: '#848e9c',
      upBorderColor: '#00c087',
      downBorderColor: '#f6465d',
      noChangeBorderColor: '#848e9c',
      upWickColor: '#00c087',
      downWickColor: '#f6465d',
      noChangeWickColor: '#848e9c'
    },
    priceMark: {
      show: true,
      high: { show: true, color: '#848e9c', textSize: 10 },
      low: { show: true, color: '#848e9c', textSize: 10 },
      last: {
        show: true,
        upColor: '#00c087',
        downColor: '#f6465d',
        noChangeColor: '#848e9c',
        line: { show: true, style: 'dash', dashedValue: [4, 4], size: 1 },
        text: { show: true, color: '#ffffff', size: 11, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 }
      }
    }
  },
  indicator: {
    bars: [{
      style: 'fill',
      borderStyle: 'solid',
      borderSize: 1,
      upColor: '#00c08740',
      downColor: '#f6465d40',
      noChangeColor: '#848e9c40'
    }],
    lines: [
      { style: 'solid', size: 1.5, color: '#2962ff' }, // EMA 20 Blue
      { style: 'solid', size: 1.5, color: '#f59e0b' }, // EMA 50 Orange
      { style: 'solid', size: 1.5, color: '#ec4899' }  // Pink
    ]
  },
  xAxis: {
    axisLine: { show: true, color: '#1f2937' },
    tickLine: { show: true, color: '#1f2937' },
    tickText: { color: '#848e9c', size: 11 }
  },
  yAxis: {
    axisLine: { show: true, color: '#1f2937' },
    tickLine: { show: true, color: '#1f2937' },
    tickText: { color: '#848e9c', size: 11 }
  },
  crosshair: {
    show: true,
    horizontal: { show: true, line: { color: '#6b7280', style: 'dash', dashedValue: [3, 3] }, text: { color: '#ffffff', backgroundColor: '#1f2937' } },
    vertical: { show: true, line: { color: '#6b7280', style: 'dash', dashedValue: [3, 3] }, text: { color: '#ffffff', backgroundColor: '#1f2937' } }
  }
};

export default function Chart({ symbol = "BTCUSDT", timeframe = "15m", userId = "0" }) {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const wsRef = useRef(null);
  
  const [activeTool, setActiveTool] = useState(null);
  const [magnetEnabled, setMagnetEnabled] = useState(false);
  const [indicators, setIndicators] = useState({ ema: true, vol: true, rsi: false, macd: false });
  const [statusMsg, setStatusMsg] = useState("");

  // Initialize KLineChart instance
  useEffect(() => {
    if (!chartContainerRef.current) return;
    
    const chart = init(chartContainerRef.current);
    chartRef.current = chart;
    
    // Apply custom dark theme
    chart.setStyles(THEME_STYLES);

    // Default indicators
    try {
      chart.createIndicator('EMA', true, { id: 'candle_pane' });
      chart.createIndicator('VOL', false);
    } catch (e) {
      console.warn("Indicator init warning:", e);
    }

    const handleResize = () => {
      if (chartRef.current) chartRef.current.resize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      dispose(chartContainerRef.current);
      chartRef.current = null;
    };
  }, []);

  // Fetch history candles & subscribe live WebSocket
  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;

    setStatusMsg("Загрузка...");

    // 1. Load history from REST API
    fetch(`${API_BASE}/klines?symbol=${symbol}&timeframe=${timeframe}&limit=250`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          chart.applyNewData(data);
          setStatusMsg("");
          loadDrawings();
          // Adjust view
          chart.resize();
        } else {
          setStatusMsg("Нет данных");
        }
      })
      .catch(err => {
        console.error("Error fetching klines:", err);
        setStatusMsg("Ошибка загрузки");
      });

    // 2. Setup WebSocket live update
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Supported native intervals on Binance ws
    const wsInterval = (timeframe === "45m" || timeframe === "6h") ? (timeframe === "45m" ? "15m" : "1h") : timeframe;
    const wsUrl = `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@kline_${wsInterval}`;
    
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const k = msg.k;
          if (!k || !chartRef.current) return;

          // Native interval live update
          if (timeframe !== "45m" && timeframe !== "6h") {
            const candle = {
              timestamp: k.t,
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: parseFloat(k.c),
              volume: parseFloat(k.v),
              turnover: parseFloat(k.q)
            };
            chartRef.current.updateData(candle);
          }
        } catch (e) {
          // ignore
        }
      };
    } catch (e) {
      console.warn("WebSocket connect error:", e);
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [symbol, timeframe]);

  // Load drawings from backend
  const loadDrawings = useCallback(() => {
    fetch(`${API_BASE}/drawings?symbol=${symbol}&timeframe=${timeframe}&user_id=${userId}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.elements_json && chartRef.current) {
          try {
            const list = JSON.parse(data.elements_json);
            if (Array.isArray(list)) {
              list.forEach(overlay => {
                chartRef.current.createOverlay(overlay);
              });
            }
          } catch (e) {
            console.error("Failed to parse drawings:", e);
          }
        }
      })
      .catch(e => console.error("Could not load drawings:", e));
  }, [symbol, timeframe, userId]);

  // Save drawings to backend
  const saveDrawings = () => {
    if (!chartRef.current) return;
    const overlays = chartRef.current.getOverlays();
    const saveList = overlays.map(o => ({
      name: o.name,
      points: o.points,
      styles: o.styles
    }));

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
    .then(() => setStatusMsg("Сохранено!"))
    .catch(() => setStatusMsg("Ошибка сохранения"));

    setTimeout(() => setStatusMsg(""), 2000);
  };

  // Drawing tool selection
  const handleSelectTool = (toolName) => {
    if (!chartRef.current) return;
    setActiveTool(toolName);
    chartRef.current.createOverlay({
      name: toolName,
      lock: false,
      mode: 'normal'
    });
  };

  const handleClearDrawings = () => {
    if (!chartRef.current) return;
    chartRef.current.removeOverlay();
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
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#0e1118] text-[#d1d4dc] select-none border border-[#1b212f] rounded-lg overflow-hidden shadow-2xl">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#121620] border-b border-[#1b212f] text-xs">
        {/* Drawing Tools */}
        <div className="flex items-center space-x-1">
          <button 
            title="Отрезок / Трендовая линия" 
            onClick={() => handleSelectTool('segment')}
            className={`px-2 py-1 rounded transition flex items-center ${activeTool === 'segment' ? 'bg-[#2563eb] text-white' : 'text-[#848e9c] hover:bg-[#1a2130] hover:text-white'}`}
          >
            <Minus size={14} className="mr-1" />
            <span className="text-[11px]">Трендовая</span>
          </button>
          
          <button 
            title="Горизонтальный уровень" 
            onClick={() => handleSelectTool('horizontalStraightLine')}
            className={`px-2 py-1 rounded transition flex items-center ${activeTool === 'horizontalStraightLine' ? 'bg-[#2563eb] text-white' : 'text-[#848e9c] hover:bg-[#1a2130] hover:text-white'}`}
          >
            <span className="font-mono text-xs mr-1">—</span>
            <span className="text-[11px]">Уровень</span>
          </button>

          <button 
            title="Луч" 
            onClick={() => handleSelectTool('rayLine')}
            className={`p-1.5 rounded transition ${activeTool === 'rayLine' ? 'bg-[#2563eb] text-white' : 'text-[#848e9c] hover:bg-[#1a2130] hover:text-white'}`}
          >
            <MoveRight size={14} />
          </button>

          <button 
            title="Прямоугольник (Зона плотности/имбаланса)" 
            onClick={() => handleSelectTool('rect')}
            className={`p-1.5 rounded transition ${activeTool === 'rect' ? 'bg-[#2563eb] text-white' : 'text-[#848e9c] hover:bg-[#1a2130] hover:text-white'}`}
          >
            <Square size={13} />
          </button>

          <button 
            title="Уровни Фибоначчи" 
            onClick={() => handleSelectTool('fibonacciLine')}
            className={`p-1.5 rounded transition ${activeTool === 'fibonacciLine' ? 'bg-[#2563eb] text-white' : 'text-[#848e9c] hover:bg-[#1a2130] hover:text-white'}`}
          >
            <Hash size={13} />
          </button>

          <div className="h-4 w-px bg-[#1f2937] mx-1" />

          <button 
            title="Магнит" 
            onClick={() => setMagnetEnabled(!magnetEnabled)}
            className={`p-1.5 rounded transition ${magnetEnabled ? 'bg-[#00c087] text-white' : 'text-[#848e9c] hover:bg-[#1a2130] hover:text-white'}`}
          >
            <Magnet size={13} />
          </button>

          <button 
            title="Очистить рисунки" 
            onClick={handleClearDrawings}
            className="p-1.5 rounded text-[#f6465d] hover:bg-[#f6465d22] transition"
          >
            <Trash2 size={13} />
          </button>

          <button 
            title="Сохранить рисунки" 
            onClick={saveDrawings}
            className="p-1.5 rounded text-[#00c087] hover:bg-[#00c08722] transition"
          >
            <Save size={13} />
          </button>
        </div>

        {/* Indicators and Status */}
        <div className="flex items-center space-x-2">
          {statusMsg && (
            <span className="text-[#f59e0b] text-[11px] font-mono animate-pulse mr-2">{statusMsg}</span>
          )}
          
          <button 
            onClick={() => toggleIndicator('rsi')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${indicators.rsi ? 'bg-[#2563eb] text-white' : 'bg-[#1a2130] text-[#848e9c] hover:text-white'}`}
          >
            RSI
          </button>
          
          <button 
            onClick={() => toggleIndicator('macd')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${indicators.macd ? 'bg-[#2563eb] text-white' : 'bg-[#1a2130] text-[#848e9c] hover:text-white'}`}
          >
            MACD
          </button>
        </div>
      </div>

      {/* Main Chart Canvas Container */}
      <div 
        ref={chartContainerRef} 
        className="flex-1 w-full h-full relative" 
        style={{ minHeight: '450px', backgroundColor: '#0e1118' }} 
      />
    </div>
  );
}
