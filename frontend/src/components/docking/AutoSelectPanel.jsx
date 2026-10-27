import React, { useEffect, useState, useCallback } from 'react';

const VERDICT_CLS = {
  SELECT: 'text-bull',
  EXPLORE: 'text-amber-300',
  SKIP: 'text-muted-foreground',
  NO_DATA: 'text-muted-foreground',
};
const VERDICT_LABEL = { SELECT: 'ПОДТВЕРЖДЕНА', EXPLORE: 'ТЕСТ (мал. риск)', SKIP: 'ПРОПУСК', NO_DATA: 'НЕТ ДАННЫХ' };

export default function AutoSelectPanel() {
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [includeExplore, setIncludeExplore] = useState(true);

  const loadLast = useCallback(async () => {
    try {
      const r = await fetch('/api/overnight-pilot/auto-select/last');
      if (r.ok) setSel(await r.json());
    } catch { /* offline */ }
  }, []);

  useEffect(() => { loadLast(); }, [loadLast]);

  const run = async (start) => {
    setBusy(true);
    setMsg(start ? 'Подбор стратегий и запуск марафона… (1–3 мин)' : 'Подбор стратегий… (1–3 мин)');
    try {
      const r = await fetch('/api/overnight-pilot/auto-select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ include_explore: includeExplore, start, rerun: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      if (j.started) setMsg(`Марафон запущен: ${j.pairs.map((p) => `${p[0]} ${p[1]} ${p[2]}`).join(', ')}`);
      else setMsg(j.reason || 'Подбор завершён (запуск не выполнялся).');
      await loadLast();
    } catch (e) {
      setMsg(`Ошибка: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const rows = (sel?.results || []).filter((r) => r.best || r.verdict);
  return (
    <div className="border border-border rounded p-2 bg-card/40" data-testid="auto-select-panel">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className="text-foreground/80 font-semibold">Авто-настройка стратегий под монеты</span>
        <label className="text-muted-foreground flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={includeExplore} onChange={(e) => setIncludeExplore(e.target.checked)} />
          включать тестовые пары (риск 0.15%)
        </label>
        <button type="button" disabled={busy} onClick={() => run(false)}
          className="px-2 py-0.5 rounded border border-border text-foreground hover:bg-muted disabled:opacity-50 cursor-pointer">
          Только подобрать
        </button>
        <button type="button" disabled={busy} onClick={() => run(true)}
          className="px-2 py-0.5 rounded border border-emerald-700 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-900/50 disabled:opacity-50 cursor-pointer">
          Подобрать и запустить марафон
        </button>
      </div>
      <div className="text-[10px] text-muted-foreground mb-1">
        Обучение на 70% истории, проверка на невидимых 30% (OOS). Только paper-режим, реальных ордеров нет.
      </div>
      {msg && <div className="text-amber-200/90 mb-1">{msg}</div>}
      {rows.length > 0 && (
        <table className="w-full text-left">
          <thead className="text-muted-foreground">
            <tr><th>Пара</th><th>Вердикт</th><th>Стратегия</th><th>ТФ</th><th>SL/TP %</th><th>OOS net</th><th>OOS PF</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} className="border-t border-neutral-900">
                <td className="text-foreground">{r.symbol}</td>
                <td className={VERDICT_CLS[r.verdict]}>{VERDICT_LABEL[r.verdict] || r.verdict}</td>
                <td>{r.best?.strategy || '—'}</td>
                <td>{r.best?.timeframe || '—'}</td>
                <td>{r.best ? `${r.best.sl}/${r.best.tp}` : '—'}</td>
                <td>{r.best?.oos ? r.best.oos.net.toFixed(2) : '—'}</td>
                <td>{r.best?.oos ? r.best.oos.pf.toFixed(2) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
