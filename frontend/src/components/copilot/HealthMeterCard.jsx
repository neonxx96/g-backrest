import React from 'react';

// ТАКТ 3.3: Market Sentiment & Health Meter (0% - 100%) — карточка сайдбара AI Copilot.
// Управляемая: meter передаётся целиком из AICopilotSidebar (analysis.sentiment_meter
// либо дефолтный объект).

export default function HealthMeterCard({ meter }) {
  return (
    <div
      data-testid="ai-health-meter"
      className="p-2.5 rounded-lg border border-[#1f293d] bg-[#0d121d] space-y-1.5"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider font-bold text-[#94a3b8]">
          Индикатор здоровья позиции & Сентимент
        </span>
        <span
          data-testid="ai-health-score"
          style={{ color: meter.color }}
          className="font-mono font-extrabold text-[13px]"
        >
          {meter.score}%
        </span>
      </div>

      {/* Progress Bar 0% - 100% */}
      <div className="w-full h-2.5 rounded-full bg-[#070a10] border border-[#1f2430] overflow-hidden">
        <div
          data-testid="ai-health-bar"
          style={{
            width: `${Math.min(100, Math.max(0, Number(meter.score) || 0))}%`,
            backgroundColor: meter.color
          }}
          className="h-full transition-all duration-300"
        />
      </div>

      {/* Zone Status Label */}
      <div
        data-testid="ai-health-status"
        style={{ color: meter.color }}
        className="text-[10px] font-mono font-bold leading-snug"
      >
        {meter.status_label}
      </div>

      {/* 1-2 Sentence Tactical Advice from AI */}
      <div
        data-testid="ai-sentinel-advice"
        className="text-[10px] text-[#cbd5e1] bg-[#080b12] p-2 rounded border border-[#1a2030] leading-relaxed"
      >
        {meter.short_advice}
      </div>
    </div>
  );
}
