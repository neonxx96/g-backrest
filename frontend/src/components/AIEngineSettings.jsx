import React, { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Search, Star, Wifi } from 'lucide-react';

const API = '/api/ai';

export default function AIEngineSettings({ onConfigChange }) {
  const [config, setConfig] = useState({ selected_model: '', favorite_models: [], fallback_model: 'google/gemini-2.0-flash-001', temperature: 0.2 });
  const [models, setModels] = useState([]);
  const [tab, setTab] = useState('curated');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    Promise.all([fetch(`${API}/config`).then(r => r.json()), fetch(`${API}/models`).then(r => r.json())])
      .then(([saved, catalog]) => { setConfig(saved); setModels(catalog.models || []); onConfigChange?.(saved); })
      .catch(() => setMessage('AI Hub недоступен: backend требует перезапуска с новой версией.'))
      .finally(() => setLoading(false));
  }, [onConfigChange]);

  const filtered = useMemo(() => models.filter(model => {
    const starred = (config.favorite_models || []).includes(model.id);
    const roleMatch = (model.recommended_for || []).length > 0;
    const tabMatch = tab === 'all' || (tab === 'free' && model.is_free) || (tab === 'starred' && starred) || (tab === 'curated' && roleMatch);
    const text = `${model.id} ${model.name}`.toLowerCase();
    return tabMatch && text.includes(query.toLowerCase());
  }), [config.favorite_models, models, query, tab]);

  const save = async (next = config, test = false) => {
    setMessage('');
    const response = await fetch(`${API}/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
    if (!response.ok) throw new Error('Не удалось сохранить AI-конфигурацию');
    const saved = await response.json(); setConfig(saved); onConfigChange?.(saved);
    if (test) {
      const probe = await fetch(`${API}/test-connection`, { method: 'POST' }).then(r => r.json());
      setMessage(`${probe.status}: ${probe.model} · ${probe.latency_ms} ms`);
    } else setMessage('AI-конфигурация сохранена');
  };

  const toggleFavorite = (id) => save({ ...config, favorite_models: (config.favorite_models || []).includes(id) ? config.favorite_models.filter(item => item !== id) : [...config.favorite_models, id] });
  const select = (id) => save({ ...config, selected_model: id });

  if (loading) return <div className="py-10 flex justify-center text-[#818cf8]"><Loader2 className="animate-spin" size={18} /></div>;
  return <div className="space-y-3">
    <div className="rounded border border-[#2a3150] bg-[#10131a] p-3 space-y-2">
      <div className="text-white font-bold">AI Engine Settings</div>
      <div className="flex gap-2"><input value={config.selected_model} onChange={e => setConfig({ ...config, selected_model: e.target.value })} placeholder="provider/model-id" className="flex-1 bg-[#090b10] border border-[#283044] rounded px-2 py-1.5 text-white" /><button onClick={() => save(config, true).catch(e => setMessage(e.message))} className="px-2 rounded bg-[#4f46e5] text-white text-[10px] font-bold">Сохранить и тест</button></div>
      <div className="flex items-center gap-2 text-[10px] text-[#98a3b8]">Temperature <input type="number" min="0" max="2" step="0.1" value={config.temperature} onChange={e => setConfig({ ...config, temperature: Number(e.target.value) })} className="w-14 bg-[#090b10] border border-[#283044] rounded px-1 py-0.5 text-white" /> <Wifi size={11} className="text-[#22c55e]" /> {message}</div>
    </div>
    <div className="flex flex-wrap gap-1">{[['curated','Рекомендуемые'],['free','Бесплатные'],['all','Все'],['starred','Избранное']].map(([id,label]) => <button key={id} onClick={() => setTab(id)} className={`px-2 py-1 rounded ${tab === id ? 'bg-[#312e81] text-[#c4b5fd]' : 'bg-[#151924] text-[#8d98ad]'}`}>{label}</button>)}</div>
    <div className="relative"><Search size={12} className="absolute left-2 top-2 text-[#71809b]" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск модели или вендора" className="w-full bg-[#090b10] border border-[#283044] rounded pl-7 pr-2 py-1.5 text-white" /></div>
    <div className="max-h-64 overflow-y-auto space-y-1 pr-1">{filtered.map(model => { const active = config.selected_model === model.id; const starred = (config.favorite_models || []).includes(model.id); return <div key={model.id} className={`border rounded p-2 ${active ? 'border-[#6366f1] bg-[#151633]' : 'border-[#202738] bg-[#0e1118]'}`}><div className="flex justify-between gap-2"><div className="min-w-0"><div className="text-white font-semibold truncate">{model.name}</div><div className="text-[10px] text-[#8792a8] truncate">{model.id} · {model.context_length?.toLocaleString()} ctx</div><div className="flex gap-1 mt-1">{model.is_free ? <span className="rounded bg-[#064e3b] px-1 text-[9px] text-[#6ee7b7]">FREE</span> : <span className="rounded bg-[#31251a] px-1 text-[9px] text-[#fbbf24]">${Number(model.pricing?.prompt || 0) * 1000000}/M</span>}{(model.recommended_for || []).map(role => <span key={role} className="rounded bg-[#1e293b] px-1 text-[9px] text-[#93c5fd]">{role.replaceAll('_', ' ')}</span>)}</div></div><div className="flex gap-1 shrink-0"><button onClick={() => toggleFavorite(model.id)} className="p-1 text-[#fbbf24]"><Star size={13} fill={starred ? 'currentColor' : 'none'} /></button><button onClick={() => select(model.id)} className="p-1 text-[#86efac]">{active ? <Check size={13} /> : 'Выбрать'}</button></div></div></div>})}</div>
  </div>;
}
