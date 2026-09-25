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
  CreditCard,
  Sparkles,
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

  // Tier 1: Client Daily Bookkeeping Workspace
  const clientWorkspaceNavItems = React.useMemo(() => {
    const items: Array<{
      sub: WorkspaceSubTab;
      label: string;
      icon: React.ComponentType<{ className?: string }>;
      badge?: string;
    }> = [
      { sub: 'overview', label: 'Executive Dashboard', icon: LayoutDashboard },
    ];

    if (activeSections.hasAr) {
      items.push({ sub: 'ar', label: isIndividualBusiness ? 'Revenue Slips' : 'AR Revenue Ledger', icon: Receipt });
    }
    if (activeSections.hasAp) {
      items.push({ sub: 'ap', label: 'AP Vendor Bills', icon: DollarSign });
    }
    
    // Unified Bank & Reconciliations (absorbs watched accounts, bank statements, client queries)
    items.push({
      sub: 'requests',
      label: 'Bank & Reconciliations',
      icon: Landmark,
      badge: 'Live',
    });

    return items;
  }, [activeSections, isIndividualBusiness]);

  // Tier 2: Operations, Automations & Master Data
  const operationsNavItems: Array<{
    tab?: ActiveTab;
    sub?: WorkspaceSubTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
  }> = [
    { sub: 'pipelines', label: 'Pipelines & Streams', icon: Layers, badge: `${currentClient?.pipelines?.length || 0}` },
    { tab: 'catalog', label: 'Master Item Catalog', icon: Package },
    { tab: 'contacts', label: 'Contacts & Access', icon: Users },
  ];

  // Tier 3: Settings & Platform Administration
  const settingsNavItems: Array<{
    tab?: ActiveTab;
    sub?: WorkspaceSubTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
  }> = [
    { sub: 'settings', label: isIndividualBusiness ? 'Company Settings' : 'Client Settings', icon: Settings2 },
    ...(user?.role === 'admin'
      ? [
          { tab: 'config' as ActiveTab, label: 'Platform Settings', icon: SlidersHorizontal, badge: 'Admin' },
          { tab: 'billing' as ActiveTab, label: 'Firm Billing', icon: CreditCard },
          { tab: 'social' as ActiveTab, label: 'Release Hub', icon: Sparkles },
        ]
      : []),
    { tab: 'logs' as ActiveTab, label: 'System Logs', icon: Terminal },
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
        className={`fixed top-0 left-0 bottom-0 z-50 flex flex-col bg-[#FFFEE6] border-r border-[#C4BA3B] transition-all duration-300 ${
          isCollapsed ? 'w-20' : 'w-64'
        } ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Top: App Brand & Organization Context Switcher */}
        <div className="h-16 flex items-center justify-between px-3.5 border-b border-[#C4BA3B] shrink-0 relative">
          <div
            onClick={() => handleNav('workspace', 'overview')}
            className="flex items-center gap-2.5 cursor-pointer group overflow-hidden min-w-0"
          >
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-[#FFFEE6] shadow-md shrink-0 group-hover:scale-105 transition-transform ${
              isIndividualBusiness
                ? 'bg-gradient-to-tr from-[#C4BA3B] to-[#E2495B] shadow-[#E2495B]/20'
                : 'bg-gradient-to-tr from-[#E2495B] to-[#C4BA3B] shadow-[#E2495B]/25'
            }`}>
              {isIndividualBusiness ? (
                <span className="text-base">{activeOrganization?.icon || '🧺'}</span>
              ) : (
                <Zap className="w-4 h-4 text-[#FFFEE6]" />
              )}
            </div>
            {!isCollapsed && (
              <div className="min-w-0">
                <span className="text-xs font-extrabold text-[#FFFEE6] tracking-tight block truncate group-hover:text-[#F4ED6E] transition-colors">
                  {isIndividualBusiness
                    ? (activeOrganization?.name?.split('(')[0].trim() || 'ANR Group')
                    : 'S4 Automations'}
                </span>
                <span className="text-[9px] font-mono block truncate text-[#C4BA3B]">
                  {isIndividualBusiness ? 'Direct Business' : 'Accounting Practice'}
                </span>
              </div>
            )}
          </div>

          {/* Desktop Collapse Toggle */}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="hidden lg:flex p-1 rounded-lg text-slate-400 hover:text-[#FFFEE6] hover:bg-slate-900 border border-transparent hover:border-slate-800 transition cursor-pointer"
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
              className="w-full text-left flex items-center justify-between p-2 rounded-xl bg-slate-900/80 hover:bg-slate-850 border border-slate-800 hover:border-[#C4BA3B]/50 transition cursor-pointer group"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm shrink-0">{activeOrganization?.icon || (isIndividualBusiness ? '🧺' : '🏛️')}</span>
                <div className="min-w-0">
                  <span className="text-[11px] font-bold text-[#FFFEE6] block truncate group-hover:text-[#F4ED6E]">
                    {activeOrganization?.name || 'Switch Workspace'}
                  </span>
                  <span className="text-[9px] text-[#C4BA3B] font-mono block truncate">
                    {activeOrganization?.org_type === 'INDIVIDUAL_BUSINESS' ? 'Direct Company Account' : 'Accounting Practice Portfolio'}
                  </span>
                </div>
              </div>
              <ChevronDown className={`w-3 h-3 text-slate-400 group-hover:text-[#FFFEE6] transition-transform ${isOrgDropdownOpen ? 'rotate-180' : ''}`} />
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
                        isCurrent ? 'bg-[#E2495B] text-[#FFFEE6] font-bold shadow-md shadow-[#E2495B]/30' : 'text-slate-300 hover:bg-slate-800 hover:text-[#FFFEE6]'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm shrink-0">{org.icon || (org.org_type === 'INDIVIDUAL_BUSINESS' ? '🧺' : '🏛️')}</span>
                        <div className="min-w-0">
                          <span className="truncate block font-semibold text-[11px]">{org.name}</span>
                          <span className={`text-[8px] font-mono block ${isCurrent ? 'text-[#F4ED6E]' : 'text-slate-400'}`}>
                            {org.org_type === 'INDIVIDUAL_BUSINESS' ? 'Direct Business' : 'Accounting Practice'}
                          </span>
                        </div>
                      </div>
                      {isCurrent && <Check className="w-3.5 h-3.5 shrink-0 text-[#FFFEE6]" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}


        {/* Navigation Links Scrollable Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar py-4 px-3 space-y-6">
          
          {/* TIER 1: CLIENT WORKSPACE */}
          <div className="space-y-1">
            {!isCollapsed && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#C4BA3B] px-3 block mb-1.5 font-mono">
                {isIndividualBusiness ? 'Company Books' : 'Client Books'}
              </span>
            )}

            {clientWorkspaceNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === 'workspace' && workspaceSubTab === item.sub;

              return (
                <button
                  key={item.sub}
                  onClick={() => handleNav('workspace', item.sub)}
                  title={isCollapsed ? item.label : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#E2495B] text-[#FFFEE6] shadow-md shadow-[#E2495B]/30 font-bold'
                      : 'text-[#C4BA3B] hover:text-[#E2495B] hover:bg-[#F4ED6E]'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#FFFEE6]' : 'text-[#C4BA3B]'}`} />
                  {!isCollapsed && (
                    <div className="flex items-center justify-between flex-1 min-w-0">
                      <span className="truncate">{item.label}</span>
                      {item.badge && (
                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                          isActive ? 'bg-[#cf3c4e] text-[#FFFEE6]' : 'bg-[#F4ED6E] text-[#E2495B] border border-[#C4BA3B]'
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

          {/* TIER 2: AUTOMATION & MASTER DATA */}
          <div className="space-y-1">
            {!isCollapsed && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#C4BA3B] px-3 block mb-1.5 font-mono">
                Automations &amp; Setup
              </span>
            )}

            {operationsNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.sub
                ? activeTab === 'workspace' && workspaceSubTab === item.sub
                : activeTab === item.tab;

              return (
                <button
                  key={item.label}
                  onClick={() => (item.sub ? handleNav('workspace', item.sub) : handleNav(item.tab!))}
                  title={isCollapsed ? item.label : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#E2495B] text-[#FFFEE6] shadow-md shadow-[#E2495B]/30 font-bold'
                      : 'text-[#C4BA3B] hover:text-[#E2495B] hover:bg-[#F4ED6E]'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#FFFEE6]' : 'text-[#C4BA3B]'}`} />
                  {!isCollapsed && (
                    <div className="flex items-center justify-between flex-1 min-w-0">
                      <span className="truncate">{item.label}</span>
                      {item.badge && (
                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                          isActive ? 'bg-[#cf3c4e] text-[#FFFEE6]' : 'bg-[#F4ED6E] text-[#E2495B] border border-[#C4BA3B]'
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

          {/* TIER 3: SETTINGS & PLATFORM */}
          <div className="space-y-1">
            {!isCollapsed && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#C4BA3B] px-3 block mb-1.5 font-mono">
                Settings &amp; Platform
              </span>
            )}

            {settingsNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.sub
                ? activeTab === 'workspace' && workspaceSubTab === item.sub
                : activeTab === item.tab;

              return (
                <button
                  key={item.label}
                  onClick={() => (item.sub ? handleNav('workspace', item.sub) : handleNav(item.tab!))}
                  title={isCollapsed ? item.label : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#E2495B] text-[#FFFEE6] shadow-md shadow-[#E2495B]/30 font-bold'
                      : 'text-[#C4BA3B] hover:text-[#E2495B] hover:bg-[#F4ED6E]'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#FFFEE6]' : 'text-[#C4BA3B]'}`} />
                  {!isCollapsed && (
                    <div className="flex items-center justify-between flex-1 min-w-0">
                      <span className="truncate">{item.label}</span>
                      {item.badge && (
                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                          isActive ? 'bg-[#cf3c4e] text-[#FFFEE6]' : 'bg-[#F4ED6E] text-[#E2495B] border border-[#C4BA3B]'
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
        <div className="p-3 border-t border-[#C4BA3B] shrink-0 space-y-2 bg-[#FFFEE6]">

          {/* User Profile / Logout */}
          <div className="flex items-center justify-between gap-2 p-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-8 h-8 rounded-xl bg-[#E2495B]/20 border border-[#E2495B]/40 flex items-center justify-center text-xs text-[#FFFEE6] font-bold shrink-0">
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
