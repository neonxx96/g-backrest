/**
 * crosshairBus.js - Синхронная шина перекрестия вне React (Zero-lag via rAF, Loop protection).
 * 
 * Связывает графики (в dual-pane), стакан DOM и ленту сделок Tape без лишних ре-рендеров React.
 */

class CrosshairBus {
  constructor() {
    this.listeners = new Set();
    this.enabled = true;
    this.lastEvent = null;
    this.pendingRaf = null;
    this.pendingPayload = null;

    try {
      const saved = localStorage.getItem('signalscript_crosshair_sync');
      this.enabled = saved !== 'false';
    } catch (_) {
      this.enabled = true;
    }
  }

  isEnabled() {
    return this.enabled;
  }

  setEnabled(val) {
    this.enabled = Boolean(val);
    try {
      localStorage.setItem('signalscript_crosshair_sync', this.enabled ? 'true' : 'false');
    } catch (_) {}
    this.emitSyncState();
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  /**
   * Подписка на события перемещения перекрестия
   * @param {Function} callback - (payload: { timestamp, price, sourceId }) => void
   * @returns {Function} - функция отписки
   */
  subscribe(callback) {
    if (typeof callback === 'function') {
      this.listeners.add(callback);
    }
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Публикация координаты курсора с троттлингом через requestAnimationFrame и защитой от петель
   */
  publish({ timestamp = null, price = null, sourceId = '' } = {}) {
    if (!this.enabled) return;

    // Loop protection: если координаты идентичны предыдущим, пропускаем
    if (
      this.lastEvent &&
      this.lastEvent.timestamp === timestamp &&
      this.lastEvent.price === price &&
      this.lastEvent.sourceId === sourceId
    ) {
      return;
    }

    this.pendingPayload = { timestamp, price, sourceId };

    if (!this.pendingRaf && typeof requestAnimationFrame !== 'undefined') {
      this.pendingRaf = requestAnimationFrame(() => {
        this.pendingRaf = null;
        if (!this.pendingPayload) return;
        const payload = this.pendingPayload;
        this.lastEvent = payload;

        for (const listener of this.listeners) {
          try {
            listener(payload);
          } catch (err) {
            console.error('crosshairBus listener error:', err);
          }
        }
      });
    } else if (typeof requestAnimationFrame === 'undefined') {
      // Node / test environment fallback
      this.lastEvent = this.pendingPayload;
      for (const listener of this.listeners) {
        try {
          listener(this.pendingPayload);
        } catch (_) {}
      }
    }
  }

  emitSyncState() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('signalscript:crosshair-sync-changed', {
          detail: { enabled: this.enabled },
        })
      );
    }
  }
}

export const crosshairBus = new CrosshairBus();
