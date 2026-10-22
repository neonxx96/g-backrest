import React, { useState } from 'react';
import { HelpCircle } from 'lucide-react';

// Вынесено из BacktestPanel.jsx (модульный план, п.2) — общие поля UI для формы параметров и панели.

export function InfoTip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span
      className="relative inline-flex items-center ml-1 cursor-help shrink-0 align-middle"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setShow((v) => !v);
      }}
    >
      <HelpCircle size={10} className="text-neutral-500 hover:text-neutral-300 transition-colors" />
      {show && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 w-52 p-2 bg-neutral-900 border border-neutral-700 text-neutral-200 text-[9px] font-sans font-normal rounded shadow-2xl pointer-events-none whitespace-normal leading-tight">
          {text}
        </span>
      )}
    </span>
  );
}

export function NumField({ label, value, onChange, step = 0.1, min = 0, max, suffix, testId, tooltip }) {
  const isInvalid = (min != null && value !== '' && Number(value) < min) || (max != null && value !== '' && Number(value) > max);
  return (
    <label className="flex flex-col text-[9px] font-mono min-w-0">
      <span className="mb-0.5 text-neutral-400 flex items-center justify-between truncate select-none">
        <span className={`truncate ${isInvalid ? 'text-red-400 font-bold' : ''}`}>{label}</span>
        {tooltip && <InfoTip text={tooltip} />}
      </span>
      <div className={`relative flex items-center bg-neutral-950/80 border rounded px-1.5 py-0.5 transition-all ${
        isInvalid
          ? 'border-red-500/80 ring-1 ring-red-500/30'
          : 'border-neutral-800 focus-within:border-neutral-500 focus-within:ring-1 focus-within:ring-neutral-500/30'
      }`}>
        <input
          data-testid={testId}
          type="number"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className={`w-full bg-transparent text-[10px] text-right font-mono outline-none pr-1 ${
            isInvalid ? 'text-red-300 font-bold' : 'text-neutral-100'
          }`}
        />
        {suffix && (
          <span className="text-neutral-500 text-[8.5px] font-mono select-none shrink-0 border-l border-neutral-800/80 pl-1 ml-0.5">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}
