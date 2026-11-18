import React, { useEffect, useRef } from 'react';
import { useAutomation } from '../../context/AutomationContext';
import {
  Bot,
  Users,
  Clock,
  Minimize2,
  X,
  Square,
  CheckCircle2,
  Circle,
  Activity,
  Terminal,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';

export const AgentTeamRoomModal: React.FC = () => {
  const {
    pipelineProgress,
    isTeamModalOpen,
    setIsTeamModalOpen,
    stopActivePipeline,
    setIsDockDismissed,
  } = useAutomation();

  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isTeamModalOpen && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [pipelineProgress?.recent_logs, pipelineProgress?.logs, isTeamModalOpen]);

  if (!isTeamModalOpen || !pipelineProgress) {
    return null;
  }

  const percent = Math.min(Math.max(pipelineProgress.percent ?? 0, 0), 100);
  const taskTitle = pipelineProgress.task_name || 'Autonomous Month-End Close & Reporting';
  const currentStep = pipelineProgress.current_step || 'Agents collaborating on autonomous procedures...';
  const elapsed = pipelineProgress.elapsed_seconds ?? 0;
  const stageIndex = pipelineProgress.stage_index ?? 1;
  const totalStages = pipelineProgress.total_stages ?? 5;
  const month = pipelineProgress.month || '';
  const year = pipelineProgress.year || '';
  const clientName = pipelineProgress.client_name;

  const leadAgentName = pipelineProgress.agent_name || (
    pipelineProgress.task_name?.includes('Report') ? 'Ama' : 'Kwame'
  );
  const leadAgentRole = pipelineProgress.agent_role || (
    leadAgentName === 'Ama' ? 'Statutory Financial Reporting Agent' : 'General Ledger & Closing Accountant'
  );

  const teamAgents = [
    {
      name: 'Kwame',
      role: 'GL & Closing Accountant',
      section: 'GL',
      status: leadAgentName === 'Kwame' ? 'Executing procedures' : 'Standby for adjustments',
      isActive: leadAgentName === 'Kwame',
    },
    {
      name: 'Akosua',
      role: 'Billing & AR Specialist',
      section: 'AR',
      status: percent > 20 ? 'Subledger tied out' : 'Verifying customer balances',
      isActive: leadAgentName === 'Akosua',
    },
    {
      name: 'Kofi',
      role: 'Bank Reconciliation Agent',
      section: 'Bank',
      status: percent > 30 ? 'Cash book reconciled' : 'Matching statement lines',
      isActive: leadAgentName === 'Kofi',
    },
    {
      name: 'Ama',
      role: 'Financial Reporting Agent',
      section: 'FR',
      status: percent >= 90 ? 'Synthesizing statement pack' : 'Standing by for sealed trial balance',
      isActive: leadAgentName === 'Ama' || percent >= 90,
    },
  ];

  const STAGES = [
    { num: 1, title: 'Checklist Formulation', desc: 'On-launch entity-tailored close runbook' },
    { num: 2, title: 'Subledger Tie-Outs', desc: 'AR, AP, and Bank cross-agent tie-outs' },
    { num: 3, title: 'Pre-Flight Discovery', desc: 'Trial balance unmapped & anomaly scan' },
    { num: 4, title: 'Runbook Execution', desc: 'Depreciation, prepayments, accruals, FX' },
    { num: 5, title: 'Post-Posting Equilibrium', desc: 'Audit after post and sealed reporting' },
  ];

  const handleRunInBackground = () => {
    setIsTeamModalOpen(false);
    setIsDockDismissed(false);
  };

  const handleStop = () => {
    if (window.confirm(`Stop autonomous execution for ${leadAgentName}?`)) {
      stopActivePipeline('Stopped by operator from Team Room');
      setIsTeamModalOpen(false);
    }
  };

  // Compile unified log entries
  const logs = pipelineProgress.logs || [];
  const recentLogs = pipelineProgress.recent_logs || [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="team-room-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/80 overflow-hidden text-slate-100">
        
        {/* Header Bar */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-cyan-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20 border border-emerald-400/30">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="team-room-title" className="text-base font-bold text-white tracking-tight">
                  Autonomous Accounting Team Room
                </h2>
                <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-500/30">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  Live Co-Working
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">
                {taskTitle} {clientName ? `(${clientName})` : ''} · {month} {year}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-slate-950/80 px-3 py-1.5 rounded-xl border border-slate-800 text-xs font-mono text-slate-300">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>{elapsed}s elapsed</span>
            </div>

            <button
              type="button"
              onClick={handleRunInBackground}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition cursor-pointer active:scale-95"
              title="Run in background (returns to your workspace without stopping the agents)"
            >
              <Minimize2 className="w-3.5 h-3.5 text-slate-400" />
              <span>Run in Background</span>
            </button>

            <button
              type="button"
              onClick={handleStop}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-semibold border border-rose-500/30 transition cursor-pointer active:scale-95"
              title="Stop pipeline"
            >
              <Square className="w-3.5 h-3.5 fill-rose-400" />
              <span className="hidden sm:inline">Stop</span>
            </button>

            <button
              type="button"
              onClick={handleRunInBackground}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              title="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          
          {/* Active Lead Agent Spotlight Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border border-emerald-500/30 shadow-inner">
            <div className="flex items-center gap-3.5">
              <div className="relative shrink-0 w-12 h-12 rounded-2xl bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold shadow-md">
                <Bot className="w-6 h-6 text-emerald-400" />
                <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 ring-4 ring-slate-900"></span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">{leadAgentName}</span>
                  <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    Lead Agent
                  </span>
                </div>
                <p className="text-xs text-slate-400">{leadAgentRole}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-emerald-300 font-mono">
                  <Activity className="w-3 h-3 animate-pulse text-emerald-400" />
                  <span>{currentStep}</span>
                </div>
              </div>
            </div>

            <div className="sm:text-right shrink-0">
              <span className="text-2xl font-black text-emerald-400 font-mono">{percent}%</span>
              <p className="text-[11px] text-slate-400 font-mono">
                Stage {stageIndex} of {totalStages}
              </p>
            </div>
          </div>

          {/* Overall Multi-Stage Progress Stepper */}
          <div className="space-y-2">
            <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-800 p-0.5">
              <div
                className="bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 h-full rounded-full transition-all duration-300 ease-out shadow-sm shadow-emerald-500/40"
                style={{ width: `${percent}%` }}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2">
              {STAGES.map((stg) => {
                const isPassed = stageIndex > stg.num || percent >= 100;
                const isCurrent = stageIndex === stg.num && percent < 100;
                return (
                  <div
                    key={stg.num}
                    className={`p-2.5 rounded-xl border text-left transition ${
                      isPassed
                        ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                        : isCurrent
                        ? 'bg-slate-800/80 border-emerald-500/60 text-white ring-1 ring-emerald-500/40'
                        : 'bg-slate-950/40 border-slate-800/80 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      {isPassed ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : isCurrent ? (
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
                      ) : (
                        <Circle className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                      )}
                      <span className="text-xs font-bold truncate">Stage {stg.num}</span>
                    </div>
                    <p className="text-[11px] font-semibold truncate leading-tight">{stg.title}</p>
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">{stg.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Collaborating Autonomous Agent Pod */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-teal-400" />
              <span>Assigned Accounting Agents</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {teamAgents.map((ag) => (
                <div
                  key={ag.name}
                  className={`p-3 rounded-xl border flex items-center gap-2.5 transition ${
                    ag.isActive
                      ? 'bg-slate-800/90 border-emerald-500/40 shadow-sm shadow-emerald-500/10'
                      : 'bg-slate-950/50 border-slate-800 text-slate-400'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                      ag.isActive
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {ag.name[0]}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-white truncate">{ag.name}</span>
                      <span className="text-[9px] uppercase px-1 rounded bg-slate-800 text-slate-300 font-mono">
                        {ag.section}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 truncate">{ag.role}</p>
                    <p className={`text-[10px] font-mono truncate mt-0.5 ${ag.isActive ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {ag.status}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Streaming ReAct Thought Console */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                <span>Live Operational Thought Stream</span>
              </h3>
              <span className="text-[10px] text-slate-400 font-mono">
                Streaming sequentially · 0% screen lock
              </span>
            </div>

            <div className="h-44 overflow-y-auto bg-slate-950 rounded-xl p-3 border border-slate-800 font-mono text-xs space-y-1.5">
              {logs.length > 0 ? (
                logs.map((log: any, idx: number) => {
                  const msg = typeof log === 'string' ? log : log.message || '';
                  const time = typeof log === 'string' ? '' : log.time || log.timestamp?.slice(11, 19) || '';
                  const level = typeof log === 'string' ? 'info' : log.level || 'info';
                  return (
                    <div key={idx} className="flex items-start gap-2 leading-relaxed">
                      {time && <span className="text-slate-500 shrink-0 text-[10px]">{time}</span>}
                      <span
                        className={`text-[11px] ${
                          level === 'error'
                            ? 'text-rose-400'
                            : level === 'success'
                            ? 'text-emerald-400 font-semibold'
                            : level === 'warning'
                            ? 'text-amber-400'
                            : 'text-slate-300'
                        }`}
                      >
                        {msg}
                      </span>
                    </div>
                  );
                })
              ) : recentLogs.length > 0 ? (
                recentLogs.map((msg: any, idx: number) => (
                  <div key={idx} className="text-slate-300 text-[11px] leading-relaxed">
                    {typeof msg === 'string' ? msg : msg.message}
                  </div>
                ))
              ) : (
                <div className="text-slate-500 italic text-center py-8">
                  Awaiting operational agent telemetry...
                </div>
              )}
              <div ref={logEndRef} />
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between text-xs text-slate-400 shrink-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Autonomous agent guardrails active · Dual control posting policy enforced</span>
          </div>

          <button
            type="button"
            onClick={handleRunInBackground}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-sm transition cursor-pointer active:scale-95"
          >
            <span>Proceed to Workspace (Run in Background)</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

      </div>
    </div>
  );
};
