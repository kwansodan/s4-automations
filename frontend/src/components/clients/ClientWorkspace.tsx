import React, { useState, useEffect } from 'react';
import { useClient } from '../../context/ClientContext';
import { useAutomation } from '../../context/AutomationContext';
import {
  runClientStrategy,
  fetchClientTransactions,
  batchApproveTransactions,
  testClientIngestion,
  fetchClientConfig,
  saveClientConfig,
  fetchBankTransactions,
  queryBankTransaction,
  mapBankTransaction,
  uploadBankStatement,
  triggerApPipeline,
  saveClientPipeline,
  deleteClientPipeline,
  triggerClientPipeline,
} from '../../lib/api';
import type { IngestionPipeline, AccountingSection, AccountingEntityType, AccountingSoftware } from '../../types/client';
import { ACCOUNTING_PLATFORMS } from '../../types/client';
import { PipelineSetupWizardModal } from '../modals/PipelineSetupWizardModal';
import {
  Layers,
  PlayCircle,
  CheckCircle2,
  Clock,
  Sparkles,
  ArrowLeft,
  RefreshCw,
  FileText,
  DollarSign,
  ShieldCheck,
  AlertTriangle,
  Settings2,
  Check,
  CheckCheck,
  Save,
  Sliders,
  Folder,
  Mail,
  Cloud,
  Database,
  X,
  Receipt,
  Landmark,
  UploadCloud,
  HelpCircle,
  Send,
  Plus,
  Trash2,
  Edit3,
  SlidersHorizontal,
} from 'lucide-react';

export const ClientWorkspace: React.FC = () => {
  const { currentClient, setIsWizardOpen } = useClient();
  const { setActiveTab, addLog, selectedMonth, selectedYear } = useAutomation();

  // Active Pipeline Tab: 'AR' | 'AP' | 'BANK'
  const [pipelineView, setPipelineView] = useState<'AR' | 'AP' | 'BANK'>('AR');

  const [isRunning, setIsRunning] = useState(false);
  const [executionResult, setExecutionResult] = useState<any | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoadingTx, setIsLoadingTx] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<any | null>(null);
  const [selectedTxIds, setSelectedTxIds] = useState<number[]>([]);
  const [isApproving, setIsApproving] = useState(false);

  // Bank Reconciliation Specific States
  const [bankTransactions, setBankTransactions] = useState<any[]>([]);
  const [isLoadingBankTx, setIsLoadingBankTx] = useState(false);
  const [isUploadingStatement, setIsUploadingStatement] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [queryInputs, setQueryInputs] = useState<{ [id: number]: string }>({});
  const [mappingInputs, setMappingInputs] = useState<{ [id: number]: string }>({});

  // AP Pipeline Specific States
  const [isAutoPostDraft, setIsAutoPostDraft] = useState(false);


  // Client-Specific Configuration State
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configSaveSuccess, setConfigSaveSuccess] = useState(false);
  const [clientConfig, setClientConfig] = useState({
    name: '',
    industry: '',
    icon: '🏢',
    status: 'dev',
    description: '',
    source_type: 'google_drive',
    folder_id: '',
    source_email: '',
    zoho_org_id: '',
    zoho_contact_id: '',
    source_config: {} as any,
    custom_config: {} as any,
  });

  // Load staged transactions for this client
  const loadTransactions = async () => {
    setIsLoadingTx(true);
    try {
      const data = await fetchClientTransactions(currentClient.id);
      setTransactions(data);
    } catch (err: any) {
      console.warn('Failed loading client transactions:', err);
    } finally {
      setIsLoadingTx(false);
    }
  };

  // Load dedicated configuration for this client
  const loadClientConfiguration = async () => {
    try {
      const cfg = await fetchClientConfig(currentClient.id);
      setClientConfig({
        name: cfg.name || currentClient.name,
        industry: cfg.industry || currentClient.industry,
        icon: cfg.icon || currentClient.icon || '🏢',
        status: cfg.status || currentClient.status,
        description: cfg.description || currentClient.desc || '',
        source_type: cfg.source_type || 'google_drive',
        folder_id: cfg.folder_id || '',
        source_email: cfg.source_email || `${currentClient.id}@inbound.service4gh.com`,
        zoho_org_id: cfg.zoho_org_id || '',
        zoho_contact_id: cfg.zoho_contact_id || '',
        source_config: cfg.source_config || {},
        custom_config: cfg.custom_config || {},
      });
    } catch (err: any) {
      console.warn('Could not load client config:', err);
    }
  };

  // Load bank transactions for this client
  const loadBankTransactions = async () => {
    setIsLoadingBankTx(true);
    try {
      const data = await fetchBankTransactions(currentClient.id);
      setBankTransactions(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.warn('Failed loading bank transactions:', err);
    } finally {
      setIsLoadingBankTx(false);
    }
  };

  useEffect(() => {
    setExecutionResult(null);
    setProbeResult(null);
    setSelectedTxIds([]);
    setIsConfigOpen(false);
    loadTransactions();
    loadBankTransactions();
    loadClientConfiguration();
  }, [currentClient.id]);

  const handleRunApPipeline = async () => {
    setIsRunning(true);
    setExecutionResult(null);
    addLog('info', `[AP PIPELINE] Ingesting vendor bills for ${currentClient.name}...`);
    try {
      const res = await triggerApPipeline({
        client_id: currentClient.id,
        month: selectedMonth,
        year: selectedYear,
        auto_post_draft: isAutoPostDraft,
      });
      setExecutionResult({
        status: 'COMPLETED',
        message: 'Accounts Payable (AP) pipeline triggered successfully via Inngest.',
        month: selectedMonth,
        year: selectedYear,
        sources_discovered: 1,
        items_extracted: 1,
        total_amount: 0,
      });
      addLog('success', `[AP PIPELINE] AP pipeline triggered for ${currentClient.name}`);
      await loadTransactions();
    } catch (err: any) {
      addLog('error', `AP Pipeline error: ${err.message}`);
      setExecutionResult({ status: 'FAILED', message: err.message });
    } finally {
      setIsRunning(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingStatement(true);
    setUploadMessage(null);
    addLog('info', `[BANK RECON] Uploading bank statement (${file.name}) for ${currentClient.name}...`);

    try {
      const res = await uploadBankStatement(currentClient.id, file, selectedMonth, selectedYear);
      setUploadMessage(`Successfully staged ${res.newly_staged || 0} bank statement lines!`);
      addLog('success', `Bank statement ingested: ${res.newly_staged || 0} unmapped transactions requiring attention.`);
      await loadBankTransactions();
    } catch (err: any) {
      setUploadMessage(`Upload failed: ${err.message}`);
      addLog('error', `Bank statement upload failed: ${err.message}`);
    } finally {
      setIsUploadingStatement(false);
      e.target.value = '';
    }
  };

  const handleSendQuery = async (txId: number) => {
    const queryText = queryInputs[txId]?.trim();
    if (!queryText) return;
    try {
      await queryBankTransaction(txId, queryText);
      addLog('success', `Sent question to client for bank line #${txId}.`);
      await loadBankTransactions();
      setQueryInputs((prev) => ({ ...prev, [txId]: '' }));
    } catch (err: any) {
      addLog('error', `Failed sending query: ${err.message}`);
    }
  };

  const handleMapAccount = async (txId: number) => {
    const accountId = mappingInputs[txId]?.trim();
    if (!accountId) return;
    try {
      await mapBankTransaction(txId, accountId);
      addLog('success', `Transaction #${txId} mapped to Zoho account '${accountId}'.`);
      await loadBankTransactions();
      setMappingInputs((prev) => ({ ...prev, [txId]: '' }));
    } catch (err: any) {
      addLog('error', `Failed mapping transaction: ${err.message}`);
    }
  };

  const handleSimulateRun = async () => {
    setIsRunning(true);
    setExecutionResult(null);
    addLog('info', `[LIVE] Triggering automation pipeline for ${currentClient.name}...`);

    try {
      const res = await runClientStrategy(currentClient.id, false);
      setExecutionResult(res);
      addLog('success', `[LIVE] ${res.message || 'Pipeline execution completed successfully.'}`);
      await loadTransactions();
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

  const handleBatchApprove = async () => {
    const idsToApprove = selectedTxIds.length > 0 ? selectedTxIds : transactions.filter((t) => !t.approved).map((t) => t.id);
    if (idsToApprove.length === 0) return;

    setIsApproving(true);
    try {
      await batchApproveTransactions(currentClient.id, idsToApprove, 'Approved via Client Workspace');
      addLog('success', `Approved ${idsToApprove.length} transactions for ${currentClient.name}.`);
      setSelectedTxIds([]);
      await loadTransactions();
    } catch (err: any) {
      addLog('error', `Failed approving transactions: ${err.message}`);
    } finally {
      setIsApproving(false);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingConfig(true);
    setConfigSaveSuccess(false);

    try {
      await saveClientConfig(currentClient.id, clientConfig);
      setConfigSaveSuccess(true);
      addLog('success', `Updated dedicated configuration for ${clientConfig.name} (${currentClient.id}).`);
      setTimeout(() => setConfigSaveSuccess(false), 3000);
    } catch (err: any) {
      addLog('error', `Failed saving client configuration: ${err.message}`);
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Pipeline Configuration Editor States
  const [isPipelineModalOpen, setIsPipelineModalOpen] = useState(false);
  const [editingPipeline, setEditingPipeline] = useState<IngestionPipeline | null>(null);

  const handleOpenNewPipeline = () => {
    setEditingPipeline(null);
    setIsPipelineModalOpen(true);
  };

  const handleOpenEditPipeline = (pipe: IngestionPipeline) => {
    setEditingPipeline(pipe);
    setIsPipelineModalOpen(true);
  };

  const handleSavePipelineSubmit = async (pipelineData: IngestionPipeline) => {
    const updatedPipelines = await saveClientPipeline(currentClient.id, pipelineData);
    if (Array.isArray(updatedPipelines)) {
      currentClient.pipelines = updatedPipelines;
    }
    addLog('success', `✅ Successfully saved pipeline stream: "${pipelineData.name}"`);
  };

  const handleDeletePipelineSubmit = async (pipelineId: string, pipelineName: string) => {
    if (!confirm(`Are you sure you want to delete pipeline "${pipelineName}"?`)) return;
    try {
      const updatedPipelines = await deleteClientPipeline(currentClient.id, pipelineId);
      if (Array.isArray(updatedPipelines)) {
        currentClient.pipelines = updatedPipelines;
      }
      addLog('info', `🗑️ Deleted pipeline "${pipelineName}" for ${currentClient.name}`);
    } catch (err: any) {
      addLog('error', `Failed to delete pipeline: ${err.message}`);
    }
  };

  const [triggeringPipeId, setTriggeringPipeId] = useState<string | null>(null);

  const handleTriggerStream = async (pipelineId: string, pipelineName: string) => {
    setTriggeringPipeId(pipelineId);
    addLog('info', `⚡ [STREAM TRIGGER] Initiating execution for stream "${pipelineName}" (${selectedMonth} ${selectedYear})...`);
    try {
      const result = await triggerClientPipeline(currentClient.id, pipelineId, {
        month: selectedMonth,
        year: selectedYear,
      });
      addLog('success', `✅ Stream "${pipelineName}" completed: ${result.items_extracted || 0} items extracted, ${result.sources_discovered || 0} sources.`);
      await loadTransactions();
    } catch (err: any) {
      addLog('error', `❌ Stream "${pipelineName}" execution failed: ${err.message}`);
    } finally {
      setTriggeringPipeId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Client Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-3xl shadow-lg shrink-0">
              {clientConfig.icon || currentClient.icon}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-extrabold text-white tracking-tight">{clientConfig.name || currentClient.name}</h1>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                    clientConfig.status === 'live'
                      ? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300'
                      : clientConfig.status === 'dev'
                      ? 'bg-sky-950/80 border border-sky-500/40 text-sky-300'
                      : 'bg-amber-950/80 border border-amber-500/40 text-amber-300'
                  }`}
                >
                  {clientConfig.status === 'live' ? 'Production Live' : 'In Development'}
                </span>
                {(() => {
                  const currentSoftId = (clientConfig as any).accounting_software || currentClient.accounting_software || 'zoho_books';
                  const currentPlatform = ACCOUNTING_PLATFORMS.find((p) => p.id === currentSoftId) || ACCOUNTING_PLATFORMS[0];
                  return (
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold flex items-center gap-1 ${
                        currentPlatform.status === 'live'
                          ? 'bg-emerald-950/60 border border-emerald-500/30 text-emerald-300'
                          : 'bg-amber-950/60 border border-amber-500/30 text-amber-300'
                      }`}
                    >
                      <span>{currentPlatform.icon}</span>
                      <span>{currentPlatform.name}</span>
                      <span className="text-[9px] opacity-75">({currentPlatform.status === 'live' ? 'Live' : 'In Progress'})</span>
                    </span>
                  );
                })()}
              </div>
              <p className="text-xs text-sky-400 font-medium mt-0.5">{clientConfig.industry || currentClient.industry}</p>
              <p className="text-xs text-slate-400 mt-2 max-w-3xl">{clientConfig.description || currentClient.desc}</p>
            </div>
          </div>

          {/* Action Trigger Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setActiveTab('clients')}
              className="flex items-center gap-1.5 bg-slate-950 hover:bg-slate-850 border border-slate-800 text-slate-300 text-xs font-semibold px-3 py-2.5 rounded-xl transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>All Clients</span>
            </button>

            <button
              onClick={() => setIsWizardOpen(true)}
              className="flex items-center gap-1.5 bg-sky-950/60 hover:bg-sky-900/60 border border-sky-500/40 text-sky-300 text-xs font-semibold px-3.5 py-2.5 rounded-xl transition cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Setup Wizard &amp; Guide</span>
            </button>

            <button
              onClick={() => setIsConfigOpen(!isConfigOpen)}
              className={`flex items-center gap-1.5 border text-xs font-semibold px-3.5 py-2.5 rounded-xl transition cursor-pointer ${
                isConfigOpen
                  ? 'bg-sky-600 border-sky-500 text-white'
                  : 'bg-slate-950 hover:bg-slate-850 border-slate-800 text-sky-300'
              }`}
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span>Client Settings</span>
            </button>

            <button
              onClick={handleTestProbe}
              disabled={isProbing}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold px-3.5 py-2.5 rounded-xl transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isProbing ? 'animate-spin' : ''}`} />
              <span>{isProbing ? 'Probing...' : 'Test Ingestion'}</span>
            </button>

            <button
              onClick={handleSimulateRun}
              disabled={isRunning}
              className="flex items-center gap-1.5 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-bold px-5 py-2.5 rounded-xl shadow-lg shadow-sky-600/30 transition cursor-pointer disabled:opacity-50"
            >
              {isRunning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Executing Pipeline...</span>
                </>
              ) : (
                <>
                  <PlayCircle className="w-4 h-4" />
                  <span>Run Pipeline Ingestion</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Ingestion Probe Result Banner */}
        {probeResult && (
          <div
            className={`mt-4 p-3.5 rounded-xl border flex items-center gap-3 text-xs ${
              probeResult.success
                ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
            }`}
          >
            {probeResult.success ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
            )}
            <div className="flex-1">
              <span className="font-bold">{probeResult.status || (probeResult.success ? 'CONNECTED' : 'FAILED')}: </span>
              <span>{probeResult.message}</span>
            </div>
          </div>
        )}

        {/* Execution Result Banner */}
        {executionResult && (
          <div
            className={`mt-4 p-4 rounded-xl border ${
              executionResult.status === 'COMPLETED'
                ? 'bg-sky-950/70 border-sky-500/50 text-sky-200'
                : 'bg-rose-950/70 border-rose-500/50 text-rose-200'
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
                  {executionResult.status === 'COMPLETED' ? 'Pipeline Execution Successful' : 'Execution Notice'}
                </span>
              </div>
              <span className="text-xs font-mono text-slate-400">
                {executionResult.month} {executionResult.year}
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1">{executionResult.message}</p>

            {executionResult.status === 'COMPLETED' && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-sky-900/60 text-xs">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Sources Discovered</span>
                  <span className="font-bold text-white text-sm">{executionResult.sources_discovered || 1} Document(s)</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Extracted Items</span>
                  <span className="font-bold text-emerald-300 text-sm">{executionResult.items_extracted || 0} Transactions</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Total Amount</span>
                  <span className="font-bold text-white text-sm">GHS {Number(executionResult.total_amount || 0).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Ledger Status</span>
                  <span className="font-bold text-sky-400 text-sm">Staged in PostgreSQL</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dedicated Client Configuration Panel (Collapsible / Modal) */}
      {isConfigOpen && (
        <div className="bg-slate-900 border border-sky-500/40 rounded-2xl p-6 shadow-2xl backdrop-blur-xl animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-4 mb-6 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <Sliders className="w-5 h-5 text-sky-400" />
              <div>
                <h2 className="text-base font-bold text-white tracking-tight">
                  Isolated Client Configuration: {clientConfig.name}
                </h2>
                <p className="text-xs text-slate-400">
                  Dedicated ingestion parameters, target accounting credentials, and Chart of Accounts for {currentClient.id}.
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsConfigOpen(false)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSaveConfig} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Section 1: Ingestion Channel */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-sky-400 text-xs font-bold uppercase tracking-wider">
                  <Cloud className="w-4 h-4" />
                  <span>1. Ingestion Channel</span>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">Source Ingestion Method</label>
                  <select
                    value={clientConfig.source_type}
                    onChange={(e) => setClientConfig({ ...clientConfig, source_type: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                  >
                    <option value="google_drive">Google Drive (Folder Polling)</option>
                    <option value="onedrive">Microsoft OneDrive / SharePoint</option>
                    <option value="email">Inbound Email Forwarding</option>
                    <option value="bank_feed">Automated Bank Feed / Statements</option>
                    <option value="manual">Manual Direct Upload</option>
                    <option value="webhook">REST API Webhook</option>
                  </select>
                </div>

                {clientConfig.source_type === 'google_drive' && (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">Google Drive Folder ID</label>
                    <input
                      type="text"
                      placeholder="e.g. 1a2b3c4d5e6f7g8h9"
                      value={clientConfig.folder_id}
                      onChange={(e) => setClientConfig({ ...clientConfig, folder_id: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                    />
                  </div>
                )}

                {clientConfig.source_type === 'onedrive' && (
                  <>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                        OneDrive / SharePoint Folder URL or Path
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. https://service4limitedcompany.sharepoint.com/sites/s4bookkeeping/Shared%20Documents/General/Opera%20square/Ingestion"
                        value={clientConfig.folder_id || clientConfig.source_config?.folder_path || clientConfig.source_config?.drive_id || ''}
                        onChange={(e) =>
                          setClientConfig({
                            ...clientConfig,
                            folder_id: e.target.value,
                            source_config: {
                              ...clientConfig.source_config,
                              folder_path: e.target.value,
                              drive_id: e.target.value,
                            },
                          })
                        }
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                      />
                      <span className="text-[10px] text-slate-500 mt-0.5 block">
                        Accepts full SharePoint folder web URLs directly copied from your browser.
                      </span>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1">Azure Tenant ID</label>
                      <input
                        type="text"
                        placeholder="e.g. 883a48e7-..."
                        value={clientConfig.source_config?.tenant_id || ''}
                        onChange={(e) =>
                          setClientConfig({
                            ...clientConfig,
                            source_config: { ...clientConfig.source_config, tenant_id: e.target.value },
                          })
                        }
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1">Azure Client ID</label>
                      <input
                        type="text"
                        placeholder="e.g. 9f8e7d6c-..."
                        value={clientConfig.source_config?.client_id || ''}
                        onChange={(e) =>
                          setClientConfig({
                            ...clientConfig,
                            source_config: { ...clientConfig.source_config, client_id: e.target.value },
                          })
                        }
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1">Client Secret</label>
                      <input
                        type="password"
                        placeholder="••••••••••••••••"
                        value={clientConfig.source_config?.client_secret || ''}
                        onChange={(e) =>
                          setClientConfig({
                            ...clientConfig,
                            source_config: { ...clientConfig.source_config, client_secret: e.target.value },
                          })
                        }
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">Dedicated Inbound Email</label>
                  <input
                    type="email"
                    placeholder="e.g. polaris@inbound.service4gh.com"
                    value={clientConfig.source_email}
                    onChange={(e) => setClientConfig({ ...clientConfig, source_email: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              {/* Section 2: Target Accounting Software Target */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                  <Database className="w-4 h-4" />
                  <span>2. Target Accounting Platform</span>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">Organization / Tenant / Realm ID</label>
                  <input
                    type="text"
                    placeholder="e.g. 782910482 / 9341452891048201 / tenant_01"
                    value={clientConfig.zoho_org_id}
                    onChange={(e) => setClientConfig({ ...clientConfig, zoho_org_id: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Fallback Customer ID <span className="text-[10px] text-slate-500 font-normal">(Optional - S4 automatically matches customer names via Accounting API)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. cnt_default (optional)"
                    value={clientConfig.zoho_contact_id}
                    onChange={(e) => setClientConfig({ ...clientConfig, zoho_contact_id: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">Default Expense / Revenue Account</label>
                  <input
                    type="text"
                    placeholder="e.g. 60020 - Cloud Infrastructure"
                    value={clientConfig.custom_config?.default_account || ''}
                    onChange={(e) =>
                      setClientConfig({
                        ...clientConfig,
                        custom_config: { ...clientConfig.custom_config, default_account: e.target.value },
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Section 3: AI Vision & Rules */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider">
                  <Sparkles className="w-4 h-4" />
                  <span>3. Extraction & Policy</span>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">Environment Status</label>
                  <select
                    value={clientConfig.status}
                    onChange={(e) => setClientConfig({ ...clientConfig, status: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="live">Production Live (Auto Active)</option>
                    <option value="dev">In Development / Staging</option>
                    <option value="pending">Pending Client Onboarding</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">Anomaly Discrepancy Tolerance (%)</label>
                  <input
                    type="number"
                    step="0.5"
                    placeholder="e.g. 5.0"
                    value={clientConfig.custom_config?.discrepancy_tolerance_pct || 5.0}
                    onChange={(e) =>
                      setClientConfig({
                        ...clientConfig,
                        custom_config: {
                          ...clientConfig.custom_config,
                          discrepancy_tolerance_pct: parseFloat(e.target.value) || 5.0,
                        },
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">Custom Vision Prompt Instructions</label>
                  <textarea
                    rows={2}
                    placeholder="e.g. Prioritize handwritten meter readings and tax numbers."
                    value={clientConfig.custom_config?.prompt_notes || ''}
                    onChange={(e) =>
                      setClientConfig({
                        ...clientConfig,
                        custom_config: { ...clientConfig.custom_config, prompt_notes: e.target.value },
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
            </div>

            {/* Footer Action Buttons */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              <div className="text-xs text-slate-400">
                {configSaveSuccess && (
                  <span className="text-emerald-400 font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    Configuration saved into PostgreSQL successfully!
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsConfigOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingConfig}
                  className="flex items-center gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold px-5 py-2 rounded-xl shadow-lg shadow-emerald-600/30 transition cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingConfig ? 'Saving...' : 'Save Configuration'}</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Pipeline Navigation Selector */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPipelineView('AR')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              pipelineView === 'AR'
                ? 'bg-sky-600 text-white shadow-lg shadow-sky-600/30'
                : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>Accounts Receivable (AR)</span>
          </button>

          <button
            onClick={() => setPipelineView('AP')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              pipelineView === 'AP'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <DollarSign className="w-4 h-4" />
            <span>Accounts Payable (AP)</span>
          </button>

          <button
            onClick={() => setPipelineView('BANK')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              pipelineView === 'BANK'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
                : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Landmark className="w-4 h-4" />
            <span>Bank Reconciliation &amp; Client Portal</span>
          </button>
        </div>

        {pipelineView === 'BANK' && (
          <button
            onClick={() => setActiveTab('portal')}
            className="flex items-center gap-1.5 bg-indigo-950/60 hover:bg-indigo-900/60 border border-indigo-500/40 text-indigo-300 text-xs font-semibold px-3 py-1.5 rounded-xl transition cursor-pointer"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Preview Client Portal</span>
          </button>
        )}
      </div>

      {/* VIEW 1: Accounts Receivable (AR) */}
      {pipelineView === 'AR' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <h2 className="text-base font-bold text-white tracking-tight">
                Accounts Receivable Ledger &amp; Staged Slips
              </h2>
              <span className="bg-slate-800 text-slate-300 text-[11px] font-mono font-bold px-2 py-0.5 rounded-full">
                {transactions.filter((t) => t.pipeline_type !== 'AP').length} staged
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={loadTransactions}
                disabled={isLoadingTx}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                title="Refresh ledger"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingTx ? 'animate-spin' : ''}`} />
              </button>

              <button
                onClick={handleBatchApprove}
                disabled={isApproving || transactions.length === 0}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow-lg shadow-emerald-600/20 transition cursor-pointer disabled:opacity-50"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>{isApproving ? 'Approving...' : '1-Click Approve All'}</span>
              </button>
            </div>
          </div>

          {transactions.filter((t) => t.pipeline_type !== 'AP').length === 0 ? (
            <div className="text-center py-10 bg-slate-950/50 rounded-xl border border-dashed border-slate-800">
              <FileText className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-300">No staged AR transactions yet.</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                Click <strong className="text-sky-400">"Run Pipeline Ingestion"</strong> above to extract and stage laundry/sales slips for {currentClient.name}.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-slate-400 uppercase font-mono text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-3">Date</th>
                    <th className="py-3 px-3">Customer / Slip Description</th>
                    <th className="py-3 px-3">Category / Zoho Account</th>
                    <th className="py-3 px-3 text-right">Debit</th>
                    <th className="py-3 px-3 text-right">Credit / Total</th>
                    <th className="py-3 px-3 text-center">Confidence</th>
                    <th className="py-3 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  {transactions
                    .filter((t) => t.pipeline_type !== 'AP')
                    .map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-800/40 transition">
                        <td className="py-3 px-3 text-slate-400 font-mono">{tx.transaction_date}</td>
                        <td className="py-3 px-3 text-white font-semibold">{tx.item_or_description}</td>
                        <td className="py-3 px-3 text-sky-400">{tx.category_or_account || 'Laundry Revenue'}</td>
                        <td className="py-3 px-3 text-right text-rose-400 font-mono">
                          {tx.quantity_or_debit > 0 ? `GHS ${tx.quantity_or_debit.toFixed(2)}` : '—'}
                        </td>
                        <td className="py-3 px-3 text-right text-emerald-400 font-mono font-bold">
                          {tx.credit_amount > 0 ? `GHS ${tx.credit_amount.toFixed(2)}` : `GHS ${tx.total_amount.toFixed(2)}`}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className="bg-emerald-950 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full text-[10px] font-bold">
                            {((tx.confidence_score || 0.98) * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold inline-flex items-center gap-1 ${
                              tx.approved
                                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'
                                : 'bg-amber-950/80 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            {tx.approved ? <Check className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
                            {tx.approved ? 'APPROVED' : tx.status || 'PENDING'}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: Accounts Payable (AP) */}
      {pipelineView === 'AP' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-indigo-400" />
                <h2 className="text-base font-bold text-white tracking-tight">Accounts Payable (Vendor Bills)</h2>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Ingest vendor invoices via Gemini OCR, automatically map vendors in your accounting platform, and post draft bills.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-300 bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl cursor-pointer">
                <input
                  type="checkbox"
                  checked={isAutoPostDraft}
                  onChange={(e) => setIsAutoPostDraft(e.target.checked)}
                  className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                />
                <span>Auto-Post Draft Bills to Accounting Platform</span>
              </label>

              <button
                onClick={handleRunApPipeline}
                disabled={isRunning}
                className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-lg shadow-indigo-600/30 transition cursor-pointer disabled:opacity-50"
              >
                {isRunning ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <PlayCircle className="w-4 h-4" />
                )}
                <span>Run AP Bill Pipeline</span>
              </button>
            </div>
          </div>

          {/* Staged AP Transactions */}
          {transactions.filter((t) => t.pipeline_type === 'AP').length === 0 ? (
            <div className="text-center py-10 bg-slate-950/50 rounded-xl border border-dashed border-slate-800">
              <FileText className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-300">No AP vendor bills staged yet.</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                Click <strong className="text-indigo-400">"Run AP Bill Pipeline"</strong> to scan client Google Drive for incoming supplier bills and invoices.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-slate-400 uppercase font-mono text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-3">Bill Date</th>
                    <th className="py-3 px-3">Vendor / Invoice</th>
                    <th className="py-3 px-3">File Source</th>
                    <th className="py-3 px-3 text-right">Bill Total</th>
                    <th className="py-3 px-3 text-center">Accounting Bill Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  {transactions
                    .filter((t) => t.pipeline_type === 'AP')
                    .map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-800/40 transition">
                        <td className="py-3 px-3 text-slate-400 font-mono">{tx.transaction_date}</td>
                        <td className="py-3 px-3 text-white font-semibold">{tx.item_or_description}</td>
                        <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">{tx.source_file_name}</td>
                        <td className="py-3 px-3 text-right text-indigo-400 font-mono font-bold">
                          GHS {tx.total_amount.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              tx.status === 'INVOICED'
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                                : 'bg-amber-950 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            {tx.status === 'INVOICED' ? 'Draft Bill Posted' : 'Pending Review'}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* VIEW 3: Bank Reconciliation & Client Portal */}
      {pipelineView === 'BANK' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-xl space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <Landmark className="w-5 h-5 text-emerald-400" />
                <h2 className="text-base font-bold text-white tracking-tight">Bank Statements &amp; Clarification Queries</h2>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Upload bank statements (PDF, CSV, Excel). For unmapped transactions, post queries to the client clarification portal.
              </p>
            </div>

            {/* Statement Upload Box */}
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-lg shadow-emerald-600/20 transition cursor-pointer">
                <UploadCloud className="w-4 h-4" />
                <span>{isUploadingStatement ? 'Ingesting Statement...' : 'Upload Bank Statement'}</span>
                <input
                  type="file"
                  accept=".csv,.pdf,.xlsx,.xls"
                  onChange={handleFileUpload}
                  disabled={isUploadingStatement}
                  className="hidden"
                />
              </label>

              <button
                onClick={loadBankTransactions}
                disabled={isLoadingBankTx}
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                title="Refresh bank transactions"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingBankTx ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {uploadMessage && (
            <div className="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{uploadMessage}</span>
            </div>
          )}

          {/* Bank Transactions Table */}
          {isLoadingBankTx ? (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
              <p className="text-xs">Loading bank statement ledger...</p>
            </div>
          ) : bankTransactions.length === 0 ? (
            <div className="text-center py-10 bg-slate-950/50 rounded-xl border border-dashed border-slate-800">
              <Landmark className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-300">No bank statement lines uploaded yet.</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                Upload a monthly bank statement (PDF or CSV) to extract and reconcile transactions.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {bankTransactions.map((tx) => {
                const isAnswered = tx.status === 'CLIENT_ANSWERED';
                const isMapped = tx.status === 'MAPPED';
                const isClarificationRequested = tx.status === 'CLARIFICATION_REQUESTED';

                return (
                  <div
                    key={tx.id}
                    className={`bg-slate-950/70 border rounded-xl p-4 transition ${
                      isMapped
                        ? 'border-emerald-500/30'
                        : isAnswered
                        ? 'border-teal-500/40 bg-teal-950/10'
                        : isClarificationRequested
                        ? 'border-amber-500/40'
                        : 'border-slate-800'
                    }`}
                  >
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-slate-400">{tx.transaction_date}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              tx.transaction_type === 'CREDIT'
                                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                            }`}
                          >
                            {tx.transaction_type === 'CREDIT' ? 'Inflow (+)' : 'Outflow (-)'}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              isMapped
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                                : isAnswered
                                ? 'bg-teal-950 text-teal-300 border border-teal-500/30'
                                : isClarificationRequested
                                ? 'bg-amber-950 text-amber-300 border border-amber-500/30'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {isMapped
                              ? 'MAPPED'
                              : isAnswered
                              ? 'CLIENT ANSWERED'
                              : isClarificationRequested
                              ? 'AWAITING CLIENT'
                              : 'UNMAPPED'}
                          </span>
                        </div>

                        <h4 className="text-sm font-bold text-white mt-1">{tx.description}</h4>

                        {/* Client Written Explanation */}
                        {tx.client_explanation && (
                          <div className="mt-2 p-2.5 bg-teal-950/40 border border-teal-500/30 rounded-lg text-xs text-teal-200">
                            <span className="font-bold text-teal-300">Client's Explanation: </span>
                            {tx.client_explanation}
                          </div>
                        )}

                        {/* Accountant Question */}
                        {tx.accountant_query && (
                          <div className="mt-1 p-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-400">
                            <span className="font-bold text-slate-300">Your Query: </span>
                            {tx.accountant_query}
                          </div>
                        )}
                      </div>

                      {/* Amount */}
                      <div className="text-right shrink-0">
                        <p
                          className={`text-base font-mono font-extrabold ${
                            tx.transaction_type === 'CREDIT' ? 'text-emerald-400' : 'text-slate-200'
                          }`}
                        >
                          {tx.transaction_type === 'CREDIT' ? '+' : '-'}GHS {tx.amount.toFixed(2)}
                        </p>
                        {tx.mapped_account_id && (
                          <p className="text-[11px] text-sky-400 font-mono">Account: {tx.mapped_account_id}</p>
                        )}
                      </div>
                    </div>

                    {/* Accountant Action Form */}
                    {!isMapped && (
                      <div className="mt-3 pt-3 border-t border-slate-900 grid grid-cols-1 md:grid-cols-2 gap-3">
                        {/* Ask Client Query */}
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={queryInputs[tx.id] || ''}
                            onChange={(e) => setQueryInputs((prev) => ({ ...prev, [tx.id]: e.target.value }))}
                            placeholder="Ask client for details / receipt..."
                            className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                          />
                          <button
                            onClick={() => handleSendQuery(tx.id)}
                            disabled={!queryInputs[tx.id]?.trim()}
                            className="bg-amber-950/80 hover:bg-amber-900 border border-amber-500/40 text-amber-300 text-xs font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-40"
                          >
                            Ask Client
                          </button>
                        </div>

                        {/* Map to General Ledger Account */}
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={mappingInputs[tx.id] || ''}
                            onChange={(e) => setMappingInputs((prev) => ({ ...prev, [tx.id]: e.target.value }))}
                            placeholder="General Ledger Expense Account (e.g. 5001 - Supplies)..."
                            className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                          />
                          <button
                            onClick={() => handleMapAccount(tx.id)}
                            disabled={!mappingInputs[tx.id]?.trim()}
                            className="bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/40 text-emerald-300 text-xs font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-40"
                          >
                            Map &amp; Reconcile
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Active Ingestion Pipelines Hub */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-xl space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Active Ingestion Pipelines</h2>
              <p className="text-xs text-slate-400">
                Manage entity-driven ingestion streams for AR, AP, and Banking with pipeline-level configurations.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-sky-500/15 border border-sky-500/30 text-sky-300 font-mono font-bold px-2.5 py-1 rounded-full">
              {(currentClient.pipelines || []).length} Pipelines
            </span>
            <button
              type="button"
              onClick={handleOpenNewPipeline}
              className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold px-3 py-1.5 rounded-xl shadow-lg shadow-sky-600/20 transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Pipeline</span>
            </button>
          </div>
        </div>

        {(currentClient.pipelines || []).length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {currentClient.pipelines?.map((pipe, idx) => {
              const sectionBadge =
                pipe.section === 'AR'
                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                  : pipe.section === 'AP'
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : pipe.section === 'BANK'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-purple-500/20 text-purple-300 border-purple-500/40';

              return (
                <div
                  key={pipe.id || idx}
                  className="bg-slate-950/70 border border-slate-800/90 hover:border-slate-700 rounded-xl p-4 flex flex-col justify-between space-y-3 transition group relative"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${sectionBadge}`}>
                        {pipe.section} • {pipe.entity_type?.replace(/_/g, ' ')}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEditPipeline(pipe)}
                          className="p-1 rounded-lg text-slate-400 hover:text-sky-400 hover:bg-slate-800 transition cursor-pointer"
                          title="Edit Pipeline Configuration"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePipelineSubmit(pipe.id, pipe.name)}
                          className="p-1 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition cursor-pointer"
                          title="Delete Pipeline"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${pipe.is_active !== false ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-slate-500'}`} />
                      <span>{pipe.name}</span>
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-slate-800 text-sky-300 border border-slate-700 flex items-center gap-1">
                        {pipe.trigger_type === 'realtime_webhook' ? (
                          <>⚡ Real-Time Webhook</>
                        ) : pipe.trigger_type === 'manual_only' ? (
                          <>🖱️ Manual On-Demand</>
                        ) : (
                          <>⏰ {pipe.cron_schedule_human || 'Daily @ 8:00 PM'}</>
                        )}
                      </span>
                      {pipe.total_runs_count ? (
                        <span className="text-[10px] text-slate-500 font-mono">
                          {pipe.total_runs_count} runs
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Channel: <code className="text-sky-300 font-mono">{pipe.source_type}</code>
                      {pipe.source_identifier && (
                        <span className="text-slate-500 block truncate text-[10px] font-mono mt-0.5">
                          Target: {pipe.source_identifier}
                        </span>
                      )}
                    </p>
                    {pipe.default_account_code && (
                      <p className="text-[10px] text-slate-400 mt-1">
                        Account: <span className="text-slate-300 font-mono">{pipe.default_account_code}</span>
                      </p>
                    )}
                  </div>
                  
                  <div className="pt-2 border-t border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span>Target: Zoho API</span>
                      <span className={pipe.auto_post_to_zoho ? 'text-emerald-400 font-bold' : 'text-amber-400 font-medium'}>
                        {pipe.auto_post_to_zoho ? 'Auto-Post Live' : 'Review Ledger'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleTriggerStream(pipe.id, pipe.name)}
                      disabled={triggeringPipeId === pipe.id}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 hover:text-white border border-sky-500/30 text-[11px] font-bold transition cursor-pointer disabled:opacity-50"
                    >
                      {triggeringPipeId === pipe.id ? (
                        <RefreshCw className="w-3 h-3 animate-spin text-sky-400" />
                      ) : (
                        <PlayCircle className="w-3 h-3 text-sky-400" />
                      )}
                      <span>{triggeringPipeId === pipe.id ? 'Running Stream...' : 'Trigger Stream Now'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-slate-950/50 border border-slate-800/60 rounded-xl p-4 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
            <span>No discrete multi-pipelines configured. Operating on primary <code className="text-sky-300">{currentClient.sourceType || 'google_drive'}</code> stream.</span>
            <button
              type="button"
              onClick={handleOpenNewPipeline}
              className="text-xs font-bold text-sky-400 hover:text-sky-300 underline cursor-pointer"
            >
              + Add your first ingestion stream
            </button>
          </div>
        )}
      </div>

      {/* Pipeline Setup Wizard Modal */}
      <PipelineSetupWizardModal
        isOpen={isPipelineModalOpen}
        onClose={() => setIsPipelineModalOpen(false)}
        onSave={handleSavePipelineSubmit}
        clientId={currentClient.id}
        clientName={currentClient.name}
        initialPipeline={editingPipeline}
        targetAccountingSoftware={(clientConfig as any).accounting_software || currentClient.accounting_software}
      />

      {/* Blueprint Architecture Steps */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-xl">
        <div className="flex items-center gap-2 mb-4">
          <Layers className="w-5 h-5 text-sky-400" />
          <h2 className="text-base font-bold text-white tracking-tight">Automation Architecture Blueprint</h2>
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
                          <Sparkles className="w-3 h-3 text-sky-400" /> Developing
                        </>
                      ) : (
                        <>
                          <Clock className="w-3 h-3" /> Queued
                        </>
                      )}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1">{step.title}</h3>
                  <p className="text-xs text-slate-400">{step.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Connected Integrations */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-xl">
        <h2 className="text-base font-bold text-white mb-3">Configured Integrations &amp; Storage</h2>
        <div className="flex flex-wrap gap-2">
          {currentClient.activeIntegrations?.map((intg, i) => (
            <div
              key={i}
              className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-semibold text-slate-200"
            >
              <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
              <span>{intg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
