import React, { useState, useEffect, useMemo } from 'react';
import { useClient } from '../../../context/ClientContext';
import { useAutomation } from '../../../context/AutomationContext';
import {
  fetchClientTransactions,
  batchApproveTransactions,
  runClientStrategy,
} from '../../../lib/api';
import { formatCurrency } from '../../../lib/utils';
import {
  Receipt,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Check,
  CheckCheck,
  Calendar,
  Search,
  FileText,
  Clock,
  PlayCircle,
  Sparkles,
} from 'lucide-react';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const YEARS = [2025, 2026, 2027];

export const ClientArTab: React.FC = () => {
  const { currentClient } = useClient();
  const {
    sheetsData,
    selectedMonth,
    setSelectedMonth,
    selectedYear,
    setSelectedYear,
    sheetsSubTab,
    setSheetsSubTab,
    handleToggleApproval,
    setIsInvoiceModalOpen,
    refreshAll,
    isLoading,
    addLog,
  } = useAutomation();

  const [search, setSearch] = useState('');
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoadingTx, setIsLoadingTx] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isRunningOcr, setIsRunningOcr] = useState(false);
  const [activeLedgerView, setActiveLedgerView] = useState<'sheets' | 'staged'>('sheets');

  const loadTransactions = async () => {
    setIsLoadingTx(true);
    try {
      const data = await fetchClientTransactions(currentClient.id);
      setTransactions(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.warn('Failed loading client transactions:', err);
    } finally {
      setIsLoadingTx(false);
    }
  };

  useEffect(() => {
    loadTransactions();
  }, [currentClient.id]);

  const handleRunArOcr = async (forceReprocess: boolean = false) => {
    setIsRunningOcr(true);
    addLog('info', `[AR OCR] Extracting control slips for ${currentClient.name} (${selectedMonth} ${selectedYear})${forceReprocess ? ' [Force Reprocess]' : ''}...`);
    try {
      const res = await runClientStrategy(currentClient.id, false, {
        month: selectedMonth,
        year: selectedYear,
        force_reprocess: forceReprocess,
      });
      addLog('success', `[AR OCR] Ingestion complete: ${res.message || 'Slips extracted and staged.'}`);
      await refreshAll();
      await loadTransactions();
    } catch (err: any) {
      addLog('error', `AR OCR extraction error: ${err.message}`);
    } finally {
      setIsRunningOcr(false);
    }
  };

  const handleBatchApprove = async () => {
    const idsToApprove = transactions.filter((t) => !t.approved && t.pipeline_type !== 'AP').map((t) => t.id);
    if (idsToApprove.length === 0) return;

    setIsApproving(true);
    try {
      await batchApproveTransactions(currentClient.id, idsToApprove, 'Approved via Client AR Workspace');
      addLog('success', `Approved ${idsToApprove.length} AR transactions for ${currentClient.name}.`);
      await loadTransactions();
    } catch (err: any) {
      addLog('error', `Failed approving transactions: ${err.message}`);
    } finally {
      setIsApproving(false);
    }
  };

  const dailyDetails = sheetsData?.daily_details || [];
  const monthlySummary = sheetsData?.monthly_summary || [];

  const query = (search || '').trim().toLowerCase();

  const filteredDaily = useMemo(() => {
    if (!query) return dailyDetails;
    return dailyDetails.filter((d) => {
      const client = (d?.client_name || '').toLowerCase();
      const item = (d?.item_name || '').toLowerCase();
      const file = (d?.file_name || '').toLowerCase();
      const cat = (d?.category || '').toLowerCase();
      const date = (d?.date || '').toLowerCase();
      return (
        client.includes(query) ||
        item.includes(query) ||
        file.includes(query) ||
        cat.includes(query) ||
        date.includes(query)
      );
    });
  }, [dailyDetails, query]);

  const filteredSummary = useMemo(() => {
    if (!query) return monthlySummary;
    return monthlySummary.filter((s) => {
      const client = (s?.client_name || '').toLowerCase();
      const item = (s?.item_name || '').toLowerCase();
      const status = (s?.status || '').toLowerCase();
      return (
        client.includes(query) ||
        item.includes(query) ||
        status.includes(query)
      );
    });
  }, [monthlySummary, query]);

  const arStagedTx = transactions.filter((t) => t.pipeline_type !== 'AP');

  const filteredArStagedTx = useMemo(() => {
    if (!query) return arStagedTx;
    return arStagedTx.filter((t) => {
      const desc = (t?.item_or_description || '').toLowerCase();
      const cat = (t?.category_or_account || '').toLowerCase();
      const date = (t?.transaction_date || '').toLowerCase();
      const status = (t?.status || '').toLowerCase();
      return (
        desc.includes(query) ||
        cat.includes(query) ||
        date.includes(query) ||
        status.includes(query)
      );
    });
  }, [arStagedTx, query]);

  const sheetsApprovedCount = monthlySummary.filter((s) => s.approved && s.status !== 'INVOICED').length;
  const sheetsApprovedAmount = monthlySummary
    .filter((s) => s.approved && s.status !== 'INVOICED')
    .reduce((sum, r) => sum + (r.total_billed || 0), 0);

  const stagedApprovedCount = arStagedTx.filter((t) => t.approved && t.status !== 'INVOICED').length;
  const stagedApprovedAmount = arStagedTx
    .filter((t) => t.approved && t.status !== 'INVOICED')
    .reduce((sum, t) => sum + (t.credit_amount || t.total_amount || 0), 0);

  const approvedRowsCount = activeLedgerView === 'staged'
    ? stagedApprovedCount
    : (sheetsApprovedCount || stagedApprovedCount);

  const totalApprovedAmount = activeLedgerView === 'staged'
    ? stagedApprovedAmount
    : (sheetsApprovedAmount || stagedApprovedAmount);

  const handleGenerateInvoicesClick = () => {
    if (approvedRowsCount === 0) {
      addLog(
        'warning',
        `No approved line items found for ${selectedMonth} ${selectedYear}. Please check the 'Approved' checkbox on items in the table below, or click 'Run AR Extraction' to pull daily slips.`
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

          {/* External Google Sheets Link */}
          {sheetsData?.spreadsheet_url && (
            <a
              href={sheetsData.spreadsheet_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/30 text-emerald-300 text-xs font-semibold px-3 py-1.5 rounded-xl transition cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Google Sheet</span>
            </a>
          )}

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
            onClick={() => { refreshAll(); loadTransactions(); }}
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

      {/* Mode Switcher & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800/80 rounded-xl p-2">
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => { setActiveLedgerView('sheets'); setSheetsSubTab('monthly'); }}
            className={`px-3 py-1 text-xs font-bold rounded-md transition cursor-pointer ${
              activeLedgerView === 'sheets' && sheetsSubTab === 'monthly'
                ? 'bg-sky-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Monthly Summary ({monthlySummary.length})
          </button>
          <button
            onClick={() => { setActiveLedgerView('sheets'); setSheetsSubTab('daily'); }}
            className={`px-3 py-1 text-xs font-bold rounded-md transition cursor-pointer ${
              activeLedgerView === 'sheets' && sheetsSubTab === 'daily'
                ? 'bg-sky-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Daily Slips ({dailyDetails.length})
          </button>
          <button
            onClick={() => setActiveLedgerView('staged')}
            className={`px-3 py-1 text-xs font-bold rounded-md transition cursor-pointer ${
              activeLedgerView === 'staged'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Staged DB Ledger ({arStagedTx.length})
          </button>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search hotel, item, or slip filename..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 sm:w-72"
          />
        </div>
      </div>

      {/* Dynamic Spreadsheet Formula Notice */}
      <div className="bg-sky-950/30 border border-sky-500/20 rounded-xl px-3.5 py-2 flex items-center justify-between gap-2 text-xs text-sky-300">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 relative shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
          </span>
          <span>
            <strong>Dynamic Spreadsheet Linking Active:</strong> Monthly Summary totals are live Google Sheets formula rollups (<code className="text-sky-200 font-mono">=SUMIFS</code>, <code className="text-sky-200 font-mono">=MAX</code>, <code className="text-sky-200 font-mono">=ROUND</code>) calculated directly from Daily Details. Manual corrections to slips in Daily Details or Google Sheets immediately recalculate the summary.
          </span>
        </div>
        {sheetsData?.spreadsheet_url && (
          <a
            href={sheetsData.spreadsheet_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 underline shrink-0 cursor-pointer"
          >
            <span>Live Sheet</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Main Table Views */}
      <div className="glass-panel rounded-2xl overflow-hidden shadow-xl border border-slate-800">
        <div className="overflow-x-auto custom-scrollbar">
          
          {/* VIEW 1: MONTHLY SUMMARY */}
          {activeLedgerView === 'sheets' && sheetsSubTab === 'monthly' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-3 px-4">Client / Hotel</th>
                  <th className="py-3 px-4">Item Name</th>
                  <th className="py-3 px-4 text-center">Pickup</th>
                  <th className="py-3 px-4 text-center">Delivery</th>
                  <th className="py-3 px-4 text-center">Discrepancy (Loss)</th>
                  <th className="py-3 px-4 text-right">Unit Rate</th>
                  <th className="py-3 px-4 text-right">Total Billed</th>
                  <th className="py-3 px-4 text-center">Reviewed</th>
                  <th className="py-3 px-4 text-center">Approved</th>
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300 font-medium">
                {filteredSummary.length > 0 ? (
                  filteredSummary.map((row) => (
                    <tr
                      key={row.row_index}
                      className={`hover:bg-slate-850/50 transition-colors ${
                        row.approved ? 'bg-emerald-950/15' : row.linen_discrepancy > 0 ? 'bg-amber-950/10' : ''
                      }`}
                    >
                      <td className="py-3 px-4 font-bold text-white">{row.client_name}</td>
                      <td className="py-3 px-4">{row.item_name}</td>
                      <td className="py-3 px-4 text-center font-mono">{row.pickup_qty}</td>
                      <td className="py-3 px-4 text-center font-mono">{row.delivery_qty}</td>
                      <td className="py-3 px-4 text-center">
                        {row.linen_discrepancy > 0 ? (
                          <span className="inline-flex items-center gap-1 text-amber-400 font-mono font-bold bg-amber-950/60 border border-amber-500/30 px-2 py-0.5 rounded">
                            <AlertTriangle className="w-3 h-3" />
                            <span>+{row.linen_discrepancy}</span>
                          </span>
                        ) : (
                          <span className="text-slate-500 font-mono">0</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono">{formatCurrency(row.unit_price)}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                        {formatCurrency(row.total_billed)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={row.reviewed}
                          onChange={(e) => handleToggleApproval(row.row_index, 'reviewed', e.target.checked)}
                          className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-sky-600 focus:ring-sky-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={row.approved}
                          onChange={(e) => handleToggleApproval(row.row_index, 'approved', e.target.checked)}
                          className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            row.approved
                              ? 'bg-emerald-950 border border-emerald-500/40 text-emerald-300'
                              : row.status === 'INVOICED'
                              ? 'bg-sky-950 border border-sky-500/40 text-sky-300'
                              : 'bg-slate-950 border border-slate-700 text-slate-400'
                          }`}
                        >
                          {row.approved ? 'APPROVED' : row.status || 'PENDING'}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-500 text-xs">
                      No monthly summary line items found for {selectedMonth} {selectedYear}. Run the AR Extraction above to ingest control slips.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {/* VIEW 2: DAILY DETAILS */}
          {activeLedgerView === 'sheets' && sheetsSubTab === 'daily' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Client / Hotel</th>
                  <th className="py-3 px-4">Slip Filename</th>
                  <th className="py-3 px-4">Item Name</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4 text-center">Pickup</th>
                  <th className="py-3 px-4 text-center">Delivery</th>
                  <th className="py-3 px-4 text-center">Discrepancy</th>
                  <th className="py-3 px-4 text-right">Rate</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300 font-medium">
                {filteredDaily.length > 0 ? (
                  filteredDaily.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-850/50 transition-colors">
                      <td className="py-3 px-4 font-mono text-slate-400">{row.date}</td>
                      <td className="py-3 px-4 font-bold text-white">{row.client_name}</td>
                      <td className="py-3 px-4 font-mono text-[11px] text-sky-400">{row.file_name}</td>
                      <td className="py-3 px-4">{row.item_name}</td>
                      <td className="py-3 px-4">
                        <span className="text-[10px] bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 text-slate-400">
                          {row.category}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono">{row.pickup_quantity}</td>
                      <td className="py-3 px-4 text-center font-mono">{row.delivery_quantity}</td>
                      <td className="py-3 px-4 text-center">
                        {row.discrepancy > 0 ? (
                          <span className="text-amber-400 font-mono font-bold bg-amber-950/60 px-1.5 py-0.5 rounded">
                            +{row.discrepancy}
                          </span>
                        ) : (
                          <span className="text-slate-500 font-mono">0</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono">{formatCurrency(row.unit_price)}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                        {formatCurrency(row.total_amount)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-500 text-xs">
                      No daily detail line items found. Trigger the AR Ingestion above to process Drive slips.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {/* VIEW 3: STAGED DB LEDGER */}
          {activeLedgerView === 'staged' && (
            <div>
              <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300">
                  PostgreSQL Staged AR Transactions ({arStagedTx.length})
                </span>
                <button
                  onClick={handleBatchApprove}
                  disabled={isApproving || arStagedTx.length === 0}
                  className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition cursor-pointer disabled:opacity-50"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>{isApproving ? 'Approving...' : '1-Click Approve All'}</span>
                </button>
              </div>

              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/90 text-slate-400 uppercase font-mono text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Customer / Slip Description</th>
                    <th className="py-3 px-4">Category / Account</th>
                    <th className="py-3 px-4 text-right">Debit</th>
                    <th className="py-3 px-4 text-right">Credit / Total</th>
                    <th className="py-3 px-4 text-center">Confidence</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium text-slate-300">
                  {filteredArStagedTx.length > 0 ? (
                    filteredArStagedTx.map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-800/40 transition">
                        <td className="py-3 px-4 text-slate-400 font-mono">{tx.transaction_date}</td>
                        <td className="py-3 px-4 text-white font-semibold">{tx.item_or_description}</td>
                        <td className="py-3 px-4 text-sky-400">{tx.category_or_account || 'Laundry Revenue'}</td>
                        <td className="py-3 px-4 text-right text-rose-400 font-mono">
                          {tx.quantity_or_debit > 0 ? `GHS ${tx.quantity_or_debit.toFixed(2)}` : '—'}
                        </td>
                        <td className="py-3 px-4 text-right text-emerald-400 font-mono font-bold">
                          {tx.credit_amount > 0 ? `GHS ${tx.credit_amount.toFixed(2)}` : `GHS ${tx.total_amount?.toFixed(2)}`}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="bg-emerald-950 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full text-[10px] font-bold">
                            {((tx.confidence_score || 0.98) * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold inline-flex items-center gap-1 ${
                              tx.approved
                                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'
                                : 'bg-amber-950/80 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            {tx.approved ? <Check className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
                            {tx.approved ? 'APPROVED' : tx.status || 'PENDING'}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-500 text-xs">
                        No staged AR transactions in PostgreSQL database.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

        </div>
      </div>

    </div>
  );
};
