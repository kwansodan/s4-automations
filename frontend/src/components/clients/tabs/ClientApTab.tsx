import React, { useState, useEffect, useMemo } from 'react';
import { useClient } from '../../../context/ClientContext';
import { useAutomation } from '../../../context/AutomationContext';
import {
  fetchClientTransactions,
  toggleClientTransaction,
  batchApproveTransactions,
  deleteStagedTransaction,
  triggerApPipeline,
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
  CheckCheck,
  Layers,
  ExternalLink,
  Trash2,
  Info,
} from 'lucide-react';
import { PurgeIngestedFileModal } from '../../modals/PurgeIngestedFileModal';

export const ClientApTab: React.FC = () => {
  const { currentClient } = useClient();
  const { selectedMonth, selectedYear, addLog } = useAutomation();

  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoadingTx, setIsLoadingTx] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isAutoPostDraft, setIsAutoPostDraft] = useState(false);
  const [search, setSearch] = useState('');
  const [runResult, setRunResult] = useState<any | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'summary' | 'bills'>('summary');
  const [deletingTxId, setDeletingTxId] = useState<number | null>(null);
  const [isPurgeModalOpen, setIsPurgeModalOpen] = useState<boolean>(false);
  const [purgeTargetFileName, setPurgeTargetFileName] = useState<string>('');

  const loadTransactions = async () => {
    if (!currentClient?.id) return;
    setIsLoadingTx(true);
    try {
      const data = await fetchClientTransactions(currentClient.id, undefined, selectedMonth, selectedYear, 'AP');
      setTransactions(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.warn('Failed loading AP transactions:', err);
    } finally {
      setIsLoadingTx(false);
    }
  };

  useEffect(() => {
    loadTransactions();
  }, [currentClient?.id, selectedMonth, selectedYear]);

  const handleRunApPipeline = async () => {
    if (!currentClient?.id) return;
    setIsRunning(true);
    setRunResult(null);
    addLog('info', `[AP PIPELINE] Ingesting vendor bills into PostgreSQL ledger for ${currentClient.name}...`);
    try {
      const res = await triggerApPipeline({
        client_id: currentClient.id,
        month: selectedMonth,
        year: selectedYear,
        auto_post_draft: isAutoPostDraft,
      });
      setRunResult({
        status: 'COMPLETED',
        message: 'AP bill ingestion completed and saved to PostgreSQL ledger.',
        month: selectedMonth,
        year: selectedYear,
      });
      addLog('success', `[AP PIPELINE] AP bills extracted and staged in database for ${currentClient.name}`);
      await loadTransactions();
    } catch (err: any) {
      addLog('error', `AP Pipeline error: ${err.message}`);
      setRunResult({ status: 'FAILED', message: err.message });
    } finally {
      setIsRunning(false);
    }
  };

  const handleToggleApTx = async (txId: number, field: 'reviewed' | 'approved', currentVal: boolean) => {
    if (!currentClient?.id) return;
    const newVal = !currentVal;

    setTransactions((prev) =>
      prev.map((t) => (t.id === txId ? { ...t, [field]: newVal, ...(field === 'approved' && newVal ? { reviewed: true } : {}) } : t))
    );

    try {
      await toggleClientTransaction(currentClient.id, txId, field, newVal);
      if (field === 'approved' && newVal) {
        await toggleClientTransaction(currentClient.id, txId, 'reviewed', true);
      }
    } catch (err: any) {
      addLog('error', `Failed updating AP transaction: ${err.message}`);
      await loadTransactions();
    }
  };

  const handleBatchApproveAp = async () => {
    const idsToApprove = apTransactions.filter((t) => !t.approved).map((t) => t.id);
    if (idsToApprove.length === 0) return;

    setIsApproving(true);
    try {
      await batchApproveTransactions(currentClient.id, idsToApprove, 'Approved via In-App AP Ledger');
      addLog('success', `Approved ${idsToApprove.length} AP vendor bills for ${currentClient.name}.`);
      await loadTransactions();
    } catch (err: any) {
      addLog('error', `Failed approving transactions: ${err.message}`);
    } finally {
      setIsApproving(false);
    }
  };

  const handleDeleteApTx = async (txId: number) => {
    if (!currentClient?.id) return;
    if (!window.confirm('Are you sure you want to delete this staged vendor bill from the ledger? This will purge the mistakenly ingested transaction.')) {
      return;
    }
    setDeletingTxId(txId);
    try {
      await deleteStagedTransaction(currentClient.id, txId);
      setTransactions((prev) => prev.filter((t) => t.id !== txId));
      addLog('success', `Deleted staged vendor bill #${txId}`);
    } catch (err: any) {
      addLog('error', `Failed to delete bill: ${err.message}`);
    } finally {
      setDeletingTxId(null);
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

  // Rollup Vendor Summary directly from staged transactions
  const vendorSummary = useMemo(() => {
    const map = new Map<string, {
      vendor_name: string;
      category: string;
      bills_count: number;
      total_amount: number;
      approved_count: number;
      reviewed_count: number;
      is_fully_approved: boolean;
      transaction_ids: number[];
    }>();

    for (const tx of apTransactions) {
      const vendor = tx.item_or_description || 'Unknown Vendor';
      const cat = tx.category_or_account || 'Vendor Bill';
      const key = `${vendor}:::${cat}`;

      const cur = map.get(key) || {
        vendor_name: vendor,
        category: cat,
        bills_count: 0,
        total_amount: 0,
        approved_count: 0,
        reviewed_count: 0,
        is_fully_approved: false,
        transaction_ids: [] as number[],
      };

      cur.bills_count += 1;
      cur.total_amount += Number(tx.total_amount || 0);
      cur.transaction_ids.push(tx.id);
      if (tx.approved) cur.approved_count += 1;
      if (tx.reviewed) cur.reviewed_count += 1;
      cur.is_fully_approved = cur.approved_count === cur.bills_count;

      map.set(key, cur);
    }

    return Array.from(map.values());
  }, [apTransactions]);

  const filteredVendorSummary = useMemo(() => {
    if (!query) return vendorSummary;
    return vendorSummary.filter(
      (v) =>
        v.vendor_name.toLowerCase().includes(query) ||
        v.category.toLowerCase().includes(query)
    );
  }, [vendorSummary, query]);

  const totalApAmount = apTransactions.reduce((sum, t) => sum + (t.total_amount || 0), 0);
  const totalApprovedAmount = apTransactions
    .filter((t) => t.approved)
    .reduce((sum, t) => sum + (t.total_amount || 0), 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header & Controls */}
      <div className="bg-[#FFFEE6] border-2 border-[#C4BA3B] rounded-2xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-[#E2495B]" />
            <h2 className="text-base font-extrabold text-[#E2495B] tracking-tight">
              Accounts Payable (Vendor Bills &amp; Expenses)
            </h2>
            <span className="text-[10px] font-mono font-bold text-[#E2495B] bg-[#F4ED6E] border border-[#C4BA3B] px-2 py-0.5 rounded-full">
              {currentClient?.name || 'Client'}
            </span>
            <span className="text-[10px] font-mono font-bold text-[#E2495B] bg-[#FFFEE6] border border-[#C4BA3B] px-2 py-0.5 rounded-full">
              {selectedMonth} {selectedYear}
            </span>
          </div>
          <p className="text-xs text-[#C4BA3B] mt-0.5">
            Audit OCR extracted supplier bills, review vendor expense rollups, and post approved bills directly into the accounting ledger.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">

          {/* Auto Post Toggle */}
          <label className="flex items-center gap-2 text-xs font-bold text-[#E2495B] bg-[#FFFEE6] border border-[#C4BA3B] px-3 py-2 rounded-xl cursor-pointer">
            <input
              type="checkbox"
              checked={isAutoPostDraft}
              onChange={(e) => setIsAutoPostDraft(e.target.checked)}
              className="rounded border-[#C4BA3B] text-[#E2495B] focus:ring-0 cursor-pointer"
            />
            <span>Auto-Post to Accounting API</span>
          </label>

          <button
            onClick={loadTransactions}
            disabled={isLoadingTx}
            className="p-2 bg-[#FFFEE6] border border-[#C4BA3B] hover:bg-[#F4ED6E] text-[#E2495B] rounded-xl transition cursor-pointer"
            title="Refresh AP Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingTx ? 'animate-spin text-[#E2495B]' : ''}`} />
          </button>

          <button
            onClick={handleRunApPipeline}
            disabled={isRunning}
            className="flex items-center gap-2 bg-[#E2495B] hover:bg-[#E2495B]/90 text-[#FFFEE6] border border-[#C4BA3B] text-xs font-bold px-4 py-2 rounded-xl shadow transition cursor-pointer disabled:opacity-50"
          >
            {isRunning ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <PlayCircle className="w-3.5 h-3.5" />
            )}
            <span>Run AP Bill Pipeline</span>
          </button>

          <button
            onClick={() => {
              setPurgeTargetFileName('');
              setIsPurgeModalOpen(true);
            }}
            className="flex items-center gap-1.5 bg-[#FFFEE6] hover:bg-[#F4ED6E] border border-[#E2495B] text-[#E2495B] text-xs font-bold px-3.5 py-2 rounded-xl transition cursor-pointer"
            title="Delete mistakenly ingested files or clear erroneous document data"
          >
            <Trash2 className="w-3.5 h-3.5 text-[#E2495B]" />
            <span>Delete Ingested File</span>
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
            <Layers className="w-3.5 h-3.5 text-indigo-300" />
            <span>Monthly Summary ({vendorSummary.length})</span>
          </button>
          <button
            onClick={() => setActiveSubTab('bills')}
            className={`px-3 py-1 text-xs font-bold rounded-md transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeSubTab === 'bills'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-indigo-300" />
            <span>Vendor Bills ({apTransactions.length})</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-2 text-xs text-slate-400 font-mono">
            <span>Total: <strong className="text-white font-bold">{formatCurrency(totalApAmount)}</strong></span>
            <span>•</span>
            <span>Approved: <strong className="text-emerald-400 font-bold">{formatCurrency(totalApprovedAmount)}</strong></span>
          </div>

          <button
            onClick={handleBatchApproveAp}
            disabled={isApproving || apTransactions.filter((t) => !t.approved).length === 0}
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
              placeholder="Search vendor, invoice..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 sm:w-64"
            />
          </div>
        </div>
      </div>

      {/* In-App PostgreSQL Ledger Notice */}
      <div className="bg-indigo-950/30 border border-indigo-500/20 rounded-xl px-3.5 py-2 flex items-center justify-between gap-2 text-xs text-indigo-300">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 relative shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
          </span>
          <span>
            <strong>Native In-App PostgreSQL AP Ledger Active:</strong> Supplier bills are parsed and saved directly into PostgreSQL. Approve line items to post bills into your accounting software.
          </span>
        </div>
      </div>

      {/* Summary View Notice & Quick-Switch */}
      {activeSubTab === 'summary' && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <Info className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>
              Viewing aggregated vendor totals. To review, approve, or delete individual supplier bills and files, switch to <strong className="text-white">Vendor Bills</strong> or use <strong className="text-rose-400">Delete Ingested File</strong>.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setActiveSubTab('bills')}
              className="px-2.5 py-1 text-xs font-bold bg-indigo-950 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-900/60 rounded-lg transition cursor-pointer"
            >
              Open Vendor Bills ({transactions.length})
            </button>
            <button
              onClick={() => {
                setPurgeTargetFileName('');
                setIsPurgeModalOpen(true);
              }}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-rose-950/60 text-rose-300 border border-rose-500/40 hover:bg-rose-900 rounded-lg transition cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span>Delete Ingested File</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="glass-panel rounded-2xl overflow-hidden shadow-xl border border-slate-800">
        <div className="overflow-x-auto custom-scrollbar">
          {isLoadingTx ? (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
              <p className="text-xs">Loading AP vendor bills from PostgreSQL...</p>
            </div>
          ) : activeSubTab === 'summary' ? (
            /* TAB 1: MONTHLY SUMMARY (ROLLUP) */
            filteredVendorSummary.length === 0 ? (
              <div className="text-center py-12 bg-slate-950/40">
                <Layers className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-300">No AP monthly summaries found.</p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Click <strong className="text-indigo-400">"Run AP Bill Pipeline"</strong> above to extract vendor bills into the ledger.
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-slate-400 uppercase font-mono text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Vendor Name</th>
                    <th className="py-3 px-4">Expense Category</th>
                    <th className="py-3 px-4 text-center">Bills Count</th>
                    <th className="py-3 px-4 text-right">Total Billed</th>
                    <th className="py-3 px-4 text-center">Reviewed</th>
                    <th className="py-3 px-4 text-center">Approved</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium text-slate-300">
                  {filteredVendorSummary.map((row, idx) => (
                    <tr
                      key={idx}
                      className={`hover:bg-slate-800/40 transition ${
                        row.is_fully_approved ? 'bg-emerald-950/15' : ''
                      }`}
                    >
                      <td className="py-3 px-4 font-bold text-white">{row.vendor_name}</td>
                      <td className="py-3 px-4 text-slate-400">{row.category}</td>
                      <td className="py-3 px-4 text-center font-mono">{row.bills_count} bills</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-indigo-300">
                        {formatCurrency(row.total_amount)}
                      </td>
                      <td className="py-3 px-4 text-center font-mono">
                        {row.reviewed_count}/{row.bills_count}
                      </td>
                      <td className="py-3 px-4 text-center font-mono">
                        {row.approved_count}/{row.bills_count}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            row.is_fully_approved
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                              : 'bg-amber-950 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {row.is_fully_approved ? 'APPROVED' : 'Pending'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            /* TAB 2: INDIVIDUAL VENDOR BILLS */
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
                    <th className="py-3 px-4">Vendor / Description</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Source Document</th>
                    <th className="py-3 px-4 text-right">Bill Total</th>
                    <th className="py-3 px-4 text-center">Reviewed</th>
                    <th className="py-3 px-4 text-center">Approved</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium text-slate-300">
                  {filteredApTransactions.map((tx) => (
                    <tr
                      key={tx.id}
                      className={`hover:bg-slate-800/40 transition ${tx.approved ? 'bg-emerald-950/15' : ''}`}
                    >
                      <td className="py-3 px-4 text-slate-400 font-mono">{tx.transaction_date}</td>
                      <td className="py-3 px-4 text-white font-semibold">{tx.item_or_description}</td>
                      <td className="py-3 px-4 text-slate-400">{tx.category_or_account || 'Vendor Bill'}</td>
                      <td className="py-3 px-4 font-mono text-[11px]">
                        {tx.metadata_json?.drive_file_url || tx.source_identifier ? (
                          <a
                            href={tx.metadata_json?.drive_file_url || `https://drive.google.com/file/d/${tx.source_identifier}/view`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 hover:underline max-w-[180px] truncate"
                            title={`Open in Google Drive: ${tx.source_file_name}`}
                          >
                            <span className="truncate">{tx.source_file_name || 'Bill Document'}</span>
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-slate-400 truncate max-w-[180px] block" title={tx.source_file_name}>
                            {tx.source_file_name || 'Bill'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right text-indigo-400 font-mono font-bold">
                        {formatCurrency(tx.total_amount)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={Boolean(tx.reviewed)}
                          onChange={() => handleToggleApTx(tx.id, 'reviewed', tx.reviewed)}
                          className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-sky-600 focus:ring-sky-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={Boolean(tx.approved)}
                          onChange={() => handleToggleApTx(tx.id, 'approved', tx.approved)}
                          className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            tx.status === 'INVOICED'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                              : tx.approved
                              ? 'bg-emerald-950 border border-emerald-500/40 text-emerald-300'
                              : 'bg-amber-950 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {tx.status === 'INVOICED' ? 'Draft Bill Posted' : tx.approved ? 'APPROVED' : 'Pending Review'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {tx.status !== 'INVOICED' && tx.status !== 'BILLED' && (
                          <button
                            onClick={() => handleDeleteApTx(tx.id)}
                            disabled={deletingTxId === tx.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold text-rose-400 hover:text-white bg-rose-950/40 hover:bg-rose-900 border border-rose-800/40 hover:border-rose-500 transition cursor-pointer"
                            title="Delete this staged vendor bill"
                          >
                            {deletingTxId === tx.id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-400" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                            )}
                            <span>Delete</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      </div>

      {/* Purge Ingested File Modal */}
      <PurgeIngestedFileModal
        isOpen={isPurgeModalOpen}
        onClose={() => setIsPurgeModalOpen(false)}
        clientId={currentClient?.id || ''}
        clientName={currentClient?.name || 'Client'}
        selectedMonth={selectedMonth}
        selectedYear={selectedYear}
        transactions={transactions}
        initialFileName={purgeTargetFileName}
        onSuccess={() => {
          loadTransactions();
        }}
      />
    </div>
  );
};

