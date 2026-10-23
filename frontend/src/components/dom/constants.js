// Общие константы скальперского стакана DOM — вынесены из OrderBookDOM.jsx
// (модульный план, п.4). Изменения здесь затрагивают и хук стрима, и виртуализацию лестницы.

export const ROW_HEIGHT = 20;      // Strictly fixed 20px row height
export const TOTAL_ROWS = 400;     // 400 virtualized price steps around static anchor price
export const BUFFER_ROWS = 20;     // ±20 buffer rows above and below viewport
export const SCALE_OPTIONS = [1, 5, 10, 25, 50, 100];
