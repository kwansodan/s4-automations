import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useClient } from '../../context/ClientContext';
import { useAutomation } from '../../context/AutomationContext';
import { useErrors } from '../../context/ErrorContext';
import { ClientSwitcher } from './ClientSwitcher';
import {
  Menu,
  RefreshCw,
  Zap,
  Calendar,
  Layers,
  Building,
  ShieldCheck,
  AlertTriangle,
  Terminal,
} from 'lucide-react';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const YEARS = [2025, 2026, 2027];

interface HeaderProps {
  onOpenMobileMenu?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenMobileMenu }) => {
  const { user } = useAuth();
  const { currentClient } = useClient();
  const {
    activeTab,
    selectedMonth,
    setSelectedMonth,
    selectedYear,
    setSelectedYear,
    health,
    refreshAll,
    isLoading,
    pipelineProgress,
  } = useAutomation();
  const { errors, unreadErrorsCount, openDebugDrawer } = useErrors();

  return (
    <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-[#E2E8F0] h-16 shadow-[0_1px_2px_0_rgba(15,23,42,0.03)]">
      <div className="h-full px-4 sm:px-6 flex items-center justify-between gap-4">
        
        {/* Left: Mobile Toggle & Client Switcher */}
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenMobileMenu}
            className="p-2 rounded-xl text-slate-500 hover:text-slate-800 bg-white border border-[#E2E8F0] hover:bg-slate-50 lg:hidden cursor-pointer shadow-sm transition"
            title="Open Navigation Menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <ClientSwitcher />
        </div>

        {/* Center: Global Period (Month / Year) Selector */}
        <div className="hidden sm:flex items-center gap-2 bg-white border border-[#E2E8F0] rounded-xl px-3 py-1.5 shadow-sm">
          <Calendar className="w-3.5 h-3.5 text-[#0284C7]" />
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider font-mono">
            Scope:
          </span>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
          >
            {MONTHS.map((m) => (
              <option key={m} value={m} className="bg-white text-slate-800">
                {m}
              </option>
            ))}
          </select>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="bg-transparent text-xs font-bold text-[#0284C7] focus:outline-none cursor-pointer ml-1"
          >
            {YEARS.map((y) => (
              <option key={y} value={y} className="bg-white text-slate-800">
                {y}
              </option>
            ))}
          </select>
        </div>

        {/* Right: Telemetry Health & Live Status */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Mock Mode Tag */}
          {health?.mock_mode && (
            <span className="hidden md:inline-flex items-center gap-1 text-[11px] font-medium bg-amber-50 border border-amber-200 text-amber-700 px-2.5 py-0.5 rounded-full">
              <span>⚡ Mock Testing Mode</span>
            </span>
          )}

          {/* Live Progress Pill */}
          {pipelineProgress?.is_running && (
            <span className="flex items-center gap-1.5 text-xs text-[#0284C7] bg-[#F0F9FF] border border-[#BAE6FD] px-3 py-1 rounded-full animate-pulse font-medium">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span className="font-mono font-bold">{pipelineProgress.percent}% Processing</span>
            </span>
          )}

          {/* Sync Button */}
          <button
            onClick={() => refreshAll()}
            disabled={isLoading}
            title="Sync Telemetry & State"
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 text-slate-700 hover:text-slate-900 bg-white border border-[#E2E8F0] hover:bg-slate-50 rounded-xl transition cursor-pointer shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#0284C7]' : 'text-slate-400'}`} />
            <span className="hidden sm:inline">Sync</span>
          </button>

          {/* In-App Debug Inspector Trigger */}
          <button
            onClick={() => openDebugDrawer('errors')}
            className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl border transition cursor-pointer shadow-sm ${
              errors.length > 0
                ? 'bg-[#FFF1F2] hover:bg-rose-100 border-[#FECDD3] text-[#E11D48] animate-pulse'
                : 'bg-white hover:bg-slate-50 border-[#E2E8F0] text-slate-600 hover:text-[#0284C7]'
            }`}
            title="Open In-App Debug Inspector (Ctrl+Shift+D)"
          >
            {errors.length > 0 ? (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-[#E11D48]" />
                <span className="font-mono">{errors.length} {errors.length === 1 ? 'Issue' : 'Issues'}</span>
              </>
            ) : (
              <>
                <Terminal className="w-3.5 h-3.5 text-slate-400" />
                <span className="hidden md:inline font-mono">Debug</span>
              </>
            )}
          </button>
        </div>

      </div>
    </header>
  );
};
