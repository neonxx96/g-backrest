/**
 * Institutional Price Alerts Modal (Velo / Bookmap Style)
 * Precision alert manager: Condition triggers, multi-channel dispatch,
 * execution frequency, and expiration controls with deep monochrome UI.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Bell,
  X,
  Send,
  Check,
  Trash2,
  Play,
  Pause,
  AlertCircle,
  Sliders,
  Radio,
  ExternalLink,
  ChevronDown
} from 'lucide-react';
import { useAlertsStore } from '../../stores/alertsStore';
import { resolveAlertPriceInput } from '../../services/marketTruth.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.jsx';

const CONDITIONS = [
  'Crosses above',
  'Crosses below',
  'Greater than or equal',
  'Less than or equal',
  'Enters price band',
  'Exits price band'
];

const CHANNELS = [
  { id: 'in_app', label: 'In-app Pop-up', badge: 'DESKTOP' },
  { id: 'telegram', label: 'Telegram Bot', badge: 'BOT' },
  { id: 'discord', label: 'Discord Webhook', badge: 'DISCORD' },
  { id: 'webhook', label: 'Custom Webhook', badge: 'HTTP' }
];

const EXPIRATIONS = [
  'Never',
  '1 hour',
  '24 hours',
  '7 days',
  '30 days'
];

export default function AlertsModal({ currentSymbol = 'BTCUSDT', currentPrice = null }) {
  const isOpen = useAlertsStore((s) => s.isAlertsModalOpen);
  const closeAlertsModal = useAlertsStore((s) => s.closeAlertsModal);
  const prefill = useAlertsStore((s) => s.modalPrefill);
  const alerts = useAlertsStore((s) => s.alerts);
  const addAlert = useAlertsStore((s) => s.addAlert);
  const removeAlert = useAlertsStore((s) => s.removeAlert);
  const toggleAlert = useAlertsStore((s) => s.toggleAlert);
  const testAlert = useAlertsStore((s) => s.testAlert);
  const currentPriceRef = useRef(currentPrice);
  currentPriceRef.current = currentPrice;

  const [activeTab, setActiveTab] = useState('create'); // 'create' | 'list'

  // Form State
  const [symbol, setSymbol] = useState(currentSymbol);
  const [condition, setCondition] = useState('Crosses above');
  const [price, setPrice] = useState(currentPrice ? String(currentPrice) : '');
  const [alertName, setAlertName] = useState('');
  const [selectedChannels, setSelectedChannels] = useState(['in_app']);
  const [triggerType, setTriggerType] = useState('once'); // 'once' | 'repeat'
  const [repeatIntervalSec, setRepeatIntervalSec] = useState('60');
  const [expiresAt, setExpiresAt] = useState('24 hours');
  const [testSent, setTestSent] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Sync prefill on open
  useEffect(() => {
    if (isOpen) {
      const sym = prefill?.symbol || currentSymbol || 'BTCUSDT';
      const p = resolveAlertPriceInput(prefill?.price, currentPriceRef.current);
      setSymbol(sym);
      setPrice(p);
      setAlertName(prefill?.name || `${sym} ${condition}${p ? ` $${p}` : ''}`);
      setErrorMsg('');
      setTestSent(false);
    }
  }, [isOpen, prefill, currentSymbol]);

  if (!isOpen) return null;

  const toggleChannel = (chId) => {
    if (selectedChannels.includes(chId)) {
      if (selectedChannels.length === 1) return; // keep at least 1
      setSelectedChannels(selectedChannels.filter((c) => c !== chId));
    } else {
      setSelectedChannels([...selectedChannels, chId]);
    }
  };

  const handleSendTest = () => {
    const numPrice = Number(price);
    if (!Number.isFinite(numPrice) || numPrice <= 0) {
      setErrorMsg('Введите реальную цену уровня перед тестированием алерта');
      return;
    }
    setTestSent(true);
    testAlert({
      symbol,
      condition,
      price: numPrice,
      name: alertName || `${symbol} Test Alert`,
      channels: selectedChannels
    });
    setTimeout(() => setTestSent(false), 2500);
  };

  const handleCreateAlert = (e) => {
    e.preventDefault();
    const numPrice = parseFloat(price);
    if (!Number.isFinite(numPrice) || numPrice <= 0) {
      setErrorMsg('Пожалуйста, введите корректную цену срабатывания');
      return;
    }

    addAlert({
      symbol: symbol.toUpperCase().trim(),
      condition,
      price: numPrice,
      name: alertName.trim() || `${symbol} ${condition} $${numPrice}`,
      channels: selectedChannels,
      triggerType,
      repeatIntervalSec: triggerType === 'repeat' ? parseInt(repeatIntervalSec, 10) || 60 : null,
      expiresAt
    });

    closeAlertsModal();
  };

  return (
    <div
      data-testid="alerts-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 font-sans select-none"
      onClick={closeAlertsModal}
    >
      <div
        className="w-full max-w-lg bg-[#0b0e11] border border-neutral-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-[#e5e7eb] animate-fadeIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 bg-[#0e1217] border-b border-neutral-800/80 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Bell size={14} />
            </div>
            <div>
              <h2 className="text-xs font-bold text-white tracking-wide uppercase flex items-center gap-1.5">
                <span>Ценовые алерты</span>
                <span className="text-[11px] text-muted-foreground font-mono font-normal">
                  [{symbol}]
                </span>
              </h2>
              <p className="text-[11px] text-muted-foreground font-mono">
                Institutional Alert Dispatcher & Triggers
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1">
            {/* Tab switch */}
            <div className="flex items-center bg-[#07090b] rounded-lg p-0.5 border border-neutral-800 text-[10.5px] font-mono mr-2">
              <button
                type="button"
                onClick={() => setActiveTab('create')}
                className={`px-2 py-0.5 rounded transition cursor-pointer ${
                  activeTab === 'create'
                    ? 'bg-neutral-800 text-white font-bold'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Создать
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('list')}
                className={`px-2 py-0.5 rounded transition cursor-pointer flex items-center gap-1 ${
                  activeTab === 'list'
                    ? 'bg-neutral-800 text-white font-bold'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                <span>Активные</span>
                <span className="px-1 rounded bg-neutral-900 text-neutral-300 text-[9px]">
                  {alerts.length}
                </span>
              </button>
            </div>

            <button
              onClick={closeAlertsModal}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-800 transition cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        {activeTab === 'create' ? (
          <form onSubmit={handleCreateAlert} className="p-4 space-y-4 overflow-y-auto min-h-0 flex-1">
            {errorMsg && (
              <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center space-x-2">
                <AlertCircle size={14} />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* SECTION 1: WHAT */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400 uppercase tracking-wider">
                <span className="font-bold text-neutral-300">1. Что (Условие срабатывания)</span>
                <span className="text-[10px] text-blue-400">WHAT</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-muted-foreground font-mono mb-1">
                    Условие
                  </label>
                  <Select value={condition} onValueChange={setCondition}>
                    <SelectTrigger className="h-8 text-xs bg-background border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITIONS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="block text-[11px] text-muted-foreground font-mono mb-1">
                    Цена уровня ($)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="0.00"
                    required
                    className="w-full bg-[#07090b] border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-muted-foreground font-mono mb-1">
                  Название / Описание алерта
                </label>
                <input
                  type="text"
                  value={alertName}
                  onChange={(e) => setAlertName(e.target.value)}
                  placeholder={`Напр.: ${symbol} Пробой ключевого сопротивления`}
                  className="w-full bg-[#07090b] border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-neutral-600 outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* SECTION 2: WHERE */}
            <div className="space-y-2 pt-2 border-t border-neutral-800/60">
              <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400 uppercase tracking-wider">
                <span className="font-bold text-neutral-300">2. Куда отправить</span>
                <span className="text-[10px] text-blue-400">WHERE</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {CHANNELS.map((ch) => {
                  const isActive = selectedChannels.includes(ch.id);
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => toggleChannel(ch.id)}
                      className={`flex items-center justify-between px-2.5 py-2 rounded-lg border text-left transition cursor-pointer ${
                        isActive
                          ? 'bg-blue-600/10 border-blue-500/50 text-white'
                          : 'bg-[#07090b] border-neutral-800/80 text-neutral-400 hover:text-white hover:border-neutral-700'
                      }`}
                    >
                      <div>
                        <div className="text-[11px] font-medium">{ch.label}</div>
                        <div className="text-[9px] font-mono text-neutral-500">{ch.badge}</div>
                      </div>
                      <div
                        className={`w-4 h-4 rounded flex items-center justify-center border ${
                          isActive
                            ? 'bg-blue-600 border-blue-400 text-white'
                            : 'border-neutral-800 bg-neutral-900'
                        }`}
                      >
                        {isActive && <Check size={11} strokeWidth={3} />}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="flex justify-end pt-0.5">
                <button
                  type="button"
                  onClick={handleSendTest}
                  disabled={testSent}
                  className="px-2.5 py-1 rounded bg-[#07090b] border border-neutral-800 hover:border-neutral-700 text-neutral-300 hover:text-white text-[10.5px] font-mono flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Send size={11} className={testSent ? 'text-green-400' : 'text-neutral-400'} />
                  <span>{testSent ? 'Тест отправлен ✓' : 'Send test'}</span>
                </button>
              </div>
            </div>

            {/* SECTION 3: TRIGGER */}
            <div className="space-y-2 pt-2 border-t border-neutral-800/60">
              <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400 uppercase tracking-wider">
                <span className="font-bold text-neutral-300">3. Тип триггера</span>
                <span className="text-[10px] text-blue-400">TRIGGER</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label
                  className={`flex items-center space-x-2 px-3 py-2 rounded-lg border cursor-pointer transition ${
                    triggerType === 'once'
                      ? 'bg-neutral-800/50 border-blue-500/60 text-white'
                      : 'bg-[#07090b] border-neutral-800 text-neutral-400'
                  }`}
                >
                  <input
                    type="radio"
                    name="triggerType"
                    checked={triggerType === 'once'}
                    onChange={() => setTriggerType('once')}
                    className="accent-blue-500"
                  />
                  <div>
                    <div className="text-[11px] font-medium text-white">Один раз (Once)</div>
                    <div className="text-[9.5px] text-neutral-500 font-mono">Деактивировать после триггера</div>
                  </div>
                </label>

                <label
                  className={`flex items-center space-x-2 px-3 py-2 rounded-lg border cursor-pointer transition ${
                    triggerType === 'repeat'
                      ? 'bg-neutral-800/50 border-blue-500/60 text-white'
                      : 'bg-[#07090b] border-neutral-800 text-neutral-400'
                  }`}
                >
                  <input
                    type="radio"
                    name="triggerType"
                    checked={triggerType === 'repeat'}
                    onChange={() => setTriggerType('repeat')}
                    className="accent-blue-500"
                  />
                  <div>
                    <div className="text-[11px] font-medium text-white">Повторять (Repeat)</div>
                    <div className="text-[9.5px] text-neutral-500 font-mono">Каждые X секунд</div>
                  </div>
                </label>
              </div>

              {triggerType === 'repeat' && (
                <div className="flex items-center space-x-2 bg-[#07090b] border border-neutral-800 rounded-lg p-2 animate-fadeIn">
                  <span className="text-[10.5px] font-mono text-neutral-400">Интервал:</span>
                  <input
                    type="number"
                    min="5"
                    max="86400"
                    value={repeatIntervalSec}
                    onChange={(e) => setRepeatIntervalSec(e.target.value)}
                    className="w-20 bg-neutral-900 border border-neutral-700 rounded px-2 py-0.5 text-xs text-white font-mono text-center outline-none focus:border-blue-500"
                  />
                  <span className="text-[10.5px] font-mono text-neutral-400">секунд</span>
                </div>
              )}
            </div>

            {/* SECTION 4: EXPIRES */}
            <div className="space-y-2 pt-2 border-t border-neutral-800/60">
              <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400 uppercase tracking-wider">
                <span className="font-bold text-neutral-300">4. Истечение</span>
                <span className="text-[10px] text-blue-400">EXPIRES</span>
              </div>

              <Select value={expiresAt} onValueChange={setExpiresAt}>
                <SelectTrigger className="h-8 text-xs bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRATIONS.map((exp) => (
                    <SelectItem key={exp} value={exp}>
                      {exp}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Actions */}
            <div className="pt-3 border-t border-neutral-800 flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={closeAlertsModal}
                className="px-3 py-1.5 rounded-lg border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 text-xs font-mono transition cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-mono font-bold transition shadow-lg shadow-blue-600/20 cursor-pointer"
              >
                Создать алерт
              </button>
            </div>
          </form>
        ) : (
          /* Active Alerts List */
          <div className="p-4 space-y-2 overflow-y-auto min-h-0 flex-1">
            {alerts.length === 0 ? (
              <div className="p-8 text-center text-neutral-500 text-xs font-mono">
                Нет активных алертов. Перейдите во вкладку «Создать» для добавления.
              </div>
            ) : (
              alerts.map((a) => (
                <div
                  key={a.id}
                  className="p-2.5 rounded-lg bg-[#07090b] border border-neutral-800/80 flex items-center justify-between text-xs font-mono"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-white text-[11px]">{a.symbol}</span>
                      <span className="text-[11px] text-muted-foreground">{a.condition}</span>
                      <span className="font-bold text-blue-400">${a.price}</span>
                      <span
                        className={`text-[8.5px] px-1.5 py-0.2 rounded font-bold uppercase ${
                          a.status === 'active'
                            ? 'bg-green-500/10 text-green-400 border border-green-500/30'
                            : 'bg-neutral-800 text-neutral-400'
                        }`}
                      >
                        {a.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate max-w-xs">
                      {a.name}
                    </div>
                  </div>

                  <div className="flex items-center space-x-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleAlert(a.id)}
                      title={a.status === 'active' ? 'Поставить на паузу' : 'Возобновить'}
                      className="p-1.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-700 transition cursor-pointer"
                    >
                      {a.status === 'active' ? <Pause size={12} /> : <Play size={12} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeAlert(a.id)}
                      title="Удалить алерт"
                      className="p-1.5 rounded bg-neutral-900 border border-neutral-800 text-red-400 hover:text-red-300 hover:border-red-500/40 transition cursor-pointer"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
