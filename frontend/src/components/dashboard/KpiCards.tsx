import React from 'react';
import { useAutomation } from '../../context/AutomationContext';
import { FileText, AlertTriangle, CheckCircle, Clock, Building2 } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';

export const KpiCards: React.FC = () => {
  const { stats, selectedMonth, selectedYear } = useAutomation();

  const totalSlips = stats?.total_slips_ingested ?? 2;
  const linenLoss = stats?.unreturned_linen_loss_count ?? 3;
  const approvedTotal = stats?.approved_billing_total_ghs ?? 1885.00;
  const pendingCount = stats?.pending_approval_count ?? 1;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      
      {/* 1. Total Slips Ingested */}
      <div className="bg-slate-900/80 border border-slate-800 hover:border-sky-500/40 rounded-2xl p-5 shadow-lg backdrop-blur-xl transition-all hover:shadow-sky-500/5 group">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-slate-400">Daily Slips Ingested</span>
          <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 group-hover:scale-110 transition-transform">
            <FileText className="w-4 h-4" />
          </div>
        </div>
        <div className="text-2xl font-extrabold text-white tracking-tight">{totalSlips}</div>
        <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
          <span>Vision OCR extracted for</span>
          <strong className="text-sky-400 font-semibold">{selectedMonth} {selectedYear}</strong>
        </div>
      </div>

      {/* 2. Unreturned Linen Loss Count */}
      <div className="bg-slate-900/80 border border-slate-800 hover:border-amber-500/40 rounded-2xl p-5 shadow-lg backdrop-blur-xl transition-all hover:shadow-amber-500/5 group">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-slate-400">Linen Loss Discrepancies</span>
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-110 transition-transform">
            <AlertTriangle className="w-4 h-4" />
          </div>
        </div>
        <div className="text-2xl font-extrabold text-amber-400 tracking-tight">{linenLoss}</div>
        <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
          <span>Pickup &gt; Delivery items flagged for audit</span>
        </div>
      </div>

      {/* 3. Approved Billing Total */}
      <div className="bg-slate-900/80 border border-slate-800 hover:border-emerald-500/40 rounded-2xl p-5 shadow-lg backdrop-blur-xl transition-all hover:shadow-emerald-500/5 group">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-slate-400">Approved Billing Amount</span>
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-110 transition-transform">
            <CheckCircle className="w-4 h-4" />
          </div>
        </div>
        <div className="text-2xl font-extrabold text-emerald-400 tracking-tight font-mono">
          {formatCurrency(approvedTotal)}
        </div>
        <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
          <span>Ready for 1-click Zoho Books invoicing</span>
        </div>
      </div>

      {/* 4. Pending Review Rows */}
      <div className="bg-slate-900/80 border border-slate-800 hover:border-indigo-500/40 rounded-2xl p-5 shadow-lg backdrop-blur-xl transition-all hover:shadow-indigo-500/5 group">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-slate-400">Pending Review Line Items</span>
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform">
            <Clock className="w-4 h-4" />
          </div>
        </div>
        <div className="text-2xl font-extrabold text-indigo-300 tracking-tight">{pendingCount}</div>
        <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
          <span>Awaiting bookkeeper sign-off in Tab 2</span>
        </div>
      </div>

    </div>
  );
};
