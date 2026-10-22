// Чистая математика WebGL-heatmap плотностей стакана (задача 4.5).
// Раньше каждая точка рендерилась дискретным прямоугольником 28×2 через overlay;
// теперь точки превращаются в мягкие гауссовы сплаты, масштаб/альфа которых
// считаются здесь. Вынесено отдельно, чтобы покрыть node-тестами (npm prebuild).

export function maxVolumeOf(points) {
  let max = 0;
  for (const p of points || []) {
    const v = Number(p?.volume_usd) || 0;
    if (v > max) max = v;
  }
  return max;
}

// Стиль сплата: альфа и диаметр растут с долей от максимального объёма.
// Диапазоны сознательно близки к старому оверлею (alpha 0.12–0.40).
export function pointStyle(volumeUsd, maxVolume) {
  const vol = Math.max(0, Number(volumeUsd) || 0);
  const share = maxVolume > 0 ? Math.min(1, vol / maxVolume) : 0;
  const alpha = 0.12 + 0.28 * share;
  const sizePx = 12 + 26 * share;
  return { alpha, sizePx };
}

// Бюджетирование точек под лимит: сильнейшие по объёму + самые свежие, дедуп по ключу.
// Перенесено из adaptDensityPoints (Chart.jsx) без изменения семантики.
export function selectDensityPoints(points, budget) {
  if (!Array.isArray(points) || points.length <= budget) return Array.isArray(points) ? points : [];
  const strongest = [...points]
    .sort((a, b) => Number(b.volume_usd || 0) - Number(a.volume_usd || 0))
    .slice(0, Math.ceil(budget * 0.65));
  const recent = points.slice(-Math.floor(budget * 0.45));
  const unique = new Map();
  [...strongest, ...recent].forEach((point) => {
    const key = `${point.side || 'bid'}:${point.timestamp}:${Number(point.price).toPrecision(12)}`;
    if (!unique.has(key)) unique.set(key, point);
  });
  return [...unique.values()].slice(0, budget);
}

// Финальная геометрия сплата в пикселях для рендера (GL или 2D-fallback).
export function splatGeometry(point, maxVolume, dpr = 1) {
  const { alpha, sizePx } = pointStyle(point?.volume_usd, maxVolume);
  return {
    alpha,
    radiusPx: (sizePx / 2) * Math.max(1, dpr),
  };
}
