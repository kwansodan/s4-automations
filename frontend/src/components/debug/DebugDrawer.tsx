import React, { useState, useEffect, useCallback } from 'react';
import { useErrors } from '../../context/ErrorContext';
import {
  X,
  AlertTriangle,
  Activity,
  Terminal,
  ShieldCheck,
  Copy,
  Check,
  Trash2,
  RefreshCw,
  Search,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Database,
  Cpu,
  Globe,
  FileCode,
} from 'lucide-react';
import { fetchServerLogsApi, clearServerLogsApi, fetchSystemDebugDumpApi } from '../../lib/api';
import type { AppError, NetworkRequestRecord, ServerLogRecord, SystemDebugDump } from '../../types/errors';

export const DebugDrawer: React.FC = () => {
  const {
    isDebugDrawerOpen,
    closeDebugDrawer,
    errors,
    networkLogs,
    clearErrors,
    clearNetworkLogs,
    debugDrawerTab,
    openDebugDrawer,
    generateDiagnosticReport,
  } = useErrors();

  const [activeTab, setActiveTab] = useState<'errors' | 'network' | 'logs' | 'health'>('errors');
  const [selectedErrorId, setSelectedErrorId] = useState<string | null>(null);
  const [selectedNetworkId, setSelectedNetworkId] = useState<string | null>(null);
  const [copiedReport, setCopiedReport] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

  // Server logs tab state
  const [serverLogs, setServerLogs] = useState<ServerLogRecord[]>([]);
  const [logLevel, setLogLevel] = useState<string>('ALL');
  const [logSearch, setLogSearch] = useState('');
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  // System debug dump state
  const [debugDump, setDebugDump] = useState<SystemDebugDump | null>(null);
  const [isLoadingDump, setIsLoadingDump] = useState(false);

  // Sync active tab with context request
  useEffect(() => {
    if (debugDrawerTab) {
      setActiveTab(debugDrawerTab);
    }
  }, [debugDrawerTab]);

  // Load server logs when logs tab is active
  const loadServerLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    try {
      const res = await fetchServerLogsApi(logLevel, 100, logSearch);
      setServerLogs(res.logs || []);
    } catch (err) {
      console.warn('Could not fetch server logs:', err);
    } finally {
      setIsLoadingLogs(false);
    }
  }, [logLevel, logSearch]);

  // Load debug dump when health tab is active
  const loadDebugDump = useCallback(async () => {
    setIsLoadingDump(true);
    try {
      const data = await fetchSystemDebugDumpApi();
      setDebugDump(data);
    } catch (err) {
      console.warn('Could not fetch debug dump:', err);
    } finally {
      setIsLoadingDump(false);
    }
  }, []);

  useEffect(() => {
    if (!isDebugDrawerOpen) return;
    if (activeTab === 'logs') {
      loadServerLogs();
    } else if (activeTab === 'health') {
      loadDebugDump();
    }
  }, [isDebugDrawerOpen, activeTab, loadServerLogs, loadDebugDump]);

  if (!isDebugDrawerOpen) return null;

  const handleCopyReport = () => {
    const report = generateDiagnosticReport();
    navigator.clipboard.writeText(report);
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2000);
  };

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSnippet(id);
    setTimeout(() => setCopiedSnippet(null), 2000);
  };

  const handleClearServerLogs = async () => {
    if (!window.confirm('Are you sure you want to clear in-memory server logs?')) return;
    try {
      await clearServerLogsApi();
      setServerLogs([]);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden animate-in fade-in duration-200">
      {/* Backdrop */}
      <div
        onClick={closeDebugDrawer}
        className="absolute inset-0 bg-black/75 backdrop-blur-sm transition-opacity"
      />

      {/* Slide-Over Panel */}
      <div className="absolute inset-y-0 right-0 max-w-3xl w-full bg-slate-950 border-l border-slate-800 shadow-2xl flex flex-col z-10 animate-in slide-in-from-right duration-300">
        
        {/* Top Header Bar */}
        <div className="p-4 sm:p-5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-950 border border-sky-500/30 text-sky-400">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">In-App Debug Inspector</h2>
                <span className="text-[10px] font-mono font-bold text-sky-400 bg-sky-950 border border-sky-500/30 px-2 py-0.5 rounded-full">
                  Terminal-Free DevTools
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Inspect live network calls, Python server tracebacks, and runtime state in real-time.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyReport}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-3 py-1.5 rounded-xl border border-slate-700 transition cursor-pointer"
              title="Copy complete markdown diagnostic report to clipboard"
            >
              {copiedReport ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedReport ? 'Copied' : 'Copy Report'}</span>
            </button>

            <button
              onClick={closeDebugDrawer}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 border border-transparent hover:border-slate-700 transition cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center justify-between border-b border-slate-800 px-4 sm:px-6 bg-slate-950">
          <div className="flex items-center gap-1 -mb-px">
            <button
              onClick={() => setActiveTab('errors')}
              className={`flex items-center gap-2 py-3 px-3 text-xs font-bold border-b-2 transition cursor-pointer ${
                activeTab === 'errors'
                  ? 'border-red-500 text-red-400'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Errors &amp; Exceptions</span>
              {errors.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 bg-red-950 text-red-300 border border-red-500/40 rounded-full font-mono">
                  {errors.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('network')}
              className={`flex items-center gap-2 py-3 px-3 text-xs font-bold border-b-2 transition cursor-pointer ${
                activeTab === 'network'
                  ? 'border-sky-500 text-sky-400'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Network Activity</span>
              {networkLogs.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 bg-slate-800 text-slate-300 rounded-full font-mono">
                  {networkLogs.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('logs')}
              className={`flex items-center gap-2 py-3 px-3 text-xs font-bold border-b-2 transition cursor-pointer ${
                activeTab === 'logs'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Backend Server Logs</span>
            </button>

            <button
              onClick={() => setActiveTab('health')}
              className={`flex items-center gap-2 py-3 px-3 text-xs font-bold border-b-2 transition cursor-pointer ${
                activeTab === 'health'
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>System State</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {activeTab === 'errors' && errors.length > 0 && (
              <button
                onClick={clearErrors}
                className="text-slate-500 hover:text-rose-400 text-xs flex items-center gap-1 transition cursor-pointer"
                title="Clear errors list"
              >
                <Trash2 className="w-3 h-3" />
                <span>Clear</span>
              </button>
            )}

            {activeTab === 'network' && networkLogs.length > 0 && (
              <button
                onClick={clearNetworkLogs}
                className="text-slate-500 hover:text-rose-400 text-xs flex items-center gap-1 transition cursor-pointer"
                title="Clear network activity"
              >
                <Trash2 className="w-3 h-3" />
                <span>Clear</span>
              </button>
            )}

            {activeTab === 'logs' && (
              <button
                onClick={loadServerLogs}
                disabled={isLoadingLogs}
                className="text-slate-400 hover:text-white text-xs flex items-center gap-1 transition cursor-pointer"
                title="Refresh logs"
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingLogs ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            )}
          </div>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar space-y-4">
          
          {/* TAB 1: ERRORS */}
          {activeTab === 'errors' && (
            <div className="space-y-3">
              {errors.length === 0 ? (
                <div className="text-center py-24 text-slate-500 space-y-2">
                  <ShieldCheck className="w-10 h-10 text-emerald-500/40 mx-auto" />
                  <p className="text-sm font-semibold text-slate-400">All Systems Normal</p>
                  <p className="text-xs text-slate-600">No runtime exceptions or API failures recorded.</p>
                </div>
              ) : (
                errors.map((err) => {
                  const isExpanded = selectedErrorId === err.id;
                  const isCritical = err.severity === 'critical';
                  const isWarn = err.severity === 'warning';

                  return (
                    <div
                      key={err.id}
                      className={`rounded-xl border transition-all ${
                        isCritical
                          ? 'border-red-500/50 bg-red-950/20'
                          : isWarn
                          ? 'border-amber-500/40 bg-amber-950/20'
                          : 'border-rose-500/30 bg-slate-900/60'
                      }`}
                    >
                      {/* Accordion Header */}
                      <div
                        onClick={() => setSelectedErrorId(isExpanded ? null : err.id)}
                        className="p-3.5 flex items-start justify-between gap-3 cursor-pointer hover:bg-slate-900/40 transition rounded-xl"
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className="mt-0.5 text-slate-400 shrink-0">
                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span
                                className={`text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${
                                  isCritical
                                    ? 'bg-red-900/80 text-red-200'
                                    : isWarn
                                    ? 'bg-amber-900/80 text-amber-200'
                                    : 'bg-rose-900/80 text-rose-200'
                                }`}
                              >
                                {err.severity}
                              </span>

                              {err.status && (
                                <span className="text-[10px] font-mono font-bold bg-slate-900 text-slate-300 border border-slate-700 px-1.5 py-0.5 rounded">
                                  HTTP {err.status}
                                </span>
                              )}

                              <span className="text-[10px] font-mono text-slate-500">[{err.timeDisplay}]</span>
                              <span className="text-[10px] font-bold text-slate-400 capitalize">({err.category})</span>
                            </div>

                            <h4 className="text-xs font-bold text-white tracking-tight truncate">{err.title}</h4>
                            <p className="text-xs text-slate-300 font-mono mt-0.5 line-clamp-2">{err.message}</p>
                          </div>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyText(
                              `${err.title}\n${err.message}\n${err.traceback || ''}`,
                              err.id
                            );
                          }}
                          className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition shrink-0"
                          title="Copy error text"
                        >
                          {copiedSnippet === err.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className="p-4 border-t border-slate-800/80 bg-slate-950/80 space-y-3 text-xs">
                          {/* Troubleshooting Hint */}
                          {err.troubleshootingHint && (
                            <div className="p-3 bg-amber-950/30 border border-amber-500/30 rounded-lg text-amber-200 text-xs">
                              <span className="font-bold block mb-0.5">💡 Suggested Resolution:</span>
                              <span>{err.troubleshootingHint}</span>
                            </div>
                          )}

                          {/* Endpoint & Method */}
                          {err.endpoint && (
                            <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 font-mono">
                              <span className="text-slate-500">Endpoint: </span>
                              <span className="text-sky-400 font-bold">{err.method || 'GET'}</span>{' '}
                              <span className="text-slate-200">{err.endpoint}</span>
                            </div>
                          )}

                          {/* Request Payload */}
                          {err.requestPayload && (
                            <div>
                              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                                Request Payload Sent:
                              </span>
                              <pre className="bg-slate-900 border border-slate-800 rounded-lg p-3 font-mono text-[11px] text-slate-300 overflow-x-auto custom-scrollbar">
                                {JSON.stringify(err.requestPayload, null, 2)}
                              </pre>
                            </div>
                          )}

                          {/* Response Body */}
                          {err.responseData && (
                            <div>
                              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                                Server Response Body:
                              </span>
                              <pre className="bg-slate-900 border border-slate-800 rounded-lg p-3 font-mono text-[11px] text-rose-300 overflow-x-auto custom-scrollbar">
                                {typeof err.responseData === 'object'
                                  ? JSON.stringify(err.responseData, null, 2)
                                  : String(err.responseData)}
                              </pre>
                            </div>
                          )}

                          {/* Python or JS Stack Trace */}
                          {err.traceback && (
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[11px] font-bold text-red-400 uppercase tracking-wider">
                                  Server Stack Trace / Python Traceback:
                                </span>
                                <button
                                  onClick={() => handleCopyText(err.traceback!, `tb_${err.id}`)}
                                  className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1"
                                >
                                  {copiedSnippet === `tb_${err.id}` ? 'Copied Trace' : 'Copy Trace'}
                                </button>
                              </div>
                              <pre className="bg-slate-950 border border-red-950 rounded-lg p-3 font-mono text-[11px] text-red-300/90 overflow-x-auto whitespace-pre-wrap custom-scrollbar">
                                {err.traceback.trim()}
                              </pre>
                            </div>
                          )}

                          {/* Component Stack */}
                          {err.componentStack && (
                            <div>
                              <span className="text-[11px] font-bold text-sky-400 uppercase tracking-wider block mb-1">
                                React Component Stack:
                              </span>
                              <pre className="bg-slate-950 border border-sky-950 rounded-lg p-3 font-mono text-[11px] text-slate-400 overflow-x-auto whitespace-pre-wrap custom-scrollbar">
                                {err.componentStack.trim()}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 2: NETWORK INSPECTOR */}
          {activeTab === 'network' && (
            <div className="space-y-3">
              {networkLogs.length === 0 ? (
                <div className="text-center py-24 text-slate-500">
                  <Activity className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                  <p className="text-sm font-semibold">No Network Calls Tracked Yet</p>
                  <p className="text-xs">Trigger an action to inspect HTTP requests and payloads.</p>
                </div>
              ) : (
                networkLogs.map((req) => {
                  const isSelected = selectedNetworkId === req.id;
                  const isError = req.isError || req.status >= 400 || req.status === 0;

                  return (
                    <div
                      key={req.id}
                      className={`rounded-xl border transition-all ${
                        isError
                          ? 'border-red-500/40 bg-red-950/20'
                          : 'border-slate-800/80 bg-slate-900/60'
                      }`}
                    >
                      <div
                        onClick={() => setSelectedNetworkId(isSelected ? null : req.id)}
                        className="p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-900/40 rounded-xl"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 font-mono text-xs">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                              req.method === 'GET'
                                ? 'bg-sky-950 text-sky-300 border border-sky-500/30'
                                : req.method === 'POST'
                                ? 'bg-indigo-950 text-indigo-300 border border-indigo-500/30'
                                : req.method === 'DELETE'
                                ? 'bg-rose-950 text-rose-300 border border-rose-500/30'
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {req.method}
                          </span>

                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              req.status === 200
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                                : req.status === 0
                                ? 'bg-red-950 text-red-400 border border-red-500/40 animate-pulse'
                                : req.status >= 500
                                ? 'bg-red-950 text-red-400 border border-red-500/40'
                                : 'bg-amber-950 text-amber-400 border border-amber-500/30'
                            }`}
                          >
                            {req.status === 0 ? 'NET_FAIL' : req.status}
                          </span>

                          <span className="text-slate-300 truncate">{req.url}</span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 font-mono text-[11px] text-slate-500">
                          <span>{req.durationMs}ms</span>
                          <span>{req.timeDisplay}</span>
                        </div>
                      </div>

                      {/* Network Details */}
                      {isSelected && (
                        <div className="p-3.5 border-t border-slate-800/80 bg-slate-950 space-y-2 text-xs font-mono">
                          {req.requestBody && (
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
                                Request Body:
                              </span>
                              <pre className="bg-slate-900 p-2.5 rounded border border-slate-800 text-[11px] text-slate-300 overflow-x-auto">
                                {JSON.stringify(req.requestBody, null, 2)}
                              </pre>
                            </div>
                          )}

                          {req.errorMsg && (
                            <div className="p-2.5 bg-red-950/40 border border-red-500/30 rounded text-red-300">
                              <span className="font-bold block mb-0.5">Network Error:</span>
                              <span>{req.errorMsg}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 3: BACKEND SERVER LOGS */}
          {activeTab === 'logs' && (
            <div className="space-y-3">
              {/* Controls Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 overflow-x-auto">
                  {['ALL', 'ERROR', 'WARNING', 'INFO'].map((lvl) => (
                    <button
                      key={lvl}
                      onClick={() => setLogLevel(lvl)}
                      className={`px-2.5 py-1 text-[10px] font-bold rounded uppercase transition cursor-pointer ${
                        logLevel === lvl ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1 sm:w-60">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search server logs..."
                      value={logSearch}
                      onChange={(e) => setLogSearch(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <button
                    onClick={handleClearServerLogs}
                    className="text-slate-400 hover:text-rose-400 p-1.5 rounded-lg hover:bg-slate-800 transition cursor-pointer"
                    title="Flush server logs buffer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Terminal Logs Output */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs shadow-inner h-[500px] overflow-y-auto custom-scrollbar space-y-1.5">
                {serverLogs.length === 0 ? (
                  <div className="text-center py-20 text-slate-600">
                    {isLoadingLogs ? 'Loading server stdout buffer...' : 'No server logs matching filter criteria.'}
                  </div>
                ) : (
                  serverLogs.map((log) => {
                    const isErr = log.level === 'ERROR' || log.level === 'CRITICAL';
                    const isWarn = log.level === 'WARNING';

                    return (
                      <div
                        key={log.id}
                        className={`p-2 rounded-lg transition-colors ${
                          isErr
                            ? 'bg-red-950/30 text-red-300 border border-red-500/20'
                            : isWarn
                            ? 'bg-amber-950/20 text-amber-300 border border-amber-500/20'
                            : 'bg-slate-900/30 text-slate-300 border border-slate-850'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span className="text-slate-500 text-[10px] shrink-0">[{log.time_display}]</span>
                          <span
                            className={`text-[9px] font-bold px-1 rounded uppercase shrink-0 ${
                              isErr
                                ? 'bg-red-900 text-red-200'
                                : isWarn
                                ? 'bg-amber-900 text-amber-200'
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {log.level}
                          </span>
                          <span className="text-sky-400/80 text-[10px] shrink-0">[{log.logger}]</span>
                          <span className="break-all">{log.message}</span>
                        </div>

                        {log.traceback && (
                          <pre className="mt-2 p-2 bg-slate-950/90 rounded border border-red-900/50 text-[10px] text-red-400 overflow-x-auto whitespace-pre-wrap">
                            {log.traceback.trim()}
                          </pre>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 4: SYSTEM HEALTH & INTEGRATIONS */}
          {activeTab === 'health' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Subsystem Diagnostics</h3>
                <button
                  onClick={loadDebugDump}
                  disabled={isLoadingDump}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-slate-300 rounded-xl border border-slate-800 transition cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDump ? 'animate-spin text-sky-400' : ''}`} />
                  <span>Refresh Telemetry</span>
                </button>
              </div>

              {debugDump ? (
                <div className="space-y-4">
                  {/* Cards Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Database */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          <Database className="w-4 h-4 text-sky-400" />
                          <span>SQLModel / Database</span>
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-950 text-slate-300 border border-slate-800">
                          {debugDump.database.status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 space-y-0.5 pt-2">
                        <div>Clients in DB: <span className="text-white font-mono font-bold">{debugDump.database.clients_count}</span></div>
                        <div>Staged Transactions: <span className="text-white font-mono font-bold">{debugDump.database.staged_transactions_count}</span></div>
                        <div>Bank Transactions: <span className="text-white font-mono font-bold">{debugDump.database.bank_transactions_count}</span></div>
                      </div>
                    </div>

                    {/* AI Model */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          <Cpu className="w-4 h-4 text-indigo-400" />
                          <span>Gemini Vision Model</span>
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-500/30">
                          {debugDump.gemini_model}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 pt-2">
                        Mode: <span className="text-white font-semibold">{debugDump.mock_mode ? '⚡ Mock Mode' : '🟢 Live Gemini API'}</span>
                      </div>
                    </div>

                    {/* Pipeline Engine */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1 col-span-1 sm:col-span-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          <Globe className="w-4 h-4 text-emerald-400" />
                          <span>Inngest Pipeline Orchestrator</span>
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/30 font-bold uppercase">
                          {debugDump.pipeline.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 font-mono pt-1">
                        {debugDump.pipeline.current_step || 'Idle'}
                      </p>
                      {debugDump.pipeline.error_message && (
                        <div className="mt-2 p-2 bg-red-950/40 border border-red-500/30 rounded text-red-300 text-xs font-mono">
                          Error: {debugDump.pipeline.error_message}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Masked Configuration Table */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <FileCode className="w-4 h-4 text-sky-400" />
                      <span>Runtime Environment Variables (Masked)</span>
                    </span>
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 max-h-60 overflow-y-auto custom-scrollbar font-mono text-[11px] space-y-1">
                      {Object.entries(debugDump.config_summary).map(([key, val]) => (
                        <div key={key} className="flex items-center justify-between border-b border-slate-900 pb-0.5">
                          <span className="text-slate-400">{key}:</span>
                          <span className="text-slate-200">{String(val)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-20 text-slate-500">
                  {isLoadingDump ? 'Fetching system telemetry...' : 'Click "Refresh Telemetry" to inspect runtime state.'}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
