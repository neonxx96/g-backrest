import { useState, useEffect, useCallback, useRef } from 'react';
import { renderLiveSignals, clearLiveSignals, renderWhaleTrades, clearWhaleTrades } from '../../utils/chartAnnotations';
import { useTradesStore } from '../../stores/tradesStore';
import { useMarketDataStore } from '../../stores/marketDataStore';
import { collectOpenPositions } from './livePositions';
import { TF_MS } from '../../services/marketDataFetcher';

// Аннотации и сигнальные оверлеи графика: бэктест-маркеры/линии сделок (btSignal/
// backtestTradeLine) с тултипом, paper-сделки, live-сигналы алгоритма, whale-принты
// >= $500k, уровни AI-ассистента (strategyLevelZone), конус волатильности
// (volatilityCone, расчёт ATR-фана из klines), positionSetupBox по событию
// apply-position-setup, strategyLevels-зоны, toxic-regime polling.
// Извлечено ДОСЛОВНО из Chart.jsx (слайс 6.4m, п.1 MODULARIZATION_PLAN).
// state paperTrades/isToxic* живёт здесь; isToxic* возвращается в Chart.jsx.

export function useChartAnnotations({
  chartRef, chartContainerRef, currentKlines, symbol, timeframe,
  chartReady, klinesVersion, setStatusMsg, setBtTooltip, setIsConeActive,
  effectiveBacktestSignals, effectiveShowBtSignals, strategyLevels,
  liveSignals, showLiveSignals, activePositionSetup, localPositionSetup,
  setLocalPositionSetup, effectivePositionSetup,
}) {
  const btOverlayIds = useRef([]); // backtest signal overlays (never saved as drawings)
  const activeStrategyLevelOverlays = useRef([]); // strategy entry zones (never saved as drawings)
  const activeVolatilityConeOverlayId = useRef(null); // volatility cone overlay
  const activePositionOverlayId = useRef(null);
  const lastScrolledResult = useRef(null);
  const [paperTrades, setPaperTrades] = useState([]);
  const paperOverlayIds = useRef([]);
  const [isToxicRegime, setIsToxicRegime] = useState(false);
  const [isToxicDismissed, setIsToxicDismissed] = useState(false);
  const liveSignalOverlayIds = useRef([]);
  useEffect(() => {
    setIsToxicDismissed(false);
    let isSubscribed = true;
    const checkRegime = async () => {
      try {
        const res = await fetch('/api/monitoring/state');
        if (res.ok && isSubscribed) {
          const data = await res.json();
          const symKey = symbol ? symbol.toUpperCase() : '';
          const symStatus = data.statuses?.[symKey] || data.statuses?.[symbol];
          const isToxic = symStatus?.regime === 'TOXIC_VOLATILITY' || (symStatus?.is_trade_allowed === false && symStatus?.state === 'toxic_halt');
          setIsToxicRegime(!!isToxic);
        }
      } catch (e) {}
    };
    checkRegime();
    const interval = setInterval(checkRegime, 4000);
    return () => { isSubscribed = false; clearInterval(interval); };
  }, [symbol]);
  // Paper trades share the same native overlay path as historical trades, with muted blue/violet colors.
  useEffect(() => {
    let active = true;
    const loadPaperTrades = async () => {
      try {
        const response = await fetch('/api/paper-trading/status');
        if (!response.ok) return;
        const payload = await response.json();
        if (active) setPaperTrades((payload.closed_trades || []).filter((trade) => trade.symbol === symbol.toUpperCase()));
      } catch (_) {
        if (active) setPaperTrades([]);
      }
    };
    loadPaperTrades();
    const interval = setInterval(loadPaperTrades, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [symbol]);

  // AI Copilot strategy levels projection listener
  useEffect(() => {
    const handleAiLevels = (e) => {
      const { levels, symbol: targetSym } = e.detail || {};
      if (targetSym && targetSym !== symbol) return;
      if (Array.isArray(levels) && chartRef.current) {
        const klines = currentKlines.current;
        if (!klines || klines.length === 0) return;
        const anchorTs = klines[klines.length - 1].timestamp;

        activeStrategyLevelOverlays.current.forEach(id => {
          try { chartRef.current.removeOverlay({ id }); } catch (_) {}
        });
        activeStrategyLevelOverlays.current = [];

        levels.forEach(lvl => {
          const p = Number(lvl.price);
          if (!p || !Number.isFinite(p)) return;
          try {
            const id = chartRef.current.createOverlay({
              name: 'strategyLevelZone',
              lock: true,
              points: [{ timestamp: anchorTs, value: p }],
              extendData: {
                type: lvl.type || 'BUY',
                label: lvl.label || 'AI Level',
                price: p
              }
            });
            if (id) activeStrategyLevelOverlays.current.push(id);
          } catch (_) {}
        });
        setStatusMsg("Уровни AI Ассистента нанесены");
        setTimeout(() => setStatusMsg(""), 2000);
      }
    };
    window.addEventListener('apply-ai-strategy-levels', handleAiLevels);
    return () => window.removeEventListener('apply-ai-strategy-levels', handleAiLevels);
  }, [symbol]);
  // Listen for Volatility Cone projection (Stage 3 & Stage 5)
  useEffect(() => {
    const handleVolatilityCone = (ev) => {
      let cone = ev.detail?.cone;
      const sym = ev.detail?.symbol;
      const isToggle = Boolean(ev.detail?.toggle);
      if (!chartRef.current) return;
      if (sym && sym.toUpperCase() !== symbol.toUpperCase()) return;

      if (activeVolatilityConeOverlayId.current) {
        try { chartRef.current.removeOverlay({ id: activeVolatilityConeOverlayId.current }); } catch (_) {}
        activeVolatilityConeOverlayId.current = null;
        setIsConeActive(false);
        if (isToggle && !cone) {
          setStatusMsg("Конус волатильности скрыт");
          setTimeout(() => setStatusMsg(""), 1200);
          return;
        }
      }

      const klines = currentKlines.current;
      if (!cone && klines && klines.length >= 10) {
        // Calculate 14-period ATR from loaded klines
        const sampleCount = Math.min(14, klines.length - 1);
        let trSum = 0;
        for (let i = klines.length - sampleCount; i < klines.length; i++) {
          const bar = klines[i];
          const prevClose = klines[i - 1] ? klines[i - 1].close : bar.open;
          const tr = Math.max(
            bar.high - bar.low,
            Math.abs(bar.high - prevClose),
            Math.abs(bar.low - prevClose)
          );
          trSum += tr;
        }
        const atr = trSum / sampleCount;
        const lastBar = klines[klines.length - 1];
        const basePrice = lastBar.close;
        const anchorTs = lastBar.timestamp;
        const tfMs = TF_MS[timeframe] || 300000;

        const monStatus = useMarketDataStore.getState().monitoringStatuses[symbol.toUpperCase()];
        const trend = (monStatus?.forecast_trend || 'NEUTRAL').toUpperCase();
        const driftSign = trend === 'BULLISH' ? 1 : trend === 'BEARISH' ? -1 : 0;
        const expectedDriftPct = driftSign * 0.35;

        const fanPoints = [];
        for (let i = 1; i <= 16; i++) {
          const stepSigma = Math.sqrt(i) * Math.max(atr * 0.85, basePrice * 0.002);
          const drift = (basePrice * (expectedDriftPct / 100)) * (i / 16);
          const mid = Number((basePrice + drift).toFixed(2));
          fanPoints.push({
            bar_offset: i,
            timestamp: anchorTs + i * tfMs,
            price_mid: mid,
            upper_1s: Number((mid + stepSigma).toFixed(2)),
            lower_1s: Number((mid - stepSigma).toFixed(2)),
            upper_2s: Number((mid + stepSigma * 1.96).toFixed(2)),
            lower_2s: Number((mid - stepSigma * 1.96).toFixed(2)),
            upper_1sigma: Number((mid + stepSigma).toFixed(2)),
            lower_1sigma: Number((mid - stepSigma).toFixed(2)),
            upper_2sigma: Number((mid + stepSigma * 1.96).toFixed(2)),
            lower_2sigma: Number((mid - stepSigma * 1.96).toFixed(2)),
          });
        }

        cone = {
          base_price: basePrice,
          base_timestamp: anchorTs,
          fan_points: fanPoints,
          direction: trend === 'BULLISH' ? 'BULLISH' : trend === 'BEARISH' ? 'BEARISH' : 'NEUTRAL',
          trend,
          expected_drift_pct: expectedDriftPct,
          sigma_1s_pct: ((atr / basePrice) * 100).toFixed(2),
          ev_display: driftSign > 0 ? '+0.45R' : driftSign < 0 ? '-0.45R' : '0.00R'
        };
      }

      if (!cone || !cone.fan_points || cone.fan_points.length === 0) {
        setStatusMsg("Конус волатильности скрыт");
        setTimeout(() => setStatusMsg(""), 1200);
        setIsConeActive(false);
        return;
      }

      const anchorTs = cone.base_timestamp || (klines && klines.length ? klines[klines.length - 1].timestamp : Date.now());
      const endTs = cone.fan_points[cone.fan_points.length - 1].timestamp;

      try {
        const id = chartRef.current.createOverlay({
          name: 'volatilityCone',
          lock: true,
          points: [
            { timestamp: anchorTs, value: cone.base_price },
            { timestamp: endTs, value: cone.base_price }
          ],
          extendData: {
            ...cone,
            symbol: sym || symbol
          }
        });
        if (id) {
          activeVolatilityConeOverlayId.current = id;
          setIsConeActive(true);
          setStatusMsg("📐 Конус волатильности (±1σ / ±2σ) спроецирован на 16 баров");
          setTimeout(() => setStatusMsg(""), 2000);
          try {
            chartRef.current.scrollToTimestamp(endTs + 4 * 60000, 200);
          } catch (_) {}
        }
      } catch (err) {
        console.warn("Failed to create volatilityCone overlay:", err);
      }
    };

    const handleClearVolatilityCone = () => {
      if (activeVolatilityConeOverlayId.current && chartRef.current) {
        try { chartRef.current.removeOverlay({ id: activeVolatilityConeOverlayId.current }); } catch (_) {}
        activeVolatilityConeOverlayId.current = null;
      }
      setIsConeActive(false);
    };

    window.addEventListener('apply-volatility-cone', handleVolatilityCone);
    window.addEventListener('clear-volatility-cone', handleClearVolatilityCone);
    return () => {
      window.removeEventListener('apply-volatility-cone', handleVolatilityCone);
      window.removeEventListener('clear-volatility-cone', handleClearVolatilityCone);
      handleClearVolatilityCone();
    };
  }, [symbol, timeframe]);
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
    if (!chart || !effectiveShowBtSignals || !effectiveBacktestSignals) return;
    if (effectiveBacktestSignals.symbol && effectiveBacktestSignals.symbol !== symbol.toUpperCase()) return;
    if (!klines || klines.length === 0) return;

    const firstTs = klines[0].timestamp;
    const lastTs = klines[klines.length - 1].timestamp;
    const barMs = klines.length > 1 ? klines[1].timestamp - klines[0].timestamp : 60000;

    // Snap signal time to the candle that contains it (binary search for last bar <= time)
    const findBar = (t) => {
      if (!t || t < firstTs || t > lastTs + barMs) return null;
      let lo = 0, hi = klines.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (klines[mid].timestamp <= t) lo = mid; else hi = mid - 1;
      }
      return klines[lo];
    };

    const container = chartContainerRef.current;
    let lastBarTs = null;

    const tradesList = Array.isArray(effectiveBacktestSignals.trades) ? effectiveBacktestSignals.trades : [];
    const signalsList = Array.isArray(effectiveBacktestSignals.signals) ? effectiveBacktestSignals.signals : [];

    if (tradesList.length > 0) {
      tradesList.forEach((trade) => {
        const entryBar = findBar(trade.entry_time);
        const exitBar = findBar(trade.exit_time) || entryBar;
        if (!entryBar) return;
        lastBarTs = exitBar ? exitBar.timestamp : entryBar.timestamp;

        try {
          const id = chart.createOverlay({
            name: 'backtestTradeLine',
            lock: true,
            points: [
              { timestamp: entryBar.timestamp, value: Number(trade.entry_price) },
              { timestamp: exitBar.timestamp, value: Number(trade.exit_price) }
            ],
            extendData: trade,
            onMouseEnter: (e) => {
              const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
              const px = (e && e.pageX != null) ? e.pageX - rect.left - window.scrollX : (e?.x || 0);
              const py = (e && e.pageY != null) ? e.pageY - rect.top - window.scrollY : (e?.y || 0);
              setBtTooltip({ x: px, y: py, trade, isTrade: true });
              return true;
            },
            onClick: (e) => {
              const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
              const px = (e && e.pageX != null) ? e.pageX - rect.left - window.scrollX : (e?.x || 0);
              const py = (e && e.pageY != null) ? e.pageY - rect.top - window.scrollY : (e?.y || 0);
              setBtTooltip({ x: px, y: py, trade, isTrade: true });
              return true;
            },
            onMouseLeave: () => { setBtTooltip(null); return true; }
          });
          if (id) btOverlayIds.current.push(id);
        } catch (_) {}
      });
    } else if (signalsList.length > 0) {
      signalsList.forEach((sig) => {
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
            onMouseEnter: (e) => {
              const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
              const px = (e && e.pageX != null) ? e.pageX - rect.left - window.scrollX : (e?.x || 0);
              const py = (e && e.pageY != null) ? e.pageY - rect.top - window.scrollY : (e?.y || 0);
              setBtTooltip({ x: px, y: py, sig, isTrade: false });
              return true;
            },
            onClick: (e) => {
              const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
              const px = (e && e.pageX != null) ? e.pageX - rect.left - window.scrollX : (e?.x || 0);
              const py = (e && e.pageY != null) ? e.pageY - rect.top - window.scrollY : (e?.y || 0);
              setBtTooltip({ x: px, y: py, sig, isTrade: false });
              return true;
            },
            onMouseLeave: () => { setBtTooltip(null); return true; }
          });
          if (id) btOverlayIds.current.push(id);
        } catch (_) {}
      });
    }

    // Reveal the newest marker once per new result (not on every redraw)
    if (lastBarTs && lastScrolledResult.current !== effectiveBacktestSignals) {
      lastScrolledResult.current = effectiveBacktestSignals;
      try { chart.scrollToTimestamp(Math.min(lastBarTs + 14 * barMs, lastTs), 200); } catch (_) {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBacktestSignals, effectiveShowBtSignals, symbol, timeframe, klinesVersion, chartReady]);
  useEffect(() => {
    const focusTrade = (event) => {
      const trade = event.detail;
      if (!trade || !chartRef.current || !trade.entry_time) return;
      try { chartRef.current.scrollToTimestamp(trade.entry_time, 180); } catch (_) {}
      setBtTooltip({ x: 24, y: 42, trade, isTrade: true, source: 'backtest' });
    };
    window.addEventListener('focus-backtest-trade', focusTrade);
    return () => window.removeEventListener('focus-backtest-trade', focusTrade);
  }, []);
  useEffect(() => {
    const chart = chartRef.current;
    const klines = currentKlines.current;
    paperOverlayIds.current.forEach((id) => { try { chart?.removeOverlay({ id }); } catch (_) {} });
    paperOverlayIds.current = [];
    if (!chart || !klines?.length || !paperTrades.length) return;

    const firstTs = klines[0].timestamp;
    const lastTs = klines[klines.length - 1].timestamp;
    const nearestBar = (timestamp) => {
      if (!timestamp || timestamp < firstTs || timestamp > lastTs) return null;
      return klines.reduce((nearest, bar) => (
        Math.abs(bar.timestamp - timestamp) < Math.abs(nearest.timestamp - timestamp) ? bar : nearest
      ), klines[0]);
    };
    const container = chartContainerRef.current;
    paperTrades.forEach((rawTrade) => {
      const entryBar = nearestBar(rawTrade.entry_ts);
      const exitBar = nearestBar(rawTrade.exit_ts) || entryBar;
      if (!entryBar || !exitBar) return;
      const trade = {
        ...rawTrade,
        id: rawTrade.order_id || `paper-${rawTrade.entry_ts}`,
        direction: rawTrade.side,
        entry_time: rawTrade.entry_ts,
        exit_time: rawTrade.exit_ts,
        pnl_usd: rawTrade.net_pnl,
        pnl_pct: rawTrade.pnl_percent,
        fee_paid_usd: rawTrade.fee_drag,
        reason: rawTrade.entry_reason || rawTrade.reason,
      };
      try {
        const id = chart.createOverlay({
          name: 'backtestTradeLine',
          lock: true,
          points: [
            { timestamp: entryBar.timestamp, value: Number(rawTrade.entry_price) },
            { timestamp: exitBar.timestamp, value: Number(rawTrade.exit_price) },
          ],
          extendData: { ...trade, source: 'paper', entry_price: rawTrade.entry_price, exit_price: rawTrade.exit_price },
          onMouseEnter: (event) => {
            const rect = container?.getBoundingClientRect() || { left: 0, top: 0 };
            setBtTooltip({ x: (event?.pageX ?? event?.x ?? 0) - rect.left - window.scrollX, y: (event?.pageY ?? event?.y ?? 0) - rect.top - window.scrollY, trade, isTrade: true, source: 'paper' });
            return true;
          },
          onClick: (event) => {
            const rect = container?.getBoundingClientRect() || { left: 0, top: 0 };
            setBtTooltip({ x: (event?.pageX ?? event?.x ?? 0) - rect.left - window.scrollX, y: (event?.pageY ?? event?.y ?? 0) - rect.top - window.scrollY, trade, isTrade: true, source: 'paper' });
            return true;
          },
          onMouseLeave: () => { setBtTooltip(null); return true; },
        });
        if (id) paperOverlayIds.current.push(id);
      } catch (_) {}
    });
    return () => {
      paperOverlayIds.current.forEach((id) => { try { chart.removeOverlay({ id }); } catch (_) {} });
      paperOverlayIds.current = [];
    };
  }, [paperTrades, symbol, klinesVersion, chartReady]);
  // Real-time algorithmic signal overlay at the live edge of the chart (Requirement 3)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || chartReady === 0) return;

    clearLiveSignals(chart, liveSignalOverlayIds.current);
    liveSignalOverlayIds.current = [];

    if (!showLiveSignals || !Array.isArray(liveSignals) || liveSignals.length === 0) {
      return;
    }

    const ids = renderLiveSignals(chart, liveSignals, symbol);
    liveSignalOverlayIds.current = ids;

    return () => {
      if (chartRef.current) {
        clearLiveSignals(chartRef.current, liveSignalOverlayIds.current);
        liveSignalOverlayIds.current = [];
      }
    };
  }, [liveSignals, showLiveSignals, symbol, chartReady]);
  // Живые paper-позиции на графике (задача Di 2026-10-24): открытые позиции всех
  // активных сессий (марафон overnight-pilot + live-раннер) по символу графика.
  // Entry — сплошная линия с бейджем (side/qty/PnL/источник), SL/TP — пунктир.
  const livePositionOverlayIds = useRef([]);
  useEffect(() => {
    let active = true;
    const clearAll = () => {
      livePositionOverlayIds.current.forEach((id) => { try { chartRef.current?.removeOverlay({ id }); } catch (_) {} });
      livePositionOverlayIds.current = [];
    };
    const draw = async () => {
      if (!chartRef.current || chartReady === 0) return;
      let positions = [];
      try {
        const [pilotRes, liveRes] = await Promise.all([
          fetch('/api/overnight-pilot/status'),
          fetch('/api/paper-trading/live/status'),
        ]);
        const pilot = pilotRes.ok ? await pilotRes.json() : {};
        const live = liveRes.ok ? await liveRes.json() : {};
        positions = collectOpenPositions(pilot, live, symbol.toUpperCase());
      } catch (_) { return; }
      if (!active) return;
      // Перерисовка при любом изменении (в т.ч. PnL-тик) — позиций мало, оверлей лёгкий.
      clearAll();
      const klines = currentKlines.current;
      if (!positions.length || !klines || klines.length === 0) return;
      const firstTs = klines[0].timestamp;
      const lastTs = klines[klines.length - 1].timestamp;
      positions.forEach((pos) => {
        if (!Number.isFinite(pos.entryPrice) || pos.entryPrice <= 0) return;
        const ts = pos.entryTs ? Math.min(Math.max(pos.entryTs, firstTs), lastTs) : lastTs;
        try {
          const id = chartRef.current.createOverlay({
            name: 'livePosition',
            lock: true,
            points: [{ timestamp: ts, value: pos.entryPrice }],
            extendData: pos,
          });
          if (id) livePositionOverlayIds.current.push(id);
        } catch (_) {}
      });
    };
    draw();
    const interval = setInterval(draw, 4000);
    return () => {
      active = false;
      clearInterval(interval);
      clearAll();
    };
  }, [symbol, chartReady]);
  // Real-time Whale Trade (large orders >= $500k) floating annotations on chart
  const whaleOverlayIds = useRef([]);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || chartReady === 0) return;

    clearWhaleTrades(chart, whaleOverlayIds.current);
    whaleOverlayIds.current = [];

    const unsub = useTradesStore.getState().addTradeListener((trade) => {
      if (trade.symbol === symbol.toUpperCase() && trade.usd >= 500000) {
        try {
          const ids = renderWhaleTrades(chart, [trade], symbol);
          if (ids && ids.length > 0) {
            whaleOverlayIds.current.push(...ids);
            if (whaleOverlayIds.current.length > 40) {
              const oldId = whaleOverlayIds.current.shift();
              clearWhaleTrades(chart, [oldId]);
            }
          }
        } catch (_) {}
      }
    });

    return () => {
      unsub();
      if (chartRef.current) {
        clearWhaleTrades(chartRef.current, whaleOverlayIds.current);
        whaleOverlayIds.current = [];
      }
    };
  }, [symbol, chartReady]);
  // Listen for custom position setup projection events
  useEffect(() => {
    const onPositionSetup = (ev) => {
      if (ev.detail?.setup) {
        setLocalPositionSetup(ev.detail.setup);
      }
    };
    window.addEventListener('apply-position-setup', onPositionSetup);
    return () => window.removeEventListener('apply-position-setup', onPositionSetup);
  }, []);
  // Render full Position Setup Box (Entry / SL / TP1 / TP2 + Risk/Reward Shaded Zones)
  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;
    const klines = currentKlines.current;

    if (activePositionOverlayId.current) {
      try { chart.removeOverlay({ id: activePositionOverlayId.current }); } catch (_) {}
      activePositionOverlayId.current = null;
    }

    if (!effectivePositionSetup || !klines || klines.length === 0) {
      window.__chartActiveSetup = null;
      return;
    }

    const klen = klines.length;
    const anchorTs = klines[klen - 1].timestamp;
    const startTs = klines[Math.max(0, klen - 30)].timestamp;

    const entryP = Number(effectivePositionSetup.entry_price);
    const tpP = Number(effectivePositionSetup.tp1_price || effectivePositionSetup.tp2_price || (entryP * 1.015));
    const slP = Number(effectivePositionSetup.sl_price || (entryP * 0.99));

    try {
      const id = chart.createOverlay({
        name: 'positionSetupBox',
        lock: false,
        points: [
          { timestamp: startTs, value: entryP },
          { timestamp: anchorTs, value: tpP },
          { timestamp: anchorTs, value: slP }
        ],
        extendData: {
          ...effectivePositionSetup,
          entry_price: entryP,
          tp1_price: tpP,
          sl_price: slP
        }
      });
      if (id) activePositionOverlayId.current = id;
      const initialSetup = {
        overlayId: id,
        ...effectivePositionSetup,
        entry_price: entryP,
        tp1_price: tpP,
        sl_price: slP
      };
      window.__chartActiveSetup = initialSetup;
      useTradeOverlayStore.getState().setTransientSetup(initialSetup);
    } catch (_) {}
  }, [effectivePositionSetup, symbol, timeframe, klinesVersion, chartReady]);
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
            role: lvl.role || '',
            label: lvl.label || (lvl.type === 'BUY' ? 'BUY ZONE: Wall $1.2M' : 'SHORT: Delta Div'),
            price: p
          }
        });
        if (id) activeStrategyLevelOverlays.current.push(id);
      } catch (_) {}
    });
  }, [strategyLevels, symbol, timeframe, klinesVersion, chartReady]);
  return { isToxicRegime, isToxicDismissed, setIsToxicDismissed };
}
