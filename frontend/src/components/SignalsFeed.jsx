import React, { useEffect, useState } from 'react';
import { Bell, Radio, ExternalLink, RefreshCw, AlertTriangle } from 'lucide-react';

const API_BASE = "http://localhost:8000/api";

export default function SignalsFeed({ onSelectSignal }) {
  const [signals, setSignals] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("");

  const fetchSignals = () => {
    fetch(`${API_BASE}/signals?limit=30`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSignals(data);
          setLastUpdated(new Date().toLocaleTimeString());
        }
      })
      .catch(err => console.error("Could not fetch signals:", err));
  };

  useEffect(() => {
    fetchSignals();
    const interval = setInterval(fetchSignals, 5000); // 5s polling
    return () => clearInterval(interval);
  }, []);

  const handleManualScan = () => {
    setIsScanning(true);
    fetch(`${API_BASE}/scan`, { method: "POST" })
      .then(res => res.json())
      .then(() => {
        fetchSignals();
        setIsScanning(false);
      })
      .catch(() => setIsScanning(false));
  };

  return (
    <div className="flex flex-col h-full bg-[#131722] text-[#d1d4dc] border border-[#1e222d] rounded-lg overflow-hidden text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#1e222d] border-b border-[#2a2e39]">
        <div className="flex items-center space-x-1.5 font-semibold text-[#e0e3eb]">
          <Radio size={14} className="text-[#089981] animate-pulse" />
          <span>Лента Сигналов ({signals.length})</span>
        </div>

        <div className="flex items-center space-x-2">
          {lastUpdated && (
            <span className="text-[10px] text-[#787b86]">Обновлено: {lastUpdated}</span>
          )}
          <button
            onClick={handleManualScan}
            disabled={isScanning}
            className={`p-1 rounded hover:bg-[#2a2e39] text-[#2962ff] ${isScanning ? 'animate-spin' : ''}`}
            title="Запустить сканирование вручную"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Signals List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#1e222d] p-1.5 space-y-1">
        {signals.length === 0 ? (
          <div className="p-4 text-center text-[#787b86] flex flex-col items-center justify-center space-y-1">
            <Bell size={20} className="text-[#2a2e39] mb-1" />
            <span>Ожидание триггеров по вашим фильтрам...</span>
            <span className="text-[10px]">Сканер опрашивает рынок раз в минуту.</span>
          </div>
        ) : (
          signals.map((sig) => {
            const isBull = sig.direction === "BULLISH";
            const isBear = sig.direction === "BEARISH";
            const badgeBg = isBull ? "bg-[#08998122] text-[#089981] border-[#089981]" : (isBear ? "bg-[#f2364522] text-[#f23645] border-[#f23645]" : "bg-[#ff980022] text-[#ff9800] border-[#ff9800]");

            return (
              <div
                key={sig.id}
                onClick={() => onSelectSignal(sig.symbol, sig.timeframe)}
                className="p-2 rounded bg-[#181c27] hover:bg-[#1e222d] cursor-pointer transition border border-transparent hover:border-[#2a2e39] space-y-1"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 font-bold">
                    <span className="text-white hover:text-[#2962ff] flex items-center">
                      #{sig.symbol}
                      <ExternalLink size={10} className="ml-1 opacity-70" />
                    </span>
                    <span className="px-1.5 py-0.2 rounded text-[10px] bg-[#2a2e39] text-[#787b86]">
                      {sig.timeframe}
                    </span>
                  </div>

                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${badgeBg}`}>
                    {sig.direction || sig.condition_type}
                  </span>
                </div>

                <div className="text-[11px] text-[#9db2ce]">
                  {sig.description}
                </div>

                <div className="flex items-center justify-between text-[10px] text-[#787b86] pt-0.5">
                  <span>Цена: <span className="font-mono text-white">${sig.price}</span></span>
                  <span>{sig.created_at.split(' ')[1]}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
