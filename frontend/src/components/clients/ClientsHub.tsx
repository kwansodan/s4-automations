import React, { useState } from 'react';
import { useClient } from '../../context/ClientContext';
import { useAutomation, WorkspaceSubTab } from '../../context/AutomationContext';
import {
  Building2,
  ArrowRight,
  CheckCircle2,
  Zap,
  Clock,
  Plus,
  Sparkles,
  Sliders,
  Search,
  Receipt,
  DollarSign,
  Landmark,
  Layers,
} from 'lucide-react';
import type { ClientProfile } from '../../types/client';

export const ClientsHub: React.FC = () => {
  const { clients, setClient, setIsWizardOpen } = useClient();
  const { setActiveTab, setWorkspaceSubTab } = useAutomation();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'live' | 'dev'>('all');

  const handleSelect = (client: ClientProfile, sub: WorkspaceSubTab = 'overview') => {
    setClient(client.id);
    setWorkspaceSubTab(sub);
    setActiveTab('workspace');
  };

  const filteredClients = clients.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.industry.toLowerCase().includes(search.toLowerCase()) ||
      c.desc.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header Banner */}
      <div className="glass-panel-elevated rounded-2xl p-6 shadow-xl border border-sky-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Building2 className="w-6 h-6 text-sky-400" />
            <h1 className="text-xl font-extrabold text-white tracking-tight">
              Accounting Client Directory &amp; Organizations
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            S4 Automations Multi-Tenant Orchestration Platform. Manage automated OCR vision ingestion, bank feed reconciliations, and Zoho Books draft postings across all client organizations.
          </p>
        </div>

        <button
          onClick={() => setIsWizardOpen(true)}
          className="flex items-center gap-2 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-extrabold py-3 px-5 rounded-xl shadow-lg shadow-sky-600/30 transition cursor-pointer shrink-0"
        >
          <Sparkles className="w-4 h-4" />
          <span>Launch Onboarding Wizard</span>
        </button>
      </div>

      {/* Quick Search & Status Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800/80 rounded-xl p-2">
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
          {[
            { id: 'all', label: `All Clients (${clients.length})` },
            { id: 'live', label: `Live Production (${clients.filter((c) => c.status === 'live').length})` },
            { id: 'dev', label: `In Development (${clients.filter((c) => c.status === 'dev').length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id as any)}
              className={`px-3 py-1 text-xs font-bold rounded-md transition cursor-pointer ${
                statusFilter === tab.id
                  ? 'bg-sky-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search organizations or industries..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 sm:w-72"
          />
        </div>
      </div>

      {/* Clients Card Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredClients.map((client) => {
          const isLive = client.status === 'live';
          const isDev = client.status === 'dev';

          return (
            <div
              key={client.id}
              className="glass-panel rounded-2xl p-6 shadow-xl border border-slate-800 hover:border-sky-500/50 flex flex-col justify-between transition-all hover:shadow-sky-500/10 hover:-translate-y-0.5 group"
            >
              <div>
                {/* Top Bar: Icon & Status */}
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform shadow-md">
                    {client.icon || '🏢'}
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                      isLive
                        ? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300'
                        : isDev
                        ? 'bg-sky-950/80 border border-sky-500/40 text-sky-300'
                        : 'bg-amber-950/80 border border-amber-500/40 text-amber-300'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    <span>{client.statusText || (isLive ? 'Production Live' : 'In Development')}</span>
                  </span>
                </div>

                {/* Title & Industry */}
                <h3
                  onClick={() => handleSelect(client, 'overview')}
                  className="text-base font-bold text-white group-hover:text-sky-300 transition-colors cursor-pointer"
                >
                  {client.name}
                </h3>
                <p className="text-xs text-sky-400/90 font-medium mt-0.5 mb-2">{client.industry}</p>
                <p className="text-xs text-slate-400 line-clamp-2 mb-4">{client.desc}</p>

                {/* Quick Workflow Jumps */}
                <div className="grid grid-cols-3 gap-1.5 mb-4 pt-3 border-t border-slate-850">
                  <button
                    onClick={() => handleSelect(client, 'ar')}
                    className="p-1.5 rounded-lg bg-slate-950/80 hover:bg-slate-900 border border-slate-800 text-[10px] font-semibold text-sky-300 flex items-center justify-center gap-1 transition cursor-pointer"
                  >
                    <Receipt className="w-3 h-3 text-sky-400" />
                    <span>AR Slips</span>
                  </button>
                  <button
                    onClick={() => handleSelect(client, 'ap')}
                    className="p-1.5 rounded-lg bg-slate-950/80 hover:bg-slate-900 border border-slate-800 text-[10px] font-semibold text-indigo-300 flex items-center justify-center gap-1 transition cursor-pointer"
                  >
                    <DollarSign className="w-3 h-3 text-indigo-400" />
                    <span>AP Bills</span>
                  </button>
                  <button
                    onClick={() => handleSelect(client, 'bank')}
                    className="p-1.5 rounded-lg bg-slate-950/80 hover:bg-slate-900 border border-slate-800 text-[10px] font-semibold text-emerald-300 flex items-center justify-center gap-1 transition cursor-pointer"
                  >
                    <Landmark className="w-3 h-3 text-emerald-400" />
                    <span>Bank</span>
                  </button>
                </div>
              </div>

              {/* Action Trigger & Counts */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-400 font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                  {client.pipelines?.length || 0} Streams
                </span>
                
                <button
                  onClick={() => handleSelect(client, 'overview')}
                  className="inline-flex items-center gap-1 text-xs font-bold text-sky-400 group-hover:translate-x-1 transition-transform cursor-pointer"
                >
                  <span>Open Workspace</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
};
