import React, { useState } from 'react';
import { useClient } from '../../../context/ClientContext';
import { useAutomation } from '../../../context/AutomationContext';
import { KpiCards } from '../../dashboard/KpiCards';
import { ProgressTracker } from '../../dashboard/ProgressTracker';
import { runClientStrategy, testClientIngestion, triggerClientPipeline } from '../../../lib/api';
import {
  PlayCircle,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Layers,
  ArrowRight,
  Receipt,
  DollarSign,
  Landmark,
  ShieldCheck,
  Settings2,
  Clock,
  ExternalLink,
} from 'lucide-react';

export const ClientOverviewTab: React.FC = () => {
  const { currentClient, setIsWizardOpen } = useClient();
  const { addLog, selectedMonth, selectedYear, navigateToClientSubTab } = useAutomation();

  const [isRunning, setIsRunning] = useState(false);
  const [executionResult, setExecutionResult] = useState<any | null>(null);
  const [isProbing, setIsProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<any | null>(null);
  const [triggeringPipeId, setTriggeringPipeId] = useState<string | null>(null);

  const handleSimulateRun = async () => {
    setIsRunning(true);
    setExecutionResult(null);
    addLog('info', `[LIVE] Triggering automated ingestion pipeline for ${currentClient.name}...`);

    try {
      const res = await runClientStrategy(currentClient.id, false);
      setExecutionResult(res);
      addLog('success', `[LIVE] ${res.message || 'Pipeline execution completed successfully.'}`);
    } catch (err: any) {
      addLog('error', `Pipeline execution error for ${currentClient.name}: ${err.message}`);
      setExecutionResult({
        status: 'FAILED',
        message: err.message || 'Execution failed. Check backend logs.',
      });
    } finally {
      setIsRunning(false);
    }
  };

  const handleTestProbe = async () => {
    setIsProbing(true);
    setProbeResult(null);
    try {
      const res = await testClientIngestion(currentClient.id);
      setProbeResult(res);
      addLog('info', `[PROBE] Ingestion test for ${currentClient.name}: ${res.message}`);
    } catch (err: any) {
      setProbeResult({ success: false, message: err.message });
      addLog('error', `Ingestion probe failed: ${err.message}`);
    } finally {
      setIsProbing(false);
    }
  };

  const handleTriggerStream = async (pipelineId: string, pipelineName: string) => {
    setTriggeringPipeId(pipelineId);
    addLog('info', `⚡ [STREAM] Triggering "${pipelineName}" (${selectedMonth} ${selectedYear})...`);
    try {
      const result = await triggerClientPipeline(currentClient.id, pipelineId, {
        month: selectedMonth,
        year: selectedYear,
      });
      addLog('success', `✅ Stream "${pipelineName}" completed: ${result.items_extracted || 0} items extracted.`);
    } catch (err: any) {
      addLog('error', `❌ Stream "${pipelineName}" failed: ${err.message}`);
    } finally {
      setTriggeringPipeId(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Action Trigger Toolbar Banner */}
      <div className="glass-panel rounded-2xl p-5 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4 border border-slate-800">
        <div>
          <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
            <span>Automation Operations</span>
            <span className="text-[11px] font-mono font-bold text-sky-400 bg-sky-950/80 border border-sky-500/30 px-2 py-0.5 rounded-full">
              {selectedMonth} {selectedYear}
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time multi-stream orchestration across Google Drive, Email Inbound, and Accounting API sync.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            onClick={() => setIsWizardOpen(true)}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold px-3 py-2 rounded-xl transition cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-sky-400" />
            <span>Setup Checklist</span>
          </button>

          <button
            onClick={handleTestProbe}
            disabled={isProbing}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold px-3 py-2 rounded-xl transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isProbing ? 'animate-spin text-sky-400' : ''}`} />
            <span>{isProbing ? 'Probing...' : 'Test Ingestion'}</span>
          </button>

          <button
            onClick={handleSimulateRun}
            disabled={isRunning}
            className="flex items-center gap-2 bg-gradient-to-r from-sky-500 via-indigo-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg shadow-sky-500/20 transition cursor-pointer disabled:opacity-50"
          >
            {isRunning ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Running Pipeline...</span>
              </>
            ) : (
              <>
                <PlayCircle className="w-3.5 h-3.5" />
                <span>Run Ingestion Pipeline</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Ingestion Probe Result Banner */}
      {probeResult && (
        <div
          className={`p-4 rounded-xl border flex items-start gap-3 text-xs shadow-lg ${
            probeResult.success
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
          }`}
        >
          {probeResult.success ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
          )}
          <div className="flex-1">
            <span className="font-bold uppercase tracking-wider">{probeResult.status || (probeResult.success ? 'CONNECTED' : 'FAILED')}: </span>
            <span>{probeResult.message}</span>
          </div>
        </div>
      )}

      {/* Execution Result Banner */}
      {executionResult && (
        <div
          className={`p-4 rounded-2xl border shadow-xl ${
            executionResult.status === 'COMPLETED'
              ? 'bg-sky-950/70 border-sky-500/40 text-sky-200'
              : 'bg-rose-950/70 border-rose-500/40 text-rose-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {executionResult.status === 'COMPLETED' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-rose-400" />
              )}
              <span className="font-bold text-white text-sm">
                {executionResult.status === 'COMPLETED' ? 'Ingestion Pipeline Executed' : 'Execution Notice'}
              </span>
            </div>
            <span className="text-xs font-mono text-slate-400">
              {executionResult.month} {executionResult.year}
            </span>
          </div>
          <p className="text-xs text-slate-300 mt-1">{executionResult.message}</p>

          {executionResult.status === 'COMPLETED' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-sky-900/60 text-xs">
              <div className="bg-slate-950/60 p-2.5 rounded-xl border border-sky-500/10">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Sources Discovered</span>
                <span className="font-bold text-white text-sm">{executionResult.sources_discovered || 1} Doc(s)</span>
              </div>
              <div className="bg-slate-950/60 p-2.5 rounded-xl border border-sky-500/10">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Extracted Items</span>
                <span className="font-bold text-emerald-300 text-sm">{executionResult.items_extracted || 0} Transactions</span>
              </div>
              <div className="bg-slate-950/60 p-2.5 rounded-xl border border-sky-500/10">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Total Volume</span>
                <span className="font-bold text-white text-sm">GHS {Number(executionResult.total_amount || 0).toLocaleString()}</span>
              </div>
              <div className="bg-slate-950/60 p-2.5 rounded-xl border border-sky-500/10">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Ledger Status</span>
                <span className="font-bold text-sky-400 text-sm">Staged in PostgreSQL</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* KPI Cards Grid */}
      <div>
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Key Telemetry Metrics</h3>
        <KpiCards />
      </div>

      {/* Live Pipeline Telemetry & Progress */}
      <ProgressTracker />

      {/* Quick Navigation Cards */}
      <div>
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Workflows & Modules</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Card 1: AR */}
          <div
            onClick={() => navigateToClientSubTab('ar')}
            className="glass-card rounded-2xl p-4 cursor-pointer group flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 group-hover:scale-110 transition-transform">
                  <Receipt className="w-4 h-4" />
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-500/30">
                  AR Revenue
                </span>
              </div>
              <h4 className="text-sm font-bold text-white group-hover:text-sky-300 transition-colors">
                Control Slips &amp; Review
              </h4>
              <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                Audit OCR linen extractions in Google Sheets Tab 1 &amp; 2, resolve discrepancies, and draft invoices.
              </p>
            </div>
            <div className="pt-3 mt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-sky-400 font-semibold">
              <span>Open AR Ledger</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>

          {/* Card 2: AP */}
          <div
            onClick={() => navigateToClientSubTab('ap')}
            className="glass-card rounded-2xl p-4 cursor-pointer group flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform">
                  <DollarSign className="w-4 h-4" />
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-500/30">
                  AP Bills
                </span>
              </div>
              <h4 className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors">
                Vendor Invoices (OCR)
              </h4>
              <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                Parse supplier bills with Gemini Vision, map accounting contacts, and auto-post draft bills.
              </p>
            </div>
            <div className="pt-3 mt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-indigo-400 font-semibold">
              <span>Open AP Ledger</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>

          {/* Card 3: Bank Recon */}
          <div
            onClick={() => navigateToClientSubTab('bank')}
            className="glass-card rounded-2xl p-4 cursor-pointer group flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 group-hover:scale-110 transition-transform">
                  <Landmark className="w-4 h-4" />
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/30">
                  Reconciliation
                </span>
              </div>
              <h4 className="text-sm font-bold text-white group-hover:text-emerald-300 transition-colors">
                Bank Feeds &amp; Statements
              </h4>
              <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                Ingest PDF/CSV bank statements, monitor watched suspense accounts, and reconcile unmatched lines.
              </p>
            </div>
            <div className="pt-3 mt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-emerald-400 font-semibold">
              <span>Open Bank Recon</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>

          {/* Card 4: Information Requests */}
          <div
            onClick={() => navigateToClientSubTab('requests')}
            className="glass-card rounded-2xl p-4 cursor-pointer group flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 group-hover:scale-110 transition-transform">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-500/30">
                  Client Portal
                </span>
              </div>
              <h4 className="text-sm font-bold text-white group-hover:text-amber-300 transition-colors">
                Information Requests
              </h4>
              <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                Dispatch questions for unclassified transactions to the client clarification portal.
              </p>
            </div>
            <div className="pt-3 mt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-amber-400 font-semibold">
              <span>Open Requests Hub</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>

        </div>
      </div>

      {/* Active Pipelines Summary */}
      <div className="glass-panel rounded-2xl p-6 shadow-xl border border-slate-800">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-sky-400" />
            <h3 className="text-base font-bold text-white tracking-tight">Active Ingestion Pipeline Streams</h3>
          </div>
          <button
            onClick={() => navigateToClientSubTab('pipelines')}
            className="text-xs font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
          >
            <span>Manage All ({currentClient.pipelines?.length || 0})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {(currentClient.pipelines || []).length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {currentClient.pipelines?.slice(0, 3).map((pipe, idx) => (
              <div
                key={pipe.id || idx}
                className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between space-y-3"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700">
                      {pipe.section} • {pipe.entity_type?.replace(/_/g, ' ')}
                    </span>
                    <span className={`w-2 h-2 rounded-full ${pipe.is_active !== false ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-slate-500'}`} />
                  </div>
                  <h4 className="text-xs font-bold text-white truncate">{pipe.name}</h4>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Channel: <code className="text-sky-300 font-mono">{pipe.source_type}</code>
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 font-mono">
                    {pipe.schedule || 'Daily @ 18:00 UTC'}
                  </span>
                  <button
                    onClick={() => handleTriggerStream(pipe.id, pipe.name)}
                    disabled={triggeringPipeId === pipe.id}
                    className="flex items-center gap-1 text-[11px] font-bold text-sky-400 hover:text-sky-300 bg-sky-950/60 border border-sky-500/30 px-2 py-1 rounded-lg transition cursor-pointer disabled:opacity-50"
                  >
                    {triggeringPipeId === pipe.id ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <PlayCircle className="w-3 h-3" />
                    )}
                    <span>Run</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-xs text-slate-500 bg-slate-950/40 rounded-xl border border-dashed border-slate-800">
            No pipeline streams configured. Click "Manage All" to add one.
          </div>
        )}
      </div>

      {/* Blueprint Architecture */}
      <div className="glass-panel rounded-2xl p-6 shadow-xl border border-slate-800">
        <div className="flex items-center gap-2 mb-4">
          <Layers className="w-5 h-5 text-sky-400" />
          <h3 className="text-base font-bold text-white tracking-tight">Automation Architecture Blueprint</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {currentClient.blueprints?.map((step, idx) => {
            const isDone = step.status === 'active';
            const isInProgress = step.status === 'in_progress';

            return (
              <div
                key={idx}
                className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 flex items-start gap-3"
              >
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                    isDone
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : isInProgress
                      ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                      : 'bg-slate-800 text-slate-500 border border-slate-700'
                  }`}
                >
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                        isDone
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : isInProgress
                          ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                          : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      {isDone ? (
                        <>
                          <CheckCircle2 className="w-3 h-3" /> Active
                        </>
                      ) : isInProgress ? (
                        <>
                          <Sparkles className="w-3 h-3 text-sky-400" /> In Progress
                        </>
                      ) : (
                        <>
                          <Clock className="w-3 h-3" /> Queued
                        </>
                      )}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-white mb-1">{step.title}</h4>
                  <p className="text-xs text-slate-400">{step.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
};
