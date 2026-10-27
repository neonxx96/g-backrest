import React, { useState, useMemo } from 'react';
import { 
  Search, 
  X, 
  SlidersHorizontal, 
  Check, 
  Plus, 
  TrendingUp, 
  Activity, 
  Layers, 
  BarChart2, 
  Eye, 
  Settings 
} from 'lucide-react';
import { INDICATORS_REGISTRY, INDICATOR_CATEGORIES } from '../../config/indicatorsRegistry';

export default function IndicatorsModal({
  isOpen,
  onClose,
  activeIndicators = [],
  onAddIndicator,
  onRemoveIndicator,
  onOpenSettings
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Map category to icon
  const getCategoryIcon = (cat) => {
    switch (cat) {
      case 'Trend':
        return <TrendingUp size={13} className="text-[#38bdf8]" />;
      case 'Oscillators':
        return <Activity size={13} className="text-[#a855f7]" />;
      case 'Volatility':
        return <Layers size={13} className="text-[#10b981]" />;
      case 'OrderFlow':
        return <BarChart2 size={13} className="text-[#f59e0b]" />;
      default:
        return <SlidersHorizontal size={13} className="text-[#64748b]" />;
    }
  };

  const activeIds = useMemo(() => {
    return new Set(activeIndicators.map((item) => item.id));
  }, [activeIndicators]);

  const filteredIndicators = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return Object.values(INDICATORS_REGISTRY).filter((ind) => {
      const matchesCat = selectedCategory === 'all' || ind.category === selectedCategory;
      const matchesQuery =
        !query ||
        ind.name.toLowerCase().includes(query) ||
        ind.shortName.toLowerCase().includes(query) ||
        ind.id.toLowerCase().includes(query) ||
        (ind.description && ind.description.toLowerCase().includes(query));
      return matchesCat && matchesQuery;
    });
  }, [searchQuery, selectedCategory]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="indicators-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 select-none animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="indicators-modal"
        className="w-full max-w-2xl bg-[#0d111a] border border-[#1e2638] rounded-xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden text-[#e2e8f0]"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#1e2638] flex items-center justify-between bg-[#121824]">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-[#3b82f620] text-[#38bdf8] border border-[#3b82f640]">
              <SlidersHorizontal size={16} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground tracking-wide">
                Каталог технических индикаторов
              </h3>
              <p className="text-[11px] text-[#94a3b8]">
                Выберите индикатор для добавления на активный график
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="btn-close-indicators-modal"
            onClick={onClose}
            className="p-1 rounded-md text-[#64748b] hover:text-foreground hover:bg-[#1e2638] transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search & Category Tabs */}
        <div className="p-4 border-b border-[#1b2233] space-y-3 bg-[#0a0e17]">
          {/* Search Box */}
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748b]" />
            <input
              type="text"
              data-testid="indicators-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск индикатора (RSI, EMA, Bollinger, SuperTrend, Volume...)"
              className="w-full pl-9 pr-8 py-2 bg-[#121826] border border-[#1e2638] rounded-lg text-xs text-foreground placeholder-[#64748b] focus:outline-none focus:border-[#38bdf8] transition font-sans"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-foreground"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Categories */}
          <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar pb-0.5">
            {INDICATOR_CATEGORIES.map((cat) => {
              const isActive = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  data-testid={`category-tab-${cat.id}`}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer whitespace-nowrap border ${
                    isActive
                      ? 'bg-[#1e293b] text-[#38bdf8] border-[#38bdf850] shadow-sm'
                      : 'bg-[#121826] text-[#94a3b8] border-[#1b2233] hover:text-foreground hover:bg-[#161f30]'
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Indicators List */}
        <div
          data-testid="indicators-list"
          className="flex-1 overflow-y-auto p-4 space-y-2.5 divide-y divide-[#182030]/50"
        >
          {filteredIndicators.length === 0 ? (
            <div className="py-12 text-center text-[#64748b] space-y-1 text-xs">
              <p>Индикаторы по запросу «{searchQuery}» не найдены</p>
              <p className="text-[10px]">Попробуйте изменить поисковый запрос или категорию</p>
            </div>
          ) : (
            filteredIndicators.map((ind) => {
              const isAdded = activeIds.has(ind.id);

              return (
                <div
                  key={ind.id}
                  data-testid={`indicator-card-${ind.id}`}
                  className="pt-2.5 first:pt-0 flex items-start justify-between group hover:bg-[#131b29]/60 p-2.5 rounded-lg border border-transparent hover:border-[#1e283d] transition"
                >
                  <div className="space-y-1 max-w-[75%]">
                    <div className="flex items-center space-x-2">
                      <div className="p-1 rounded bg-[#182030] border border-[#222c42]">
                        {getCategoryIcon(ind.category)}
                      </div>
                      <span className="font-semibold text-xs text-foreground group-hover:text-[#38bdf8] transition">
                        {ind.name}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#182030] text-[#94a3b8] font-mono border border-[#222c42]">
                        {ind.pane === 'main' ? 'Главный график' : 'Подокно'}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#94a3b8] leading-relaxed line-clamp-2">
                      {ind.description}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-2 shrink-0 pt-1">
                    {isAdded ? (
                      <div className="flex items-center space-x-1.5">
                        <span className="flex items-center space-x-1 text-[11px] text-[#10b981] bg-[#10b98115] border border-[#10b98130] px-2 py-1 rounded font-medium">
                          <Check size={12} />
                          <span>На графике</span>
                        </span>
                        <button
                          type="button"
                          data-testid={`btn-settings-indicator-${ind.id}`}
                          onClick={() => {
                            onOpenSettings(ind.id);
                            onClose();
                          }}
                          title="Настройки"
                          className="p-1.5 rounded bg-[#182233] text-[#94a3b8] hover:text-foreground hover:bg-[#1e2c42] transition cursor-pointer"
                        >
                          <Settings size={13} />
                        </button>
                        <button
                          type="button"
                          data-testid={`btn-remove-indicator-${ind.id}`}
                          onClick={() => onRemoveIndicator(ind.id)}
                          title="Удалить"
                          className="p-1.5 rounded bg-[#182233] text-[#ef4444] hover:bg-[#ef444420] transition cursor-pointer"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        data-testid={`btn-add-indicator-${ind.id}`}
                        onClick={() => {
                          onAddIndicator(ind.id);
                        }}
                        className="flex items-center space-x-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-foreground shadow-sm hover:shadow transition cursor-pointer"
                      >
                        <Plus size={13} />
                        <span>Добавить</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#1e2638] bg-[#0c1018] flex items-center justify-between text-[11px] text-[#64748b]">
          <span>
            Активно на графике: <span className="text-foreground font-semibold">{activeIndicators.length}</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded bg-[#1a2233] text-[#94a3b8] hover:text-foreground transition cursor-pointer"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}
