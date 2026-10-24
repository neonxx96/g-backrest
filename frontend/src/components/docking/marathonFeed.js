/**
 * Единая выборка позиций и сделок ночного марафона (Overnight Pilot).
 * Backend отдаёт /api/overnight-pilot/status в виде { sessions: { SYM: { paper: { open_positions, closed_trades } } } }.
 * Каждой записи проставляется _source: 'marathon', чтобы UI мог пометить её как тестовый (paper) баланс.
 */

export function collectMarathonPositions(pilotStatus) {
  return Object.values(pilotStatus?.sessions || {})
    .flatMap((s) => (s?.paper?.open_positions) || [])
    .map((p) => ({ ...p, _source: 'marathon' }));
}

export function collectMarathonTrades(pilotStatus) {
  return Object.values(pilotStatus?.sessions || {})
    .flatMap((s) => (s?.paper?.closed_trades) || [])
    .map((t) => ({ ...t, _source: 'marathon' }));
}

/** Объединение paper-списков: live-раннер + марафон (сделки и позиции обеих систем тестовые). */
export function mergePaperLists(liveList, marathonList) {
  return [...(liveList || []), ...(marathonList || [])];
}

/** Доступна ли сводка марафона (хотя бы одна сессия с paper-данными). */
export function hasMarathonData(pilotStatus, positions = [], trades = []) {
  const agg = pilotStatus?.aggregate?.paper;
  return Boolean(agg?.available) || positions.length > 0 || trades.length > 0;
}
