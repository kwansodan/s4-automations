import React from 'react';
import { useClient } from '../../context/ClientContext';
import { useAutomation } from '../../context/AutomationContext';
import { Building2, ArrowRight, CheckCircle2, Zap, Clock, Plus } from 'lucide-react';
import type { ClientProfile } from '../../types/client';

export const ClientsHub: React.FC = () => {
  const { clients, setClient, setIsSwitcherOpen } = useClient();
  const { setActiveTab } = useAutomation();

  const handleSelect = (client: ClientProfile) => {
    setClient(client.id);
    if (client.id === 'anr_group') {
      setActiveTab('dashboard');
    } else {
      setActiveTab('workspace');
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-sky-950/80 via-slate-900 to-indigo-950/80 border border-sky-500/25 rounded-2xl p-6 shadow-xl backdrop-blur-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Building2 className="w-6 h-6 text-sky-400" />
              <h1 className="text-xl font-extrabold text-white tracking-tight">
                Accounting Client Organizations
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              S4 Automations Multi-Tenant Orchestration Platform. Manage automated OCR vision ingestion, bank feed reconciliations, and Zoho Books postings across all accounting clients.
            </p>
          </div>

          <button
            onClick={() => setIsSwitcherOpen(true)}
            className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow-lg shadow-sky-600/30 transition cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Register New Client</span>
          </button>
        </div>
      </div>

      {/* Clients Card Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {clients.map((client) => {
          const isLive = client.status === 'live';
          const isDev = client.status === 'dev';

          return (
            <div
              key={client.id}
              onClick={() => handleSelect(client)}
              className="bg-slate-900/90 border border-slate-800 hover:border-sky-500/50 rounded-2xl p-6 shadow-xl backdrop-blur-xl flex flex-col justify-between transition-all hover:shadow-sky-500/10 hover:-translate-y-0.5 cursor-pointer group"
            >
              <div>
                {/* Top Bar: Icon & Status */}
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                    {client.icon}
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
                    <span>{client.statusText}</span>
                  </span>
                </div>

                {/* Title & Industry */}
                <h3 className="text-base font-bold text-white group-hover:text-sky-300 transition-colors">
                  {client.name}
                </h3>
                <p className="text-xs text-sky-400/80 font-medium mb-3">{client.industry}</p>
                <p className="text-xs text-slate-400 line-clamp-3 mb-4">{client.desc}</p>

                {/* Integrations Badges */}
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {client.activeIntegrations?.slice(0, 3).map((intg, i) => (
                    <span
                      key={i}
                      className="text-[10px] bg-slate-950 border border-slate-800 text-slate-300 px-2 py-0.5 rounded-md"
                    >
                      {intg}
                    </span>
                  ))}
                  {(client.activeIntegrations?.length || 0) > 3 && (
                    <span className="text-[10px] bg-slate-950 border border-slate-800 text-slate-400 px-1.5 py-0.5 rounded-md">
                      +{(client.activeIntegrations?.length || 0) - 3} more
                    </span>
                  )}
                </div>
              </div>

              {/* Action Trigger */}
              <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-400 font-mono">
                  {client.projectedMonthlyVolume || `${client.workflowsCount} Workflows`}
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-bold text-sky-400 group-hover:translate-x-1 transition-transform">
                  <span>Open Workspace</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
};
