import { create } from 'zustand';

/**
 * Trade Overlay Store (Transient Zero-Latency Store)
 * 
 * Manages transient Risk/Reward setup coordinates and levels during chart dragging
 * without triggering React component tree re-renders.
 * 
 * Read directly via `useTradeOverlayStore.getState()` inside requestAnimationFrame
 * or canvas render loops (such as OrderBookCanvasLadder).
 */

export function calculatePositionMetrics({ entryPrice, tpPrice, slPrice, riskUsd = 50 }) {
  const entry = Number(entryPrice) || 0;
  const tp = Number(tpPrice) || 0;
  const sl = Number(slPrice) || 0;
  if (entry <= 0 || tp <= 0 || sl <= 0) return null;

  const isLong = tp >= entry;
  const direction = isLong ? 'LONG' : 'SHORT';

  const profitDiff = Math.abs(tp - entry);
  const lossDiff = Math.abs(entry - sl);

  const tpPct = (profitDiff / entry) * 100;
  const slPct = (lossDiff / entry) * 100;

  const rrRatio = lossDiff > 0 ? profitDiff / lossDiff : 0;
  const rewardUsd = riskUsd * rrRatio;

  return {
    direction,
    entry_price: entry,
    tp1_price: tp,
    tp2_price: tp,
    sl_price: sl,
    tp1_pct: Number(tpPct.toFixed(2)),
    sl_pct: -Number(slPct.toFixed(2)),
    rr_ratio: Number(rrRatio.toFixed(2)),
    risk_usd: Number(riskUsd.toFixed(1)),
    reward_usd: Number(rewardUsd.toFixed(1))
  };
}

export const useTradeOverlayStore = create((set, get) => ({
  activeSetup: null,
  isDragging: false,

  setTransientSetup: (setup) => {
    set({ activeSetup: setup });
  },

  clearSetup: () => {
    set({ activeSetup: null, isDragging: false });
  },

  setIsDragging: (isDragging) => {
    set({ isDragging });
  }
}));

export default useTradeOverlayStore;
