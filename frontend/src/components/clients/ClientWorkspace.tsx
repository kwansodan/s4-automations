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
} from '../../lib/api';
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
} from 'lucide-react';

export const ClientWorkspace: React.FC = () => {
  const { currentClient, setIsWizardOpen } = useClient();
  const { setActiveTab, addLog } = useAutomation();

  const [isRunning, setIsRunning] = useState(false);
  const [executionResult, setExecutionResult] = useState<any | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoadingTx, setIsLoadingTx] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<any | null>(null);
  const [selectedTxIds, setSelectedTxIds] = useState<number[]>([]);
  const [isApproving, setIsApproving] = useState(false);

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

  useEffect(() => {
    setExecutionResult(null);
    setProbeResult(null);
    setSelectedTxIds([]);
    setIsConfigOpen(false);
    loadTransactions();
    loadClientConfiguration();
  }, [currentClient.id]);

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
              <div className="flex items-center gap-2">
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
                  Dedicated ingestion parameters, Zoho Books credentials, and Chart of Accounts for {currentClient.id}.
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
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1">OneDrive Folder Path</label>
                      <input
                        type="text"
                        placeholder="e.g. /Accounting/2026/Invoices"
                        value={clientConfig.source_config?.folder_path || ''}
                        onChange={(e) =>
                          setClientConfig({
                            ...clientConfig,
                            source_config: { ...clientConfig.source_config, folder_path: e.target.value },
                          })
                        }
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1">Azure Tenant ID (Optional)</label>
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

              {/* Section 2: Zoho Books Accounting Target */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                  <Database className="w-4 h-4" />
                  <span>2. Zoho Books Target</span>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">Zoho Organization ID</label>
                  <input
                    type="text"
                    placeholder="e.g. 782910482"
                    value={clientConfig.zoho_org_id}
                    onChange={(e) => setClientConfig({ ...clientConfig, zoho_org_id: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Fallback Customer ID <span className="text-[10px] text-slate-500 font-normal">(Optional - S4 automatically matches customer names via Zoho Books API)</span>
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

      {/* Staged Review Ledger (Live Data) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white tracking-tight">
              PostgreSQL Review Ledger & Staged Transactions
            </h2>
            <span className="bg-slate-800 text-slate-300 text-[11px] font-mono font-bold px-2 py-0.5 rounded-full">
              {transactions.length} staged
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

        {transactions.length === 0 ? (
          <div className="text-center py-10 bg-slate-950/50 rounded-xl border border-dashed border-slate-800">
            <FileText className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-300">No staged transactions yet.</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Click <strong className="text-sky-400">"Run Pipeline Ingestion"</strong> above to extract and stage transactions for {currentClient.name}.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400 uppercase font-mono text-[10px] border-b border-slate-800">
                <tr>
                  <th className="py-3 px-3">Date</th>
                  <th className="py-3 px-3">Description / Narrative</th>
                  <th className="py-3 px-3">Category / Zoho Account</th>
                  <th className="py-3 px-3 text-right">Debit</th>
                  <th className="py-3 px-3 text-right">Credit / Total</th>
                  <th className="py-3 px-3 text-center">Confidence</th>
                  <th className="py-3 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-3 text-slate-400 font-mono">{tx.transaction_date}</td>
                    <td className="py-3 px-3 text-white font-semibold">{tx.item_or_description}</td>
                    <td className="py-3 px-3 text-sky-400">{tx.category_or_account || 'General Expense'}</td>
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

      {/* Blueprint Architecture Steps */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-xl">
        <div className="flex items-center gap-2 mb-4">
          <Layers className="w-5 h-5 text-sky-400" />
          <h2 className="text-base font-bold text-white tracking-tight">Automation Architecture Blueprint</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {currentClient.blueprints?.map((step, idx) => {
            const isActive = step.status === 'active';
            const isInProgress = step.status === 'in_progress';

            return (
              <div
                key={idx}
                className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] uppercase font-mono font-bold text-slate-500">
                      Phase 0{idx + 1}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                        isActive
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                          : isInProgress
                          ? 'bg-sky-950 text-sky-300 border border-sky-500/30'
                          : 'bg-slate-900 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {isActive ? (
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
        <h2 className="text-base font-bold text-white mb-3">Configured Integrations & Storage</h2>
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
