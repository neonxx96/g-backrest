import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, BarChart3 } from 'lucide-react';

// Пост-сессионный разбор (задача 7.3): связка paper-сделок с decision_logs.
// Read-only панель — данные из GET /api/journal/session-review.

const fmtUsd = (v) => `${v >= 0 ? '+' : ''}${Number(v || 0).toFixed(2)}$`;
const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('ru-RU') : '—');
const pnlColor = (v) => (v >= 0 ? '#26a69a' : '#ef5350');

function Stat({ label, value, color }) {
  return (
    <div style={{ padding: '4px 10px', background: '#131a26', borderRadius: '6px', border: '1px solid #1e2736' }}>
      <div style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '13px', fontWeight: 700, color: color || '#e2e8f0', fontFamily: 'monospace' }}>{value}</div>
    </div>
  );
}

export default function SessionReviewPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchReview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/journal/session-review?hours=24');
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        setData(null);
        return;
      }
      setData(await res.json());
    } catch (e) {
      setError(String(e && e.message ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReview(); }, [fetchReview]);

  const s = data?.summary;
  const pairs = (data?.pairs || []).slice(0, 50);

  return (
    <div
      data-testid="session-review-panel"
      style={{ margin: '10px 18px 0', padding: '10px 12px', background: '#0c1119', border: '1px solid #1e2736', borderRadius: '8px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <BarChart3 size={14} color="#38bdf8" />
        <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8' }}>
          Пост-сессионный разбор (7.3) — paper-сделки × журнал решений
        </span>
        <span style={{ fontSize: '9px', color: '#475569', fontFamily: 'monospace' }}>
          окно {data?.window_hours ?? 24}ч · {data?.paper_session_id ?? '—'}
        </span>
        <button
          data-testid="session-review-refresh"
          onClick={fetchReview}
          disabled={loading}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#94a3b8', background: '#131a26', border: '1px solid #1e2736', borderRadius: '5px', padding: '2px 8px', cursor: 'pointer' }}
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Обновить
        </button>
      </div>

      {error && <div style={{ fontSize: '10px', color: '#ef5350' }}>Ошибка: {error}</div>}

      {s && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
            <Stat label="Сделок" value={s.trades_total} />
            <Stat label="Связано с решениями" value={`${s.trades_matched} (${s.match_rate_pct}%)`} />
            <Stat label="Net PnL все" value={fmtUsd(s.pnl.net_all)} color={pnlColor(s.pnl.net_all)} />
            <Stat label="Net PnL со связкой" value={fmtUsd(s.pnl.net_matched)} color={pnlColor(s.pnl.net_matched)} />
            <Stat label="Net PnL без связки" value={fmtUsd(s.pnl.net_unmatched)} color={pnlColor(s.pnl.net_unmatched)} />
            <Stat label="Решения: вошёл/пропустил/ждёт" value={`${s.decisions.entered}/${s.decisions.skipped}/${s.decisions.pending}`} />
            <Stat label="SKIPPED-итог (пропущенное)" value={fmtUsd(s.skipped_opportunity_pnl)} color={pnlColor(s.skipped_opportunity_pnl)} />
            <Stat label="Profit bleed" value={s.profit_bleed_count} color={s.profit_bleed_count ? '#ef5350' : '#26a69a'} />
            <Stat label="WinRate связанных" value={`${s.win_rate_matched_pct}%`} />
            <Stat label="Средн. MFE-R" value={s.avg_mfe_r_matched} />
          </div>

          {pairs.length > 0 && (
            <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid #1e2736', borderRadius: '6px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px', fontFamily: 'monospace' }}>
                <thead>
                  <tr style={{ position: 'sticky', top: 0, background: '#131a26', color: '#64748b', textAlign: 'left' }}>
                    <th style={{ padding: '4px 6px' }}>Вход</th>
                    <th style={{ padding: '4px 6px' }}>Символ</th>
                    <th style={{ padding: '4px 6px' }}>Сторона</th>
                    <th style={{ padding: '4px 6px' }}>Вход→Выход</th>
                    <th style={{ padding: '4px 6px' }}>Net PnL</th>
                    <th style={{ padding: '4px 6px' }}>Привязанное решение</th>
                  </tr>
                </thead>
                <tbody>
                  {pairs.map((p, i) => {
                    const t = p.trade || {};
                    const d = p.decision;
                    return (
                      <tr key={i} style={{ borderTop: '1px solid #16202e', color: '#94a3b8' }}>
                        <td style={{ padding: '3px 6px' }}>{fmtTime(t.entry_ts)}</td>
                        <td style={{ padding: '3px 6px' }}>{t.symbol}</td>
                        <td style={{ padding: '3px 6px', color: t.side === 'LONG' ? '#26a69a' : '#ef5350' }}>{t.side}</td>
                        <td style={{ padding: '3px 6px' }}>{Number(t.entry_price).toFixed(1)} → {Number(t.exit_price).toFixed(1)}</td>
                        <td style={{ padding: '3px 6px', color: pnlColor(t.net_pnl) }}>{fmtUsd(t.net_pnl)}</td>
                        <td style={{ padding: '3px 6px' }}>
                          {d ? (
                            <span style={{ color: d.user_decision === 'ENTERED' ? '#26a69a' : d.user_decision === 'SKIPPED' ? '#f59e0b' : '#94a3b8' }}>
                              #{d.id} {d.event_type}/{d.user_decision}
                            </span>
                          ) : (
                            <span style={{ color: '#334155' }}>нет решения в окне</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {s.trades_total === 0 && (
            <div style={{ fontSize: '10px', color: '#475569' }}>
              Закрытых сделок paper-сессии пока нет — панель оживёт после первых сделок.
            </div>
          )}
        </>
      )}
    </div>
  );
}
