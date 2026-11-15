import React, { useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Bot,
  Building2,
  Globe,
  LayoutDashboard,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Users,
} from 'lucide-react';
import { useAutomation } from '../../context/AutomationContext';
import { useAuth } from '../../context/AuthContext';
import type { AdminTab } from '../../types/admin';
import { AdminOverviewTab } from './AdminOverviewTab';
import { AdminTenantsTab } from './AdminTenantsTab';
import { AdminUsersRbacTab } from './AdminUsersRbacTab';
import { AdminAgentFleetTab } from './AdminAgentFleetTab';
import { AdminAuditTelemetryTab } from './AdminAuditTelemetryTab';
import { CreateTenantModal } from './CreateTenantModal';
import { ConfigSection } from '../config/ConfigSection';
import { LiveConsole } from '../console/LiveConsole';
import { LandingManagerSection } from '../landing/LandingManagerSection';
import { MultiChannelLaunchpad } from '../social/MultiChannelLaunchpad';

interface NavModuleItem {
  id: AdminTab;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const ADMIN_MODULES: NavModuleItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'KPIs & subsystem health',
    icon: LayoutDashboard,
  },
  {
    id: 'tenants',
    label: 'Tenants & Billing',
    description: 'Orgs, white-label & pricing',
    icon: Building2,
  },
  {
    id: 'users',
    label: 'Users & RBAC',
    description: 'Operators & tenant roles',
    icon: Users,
  },
  {
    id: 'agents',
    label: 'Global Agent Fleet',
    description: 'Runs, traces & gateways',
    icon: Bot,
  },
  {
    id: 'config',
    label: 'Integrations & Config',
    description: 'Keys, SMTP & server logs',
    icon: SlidersHorizontal,
  },
  {
    id: 'audit',
    label: 'Audit & Telemetry',
    description: 'Audit logs & AI margins',
    icon: Activity,
  },
  {
    id: 'growth',
    label: 'Growth & Landing',
    description: 'Landing CRM & releases',
    icon: Globe,
  },
];

export const PlatformAdminConsole: React.FC = () => {
  const { user } = useAuth();
  const { adminSubTab, setAdminSubTab, setActiveTab } = useAutomation();

  const [isCreateTenantOpen, setIsCreateTenantOpen] = useState(false);
  const [tenantRefreshSignal, setTenantRefreshSignal] = useState(0);
  const [configSubView, setConfigSubView] = useState<'settings' | 'console'>('settings');
  const [growthSubView, setGrowthSubView] = useState<'landing' | 'broadcaster'>('landing');

  const handleTenantCreated = () => {
    setTenantRefreshSignal((n) => n + 1);
    setAdminSubTab('tenants');
  };

  return (
    <div className="space-y-5">
      {/* Unified Admin Console Header */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#0284C7] to-[#38BDF8] flex items-center justify-center text-white shadow-sm shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base sm:text-lg font-bold text-[#0F172A] tracking-tight">
                S4 Platform Admin Console
              </h1>
              <span className="px-2 py-0.5 rounded-full bg-[#F0F9FF] border border-[#BAE6FD] text-[#0284C7] text-[10px] font-bold uppercase tracking-wider font-mono">
                Super-Admin
              </span>
            </div>
            <p className="text-xs text-[#64748B]">
              Signed in as <span className="font-mono font-semibold text-[#0F172A]">{user?.email}</span>
            </p>
          </div>
        </div>

        <button
          onClick={() => setActiveTab('workspace')}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#F8FAFC] hover:bg-slate-100 border border-[#E2E8F0] text-xs font-semibold text-[#0F172A] transition cursor-pointer self-start sm:self-auto"
        >
          <ArrowLeft className="w-3.5 h-3.5 text-[#0284C7]" />
          Exit Admin to Workspace
        </button>
      </div>

      {/* Responsive Layout: Horizontal Pill Bar (<lg) + Sticky Rail (>=lg) */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* Horizontal nav for mobile & tablet */}
        <div className="w-full lg:hidden flex items-center gap-2 overflow-x-auto pb-1">
          {ADMIN_MODULES.map((mod) => {
            const Icon = mod.icon;
            const active = adminSubTab === mod.id;
            return (
              <button
                key={mod.id}
                onClick={() => setAdminSubTab(mod.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap border transition cursor-pointer shrink-0 ${
                  active
                    ? 'bg-[#F0F9FF] text-[#0284C7] border-[#BAE6FD]'
                    : 'bg-white text-[#64748B] border-[#E2E8F0] hover:bg-slate-50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {mod.label}
              </button>
            );
          })}
        </div>

        {/* Desktop Left Navigation Rail */}
        <aside className="hidden lg:block w-60 shrink-0 bg-white rounded-2xl border border-[#E2E8F0] p-2.5 shadow-xs sticky top-20 space-y-1">
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#64748B] font-mono">
            Platform Modules
          </div>
          {ADMIN_MODULES.map((mod) => {
            const Icon = mod.icon;
            const active = adminSubTab === mod.id;
            return (
              <button
                key={mod.id}
                onClick={() => setAdminSubTab(mod.id)}
                className={`w-full text-left flex items-start gap-2.5 px-3 py-2.5 rounded-xl transition cursor-pointer ${
                  active
                    ? 'bg-[#F0F9FF] text-[#0284C7] border border-[#BAE6FD]'
                    : 'text-[#64748B] hover:bg-[#F8FAFC] hover:text-[#0F172A] border border-transparent'
                }`}
              >
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${active ? 'text-[#0284C7]' : 'text-slate-400'}`} />
                <div className="min-w-0">
                  <div className={`text-xs truncate ${active ? 'font-bold text-[#0284C7]' : 'font-semibold text-[#0F172A]'}`}>
                    {mod.label}
                  </div>
                  <div className="text-[10px] text-[#64748B] truncate">{mod.description}</div>
                </div>
              </button>
            );
          })}
        </aside>

        {/* Module Canvas */}
        <section className="flex-1 min-w-0 w-full space-y-5">
          {adminSubTab === 'overview' && (
            <AdminOverviewTab
              onNavigateTab={(tab) => setAdminSubTab(tab)}
              onOpenCreateTenant={() => setIsCreateTenantOpen(true)}
            />
          )}

          {adminSubTab === 'tenants' && (
            <AdminTenantsTab
              onOpenCreateTenant={() => setIsCreateTenantOpen(true)}
              refreshSignal={tenantRefreshSignal}
            />
          )}

          {adminSubTab === 'users' && <AdminUsersRbacTab />}

          {adminSubTab === 'agents' && <AdminAgentFleetTab />}

          {adminSubTab === 'config' && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 flex flex-wrap items-center justify-between gap-3 shadow-xs">
                <div>
                  <h2 className="text-base font-bold text-[#0F172A]">Platform Integrations, Secrets &amp; Live Console</h2>
                  <p className="text-xs text-[#64748B]">
                    Configure global API keys, RBAC allowlists, gateways, and inspect backend server logs.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setConfigSubView('settings')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer ${
                      configSubView === 'settings'
                        ? 'bg-[#F0F9FF] text-[#0284C7] border-[#BAE6FD]'
                        : 'bg-white text-[#64748B] border-[#E2E8F0] hover:bg-slate-50'
                    }`}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    Global Config &amp; Secrets
                  </button>
                  <button
                    onClick={() => setConfigSubView('console')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer ${
                      configSubView === 'console'
                        ? 'bg-[#F0F9FF] text-[#0284C7] border-[#BAE6FD]'
                        : 'bg-white text-[#64748B] border-[#E2E8F0] hover:bg-slate-50'
                    }`}
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    System Logs &amp; LiveConsole
                  </button>
                </div>
              </div>
              {configSubView === 'settings' ? <ConfigSection /> : <LiveConsole />}
            </div>
          )}

          {adminSubTab === 'audit' && <AdminAuditTelemetryTab />}

          {adminSubTab === 'growth' && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 flex flex-wrap items-center justify-between gap-3 shadow-xs">
                <div>
                  <h2 className="text-base font-bold text-[#0F172A]">Growth, Public Landing &amp; Release Hub</h2>
                  <p className="text-xs text-[#64748B]">
                    Manage visitor landing mode, capture leads, and broadcast changelogs or social announcements.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setGrowthSubView('landing')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer ${
                      growthSubView === 'landing'
                        ? 'bg-[#F0F9FF] text-[#0284C7] border-[#BAE6FD]'
                        : 'bg-white text-[#64748B] border-[#E2E8F0] hover:bg-slate-50'
                    }`}
                  >
                    <Globe className="w-3.5 h-3.5" />
                    Landing Mode &amp; Leads CRM
                  </button>
                  <button
                    onClick={() => setGrowthSubView('broadcaster')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer ${
                      growthSubView === 'broadcaster'
                        ? 'bg-[#F0F9FF] text-[#0284C7] border-[#BAE6FD]'
                        : 'bg-white text-[#64748B] border-[#E2E8F0] hover:bg-slate-50'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Release Hub &amp; Broadcaster
                  </button>
                </div>
              </div>
              {growthSubView === 'landing' ? <LandingManagerSection /> : <MultiChannelLaunchpad />}
            </div>
          )}
        </section>
      </div>

      <CreateTenantModal
        isOpen={isCreateTenantOpen}
        onClose={() => setIsCreateTenantOpen(false)}
        onCreated={handleTenantCreated}
      />
    </div>
  );
};
