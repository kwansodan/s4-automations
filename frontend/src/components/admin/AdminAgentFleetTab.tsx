import React, { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  Bot,
  CheckCircle2,
  Mail,
  MessageSquare,
  Play,
  RefreshCw,
  Server,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  fetchAdminAgentFleet,
  fetchAdminAgentMessages,
  fetchAdminAgentRuns,
  fetchAdminGatewayHealth,
  triggerAgentHeartbeat,
} from '../../lib/api';
import type {
  AdminAgentFleetEntry,
  AdminAgentMessageEntry,
  AdminAgentRunEntry,
  GatewayHealthData,
} from '../../types/admin';
import { useAutomation } from '../../context/AutomationContext';

export const AdminAgentFleetTab: React.FC = () => {
  const { addLog } = useAutomation();

  const [subView, setSubView] = useState<'fleet' | 'runs' | 'messages' | 'gateways'>('fleet');
  const [fleet, setFleet] = useState<AdminAgentFleetEntry[]>([]);
  const [runs, setRuns] = useState<AdminAgentRunEntry[]>([]);
  const [messages, setMessages] = useState<AdminAgentMessageEntry[]>([]);
  const [gatewayHealth, setGatewayHealth] = useState<GatewayHealthData | null>(null);

  const [statusFilter, setStatusFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [selectedRun, setSelectedRun] = useState<AdminAgentRunEntry | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isTriggering, setIsTriggering] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const [fleetRes, runsRes, msgRes, gwRes] = await Promise.all([
        fetchAdminAgentFleet(),
        fetchAdminAgentRuns({ status_filter: statusFilter || undefined, limit: 60 }),
        fetchAdminAgentMessages({ channel: channelFilter || undefined, limit: 60 }),
        fetchAdminGatewayHealth(),
      ]);
      setFleet(fleetRes.agents || []);
      setRuns(runsRes.runs || []);
      setMessages(msgRes.messages || []);
      setGatewayHealth(gwRes);
    } catch (err: any) {
      setError(err.message || 'Failed loading global agent telemetry.');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, channelFilter]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleTriggerHeartbeat = async (clientId?: string) => {
    setIsTriggering(true);
    setNotice('');
    try {
      const res = await triggerAgentHeartbeat({ client_id: clientId, force: Boolean(clientId) });
      const msg = `Evaluated ${res.agents_evaluated} agents across ${res.clients_checked} clients (${res.runs_executed} executed).`;
      setNotice(msg);
      addLog('success', msg);
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Heartbeat trigger failed.');
    } finally {
      setIsTriggering(false);
    }
  };

  const runBadge = (status: string) => {
    const s = (status || '').toUpperCase();
    if (s === 'COMPLETED' || s === 'SUCCESS') {
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    }
    if (s === 'FAILED' || s === 'ERROR') {
      return 'bg-rose-50 text-rose-700 border-rose-200';
    }
    if (s === 'RUNNING') {
      return 'bg-sky-50 text-[#0284C7] border-[#BAE6FD]';
    }
    return 'bg-slate-100 text-slate-700 border-[#E2E8F0]';
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Top Toolbar */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 shadow-xs">
        <div>
          <h2 className="text-base font-bold text-[#0F172A]">Global AI Agent Fleet Monitor</h2>
          <p className="text-xs text-[#64748B] mt-0.5">
            Monitor autonomous agent identities, ReAct tool traces, inbound/outbound threads, and webhook readiness.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleTriggerHeartbeat()}
            disabled={isTriggering}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
          >
            <Play className={`w-3.5 h-3.5 ${isTriggering ? 'animate-pulse' : ''}`} />
            {isTriggering ? 'Running Fleet Sweep...' : 'Trigger Heartbeat Sweep'}
          </button>
          <button
            onClick={loadAll}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-slate-50 border border-[#E2E8F0] text-xs font-semibold text-[#0F172A] cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Sub-view Pills */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { id: 'fleet', label: `Agent Fleet (${fleet.length})`, icon: Bot },
          { id: 'runs', label: `Execution Runs (${runs.length})`, icon: Activity },
          { id: 'messages', label: `Comms Feed (${messages.length})`, icon: MessageSquare },
          { id: 'gateways', label: 'Email & WhatsApp Gateways', icon: Server },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = subView === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSubView(tab.id as any)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                active
                  ? 'bg-[#F0F9FF] text-[#0284C7] border-[#BAE6FD] shadow-2xs'
                  : 'bg-white text-[#64748B] border-[#E2E8F0] hover:bg-slate-50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {notice && (
        <div className="px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="px-4 py-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* SUBVIEW 1: Fleet Registry */}
      {subView === 'fleet' && (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-[11px] font-bold uppercase tracking-wider text-[#64748B] font-mono">
                <th className="py-2.5 pr-4">Client / Tenant</th>
                <th className="py-2.5 pr-4">Agent Persona &amp; Channel Identity</th>
                <th className="py-2.5 pr-4">Status &amp; Mode</th>
                <th className="py-2.5 pr-4">Telemetry</th>
                <th className="py-2.5 pr-4">Last Run</th>
                <th className="py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-xs">
              {fleet.map((agent) => (
                <tr key={agent.client_id} className="hover:bg-[#F8FAFC]">
                  <td className="py-3 pr-4">
                    <div className="font-semibold text-[#0F172A]">{agent.client_name}</div>
                    <div className="text-[11px] text-[#64748B]">{agent.organization_name}</div>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="font-medium text-[#0F172A]">
                      {agent.agent_persona_name || 'S4 Autonomous Copilot'}
                    </div>
                    <div className="text-[11px] font-mono text-[#64748B]">
                      {agent.agent_email || 'No email assigned'}
                      {agent.agent_whatsapp_number ? ` | ${agent.agent_whatsapp_number}` : ''}
                    </div>
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                        agent.agent_enabled
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-slate-100 text-slate-600 border-[#E2E8F0]'
                      }`}
                    >
                      {agent.agent_enabled ? 'ACTIVE' : 'PAUSED'}
                    </span>
                    <div className="text-[10px] font-mono text-[#64748B] mt-1">
                      {agent.agent_autonomy_mode || 'DRAFT_FIRST'}
                    </div>
                  </td>
                  <td className="py-3 pr-4 font-mono text-[11px] text-[#64748B]">
                    <div>
                      {agent.total_runs} runs ({agent.failed_runs} failed)
                    </div>
                    <div>
                      In: {agent.inbound_messages} / Out: {agent.outbound_messages}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    {agent.last_run ? (
                      <div>
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${runBadge(
                            agent.last_run.status
                          )}`}
                        >
                          {agent.last_run.status}
                        </span>
                        <div className="text-[11px] text-[#64748B] mt-0.5 max-w-[200px] truncate">
                          {agent.last_run.summary || agent.last_run.trigger_type}
                        </div>
                      </div>
                    ) : (
                      <span className="text-[11px] text-[#64748B]">No runs yet</span>
                    )}
                  </td>
                  <td className="py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => handleTriggerHeartbeat(agent.client_id)}
                      disabled={isTriggering}
                      className="px-2.5 py-1 rounded-lg bg-[#F0F9FF] hover:bg-sky-100 text-[#0284C7] border border-[#BAE6FD] text-[11px] font-semibold cursor-pointer"
                    >
                      Force Run
                    </button>
                  </td>
                </tr>
              ))}
              {fleet.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-[#64748B]">
                    No client workspaces found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* SUBVIEW 2: Execution Runs & ReAct Traces */}
      {subView === 'runs' && (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-[#0F172A]">ReAct Execution Runs</h3>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-semibold text-[#0F172A]"
            >
              <option value="">All Statuses</option>
              <option value="COMPLETED">COMPLETED</option>
              <option value="FAILED">FAILED</option>
              <option value="RUNNING">RUNNING</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E2E8F0] text-[11px] font-bold uppercase tracking-wider text-[#64748B] font-mono">
                  <th className="py-2 pr-4">Started</th>
                  <th className="py-2 pr-4">Client</th>
                  <th className="py-2 pr-4">Trigger</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Cost / Tokens</th>
                  <th className="py-2 pr-4">Summary</th>
                  <th className="py-2 text-right">Trace</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] text-xs">
                {runs.map((run) => (
                  <tr key={run.id} className="hover:bg-[#F8FAFC]">
                    <td className="py-2.5 pr-4 font-mono text-[11px] text-[#64748B] whitespace-nowrap">
                      {run.started_at ? new Date(run.started_at).toLocaleString() : 'N/A'}
                    </td>
                    <td className="py-2.5 pr-4 font-semibold text-[#0F172A]">{run.client_name}</td>
                    <td className="py-2.5 pr-4 font-mono text-[11px] text-[#0F172A]">{run.trigger_type}</td>
                    <td className="py-2.5 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${runBadge(run.status)}`}>
                        {run.status}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-[11px] text-[#64748B] whitespace-nowrap">
                      ${run.estimated_cost_usd.toFixed(4)} ({run.tokens_used.toLocaleString()} tok)
                    </td>
                    <td className="py-2.5 pr-4 text-[#64748B] max-w-xs truncate">
                      {run.error_message || run.summary || 'No summary'}
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <button
                        onClick={() => setSelectedRun(run)}
                        className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[#0F172A] text-[11px] font-semibold cursor-pointer"
                      >
                        Inspect ({run.reasoning_trace.length} steps)
                      </button>
                    </td>
                  </tr>
                ))}
                {runs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-xs text-[#64748B]">
                      No execution runs recorded for this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUBVIEW 3: Cross-Tenant Communications Feed */}
      {subView === 'messages' && (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-[#0F172A]">Global Agent Communications Feed</h3>
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="px-3 py-1.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-semibold text-[#0F172A]"
            >
              <option value="">All Channels</option>
              <option value="EMAIL">EMAIL</option>
              <option value="WHATSAPP">WHATSAPP</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E2E8F0] text-[11px] font-bold uppercase tracking-wider text-[#64748B] font-mono">
                  <th className="py-2 pr-4">Timestamp</th>
                  <th className="py-2 pr-4">Client</th>
                  <th className="py-2 pr-4">Channel / Dir</th>
                  <th className="py-2 pr-4">From &rarr; To</th>
                  <th className="py-2 pr-4">Subject / Preview</th>
                  <th className="py-2 pr-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] text-xs">
                {messages.map((m) => (
                  <tr key={m.id} className="hover:bg-[#F8FAFC]">
                    <td className="py-2.5 pr-4 font-mono text-[11px] text-[#64748B] whitespace-nowrap">
                      {m.created_at ? new Date(m.created_at).toLocaleString() : 'N/A'}
                    </td>
                    <td className="py-2.5 pr-4 font-semibold text-[#0F172A]">{m.client_name}</td>
                    <td className="py-2.5 pr-4 whitespace-nowrap font-mono text-[11px]">
                      <span className="px-2 py-0.5 rounded bg-slate-100 border border-[#E2E8F0] text-[#0F172A] mr-1">
                        {m.channel}
                      </span>
                      <span className={m.direction === 'INBOUND' ? 'text-[#0284C7] font-bold' : 'text-emerald-700 font-bold'}>
                        {m.direction}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-[11px] text-[#64748B] max-w-[200px] truncate">
                      {m.sender_address || '?'} &rarr; {m.recipient_address || '?'}
                    </td>
                    <td className="py-2.5 pr-4 max-w-xs truncate text-[#0F172A]">
                      <span className="font-semibold">{m.subject ? `${m.subject}: ` : ''}</span>
                      <span className="text-[#64748B]">{m.body_preview}</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${runBadge(m.status)}`}>
                        {m.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {messages.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-xs text-[#64748B]">
                      No agent messages captured yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUBVIEW 4: Gateway & Webhook Readiness */}
      {subView === 'gateways' && gatewayHealth && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-[#0284C7]" />
                <h3 className="text-sm font-bold text-[#0F172A]">Email SMTP / IMAP Poller Gateway</h3>
              </div>
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${runBadge(gatewayHealth.email_gateway.status)}`}>
                {gatewayHealth.email_gateway.status}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                <span className="text-[10px] font-mono uppercase text-[#64748B]">Agent Domain</span>
                <p className="font-mono font-semibold text-[#0F172A] mt-0.5">
                  @{gatewayHealth.email_gateway.agent_email_domain}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                <span className="text-[10px] font-mono uppercase text-[#64748B]">IMAP Poller Interval</span>
                <p className="font-mono font-semibold text-[#0F172A] mt-0.5">
                  {gatewayHealth.email_gateway.poll_interval_seconds}s
                </p>
              </div>
              <div className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                <span className="text-[10px] font-mono uppercase text-[#64748B]">SMTP Host</span>
                <p className="font-mono font-semibold text-[#0F172A] mt-0.5 truncate">
                  {gatewayHealth.email_gateway.smtp_host || 'Unconfigured'}:{gatewayHealth.email_gateway.smtp_port || ''}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                <span className="text-[10px] font-mono uppercase text-[#64748B]">24h Volume</span>
                <p className="font-mono font-semibold text-[#0F172A] mt-0.5">
                  In {gatewayHealth.email_gateway.recent_inbound_24h} / Out {gatewayHealth.email_gateway.recent_outbound_24h} ({gatewayHealth.email_gateway.failed_24h} fail)
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-[#0F172A]">WhatsApp Business Cloud Webhook</h3>
              </div>
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${runBadge(gatewayHealth.whatsapp_gateway.status)}`}>
                {gatewayHealth.whatsapp_gateway.status}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                <span className="text-[10px] font-mono uppercase text-[#64748B]">Platform Number</span>
                <p className="font-mono font-semibold text-[#0F172A] mt-0.5">
                  {gatewayHealth.whatsapp_gateway.platform_number || 'Unconfigured'}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                <span className="text-[10px] font-mono uppercase text-[#64748B]">24h Volume</span>
                <p className="font-mono font-semibold text-[#0F172A] mt-0.5">
                  In {gatewayHealth.whatsapp_gateway.recent_inbound_24h} / Out {gatewayHealth.whatsapp_gateway.recent_outbound_24h}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] col-span-2 flex flex-wrap gap-3">
                <span className="text-[11px] font-mono text-[#0F172A]">
                  Phone ID: {gatewayHealth.whatsapp_gateway.phone_number_id_configured ? 'SET' : 'MISSING'}
                </span>
                <span className="text-[11px] font-mono text-[#0F172A]">
                  Access Token: {gatewayHealth.whatsapp_gateway.access_token_configured ? 'SET' : 'MISSING'}
                </span>
                <span className="text-[11px] font-mono text-[#0F172A]">
                  Verify Token: {gatewayHealth.whatsapp_gateway.verify_token_configured ? 'SET' : 'MISSING'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ReAct Step Trace Modal */}
      {selectedRun && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#0F172A]">
                  Execution Trace: {selectedRun.client_name} ({selectedRun.trigger_type})
                </h3>
                <p className="text-[11px] font-mono text-[#64748B]">
                  Run ID: {selectedRun.id} | Status: {selectedRun.status}
                </p>
              </div>
              <button
                onClick={() => setSelectedRun(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4">
              {selectedRun.summary && (
                <div className="p-3.5 rounded-xl bg-[#F0F9FF] border border-[#BAE6FD] text-xs text-[#0F172A]">
                  <strong className="block mb-1 text-[#0284C7]">Run Summary</strong>
                  {selectedRun.summary}
                </div>
              )}
              {selectedRun.error_message && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
                  <strong className="block mb-1">Error Detail</strong>
                  {selectedRun.error_message}
                </div>
              )}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#64748B] font-mono mb-2">
                  Reasoning &amp; Tool Trace ({selectedRun.reasoning_trace.length})
                </h4>
                <pre className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-[11px] font-mono text-[#0F172A] overflow-x-auto max-h-96">
                  {JSON.stringify(selectedRun.reasoning_trace, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
