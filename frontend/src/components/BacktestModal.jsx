import React, { useState } from 'react';
import { 
  BarChart3, 
  Play, 
  TrendingUp, 
  TrendingDown, 
  Percent, 
  ShieldAlert, 
  Award, 
  X, 
  Loader2, 
  SlidersHorizontal 
} from 'lucide-react';

const API_BASE = '/api';

export default function BacktestModal({ isOpen, onClose, currentSymbol, currentTimeframe }) {
  const [symbol, setSymbol] = useState(currentSymbol || "BTCUSDT");
  const [timeframe, setTimeframe] = useState(currentTimeframe || "15m");
  const [days, setDays] = useState(14);
  const [strategyType, setStrategyType] = useState("confluence_ema");
  const [capital, setCapital] = useState(10000);
  const [leverage, setLeverage] = useState(2);
  const [tpPct, setTpPct] = useState(1.5);
  const [slPct, setSlPct] = useState(0.8);
  const [useTrailing, setUseTrailing] = useState(true);
  const [trailingPct, setTrailingPct] = useState(0.5);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleRunBacktest = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`${API_BASE}/backtest/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: symbol.toUpperCase(),
          timeframe,
          days: Number(days),
          strategy_type: strategyType,
          initial_capital: Number(capital),
          leverage: Number(leverage),
          take_profit_pct: Number(tpPct),
          stop_loss_pct: Number(slPct),
          use_trailing: useTrailing,
          trailing_pct: Number(trailingPct),
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Ошибка бэктеста");
      }

      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#0b0e14] border border-[#1b212f] rounded-xl w-full max-w-4xl text-foreground shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1b212f] bg-[#0e1118]">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-[#2563eb]/20 text-[#2563eb]">
              <BarChart3 size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-wide">Бэктестер Order Flow & Свечных Триггеров</h2>
              <p className="text-[11px] text-[#848e9c]">Тестирование на реальных фьючерсных данных Binance с комиссиями и скольжением</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded bg-[#121620] hover:bg-[#1a2130] text-[#848e9c] hover:text-foreground transition"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Settings Form */}
          <form onSubmit={handleRunBacktest} className="bg-[#121620] p-4 rounded-lg border border-[#1b212f] space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Strategy Selector */}
              <div>
                <label className="text-[11px] text-[#848e9c] block mb-1">Стратегия</label>
                <select
                  value={strategyType}
                  onChange={(e) => setStrategyType(e.target.value)}
                  className="w-full bg-[#0a0d13] border border-[#1f2637] rounded px-2.5 py-1.5 text-xs text-foreground outline-none"
                >
                  <option value="confluence_ema">📈 EMA(20) + Объем + Delta</option>
                  <option value="delta_absorption">🌊 Delta Absorption (CVD)</option>
                  <option value="density_bounce">🧱 Отскок от плотностей в стакане</option>
                </select>
              </div>

              {/* Symbol */}
              <div>
                <label className="text-[11px] text-[#848e9c] block mb-1">Монета</label>
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  className="w-full bg-[#0a0d13] border border-[#1f2637] rounded px-2.5 py-1.5 text-xs text-foreground font-mono outline-none"
                />
              </div>

              {/* Timeframe & Days */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-[#848e9c] block mb-1">Таймфрейм</label>
                  <select
                    value={timeframe}
                    onChange={(e) => setTimeframe(e.target.value)}
                    className="w-full bg-[#0a0d13] border border-[#1f2637] rounded px-2.5 py-1.5 text-xs text-foreground font-mono outline-none"
                  >
                    <option value="5m">5m</option>
                    <option value="15m">15m</option>
                    <option value="30m">30m</option>
                    <option value="1h">1h</option>
                    <option value="4h">4h</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-[#848e9c] block mb-1">Дней истории</label>
                  <input
                    type="number"
                    min="1"
                    max="90"
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    className="w-full bg-[#0a0d13] border border-[#1f2637] rounded px-2.5 py-1.5 text-xs text-foreground font-mono outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Risk & Execution Parameters */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-2 border-t border-[#1b212f]">
              <div>
                <label className="text-[11px] text-[#848e9c] block mb-1">Депозит ($)</label>
                <input
                  type="number"
                  value={capital}
                  onChange={(e) => setCapital(e.target.value)}
                  className="w-full bg-[#0a0d13] border border-[#1f2637] rounded px-2 py-1 text-xs text-foreground font-mono outline-none"
                />
              </div>
              <div>
                <label className="text-[11px] text-[#848e9c] block mb-1">Плечо ({leverage}x)</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={leverage}
                  onChange={(e) => setLeverage(e.target.value)}
                  className="w-full bg-[#0a0d13] border border-[#1f2637] rounded px-2 py-1 text-xs text-foreground font-mono outline-none"
                />
              </div>
              <div>
                <label className="text-[11px] text-[#848e9c] block mb-1">Take Profit (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={tpPct}
                  onChange={(e) => setTpPct(e.target.value)}
                  className="w-full bg-[#0a0d13] border border-[#1f2637] rounded px-2 py-1 text-xs text-foreground font-mono outline-none"
                />
              </div>
              <div>
                <label className="text-[11px] text-[#848e9c] block mb-1">Stop Loss (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={slPct}
                  onChange={(e) => setSlPct(e.target.value)}
                  className="w-full bg-[#0a0d13] border border-[#1f2637] rounded px-2 py-1 text-xs text-foreground font-mono outline-none"
                />
              </div>
              <div>
                <label className="text-[11px] text-[#848e9c] block mb-1">Trailing Stop (%)</label>
                <div className="flex items-center space-x-1.5">
                  <input
                    type="checkbox"
                    checked={useTrailing}
                    onChange={(e) => setUseTrailing(e.target.checked)}
                    className="accent-blue-600 rounded"
                  />
                  <input
                    type="number"
                    step="0.1"
                    disabled={!useTrailing}
                    value={trailingPct}
                    onChange={(e) => setTrailingPct(e.target.value)}
                    className="w-full bg-[#0a0d13] border border-[#1f2637] rounded px-2 py-1 text-xs text-foreground font-mono outline-none disabled:opacity-50"
                  />
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-foreground text-xs font-bold transition flex items-center space-x-1.5 shadow-lg shadow-blue-900/30"
              >
                {loading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Расчет симуляции...</span>
                  </>
                ) : (
                  <>
                    <Play size={14} fill="currentColor" />
                    <span>Запустить бэктест</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Error Notice */}
          {error && (
            <div className="p-3 rounded bg-bear-soft/40 border border-rose-800 text-rose-300 text-xs">
              {error}
            </div>
          )}

          {/* Backtest Results */}
          {result && (
            <div className="space-y-4">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-[#121620] p-3 rounded-lg border border-[#1b212f]">
                  <span className="text-[10px] text-[#848e9c] uppercase block mb-1">Итоговый PnL</span>
                  <div className={`text-base font-bold font-mono ${result.net_pnl >= 0 ? 'text-bull' : 'text-bear'}`}>
                    {result.net_pnl >= 0 ? '+' : ''}{result.net_pnl} $
                  </div>
                  <span className="text-[10px] text-[#848e9c]">ROI: {result.roi_pct}%</span>
                </div>

                <div className="bg-[#121620] p-3 rounded-lg border border-[#1b212f]">
                  <span className="text-[10px] text-[#848e9c] uppercase block mb-1">Винрейт (WR)</span>
                  <div className="text-base font-bold font-mono text-blue-400">
                    {result.win_rate_pct}%
                  </div>
                  <span className="text-[10px] text-[#848e9c]">{result.wins_count}W / {result.losses_count}L</span>
                </div>

                <div className="bg-[#121620] p-3 rounded-lg border border-[#1b212f]">
                  <span className="text-[10px] text-[#848e9c] uppercase block mb-1">Profit Factor</span>
                  <div className="text-base font-bold font-mono text-purple-400">
                    {result.profit_factor}
                  </div>
                  <span className="text-[10px] text-[#848e9c]">Фактор прибыли</span>
                </div>

                <div className="bg-[#121620] p-3 rounded-lg border border-[#1b212f]">
                  <span className="text-[10px] text-[#848e9c] uppercase block mb-1">Макс. Просадка</span>
                  <div className="text-base font-bold font-mono text-bear">
                    -{result.max_drawdown_pct}%
                  </div>
                  <span className="text-[10px] text-[#848e9c]">-${result.max_drawdown_usd}</span>
                </div>

                <div className="bg-[#121620] p-3 rounded-lg border border-[#1b212f]">
                  <span className="text-[10px] text-[#848e9c] uppercase block mb-1">Всего сделок</span>
                  <div className="text-base font-bold font-mono text-foreground">
                    {result.total_trades}
                  </div>
                  <span className="text-[10px] text-[#848e9c]">За {days} дней</span>
                </div>
              </div>

              {/* Trade Log Table */}
              <div className="bg-[#121620] rounded-lg border border-[#1b212f] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#1b212f] bg-[#0e1118] flex justify-between items-center">
                  <span className="text-xs font-bold text-foreground/80">Журнал сделок симуляции</span>
                  <span className="text-[10px] text-[#848e9c]">Учтены комиссии 0.05% и проскальзывание 0.02%</span>
                </div>

                <div className="overflow-x-auto max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-[#0e1118] text-[#848e9c] text-[10px] uppercase border-b border-[#1b212f] sticky top-0">
                      <tr>
                        <th className="py-2 px-3">Время входа</th>
                        <th className="py-2 px-3">Тип</th>
                        <th className="py-2 px-3">Вход</th>
                        <th className="py-2 px-3">Выход</th>
                        <th className="py-2 px-3">PnL ($)</th>
                        <th className="py-2 px-3">PnL (%)</th>
                        <th className="py-2 px-3">Причина выхода</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1b212f]">
                      {result.trades.map((t, idx) => (
                        <tr key={idx} className="hover:bg-[#1a2130]">
                          <td className="py-1.5 px-3 text-[#848e9c]">
                            {new Date(t.entry_time).toLocaleDateString()} {new Date(t.entry_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="py-1.5 px-3">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${t.direction === 'LONG' ? 'bg-bull-soft text-bull' : 'bg-bear-soft text-bear'}`}>
                              {t.direction}
                            </span>
                          </td>
                          <td className="py-1.5 px-3 text-foreground">{t.entry_price}</td>
                          <td className="py-1.5 px-3 text-foreground">{t.exit_price}</td>
                          <td className={`py-1.5 px-3 font-bold ${t.pnl_usd >= 0 ? 'text-bull' : 'text-bear'}`}>
                            {t.pnl_usd >= 0 ? '+' : ''}{t.pnl_usd}$
                          </td>
                          <td className={`py-1.5 px-3 font-bold ${t.pnl_pct >= 0 ? 'text-bull' : 'text-bear'}`}>
                            {t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct}%
                          </td>
                          <td className="py-1.5 px-3 text-muted-foreground text-[11px]">{t.exit_reason}</td>
                        </tr>
                      ))}
                      {result.trades.length === 0 && (
                        <tr>
                          <td colSpan="7" className="py-6 text-center text-muted-foreground text-xs">
                            По заданным параметрам сделок не было открыто
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
