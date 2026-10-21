import { createStore } from 'zustand/vanilla';
import { persist, createJSONStorage } from 'zustand/middleware';
import { pilotApi } from './api.js';
import { allocateCapital, configKey, validateConfigs, hasRunning, optimizerRequest, optimizedPatch } from './model.js';

export function createPilotStore({ api = pilotApi, storage = globalThis.localStorage } = {}) {
  let refreshing = false;
  let mutationEpoch = 0;
  let eventRequest = 0;
  return createStore(persist((set, get) => ({
    configs: [], step: 0, status: null, connection: 'unknown', checkedKey: null,
    busy: null, error: '', optimizations: {}, events: [], initialized: false,
    setStep: step => set({ step }),
    setConfigs: configs => set({ configs: structuredClone(configs), checkedKey: null, error: '' }),
    updateConfig: (index, patch) => get().setConfigs(get().configs.map((c, i) => i === index ? { ...c, ...patch } : c)),
    allocate: total => {
      try { const amounts = allocateCapital(total, get().configs.length); get().setConfigs(get().configs.map((c, i) => ({ ...c, initial_capital: amounts[i] }))); }
      catch (e) { set({ error: e.message }); }
    },
    canStart: () => {
      const { configs, checkedKey, status, connection, busy } = get();
      const sessions = Object.values(status?.sessions || {});
      return !busy && connection === 'connected' && !hasRunning(status) && !validateConfigs(configs).length
        && checkedKey === configKey(configs) && Boolean(status?.preflight_id)
        && sessions.length === configs.length && configs.every(c => {
          const s = status.sessions[c.symbol];
          return s?.preflight_valid && !s.error && s.run_id === status.preflight_id && s.forecast?.data_status === 'connected';
        });
    },
    initialize: async () => {
      if (get().initialized) return;
      set({ initialized: true });
      await get().refresh();
      if (!get().configs.length) {
        try {
          const payload = await api.defaults();
          const configs = payload.sessions.map(c => ({ ...c, duration_hours: 1 }));
          const amounts = allocateCapital(1000, configs.length);
          if (!get().configs.length) get().setConfigs(configs.map((c, i) => ({ ...c, initial_capital: amounts[i] })));
        } catch (e) { set({ error: e.message }); }
      }
    },
    refresh: async () => {
      if (refreshing || get().busy) return;
      refreshing = true;
      const epoch = mutationEpoch;
      try { const status = await api.status(); if (epoch === mutationEpoch) set({ status, connection: 'connected' }); }
      catch (e) { if (epoch === mutationEpoch) set({ connection: 'disconnected', checkedKey: null, error: e.message }); }
      finally { refreshing = false; }
    },
    check: async () => {
      if (get().busy || hasRunning(get().status)) return;
      const configs = structuredClone(get().configs);
      const errors = validateConfigs(configs);
      if (errors.length) { set({ error: errors.join(' ') }); return; }
      const key = configKey(configs);
      mutationEpoch += 1;
      set({ busy: 'check', checkedKey: null, error: '' });
      try {
        const status = await api.preflight(configs);
        set({ status, connection: 'connected', checkedKey: configKey(get().configs) === key ? key : null, step: 1 });
      } catch (e) { set({ error: e.message }); }
      finally { set({ busy: null }); }
    },
    start: async () => {
      if (!get().canStart()) { set({ error: 'Повторите проверку текущей конфигурации.' }); return; }
      const configs = structuredClone(get().configs);
      const id = get().status.preflight_id;
      mutationEpoch += 1;
      set({ busy: 'start', checkedKey: null, error: '' });
      try { const status = await api.start(configs, id); set({ status, connection: 'connected', step: 3 }); }
      catch (e) { set({ error: `${e.message} Статус запуска неизвестен; обновите состояние.`, connection: 'unknown' }); }
      finally { set({ busy: null }); }
    },
    stop: async () => {
      if (get().busy) return;
      mutationEpoch += 1;
      set({ busy: 'stop', error: '' });
      try { set({ status: await api.stop(), connection: 'connected', checkedKey: null }); }
      catch (e) { set({ error: e.message, connection: 'unknown' }); }
      finally { set({ busy: null }); }
    },
    optimize: async index => {
      if (get().busy) return;
      const config = structuredClone(get().configs[index]);
      set({ busy: 'optimize', error: '' });
      try {
        const result = await api.optimize(optimizerRequest(config));
        set(s => ({ optimizations: { ...s.optimizations, [config.symbol]: { key: configKey([config]), result } }, step: 2 }));
      } catch (e) { set({ error: e.message }); }
      finally { set({ busy: null }); }
    },
    applyOptimization: index => {
      const config = get().configs[index];
      const saved = get().optimizations[config.symbol];
      if (!saved || saved.key !== configKey([config])) { set({ error: 'Настройки изменились после оптимизации. Повторите подбор.' }); return; }
      try { get().updateConfig(index, optimizedPatch(saved.result)); set({ step: 0 }); }
      catch (e) { set({ error: e.message }); }
    },
    loadEvents: async (runId, symbol) => {
      const requestId = ++eventRequest;
      if (!runId) { set({ events: [] }); return; }
      try { const payload = await api.events(runId, symbol); if (requestId === eventRequest) set({ events: payload.events.filter(e => e.run_id === runId) }); }
      catch (e) { if (requestId === eventRequest) set({ error: `Журнал: ${e.message}` }); }
    },
  }), {
    name: 'signalscript_pilot_wizard_v1', version: 1,
    storage: createJSONStorage(() => storage),
    partialize: s => ({ configs: s.configs, step: s.step }),
    merge: (saved, current) => ({ ...current, configs: Array.isArray(saved?.configs) ? saved.configs.filter(c => c && typeof c === 'object' && typeof c.symbol === 'string') : [], step: [0, 1, 2, 3].includes(saved?.step) ? saved.step : 0 }),
  }));
}
