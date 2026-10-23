// Регистрация кастомных оверлеев и индикаторов KLineCharts v9.
// Извлечено ДОСЛОВНО из Chart.jsx (слайс 6.4k, п.1 MODULARIZATION_PLAN) —
// модульный преамбул: 12 registerOverlay (rect/measure/btSignal/whaleTradeMarker/
// backtestTradeLine/volatilityCone/liqMarker/footprintCandle/tpoProfile/
// strategyLevelZone/positionSetupBox/orderbookWall) + 4 registerIndicator
// (CVD/DeltaBars/ATR/SuperTrend). Подключается из Chart.jsx side-effect импортом.
import { registerOverlay, registerIndicator } from 'klinecharts';
import { useTradeOverlayStore, calculatePositionMetrics } from '../../stores/tradeOverlayStore';

// 1. Register custom 'rect' (Zone/Imbalance box) overlay
try {
  registerOverlay({
    name: 'rect',
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, overlay, yAxis }) => {
      if (!coordinates || coordinates.length < 2) return [];
      let c0 = coordinates[0];
      let c1 = coordinates[1];
      if (!c0 || !c1) return [];

      let x0 = c0.x;
      let x1 = c1.x;
      let y0 = c0.y;
      let y1 = c1.y;

      if ((!Number.isFinite(y0) || !Number.isFinite(y1)) && yAxis && overlay?.points?.length >= 2) {
        y0 = yAxis.convertToPixel(Number(overlay.points[0].value));
        y1 = yAxis.convertToPixel(Number(overlay.points[1].value));
      }
      if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(y0) || !Number.isFinite(y1)) return [];

      const x = Math.min(x0, x1);
      const y = Math.min(y0, y1);
      const width = Math.abs(x0 - x1);
      const height = Math.abs(y0 - y1);
      return [
        {
          type: 'polygon',
          attrs: {
            coordinates: [
              { x, y },
              { x: x + width, y },
              { x: x + width, y: y + height },
              { x, y: y + height }
            ]
          },
          styles: {
            style: 'stroke_fill',
            color: 'rgba(38, 166, 154, 0.12)',
            borderColor: '#26a69a',
            borderSize: 1
          }
        }
      ];
    }
  });
} catch (_) {}

// 2. Register custom 'measure' (Ruler: Price Diff & % Change) overlay
try {
  registerOverlay({
    name: 'measure',
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, overlay, yAxis }) => {
      if (!coordinates || coordinates.length < 2 || !overlay.points || overlay.points.length < 2) return [];
      const p1 = overlay.points[0];
      const p2 = overlay.points[1];
      let c0 = coordinates[0];
      let c1 = coordinates[1];
      if (!c0 || !c1) return [];

      let x0 = c0.x;
      let x1 = c1.x;
      let y0 = c0.y;
      let y1 = c1.y;

      if ((!Number.isFinite(y0) || !Number.isFinite(y1)) && yAxis) {
        y0 = yAxis.convertToPixel(Number(p1.value));
        y1 = yAxis.convertToPixel(Number(p2.value));
      }
      if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(y0) || !Number.isFinite(y1)) return [];

      const x = Math.min(x0, x1);
      const y = Math.min(y0, y1);
      const width = Math.abs(x0 - x1);
      const height = Math.abs(y0 - y1);

      const v1 = Number(p1.value) || 0;
      const v2 = Number(p2.value) || 0;
      const priceDiff = v2 - v1;
      const pctDiff = v1 !== 0 ? ((priceDiff / v1) * 100) : 0;
      const isUp = priceDiff >= 0;
      const fillColor = isUp ? 'rgba(38, 166, 154, 0.16)' : 'rgba(239, 83, 80, 0.16)';
      const strokeColor = isUp ? '#26a69a' : '#ef5350';
      const sign = isUp ? '+' : '';
      const labelText = `${sign}${priceDiff.toFixed(2)} (${sign}${pctDiff.toFixed(2)}%)`;

      return [
        {
          type: 'polygon',
          attrs: {
            coordinates: [
              { x, y },
              { x: x + width, y },
              { x: x + width, y: y + height },
              { x, y: y + height }
            ]
          },
          styles: {
            style: 'stroke_fill',
            color: fillColor,
            borderColor: strokeColor,
            borderSize: 1,
            borderStyle: 'dashed'
          }
        },
        {
          type: 'text',
          attrs: {
            x: x1,
            y: y1 - (isUp ? 10 : -16),
            text: labelText,
            align: 'center'
          },
          styles: {
            color: '#ffffff',
            backgroundColor: strokeColor,
            padding: 4,
            borderRadius: 2
          }
        }
      ];
    }
  });
} catch (_) {}

// 2b. Register custom 'btSignal' (Backtest BUY/SELL markers)
try {
  registerOverlay({
    name: 'btSignal',
    totalStep: 2,
    lock: true,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, yAxis, overlay }) => {
      if (!coordinates || coordinates.length === 0) return [];
      let { x, y } = coordinates[0];
      if (!Number.isFinite(x)) return [];

      const ext = overlay.extendData || {};
      const price = Number(ext.price ?? overlay.points?.[0]?.value ?? 0);
      if (yAxis && typeof yAxis.convertToPixel === 'function' && price > 0) {
        const calcY = yAxis.convertToPixel(price);
        if (Number.isFinite(calcY)) {
          y = calcY;
        }
      }
      if (!Number.isFinite(y)) return [];

      const isBuy = ext.type === 'BUY';
      const color = isBuy ? '#26a69a' : '#ef5350';
      const gap = 5;
      const h = 11;
      const w = 7;
      const tri = isBuy
        ? [{ x, y: y + gap }, { x: x - w, y: y + gap + h }, { x: x + w, y: y + gap + h }]
        : [{ x, y: y - gap }, { x: x - w, y: y - gap - h }, { x: x + w, y: y - gap - h }];
      const textY = isBuy ? y + gap + h + 4 : y - gap - h - 4;
      return [
        {
          type: 'polygon',
          attrs: { coordinates: tri },
          styles: { style: 'stroke_fill', color, borderColor: '#ffffff', borderSize: 0.5 },
          ignoreEvent: true
        },
        {
          type: 'text',
          attrs: {
            x,
            y: textY,
            text: Number(ext.price || price).toFixed(price >= 100 ? 1 : 4),
            align: 'center',
            baseline: isBuy ? 'top' : 'bottom'
          },
          styles: { color, size: 9, backgroundColor: 'transparent' },
          ignoreEvent: true
        }
      ];
    }
  });
} catch (_) {}

// 2b-2. Register custom 'whaleTradeMarker' (Floating B/S Whale Orders > $500k on Chart)
try {
  registerOverlay({
    name: 'whaleTradeMarker',
    totalStep: 2,
    lock: true,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, yAxis, overlay }) => {
      if (!coordinates || coordinates.length === 0) return [];
      let { x, y } = coordinates[0];
      if (!Number.isFinite(x)) return [];

      const ext = overlay.extendData || {};
      const price = Number(ext.price ?? overlay.points?.[0]?.value ?? 0);
      if (yAxis && typeof yAxis.convertToPixel === 'function' && price > 0) {
        const calcY = yAxis.convertToPixel(price);
        if (Number.isFinite(calcY)) {
          y = calcY;
        }
      }
      if (!Number.isFinite(y)) return [];

      const isBuy = String(ext.side || ext.type || 'BUY').toUpperCase() === 'BUY';
      const color = isBuy ? '#10b981' : '#ef4444';
      const sizeText = ext.sizeText || (ext.usd ? `$${Math.round(ext.usd / 1e3)}k` : '');
      const badgeText = isBuy ? `[B] ${sizeText}` : `[S] ${sizeText}`;
      const badgeW = 54;
      const badgeH = 15;
      const badgeY = isBuy ? y - badgeH - 5 : y + 5;

      return [
        {
          type: 'circle',
          attrs: { x, y, r: 3 },
          styles: { style: 'fill', color },
          ignoreEvent: true
        },
        {
          type: 'rect',
          attrs: {
            x: x - badgeW / 2,
            y: badgeY,
            width: badgeW,
            height: badgeH
          },
          styles: {
            style: 'stroke_fill',
            color: isBuy ? 'rgba(16, 185, 129, 0.95)' : 'rgba(239, 68, 68, 0.95)',
            borderColor: '#ffffff',
            borderSize: 0.8,
            borderRadius: 3
          },
          ignoreEvent: true
        },
        {
          type: 'text',
          attrs: {
            x,
            y: badgeY + badgeH / 2,
            text: badgeText,
            align: 'center',
            baseline: 'middle'
          },
          styles: {
            color: '#ffffff',
            size: 8.5,
            weight: 'bold',
            backgroundColor: 'transparent'
          },
          ignoreEvent: true
        }
      ];
    }
  });
} catch (_) {}

// 2c. Register custom 'backtestTradeLine' (Realistic Trade with Entry, Exit, dashed holding line & PnL badge)
try {
  registerOverlay({
    name: 'backtestTradeLine',
    totalStep: 3,
    lock: true,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, yAxis, overlay }) => {
      if (!coordinates || coordinates.length < 2) return [];
      let { x: x0, y: y0 } = coordinates[0];
      let { x: x1, y: y1 } = coordinates[1];
      if (!Number.isFinite(x0) || !Number.isFinite(x1)) return [];

      const ext = overlay.extendData || {};
      const entryP = Number(ext.entry_price ?? overlay.points?.[0]?.value ?? 0);
      const exitP = Number(ext.exit_price ?? overlay.points?.[1]?.value ?? 0);

      if (yAxis && typeof yAxis.convertToPixel === 'function') {
        if (entryP > 0) {
          const calcY0 = yAxis.convertToPixel(entryP);
          if (Number.isFinite(calcY0)) y0 = calcY0;
        }
        if (exitP > 0) {
          const calcY1 = yAxis.convertToPixel(exitP);
          if (Number.isFinite(calcY1)) y1 = calcY1;
        }
      }
      if (!Number.isFinite(y0) || !Number.isFinite(y1)) return [];

      const isLong = ext.direction === 'LONG' || ext.type === 'BUY';
      const isPaper = ext.source === 'paper';
      const pnlPct = Number(ext.pnl_pct ?? ext.pnl_percent ?? 0);
      const isProfit = pnlPct >= 0;
      const pnlColor = isProfit ? (isPaper ? '#38bdf8' : '#10b981') : (isPaper ? '#a78bfa' : '#ef4444');
      const pnlBg = isProfit ? (isPaper ? 'rgba(56, 189, 248, 0.14)' : 'rgba(16, 185, 129, 0.20)') : (isPaper ? 'rgba(167, 139, 250, 0.14)' : 'rgba(239, 68, 68, 0.20)');
      const pnlBorder = isProfit ? (isPaper ? 'rgba(56, 189, 248, 0.65)' : 'rgba(16, 185, 129, 0.80)') : (isPaper ? 'rgba(167, 139, 250, 0.65)' : 'rgba(239, 68, 68, 0.80)');
      const entryColor = isPaper ? (isLong ? '#38bdf8' : '#a78bfa') : (isLong ? '#10b981' : '#ef4444');

      const figures = [];

      // 1. Minimalist sharp arrow pointing to the candle entry
      const arrowW = 4.5;
      const arrowH = 9;
      const entryArrow = isLong
        ? [
            { x: x0, y: y0 + 3 },
            { x: x0 - arrowW, y: y0 + 3 + arrowH },
            { x: x0, y: y0 + 3 + arrowH - 2.5 },
            { x: x0 + arrowW, y: y0 + 3 + arrowH }
          ]
        : [
            { x: x0, y: y0 - 3 },
            { x: x0 - arrowW, y: y0 - 3 - arrowH },
            { x: x0, y: y0 - 3 - arrowH + 2.5 },
            { x: x0 + arrowW, y: y0 - 3 - arrowH }
          ];

      figures.push({
        type: 'polygon',
        attrs: { coordinates: entryArrow },
        styles: { style: 'stroke_fill', color: entryColor, borderColor: entryColor, borderSize: 1 },
        ignoreEvent: true
      });

      // 2. Subtle dashed connection line between Entry and Exit
      figures.push({
        type: 'line',
        attrs: { coordinates: [{ x: x0, y: y0 }, { x: x1, y: y1 }] },
        styles: {
          style: 'dashed',
          dashedValue: [3, 3],
          color: isProfit ? 'rgba(16, 185, 129, 0.65)' : 'rgba(239, 68, 68, 0.65)',
          size: 1.2
        },
        ignoreEvent: true
      });

      // 3. Minimalist Exit dot at exit price
      figures.push({
        type: 'circle',
        attrs: { x: x1, y: y1, r: 3 },
        styles: {
          style: 'stroke_fill',
          color: pnlColor,
          borderColor: '#0b0e11',
          borderSize: 1
        },
        ignoreEvent: true
      });

      // 4. Minimalist Pill-shaped PnL Badge (80% opacity, tabular font)
      const sign = pnlPct >= 0 ? '+' : '';
      const pnlText = ` ${sign}${pnlPct.toFixed(1)}% `;

      figures.push({
        type: 'text',
        attrs: {
          x: x1 + 6,
          y: y1,
          text: pnlText,
          align: 'left',
          baseline: 'middle'
        },
        styles: {
          color: isProfit ? '#34d399' : '#f87171',
          backgroundColor: pnlBg,
          borderColor: pnlBorder,
          borderSize: 0.9,
          size: 9,
          family: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          weight: 'bold',
          padding: 2.5,
          borderRadius: 6
        },
        ignoreEvent: false
      });

      return figures;
    }
  });
} catch (_) {}

// 2d. Register custom 'volatilityCone' (Expected Move Fan ±1σ / ±2σ on forward bars)
try {
  registerOverlay({
    name: 'volatilityCone',
    totalStep: 2,
    lock: true,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, yAxis, overlay }) => {
      if (!coordinates || coordinates.length === 0) return [];
      const x0 = coordinates[0]?.x;
      const y0 = coordinates[0]?.y;
      if (!Number.isFinite(x0) || !Number.isFinite(y0)) return [];

      const x1 = coordinates[1]?.x;
      const cone = overlay.extendData || {};
      const fanPoints = cone.fan_points || [];
      if (!fanPoints.length || !yAxis || typeof yAxis.convertToPixel !== 'function') return [];

      const totalSteps = fanPoints.length;
      const stepX = (Number.isFinite(x1) && x1 > x0) ? (x1 - x0) / totalSteps : 16;

      const upper2Coords = [{ x: x0, y: y0 }];
      const lower2Coords = [{ x: x0, y: y0 }];
      const upper1Coords = [{ x: x0, y: y0 }];
      const lower1Coords = [{ x: x0, y: y0 }];
      const midCoords = [{ x: x0, y: y0 }];

      const isBull = cone.direction === 'BULLISH' || cone.trend === 'BULLISH' || (Number(cone.expected_drift_pct) > 0.05);
      const isBear = cone.direction === 'BEARISH' || cone.trend === 'BEARISH' || (Number(cone.expected_drift_pct) < -0.05);
      const color2s = isBull ? 'rgba(34, 197, 94, 0.08)' : isBear ? 'rgba(239, 68, 68, 0.08)' : 'rgba(56, 189, 248, 0.08)';
      const border2s = isBull ? 'rgba(34, 197, 94, 0.4)' : isBear ? 'rgba(239, 68, 68, 0.4)' : 'rgba(56, 189, 248, 0.4)';
      const color1s = isBull ? 'rgba(34, 197, 94, 0.18)' : isBear ? 'rgba(239, 68, 68, 0.18)' : 'rgba(56, 189, 248, 0.18)';
      const border1s = isBull ? 'rgba(34, 197, 94, 0.75)' : isBear ? 'rgba(239, 68, 68, 0.75)' : 'rgba(56, 189, 248, 0.75)';
      const midLineColor = isBull ? '#22c55e' : isBear ? '#ef4444' : '#38bdf8';

      fanPoints.forEach((pt, idx) => {
        const x = x0 + stepX * (idx + 1);
        const yU2 = yAxis.convertToPixel(Number(pt.upper_2s ?? pt.upper_2sigma));
        const yL2 = yAxis.convertToPixel(Number(pt.lower_2s ?? pt.lower_2sigma));
        const yU1 = yAxis.convertToPixel(Number(pt.upper_1s ?? pt.upper_1sigma));
        const yL1 = yAxis.convertToPixel(Number(pt.lower_1s ?? pt.lower_1sigma));
        const yMid = yAxis.convertToPixel(Number(pt.price_mid ?? pt.base_price ?? ((Number(pt.upper_1s ?? pt.upper_1sigma) + Number(pt.lower_1s ?? pt.lower_1sigma)) / 2)));

        if (Number.isFinite(yU2) && Number.isFinite(yL2)) {
          upper2Coords.push({ x, y: yU2 });
          lower2Coords.push({ x, y: yL2 });
        }
        if (Number.isFinite(yU1) && Number.isFinite(yL1)) {
          upper1Coords.push({ x, y: yU1 });
          lower1Coords.push({ x, y: yL1 });
        }
        if (Number.isFinite(yMid)) {
          midCoords.push({ x, y: yMid });
        }
      });

      const poly2Coords = [...upper2Coords, ...lower2Coords.slice().reverse()];
      const poly1Coords = [...upper1Coords, ...lower1Coords.slice().reverse()];

      const lastPt = fanPoints[fanPoints.length - 1];
      const lastX = x0 + stepX * totalSteps;
      const lastYMid = midCoords[midCoords.length - 1]?.y ?? y0;
      const lastYU1 = upper1Coords[upper1Coords.length - 1]?.y ?? y0;
      const lastYU2 = upper2Coords[upper2Coords.length - 1]?.y ?? y0;
      const lastYL1 = lower1Coords[lower1Coords.length - 1]?.y ?? y0;
      const lastYL2 = lower2Coords[lower2Coords.length - 1]?.y ?? y0;

      const figures = [
        // ±2σ shaded fan (95.4% probability)
        {
          type: 'polygon',
          attrs: { coordinates: poly2Coords },
          styles: {
            style: 'stroke_fill',
            color: color2s,
            borderColor: border2s,
            borderSize: 1,
            borderStyle: 'dashed'
          },
          ignoreEvent: true
        },
        // ±1σ shaded fan (68.2% probability)
        {
          type: 'polygon',
          attrs: { coordinates: poly1Coords },
          styles: {
            style: 'stroke_fill',
            color: color1s,
            borderColor: border1s,
            borderSize: 1.2
          },
          ignoreEvent: true
        },
        // Midline trajectory
        {
          type: 'line',
          attrs: { coordinates: midCoords },
          styles: {
            style: 'dashed',
            dashedValue: [4, 4],
            color: midLineColor,
            size: 1.5
          },
          ignoreEvent: true
        },
        // Upper +2σ Badge
        {
          type: 'text',
          attrs: {
            x: lastX + 6,
            y: lastYU2,
            text: ` +2σ ($${Number(lastPt.upper_2s).toFixed(1)}) · 95.4% `,
            align: 'left',
            baseline: 'middle'
          },
          styles: {
            color: '#38bdf8',
            backgroundColor: 'rgba(15, 23, 42, 0.88)',
            borderColor: 'rgba(56, 189, 248, 0.5)',
            borderSize: 0.8,
            size: 9,
            padding: 2,
            borderRadius: 2
          },
          ignoreEvent: true
        },
        // Upper +1σ Badge
        {
          type: 'text',
          attrs: {
            x: lastX + 6,
            y: lastYU1,
            text: ` +1σ ($${Number(lastPt.upper_1s).toFixed(1)}) · 68.2% `,
            align: 'left',
            baseline: 'middle'
          },
          styles: {
            color: '#7dd3fc',
            backgroundColor: 'rgba(15, 23, 42, 0.88)',
            borderColor: 'rgba(56, 189, 248, 0.7)',
            borderSize: 0.8,
            size: 9,
            padding: 2,
            borderRadius: 2
          },
          ignoreEvent: true
        },
        // Midline summary badge with Expected Move & EV
        {
          type: 'text',
          attrs: {
            x: lastX + 6,
            y: lastYMid,
            text: ` 📐 Exp. Move: ±$${Math.abs(Number(lastPt.upper_1s) - Number(lastPt.price_mid)).toFixed(1)} (±${cone.sigma_1s_pct}%) ${cone.ev_display ? '· EV: ' + cone.ev_display : ''} `,
            align: 'left',
            baseline: 'middle'
          },
          styles: {
            color: '#ffffff',
            backgroundColor: '#0284c7',
            borderColor: '#38bdf8',
            borderSize: 1,
            size: 9.5,
            padding: 2.5,
            borderRadius: 3
          },
          ignoreEvent: false
        },
        // Lower -1σ Badge
        {
          type: 'text',
          attrs: {
            x: lastX + 6,
            y: lastYL1,
            text: ` -1σ ($${Number(lastPt.lower_1s).toFixed(1)}) `,
            align: 'left',
            baseline: 'middle'
          },
          styles: {
            color: '#7dd3fc',
            backgroundColor: 'rgba(15, 23, 42, 0.88)',
            borderColor: 'rgba(56, 189, 248, 0.7)',
            borderSize: 0.8,
            size: 9,
            padding: 2,
            borderRadius: 2
          },
          ignoreEvent: true
        },
        // Lower -2σ Badge
        {
          type: 'text',
          attrs: {
            x: lastX + 6,
            y: lastYL2,
            text: ` -2σ ($${Number(lastPt.lower_2s).toFixed(1)}) `,
            align: 'left',
            baseline: 'middle'
          },
          styles: {
            color: '#38bdf8',
            backgroundColor: 'rgba(15, 23, 42, 0.88)',
            borderColor: 'rgba(56, 189, 248, 0.5)',
            borderSize: 0.8,
            size: 9,
            padding: 2,
            borderRadius: 2
          },
          ignoreEvent: true
        }
      ];

      return figures;
    }
  });
} catch (_) {}

// 3. Register custom 'liqMarker' (Live Liquidations on Chart)
try {
  registerOverlay({
    name: 'liqMarker',
    totalStep: 2,
    lock: true,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, yAxis, overlay }) => {
      if (!coordinates || coordinates.length === 0) return [];
      let { x, y } = coordinates[0];
      if (!Number.isFinite(x)) return [];

      const price = Number(overlay.points?.[0]?.value ?? 0);
      if (yAxis && typeof yAxis.convertToPixel === 'function' && price > 0) {
        const calcY = yAxis.convertToPixel(price);
        if (Number.isFinite(calcY)) {
          y = calcY;
        }
      }
      if (!Number.isFinite(y)) return [];

      const side = overlay.extendData?.side || 'BUY';
      const usd = Number(overlay.extendData?.usd_amount || 0);
      const isShortLiq = side === 'BUY';
      const color = isShortLiq ? '#00e676' : '#ff1744';
      const radius = Math.min(13, Math.max(5, Math.log10(Math.max(1000, usd)) * 2.2));
      const usdFormatted = usd >= 1000000 ? `$${(usd / 1000000).toFixed(2)}M` : `$${Math.round(usd / 1000)}k`;
      const labelText = isShortLiq ? `💀 SHORT ${usdFormatted}` : `💀 LONG ${usdFormatted}`;

      const figures = [
        {
          type: 'circle',
          attrs: { x, y, r: radius + 4 },
          styles: {
            style: 'stroke_fill',
            color: isShortLiq ? 'rgba(0, 230, 118, 0.22)' : 'rgba(255, 23, 68, 0.22)',
            borderColor: color,
            borderSize: 1.5
          },
          ignoreEvent: true
        },
        {
          type: 'circle',
          attrs: { x, y, r: radius * 0.55 },
          styles: {
            style: 'fill',
            color
          },
          ignoreEvent: true
        }
      ];

      if (usd >= 20000) {
        figures.push({
          type: 'text',
          attrs: {
            x,
            y: y - radius - 5,
            text: ` ${labelText} `,
            align: 'center',
            baseline: 'bottom'
          },
          styles: {
            color: '#ffffff',
            backgroundColor: isShortLiq ? '#059669' : '#dc2626',
            borderColor: color,
            borderSize: 0.5,
            size: 9.5,
            padding: 2.5,
            borderRadius: 2
          },
          ignoreEvent: true
        });
      }

      return figures;
    }
  });
} catch (_) {}

// 4. (задача 4.5) Дискретный overlay 'densityHeatmap' удалён — плотности стакана теперь
// рендерятся непрерывной WebGL-heatmap (DepthHeatmapGL) поверх главной панели.

// 4b. Register custom 'footprintCandle' (Footprint внутри свечи: buy/sell объёмы по уровням,
// imbalance-бордеры, stacked imbalance ♦, absorption ▬ — метрики считает backend, SRS M1.2b)
try {
  registerOverlay({
    name: 'footprintCandle',
    totalStep: 2,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, xAxis, yAxis, overlay }) => {
      if (!coordinates || coordinates.length === 0) return [];
      const anchor = coordinates[0];
      if (!Number.isFinite(anchor?.x)) return [];

      const data = overlay.extendData || {};
      const levels = Array.isArray(data.levels) ? data.levels : [];
      if (levels.length === 0) return [];

      const candleTs = Number(data.candleTs || 0);
      const tfMs = Number(data.tfMs || 300000);
      const maxLevelVol = Number(data.maxLevelVol || 0) || 1;

      // Ширина колонки футпринта = ширина 5-мин бакета в пикселях (ограничена 64px)
      let colWidth = 40;
      if (xAxis && typeof xAxis.convertToPixel === 'function' && candleTs > 0) {
        const x0 = xAxis.convertToPixel(candleTs);
        const x1 = xAxis.convertToPixel(candleTs + tfMs);
        if (Number.isFinite(x0) && Number.isFinite(x1) && x1 > x0) {
          colWidth = Math.min(64, Math.max(8, x1 - x0 - 2));
        }
      }
      const left = anchor.x - colWidth / 2;

      // Высота строки = расстояние между соседними уровнями (кламп 3..14px)
      let rowHeight = 6;
      if (yAxis && typeof yAxis.convertToPixel === 'function' && levels.length > 1) {
        const yA = yAxis.convertToPixel(levels[0].price);
        const yB = yAxis.convertToPixel(levels[1].price);
        if (Number.isFinite(yA) && Number.isFinite(yB) && yA !== yB) {
          rowHeight = Math.min(14, Math.max(3, Math.abs(yA - yB) - 1));
        }
      }

      const figures = [];
      let topY = Infinity;
      let bottomY = -Infinity;

      for (const lvl of levels) {
        if (!yAxis || typeof yAxis.convertToPixel !== 'function') break;
        const y = yAxis.convertToPixel(lvl.price);
        if (!Number.isFinite(y)) continue;
        topY = Math.min(topY, y);
        bottomY = Math.max(bottomY, y);

        const totalVol = (lvl.buy_vol || 0) + (lvl.sell_vol || 0);
        if (totalVol <= 0) continue;
        const share = totalVol / maxLevelVol;
        const barWidth = Math.max(1, colWidth * share);
        const isBuyDelta = (lvl.delta || 0) >= 0;
        const alpha = 0.14 + 0.42 * share;
        const fill = isBuyDelta ? `rgba(16, 185, 129, ${alpha})` : `rgba(239, 83, 80, ${alpha})`;

        const styles = { style: 'fill', color: fill };
        if (lvl.imbalance === 'buy' || lvl.imbalance === 'sell') {
          styles.style = 'stroke_fill';
          styles.borderColor = lvl.imbalance === 'buy' ? '#10b981' : '#ef5350';
          styles.borderSize = 1.5;
        }
        figures.push({
          type: 'rect',
          attrs: { x: left, y: y - rowHeight / 2, width: barWidth, height: rowHeight },
          styles,
          ignoreEvent: true
        });
      }

      // Stacked imbalance: янтарный ромб над колонкой
      const stacked = data.stacked || { buy: 0, sell: 0 };
      if ((stacked.buy >= 3 || stacked.sell >= 3) && Number.isFinite(topY)) {
        const cx = left + colWidth / 2;
        const cy = topY - 8;
        const r = 3.5;
        figures.push({
          type: 'polygon',
          attrs: { coordinates: [
            { x: cx, y: cy - r }, { x: cx + r, y: cy }, { x: cx, y: cy + r }, { x: cx - r, y: cy }
          ]},
          styles: { style: 'fill', color: stacked.buy >= 3 ? '#f59e0b' : '#fb7185' },
          ignoreEvent: true
        });
      }

      // Absorption: фиолетовая черта под колонкой
      if (data.absorption && Number.isFinite(bottomY)) {
        figures.push({
          type: 'rect',
          attrs: { x: left, y: bottomY + 5, width: colWidth, height: 2.5 },
          styles: { style: 'fill', color: 'rgba(168, 85, 247, 0.85)' },
          ignoreEvent: true
        });
      }

      return figures;
    }
  });
} catch (_) {}

// 4c. Register custom 'tpoProfile' (TPO/Volume Profile: гистограмма TPO слева от якоря,
// подсветка Value Area, маркеры POC/TPOC/TVAH/TVAL — данные /api/profile/tpo, SRS M1.2a/M6.2a)
try {
  registerOverlay({
    name: 'tpoProfile',
    totalStep: 2,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, yAxis, overlay }) => {
      if (!coordinates || coordinates.length === 0) return [];
      const anchor = coordinates[0];
      if (!Number.isFinite(anchor?.x)) return [];
      if (!yAxis || typeof yAxis.convertToPixel !== 'function') return [];

      const data = overlay.extendData || {};
      const rows = Array.isArray(data.rows) ? data.rows : [];
      if (rows.length === 0) return [];

      const maxTpo = Math.max(...rows.map(r => r.tpo_count || 0), 1);
      const maxWidth = 140;
      const right = anchor.x - 4;

      // Высота строки из соседних уровней
      let rowHeight = 5;
      if (rows.length > 1) {
        const yA = yAxis.convertToPixel(rows[0].price);
        const yB = yAxis.convertToPixel(rows[1].price);
        if (Number.isFinite(yA) && Number.isFinite(yB) && yA !== yB) {
          rowHeight = Math.min(12, Math.max(2.5, Math.abs(yA - yB) - 1));
        }
      }

      const figures = [];
      for (const row of rows) {
        const y = yAxis.convertToPixel(row.price);
        if (!Number.isFinite(y)) continue;
        const share = (row.tpo_count || 0) / maxTpo;
        if (share <= 0) continue;
        const w = Math.max(1, maxWidth * share);
        const inVa = !!row.tpo_in_value_area;
        const isPoc = data.tpoc_price != null && Math.abs(row.price - data.tpoc_price) < 1e-9;
        figures.push({
          type: 'rect',
          attrs: { x: right - w, y: y - rowHeight / 2, width: w, height: rowHeight },
          styles: {
            style: isPoc ? 'stroke_fill' : 'fill',
            color: isPoc ? 'rgba(245, 158, 11, 0.55)' : (inVa ? 'rgba(56, 189, 248, 0.34)' : 'rgba(56, 189, 248, 0.14)'),
            ...(isPoc ? { borderColor: '#f59e0b', borderSize: 1.2 } : {})
          },
          ignoreEvent: true
        });
      }

      // Линии VA и маркеры POC/TPOC
      const line = (price, color, label) => {
        if (price == null) return;
        const y = yAxis.convertToPixel(price);
        if (!Number.isFinite(y)) return;
        figures.push({
          type: 'rect',
          attrs: { x: right - maxWidth - 30, y: y - 0.75, width: maxWidth + 30, height: 1.5 },
          styles: { style: 'fill', color },
          ignoreEvent: true
        });
        figures.push({
          type: 'text',
          attrs: { x: right - maxWidth - 34, y, text: label, align: 'right', baseline: 'middle' },
          styles: { color, size: 9 },
          ignoreEvent: true
        });
      };
      line(data.tvah_price, 'rgba(245, 158, 11, 0.7)', 'TVAH');
      line(data.tval_price, 'rgba(245, 158, 11, 0.7)', 'TVAL');
      line(data.poc_price, 'rgba(226, 232, 240, 0.6)', 'POC');

      return figures;
    }
  });
} catch (_) {}

// 5. Register custom 'strategyLevelZone' (Strategy Entry/SL/TP Level + Role-Colored Badge)
try {
  registerOverlay({
    name: 'strategyLevelZone',
    totalStep: 2,
    lock: true,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, bounding, yAxis, overlay }) => {
      const ext = overlay.extendData || {};
      const price = Number(ext.price ?? overlay.points?.[0]?.value ?? 0);
      let y = null;
      if (yAxis && typeof yAxis.convertToPixel === 'function' && price > 0) {
        y = yAxis.convertToPixel(price);
      } else if (coordinates && coordinates.length > 0 && Number.isFinite(coordinates[0].y)) {
        y = coordinates[0].y;
      }
      if (y == null || !Number.isFinite(y)) return [];

      const width = (bounding && bounding.width) ? bounding.width : 2200;
      const role = ext.role || '';
      const isBuy = ext.type === 'BUY' || ext.side === 'BUY';
      const label = ext.label || (isBuy ? 'BUY ZONE: Wall $1.2M' : 'SHORT: Delta Div');

      let color = isBuy ? '#26a69a' : '#ef5350';
      let fillColor = isBuy ? 'rgba(38, 166, 154, 0.14)' : 'rgba(239, 83, 80, 0.14)';
      let lineStyle = 'dashed';
      let xOffset = 18;

      if (role === 'ENTRY') {
        color = '#2563eb';
        fillColor = 'rgba(37, 99, 235, 0.18)';
        lineStyle = 'dashed';
        xOffset = 18;
      } else if (role === 'SL') {
        color = '#ef4444';
        fillColor = 'rgba(239, 68, 68, 0.18)';
        lineStyle = 'solid';
        xOffset = 22;
      } else if (role === 'TP1' || role === 'TP2') {
        color = '#10b981';
        fillColor = 'rgba(16, 185, 129, 0.16)';
        lineStyle = 'solid';
        xOffset = role === 'TP1' ? 22 : 28;
      }

      const zoneHeight = role ? 12 : 16;

      return [
        {
          type: 'rect',
          attrs: {
            x: 0,
            y: y - zoneHeight / 2,
            width,
            height: zoneHeight
          },
          styles: {
            style: 'fill',
            color: fillColor
          },
          ignoreEvent: true
        },
        {
          type: 'line',
          attrs: {
            coordinates: [
              { x: 0, y },
              { x: width, y }
            ]
          },
          styles: {
            color,
            size: role === 'ENTRY' || role === 'SL' ? 1.8 : 1.5,
            style: lineStyle
          },
          ignoreEvent: true
        },
        {
          type: 'text',
          attrs: {
            x: xOffset,
            y: y - 8,
            text: ` ${label} `,
            align: 'left',
            baseline: 'middle'
          },
          styles: {
            color: '#ffffff',
            backgroundColor: color,
            size: 9.5,
            padding: 3,
            borderRadius: 2
          },
          ignoreEvent: true
        }
      ];
    }
  });
} catch (_) {}

// 5b. Register custom 'positionSetupBox' (Interactive Draggable Risk/Reward Overlay)
try {
  registerOverlay({
    name: 'positionSetupBox',
    totalStep: 3,
    lock: false,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    performEventPressedMove: ({ points, performPointIndex, performPoint }) => {
      if (Array.isArray(points) && performPointIndex != null && points[performPointIndex]) {
        points[performPointIndex] = { ...performPoint };
      }
    },
    onPressedMoving: ({ overlay }) => {
      if (!overlay || !Array.isArray(overlay.points) || overlay.points.length < 3) return;
      const entryP = Number(overlay.points[0]?.value);
      const tpP = Number(overlay.points[1]?.value);
      const slP = Number(overlay.points[2]?.value);
      if (entryP <= 0 || tpP <= 0 || slP <= 0) return;

      const riskUsd = Number(overlay.extendData?.risk_usd ?? overlay.extendData?.sl_risk_usd ?? 50);
      const metrics = calculatePositionMetrics({ entryPrice: entryP, tpPrice: tpP, slPrice: slP, riskUsd });
      if (metrics) {
        overlay.extendData = {
          ...overlay.extendData,
          ...metrics
        };
        // Zero-latency transient update into Zustand store without React re-render
        useTradeOverlayStore.getState().setTransientSetup({
          ...metrics,
          order_type: metrics.direction === 'LONG' ? 'BUY LIMIT' : 'SELL LIMIT'
        });
        window.__chartActiveSetup = {
          overlayId: overlay.id,
          ...metrics
        };
      }
    },
    onPressedMoveEnd: ({ overlay }) => {
      if (!overlay || !Array.isArray(overlay.points) || overlay.points.length < 3) return;
      const entryP = Number(overlay.points[0]?.value);
      const tpP = Number(overlay.points[1]?.value);
      const slP = Number(overlay.points[2]?.value);
      if (entryP <= 0 || tpP <= 0 || slP <= 0) return;

      const riskUsd = Number(overlay.extendData?.risk_usd ?? overlay.extendData?.sl_risk_usd ?? 50);
      const metrics = calculatePositionMetrics({ entryPrice: entryP, tpPrice: tpP, slPrice: slP, riskUsd });
      if (metrics) {
        overlay.extendData = {
          ...overlay.extendData,
          ...metrics
        };
        useTradeOverlayStore.getState().setTransientSetup({
          ...metrics,
          order_type: metrics.direction === 'LONG' ? 'BUY LIMIT' : 'SELL LIMIT'
        });
        window.__chartActiveSetup = {
          overlayId: overlay.id,
          ...metrics
        };
      }
    },
    createPointFigures: ({ bounding, coordinates, overlay, yAxis }) => {
      const pts = overlay?.points || [];
      const ext = overlay?.extendData || {};
      if (!yAxis || typeof yAxis.convertToPixel !== 'function') return [];

      let entryP = Number(pts[0]?.value ?? ext.entry_price ?? 0);
      let tpP = Number(pts[1]?.value ?? ext.tp1_price ?? 0);
      let slP = Number(pts[2]?.value ?? ext.sl_price ?? 0);

      if (entryP <= 0 && ext.entry_price) entryP = Number(ext.entry_price);
      if (entryP <= 0) return [];

      if (tpP <= 0) tpP = entryP * 1.015;
      if (slP <= 0) slP = entryP * 0.99;

      const yEntry = yAxis.convertToPixel(entryP);
      const yTp = yAxis.convertToPixel(tpP);
      const ySl = yAxis.convertToPixel(slP);
      if (![yEntry, yTp, ySl].every(Number.isFinite)) return [];

      const width = (bounding && bounding.width) ? bounding.width : 2200;
      let x0 = coordinates?.[0]?.x;
      let x1 = coordinates?.[1]?.x;
      let boxLeft = Math.max(12, Math.round(width * 0.12));
      let boxRight = width - 15;

      if (Number.isFinite(x0) && Number.isFinite(x1) && Math.abs(x1 - x0) > 40) {
        boxLeft = Math.min(x0, x1);
        boxRight = Math.max(x0, x1);
      }
      const boxWidth = Math.max(160, boxRight - boxLeft);

      // Auto-detect direction: TP above entry = LONG; TP below entry = SHORT
      const isLong = tpP >= entryP;
      const orderType = ext.order_type || (isLong ? 'BUY LIMIT' : 'SELL LIMIT');

      const profitDiff = Math.abs(tpP - entryP);
      const lossDiff = Math.abs(entryP - slP);
      const tpPct = ((profitDiff / entryP) * 100).toFixed(2);
      const slPct = ((lossDiff / entryP) * 100).toFixed(2);
      const rrRatio = lossDiff > 0 ? (profitDiff / lossDiff).toFixed(2) : '0.00';
      const riskUsd = Math.round(Number(ext.risk_usd ?? ext.sl_risk_usd ?? 50));
      const rewardUsd = Math.round(riskUsd * (lossDiff > 0 ? profitDiff / lossDiff : 0));
      const dec = entryP >= 1000 ? 1 : entryP >= 1 ? 2 : 4;

      const entryBadge = `[${orderType} @ ${entryP.toFixed(dec)}]`;
      const slBadge = `[SL @ ${slP.toFixed(dec)} (-${slPct}% | -$${riskUsd})]`;
      const tpBadge = `[TP @ ${tpP.toFixed(dec)} (+${tpPct}% | +$${rewardUsd})]`;
      const rrBadge = `[R:R 1:${rrRatio}]`;

      const riskTop = Math.min(yEntry, ySl);
      const riskHeight = Math.max(2, Math.abs(ySl - yEntry));
      const rewardTop = Math.min(yEntry, yTp);
      const rewardHeight = Math.max(2, Math.abs(yTp - yEntry));

      return [
        // 1. Shaded Risk Zone (Red) - 15% transparent with crisp 1px neon border
        {
          type: 'rect',
          attrs: {
            x: boxLeft,
            y: riskTop,
            width: boxWidth,
            height: riskHeight
          },
          styles: {
            style: 'stroke_fill',
            color: 'rgba(239, 68, 68, 0.12)',
            borderColor: '#ef4444',
            borderSize: 1
          },
          ignoreEvent: true
        },
        // 2. Shaded Reward Zone (Green) - 15% transparent with crisp 1px neon border
        {
          type: 'rect',
          attrs: {
            x: boxLeft,
            y: rewardTop,
            width: boxWidth,
            height: rewardHeight
          },
          styles: {
            style: 'stroke_fill',
            color: 'rgba(16, 185, 129, 0.12)',
            borderColor: '#10b981',
            borderSize: 1
          },
          ignoreEvent: true
        },
        // 3. Entry Line (Blue Dashed)
        {
          type: 'line',
          attrs: {
            coordinates: [
              { x: boxLeft, y: yEntry },
              { x: boxRight, y: yEntry }
            ]
          },
          styles: {
            color: '#3b82f6',
            size: 1.5,
            style: 'dashed',
            dashedValue: [4, 4]
          },
          ignoreEvent: true
        },
        // 4. SL Line (Red Solid)
        {
          type: 'line',
          attrs: {
            coordinates: [
              { x: boxLeft, y: ySl },
              { x: boxRight, y: ySl }
            ]
          },
          styles: {
            color: '#ef4444',
            size: 1.5,
            style: 'solid'
          },
          ignoreEvent: true
        },
        // 5. TP Line (Emerald Solid)
        {
          type: 'line',
          attrs: {
            coordinates: [
              { x: boxLeft, y: yTp },
              { x: boxRight, y: yTp }
            ]
          },
          styles: {
            color: '#10b981',
            size: 1.5,
            style: 'solid'
          },
          ignoreEvent: true
        },
        // 6. Handle circles for dragging
        {
          type: 'circle',
          attrs: { x: boxRight, y: yEntry, r: 4 },
          styles: { style: 'fill', color: '#3b82f6' },
          ignoreEvent: false
        },
        {
          type: 'circle',
          attrs: { x: boxRight, y: yTp, r: 4 },
          styles: { style: 'fill', color: '#10b981' },
          ignoreEvent: false
        },
        {
          type: 'circle',
          attrs: { x: boxRight, y: ySl, r: 4 },
          styles: { style: 'fill', color: '#ef4444' },
          ignoreEvent: false
        },
        // 7. Entry + R:R Badge (Translucent pill badge)
        {
          type: 'text',
          attrs: {
            x: boxLeft + 8,
            y: yEntry,
            text: ` ${entryBadge}  ${rrBadge} `,
            align: 'left',
            baseline: 'middle'
          },
          styles: {
            color: '#93c5fd',
            backgroundColor: 'rgba(37, 99, 235, 0.25)',
            borderColor: '#3b82f6',
            borderSize: 1,
            size: 9.5,
            padding: 3,
            borderRadius: 4
          },
          ignoreEvent: true
        },
        // 8. SL Badge (Translucent pill badge)
        {
          type: 'text',
          attrs: {
            x: boxLeft + 8,
            y: ySl,
            text: ` ${slBadge} `,
            align: 'left',
            baseline: 'middle'
          },
          styles: {
            color: '#fca5a5',
            backgroundColor: 'rgba(220, 38, 38, 0.25)',
            borderColor: '#ef4444',
            borderSize: 1,
            size: 9,
            padding: 2.5,
            borderRadius: 4
          },
          ignoreEvent: true
        },
        // 9. TP Badge (Translucent pill badge)
        {
          type: 'text',
          attrs: {
            x: boxLeft + 8,
            y: yTp,
            text: ` ${tpBadge} `,
            align: 'left',
            baseline: 'middle'
          },
          styles: {
            color: '#6ee7b7',
            backgroundColor: 'rgba(5, 150, 105, 0.25)',
            borderColor: '#10b981',
            borderSize: 1,
            size: 9,
            padding: 2.5,
            borderRadius: 4
          },
          ignoreEvent: true
        }
      ];
    }
  });
} catch (_) {}

// 6. Register custom 'orderbookWall' (OrderBook Densities > $1M with right-aligned badge)
try {
  registerOverlay({
    name: 'orderbookWall',
    totalStep: 2,
    lock: true,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, bounding, yAxis, overlay }) => {
      const ext = overlay.extendData || {};
      const price = Number(ext.price ?? overlay.points?.[0]?.value ?? 0);
      let y = null;
      if (yAxis && typeof yAxis.convertToPixel === 'function' && price > 0) {
        y = yAxis.convertToPixel(price);
      } else if (coordinates && coordinates.length > 0 && Number.isFinite(coordinates[0].y)) {
        y = coordinates[0].y;
      }
      if (y == null || !Number.isFinite(y)) return [];

      const width = (bounding && bounding.width) ? bounding.width : 2200;
      const isBuy = ext.side === 'BUY' || ext.side === 'bid';
      const volUsd = ext.volume_usd || 0;
      const volFormatted = volUsd >= 1000000 
        ? `$${(volUsd / 1000000).toFixed(2)}M` 
        : `$${Math.round(volUsd / 1000)}k`;
      const badgeText = isBuy ? `[🧲 BID WALL ${volFormatted}]` : `[🧲 ASK WALL ${volFormatted}]`;
      const color = isBuy ? '#10b981' : '#f43f5e';

      return [
        {
          type: 'line',
          attrs: {
            coordinates: [
              { x: 0, y },
              { x: width, y }
            ]
          },
          styles: {
            color,
            size: 1.5,
            style: 'solid'
          },
          ignoreEvent: true
        },
        {
          type: 'text',
          attrs: {
            x: Math.max(100, width - 12),
            y: y,
            text: ` ${badgeText} `,
            align: 'right',
            baseline: 'middle'
          },
          styles: {
            color: '#ffffff',
            backgroundColor: color,
            size: 10,
            padding: 3,
            borderRadius: 2
          },
          ignoreEvent: true
        }
      ];
    }
  });
} catch (_) {}


// 5. Register custom 'CVD' (Cumulative Volume Delta) sub-pane indicator
try {
  registerIndicator({
    name: 'CVD',
    shortName: 'CVD (Дельта)',
    shouldFormatBigNumber: true,
    precision: 1,
    figures: [
      {
        key: 'delta',
        title: 'Δ: ',
        type: 'bar',
        baseValue: 0,
        styles: (data) => {
          const d = data.current?.indicatorData?.delta ?? 0;
          return {
            color: d >= 0 ? 'rgba(38, 166, 154, 0.55)' : 'rgba(239, 83, 80, 0.55)'
          };
        }
      },
      {
        key: 'cvd',
        title: 'CVD: ',
        type: 'line',
        styles: () => ({ color: '#38bdf8', size: 1.5, style: 'solid', dashedValue: [2, 2] })
      }
    ],
    calc: (dataList) => {
      let cum = 0;
      return dataList.map(k => {
        const rng = Math.max(1e-9, (k.high || 0) - (k.low || 0));
        const buyRatio = ((k.close || 0) - (k.low || 0)) / rng;
        const delta = (2 * buyRatio - 1) * (k.volume || 0);
        cum += delta;
        return { delta, cvd: cum };
      });
    }
  });
} catch (_) {}

// 6. Register custom 'DeltaBars' (Pure Delta histogram) indicator
try {
  registerIndicator({
    name: 'DeltaBars',
    shortName: 'Δ Бары',
    precision: 1,
    figures: [
      {
        key: 'delta',
        title: 'Δ: ',
        type: 'bar',
        baseValue: 0,
        styles: (data) => {
          const d = data.current?.indicatorData?.delta ?? 0;
          return {
            color: d >= 0 ? '#26a69a' : '#ef5350'
          };
        }
      }
    ],
    calc: (dataList) => {
      return dataList.map(k => {
        const rng = Math.max(1e-9, (k.high || 0) - (k.low || 0));
        const buyRatio = ((k.close || 0) - (k.low || 0)) / rng;
        const delta = (2 * buyRatio - 1) * (k.volume || 0);
        return { delta };
      });
    }
  });
} catch (_) {}

// 7. Register custom 'ATR' indicator
try {
  registerIndicator({
    name: 'ATR',
    shortName: 'ATR (Волатильность)',
    precision: 1,
    calcParams: [14],
    figures: [
      {
        key: 'atr',
        title: 'ATR(14): ',
        type: 'line',
        styles: () => ({ color: '#10b981', size: 1.5, style: 'solid', dashedValue: [2, 2], smooth: false })
      }
    ],
    calc: (dataList, { calcParams }) => {
      const period = (calcParams && calcParams[0]) || 14;
      let trs = [];
      return dataList.map((k, i) => {
        if (i === 0) {
          const tr0 = (k.high || 0) - (k.low || 0);
          trs.push(tr0);
          return { atr: tr0 };
        }
        const prevClose = dataList[i - 1].close || k.close;
        const tr = Math.max(
          (k.high || 0) - (k.low || 0),
          Math.abs((k.high || 0) - prevClose),
          Math.abs((k.low || 0) - prevClose)
        );
        trs.push(tr);
        if (trs.length > period) trs.shift();
        const avg = trs.reduce((a, b) => a + b, 0) / trs.length;
        return { atr: avg };
      });
    }
  });
} catch (_) {}

// 8. Register custom 'SuperTrend' indicator
try {
  registerIndicator({
    name: 'SuperTrend',
    shortName: 'SuperTrend',
    precision: 2,
    calcParams: [10, 3.0],
    figures: [
      {
        key: 'supertrend',
        title: 'ST: ',
        type: 'line',
        styles: (data) => {
          const dir = data.current?.indicatorData?.direction ?? 1;
          return {
            color: dir === 1 ? '#10b981' : '#ef4444',
            size: 2,
            style: 'solid',
            dashedValue: [2, 2],
            smooth: false
          };
        }
      }
    ],
    calc: (dataList, { calcParams }) => {
      const period = (calcParams && calcParams[0]) || 10;
      const multiplier = (calcParams && calcParams[1]) || 3.0;
      let trs = [];
      let finalUpper = 0;
      let finalLower = 0;
      let direction = 1;

      return dataList.map((k, i) => {
        const prevClose = i > 0 ? (dataList[i - 1].close || k.close) : k.close;
        const tr = Math.max(
          (k.high || 0) - (k.low || 0),
          Math.abs((k.high || 0) - prevClose),
          Math.abs((k.low || 0) - prevClose)
        );
        trs.push(tr);
        if (trs.length > period) trs.shift();
        const atr = trs.reduce((a, b) => a + b, 0) / trs.length;

        const hl2 = ((k.high || 0) + (k.low || 0)) / 2;
        const basicUpper = hl2 + multiplier * atr;
        const basicLower = hl2 - multiplier * atr;

        if (i === 0) {
          finalUpper = basicUpper;
          finalLower = basicLower;
          direction = 1;
          return { supertrend: finalLower, direction };
        }

        const prevK = dataList[i - 1];
        if (basicUpper < finalUpper || prevK.close > finalUpper) {
          finalUpper = basicUpper;
        }
        if (basicLower > finalLower || prevK.close < finalLower) {
          finalLower = basicLower;
        }

        if (direction === 1) {
          if (k.close < finalLower) {
            direction = -1;
            return { supertrend: finalUpper, direction };
          } else {
            return { supertrend: finalLower, direction };
          }
        } else {
          if (k.close > finalUpper) {
            direction = 1;
            return { supertrend: finalLower, direction };
          } else {
            return { supertrend: finalUpper, direction };
          }
        }
      });
    }
  });
} catch (_) {}
