/**
 * Trades Settings Modal / Panel
 * Allows configuring size filters, highlight thresholds, and Whale Tracker audio triggers.
 * Settings persist across sessions in localStorage.
 */

import React from 'react';
import { Settings2, Volume2, VolumeX, ShieldAlert, Sparkles, X, RotateCcw, Play } from 'lucide-react';

export const DEFAULT_TRADES_SETTINGS = {
  minSizeUsd: 0,                // 0 means show all trades
  highlightThresholdUsd: 50_000, // Rows >= $50k get bold/highlight
  sizeDisplayMode: 'USD',        // 'USD' | 'COIN'
  soundEnabled: true,
  soundLevel1Usd: 100_000,      // Level 1: Chime (> $100k)
  soundLevel2Usd: 500_000,      // Level 2: Pop (> $500k)
  soundLevel3Usd: 1_000_000,    // Level 3: Boom (> $1M)
  maxSoundsPerSec: 5,
  autoScroll: true
};

const PRESET_FILTERS = [
  { label: 'Все', value: 0 },
  { label: '≥ $1K', value: 1_000 },
  { label: '≥ $5K', value: 5_000 },
  { label: '≥ $25K', value: 25_000 },
  { label: '≥ $100K', value: 100_000 }
];

export default function TradesSettings({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  onTestSound
}) {
  if (!isOpen) return null;

  const handleChange = (key, value) => {
    onUpdateSettings({ ...settings, [key]: value });
  };

  const handleReset = () => {
    onUpdateSettings(DEFAULT_TRADES_SETTINGS);
  };

  return (
    <div
      data-testid="trades-settings-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-none font-sans"
    >
      <div className="bg-[#0e121a] border border-[#222838] rounded-lg w-[420px] shadow-2xl overflow-hidden flex flex-col text-xs text-[#d1d4dc]">
        {/* Header */}
        <div className="px-4 py-2.5 bg-[#121722] border-b border-[#1f2638] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Settings2 size={15} className="text-[#38bdf8]" />
            <span className="font-bold text-foreground text-[12px]">Настройки ленты сделок (Tape)</span>
          </div>
          <button
            type="button"
            data-testid="btn-close-trades-settings"
            onClick={onClose}
            className="p-1 rounded text-[#94a3b8] hover:text-foreground hover:bg-[#1e2536] transition cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Section 1: Size Filter */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-foreground flex items-center justify-between">
              <span>Фильтр минимального объема</span>
              <span className="text-[10px] text-[#38bdf8] font-mono">
                {settings.minSizeUsd === 0 ? 'Без фильтра' : `≥ $${settings.minSizeUsd.toLocaleString()}`}
              </span>
            </label>
            <div className="grid grid-cols-5 gap-1.5">
              {PRESET_FILTERS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  data-testid={`btn-filter-preset-${preset.value}`}
                  onClick={() => handleChange('minSizeUsd', preset.value)}
                  className={`py-1 rounded text-[10px] font-mono transition cursor-pointer border ${
                    settings.minSizeUsd === preset.value
                      ? 'bg-[#2563eb] text-foreground border-[#3b82f6]'
                      : 'bg-[#141a27] text-[#94a3b8] border-[#1f2638] hover:bg-[#1a2233] hover:text-foreground'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="flex items-center space-x-2 pt-1">
              <span className="text-[10px] text-[#64748b]">Точное значение:</span>
              <div className="relative flex-1">
                <span className="absolute left-2.5 top-1.5 text-[#64748b] text-[10px]">$</span>
                <input
                  type="number"
                  data-testid="input-min-size-usd"
                  min="0"
                  step="1000"
                  value={settings.minSizeUsd}
                  onChange={(e) => handleChange('minSizeUsd', Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-full pl-6 pr-2.5 py-1 bg-[#090b10] border border-[#1f2638] rounded text-[11px] font-mono text-foreground focus:outline-none focus:border-[#38bdf8]"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Display & Highlight */}
          <div className="space-y-2 pt-1 border-t border-[#1b2130]">
            <div className="text-[11px] font-bold text-foreground">Визуальное оформление</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-[#94a3b8] block mb-1">Режим объема:</label>
                <div className="flex rounded border border-[#1f2638] bg-[#090b10] p-0.5">
                  <button
                    type="button"
                    onClick={() => handleChange('sizeDisplayMode', 'USD')}
                    className={`flex-1 py-1 rounded text-[10px] font-mono transition cursor-pointer ${
                      settings.sizeDisplayMode === 'USD'
                        ? 'bg-[#2563eb] text-foreground font-bold'
                        : 'text-[#64748b] hover:text-foreground'
                    }`}
                  >
                    USD ($)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChange('sizeDisplayMode', 'COIN')}
                    className={`flex-1 py-1 rounded text-[10px] font-mono transition cursor-pointer ${
                      settings.sizeDisplayMode === 'COIN'
                        ? 'bg-[#2563eb] text-foreground font-bold'
                        : 'text-[#64748b] hover:text-foreground'
                    }`}
                  >
                    COIN (Qty)
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-[#94a3b8] block mb-1">Подсветка от ($):</label>
                <input
                  type="number"
                  min="0"
                  step="10000"
                  value={settings.highlightThresholdUsd}
                  onChange={(e) => handleChange('highlightThresholdUsd', Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-full px-2.5 py-1 bg-[#090b10] border border-[#1f2638] rounded text-[11px] font-mono text-foreground focus:outline-none focus:border-[#38bdf8]"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Whale Tracker Audio Alerts */}
          <div className="space-y-3 pt-1 border-t border-[#1b2130]">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <Sparkles size={13} className="text-[#eab308]" />
                <span className="text-[11px] font-bold text-foreground">Звуковой трекер крупных сделок (Whale Tracker)</span>
              </div>
              <button
                type="button"
                data-testid="toggle-sound-enabled"
                onClick={() => handleChange('soundEnabled', !settings.soundEnabled)}
                className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono transition cursor-pointer border ${
                  settings.soundEnabled
                    ? 'bg-[#10b98120] text-[#10b981] border-[#10b98150]'
                    : 'bg-[#ef444420] text-[#ef4444] border-[#ef444450]'
                }`}
              >
                {settings.soundEnabled ? <Volume2 size={11} /> : <VolumeX size={11} />}
                <span>{settings.soundEnabled ? 'ВКЛЮЧЕН' : 'ВЫКЛ'}</span>
              </button>
            </div>

            {settings.soundEnabled && (
              <div className="space-y-2 bg-[#090c13] p-2.5 rounded border border-[#192030]">
                {/* Level 1 Alert */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10.5px] font-bold text-[#60a5fa] flex items-center gap-1">
                      <span>Уровень 1 (Chime)</span>
                    </div>
                    <div className="text-[9px] text-[#64748b]">Высокий короткий перезвон</div>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <span className="text-[10px] text-[#64748b] font-mono">&gt; $</span>
                    <input
                      type="number"
                      step="50000"
                      value={settings.soundLevel1Usd}
                      onChange={(e) => handleChange('soundLevel1Usd', parseFloat(e.target.value) || 0)}
                      className="w-20 px-1.5 py-0.5 bg-[#0e121a] border border-[#232b3e] rounded text-[10px] font-mono text-foreground text-right"
                    />
                    <button
                      type="button"
                      data-testid="btn-test-sound-l1"
                      onClick={() => onTestSound && onTestSound(1)}
                      className="p-1 rounded bg-[#1e283d] hover:bg-[#2563eb] text-foreground transition cursor-pointer"
                      title="Прослушать звук Уровня 1"
                    >
                      <Play size={10} />
                    </button>
                  </div>
                </div>

                {/* Level 2 Alert */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10.5px] font-bold text-[#34d399] flex items-center gap-1">
                      <span>Уровень 2 (Resonant Pop)</span>
                    </div>
                    <div className="text-[9px] text-[#64748b]">Глубокий резонансный щелчок</div>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <span className="text-[10px] text-[#64748b] font-mono">&gt; $</span>
                    <input
                      type="number"
                      step="100000"
                      value={settings.soundLevel2Usd}
                      onChange={(e) => handleChange('soundLevel2Usd', parseFloat(e.target.value) || 0)}
                      className="w-20 px-1.5 py-0.5 bg-[#0e121a] border border-[#232b3e] rounded text-[10px] font-mono text-foreground text-right"
                    />
                    <button
                      type="button"
                      data-testid="btn-test-sound-l2"
                      onClick={() => onTestSound && onTestSound(2)}
                      className="p-1 rounded bg-[#1e283d] hover:bg-[#10b981] text-foreground transition cursor-pointer"
                      title="Прослушать звук Уровня 2"
                    >
                      <Play size={10} />
                    </button>
                  </div>
                </div>

                {/* Level 3 Alert */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10.5px] font-bold text-[#f59e0b] flex items-center gap-1">
                      <span>Уровень 3 (Whale Boom)</span>
                    </div>
                    <div className="text-[9px] text-[#64748b]">Низкочастотный саб-бас удар 🐋</div>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <span className="text-[10px] text-[#64748b] font-mono">&gt; $</span>
                    <input
                      type="number"
                      step="250000"
                      value={settings.soundLevel3Usd}
                      onChange={(e) => handleChange('soundLevel3Usd', parseFloat(e.target.value) || 0)}
                      className="w-20 px-1.5 py-0.5 bg-[#0e121a] border border-[#232b3e] rounded text-[10px] font-mono text-foreground text-right"
                    />
                    <button
                      type="button"
                      data-testid="btn-test-sound-l3"
                      onClick={() => onTestSound && onTestSound(3)}
                      className="p-1 rounded bg-[#1e283d] hover:bg-[#f59e0b] text-foreground transition cursor-pointer"
                      title="Прослушать звук Уровня 3"
                    >
                      <Play size={10} />
                    </button>
                  </div>
                </div>

                <div className="text-[9px] text-[#64748b] pt-1 border-t border-[#192030] flex items-center justify-between">
                  <span>Ограничение звуков в каскаде:</span>
                  <span className="font-mono text-[#94a3b8]">макс {settings.maxSoundsPerSec}/сек</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-[#121722] border-t border-[#1f2638] flex items-center justify-between">
          <button
            type="button"
            data-testid="btn-reset-trades-settings"
            onClick={handleReset}
            className="flex items-center space-x-1 text-[#64748b] hover:text-foreground transition cursor-pointer text-[10px]"
          >
            <RotateCcw size={11} />
            <span>Сброс настроек</span>
          </button>
          <button
            type="button"
            data-testid="btn-save-trades-settings"
            onClick={onClose}
            className="px-3.5 py-1 rounded bg-[#2563eb] hover:bg-[#1d4ed8] text-foreground font-bold text-[10.5px] transition cursor-pointer shadow"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}
