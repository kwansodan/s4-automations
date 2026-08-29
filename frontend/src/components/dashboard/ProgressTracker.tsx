import React from 'react';
import { useAutomation } from '../../context/AutomationContext';
import { RefreshCw, CheckCircle2, AlertCircle, PlayCircle, BarChart3 } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';

export const ProgressTracker: React.FC = () => {
  const { pipelineProgress, selectedMonth, selectedYear, setIsPipelineModalOpen } = useAutomation();

  const isRunning = pipelineProgress?.is_running ?? false;
  const percent = pipelineProgress?.percent ?? 0;
  const currentStep = pipelineProgress?.current_step || 'Pipeline idle. Ready for scheduled run or manual trigger.';
  const stats = pipelineProgress?.stats;

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white tracking-tight">
              Daily Vision Ingestion Pipeline
            </h2>
            {isRunning ? (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-sky-400 bg-sky-950/80 border border-sky-500/40 px-2.5 py-0.5 rounded-full animate-pulse">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>Active Execution</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2.5 py-0.5 rounded-full">
                <CheckCircle2 className="w-3 h-3" />
                <span>Ready</span>
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Automated Gemini 3.6 Flash extraction from Google Drive slips into Google Sheets review tables.
          </p>
        </div>

        <button
          onClick={() => setIsPipelineModalOpen(true)}
          disabled={isRunning}
          className="flex items-center justify-center gap-2 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 active:from-sky-700 active:to-indigo-700 text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow-lg shadow-sky-600/25 transition-all disabled:opacity-50 cursor-pointer shrink-0"
        >
          <PlayCircle className="w-4 h-4" />
          <span>Run Pipeline for {selectedMonth} {selectedYear}</span>
        </button>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1.5 mb-6">
        <div className="flex justify-between text-xs font-semibold">
          <span className="text-slate-300 font-mono flex items-center gap-1.5">
            {isRunning && <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />}
            {currentStep}
          </span>
          <span className="text-sky-400 font-mono">{percent}%</span>
        </div>
        <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800 p-0.5">
          <div
            className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 rounded-full transition-all duration-500 shadow-[0_0_12px_#38bdf8]"
            style={{ width: `${Math.max(percent, 2)}%` }}
          />
        </div>
      </div>

      {/* Live Pipeline Telemetry Counters */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-4 border-t border-slate-800/80">
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5 text-center">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Discovered</span>
            <span className="text-base font-extrabold text-white font-mono">{stats.files_discovered} Slips</span>
          </div>
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5 text-center">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Processed</span>
            <span className="text-base font-extrabold text-sky-400 font-mono">{stats.files_processed} Slips</span>
          </div>
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5 text-center">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Items Extracted</span>
            <span className="text-base font-extrabold text-indigo-300 font-mono">{stats.total_items_extracted} Rows</span>
          </div>
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5 text-center">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Discrepancies</span>
            <span className="text-base font-extrabold text-amber-400 font-mono">{stats.linen_discrepancies}</span>
          </div>
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5 text-center col-span-2 sm:col-span-1">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Billed Volume</span>
            <span className="text-base font-extrabold text-emerald-400 font-mono">{formatCurrency(stats.total_billed_amount)}</span>
          </div>
        </div>
      )}
    </div>
  );
};
