import React from 'react';
import { useClient } from '../../context/ClientContext';
import { useAutomation, WorkspaceSubTab } from '../../context/AutomationContext';
import { ACCOUNTING_PLATFORMS } from '../../types/client';
import { ClientOverviewTab } from './tabs/ClientOverviewTab';
import { ClientArTab } from './tabs/ClientArTab';
import { ClientApTab } from './tabs/ClientApTab';
import { ClientBankTab } from './tabs/ClientBankTab';
import { ClientRequestsTab } from './tabs/ClientRequestsTab';
import { ClientPipelinesTab } from './tabs/ClientPipelinesTab';
import { ClientSettingsTab } from './tabs/ClientSettingsTab';
import {
  LayoutDashboard,
  Receipt,
  DollarSign,
  Landmark,
  ShieldCheck,
  Layers,
  Settings2,
  Sparkles,
  ArrowLeft,
  Building,
} from 'lucide-react';

export const ClientWorkspace: React.FC = () => {
  const { currentClient, setIsWizardOpen } = useClient();
  const { workspaceSubTab, setWorkspaceSubTab, setActiveTab } = useAutomation();

  const currentPlatform =
    ACCOUNTING_PLATFORMS.find((p) => p.id === currentClient.accounting_software) ||
    ACCOUNTING_PLATFORMS[0];

  const subTabs: Array<{ id: WorkspaceSubTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'ar', label: 'AR Revenue & Sheets', icon: Receipt },
    { id: 'ap', label: 'AP Vendor Bills', icon: DollarSign },
    { id: 'bank', label: 'Bank Statements', icon: Landmark },
    { id: 'requests', label: 'Information Requests', icon: ShieldCheck },
    { id: 'pipelines', label: 'Pipelines & Streams', icon: Layers },
    { id: 'settings', label: 'Client Settings', icon: Settings2 },
  ];

  return (
    <div className="space-y-6">
      
      {/* Client Header Banner */}
      <div className="glass-panel-elevated rounded-2xl p-6 shadow-xl border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-3xl shadow-lg shrink-0">
              {currentClient.icon || '🏢'}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-extrabold text-white tracking-tight">
                  {currentClient.name}
                </h1>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                    currentClient.status === 'live'
                      ? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300'
                      : currentClient.status === 'dev'
                      ? 'bg-sky-950/80 border border-sky-500/40 text-sky-300'
                      : 'bg-amber-950/80 border border-amber-500/40 text-amber-300'
                  }`}
                >
                  {currentClient.statusText || (currentClient.status === 'live' ? 'Production Live' : 'In Development')}
                </span>
                
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold flex items-center gap-1 ${
                    currentPlatform.status === 'live'
                      ? 'bg-emerald-950/60 border border-emerald-500/30 text-emerald-300'
                      : 'bg-amber-950/60 border border-amber-500/30 text-amber-300'
                  }`}
                >
                  <span>{currentPlatform.icon}</span>
                  <span>{currentPlatform.name}</span>
                  <span className="text-[9px] opacity-75">({currentPlatform.status === 'live' ? 'Live' : 'Staging'})</span>
                </span>
              </div>
              <p className="text-xs text-sky-400 font-medium mt-0.5">{currentClient.industry}</p>
              <p className="text-xs text-slate-400 mt-1 max-w-3xl line-clamp-2">{currentClient.desc}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setActiveTab('clients')}
              className="flex items-center gap-1.5 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-300 text-xs font-semibold px-3 py-2 rounded-xl transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>All Clients</span>
            </button>

            <button
              onClick={() => setIsWizardOpen(true)}
              className="flex items-center gap-1.5 bg-sky-950/60 hover:bg-sky-900/60 border border-sky-500/40 text-sky-300 text-xs font-semibold px-3.5 py-2 rounded-xl transition cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Setup Guide</span>
            </button>
          </div>
        </div>

        {/* Sub-Tab Navigation Bar */}
        <div className="flex items-center gap-1.5 mt-6 pt-4 border-t border-slate-800/80 overflow-x-auto custom-scrollbar">
          {subTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = workspaceSubTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setWorkspaceSubTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-sky-600 text-white shadow-lg shadow-sky-600/30'
                    : 'bg-slate-950/80 text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-slate-800/80'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sub-View Content */}
      {workspaceSubTab === 'overview' && <ClientOverviewTab />}
      {workspaceSubTab === 'ar' && <ClientArTab />}
      {workspaceSubTab === 'ap' && <ClientApTab />}
      {workspaceSubTab === 'bank' && <ClientBankTab />}
      {workspaceSubTab === 'requests' && <ClientRequestsTab />}
      {workspaceSubTab === 'pipelines' && <ClientPipelinesTab />}
      {workspaceSubTab === 'settings' && <ClientSettingsTab />}

    </div>
  );
};
