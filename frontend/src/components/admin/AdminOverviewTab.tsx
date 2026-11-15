import React, { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  Bot,
  Building2,
  CheckCircle2,
  CreditCard,
  DollarSign,
  Play,
  Plus,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { fetchAdminOverview, triggerAgentHeartbeat } from '../../lib/api';
import type { AdminOverviewData, AdminTab } from '../../types/admin';
import { useAutomation } from '../../context/AutomationContext';

interface AdminOverviewTabProps {
  onNavigateTab: (tab: AdminTab) => void;
  onOpenCreateTenant: () => void;
}

export const AdminOverviewTab: React.FC<AdminOverviewTabProps> = ({
  onNavigateTab,
  onOpenCreateTenant,
}) => {
  const { addLog } = useAutomation();
  const [data, setData] = useState<AdminOverviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isHeartbeatRunning, setIsHeartbeatRunning] = useState(false);
  const [heartbeatResult, setHeartbeatResult] = useState<string>('');

  const loadOverview = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetchAdminOverview();
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load platform overview');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const handleGlobalHeartbeat = async () => {
    setIsHeartbeatRunning(true);
    setHeartbeatResult('');
    try {
      const res = await triggerAgentHeartbeat({ force: false });
      const msg = `Checked ${res.clients_checked} clients, evaluated ${res.agents_evaluated} agents, ran ${res.runs_executed} tasks.`;
      setHeartbeatResult(msg);
      addLog('success', `Global Agent Heartbeat: ${msg}`);
      await loadOverview();
    } catch (err: any) {
      setHeartbeatResult(`Heartbeat failed: ${err.message}`);
      addLog('error', `Global Agent Heartbeat failed: ${err.message}`);
    } finally {
      setIsHeartbeatRunning(false);
    }
  };

  const subsystemBadge = (status: string) => {
    const normalized = (status || '').toUpperCase();
    const isOk =
      normalized === 'HEALTHY' ||
      normalized === 'CONNECTED' ||
      normalized === 'ACTIVE' ||
      normalized === 'CONFIGURED';
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
          isOk
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-amber-50 text-amber-700 border-amber-200'
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${isOk ? 'bg-emerald-500' : 'bg-amber-500'}`}
        />
        {status}
      </span>
    );
  };

  if (isLoading && !data) {
    return (
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-12 text-center shadow-xs">
        <RefreshCw className="w-6 h-6 text-[#0284C7] animate-spin mx-auto mb-3" />
        <p className="text-sm font-medium text-[#64748B]">Loading platform command telemetry...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
          <div>
            <h3 className="text-sm font-bold text-rose-900">Unable to load Platform Overview</h3>
            <p className="text-xs text-rose-700 mt-0.5">{error}</p>
          </div>
        </div>
        <button
          onClick={loadOverview}
          className="px-3 py-1.5 rounded-lg bg-white border border-rose-200 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Operator Action Strip */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base sm:text-lg font-bold text-[#0F172A]">
              Platform Command Overview
            </h2>
            {data?.maintenance_mode ? (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                Maintenance Mode Active
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Production Nominal
              </span>
            )}
          </div>
          <p className="text-xs text-[#64748B]">
            Operator session: <span className="font-mono font-semibold text-[#0F172A]">{data?.operator_email}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={onOpenCreateTenant}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold shadow-xs transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            New Tenant Org
          </button>
          <button
            onClick={handleGlobalHeartbeat}
            disabled={isHeartbeatRunning}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#F0F9FF] hover:bg-sky-100 text-[#0284C7] border border-[#BAE6FD] text-xs font-semibold transition cursor-pointer disabled:opacity-60"
          >
            <Play className={`w-3.5 h-3.5 ${isHeartbeatRunning ? 'animate-pulse' : ''}`} />
            {isHeartbeatRunning ? 'Running Heartbeat...' : 'Trigger Global Heartbeat'}
          </button>
          <button
            onClick={loadOverview}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-[#E2E8F0] text-xs font-semibold transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {heartbeatResult && (
        <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-3 flex items-center justify-between text-xs text-sky-900">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#0284C7] shrink-0" />
            <span>{heartbeatResult}</span>
          </div>
          <button
            onClick={() => onNavigateTab('agents')}
            className="font-semibold text-[#0284C7] hover:underline cursor-pointer"
          >
            Inspect Agent Fleet &rarr;
          </button>
        </div>
      )}

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* MRR & Gross Margin */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#64748B] uppercase tracking-wider font-mono">
              MRR &amp; AI Margin
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-[#0F172A] font-mono">
              ${(data?.revenue.mrr_usd ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="mt-1.5 flex items-center justify-between text-xs text-[#64748B]">
              <span>30d AI Cost: ${(data?.revenue.estimated_ai_cost_usd_30d ?? 0).toFixed(2)}</span>
              <span className="font-semibold text-emerald-600">
                Net: ${(data?.revenue.gross_margin_usd ?? 0).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Tenant Directory */}
        <div
          onClick={() => onNavigateTab('tenants')}
          className="bg-white rounded-2xl border border-[#E2E8F0] hover:border-sky-300 p-5 shadow-xs flex flex-col justify-between cursor-pointer transition group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#64748B] uppercase tracking-wider font-mono">
              Tenants &amp; Firms
            </span>
            <div className="w-8 h-8 rounded-xl bg-[#F0F9FF] border border-[#BAE6FD] flex items-center justify-center text-[#0284C7]">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-[#0F172A] font-mono group-hover:text-[#0284C7] transition-colors">
              {data?.tenants.active ?? 0}{' '}
              <span className="text-sm font-normal text-[#64748B]">/ {data?.tenants.total ?? 0} active</span>
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-xs text-[#64748B]">
              <span>{data?.tenants.total_clients ?? 0} client workspaces</span>
              <span>{data?.tenants.trialing ?? 0} trialing</span>
              {(data?.tenants.suspended ?? 0) > 0 && (
                <span className="text-rose-600 font-semibold">{data?.tenants.suspended} suspended</span>
              )}
            </div>
          </div>
        </div>

        {/* Autonomous Agent Fleet */}
        <div
          onClick={() => onNavigateTab('agents')}
          className="bg-white rounded-2xl border border-[#E2E8F0] hover:border-sky-300 p-5 shadow-xs flex flex-col justify-between cursor-pointer transition group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#64748B] uppercase tracking-wider font-mono">
              Agent Fleet (24h)
            </span>
            <div className="w-8 h-8 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center text-[#0284C7]">
              <Bot className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-[#0F172A] font-mono group-hover:text-[#0284C7] transition-colors">
              {data?.agent_fleet.runs_24h ?? 0}{' '}
              <span className="text-sm font-normal text-[#64748B]">runs</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-xs text-[#64748B]">
              <span>
                {data?.agent_fleet.active_agents ?? 0}/{data?.agent_fleet.total_agents ?? 0} active agents
              </span>
              {(data?.agent_fleet.failed_runs_24h ?? 0) > 0 ? (
                <span className="text-rose-600 font-semibold">
                  {data?.agent_fleet.failed_runs_24h} failed
                </span>
              ) : (
                <span className="text-emerald-600 font-semibold">0 errors</span>
              )}
            </div>
          </div>
        </div>

        {/* Pending Payments & Token Volume */}
        <div
          onClick={() => onNavigateTab('audit')}
          className="bg-white rounded-2xl border border-[#E2E8F0] hover:border-sky-300 p-5 shadow-xs flex flex-col justify-between cursor-pointer transition group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#64748B] uppercase tracking-wider font-mono">
              Billing &amp; Messages
            </span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-[#0F172A] font-mono">
              ${(data?.revenue.pending_payments_amount_usd ?? 0).toLocaleString()}
              <span className="text-xs font-normal text-[#64748B] ml-1.5">
                ({data?.revenue.pending_payments_count ?? 0} pending)
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-xs text-[#64748B]">
              <span>{(data?.agent_fleet.tokens_24h ?? 0).toLocaleString()} tokens (24h)</span>
              <span>{data?.agent_fleet.messages_24h ?? 0} msgs</span>
            </div>
          </div>
        </div>
      </div>

      {/* Middle Row: Subsystem Health + Tier Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-[#0284C7]" />
              <h3 className="text-sm font-bold text-[#0F172A]">Platform Infrastructure Health</h3>
            </div>
            <button
              onClick={() => onNavigateTab('config')}
              className="text-xs font-semibold text-[#0284C7] hover:underline cursor-pointer"
            >
              Configure Gateways &rarr;
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-[#0F172A]">Database Engine</p>
                <p className="text-[11px] text-[#64748B] font-mono mt-0.5">
                  {data?.subsystems?.database?.provider || 'PostgreSQL (Cloud SQL)'}
                </p>
              </div>
              {subsystemBadge(data?.subsystems?.database?.status || 'UNKNOWN')}
            </div>

            <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-[#0F172A]">AI LLM Router</p>
                <p className="text-[11px] text-[#64748B] font-mono mt-0.5">
                  {data?.subsystems?.llm_router?.provider || 'Gemini 2.5 Flash'}
                </p>
              </div>
              {subsystemBadge(data?.subsystems?.llm_router?.status || 'UNKNOWN')}
            </div>

            <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-[#0F172A]">Email Relay &amp; IMAP</p>
                <p className="text-[11px] text-[#64748B] font-mono mt-0.5">
                  @{data?.subsystems?.email_gateway?.agent_domain || 'agents.service4gh.com'}
                </p>
              </div>
              {subsystemBadge(data?.subsystems?.email_gateway?.status || 'UNKNOWN')}
            </div>

            <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-[#0F172A]">WhatsApp Business Cloud</p>
                <p className="text-[11px] text-[#64748B] font-mono mt-0.5">
                  {data?.subsystems?.whatsapp_gateway?.configured_number || 'Unassigned'}
                </p>
              </div>
              {subsystemBadge(data?.subsystems?.whatsapp_gateway?.status || 'UNCONFIGURED')}
            </div>

            <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-between sm:col-span-2">
              <div>
                <p className="text-xs font-bold text-[#0F172A]">Zoho Books Global OAuth</p>
                <p className="text-[11px] text-[#64748B] font-mono mt-0.5">
                  Platform default connector for draft invoicing &amp; AP bill sync
                </p>
              </div>
              {subsystemBadge(data?.subsystems?.zoho_books?.status || 'MISSING_CREDENTIALS')}
            </div>
          </div>
        </div>

        {/* Plan Distribution & Quick Navigation */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#0284C7]" />
            <h3 className="text-sm font-bold text-[#0F172A]">Tenants by Plan Tier</h3>
          </div>

          <div className="space-y-2.5">
            {Object.entries(data?.tenants.by_tier || {}).map(([tier, count]) => (
              <div
                key={tier}
                className="flex items-center justify-between px-3 py-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]"
              >
                <span className="text-xs font-semibold text-[#0F172A] font-mono">{tier}</span>
                <span className="px-2 py-0.5 rounded-md bg-white border border-[#E2E8F0] text-xs font-bold text-[#0284C7]">
                  {count}
                </span>
              </div>
            ))}
            {Object.keys(data?.tenants.by_tier || {}).length === 0 && (
              <p className="text-xs text-[#64748B]">No organizations registered yet.</p>
            )}
          </div>

          <div className="pt-2 border-t border-[#E2E8F0] space-y-2">
            <button
              onClick={() => onNavigateTab('users')}
              className="w-full text-left px-3 py-2 rounded-xl bg-[#F8FAFC] hover:bg-[#F0F9FF] border border-[#E2E8F0] hover:border-[#BAE6FD] flex items-center justify-between text-xs font-semibold text-[#0F172A] transition cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-[#0284C7]" />
                Manage Super-Admin Allowlist
              </span>
              <span className="text-[#0284C7]">&rarr;</span>
            </button>
            <button
              onClick={() => onNavigateTab('growth')}
              className="w-full text-left px-3 py-2 rounded-xl bg-[#F8FAFC] hover:bg-[#F0F9FF] border border-[#E2E8F0] hover:border-[#BAE6FD] flex items-center justify-between text-xs font-semibold text-[#0F172A] transition cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-[#0284C7]" />
                Landing Mode &amp; Release Hub
              </span>
              <span className="text-[#0284C7]">&rarr;</span>
            </button>
          </div>
        </div>
      </div>

      {/* Recent Security & Governance Audits */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#0284C7]" />
            <h3 className="text-sm font-bold text-[#0F172A]">Recent Governance &amp; Audit Events</h3>
          </div>
          <button
            onClick={() => onNavigateTab('audit')}
            className="text-xs font-semibold text-[#0284C7] hover:underline cursor-pointer"
          >
            Open Full Audit Explorer &rarr;
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-[11px] font-bold uppercase tracking-wider text-[#64748B] font-mono">
                <th className="py-2 pr-4">Timestamp</th>
                <th className="py-2 pr-4">Action</th>
                <th className="py-2 pr-4">Actor</th>
                <th className="py-2 pr-4">Source / Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-xs">
              {(data?.recent_audits || []).map((audit) => (
                <tr key={audit.id} className="hover:bg-[#F8FAFC] transition-colors">
                  <td className="py-2.5 pr-4 font-mono text-[11px] text-[#64748B] whitespace-nowrap">
                    {audit.timestamp ? new Date(audit.timestamp).toLocaleString() : 'N/A'}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-[#E2E8F0] font-mono text-[11px] font-semibold text-[#0F172A]">
                      {audit.action}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 font-medium text-[#0F172A]">{audit.actor_email}</td>
                  <td className="py-2.5 pr-4 text-[#64748B] truncate max-w-xs">
                    {audit.source_type || 'SYSTEM'} {audit.source_reference ? `(${audit.source_reference})` : ''}
                  </td>
                </tr>
              ))}
              {(data?.recent_audits || []).length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-xs text-[#64748B]">
                    No audit events recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
