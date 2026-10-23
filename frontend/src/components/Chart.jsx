import React, { useEffect, useRef, useState, useCallback } from 'react';
import { init, dispose, registerOverlay, registerIndicator } from 'klinecharts';
import { 
  X,
  Loader2,
  Zap,
  AlertTriangle
} from 'lucide-react';
import { INDICATORS_REGISTRY, DEFAULT_ACTIVE_INDICATORS } from '../config/indicatorsRegistry';
import IndicatorsModal from './indicators/IndicatorsModal';
import IndicatorSettingsDialog from './indicators/IndicatorSettingsDialog';
import ActiveIndicatorStack from './indicators/ActiveIndicatorStack';
import { useLayoutStore } from '../stores/layoutStore';
import { useColorLinksStore } from '../stores/colorLinksStore';
import { useMarketDataStore } from '../stores/marketDataStore';
import { fetchKlinesDualSource, TF_MS } from '../services/marketDataFetcher';
import { useTradeOverlayStore, calculatePositionMetrics } from '../stores/tradeOverlayStore';
import { useBacktestStore } from '../stores/backtestStore';
import { useTradesStore } from '../stores/tradesStore';
import { getAllTemplates, saveCustomTemplate, getStyleMemory, saveStyleMemory } from '../config/drawingTemplates';
import { renderBacktestTrades, clearBacktestTrades, renderLiveSignals, clearLiveSignals, renderWhaleTrades, clearWhaleTrades } from '../utils/chartAnnotations';
import AssistantHUD from './AssistantHUD';
import DepthHeatmapGL from './DepthHeatmapGL';
import ChartToolbar from './chart/ChartToolbar.jsx';
import ChartContextMenu, { useChartContextMenu } from './chart/ChartContextMenu.jsx';
import { selectDensityPoints } from './chart/densityHeatmapMath.js';

const API_BASE = "/api";

// --- Шаг A: глубина истории ----------------------------------------------------
// Первая загрузка всегда передаёт startTime (одно окно в 1500 свечей = максимум
// Binance на запрос); скролл влево подгружает более старые окна через
// chart.loadMore до дневного пола истории (приёмка: 1m/1h >= 30д, 45m/6h >= 14д).
const INITIAL_HISTORY_BARS = 1500;
const LOAD_MORE_WINDOW_BARS = 1500;
const HISTORY_FLOOR_DAYS = {
  '1m': 30, '5m': 30, '15m': 45, '30m': 60,
  '45m': 30, '1h': 90, '4h': 180, '6h': 180
};

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

function hexToRgba(hex, alpha = 1) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return hex;
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return hex;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildChartStyles(uiConfig = {}) {
  const theme = uiConfig.theme || 'tealstreet';
  const gridOpacity = uiConfig.gridOpacity ?? 0.22;
  const candleOpacity = uiConfig.candleOpacity ?? 1.0;
  const emaColors = uiConfig.emaColors || ['#38bdf8', '#f59e0b', '#a855f7'];
  const emaWidth = uiConfig.emaWidth ?? 1.5;

  const palette = theme === 'tiger'
    ? { bull: '#00f5d4', bear: '#ff2a6d', gridRgb: '0, 229, 255', axis: '#141c2b', tick: '#64748b' }
    : theme === 'bloomberg'
    ? { bull: '#00e676', bear: '#ff3d00', gridRgb: '255, 152, 0', axis: '#332400', tick: '#b45309' }
    : { bull: '#26a69a', bear: '#ef5350', gridRgb: '120, 135, 165', axis: '#161922', tick: '#60697b' };

  const gridColor = `rgba(${palette.gridRgb}, ${gridOpacity})`;
  const upCol = hexToRgba(palette.bull, candleOpacity);
  const dnCol = hexToRgba(palette.bear, candleOpacity);

  return {
    grid: {
      show: true,
      horizontal: { color: gridColor, style: 'dash', size: 1, dashedValue: [2, 4] },
      vertical: { color: gridColor, style: 'dash', size: 1, dashedValue: [2, 4] }
    },
    candle: {
      type: 'candle_solid',
      bar: {
        upColor: upCol,
        downColor: dnCol,
        noChangeColor: '#787f91',
        upBorderColor: palette.bull,
        downBorderColor: palette.bear,
        noChangeBorderColor: '#787f91',
        upWickColor: palette.bull,
        downWickColor: palette.bear,
        noChangeWickColor: '#787f91'
      },
      priceMark: {
        show: true,
        high: { show: true, color: palette.tick, textSize: 10 },
        low: { show: true, color: palette.tick, textSize: 10 },
        last: {
          show: true,
          upColor: palette.bull,
          downColor: palette.bear,
          noChangeColor: '#787f91',
          line: { show: true, style: 'dash', dashedValue: [3, 3], size: 1 },
          text: { show: true, color: '#ffffff', size: 11, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 }
        }
      }
    },
    indicator: {
      bars: [{
        style: 'fill',
        borderStyle: 'solid',
        borderSize: 1,
        upColor: hexToRgba(palette.bull, 0.28),
        downColor: hexToRgba(palette.bear, 0.28),
        noChangeColor: 'rgba(120, 127, 145, 0.25)'
      }],
      lines: [
        { style: 'solid', smooth: false, size: emaWidth, color: emaColors[0] || '#38bdf8', dashedValue: [2, 2] },
        { style: 'solid', smooth: false, size: emaWidth, color: emaColors[1] || '#f59e0b', dashedValue: [2, 2] },
        { style: 'solid', smooth: false, size: emaWidth, color: emaColors[2] || '#a855f7', dashedValue: [2, 2] }
      ]
    },
    xAxis: {
      axisLine: { show: true, color: palette.axis },
      tickLine: { show: true, color: palette.axis },
      tickText: { color: palette.tick, size: 10, family: 'var(--font-mono)' }
    },
    yAxis: {
      axisLine: { show: true, color: palette.axis },
      tickLine: { show: true, color: palette.axis },
      tickText: { color: palette.tick, size: 10, family: 'var(--font-mono)' }
    },
    crosshair: {
      show: true,
      horizontal: { show: true, line: { color: '#2a3142', style: 'dash', dashedValue: [3, 3] }, text: { color: '#ffffff', backgroundColor: '#181c26' } },
      vertical: { show: true, line: { color: '#2a3142', style: 'dash', dashedValue: [3, 3] }, text: { color: '#ffffff', backgroundColor: '#181c26' } }
    }
  };
}

const USER_DRAWING_TYPES = new Set([
  'segment', 'straightLine', 'horizontalStraightLine', 'verticalStraightLine',
  'rayLine', 'arrow', 'priceLine', 'priceCoordinate', 'rect', 'fibonacciLine', 'measure', 'positionSetupBox'
]);

export default function Chart({ 
  chartId = "primary", 
  symbol: propSymbol = "BTCUSDT", 
  timeframe = "15m", 
  userId = "0", 
  titlePrefix = "", 
  onTimeframeChange,
  backtestSignals = null,
  showBacktestSignals = true,
  strategyLevels = [],
  activePositionSetup = null,
  uiConfig = null,
  chartIndicators = null,
  onOpenIndicators = null,
  onCloseWidget = null
}) {
  const channelSymbol = useColorLinksStore((s) => chartId ? s.getPanelSymbol(chartId, propSymbol) : null);
  const symbol = (channelSymbol || propSymbol || "BTCUSDT").toUpperCase();

  const chartContainerRef = useRef(null);
  // Инстанс klinecharts в state — чтобы WebGL-heatmap (DepthHeatmapGL) реагировала на re-init
  const [chartInstance, setChartInstance] = useState(null);
  const chartRef = useRef(null);
  const wsRef = useRef(null);
  const selectedOverlayId = useRef(null);
  const trackedOverlays = useRef(new Map()); // id -> overlay data
  const drawingHistory = useRef([]); // history stack of overlay IDs for Ctrl+Z undo
  const btOverlayIds = useRef([]); // backtest signal overlays (never saved as drawings)
  const activeStrategyLevelOverlays = useRef([]); // strategy entry zones (never saved as drawings)
  const activeVolatilityConeOverlayId = useRef(null); // volatility cone overlay
  const [isConeActive, setIsConeActive] = useState(false);
  const depthWsRef = useRef(null);
  const activePositionOverlayId = useRef(null);
  const [localPositionSetup, setLocalPositionSetup] = useState(null);
  const lastScrolledResult = useRef(null);
  const [klinesVersion, setKlinesVersion] = useState(0);
  const [btTooltip, setBtTooltip] = useState(null);
  const [paperTrades, setPaperTrades] = useState([]);
  const paperOverlayIds = useRef([]);

  // Market Regime: Toxic Volatility state
  const [isToxicRegime, setIsToxicRegime] = useState(false);
  const [isToxicDismissed, setIsToxicDismissed] = useState(false);

  useEffect(() => {
    setIsToxicDismissed(false);
    let isSubscribed = true;
    const checkRegime = async () => {
      try {
        const res = await fetch('/api/monitoring/state');
        if (res.ok && isSubscribed) {
          const data = await res.json();
          const symKey = symbol ? symbol.toUpperCase() : '';
          const symStatus = data.statuses?.[symKey] || data.statuses?.[symbol];
          const isToxic = symStatus?.regime === 'TOXIC_VOLATILITY' || (symStatus?.is_trade_allowed === false && symStatus?.state === 'toxic_halt');
          setIsToxicRegime(!!isToxic);
        }
      } catch (e) {}
    };
    checkRegime();
    const interval = setInterval(checkRegime, 4000);
    return () => { isSubscribed = false; clearInterval(interval); };
  }, [symbol]);

  // Synchronize with quantitative Backtest Store
  const activeBtResult = useBacktestStore((s) => s.activeResult);
  const showTradesOnChart = useBacktestStore((s) => s.showTradesOnChart);
  const isBacktesting = useBacktestStore((s) => s.isRunning);
  const runQuickBacktest = useBacktestStore((s) => s.runQuickBacktest);

  const effectiveBacktestSignals = backtestSignals || (activeBtResult?.symbol === symbol.toUpperCase() ? activeBtResult : null);
  const effectiveShowBtSignals = showBacktestSignals && showTradesOnChart;

  // Real-time signal overlay state from marketDataStore (Requirement 3)
  const liveSignals = useMarketDataStore((s) => s.liveSignals);
  const showLiveSignals = useMarketDataStore((s) => s.showLiveSignals);
  const toggleLiveSignals = useMarketDataStore((s) => s.toggleLiveSignals);
  const liveSignalOverlayIds = useRef([]);

  // Paper trades share the same native overlay path as historical trades, with muted blue/violet colors.
  useEffect(() => {
    let active = true;
    const loadPaperTrades = async () => {
      try {
        const response = await fetch('/api/paper-trading/status');
        if (!response.ok) return;
        const payload = await response.json();
        if (active) setPaperTrades((payload.closed_trades || []).filter((trade) => trade.symbol === symbol.toUpperCase()));
      } catch (_) {
        if (active) setPaperTrades([]);
      }
    };
    loadPaperTrades();
    const interval = setInterval(loadPaperTrades, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [symbol]);

  const handleQuickBacktestCurrentSetup = useCallback(async () => {
    try {
      await runQuickBacktest({ symbol, timeframe });
    } catch (err) {
      console.error("Quick backtest failed:", err);
    }
  }, [runQuickBacktest, symbol, timeframe]);

  // Stage 2: Consultative AI Second Opinion ("Второе мнение AI")
  const [secondOpinionData, setSecondOpinionData] = useState(null);
  const [isAskingOpinion, setIsAskingOpinion] = useState(false);

  const handleAskSecondOpinion = useCallback(async () => {
    setIsAskingOpinion(true);
    try {
      const transient = useTradeOverlayStore.getState().transientSetup;
      const setup = transient || activePositionSetup || localPositionSetup;
      const lastCandlePrice = currentKlines.current.length > 0
        ? currentKlines.current[currentKlines.current.length - 1].close
        : 0;
      const entryP = Number(setup?.entryPrice || setup?.entry_price || lastCandlePrice || 0);
      const slP = Number(setup?.slPrice || setup?.sl_price || 0) || null;
      const tpP = Number(setup?.tpPrice || setup?.tp1_price || setup?.tp_price || 0) || null;
      const dir = setup?.direction || (tpP && entryP && tpP < entryP ? 'SHORT' : 'LONG');
      const slPct = Number(setup?.slPct || setup?.sl_pct) ? Math.abs(Number(setup?.slPct || setup?.sl_pct)) : 0.6;
      const tpPct = Number(setup?.tpPct || setup?.tp1_pct) ? Math.abs(Number(setup?.tpPct || setup?.tp1_pct)) : 1.5;

      const res = await fetch('/api/journal/second-opinion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          timeframe,
          direction: dir,
          price: lastCandlePrice || entryP,
          entry_price: entryP || null,
          sl_price: slP,
          tp_price: tpP,
          stop_loss_pct: slPct,
          take_profit_pct: tpPct,
          strategy_type: 'density_bounce'
        })
      });
      if (res.ok) {
        const data = await res.json();
        setSecondOpinionData(data);
        window.dispatchEvent(new CustomEvent('decision-journal-updated'));
      }
    } catch (err) {
      console.error('Second opinion error:', err);
      setSecondOpinionData({
        ai_available: false,
        verdict: 'AI НЕДОСТУПЕН',
        reason: 'AI недоступен, принимай решение сам',
        context: { symbol, timeframe },
        log: null
      });
    } finally {
      setIsAskingOpinion(false);
    }
  }, [symbol, timeframe, activePositionSetup, localPositionSetup]);

  const handleDecisionFromOpinion = useCallback(async (userDecision) => {
    if (!secondOpinionData?.log?.id) return;
    try {
      const res = await fetch(`/api/journal/log/${secondOpinionData.log.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_decision: userDecision })
      });
      if (res.ok) {
        const updated = await res.json();
        setSecondOpinionData((prev) => prev ? { ...prev, log: updated.log } : prev);
        window.dispatchEvent(new CustomEvent('decision-journal-updated'));
      }
    } catch (err) {
      console.error('Failed to record trader decision on second opinion:', err);
    }
  }, [secondOpinionData]);
  
  const prevSymbolRef = useRef(symbol);
  const prevTimeframeRef = useRef(timeframe);

  const [chartReady, setChartReady] = useState(0);
  const [activeTool, setActiveTool] = useState(null);
  const activeDrawingOverlayId = useRef(null);
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [magnetEnabled, setMagnetEnabled] = useState(false);

  // SMC Drawing Templates & Style Memory
  const [drawingTemplates, setDrawingTemplates] = useState(() => getAllTemplates());
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const [activeDrawingStyle, setActiveDrawingStyle] = useState(() => getStyleMemory('default'));
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const savedIndicators = useLayoutStore((s) => s.getPanelIndicators(chartId));
  const setPanelIndicators = useLayoutStore((s) => s.setPanelIndicators);

  const [activeIndicators, setActiveIndicators] = useState(() => {
    return Array.isArray(savedIndicators) && savedIndicators.length > 0
      ? savedIndicators
      : DEFAULT_ACTIVE_INDICATORS;
  });

  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [settingsDialogIndId, setSettingsDialogIndId] = useState(null);

  const [statusMsg, setStatusMsg] = useState("");
  const [errorDetails, setErrorDetails] = useState(null);

  // Stage 3: Heatmap (default OFF for clean chart), Liquidations, VWAP, Storage info
  const [showHeatmap, setShowHeatmap] = useState(() => localStorage.getItem('chart_heatmap') === 'true');
  // Footprint-слой внутри свечей (SRS M1.2b), default OFF
  const [showFootprint, setShowFootprint] = useState(() => localStorage.getItem('chart_footprint') === 'true');
  // TPO/Volume Profile слой (SRS M1.2a), default OFF
  const [showTpo, setShowTpo] = useState(() => localStorage.getItem('chart_tpo') === 'true');
  const [showLiquidations, setShowLiquidations] = useState(() => localStorage.getItem('chart_liquidations') !== 'false');
  const [showVwap, setShowVwap] = useState(() => localStorage.getItem('chart_vwap') === 'true');
  const [showWalls, setShowWalls] = useState(() => localStorage.getItem('chart_walls') !== 'false');
  const [densityMode, setDensityMode] = useState(() => localStorage.getItem('chart_density_mode') || 'auto');
  const [minLiqUsd, setMinLiqUsd] = useState(20000);
  const [heatmapMinUsd, setHeatmapMinUsd] = useState(50000);
  const [storageInfo, setStorageInfo] = useState({ earliest: '', usage: '' });
  const activeLiqOverlays = useRef([]);
  const activeHeatmapOverlays = useRef([]);
  const activeFootprintOverlays = useRef([]);
  const activeTpoOverlays = useRef([]);
  const activeWallOverlays = useRef([]);
  const vwapLineOverlay = useRef(null);
  const currentKlines = useRef([]);

  const densityBudget = useCallback(() => {
    if (densityMode === 'compact') return 24;
    if (densityMode === 'full') return 120;
    const width = chartContainerRef.current?.clientWidth || 1000;
    if (width < 700) return 20;
    if (width < 1100) return 42;
    return 80;
  }, [densityMode]);

  // Точки плотностей для WebGL-heatmap (задача 4.5); бюджетирование — densityHeatmapMath.selectDensityPoints
  const [densityPoints, setDensityPoints] = useState([]);

  // Context Menu & Level Inspector State (ТАКТ 3) — логика в chart/ChartContextMenu.jsx
  const {
    contextMenu, setContextMenu,
    levelInspectorData, setLevelInspectorData,
    inspectingLevel,
    handleInspectLevel, handleContextMenu, handleResetScale,
  } = useChartContextMenu({ chartContainerRef, chartRef, currentKlines, setStatusMsg, symbol, timeframe });

  // Synchronize indicators with external IndicatorsModal state
  useEffect(() => {
    if (!chartIndicators) return;
    if (typeof chartIndicators.ema === 'boolean') {
      setIndicators(prev => {
        if (prev.ema !== chartIndicators.ema) {
          if (chartRef.current) {
            if (chartIndicators.ema) {
              chartRef.current.createIndicator({
                name: 'EMA',
                calcParams: uiConfig?.emaPeriods || [9, 21, 50]
              }, true, { id: 'candle_pane' });
            } else {
              chartRef.current.removeIndicator('candle_pane', 'EMA');
            }
          }
          return { ...prev, ema: chartIndicators.ema };
        }
        return prev;
      });
    }
    if (typeof chartIndicators.vol === 'boolean') {
      setIndicators(prev => {
        if (prev.vol !== chartIndicators.vol) {
          if (chartRef.current) {
            if (chartIndicators.vol) {
              chartRef.current.createIndicator('VOL', false, { id: 'pane_vol', height: 70 });
            } else {
              try { chartRef.current.removeIndicator('pane_vol', 'VOL'); } catch (_) {}
              try { chartRef.current.removeIndicator({ name: 'VOL' }); } catch (_) {}
            }
          }
          return { ...prev, vol: chartIndicators.vol };
        }
        return prev;
      });
    }
    if (typeof chartIndicators.cvd === 'boolean') {
      setIndicators(prev => {
        if (prev.cvd !== chartIndicators.cvd) {
          if (chartRef.current) {
            if (chartIndicators.cvd) {
              chartRef.current.createIndicator('CVD', false, { id: 'pane_cvd', height: 75 });
            } else {
              try { chartRef.current.removeIndicator('pane_cvd', 'CVD'); } catch (_) {}
              try { chartRef.current.removeIndicator({ name: 'CVD' }); } catch (_) {}
            }
          }
          return { ...prev, cvd: chartIndicators.cvd };
        }
        return prev;
      });
    }
    if (typeof chartIndicators.rsi === 'boolean') {
      setIndicators(prev => {
        if (prev.rsi !== chartIndicators.rsi) {
          if (chartRef.current) {
            if (chartIndicators.rsi) {
              chartRef.current.createIndicator('RSI', false, { id: 'pane_rsi', height: 70 });
            } else {
              try { chartRef.current.removeIndicator('pane_rsi', 'RSI'); } catch (_) {}
              try { chartRef.current.removeIndicator({ name: 'RSI' }); } catch (_) {}
            }
          }
          return { ...prev, rsi: chartIndicators.rsi };
        }
        return prev;
      });
    }
    if (typeof chartIndicators.macd === 'boolean') {
      setIndicators(prev => {
        if (prev.macd !== chartIndicators.macd) {
          if (chartRef.current) {
            if (chartIndicators.macd) {
              chartRef.current.createIndicator('MACD', false, { id: 'pane_macd', height: 75 });
            } else {
              try { chartRef.current.removeIndicator('pane_macd', 'MACD'); } catch (_) {}
              try { chartRef.current.removeIndicator({ name: 'MACD' }); } catch (_) {}
            }
          }
          return { ...prev, macd: chartIndicators.macd };
        }
        return prev;
      });
    }
    if (typeof chartIndicators.atr === 'boolean') {
      if (chartRef.current) {
        if (chartIndicators.atr) {
          chartRef.current.createIndicator('ATR', false, { id: 'pane_atr', height: 70 });
        } else {
          try { chartRef.current.removeIndicator('pane_atr', 'ATR'); } catch (_) {}
          try { chartRef.current.removeIndicator({ name: 'ATR' }); } catch (_) {}
        }
      }
    }
    if (typeof chartIndicators.deltaBars === 'boolean') {
      if (chartRef.current) {
        if (chartIndicators.deltaBars) {
          chartRef.current.createIndicator('DeltaBars', false, { id: 'pane_deltabars', height: 70 });
        } else {
          try { chartRef.current.removeIndicator('pane_deltabars', 'DeltaBars'); } catch (_) {}
          try { chartRef.current.removeIndicator({ name: 'DeltaBars' }); } catch (_) {}
        }
      }
    }
    if (typeof chartIndicators.vwap === 'boolean') {
      setShowVwap(chartIndicators.vwap);
      setIndicators(prev => ({ ...prev, vwap: chartIndicators.vwap }));
    }
    if (typeof chartIndicators.walls === 'boolean') {
      setShowWalls(chartIndicators.walls);
    }
    if (typeof chartIndicators.liquidations === 'boolean') {
      setShowLiquidations(chartIndicators.liquidations);
    }
    if (typeof chartIndicators.heatmap === 'boolean') {
      setShowHeatmap(chartIndicators.heatmap);
    }
  }, [chartIndicators, uiConfig]);

  // AI Copilot strategy levels projection listener
  useEffect(() => {
    const handleAiLevels = (e) => {
      const { levels, symbol: targetSym } = e.detail || {};
      if (targetSym && targetSym !== symbol) return;
      if (Array.isArray(levels) && chartRef.current) {
        const klines = currentKlines.current;
        if (!klines || klines.length === 0) return;
        const anchorTs = klines[klines.length - 1].timestamp;

        activeStrategyLevelOverlays.current.forEach(id => {
          try { chartRef.current.removeOverlay({ id }); } catch (_) {}
        });
        activeStrategyLevelOverlays.current = [];

        levels.forEach(lvl => {
          const p = Number(lvl.price);
          if (!p || !Number.isFinite(p)) return;
          try {
            const id = chartRef.current.createOverlay({
              name: 'strategyLevelZone',
              lock: true,
              points: [{ timestamp: anchorTs, value: p }],
              extendData: {
                type: lvl.type || 'BUY',
                label: lvl.label || 'AI Level',
                price: p
              }
            });
            if (id) activeStrategyLevelOverlays.current.push(id);
          } catch (_) {}
        });
        setStatusMsg("Уровни AI Ассистента нанесены");
        setTimeout(() => setStatusMsg(""), 2000);
      }
    };
    window.addEventListener('apply-ai-strategy-levels', handleAiLevels);
    return () => window.removeEventListener('apply-ai-strategy-levels', handleAiLevels);
  }, [symbol]);

  // Listen for Volatility Cone projection (Stage 3 & Stage 5)
  useEffect(() => {
    const handleVolatilityCone = (ev) => {
      let cone = ev.detail?.cone;
      const sym = ev.detail?.symbol;
      const isToggle = Boolean(ev.detail?.toggle);
      if (!chartRef.current) return;
      if (sym && sym.toUpperCase() !== symbol.toUpperCase()) return;

      if (activeVolatilityConeOverlayId.current) {
        try { chartRef.current.removeOverlay({ id: activeVolatilityConeOverlayId.current }); } catch (_) {}
        activeVolatilityConeOverlayId.current = null;
        setIsConeActive(false);
        if (isToggle && !cone) {
          setStatusMsg("Конус волатильности скрыт");
          setTimeout(() => setStatusMsg(""), 1200);
          return;
        }
      }

      const klines = currentKlines.current;
      if (!cone && klines && klines.length >= 10) {
        // Calculate 14-period ATR from loaded klines
        const sampleCount = Math.min(14, klines.length - 1);
        let trSum = 0;
        for (let i = klines.length - sampleCount; i < klines.length; i++) {
          const bar = klines[i];
          const prevClose = klines[i - 1] ? klines[i - 1].close : bar.open;
          const tr = Math.max(
            bar.high - bar.low,
            Math.abs(bar.high - prevClose),
            Math.abs(bar.low - prevClose)
          );
          trSum += tr;
        }
        const atr = trSum / sampleCount;
        const lastBar = klines[klines.length - 1];
        const basePrice = lastBar.close;
        const anchorTs = lastBar.timestamp;
        const tfMs = TF_MS[timeframe] || 300000;

        const monStatus = useMarketDataStore.getState().monitoringStatuses[symbol.toUpperCase()];
        const trend = (monStatus?.forecast_trend || 'NEUTRAL').toUpperCase();
        const driftSign = trend === 'BULLISH' ? 1 : trend === 'BEARISH' ? -1 : 0;
        const expectedDriftPct = driftSign * 0.35;

        const fanPoints = [];
        for (let i = 1; i <= 16; i++) {
          const stepSigma = Math.sqrt(i) * Math.max(atr * 0.85, basePrice * 0.002);
          const drift = (basePrice * (expectedDriftPct / 100)) * (i / 16);
          const mid = Number((basePrice + drift).toFixed(2));
          fanPoints.push({
            bar_offset: i,
            timestamp: anchorTs + i * tfMs,
            price_mid: mid,
            upper_1s: Number((mid + stepSigma).toFixed(2)),
            lower_1s: Number((mid - stepSigma).toFixed(2)),
            upper_2s: Number((mid + stepSigma * 1.96).toFixed(2)),
            lower_2s: Number((mid - stepSigma * 1.96).toFixed(2)),
            upper_1sigma: Number((mid + stepSigma).toFixed(2)),
            lower_1sigma: Number((mid - stepSigma).toFixed(2)),
            upper_2sigma: Number((mid + stepSigma * 1.96).toFixed(2)),
            lower_2sigma: Number((mid - stepSigma * 1.96).toFixed(2)),
          });
        }

        cone = {
          base_price: basePrice,
          base_timestamp: anchorTs,
          fan_points: fanPoints,
          direction: trend === 'BULLISH' ? 'BULLISH' : trend === 'BEARISH' ? 'BEARISH' : 'NEUTRAL',
          trend,
          expected_drift_pct: expectedDriftPct,
          sigma_1s_pct: ((atr / basePrice) * 100).toFixed(2),
          ev_display: driftSign > 0 ? '+0.45R' : driftSign < 0 ? '-0.45R' : '0.00R'
        };
      }

      if (!cone || !cone.fan_points || cone.fan_points.length === 0) {
        setStatusMsg("Конус волатильности скрыт");
        setTimeout(() => setStatusMsg(""), 1200);
        setIsConeActive(false);
        return;
      }

      const anchorTs = cone.base_timestamp || (klines && klines.length ? klines[klines.length - 1].timestamp : Date.now());
      const endTs = cone.fan_points[cone.fan_points.length - 1].timestamp;

      try {
        const id = chartRef.current.createOverlay({
          name: 'volatilityCone',
          lock: true,
          points: [
            { timestamp: anchorTs, value: cone.base_price },
            { timestamp: endTs, value: cone.base_price }
          ],
          extendData: {
            ...cone,
            symbol: sym || symbol
          }
        });
        if (id) {
          activeVolatilityConeOverlayId.current = id;
          setIsConeActive(true);
          setStatusMsg("📐 Конус волатильности (±1σ / ±2σ) спроецирован на 16 баров");
          setTimeout(() => setStatusMsg(""), 2000);
          try {
            chartRef.current.scrollToTimestamp(endTs + 4 * 60000, 200);
          } catch (_) {}
        }
      } catch (err) {
        console.warn("Failed to create volatilityCone overlay:", err);
      }
    };

    const handleClearVolatilityCone = () => {
      if (activeVolatilityConeOverlayId.current && chartRef.current) {
        try { chartRef.current.removeOverlay({ id: activeVolatilityConeOverlayId.current }); } catch (_) {}
        activeVolatilityConeOverlayId.current = null;
      }
      setIsConeActive(false);
    };

    window.addEventListener('apply-volatility-cone', handleVolatilityCone);
    window.addEventListener('clear-volatility-cone', handleClearVolatilityCone);
    return () => {
      window.removeEventListener('apply-volatility-cone', handleVolatilityCone);
      window.removeEventListener('clear-volatility-cone', handleClearVolatilityCone);
      handleClearVolatilityCone();
    };
  }, [symbol, timeframe]);

  // Initialize KLineChart instance with ResizeObserver (ТАКТ 1)
  useEffect(() => {
    if (!chartContainerRef.current) return;
    
    try {
      dispose(chartContainerRef.current);
    } catch (_) {}

    const chart = init(chartContainerRef.current);
    chartRef.current = chart;
    setChartInstance(chart);
    window.__charts = window.__charts || {};
    window.__charts[chartId] = chart;
    if (chartId === 'primary' || !window.__chart) {
      window.__chart = chart;
    }

    // Explicitly enable scroll & zoom navigation
    chart.setScrollEnabled(true);
    chart.setZoomEnabled(true);
    try {
      chart.setPaneOptions({ id: 'candle_pane', dragEnabled: true, axisOptions: { scrollZoomEnabled: true } });
    } catch (_) {}

    // Apply initial theme styles
    chart.setStyles(buildChartStyles(uiConfig || {}));

    // Set timezone to Europe/Kyiv
    try {
      chart.setTimezone('Europe/Kyiv');
    } catch (e) {
      console.warn("Timezone set warning:", e);
    }

    // Default indicators based on initial uiConfig
    try {
      if (uiConfig?.emaEnabled !== false) {
        chart.createIndicator({
          name: 'EMA',
          calcParams: uiConfig?.emaPeriods || [9, 21, 50]
        }, true, { id: 'candle_pane' });
      }
      if (uiConfig?.subpanes?.vol !== false) {
        chart.createIndicator('VOL', false, { id: 'pane_vol', height: 70 });
      }
      if (uiConfig?.subpanes?.cvd) {
        chart.createIndicator('CVD', false, { id: 'pane_cvd', height: 75 });
      }
      if (uiConfig?.subpanes?.rsi) {
        chart.createIndicator('RSI', false, { id: 'pane_rsi', height: 70 });
      }
      if (uiConfig?.subpanes?.macd) {
        chart.createIndicator('MACD', false, { id: 'pane_macd', height: 75 });
      }
    } catch (e) {
      console.warn("Indicator init warning:", e);
    }

    // Crosshair Sync: subscribe to mouse crosshair movement
    chart.subscribeAction('onCrosshairChange', (data) => {
      const ts = data?.kLineData?.timestamp || null;
      window.dispatchEvent(new CustomEvent('crosshair-sync', {
        detail: { chartId, timestamp: ts }
      }));
    });

    // Zoom Clamping: clamp barSpace between 3px (max zoom out) and 60px (max zoom in)
    // Prevents canvas division by zero and overlay distortion during mouse wheel zoom
    try {
      chart.subscribeAction('onZoom', () => {
        try {
          const bs = chart.getBarSpace();
          if (typeof bs === 'number' && Number.isFinite(bs)) {
            if (bs < 3) {
              chart.setBarSpace(3);
            } else if (bs > 60) {
              chart.setBarSpace(60);
            }
          }
        } catch (_) {}
      });
    } catch (_) {}

    setChartReady(prev => prev + 1);

    let rafId = null;
    const handleResize = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (chartRef.current) {
          try {
            chartRef.current.resize();
            window.__chartResizeCounts = window.__chartResizeCounts || {};
            window.__chartResizeCounts[chartId] = (window.__chartResizeCounts[chartId] || 0) + 1;
          } catch (_) {}
        }
      });
    };

    window.addEventListener('resize', handleResize);

    // ResizeObserver for Dual-Pane 50/50 split and collapsible panels
    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && chartContainerRef.current) {
      ro = new ResizeObserver(() => handleResize());
      ro.observe(chartContainerRef.current);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      if (ro) ro.disconnect();
      try {
        dispose(chartContainerRef.current);
      } catch (_) {}
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync modular indicators with KLineCharts instance
  const syncIndicatorsWithChart = useCallback((chart, indicatorsList) => {
    if (!chart) return;
    const activeMap = new Map((indicatorsList || []).map((item) => [item.id, item]));

    Object.values(INDICATORS_REGISTRY).forEach((def) => {
      const activeItem = activeMap.get(def.id);
      const isMain = def.pane === 'main';
      const paneId = isMain ? 'candle_pane' : `pane_${def.id}`;
      const klineName = def.klineName;

      if (!activeItem || activeItem.enabled === false) {
        try {
          if (isMain) {
            chart.removeIndicator(paneId, klineName);
          } else {
            chart.removeIndicator(paneId, klineName);
            chart.removeIndicator({ name: klineName });
          }
        } catch (_) {}
      } else {
        const calcParams = def.toCalcParams(activeItem.inputs || def.defaultInputs);
        const styles = def.toKlineStyles(activeItem.styles || def.defaultStyles);

        try {
          if (isMain) {
            chart.createIndicator({
              name: klineName,
              calcParams,
              styles
            }, true, { id: 'candle_pane' });
            chart.overrideIndicator({
              name: klineName,
              calcParams,
              styles
            }, 'candle_pane');
          } else {
            chart.createIndicator({
              name: klineName,
              calcParams,
              styles
            }, false, { id: paneId, height: def.height || 70 });
            chart.overrideIndicator({
              name: klineName,
              calcParams,
              styles
            }, paneId);
          }
        } catch (_) {
          try {
            chart.createIndicator(klineName, isMain, { id: paneId, height: def.height || 70 });
          } catch (_) {}
        }
      }
    });
  }, []);

  const activeIndicatorsRef = useRef(activeIndicators);
  useEffect(() => {
    activeIndicatorsRef.current = activeIndicators;
  }, [activeIndicators]);

  const handleAddIndicator = useCallback((indId) => {
    const def = INDICATORS_REGISTRY[indId];
    if (!def) return;
    const prev = activeIndicatorsRef.current || [];
    if (prev.some((i) => i.id === indId)) return;
    const next = [
      ...prev,
      {
        id: indId,
        enabled: true,
        inputs: { ...def.defaultInputs },
        styles: { ...def.defaultStyles }
      }
    ];
    activeIndicatorsRef.current = next;
    setActiveIndicators(next);
    setPanelIndicators(chartId, next);
    if (chartRef.current) {
      syncIndicatorsWithChart(chartRef.current, next);
    }
    setStatusMsg(`Добавлен: ${def.shortName}`);
    setTimeout(() => setStatusMsg(''), 1500);
  }, [chartId, setPanelIndicators, syncIndicatorsWithChart]);

  const handleRemoveIndicator = useCallback((indId) => {
    const def = INDICATORS_REGISTRY[indId];
    const prev = activeIndicatorsRef.current || [];
    const next = prev.filter((i) => i.id !== indId);
    activeIndicatorsRef.current = next;
    setActiveIndicators(next);
    setPanelIndicators(chartId, next);
    if (chartRef.current) {
      const isMain = def?.pane === 'main';
      const paneId = isMain ? 'candle_pane' : `pane_${indId}`;
      const klineName = def ? def.klineName : indId.toUpperCase();
      try {
        chartRef.current.removeIndicator(paneId, klineName);
        if (!isMain) chartRef.current.removeIndicator({ name: klineName });
      } catch (_) {}
      syncIndicatorsWithChart(chartRef.current, next);
    }
  }, [chartId, setPanelIndicators, syncIndicatorsWithChart]);

  const handleToggleVisibility = useCallback((indId) => {
    const prev = activeIndicatorsRef.current || [];
    const next = prev.map((item) =>
      item.id === indId ? { ...item, enabled: !item.enabled } : item
    );
    activeIndicatorsRef.current = next;
    setActiveIndicators(next);
    setPanelIndicators(chartId, next);
    if (chartRef.current) {
      syncIndicatorsWithChart(chartRef.current, next);
    }
  }, [chartId, setPanelIndicators, syncIndicatorsWithChart]);

  const handleSaveSettings = useCallback((indId, newInputs, newStyles) => {
    const prev = activeIndicatorsRef.current || [];
    const next = prev.map((item) =>
      item.id === indId
        ? { ...item, inputs: { ...newInputs }, styles: { ...newStyles } }
        : item
    );
    activeIndicatorsRef.current = next;
    setActiveIndicators(next);
    setPanelIndicators(chartId, next);
    if (chartRef.current) {
      syncIndicatorsWithChart(chartRef.current, next);
    }
    setStatusMsg(`Настройки ${indId.toUpperCase()} сохранены`);
    setTimeout(() => setStatusMsg(''), 1500);
  }, [chartId, setPanelIndicators, syncIndicatorsWithChart]);

  // Dynamically apply uiConfig and indicators sync
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (uiConfig) {
      try {
        chart.setStyles(buildChartStyles(uiConfig));
      } catch (_) {}

      try {
        if (uiConfig.pricePrecision && uiConfig.pricePrecision !== 'auto') {
          chart.setPriceVolumePrecision(Number(uiConfig.pricePrecision), 2);
        } else {
          const p = symbol.includes('BTC') ? 1 : symbol.includes('ETH') || symbol.includes('SOL') ? 2 : 4;
          chart.setPriceVolumePrecision(p, 2);
        }
      } catch (_) {}
    }

    // Sync modular indicators with KLineCharts
    syncIndicatorsWithChart(chart, activeIndicators);
  }, [uiConfig, symbol, activeIndicators, syncIndicatorsWithChart, chartReady]);

  // Save drawings for a specific symbol/timeframe (e.g. before coin switch)
  const saveDrawingsFor = useCallback((targetSymbol, targetTimeframe) => {
    if (!chartRef.current) return;
    const sym = (targetSymbol || symbol).toUpperCase();
    const tf = targetTimeframe || timeframe;
    
    const saveList = [];
    
    // Method 1: Check internal _chartStore overlay instance map
    try {
      const store = chartRef.current._chartStore?.getOverlayStore();
      if (store && store._instances) {
        for (const instances of store._instances.values()) {
          instances.forEach(inst => {
            if (inst && inst.points && inst.points.length > 0) {
              if (inst.id !== 'sync_crosshair_marker' && USER_DRAWING_TYPES.has(inst.name)) {
                saveList.push({
                  name: inst.name,
                  points: inst.points,
                  styles: inst.styles
                });
              }
            }
          });
        }
      }
    } catch (_) {}

    // Method 2: Fallback to trackedOverlays ref if store not directly accessible
    if (saveList.length === 0 && trackedOverlays.current.size > 0) {
      for (const [id, data] of trackedOverlays.current.entries()) {
        if (id === 'sync_crosshair_marker') continue;
        const inst = chartRef.current.getOverlayById(id);
        if (inst && inst.points && inst.points.length > 0 && USER_DRAWING_TYPES.has(inst.name)) {
          saveList.push({
            name: inst.name || data.name,
            points: inst.points,
            styles: inst.styles
          });
        } else if (data && data.points && USER_DRAWING_TYPES.has(data.name)) {
          saveList.push(data);
        }
      }
    }

    fetch(`${API_BASE}/drawings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        symbol: sym,
        timeframe: tf,
        elements_json: JSON.stringify(saveList)
      })
    })
    .then(res => res.json())
    .then(() => {
      setStatusMsg("Сохранено!");
      setTimeout(() => setStatusMsg(""), 1200);
    })
    .catch(() => {});
  }, [symbol, timeframe, userId]);

  // Save current active drawings
  const saveDrawings = useCallback(() => {
    saveDrawingsFor(symbol, timeframe);
  }, [saveDrawingsFor, symbol, timeframe]);

  // Load drawings from backend
  const loadDrawings = useCallback(() => {
    if (!chartRef.current) return;
    
    fetch(`${API_BASE}/drawings?symbol=${symbol}&timeframe=${timeframe}&user_id=${userId}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.elements_json && chartRef.current) {
          try {
            const list = JSON.parse(data.elements_json);
            if (Array.isArray(list)) {
              // Remove ONLY tracked user drawings so liquidations & heatmap aren't wiped
              for (const id of trackedOverlays.current.keys()) {
                try {
                  chartRef.current.removeOverlay({ id });
                } catch (_) {}
              }
              trackedOverlays.current.clear();
              drawingHistory.current = [];
              selectedOverlayId.current = null;

              list.forEach(overlay => {
                if (!overlay || !overlay.name || !USER_DRAWING_TYPES.has(overlay.name)) return;
                const id = chartRef.current.createOverlay({
                  ...overlay,
                  onSelected: (e) => {
                    selectedOverlayId.current = e.overlay.id;
                    return true;
                  },
                  onDeselected: () => {
                    selectedOverlayId.current = null;
                    return true;
                  }
                });
                if (id) {
                  trackedOverlays.current.set(id, overlay);
                  drawingHistory.current.push(id);
                }
              });
            }
          } catch (e) {
            console.error("Failed to parse drawings:", e);
          }
        }
      })
      .catch(e => console.error("Could not load drawings:", e));
  }, [symbol, timeframe, userId]);

  // Undo last drawn figure (Ctrl+Z)
  const handleUndo = useCallback(() => {
    if (!chartRef.current) return;
    if (drawingHistory.current.length > 0) {
      const lastId = drawingHistory.current.pop();
      try {
        chartRef.current.removeOverlay({ id: lastId });
      } catch (_) {}
      trackedOverlays.current.delete(lastId);
      if (selectedOverlayId.current === lastId) {
        selectedOverlayId.current = null;
      }
      saveDrawings();
      setStatusMsg("Отменено (Ctrl+Z)");
      setTimeout(() => setStatusMsg(""), 1200);
    }
  }, [saveDrawings]);

  // Cancel active drawing tool creation and restore cursor / drag navigation
  const cancelActiveDrawing = useCallback(() => {
    setActiveTool(null);
    if (activeDrawingOverlayId.current && chartRef.current) {
      try {
        chartRef.current.removeOverlay({ id: activeDrawingOverlayId.current });
      } catch (_) {}
      trackedOverlays.current.delete(activeDrawingOverlayId.current);
      drawingHistory.current = drawingHistory.current.filter(id => id !== activeDrawingOverlayId.current);
      activeDrawingOverlayId.current = null;
    }
    setStatusMsg("Режим курсора (перетаскивание)");
    setTimeout(() => setStatusMsg(""), 1000);
  }, []);

  // Hotkey listener for Ctrl+Z (Undo), Delete/Backspace on active overlay & Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Ctrl+Z or Cmd+Z: Undo last drawing figure
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я')) {
        e.preventDefault();
        handleUndo();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedOverlayId.current && chartRef.current) {
          try {
            chartRef.current.removeOverlay({ id: selectedOverlayId.current });
            trackedOverlays.current.delete(selectedOverlayId.current);
            selectedOverlayId.current = null;
            saveDrawings();
          } catch (_) {}
        }
      } else if (e.key === 'Escape') {
        cancelActiveDrawing();
        setContextMenu({ visible: false, x: 0, y: 0 });
        setIsCatalogOpen(false);
        setSettingsDialogIndId(null);
      } else if ((e.key === 'i' || e.key === 'I' || e.key === 'ш' || e.key === 'Ш' || e.key === '/') && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        setIsCatalogOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [symbol, timeframe, userId, saveDrawings, handleUndo, cancelActiveDrawing]);

  // Global mouseup to reset isMouseDown dragging state
  useEffect(() => {
    const handleGlobalMouseUp = () => setIsMouseDown(false);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  // Global event listener for Undo
  useEffect(() => {
    const onUndo = () => handleUndo();
    window.addEventListener('chart-undo-drawing', onUndo);
    return () => window.removeEventListener('chart-undo-drawing', onUndo);
  }, [handleUndo]);

  // Crosshair synchronization listener from other chart in dual-pane
  useEffect(() => {
    const handleSync = (e) => {
      if (!chartRef.current) return;
      const { chartId: sourceId, timestamp } = e.detail || {};
      if (sourceId && sourceId !== chartId) {
        try {
          const syncId = 'sync_crosshair_marker';
          if (timestamp) {
            const existing = chartRef.current.getOverlayById(syncId);
            if (existing) {
              chartRef.current.overrideOverlay({
                id: syncId,
                points: [{ timestamp }]
              });
            } else {
              chartRef.current.createOverlay({
                name: 'verticalStraightLine',
                id: syncId,
                points: [{ timestamp }],
                lock: true,
                needDefaultPointFigure: false,
                needDefaultXAxisFigure: false,
                needDefaultYAxisFigure: false,
                styles: {
                  line: {
                    color: '#ff9800',
                    size: 1,
                    style: 'dashed'
                  }
                }
              });
            }
          } else {
            chartRef.current.removeOverlay({ id: syncId });
          }
        } catch (_) {}
      }
    };

    window.addEventListener('crosshair-sync', handleSync);
    return () => window.removeEventListener('crosshair-sync', handleSync);
  }, [chartId]);

  // Save current drawings before switching symbol/timeframe or on unmount
  useEffect(() => {
    if (prevSymbolRef.current !== symbol || prevTimeframeRef.current !== timeframe) {
      if (prevSymbolRef.current && prevTimeframeRef.current) {
        saveDrawingsFor(prevSymbolRef.current, prevTimeframeRef.current);
      }
      prevSymbolRef.current = symbol;
      prevTimeframeRef.current = timeframe;
    }
  }, [symbol, timeframe, saveDrawingsFor]);

  useEffect(() => {
    return () => {
      if (prevSymbolRef.current && prevTimeframeRef.current) {
        saveDrawingsFor(prevSymbolRef.current, prevTimeframeRef.current);
      }
    };
  }, [saveDrawingsFor]);

  // Recenter chart to real time on Space key
  useEffect(() => {
    const handleRecenter = () => {
      if (chartRef.current) {
        try {
          chartRef.current.scrollToRealTime();
          setStatusMsg("Центрировано на текущей цене");
          setTimeout(() => setStatusMsg(""), 1200);
        } catch (_) {}
      }
    };
    window.addEventListener('recenter-market-price', handleRecenter);
    return () => window.removeEventListener('recenter-market-price', handleRecenter);
  }, []);

  // Update VWAP Overlay
  const updateVwapOverlay = useCallback((klinesData) => {
    if (!chartRef.current || !showVwap) return;
    const klines = klinesData || currentKlines.current;
    if (!klines || klines.length < 2) return;

    try {
      let cumPV = 0;
      let cumV = 0;
      const vwapPoints = [];
      klines.forEach(k => {
        const tp = (k.high + k.low + k.close) / 3;
        cumPV += tp * k.volume;
        cumV += k.volume;
        const vwapVal = cumV > 0 ? cumPV / cumV : k.close;
        vwapPoints.push({ timestamp: k.timestamp, value: vwapVal });
      });

      if (vwapLineOverlay.current) {
        try { chartRef.current.removeOverlay({ id: vwapLineOverlay.current }); } catch (_) {}
      }

      if (vwapPoints.length >= 2) {
        const p1 = vwapPoints[0];
        const p2 = vwapPoints[vwapPoints.length - 1];
        const id = chartRef.current.createOverlay({
          name: 'segment',
          points: [p1, p2],
          styles: {
            line: { color: '#ffb300', size: 2, style: 'solid' }
          }
        });
        vwapLineOverlay.current = id;
      }
    } catch (_) {}
  }, [showVwap]);

  // Load and render Liquidations on Chart
  const loadLiquidations = useCallback(async () => {
    if (!chartRef.current || !showLiquidations) {
      activeLiqOverlays.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
      activeLiqOverlays.current = [];
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/liquidations?symbol=${symbol}&min_usd=${minLiqUsd}&limit=50`);
      if (!res.ok) return;
      const data = await res.json();

      activeLiqOverlays.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
      activeLiqOverlays.current = [];

      if (Array.isArray(data)) {
        data.forEach(evt => {
          const id = chartRef.current.createOverlay({
            name: 'liqMarker',
            points: [{ timestamp: evt.timestamp, value: evt.price }],
            extendData: { side: evt.side, usd_amount: evt.usd_amount }
          });
          if (id) activeLiqOverlays.current.push(id);
        });
      }
    } catch (_) {}
  }, [symbol, showLiquidations, minLiqUsd]);

  // Load Density Heatmap points (задача 4.5): точки отдаются в WebGL-heatmap поверх графика
  // force=true — вызов из тумблера: состояние showHeatmap ещё старое, чистим/грузим явно
  const loadHeatmap = useCallback(async (force = false) => {
    if (!chartRef.current || (!showHeatmap && !force)) {
      activeHeatmapOverlays.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
      activeHeatmapOverlays.current = [];
      setDensityPoints([]);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/heatmap?symbol=${symbol}&min_usd=${heatmapMinUsd}&limit=350`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) {
        setDensityPoints(selectDensityPoints(data, densityBudget()));
      }
    } catch (_) {}
  }, [symbol, showHeatmap, heatmapMinUsd, densityBudget]);

  // Load and render Footprint clusters inside candles (SRS M1.2b)
  const loadFootprint = useCallback(async () => {
    if (!chartRef.current || !showFootprint) {
      activeFootprintOverlays.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
      activeFootprintOverlays.current = [];
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/recorder/clusters?symbol=${symbol}&limit=48`);
      if (!res.ok) return;
      const data = await res.json();

      activeFootprintOverlays.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
      activeFootprintOverlays.current = [];

      if (!Array.isArray(data)) return;
      data.forEach(candle => {
        const levels = Array.isArray(candle.levels) ? candle.levels : [];
        if (levels.length === 0) return;
        const maxLevelVol = Math.max(...levels.map(l => (l.buy_vol || 0) + (l.sell_vol || 0)), 0);
        if (maxLevelVol <= 0) return;
        // Якорь — середина диапазона уровней, чтобы createPointFigures получил валидную координату
        const midPrice = (levels[0].price + levels[levels.length - 1].price) / 2;
        const id = chartRef.current.createOverlay({
          name: 'footprintCandle',
          lock: true,
          points: [{ timestamp: candle.timestamp, value: midPrice }],
          extendData: {
            candleTs: candle.timestamp,
            tfMs: 300000,
            levels,
            maxLevelVol,
            stacked: candle.stacked_imbalance || { buy: 0, sell: 0 },
            absorption: Boolean(candle.absorption)
          }
        });
        if (id) activeFootprintOverlays.current.push(id);
      });
    } catch (_) {}
  }, [symbol, showFootprint]);

  // Периодическое обновление футпринта, пока слой включён
  useEffect(() => {
    if (!showFootprint) return;
    loadFootprint();
    const interval = setInterval(loadFootprint, 15000);
    return () => clearInterval(interval);
  }, [showFootprint, loadFootprint]);

  // Load and render TPO/Volume Profile from recorded aggTrades (SRS M1.2a)
  const loadTpoProfile = useCallback(async () => {
    if (!chartRef.current || !showTpo) {
      activeTpoOverlays.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
      activeTpoOverlays.current = [];
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/profile/tpo?symbol=${symbol}`);
      if (!res.ok) return;
      const data = await res.json();

      activeTpoOverlays.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
      activeTpoOverlays.current = [];

      if (!data || data.data_available !== true || !Array.isArray(data.rows) || data.rows.length === 0) return;
      const klines = currentKlines.current;
      if (!klines || klines.length === 0) return;
      const anchorTs = klines[klines.length - 1].timestamp;
      const anchorPrice = data.tpoc_price ?? data.poc_price ?? klines[klines.length - 1].close;

      const id = chartRef.current.createOverlay({
        name: 'tpoProfile',
        lock: true,
        points: [{ timestamp: anchorTs, value: anchorPrice }],
        extendData: {
          rows: data.rows,
          poc_price: data.poc_price,
          tpoc_price: data.tpoc_price,
          tvah_price: data.tvah_price,
          tval_price: data.tval_price
        }
      });
      if (id) activeTpoOverlays.current.push(id);
    } catch (_) {}
  }, [symbol, showTpo]);

  // Render parsed orderbook walls on the chart
  const renderOrderBookWalls = useCallback((bidsRaw, asksRaw) => {
    if (!chartRef.current || !showWalls) {
      activeWallOverlays.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
      activeWallOverlays.current = [];
      return;
    }

    const klines = currentKlines.current;
    if (!klines || klines.length === 0) return;
    const anchorTs = klines[klines.length - 1].timestamp;

    const bids = (bidsRaw || []).map(([p, q]) => {
      const price = parseFloat(p);
      const qty = parseFloat(q);
      return { price, volume_usd: price * qty, side: 'BUY' };
    });

    const asks = (asksRaw || []).map(([p, q]) => {
      const price = parseFloat(p);
      const qty = parseFloat(q);
      return { price, volume_usd: price * qty, side: 'SELL' };
    });

    // Top-3 bids > $1M (fallback >= 400k, then top 2)
    let bigBids = bids.filter(b => b.volume_usd >= 1000000).sort((a, b) => b.volume_usd - a.volume_usd).slice(0, 3);
    if (bigBids.length === 0) {
      bigBids = bids.filter(b => b.volume_usd >= 400000).sort((a, b) => b.volume_usd - a.volume_usd).slice(0, 2);
    }
    if (bigBids.length === 0 && bids.length > 0) {
      bigBids = bids.slice().sort((a, b) => b.volume_usd - a.volume_usd).slice(0, 2);
    }

    // Top-3 asks > $1M (fallback >= 400k, then top 2)
    let bigAsks = asks.filter(a => a.volume_usd >= 1000000).sort((a, b) => b.volume_usd - a.volume_usd).slice(0, 3);
    if (bigAsks.length === 0) {
      bigAsks = asks.filter(a => a.volume_usd >= 400000).sort((a, b) => b.volume_usd - a.volume_usd).slice(0, 2);
    }
    if (bigAsks.length === 0 && asks.length > 0) {
      bigAsks = asks.slice().sort((a, b) => b.volume_usd - a.volume_usd).slice(0, 2);
    }

    const wallBudget = densityMode === 'full' ? 6 : densityMode === 'compact' ? 2 : ((chartContainerRef.current?.clientWidth || 1000) < 900 ? 2 : 4);
    const wallsToRender = [...bigBids.slice(0, wallBudget), ...bigAsks.slice(0, wallBudget)];

    // Remove previous walls
    activeWallOverlays.current.forEach(id => {
      try { chartRef.current.removeOverlay({ id }); } catch (_) {}
    });
    activeWallOverlays.current = [];

    // Render updated walls
    wallsToRender.forEach(w => {
      try {
        const id = chartRef.current.createOverlay({
          name: 'orderbookWall',
          lock: true,
          points: [{ timestamp: anchorTs, value: w.price }],
          extendData: {
            side: w.side,
            volume_usd: w.volume_usd,
            price: w.price
          }
        });
        if (id) activeWallOverlays.current.push(id);
      } catch (_) {}
    });
  }, [showWalls, densityMode]);

  // Load and render OrderBook Densities (> $1M) as crisp horizontal levels on Chart (HTTP fallback)
  const loadOrderBookWalls = useCallback(async () => {
    if (!chartRef.current || !showWalls) {
      activeWallOverlays.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
      activeWallOverlays.current = [];
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/depth?symbol=${symbol}&limit=100`);
      if (!res.ok) return;
      const data = await res.json();
      renderOrderBookWalls(data.bids, data.asks);
    } catch (_) {}
  }, [symbol, showWalls, renderOrderBookWalls]);

  // Live WebSocket Depth20 (@depth20@100ms) stream for real-time OrderBook Walls
  useEffect(() => {
    if (!showWalls) {
      if (depthWsRef.current) {
        try { depthWsRef.current.close(); } catch (_) {}
        depthWsRef.current = null;
      }
      activeWallOverlays.current.forEach(id => {
        try { chartRef.current?.removeOverlay({ id }); } catch (_) {}
      });
      activeWallOverlays.current = [];
      return;
    }

    let isSubCancelled = false;
    let lastRenderTs = 0;
    const cleanSym = symbol.toLowerCase().replace(/[^a-z0-9]/g, '');

    const connectDepthWs = () => {
      try {
        const ws = new WebSocket(`wss://fstream.binance.com/ws/${cleanSym}@depth20@100ms`);
        depthWsRef.current = ws;

        ws.onmessage = (event) => {
          if (isSubCancelled || depthWsRef.current !== ws) return;
          const now = Date.now();
          if (now - lastRenderTs < 350) return; // throttle updates to keep 60fps chart rendering
          lastRenderTs = now;
          try {
            const data = JSON.parse(event.data);
            if (data.b && data.a) {
              renderOrderBookWalls(data.b, data.a);
            }
          } catch (_) {}
        };

        ws.onerror = () => {
          try { ws.close(); } catch (_) {}
        };
      } catch (_) {}
    };

    connectDepthWs();

    // Periodic HTTP fallback
    loadOrderBookWalls();
    const wallTimer = setInterval(loadOrderBookWalls, 3000);

    return () => {
      isSubCancelled = true;
      clearInterval(wallTimer);
      if (depthWsRef.current) {
        try { depthWsRef.current.close(); } catch (_) {}
        depthWsRef.current = null;
      }
    };
  }, [symbol, showWalls, renderOrderBookWalls, loadOrderBookWalls]);

  const toggleVolatilityCone = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('apply-volatility-cone', {
        detail: {
          symbol,
          timeframe,
          toggle: true
        }
      })
    );
  }, [symbol, timeframe]);

  useEffect(() => {
    updateVwapOverlay();
  }, [updateVwapOverlay]);

  // Fetch history candles & subscribe live WebSocket
  useEffect(() => {
    if (!chartRef.current || chartReady === 0) return;
    const chart = chartRef.current;
    let isCancelled = false;

    // Instantly wipe previous coin's candles so old ticker data never lingers
    try {
      chart.clearData();
    } catch (_) {}
    currentKlines.current = [];
    setStatusMsg(`Загрузка свечей ${symbol}...`);
    setErrorDetails(null);

    // Timeframe step in ms (window math for initial deep load and scroll-back)
    const tfMs = TF_MS[timeframe] || 900000;

    const fetchKlines = async () => {
      try {
        // Deep initial window: startTime is always passed (Шаг A);
        // the backend paginates server-side if the window exceeds one request.
        const { candles, source } = await fetchKlinesDualSource({
          symbol,
          timeframe,
          startTime: Date.now() - INITIAL_HISTORY_BARS * tfMs
        });

        if (isCancelled) return;

        if (Array.isArray(candles) && candles.length > 0) {
          currentKlines.current = candles;
          window.__historyOldestTs = candles[0]?.timestamp ?? null;
          window.__historyLoadedBars = candles.length;
          chart.applyNewData(candles, true);
          setStatusMsg("");
          setErrorDetails(null);

          // Restore saved drawings, vwap, liquidations, and heatmap
          loadDrawings();
          updateVwapOverlay(candles);
          loadLiquidations();
          loadHeatmap();
          loadFootprint();
          loadTpoProfile();
          setKlinesVersion((v) => v + 1);
        } else {
          setStatusMsg("Свечи отсутствуют");
        }
      } catch (err) {
        if (isCancelled) return;
        setStatusMsg("Ошибка загрузки");
        setErrorDetails(err.message || String(err));
      }
    };

    fetchKlines();

    // --- Шаг A: бесконечный скролл-назад (chart.loadMore) ----------------------
    // KLineCharts v9 вызывает колбэк с timestamp самой старой загруженной свечи,
    // когда пользователь доскроллил к левому краю. Догружаем более старое окно
    // через пагинированный dual-source конвейер и восстанавливаем вьюпорт,
    // пока не достигнут дневной пол истории или конец данных Binance.
    const floorTs = Date.now() - (HISTORY_FLOOR_DAYS[timeframe] ?? 30) * 86400000;
    let loadingOlder = false;
    let historyExhausted = false;

    try {
      chart.loadMore(async (oldestTs) => {
        if (isCancelled || loadingOlder || historyExhausted) return;
        if (oldestTs == null) return;
        if (oldestTs <= floorTs) { historyExhausted = true; return; }
        loadingOlder = true;
        try {
          const windowEnd = oldestTs - 1;
          const windowStart = Math.max(floorTs, windowEnd - LOAD_MORE_WINDOW_BARS * tfMs);
          const { candles } = await fetchKlinesDualSource({
            symbol,
            timeframe,
            startTime: windowStart,
            endTime: windowEnd
          });
          if (isCancelled) return;
          if (!Array.isArray(candles) || candles.length === 0) {
            historyExhausted = true;
            return;
          }
          // Слияние с ЖИВЫМ списком графика (WS мог дописать новые свечи).
          let existing = [];
          try { existing = chart.getDataList() || []; } catch (_) { existing = []; }
          const seen = new Set(existing.map(c => c && c.timestamp));
          const older = candles.filter(c => c && !seen.has(c.timestamp));
          if (older.length === 0) { historyExhausted = true; return; }
          const merged = [...older, ...existing]
            .filter(c => c && c.timestamp != null)
            .sort((a, b) => a.timestamp - b.timestamp);
          currentKlines.current = merged;
          window.__historyOldestTs = merged[0].timestamp;
          window.__historyLoadedBars = merged.length;
          const moreAvailable = merged[0].timestamp > floorTs;
          let restoreTs = null;
          try {
            const range = chart.getVisibleRange();
            restoreTs = range?.from?.timestamp ?? null;
          } catch (_) {}
          chart.applyNewData(merged, moreAvailable, () => {
            if (restoreTs != null) {
              try { chart.scrollToTimestamp(restoreTs, 0); } catch (_) {}
            }
          });
          setKlinesVersion(v => v + 1);
        } catch (err) {
          console.warn('Deep history window load failed:', err?.message || err);
          historyExhausted = true;
        } finally {
          loadingOlder = false;
        }
      });
    } catch (_) {}

    // Live Binance WebSocket Kline stream with instant connection, failover, and heartbeat fallback
    const binanceInterval = timeframe === '45m' ? '15m' : (timeframe === '6h' ? '1h' : timeframe);
    const cleanSym = symbol.toLowerCase();
    const wsEndpoints = [
      `wss://stream.binance.com:9443/ws/${cleanSym}@kline_${binanceInterval}`,
      `wss://fstream.binance.com/ws/${cleanSym}@kline_${binanceInterval}`
    ];
    let endpointIdx = 0;

    let reconnectTimer = null;
    let heartbeatTimer = null;
    let lastTickTime = Date.now();

    const connectWs = () => {
      if (isCancelled) return;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.onopen = null;
          wsRef.current.onmessage = null;
          wsRef.current.onerror = null;
          wsRef.current.onclose = null;
          wsRef.current.close();
        } catch (_) {}
        wsRef.current = null;
      }

      const activeUrl = wsEndpoints[endpointIdx % wsEndpoints.length];

      try {
        const ws = new WebSocket(activeUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (isCancelled || wsRef.current !== ws) return;
          lastTickTime = Date.now();
        };

        ws.onmessage = (event) => {
          if (isCancelled || wsRef.current !== ws) return;
          try {
            const payload = JSON.parse(event.data);
            const k = payload.k || payload;
            if (!k || !chartRef.current) return;
            lastTickTime = Date.now();

            let barTimestamp = Number(k.t);
            // Custom TF bucket alignment
            if (timeframe === '45m') {
              barTimestamp = Math.floor(barTimestamp / (45 * 60 * 1000)) * (45 * 60 * 1000);
            } else if (timeframe === '6h') {
              barTimestamp = Math.floor(barTimestamp / (6 * 3600 * 1000)) * (6 * 3600 * 1000);
            }

            const openP = parseFloat(k.o);
            const highP = parseFloat(k.h);
            const lowP = parseFloat(k.l);
            const closeP = parseFloat(k.c);
            const vol = parseFloat(k.v);
            const turnover = parseFloat(k.q || (closeP * vol));

            const bar = {
              timestamp: barTimestamp,
              open: openP,
              high: highP,
              low: lowP,
              close: closeP,
              volume: vol,
              turnover: turnover
            };

            // Keep currentKlines in sync with live tick: dynamically expand wicks and body on new highs/lows
            const klines = currentKlines.current;
            if (klines && klines.length > 0) {
              const lastBar = klines[klines.length - 1];
              if (lastBar.timestamp === barTimestamp) {
                bar.open = lastBar.open;
                bar.high = Math.max(lastBar.high, highP, closeP);
                bar.low = Math.min(lastBar.low, lowP, closeP);
                klines[klines.length - 1] = bar;
              } else if (barTimestamp > lastBar.timestamp) {
                klines.push(bar);
                if (klines.length > 500) klines.shift();
              }
            }

            chartRef.current.updateData(bar);
          } catch (e) {
            console.warn("WS candle error:", e);
          }
        };

        ws.onerror = () => {
          try { ws.close(); } catch (_) {}
        };

        ws.onclose = () => {
          if (!isCancelled && wsRef.current === ws) {
            endpointIdx++;
            reconnectTimer = setTimeout(connectWs, 2000);
          }
        };
      } catch (e) {
        if (!isCancelled) {
          endpointIdx++;
          reconnectTimer = setTimeout(connectWs, 2500);
        }
      }
    };

    const handleNetworkOnline = () => {
      if (isCancelled) return;
      connectWs();
      fetchKlines();
    };
    window.addEventListener('online', handleNetworkOnline);

    connectWs();

    // Heartbeat fallback: checks every 3s; if no tick received for > 4.5s, polls REST endpoint
    heartbeatTimer = setInterval(async () => {
      if (isCancelled || !chartRef.current) return;
      if (Date.now() - lastTickTime > 4500) {
        try {
          const r = await fetch(`${API_BASE}/klines?symbol=${symbol}&timeframe=${timeframe}&limit=2`);
          if (r.ok && !isCancelled) {
            const data = await r.json();
            if (Array.isArray(data) && data.length > 0 && chartRef.current) {
              const latest = data[data.length - 1];
              const bar = {
                timestamp: Number(latest.timestamp),
                open: Number(latest.open),
                high: Number(latest.high),
                low: Number(latest.low),
                close: Number(latest.close),
                volume: Number(latest.volume),
                turnover: Number(latest.turnover || (latest.close * latest.volume))
              };
              chartRef.current.updateData(bar);
              lastTickTime = Date.now();
            }
          }
        } catch (_) {}

        if (!wsRef.current || (wsRef.current.readyState !== WebSocket.OPEN && wsRef.current.readyState !== WebSocket.CONNECTING)) {
          endpointIdx++;
          connectWs();
        }
      }
    }, 3000);

    return () => {
      isCancelled = true;
      window.removeEventListener('online', handleNetworkOnline);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (wsRef.current) {
        try {
          wsRef.current.onopen = null;
          wsRef.current.onmessage = null;
          wsRef.current.onerror = null;
          wsRef.current.onclose = null;
          wsRef.current.close();
        } catch (_) {}
        wsRef.current = null;
      }
    };
  }, [symbol, timeframe, chartReady, loadDrawings]);

  // Backtest signals: draw BUY/SELL markers, clear on symbol change / re-run / hide
  const clearBacktestSignals = useCallback(() => {
    if (chartRef.current) {
      btOverlayIds.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
    }
    btOverlayIds.current = [];
    setBtTooltip(null);
  }, []);

  useEffect(() => {
    clearBacktestSignals();
    const chart = chartRef.current;
    const klines = currentKlines.current;
    if (!chart || !effectiveShowBtSignals || !effectiveBacktestSignals) return;
    if (effectiveBacktestSignals.symbol && effectiveBacktestSignals.symbol !== symbol.toUpperCase()) return;
    if (!klines || klines.length === 0) return;

    const firstTs = klines[0].timestamp;
    const lastTs = klines[klines.length - 1].timestamp;
    const barMs = klines.length > 1 ? klines[1].timestamp - klines[0].timestamp : 60000;

    // Snap signal time to the candle that contains it (binary search for last bar <= time)
    const findBar = (t) => {
      if (!t || t < firstTs || t > lastTs + barMs) return null;
      let lo = 0, hi = klines.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (klines[mid].timestamp <= t) lo = mid; else hi = mid - 1;
      }
      return klines[lo];
    };

    const container = chartContainerRef.current;
    let lastBarTs = null;

    const tradesList = Array.isArray(effectiveBacktestSignals.trades) ? effectiveBacktestSignals.trades : [];
    const signalsList = Array.isArray(effectiveBacktestSignals.signals) ? effectiveBacktestSignals.signals : [];

    if (tradesList.length > 0) {
      tradesList.forEach((trade) => {
        const entryBar = findBar(trade.entry_time);
        const exitBar = findBar(trade.exit_time) || entryBar;
        if (!entryBar) return;
        lastBarTs = exitBar ? exitBar.timestamp : entryBar.timestamp;

        try {
          const id = chart.createOverlay({
            name: 'backtestTradeLine',
            lock: true,
            points: [
              { timestamp: entryBar.timestamp, value: Number(trade.entry_price) },
              { timestamp: exitBar.timestamp, value: Number(trade.exit_price) }
            ],
            extendData: trade,
            onMouseEnter: (e) => {
              const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
              const px = (e && e.pageX != null) ? e.pageX - rect.left - window.scrollX : (e?.x || 0);
              const py = (e && e.pageY != null) ? e.pageY - rect.top - window.scrollY : (e?.y || 0);
              setBtTooltip({ x: px, y: py, trade, isTrade: true });
              return true;
            },
            onClick: (e) => {
              const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
              const px = (e && e.pageX != null) ? e.pageX - rect.left - window.scrollX : (e?.x || 0);
              const py = (e && e.pageY != null) ? e.pageY - rect.top - window.scrollY : (e?.y || 0);
              setBtTooltip({ x: px, y: py, trade, isTrade: true });
              return true;
            },
            onMouseLeave: () => { setBtTooltip(null); return true; }
          });
          if (id) btOverlayIds.current.push(id);
        } catch (_) {}
      });
    } else if (signalsList.length > 0) {
      signalsList.forEach((sig) => {
        const bar = findBar(sig.time);
        if (!bar) return;
        lastBarTs = bar.timestamp;
        const isBuy = sig.type === 'BUY';
        try {
          const id = chart.createOverlay({
            name: 'btSignal',
            lock: true,
            points: [{ timestamp: bar.timestamp, value: isBuy ? bar.low : bar.high }],
            extendData: { type: sig.type, price: sig.price },
            onMouseEnter: (e) => {
              const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
              const px = (e && e.pageX != null) ? e.pageX - rect.left - window.scrollX : (e?.x || 0);
              const py = (e && e.pageY != null) ? e.pageY - rect.top - window.scrollY : (e?.y || 0);
              setBtTooltip({ x: px, y: py, sig, isTrade: false });
              return true;
            },
            onClick: (e) => {
              const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
              const px = (e && e.pageX != null) ? e.pageX - rect.left - window.scrollX : (e?.x || 0);
              const py = (e && e.pageY != null) ? e.pageY - rect.top - window.scrollY : (e?.y || 0);
              setBtTooltip({ x: px, y: py, sig, isTrade: false });
              return true;
            },
            onMouseLeave: () => { setBtTooltip(null); return true; }
          });
          if (id) btOverlayIds.current.push(id);
        } catch (_) {}
      });
    }

    // Reveal the newest marker once per new result (not on every redraw)
    if (lastBarTs && lastScrolledResult.current !== effectiveBacktestSignals) {
      lastScrolledResult.current = effectiveBacktestSignals;
      try { chart.scrollToTimestamp(Math.min(lastBarTs + 14 * barMs, lastTs), 200); } catch (_) {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBacktestSignals, effectiveShowBtSignals, symbol, timeframe, klinesVersion, chartReady]);

  useEffect(() => {
    const focusTrade = (event) => {
      const trade = event.detail;
      if (!trade || !chartRef.current || !trade.entry_time) return;
      try { chartRef.current.scrollToTimestamp(trade.entry_time, 180); } catch (_) {}
      setBtTooltip({ x: 24, y: 42, trade, isTrade: true, source: 'backtest' });
    };
    window.addEventListener('focus-backtest-trade', focusTrade);
    return () => window.removeEventListener('focus-backtest-trade', focusTrade);
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const klines = currentKlines.current;
    paperOverlayIds.current.forEach((id) => { try { chart?.removeOverlay({ id }); } catch (_) {} });
    paperOverlayIds.current = [];
    if (!chart || !klines?.length || !paperTrades.length) return;

    const firstTs = klines[0].timestamp;
    const lastTs = klines[klines.length - 1].timestamp;
    const nearestBar = (timestamp) => {
      if (!timestamp || timestamp < firstTs || timestamp > lastTs) return null;
      return klines.reduce((nearest, bar) => (
        Math.abs(bar.timestamp - timestamp) < Math.abs(nearest.timestamp - timestamp) ? bar : nearest
      ), klines[0]);
    };
    const container = chartContainerRef.current;
    paperTrades.forEach((rawTrade) => {
      const entryBar = nearestBar(rawTrade.entry_ts);
      const exitBar = nearestBar(rawTrade.exit_ts) || entryBar;
      if (!entryBar || !exitBar) return;
      const trade = {
        ...rawTrade,
        id: rawTrade.order_id || `paper-${rawTrade.entry_ts}`,
        direction: rawTrade.side,
        entry_time: rawTrade.entry_ts,
        exit_time: rawTrade.exit_ts,
        pnl_usd: rawTrade.net_pnl,
        pnl_pct: rawTrade.pnl_percent,
        fee_paid_usd: rawTrade.fee_drag,
        reason: rawTrade.entry_reason || rawTrade.reason,
      };
      try {
        const id = chart.createOverlay({
          name: 'backtestTradeLine',
          lock: true,
          points: [
            { timestamp: entryBar.timestamp, value: Number(rawTrade.entry_price) },
            { timestamp: exitBar.timestamp, value: Number(rawTrade.exit_price) },
          ],
          extendData: { ...trade, source: 'paper', entry_price: rawTrade.entry_price, exit_price: rawTrade.exit_price },
          onMouseEnter: (event) => {
            const rect = container?.getBoundingClientRect() || { left: 0, top: 0 };
            setBtTooltip({ x: (event?.pageX ?? event?.x ?? 0) - rect.left - window.scrollX, y: (event?.pageY ?? event?.y ?? 0) - rect.top - window.scrollY, trade, isTrade: true, source: 'paper' });
            return true;
          },
          onClick: (event) => {
            const rect = container?.getBoundingClientRect() || { left: 0, top: 0 };
            setBtTooltip({ x: (event?.pageX ?? event?.x ?? 0) - rect.left - window.scrollX, y: (event?.pageY ?? event?.y ?? 0) - rect.top - window.scrollY, trade, isTrade: true, source: 'paper' });
            return true;
          },
          onMouseLeave: () => { setBtTooltip(null); return true; },
        });
        if (id) paperOverlayIds.current.push(id);
      } catch (_) {}
    });
    return () => {
      paperOverlayIds.current.forEach((id) => { try { chart.removeOverlay({ id }); } catch (_) {} });
      paperOverlayIds.current = [];
    };
  }, [paperTrades, symbol, klinesVersion, chartReady]);

  // Real-time algorithmic signal overlay at the live edge of the chart (Requirement 3)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || chartReady === 0) return;

    clearLiveSignals(chart, liveSignalOverlayIds.current);
    liveSignalOverlayIds.current = [];

    if (!showLiveSignals || !Array.isArray(liveSignals) || liveSignals.length === 0) {
      return;
    }

    const ids = renderLiveSignals(chart, liveSignals, symbol);
    liveSignalOverlayIds.current = ids;

    return () => {
      if (chartRef.current) {
        clearLiveSignals(chartRef.current, liveSignalOverlayIds.current);
        liveSignalOverlayIds.current = [];
      }
    };
  }, [liveSignals, showLiveSignals, symbol, chartReady]);

  // Real-time Whale Trade (large orders >= $500k) floating annotations on chart
  const whaleOverlayIds = useRef([]);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || chartReady === 0) return;

    clearWhaleTrades(chart, whaleOverlayIds.current);
    whaleOverlayIds.current = [];

    const unsub = useTradesStore.getState().addTradeListener((trade) => {
      if (trade.symbol === symbol.toUpperCase() && trade.usd >= 500000) {
        try {
          const ids = renderWhaleTrades(chart, [trade], symbol);
          if (ids && ids.length > 0) {
            whaleOverlayIds.current.push(...ids);
            if (whaleOverlayIds.current.length > 40) {
              const oldId = whaleOverlayIds.current.shift();
              clearWhaleTrades(chart, [oldId]);
            }
          }
        } catch (_) {}
      }
    });

    return () => {
      unsub();
      if (chartRef.current) {
        clearWhaleTrades(chartRef.current, whaleOverlayIds.current);
        whaleOverlayIds.current = [];
      }
    };
  }, [symbol, chartReady]);

  // Listen for custom position setup projection events
  useEffect(() => {
    const onPositionSetup = (ev) => {
      if (ev.detail?.setup) {
        setLocalPositionSetup(ev.detail.setup);
      }
    };
    window.addEventListener('apply-position-setup', onPositionSetup);
    return () => window.removeEventListener('apply-position-setup', onPositionSetup);
  }, []);

  const effectivePositionSetup = activePositionSetup || localPositionSetup;

  // Render full Position Setup Box (Entry / SL / TP1 / TP2 + Risk/Reward Shaded Zones)
  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;
    const klines = currentKlines.current;

    if (activePositionOverlayId.current) {
      try { chart.removeOverlay({ id: activePositionOverlayId.current }); } catch (_) {}
      activePositionOverlayId.current = null;
    }

    if (!effectivePositionSetup || !klines || klines.length === 0) {
      window.__chartActiveSetup = null;
      return;
    }

    const klen = klines.length;
    const anchorTs = klines[klen - 1].timestamp;
    const startTs = klines[Math.max(0, klen - 30)].timestamp;

    const entryP = Number(effectivePositionSetup.entry_price);
    const tpP = Number(effectivePositionSetup.tp1_price || effectivePositionSetup.tp2_price || (entryP * 1.015));
    const slP = Number(effectivePositionSetup.sl_price || (entryP * 0.99));

    try {
      const id = chart.createOverlay({
        name: 'positionSetupBox',
        lock: false,
        points: [
          { timestamp: startTs, value: entryP },
          { timestamp: anchorTs, value: tpP },
          { timestamp: anchorTs, value: slP }
        ],
        extendData: {
          ...effectivePositionSetup,
          entry_price: entryP,
          tp1_price: tpP,
          sl_price: slP
        }
      });
      if (id) activePositionOverlayId.current = id;
      const initialSetup = {
        overlayId: id,
        ...effectivePositionSetup,
        entry_price: entryP,
        tp1_price: tpP,
        sl_price: slP
      };
      window.__chartActiveSetup = initialSetup;
      useTradeOverlayStore.getState().setTransientSetup(initialSetup);
    } catch (_) {}
  }, [effectivePositionSetup, symbol, timeframe, klinesVersion, chartReady]);

  // Strategy Key Entry Levels (Semi-transparent Zones with Badges: BUY ZONE: Wall $1.2M / SHORT: Delta Div)
  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;
    const klines = currentKlines.current;

    activeStrategyLevelOverlays.current.forEach(id => {
      try { chart.removeOverlay({ id }); } catch (_) {}
    });
    activeStrategyLevelOverlays.current = [];

    if (!Array.isArray(strategyLevels) || strategyLevels.length === 0 || !klines || klines.length === 0) {
      return;
    }

    const anchorTs = klines[klines.length - 1].timestamp;

    strategyLevels.forEach(lvl => {
      const p = Number(lvl.price);
      if (!p || !Number.isFinite(p)) return;
      try {
        const id = chart.createOverlay({
          name: 'strategyLevelZone',
          lock: true,
          points: [{ timestamp: anchorTs, value: p }],
          extendData: {
            type: lvl.type || 'BUY',
            role: lvl.role || '',
            label: lvl.label || (lvl.type === 'BUY' ? 'BUY ZONE: Wall $1.2M' : 'SHORT: Delta Div'),
            price: p
          }
        });
        if (id) activeStrategyLevelOverlays.current.push(id);
      } catch (_) {}
    });
  }, [strategyLevels, symbol, timeframe, klinesVersion, chartReady]);

  // Drawing tool selection with style memory and SMC templates
  const handleSelectTool = (toolName, customStyles = null) => {
    if (!chartRef.current) return;
    if (activeTool === toolName && !customStyles) {
      cancelActiveDrawing();
      return;
    }
    // Cancel any previous incomplete drawing overlay
    if (activeDrawingOverlayId.current) {
      try {
        chartRef.current.removeOverlay({ id: activeDrawingOverlayId.current });
      } catch (_) {}
      trackedOverlays.current.delete(activeDrawingOverlayId.current);
      drawingHistory.current = drawingHistory.current.filter(id => id !== activeDrawingOverlayId.current);
      activeDrawingOverlayId.current = null;
    }

    setActiveTool(toolName);

    const remembered = getStyleMemory(toolName);
    const effectiveStyles = customStyles || {
      line: {
        color: remembered.strokeColor || activeDrawingStyle.strokeColor || '#38bdf8',
        size: remembered.lineWidth || activeDrawingStyle.lineWidth || 2,
        style: remembered.lineStyle || 'solid'
      },
      polygon: {
        color: remembered.fillColor || activeDrawingStyle.fillColor || 'rgba(56, 189, 248, 0.18)',
        borderColor: remembered.strokeColor || activeDrawingStyle.strokeColor || '#38bdf8',
        borderSize: remembered.lineWidth || activeDrawingStyle.lineWidth || 2
      }
    };

    const overlayId = chartRef.current.createOverlay({
      name: toolName,
      lock: false,
      mode: magnetEnabled ? 'strong_magnet' : 'normal',
      styles: effectiveStyles,
      onDrawEnd: (e) => {
        setActiveTool(null);
        activeDrawingOverlayId.current = null;
        if (e && e.overlay) {
          if (e.overlay.name === 'positionSetupBox' && e.overlay.points?.length >= 3) {
            const entryP = Number(e.overlay.points[0]?.value);
            const tpP = Number(e.overlay.points[1]?.value);
            const slP = Number(e.overlay.points[2]?.value);
            const metrics = calculatePositionMetrics({ entryPrice: entryP, tpPrice: tpP, slPrice: slP });
            if (metrics) {
              e.overlay.extendData = { ...e.overlay.extendData, ...metrics };
              useTradeOverlayStore.getState().setTransientSetup(metrics);
              window.__chartActiveSetup = { overlayId: e.overlay.id, ...metrics };
            }
          }
          trackedOverlays.current.set(e.overlay.id, {
            name: e.overlay.name,
            points: e.overlay.points,
            styles: e.overlay.styles
          });
          if (!drawingHistory.current.includes(e.overlay.id)) {
            drawingHistory.current.push(e.overlay.id);
          }
        }
        setTimeout(() => {
          saveDrawings();
        }, 50);
        return true;
      },
      onSelected: (e) => {
        selectedOverlayId.current = e.overlay.id;
        return true;
      },
      onDeselected: () => {
        selectedOverlayId.current = null;
        return true;
      }
    });
    activeDrawingOverlayId.current = overlayId;
  };

  const applyTemplate = (tmpl) => {
    if (!tmpl || !chartRef.current) return;
    setIsTemplateMenuOpen(false);
    if (tmpl.styles?.line?.color || tmpl.styles?.polygon?.borderColor) {
      const color = tmpl.styles?.line?.color || tmpl.styles?.polygon?.borderColor;
      const size = tmpl.styles?.line?.size || tmpl.styles?.polygon?.borderSize || 2;
      const fill = tmpl.styles?.polygon?.color || `${color}25`;
      const nextStyle = { strokeColor: color, lineWidth: size, fillColor: fill };
      setActiveDrawingStyle(nextStyle);
      saveStyleMemory(tmpl.tool, nextStyle);
    }
    handleSelectTool(tmpl.tool, tmpl.styles);
  };

  const updateStyle = (changes) => {
    const next = { ...activeDrawingStyle, ...changes };
    setActiveDrawingStyle(next);
    saveStyleMemory(activeTool || 'default', next);
    if (selectedOverlayId.current && chartRef.current) {
      try {
        const overlayData = trackedOverlays.current.get(selectedOverlayId.current);
        const newOverlayStyles = {
          line: {
            color: next.strokeColor,
            size: next.lineWidth
          },
          polygon: {
            color: next.fillColor || `${next.strokeColor}25`,
            borderColor: next.strokeColor,
            borderSize: next.lineWidth
          }
        };
        chartRef.current.overrideOverlay({
          id: selectedOverlayId.current,
          styles: newOverlayStyles
        });
        if (overlayData) {
          overlayData.styles = newOverlayStyles;
        }
      } catch (_) {}
    }
  };

  const handleSaveCurrentAsTemplate = () => {
    if (!newTemplateName.trim()) return;
    const tool = activeTool || 'straightLine';
    const styles = {
      line: {
        color: activeDrawingStyle.strokeColor,
        size: activeDrawingStyle.lineWidth
      },
      polygon: {
        color: activeDrawingStyle.fillColor,
        borderColor: activeDrawingStyle.strokeColor,
        borderSize: activeDrawingStyle.lineWidth
      }
    };
    const created = saveCustomTemplate({ name: newTemplateName.trim(), tool, styles });
    if (created) {
      setDrawingTemplates(getAllTemplates());
      setStatusMsg(`Шаблон "${newTemplateName}" сохранен`);
      setTimeout(() => setStatusMsg(""), 1500);
    }
    setShowSaveTemplateModal(false);
    setNewTemplateName('');
  };

  const handleClearDrawings = () => {
    if (!chartRef.current) return;
    for (const id of trackedOverlays.current.keys()) {
      try {
        chartRef.current.removeOverlay({ id });
      } catch (_) {}
    }
    trackedOverlays.current.clear();
    drawingHistory.current = [];
    selectedOverlayId.current = null;
    setActiveTool(null);
    saveDrawings();
    setStatusMsg("Разметка очищена");
    setTimeout(() => setStatusMsg(""), 1200);
  };

  // Toggle indicator helper (synced with activeIndicators registry)
  const toggleIndicator = (name) => {
    if (name === 'vwap') {
      const nextVwap = !showVwap;
      setShowVwap(nextVwap);
      localStorage.setItem('chart_vwap', nextVwap ? 'true' : 'false');
      if (!nextVwap && vwapLineOverlay.current) {
        try { chartRef.current?.removeOverlay({ id: vwapLineOverlay.current }); } catch (_) {}
        vwapLineOverlay.current = null;
      } else {
        updateVwapOverlay();
      }
      return;
    }

    const indId = name.toLowerCase();
    const existing = activeIndicators.find((i) => i.id === indId);
    if (existing) {
      handleToggleVisibility(indId);
    } else {
      handleAddIndicator(indId);
    }
  };

  // Right-Click Context Menu handler (Task 6 & ТАКТ 3) — в chart/ChartContextMenu.jsx (useChartContextMenu)

  return (
    <div
      style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-subtle)', color: 'var(--text-main)' }}
      className="flex flex-col h-full w-full select-none border overflow-hidden relative font-sans"
    >
      {/* Top Drawing & Indicator Bar (Tealstreet/Tiger style: ultra compact, flat, responsive) */}
      <ChartToolbar
        titlePrefix={titlePrefix}
        timeframe={timeframe}
        onTimeframeChange={onTimeframeChange}
        onCloseWidget={onCloseWidget}
        chartId={chartId}
        activeTool={activeTool}
        cancelActiveDrawing={cancelActiveDrawing}
        handleSelectTool={handleSelectTool}
        magnetEnabled={magnetEnabled}
        setMagnetEnabled={setMagnetEnabled}
        handleUndo={handleUndo}
        handleClearDrawings={handleClearDrawings}
        saveDrawings={saveDrawings}
        isTemplateMenuOpen={isTemplateMenuOpen}
        setIsTemplateMenuOpen={setIsTemplateMenuOpen}
        setShowSaveTemplateModal={setShowSaveTemplateModal}
        drawingTemplates={drawingTemplates}
        applyTemplate={applyTemplate}
        updateStyle={updateStyle}
        activeDrawingStyle={activeDrawingStyle}
        statusMsg={statusMsg}
        handleAskSecondOpinion={handleAskSecondOpinion}
        isAskingOpinion={isAskingOpinion}
        setIsCatalogOpen={setIsCatalogOpen}
        activeIndicators={activeIndicators}
        toggleLiveSignals={toggleLiveSignals}
        showLiveSignals={showLiveSignals}
        showHeatmap={showHeatmap}
        setShowHeatmap={setShowHeatmap}
        loadHeatmap={loadHeatmap}
        showFootprint={showFootprint}
        setShowFootprint={setShowFootprint}
        showTpo={showTpo}
        setShowTpo={setShowTpo}
        showLiquidations={showLiquidations}
        setShowLiquidations={setShowLiquidations}
        showWalls={showWalls}
        setShowWalls={setShowWalls}
        densityMode={densityMode}
        setDensityMode={setDensityMode}
        toggleVolatilityCone={toggleVolatilityCone}
        isConeActive={isConeActive}
        toggleIndicator={toggleIndicator}
        showVwap={showVwap}
      />

      {/* Chart Canvas Area */}
      <div 
        className={`flex-1 w-full h-full relative select-none ${
          activeTool ? 'cursor-crosshair' : isMouseDown ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        onContextMenu={handleContextMenu}
        onMouseDown={(e) => {
          if (e.button === 0 && !activeTool) {
            setIsMouseDown(true);
          }
        }}
        onMouseUp={() => setIsMouseDown(false)}
        onMouseLeave={() => setIsMouseDown(false)}
      >
        <div
          ref={chartContainerRef}
          className="w-full h-full"
          style={{
            cursor: activeTool ? 'crosshair' : isMouseDown ? 'grabbing' : 'grab'
          }}
        />

        {/* Непрерывная WebGL-heatmap плотностей стакана (задача 4.5) */}
        <DepthHeatmapGL chart={chartInstance} points={densityPoints} active={showHeatmap && Boolean(chartInstance)} />

        {/* Tactical Assistant HUD: Floating Predictive & Market Regime Overlay (Stage 5) */}
        <AssistantHUD
          symbol={symbol}
          timeframe={timeframe}
          lastPrice={currentKlines.current?.length ? currentKlines.current[currentKlines.current.length - 1].close : 0}
          showWalls={showWalls}
          onToggleWalls={() => {
            const next = !showWalls;
            setShowWalls(next);
            localStorage.setItem('chart_walls', next ? 'true' : 'false');
          }}
          isConeActive={isConeActive}
          onToggleCone={toggleVolatilityCone}
        />

        {/* Market Regime: Toxic Volatility Warning Overlay */}
        {isToxicRegime && !isToxicDismissed && (
          <div
            data-testid="toxic-volatility-overlay"
            className="absolute inset-x-4 top-3 z-30 flex items-center justify-between p-3 rounded-lg bg-rose-950/85 border border-rose-500/50 backdrop-blur-xs text-rose-200 shadow-2xl animate-pulse select-none font-mono"
          >
            <div className="flex items-center space-x-2.5">
              <AlertTriangle className="text-rose-400 shrink-0" size={18} />
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-rose-300">
                  Рыночный режим изменен: Токсичная ликвидность. Торги приостановлены
                </div>
                <div className="text-[10px] text-rose-200/80">
                  Высокая волатильность при разреженном стакане (ATR% &gt; 1.8%, плотность &lt; 0.6). Входы в сделки заблокированы ядром.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsToxicDismissed(true)}
              className="p-1 rounded hover:bg-rose-900/60 text-rose-300 hover:text-white transition cursor-pointer"
              title="Скрыть предупреждение"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* ТАКТ 2.1: Interactive Position Setup HUD Overlay (Entry / SL / TP1 / TP2 / R:R) */}
        {effectivePositionSetup && Number(effectivePositionSetup.entry_price) > 0 && (
          <div
            data-testid="chart-position-hud"
            className="absolute top-2.5 left-3 z-20 pointer-events-auto flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#0a0e17]/90 border border-[#2563eb70] shadow-xl backdrop-blur-xs font-mono text-[10px]"
          >
            <span
              data-testid="chart-badge-entry"
              className="px-1.5 py-0.5 rounded bg-[#2563eb] text-white font-bold border border-[#60a5fa80]"
            >
              [{effectivePositionSetup.order_type || (effectivePositionSetup.direction === 'SHORT' ? 'SELL LIMIT' : 'BUY LIMIT')} @ {Number(effectivePositionSetup.entry_price).toFixed(Number(effectivePositionSetup.entry_price) >= 1000 ? 1 : 2)}]
            </span>

            <span
              data-testid="chart-badge-sl"
              className="px-1.5 py-0.5 rounded bg-[#dc2626] text-white font-bold border border-[#fca5a580]"
            >
              [SL @ {Number(effectivePositionSetup.sl_price).toFixed(Number(effectivePositionSetup.sl_price) >= 1000 ? 1 : 2)} ({Number(effectivePositionSetup.sl_pct ?? -0.28).toFixed(2)}% | -${Math.round(Number(effectivePositionSetup.sl_risk_usd ?? 50))})]
            </span>

            <span
              data-testid="chart-badge-tp1"
              className="px-1.5 py-0.5 rounded bg-[#059669] text-white font-bold border border-[#6ee7b780]"
            >
              [TP1 @ {Number(effectivePositionSetup.tp1_price).toFixed(Number(effectivePositionSetup.tp1_price) >= 1000 ? 1 : 2)} (+{Number(effectivePositionSetup.tp1_pct ?? 0.43).toFixed(2)}%)]
            </span>

            {effectivePositionSetup.tp2_price && (
              <span
                data-testid="chart-badge-tp2"
                className="px-1.5 py-0.5 rounded bg-[#047857] text-white font-bold border border-[#34d39980]"
              >
                [TP2 @ {Number(effectivePositionSetup.tp2_price).toFixed(Number(effectivePositionSetup.tp2_price) >= 1000 ? 1 : 2)} (+{Number(effectivePositionSetup.tp2_pct ?? 0.92).toFixed(2)}%)]
              </span>
            )}

            <span
              data-testid="chart-badge-rr"
              className="px-1.5 py-0.5 rounded bg-[#1e293b] text-[#38bdf8] font-bold border border-[#38bdf860]"
            >
              R:R {effectivePositionSetup.rr_label || `1:${Number(effectivePositionSetup.rr_ratio || 2.8).toFixed(1)}`}
            </span>

            {/* Quick 1-Click Backtest Button for current setup */}
            <button
              type="button"
              data-testid="btn-quick-backtest-setup"
              onClick={handleQuickBacktestCurrentSetup}
              disabled={isBacktesting}
              className="px-2 py-0.5 rounded bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-bold flex items-center space-x-1 transition cursor-pointer shadow-sm text-[9.5px]"
              title="Проверить этот сетап (Entry / TP / SL) на реальной истории Binance с комиссиями"
            >
              {isBacktesting ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} className="text-yellow-300" />}
              <span>{isBacktesting ? 'Расчет...' : 'Тест сетапа'}</span>
            </button>

            {/* Stage 2: Consultative AI Second Opinion Button right next to Risk/Reward setup */}
            <button
              type="button"
              data-testid="btn-ask-second-opinion"
              onClick={handleAskSecondOpinion}
              disabled={isAskingOpinion}
              className="px-2 py-0.5 rounded bg-[#6b21a8] hover:bg-[#7e22ce] text-white font-bold flex items-center space-x-1 transition cursor-pointer shadow-sm text-[9.5px] border border-[#c084fc80]"
              title="Консультативное второе мнение AI по этой позиции (только факты рынка, решение за вами)"
            >
              <span>🧠</span>
              <span>{isAskingOpinion ? 'Запрос AI...' : 'Спросить мнение по этой позиции'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setLocalPositionSetup(null);
                window.dispatchEvent(new CustomEvent('clear-position-setup'));
              }}
              className="ml-0.5 text-[#94a3b8] hover:text-white px-1 cursor-pointer"
              title="Скрыть разметку позиции"
            >
              ✕
            </button>
          </div>
        )}

        {/* Stage 2: Consultative Second Opinion Non-Blocking Overlay Card */}
        {secondOpinionData && (
          <div
            data-testid="second-opinion-card"
            className="absolute top-12 left-3 z-30 pointer-events-auto w-[390px] max-w-[92%] rounded-lg bg-[#0d121d]/95 border border-[#a855f770] shadow-2xl p-3 font-mono text-[10.5px] text-[#e2e8f0] backdrop-blur-md"
          >
            <div className="flex items-center justify-between border-b border-[#1e293b] pb-1.5 mb-2">
              <div className="flex items-center space-x-1.5">
                <span>🧠</span>
                <span className="font-bold text-white">Второе мнение AI ({secondOpinionData.context?.symbol || symbol} {secondOpinionData.context?.timeframe || timeframe})</span>
              </div>
              <button
                type="button"
                data-testid="btn-close-second-opinion"
                onClick={() => setSecondOpinionData(null)}
                className="text-[#94a3b8] hover:text-white px-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Verdict & 1 Reason */}
            <div className="mb-2">
              <div className="flex items-center space-x-2 mb-1">
                <span
                  data-testid="second-opinion-verdict"
                  className={`px-2 py-0.5 rounded font-bold text-[10.5px] ${
                    secondOpinionData.verdict === 'ЗА'
                      ? 'bg-[#059669]/30 text-[#34d399] border border-[#34d39960]'
                      : secondOpinionData.verdict === 'ПРОТИВ'
                      ? 'bg-[#dc2626]/30 text-[#f87171] border border-[#f8717160]'
                      : !secondOpinionData.ai_available
                      ? 'bg-[#d97706]/30 text-[#fbbf24] border border-[#fbbf2460]'
                      : 'bg-[#334155]/50 text-[#cbd5e1] border border-[#64748b60]'
                  }`}
                >
                  {secondOpinionData.verdict}
                </span>
                {!secondOpinionData.ai_available && (
                  <span className="text-[9.5px] text-[#fbbf24]">Принимай решение сам по фактам ниже</span>
                )}
              </div>
              <div
                data-testid="second-opinion-reason"
                className="text-[11px] text-white bg-[#131b2e] border border-[#1e293b] rounded p-2 leading-snug"
              >
                {secondOpinionData.reason}
              </div>
              {secondOpinionData.model_used && (
                <div className="flex items-center justify-between text-[8.5px] text-[#94a3b8] mt-1 px-1">
                  <span>Модель: <span className="text-white font-mono">{secondOpinionData.model_used}</span></span>
                  {secondOpinionData.fallback ? (
                    <span className="text-amber-400 font-bold bg-amber-500/10 px-1 rounded border border-amber-500/30">[Fallback]</span>
                  ) : (
                    <span className="text-emerald-400 font-bold bg-emerald-500/10 px-1 rounded border border-emerald-500/30">[Primary]</span>
                  )}
                </div>
              )}
            </div>

            {/* Factual Market Snapshot Passed */}
            {secondOpinionData.context && (
              <div className="grid grid-cols-2 gap-1 text-[9.5px] text-[#94a3b8] bg-[#090d16] p-2 rounded border border-[#1e293b] mb-2">
                <div>Тренд: <span className="text-white">{secondOpinionData.context.trend || '—'}</span></div>
                <div>Дельта CVD: <span className="text-white">{secondOpinionData.context.cvd_bias || '—'}</span></div>
                <div>OI (24ч): <span className="text-white">{secondOpinionData.context.oi_change_24h_pct ?? 0}%</span></div>
                <div>
                  Ист. EV: <span className="text-white">${secondOpinionData.context.historical_ev_usd ?? 0} ({secondOpinionData.context.historical_trades_count ?? 0} сд.)</span>
                </div>
              </div>
            )}

            {/* Trader's Final Decision Recording */}
            <div className="flex items-center justify-between pt-1 border-t border-[#1e293b]">
              <span className="text-[9.5px] text-[#94a3b8]">
                {secondOpinionData.log?.user_decision && secondOpinionData.log.user_decision !== 'PENDING'
                  ? `В журнале: ${secondOpinionData.log.user_decision}`
                  : 'Записать моё решение в журнал:'}
              </span>
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  data-testid="btn-opinion-mark-entered"
                  onClick={() => handleDecisionFromOpinion('ENTERED')}
                  className={`px-2 py-0.5 rounded text-[9.5px] font-bold cursor-pointer border ${
                    secondOpinionData.log?.user_decision === 'ENTERED'
                      ? 'bg-[#059669] text-white border-[#34d399]'
                      : 'bg-[#059669]/20 text-[#34d399] border-[#059669]/50 hover:bg-[#059669]/40'
                  }`}
                >
                  ✅ Вошёл
                </button>
                <button
                  type="button"
                  data-testid="btn-opinion-mark-skipped"
                  onClick={() => handleDecisionFromOpinion('SKIPPED')}
                  className={`px-2 py-0.5 rounded text-[9.5px] font-bold cursor-pointer border ${
                    secondOpinionData.log?.user_decision === 'SKIPPED'
                      ? 'bg-[#475569] text-white border-[#94a3b8]'
                      : 'bg-[#1e293b] text-[#cbd5e1] border-[#334155] hover:bg-[#334155]'
                  }`}
                >
                  ⏭ Пропустил
                </button>
                <button
                  type="button"
                  data-testid="btn-opinion-mark-exited"
                  onClick={() => handleDecisionFromOpinion('EXITED')}
                  className={`px-2 py-0.5 rounded text-[9.5px] font-bold cursor-pointer border ${
                    secondOpinionData.log?.user_decision === 'EXITED'
                      ? 'bg-[#d97706] text-white border-[#fbbf24]'
                      : 'bg-[#d97706]/20 text-[#fbbf24] border-[#d97706]/50 hover:bg-[#d97706]/40'
                  }`}
                >
                  🏁 Вышел
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Backtest marker & trade tooltip: detailed financial metrics */}
        {btTooltip && (
          <div
            className="absolute z-30 pointer-events-none px-2.5 py-1.5 rounded border text-[10px] font-mono bg-[#0c1017f0] backdrop-blur-md shadow-2xl min-w-[190px]"
            style={{
              left: Math.min(btTooltip.x + 12, (chartContainerRef.current?.clientWidth || 600) - 210),
              top: Math.max(btTooltip.y - 70, 8),
              borderColor: (btTooltip.isTrade ? (btTooltip.trade.pnl_usd >= 0) : ((btTooltip.sig?.pnl_pct ?? 0) >= 0)) ? '#10b981' : '#ef4444'
            }}
          >
            {btTooltip.isTrade ? (
              <>
                <div className="flex items-center justify-between border-b border-[#1f293d] pb-1 mb-1">
                  <span className={btTooltip.trade.direction === 'LONG' || btTooltip.trade.type === 'BUY' ? 'text-[#34d399] font-bold' : 'text-[#f87171] font-bold'}>
                    {btTooltip.source === 'paper' ? 'PAPER' : 'BACKTEST'} · #{btTooltip.trade.id} · {btTooltip.trade.direction || btTooltip.trade.type}
                  </span>
                  <span className="text-[#94a3b8] text-[9px]">{btTooltip.trade.regime || 'Regime: No data'}</span>
                </div>
                <div className="text-[#cbd5e1] text-[9.5px] leading-tight">
                  <div>Вход: <span className="text-white">${btTooltip.trade.entry_price}</span> → Выход: <span className="text-white">${btTooltip.trade.exit_price}</span></div>
                  <div>Entry: <span className="text-white">{Array.isArray(btTooltip.trade.entry_reason || btTooltip.trade.reason) ? (btTooltip.trade.entry_reason || btTooltip.trade.reason).join(' · ') : (btTooltip.trade.entry_reason || btTooltip.trade.reason || 'No data')}</span></div>
                  <div>Exit: <span className="text-white">{btTooltip.trade.exit_reason || 'No data'}</span></div>
                </div>
                <div className={`font-bold mt-1 text-[11px] ${(btTooltip.trade.pnl_usd ?? 0) >= 0 ? 'text-[#34d399]' : 'text-[#f87171]'}`}>
                  Чистый PnL: {(btTooltip.trade.pnl_usd ?? 0) >= 0 ? '+' : ''}${btTooltip.trade.pnl_usd} ({(btTooltip.trade.pnl_pct ?? 0) >= 0 ? '+' : ''}{btTooltip.trade.pnl_pct}%)
                </div>
                <div className="text-[8.5px] text-[#64748b] mt-0.5 flex justify-between">
                  <span>Gross: {btTooltip.trade.gross_pnl_usd ?? 'No data'}</span>
                  <span>Комиссия: -${Number(btTooltip.trade.fee_paid_usd || 0).toFixed(2)}</span>
                  <span>Слиппейдж: -${Number(btTooltip.trade.slippage_cost_usd || 0).toFixed(2)}</span>
                </div>
                <div className="text-[8.5px] text-[#94a3b8] mt-0.5 flex justify-between">
                  <span>MFE: +{Number(btTooltip.trade.mfe || 0).toFixed(2)}%</span>
                  <span>MAE: {Number(btTooltip.trade.mae || 0).toFixed(2)}%</span>
                  <span>Fee Drag: {btTooltip.trade.fee_drag_pct != null ? `${Number(btTooltip.trade.fee_drag_pct).toFixed(2)}%` : 'No data'}</span>
                </div>
              </>
            ) : (
              <>
                <div className={btTooltip.sig.type === 'BUY' ? 'text-[#26a69a] font-bold' : 'text-[#ef5350] font-bold'}>
                  {btTooltip.sig.label} @ {btTooltip.sig.price}
                </div>
                <div className="text-[#d1d4dc]">Причина: {btTooltip.sig.reason || '—'}</div>
                <div className={(btTooltip.sig.pnl_pct ?? 0) >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}>
                  PnL: {(btTooltip.sig.pnl_pct ?? 0) >= 0 ? '+' : ''}{btTooltip.sig.pnl_pct}% (${btTooltip.sig.pnl_usd})
                </div>
              </>
            )}
          </div>
        )}


        {/* Right-Click Context Menu + Level Inspector (ТАКТ 3) — chart/ChartContextMenu.jsx */}
        <ChartContextMenu
          contextMenu={contextMenu}
          setContextMenu={setContextMenu}
          levelInspectorData={levelInspectorData}
          setLevelInspectorData={setLevelInspectorData}
          handleResetScale={handleResetScale}
          handleInspectLevel={handleInspectLevel}
          handleClearDrawings={handleClearDrawings}
          magnetEnabled={magnetEnabled}
          setMagnetEnabled={setMagnetEnabled}
          toggleIndicator={toggleIndicator}
          activeIndicators={activeIndicators}
        />


        {errorDetails && (
          <div className="absolute top-3 left-3 bg-[#181014] border border-[#ef535040] text-[#ef5350] px-3 py-2 rounded text-xs max-w-md shadow-xl backdrop-blur-md z-30">
            <div className="flex items-center justify-between font-bold mb-1">
              <span>Ошибка подключения Binance Futures</span>
              <button onClick={() => setErrorDetails(null)} className="text-[#848e9c] hover:text-white">
                <X size={12} />
              </button>
            </div>
            <div className="font-mono text-[10px] break-words opacity-90">{errorDetails}</div>
          </div>
        )}

        {/* Save Custom Template Modal */}
        {showSaveTemplateModal && (
          <div 
            data-testid="modal-save-template"
            className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 font-sans"
          >
            <div className="bg-[#0f1420] border border-[#253248] rounded-lg p-4 w-80 shadow-2xl font-mono text-xs text-[#d1d4dc]">
              <div className="flex items-center justify-between mb-3 border-b border-[#1f2738] pb-2">
                <span className="font-bold text-white text-sm">Сохранить как шаблон SMC</span>
                <button 
                  type="button"
                  onClick={() => setShowSaveTemplateModal(false)} 
                  className="text-[#64748b] hover:text-white cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="mb-3">
                <label className="text-[10px] text-[#94a3b8] block mb-1">Название шаблона:</label>
                <input
                  data-testid="input-template-name"
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="например, Мой FVG H1"
                  className="w-full bg-[#070a10] border border-[#2a364f] rounded px-2 py-1 text-white text-xs outline-none focus:border-[#38bdf8]"
                  autoFocus
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-[#64748b] mb-4">
                <span>Инструмент: {activeTool || 'Линия'}</span>
                <div className="flex items-center space-x-1">
                  <span>Цвет:</span>
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: activeDrawingStyle.strokeColor }} />
                  <span>({activeDrawingStyle.lineWidth}px)</span>
                </div>
              </div>
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowSaveTemplateModal(false)}
                  className="px-2.5 py-1 rounded bg-[#1e2536] hover:bg-[#2a3449] text-[#94a3b8] text-xs cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  data-testid="btn-confirm-save-template"
                  type="button"
                  onClick={handleSaveCurrentAsTemplate}
                  disabled={!newTemplateName.trim()}
                  className="px-3 py-1 rounded bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-bold text-xs disabled:opacity-40 cursor-pointer"
                >
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Active Indicators Stack (Top-left below toolbar) */}
        <ActiveIndicatorStack
          activeIndicators={activeIndicators}
          onToggleVisibility={handleToggleVisibility}
          onOpenSettings={(id) => setSettingsDialogIndId(id)}
          onRemoveIndicator={handleRemoveIndicator}
          onOpenCatalog={() => setIsCatalogOpen(true)}
        />

        {/* Indicators Catalog Modal */}
        <IndicatorsModal
          isOpen={isCatalogOpen}
          onClose={() => setIsCatalogOpen(false)}
          activeIndicators={activeIndicators}
          onAddIndicator={handleAddIndicator}
          onRemoveIndicator={handleRemoveIndicator}
          onOpenSettings={(id) => setSettingsDialogIndId(id)}
        />

        {/* Indicator Settings Dialog */}
        <IndicatorSettingsDialog
          isOpen={Boolean(settingsDialogIndId)}
          indicatorId={settingsDialogIndId}
          currentInputs={activeIndicators.find((i) => i.id === settingsDialogIndId)?.inputs}
          currentStyles={activeIndicators.find((i) => i.id === settingsDialogIndId)?.styles}
          onClose={() => setSettingsDialogIndId(null)}
          onSave={handleSaveSettings}
        />
      </div>
    </div>
  );
}
