import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Zap,
  Target,
  ShieldAlert,
  TrendingUp,
  TrendingDown,
  BarChart2,
  RefreshCw,
  Send,
  X,
  CheckCircle2,
  AlertCircle,
  Activity,
  Layers,
  Flame,
  ArrowRight
} from 'lucide-react';

export default function AICopilotSidebar({
  isOpen,
  onClose,
  symbol = 'BTCUSDT',
  timeframe = '15m',
  onApplyLevels = () => {},
  onRunBacktest = null
}) {
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);

  // Backtest quick runner state
  const [btLoading, setBtLoading] = useState(false);
  const [btResultInline, setBtResultInline] = useState(null);

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

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, chatLoading]);

  // Handle express 1-click market analysis
  const runMarketAnalysis = async () => {
    setLoadingAnalysis(true);
    setAnalysisError(null);
    setBtResultInline(null);
    try {
      const res = await fetch('/api/ai/market-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, timeframe })
      });
      if (!res.ok) {
        throw new Error(`Ошибка сервера: ${res.status}`);
      }
      const data = await res.json();
      setAnalysis(data);

      // Add to chat history as quick context
      if (data.trading_idea) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `⚡ **Экспресс-анализ #${symbol} готов!**\n\n• Фаза рынка: **${data.market_phase}**\n• Сформирован сетап: **${data.trading_idea.direction}** @ $${data.trading_idea.entry_price}\n• Стоп (ATR 1.5×): $${data.trading_idea.stop_loss} | Тейк (R:R 1:2.5): $${data.trading_idea.take_profit}`
          }
        ]);
      }
    } catch (err) {
      setAnalysisError(err.message || 'Не удалось выполнить анализ');
    } finally {
      setLoadingAnalysis(false);
    }
  };

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

  // Apply levels directly to charts and DOM
  const handleApplyLevelsToChart = () => {
    if (!analysis) return;
    const levelsToProject = [];

    // Support levels
    if (Array.isArray(analysis.support_levels)) {
      analysis.support_levels.forEach((l) => {
        levelsToProject.push({
          price: l.price,
          type: 'BUY',
          label: `SUP: ${l.label} ($${l.price})`,
          reason: l.label
        });
      });
    }

    // Resistance levels
    if (Array.isArray(analysis.resistance_levels)) {
      analysis.resistance_levels.forEach((l) => {
        levelsToProject.push({
          price: l.price,
          type: 'SELL',
          label: `RES: ${l.label} ($${l.price})`,
          reason: l.label
        });
      });
    }

    // Trading idea entry, SL and TP
    if (analysis.trading_idea) {
      const idea = analysis.trading_idea;
      const isLong = idea.direction === 'LONG';
      levelsToProject.push({
        price: idea.entry_price,
        type: isLong ? 'BUY' : 'SELL',
        label: `🎯 ВХОД: ${idea.direction} @ $${idea.entry_price}`,
        reason: 'AI Entry'
      });
      levelsToProject.push({
        price: idea.stop_loss,
        type: isLong ? 'SELL' : 'BUY',
        label: `🛑 СТОП: $${idea.stop_loss} (ATR)`,
        reason: 'AI SL'
      });
      levelsToProject.push({
        price: idea.take_profit,
        type: isLong ? 'SELL' : 'BUY',
        label: `🏁 ТЕЙК: $${idea.take_profit} (R:R 1:2.5)`,
        reason: 'AI TP'
      });
    }

    onApplyLevels(levelsToProject);
    window.dispatchEvent(
      new CustomEvent('apply-ai-strategy-levels', {
        detail: { levels: levelsToProject, symbol }
      })
    );
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

  return (
    <aside
      style={{
        backgroundColor: 'var(--bg-panel, #0c0e12)',
        borderColor: 'var(--border-subtle, #1f2430)'
      }}
      className="fixed top-[34px] right-0 bottom-0 w-[410px] max-w-[90vw] z-40 border-l shadow-2xl flex flex-col font-sans text-xs transition-transform duration-200 ease-out"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1f2430] bg-[#10141d] shrink-0">
        <div className="flex items-center space-x-2">
          <div className="p-1 rounded bg-[#38bdf820] text-[#38bdf8]">
            <Sparkles size={14} className="animate-pulse" />
          </div>
          <div>
            <div className="font-bold text-white text-[11.5px] flex items-center space-x-1.5">
              <span>AI Торговый Ассистент</span>
              <span className="text-[9.5px] px-1.5 py-0.2 rounded font-mono bg-[#2563eb30] text-[#60a5fa] border border-[#2563eb60]">
                PRO
              </span>
            </div>
            <div className="text-[10px] text-[#787f91] font-mono">
              Инструмент: <span className="text-white font-semibold">{symbol}</span> ({timeframe})
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-[#787f91] hover:text-white hover:bg-[#1f2430] transition"
          title="Закрыть сайдбар (Клавиша 'A')"
        >
          <X size={15} />
        </button>
      </div>

      {/* Scrollable Content Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0 select-text">
        {/* Express Analysis Button Card */}
        <div className="p-2.5 rounded-lg border border-[#38bdf835] bg-gradient-to-br from-[#0c1829] to-[#0d1017] shadow-md">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-white text-[11px] flex items-center space-x-1">
              <Zap size={13} className="text-[#38bdf8]" />
              <span>Экспресс-анализ рынка</span>
            </span>
            <span className="text-[9.5px] text-[#787f91] font-mono">Order Flow & Стакан</span>
          </div>
          <button
            onClick={runMarketAnalysis}
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

            {/* Metrics Grid */}
            <div className="grid grid-cols-3 gap-1.5 font-mono text-[10px]">
              <div className="p-1.5 rounded bg-[#10141d] border border-[#1f2430]">
                <div className="text-[#787f91]">ATR (14)</div>
                <div className="text-white font-bold text-[11px]">
                  ${analysis.metrics?.atr}
                </div>
              </div>
              <div className="p-1.5 rounded bg-[#10141d] border border-[#1f2430]">
                <div className="text-[#787f91]">VWAP</div>
                <div className="text-[#ffb300] font-bold text-[11px]">
                  ${analysis.metrics?.vwap}
                </div>
              </div>
              <div className="p-1.5 rounded bg-[#10141d] border border-[#1f2430]">
                <div className="text-[#787f91]">CVD Тренд</div>
                <div
                  className={`font-bold text-[11px] ${
                    analysis.metrics?.recent_delta_sum >= 0
                      ? 'text-[#26a69a]'
                      : 'text-[#ef5350]'
                  }`}
                >
                  {analysis.metrics?.cvd_slope}
                </div>
              </div>
            </div>

            {/* Orderbook Key Levels (Supports / Resistances) */}
            <div className="p-2 rounded bg-[#10141d] border border-[#1f2430] space-y-1.5">
              <div className="font-semibold text-white text-[10.5px] flex items-center justify-between">
                <span>Ключевые уровни стакана DOM</span>
                <span className="text-[#787f91] font-mono text-[9px]">L2 Стенки</span>
              </div>
              <div className="space-y-1 font-mono text-[10px]">
                {/* Resistances */}
                {analysis.resistance_levels?.map((res, i) => (
                  <div
                    key={`res-${i}`}
                    className="flex items-center justify-between px-1.5 py-0.5 rounded bg-[#ef535012] border border-[#ef535030] text-[#ef5350]"
                  >
                    <span>▲ Сопротивление</span>
                    <span className="font-bold">${res.price}</span>
                    <span className="text-[9px] text-[#ff8a80]">{res.label}</span>
                  </div>
                ))}
                {/* Supports */}
                {analysis.support_levels?.map((sup, i) => (
                  <div
                    key={`sup-${i}`}
                    className="flex items-center justify-between px-1.5 py-0.5 rounded bg-[#26a69a12] border border-[#26a69a30] text-[#26a69a]"
                  >
                    <span>▼ Поддержка</span>
                    <span className="font-bold">${sup.price}</span>
                    <span className="text-[9px] text-[#80cbc4]">{sup.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Actionable Trade Setup Card */}
            {analysis.trading_idea && (
              <div className="p-2.5 rounded-lg border border-[#38bdf850] bg-[#0c1424] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-[11px] flex items-center space-x-1">
                    <Target size={13} className="text-[#38bdf8]" />
                    <span>Готовый торговый сетап</span>
                  </span>
                  <span
                    className={`px-1.5 py-0.2 rounded font-mono font-bold text-[10px] ${
                      analysis.trading_idea.direction === 'LONG'
                        ? 'bg-[#26a69a] text-white'
                        : 'bg-[#ef5350] text-white'
                    }`}
                  >
                    {analysis.trading_idea.direction}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1 font-mono text-[10.5px] bg-[#080d16] p-1.5 rounded border border-[#1f293d]">
                  <div>
                    <div className="text-[#787f91] text-[9.5px]">Вход</div>
                    <div className="font-bold text-white">
                      ${analysis.trading_idea.entry_price}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#ef5350] text-[9.5px]">Стоп (ATR)</div>
                    <div className="font-bold text-[#ef5350]">
                      ${analysis.trading_idea.stop_loss}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#26a69a] text-[9.5px]">Цель (2.5R)</div>
                    <div className="font-bold text-[#26a69a]">
                      ${analysis.trading_idea.take_profit}
                    </div>
                  </div>
                </div>

                <p className="text-[10px] text-[#94a3b8] leading-relaxed">
                  {analysis.trading_idea.reasoning}
                </p>

                {/* Setup Action Buttons */}
                <div className="pt-1 flex flex-col space-y-1.5">
                  <button
                    onClick={handleApplyLevelsToChart}
                    className="w-full py-1 px-2 rounded bg-[#38bdf820] hover:bg-[#38bdf830] text-[#38bdf8] border border-[#38bdf850] font-semibold text-[10.5px] flex items-center justify-center space-x-1 transition cursor-pointer"
                  >
                    <Target size={12} />
                    <span>Нанести уровни на график и в стакан</span>
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
              <span>Генерация ответа Order Flow...</span>
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
