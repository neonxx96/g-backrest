import React, { useEffect, useState } from 'react';
import { X, Save, Sliders, Bell, CheckCircle } from 'lucide-react';

const API_BASE = "/api";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 select-none">
      <div className="bg-[#0c0e12] border border-[#1f2430] rounded-lg w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh] text-xs text-[#d1d4dc] font-sans">
        {/* Header */}
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#101217] border-b border-[#161820]">
          <div className="flex items-center space-x-2 font-bold text-white text-xs">
            <Sliders size={14} className="text-[#38bdf8]" />
            <span>Настройки сканера и фильтров</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#161820] text-[#787f91] hover:text-white transition">
            <X size={15} />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-3.5 overflow-y-auto space-y-3.5 font-mono">
          {/* Timeframe */}
          <div>
            <label className="block text-[#848e9c] mb-1 font-semibold">Базовый таймфрейм сканирования:</label>
            <div className="grid grid-cols-4 gap-1.5">
              {TIMEFRAMES.map(tf => (
                <button
                  key={tf}
                  onClick={() => handleChange('timeframe', tf)}
                  className={`py-1.5 rounded font-mono font-semibold transition ${settings.timeframe === tf ? 'bg-[#2563eb] text-white' : 'bg-[#121620] hover:bg-[#1a2130] text-[#848e9c]'}`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          <div className="h-px bg-[#1b212f]" />

          {/* 24h Price Change */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white">Изменение цены 24ч (мин. %):</span>
              <input
                type="checkbox"
                checked={settings.price_change_enabled}
                onChange={e => handleChange('price_change_enabled', e.target.checked)}
                className="w-4 h-4 accent-[#2563eb]"
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
                className="flex-1 accent-[#2563eb]"
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
                className="w-4 h-4 accent-[#2563eb]"
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
                className="flex-1 accent-[#2563eb]"
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
                className="w-4 h-4 accent-[#2563eb]"
              />
            </div>
            <input
              type="number"
              step="10000"
              value={settings.liquidation_min_usd}
              onChange={e => handleChange('liquidation_min_usd', parseFloat(e.target.value))}
              className="w-full bg-[#121620] border border-[#1b212f] rounded px-2 py-1 font-mono text-white"
            />
          </div>

          <div className="h-px bg-[#1b212f]" />

          {/* EMA(20) Cross */}
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white">Сигнал пересечения свечой EMA(20):</span>
            <input
              type="checkbox"
              checked={settings.ema_cross_enabled}
              onChange={e => handleChange('ema_cross_enabled', e.target.checked)}
              className="w-4 h-4 accent-[#2563eb]"
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
                className="w-4 h-4 accent-[#2563eb]"
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
                className="flex-1 accent-[#2563eb]"
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
                className="w-4 h-4 accent-[#2563eb]"
              />
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="number"
                value={settings.rsi_min}
                onChange={e => handleChange('rsi_min', parseFloat(e.target.value))}
                className="w-1/2 bg-[#121620] border border-[#1b212f] rounded px-2 py-1 font-mono text-white text-center"
                placeholder="RSI Min"
              />
              <input
                type="number"
                value={settings.rsi_max}
                onChange={e => handleChange('rsi_max', parseFloat(e.target.value))}
                className="w-1/2 bg-[#121620] border border-[#1b212f] rounded px-2 py-1 font-mono text-white text-center"
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
                className="flex-1 accent-[#2563eb]"
              />
              <span className="font-mono w-16 text-right font-bold text-white">
                {settings.cooldown_minutes} мин
              </span>
            </div>
          </div>

          {/* Notifications Toggle */}
          <div className="flex items-center justify-between p-2.5 rounded bg-[#121620] border border-[#1b212f]">
            <div className="flex items-center space-x-2">
              <Bell size={14} className="text-[#00c087]" />
              <span className="font-semibold text-white">Отправлять в Telegram бот:</span>
            </div>
            <input
              type="checkbox"
              checked={settings.notifications_enabled}
              onChange={e => handleChange('notifications_enabled', e.target.checked)}
              className="w-4 h-4 accent-[#00c087]"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#101217] border-t border-[#161820]">
          {saveSuccess ? (
            <span className="text-[#26a69a] font-semibold flex items-center space-x-1 font-mono text-[11px]">
              <CheckCircle size={13} className="mr-1" />
              Применено без перезапуска!
            </span>
          ) : (
            <span className="text-[#60697b] font-mono text-[10px]">Применяется моментально</span>
          )}

          <div className="flex space-x-2">
            <button
              onClick={onClose}
              className="px-3 py-1 rounded bg-[#161820] hover:bg-[#1f2430] text-[#d1d4dc] font-mono text-xs transition"
            >
              Отмена
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-3.5 py-1 rounded bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-mono text-xs font-semibold flex items-center space-x-1 transition"
            >
              <Save size={12} className="mr-1" />
              {isSaving ? "Сохранение..." : "Сохранить"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
