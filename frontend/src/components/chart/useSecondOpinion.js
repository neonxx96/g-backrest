import { useState, useCallback } from 'react';
import { useTradeOverlayStore } from '../../stores/tradeOverlayStore';

// Stage 2: Consultative AI Second Opinion ("Второе мнение AI").
// Запрос консультативного вердикта AI по текущему сетапу (POST /api/journal/
// second-opinion) с честным fallback-вердиктом "AI НЕДОСТУПЕН" при ошибке,
// и фиксация решения трейдера по логу (PATCH /api/journal/log/:id).
// Извлечено ДОСЛОВНО из Chart.jsx (слайс 6.4n, п.1 MODULARIZATION_PLAN):
// state secondOpinionData/isAskingOpinion живёт здесь и возвращается в Chart.jsx.
// Депсы: symbol, timeframe, activePositionSetup, localPositionSetup,
// currentKlines (ref, из Chart.jsx).

export function useSecondOpinion({
  symbol, timeframe, activePositionSetup, localPositionSetup, currentKlines,
}) {
  const [secondOpinionData, setSecondOpinionData] = useState(null);
  const [isAskingOpinion, setIsAskingOpinion] = useState(false);

  const handleAskSecondOpinion = useCallback(async () => {
    setIsAskingOpinion(true);
    try {
      const transient = useTradeOverlayStore.getState().transientSetup;
      const setup = transient || activePositionSetup || localPositionSetup;
      const lastCandlePrice = currentKlines.current.length > 0
        ? currentKlines.current[currentKlines.current.length - 1].close
        : 0;
      const entryP = Number(setup?.entryPrice || setup?.entry_price || lastCandlePrice || 0);
      const slP = Number(setup?.slPrice || setup?.sl_price || 0) || null;
      const tpP = Number(setup?.tpPrice || setup?.tp1_price || setup?.tp_price || 0) || null;
      const dir = setup?.direction || (tpP && entryP && tpP < entryP ? 'SHORT' : 'LONG');
      const slPct = Number(setup?.slPct || setup?.sl_pct) ? Math.abs(Number(setup?.slPct || setup?.sl_pct)) : 0.6;
      const tpPct = Number(setup?.tpPct || setup?.tp1_pct) ? Math.abs(Number(setup?.tpPct || setup?.tp1_pct)) : 1.5;

      const res = await fetch('/api/journal/second-opinion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          timeframe,
          direction: dir,
          price: lastCandlePrice || entryP,
          entry_price: entryP || null,
          sl_price: slP,
          tp_price: tpP,
          stop_loss_pct: slPct,
          take_profit_pct: tpPct,
          strategy_type: 'density_bounce'
        })
      });
      if (res.ok) {
        const data = await res.json();
        setSecondOpinionData(data);
        window.dispatchEvent(new CustomEvent('decision-journal-updated'));
      }
    } catch (err) {
      console.error('Second opinion error:', err);
      setSecondOpinionData({
        ai_available: false,
        verdict: 'AI НЕДОСТУПЕН',
        reason: 'AI недоступен, принимай решение сам',
        context: { symbol, timeframe },
        log: null
      });
    } finally {
      setIsAskingOpinion(false);
    }
  }, [symbol, timeframe, activePositionSetup, localPositionSetup]);

  const handleDecisionFromOpinion = useCallback(async (userDecision) => {
    if (!secondOpinionData?.log?.id) return;
    try {
      const res = await fetch(`/api/journal/log/${secondOpinionData.log.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_decision: userDecision })
      });
      if (res.ok) {
        const updated = await res.json();
        setSecondOpinionData((prev) => prev ? { ...prev, log: updated.log } : prev);
        window.dispatchEvent(new CustomEvent('decision-journal-updated'));
      }
    } catch (err) {
      console.error('Failed to record trader decision on second opinion:', err);
    }
  }, [secondOpinionData]);

  return {
    secondOpinionData, setSecondOpinionData,
    isAskingOpinion, setIsAskingOpinion,
    handleAskSecondOpinion, handleDecisionFromOpinion,
  };
}
