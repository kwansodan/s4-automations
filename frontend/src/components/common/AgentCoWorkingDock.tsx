import React from 'react';
import { useAutomation } from '../../context/AutomationContext';
import {
  Bot,
  Sparkles,
  Clock,
  Maximize2,
  Minimize2,
  X,
  Square,
  Activity,
  Users,
  ChevronUp,
} from 'lucide-react';

export const AgentCoWorkingDock: React.FC = () => {
  const {
    pipelineProgress,
    isDockMinimized,
    setIsDockMinimized,
    isDockDismissed,
    setIsDockDismissed,
    setIsTeamModalOpen,
    setIsInvoiceModalOpen,
    stopActivePipeline,
  } = useAutomation();

  if (!pipelineProgress?.is_running || isDockDismissed) {
    return null;
  }

  const percent = Math.min(Math.max(pipelineProgress.percent ?? 0, 0), 100);
  const taskTitle = pipelineProgress.task_name || 'Autonomous Accounting Pipeline';
  const currentStep = pipelineProgress.current_step || 'Autonomous agents collaborating...';
  const elapsed = pipelineProgress.elapsed_seconds;
  const stageIndex = pipelineProgress.stage_index;
  const totalStages = pipelineProgress.total_stages;
  const clientName = pipelineProgress.client_name;

  // Agent Identity
  const agentName = pipelineProgress.agent_name || (
    pipelineProgress.task_name?.includes('Invoice') ? 'Akosua' :
    pipelineProgress.task_name?.includes('Bank') ? 'Kofi' :
    pipelineProgress.task_name?.includes('Report') ? 'Ama' : 'Kwame'
  );

  const agentRole = pipelineProgress.agent_role || (
    agentName === 'Akosua' ? 'Billing & AR Specialist' :
    agentName === 'Kofi' ? 'Bank Reconciliation Agent' :
    agentName === 'Ama' ? 'Financial Reporting Agent' : 'GL & Closing Accountant'
  );

  const collaboratingAgents = pipelineProgress.collaborating_agents || [];

  const handleOpenTeamRoom = () => {
    // If it is specifically the Zoho Invoicing pipeline and modal was used, we can open either or team room
    if (pipelineProgress.task_name?.includes('Invoice') && !pipelineProgress.task_name?.includes('GL')) {
      setIsInvoiceModalOpen(true);
    } else {
      setIsTeamModalOpen(true);
    }
  };

  const handleStop = () => {
    if (window.confirm(`Are you sure you want to stop ${agentName}'s active execution?`)) {
      stopActivePipeline(`Stopped by operator via Co-Working Dock`);
    }
  };

  // 1. Minimized Pill Mode (Slim ~32px, 0% view obstruction)
  if (isDockMinimized) {
    return (
      <aside
        aria-label="Agent co-working dock minimized pill"
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-slate-900/95 border border-emerald-500/50 shadow-xl shadow-black/80 backdrop-blur-md text-white text-xs select-none animate-in fade-in slide-in-from-bottom-2 duration-200"
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
        </span>

        <span className="font-semibold text-emerald-400 flex items-center gap-1">
          <Bot className="w-3.5 h-3.5" />
          {agentName}:
        </span>

        <span className="text-slate-300 font-mono text-[11px] font-bold">
          {percent}%
        </span>

        <span className="text-slate-400 max-w-[130px] sm:max-w-[200px] truncate text-[11px] hidden xs:inline">
          {currentStep}
        </span>

        <div className="flex items-center gap-1 pl-1 border-l border-slate-700/80">
          <button
            type="button"
            onClick={() => setIsDockMinimized(false)}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            title="Expand to card view"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleOpenTeamRoom}
            className="p-1 rounded-md text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/60 transition cursor-pointer"
            title="Open interactive Team Room"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => setIsDockDismissed(true)}
            className="p-1 rounded-md text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition cursor-pointer"
            title="Run quietly in background (check header ticker)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>
    );
  }

  // 2. Full Co-Working Card Mode (Floating bottom-right, ~360px wide)
  return (
    <aside
      aria-label="Active agent co-working dock"
      className="fixed bottom-4 right-4 z-50 w-88 sm:w-96 bg-slate-900/95 border border-emerald-500/40 rounded-2xl p-4 shadow-2xl shadow-black/80 backdrop-blur-md animate-in slide-in-from-bottom-4 duration-300 transition-all text-white select-none"
    >
      {/* Top Header Row with Active Agent Avatar */}
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative shrink-0 w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center shadow-md shadow-emerald-500/20 text-white font-bold text-xs border border-emerald-400/30">
            <Bot className="w-4 h-4 text-white" />
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-900"></span>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-white tracking-tight truncate">{agentName}</span>
              <span className="text-[10px] uppercase font-semibold tracking-wider px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Active
              </span>
            </div>
            <p className="text-[10px] text-slate-400 truncate">{agentRole}</p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1 shrink-0">
          {elapsed !== undefined && (
            <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1 bg-slate-950/70 px-2 py-0.5 rounded-full border border-slate-800">
              <Clock className="w-2.5 h-2.5 text-slate-400" />
              {elapsed}s
            </span>
          )}

          <button
            type="button"
            onClick={() => setIsDockMinimized(true)}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            title="Minimize to slim pill (leaves work area clear)"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleOpenTeamRoom}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-[11px] font-semibold border border-emerald-500/40 transition cursor-pointer active:scale-95"
            title="Expand into full Team Room"
          >
            <Maximize2 className="w-3 h-3" />
            <span>Room</span>
          </button>

          <button
            type="button"
            onClick={handleStop}
            className="p-1 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-950/50 transition cursor-pointer"
            title="Stop autonomous execution"
          >
            <Square className="w-3 h-3 fill-rose-400" />
          </button>

          <button
            type="button"
            onClick={() => setIsDockDismissed(true)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"
            title="Dismiss from screen (keeps running in header)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Task Title & Client Organization badge */}
      <div className="flex items-center justify-between text-[11px] text-slate-300 mb-1.5 px-0.5">
        <span className="font-semibold text-slate-200 truncate">{taskTitle}</span>
        {clientName && (
          <span className="text-[10px] text-teal-300 font-mono truncate bg-teal-950/60 px-1.5 py-0.5 rounded border border-teal-800/40">
            {clientName}
          </span>
        )}
      </div>

      {/* Progress Bar with Gradient and Percentage */}
      <div className="space-y-1 my-2">
        <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800/80 p-0.5">
          <div
            className="bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 h-full rounded-full transition-all duration-300 ease-out shadow-sm shadow-emerald-500/50"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
          <span>
            {stageIndex !== undefined && totalStages !== undefined
              ? `Stage ${stageIndex} of ${totalStages}`
              : 'Autonomous Execution'}
          </span>
          <span className="text-emerald-400 font-bold">{percent}%</span>
        </div>
      </div>

      {/* Current Operational Step & Live Stream */}
      <div className="pt-2 border-t border-slate-800/80">
        <div className="flex items-start gap-2 text-[11px] text-slate-200 bg-slate-950/60 p-2 rounded-xl border border-slate-800/60">
          <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5 animate-pulse" />
          <span className="truncate font-mono text-[11px] text-emerald-300/90 leading-tight">
            {currentStep}
          </span>
        </div>
      </div>

      {/* Collaborating Agents Row */}
      {collaboratingAgents.length > 0 && (
        <div className="flex items-center justify-between pt-2.5 mt-2 border-t border-slate-800/60 text-[10px] text-slate-400">
          <div className="flex items-center gap-1.5 truncate">
            <Users className="w-3 h-3 text-cyan-400 shrink-0" />
            <span className="text-slate-400 font-medium">Team:</span>
            <span className="truncate text-slate-300 font-mono">
              {collaboratingAgents.join(', ')}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsDockDismissed(true)}
            className="text-[10px] text-slate-400 hover:text-emerald-400 underline underline-offset-2 shrink-0 cursor-pointer ml-2"
          >
            Hide Dock
          </button>
        </div>
      )}
    </aside>
  );
};
