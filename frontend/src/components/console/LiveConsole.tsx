import React, { useState } from 'react';
import { useAutomation } from '../../context/AutomationContext';
import { Terminal, Download, Trash2, Search, Filter } from 'lucide-react';

export const LiveConsole: React.FC = () => {
  const { logs, addLog } = useAutomation();
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');

  const filteredLogs = logs.filter((log) => {
    const matchesSearch = log.message.toLowerCase().includes(search.toLowerCase());
    const matchesType = filterType === 'all' || log.type === filterType;
    return matchesSearch && matchesType;
  });

  const handleDownload = () => {
    const content = logs.map((l) => `[${l.time}] [${l.type.toUpperCase()}] ${l.message}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `s4-telemetry-logs-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      
      {/* Header */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl backdrop-blur-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-bold text-white tracking-tight">Real-Time Ingestion Telemetry & Logs</h2>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Streaming audit trail of OCR extraction, reconciliation stages, and Zoho Books API dispatches.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold px-3 py-1.5 rounded-xl transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Logs</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800/80 rounded-xl p-2">
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
          {['all', 'info', 'success', 'warning', 'error'].map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-3 py-1 text-[11px] font-bold rounded-md uppercase transition cursor-pointer ${
                filterType === type ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              {type}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Filter logs by keyword..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 sm:w-72"
        />
      </div>

      {/* Terminal View */}
      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 font-mono text-xs shadow-2xl h-[520px] overflow-y-auto custom-scrollbar flex flex-col space-y-2">
        {filteredLogs.length > 0 ? (
          filteredLogs.map((log, idx) => {
            const isError = log.type === 'error';
            const isSuccess = log.type === 'success';
            const isWarn = log.type === 'warning';

            return (
              <div
                key={idx}
                className={`p-2 rounded-lg flex items-start gap-2.5 transition-colors ${
                  isError
                    ? 'bg-red-950/30 text-red-300 border border-red-500/20'
                    : isSuccess
                    ? 'bg-emerald-950/20 text-emerald-300 border border-emerald-500/10'
                    : isWarn
                    ? 'bg-amber-950/20 text-amber-300 border border-amber-500/10'
                    : 'bg-slate-900/40 text-slate-300'
                }`}
              >
                <span className="text-[10px] text-slate-500 shrink-0 select-none">[{log.time}]</span>
                <span
                  className={`text-[10px] font-bold uppercase px-1.5 rounded select-none shrink-0 ${
                    isError
                      ? 'bg-red-900/80 text-red-200'
                      : isSuccess
                      ? 'bg-emerald-900/80 text-emerald-200'
                      : isWarn
                      ? 'bg-amber-900/80 text-amber-200'
                      : 'bg-sky-950 text-sky-300 border border-sky-500/20'
                  }`}
                >
                  {log.type}
                </span>
                <span className="break-all">{log.message}</span>
              </div>
            );
          })
        ) : (
          <div className="text-center py-20 text-slate-600">No logs matching filter.</div>
        )}
      </div>

    </div>
  );
};
