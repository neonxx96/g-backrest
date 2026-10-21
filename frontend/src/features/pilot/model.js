export const STRATEGIES = [
  { id: 'confluence_ema', label: 'Тренд EMA + фильтры' },
  { id: 'cvd_absorption', label: 'Поглощение объёма (CVD)' },
  { id: 'cluster_volume_bounce', label: 'Отскок от объёмного уровня' },
];

export function allocateCapital(total, count) {
  const cents = Math.round(Number(total) * 100);
  if (!Number.isSafeInteger(cents) || !Number.isInteger(count) || count < 1 || cents < count) throw new Error('Депозит должен покрывать каждую долю (минимум $0.01).');
  return Array.from({ length: count }, (_, i) => (Math.floor(cents / count) + (i < cents % count ? 1 : 0)) / 100);
}

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const configKey = configs => JSON.stringify(canonical(configs));
export const hasRunning = status => Object.values(status?.sessions || {}).some(s => s.paper?.is_running === true);

export function validateConfigs(configs) {
  const errors = [];
  if (!Array.isArray(configs) || !configs.length || configs.length > 5) return ['Выберите от 1 до 5 монет.'];
  const symbols = new Set();
  for (const c of configs) {
    const symbol = String(c.symbol || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol) || symbols.has(symbol)) errors.push('Монеты должны быть уникальными USDT-парами.');
    symbols.add(symbol);
    if (!STRATEGIES.some(s => s.id === c.strategy_type)) errors.push(`${symbol}: выберите поддержанную стратегию.`);
    if (!['1m', '5m', '15m', '1h'].includes(c.timeframe)) errors.push(`${symbol}: выберите таймфрейм.`);
    for (const [key, min, max, label] of [
      ['initial_capital', 0.01, Number.MAX_SAFE_INTEGER / 100, 'депозит'], ['risk_per_trade_pct', 0.01, 10, 'риск'],
      ['stop_loss_pct', 0.01, 50, 'стоп'], ['take_profit_pct', 0.01, 200, 'цель'], ['leverage', 1, 125, 'плечо'],
      ['days', 1, 30, 'история'], ['duration_hours', 1, 12, 'длительность'],
    ]) {
      if (c[key] === '' || !Number.isFinite(Number(c[key])) || Number(c[key]) < min || Number(c[key]) > max) errors.push(`${symbol}: ${label} — от ${min} до ${max}.`);
    }
    if (!Number.isInteger(Number(c.days))) errors.push(`${symbol}: период истории задаётся целым числом дней.`);
  }
  return errors;
}

export function readReport(result) {
  if (result?.report?.schema_version === 1) return result.report;
  return { status: 'unavailable', metrics: null, sample: {}, validation: {}, data_availability: {} };
}

export function optimizerRequest(config) {
  return { ...config, optimizer_mode: 'genetic', current_sl_pct: config.stop_loss_pct,
    current_tp_pct: config.take_profit_pct, current_wall_usd: config.min_density_usd,
    sl_min: Math.max(0.05, config.stop_loss_pct * 0.75), sl_max: Math.min(20, config.stop_loss_pct * 1.25),
    tp_min: Math.max(0.1, config.take_profit_pct * 0.75), tp_max: Math.min(100, config.take_profit_pct * 1.25) };
}

export function optimizedPatch(result) {
  const best = result?.meta?.best_params;
  if (!best) throw new Error('Оптимизатор не вернул параметры.');
  // Only parameters supported by the pilot configuration may enter its next run.
  const aliases = { sl_pct: 'stop_loss_pct', tp_pct: 'take_profit_pct', wall_usd: 'min_density_usd' };
  const allowed = new Set(['stop_loss_pct', 'take_profit_pct', 'min_density_usd', 'volume_multiplier', 'use_cvd_filter', 'use_atr_filter', 'use_rsi_filter']);
  return Object.fromEntries(Object.entries(best).map(([key, value]) => [aliases[key] || key, value]).filter(([key]) => allowed.has(key)));
}
