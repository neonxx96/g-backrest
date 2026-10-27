import React from 'react';

// Backtest marker & trade tooltip: detailed financial metrics.
// Извлечено ДОСЛОВНО из Chart.jsx (слайс 6.4o, п.1 MODULARIZATION_PLAN):
// JSX и все вычисления тултипа перенесены без изменений.
// Пропсы: btTooltip (state из Chart.jsx), chartContainerRef (ref).

export default function BtTooltipOverlay({ btTooltip, chartContainerRef }) {
  return (
    <>
      {/* Backtest marker & trade tooltip: detailed financial metrics */}
      {btTooltip && (
        <div
          className="absolute z-30 pointer-events-none px-2.5 py-1.5 rounded border text-[10px] font-mono bg-[#0c1017f0] backdrop-blur-md shadow-2xl min-w-[190px]"
          style={{
            left: Math.min(btTooltip.x + 12, (chartContainerRef.current?.clientWidth || 600) - 210),
            top: Math.max(btTooltip.y - 70, 8),
            borderColor: (btTooltip.isTrade ? (btTooltip.trade.pnl_usd >= 0) : ((btTooltip.sig?.pnl_pct ?? 0) >= 0)) ? '#10b981' : '#ef4444'
          }}
        >
          {btTooltip.isTrade ? (
            <>
              <div className="flex items-center justify-between border-b border-[#1f293d] pb-1 mb-1">
                <span className={btTooltip.trade.direction === 'LONG' || btTooltip.trade.type === 'BUY' ? 'text-[#34d399] font-bold' : 'text-[#f87171] font-bold'}>
                  {btTooltip.source === 'paper' ? 'PAPER' : 'BACKTEST'} · #{btTooltip.trade.id} · {btTooltip.trade.direction || btTooltip.trade.type}
                </span>
                <span className="text-[#94a3b8] text-[9px]">{btTooltip.trade.regime || 'Regime: No data'}</span>
              </div>
              <div className="text-[#cbd5e1] text-[9.5px] leading-tight">
                <div>Вход: <span className="text-foreground">${btTooltip.trade.entry_price}</span> → Выход: <span className="text-foreground">${btTooltip.trade.exit_price}</span></div>
                <div>Entry: <span className="text-foreground">{Array.isArray(btTooltip.trade.entry_reason || btTooltip.trade.reason) ? (btTooltip.trade.entry_reason || btTooltip.trade.reason).join(' · ') : (btTooltip.trade.entry_reason || btTooltip.trade.reason || 'No data')}</span></div>
                <div>Exit: <span className="text-foreground">{btTooltip.trade.exit_reason || 'No data'}</span></div>
              </div>
              <div className={`font-bold mt-1 text-[11px] ${(btTooltip.trade.pnl_usd ?? 0) >= 0 ? 'text-[#34d399]' : 'text-[#f87171]'}`}>
                Чистый PnL: {(btTooltip.trade.pnl_usd ?? 0) >= 0 ? '+' : ''}${btTooltip.trade.pnl_usd} ({(btTooltip.trade.pnl_pct ?? 0) >= 0 ? '+' : ''}{btTooltip.trade.pnl_pct}%)
              </div>
              <div className="text-[8.5px] text-[#64748b] mt-0.5 flex justify-between">
                <span>Gross: {btTooltip.trade.gross_pnl_usd ?? 'No data'}</span>
                <span>Комиссия: -${Number(btTooltip.trade.fee_paid_usd || 0).toFixed(2)}</span>
                <span>Слиппейдж: -${Number(btTooltip.trade.slippage_cost_usd || 0).toFixed(2)}</span>
              </div>
              <div className="text-[8.5px] text-[#94a3b8] mt-0.5 flex justify-between">
                <span>MFE: +{Number(btTooltip.trade.mfe || 0).toFixed(2)}%</span>
                <span>MAE: {Number(btTooltip.trade.mae || 0).toFixed(2)}%</span>
                <span>Fee Drag: {btTooltip.trade.fee_drag_pct != null ? `${Number(btTooltip.trade.fee_drag_pct).toFixed(2)}%` : 'No data'}</span>
              </div>
            </>
          ) : (
            <>
              <div className={btTooltip.sig.type === 'BUY' ? 'text-[#26a69a] font-bold' : 'text-[#ef5350] font-bold'}>
                {btTooltip.sig.label} @ {btTooltip.sig.price}
              </div>
              <div className="text-[#d1d4dc]">Причина: {btTooltip.sig.reason || '—'}</div>
              <div className={(btTooltip.sig.pnl_pct ?? 0) >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}>
                PnL: {(btTooltip.sig.pnl_pct ?? 0) >= 0 ? '+' : ''}{btTooltip.sig.pnl_pct}% (${btTooltip.sig.pnl_usd})
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
