import React from 'react';
import { useClient } from '../../context/ClientContext';
import { useAutomation } from '../../context/AutomationContext';
import { Layers, PlayCircle, CheckCircle2, Clock, Sparkles, Building, ArrowLeft } from 'lucide-react';

export const ClientWorkspace: React.FC = () => {
  const { currentClient } = useClient();
  const { setActiveTab, addLog } = useAutomation();

  const handleSimulateRun = () => {
    addLog('info', `[SIMULATION] Triggered pipeline runner for client: ${currentClient.name}`);
    addLog('success', `[SIMULATION] Step 1: Discovered 12 unprocessed source documents.`);
    addLog('info', `[SIMULATION] Step 2: Running Gemini Vision 3.6 Flash structured JSON schema extraction.`);
    setTimeout(() => {
      addLog('success', `[SIMULATION] Step 3: Extracted 48 line items with 100% confidence. Staged for review.`);
    }, 1200);
  };

  return (
    <div className="space-y-6">
      
      {/* Client Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-3xl shadow-lg shrink-0">
              {currentClient.icon}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold text-white tracking-tight">{currentClient.name}</h1>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                    currentClient.status === 'live'
                      ? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300'
                      : currentClient.status === 'dev'
                      ? 'bg-sky-950/80 border border-sky-500/40 text-sky-300'
                      : 'bg-amber-950/80 border border-amber-500/40 text-amber-300'
                  }`}
                >
                  {currentClient.statusText}
                </span>
              </div>
              <p className="text-xs text-sky-400 font-medium mt-0.5">{currentClient.industry}</p>
              <p className="text-xs text-slate-400 mt-2 max-w-3xl">{currentClient.desc}</p>
            </div>
          </div>

          {/* Action Trigger */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setActiveTab('clients')}
              className="flex items-center gap-1.5 bg-slate-950 hover:bg-slate-850 border border-slate-800 text-slate-300 text-xs font-semibold px-3 py-2 rounded-xl transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>All Clients</span>
            </button>
            <button
              onClick={handleSimulateRun}
              className="flex items-center gap-1.5 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg shadow-sky-600/30 transition cursor-pointer"
            >
              <PlayCircle className="w-4 h-4" />
              <span>Simulate Pipeline Ingestion</span>
            </button>
          </div>
        </div>
      </div>

      {/* Blueprint Architecture Steps */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-xl">
        <div className="flex items-center gap-2 mb-4">
          <Layers className="w-5 h-5 text-sky-400" />
          <h2 className="text-base font-bold text-white tracking-tight">Automation Architecture Blueprint</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {currentClient.blueprints?.map((step, idx) => {
            const isActive = step.status === 'active';
            const isInProgress = step.status === 'in_progress';

            return (
              <div
                key={idx}
                className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] uppercase font-mono font-bold text-slate-500">
                      Phase 0{idx + 1}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                        isActive
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                          : isInProgress
                          ? 'bg-sky-950 text-sky-300 border border-sky-500/30'
                          : 'bg-slate-900 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {isActive ? (
                        <>
                          <CheckCircle2 className="w-3 h-3" /> Active
                        </>
                      ) : isInProgress ? (
                        <>
                          <Sparkles className="w-3 h-3 text-sky-400" /> Developing
                        </>
                      ) : (
                        <>
                          <Clock className="w-3 h-3" /> Queued
                        </>
                      )}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1">{step.title}</h3>
                  <p className="text-xs text-slate-400">{step.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Connected Integrations */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-xl">
        <h2 className="text-base font-bold text-white mb-3">Configured Integrations & Storage</h2>
        <div className="flex flex-wrap gap-2">
          {currentClient.activeIntegrations?.map((intg, i) => (
            <div
              key={i}
              className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-semibold text-slate-200"
            >
              <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
              <span>{intg}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
