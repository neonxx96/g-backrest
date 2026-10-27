import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, AlertCircle } from 'lucide-react';

import { useBacktestStore } from '../stores/backtestStore';
import CopilotHeader from './copilot/CopilotHeader';
import HealthMeterCard from './copilot/HealthMeterCard';
import ExpressAnalysisCard from './copilot/ExpressAnalysisCard';
import SweepLeaderboardCard from './copilot/SweepLeaderboardCard';
import DataFeedContextCard from './copilot/DataFeedContextCard';
import AnalysisResults from './copilot/AnalysisResults';
import QuickPromptChips from './copilot/QuickPromptChips';
import ChatMessages from './copilot/ChatMessages';

// AI Copilot Sidebar (MODULARIZATION_PLAN п.7): UI разбит на управляемые карточки
// в ./copilot/ (CopilotHeader, HealthMeterCard, ExpressAnalysisCard, SweepLeaderboardCard,
// DataFeedContextCard, AnalysisResults -> TradeSetupCard/ExpectedValueCard/
// LiquidityMagnetCard/VolatilityConeCard, QuickPromptChips, ChatMessages).
// Здесь остались только состояние, эффекты и обработчики (fetch к /api/ai/*,
// проекция уровней на график/стакан, sweep-лидерборд, чат).
// Поведение и data-testid — 1:1 с оригиналом.

export default function AICopilotSidebar({
  isOpen,
  onClose,
  symbol = 'BTCUSDT',
  timeframe = '15m',
  onApplyLevels = () => {},
  onProjectPositionSetup = null
}) {
  const [selectedModel, setSelectedModel] = useState(() => {
    // 'auto' — бэкенд сам выберет бесплатную модель OpenRouter из .env
    // и переключится на следующую при ошибке (каскад в ai_service).
    return localStorage.getItem('ai_selected_model') || 'auto';
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
            // 'auto' → не отправляем model: бэкенд возьмёт бесплатную из .env + каскад
            ...(selectedModel !== 'auto' ? { model: selectedModel } : {}),
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
              content: `⚡ **Экспресс-анализ #${symbol} (${selectedModel === 'auto' ? 'бесплатная OpenRouter' : selectedModel}) готов!**\n\n• Фаза рынка: **${data.market_phase}** (Health: **${data.sentiment_meter?.score ?? 82}%**)\n• Сформирован сетап: **${data.trading_idea.order_type || data.trading_idea.direction}** @ $${data.trading_idea.entry_price}\n• Стоп: $${data.trading_idea.stop_loss} (${data.trading_idea.sl_pct ?? -0.28}%) | TP1: $${data.trading_idea.tp1_price ?? data.trading_idea.take_profit} | TP2: $${data.trading_idea.tp2_price ?? data.trading_idea.take_profit}`
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
          ...(selectedModel !== 'auto' ? { model: selectedModel } : {}),
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
      {/* Header + Model Selector + OpenRouter Key Manager + Live Sentinel toggle */}
      <CopilotHeader
        symbol={symbol}
        timeframe={timeframe}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        apiKey={apiKey}
        onApiKeyChange={setApiKey}
        showKeyInput={showKeyInput}
        onToggleKeyInput={() => setShowKeyInput((v) => !v)}
        keyStatus={keyStatus}
        onValidateAndSaveKey={handleValidateAndSaveKey}
        validatingKey={validatingKey}
        liveSentinelEnabled={liveSentinelEnabled}
        sentinelPulseCount={sentinelPulseCount}
        onToggleSentinel={() => setLiveSentinelEnabled((v) => !v)}
        onClose={onClose}
      />

      {/* Scrollable Content Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 min-h-0 select-text">
        <HealthMeterCard meter={meter} />

        <ExpressAnalysisCard
          selectedModel={selectedModel}
          loadingAnalysis={loadingAnalysis}
          onRun={() => runMarketAnalysis(false)}
        />

        <SweepLeaderboardCard
          symbol={symbol}
          timeframe={timeframe}
          sweepLoading={sweepLoading}
          sweepRunning={sweepRunning}
          sweepArtifact={sweepArtifact}
          sweepNote={sweepNote}
          onRunSweep={handleRunSweep}
          onRefresh={loadSweepLeaderboard}
          onApplyEntry={applySweepEntry}
        />

        <DataFeedContextCard dfc={dfc} atrMetric={analysis?.metrics?.atr} />

        {/* Error notice */}
        {analysisError && (
          <div className="p-2 rounded bg-[#ef535018] border border-[#ef535040] text-[#ef5350] text-[10.5px] flex items-center space-x-1.5">
            <AlertCircle size={13} className="shrink-0" />
            <span>{analysisError}</span>
          </div>
        )}

        {/* Analysis Results Display */}
        {analysis && (
          <AnalysisResults
            analysis={analysis}
            btLoading={btLoading}
            btResultInline={btResultInline}
            coneProjected={coneProjected}
            onApplyLevels={() => projectAnalysisLevels(analysis)}
            onTestInBacktester={handleTestIdeaInBacktester}
            onToggleCone={() => toggleVolatilityCone()}
          />
        )}

        <QuickPromptChips onPrompt={handleSendMessage} />

        <ChatMessages
          messages={messages}
          chatLoading={chatLoading}
          selectedModel={selectedModel}
          bottomRef={chatBottomRef}
        />
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
            className="flex-1 bg-[#090b10] border border-[#222838] focus:border-[#38bdf8] rounded px-2.5 py-1.5 text-[11px] text-foreground placeholder-[#64748b] outline-none font-sans"
          />
          <button
            type="submit"
            disabled={chatLoading || !inputMsg.trim()}
            className="p-1.5 rounded bg-[#2563eb] hover:bg-[#1d4ed8] text-foreground disabled:opacity-40 transition cursor-pointer"
            title="Отправить (Enter)"
          >
            <Send size={13} />
          </button>
        </form>
      </div>
    </aside>
  );
}
