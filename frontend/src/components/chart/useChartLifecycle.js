import { useEffect } from 'react';
import { init, dispose } from 'klinecharts';
import { fetchKlinesDualSource, TF_MS } from '../../services/marketDataFetcher';
import { buildChartStyles } from './chartStyles.js';

const API_BASE = "/api";

// Жизненный цикл графика: инициализация KLineCharts v9 (init/dispose,
// scroll/zoom, pane options, начальные индикаторы, crosshair-sync, zoom
// clamping 3..60px, ResizeObserver), dual-source подгрузка свечей
// (fetchKlinesDualSource, deep window 1500 баров, бесконечный скролл-назад
// chart.loadMore до дневного пола), живой WebSocket kline (failover
// spot/futures, кастомные TF 45m/6h, heartbeat-fallback REST каждые 3с).
// Извлечено ДОСЛОВНО из Chart.jsx (слайс 6.4l, п.1 MODULARIZATION_PLAN).
// Колбэки restore-слоёв (loadDrawings/updateVwapOverlay/loadLiquidations/
// loadHeatmap/loadFootprint/loadTpoProfile) приходят пропами из Chart.jsx.

export function useChartLifecycle({
  chartContainerRef, chartRef, chartId, uiConfig, wsRef,
  chartReady, setChartReady, setChartInstance,
  symbol, timeframe, currentKlines, setStatusMsg, setErrorDetails, setKlinesVersion,
  loadDrawings, updateVwapOverlay, loadLiquidations, loadHeatmap, loadFootprint, loadTpoProfile,
}) {
// Binance на запрос); скролл влево подгружает более старые окна через
// chart.loadMore до дневного пола истории (приёмка: 1m/1h >= 30д, 45m/6h >= 14д).
const INITIAL_HISTORY_BARS = 1500;
const LOAD_MORE_WINDOW_BARS = 1500;
const HISTORY_FLOOR_DAYS = {
  '1m': 30, '5m': 30, '15m': 45, '30m': 60,
  '45m': 30, '1h': 90, '4h': 180, '6h': 180
};

  // Initialize KLineChart instance with ResizeObserver (ТАКТ 1)
  useEffect(() => {
    if (!chartContainerRef.current) return;
    
    try {
      dispose(chartContainerRef.current);
    } catch (_) {}

    const chart = init(chartContainerRef.current);
    chartRef.current = chart;
    setChartInstance(chart);
    window.__charts = window.__charts || {};
    window.__charts[chartId] = chart;
    if (chartId === 'primary' || !window.__chart) {
      window.__chart = chart;
    }

    // Explicitly enable scroll & zoom navigation
    chart.setScrollEnabled(true);
    chart.setZoomEnabled(true);
    try {
      chart.setPaneOptions({ id: 'candle_pane', dragEnabled: true, axisOptions: { scrollZoomEnabled: true } });
    } catch (_) {}

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

    // Zoom Clamping: clamp barSpace between 3px (max zoom out) and 60px (max zoom in)
    // Prevents canvas division by zero and overlay distortion during mouse wheel zoom
    try {
      chart.subscribeAction('onZoom', () => {
        try {
          const bs = chart.getBarSpace();
          if (typeof bs === 'number' && Number.isFinite(bs)) {
            if (bs < 3) {
              chart.setBarSpace(3);
            } else if (bs > 60) {
              chart.setBarSpace(60);
            }
          }
        } catch (_) {}
      });
    } catch (_) {}

    setChartReady(prev => prev + 1);

    let rafId = null;
    const handleResize = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (chartRef.current) {
          try {
            chartRef.current.resize();
            window.__chartResizeCounts = window.__chartResizeCounts || {};
            window.__chartResizeCounts[chartId] = (window.__chartResizeCounts[chartId] || 0) + 1;
          } catch (_) {}
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

  // Fetch history candles & subscribe live WebSocket
  useEffect(() => {
    if (!chartRef.current || chartReady === 0) return;
    const chart = chartRef.current;
    let isCancelled = false;

    // Instantly wipe previous coin's candles so old ticker data never lingers
    try {
      chart.clearData();
    } catch (_) {}
    currentKlines.current = [];
    setStatusMsg(`Загрузка свечей ${symbol}...`);
    setErrorDetails(null);

    // Timeframe step in ms (window math for initial deep load and scroll-back)
    const tfMs = TF_MS[timeframe] || 900000;

    const fetchKlines = async () => {
      try {
        // Deep initial window: startTime is always passed (Шаг A);
        // the backend paginates server-side if the window exceeds one request.
        const { candles, source } = await fetchKlinesDualSource({
          symbol,
          timeframe,
          startTime: Date.now() - INITIAL_HISTORY_BARS * tfMs
        });

        if (isCancelled) return;

        if (Array.isArray(candles) && candles.length > 0) {
          currentKlines.current = candles;
          window.__historyOldestTs = candles[0]?.timestamp ?? null;
          window.__historyLoadedBars = candles.length;
          chart.applyNewData(candles, true);
          setStatusMsg("");
          setErrorDetails(null);

          // Restore saved drawings, vwap, liquidations, and heatmap
          loadDrawings();
          updateVwapOverlay(candles);
          loadLiquidations();
          loadHeatmap();
          loadFootprint();
          loadTpoProfile();
          setKlinesVersion((v) => v + 1);
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

    // --- Шаг A: бесконечный скролл-назад (chart.loadMore) ----------------------
    // KLineCharts v9 вызывает колбэк с timestamp самой старой загруженной свечи,
    // когда пользователь доскроллил к левому краю. Догружаем более старое окно
    // через пагинированный dual-source конвейер и восстанавливаем вьюпорт,
    // пока не достигнут дневной пол истории или конец данных Binance.
    const floorTs = Date.now() - (HISTORY_FLOOR_DAYS[timeframe] ?? 30) * 86400000;
    let loadingOlder = false;
    let historyExhausted = false;

    try {
      chart.loadMore(async (oldestTs) => {
        if (isCancelled || loadingOlder || historyExhausted) return;
        if (oldestTs == null) return;
        if (oldestTs <= floorTs) { historyExhausted = true; return; }
        loadingOlder = true;
        try {
          const windowEnd = oldestTs - 1;
          const windowStart = Math.max(floorTs, windowEnd - LOAD_MORE_WINDOW_BARS * tfMs);
          const { candles } = await fetchKlinesDualSource({
            symbol,
            timeframe,
            startTime: windowStart,
            endTime: windowEnd
          });
          if (isCancelled) return;
          if (!Array.isArray(candles) || candles.length === 0) {
            historyExhausted = true;
            return;
          }
          // Слияние с ЖИВЫМ списком графика (WS мог дописать новые свечи).
          let existing = [];
          try { existing = chart.getDataList() || []; } catch (_) { existing = []; }
          const seen = new Set(existing.map(c => c && c.timestamp));
          const older = candles.filter(c => c && !seen.has(c.timestamp));
          if (older.length === 0) { historyExhausted = true; return; }
          const merged = [...older, ...existing]
            .filter(c => c && c.timestamp != null)
            .sort((a, b) => a.timestamp - b.timestamp);
          currentKlines.current = merged;
          window.__historyOldestTs = merged[0].timestamp;
          window.__historyLoadedBars = merged.length;
          const moreAvailable = merged[0].timestamp > floorTs;
          let restoreTs = null;
          try {
            const range = chart.getVisibleRange();
            restoreTs = range?.from?.timestamp ?? null;
          } catch (_) {}
          chart.applyNewData(merged, moreAvailable, () => {
            if (restoreTs != null) {
              try { chart.scrollToTimestamp(restoreTs, 0); } catch (_) {}
            }
          });
          setKlinesVersion(v => v + 1);
        } catch (err) {
          console.warn('Deep history window load failed:', err?.message || err);
          historyExhausted = true;
        } finally {
          loadingOlder = false;
        }
      });
    } catch (_) {}

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
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.onopen = null;
          wsRef.current.onmessage = null;
          wsRef.current.onerror = null;
          wsRef.current.onclose = null;
          wsRef.current.close();
        } catch (_) {}
        wsRef.current = null;
      }

      const activeUrl = wsEndpoints[endpointIdx % wsEndpoints.length];

      try {
        const ws = new WebSocket(activeUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (isCancelled || wsRef.current !== ws) return;
          lastTickTime = Date.now();
        };

        ws.onmessage = (event) => {
          if (isCancelled || wsRef.current !== ws) return;
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
          if (!isCancelled && wsRef.current === ws) {
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

    const handleNetworkOnline = () => {
      if (isCancelled) return;
      connectWs();
      fetchKlines();
    };
    window.addEventListener('online', handleNetworkOnline);

    connectWs();

    // Heartbeat fallback: checks every 3s; if no tick received for > 4.5s, polls REST endpoint
    heartbeatTimer = setInterval(async () => {
      if (isCancelled || !chartRef.current) return;
      if (Date.now() - lastTickTime > 4500) {
        try {
          const r = await fetch(`${API_BASE}/klines?symbol=${symbol}&timeframe=${timeframe}&limit=2`);
          if (r.ok && !isCancelled) {
            const data = await r.json();
            if (Array.isArray(data) && data.length > 0 && chartRef.current) {
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

        if (!wsRef.current || (wsRef.current.readyState !== WebSocket.OPEN && wsRef.current.readyState !== WebSocket.CONNECTING)) {
          endpointIdx++;
          connectWs();
        }
      }
    }, 3000);

    return () => {
      isCancelled = true;
      window.removeEventListener('online', handleNetworkOnline);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (wsRef.current) {
        try {
          wsRef.current.onopen = null;
          wsRef.current.onmessage = null;
          wsRef.current.onerror = null;
          wsRef.current.onclose = null;
          wsRef.current.close();
        } catch (_) {}
        wsRef.current = null;
      }
    };
  }, [symbol, timeframe, chartReady, loadDrawings]);
}
