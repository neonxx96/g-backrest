import React from 'react';
import { Eye, EyeOff, Settings, X } from 'lucide-react';

/**
 * ChartLegend - Компактная легенда OHLC и TradingView-стек индикаторов в левом верхнем углу графика.
 * 
 * Особенности:
 * - Строка 1: O / H / L / C / Delta / Delta% / Vol моно-шрифтом (11px, tabular-nums).
 * - Строка 2+: Компактный список активных индикаторов с hover-действиями (глаз, шестеренка, удаление).
 * - Полупрозрачный фон с размытием, не перекрывает кнопки тулбара.
 */
export default function ChartLegend({
  symbol = 'BTCUSDT',
  timeframe = '5m',
  activeCandle = null,
  activeIndicators = [],
  onToggleVisibility = null,
  onOpenSettings = null,
  onRemove = null,
}) {
  if (!activeCandle) return null;

  const { open, high, low, close, volume } = activeCandle;
  const isUp = close >= open;
  const delta = close - open;
  const deltaPct = open !== 0 ? (delta / open) * 100 : 0;

  const fmtPrice = (val) => {
    if (val == null || !Number.isFinite(Number(val))) return '—';
    const num = Number(val);
    if (num >= 1000) return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (num >= 1) return num.toFixed(3);
    return num.toFixed(5);
  };

  const fmtVol = (val) => {
    if (val == null || !Number.isFinite(Number(val))) return '—';
    const num = Number(val);
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(1)}k`;
    return num.toFixed(1);
  };

  return (
    <div
      data-testid="chart-ohlc-legend"
      className="absolute top-2 left-3 z-10 pointer-events-none select-none flex flex-col gap-1 max-w-2xl font-mono text-[10.5px]"
    >
      {/* Row 1: OHLC + Change + Vol */}
      <div className="flex flex-wrap items-center gap-2 px-2 py-0.5 rounded bg-background/85 border border-border/50 backdrop-blur-xs shadow-xs text-foreground">
        <span className="font-bold tracking-wide text-primary">
          {symbol} · {timeframe}
        </span>
        <div className="flex items-center gap-1.5 tabular-nums text-muted-foreground">
          <span>O <span className="text-foreground">{fmtPrice(open)}</span></span>
          <span>H <span className="text-foreground">{fmtPrice(high)}</span></span>
          <span>L <span className="text-foreground">{fmtPrice(low)}</span></span>
          <span>C <span className={isUp ? 'text-bull font-semibold' : 'text-bear font-semibold'}>{fmtPrice(close)}</span></span>
        </div>
        <span className={`tabular-nums font-semibold ${isUp ? 'text-bull' : 'text-bear'}`}>
          {delta >= 0 ? '+' : ''}{fmtPrice(delta)} ({delta >= 0 ? '+' : ''}{deltaPct.toFixed(2)}%)
        </span>
        {volume != null && (
          <span className="text-muted-foreground tabular-nums">
            V <span className="text-foreground">{fmtVol(volume)}</span>
          </span>
        )}
      </div>

      {/* Row 2+: TradingView-style Stack of Active Indicators */}
      {activeIndicators.length > 0 && (
        <div className="flex flex-col gap-0.5 pl-1">
          {activeIndicators
            .filter((ind) => ind.enabled !== false)
            .slice(0, 5)
            .map((ind) => (
              <div
                key={ind.id}
                className="group inline-flex items-center gap-1.5 px-1.5 py-0.2 rounded hover:bg-muted/60 transition pointer-events-auto cursor-default text-[10px] text-muted-foreground"
              >
                <span className="font-semibold text-foreground/90">
                  {ind.name || ind.id.toUpperCase()}
                  {ind.params ? ` (${Object.values(ind.params).join(', ')})` : ''}
                </span>

                {/* Hover Action Buttons */}
                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 ml-1">
                  {onToggleVisibility && (
                    <button
                      type="button"
                      title={ind.visible === false ? 'Показать' : 'Скрыть'}
                      onClick={() => onToggleVisibility(ind.id)}
                      className="p-0.5 rounded hover:bg-background text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      {ind.visible === false ? <EyeOff size={10} /> : <Eye size={10} />}
                    </button>
                  )}
                  {onOpenSettings && (
                    <button
                      type="button"
                      title="Настройки индикатора"
                      onClick={() => onOpenSettings(ind.id)}
                      className="p-0.5 rounded hover:bg-background text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <Settings size={10} />
                    </button>
                  )}
                  {onRemove && (
                    <button
                      type="button"
                      title="Удалить индикатор"
                      onClick={() => onRemove(ind.id)}
                      className="p-0.5 rounded hover:bg-background text-muted-foreground hover:text-bear cursor-pointer"
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
