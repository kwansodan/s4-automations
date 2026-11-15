import React, { useEffect, useState, useCallback } from 'react';
import {
  Building2,
  CheckCircle2,
  CreditCard,
  Eye,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  Sliders,
} from 'lucide-react';
import { fetchCustomerSubscriptions, type CustomerSubscription } from '../../lib/api';
import { AdminBillingSection } from '../billing/AdminBillingSection';
import { TenantDetailDrawer } from './TenantDetailDrawer';
import { useAuth } from '../../context/AuthContext';
import { useAutomation } from '../../context/AutomationContext';

interface AdminTenantsTabProps {
  onOpenCreateTenant: () => void;
  refreshSignal?: number;
}

export const AdminTenantsTab: React.FC<AdminTenantsTabProps> = ({
  onOpenCreateTenant,
  refreshSignal = 0,
}) => {
  const { startImpersonation } = useAuth();
  const { setActiveTab, setWorkspaceSubTab, addLog } = useAutomation();

  const [subView, setSubView] = useState<'directory' | 'billing'>('directory');
  const [tenants, setTenants] = useState<CustomerSubscription[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);

  const loadTenants = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetchCustomerSubscriptions(statusFilter, search);
      setTenants(res.organizations || []);
    } catch (err: any) {
      setError(err.message || 'Failed loading tenant organizations.');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    loadTenants();
  }, [loadTenants, refreshSignal]);

  const handleQuickImpersonate = async (tenant: CustomerSubscription) => {
    setImpersonatingId(tenant.id);
    try {
      const ok = await startImpersonation(tenant.id, `Tenant directory inspection of ${tenant.name}`);
      if (ok) {
        addLog('info', `Entered View-as-Tenant mode for ${tenant.name}.`);
        setWorkspaceSubTab('overview');
        setActiveTab('workspace');
      }
    } catch (err: any) {
      setError(err.message || 'Failed entering View-as-Tenant mode.');
    } finally {
      setImpersonatingId(null);
    }
  };

  const statusBadge = (subStatus: string, isActive: boolean) => {
    if (!isActive || subStatus === 'SUSPENDED') {
      return 'bg-rose-50 text-rose-700 border-rose-200';
    }
    if (subStatus === 'ACTIVE') {
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    }
    if (subStatus === 'TRIALING') {
      return 'bg-amber-50 text-amber-700 border-amber-200';
    }
    return 'bg-slate-100 text-slate-700 border-[#E2E8F0]';
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Header Toolbar */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 shadow-xs">
        <div>
          <h2 className="text-base font-bold text-[#0F172A]">Tenants, Organizations &amp; Billing</h2>
          <p className="text-xs text-[#64748B] mt-0.5">
            Provision tenant accounts, manage white-label / BYOS configuration, impersonate safely, and control subscriptions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSubView('directory')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
              subView === 'directory'
                ? 'bg-[#F0F9FF] text-[#0284C7] border-[#BAE6FD]'
                : 'bg-white text-[#64748B] border-[#E2E8F0] hover:bg-slate-50'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            Tenant Directory ({tenants.length})
          </button>
          <button
            onClick={() => setSubView('billing')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
              subView === 'billing'
                ? 'bg-[#F0F9FF] text-[#0284C7] border-[#BAE6FD]'
                : 'bg-white text-[#64748B] border-[#E2E8F0] hover:bg-slate-50'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            Quotas, Payments &amp; Pricing Tiers
          </button>
          <button
            onClick={onOpenCreateTenant}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            New Tenant
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {subView === 'directory' ? (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs space-y-4">
          {/* Search & Status Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by organization name, ID, or billing email..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-semibold text-[#0F172A]"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="TRIALING">TRIALING</option>
              <option value="EXPIRED">EXPIRED</option>
              <option value="SUSPENDED">SUSPENDED</option>
            </select>

            <button
              onClick={loadTenants}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-[#E2E8F0] text-xs font-semibold text-[#0F172A] cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E2E8F0] text-[11px] font-bold uppercase tracking-wider text-[#64748B] font-mono">
                  <th className="py-2.5 pr-4">Organization</th>
                  <th className="py-2.5 pr-4">Type &amp; Tier</th>
                  <th className="py-2.5 pr-4">Status</th>
                  <th className="py-2.5 pr-4">Client Limit</th>
                  <th className="py-2.5 pr-4">Slips Quota</th>
                  <th className="py-2.5 text-right">Operator Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] text-xs">
                {tenants.map((t) => {
                  const pct = Math.min(
                    100,
                    Math.round(
                      t.quota_utilization_percent ||
                        (t.total_available_capacity > 0
                          ? (t.monthly_documents_processed / t.total_available_capacity) * 100
                          : 0)
                    )
                  );
                  return (
                    <tr key={t.id} className="hover:bg-[#F8FAFC] transition-colors">
                      <td className="py-3 pr-4">
                        <div className="font-semibold text-[#0F172A]">{t.name}</div>
                        <div className="text-[11px] font-mono text-[#64748B]">
                          {t.id}
                          {t.billing_contact_email ? ` | ${t.billing_contact_email}` : ''}
                        </div>
                      </td>
                      <td className="py-3 pr-4 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-[#E2E8F0] font-mono text-[11px] font-bold text-[#0F172A]">
                          {t.plan_tier}
                        </span>
                        <div className="text-[10px] font-mono text-[#64748B] mt-0.5">
                          {t.org_type === 'INDIVIDUAL_BUSINESS' ? 'Direct Business' : 'Accounting Firm'}
                        </div>
                      </td>
                      <td className="py-3 pr-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${statusBadge(
                            t.subscription_status,
                            t.is_active
                          )}`}
                        >
                          {t.is_active ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : (
                            <ShieldAlert className="w-3 h-3" />
                          )}
                          {!t.is_active ? 'SUSPENDED' : t.subscription_status}
                        </span>
                        {t.trial_days_remaining !== null && t.trial_days_remaining !== undefined && (
                          <div className="text-[10px] text-amber-700 font-mono mt-0.5">
                            {t.trial_days_remaining}d trial left
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-4 font-mono text-[11px] text-[#0F172A]">
                        Max {t.max_clients} clients
                      </td>
                      <td className="py-3 pr-4 min-w-[140px]">
                        <div className="flex items-center justify-between text-[11px] font-mono text-[#64748B] mb-1">
                          <span>
                            {t.monthly_documents_processed} / {t.total_available_capacity}
                          </span>
                          <span>{pct}%</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full bg-[#0284C7] rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </td>
                      <td className="py-3 text-right whitespace-nowrap space-x-2">
                        <button
                          onClick={() => handleQuickImpersonate(t)}
                          disabled={impersonatingId === t.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#0284C7] hover:bg-[#0369A1] text-white text-[11px] font-semibold cursor-pointer disabled:opacity-60"
                          title="Inspect this tenant workspace via audited impersonation"
                        >
                          <Eye className="w-3 h-3" />
                          {impersonatingId === t.id ? 'Switching...' : 'View as Tenant'}
                        </button>
                        <button
                          onClick={() => setSelectedOrgId(t.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-[#E2E8F0] text-[#0F172A] text-[11px] font-semibold cursor-pointer"
                        >
                          <Settings2 className="w-3 h-3" />
                          Manage
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {tenants.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-xs text-[#64748B]">
                      No tenant organizations found matching your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="px-4 py-2.5 rounded-xl bg-[#F0F9FF] border border-[#BAE6FD] flex items-center justify-between text-xs text-[#0F172A]">
            <span className="flex items-center gap-2">
              <Sliders className="w-3.5 h-3.5 text-[#0284C7]" />
              Manage plan upgrades, MoMo/Wire payment approvals, slip booster packs, trial extensions, and pricing tier definitions.
            </span>
          </div>
          <AdminBillingSection />
        </div>
      )}

      <TenantDetailDrawer
        orgId={selectedOrgId}
        onClose={() => setSelectedOrgId(null)}
        onUpdated={loadTenants}
      />
    </div>
  );
};
