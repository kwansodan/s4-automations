import React, { useState } from 'react';
import { useAutomation } from '../../context/AutomationContext';
import { useErrors } from '../../context/ErrorContext';
import { PlayCircle, X, AlertCircle, Terminal, Loader2 } from 'lucide-react';
import { ApiError } from '../../lib/api';

const HOTELS = [
  { slug: 'luxwood', name: 'Luxwood Hotel & Suites' },
  { slug: 'the_bantree', name: 'The Bantree Residences' },
  { slug: 'the_lennox', name: 'The Lennox Luxury Apartments' },
  { slug: 'active8', name: 'Active 8 Spintex' },
  { slug: 'maharaja', name: 'Maharaja Restaurant & Suites' },
];

export const PipelineModal: React.FC = () => {
  const {
    isPipelineModalOpen,
    setIsPipelineModalOpen,
    selectedMonth,
    selectedYear,
    runPipeline,
  } = useAutomation();
  const { openDebugDrawer } = useErrors();

  const [selectedSlugs, setSelectedSlugs] = useState<string[]>(HOTELS.map((h) => h.slug));
  const [month, setMonth] = useState(selectedMonth);
  const [year, setYear] = useState(selectedYear);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState<{
    message: string;
    status?: number;
    traceback?: string;
    troubleshootingHint?: string;
  } | null>(null);

  if (!isPipelineModalOpen) return null;

  const toggleSlug = (slug: string) => {
    if (selectedSlugs.includes(slug)) {
      setSelectedSlugs(selectedSlugs.filter((s) => s !== slug));
    } else {
      setSelectedSlugs([...selectedSlugs, slug]);
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setModalError(null);
    setIsPipelineModalOpen(false);
  };

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    setIsSubmitting(true);
    try {
      await runPipeline({
        month,
        year,
        client_slugs: selectedSlugs.length === HOTELS.length ? null : selectedSlugs,
      });
      // runPipeline closes modal on success
    } catch (err: any) {
      if (err instanceof ApiError) {
        setModalError({
          message: err.message,
          status: err.status,
          traceback: err.traceback,
          troubleshootingHint: err.troubleshootingHint,
        });
      } else {
        setModalError({
          message: err?.message || 'An unexpected error occurred while dispatching the OCR pipeline.',
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in">
      <div className="w-full max-w-lg bg-slate-900 border border-sky-500/30 rounded-2xl p-6 shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto custom-scrollbar">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <div className="flex items-center gap-2">
            <PlayCircle className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-bold text-white">Trigger Vision OCR Daily Ingestion</h2>
          </div>
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="text-slate-400 hover:text-white p-1 rounded cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Inline Error Banner */}
        {modalError && (
          <div className="mb-4 bg-rose-950/60 border border-rose-500/50 rounded-xl p-3.5 space-y-2 animate-in fade-in">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-rose-200">Pipeline Dispatch Failed</span>
                  {modalError.status && (
                    <span className="text-[10px] bg-rose-900/80 text-rose-300 font-mono px-1.5 py-0.5 rounded border border-rose-700/60">
                      HTTP {modalError.status}
                    </span>
                  )}
                </div>
                <p className="text-xs text-rose-300/90 mt-1">{modalError.message}</p>
                {modalError.troubleshootingHint && (
                  <p className="text-[11px] text-rose-400 font-mono mt-1">
                    💡 Hint: {modalError.troubleshootingHint}
                  </p>
                )}
              </div>
            </div>

            {modalError.traceback && (
              <details className="text-[10px] font-mono text-rose-300 bg-slate-950 p-2 rounded border border-rose-900/40">
                <summary className="cursor-pointer text-rose-400 hover:text-rose-300 font-semibold select-none">
                  View Server Traceback
                </summary>
                <pre className="mt-1.5 whitespace-pre-wrap overflow-x-auto max-h-36 custom-scrollbar text-rose-300/80">
                  {modalError.traceback}
                </pre>
              </details>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => openDebugDrawer('errors')}
                className="flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 underline font-medium cursor-pointer"
              >
                <Terminal className="w-3 h-3" />
                <span>Open in Debug Inspector</span>
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleExecute} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Target Billing Month</label>
              <input
                type="text"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                disabled={isSubmitting}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Target Year</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                disabled={isSubmitting}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500 disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-300">Filter Hotels / Clients</label>
              <button
                type="button"
                onClick={() =>
                  setSelectedSlugs(selectedSlugs.length === HOTELS.length ? [] : HOTELS.map((h) => h.slug))
                }
                disabled={isSubmitting}
                className="text-[11px] text-sky-400 hover:underline cursor-pointer disabled:opacity-50"
              >
                {selectedSlugs.length === HOTELS.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <div className="space-y-1.5 max-h-44 overflow-y-auto bg-slate-950 p-2.5 rounded-xl border border-slate-800 custom-scrollbar">
              {HOTELS.map((hotel) => {
                const checked = selectedSlugs.includes(hotel.slug);
                return (
                  <label
                    key={hotel.slug}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-900 cursor-pointer transition"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSlug(hotel.slug)}
                        disabled={isSubmitting}
                        className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-sky-600 focus:ring-sky-500"
                      />
                      <span className="text-xs font-medium text-slate-200">{hotel.name}</span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500">{hotel.slug}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="bg-sky-950/40 border border-sky-500/20 rounded-xl p-3 text-[11px] text-sky-300">
            💡 The pipeline will scan Google Drive for handwritten slips, execute Gemini 3.6 Flash structured JSON extraction, and append new line-items to Google Sheets Tab 1 & Tab 2.
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 rounded-lg transition cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={selectedSlugs.length === 0 || isSubmitting}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition shadow-lg shadow-sky-600/30 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Starting Pipeline...</span>
                </>
              ) : (
                <>
                  <PlayCircle className="w-3.5 h-3.5" />
                  <span>Start OCR Ingestion</span>
                </>
              )}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
