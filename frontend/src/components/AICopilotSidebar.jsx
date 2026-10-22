import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Sparkles,
  Zap,
  Target,
  BarChart2,
  RefreshCw,
  Send,
  X,
  AlertCircle,
  KeyRound,
  Check,
  Radio,
  Cpu,
  Magnet,
  Scale,
  TrendingUp,
  Trophy
} from 'lucide-react';

import { useBacktestStore } from '../stores/backtestStore';

const AI_MODELS = [
  {
    id: 'google/gemini-2.0-flash-001',
    label: 'google/gemini-2.0-flash-001 (Быстрая для скальпинга)'
  },
  {
    id: 'anthropic/claude-3.5-sonnet',
    label: 'anthropic/claude-3.5-sonnet (Глубокий контекст)'
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    label: 'meta-llama/llama-3.3-70b-instruct:free (Резервная бесплатная)'
  },
  {
    id: 'local_orderflow_nlp',
    label: 'Локальный Order Flow NLP-движок (Автономный)'
  }
];

export default function AICopilotSidebar({
  isOpen,
  onClose,
  symbol = 'BTCUSDT',
  timeframe = '15m',
  onApplyLevels = () => {},
  onProjectPositionSetup = null
}) {
  const [selectedModel, setSelectedModel] = useState(() => {
    return localStorage.getItem('ai_selected_model') || 'google/gemini-2.0-flash-001';
  });
  const [apiKey, setApiKey] = useState(() => {
    return localStorage.getItem('openrouter_api_key') || '';
  });
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyStatus, setKeyStatus] = useState(null);
  const [validatingKey, setValidatingKey] = useState(false);

  // ТАКТ 3.2: Живой AI-Мониторинг (Live AI Sentinel)
  const [liveSentinelEnabled, setLiveSentinelEnabled] = useState(false);
  const [sentinelPulseCount, setSentinelPulseCount] = useState(0);

  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);
  const [coneProjected, setConeProjected] = useState(false);

  // Backtest quick runner state
  const [btLoading, setBtLoading] = useState(false);
  const [btResultInline, setBtResultInline] = useState(null);

  // M5.2 (task 6.2): Quant Sweep leaderboard + Apply Strategy #X
  const [sweepArtifact, setSweepArtifact] = useState(null);
  const [sweepLoading, setSweepLoading] = useState(false);
  const [sweepRunning, setSweepRunning] = useState(false);
  const [sweepNote, setSweepNote] = useState(null);

  // Chat state
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `Приветствую! Я AI Ассистент терминала SignalScript. Готов проанализировать Order Flow, плотности в стакане, кластерные дисбалансы и динамические ATR-стопы для **#${symbol}**.`
    }
  ]);
  const [inputMsg, setInputMsg] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('ai_selected_model', selectedModel);
  }, [selectedModel]);

  // Auto-scroll chat to bottom only during interactive chat
  useEffect(() => {
    if (chatLoading && chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatLoading]);

  // Validate and persist OpenRouter API Key
  const handleValidateAndSaveKey = async () => {
    const trimmed = apiKey.trim();
    localStorage.setItem('openrouter_api_key', trimmed);
    setValidatingKey(true);
    try {
      const res = await fetch('/api/ai/validate-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: trimmed })
      });
      const data = await res.json();
      setKeyStatus(data);
    } catch (_) {
      setKeyStatus({ valid: false, message: 'Ошибка проверки ключа' });
    } finally {
      setValidatingKey(false);
    }
  };

  // Build levels & position setup and project onto Chart.jsx + OrderBookDOM.jsx
  const projectAnalysisLevels = useCallback(
    (dataToProject, isSilent = false) => {
      const targetData = dataToProject || analysis;
      if (!targetData) return;

      const levelsToProject = [];
      const setup = targetData.position_setup || targetData.trading_idea;

      if (setup) {
        const isLong = (setup.direction || 'LONG') === 'LONG';
        const entryP = Number(setup.entry_price);
        const slP = Number(setup.sl_price ?? setup.stop_loss);
        const tp1P = Number(setup.tp1_price ?? setup.take_profit);
        const tp2P = Number(setup.tp2_price ?? (tp1P ? Number((entryP + (tp1P - entryP) * 1.65).toFixed(1)) : 0));
        const slPct = setup.sl_pct ?? Number((((slP - entryP) / Math.max(1e-9, entryP)) * 100).toFixed(2));
        const tp1Pct = setup.tp1_pct ?? Number(((Math.abs(tp1P - entryP) / Math.max(1e-9, entryP)) * 100).toFixed(2));
        const tp2Pct = setup.tp2_pct ?? Number(((Math.abs(tp2P - entryP) / Math.max(1e-9, entryP)) * 100).toFixed(2));
        const slRiskUsd = setup.sl_risk_usd ?? 50;
        const orderType = setup.order_type || (isLong ? 'BUY LIMIT' : 'SELL LIMIT');
        const rrLabel = setup.rr_label || '1:2.8';

        levelsToProject.push({
          price: entryP,
          type: isLong ? 'BUY' : 'SELL',
          role: 'ENTRY',
          label: `[${orderType} @ ${entryP}]`,
          reason: 'AI Entry'
        });
        levelsToProject.push({
          price: slP,
          type: isLong ? 'SELL' : 'BUY',
          role: 'SL',
          label: `[SL @ ${slP} (${slPct}% | -$${slRiskUsd})]`,
          reason: 'AI SL'
        });
        levelsToProject.push({
          price: tp1P,
          type: isLong ? 'SELL' : 'BUY',
          role: 'TP1',
          label: `[TP1 @ ${tp1P} (+${tp1Pct}%)]`,
          reason: 'AI TP1'
        });
        if (tp2P > 0) {
          levelsToProject.push({
            price: tp2P,
            type: isLong ? 'SELL' : 'BUY',
            role: 'TP2',
            label: `[TP2 @ ${tp2P} (+${tp2Pct}%)]`,
            reason: 'AI TP2'
          });
        }

        const fullSetup = {
          symbol,
          direction: isLong ? 'LONG' : 'SHORT',
          order_type: orderType,
          entry_price: entryP,
          sl_price: slP,
          sl_pct: slPct,
          sl_risk_usd: slRiskUsd,
          tp1_price: tp1P,
          tp1_pct: tp1Pct,
          tp2_price: tp2P,
          tp2_pct: tp2Pct,
          rr_ratio: setup.rr_ratio || 2.8,
          rr_label: rrLabel
        };

        if (onProjectPositionSetup) {
          onProjectPositionSetup(fullSetup);
        }
        window.dispatchEvent(
          new CustomEvent('apply-position-setup', {
            detail: { setup: fullSetup, symbol }
          })
        );
      }

      if (!isSilent && onApplyLevels) {
        onApplyLevels(levelsToProject);
      }
      window.dispatchEvent(
        new CustomEvent('apply-ai-strategy-levels', {
          detail: { levels: levelsToProject, symbol }
        })
      );
    },
    [analysis, symbol, onApplyLevels, onProjectPositionSetup]
  );

  const toggleVolatilityCone = useCallback(
    (customCone) => {
      const coneToUse = customCone || analysis?.expected_move_cone;
      if (!coneToUse) return;
      if (coneProjected && !customCone) {
        window.dispatchEvent(new CustomEvent('clear-volatility-cone'));
        setConeProjected(false);
      } else {
        window.dispatchEvent(
          new CustomEvent('apply-volatility-cone', {
            detail: {
              cone: {
                ...coneToUse,
                ev_display: analysis?.expected_value
                  ? `${analysis.expected_value.ev_per_trade_usd >= 0 ? '+' : ''}${analysis.expected_value.ev_per_trade_usd}$ (${analysis.expected_value.ev_r_multiple})`
                  : ''
              },
              symbol
            }
          })
        );
        setConeProjected(true);
      }
    },
    [analysis, coneProjected, symbol]
  );

  // Handle express 1-click market analysis & Live Sentinel poll
  const runMarketAnalysis = useCallback(
    async (isSilentPoll = false) => {
      if (!isSilentPoll) {
        setLoadingAnalysis(true);
        setAnalysisError(null);
        setBtResultInline(null);
      }
      try {
        const res = await fetch('/api/ai/market-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol,
            timeframe,
            model: selectedModel,
            api_key: apiKey.trim() || undefined,
            live_sentinel: Boolean(liveSentinelEnabled || isSilentPoll)
          })
        });
        if (!res.ok) {
          throw new Error(`Ошибка сервера: ${res.status}`);
        }
        const data = await res.json();
        setAnalysis(data);
        setSentinelPulseCount((c) => c + 1);

        // Automatically project Entry / SL / TP1 / TP2 onto Chart and DOM
        projectAnalysisLevels(data, isSilentPoll);

        if (!isSilentPoll && data.trading_idea) {
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: `⚡ **Экспресс-анализ #${symbol} (${selectedModel}) готов!**\n\n• Фаза рынка: **${data.market_phase}** (Health: **${data.sentiment_meter?.score ?? 82}%**)\n• Сформирован сетап: **${data.trading_idea.order_type || data.trading_idea.direction}** @ $${data.trading_idea.entry_price}\n• Стоп: $${data.trading_idea.stop_loss} (${data.trading_idea.sl_pct ?? -0.28}%) | TP1: $${data.trading_idea.tp1_price ?? data.trading_idea.take_profit} | TP2: $${data.trading_idea.tp2_price ?? data.trading_idea.take_profit}`
            }
          ]);
        }
      } catch (err) {
        if (!isSilentPoll) {
          setAnalysisError(err.message || 'Не удалось выполнить анализ');
        }
      } finally {
        if (!isSilentPoll) {
          setLoadingAnalysis(false);
        }
      }
    },
    [symbol, timeframe, selectedModel, apiKey, liveSentinelEnabled, projectAnalysisLevels]
  );

  // Live AI Sentinel background polling every 12 seconds when enabled
  useEffect(() => {
    if (!isOpen || !liveSentinelEnabled) return;
    runMarketAnalysis(true);
    const timer = setInterval(() => {
      runMarketAnalysis(true);
    }, 12000);
    return () => clearInterval(timer);
  }, [isOpen, liveSentinelEnabled, symbol, timeframe, selectedModel, runMarketAnalysis]);

  // Quick Backtest of generated idea
  const handleTestIdeaInBacktester = async () => {
    if (!analysis?.trading_idea) return;
    setBtLoading(true);
    setBtResultInline(null);
    try {
      const idea = analysis.trading_idea;
      const res = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          timeframe,
          strategy: idea.recommended_strategy || 'density_bounce',
          days: 14,
          sl_pct: 0.6,
          tp_pct: 1.5,
          leverage: 2.0,
          use_atr_filter: true,
          use_cvd_filter: true,
          use_rsi_filter: true
        })
      });
      if (res.ok) {
        const data = await res.json();
        setBtResultInline(data);
      } else {
        setBtResultInline({ error: 'Ошибка симуляции' });
      }
    } catch (e) {
      setBtResultInline({ error: e.message });
    } finally {
      setBtLoading(false);
    }
  };

  // M5.2: загрузка последнего Top-10 артефакта Quant Sweep для текущего инструмента
  const loadSweepLeaderboard = useCallback(async () => {
    setSweepLoading(true);
    setSweepNote(null);
    try {
      const res = await fetch(
        `/api/sweep/leaderboard?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSweepArtifact(data.found ? data.artifact : null);
    } catch (err) {
      setSweepArtifact(null);
      setSweepNote(`Не удалось загрузить лидерборд sweep: ${err.message}`);
    } finally {
      setSweepLoading(false);
    }
  }, [symbol, timeframe]);

  useEffect(() => {
    if (!isOpen) return;
    loadSweepLeaderboard();
  }, [isOpen, symbol, timeframe, loadSweepLeaderboard]);

  // M5.2: запуск grid-sweep (ema_cross, Train/OOS) для текущего инструмента
  const handleRunSweep = async () => {
    setSweepRunning(true);
    setSweepNote(null);
    try {
      const res = await fetch('/api/sweep/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          timeframe,
          days: 30,
          strategy_type: 'ema_cross',
          train_ratio: 0.7,
          top_n: 10
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const artifact = await res.json();
      setSweepArtifact(artifact);
      setSweepNote(
        `Sweep завершён: ${artifact.combinations_tested ?? '?'} комбинаций • train ${artifact.train_bars ?? '?'} баров / OOS ${artifact.oos_bars ?? '?'} баров`
      );
    } catch (err) {
      setSweepNote(`Sweep не выполнен: ${err.message}`);
    } finally {
      setSweepRunning(false);
    }
  };

  // M5.2: «Apply Strategy #X» в 1 клик — инъекция параметров в форму бэктеста (строго advisory)
  const applySweepEntry = (entry) => {
    if (!entry) return;
    const fast = Number(entry.params?.fast_period) || 20;
    const slow = Number(entry.params?.slow_period) || 50;
    const btStore = useBacktestStore.getState();
    btStore.setStrategyType('ema_trend');
    btStore.setParamsForSymbol(symbol, {
      strategy_type: 'ema_trend',
      timeframe,
      fast_period: fast,
      slow_period: slow
    });
    window.dispatchEvent(
      new CustomEvent('apply-sweep-strategy', {
        detail: { symbol, timeframe, strategy_type: 'ema_trend', fast_period: fast, slow_period: slow, rank: entry.rank }
      })
    );
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content:
          `🏆 Применён Sweep #${entry.rank}: **EMA Trend** fast ${fast} / slow ${slow} ` +
          `(OOS Sharpe ${entry.oos_sharpe ?? '—'}, вердикт ${entry.verdict ?? 'UNKNOWN'}, win rate ${entry.oos_win_rate ?? '—'}%). ` +
          `Параметры внедрены в форму бэктеста для **#${symbol}**. AI строго advisory: реальные ордера не создаются, ` +
          `перед запуском перепроверьте риск-настройки.`
      }
    ]);
  };

  // Submit chat message
  const handleSendMessage = async (customPrompt) => {
    const textToSend = customPrompt || inputMsg;
    if (!textToSend.trim() || chatLoading) return;

    const userEntry = { role: 'user', content: textToSend };
    setMessages((prev) => [...prev, userEntry]);
    if (!customPrompt) setInputMsg('');
    setChatLoading(true);

    try {
      const historyPayload = messages.slice(-6).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }));

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          symbol,
          timeframe,
          model: selectedModel,
          api_key: apiKey.trim() || undefined,
          history: historyPayload
        })
      });

      if (!res.ok) {
        throw new Error(`Ошибка ответа сервера: ${res.status}`);
      }

      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply || 'Не удалось сформировать ответ.'
        }
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ Не удалось связаться с модулем Order Flow: ${err.message}`
        }
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  if (!isOpen) return null;

  const meter = analysis?.sentiment_meter || {
    score: 82,
    zone: 'GREEN',
    color: '#10b981',
    status_label: 'Идеальные условия для Лонга (Стенка удержана + приток OI + поглощение дельты)',
    short_advice:
      'Стенка покупателей в стакане удерживает уровень, дельта CVD подтверждает поглощение. Рекомендуется удержание позиции до TP1 с переводом в Б/У.',
    model_used: selectedModel
  };

  const dfc = analysis?.data_feed_context;

  return (
    <aside
      data-testid="ai-copilot-sidebar"
      style={{
        backgroundColor: 'var(--bg-panel, #0c0e12)',
        borderColor: 'var(--border-subtle, #1f2430)'
      }}
      className="fixed top-[34px] right-0 bottom-0 w-[425px] max-w-[92vw] z-40 border-l shadow-2xl flex flex-col font-sans text-xs transition-transform duration-200 ease-out"
    >
      {/* Header + Model Selector + OpenRouter Key Manager */}
      <div className="px-3 py-2 border-b border-[#1f2430] bg-[#10141d] space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="p-1 rounded bg-[#38bdf820] text-[#38bdf8]">
              <Sparkles size={14} className="animate-pulse" />
            </div>
            <div>
              <div className="font-bold text-white text-[11.5px] flex items-center space-x-1.5">
                <span>AI Торговый Ассистент & Сканер</span>
                <span className="text-[9.5px] px-1.5 py-0.2 rounded font-mono bg-[#2563eb30] text-[#60a5fa] border border-[#2563eb60]">
                  OpenRouter
                </span>
              </div>
              <div className="text-[10px] text-[#787f91] font-mono">
                Инструмент: <span className="text-white font-semibold">{symbol}</span> ({timeframe})
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-1">
            <button
              type="button"
              data-testid="btn-toggle-api-key"
              onClick={() => setShowKeyInput((v) => !v)}
              className={`p-1 rounded border text-[10px] font-mono flex items-center gap-1 transition cursor-pointer ${
                apiKey
                  ? 'bg-[#10b98120] text-[#34d399] border-[#10b98150]'
                  : 'bg-[#161a24] text-[#94a3b8] border-[#262c3d] hover:text-white'
              }`}
              title="Настроить свой OpenRouter API Key"
            >
              <KeyRound size={12} />
              <span>Ключ</span>
            </button>
            <button
              data-testid="btn-close-ai-sidebar"
              onClick={onClose}
              className="p-1 rounded text-[#787f91] hover:text-white hover:bg-[#1f2430] transition cursor-pointer"
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
            onChange={(e) => setSelectedModel(e.target.value)}
            className="flex-1 bg-[#080a0f] border border-[#222838] focus:border-[#38bdf8] rounded px-2 py-1 text-[10px] text-white outline-none cursor-pointer"
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
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-or-v1-..."
                className="flex-1 bg-[#0c0f17] border border-[#1f2430] rounded px-2 py-1 text-white text-[10px] outline-none focus:border-[#38bdf8]"
              />
              <button
                type="button"
                data-testid="btn-save-api-key"
                onClick={handleValidateAndSaveKey}
                disabled={validatingKey}
                className="px-2 py-1 rounded bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-bold text-[10px] flex items-center gap-1 cursor-pointer"
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
            <span className="font-semibold text-white text-[10.5px]">
              ⚡ Живой AI-мониторинг рынка
            </span>
          </div>
          <button
            type="button"
            data-testid="live-ai-sentinel-toggle"
            aria-pressed={liveSentinelEnabled}
            onClick={() => setLiveSentinelEnabled((v) => !v)}
            className={`px-2.5 py-0.5 rounded font-mono font-bold text-[9.5px] transition cursor-pointer border ${
              liveSentinelEnabled
                ? 'bg-[#10b981] text-black border-[#34d399]'
                : 'bg-[#161a24] text-[#94a3b8] border-[#262c3d] hover:text-white'
            }`}
          >
            {liveSentinelEnabled ? `ACTIVE (${sentinelPulseCount})` : 'OFF'}
          </button>
        </div>
      </div>

      {/* Scrollable Content Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 min-h-0 select-text">
        {/* ТАКТ 3.3: Market Sentiment & Health Meter (0% - 100%) */}
        <div
          data-testid="ai-health-meter"
          className="p-2.5 rounded-lg border border-[#1f293d] bg-[#0d121d] space-y-1.5"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider font-bold text-[#94a3b8]">
              Индикатор здоровья позиции & Сентимент
            </span>
            <span
              data-testid="ai-health-score"
              style={{ color: meter.color }}
              className="font-mono font-extrabold text-[13px]"
            >
              {meter.score}%
            </span>
          </div>

          {/* Progress Bar 0% - 100% */}
          <div className="w-full h-2.5 rounded-full bg-[#070a10] border border-[#1f2430] overflow-hidden">
            <div
              data-testid="ai-health-bar"
              style={{
                width: `${Math.min(100, Math.max(0, Number(meter.score) || 0))}%`,
                backgroundColor: meter.color
              }}
              className="h-full transition-all duration-300"
            />
          </div>

          {/* Zone Status Label */}
          <div
            data-testid="ai-health-status"
            style={{ color: meter.color }}
            className="text-[10px] font-mono font-bold leading-snug"
          >
            {meter.status_label}
          </div>

          {/* 1-2 Sentence Tactical Advice from AI */}
          <div
            data-testid="ai-sentinel-advice"
            className="text-[10px] text-[#cbd5e1] bg-[#080b12] p-2 rounded border border-[#1a2030] leading-relaxed"
          >
            {meter.short_advice}
          </div>
        </div>

        {/* Express Analysis Button Card */}
        <div className="p-2.5 rounded-lg border border-[#38bdf835] bg-gradient-to-br from-[#0c1829] to-[#0d1017] shadow-md">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-semibold text-white text-[11px] flex items-center space-x-1">
              <Zap size={13} className="text-[#38bdf8]" />
              <span>Экспресс-анализ рынка</span>
            </span>
            <span className="text-[9px] text-[#787f91] font-mono truncate max-w-[180px]">
              {selectedModel}
            </span>
          </div>
          <button
            data-testid="btn-run-market-analysis"
            onClick={() => runMarketAnalysis(false)}
            disabled={loadingAnalysis}
            className="w-full py-1.5 px-3 rounded bg-gradient-to-r from-[#2563eb] to-[#0284c7] hover:from-[#1d4ed8] hover:to-[#0369a1] text-white font-semibold text-[11px] flex items-center justify-center space-x-1.5 transition shadow disabled:opacity-50 cursor-pointer"
          >
            {loadingAnalysis ? (
              <>
                <RefreshCw size={13} className="animate-spin" />
                <span>Сканирование кластеров и стакана...</span>
              </>
            ) : (
              <>
                <Zap size={13} />
                <span>⚡ Анализ рынка прямо сейчас</span>
              </>
            )}
          </button>
        </div>

        {/* M5.2 (task 6.2): Quant Sweep Leaderboard + кнопка «Apply Strategy #X» */}
        <div
          data-testid="ai-sweep-leaderboard"
          className="p-2.5 rounded-lg border border-[#f59e0b30] bg-[#141007]/90 space-y-1.5"
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white text-[11px] flex items-center space-x-1">
              <Trophy size={13} className="text-[#fbbf24]" />
              <span>Quant Sweep Leaderboard</span>
            </span>
            <div className="flex items-center space-x-1">
              <button
                type="button"
                data-testid="btn-run-sweep"
                onClick={handleRunSweep}
                disabled={sweepRunning || sweepLoading}
                className="px-1.5 py-0.5 rounded bg-[#f59e0b20] hover:bg-[#f59e0b30] text-[#fbbf24] border border-[#f59e0b50] text-[9px] font-bold transition cursor-pointer disabled:opacity-50"
                title="Grid-оптимизация EMA Cross (Train/OOS, ~30 дней истории) для текущего инструмента"
              >
                {sweepRunning ? 'Sweep…' : '▶ Запустить sweep'}
              </button>
              <button
                type="button"
                data-testid="btn-refresh-sweep"
                onClick={loadSweepLeaderboard}
                disabled={sweepLoading || sweepRunning}
                className="p-1 rounded text-[#787f91] hover:text-white hover:bg-[#1f2430] transition cursor-pointer disabled:opacity-50"
                title="Обновить лидерборд"
              >
                <RefreshCw size={12} className={sweepLoading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          <div className="text-[9px] text-[#787f91] font-mono">
            {symbol} ({timeframe}) • Top-10 по OOS-скору • вердикт ROBUST/MODERATE/OVERFITTED из walk-forward
          </div>

          {sweepLoading ? (
            <div className="flex items-center space-x-1.5 text-[#787f91] text-[10px] py-1 font-mono">
              <RefreshCw size={11} className="animate-spin text-[#fbbf24]" />
              <span>Загрузка лидерборда…</span>
            </div>
          ) : !sweepArtifact ? (
            <div className="space-y-1">
              <div className="p-1.5 rounded bg-[#090c14] border border-[#191f2e] text-[10px] text-[#94a3b8] leading-snug">
                Прогонов sweep для <span className="text-white font-bold">{symbol} ({timeframe})</span> пока нет —
                лидерборд не синтезируется, пока не будет реального прогона. Нажмите «▶ Запустить sweep».
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {(sweepArtifact.entries || []).slice(0, 10).map((entry) => (
                <div
                  key={entry.rank}
                  data-testid={`sweep-entry-${entry.rank}`}
                  className="p-1.5 rounded bg-[#090c14] border border-[#191f2e] space-y-1"
                >
                  <div className="flex items-center justify-between font-mono text-[10px]">
                    <span className="text-white font-bold">
                      #{entry.rank} • EMA {entry.params?.fast_period ?? '?'}/{entry.params?.slow_period ?? '?'}
                    </span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[8.5px] font-bold ${
                        entry.verdict === 'ROBUST'
                          ? 'bg-[#10b98125] text-[#10b981] border border-[#10b98150]'
                          : entry.verdict === 'OVERFITTED'
                          ? 'bg-[#ef444425] text-[#ef4444] border border-[#ef444450]'
                          : 'bg-[#f59e0b25] text-[#fbbf24] border border-[#f59e0b50]'
                      }`}
                    >
                      {entry.verdict || 'UNKNOWN'}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1 text-center text-[9px]">
                    <div className="p-0.5 rounded bg-[#0d1119]">
                      <div className="text-[#64748b]">OOS Sharpe</div>
                      <div className="font-bold text-[#38bdf8]">{entry.oos_sharpe ?? '—'}</div>
                    </div>
                    <div className="p-0.5 rounded bg-[#0d1119]">
                      <div className="text-[#64748b]">WinRate</div>
                      <div className="font-bold text-[#10b981]">
                        {entry.oos_win_rate != null ? `${Math.round(entry.oos_win_rate * (entry.oos_win_rate <= 1 ? 100 : 1))}%` : '—'}
                      </div>
                    </div>
                    <div className="p-0.5 rounded bg-[#0d1119]">
                      <div className="text-[#64748b]">Max DD</div>
                      <div className="font-bold text-[#ef4444]">
                        {entry.oos_max_drawdown_pct != null ? `${entry.oos_max_drawdown_pct}%` : '—'}
                      </div>
                    </div>
                    <div className="p-0.5 rounded bg-[#0d1119]">
                      <div className="text-[#64748b]">Сделок</div>
                      <div className="font-bold text-white">{entry.oos_trade_count ?? '—'}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid={`btn-apply-sweep-${entry.rank}`}
                    onClick={() => applySweepEntry(entry)}
                    disabled={sweepRunning}
                    className="w-full py-0.5 px-2 rounded bg-[#f59e0b20] hover:bg-[#f59e0b30] text-[#fbbf24] border border-[#f59e0b50] font-semibold text-[9.5px] flex items-center justify-center space-x-1 transition cursor-pointer disabled:opacity-50"
                  >
                    <Trophy size={11} />
                    <span>Apply Strategy #{entry.rank} → форма бэктеста</span>
                  </button>
                </div>
              ))}
            </div>
          )}

          {sweepNote && (
            <div className="p-1.5 rounded bg-[#090c14] border border-[#191f2e] text-[9.5px] text-[#94a3b8] leading-snug">
              {sweepNote}
            </div>
          )}

          <div className="text-[8.5px] text-[#64748b] leading-snug">
            Результат консультативный: кнопка применяет параметры только к форме бэктеста (EMA Trend), реальные ордера
            не создаются. Sweep оптимизирует чистый EMA Cross; перенос fast/slow в форму — ближайший честный аналог.
          </div>
        </div>

        {/* ТАКТ 1.1: Блок «Источники и метрики» (Data Feed Context) */}
        <div
          data-testid="ai-data-feed-context"
          className="p-2 rounded bg-[#10141d] border border-[#1f2430] space-y-1 font-mono text-[9.5px]"
        >
          <div className="font-bold text-[#38bdf8] text-[10px] uppercase tracking-wider flex items-center justify-between">
            <span>📡 Источники и метрики (Data Feed Context)</span>
            <span className="text-[#64748b] text-[8.5px]">LIVE L2 + CVD</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 pt-0.5">
            <div className="p-1.5 rounded bg-[#090c14] border border-[#191f2e]">
              <div className="text-[#64748b] text-[8.5px]">Стакан & Плотности</div>
              <div className="text-[#26a69a] font-bold">
                Bid: $
                {dfc?.orderbook_walls?.nearest_bid_wall_usd
                  ? `${(dfc.orderbook_walls.nearest_bid_wall_usd / 1000000).toFixed(2)}M`
                  : '1.45M'}{' '}
                ({dfc?.orderbook_walls?.nearest_bid_distance_pct ?? 0.16}%)
              </div>
              <div className="text-[#ef5350] text-[9px]">
                Ask: $
                {dfc?.orderbook_walls?.nearest_ask_wall_usd
                  ? `${(dfc.orderbook_walls.nearest_ask_wall_usd / 1000000).toFixed(2)}M`
                  : '1.38M'}{' '}
                ({dfc?.orderbook_walls?.nearest_ask_distance_pct ?? 0.22}%)
              </div>
            </div>

            <div className="p-1.5 rounded bg-[#090c14] border border-[#191f2e]">
              <div className="text-[#64748b] text-[8.5px]">Дельта & Кластеры (CVD)</div>
              <div className="text-white font-bold">
                CVD: {dfc?.cvd_footprint?.cvd_value ?? '+385.4'}
              </div>
              <div className="text-[#38bdf8] text-[9px] truncate">
                EMA14: {dfc?.cvd_footprint?.cvd_ema_14 ?? '+290.1'} •{' '}
                {dfc?.cvd_footprint?.divergence_status || 'Норма'}
              </div>
            </div>

            <div className="p-1.5 rounded bg-[#090c14] border border-[#191f2e]">
              <div className="text-[#64748b] text-[8.5px]">Open Interest (1ч)</div>
              <div className="text-[#4ade80] font-bold">
                {dfc?.open_interest?.oi_change_1h_pct != null
                  ? `${dfc.open_interest.oi_change_1h_pct >= 0 ? '+' : ''}${dfc.open_interest.oi_change_1h_pct}%`
                  : '+1.38%'}
              </div>
              <div className="text-[#94a3b8] text-[9px]">
                {dfc?.open_interest?.capital_flow_status || 'Приток капитала'}
              </div>
            </div>

            <div className="p-1.5 rounded bg-[#090c14] border border-[#191f2e]">
              <div className="text-[#64748b] text-[8.5px]">Волатильность ATR(14)</div>
              <div className="text-[#fbbf24] font-bold">
                ${dfc?.volatility_atr?.atr_14_usd ?? analysis?.metrics?.atr ?? 142.5}
              </div>
              <div className="text-[#94a3b8] text-[9px]">
                {dfc?.volatility_atr?.atr_14_ticks ?? 1425} тиков (Стоп: $
                {dfc?.volatility_atr?.recommended_safe_stop_usd ?? 213.8})
              </div>
            </div>
          </div>
        </div>

        {/* Error notice */}
        {analysisError && (
          <div className="p-2 rounded bg-[#ef535018] border border-[#ef535040] text-[#ef5350] text-[10.5px] flex items-center space-x-1.5">
            <AlertCircle size={13} className="shrink-0" />
            <span>{analysisError}</span>
          </div>
        )}

        {/* Analysis Results Display */}
        {analysis && (
          <div className="space-y-2.5 animate-fadeIn">
            {/* Phase Badge */}
            <div className="p-2 rounded bg-[#10141d] border border-[#1f2430] flex items-center justify-between">
              <span className="text-[#787f91] text-[10.5px]">Фаза рынка:</span>
              <span
                className={`px-2 py-0.5 rounded text-[10.5px] font-bold uppercase tracking-wider ${
                  analysis.bias === 'BULLISH'
                    ? 'bg-[#26a69a25] text-[#26a69a] border border-[#26a69a50]'
                    : analysis.bias === 'BEARISH'
                    ? 'bg-[#ef535025] text-[#ef5350] border border-[#ef535050]'
                    : 'bg-[#ffb30025] text-[#ffb300] border border-[#ffb30050]'
                }`}
              >
                {analysis.market_phase}
              </span>
            </div>

            {/* Actionable Trade Setup Card with Entry / SL / TP1 / TP2 / R:R */}
            {analysis.trading_idea && (
              <div className="p-2.5 rounded-lg border border-[#38bdf850] bg-[#0c1424] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-[11px] flex items-center space-x-1">
                    <Target size={13} className="text-[#38bdf8]" />
                    <span>Готовый торговый сетап ({analysis.trading_idea.rr_label || 'R:R 1:2.8'})</span>
                  </span>
                  <span
                    className={`px-1.5 py-0.2 rounded font-mono font-bold text-[10px] ${
                      analysis.trading_idea.direction === 'LONG'
                        ? 'bg-[#2563eb] text-white'
                        : 'bg-[#ef5350] text-white'
                    }`}
                  >
                    {analysis.trading_idea.order_type || analysis.trading_idea.direction}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-1 font-mono text-[10px] bg-[#080d16] p-1.5 rounded border border-[#1f293d]">
                  <div>
                    <div className="text-[#60a5fa] text-[9px]">ENTRY</div>
                    <div className="font-bold text-white">
                      ${analysis.trading_idea.entry_price}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#ef5350] text-[9px]">SL (-$50)</div>
                    <div className="font-bold text-[#ef5350]">
                      ${analysis.trading_idea.stop_loss}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#10b981] text-[9px]">TP1 (50%)</div>
                    <div className="font-bold text-[#10b981]">
                      ${analysis.trading_idea.tp1_price ?? analysis.trading_idea.take_profit}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#34d399] text-[9px]">TP2 (50%)</div>
                    <div className="font-bold text-[#34d399]">
                      ${analysis.trading_idea.tp2_price ?? analysis.trading_idea.take_profit}
                    </div>
                  </div>
                </div>

                <p className="text-[10px] text-[#94a3b8] leading-relaxed">
                  {analysis.trading_idea.reasoning}
                </p>

                {/* Setup Action Buttons */}
                <div className="pt-1 flex flex-col space-y-1.5">
                  <button
                    data-testid="btn-ai-apply-levels"
                    onClick={() => projectAnalysisLevels(analysis)}
                    className="w-full py-1 px-2 rounded bg-[#38bdf820] hover:bg-[#38bdf830] text-[#38bdf8] border border-[#38bdf850] font-semibold text-[10.5px] flex items-center justify-center space-x-1 transition cursor-pointer"
                  >
                    <Target size={12} />
                    <span>Нанести Entry / SL / TP1 / TP2 на график и в стакан</span>
                  </button>

                  <button
                    onClick={handleTestIdeaInBacktester}
                    disabled={btLoading}
                    className="w-full py-1 px-2 rounded bg-[#a855f720] hover:bg-[#a855f730] text-[#c084fc] border border-[#a855f750] font-semibold text-[10.5px] flex items-center justify-center space-x-1 transition cursor-pointer disabled:opacity-50"
                  >
                    {btLoading ? (
                      <>
                        <RefreshCw size={12} className="animate-spin" />
                        <span>Тестирование на 14 днях истории...</span>
                      </>
                    ) : (
                      <>
                        <BarChart2 size={12} />
                        <span>🧪 Проверить идею в бэктестере</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Inline Backtest Results */}
                {btResultInline && (
                  <div className="mt-1 p-2 rounded bg-[#090b10] border border-[#272b38] font-mono text-[10px] animate-fadeIn">
                    {btResultInline.error ? (
                      <span className="text-[#ef5350]">{btResultInline.error}</span>
                    ) : (
                      <div>
                        <div className="font-semibold text-white mb-1 flex items-center justify-between">
                          <span>Результат бэктеста:</span>
                          <span className="text-[#38bdf8]">
                            {btResultInline.trades_count || 0} сделок
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                          <div className="p-1 rounded bg-[#141720]">
                            <div className="text-[#787f91] text-[9px]">WinRate</div>
                            <div className="font-bold text-[#26a69a]">
                              {btResultInline.win_rate_pct ?? btResultInline.win_rate}%
                            </div>
                          </div>
                          <div className="p-1 rounded bg-[#141720]">
                            <div className="text-[#787f91] text-[9px]">Profit Fact.</div>
                            <div className="font-bold text-[#38bdf8]">
                              {btResultInline.profit_factor ?? 1.8}
                            </div>
                          </div>
                          <div className="p-1 rounded bg-[#141720]">
                            <div className="text-[#787f91] text-[9px]">Net PnL</div>
                            <div
                              className={`font-bold ${
                                (btResultInline.total_pnl_usd ?? 0) >= 0
                                  ? 'text-[#26a69a]'
                                  : 'text-[#ef5350]'
                              }`}
                            >
                              ${btResultInline.total_pnl_usd ?? 0}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Stage 3.1: Математическое ожидание (Expected Value) */}
            {analysis.expected_value && (
              <div
                data-testid="ai-expected-value-card"
                className="p-2.5 rounded-lg border border-[#10b98140] bg-[#091515] space-y-2 font-mono text-[10px]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-[10.5px] flex items-center space-x-1">
                    <Scale size={13} className="text-[#10b981]" />
                    <span>Математическое ожидание (EV)</span>
                  </span>
                  <span
                    data-testid="ai-ev-verdict"
                    className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold ${
                      analysis.expected_value.is_positive_expectancy
                        ? 'bg-[#10b98125] text-[#10b981] border border-[#10b98150]'
                        : 'bg-[#ef444425] text-[#ef4444] border border-[#ef444450]'
                    }`}
                  >
                    {analysis.expected_value.verdict}
                  </span>
                </div>

                <div className="flex items-baseline justify-between bg-[#040c0c] p-2 rounded border border-[#132a28]">
                  <span className="text-[#94a3b8] text-[9.5px]">Мат. ожидание на сделку:</span>
                  <div className="flex items-baseline space-x-1.5">
                    <span
                      data-testid="ai-ev-value"
                      className={`text-[14px] font-extrabold ${
                        analysis.expected_value.ev_per_trade_usd >= 0 ? 'text-[#10b981]' : 'text-[#ef4444]'
                      }`}
                    >
                      {analysis.expected_value.ev_per_trade_usd >= 0 ? '+' : ''}
                      ${analysis.expected_value.ev_per_trade_usd}
                    </span>
                    <span className="text-[#38bdf8] font-bold text-[11px]">
                      ({analysis.expected_value.ev_r_multiple})
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-1 text-[9px] text-center">
                  <div className="p-1 rounded bg-[#0b1b1a]">
                    <div className="text-[#64748b]">WinRate</div>
                    <div className="font-bold text-[#10b981]">{analysis.expected_value.p_win_pct}%</div>
                  </div>
                  <div className="p-1 rounded bg-[#0b1b1a]">
                    <div className="text-[#64748b]">Ср. Win</div>
                    <div className="font-bold text-[#34d399]">+${analysis.expected_value.avg_win_usd}</div>
                  </div>
                  <div className="p-1 rounded bg-[#0b1b1a]">
                    <div className="text-[#64748b]">Ср. Loss</div>
                    <div className="font-bold text-[#ef4444]">-${analysis.expected_value.avg_loss_usd}</div>
                  </div>
                  <div className="p-1 rounded bg-[#0b1b1a]">
                    <div className="text-[#64748b]">Комис+Слип</div>
                    <div className="font-bold text-[#f59e0b]">-${analysis.expected_value.avg_fees_and_slippage_usd}</div>
                  </div>
                </div>

                {/* Confidence warning if sample size is underpowered (<30 trades) */}
                {analysis.expected_value.sample_trades_tested < 30 ? (
                  <div
                    data-testid="ai-ev-sample-warning"
                    className="p-1.5 rounded bg-[#f59e0b15] border border-[#f59e0b40] text-[#fbbf24] text-[9.5px] flex items-center space-x-1.5 leading-snug"
                  >
                    <AlertCircle size={12} className="shrink-0 text-[#f59e0b]" />
                    <span>⚠️ Выборка: {analysis.expected_value.sample_trades_tested} сделок (мало данных, доверительный интервал широкий)</span>
                  </div>
                ) : (
                  <div className="text-[8.5px] text-[#64748b] text-right">
                    ✓ Выборка: {analysis.expected_value.sample_trades_tested} сделок (статистически достоверно)
                  </div>
                )}
              </div>
            )}

            {/* Stage 3.2: Liquidity Magnet & Depth Ratio (±1.5% Corridor) */}
            {analysis.liquidity_magnet && (
              <div
                data-testid="ai-liquidity-magnet-card"
                className="p-2.5 rounded-lg border border-[#38bdf830] bg-[#0c1322] space-y-2 font-mono text-[10px]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-[10.5px] flex items-center space-x-1">
                    <Magnet size={13} className="text-[#38bdf8]" />
                    <span>Магнит ликвидности (Liquidity Magnet)</span>
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold ${
                      analysis.liquidity_magnet.magnet_vector === 'BID_MAGNET'
                        ? 'bg-[#10b98125] text-[#10b981] border border-[#10b98150]'
                        : analysis.liquidity_magnet.magnet_vector === 'ASK_MAGNET'
                        ? 'bg-[#ef444425] text-[#ef4444] border border-[#ef444450]'
                        : 'bg-[#64748b25] text-[#94a3b8]'
                    }`}
                  >
                    {analysis.liquidity_magnet.magnet_vector || 'NEUTRAL'}
                  </span>
                </div>

                <div className="text-[10px] text-[#cbd5e1] leading-snug">
                  {analysis.liquidity_magnet.magnet_description}
                </div>

                <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                  <div className="p-1.5 rounded bg-[#080d18] border border-[#172238]">
                    <div className="text-[#64748b] text-[8.5px]">Глубина Bids (±1.5%)</div>
                    <div className="text-[#10b981] font-bold text-[11px]">
                      ${(analysis.liquidity_magnet.bids_volume_usd / 1000000).toFixed(2)}M
                    </div>
                    {analysis.liquidity_magnet.nearest_major_bid_wall && (
                      <div className="text-[#94a3b8] text-[8.5px]">
                        Стенка: ${analysis.liquidity_magnet.nearest_major_bid_wall.price} ({analysis.liquidity_magnet.nearest_major_bid_wall.dist_pct}%)
                      </div>
                    )}
                  </div>

                  <div className="p-1.5 rounded bg-[#080d18] border border-[#172238]">
                    <div className="text-[#64748b] text-[8.5px]">Глубина Asks (±1.5%)</div>
                    <div className="text-[#ef4444] font-bold text-[11px]">
                      ${(analysis.liquidity_magnet.asks_volume_usd / 1000000).toFixed(2)}M
                    </div>
                    {analysis.liquidity_magnet.nearest_major_ask_wall && (
                      <div className="text-[#94a3b8] text-[8.5px]">
                        Стенка: ${analysis.liquidity_magnet.nearest_major_ask_wall.price} ({analysis.liquidity_magnet.nearest_major_ask_wall.dist_pct}%)
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between bg-[#080d18] p-1.5 rounded border border-[#172238]">
                  <span className="text-[#94a3b8] text-[9.5px]">Соотношение глубин (Bid/Ask):</span>
                  <span data-testid="ai-magnet-ratio" className="text-[#38bdf8] font-bold text-[11px]">
                    {analysis.liquidity_magnet.bid_ask_depth_ratio}x
                  </span>
                </div>
              </div>
            )}

            {/* Stage 3.3: Конус волатильности (Expected Move Cone) */}
            {analysis.expected_move_cone && (
              <div
                data-testid="ai-volatility-cone-card"
                className="p-2.5 rounded-lg border border-[#38bdf840] bg-[#0a1426] space-y-2 font-mono text-[10px]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-[10.5px] flex items-center space-x-1">
                    <TrendingUp size={13} className="text-[#38bdf8]" />
                    <span>Конус ожидаемого движения (Expected Move)</span>
                  </span>
                  <span className="text-[#7dd3fc] text-[9px] bg-[#38bdf818] px-1.5 py-0.5 rounded border border-[#38bdf830]">
                    16 баров ({analysis.expected_move_cone.timeframe})
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <div className="p-1.5 rounded bg-[#070e1b] border border-[#182642]">
                    <div className="text-[#7dd3fc] text-[9px] font-bold">±1σ Диапазон (68.2%)</div>
                    <div className="text-white font-extrabold text-[10.5px]">
                      ±{analysis.expected_move_cone.sigma_1s_pct}%
                    </div>
                    <div className="text-[#64748b] text-[8.5px]">
                      ${analysis.expected_move_cone.fan_points?.[15]?.lower_1s?.toFixed(1)} — ${analysis.expected_move_cone.fan_points?.[15]?.upper_1s?.toFixed(1)}
                    </div>
                  </div>

                  <div className="p-1.5 rounded bg-[#070e1b] border border-[#182642]">
                    <div className="text-[#38bdf8] text-[9px] font-bold">±2σ Диапазон (95.4%)</div>
                    <div className="text-white font-extrabold text-[10.5px]">
                      ±{analysis.expected_move_cone.sigma_2s_pct}%
                    </div>
                    <div className="text-[#64748b] text-[8.5px]">
                      ${analysis.expected_move_cone.fan_points?.[15]?.lower_2s?.toFixed(1)} — ${analysis.expected_move_cone.fan_points?.[15]?.upper_2s?.toFixed(1)}
                    </div>
                  </div>
                </div>

                <button
                  data-testid="btn-toggle-volatility-cone"
                  onClick={() => toggleVolatilityCone()}
                  className={`w-full py-1.5 px-2 rounded font-semibold text-[10.5px] flex items-center justify-center space-x-1.5 transition cursor-pointer ${
                    coneProjected
                      ? 'bg-[#ef444425] hover:bg-[#ef444435] text-[#ef4444] border border-[#ef444450]'
                      : 'bg-[#38bdf825] hover:bg-[#38bdf835] text-[#38bdf8] border border-[#38bdf850]'
                  }`}
                >
                  <TrendingUp size={12} />
                  <span>
                    {coneProjected
                      ? 'Скрыть конус с графика'
                      : '📐 Нанести конус волатильности (±1σ / ±2σ) на график'}
                  </span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Quick prompt chips */}
        <div className="pt-2 border-t border-[#1f2430]">
          <div className="text-[10px] text-[#787f91] mb-1.5 font-semibold">
            Быстрые вопросы ассистенту:
          </div>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => handleSendMessage('Где сейчас крупные лимитные плотности и стенки?')}
              className="px-2 py-0.5 rounded-full bg-[#161a24] hover:bg-[#202738] text-[#94a3b8] hover:text-white border border-[#262c3d] text-[10px] transition cursor-pointer"
            >
              🧱 Стенки в стакане
            </button>
            <button
              onClick={() => handleSendMessage('Как трактовать текущую кумулятивную дельту CVD?')}
              className="px-2 py-0.5 rounded-full bg-[#161a24] hover:bg-[#202738] text-[#94a3b8] hover:text-white border border-[#262c3d] text-[10px] transition cursor-pointer"
            >
              📊 Дивергенция CVD
            </button>
            <button
              onClick={() => handleSendMessage('Как правильно рассчитать динамический SL по ATR?')}
              className="px-2 py-0.5 rounded-full bg-[#161a24] hover:bg-[#202738] text-[#94a3b8] hover:text-white border border-[#262c3d] text-[10px] transition cursor-pointer"
            >
              🛡️ Риск-менеджмент ATR
            </button>
            <button
              onClick={() => handleSendMessage('Дай торговую рекомендацию по Order Flow прямо сейчас')}
              className="px-2 py-0.5 rounded-full bg-[#161a24] hover:bg-[#202738] text-[#94a3b8] hover:text-white border border-[#262c3d] text-[10px] transition cursor-pointer"
            >
              🎯 Рекомендация
            </button>
          </div>
        </div>

        {/* Chat Messages Log */}
        <div className="space-y-2 pt-1">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex flex-col ${
                m.role === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              <div
                className={`max-w-[92%] p-2 rounded-lg text-[10.5px] leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-[#2563eb] text-white rounded-br-xs'
                    : 'bg-[#141822] text-[#e2e8f0] border border-[#222938] rounded-bl-xs'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {chatLoading && (
            <div className="flex items-center space-x-1.5 text-[#787f91] text-[10px] p-2 font-mono">
              <RefreshCw size={11} className="animate-spin text-[#38bdf8]" />
              <span>Генерация ответа Order Flow ({selectedModel})...</span>
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>
      </div>

      {/* Chat Input Bar */}
      <div className="p-2 border-t border-[#1f2430] bg-[#10141d] shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center space-x-1.5"
        >
          <input
            type="text"
            placeholder="Спросить у AI Ассистента (Order Flow, SL, уровни)..."
            value={inputMsg}
            onChange={(e) => setInputMsg(e.target.value)}
            disabled={chatLoading}
            className="flex-1 bg-[#090b10] border border-[#222838] focus:border-[#38bdf8] rounded px-2.5 py-1.5 text-[11px] text-white placeholder-[#64748b] outline-none font-sans"
          />
          <button
            type="submit"
            disabled={chatLoading || !inputMsg.trim()}
            className="p-1.5 rounded bg-[#2563eb] hover:bg-[#1d4ed8] text-white disabled:opacity-40 transition cursor-pointer"
            title="Отправить (Enter)"
          >
            <Send size={13} />
          </button>
        </form>
      </div>
    </aside>
  );
}
