/**
 * Widget Hub Modal ("Новый модуль")
 * Institutional modal dialog providing one-click addition of trading modules
 * to the active dockview grid layout.
 */

import React from 'react';
import {
  LayoutGrid,
  LineChart,
  Layers,
  Zap,
  Activity,
  Radio,
  BarChart3,
  TrendingUp,
  ShieldCheck,
  X,
  Plus,
  Sparkles,
  Check,
  History
} from 'lucide-react';
import { useLayoutStore } from '../../stores/layoutStore';

const MODULES = [
  {
    id: 'chart',
    type: 'chart',
    title: 'График (Chart)',
    badge: 'KLineCharts v9',
    badgeColor: 'text-[#38bdf8] bg-[#38bdf815] border-[#38bdf830]',
    icon: LineChart,
    iconColor: 'text-[#38bdf8]',
    description: 'Интерактивный график с SMC-шаблонами, интерактивным Risk/Reward калькулятором и серверными индикаторами (RSI, EMA, MACD, SuperTrend).',
    defaultLocation: 'Центральная панель (вкладка или рядом)'
  },
  {
    id: 'orderbook',
    type: 'orderbook',
    title: 'Биржевой стакан (DOM)',
    badge: 'Canvas 60 FPS',
    badgeColor: 'text-[#10b981] bg-[#10b98115] border-[#10b98130]',
    icon: Layers,
    iconColor: 'text-[#10b981]',
    description: 'Глубокий стакан с детекцией спуфинга, подсветкой плотностей, колонкой «ЖИЗНЬ» и мгновенной проекцией торговых уровней.',
    defaultLocation: 'Правая панель'
  },
  {
    id: 'liq_analytics',
    type: 'liq_analytics',
    title: 'Ликвидации & Квант-карантин',
    badge: 'Quant Engine',
    badgeColor: 'text-[#a855f7] bg-[#a855f715] border-[#a855f730]',
    icon: Activity,
    iconColor: 'text-[#a855f7]',
    description: 'Аналитика пулов ликвидаций, консилиум 3 ядер, расчет R:R, спотовые стены и фиксация сигналов в Shadow Quarantine.',
    defaultLocation: 'Правая панель (вкладка или рядом)'
  },
  {
    id: 'trades',
    type: 'trades',
    title: 'Лента сделок (Tape)',
    badge: 'Whale Tracker',
    badgeColor: 'text-[#eab308] bg-[#eab30815] border-[#eab30830]',
    icon: Zap,
    iconColor: 'text-[#eab308]',
    description: 'Высокочастотная лента Time & Sales с Canvas 2D виртуализацией, фильтрами объема, мини-барами и Web Audio алертами крупных китов.',
    defaultLocation: 'Правая нижняя панель (вкладка)'
  },
  {
    id: 'screener',
    type: 'screener',
    title: 'Скринер рынка',
    badge: '24h Sparklines',
    badgeColor: 'text-[#a855f7] bg-[#a855f715] border-[#a855f730]',
    icon: Activity,
    iconColor: 'text-[#a855f7]',
    description: 'Мультирыночный скринер 350+ пар с 24-часовыми спарклайнами, сортировкой по объему, динамике роста/падения и волатильности.',
    defaultLocation: 'Левая колонка рынков'
  },
  {
    id: 'tradehistory',
    type: 'tradehistory',
    title: 'Демо-торговля & Сделки (20 пар)',
    badge: 'Paper Marathon & AI',
    badgeColor: 'text-[#10b981] bg-[#10b98115] border-[#10b98130]',
    icon: History,
    iconColor: 'text-[#10b981]',
    description: 'Единый центр бумажной торговли: 20 пар, активные позиции, история закрытых сделок с фильтрами по периодам, лимитные претенденты, статистика PnL и AI-сопровождение.',
    defaultLocation: 'Нижняя вкладка'
  },
  {
    id: 'signals',
    type: 'signals',
    title: 'Лента сигналов',
    badge: 'Order Flow AI',
    badgeColor: 'text-[#06b6d4] bg-[#06b6d415] border-[#06b6d430]',
    icon: Radio,
    iconColor: 'text-[#06b6d4]',
    description: 'Живой поток автоматических квант-сигналов на основе крупных лимитных плотностей, дисбаланса дельты и трендовых подтверждений.',
    defaultLocation: 'Нижняя вкладка'
  },
  {
    id: 'footprint',
    type: 'footprint',
    title: 'Футпринт / Кластеры',
    badge: 'Volume Imbalance',
    badgeColor: 'text-[#ec4899] bg-[#ec489915] border-[#ec489930]',
    icon: BarChart3,
    iconColor: 'text-[#ec4899]',
    description: 'Горизонтальный кластерный анализ свечей с распределением объемов Bid/Ask на каждом ценовом тике.',
    defaultLocation: 'Правая панель'
  },
  {
    id: 'cvd',
    type: 'cvd',
    title: 'CVD Кумулятивная дельта',
    badge: 'Market Aggression',
    badgeColor: 'text-[#14b8a6] bg-[#14b8a615] border-[#14b8a630]',
    icon: TrendingUp,
    iconColor: 'text-[#14b8a6]',
    description: 'Кумулятивная дельта рыночных покупок и продаж для раннего выявления дивергенций и скрытого накопления/дистрибуции.',
    defaultLocation: 'Нижняя панель'
  }
];

export default function WidgetHubModal() {
  const isOpen = useLayoutStore((s) => s.isWidgetHubOpen);
  const closeWidgetHub = useLayoutStore((s) => s.closeWidgetHub);
  const addWidgetPanel = useLayoutStore((s) => s.addWidgetPanel);

  if (!isOpen) return null;

  const handleSelect = (module) => {
    addWidgetPanel(module.type);
    closeWidgetHub();
  };

  return (
    <div
      data-testid="widget-hub-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none font-sans animate-fadeIn"
    >
      <div className="bg-[#0c0f17] border border-[#222838] rounded-xl w-[720px] max-w-[95vw] shadow-2xl overflow-hidden flex flex-col text-xs text-[#d1d4dc]">
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-[#101420] border-b border-[#1b2234] flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-[#2563eb20] border border-[#2563eb40] text-[#38bdf8]">
              <LayoutGrid size={16} />
            </div>
            <div>
              <div className="font-bold text-foreground text-[13px] tracking-wide flex items-center gap-1.5">
                <span>Каталог модулей (Виджеты)</span>
                <span className="text-[10px] font-mono text-[#38bdf8] bg-[#38bdf815] px-1.5 py-0.2 rounded border border-[#38bdf830]">
                  SignalScript
                </span>
              </div>
              <div className="text-[10.5px] text-[#64748b]">
                Выберите торговый модуль для добавления в активную сетку рабочего пространства
              </div>
            </div>
          </div>
          <button
            type="button"
            data-testid="btn-close-widget-hub"
            onClick={closeWidgetHub}
            className="p-1.5 rounded-lg text-[#64748b] hover:text-foreground hover:bg-[#1b2234] transition cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modules Grid */}
        <div className="p-5 max-h-[70vh] overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-3">
          {MODULES.map((m) => {
            const Icon = m.icon;

            return (
              <div
                key={m.id}
                data-testid={`card-add-widget-${m.id}`}
                onClick={() => handleSelect(m)}
                className="group relative p-3.5 rounded-lg bg-[#0e121c] border border-[#1b2233] hover:border-[#38bdf870] hover:bg-[#141a29] transition-all cursor-pointer flex flex-col justify-between space-y-2.5 shadow-sm hover:shadow-lg"
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center space-x-2">
                      <div className={`p-1.5 rounded-md bg-[#161c2b] border border-[#222b40] group-hover:scale-105 transition-transform ${m.iconColor}`}>
                        <Icon size={16} />
                      </div>
                      <span className="font-bold text-foreground text-[12px] group-hover:text-[#38bdf8] transition-colors">
                        {m.title}
                      </span>
                    </div>
                    <span className={`text-[9px] font-mono font-medium px-1.5 py-0.5 rounded border ${m.badgeColor}`}>
                      {m.badge}
                    </span>
                  </div>

                  <p className="text-[10px] text-[#8492a6] leading-relaxed line-clamp-2">
                    {m.description}
                  </p>
                </div>

                <div className="pt-2 border-t border-[#171e2e] flex items-center justify-between text-[9.5px] text-[#64748b] font-mono">
                  <span>Позиция: {m.defaultLocation}</span>
                  <div className="flex items-center space-x-1 text-[#38bdf8] opacity-0 group-hover:opacity-100 transition-opacity font-sans font-bold">
                    <Plus size={11} />
                    <span>Добавить</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-2.5 bg-[#090c13] border-t border-[#171e2e] flex items-center justify-between text-[10px] text-[#64748b] font-mono">
          <span>Сетка: dockview multi-docking с привязкой цветовых каналов C1..C10</span>
          <button
            type="button"
            onClick={closeWidgetHub}
            className="px-3 py-1 rounded bg-[#161c2b] hover:bg-[#222b40] text-foreground transition cursor-pointer"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
