import React, { useState, useEffect } from 'react';
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

  const handleRunArOcr = async () => {
    setIsRunningOcr(true);
    addLog('info', `[AR OCR] Extracting control slips for ${currentClient.name} (${selectedMonth} ${selectedYear})...`);
    try {
      const res = await runClientStrategy(currentClient.id, false);
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

  const filteredDaily = dailyDetails.filter(
    (d) =>
      d.client_name.toLowerCase().includes(search.toLowerCase()) ||
      d.item_name.toLowerCase().includes(search.toLowerCase()) ||
      d.file_name.toLowerCase().includes(search.toLowerCase())
  );

  const filteredSummary = monthlySummary.filter(
    (s) =>
      s.client_name.toLowerCase().includes(search.toLowerCase()) ||
      s.item_name.toLowerCase().includes(search.toLowerCase())
  );

  const arStagedTx = transactions.filter((t) => t.pipeline_type !== 'AP');
  const approvedRowsCount = monthlySummary.filter((s) => s.approved).length;
  const totalApprovedAmount = monthlySummary
    .filter((s) => s.approved)
    .reduce((sum, r) => sum + (r.total_billed || 0), 0);

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
            onClick={handleRunArOcr}
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
            onClick={() => setIsInvoiceModalOpen(true)}
            disabled={approvedRowsCount === 0}
            className="flex items-center gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg shadow-emerald-600/25 transition disabled:opacity-50 cursor-pointer"
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
                  {arStagedTx.length > 0 ? (
                    arStagedTx.map((tx) => (
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
