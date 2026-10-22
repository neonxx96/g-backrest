import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Play, Pause, StepForward, Rewind } from 'lucide-react';

import {
  advancePlayback,
  applyReplayEvent,
  bookToBars,
  createInitialPlayerState,
  cvdOf,
} from '../features/replay/replayPlayerMath.js';

// Replay-плеер lake (задача 2.5): Play/Pause/Step/скорость поверх /api/replay/events.
// События буферизуются курсорными страницами; фолдинг — чистыми функциями replayPlayerMath.

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'XRPUSDT'];
const PAGE = 1000;
const SPEEDS = [100, 500, 2000, 10000];
const TICK_MS = 100;
const PREFETCH_AHEAD = 2 * PAGE;

export default function ReplayModal({ isOpen, onClose }) {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [total, setTotal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(500);
  const [snapshot, setSnapshot] = useState(() => createInitialPlayerState());

  const eventsRef = useRef([]);      // сырое окно событий (offset == длина буфера)
  const nextCursorRef = useRef(null);
  const stateRef = useRef(createInitialPlayerState());
  const fetchingRef = useRef(false);
  const canvasRef = useRef(null);

  const reset = useCallback(() => {
    eventsRef.current = [];
    nextCursorRef.current = null;
    stateRef.current = createInitialPlayerState();
    setSnapshot(createInitialPlayerState());
    setTotal(null);
    setError('');
    setPlaying(false);
  }, []);

  const fetchPage = useCallback(async () => {
    if (fetchingRef.current) return false;
    if (nextCursorRef.current === null && eventsRef.current.length > 0) return false;
    fetchingRef.current = true;
    try {
      const params = new URLSearchParams({ symbol, limit: String(PAGE) });
      if (nextCursorRef.current !== null) params.set('cursor', String(nextCursorRef.current));
      const res = await fetch(`/api/replay/events?${params.toString()}`);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return false;
      }
      const data = await res.json();
      eventsRef.current = eventsRef.current.concat(data.events || []);
      nextCursorRef.current = data.next_cursor;
      setTotal(data.total ?? null);
      return (data.events || []).length > 0;
    } catch (e) {
      setError(String(e && e.message ? e.message : e));
      return false;
    } finally {
      fetchingRef.current = false;
    }
  }, [symbol]);

  // Открытие / смена символа
  useEffect(() => {
    if (!isOpen) return undefined;
    reset();
    setLoading(true);
    fetchPage().finally(() => setLoading(false));
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, symbol]);

  // Плеер-цикл
  useEffect(() => {
    if (!playing || !isOpen) return undefined;
    const timer = setInterval(() => {
      const st = stateRef.current;
      const { index, finished } = advancePlayback(st.index, total || 0, speed, TICK_MS);
      if (finished && total) {
        setPlaying(false);
        stateRef.current = { ...st, finished: true };
        setSnapshot(stateRef.current);
        return;
      }
      let cur = stateRef.current;
      for (let i = st.index; i < index; i++) {
        cur = applyReplayEvent(cur, eventsRef.current[i]);
      }
      cur = { ...cur, index };
      stateRef.current = cur;
      setSnapshot(cur);
      // Префетч, когда подходим к концу буфера
      if (nextCursorRef.current !== null && index + PREFETCH_AHEAD > eventsRef.current.length) {
        fetchPage();
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [playing, speed, isOpen, total, fetchPage]);

  const stepOnce = useCallback(() => {
    const st = stateRef.current;
    if (st.index >= (total || 0)) return;
    if (st.index >= eventsRef.current.length) {
      fetchPage();
      return;
    }
    const cur = applyReplayEvent({ ...st, index: st.index + 1 }, eventsRef.current[st.index]);
    stateRef.current = cur;
    setSnapshot(cur);
  }, [total, fetchPage]);

  // Рисуем price series
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !snapshot) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const series = snapshot.priceSeries;
    if (series.length < 2) return;
    let min = Infinity;
    let max = -Infinity;
    for (const p of series) { min = Math.min(min, p.price); max = Math.max(max, p.price); }
    if (!(max > min)) return;
    const pad = (max - min) * 0.08;
    min -= pad; max += pad;
    ctx.beginPath();
    for (let i = 0; i < series.length; i++) {
      const x = (i / (series.length - 1)) * w;
      const y = h - ((series[i].price - min) / (max - min)) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }, [snapshot]);

  if (!isOpen) return null;

  const progress = total ? Math.min(1, snapshot.index / total) : 0;
  const bars = bookToBars(snapshot.lastBook);
  const cvd = cvdOf(snapshot);
  const fmtQty = (q) => (q >= 1000 ? `${(q / 1000).toFixed(2)}k` : q.toFixed(3));
  const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('ru-RU') : '—');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" data-testid="replay-modal">
      <div className="w-[900px] max-w-[95vw] h-[640px] max-h-[92vh] bg-[#0d1117] border border-[#30363d] rounded-lg flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#30363d]">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-200">⏯ Replay lake (задача 2.5)</h2>
            <select
              data-testid="replay-symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="bg-[#161b22] border border-[#30363d] text-slate-300 text-xs rounded px-1.5 py-0.5"
            >
              {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="text-[10px] text-slate-500 font-mono">
              {total ? `${snapshot.index.toLocaleString()} / ${total.toLocaleString()}` : 'загрузка…'}
            </span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white" data-testid="replay-close">
            <X size={16} />
          </button>
        </div>

        {/* Transport */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#30363d]">
          <button
            data-testid="replay-play"
            onClick={() => setPlaying((p) => !p)}
            disabled={loading || !!error || snapshot.finished}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[#1f6feb] text-white text-xs disabled:opacity-40"
            title={playing ? 'Пауза' : 'Play'}
          >
            {playing ? <Pause size={12} /> : <Play size={12} />}
            {playing ? 'Пауза' : 'Play'}
          </button>
          <button
            data-testid="replay-step"
            onClick={stepOnce}
            disabled={playing || loading}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[#21262d] border border-[#30363d] text-slate-300 text-xs disabled:opacity-40"
            title="Шаг: +1 событие"
          >
            <StepForward size={12} /> Шаг
          </button>
          <button
            data-testid="replay-rewind"
            onClick={() => { reset(); setLoading(true); fetchPage().finally(() => setLoading(false)); }}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[#21262d] border border-[#30363d] text-slate-300 text-xs"
            title="Сначала"
          >
            <Rewind size={12} /> Сначала
          </button>
          <div className="flex items-center gap-1 ml-2">
            <span className="text-[10px] text-slate-500">Скорость:</span>
            {SPEEDS.map((s) => (
              <button
                key={s}
                data-testid={`replay-speed-${s}`}
                onClick={() => setSpeed(s)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${speed === s ? 'bg-[#1f6feb] text-white' : 'bg-[#21262d] text-slate-400 border border-[#30363d]'}`}
              >
                {s >= 1000 ? `${s / 1000}k` : s}/с
              </button>
            ))}
          </div>
          <div className="flex-1 h-2 mx-3 bg-[#21262d] rounded overflow-hidden" data-testid="replay-progress">
            <div className="h-full bg-[#1f6feb]" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>

        {error && <div className="px-4 py-1.5 text-xs text-red-400 bg-red-950/40 border-b border-red-900/50">Ошибка: {error}</div>}

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-3 pt-2 text-[10px] font-mono text-slate-500">
              last: <span className="text-slate-200">{snapshot.lastPrice ?? '—'}</span>
              {' · '}t: <span className="text-slate-200">{fmtTime(snapshot.lastEventTs)}</span>
              {' · '}trades: <span className="text-slate-200">{snapshot.tradeCount}</span>
              {' · '}depth: <span className="text-slate-200">{snapshot.depthCount}</span>
              {' · '}CVD: <span className={cvd >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}>{cvd >= 0 ? '+' : ''}{fmtQty(cvd)}</span>
            </div>
            <div className="flex-1 p-3 min-h-0">
              <canvas ref={canvasRef} data-testid="replay-canvas" className="w-full h-full bg-[#0a0e14] border border-[#30363d] rounded" />
            </div>
          </div>

          {/* Стакан из последнего depth-события */}
          <div className="w-[260px] border-l border-[#30363d] p-2 overflow-y-auto">
            <div className="text-[10px] font-mono text-slate-500 mb-1">Стакан (последний depth)</div>
            {bars.asks.slice().reverse().map((a) => (
              <div key={`a${a.price}`} className="relative h-4 mb-px">
                <div className="absolute inset-y-0 right-0 bg-[#ef5350]/25" style={{ width: `${a.frac * 100}%` }} />
                <div className="relative flex justify-between px-1 text-[10px] font-mono leading-4 text-[#ef5350]">
                  <span>{a.price}</span><span>{fmtQty(a.qty)}</span>
                </div>
              </div>
            ))}
            <div className="my-1 border-t border-[#30363d]" />
            {bars.bids.map((b) => (
              <div key={`b${b.price}`} className="relative h-4 mb-px">
                <div className="absolute inset-y-0 left-0 bg-[#26a69a]/25" style={{ width: `${b.frac * 100}%` }} />
                <div className="relative flex justify-between px-1 text-[10px] font-mono leading-4 text-[#26a69a]">
                  <span>{b.price}</span><span>{fmtQty(b.qty)}</span>
                </div>
              </div>
            ))}
            {!snapshot.lastBook && <div className="text-[10px] text-slate-600">depth-события ещё не достигнуты</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
