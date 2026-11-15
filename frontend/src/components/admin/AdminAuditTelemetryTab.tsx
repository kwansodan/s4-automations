import React, { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  BarChart3,
  Download,
  FileSearch,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  downloadAdminAuditLogsCsv,
  fetchAdminAuditLogs,
  fetchAdminTenantTelemetry,
} from '../../lib/api';
import type { AdminAuditLogEntry, TenantTelemetryBreakdown } from '../../types/admin';

export const AdminAuditTelemetryTab: React.FC = () => {
  const [subView, setSubView] = useState<'audits' | 'telemetry'>('audits');

  // Audit Explorer
  const [logs, setLogs] = useState<AdminAuditLogEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [availableActions, setAvailableActions] = useState<string[]>([]);
  const [actionFilter, setActionFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAudit, setSelectedAudit] = useState<AdminAuditLogEntry | null>(null);
  const [isLoadingAudits, setIsLoadingAudits] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // Per-Tenant Telemetry
  const [telemetry, setTelemetry] = useState<TenantTelemetryBreakdown | null>(null);
  const [days, setDays] = useState(30);
  const [isLoadingTelemetry, setIsLoadingTelemetry] = useState(true);
  const [error, setError] = useState('');

  const loadAudits = useCallback(async () => {
    setIsLoadingAudits(true);
    setError('');
    try {
      const res = await fetchAdminAuditLogs({
        action: actionFilter || undefined,
        actor_email: actorFilter.trim() || undefined,
        search: searchQuery.trim() || undefined,
        limit: 100,
      });
      setLogs(res.logs || []);
      setTotalCount(res.total_count || 0);
      setAvailableActions(res.available_actions || []);
    } catch (err: any) {
      setError(err.message || 'Failed loading audit logs.');
    } finally {
      setIsLoadingAudits(false);
    }
  }, [actionFilter, actorFilter, searchQuery]);

  const loadTelemetry = useCallback(async () => {
    setIsLoadingTelemetry(true);
    try {
      const res = await fetchAdminTenantTelemetry(days);
      setTelemetry(res);
    } catch (err: any) {
      setError(err.message || 'Failed loading per-tenant telemetry.');
    } finally {
      setIsLoadingTelemetry(false);
    }
  }, [days]);

  useEffect(() => {
    loadAudits();
  }, [loadAudits]);

  useEffect(() => {
    loadTelemetry();
  }, [loadTelemetry]);

  const handleCsvExport = async () => {
    setIsExporting(true);
    try {
      await downloadAdminAuditLogsCsv({
        action: actionFilter || undefined,
        actor_email: actorFilter.trim() || undefined,
        search: searchQuery.trim() || undefined,
      });
    } catch (err: any) {
      setError(err.message || 'CSV export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shadow-xs">
        <div>
          <h2 className="text-base font-bold text-[#0F172A]">Audit Log &amp; Unit Economics Telemetry</h2>
          <p className="text-xs text-[#64748B] mt-0.5">
            Search immutable operator and agent actions, export compliance CSVs, and monitor per-tenant AI gross margins.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setSubView('audits')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
              subView === 'audits'
                ? 'bg-[#F0F9FF] text-[#0284C7] border-[#BAE6FD]'
                : 'bg-white text-[#64748B] border-[#E2E8F0] hover:bg-slate-50'
            }`}
          >
            <FileSearch className="w-3.5 h-3.5" />
            Immutable Audit Log ({totalCount})
          </button>
          <button
            onClick={() => setSubView('telemetry')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
              subView === 'telemetry'
                ? 'bg-[#F0F9FF] text-[#0284C7] border-[#BAE6FD]'
                : 'bg-white text-[#64748B] border-[#E2E8F0] hover:bg-slate-50'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Per-Tenant AI Margin
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {subView === 'audits' ? (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs space-y-4">
          {/* Filter Bar */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search details or reference..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
              />
            </div>

            <input
              type="text"
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
              placeholder="Filter actor email..."
              className="px-3 py-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
            />

            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-semibold text-[#0F172A]"
            >
              <option value="">All Actions</option>
              {availableActions.map((act) => (
                <option key={act} value={act}>
                  {act}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={loadAudits}
                disabled={isLoadingAudits}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-slate-50 border border-[#E2E8F0] text-xs font-semibold text-[#0F172A] cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAudits ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                onClick={handleCsvExport}
                disabled={isExporting}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
              >
                <Download className="w-3.5 h-3.5" />
                {isExporting ? 'Exporting...' : 'CSV'}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E2E8F0] text-[11px] font-bold uppercase tracking-wider text-[#64748B] font-mono">
                  <th className="py-2 pr-4">Timestamp</th>
                  <th className="py-2 pr-4">Action</th>
                  <th className="py-2 pr-4">Actor</th>
                  <th className="py-2 pr-4">Source / Target</th>
                  <th className="py-2 text-right">Payload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] text-xs">
                {logs.map((entry) => (
                  <tr key={entry.id} className="hover:bg-[#F8FAFC]">
                    <td className="py-2.5 pr-4 font-mono text-[11px] text-[#64748B] whitespace-nowrap">
                      {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'N/A'}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="px-2 py-0.5 rounded bg-slate-100 border border-[#E2E8F0] font-mono text-[11px] font-semibold text-[#0F172A]">
                        {entry.action}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 font-medium text-[#0F172A]">{entry.actor_email}</td>
                    <td className="py-2.5 pr-4 text-[#64748B] max-w-xs truncate">
                      {entry.source_type || 'SYSTEM'} {entry.source_reference ? `(${entry.source_reference})` : ''}
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <button
                        onClick={() => setSelectedAudit(entry)}
                        className="px-2.5 py-1 rounded-lg bg-[#F0F9FF] hover:bg-sky-100 text-[#0284C7] border border-[#BAE6FD] text-[11px] font-semibold cursor-pointer"
                      >
                        View JSON
                      </button>
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && !isLoadingAudits && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-xs text-[#64748B]">
                      No audit entries match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {telemetry && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 shadow-xs">
                <span className="text-[10px] font-mono uppercase text-[#64748B]">Total MRR</span>
                <div className="text-xl font-bold text-[#0F172A] font-mono mt-1">
                  ${telemetry.summary.total_mrr_usd.toFixed(2)}
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 shadow-xs">
                <span className="text-[10px] font-mono uppercase text-[#64748B]">AI Cost ({days}d)</span>
                <div className="text-xl font-bold text-amber-700 font-mono mt-1">
                  ${telemetry.summary.total_ai_cost_usd.toFixed(2)}
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 shadow-xs">
                <span className="text-[10px] font-mono uppercase text-[#64748B]">Net Gross Margin</span>
                <div className="text-xl font-bold text-emerald-600 font-mono mt-1">
                  ${telemetry.summary.gross_margin_usd.toFixed(2)}
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 shadow-xs flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono uppercase text-[#64748B]">Window</span>
                  <div className="text-sm font-bold text-[#0F172A] mt-1">Last {days} Days</div>
                </div>
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  className="px-2.5 py-1.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-semibold text-[#0F172A]"
                >
                  <option value={7}>7d</option>
                  <option value={30}>30d</option>
                  <option value={90}>90d</option>
                </select>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs overflow-x-auto">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#0284C7]" />
                <h3 className="text-sm font-bold text-[#0F172A]">Tenant AI Token Consumption &amp; Gross Margin</h3>
              </div>
              <button
                onClick={loadTelemetry}
                disabled={isLoadingTelemetry}
                className="p-1.5 rounded-lg border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingTelemetry ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E2E8F0] text-[11px] font-bold uppercase tracking-wider text-[#64748B] font-mono">
                  <th className="py-2 pr-4">Tenant Organization</th>
                  <th className="py-2 pr-4">Tier</th>
                  <th className="py-2 pr-4">Clients</th>
                  <th className="py-2 pr-4">Agent Runs</th>
                  <th className="py-2 pr-4">Tokens</th>
                  <th className="py-2 pr-4">AI Cost</th>
                  <th className="py-2 pr-4">MRR</th>
                  <th className="py-2 text-right">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] text-xs">
                {(telemetry?.tenants || []).map((row) => (
                  <tr key={row.organization_id} className="hover:bg-[#F8FAFC]">
                    <td className="py-2.5 pr-4 font-semibold text-[#0F172A]">{row.organization_name}</td>
                    <td className="py-2.5 pr-4 font-mono text-[11px] text-[#64748B]">{row.plan_tier}</td>
                    <td className="py-2.5 pr-4 font-mono">
                      {row.client_count} / {row.max_clients}
                    </td>
                    <td className="py-2.5 pr-4 font-mono">
                      {row.agent_runs} {row.failed_runs > 0 && <span className="text-rose-600">({row.failed_runs} fail)</span>}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-[#64748B]">{row.tokens_used.toLocaleString()}</td>
                    <td className="py-2.5 pr-4 font-mono text-amber-700">${row.estimated_ai_cost_usd.toFixed(4)}</td>
                    <td className="py-2.5 pr-4 font-mono font-semibold text-[#0F172A]">${row.mrr_usd.toFixed(2)}</td>
                    <td className="py-2.5 text-right font-mono font-bold text-emerald-600">
                      ${row.gross_margin_usd.toFixed(2)} ({row.margin_pct}%)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* JSON Payload Inspector Modal */}
      {selectedAudit && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-xl w-full max-w-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#0F172A] font-mono">{selectedAudit.action}</h3>
                <p className="text-[11px] text-[#64748B]">
                  Actor: {selectedAudit.actor_email} | ID: {selectedAudit.id}
                </p>
              </div>
              <button
                onClick={() => setSelectedAudit(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">
              <pre className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-[11px] font-mono text-[#0F172A] overflow-x-auto max-h-96">
                {JSON.stringify(selectedAudit.details, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
