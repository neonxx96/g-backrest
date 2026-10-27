import React from 'react';
import { Trophy, RefreshCw } from 'lucide-react';

// M5.2 (task 6.2): Quant Sweep Leaderboard + кнопка «Apply Strategy #X».
// Управляемая карточка: все данные (sweepArtifact/sweepNote) и колбэки
// (onRunSweep/onRefresh/onApplyEntry) — из AICopilotSidebar.

export default function SweepLeaderboardCard({
  symbol,
  timeframe,
  sweepLoading,
  sweepRunning,
  sweepArtifact,
  sweepNote,
  onRunSweep,
  onRefresh,
  onApplyEntry
}) {
  return (
    <div
      data-testid="ai-sweep-leaderboard"
      className="p-2.5 rounded-lg border border-[#f59e0b30] bg-[#141007]/90 space-y-1.5"
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-foreground text-[11px] flex items-center space-x-1">
          <Trophy size={13} className="text-[#fbbf24]" />
          <span>Quant Sweep Leaderboard</span>
        </span>
        <div className="flex items-center space-x-1">
          <button
            type="button"
            data-testid="btn-run-sweep"
            onClick={onRunSweep}
            disabled={sweepRunning || sweepLoading}
            className="px-1.5 py-0.5 rounded bg-[#f59e0b20] hover:bg-[#f59e0b30] text-[#fbbf24] border border-[#f59e0b50] text-[9px] font-bold transition cursor-pointer disabled:opacity-50"
            title="Grid-оптимизация EMA Cross (Train/OOS, ~30 дней истории) для текущего инструмента"
          >
            {sweepRunning ? 'Sweep…' : '▶ Запустить sweep'}
          </button>
          <button
            type="button"
            data-testid="btn-refresh-sweep"
            onClick={onRefresh}
            disabled={sweepLoading || sweepRunning}
            className="p-1 rounded text-[#787f91] hover:text-foreground hover:bg-[#1f2430] transition cursor-pointer disabled:opacity-50"
            title="Обновить лидерборд"
          >
            <RefreshCw size={12} className={sweepLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="text-[9px] text-[#787f91] font-mono">
        {symbol} ({timeframe}) • Top-10 по OOS-скору • вердикт ROBUST/MODERATE/OVERFITTED из walk-forward
      </div>

      {sweepLoading ? (
        <div className="flex items-center space-x-1.5 text-[#787f91] text-[10px] py-1 font-mono">
          <RefreshCw size={11} className="animate-spin text-[#fbbf24]" />
          <span>Загрузка лидерборда…</span>
        </div>
      ) : !sweepArtifact ? (
        <div className="space-y-1">
          <div className="p-1.5 rounded bg-[#090c14] border border-[#191f2e] text-[10px] text-[#94a3b8] leading-snug">
            Прогонов sweep для <span className="text-foreground font-bold">{symbol} ({timeframe})</span> пока нет —
            лидерборд не синтезируется, пока не будет реального прогона. Нажмите «▶ Запустить sweep».
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          {(sweepArtifact.entries || []).slice(0, 10).map((entry) => (
            <div
              key={entry.rank}
              data-testid={`sweep-entry-${entry.rank}`}
              className="p-1.5 rounded bg-[#090c14] border border-[#191f2e] space-y-1"
            >
              <div className="flex items-center justify-between font-mono text-[10px]">
                <span className="text-foreground font-bold">
                  #{entry.rank} • EMA {entry.params?.fast_period ?? '?'}/{entry.params?.slow_period ?? '?'}
                </span>
                <span
                  className={`px-1.5 py-0.2 rounded text-[8.5px] font-bold ${
                    entry.verdict === 'ROBUST'
                      ? 'bg-[#10b98125] text-[#10b981] border border-[#10b98150]'
                      : entry.verdict === 'OVERFITTED'
                      ? 'bg-[#ef444425] text-[#ef4444] border border-[#ef444450]'
                      : 'bg-[#f59e0b25] text-[#fbbf24] border border-[#f59e0b50]'
                  }`}
                >
                  {entry.verdict || 'UNKNOWN'}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1 text-center text-[9px]">
                <div className="p-0.5 rounded bg-[#0d1119]">
                  <div className="text-[#64748b]">OOS Sharpe</div>
                  <div className="font-bold text-[#38bdf8]">{entry.oos_sharpe ?? '—'}</div>
                </div>
                <div className="p-0.5 rounded bg-[#0d1119]">
                  <div className="text-[#64748b]">WinRate</div>
                  <div className="font-bold text-[#10b981]">
                    {entry.oos_win_rate != null ? `${Math.round(entry.oos_win_rate * (entry.oos_win_rate <= 1 ? 100 : 1))}%` : '—'}
                  </div>
                </div>
                <div className="p-0.5 rounded bg-[#0d1119]">
                  <div className="text-[#64748b]">Max DD</div>
                  <div className="font-bold text-[#ef4444]">
                    {entry.oos_max_drawdown_pct != null ? `${entry.oos_max_drawdown_pct}%` : '—'}
                  </div>
                </div>
                <div className="p-0.5 rounded bg-[#0d1119]">
                  <div className="text-[#64748b]">Сделок</div>
                  <div className="font-bold text-foreground">{entry.oos_trade_count ?? '—'}</div>
                </div>
              </div>
              <button
                type="button"
                data-testid={`btn-apply-sweep-${entry.rank}`}
                onClick={() => onApplyEntry(entry)}
                disabled={sweepRunning}
                className="w-full py-0.5 px-2 rounded bg-[#f59e0b20] hover:bg-[#f59e0b30] text-[#fbbf24] border border-[#f59e0b50] font-semibold text-[9.5px] flex items-center justify-center space-x-1 transition cursor-pointer disabled:opacity-50"
              >
                <Trophy size={11} />
                <span>Apply Strategy #{entry.rank} → форма бэктеста</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {sweepNote && (
        <div className="p-1.5 rounded bg-[#090c14] border border-[#191f2e] text-[9.5px] text-[#94a3b8] leading-snug">
          {sweepNote}
        </div>
      )}

      <div className="text-[8.5px] text-[#64748b] leading-snug">
        Результат консультативный: кнопка применяет параметры только к форме бэктеста (EMA Trend), реальные ордера
        не создаются. Sweep оптимизирует чистый EMA Cross; перенос fast/slow в форму — ближайший честный аналог.
      </div>
    </div>
  );
}
