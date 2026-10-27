import React, { useEffect, useRef, useState, useCallback } from 'react';
import { themeBridge } from '../../theme/themeBridge.js';
import { Settings2, X } from 'lucide-react';
import { TF_MS } from '../../services/marketDataFetcher.js';
import { fmtVol } from '../docking/footprintGrid.js';
import { hexToRgba, fmtUsdCompact } from './onChartDomMath.js';
import {
  isTfSupported,
  rebinLevels,
  mergeClustersToTf,
  computeBarMetrics,
  computeNakedPocs,
  lodFor,
  createFrameStats,
  CLUSTER_BUCKET_MS
} from './footprintLayerMath.js';

const API_BASE = '/api';
const POLL_INTERVAL_MS = 2500;
const SETTINGS_KEY = 'signalscript:footprint-layer-settings';
const ENABLED_KEY = 'signalscript:footprint-layer-enabled';

export const DEFAULT_FP_SETTINGS = {
  displayMode: 'bid_ask', // 'bid_ask' | 'delta' | 'volume'
  scale: 1,               // 1 | 2 | 5 | 10
  imbalanceRatio: 3.0,    // 2.0 | 3.0 | 4.0
  showNakedPoc: true,
  showDeltaTable: true,
  opacity: 0.75,
  buyColor: '#10b981',
  sellColor: '#ef4444',
  pocColor: '#fbbf24',
  npocColor: '#f59e0b',
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_FP_SETTINGS;
    const p = JSON.parse(raw);
    return { ...DEFAULT_FP_SETTINGS, ...(p && typeof p === 'object' ? p : {}) };
  } catch {
    return DEFAULT_FP_SETTINGS;
  }
}

export default function FootprintCanvasLayer({ engine, symbol, timeframe = '15m' }) {
  const canvasRef = useRef(null);
  const rawClustersRef = useRef([]);
  const frameStatsRef = useRef(createFrameStats(30));
  const drawRef = useRef(() => {});

  const [enabled, setEnabled] = useState(() => localStorage.getItem(ENABLED_KEY) === 'true');
  const [settings, setSettings] = useState(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'live' | 'no_data' | 'unsupported_tf' | 'error'
  const [hud, setHud] = useState('');

  const settingsRef = useRef(settings);
  const tokensRef = useRef(themeBridge.getTokens());


  settingsRef.current = settings;

  const updateSetting = (patch) => setSettings((prev) => {
    const next = { ...prev, ...patch };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  const toggleEnabled = () => setEnabled((v) => {
    const nv = !v;
    try { localStorage.setItem(ENABLED_KEY, String(nv)); } catch { /* ignore */ }
    return nv;
  });

  const tfMs = TF_MS[timeframe] || 900000;
  const supported = isTfSupported(tfMs, CLUSTER_BUCKET_MS);

  // --- Fetch real clusters from backend -----------------------------------------
  useEffect(() => {
    if (!enabled || !symbol) return undefined;
    if (!supported) {
      setStatus('unsupported_tf');
      rawClustersRef.current = [];
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      return undefined;
    }

    let cancelled = false;
    let timer = null;
    setStatus('loading');

    const fetchClusters = async () => {
      try {
        const params = new URLSearchParams({
          symbol: symbol.toUpperCase(),
          limit: '45',
          scale: String(settingsRef.current.scale),
          imbalance_ratio: String(settingsRef.current.imbalanceRatio),
        });
        const res = await fetch(`${API_BASE}/recorder/clusters?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;

        if (Array.isArray(data) && data.length > 0) {
          rawClustersRef.current = data;
          setStatus('live');
        } else {
          rawClustersRef.current = [];
          setStatus('no_data');
        }
        drawRef.current();
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
      } finally {
        if (!cancelled) {
          timer = setTimeout(fetchClusters, POLL_INTERVAL_MS);
        }
      }
    };

    fetchClusters();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, symbol, timeframe, supported]);

  // --- Render Frame -------------------------------------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !engine?.isMounted() || !enabled) return;
    const t0 = performance.now();
    const st = settingsRef.current;
    const parent = canvas.parentElement;
    const vp = engine.getViewport();
    if (!parent || !vp.width || !vp.height) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pw = Math.round(vp.width * dpr);
    const ph = Math.round(vp.height * dpr);
    canvas.style.width = `${vp.width}px`;
    canvas.style.height = `${vp.height}px`;

    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vp.width, vp.height);

    if (!supported || rawClustersRef.current.length === 0) return;

    // Склейка 5-минутных корзин в бары текущего таймфрейма
    const tfBars = mergeClustersToTf(rawClustersRef.current, tfMs, Date.now(), CLUSTER_BUCKET_MS);
    if (tfBars.length === 0) return;

    const chartCandles = engine.getBars();
    const visibleRange = engine.getVisibleRange();

    // Преобразуем бары в структуру с метриками и экранными координатами
    const processedBars = [];
    for (const tb of tfBars) {
      const rebinned = rebinLevels(tb.levels, 0);
      const metrics = computeBarMetrics(rebinned, st.imbalanceRatio, 0.08);
      processedBars.push({
        ...tb,
        metrics,
        poc: metrics.poc,
      });
    }

    // Расчет Naked POC линий по истории
    const npocs = st.showNakedPoc ? computeNakedPocs(processedBars, chartCandles, tfMs) : [];

    // Ширина колонки футпринта зависит от текущего barSpace
    const colWidth = Math.max(8, Math.min(140, (vp.barSpace || 10) * 0.92));

    const scale = tokensRef.current?.uiScale || 1.0;
    const fSz = (px) => `${Math.round(px * scale * 10) / 10}px "IBM Plex Mono", monospace`;

    ctx.font = fSz(9);
    ctx.textBaseline = 'middle';

    let renderedBarsCount = 0;

    for (const b of processedBars) {
      if (!b.levels || b.levels.length === 0) continue;

      // Получаем координаты центра бара и уровней
      const centerCoord = engine.priceTimeToCoord([{ timestamp: b.timestamp, price: b.poc || b.levels[0].price }]);
      const anchor = centerCoord[0];
      if (!anchor || !Number.isFinite(anchor.x)) continue;

      // Отсекаем бары вне экрана
      if (anchor.x < -colWidth || anchor.x > vp.width + colWidth) continue;

      const left = anchor.x - colWidth / 2;
      const right = anchor.x + colWidth / 2;

      // Высота уровня цен в пикселях
      let rowHeight = 7;
      if (b.levels.length > 1) {
        const p0 = Number(b.levels[0].price);
        const p1 = Number(b.levels[1].price);
        const pts = engine.priceTimeToCoord([
          { timestamp: b.timestamp, price: p0 },
          { timestamp: b.timestamp, price: p1 }
        ]);
        if (pts[0] && pts[1] && Number.isFinite(pts[0].y) && Number.isFinite(pts[1].y)) {
          rowHeight = Math.max(3, Math.min(24, Math.abs(pts[1].y - pts[0].y)));
        }
      }

      const lod = lodFor(colWidth, rowHeight);
      if (lod.cells === 'none') continue;

      renderedBarsCount++;
      const maxVol = b.metrics.maxVol || 1;

      // 1. Отрисовка ячеек уровней
      let minLevelY = Infinity;
      let maxLevelY = -Infinity;

      for (const lvl of b.metrics.levels) {
        const [c] = engine.priceTimeToCoord([{ timestamp: b.timestamp, price: lvl.price }]);
        if (!c || !Number.isFinite(c.y)) continue;

        minLevelY = Math.min(minLevelY, c.y);
        maxLevelY = Math.max(maxLevelY, c.y);

        const yTop = c.y - rowHeight / 2;
        const totalVol = lvl.buy + lvl.sell;
        const share = Math.min(1, totalVol / maxVol);
        const isBuyDelta = lvl.delta >= 0;

        // Фоновая заливка ячейки по дельте и доле объема
        const baseColor = isBuyDelta ? (tokensRef.current.bull || st.buyColor) : (tokensRef.current.bear || st.sellColor);
        const alpha = Math.min(0.9, st.opacity * (0.18 + 0.52 * share));
        ctx.fillStyle = hexToRgba(baseColor, alpha);

        if (st.displayMode === 'bid_ask') {
          // Разделение бара пополам: Bid слева, Ask справа
          const halfW = colWidth / 2;
          const buyShare = totalVol > 0 ? lvl.buy / totalVol : 0.5;
          const sellShare = totalVol > 0 ? lvl.sell / totalVol : 0.5;

          // Bid плашка слева
          ctx.fillStyle = hexToRgba(tokensRef.current.bear || st.sellColor, alpha * (0.3 + 0.7 * sellShare));
          ctx.fillRect(left, yTop, halfW - 0.5, rowHeight - 0.5);

          // Ask плашка справа
          ctx.fillStyle = hexToRgba(tokensRef.current.bull || st.buyColor, alpha * (0.3 + 0.7 * buyShare));
          ctx.fillRect(left + halfW + 0.5, yTop, halfW - 0.5, rowHeight - 0.5);

          // Текст чисел (Bid x Ask) при достаточном LOD
          if (lod.text) {
            ctx.font = fSz(8.5);
            // Bid (продажи по рынку в бид) слева
            ctx.fillStyle = lvl.imbalance === 'sell' ? '#fca5a5' : '#e5e7eb';
            ctx.textAlign = 'right';
            ctx.fillText(fmtVol(lvl.sell), left + halfW - 3, c.y);

            // Ask (покупки по рынку в аск) справа
            ctx.fillStyle = lvl.imbalance === 'buy' ? '#86efac' : '#e5e7eb';
            ctx.textAlign = 'left';
            ctx.fillText(fmtVol(lvl.buy), left + halfW + 3, c.y);
          }
        } else if (st.displayMode === 'delta') {
          // Заливка полосы дельты
          ctx.fillRect(left, yTop, colWidth, rowHeight - 0.5);
          if (lod.text) {
            ctx.fillStyle = '#f3f4f6';
            ctx.textAlign = 'center';
            const sign = lvl.delta >= 0 ? '+' : '';
            ctx.fillText(`${sign}${fmtVol(lvl.delta)}`, anchor.x, c.y);
          }
        } else {
          // Режим Volume
          ctx.fillRect(left, yTop, colWidth, rowHeight - 0.5);
          if (lod.text) {
            ctx.fillStyle = '#f3f4f6';
            ctx.textAlign = 'center';
            ctx.fillText(fmtVol(totalVol), anchor.x, c.y);
          }
        }

        // Подсветка POC свечи контрастной рамкой
        if (lvl.isPoc) {
          ctx.strokeStyle = st.pocColor;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(left - 0.5, yTop - 0.5, colWidth + 1, rowHeight);
        }

        // Подсветка имбаланса (Imbalance badge)
        if (lvl.imbalance) {
          ctx.strokeStyle = lvl.imbalance === 'buy' ? (tokensRef.current.bull || '#10b981') : (tokensRef.current.bear || '#ef4444');
          ctx.lineWidth = 1;
          ctx.strokeRect(left, yTop, colWidth, rowHeight - 0.5);
        }
      }

      // 2. Итоговая табличка Delta / Total под свечой (Скриншот 4)
      if (st.showDeltaTable && lod.plate && Number.isFinite(maxLevelY)) {
        const tableY = maxLevelY + rowHeight / 2 + 5;
        const plateH = 22;
        const isPos = b.metrics.delta >= 0;

        ctx.fillStyle = 'rgba(15, 20, 32, 0.92)';
        ctx.strokeStyle = '#1f2638';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(left - 2, tableY, colWidth + 4, plateH, 3);
        ctx.fill();
        ctx.stroke();

        ctx.font = fSz(8);
        ctx.textAlign = 'center';
        // Delta строка
        ctx.fillStyle = isPos ? '#34d399' : '#f87171';
        ctx.fillText(`Δ ${isPos ? '+' : ''}${fmtVol(b.metrics.delta)}`, anchor.x, tableY + 6);
        // Total строка
        ctx.fillStyle = '#9ca3af';
        ctx.fillText(`Vol ${fmtVol(b.metrics.total)}`, anchor.x, tableY + 16);
      }
    }

    // 3. Линии Naked POC (горизонтальное продление непокрытых уровней)
    if (st.showNakedPoc && npocs.length > 0) {
      for (const np of npocs) {
        if (!np.isNaked) continue;
        const [cStart] = engine.priceTimeToCoord([{ timestamp: np.fromTs, price: np.price }]);
        if (!cStart || !Number.isFinite(cStart.y)) continue;

        ctx.strokeStyle = st.npocColor;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(Math.max(0, cStart.x), cStart.y);
        ctx.lineTo(vp.width, cStart.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Метка уровня у правого края
        ctx.fillStyle = st.npocColor;
        ctx.font = fSz(8);
        ctx.textAlign = 'right';
        ctx.fillText(`NPOC ${np.price}`, vp.width - 6, cStart.y - 4);
      }
    }

    const elapsedMs = performance.now() - t0;
    frameStatsRef.current.push(elapsedMs);
    const fps = elapsedMs > 0 ? Math.min(144, Math.round(1000 / Math.max(elapsedMs, 6.9))) : 120;
    setHud(`FP ${elapsedMs.toFixed(1)} мс · ${fps} FPS · ${renderedBarsCount} баров`);
  }, [engine, enabled, tfMs, supported]);

  drawRef.current = draw;

  // Theme subscription
  useEffect(() => {
    return themeBridge.subscribe((tokens) => {
      tokensRef.current = tokens;
      drawRef.current();
    });
  }, []);

  // Подписка на события движения/масштабирования графика через ChartEngine
  useEffect(() => {
    if (!engine || !enabled) return undefined;
    const off = engine.subscribeViewportChange(() => drawRef.current());
    drawRef.current();
    return off;
  }, [engine, enabled]);

  // Перерисовка при смене настроек
  useEffect(() => {
    if (enabled) drawRef.current();
  }, [settings, enabled]);

  // Очистка при выключении
  useEffect(() => {
    if (enabled) return;
    const c = canvasRef.current;
    if (c) {
      const ctx = c.getContext('2d');
      ctx?.clearRect(0, 0, c.width, c.height);
    }
  }, [enabled]);

  const statusBadge = {
    idle: '',
    loading: 'Загрузка кластеров…',
    live: '',
    no_data: 'Нет тиковых данных (No Tape Data)',
    unsupported_tf: 'Кластеры строятся для TF >= 5m',
    error: 'Ошибка подключения к кластерам',
  }[status];

  const Row = ({ label, children }) => (
    <label className="flex items-center justify-between gap-3 text-[10px] text-gray-400">
      <span>{label}</span>{children}
    </label>
  );

  return (
    <>
      <canvas
        ref={canvasRef}
        data-footprint-layer="true"
        className="absolute top-0 left-0 pointer-events-none z-[6]"
        style={{ display: enabled ? 'block' : 'none' }}
      />
      <div className="absolute bottom-9 right-36 z-20 flex flex-col items-end gap-1 pointer-events-none">
        {enabled && statusBadge && (
          <div className="px-2 py-0.5 rounded bg-[#141a26]/90 border border-[#1f2638] text-[10px] text-amber-300 font-mono">
            {statusBadge}
          </div>
        )}
        {enabled && !statusBadge && hud && (
          <div className="px-2 py-0.5 rounded bg-[#141a26]/80 border border-[#1f2638] text-[9px] text-gray-400 font-mono">
            {hud}
          </div>
        )}
        {settingsOpen && (
          <div className="pointer-events-auto w-64 p-2.5 rounded bg-[#0f1420]/95 border border-[#1f2638] shadow-xl space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-gray-200">
              Настройки Footprint
              <button onClick={() => setSettingsOpen(false)} className="text-gray-500 hover:text-gray-200"><X size={12} /></button>
            </div>
            <Row label="Режим">
              <select
                value={settings.displayMode}
                onChange={(e) => updateSetting({ displayMode: e.target.value })}
                className="bg-[#141a26] border border-[#1f2638] rounded px-1 py-0.5 text-[10px] text-gray-200"
              >
                <option value="bid_ask">Bid × Ask</option>
                <option value="delta">Delta</option>
                <option value="volume">Volume</option>
              </select>
            </Row>
            <Row label="Шаг цены (Scale)">
              <div className="flex gap-1">
                {[1, 2, 5, 10].map((sc) => (
                  <button
                    key={sc}
                    type="button"
                    onClick={() => updateSetting({ scale: sc })}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${settings.scale === sc ? 'bg-blue-600 text-white font-bold' : 'bg-[#141a26] text-gray-400'}`}
                  >
                    {sc}x
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Порог имбаланса">
              <div className="flex gap-1">
                {[2.0, 3.0, 4.0].map((imb) => (
                  <button
                    key={imb}
                    type="button"
                    onClick={() => updateSetting({ imbalanceRatio: imb })}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${settings.imbalanceRatio === imb ? 'bg-amber-600 text-white font-bold' : 'bg-[#141a26] text-gray-400'}`}
                  >
                    {imb * 100}%
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Naked POC линии">
              <input type="checkbox" checked={settings.showNakedPoc} onChange={(e) => updateSetting({ showNakedPoc: e.target.checked })} />
            </Row>
            <Row label="Табличка Delta/Vol">
              <input type="checkbox" checked={settings.showDeltaTable} onChange={(e) => updateSetting({ showDeltaTable: e.target.checked })} />
            </Row>
            <Row label={`Прозрачность: ${Math.round(settings.opacity * 100)}%`}>
              <input type="range" min="0.2" max="1" step="0.05" value={settings.opacity} onChange={(e) => updateSetting({ opacity: Number(e.target.value) })} />
            </Row>
            <button
              onClick={() => updateSetting(DEFAULT_FP_SETTINGS)}
              className="w-full mt-1 text-[10px] text-gray-400 hover:text-gray-200 border border-[#1f2638] rounded py-0.5"
            >
              Сбросить
            </button>
          </div>
        )}
        <div className="pointer-events-auto flex items-center gap-1">
          {enabled && (
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              title="Настройки Footprint"
              className="p-1 rounded bg-[#141a26]/90 border border-[#1f2638] text-gray-400 hover:text-gray-100"
            >
              <Settings2 size={12} />
            </button>
          )}
          <button
            onClick={toggleEnabled}
            title="Footprint: кластеры объёмов Bid x Ask, дельта и Naked POC"
            className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${
              enabled
                ? 'bg-blue-500/20 border-blue-400/60 text-blue-300'
                : 'bg-[#141a26]/90 border-[#1f2638] text-gray-400 hover:text-gray-100'
            }`}
          >
            FP
          </button>
        </div>
      </div>
    </>
  );
}
