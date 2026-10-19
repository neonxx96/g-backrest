import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useTradeOverlayStore } from './tradeOverlayStore';

const API_BASE = '/api';

export const DEFAULT_TICKER_PARAMS = {
  strategy_type: 'confluence_ema',
  timeframe: '5m',
  days: 14,
  initialCapital: 10000,
  stop_loss_pct: 0.8,
  take_profit_pct: 1.6,
  leverage: 2,
  min_density_usd: 100000,
  volume_multiplier: 1.0,
  entryMode: 'limit_bounce',
  slMode: 'behind_wall',
  wallSlOffsetTicks: 5,
  tp1RrRatio: 1.5,
  tp2Mode: 'opposite_wall',
  tp2RrRatio: 2.8,
  minWallLifetimeSec: 30,
  maker_fee_pct: 0.02,
  taker_fee_pct: 0.05,
  slippage_ticks: 2,
  use_multi_tp: true,
  use_dynamic_breakeven: true,
  dynamic_be_trigger_r: 0.5,
  use_cvd_filter: false,
  use_oi_filter: false,
  use_atr_filter: false,
  use_atr_sl: false,
  atr_multiplier: 1.5,
  use_rsi_filter: false,
};

/**
 * Backtest Store
 * 
 * Central state for quantitative backtesting runs, chart trade overlays,
 * trade log tables, and real-time Risk/Reward parameter synchronization.
 * Uses persistent storage and per-symbol parameter isolation to prevent UI ticker bleed.
 */
export const useBacktestStore = create(
  persist(
    (set, get) => ({
      isRunning: false,
      error: null,
      activeResult: null,
      showTradesOnChart: true,
      selectedTradeId: null,
      
      // Strategy settings (global defaults)
      strategyType: 'confluence_ema',
      days: 14,
      initialCapital: 10000,

      // Isolated parameter map: { [SYMBOL]: { ...params } }
      customParamsBySymbol: {},

      getParamsForSymbol: (symbol) => {
        const symKey = (symbol || 'BTCUSDT').toUpperCase();
        const stored = get().customParamsBySymbol?.[symKey];
        return {
          ...DEFAULT_TICKER_PARAMS,
          strategy_type: get().strategyType || DEFAULT_TICKER_PARAMS.strategy_type,
          days: get().days || DEFAULT_TICKER_PARAMS.days,
          initialCapital: get().initialCapital || DEFAULT_TICKER_PARAMS.initialCapital,
          ...(stored || {})
        };
      },

      setParamsForSymbol: (symbol, partialParams) => {
        const symKey = (symbol || 'BTCUSDT').toUpperCase();
        set((state) => ({
          customParamsBySymbol: {
            ...state.customParamsBySymbol,
            [symKey]: {
              ...(state.customParamsBySymbol?.[symKey] || DEFAULT_TICKER_PARAMS),
              ...partialParams,
            }
          }
        }));
      },

      setShowTradesOnChart: (show) => set({ showTradesOnChart: Boolean(show) }),
      setSelectedTradeId: (id) => set({ selectedTradeId: id }),
      setStrategyType: (strategyType) => set({ strategyType }),
      setDays: (days) => set({ days: Number(days) || 14 }),

      clearResult: () => set({ activeResult: null, error: null, selectedTradeId: null }),

      /**
       * Run Quick Backtest for the active chart symbol and timeframe.
       * Uses isolated per-symbol custom parameters and seamlessly injects
       * interactive Risk/Reward Box levels if present on the chart.
       */
      runQuickBacktest: async ({ symbol = 'BTCUSDT', timeframe = '15m', strategyOverride = null }) => {
        set({ isRunning: true, error: null });

        try {
          const symKey = symbol.toUpperCase();
          const symbolParams = get().getParamsForSymbol(symKey);
          const activeSetup = useTradeOverlayStore.getState().activeSetup;
          const currentStrategy = strategyOverride || symbolParams.strategy_type || get().strategyType || 'confluence_ema';
          const days = symbolParams.days || get().days || 14;
          const initialCapital = symbolParams.initialCapital || get().initialCapital || 10000;

          const slPct = Number(symbolParams.stop_loss_pct) || 0.8;
          const tpPct = Number(symbolParams.take_profit_pct) || 1.6;

          const payload = {
            symbol: symKey,
            timeframe: timeframe || symbolParams.timeframe || '15m',
            days: days,
            strategy_type: currentStrategy,
            initial_capital: initialCapital,
            params: {
              stop_loss_pct: slPct,
              take_profit_pct: tpPct,
              leverage: Number(symbolParams.leverage) || 2,
              min_density_usd: Number(symbolParams.min_density_usd) || 100000,
              volume_multiplier: Number(symbolParams.volume_multiplier) || 1.0,
              maker_fee_pct: Number(symbolParams.maker_fee_pct) >= 0 ? Number(symbolParams.maker_fee_pct) : 0.02,
              taker_fee_pct: Number(symbolParams.taker_fee_pct) >= 0 ? Number(symbolParams.taker_fee_pct) : 0.05,
              slippage_ticks: Number(symbolParams.slippage_ticks) >= 0 ? Number(symbolParams.slippage_ticks) : 2,
              use_multi_tp: symbolParams.use_multi_tp !== undefined ? Boolean(symbolParams.use_multi_tp) : true,
              use_dynamic_breakeven: symbolParams.use_dynamic_breakeven !== undefined ? Boolean(symbolParams.use_dynamic_breakeven) : true,
              dynamic_be_trigger_r: Number(symbolParams.dynamic_be_trigger_r) || 0.5,
              use_cvd_filter: Boolean(symbolParams.use_cvd_filter),
              use_oi_filter: Boolean(symbolParams.use_oi_filter),
              use_atr_filter: Boolean(symbolParams.use_atr_filter),
              use_atr_sl: Boolean(symbolParams.use_atr_sl),
              atr_multiplier: Number(symbolParams.atr_multiplier) || 1.5,
              use_rsi_filter: Boolean(symbolParams.use_rsi_filter),
              entry_mode: symbolParams.entryMode || 'limit_bounce',
              sl_mode: symbolParams.slMode || 'behind_wall',
              wall_sl_offset_ticks: Number(symbolParams.wallSlOffsetTicks) || 5,
              tp1_rr_ratio: Number(symbolParams.tp1RrRatio) || 1.5,
              tp2_mode: symbolParams.tp2Mode || 'opposite_wall',
              tp2_rr_ratio: Number(symbolParams.tp2RrRatio) || 2.8,
              min_wall_lifetime_sec: Number(symbolParams.minWallLifetimeSec) || 30
            }
          };

          // If user has an active Risk/Reward box on the chart, synchronize its exact levels
          if (activeSetup && activeSetup.entry_price > 0) {
            const boxSlPct = Math.abs(Number(activeSetup.sl_pct) || slPct);
            const boxTpPct = Math.abs(Number(activeSetup.tp1_pct) || tpPct);
            const rrRatio = Number(activeSetup.rr_ratio) || (boxTpPct / boxSlPct);

            payload.stop_loss_pct = boxSlPct;
            payload.take_profit_pct = boxTpPct;
            payload.params.stop_loss_pct = boxSlPct;
            payload.params.take_profit_pct = boxTpPct;
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
          data.symbol = symKey;
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
    }),
    {
      name: 'signalscript_backtest_storage',
      partialize: (state) => ({
        customParamsBySymbol: state.customParamsBySymbol,
        strategyType: state.strategyType,
        days: state.days,
        initialCapital: state.initialCapital,
        showTradesOnChart: state.showTradesOnChart,
        activeResult: state.activeResult,
      }),
    }
  )
);
