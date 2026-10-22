import React, { useState, useEffect, useRef } from 'react';
import LayerToolbar from './components/design-previews/LayerToolbar';
import LiqAnalyticsPanel from './components/design-previews/LiqAnalyticsPanel';
import ChartCanvasOverlay from './components/design-previews/ChartCanvasOverlay';
import QuantDecisionConsilium from './components/design-previews/QuantDecisionConsilium';
import { THEME_PRESETS, LIQUIDATION_PALETTES, CANDLE_MODES, applyThemeToDOM } from './theme/themes';
import { Activity, RefreshCw, BarChart2, ShieldCheck, Zap } from 'lucide-react';

export default function DesignShowcase() {
  const [theme, setTheme] = useState('graphite');
  const [liqPalette, setLiqPalette] = useState('vivid');
  const [candleMode, setCandleMode] = useState('color');
  const [layerOpacity, setLayerOpacity] = useState(100);

  // Symbol selection
  const [symbol, setSymbol] = useState('BTCUSDT');

  // Toolbar layer filters
  const [layers, setLayers] = useState({
    liqHeatmap: true,
    liqLevels: true,
    obDepth: true,
    obProfile: true,
  });

  const [leverages, setLeverages] = useState({
    '25x': true,
    '50x': true,
    '75x': true,
    '100x': true,
  });

  const [minWallMultiplier, setMinWallMultiplier] = useState(2.5);
  const [wallLineThickness, setWallLineThickness] = useState(2);

  // Live Backend Data
  const [loading, setLoading] = useState(false);
  const [unifiedData, setUnifiedData] = useState(null);
  const [core3Report, setCore3Report] = useState(null);
  const [promptData, setPromptData] = useState(null);
  const [quarantineSaved, setQuarantineSaved] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);

  // Canvas size measurement
  const chartAreaRef = useRef(null);
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 750, height: 420 });

  // Sync theme with DOM
  useEffect(() => {
    applyThemeToDOM({
      theme,
      liqPalette,
      candleMode,
      layerOpacity: layerOpacity / 100,
    });
  }, [theme, liqPalette, candleMode, layerOpacity]);

  // Fetch Live Data from Quant Router
  const fetchMarketData = async () => {
    setLoading(true);
    setQuarantineSaved(false);
    try {
      // 1. Fetch Unified Data (Depth + Liqs + Snapshot)
      const resUnified = await fetch(`/api/quant/unified?symbol=${symbol}`);
      if (resUnified.ok) {
        const uData = await resUnified.json();
        setUnifiedData(uData);
      }

      // 2. Fetch Core 3 Evaluation
      const resEval = await fetch(`/api/quant/evaluate?symbol=${symbol}`);
      if (resEval.ok) {
        const c3 = await resEval.json();
        setCore3Report(c3);
      }

      // 3. Fetch Snapshot Prompt
      const resPrompt = await fetch(`/api/quant/prompt?symbol=${symbol}`);
      if (resPrompt.ok) {
        const pr = await resPrompt.json();
        setPromptData(pr);
      }
    } catch (err) {
      console.warn('Backend quant fetch offline or proxying, using fallback:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMarketData();
  }, [symbol]);

  // Track canvas dimensions on resize
  useEffect(() => {
    const updateSize = () => {
      if (chartAreaRef.current) {
        setCanvasDimensions({
          width: chartAreaRef.current.clientWidth || 750,
          height: chartAreaRef.current.clientHeight || 420,
        });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Handle Quarantine Commit
  const handleCommitQuarantine = async () => {
    setIsCommitting(true);
    try {
      const res = await fetch(`/api/quant/quarantine?symbol=${symbol}`, { method: 'POST' });
      if (res.ok) {
        setQuarantineSaved(true);
      }
    } catch (e) {
      console.error('Failed to commit quarantine:', e);
    } finally {
      setIsCommitting(false);
    }
  };

  const currentPrice = unifiedData?.snapshot?.price || 82100;

  return (
    <div
      className="min-h-screen flex flex-col w-full"
      style={{
        backgroundColor: 'var(--bg)',
        color: 'var(--text-1)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Top Navigation & Token Controls */}
      <header
        className="px-4 py-2 border-b flex items-center justify-between gap-4 flex-wrap shrink-0"
        style={{
          backgroundColor: 'var(--panel)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Activity size={16} style={{ color: 'var(--accent)' }} />
            <span className="font-bold text-sm tracking-tight">slab_terminal</span>
          </div>

          <span
            className="px-2 py-0.5 rounded text-[10px] font-mono border"
            style={{
              backgroundColor: 'rgba(70, 201, 154, 0.12)',
              borderColor: 'rgba(70, 201, 154, 0.3)',
              color: 'var(--up)',
            }}
          >
            LIVE SOCKET · BOOTSTRAP ADAPTER
          </span>

          {/* Symbol Selector */}
          <div className="flex items-center gap-1 font-mono text-xs">
            {['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].map((sym) => (
              <button
                key={sym}
                type="button"
                onClick={() => setSymbol(sym)}
                className="px-2 py-0.5 rounded border transition cursor-pointer"
                style={{
                  backgroundColor: symbol === sym ? 'var(--raised)' : 'transparent',
                  borderColor: symbol === sym ? 'var(--accent)' : 'var(--border)',
                  color: symbol === sym ? 'var(--accent)' : 'var(--text-2)',
                  fontWeight: symbol === sym ? 600 : 400,
                }}
              >
                {sym}
              </button>
            ))}
          </div>
        </div>

        {/* Dynamic theme switcher controls */}
        <div className="flex items-center gap-3 flex-wrap text-xs">
          {/* Preset buttons */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>
              PRESET:
            </span>
            <div
              className="flex p-0.5 rounded border"
              style={{ backgroundColor: 'var(--raised)', borderColor: 'var(--border)' }}
            >
              {Object.keys(THEME_PRESETS).map((pKey) => (
                <button
                  key={pKey}
                  type="button"
                  data-theme-test={pKey}
                  onClick={() => {
                    setTheme(pKey);
                    setLiqPalette(THEME_PRESETS[pKey].defaultLiqPalette);
                    setCandleMode(THEME_PRESETS[pKey].defaultCandleMode);
                  }}
                  className="px-2 py-0.5 rounded text-[10px] font-mono transition cursor-pointer"
                  style={{
                    backgroundColor: theme === pKey ? 'var(--panel)' : 'transparent',
                    color: theme === pKey ? 'var(--accent)' : 'var(--text-2)',
                    fontWeight: theme === pKey ? 600 : 400,
                  }}
                >
                  {THEME_PRESETS[pKey].name}
                </button>
              ))}
            </div>
          </div>

          {/* Liquidation Palette buttons */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>
              PALETTE:
            </span>
            <div
              className="flex p-0.5 rounded border"
              style={{ backgroundColor: 'var(--raised)', borderColor: 'var(--border)' }}
            >
              {Object.keys(LIQUIDATION_PALETTES).map((palKey) => (
                <button
                  key={palKey}
                  type="button"
                  data-liq-test={palKey}
                  onClick={() => setLiqPalette(palKey)}
                  className="px-2 py-0.5 rounded text-[10px] font-mono transition cursor-pointer"
                  style={{
                    backgroundColor: liqPalette === palKey ? 'var(--panel)' : 'transparent',
                    color: liqPalette === palKey ? 'var(--accent)' : 'var(--text-2)',
                    fontWeight: liqPalette === palKey ? 600 : 400,
                  }}
                >
                  {LIQUIDATION_PALETTES[palKey].name}
                </button>
              ))}
            </div>
          </div>

          {/* Candle mode */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>
              CANDLES:
            </span>
            <div
              className="flex p-0.5 rounded border"
              style={{ backgroundColor: 'var(--raised)', borderColor: 'var(--border)' }}
            >
              {Object.keys(CANDLE_MODES).map((cKey) => (
                <button
                  key={cKey}
                  type="button"
                  onClick={() => setCandleMode(cKey)}
                  className="px-2 py-0.5 rounded text-[10px] font-mono transition cursor-pointer"
                  style={{
                    backgroundColor: candleMode === cKey ? 'var(--panel)' : 'transparent',
                    color: candleMode === cKey ? 'var(--accent)' : 'var(--text-2)',
                    fontWeight: candleMode === cKey ? 600 : 400,
                  }}
                >
                  {CANDLE_MODES[cKey].name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Interactive Layer Toolbar */}
      <LayerToolbar
        layers={layers}
        onLayerToggle={(k) => setLayers((prev) => ({ ...prev, [k]: !prev[k] }))}
        leverages={leverages}
        onLeverageToggle={(lev) => setLeverages((prev) => ({ ...prev, [lev]: !prev[lev] }))}
        minWallMultiplier={minWallMultiplier}
        onMinWallChange={setMinWallMultiplier}
        wallLineThickness={wallLineThickness}
        onWallThicknessChange={setWallLineThickness}
        layerOpacity={layerOpacity}
        onOpacityChange={setLayerOpacity}
      />

      {/* Main Workspace Layout */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-2 p-2.5 overflow-hidden">
        {/* Left 2 Cols: Main Interactive Chart & Consilium */}
        <section className="lg:col-span-2 flex flex-col gap-2 overflow-hidden">
          {/* Chart Wrapper Container */}
          <div
            className="flex-1 flex flex-col rounded border overflow-hidden min-h-[420px]"
            style={{ backgroundColor: 'var(--panel)', borderColor: 'var(--border)' }}
          >
            {/* Chart Sub-header ticker bar */}
            <div
              className="px-3 py-1.5 border-b flex items-center justify-between text-xs"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-2">
                <span className="font-bold text-[12px] font-mono" style={{ color: 'var(--text-1)' }}>
                  {symbol} · 15m
                </span>
                <span
                  className="text-[11px] font-mono"
                  style={{
                    color: (unifiedData?.snapshot?.change_24h_pct || 0) >= 0 ? 'var(--up)' : 'var(--down)',
                  }}
                >
                  {unifiedData?.snapshot?.change_24h_pct !== undefined
                    ? `${unifiedData.snapshot.change_24h_pct > 0 ? '+' : ''}${unifiedData.snapshot.change_24h_pct}%`
                    : '+0.0%'}
                </span>
                <span
                  className="text-[10px] font-mono px-1 rounded border"
                  style={{
                    backgroundColor: 'var(--raised)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-2)',
                  }}
                >
                  Vol ${(unifiedData?.snapshot?.volume_24h_usd ? unifiedData.snapshot.volume_24h_usd / 1e9 : 17.8).toFixed(2)}B
                </span>
              </div>

              <div className="flex items-center gap-3 text-[11px] font-mono" style={{ color: 'var(--text-2)' }}>
                <span>OI: ${(unifiedData?.snapshot?.open_interest_usd ? unifiedData.snapshot.open_interest_usd / 1e9 : 1.21).toFixed(3)}B</span>
                <span>•</span>
                <span>Funding: {unifiedData?.snapshot?.funding_rate ? (unifiedData.snapshot.funding_rate * 100).toFixed(4) : '+0.0042'}%</span>
              </div>
            </div>

            {/* Canvas Area with Live Overlays */}
            <div
              ref={chartAreaRef}
              className="flex-1 relative overflow-hidden flex flex-col justify-between"
              style={{
                backgroundColor: 'var(--bg)',
                backgroundImage: `linear-gradient(to right, var(--grid) 1px, transparent 1px), linear-gradient(to bottom, var(--grid) 1px, transparent 1px)`,
                backgroundSize: '50px 35px',
              }}
            >
              {/* High-Performance Canvas Overlay: Liq Heatmap + Spot Limit Walls + OB Profile */}
              <ChartCanvasOverlay
                width={canvasDimensions.width}
                height={canvasDimensions.height}
                currentPrice={currentPrice}
                liqData={unifiedData?.liq_estimates}
                depthData={unifiedData?.orderbook_depth}
                layers={layers}
                leverages={leverages}
                minWallMultiplier={minWallMultiplier}
                wallLineThickness={wallLineThickness}
                liqPalette={liqPalette}
                layerOpacity={layerOpacity / 100}
              />

              {/* Price Tag Right */}
              <div
                className="absolute right-0 top-1/2 -translate-y-1/2 px-2 py-0.5 font-mono text-xs font-bold rounded-l z-20"
                style={{
                  backgroundColor: 'var(--candle-up)',
                  color: '#000',
                }}
              >
                ${currentPrice.toLocaleString()}
              </div>

              {/* Center Institutional Watermark */}
              <div className="z-0 flex flex-col items-center justify-center opacity-25 select-none pointer-events-none my-auto">
                <span className="text-xl font-bold font-mono tracking-widest">SLAB TERMINAL · CANVAS OVERLAY</span>
                <span className="text-[10px] font-mono">SPOT WALLS + SYNTHETIC LIQUIDATION POOLS</span>
              </div>
            </div>

            {/* CVD Sub-panel */}
            <div
              className="h-16 border-t px-3 py-1 flex flex-col justify-between"
              style={{ backgroundColor: 'var(--panel)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span style={{ color: 'var(--text-2)' }}>
                  <strong>CVD</strong> (Binance Cumulative Delta)
                </span>
                <span style={{ color: 'var(--candle-up)' }}>
                  {unifiedData?.snapshot?.cvd_value ? `${unifiedData.snapshot.cvd_value > 0 ? '+' : ''}${unifiedData.snapshot.cvd_value.toLocaleString()} BTC` : '+1,420.50 BTC'}
                </span>
              </div>
              <div className="h-7 w-full flex items-center">
                <svg width="100%" height="24" preserveAspectRatio="none" viewBox="0 0 400 24">
                  <polyline
                    fill="none"
                    stroke="var(--candle-up)"
                    strokeWidth="1.5"
                    points="0,20 40,18 80,22 120,15 160,17 200,10 240,13 280,7 320,5 360,6 400,2"
                  />
                </svg>
              </div>
            </div>
          </div>

          {/* Quant Decision Consilium: 3 Cores & Quarantine */}
          <QuantDecisionConsilium
            symbol={symbol}
            core3Report={core3Report}
            promptData={promptData}
            onCommitQuarantine={handleCommitQuarantine}
            isCommitting={isCommitting}
            quarantineSaved={quarantineSaved}
          />
        </section>

        {/* Right Col: Plug-and-Play Liquidation Analytics Panel Component */}
        <section
          className="flex flex-col rounded border overflow-hidden"
          style={{ borderColor: 'var(--border)' }}
        >
          <LiqAnalyticsPanel
            symbol={symbol}
            currentPrice={currentPrice}
            liqData={unifiedData?.liq_estimates}
            depthData={unifiedData?.orderbook_depth}
            isLoading={loading}
            onRefresh={fetchMarketData}
          />
        </section>
      </main>
    </div>
  );
}
