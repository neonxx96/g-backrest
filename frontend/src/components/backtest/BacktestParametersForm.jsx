import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import React from 'react';
import { Sliders, ShieldCheck, Grid, AlertTriangle } from 'lucide-react';
import { STRATEGIES, TIMEFRAMES } from './constants';
import { InfoTip, NumField } from './fields';

// Презентационный (управляемый) компонент формы параметров бэктеста — вынесен из BacktestPanel.jsx
// (п.2 модульного плана). Весь стейт и хендлеры (включая updateSymbolParam-врапперы и store) остаются
// в панели; сюда прокидываются значения + колбэки. Поведение и data-testid идентичны оригиналу.

export default function BacktestParametersForm({
  // --- A) Strategy & Entry Rules ---
  strategy,
  onStrategyChange,
  isLiveOnlyStrategy,
  onSwitchToClusterStrategy,
  timeframe,
  onTimeframeChange,
  days,
  onDaysChange,
  entryMode,
  onEntryModeChange,
  // --- B) Risk management ---
  mode,
  sl,
  onSlChange,
  tp,
  onTpChange,
  leverage,
  onLeverageChange,
  slMin,
  setSlMin,
  slMax,
  setSlMax,
  tpMin,
  setTpMin,
  tpMax,
  setTpMax,
  showEmaFields,
  fastEma,
  onFastEmaChange,
  slowEma,
  onSlowEmaChange,
  slMode,
  onSlModeChange,
  wallSlOffsetTicks,
  onWallSlOffsetChange,
  atrMultiplier,
  onAtrMultiplierChange,
  useMultiTp,
  onMultiTpChange,
  tp1RrRatio,
  onTp1RrChange,
  tp2Mode,
  onTp2ModeChange,
  // --- C) Filters (Volume, Time, Confluence) ---
  volMult,
  onVolMultChange,
  filterCvd,
  onFilterCvdChange,
  filterOi,
  onFilterOiChange,
  filterAtr,
  onFilterAtrChange,
  filterRsi,
  onFilterRsiChange,
  makerFeePct,
  setMakerFeePct,
  takerFeePct,
  setTakerFeePct,
  slippageTicks,
  setSlippageTicks,
  onSwitchToLivePaper
}) {
  return (
    <>
      {/* A) СЕКЦИЯ: Входные параметры (Strategy & Entry Rules) */}
      <div className="border border-border rounded-md p-2 space-y-1.5 bg-[#0e1217]/90 shadow-xs">
        <div className="flex items-center justify-between text-[9px] text-foreground/80 font-bold uppercase tracking-wider border-b border-border/80 pb-1">
          <span className="flex items-center gap-1.5">
            <Sliders size={11} className="text-muted-foreground" />
            Входные параметры
            <InfoTip text="Выбор базового квант-алгоритма, таймфрейма, механики входа и горизонта тестирования" />
          </span>
          <span className="text-[8px] text-muted-foreground font-mono">RULES</span>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center text-[8.5px] text-muted-foreground">
            Стратегия (алгоритм входа)
            <InfoTip text="🟢 Зелёная группа — тестируется на реальной истории свечей. 🟠 Оранжевая — работает только по живому стакану L2 в реальном времени (исторический бэктест невозможен: биржа не хранит книгу заявок задним числом)." />
          </div>
          <select
            data-testid="bt-strategy-select"
            value={strategy}
            onChange={(e) => onStrategyChange(e.target.value)}
            className="w-full bg-card border border-border rounded px-2 py-1 text-foreground text-[10px] font-mono outline-none focus:border-neutral-500"
          >
            <optgroup label="🟢 Historical Flow & Volume (Реальная история)">
              {STRATEGIES.filter((s) => s.group === 'historical').map((st) => (
                <option key={st.id} value={st.id}>
                  {st.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="🟠 Live Order Book Sentinel (Только Real-time L2)">
              {STRATEGIES.filter((s) => s.group === 'live').map((st) => (
                <option key={st.id} value={st.id}>
                  {st.label}
                </option>
              ))}
            </optgroup>
          </select>

          {isLiveOnlyStrategy && (
            <div
              data-testid="live-strategy-warning-banner"
              className="bg-amber-950/40 border border-amber-600/60 text-amber-200 text-[9px] p-2 rounded-md leading-relaxed flex flex-col space-y-1 font-mono shadow-xs"
            >
              <div className="flex items-center space-x-1.5 font-bold text-amber-300">
                <AlertTriangle size={13} className="shrink-0 text-warning" />
                <span>Исторический бэктест недоступен (L2 Live)</span>
              </div>
              <div className="text-foreground/80 text-[8.5px]">
                Биржа не хранит потиковый стакан L2 в истории. Данная стратегия предназначена исключительно для торговли в реальном времени (Sentinel).
              </div>
              <div className="pt-0.5 flex items-center justify-between">
                <span className="text-muted-foreground text-[8px]">Для теста на истории:</span>
                <button
                  type="button"
                  data-testid="btn-switch-cluster-strategy"
                  onClick={onSwitchToClusterStrategy}
                  className="px-2 py-0.5 rounded bg-sky-950 hover:bg-sky-900 border border-sky-600/70 text-sky-300 text-[8.5px] font-bold cursor-pointer transition-colors"
                >
                  Включить Cluster Volume Bounce →
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 pt-0.5">
            {/* Timeframe selector */}
            <div>
              <div className="text-[8.5px] text-muted-foreground font-mono mb-0.5">Таймфрейм (TF):</div>
              <div className="flex space-x-0.5">
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf}
                    onClick={() => onTimeframeChange(tf)}
                    className={`flex-1 py-0.5 rounded text-[9px] font-mono transition cursor-pointer ${
                      timeframe === tf
                        ? 'bg-neutral-200 text-neutral-950 font-bold shadow-xs'
                        : 'bg-card text-muted-foreground hover:text-foreground border border-border/80'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>

            {/* Period (Days) */}
            <div>
              <div className="text-[8.5px] text-muted-foreground font-mono mb-0.5">Период истории:</div>
              <NumField
                label=""
                testId="input-days"
                value={days}
                onChange={onDaysChange}
                step={1}
                min={1}
                max={30}
                suffix="дн"
                tooltip="Глубина исторической выборки (в днях)"
              />
            </div>
          </div>

          {/* Entry Mode select */}
          <div className="pt-0.5">
            <div className="text-[8.5px] uppercase font-bold text-foreground/80 mb-0.5 flex items-center">
              🎯 Режим входа (Entry Mode):
              <InfoTip text="Механика генерации сигнала: лимитный отскок, агрессивный пробой или поглощение дельты CVD" />
            </div>
            <select
              data-testid="select-entry-mode"
              value={entryMode}
              onChange={(e) => onEntryModeChange(e.target.value)}
              className="w-full bg-card border border-border rounded px-2 py-0.5 text-foreground text-[9.5px] outline-none focus:border-neutral-500"
            >
              <option value="limit_bounce">Лимитный отскок от плотности (Bounce)</option>
              <option value="breakout">Пробой плотности на разъедании (Breakout)</option>
              <option value="cvd_absorption">Поглощение дельты (CVD Absorption)</option>
            </select>
          </div>
        </div>
      </div>

      {/* B) СЕКЦИЯ: Риск-менеджмент (SL, TP, Trailing) */}
      <div
        data-testid="extended-strategy-config"
        className="border border-border rounded-md p-2 space-y-1.5 bg-[#0e1217]/90 shadow-xs"
      >
        <div className="flex items-center justify-between text-[9px] text-foreground/80 font-bold uppercase tracking-wider border-b border-border/80 pb-1">
          <span className="flex items-center gap-1.5">
            <ShieldCheck size={11} className="text-muted-foreground" />
            Риск-менеджмент
            <InfoTip text="Настройки Stop-Loss, Take-Profit, динамического смещения и размера кредитного плеча" />
          </span>
          <span className="text-[8px] text-muted-foreground font-mono">RISK</span>
        </div>

        {mode === 'single' ? (
          <div className="grid grid-cols-3 gap-1.5">
            <NumField testId="input-sl" label="SL" value={sl} onChange={onSlChange} step={0.1} min={0.1} suffix="%" tooltip="Stop-Loss в % от точки входа" />
            <NumField testId="input-tp" label="TP" value={tp} onChange={onTpChange} step={0.1} min={0.1} suffix="%" tooltip="Take-Profit в % от точки входа" />
            <NumField testId="input-leverage" label="Плечо" value={leverage} onChange={onLeverageChange} step={1} min={1} max={125} suffix="x" tooltip="Изолированное кредитное плечо для расчёта" />
          </div>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-2 gap-1">
              <NumField label="SL от" value={slMin} onChange={setSlMin} step={0.1} min={0.1} suffix="%" tooltip="Минимальный Stop-Loss для перебора" />
              <NumField label="SL до" value={slMax} onChange={setSlMax} step={0.1} min={0.2} suffix="%" tooltip="Максимальный Stop-Loss для перебора" />
            </div>
            <div className="grid grid-cols-2 gap-1">
              <NumField label="TP от" value={tpMin} onChange={setTpMin} step={0.2} min={0.2} suffix="%" tooltip="Минимальный Take-Profit для перебора" />
              <NumField label="TP до" value={tpMax} onChange={setTpMax} step={0.2} min={0.5} suffix="%" tooltip="Максимальный Take-Profit для перебора" />
            </div>
          </div>
        )}

        {/* M5.2: EMA-периоды для ema_trend (заполняются вручную или кнопкой Apply из Quant Sweep) */}
        {showEmaFields && (
          <div className="grid grid-cols-2 gap-1.5">
            <NumField testId="input-fast-ema" label="Fast EMA" value={fastEma} onChange={onFastEmaChange} step={1} min={2} max={300} tooltip="Период быстрой EMA для стратегии EMA Trend (20 = legacy)" />
            <NumField testId="input-slow-ema" label="Slow EMA" value={slowEma} onChange={onSlowEmaChange} step={1} min={5} max={500} tooltip="Период медленной EMA, строго больше Fast (50 = legacy)" />
          </div>
        )}

        {/* Динамический Stop-Loss */}
        <div className="space-y-1 pt-0.5 border-t border-border/80">
          <div className="text-[8.5px] uppercase font-bold text-foreground/80 flex items-center">
            🛡️ Динамический Stop-Loss:
            <InfoTip text="Адаптивный алгоритм защиты: фиксированный %, за лимитную стенку или по волатильности ATR" />
          </div>
          <div className="grid grid-cols-3 gap-1">
            {[
              { id: 'fixed_pct', label: 'Фикс. %' },
              { id: 'behind_wall', label: 'За стенку' },
              { id: 'atr_volatility', label: 'По ATR' }
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                data-testid={`sl-mode-${opt.id}`}
                onClick={() => onSlModeChange(opt.id)}
                className={`py-0.5 px-1 rounded border text-[8.5px] truncate transition cursor-pointer ${
                  slMode === opt.id
                    ? 'bg-neutral-200 text-neutral-950 border-neutral-300 font-bold shadow-xs'
                    : 'bg-card text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {slMode === 'behind_wall' && (
            <div className="flex items-center justify-between pt-0.5">
              <span className="text-muted-foreground text-[8.5px]">Отступ за стенку (тиков):</span>
              <input
                data-testid="input-wall-sl-offset"
                type="number"
                min={1}
                max={50}
                value={wallSlOffsetTicks}
                onChange={(e) => onWallSlOffsetChange(e.target.value)}
                className="w-16 bg-card border border-border rounded px-1 py-0.5 text-right text-foreground text-[9px] outline-none focus:border-neutral-500"
              />
            </div>
          )}
          {slMode === 'atr_volatility' && (
            <div className="flex items-center justify-between pt-0.5">
              <span className="text-muted-foreground text-[8.5px]">Множитель ATR (1.0x–3.0x):</span>
              <input
                data-testid="input-atr-sl-mult"
                type="number"
                step={0.2}
                min={1.0}
                max={3.0}
                value={atrMultiplier}
                onChange={(e) => onAtrMultiplierChange(e.target.value)}
                className="w-16 bg-card border border-border rounded px-1 py-0.5 text-right text-foreground text-[9px] outline-none focus:border-neutral-500"
              />
            </div>
          )}
        </div>

        {/* Мульти-Тейк-Профит & Trailing */}
        <div className="pt-0.5 border-t border-border/80 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[8.5px] uppercase font-bold text-foreground/80">🎯 Multi-TP & Trailing</span>
            <label
              className="flex items-center space-x-1 text-[8.5px] font-mono text-foreground/80 cursor-pointer"
              title="Multi-TP: закрыть 50% позиции на TP1 и перевести стоп остатка в безубыток — сделка перестаёт быть убыточной после первой цели"
            >
              <input
                data-testid="toggle-multi-tp"
                type="checkbox"
                checked={useMultiTp}
                onChange={(e) => onMultiTpChange(e.target.checked)}
                className="w-3 h-3 rounded accent-neutral-200 cursor-pointer"
              />
              <span>Включить (50% + Б/У)</span>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="flex flex-col text-[8.5px] text-muted-foreground">
              <span className="flex items-center truncate">
                TP1 R:R
                <InfoTip text="Коэффициент Risk/Reward для закрытия первых 50% и перевода стопа в Б/У" />
              </span>
              <input
                data-testid="input-tp1-rr"
                type="number"
                step={0.1}
                min={0.8}
                max={4.0}
                value={tp1RrRatio}
                onChange={(e) => onTp1RrChange(e.target.value)}
                className="bg-card border border-border rounded px-1.5 py-0.5 text-foreground text-right text-[9.5px] outline-none focus:border-neutral-500"
              />
            </label>
            <label className="flex flex-col text-[8.5px] text-muted-foreground">
              <span className="flex items-center truncate">
                TP2 режим
                <InfoTip text="Стратегия закрытия оставшихся 50%: перед противоположной плотностью или трендовый R:R" />
              </span>
              <select
                data-testid="select-tp2-mode"
                value={tp2Mode}
                onChange={(e) => onTp2ModeChange(e.target.value)}
                className="bg-card border border-border rounded px-1.5 py-0.5 text-foreground text-[9px] outline-none focus:border-neutral-500"
              >
                <option value="opposite_wall">Перед стенкой</option>
                <option value="trend_rr">По тренду (2.8R)</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      {/* C) СЕКЦИЯ: Фильтры (Volume, Time, Confluence) */}
      <div className="border border-border rounded-md p-2 space-y-1.5 bg-[#0e1217]/90 shadow-xs">
        <div className="flex items-center justify-between text-[9px] text-foreground/80 font-bold uppercase tracking-wider border-b border-border/80 pb-1">
          <span className="flex items-center gap-1.5">
            <Grid size={11} className="text-muted-foreground" />
            Фильтры
            <InfoTip text="Порог стакана, защита от спуфинга, Confluence фильтры и реализм биржевых комиссий" />
          </span>
          <span className="text-[8px] text-muted-foreground font-mono">FILTERS</span>
        </div>

        {/* Honest Historical OHLCV Banner (L2 orderbook filters hidden in history) */}
        <div className="border border-border/90 rounded bg-card/80 p-2 text-[8.5px] font-mono space-y-1.5">
          <div className="flex items-center justify-between text-warning font-bold text-[9px]">
            <span className="flex items-center gap-1">
              <span>🛡️ Честный режим OHLCV истории</span>
            </span>
            <span className="text-[7.5px] bg-amber-500/10 border border-amber-500/30 text-amber-300 px-1 rounded">
              L2 фильтры скрыты
            </span>
          </div>
          <p className="text-muted-foreground font-sans leading-tight">
            Биржа не хранит исторический стакан L2. В истории доступны только свечные индикаторы (ATR, RSI, поглощение объёма).
            Для торговли перед лимитными стенками переключитесь в{' '}
            <button
              type="button"
              onClick={onSwitchToLivePaper}
              className="text-amber-300 font-bold underline cursor-pointer hover:text-amber-200"
            >
              ⚡ Симулятор (Paper)
            </button>.
          </p>
          <div className="pt-1 border-t border-border/80">
            <NumField
              label="Множитель объёма свечи"
              value={volMult}
              onChange={onVolMultChange}
              step={0.1}
              min={0.5}
              tooltip="Множитель объема свечного кластера (Price Action / Volume Climax)"
            />
          </div>
        </div>

        {/* Confluence Suite */}
        <div className="pt-1 border-t border-border/80 space-y-1">
          <div className="flex items-center justify-between text-[8.5px] font-mono">
            <span className="text-muted-foreground font-bold uppercase tracking-wider flex items-center gap-1">
              Confluence сигналы
              <InfoTip text="Дополнительные условия подтверждения сигналов для отсеивания ложных входов" />
            </span>
            <span className="text-muted-foreground font-mono">
              {[filterCvd, filterOi, filterAtr, filterRsi].filter(Boolean).length}/4 ON
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1 text-[8.5px] font-mono">
            {[
              { label: 'CVD', active: filterCvd, toggle: () => onFilterCvdChange(!filterCvd),
                help: 'Кумулятивная дельта: вход разрешён только по направлению потока агрессивных маркет-ордеров' },
              { label: 'OI', active: filterOi, toggle: () => onFilterOiChange(!filterOi),
                help: 'Открытый интерес: подтверждение, что движение поддержано открытием новых позиций в фьючерсе (требует реальных OI-данных)' },
              { label: 'ATR', active: filterAtr, toggle: () => onFilterAtrChange(!filterAtr),
                help: 'Волатильность: пропускает входы только при достаточном размахе свечей — отсеивает плоский рынок' },
              { label: 'RSI', active: filterRsi, toggle: () => onFilterRsiChange(!filterRsi),
                help: 'Импульс: входы только в нейтральной зоне RSI, без перекупленности/перепроданности (ловля вершин запрещена)' }
            ].map((f) => (
              <button
                key={f.label}
                type="button"
                title={f.help}
                onClick={f.toggle}
                className={`py-0.5 px-1 rounded border text-center transition cursor-pointer ${
                  f.active
                    ? 'bg-neutral-200 text-neutral-950 border-neutral-300 font-bold shadow-xs'
                    : 'bg-card text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {f.label}: {f.active ? 'ON' : 'OFF'}
              </button>
            ))}
          </div>
        </div>

        {/* Fees and Slippage */}
        <div className="pt-1 border-t border-border/80">
          <div className="text-[8.5px] font-mono text-muted-foreground font-bold uppercase tracking-wider mb-0.5">
            Биржевые комиссии & Скольжение:
          </div>
          <div className="grid grid-cols-3 gap-1">
            <NumField
              testId="input-maker-fee"
              label="Maker"
              value={makerFeePct}
              onChange={setMakerFeePct}
              step={0.01}
              min={0}
              max={0.5}
              suffix="%"
              tooltip="Биржевая комиссия при лимитном входе"
            />
            <NumField
              testId="input-taker-fee"
              label="Taker"
              value={takerFeePct}
              onChange={setTakerFeePct}
              step={0.01}
              min={0}
              max={0.5}
              suffix="%"
              tooltip="Биржевая комиссия при маркет-входе или срабатывании стопа"
            />
            <NumField
              testId="input-slippage-ticks"
              label="Скольжение"
              value={slippageTicks}
              onChange={setSlippageTicks}
              step={1}
              min={0}
              max={10}
              suffix="тик"
              tooltip="Проскальзывание стоп-лосса в тиках цены"
            />
          </div>
        </div>
      </div>
    </>
  );
}
