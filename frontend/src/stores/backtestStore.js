import { create } from 'zustand';
import { useTradeOverlayStore } from './tradeOverlayStore';

const API_BASE = '/api';

/**
 * Backtest Store
 * 
 * Central state for quantitative backtesting runs, chart trade overlays,
 * trade log tables, and real-time Risk/Reward parameter synchronization.
 */
export const useBacktestStore = create((set, get) => ({
  isRunning: false,
  error: null,
  activeResult: null,
  showTradesOnChart: true,
  selectedTradeId: null,
  
  // Strategy settings
  strategyType: 'confluence_ema',
  days: 14,
  initialCapital: 10000,

  setShowTradesOnChart: (show) => set({ showTradesOnChart: Boolean(show) }),
  setSelectedTradeId: (id) => set({ selectedTradeId: id }),
  setStrategyType: (strategyType) => set({ strategyType }),
  setDays: (days) => set({ days: Number(days) || 14 }),

  clearResult: () => set({ activeResult: null, error: null, selectedTradeId: null }),

  /**
   * Run Quick Backtest for the active chart symbol and timeframe.
   * Seamlessly injects interactive Risk/Reward Box levels if present on the chart.
   */
  runQuickBacktest: async ({ symbol = 'BTCUSDT', timeframe = '15m', strategyOverride = null }) => {
    set({ isRunning: true, error: null });

    try {
      const activeSetup = useTradeOverlayStore.getState().activeSetup;
      const currentStrategy = strategyOverride || get().strategyType || 'confluence_ema';
      const days = get().days || 14;
      const initialCapital = get().initialCapital || 10000;

      const payload = {
        symbol: symbol.toUpperCase(),
        timeframe: timeframe,
        days: days,
        strategy_type: currentStrategy,
        initial_capital: initialCapital,
        params: {
          maker_fee_pct: 0.02,
          taker_fee_pct: 0.05,
          slippage_ticks: 2,
          use_multi_tp: true,
          use_cvd_filter: true,
          use_atr_filter: true,
          use_rsi_filter: true,
        }
      };

      // If user has an active Risk/Reward box on the chart, synchronize its exact levels
      if (activeSetup && activeSetup.entry_price > 0) {
        const slPct = Math.abs(Number(activeSetup.sl_pct) || 0.8);
        const tpPct = Math.abs(Number(activeSetup.tp1_pct) || 1.5);
        const rrRatio = Number(activeSetup.rr_ratio) || (tpPct / slPct);

        payload.stop_loss_pct = slPct;
        payload.take_profit_pct = tpPct;
        payload.params.stop_loss_pct = slPct;
        payload.params.take_profit_pct = tpPct;
        payload.params.tp1_rr_ratio = Number(rrRatio.toFixed(2));
        payload.params.entry_mode = activeSetup.direction;
        
        // Include source setup metadata
        payload.source_setup = {
          entry_price: activeSetup.entry_price,
          tp1_price: activeSetup.tp1_price,
          sl_price: activeSetup.sl_price,
          direction: activeSetup.direction,
          rr_ratio: activeSetup.rr_ratio
        };
      }

      console.log("[BACKTEST-STORE] Sending payload:", JSON.stringify(payload));

      const res = await fetch(`${API_BASE}/backtest/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Ошибка сервера (${res.status})`);
      }

      const data = await res.json();
      console.log("[BACKTEST-STORE] Backtest completed, received trades:", data.trades?.length);
      
      // Inject symbol and timeframe into result for strict matching
      data.symbol = symbol.toUpperCase();
      data.timeframe = timeframe;

      set({
        activeResult: data,
        isRunning: false,
        error: null,
        showTradesOnChart: true
      });

      return data;
    } catch (err) {
      const errMsg = err.message || 'Ошибка выполнения бэктеста';
      set({ error: errMsg, isRunning: false });
      throw err;
    }
  }
}));
