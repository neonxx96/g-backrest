/**
 * Единая сводка paper-торговли «по парам»: марафон (Overnight Pilot) + live-раннер.
 * Одна строка = одна пара: источник(и), стратегия, статус, equity, PnL.
 * Truth-first: отсутствующие значения — null, никаких подмен нулями.
 */

const num = (v) => (v == null || !isFinite(Number(v)) ? null : Number(v));

/**
 * @param pilotStatus  ответ /api/overnight-pilot/status
 * @param liveRunner   runner из /api/paper-trading/live/status (или null)
 * @returns массив строк сводки, отсортированный по symbol
 */
export function collectPaperPairs(pilotStatus, liveRunner, pairControlStates = null) {
  const pairs = new Map();

  for (const [sym, s] of Object.entries(pilotStatus?.sessions || {})) {
    if (!sym) continue;
    const p = s?.paper || {};
    const closedList = p.closed_trades || [];
    const wins = closedList.filter((t) => Number(t?.net_pnl ?? 0) > 0).length;
    pairs.set(sym, {
      symbol: sym,
      sources: ['marathon'],
      strategy: p.strategy_type || s?.strategy_type || null,
      timeframe: p.timeframe || s?.config?.timeframe || null,
      leverage: num(p.leverage ?? s?.config?.leverage),
      aiControl: Boolean(s?.config?.ai_control),
      running: Boolean(p.is_running),
      dataStatus: p.data_status || null,
      equity: num(p.current_equity),
      realizedPnl: num(p.realized_pnl),
      unrealizedPnl: num(p.unrealized_pnl),
      roiPct: num(p.roi_pct),
      openCount: (p.open_positions || []).length,
      closedCount: num(p.closed_trades_count) ?? closedList.length,
      winRatePct: closedList.length > 0 ? Math.round((wins / closedList.length) * 1000) / 10 : null,
      backtestNetUsd: num(s?.backtest?.summary?.net_pnl_usd),
      lastOptimizationAt: s?.last_optimization_at ?? null
    });
  }

  if (liveRunner?.symbol) {
    const sym = liveRunner.symbol;
    const existing = pairs.get(sym);
    if (existing) {
      existing.sources.push('live');
      if (!existing.strategy) existing.strategy = liveRunner.strategy_type || null;
      if (!existing.timeframe) existing.timeframe = liveRunner.timeframe || null;
      if (existing.leverage == null) existing.leverage = num(liveRunner.leverage);
      if (liveRunner.ai_control) existing.aiControl = true;
      existing.running = existing.running || Boolean(liveRunner.is_running);
    } else {
      pairs.set(sym, {
        symbol: sym,
        sources: ['live'],
        strategy: liveRunner.strategy_type || null,
        timeframe: liveRunner.timeframe || null,
        leverage: num(liveRunner.leverage),
        aiControl: Boolean(liveRunner.ai_control),
        running: Boolean(liveRunner.is_running),
        dataStatus: null,
        equity: num(liveRunner.current_equity ?? liveRunner.equity),
        realizedPnl: num(liveRunner.realized_pnl),
        unrealizedPnl: num(liveRunner.unrealized_pnl),
        roiPct: num(liveRunner.roi_pct),
        openCount: Array.isArray(liveRunner.positions) ? liveRunner.positions.length : 0,
        closedCount: num(liveRunner.closed_trades_count) ?? (Array.isArray(liveRunner.closed_trades) ? liveRunner.closed_trades.length : 0),
        winRatePct: null,
        backtestNetUsd: null,
        lastOptimizationAt: null
      });
    }
  }

  if (pairControlStates && typeof pairControlStates === 'object') {
    for (const [sym, ctrl] of Object.entries(pairControlStates)) {
      if (!sym) continue;
      const cleanSym = sym.toUpperCase();
      const existing = pairs.get(cleanSym);
      const isPaused = Boolean(ctrl.is_paused ?? (ctrl.status === 'paused'));
      if (existing) {
        existing.is_paused = isPaused;
        existing.controlStatus = ctrl.status || (isPaused ? 'paused' : 'active');
        existing.controlReason = ctrl.pause_reason || ctrl.reason || '';
        if (ctrl.has_open_position) existing.hasOpenPosition = true;
      } else {
        pairs.set(cleanSym, {
          symbol: cleanSym,
          sources: ['config'],
          strategy: ctrl.strategy || 'default',
          timeframe: ctrl.timeframe || '15m',
          leverage: 5,
          aiControl: false,
          running: ctrl.status === 'active' && !isPaused,
          is_paused: isPaused,
          dataStatus: 'connected',
          equity: 1000.0,
          realizedPnl: 0,
          unrealizedPnl: 0,
          roiPct: 0,
          openCount: ctrl.has_open_position ? 1 : 0,
          hasOpenPosition: Boolean(ctrl.has_open_position),
          closedCount: 0,
          winRatePct: null,
          backtestNetUsd: null,
          lastOptimizationAt: null,
          controlStatus: ctrl.status || (isPaused ? 'paused' : 'active'),
          controlReason: ctrl.pause_reason || ctrl.reason || ''
        });
      }
    }
  }

  return [...pairs.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** Совокупный PnL строки (realized + unrealized), null если оба неизвестны. */
export function pairTotalPnl(pair) {
  if (pair?.realizedPnl == null && pair?.unrealizedPnl == null) return null;
  return (pair?.realizedPnl ?? 0) + (pair?.unrealizedPnl ?? 0);
}

/**
 * Сортировка строк «По парам» по выбранному столбцу и направлению ('asc' | 'desc')
 */
export function sortPaperPairs(pairs, sortField = 'symbol', sortDir = 'asc') {
  if (!Array.isArray(pairs)) return [];
  const list = [...pairs];
  const mult = sortDir === 'desc' ? -1 : 1;

  return list.sort((a, b) => {
    let valA, valB;

    switch (sortField) {
      case 'symbol':
        valA = a.symbol || '';
        valB = b.symbol || '';
        return valA.localeCompare(valB) * mult;

      case 'strategy':
        valA = a.strategy || '';
        valB = b.strategy || '';
        return valA.localeCompare(valB) * mult;

      case 'equity':
        valA = a.equity;
        valB = b.equity;
        break;

      case 'pnl':
        valA = pairTotalPnl(a);
        valB = pairTotalPnl(b);
        break;

      case 'roi':
        valA = a.roiPct;
        valB = b.roiPct;
        break;

      case 'trades':
        valA = (a.openCount || 0) + (a.closedCount || 0);
        valB = (b.openCount || 0) + (b.closedCount || 0);
        break;

      case 'winRate':
        valA = a.winRatePct;
        valB = b.winRatePct;
        break;

      case 'status':
        valA = a.dataStatus === 'stale' ? 0 : (a.running ? 2 : 1);
        valB = b.dataStatus === 'stale' ? 0 : (b.running ? 2 : 1);
        break;

      default:
        valA = a.symbol || '';
        valB = b.symbol || '';
        return valA.localeCompare(valB) * mult;
    }

    // Nulls sort to the end regardless of direction
    if (valA == null && valB == null) return 0;
    if (valA == null) return 1;
    if (valB == null) return -1;

    if (valA < valB) return -1 * mult;
    if (valA > valB) return 1 * mult;
    return 0;
  });
}

/**
 * Фильтрация списка пар по строке поиска и статусу
 */
export function filterPaperPairs(pairs, { search = '', statusFilter = 'all' } = {}) {
  if (!Array.isArray(pairs)) return [];
  const q = String(search || '').trim().toUpperCase();

  return pairs.filter((p) => {
    if (q) {
      const matchSymbol = p.symbol && p.symbol.toUpperCase().includes(q);
      const matchStrat = p.strategy && p.strategy.toUpperCase().includes(q);
      if (!matchSymbol && !matchStrat) return false;
    }

    if (statusFilter === 'running' && !p.running) return false;
    if (statusFilter === 'active_positions' && (!p.openCount || p.openCount <= 0)) return false;
    if (statusFilter === 'data_alert' && p.dataStatus !== 'stale' && p.dataStatus !== 'disconnected') return false;

    return true;
  });
}

/**
 * Сбор потенциальных претендентов и активных лимитных/маркет заявок на вход (Претенденты)
 */
export function collectCandidateSetups(pilotStatus, monitoringData, sessionData) {
  const candidates = [];

  // 1. Ожидающие лимитные / маркет ордера на вход (Working Entry Orders)
  const sessionOrders = Array.isArray(sessionData?.active_orders) ? sessionData.active_orders : [];
  for (const o of sessionOrders) {
    if (o.role === 'entry') {
      candidates.push({
        id: o.order_id || `entry_${o.symbol}_${o.price}`,
        symbol: o.symbol,
        type: 'ORDER',
        orderType: o.order_type || 'LIMIT',
        side: o.side || 'LONG',
        targetPrice: num(o.price),
        currentPrice: num(o.context_snapshot?.price) || num(o.price),
        sl: num(o.stop_price),
        tp: num(o.target_price),
        strategy: o.reason || 'Live Paper Limit',
        status: 'Ожидает исполнения (Лимит в стакане)',
        distancePct: o.price && o.context_snapshot?.price
          ? Math.abs((o.price - o.context_snapshot.price) / o.context_snapshot.price) * 100
          : 0.0,
        createdAt: o.created_at || o.signal_ts || Date.now(),
        source: 'live'
      });
    }
  }

  // 2. Лимитные заявки на вход из сессий марафона
  for (const [sym, s] of Object.entries(pilotStatus?.sessions || {})) {
    const activeOrders = Array.isArray(s?.paper?.active_orders) ? s.paper.active_orders : [];
    for (const o of activeOrders) {
      if (o.role === 'entry') {
        candidates.push({
          id: o.order_id || `pilot_entry_${sym}_${o.price}`,
          symbol: sym,
          type: 'ORDER',
          orderType: o.order_type || 'LIMIT',
          side: o.side || 'LONG',
          targetPrice: num(o.price),
          currentPrice: num(o.context_snapshot?.price) || num(o.price),
          sl: num(o.stop_price),
          tp: num(o.target_price),
          strategy: s?.config?.strategy_type || o.reason || 'Марафон Лимит',
          status: 'Ожидает исполнения (Лимит в стакане)',
          distancePct: o.price && o.context_snapshot?.price
            ? Math.abs((o.price - o.context_snapshot.price) / o.context_snapshot.price) * 100
            : 0.0,
          createdAt: o.created_at || o.signal_ts || Date.now(),
          source: 'marathon'
        });
      }
    }

    // 3. Кандидаты / сетапы по прогнозам сессий (Unified Trade Signals)
    const sig = s?.forecast?.unified_signal || s?.forecast?.base_scenario;
    if (sig && sig.direction && sig.direction !== 'NO_TRADE') {
      const curPx = num(s?.forecast?.cone?.base_price) || num(sig.entry_price);
      const entryPx = num(sig.entry_price) || curPx;
      const distPct = curPx && entryPx ? Math.abs((entryPx - curPx) / curPx) * 100 : 0.0;
      candidates.push({
        id: `sig_${sym}_${sig.direction}`,
        symbol: sym,
        type: 'SETUP',
        orderType: 'PRE-SIGNAL',
        side: sig.direction,
        targetPrice: entryPx,
        currentPrice: curPx,
        sl: num(sig.sl),
        tp: num(sig.tp1 || sig.tp),
        expectedRr: num(sig.expected_rr),
        strategy: s?.config?.strategy_type || 'Стратегия пары',
        status: distPct <= 0.3 ? 'Готов к входу (в триггерной зоне)' : 'Ожидание подхода цены',
        distancePct: distPct,
        reason: sig.reason || 'Сигнал по волатильностному конусу',
        createdAt: s?.forecast?.updated_at || Date.now(),
        source: 'forecast'
      });
    }
  }

  // Сортировка: сначала ближайшие к текущей цене
  return candidates.sort((a, b) => (a.distancePct ?? 999) - (b.distancePct ?? 999));
}

export const POPULAR_COINS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'DOGEUSDT', 'AVAXUSDT', 'SUIUSDT', 'NEARUSDT', 'LINKUSDT',
  'PEPEUSDT', 'UNIUSDT', 'ENAUSDT', 'WLDUSDT', 'TIAUSDT'
];

export const AVAILABLE_STRATEGIES = [
  { id: 'ema_trend', name: 'EMA Trend Follow', desc: 'Классический тренд по EMA20/50' },
  { id: 'ema_pullback', name: 'EMA Pullback Bounce', desc: 'Откат к EMA20 с подтверждением объема' },
  { id: 'ema_trend_window', name: 'EMA Trend Window', desc: 'Вход в окне 8 баров после кросса' },
  { id: 'confluence_ema', name: 'Confluence EMA & Filters', desc: 'Мультифильтр ATR + CVD + RSI' },
  { id: 'cvd_absorption', name: 'CVD Absorption Delta', desc: 'Вход на поглощении лимитной плотностью' },
  { id: 'cluster_volume_bounce', name: 'Cluster Volume Bounce', desc: 'Отскок от подтвержденного кластера/стенки' }
];
