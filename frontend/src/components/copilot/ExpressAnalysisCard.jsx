import React from 'react';
import { Zap, RefreshCw } from 'lucide-react';

// Кнопка «⚡ Анализ рынка прямо сейчас» — экспресс-анализ рынка в сайдбаре AI Copilot.

export default function ExpressAnalysisCard({ selectedModel, loadingAnalysis, onRun }) {
  return (
    <div className="p-2.5 rounded-lg border border-[#38bdf835] bg-gradient-to-br from-[#0c1829] to-[#0d1017] shadow-md">
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-semibold text-white text-[11px] flex items-center space-x-1">
          <Zap size={13} className="text-[#38bdf8]" />
          <span>Экспресс-анализ рынка</span>
        </span>
        <span className="text-[9px] text-[#787f91] font-mono truncate max-w-[180px]">
          {selectedModel}
        </span>
      </div>
      <button
        data-testid="btn-run-market-analysis"
        onClick={onRun}
        disabled={loadingAnalysis}
        className="w-full py-1.5 px-3 rounded bg-gradient-to-r from-[#2563eb] to-[#0284c7] hover:from-[#1d4ed8] hover:to-[#0369a1] text-white font-semibold text-[11px] flex items-center justify-center space-x-1.5 transition shadow disabled:opacity-50 cursor-pointer"
      >
        {loadingAnalysis ? (
          <>
            <RefreshCw size={13} className="animate-spin" />
            <span>Сканирование кластеров и стакана...</span>
          </>
        ) : (
          <>
            <Zap size={13} />
            <span>⚡ Анализ рынка прямо сейчас</span>
          </>
        )}
      </button>
    </div>
  );
}
