import React, { useState, useEffect } from 'react';
import { useClient } from '../../../context/ClientContext';
import { useAutomation } from '../../../context/AutomationContext';
import {
  fetchClientConfig,
  saveClientConfig,
  getAccountingOAuthAuthorizeUrl,
  getAccountingOAuthStatus,
  disconnectAccountingOAuth,
  type AccountingOAuthStatusResponse,
} from '../../../lib/api';
import { ACCOUNTING_PLATFORMS } from '../../../types/client';
import {
  Settings2,
  Cloud,
  Database,
  Sparkles,
  Key,
  Save,
  CheckCircle2,
  Users,
  Mail,
  MessageSquare,
  AlertTriangle,
  Trash2,
  ShieldCheck,
  Zap,
  ExternalLink,
  RefreshCw,
  Sliders,
  ChevronDown,
} from 'lucide-react';

export const ClientSettingsTab: React.FC = () => {
  const { currentClient, deleteClient } = useClient();
  const { addLog } = useAutomation();

  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configSaveSuccess, setConfigSaveSuccess] = useState(false);
  const [isDeletingOrg, setIsDeletingOrg] = useState(false);

  const activePlatform = (currentClient.accounting_software || 'zoho_books') as 'zoho_books' | 'quickbooks_online' | 'xero';
  const platformMeta = ACCOUNTING_PLATFORMS.find((p) => p.id === activePlatform) || ACCOUNTING_PLATFORMS[0];

  // 1-Click OAuth State
  const [oauthStatus, setOauthStatus] = useState<AccountingOAuthStatusResponse | null>(null);
  const [isLoadingOAuth, setIsLoadingOAuth] = useState(false);
  const [isConnectingOAuth, setIsConnectingOAuth] = useState(false);
  const [isAdvancedOAuthOpen, setIsAdvancedOAuthOpen] = useState(false);

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

  const loadOAuthStatus = async () => {
    setIsLoadingOAuth(true);
    try {
      const res = await getAccountingOAuthStatus(activePlatform, currentClient.id);
      setOauthStatus(res);
    } catch (err) {
      console.warn(`Could not load ${activePlatform} OAuth status:`, err);
    } finally {
      setIsLoadingOAuth(false);
    }
  };

  const loadConfig = async () => {
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
    loadConfig();
    loadOAuthStatus();
  }, [currentClient.id, activePlatform]);

  // Listen for popup success message across platforms
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (
        event.data?.type === 'ZOHO_OAUTH_SUCCESS' ||
        event.data?.type === 'QUICKBOOKS_OAUTH_SUCCESS' ||
        event.data?.type === 'XERO_OAUTH_SUCCESS'
      ) {
        addLog('success', `🎉 1-Click OAuth Connected: ${event.data.orgName} (${event.data.orgId})`);
        loadOAuthStatus();
        loadConfig();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [currentClient.id, activePlatform]);

  const handleLaunchOAuth = async () => {
    setIsConnectingOAuth(true);
    try {
      addLog('info', `[OAUTH] Requesting 1-Click ${platformMeta.name} authorization URL for ${currentClient.name}...`);
      const { authorize_url } = await getAccountingOAuthAuthorizeUrl(activePlatform, currentClient.id);
      
      const width = 640;
      const height = 750;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;

      window.open(
        authorize_url,
        `${activePlatform}_oauth_window`,
        `width=${width},height=${height},top=${top},left=${left},scrollbars=yes,status=no,toolbar=no`
      );
    } catch (err: any) {
      addLog('error', `Failed to initiate ${platformMeta.name} OAuth: ${err.message}`);
      alert(`Could not launch OAuth: ${err.message}`);
    } finally {
      setIsConnectingOAuth(false);
    }
  };

  const handleDisconnectOAuth = async () => {
    if (!confirm(`Are you sure you want to disconnect ${platformMeta.name} for ${currentClient.name}?`)) {
      return;
    }
    try {
      await disconnectAccountingOAuth(activePlatform, currentClient.id);
      addLog('info', `Disconnected ${platformMeta.name} integration for ${currentClient.name}.`);
      await loadOAuthStatus();
      await loadConfig();
    } catch (err: any) {
      addLog('error', `Disconnect failed: ${err.message}`);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingConfig(true);
    setConfigSaveSuccess(false);

    try {
      await saveClientConfig(currentClient.id, clientConfig);
      setConfigSaveSuccess(true);
      addLog('success', `Saved dedicated settings for ${clientConfig.name} (${currentClient.id}).`);
      setTimeout(() => setConfigSaveSuccess(false), 3500);
    } catch (err: any) {
      addLog('error', `Failed saving client configuration: ${err.message}`);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleDeleteOrganisation = async () => {
    const pipeCount = (currentClient.pipelines || []).length;
    if (pipeCount > 0) {
      alert(`Cannot delete organisation "${currentClient.name}" because it contains ${pipeCount} active pipeline stream(s). Delete all streams first.`);
      return;
    }

    const confirmation = prompt(`⚠️ DANGER: You are about to permanently delete organisation "${currentClient.name}".\n\nTo confirm, please type "${currentClient.name}" below:`);
    if (confirmation !== currentClient.name) {
      if (confirmation !== null) alert('Confirmation name did not match. Deletion cancelled.');
      return;
    }

    setIsDeletingOrg(true);
    try {
      await deleteClient(currentClient.id);
      addLog('success', `🗑️ Deleted organisation "${currentClient.name}".`);
    } catch (err: any) {
      alert(`Deletion failed: ${err.message}`);
      addLog('error', `Failed to delete organisation: ${err.message}`);
    } finally {
      setIsDeletingOrg(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header Toolbar */}
      <div className="glass-panel rounded-2xl p-5 shadow-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-bold text-white tracking-tight">
              Client Configuration &amp; Tenant Parameters
            </h2>
            <span className="text-[10px] font-mono font-bold text-sky-400 bg-sky-950/80 border border-sky-500/30 px-2 py-0.5 rounded-full">
              {currentClient.id}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Isolated storage folders, accounting instance API credentials, AI vision extraction prompt notes, and stakeholder notification routing.
          </p>
        </div>

        {configSaveSuccess && (
          <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1.5 bg-emerald-950/80 border border-emerald-500/30 px-3 py-1.5 rounded-xl">
            <CheckCircle2 className="w-4 h-4" />
            Settings saved into database!
          </span>
        )}
      </div>

      {/* Configuration Form */}
      <form onSubmit={handleSaveConfig} className="glass-panel rounded-2xl p-6 shadow-xl border border-slate-800 space-y-6">
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
                    SharePoint / OneDrive Folder URL
                  </label>
                  <input
                    type="text"
                    placeholder="https://..."
                    value={clientConfig.folder_id || clientConfig.source_config?.folder_path || ''}
                    onChange={(e) =>
                      setClientConfig({
                        ...clientConfig,
                        folder_id: e.target.value,
                        source_config: { ...clientConfig.source_config, folder_path: e.target.value },
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">Azure Tenant ID</label>
                  <input
                    type="text"
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
                placeholder="e.g. client@inbound.service4gh.com"
                value={clientConfig.source_email}
                onChange={(e) => setClientConfig({ ...clientConfig, source_email: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          {/* Section 2: Target Accounting Software & 1-Click OAuth */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                <Database className="w-4 h-4" />
                <span>2. Accounting Platform ({platformMeta.name})</span>
              </div>
              {oauthStatus?.is_connected ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 border border-emerald-500/40 text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Connected</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-900 border border-slate-700 text-slate-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                  <span>Not Connected</span>
                </span>
              )}
            </div>

            {/* 1-Click OAuth Connection Card */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-3">
              {oauthStatus?.is_connected ? (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold text-white flex items-center gap-1.5">
                        <span>{platformMeta.icon || '🟢'}</span>
                        <span>{oauthStatus.org_name || currentClient.name}</span>
                      </p>
                      <p className="text-[10px] font-mono text-sky-400 mt-0.5">
                        ID: {oauthStatus.org_id || clientConfig.zoho_org_id || 'Auto-Detected'}
                      </p>
                      {oauthStatus.connected_at && (
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          Authorized: {new Date(oauthStatus.connected_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleLaunchOAuth}
                        disabled={isConnectingOAuth}
                        className="px-2.5 py-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-750 text-slate-200 rounded-lg border border-slate-700 transition cursor-pointer flex items-center gap-1"
                        title={`Re-authenticate with ${platformMeta.name}`}
                      >
                        <RefreshCw className={`w-3 h-3 ${isConnectingOAuth ? 'animate-spin' : ''}`} />
                        <span>Re-auth</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleDisconnectOAuth}
                        className="px-2.5 py-1 text-[11px] font-semibold bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 rounded-lg border border-rose-500/30 transition cursor-pointer"
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <p className="text-xs text-slate-300">
                    Connect this client to their {platformMeta.name} account in 1-Click. No developer app setup or API keys required.
                  </p>
                  
                  <button
                    type="button"
                    onClick={handleLaunchOAuth}
                    disabled={isConnectingOAuth}
                    className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow-lg shadow-emerald-600/25 transition cursor-pointer disabled:opacity-50"
                  >
                    <Zap className={`w-4 h-4 text-emerald-200 ${isConnectingOAuth ? 'animate-bounce' : ''}`} />
                    <span>{isConnectingOAuth ? `Launching ${platformMeta.name} Consent...` : `Connect with ${platformMeta.name} (1-Click)`}</span>
                    <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Default General Ledger Account</label>
              <input
                type="text"
                placeholder="e.g. 60020 - Operating Expenses"
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

            {/* Collapsible Advanced Manual App Keys */}
            <div className="pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsAdvancedOAuthOpen(!isAdvancedOAuthOpen)}
                className="flex items-center justify-between w-full text-[11px] font-bold text-slate-400 hover:text-slate-200 py-1 transition cursor-pointer"
              >
                <div className="flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-sky-400" />
                  <span>Advanced Manual Keys (Optional Override)</span>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isAdvancedOAuthOpen ? 'rotate-180' : ''}`} />
              </button>

              {isAdvancedOAuthOpen && (
                <div className="space-y-2 mt-2 pt-2 border-t border-slate-850 animate-in fade-in duration-150">
                  <p className="text-[10px] text-slate-500">
                    Use only if you wish to override the S4 master app with a custom Self-Client developer app.
                  </p>
                  <input
                    type="text"
                    placeholder="Custom OAuth Client ID"
                    value={clientConfig.custom_config?.zoho_client_id || ''}
                    onChange={(e) =>
                      setClientConfig({
                        ...clientConfig,
                        custom_config: { ...clientConfig.custom_config, zoho_client_id: e.target.value },
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                  />
                  <input
                    type="password"
                    placeholder="Custom OAuth Client Secret"
                    value={clientConfig.custom_config?.zoho_client_secret || ''}
                    onChange={(e) =>
                      setClientConfig({
                        ...clientConfig,
                        custom_config: { ...clientConfig.custom_config, zoho_client_secret: e.target.value },
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                  />
                  <input
                    type="password"
                    placeholder="Custom OAuth Refresh Token"
                    value={clientConfig.custom_config?.zoho_refresh_token || ''}
                    onChange={(e) =>
                      setClientConfig({
                        ...clientConfig,
                        custom_config: { ...clientConfig.custom_config, zoho_refresh_token: e.target.value },
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                  />
                  <input
                    type="text"
                    placeholder="Custom Organization ID"
                    value={clientConfig.zoho_org_id || ''}
                    onChange={(e) => setClientConfig({ ...clientConfig, zoho_org_id: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Section 3: AI Vision & Policies */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider">
              <Sparkles className="w-4 h-4" />
              <span>3. Extraction &amp; Policy</span>
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
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Discrepancy Tolerance (%)</label>
              <input
                type="number"
                step="0.5"
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
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Custom Vision Prompt Notes</label>
              <textarea
                rows={3}
                placeholder="Special OCR instructions, handwritten notes rules..."
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

        {/* Form Footer */}
        <div className="flex items-center justify-end pt-4 border-t border-slate-800">
          <button
            type="submit"
            disabled={isSavingConfig}
            className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold px-6 py-2.5 rounded-xl shadow-lg shadow-emerald-600/30 transition cursor-pointer disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{isSavingConfig ? 'Saving Settings...' : 'Save Configuration'}</span>
          </button>
        </div>
      </form>

      {/* Stakeholders & Notification Routing */}
      <div className="glass-panel rounded-2xl p-6 shadow-xl border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-sky-400" />
            <h3 className="text-base font-bold text-white tracking-tight">
              Organization Stakeholders &amp; Notification Routing
            </h3>
          </div>
          <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-700">
            {(currentClient.team_members || []).length} Stakeholder(s)
          </span>
        </div>

        {(currentClient.team_members && currentClient.team_members.length > 0) ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {currentClient.team_members.map((member) => (
              <div key={member.id} className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-sky-400" />
                    {member.name}
                  </span>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/30">
                    {member.role.replace('_', ' ')}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 space-y-0.5 font-mono">
                  <div className="flex items-center gap-1.5 text-slate-300">
                    <Mail className="w-3 h-3 text-slate-500" />
                    <span>{member.email}</span>
                  </div>
                  {member.phone && (
                    <div className="flex items-center gap-1.5 text-slate-400 text-[10px]">
                      <MessageSquare className="w-3 h-3 text-slate-500" />
                      <span>{member.phone}</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 pt-1.5 border-t border-slate-800">
                  {member.notifications?.executive_digest && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/30">
                      📊 Executive Digest
                    </span>
                  )}
                  {member.notifications?.critical_anomalies && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-500/30">
                      ⚠️ Anomaly Alerts
                    </span>
                  )}
                  {member.notifications?.staged_approvals && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-500/30">
                      ✍️ Sign-off Needed
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-slate-950/40 border border-slate-800/60 rounded-xl p-4 text-xs text-slate-400">
            No specific team members mapped yet. Notifications route to default firm admin email.
          </div>
        )}
      </div>

      {/* Danger Zone: Organisation Deletion Guard */}
      <div className="bg-rose-950/20 border border-rose-500/30 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-400" />
            <h3 className="text-base font-bold text-white tracking-tight">Organisation Danger Zone</h3>
          </div>
          <span className="text-[10px] font-mono font-bold text-rose-300 bg-rose-950 px-2.5 py-1 rounded-lg border border-rose-500/40">
            Integrity Guard
          </span>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          To protect accounting audit integrity, an organisation <strong>cannot be deleted</strong> as long as it has active ingestion streams.
        </p>

        {((currentClient.pipelines || []).length > 0) ? (
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                Organisation Deletion Locked
              </span>
              <p className="text-[11px] text-slate-400">
                This client currently has <strong>{(currentClient.pipelines || []).length} active pipeline stream(s)</strong>. Delete streams in the Pipelines tab first.
              </p>
            </div>
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-600 text-xs font-bold opacity-60 cursor-not-allowed shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Organisation (Locked)</span>
            </button>
          </div>
        ) : (
          <div className="bg-rose-950/40 border border-rose-500/40 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <span className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
                0 Pipeline Streams Active (Deletion Unlocked)
              </span>
              <p className="text-[11px] text-slate-300">
                All streams cleared. You can now safely delete this client organisation.
              </p>
            </div>
            <button
              type="button"
              onClick={handleDeleteOrganisation}
              disabled={isDeletingOrg}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-lg shadow-rose-950/50 cursor-pointer disabled:opacity-50 shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isDeletingOrg ? 'Deleting...' : 'Delete Organisation'}</span>
            </button>
          </div>
        )}
      </div>

    </div>
  );
};
