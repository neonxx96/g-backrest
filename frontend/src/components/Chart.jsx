import React, { useEffect, useRef, useState, useCallback } from 'react';
import { init, dispose } from 'klinecharts';
import { 
  Minus, 
  MoveRight, 
  Square, 
  Hash, 
  Trash2, 
  Magnet, 
  Activity, 
  BarChart2, 
  TrendingUp,
  Save
} from 'lucide-react';

const API_BASE = "http://localhost:8000/api";

const THEME_STYLES = {
  grid: {
    horizontal: { color: '#1e222d', style: 'dash', size: 1 },
    vertical: { color: '#1e222d', style: 'dash', size: 1 }
  },
  candle: {
    type: 'candle_solid',
    bar: {
      upColor: '#089981',
      downColor: '#f23645',
      noChangeColor: '#888888',
      upBorderColor: '#089981',
      downBorderColor: '#f23645',
      noChangeBorderColor: '#888888',
      upWickColor: '#089981',
      downWickColor: '#f23645',
      noChangeWickColor: '#888888'
    },
    priceMark: {
      high: { color: '#787b86' },
      low: { color: '#787b86' },
      last: {
        upColor: '#089981',
        downColor: '#f23645',
        noChangeColor: '#888888',
        line: { style: 'dash' },
        text: { color: '#ffffff' }
      }
    }
  },
  indicator: {
    bars: [{
      style: 'fill',
      borderStyle: 'solid',
      borderSize: 1,
      upColor: '#08998166',
      downColor: '#f2364566',
      noChangeColor: '#88888866'
    }],
    lines: [
      { style: 'solid', size: 1.5, color: '#2962ff' },
      { style: 'solid', size: 1.5, color: '#ff9800' },
      { style: 'solid', size: 1.5, color: '#e91e63' }
    ]
  },
  xAxis: {
    axisLine: { color: '#2a2e39' },
    tickLine: { color: '#2a2e39' },
    tickText: { color: '#787b86' }
  },
  yAxis: {
    axisLine: { color: '#2a2e39' },
    tickLine: { color: '#2a2e39' },
    tickText: { color: '#787b86' }
  },
  crosshair: {
    horizontal: { line: { color: '#787b86', style: 'dash' }, text: { color: '#ffffff', backgroundColor: '#2a2e39' } },
    vertical: { line: { color: '#787b86', style: 'dash' }, text: { color: '#ffffff', backgroundColor: '#2a2e39' } }
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
    
    chart.setStyles(THEME_STYLES);

    // Default indicators
    try {
      chart.createIndicator('EMA', true, { id: 'candle_pane' });
      chart.createIndicator('VOL', false);
    } catch (e) {
      console.warn("Indicator init:", e);
    }

    const handleResize = () => {
      chart.resize();
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

    setStatusMsg("Загрузка данных...");

    // 1. Load history from REST API
    fetch(`${API_BASE}/klines?symbol=${symbol}&timeframe=${timeframe}&limit=300`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          chart.applyNewData(data);
          setStatusMsg("");
          loadDrawings();
        } else {
          setStatusMsg("Нет данных по монете");
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
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const k = msg.k;
        if (!k) return;

        // Only stream directly if native timeframe, or refresh current bar
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
          chart.updateData(candle);
        }
      } catch (e) {
        // ignore malformed ws messages
      }
    };

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
    .then(() => setStatusMsg("Рисунки сохранены!"))
    .catch(() => setStatusMsg("Ошибка сохранения рисунков"));

    setTimeout(() => setStatusMsg(""), 2500);
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
        chart.createIndicator('RSI');
      }
      setIndicators(prev => ({ ...prev, rsi: !prev.rsi }));
    } else if (name === 'macd') {
      if (indicators.macd) {
        chart.removeIndicator({ name: 'MACD' });
      } else {
        chart.createIndicator('MACD');
      }
      setIndicators(prev => ({ ...prev, macd: !prev.macd }));
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#131722] text-[#d1d4dc] select-none border border-[#1e222d] rounded-lg overflow-hidden">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#1e222d] border-b border-[#2a2e39] text-xs">
        {/* Drawing Tools */}
        <div className="flex items-center space-x-1">
          <button 
            title="Отрезок / Трендовая" 
            onClick={() => handleSelectTool('segment')}
            className={`p-1.5 rounded hover:bg-[#2a2e39] ${activeTool === 'segment' ? 'bg-[#2962ff] text-white' : 'text-[#787b86]'}`}
          >
            <Minus size={15} />
          </button>
          <button 
            title="Горизонтальный уровень" 
            onClick={() => handleSelectTool('horizontalStraightLine')}
            className={`p-1.5 rounded hover:bg-[#2a2e39] ${activeTool === 'horizontalStraightLine' ? 'bg-[#2962ff] text-white' : 'text-[#787b86]'}`}
          >
            <span className="font-bold text-xs">—</span>
          </button>
          <button 
            title="Луч" 
            onClick={() => handleSelectTool('rayLine')}
            className={`p-1.5 rounded hover:bg-[#2a2e39] ${activeTool === 'rayLine' ? 'bg-[#2962ff] text-white' : 'text-[#787b86]'}`}
          >
            <MoveRight size={15} />
          </button>
          <button 
            title="Прямоугольник (Зона)" 
            onClick={() => handleSelectTool('rect')}
            className={`p-1.5 rounded hover:bg-[#2a2e39] ${activeTool === 'rect' ? 'bg-[#2962ff] text-white' : 'text-[#787b86]'}`}
          >
            <Square size={14} />
          </button>
          <button 
            title="Уровни Фибоначчи" 
            onClick={() => handleSelectTool('fibonacciLine')}
            className={`p-1.5 rounded hover:bg-[#2a2e39] ${activeTool === 'fibonacciLine' ? 'bg-[#2962ff] text-white' : 'text-[#787b86]'}`}
          >
            <Hash size={14} />
          </button>

          <div className="h-4 w-px bg-[#2a2e39] mx-1" />

          <button 
            title="Магнит к свечам" 
            onClick={() => setMagnetEnabled(!magnetEnabled)}
            className={`p-1.5 rounded hover:bg-[#2a2e39] ${magnetEnabled ? 'bg-[#089981] text-white' : 'text-[#787b86]'}`}
          >
            <Magnet size={14} />
          </button>

          <button 
            title="Очистить все рисунки" 
            onClick={handleClearDrawings}
            className="p-1.5 rounded hover:bg-[#2a2e39] text-[#f23645]"
          >
            <Trash2 size={14} />
          </button>

          <button 
            title="Сохранить рисунки в профиль" 
            onClick={saveDrawings}
            className="p-1.5 rounded hover:bg-[#2a2e39] text-[#089981]"
          >
            <Save size={14} />
          </button>
        </div>

        {/* Indicators and Status */}
        <div className="flex items-center space-x-2">
          {statusMsg && (
            <span className="text-[#ff9800] text-xs font-mono animate-pulse">{statusMsg}</span>
          )}
          
          <button 
            onClick={() => toggleIndicator('rsi')}
            className={`px-2 py-1 rounded text-xs font-semibold ${indicators.rsi ? 'bg-[#2962ff] text-white' : 'bg-[#2a2e39] text-[#787b86]'}`}
          >
            RSI(14)
          </button>
          <button 
            onClick={() => toggleIndicator('macd')}
            className={`px-2 py-1 rounded text-xs font-semibold ${indicators.macd ? 'bg-[#2962ff] text-white' : 'bg-[#2a2e39] text-[#787b86]'}`}
          >
            MACD
          </button>
        </div>
      </div>

      {/* Main Chart Canvas Container */}
      <div 
        ref={chartContainerRef} 
        className="flex-1 w-full h-full relative" 
        style={{ minHeight: '400px' }} 
      />
    </div>
  );
}
