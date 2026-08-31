import React, { useState } from 'react';
import { useAutomation } from '../../context/AutomationContext';
import { Check, X, FileSpreadsheet, Building } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';

export const InvoiceModal: React.FC = () => {
  const { isInvoiceModalOpen, setIsInvoiceModalOpen, selectedMonth, selectedYear, sheetsData, runInvoicing } = useAutomation();

  const [clientFilter, setClientFilter] = useState('');

  if (!isInvoiceModalOpen) return null;

  const monthlyRows = sheetsData?.monthly_summary || [];
  const approvedRows = monthlyRows.filter((r) => r.approved);
  const totalApproved = approvedRows.reduce((sum, r) => sum + (r.total_billed || 0), 0);

  const uniqueApprovedClients = Array.from(new Set(approvedRows.map((r) => r.client_name)));

  const handleDispatch = (e: React.FormEvent) => {
    e.preventDefault();
    runInvoicing({
      month: selectedMonth,
      year: selectedYear,
      spreadsheet_id: sheetsData?.spreadsheet_id,
      client_name: clientFilter || null,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in">
      <div className="w-full max-w-lg bg-slate-900 border border-emerald-500/30 rounded-2xl p-6 shadow-2xl animate-in zoom-in-95">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white">Generate Accounting Draft Invoices</h2>
          </div>
          <button
            onClick={() => setIsInvoiceModalOpen(false)}
            className="text-slate-400 hover:text-white p-1 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

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

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Filter by Client / Hotel (Optional)</label>
            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
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
              onClick={() => setIsInvoiceModalOpen(false)}
              className="px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 rounded-lg transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={approvedRows.length === 0}
              className="px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition shadow-lg shadow-emerald-600/30 cursor-pointer disabled:opacity-50"
            >
              Create Draft Invoices
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
