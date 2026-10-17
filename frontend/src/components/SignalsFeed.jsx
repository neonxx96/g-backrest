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
          setLastUpdated(new Date().toLocaleTimeString());
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
    <div className="flex flex-col h-full bg-[#0e1118] text-[#d1d4dc] border border-[#1b212f] rounded-lg overflow-hidden text-xs shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#121620] border-b border-[#1b212f]">
        <div className="flex items-center space-x-1.5 font-bold text-white">
          <Radio size={14} className="text-[#00c087] animate-pulse" />
          <span>Сигналы ({signals.length})</span>
        </div>

        <div className="flex items-center space-x-2">
          {lastUpdated && (
            <span className="text-[10px] text-[#6b7280] font-mono">{lastUpdated}</span>
          )}
          <button
            onClick={handleManualScan}
            disabled={isScanning}
            className={`p-1 rounded text-[#2563eb] hover:bg-[#1a2130] transition ${isScanning ? 'animate-spin' : ''}`}
            title="Запустить сканирование вручную"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Signals List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#161b26] p-1.5 space-y-1">
        {signals.length === 0 ? (
          <div className="p-5 text-center text-[#6b7280] flex flex-col items-center justify-center space-y-2">
            <Bell size={22} className="text-[#1f2937] mb-1" />
            <span className="font-medium text-xs">Ожидание сигналов...</span>
            <span className="text-[10px]">Сканер опрашивает Binance каждую минуту</span>
          </div>
        ) : (
          signals.map((sig) => {
            const isBull = sig.direction === "BULLISH";
            const isBear = sig.direction === "BEARISH";
            const badgeClass = isBull 
              ? "bg-[#00c08715] text-[#00c087] border-[#00c08740]" 
              : (isBear ? "bg-[#f6465d15] text-[#f6465d] border-[#f6465d40]" : "bg-[#f59e0b15] text-[#f59e0b] border-[#f59e0b40]");

            return (
              <div
                key={sig.id}
                onClick={() => onSelectSignal(sig.symbol, sig.timeframe)}
                className="p-2 rounded bg-[#121620] hover:bg-[#181e2b] cursor-pointer transition border border-transparent hover:border-[#2563eb40] space-y-1"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 font-bold">
                    <span className="text-white hover:text-[#2563eb] flex items-center">
                      #{sig.symbol}
                      <ExternalLink size={10} className="ml-1 opacity-70" />
                    </span>
                    <span className="px-1.5 py-0.2 rounded text-[10px] bg-[#1a2130] text-[#848e9c]">
                      {sig.timeframe}
                    </span>
                  </div>

                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${badgeClass}`}>
                    {sig.direction || sig.condition_type}
                  </span>
                </div>

                <div className="text-[11px] text-[#94a3b8] leading-tight">
                  {sig.description}
                </div>

                <div className="flex items-center justify-between text-[10px] text-[#6b7280] pt-0.5">
                  <span>Цена: <span className="font-mono text-white font-medium">${sig.price}</span></span>
                  <span className="font-mono">{sig.created_at.split(' ')[1]}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
