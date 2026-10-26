import React from 'react';
import { Scale, AlertCircle } from 'lucide-react';

// Stage 3.1: Математическое ожидание (Expected Value) — карточка сайдбара AI Copilot.

export default function ExpectedValueCard({ expectedValue }) {
  return (
    <div
      data-testid="ai-expected-value-card"
      className="p-2.5 rounded-lg border border-[#10b98140] bg-[#091515] space-y-2 font-mono text-[10px]"
    >
      <div className="flex items-center justify-between">
        <span className="font-bold text-white text-[10.5px] flex items-center space-x-1">
          <Scale size={13} className="text-[#10b981]" />
          <span>Математическое ожидание (EV)</span>
        </span>
        <span
          data-testid="ai-ev-verdict"
          className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold ${
            expectedValue.is_positive_expectancy
              ? 'bg-[#10b98125] text-[#10b981] border border-[#10b98150]'
              : 'bg-[#ef444425] text-[#ef4444] border border-[#ef444450]'
          }`}
        >
          {expectedValue.verdict}
        </span>
      </div>

      <div className="flex items-baseline justify-between bg-[#040c0c] p-2 rounded border border-[#132a28]">
        <span className="text-[#94a3b8] text-[9.5px]">Мат. ожидание на сделку:</span>
        <div className="flex items-baseline space-x-1.5">
          <span
            data-testid="ai-ev-value"
            className={`text-[14px] font-extrabold ${
              expectedValue.ev_per_trade_usd >= 0 ? 'text-[#10b981]' : 'text-[#ef4444]'
            }`}
          >
            {expectedValue.ev_per_trade_usd >= 0 ? '+' : ''}
            ${expectedValue.ev_per_trade_usd}
          </span>
          <span className="text-[#38bdf8] font-bold text-[11px]">
            ({expectedValue.ev_r_multiple})
          </span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1 text-[9px] text-center">
        <div className="p-1 rounded bg-[#0b1b1a]">
          <div className="text-[#64748b]">WinRate</div>
          <div className="font-bold text-[#10b981]">{expectedValue.p_win_pct}%</div>
        </div>
        <div className="p-1 rounded bg-[#0b1b1a]">
          <div className="text-[#64748b]">Ср. Win</div>
          <div className="font-bold text-[#34d399]">+${expectedValue.avg_win_usd}</div>
        </div>
        <div className="p-1 rounded bg-[#0b1b1a]">
          <div className="text-[#64748b]">Ср. Loss</div>
          <div className="font-bold text-[#ef4444]">-${expectedValue.avg_loss_usd}</div>
        </div>
        <div className="p-1 rounded bg-[#0b1b1a]">
          <div className="text-[#64748b]">Комис+Слип</div>
          <div className="font-bold text-[#f59e0b]">-${expectedValue.avg_fees_and_slippage_usd}</div>
        </div>
      </div>

      {/* Confidence warning if sample size is underpowered (<30 trades) */}
      {expectedValue.sample_trades_tested < 30 ? (
        <div
          data-testid="ai-ev-sample-warning"
          className="p-1.5 rounded bg-[#f59e0b15] border border-[#f59e0b40] text-[#fbbf24] text-[9.5px] flex items-center space-x-1.5 leading-snug"
        >
          <AlertCircle size={12} className="shrink-0 text-[#fbbf24]" />
          <span>⚠️ Выборка: {expectedValue.sample_trades_tested} сделок (мало данных, доверительный интервал широкий)</span>
        </div>
      ) : (
        <div className="text-[8.5px] text-[#64748b] text-right">
          ✓ Выборка: {expectedValue.sample_trades_tested} сделок (статистически достоверно)
        </div>
      )}
    </div>
  );
}
