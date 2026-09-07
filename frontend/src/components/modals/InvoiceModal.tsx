import React, { useState } from 'react';
import { useAutomation } from '../../context/AutomationContext';
import { useErrors } from '../../context/ErrorContext';
import { Check, X, FileSpreadsheet, AlertCircle, Terminal, Loader2 } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { ApiError } from '../../lib/api';

export const InvoiceModal: React.FC = () => {
  const {
    isInvoiceModalOpen,
    setIsInvoiceModalOpen,
    selectedMonth,
    selectedYear,
    sheetsData,
    runInvoicing,
  } = useAutomation();
  const { openDebugDrawer } = useErrors();

  const [clientFilter, setClientFilter] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState<{
    message: string;
    status?: number;
    traceback?: string;
    troubleshootingHint?: string;
  } | null>(null);

  if (!isInvoiceModalOpen) return null;

  const monthlyRows = sheetsData?.monthly_summary || [];
  const approvedRows = monthlyRows.filter((r) => r.approved);
  const totalApproved = approvedRows.reduce((sum, r) => sum + (r.total_billed || 0), 0);

  const uniqueApprovedClients = Array.from(new Set(approvedRows.map((r) => r.client_name)));

  const handleClose = () => {
    if (isSubmitting) return;
    setModalError(null);
    setIsInvoiceModalOpen(false);
  };

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    setIsSubmitting(true);
    try {
      await runInvoicing({
        month: selectedMonth,
        year: selectedYear,
        spreadsheet_id: sheetsData?.spreadsheet_id,
        client_name: clientFilter || null,
      });
      // runInvoicing closes modal on success
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
          message: err?.message || 'An unexpected error occurred while generating invoices.',
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in">
      <div className="w-full max-w-lg bg-slate-900 border border-emerald-500/30 rounded-2xl p-6 shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto custom-scrollbar">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white">Generate Accounting Draft Invoices</h2>
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
                  <span className="text-xs font-bold text-rose-200">Invoice Dispatch Failed</span>
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

        <form onSubmit={handleDispatch} className="space-y-4">
          {/* Summary Stat Card */}
          <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-4 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-semibold text-emerald-300 block">Approved Billing Volume</span>
              <span className="text-xl font-extrabold text-white font-mono">{formatCurrency(totalApproved)}</span>
            </div>
            <div className="text-right">
              <span className="text-[11px] font-semibold text-emerald-300 block">Approved Items</span>
              <span className="text-xl font-extrabold text-white font-mono">{approvedRows.length} Rows</span>
            </div>
          </div>

          {approvedRows.length === 0 && (
            <div className="bg-sky-950/40 border border-sky-500/30 rounded-xl p-3 text-[11px] text-sky-300">
              ℹ️ No approved rows currently selected in Google Sheet. Clicking dispatch will scan the database staged ledger and connected sheets for any approved transactions.
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Filter by Client / Hotel (Optional)</label>
            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              disabled={isSubmitting}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 cursor-pointer disabled:opacity-50"
            >
              <option value="">All Approved Clients ({uniqueApprovedClients.length} hotels)</option>
              {uniqueApprovedClients.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-[11px] text-slate-400 space-y-1.5">
            <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
              <span>⚡ Idempotent Append Engine</span>
            </div>
            <p>
              If a draft invoice already exists for this client in {selectedMonth} {selectedYear}, newly approved line items will be appended via <code className="text-emerald-400">PUT /invoices/{`{id}`}</code> to prevent duplicate invoices.
            </p>
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
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition shadow-lg shadow-emerald-600/30 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Creating Draft Invoices...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Create Draft Invoices</span>
                </>
              )}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
