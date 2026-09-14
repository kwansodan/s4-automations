import React, { useState, useEffect, useMemo } from 'react';
import { useClient } from '../../../context/ClientContext';
import { useAutomation } from '../../../context/AutomationContext';
import {
  fetchClientTransactions,
  triggerApPipeline,
  fetchSheetsData,
  toggleApproval,
} from '../../../lib/api';
import { formatCurrency } from '../../../lib/utils';
import {
  DollarSign,
  PlayCircle,
  RefreshCw,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Search,
  Check,
  Clock,
  ExternalLink,
  ShieldCheck,
  FileSpreadsheet,
  Layers,
  Calendar,
} from 'lucide-react';

export const ClientApTab: React.FC = () => {
  const { currentClient } = useClient();
  const { selectedMonth, selectedYear, addLog } = useAutomation();

  const [transactions, setTransactions] = useState<any[]>([]);
  const [sheetsData, setSheetsData] = useState<any | null>(null);
  const [isLoadingTx, setIsLoadingTx] = useState(false);
  const [isLoadingSheets, setIsLoadingSheets] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isAutoPostDraft, setIsAutoPostDraft] = useState(false);
  const [search, setSearch] = useState('');
  const [runResult, setRunResult] = useState<any | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'summary' | 'daily' | 'ledger'>('summary');

  const loadTransactions = async () => {
    if (!currentClient?.id) return;
    setIsLoadingTx(true);
    try {
      const data = await fetchClientTransactions(currentClient.id);
      setTransactions(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.warn('Failed loading AP transactions:', err);
    } finally {
      setIsLoadingTx(false);
    }
  };

  const loadApSheetsData = async () => {
    if (!currentClient?.id) return;
    setIsLoadingSheets(true);
    try {
      const data = await fetchSheetsData(selectedMonth, selectedYear, 'AP', currentClient.id);
      setSheetsData(data);
    } catch (err: any) {
      console.warn('Failed loading AP sheets review data:', err);
    } finally {
      setIsLoadingSheets(false);
    }
  };

  const refreshAllApData = async () => {
    await Promise.all([loadTransactions(), loadApSheetsData()]);
  };

  useEffect(() => {
    refreshAllApData();
  }, [currentClient?.id, selectedMonth, selectedYear]);

  const handleRunApPipeline = async () => {
    if (!currentClient?.id) return;
    setIsRunning(true);
    setRunResult(null);
    addLog('info', `[AP PIPELINE] Ingesting vendor bills and generating 2-tab review spreadsheet for ${currentClient.name}...`);
    try {
      const res = await triggerApPipeline({
        client_id: currentClient.id,
        month: selectedMonth,
        year: selectedYear,
        auto_post_draft: isAutoPostDraft,
      });
      setRunResult({
        status: 'COMPLETED',
        message: 'AP bill ingestion completed. Updated Daily Details & Monthly Summary tabs in Google Sheets.',
        month: selectedMonth,
        year: selectedYear,
      });
      addLog('success', `[AP PIPELINE] AP bills extracted and synced to Google Sheets for ${currentClient.name}`);
      await refreshAllApData();
    } catch (err: any) {
      addLog('error', `AP Pipeline error: ${err.message}`);
      setRunResult({ status: 'FAILED', message: err.message });
    } finally {
      setIsRunning(false);
    }
  };

  const handleToggleApApproval = async (rowIndex: number, field: 'reviewed' | 'approved', value: boolean) => {
    setSheetsData((prev: any) => {
      if (!prev || !prev.monthly_summary) return prev;
      const updated = prev.monthly_summary.map((r: any) => {
        if (r.row_index === rowIndex) {
          const newRow = { ...r, [field]: value };
          if (field === 'approved' && value) {
            newRow.reviewed = true;
          }
          return newRow;
        }
        return r;
      });
      return { ...prev, monthly_summary: updated };
    });

    try {
      await toggleApproval({
        spreadsheet_id: sheetsData?.spreadsheet_id,
        row_index: rowIndex,
        field,
        value,
        is_ap: true,
      });
    } catch (err: any) {
      console.error('Failed to toggle AP approval:', err);
    }
  };

  const query = (search || '').trim().toLowerCase();

  const apTransactions = transactions.filter((t) => t.pipeline_type === 'AP');
  const filteredApTransactions = useMemo(() => {
    if (!query) return apTransactions;
    return apTransactions.filter(
      (t) =>
        (t?.item_or_description || '').toLowerCase().includes(query) ||
        (t?.source_file_name || '').toLowerCase().includes(query) ||
        (t?.transaction_date || '').toLowerCase().includes(query)
    );
  }, [apTransactions, query]);

  const monthlySummary: any[] = sheetsData?.monthly_summary || [];
  const filteredSummary = useMemo(() => {
    if (!query) return monthlySummary;
    return monthlySummary.filter((s: any) => {
      const vendor = (s?.vendor_name || '').toLowerCase();
      const cat = (s?.category || '').toLowerCase();
      const status = (s?.status || '').toLowerCase();
      const notes = (s?.notes || '').toLowerCase();
      return (
        vendor.includes(query) ||
        cat.includes(query) ||
        status.includes(query) ||
        notes.includes(query)
      );
    });
  }, [monthlySummary, query]);

  const dailyDetails: any[] = sheetsData?.daily_details || [];
  const filteredDaily = useMemo(() => {
    if (!query) return dailyDetails;
    return dailyDetails.filter((d: any) => {
      const vendor = (d?.vendor_name || '').toLowerCase();
      const billNo = (d?.bill_number || '').toLowerCase();
      const file = (d?.file_name || '').toLowerCase();
      const desc = (d?.description || '').toLowerCase();
      const cat = (d?.category || '').toLowerCase();
      const date = (d?.date || '').toLowerCase();
      return (
        vendor.includes(query) ||
        billNo.includes(query) ||
        file.includes(query) ||
        desc.includes(query) ||
        cat.includes(query) ||
        date.includes(query)
      );
    });
  }, [dailyDetails, query]);

  const totalSummaryAmount = monthlySummary.reduce((sum, r) => sum + (r.total_billed || 0), 0);
  const totalApprovedAmount = monthlySummary
    .filter((r) => r.approved)
    .reduce((sum, r) => sum + (r.total_billed || 0), 0);
  const totalApAmount = apTransactions.reduce((sum, t) => sum + (t.total_amount || 0), 0);

  const isLoading = isLoadingTx || isLoadingSheets;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header & Controls */}
      <div className="glass-panel rounded-2xl p-5 shadow-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-bold text-white tracking-tight">
              Accounts Payable (Vendor Bills &amp; Expenses)
            </h2>
            <span className="text-[10px] font-mono font-bold text-indigo-300 bg-indigo-950/80 border border-indigo-500/30 px-2 py-0.5 rounded-full">
              {currentClient?.name || 'Client'}
            </span>
            <span className="text-[10px] font-mono font-semibold text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-full">
              {selectedMonth} {selectedYear}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Extract supplier invoices via Gemini OCR, populate 2-tab Google Sheets (Daily Details &amp; Monthly Summary), and review for automated accounting bill creation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* External Google Sheet Button */}
          {sheetsData?.spreadsheet_url && (
            <a
              href={sheetsData.spreadsheet_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/40 text-emerald-300 text-xs font-semibold px-3 py-2 rounded-xl transition cursor-pointer"
              title="Open AP Review Spreadsheet in Google Sheets"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              <span>AP Google Sheet</span>
              <ExternalLink className="w-3 h-3 opacity-70" />
            </a>
          )}

          {/* Auto Post Toggle */}
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-300 bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl cursor-pointer">
            <input
              type="checkbox"
              checked={isAutoPostDraft}
              onChange={(e) => setIsAutoPostDraft(e.target.checked)}
              className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 cursor-pointer"
            />
            <span>Auto-Post to Accounting API</span>
          </label>

          <button
            onClick={refreshAllApData}
            disabled={isLoading}
            className="p-2 bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-xl transition cursor-pointer"
            title="Refresh AP Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />
          </button>

          <button
            onClick={handleRunApPipeline}
            disabled={isRunning}
            className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg shadow-indigo-600/30 transition cursor-pointer disabled:opacity-50"
          >
            {isRunning ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <PlayCircle className="w-3.5 h-3.5" />
            )}
            <span>Run AP Bill Pipeline</span>
          </button>
        </div>
      </div>

      {/* Result Banner */}
      {runResult && (
        <div
          className={`p-4 rounded-xl border flex items-center gap-3 text-xs ${
            runResult.status === 'COMPLETED'
              ? 'bg-indigo-950/60 border-indigo-500/40 text-indigo-200'
              : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
          }`}
        >
          {runResult.status === 'COMPLETED' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
          )}
          <span>{runResult.message}</span>
        </div>
      )}

      {/* View Switcher Tabs & Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800/80 rounded-xl p-2">
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 overflow-x-auto">
          <button
            onClick={() => setActiveSubTab('summary')}
            className={`px-3 py-1 text-xs font-bold rounded-md transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeSubTab === 'summary'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-300" />
            <span>Monthly Summary ({monthlySummary.length})</span>
          </button>
          <button
            onClick={() => setActiveSubTab('daily')}
            className={`px-3 py-1 text-xs font-bold rounded-md transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeSubTab === 'daily'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-indigo-300" />
            <span>Daily Details ({dailyDetails.length})</span>
          </button>
          <button
            onClick={() => setActiveSubTab('ledger')}
            className={`px-3 py-1 text-xs font-bold rounded-md transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeSubTab === 'ledger'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-indigo-300" />
            <span>Staged DB Ledger ({apTransactions.length})</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-2 text-xs text-slate-400 font-mono">
            {activeSubTab === 'summary' ? (
              <>
                <span>Total: <strong className="text-white font-bold">{formatCurrency(totalSummaryAmount)}</strong></span>
                <span>•</span>
                <span>Approved: <strong className="text-emerald-400 font-bold">{formatCurrency(totalApprovedAmount)}</strong></span>
              </>
            ) : activeSubTab === 'daily' ? (
              <span>Items: <strong className="text-white font-bold">{dailyDetails.length} line items</strong></span>
            ) : (
              <span>Volume: <strong className="text-indigo-300 font-bold">GHS {totalApAmount.toFixed(2)}</strong></span>
            )}
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search vendor, invoice, category..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 sm:w-64"
            />
          </div>
        </div>
      </div>

      {/* Live Dynamic Spreadsheet Linking Banner */}
      <div className="bg-indigo-950/30 border border-indigo-500/20 rounded-xl px-3.5 py-2 flex items-center justify-between gap-2 text-xs text-indigo-300">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 relative shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
          </span>
          <span>
            <strong>Dynamic Spreadsheet Linking Active:</strong> Monthly Summary figures are dynamic formulas (<code className="text-indigo-200 font-mono">=COUNTIFS</code>, <code className="text-indigo-200 font-mono">=SUMIFS</code>) calculated directly from Daily Details. Any manual adjustments in Daily Details or Google Sheets automatically update the summary.
          </span>
        </div>
        {sheetsData?.spreadsheet_url && (
          <a
            href={sheetsData.spreadsheet_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 underline shrink-0 cursor-pointer"
          >
            <span>Live Sheet</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Main Content Area */}
      <div className="glass-panel rounded-2xl overflow-hidden shadow-xl border border-slate-800">
        <div className="overflow-x-auto custom-scrollbar">
          {isLoading ? (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
              <p className="text-xs">Loading AP data and Google Sheets review workbook...</p>
            </div>
          ) : activeSubTab === 'summary' ? (
            /* TAB 1: MONTHLY SUMMARY */
            filteredSummary.length === 0 ? (
              <div className="text-center py-12 bg-slate-950/40">
                <FileSpreadsheet className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-300">No AP monthly summaries found.</p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Click <strong className="text-indigo-400">"Run AP Bill Pipeline"</strong> above to extract vendor bills and generate the Monthly Summary review tab.
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-slate-400 uppercase font-mono text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Vendor Name</th>
                    <th className="py-3 px-4">Expense Category</th>
                    <th className="py-3 px-4 text-center">Bills Count</th>
                    <th className="py-3 px-4 text-center">Total Quantity</th>
                    <th className="py-3 px-4 text-right">Total Billed</th>
                    <th className="py-3 px-4">Notes / Discrepancies</th>
                    <th className="py-3 px-4 text-center">Reviewed</th>
                    <th className="py-3 px-4 text-center">Approved</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium text-slate-300">
                  {filteredSummary.map((row) => (
                    <tr
                      key={row.row_index}
                      className={`hover:bg-slate-800/40 transition ${
                        row.approved ? 'bg-emerald-950/15' : ''
                      }`}
                    >
                      <td className="py-3 px-4 text-white font-bold">{row.vendor_name}</td>
                      <td className="py-3 px-4">
                        <span className="bg-slate-800/80 text-slate-300 px-2 py-0.5 rounded text-[11px] font-mono">
                          {row.category || 'Expenses'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono">{row.bills_count}</td>
                      <td className="py-3 px-4 text-center font-mono">{row.total_qty}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-indigo-300">
                        {row.currency || 'GHS'} {Number(row.total_billed || 0).toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-slate-400 text-[11px] max-w-xs truncate">
                        {row.notes || '-'}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={Boolean(row.reviewed)}
                          onChange={(e) => handleToggleApApproval(row.row_index, 'reviewed', e.target.checked)}
                          className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={Boolean(row.approved)}
                          onChange={(e) => handleToggleApApproval(row.row_index, 'approved', e.target.checked)}
                          className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            row.approved
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                              : row.status === 'INVOICED'
                              ? 'bg-sky-950 text-sky-300 border border-sky-500/30'
                              : 'bg-amber-950 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {row.approved ? 'Approved' : row.status === 'INVOICED' ? 'Draft Bill Posted' : 'Pending Review'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : activeSubTab === 'daily' ? (
            /* TAB 2: DAILY DETAILS */
            filteredDaily.length === 0 ? (
              <div className="text-center py-12 bg-slate-950/40">
                <Layers className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-300">No AP daily details found.</p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Click <strong className="text-indigo-400">"Run AP Bill Pipeline"</strong> above to extract daily line items from vendor receipts.
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-slate-400 uppercase font-mono text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Vendor</th>
                    <th className="py-3 px-4">Bill #</th>
                    <th className="py-3 px-4">Description</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4 text-center">Qty</th>
                    <th className="py-3 px-4 text-right">Unit Price</th>
                    <th className="py-3 px-4 text-right">Total Amount</th>
                    <th className="py-3 px-4">Source File</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium text-slate-300">
                  {filteredDaily.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4 text-slate-400 font-mono">{item.date}</td>
                      <td className="py-3 px-4 text-white font-semibold">{item.vendor_name}</td>
                      <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">{item.bill_number || '-'}</td>
                      <td className="py-3 px-4 text-slate-200 max-w-xs truncate">{item.description}</td>
                      <td className="py-3 px-4">
                        <span className="bg-slate-800/80 text-slate-300 px-2 py-0.5 rounded text-[10px] font-mono">
                          {item.category || 'General'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono">{item.quantity}</td>
                      <td className="py-3 px-4 text-right font-mono text-slate-400">
                        {item.currency || 'GHS'} {Number(item.unit_price || 0).toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-indigo-400">
                        {item.currency || 'GHS'} {Number(item.total_amount || 0).toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">
                        {item.scan_url ? (
                          <a
                            href={item.scan_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 underline"
                          >
                            <span>{item.file_name}</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        ) : (
                          item.file_name
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            item.status === 'INVOICED'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {item.status || 'Pending'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            /* TAB 3: STAGED DB LEDGER */
            filteredApTransactions.length === 0 ? (
              <div className="text-center py-12 bg-slate-950/40">
                <FileText className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-300">No staged AP transactions in database.</p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Click <strong className="text-indigo-400">"Run AP Bill Pipeline"</strong> to process vendor bills into PostgreSQL ledger.
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-slate-400 uppercase font-mono text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Bill Date</th>
                    <th className="py-3 px-4">Vendor / Invoice Description</th>
                    <th className="py-3 px-4">Source Document</th>
                    <th className="py-3 px-4 text-right">Bill Total</th>
                    <th className="py-3 px-4 text-center">Accounting Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium text-slate-300">
                  {filteredApTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4 text-slate-400 font-mono">{tx.transaction_date}</td>
                      <td className="py-3 px-4 text-white font-semibold">{tx.item_or_description}</td>
                      <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">{tx.source_file_name}</td>
                      <td className="py-3 px-4 text-right text-indigo-400 font-mono font-bold">
                        GHS {Number(tx.total_amount || 0).toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            tx.status === 'INVOICED'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                              : 'bg-amber-950 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {tx.status === 'INVOICED' ? 'Draft Bill Posted' : 'Pending Review'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      </div>

    </div>
  );
};

