import React, { useState, useEffect, useMemo } from 'react';
import { BarChart3, Radio, PlusCircle } from 'lucide-react';
import ChannelSelector from './ChannelSelector';
import { useColorLinksStore } from '../../stores/colorLinksStore';
import { buildFootprintGrid, fmtVol, fmtTime, cellSide, cellIntensity } from './footprintGrid';

const API_BASE = '/api';
const MAX_BARS = 14;
const REFRESH_MS = 3000;

export default function FootprintPanel({ panelId = 'footprint' }) {
  const currentSymbol = useColorLinksStore((s) => s.getPanelSymbol(panelId, 'BTCUSDT'));
  const [candles, setCandles] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [recorderSymbols, setRecorderSymbols] = useState(null);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(`${API_BASE}/recorder/clusters?symbol=${encodeURIComponent(currentSymbol)}&limit=${MAX_BARS}`)
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
  }, [currentSymbol]);

  useEffect(() => {
    fetch(`${API_BASE}/recorder/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.focus_symbols)) setRecorderSymbols(d.focus_symbols);
      })
      .catch(() => {});
  }, []);

  const grid = useMemo(() => buildFootprintGrid(candles, MAX_BARS), [candles]);
  const candleMaxVols = useMemo(
    () =>
      grid.bars.map((c) =>
        Math.max(...(c?.levels || []).map((l) => (Number(l.buy_vol) || 0) + (Number(l.sell_vol) || 0)), 0)
      ),
    [grid]
  );

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

  return (
    <div
      data-testid="footprint-panel"
      className="h-full w-full flex flex-col font-sans select-none bg-[#0a0d14] text-[#d1d4dc] border-r border-[#1a1f2c]"
    >
      <div className="px-2.5 py-1.5 border-b border-[#1f2638] bg-[#0f1420] flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-1.5">
          <BarChart3 size={12} className="text-[#3b82f6]" />
          <span className="font-bold text-[11px] text-white">Футпринт / Кластеры</span>
          <span className="text-[10px] text-[#60a5fa] font-mono font-semibold">{currentSymbol}</span>
          {hasData && (
            <span
              className={`text-[10px] font-mono font-bold ${grid.cvd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
              title="Кумулятивная дельта окна (CVD)"
            >
              CVD {grid.cvd >= 0 ? '+' : ''}{fmtVol(grid.cvd)}
            </span>
          )}
        </div>
        <div className="flex items-center space-x-2">
          {hasData && (
            <span className="flex items-center space-x-1 text-[9px] font-mono text-gray-500">
              <Radio size={10} className={isLive ? 'text-emerald-400 animate-pulse' : 'text-gray-600'} />
              <span>{isLive ? 'LIVE' : 'пауза'}</span>
            </span>
          )}
          <ChannelSelector panelId={panelId} />
        </div>
      </div>

      {!hasData ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
          <div className="p-3 rounded-full bg-[#1e293b50] border border-[#33415550] text-[#38bdf8]">
            <BarChart3 size={24} className="animate-pulse" />
          </div>
          <div className="space-y-1 max-w-sm">
            <div className="font-bold text-white text-[12px]">Нет кластеров для {currentSymbol}</div>
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
          {/* Грид футпринта */}
          <div className="flex-1 overflow-auto mt-1 px-1 pb-1">
            <div
              className="grid gap-px text-[9px] font-mono min-w-max"
              style={{ gridTemplateColumns: `58px repeat(${grid.bars.length}, minmax(78px, 1fr))` }}
            >
              {/* Шапка свечей: время, дельта, объём, маркеры stacked/absorption */}
              <div className="sticky left-0 bg-[#0a0d14] z-10 px-1 py-0.5 text-gray-600">UTC</div>
              {grid.bars.map((c, i) => (
                <div key={c.timestamp || i} className="px-1 py-0.5 text-center bg-[#0f1420] border-b border-[#1f2638]">
                  <div className="text-gray-400 font-semibold">{fmtTime(c.timestamp)}</div>
                  <div className={`font-bold ${(c.total_delta || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    Δ{(c.total_delta || 0) >= 0 ? '+' : ''}{fmtVol(c.total_delta)}
                  </div>
                  <div className="text-gray-500">
                    {fmtVol(c.total_volume)}
                    {(c.stacked_imbalance?.buy > 0 || c.stacked_imbalance?.sell > 0) && (
                      <span
                        className={c.stacked_imbalance?.buy > 0 ? 'text-emerald-400' : 'text-rose-400'}
                        title={`Stacked imbalance x${Math.max(c.stacked_imbalance.buy, c.stacked_imbalance.sell)}`}
                      >
                        {' '}♦{Math.max(c.stacked_imbalance.buy, c.stacked_imbalance.sell)}
                      </span>
                    )}
                    {c.absorption && (
                      <span className="text-amber-400" title="Absorption: большой объём при малой дельте"> ▬</span>
                    )}
                  </div>
                </div>
              ))}

              {/* Строки уровней цен */}
              {grid.rows.map((row) => (
                <React.Fragment key={row.price}>
                  <div
                    className={`sticky left-0 z-10 px-1 py-[1px] text-right border-y border-[#141a26] ${
                      row.isPoc ? 'bg-[#3b2f0b] text-amber-300 font-bold' : 'bg-[#0a0d14] text-gray-500'
                    }`}
                    title={row.isPoc ? 'POC — уровень максимального объёма' : undefined}
                  >
                    {row.isPoc ? '◆ ' : ''}
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
                        ? `rgba(16,185,129,${0.06 + intensity * 0.34})`
                        : side === 'sell'
                          ? `rgba(244,63,94,${0.06 + intensity * 0.34})`
                          : 'rgba(148,163,184,0.05)';
                    const imbBorder =
                      cell.imbalance === 'buy'
                        ? 'border-l-2 border-emerald-400'
                        : cell.imbalance === 'sell'
                          ? 'border-l-2 border-rose-400'
                          : 'border-l-2 border-transparent';
                    return (
                      <div
                        key={i}
                        title={`${row.price}: buy ${cell.buy} x sell ${cell.sell} | Δ ${cell.delta >= 0 ? '+' : ''}${cell.delta}${cell.imbalance ? ` | imbalance: ${cell.imbalance}` : ''}`}
                        className={`px-1 py-[1px] text-center ${imbBorder} border-y border-[#10151f]`}
                        style={{ backgroundColor: bg }}
                      >
                        <span className="text-emerald-300/90">{fmtVol(cell.buy)}</span>
                        <span className="text-gray-600 mx-0.5">×</span>
                        <span className="text-rose-300/90">{fmtVol(cell.sell)}</span>
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Подвал: сводка окна */}
          <div className="px-2.5 py-1 border-t border-[#1f2638] bg-[#0f1420] flex items-center justify-between text-[9.5px] font-mono text-gray-500 shrink-0">
            <span>
              Свечей: <span className="text-gray-300">{grid.bars.length}</span> · ΣVol:{' '}
              <span className="text-gray-300">{fmtVol(grid.totalVolume)}</span> · |Δ|/Vol:{' '}
              <span className="text-gray-300">{deltaShare.toFixed(1)}%</span>
            </span>
            <span>{lastUpdate ? `обновлено ${new Date(lastUpdate).toLocaleTimeString('ru-RU')}` : ''}</span>
          </div>
        </>
      )}
    </div>
  );
}
