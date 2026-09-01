import React, { useState, useEffect } from 'react';
import { useClient } from '../../../context/ClientContext';
import { useAutomation } from '../../../context/AutomationContext';
import {
  fetchClientTransactions,
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
  Check,
  Clock,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';

export const ClientApTab: React.FC = () => {
  const { currentClient } = useClient();
  const { selectedMonth, selectedYear, addLog } = useAutomation();

  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoadingTx, setIsLoadingTx] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isAutoPostDraft, setIsAutoPostDraft] = useState(false);
  const [search, setSearch] = useState('');
  const [runResult, setRunResult] = useState<any | null>(null);

  const loadTransactions = async () => {
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

  useEffect(() => {
    loadTransactions();
  }, [currentClient.id]);

  const handleRunApPipeline = async () => {
    setIsRunning(true);
    setRunResult(null);
    addLog('info', `[AP PIPELINE] Ingesting vendor bills for ${currentClient.name}...`);
    try {
      const res = await triggerApPipeline({
        client_id: currentClient.id,
        month: selectedMonth,
        year: selectedYear,
        auto_post_draft: isAutoPostDraft,
      });
      setRunResult({
        status: 'COMPLETED',
        message: 'Accounts Payable (AP) pipeline triggered successfully via Inngest.',
        month: selectedMonth,
        year: selectedYear,
        sources_discovered: 1,
        items_extracted: 1,
        total_amount: 0,
      });
      addLog('success', `[AP PIPELINE] AP bills extracted for ${currentClient.name}`);
      await loadTransactions();
    } catch (err: any) {
      addLog('error', `AP Pipeline error: ${err.message}`);
      setRunResult({ status: 'FAILED', message: err.message });
    } finally {
      setIsRunning(false);
    }
  };

  const apTransactions = transactions.filter((t) => t.pipeline_type === 'AP');
  const filteredAp = apTransactions.filter(
    (t) =>
      t.item_or_description?.toLowerCase().includes(search.toLowerCase()) ||
      t.source_file_name?.toLowerCase().includes(search.toLowerCase()) ||
      t.transaction_date?.toLowerCase().includes(search.toLowerCase())
  );

  const totalApAmount = apTransactions.reduce((sum, t) => sum + (t.total_amount || 0), 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header & Controls */}
      <div className="glass-panel rounded-2xl p-5 shadow-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-bold text-white tracking-tight">
              Accounts Payable (Vendor Bills &amp; Invoices)
            </h2>
            <span className="text-[10px] font-mono font-bold text-indigo-300 bg-indigo-950/80 border border-indigo-500/30 px-2 py-0.5 rounded-full">
              {currentClient.name}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Extract incoming supplier invoices using Gemini Vision OCR, map vendor contacts, and auto-post draft bills into accounting.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
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
            onClick={loadTransactions}
            disabled={isLoadingTx}
            className="p-2 bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-xl transition cursor-pointer"
            title="Refresh AP Bills"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingTx ? 'animate-spin text-indigo-400' : ''}`} />
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

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800/80 rounded-xl p-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 px-2">
          <span>Total Staged: <strong className="text-white">{apTransactions.length} bills</strong></span>
          <span>•</span>
          <span>Total Volume: <strong className="text-indigo-300 font-mono">GHS {totalApAmount.toFixed(2)}</strong></span>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search vendor, invoice, or file..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 sm:w-72"
          />
        </div>
      </div>

      {/* AP Bills Table */}
      <div className="glass-panel rounded-2xl overflow-hidden shadow-xl border border-slate-800">
        <div className="overflow-x-auto custom-scrollbar">
          {isLoadingTx ? (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
              <p className="text-xs">Loading AP vendor bills...</p>
            </div>
          ) : filteredAp.length === 0 ? (
            <div className="text-center py-12 bg-slate-950/40">
              <FileText className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-300">No AP vendor bills found.</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                Click <strong className="text-indigo-400">"Run AP Bill Pipeline"</strong> above to scan for incoming vendor invoices and supplier receipts.
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
                {filteredAp.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 text-slate-400 font-mono">{tx.transaction_date}</td>
                    <td className="py-3 px-4 text-white font-semibold">{tx.item_or_description}</td>
                    <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">{tx.source_file_name}</td>
                    <td className="py-3 px-4 text-right text-indigo-400 font-mono font-bold">
                      GHS {tx.total_amount?.toFixed(2)}
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
          )}
        </div>
      </div>

    </div>
  );
};
