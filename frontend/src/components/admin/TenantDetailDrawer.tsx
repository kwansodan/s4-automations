import React, { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  Ban,
  Building2,
  CheckCircle2,
  Eye,
  FolderOpen,
  RefreshCw,
  Save,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react';
import {
  fetchAdminOrganizationDetail,
  updateAdminOrganizationSettings,
  updateAdminOrganizationStatus,
} from '../../lib/api';
import type { AdminTenantDetail } from '../../types/admin';
import { useAuth } from '../../context/AuthContext';
import { useAutomation } from '../../context/AutomationContext';

interface TenantDetailDrawerProps {
  orgId: string | null;
  onClose: () => void;
  onUpdated: () => void;
}

export const TenantDetailDrawer: React.FC<TenantDetailDrawerProps> = ({
  orgId,
  onClose,
  onUpdated,
}) => {
  const { startImpersonation } = useAuth();
  const { setActiveTab, setWorkspaceSubTab, addLog } = useAutomation();

  const [detail, setDetail] = useState<AdminTenantDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'settings'>('overview');

  // White-label / BYOS editable settings
  const [name, setName] = useState('');
  const [orgType, setOrgType] = useState('ACCOUNTING_FIRM');
  const [billingEmail, setBillingEmail] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [storageStrategy, setStorageStrategy] = useState('MANAGED_GDRIVE');
  const [gdriveFolderId, setGdriveFolderId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [actionNotice, setActionNotice] = useState('');

  // Impersonation / Suspend reason
  const [operatorReason, setOperatorReason] = useState('Support & configuration review');
  const [isImpersonating, setIsImpersonating] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!orgId) return;
    setIsLoading(true);
    setError('');
    try {
      const res = await fetchAdminOrganizationDetail(orgId);
      setDetail(res);
      setName(res.organization.name || '');
      setOrgType(res.organization.org_type || 'ACCOUNTING_FIRM');
      setBillingEmail(res.organization.billing_email || '');
      setSubdomain(res.organization.custom_portal_subdomain || '');
      setLogoUrl(res.organization.white_label_logo_url || '');
      setStorageStrategy(res.organization.storage_strategy || 'MANAGED_GDRIVE');
      setGdriveFolderId(res.organization.custom_gdrive_folder_id || '');
    } catch (err: any) {
      setError(err.message || 'Failed to load tenant details.');
    } finally {
      setIsLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (orgId) {
      setActionNotice('');
      setActiveSubTab('overview');
      loadDetail();
    }
  }, [orgId, loadDetail]);

  if (!orgId) return null;

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setActionNotice('');
    try {
      await updateAdminOrganizationSettings(orgId, {
        name,
        org_type: orgType,
        billing_email: billingEmail || undefined,
        custom_portal_subdomain: subdomain || undefined,
        white_label_logo_url: logoUrl || undefined,
        storage_strategy: storageStrategy,
        custom_gdrive_folder_id: gdriveFolderId || undefined,
      });
      setActionNotice('Tenant white-label and storage settings updated.');
      await loadDetail();
      onUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed updating settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleSuspend = async () => {
    if (!detail) return;
    const nextActive = !detail.organization.is_active;
    const reasonPrompt = nextActive
      ? 'Platform admin reactivation'
      : operatorReason || 'Suspended by platform admin';
    setIsSaving(true);
    setActionNotice('');
    try {
      await updateAdminOrganizationStatus(orgId, {
        is_active: nextActive,
        subscription_status: nextActive ? 'ACTIVE' : 'SUSPENDED',
        reason: reasonPrompt,
      });
      setActionNotice(nextActive ? 'Tenant organization reactivated.' : 'Tenant organization suspended.');
      await loadDetail();
      onUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed updating tenant status.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleImpersonate = async () => {
    setIsImpersonating(true);
    try {
      const ok = await startImpersonation(orgId, operatorReason);
      if (ok) {
        addLog('info', `Entered View-as-Tenant mode for ${detail?.organization.name || orgId}.`);
        onClose();
        setWorkspaceSubTab('overview');
        setActiveTab('workspace');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to impersonate organization.');
    } finally {
      setIsImpersonating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-2xl bg-white h-full border-l border-[#E2E8F0] shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#F0F9FF] border border-[#BAE6FD] flex items-center justify-center text-[#0284C7] shrink-0">
              <Building2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-[#0F172A] truncate">
                {detail?.organization.name || orgId}
              </h3>
              <p className="text-[11px] font-mono text-[#64748B] truncate">
                ID: {orgId} | {detail?.organization.plan_tier || '...'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sub-nav & Operator Controls */}
        <div className="px-6 py-3 border-b border-[#E2E8F0] bg-white flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setActiveSubTab('overview')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                activeSubTab === 'overview'
                  ? 'bg-[#F0F9FF] text-[#0284C7] border border-[#BAE6FD]'
                  : 'text-[#64748B] hover:bg-slate-50'
              }`}
            >
              Tenant Inspector
            </button>
            <button
              onClick={() => setActiveSubTab('settings')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                activeSubTab === 'settings'
                  ? 'bg-[#F0F9FF] text-[#0284C7] border border-[#BAE6FD]'
                  : 'text-[#64748B] hover:bg-slate-50'
              }`}
            >
              White-Label &amp; BYOS
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleImpersonate}
              disabled={isImpersonating || isLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
            >
              <Eye className="w-3.5 h-3.5" />
              {isImpersonating ? 'Entering...' : 'View as Tenant'}
            </button>
            {detail && (
              <button
                onClick={handleToggleSuspend}
                disabled={isSaving}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer disabled:opacity-60 ${
                  detail.organization.is_active
                    ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'
                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                }`}
              >
                {detail.organization.is_active ? (
                  <>
                    <Ban className="w-3.5 h-3.5" />
                    Suspend
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Reactivate
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {actionNotice && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{actionNotice}</span>
            </div>
          )}

          {isLoading && !detail ? (
            <div className="py-12 text-center">
              <RefreshCw className="w-5 h-5 text-[#0284C7] animate-spin mx-auto mb-2" />
              <p className="text-xs text-[#64748B]">Loading tenant record...</p>
            </div>
          ) : detail && activeSubTab === 'overview' ? (
            <>
              {/* Audit Reason Input for Operator Actions */}
              <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748B] font-mono mb-1">
                  Operator Action / Impersonation Reason
                </label>
                <input
                  type="text"
                  value={operatorReason}
                  onChange={(e) => setOperatorReason(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#E2E8F0] text-xs text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
                />
              </div>

              {/* 30d AI & Quota Summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                  <span className="text-[10px] font-mono uppercase text-[#64748B]">Workspaces</span>
                  <div className="text-lg font-bold text-[#0F172A] font-mono mt-1">
                    {detail.clients.length} / {detail.organization.max_clients}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                  <span className="text-[10px] font-mono uppercase text-[#64748B]">30d Agent Runs</span>
                  <div className="text-lg font-bold text-[#0F172A] font-mono mt-1">
                    {detail.telemetry_30d.agent_runs}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                  <span className="text-[10px] font-mono uppercase text-[#64748B]">30d AI Cost</span>
                  <div className="text-lg font-bold text-[#0284C7] font-mono mt-1">
                    ${detail.telemetry_30d.estimated_cost_usd.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Client Workspaces */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-[#0F172A]">
                  <FolderOpen className="w-4 h-4 text-[#0284C7]" />
                  Client Workspaces ({detail.clients.length})
                </div>
                <div className="border border-[#E2E8F0] rounded-xl divide-y divide-[#E2E8F0] overflow-hidden">
                  {detail.clients.map((c) => (
                    <div key={c.id} className="px-3.5 py-2.5 flex items-center justify-between text-xs bg-white">
                      <div>
                        <p className="font-semibold text-[#0F172A]">{c.name}</p>
                        <p className="text-[11px] font-mono text-[#64748B]">
                          {c.agent_email || c.id}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                            c.agent_enabled
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {c.agent_enabled ? 'Agent ON' : 'Agent OFF'}
                        </span>
                      </div>
                    </div>
                  ))}
                  {detail.clients.length === 0 && (
                    <p className="p-4 text-xs text-[#64748B] text-center">
                      No client workspaces provisioned inside this tenant yet.
                    </p>
                  )}
                </div>
              </div>

              {/* Members */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-[#0F172A]">
                  <Users className="w-4 h-4 text-[#0284C7]" />
                  Memberships ({detail.memberships.length})
                </div>
                <div className="border border-[#E2E8F0] rounded-xl divide-y divide-[#E2E8F0] overflow-hidden">
                  {detail.memberships.map((m) => (
                    <div key={m.id} className="px-3.5 py-2 flex items-center justify-between text-xs bg-white">
                      <div>
                        <p className="font-semibold text-[#0F172A]">{m.name || m.email}</p>
                        <p className="text-[11px] text-[#64748B] font-mono">{m.email}</p>
                      </div>
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-[#E2E8F0] text-[10px] font-bold uppercase text-[#0F172A]">
                        {m.role}
                      </span>
                    </div>
                  ))}
                  {detail.memberships.length === 0 && (
                    <p className="p-4 text-xs text-[#64748B] text-center">
                      No memberships linked directly.
                    </p>
                  )}
                </div>
              </div>

              {/* Recent Tenant Audits */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-[#0F172A]">
                  <Activity className="w-4 h-4 text-[#0284C7]" />
                  Recent Organization Audit Trail
                </div>
                <div className="border border-[#E2E8F0] rounded-xl divide-y divide-[#E2E8F0] overflow-hidden">
                  {detail.recent_audits.map((a) => (
                    <div key={a.id} className="px-3.5 py-2 text-xs bg-white flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-mono font-semibold text-[#0F172A]">{a.action}</span>
                        <span className="text-[#64748B] ml-2">by {a.actor_email}</span>
                      </div>
                      <span className="text-[10px] font-mono text-[#64748B] shrink-0">
                        {a.timestamp ? new Date(a.timestamp).toLocaleDateString() : ''}
                      </span>
                    </div>
                  ))}
                  {detail.recent_audits.length === 0 && (
                    <p className="p-4 text-xs text-[#64748B] text-center">No recent audit entries.</p>
                  )}
                </div>
              </div>
            </>
          ) : detail && activeSubTab === 'settings' ? (
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Organization Display Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-sm text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Organization Mode
                  </label>
                  <select
                    value={orgType}
                    onChange={(e) => setOrgType(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-sm text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
                  >
                    <option value="ACCOUNTING_FIRM">ACCOUNTING_FIRM</option>
                    <option value="INDIVIDUAL_BUSINESS">INDIVIDUAL_BUSINESS</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Billing Contact Email
                  </label>
                  <input
                    type="email"
                    value={billingEmail}
                    onChange={(e) => setBillingEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-sm text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Custom Client Portal Subdomain
                </label>
                <input
                  type="text"
                  value={subdomain}
                  onChange={(e) => setSubdomain(e.target.value)}
                  placeholder="portal.firm.com"
                  className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-sm text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  White-Label Brand Logo URL
                </label>
                <input
                  type="url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-sm text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Storage Strategy (BYOS)
                  </label>
                  <select
                    value={storageStrategy}
                    onChange={(e) => setStorageStrategy(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-sm text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
                  >
                    <option value="MANAGED_GDRIVE">MANAGED_GDRIVE</option>
                    <option value="BYOS_GDRIVE">BYOS_GDRIVE</option>
                    <option value="S4_CLOUD">S4_CLOUD</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Custom Root Google Drive Folder ID
                  </label>
                  <input
                    type="text"
                    value={gdriveFolderId}
                    onChange={(e) => setGdriveFolderId(e.target.value)}
                    placeholder="1AbC..."
                    className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] font-mono text-xs text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-[#E2E8F0] flex justify-end">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                >
                  <Save className="w-3.5 h-3.5" />
                  {isSaving ? 'Saving...' : 'Save White-Label & BYOS Settings'}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
};
