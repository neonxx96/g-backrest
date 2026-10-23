import React from 'react';
import { Dna } from 'lucide-react';

// Презентационный (управляемый) компонент результатов генетического оптимизатора и матрицы
// конфлюенса — вынесен из BacktestPanel.jsx (модульный план, п.2). Рендерит тело вкладок
// 'optimizer' (До/После + OOS + лидерборд) и 'matrix' (таблица связок факторов);
// хендлеры applySetup/applyConfluenceSetup (store + сеттеры) остаются в панели.
// Все data-testid и поведение 1:1.

export default function BacktestOptimizerView({
  viewTab,
  beforeOpt,
  afterOpt,
  oosOpt,
  gridRows,
  confluenceMatrix,
  onApplySetup,
  onApplyConfluenceSetup
}) {
  return (
    <>
      {viewTab === 'optimizer' && (
        <div className="p-2 space-y-2">
          {/* Cards: До оптимизации vs После оптимизации */}
          {beforeOpt && afterOpt && (
            <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
              <div
                data-testid="card-before-opt"
                className="border border-[#1f2430] rounded bg-[#0c0f17] p-2 space-y-1"
              >
                <div className="flex items-center justify-between border-b border-[#191f2e] pb-1">
                  <span className="text-[#94a3b8] font-bold uppercase text-[9px]">
                    До оптимизации (Базовый сетап)
                  </span>
                  <span className="text-[#64748b] text-[9px]">
                    SL {beforeOpt.stop_loss_pct}% • TP {beforeOpt.take_profit_pct}% • Стенка $
                    {Math.round(beforeOpt.min_density_usd / 1000)}k
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1 pt-0.5">
                  <div>
                    <div className="text-[8.5px] text-[#64748b]">Чистый PnL</div>
                    <div
                      className={`font-bold ${
                        beforeOpt.total_pnl_pct >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'
                      }`}
                    >
                      {beforeOpt.total_pnl_pct >= 0 ? '+' : ''}
                      {beforeOpt.total_pnl_pct}%
                    </div>
                  </div>
                  <div>
                    <div className="text-[8.5px] text-[#64748b]">WinRate</div>
                    <div className="text-white font-bold">{beforeOpt.win_rate_pct}%</div>
                  </div>
                  <div>
                    <div className="text-[8.5px] text-[#64748b]">Sharpe / PF</div>
                    <div className="text-white font-bold">
                      {beforeOpt.sharpe_ratio} / {beforeOpt.profit_factor}
                    </div>
                  </div>
                  <div>
                    <div className="text-[8.5px] text-[#64748b]">Max DD</div>
                    <div className="text-[#ef5350] font-bold">-{beforeOpt.max_drawdown_pct}%</div>
                  </div>
                </div>
              </div>

              <div
                data-testid="card-after-opt"
                className="border border-neutral-700 rounded bg-neutral-950/80 p-2 space-y-1"
              >
                <div className="flex items-center justify-between border-b border-neutral-800 pb-1">
                  <span className="text-neutral-200 font-bold uppercase text-[9px] flex items-center gap-1">
                    <Dna size={11} className="text-neutral-400" />
                    После генетической оптимизации
                  </span>
                  <button
                    data-testid="btn-apply-best-setup"
                    onClick={() => onApplySetup(afterOpt)}
                    className="px-2 py-0.5 rounded bg-neutral-200 hover:bg-white text-neutral-950 font-bold text-[9px] transition cursor-pointer"
                  >
                    Применить лучший
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-1 pt-0.5">
                  <div>
                    <div className="text-[8.5px] text-neutral-400">Чистый PnL</div>
                    <div
                      className={`font-bold ${
                        afterOpt.total_pnl_pct >= 0 ? 'text-[#4ade80]' : 'text-[#ef5350]'
                      }`}
                    >
                      {afterOpt.total_pnl_pct >= 0 ? '+' : ''}
                      {afterOpt.total_pnl_pct}%
                    </div>
                  </div>
                  <div>
                    <div className="text-[8.5px] text-neutral-400">WinRate</div>
                    <div className="text-white font-bold">{afterOpt.win_rate_pct}%</div>
                  </div>
                  <div>
                    <div className="text-[8.5px] text-neutral-400">Sharpe / Sortino</div>
                    <div className="text-neutral-200 font-bold">
                      {afterOpt.sharpe_ratio} / {afterOpt.sortino_ratio ?? 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-[8.5px] text-neutral-400">Max DD</div>
                    <div className="text-[#fbbf24] font-bold">-{afterOpt.max_drawdown_pct}%</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {oosOpt && (
            <div
              data-testid="card-oos-validation"
              className={`rounded border p-2 font-mono text-[10px] ${oosOpt.available ? 'border-cyan-900/60 bg-cyan-950/10' : 'border-amber-900/60 bg-amber-950/10'}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold uppercase text-[9px] text-cyan-300">Проверка OOS · данные после периода подбора</span>
                <span className={oosOpt.available ? 'text-cyan-200' : 'text-amber-300'}>
                  {oosOpt.available ? 'НЕ ИСПОЛЬЗОВАЛАСЬ В ОПТИМИЗАЦИИ' : 'НЕДОСТАТОЧНО ДАННЫХ'}
                </span>
              </div>
              {oosOpt.available && oosOpt.metrics ? (
                <div className="mt-1 grid grid-cols-5 gap-2 text-neutral-300">
                  <span>Свечи <b className="text-white">{oosOpt.oos_candles}</b></span>
                  <span>PnL <b className={oosOpt.metrics.total_pnl_pct >= 0 ? 'text-emerald-300' : 'text-red-300'}>{oosOpt.metrics.total_pnl_pct}%</b></span>
                  <span>WinRate <b className="text-white">{oosOpt.metrics.win_rate_pct}%</b></span>
                  <span>PF <b className="text-white">{oosOpt.metrics.profit_factor}</b></span>
                  <span>Trades <b className="text-white">{oosOpt.metrics.total_trades}</b></span>
                </div>
              ) : (
                <div className="mt-1 text-amber-200">{oosOpt.warning || 'OOS-проверка недоступна.'}</div>
              )}
            </div>
          )}

          {/* Genetic Leaderboard Table */}
          {gridRows.length > 0 && (
            <table className="w-full text-[10px] font-mono-numbers">
              <thead
                className="sticky top-0 bg-neutral-950 text-neutral-400 text-[8.5px] uppercase border-b border-neutral-800"
              >
                <tr>
                  <th className="text-left px-2 py-1">#</th>
                  <th className="text-right px-2">SL %</th>
                  <th className="text-right px-2">TP %</th>
                  <th className="text-right px-2">Wall $</th>
                  <th className="text-center px-2">CVD / ATR</th>
                  <th className="text-right px-2">WinRate</th>
                  <th className="text-right px-2">Чистый PnL</th>
                  <th className="text-right px-2">Max DD</th>
                  <th className="text-right px-2">Sharpe</th>
                  <th className="text-center px-2">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900">
                {gridRows.slice(0, 15).map((row) => (
                  <tr
                    key={row.rank}
                    className={`hover:bg-neutral-900/60 ${row.rank === 1 ? 'bg-neutral-800/30' : ''}`}
                  >
                    <td className="px-2 py-1 font-bold text-neutral-300">#{row.rank}</td>
                    <td className="px-2 text-right text-white font-mono">{row.stop_loss_pct}%</td>
                    <td className="px-2 text-right text-[#cbd5e1] font-mono">{row.take_profit_pct}%</td>
                    <td className="px-2 text-right text-[#ffb300] font-mono">
                      ${(row.min_density_usd / 1000).toFixed(0)}k
                    </td>
                    <td className="px-2 text-center text-[#94a3b8] font-mono">
                      {row.use_cvd_filter ? 'CVD:ON' : 'CVD:OFF'} • ATR({row.atr_period || 14})
                    </td>
                    <td className="px-2 text-right text-[#d1d4dc] font-mono">{row.win_rate_pct}%</td>
                    <td
                      className={`px-2 text-right font-bold font-mono ${
                        row.total_pnl_pct >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'
                      }`}
                    >
                      {row.total_pnl_pct >= 0 ? '+' : ''}
                      {row.total_pnl_pct}%
                    </td>
                    <td className="px-2 text-right text-[#ef5350] font-mono">-{row.max_drawdown_pct}%</td>
                    <td className="px-2 text-right font-bold text-neutral-200 font-mono">
                      {row.sharpe_ratio}
                    </td>
                    <td className="px-2 text-center">
                      <button
                        onClick={() => onApplySetup(row)}
                        className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 font-bold text-[9px] transition cursor-pointer"
                      >
                        Применить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {viewTab === 'matrix' && (
        <table className="w-full text-[10px] font-mono-numbers">
          <thead
            style={{ backgroundColor: 'var(--bg-panel)' }}
            className="sticky top-0 text-[#60697b] text-[8.5px] uppercase z-10"
          >
            <tr>
              <th className="text-left px-2 py-1">Условие / Связка факторов</th>
              <th className="text-right px-2">Сделок</th>
              <th className="text-right px-2">WinRate</th>
              <th className="text-right px-2">PF</th>
              <th className="text-right px-2">Ср. PnL</th>
              <th className="text-center px-2">Действие</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#13161f]">
            {confluenceMatrix.map((item, idx) => (
              <tr key={idx} className="hover:bg-[#161922]">
                <td className="px-2 py-1 font-bold text-white truncate max-w-[260px]">
                  {item.condition_name}
                </td>
                <td className="px-2 text-right text-[#cbd5e1]">{item.total_trades}</td>
                <td className="px-2 text-right font-bold text-[#26a69a]">{item.win_rate_pct}%</td>
                <td className="px-2 text-right text-white">{item.profit_factor}</td>
                <td className="px-2 text-right text-[#38bdf8]">{item.avg_pnl_pct}%</td>
                <td className="px-2 text-center">
                  <button
                    onClick={() => onApplyConfluenceSetup(item)}
                    className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 font-bold text-[9px] transition cursor-pointer"
                  >
                    Включить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
