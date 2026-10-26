// Чистая математика WebGL-heatmap ликвидаций (Alphfractal / Coinglass стиль).
// Поддерживает палитры Magma, Sunset, Viridis и Classic (Bid/Ask).
// Вынесено отдельно для покрытия тестами node:test (npm prebuild).

export const PALETTES = {
  magma: {
    id: 0,
    name: 'Magma',
    stops: [
      [0.05, 0.02, 0.15], // тёмно-фиолетовый (база)
      [0.45, 0.08, 0.52], // пурпурно-малиновый
      [0.88, 0.28, 0.20], // пламенно-красный
      [0.98, 0.72, 0.22], // янтарно-оранжевый
      [0.99, 0.99, 0.75], // яркий неоново-жёлтый (эпицентр)
    ]
  },
  sunset: {
    id: 1,
    name: 'Sunset',
    stops: [
      [0.06, 0.07, 0.22], // глубокий индиго
      [0.50, 0.12, 0.52], // розово-фиолетовый
      [0.92, 0.35, 0.30], // тёплый коралл
      [0.99, 0.85, 0.45], // золотистый закат
    ]
  },
  viridis: {
    id: 2,
    name: 'Viridis',
    stops: [
      [0.27, 0.00, 0.33], // тёмный баклажан
      [0.19, 0.40, 0.55], // бирюзово-синий
      [0.13, 0.67, 0.51], // изумрудно-зелёный
      [0.99, 0.90, 0.14], // лимонно-жёлтый
    ]
  },
  classic: {
    id: 3,
    name: 'Classic',
    stops: [
      [0.149, 0.651, 0.604], // #26a69a (bid / short liq)
      [0.937, 0.325, 0.314], // #ef5350 (ask / long liq)
    ]
  }
};

/**
 * Интерполяция RGB цвета по палитре для нормализованного значения t (0.0 .. 1.0)
 */
export function samplePalette(paletteName = 'magma', t = 0) {
  const pal = PALETTES[paletteName] || PALETTES.magma;
  const stops = pal.stops;
  const clamped = Math.max(0, Math.min(1, Number(t) || 0));

  if (stops.length === 2) {
    const [c0, c1] = stops;
    return [
      c0[0] + (c1[0] - c0[0]) * clamped,
      c0[1] + (c1[1] - c0[1]) * clamped,
      c0[2] + (c1[2] - c0[2]) * clamped,
    ];
  }

  const segments = stops.length - 1;
  const pos = clamped * segments;
  const idx = Math.min(Math.floor(pos), segments - 1);
  const frac = pos - idx;

  const c0 = stops[idx];
  const c1 = stops[idx + 1];

  return [
    c0[0] + (c1[0] - c0[0]) * frac,
    c0[1] + (c1[1] - c0[1]) * frac,
    c0[2] + (c1[2] - c0[2]) * frac,
  ];
}

/**
 * Преобразование событий ликвидаций (Binance !forceOrder@arr) в точки для тепловой карты
 */
export function liquidationsToHeatmapPoints(events, minUsd = 0) {
  if (!Array.isArray(events)) return [];
  const valid = [];
  let maxUsd = 0;

  for (const ev of events) {
    const usd = Number(ev?.usd_amount || ev?.volume_usd || 0);
    const price = Number(ev?.price);
    const ts = Number(ev?.timestamp);
    if (!Number.isFinite(price) || !Number.isFinite(ts) || price <= 0 || ts <= 0) continue;
    if (usd < minUsd) continue;

    if (usd > maxUsd) maxUsd = usd;
    valid.push({
      timestamp: ts,
      price,
      usd_amount: usd,
      side: String(ev?.side || 'BUY').toUpperCase() === 'SELL' ? 'ask' : 'bid',
    });
  }

  return valid.map((pt) => ({
    ...pt,
    intensity: maxUsd > 0 ? Math.min(1, pt.usd_amount / maxUsd) : 0.5,
  }));
}

/**
 * Расчет геометрии сплата ликвидации с учетом радиуса размытия (blurMultiplier) и прозрачности (opacity)
 */
export function liquidationSplatGeometry(point, dpr = 1, blurMultiplier = 1.2, baseOpacity = 0.8) {
  const intensity = Math.max(0, Math.min(1, Number(point?.intensity) || 0));
  const dprNorm = Math.max(1, Number(dpr) || 1);
  const blur = Math.max(0.3, Math.min(3.0, Number(blurMultiplier) || 1.2));
  const opacity = Math.max(0.1, Math.min(1.0, Number(baseOpacity) || 0.8));

  // Базовый размер сплата ликвидации растет от $20px до $60px в зависимости от объема
  const sizePx = (18 + 42 * intensity) * blur;
  const alpha = (0.20 + 0.60 * intensity) * opacity;

  return {
    radiusPx: (sizePx / 2) * dprNorm,
    alpha: Math.min(1.0, alpha),
    intensity,
  };
}
