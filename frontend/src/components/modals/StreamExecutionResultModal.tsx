import React, { useState } from 'react';
import type { PipelineRunSummary } from '../../types/client';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  FileText,
  Copy,
  Layers,
  Archive,
  RefreshCw,
  Info,
  ShieldAlert,
  Zap,
} from 'lucide-react';

interface StreamExecutionResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  runSummary: PipelineRunSummary | null;
  onTriggerAgain?: () => void;
}

export const StreamExecutionResultModal: React.FC<StreamExecutionResultModalProps> = ({
  isOpen,
  onClose,
  runSummary,
  onTriggerAgain,
}) => {
  const [showStepLogs, setShowStepLogs] = useState(false);

  if (!isOpen || !runSummary) return null;

  const isDuplicateSkipOnly =
    runSummary.status === 'COMPLETED_DUPLICATES_SKIPPED' ||
    (runSummary.sources_discovered > 0 &&
      runSummary.duplicates_skipped === runSummary.sources_discovered &&
      runSummary.items_extracted === 0);

  const isEmptyRun =
    runSummary.status === 'COMPLETED_EMPTY' || runSummary.sources_discovered === 0;

  const isFailed =
    runSummary.status === 'FAILED' ||
    (runSummary.errors && runSummary.errors.length > 0);

  // Compile combined document list from documents metadata
  const discoveredDocs = runSummary.documents?.discovered || [];
  const skippedDocs = runSummary.documents?.skipped || [];
  const extractedDocs = runSummary.documents?.extracted || [];
  const archivedDocs = runSummary.documents?.archived || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                isFailed
                  ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                  : isDuplicateSkipOnly
                  ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                  : isEmptyRun
                  ? 'bg-slate-800 text-slate-400 border-slate-700'
                  : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
              }`}
            >
              {isFailed ? (
                <ShieldAlert className="w-5 h-5" />
              ) : isDuplicateSkipOnly ? (
                <Copy className="w-5 h-5" />
              ) : isEmptyRun ? (
                <Info className="w-5 h-5" />
              ) : (
                <CheckCircle2 className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">
                  Pipeline Execution Summary
                </h3>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${
                    isFailed
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                      : isDuplicateSkipOnly
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : isEmptyRun
                      ? 'bg-slate-800 text-slate-300 border-slate-700'
                      : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  }`}
                >
                  {isFailed
                    ? 'Execution Failed'
                    : isDuplicateSkipOnly
                    ? 'All Files Skipped (Duplicate)'
                    : isEmptyRun
                    ? 'No Files Found'
                    : 'Staged Successfully'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {runSummary.pipeline_name || 'Ingestion Stream'} •{' '}
                <span className="font-semibold text-slate-300">
                  {runSummary.month} {runSummary.year}
                </span>{' '}
                • {new Date(runSummary.triggered_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar flex-1 text-xs">
          {/* Summary Explanation Banner */}
          <div
            className={`p-4 rounded-xl border flex items-start gap-3.5 leading-relaxed ${
              isFailed
                ? 'bg-rose-950/40 border-rose-500/30 text-rose-200'
                : isDuplicateSkipOnly
                ? 'bg-amber-950/30 border-amber-500/30 text-amber-200'
                : isEmptyRun
                ? 'bg-slate-800/60 border-slate-700 text-slate-300'
                : 'bg-emerald-950/30 border-emerald-500/30 text-emerald-200'
            }`}
          >
            <div className="shrink-0 mt-0.5">
              {isFailed ? (
                <AlertTriangle className="w-4 h-4 text-rose-400" />
              ) : isDuplicateSkipOnly ? (
                <Info className="w-4 h-4 text-amber-400" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              )}
            </div>
            <div>
              <p className="font-semibold text-white">
                {isDuplicateSkipOnly
                  ? 'Why were 0 transactions staged?'
                  : isFailed
                  ? 'Pipeline Execution Notice'
                  : isEmptyRun
                  ? 'Source Storage is Empty'
                  : 'Stream Completed'}
              </p>
              <p className="mt-1 text-slate-300 text-[11.5px]">
                {runSummary.summary_message}
              </p>
              {isDuplicateSkipOnly && (
                <p className="mt-2 text-[11px] text-amber-300/90 font-medium">
                  💡 <strong>Idempotency Guard:</strong> S4 checks the digital SHA-256 fingerprint of every file against your ledger. These files were already extracted in a previous trigger, so they were safely skipped to prevent double-billing.
                </p>
              )}
            </div>
          </div>

          {/* 4 Stat Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                Discovered
              </span>
              <span className="text-base font-bold text-white mt-0.5 block">
                {runSummary.sources_discovered} File{runSummary.sources_discovered === 1 ? '' : 's'}
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                In Source Folder
              </span>
            </div>

            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                Duplicates Skipped
              </span>
              <span className={`text-base font-bold mt-0.5 block ${runSummary.duplicates_skipped > 0 ? 'text-amber-300' : 'text-slate-300'}`}>
                {runSummary.duplicates_skipped} File{runSummary.duplicates_skipped === 1 ? '' : 's'}
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                Prevented Double Entry
              </span>
            </div>

            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                New Staged Items
              </span>
              <span className={`text-base font-bold mt-0.5 block ${runSummary.items_extracted > 0 ? 'text-emerald-300' : 'text-slate-400'}`}>
                {runSummary.items_extracted} Item{runSummary.items_extracted === 1 ? '' : 's'}
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                In Database Ledger
              </span>
            </div>

            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                Accounting Mode
              </span>
              <span className={`text-xs font-bold mt-1 block flex items-center gap-1 ${runSummary.auto_post ? 'text-emerald-400' : 'text-sky-400'}`}>
                {runSummary.auto_post ? (
                  <>
                    <Zap className="w-3.5 h-3.5" /> Auto-Posted Live
                  </>
                ) : (
                  <>
                    <Layers className="w-3.5 h-3.5" /> Manual Review
                  </>
                )}
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                {runSummary.auto_post ? 'Drafted to Zoho' : 'Pending Approval'}
              </span>
            </div>
          </div>

          {/* Inspected Documents List */}
          <div>
            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-2.5 flex items-center justify-between">
              <span>Source Documents Inspected ({discoveredDocs.length || skippedDocs.length || 0})</span>
            </h4>

            {discoveredDocs.length > 0 || skippedDocs.length > 0 ? (
              <div className="space-y-2">
                {/* Skipped duplicates */}
                {skippedDocs.map((doc, idx) => (
                  <div
                    key={`skip_${idx}`}
                    className="bg-slate-950/70 border border-amber-500/20 hover:border-amber-500/30 rounded-xl p-3 flex items-center justify-between gap-3 transition"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/20">
                        <Copy className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-white truncate text-xs" title={doc.file_name}>
                          {doc.file_name}
                        </p>
                        <p className="text-[10px] text-amber-300/80 truncate mt-0.5">
                          ⏭️ {doc.reason || 'Duplicate: Already processed in a previous run.'}
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
                      Skipped (Duplicate)
                    </span>
                  </div>
                ))}

                {/* Freshly Extracted files */}
                {extractedDocs.map((doc, idx) => (
                  <div
                    key={`ext_${idx}`}
                    className="bg-slate-950/70 border border-emerald-500/20 hover:border-emerald-500/30 rounded-xl p-3 flex items-center justify-between gap-3 transition"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/20">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-white truncate text-xs" title={doc.file_name}>
                          {doc.file_name}
                        </p>
                        <p className="text-[10px] text-emerald-400 truncate mt-0.5">
                          ✅ {doc.items_count} transaction item(s) extracted & validated
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">
                      Extracted & Staged
                    </span>
                  </div>
                ))}

                {/* Archived files notification */}
                {archivedDocs.map((doc, idx) => (
                  <div
                    key={`arch_${idx}`}
                    className="bg-slate-950/40 border border-slate-800 rounded-xl px-3 py-2 flex items-center justify-between text-[11px] text-slate-400"
                  >
                    <span className="flex items-center gap-2">
                      <Archive className="w-3.5 h-3.5 text-sky-400" />
                      <span>{doc.file_name}</span>
                    </span>
                    <span className="text-[10px] font-mono text-sky-300">
                      Moved to {doc.destination}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 bg-slate-950/40 border border-slate-800 rounded-xl text-slate-400">
                <p>No document details available for this run.</p>
              </div>
            )}
          </div>

          {/* Collapsible Step-by-Step Server Execution Logs */}
          {runSummary.step_logs && runSummary.step_logs.length > 0 && (
            <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
              <button
                type="button"
                onClick={() => setShowStepLogs(!showStepLogs)}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-800/40 transition cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-sky-400" />
                  <span className="font-bold text-white text-xs">
                    View Step-by-Step Server Audit Trail ({runSummary.step_logs.length} Events)
                  </span>
                </div>
                {showStepLogs ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>

              {showStepLogs && (
                <div className="p-3 border-t border-slate-800 space-y-1.5 font-mono text-[10.5px] max-h-48 overflow-y-auto custom-scrollbar">
                  {runSummary.step_logs.map((step, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2.5 py-1 px-2 rounded hover:bg-slate-900/60"
                    >
                      <span className="text-slate-500 shrink-0">{step.timestamp}</span>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.2 rounded shrink-0 ${
                          step.level === 'duplicate'
                            ? 'bg-amber-500/20 text-amber-300'
                            : step.level === 'warning'
                            ? 'bg-rose-500/20 text-rose-300'
                            : step.level === 'success'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-slate-800 text-sky-300'
                        }`}
                      >
                        {step.stage}
                      </span>
                      <span className="text-slate-300 flex-1 break-words">
                        {step.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/80 flex flex-wrap items-center justify-between gap-3">
          <div>
            {runSummary.spreadsheet_url ? (
              <a
                href={runSummary.spreadsheet_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition"
              >
                <span>Open Google Sheet Review Workbook</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            ) : (
              <span className="text-[11px] text-slate-500 font-mono">
                Ledger ID: {runSummary.month}_{runSummary.year}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onTriggerAgain && (
              <button
                type="button"
                onClick={onTriggerAgain}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold px-3.5 py-2 rounded-xl border border-slate-700 transition cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Trigger Again</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition cursor-pointer shadow-md shadow-sky-600/20"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
