import React from 'react';
import { useAutomation } from '../../context/AutomationContext';
import { Loader2, Maximize2, Clock, CheckCircle2 } from 'lucide-react';

export const PipelineFloatingWidget: React.FC = () => {
  const { pipelineProgress, setIsInvoiceModalOpen } = useAutomation();

  if (!pipelineProgress?.is_running) {
    return null;
  }

  const percent = Math.min(Math.max(pipelineProgress.percent ?? 0, 0), 100);
  const taskTitle = pipelineProgress.task_name || 'Zoho Invoicing Pipeline';
  const currentStep = pipelineProgress.current_step || 'Processing operational task...';
  const elapsed = pipelineProgress.elapsed_seconds;
  const stageIndex = pipelineProgress.stage_index;
  const totalStages = pipelineProgress.total_stages;

  const customersDone = pipelineProgress.stats?.customers_done;
  const customersTotal = pipelineProgress.stats?.customers_total;

  return (
    <aside
      aria-label="Active pipeline progress widget"
      className="fixed bottom-5 right-5 z-50 w-84 sm:w-96 bg-slate-900/95 border border-emerald-500/40 rounded-2xl p-4 shadow-2xl shadow-black/70 backdrop-blur-md animate-in slide-in-from-bottom-5 duration-300 transition-all text-white"
    >
      {/* Top Header Row */}
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <span className="text-xs font-bold text-white truncate tracking-tight">{taskTitle}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {elapsed !== undefined && (
            <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1 bg-slate-950/70 px-2 py-0.5 rounded-full border border-slate-800">
              <Clock className="w-2.5 h-2.5 text-slate-400" />
              {elapsed}s
            </span>
          )}
          <button
            type="button"
            onClick={() => setIsInvoiceModalOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-[11px] font-semibold border border-emerald-500/40 transition cursor-pointer active:scale-95"
            title="Expand into full live execution modal"
          >
            <Maximize2 className="w-3 h-3" />
            <span>Expand</span>
          </button>
        </div>
      </div>

      {/* Progress Bar with Gradient and Percentage */}
      <div className="space-y-1 my-2">
        <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-800/80 p-0.5">
          <div
            className="bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-400 h-full rounded-full transition-all duration-300 ease-out shadow-sm shadow-emerald-500/50"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
          <span>
            {stageIndex !== undefined && totalStages !== undefined
              ? `Stage ${stageIndex} of ${totalStages}`
              : 'Processing'}
          </span>
          <span className="text-emerald-400 font-bold">{percent}%</span>
        </div>
      </div>

      {/* Current Operational Step & Customer Counters */}
      <div className="space-y-1.5 pt-1 border-t border-slate-800/70">
        <div className="flex items-start gap-1.5 text-[11px] text-slate-300 leading-tight">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400 shrink-0 mt-0.5" />
          <span className="truncate font-mono text-[11px] text-slate-200">{currentStep}</span>
        </div>

        {customersTotal !== undefined && customersTotal > 0 && (
          <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-teal-400" />
              <span>Customer Invoicing Progress:</span>
            </span>
            <span className="font-mono text-slate-200 font-semibold">
              {customersDone ?? 0} of {customersTotal} Done
            </span>
          </div>
        )}
      </div>
    </aside>
  );
};
