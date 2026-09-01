import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useClient } from '../../context/ClientContext';
import { useAutomation, ActiveTab, WorkspaceSubTab } from '../../context/AutomationContext';
import {
  LayoutDashboard,
  Receipt,
  DollarSign,
  Landmark,
  ShieldCheck,
  Layers,
  Settings2,
  Building2,
  Package,
  SlidersHorizontal,
  Terminal,
  Zap,
  ChevronLeft,
  ChevronRight,
  LogOut,
  ExternalLink,
  ChevronDown,
  Sparkles,
} from 'lucide-react';

interface SidebarProps {
  isMobileOpen: boolean;
  setIsMobileOpen: (open: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isMobileOpen, setIsMobileOpen }) => {
  const { user, logout } = useAuth();
  const { currentClient, clients, setClient } = useClient();
  const {
    activeTab,
    setActiveTab,
    workspaceSubTab,
    setWorkspaceSubTab,
    health,
    pipelineProgress,
  } = useAutomation();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);

  const handleNav = (tab: ActiveTab, sub?: WorkspaceSubTab) => {
    setActiveTab(tab);
    if (sub) {
      setWorkspaceSubTab(sub);
    }
    setIsMobileOpen(false);
  };

  const clientNavItems: Array<{
    sub: WorkspaceSubTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
  }> = [
    { sub: 'overview', label: 'Overview', icon: LayoutDashboard },
    { sub: 'ar', label: 'AR Revenue & Sheets', icon: Receipt },
    { sub: 'ap', label: 'AP Vendor Bills', icon: DollarSign },
    { sub: 'bank', label: 'Bank Statements', icon: Landmark },
    { sub: 'requests', label: 'Info Requests', icon: ShieldCheck },
    { sub: 'pipelines', label: 'Pipelines & Streams', icon: Layers, badge: `${currentClient?.pipelines?.length || 0}` },
    { sub: 'settings', label: 'Client Settings', icon: Settings2 },
  ];

  const globalNavItems: Array<{
    tab: ActiveTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
  }> = [
    { tab: 'clients', label: 'All Clients', icon: Building2, badge: `${clients.length}` },
    { tab: 'catalog', label: 'Master Catalog & CoA', icon: Package },
    { tab: 'config', label: 'System Diagnostics', icon: SlidersHorizontal },
    { tab: 'logs', label: 'Live Telemetry Logs', icon: Terminal },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          onClick={() => setIsMobileOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed top-0 left-0 bottom-0 z-50 flex flex-col bg-slate-950/95 border-r border-slate-800/80 backdrop-blur-2xl transition-all duration-300 ${
          isCollapsed ? 'w-20' : 'w-64'
        } ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Top: App Brand */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800/80 shrink-0">
          <div
            onClick={() => handleNav('workspace', 'overview')}
            className="flex items-center gap-3 cursor-pointer group overflow-hidden"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-sky-500/20 shrink-0 group-hover:scale-105 transition-transform">
              <Zap className="w-5 h-5" />
            </div>
            {!isCollapsed && (
              <div className="min-w-0">
                <span className="text-sm font-extrabold text-white tracking-tight block truncate group-hover:text-sky-300 transition-colors">
                  S4 Automations
                </span>
                <span className="text-[10px] text-slate-400 font-mono block truncate">
                  Multi-Client Suite
                </span>
              </div>
            )}
          </div>

          {/* Desktop Collapse Toggle */}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="hidden lg:flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 border border-transparent hover:border-slate-800 transition cursor-pointer"
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Client Switcher Card in Sidebar */}
        {!isCollapsed && currentClient && (
          <div className="p-3 border-b border-slate-800/60 relative">
            <div
              onClick={() => setIsClientDropdownOpen(!isClientDropdownOpen)}
              className="bg-slate-900/90 hover:bg-slate-850 border border-slate-800 hover:border-sky-500/40 rounded-xl p-2.5 flex items-center justify-between cursor-pointer transition"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-xl shrink-0">{currentClient.icon || '🏢'}</span>
                <div className="min-w-0">
                  <span className="text-xs font-bold text-white block truncate">{currentClient.name}</span>
                  <span className="text-[10px] text-sky-400 font-mono block truncate">{currentClient.industry}</span>
                </div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </div>

            {/* Quick Dropdown Menu */}
            {isClientDropdownOpen && (
              <div className="absolute left-3 right-3 top-full mt-1 bg-slate-900 border border-slate-700 rounded-xl p-1.5 shadow-2xl z-50 max-h-60 overflow-y-auto custom-scrollbar animate-in fade-in">
                <span className="text-[10px] font-bold text-slate-400 uppercase px-2 py-1 block">
                  Switch Active Client
                </span>
                {clients.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setClient(c.id);
                      setIsClientDropdownOpen(false);
                      handleNav('workspace', 'overview');
                    }}
                    className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                      currentClient.id === c.id
                        ? 'bg-sky-600 text-white font-bold'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <span>{c.icon}</span>
                    <span className="truncate">{c.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Navigation Links Scrollable Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar py-4 px-3 space-y-6">
          
          {/* GROUP 1: ACTIVE CLIENT WORKSPACE */}
          <div className="space-y-1">
            {!isCollapsed && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-3 block mb-1.5 font-mono">
                Client Workspace
              </span>
            )}

            {clientNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === 'workspace' && workspaceSubTab === item.sub;

              return (
                <button
                  key={item.sub}
                  onClick={() => handleNav('workspace', item.sub)}
                  title={isCollapsed ? item.label : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-sky-600 text-white shadow-lg shadow-sky-600/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  {!isCollapsed && (
                    <div className="flex items-center justify-between flex-1 min-w-0">
                      <span className="truncate">{item.label}</span>
                      {item.badge && (
                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded ${
                          isActive ? 'bg-sky-700 text-white' : 'bg-slate-800 text-slate-400'
                        }`}>
                          {item.badge}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* GROUP 2: GLOBAL SUITE MANAGEMENT */}
          <div className="space-y-1">
            {!isCollapsed && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-3 block mb-1.5 font-mono">
                Accounting Suite
              </span>
            )}

            {globalNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.tab;

              return (
                <button
                  key={item.tab}
                  onClick={() => handleNav(item.tab)}
                  title={isCollapsed ? item.label : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-sky-600 text-white shadow-lg shadow-sky-600/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  {!isCollapsed && (
                    <div className="flex items-center justify-between flex-1 min-w-0">
                      <span className="truncate">{item.label}</span>
                      {item.badge && (
                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded ${
                          isActive ? 'bg-sky-700 text-white' : 'bg-slate-800 text-slate-400'
                        }`}>
                          {item.badge}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* GROUP 3: EXTERNAL CLIENT PORTAL */}
          <div className="space-y-1 pt-2 border-t border-slate-850">
            {!isCollapsed && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-3 block mb-1.5 font-mono">
                External Portal
              </span>
            )}

            <button
              onClick={() => handleNav('portal')}
              title={isCollapsed ? 'Client Clarification Portal' : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'portal'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'text-indigo-300 hover:text-indigo-100 hover:bg-indigo-950/40 border border-indigo-500/20'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0" />
              {!isCollapsed && <span className="truncate">Client Portal View</span>}
            </button>
          </div>

        </div>

        {/* Bottom User & Health Footer */}
        <div className="p-3 border-t border-slate-800/80 shrink-0 space-y-2 bg-slate-950/80">
          {/* Live Progress Pill if Running */}
          {pipelineProgress?.is_running && !isCollapsed && (
            <div className="flex items-center gap-2 p-2 rounded-xl bg-sky-950/80 border border-sky-500/40 text-xs text-sky-300 animate-pulse">
              <Zap className="w-3.5 h-3.5 animate-spin text-sky-400" />
              <span className="truncate font-mono">{pipelineProgress.percent}% Processing</span>
            </div>
          )}

          {/* User Profile / Logout */}
          <div className="flex items-center justify-between gap-2 p-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-8 h-8 rounded-xl bg-sky-600/20 border border-sky-500/40 flex items-center justify-center text-xs text-sky-400 font-bold shrink-0">
                {user?.email?.[0]?.toUpperCase() || 'S'}
              </span>
              {!isCollapsed && (
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-white block truncate">
                    {user?.email?.split('@')[0] || 'Admin'}
                  </span>
                  <span className="text-[10px] text-emerald-400 font-mono block">Accounting Admin</span>
                </div>
              )}
            </div>

            <button
              onClick={() => logout()}
              title="Sign Out"
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

      </aside>
    </>
  );
};
