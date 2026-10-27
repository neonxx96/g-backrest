import React, { useState, useEffect, useRef } from 'react';
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
  Settings,
  MoreHorizontal,
  Pin
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from '@/components/ui/dropdown-menu';
import { useAlertsStore } from '../../stores/alertsStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { TIMEFRAMES, POPULAR_SYMBOLS, THEME_BADGE } from './constants';

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
  const headerRef = useRef(null);
  // 0: narrow (< 1440), 1: medium (1440-1720), 2: full (>= 1720)
  const [modeTier, setModeTier] = useState(() => {
    if (typeof window === 'undefined') return 2;
    return window.innerWidth >= 1720 ? 2 : window.innerWidth >= 1440 ? 1 : 0;
  });
  const tierRef = useRef(modeTier);
  tierRef.current = modeTier;

  const [pinnedWidgets, setPinnedWidgets] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('signalscript_topbar_pinned') || '[]');
      if (Array.isArray(saved) && saved.length > 0) return saved;
    } catch (_) {}
    return ['ai-copilot', 'journal', 'backtest', 'dom'];
  });

  const togglePin = (widgetId, e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    setPinnedWidgets((prev) => {
      const next = prev.includes(widgetId)
        ? prev.filter((id) => id !== widgetId)
        : [...prev, widgetId];
      localStorage.setItem('signalscript_topbar_pinned', JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    if (!headerRef.current) return;
    const HYSTERESIS = 24;
    let rafId = null;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (!entry.contentRect) continue;
        const w = entry.contentRect.width;
        const cur = tierRef.current;
        let next = cur;

        if (cur === 2 && w < 1720 - HYSTERESIS) {
          next = w < 1440 - HYSTERESIS ? 0 : 1;
        } else if (cur === 1) {
          if (w >= 1720 + HYSTERESIS) next = 2;
          else if (w < 1440 - HYSTERESIS) next = 0;
        } else if (cur === 0 && w >= 1440 + HYSTERESIS) {
          next = w >= 1720 + HYSTERESIS ? 2 : 1;
        }

        if (next !== cur) {
          tierRef.current = next;
          if (rafId) cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(() => setModeTier(next));
        }
      }
    });
    observer.observe(headerRef.current);
    return () => {
      observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  // Priority-ordered mode buttons
  // 1: Widgets, 2: Focus, 3: AI Copilot, 4: Journal, 5: Backtest, 6: DOM, 7: Tape, 8: Signals, 9: DualPane, 10: Replay, 11: LiqLayers, 12: LiqPanel
  const allModes = [
    {
      id: 'focus',
      label: isFocusMode ? 'Выйти [F]' : 'Фокус [F]',
      title: "Фокус на графике (100% экран, Клавиша 'F')",
      icon: isFocusMode ? Minimize2 : Maximize2,
      active: isFocusMode,
      onClick: onToggleFocusMode,
      priority: 9,
      activeClass: 'bg-bull-soft/70 text-bull border-emerald-500/50 font-bold',
    },
    {
      id: 'ai-copilot',
      label: 'AI Ассистент [A]',
      title: "AI Торговый Ассистент & Order Flow (Клавиша 'A')",
      icon: Sparkles,
      active: showAICopilot,
      onClick: onToggleAICopilot,
      testId: 'btn-toggle-ai-copilot',
      priority: 8,
      activeClass: 'bg-primary/20 text-primary border-primary/50 font-bold',
    },
    {
      id: 'journal',
      label: 'Журнал [J]',
      title: "Журнал решений, сигналов и второго мнения AI (SQLite + CSV экспорт)",
      icon: BookOpen,
      active: showDecisionJournal,
      onClick: onOpenDecisionJournal,
      testId: 'btn-open-decision-journal',
      priority: 7,
      activeClass: 'bg-teal-950/70 text-teal-300 border-teal-500/50 font-bold',
    },
    {
      id: 'backtest',
      label: 'Бэктест [B]',
      title: "Бэктест и Grid Search (Клавиша 'B')",
      icon: BarChart3,
      active: showBacktest,
      onClick: onToggleBacktest,
      testId: 'btn-toggle-backtest-drawer',
      priority: 6,
      activeClass: 'bg-primary/20 text-primary border-primary/50 font-medium',
    },
    {
      id: 'dom',
      label: 'DOM [O]',
      title: "Переключить скальперский DOM стакан (Клавиша 'O')",
      icon: Layers,
      active: showOrderBook,
      onClick: onToggleOrderBook,
      priority: 5,
      activeClass: 'bg-primary/20 text-primary border-primary/50 font-medium',
    },
    {
      id: 'tape',
      label: 'Лента [T]',
      title: "Переключить ленту сделок Time & Sales (Клавиша 'T')",
      icon: Zap,
      active: showTape,
      onClick: onToggleTape,
      priority: 4,
      activeClass: 'bg-primary/20 text-primary border-primary/50 font-medium',
    },
    {
      id: 'signals',
      label: 'Сигн [S]',
      title: "Переключить сигналы (Клавиша 'S')",
      icon: Radio,
      active: showSignals,
      onClick: onToggleSignals,
      priority: 3,
      activeClass: 'bg-primary/20 text-primary border-primary/50 font-medium',
    },
    {
      id: 'dual-pane',
      label: isDualPane ? '2 Граф [D]' : '1 Граф [D]',
      title: "Переключить 1 / 2 графика 50/50 (Клавиша 'D')",
      icon: Columns,
      active: isDualPane,
      onClick: onToggleDualPane,
      priority: 2,
      activeClass: 'bg-primary/20 text-primary border-primary/50 font-medium',
    },
    {
      id: 'replay',
      label: 'Реплей',
      title: "Replay-плеер записанного lake: Play/Pause/Step/скорость",
      icon: Activity,
      active: showReplay,
      onClick: onOpenReplay,
      testId: 'btn-open-replay',
      priority: 2,
      activeClass: 'bg-primary/20 text-primary border-primary/50 font-medium',
    },
    {
      id: 'liq-layers',
      label: 'Слои стен [L]',
      title: "Слои спотовых стен и тепловой карты ликвидаций (Клавиша 'L')",
      icon: Layers,
      active: showLiqLayers,
      onClick: onToggleLiqLayers,
      testId: 'btn-toggle-liq-layers',
      priority: 1,
      activeClass: 'bg-primary/20 text-primary border-primary/50 font-bold',
    },
    {
      id: 'liq-panel',
      label: 'Карантин [Q]',
      title: "Панель ликвидаций и фиксация в Shadow Quarantine (Клавиша 'Q')",
      icon: Target,
      active: showLiqPanel,
      onClick: onToggleLiqPanel,
      testId: 'btn-toggle-liq-panel',
      priority: 1,
      activeClass: 'bg-primary/20 text-primary border-primary/50 font-bold',
    },
  ];

  // Pinned favorites + responsive visibility
  // When modeTier === 0 (< 1440px), keep 2 pinned favorites (e.g. AI + Journal) so it fits 1280-1366px effortlessly!
  const effectivePinned = modeTier === 0 ? pinnedWidgets.slice(0, 2) : pinnedWidgets;
  const visibleModes = allModes.filter(m => {
    if (m.id === 'focus') return true;
    if (effectivePinned.includes(m.id)) return true;
    if (modeTier === 2 && m.priority >= 3) return true;
    if (modeTier === 1 && m.priority >= 5) return true;
    return false;
  });
  const overflowModes = allModes.filter(m => !visibleModes.some(v => v.id === m.id));
  const hasActiveOverflow = overflowModes.some(m => m.active);

  return (
    <header
      ref={headerRef}
      className="flex items-center justify-between px-2.5 h-[32px] border-b border-border/70 bg-card/95 z-20 text-xs gap-1.5 min-w-0 shrink-0 text-foreground overflow-hidden"
    >
      {/* Left: Brand, Active Coin, Watchlist pills, Denomination switch */}
      <div className="flex items-center space-x-1.5 min-w-0 shrink-0">
        <div className="flex items-center space-x-1 font-bold text-foreground tracking-wider text-[11px] shrink-0">
          <TrendingUp size={13} className="text-primary" />
          <span>
            Signal<span className="text-primary">Script</span>
          </span>
        </div>

        <div className="h-3 w-px bg-border/60 mx-0.5 shrink-0" />

        {/* Active Symbol & Search */}
        <div className="flex items-center space-x-1 font-mono min-w-0">
          <span className="text-[11px] font-bold text-foreground bg-muted/60 px-1.5 py-0.5 rounded border border-border/80 shrink-0">
            {symbol}
          </span>

          <form onSubmit={onSearchSubmit} className="relative shrink-0">
            <input
              type="text"
              placeholder="Поиск..."
              value={searchInput}
              onChange={(e) => onSearchInputChange(e.target.value)}
              className="w-16 xl:w-20 focus:w-24 transition-all duration-150 bg-background border border-border rounded px-1.5 py-0.5 text-[10px] text-foreground placeholder-muted-foreground outline-none font-mono focus:border-primary"
            />
            <Search size={10} className="absolute right-1.5 top-1.5 text-muted-foreground pointer-events-none" />
          </form>

          {/* Quick Watchlist pills (hidden on compact screens via CSS to prevent remounting) */}
          <div className="hidden min-[1480px]:flex items-center space-x-0.5 pl-0.5">
              {POPULAR_SYMBOLS.map((sym) => (
                <button
                  key={sym}
                  type="button"
                  onClick={() => onSymbolChange(sym)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition cursor-pointer ${
                    symbol === sym
                      ? 'bg-primary text-primary-foreground font-bold shadow-xs'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {sym.replace('USDT', '')}
                </button>
              ))}
          </div>
        </div>

        <div className="hidden min-[1440px]:block h-3 w-px bg-border/60 mx-0.5 shrink-0" />

        {/* Asset Denomination Toggle: COIN / USDT / USDC */}
        <div className="hidden min-[1440px]:flex items-center bg-background rounded p-0.5 border border-border text-[9.5px] font-mono shrink-0">
          {['COIN', 'USDT', 'USDC'].map((d) => (
            <button
              key={d}
              type="button"
              data-testid={`denomination-${d}`}
              onClick={() => onDenomination(d)}
              className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                denomination === d
                  ? 'bg-muted text-foreground font-bold shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Center: Sleek Institutional Timeframe Switcher */}
      <div className="flex items-center space-x-0.5 bg-background p-0.5 rounded border border-border font-mono shrink-0">
        <span className="hidden sm:inline text-[11px] text-muted-foreground px-1 font-semibold uppercase tracking-wider">TF:</span>
        {TIMEFRAMES.map((tf, idx) => (
          <button
            key={tf}
            type="button"
            data-testid={`timeframe-btn-${tf}`}
            onClick={() => onTimeframe(tf)}
            title={`Клавиша ${idx + 1}`}
            className={`px-1.5 py-0.5 rounded text-[10px] transition cursor-pointer ${
              timeframe === tf
                ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {tf}
          </button>
        ))}
      </div>

      {/* Center-Right Modes Group */}
      <div className="flex items-center space-x-1 shrink-0">
        {/* "+ Add Widget" Institutional Dropdown Menu */}
        <div className="relative">
          <button
            data-testid="widgets-menu-button"
            type="button"
            onClick={onToggleAddWidgetDropdown}
            className="px-2 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1.5 border transition cursor-pointer bg-background text-foreground border-border hover:bg-muted"
            title="Добавить модуль в рабочую область (каталог виджетов)"
          >
            <Plus size={11} className="text-primary" />
            <span className="font-medium">+ Виджеты</span>
            <ChevronDown size={10} className="text-muted-foreground" />
          </button>

          {isAddWidgetDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => onToggleAddWidgetDropdown(false)}
              />

              <div
                data-testid="widgets-dropdown"
                onClick={(e) => e.stopPropagation()}
                className="absolute left-0 top-7 z-50 w-56 rounded-md border border-border bg-popover shadow-xl p-1.5 space-y-0.5 font-sans text-xs animate-in fade-in zoom-in-95 text-popover-foreground"
              >
                <div className="px-2 py-1 text-[9px] font-mono font-bold uppercase tracking-wider text-muted-foreground border-b border-border/80 mb-1">
                  Модули и виджеты
                </div>

                {[
                  { id: 'chart', label: 'График (Chart)', hint: 'Shift+C', icon: LineChart },
                  { id: 'tpo', label: 'TPO / Footprint', hint: 'Shift+P', icon: Layers },
                  { id: 'orderbook', label: 'Стакан (Order Book)', hint: 'Shift+O', icon: BookOpen },
                  { id: 'dom', label: 'DOM Ladder', hint: 'Shift+D', icon: Activity },
                  { id: 'trades', label: 'Лента сделок (Trades)', hint: 'Shift+T', icon: Zap },
                  { id: 'screener', label: 'Скринер рынка (Screener)', hint: 'Shift+S', icon: BarChart2 },
                  { id: 'alerts', label: 'Алерты (Alerts)', hint: 'Shift+A', icon: Bell }
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
                      className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted text-foreground transition cursor-pointer text-left group"
                    >
                      <span className="flex items-center space-x-2 text-[11px]">
                        <Icon size={12} className="text-muted-foreground group-hover:text-primary" />
                        <span>{item.label}</span>
                      </span>
                      <span className="text-[9.5px] font-mono text-muted-foreground">
                        {item.hint}
                      </span>
                    </button>
                  );
                })}

                <div className="pt-1 border-t border-border mt-1">
                  <button
                    type="button"
                    onClick={() => {
                      useLayoutStore.getState().openWidgetHub();
                      onToggleAddWidgetDropdown(false);
                    }}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted text-[10.5px] font-mono text-primary transition cursor-pointer"
                  >
                    <span>Каталог виджетов...</span>
                    <ExternalLink size={10} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Visible Mode Buttons */}
        {visibleModes.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={item.testId}
              onClick={item.onClick}
              title={item.title}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition cursor-pointer shrink-0 ${
                item.active
                  ? item.activeClass
                  : 'text-muted-foreground border-transparent hover:bg-muted hover:text-foreground'
              }`}
            >
              <Icon size={11} className={item.id === 'ai-copilot' && item.active ? 'animate-pulse text-primary' : ''} />
              <span>{item.label}</span>
            </button>
          );
        })}

        {/* Overflow Dropdown: "Ещё ▾" when buttons do not fit */}
        {overflowModes.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="topbar-overflow-more"
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition cursor-pointer shrink-0 ${
                  hasActiveOverflow
                    ? 'bg-primary/20 text-primary border-primary/50 font-bold'
                    : 'text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                }`}
                title="Дополнительные режимы и панели"
              >
                <MoreHorizontal size={11} />
                <span>Ещё</span>
                {hasActiveOverflow && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
                <ChevronDown size={10} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 p-1 font-mono text-xs">
              <DropdownMenuLabel className="text-[11px] text-muted-foreground uppercase tracking-wider py-1">
                Режимы терминала
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {overflowModes.map((item) => {
                const Icon = item.icon;
                return (
                  <DropdownMenuItem
                    key={item.id}
                    data-testid={item.testId}
                    onClick={item.onClick}
                    className={`flex items-center justify-between text-[11px] py-1.5 cursor-pointer ${
                      item.active ? 'bg-primary/15 text-primary font-bold' : ''
                    }`}
                  >
                    <span className="flex items-center space-x-2">
                      <Icon size={12} className={item.active ? 'text-primary' : 'text-muted-foreground'} />
                      <span>{item.label}</span>
                    </span>
                    {item.active && (
                      <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Pinned Right Group: Always visible (shrink-0, ml-auto) */}
      <div className="ml-auto shrink-0 flex items-center space-x-1 pl-1">
        {activeProximityAlert && (
          <div className="hidden min-[1600px]:flex items-center space-x-1 px-1.5 py-0.5 rounded bg-warning/15 border border-warning/50 text-warning text-[10px] font-mono animate-pulse">

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
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
          title="Ценовые алерты (Shift+A)"
        >
          <Bell size={13} />
        </button>

        {activeAiModel && (
          <span
            title={activeAiModel}
            className="hidden min-[1500px]:inline-block px-1.5 py-0.5 rounded border border-primary/40 bg-primary/10 text-primary text-[10px] font-mono truncate max-w-32"
          >
            AI: {activeAiModel.split('/').pop().replace(':free', '')}
          </span>
        )}

        <button
          type="button"
          onClick={onToggleSound}
          className={`p-1 rounded transition cursor-pointer ${
            isMuted ? 'text-destructive hover:bg-destructive/15' : 'text-bull hover:bg-emerald-500/15'
          }`}
          title={isMuted ? 'Звук отключен' : 'Звуковые алерты активны'}
        >
          {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </button>

        <button
          type="button"
          onClick={onToggleHotkeyHelp}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
          title="Горячие клавиши ('?')"
        >
          <Keyboard size={13} />
        </button>

        {/* Collapse/Expand entire right dock */}
        <button
          type="button"
          onClick={onToggleRightPanels}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
          title={anyRightPanelOpen ? 'Свернуть боковой док (отдать 100% экрану графикам)' : 'Развернуть боковой док'}
        >
          {anyRightPanelOpen ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
        </button>

        {/* Theme Switcher Button */}
        <button
          type="button"
          onClick={onCycleTheme}
          className="px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border border-border bg-background text-foreground hover:bg-muted transition cursor-pointer shrink-0"
          title="Переключить цветовую тему"
        >
          <span>{THEME_BADGE[theme] || '🌙 TEAL'}</span>
        </button>

        {/* Settings Modal (Gear Icon) */}
        <button
          type="button"
          onClick={onOpenSettings}
          className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-muted transition cursor-pointer shrink-0"
          title="Центр настроек терминала (Клавиша ',')"
        >
          <Settings size={13} />
        </button>
      </div>
    </header>
  );
}
