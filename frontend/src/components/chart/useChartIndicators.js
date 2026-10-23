import { useEffect, useCallback, useRef } from 'react';
import { INDICATORS_REGISTRY } from '../../config/indicatorsRegistry';
import { buildChartStyles } from './chartStyles.js';

// Синхронизация индикаторов с инстансом KLineCharts: эффект внешнего пропа
// chartIndicators (ema/vol/cvd/rsi/macd/atr/deltaBars/vwap/walls/liquidations/
// heatmap), syncIndicatorsWithChart по INDICATORS_REGISTRY, ref-зеркало
// activeIndicators, обработчики каталога (add/remove/toggle/save) и динамическое
// применение uiConfig (buildChartStyles + pricePrecision).
// Извлечено ДОСЛОВНО из Chart.jsx (слайс 6.4n, п.1 MODULARIZATION_PLAN).
// Депсы: chartRef, chartId, uiConfig, symbol, chartReady, chartIndicators,
// activeIndicators, setActiveIndicators, setPanelIndicators (useLayoutStore,
// из Chart.jsx), setStatusMsg, setShowVwap, setShowWalls, setShowLiquidations,
// setShowHeatmap.
// ИЗВЕСТНЫЙ LATENT-БАГ (дословно из оригинала, не исправляем в слайсе): в эффекте
// синка chartIndicators используется несуществующий сеттер setIndicators —
// мёртвый код, т.к. проп chartIndicators ни один родитель не передаёт (early
// return на null). При передаче пропа ветка ema/vol/... кинула бы ReferenceError
// — поведение 1:1 с оригиналом, чинить отдельной задачей.

export function useChartIndicators({
  chartRef, chartId, uiConfig, symbol, chartReady, chartIndicators,
  activeIndicators, setActiveIndicators, setPanelIndicators,
  setStatusMsg, setShowVwap, setShowWalls, setShowLiquidations, setShowHeatmap,
}) {
  // Synchronize indicators with external IndicatorsModal state
  useEffect(() => {
    if (!chartIndicators) return;
    if (typeof chartIndicators.ema === 'boolean') {
      setIndicators(prev => {
        if (prev.ema !== chartIndicators.ema) {
          if (chartRef.current) {
            if (chartIndicators.ema) {
              chartRef.current.createIndicator({
                name: 'EMA',
                calcParams: uiConfig?.emaPeriods || [9, 21, 50]
              }, true, { id: 'candle_pane' });
            } else {
              chartRef.current.removeIndicator('candle_pane', 'EMA');
            }
          }
          return { ...prev, ema: chartIndicators.ema };
        }
        return prev;
      });
    }
    if (typeof chartIndicators.vol === 'boolean') {
      setIndicators(prev => {
        if (prev.vol !== chartIndicators.vol) {
          if (chartRef.current) {
            if (chartIndicators.vol) {
              chartRef.current.createIndicator('VOL', false, { id: 'pane_vol', height: 70 });
            } else {
              try { chartRef.current.removeIndicator('pane_vol', 'VOL'); } catch (_) {}
              try { chartRef.current.removeIndicator({ name: 'VOL' }); } catch (_) {}
            }
          }
          return { ...prev, vol: chartIndicators.vol };
        }
        return prev;
      });
    }
    if (typeof chartIndicators.cvd === 'boolean') {
      setIndicators(prev => {
        if (prev.cvd !== chartIndicators.cvd) {
          if (chartRef.current) {
            if (chartIndicators.cvd) {
              chartRef.current.createIndicator('CVD', false, { id: 'pane_cvd', height: 75 });
            } else {
              try { chartRef.current.removeIndicator('pane_cvd', 'CVD'); } catch (_) {}
              try { chartRef.current.removeIndicator({ name: 'CVD' }); } catch (_) {}
            }
          }
          return { ...prev, cvd: chartIndicators.cvd };
        }
        return prev;
      });
    }
    if (typeof chartIndicators.rsi === 'boolean') {
      setIndicators(prev => {
        if (prev.rsi !== chartIndicators.rsi) {
          if (chartRef.current) {
            if (chartIndicators.rsi) {
              chartRef.current.createIndicator('RSI', false, { id: 'pane_rsi', height: 70 });
            } else {
              try { chartRef.current.removeIndicator('pane_rsi', 'RSI'); } catch (_) {}
              try { chartRef.current.removeIndicator({ name: 'RSI' }); } catch (_) {}
            }
          }
          return { ...prev, rsi: chartIndicators.rsi };
        }
        return prev;
      });
    }
    if (typeof chartIndicators.macd === 'boolean') {
      setIndicators(prev => {
        if (prev.macd !== chartIndicators.macd) {
          if (chartRef.current) {
            if (chartIndicators.macd) {
              chartRef.current.createIndicator('MACD', false, { id: 'pane_macd', height: 75 });
            } else {
              try { chartRef.current.removeIndicator('pane_macd', 'MACD'); } catch (_) {}
              try { chartRef.current.removeIndicator({ name: 'MACD' }); } catch (_) {}
            }
          }
          return { ...prev, macd: chartIndicators.macd };
        }
        return prev;
      });
    }
    if (typeof chartIndicators.atr === 'boolean') {
      if (chartRef.current) {
        if (chartIndicators.atr) {
          chartRef.current.createIndicator('ATR', false, { id: 'pane_atr', height: 70 });
        } else {
          try { chartRef.current.removeIndicator('pane_atr', 'ATR'); } catch (_) {}
          try { chartRef.current.removeIndicator({ name: 'ATR' }); } catch (_) {}
        }
      }
    }
    if (typeof chartIndicators.deltaBars === 'boolean') {
      if (chartRef.current) {
        if (chartIndicators.deltaBars) {
          chartRef.current.createIndicator('DeltaBars', false, { id: 'pane_deltabars', height: 70 });
        } else {
          try { chartRef.current.removeIndicator('pane_deltabars', 'DeltaBars'); } catch (_) {}
          try { chartRef.current.removeIndicator({ name: 'DeltaBars' }); } catch (_) {}
        }
      }
    }
    if (typeof chartIndicators.vwap === 'boolean') {
      setShowVwap(chartIndicators.vwap);
      setIndicators(prev => ({ ...prev, vwap: chartIndicators.vwap }));
    }
    if (typeof chartIndicators.walls === 'boolean') {
      setShowWalls(chartIndicators.walls);
    }
    if (typeof chartIndicators.liquidations === 'boolean') {
      setShowLiquidations(chartIndicators.liquidations);
    }
    if (typeof chartIndicators.heatmap === 'boolean') {
      setShowHeatmap(chartIndicators.heatmap);
    }
  }, [chartIndicators, uiConfig]);




  // Sync modular indicators with KLineCharts instance
  const syncIndicatorsWithChart = useCallback((chart, indicatorsList) => {
    if (!chart) return;
    const activeMap = new Map((indicatorsList || []).map((item) => [item.id, item]));

    Object.values(INDICATORS_REGISTRY).forEach((def) => {
      const activeItem = activeMap.get(def.id);
      const isMain = def.pane === 'main';
      const paneId = isMain ? 'candle_pane' : `pane_${def.id}`;
      const klineName = def.klineName;

      if (!activeItem || activeItem.enabled === false) {
        try {
          if (isMain) {
            chart.removeIndicator(paneId, klineName);
          } else {
            chart.removeIndicator(paneId, klineName);
            chart.removeIndicator({ name: klineName });
          }
        } catch (_) {}
      } else {
        const calcParams = def.toCalcParams(activeItem.inputs || def.defaultInputs);
        const styles = def.toKlineStyles(activeItem.styles || def.defaultStyles);

        try {
          if (isMain) {
            chart.createIndicator({
              name: klineName,
              calcParams,
              styles
            }, true, { id: 'candle_pane' });
            chart.overrideIndicator({
              name: klineName,
              calcParams,
              styles
            }, 'candle_pane');
          } else {
            chart.createIndicator({
              name: klineName,
              calcParams,
              styles
            }, false, { id: paneId, height: def.height || 70 });
            chart.overrideIndicator({
              name: klineName,
              calcParams,
              styles
            }, paneId);
          }
        } catch (_) {
          try {
            chart.createIndicator(klineName, isMain, { id: paneId, height: def.height || 70 });
          } catch (_) {}
        }
      }
    });
  }, []);

  const activeIndicatorsRef = useRef(activeIndicators);
  useEffect(() => {
    activeIndicatorsRef.current = activeIndicators;
  }, [activeIndicators]);

  const handleAddIndicator = useCallback((indId) => {
    const def = INDICATORS_REGISTRY[indId];
    if (!def) return;
    const prev = activeIndicatorsRef.current || [];
    if (prev.some((i) => i.id === indId)) return;
    const next = [
      ...prev,
      {
        id: indId,
        enabled: true,
        inputs: { ...def.defaultInputs },
        styles: { ...def.defaultStyles }
      }
    ];
    activeIndicatorsRef.current = next;
    setActiveIndicators(next);
    setPanelIndicators(chartId, next);
    if (chartRef.current) {
      syncIndicatorsWithChart(chartRef.current, next);
    }
    setStatusMsg(`Добавлен: ${def.shortName}`);
    setTimeout(() => setStatusMsg(''), 1500);
  }, [chartId, setPanelIndicators, syncIndicatorsWithChart]);

  const handleRemoveIndicator = useCallback((indId) => {
    const def = INDICATORS_REGISTRY[indId];
    const prev = activeIndicatorsRef.current || [];
    const next = prev.filter((i) => i.id !== indId);
    activeIndicatorsRef.current = next;
    setActiveIndicators(next);
    setPanelIndicators(chartId, next);
    if (chartRef.current) {
      const isMain = def?.pane === 'main';
      const paneId = isMain ? 'candle_pane' : `pane_${indId}`;
      const klineName = def ? def.klineName : indId.toUpperCase();
      try {
        chartRef.current.removeIndicator(paneId, klineName);
        if (!isMain) chartRef.current.removeIndicator({ name: klineName });
      } catch (_) {}
      syncIndicatorsWithChart(chartRef.current, next);
    }
  }, [chartId, setPanelIndicators, syncIndicatorsWithChart]);

  const handleToggleVisibility = useCallback((indId) => {
    const prev = activeIndicatorsRef.current || [];
    const next = prev.map((item) =>
      item.id === indId ? { ...item, enabled: !item.enabled } : item
    );
    activeIndicatorsRef.current = next;
    setActiveIndicators(next);
    setPanelIndicators(chartId, next);
    if (chartRef.current) {
      syncIndicatorsWithChart(chartRef.current, next);
    }
  }, [chartId, setPanelIndicators, syncIndicatorsWithChart]);

  const handleSaveSettings = useCallback((indId, newInputs, newStyles) => {
    const prev = activeIndicatorsRef.current || [];
    const next = prev.map((item) =>
      item.id === indId
        ? { ...item, inputs: { ...newInputs }, styles: { ...newStyles } }
        : item
    );
    activeIndicatorsRef.current = next;
    setActiveIndicators(next);
    setPanelIndicators(chartId, next);
    if (chartRef.current) {
      syncIndicatorsWithChart(chartRef.current, next);
    }
    setStatusMsg(`Настройки ${indId.toUpperCase()} сохранены`);
    setTimeout(() => setStatusMsg(''), 1500);
  }, [chartId, setPanelIndicators, syncIndicatorsWithChart]);

  // Dynamically apply uiConfig and indicators sync
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (uiConfig) {
      try {
        chart.setStyles(buildChartStyles(uiConfig));
      } catch (_) {}

      try {
        if (uiConfig.pricePrecision && uiConfig.pricePrecision !== 'auto') {
          chart.setPriceVolumePrecision(Number(uiConfig.pricePrecision), 2);
        } else {
          const p = symbol.includes('BTC') ? 1 : symbol.includes('ETH') || symbol.includes('SOL') ? 2 : 4;
          chart.setPriceVolumePrecision(p, 2);
        }
      } catch (_) {}
    }

    // Sync modular indicators with KLineCharts
    syncIndicatorsWithChart(chart, activeIndicators);
  }, [uiConfig, symbol, activeIndicators, syncIndicatorsWithChart, chartReady]);

  return {
    handleAddIndicator, handleRemoveIndicator,
    handleToggleVisibility, handleSaveSettings,
  };
}
