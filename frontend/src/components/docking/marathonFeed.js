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

/**
 * Maps the server-owned run state into a compact, truthful UI label.  A
 * restored snapshot is useful history, but is never represented as a live
 * paper runner until an explicit preflight/start creates fresh runners.
 */
export function getPilotRunState(pilotStatus) {
  const sessionCount = Object.keys(pilotStatus?.sessions || {}).length;
  if (pilotStatus?.pilot_running) {
    return { kind: 'running', label: 'RUNNING', sessionCount };
  }
  if (pilotStatus?.recovery?.required) {
    return {
      kind: 'recovery_required',
      label: 'ТРЕБУЕТ НОВОЙ ПРОВЕРКИ',
      sessionCount: Number(pilotStatus.recovery.session_count) || sessionCount,
    };
  }
  return { kind: 'stopped', label: 'STOPPED', sessionCount };
}

/**
 * Read the one shared Overnight Pilot account without falling back to the
 * unrelated legacy $100 paper wallet.  Missing identity is deliberately
 * represented as unavailable rather than a fabricated balance.
 */
export function getSharedPilotAccount(pilotStatus) {
  const paper = pilotStatus?.aggregate?.paper;
  const accountId = typeof paper?.account_id === 'string' && paper.account_id.trim()
    ? paper.account_id
    : null;
  const equity = Number(paper?.equity);
  const initialBalance = Number(paper?.starting_balance);

  if (!paper?.available || !accountId || !Number.isFinite(equity) || !Number.isFinite(initialBalance)) {
    return { available: false, accountId: null, runId: null, equity: null, initialBalance: null, stateSource: 'unavailable' };
  }

  return {
    available: true,
    accountId,
    runId: typeof paper.run_id === 'string' && paper.run_id.trim() ? paper.run_id : null,
    equity,
    initialBalance,
    stateSource: paper.state_source || 'unknown',
  };
}
