import React from 'react';
import {
  TrendingUp,
  Search,
  AlertTriangle,
  Bell,
  VolumeX,
  Volume2,
  Keyboard,
  Plus,
  ChevronDown,
  LineChart,
  Layers,
  BookOpen,
  Activity,
  Zap,
  BarChart2,
  ExternalLink,
  Columns,
  Minimize2,
  Maximize2,
  Sparkles,
  BarChart3,
  Radio,
  Target,
  PanelRightClose,
  PanelRightOpen,
  Settings
} from 'lucide-react';
import { useAlertsStore } from '../../stores/alertsStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { TIMEFRAMES, POPULAR_SYMBOLS, THEME_BADGE } from './constants';

// Верхняя шапка терминала (Velo / Bookmap style) — вынесена из App.jsx (модульный план, п.5).
// Управляемый презентационный компонент: бренд, активный символ + поиск + watchlist,
// деноминация (COIN/USDT/USDC), переключатель таймфреймов, проксимити-баннер, алерты,
// звук, горячие клавиши, дропдаун «+ Add Widget» (сторы useAlertsStore/useLayoutStore —
// глобальные, импортируются здесь напрямую), тоглы панелей, тема и вход в настройки.
// Вся логика состояния остаётся в App — сюда прокидываются значения и колбэки.

export default function AppTopBar({
  symbol,
  searchInput,
  onSearchInputChange,
  onSearchSubmit,
  denomination,
  onDenomination,
  timeframe,
  onTimeframe,
  activeProximityAlert,
  activeAiModel,
  isMuted,
  onToggleSound,
  onToggleHotkeyHelp,
  isAddWidgetDropdownOpen,
  onToggleAddWidgetDropdown,
  onAddWidget,
  isDualPane,
  onToggleDualPane,
  isFocusMode,
  onToggleFocusMode,
  showAICopilot,
  onToggleAICopilot,
  showDecisionJournal,
  onOpenDecisionJournal,
  showReplay,
  onOpenReplay,
  showBacktest,
  onToggleBacktest,
  showOrderBook,
  onToggleOrderBook,
  showTape,
  onToggleTape,
  showSignals,
  onToggleSignals,
  showLiqLayers,
  onToggleLiqLayers,
  showLiqPanel,
  onToggleLiqPanel,
  onSymbolChange,
  anyRightPanelOpen,
  onToggleRightPanels,
  theme,
  onCycleTheme,
  onOpenSettings
}) {
  return (
    <header
      style={{ backgroundColor: '#0b0e11', borderColor: 'rgba(255, 255, 255, 0.07)' }}
      className="flex items-center justify-between px-2.5 h-[34px] border-b z-20 text-xs gap-2 min-w-0 shrink-0"
    >
      {/* Left: Brand, Active Coin, Watchlist pills, Denomination switch */}
      <div className="flex items-center space-x-2 min-w-0 shrink-0">
        <div className="flex items-center space-x-1 font-bold text-white tracking-wider text-[11px] shrink-0">
          <TrendingUp size={13} className="text-[#38bdf8]" />
          <span>
            Signal<span className="text-[#38bdf8]">Script</span>
          </span>
        </div>

        <div className="h-3 w-px bg-neutral-800 mx-0.5 shrink-0" />

        {/* Active Symbol & Search */}
        <div className="flex items-center space-x-1 font-mono min-w-0">
          <span className="text-[11px] font-bold text-white bg-[#12161f] px-1.5 py-0.5 rounded border border-neutral-800 shrink-0">
            {symbol}
          </span>

          <form onSubmit={onSearchSubmit} className="relative shrink-0">
            <input
              type="text"
              placeholder="Поиск..."
              value={searchInput}
              onChange={(e) => onSearchInputChange(e.target.value)}
              className="w-16 xl:w-20 focus:w-24 transition-all duration-150 bg-[#07090b] border border-neutral-800 rounded px-1.5 py-0.5 text-[10px] text-white placeholder-neutral-500 outline-none font-mono focus:border-blue-500"
            />
            <Search size={10} className="absolute right-1.5 top-1.5 text-neutral-500 pointer-events-none" />
          </form>

          {/* Quick Watchlist pills */}
          <div className="hidden xl:flex items-center space-x-0.5 pl-0.5">
            {POPULAR_SYMBOLS.map((sym) => (
              <button
                key={sym}
                onClick={() => onSymbolChange(sym)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition ${
                  symbol === sym
                    ? 'bg-[#2563eb] text-white font-bold'
                    : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
                }`}
              >
                {sym.replace('USDT', '')}
              </button>
            ))}
          </div>
        </div>

        <div className="h-3 w-px bg-neutral-800 mx-0.5 shrink-0" />

        {/* Asset Denomination Toggle: COIN / USDT / USDC */}
        <div className="flex items-center bg-[#07090b] rounded p-0.5 border border-neutral-800 text-[9.5px] font-mono shrink-0">
          {['COIN', 'USDT', 'USDC'].map((d) => (
            <button
              key={d}
              type="button"
              data-testid={`denomination-${d}`}
              onClick={() => onDenomination(d)}
              className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                denomination === d
                  ? 'bg-neutral-800 text-white font-bold shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Center: Sleek Institutional Timeframe Switcher */}
      <div className="flex items-center space-x-0.5 bg-[#07090b] p-0.5 rounded border border-neutral-800 font-mono shrink-0">
        <span className="hidden sm:inline text-[9px] text-neutral-400 px-1 font-semibold uppercase tracking-wider">TF:</span>
        {TIMEFRAMES.map((tf, idx) => (
          <button
            key={tf}
            data-testid={`timeframe-btn-${tf}`}
            onClick={() => onTimeframe(tf)}
            title={`Клавиша ${idx + 1}`}
            className={`px-1.5 py-0.5 rounded text-[10px] transition cursor-pointer ${
              timeframe === tf
                ? 'bg-[#2563eb] text-white font-semibold shadow-sm'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-800/60'
            }`}
          >
            {tf}
          </button>
        ))}
      </div>

      {/* Right: Proximity Banner, Alerts Button, Sound, Hotkeys, + Add Widget Dropdown */}
      <div className="flex items-center space-x-1 shrink-0">
        {activeProximityAlert && (
          <div className="hidden 2xl:flex items-center space-x-1 px-1.5 py-0.5 rounded bg-[#ffb30018] border border-[#ffb30060] text-[#ffb300] text-[10px] font-mono animate-pulse">
            <AlertTriangle size={11} />
            <span>
              {activeProximityAlert.symbol}: ${activeProximityAlert.price} ({activeProximityAlert.distPct.toFixed(2)}%)
            </span>
          </div>
        )}

        {/* Quick Price Alert Trigger Button */}
        <button
          type="button"
          data-testid="alerts-toolbar-button"
          onClick={() => useAlertsStore.getState().openAlertsModal({ symbol })}
          className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800/60 transition cursor-pointer"
          title="Ценовые алерты (Shift+A)"
        >
          <Bell size={13} />
        </button>
        {activeAiModel && <span title={activeAiModel} className="px-1.5 py-0.5 rounded border border-[#818cf860] bg-[#1e1b4b] text-[#a5b4fc] text-[10px] font-mono truncate max-w-36">AI: {activeAiModel.split('/').pop().replace(':free', '')}{activeAiModel.endsWith(':free') ? ' [FREE]' : ''}</span>}

        <button
          onClick={onToggleSound}
          className={`p-1 rounded transition ${
            isMuted ? 'text-[#ef5350] hover:bg-[#ef535018]' : 'text-[#26a69a] hover:bg-[#26a69a18]'
          }`}
          title={isMuted ? 'Звук отключен' : 'Звуковые алерты активны'}
        >
          {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </button>

        <button
          onClick={onToggleHotkeyHelp}
          className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800/60 transition"
          title="Горячие клавиши ('?')"
        >
          <Keyboard size={13} />
        </button>

        {/* "+ Add Widget" Institutional Dropdown Menu */}
        <div className="relative">
          <button
            data-testid="widgets-menu-button"
            onClick={onToggleAddWidgetDropdown}
            className="px-2 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1.5 border transition cursor-pointer bg-[#0e1217] text-neutral-200 border-neutral-700/60 hover:bg-neutral-800 hover:text-white hover:border-neutral-600"
            title="Добавить модуль в рабочую область (+ Add Widget)"
          >
            <Plus size={11} className="text-blue-400" />
            <span className="font-medium">+ Add Widget</span>
            <ChevronDown size={10} className="text-neutral-400" />
          </button>

          {isAddWidgetDropdownOpen && (
            <>
              {/* Backdrop closer */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => onToggleAddWidgetDropdown(false)}
              />

              <div
                data-testid="widgets-dropdown"
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 top-7 z-50 w-56 rounded-lg border border-neutral-800 bg-[#0b0e11] shadow-2xl p-1.5 space-y-0.5 font-sans text-xs animate-fadeIn text-[#d1d5db]"
              >
                <div className="px-2 py-1 text-[9px] font-mono font-bold uppercase tracking-wider text-neutral-400 border-b border-neutral-800/80 mb-1">
                  Modules & Widgets
                </div>

                {[
                  { id: 'chart', label: 'Chart (График)', hint: 'Shift+C', icon: LineChart },
                  { id: 'tpo', label: 'TPO / Footprint', hint: 'Shift+P', icon: Layers },
                  { id: 'orderbook', label: 'Order Book (Стакан)', hint: 'Shift+O', icon: BookOpen },
                  { id: 'dom', label: 'DOM Ladder', hint: 'Shift+D', icon: Activity },
                  { id: 'trades', label: 'Trades (Лента)', hint: 'Shift+T', icon: Zap },
                  { id: 'screener', label: 'Screener (Скринер)', hint: 'Shift+S', icon: BarChart2 },
                  { id: 'alerts', label: 'Alerts (Алерты)', hint: 'Shift+A', icon: Bell }
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-testid={`widget-toggle-${item.id}`}
                      onClick={() => {
                        if (item.id === 'alerts') {
                          useAlertsStore.getState().openAlertsModal({ symbol });
                        } else {
                          onAddWidget(item.id);
                        }
                        onToggleAddWidgetDropdown(false);
                      }}
                      className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-neutral-800/80 hover:text-white transition cursor-pointer text-left group"
                    >
                      <span className="flex items-center space-x-2 text-[11px] text-neutral-300 group-hover:text-white">
                        <Icon size={12} className="text-neutral-400 group-hover:text-blue-400" />
                        <span>{item.label}</span>
                      </span>
                      <span className="text-[9.5px] font-mono text-neutral-400 group-hover:text-neutral-300">
                        {item.hint}
                      </span>
                    </button>
                  );
                })}

                <div className="pt-1 border-t border-neutral-800/80 mt-1">
                  <button
                    type="button"
                    onClick={() => {
                      useLayoutStore.getState().openWidgetHub();
                      onToggleAddWidgetDropdown(false);
                    }}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-neutral-800/80 hover:text-white text-[10.5px] font-mono text-blue-400 transition cursor-pointer"
                  >
                    <span>Каталог виджетов...</span>
                    <ExternalLink size={10} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Workspace Toggle: Dual-Pane 50/50 */}
        <button
          onClick={onToggleDualPane}
          className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition ${
            isDualPane
              ? 'bg-[#141720] text-[#38bdf8] border-[#38bdf840]'
              : 'text-[#60697b] border-transparent hover:bg-[#141720]'
          }`}
          title="Переключить 1 / 2 графика 50/50 (Клавиша 'D')"
        >
          <Columns size={11} />
          <span>{isDualPane ? '2 Граф [D]' : '1 Граф [D]'}</span>
        </button>

        {/* Clean Focus / Zen Mode Toggle */}
        <button
          onClick={onToggleFocusMode}
          className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition ${
            isFocusMode
              ? 'bg-[#052e16] text-[#4ade80] border-[#22c55e60] font-bold'
              : 'text-[#60697b] border-transparent hover:bg-[#141720] hover:text-white'
          }`}
          title="Фокус на графике (100% экран без лишних панелей, Клавиша 'F')"
        >
          {isFocusMode ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
          <span>{isFocusMode ? 'Выйти [F]' : 'Фокус [F]'}</span>
        </button>

        {/* AI Copilot Sidebar Toggle */}
        <button
          data-testid="btn-toggle-ai-copilot"
          onClick={onToggleAICopilot}
          className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition cursor-pointer ${
            showAICopilot
              ? 'bg-[#1e1b4b] text-[#818cf8] border-[#818cf860] font-bold'
              : 'text-[#60697b] border-transparent hover:bg-[#141720] hover:text-[#818cf8]'
          }`}
          title="AI Торговый Ассистент & Order Flow (Клавиша 'A')"
        >
          <Sparkles size={11} className={showAICopilot ? 'animate-pulse text-[#818cf8]' : ''} />
          <span>AI Ассистент [A]</span>
        </button>

        {/* Decision Journal Modal Toggle (Stage 1) */}
        <button
          data-testid="btn-open-decision-journal"
          onClick={onOpenDecisionJournal}
          className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition cursor-pointer ${
            showDecisionJournal
              ? 'bg-[#0f292a] text-[#2dd4bf] border-[#2dd4bf60] font-bold'
              : 'text-[#2dd4bf] border-[#2dd4bf40] bg-[#101c22] hover:bg-[#162932]'
          }`}
          title="Журнал решений, сигналов и второго мнения AI (SQLite + CSV экспорт)"
        >
          <span>📓</span>
          <span>Журнал [J]</span>
        </button>

        {/* Replay lake player toggle (задача 2.5) */}
        <button
          data-testid="btn-open-replay"
          onClick={onOpenReplay}
          className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition ${
            showReplay
              ? 'bg-[#141720] text-[#38bdf8] border-[#38bdf840]'
              : 'text-[#60697b] border-transparent hover:bg-[#141720]'
          }`}
          title="Replay-плеер записанного lake: Play/Pause/Step/скорость (тики и стакан из recorder'а)"
        >
          <span>⏯</span>
          <span>Replay</span>
        </button>

        {/* Backtest drawer toggle */}
        <button
          data-testid="btn-toggle-backtest-drawer"
          onClick={onToggleBacktest}
          className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition ${
            showBacktest
              ? 'bg-[#141720] text-[#a78bfa] border-[#a78bfa40]'
              : 'text-[#60697b] border-transparent hover:bg-[#141720]'
          }`}
          title="Бэктест и Grid Search (Клавиша 'B')"
        >
          <BarChart3 size={11} />
          <span>Бэктест [B]</span>
        </button>

        {/* Panel Toggle: DOM OrderBook */}
        <button
          onClick={onToggleOrderBook}
          className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition ${
            showOrderBook
              ? 'bg-[#141720] text-[#38bdf8] border-[#38bdf840]'
              : 'text-[#60697b] border-transparent hover:bg-[#141720]'
          }`}
          title="Переключить скальперский DOM стакан (Клавиша 'O')"
        >
          <Layers size={11} />
          <span>DOM [O]</span>
        </button>

        {/* Panel Toggle: Tape */}
        <button
          onClick={onToggleTape}
          className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition ${
            showTape
              ? 'bg-[#141720] text-[#f59e0b] border-[#f59e0b40]'
              : 'text-[#60697b] border-transparent hover:bg-[#141720]'
          }`}
          title="Переключить ленту сделок Time & Sales (Клавиша 'T')"
        >
          <Zap size={11} />
          <span>Лента [T]</span>
        </button>

        {/* Panel Toggle: Signals */}
        <button
          onClick={onToggleSignals}
          className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition ${
            showSignals
              ? 'bg-[#141720] text-[#26a69a] border-[#26a69a40]'
              : 'text-[#60697b] border-transparent hover:bg-[#141720]'
          }`}
          title="Переключить сигналы (Клавиша 'S')"
        >
          <Radio size={11} />
          <span>Сигн [S]</span>
        </button>

        {/* Spot Limit Walls & Liq Heatmap Layers Toggle */}
        <button
          data-testid="btn-toggle-liq-layers"
          onClick={onToggleLiqLayers}
          className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition cursor-pointer ${
            showLiqLayers
              ? 'bg-[#1e1b4b] text-[#c084fc] border-[#c084fc60] font-bold'
              : 'text-[#60697b] border-transparent hover:bg-[#141720] hover:text-[#c084fc]'
          }`}
          title="Слои спотовых стен и тепловой карты ликвидаций (Клавиша 'L')"
        >
          <Layers size={11} className={showLiqLayers ? 'text-[#c084fc]' : ''} />
          <span>Слои стен [L]</span>
        </button>

        {/* Liquidation Analytics & Quarantine Drawer Toggle */}
        <button
          data-testid="btn-toggle-liq-panel"
          onClick={onToggleLiqPanel}
          className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition cursor-pointer ${
            showLiqPanel
              ? 'bg-[#3b0764] text-[#e879f9] border-[#e879f960] font-bold'
              : 'text-[#60697b] border-transparent hover:bg-[#141720] hover:text-[#e879f9]'
          }`}
          title="Панель ликвидаций и фиксация в Shadow Quarantine (Клавиша 'Q')"
        >
          <Target size={11} className={showLiqPanel ? 'animate-pulse text-[#e879f9]' : ''} />
          <span>Карантин [Q]</span>
        </button>

        {/* Collapse/Expand entire right dock */}
        <button
          onClick={onToggleRightPanels}
          className="p-1 rounded text-[#787f91] hover:text-white hover:bg-[#161820] transition"
          title={anyRightPanelOpen ? 'Свернуть боковой док (отдать 100% экрану графикам)' : 'Развернуть боковой док'}
        >
          {anyRightPanelOpen ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
        </button>

        {/* Theme Switcher Button (Tealstreet Pro / Tiger Deep Dark / Bloomberg) */}
        <button
          onClick={onCycleTheme}
          className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition ${
            theme === 'bloomberg'
              ? 'bg-[#ff9800] text-black font-bold border-[#ff9800]'
              : theme === 'tiger'
              ? 'bg-[#0a192f] text-[#00f5d4] font-bold border-[#00e5ff60]'
              : 'text-[#787f91] border-[#1f2430] hover:text-white bg-[#101217]'
          }`}
          title="Переключить цветовую тему (Tealstreet Pro / Tiger Deep Dark / Bloomberg)"
        >
          <span>{THEME_BADGE[theme] || '🌙 TEAL'}</span>
        </button>

        {/* Settings Modal (Gear Icon & ',' hotkey) */}
        <button
          onClick={onOpenSettings}
          className="p-1 rounded text-[#787f91] hover:text-[#38bdf8] hover:bg-[#161820] transition"
          title="Центр настроек терминала (Клавиша ',')"
        >
          <Settings size={13} />
        </button>
      </div>
    </header>
  );
}
