import React, { useEffect, useState } from 'react';
import {
  X,
  Save,
  Sliders,
  CheckCircle,
  Palette,
  Flame,
  TrendingUp,
  Layers,
  Radar,
  Scale
} from 'lucide-react';
import AIEngineSettings from './AIEngineSettings';
import ConfluenceWeightsEditor from './ConfluenceWeightsEditor';
import { DEFAULT_UI_CONFIG, applyUiConfigToDOM } from './settings/uiConfig';
import AppearanceTab from './settings/AppearanceTab';
import ChartsTab from './settings/ChartsTab';
import OrderflowTab from './settings/OrderflowTab';
import ScannerTab from './settings/ScannerTab';

const API_BASE = '/api';

// Реэкспорт uiConfig-хелперов — существующие импортёры (App.jsx: loadLocalUiConfig/applyUiConfigToDOM)
// продолжают работать по старому пути './components/SettingsModal'.
export {
  DEFAULT_UI_CONFIG,
  THEME_PRESETS,
  MONO_FONTS,
  loadLocalUiConfig,
  applyUiConfigToDOM
} from './settings/uiConfig';

export default function SettingsModal({
  isOpen,
  onClose,
  userId = '0',
  uiConfig,
  onUiConfigChange,
  onAiConfigChange
}) {
  const [settings, setSettings] = useState(null);
  const [activeTab, setActiveTab] = useState('appearance'); // appearance | charts | orderflow | scanner | ai
  const [selectedCoin, setSelectedCoin] = useState('BTCUSDT');
  const [coinOverrides, setCoinOverrides] = useState({});
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const cfg = { ...DEFAULT_UI_CONFIG, ...(uiConfig || {}) };

  useEffect(() => {
    if (isOpen) {
      fetch(`${API_BASE}/settings?user_id=${userId}`)
        .then(res => res.json())
        .then(data => {
          setSettings(data);
          try {
            const parsed = JSON.parse(data.coin_overrides || '{}');
            setCoinOverrides(parsed);
          } catch (_) {
            setCoinOverrides({});
          }
          if (data.ui_config) {
            try {
              const serverUi = JSON.parse(data.ui_config);
              if (serverUi && Object.keys(serverUi).length > 0 && onUiConfigChange) {
                const next = {
                  ...cfg,
                  ...serverUi,
                  theme: data.theme || serverUi.theme || cfg.theme
                };
                onUiConfigChange(next);
              }
            } catch (_) {}
          }
        })
        .catch(err => console.error('Error loading settings:', err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, userId]);

  if (!isOpen) return null;

  const updateUi = (patch) => {
    const next = {
      ...cfg,
      ...patch,
      subpanes: patch.subpanes ? { ...cfg.subpanes, ...patch.subpanes } : cfg.subpanes
    };
    applyUiConfigToDOM(next);
    if (onUiConfigChange) onUiConfigChange(next);
    if (patch.theme && settings) {
      setSettings(prev => (prev ? { ...prev, theme: patch.theme } : prev));
    }
  };

  const handleChange = (field, value) => {
    setSettings(prev => (prev ? { ...prev, [field]: value } : { [field]: value }));
  };

  const handleCoinOverrideChange = (coin, field, value) => {
    setCoinOverrides(prev => {
      const nextCoin = { ...(prev[coin] || {}), [field]: value };
      const updated = { ...prev, [coin]: nextCoin };
      setSettings(s => (s ? { ...s, coin_overrides: JSON.stringify(updated) } : s));
      return updated;
    });
  };

  const handleSave = () => {
    setIsSaving(true);
    applyUiConfigToDOM(cfg);

    const payload = {
      ...(settings || { user_id: userId }),
      user_id: userId,
      theme: cfg.theme,
      orderbook_tick_scale: Number(cfg.tickStep) || 1.0,
      coin_overrides: JSON.stringify(coinOverrides),
      ui_config: JSON.stringify(cfg)
    };

    fetch(`${API_BASE}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(saved => {
        setSettings(saved);
        setIsSaving(false);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
      })
      .catch(() => setIsSaving(false));
  };

  const currentCoinCfg = coinOverrides[selectedCoin] || {};

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-3 select-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="border border-border/80 rounded bg-card text-foreground w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] text-xs font-sans"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-2.5 border-b border-border/70 bg-card/95"
        >
          <div className="flex items-center space-x-2 font-bold text-white text-xs">
            <Sliders size={14} className="text-[#38bdf8]" />
            <span>Центр настроек терминала SignalScript</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#14171f] text-[#787f91] border border-[#1f2430]">
              Клавиша [ , ]
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#161820] text-[#787f91] hover:text-white transition"
          >
            <X size={15} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          style={{ backgroundColor: 'var(--bg-root)', borderColor: 'var(--border-subtle)' }}
          className="flex border-b px-2 text-[11px] font-mono overflow-x-auto"
        >
          {[
            { id: 'appearance', label: 'Внешний вид & Тема', icon: Palette },
            { id: 'charts', label: 'Графики & Индикаторы', icon: TrendingUp },
            { id: 'orderflow', label: 'Order Flow & Стакан', icon: Layers },
            { id: 'scanner', label: 'Сканер & Диск', icon: Radar },
            { id: 'ai', label: 'AI Engine', icon: Flame },
            { id: 'confluence', label: 'Confluence', icon: Scale }
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-1.5 px-3 py-2 border-b-2 font-semibold whitespace-nowrap transition ${
                  active
                    ? 'border-[#38bdf8] text-[#38bdf8]'
                    : 'border-transparent text-[#787f91] hover:text-white'
                }`}
              >
                <Icon size={12} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto space-y-4 font-mono flex-1 text-xs">
          {/* TAB 1: APPEARANCE & THEME */}
          {activeTab === 'appearance' && <AppearanceTab cfg={cfg} updateUi={updateUi} />}

          {/* TAB 2: CHARTS & INDICATORS */}
          {activeTab === 'charts' && <ChartsTab cfg={cfg} updateUi={updateUi} />}

          {/* TAB 3: ORDER FLOW & ORDERBOOK */}
          {activeTab === 'orderflow' && <OrderflowTab cfg={cfg} updateUi={updateUi} />}

          {/* TAB 4: SCANNER, NORMALIZATION & STORAGE */}
          {activeTab === 'scanner' && settings && (
            <ScannerTab
              settings={settings}
              handleChange={handleChange}
              selectedCoin={selectedCoin}
              setSelectedCoin={setSelectedCoin}
              currentCoinCfg={currentCoinCfg}
              handleCoinOverrideChange={handleCoinOverrideChange}
            />
          )}

          {activeTab === 'ai' && <AIEngineSettings onConfigChange={onAiConfigChange} />}

          {activeTab === 'confluence' && <ConfluenceWeightsEditor />}
        </div>

        {/* Footer */}
        <div
          style={{ backgroundColor: 'var(--bg-panel-header)', borderColor: 'var(--border-subtle)' }}
          className="flex items-center justify-between px-4 py-2.5 border-t"
        >
          {saveSuccess ? (
            <span className="text-[#26a69a] font-semibold flex items-center space-x-1 font-mono text-[11px]">
              <CheckCircle size={13} className="mr-1" />
              Сохранено в localStorage и SQLite (user_settings)!
            </span>
          ) : (
            <span className="text-[#787f91] font-mono text-[10.5px]">
              Изменения применяются на лету • Синхронизация с SQLite
            </span>
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
              {isSaving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
