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
        if (dockviewApi && typeof dockviewApi.layout === 'function') {
          dockviewApi.layout();
        }
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

    const onMouseMove = (ev) => {
      if (!isDraggingRef.current) return;
      const deltaY = ev.clientY - startDragYRef.current;
      const minH = viewportH;
      const nextH = Math.min(8000, Math.max(minH, startHeightRef.current + deltaY));

      if (rafHandleRef.current) cancelAnimationFrame(rafHandleRef.current);
      rafHandleRef.current = requestAnimationFrame(() => {
        setHeightPx(nextH);
      });

      // Coalesced dockview layout
      if (layoutDebounce) clearTimeout(layoutDebounce);
      layoutDebounce = setTimeout(() => {
        if (dockviewApi && typeof dockviewApi.layout === 'function') {
          dockviewApi.layout();
        }
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

      if (dockviewApi && typeof dockviewApi.layout === 'function') {
        dockviewApi.layout();
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [heightPx, viewportH, activePresetId, dockviewApi]);

  // Layout notification when heightPx changes
  useEffect(() => {
    const t = setTimeout(() => {
      if (dockviewApi && typeof dockviewApi.layout === 'function') {
        dockviewApi.layout();
      }
    }, 120);
    return () => clearTimeout(t);
  }, [heightPx, dockviewApi]);

  const effectiveHeight = heightPx && heightPx > viewportH ? `${heightPx}px` : '100%';

  return (
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

      {/* Bottom Resize Handle (pull down to extend workspace height) */}
      <div
        data-testid="workspace-height-handle"
        onMouseDown={handleMouseDown}
        title="Потяните вниз для увеличения высоты рабочей области (прокрутка)"
        className="h-3 w-full bg-card/80 hover:bg-primary/20 border-t border-border/60 hover:border-primary/50 cursor-ns-resize flex items-center justify-center transition-colors group shrink-0 relative z-30"
      >
        <div className="flex items-center space-x-1 opacity-40 group-hover:opacity-100 transition-opacity">
          <span className="w-1 h-1 rounded-full bg-muted-foreground group-hover:bg-primary" />
          <span className="w-1 h-1 rounded-full bg-muted-foreground group-hover:bg-primary" />
          <span className="w-1 h-1 rounded-full bg-muted-foreground group-hover:bg-primary" />
          <span className="w-6 h-0.5 rounded-full bg-muted-foreground/60 group-hover:bg-primary mx-1" />
          <span className="w-1 h-1 rounded-full bg-muted-foreground group-hover:bg-primary" />
          <span className="w-1 h-1 rounded-full bg-muted-foreground group-hover:bg-primary" />
          <span className="w-1 h-1 rounded-full bg-muted-foreground group-hover:bg-primary" />
        </div>
      </div>
    </div>
  );
}
