import React from 'react';
import { Sparkles, KeyRound, X, Check, Radio, Cpu } from 'lucide-react';
import AI_MODELS from './constants';

// Шапка сайдбара AI Copilot (MODULARIZATION_PLAN п.7): заголовок + селектор модели,
// менеджер OpenRouter API Key и тумблер «⚡ Живой AI-мониторинг рынка» (Live AI Sentinel).
// Управляемый компонент — всё состояние и колбэки в AICopilotSidebar.

export default function CopilotHeader({
  symbol,
  timeframe,
  selectedModel,
  onModelChange,
  apiKey,
  onApiKeyChange,
  showKeyInput,
  onToggleKeyInput,
  keyStatus,
  onValidateAndSaveKey,
  validatingKey,
  liveSentinelEnabled,
  sentinelPulseCount,
  onToggleSentinel,
  onClose
}) {
  return (
    <div className="px-3 py-2 border-b border-[#1f2430] bg-[#10141d] space-y-2 shrink-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="p-1 rounded bg-[#38bdf820] text-[#38bdf8]">
            <Sparkles size={14} className="animate-pulse" />
          </div>
          <div>
            <div className="font-bold text-foreground text-[11.5px] flex items-center space-x-1.5">
              <span>AI Торговый Ассистент & Сканер</span>
              <span className="text-[9.5px] px-1.5 py-0.2 rounded font-mono bg-[#2563eb30] text-[#60a5fa] border border-[#2563eb60]">
                OpenRouter
              </span>
            </div>
            <div className="text-[10px] text-[#787f91] font-mono">
              Инструмент: <span className="text-foreground font-semibold">{symbol}</span> ({timeframe})
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-1">
          <button
            type="button"
            data-testid="btn-toggle-api-key"
            onClick={onToggleKeyInput}
            className={`p-1 rounded border text-[10px] font-mono flex items-center gap-1 transition cursor-pointer ${
              apiKey
                ? 'bg-[#10b98120] text-[#34d399] border-[#10b98150]'
                : 'bg-[#161a24] text-[#94a3b8] border-[#262c3d] hover:text-foreground'
            }`}
            title="Настроить свой OpenRouter API Key"
          >
            <KeyRound size={12} />
            <span>Ключ</span>
          </button>
          <button
            data-testid="btn-close-ai-sidebar"
            onClick={onClose}
            className="p-1 rounded text-[#787f91] hover:text-foreground hover:bg-[#1f2430] transition cursor-pointer"
            title="Закрыть сайдбар (Клавиша 'A')"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* ТАКТ 3.1: Выбор AI-модели */}
      <div className="flex items-center space-x-1.5 font-mono text-[10px]">
        <Cpu size={12} className="text-[#38bdf8] shrink-0" />
        <select
          data-testid="ai-model-selector"
          value={selectedModel}
          onChange={(e) => onModelChange(e.target.value)}
          className="flex-1 bg-[#080a0f] border border-[#222838] focus:border-[#38bdf8] rounded px-2 py-1 text-[10px] text-foreground outline-none cursor-pointer"
        >
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {/* Поле ввода собственного OpenRouter API Key */}
      {showKeyInput && (
        <div className="p-2 rounded bg-[#080a0f] border border-[#222838] space-y-1.5 font-mono text-[10px]">
          <div className="flex items-center justify-between text-[#94a3b8] text-[9.5px]">
            <span>OpenRouter API Key (localStorage):</span>
            {keyStatus && (
              <span className={keyStatus.valid ? 'text-[#10b981] font-bold' : 'text-[#f59e0b]'}>
                {keyStatus.valid ? '✓ Валиден' : 'Автономный NLP'}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-1">
            <input
              data-testid="openrouter-api-key-input"
              type="password"
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              placeholder="sk-or-v1-..."
              className="flex-1 bg-[#0c0f17] border border-[#1f2430] rounded px-2 py-1 text-foreground text-[10px] outline-none focus:border-[#38bdf8]"
            />
            <button
              type="button"
              data-testid="btn-save-api-key"
              onClick={onValidateAndSaveKey}
              disabled={validatingKey}
              className="px-2 py-1 rounded bg-[#2563eb] hover:bg-[#1d4ed8] text-foreground font-bold text-[10px] flex items-center gap-1 cursor-pointer"
            >
              <Check size={11} />
              <span>{validatingKey ? '...' : 'Сохранить'}</span>
            </button>
          </div>
          {keyStatus?.message && (
            <div className="text-[9px] text-[#94a3b8]">{keyStatus.message}</div>
          )}
        </div>
      )}

      {/* ТАКТ 3.2: Тумблер «⚡ Живой AI-мониторинг рынка» (Live AI Sentinel) */}
      <div className="flex items-center justify-between px-2.5 py-1.5 rounded bg-[#0a0f1c] border border-[#1e293b]">
        <div className="flex items-center space-x-1.5">
          <Radio
            size={13}
            className={liveSentinelEnabled ? 'text-[#10b981] animate-pulse' : 'text-[#64748b]'}
          />
          <span className="font-semibold text-foreground text-[10.5px]">
            ⚡ Живой AI-мониторинг рынка
          </span>
        </div>
        <button
          type="button"
          data-testid="live-ai-sentinel-toggle"
          aria-pressed={liveSentinelEnabled}
          onClick={onToggleSentinel}
          className={`px-2.5 py-0.5 rounded font-mono font-bold text-[9.5px] transition cursor-pointer border ${
            liveSentinelEnabled
              ? 'bg-[#10b981] text-black border-[#34d399]'
              : 'bg-[#161a24] text-[#94a3b8] border-[#262c3d] hover:text-foreground'
          }`}
        >
          {liveSentinelEnabled ? `ACTIVE (${sentinelPulseCount})` : 'OFF'}
        </button>
      </div>
    </div>
  );
}
