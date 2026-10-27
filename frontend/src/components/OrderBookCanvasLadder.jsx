import { crosshairBus } from '../services/crosshairBus';
import React, { useRef, useEffect, useCallback } from 'react';
import { useTradeOverlayStore } from '../stores/tradeOverlayStore';
import { themeBridge } from '../theme/themeBridge';

/**
 * High-Performance Canvas 2D Ladder Renderer for OrderBookDOM
 *
 * SPECIFICATION & REGRESSION CHECKLIST PRESERVATION:
 * 1. Колонка «ЖИЗНЬ»: Рендерит бейджи [<10s], [10-30s], [>30s] для зрелых плотностей.
 * 2. Детектор спуфинга: Подсвечивает снятые стенки контрастной вспышкой цвета.
 * 3. Звук при приближении: Вычисляется в OrderBookDOM и передается в аудио-движок.
 * 4. Горячие клавиши: Обрабатываются в OrderBookDOM (Space - центрирование, 1..6 - шаг).
 * 5. Подсветка плотностей: Плавные бары объема (зеленый Bid, красный Ask, золотой $1M+).
 * 6. Переключатель COIN / USDT: Выбор единиц объема в строках.
 * 7. Агрегация тиков: Шаг x1..x100.
 * 8. Позиции и уровни: Синхронизированные плашки ENTRY (синяя), SL (красная), TP1/TP2 (зеленые).
 */

export default function OrderBookCanvasLadder({
  visibleRows = [],
  aggregatedData = {},
  levelLifetimes,
  spoofRemovedAlerts,
  stepSize = 1,
  priceDecimals = 1,
  volumeMode = 'USDT',
  rowHeight = 20,
  volumePalette = 'classic',
  megaWallUsd = 1000000,
  densityThresholdUsd = 250000,
  strategyLevels = [],
  userLimitOrders = [],
  activePositionSetup = null,
  width = 320,
  height = 500,
  onRowClick = null,
  onHoverRow = null
}) {
  const tokensRef = useRef(themeBridge.getTokens());
  const scale = tokensRef.current?.uiScale || 1.0;
  const ROW_HEIGHT = Math.round(Math.max(14, Math.min(32, Number(rowHeight) || 20)) * scale);
  const fSz = (px, bold = false) => `${bold ? 'bold ' : ''}${Math.round(px * scale * 10) / 10}px monospace`;
  const canvasRef = useRef(null);
  const hoverIdxRef = useRef(-1);
  const syncPriceRef = useRef(null);



  // Formatting compact dollar strings
  const fmtUsd = useCallback((usd) => {
    if (!usd || usd <= 0) return '';
    if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
    if (usd >= 10_000) return `$${(usd / 1_000).toFixed(0)}K`;
    if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
    return `$${Math.round(usd)}`;
  }, []);

  const fmtQty = useCallback((qty) => {
    if (!qty || qty <= 0) return '';
    if (qty >= 1_000_000) return `${(qty / 1_000_000).toFixed(2)}M`;
    if (qty >= 1_000) return `${(qty / 1_000).toFixed(1)}K`;
    return `${qty.toFixed(2)}`;
  }, []);

  // Main Canvas Render Frame
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = width;
    const h = height;

    // Immediate CSS stretch to avoid layout jitter
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    // Synchronous buffer reallocation matching CSS bounding box * DPR
    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Clear background
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, w, h);

    if (!visibleRows || visibleRows.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = fSz(11);
      ctx.textAlign = 'center';
      ctx.fillText('Загрузка стакана L2...', w / 2, h / 2);
      ctx.restore();
      return;
    }

    // Column geometry: Cluster (32%), Ticks (12%), Depth Volume (34%), Price (22%)
    const colClusterW = Math.round(w * 0.32);
    const colTicksW = Math.round(w * 0.12);
    const colDepthW = Math.round(w * 0.34);
    const colPriceW = w - colClusterW - colTicksW - colDepthW;

    const colClusterX = 0;
    const colTicksX = colClusterW;
    const colDepthX = colTicksX + colTicksW;
    const colPriceX = colDepthX + colDepthW;

    const maxDomVal = aggregatedData.maxDomVal || 1;
    const maxClusterUsd = aggregatedData.maxClusterUsd || 1;
    const bestBid = aggregatedData.bestBidSnap || 0;
    const bestAsk = aggregatedData.bestAskSnap || 0;
    const lastPrice = aggregatedData.lastPriceSnap || 0;

    const now = Date.now();

    // Zero-latency transient setup from chart overlay dragging
    const liveSetup = useTradeOverlayStore.getState().activeSetup || activePositionSetup;
    const entryP = Number(liveSetup?.entry_price || 0);
    const slP = Number(liveSetup?.sl_price || 0);
    const tp1P = Number(liveSetup?.tp1_price || 0);
    const tp2P = Number(liveSetup?.tp2_price || 0);

    // 2. Render each visible ladder row
    for (let r = 0; r < visibleRows.length; r++) {
      const row = visibleRows[r];
      const y = r * ROW_HEIGHT;
      if (y + ROW_HEIGHT < 0 || y > h) continue;

      const ask = aggregatedData.askBuckets ? aggregatedData.askBuckets.get(row.key) : null;
      const bid = aggregatedData.bidBuckets ? aggregatedData.bidBuckets.get(row.key) : null;
      const cl = aggregatedData.clusterBuckets ? aggregatedData.clusterBuckets.get(row.key) : null;
      const spoofAlert = spoofRemovedAlerts ? spoofRemovedAlerts.get(row.key) : null;
      const isSpoofActive = spoofAlert && now < spoofAlert.expiresAt;

      const isBestAsk = bestAsk > 0 && Math.abs(row.price - bestAsk) < stepSize * 0.4;
      const isBestBid = bestBid > 0 && Math.abs(row.price - bestBid) < stepSize * 0.4;
      const isCurrentPrice = lastPrice > 0 && Math.abs(row.price - lastPrice) < stepSize * 0.4;
      const isAskZone = row.price >= (bestAsk || 0);

      const bookItem = ask || bid;
      const side = ask ? 'ask' : bid ? 'bid' : isAskZone ? 'ask' : 'bid';
      const usdVal = bookItem ? bookItem.usd : 0;
      const rawVal = bookItem ? (volumeMode === 'USDT' ? bookItem.usd : bookItem.qty) : 0;

      const isMegaWall = usdVal >= megaWallUsd;
      const isLargeWall = usdVal >= 500_000 || usdVal >= densityThresholdUsd;

      // Wall lifetime
      const firstSeen = levelLifetimes ? levelLifetimes.get(row.key) : 0;
      const lifeSec = firstSeen ? Math.max(0, Math.floor((now - firstSeen) / 1000)) : 0;

      // 2a. Row background styling
      if (isCurrentPrice) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
        ctx.fillRect(0, y, w, ROW_HEIGHT);
      } else if (isBestBid) {
        ctx.fillStyle = tokensRef.current.bullSoft || 'rgba(16, 185, 129, 0.14)';
        ctx.fillRect(0, y, w, ROW_HEIGHT);
      } else if (isBestAsk) {
        ctx.fillStyle = tokensRef.current.bearSoft || 'rgba(244, 63, 94, 0.14)';
        ctx.fillRect(0, y, w, ROW_HEIGHT);
      } else if (isSpoofActive) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
        ctx.fillRect(0, y, w, ROW_HEIGHT);
      } else if (r % 2 === 1) {
        ctx.fillStyle = '#090c12';
        ctx.fillRect(0, y, w, ROW_HEIGHT);
      }

      // 2b. Cluster column bar (bid vs ask or delta)
      if (cl && cl.totalUsd > 0) {
        const clBarW = Math.min(colClusterW - 6, Math.round((cl.totalUsd / maxClusterUsd) * (colClusterW - 6)));
        const isDeltaPos = cl.askUsd >= cl.bidUsd;
        ctx.fillStyle = isDeltaPos ? 'rgba(16, 185, 129, 0.22)' : 'rgba(239, 68, 68, 0.22)';
        ctx.fillRect(colClusterX + colClusterW - clBarW - 4, y + 2, clBarW, ROW_HEIGHT - 4);

        ctx.fillStyle = isDeltaPos ? '#34d399' : '#f87171';
        ctx.font = fSz(9);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(fmtUsd(cl.totalUsd), colClusterX + colClusterW - 6, y + ROW_HEIGHT / 2);
      }

      // 2b-2. Trade Bubbles (Column 2: круги рыночных сделок, CScalp-стиль)
      const tb = aggregatedData.tickBubbles ? aggregatedData.tickBubbles.get(row.key) : null;
      if (tb && tb.usd > 0) {
        const cx = colTicksX + colTicksW / 2;
        const cy = y + ROW_HEIGHT / 2;
        const maxBubbleUsd = 100_000;
        const radius = Math.max(3.5, Math.min(colTicksW / 2 - 2, Math.round(3.5 + Math.sqrt(Math.min(tb.usd, maxBubbleUsd) / maxBubbleUsd) * 8)));
        ctx.fillStyle = tb.isBuy ? 'rgba(16, 185, 129, 0.85)' : 'rgba(239, 68, 68, 0.85)';
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();

        if (radius >= 6) {
          ctx.fillStyle = '#ffffff';
          ctx.font = fSz(7.5, true);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const bubbleTxt = tb.usd >= 1e6 ? `${(tb.usd / 1e6).toFixed(1)}M` : tb.usd >= 1e3 ? `${Math.round(tb.usd / 1e3)}K` : `${Math.round(tb.usd)}`;
          ctx.fillText(bubbleTxt, cx, cy);
        }
      }

      // 2c. Depth volume bar (Column 3)
      if (bookItem && rawVal > 0) {
        const barWidth = Math.min(colDepthW - 6, Math.max(2, Math.round((rawVal / maxDomVal) * (colDepthW - 6))));
        const totalBook = aggregatedData.totalBookUsd || 1;
        const depthPct = totalBook > 0 ? `${((usdVal / totalBook) * 100).toFixed(1)}%` : '';

        let normFill = side === 'bid' ? 'rgba(38, 166, 154, 0.22)' : 'rgba(239, 83, 80, 0.22)';
        let largeFill = side === 'bid' ? 'rgba(38, 166, 154, 0.55)' : 'rgba(239, 83, 80, 0.55)';
        let largeStroke = side === 'bid' ? '#26a69a' : '#ef5350';

        if (volumePalette === 'heat') {
          const intensity = Math.min(1.0, (rawVal / maxDomVal) * 1.4);
          if (intensity > 0.7) {
            normFill = 'rgba(249, 115, 22, 0.35)';
            largeFill = 'rgba(249, 115, 22, 0.65)';
            largeStroke = '#f97316';
          } else if (intensity > 0.35) {
            normFill = 'rgba(234, 179, 8, 0.28)';
            largeFill = 'rgba(234, 179, 8, 0.55)';
            largeStroke = '#eab308';
          } else {
            normFill = 'rgba(34, 197, 94, 0.22)';
            largeFill = 'rgba(34, 197, 94, 0.45)';
            largeStroke = '#22c55e';
          }
        } else if (volumePalette === 'monochrome') {
          normFill = side === 'bid' ? 'rgba(56, 189, 248, 0.20)' : 'rgba(148, 163, 184, 0.20)';
          largeFill = side === 'bid' ? 'rgba(56, 189, 248, 0.50)' : 'rgba(148, 163, 184, 0.50)';
          largeStroke = side === 'bid' ? '#38bdf8' : '#94a3b8';
        }

        if (isMegaWall) {
          // Mega wall highlight: яркий янтарный фон с рамкой (CScalp-референс 5: крупный сайз)
          ctx.fillStyle = 'rgba(245, 158, 11, 0.78)';
          ctx.fillRect(colDepthX + 2, y + 1.5, barWidth, ROW_HEIGHT - 3);
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 1.2;
          ctx.strokeRect(colDepthX + 2, y + 1.5, barWidth, ROW_HEIGHT - 3);
        } else if (isLargeWall) {
          ctx.fillStyle = largeFill;
          ctx.fillRect(colDepthX + 2, y + 2, barWidth, ROW_HEIGHT - 4);
          ctx.strokeStyle = largeStroke;
          ctx.lineWidth = 0.8;
          ctx.strokeRect(colDepthX + 2, y + 2, barWidth, ROW_HEIGHT - 4);
        } else {
          ctx.fillStyle = normFill;
          ctx.fillRect(colDepthX + 2, y + 2, barWidth, ROW_HEIGHT - 4);
        }

        // Feature 1: Lifetime badge text [<10s] / [>30s] / [>1m] + процент глубины
        if (isLargeWall || isMegaWall) {
          ctx.font = fSz(8);
          ctx.textBaseline = 'middle';
          let lifeBadge = lifeSec >= 60 ? '[>1m]' : lifeSec >= 30 ? '[>30s]' : lifeSec < 10 ? '[<10s]' : `[${lifeSec}s]`;
          ctx.fillStyle = isMegaWall ? '#fef08a' : lifeSec >= 30 ? '#f59e0b' : '#94a3b8';
          ctx.textAlign = 'left';
          ctx.fillText(`${lifeBadge} ${depthPct}`, colDepthX + 4, y + ROW_HEIGHT / 2);
        }

        // Volume text
        ctx.font = isMegaWall ? fSz(9.5, true) : fSz(9);
        ctx.fillStyle = isMegaWall ? '#ffffff' : '#cbd5e1';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const displayVol = volumeMode === 'USDT' ? fmtUsd(usdVal) : fmtQty(bookItem.qty);
        ctx.fillText(displayVol, colDepthX + colDepthW - 6, y + ROW_HEIGHT / 2);
      }

      // 2d. Price Ladder Column (Column 4)
      ctx.font = (isBestBid || isBestAsk || isCurrentPrice) ? fSz(10, true) : fSz(9.5);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';

      if (isCurrentPrice) {
        ctx.fillStyle = '#38bdf8';
      } else if (isBestBid) {
        ctx.fillStyle = '#26a69a';
      } else if (isBestAsk) {
        ctx.fillStyle = '#ef5350';
      } else if (side === 'bid') {
        ctx.fillStyle = '#10b981';
      } else {
        ctx.fillStyle = '#ef4444';
      }
      ctx.fillText(row.price.toFixed(priceDecimals), w - 6, y + ROW_HEIGHT / 2);

      // 2e. Feature 8: Zero-Latency DOM Projection (ENTRY, SL, TP1, TP2) + Strategy / Backtest badges
      let matchedBadge = false;

      if (entryP > 0 && Math.abs(row.price - entryP) < stepSize * 0.52) {
        matchedBadge = true;
        ctx.fillStyle = 'rgba(59, 130, 246, 0.22)';
        ctx.fillRect(0, y, w, ROW_HEIGHT);
        ctx.fillStyle = '#2563eb';
        ctx.fillRect(w - 56, y + 2, 52, ROW_HEIGHT - 4);
        ctx.fillStyle = '#ffffff';
        ctx.font = fSz(8.5, true);
        ctx.textAlign = 'center';
        ctx.fillText('ENTRY', w - 30, y + ROW_HEIGHT / 2);
      } else if (slP > 0 && Math.abs(row.price - slP) < stepSize * 0.52) {
        matchedBadge = true;
        ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
        ctx.fillRect(0, y, w, ROW_HEIGHT);
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(w - 50, y + 2, 46, ROW_HEIGHT - 4);
        ctx.fillStyle = '#ffffff';
        ctx.font = fSz(8.5, true);
        ctx.textAlign = 'center';
        ctx.fillText('SL', w - 27, y + ROW_HEIGHT / 2);
      } else if (tp1P > 0 && Math.abs(row.price - tp1P) < stepSize * 0.52) {
        matchedBadge = true;
        ctx.fillStyle = 'rgba(16, 185, 129, 0.22)';
        ctx.fillRect(0, y, w, ROW_HEIGHT);
        ctx.fillStyle = '#059669';
        ctx.fillRect(w - 50, y + 2, 46, ROW_HEIGHT - 4);
        ctx.fillStyle = '#ffffff';
        ctx.font = fSz(8.5, true);
        ctx.textAlign = 'center';
        ctx.fillText('TP1', w - 27, y + ROW_HEIGHT / 2);
      } else if (tp2P > 0 && Math.abs(row.price - tp2P) < stepSize * 0.52) {
        matchedBadge = true;
        ctx.fillStyle = 'rgba(4, 120, 87, 0.22)';
        ctx.fillRect(0, y, w, ROW_HEIGHT);
        ctx.fillStyle = '#047857';
        ctx.fillRect(w - 50, y + 2, 46, ROW_HEIGHT - 4);
        ctx.fillStyle = '#ffffff';
        ctx.font = fSz(8.5, true);
        ctx.textAlign = 'center';
        ctx.fillText('TP2', w - 27, y + ROW_HEIGHT / 2);
      }

      if (!matchedBadge) {
        const matchingStratLvl = strategyLevels?.find(
          (lvl) => Math.abs(lvl.price - row.price) < stepSize * 0.52
        );
        if (matchingStratLvl) {
          const role = matchingStratLvl.role || '';
          let badgeColor = '#2563eb';
          let badgeLabel = 'ENTRY';
          if (role === 'SL') {
            badgeColor = '#ef4444';
            badgeLabel = 'SL';
          } else if (role === 'TP1' || role === 'TP2') {
            badgeColor = '#10b981';
            badgeLabel = role;
          }

          ctx.fillStyle = badgeColor;
          ctx.fillRect(w - 48, y + 2, 44, ROW_HEIGHT - 4);
          ctx.fillStyle = '#ffffff';
          ctx.font = fSz(8.5, true);
          ctx.textAlign = 'center';
          ctx.fillText(badgeLabel, w - 26, y + ROW_HEIGHT / 2);
        }
      }

      // Column divider lines
      ctx.strokeStyle = '#151924';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(colTicksX, y);
      ctx.lineTo(colTicksX, y + ROW_HEIGHT);
      ctx.moveTo(colDepthX, y);
      ctx.lineTo(colDepthX, y + ROW_HEIGHT);
      ctx.moveTo(colPriceX, y);
      ctx.lineTo(colPriceX, y + ROW_HEIGHT);
      ctx.stroke();
    }

    ctx.restore();
  }, [
    visibleRows,
    aggregatedData,
    levelLifetimes,
    spoofRemovedAlerts,
    stepSize,
    priceDecimals,
    volumeMode,
    megaWallUsd,
    densityThresholdUsd,
    strategyLevels,
    width,
    height,
    fmtUsd,
    fmtQty
  ]);

  // Crosshair sync subscription
  useEffect(() => {
    return crosshairBus.subscribe(({ price }) => {
      syncPriceRef.current = price;
      requestAnimationFrame(() => renderFrame());
    });
  }, [renderFrame]);

  // Theme subscription
  useEffect(() => {
    return themeBridge.subscribe((tokens) => {
      tokensRef.current = tokens;
      renderFrame();
    });
  }, [renderFrame]);

  // RequestAnimationFrame loop
  useEffect(() => {
    let animId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(animId);
  }, [renderFrame]);

  // Zero-latency subscription to transient store: updates ladder at 60fps during drag with zero React tree re-renders
  useEffect(() => {
    const unsub = useTradeOverlayStore.subscribe(() => {
      requestAnimationFrame(renderFrame);
    });
    return () => unsub();
  }, [renderFrame]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="orderbook-canvas-ladder"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        display: 'block'
      }}
      className="select-none cursor-crosshair"
    />
  );
}
