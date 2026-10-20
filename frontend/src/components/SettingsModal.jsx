import React, { useEffect, useState } from 'react';
import {
  X,
  Save,
  Sliders,
  CheckCircle,
  HardDrive,
  Palette,
  Flame,
  TrendingUp,
  Layers,
  Radar
} from 'lucide-react';
import AIEngineSettings from './AIEngineSettings';

const API_BASE = '/api';
const TIMEFRAMES = ['1m', '5m', '15m', '30m', '45m', '1h', '4h', '6h'];
const OVERRIDE_COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'XRPUSDT', 'BNBUSDT'];

export const DEFAULT_UI_CONFIG = {
  theme: 'tealstreet', // 'tealstreet' | 'tiger' | 'bloomberg'
  fontFamily: 'JetBrains Mono', // 'JetBrains Mono' | 'Roboto Mono' | 'Fira Code' | 'Consolas'
  gridOpacity: 0.22, // 0.05 .. 0.60
  candleOpacity: 1.0, // 0.40 .. 1.00
  emaEnabled: true,
  emaPeriods: [9, 21, 50],
  emaColors: ['#38bdf8', '#f59e0b', '#a855f7'],
  emaWidth: 1.5,
  subpanes: {
    vol: true,
    cvd: true,
    rsi: false,
    macd: false
  },
  pricePrecision: 'auto', // 'auto' | 1 | 2 | 4 | 6
  tickStep: 1, // 1 | 2 | 5 | 10 | 50 | 100
  densityThresholdUsd: 50000,
  tapeMinUsd: 5000,
  wallLifetimeSec: 60,
  spoofDistancePct: 0.35,
  fillRatio: 0.5
};

export const THEME_PRESETS = {
  tealstreet: {
    id: 'tealstreet',
    name: 'Tealstreet Pro',
    badge: 'Default',
    desc: 'Глубокий тёмно-серый графит (#08090c), приглушённые свечи, тонкая сетка.',
    bgRoot: '#08090c',
    bgPanel: '#0c0e12',
    bgHeader: '#101217',
    border: '#161820',
    textMain: '#d1d4dc',
    bull: '#26a69a',
    bear: '#ef5350',
    accent: '#38bdf8',
    gridRgb: '22, 26, 38'
  },
  tiger: {
    id: 'tiger',
    name: 'Tiger Deep Dark',
    badge: 'Pro Flow',
    desc: 'Ультратёмный обсидиан (#030406), контрастные уровни, неоновая подсветка объёмов.',
    bgRoot: '#030406',
    bgPanel: '#06080c',
    bgHeader: '#0a0d14',
    border: '#141c2b',
    textMain: '#e2e8f0',
    bull: '#00f5d4',
    bear: '#ff2a6d',
    accent: '#00e5ff',
    gridRgb: '0, 229, 255'
  },
  bloomberg: {
    id: 'bloomberg',
    name: 'Bloomberg Terminal',
    badge: 'Amber',
    desc: 'Классический янтарно-чёрный монохром (#000000), высокая контрастность цифр.',
    bgRoot: '#000000',
    bgPanel: '#050505',
    bgHeader: '#0c0b08',
    border: '#332400',
    textMain: '#ff9800',
    bull: '#00e676',
    bear: '#ff3d00',
    accent: '#fbbf24',
    gridRgb: '255, 152, 0'
  }
};

export const MONO_FONTS = [
  { id: 'JetBrains Mono', label: 'JetBrains Mono', stack: "'JetBrains Mono', Consolas, monospace" },
  { id: 'Roboto Mono', label: 'Roboto Mono', stack: "'Roboto Mono', Consolas, monospace" },
  { id: 'Fira Code', label: 'Fira Code', stack: "'Fira Code', Consolas, monospace" },
  { id: 'Consolas', label: 'Consolas', stack: "Consolas, 'Courier New', monospace" }
];

export function loadLocalUiConfig() {
  try {
    const raw = localStorage.getItem('signalscript_ui_config');
    const savedTheme = localStorage.getItem('signalscript_theme');
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      ...DEFAULT_UI_CONFIG,
      ...parsed,
      theme: parsed.theme || savedTheme || DEFAULT_UI_CONFIG.theme,
      subpanes: {
        ...DEFAULT_UI_CONFIG.subpanes,
        ...(parsed.subpanes || {})
      },
      emaPeriods: Array.isArray(parsed.emaPeriods) && parsed.emaPeriods.length === 3
        ? parsed.emaPeriods
        : DEFAULT_UI_CONFIG.emaPeriods,
      emaColors: Array.isArray(parsed.emaColors) && parsed.emaColors.length === 3
        ? parsed.emaColors
        : DEFAULT_UI_CONFIG.emaColors
    };
  } catch (_) {
    return { ...DEFAULT_UI_CONFIG };
  }
}

export function applyUiConfigToDOM(cfg) {
  if (typeof document === 'undefined') return;
  const merged = { ...DEFAULT_UI_CONFIG, ...(cfg || {}) };
  const preset = THEME_PRESETS[merged.theme] || THEME_PRESETS.tealstreet;
  const root = document.documentElement;

  root.setAttribute('data-theme', preset.id);
  root.style.setProperty('--bg-root', preset.bgRoot);
  root.style.setProperty('--bg-panel', preset.bgPanel);
  root.style.setProperty('--bg-panel-header', preset.bgHeader);
  root.style.setProperty('--border-subtle', preset.border);
  root.style.setProperty('--text-main', preset.textMain);
  root.style.setProperty('--color-bull', preset.bull);
  root.style.setProperty('--color-bear', preset.bear);
  root.style.setProperty('--color-accent', preset.accent);
  root.style.setProperty('--grid-rgb', preset.gridRgb);
  root.style.setProperty('--grid-opacity', String(merged.gridOpacity ?? 0.22));
  root.style.setProperty('--candle-opacity', String(merged.candleOpacity ?? 1.0));

  const fontObj = MONO_FONTS.find(f => f.id === merged.fontFamily) || MONO_FONTS[0];
  root.style.setProperty('--font-mono', fontObj.stack);

  try {
    localStorage.setItem('signalscript_ui_config', JSON.stringify(merged));
    localStorage.setItem('signalscript_theme', preset.id);
  } catch (_) {}
}

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
        style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-subtle)', color: 'var(--text-main)' }}
        className="border rounded-lg w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] text-xs font-sans"
      >
        {/* Header */}
        <div
          style={{ backgroundColor: 'var(--bg-panel-header)', borderColor: 'var(--border-subtle)' }}
          className="flex items-center justify-between px-4 py-2.5 border-b"
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
            { id: 'ai', label: 'AI Engine', icon: Flame }
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
          {activeTab === 'appearance' && (
            <div className="space-y-4">
              <div>
                <label className="block text-white font-bold mb-2 text-xs">
                  Цветовая тема терминала:
                </label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  {Object.values(THEME_PRESETS).map(preset => {
                    const isSelected = cfg.theme === preset.id;
                    return (
                      <div
                        key={preset.id}
                        onClick={() => updateUi({ theme: preset.id })}
                        style={{ backgroundColor: preset.bgPanel }}
                        className={`p-3 rounded-md border cursor-pointer transition flex flex-col justify-between ${
                          isSelected
                            ? 'border-[#38bdf8] ring-1 ring-[#38bdf8]/50 shadow-lg'
                            : 'border-[#1f2430] opacity-75 hover:opacity-100 hover:border-[#2e3646]'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-xs" style={{ color: preset.textMain }}>
                              {preset.name}
                            </span>
                            <span
                              className="text-[9px] px-1.5 py-0.2 rounded font-bold"
                              style={{ backgroundColor: `${preset.accent}22`, color: preset.accent }}
                            >
                              {preset.badge}
                            </span>
                          </div>
                          <p className="text-[10px] text-[#787f91] leading-snug">{preset.desc}</p>
                        </div>

                        {/* Swatches preview */}
                        <div className="flex items-center space-x-1.5 mt-2.5 pt-2 border-t border-[#161922]">
                          <span className="w-3.5 h-3.5 rounded-xs border border-white/20" style={{ backgroundColor: preset.bgRoot }} title="Фон" />
                          <span className="w-3.5 h-3.5 rounded-xs" style={{ backgroundColor: preset.bull }} title="Покупки (Bull)" />
                          <span className="w-3.5 h-3.5 rounded-xs" style={{ backgroundColor: preset.bear }} title="Продажи (Bear)" />
                          <span className="w-3.5 h-3.5 rounded-xs" style={{ backgroundColor: preset.accent }} title="Акцент" />
                          {isSelected && <span className="ml-auto text-[10px] text-[#38bdf8] font-bold">✓ Активна</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="h-px bg-[#1b212f]" />

              {/* Monospace Font Selector */}
              <div>
                <label className="block text-white font-bold mb-1.5 text-xs">
                  Моноширинный шрифт для котировок, шкалы и стакана:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {MONO_FONTS.map(f => {
                    const active = cfg.fontFamily === f.id;
                    return (
                      <button
                        key={f.id}
                        onClick={() => updateUi({ fontFamily: f.id })}
                        style={{ fontFamily: f.stack }}
                        className={`p-2 rounded border text-left transition ${
                          active
                            ? 'bg-[#17253b] border-[#38bdf8] text-white font-bold'
                            : 'bg-[#10131a] border-[#1f2430] text-[#848e9c] hover:text-white'
                        }`}
                      >
                        <div className="text-[11px] truncate">{f.label}</div>
                        <div className="text-[10px] text-[#38bdf8] mt-0.5">81,462.50</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="h-px bg-[#1b212f]" />

              {/* Opacity Sliders: Grid & Candles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-2.5 rounded bg-[#10131a] border border-[#1b212f] space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-white font-semibold text-[11px]">Прозрачность сетки графика:</span>
                    <span className="text-[#38bdf8] font-bold">{Math.round((cfg.gridOpacity ?? 0.22) * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.04"
                    max="0.60"
                    step="0.02"
                    value={cfg.gridOpacity ?? 0.22}
                    onChange={e => updateUi({ gridOpacity: parseFloat(e.target.value) })}
                    className="w-full accent-[#38bdf8]"
                  />
                  <div className="text-[9.5px] text-[#60697b]">
                    Регулирует контраст линий сетки KLineCharts
                  </div>
                </div>

                <div className="p-2.5 rounded bg-[#10131a] border border-[#1b212f] space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-white font-semibold text-[11px]">Яркость свечей (Opacity):</span>
                    <span className="text-[#26a69a] font-bold">{Math.round((cfg.candleOpacity ?? 1.0) * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.40"
                    max="1.00"
                    step="0.05"
                    value={cfg.candleOpacity ?? 1.0}
                    onChange={e => updateUi({ candleOpacity: parseFloat(e.target.value) })}
                    className="w-full accent-[#26a69a]"
                  />
                  <div className="text-[9.5px] text-[#60697b]">
                    Приглушает тело свечей для акцента на кластерах и плотностях
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CHARTS & INDICATORS */}
          {activeTab === 'charts' && (
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
          )}

          {/* TAB 3: ORDER FLOW & ORDERBOOK */}
          {activeTab === 'orderflow' && (
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
                  <input
                    type="range"
                    min="10"
                    max="300"
                    step="10"
                    value={cfg.wallLifetimeSec || 60}
                    onChange={e => updateUi({ wallLifetimeSec: parseInt(e.target.value, 10) })}
                    className="w-full accent-[#ffb300]"
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
                  <input
                    type="range"
                    min="0.10"
                    max="1.00"
                    step="0.05"
                    value={cfg.spoofDistancePct ?? 0.35}
                    onChange={e => updateUi({ spoofDistancePct: parseFloat(e.target.value) })}
                    className="w-full accent-[#f43f5e]"
                  />
                  <div className="text-[9.5px] text-[#60697b]">
                    Снятие крупной стенки без объёма в ленте ближе этого порога помечается как СПУФ
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: SCANNER, NORMALIZATION & STORAGE */}
          {activeTab === 'scanner' && settings && (
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
                          settings.timeframe === tf ? 'bg-[#2563eb] text-white' : 'bg-[#121620] text-[#848e9c]'
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
                    className="w-full bg-[#121620] border border-[#1b212f] rounded px-2 py-1.5 text-white font-mono"
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
                  <input
                    type="number"
                    step="0.5"
                    value={settings.price_change_min ?? 2.5}
                    onChange={e => handleChange('price_change_min', parseFloat(e.target.value))}
                    className="w-full bg-[#0c0e12] border border-[#1f2430] rounded px-1.5 py-0.5 text-white mt-1"
                  />
                </div>
                <div className="p-2 rounded bg-[#121620] border border-[#1b212f]">
                  <div className="text-[10px] text-[#848e9c]">Всплеск объёма (×MA20)</div>
                  <input
                    type="number"
                    step="0.1"
                    value={settings.vol_spike_mult ?? 2.0}
                    onChange={e => handleChange('vol_spike_mult', parseFloat(e.target.value))}
                    className="w-full bg-[#0c0e12] border border-[#1f2430] rounded px-1.5 py-0.5 text-white mt-1"
                  />
                </div>
                <div className="p-2 rounded bg-[#121620] border border-[#1b212f]">
                  <div className="text-[10px] text-[#848e9c]">Порог ликвидаций ($)</div>
                  <input
                    type="number"
                    step="5000"
                    value={settings.liquidation_min_usd ?? 50000}
                    onChange={e => handleChange('liquidation_min_usd', parseFloat(e.target.value))}
                    className="w-full bg-[#0c0e12] border border-[#1f2430] rounded px-1.5 py-0.5 text-white mt-1"
                  />
                </div>
              </div>

              {/* Per-coin overrides */}
              <div className="p-2.5 rounded bg-[#121620] border border-[#1b212f] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-white font-bold text-[11px]">Переопределение параметров по монетам:</span>
                  <div className="flex space-x-1">
                    {OVERRIDE_COINS.map(c => (
                      <button
                        key={c}
                        onClick={() => setSelectedCoin(c)}
                        className={`px-1.5 py-0.5 rounded text-[10px] ${
                          selectedCoin === c ? 'bg-[#2563eb] text-white font-bold' : 'bg-[#0c0e12] text-[#787f91]'
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
                    <input
                      type="number"
                      placeholder="20"
                      value={currentCoinCfg.ema_period || ''}
                      onChange={e =>
                        handleCoinOverrideChange(
                          selectedCoin,
                          'ema_period',
                          e.target.value ? parseInt(e.target.value, 10) : undefined
                        )
                      }
                      className="w-full bg-[#0c0e12] border border-[#1f2430] rounded px-2 py-0.5 text-white mt-0.5"
                    />
                  </div>
                  <div>
                    <span className="text-[#787f91]">Множитель объёма #{selectedCoin}:</span>
                    <input
                      type="number"
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
                      className="w-full bg-[#0c0e12] border border-[#1f2430] rounded px-2 py-0.5 text-white mt-0.5"
                    />
                  </div>
                </div>
              </div>

              {/* Parquet Storage */}
              <div className="flex items-center justify-between p-2.5 rounded bg-[#121620] border border-[#1b212f]">
                <div className="flex items-center space-x-2">
                  <HardDrive size={14} className="text-[#38bdf8]" />
                  <div>
                    <div className="text-white font-bold text-[11px]">Хранилище Parquet (FIFO)</div>
                    <div className="text-[10px] text-[#787f91]">Путь: {settings.storage_path || 'data/recorded'}</div>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-[10px] text-[#848e9c]">Лимит GB:</span>
                  <input
                    type="number"
                    value={settings.storage_max_gb ?? 100}
                    onChange={e => handleChange('storage_max_gb', parseFloat(e.target.value))}
                    className="w-16 bg-[#0c0e12] border border-[#1f2430] rounded px-1.5 py-0.5 text-right text-white"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ai' && <AIEngineSettings onConfigChange={onAiConfigChange} />}
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
