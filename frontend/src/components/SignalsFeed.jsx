import React, { useEffect, useState } from 'react';
import { Bell, Radio, ExternalLink, RefreshCw } from 'lucide-react';

const API_BASE = "/api";

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
          const kyivTime = new Date().toLocaleTimeString('ru-RU', { timeZone: 'Europe/Kyiv', hour12: false });
          setLastUpdated(`${kyivTime} (Киев)`);
        }
      })
      .catch(err => console.error("Could not fetch signals:", err));
  };

  useEffect(() => {
    fetchSignals();
    const interval = setInterval(fetchSignals, 4000); // 4s polling
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
    <div className="flex flex-col h-full bg-[#0c0e12] text-[#d1d4dc] border border-[#161922] overflow-hidden text-xs select-none relative font-sans">
      {/* Header (Tealstreet flat minimal) */}
      <div className="flex items-center justify-between px-2.5 py-1 bg-[#101217] border-b border-[#161922]">
        <div className="flex items-center space-x-1.5 font-bold text-white text-[11px]">
          <Radio size={13} className="text-[#26a69a] animate-pulse" />
          <span>Сигналы ({signals.length})</span>
        </div>

        <div className="flex items-center space-x-2 font-mono">
          {lastUpdated && (
            <span className="text-[10px] text-[#60697b] font-mono-numbers">{lastUpdated}</span>
          )}
          <button
            onClick={handleManualScan}
            disabled={isScanning}
            className={`p-1 rounded text-[#38bdf8] hover:bg-[#161922] transition ${isScanning ? 'animate-spin' : ''}`}
            title="Запустить ручное сканирование"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* Signals List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#13161f] p-1 space-y-1">
        {signals.length === 0 ? (
          <div className="p-6 text-center text-[#60697b] flex flex-col items-center justify-center space-y-1.5">
            <Bell size={20} className="text-[#1f2430] mb-1" />
            <span className="font-medium text-xs text-[#787f91]">Ожидание сигналов...</span>
            <span className="text-[10px]">Сканер опрашивает Binance каждую минуту</span>
          </div>
        ) : (
          signals.map((sig) => {
            const isBull = sig.direction === "BULLISH";
            const isBear = sig.direction === "BEARISH";
            const badgeClass = isBull 
              ? "bg-[#26a69a18] text-[#26a69a] border-[#26a69a40]" 
              : (isBear ? "bg-[#ef535018] text-[#ef5350] border-[#ef535040]" : "bg-[#f59e0b18] text-[#f59e0b] border-[#f59e0b40]");

            return (
              <div
                key={sig.id}
                onClick={() => onSelectSignal(sig.symbol, sig.timeframe)}
                className="p-2 rounded bg-[#0e1015] hover:bg-[#141720] cursor-pointer transition border border-[#161922] hover:border-[#38bdf840] space-y-1"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 font-bold">
                    <span className="text-white hover:text-[#38bdf8] flex items-center font-mono">
                      #{sig.symbol}
                      <ExternalLink size={10} className="ml-1 opacity-60" />
                    </span>
                    <span className="px-1 py-0.2 rounded text-[10px] bg-[#161922] text-[#787f91] font-mono">
                      {sig.timeframe}
                    </span>
                  </div>

                  <div className="flex items-center space-x-1">
                    {sig.normalized_metric && (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-[#1e293b] text-[#38bdf8] border border-[#38bdf840]">
                        {sig.normalized_metric}
                      </span>
                    )}
                    <span className={`px-1.5 py-0.2 rounded text-[9px] font-semibold border ${badgeClass} font-mono`}>
                      {sig.direction || sig.condition_type}
                    </span>
                  </div>
                </div>

                <div className="text-[11px] text-[#94a3b8] leading-tight">
                  {sig.description}
                </div>

                <div className="flex items-center justify-between text-[10px] text-[#60697b] pt-0.5 font-mono">
                  <span>Цена: <span className="text-white font-mono-numbers">${sig.price}</span></span>
                  <span className="font-mono-numbers">{sig.created_at.includes(' ') ? sig.created_at.split(' ')[1] : sig.created_at}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
