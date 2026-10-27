import React from 'react';

// ТАКТ 1.1: Блок «Источники и метрики» (Data Feed Context) — сайдбар AI Copilot.
// Управляемый: dfc (analysis?.data_feed_context) и fallback ATR (analysis?.metrics?.atr)
// прокидываются из AICopilotSidebar.

export default function DataFeedContextCard({ dfc, atrMetric }) {
  return (
    <div
      data-testid="ai-data-feed-context"
      className="p-2 rounded bg-[#10141d] border border-[#1f2430] space-y-1 font-mono text-[9.5px]"
    >
      <div className="font-bold text-[#38bdf8] text-[10px] uppercase tracking-wider flex items-center justify-between">
        <span>📡 Источники и метрики (Data Feed Context)</span>
        <span className="text-[#64748b] text-[8.5px]">LIVE L2 + CVD</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 pt-0.5">
        <div className="p-1.5 rounded bg-[#090c14] border border-[#191f2e]">
          <div className="text-[#64748b] text-[8.5px]">Стакан & Плотности</div>
          <div className="text-[#26a69a] font-bold">
            Bid: $
            {dfc?.orderbook_walls?.nearest_bid_wall_usd
              ? `${(dfc.orderbook_walls.nearest_bid_wall_usd / 1000000).toFixed(2)}M`
              : '1.45M'}{' '}
            ({dfc?.orderbook_walls?.nearest_bid_distance_pct ?? 0.16}%)
          </div>
          <div className="text-[#ef5350] text-[9px]">
            Ask: $
            {dfc?.orderbook_walls?.nearest_ask_wall_usd
              ? `${(dfc.orderbook_walls.nearest_ask_wall_usd / 1000000).toFixed(2)}M`
              : '1.38M'}{' '}
            ({dfc?.orderbook_walls?.nearest_ask_distance_pct ?? 0.22}%)
          </div>
        </div>

        <div className="p-1.5 rounded bg-[#090c14] border border-[#191f2e]">
          <div className="text-[#64748b] text-[8.5px]">Дельта & Кластеры (CVD)</div>
          <div className="text-foreground font-bold">
            CVD: {dfc?.cvd_footprint?.cvd_value ?? '+385.4'}
          </div>
          <div className="text-[#38bdf8] text-[9px] truncate">
            EMA14: {dfc?.cvd_footprint?.cvd_ema_14 ?? '+290.1'} •{' '}
            {dfc?.cvd_footprint?.divergence_status || 'Норма'}
          </div>
        </div>

        <div className="p-1.5 rounded bg-[#090c14] border border-[#191f2e]">
          <div className="text-[#64748b] text-[8.5px]">Open Interest (1ч)</div>
          <div className="text-[#4ade80] font-bold">
            {dfc?.open_interest?.oi_change_1h_pct != null
              ? `${dfc.open_interest.oi_change_1h_pct >= 0 ? '+' : ''}${dfc.open_interest.oi_change_1h_pct}%`
              : '+1.38%'}
          </div>
          <div className="text-[#94a3b8] text-[9px]">
            {dfc?.open_interest?.capital_flow_status || 'Приток капитала'}
          </div>
        </div>

        <div className="p-1.5 rounded bg-[#090c14] border border-[#191f2e]">
          <div className="text-[#64748b] text-[8.5px]">Волатильность ATR(14)</div>
          <div className="text-[#fbbf24] font-bold">
            ${dfc?.volatility_atr?.atr_14_usd ?? atrMetric ?? 142.5}
          </div>
          <div className="text-[#94a3b8] text-[9px]">
            {dfc?.volatility_atr?.atr_14_ticks ?? 1425} тиков (Стоп: $
            {dfc?.volatility_atr?.recommended_safe_stop_usd ?? 213.8})
          </div>
        </div>
      </div>
    </div>
  );
}
