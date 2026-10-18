import React, { useRef, useEffect, useCallback } from 'react';
import { useTradeOverlayStore } from '../stores/tradeOverlayStore';

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

const ROW_HEIGHT = 20;

export default function OrderBookCanvasLadder({
  visibleRows = [],
  aggregatedData = {},
  levelLifetimes,
  spoofRemovedAlerts,
  stepSize = 1,
  priceDecimals = 1,
  volumeMode = 'USDT',
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
  const canvasRef = useRef(null);
  const hoverIdxRef = useRef(-1);

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

    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Clear background
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, w, h);

    if (!visibleRows || visibleRows.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '11px monospace';
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
        ctx.fillStyle = 'rgba(38, 166, 154, 0.12)';
        ctx.fillRect(0, y, w, ROW_HEIGHT);
      } else if (isBestAsk) {
        ctx.fillStyle = 'rgba(239, 83, 80, 0.12)';
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
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(fmtUsd(cl.totalUsd), colClusterX + colClusterW - 6, y + ROW_HEIGHT / 2);
      }

      // 2c. Depth volume bar (Column 3)
      if (bookItem && rawVal > 0) {
        const barWidth = Math.min(colDepthW - 6, Math.max(2, Math.round((rawVal / maxDomVal) * (colDepthW - 6))));

        if (isMegaWall) {
          // Mega wall highlight: gold/amber glow with border
          ctx.fillStyle = 'rgba(245, 158, 11, 0.65)';
          ctx.fillRect(colDepthX + 2, y + 1.5, barWidth, ROW_HEIGHT - 3);
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 1;
          ctx.strokeRect(colDepthX + 2, y + 1.5, barWidth, ROW_HEIGHT - 3);
        } else if (isLargeWall) {
          ctx.fillStyle = side === 'bid' ? 'rgba(38, 166, 154, 0.45)' : 'rgba(239, 83, 80, 0.45)';
          ctx.fillRect(colDepthX + 2, y + 2, barWidth, ROW_HEIGHT - 4);
        } else {
          ctx.fillStyle = side === 'bid' ? 'rgba(38, 166, 154, 0.22)' : 'rgba(239, 83, 80, 0.22)';
          ctx.fillRect(colDepthX + 2, y + 2, barWidth, ROW_HEIGHT - 4);
        }

        // Feature 1: Lifetime badge text [<10s] / [>30s]
        if (isLargeWall) {
          ctx.font = '8.5px monospace';
          ctx.textBaseline = 'middle';
          let lifeBadge = lifeSec >= 30 ? '[>30s]' : lifeSec < 10 ? '[<10s]' : `[${lifeSec}s]`;
          ctx.fillStyle = isMegaWall ? '#fbbf24' : lifeSec >= 30 ? '#f59e0b' : '#94a3b8';
          ctx.textAlign = 'left';
          ctx.fillText(lifeBadge, colDepthX + 4, y + ROW_HEIGHT / 2);
        }

        // Volume text
        ctx.font = isMegaWall ? 'bold 9.5px monospace' : '9px monospace';
        ctx.fillStyle = isMegaWall ? '#ffffff' : '#cbd5e1';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const displayVol = volumeMode === 'USDT' ? fmtUsd(usdVal) : fmtQty(bookItem.qty);
        ctx.fillText(displayVol, colDepthX + colDepthW - 6, y + ROW_HEIGHT / 2);
      }

      // 2d. Price Ladder Column (Column 4)
      ctx.font = (isBestBid || isBestAsk || isCurrentPrice) ? 'bold 10px monospace' : '9.5px monospace';
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
        ctx.font = 'bold 8.5px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('ENTRY', w - 30, y + ROW_HEIGHT / 2);
      } else if (slP > 0 && Math.abs(row.price - slP) < stepSize * 0.52) {
        matchedBadge = true;
        ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
        ctx.fillRect(0, y, w, ROW_HEIGHT);
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(w - 50, y + 2, 46, ROW_HEIGHT - 4);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 8.5px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('SL', w - 27, y + ROW_HEIGHT / 2);
      } else if (tp1P > 0 && Math.abs(row.price - tp1P) < stepSize * 0.52) {
        matchedBadge = true;
        ctx.fillStyle = 'rgba(16, 185, 129, 0.22)';
        ctx.fillRect(0, y, w, ROW_HEIGHT);
        ctx.fillStyle = '#059669';
        ctx.fillRect(w - 50, y + 2, 46, ROW_HEIGHT - 4);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 8.5px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('TP1', w - 27, y + ROW_HEIGHT / 2);
      } else if (tp2P > 0 && Math.abs(row.price - tp2P) < stepSize * 0.52) {
        matchedBadge = true;
        ctx.fillStyle = 'rgba(4, 120, 87, 0.22)';
        ctx.fillRect(0, y, w, ROW_HEIGHT);
        ctx.fillStyle = '#047857';
        ctx.fillRect(w - 50, y + 2, 46, ROW_HEIGHT - 4);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 8.5px monospace';
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
          ctx.font = 'bold 8.5px monospace';
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
