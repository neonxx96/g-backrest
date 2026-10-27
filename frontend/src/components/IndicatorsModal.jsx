import React, { useState, useEffect } from 'react';
import {
  X,
  Search,
  Sliders,
  Check,
  RotateCcw,
  Layers,
  TrendingUp,
  Activity,
  Flame,
  Zap,
  BarChart2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

export const DEFAULT_INDICATORS_CONFIG = {
  // Order Flow & Liquidity
  cvd: true,
  deltaBars: false,
  oi: false,
  volumeProfile: false,
  walls: true,
  liquidations: true,
  heatmap: false,
  // Trend
  vwap: false,
  ema: true,
  // Oscillators & Risk
  atr: false,
  rsi: false,
  macd: false,
  vol: true
};

export const DEFAULT_INDICATORS_SETTINGS = {
  emaPeriods: [20, 50, 200],
  emaColors: ['#38bdf8', '#f59e0b', '#a855f7'],
  vwapStdDevs: [1.0, 2.0],
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
  atrPeriod: 14,
  atrMultiplier: 1.5,
  minWallUsd: 500000,
  minLiqUsd: 20000
};

export function loadChartIndicators(chartId = 'primary') {
  try {
    const raw = localStorage.getItem(`chart_indicators_${chartId}`);
    if (raw) {
      return { ...DEFAULT_INDICATORS_CONFIG, ...JSON.parse(raw) };
    }
  } catch (_) {}
  return { ...DEFAULT_INDICATORS_CONFIG };
}

export function saveChartIndicators(chartId, config) {
  try {
    localStorage.setItem(`chart_indicators_${chartId}`, JSON.stringify(config));
  } catch (_) {}
}

export default function IndicatorsModal({
  isOpen,
  onClose,
  targetChartId = 'primary',
  onTargetChartChange,
  activeIndicators = {},
  onIndicatorsChange = () => {},
  isDualPane = true
}) {
  const [activeTab, setActiveTab] = useState(targetChartId || 'primary');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [expandedSettings, setExpandedSettings] = useState({});
  const [customSettings, setCustomSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('indicators_advanced_settings');
      return saved ? JSON.parse(saved) : DEFAULT_INDICATORS_SETTINGS;
    } catch (_) {
      return DEFAULT_INDICATORS_SETTINGS;
    }
  });

  useEffect(() => {
    if (targetChartId) {
      setActiveTab(targetChartId);
    }
  }, [targetChartId]);

  if (!isOpen) return null;

  const catalog = [
    // 1. Order Flow & Liquidity
    {
      id: 'cvd',
      name: 'Кумулятивная дельта (CVD)',
      category: 'orderflow',
      desc: 'Накопленная разница между агрессивными рыночными покупками и продажами. Выявляет скрытую аккумуляцию и поглощение ликвидности.',
      badge: 'Order Flow',
      badgeColor: 'text-[#00e5ff] bg-[#00e5ff18] border-[#00e5ff40]'
    },
    {
      id: 'deltaBars',
      name: 'Дельта-бары (Delta Volume)',
      category: 'orderflow',
      desc: 'Гистограмма чистой дельты каждой отдельной свечи (Market Buy Volume - Market Sell Volume).',
      badge: 'Order Flow',
      badgeColor: 'text-[#38bdf8] bg-[#38bdf818] border-[#38bdf840]'
    },
    {
      id: 'oi',
      name: 'Открытый интерес (Open Interest)',
      category: 'orderflow',
      desc: 'Динамика открытых позиций фьючерсов Binance. Позволяет отличать истинный набор позиций от закрытия по стопам.',
      badge: 'Futures',
      badgeColor: 'text-[#f59e0b] bg-[#f59e0b18] border-[#f59e0b40]'
    },
    {
      id: 'volumeProfile',
      name: 'Профиль объема & POC',
      category: 'orderflow',
      desc: 'Горизонтальное распределение проторгованного объема по ценовым уровням с динамической линией Point of Control (POC).',
      badge: 'Volume',
      badgeColor: 'text-[#a855f7] bg-[#a855f718] border-[#a855f740]'
    },
    {
      id: 'walls',
      name: 'Крупные плотности стакана (Walls)',
      category: 'orderflow',
      desc: 'Подсветка институциональных лимитных заявок в стакане L2 объемом от $500k с бейджами на ценовой шкале.',
      badge: 'L2 DOM',
      badgeColor: 'text-[#26a69a] bg-[#26a69a18] border-[#26a69a40]'
    },
    {
      id: 'liquidations',
      name: 'Ликвидации (Live Liquidations)',
      category: 'orderflow',
      desc: 'Пузыри принудительных ликвидаций длинных и коротких позиций на графике в реальном времени.',
      badge: 'Liquidations',
      badgeColor: 'text-[#ef5350] bg-[#ef535018] border-[#ef535040]'
    },
    {
      id: 'heatmap',
      name: 'Тепловая карта плотностей (Heatmap)',
      category: 'orderflow',
      desc: 'Историческая лента лимитных плотностей в пространстве цены и времени (следы айсбергов и спуфинга).',
      badge: 'Pro Heatmap',
      badgeColor: 'text-[#ff9800] bg-[#ff980018] border-[#ff980040]'
    },

    // 2. Trend
    {
      id: 'vwap',
      name: 'VWAP (Volume Weighted Average Price)',
      category: 'trend',
      desc: 'Средневзвешенная цена по объему за торговую сессию с полосами стандартного отклонения (±1σ, ±2σ).',
      badge: 'Trend',
      badgeColor: 'text-[#ffb300] bg-[#ffb30018] border-[#ffb30040]'
    },
    {
      id: 'ema',
      name: 'Мульти-EMA Ribbon (20, 50, 200)',
      category: 'trend',
      desc: 'Экспоненциальные скользящие средние для определения среднесрочного и глобального направления тренда.',
      badge: 'Trend',
      badgeColor: 'text-[#38bdf8] bg-[#38bdf818] border-[#38bdf840]'
    },

    // 3. Oscillators & Risk
    {
      id: 'atr',
      name: 'ATR (Average True Range)',
      category: 'oscillators',
      desc: 'Индикатор истинного диапазона волатильности для расчета адаптивного стоп-лосса и фильтрации шума.',
      badge: 'Risk / SL',
      badgeColor: 'text-[#10b981] bg-[#10b98118] border-[#10b98140]'
    },
    {
      id: 'rsi',
      name: 'RSI (Relative Strength Index 14)',
      category: 'oscillators',
      desc: 'Индекс относительной силы с ключевыми уровнями перекупленности (70) и перепроданности (30).',
      badge: 'Oscillator',
      badgeColor: 'text-[#a855f7] bg-[#a855f718] border-[#a855f740]'
    },
    {
      id: 'macd',
      name: 'MACD (12, 26, 9)',
      category: 'oscillators',
      desc: 'Схождение/расхождение скользящих средних со столбчатой гистограммой импульса.',
      badge: 'Oscillator',
      badgeColor: 'text-[#f59e0b] bg-[#f59e0b18] border-[#f59e0b40]'
    },
    {
      id: 'vol',
      name: 'Биржевой объем (Volume)',
      category: 'oscillators',
      desc: 'Классическая гистограмма объемов торгов под графиком с цветовым кодированием бычьих и медвежьих свечей.',
      badge: 'Volume',
      badgeColor: 'text-[#26a69a] bg-[#26a69a18] border-[#26a69a40]'
    }
  ];

  // Filter items
  const filteredCatalog = catalog.filter((item) => {
    const matchesCategory =
      activeCategory === 'all' || item.category === activeCategory;
    const matchesQuery =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.desc.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.badge.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesQuery;
  });

  const toggleIndicator = (id) => {
    const currentVal = Boolean(activeIndicators[id]);
    const nextVal = !currentVal;
    const updated = { ...activeIndicators, [id]: nextVal };
    onIndicatorsChange(activeTab, updated);
  };

  const toggleSettings = (id) => {
    setExpandedSettings((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const updateSetting = (key, val) => {
    const next = { ...customSettings, [key]: val };
    setCustomSettings(next);
    localStorage.setItem('indicators_advanced_settings', JSON.stringify(next));
  };

  const handleResetToDefaults = () => {
    onIndicatorsChange(activeTab, { ...DEFAULT_INDICATORS_CONFIG });
    setCustomSettings(DEFAULT_INDICATORS_SETTINGS);
    localStorage.removeItem('indicators_advanced_settings');
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 select-none animate-fadeIn"
    >
      <div onClick={(e) => e.stopPropagation()} className="w-[740px] max-w-[95vw] max-h-[88vh] rounded-xl border border-border bg-card text-foreground shadow-2xl flex flex-col overflow-hidden font-sans text-xs"
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-[#2563eb20] text-[#38bdf8]">
              <Sliders size={16} />
            </div>
            <div>
              <div className="font-bold text-foreground text-sm">
                Каталог индикаторов & Order Flow
              </div>
              <div className="text-[11px] text-[#787f91]">
                Включение, настройка параметров и распределение по окнам графиков
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#787f91] hover:text-foreground hover:bg-[#1f2430] transition"
            title="Закрыть каталог (Клавиша 'I')"
          >
            <X size={17} />
          </button>
        </div>

        {/* Chart Selector Tabs (HTF vs LTF) */}
        {isDualPane && (
          <div className="px-4 py-2 border-b border-border bg-muted/40 flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-2">
              <span className="text-[#787f91] font-mono text-[10.5px]">Целевой график:</span>
              <div className="flex space-x-1">
                <button
                  onClick={() => {
                    setActiveTab('primary');
                    if (onTargetChartChange) onTargetChartChange('primary');
                  }}
                  className={`px-3 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                    activeTab === 'primary'
                      ? 'bg-[#2563eb] text-foreground shadow-sm'
                      : 'text-[#94a3b8] hover:text-foreground hover:bg-[#181d28]'
                  }`}
                >
                  Senior График (HTF 15m)
                </button>
                <button
                  onClick={() => {
                    setActiveTab('secondary');
                    if (onTargetChartChange) onTargetChartChange('secondary');
                  }}
                  className={`px-3 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                    activeTab === 'secondary'
                      ? 'bg-[#2563eb] text-foreground shadow-sm'
                      : 'text-[#94a3b8] hover:text-foreground hover:bg-[#181d28]'
                  }`}
                >
                  Junior График (LTF 1m)
                </button>
              </div>
            </div>
            <div className="text-[10px] text-[#38bdf8] font-mono">
              {activeTab === 'primary' ? '● Настройка HTF' : '● Настройка LTF'}
            </div>
          </div>
        )}

        {/* Search & Category Filter Bar */}
        <div className="px-4 py-2.5 border-b border-border bg-card flex items-center justify-between gap-3 shrink-0">
          {/* Search Input */}
          <div className="relative flex-1 max-w-xs">
            <input
              type="text"
              placeholder="Поиск индикатора (CVD, EMA, ATR, Walls)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-background border border-border focus:border-primary rounded px-3 py-1 text-[11px] text-foreground placeholder-[#64748b] outline-none font-sans pl-7"
            />
            <Search
              size={12}
              className="absolute left-2.5 top-2 text-[#64748b] pointer-events-none"
            />
          </div>

          {/* Categories */}
          <div className="flex items-center space-x-1 overflow-x-auto">
            {[
              { id: 'all', label: 'Все' },
              { id: 'orderflow', label: 'Order Flow & Стакан' },
              { id: 'trend', label: 'Трендовые' },
              { id: 'oscillators', label: 'Осцилляторы & Риск' }
            ].map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-2.5 py-0.8 rounded text-[10.5px] transition cursor-pointer whitespace-nowrap ${
                  activeCategory === cat.id
                    ? 'bg-[#1e293b] text-[#38bdf8] font-bold border border-[#38bdf850]'
                    : 'text-[#787f91] hover:text-foreground hover:bg-[#161a24]'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Indicators Catalog List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-0">
          {filteredCatalog.length === 0 ? (
            <div className="py-12 text-center text-[#787f91]">
              Индикаторы по запросу «{searchQuery}» не найдены
            </div>
          ) : (
            filteredCatalog.map((item) => {
              const isEnabled = Boolean(activeIndicators[item.id]);
              const isSettingsOpen = Boolean(expandedSettings[item.id]);

              return (
                <div
                  key={item.id}
                  className={`rounded-lg border transition-all ${
                    isEnabled
                      ? 'bg-[#111622] border-[#2563eb60] shadow-sm'
                      : 'bg-[#0d1017] border-[#1b202c] opacity-85 hover:opacity-100'
                  }`}
                >
                  <div className="p-3 flex items-center justify-between">
                    {/* Left: Info */}
                    <div className="flex items-start space-x-3 flex-1 min-w-0 pr-4">
                      {/* Checkbox / Toggle */}
                      <button
                        onClick={() => toggleIndicator(item.id)}
                        className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition cursor-pointer shrink-0 ${
                          isEnabled
                            ? 'bg-[#2563eb] border-[#2563eb] text-foreground'
                            : 'border-[#333d52] hover:border-[#64748b]'
                        }`}
                      >
                        {isEnabled && <Check size={12} strokeWidth={3} />}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center space-x-2">
                          <span
                            onClick={() => toggleIndicator(item.id)}
                            className="font-semibold text-foreground text-[11.5px] cursor-pointer hover:text-[#38bdf8] transition"
                          >
                            {item.name}
                          </span>
                          <span
                            className={`px-1.5 py-0.2 rounded font-mono text-[9px] border ${item.badgeColor}`}
                          >
                            {item.badge}
                          </span>
                        </div>
                        <p className="text-[10px] text-[#828ca0] mt-0.5 leading-relaxed">
                          {item.desc}
                        </p>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center space-x-2 shrink-0">
                      {/* Settings gear if available */}
                      {['ema', 'vwap', 'rsi', 'atr', 'walls'].includes(item.id) && (
                        <button
                          onClick={() => toggleSettings(item.id)}
                          className={`p-1.5 rounded transition cursor-pointer ${
                            isSettingsOpen
                              ? 'bg-[#1f293d] text-[#38bdf8]'
                              : 'text-[#64748b] hover:text-foreground hover:bg-[#181d28]'
                          }`}
                          title="Настройки параметров индикатора"
                        >
                          <Sliders size={13} />
                        </button>
                      )}

                      {/* Power Switch Button */}
                      <button
                        onClick={() => toggleIndicator(item.id)}
                        className={`px-2.5 py-1 rounded text-[10px] font-semibold transition cursor-pointer flex items-center space-x-1 ${
                          isEnabled
                            ? 'bg-[#26a69a25] text-[#26a69a] border border-[#26a69a50]'
                            : 'bg-[#161a24] text-[#64748b] hover:text-foreground border border-[#242b3b]'
                        }`}
                      >
                        {isEnabled ? (
                          <>
                            <Eye size={11} />
                            <span>ВКЛ</span>
                          </>
                        ) : (
                          <>
                            <EyeOff size={11} />
                            <span>ВЫКЛ</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Accordion Settings Panel */}
                  {isSettingsOpen && (
                    <div className="px-3 py-2 border-t border-[#1f2738] bg-[#090b10] font-mono text-[10px] space-y-2 animate-fadeIn">
                      <div className="text-[#94a3b8] font-sans font-semibold">
                        Параметры индикатора {item.name}:
                      </div>

                      {item.id === 'ema' && (
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <span className="text-[#787f91]">EMA 1:</span>
                            <input
                              type="number"
                              value={customSettings.emaPeriods[0]}
                              onChange={(e) => {
                                const p = [...customSettings.emaPeriods];
                                p[0] = Number(e.target.value);
                                updateSetting('emaPeriods', p);
                              }}
                              className="w-full bg-[#121620] border border-[#252d3d] rounded p-1 text-foreground mt-0.5"
                            />
                          </div>
                          <div>
                            <span className="text-[#787f91]">EMA 2:</span>
                            <input
                              type="number"
                              value={customSettings.emaPeriods[1]}
                              onChange={(e) => {
                                const p = [...customSettings.emaPeriods];
                                p[1] = Number(e.target.value);
                                updateSetting('emaPeriods', p);
                              }}
                              className="w-full bg-[#121620] border border-[#252d3d] rounded p-1 text-foreground mt-0.5"
                            />
                          </div>
                          <div>
                            <span className="text-[#787f91]">EMA 3:</span>
                            <input
                              type="number"
                              value={customSettings.emaPeriods[2]}
                              onChange={(e) => {
                                const p = [...customSettings.emaPeriods];
                                p[2] = Number(e.target.value);
                                updateSetting('emaPeriods', p);
                              }}
                              className="w-full bg-[#121620] border border-[#252d3d] rounded p-1 text-foreground mt-0.5"
                            />
                          </div>
                        </div>
                      )}

                      {item.id === 'rsi' && (
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <span className="text-[#787f91]">Период:</span>
                            <input
                              type="number"
                              value={customSettings.rsiPeriod}
                              onChange={(e) => updateSetting('rsiPeriod', Number(e.target.value))}
                              className="w-full bg-[#121620] border border-[#252d3d] rounded p-1 text-foreground mt-0.5"
                            />
                          </div>
                          <div>
                            <span className="text-[#ef5350]">Перекупленность:</span>
                            <input
                              type="number"
                              value={customSettings.rsiOverbought}
                              onChange={(e) => updateSetting('rsiOverbought', Number(e.target.value))}
                              className="w-full bg-[#121620] border border-[#252d3d] rounded p-1 text-foreground mt-0.5"
                            />
                          </div>
                          <div>
                            <span className="text-[#26a69a]">Перепроданность:</span>
                            <input
                              type="number"
                              value={customSettings.rsiOversold}
                              onChange={(e) => updateSetting('rsiOversold', Number(e.target.value))}
                              className="w-full bg-[#121620] border border-[#252d3d] rounded p-1 text-foreground mt-0.5"
                            />
                          </div>
                        </div>
                      )}

                      {item.id === 'atr' && (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className="text-[#787f91]">Период ATR:</span>
                            <input
                              type="number"
                              value={customSettings.atrPeriod}
                              onChange={(e) => updateSetting('atrPeriod', Number(e.target.value))}
                              className="w-full bg-[#121620] border border-[#252d3d] rounded p-1 text-foreground mt-0.5"
                            />
                          </div>
                          <div>
                            <span className="text-[#38bdf8]">Множитель стопа:</span>
                            <input
                              type="number"
                              step="0.1"
                              value={customSettings.atrMultiplier}
                              onChange={(e) => updateSetting('atrMultiplier', Number(e.target.value))}
                              className="w-full bg-[#121620] border border-[#252d3d] rounded p-1 text-foreground mt-0.5"
                            />
                          </div>
                        </div>
                      )}

                      {item.id === 'walls' && (
                        <div>
                          <span className="text-[#787f91]">Мин. плотность стенки ($ USD):</span>
                          <input
                            type="number"
                            step="100000"
                            value={customSettings.minWallUsd}
                            onChange={(e) => updateSetting('minWallUsd', Number(e.target.value))}
                            className="w-full bg-[#121620] border border-[#252d3d] rounded p-1 text-foreground mt-0.5"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-3 border-t border-[#1f2430] bg-[#131722] flex items-center justify-between shrink-0">
          <button
            onClick={handleResetToDefaults}
            className="px-3 py-1.5 rounded text-[#787f91] hover:text-foreground hover:bg-[#1a202c] transition flex items-center space-x-1.5 cursor-pointer text-[10.5px]"
          >
            <RotateCcw size={13} />
            <span>Сбросить к заводским</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-[#2563eb] hover:bg-[#1d4ed8] text-foreground font-semibold transition cursor-pointer text-[11px]"
          >
            Применить и закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
