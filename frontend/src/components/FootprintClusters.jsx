import React, { useState, useEffect } from 'react';
import { Layers, Activity, RefreshCw } from 'lucide-react';

const API_BASE = '/api';

export default function FootprintClusters({ symbol }) {
  const [clusters, setClusters] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchClusters = () => {
    fetch(`${API_BASE}/recorder/clusters?symbol=${symbol}&limit=5`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setClusters(data);
        }
      })
      .catch(err => console.error("Error fetching footprint clusters:", err));
  };

  useEffect(() => {
    fetchClusters();
    const interval = setInterval(fetchClusters, 3000);
    return () => clearInterval(interval);
  }, [symbol]);

  const latestCandle = clusters.length > 0 ? clusters[clusters.length - 1] : null;

  return (
    <div className="bg-[#0b0e14] border border-[#1b212f] rounded-lg p-2.5 flex flex-col h-full text-xs">
      <div className="flex items-center justify-between pb-2 border-b border-[#1b212f]">
        <div className="flex items-center space-x-1.5">
          <Activity size={13} className="text-[#2563eb]" />
          <span className="font-bold text-gray-200">Footprint / Кластера</span>
          <span className="text-[10px] text-gray-400 font-mono">({symbol})</span>
        </div>
        <div className="flex items-center space-x-2 font-mono text-[10px]">
          {latestCandle && (
            <span className={latestCandle.total_delta >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
              Δ: {latestCandle.total_delta >= 0 ? '+' : ''}{latestCandle.total_delta}
            </span>
          )}
        </div>
      </div>

      {/* Cluster Table */}
      <div className="flex-1 overflow-y-auto mt-2 space-y-1 pr-1 font-mono text-[11px]">
        {latestCandle?.levels?.map((lvl, idx) => {
          const maxVol = Math.max(...latestCandle.levels.map(l => l.buy_vol + l.sell_vol), 0.001);
          const totalVol = lvl.buy_vol + lvl.sell_vol;
          const barPct = Math.min(100, Math.round((totalVol / maxVol) * 100));
          const isPositive = lvl.delta >= 0;

          return (
            <div
              key={idx}
              className="relative flex items-center justify-between px-2 py-1 rounded bg-[#10141d] border border-[#18202d] overflow-hidden"
            >
              {/* Background Delta Volume Bar */}
              <div
                className={`absolute left-0 top-0 bottom-0 opacity-20 transition-all duration-300 ${isPositive ? 'bg-emerald-500' : 'bg-rose-500'}`}
                style={{ width: `${barPct}%` }}
              />

              {/* Price Level */}
              <span className="relative z-10 font-bold text-white">
                {lvl.price}
              </span>

              {/* Buy x Sell (Imbalance) */}
              <div className="relative z-10 flex items-center space-x-3 text-[10px]">
                <span className="text-emerald-400">{lvl.buy_vol}</span>
                <span className="text-gray-500">x</span>
                <span className="text-rose-400">{lvl.sell_vol}</span>
                <span className={`w-12 text-right font-bold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {isPositive ? '+' : ''}{lvl.delta}
                </span>
              </div>
            </div>
          );
        })}

        {(!latestCandle || !latestCandle.levels || latestCandle.levels.length === 0) && (
          <div className="py-8 text-center text-gray-500 text-xs">
            Накопление кластеров для {symbol}...
          </div>
        )}
      </div>
    </div>
  );
}
