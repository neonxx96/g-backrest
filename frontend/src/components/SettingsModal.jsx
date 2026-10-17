import React, { useEffect, useState } from 'react';
import { X, Save, Sliders, Bell, CheckCircle } from 'lucide-react';

const API_BASE = "http://localhost:8000/api";

const TIMEFRAMES = ["1m", "5m", "15m", "30m", "45m", "1h", "4h", "6h"];

export default function SettingsModal({ isOpen, onClose, userId = "0" }) {
  const [settings, setSettings] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetch(`${API_BASE}/settings?user_id=${userId}`)
        .then(res => res.json())
        .then(data => setSettings(data))
        .catch(err => console.error("Error loading settings:", err));
    }
  }, [isOpen, userId]);

  if (!isOpen || !settings) return null;

  const handleChange = (field, value) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    setIsSaving(true);
    fetch(`${API_BASE}/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings)
    })
    .then(res => res.json())
    .then(saved => {
      setSettings(saved);
      setIsSaving(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    })
    .catch(() => setIsSaving(false));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#181c27] border border-[#2a2e39] rounded-xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh] text-xs text-[#d1d4dc]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#1e222d] border-b border-[#2a2e39]">
          <div className="flex items-center space-x-2 font-bold text-white text-sm">
            <Sliders size={16} className="text-[#2962ff]" />
            <span>Настройки сканера и фильтров</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#2a2e39] text-[#787b86]">
            <X size={16} />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-4 overflow-y-auto space-y-4">
          {/* Timeframe */}
          <div>
            <label className="block text-[#787b86] mb-1 font-semibold">Базовый таймфрейм сигналов:</label>
            <div className="grid grid-cols-4 gap-1.5">
              {TIMEFRAMES.map(tf => (
                <button
                  key={tf}
                  onClick={() => handleChange('timeframe', tf)}
                  className={`py-1.5 rounded font-mono font-semibold transition ${settings.timeframe === tf ? 'bg-[#2962ff] text-white' : 'bg-[#1e222d] hover:bg-[#2a2e39] text-[#787b86]'}`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          <div className="h-px bg-[#2a2e39]" />

          {/* 24h Price Change */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white">Изменение цены 24ч (мин. %):</span>
              <input
                type="checkbox"
                checked={settings.price_change_enabled}
                onChange={e => handleChange('price_change_enabled', e.target.checked)}
                className="w-4 h-4 accent-[#2962ff]"
              />
            </div>
            <div className="flex items-center space-x-3">
              <input
                type="range"
                min="0.5"
                max="15.0"
                step="0.5"
                value={settings.price_change_min}
                onChange={e => handleChange('price_change_min', parseFloat(e.target.value))}
                className="flex-1 accent-[#2962ff]"
              />
              <span className="font-mono w-12 text-right font-bold text-white">
                {settings.price_change_min}%
              </span>
            </div>
          </div>

          {/* 24h Open Interest Change */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white">Изменение Open Interest 24ч (мин. %):</span>
              <input
                type="checkbox"
                checked={settings.oi_change_enabled}
                onChange={e => handleChange('oi_change_enabled', e.target.checked)}
                className="w-4 h-4 accent-[#2962ff]"
              />
            </div>
            <div className="flex items-center space-x-3">
              <input
                type="range"
                min="1.0"
                max="20.0"
                step="0.5"
                value={settings.oi_change_min}
                onChange={e => handleChange('oi_change_min', parseFloat(e.target.value))}
                className="flex-1 accent-[#2962ff]"
              />
              <span className="font-mono w-12 text-right font-bold text-white">
                {settings.oi_change_min}%
              </span>
            </div>
          </div>

          {/* 24h Liquidations */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white">Сумма ликвидаций 24ч (мин. $):</span>
              <input
                type="checkbox"
                checked={settings.liquidation_enabled}
                onChange={e => handleChange('liquidation_enabled', e.target.checked)}
                className="w-4 h-4 accent-[#2962ff]"
              />
            </div>
            <input
              type="number"
              step="10000"
              value={settings.liquidation_min_usd}
              onChange={e => handleChange('liquidation_min_usd', parseFloat(e.target.value))}
              className="w-full bg-[#1e222d] border border-[#2a2e39] rounded px-2 py-1 font-mono text-white"
            />
          </div>

          <div className="h-px bg-[#2a2e39]" />

          {/* EMA(20) Cross */}
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white">Сигнал пересечения свечой EMA(20):</span>
            <input
              type="checkbox"
              checked={settings.ema_cross_enabled}
              onChange={e => handleChange('ema_cross_enabled', e.target.checked)}
              className="w-4 h-4 accent-[#2962ff]"
            />
          </div>

          {/* Volume Spike Multiplier */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white">Всплеск объема (множитель к MA20):</span>
              <input
                type="checkbox"
                checked={settings.vol_spike_enabled}
                onChange={e => handleChange('vol_spike_enabled', e.target.checked)}
                className="w-4 h-4 accent-[#2962ff]"
              />
            </div>
            <div className="flex items-center space-x-3">
              <input
                type="range"
                min="1.2"
                max="5.0"
                step="0.1"
                value={settings.vol_spike_mult}
                onChange={e => handleChange('vol_spike_mult', parseFloat(e.target.value))}
                className="flex-1 accent-[#2962ff]"
              />
              <span className="font-mono w-12 text-right font-bold text-white">
                {settings.vol_spike_mult}x
              </span>
            </div>
          </div>

          {/* RSI Bounds */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white">RSI Зоны (Oversold / Overbought):</span>
              <input
                type="checkbox"
                checked={settings.rsi_filter_enabled}
                onChange={e => handleChange('rsi_filter_enabled', e.target.checked)}
                className="w-4 h-4 accent-[#2962ff]"
              />
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="number"
                value={settings.rsi_min}
                onChange={e => handleChange('rsi_min', parseFloat(e.target.value))}
                className="w-1/2 bg-[#1e222d] border border-[#2a2e39] rounded px-2 py-1 font-mono text-white text-center"
                placeholder="RSI Min"
              />
              <input
                type="number"
                value={settings.rsi_max}
                onChange={e => handleChange('rsi_max', parseFloat(e.target.value))}
                className="w-1/2 bg-[#1e222d] border border-[#2a2e39] rounded px-2 py-1 font-mono text-white text-center"
                placeholder="RSI Max"
              />
            </div>
          </div>

          {/* Cooldown */}
          <div className="space-y-1.5">
            <span className="font-semibold text-white">Анти-спам кулдаун по монете (мин):</span>
            <div className="flex items-center space-x-3">
              <input
                type="range"
                min="5"
                max="120"
                step="5"
                value={settings.cooldown_minutes}
                onChange={e => handleChange('cooldown_minutes', parseInt(e.target.value))}
                className="flex-1 accent-[#2962ff]"
              />
              <span className="font-mono w-16 text-right font-bold text-white">
                {settings.cooldown_minutes} мин
              </span>
            </div>
          </div>

          {/* Notifications Toggle */}
          <div className="flex items-center justify-between p-2.5 rounded bg-[#1e222d] border border-[#2a2e39]">
            <div className="flex items-center space-x-2">
              <Bell size={14} className="text-[#089981]" />
              <span className="font-semibold text-white">Отправлять в Telegram бот:</span>
            </div>
            <input
              type="checkbox"
              checked={settings.notifications_enabled}
              onChange={e => handleChange('notifications_enabled', e.target.checked)}
              className="w-4 h-4 accent-[#089981]"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#1e222d] border-t border-[#2a2e39]">
          {saveSuccess ? (
            <span className="text-[#089981] font-semibold flex items-center space-x-1">
              <CheckCircle size={14} className="mr-1" />
              Применено без перезапуска!
            </span>
          ) : (
            <span className="text-[#787b86]">Применяется моментально</span>
          )}

          <div className="flex space-x-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-[#2a2e39] hover:bg-[#363a45] text-white font-semibold"
            >
              Отмена
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-1.5 rounded bg-[#2962ff] hover:bg-[#1e4bd8] text-white font-semibold flex items-center space-x-1"
            >
              <Save size={13} className="mr-1" />
              {isSaving ? "Сохранение..." : "Сохранить"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
