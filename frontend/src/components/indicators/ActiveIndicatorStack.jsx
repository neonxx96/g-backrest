import React from 'react';
import { Eye, EyeOff, Settings, X, Plus } from 'lucide-react';
import { INDICATORS_REGISTRY } from '../../config/indicatorsRegistry';

export default function ActiveIndicatorStack({
  activeIndicators = [],
  onToggleVisibility,
  onOpenSettings,
  onRemoveIndicator,
  onOpenCatalog
}) {
  if (!activeIndicators || activeIndicators.length === 0) {
    return (
      <div
        data-testid="active-indicator-stack"
        className="absolute top-8 left-2 z-10 flex items-center space-x-1"
      >
        <button
          type="button"
          data-testid="btn-add-first-indicator"
          onClick={onOpenCatalog}
          className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#101622]/80 hover:bg-[#182337] border border-[#232f48]/70 text-[#94a3b8] hover:text-[#38bdf8] text-[10px] font-medium backdrop-blur-xs transition cursor-pointer"
        >
          <Plus size={11} />
          <span>+ Индикатор</span>
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="active-indicator-stack"
      className="absolute top-8 left-2 z-10 flex flex-col space-y-1 select-none pointer-events-auto"
    >
      <div className="flex flex-wrap items-center gap-1 max-w-[80vw]">
        {activeIndicators.map((item) => {
          const def = INDICATORS_REGISTRY[item.id];
          if (!def) return null;

          // Format parameters summary string
          let paramsText = '';
          const inputs = item.inputs || def.defaultInputs;
          if (item.id === 'ema') {
            paramsText = `(${inputs.period1}, ${inputs.period2}, ${inputs.period3})`;
          } else if (item.id === 'boll') {
            paramsText = `(${inputs.period}, ${inputs.stdDev})`;
          } else if (item.id === 'macd') {
            paramsText = `(${inputs.fast}, ${inputs.slow}, ${inputs.signal})`;
          } else if (item.id === 'supertrend') {
            paramsText = `(${inputs.atrPeriod}, ${inputs.multiplier})`;
          } else if (item.id === 'rsi' || item.id === 'atr') {
            paramsText = `(${inputs.period})`;
          } else if (item.id === 'vol') {
            paramsText = `(${inputs.maPeriod})`;
          } else if (item.id === 'cvd') {
            paramsText = `(${inputs.smoothPeriod})`;
          }

          const isVisible = item.enabled !== false;

          return (
            <div
              key={item.id}
              data-testid={`active-indicator-pill-${item.id}`}
              className={`group flex items-center space-x-1.5 px-2 py-0.5 rounded text-[10.5px] font-mono border backdrop-blur-xs transition ${
                isVisible
                  ? 'bg-[#0f1422]/85 text-[#cbd5e1] border-[#1f2b42]/80 hover:border-[#38bdf850]'
                  : 'bg-[#0a0e17]/70 text-[#64748b] border-[#161f2e]/60 line-through'
              }`}
            >
              <span className="font-semibold text-white group-hover:text-[#38bdf8] transition">
                {def.shortName}
              </span>
              <span className="text-[9.5px] text-[#94a3b8]">{paramsText}</span>

              {/* Action buttons visible on hover or mobile */}
              <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition pl-1 border-l border-[#24314c]">
                {/* Visibility */}
                <button
                  type="button"
                  data-testid={`btn-toggle-vis-${item.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleVisibility(item.id);
                  }}
                  title={isVisible ? 'Скрыть индикатор' : 'Показать индикатор'}
                  className="hover:text-white transition p-0.5 cursor-pointer"
                >
                  {isVisible ? <Eye size={11} /> : <EyeOff size={11} className="text-[#ef4444]" />}
                </button>

                {/* Settings */}
                <button
                  type="button"
                  data-testid={`btn-settings-${item.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenSettings(item.id);
                  }}
                  title="Настроить параметры и стиль"
                  className="hover:text-white transition p-0.5 cursor-pointer"
                >
                  <Settings size={11} />
                </button>

                {/* Remove */}
                <button
                  type="button"
                  data-testid={`btn-remove-${item.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveIndicator(item.id);
                  }}
                  title="Удалить с графика"
                  className="hover:text-[#ef4444] transition p-0.5 cursor-pointer"
                >
                  <X size={11} />
                </button>
              </div>
            </div>
          );
        })}

        {/* Quick Add '+' button */}
        <button
          type="button"
          data-testid="btn-stack-open-catalog"
          onClick={onOpenCatalog}
          title="Каталог индикаторов"
          className="flex items-center space-x-0.5 px-1.5 py-0.5 rounded bg-[#0f1422]/80 hover:bg-[#182337] border border-[#1f2b42]/80 text-[#38bdf8] hover:text-white text-[10.5px] transition cursor-pointer"
        >
          <Plus size={11} />
          <span className="text-[10px]">Индикаторы</span>
        </button>
      </div>
    </div>
  );
}
