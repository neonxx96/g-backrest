import { Loader2, Zap } from 'lucide-react';

// Плавающий HUD позиционного сетапа (ТАКТ 2.1): бейджи Entry/SL/TP1/TP2/R:R,
// кнопка «Тест сетапа» (quick backtest) и кнопка «Спросить мнение по этой позиции»,
// карточка консультативного второго мнения AI (вердикт/причина/снапшот рынка/
// запись решения в журнал).
// Извлечено ДОСЛОВНО из Chart.jsx (слайс 6.4l, п.1 MODULARIZATION_PLAN) — JSX
// управляемый: все данные и колбэки пропами из Chart.jsx.

export default function PositionSetupHUD({
  effectivePositionSetup, handleQuickBacktestCurrentSetup, isBacktesting,
  handleAskSecondOpinion, isAskingOpinion, setLocalPositionSetup,
  secondOpinionData, setSecondOpinionData, symbol, timeframe, handleDecisionFromOpinion,
}) {
  return (<>
        {effectivePositionSetup && Number(effectivePositionSetup.entry_price) > 0 && (
          <div
            data-testid="chart-position-hud"
            className="absolute top-2 left-3 z-20 pointer-events-auto flex flex-wrap items-center gap-1.5 px-2 py-1 rounded bg-popover/90 border border-border/80 shadow-md backdrop-blur-xs font-mono text-[10px] text-foreground"
          >
            <span
              data-testid="chart-badge-entry"
              className="px-1.5 py-0.5 rounded bg-primary/20 text-primary font-bold border border-primary/40"
            >
              [{effectivePositionSetup.order_type || (effectivePositionSetup.direction === 'SHORT' ? 'SELL LIMIT' : 'BUY LIMIT')} @ {Number(effectivePositionSetup.entry_price).toFixed(Number(effectivePositionSetup.entry_price) >= 1000 ? 1 : 2)}]
            </span>

            <span
              data-testid="chart-badge-sl"
              className="px-1.5 py-0.5 rounded bg-bear/20 text-bear font-bold border border-bear/40"
            >
              [SL @ {Number(effectivePositionSetup.sl_price).toFixed(Number(effectivePositionSetup.sl_price) >= 1000 ? 1 : 2)} ({Number(effectivePositionSetup.sl_pct ?? -0.28).toFixed(2)}% | -${Math.round(Number(effectivePositionSetup.sl_risk_usd ?? 50))})]
            </span>

            <span
              data-testid="chart-badge-tp1"
              className="px-1.5 py-0.5 rounded bg-bull/20 text-bull font-bold border border-bull/40"
            >
              [TP1 @ {Number(effectivePositionSetup.tp1_price).toFixed(Number(effectivePositionSetup.tp1_price) >= 1000 ? 1 : 2)} (+{Number(effectivePositionSetup.tp1_pct ?? 0.43).toFixed(2)}%)]
            </span>

            {effectivePositionSetup.tp2_price && (
              <span
                data-testid="chart-badge-tp2"
                className="px-1.5 py-0.5 rounded bg-bull/20 text-bull font-bold border border-bull/40"
              >
                [TP2 @ {Number(effectivePositionSetup.tp2_price).toFixed(Number(effectivePositionSetup.tp2_price) >= 1000 ? 1 : 2)} (+{Number(effectivePositionSetup.tp2_pct ?? 0.92).toFixed(2)}%)]
              </span>
            )}

            <span
              data-testid="chart-badge-rr"
              className="px-1.5 py-0.5 rounded bg-muted/60 text-foreground font-bold border border-border"
            >
              R:R {effectivePositionSetup.rr_label || `1:${Number(effectivePositionSetup.rr_ratio || 2.8).toFixed(1)}`}
            </span>

            {/* Quick 1-Click Backtest Button for current setup */}
            <button
              type="button"
              data-testid="btn-quick-backtest-setup"
              onClick={handleQuickBacktestCurrentSetup}
              disabled={isBacktesting}
              className="px-2 py-0.5 rounded bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-bold flex items-center space-x-1 transition cursor-pointer shadow-sm text-[9.5px]"
              title="Проверить этот сетап (Entry / TP / SL) на реальной истории Binance с комиссиями"
            >
              {isBacktesting ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} className="text-yellow-300" />}
              <span>{isBacktesting ? 'Расчет...' : 'Тест сетапа'}</span>
            </button>

            {/* Stage 2: Consultative AI Second Opinion Button right next to Risk/Reward setup */}
            <button
              type="button"
              data-testid="btn-ask-second-opinion"
              onClick={handleAskSecondOpinion}
              disabled={isAskingOpinion}
              className="px-2 py-0.5 rounded bg-[#6b21a8] hover:bg-[#7e22ce] text-white font-bold flex items-center space-x-1 transition cursor-pointer shadow-sm text-[9.5px] border border-[#c084fc80]"
              title="Консультативное второе мнение AI по этой позиции (только факты рынка, решение за вами)"
            >
              <span>🧠</span>
              <span>{isAskingOpinion ? 'Запрос AI...' : 'Спросить мнение по этой позиции'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setLocalPositionSetup(null);
                window.dispatchEvent(new CustomEvent('clear-position-setup'));
              }}
              className="ml-0.5 text-[#94a3b8] hover:text-white px-1 cursor-pointer"
              title="Скрыть разметку позиции"
            >
              ✕
            </button>
          </div>
        )}

        {/* Stage 2: Consultative Second Opinion Non-Blocking Overlay Card */}
        {secondOpinionData && (
          <div
            data-testid="second-opinion-card"
            className="absolute top-12 left-3 z-30 pointer-events-auto w-[390px] max-w-[92%] rounded-lg bg-[#0d121d]/95 border border-[#a855f770] shadow-2xl p-3 font-mono text-[10.5px] text-[#e2e8f0] backdrop-blur-md"
          >
            <div className="flex items-center justify-between border-b border-[#1e293b] pb-1.5 mb-2">
              <div className="flex items-center space-x-1.5">
                <span>🧠</span>
                <span className="font-bold text-white">Второе мнение AI ({secondOpinionData.context?.symbol || symbol} {secondOpinionData.context?.timeframe || timeframe})</span>
              </div>
              <button
                type="button"
                data-testid="btn-close-second-opinion"
                onClick={() => setSecondOpinionData(null)}
                className="text-[#94a3b8] hover:text-white px-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Verdict & 1 Reason */}
            <div className="mb-2">
              <div className="flex items-center space-x-2 mb-1">
                <span
                  data-testid="second-opinion-verdict"
                  className={`px-2 py-0.5 rounded font-bold text-[10.5px] ${
                    secondOpinionData.verdict === 'ЗА'
                      ? 'bg-[#059669]/30 text-[#34d399] border border-[#34d39960]'
                      : secondOpinionData.verdict === 'ПРОТИВ'
                      ? 'bg-[#dc2626]/30 text-[#f87171] border border-[#f8717160]'
                      : !secondOpinionData.ai_available
                      ? 'bg-[#d97706]/30 text-[#fbbf24] border border-[#fbbf2460]'
                      : 'bg-[#334155]/50 text-[#cbd5e1] border border-[#64748b60]'
                  }`}
                >
                  {secondOpinionData.verdict}
                </span>
                {!secondOpinionData.ai_available && (
                  <span className="text-[9.5px] text-[#fbbf24]">Принимай решение сам по фактам ниже</span>
                )}
              </div>
              <div
                data-testid="second-opinion-reason"
                className="text-[11px] text-white bg-[#131b2e] border border-[#1e293b] rounded p-2 leading-snug"
              >
                {secondOpinionData.reason}
              </div>
              {secondOpinionData.model_used && (
                <div className="flex items-center justify-between text-[8.5px] text-[#94a3b8] mt-1 px-1">
                  <span>Модель: <span className="text-white font-mono">{secondOpinionData.model_used}</span></span>
                  {secondOpinionData.fallback ? (
                    <span className="text-amber-400 font-bold bg-amber-500/10 px-1 rounded border border-amber-500/30">[Fallback]</span>
                  ) : (
                    <span className="text-emerald-400 font-bold bg-emerald-500/10 px-1 rounded border border-emerald-500/30">[Primary]</span>
                  )}
                </div>
              )}
            </div>

            {/* Factual Market Snapshot Passed */}
            {secondOpinionData.context && (
              <div className="grid grid-cols-2 gap-1 text-[9.5px] text-[#94a3b8] bg-[#090d16] p-2 rounded border border-[#1e293b] mb-2">
                <div>Тренд: <span className="text-white">{secondOpinionData.context.trend || '—'}</span></div>
                <div>Дельта CVD: <span className="text-white">{secondOpinionData.context.cvd_bias || '—'}</span></div>
                <div>OI (24ч): <span className="text-white">{secondOpinionData.context.oi_change_24h_pct ?? 0}%</span></div>
                <div>
                  Ист. EV: <span className="text-white">${secondOpinionData.context.historical_ev_usd ?? 0} ({secondOpinionData.context.historical_trades_count ?? 0} сд.)</span>
                </div>
              </div>
            )}

            {/* Trader's Final Decision Recording */}
            <div className="flex items-center justify-between pt-1 border-t border-[#1e293b]">
              <span className="text-[9.5px] text-[#94a3b8]">
                {secondOpinionData.log?.user_decision && secondOpinionData.log.user_decision !== 'PENDING'
                  ? `В журнале: ${secondOpinionData.log.user_decision}`
                  : 'Записать моё решение в журнал:'}
              </span>
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  data-testid="btn-opinion-mark-entered"
                  onClick={() => handleDecisionFromOpinion('ENTERED')}
                  className={`px-2 py-0.5 rounded text-[9.5px] font-bold cursor-pointer border ${
                    secondOpinionData.log?.user_decision === 'ENTERED'
                      ? 'bg-[#059669] text-white border-[#34d399]'
                      : 'bg-[#059669]/20 text-[#34d399] border-[#059669]/50 hover:bg-[#059669]/40'
                  }`}
                >
                  ✅ Вошёл
                </button>
                <button
                  type="button"
                  data-testid="btn-opinion-mark-skipped"
                  onClick={() => handleDecisionFromOpinion('SKIPPED')}
                  className={`px-2 py-0.5 rounded text-[9.5px] font-bold cursor-pointer border ${
                    secondOpinionData.log?.user_decision === 'SKIPPED'
                      ? 'bg-[#475569] text-white border-[#94a3b8]'
                      : 'bg-[#1e293b] text-[#cbd5e1] border-[#334155] hover:bg-[#334155]'
                  }`}
                >
                  ⏭ Пропустил
                </button>
                <button
                  type="button"
                  data-testid="btn-opinion-mark-exited"
                  onClick={() => handleDecisionFromOpinion('EXITED')}
                  className={`px-2 py-0.5 rounded text-[9.5px] font-bold cursor-pointer border ${
                    secondOpinionData.log?.user_decision === 'EXITED'
                      ? 'bg-[#d97706] text-white border-[#fbbf24]'
                      : 'bg-[#d97706]/20 text-[#fbbf24] border-[#d97706]/50 hover:bg-[#d97706]/40'
                  }`}
                >
                  🏁 Вышел
                </button>
              </div>
            </div>
          </div>
        )}
  </>);
}
