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
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-[#0284C7]" />
            <h2 className="text-base font-bold text-[#0F172A] tracking-tight">
              Accounts Payable (Vendor Bills &amp; Expenses)
            </h2>
            <span className="text-[10px] font-mono font-bold text-[#0284C7] bg-[#F0F9FF] border border-[#BAE6FD] px-2 py-0.5 rounded-full">
              {currentClient?.name || 'Client'}
            </span>
            <span className="text-[10px] font-mono font-semibold text-slate-700 bg-white border border-[#E2E8F0] px-2 py-0.5 rounded-full shadow-xs">
              {selectedMonth} {selectedYear}
            </span>
          </div>
          <p className="text-xs text-[#64748B] mt-0.5">
            Audit OCR extracted supplier bills, review vendor expense rollups, and post approved bills directly into the accounting ledger.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">

          {/* Auto Post Toggle */}
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 bg-white border border-[#E2E8F0] px-3 py-2 rounded-xl cursor-pointer shadow-xs hover:bg-slate-50 transition">
            <input
              type="checkbox"
              checked={isAutoPostDraft}
              onChange={(e) => setIsAutoPostDraft(e.target.checked)}
              className="rounded border-slate-300 text-[#0284C7] focus:ring-0 cursor-pointer"
            />
            <span>Auto-Post to Accounting API</span>
          </label>

          <button
            onClick={loadTransactions}
            disabled={isLoadingTx}
            className="p-2 bg-white border border-[#E2E8F0] hover:bg-slate-50 text-slate-600 rounded-xl transition cursor-pointer shadow-xs"
            title="Refresh AP Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingTx ? 'animate-spin text-[#0284C7]' : ''}`} />
          </button>

          <button
            onClick={handleRunApPipeline}
            disabled={isRunning}
            className="flex items-center gap-2 bg-[#0284C7] hover:bg-[#0EA5E9] text-white border border-[#0284C7] text-xs font-semibold px-4 py-2 rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
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
            className="flex items-center gap-1.5 bg-white hover:bg-[#FFF1F2] border border-[#FECDD3] text-[#E11D48] text-xs font-semibold px-3.5 py-2 rounded-xl transition cursor-pointer"
            title="Delete mistakenly ingested files or clear erroneous document data"
          >
            <Trash2 className="w-3.5 h-3.5 text-[#E11D48]" />
            <span>Delete Ingested File</span>
          </button>
        </div>
      </div>

      {/* Result Banner */}
      {runResult && (
        <div
          className={`p-4 rounded-xl border flex items-center gap-3 text-xs ${
            runResult.status === 'COMPLETED'
              ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]'
              : 'bg-[#FFF1F2] border-[#FECDD3] text-[#9F1239]'
          }`}
        >
          {runResult.status === 'COMPLETED' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-[#059669]" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 text-[#E11D48]" />
          )}
          <span className="font-medium">{runResult.message}</span>
        </div>
      )}

      {/* View Switcher Tabs & Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-[#E2E8F0] rounded-2xl p-2.5 shadow-xs">
        <div className="flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200/80 overflow-x-auto">
          <button
            onClick={() => setActiveSubTab('summary')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeSubTab === 'summary'
                ? 'bg-white text-[#0284C7] shadow-xs border border-slate-200/80 font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-[#0284C7]" />
            <span>Monthly Summary ({vendorSummary.length})</span>
          </button>
          <button
            onClick={() => setActiveSubTab('bills')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeSubTab === 'bills'
                ? 'bg-white text-[#0284C7] shadow-xs border border-slate-200/80 font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-[#0284C7]" />
            <span>Vendor Bills ({apTransactions.length})</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-2 text-xs text-slate-500 font-mono">
            <span>Total: <strong className="text-[#0F172A] font-bold">{formatCurrency(totalApAmount)}</strong></span>
            <span>•</span>
            <span>Approved: <strong className="text-emerald-600 font-bold">{formatCurrency(totalApprovedAmount)}</strong></span>
          </div>

          <button
            onClick={handleBatchApproveAp}
            disabled={isApproving || apTransactions.filter((t) => !t.approved).length === 0}
            className="flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-40"
            title="1-Click Approve all pending transactions in DB"
          >
            <CheckCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>{isApproving ? 'Approving...' : '1-Click Approve All'}</span>
          </button>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search vendor, invoice..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-slate-50 border border-[#E2E8F0] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#0F172A] placeholder-slate-400 focus:outline-none focus:border-[#0284C7] sm:w-64"
            />
          </div>
        </div>
      </div>

      {/* In-App PostgreSQL Ledger Notice */}
      <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl px-3.5 py-2 flex items-center justify-between gap-2 text-xs text-[#065F46]">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 relative shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span>
            <strong>Native In-App PostgreSQL AP Ledger Active:</strong> Supplier bills are parsed and saved directly into PostgreSQL. Approve line items to post bills into your accounting software.
          </span>
        </div>
      </div>

      {/* Summary View Notice & Quick-Switch */}
      {activeSubTab === 'summary' && (
        <div className="bg-[#F0F9FF] border border-[#BAE6FD] rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 text-xs text-[#0369A1]">
            <Info className="w-4 h-4 text-[#0284C7] shrink-0" />
            <span>
              Viewing aggregated vendor totals. To review, approve, or delete individual supplier bills and files, switch to <strong className="text-[#0F172A]">Vendor Bills</strong> or use <strong className="text-rose-600">Delete Ingested File</strong>.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setActiveSubTab('bills')}
              className="px-2.5 py-1 text-xs font-bold bg-white text-[#0284C7] border border-[#BAE6FD] hover:bg-sky-50 rounded-lg transition cursor-pointer shadow-xs"
            >
              Open Vendor Bills ({transactions.length})
            </button>
            <button
              onClick={() => {
                setPurgeTargetFileName('');
                setIsPurgeModalOpen(true);
              }}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-white text-rose-600 border border-rose-200 hover:bg-rose-50 rounded-lg transition cursor-pointer shadow-xs"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-500" />
              <span>Delete Ingested File</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="bg-white rounded-2xl overflow-hidden shadow-xs border border-[#E2E8F0]">
        <div className="overflow-x-auto custom-scrollbar">
          {isLoadingTx ? (
            <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-[#0284C7]" />
              <p className="text-xs">Loading AP vendor bills from PostgreSQL...</p>
            </div>
          ) : activeSubTab === 'summary' ? (
            /* TAB 1: MONTHLY SUMMARY (ROLLUP) */
            filteredVendorSummary.length === 0 ? (
              <div className="text-center py-12 bg-slate-50/50">
                <Layers className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-[#0F172A]">No AP monthly summaries found.</p>
                <p className="text-xs text-[#64748B] mt-1 max-w-sm mx-auto">
                  Click <strong className="text-[#0284C7]">"Run AP Bill Pipeline"</strong> above to extract vendor bills into the ledger.
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/90 text-[#64748B] uppercase tracking-wider font-semibold text-[11px] border-b border-[#E2E8F0]">
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
                <tbody className="divide-y divide-[#E2E8F0] font-medium text-[#334155]">
                  {filteredVendorSummary.map((row, idx) => (
                    <tr
                      key={idx}
                      className={`hover:bg-slate-50/80 transition ${
                        row.is_fully_approved ? 'bg-emerald-50/40' : ''
                      }`}
                    >
                      <td className="py-3 px-4 font-bold text-[#0F172A]">{row.vendor_name}</td>
                      <td className="py-3 px-4 text-slate-500">{row.category}</td>
                      <td className="py-3 px-4 text-center font-mono text-[#0F172A]">{row.bills_count} bills</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-[#0284C7]">
                        {formatCurrency(row.total_amount)}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-slate-600">
                        {row.reviewed_count}/{row.bills_count}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-slate-600">
                        {row.approved_count}/{row.bills_count}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            row.is_fully_approved
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
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
              <div className="text-center py-12 bg-slate-50/50">
                <FileText className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-[#0F172A]">No staged AP transactions in database.</p>
                <p className="text-xs text-[#64748B] mt-1 max-w-sm mx-auto">
                  Click <strong className="text-[#0284C7]">"Run AP Bill Pipeline"</strong> to process vendor bills into PostgreSQL ledger.
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/90 text-[#64748B] uppercase tracking-wider font-semibold text-[11px] border-b border-[#E2E8F0]">
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
                <tbody className="divide-y divide-[#E2E8F0] font-medium text-[#334155]">
                  {filteredApTransactions.map((tx) => (
                    <tr
                      key={tx.id}
                      className={`hover:bg-slate-50/80 transition ${tx.approved ? 'bg-emerald-50/40' : ''}`}
                    >
                      <td className="py-3 px-4 text-slate-600 font-mono">{tx.transaction_date}</td>
                      <td className="py-3 px-4 text-[#0F172A] font-semibold">{tx.item_or_description}</td>
                      <td className="py-3 px-4 text-slate-500">{tx.category_or_account || 'Vendor Bill'}</td>
                      <td className="py-3 px-4 font-mono text-[11px]">
                        {tx.metadata_json?.drive_file_url || tx.source_identifier ? (
                          <a
                            href={tx.metadata_json?.drive_file_url || `https://drive.google.com/file/d/${tx.source_identifier}/view`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sky-600 hover:text-sky-700 hover:underline max-w-[180px] truncate"
                            title={`Open in Google Drive: ${tx.source_file_name}`}
                          >
                            <span className="truncate">{tx.source_file_name || 'Bill Document'}</span>
                            <ExternalLink className="w-3 h-3 shrink-0 text-sky-600" />
                          </a>
                        ) : (
                          <span className="text-slate-500 truncate max-w-[180px] block" title={tx.source_file_name}>
                            {tx.source_file_name || 'Bill'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right text-emerald-600 font-mono font-bold">
                        {formatCurrency(tx.total_amount)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={Boolean(tx.reviewed)}
                          onChange={() => handleToggleApTx(tx.id, 'reviewed', tx.reviewed)}
                          className="w-4 h-4 rounded border-[#CBD5E1] bg-white text-sky-600 focus:ring-sky-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={Boolean(tx.approved)}
                          onChange={() => handleToggleApTx(tx.id, 'approved', tx.approved)}
                          className="w-4 h-4 rounded border-[#CBD5E1] bg-white text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            tx.status === 'INVOICED'
                              ? 'bg-sky-50 text-sky-700 border border-sky-200'
                              : tx.approved
                              ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
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
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 hover:border-rose-300 transition cursor-pointer"
                            title="Delete this staged vendor bill"
                          >
                            {deletingTxId === tx.id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-600" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5 text-rose-600" />
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

