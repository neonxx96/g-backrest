import React, { useEffect, useRef } from 'react';

/**
 * ChartCanvasOverlay
 * High-performance 2D Canvas Overlay rendering:
 * 1. Liq Heatmap Bands (Coinglass gradient style with intensity stops)
 * 2. Order Book Depth Limit Walls (TRDR style green/red horizontal bars with multiplier tags)
 * 3. Right-side Order Book Depth Profile (Horizontal histogram with extreme cluster highlights)
 */
export default function ChartCanvasOverlay({
  width,
  height,
  currentPrice,
  liqData,
  depthData,
  layers = { liqHeatmap: true, liqLevels: true, obDepth: true, obProfile: true },
  leverages = { '25x': true, '50x': true, '75x': true, '100x': true },
  minWallMultiplier = 2.5,
  wallLineThickness = 2,
  liqPalette = 'muted',
  layerOpacity = 1.0,
}) {
  const canvasRef = useRef(null);

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

    // Color definitions based on liqPalette
    const getLiqColor = (intensity, alphaMult = 1.0) => {
      const a = Math.min(Math.max(intensity * alphaMult * layerOpacity, 0.05), 0.95);
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
        // Muted (default)
        return `rgba(200, 210, 222, ${a * 0.75})`;
      }
    };

    // -------------------------------------------------------------
    // 1. LIQUIDATION HEATMAP BANDS & LEVELS (Ref 2 & 3)
    // -------------------------------------------------------------
    if (liqData) {
      const allLevels = [
        ...(liqData.shorts_above || []),
        ...(liqData.longs_below || []),
      ];

      allLevels.forEach((lvl) => {
        // Check if leverage filter is active
        if (!leverages[lvl.leverage]) return;

        const y = getYForPrice(lvl.price);
        if (y < 0 || y > height) return;

        // A) Heatmap Glow Band (Ref 2)
        if (layers.liqHeatmap) {
          const bandHeight = Math.max(12, lvl.intensity * 24);
          const grad = ctx.createLinearGradient(0, y - bandHeight / 2, 0, y + bandHeight / 2);
          grad.addColorStop(0, 'transparent');
          grad.addColorStop(0.5, getLiqColor(lvl.intensity, 0.35));
          grad.addColorStop(1, 'transparent');

          ctx.fillStyle = grad;
          ctx.fillRect(0, y - bandHeight / 2, width - 75, bandHeight);
        }

        // B) Sharp Level Line (Ref 3)
        if (layers.liqLevels) {
          ctx.beginPath();
          ctx.lineWidth = lvl.is_max ? 2.5 : 1.2;
          ctx.strokeStyle = getLiqColor(lvl.intensity, 1.0);
          ctx.setLineDash(lvl.is_max ? [] : [4, 4]);
          ctx.moveTo(0, y);
          ctx.lineTo(width - 70, y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Right edge badge
          const badgeText = `${lvl.amount_str} (${lvl.leverage})`;
          ctx.font = '10px "IBM Plex Mono", monospace';
          ctx.fillStyle = 'rgba(17, 19, 21, 0.85)';
          const textW = ctx.measureText(badgeText).width;
          ctx.fillRect(width - 72 - textW - 8, y - 8, textW + 6, 16);
          ctx.strokeStyle = getLiqColor(lvl.intensity, 0.8);
          ctx.lineWidth = 1;
          ctx.strokeRect(width - 72 - textW - 8, y - 8, textW + 6, 16);

          ctx.fillStyle = lvl.is_max ? '#ffd84a' : '#cdd3da';
          ctx.fillText(badgeText, width - 72 - textW - 5, y + 4);
        }
      });
    }

    // -------------------------------------------------------------
    // 2. ORDER BOOK DEPTH LIMIT WALLS (TRDR Spot walls)
    // -------------------------------------------------------------
    if (layers.obDepth && depthData && depthData.walls) {
      depthData.walls.forEach((wall) => {
        if (wall.wall_ratio < minWallMultiplier) return;

        const y = getYForPrice(wall.price);
        if (y < 0 || y > height) return;

        const isBid = wall.price < currentPrice;
        const baseColor = isBid ? 'rgba(70, 201, 154, ' : 'rgba(228, 120, 109, ';
        const alpha = Math.min(0.85, (wall.wall_ratio / 6) * layerOpacity);

        // Draw solid spot wall line
        ctx.beginPath();
        ctx.lineWidth = wallLineThickness;
        ctx.strokeStyle = `${baseColor}${alpha})`;
        ctx.moveTo(0, y);
        ctx.lineTo(width - 70, y);
        ctx.stroke();

        // Wall tag
        const tag = `SPOT WALL ${wall.size} (${wall.wall_ratio}x)`;
        ctx.font = '9px "IBM Plex Mono", monospace';
        ctx.fillStyle = `${baseColor}${Math.max(alpha, 0.3)})`;
        ctx.fillRect(40, y - 6, ctx.measureText(tag).width + 6, 13);
        ctx.fillStyle = '#0b0d10';
        ctx.fillText(tag, 43, y + 4);
      });
    }

    // -------------------------------------------------------------
    // 3. RIGHT-SIDE ORDER BOOK PROFILE (Histogram)
    // -------------------------------------------------------------
    if (layers.obProfile && depthData) {
      const profileWidth = 65;
      const profileX = width - profileWidth;

      // Background strip
      ctx.fillStyle = 'rgba(16, 20, 26, 0.5)';
      ctx.fillRect(profileX, 0, profileWidth, height);

      const maxBidSize = Math.max(...(depthData.bids?.map((b) => b.size) || [1]));
      const maxAskSize = Math.max(...(depthData.asks?.map((a) => a.size) || [1]));
      const maxSide = Math.max(maxBidSize, maxAskSize, 1);

      // Render Bids
      (depthData.bids || []).forEach((b) => {
        const y = getYForPrice(b.price);
        if (y >= 0 && y <= height) {
          const barW = (b.size / maxSide) * (profileWidth - 8);
          ctx.fillStyle = b.is_wall ? 'rgba(70, 201, 154, 0.75)' : 'rgba(70, 201, 154, 0.25)';
          ctx.fillRect(profileX, y - 1.5, barW, 3);
        }
      });

      // Render Asks
      (depthData.asks || []).forEach((a) => {
        const y = getYForPrice(a.price);
        if (y >= 0 && y <= height) {
          const barW = (a.size / maxSide) * (profileWidth - 8);
          ctx.fillStyle = a.is_wall ? 'rgba(228, 120, 109, 0.75)' : 'rgba(228, 120, 109, 0.25)';
          ctx.fillRect(profileX, y - 1.5, barW, 3);
        }
      });

      // Dividing line
      ctx.strokeStyle = 'var(--border)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(profileX, 0);
      ctx.lineTo(profileX, height);
      ctx.stroke();
    }
  }, [
    width,
    height,
    currentPrice,
    liqData,
    depthData,
    layers,
    leverages,
    minWallMultiplier,
    wallLineThickness,
    liqPalette,
    layerOpacity,
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
