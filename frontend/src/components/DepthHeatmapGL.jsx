import React, { useEffect, useRef } from 'react';

import { maxVolumeOf, splatGeometry } from './chart/densityHeatmapMath.js';

// Непрерывная WebGL-heatmap плотностей стакана (задача 4.5).
// Заменяет дискретные прямоугольные полигоны (по overlay на точку) на мягкие
// гауссовы сплаты, накапливаемые аддитивным блендингом в одном WebGL-canvas,
// синхронизированном с главной панелью klinecharts ('candle_pane').
// Если WebGL недоступен — честный fallback на 2D-canvas с radialGradient.

const CANDLE_PANE_ID = 'candle_pane';
const BID_RGB = [0.149, 0.651, 0.604]; // #26a69a
const ASK_RGB = [0.937, 0.325, 0.314]; // #ef5350

const VERT_SRC = `
attribute vec2 a_pos;   // clip-space координаты
attribute float a_alpha;
attribute float a_side; // 0 = bid, 1 = ask
uniform float u_size;   // gl_PointSize (px * dpr)
varying float v_alpha;
varying float v_side;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  gl_PointSize = u_size;
  v_alpha = a_alpha;
  v_side = a_side;
}`;

const FRAG_SRC = `
precision mediump float;
varying float v_alpha;
varying float v_side;
uniform vec3 u_bid;
uniform vec3 u_ask;
void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  float fall = 1.0 - d * d;
  fall *= fall; // гауссовидный спад
  vec3 col = mix(u_bid, u_ask, v_side);
  gl_FragColor = vec4(col, v_alpha * fall);
}`;

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

export default function DepthHeatmapGL({ chart, points, active }) {
  const canvasRef = useRef(null);
  const pointsRef = useRef([]);

  useEffect(() => {
    pointsRef.current = Array.isArray(points) ? points : [];
  }, [points]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !chart || !canvas) return undefined;

    // --- Контекст: WebGL с fallback на 2D ---
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
          side: gl.getAttribLocation(program, 'a_side'),
          size: gl.getUniformLocation(program, 'u_size'),
          bid: gl.getUniformLocation(program, 'u_bid'),
          ask: gl.getUniformLocation(program, 'u_ask'),
        };
        buffer = gl.createBuffer();
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // аддитивное накопление «жара»
        gl.clearColor(0, 0, 0, 0);
      } else {
        // шейдеры не собрались — честный 2D-fallback
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

    const toClip = (coords) => {
      const w = canvas.width || 1;
      const h = canvas.height || 1;
      return coords.map((c) => ({
        x: (c.x / w) * 2 - 1,
        y: 1 - (c.y / h) * 2,
      }));
    };

    const draw2DFallback = (list) => {
      ctx2d.setTransform(1, 0, 0, 1, 0, 0);
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      ctx2d.scale(dpr, dpr);
      ctx2d.globalCompositeOperation = 'lighter';
      for (const p of list) {
        const r = p.radiusPx / dpr;
        const g = ctx2d.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        const [cr, cg, cb] = p.side === 'ask' ? ASK_RGB : BID_RGB;
        const a = Math.min(0.6, p.alpha);
        g.addColorStop(0, `rgba(${cr * 255 | 0},${cg * 255 | 0},${cb * 255 | 0},${a})`);
        g.addColorStop(1, `rgba(${cr * 255 | 0},${cg * 255 | 0},${cb * 255 | 0},0)`);
        ctx2d.fillStyle = g;
        ctx2d.beginPath();
        ctx2d.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx2d.fill();
      }
      ctx2d.globalCompositeOperation = 'source-over';
    };

    let rafId = 0;
    const debug = { mode: gl ? 'webgl' : (ctx2d ? '2d-fallback' : 'none'), points: 0, drawn: 0, glError: null };
    window.__depthHeatmapGL = debug;
    const redraw = () => {
      rafId = 0;
      resize();
      const pts = pointsRef.current;
      debug.points = pts.length;
      if (!pts.length || canvas.width === 0) {
        if (gl) gl.clear(gl.COLOR_BUFFER_BIT);
        else if (ctx2d) ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      // Пакетная конвертация в пиксели главной панели
      let coords;
      try {
        coords = chart.convertToPixel(
          pts.map((p) => ({ timestamp: p.timestamp, value: p.price })),
          { paneId: CANDLE_PANE_ID }
        );
      } catch (_) {
        return;
      }
      const maxVol = maxVolumeOf(pts);
      const list = [];
      for (let i = 0; i < pts.length; i++) {
        const c = coords[i];
        if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
        if (c.x < -80 || c.x > canvas.width + 80 || c.y < -80 || c.y > canvas.height + 80) continue;
        const geo = splatGeometry(pts[i], maxVol, dpr);
        list.push({
          x: c.x,
          y: c.y,
          radiusPx: geo.radiusPx,
          alpha: geo.alpha,
          side: pts[i].side === 'ask' ? 1 : 0,
        });
      }
      if (!list.length) {
        if (gl) gl.clear(gl.COLOR_BUFFER_BIT);
        else if (ctx2d) ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      if (gl && program) {
        // Батч: в каждом проходе рисуем точки одинакового радиуса (атлас из 4 бакетов радиуса).
        // ВАЖНО: шейдер ждёт clip-space координаты [-1..1], пиксели (convertToPixel) переводим явно.
        const w = canvas.width || 1;
        const h = canvas.height || 1;
        gl.viewport(0, 0, w, h);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program);
        gl.uniform3fv(loc.bid, BID_RGB);
        gl.uniform3fv(loc.ask, ASK_RGB);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
        gl.enableVertexAttribArray(loc.pos);
        gl.enableVertexAttribArray(loc.alpha);
        gl.enableVertexAttribArray(loc.side);
        gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, stride, 0);
        gl.vertexAttribPointer(loc.alpha, 1, gl.FLOAT, false, stride, 2 * 4);
        gl.vertexAttribPointer(loc.side, 1, gl.FLOAT, false, stride, 3 * 4);

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
            arr[n * 4 + 3] = p.side;
            n++;
          }
          gl.bufferData(gl.ARRAY_BUFFER, arr.subarray(0, n * 4), gl.DYNAMIC_DRAW);
          gl.uniform1f(loc.size, radius * 2); // диаметр сплата
          gl.drawArrays(gl.POINTS, 0, n);
          debug.drawn += n;
        }
        debug.glError = gl.getError();
      } else if (ctx2d) {
        draw2DFallback(list.map((p) => ({ ...p, x: p.x / dpr, y: p.y / dpr, radiusPx: p.radiusPx })));
        debug.drawn += list.length;
        debug.glError = 0;
      }
    };

    const schedule = () => {
      if (!rafId) rafId = requestAnimationFrame(redraw);
    };

    redraw();

    // Синхронизация с навигацией по графику и размером панели
    const unsubs = [];
    try {
      chart.subscribeAction('onZoom', schedule);
      unsubs.push(() => chart.unsubscribeAction('onZoom', schedule));
      chart.subscribeAction('onScroll', schedule);
      unsubs.push(() => chart.unsubscribeAction('onScroll', schedule));
    } catch (_) {}

    const parent = canvas.parentElement;
    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && parent) {
      ro = new ResizeObserver(schedule);
      ro.observe(parent);
    }
    // Новые свечи сдвигают картинку даже без явного scroll-события
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
  }, [active, chart]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      data-testid="depth-heatmap-gl"
      className="absolute inset-0 w-full h-full"
      style={{ pointerEvents: 'none', zIndex: 5 }}
    />
  );
}
