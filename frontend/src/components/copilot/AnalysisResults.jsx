import React from 'react';
import TradeSetupCard from './TradeSetupCard';
import ExpectedValueCard from './ExpectedValueCard';
import LiquidityMagnetCard from './LiquidityMagnetCard';
import VolatilityConeCard from './VolatilityConeCard';

// Результаты экспресс-анализа рынка в сайдбаре AI Copilot (MODULARIZATION_PLAN п.7):
// бейдж фазы рынка + торговый сетап (Entry/SL/TP1/TP2, inline-бэктест) + карточки
// EV, Liquidity Magnet и конуса волатильности. Управляемый контейнер — вся логика
// (projectAnalysisLevels, backtest-раннер, toggleVolatilityCone) осталась в AICopilotSidebar.

export default function AnalysisResults({
  analysis,
  btLoading,
  btResultInline,
  coneProjected,
  onApplyLevels,
  onTestInBacktester,
  onToggleCone
}) {
  return (
    <div className="space-y-2.5 animate-fadeIn">
      {/* Phase Badge */}
      <div className="p-2 rounded bg-[#10141d] border border-[#1f2430] flex items-center justify-between">
        <span className="text-[#787f91] text-[10.5px]">Фаза рынка:</span>
        <span
          className={`px-2 py-0.5 rounded text-[10.5px] font-bold uppercase tracking-wider ${
            analysis.bias === 'BULLISH'
              ? 'bg-[#26a69a25] text-[#26a69a] border border-[#26a69a50]'
              : analysis.bias === 'BEARISH'
              ? 'bg-[#ef535025] text-[#ef5350] border border-[#ef535050]'
              : 'bg-[#ffb30025] text-[#ffb300] border border-[#ffb30050]'
          }`}
        >
          {analysis.market_phase}
        </span>
      </div>

      {analysis.trading_idea && (
        <TradeSetupCard
          tradingIdea={analysis.trading_idea}
          btLoading={btLoading}
          btResultInline={btResultInline}
          onApplyLevels={onApplyLevels}
          onTestInBacktester={onTestInBacktester}
        />
      )}

      {analysis.expected_value && <ExpectedValueCard expectedValue={analysis.expected_value} />}

      {analysis.liquidity_magnet && <LiquidityMagnetCard liquidityMagnet={analysis.liquidity_magnet} />}

      {analysis.expected_move_cone && (
        <VolatilityConeCard
          expectedMoveCone={analysis.expected_move_cone}
          coneProjected={coneProjected}
          onToggleCone={onToggleCone}
        />
      )}
    </div>
  );
}
