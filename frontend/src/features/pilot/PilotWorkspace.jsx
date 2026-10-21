import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import { createPilotStore } from './store.js';
import { configKey, hasRunning, validateConfigs } from './model.js';
import PilotConfig, { button } from './PilotConfig.jsx';
import PilotResults from './PilotResults.jsx';
import PilotDashboard from './PilotDashboard.jsx';

const store = createPilotStore();
const steps = ['Конфигурация', 'Проверка', 'Сравнение', 'Запуск / отчёт'];

export function PilotWorkspace({ onClose }) {
  const state = useStore(store);
  const running = hasRunning(state.status);
  const errors = validateConfigs(state.configs);
  const current = state.checkedKey === configKey(state.configs);
  const runId = Object.values(state.status?.sessions || {})[0]?.run_id;
  useEffect(() => {
    void store.getState().initialize();
    const timer = setInterval(() => { void store.getState().refresh(); }, 5000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { if (state.step === 3) void store.getState().loadEvents(runId); }, [runId, state.step, state.status]);
  return <section data-testid="pilot-workspace" aria-label="Night Pilot" className="@container flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-neutral-950 text-neutral-200">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-neutral-800 p-3"><div><h1 className="text-sm font-semibold">Night Pilot <span className="ml-2 rounded bg-cyan-950 px-1.5 py-0.5 text-[10px] text-cyan-200">Виртуальные средства</span></h1><p className="mt-1 text-xs text-neutral-500">История → прогноз → проверка стратегии в реальном времени</p></div>{onClose && <button className={button} onClick={onClose} aria-label="Закрыть Night Pilot">Закрыть</button>}</header>
    <nav aria-label="Шаги запуска" className="grid shrink-0 grid-cols-2 gap-1 border-b border-neutral-800 p-2 @2xl:grid-cols-4">{steps.map((label, index) => <button key={label} aria-current={state.step === index ? 'step' : undefined} onClick={() => state.setStep(index)} className={`${button} ${state.step === index ? 'border-cyan-700 bg-cyan-950/40 text-cyan-100' : 'text-neutral-400'}`}>{index + 1}. {label}</button>)}</nav>
    <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
      {state.connection !== 'connected' && <div role="status" className="rounded border border-amber-800/50 p-2 text-xs text-amber-200">{state.connection === 'unknown' ? 'Восстанавливаем состояние backend…' : 'Backend недоступен. Показан последний снимок; состояние работы не подтверждено.'}<button className="ml-2 underline" onClick={state.refresh}>Обновить</button></div>}
      {state.error && <div role="alert" className="break-words rounded border border-red-800/50 p-2 text-xs text-red-300">{state.error}</div>}
      {running && <p className="text-xs text-cyan-200">Есть активная paper-сессия. Черновик следующего запуска можно редактировать; повторная проверка станет доступна после её остановки.</p>}
      {state.step === 0 && <><PilotConfig {...state} />{errors.length > 0 && <p className="text-xs text-amber-200">{errors.join(' ')}</p>}</>}
      {(state.step === 1 || state.step === 2) && <>{!current && <p className="text-xs text-amber-200">Показаны результаты предыдущей конфигурации либо проверка ещё не выполнена. Перед запуском повторите проверку.</p>}<PilotResults {...state} compare={state.step === 2} /></>}
      {state.step === 3 && <><div className="rounded border border-neutral-800 p-3 text-xs"><p>К запуску: {state.configs.map(c => `${c.symbol} · $${c.initial_capital} · ${c.duration_hours} ч`).join(' / ')}</p><p className="mt-1 text-neutral-500">После окончания срока наблюдение прекращается. Открытые позиции остаются в отчёте как открытые.</p></div><PilotDashboard status={state.status} events={state.events} /></>}
    </div>
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-neutral-800 p-3">
      <span className="text-xs text-neutral-500" role="status">{state.busy ? ({ check: 'История, прогноз и подбор: расчёт может занять несколько минут…', optimize: 'Проверяем параметры на walk-forward и holdout…', start: 'Запускаем…', stop: 'Останавливаем…' }[state.busy]) : current ? 'Конфигурация проверена' : 'Нужна проверка конфигурации'}</span>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={Boolean(state.busy) || running || errors.length > 0} onClick={state.check}>Проверить историю и прогноз</button>{running ? <button className={`${button} text-amber-200`} disabled={Boolean(state.busy)} onClick={state.stop}>Остановить все paper-сессии</button> : <button data-testid="pilot-start" className={`${button} border-cyan-700 bg-cyan-950 text-cyan-100`} disabled={!state.canStart()} onClick={() => state.step === 3 ? state.start() : state.setStep(3)}>{state.step === 3 ? 'Запустить paper-сессии' : 'Перейти к запуску'}</button>}</div>
    </footer>
  </section>;
}

export default function PilotDialog({ onClose }) {
  const dialog = useRef(null);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  return createPortal(<dialog ref={dialog} onCancel={onClose} aria-label="Настройка Night Pilot" className="fixed inset-0 m-auto h-[calc(100dvh-16px)] max-h-none w-[calc(100vw-16px)] max-w-none overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950 p-0 text-neutral-200 shadow-2xl backdrop:bg-black/70 sm:h-[calc(100dvh-48px)] sm:w-[calc(100vw-48px)]"><PilotWorkspace onClose={onClose} /></dialog>, document.body);
}
