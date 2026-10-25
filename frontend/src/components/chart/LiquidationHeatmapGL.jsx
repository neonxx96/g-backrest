import React, { useEffect, useRef, useState } from 'react';
import {
  PALETTES,
  samplePalette,
  liquidationsToHeatmapPoints,
  liquidationSplatGeometry,
} from './liquidationHeatmapMath.js';

const CANDLE_PANE_ID = 'candle_pane';

const VERT_SRC = `
attribute vec2 a_pos;
attribute float a_alpha;
attribute float a_intensity;
uniform float u_size;
varying float v_alpha;
varying float v_intensity;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  gl_PointSize = u_size;
  v_alpha = a_alpha;
  v_intensity = a_intensity;
}
`;

const FRAG_SRC = `
precision mediump float;
varying float v_alpha;
varying float v_intensity;
uniform int u_palette; // 0=magma, 1=sunset, 2=viridis, 3=classic
uniform float u_opacity;

vec3 getMagma(float t) {
  vec3 c0 = vec3(0.05, 0.02, 0.15);
  vec3 c1 = vec3(0.45, 0.08, 0.52);
  vec3 c2 = vec3(0.88, 0.28, 0.20);
  vec3 c3 = vec3(0.98, 0.72, 0.22);
  vec3 c4 = vec3(0.99, 0.99, 0.75);
  if (t < 0.25) return mix(c0, c1, t * 4.0);
  if (t < 0.50) return mix(c1, c2, (t - 0.25) * 4.0);
  if (t < 0.75) return mix(c2, c3, (t - 0.50) * 4.0);
  return mix(c3, c4, (t - 0.75) * 4.0);
}

vec3 getSunset(float t) {
  vec3 c0 = vec3(0.06, 0.07, 0.22);
  vec3 c1 = vec3(0.50, 0.12, 0.52);
  vec3 c2 = vec3(0.92, 0.35, 0.30);
  vec3 c3 = vec3(0.99, 0.85, 0.45);
  if (t < 0.333) return mix(c0, c1, t * 3.0);
  if (t < 0.666) return mix(c1, c2, (t - 0.333) * 3.0);
  return mix(c2, c3, (t - 0.666) * 3.0);
}

vec3 getViridis(float t) {
  vec3 c0 = vec3(0.27, 0.00, 0.33);
  vec3 c1 = vec3(0.19, 0.40, 0.55);
  vec3 c2 = vec3(0.13, 0.67, 0.51);
  vec3 c3 = vec3(0.99, 0.90, 0.14);
  if (t < 0.333) return mix(c0, c1, t * 3.0);
  if (t < 0.666) return mix(c1, c2, (t - 0.333) * 3.0);
  return mix(c2, c3, (t - 0.666) * 3.0);
}

void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  float fall = 1.0 - d * d;
  fall *= fall;

  vec3 col;
  if (u_palette == 0) {
    col = getMagma(v_intensity);
  } else if (u_palette == 1) {
    col = getSunset(v_intensity);
  } else if (u_palette == 2) {
    col = getViridis(v_intensity);
  } else {
    col = mix(vec3(0.15, 0.65, 0.60), vec3(0.94, 0.32, 0.31), v_intensity);
  }

  gl_FragColor = vec4(col, v_alpha * fall * u_opacity);
}
`;

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export default function LiquidationHeatmapGL({
  chart,
  engine,
  liquidations = [],
  active = false,
  palette: propPalette,
  opacity: propOpacity,
  blur: propBlur,
  minUsd: propMinUsd,
}) {
  const canvasRef = useRef(null);

  // Пользовательские настройки с сохранением в localStorage
  const [palette, setPalette] = useState(() => propPalette || localStorage.getItem('chart_liq_palette') || 'magma');
  const [opacity, setOpacity] = useState(() => propOpacity !== undefined ? propOpacity : (Number(localStorage.getItem('chart_liq_opacity')) || 0.85));
  const [blur, setBlur] = useState(() => propBlur !== undefined ? propBlur : (Number(localStorage.getItem('chart_liq_blur')) || 1.3));
  const [minUsd, setMinUsd] = useState(() => propMinUsd !== undefined ? propMinUsd : (Number(localStorage.getItem('chart_liq_min_usd')) || 25000));
  const [showSettings, setShowSettings] = useState(false);

  // Синхронизация внешних пропсов
  useEffect(() => {
    if (propPalette) setPalette(propPalette);
  }, [propPalette]);
  useEffect(() => {
    if (propOpacity !== undefined) setOpacity(propOpacity);
  }, [propOpacity]);
  useEffect(() => {
    if (propBlur !== undefined) setBlur(propBlur);
  }, [propBlur]);
  useEffect(() => {
    if (propMinUsd !== undefined) setMinUsd(propMinUsd);
  }, [propMinUsd]);

  const rawPoints = liquidationsToHeatmapPoints(liquidations, minUsd);
  const pointsRef = useRef(rawPoints);
  pointsRef.current = rawPoints;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || (!chart && !engine) || !canvas) return undefined;

    let gl = null;
    let ctx2d = null;
    try {
      gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true });
    } catch (_) {
      gl = null;
    }
    if (!gl) ctx2d = canvas.getContext('2d');

    let program = null;
    let loc = null;
    let buffer = null;

    if (gl) {
      const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
      if (vs && fs) {
        program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) program = null;
      }
      if (program) {
        loc = {
          pos: gl.getAttribLocation(program, 'a_pos'),
          alpha: gl.getAttribLocation(program, 'a_alpha'),
          intensity: gl.getAttribLocation(program, 'a_intensity'),
          size: gl.getUniformLocation(program, 'u_size'),
          palette: gl.getUniformLocation(program, 'u_palette'),
          opacity: gl.getUniformLocation(program, 'u_opacity'),
        };
        buffer = gl.createBuffer();
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // аддитивное накопление ликвидационного свечения
        gl.clearColor(0, 0, 0, 0);
      } else {
        gl = null;
        ctx2d = canvas.getContext('2d');
      }
    }

    const dpr = Math.max(1, window.devicePixelRatio || 1);

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
    };

    const draw2DFallback = (list) => {
      ctx2d.setTransform(1, 0, 0, 1, 0, 0);
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      ctx2d.scale(dpr, dpr);
      ctx2d.globalCompositeOperation = 'lighter';

      for (const p of list) {
        const r = p.radiusPx / dpr;
        const g = ctx2d.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        const rgb = samplePalette(palette, p.intensity);
        const a = Math.min(1.0, p.alpha * opacity);
        const colStr = `rgba(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)}`;
        g.addColorStop(0, `${colStr}, ${a})`);
        g.addColorStop(1, `${colStr}, 0)`);
        ctx2d.fillStyle = g;
        ctx2d.beginPath();
        ctx2d.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx2d.fill();
      }
      ctx2d.globalCompositeOperation = 'source-over';
    };

    let rafId = 0;
    const redraw = () => {
      rafId = 0;
      resize();
      const pts = pointsRef.current;
      if (!pts.length || canvas.width === 0) {
        if (gl) gl.clear(gl.COLOR_BUFFER_BIT);
        else if (ctx2d) ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      // Конвертация координат (поддерживает ChartEngine или klinecharts instance)
      let coords = [];
      try {
        if (engine && typeof engine.priceTimeToCoord === 'function') {
          coords = pts.map((p) => engine.priceTimeToCoord(p.price, p.timestamp));
        } else if (chart && typeof chart.convertToPixel === 'function') {
          coords = chart.convertToPixel(
            pts.map((p) => ({ timestamp: p.timestamp, value: p.price })),
            { paneId: CANDLE_PANE_ID }
          );
        }
      } catch (_) {
        return;
      }

      const list = [];
      const w = canvas.width || 1;
      const h = canvas.height || 1;

      for (let i = 0; i < pts.length; i++) {
        const c = coords[i];
        if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
        if (c.x < -80 || c.x > w + 80 || c.y < -80 || c.y > h + 80) continue;
        const geo = liquidationSplatGeometry(pts[i], dpr, blur, opacity);
        list.push({
          x: c.x,
          y: c.y,
          radiusPx: geo.radiusPx,
          alpha: geo.alpha,
          intensity: geo.intensity,
        });
      }

      if (!list.length) {
        if (gl) gl.clear(gl.COLOR_BUFFER_BIT);
        else if (ctx2d) ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      if (gl && program) {
        gl.viewport(0, 0, w, h);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program);

        const palId = PALETTES[palette]?.id ?? 0;
        gl.uniform1i(loc.palette, palId);
        gl.uniform1f(loc.opacity, opacity);

        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
        gl.enableVertexAttribArray(loc.pos);
        gl.enableVertexAttribArray(loc.alpha);
        gl.enableVertexAttribArray(loc.intensity);

        gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, stride, 0);
        gl.vertexAttribPointer(loc.alpha, 1, gl.FLOAT, false, stride, 2 * 4);
        gl.vertexAttribPointer(loc.intensity, 1, gl.FLOAT, false, stride, 3 * 4);

        const byRadius = new Map();
        for (const p of list) {
          const key = Math.round(p.radiusPx);
          if (!byRadius.has(key)) byRadius.set(key, []);
          byRadius.get(key).push(p);
        }

        const arr = new Float32Array(4 * list.length);
        for (const [radius, group] of byRadius) {
          let n = 0;
          for (const p of group) {
            arr[n * 4] = (p.x / w) * 2 - 1;
            arr[n * 4 + 1] = 1 - (p.y / h) * 2;
            arr[n * 4 + 2] = p.alpha;
            arr[n * 4 + 3] = p.intensity;
            n++;
          }
          gl.bufferData(gl.ARRAY_BUFFER, arr.subarray(0, n * 4), gl.DYNAMIC_DRAW);
          gl.uniform1f(loc.size, radius * 2);
          gl.drawArrays(gl.POINTS, 0, n);
        }
      } else if (ctx2d) {
        draw2DFallback(list.map((p) => ({ ...p, x: p.x / dpr, y: p.y / dpr })));
      }
    };

    const schedule = () => {
      if (!rafId) rafId = requestAnimationFrame(redraw);
    };

    redraw();

    const unsubs = [];
    if (engine && typeof engine.subscribeViewportChange === 'function') {
      unsubs.push(engine.subscribeViewportChange(schedule));
    } else if (chart && typeof chart.subscribeAction === 'function') {
      try {
        chart.subscribeAction('onZoom', schedule);
        unsubs.push(() => chart.unsubscribeAction('onZoom', schedule));
        chart.subscribeAction('onScroll', schedule);
        unsubs.push(() => chart.unsubscribeAction('onScroll', schedule));
      } catch (_) {}
    }

    const parent = canvas.parentElement;
    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && parent) {
      ro = new ResizeObserver(schedule);
      ro.observe(parent);
    }
    const driftTimer = setInterval(schedule, 1500);

    return () => {
      unsubs.forEach((fn) => { try { fn(); } catch (_) {} });
      if (ro) ro.disconnect();
      clearInterval(driftTimer);
      if (rafId) cancelAnimationFrame(rafId);
      if (gl && buffer) gl.deleteBuffer(buffer);
      if (gl && program) gl.deleteProgram(program);
      if (ctx2d) ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      else if (gl) gl.clear(gl.COLOR_BUFFER_BIT);
    };
  }, [active, chart, engine, palette, opacity, blur, minUsd, liquidations.length]);

  if (!active) return null;

  return (
    <>
      <canvas
        ref={canvasRef}
        data-testid="liquidation-heatmap-gl"
        className="absolute inset-0 w-full h-full"
        style={{ pointerEvents: 'none', zIndex: 6 }}
      />

      {/* Интерактивная плашка настроек Liquidation Heatmap в правом верхнем углу */}
      <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5 font-mono text-[10px]">
        <button
          type="button"
          onClick={() => setShowSettings(!showSettings)}
          className="px-2 py-0.5 rounded bg-[#10141e]/90 text-amber-400 hover:text-amber-300 border border-amber-500/30 backdrop-blur shadow"
          title="Настройки карты ликвидаций (палитра, прозрачность, размытие)"
        >
          🔥 Liq: {PALETTES[palette]?.name || 'Magma'} ({rawPoints.length} pts) ⚙
        </button>

        {showSettings && (
          <div className="absolute top-7 right-0 p-2.5 rounded bg-[#0d111a] border border-[#1f2638] shadow-2xl text-slate-200 w-56 flex flex-col gap-2">
            <div className="flex justify-between items-center text-[10px] font-bold text-slate-300 border-b border-[#1f2638] pb-1">
              <span>Ликвидации (Alphfractal)</span>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="text-[9px] text-slate-400 block mb-1">Палитра свечения</label>
              <div className="grid grid-cols-3 gap-1">
                {['magma', 'sunset', 'viridis'].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setPalette(p);
                      localStorage.setItem('chart_liq_palette', p);
                    }}
                    className={`px-1.5 py-0.5 rounded text-[9.5px] uppercase transition ${
                      palette === p
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                        : 'bg-[#151a26] text-slate-400 hover:text-white border border-[#232a3b]'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[9px] text-slate-400">
                <span>Прозрачность</span>
                <span className="text-amber-300">{Math.round(opacity * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.2"
                max="1.0"
                step="0.05"
                value={opacity}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setOpacity(val);
                  localStorage.setItem('chart_liq_opacity', String(val));
                }}
                className="w-full accent-amber-500 h-1 bg-[#151a26] rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-[9px] text-slate-400">
                <span>Размытие (Гаусс)</span>
                <span className="text-amber-300">{blur.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.5"
                step="0.1"
                value={blur}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setBlur(val);
                  localStorage.setItem('chart_liq_blur', String(val));
                }}
                className="w-full accent-amber-500 h-1 bg-[#151a26] rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-[9px] text-slate-400">
                <span>Мин. объем ($)</span>
                <span className="text-amber-300">${(minUsd / 1000).toFixed(0)}k</span>
              </div>
              <div className="grid grid-cols-4 gap-1 mt-1">
                {[10000, 25000, 50000, 100000].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setMinUsd(v);
                      localStorage.setItem('chart_liq_min_usd', String(v));
                    }}
                    className={`py-0.5 rounded text-[8.5px] ${
                      minUsd === v
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                        : 'bg-[#151a26] text-slate-400 border border-[#232a3b]'
                    }`}
                  >
                    ${v / 1000}k
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
