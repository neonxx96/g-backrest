/**
 * Design Previews & Quant Overlays
 * Plug-and-play components ready for injection into Chart.jsx and Dockview layout.
 *
 * @module design-previews
 */

/**
 * @typedef {Object} LiqLevel
 * @property {number} price - Liquidation level price
 * @property {number} volume_usd - Estimated liquidated volume in USD
 * @property {string} leverage - Leverage tier ('25x' | '50x' | '75x' | '100x')
 * @property {number} intensity - Visual intensity between 0.0 and 1.0
 */

/**
 * @typedef {Object} DepthWall
 * @property {number} price - Wall price level
 * @property {number} amount - Size / quantity on book
 * @property {number} total_usd - Notional USD volume
 * @property {string} side - 'bid' or 'ask'
 * @property {number} multiplier - Wall multiplier relative to local mean (e.g. 3.2x)
 */

/**
 * @typedef {Object} DepthDeltas
 * @property {number} delta_2_5_pct - Depth Delta inside +/- 2.5% range
 * @property {number} delta_5_0_pct - Depth Delta inside +/- 5.0% range
 * @property {number} delta_10_0_pct - Depth Delta inside +/- 10.0% range
 * @property {number} delta_25_0_pct - Depth Delta inside +/- 25.0% range
 */

export { default as ChartCanvasOverlay } from './ChartCanvasOverlay';
export { default as LayerToolbar } from './LayerToolbar';
export { default as LiqAnalyticsPanel } from './LiqAnalyticsPanel';
export { default as QuantDecisionConsilium } from './QuantDecisionConsilium';
