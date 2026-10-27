import React from 'react';
import { Magnet } from 'lucide-react';

// Stage 3.2: Liquidity Magnet & Depth Ratio (±1.5% Corridor) — карточка сайдбара AI Copilot.

export default function LiquidityMagnetCard({ liquidityMagnet }) {
  return (
    <div
      data-testid="ai-liquidity-magnet-card"
      className="p-2.5 rounded-lg border border-[#38bdf830] bg-[#0c1322] space-y-2 font-mono text-[10px]"
    >
      <div className="flex items-center justify-between">
        <span className="font-bold text-foreground text-[10.5px] flex items-center space-x-1">
          <Magnet size={13} className="text-[#38bdf8]" />
          <span>Магнит ликвидности (Liquidity Magnet)</span>
        </span>
        <span
          className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold ${
            liquidityMagnet.magnet_vector === 'BID_MAGNET'
              ? 'bg-[#10b98125] text-[#10b981] border border-[#10b98150]'
              : liquidityMagnet.magnet_vector === 'ASK_MAGNET'
              ? 'bg-[#ef444425] text-[#ef4444] border border-[#ef444450]'
              : 'bg-[#64748b25] text-[#94a3b8]'
          }`}
        >
          {liquidityMagnet.magnet_vector || 'NEUTRAL'}
        </span>
      </div>

      <div className="text-[10px] text-[#cbd5e1] leading-snug">
        {liquidityMagnet.magnet_description}
      </div>

      <div className="grid grid-cols-2 gap-1.5 pt-0.5">
        <div className="p-1.5 rounded bg-[#080d18] border border-[#172238]">
          <div className="text-[#64748b] text-[8.5px]">Глубина Bids (±1.5%)</div>
          <div className="text-[#10b981] font-bold text-[11px]">
            ${(liquidityMagnet.bids_volume_usd / 1000000).toFixed(2)}M
          </div>
          {liquidityMagnet.nearest_major_bid_wall && (
            <div className="text-[#94a3b8] text-[8.5px]">
              Стенка: ${liquidityMagnet.nearest_major_bid_wall.price} ({liquidityMagnet.nearest_major_bid_wall.dist_pct}%)
            </div>
          )}
        </div>

        <div className="p-1.5 rounded bg-[#080d18] border border-[#172238]">
          <div className="text-[#64748b] text-[8.5px]">Глубина Asks (±1.5%)</div>
          <div className="text-[#ef4444] font-bold text-[11px]">
            ${(liquidityMagnet.asks_volume_usd / 1000000).toFixed(2)}M
          </div>
          {liquidityMagnet.nearest_major_ask_wall && (
            <div className="text-[#94a3b8] text-[8.5px]">
              Стенка: ${liquidityMagnet.nearest_major_ask_wall.price} ({liquidityMagnet.nearest_major_ask_wall.dist_pct}%)
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between bg-[#080d18] p-1.5 rounded border border-[#172238]">
        <span className="text-[#94a3b8] text-[9.5px]">Соотношение глубин (Bid/Ask):</span>
        <span data-testid="ai-magnet-ratio" className="text-[#38bdf8] font-bold text-[11px]">
          {liquidityMagnet.bid_ask_depth_ratio}x
        </span>
      </div>
    </div>
  );
}
