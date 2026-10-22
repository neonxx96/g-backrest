/**
 * Interactive SVG Equity Curve with Monte Carlo 500-Run Fan Cloud Overlay & Gross vs Net Comparison
 *
 * Извлечён из BacktestPanel.jsx (MODULARIZATION_PLAN, пункт 2) — презентационный компонент без внешних зависимостей.
 */
export default function MonteCarloEquityChart({ fanChart = [], samplePaths = [], initialCapital = 10000 }) {
  if (!fanChart || fanChart.length < 2) {
    return (
      <div className="h-full flex items-center justify-center text-[#60697b] text-[10px] font-mono">
        Недостаточно сделок для построения веера Монте-Карло
      </div>
    );
  }

  const width = 580;
  const height = 148;
  const padL = 46;
  const padR = 12;
  const padT = 10;
  const padB = 18;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const allVals = [initialCapital];
  fanChart.forEach((pt) => {
    allVals.push(pt.p5, pt.p95, pt.actual, pt.gross || pt.actual);
  });
  samplePaths.forEach((path) => {
    path.forEach((v) => allVals.push(v));
  });

  const minVal = Math.min(...allVals) * 0.996;
  const maxVal = Math.max(...allVals) * 1.004;
  const valRange = Math.max(1, maxVal - minVal);
  const nPts = fanChart.length;

  const toX = (idx) => padL + (idx / Math.max(1, nPts - 1)) * plotW;
  const toY = (val) => padT + plotH - ((val - minVal) / valRange) * plotH;

  const buildLine = (key) =>
    fanChart
      .map((pt, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(pt[key] ?? pt.actual).toFixed(1)}`)
      .join(' ');

  const buildBandPolygon = (upperKey, lowerKey) => {
    const topPts = fanChart.map((pt, i) => `${toX(i).toFixed(1)},${toY(pt[upperKey]).toFixed(1)}`);
    const botPts = [...fanChart]
      .reverse()
      .map((pt, revIdx) => {
        const i = nPts - 1 - revIdx;
        return `${toX(i).toFixed(1)},${toY(pt[lowerKey]).toFixed(1)}`;
      });
    return [...topPts, ...botPts].join(' ');
  };

  const yBase = toY(initialCapital);

  return (
    <svg
      data-testid="monte-carlo-svg"
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-full select-none overflow-visible"
    >
      {/* Grid & Initial Capital Baseline */}
      <line
        x1={padL}
        y1={yBase}
        x2={width - padR}
        y2={yBase}
        stroke="#334155"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <text x={4} y={padT + 8} fill="#64748b" fontSize="8.5" fontFamily="monospace">
        ${Math.round(maxVal).toLocaleString()}
      </text>
      <text x={4} y={Math.min(height - 6, Math.max(padT + 18, yBase + 3))} fill="#94a3b8" fontSize="8.5" fontFamily="monospace">
        ${Math.round(initialCapital).toLocaleString()}
      </text>
      <text x={4} y={height - 4} fill="#64748b" fontSize="8.5" fontFamily="monospace">
        ${Math.round(minVal).toLocaleString()}
      </text>

      {/* Outer 5%-95% Monte Carlo Confidence Cloud */}
      <polygon
        points={buildBandPolygon('p95', 'p5')}
        fill="rgba(56, 189, 248, 0.11)"
        stroke="none"
      />

      {/* Inner 25%-75% Monte Carlo Quartile Cloud */}
      <polygon
        points={buildBandPolygon('p75', 'p25')}
        fill="rgba(56, 189, 248, 0.22)"
        stroke="none"
      />

      {/* Individual Monte Carlo Sample Fan Paths */}
      {samplePaths.map((path, sIdx) => {
        const d = path
          .map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`)
          .join(' ');
        return (
          <path
            key={sIdx}
            d={d}
            fill="none"
            stroke="rgba(148, 163, 184, 0.18)"
            strokeWidth="0.9"
          />
        );
      })}

      {/* P50 Median Monte Carlo Path */}
      <path
        d={buildLine('p50')}
        fill="none"
        stroke="#38bdf8"
        strokeWidth="1.2"
        strokeDasharray="4 2"
      />

      {/* Gross Equity Curve (Before Exchange Fees & Slippage) */}
      <path
        d={buildLine('gross')}
        fill="none"
        stroke="#f59e0b"
        strokeWidth="1.3"
        strokeDasharray="2 2"
      />

      {/* Actual Net Equity Curve (After Exchange Fees & Slippage) */}
      <path
        d={buildLine('actual')}
        fill="none"
        stroke="#26a69a"
        strokeWidth="2.2"
      />

      {/* Legend */}
      <g transform={`translate(${padL + 6}, ${padT + 2})`}>
        <rect x="0" y="0" width="8" height="4" fill="#26a69a" rx="1" />
        <text x="11" y="4.5" fill="#e2e8f0" fontSize="8" fontFamily="monospace">
          Чистый Equity
        </text>

        <rect x="82" y="0" width="8" height="4" fill="#f59e0b" rx="1" />
        <text x="93" y="4.5" fill="#cbd5e1" fontSize="8" fontFamily="monospace">
          До комиссий (Gross)
        </text>

        <rect x="192" y="0" width="8" height="4" fill="rgba(56,189,248,0.45)" rx="1" />
        <text x="203" y="4.5" fill="#38bdf8" fontSize="8" fontFamily="monospace">
          Облако Монте-Карло (P5–P95)
        </text>
      </g>
    </svg>
  );
}
