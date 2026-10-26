// Чистая математика replay-плеера (задача 2.5). Без DOM/сети — для node --test.
// Фолдинг событий /api/replay/events в состояние визуализации и детерминированный
// шаг воспроизведения (скорость = событий/сек, тики по requestAnimationFrame/setInterval).

export const PRICE_SERIES_MAX = 600;
export const BOOK_LEVELS = 10;

export function createInitialPlayerState() {
  return {
    index: 0,                 // offset текущего события в окне (не seq!)
    lastPrice: null,
    priceSeries: [],          // [{ts, price}] — кольцо, последние PRICE_SERIES_MAX
    lastBook: null,           // {bids: [[p,q]..], asks: [[p,q]..]}
    tradeCount: 0,
    depthCount: 0,
    buyQty: 0,                // накопленный объём тейкер-покупок (CVD)
    sellQty: 0,
    lastEventTs: null,
    finished: false,
  };
}

// Применяет одно событие к состоянию (возвращает НОВОЕ состояние, без мутаций).
export function applyReplayEvent(state, event) {
  if (!event || typeof event !== 'object') return state;
  const next = { ...state };
  if (Number.isFinite(event.timestamp)) next.lastEventTs = event.timestamp;

  if (event.kind === 'trade') {
    const p = event.payload || {};
    const price = Number(p.price);
    if (Number.isFinite(price)) {
      next.lastPrice = price;
      const point = { ts: event.timestamp, price };
      next.priceSeries = state.priceSeries.length >= PRICE_SERIES_MAX
        ? [...state.priceSeries.slice(1), point]
        : [...state.priceSeries, point];
    }
    const qty = Math.abs(Number(p.quantity) || 0);
    if (p.is_taker_buy) next.buyQty = state.buyQty + qty;
    else next.sellQty = state.sellQty + qty;
    next.tradeCount = state.tradeCount + 1;
  } else if (event.kind === 'depth') {
    const p = event.payload || {};
    next.lastBook = {
      bids: Array.isArray(p.bids) ? p.bids : [],
      asks: Array.isArray(p.asks) ? p.asks : [],
    };
    next.depthCount = state.depthCount + 1;
  }
  return next;
}

// Детерминированный шаг воспроизведения.
// speedPerSec — событий/сек; elapsedMs — время с последнего тика.
// Возвращает новый индекс; finished=true, когда окно доиграно.
export function advancePlayback(index, total, speedPerSec, elapsedMs) {
  if (!Number.isFinite(total) || total <= 0) return { index: 0, finished: true };
  const speed = Math.max(0, Number(speedPerSec) || 0);
  const steps = Math.floor((speed * Math.max(0, elapsedMs)) / 1000);
  const next = Math.min(index + steps, total);
  return { index: next, finished: next >= total };
}

// Нормализация книги в полосы для рендера: price, qty, frac (от макс. qty в окне).
export function bookToBars(book, maxLevels = BOOK_LEVELS) {
  if (!book) return { bids: [], asks: [] };
  const norm = (side, asc) => {
    const rows = (Array.isArray(side) ? side : [])
      .filter((l) => Array.isArray(l) && l.length >= 2)
      .map((l) => ({ price: Number(l[0]), qty: Number(l[1]) }))
      .filter((b) => Number.isFinite(b.price) && Number.isFinite(b.qty) && b.qty > 0)
      .sort((a, b) => (asc ? a.price - b.price : b.price - a.price))
      .slice(0, maxLevels);
    const maxQty = rows.reduce((m, b) => Math.max(m, b.qty), 0);
    return rows.map((b) => ({ ...b, frac: maxQty > 0 ? b.qty / maxQty : 0 }));
  };
  return { bids: norm(book.bids, false), asks: norm(book.asks, true) };
}

// Сводный CVD за просмотренное окно (delta = buy - sell).
export function cvdOf(state) {
  return (state?.buyQty || 0) - (state?.sellQty || 0);
}
