import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Activity, Radio } from 'lucide-react';
import ChannelSelector from './ChannelSelector';
import { useColorLinksStore } from '../../stores/colorLinksStore';
import { fmtVol } from './footprintGrid';

const API_BASE = '/api';
const REFRESH_MS = 3000;
const CANDLES = 90;

/**
 * CVD (Кумулятивная дельта объёма) — реальный виджет вместо заглушки.
 * Источник: /api/recorder/clusters (агрегаты трейдов рекордера).
 * Рисуем на canvas: столбики дельты по свечам + линию накопленной CVD.
 * Единицы — базовый актив (COIN); пересчёт в USDT — по цене POC свечи.
 */
export default function CvdWidget({ panelId = 'cvd_placeholder' }) {
  const currentSymbol = useColorLinksStore((s) => s.getPanelSymbol(panelId, 'BTCUSDT'));
  const [candles, setCandles] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(`${API_BASE}/recorder/clusters?symbol=${encodeURIComponent(currentSymbol)}&limit=${CANDLES}&scale=1`)
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          if (cancelled) return;
          const arr = Array.isArray(data) ? [...data] : [];
          arr.sort((a, b) => (a?.timestamp || 0) - (b?.timestamp || 0));
          setCandles(arr);
          setLastUpdate(Date.now());
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [currentSymbol]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const series = useMemo(() => {
    let cum = 0;
    return candles.map((c) => {
      const delta = Number(c?.total_delta) || 0;
      const price = Number(c?.poc_price) || 0;
      cum += delta;
      return { ts: c?.timestamp || 0, delta, cvd: cum, price };
    });
  }, [candles]);

  const stats = useMemo(() => {
    if (!series.length) return { cvd: 0, buyVol: 0, sellVol: 0, delta: 0 };
    const delta = series.reduce((a, p) => a + p.delta, 0);
    let buyVol = 0;
    let sellVol = 0;
    candles.forEach((c) => {
      const vol = Number(c?.total_volume) || 0;
      const d = Number(c?.total_delta) || 0;
      buyVol += (vol + d) / 2;
      sellVol += (vol - d) / 2;
    });
    return { cvd: series[series.length - 1].cvd, buyVol, sellVol, delta };
  }, [series, candles]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 40 || size.h < 40 || series.length < 2) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size.w, size.h);

    const pad = { l: 8, r: 56, t: 10, b: 18 };
    const plotW = size.w - pad.l - pad.r;
    const plotH = size.h - pad.t - pad.b;
    const n = series.length;
    const stepX = plotW / n;

    const deltas = series.map((p) => p.delta);
    const cvds = series.map((p) => p.cvd);
    const maxAbsDelta = Math.max(...deltas.map(Math.abs), 1e-9);
    const minCvd = Math.min(...cvds);
    const maxCvd = Math.max(...cvds);
    const span = Math.max(maxCvd - minCvd, 1e-9);

    const yDelta = (d) => pad.t + plotH / 2 - (d / maxAbsDelta) * (plotH * 0.32);
    const yCvd = (v) => pad.t + plotH - ((v - minCvd) / span) * (plotH * 0.86) - plotH * 0.07;

    // сетка нуля
    ctx.strokeStyle = 'rgba(148,163,184,0.25)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(pad.l, yDelta(0));
    ctx.lineTo(pad.l + plotW, yDelta(0));
    ctx.stroke();
    ctx.setLineDash([]);

    // столбики дельты по свечам
    for (let i = 0; i < n; i += 1) {
      const x = pad.l + i * stepX;
      const d = deltas[i];
      const y = yDelta(d);
      const y0 = yDelta(0);
      ctx.fillStyle = d >= 0 ? 'rgba(16,185,129,0.45)' : 'rgba(244,63,94,0.45)';
      ctx.fillRect(x + stepX * 0.15, Math.min(y, y0), stepX * 0.7, Math.abs(y0 - y) || 1);
    }

    // линия накопленной CVD
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    series.forEach((p, i) => {
      const x = pad.l + i * stepX + stepX / 2;
      const y = yCvd(p.cvd);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // подписи шкалы CVD справа
    ctx.fillStyle = 'rgba(148,163,184,0.8)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(fmtVol(maxCvd), pad.l + plotW + 4, yCvd(maxCvd) + 3);
    ctx.fillText(fmtVol(minCvd), pad.l + plotW + 4, yCvd(minCvd) + 3);
    const last = series[n - 1];
    ctx.fillStyle = last.cvd >= 0 ? '#34d399' : '#fb7185';
    ctx.fillText(fmtVol(last.cvd), pad.l + plotW + 4, yCvd(last.cvd) + 3);
  }, [series, size]);

  const isLive = lastUpdate && Date.now() - lastUpdate < REFRESH_MS * 4;
  const hasData = series.length > 1;

  return (
    <div
      data-testid="cvd-widget"
      className="h-full w-full flex flex-col font-sans select-none bg-background text-foreground border-r border-border relative"
    >
      <div className="px-2.5 py-1.5 border-b border-border bg-card flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center space-x-1.5">
          <Activity size={12} className="text-bull" />
          <span className="font-bold text-[11px] text-foreground">CVD (Кумулятивная дельта)</span>
          <span className="text-[10px] text-primary font-mono font-semibold">{currentSymbol}</span>
          {hasData && (
            <span
              className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                stats.cvd >= 0 ? 'bg-bull/10 text-bull' : 'bg-bear/10 text-bear'
              }`}
              title="Накопленная дельта окна"
            >
              CVD {stats.cvd >= 0 ? '+' : ''}{fmtVol(stats.cvd)}
            </span>
          )}
        </div>
        <div className="flex items-center space-x-1.5">
          {hasData && (
            <span className="flex items-center space-x-1 text-[9px] font-mono text-muted-foreground">
              <Radio size={10} className={isLive ? 'text-bull animate-pulse' : 'text-muted-foreground'} />
              <span>{isLive ? 'LIVE' : 'пауза'}</span>
            </span>
          )}
          <ChannelSelector panelId={panelId} />
        </div>
      </div>

      <div ref={wrapRef} className="flex-1 relative min-h-0">
        {hasData ? (
          <canvas ref={canvasRef} className="absolute inset-0" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center space-y-2 p-4">
            <Activity size={22} className="text-muted-foreground animate-pulse" />
            <div className="text-[11px] font-bold text-foreground">Нет данных CVD для {currentSymbol}</div>
            <div className="text-[10px] text-muted-foreground max-w-xs leading-relaxed">
              Кластеры появятся, когда рекордер накопит трейды по символу (до 5 минут). Виджет использует
              те же серверные агрегаты, что и Футпринт / Кластеры.
            </div>
          </div>
        )}
      </div>

      {hasData && (
        <div className="px-2.5 py-1 border-t border-border bg-card flex items-center justify-between text-[9.5px] font-mono text-muted-foreground shrink-0">
          <span>
            Свечей: <span className="text-foreground/80">{series.length}</span> · Buy:{' '}
            <span className="text-bull">{fmtVol(stats.buyVol)}</span> · Sell:{' '}
            <span className="text-bear">{fmtVol(stats.sellVol)}</span> · Δ:{' '}
            <span className={stats.delta >= 0 ? 'text-bull' : 'text-bear'}>
              {stats.delta >= 0 ? '+' : ''}
              {fmtVol(stats.delta)}
            </span>
          </span>
          <span>{lastUpdate ? `обновлено ${new Date(lastUpdate).toLocaleTimeString('ru-RU')}` : ''}</span>
        </div>
      )}
    </div>
  );
}
