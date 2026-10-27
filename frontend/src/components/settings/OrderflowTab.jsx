import React from 'react';
import { Slider } from '../ui/slider.jsx';

// Вкладка «Order Flow & Стакан» — управляемая: cfg + updateUi колбэк (логика в SettingsModal).
export default function OrderflowTab({ cfg, updateUi }) {
  return (
    <div className="space-y-4">
      {/* Density Highlighting Threshold */}
      <div className="p-3 rounded bg-[#10131a] border border-[#1b212f] space-y-2.5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-white font-bold text-xs">Порог подсветки плотностей в стакане L2 ($)</div>
            <div className="text-[10px] text-[#787f91]">Заявки свыше этого объёма выделяются цветом и отслеживаются на спуфинг</div>
          </div>
          <span className="text-[#ffb300] font-bold text-xs">
            ${((cfg.densityThresholdUsd || 50000) / 1000).toFixed(0)}k
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {[
            { label: '$25k', val: 25000 },
            { label: '$50k', val: 50000 },
            { label: '$100k', val: 100000 },
            { label: '$250k', val: 250000 },
            { label: '$500k', val: 500000 },
            { label: '$1M', val: 1000000 },
            { label: '$2M', val: 2000000 }
          ].map(p => (
            <button
              key={p.val}
              onClick={() => updateUi({ densityThresholdUsd: p.val })}
              className={`px-2.5 py-1 rounded text-[10px] font-bold transition ${
                cfg.densityThresholdUsd === p.val
                  ? 'bg-[#ff9800] text-black'
                  : 'bg-[#0c0e12] text-[#848e9c] border border-[#1f2430] hover:text-white'
              }`}
            >
              {p.label}
            </button>
          ))}
          <input
            type="number"
            step="10000"
            value={cfg.densityThresholdUsd || 50000}
            onChange={e => updateUi({ densityThresholdUsd: Math.max(1000, Number(e.target.value) || 50000) })}
            className="ml-auto w-28 bg-[#0c0e12] border border-[#1f2430] rounded px-2 py-1 text-right text-white font-bold"
          />
        </div>
      </div>

      {/* Time & Sales Tape Filter */}
      <div className="p-3 rounded bg-[#10131a] border border-[#1b212f] space-y-2.5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-white font-bold text-xs">Фильтрация тиков в ленте сделок (Time & Sales)</div>
            <div className="text-[10px] text-[#787f91]">Отсекает мелкий рыночный шум, оставляя только значимые принты</div>
          </div>
          <span className="text-[#38bdf8] font-bold text-xs">
            {cfg.tapeMinUsd >= 1000 ? `≥ $${(cfg.tapeMinUsd / 1000).toFixed(0)}k` : 'Все сделки'}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {[
            { label: 'Все ($0)', val: 0 },
            { label: '≥ $1k', val: 1000 },
            { label: '≥ $5k', val: 5000 },
            { label: '≥ $10k', val: 10000 },
            { label: '≥ $25k', val: 25000 },
            { label: '≥ $50k', val: 50000 },
            { label: '≥ $100k', val: 100000 }
          ].map(p => (
            <button
              key={p.val}
              onClick={() => updateUi({ tapeMinUsd: p.val })}
              className={`px-2.5 py-1 rounded text-[10px] font-bold transition ${
                cfg.tapeMinUsd === p.val
                  ? 'bg-[#2563eb] text-white'
                  : 'bg-[#0c0e12] text-[#848e9c] border border-[#1f2430] hover:text-white'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Wall Lifetime Timer & Spoofing Detection */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="p-3 rounded bg-[#10131a] border border-[#1b212f] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-white font-bold text-[11px]">Таймер подтверждения «СТЕНА»:</span>
            <span className="text-[#ffb300] font-bold">{cfg.wallLifetimeSec || 60} сек</span>
          </div>
          <Slider
            min={10}
            max={300}
            step={10}
            value={[cfg.wallLifetimeSec || 60]}
            onValueChange={([val]) => updateUi({ wallLifetimeSec: val })}
            className="w-full py-1.5"
          />
          <div className="text-[9.5px] text-[#60697b]">
            Время удержания уровня в стакане до присвоения метки «СТЕНА»
          </div>
        </div>

        <div className="p-3 rounded bg-[#10131a] border border-[#1b212f] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-white font-bold text-[11px]">Дистанция детекции спуфинга:</span>
            <span className="text-[#f43f5e] font-bold">{(cfg.spoofDistancePct ?? 0.35).toFixed(2)}%</span>
          </div>
          <Slider
            min={0.10}
            max={1.00}
            step={0.05}
            value={[cfg.spoofDistancePct ?? 0.35]}
            onValueChange={([val]) => updateUi({ spoofDistancePct: val })}
            className="w-full py-1.5"
          />
          <div className="text-[9.5px] text-[#60697b]">
            Снятие крупной стенки без объёма в ленте ближе этого порога помечается как СПУФ
          </div>
        </div>
      </div>
    </div>
  );
}
