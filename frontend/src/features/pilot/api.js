async function request(path, body, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`/api${path}`, {
      signal: controller.signal, ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : JSON.stringify(payload.detail || `HTTP ${response.status}`));
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Сервер не ответил вовремя. Обновите статус перед повторным действием.');
    throw error;
  } finally { clearTimeout(timer); }
}

export const pilotApi = {
  defaults: () => request('/overnight-pilot/defaults'),
  status: () => request('/overnight-pilot/status'),
  preflight: configs => request('/overnight-pilot/preflight', configs, 300000),
  start: (configs, id) => request(`/overnight-pilot/start?preflight_id=${encodeURIComponent(id)}`, configs, 30000),
  stop: () => request('/overnight-pilot/stop', {}, 30000),
  optimize: config => request('/backtest/optimize', config, 300000),
  events: (runId, symbol) => request(`/overnight-pilot/events?${new URLSearchParams({ run_id: runId, ...(symbol ? { symbol } : {}), limit: '100' })}`),
};
