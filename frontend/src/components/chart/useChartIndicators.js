import { useEffect, useCallback, useRef } from 'react';
import { INDICATORS_REGISTRY } from '../../config/indicatorsRegistry';
import { buildChartStyles } from './chartStyles.js';

// Синхронизация индикаторов с инстансом KLineCharts: эффект внешнего пропа
// chartIndicators (ema/vol/cvd/rsi/macd/atr/deltaBars/vwap/walls/liquidations/
// heatmap), syncIndicatorsWithChart по INDICATORS_REGISTRY, ref-зеркало
// activeIndicators, обработчики каталога (add/remove/toggle/save) и динамическое
// Применение uiConfig (buildChartStyles + pricePrecision).
// Извлечено ДОСЛОВНО из Chart.jsx (слайс 6.4n, п.1 MODULARIZATION_PLAN);
// эффект синка chartIndicators исправлен после слайса (latent-баг оригинала:
// мёртвое обращение к несуществующему state `indicators`) — см. комментарий
// у эффекта.
// Депсы: chartRef, chartId, uiConfig, symbol, chartReady, chartIndicators,
// activeIndicators, setActiveIndicators, setPanelIndicators (useLayoutStore,
// из Chart.jsx), setStatusMsg, setShowVwap, setShowWalls, setShowLiquidations,
// setShowHeatmap.

export function useChartIndicators({
  chartRef, chartId, uiConfig, symbol, chartReady, chartIndicators,
  activeIndicators, setActiveIndicators, setPanelIndicators,
  setStatusMsg, setShowVwap, setShowWalls, setShowLiquidations, setShowHeatmap,
}) {
  // Synchronize indicators with external IndicatorsModal state.
  // FIX (после слайса 6.4n): оригинал миррировал состояние в несуществующий
  // state `indicators` (setIndicators) — ветка мёртвая (проп chartIndicators
  // никто не передаёт), но при пробросе пропа кинула бы ReferenceError.
  // Дедуп-зеркало перенесено в ref: повторный create/remove только при смене
  // значения; эффект по-прежнему гоняется на [chartIndicators, uiConfig].
  const appliedChartIndicatorsRef = useRef({});
  useEffect(() => {
    if (!chartIndicators) return;
    const applied = appliedChartIndicatorsRef.current;
    const syncFlag = (key, value, apply) => {
      if (typeof value !== 'boolean') return;
      if (applied[key] === value) return;
      applied[key] = value;
      apply(value);
    };
    syncFlag('ema', chartIndicators.ema, (v) => {
      if (!chartRef.current) return;
      if (v) {
        chartRef.current.createIndicator({
          name: 'EMA',
          calcParams: uiConfig?.emaPeriods || [9, 21, 50]
        }, true, { id: 'candle_pane' });
      } else {
        chartRef.current.removeIndicator('candle_pane', 'EMA');
      }
    });
    syncFlag('vol', chartIndicators.vol, (v) => {
      if (!chartRef.current) return;
      if (v) {
        chartRef.current.createIndicator('VOL', false, { id: 'pane_vol', height: 70 });
      } else {
        try { chartRef.current.removeIndicator('pane_vol', 'VOL'); } catch (_) {}
        try { chartRef.current.removeIndicator({ name: 'VOL' }); } catch (_) {}
      }
    });
    syncFlag('cvd', chartIndicators.cvd, (v) => {
      if (!chartRef.current) return;
      if (v) {
        chartRef.current.createIndicator('CVD', false, { id: 'pane_cvd', height: 75 });
      } else {
        try { chartRef.current.removeIndicator('pane_cvd', 'CVD'); } catch (_) {}
        try { chartRef.current.removeIndicator({ name: 'CVD' }); } catch (_) {}
      }
    });
    syncFlag('rsi', chartIndicators.rsi, (v) => {
      if (!chartRef.current) return;
      if (v) {
        chartRef.current.createIndicator('RSI', false, { id: 'pane_rsi', height: 70 });
      } else {
        try { chartRef.current.removeIndicator('pane_rsi', 'RSI'); } catch (_) {}
        try { chartRef.current.removeIndicator({ name: 'RSI' }); } catch (_) {}
      }
    });
    syncFlag('macd', chartIndicators.macd, (v) => {
      if (!chartRef.current) return;
      if (v) {
        chartRef.current.createIndicator('MACD', false, { id: 'pane_macd', height: 75 });
      } else {
        try { chartRef.current.removeIndicator('pane_macd', 'MACD'); } catch (_) {}
        try { chartRef.current.removeIndicator({ name: 'MACD' }); } catch (_) {}
      }
    });
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
    syncFlag('vwap', chartIndicators.vwap, (v) => {
      setShowVwap(v);
    });
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
