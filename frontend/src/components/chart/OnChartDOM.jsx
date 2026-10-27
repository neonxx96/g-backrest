import { crosshairBus } from '../../services/crosshairBus.js';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Settings2, X } from 'lucide-react';
import { Slider } from '../ui/slider.jsx';
import { useLiquidityWallStore } from '../../stores/liquidityWallStore.js';
import { themeBridge } from '../../theme/themeBridge.js';
import {
  estimateTick, niceBinSize, barLength, buildDomBins, hexToRgba, fmtUsdCompact, fmtLife,
} from './onChartDomMath.js';

// On-Chart DOM: горизонтальная гистограмма плотностей L2 у правой ценовой шкалы.
// Один Canvas 2D (никаких DOM-нод на уровень), координаты — только через ChartEngine
// (priceTimeToCoord / subscribeViewportChange), без вызовов klinecharts.
// Данные — реальный стакан Binance Futures (REST deep snapshot); при отсутствии связи
// честный статус, без синтетики.

const API_BASE = '/api';
const POLL_MS = 2000;
const STALE_MS = 10000;
const SETTINGS_KEY = 'signalscript:onchart-dom-settings';
const ENABLED_KEY = 'signalscript:onchart-dom-enabled';
const MIN_ROW_PX = 9;

export const DEFAULT_DOM_SETTINGS = {
  lengthPx: 130,
  opacity: 0.55,
  bidColor: '#26a69a',
  askColor: '#ef5350',
  wallColor: '#fbbf24',
  logScale: true,
  minWallUsd: 250000,
  matureSec: 30,
  showText: true,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_DOM_SETTINGS;
    const p = JSON.parse(raw);
    return { ...DEFAULT_DOM_SETTINGS, ...(p && typeof p === 'object' ? p : {}) };
  } catch {
    return DEFAULT_DOM_SETTINGS;
  }
}

async function fetchBook(symbol) {
  const tryJson = async (url) => {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  let d;
  try {
    d = await tryJson(`${API_BASE}/depth?symbol=${symbol}&limit=500`);
  } catch {
    d = await tryJson(`https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=500`);
  }
  if (!d?.bids || !d?.asks) throw new Error('bad depth payload');
  const parse = (arr) => arr.map(([p, q]) => [parseFloat(p), parseFloat(q)]);
  return { bids: parse(d.bids), asks: parse(d.asks) };
}

export default function OnChartDOM({ engine, symbol }) {
  const canvasRef = useRef(null);
  const bookRef = useRef({ bids: [], asks: [], ts: 0 });
  const drawRef = useRef(() => {});
  const statsRef = useRef({ ms: 0, rows: 0 });
  const [enabled, setEnabled] = useState(() => localStorage.getItem(ENABLED_KEY) === 'true');
  const [settings, setSettings] = useState(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | loading | live | stale | error
  const [hud, setHud] = useState('');
  const settingsRef = useRef(settings);
  const tokensRef = useRef(themeBridge.getTokens());
  const syncPriceRef = useRef(null);

  useEffect(() => {
    return crosshairBus.subscribe(({ price }) => {
      syncPriceRef.current = price;
      requestAnimationFrame(() => drawRef.current());
    });
  }, []);


  settingsRef.current = settings;

  const update = (patch) => setSettings((prev) => {
    const next = { ...prev, ...patch };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* quota */ }
    return next;
  });
  const toggleEnabled = () => setEnabled((v) => {
    const nv = !v;
    try { localStorage.setItem(ENABLED_KEY, String(nv)); } catch { /* quota */ }
    return nv;
  });

  // --- Отрисовка ---------------------------------------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !engine?.isMounted()) return;
    const t0 = performance.now();
    const st = settingsRef.current;
    const parent = canvas.parentElement;
    const vp = engine.getViewport();
    if (!parent || !vp.width || !vp.height) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const axisW = Math.max(0, parent.clientWidth - vp.width); // ширина правой ценовой шкалы
    const w = Math.min(140, Math.min(st.lengthPx, vp.width));
    const h = vp.height;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.style.right = `${axisW}px`;

    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const { bids, asks } = bookRef.current;
    const bars = engine.getBars();
    const lastTs = bars.length ? bars[bars.length - 1].timestamp : null;
    if (!bids.length || !asks.length || lastTs == null) return;

    const tick = estimateTick(bids) || estimateTick(asks);
    if (!tick) return;
    const mid = (bids[0][0] + asks[0][0]) / 2;
    const [c0, c1] = engine.priceTimeToCoord([
      { timestamp: lastTs, price: mid },
      { timestamp: lastTs, price: mid + tick * 10 },
    ]);
    if (!c0 || !c1 || !Number.isFinite(c0.y) || !Number.isFinite(c1.y) || c0.y === c1.y) return;
    const slope = (c1.y - c0.y) / (tick * 10); // px на единицу цены (отрицателен: рост цены — вверх)
    const pxPerPrice = Math.abs(slope);
    const binSize = niceBinSize(pxPerPrice, MIN_ROW_PX, tick);
    const rowH = Math.max(1, binSize * pxPerPrice);
    const bins = buildDomBins(bids, asks, binSize);
    const yPrice = (price) => c0.y + (price - mid) * slope;

    let maxUsd = 0;
    for (const b of bins) if (b.usd > maxUsd) maxUsd = b.usd;
    if (maxUsd <= 0) return;

    const wallState = useLiquidityWallStore.getState().bySymbol[symbol];
    const walls = wallState?.walls || [];
    const wallMap = new Map(walls.map((x) => [`${x.side}:${x.price}`, x]));
    const alpha = st.opacity;
    let rows = 0;
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'middle';

    for (const b of bins) {
      const yc = yPrice(b.price);
      if (!Number.isFinite(yc) || yc < -rowH || yc > h + rowH) continue;
      const len = barLength(b.usd, maxUsd, w, st.logScale);
      const y = yc - rowH / 2;
      const baseColor = b.side === 'bid' ? (tokensRef.current.bull || st.bidColor) : (tokensRef.current.bear || st.askColor);
      const grad = ctx.createLinearGradient(w, 0, w - len, 0);
      grad.addColorStop(0, hexToRgba(baseColor, alpha * 0.85));
      grad.addColorStop(1, hexToRgba(baseColor, alpha * 0.15));
      ctx.fillStyle = grad;
      ctx.fillRect(w - len, y, len, Math.max(1, rowH - 1));
      rows += 1;
    }

    // Стенки (реальные, из LiquidityWallStore) — рамка, возраст и размер при достаточном масштабе
    for (const wl of walls) {
      if (wl.volumeUsd < st.minWallUsd) continue;
      const yc = yPrice(wl.price);
      if (!Number.isFinite(yc) || yc < -rowH || yc > h + rowH) continue;
      const len = barLength(wl.volumeUsd, maxUsd, w, st.logScale);
      const mature = wl.lifetimeSec >= st.matureSec;
      ctx.strokeStyle = hexToRgba(tokensRef.current.densityWall || st.wallColor, mature ? 0.95 : 0.5);
      ctx.lineWidth = mature ? 1.5 : 1;
      ctx.strokeRect(w - len + 0.5, yc - rowH / 2 + 0.5, len - 1, Math.max(1, rowH - 2));
      if (st.showText && rowH >= 11) {
        const txt = `${fmtUsdCompact(wl.volumeUsd)} ${fmtLife(wl.lifetimeSec, wl.ageIsLowerBound)}`;
        ctx.fillStyle = '#f3f4f6';
        ctx.textAlign = 'right';
        ctx.fillText(txt, w - 3, yc);
      }
    }

    // Недавние спуф-подозрения — красная вспышка на уровне (3 с)
    const events = wallState?.events || [];
    const nowTs = wallState?.meta?.lastTs ?? Date.now();
    for (const ev of events) {
      if (ev.type !== 'SPOOF_SUSPECT' || nowTs - ev.ts > 3000) continue;
      const yc = yPrice(ev.price);
      if (!Number.isFinite(yc)) continue;
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(1, yc - rowH / 2, w - 2, Math.max(2, rowH));
      ctx.setLineDash([]);
      if (st.showText) { ctx.fillStyle = '#fb7185'; ctx.textAlign = 'left'; ctx.fillText('SPOOF', 4, yc); }
    }
    
    // Crosshair Sync pointer line
    if (syncPriceRef.current && Number.isFinite(syncPriceRef.current)) {
      const sy = yPrice(syncPriceRef.current);
      if (sy >= 0 && sy <= h) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(w, sy);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    statsRef.current = { ms: performance.now() - t0, rows };
  }, [engine, symbol]);

  drawRef.current = draw;

  // Theme subscription
  useEffect(() => {
    return themeBridge.subscribe((tokens) => {
      tokensRef.current = tokens;
      drawRef.current();
    });
  }, []);

  // --- Подписка на viewport движка (zoom/scroll/resize) --------------------------
  useEffect(() => {
    if (!engine || !enabled) return undefined;
    const off = engine.subscribeViewportChange(() => drawRef.current());
    drawRef.current();
    return off;
  }, [engine, enabled]);

  // --- Поллинг реального стакана -> LiquidityWallStore -> перерисовка --------------
  useEffect(() => {
    if (!enabled || !symbol) return undefined;
    let cancelled = false;
    let failures = 0;
    let timer = null;
    bookRef.current = { bids: [], asks: [], ts: 0 };
    useLiquidityWallStore.getState().resetSymbol(symbol);
    setStatus('loading');

    const tick = async () => {
      try {
        const { bids, asks } = await fetchBook(symbol);
        if (cancelled) return;
        const ts = Date.now();
        bookRef.current = { bids, asks, ts };
        const t = estimateTick(bids) || estimateTick(asks);
        useLiquidityWallStore.getState().ingestBook(symbol, {
          ts, bids, asks, tick: t, minUsd: settingsRef.current.minWallUsd,
        }, 'rest');
        failures = 0;
        setStatus('live');
        drawRef.current();
        const s = statsRef.current;
        setHud(`DOM ${s.ms.toFixed(1)} мс · ${s.rows} строк · REST ${POLL_MS / 1000}с`);
      } catch {
        if (cancelled) return;
        failures += 1;
        if (failures >= 3) setStatus('error');
      } finally {
        if (!cancelled) {
          // устаревшие данные — честно очищаем слой, а не рисуем старое
          if (bookRef.current.ts && Date.now() - bookRef.current.ts > STALE_MS) {
            setStatus((s) => (s === 'error' ? s : 'stale'));
            bookRef.current = { bids: [], asks: [], ts: 0 };
            drawRef.current();
          }
          timer = setTimeout(tick, POLL_MS);
        }
      }
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [enabled, symbol]);

  // Перерисовка при смене настроек
  useEffect(() => { if (enabled) drawRef.current(); }, [settings, enabled]);

  // Очистка холста при выключении
  useEffect(() => {
    if (enabled) return;
    const c = canvasRef.current;
    if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
  }, [enabled]);

  const statusText = {
    idle: '', loading: 'Загрузка стакана…', live: '', stale: 'Данные стакана устарели',
    error: 'Нет данных стакана (Binance недоступен)',
  }[status];

  const Row = ({ label, children }) => (
    <label className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
      <span>{label}</span>{children}
    </label>
  );

  return (
    <>
      <canvas
        ref={canvasRef}
        data-onchart-dom="true"
        className="absolute top-0 pointer-events-none z-[5]"
        style={{ display: enabled ? 'block' : 'none' }}
      />
      <div className="absolute bottom-9 right-16 z-20 flex flex-col items-end gap-1 pointer-events-none">
        {enabled && statusText && (
          <div className="px-2 py-0.5 rounded bg-[#141a26]/90 border border-[#1f2638] text-[10px] text-amber-300">
            {statusText}
          </div>
        )}
        {enabled && !statusText && hud && (
          <div className="px-2 py-0.5 rounded bg-[#141a26]/80 border border-[#1f2638] text-[9px] text-muted-foreground font-mono">{hud}</div>
        )}
        {settingsOpen && (
          <div className="pointer-events-auto w-60 p-2.5 rounded bg-[#0f1420]/95 border border-[#1f2638] shadow-xl space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-foreground">
              Настройки DOM
              <button onClick={() => setSettingsOpen(false)} className="text-muted-foreground hover:text-foreground"><X size={12} /></button>
            </div>
            <Row label={`Длина: ${settings.lengthPx}px`}>
              <Slider min={60} max={400} step={10} value={[settings.lengthPx]} onValueChange={([val]) => update({ lengthPx: val })} className="w-28 py-1" />
            </Row>
            <Row label={`Прозрачность: ${Math.round(settings.opacity * 100)}%`}>
              <Slider min={0.1} max={1} step={0.05} value={[settings.opacity]} onValueChange={([val]) => update({ opacity: val })} className="w-28 py-1" />
            </Row>
            <Row label="Цвет bid"><input type="color" value={settings.bidColor} onChange={(e) => update({ bidColor: e.target.value })} /></Row>
            <Row label="Цвет ask"><input type="color" value={settings.askColor} onChange={(e) => update({ askColor: e.target.value })} /></Row>
            <Row label="Цвет стенки"><input type="color" value={settings.wallColor} onChange={(e) => update({ wallColor: e.target.value })} /></Row>
            <Row label="Лог-шкала"><input type="checkbox" checked={settings.logScale} onChange={(e) => update({ logScale: e.target.checked })} /></Row>
            <Row label="Текст на стенках"><input type="checkbox" checked={settings.showText} onChange={(e) => update({ showText: e.target.checked })} /></Row>
            <Row label={`Мин. стенка: $${fmtUsdCompact(settings.minWallUsd)}`}>
              <Slider min={50000} max={5000000} step={50000} value={[settings.minWallUsd]} onValueChange={([val]) => update({ minWallUsd: val })} className="w-28 py-1" />
            </Row>
            <Row label={`Зрелая стенка: ${settings.matureSec}с`}>
              <Slider min={5} max={300} step={5} value={[settings.matureSec]} onValueChange={([val]) => update({ matureSec: val })} className="w-28 py-1" />
            </Row>
            <button onClick={() => update(DEFAULT_DOM_SETTINGS)} className="w-full mt-1 text-[10px] text-muted-foreground hover:text-foreground border border-[#1f2638] rounded py-0.5">Сбросить</button>
          </div>
        )}
        <div className="pointer-events-auto flex items-center gap-1">
          {enabled && (
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              title="Настройки On-Chart DOM"
              className="p-1 rounded bg-[#141a26]/90 border border-[#1f2638] text-muted-foreground hover:text-foreground"
            ><Settings2 size={12} /></button>
          )}
          <button
            onClick={toggleEnabled}
            title="On-Chart DOM: плотности стакана у шкалы цен"
            className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${enabled ? 'bg-amber-500/20 border-amber-400/60 text-amber-300' : 'bg-[#141a26]/90 border-[#1f2638] text-muted-foreground hover:text-foreground'}`}
          >DOM</button>
        </div>
      </div>
    </>
  );
}
