// Каталог стратегий и таймфреймов бэктест-панели.
// Вынесено из BacktestPanel.jsx (модульный план, п.2) — единый источник для панели и формы параметров.
// ВАЖНО: App.jsx и features/pilot/model.js содержат СВОИ независимые копии — их не трогать.

export const STRATEGIES = [
  // Historical Flow & Volume Engine (100% реальные исторические данные)
  {
    id: 'confluence_ema',
    label: '🟢 Confluence EMA (CVD+RSI)',
    group: 'historical',
    badge: 'Реальная история',
    description: 'Мультифакторный трендовый сетап с подтверждением по дельте'
  },
  {
    id: 'cvd_absorption',
    label: '🟢 CVD Absorption (Поглощение)',
    group: 'historical',
    badge: 'Реальная история',
    description: 'Дивергенция кумулятивной дельты и цены на экстремумах'
  },
  {
    id: 'cluster_volume_bounce',
    label: '🟢 Cluster Volume Bounce (Отскок)',
    group: 'historical',
    badge: 'Реальная история',
    description: 'Пинбар с кульминацией кластерного объема свечи (Volume Climax)'
  },
  {
    id: 'ema_trend',
    label: '🟢 EMA Trend Momentum',
    group: 'historical',
    badge: 'Реальная история',
    description: 'Пересечение EMA(20/50) с подтверждением покупок по дельте'
  },
  {
    id: 'ema_pullback',
    label: '🟢 EMA Pullback (отскок в тренде)',
    group: 'historical',
    badge: 'Реальная история',
    description: 'Касание EMA20 и возврат по тренду — больше сигналов, чем у пересечения EMA(20/50)'
  },
  {
    id: 'ema_trend_window',
    label: '🟢 EMA Trend Window (подтверждение кросса)',
    group: 'historical',
    badge: 'Реальная история',
    description: 'Вход в окне 8 баров после кросса EMA(20/50): тренд сохранён, close вернулся по стороне кросса от EMA20'
  },
  // Live Order Book Sentinel (Только Real-time L2)
  {
    id: 'live_density_bounce',
    label: '🟠 Плотность стакана L2 [Live]',
    group: 'live',
    badge: 'Только Live L2',
    isLiveOnly: true,
    description: 'Работает только в реальном времени. Биржа не хранит исторический стакан.'
  }
];
export const TIMEFRAMES = ['1m', '5m', '15m', '1h'];
