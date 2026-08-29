import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useClient } from '../../context/ClientContext';
import { useAutomation, ActiveTab } from '../../context/AutomationContext';
import { ClientSwitcher } from './ClientSwitcher';
import {
  LayoutDashboard,
  TableProperties,
  FileSpreadsheet,
  Layers,
  SlidersHorizontal,
  Terminal,
  Building,
  LogOut,
  RefreshCw,
  Zap,
} from 'lucide-react';

export const Header: React.FC = () => {
  const { user, logout } = useAuth();
  const { currentClient } = useClient();
  const { activeTab, setActiveTab, health, refreshAll, isLoading, pipelineProgress } = useAutomation();

  const isAnr = currentClient.id === 'anr_group';

  return (
    <header className="sticky top-0 z-40 bg-slate-950/80 border-b border-slate-800/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          
          {/* Left: Brand & Client Switcher */}
          <div className="flex items-center gap-4">
            <div
              onClick={() => setActiveTab('clients')}
              className="flex items-center gap-2.5 cursor-pointer group"
            >
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500/20 to-indigo-500/20 border border-sky-400/40 flex items-center justify-center text-sky-400 group-hover:scale-105 transition-transform shadow-md shadow-sky-500/10">
                <Zap className="w-5 h-5" />
              </div>
              <div className="hidden sm:block">
                <span className="text-sm font-extrabold text-white tracking-tight group-hover:text-sky-300 transition-colors">
                  S4 Automations
                </span>
                <span className="text-[10px] text-slate-400 block font-mono">Accounting Suite</span>
              </div>
            </div>

            <div className="h-6 w-px bg-slate-800 hidden sm:block" />

            <ClientSwitcher />
          </div>

          {/* Center: Navigation Tabs */}
          <nav className="hidden lg:flex items-center gap-1 bg-slate-900/90 border border-slate-800 rounded-xl p-1 shadow-inner">
            {isAnr ? (
              <>
                <button
                  onClick={() => setActiveTab('dashboard')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    activeTab === 'dashboard'
                      ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <LayoutDashboard className="w-3.5 h-3.5" />
                  <span>Dashboard</span>
                </button>

                <button
                  onClick={() => setActiveTab('sheets')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    activeTab === 'sheets'
                      ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <TableProperties className="w-3.5 h-3.5" />
                  <span>Review Sheets</span>
                </button>

                <button
                  onClick={() => setActiveTab('invoicing')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    activeTab === 'invoicing'
                      ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Zoho Invoicing</span>
                </button>

                <button
                  onClick={() => setActiveTab('catalog')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    activeTab === 'catalog'
                      ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Catalog</span>
                </button>

                <button
                  onClick={() => setActiveTab('config')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    activeTab === 'config'
                      ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>Settings</span>
                </button>
              </>
            ) : (
              <button
                onClick={() => setActiveTab('workspace')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'workspace'
                    ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Client Blueprint</span>
              </button>
            )}

            <button
              onClick={() => setActiveTab('logs')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'logs'
                  ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Logs</span>
            </button>

            <button
              onClick={() => setActiveTab('clients')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'clients'
                  ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Building className="w-3.5 h-3.5" />
              <span>All Clients</span>
            </button>
          </nav>

          {/* Right: Sync & User Profile */}
          <div className="flex items-center gap-3">
            {/* Health / Mock Status */}
            {health?.mock_mode && (
              <span className="hidden md:inline-flex items-center gap-1 text-[11px] font-medium bg-amber-950/60 border border-amber-500/30 text-amber-300 px-2 py-0.5 rounded-full">
                <span>⚡ Mock Mode</span>
              </span>
            )}

            {/* Live Progress Pill */}
            {pipelineProgress?.is_running && (
              <span className="flex items-center gap-1.5 text-xs text-sky-400 bg-sky-950 border border-sky-500/40 px-2.5 py-1 rounded-full animate-pulse">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>{pipelineProgress.percent}% Processing</span>
              </span>
            )}

            {/* Sync Button */}
            <button
              onClick={() => refreshAll()}
              disabled={isLoading}
              title="Sync Telemetry"
              className="p-2 text-slate-400 hover:text-white bg-slate-900 border border-slate-800 rounded-lg hover:border-slate-700 transition cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-sky-400' : ''}`} />
            </button>

            {/* User Profile Pill */}
            <div className="hidden sm:flex items-center gap-2 bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-1.5">
              <span className="w-6 h-6 rounded-full bg-sky-600/30 border border-sky-500/40 flex items-center justify-center text-xs text-sky-400 font-bold">
                {user?.email?.[0]?.toUpperCase() || 'S'}
              </span>
              <div className="text-left">
                <span className="text-xs font-semibold text-slate-200 block leading-tight max-w-[120px] truncate">
                  {user?.email?.split('@')[0] || 'Admin'}
                </span>
                <span className="text-[10px] text-emerald-400 font-mono block leading-tight">Verified</span>
              </div>
            </div>

            {/* Logout Button */}
            <button
              onClick={() => logout()}
              title="Sign Out"
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-red-300 bg-slate-900 hover:bg-red-950/40 border border-slate-800 hover:border-red-500/30 px-3 py-1.5 rounded-xl transition-all cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
