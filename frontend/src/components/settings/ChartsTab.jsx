import React from 'react';

// Вкладка «Графики & Индикаторы» — управляемая: cfg + updateUi колбэк (логика в SettingsModal).
export default function ChartsTab({ cfg, updateUi }) {
  return (
    <div className="space-y-4">
      {/* EMA Configuration */}
      <div className="p-3 rounded bg-[#10131a] border border-[#1b212f] space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-white font-bold text-xs">Экспоненциальные средние (EMA)</div>
            <div className="text-[10px] text-[#787f91]">Настройка периодов, цветов и толщины линий на свечном графике</div>
          </div>
          <input
            type="checkbox"
            checked={cfg.emaEnabled !== false}
            onChange={e => updateUi({ emaEnabled: e.target.checked })}
            className="w-4 h-4 accent-[#38bdf8]"
          />
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          {[0, 1, 2].map(idx => (
            <div key={idx} className="p-2 rounded bg-[#0c0e12] border border-[#1f2430] space-y-1.5">
              <div className="flex items-center justify-between text-[10px] text-[#787f91]">
                <span>EMA #{idx + 1}</span>
                <input
                  type="color"
                  value={cfg.emaColors[idx] || '#38bdf8'}
                  onChange={e => {
                    const nextColors = [...cfg.emaColors];
                    nextColors[idx] = e.target.value;
                    updateUi({ emaColors: nextColors });
                  }}
                  className="w-5 h-4 bg-transparent border-0 cursor-pointer"
                  title="Цвет линии EMA"
                />
              </div>
              <div className="flex items-center space-x-1">
                <span className="text-[10px] text-[#60697b]">Период:</span>
                <input
                  type="number"
                  min="2"
                  max="500"
                  value={cfg.emaPeriods[idx] || 20}
                  onChange={e => {
                    const nextPeriods = [...cfg.emaPeriods];
                    nextPeriods[idx] = Math.max(2, parseInt(e.target.value, 10) || 20);
                    updateUi({ emaPeriods: nextPeriods });
                  }}
                  className="w-full bg-[#121620] border border-[#1f2430] rounded px-1.5 py-0.5 text-right text-white font-bold"
                />
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-[#848e9c] text-[11px]">Толщина линий EMA:</span>
          <div className="flex items-center space-x-1.5">
            {[1, 1.5, 2, 2.5, 3].map(w => (
              <button
                key={w}
                onClick={() => updateUi({ emaWidth: w })}
                className={`px-2 py-0.5 rounded text-[10px] transition ${
                  cfg.emaWidth === w ? 'bg-[#2563eb] text-white font-bold' : 'bg-[#0c0e12] text-[#787f91] hover:text-white'
                }`}
              >
                {w}px
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Sub-panes Configuration */}
      <div className="p-3 rounded bg-[#10131a] border border-[#1b212f] space-y-2.5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-white font-bold text-xs">Подвальные панели графика (Sub-panes)</div>
            <div className="text-[10px] text-[#787f91]">
              Отключите осцилляторы RSI/MACD, чтобы отдать максимум высоты свечам и стакану
            </div>
          </div>
          <button
            onClick={() => updateUi({ subpanes: { vol: true, cvd: true, rsi: false, macd: false } })}
            className="px-2 py-1 rounded bg-[#182030] hover:bg-[#2563eb] text-[#38bdf8] hover:text-white text-[10px] border border-[#2b3955] transition"
          >
            Order Flow фокус (VOL + CVD)
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
          {[
            { id: 'vol', label: 'VOL (Объём)', desc: 'Гистограмма объёма', color: '#26a69a' },
            { id: 'cvd', label: 'CVD Дельта', desc: 'Кумулятивная дельта', color: '#38bdf8' },
            { id: 'rsi', label: 'RSI (14)', desc: 'Осциллятор импульса', color: '#a855f7' },
            { id: 'macd', label: 'MACD', desc: 'Схождение средних', color: '#f59e0b' }
          ].map(pane => {
            const enabled = Boolean(cfg.subpanes?.[pane.id]);
            return (
              <div
                key={pane.id}
                onClick={() => updateUi({ subpanes: { [pane.id]: !enabled } })}
                className={`p-2 rounded border cursor-pointer transition ${
                  enabled
                    ? 'bg-[#161f30] border-[#38bdf8] text-white'
                    : 'bg-[#0c0e12] border-[#1f2430] text-[#60697b] hover:text-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[11px]" style={{ color: enabled ? pane.color : undefined }}>
                    {pane.label}
                  </span>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => {}}
                    className="accent-[#38bdf8]"
                  />
                </div>
                <div className="text-[9.5px] text-[#787f91] mt-0.5">{pane.desc}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Price Precision & Tick Step */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="p-2.5 rounded bg-[#10131a] border border-[#1b212f] space-y-1.5">
          <div className="text-white font-semibold text-[11px]">Точность округления цен:</div>
          <div className="flex space-x-1">
            {[
              { id: 'auto', label: 'Авто' },
              { id: 1, label: '0.1' },
              { id: 2, label: '0.01' },
              { id: 4, label: '0.0001' },
              { id: 6, label: '1e-6' }
            ].map(opt => (
              <button
                key={opt.id}
                onClick={() => updateUi({ pricePrecision: opt.id })}
                className={`flex-1 py-1 rounded text-[10px] transition ${
                  cfg.pricePrecision === opt.id ? 'bg-[#2563eb] text-white font-bold' : 'bg-[#0c0e12] text-[#787f91] hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-2.5 rounded bg-[#10131a] border border-[#1b212f] space-y-1.5">
          <div className="text-white font-semibold text-[11px]">Множитель шага тика стакана:</div>
          <div className="flex space-x-1">
            {[1, 2, 5, 10, 50, 100].map(step => (
              <button
                key={step}
                onClick={() => updateUi({ tickStep: step })}
                className={`flex-1 py-1 rounded text-[10px] transition ${
                  cfg.tickStep === step ? 'bg-[#2563eb] text-white font-bold' : 'bg-[#0c0e12] text-[#787f91] hover:text-white'
                }`}
              >
                x{step}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
