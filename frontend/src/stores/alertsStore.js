/**
 * Price Alerts Store (Zustand)
 * Manages institutional price alerts, notification channels, and active thresholds.
 */

import { create } from 'zustand';

const STORAGE_KEY = 'ss_price_alerts_v1';

function loadInitialAlerts() {
  try {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    }
  } catch (_) {}
  return [
    {
      id: 'alert_btc_85k',
      symbol: 'BTCUSDT',
      name: 'BTC Breakout $85,000',
      condition: 'Crosses above',
      price: 85000,
      channels: ['in_app', 'telegram'],
      triggerType: 'once',
      repeatIntervalSec: 60,
      expiresAt: '24 hours',
      status: 'active',
      createdAt: Date.now() - 3600000
    },
    {
      id: 'alert_sol_170',
      symbol: 'SOLUSDT',
      name: 'SOL Resistance $170',
      condition: 'Crosses above',
      price: 170.0,
      channels: ['in_app', 'discord'],
      triggerType: 'repeat',
      repeatIntervalSec: 300,
      expiresAt: '7 days',
      status: 'active',
      createdAt: Date.now() - 7200000
    }
  ];
}

export const useAlertsStore = create((set, get) => ({
  alerts: loadInitialAlerts(),
  isAlertsModalOpen: false,
  modalPrefill: null,

  openAlertsModal: (prefill = null) => {
    set({
      isAlertsModalOpen: true,
      modalPrefill: prefill
    });
  },

  closeAlertsModal: () => {
    set({
      isAlertsModalOpen: false,
      modalPrefill: null
    });
  },

  addAlert: (alertData) => {
    const newAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      status: 'active',
      createdAt: Date.now(),
      ...alertData
    };

    const updated = [newAlert, ...get().alerts];
    set({ alerts: updated });

    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      }
    } catch (_) {}

    return newAlert;
  },

  removeAlert: (id) => {
    const updated = get().alerts.filter((a) => a.id !== id);
    set({ alerts: updated });
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      }
    } catch (_) {}
  },

  toggleAlert: (id) => {
    const updated = get().alerts.map((a) =>
      a.id === id
        ? { ...a, status: a.status === 'active' ? 'paused' : 'active' }
        : a
    );
    set({ alerts: updated });
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      }
    } catch (_) {}
  },

  testAlert: (alertData) => {
    // Dispatches a test toast/audio event
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('signal-alert-triggered', {
          detail: {
            title: `[TEST ALERT] ${alertData.name || alertData.symbol}`,
            message: `${alertData.symbol} ${alertData.condition || 'reached'} $${alertData.price}`,
            channels: alertData.channels || ['in_app']
          }
        })
      );
    }
  }
}));
