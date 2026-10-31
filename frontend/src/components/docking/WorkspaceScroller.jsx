import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useLayoutStore } from '../../stores/layoutStore';
import { getTierForWidth } from '../../theme/screenTiers';

export default function WorkspaceScroller({
  dockviewApi,
  children
}) {
  const scrollerRef = useRef(null);
  const activePresetId = useLayoutStore((s) => s.activePresetId);
  const [viewportH, setViewportH] = useState(800);
  const [heightPx, setHeightPx] = useState(null); // null = auto (100%)
  const isDraggingRef = useRef(false);
  const startDragYRef = useRef(0);
  const startHeightRef = useRef(800);
  const rafHandleRef = useRef(null);

  // Measure visible viewport height of the scroller
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const updateSize = () => {
      setViewportH(el.clientHeight || 800);
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Relayout dockview with the scroller's real allocated size.
  // dockviewApi.layout() with no arguments poisons internal sizes (NaN) and,
  // via the ResizeObserver feedback loop, can lock the grid element into a
  // stale inline size — always pass explicit dimensions.
  const relayoutDockview = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !dockviewApi || typeof dockviewApi.layout !== 'function') return;
    const width = scroller.clientWidth;
    const height = heightPx && heightPx > viewportH ? heightPx : scroller.clientHeight;
    if (width > 0 && height > 0) {
      dockviewApi.layout(width, height, true);
    }
  }, [dockviewApi, heightPx, viewportH]);

  // Read saved height for active preset or set tier defaults
  useEffect(() => {
    let saved = null;
    try {
      saved = localStorage.getItem(`signalscript_ws_height_${activePresetId}`);
    } catch (_) {}

    if (saved && saved !== 'auto') {
      const num = parseInt(saved, 10);
      if (!isNaN(num) && num >= 400 && num <= 8000) {
        setHeightPx(num);
        return;
      }
    }

    // Tier defaults: for tier S (<= 1440px), default to 125% of viewport height
    const tier = getTierForWidth(typeof window !== 'undefined' ? window.innerWidth : 1920);
    if (tier.id === 'S' && viewportH > 400) {
      setHeightPx(Math.round(viewportH * 1.25));
    } else {
      setHeightPx(null); // auto (100%)
    }
  }, [activePresetId, viewportH]);

  // Handle external height preset commands ('auto', '125%', '150%', '200%', '300%')
  useEffect(() => {
    const onSetHeight = (e) => {
      const { mode, ratio } = e.detail || {};
      if (mode === 'auto') {
        setHeightPx(null);
        try { localStorage.setItem(`signalscript_ws_height_${activePresetId}`, 'auto'); } catch (_) {}
      } else if (ratio && viewportH > 300) {
        const nextH = Math.min(8000, Math.max(viewportH, Math.round(viewportH * ratio)));
        setHeightPx(nextH);
        try { localStorage.setItem(`signalscript_ws_height_${activePresetId}`, String(nextH)); } catch (_) {}
      }
      requestAnimationFrame(() => {
        relayoutDockview();
      });
    };

    window.addEventListener('signalscript:set-workspace-height', onSetHeight);
    return () => window.removeEventListener('signalscript:set-workspace-height', onSetHeight);
  }, [activePresetId, viewportH, dockviewApi]);

  // Drag handle logic
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    isDraggingRef.current = true;
    startDragYRef.current = e.clientY;
    const currentH = heightPx || viewportH;
    startHeightRef.current = currentH;
    document.body.style.cursor = 'ns-resize';

    let layoutDebounce = null;
    // Virtual extension: the physical mouse cannot go below the screen edge,
    // so while it is held at the bottom edge the workspace keeps extending
    // (per mousemove event); moving back up shrinks the accumulated extra.
    let edgeBoost = 0;
    let lastDeltaY = 0;
    const EDGE_PX = 48;
    const EDGE_SPEED = 12;

    const onMouseMove = (ev) => {
      if (!isDraggingRef.current) return;
      const deltaY = ev.clientY - startDragYRef.current;
      if (ev.clientY >= window.innerHeight - EDGE_PX) {
        edgeBoost += EDGE_SPEED;
      } else if (deltaY < lastDeltaY) {
        edgeBoost = Math.max(0, edgeBoost - (lastDeltaY - deltaY));
      }
      lastDeltaY = deltaY;
      const minH = viewportH;
      const nextH = Math.min(8000, Math.max(minH, startHeightRef.current + deltaY + edgeBoost));

      if (rafHandleRef.current) cancelAnimationFrame(rafHandleRef.current);
      rafHandleRef.current = requestAnimationFrame(() => {
        setHeightPx(nextH);
      });

      // Coalesced dockview layout
      if (layoutDebounce) clearTimeout(layoutDebounce);
      layoutDebounce = setTimeout(() => {
        relayoutDockview();
      }, 100);

      // Auto-scroll when dragging near bottom
      if (scrollerRef.current) {
        const rect = scrollerRef.current.getBoundingClientRect();
        if (ev.clientY > rect.bottom - 40) {
          scrollerRef.current.scrollTop += 8;
        }
      }
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      setHeightPx((finalH) => {
        const hToSave = finalH || viewportH;
        try {
          localStorage.setItem(`signalscript_ws_height_${activePresetId}`, String(hToSave));
        } catch (_) {}
        return finalH;
      });

      relayoutDockview();
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [heightPx, viewportH, activePresetId, dockviewApi]);

  // Layout notification when heightPx changes
  useEffect(() => {
    const t = setTimeout(() => {
      relayoutDockview();
    }, 120);
    return () => clearTimeout(t);
  }, [relayoutDockview]);

  const effectiveHeight = heightPx && heightPx > viewportH ? `${heightPx}px` : '100%';

  const heightPercent = heightPx && heightPx > viewportH
    ? Math.min(300, Math.max(100, Math.round((heightPx / viewportH) * 100)))
    : 100;

  const applyHeightPercent = (raw) => {
    const pct = Number(raw);
    if (!Number.isFinite(pct) || pct <= 100) {
      setHeightPx(null);
      try { localStorage.setItem(`signalscript_ws_height_${activePresetId}`, 'auto'); } catch (_) {}
    } else {
      const next = Math.round(viewportH * (Math.min(300, pct) / 100));
      setHeightPx(next);
      try { localStorage.setItem(`signalscript_ws_height_${activePresetId}`, String(next)); } catch (_) {}
    }
    relayoutDockview();
  };

  return (
    <>
    <div
      ref={scrollerRef}
      data-testid="workspace-scroller"
      tabIndex={0}
      className="flex-1 w-full overflow-y-auto overflow-x-hidden relative select-none scrollbar-thin outline-none"
      style={{
        scrollbarColor: 'var(--border) var(--background)',
        scrollbarWidth: 'thin',
      }}
    >
      {/* Dockview Container with dynamic height */}
      <div
        data-testid="workspace-dockview-wrapper"
        style={{
          height: effectiveHeight,
          minHeight: '100%',
          position: 'relative',
        }}
        className="w-full relative dockview-theme-dark"
      >
        {children}
      </div>

      {/* Bottom Resize Handle (pull down to extend workspace height).
          Sticky bottom-0 keeps it docked at the visible edge of the scroller —
          otherwise it sits below the fold and users can never grab it. */}
      <div
        data-testid="workspace-height-handle"
        onMouseDown={handleMouseDown}
        onDoubleClick={() => {
          setHeightPx(null);
          try { localStorage.setItem(`signalscript_ws_height_${activePresetId}`, 'auto'); } catch (_) {}
          relayoutDockview();
        }}
        title="Потяните вниз для увеличения высоты терминала; двойной клик — сброс в авто"
        className="h-3 w-full bg-card/80 hover:bg-primary/20 border-t border-border/60 hover:border-primary/50 cursor-ns-resize flex items-center justify-center transition-colors group shrink-0 sticky bottom-0 z-[100] backdrop-blur-sm"
      >
        <div className="flex items-center space-x-1 opacity-40 group-hover:opacity-100 transition-opacity">
          <span className="w-1 h-1 rounded-full bg-muted-foreground group-hover:bg-primary" />
          <span className="w-1 h-1 rounded-full bg-muted-foreground group-hover:bg-primary" />
          <span className="w-1 h-1 rounded-full bg-muted-foreground group-hover:bg-primary" />
          <span className="w-6 h-0.5 rounded-full bg-muted-foreground/60 group-hover:bg-primary mx-1" />
          <span className="w-1 h-1 rounded-full bg-muted-foreground group-hover:bg-primary" />
          <span className="w-1 h-1 rounded-full bg-muted-foreground group-hover:bg-primary" />
          <span className="w-1 h-1 rounded-full bg-muted-foreground group-hover:bg-primary" />
          <span className="text-[9px] font-mono text-muted-foreground group-hover:text-primary ml-1.5">
            {heightPx && heightPx > viewportH ? `${Math.round((heightPx / viewportH) * 100)}% · ` : ''}высота терминала
          </span>
        </div>
      </div>
    </div>

    {/* Floating height slider: vertically centred at the screen edge.
        100% = авто (ровно экран), до 300% — терминал растёт вниз с прокруткой. */}
    <div
      data-testid="workspace-height-slider"
      className="fixed right-2 top-1/2 -translate-y-1/2 z-[100] flex flex-col items-center gap-1 bg-card/60 hover:bg-card/95 border border-border/60 hover:border-primary/50 rounded-full px-1.5 py-2.5 backdrop-blur-sm shadow-lg opacity-50 hover:opacity-100 transition-all"
      title="Глубина терминала: 100–300% высоты экрана"
    >
      <span className="text-[9px] font-mono font-bold text-primary tabular-nums">{heightPercent}%</span>
      <input
        type="range"
        data-testid="workspace-height-slider-input"
        min={100}
        max={300}
        step={5}
        value={heightPercent}
        onChange={(e) => applyHeightPercent(e.target.value)}
        onDoubleClick={() => applyHeightPercent(100)}
        className="h-36 cursor-ns-resize"
        style={{
          writingMode: 'vertical-lr',
          direction: 'rtl',
          accentColor: 'var(--primary)',
          width: '14px',
        }}
        aria-label="Глубина терминала, проценты от высоты экрана"
      />
      <span className="text-[8px] font-mono text-muted-foreground [writing-mode:vertical-rl] select-none">глубина</span>
    </div>
    </>
  );
}
