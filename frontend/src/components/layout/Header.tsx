import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useClient } from '../../context/ClientContext';
import { useAutomation } from '../../context/AutomationContext';
import { ClientSwitcher } from './ClientSwitcher';
import {
  Menu,
  RefreshCw,
  Zap,
  Calendar,
  Layers,
  Building,
  ShieldCheck,
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

  return (
    <header className="sticky top-0 z-30 bg-slate-950/80 border-b border-slate-800/80 backdrop-blur-xl h-16">
      <div className="h-full px-4 sm:px-6 flex items-center justify-between gap-4">
        
        {/* Left: Mobile Toggle & Client Switcher */}
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenMobileMenu}
            className="p-2 rounded-xl text-slate-400 hover:text-white bg-slate-900 border border-slate-800 lg:hidden cursor-pointer"
            title="Open Navigation Menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <ClientSwitcher />
        </div>

        {/* Center: Global Period (Month / Year) Selector */}
        <div className="hidden sm:flex items-center gap-2 bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-1.5 shadow-inner">
          <Calendar className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-mono">
            Scope:
          </span>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-transparent text-xs font-bold text-white focus:outline-none cursor-pointer"
          >
            {MONTHS.map((m) => (
              <option key={m} value={m} className="bg-slate-900 text-white">
                {m}
              </option>
            ))}
          </select>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="bg-transparent text-xs font-bold text-sky-400 focus:outline-none cursor-pointer ml-1"
          >
            {YEARS.map((y) => (
              <option key={y} value={y} className="bg-slate-900 text-white">
                {y}
              </option>
            ))}
          </select>
        </div>

        {/* Right: Telemetry Health & Live Status */}
        <div className="flex items-center gap-3">
          {/* Mock Mode Tag */}
          {health?.mock_mode && (
            <span className="hidden md:inline-flex items-center gap-1 text-[11px] font-medium bg-amber-950/60 border border-amber-500/30 text-amber-300 px-2.5 py-0.5 rounded-full">
              <span>⚡ Mock Testing Mode</span>
            </span>
          )}

          {/* Live Progress Pill */}
          {pipelineProgress?.is_running && (
            <span className="flex items-center gap-1.5 text-xs text-sky-400 bg-sky-950 border border-sky-500/40 px-3 py-1 rounded-full animate-pulse">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span className="font-mono font-bold">{pipelineProgress.percent}% Processing</span>
            </span>
          )}

          {/* Sync Button */}
          <button
            onClick={() => refreshAll()}
            disabled={isLoading}
            title="Sync Telemetry & State"
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 text-slate-300 hover:text-white bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-sky-400' : ''}`} />
            <span className="hidden sm:inline">Sync</span>
          </button>
        </div>

      </div>
    </header>
  );
};
