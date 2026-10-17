import React, { useEffect, useState } from 'react';
import { X, Save, Sliders, Bell, CheckCircle, Database, HardDrive, Cpu, Palette, Flame } from 'lucide-react';

const API_BASE = "/api";
const TIMEFRAMES = ["1m", "5m", "15m", "30m", "45m", "1h", "4h", "6h"];
const OVERRIDE_COINS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "XRPUSDT", "BNBUSDT"];

export default function SettingsModal({ isOpen, onClose, userId = "0" }) {
  const [settings, setSettings] = useState(null);
  const [activeTab, setActiveTab] = useState("filters"); // filters, heatmap, coins, theme
  const [selectedCoin, setSelectedCoin] = useState("BTCUSDT");
  const [coinOverrides, setCoinOverrides] = useState({});
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetch(`${API_BASE}/settings?user_id=${userId}`)
        .then(res => res.json())
        .then(data => {
          setSettings(data);
          try {
            const parsed = JSON.parse(data.coin_overrides || "{}");
            setCoinOverrides(parsed);
          } catch (_) {
            setCoinOverrides({});
          }
        })
        .catch(err => console.error("Error loading settings:", err));
    }
  }, [isOpen, userId]);

  if (!isOpen || !settings) return null;

  const handleChange = (field, value) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleCoinOverrideChange = (coin, field, value) => {
    setCoinOverrides(prev => {
      const nextCoin = { ...(prev[coin] || {}), [field]: value };
      const updated = { ...prev, [coin]: nextCoin };
      setSettings(s => ({ ...s, coin_overrides: JSON.stringify(updated) }));
      return updated;
    });
  };

  const handleSave = () => {
    setIsSaving(true);
    const payload = {
      ...settings,
      coin_overrides: JSON.stringify(coinOverrides)
    };

    fetch(`${API_BASE}/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(saved => {
      setSettings(saved);
      setIsSaving(false);
      setSaveSuccess(true);
      if (saved.theme) {
        document.documentElement.setAttribute('data-theme', saved.theme);
        localStorage.setItem('app_theme', saved.theme);
      }
      setTimeout(() => setSaveSuccess(false), 2000);
    })
    .catch(() => setIsSaving(false));
  };

  const currentCoinCfg = coinOverrides[selectedCoin] || {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 select-none">
      <div className="bg-[#0c0e12] border border-[#1f2430] rounded-lg w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] text-xs text-[#d1d4dc] font-sans">
        {/* Header */}
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#101217] border-b border-[#161820]">
          <div className="flex items-center space-x-2 font-bold text-white text-xs">
            <Sliders size={14} className="text-[#38bdf8]" />
            <span>Параметры терминала и сканера</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#161820] text-[#787f91] hover:text-white transition">
            <X size={15} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#161820] bg-[#0e1015] px-2 text-[11px] font-mono">
          <button
            onClick={() => setActiveTab("filters")}
            className={`px-3 py-2 border-b-2 font-semibold transition ${activeTab === 'filters' ? 'border-[#38bdf8] text-[#38bdf8]' : 'border-transparent text-[#787f91] hover:text-white'}`}
          >
            Фильтры
          </button>
          <button
            onClick={() => setActiveTab("normalization")}
            className={`px-3 py-2 border-b-2 font-semibold transition ${activeTab === 'normalization' ? 'border-[#38bdf8] text-[#38bdf8]' : 'border-transparent text-[#787f91] hover:text-white'}`}
          >
            Нормализация
          </button>
          <button
            onClick={() => setActiveTab("heatmap")}
            className={`px-3 py-2 border-b-2 font-semibold transition ${activeTab === 'heatmap' ? 'border-[#38bdf8] text-[#38bdf8]' : 'border-transparent text-[#787f91] hover:text-white'}`}
          >
            Плотности и Диск
          </button>
          <button
            onClick={() => setActiveTab("coins")}
            className={`px-3 py-2 border-b-2 font-semibold transition ${activeTab === 'coins' ? 'border-[#38bdf8] text-[#38bdf8]' : 'border-transparent text-[#787f91] hover:text-white'}`}
          >
            По монетам
          </button>
          <button
            onClick={() => setActiveTab("theme")}
            className={`px-3 py-2 border-b-2 font-semibold transition ${activeTab === 'theme' ? 'border-[#38bdf8] text-[#38bdf8]' : 'border-transparent text-[#787f91] hover:text-white'}`}
          >
            Тема
          </button>
        </div>

        {/* Form Body */}
        <div className="p-3.5 overflow-y-auto space-y-3 font-mono flex-1 text-xs">
          {activeTab === "filters" && (
            <>
              {/* Timeframe */}
              <div>
                <label className="block text-[#848e9c] mb-1 font-semibold">Базовый таймфрейм сканирования:</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {TIMEFRAMES.map(tf => (
                    <button
                      key={tf}
                      onClick={() => handleChange('timeframe', tf)}
                      className={`py-1 rounded font-mono font-semibold transition ${settings.timeframe === tf ? 'bg-[#2563eb] text-white' : 'bg-[#121620] hover:bg-[#1a2130] text-[#848e9c]'}`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-px bg-[#1b212f]" />

              {/* 24h Price Change */}
              <div className="space-y-1">
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
              <div className="space-y-1">
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
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white">Порог ликвидаций (маркеры и фильтр $):</span>
                  <input
                    type="checkbox"
                    checked={settings.liquidation_enabled}
                    onChange={e => handleChange('liquidation_enabled', e.target.checked)}
                    className="w-4 h-4 accent-[#2563eb]"
                  />
                </div>
                <input
                  type="number"
                  step="5000"
                  value={settings.liquidation_min_usd}
                  onChange={e => handleChange('liquidation_min_usd', parseFloat(e.target.value))}
                  className="w-full bg-[#121620] border border-[#1b212f] rounded px-2 py-1 font-mono text-white"
                />
              </div>

              <div className="h-px bg-[#1b212f]" />

              {/* EMA & Vol Spike */}
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">Сигнал пересечения EMA:</span>
                <input
                  type="checkbox"
                  checked={settings.ema_cross_enabled}
                  onChange={e => handleChange('ema_cross_enabled', e.target.checked)}
                  className="w-4 h-4 accent-[#2563eb]"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white">Всплеск объема (множитель xN):</span>
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

              {/* Cooldown */}
              <div className="space-y-1">
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
            </>
          )}

          {activeTab === "normalization" && (
            <div className="space-y-3">
              <div>
                <label className="block text-white font-bold mb-1">Режим нормализации значений индикаторов:</label>
                <p className="text-[11px] text-[#787f91] mb-2 leading-relaxed">
                  Определяет, в каком виде отображаются метрики индикаторов (всплеск объема, RSI, VWAP) в карточках ленты сигналов.
                </p>

                <div className="space-y-2">
                  {[
                    { id: 'raw', title: 'Обычный (Сырое значение)', desc: 'Стандартные величины (2.4x MA, RSI 74, -1.2% dev)' },
                    { id: 'atr_pct', title: 'В процентах от ATR', desc: 'Относительно текущего диапазона волатильности (e.g. 145% ATR)' },
                    { id: 'z_score', title: 'Z-Score (Отклонение в σ)', desc: 'Статистическое число стандартных отклонений от скользящей средней (e.g. z: +2.8σ)' },
                    { id: 'percentile', title: 'Перцентиль окна (0-100%)', desc: 'Ранг текущего значения среди последних баров (e.g. pct: 95%)' },
                  ].map(opt => (
                    <label
                      key={opt.id}
                      onClick={() => handleChange('normalization_mode', opt.id)}
                      className={`flex items-start space-x-3 p-2.5 rounded border cursor-pointer transition ${settings.normalization_mode === opt.id ? 'bg-[#1e293b] border-[#38bdf8] text-white' : 'bg-[#121620] border-[#1b212f] text-[#848e9c] hover:border-[#2a3449]'}`}
                    >
                      <input
                        type="radio"
                        name="normalization_mode"
                        checked={settings.normalization_mode === opt.id}
                        onChange={() => handleChange('normalization_mode', opt.id)}
                        className="mt-0.5 accent-[#38bdf8]"
                      />
                      <div>
                        <div className="font-semibold text-white text-xs">{opt.title}</div>
                        <div className="text-[10px] text-[#787f91] mt-0.5">{opt.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === "heatmap" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-2 rounded bg-[#121620] border border-[#1b212f]">
                <div className="flex items-center space-x-2">
                  <Flame size={14} className="text-[#ff9800]" />
                  <span className="font-semibold text-white">Тепловая карта плотностей (Heatmap):</span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.heatmap_enabled}
                  onChange={e => handleChange('heatmap_enabled', e.target.checked)}
                  className="w-4 h-4 accent-[#ff9800]"
                />
              </div>

              <div>
                <label className="block text-[#848e9c] mb-1 font-semibold">Порог плотности для тепловой карты (USDT):</label>
                <input
                  type="number"
                  step="10000"
                  value={settings.heatmap_min_usd}
                  onChange={e => handleChange('heatmap_min_usd', parseFloat(e.target.value))}
                  className="w-full bg-[#121620] border border-[#1b212f] rounded px-2 py-1 font-mono text-white"
                />
              </div>

              <div className="h-px bg-[#1b212f]" />

              <div className="flex items-center space-x-2 font-bold text-white text-xs pt-1">
                <HardDrive size={13} className="text-[#38bdf8]" />
                <span>Хранилище Parquet и FIFO Автоочистка</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[#848e9c] mb-1">Лимит места (GB):</label>
                  <input
                    type="number"
                    step="5"
                    min="10"
                    max="1000"
                    value={settings.storage_max_gb}
                    onChange={e => handleChange('storage_max_gb', parseFloat(e.target.value))}
                    className="w-full bg-[#121620] border border-[#1b212f] rounded px-2 py-1 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-[#848e9c] mb-1">Дней хранения (FIFO):</label>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={settings.storage_retention_days}
                    onChange={e => handleChange('storage_retention_days', parseInt(e.target.value))}
                    className="w-full bg-[#121620] border border-[#1b212f] rounded px-2 py-1 font-mono text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[#848e9c] mb-1">Путь к хранилищу на сервере:</label>
                <input
                  type="text"
                  value={settings.storage_path || "data/recorded"}
                  onChange={e => handleChange('storage_path', e.target.value)}
                  className="w-full bg-[#121620] border border-[#1b212f] rounded px-2 py-1 font-mono text-white text-[11px]"
                />
              </div>
            </div>
          )}

          {activeTab === "coins" && (
            <div className="space-y-3">
              <div>
                <label className="block text-[#848e9c] mb-1 font-semibold">Выберите монету для переопределения параметров:</label>
                <div className="flex flex-wrap gap-1">
                  {OVERRIDE_COINS.map(coin => {
                    const hasCustom = Boolean(coinOverrides[coin]);
                    return (
                      <button
                        key={coin}
                        onClick={() => setSelectedCoin(coin)}
                        className={`px-2.5 py-1 rounded font-mono text-[11px] font-bold transition flex items-center space-x-1 ${selectedCoin === coin ? 'bg-[#2563eb] text-white' : 'bg-[#121620] text-[#848e9c] hover:bg-[#1a2130]'}`}
                      >
                        <span>{coin}</span>
                        {hasCustom && <span className="w-1.5 h-1.5 rounded-full bg-[#26a69a]" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="p-3 rounded bg-[#121620] border border-[#1b212f] space-y-2">
                <div className="font-bold text-white text-xs border-b border-[#1b212f] pb-1 flex justify-between items-center">
                  <span>Индивидуальные настройки для #{selectedCoin}</span>
                  {coinOverrides[selectedCoin] && (
                    <button
                      onClick={() => {
                        const updated = { ...coinOverrides };
                        delete updated[selectedCoin];
                        setCoinOverrides(updated);
                        setSettings(s => ({ ...s, coin_overrides: JSON.stringify(updated) }));
                      }}
                      className="text-[10px] text-[#ef5350] hover:underline"
                    >
                      Сбросить к общим
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <label className="block text-[#787f91]">Период EMA (общий: 20):</label>
                    <input
                      type="number"
                      placeholder="20"
                      value={currentCoinCfg.ema_period || ""}
                      onChange={e => handleCoinOverrideChange(selectedCoin, 'ema_period', e.target.value ? parseInt(e.target.value) : undefined)}
                      className="w-full bg-[#0c0e12] border border-[#1f2430] rounded px-2 py-1 font-mono text-white mt-0.5"
                    />
                  </div>

                  <div>
                    <label className="block text-[#787f91]">Всплеск объема (общий: {settings.vol_spike_mult}x):</label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder={settings.vol_spike_mult.toString()}
                      value={currentCoinCfg.vol_spike_mult || ""}
                      onChange={e => handleCoinOverrideChange(selectedCoin, 'vol_spike_mult', e.target.value ? parseFloat(e.target.value) : undefined)}
                      className="w-full bg-[#0c0e12] border border-[#1f2430] rounded px-2 py-1 font-mono text-white mt-0.5"
                    />
                  </div>

                  <div>
                    <label className="block text-[#787f91]">RSI Min (общий: {settings.rsi_min}):</label>
                    <input
                      type="number"
                      placeholder={settings.rsi_min.toString()}
                      value={currentCoinCfg.rsi_min || ""}
                      onChange={e => handleCoinOverrideChange(selectedCoin, 'rsi_min', e.target.value ? parseFloat(e.target.value) : undefined)}
                      className="w-full bg-[#0c0e12] border border-[#1f2430] rounded px-2 py-1 font-mono text-white mt-0.5"
                    />
                  </div>

                  <div>
                    <label className="block text-[#787f91]">RSI Max (общий: {settings.rsi_max}):</label>
                    <input
                      type="number"
                      placeholder={settings.rsi_max.toString()}
                      value={currentCoinCfg.rsi_max || ""}
                      onChange={e => handleCoinOverrideChange(selectedCoin, 'rsi_max', e.target.value ? parseFloat(e.target.value) : undefined)}
                      className="w-full bg-[#0c0e12] border border-[#1f2430] rounded px-2 py-1 font-mono text-white mt-0.5"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "theme" && (
            <div className="space-y-3">
              <div>
                <label className="block text-white font-bold mb-1">Стиль интерфейса терминала:</label>
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div
                    onClick={() => {
                      handleChange('theme', 'tealstreet');
                      document.documentElement.removeAttribute('data-theme');
                      localStorage.setItem('app_theme', 'tealstreet');
                    }}
                    className={`p-3 rounded border cursor-pointer transition ${settings.theme !== 'bloomberg' ? 'bg-[#121620] border-[#38bdf8] text-white shadow-lg' : 'bg-[#0c0e12] border-[#1b212f] text-[#787f91] opacity-60 hover:opacity-100'}`}
                  >
                    <div className="font-bold text-xs flex items-center space-x-1.5 text-[#38bdf8]">
                      <span>🌙 Tealstreet</span>
                    </div>
                    <p className="text-[10px] text-[#787f91] mt-1 leading-normal">
                      Матовый тёмно-серый фон (#08090c), приглушённые свечи, бирюзовые и красные акценты.
                    </p>
                  </div>

                  <div
                    onClick={() => {
                      handleChange('theme', 'bloomberg');
                      document.documentElement.setAttribute('data-theme', 'bloomberg');
                      localStorage.setItem('app_theme', 'bloomberg');
                    }}
                    className={`p-3 rounded border cursor-pointer transition ${settings.theme === 'bloomberg' ? 'bg-[#181200] border-[#ff9800] text-[#ff9800] shadow-lg' : 'bg-[#0c0e12] border-[#1b212f] text-[#787f91] opacity-60 hover:opacity-100'}`}
                  >
                    <div className="font-bold text-xs flex items-center space-x-1.5 text-[#ff9800]">
                      <span>⚡ Bloomberg Terminal</span>
                    </div>
                    <p className="text-[10px] text-[#b45309] mt-1 leading-normal">
                      Глубокий чёрный (#000000), яркий янтарно-оранжевый текст, плотная моноширинная сетка.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#101217] border-t border-[#161820]">
          {saveSuccess ? (
            <span className="text-[#26a69a] font-semibold flex items-center space-x-1 font-mono text-[11px]">
              <CheckCircle size={13} className="mr-1" />
              Применено моментально без перезапуска!
            </span>
          ) : (
            <span className="text-[#60697b] font-mono text-[10px]">Все параметры синхронизируются в SQLite</span>
          )}

          <div className="flex space-x-2">
            <button
              onClick={onClose}
              className="px-3 py-1 rounded bg-[#161820] hover:bg-[#1f2430] text-[#d1d4dc] font-mono text-xs transition"
            >
              Закрыть
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
