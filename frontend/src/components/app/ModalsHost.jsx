import React from 'react';
import { X, Keyboard } from 'lucide-react';
import SettingsModal from '../SettingsModal';
import DecisionJournalModal from '../DecisionJournalModal';
import ReplayModal from '../ReplayModal';
import IndicatorsModal from '../IndicatorsModal';
import AICopilotSidebar from '../AICopilotSidebar';
import AlertsModal from '../docking/AlertsModal';
import { getUsableMarketPrice } from '../../services/marketTruth';

// Управляемый хост оверлеев терминала — вынесен из App.jsx (модульный план, п.5).
// Содержит: пуш-уведомления (toasts, верхний правый угол), модалку горячих клавиш,
// AI Copilot сайдбар, журнал решений, Replay-плеер, каталог индикаторов, алерты.
// Всё состояние (show*/toasts/индикаторы) живёт в App — сюда прокидываются
// значения и колбэки; единственная локальная логика — getUsableMarketPrice для
// отображения цены в тостах и алертах.

export default function ModalsHost({
  toasts,
  onToastClick,
  onRemoveToast,
  showSettings,
  onCloseSettings,
  userId,
  uiConfig,
  onUiConfigChange,
  onAiConfigChange,
  showHotkeyHelp,
  onCloseHotkeyHelp,
  showAICopilot,
  onCloseAICopilot,
  symbol,
  timeframe,
  onProjectPositionSetup,
  onApplyLevels,
  showDecisionJournal,
  onCloseDecisionJournal,
  activePositionSetup,
  showReplay,
  onCloseReplay,
  showIndicatorsModal,
  onCloseIndicatorsModal,
  indicatorsTargetChart,
  onTargetChartChange,
  primaryIndicators,
  secondaryIndicators,
  onIndicatorsChange,
  isDualPane,
  alertsCurrentPrice
}) {
  return (
    <>
      {/* Real-time Push Toast Notifications (Top Right) */}
      <div className="fixed top-11 right-3 z-50 flex flex-col space-y-2 pointer-events-none max-w-sm w-full font-mono">
        {toasts.map((t) => {
          const isBuy = t.direction === 'BULLISH' || t.direction === 'BUY';
          const isSell = t.direction === 'BEARISH' || t.direction === 'SELL';
          const toneBorder = isBuy
            ? 'border-[#26a69a] shadow-[0_4px_16px_rgba(38,166,154,0.35)]'
            : isSell
            ? 'border-[#ef5350] shadow-[0_4px_16px_rgba(239,83,80,0.35)]'
            : 'border-[#ffb300] shadow-[0_4px_16px_rgba(255,179,0,0.35)]';
          const badgeBg = isBuy ? 'bg-[#26a69a]' : isSell ? 'bg-[#ef5350]' : 'bg-[#ffb300] text-black';

          return (
            <div
              key={t.id}
              onClick={() => {
                if (t.symbol) onToastClick(t.symbol);
                onRemoveToast(t.id);
              }}
              className={`pointer-events-auto cursor-pointer p-2.5 rounded bg-[#0d1017]/95 border backdrop-blur-md transition-all duration-200 transform translate-y-0 opacity-100 ${toneBorder}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5">
                  <span className={`px-1.5 py-0.2 rounded text-[9.5px] font-bold text-white uppercase ${badgeBg}`}>
                    {isBuy ? 'BUY' : isSell ? 'SELL' : 'ALERT'}
                  </span>
                  <span className="font-bold text-white text-[11px]">#{t.symbol}</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  {getUsableMarketPrice(t.price) != null && <span className="text-[11px] font-bold text-white">${getUsableMarketPrice(t.price)}</span>}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveToast(t.id);
                    }}
                    className="text-[#787f91] hover:text-white p-0.5"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
              <div className="text-[10px] text-[#cbd5e1] mt-1 truncate">
                {t.description}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modular Settings Center Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={onCloseSettings}
        userId={userId}
        uiConfig={uiConfig}
        onUiConfigChange={onUiConfigChange}
        onAiConfigChange={onAiConfigChange}
      />

      {/* Hotkeys Quick Reference Modal */}
      {showHotkeyHelp && (
        <div
          onClick={onCloseHotkeyHelp}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-subtle)' }}
            className="border rounded-lg p-4 w-full max-w-sm text-xs space-y-3 shadow-2xl text-[#d1d4dc]"
          >
            <div className="flex items-center justify-between pb-2 border-b border-[#161820]">
              <span className="font-bold text-white text-sm flex items-center">
                <Keyboard size={14} className="mr-1.5 text-[#38bdf8]" />
                Горячие клавиши терминала
              </span>
              <button onClick={onCloseHotkeyHelp} className="text-[#60697b] hover:text-white">
                ✕
              </button>
            </div>

            <div className="space-y-1.5 font-mono text-[11px]">
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Ликвидации & Карантин:</span>
                <span className="text-[#e879f9] font-bold">Q</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Слои спотовых стен:</span>
                <span className="text-[#c084fc] font-bold">L</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Центр настроек:</span>
                <span className="text-white font-bold">, (Запятая)</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Таймфреймы HTF:</span>
                <span className="text-white font-bold">1=1m, 2=5m, 3=15m, 4=30m, 5=1h, 6=4h, 7=6h</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Смена монеты:</span>
                <span className="text-white font-bold">Стрелка Вверх / Вниз</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">1 / 2 Графика (50/50):</span>
                <span className="text-white font-bold">D</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Бэктест & Grid Search:</span>
                <span className="text-white font-bold">B</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">AI Торговый Ассистент:</span>
                <span className="text-[#818cf8] font-bold">A</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Каталог индикаторов:</span>
                <span className="text-[#38bdf8] font-bold">I</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Скальперский DOM стакан:</span>
                <span className="text-white font-bold">O</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Лента сделок (Tape):</span>
                <span className="text-white font-bold">T</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Лента сигналов:</span>
                <span className="text-white font-bold">S</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Центрировать цену и спред:</span>
                <span className="text-white font-bold">Space (Пробел)</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-[#787f91]">Отменить фигуру:</span>
                <span className="text-white font-bold">Ctrl + Z</span>
              </div>
            </div>

            <button
              onClick={onCloseHotkeyHelp}
              className="w-full py-1 rounded bg-[#1f2430] hover:bg-[#2563eb] text-white font-medium transition text-xs"
            >
              Понятно
            </button>
          </div>
        </div>
      )}

      {/* AI Copilot Assistant Sidebar */}
      <AICopilotSidebar
        isOpen={showAICopilot}
        onClose={onCloseAICopilot}
        symbol={symbol}
        timeframe={timeframe}
        onProjectPositionSetup={onProjectPositionSetup}
        onApplyLevels={onApplyLevels}
      />

      {/* Decision Journal Modal (Stage 1 & 2) */}
      <DecisionJournalModal
        isOpen={showDecisionJournal}
        onClose={onCloseDecisionJournal}
        activeSymbol={symbol}
        activeTimeframe={timeframe}
        activeSetup={activePositionSetup}
      />

      {/* Replay lake player (задача 2.5) */}
      <ReplayModal
        isOpen={showReplay}
        onClose={onCloseReplay}
      />

      {/* Indicators Catalog Modal */}
      <IndicatorsModal
        isOpen={showIndicatorsModal}
        onClose={onCloseIndicatorsModal}
        targetChartId={indicatorsTargetChart}
        onTargetChartChange={onTargetChartChange}
        activeIndicators={indicatorsTargetChart === 'primary' ? primaryIndicators : secondaryIndicators}
        onIndicatorsChange={onIndicatorsChange}
        isDualPane={isDualPane}
      />

      {/* Institutional Price Alerts Modal (Velo / Bookmap Style) */}
      <AlertsModal currentSymbol={symbol} currentPrice={alertsCurrentPrice} />
    </>
  );
}
