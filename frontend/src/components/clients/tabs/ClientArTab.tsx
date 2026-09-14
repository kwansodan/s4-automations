import React, { useState, useEffect, useMemo } from 'react';
import { useClient } from '../../../context/ClientContext';
import { useAutomation } from '../../../context/AutomationContext';
import {
  fetchClientTransactions,
  fetchClientTransactionsSummary,
  toggleClientTransaction,
  batchToggleTransactions,
  batchApproveTransactions,
  runClientStrategy,
  ClientTransactionSummaryRow,
} from '../../../lib/api';
import { formatCurrency } from '../../../lib/utils';
import {
  Receipt,
  AlertTriangle,
  RefreshCw,
  Check,
  CheckCheck,
  Calendar,
  Search,
  FileText,
  PlayCircle,
  Database,
  X,
  Info,
} from 'lucide-react';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const YEARS = [2025, 2026, 2027];

export const ClientArTab: React.FC = () => {
  const { currentClient } = useClient();
  const {
    selectedMonth,
    setSelectedMonth,
    selectedYear,
    setSelectedYear,
    setIsInvoiceModalOpen,
    refreshAll,
    isLoading,
    addLog,
  } = useAutomation();

  const [search, setSearch] = useState('');
  const [transactions, setTransactions] = useState<any[]>([]);
  const [summaryRows, setSummaryRows] = useState<ClientTransactionSummaryRow[]>([]);
  const [summaryStats, setSummaryStats] = useState<any>(null);
  const [isLoadingTx, setIsLoadingTx] = useState(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isRunningOcr, setIsRunningOcr] = useState(false);
  const [runFeedback, setRunFeedback] = useState<{ type: 'success' | 'warning' | 'error'; message: string; details?: string } | null>(null);
  const [activeLedgerView, setActiveLedgerView] = useState<'summary' | 'daily'>('summary');

  const loadTransactions = async () => {
    if (!currentClient?.id) return;
    setIsLoadingTx(true);
    try {
      const data = await fetchClientTransactions(currentClient.id, undefined, selectedMonth, selectedYear, 'AR');
      setTransactions(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.warn('Failed loading client transactions:', err);
    } finally {
      setIsLoadingTx(false);
    }
  };

  const loadSummaryData = async () => {
    if (!currentClient?.id) return;
    setIsLoadingSummary(true);
    try {
      const res = await fetchClientTransactionsSummary(currentClient.id, selectedMonth, selectedYear, 'AR');
      setSummaryRows(res?.summary || []);
      setSummaryStats(res || null);
    } catch (err: any) {
      console.warn('Failed loading client transactions summary:', err);
    } finally {
      setIsLoadingSummary(false);
    }
  };

  useEffect(() => {
    loadTransactions();
    loadSummaryData();
  }, [currentClient?.id, selectedMonth, selectedYear]);

  const handleToggleSummaryApproval = async (row: ClientTransactionSummaryRow, field: 'reviewed' | 'approved') => {
    if (!currentClient?.id || !row.transaction_ids || row.transaction_ids.length === 0) return;
    const currentVal = field === 'approved' ? row.is_fully_approved : row.is_fully_reviewed;
    const newVal = !currentVal;

    // Optimistic UI update for summary
    setSummaryRows((prev) =>
      prev.map((r) => {
        if (r.item_name === row.item_name) {
          return {
            ...r,
            [field === 'approved' ? 'is_fully_approved' : 'is_fully_reviewed']: newVal,
            [field === 'approved' ? 'approved_count' : 'reviewed_count']: newVal ? r.slips_count : 0,
            ...(field === 'approved' && newVal ? { is_fully_reviewed: true, reviewed_count: r.slips_count } : {}),
          };
        }
        return r;
      })
    );

    try {
      await batchToggleTransactions(currentClient.id, row.transaction_ids, field, newVal);
      if (field === 'approved' && newVal) {
        await batchToggleTransactions(currentClient.id, row.transaction_ids, 'reviewed', true);
      }
      await Promise.all([loadTransactions(), loadSummaryData()]);
    } catch (err: any) {
      addLog('error', `Failed toggling ${field}: ${err.message}`);
      await loadSummaryData();
    }
  };

  const handleToggleTx = async (txId: number, field: 'reviewed' | 'approved', currentVal: boolean) => {
    if (!currentClient?.id) return;
    const newVal = !currentVal;

    // Optimistic UI update for daily transaction
    setTransactions((prev) =>
      prev.map((t) => (t.id === txId ? { ...t, [field]: newVal, ...(field === 'approved' && newVal ? { reviewed: true } : {}) } : t))
    );

    try {
      await toggleClientTransaction(currentClient.id, txId, field, newVal);
      if (field === 'approved' && newVal) {
        await toggleClientTransaction(currentClient.id, txId, 'reviewed', true);
      }
      await loadSummaryData();
    } catch (err: any) {
      addLog('error', `Failed updating transaction: ${err.message}`);
      await loadTransactions();
    }
  };

  const handleRunArOcr = async (forceReprocess: boolean = false) => {
    setIsRunningOcr(true);
    setRunFeedback(null);
    addLog('info', `[AR OCR] Extracting control slips for ${currentClient.name} (${selectedMonth} ${selectedYear})${forceReprocess ? ' [Force Reprocess]' : ''}...`);
    try {
      const res = await runClientStrategy(currentClient.id, false, {
        month: selectedMonth,
        year: selectedYear,
        force_reprocess: forceReprocess,
      });
      const sourcesCount = res.sources_discovered ?? 0;
      const itemsCount = res.items_extracted ?? 0;

      if (sourcesCount === 0 || itemsCount === 0) {
        const warningMsg = res.message || `No slip files (.jpg, .png, .pdf) found in Google Drive folder for ${selectedMonth} ${selectedYear}.`;
        addLog('warning', `[AR OCR] ${warningMsg}`);
        setRunFeedback({
          type: 'warning',
          message: warningMsg,
          details: 'Please check that slip images or PDFs are placed directly inside the month folder in Google Drive and that the service account has access.',
        });
      } else {
        const successMsg = res.message || `Ingestion complete: ${itemsCount} line items staged from ${sourcesCount} slip files.`;
        addLog('success', `[AR OCR] ${successMsg}`);
        setRunFeedback({
          type: 'success',
          message: successMsg,
        });
      }
      await Promise.all([refreshAll(), loadTransactions(), loadSummaryData()]);
    } catch (err: any) {
      const errorMsg = `AR OCR extraction error: ${err.message || err}`;
      addLog('error', errorMsg);
      setRunFeedback({
        type: 'error',
        message: errorMsg,
      });
    } finally {
      setIsRunningOcr(false);
    }
  };

  const handleBatchApprove = async () => {
    const idsToApprove = transactions.filter((t) => !t.approved && t.pipeline_type !== 'AP').map((t) => t.id);
    if (idsToApprove.length === 0) return;

    setIsApproving(true);
    try {
      await batchApproveTransactions(currentClient.id, idsToApprove, 'Approved via In-App PostgreSQL Ledger');
      addLog('success', `Approved ${idsToApprove.length} AR transactions for ${currentClient.name}.`);
      await Promise.all([loadTransactions(), loadSummaryData()]);
    } catch (err: any) {
      addLog('error', `Failed approving transactions: ${err.message}`);
    } finally {
      setIsApproving(false);
    }
  };

  const query = (search || '').trim().toLowerCase();

  const filteredSummaryRows = useMemo(() => {
    if (!query) return summaryRows;
    return summaryRows.filter((r) => {
      const item = (r?.item_name || '').toLowerCase();
      return item.includes(query);
    });
  }, [summaryRows, query]);

  const arStagedTx = transactions.filter((t) => t.pipeline_type !== 'AP');

  const filteredArStagedTx = useMemo(() => {
    if (!query) return arStagedTx;
    return arStagedTx.filter((t) => {
      const desc = (t?.item_or_description || '').toLowerCase();
      const cat = (t?.category_or_account || '').toLowerCase();
      const date = (t?.transaction_date || '').toLowerCase();
      const status = (t?.status || '').toLowerCase();
      const file = (t?.source_file_name || '').toLowerCase();
      return (
        desc.includes(query) ||
        cat.includes(query) ||
        date.includes(query) ||
        status.includes(query) ||
        file.includes(query)
      );
    });
  }, [arStagedTx, query]);

  // Approved totals from In-App PostgreSQL Ledger
  const dbApprovedCount = transactions.filter((t) => t.approved && t.status !== 'INVOICED').length;
  const dbApprovedAmount = summaryRows
    .filter((r) => r.is_fully_approved)
    .reduce((sum, r) => sum + (r.total_billed || 0), 0) ||
    transactions
      .filter((t) => t.approved && t.status !== 'INVOICED')
      .reduce((sum, t) => sum + (t.total_amount || 0), 0);

  const approvedRowsCount = dbApprovedCount;
  const totalApprovedAmount = dbApprovedAmount;

  const handleGenerateInvoicesClick = () => {
    if (approvedRowsCount === 0) {
      addLog(
        'warning',
        `No approved line items found for ${selectedMonth} ${selectedYear}. Please check the 'Approved' checkbox on items in the ledger below, or click 'Run AR Extraction' to pull daily slips.`
      );
      return;
    }
    setIsInvoiceModalOpen(true);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header & Controls Toolbar */}
      <div className="glass-panel rounded-2xl p-5 shadow-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-bold text-white tracking-tight">
              Accounts Receivable &amp; Review Sheets
            </h2>
            <span className="text-[10px] font-mono font-bold text-sky-400 bg-sky-950/80 border border-sky-500/30 px-2 py-0.5 rounded-full">
              {currentClient.name}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Audit OCR extracted laundry/sales control slips, reconcile linen losses, and generate Zoho Books invoices.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Period Selector */}
          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1 text-xs">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-transparent text-white font-medium focus:outline-none cursor-pointer"
            >
              {MONTHS.map((m) => (
                <option key={m} value={m} className="bg-slate-900 text-white">
                  {m}
                </option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="bg-transparent text-white font-medium focus:outline-none cursor-pointer ml-1"
            >
              {YEARS.map((y) => (
                <option key={y} value={y} className="bg-slate-900 text-white">
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Run OCR */}
          <button
            onClick={() => handleRunArOcr()}
            disabled={isRunningOcr}
            className="flex items-center gap-1.5 bg-sky-950/60 hover:bg-sky-900/60 border border-sky-500/40 text-sky-300 text-xs font-semibold px-3.5 py-1.5 rounded-xl transition cursor-pointer disabled:opacity-50"
          >
            <PlayCircle className={`w-3.5 h-3.5 ${isRunningOcr ? 'animate-spin' : ''}`} />
            <span>{isRunningOcr ? 'Extracting Slips...' : 'Run AR Extraction'}</span>
          </button>

          {/* Refresh */}
          <button
            onClick={() => { refreshAll(); loadTransactions(); loadSummaryData(); }}
            disabled={isLoading || isLoadingTx}
            className="p-2 bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-xl transition cursor-pointer"
            title="Refresh AR Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading || isLoadingTx ? 'animate-spin text-sky-400' : ''}`} />
          </button>

          {/* 1-Click Invoice Export */}
          <button
            onClick={handleGenerateInvoicesClick}
            className={`flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-xl shadow-lg transition cursor-pointer ${
              approvedRowsCount > 0
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-600/25'
                : 'bg-slate-900 hover:bg-slate-850 text-slate-400 hover:text-slate-200 border border-slate-700/60'
            }`}
            title={approvedRowsCount === 0 ? "Approve items below first to generate draft invoices" : "Generate Zoho Books Draft Invoices"}
          >
            <Check className="w-4 h-4" />
            <span>Generate Invoices ({approvedRowsCount} - {formatCurrency(totalApprovedAmount)})</span>
          </button>
        </div>
      </div>

      {/* Execution Feedback Notification Banner */}
      {runFeedback && (
        <div
          className={`flex items-start justify-between gap-3 p-4 rounded-xl border transition animate-in fade-in slide-in-from-top-2 ${
            runFeedback.type === 'error'
              ? 'bg-rose-950/40 border-rose-500/50 text-rose-200'
              : runFeedback.type === 'warning'
              ? 'bg-amber-950/40 border-amber-500/50 text-amber-200'
              : 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {runFeedback.type === 'error' ? (
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            ) : runFeedback.type === 'warning' ? (
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            ) : (
              <Check className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            )}
            <div>
              <div className="font-semibold text-xs">{runFeedback.message}</div>
              {runFeedback.details && (
                <div className="text-[11px] opacity-80 mt-0.5 font-normal">{runFeedback.details}</div>
              )}
            </div>
          </div>
          <button
            onClick={() => setRunFeedback(null)}
            className="p-1 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
            title="Dismiss notice"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Mode Switcher & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800/80 rounded-xl p-2">
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setActiveLedgerView('summary')}
            className={`px-3 py-1 text-xs font-bold rounded-md transition cursor-pointer flex items-center gap-1.5 ${
              activeLedgerView === 'summary'
                ? 'bg-sky-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Monthly Summary ({summaryRows.length})</span>
          </button>
          <button
            onClick={() => setActiveLedgerView('daily')}
            className={`px-3 py-1 text-xs font-bold rounded-md transition cursor-pointer flex items-center gap-1.5 ${
              activeLedgerView === 'daily'
                ? 'bg-sky-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Daily Slips ({arStagedTx.length})</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleBatchApprove}
            disabled={isApproving || arStagedTx.filter(t => !t.approved).length === 0}
            className="flex items-center gap-1.5 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/40 text-emerald-300 text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-40"
            title="1-Click Approve all pending transactions in DB"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span>{isApproving ? 'Approving...' : '1-Click Approve All'}</span>
          </button>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search item, slip or date..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 sm:w-60"
            />
          </div>
        </div>
      </div>

      {/* Primary In-App PostgreSQL Ledger Notice */}
      <div className="bg-emerald-950/25 border border-emerald-500/20 rounded-xl px-3.5 py-2 flex items-center justify-between gap-2 text-xs text-emerald-300">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 relative shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span>
            <strong>Native In-App PostgreSQL Ledger Active:</strong> Daily control slips, linen loss reconciliations, and review approvals are committed directly to PostgreSQL. Zoho Books invoices are generated directly from approved transactions.
          </span>
        </div>
      </div>

      {/* Main Table Views */}
      <div className="glass-panel rounded-2xl overflow-hidden shadow-xl border border-slate-800">
        <div className="overflow-x-auto custom-scrollbar">
          
          {/* VIEW 1: IN-APP POSTGRESQL MONTHLY SUMMARY */}
          {activeLedgerView === 'summary' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-3 px-4">Standard Item Name</th>
                  <th className="py-3 px-4 text-center">Total Picked Up</th>
                  <th className="py-3 px-4 text-center">Total Delivered</th>
                  <th className="py-3 px-4 text-center">Linen Loss Discrepancy</th>
                  <th className="py-3 px-4 text-right">Unit Rate</th>
                  <th className="py-3 px-4 text-right">Total Billed</th>
                  <th className="py-3 px-4 text-center">Slips Count</th>
                  <th className="py-3 px-4 text-center">Reviewed</th>
                  <th className="py-3 px-4 text-center">Approved</th>
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300 font-medium">
                {filteredSummaryRows.length > 0 ? (
                  filteredSummaryRows.map((row) => {
                    const lossQty = row.linen_discrepancy || 0;
                    return (
                      <tr
                        key={row.item_name}
                        className={`hover:bg-slate-850/50 transition-colors ${
                          row.is_fully_approved ? 'bg-emerald-950/15' : lossQty > 0 ? 'bg-amber-950/10' : ''
                        }`}
                      >
                        <td className="py-3 px-4 font-bold text-white">{row.item_name}</td>
                        <td className="py-3 px-4 text-center font-mono">{row.total_picked_up}</td>
                        <td className="py-3 px-4 text-center font-mono">{row.total_delivered}</td>
                        <td className="py-3 px-4 text-center">
                          {lossQty > 0 ? (
                            <span className="inline-flex items-center gap-1 text-amber-400 font-mono font-bold bg-amber-950/60 border border-amber-500/30 px-2 py-0.5 rounded">
                              <AlertTriangle className="w-3 h-3" />
                              <span>+{lossQty}</span>
                            </span>
                          ) : (
                            <span className="text-slate-500 font-mono">0</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono">{formatCurrency(row.unit_rate)}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                          {formatCurrency(row.total_billed)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="text-[11px] font-mono text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-full">
                            {row.slips_count} slips
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(row.is_fully_reviewed)}
                            onChange={() => handleToggleSummaryApproval(row, 'reviewed')}
                            className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-sky-600 focus:ring-sky-500 cursor-pointer"
                            title={`${row.reviewed_count}/${row.slips_count} slips reviewed`}
                          />
                        </td>
                        <td className="py-3 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(row.is_fully_approved)}
                            onChange={() => handleToggleSummaryApproval(row, 'approved')}
                            className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                            title={`${row.approved_count}/${row.slips_count} slips approved`}
                          />
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                              row.is_fully_approved
                                ? 'bg-emerald-950 border border-emerald-500/40 text-emerald-300'
                                : 'bg-amber-950/60 border border-amber-500/30 text-amber-400'
                            }`}
                          >
                            {row.is_fully_approved ? 'APPROVED' : 'PENDING'}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-500 text-xs">
                      {isLoadingSummary
                        ? 'Loading PostgreSQL reconciliation summary...'
                        : `No AR summary line items found for ${selectedMonth} ${selectedYear}. Click 'Run AR Extraction' above to process daily control slips.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {/* VIEW 2: IN-APP POSTGRESQL DAILY SLIPS */}
          {activeLedgerView === 'daily' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Slip Filename</th>
                  <th className="py-3 px-4">Item Description</th>
                  <th className="py-3 px-4 text-center">Picked Up</th>
                  <th className="py-3 px-4 text-center">Delivered</th>
                  <th className="py-3 px-4 text-center">Linen Loss</th>
                  <th className="py-3 px-4 text-right">Unit Rate</th>
                  <th className="py-3 px-4 text-right">Total Amount</th>
                  <th className="py-3 px-4 text-center">Reviewed</th>
                  <th className="py-3 px-4 text-center">Approved</th>
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300 font-medium">
                {filteredArStagedTx.length > 0 ? (
                  filteredArStagedTx.map((tx) => {
                    const lossQty = tx.discrepancy_amount || 0;
                    const pickQty = tx.credit_amount || tx.quantity_or_debit || 0;
                    const delivQty = tx.quantity_or_debit || 0;
                    const rate = tx.rate_or_price || 0;
                    const total = tx.total_amount || 0;
                    return (
                      <tr
                        key={tx.id}
                        className={`hover:bg-slate-850/50 transition-colors ${
                          tx.approved ? 'bg-emerald-950/15' : lossQty > 0 ? 'bg-amber-950/10' : ''
                        }`}
                      >
                        <td className="py-3 px-4 font-mono text-slate-400">{tx.transaction_date || '—'}</td>
                        <td className="py-3 px-4 font-mono text-[11px] text-sky-400 max-w-[160px] truncate" title={tx.source_file_name}>
                          {tx.source_file_name || 'Slip'}
                        </td>
                        <td className="py-3 px-4 font-bold text-white">{tx.item_or_description}</td>
                        <td className="py-3 px-4 text-center font-mono">{pickQty}</td>
                        <td className="py-3 px-4 text-center font-mono">{delivQty}</td>
                        <td className="py-3 px-4 text-center">
                          {lossQty > 0 ? (
                            <span className="text-amber-400 font-mono font-bold bg-amber-950/60 border border-amber-500/30 px-1.5 py-0.5 rounded">
                              +{lossQty}
                            </span>
                          ) : (
                            <span className="text-slate-500 font-mono">0</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono">{formatCurrency(rate)}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                          {formatCurrency(total)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(tx.reviewed)}
                            onChange={() => handleToggleTx(tx.id, 'reviewed', tx.reviewed)}
                            className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-sky-600 focus:ring-sky-500 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(tx.approved)}
                            onChange={() => handleToggleTx(tx.id, 'approved', tx.approved)}
                            className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                              tx.status === 'INVOICED'
                                ? 'bg-sky-950 border border-sky-500/40 text-sky-300'
                                : tx.approved
                                ? 'bg-emerald-950 border border-emerald-500/40 text-emerald-300'
                                : 'bg-amber-950/60 border border-amber-500/30 text-amber-400'
                            }`}
                          >
                            {tx.status === 'INVOICED' ? 'INVOICED' : tx.approved ? 'APPROVED' : tx.status || 'PENDING'}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-slate-500 text-xs">
                      {isLoadingTx ? 'Loading daily slips from PostgreSQL...' : 'No daily slips found in database for this period.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
  );
};
