import React from 'react';
import { useAutomation } from '../../context/AutomationContext';
import { useErrors } from '../../context/ErrorContext';
import { RefreshCw, CheckCircle2, AlertCircle, PlayCircle, BarChart3, Terminal } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';

export const ProgressTracker: React.FC = () => {
  const { pipelineProgress, selectedMonth, selectedYear, setIsPipelineModalOpen } = useAutomation();
  const { openDebugDrawer } = useErrors();

  const isRunning = pipelineProgress?.is_running ?? false;
  const isError =
    pipelineProgress?.status === 'FAILED' ||
    Boolean((pipelineProgress as any)?.error_message);
  const errorMessage = (pipelineProgress as any)?.error_message;
  const percent = pipelineProgress?.percent ?? 0;
  const currentStep = pipelineProgress?.current_step || 'Pipeline idle. Ready for scheduled run or manual trigger.';
  const stats = pipelineProgress?.stats;

  return (
    <div className={`bg-slate-900/90 border rounded-2xl p-6 shadow-xl backdrop-blur-xl transition-all ${
      isError ? 'border-red-500/40 shadow-[0_0_25px_rgba(239,68,68,0.15)]' : 'border-slate-800'
    }`}>
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
            ) : isError ? (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-rose-300 bg-rose-950/80 border border-rose-500/40 px-2.5 py-0.5 rounded-full animate-pulse">
                <AlertCircle className="w-3 h-3 text-rose-400" />
                <span>Execution Failed</span>
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

      {/* Error Alert Box if pipeline failed */}
      {isError && (
        <div className="mb-5 p-3.5 bg-red-950/40 border border-red-500/40 rounded-xl flex items-start justify-between gap-3 text-xs animate-in fade-in">
          <div className="flex items-start gap-2.5 min-w-0">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-red-300 block mb-0.5">Pipeline Stage Interrupted:</span>
              <p className="text-red-200/90 font-mono text-[11px] break-all">{errorMessage || currentStep}</p>
            </div>
          </div>

          <button
            onClick={() => openDebugDrawer('errors')}
            className="flex items-center gap-1 text-[11px] font-bold text-red-300 hover:text-white bg-red-900/60 hover:bg-red-800/80 border border-red-500/40 px-3 py-1.5 rounded-lg transition cursor-pointer shrink-0"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Inspect Trace</span>
          </button>
        </div>
      )}

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
