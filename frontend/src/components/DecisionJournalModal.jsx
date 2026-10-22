import React, { useState, useEffect, useCallback } from 'react';
import { X, Download, RefreshCw, BookOpen, Brain, CheckCircle2, SkipForward, Flag, PlusCircle } from 'lucide-react';

import SessionReviewPanel from './SessionReviewPanel';

const EVENT_LABELS = {
  SIGNAL: { text: '📡 СИГНАЛ', bg: 'rgba(56, 189, 248, 0.14)', border: 'rgba(56, 189, 248, 0.4)', color: '#38bdf8' },
  AI_OPINION: { text: '🧠 МНЕНИЕ AI', bg: 'rgba(168, 85, 247, 0.16)', border: 'rgba(168, 85, 247, 0.45)', color: '#c084fc' },
  MANUAL_ENTRY: { text: '⚡ ВХОД ВРУЧНУЮ', bg: 'rgba(38, 166, 154, 0.16)', border: 'rgba(38, 166, 154, 0.45)', color: '#2dd4bf' },
  MANUAL_EXIT: { text: '🏁 ВЫХОД', bg: 'rgba(245, 158, 11, 0.16)', border: 'rgba(245, 158, 11, 0.45)', color: '#fbbf24' },
  MANUAL_SKIP: { text: '⏭ ПРОПУСК', bg: 'rgba(148, 163, 184, 0.14)', border: 'rgba(148, 163, 184, 0.35)', color: '#94a3b8' },
};

const DECISION_BADGES = {
  ENTERED: { label: '✅ ВОШЁЛ В СДЕЛКУ', color: '#26a69a', bg: 'rgba(38, 166, 154, 0.18)' },
  SKIPPED: { label: '⏭ ПРОПУСТИЛ', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)' },
  EXITED: { label: '🏁 ВЫШЕЛ', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.18)' },
  PENDING: { label: '⏳ ОЖИДАЕТ РЕШЕНИЯ', color: '#64748b', bg: 'rgba(100, 116, 139, 0.12)' },
};

export default function DecisionJournalModal({
  isOpen,
  onClose,
  activeSymbol = 'BTCUSDT',
  activeTimeframe = '5m',
  activeSetup = null,
}) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [symbolFilter, setSymbolFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [manualNote, setManualNote] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [statusBanner, setStatusBanner] = useState('');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (symbolFilter && symbolFilter !== 'ALL') params.set('symbol', symbolFilter);
      if (typeFilter && typeFilter !== 'ALL') params.set('event_type', typeFilter);
      params.set('limit', '200');
      const res = await fetch(`/api/journal/logs?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(Array.isArray(data.logs) ? data.logs : []);
      }
    } catch (e) {
      console.error('Failed to fetch decision journal logs:', e);
    } finally {
      setLoading(false);
    }
  }, [symbolFilter, typeFilter]);

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen, fetchLogs]);

  // Listen to global journal refresh events (e.g. when Second Opinion is requested from Chart HUD)
  useEffect(() => {
    const handler = () => {
      if (isOpen) fetchLogs();
    };
    window.addEventListener('decision-journal-updated', handler);
    return () => window.removeEventListener('decision-journal-updated', handler);
  }, [isOpen, fetchLogs]);

  const handleRecordManualAction = async (eventType, direction, userDecision, defaultLabel) => {
    const cleanSym = (activeSymbol || 'BTCUSDT').toUpperCase().replace('.P', '');
    const priceVal = Number(manualPrice) || Number(activeSetup?.entryPrice || activeSetup?.entry_price || 0);
    try {
      const res = await fetch('/api/journal/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: eventType,
          symbol: cleanSym,
          timeframe: activeTimeframe || '5m',
          direction,
          price: priceVal,
          entry_price: Number(activeSetup?.entryPrice || activeSetup?.entry_price) || (priceVal || null),
          sl_price: Number(activeSetup?.slPrice || activeSetup?.sl_price) || null,
          tp_price: Number(activeSetup?.tpPrice || activeSetup?.tp1_price || activeSetup?.tp_price) || null,
          strategy_or_condition: defaultLabel,
          user_decision: userDecision,
          notes: manualNote.trim(),
        }),
      });
      if (res.ok) {
        setManualNote('');
        setStatusBanner(`Записано в журнал: ${defaultLabel} (${cleanSym})`);
        setTimeout(() => setStatusBanner(''), 3000);
        fetchLogs();
      }
    } catch (e) {
      console.error('Error recording manual journal entry:', e);
    }
  };

  const handleUpdateUserDecision = async (logId, newDecision) => {
    try {
      const res = await fetch(`/api/journal/log/${logId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_decision: newDecision }),
      });
      if (res.ok) {
        const data = await res.json();
        setLogs((prev) => prev.map((item) => (item.id === logId ? data.log : item)));
      }
    } catch (e) {
      console.error('Failed to update user decision:', e);
    }
  };

  const handleExportCsv = async () => {
    try {
      const params = new URLSearchParams();
      if (symbolFilter && symbolFilter !== 'ALL') params.set('symbol', symbolFilter);
      if (typeFilter && typeFilter !== 'ALL') params.set('event_type', typeFilter);
      const res = await fetch(`/api/journal/export-csv?${params.toString()}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `signalscript_journal_${symbolFilter.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setStatusBanner('CSV-файл журнала успешно выгружен');
      setTimeout(() => setStatusBanner(''), 3000);
    } catch (e) {
      console.error('CSV export error:', e);
    }
  };

  if (!isOpen) return null;

  const uniqueSymbols = Array.from(
    new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', activeSymbol?.toUpperCase(), ...logs.map((l) => l.symbol)].filter(Boolean))
  );

  return (
    <div
      data-testid="decision-journal-modal"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(6, 9, 15, 0.82)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 'min(1260px, 96vw)',
          maxHeight: '90vh',
          backgroundColor: '#0f141e',
          border: '1px solid rgba(56, 189, 248, 0.28)',
          borderRadius: '10px',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.75)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: '#e2e8f0',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 18px',
            borderBottom: '1px solid #1e2736',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(90deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.8))',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <BookOpen size={18} color="#38bdf8" />
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>Журнал решений и сигналов (SQLite)</span>
                <span
                  style={{
                    fontSize: '10px',
                    padding: '2px 7px',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(38, 166, 154, 0.16)',
                    border: '1px solid rgba(38, 166, 154, 0.4)',
                    color: '#2dd4bf',
                    fontFamily: 'monospace',
                  }}
                >
                  {logs.length} записей
                </span>
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                Консультативный лог для разбора полётов: сигналы сканера, второе мнение AI и ваши реальные входы/выходы
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              data-testid="btn-export-journal-csv"
              onClick={handleExportCsv}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                backgroundColor: 'rgba(56, 189, 248, 0.15)',
                border: '1px solid rgba(56, 189, 248, 0.45)',
                color: '#38bdf8',
              }}
              title="Выгрузить журнал в CSV (UTF-8 для Excel)"
            >
              <Download size={13} />
              <span>Выгрузить CSV</span>
            </button>

            <button
              onClick={fetchLogs}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                cursor: 'pointer',
                backgroundColor: 'rgba(148, 163, 184, 0.1)',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                color: '#cbd5e1',
              }}
              title="Обновить"
            >
              <RefreshCw size={13} />
            </button>

            <button
              data-testid="btn-close-decision-journal"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#94a3b8',
                padding: '5px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Пост-сессионный разбор (задача 7.3) */}
        <SessionReviewPanel />

        {/* Quick Manual Action Bar & Filters */}
        <div
          style={{
            padding: '10px 18px',
            borderBottom: '1px solid #1e2736',
            backgroundColor: '#131a27',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
          }}
        >
          {/* Left: Fast manual entry/exit logging for current symbol */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', marginRight: '4px' }}>
              Быстрая фиксация ({activeSymbol} {activeTimeframe}):
            </span>
            <input
              data-testid="input-journal-manual-price"
              type="number"
              step="any"
              placeholder="Цена (авто)"
              value={manualPrice}
              onChange={(e) => setManualPrice(e.target.value)}
              style={{
                width: '95px',
                padding: '4px 8px',
                borderRadius: '5px',
                backgroundColor: '#0b0e14',
                border: '1px solid #2b3548',
                color: '#e2e8f0',
                fontSize: '11px',
                fontFamily: 'monospace',
              }}
            />
            <input
              data-testid="input-journal-manual-note"
              type="text"
              placeholder="Заметка (причина входа/выхода)..."
              value={manualNote}
              onChange={(e) => setManualNote(e.target.value)}
              style={{
                width: '210px',
                padding: '4px 8px',
                borderRadius: '5px',
                backgroundColor: '#0b0e14',
                border: '1px solid #2b3548',
                color: '#e2e8f0',
                fontSize: '11px',
              }}
            />
            <button
              data-testid="btn-journal-manual-long"
              onClick={() => handleRecordManualAction('MANUAL_ENTRY', 'LONG', 'ENTERED', 'Ручной вход LONG')}
              style={{
                padding: '4px 9px',
                borderRadius: '5px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                backgroundColor: 'rgba(38, 166, 154, 0.2)',
                border: '1px solid rgba(38, 166, 154, 0.5)',
                color: '#2dd4bf',
              }}
            >
              🟢 Вход LONG
            </button>
            <button
              data-testid="btn-journal-manual-short"
              onClick={() => handleRecordManualAction('MANUAL_ENTRY', 'SHORT', 'ENTERED', 'Ручной вход SHORT')}
              style={{
                padding: '4px 9px',
                borderRadius: '5px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                backgroundColor: 'rgba(239, 83, 80, 0.2)',
                border: '1px solid rgba(239, 83, 80, 0.5)',
                color: '#f87171',
              }}
            >
              🔴 Вход SHORT
            </button>
            <button
              data-testid="btn-journal-manual-exit"
              onClick={() => handleRecordManualAction('MANUAL_EXIT', 'NEUTRAL', 'EXITED', 'Ручной выход из позиции')}
              style={{
                padding: '4px 9px',
                borderRadius: '5px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                backgroundColor: 'rgba(245, 158, 11, 0.18)',
                border: '1px solid rgba(245, 158, 11, 0.45)',
                color: '#fbbf24',
              }}
            >
              🏁 Выход
            </button>
            <button
              data-testid="btn-journal-manual-skip"
              onClick={() => handleRecordManualAction('MANUAL_SKIP', 'NEUTRAL', 'SKIPPED', 'Пропуск сетапа')}
              style={{
                padding: '4px 9px',
                borderRadius: '5px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                backgroundColor: 'rgba(148, 163, 184, 0.14)',
                border: '1px solid rgba(148, 163, 184, 0.35)',
                color: '#cbd5e1',
              }}
            >
              ⏭ Пропустил
            </button>
          </div>

          {/* Right: Filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '11px', color: '#94a3b8' }}>Монета:</label>
            <select
              data-testid="select-journal-symbol-filter"
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value)}
              style={{
                padding: '4px 8px',
                borderRadius: '5px',
                backgroundColor: '#0b0e14',
                border: '1px solid #2b3548',
                color: '#f8fafc',
                fontSize: '11px',
                fontWeight: 600,
              }}
            >
              <option value="ALL">Все монеты</option>
              {uniqueSymbols.map((sym) => (
                <option key={sym} value={sym}>
                  {sym}
                </option>
              ))}
            </select>

            <label style={{ fontSize: '11px', color: '#94a3b8' }}>Тип:</label>
            <select
              data-testid="select-journal-type-filter"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              style={{
                padding: '4px 8px',
                borderRadius: '5px',
                backgroundColor: '#0b0e14',
                border: '1px solid #2b3548',
                color: '#f8fafc',
                fontSize: '11px',
              }}
            >
              <option value="ALL">Все события</option>
              <option value="SIGNAL">📡 Сигналы</option>
              <option value="AI_OPINION">🧠 Второе мнение AI</option>
              <option value="MANUAL_ENTRY">⚡ Входы вручную</option>
              <option value="MANUAL_EXIT">🏁 Выходы</option>
              <option value="MANUAL_SKIP">⏭ Пропуски</option>
            </select>
          </div>
        </div>

        {statusBanner && (
          <div
            style={{
              padding: '6px 18px',
              backgroundColor: 'rgba(38, 166, 154, 0.18)',
              borderBottom: '1px solid rgba(38, 166, 154, 0.4)',
              color: '#2dd4bf',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            ✓ {statusBanner}
          </div>
        )}

        {/* Table Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px' }}>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>
              Загрузка журнала решений из SQLite...
            </div>
          ) : logs.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
              Записей пока нет. Нажмите «🟢 Вход LONG» выше или «🧠 Спросить мнение AI» на графике.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead>
                <tr
                  style={{
                    borderBottom: '1px solid #1e293b',
                    color: '#94a3b8',
                    textAlign: 'left',
                    fontSize: '10px',
                    textTransform: 'uppercase',
                  }}
                >
                  <th style={{ padding: '8px 6px' }}>Время</th>
                  <th style={{ padding: '8px 6px' }}>Монета / ТФ</th>
                  <th style={{ padding: '8px 6px' }}>Тип</th>
                  <th style={{ padding: '8px 6px' }}>Напр. / Уровни</th>
                  <th style={{ padding: '8px 6px' }}>Стратегия / Условие</th>
                  <th style={{ padding: '8px 6px' }}>Второе мнение AI</th>
                  <th style={{ padding: '8px 6px' }}>Решение трейдера</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((row) => {
                  const evMeta = EVENT_LABELS[row.event_type] || EVENT_LABELS.SIGNAL;
                  const decMeta = DECISION_BADGES[row.user_decision] || DECISION_BADGES.PENDING;
                  const dt = row.timestamp ? new Date(row.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
                  const dtDate = row.timestamp ? new Date(row.timestamp).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '';

                  return (
                    <tr
                      key={row.id}
                      data-testid={`journal-row-${row.id}`}
                      style={{
                        borderBottom: '1px solid rgba(30, 41, 59, 0.7)',
                        backgroundColor: row.event_type === 'AI_OPINION' ? 'rgba(168, 85, 247, 0.04)' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '8px 6px', fontFamily: 'monospace', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                        <div>{dt}</div>
                        <div style={{ fontSize: '9px', color: '#64748b' }}>{dtDate}</div>
                      </td>

                      <td style={{ padding: '8px 6px', fontWeight: 700, fontFamily: 'monospace' }}>
                        <span style={{ color: '#f8fafc' }}>{row.symbol}</span>
                        <span
                          style={{
                            marginLeft: '5px',
                            padding: '1px 5px',
                            borderRadius: '3px',
                            backgroundColor: '#1e293b',
                            color: '#38bdf8',
                            fontSize: '10px',
                          }}
                        >
                          {row.timeframe}
                        </span>
                      </td>

                      <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                        <span
                          style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: evMeta.bg,
                            border: `1px solid ${evMeta.border}`,
                            color: evMeta.color,
                            fontWeight: 700,
                            fontSize: '10px',
                          }}
                        >
                          {evMeta.text}
                        </span>
                      </td>

                      <td style={{ padding: '8px 6px', fontFamily: 'monospace' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <span
                            style={{
                              fontWeight: 800,
                              color:
                                row.direction === 'LONG'
                                  ? '#26a69a'
                                  : row.direction === 'SHORT'
                                  ? '#ef5350'
                                  : '#94a3b8',
                            }}
                          >
                            {row.direction}
                          </span>
                          {row.price > 0 && <span style={{ color: '#e2e8f0' }}>@${Number(row.price).toLocaleString('en-US', { maximumFractionDigits: 4 })}</span>}
                        </div>
                        {(row.sl_price || row.tp_price) && (
                          <div style={{ fontSize: '9.5px', color: '#94a3b8', marginTop: '2px' }}>
                            {row.sl_price ? <span style={{ color: '#f87171', marginRight: '6px' }}>SL:{Number(row.sl_price).toFixed(2)}</span> : null}
                            {row.tp_price ? <span style={{ color: '#4ade80' }}>TP:{Number(row.tp_price).toFixed(2)}</span> : null}
                          </div>
                        )}
                      </td>

                      <td style={{ padding: '8px 6px', maxWidth: '240px', color: '#cbd5e1' }}>
                        <div style={{ fontWeight: 600 }}>{row.strategy_or_condition || '—'}</div>
                        {row.notes && (
                          <div style={{ fontSize: '10px', color: '#38bdf8', marginTop: '2px' }}>
                            💬 {row.notes}
                          </div>
                        )}
                      </td>

                      <td style={{ padding: '8px 6px', maxWidth: '300px' }}>
                        {row.ai_verdict ? (
                          <div>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                fontWeight: 800,
                                fontSize: '10px',
                                marginBottom: '3px',
                                backgroundColor:
                                  row.ai_verdict === 'ЗА'
                                    ? 'rgba(38, 166, 154, 0.22)'
                                    : row.ai_verdict === 'ПРОТИВ'
                                    ? 'rgba(239, 83, 80, 0.22)'
                                    : row.ai_verdict.includes('НЕДОСТУПЕН')
                                    ? 'rgba(245, 158, 11, 0.22)'
                                    : 'rgba(148, 163, 184, 0.2)',
                                color:
                                  row.ai_verdict === 'ЗА'
                                    ? '#2dd4bf'
                                    : row.ai_verdict === 'ПРОТИВ'
                                    ? '#f87171'
                                    : row.ai_verdict.includes('НЕДОСТУПЕН')
                                    ? '#fbbf24'
                                    : '#cbd5e1',
                              }}
                            >
                              {row.ai_verdict}
                            </span>
                            <div style={{ fontSize: '10.5px', color: '#cbd5e1', lineHeight: 1.35 }}>
                              {row.ai_reason}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: '#475569' }}>—</span>
                        )}
                      </td>

                      <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span
                            data-testid={`journal-decision-badge-${row.id}`}
                            style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: decMeta.bg,
                              color: decMeta.color,
                              fontWeight: 700,
                              fontSize: '10px',
                              marginRight: '4px',
                            }}
                          >
                            {decMeta.label}
                          </span>
                          <button
                            data-testid={`btn-journal-mark-entered-${row.id}`}
                            onClick={() => handleUpdateUserDecision(row.id, 'ENTERED')}
                            style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '10px',
                              cursor: 'pointer',
                              backgroundColor: row.user_decision === 'ENTERED' ? 'rgba(38, 166, 154, 0.3)' : '#1e293b',
                              border: '1px solid rgba(38, 166, 154, 0.45)',
                              color: '#2dd4bf',
                            }}
                            title="Отметить: Я вошёл в сделку"
                          >
                            Вошёл
                          </button>
                          <button
                            data-testid={`btn-journal-mark-skipped-${row.id}`}
                            onClick={() => handleUpdateUserDecision(row.id, 'SKIPPED')}
                            style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '10px',
                              cursor: 'pointer',
                              backgroundColor: row.user_decision === 'SKIPPED' ? 'rgba(148, 163, 184, 0.3)' : '#1e293b',
                              border: '1px solid #334155',
                              color: '#94a3b8',
                            }}
                            title="Отметить: Я пропустил"
                          >
                            Пропустил
                          </button>
                          <button
                            data-testid={`btn-journal-mark-exited-${row.id}`}
                            onClick={() => handleUpdateUserDecision(row.id, 'EXITED')}
                            style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '10px',
                              cursor: 'pointer',
                              backgroundColor: row.user_decision === 'EXITED' ? 'rgba(245, 158, 11, 0.3)' : '#1e293b',
                              border: '1px solid rgba(245, 158, 11, 0.4)',
                              color: '#fbbf24',
                            }}
                            title="Отметить: Закрыл сделку"
                          >
                            Вышел
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
