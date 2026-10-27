import React, { useEffect, useMemo, useState } from 'react';
import { Scale, Save, RotateCcw, CheckCircle, AlertTriangle } from 'lucide-react';

const API_BASE = '/api';
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'XRPUSDT', 'BNBUSDT'];

const FACTOR_LABELS = {
  wall: 'Стена ликвидности (обязательный гейт)',
  ema20_cross: 'EMA20 кросс (структура)',
  volume_multiplier: 'Всплеск объёма',
  delta_sign: 'Дельта по направлению',
  cvd_filter: 'CVD подтверждение',
  rsi_filter: 'RSI фильтр',
  atr_filter: 'ATR фильтр волатильности'
};

/**
 * Weighted Confluence editor (SRS M2.3).
 * Edits the per-symbol weight profile (Σw = 1) and threshold; the backend
 * validates again on PUT and rejects unnormalized profiles with 422.
 */
export default function ConfluenceWeightsEditor() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [weights, setWeights] = useState({});
  const [threshold, setThreshold] = useState(0.65);
  const [required, setRequired] = useState(['wall']);
  const [custom, setCustom] = useState(false);
  const [status, setStatus] = useState(null); // {type: 'ok'|'error', text}
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    fetch(`${API_BASE}/confluence/weights?symbol=${symbol}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(data => {
        if (cancelled) return;
        setWeights(data.weights || {});
        setThreshold(data.threshold ?? 0.65);
        setRequired(data.required || ['wall']);
        setCustom(Boolean(data.custom));
      })
      .catch(err => {
        if (!cancelled) setStatus({ type: 'error', text: `Не удалось загрузить профиль: ${err.message}` });
      });
    return () => { cancelled = true; };
  }, [symbol]);

  const weightSum = useMemo(
    () => Object.values(weights).reduce((acc, v) => acc + (Number(v) || 0), 0),
    [weights]
  );
  const sumOk = Math.abs(weightSum - 1.0) < 1e-6;

  const updateWeight = (name, raw) => {
    const value = Math.max(0, Number(raw) || 0);
    setWeights(prev => ({ ...prev, [name]: value }));
  };

  const toggleRequired = (name) => {
    setRequired(prev => (prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name]));
  };

  const normalize = () => {
    const total = Object.values(weights).reduce((acc, v) => acc + (Number(v) || 0), 0);
    if (total <= 0) return;
    setWeights(prev => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, Number(((Number(v) || 0) / total).toFixed(6))])));
  };

  const save = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(`${API_BASE}/confluence/weights?symbol=${symbol}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weights, threshold: Number(threshold), required })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setCustom(true);
      setStatus({ type: 'ok', text: `Профиль ${symbol} сохранён (Σw = 1, порог ${data.threshold})` });
    } catch (err) {
      setStatus({ type: 'error', text: `Ошибка сохранения: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const resetToDefaults = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(`${API_BASE}/confluence/factors`);
      const data = await res.json();
      setWeights(data.default_weights || {});
      setThreshold(data.default_threshold ?? 0.65);
      setRequired(data.default_required || ['wall']);
      setStatus({ type: 'ok', text: 'Сброшено к SRS-дефолтам (не забудьте сохранить)' });
    } catch (err) {
      setStatus({ type: 'error', text: `Не удалось получить дефолты: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-foreground font-bold text-xs flex items-center space-x-1.5">
          <Scale size={12} className="text-[#38bdf8]" />
          <span>Weighted Confluence (M2.3)</span>
        </label>
        <select
          value={symbol}
          onChange={e => setSymbol(e.target.value)}
          className="bg-[#14171f] border border-[#1f2430] rounded px-2 py-1 text-[11px] text-foreground"
        >
          {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="text-[10px] text-[#787f91]">
        Strict AND по обязательным факторам + взвешенный скор мягких факторов. Σ весов строго = 1.
        {custom && <span className="ml-1 text-[#38bdf8]">(пользовательский профиль)</span>}
      </div>

      <div className="space-y-1.5">
        {Object.entries(weights).map(([name, value]) => (
          <div key={name} className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={required.includes(name)}
              onChange={() => toggleRequired(name)}
              title="Обязательный фактор (Strict AND)"
              className="accent-[#38bdf8]"
            />
            <span className="flex-1 text-[11px] text-[#d1d4dc]">{FACTOR_LABELS[name] || name}</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={value}
              onChange={e => updateWeight(name, e.target.value)}
              className="w-20 bg-[#14171f] border border-[#1f2430] rounded px-1.5 py-0.5 text-[11px] text-right text-foreground"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-[11px]">
        <span className={sumOk ? 'text-bull' : 'text-warning'}>
          Σ весов = {weightSum.toFixed(4)} {sumOk ? '✓' : '(нужно 1.0000)'}
        </span>
        {!sumOk && (
          <button onClick={normalize} className="text-[#38bdf8] hover:underline">
            Нормализовать
          </button>
        )}
      </div>

      <div className="flex items-center space-x-2">
        <span className="text-[11px] text-[#d1d4dc]">Порог квалификации:</span>
        <input
          type="number"
          min="0.01"
          max="1"
          step="0.01"
          value={threshold}
          onChange={e => setThreshold(Math.min(1, Math.max(0.01, Number(e.target.value) || 0.65)))}
          className="w-20 bg-[#14171f] border border-[#1f2430] rounded px-1.5 py-0.5 text-[11px] text-right text-foreground"
        />
        <span className="text-[10px] text-[#787f91]">(SRS ≈ 0.65)</span>
      </div>

      {status && (
        <div className={`flex items-center space-x-1.5 text-[11px] ${status.type === 'ok' ? 'text-bull' : 'text-warning'}`}>
          {status.type === 'ok' ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
          <span>{status.text}</span>
        </div>
      )}

      <div className="flex items-center space-x-2 pt-1">
        <button
          onClick={save}
          disabled={loading || !sumOk}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-[#38bdf8]/20 border border-[#38bdf8]/40 text-[#38bdf8] text-[11px] font-semibold hover:bg-[#38bdf8]/30 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          <Save size={12} />
          <span>Сохранить профиль</span>
        </button>
        <button
          onClick={resetToDefaults}
          disabled={loading}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-[#14171f] border border-[#1f2430] text-[#787f91] text-[11px] hover:text-foreground transition"
        >
          <RotateCcw size={12} />
          <span>SRS-дефолты</span>
        </button>
      </div>
    </div>
  );
}
