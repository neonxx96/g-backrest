import React from 'react';
import { TrendingUp } from 'lucide-react';

// Stage 3.3: Конус волатильности (Expected Move Cone ±1σ / ±2σ) — карточка сайдбара AI Copilot.

export default function VolatilityConeCard({ expectedMoveCone, coneProjected, onToggleCone }) {
  return (
    <div
      data-testid="ai-volatility-cone-card"
      className="p-2.5 rounded-lg border border-[#38bdf840] bg-[#0a1426] space-y-2 font-mono text-[10px]"
    >
      <div className="flex items-center justify-between">
        <span className="font-bold text-foreground text-[10.5px] flex items-center space-x-1">
          <TrendingUp size={13} className="text-[#38bdf8]" />
          <span>Конус ожидаемого движения (Expected Move)</span>
        </span>
        <span className="text-[#7dd3fc] text-[9px] bg-[#38bdf818] px-1.5 py-0.5 rounded border border-[#38bdf830]">
          16 баров ({expectedMoveCone.timeframe})
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <div className="p-1.5 rounded bg-[#070e1b] border border-[#182642]">
          <div className="text-[#7dd3fc] text-[9px] font-bold">±1σ Диапазон (68.2%)</div>
          <div className="text-foreground font-extrabold text-[10.5px]">
            ±{expectedMoveCone.sigma_1s_pct}%
          </div>
          <div className="text-[#64748b] text-[8.5px]">
            ${expectedMoveCone.fan_points?.[15]?.lower_1s?.toFixed(1)} — ${expectedMoveCone.fan_points?.[15]?.upper_1s?.toFixed(1)}
          </div>
        </div>

        <div className="p-1.5 rounded bg-[#070e1b] border border-[#182642]">
          <div className="text-[#38bdf8] text-[9px] font-bold">±2σ Диапазон (95.4%)</div>
          <div className="text-foreground font-extrabold text-[10.5px]">
            ±{expectedMoveCone.sigma_2s_pct}%
          </div>
          <div className="text-[#64748b] text-[8.5px]">
            ${expectedMoveCone.fan_points?.[15]?.lower_2s?.toFixed(1)} — ${expectedMoveCone.fan_points?.[15]?.upper_2s?.toFixed(1)}
          </div>
        </div>
      </div>

      <button
        data-testid="btn-toggle-volatility-cone"
        onClick={onToggleCone}
        className={`w-full py-1.5 px-2 rounded font-semibold text-[10.5px] flex items-center justify-center space-x-1.5 transition cursor-pointer ${
          coneProjected
            ? 'bg-[#ef444425] hover:bg-[#ef444435] text-[#ef4444] border border-[#ef444450]'
            : 'bg-[#38bdf825] hover:bg-[#38bdf835] text-[#38bdf8] border border-[#38bdf850]'
        }`}
      >
        <TrendingUp size={12} />
        <span>
          {coneProjected
            ? 'Скрыть конус с графика'
            : '📐 Нанести конус волатильности (±1σ / ±2σ) на график'}
        </span>
      </button>
    </div>
  );
}
