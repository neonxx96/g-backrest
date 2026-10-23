import React from 'react';
import { X, AlertTriangle } from 'lucide-react';

// Market Regime: Toxic Volatility Warning Overlay.
// Извлечено ДОСЛОВНО из Chart.jsx (слайс 6.4o, п.1 MODULARIZATION_PLAN):
// JSX и текст предупреждения перенесены без изменений.
// Пропсы: isToxicRegime/isToxicDismissed (state из useChartAnnotations),
// onDismiss — setIsToxicDismissed из Chart.jsx.

export default function ToxicVolatilityOverlay({ isToxicRegime, isToxicDismissed, onDismiss }) {
  return (
    <>
      {/* Market Regime: Toxic Volatility Warning Overlay */}
      {isToxicRegime && !isToxicDismissed && (
        <div
          data-testid="toxic-volatility-overlay"
          className="absolute inset-x-4 top-3 z-30 flex items-center justify-between p-3 rounded-lg bg-rose-950/85 border border-rose-500/50 backdrop-blur-xs text-rose-200 shadow-2xl animate-pulse select-none font-mono"
        >
          <div className="flex items-center space-x-2.5">
            <AlertTriangle className="text-rose-400 shrink-0" size={18} />
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-rose-300">
                Рыночный режим изменен: Токсичная ликвидность. Торги приостановлены
              </div>
              <div className="text-[10px] text-rose-200/80">
                Высокая волатильность при разреженном стакане (ATR% &gt; 1.8%, плотность &lt; 0.6). Входы в сделки заблокированы ядром.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onDismiss(true)}
            className="p-1 rounded hover:bg-rose-900/60 text-rose-300 hover:text-white transition cursor-pointer"
            title="Скрыть предупреждение"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}
