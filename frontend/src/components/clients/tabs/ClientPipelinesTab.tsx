import React, { useState } from 'react';
import { useClient } from '../../../context/ClientContext';
import { useAutomation } from '../../../context/AutomationContext';
import {
  saveClientPipeline,
  deleteClientPipeline,
  triggerClientPipeline,
} from '../../../lib/api';
import type { IngestionPipeline } from '../../../types/client';
import { PipelineSetupWizardModal } from '../../modals/PipelineSetupWizardModal';
import {
  Layers,
  Plus,
  PlayCircle,
  RefreshCw,
  Edit3,
  Trash2,
  Clock,
  Zap,
  CheckCircle2,
  Cloud,
  Mail,
  SlidersHorizontal,
  DollarSign,
  Receipt,
  Landmark,
} from 'lucide-react';

export const ClientPipelinesTab: React.FC = () => {
  const { currentClient, deletePipeline } = useClient();
  const { selectedMonth, selectedYear, addLog } = useAutomation();

  const [isPipelineModalOpen, setIsPipelineModalOpen] = useState(false);
  const [editingPipeline, setEditingPipeline] = useState<IngestionPipeline | null>(null);
  const [triggeringPipeId, setTriggeringPipeId] = useState<string | null>(null);

  const handleOpenNewPipeline = () => {
    setEditingPipeline(null);
    setIsPipelineModalOpen(true);
  };

  const handleOpenEditPipeline = (pipe: IngestionPipeline) => {
    setEditingPipeline(pipe);
    setIsPipelineModalOpen(true);
  };

  const handleSavePipelineSubmit = async (pipelineData: IngestionPipeline) => {
    const updatedPipelines = await saveClientPipeline(currentClient.id, pipelineData);
    if (Array.isArray(updatedPipelines)) {
      currentClient.pipelines = updatedPipelines;
    }
    addLog('success', `✅ Saved pipeline stream: "${pipelineData.name}"`);
  };

  const handleDeletePipelineSubmit = async (pipelineId: string, pipelineName: string) => {
    if (!confirm(`Are you sure you want to delete pipeline stream "${pipelineName}"?`)) return;
    try {
      await deletePipeline(currentClient.id, pipelineId);
      addLog('info', `🗑️ Deleted pipeline stream "${pipelineName}" for ${currentClient.name}`);
    } catch (err: any) {
      addLog('error', `Failed to delete pipeline: ${err.message}`);
    }
  };

  const handleTriggerStream = async (pipelineId: string, pipelineName: string) => {
    setTriggeringPipeId(pipelineId);
    addLog('info', `⚡ [STREAM] Triggering "${pipelineName}" (${selectedMonth} ${selectedYear})...`);
    try {
      const result = await triggerClientPipeline(currentClient.id, pipelineId, {
        month: selectedMonth,
        year: selectedYear,
      });
      addLog('success', `✅ Stream "${pipelineName}" executed successfully: ${result.items_extracted || 0} items extracted.`);
    } catch (err: any) {
      addLog('error', `❌ Stream "${pipelineName}" execution failed: ${err.message}`);
    } finally {
      setTriggeringPipeId(null);
    }
  };

  const pipelines = currentClient.pipelines || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header & Controls Toolbar */}
      <div className="glass-panel rounded-2xl p-5 shadow-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-bold text-white tracking-tight">
              Ingestion Pipelines &amp; Automation Streams
            </h2>
            <span className="text-[10px] font-mono font-bold text-sky-400 bg-sky-950/80 border border-sky-500/30 px-2 py-0.5 rounded-full">
              {pipelines.length} Active Streams
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure entity-driven automation streams for Accounts Receivable, Accounts Payable, Bank Feeds, and General Ledger.
          </p>
        </div>

        <button
          onClick={handleOpenNewPipeline}
          className="flex items-center gap-2 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg shadow-sky-600/25 transition cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Add Ingestion Pipeline</span>
        </button>
      </div>

      {/* Pipelines Grid */}
      {pipelines.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pipelines.map((pipe, idx) => {
            const sectionBadge =
              pipe.section === 'AR'
                ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                : pipe.section === 'AP'
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : pipe.section === 'BANK'
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-purple-500/20 text-purple-300 border-purple-500/40';

            return (
              <div
                key={pipe.id || idx}
                className="glass-panel rounded-2xl p-5 flex flex-col justify-between space-y-4 border border-slate-800 hover:border-slate-700 transition group relative"
              >
                <div>
                  {/* Top Bar: Section & Actions */}
                  <div className="flex items-center justify-between mb-2.5">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border uppercase ${sectionBadge}`}>
                      {pipe.section} • {pipe.entity_type?.replace(/_/g, ' ')}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleOpenEditPipeline(pipe)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-sky-400 hover:bg-slate-800 transition cursor-pointer"
                        title="Edit Pipeline Configuration"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeletePipelineSubmit(pipe.id, pipe.name)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition cursor-pointer"
                        title="Delete Pipeline Stream"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Title */}
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${pipe.is_active !== false ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-slate-500'}`} />
                    <span>{pipe.name}</span>
                  </h3>

                  {/* Trigger Details */}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-slate-900 text-sky-300 border border-slate-800 flex items-center gap-1">
                      {pipe.trigger_type === 'realtime_webhook' ? (
                        <>⚡ Webhook</>
                      ) : pipe.trigger_type === 'manual_only' ? (
                        <>🖱️ Manual</>
                      ) : (
                        <>⏰ {pipe.cron_schedule_human || pipe.schedule || 'Daily @ 18:00 UTC'}</>
                      )}
                    </span>
                    {pipe.total_runs_count ? (
                      <span className="text-[10px] text-slate-500 font-mono">
                        {pipe.total_runs_count} runs
                      </span>
                    ) : null}
                  </div>

                  {/* Target Details */}
                  <div className="text-xs text-slate-400 space-y-1 mt-3 pt-3 border-t border-slate-850">
                    <p className="flex items-center justify-between">
                      <span className="text-slate-500 text-[11px]">Channel:</span>
                      <code className="text-sky-300 font-mono text-[11px]">{pipe.source_type}</code>
                    </p>
                    {pipe.source_identifier && (
                      <p className="flex items-center justify-between">
                        <span className="text-slate-500 text-[11px]">Source Target:</span>
                        <span className="text-slate-300 font-mono text-[11px] truncate max-w-[140px]" title={pipe.source_identifier}>
                          {pipe.source_identifier}
                        </span>
                      </p>
                    )}
                    {pipe.default_account_code && (
                      <p className="flex items-center justify-between">
                        <span className="text-slate-500 text-[11px]">Default Account:</span>
                        <span className="text-emerald-400 font-mono text-[11px]">{pipe.default_account_code}</span>
                      </p>
                    )}
                  </div>
                </div>

                {/* Footer Action */}
                <div className="pt-3 border-t border-slate-850 space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Accounting API:</span>
                    <span className={pipe.auto_post_to_zoho || pipe.auto_post_draft ? 'text-emerald-400 font-bold' : 'text-amber-400 font-medium'}>
                      {pipe.auto_post_to_zoho || pipe.auto_post_draft ? 'Auto-Post Live' : 'Review Required'}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleTriggerStream(pipe.id, pipe.name)}
                    disabled={triggeringPipeId === pipe.id}
                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 hover:text-white border border-sky-500/30 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                  >
                    {triggeringPipeId === pipe.id ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-400" />
                    ) : (
                      <PlayCircle className="w-3.5 h-3.5 text-sky-400" />
                    )}
                    <span>{triggeringPipeId === pipe.id ? 'Running Stream...' : 'Trigger Stream Now'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="glass-panel rounded-2xl p-12 text-center text-slate-400 border border-dashed border-slate-800 space-y-3">
          <Layers className="w-10 h-10 text-slate-600 mx-auto" />
          <h3 className="text-sm font-bold text-white">No Ingestion Pipelines Configured</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Create automated ingestion streams to parse control slips, supplier invoices, or bank statement files for {currentClient.name}.
          </p>
          <button
            onClick={handleOpenNewPipeline}
            className="inline-flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create First Pipeline</span>
          </button>
        </div>
      )}

      {/* Pipeline Setup Wizard Modal */}
      <PipelineSetupWizardModal
        isOpen={isPipelineModalOpen}
        onClose={() => setIsPipelineModalOpen(false)}
        onSave={handleSavePipelineSubmit}
        clientId={currentClient.id}
        clientName={currentClient.name}
        initialPipeline={editingPipeline}
        targetAccountingSoftware={currentClient.accounting_software}
      />

    </div>
  );
};
