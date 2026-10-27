import React, { useState, useEffect } from 'react';
import { X, Sliders, Palette, RotateCcw, Check } from 'lucide-react';
import { INDICATORS_REGISTRY } from '../../config/indicatorsRegistry';
import { Slider } from '../ui/slider.jsx';

export default function IndicatorSettingsDialog({
  isOpen,
  onClose,
  indicatorId,
  currentInputs = {},
  currentStyles = {},
  onSave
}) {
  const [activeTab, setActiveTab] = useState('inputs'); // 'inputs' | 'style'
  const [inputs, setInputs] = useState({});
  const [styles, setStyles] = useState({});

  const indicatorDef = INDICATORS_REGISTRY[indicatorId];

  useEffect(() => {
    if (indicatorDef) {
      setInputs({
        ...indicatorDef.defaultInputs,
        ...(currentInputs || {})
      });
      setStyles({
        ...indicatorDef.defaultStyles,
        ...(currentStyles || {})
      });
    }
  }, [indicatorId, indicatorDef, currentInputs, currentStyles, isOpen]);

  if (!isOpen || !indicatorDef) return null;

  const handleInputChange = (key, value) => {
    setInputs((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const handleStyleChange = (key, value) => {
    setStyles((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const handleReset = () => {
    setInputs({ ...indicatorDef.defaultInputs });
    setStyles({ ...indicatorDef.defaultStyles });
  };

  const handleApply = (e) => {
    e.preventDefault();
    onSave(indicatorId, inputs, styles);
    onClose();
  };

  return (
    <div
      data-testid="indicator-settings-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="indicator-settings-dialog"
        className="w-full max-w-md bg-[#0e131d] border border-[#1e2638] rounded-xl shadow-2xl flex flex-col overflow-hidden text-[#e2e8f0]"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#1b2233] flex items-center justify-between bg-[#121824]">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Настройки: {indicatorDef.shortName}
            </h3>
            <p className="text-[11px] text-[#94a3b8]">{indicatorDef.name}</p>
          </div>
          <button
            type="button"
            data-testid="btn-close-indicator-settings"
            onClick={onClose}
            className="p-1 rounded-md text-[#64748b] hover:text-white hover:bg-[#1e2638] transition cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs: Inputs vs Style */}
        <div className="flex border-b border-[#1b2233] bg-[#0b0f17] px-4 pt-2">
          <button
            type="button"
            data-testid="tab-inputs"
            onClick={() => setActiveTab('inputs')}
            className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-medium border-b-2 transition cursor-pointer ${
              activeTab === 'inputs'
                ? 'border-[#38bdf8] text-[#38bdf8]'
                : 'border-transparent text-[#94a3b8] hover:text-white'
            }`}
          >
            <Sliders size={13} />
            <span>Параметры</span>
          </button>
          <button
            type="button"
            data-testid="tab-style"
            onClick={() => setActiveTab('style')}
            className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-medium border-b-2 transition cursor-pointer ${
              activeTab === 'style'
                ? 'border-[#38bdf8] text-[#38bdf8]'
                : 'border-transparent text-[#94a3b8] hover:text-white'
            }`}
          >
            <Palette size={13} />
            <span>Стиль</span>
          </button>
        </div>

        {/* Tab Content */}
        <form onSubmit={handleApply} className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {activeTab === 'inputs' ? (
            <div className="space-y-3.5" data-testid="inputs-tab-content">
              {indicatorDef.inputDefs.map((def) => {
                const val = inputs[def.key] ?? def.default;
                return (
                  <div key={def.key} className="flex items-center justify-between text-xs">
                    <label className="text-[#cbd5e1] font-medium">{def.label}</label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        data-testid={`input-${def.key}`}
                        value={val}
                        min={def.min}
                        max={def.max}
                        step={def.step}
                        onChange={(e) => handleInputChange(def.key, parseFloat(e.target.value) || 0)}
                        className="w-24 px-2 py-1 bg-[#141b29] border border-[#232d42] rounded text-right text-xs text-white font-mono focus:border-[#38bdf8] focus:outline-none transition"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-3.5" data-testid="style-tab-content">
              {indicatorDef.styleDefs.map((def) => {
                const val = styles[def.key] ?? def.default;

                if (def.type === 'color') {
                  return (
                    <div key={def.key} className="flex items-center justify-between text-xs">
                      <label className="text-[#cbd5e1] font-medium">{def.label}</label>
                      <div className="flex items-center space-x-2">
                        <input
                          type="color"
                          data-testid={`color-picker-${def.key}`}
                          value={val}
                          onChange={(e) => handleStyleChange(def.key, e.target.value)}
                          className="w-7 h-7 rounded border border-[#232d42] bg-transparent cursor-pointer p-0"
                        />
                        <span className="text-[11px] font-mono text-[#94a3b8] uppercase">
                          {val}
                        </span>
                      </div>
                    </div>
                  );
                }

                if (def.type === 'number') {
                  return (
                    <div key={def.key} className="flex items-center justify-between text-xs">
                      <label className="text-[#cbd5e1] font-medium">{def.label}</label>
                      <div className="flex items-center space-x-2">
                        <Slider
                          min={def.min || 1}
                          max={def.max || 4}
                          step={def.step || 0.5}
                          value={[val]}
                          onValueChange={([v]) => handleStyleChange(def.key, v)}
                          className="w-24"
                        />
                        <span className="text-[11px] font-mono text-[#38bdf8] w-6 text-right">
                          {val}px
                        </span>
                      </div>
                    </div>
                  );
                }

                return null;
              })}
            </div>
          )}

          {/* Footer Buttons */}
          <div className="pt-4 border-t border-[#1b2233] flex items-center justify-between">
            <button
              type="button"
              data-testid="btn-reset-indicator-settings"
              onClick={handleReset}
              className="flex items-center space-x-1 text-[11px] text-[#94a3b8] hover:text-white transition cursor-pointer"
            >
              <RotateCcw size={12} />
              <span>По умолчанию</span>
            </button>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1a2233] text-[#94a3b8] hover:text-white transition cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="submit"
                data-testid="btn-apply-indicator-settings"
                className="flex items-center space-x-1 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-[#2563eb] hover:bg-[#1d4ed8] text-white shadow transition cursor-pointer"
              >
                <Check size={13} />
                <span>Применить</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
