// Общие форматтеры подкомпонентов бэктест-панели.
// Источник единственный: извлечены из BacktestPanel.jsx (MODULARIZATION_PLAN, пункт 2).

export const fmtTime = (ms) =>
  new Date(ms).toLocaleString('ru-RU', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

export const fmtPrice = (p) => (p >= 1000 ? p.toFixed(1) : p >= 1 ? p.toFixed(2) : p.toFixed(5));
