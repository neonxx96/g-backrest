import React from 'react';

const fmtUsd = (val) => {
  const num = Number(val);
  if (!Number.isFinite(num)) return '$0.00';
  return `${num < 0 ? '-' : ''}$${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/**
 * PaperTradePanel: Virtual balance & shadow-trading statistics widget.
 * Shows: balance, realized/unrealized PnL, open positions, active orders.
 */
export default function PaperTradePanel({ sessionState, onClose = null }) {
  if (!sessionState) return null;

  const {
    session_id,
    initial_balance,
    realized_pnl,
    unrealized_pnl,
    balance,
    available_margin,
    locked_margin,
    positions = [],
    active_orders = [],
  } = sessionState;

  const pnlColor = realized_pnl >= 0 ? 'text-bull' : 'text-bear';
  const unPnlColor = unrealized_pnl >= 0 ? 'text-bull' : 'text-bear';

  return (
    <div
      data-testid="paper-trade-panel"
      className="bg-[#131722] rounded-lg shadow-xl border border-[#2a3a50] p-3 w-full text-foreground text-[11px] font-sans select-none"
    >
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse"></span>
          <span className="font-bold text-[#8ab4f8] text-[11px] uppercase tracking-wide">Paper Trading</span>
          <span className="px-1 rounded bg-[#1e2a3a] text-[#8ab4f8] text-[9px] border border-[#8ab4f8]/30">SHADOW</span>
        </div>
        {onClose && (
          <button
            data-testid="paper-panel-close"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close paper trading panel"
          >
            ✕
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5 mb-2">
        <div className="bg-[#1a2233] rounded p-1.5 border border-[#2a3a50]">
          <div className="text-muted-foreground text-[9px]">BALANCE</div>
          <div className="font-bold text-[13px]">{fmtUsd(balance)}</div>
        </div>
        <div className="bg-[#1a2233] rounded p-1.5 border border-[#2a3a50]">
          <div className="text-muted-foreground text-[9px]">REALIZED PnL</div>
          <div className={`font-bold text-[13px] ${pnlColor}`}>{fmtUsd(realized_pnl)}</div>
        </div>
        <div className="bg-[#1a2233] rounded p-1.5 border border-[#2a3a50]">
          <div className="text-muted-foreground text-[9px]">UNREALIZED PnL</div>
          <div className={`font-bold text-[13px] ${unPnlColor}`}>{fmtUsd(unrealized_pnl)}</div>
        </div>
        <div className="bg-[#1a2233] rounded p-1.5 border border-[#2a3a50]">
          <div className="text-muted-foreground text-[9px]">AVAILABLE MARGIN</div>
          <div className="font-bold text-[13px] text-[#38bdf8]">{fmtUsd(available_margin)}</div>
        </div>
      </div>

      {positions.length > 0 && (
        <div className="border-t border-[#2a3a50] pt-1.5 mt-1.5">
          <div className="text-muted-foreground text-[9px] mb-1 uppercase tracking-wide">OPEN POSITIONS</div>
          {positions.map((pos) => (
            <div
              key={`${pos.symbol}-${pos.side}`}
              data-testid="paper-position-row"
              className="flex justify-between items-center py-0.5"
            >
              <span>
                <span className={pos.side === 'LONG' ? 'text-bull' : 'text-bear'}>
                  {pos.side}
                </span>{' '}
                <span className="text-foreground/80">{pos.symbol}</span>
                <span className="text-muted-foreground ml-1">{Number(pos.qty).toFixed(4)}</span>
              </span>
              <span className={pos.unrealized_pnl >= 0 ? 'text-bull' : 'text-bear'}>
                {fmtUsd(pos.unrealized_pnl)}
              </span>
            </div>
          ))}
        </div>
      )}

      {active_orders.length > 0 && (
        <div className="border-t border-[#2a3a50] pt-1.5 mt-1.5">
          <div className="text-muted-foreground text-[9px] mb-1 uppercase tracking-wide">ACTIVE ORDERS</div>
          {active_orders.map((ord) => (
            <div
              key={ord.order_id}
              data-testid="paper-order-row"
              className="flex justify-between items-center py-0.5 text-foreground/80"
            >
              <span>
                <span className={ord.side === 'BUY' ? 'text-bull' : 'text-bear'}>{ord.side}</span>{' '}
                {Number(ord.quantity).toFixed(4)} @ {Number(ord.price).toFixed(2)}
              </span>
              <span className="text-muted-foreground text-[9px]">
                {ord.status} · queue {Number(ord.queue_ahead).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="text-muted-foreground text-[8px] mt-2 text-right">session: {session_id}</div>
    </div>
  );
}
