import React, { useEffect, useState, useCallback } from 'react';
import AutoSelectPanel from './AutoSelectPanel';

const CAUSE_LABELS = {
  STOP_OUT: 'Выбит стоп',
  FEE_DRAG: 'Комиссии съели профит',
  STALE_TIME_OUT: 'Застой (time-stop)',
  MFE_REVERSAL: 'Прибыль не удержана',
  ADVERSE_EXIT: 'Выход по стакану/AI',
  BAD_ENTRY: 'Плохой вход',
};
const PERIODS = [['all', 'Все время'], ['24h', '24ч'], ['7d', '7 дней'], ['30d', '30 дней']];

const fmt = (v, d = 2) => (v === null || v === undefined ? '—' : Number(v).toFixed(d));
const pnlCls = (v) => (v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-neutral-300');

function Kpi({ label, value, cls = 'text-neutral-100' }) {
  return (
    <div className="bg-neutral-900/60 border border-neutral-800 rounded px-2 py-1.5">
      <div className="text-[9.5px] text-neutral-500 uppercase">{label}</div>
      <div className={`text-sm font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

export default function PostMortemAnalyticsTab() {
  const [period, setPeriod] = useState('all');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/paper-trading/analytics/post-mortem?period=${period}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e.message || 'Ошибка загрузки аналитики');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    setLoading(true);
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const o = data?.overall;
  const causes = Object.entries(data?.loss_causes || {}).sort((a, b) => b[1] - a[1]);
  const totalLoss = causes.reduce((s, [, n]) => s + n, 0);
  const symbols = Object.entries(data?.by_symbol || {}).sort((a, b) => a[1].net_pnl - b[1].net_pnl);

  return (
    <div className="p-3 font-mono text-[11px] space-y-3" data-testid="postmortem-tab">
      <div className="flex items-center justify-between">
        <span className="text-neutral-400">Аналитика &amp; Винрейт (post-mortem закрытых сделок)</span>
        <div className="flex gap-1">
          {PERIODS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setPeriod(k)}
              className={`px-2 py-0.5 rounded border cursor-pointer ${
                period === k ? 'bg-neutral-800 border-neutral-600 text-white' : 'border-neutral-800 text-neutral-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <AutoSelectPanel />

      {loading && !data && <div className="text-neutral-500">Загрузка…</div>}
      {error && <div className="text-rose-400">Ошибка: {error}</div>}

      {o && (
        <>
          {data.small_sample && (
            <div className="text-amber-400/90 border border-amber-500/30 bg-amber-500/5 rounded px-2 py-1">
              Малая выборка ({data.sample_size} сделок): выводы предварительные, нужно ≥ 30.
            </div>
          )}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            <Kpi label="Сделок" value={o.trades} />
            <Kpi label="Win Rate" value={`${fmt(o.win_rate_pct, 1)}%`} />
            <Kpi label="Net PnL" value={`$${fmt(o.net_pnl)}`} cls={pnlCls(o.net_pnl)} />
            <Kpi label="Profit Factor" value={fmt(o.profit_factor)} />
            <Kpi label="Expectancy R" value={fmt(o.expectancy_r, 3)} cls={pnlCls(o.expectancy_r)} />
            <Kpi label="Fee Burden" value={o.fee_burden_index === null ? '—' : `${fmt(o.fee_burden_index * 100, 0)}%`} />
          </div>

          <div>
            <div className="text-neutral-500 mb-1">Причины потерь</div>
            {causes.length === 0 && <div className="text-neutral-600">Убыточных сделок нет.</div>}
            {causes.map(([k, n]) => (
              <div key={k} className="flex items-center gap-2 mb-0.5">
                <span className="w-44 text-neutral-300">{CAUSE_LABELS[k] || k}</span>
                <div className="flex-1 h-2 bg-neutral-900 rounded overflow-hidden">
                  <div className="h-full bg-rose-500/70" style={{ width: `${totalLoss ? (100 * n) / totalLoss : 0}%` }} />
                </div>
                <span className="w-16 text-right text-neutral-400">{n} ({totalLoss ? Math.round((100 * n) / totalLoss) : 0}%)</span>
              </div>
            ))}
          </div>

          <div>
            <div className="text-neutral-500 mb-1">Рекомендации</div>
            {data.recommendations.length === 0 ? (
              <div className="text-neutral-600">Пока нет (нужно ≥ 5 сделок по паре).</div>
            ) : (
              <ul className="list-disc pl-4 space-y-0.5 text-amber-200/90">
                {data.recommendations.map((r) => <li key={r}>{r}</li>)}
              </ul>
            )}
          </div>

          <div>
            <div className="text-neutral-500 mb-1">По парам</div>
            <table className="w-full text-left">
              <thead className="text-neutral-500">
                <tr><th>Пара</th><th>ТФ</th><th>Сд.</th><th>WR</th><th>PnL</th><th>FBI</th><th>E(R)</th><th>MFE</th></tr>
              </thead>
              <tbody>
                {symbols.map(([s, v]) => (
                  <tr key={s} className="border-t border-neutral-900">
                    <td className="text-neutral-200">{s}</td>
                    <td>{v.timeframe}</td>
                    <td>{v.trades}</td>
                    <td>{fmt(v.win_rate_pct, 0)}%</td>
                    <td className={pnlCls(v.net_pnl)}>{fmt(v.net_pnl)}</td>
                    <td>{v.fee_burden_index === null ? '—' : fmt(v.fee_burden_index, 2)}</td>
                    <td>{fmt(v.expectancy_r, 2)}</td>
                    <td>{fmt(v.avg_mfe_r, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
