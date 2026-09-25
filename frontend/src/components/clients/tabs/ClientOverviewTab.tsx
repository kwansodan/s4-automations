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
      <div className="bg-white rounded-2xl px-5 py-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-[#E2E8F0]">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-slate-50 border border-[#E2E8F0] px-3 py-1.5 rounded-xl">
            <span className="w-2 h-2 rounded-full bg-[#059669] shadow-[0_0_6px_#10B981] animate-pulse" />
            <span className="text-xs font-bold text-slate-900 tracking-tight">Active Pipelines Monitor</span>
          </div>

          <span className="text-xs font-mono font-bold text-[#0284C7] bg-[#F0F9FF] border border-[#BAE6FD] px-3 py-1 rounded-xl">
            {selectedMonth} {selectedYear}
          </span>

          <span className="text-xs text-slate-500 hidden lg:inline">
            • Dynamic orchestration for {activePipelines.length} live stream{activePipelines.length !== 1 ? 's' : ''} &amp; {currentPlatform.name}
          </span>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap shrink-0">
          <button
            onClick={() => setShowBlueprint((prev) => !prev)}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border transition cursor-pointer shadow-xs ${
              showBlueprint
                ? 'bg-[#F0F9FF] border-[#BAE6FD] text-[#0284C7]'
                : 'bg-white hover:bg-slate-50 border-[#E2E8F0] text-slate-700'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-[#0284C7]" />
            <span>Blueprint</span>
            {showBlueprint ? <ChevronUp className="w-3.5 h-3.5 ml-0.5" /> : <ChevronDown className="w-3.5 h-3.5 ml-0.5" />}
          </button>

          <button
            onClick={handleTestProbe}
            disabled={isProbing}
            className="flex items-center gap-1.5 bg-white hover:bg-slate-50 border border-[#E2E8F0] text-slate-700 text-xs font-semibold px-3 py-2 rounded-xl transition cursor-pointer shadow-xs disabled:opacity-50"
            title="Probe connection to source folders and mailboxes"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isProbing ? 'animate-spin text-[#0284C7]' : 'text-slate-400'}`} />
            <span>{isProbing ? 'Probing...' : 'Test Ingestion'}</span>
          </button>

          <button
            onClick={() => {
              setEditingPipeline(null);
              setIsWizardOpen(true);
            }}
            className="flex items-center gap-1.5 bg-white hover:bg-slate-50 border border-[#E2E8F0] text-slate-700 text-xs font-bold px-3.5 py-2 rounded-xl transition cursor-pointer shadow-xs"
          >
            <Plus className="w-3.5 h-3.5 text-[#0284C7]" />
            <span>Add Pipeline</span>
          </button>

          <button
            onClick={handleRunAllStreams}
            disabled={isBatchRunning || activePipelines.length === 0}
            className="flex items-center gap-2 bg-[#0284C7] hover:bg-[#0EA5E9] text-white text-xs font-bold px-4 py-2 rounded-xl shadow-sm transition cursor-pointer disabled:opacity-50"
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
          className="bg-white hover:bg-slate-50 border border-[#E2E8F0] hover:border-[#BAE6FD] rounded-2xl p-4.5 shadow-sm transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500">Active Pipelines</span>
            <div className="w-8 h-8 rounded-xl bg-[#F0F9FF] border border-[#BAE6FD] flex items-center justify-center text-[#0284C7] group-hover:scale-105 transition-transform">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 tracking-tight tabular-nums">
            {activePipelines.length} <span className="text-xs font-normal text-slate-500">/ {pipelines.length} total</span>
          </div>
          <div className="flex items-center gap-1.5 mt-2 flex-wrap text-[10px]">
            {arPipelines.length > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-[#F0F9FF] text-[#0284C7] border border-[#BAE6FD] font-semibold">
                {arPipelines.length} AR
              </span>
            )}
            {apPipelines.length > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
                {apPipelines.length} AP
              </span>
            )}
            {bankPipelines.length > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0] font-semibold">
                {bankPipelines.length} Bank
              </span>
            )}
            {glPipelines.length > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 font-semibold">
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
          className="bg-white hover:bg-slate-50 border border-[#E2E8F0] hover:border-[#A7F3D0] rounded-2xl p-4.5 shadow-sm transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500">Staged Ledger Items</span>
            <div className="w-8 h-8 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] flex items-center justify-center text-[#059669] group-hover:scale-105 transition-transform">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-[#059669] tracking-tight tabular-nums">
            {stagedCount} <span className="text-xs font-normal text-slate-500">Transactions</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-2 truncate">
            <span className="font-mono font-semibold text-slate-800 tabular-nums">
              {currentClient.currency || 'GHS'} {stagedAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>{' '}
            <span>awaiting sign-off</span>
          </div>
        </div>

        {/* Metric 3: Automated Posting Readiness */}
        <div
          onClick={() => navigateToClientSubTab('pipelines')}
          className="bg-white hover:bg-slate-50 border border-[#E2E8F0] hover:border-[#BAE6FD] rounded-2xl p-4.5 shadow-sm transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500">Auto-Draft Invoicing</span>
            <div className="w-8 h-8 rounded-xl bg-[#F0F9FF] border border-[#BAE6FD] flex items-center justify-center text-[#0284C7] group-hover:scale-105 transition-transform">
              <Zap className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 tracking-tight tabular-nums">
            {autoDraftCount} <span className="text-xs font-normal text-slate-500">/ {activePipelines.length} Streams</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-2 flex items-center gap-1.5 truncate">
            <span>{currentPlatform.icon}</span>
            <span className="text-slate-800 font-semibold">{currentPlatform.name}</span>
            <span>Sync</span>
          </div>
        </div>

        {/* Metric 4: Ingestion Pipeline Health */}
        <div
          onClick={() => navigateToClientSubTab('settings')}
          className="bg-white hover:bg-slate-50 border border-[#E2E8F0] hover:border-amber-300 rounded-2xl p-4.5 shadow-sm transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500">Extraction Health</span>
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform ${
              failedPipelines.length === 0
                ? 'bg-[#ECFDF5] border border-[#A7F3D0] text-[#059669]'
                : 'bg-[#FFF1F2] border border-[#FECDD3] text-[#E11D48]'
            }`}>
              {failedPipelines.length === 0 ? <ShieldCheck className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            </div>
          </div>
          <div className={`text-2xl font-bold tracking-tight ${
            failedPipelines.length === 0 ? 'text-slate-900' : 'text-[#E11D48]'
          }`}>
            {failedPipelines.length === 0 ? 'All Healthy' : `${failedPipelines.length} Need Review`}
          </div>
          <div className="text-[11px] text-slate-500 mt-2 truncate">
            <span>{totalSourcesDiscovered} docs scanned • {totalItemsExtracted} extracted</span>
          </div>
        </div>

      </div>

      {/* 6. Executive Action Queue: Daily Focus Items */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E2E8F0]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#F0F9FF] border border-[#BAE6FD] flex items-center justify-center text-[#0284C7]">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 tracking-tight">
                Daily Bookkeeping Action Queue
              </h2>
              <p className="text-xs text-slate-500">
                Immediate items requiring review, classification, or client sign-off today.
              </p>
            </div>
          </div>

          <button
            onClick={() => navigateToClientSubTab('pipelines')}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#0284C7] hover:bg-[#F0F9FF] px-3.5 py-2 rounded-xl border border-[#BAE6FD] transition cursor-pointer self-start sm:self-auto shadow-xs"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Manage All Streams ({pipelines.length}) &rarr;</span>
          </button>
        </div>

        {/* 3 Core Action Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
          {/* Action 1: Bank & Reconciliations */}
          <div className="bg-[#F0F9FF] border border-[#BAE6FD] rounded-xl p-4 flex flex-col justify-between hover:border-[#0284C7] transition group">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[#0284C7] uppercase tracking-wider">Banking &amp; Suspense</span>
                <Landmark className="w-4 h-4 text-[#0284C7]" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">Clarifications &amp; Feeds</h3>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Review unclassified bank transactions in monitored suspense accounts and query clients with 1-click links.
              </p>
            </div>
            <div className="pt-4 mt-2 border-t border-[#BAE6FD]">
              <button
                onClick={() => navigateToClientSubTab('requests')}
                className="w-full flex items-center justify-center gap-1.5 bg-[#0284C7] hover:bg-[#0EA5E9] text-white text-xs font-semibold py-2 rounded-lg shadow-sm transition cursor-pointer"
              >
                <span>Open Bank Queue</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Action 2: AR Revenue Slips */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 flex flex-col justify-between hover:border-slate-300 transition group">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Revenue Control</span>
                <Receipt className="w-4 h-4 text-slate-700" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">AR Revenue Ledger</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                {stagedCount > 0
                  ? `${stagedCount} staged transactions (${currentClient.currency || 'GHS'} ${stagedAmount.toLocaleString()}) awaiting batch sign-off.`
                  : 'All revenue slip extractions are up to date and reconciled.'}
              </p>
            </div>
            <div className="pt-4 mt-2 border-t border-[#E2E8F0]">
              <button
                onClick={() => navigateToClientSubTab('ar')}
                className="w-full flex items-center justify-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-[#E2E8F0] text-xs font-semibold py-2 rounded-lg transition cursor-pointer shadow-xs"
              >
                <span>Review Revenue Ledger</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Action 3: AP Vendor Bills */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 flex flex-col justify-between hover:border-slate-300 transition group">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Vendor Expenses</span>
                <DollarSign className="w-4 h-4 text-slate-700" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">AP Vendor Bills</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Inspect AI OCR vendor receipts, verify line-item tax breakdowns, and push draft bills to {currentPlatform.name}.
              </p>
            </div>
            <div className="pt-4 mt-2 border-t border-[#E2E8F0]">
              <button
                onClick={() => navigateToClientSubTab('ap')}
                className="w-full flex items-center justify-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-[#E2E8F0] text-xs font-semibold py-2 rounded-lg transition cursor-pointer shadow-xs"
              >
                <span>Review Vendor Bills</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 7. Connected Infrastructure & Integration Status Strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Accounting ERP Sync Status */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4.5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-base">{currentPlatform.icon}</span>
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Connected Accounting Platform
              </h3>
            </div>
            <button
              onClick={() => navigateToClientSubTab('settings')}
              className="text-[11px] font-semibold text-[#0284C7] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>Manage</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="bg-slate-50 border border-[#E2E8F0] rounded-xl p-3 flex items-center justify-between">
            <div className="min-w-0">
              <h4 className="text-xs font-bold text-slate-900 truncate">{currentPlatform.name}</h4>
              <p className="text-[11px] text-slate-500 mt-0.5">{currentPlatform.targetProtocol}</p>
              {currentClient.zohoOrg && (
                <span className="text-[10px] font-mono text-slate-500 block mt-0.5">
                  Org ID: {currentClient.zohoOrg}
                </span>
              )}
            </div>

            <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-[#ECFDF5] border border-[#A7F3D0] text-[#059669] shrink-0">
              Live Connected
            </span>
          </div>
        </div>

        {/* Cloud Document Storage & Mailbox Feeds */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4.5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-[#0284C7]" />
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Monitored Storage &amp; Inboxes
              </h3>
            </div>
            <button
              onClick={() => navigateToClientSubTab('pipelines')}
              className="text-[11px] font-semibold text-[#0284C7] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>Pipelines</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="bg-slate-50 border border-[#E2E8F0] rounded-xl p-3 flex items-center justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-900 truncate">
                  {(currentClient.folderId || currentClient.folder_id)
                    ? 'Google Drive OCR Folder'
                    : 'Configured Ingestion Channels'}
                </span>
              </div>
              <p className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
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
                className="text-slate-400 hover:text-[#0284C7] p-1.5 transition shrink-0"
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

