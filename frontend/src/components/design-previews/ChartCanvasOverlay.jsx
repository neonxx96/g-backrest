import React, { useEffect, useRef, useMemo } from 'react';
import themeBridge from '../../theme/themeBridge';
import { layoutLabels, formatLabelAmount } from '../chart/labelLayout.js';

/**
 * ChartCanvasOverlay
 * High-performance 2D Canvas Overlay rendering:
 * 1. Liq Heatmap Bands & Levels (Coinglass gradient style with intensity stops)
 * 2. Order Book Depth Limit Walls (TRDR style subtle 1px horizontal bars with coin units)
 * 3. Right-side Order Book Depth Profile (Horizontal histogram)
 * 
 * V3 Polish Guidelines:
 * - 1px density lines, transparency proportional to volume/intensity.
 * - Top-N (default 6) labels by size, with Y-spread deduping (<14px merged).
 * - Format: $107.5M, proper coin units for spot walls (e.g. 0.45 BTC).
 * - Bounds checking: never overlap top toolbar (y < 28) or price scale (x > width - 70).
 */
export default function ChartCanvasOverlay({
  width,
  height,
  currentPrice,
  symbol = 'BTCUSDT',
  liqData,
  depthData,
  layers = { liqHeatmap: true, liqLevels: true, obDepth: true, obProfile: true },
  leverages = { '25x': true, '50x': true, '75x': true, '100x': true },
  minWallMultiplier = 2.5,
  wallLineThickness = 1,
  liqPalette = 'muted',
  layerOpacity = 1.0,
  maxLabels = 6,
  showAllLabels = false,
}) {
  const canvasRef = useRef(null);

  const baseAsset = useMemo(() => {
    return symbol ? symbol.replace(/USDT$|USDC$|BUSD$|USD$/, '') : 'BTC';
  }, [symbol]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width || !height || !currentPrice) return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    // Compute dynamic price range (+/- 8% around current price for rendering)
    const priceSpanPct = 0.08;
    const minPrice = currentPrice * (1 - priceSpanPct);
    const maxPrice = currentPrice * (1 + priceSpanPct);
    const priceRange = maxPrice - minPrice;

    const getYForPrice = (p) => {
      const norm = (p - minPrice) / priceRange;
      return height - norm * height;
    };

    const tokens = themeBridge.getTokens();
    const densityWallColor = tokens?.densityWall || '#38bdf8';

    // Format USD amount cleanly: $107.54M -> $107.5M, $450.2K -> $450K
    const formatAmount = (valStr, rawVal) => {
      if (rawVal != null && Number.isFinite(Number(rawVal))) {
        const num = Number(rawVal);
        if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`;
        if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
        if (num >= 1e3) return `$${Math.round(num / 1e3)}k`;
        return `$${Math.round(num)}`;
      }
      if (typeof valStr === 'string') {
        return valStr.replace(/(\.\d)\d+M/, '$1M').replace(/(\.\d)\d+k/i, '$1k');
      }
      return '$0';
    };

    // Color definitions based on liqPalette
    const getLiqColor = (intensity, alphaMult = 1.0) => {
      const a = Math.min(Math.max(intensity * alphaMult * layerOpacity, 0.1), 0.9);
      if (liqPalette === 'vivid') {
        if (intensity > 0.8) return `rgba(255, 216, 74, ${a})`;
        if (intensity > 0.6) return `rgba(240, 138, 60, ${a})`;
        if (intensity > 0.4) return `rgba(214, 71, 154, ${a})`;
        return `rgba(123, 42, 156, ${a * 0.7})`;
      } else if (liqPalette === 'acid') {
        if (intensity > 0.8) return `rgba(198, 255, 61, ${a})`;
        if (intensity > 0.5) return `rgba(255, 63, 180, ${a})`;
        return `rgba(139, 47, 201, ${a * 0.7})`;
      } else {
        // Muted / Density theme token style (soft cyan/slate)
        return `rgba(56, 189, 248, ${a})`;
      }
    };

    // -------------------------------------------------------------
    // 1. DATA PREPARATION: Liquidation Levels & Heatmap (Outside Draw Loop)
    // -------------------------------------------------------------
    if (liqData) {
      const rawLevels = [
        ...(liqData.shorts_above || []),
        ...(liqData.longs_below || []),
      ];

      // Filter by leverage and visible Y
      const validLevels = [];
      rawLevels.forEach((lvl) => {
        if (!leverages[lvl.leverage]) return;
        const y = getYForPrice(lvl.price);
        // Avoid toolbar area at top (y < 28) and bottom margin (height - 18)
        if (y < 28 || y > height - 18) return;
        validLevels.push({ ...lvl, y });
      });

      // Group levels with close Y to avoid overlapping text using shared labelLayout module
      const rawCandidates = validLevels.map((lvl) => ({
        id: `liq-${lvl.price}`,
        price: lvl.price,
        y: lvl.y,
        type: 'liq',
        valueUsd: lvl.usd_amount || 0,
        amount_str: lvl.amount_str,
        intensity: lvl.intensity,
        is_max: lvl.is_max,
        rawLevel: lvl,
      }));

      const laidOut = layoutLabels(rawCandidates, {
        height,
        topMargin: 28,
        bottomMargin: 24,
        maxLabels,
        showAll: showAllLabels,
        minGap: 16,
      });

      const labelMap = new Map();
      laidOut.forEach((l) => {
        if (!l.hidden) {
          labelMap.set(l.price, l.y);
        }
      });

      // Render Heatmap glow & 1px lines
      validLevels.forEach((lvl) => {
        const y = lvl.y;

        // A) Heatmap Glow Band
        if (layers.liqHeatmap) {
          const bandHeight = Math.max(8, lvl.intensity * 20);
          const grad = ctx.createLinearGradient(0, y - bandHeight / 2, 0, y + bandHeight / 2);
          grad.addColorStop(0, 'transparent');
          grad.addColorStop(0.5, getLiqColor(lvl.intensity, 0.25));
          grad.addColorStop(1, 'transparent');

          ctx.fillStyle = grad;
          ctx.fillRect(0, y - bandHeight / 2, width - 75, bandHeight);
        }

        // B) Sharp Level Line (1px, proportional alpha)
        if (layers.liqLevels) {
          const alpha = Math.min(0.85, Math.max(0.18, lvl.intensity * layerOpacity));
          ctx.beginPath();
          ctx.lineWidth = 1;
          ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
          ctx.setLineDash(lvl.is_max ? [] : [3, 3]);
          ctx.moveTo(0, y);
          ctx.lineTo(width - 72, y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Right edge badge (Top-N only, no collision via labelLayout)
          if (labelMap.has(lvl.price)) {
            const adjustedY = labelMap.get(lvl.price);
            const formattedAmt = formatLabelAmount(lvl.usd_amount || lvl.amount_str);
            const badgeText = `${formattedAmt}`;
            ctx.font = '10px "IBM Plex Mono", monospace';
            const textW = ctx.measureText(badgeText).width;
            const badgeX = width - 74 - textW - 8;
            const badgeY = adjustedY - 7;

            // Dotted connector if label was shifted
            if (Math.abs(adjustedY - y) > 2) {
              ctx.beginPath();
              ctx.setLineDash([2, 2]);
              ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
              ctx.moveTo(width - 76, y);
              ctx.lineTo(badgeX + textW + 6, adjustedY);
              ctx.stroke();
              ctx.setLineDash([]);
            }

            // Badge Background (bg-popover/80 border style)
            ctx.fillStyle = 'rgba(11, 14, 20, 0.88)';
            ctx.fillRect(badgeX, badgeY, textW + 6, 14);
            ctx.strokeStyle = `rgba(56, 189, 248, ${Math.max(alpha, 0.4)})`;
            ctx.lineWidth = 1;
            ctx.strokeRect(badgeX, badgeY, textW + 6, 14);

            // Badge Text
            ctx.fillStyle = lvl.is_max ? '#38bdf8' : '#94a3b8';
            ctx.fillText(badgeText, badgeX + 3, adjustedY + 4);
          }
        }
      });
    }

    // -------------------------------------------------------------
    // 2. ORDER BOOK DEPTH LIMIT WALLS (TRDR Spot walls)
    // -------------------------------------------------------------
    if (layers.obDepth && depthData && depthData.walls) {
      const validWalls = [];
      depthData.walls.forEach((wall) => {
        if (wall.wall_ratio < minWallMultiplier) return;
        const y = getYForPrice(wall.price);
        if (y < 28 || y > height - 18) return;
        validWalls.push({ ...wall, y });
      });

      // Sort by ratio to prioritize largest walls for tags
      validWalls.sort((a, b) => b.wall_ratio - a.wall_ratio);
      const spotOccupiedY = [];
      const spotAllowedSet = new Set();

      validWalls.forEach((w) => {
        const isNear = spotOccupiedY.some((oy) => Math.abs(oy - w.y) < 16);
        if (!isNear && spotOccupiedY.length < maxLabels) {
          spotOccupiedY.push(w.y);
          spotAllowedSet.add(w.price);
        }
      });

      validWalls.forEach((wall) => {
        const y = wall.y;
        const isBid = wall.price < currentPrice;
        const baseColor = isBid ? 'rgba(34, 197, 94, ' : 'rgba(239, 68, 68, ';
        const alpha = Math.min(0.85, Math.max(0.2, (wall.wall_ratio / 6) * layerOpacity));

        // Draw 1px spot wall line
        ctx.beginPath();
        ctx.lineWidth = 1;
        ctx.strokeStyle = `${baseColor}${alpha})`;
        ctx.moveTo(0, y);
        ctx.lineTo(width - 72, y);
        ctx.stroke();

        // Wall Tag (With explicit coin units e.g. "0.45 BTC")
        if (showAllLabels || spotAllowedSet.has(wall.price)) {
          const formattedSize = Number(wall.size) < 1 
            ? Number(wall.size).toFixed(3) 
            : Number(wall.size).toFixed(1);
          const tag = `СПОТ ${formattedSize} ${baseAsset} (${wall.wall_ratio.toFixed(1)}x)`;
          ctx.font = '9px "IBM Plex Mono", monospace';
          const tagW = ctx.measureText(tag).width;

          ctx.fillStyle = 'rgba(11, 14, 20, 0.88)';
          ctx.fillRect(36, y - 6, tagW + 6, 13);
          ctx.strokeStyle = `${baseColor}${Math.max(alpha, 0.4)})`;
          ctx.lineWidth = 1;
          ctx.strokeRect(36, y - 6, tagW + 6, 13);

          ctx.fillStyle = isBid ? '#4ade80' : '#f87171';
          ctx.fillText(tag, 39, y + 4);
        }
      });
    }

    // -------------------------------------------------------------
    // 3. RIGHT-SIDE ORDER BOOK PROFILE (Histogram)
    // -------------------------------------------------------------
    if (layers.obProfile && depthData) {
      const profileWidth = 60;
      const profileX = width - profileWidth - 72;

      // Background strip
      ctx.fillStyle = 'rgba(11, 14, 20, 0.45)';
      ctx.fillRect(profileX, 28, profileWidth, height - 46);

      const maxBidSize = Math.max(...(depthData.bids?.map((b) => b.size) || [1]));
      const maxAskSize = Math.max(...(depthData.asks?.map((a) => a.size) || [1]));
      const maxSide = Math.max(maxBidSize, maxAskSize, 1);

      // Render Bids
      (depthData.bids || []).forEach((b) => {
        const y = getYForPrice(b.price);
        if (y >= 28 && y <= height - 18) {
          const barW = (b.size / maxSide) * (profileWidth - 6);
          ctx.fillStyle = b.is_wall ? 'rgba(34, 197, 94, 0.7)' : 'rgba(34, 197, 94, 0.2)';
          ctx.fillRect(profileX, y - 1, barW, 2);
        }
      });

      // Render Asks
      (depthData.asks || []).forEach((a) => {
        const y = getYForPrice(a.price);
        if (y >= 28 && y <= height - 18) {
          const barW = (a.size / maxSide) * (profileWidth - 6);
          ctx.fillStyle = a.is_wall ? 'rgba(239, 68, 68, 0.7)' : 'rgba(239, 68, 68, 0.2)';
          ctx.fillRect(profileX, y - 1, barW, 2);
        }
      });

      // Dividing line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(profileX, 28);
      ctx.lineTo(profileX, height - 18);
      ctx.stroke();
    }
  }, [
    width,
    height,
    currentPrice,
    symbol,
    baseAsset,
    liqData,
    depthData,
    layers,
    leverages,
    minWallMultiplier,
    wallLineThickness,
    liqPalette,
    layerOpacity,
    maxLabels,
    showAllLabels,
  ]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="absolute inset-0 pointer-events-none z-10"
      style={{ width: `${width}px`, height: `${height}px` }}
    />
  );
}
