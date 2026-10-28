import React, { useState, useEffect, useRef } from 'react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
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
  EyeOff,
  Sliders,
  Bookmark,
  Palette,
  Layers,
  ChevronDown,
  Settings,
  MoreHorizontal,
  Crosshair,
  Zap,
  Loader2,
  SlidersHorizontal,
  LocateFixed,
} from 'lucide-react';
import ChannelSelector from '../docking/ChannelSelector';
import { crosshairBus } from '../../services/crosshairBus';
import { TPO_SETTINGS_DEFAULTS, WALL_SETTINGS_DEFAULTS } from './useChartOverlays.js';

const readSettings = (key, fallback) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '{}');
    return { ...fallback, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch (_) {
    return { ...fallback };
  }
};

const persistSettings = (key, next) => {
  localStorage.setItem(key, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('signalscript:chart-settings-changed'));
};

const PALETTE_COLORS = [
  '#ffffff', '#94a3b8', '#38bdf8', '#0284c7',
  '#10b981', '#059669', '#f59e0b', '#d97706',
  '#ef4444', '#dc2626', '#a855f7', '#7c3aed',
  '#ec4899', '#db2777', '#06b6d4', '#64748b'
];

export default function ChartToolbar({
  symbol = 'BTCUSDT',
  timeframe = '15m',
  onTimeframeChange = null,
  onScrollToNow = null,
  chartId = 'chart_main',
  titlePrefix = '',
  onCloseWidget = null,

  // Drawing tools state
  activeTool,
  cancelActiveDrawing,
  handleSelectTool,
  magnetEnabled,
  setMagnetEnabled,
  handleUndo,
  handleClearDrawings,
  saveDrawings,

  // SMC templates
  isTemplateMenuOpen,
  setIsTemplateMenuOpen,
  setShowSaveTemplateModal,
  drawingTemplates = [],
  applyTemplate,

  // Styling
  updateStyle,
  activeDrawingStyle = { strokeColor: '#38bdf8', lineWidth: 1, lineStyle: 'solid' },

  // Status and AI
  statusMsg = '',
  handleAskSecondOpinion,
  isAskingOpinion = false,

  // Indicators & layers
  setIsCatalogOpen,
  activeIndicators = [],
  toggleIndicator,
  toggleLiveSignals,
  showLiveSignals = false,
  showHeatmap = false,
  setShowHeatmap,
  loadHeatmap,
  showFootprint = false,
  setShowFootprint,
  showTpo = false,
  setShowTpo,
  showLiquidations = false,
  setShowLiquidations,
  showWalls = false,
  setShowWalls,
  densityMode = 'auto',
  setDensityMode,
  toggleVolatilityCone,
  isConeActive = false,
  showVwap = false,

  // Quick Backtest
  isBacktesting = false,
  handleQuickBt = null,
  activeBtResult = null,
  isCurrentSymbolResult = false,
  showTradesOnChart = false,
  setShowTradesOnChart = null,
  activeSetup = null,
}) {
  const [layersHubOpen, setLayersHubOpen] = useState(false);
  const [indicatorsHubOpen, setIndicatorsHubOpen] = useState(false);
  const [showStyleRow, setShowStyleRow] = useState(false);
  const [crosshairSync, setCrosshairSync] = useState(() => crosshairBus.isEnabled());

  // TPO & Walls Settings
  const [tpoSettingsOpen, setTpoSettingsOpen] = useState(false);
  const [wallSettingsOpen, setWallSettingsOpen] = useState(false);
  const [tpoSettings, setTpoSettings] = useState(() => readSettings('chart_tpo_settings', TPO_SETTINGS_DEFAULTS));
  const [wallSettings, setWallSettings] = useState(() => readSettings('chart_walls_settings', WALL_SETTINGS_DEFAULTS));
  const [liqPalette, setLiqPalette] = useState(() => localStorage.getItem('chart_liq_palette') || 'magma');
  const [liqOpacity, setLiqOpacity] = useState(() => Number(localStorage.getItem('chart_liq_opacity')) || 0.85);
  const [liqMinUsd, setLiqMinUsd] = useState(() => Number(localStorage.getItem('chart_liq_min_usd')) || 25000);

  // Sync crosshair state listener
  useEffect(() => {
    const onSyncChange = (e) => {
      if (e.detail && typeof e.detail.enabled === 'boolean') {
        setCrosshairSync(e.detail.enabled);
      }
    };
    window.addEventListener('signalscript:crosshair-sync-changed', onSyncChange);
    return () => window.removeEventListener('signalscript:crosshair-sync-changed', onSyncChange);
  }, []);

  const toggleCrosshair = () => {
    const next = crosshairBus.toggle();
    setCrosshairSync(next);
  };

  const updateLiqSetting = (key, val, setter) => {
    setter(val);
    localStorage.setItem(key, String(val));
    window.dispatchEvent(new CustomEvent('signalscript:chart-settings-changed'));
  };

  const updateTpoSettings = (patch) => {
    const next = { ...tpoSettings, ...patch };
    setTpoSettings(next);
    persistSettings('chart_tpo_settings', next);
  };

  const updateWallSettings = (patch) => {
    const next = { ...wallSettings, ...patch };
    setWallSettings(next);
    persistSettings('chart_walls_settings', next);
  };

  const activeLayersCount = [
    showHeatmap,
    showFootprint,
    showTpo,
    showLiquidations,
    showWalls,
    isConeActive,
  ].filter(Boolean).length;

  const enabledIndicatorsCount = activeIndicators.filter((i) => i.enabled !== false).length;

  // Responsive tiering for compact charts (<650: collapse drawing tools, <500: compact TF select, <380: ultra-compact)
  const toolbarRef = useRef(null);
  const [toolbarWidth, setToolbarWidth] = useState(1000);

  useEffect(() => {
    if (!toolbarRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (!entry.contentRect) continue;
        setToolbarWidth(entry.contentRect.width);
      }
    });
    obs.observe(toolbarRef.current);
    return () => obs.disconnect();
  }, []);

  const isUltraNarrow = toolbarWidth < 380;
  const isNarrowTf = toolbarWidth < 500;
  const isCollapseDrawings = toolbarWidth < 650;

  // Auto-open style row when drawing tool is chosen
  useEffect(() => {
    if (activeTool && activeTool !== 'cursor') {
      setShowStyleRow(true);
    }
  }, [activeTool]);

  return (
    <div
      ref={toolbarRef}
      data-testid="chart-unified-toolbar"
      className="w-full flex flex-col bg-background/95 border-b border-border/80 text-foreground font-mono select-none shrink-0 z-30 transition-all"
    >
      {/* ======================================================== */}
      {/* ROW 1: Max 28px height (h-7)                             */}
      {/* ======================================================== */}
      <div className="h-7 px-2 flex items-center justify-between gap-1 overflow-x-auto no-scrollbar text-xs">
        {/* Left Section: Symbol, Timeframe, ChannelSelector */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="font-bold text-foreground text-[11px] tracking-wide">
            {symbol}
          </span>

          {/* Timeframe ToggleGroup (Select when <500px) */}
          {!isNarrowTf ? (
            <div className="flex items-center space-x-0.5 bg-muted/60 rounded border border-border/60 p-0.5">
              {['1m', '5m', '15m', '1h', '4h'].map((tf) => (
                <button
                  key={tf}
                  type="button"
                  data-testid={`chart-timeframe-${chartId}-${tf}`}
                  onClick={() => onTimeframeChange && onTimeframeChange(tf)}
                  className={`px-1.5 py-0.2 rounded text-[10px] transition cursor-pointer ${
                    timeframe === tf
                      ? 'bg-primary text-primary-foreground font-bold shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center">
              <select
                aria-label="Выбор таймфрейма"
                data-testid={`chart-timeframe-select-${chartId}`}
                value={timeframe}
                onChange={(e) => onTimeframeChange && onTimeframeChange(e.target.value)}
                className="bg-muted text-foreground font-bold rounded px-1.5 py-0.5 border border-border text-[10px] cursor-pointer"
              >
                {['1m', '5m', '15m', '1h', '4h', '1d'].map((tf) => (
                  <option key={tf} value={tf}>{tf}</option>
                ))}
              </select>
            </div>
          )}

          <ChannelSelector panelId={chartId} />

          <div className="h-3.5 w-px bg-border/60 mx-0.5" />

          {/* Drawing Tools (Inline on >=650px, Popover on <650px, Hidden on <380px) */}
          {!isCollapseDrawings ? (
          <div className="flex items-center space-x-0.5">
            <button
              title="Линия (Alt+T)"
              onClick={() => handleSelectTool('segment')}
              className={`p-1 rounded transition cursor-pointer ${
                activeTool === 'segment'
                  ? 'bg-primary/20 text-primary border border-primary/40 font-bold'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Minus size={12} />
            </button>

            <button
              title="Горизонтальный уровень (Alt+H)"
              onClick={() => handleSelectTool('horizontalStraightLine')}
              className={`px-1 py-0.5 rounded text-[10px] transition cursor-pointer ${
                activeTool === 'horizontalStraightLine'
                  ? 'bg-primary/20 text-primary border border-primary/40 font-bold'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <span className="font-mono text-xs">—</span>
            </button>

            <button
              title="Луч (Ray Line)"
              onClick={() => handleSelectTool('rayLine')}
              className={`p-1 rounded transition cursor-pointer ${
                activeTool === 'rayLine'
                  ? 'bg-primary/20 text-primary border border-primary/40'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <MoveRight size={12} />
            </button>

            <button
              title="Прямоугольник (Зона плотности / имбаланс)"
              onClick={() => handleSelectTool('rect')}
              className={`p-1 rounded transition cursor-pointer ${
                activeTool === 'rect'
                  ? 'bg-primary/20 text-primary border border-primary/40'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Square size={11} />
            </button>

            <button
              title="Уровни Фибоначчи"
              onClick={() => handleSelectTool('fibonacciLine')}
              className={`p-1 rounded transition cursor-pointer ${
                activeTool === 'fibonacciLine'
                  ? 'bg-primary/20 text-primary border border-primary/40'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Hash size={11} />
            </button>

            <button
              title="Линейка (Замер % и пунктов)"
              onClick={() => handleSelectTool('measure')}
              className={`p-1 rounded transition cursor-pointer ${
                activeTool === 'measure'
                  ? 'bg-primary/20 text-primary border border-primary/40'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Ruler size={12} />
            </button>

            <button
              data-testid="tool-risk-reward"
              title="Интерактивный сетап Risk/Reward (Entry / TP / SL)"
              onClick={() => handleSelectTool('positionSetupBox')}
              className={`px-1.5 py-0.5 rounded text-[10px] flex items-center transition cursor-pointer ${
                activeTool === 'positionSetupBox'
                  ? 'bg-primary/20 text-primary border border-primary/40 font-bold'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <TrendingUp size={11} className="mr-0.5" />
              <span className="hidden xl:inline">R:R Box</span>
            </button>

            <button
              title={magnetEnabled ? 'Магнит включен (привязка к свечам)' : 'Магнит выключен'}
              onClick={() => setMagnetEnabled(!magnetEnabled)}
              className={`p-1 rounded transition cursor-pointer ${
                magnetEnabled ? 'bg-primary/25 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Magnet size={12} />
            </button>

            <button
              title="Отменить последнее действие (Ctrl+Z)"
              onClick={handleUndo}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
            >
              <RotateCcw size={12} />
            </button>

            <button
              title="Очистить все рисунки"
              onClick={handleClearDrawings}
              className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/15 transition cursor-pointer"
            >
              <Trash2 size={12} />
            </button>

            <button
              title="Сохранить рисунки"
              onClick={saveDrawings}
              className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/15 transition cursor-pointer"
            >
              <Save size={12} />
            </button>

            {/* SMC Templates Dropdown */}
            <DropdownMenu open={isTemplateMenuOpen} onOpenChange={setIsTemplateMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  data-testid="btn-smc-templates"
                  type="button"
                  className="px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1 border border-border/60 hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
                  title="Шаблоны Smart Money Concepts (BOS, OB, FVG, Ликвидность)"
                >
                  <Layers size={11} />
                  <span className="hidden sm:inline">SMC</span>
                  <ChevronDown size={10} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent data-testid="smc-templates-dropdown" align="start" className="w-64 p-1 font-mono text-xs">
                <div className="px-2 py-1 text-[9.5px] font-bold text-muted-foreground uppercase tracking-wider flex items-center justify-between border-b border-border/80">
                  <span>Шаблоны SMC</span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsTemplateMenuOpen(false);
                      setShowSaveTemplateModal(true);
                    }}
                    className="text-primary hover:underline normal-case font-normal text-[9px] cursor-pointer"
                  >
                    + Сохранить текущий
                  </button>
                </div>
                <div className="py-0.5 max-h-56 overflow-y-auto">
                  {drawingTemplates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => applyTemplate(t)}
                      className="w-full text-left px-2 py-1.5 hover:bg-muted rounded transition flex items-center justify-between group cursor-pointer"
                    >
                      <div className="flex flex-col min-w-0 pr-1">
                        <span className="text-[10.5px] text-foreground font-medium group-hover:text-primary truncate">
                          {t.name}
                        </span>
                        <span className="text-[9px] text-muted-foreground leading-tight truncate">
                          {t.description}
                        </span>
                      </div>
                      {t.badge && (
                        <span
                          className="px-1 py-0.2 rounded text-[8.5px] font-bold shrink-0 ml-1"
                          style={{
                            backgroundColor: `${t.badgeColor || '#38bdf8'}25`,
                            color: t.badgeColor || '#38bdf8',
                          }}
                        >
                          {t.badge}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Toggle Style Row Button */}
            <button
              title="Палитра цветов и толщина линий"
              onClick={() => setShowStyleRow((v) => !v)}
              className={`p-1 rounded transition cursor-pointer ${
                showStyleRow
                  ? 'bg-primary/20 text-primary border border-primary/40'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Palette size={12} />
            </button>
          </div>
          ) : !isUltraNarrow ? (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-testid="btn-drawing-tools-popover"
                  className={`px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1 border transition cursor-pointer ${
                    activeTool && activeTool !== 'cursor'
                      ? 'bg-primary/20 text-primary border-primary/40 font-bold'
                      : 'border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                  title="Инструменты рисования"
                >
                  <Ruler size={11} />
                  <span>Рисование</span>
                  <ChevronDown size={10} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56 p-2 flex flex-col gap-1.5 font-mono text-xs shadow-xl">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider pb-1 border-b border-border/80 flex items-center justify-between">
                  <span>Инструменты</span>
                  <button
                    type="button"
                    onClick={() => setShowStyleRow((v) => !v)}
                    className="text-primary hover:underline text-[9px]"
                  >
                    Стили
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1 text-[10px]">
                  <button
                    type="button"
                    onClick={() => handleSelectTool('segment')}
                    className={`px-2 py-1 rounded border text-left flex items-center gap-1.5 ${
                      activeTool === 'segment' ? 'bg-primary/20 text-primary border-primary/40 font-bold' : 'border-border/40 text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <Minus size={11} />
                    <span>Линия</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectTool('horizontalStraightLine')}
                    className={`px-2 py-1 rounded border text-left flex items-center gap-1.5 ${
                      activeTool === 'horizontalStraightLine' ? 'bg-primary/20 text-primary border-primary/40 font-bold' : 'border-border/40 text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <span>—</span>
                    <span>Уровень</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectTool('rayLine')}
                    className={`px-2 py-1 rounded border text-left flex items-center gap-1.5 ${
                      activeTool === 'rayLine' ? 'bg-primary/20 text-primary border-primary/40 font-bold' : 'border-border/40 text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <MoveRight size={11} />
                    <span>Луч</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectTool('rect')}
                    className={`px-2 py-1 rounded border text-left flex items-center gap-1.5 ${
                      activeTool === 'rect' ? 'bg-primary/20 text-primary border-primary/40 font-bold' : 'border-border/40 text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <Square size={11} />
                    <span>Зона</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectTool('fibonacciLine')}
                    className={`px-2 py-1 rounded border text-left flex items-center gap-1.5 ${
                      activeTool === 'fibonacciLine' ? 'bg-primary/20 text-primary border-primary/40 font-bold' : 'border-border/40 text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <Hash size={11} />
                    <span>Фибо</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectTool('measure')}
                    className={`px-2 py-1 rounded border text-left flex items-center gap-1.5 ${
                      activeTool === 'measure' ? 'bg-primary/20 text-primary border-primary/40 font-bold' : 'border-border/40 text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <Ruler size={11} />
                    <span>Замер</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectTool('positionSetupBox')}
                    className={`px-2 py-1 rounded border text-left flex items-center gap-1.5 col-span-2 ${
                      activeTool === 'positionSetupBox' ? 'bg-primary/20 text-primary border-primary/40 font-bold' : 'border-border/40 text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <TrendingUp size={11} />
                    <span>Сетап Risk/Reward</span>
                  </button>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-border/80">
                  <button
                    type="button"
                    onClick={() => setMagnetEnabled(!magnetEnabled)}
                    className={`px-1.5 py-0.5 rounded text-[9.5px] border ${
                      magnetEnabled ? 'bg-primary/25 text-primary border-primary/40' : 'border-border/40 text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    Магнит {magnetEnabled ? 'ON' : 'OFF'}
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={handleUndo}
                      title="Отменить"
                      className="p-1 rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <RotateCcw size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={handleClearDrawings}
                      title="Очистить"
                      className="p-1 rounded text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                    >
                      <Trash2 size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={saveDrawings}
                      title="Сохранить"
                      className="p-1 rounded text-muted-foreground hover:bg-primary/15 hover:text-primary"
                    >
                      <Save size={11} />
                    </button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          ) : null}
        </div>

        {/* Center Spacer */}
        <div className="flex-1 min-w-[8px]" />

        {/* Right Section: Layers, Indicators, Crosshair, AI, Backtest */}
        <div className="flex items-center gap-1 shrink-0 font-mono">
          {statusMsg && (
            <span className="text-warning text-[10px] animate-pulse mr-1 truncate max-w-[120px]">
              {statusMsg}
            </span>
          )}

          {onScrollToNow && (
            <Button
              type="button"
              data-testid={`chart-go-to-now-${chartId}`}
              onClick={onScrollToNow}
              variant="subtle"
              size="dense"
              className="cursor-pointer"
              title="Вернуться к актуальной свече и текущей цене (Space)"
            >
              <LocateFixed size={11} />
              <span className="hidden lg:inline">Сейчас</span>
            </Button>
          )}

          {/* Unified Layers Hub Popover */}
          <Popover open={layersHubOpen} onOpenChange={setLayersHubOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                data-testid="btn-toolbar-layers-hub"
                className={`px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1 border transition cursor-pointer ${
                  activeLayersCount > 0
                    ? 'bg-primary/15 text-primary border-primary/40 font-semibold'
                    : 'border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                title="Слои графика: Ликвидации, Футпринт, TPO, Стенки, Конус"
              >
                <Layers size={11} />
                <span>Слои</span>
                {activeLayersCount > 0 && (
                  <span className="px-1 text-[8.5px] rounded-full bg-primary text-primary-foreground font-bold">
                    {activeLayersCount}
                  </span>
                )}
                <ChevronDown size={10} />
              </button>
            </PopoverTrigger>
            <PopoverContent
              data-testid="layers-hub-dropdown"
              align="end"
              className="w-72 p-2.5 flex flex-col gap-2 font-mono text-xs shadow-xl"
            >
              <div className="flex items-center justify-between pb-1.5 border-b border-border/80">
                <span className="text-[11px] font-bold text-foreground tracking-wide">
                  Слои & Order Flow
                </span>
                <span className="text-[9.5px] text-muted-foreground">
                  Активно: {activeLayersCount}/6
                </span>
              </div>

              {/* Group 1: Ликвидность */}
              <div className="space-y-1">
                <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
                  Ликвидность
                </div>
                <div className="flex items-center justify-between px-1.5 py-1 rounded bg-muted/30 border border-border/40">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                    <input
                      type="checkbox"
                      data-testid="btn-toolbar-toggle-heatmap"
                      checked={showHeatmap}
                      onChange={() => {
                        const next = !showHeatmap;
                        setShowHeatmap(next);
                        localStorage.setItem('chart_heatmap', next ? 'true' : 'false');
                        if (next && loadHeatmap) loadHeatmap(true);
                      }}
                      className="rounded accent-amber-500"
                    />
                    <span className="text-[10px] font-medium text-foreground">
                      Карта ликвидаций (WebGL)
                    </span>
                  </label>
                </div>
                <div className="flex items-center justify-between px-1.5 py-1 rounded bg-muted/30 border border-border/40">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <span className="w-2 h-2 rounded-full bg-rose-400 inline-block" />
                    <input
                      type="checkbox"
                      checked={showLiquidations}
                      onChange={() => {
                        const next = !showLiquidations;
                        setShowLiquidations(next);
                        localStorage.setItem('chart_liquidations', next ? 'true' : 'false');
                      }}
                      className="rounded accent-rose-500"
                    />
                    <span className="text-[10px] font-medium text-foreground">
                      Маркеры ликвидаций
                    </span>
                  </label>
                </div>
              </div>

              {/* Group 2: Плотности и стакан */}
              <div className="space-y-1">
                <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
                  Плотности & Стакан
                </div>
                <div className="flex items-center justify-between px-1.5 py-1 rounded bg-muted/30 border border-border/40">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                    <input
                      type="checkbox"
                      data-testid="btn-toolbar-toggle-walls"
                      checked={showWalls}
                      onChange={() => {
                        const next = !showWalls;
                        setShowWalls(next);
                        localStorage.setItem('chart_walls', next ? 'true' : 'false');
                      }}
                      className="rounded accent-emerald-500"
                    />
                    <span className="text-[10px] font-medium text-foreground">
                      Стенки стакана (Depth20)
                    </span>
                  </label>
                  <button
                    data-testid="btn-toolbar-walls-settings"
                    type="button"
                    onClick={() => setWallSettingsOpen((v) => !v)}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <Settings size={11} />
                  </button>
                </div>

                {wallSettingsOpen && (
                  <div data-testid="walls-settings-panel" className="p-2 rounded bg-background border border-border/80 flex flex-col gap-1.5 text-[9.5px]">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Мин. стенка:</span>
                      <select
                        aria-label="Минимальный объём стенки"
                        className="bg-muted text-foreground rounded px-1 py-0.5 border border-border text-[9px]"
                        value={wallSettings.min_usd}
                        onChange={(e) => updateWallSettings({ min_usd: Number(e.target.value) })}
                      >
                        <option value={100000}>$100k</option>
                        <option value={250000}>$250k</option>
                        <option value={400000}>$400k</option>
                        <option value={1000000}>$1M</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Макс. уровней:</span>
                      <select
                        aria-label="Максимум уровней стенок"
                        className="bg-muted text-foreground rounded px-1 py-0.5 border border-border text-[9px]"
                        value={wallSettings.max_walls || 6}
                        onChange={(e) => updateWallSettings({ max_walls: Number(e.target.value) })}
                      >
                        {[2, 4, 6, 8, 12].map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Group 3: Профили */}
              <div className="space-y-1">
                <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
                  Профили объема
                </div>
                <div className="flex items-center justify-between px-1.5 py-1 rounded bg-muted/30 border border-border/40">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <span className="w-2 h-2 rounded-full bg-teal-400 inline-block" />
                    <input
                      type="checkbox"
                      data-testid="btn-toolbar-toggle-footprint"
                      checked={showFootprint}
                      onChange={() => {
                        const next = !showFootprint;
                        setShowFootprint(next);
                        localStorage.setItem('chart_footprint', next ? 'true' : 'false');
                      }}
                      className="rounded accent-teal-500"
                    />
                    <span className="text-[10px] font-medium text-foreground">
                      Футпринт (Bid x Ask)
                    </span>
                  </label>
                </div>
                <div className="flex items-center justify-between px-1.5 py-1 rounded bg-muted/30 border border-border/40">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <span className="w-2 h-2 rounded-full bg-sky-400 inline-block" />
                    <input
                      type="checkbox"
                      data-testid="btn-toolbar-toggle-tpo"
                      checked={showTpo}
                      onChange={() => {
                        const next = !showTpo;
                        setShowTpo(next);
                        localStorage.setItem('chart_tpo', next ? 'true' : 'false');
                      }}
                      className="rounded accent-sky-500"
                    />
                    <span className="text-[10px] font-medium text-foreground">
                      TPO & Профиль объема
                    </span>
                  </label>
                  <button
                    data-testid="btn-toolbar-tpo-settings"
                    type="button"
                    onClick={() => setTpoSettingsOpen((v) => !v)}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <Settings size={11} />
                  </button>
                </div>

                {tpoSettingsOpen && (
                  <div data-testid="tpo-settings-panel" className="p-2 rounded bg-background border border-border/80 flex flex-col gap-1.5 text-[9.5px]">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Период:</span>
                      <select
                        aria-label="Период TPO"
                        className="bg-muted text-foreground rounded px-1 py-0.5 border border-border text-[9px]"
                        value={tpoSettings.period_minutes}
                        onChange={(e) => updateTpoSettings({ period_minutes: Number(e.target.value) })}
                      >
                        {[5, 15, 30, 60].map((v) => (
                          <option key={v} value={v}>{v} мин</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Value Area:</span>
                      <select
                        aria-label="Доля Value Area"
                        className="bg-muted text-foreground rounded px-1 py-0.5 border border-border text-[9px]"
                        value={tpoSettings.value_area}
                        onChange={(e) => updateTpoSettings({ value_area: Number(e.target.value) })}
                      >
                        {[0.5, 0.6, 0.7, 0.8].map((v) => (
                          <option key={v} value={v}>{Math.round(v * 100)}%</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Group 4: Сигналы и волатильность */}
              <div className="space-y-1">
                <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
                  Аналитика
                </div>
                <div className="flex items-center justify-between px-1.5 py-1 rounded bg-muted/30 border border-border/40">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" />
                    <input
                      type="checkbox"
                      data-testid="btn-toolbar-toggle-cone"
                      checked={isConeActive}
                      onChange={toggleVolatilityCone}
                      className="rounded accent-indigo-500"
                    />
                    <span className="text-[10px] font-medium text-foreground">
                      Конус волатильности (±1σ/±2σ)
                    </span>
                  </label>
                </div>
                <div className="flex items-center justify-between px-1.5 py-1 rounded bg-muted/30 border border-border/40">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                    <input
                      type="checkbox"
                      data-testid="btn-toggle-signals"
                      checked={showLiveSignals}
                      onChange={toggleLiveSignals}
                      className="rounded accent-emerald-500"
                    />
                    <span className="text-[10px] font-medium text-foreground">
                      Сигналы стратегий
                    </span>
                  </label>
                </div>
              </div>

              {/* Density Mode Control */}
              <div className="pt-1.5 border-t border-border/80 flex items-center justify-between text-[9.5px]">
                <label data-testid="density-mode-control" className="flex items-center justify-between w-full">
                  <span className="text-muted-foreground">Плотность свечей:</span>
                  <select
                    aria-label="Режим плотности графика"
                    value={densityMode}
                    onChange={(e) => {
                      const next = e.target.value;
                      setDensityMode(next);
                      localStorage.setItem('chart_density_mode', next);
                    }}
                    className="bg-muted text-foreground rounded px-1.5 py-0.5 border border-border text-[9.5px]"
                  >
                    <option value="auto">Auto</option>
                    <option value="compact">Compact</option>
                    <option value="full">Full</option>
                  </select>
                </label>
              </div>
            </PopoverContent>
          </Popover>

          {/* Indicators Popover */}
          <Popover open={indicatorsHubOpen} onOpenChange={setIndicatorsHubOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                data-testid="btn-open-indicators-modal"
                className={`px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1 border transition cursor-pointer ${
                  enabledIndicatorsCount > 0
                    ? 'bg-primary/15 text-primary border-primary/40 font-semibold'
                    : 'border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                title="Индикаторы графика (Клавиша I)"
              >
                <Sliders size={11} />
                <span>Индикаторы</span>
                {enabledIndicatorsCount > 0 && (
                  <span className="text-[9px] text-muted-foreground">
                    ({enabledIndicatorsCount})
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60 p-2 font-mono text-xs shadow-xl">
              <div className="flex items-center justify-between pb-1.5 border-b border-border/80 mb-2">
                <span className="font-bold text-foreground text-[11px]">
                  Быстрые индикаторы
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setIndicatorsHubOpen(false);
                    setIsCatalogOpen(true);
                  }}
                  className="text-primary hover:underline text-[9.5px] cursor-pointer"
                >
                  Каталог [I]
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1 text-[10px]">
                {[
                  { id: 'vwap', label: 'VWAP', active: showVwap },
                  { id: 'ema', label: 'EMA (3)', active: activeIndicators.some((i) => i.id === 'ema' && i.enabled !== false) },
                  { id: 'vol', label: 'Объем (VOL)', active: activeIndicators.some((i) => i.id === 'vol' && i.enabled !== false) },
                  { id: 'cvd', label: 'Дельта (CVD)', active: activeIndicators.some((i) => i.id === 'cvd' && i.enabled !== false) },
                  { id: 'rsi', label: 'RSI', active: activeIndicators.some((i) => i.id === 'rsi' && i.enabled !== false) },
                  { id: 'macd', label: 'MACD', active: activeIndicators.some((i) => i.id === 'macd' && i.enabled !== false) },
                ].map((ind) => (
                  <button
                    key={ind.id}
                    type="button"
                    onClick={() => toggleIndicator(ind.id)}
                    className={`px-2 py-1 rounded border text-left transition cursor-pointer flex items-center justify-between ${
                      ind.active
                        ? 'bg-primary/15 text-primary border-primary/40 font-bold'
                        : 'border-border/40 text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <span>{ind.label}</span>
                    {ind.active && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Synchronized Crosshair Toggle */}
          <button
            type="button"
            title={crosshairSync ? 'Синхронное перекрестие включено' : 'Синхронное перекрестие выключено'}
            onClick={toggleCrosshair}
            className={`p-1 rounded border transition cursor-pointer ${
              crosshairSync
                ? 'bg-primary/20 text-primary border-primary/40'
                : 'border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Crosshair size={12} />
          </button>

          {/* AI Opinion Button */}
          <button
            type="button"
            data-testid="btn-toolbar-second-opinion"
            onClick={handleAskSecondOpinion}
            disabled={isAskingOpinion}
            title="Консультативное второе мнение AI"
            className="px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1 border border-primary/40 bg-primary/15 text-primary hover:bg-primary/25 transition cursor-pointer font-bold shrink-0"
          >
            <span>🧠</span>
            <span className="hidden sm:inline">
              {isAskingOpinion ? 'Анализ...' : 'Мнение AI'}
            </span>
          </button>

          {/* 1-Click Quick Backtest Trigger & PnL Badge */}
          {handleQuickBt && (
            <div className="flex items-center space-x-1 pl-0.5">
              <button
                type="button"
                data-testid={`btn-quick-backtest-${chartId}`}
                onClick={handleQuickBt}
                disabled={isBacktesting}
                className={`px-1.5 py-0.5 rounded border transition cursor-pointer flex items-center gap-1 text-[10px] ${
                  isCurrentSymbolResult
                    ? 'bg-emerald-500/15 text-bull border-emerald-500/40 hover:bg-emerald-500/25'
                    : 'border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                title={`Запустить 1-click бэктест на истории ${symbol} (${timeframe})`}
              >
                {isBacktesting ? (
                  <Loader2 size={10} className="animate-spin text-primary" />
                ) : (
                  <Zap size={10} className={isCurrentSymbolResult ? 'text-bull' : 'text-warning'} />
                )}
                <span className="hidden md:inline">
                  {isBacktesting
                    ? 'Счет...'
                    : activeSetup?.entry_price > 0
                    ? `Тест (1:${activeSetup.rr_ratio || '?'})`
                    : 'Бэктест'}
                </span>
              </button>

              {isCurrentSymbolResult && activeBtResult && (
                <div className="flex items-center space-x-1 bg-muted/50 border border-border/80 px-1.5 py-0.5 rounded text-[9px] tabular-nums">
                  <span className="text-bull font-bold">
                    Win {activeBtResult.win_rate}%
                  </span>
                  <span className="text-muted-foreground">|</span>
                  <span className={(activeBtResult.net_profit_usd ?? 0) >= 0 ? 'text-bull' : 'text-bear'}>
                    {(activeBtResult.net_profit_usd ?? 0) >= 0 ? '+' : ''}${activeBtResult.net_profit_usd}
                  </span>
                  {setShowTradesOnChart && (
                    <button
                      type="button"
                      onClick={() => setShowTradesOnChart(!showTradesOnChart)}
                      className="text-muted-foreground hover:text-foreground ml-0.5 cursor-pointer"
                      title={showTradesOnChart ? 'Скрыть сделки с графика' : 'Показать сделки на графике'}
                    >
                      {showTradesOnChart ? <Eye size={10} className="text-primary" /> : <EyeOff size={10} />}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Close Widget (if dock panel permits) */}
          {onCloseWidget && (
            <button
              onClick={onCloseWidget}
              className="p-1 rounded text-muted-foreground hover:text-bear hover:bg-rose-400/10 transition cursor-pointer"
              title={`Закрыть ${titlePrefix || chartId}`}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* ======================================================== */}
      {/* ROW 2 (Collapsible): Palette & Line Style (h-7: 28px)    */}
      {/* ======================================================== */}
      {showStyleRow && (
        <div className="h-7 px-2 border-t border-border/60 bg-muted/20 flex items-center justify-between gap-2 text-xs animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Palette size={10} />
              <span>Цвет:</span>
            </span>

            {/* 16-color swatches */}
            <div className="flex items-center space-x-1">
              {PALETTE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => updateStyle({ strokeColor: c, fillColor: `${c}25` })}
                  className={`w-3 h-3 rounded-full transition cursor-pointer ${
                    activeDrawingStyle.strokeColor === c
                      ? 'ring-1 ring-primary ring-offset-1 scale-110'
                      : 'opacity-75 hover:opacity-100 hover:scale-105'
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>

            <div className="h-3 w-px bg-border/60 mx-1" />

            {/* Thickness */}
            <span className="text-[10px] text-muted-foreground">Толщина:</span>
            <div className="flex items-center space-x-0.5">
              {[1, 2, 3, 4].map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => updateStyle({ lineWidth: w })}
                  className={`px-1.5 py-0.2 text-[9.5px] rounded transition cursor-pointer ${
                    activeDrawingStyle.lineWidth === w
                      ? 'bg-primary text-primary-foreground font-bold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  {w}px
                </button>
              ))}
            </div>

            <div className="h-3 w-px bg-border/60 mx-1" />

            {/* Style: Solid / Dashed */}
            <span className="text-[10px] text-muted-foreground">Стиль:</span>
            <button
              type="button"
              onClick={() => updateStyle({ lineStyle: 'solid' })}
              className={`px-1.5 py-0.2 text-[9.5px] rounded transition cursor-pointer ${
                activeDrawingStyle.lineStyle === 'solid'
                  ? 'bg-primary/20 text-primary font-bold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Сплошная
            </button>
            <button
              type="button"
              onClick={() => updateStyle({ lineStyle: 'dashed' })}
              className={`px-1.5 py-0.2 text-[9.5px] rounded transition cursor-pointer ${
                activeDrawingStyle.lineStyle === 'dashed'
                  ? 'bg-primary/20 text-primary font-bold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Пунктир
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              data-testid="btn-save-as-template"
              title="Сохранить текущий стиль как шаблон SMC"
              onClick={() => setShowSaveTemplateModal(true)}
              className="px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1 text-muted-foreground hover:text-primary transition cursor-pointer"
            >
              <Bookmark size={11} />
              <span>Сохранить шаблон</span>
            </button>

            <button
              type="button"
              onClick={() => setShowStyleRow(false)}
              className="p-1 rounded text-muted-foreground hover:text-foreground cursor-pointer"
              title="Скрыть панель стиля"
            >
              <X size={11} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
