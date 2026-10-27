import { ArrowUp, ArrowDown } from 'lucide-react';

import { fmtTime, fmtPrice } from './format';

/**
 * Таблица сделок бэктеста с сортируемыми колонками.
 *
 * Извлечена из BacktestPanel.jsx (MODULARIZATION_PLAN, пункт 2) как управляемый компонент:
 * состояние сортировки и выбора живёт в панели, здесь — только рендер и колбэки.
 */
export default function BacktestTradesTable({ trades, sortField, sortAsc, onSort, selectedId, onSelect }) {
  const sortIcon = (field) =>
    sortField === field && (sortAsc ? <ArrowUp size={8} /> : <ArrowDown size={8} />);

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-[10px] font-mono-numbers">
        <thead
          style={{ backgroundColor: 'var(--bg-panel)' }}
          className="sticky top-0 text-[#60697b] text-[8.5px] uppercase select-none z-10"
        >
          <tr>
            <th onClick={() => onSort('id')} className="text-left px-2 py-1 cursor-pointer hover:text-foreground">
              <span className="flex items-center gap-0.5"># {sortIcon('id')}</span>
            </th>
            <th onClick={() => onSort('type')} className="text-left px-2 cursor-pointer hover:text-foreground">
              <span className="flex items-center gap-0.5">Тип {sortIcon('type')}</span>
            </th>
            <th onClick={() => onSort('entry_time')} className="text-left px-2 cursor-pointer hover:text-foreground">
              <span className="flex items-center gap-0.5">Вход {sortIcon('entry_time')}</span>
            </th>
            <th onClick={() => onSort('entry_price')} className="text-right px-2 cursor-pointer hover:text-foreground">
              <span className="flex items-center justify-end gap-0.5">Цена вх. {sortIcon('entry_price')}</span>
            </th>
            <th onClick={() => onSort('exit_price')} className="text-right px-2 cursor-pointer hover:text-foreground">
              <span className="flex items-center justify-end gap-0.5">Цена вых. {sortIcon('exit_price')}</span>
            </th>
            <th onClick={() => onSort('gross_pnl_usd')} className="text-right px-2 cursor-pointer hover:text-foreground">
              <span className="flex items-center justify-end gap-0.5">Gross $ {sortIcon('gross_pnl_usd')}</span>
            </th>
            <th onClick={() => onSort('fee_paid_usd')} className="text-right px-2 cursor-pointer hover:text-foreground">
              <span className="flex items-center justify-end gap-0.5">Комиссия+Слип {sortIcon('fee_paid_usd')}</span>
            </th>
            <th onClick={() => onSort('pnl_usd')} className="text-right px-2 cursor-pointer hover:text-foreground">
              <span className="flex items-center justify-end gap-0.5">Чистый PnL {sortIcon('pnl_usd')}</span>
            </th>
            <th onClick={() => onSort('reason')} className="text-left px-2 cursor-pointer hover:text-foreground">
              <span className="flex items-center gap-0.5">Выход {sortIcon('reason')}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#13161f]">
          {trades.map((t) => (
            <tr key={t.id} data-testid="backtest-trade-row" onClick={() => onSelect(t)} className={`hover:bg-[#161922] transition-colors cursor-pointer ${String(selectedId) === String(t.id) ? 'bg-sky-500/10' : ''}`}>
              <td className="px-2 py-0.5 text-[#60697b]">{t.id}</td>
              <td
                className={`px-2 font-bold ${
                  t.type === 'BUY' ? 'text-[#26a69a]' : 'text-[#ef5350]'
                }`}
              >
                {t.type}
              </td>
              <td className="px-2 text-[#787f91]">{fmtTime(t.entry_time)}</td>
              <td className="px-2 text-right text-foreground">{fmtPrice(t.entry_price)}</td>
              <td className="px-2 text-right text-[#787f91]">{fmtPrice(t.exit_price)}</td>
              <td className="px-2 text-right text-[#cbd5e1]">
                ${(t.gross_pnl_usd ?? t.pnl_usd).toFixed(2)}
              </td>
              <td className="px-2 text-right text-[#ffb300]">
                -${((t.fee_paid_usd || 0) + (t.slippage_cost_usd || 0)).toFixed(2)}
              </td>
              <td
                className={`px-2 text-right font-bold ${
                  t.pnl_usd >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'
                }`}
              >
                {t.pnl_usd >= 0 ? '+' : ''}${t.pnl_usd} ({t.pnl_pct >= 0 ? '+' : ''}
                {t.pnl_pct}%)
              </td>
              <td className="px-2 text-[#94a3b8]">{t.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
