import React, { useState } from 'react';
import { AlertTriangle, TrendingUp, TrendingDown, Layers, ShieldCheck, RefreshCw } from 'lucide-react';

/**
 * LiqAnalyticsPanel Component (Ref 3 + Live Socket Data)
 * Connected directly to FreeBinanceSelfCollector & MarketDataProvider
 */
export default function LiqAnalyticsPanel({
  symbol = 'BTCUSDT',
  currentPrice = 82000,
  liqData = null,
  depthData = null,
  isLoading = false,
  onRefresh,
}) {
  const [selectedSide, setSelectedSide] = useState('ALL'); // 'ALL' | 'SHORTS' | 'LONGS'

  const shorts = liqData?.shorts_above || [];
  const longs = liqData?.longs_below || [];
  const biggestShort = liqData?.biggest_short;
  const biggestLong = liqData?.biggest_long;

  // Format currency helpers
  const formatUSD = (val) => {
    if (!val) return '$0.00';
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
    return `$${(val / 1_000).toFixed(1)}K`;
  };

  return (
    <div
      className="flex flex-col h-full w-full select-none overflow-y-auto"
      style={{
        backgroundColor: 'var(--panel)',
        color: 'var(--text-1)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Header bar */}
      <div
        className="px-3 py-2 border-b flex items-center justify-between shrink-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <Layers size={14} style={{ color: 'var(--accent)' }} />
          <span className="font-semibold text-xs tracking-wide">
            {symbol} Liquidation Analytics
          </span>
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-mono border"
            style={{
              backgroundColor: 'rgba(70, 201, 154, 0.12)',
              color: 'var(--up)',
              borderColor: 'rgba(70, 201, 154, 0.3)',
            }}
            title="Real calculation from Spot depth + Futures volume & swing pivots"
          >
            ESTIMATED (MODEL)
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="p-1 rounded text-xs transition cursor-pointer hover:bg-[var(--raised)]"
              style={{ color: 'var(--text-2)' }}
              title="Обновить аналитику"
            >
              <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
            </button>
          )}

          {['ALL', 'SHORTS', 'LONGS'].map((side) => (
            <button
              key={side}
              type="button"
              onClick={() => setSelectedSide(side)}
              className="px-2 py-0.5 rounded text-[10px] font-mono transition cursor-pointer border"
              style={{
                backgroundColor: selectedSide === side ? 'var(--raised)' : 'transparent',
                color: selectedSide === side ? 'var(--accent)' : 'var(--text-2)',
                borderColor: selectedSide === side ? 'var(--border)' : 'transparent',
              }}
            >
              {side}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3 flex flex-col gap-3">
        {/* Top Summary Cards (Reference 3) */}
        <div className="grid grid-cols-2 gap-2">
          {/* Biggest Short Level Card */}
          <div
            className="p-2.5 rounded border flex flex-col justify-between"
            style={{ backgroundColor: 'var(--raised)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-2)' }}>
              <span>Biggest Short Level</span>
              <span className="font-mono text-[10px]" style={{ color: 'var(--up)' }}>
                {biggestShort?.pct_from_price ? `+${biggestShort.pct_from_price}%` : '+0.0%'}
              </span>
            </div>
            <div className="my-1">
              <span className="text-base font-bold font-mono" style={{ color: 'var(--text-1)' }}>
                {biggestShort ? biggestShort.amount_str : '$0.00'}
              </span>
              <span className="text-[11px] ml-1 font-mono" style={{ color: 'var(--text-2)' }}>
                @ {biggestShort ? `$${biggestShort.price.toLocaleString()}` : '0'}
              </span>
            </div>
            <div className="flex items-center gap-1 text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>
              <span>leverage: {biggestShort?.leverage || 'N/A'}</span>
              <span className="ml-auto font-semibold" style={{ color: 'var(--warn)' }}>MAGNET</span>
            </div>
          </div>

          {/* Biggest Long Level Card */}
          <div
            className="p-2.5 rounded border flex flex-col justify-between"
            style={{ backgroundColor: 'var(--raised)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-2)' }}>
              <span>Biggest Long Level</span>
              <span className="font-mono text-[10px]" style={{ color: 'var(--down)' }}>
                {biggestLong?.pct_from_price ? `${biggestLong.pct_from_price}%` : '-0.0%'}
              </span>
            </div>
            <div className="my-1">
              <span className="text-base font-bold font-mono" style={{ color: 'var(--text-1)' }}>
                {biggestLong ? biggestLong.amount_str : '$0.00'}
              </span>
              <span className="text-[11px] ml-1 font-mono" style={{ color: 'var(--text-2)' }}>
                @ {biggestLong ? `$${biggestLong.price.toLocaleString()}` : '0'}
              </span>
            </div>
            <div className="flex items-center gap-1 text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>
              <span>leverage: {biggestLong?.leverage || 'N/A'}</span>
              <span className="ml-auto font-semibold" style={{ color: 'var(--warn)' }}>MAGNET</span>
            </div>
          </div>
        </div>

        {/* Warning Badge & Disclaimer */}
        <div
          className="p-2 rounded border flex items-start gap-2 text-[11px]"
          style={{
            backgroundColor: 'rgba(185, 164, 109, 0.08)',
            borderColor: 'rgba(185, 164, 109, 0.25)',
            color: 'var(--text-2)',
          }}
        >
          <AlertTriangle size={14} className="shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium" style={{ color: 'var(--warn)' }}>
              Estimates, not orders on the book (расчёт по модели, не факт)
            </span>
            <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
              Провайдер: {liqData?.provider || 'FreeBinanceSelfCollector'}. Пул каскадных ликвидаций рассчитывается от экстремумов объема и открытого интереса.
            </span>
          </div>
        </div>

        {/* 24h Summary metrics row */}
        <div
          className="grid grid-cols-3 gap-2 p-2 rounded border font-mono text-[11px]"
          style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
        >
          <div>
            <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>Shorts Above</div>
            <div className="font-semibold mt-0.5" style={{ color: 'var(--up)' }}>
              {formatUSD(liqData?.shorts_above_usd)}
            </div>
          </div>
          <div>
            <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>Longs Below</div>
            <div className="font-semibold mt-0.5" style={{ color: 'var(--down)' }}>
              {formatUSD(liqData?.longs_below_usd)}
            </div>
          </div>
          <div>
            <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>Spot Delta (2.5%)</div>
            <div
              className="font-semibold mt-0.5"
              style={{
                color: (depthData?.depth_deltas?.['2.5%']?.delta_pct || 0) >= 0 ? 'var(--up)' : 'var(--down)',
              }}
            >
              {depthData?.depth_deltas?.['2.5%']?.delta_pct !== undefined
                ? `${depthData.depth_deltas['2.5%'].delta_pct > 0 ? '+' : ''}${depthData.depth_deltas['2.5%'].delta_pct}%`
                : '0.0%'}
            </div>
          </div>
        </div>

        {/* Tables Container (SHORTS ABOVE / LONGS BELOW) */}
        <div className="flex flex-col gap-3">
          {/* Shorts Above Section */}
          {(selectedSide === 'ALL' || selectedSide === 'SHORTS') && (
            <div className="flex flex-col">
              <div
                className="py-1 px-1 flex items-center justify-between text-[11px] font-semibold border-b"
                style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
              >
                <div className="flex items-center gap-1.5">
                  <TrendingUp size={12} style={{ color: 'var(--up)' }} />
                  <span>SHORTS ABOVE</span>
                </div>
                <span className="text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>
                  EST. LIQ POOL
                </span>
              </div>

              <div className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
                {shorts.length === 0 ? (
                  <div className="py-2 text-center text-xs text-[var(--text-3)] font-mono">
                    Нет активных пулов в диапазоне
                  </div>
                ) : (
                  shorts.map((row, idx) => (
                    <div
                      key={idx}
                      className="py-1.5 px-1 flex items-center justify-between text-[11px] font-mono hover:bg-[var(--raised)] transition"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-bold" style={{ color: 'var(--text-1)' }}>
                          ${row.price.toLocaleString()}
                        </span>
                        <span className="text-[10px]" style={{ color: 'var(--up)' }}>
                          +{row.pct_from_price}%
                        </span>
                        <span className="text-[9px] px-1 rounded bg-[var(--raised)] text-[var(--text-3)]">
                          {row.leverage}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Visual intensity bar */}
                        <div
                          className="w-16 h-1.5 rounded-full bg-[var(--border)] overflow-hidden"
                          title={`Intensity: ${Math.round(row.intensity * 100)}%`}
                        >
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${row.intensity * 100}%`,
                              backgroundColor: row.is_max ? 'var(--liq-primary, #ffd84a)' : 'var(--up)',
                            }}
                          />
                        </div>
                        <span
                          className="font-bold text-right w-16"
                          style={{ color: row.is_max ? 'var(--liq-primary, #ffd84a)' : 'var(--text-1)' }}
                        >
                          {row.amount_str}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Current Price Anchor */}
          <div
            className="py-1.5 px-2 rounded flex items-center justify-between font-mono text-[11px] border"
            style={{
              backgroundColor: 'var(--raised)',
              borderColor: 'var(--border)',
            }}
          >
            <span style={{ color: 'var(--text-2)' }}>Current Price (Spot/Fut)</span>
            <span className="font-bold" style={{ color: 'var(--accent)' }}>
              ${currentPrice ? currentPrice.toLocaleString() : '---'}
            </span>
          </div>

          {/* Longs Below Section */}
          {(selectedSide === 'ALL' || selectedSide === 'LONGS') && (
            <div className="flex flex-col">
              <div
                className="py-1 px-1 flex items-center justify-between text-[11px] font-semibold border-b"
                style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
              >
                <div className="flex items-center gap-1.5">
                  <TrendingDown size={12} style={{ color: 'var(--down)' }} />
                  <span>LONGS BELOW</span>
                </div>
                <span className="text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>
                  EST. LIQ POOL
                </span>
              </div>

              <div className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
                {longs.length === 0 ? (
                  <div className="py-2 text-center text-xs text-[var(--text-3)] font-mono">
                    Нет активных пулов в диапазоне
                  </div>
                ) : (
                  longs.map((row, idx) => (
                    <div
                      key={idx}
                      className="py-1.5 px-1 flex items-center justify-between text-[11px] font-mono hover:bg-[var(--raised)] transition"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-bold" style={{ color: 'var(--text-1)' }}>
                          ${row.price.toLocaleString()}
                        </span>
                        <span className="text-[10px]" style={{ color: 'var(--down)' }}>
                          {row.pct_from_price}%
                        </span>
                        <span className="text-[9px] px-1 rounded bg-[var(--raised)] text-[var(--text-3)]">
                          {row.leverage}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <div
                          className="w-16 h-1.5 rounded-full bg-[var(--border)] overflow-hidden"
                          title={`Intensity: ${Math.round(row.intensity * 100)}%`}
                        >
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${row.intensity * 100}%`,
                              backgroundColor: row.is_max ? 'var(--liq-primary, #ffd84a)' : 'var(--down)',
                            }}
                          />
                        </div>
                        <span
                          className="font-bold text-right w-16"
                          style={{ color: row.is_max ? 'var(--liq-primary, #ffd84a)' : 'var(--text-1)' }}
                        >
                          {row.amount_str}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
