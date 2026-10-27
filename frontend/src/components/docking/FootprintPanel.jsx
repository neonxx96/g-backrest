import React, { useState, useEffect, useMemo, useRef } from 'react';
import { BarChart3, Radio, PlusCircle, Settings, Crosshair } from 'lucide-react';
import ChannelSelector from './ChannelSelector';
import { useColorLinksStore } from '../../stores/colorLinksStore';
import {
  buildFootprintGrid,
  buildSessionProfile,
  fmtVol,
  fmtTime,
  cellSide,
  cellIntensity
} from './footprintGrid';

const API_BASE = '/api';
const REFRESH_MS = 3000;
const SETTINGS_KEY = 'signalscript:footprint-settings';

const DEFAULT_SETTINGS = {
  displayMode: 'bid_ask', // 'bid_ask' | 'delta' | 'volume' | 'imbalance'
  scale: 1,               // 1 | 2 | 5 | 10
  maxBars: 14,            // 10 | 14 | 20 | 30
  imbalanceRatio: 3.0,    // 2.0 | 3.0 | 4.0
  stackedMin: 3,          // 2 | 3 | 4
  showProfile: true,
  highlightCandlePoc: true
};

function loadSavedSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export default function FootprintPanel({ panelId = 'footprint' }) {
  const currentSymbol = useColorLinksStore((s) => s.getPanelSymbol(panelId, 'BTCUSDT'));
  const [candles, setCandles] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [recorderSymbols, setRecorderSymbols] = useState(null);
  const [enabling, setEnabling] = useState(false);
  const [settings, setSettings] = useState(loadSavedSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const scrollContainerRef = useRef(null);

  const updateSetting = (patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota errors */
      }
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const params = new URLSearchParams({
        symbol: currentSymbol,
        limit: String(settings.maxBars),
        scale: String(settings.scale),
        imbalance_ratio: String(settings.imbalanceRatio),
        stacked_min: String(settings.stackedMin)
      });
      fetch(`${API_BASE}/recorder/clusters?${params.toString()}`)
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          if (cancelled) return;
          setCandles(Array.isArray(data) ? data : []);
          setLastUpdate(Date.now());
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [currentSymbol, settings.maxBars, settings.scale, settings.imbalanceRatio, settings.stackedMin]);

  useEffect(() => {
    fetch(`${API_BASE}/recorder/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.focus_symbols)) setRecorderSymbols(d.focus_symbols);
      })
      .catch(() => {});
  }, []);

  const grid = useMemo(() => buildFootprintGrid(candles, settings.maxBars), [candles, settings.maxBars]);
  const sessionProfile = useMemo(() => buildSessionProfile(grid), [grid]);
  const candleMaxVols = useMemo(
    () =>
      grid.bars.map((c) =>
        Math.max(...(c?.levels || []).map((l) => (Number(l.buy_vol) || 0) + (Number(l.sell_vol) || 0)), 0)
      ),
    [grid]
  );

  const centerOnPoc = () => {
    if (!scrollContainerRef.current) return;
    const pocEl = scrollContainerRef.current.querySelector('[data-poc-row="true"]');
    if (pocEl && typeof pocEl.scrollIntoView === 'function') {
      pocEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  const enableSymbol = async () => {
    setEnabling(true);
    try {
      const union = [...new Set([...(recorderSymbols || []), currentSymbol])];
      await fetch(`${API_BASE}/recorder/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ focus_symbols: union })
      });
      setRecorderSymbols(union);
    } catch {
      /* состояние перечитается следующим статусом */
    } finally {
      setEnabling(false);
    }
  };

  const hasData = grid.bars.length > 0;
  const isLive = lastUpdate && Date.now() - lastUpdate < REFRESH_MS * 4;
  const notRecorded =
    !hasData && recorderSymbols !== null && !recorderSymbols.includes(currentSymbol);
  const deltaShare = grid.totalVolume > 0 ? (Math.abs(grid.cvd) / grid.totalVolume) * 100 : 0;

  // Сводка кластерных сигналов по последней свече
  const latestCandle = grid.bars.length > 0 ? grid.bars[grid.bars.length - 1] : null;

  return (
    <div
      data-testid="footprint-panel"
      className="h-full w-full flex flex-col font-sans select-none bg-[#0a0d14] text-[#d1d4dc] border-r border-[#1a1f2c] relative"
    >
      {/* Верхний тулбар: название, тикер, быстрые режимы, масштаб, настройки */}
      <div className="px-2.5 py-1.5 border-b border-[#1f2638] bg-[#0f1420] flex items-center justify-between gap-2 shrink-0 flex-wrap">
        <div className="flex items-center space-x-1.5">
          <BarChart3 size={12} className="text-[#3b82f6]" />
          <span className="font-bold text-[11px] text-foreground">Футпринт / Кластеры</span>
          <span className="text-[10px] text-[#60a5fa] font-mono font-semibold">{currentSymbol}</span>
          {hasData && (
            <span
              className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                grid.cvd >= 0 ? 'bg-emerald-500/10 text-bull' : 'bg-rose-500/10 text-bear'
              }`}
              title="Кумулятивная дельта окна (CVD)"
            >
              CVD {grid.cvd >= 0 ? '+' : ''}{fmtVol(grid.cvd)}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-1.5">
          {/* Быстрый переключатель режимов отображения */}
          <div className="flex items-center bg-[#0a0d14] border border-[#1f2638] rounded p-0.5 text-[9px] font-mono">
            {[
              { id: 'bid_ask', label: 'Bid×Ask' },
              { id: 'delta', label: 'Δ' },
              { id: 'volume', label: 'Vol' },
              { id: 'imbalance', label: 'Imb' }
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => updateSetting({ displayMode: m.id })}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  settings.displayMode === m.id
                    ? 'bg-[#1e293b] text-[#38bdf8] font-bold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title={`Режим ячеек: ${m.label}`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Быстрый выбор шага цены (Scale) */}
          <div
            className="flex items-center bg-[#0a0d14] border border-[#1f2638] rounded p-0.5 text-[9px] font-mono"
            title="Множитель шага цены (укрупнение кластеров)"
          >
            {[1, 2, 5, 10].map((sc) => (
              <button
                key={sc}
                type="button"
                onClick={() => updateSetting({ scale: sc })}
                className={`px-1 py-0.5 rounded transition-colors ${
                  settings.scale === sc
                    ? 'bg-[#1e293b] text-amber-300 font-bold'
                    : 'text-muted-foreground hover:text-foreground/80'
                }`}
              >
                {sc}x
              </button>
            ))}
          </div>

          {hasData && (
            <button
              type="button"
              onClick={centerOnPoc}
              title="Центрировать по уровню POC"
              className="p-1 rounded bg-[#141b29] hover:bg-[#1e293b] text-muted-foreground hover:text-foreground border border-[#1f2638]"
            >
              <Crosshair size={11} />
            </button>
          )}

          <button
            type="button"
            data-testid="btn-footprint-settings"
            onClick={() => setSettingsOpen((v) => !v)}
            title="Настройки кластеров и порогов"
            className={`p-1 rounded border transition-colors ${
              settingsOpen
                ? 'bg-[#1e293b] text-[#38bdf8] border-[#38bdf850]'
                : 'bg-[#141b29] text-muted-foreground hover:text-foreground border-[#1f2638]'
            }`}
          >
            <Settings size={11} />
          </button>

          {hasData && (
            <span className="flex items-center space-x-1 text-[9px] font-mono text-muted-foreground">
              <Radio size={10} className={isLive ? 'text-bull animate-pulse' : 'text-muted-foreground'} />
              <span>{isLive ? 'LIVE' : 'пауза'}</span>
            </span>
          )}
          <ChannelSelector panelId={panelId} />
        </div>
      </div>

      {/* Всплывающее окно детальных настроек */}
      {settingsOpen && (
        <div
          data-testid="footprint-settings-popover"
          className="absolute right-2 top-9 z-30 w-64 rounded-md bg-[#111726] border border-[#28324a] shadow-xl p-3 text-[10px] space-y-2.5"
        >
          <div className="flex items-center justify-between border-b border-[#1f2638] pb-1.5">
            <span className="font-bold text-foreground text-[11px]">Настройки кластеров</span>
            <button
              type="button"
              onClick={() => updateSetting(DEFAULT_SETTINGS)}
              className="text-[9px] text-[#38bdf8] hover:underline"
            >
              Сброс
            </button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Порог Imbalance:</span>
            <div className="flex gap-1 font-mono">
              {[2.0, 3.0, 4.0].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => updateSetting({ imbalanceRatio: r })}
                  className={`px-1.5 py-0.5 rounded border ${
                    settings.imbalanceRatio === r
                      ? 'bg-[#1e293b] border-[#38bdf8] text-[#38bdf8] font-bold'
                      : 'border-[#1f2638] text-muted-foreground'
                  }`}
                >
                  {Math.round(r * 100)}%
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Серия Stacked (мин.):</span>
            <div className="flex gap-1 font-mono">
              {[2, 3, 4].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => updateSetting({ stackedMin: st })}
                  className={`px-2 py-0.5 rounded border ${
                    settings.stackedMin === st
                      ? 'bg-[#1e293b] border-[#38bdf8] text-[#38bdf8] font-bold'
                      : 'border-[#1f2638] text-muted-foreground'
                  }`}
                >
                  {st} ур.
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Окно свечей:</span>
            <div className="flex gap-1 font-mono">
              {[10, 14, 20, 30].map((cnt) => (
                <button
                  key={cnt}
                  type="button"
                  onClick={() => updateSetting({ maxBars: cnt })}
                  className={`px-1.5 py-0.5 rounded border ${
                    settings.maxBars === cnt
                      ? 'bg-[#1e293b] border-[#38bdf8] text-[#38bdf8] font-bold'
                      : 'border-[#1f2638] text-muted-foreground'
                  }`}
                >
                  {cnt}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center justify-between cursor-pointer pt-1">
            <span className="text-foreground/80">Боковой профиль объёма (VP)</span>
            <input
              type="checkbox"
              checked={settings.showProfile}
              onChange={(e) => updateSetting({ showProfile: e.target.checked })}
              className="accent-[#38bdf8]"
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-foreground/80">Выделять POC каждой свечи</span>
            <input
              type="checkbox"
              checked={settings.highlightCandlePoc}
              onChange={(e) => updateSetting({ highlightCandlePoc: e.target.checked })}
              className="accent-amber-400"
            />
          </label>
        </div>
      )}

      {!hasData ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
          <div className="p-3 rounded-full bg-[#1e293b50] border border-[#33415550] text-[#38bdf8]">
            <BarChart3 size={24} className="animate-pulse" />
          </div>
          <div className="space-y-1 max-w-sm">
            <div className="font-bold text-foreground text-[12px]">Нет кластеров для {currentSymbol}</div>
            <div className="text-[10.5px] text-[#94a3b8] leading-relaxed">
              {notRecorded
                ? 'Символ не записывается рекордером. Добавьте его в focus-символы — трейды начнут агрегироваться в кластеры.'
                : 'Рекордер подписан на символ. Первые кластеры появятся после накопления трейдов (до 5 минут на 5m-свечу).'}
            </div>
          </div>
          {notRecorded && (
            <button
              data-testid="btn-footprint-enable-symbol"
              onClick={enableSymbol}
              disabled={enabling}
              title="Рекордер переподпишется на потоки Binance (сбор прервётся на несколько секунд)"
              className="flex items-center space-x-1 px-3 py-1 rounded bg-[#1e293b] text-[#38bdf8] border border-[#38bdf830] text-[10px] font-mono hover:bg-[#243349] disabled:opacity-50"
            >
              <PlusCircle size={11} />
              <span>{enabling ? 'Включаю…' : `Включить запись ${currentSymbol}`}</span>
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Грид футпринта + опциональная колонка Session Volume Profile */}
          <div ref={scrollContainerRef} className="flex-1 overflow-auto mt-1 px-1 pb-1">
            <div
              className="grid gap-px text-[9px] font-mono min-w-max"
              style={{
                gridTemplateColumns: `62px repeat(${grid.bars.length}, minmax(82px, 1fr))${
                  settings.showProfile ? ' 96px' : ''
                }`
              }}
            >
              {/* Шапка свечей: время, дельта, объём, маркеры stacked/absorption/POC migration */}
              <div className="sticky left-0 bg-[#0a0d14] z-10 px-1 py-0.5 text-muted-foreground flex items-center justify-end border-b border-[#1f2638]">
                Цена / UTC
              </div>
              {grid.bars.map((c, i) => (
                <div key={c.timestamp || i} className="px-1 py-0.5 text-center bg-[#0f1420] border-b border-[#1f2638]">
                  <div className="text-foreground/80 font-semibold flex items-center justify-center gap-1">
                    <span>{fmtTime(c.timestamp)}</span>
                    {c.poc_migration === 1 && (
                      <span className="text-bull text-[8px]" title="POC сместился вверх">▲</span>
                    )}
                    {c.poc_migration === -1 && (
                      <span className="text-bear text-[8px]" title="POC сместился вниз">▼</span>
                    )}
                  </div>
                  <div className={`font-bold ${(c.total_delta || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>
                    Δ{(c.total_delta || 0) >= 0 ? '+' : ''}{fmtVol(c.total_delta)}
                  </div>
                  <div className="text-muted-foreground">
                    {fmtVol(c.total_volume)}
                    {(c.stacked_imbalance?.buy > 0 || c.stacked_imbalance?.sell > 0) && (
                      <span
                        className={c.stacked_imbalance?.buy > 0 ? 'text-bull font-bold' : 'text-bear font-bold'}
                        title={`Stacked imbalance x${Math.max(c.stacked_imbalance.buy, c.stacked_imbalance.sell)}`}
                      >
                        {' '}♦{Math.max(c.stacked_imbalance.buy, c.stacked_imbalance.sell)}
                      </span>
                    )}
                    {c.absorption && (
                      <span className="text-warning font-bold" title="Absorption: крупное лимитное поглощение"> ▬</span>
                    )}
                  </div>
                </div>
              ))}
              {settings.showProfile && (
                <div className="px-1.5 py-0.5 text-center bg-[#0f1420] border-b border-l border-[#1f2638] text-muted-foreground font-semibold">
                  <div>Профиль окна</div>
                  <div className="text-[8px] text-amber-300/90">ΣVol / Δ</div>
                </div>
              )}

              {/* Строки уровней цен */}
              {grid.rows.map((row, rowIdx) => {
                const prof = sessionProfile.levels[rowIdx];
                return (
                  <React.Fragment key={row.price}>
                    <div
                      data-poc-row={row.isPoc ? 'true' : undefined}
                      className={`sticky left-0 z-10 px-1 py-[1px] text-right border-y border-[#141a26] ${
                        prof?.isSessionPoc
                          ? 'bg-[#42320b] text-amber-300 font-bold'
                          : row.isPoc
                            ? 'bg-[#2a220c] text-amber-200 font-semibold'
                            : 'bg-[#0a0d14] text-muted-foreground'
                      }`}
                      title={
                        prof?.isSessionPoc
                          ? 'Session POC — максимальный объём всего окна'
                          : row.isPoc
                            ? 'POC свечи — уровень максимального объёма'
                            : undefined
                      }
                    >
                      {prof?.isSessionPoc ? '★ ' : row.isPoc ? '◆ ' : ''}
                      {row.price}
                    </div>
                    {row.cells.map((cell, i) => {
                      if (!cell) {
                        return <div key={i} className="bg-[#0b0f16] border-y border-[#10151f]" />;
                      }
                      const side = cellSide(cell);
                      const intensity = cellIntensity(cell, candleMaxVols[i]);
                      const bg =
                        side === 'buy'
                          ? `rgba(16,185,129,${0.06 + intensity * 0.36})`
                          : side === 'sell'
                            ? `rgba(244,63,94,${0.06 + intensity * 0.36})`
                            : 'rgba(148,163,184,0.05)';
                      const imbBorder =
                        cell.imbalance === 'buy'
                          ? 'border-l-2 border-emerald-400'
                          : cell.imbalance === 'sell'
                            ? 'border-l-2 border-rose-400'
                            : 'border-l-2 border-transparent';
                      const pocOutline =
                        settings.highlightCandlePoc && cell.isCandlePoc
                          ? 'ring-1 ring-inset ring-amber-400/80 font-bold'
                          : '';

                      return (
                        <div
                          key={i}
                          title={`${row.price}: Buy ${cell.buy} × Sell ${cell.sell} | Δ ${cell.delta >= 0 ? '+' : ''}${cell.delta} | Vol ${cell.vol}${cell.isCandlePoc ? ' | ★ POC свечи' : ''}${cell.imbalance ? ` | Imbalance: ${cell.imbalance.toUpperCase()}` : ''}`}
                          className={`px-1 py-[1px] text-center ${imbBorder} ${pocOutline} border-y border-[#10151f]`}
                          style={{ backgroundColor: bg }}
                        >
                          {settings.displayMode === 'bid_ask' && (
                            <>
                              <span className="text-emerald-300/95">{fmtVol(cell.buy)}</span>
                              <span className="text-muted-foreground mx-0.5">×</span>
                              <span className="text-rose-300/95">{fmtVol(cell.sell)}</span>
                            </>
                          )}
                          {settings.displayMode === 'delta' && (
                            <span className={cell.delta >= 0 ? 'text-emerald-300 font-semibold' : 'text-rose-300 font-semibold'}>
                              {cell.delta >= 0 ? '+' : ''}{fmtVol(cell.delta)}
                            </span>
                          )}
                          {settings.displayMode === 'volume' && (
                            <span className="text-foreground">
                              {fmtVol(cell.vol)}
                            </span>
                          )}
                          {settings.displayMode === 'imbalance' && (
                            cell.imbalance ? (
                              <span className={cell.imbalance === 'buy' ? 'text-emerald-300 font-bold' : 'text-rose-300 font-bold'}>
                                {cell.imbalance === 'buy' ? `▲ ${fmtVol(cell.buy)}` : `▼ ${fmtVol(cell.sell)}`}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">·</span>
                            )
                          )}
                        </div>
                      );
                    })}

                    {/* Ячейка бокового профиля объёма (Session Volume Profile) */}
                    {settings.showProfile && prof && (
                      <div
                        className="relative px-1.5 py-[1px] border-y border-l border-[#161d2b] bg-[#0b101b] flex items-center justify-between text-[8.5px]"
                        title={`Уровень ${row.price}: ΣVol ${fmtVol(prof.vol)} (Buy ${fmtVol(prof.buy)} / Sell ${fmtVol(prof.sell)}, Δ ${prof.delta >= 0 ? '+' : ''}${fmtVol(prof.delta)})`}
                      >
                        <div
                          className={`absolute left-0 top-0 bottom-0 pointer-events-none ${
                            prof.isSessionPoc
                              ? 'bg-amber-400/25'
                              : prof.delta >= 0
                                ? 'bg-bull-soft'
                                : 'bg-bear-soft'
                          }`}
                          style={{ width: `${Math.round(prof.volShare * 100)}%` }}
                        />
                        <span className={`relative z-10 ${prof.isSessionPoc ? 'text-amber-300 font-bold' : 'text-foreground/80'}`}>
                          {fmtVol(prof.vol)}
                        </span>
                        <span
                          className={`relative z-10 ${
                            prof.delta > 0 ? 'text-bull' : prof.delta < 0 ? 'text-bear' : 'text-muted-foreground'
                          }`}
                        >
                          {prof.delta > 0 ? '+' : ''}{fmtVol(prof.delta)}
                        </span>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* Подвал: сводка окна + активные кластерные сигналы последней свечи */}
          <div className="px-2.5 py-1 border-t border-[#1f2638] bg-[#0f1420] flex items-center justify-between gap-2 text-[9.5px] font-mono text-muted-foreground shrink-0 flex-wrap">
            <div className="flex items-center gap-2">
              <span>
                Свечей: <span className="text-foreground/80">{grid.bars.length}</span> · ΣVol:{' '}
                <span className="text-foreground/80">{fmtVol(grid.totalVolume)}</span> · |Δ|/Vol:{' '}
                <span className="text-foreground/80">{deltaShare.toFixed(1)}%</span>
              </span>
              {sessionProfile.sessionPocPrice != null && (
                <span className="text-amber-300/90" title="Уровень максимального объёма за всё окно">
                  ★POC: {sessionProfile.sessionPocPrice}
                </span>
              )}
              {latestCandle?.absorption && (
                <span className="px-1 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  ▬ ABSORPTION
                </span>
              )}
              {(latestCandle?.stacked_imbalance?.buy > 0 || latestCandle?.stacked_imbalance?.sell > 0) && (
                <span
                  className={`px-1 rounded border ${
                    latestCandle.stacked_imbalance.buy > 0
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                  }`}
                >
                  ♦ STACKED {latestCandle.stacked_imbalance.buy > 0 ? `BUY ×${latestCandle.stacked_imbalance.buy}` : `SELL ×${latestCandle.stacked_imbalance.sell}`}
                </span>
              )}
            </div>
            <span>{lastUpdate ? `обновлено ${new Date(lastUpdate).toLocaleTimeString('ru-RU')}` : ''}</span>
          </div>
        </>
      )}
    </div>
  );
}
