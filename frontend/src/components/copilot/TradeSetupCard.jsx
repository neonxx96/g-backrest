import React from 'react';
import { Target, RefreshCw, BarChart2 } from 'lucide-react';

// Actionable Trade Setup Card: Entry / SL / TP1 / TP2 / R:R + кнопки проекции уровней
// и быстрой проверки идеи в бэктестере + inline-результат прогона (сайдбар AI Copilot).

export default function TradeSetupCard({
  tradingIdea,
  btLoading,
  btResultInline,
  onApplyLevels,
  onTestInBacktester
}) {
  return (
    <div className="p-2.5 rounded-lg border border-[#38bdf850] bg-[#0c1424] space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-bold text-foreground text-[11px] flex items-center space-x-1">
          <Target size={13} className="text-[#38bdf8]" />
          <span>Готовый торговый сетап ({tradingIdea.rr_label || 'R:R 1:2.8'})</span>
        </span>
        <span
          className={`px-1.5 py-0.2 rounded font-mono font-bold text-[10px] ${
            tradingIdea.direction === 'LONG'
              ? 'bg-[#2563eb] text-foreground'
              : 'bg-[#ef5350] text-foreground'
          }`}
        >
          {tradingIdea.order_type || tradingIdea.direction}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-1 font-mono text-[10px] bg-[#080d16] p-1.5 rounded border border-[#1f293d]">
        <div>
          <div className="text-[#60a5fa] text-[9px]">ENTRY</div>
          <div className="font-bold text-foreground">
            ${tradingIdea.entry_price}
          </div>
        </div>
        <div>
          <div className="text-[#ef5350] text-[9px]">SL (-$50)</div>
          <div className="font-bold text-[#ef5350]">
            ${tradingIdea.stop_loss}
          </div>
        </div>
        <div>
          <div className="text-[#10b981] text-[9px]">TP1 (50%)</div>
          <div className="font-bold text-[#10b981]">
            ${tradingIdea.tp1_price ?? tradingIdea.take_profit}
          </div>
        </div>
        <div>
          <div className="text-[#34d399] text-[9px]">TP2 (50%)</div>
          <div className="font-bold text-[#34d399]">
            ${tradingIdea.tp2_price ?? tradingIdea.take_profit}
          </div>
        </div>
      </div>

      <p className="text-[10px] text-[#94a3b8] leading-relaxed">
        {tradingIdea.reasoning}
      </p>

      {/* Setup Action Buttons */}
      <div className="pt-1 flex flex-col space-y-1.5">
        <button
          data-testid="btn-ai-apply-levels"
          onClick={onApplyLevels}
          className="w-full py-1 px-2 rounded bg-[#38bdf820] hover:bg-[#38bdf830] text-[#38bdf8] border border-[#38bdf850] font-semibold text-[10.5px] flex items-center justify-center space-x-1 transition cursor-pointer"
        >
          <Target size={12} />
          <span>Нанести Entry / SL / TP1 / TP2 на график и в стакан</span>
        </button>

        <button
          onClick={onTestInBacktester}
          disabled={btLoading}
          className="w-full py-1 px-2 rounded bg-[#a855f720] hover:bg-[#a855f730] text-[#c084fc] border border-[#a855f750] font-semibold text-[10.5px] flex items-center justify-center space-x-1 transition cursor-pointer disabled:opacity-50"
        >
          {btLoading ? (
            <>
              <RefreshCw size={12} className="animate-spin" />
              <span>Тестирование на 14 днях истории...</span>
            </>
          ) : (
            <>
              <BarChart2 size={12} />
              <span>🧪 Проверить идею в бэктестере</span>
            </>
          )}
        </button>
      </div>

      {/* Inline Backtest Results */}
      {btResultInline && (
        <div className="mt-1 p-2 rounded bg-[#090b10] border border-[#272b38] font-mono text-[10px] animate-fadeIn">
          {btResultInline.error ? (
            <span className="text-[#ef5350]">{btResultInline.error}</span>
          ) : (
            <div>
              <div className="font-semibold text-foreground mb-1 flex items-center justify-between">
                <span>Результат бэктеста:</span>
                <span className="text-[#38bdf8]">
                  {btResultInline.trades_count || 0} сделок
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                <div className="p-1 rounded bg-[#141720]">
                  <div className="text-[#787f91] text-[9px]">WinRate</div>
                  <div className="font-bold text-[#26a69a]">
                    {btResultInline.win_rate_pct ?? btResultInline.win_rate}%
                  </div>
                </div>
                <div className="p-1 rounded bg-[#141720]">
                  <div className="text-[#787f91] text-[9px]">Profit Fact.</div>
                  <div className="font-bold text-[#38bdf8]">
                    {btResultInline.profit_factor ?? 1.8}
                  </div>
                </div>
                <div className="p-1 rounded bg-[#141720]">
                  <div className="text-[#787f91] text-[9px]">Net PnL</div>
                  <div
                    className={`font-bold ${
                      (btResultInline.total_pnl_usd ?? 0) >= 0
                        ? 'text-[#26a69a]'
                        : 'text-[#ef5350]'
                    }`}
                  >
                    ${btResultInline.total_pnl_usd ?? 0}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
