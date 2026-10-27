import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import React from 'react';
import { HardDrive } from 'lucide-react';
import { TIMEFRAMES, OVERRIDE_COINS } from './constants';

// Вкладка «Сканер & Диск» — управляемая: server-settings + колбэки (логика в SettingsModal).
export default function ScannerTab({
  settings,
  handleChange,
  selectedCoin,
  setSelectedCoin,
  currentCoinCfg,
  handleCoinOverrideChange
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[#848e9c] mb-1 font-semibold">Таймфрейм фонового сканера:</label>
          <div className="grid grid-cols-4 gap-1">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf}
                onClick={() => handleChange('timeframe', tf)}
                className={`py-1 rounded font-mono font-semibold transition ${
                  settings.timeframe === tf ? 'bg-[#2563eb] text-foreground' : 'bg-[#121620] text-[#848e9c]'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[#848e9c] mb-1 font-semibold">Нормализация метрик:</label>
          <select
            value={settings.normalization_mode || 'raw'}
            onChange={e => handleChange('normalization_mode', e.target.value)}
            className="w-full bg-[#121620] border border-[#1b212f] rounded px-2 py-1.5 text-foreground font-mono"
          >
            <option value="raw">Обычный (Raw)</option>
            <option value="atr_pct">В % от ATR</option>
            <option value="z_score">Z-Score (σ)</option>
            <option value="percentile">Перцентиль (0-100%)</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="p-2 rounded bg-[#121620] border border-[#1b212f]">
          <div className="text-[10px] text-[#848e9c]">Мин. изм. цены 24ч (%)</div>
          <NumberInput
            step="0.5"
            value={settings.price_change_min ?? 2.5}
            onChange={e => handleChange('price_change_min', parseFloat(e.target.value))}
            className="w-full bg-[#0c0e12] border border-[#1f2430] rounded px-1.5 py-0.5 text-foreground mt-1"
          />
        </div>
        <div className="p-2 rounded bg-[#121620] border border-[#1b212f]">
          <div className="text-[10px] text-[#848e9c]">Всплеск объёма (×MA20)</div>
          <NumberInput
            step="0.1"
            value={settings.vol_spike_mult ?? 2.0}
            onChange={e => handleChange('vol_spike_mult', parseFloat(e.target.value))}
            className="w-full bg-[#0c0e12] border border-[#1f2430] rounded px-1.5 py-0.5 text-foreground mt-1"
          />
        </div>
        <div className="p-2 rounded bg-[#121620] border border-[#1b212f]">
          <div className="text-[10px] text-[#848e9c]">Порог ликвидаций ($)</div>
          <NumberInput
            step="5000"
            value={settings.liquidation_min_usd ?? 50000}
            onChange={e => handleChange('liquidation_min_usd', parseFloat(e.target.value))}
            className="w-full bg-[#0c0e12] border border-[#1f2430] rounded px-1.5 py-0.5 text-foreground mt-1"
          />
        </div>
      </div>

      {/* Per-coin overrides */}
      <div className="p-2.5 rounded bg-[#121620] border border-[#1b212f] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-foreground font-bold text-[11px]">Переопределение параметров по монетам:</span>
          <div className="flex space-x-1">
            {OVERRIDE_COINS.map(c => (
              <button
                key={c}
                onClick={() => setSelectedCoin(c)}
                className={`px-1.5 py-0.5 rounded text-[10px] ${
                  selectedCoin === c ? 'bg-[#2563eb] text-foreground font-bold' : 'bg-[#0c0e12] text-[#787f91]'
                }`}
              >
                {c.replace('USDT', '')}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10.5px]">
          <div>
            <span className="text-[#787f91]">Период EMA для #{selectedCoin}:</span>
            <NumberInput
              placeholder="20"
              value={currentCoinCfg.ema_period || ''}
              onChange={e =>
                handleCoinOverrideChange(
                  selectedCoin,
                  'ema_period',
                  e.target.value ? parseInt(e.target.value, 10) : undefined
                )
              }
              className="w-full bg-[#0c0e12] border border-[#1f2430] rounded px-2 py-0.5 text-foreground mt-0.5"
            />
          </div>
          <div>
            <span className="text-[#787f91]">Множитель объёма #{selectedCoin}:</span>
            <NumberInput
              step="0.1"
              placeholder="2.0"
              value={currentCoinCfg.vol_spike_mult || ''}
              onChange={e =>
                handleCoinOverrideChange(
                  selectedCoin,
                  'vol_spike_mult',
                  e.target.value ? parseFloat(e.target.value) : undefined
                )
              }
              className="w-full bg-[#0c0e12] border border-[#1f2430] rounded px-2 py-0.5 text-foreground mt-0.5"
            />
          </div>
        </div>
      </div>

      {/* Parquet Storage */}
      <div className="flex items-center justify-between p-2.5 rounded bg-[#121620] border border-[#1b212f]">
        <div className="flex items-center space-x-2">
          <HardDrive size={14} className="text-[#38bdf8]" />
          <div>
            <div className="text-foreground font-bold text-[11px]">Хранилище Parquet (FIFO)</div>
            <div className="text-[10px] text-[#787f91]">Путь: {settings.storage_path || 'data/recorded'}</div>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-[10px] text-[#848e9c]">Лимит GB:</span>
          <NumberInput
            value={settings.storage_max_gb ?? 100}
            onChange={e => handleChange('storage_max_gb', parseFloat(e.target.value))}
            className="w-16 bg-[#0c0e12] border border-[#1f2430] rounded px-1.5 py-0.5 text-right text-foreground"
          />
        </div>
      </div>
    </div>
  );
}
