import React, { useState, useEffect, useMemo } from 'react';
import { useClient } from '../../../context/ClientContext';
import { useAutomation } from '../../../context/AutomationContext';
import { useErrors } from '../../../context/ErrorContext';
import {
  testClientIngestion,
  triggerClientPipeline,
  fetchClientTransactions,
} from '../../../lib/api';
import { ACCOUNTING_PLATFORMS } from '../../../types/client';
import type { IngestionPipeline, PipelineRunSummary, AccountingSection } from '../../../types/client';
import { StreamExecutionResultModal } from '../../modals/StreamExecutionResultModal';
import { PipelineSetupWizardModal } from '../../modals/PipelineSetupWizardModal';
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
  Mail,
  Plus,
  FileSpreadsheet,
  Edit3,
  Filter,
  ShieldCheck,
  Zap,
  Cloud,
  DollarSign,
  Receipt,
  Landmark,
  TrendingUp,
  Eye,
  Check,
  ArrowUpRight,
} from 'lucide-react';

export const ClientOverviewTab: React.FC = () => {
  const {
    currentClient,
    activeSections,
    updatePipelineLastRun,
    refreshClients,
    savePipeline,
  } = useClient();

  const {
    addLog,
    selectedMonth,
    selectedYear,
    navigateToClientSubTab,
  } = useAutomation();

  const { reportError, syncServerIssuesNow } = useErrors();

  // Modal & UI States
  const [triggeringPipeId, setTriggeringPipeId] = useState<string | null>(null);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; currentName: string } | null>(null);
  const [isProbing, setIsProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<any | null>(null);
  const [showBlueprint, setShowBlueprint] = useState(false);
  const [activeRunSummary, setActiveRunSummary] = useState<PipelineRunSummary | null>(null);
  const [filterSection, setFilterSection] = useState<'ALL' | AccountingSection>('ALL');

  // Pipeline Setup Wizard Modal State
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [editingPipeline, setEditingPipeline] = useState<IngestionPipeline | null>(null);

  // Staged Transactions Telemetry
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoadingTx, setIsLoadingTx] = useState(false);

  const currentPlatform =
    ACCOUNTING_PLATFORMS.find((p) => p.id === currentClient.accounting_software) ||
    ACCOUNTING_PLATFORMS[0];

  // Load client staged transactions for live rollup metrics
  const loadTransactions = async () => {
    setIsLoadingTx(true);
    try {
      const data = await fetchClientTransactions(currentClient.id);
      setTransactions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Could not fetch client transactions for rollup:', err);
    } finally {
      setIsLoadingTx(false);
    }
  };

  useEffect(() => {
    loadTransactions();
  }, [currentClient.id]);

  // Derived Pipeline Analytics
  const pipelines = currentClient.pipelines || [];
  const activePipelines = useMemo(
    () => pipelines.filter((p) => p.is_active !== false && p.active !== false),
    [pipelines]
  );

  const arPipelines = useMemo(
    () => pipelines.filter((p) => p.section === 'AR' || p.entity_type?.startsWith('ar_') || p.entity_type?.startsWith('pos_')),
    [pipelines]
  );

  const apPipelines = useMemo(
    () => pipelines.filter((p) => p.section === 'AP' || p.entity_type?.startsWith('ap_')),
    [pipelines]
  );

  const bankPipelines = useMemo(
    () => pipelines.filter((p) => p.section === 'BANK' || p.entity_type?.includes('statement') || p.entity_type?.includes('bank')),
    [pipelines]
  );

  const glPipelines = useMemo(
    () => pipelines.filter((p) => p.section === 'GL' || p.entity_type?.startsWith('gl_')),
    [pipelines]
  );

  const filteredPipelines = useMemo(() => {
    if (filterSection === 'ALL') return pipelines;
    return pipelines.filter((p) => {
      if (filterSection === 'AR') return p.section === 'AR' || p.entity_type?.startsWith('ar_') || p.entity_type?.startsWith('pos_');
      if (filterSection === 'AP') return p.section === 'AP' || p.entity_type?.startsWith('ap_');
      if (filterSection === 'BANK') return p.section === 'BANK' || p.entity_type?.includes('statement') || p.entity_type?.includes('bank');
      if (filterSection === 'GL') return p.section === 'GL' || p.entity_type?.startsWith('gl_');
      return p.section === filterSection;
    });
  }, [pipelines, filterSection]);

  const autoDraftCount = useMemo(
    () => activePipelines.filter((p) => p.auto_post_to_zoho || p.auto_post_draft).length,
    [activePipelines]
  );

  const failedPipelines = useMemo(
    () => pipelines.filter((p) => p.last_run_summary?.status === 'FAILED'),
    [pipelines]
  );

  const totalSourcesDiscovered = useMemo(
    () => pipelines.reduce((sum, p) => sum + (p.last_run_summary?.sources_discovered || 0), 0),
    [pipelines]
  );

  const totalItemsExtracted = useMemo(
    () => pipelines.reduce((sum, p) => sum + (p.last_run_summary?.items_extracted || 0), 0),
    [pipelines]
  );

  // Staged Ledger Metrics
  const stagedCount = transactions.length;
  const stagedAmount = useMemo(() => {
    return transactions.reduce((sum, tx) => {
      const amt = Number(tx.amount || tx.total || tx.total_amount || 0);
      return sum + (isNaN(amt) ? 0 : amt);
    }, 0);
  }, [transactions]);

  // Handler: Ingestion Connectivity Test Probe
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

  // Handler: Trigger an Individual Pipeline Stream
  const handleTriggerStream = async (pipelineId: string, pipelineName: string, forceReprocess: boolean = false): Promise<PipelineRunSummary | null> => {
    setTriggeringPipeId(pipelineId);
    addLog('info', `⚡ [STREAM] Triggering "${pipelineName}" (${selectedMonth} ${selectedYear})${forceReprocess ? ' [Force Reprocess]' : ''}...`);
    try {
      const result = await triggerClientPipeline(currentClient.id, pipelineId, {
        month: selectedMonth,
        year: selectedYear,
        force_reprocess: forceReprocess,
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

      // Realtime local context update
      updatePipelineLastRun(currentClient.id, pipelineId, summary);
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

      // Refresh transactions after run
      await loadTransactions();
      return summary;
    } catch (err: any) {
      addLog('error', `❌ Stream "${pipelineName}" execution failed: ${err.message}`);
      reportError({
        severity: 'error',
        category: 'pipeline',
        title: `Stream Error: ${pipelineName}`,
        message: err.message,
        endpoint: `/api/v1/clients/${currentClient.id}/pipelines/${pipelineId}/trigger`,
        showToast: true,
      });
      await syncServerIssuesNow();
      return null;
    } finally {
      setTriggeringPipeId(null);
    }
  };

  // Handler: Run All Active Streams Sequentially
  const handleRunAllStreams = async () => {
    if (activePipelines.length === 0) return;
    setIsBatchRunning(true);
    addLog('info', `🚀 [BATCH] Starting sequential run across all ${activePipelines.length} active streams for ${selectedMonth} ${selectedYear}...`);

    let lastResult: PipelineRunSummary | null = null;
    let totalExtracted = 0;
    let totalErrors = 0;

    for (let i = 0; i < activePipelines.length; i++) {
      const pipe = activePipelines[i];
      setBatchProgress({
        current: i + 1,
        total: activePipelines.length,
        currentName: pipe.name,
      });

      const res = await handleTriggerStream(pipe.id, pipe.name);
      if (res) {
        lastResult = res;
        totalExtracted += res.items_extracted || 0;
        if (res.status === 'FAILED') totalErrors++;
      }
    }

    setIsBatchRunning(false);
    setBatchProgress(null);

    if (totalErrors === 0) {
      addLog('success', `🎉 [BATCH] All ${activePipelines.length} streams executed successfully! Total staged: ${totalExtracted} items.`);
    } else {
      addLog('warning', `⚠️ [BATCH] Completed with ${totalErrors} stream failure(s). Review logs for details.`);
    }

    if (lastResult) {
      setActiveRunSummary(lastResult);
    }
    await refreshClients();
    await loadTransactions();
  };

  // Handler: Wizard Submit
  const handleSavePipelineSubmit = async (pipelineData: IngestionPipeline) => {
    await savePipeline(currentClient.id, pipelineData);
    addLog('success', `✅ Saved pipeline stream: "${pipelineData.name}"`);
    setIsWizardOpen(false);
    setEditingPipeline(null);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* 1. Master Operational Control Header */}
      <div className="glass-panel rounded-2xl px-5 py-4.5 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-slate-800/90">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 rounded-xl">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" />
            <span className="text-xs font-bold text-white tracking-tight">Active Pipelines Monitor</span>
          </div>

          <span className="text-xs font-mono font-bold text-sky-400 bg-sky-950/80 border border-sky-500/40 px-3 py-1 rounded-xl">
            {selectedMonth} {selectedYear}
          </span>

          <span className="text-xs text-slate-400 hidden lg:inline">
            • Dynamic orchestration for {activePipelines.length} live stream{activePipelines.length !== 1 ? 's' : ''} &amp; {currentPlatform.name}
          </span>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap shrink-0">
          <button
            onClick={() => setShowBlueprint((prev) => !prev)}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border transition cursor-pointer ${
              showBlueprint
                ? 'bg-sky-950/80 border-sky-500/50 text-sky-300'
                : 'bg-slate-900 hover:bg-slate-800 border-slate-700/80 text-slate-300'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-sky-400" />
            <span>Blueprint</span>
            {showBlueprint ? <ChevronUp className="w-3.5 h-3.5 ml-0.5" /> : <ChevronDown className="w-3.5 h-3.5 ml-0.5" />}
          </button>

          <button
            onClick={handleTestProbe}
            disabled={isProbing}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-200 text-xs font-semibold px-3 py-2 rounded-xl transition cursor-pointer disabled:opacity-50"
            title="Probe connection to source folders and mailboxes"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isProbing ? 'animate-spin text-sky-400' : ''}`} />
            <span>{isProbing ? 'Probing...' : 'Test Ingestion'}</span>
          </button>

          <button
            onClick={() => {
              setEditingPipeline(null);
              setIsWizardOpen(true);
            }}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-600/80 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-sky-400" />
            <span>Add Pipeline</span>
          </button>

          <button
            onClick={handleRunAllStreams}
            disabled={isBatchRunning || activePipelines.length === 0}
            className="flex items-center gap-2 bg-gradient-to-r from-sky-500 via-indigo-600 to-indigo-700 hover:from-sky-400 hover:to-indigo-600 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg shadow-sky-500/25 transition cursor-pointer disabled:opacity-50"
          >
            {isBatchRunning ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Running Streams...</span>
              </>
            ) : (
              <>
                <PlayCircle className="w-4 h-4 text-white" />
                <span>Run All Active Streams</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 2. Batch Execution Banner Indicator */}
      {batchProgress && (
        <div className="bg-gradient-to-r from-sky-950/90 via-indigo-950/90 to-slate-950/90 border border-sky-500/40 rounded-2xl p-4.5 shadow-xl animate-in fade-in duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2.5">
              <span className="w-3 h-3 rounded-full bg-sky-400 animate-ping" />
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                Executing Stream {batchProgress.current} of {batchProgress.total}
              </span>
              <span className="text-xs font-semibold text-sky-300">
                "{batchProgress.currentName}"
              </span>
            </div>
            <span className="text-xs font-mono font-bold text-sky-400">
              {Math.round((batchProgress.current / batchProgress.total) * 100)}% Complete
            </span>
          </div>
          <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
            <div
              className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-all duration-500 rounded-full shadow-[0_0_10px_#38bdf8]"
              style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* 3. Dismissible Connectivity Probe Result */}
      {probeResult && (
        <div
          className={`p-4 rounded-2xl border flex items-center justify-between gap-3 text-xs shadow-md animate-in fade-in ${
            probeResult.success
              ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/70 border-rose-500/40 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
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
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 4. Collapsible Architecture Blueprint */}
      {showBlueprint && (
        <div className="glass-panel rounded-2xl p-5 shadow-lg border border-sky-500/30 bg-slate-950/90 animate-in fade-in duration-200">
          <div className="flex items-center justify-between mb-3.5">
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

      {/* 5. Dynamic Multi-Pipeline Operational Metrics Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Metric 1: Configured & Active Streams */}
        <div
          onClick={() => navigateToClientSubTab('pipelines')}
          className="bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-sky-500/50 rounded-2xl p-4.5 shadow-md backdrop-blur-xl transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-400">Active Pipelines</span>
            <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 group-hover:scale-105 transition-transform">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-white tracking-tight">
            {activePipelines.length} <span className="text-xs font-normal text-slate-400">/ {pipelines.length} total</span>
          </div>
          <div className="flex items-center gap-1.5 mt-2 flex-wrap text-[10px]">
            {arPipelines.length > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-500/30 font-semibold">
                {arPipelines.length} AR
              </span>
            )}
            {apPipelines.length > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-500/30 font-semibold">
                {apPipelines.length} AP
              </span>
            )}
            {bankPipelines.length > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-500/30 font-semibold">
                {bankPipelines.length} Bank
              </span>
            )}
            {glPipelines.length > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-500/30 font-semibold">
                {glPipelines.length} GL
              </span>
            )}
          </div>
        </div>

        {/* Metric 2: Staged Ledger Transactions & Volume */}
        <div
          onClick={() => {
            if (activeSections.hasAr) navigateToClientSubTab('ar');
            else if (activeSections.hasAp) navigateToClientSubTab('ap');
            else if (activeSections.hasBank) navigateToClientSubTab('bank');
          }}
          className="bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-emerald-500/50 rounded-2xl p-4.5 shadow-md backdrop-blur-xl transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-400">Staged Ledger Items</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-emerald-400 tracking-tight">
            {stagedCount} <span className="text-xs font-normal text-slate-400">Transactions</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-2 truncate">
            <span className="font-mono font-semibold text-slate-200">
              {currentClient.currency || 'GHS'} {stagedAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>{' '}
            <span>awaiting sign-off</span>
          </div>
        </div>

        {/* Metric 3: Automated Posting Readiness */}
        <div
          onClick={() => navigateToClientSubTab('pipelines')}
          className="bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-indigo-500/50 rounded-2xl p-4.5 shadow-md backdrop-blur-xl transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-400">Auto-Draft Invoicing</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition-transform">
              <Zap className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-indigo-300 tracking-tight">
            {autoDraftCount} <span className="text-xs font-normal text-slate-400">/ {activePipelines.length} Streams</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-2 flex items-center gap-1.5 truncate">
            <span>{currentPlatform.icon}</span>
            <span className="text-slate-300 font-semibold">{currentPlatform.name}</span>
            <span>Sync</span>
          </div>
        </div>

        {/* Metric 4: Ingestion Pipeline Health */}
        <div
          onClick={() => navigateToClientSubTab('settings')}
          className="bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-amber-500/50 rounded-2xl p-4.5 shadow-md backdrop-blur-xl transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-400">Extraction Health</span>
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform ${
              failedPipelines.length === 0
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
            }`}>
              {failedPipelines.length === 0 ? <ShieldCheck className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            </div>
          </div>
          <div className={`text-2xl font-extrabold tracking-tight ${
            failedPipelines.length === 0 ? 'text-white' : 'text-rose-400'
          }`}>
            {failedPipelines.length === 0 ? 'All Healthy' : `${failedPipelines.length} Need Review`}
          </div>
          <div className="text-[11px] text-slate-400 mt-2 truncate">
            <span>{totalSourcesDiscovered} docs scanned • {totalItemsExtracted} extracted</span>
          </div>
        </div>

      </div>

      {/* 6. Active Pipelines Operations Hub (Hero Section) */}
      <div className="glass-panel rounded-2xl p-5 shadow-xl border border-slate-800 space-y-4">
        
        {/* Section Header & Category Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Layers className="w-5 h-5 text-sky-400" />
            <div>
              <h2 className="text-sm font-extrabold text-white tracking-tight">
                Configured Ingestion Pipelines &amp; Streams
              </h2>
              <p className="text-[11px] text-slate-400">
                Multi-channel extraction matrix routing into staged accounting ledgers.
              </p>
            </div>
          </div>

          {/* Section Filter Tabs */}
          <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-800 p-1 rounded-xl shrink-0 overflow-x-auto">
            <button
              onClick={() => setFilterSection('ALL')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                filterSection === 'ALL'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({pipelines.length})
            </button>
            {arPipelines.length > 0 && (
              <button
                onClick={() => setFilterSection('AR')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  filterSection === 'AR'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                AR Revenue ({arPipelines.length})
              </button>
            )}
            {apPipelines.length > 0 && (
              <button
                onClick={() => setFilterSection('AP')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  filterSection === 'AP'
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                AP Bills ({apPipelines.length})
              </button>
            )}
            {bankPipelines.length > 0 && (
              <button
                onClick={() => setFilterSection('BANK')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  filterSection === 'BANK'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Bank Feeds ({bankPipelines.length})
              </button>
            )}
          </div>
        </div>

        {/* Dynamic Pipelines Grid */}
        {filteredPipelines.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredPipelines.map((pipe, idx) => {
              const isPipeRunning = triggeringPipeId === pipe.id || (batchProgress?.currentName === pipe.name);
              const isActive = pipe.is_active !== false && pipe.active !== false;

              // Section style tagging
              const isAr = pipe.section === 'AR' || pipe.entity_type?.startsWith('ar_') || pipe.entity_type?.startsWith('pos_');
              const isAp = pipe.section === 'AP' || pipe.entity_type?.startsWith('ap_');
              const isBank = pipe.section === 'BANK' || pipe.entity_type?.includes('statement') || pipe.entity_type?.includes('bank');

              const sectionBadgeStyle = isAr
                ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                : isAp
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                : isBank
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : 'bg-purple-500/15 text-purple-300 border-purple-500/30';

              const sectionLabel = isAr
                ? 'AR • Sales Invoices & Revenue'
                : isAp
                ? 'AP • Vendor Bills & Payables'
                : isBank
                ? 'BANK • Statement & Feeds'
                : `${pipe.section || 'GL'} • General Ledger`;

              const ledgerSubTab = isAr ? 'ar' : isAp ? 'ap' : isBank ? 'bank' : 'pipelines';

              // Source icon
              const isDrive = pipe.source_type === 'google_drive';
              const isEmail = pipe.source_type === 'email';
              const isOneDrive = pipe.source_type === 'onedrive';
              const isBankFeed = pipe.source_type === 'bank_feed';

              const folderOrTarget =
                pipe.folderId ||
                pipe.folder_id ||
                pipe.sourceEmail ||
                pipe.source_email ||
                pipe.source_identifier ||
                currentClient.folderId ||
                currentClient.folder_id ||
                'Linked Target';

              const lastRun = pipe.last_run_summary;

              return (
                <div
                  key={pipe.id || idx}
                  className={`bg-slate-900/70 border rounded-2xl p-5 flex flex-col justify-between space-y-4 hover:border-slate-700 transition shadow-lg relative group ${
                    !isActive ? 'opacity-70 border-slate-800/60' : 'border-slate-800'
                  }`}
                >
                  <div>
                    {/* Top Tag & Header Controls */}
                    <div className="flex items-center justify-between mb-3">
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${sectionBadgeStyle}`}>
                        {sectionLabel}
                      </span>

                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isActive
                            ? 'bg-emerald-950/80 border border-emerald-500/30 text-emerald-300'
                            : 'bg-slate-800 text-slate-400'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-slate-500'}`} />
                          <span>{isActive ? 'LIVE STREAM' : 'PAUSED'}</span>
                        </span>

                        <button
                          type="button"
                          onClick={() => {
                            setEditingPipeline(pipe);
                            setIsWizardOpen(true);
                          }}
                          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                          title="Configure Pipeline Stream"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Pipeline Name & Description */}
                    <div>
                      <h3 className="text-sm font-bold text-white group-hover:text-sky-300 transition-colors">
                        {pipe.name}
                      </h3>
                      {pipe.notes && (
                        <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{pipe.notes}</p>
                      )}
                    </div>

                    {/* Source & Destination Routing Strip */}
                    <div className="grid grid-cols-2 gap-2.5 mt-3.5 pt-3 border-t border-slate-800/80 text-xs">
                      
                      {/* Ingestion Source */}
                      <div className="bg-slate-950/70 p-2.5 rounded-xl border border-slate-850">
                        <span className="text-[10px] font-semibold text-slate-500 uppercase block mb-1">
                          Source Ingestion
                        </span>
                        <div className="flex items-center gap-1.5">
                          {isDrive ? (
                            <HardDrive className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                          ) : isEmail ? (
                            <Mail className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          ) : isOneDrive ? (
                            <Cloud className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          ) : isBankFeed ? (
                            <Landmark className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <Zap className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                          )}
                          <span className="font-mono text-[11px] text-slate-200 truncate" title={folderOrTarget}>
                            {folderOrTarget.length > 20 ? `${folderOrTarget.slice(0, 18)}...` : folderOrTarget}
                          </span>
                          {isDrive && (folderOrTarget.startsWith('1') || folderOrTarget.length > 15) && (
                            <a
                              href={`https://drive.google.com/drive/folders/${folderOrTarget}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-slate-400 hover:text-sky-400 ml-auto shrink-0"
                              title="Open Google Drive folder"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Accounting Destination */}
                      <div className="bg-slate-950/70 p-2.5 rounded-xl border border-slate-850">
                        <span className="text-[10px] font-semibold text-slate-500 uppercase block mb-1">
                          ERP Posting Target
                        </span>
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs shrink-0">{currentPlatform.icon}</span>
                            <span className="text-[11px] font-semibold text-slate-200 truncate">
                              {currentPlatform.name}
                            </span>
                          </div>
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.2 rounded shrink-0 ${
                              pipe.auto_post_to_zoho || pipe.auto_post_draft
                                ? 'bg-indigo-950/80 text-indigo-300 border border-indigo-500/30'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                            title={pipe.auto_post_to_zoho || pipe.auto_post_draft ? 'Auto-Draft active' : 'Staged manual review'}
                          >
                            {pipe.auto_post_to_zoho || pipe.auto_post_draft ? 'Auto-Draft' : 'Review'}
                          </span>
                        </div>
                      </div>

                    </div>

                    {/* Schedule & Run Count Strip */}
                    <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2 px-0.5">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-500" />
                        <span>{pipe.cron_schedule_human || pipe.schedule || 'Scheduled / Daily @ 18:00 UTC'}</span>
                      </span>
                      {pipe.total_runs_count ? (
                        <span className="font-mono text-slate-500 text-[10px]">
                          {pipe.total_runs_count} total run{pipe.total_runs_count !== 1 ? 's' : ''}
                        </span>
                      ) : null}
                    </div>

                    {/* Last Run Telemetry Box */}
                    {lastRun ? (
                      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 mt-3 space-y-2">
                        <div className="flex items-center justify-between text-[10px]">
                          <div className="flex items-center gap-1.5 text-slate-400">
                            <Clock className="w-3 h-3 text-sky-400" />
                            <span>
                              Last Run: {new Date(lastRun.triggered_at).toLocaleDateString()} {new Date(lastRun.triggered_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>

                          <span
                            className={`px-2 py-0.5 rounded-full font-bold uppercase text-[9px] ${
                              lastRun.status === 'COMPLETED_DUPLICATES_SKIPPED'
                                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                : lastRun.status === 'FAILED'
                                ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                                : lastRun.items_extracted > 0
                                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {lastRun.status === 'COMPLETED_DUPLICATES_SKIPPED'
                              ? 'Duplicates Skipped'
                              : lastRun.status === 'FAILED'
                              ? 'Failed'
                              : lastRun.items_extracted > 0
                              ? `${lastRun.items_extracted} Staged`
                              : 'Executed'}
                          </span>
                        </div>

                        <p className="text-xs text-slate-300 line-clamp-2">
                          {lastRun.summary_message}
                        </p>

                        {/* Telemetry Actions Strip */}
                        <div className="flex items-center justify-between pt-2 border-t border-slate-900 text-[11px]">
                          <button
                            type="button"
                            onClick={() => setActiveRunSummary(lastRun)}
                            className="text-sky-400 hover:text-sky-300 font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Inspect Telemetry</span>
                          </button>

                          {lastRun.spreadsheet_url && !lastRun.spreadsheet_url.includes('mock_sheet') && (
                            <a
                              href={lastRun.spreadsheet_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1 hover:underline"
                            >
                              <FileSpreadsheet className="w-3.5 h-3.5" />
                              <span>Review Sheet</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="bg-slate-950/50 border border-dashed border-slate-850 rounded-xl p-3 mt-3 text-center text-xs text-slate-500">
                        <span>Awaiting initial run for {selectedMonth} {selectedYear}</span>
                      </div>
                    )}
                  </div>

                  {/* Card Action Controls Footer */}
                  <div className="flex items-center justify-between pt-3 border-t border-slate-800/80 gap-3">
                    <button
                      type="button"
                      onClick={() => navigateToClientSubTab(ledgerSubTab as any)}
                      className="text-xs font-bold text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <span>View Staged Ledger</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTriggerStream(pipe.id, pipe.name)}
                      disabled={isPipeRunning}
                      className="flex items-center gap-1.5 text-xs font-bold text-sky-400 hover:text-white bg-sky-950/80 hover:bg-sky-900/80 border border-sky-500/40 px-3.5 py-1.5 rounded-xl transition cursor-pointer disabled:opacity-50"
                    >
                      {isPipeRunning ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-400" />
                          <span>Running...</span>
                        </>
                      ) : (
                        <>
                          <PlayCircle className="w-3.5 h-3.5 text-sky-400" />
                          <span>Run Stream</span>
                        </>
                      )}
                    </button>
                  </div>

                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-10 px-4 rounded-2xl bg-slate-950/40 border border-dashed border-slate-800 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 mx-auto">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">No Ingestion Pipelines Found</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                No active streams match the selected filter. Connect Google Drive, email inboxes, or bank statements to begin extracting transactions.
              </p>
            </div>
            <button
              onClick={() => {
                setEditingPipeline(null);
                setIsWizardOpen(true);
              }}
              className="inline-flex items-center gap-1.5 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Configure New Pipeline Stream</span>
            </button>
          </div>
        )}

      </div>

      {/* 7. Connected Infrastructure & Integration Status Strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Accounting ERP Sync Status */}
        <div className="glass-panel rounded-2xl p-4.5 shadow-lg border border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-base">{currentPlatform.icon}</span>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Connected Accounting Platform
              </h3>
            </div>
            <button
              onClick={() => navigateToClientSubTab('settings')}
              className="text-[11px] font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
            >
              <span>Manage</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/90 rounded-xl p-3 flex items-center justify-between">
            <div className="min-w-0">
              <h4 className="text-xs font-bold text-white truncate">{currentPlatform.name}</h4>
              <p className="text-[11px] text-slate-400 mt-0.5">{currentPlatform.targetProtocol}</p>
              {currentClient.zohoOrg && (
                <span className="text-[10px] font-mono text-slate-500 block mt-0.5">
                  Org ID: {currentClient.zohoOrg}
                </span>
              )}
            </div>

            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 shrink-0">
              Live Connected
            </span>
          </div>
        </div>

        {/* Cloud Document Storage & Mailbox Feeds */}
        <div className="glass-panel rounded-2xl p-4.5 shadow-lg border border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-sky-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Monitored Storage &amp; Inboxes
              </h3>
            </div>
            <button
              onClick={() => navigateToClientSubTab('pipelines')}
              className="text-[11px] font-semibold text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
            >
              <span>Pipelines</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/90 rounded-xl p-3 flex items-center justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white truncate">
                  {(currentClient.folderId || currentClient.folder_id)
                    ? 'Google Drive OCR Folder'
                    : 'Configured Ingestion Channels'}
                </span>
              </div>
              <p className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                {(currentClient.folderId || currentClient.folder_id)
                  ? `${(currentClient.folderId || currentClient.folder_id)!.slice(0, 24)}...`
                  : `${activePipelines.length} Active Storage Stream(s)`}
              </p>
            </div>

            {(currentClient.folderId || currentClient.folder_id) && (
              <a
                href={`https://drive.google.com/drive/folders/${currentClient.folderId || currentClient.folder_id}`}
                target="_blank"
                rel="noreferrer"
                className="text-slate-400 hover:text-sky-400 p-1.5 transition shrink-0"
                title="Open in Google Drive"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
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

      {/* Pipeline Setup / Edit Wizard Modal */}
      <PipelineSetupWizardModal
        isOpen={isWizardOpen}
        onClose={() => {
          setIsWizardOpen(false);
          setEditingPipeline(null);
        }}
        onSave={handleSavePipelineSubmit}
        clientId={currentClient.id}
        clientName={currentClient.name}
        initialPipeline={editingPipeline}
        targetAccountingSoftware={currentClient.accounting_software}
      />

    </div>
  );
};
