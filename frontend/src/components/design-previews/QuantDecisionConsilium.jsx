import React, { useState } from 'react';
import {
  BrainCircuit,
  Copy,
  Check,
  ShieldAlert,
  ShieldCheck,
  Zap,
  Target,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Layers,
  Sparkles,
} from 'lucide-react';

/**
 * QuantDecisionConsilium
 * Displays:
 * 1. Core 3 (Cold Quant) evaluation: Depth Delta Skew, Liq Magnet, R:R calculation, VETO trigger.
 * 2. Cores 1 & 2: One-Click LLM Context Prompt Generator ("Скопировать слепок для ИИ").
 * 3. Shadow Quarantine commit button.
 */
export default function QuantDecisionConsilium({
  symbol = 'BTCUSDT',
  core3Report = null,
  promptData = null,
  onCommitQuarantine,
  isCommitting = false,
  quarantineSaved = false,
}) {
  const [copied, setCopied] = useState(false);
  const [showPromptDetails, setShowPromptDetails] = useState(false);

  const handleCopyPrompt = () => {
    if (!promptData?.markdown_prompt) return;
    navigator.clipboard.writeText(promptData.markdown_prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const isVeto = core3Report?.verdict?.startsWith('VETO');

  return (
    <div
      className="flex flex-col gap-2.5 p-3 rounded border font-sans text-xs"
      style={{
        backgroundColor: 'var(--panel)',
        borderColor: 'var(--border)',
        color: 'var(--text-1)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-1.5 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-1.5">
          <BrainCircuit size={15} style={{ color: 'var(--accent)' }} />
          <span className="font-bold text-[12px] tracking-wide">
            КОНСИЛИУМ 3 ЯДЕР · QUANT ENGINE
          </span>
        </div>

        <div className="flex items-center gap-1 font-mono text-[10px]">
          <span
            className="px-1.5 py-0.5 rounded border font-semibold"
            style={{
              backgroundColor: isVeto ? 'rgba(228, 120, 109, 0.12)' : 'rgba(70, 201, 154, 0.12)',
              borderColor: isVeto ? 'rgba(228, 120, 109, 0.3)' : 'rgba(70, 201, 154, 0.3)',
              color: isVeto ? 'var(--down)' : 'var(--up)',
            }}
          >
            {core3Report ? core3Report.verdict : 'CALCULATING...'}
          </span>
        </div>
      </div>

      {/* Core 3: Cold Quant Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[11px]">
        {/* Metric 1: Depth Delta */}
        <div className="p-2 rounded border" style={{ backgroundColor: 'var(--raised)', borderColor: 'var(--border)' }}>
          <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>Spot Delta (2.5%)</div>
          <div
            className="font-bold mt-0.5"
            style={{
              color: (core3Report?.depth_delta_skew_pct || 0) >= 0 ? 'var(--up)' : 'var(--down)',
            }}
          >
            {core3Report?.depth_delta_skew_pct ? `${core3Report.depth_delta_skew_pct > 0 ? '+' : ''}${core3Report.depth_delta_skew_pct}%` : '0.0%'}
          </div>
          <div className="text-[9px]" style={{ color: 'var(--text-2)' }}>
            {core3Report?.depth_bias || 'BALANCED'}
          </div>
        </div>

        {/* Metric 2: Risk / Reward */}
        <div className="p-2 rounded border" style={{ backgroundColor: 'var(--raised)', borderColor: 'var(--border)' }}>
          <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>Calculated R:R</div>
          <div
            className="font-bold mt-0.5"
            style={{
              color: (core3Report?.risk_reward_ratio || 0) >= 2.0 ? 'var(--up)' : 'var(--warn)',
            }}
          >
            1:{core3Report ? core3Report.risk_reward_ratio : '0.0'}
          </div>
          <div className="text-[9px]" style={{ color: 'var(--text-2)' }}>
            {(core3Report?.risk_reward_ratio || 0) >= 2.0 ? 'ПОРОГ ПРОЙДЕН' : 'MIN 1:2.0 ТРЕБУЕТСЯ'}
          </div>
        </div>

        {/* Metric 3: Entry / SL */}
        <div className="p-2 rounded border" style={{ backgroundColor: 'var(--raised)', borderColor: 'var(--border)' }}>
          <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>Entry / Stop-Loss</div>
          <div className="font-bold mt-0.5" style={{ color: 'var(--text-1)' }}>
            ${core3Report?.suggested_entry ? core3Report.suggested_entry.toLocaleString() : '---'}
          </div>
          <div className="text-[9px]" style={{ color: 'var(--down)' }}>
            SL: ${core3Report?.suggested_stop_loss ? core3Report.suggested_stop_loss.toLocaleString() : '---'}
          </div>
        </div>

        {/* Metric 4: TP Magnet */}
        <div className="p-2 rounded border" style={{ backgroundColor: 'var(--raised)', borderColor: 'var(--border)' }}>
          <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>Liq Magnet (Take Profit)</div>
          <div className="font-bold mt-0.5" style={{ color: 'var(--up)' }}>
            ${core3Report?.suggested_take_profit ? core3Report.suggested_take_profit.toLocaleString() : '---'}
          </div>
          <div className="text-[9px]" style={{ color: 'var(--text-2)' }}>
            {core3Report?.strongest_liq_magnet || 'N/A'}
          </div>
        </div>
      </div>

      {/* Decision Reasons List */}
      <div className="flex flex-col gap-1 text-[11px] font-mono">
        <span className="text-[10px] uppercase font-bold" style={{ color: 'var(--text-3)' }}>
          Факторы решения (Ядро 3):
        </span>
        <ul className="list-disc pl-4 flex flex-col gap-0.5" style={{ color: 'var(--text-2)' }}>
          {(core3Report?.verdict_reasons || []).map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
      </div>

      {/* Action Buttons: One-Click Prompt & Quarantine */}
      <div className="pt-2 border-t flex items-center justify-between gap-2 flex-wrap" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          {/* One-Click Copy Prompt Button (Cores 1 & 2) */}
          <button
            type="button"
            onClick={handleCopyPrompt}
            className="px-3 py-1.5 rounded font-mono font-semibold text-[11px] flex items-center gap-1.5 transition cursor-pointer border"
            style={{
              backgroundColor: copied ? 'var(--ok)' : 'var(--raised)',
              borderColor: copied ? 'var(--ok)' : 'var(--border)',
              color: copied ? '#000' : 'var(--text-1)',
            }}
            title="Скопировать готовый институциональный промпт со слепком стакана и ликвидаций"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? 'СЛЕПОК СКОПИРОВАН!' : 'СКОПИРОВАТЬ СЛЕПОК ДЛЯ ИИ'}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowPromptDetails(!showPromptDetails)}
            className="text-[10px] font-mono underline hover:text-[var(--text-1)] cursor-pointer"
            style={{ color: 'var(--text-3)' }}
          >
            {showPromptDetails ? 'Скрыть промпт' : 'Показать промпт'}
          </button>
        </div>

        {/* Quarantine Commit Button */}
        <button
          type="button"
          onClick={onCommitQuarantine}
          disabled={isCommitting || isVeto}
          className="px-3 py-1.5 rounded font-mono font-semibold text-[11px] flex items-center gap-1.5 transition cursor-pointer border"
          style={{
            backgroundColor: isVeto
              ? 'rgba(100, 108, 115, 0.1)'
              : quarantineSaved
              ? 'var(--ok)'
              : 'var(--accent)',
            borderColor: isVeto ? 'var(--border)' : 'transparent',
            color: isVeto ? 'var(--text-3)' : '#000',
            opacity: isVeto ? 0.6 : 1,
            cursor: isVeto ? 'not-allowed' : 'pointer',
          }}
          title={isVeto ? 'Заблокировано: R:R или сентимент не прошли фильтр' : 'Зафиксировать сигнал в Shadow Quarantine'}
        >
          <Target size={13} />
          <span>
            {isVeto
              ? 'ВЕТО: КАРАНТИН ЗАБЛОКИРОВАН'
              : quarantineSaved
              ? 'СИГНАЛ В КАРАНТИНЕ ✓'
              : isCommitting
              ? 'ФИКСАЦИЯ...'
              : 'ЗАФИКСИРОВАТЬ В КАРАНТИН'}
          </span>
        </button>
      </div>

      {/* Expanded Prompt View */}
      {showPromptDetails && promptData && (
        <div
          className="p-2.5 rounded border font-mono text-[10px] whitespace-pre-wrap max-h-48 overflow-y-auto mt-1"
          style={{
            backgroundColor: 'var(--bg)',
            borderColor: 'var(--border)',
            color: 'var(--text-2)',
          }}
        >
          {promptData.markdown_prompt}
        </div>
      )}
    </div>
  );
}
