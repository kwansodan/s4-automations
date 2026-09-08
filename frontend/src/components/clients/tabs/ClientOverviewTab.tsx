import React, { useState } from 'react';
import { useClient } from '../../../context/ClientContext';
import { useAutomation } from '../../../context/AutomationContext';
import { useErrors } from '../../../context/ErrorContext';
import { KpiCards } from '../../dashboard/KpiCards';
import { ProgressTracker } from '../../dashboard/ProgressTracker';
import { runClientStrategy, testClientIngestion, triggerClientPipeline } from '../../../lib/api';
import { ACCOUNTING_PLATFORMS } from '../../../types/client';
import type { PipelineRunSummary } from '../../../types/client';
import { StreamExecutionResultModal } from '../../modals/StreamExecutionResultModal';
import {
  PlayCircle,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Layers,
  ArrowRight,
  Settings2,
  Clock,
  ExternalLink,
  BookOpen,
  ChevronDown,
  ChevronUp,
  X,
  Sparkles,
  HardDrive,
} from 'lucide-react';

export const ClientOverviewTab: React.FC = () => {
  const { currentClient, activeSections, setIsWizardOpen } = useClient();
  const { addLog, selectedMonth, selectedYear, navigateToClientSubTab } = useAutomation();
  const { reportError, syncServerIssuesNow } = useErrors();

  const [isRunning, setIsRunning] = useState(false);
  const [executionResult, setExecutionResult] = useState<any | null>(null);
  const [isProbing, setIsProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<any | null>(null);
  const [triggeringPipeId, setTriggeringPipeId] = useState<string | null>(null);
  const [showBlueprint, setShowBlueprint] = useState(false);
  const [activeRunSummary, setActiveRunSummary] = useState<PipelineRunSummary | null>(null);

  const currentPlatform =
    ACCOUNTING_PLATFORMS.find((p) => p.id === currentClient.accounting_software) ||
    ACCOUNTING_PLATFORMS[0];

  const handleSimulateRun = async () => {
    setIsRunning(true);
    setExecutionResult(null);
    addLog('info', `[LIVE] Triggering automated ingestion pipeline for ${currentClient.name}...`);

    try {
      const res = await runClientStrategy(currentClient.id, false);
      setExecutionResult(res);
      if (res.status === 'FAILED') {
        const errorMsg = res.message || 'Pipeline execution failed. Check backend logs.';
        addLog('error', `❌ Pipeline execution failed: ${errorMsg}`);
        reportError({
          severity: 'error',
          category: 'pipeline',
          title: `Execution Failed: ${currentClient.name}`,
          message: errorMsg,
          endpoint: `/api/v1/clients/${currentClient.id}/run`,
          responseData: res,
          showToast: true,
        });
        await syncServerIssuesNow();
      } else {
        addLog('success', `[LIVE] ${res.message || 'Pipeline execution completed successfully.'}`);
      }
    } catch (err: any) {
      addLog('error', `Pipeline execution error for ${currentClient.name}: ${err.message}`);
      setExecutionResult({
        status: 'FAILED',
        message: err.message || 'Execution failed. Check backend logs.',
      });
      reportError({
        severity: 'error',
        category: 'pipeline',
        title: `Execution Error: ${currentClient.name}`,
        message: err.message,
        endpoint: `/api/v1/clients/${currentClient.id}/run`,
        showToast: true,
      });
      await syncServerIssuesNow();
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
      if (res.success === false || res.status === 'FAILED') {
        addLog('error', `[PROBE] Ingestion test failed for ${currentClient.name}: ${res.message}`);
        reportError({
          severity: 'error',
          category: 'pipeline',
          title: `Probe Failed: ${currentClient.name}`,
          message: res.message,
          endpoint: `/api/v1/clients/${currentClient.id}/test-ingestion`,
          responseData: res,
          showToast: true,
        });
        await syncServerIssuesNow();
      } else {
        addLog('info', `[PROBE] Ingestion test for ${currentClient.name}: ${res.message}`);
      }
    } catch (err: any) {
      setProbeResult({ success: false, message: err.message });
      addLog('error', `Ingestion probe failed: ${err.message}`);
      reportError({
        severity: 'error',
        category: 'pipeline',
        title: `Probe Error: ${currentClient.name}`,
        message: err.message,
        endpoint: `/api/v1/clients/${currentClient.id}/test-ingestion`,
        showToast: true,
      });
      await syncServerIssuesNow();
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

      const summary: PipelineRunSummary = result.last_run_summary || {
        pipeline_id: pipelineId,
        pipeline_name: pipelineName,
        triggered_at: new Date().toISOString(),
        month: selectedMonth,
        year: selectedYear,
        status: result.status,
        summary_message: result.summary_message || result.message || 'Stream finished execution.',
        sources_discovered: result.sources_discovered || 0,
        duplicates_skipped: result.duplicates_skipped || 0,
        items_extracted: result.items_extracted || 0,
        auto_post: !!result.post_results && result.post_results.status !== 'SKIPPED',
        spreadsheet_url: result.spreadsheet_url,
        spreadsheet_id: result.spreadsheet_id,
        documents: result.documents,
        step_logs: result.step_logs,
        errors: result.errors,
        warnings: result.warnings,
      };

      // Automatically display the full execution summary modal to the user
      setActiveRunSummary(summary);

      if (result.status === 'FAILED' || (result.errors && result.errors.length > 0)) {
        const errorMsg = result.error_message || result.errors?.[0] || 'Pipeline stream execution failed';
        addLog('error', `❌ Stream "${pipelineName}" failed: ${errorMsg}`);
        reportError({
          severity: 'error',
          category: 'pipeline',
          title: `Stream Failed: ${pipelineName}`,
          message: errorMsg,
          endpoint: `/api/v1/clients/${currentClient.id}/pipelines/${pipelineId}/trigger`,
          responseData: result,
          showToast: true,
        });
        await syncServerIssuesNow();
      } else if (result.status === 'COMPLETED_DUPLICATES_SKIPPED') {
        addLog('warning', `⏭️ Stream "${pipelineName}": All ${result.sources_discovered} file(s) were previously processed and skipped as duplicates.`);
      } else if (result.status === 'WARNING' || (result.warnings && result.warnings.length > 0)) {
        addLog('warning', `⚠️ Stream "${pipelineName}" completed with warnings: ${result.warnings?.join('; ')}`);
        reportError({
          severity: 'warning',
          category: 'pipeline',
          title: `Stream Warnings: ${pipelineName}`,
          message: result.warnings?.join('; ') || 'Pipeline completed with warnings.',
          responseData: result,
          showToast: true,
        });
        await syncServerIssuesNow();
      } else {
        addLog('success', `✅ Stream "${pipelineName}": ${result.items_extracted || 0} item(s) extracted & staged.`);
      }
    } catch (err: any) {
      addLog('error', `❌ Stream "${pipelineName}" failed: ${err.message}`);
      reportError({
        severity: 'error',
        category: 'pipeline',
        title: `Stream Error: ${pipelineName}`,
        message: err.message,
        endpoint: `/api/v1/clients/${currentClient.id}/pipelines/${pipelineId}/trigger`,
        showToast: true,
      });
      await syncServerIssuesNow();
    } finally {
      setTriggeringPipeId(null);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      
      {/* 1. Streamlined Action & Status Header */}
      <div className="glass-panel rounded-2xl px-5 py-4 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-slate-800/90">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-xs font-bold text-white tracking-tight flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Operational Monitor</span>
          </span>
          <span className="text-[11px] font-mono font-bold text-sky-400 bg-sky-950/80 border border-sky-500/30 px-2.5 py-0.5 rounded-full">
            {selectedMonth} {selectedYear}
          </span>
          <span className="text-[11px] text-slate-400 hidden md:inline">
            • Live multi-stream ingestion &amp; Zoho Books sync
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowBlueprint((prev) => !prev)}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl border transition cursor-pointer ${
              showBlueprint
                ? 'bg-sky-950/80 border-sky-500/50 text-sky-300'
                : 'bg-slate-900 hover:bg-slate-800 border-slate-700/80 text-slate-300'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-sky-400" />
            <span>Blueprint</span>
            {showBlueprint ? <ChevronUp className="w-3 h-3 ml-0.5" /> : <ChevronDown className="w-3 h-3 ml-0.5" />}
          </button>

          <button
            onClick={handleTestProbe}
            disabled={isProbing}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-200 text-xs font-semibold px-3 py-1.5 rounded-xl transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isProbing ? 'animate-spin text-sky-400' : ''}`} />
            <span>{isProbing ? 'Probing...' : 'Test Ingestion'}</span>
          </button>

          <button
            onClick={handleSimulateRun}
            disabled={isRunning}
            className="flex items-center gap-1.5 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-bold px-3.5 py-1.5 rounded-xl shadow-md shadow-sky-500/20 transition cursor-pointer disabled:opacity-50"
          >
            {isRunning ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Running...</span>
              </>
            ) : (
              <>
                <PlayCircle className="w-3.5 h-3.5" />
                <span>Run Ingestion</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 2. Dismissible Ingestion Probe Result Banner */}
      {probeResult && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 text-xs shadow-md animate-in fade-in ${
            probeResult.success
              ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/70 border-rose-500/40 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {probeResult.success ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
            )}
            <span className="truncate">
              <strong className="uppercase">{probeResult.status || (probeResult.success ? 'CONNECTED' : 'FAILED')}:</strong>{' '}
              {probeResult.message}
            </span>
          </div>
          <button
            onClick={() => setProbeResult(null)}
            className="text-slate-400 hover:text-white p-1 rounded transition cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 3. Dismissible Execution Result Summary */}
      {executionResult && (
        <div
          className={`p-4 rounded-xl border shadow-lg animate-in fade-in ${
            executionResult.status === 'COMPLETED'
              ? 'bg-sky-950/70 border-sky-500/40 text-sky-200'
              : 'bg-rose-950/70 border-rose-500/40 text-rose-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {executionResult.status === 'COMPLETED' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400" />
              )}
              <span className="font-bold text-white text-xs">
                {executionResult.status === 'COMPLETED' ? 'Ingestion Pipeline Executed' : 'Execution Notice'}
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                ({executionResult.month} {executionResult.year})
              </span>
            </div>
            <button
              onClick={() => setExecutionResult(null)}
              className="text-slate-400 hover:text-white p-1 rounded transition cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-xs text-slate-300 mt-1">{executionResult.message}</p>

          {executionResult.status === 'COMPLETED' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3 pt-3 border-t border-sky-900/60 text-xs">
              <div className="bg-slate-950/60 px-3 py-2 rounded-lg border border-sky-500/10">
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Sources</span>
                <span className="font-bold text-white text-xs">{executionResult.sources_discovered || 1} Document(s)</span>
              </div>
              <div className="bg-slate-950/60 px-3 py-2 rounded-lg border border-sky-500/10">
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Extracted</span>
                <span className="font-bold text-emerald-300 text-xs">{executionResult.items_extracted || 0} Items</span>
              </div>
              <div className="bg-slate-950/60 px-3 py-2 rounded-lg border border-sky-500/10">
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Billed Volume</span>
                <span className="font-bold text-white text-xs">GHS {Number(executionResult.total_amount || 0).toLocaleString()}</span>
              </div>
              <div className="bg-slate-950/60 px-3 py-2 rounded-lg border border-sky-500/10">
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Ledger Status</span>
                <span className="font-bold text-sky-400 text-xs">Staged in PostgreSQL</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. Collapsible Automation Architecture Blueprint */}
      {showBlueprint && (
        <div className="glass-panel rounded-2xl p-5 shadow-lg border border-sky-500/20 bg-slate-950/90 animate-in fade-in duration-200">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-sky-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Automation Architecture Blueprint
              </h3>
            </div>
            <button
              onClick={() => setShowBlueprint(false)}
              className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
            >
              <span>Collapse</span>
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {currentClient.blueprints?.map((step, idx) => {
              const isDone = step.status === 'active';
              const isInProgress = step.status === 'in_progress';

              return (
                <div
                  key={idx}
                  className="bg-slate-900/60 border border-slate-800 rounded-xl p-3.5 flex items-start gap-3"
                >
                  <div
                    className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                      isDone
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : isInProgress
                        ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                        : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1 ${
                          isDone
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : isInProgress
                            ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                            : 'bg-slate-800 text-slate-500'
                        }`}
                      >
                        {isDone ? (
                          <>
                            <CheckCircle2 className="w-2.5 h-2.5" /> Active
                          </>
                        ) : isInProgress ? (
                          <>
                            <Sparkles className="w-2.5 h-2.5 text-sky-400" /> In Progress
                          </>
                        ) : (
                          <>
                            <Clock className="w-2.5 h-2.5" /> Queued
                          </>
                        )}
                      </span>
                    </div>
                    <h4 className="text-xs font-bold text-white mb-0.5">{step.title}</h4>
                    <p className="text-[11px] text-slate-400 line-clamp-2">{step.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Zero active pipelines alert banner */}
      {activeSections.activeCount === 0 && (
        <div className="glass-panel rounded-2xl p-5 border border-amber-500/30 bg-amber-950/15 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg animate-in fade-in">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">No Active Ingestion Pipelines</h3>
              <p className="text-xs text-slate-300 mt-0.5 max-w-2xl">
                Accounting workflow sections (AR Revenue, AP Vendor Bills, Bank Statements) remain hidden until an active ingestion stream is configured.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => navigateToClientSubTab('pipelines')}
              className="flex items-center gap-1.5 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow-md shadow-sky-500/20 transition cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Configure Streams</span>
            </button>
          </div>
        </div>
      )}

      {/* 5. Compact KPI Metric Strip */}
      <div>
        <KpiCards />
      </div>

      {/* 6. Core 2-Column Operational Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* Left / Primary Column (7 cols): Live Pipeline Monitor */}
        <div className="lg:col-span-7 space-y-5">
          <ProgressTracker showRunButton={false} />
        </div>

        {/* Right / Secondary Column (5 cols): Active Streams & Integrations */}
        <div className="lg:col-span-5 space-y-5">
          
          {/* Active Pipeline Streams Card */}
          <div className="glass-panel rounded-2xl p-4.5 shadow-lg border border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-sky-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Active Streams ({activeSections.activeCount})
                </h3>
              </div>
              <button
                onClick={() => navigateToClientSubTab('pipelines')}
                className="text-[11px] font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
              >
                <span>Configure All</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            {(currentClient.pipelines || []).length > 0 ? (
              <div className="space-y-2.5">
                {currentClient.pipelines?.slice(0, 3).map((pipe, idx) => (
                  <div
                    key={pipe.id || idx}
                    className="bg-slate-900/60 border border-slate-800/90 rounded-xl p-3 flex items-center justify-between gap-3 hover:border-slate-700 transition"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pipe.is_active !== false ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-slate-500'}`} />
                        <h4 className="text-xs font-semibold text-white truncate">{pipe.name}</h4>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400">
                        <span className="font-mono text-sky-400 bg-sky-950/60 px-1.5 py-0.5 rounded border border-sky-500/20">
                          {pipe.source_type}
                        </span>
                        <span>•</span>
                        <span className="font-mono text-slate-500">{pipe.schedule || 'Daily @ 18:00 UTC'}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleTriggerStream(pipe.id, pipe.name)}
                      disabled={triggeringPipeId === pipe.id}
                      className="flex items-center gap-1 text-[11px] font-bold text-sky-400 hover:text-sky-300 bg-sky-950/70 border border-sky-500/30 px-2.5 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-50 shrink-0"
                    >
                      {triggeringPipeId === pipe.id ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <PlayCircle className="w-3 h-3" />
                      )}
                      <span>Run</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-5 text-xs text-slate-500 bg-slate-950/40 rounded-xl border border-dashed border-slate-800">
                <span>No active streams configured.</span>
                <button
                  onClick={() => navigateToClientSubTab('pipelines')}
                  className="block mx-auto mt-1 text-sky-400 hover:underline font-semibold text-[11px] cursor-pointer"
                >
                  Add a pipeline stream →
                </button>
              </div>
            )}
          </div>

          {/* Connected Integrations & Storage Card */}
          <div className="glass-panel rounded-2xl p-4.5 shadow-lg border border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-indigo-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Linked Integrations
                </h3>
              </div>
              <button
                onClick={() => navigateToClientSubTab('settings')}
                className="text-[11px] font-semibold text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
              >
                <span>Settings</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            <div className="space-y-2">
              {/* Google Drive Folder */}
              <div className="bg-slate-900/60 border border-slate-800/90 rounded-xl p-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 shrink-0">
                    <HardDrive className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Google Drive OCR Folder</span>
                    <span className="text-xs font-mono text-slate-200 truncate block">
                      {(currentClient.folderId || currentClient.folder_id) ? `${(currentClient.folderId || currentClient.folder_id)!.slice(0, 16)}...` : 'Linked & Monitored'}
                    </span>
                  </div>
                </div>
                {(currentClient.folderId || currentClient.folder_id) && (
                  <a
                    href={`https://drive.google.com/drive/folders/${currentClient.folderId || currentClient.folder_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-slate-400 hover:text-sky-400 p-1.5 transition shrink-0"
                    title="Open in Google Drive"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>

              {/* Accounting ERP Platform */}
              <div className="bg-slate-900/60 border border-slate-800/90 rounded-xl p-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-sm shrink-0">
                    {currentPlatform.icon || '🟢'}
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Accounting Software</span>
                    <span className="text-xs font-semibold text-white truncate block">
                      {currentPlatform.name}
                    </span>
                  </div>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 shrink-0">
                  Active Sync
                </span>
              </div>
            </div>
          </div>

        </div>

      </div>

      {/* Stream Execution Result Modal */}
      <StreamExecutionResultModal
        isOpen={!!activeRunSummary}
        onClose={() => setActiveRunSummary(null)}
        runSummary={activeRunSummary}
        onTriggerAgain={
          activeRunSummary?.pipeline_id
            ? () => handleTriggerStream(activeRunSummary.pipeline_id!, activeRunSummary.pipeline_name || 'Stream')
            : undefined
        }
      />
    </div>
  );
};
