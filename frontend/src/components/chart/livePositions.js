// Живые позиции на графике (задача Di 2026-10-24): нормализация открытых позиций
// из всех активных paper-сессий (марафон overnight-pilot + live-раннер) в единый
// контракт для оверлея livePosition. Truth-first: отсутствующие поля остаются null,
// ничего не синтезируется. Чистая функция — покрыта node:test.

/**
 * @typedef {Object} LiveChartPosition
 * @property {string} key        уникальный ключ позиции (source:symbol:side:entryTs)
 * @property {string} symbol     например "BTCUSDT"
 * @property {string} side       "LONG" | "SHORT"
 * @property {number|null} qty   объём позиции
 * @property {number|null} entryPrice
 * @property {number|null} entryTs   ms
 * @property {number|null} stopPrice
 * @property {number|null} targetPrice
 * @property {number|null} tp2Price
 * @property {number|null} unrealizedPnl
 * @property {string} reason
 * @property {string} source     "marathon" | "live_runner"
 * @property {string} sourceLabel  короткая подпись для бейджа на графике
 */

function normalize(raw, source, sourceLabel) {
  if (!raw || typeof raw !== 'object') return null;
  const symbol = String(raw.symbol || '').toUpperCase();
  if (!symbol) return null;
  const entryTs = Number(raw.entry_ts);
  const side = String(raw.side || '').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
  return {
    key: `${source}:${symbol}:${side}:${Number.isFinite(entryTs) ? entryTs : 0}`,
    symbol,
    side,
    qty: Number.isFinite(Number(raw.qty)) ? Number(raw.qty) : null,
    entryPrice: Number.isFinite(Number(raw.avg_entry_price)) ? Number(raw.avg_entry_price) : null,
    entryTs: Number.isFinite(entryTs) ? entryTs : null,
    stopPrice: Number.isFinite(Number(raw.stop_price)) ? Number(raw.stop_price) : null,
    targetPrice: Number.isFinite(Number(raw.target_price)) ? Number(raw.target_price) : null,
    tp2Price: Number.isFinite(Number(raw.tp2_price)) && Number(raw.tp2_price) > 0 ? Number(raw.tp2_price) : null,
    unrealizedPnl: Number.isFinite(Number(raw.unrealized_pnl)) ? Number(raw.unrealized_pnl) : null,
    reason: String(raw.reason || ''),
    source,
    sourceLabel,
  };
}

/**
 * Собирает открытые позиции по символу из ответов /api/overnight-pilot/status
 * и /api/paper-trading/live/status.
 * @param {object} pilotStatus  тело /api/overnight-pilot/status ({sessions: {SYM: {paper: {open_positions: [...]}}}})
 * @param {object} liveStatus   тело /api/paper-trading/live/status ({runner: {open_positions: [...]}})
 * @param {string} symbol       активный символ графика
 * @returns {LiveChartPosition[]}
 */
export function collectOpenPositions(pilotStatus, liveStatus, symbol) {
  const sym = String(symbol || '').toUpperCase();
  if (!sym) return [];
  const out = [];

  const sessions = (pilotStatus && pilotStatus.sessions) || {};
  for (const [sessionKey, session] of Object.entries(sessions)) {
    const paper = session && session.paper;
    const list = (paper && paper.open_positions) || [];
    const strategy = String(session.strategy_type || (paper && paper.strategy_type) || '');
    const sourceLabel = strategy ? `марафон · ${strategy}` : `марафон · ${sessionKey}`;
    for (const raw of list) {
      const pos = normalize(raw, 'marathon', sourceLabel);
      if (pos && pos.symbol === sym) out.push(pos);
    }
  }

  const runner = (liveStatus && liveStatus.runner) || {};
  const runnerList = runner.open_positions || [];
  const runnerStrategy = String(runner.strategy_type || '');
  const runnerLabel = runnerStrategy ? `live · ${runnerStrategy}` : 'live-раннер';
  for (const raw of runnerList) {
    const pos = normalize(raw, 'live_runner', runnerLabel);
    if (pos && pos.symbol === sym) out.push(pos);
  }

  return out;
}
