import React from 'react';
import { Eye, EyeOff, Sparkles, Layout, Monitor } from 'lucide-react';

export const DEFAULT_VISIBILITY = {
  showPresetBar: true,
  showChartToolbar: true,
  showOhlcLegend: true,
  showIndicatorsLegend: true,
  showDensityLabels: true,
  showWallPriceTags: true,
  showAssistantHud: true,
  showPositionHud: true,
  showDiagnosticChips: false, // Default OFF as specified
  autoHideDockviewTabs: false,
  showPanelStatusBars: true,
  zenMode: false,
};

export const VISIBILITY_PRESETS = {
  full: {
    id: 'full',
    label: 'Полный',
    desc: 'Все панели, тулбары, слои и информационные блоки включены',
    values: {
      showPresetBar: true,
      showChartToolbar: true,
      showOhlcLegend: true,
      showIndicatorsLegend: true,
      showDensityLabels: true,
      showWallPriceTags: true,
      showAssistantHud: true,
      showPositionHud: true,
      showDiagnosticChips: true,
      autoHideDockviewTabs: false,
      showPanelStatusBars: true,
      zenMode: false,
    }
  },
  standard: {
    id: 'standard',
    label: 'Рабочий',
    desc: 'Сбалансированный вид: основные элементы включены, диагностика выключена',
    values: {
      showPresetBar: true,
      showChartToolbar: true,
      showOhlcLegend: true,
      showIndicatorsLegend: true,
      showDensityLabels: true,
      showWallPriceTags: true,
      showAssistantHud: true,
      showPositionHud: true,
      showDiagnosticChips: false,
      autoHideDockviewTabs: false,
      showPanelStatusBars: true,
      zenMode: false,
    }
  },
  minimal: {
    id: 'minimal',
    label: 'Минимум',
    desc: 'Только чистый график: верхние строки и оверлеи скрыты',
    values: {
      showPresetBar: false,
      showChartToolbar: false,
      showOhlcLegend: false,
      showIndicatorsLegend: false,
      showDensityLabels: false,
      showWallPriceTags: false,
      showAssistantHud: false,
      showPositionHud: true,
      showDiagnosticChips: false,
      autoHideDockviewTabs: true,
      showPanelStatusBars: false,
      zenMode: false,
    }
  }
};

export function readStoredVisibility() {
  try {
    const raw = localStorage.getItem('signalscript_ui_visibility');
    if (raw) return { ...DEFAULT_VISIBILITY, ...JSON.parse(raw) };
  } catch (_) {}
  return DEFAULT_VISIBILITY;
}

export function persistVisibility(vis) {
  try {
    localStorage.setItem('signalscript_ui_visibility', JSON.stringify(vis));
    window.dispatchEvent(new CustomEvent('signalscript:visibility-changed', { detail: vis }));
  } catch (_) {}
}

export default function VisibilityTab({ cfg, updateUi }) {
  const visibility = { ...DEFAULT_VISIBILITY, ...(cfg?.visibility || readStoredVisibility()) };

  const handleToggle = (key) => {
    const next = { ...visibility, [key]: !visibility[key] };
    persistVisibility(next);
    updateUi({ visibility: next });
  };

  const handleApplyPreset = (presetKey) => {
    const preset = VISIBILITY_PRESETS[presetKey];
    if (!preset) return;
    const next = { ...visibility, ...preset.values };
    persistVisibility(next);
    updateUi({ visibility: next });
  };

  const items = [
    { key: 'showPresetBar', label: 'Второй ряд верхней панели (слои и раскладки)', desc: 'Панель пресетов и переключателей спот-стен под шапкой' },
    { key: 'showChartToolbar', label: 'Тулбар графика', desc: 'Верхняя полоса инструментов рисования, индикаторов и таймфреймов' },
    { key: 'showOhlcLegend', label: 'Легенда OHLC котировок', desc: 'Текущие Open, High, Low, Close цены свечи в углу графика' },
    { key: 'showIndicatorsLegend', label: 'Легенда индикаторов', desc: 'Значения EMA, RSI, CVD, VWAP на графике' },
    { key: 'showDensityLabels', label: 'Подписи плотностей и ликвидаций', desc: 'Текстовые бейджи с объемом на линиях уровней' },
    { key: 'showWallPriceTags', label: 'Ценовые теги стен', desc: 'Выносные метки цен крупных лимитных заявок на шкале' },
    { key: 'showAssistantHud', label: 'HUD тактического ассистента', desc: 'Карточка рыночной фазы и рекомендаций над графиком' },
    { key: 'showPositionHud', label: 'HUD позиции', desc: 'Плашка текущей позиции (размер, PnL, плечо) над графиком' },
    { key: 'showDiagnosticChips', label: 'Диагностические чипы (мс, FPS, статус)', desc: 'Чипы задержки отрисовки стакана, футпринта и REST' },
    { key: 'autoHideDockviewTabs', label: 'Заголовки вкладок dockview: автоскрытие', desc: 'Скрывать заголовки вкладок, показывать только при наведении' },
    { key: 'showPanelStatusBars', label: 'Статус-строки панелей', desc: 'Нижние полосы со сводкой объёмов и состоянием подключения' },
  ];

  return (
    <div className="space-y-4">
      {/* 1. Visibility Presets */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-white font-bold text-xs">
            Готовые профили видимости:
          </label>
          <span className="text-[10px] font-mono text-muted-foreground">
            Хоткей Zen: <strong className="text-primary font-bold">Alt+Z</strong>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          {Object.entries(VISIBILITY_PRESETS).map(([key, p]) => (
            <button
              key={key}
              type="button"
              onClick={() => handleApplyPreset(key)}
              className="p-3 rounded-md border text-left transition cursor-pointer bg-[#10131a] border-[#1f2430] hover:border-[#38bdf8]/50 hover:bg-[#141a24]"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-xs text-white flex items-center gap-1.5">
                  <Sparkles size={12} className="text-[#38bdf8]" />
                  {p.label}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug">{p.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="h-px bg-[#1b212f]" />

      {/* 2. Individual Element Switches */}
      <div className="space-y-2">
        <label className="block text-white font-bold text-xs">
          Элементы интерфейса:
        </label>

        <div className="divide-y divide-[#1b212f] border border-[#1b212f] rounded-md bg-[#10131a] overflow-hidden">
          {items.map((item) => {
            const checked = visibility[item.key] !== false;
            return (
              <div
                key={item.key}
                onClick={() => handleToggle(item.key)}
                className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[#141924] transition select-none"
              >
                <div className="pr-3">
                  <div className="text-xs font-medium text-foreground">{item.label}</div>
                  <div className="text-[10px] text-muted-foreground">{item.desc}</div>
                </div>

                <div
                  className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer shrink-0 ${
                    checked ? 'bg-[#2563eb]' : 'bg-[#1e2533]'
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                      checked ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
