import React, { useState, useEffect, useRef } from 'react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
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
  MousePointer,
  Sliders,
  Bookmark,
  Palette,
  Layers,
  ChevronDown,
  SkipForward,
  Settings,
  MoreHorizontal
} from 'lucide-react';

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

// Верхняя полоса инструментов рисования и индикаторов графика
// (Tealstreet/Tiger style). Управляемый компонент: JSX извлечён ДОСЛОВНО из
// Chart.jsx (слайс 6.4h, п.1 MODULARIZATION_PLAN) — вся логика, состояние и
// колбэки остаются в Chart.jsx и приходят сюда пропами. Все data-testid 1:1.
export default function ChartToolbar({
  titlePrefix, timeframe, onTimeframeChange, onScrollToNow, onCloseWidget, chartId,
  activeTool, cancelActiveDrawing, handleSelectTool,
  magnetEnabled, setMagnetEnabled, handleUndo, handleClearDrawings, saveDrawings,
  isTemplateMenuOpen, setIsTemplateMenuOpen, setShowSaveTemplateModal,
  drawingTemplates, applyTemplate, updateStyle, activeDrawingStyle,
  statusMsg, handleAskSecondOpinion, isAskingOpinion,
  setIsCatalogOpen, activeIndicators, toggleLiveSignals, showLiveSignals,
  showHeatmap, setShowHeatmap, loadHeatmap,
  showFootprint, setShowFootprint, showTpo, setShowTpo,
  showLiquidations, setShowLiquidations, showWalls, setShowWalls,
  densityMode, setDensityMode, toggleVolatilityCone, isConeActive,
  toggleIndicator, showVwap,
}) {
  // Основные настройки TPO/стенок (запрос Di): период TPO, Value Area,
  // привязка к правому краю; порог/бюджет стенок. Хранятся в localStorage,
  // оверлеи перечитывают их через событие signalscript:chart-settings-changed.
  const [layersHubOpen, setLayersHubOpen] = useState(false);
  const [tpoSettingsOpen, setTpoSettingsOpen] = useState(false);
  const [wallSettingsOpen, setWallSettingsOpen] = useState(false);
  const [tpoSettings, setTpoSettings] = useState(() => readSettings('chart_tpo_settings', TPO_SETTINGS_DEFAULTS));
  const [wallSettings, setWallSettings] = useState(() => readSettings('chart_walls_settings', WALL_SETTINGS_DEFAULTS));
  const [liqPalette, setLiqPalette] = useState(() => localStorage.getItem('chart_liq_palette') || 'magma');
  const [liqOpacity, setLiqOpacity] = useState(() => Number(localStorage.getItem('chart_liq_opacity')) || 0.85);
  const [liqBlur, setLiqBlur] = useState(() => Number(localStorage.getItem('chart_liq_blur')) || 1.3);
  const [liqMinUsd, setLiqMinUsd] = useState(() => Number(localStorage.getItem('chart_liq_min_usd')) || 25000);

  const updateLiqSetting = (key, val, setter) => {
    setter(val);
    localStorage.setItem(key, String(val));
    window.dispatchEvent(new CustomEvent('signalscript:chart-settings-changed'));
  };

  const activeLayersCount = [
    showHeatmap,
    showFootprint,
    showTpo,
    showLiquidations,
    showWalls,
    isConeActive,
  ].filter(Boolean).length;
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
  const settingsRow = 'flex items-center justify-between gap-2 px-2 py-1 text-[10px] font-mono text-[#94a3b8]';
  const settingsSelect = 'bg-[#0c1017] border border-[#1f2937] rounded text-[10px] text-[#e2e8f0] px-1 py-0.5';
  const settingsPanel = 'absolute top-full right-0 mt-1 w-60 bg-[#0f1420] border border-[#2a3449] rounded shadow-2xl z-50 py-1';

  const toolbarRef = useRef(null);
  const [toolbarWidth, setToolbarWidth] = useState(1000);

  useEffect(() => {
    if (!toolbarRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect) {
          setToolbarWidth(entry.contentRect.width);
        }
      }
    });
    obs.observe(toolbarRef.current);
    return () => obs.disconnect();
  }, []);

  const isCompact = toolbarWidth < 900;
  const isNarrow = toolbarWidth < 720;

  return (
      <div
        ref={toolbarRef}
        className="flex items-center justify-between px-2 py-0.5 border-b border-border/60 bg-card/90 text-xs gap-1 shrink-0 text-foreground h-[28px] overflow-hidden"
      >
        {/* Drawing Tools */}
        <div className="flex items-center gap-0.5 shrink-0 overflow-hidden">
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

          {/* Default Cursor / Pan Mode Button */}
          <button
            type="button"
            data-testid="btn-scroll-to-now"
            title="Пролистать к актуальному времени (Space)"
            onClick={() => onScrollToNow && onScrollToNow()}
            className="p-1 rounded text-[#787f91] hover:text-[#38bdf8] hover:bg-[#161922] transition"
          >
            <SkipForward size={12} />
          </button>

          <button 
            type="button"
            title="Курсор / Свободное перетаскивание графика (Esc)" 
            onClick={() => cancelActiveDrawing()}
            className={`px-1.5 py-0.5 rounded text-[10.5px] font-mono flex items-center transition ${
              !activeTool ? 'bg-primary/20 text-primary border border-primary/40 font-bold' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <MousePointer size={11} className="mr-0.5" />
            <span className="hidden 2xl:inline">Курсор</span>
          </button>

          <button 
            title="Трендовая линия (Отрезок)" 
            onClick={() => handleSelectTool('segment')}
            className={`px-1.5 py-0.5 rounded text-[10.5px] font-mono flex items-center transition ${activeTool === 'segment' ? 'bg-primary/20 text-primary border border-primary/40 font-bold' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
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

          <button 
            data-testid="tool-risk-reward"
            title="Интерактивный сетап Risk/Reward (Entry / TP / SL)" 
            onClick={() => handleSelectTool('positionSetupBox')}
            className={`px-1.5 py-0.5 rounded text-[10.5px] font-mono flex items-center transition ${activeTool === 'positionSetupBox' ? 'bg-[#10b981] text-white font-bold' : 'text-[#787f91] hover:bg-[#161922] hover:text-[#10b981]'}`}
          >
            <TrendingUp size={12} className="mr-0.5 text-[#10b981]" />
            <span className="hidden xl:inline">R:R Box</span>
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

          <div className="h-3.5 w-px bg-[#1f2430] mx-0.5" />

          {/* SMC Templates Dropdown */}
          <div className="relative inline-block">
            <button
              data-testid="btn-smc-templates"
              type="button"
              onClick={() => setIsTemplateMenuOpen(!isTemplateMenuOpen)}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 bg-[#161d2e] hover:bg-[#2563eb] text-[#38bdf8] hover:text-white border border-[#38bdf840] transition cursor-pointer"
              title="Готовые шаблоны Smart Money Concepts (BOS, OB, FVG, Ликвидность)"
            >
              <Layers size={11} />
              <span>Шаблоны SMC</span>
              <ChevronDown size={10} />
            </button>

            {isTemplateMenuOpen && (
              <div 
                data-testid="smc-templates-dropdown"
                className="absolute top-full left-0 mt-1 w-64 bg-[#0f1420] border border-[#2a3449] rounded shadow-2xl z-50 py-1 divide-y divide-[#1b2333]"
              >
                <div className="px-2 py-1 text-[9.5px] font-bold text-[#64748b] uppercase tracking-wider flex items-center justify-between">
                  <span>Шаблоны SMC</span>
                  <button 
                    type="button"
                    onClick={() => { setIsTemplateMenuOpen(false); setShowSaveTemplateModal(true); }}
                    className="text-[#38bdf8] hover:underline normal-case font-normal text-[9px] cursor-pointer"
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
                      className="w-full text-left px-2.5 py-1.5 hover:bg-[#182236] transition flex items-center justify-between group cursor-pointer"
                    >
                      <div className="flex flex-col min-w-0 pr-1">
                        <span className="text-[10.5px] text-white font-medium group-hover:text-[#38bdf8] truncate">
                          {t.name}
                        </span>
                        <span className="text-[9px] text-[#64748b] leading-tight truncate">
                          {t.description}
                        </span>
                      </div>
                      {t.badge && (
                        <span 
                          className="px-1 py-0.2 rounded text-[8.5px] font-bold shrink-0 ml-1"
                          style={{ backgroundColor: `${t.badgeColor || '#38bdf8'}25`, color: t.badgeColor || '#38bdf8' }}
                        >
                          {t.badge}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Quick Style Palette & Thickness */}
          <div className="flex items-center space-x-1 px-1 bg-[#0c1017] rounded border border-[#1e2536] py-0.5">
            <Palette size={10} className="text-[#64748b] ml-0.5" />
            {['#38bdf8', '#10b981', '#ef4444', '#f59e0b', '#a855f7'].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => updateStyle({ strokeColor: c, fillColor: `${c}25` })}
                className={`w-2.5 h-2.5 rounded-full transition cursor-pointer ${
                  activeDrawingStyle.strokeColor === c ? 'ring-1 ring-white scale-125' : 'opacity-70 hover:opacity-100'
                }`}
                style={{ backgroundColor: c }}
                title={`Цвет ${c}`}
              />
            ))}
            <div className="h-2.5 w-px bg-[#1f2430] mx-0.5" />
            {[1, 2, 3].map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => updateStyle({ lineWidth: w })}
                className={`px-0.5 text-[9px] font-mono rounded cursor-pointer ${
                  activeDrawingStyle.lineWidth === w ? 'bg-[#2563eb] text-white font-bold' : 'text-[#64748b] hover:text-white'
                }`}
                title={`Толщина ${w}px`}
              >
                {w}p
              </button>
            ))}
          </div>

          <button
            data-testid="btn-save-as-template"
            title="Сохранить текущий стиль как шаблон SMC"
            onClick={() => setShowSaveTemplateModal(true)}
            className="p-1 rounded text-[#787f91] hover:text-[#38bdf8] hover:bg-[#38bdf818] transition cursor-pointer"
          >
            <Bookmark size={11} />
          </button>
        </div>

        {/* Indicators, Overlays and Storage Status */}
        <div className="flex items-center flex-wrap gap-1 font-mono-numbers shrink-0">
          {statusMsg && (
            <span className="text-[#f59e0b] text-[10px] font-mono animate-pulse mr-1">{statusMsg}</span>
          )}

          {/* Stage 2: Consultative Second Opinion Button in Toolbar */}
          <button
            type="button"
            data-testid="btn-toolbar-second-opinion"
            onClick={handleAskSecondOpinion}
            disabled={isAskingOpinion}
            title="Консультативное второе мнение AI по текущему сетапу и рынку (без автоторговли)"
            className="px-1.5 py-0.5 rounded text-[10px] font-mono transition flex items-center space-x-1 bg-[#2e1065] hover:bg-[#581c87] text-[#e9d5ff] border border-[#a855f760] mr-0.5 cursor-pointer font-bold"
          >
            <span>🧠</span>
            <span>{isAskingOpinion ? 'Анализ...' : 'Мнение AI'}</span>
          </button>

          <button 
            data-testid="btn-open-indicators-modal"
            title="Каталог индикаторов & Order Flow (Клавиша 'I')" 
            onClick={() => setIsCatalogOpen(true)}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono transition flex items-center space-x-1 bg-[#1e293b] hover:bg-[#2563eb] text-[#38bdf8] hover:text-white border border-[#38bdf850] mr-0.5 cursor-pointer"
          >
            <Sliders size={11} />
            <span>Индикаторы [I] ({activeIndicators.filter(i => i.enabled !== false).length})</span>
          </button>

          {/* Real-time Signals & Backtest Markers Toggle (Requirement 3) */}
          <button
            type="button"
            data-testid="btn-toggle-signals"
            title="Отображение сигналов стратегий и трейдов на графике"
            onClick={toggleLiveSignals}
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition flex items-center space-x-1 cursor-pointer mr-0.5 ${
              showLiveSignals
                ? 'bg-[#10b98122] text-[#10b981] border border-[#10b98160]'
                : 'text-[#60697b] hover:text-white border border-transparent'
            }`}
          >
            <Eye size={11} className={showLiveSignals ? 'text-[#10b981]' : 'text-[#60697b]'} />
            <span>Сигналы</span>
          </button>

          {/* Unified Layers Hub Popover (alphfractal/coinglass style centralized layer hub) */}
          <div className="relative inline-block mr-0.5">
            <button
              type="button"
              data-testid="btn-toolbar-layers-hub"
              onClick={() => {
                setLayersHubOpen(v => !v);
                setTpoSettingsOpen(false);
                setWallSettingsOpen(false);
                setIsTemplateMenuOpen(false);
              }}
              title="Центр управления слоями графика: Ликвидации, Футпринт, TPO, Стенки, Конус"
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition flex items-center space-x-1 cursor-pointer ${
                layersHubOpen
                  ? 'bg-[#38bdf825] text-[#38bdf8] border border-[#38bdf8]'
                  : activeLayersCount > 0
                    ? 'bg-[#182030] text-[#38bdf8] border border-[#2b3955] hover:bg-[#1f2b42]'
                    : 'text-[#60697b] hover:text-white border border-transparent'
              }`}
            >
              <Layers size={11} />
              <span className="font-semibold">Слои</span>
              {activeLayersCount > 0 && (
                <span className="px-1 py-0.1 text-[8.5px] rounded-full bg-[#2563eb] text-white font-bold">
                  {activeLayersCount}
                </span>
              )}
              <ChevronDown size={10} className={`transition-transform duration-150 ${layersHubOpen ? 'rotate-180' : ''}`} />
            </button>

            {layersHubOpen && (
              <div
                data-testid="layers-hub-dropdown"
                className="absolute top-full right-0 mt-1 w-72 bg-[#0c1017] border border-[#1f293d] rounded-lg shadow-2xl z-50 p-2.5 flex flex-col gap-2.5 backdrop-blur-md text-slate-200"
              >
                {/* Header */}
                <div className="flex items-center justify-between pb-1.5 border-b border-[#1b2333]">
                  <div className="flex items-center gap-1.5">
                    <Layers size={12} className="text-[#38bdf8]" />
                    <span className="text-[11px] font-bold text-white tracking-wide">Слои & Order Flow</span>
                  </div>
                  <span className="text-[9.5px] text-[#64748b] font-mono">
                    Активно: {activeLayersCount}/6
                  </span>
                </div>

                {/* Layer 1: Heatmap (Alphfractal / Coinglass) */}
                <div className="p-1.5 rounded bg-[#101420] border border-[#1b2333] flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showHeatmap}
                        onChange={() => {
                          const next = !showHeatmap;
                          setShowHeatmap(next);
                          localStorage.setItem('chart_heatmap', next ? 'true' : 'false');
                          if (next && loadHeatmap) loadHeatmap(true);
                        }}
                        className="rounded accent-amber-500"
                      />
                      <span className="text-[10.5px] font-bold text-amber-400">🔥 Карта ликвидаций (WebGL)</span>
                    </label>
                  </div>
                  {showHeatmap && (
                    <div className="flex flex-col gap-1 pl-4 pt-1 border-t border-[#1b2333]/60 text-[9.5px]">
                      <div className="flex items-center justify-between text-slate-400">
                        <span>Палитра:</span>
                        <div className="flex gap-1">
                          {['magma', 'sunset', 'viridis'].map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => updateLiqSetting('chart_liq_palette', p, setLiqPalette)}
                              className={`px-1 py-0.2 rounded text-[8.5px] uppercase transition cursor-pointer ${
                                liqPalette === p
                                  ? 'bg-amber-500/25 text-amber-300 border border-amber-500/60 font-bold'
                                  : 'bg-[#151a26] text-slate-400 border border-[#232a3b]'
                              }`}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-slate-400">
                        <span>Непрозрачность: {Math.round(liqOpacity * 100)}%</span>
                        <input
                          type="range"
                          min="0.2"
                          max="1.0"
                          step="0.05"
                          value={liqOpacity}
                          onChange={(e) => updateLiqSetting('chart_liq_opacity', Number(e.target.value), setLiqOpacity)}
                          className="w-24 accent-amber-500 h-1 bg-[#1b2333] rounded cursor-pointer"
                        />
                      </div>
                      <div className="flex items-center justify-between text-slate-400">
                        <span>Мин. порог:</span>
                        <div className="flex gap-1">
                          {[10000, 25000, 50000, 100000].map((v) => (
                            <button
                              key={v}
                              type="button"
                              onClick={() => updateLiqSetting('chart_liq_min_usd', v, setLiqMinUsd)}
                              className={`px-1 py-0.2 rounded text-[8.5px] transition cursor-pointer ${
                                liqMinUsd === v
                                  ? 'bg-amber-500/25 text-amber-300 border border-amber-500/60 font-bold'
                                  : 'bg-[#151a26] text-slate-400 border border-[#232a3b]'
                              }`}
                            >
                              ${v / 1000}k
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Layer 2: Footprint (Canvas 2D) */}
                <div className="p-1.5 rounded bg-[#101420] border border-[#1b2333] flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showFootprint}
                        onChange={() => {
                          const next = !showFootprint;
                          setShowFootprint(next);
                          localStorage.setItem('chart_footprint', next ? 'true' : 'false');
                        }}
                        className="rounded accent-emerald-500"
                      />
                      <span className="text-[10.5px] font-bold text-emerald-400">👣 Футпринт (Кластеры Bid x Ask)</span>
                    </label>
                  </div>
                  {showFootprint && (
                    <div className="text-[9px] text-slate-400 pl-4 border-t border-[#1b2333]/60 pt-1">
                      Отображает дельту, имбалансы (бордер), absorption (▬) и Naked POC уровни.
                    </div>
                  )}
                </div>

                {/* Layer 3: TPO & Volume Profile */}
                <div className="p-1.5 rounded bg-[#101420] border border-[#1b2333] flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showTpo}
                        onChange={() => {
                          const next = !showTpo;
                          setShowTpo(next);
                          localStorage.setItem('chart_tpo', next ? 'true' : 'false');
                        }}
                        className="rounded accent-sky-500"
                      />
                      <span className="text-[10.5px] font-bold text-sky-400">📊 TPO & Профиль объёма</span>
                    </label>
                  </div>
                  {showTpo && (
                    <div className="flex flex-col gap-1 pl-4 pt-1 border-t border-[#1b2333]/60 text-[9.5px]">
                      <div className="flex items-center justify-between text-slate-400">
                        <span>Период TPO:</span>
                        <select
                          className={settingsSelect}
                          value={tpoSettings.period_minutes}
                          onChange={(e) => updateTpoSettings({ period_minutes: Number(e.target.value) })}
                        >
                          {[5, 15, 30, 60].map(v => <option key={v} value={v}>{v} мин</option>)}
                        </select>
                      </div>
                      <div className="flex items-center justify-between text-slate-400">
                        <span>Value Area:</span>
                        <select
                          className={settingsSelect}
                          value={tpoSettings.value_area}
                          onChange={(e) => updateTpoSettings({ value_area: Number(e.target.value) })}
                        >
                          {[0.5, 0.6, 0.7, 0.8].map(v => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* Layer 4: Liquidity Walls */}
                <div className="p-1.5 rounded bg-[#101420] border border-[#1b2333] flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showWalls}
                        onChange={() => {
                          const next = !showWalls;
                          setShowWalls(next);
                          localStorage.setItem('chart_walls', next ? 'true' : 'false');
                        }}
                        className="rounded accent-emerald-500"
                      />
                      <span className="text-[10.5px] font-bold text-emerald-300">🧲 Стенки стакана (Depth20)</span>
                    </label>
                  </div>
                  {showWalls && (
                    <div className="flex flex-col gap-1 pl-4 pt-1 border-t border-[#1b2333]/60 text-[9.5px]">
                      <div className="flex items-center justify-between text-slate-400">
                        <span>Мин. стенка:</span>
                        <select
                          className={settingsSelect}
                          value={wallSettings.min_usd}
                          onChange={(e) => updateWallSettings({ min_usd: Number(e.target.value) })}
                        >
                          <option value={100000}>$100k</option>
                          <option value={250000}>$250k</option>
                          <option value={400000}>$400k</option>
                          <option value={1000000}>$1M</option>
                        </select>
                      </div>
                      <div className="flex items-center justify-between text-slate-400">
                        <span>Макс. уровней:</span>
                        <select
                          className={settingsSelect}
                          value={wallSettings.max_walls}
                          onChange={(e) => updateWallSettings({ max_walls: Number(e.target.value) })}
                        >
                          {[2, 3, 4, 6].map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* Layer 5: Volatility Cone */}
                <div className="p-1.5 rounded bg-[#101420] border border-[#1b2333] flex items-center justify-between">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isConeActive}
                      onChange={toggleVolatilityCone}
                      className="rounded accent-sky-500"
                    />
                    <span className="text-[10.5px] font-bold text-sky-300">📐 Конус волатильности (±1σ/±2σ)</span>
                  </label>
                </div>

                {/* Layer 6: Density Mode */}
                <div className="flex items-center justify-between pt-1 border-t border-[#1b2333] text-[9.5px] text-slate-400">
                  <span>Режим плотности свечей:</span>
                  <select
                    value={densityMode}
                    onChange={(e) => {
                      const next = e.target.value;
                      setDensityMode(next);
                      localStorage.setItem('chart_density_mode', next);
                    }}
                    className={settingsSelect}
                  >
                    <option value="auto">Auto</option>
                    <option value="compact">Compact</option>
                    <option value="full">Full</option>
                  </select>
                </div>
              </div>
            )}
          </div>
          
          {/* Loose Quick Buttons: Visible when width >= 720, or in Layers Hub dropdown */}
          {!isNarrow && (
            <>
          <button
            data-testid="btn-toolbar-toggle-heatmap"
            title="Тепловая карта плотностей стакана во времени"
            onClick={() => {
              const next = !showHeatmap;
              setShowHeatmap(next);
              localStorage.setItem('chart_heatmap', next ? 'true' : 'false');
              if (next) loadHeatmap(true);
            }}
            className={`px-1 py-0.2 rounded text-[9.5px] font-mono transition flex items-center ${showHeatmap ? 'bg-[#ff980022] text-[#ff9800] border border-[#ff980050]' : 'text-[#60697b] hover:text-white'}`}
          >
            <span>🔥</span>
            <span className="hidden xl:inline ml-0.5">Плотн.</span>
          </button>

          <button
            data-testid="btn-toolbar-toggle-footprint"
            title="Footprint внутри свечей: buy/sell по уровням, imbalance (бордер), stacked ♦, absorption ▬"
            onClick={() => {
              const next = !showFootprint;
              setShowFootprint(next);
              localStorage.setItem('chart_footprint', next ? 'true' : 'false');
            }}
            className={`px-1 py-0.2 rounded text-[9.5px] font-mono transition flex items-center ${showFootprint ? 'bg-[#10b98122] text-[#10b981] border border-[#10b98150]' : 'text-[#60697b] hover:text-white'}`}
          >
            <span>👣</span>
            <span className="hidden xl:inline ml-0.5">Футпр.</span>
          </button>

          <button
            data-testid="btn-toolbar-toggle-tpo"
            title="TPO/Volume Profile из записанных принтов: гистограмма TPO, Value Area (TVAH/TVAL), POC"
            onClick={() => {
              const next = !showTpo;
              setShowTpo(next);
              localStorage.setItem('chart_tpo', next ? 'true' : 'false');
            }}
            className={`px-1 py-0.2 rounded text-[9.5px] font-mono transition flex items-center ${showTpo ? 'bg-[#38bdf822] text-[#38bdf8] border border-[#38bdf850]' : 'text-[#60697b] hover:text-white'}`}
          >
            <span>📊</span>
            <span className="hidden xl:inline ml-0.5">TPO</span>
          </button>
          <span className="relative inline-flex">
            <button
              data-testid="btn-toolbar-tpo-settings"
              title="Настройки TPO: период, Value Area, привязка к краю"
              onClick={() => { setTpoSettingsOpen(v => !v); setWallSettingsOpen(false); }}
              className={`px-0.5 py-0.2 rounded text-[9.5px] transition -ml-1 ${tpoSettingsOpen ? 'text-[#38bdf8]' : 'text-[#60697b] hover:text-white'}`}
            >
              <Settings size={10} />
            </button>
            {tpoSettingsOpen && (
              <div data-testid="tpo-settings-panel" className={settingsPanel}>
                <label className={settingsRow}>
                  <span>Период TPO</span>
                  <select aria-label="Период TPO" className={settingsSelect} value={tpoSettings.period_minutes}
                    onChange={(e) => updateTpoSettings({ period_minutes: Number(e.target.value) })}>
                    {[5, 15, 30, 60].map(v => <option key={v} value={v}>{v} мин</option>)}
                  </select>
                </label>
                <label className={settingsRow}>
                  <span>Value Area</span>
                  <select aria-label="Доля Value Area" className={settingsSelect} value={tpoSettings.value_area}
                    onChange={(e) => updateTpoSettings({ value_area: Number(e.target.value) })}>
                    {[0.5, 0.6, 0.7, 0.8].map(v => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
                  </select>
                </label>
                <label className={settingsRow}>
                  <span>К правому краю</span>
                  <input aria-label="Привязка TPO к правому краю" type="checkbox" checked={tpoSettings.pin_to_edge !== false}
                    onChange={(e) => updateTpoSettings({ pin_to_edge: e.target.checked })} />
                </label>
              </div>
            )}
          </span>

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

          <button 
            data-testid="btn-toolbar-toggle-walls"
            title="Лимитные стенки-магниты стакана (depth20)"
            onClick={() => {
              const next = !showWalls;
              setShowWalls(next);
              localStorage.setItem('chart_walls', next ? 'true' : 'false');
            }}
            className={`px-1 py-0.2 rounded text-[9.5px] font-mono transition flex items-center ${showWalls ? 'bg-[#10b98122] text-[#10b981] border border-[#10b98150]' : 'text-[#60697b] hover:text-white'}`}
          >
            <span>🧲</span>
            <span className="hidden xl:inline ml-0.5">Стенки</span>
          </button>
          <span className="relative inline-flex">
            <button
              data-testid="btn-toolbar-walls-settings"
              title="Настройки стенок: минимальный объём, максимум уровней"
              onClick={() => { setWallSettingsOpen(v => !v); setTpoSettingsOpen(false); }}
              className={`px-0.5 py-0.2 rounded text-[9.5px] transition -ml-1 ${wallSettingsOpen ? 'text-[#10b981]' : 'text-[#60697b] hover:text-white'}`}
            >
              <Settings size={10} />
            </button>
            {wallSettingsOpen && (
              <div data-testid="walls-settings-panel" className={settingsPanel}>
                <label className={settingsRow}>
                  <span>Мин. стенка</span>
                  <select aria-label="Минимальный объём стенки" className={settingsSelect} value={wallSettings.min_usd}
                    onChange={(e) => updateWallSettings({ min_usd: Number(e.target.value) })}>
                    <option value={100000}>$100k</option>
                    <option value={250000}>$250k</option>
                    <option value={400000}>$400k</option>
                    <option value={1000000}>$1M</option>
                  </select>
                </label>
                <label className={settingsRow}>
                  <span>Макс. уровней</span>
                  <select aria-label="Максимум уровней стенок" className={settingsSelect} value={wallSettings.max_walls}
                    onChange={(e) => updateWallSettings({ max_walls: Number(e.target.value) })}>
                    {[2, 3, 4, 6].map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
              </div>
            )}
          </span>

          <label
            data-testid="density-mode-control"
            className="flex items-center gap-1 px-1 py-0.2 rounded border border-[#1f2937] bg-[#0c1017] text-[9px] text-[#94a3b8] font-mono"
            title="Адаптивное количество уровней плотности: Auto подстраивается под ширину графика, Compact уменьшает шум, Full показывает больше уровней"
          >
            <span className="hidden 2xl:inline">Плотность</span>
            <select
              aria-label="Режим плотности графика"
              value={densityMode}
              onChange={(event) => {
                const next = event.target.value;
                setDensityMode(next);
                localStorage.setItem('chart_density_mode', next);
              }}
              className="bg-transparent text-[#cbd5e1] outline-none cursor-pointer text-[9px]"
            >
              <option value="auto" className="bg-[#0f1420]">Auto</option>
              <option value="compact" className="bg-[#0f1420]">Compact</option>
              <option value="full" className="bg-[#0f1420]">Full</option>
            </select>
          </label>

          <button 
            data-testid="btn-toolbar-toggle-cone"
            title="Вероятностный прогнозный конус волатильности (±1σ / ±2σ)"
            onClick={toggleVolatilityCone}
            className={`px-1 py-0.2 rounded text-[9.5px] font-mono transition flex items-center ${isConeActive ? 'bg-[#38bdf822] text-[#38bdf8] border border-[#38bdf850]' : 'text-[#60697b] hover:text-white'}`}
          >
            <span>📐</span>
            <span className="hidden xl:inline ml-0.5">Конус</span>
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
            className={`px-1 py-0.2 rounded text-[9.5px] font-mono transition ${activeIndicators.some(i => i.id === 'ema' && i.enabled !== false) ? 'bg-[#1e293b] text-[#38bdf8] border border-[#38bdf840]' : 'text-[#60697b] hover:text-white'}`}
          >
            EMA
          </button>

          <button 
            onClick={() => toggleIndicator('vol')}
            className={`px-1 py-0.2 rounded text-[9.5px] font-mono transition ${activeIndicators.some(i => i.id === 'vol' && i.enabled !== false) ? 'bg-[#1e293b] text-[#26a69a] border border-[#26a69a40]' : 'text-[#60697b] hover:text-white'}`}
          >
            VOL
          </button>

          <button 
            onClick={() => toggleIndicator('cvd')}
            className={`px-1 py-0.2 rounded text-[9.5px] font-mono transition ${activeIndicators.some(i => i.id === 'cvd' && i.enabled !== false) ? 'bg-[#1e293b] text-[#00e5ff] border border-[#00e5ff40]' : 'text-[#60697b] hover:text-white'}`}
            title="Кумулятивная дельта объёма (CVD)"
          >
            CVD
          </button>

          <button 
            onClick={() => toggleIndicator('rsi')}
            className={`px-1 py-0.2 rounded text-[9.5px] font-mono transition ${activeIndicators.some(i => i.id === 'rsi' && i.enabled !== false) ? 'bg-[#1e293b] text-[#a855f7] border border-[#a855f740]' : 'text-[#60697b] hover:text-white'}`}
          >
            RSI
          </button>
          
          <button 
            onClick={() => toggleIndicator('macd')}
            className={`px-1 py-0.2 rounded text-[9.5px] font-mono transition ${activeIndicators.some(i => i.id === 'macd' && i.enabled !== false) ? 'bg-[#1e293b] text-[#f59e0b] border border-[#f59e0b40]' : 'text-[#60697b] hover:text-white'}`}
          >
            MACD
          </button>
            </>
          )}

          {isNarrow && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-testid="btn-toolbar-narrow-more"
                  className="px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer shrink-0"
                  title="Быстрые слои и индикаторы"
                >
                  <MoreHorizontal size={11} />
                  <span>Ещё</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 p-1 font-mono text-xs">
                <DropdownMenuItem onClick={() => { const next = !showLiquidations; setShowLiquidations(next); localStorage.setItem('chart_liquidations', next ? 'true' : 'false'); }}>
                  💥 Ликвидации {showLiquidations ? '✓' : ''}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { const next = !showWalls; setShowWalls(next); localStorage.setItem('chart_walls', next ? 'true' : 'false'); }}>
                  🧲 Стенки стакана {showWalls ? '✓' : ''}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { const next = !showHeatmap; setShowHeatmap(next); localStorage.setItem('chart_heatmap', next ? 'true' : 'false'); if (next) loadHeatmap(true); }}>
                  🔥 Плотности {showHeatmap ? '✓' : ''}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { const next = !showFootprint; setShowFootprint(next); localStorage.setItem('chart_footprint', next ? 'true' : 'false'); }}>
                  👣 Footprint {showFootprint ? '✓' : ''}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { const next = !showTpo; setShowTpo(next); localStorage.setItem('chart_tpo', next ? 'true' : 'false'); }}>
                  📊 TPO Профиль {showTpo ? '✓' : ''}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={toggleVolatilityCone}>
                  📐 Конус волатильности {isConeActive ? '✓' : ''}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => toggleIndicator('vwap')}>
                  📈 VWAP {showVwap ? '✓' : ''}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {onCloseWidget && (
            <button
              onClick={onCloseWidget}
              className="p-0.5 ml-0.5 rounded text-[#60697b] hover:text-[#ef5350] hover:bg-[#ef535018] transition cursor-pointer"
              title={`Скрыть виджет графика ${titlePrefix || chartId}`}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>
  );
}
