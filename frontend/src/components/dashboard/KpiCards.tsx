import React from 'react';
import { useAutomation } from '../../context/AutomationContext';
import { useClient } from '../../context/ClientContext';
import { FileText, AlertTriangle, CheckCircle, Clock, ArrowUpRight, Layers } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { ACCOUNTING_PLATFORMS } from '../../types/client';

export const KpiCards: React.FC = () => {
  const { stats, selectedMonth, selectedYear, navigateToClientSubTab } = useAutomation();
  const { activeSections, currentClient } = useClient();

  const currentPlatform =
    ACCOUNTING_PLATFORMS.find((p) => p.id === currentClient.accounting_software) ||
    ACCOUNTING_PLATFORMS[0];

  // Case 1: No active pipelines configured
  if (activeSections.activeCount === 0) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div
          onClick={() => navigateToClientSubTab('pipelines')}
          className="bg-slate-900/70 hover:bg-slate-900 border border-slate-800/90 hover:border-sky-500/50 rounded-xl p-4 shadow-sm backdrop-blur-xl transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400">Configured Streams</span>
            <div className="flex items-center gap-1">
              <div className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 group-hover:scale-105 transition-transform">
                <Layers className="w-3.5 h-3.5" />
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-400 opacity-0 group-hover:opacity-100 transition-all" />
            </div>
          </div>
          <div className="text-2xl font-bold text-white tracking-tight">0 Streams</div>
          <div className="text-[11px] text-slate-400 mt-1 truncate">
            <span>Click to configure ingestion stream</span>
          </div>
        </div>

        <div
          onClick={() => navigateToClientSubTab('pipelines')}
          className="bg-slate-900/70 hover:bg-slate-900 border border-slate-800/90 hover:border-amber-500/50 rounded-xl p-4 shadow-sm backdrop-blur-xl transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400">Staged Documents</span>
            <div className="flex items-center gap-1">
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-105 transition-transform">
                <FileText className="w-3.5 h-3.5" />
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-all" />
            </div>
          </div>
          <div className="text-2xl font-bold text-amber-400 tracking-tight">0 Files</div>
          <div className="text-[11px] text-slate-400 mt-1 truncate">
            <span>Awaiting source folder setup</span>
          </div>
        </div>

        <div
          onClick={() => navigateToClientSubTab('settings')}
          className="bg-slate-900/70 hover:bg-slate-900 border border-slate-800/90 hover:border-emerald-500/50 rounded-xl p-4 shadow-sm backdrop-blur-xl transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400">Accounting ERP</span>
            <div className="flex items-center gap-1">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
                <CheckCircle className="w-3.5 h-3.5" />
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-emerald-400 opacity-0 group-hover:opacity-100 transition-all" />
            </div>
          </div>
          <div className="text-2xl font-bold text-emerald-400 tracking-tight">Standby</div>
          <div className="text-[11px] text-slate-400 mt-1 truncate">
            <span>{currentPlatform.name} connected</span>
          </div>
        </div>

        <div
          onClick={() => navigateToClientSubTab('pipelines')}
          className="bg-slate-900/70 hover:bg-slate-900 border border-slate-800/90 hover:border-indigo-500/50 rounded-xl p-4 shadow-sm backdrop-blur-xl transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400">Workflow Readiness</span>
            <div className="flex items-center gap-1">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition-transform">
                <Clock className="w-3.5 h-3.5" />
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-all" />
            </div>
          </div>
          <div className="text-2xl font-bold text-indigo-300 tracking-tight">Setup Required</div>
          <div className="text-[11px] text-slate-400 mt-1 truncate">
            <span>Add a pipeline stream to begin</span>
          </div>
        </div>
      </div>
    );
  }

  // Case 2: AR Active
  if (activeSections.hasAr) {
    const totalSlips = stats?.total_slips_ingested ?? 2;
    const linenLoss = stats?.unreturned_linen_loss_count ?? 3;
    const approvedTotal = stats?.approved_billing_total_ghs ?? 1885.00;
    const pendingCount = stats?.pending_approval_count ?? 1;

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div
          onClick={() => navigateToClientSubTab('ar')}
          className="bg-slate-900/70 hover:bg-slate-900 border border-slate-800/90 hover:border-sky-500/50 rounded-xl p-4 shadow-sm backdrop-blur-xl transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400">Slips Ingested</span>
            <div className="flex items-center gap-1">
              <div className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 group-hover:scale-105 transition-transform">
                <FileText className="w-3.5 h-3.5" />
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-400 opacity-0 group-hover:opacity-100 transition-all" />
            </div>
          </div>
          <div className="text-2xl font-bold text-white tracking-tight">{totalSlips}</div>
          <div className="text-[11px] text-slate-400 mt-1 truncate">
            <span>OCR extracted • </span>
            <span className="text-sky-400 font-medium">{selectedMonth} {selectedYear}</span>
          </div>
        </div>

        <div
          onClick={() => navigateToClientSubTab('ar')}
          className="bg-slate-900/70 hover:bg-slate-900 border border-slate-800/90 hover:border-amber-500/50 rounded-xl p-4 shadow-sm backdrop-blur-xl transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400">Linen Discrepancies</span>
            <div className="flex items-center gap-1">
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-105 transition-transform">
                <AlertTriangle className="w-3.5 h-3.5" />
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-all" />
            </div>
          </div>
          <div className="text-2xl font-bold text-amber-400 tracking-tight">{linenLoss}</div>
          <div className="text-[11px] text-slate-400 mt-1 truncate">
            <span>Pickup &gt; Delivery flagged for audit</span>
          </div>
        </div>

        <div
          onClick={() => navigateToClientSubTab('ar')}
          className="bg-slate-900/70 hover:bg-slate-900 border border-slate-800/90 hover:border-emerald-500/50 rounded-xl p-4 shadow-sm backdrop-blur-xl transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400">Approved Billing</span>
            <div className="flex items-center gap-1">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
                <CheckCircle className="w-3.5 h-3.5" />
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-emerald-400 opacity-0 group-hover:opacity-100 transition-all" />
            </div>
          </div>
          <div className="text-2xl font-bold text-emerald-400 tracking-tight font-mono">
            {formatCurrency(approvedTotal)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 truncate">
            <span>Ready for 1-click invoice export</span>
          </div>
        </div>

        <div
          onClick={() => navigateToClientSubTab('ar')}
          className="bg-slate-900/70 hover:bg-slate-900 border border-slate-800/90 hover:border-indigo-500/50 rounded-xl p-4 shadow-sm backdrop-blur-xl transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400">Pending Review Items</span>
            <div className="flex items-center gap-1">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition-transform">
                <Clock className="w-3.5 h-3.5" />
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-all" />
            </div>
          </div>
          <div className="text-2xl font-bold text-indigo-300 tracking-tight">{pendingCount}</div>
          <div className="text-[11px] text-slate-400 mt-1 truncate">
            <span>Awaiting bookkeeper sign-off</span>
          </div>
        </div>
      </div>
    );
  }

  // Case 3: AP Active (Without AR)
  if (activeSections.hasAp) {
    const totalBills = stats?.total_slips_ingested ?? 0;
    const flaggedCount = stats?.unreturned_linen_loss_count ?? 0;
    const approvedTotal = stats?.approved_billing_total_ghs ?? 0;
    const pendingCount = stats?.pending_approval_count ?? 0;

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div
          onClick={() => navigateToClientSubTab('ap')}
          className="bg-slate-900/70 hover:bg-slate-900 border border-slate-800/90 hover:border-sky-500/50 rounded-xl p-4 shadow-sm backdrop-blur-xl transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400">Vendor Bills Ingested</span>
            <div className="flex items-center gap-1">
              <div className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 group-hover:scale-105 transition-transform">
                <FileText className="w-3.5 h-3.5" />
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-400 opacity-0 group-hover:opacity-100 transition-all" />
            </div>
          </div>
          <div className="text-2xl font-bold text-white tracking-tight">{totalBills}</div>
          <div className="text-[11px] text-slate-400 mt-1 truncate">
            <span>AP invoices • </span>
            <span className="text-sky-400 font-medium">{selectedMonth} {selectedYear}</span>
          </div>
        </div>

        <div
          onClick={() => navigateToClientSubTab('ap')}
          className="bg-slate-900/70 hover:bg-slate-900 border border-slate-800/90 hover:border-amber-500/50 rounded-xl p-4 shadow-sm backdrop-blur-xl transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400">Flagged For Review</span>
            <div className="flex items-center gap-1">
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-105 transition-transform">
                <AlertTriangle className="w-3.5 h-3.5" />
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-all" />
            </div>
          </div>
          <div className="text-2xl font-bold text-amber-400 tracking-tight">{flaggedCount}</div>
          <div className="text-[11px] text-slate-400 mt-1 truncate">
            <span>Price &amp; quantity variances</span>
          </div>
        </div>

        <div
          onClick={() => navigateToClientSubTab('ap')}
          className="bg-slate-900/70 hover:bg-slate-900 border border-slate-800/90 hover:border-emerald-500/50 rounded-xl p-4 shadow-sm backdrop-blur-xl transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400">Approved AP Total</span>
            <div className="flex items-center gap-1">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
                <CheckCircle className="w-3.5 h-3.5" />
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-emerald-400 opacity-0 group-hover:opacity-100 transition-all" />
            </div>
          </div>
          <div className="text-2xl font-bold text-emerald-400 tracking-tight font-mono">
            {formatCurrency(approvedTotal)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 truncate">
            <span>Ready for ERP bill post</span>
          </div>
        </div>

        <div
          onClick={() => navigateToClientSubTab('ap')}
          className="bg-slate-900/70 hover:bg-slate-900 border border-slate-800/90 hover:border-indigo-500/50 rounded-xl p-4 shadow-sm backdrop-blur-xl transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400">Pending AP Review</span>
            <div className="flex items-center gap-1">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition-transform">
                <Clock className="w-3.5 h-3.5" />
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-all" />
            </div>
          </div>
          <div className="text-2xl font-bold text-indigo-300 tracking-tight">{pendingCount}</div>
          <div className="text-[11px] text-slate-400 mt-1 truncate">
            <span>Awaiting AP sign-off</span>
          </div>
        </div>
      </div>
    );
  }

  // Case 4: Bank Active (Without AR or AP)
  const totalStatements = stats?.total_slips_ingested ?? 0;
  const unreconciledCount = stats?.unreturned_linen_loss_count ?? 0;
  const reconciledTotal = stats?.approved_billing_total_ghs ?? 0;
  const pendingRequests = stats?.pending_approval_count ?? 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
      <div
        onClick={() => navigateToClientSubTab('bank')}
        className="bg-slate-900/70 hover:bg-slate-900 border border-slate-800/90 hover:border-sky-500/50 rounded-xl p-4 shadow-sm backdrop-blur-xl transition-all cursor-pointer group"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-400">Bank Lines Ingested</span>
          <div className="flex items-center gap-1">
            <div className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 group-hover:scale-105 transition-transform">
              <FileText className="w-3.5 h-3.5" />
            </div>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-400 opacity-0 group-hover:opacity-100 transition-all" />
          </div>
        </div>
        <div className="text-2xl font-bold text-white tracking-tight">{totalStatements}</div>
        <div className="text-[11px] text-slate-400 mt-1 truncate">
          <span>Statement lines • </span>
          <span className="text-sky-400 font-medium">{selectedMonth} {selectedYear}</span>
        </div>
      </div>

      <div
        onClick={() => navigateToClientSubTab('bank')}
        className="bg-slate-900/70 hover:bg-slate-900 border border-slate-800/90 hover:border-amber-500/50 rounded-xl p-4 shadow-sm backdrop-blur-xl transition-all cursor-pointer group"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-400">Unreconciled Items</span>
          <div className="flex items-center gap-1">
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-105 transition-transform">
              <AlertTriangle className="w-3.5 h-3.5" />
            </div>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-all" />
          </div>
        </div>
        <div className="text-2xl font-bold text-amber-400 tracking-tight">{unreconciledCount}</div>
        <div className="text-[11px] text-slate-400 mt-1 truncate">
          <span>Requires clarification or receipt</span>
        </div>
      </div>

      <div
        onClick={() => navigateToClientSubTab('bank')}
        className="bg-slate-900/70 hover:bg-slate-900 border border-slate-800/90 hover:border-emerald-500/50 rounded-xl p-4 shadow-sm backdrop-blur-xl transition-all cursor-pointer group"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-400">Reconciled Volume</span>
          <div className="flex items-center gap-1">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
              <CheckCircle className="w-3.5 h-3.5" />
            </div>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-emerald-400 opacity-0 group-hover:opacity-100 transition-all" />
          </div>
        </div>
        <div className="text-2xl font-bold text-emerald-400 tracking-tight font-mono">
          {formatCurrency(reconciledTotal)}
        </div>
        <div className="text-[11px] text-slate-400 mt-1 truncate">
          <span>Matched to ledger entries</span>
        </div>
      </div>

      <div
        onClick={() => navigateToClientSubTab('requests')}
        className="bg-slate-900/70 hover:bg-slate-900 border border-slate-800/90 hover:border-indigo-500/50 rounded-xl p-4 shadow-sm backdrop-blur-xl transition-all cursor-pointer group"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-400">Info Requests</span>
          <div className="flex items-center gap-1">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition-transform">
              <Clock className="w-3.5 h-3.5" />
            </div>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-all" />
          </div>
        </div>
        <div className="text-2xl font-bold text-indigo-300 tracking-tight">{pendingRequests}</div>
        <div className="text-[11px] text-slate-400 mt-1 truncate">
          <span>Awaiting client explanation</span>
        </div>
      </div>
    </div>
  );
};
