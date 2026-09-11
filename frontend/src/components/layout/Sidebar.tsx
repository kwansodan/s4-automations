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
  Package,
  SlidersHorizontal,
  Terminal,
  Zap,
  ChevronLeft,
  ChevronRight,
  LogOut,
  ChevronDown,
  Check,
  Share2,
  BookOpen,
  Users,
  Globe,
} from 'lucide-react';

interface SidebarProps {
  isMobileOpen: boolean;
  setIsMobileOpen: (open: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isMobileOpen, setIsMobileOpen }) => {
  const { user, logout, switchOrganization } = useAuth();
  const {
    currentClient,
    isIndividualBusiness,
    isAccountingFirm,
    activeOrganization,
    activeSections,
  } = useClient();
  const {
    activeTab,
    setActiveTab,
    workspaceSubTab,
    setWorkspaceSubTab,
  } = useAutomation();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isOrgDropdownOpen, setIsOrgDropdownOpen] = useState(false);

  const handleNav = (tab: ActiveTab, sub?: WorkspaceSubTab) => {
    if (tab === 'workspace' && sub) {
      setWorkspaceSubTab(sub);
    } else {
      setActiveTab(tab);
      if (sub) {
        setWorkspaceSubTab(sub);
      }
    }
    setIsMobileOpen(false);
  };

  const clientCoreNavItems: Array<{
    sub: WorkspaceSubTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
  }> = [
    { sub: 'overview', label: 'Overview', icon: LayoutDashboard },
  ];

  const clientWatchedNavItems: Array<{
    sub: WorkspaceSubTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
  }> = [
    {
      sub: 'requests',
      label: isIndividualBusiness ? 'Clarification Requests' : 'Information Requests',
      icon: ShieldCheck,
      badge: 'Watched',
    },
  ];

  const clientPipelineNavItems = React.useMemo(() => {
    const items: Array<{
      sub: WorkspaceSubTab;
      label: string;
      icon: React.ComponentType<{ className?: string }>;
      badge?: string;
    }> = [];
    if (activeSections.hasAr) {
      items.push({ sub: 'ar', label: isIndividualBusiness ? 'AR Revenue & Control Slips' : 'AR Revenue & Sheets', icon: Receipt });
    }
    if (activeSections.hasAp) {
      items.push({ sub: 'ap', label: 'AP Vendor Bills', icon: DollarSign });
    }
    if (activeSections.hasBank) {
      items.push({ sub: 'bank', label: 'Bank Statements', icon: Landmark });
    }
    items.push({ sub: 'pipelines', label: 'Pipelines & Streams', icon: Layers, badge: `${currentClient?.pipelines?.length || 0}` });
    return items;
  }, [activeSections, isIndividualBusiness, currentClient?.pipelines?.length]);

  const clientConfigNavItems: Array<{
    sub: WorkspaceSubTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
  }> = [
    { sub: 'settings', label: isIndividualBusiness ? 'Company Settings' : 'Client Settings', icon: Settings2 },
  ];

  const accountingSuiteNavItems: Array<{
    tab: ActiveTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
  }> = [
    { tab: 'contacts', label: 'Contacts & Team', icon: Users, badge: 'Invite' },
    { tab: 'catalog', label: 'Master Item Catalog', icon: Package },
  ];

  const platformNavItems: Array<{
    tab: ActiveTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
  }> = [
    { tab: 'changelog', label: "What's New", icon: BookOpen },
    { tab: 'social', label: 'Release Broadcaster', icon: Share2, badge: 'AI' },
    ...(user?.role === 'admin'
      ? [
          { tab: 'landing-manager' as ActiveTab, label: 'Landing Page Manager', icon: Globe, badge: 'Public' },
          { tab: 'config' as ActiveTab, label: 'Platform Settings', icon: SlidersHorizontal, badge: 'Admin' },
        ]
      : []),
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
        {/* Top: App Brand & Organization Context Switcher */}
        <div className="h-16 flex items-center justify-between px-3.5 border-b border-slate-800/80 shrink-0 relative">
          <div
            onClick={() => handleNav('workspace', 'overview')}
            className="flex items-center gap-2.5 cursor-pointer group overflow-hidden min-w-0"
          >
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-md shrink-0 group-hover:scale-105 transition-transform ${
              isIndividualBusiness
                ? 'bg-gradient-to-tr from-amber-500 to-orange-600 shadow-amber-500/20'
                : 'bg-gradient-to-tr from-sky-500 to-indigo-600 shadow-sky-500/20'
            }`}>
              {isIndividualBusiness ? (
                <span className="text-base">{activeOrganization?.icon || '🧺'}</span>
              ) : (
                <Zap className="w-4 h-4" />
              )}
            </div>
            {!isCollapsed && (
              <div className="min-w-0">
                <span className="text-xs font-extrabold text-white tracking-tight block truncate group-hover:text-sky-300 transition-colors">
                  {isIndividualBusiness
                    ? (activeOrganization?.name?.split('(')[0].trim() || 'ANR Group')
                    : 'S4 Automations'}
                </span>
                <span className="text-[9px] font-mono block truncate text-slate-400">
                  {isIndividualBusiness ? 'Direct Business' : 'Accounting Practice'}
                </span>
              </div>
            )}
          </div>

          {/* Desktop Collapse Toggle */}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="hidden lg:flex p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 border border-transparent hover:border-slate-800 transition cursor-pointer"
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Dual-Mode Organization Switcher Badge */}
        {!isCollapsed && user?.organizations && user.organizations.length > 1 && (
          <div className="px-3 pt-2.5 relative">
            <button
              onClick={() => setIsOrgDropdownOpen(!isOrgDropdownOpen)}
              className="w-full text-left flex items-center justify-between p-2 rounded-xl bg-slate-900/80 hover:bg-slate-850 border border-slate-800 hover:border-sky-500/40 transition cursor-pointer group"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm shrink-0">{activeOrganization?.icon || (isIndividualBusiness ? '🧺' : '🏛️')}</span>
                <div className="min-w-0">
                  <span className="text-[11px] font-bold text-white block truncate group-hover:text-sky-300">
                    {activeOrganization?.name || 'Switch Workspace'}
                  </span>
                  <span className="text-[9px] text-sky-400 font-mono block truncate">
                    {activeOrganization?.org_type === 'INDIVIDUAL_BUSINESS' ? 'Direct Company Account' : 'Accounting Practice Portfolio'}
                  </span>
                </div>
              </div>
              <ChevronDown className={`w-3 h-3 text-slate-400 group-hover:text-white transition-transform ${isOrgDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOrgDropdownOpen && (
              <div className="absolute left-3 right-3 top-full mt-1 bg-slate-900 border border-slate-700 rounded-xl p-1.5 shadow-2xl z-50 animate-in fade-in">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1 block font-mono">
                  Switch Workspace Model
                </span>
                {user.organizations.map((org) => {
                  const isCurrent = (activeOrganization?.id || 's4_advisory') === org.id;
                  return (
                    <button
                      key={org.id}
                      onClick={async () => {
                        await switchOrganization(org.id);
                        setIsOrgDropdownOpen(false);
                      }}
                      className={`w-full text-left flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                        isCurrent ? 'bg-sky-600 text-white font-bold' : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm shrink-0">{org.icon || (org.org_type === 'INDIVIDUAL_BUSINESS' ? '🧺' : '🏛️')}</span>
                        <div className="min-w-0">
                          <span className="truncate block font-semibold text-[11px]">{org.name}</span>
                          <span className={`text-[8px] font-mono block ${isCurrent ? 'text-sky-200' : 'text-slate-400'}`}>
                            {org.org_type === 'INDIVIDUAL_BUSINESS' ? 'Direct Business' : 'Accounting Practice'}
                          </span>
                        </div>
                      </div>
                      {isCurrent && <Check className="w-3.5 h-3.5 shrink-0" />}
                    </button>
                  );
                })}
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
                {isIndividualBusiness ? 'Company' : 'Client Workspace'}
              </span>
            )}

            {clientCoreNavItems.map((item) => {
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

          {/* GROUP 2: WATCHED ACCOUNTS & INFORMATION REQUESTS */}
          <div className="space-y-1">
            {!isCollapsed && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400/80 px-3 block mb-1.5 font-mono">
                Watched Accounts
              </span>
            )}

            {clientWatchedNavItems.map((item) => {
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
                      : 'text-sky-300/90 hover:text-white hover:bg-slate-900/80'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-sky-400'}`} />
                  {!isCollapsed && (
                    <div className="flex items-center justify-between flex-1 min-w-0">
                      <span className="truncate">{item.label}</span>
                      {item.badge && (
                        <span className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded uppercase ${
                          isActive ? 'bg-sky-700 text-white' : 'bg-sky-950 text-sky-300 border border-sky-500/30'
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

          {/* GROUP 3: INGESTION PIPELINES */}
          <div className="space-y-1">
            {!isCollapsed && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-3 block mb-1.5 font-mono">
                Ingestion Pipelines
              </span>
            )}

            {clientPipelineNavItems.map((item) => {
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

          {/* GROUP 4: SETTINGS */}
          <div className="space-y-1">
            {!isCollapsed && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-3 block mb-1.5 font-mono">
                Settings
              </span>
            )}

            {clientConfigNavItems.map((item) => {
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

          {/* GROUP 5: ACCOUNTING SUITE (FIRM & PRACTICE TOOLS) */}
          <div className="space-y-1">
            {!isCollapsed && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-3 block mb-1.5 font-mono">
                Accounting Suite
              </span>
            )}

            {accountingSuiteNavItems.map((item) => {
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

          {/* GROUP 6: PLATFORM & SYSTEM MANAGEMENT */}
          <div className="space-y-1">
            {!isCollapsed && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-3 block mb-1.5 font-mono">
                Platform &amp; System
              </span>
            )}

            {platformNavItems.map((item) => {
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
        </div>

        {/* Bottom User & Health Footer */}
        <div className="p-3 border-t border-slate-800/80 shrink-0 space-y-2 bg-slate-950/80">

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
                  <span className="text-[10px] text-emerald-400 font-mono block">
                    {user?.role === 'admin' ? 'Platform Administrator' : user?.role === 'bookkeeper' ? 'Staff Bookkeeper' : 'Auditor'}
                  </span>
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
