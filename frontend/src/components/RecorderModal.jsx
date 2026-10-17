import React, { useState, useEffect } from 'react';
import { HardDrive, Download, Database, CheckCircle2, Shield, RefreshCw, X, Radio } from 'lucide-react';

const API_BASE = '/api';

export default function RecorderModal({ isOpen, onClose, activeSymbol }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedExportSym, setSelectedExportSym] = useState("");

  const fetchStats = () => {
    setLoading(true);
    fetch(`${API_BASE}/recorder/status`)
      .then(res => res.json())
      .then(data => {
        setStats(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Error fetching recorder stats:", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    if (isOpen) {
      fetchStats();
      const timer = setInterval(fetchStats, 5000);
      return () => clearInterval(timer);
    }
  }, [isOpen]);

  const handleExport = (sym) => {
    setExporting(true);
    const url = sym ? `${API_BASE}/recorder/export?symbol=${sym}` : `${API_BASE}/recorder/export`;
    window.open(url, '_blank');
    setTimeout(() => setExporting(false), 2000);
  };

  const toggleRecording = () => {
    if (!stats) return;
    fetch(`${API_BASE}/recorder/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_recording: !stats.is_recording })
    })
      .then(res => res.json())
      .then(data => setStats(data))
      .catch(err => console.error("Error toggling recorder:", err));
  };

  if (!isOpen) return null;

  const usedMb = stats ? stats.used_storage_mb : 0;
  const maxGb = stats ? stats.max_storage_gb : 100;
  const usedGb = stats ? stats.used_storage_gb : 0;
  const usagePct = stats ? Math.min(100, (usedGb / maxGb) * 100).toFixed(2) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#0b0e14] border border-[#1b212f] rounded-xl w-full max-w-2xl text-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1b212f] bg-[#0e1118]">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-[#2563eb]/20 text-[#2563eb]">
              <Database size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-wide">Хранилище Order Flow и Рекордер</h2>
              <p className="text-[11px] text-[#848e9c]">Запись тиков, ленты и стакана с квотой 100 GB и FIFO ротацией</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={fetchStats}
              disabled={loading}
              className="p-1.5 rounded bg-[#121620] hover:bg-[#1a2130] text-[#848e9c] hover:text-white transition"
              title="Обновить данные"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded bg-[#121620] hover:bg-[#1a2130] text-[#848e9c] hover:text-white transition"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Storage Bar Card */}
          <div className="bg-[#121620] p-4 rounded-lg border border-[#1b212f]">
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center space-x-2">
                <HardDrive size={15} className="text-[#2563eb]" />
                <span className="text-xs font-semibold text-gray-300">Квота хранилища (100 GB)</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <span className={`inline-block w-2 h-2 rounded-full ${stats?.is_recording ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                <span className="text-[11px] font-mono text-gray-300">
                  {stats?.is_recording ? 'ЗАПИСЬ АКТИВНА' : 'ЗАПИСЬ НА ПАУЗЕ'}
                </span>
                <button
                  onClick={toggleRecording}
                  className="ml-2 px-2 py-0.5 rounded text-[10px] bg-[#1a2130] hover:bg-[#222b3d] text-gray-300 border border-[#2a3449]"
                >
                  {stats?.is_recording ? 'Пауза' : 'Возобновить'}
                </button>
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-[#0a0d13] h-2.5 rounded-full overflow-hidden border border-[#1f2637]">
              <div
                className="bg-gradient-to-r from-blue-600 to-emerald-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(1, usagePct)}%` }}
              />
            </div>

            <div className="flex justify-between text-[11px] text-[#848e9c] font-mono mt-1.5">
              <span>Использовано: <strong className="text-white">{usedMb} MB</strong> ({usedGb} GB)</span>
              <span>Лимит: <strong className="text-white">{maxGb} GB</strong> (FIFO очистка при превышении)</span>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-[#121620] p-3 rounded-lg border border-[#1b212f]">
              <span className="text-[10px] text-[#848e9c] uppercase tracking-wider block mb-1">Сделок за сессию</span>
              <span className="text-lg font-bold font-mono text-emerald-400">
                {stats?.total_trades_session?.toLocaleString() || 0}
              </span>
            </div>
            <div className="bg-[#121620] p-3 rounded-lg border border-[#1b212f]">
              <span className="text-[10px] text-[#848e9c] uppercase tracking-wider block mb-1">Фокус монет</span>
              <span className="text-lg font-bold font-mono text-blue-400">
                {stats?.focus_symbols?.length || 5}
              </span>
            </div>
            <div className="bg-[#121620] p-3 rounded-lg border border-[#1b212f]">
              <span className="text-[10px] text-[#848e9c] uppercase tracking-wider block mb-1">Parquet файлов</span>
              <span className="text-lg font-bold font-mono text-purple-400">
                {stats?.total_files || 0}
              </span>
            </div>
          </div>

          {/* Focus Coins Breakdown */}
          <div className="bg-[#121620] p-4 rounded-lg border border-[#1b212f]">
            <h3 className="text-xs font-bold text-gray-300 mb-2.5 flex items-center justify-between">
              <span>Основной фокус (глубокий DOM + лента сделок)</span>
              <span className="text-[10px] text-[#848e9c] font-normal">Паркетное сжатие Snappy</span>
            </h3>

            <div className="space-y-1.5">
              {stats?.focus_symbols?.map(sym => {
                const info = stats.breakdown?.[sym] || { files_count: 0, size_mb: 0 };
                return (
                  <div key={sym} className="flex items-center justify-between px-3 py-2 rounded bg-[#0a0d13] border border-[#1a2130] text-xs">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono font-bold text-white">{sym}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800">
                        Фокус
                      </span>
                    </div>
                    <div className="flex items-center space-x-4 font-mono text-[11px]">
                      <span className="text-gray-400">{info.files_count} файл(ов)</span>
                      <span className="text-emerald-400 font-semibold">{info.size_mb} MB</span>
                      <button
                        onClick={() => handleExport(sym)}
                        className="px-2 py-0.5 bg-[#1b2230] hover:bg-[#253043] rounded text-gray-300 hover:text-white transition flex items-center space-x-1"
                        title={`Скачать архив ${sym}`}
                      >
                        <Download size={11} />
                        <span>Экспорт</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Export Action Card */}
          <div className="p-4 rounded-lg bg-gradient-to-r from-[#111726] to-[#0d1522] border border-[#1e293b] flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold text-white flex items-center space-x-1.5">
                <Download size={14} className="text-[#2563eb]" />
                <span>Полный архив базы (ZIP)</span>
              </h4>
              <p className="text-[11px] text-[#848e9c] mt-0.5">
                Выгрузить все собранные Parquet датасеты на локальный диск или сервер
              </p>
            </div>
            <button
              onClick={() => handleExport(null)}
              disabled={exporting}
              className="px-4 py-2 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-lg shadow-blue-900/30"
            >
              <Download size={13} />
              <span>{exporting ? 'Формирование...' : 'Скачать все (ZIP)'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
