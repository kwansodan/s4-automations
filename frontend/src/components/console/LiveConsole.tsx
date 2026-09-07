import React, { useState, useEffect, useCallback } from 'react';
import { useAutomation } from '../../context/AutomationContext';
import { useErrors } from '../../context/ErrorContext';
import {
  Terminal,
  Download,
  Search,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  AlertCircle,
  Activity,
  Server,
  PlayCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { fetchServerLogsApi, clearServerLogsApi } from '../../lib/api';
import type { ServerLogRecord } from '../../types/errors';

export const LiveConsole: React.FC = () => {
  const { logs } = useAutomation();
  const { openDebugDrawer } = useErrors();

  const [activeConsoleTab, setActiveConsoleTab] = useState<'telemetry' | 'server'>('telemetry');

  // Telemetry Tab State
  const [telemetrySearch, setTelemetrySearch] = useState('');
  const [telemetryFilter, setTelemetryFilter] = useState<string>('all');
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // Server Logs Tab State
  const [serverLogs, setServerLogs] = useState<ServerLogRecord[]>([]);
  const [serverLevel, setServerLevel] = useState<string>('ALL');
  const [serverSearch, setServerSearch] = useState('');
  const [isLoadingServerLogs, setIsLoadingServerLogs] = useState(false);
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(true);
  const [copiedServerIdx, setCopiedServerIdx] = useState<number | null>(null);
  const [expandedTracebacks, setExpandedTracebacks] = useState<Record<number, boolean>>({});

  const filteredTelemetryLogs = logs.filter((log) => {
    const matchesSearch = log.message.toLowerCase().includes(telemetrySearch.toLowerCase());
    const matchesType = telemetryFilter === 'all' || log.type === telemetryFilter;
    return matchesSearch && matchesType;
  });

  const loadServerLogs = useCallback(async () => {
    setIsLoadingServerLogs(true);
    try {
      const res = await fetchServerLogsApi(serverLevel, 100, serverSearch);
      setServerLogs(res.logs || []);
    } catch (err) {
      console.warn('Could not fetch server logs:', err);
    } finally {
      setIsLoadingServerLogs(false);
    }
  }, [serverLevel, serverSearch]);

  // Initial load and polling for server logs
  useEffect(() => {
    if (activeConsoleTab !== 'server') return;
    loadServerLogs();

    if (!isAutoRefreshing) return;
    const interval = setInterval(loadServerLogs, 3000);
    return () => clearInterval(interval);
  }, [activeConsoleTab, isAutoRefreshing, loadServerLogs]);

  const handleClearServerLogs = async () => {
    if (window.confirm('Clear all in-memory server logs?')) {
      try {
        await clearServerLogsApi();
        setServerLogs([]);
      } catch (err) {
        console.error('Failed to clear logs:', err);
      }
    }
  };

  const toggleTraceback = (idx: number) => {
    setExpandedTracebacks((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  };

  const handleDownloadTelemetry = () => {
    const content = logs.map((l) => `[${l.time}] [${l.type.toUpperCase()}] ${l.message}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `s4-telemetry-logs-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadServerLogs = () => {
    const content = serverLogs
      .map(
        (l) =>
          `[${l.timestamp}] [${l.level}] [${l.logger}] ${l.message}${
            l.traceback ? '\nTRACEBACK:\n' + l.traceback : ''
          }`
      )
      .join('\n\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `s4-server-logs-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyLog = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const handleCopyServerLog = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedServerIdx(idx);
    setTimeout(() => setCopiedServerIdx(null), 2000);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header */}
      <div className="glass-panel rounded-2xl p-5 shadow-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-bold text-white tracking-tight">Real-Time Console &amp; System Telemetry</h2>
            <span className="text-[10px] font-mono font-bold text-sky-400 bg-sky-950/80 border border-sky-500/30 px-2 py-0.5 rounded-full">
              Live Stream
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Monitor Gemini OCR workflows and live Python backend terminal stdout/stderr logs directly inside the browser.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeConsoleTab === 'telemetry' ? (
            <button
              onClick={handleDownloadTelemetry}
              className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold px-3.5 py-2 rounded-xl transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Telemetry (.txt)</span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={handleClearServerLogs}
                className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 hover:border-rose-700/50 text-rose-300 text-xs font-semibold px-3 py-2 rounded-xl transition cursor-pointer"
                title="Clear in-memory server logs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
              <button
                onClick={handleDownloadServerLogs}
                className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold px-3.5 py-2 rounded-xl transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Terminal Logs (.txt)</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Mode Toggle: Ingestion Telemetry vs Backend Server Output */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveConsoleTab('telemetry')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition cursor-pointer ${
              activeConsoleTab === 'telemetry'
                ? 'bg-sky-600 text-white shadow-lg shadow-sky-600/30'
                : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Workflow Telemetry ({logs.length})</span>
          </button>
          <button
            onClick={() => setActiveConsoleTab('server')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition cursor-pointer ${
              activeConsoleTab === 'server'
                ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30'
                : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>Backend Server Terminal Logs ({serverLogs.length})</span>
          </button>
        </div>

        <button
          onClick={() => openDebugDrawer(activeConsoleTab === 'server' ? 'logs' : 'errors')}
          className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 font-semibold cursor-pointer"
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>Open In-App Debug Inspector</span>
        </button>
      </div>

      {/* VIEW 1: WORKFLOW TELEMETRY */}
      {activeConsoleTab === 'telemetry' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800/80 rounded-xl p-2">
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 overflow-x-auto">
              {['all', 'info', 'success', 'warning', 'error'].map((type) => (
                <button
                  key={type}
                  onClick={() => setTelemetryFilter(type)}
                  className={`px-3 py-1 text-[11px] font-bold rounded-md uppercase transition cursor-pointer whitespace-nowrap ${
                    telemetryFilter === type ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter telemetry events..."
                value={telemetrySearch}
                onChange={(e) => setTelemetrySearch(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 sm:w-72"
              />
            </div>
          </div>

          {/* Terminal View */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 font-mono text-xs shadow-2xl h-[560px] overflow-y-auto custom-scrollbar flex flex-col space-y-2">
            {filteredTelemetryLogs.length > 0 ? (
              filteredTelemetryLogs.map((log, idx) => {
                const isError = log.type === 'error';
                const isSuccess = log.type === 'success';
                const isWarn = log.type === 'warning';

                return (
                  <div
                    key={idx}
                    className={`p-2.5 rounded-xl flex items-start justify-between gap-3 transition-colors group ${
                      isError
                        ? 'bg-red-950/30 text-red-300 border border-red-500/20'
                        : isSuccess
                        ? 'bg-emerald-950/20 text-emerald-300 border border-emerald-500/10'
                        : isWarn
                        ? 'bg-amber-950/20 text-amber-300 border border-amber-500/10'
                        : 'bg-slate-900/40 text-slate-300 border border-slate-855'
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span className="text-[10px] text-slate-500 shrink-0 select-none mt-0.5">[{log.time}]</span>
                      <span
                        className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded select-none shrink-0 ${
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

                    <button
                      onClick={() => handleCopyLog(`[${log.time}] [${log.type.toUpperCase()}] ${log.message}`, idx)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition shrink-0 cursor-pointer"
                      title="Copy log entry"
                    >
                      {copiedIdx === idx ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-20 text-slate-600">No telemetry logs matching filter criteria.</div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 2: BACKEND SERVER TERMINAL LOGS (Python FastAPI stdout / stderr) */}
      {activeConsoleTab === 'server' && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800/80 rounded-xl p-2">
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 overflow-x-auto">
              {['ALL', 'ERROR', 'WARNING', 'INFO', 'DEBUG'].map((level) => (
                <button
                  key={level}
                  onClick={() => setServerLevel(level)}
                  className={`px-3 py-1 text-[11px] font-bold rounded-md uppercase transition cursor-pointer whitespace-nowrap ${
                    serverLevel === level ? 'bg-purple-600 text-white shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter backend logs..."
                  value={serverSearch}
                  onChange={(e) => setServerSearch(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 sm:w-60"
                />
              </div>

              {/* Auto Poll Toggle */}
              <label className="flex items-center gap-1.5 text-xs text-slate-300 bg-slate-950 border border-slate-800 px-2.5 py-1.5 rounded-lg cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isAutoRefreshing}
                  onChange={(e) => setIsAutoRefreshing(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-900 text-purple-600 focus:ring-purple-500"
                />
                <span>Auto-refresh (3s)</span>
              </label>

              <button
                onClick={loadServerLogs}
                disabled={isLoadingServerLogs}
                className="p-1.5 bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-lg transition cursor-pointer"
                title="Refresh logs now"
              >
                <RefreshCw className={`w-4 h-4 ${isLoadingServerLogs ? 'animate-spin text-purple-400' : ''}`} />
              </button>
            </div>
          </div>

          {/* Backend Terminal Output Container */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 font-mono text-xs shadow-2xl h-[560px] overflow-y-auto custom-scrollbar flex flex-col space-y-2">
            {serverLogs.length > 0 ? (
              serverLogs.map((log, idx) => {
                const isError = log.level === 'ERROR' || log.level === 'CRITICAL';
                const isWarn = log.level === 'WARNING';
                const hasTraceback = Boolean(log.traceback);
                const isExpanded = Boolean(expandedTracebacks[idx]);

                return (
                  <div
                    key={idx}
                    className={`p-2.5 rounded-xl transition-colors group flex flex-col gap-1.5 ${
                      isError
                        ? 'bg-rose-950/30 text-rose-300 border border-rose-500/25'
                        : isWarn
                        ? 'bg-amber-950/25 text-amber-300 border border-amber-500/20'
                        : 'bg-slate-900/40 text-slate-300 border border-slate-850'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span className="text-[10px] text-slate-500 shrink-0 select-none mt-0.5">
                          [{log.timestamp.split('T')[1]?.substring(0, 8) || log.timestamp}]
                        </span>
                        <span
                          className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded select-none shrink-0 ${
                            isError
                              ? 'bg-rose-900/80 text-rose-200'
                              : isWarn
                              ? 'bg-amber-900/80 text-amber-200'
                              : 'bg-slate-800 text-slate-300 border border-slate-700'
                          }`}
                        >
                          {log.level}
                        </span>
                        <span className="text-[10px] text-purple-400 shrink-0 font-semibold select-none mt-0.5">
                          [{log.logger}]
                        </span>
                        <span className="break-all">{log.message}</span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {hasTraceback && (
                          <button
                            onClick={() => toggleTraceback(idx)}
                            className="flex items-center gap-1 text-[11px] font-sans font-semibold text-rose-400 hover:text-rose-300 bg-rose-950/60 px-2 py-0.5 rounded border border-rose-800/50 transition cursor-pointer"
                          >
                            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            <span>Traceback</span>
                          </button>
                        )}
                        <button
                          onClick={() =>
                            handleCopyServerLog(
                              `[${log.timestamp}] [${log.level}] [${log.logger}] ${log.message}${
                                log.traceback ? '\n' + log.traceback : ''
                              }`,
                              idx
                            )
                          }
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
                          title="Copy server log"
                        >
                          {copiedServerIdx === idx ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Expandable Traceback */}
                    {hasTraceback && isExpanded && (
                      <div className="mt-2 p-3 bg-slate-950 rounded-lg border border-rose-900/50 text-rose-300 overflow-x-auto custom-scrollbar">
                        <div className="flex items-center justify-between pb-1 mb-1 border-b border-rose-900/30 text-[10px] font-sans text-rose-400 font-bold uppercase">
                          <span>Python Exception Traceback</span>
                          <button
                            onClick={() => handleCopyServerLog(log.traceback!, idx)}
                            className="hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <Copy className="w-3 h-3" />
                            <span>Copy Traceback</span>
                          </button>
                        </div>
                        <pre className="text-[11px] whitespace-pre-wrap leading-relaxed text-rose-300/90 font-mono">
                          {log.traceback}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="text-center py-20 text-slate-600">
                {isLoadingServerLogs
                  ? 'Loading server terminal output...'
                  : 'No backend server logs found in memory buffer.'}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};
