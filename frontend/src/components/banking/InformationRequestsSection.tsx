import React, { useState, useEffect, useCallback } from 'react';
import { useClient } from '../../context/ClientContext';
import { useAutomation } from '../../context/AutomationContext';
import {
  fetchBankTransactions,
  fetchChartOfAccounts,
  updateWatchedAccounts,
  categorizeBankTransaction,
  bulkCategorizeBankTransactions,
  bulkQueryBankTransactions,
  syncBankFeedsFromAccounting,
} from '../../lib/api';
import type {
  BankTransactionRecord,
  ChartOfAccountItem,
} from '../../types/client';
import { QueryComposerModal } from '../modals/QueryComposerModal';
import {
  Landmark,
  HelpCircle,
  Sparkles,
  CheckCircle2,
  Clock,
  Send,
  RefreshCw,
  Search,
  Sliders,
  Check,
  X,
  AlertCircle,
  FileText,
  DollarSign,
  ArrowRight,
  ShieldCheck,
  Layers,
  ChevronDown,
  ChevronUp,
  Tag,
  Paperclip,
  CheckCheck,
} from 'lucide-react';

export const InformationRequestsSection: React.FC = () => {
  const { currentClient } = useClient();
  const { addLog, setActiveTab } = useAutomation();

  const [transactions, setTransactions] = useState<BankTransactionRecord[]>([]);
  const [metrics, setMetrics] = useState({
    total_count: 0,
    total_uncategorized: 0,
    total_pending_client: 0,
    total_client_answered: 0,
    total_mapped: 0,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Chart of Accounts & Watched Accounts State
  const [accounts, setAccounts] = useState<ChartOfAccountItem[]>([]);
  const [watchedAccounts, setWatchedAccounts] = useState<string[]>([]);
  const [isWatchedDrawerOpen, setIsWatchedDrawerOpen] = useState(false);
  const [isSavingWatched, setIsSavingWatched] = useState(false);

  // Row Selection & Bulk Actions
  const [selectedTxIds, setSelectedTxIds] = useState<number[]>([]);
  const [bulkAccountId, setBulkAccountId] = useState<string>('');
  const [isBulkCategorizing, setIsBulkCategorizing] = useState(false);

  // Row Inline Categorization Inputs State
  const [rowAccountMap, setRowAccountMap] = useState<{ [id: number]: string }>({});
  const [rowPayeeMap, setRowPayeeMap] = useState<{ [id: number]: string }>({});
  const [savingRowIds, setSavingRowIds] = useState<{ [id: number]: boolean }>({});

  // Query Composer Modal State
  const [selectedTxForQuery, setSelectedTxForQuery] = useState<BankTransactionRecord | null>(null);
  const [isQueryModalOpen, setIsQueryModalOpen] = useState(false);

  // Load Transactions & Accounts
  const loadData = useCallback(async () => {
    if (!currentClient) return;
    setIsLoading(true);
    try {
      const [txRes, coaRes] = await Promise.all([
        fetchBankTransactions(currentClient.id, statusFilter, searchQuery),
        fetchChartOfAccounts(currentClient.id),
      ]);

      setTransactions(txRes.transactions || []);
      setMetrics(txRes.metrics || {
        total_count: 0,
        total_uncategorized: 0,
        total_pending_client: 0,
        total_client_answered: 0,
        total_mapped: 0,
      });

      setAccounts(coaRes.accounts || []);
      setWatchedAccounts(coaRes.watched_accounts || []);

      // Initialize inline account selectors
      const initialRowAccounts: { [id: number]: string } = {};
      const initialRowPayees: { [id: number]: string } = {};
      (txRes.transactions || []).forEach((t: BankTransactionRecord) => {
        if (t.mapped_account_id) {
          initialRowAccounts[t.id] = t.mapped_account_id;
        } else if (t.ai_suggested_account && coaRes.accounts) {
          const match = coaRes.accounts.find(
            (a: any) => a.account_name.toLowerCase() === t.ai_suggested_account?.toLowerCase()
          );
          if (match) initialRowAccounts[t.id] = match.account_id;
        }
        if (t.payee_name) initialRowPayees[t.id] = t.payee_name;
      });
      setRowAccountMap(initialRowAccounts);
      setRowPayeeMap(initialRowPayees);
    } catch (err: any) {
      addLog('error', `Could not load information requests: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [currentClient, statusFilter, searchQuery, addLog]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Sync Bank Feeds from Accounting Platform
  const handleSyncFeeds = async () => {
    if (!currentClient) return;
    setIsSyncing(true);
    try {
      const res = await syncBankFeedsFromAccounting(currentClient.id);
      addLog('success', `🏦 ${res.message}`);
      await loadData();
    } catch (err: any) {
      addLog('error', `Sync failed: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Update Watched Accounts
  const handleSaveWatchedAccounts = async () => {
    if (!currentClient) return;
    setIsSavingWatched(true);
    try {
      const res = await updateWatchedAccounts(currentClient.id, watchedAccounts);
      addLog('success', `⚙️ ${res.message}`);
      setIsWatchedDrawerOpen(false);
      await loadData();
    } catch (err: any) {
      addLog('error', `Could not update watched accounts: ${err.message}`);
    } finally {
      setIsSavingWatched(false);
    }
  };

  const toggleWatchedCode = (code: string) => {
    if (watchedAccounts.includes(code)) {
      setWatchedAccounts(watchedAccounts.filter((c) => c !== code));
    } else {
      setWatchedAccounts([...watchedAccounts, code]);
    }
  };

  // Inline Categorization
  const handleCategorizeRow = async (tx: BankTransactionRecord) => {
    const accountId = rowAccountMap[tx.id] || tx.mapped_account_id;
    if (!accountId) {
      addLog('warning', 'Please select a Chart of Accounts category before saving.');
      return;
    }

    setSavingRowIds((prev) => ({ ...prev, [tx.id]: true }));
    try {
      const targetAcc = accounts.find((a) => a.account_id === accountId);
      const res = await categorizeBankTransaction(tx.id, {
        mapped_account_id: accountId,
        mapped_account_name: targetAcc?.account_name || accountId,
        payee_name: rowPayeeMap[tx.id] || tx.payee_name,
        tax_rate: tx.tax_rate || 'Standard VAT (15%)',
        post_to_accounting: true,
      });

      addLog('success', `✅ ${res.message}`);
      setTransactions((prev) =>
        prev.map((item) => (item.id === tx.id ? res.transaction : item))
      );
      setMetrics((prev) => ({
        ...prev,
        total_uncategorized: Math.max(0, prev.total_uncategorized - 1),
        total_mapped: prev.total_mapped + 1,
      }));
    } catch (err: any) {
      addLog('error', `Categorization failed: ${err.message}`);
    } finally {
      setSavingRowIds((prev) => ({ ...prev, [tx.id]: false }));
    }
  };

  // Bulk Categorize
  const handleBulkCategorize = async () => {
    if (selectedTxIds.length === 0 || !bulkAccountId) return;
    setIsBulkCategorizing(true);
    try {
      const targetAcc = accounts.find((a) => a.account_id === bulkAccountId);
      const res = await bulkCategorizeBankTransactions({
        transaction_ids: selectedTxIds,
        mapped_account_id: bulkAccountId,
        mapped_account_name: targetAcc?.account_name,
      });

      addLog('success', `🎉 ${res.message}`);
      setSelectedTxIds([]);
      await loadData();
    } catch (err: any) {
      addLog('error', `Bulk categorize failed: ${err.message}`);
    } finally {
      setIsBulkCategorizing(false);
    }
  };

  // Bulk Query Client
  const handleBulkQuery = async () => {
    if (selectedTxIds.length === 0) return;
    const promptText = prompt(
      `Enter clarification query for ${selectedTxIds.length} selected bank transactions:`,
      'Please clarify the business purpose and provide receipts for these transactions.'
    );
    if (!promptText) return;

    try {
      const res = await bulkQueryBankTransactions({
        transaction_ids: selectedTxIds,
        query_text: promptText,
      });
      addLog('success', `📧 ${res.message}`);
      setSelectedTxIds([]);
      await loadData();
    } catch (err: any) {
      addLog('error', `Bulk query failed: ${err.message}`);
    }
  };

  // Open Query Composer Modal
  const handleOpenQueryModal = (tx: BankTransactionRecord) => {
    setSelectedTxForQuery(tx);
    setIsQueryModalOpen(true);
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-sky-950/80 via-slate-900 to-indigo-950/80 border border-sky-500/30 rounded-2xl p-6 shadow-xl backdrop-blur-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400">
                <Landmark className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
                  <span>Information Requests &amp; Bank Classification</span>
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-sky-950 text-sky-300 border border-sky-500/30">
                    {currentClient?.name || 'All Clients'}
                  </span>
                </h1>
                <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
                  Review uncategorized bank feeds, assign Chart of Accounts categories inline, and query clients with instant 1-click notification alerts.
                </p>
              </div>
            </div>
          </div>

          {/* Action Bar */}
          <div className="flex items-center gap-2.5 flex-wrap shrink-0">
            <button
              onClick={() => setIsWatchedDrawerOpen(!isWatchedDrawerOpen)}
              className={`flex items-center gap-1.5 text-xs font-bold py-2.5 px-3.5 rounded-xl border transition cursor-pointer ${
                isWatchedDrawerOpen
                  ? 'bg-sky-600 text-white border-sky-500 shadow-md shadow-sky-600/30'
                  : 'bg-slate-900/90 text-slate-300 hover:text-white hover:bg-slate-800 border-slate-800'
              }`}
            >
              <Sliders className="w-3.5 h-3.5 text-sky-400" />
              <span>Watched Accounts ({watchedAccounts.length})</span>
              {isWatchedDrawerOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={handleSyncFeeds}
              disabled={isSyncing}
              className="flex items-center gap-1.5 bg-slate-900/90 hover:bg-slate-800 text-slate-200 hover:text-white text-xs font-bold py-2.5 px-3.5 rounded-xl border border-slate-800 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-sky-400 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing Feeds...' : 'Sync Live Feeds'}</span>
            </button>

            <button
              onClick={() => setActiveTab('portal')}
              className="flex items-center gap-1.5 bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow-lg shadow-indigo-600/30 transition cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Open Client Portal View</span>
            </button>
          </div>
        </div>

        {/* Collapsible Watched Chart of Accounts Drawer */}
        {isWatchedDrawerOpen && (
          <div className="mt-5 pt-4 border-t border-slate-800/80 space-y-3 animate-in fade-in">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-sky-400" />
                  <span>Monitored Suspense &amp; Uncategorized Accounts</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Select which Chart of Account codes this pipeline should automatically monitor for unmapped transactions:
                </p>
              </div>

              <button
                onClick={handleSaveWatchedAccounts}
                disabled={isSavingWatched}
                className="inline-flex items-center gap-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer shadow"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{isSavingWatched ? 'Saving...' : 'Save Watched Accounts'}</span>
              </button>
            </div>

            {/* Account Badges Grid */}
            <div className="flex flex-wrap gap-2 pt-1">
              {accounts.map((acc) => {
                const code = acc.account_code || acc.account_id;
                const isSelected = watchedAccounts.includes(code) || watchedAccounts.includes(acc.account_id);
                return (
                  <button
                    key={acc.account_id}
                    type="button"
                    onClick={() => toggleWatchedCode(code)}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition cursor-pointer ${
                      isSelected
                        ? 'bg-sky-950/80 text-sky-200 border-sky-500/50 shadow-sm shadow-sky-500/20'
                        : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-sky-400' : 'bg-slate-700'}`} />
                    <span className="font-mono font-bold">{code}</span>
                    <span>{acc.account_name}</span>
                    {acc.is_suspense && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-500/30">
                        Default
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Summary KPI Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        
        {/* Total Uncategorized */}
        <div
          onClick={() => setStatusFilter('UNMAPPED')}
          className={`bg-slate-900/90 border rounded-2xl p-4 shadow-xl backdrop-blur-xl transition cursor-pointer ${
            statusFilter === 'UNMAPPED' ? 'border-sky-500/80 ring-1 ring-sky-500/50' : 'border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-400">Needs Classification</span>
            <AlertCircle className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-black text-white">{metrics.total_uncategorized}</div>
          <span className="text-[10px] text-sky-400/80 font-medium mt-1 block">Awaiting account mapping</span>
        </div>

        {/* Pending Client Clarification */}
        <div
          onClick={() => setStatusFilter('CLARIFICATION_REQUESTED')}
          className={`bg-slate-900/90 border rounded-2xl p-4 shadow-xl backdrop-blur-xl transition cursor-pointer ${
            statusFilter === 'CLARIFICATION_REQUESTED' ? 'border-amber-500/80 ring-1 ring-amber-500/50' : 'border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-amber-300">Awaiting Client</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-200">{metrics.total_pending_client}</div>
          <span className="text-[10px] text-amber-400/80 font-medium mt-1 block">Clarification queries sent</span>
        </div>

        {/* Client Responded */}
        <div
          onClick={() => setStatusFilter('CLIENT_ANSWERED')}
          className={`bg-slate-900/90 border rounded-2xl p-4 shadow-xl backdrop-blur-xl transition cursor-pointer relative overflow-hidden ${
            statusFilter === 'CLIENT_ANSWERED' ? 'border-emerald-500/80 ring-1 ring-emerald-500/50' : 'border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-emerald-300">Client Responded</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-200">{metrics.total_client_answered}</div>
          <span className="text-[10px] text-emerald-400/80 font-medium mt-1 block">Notes added • Ready to classify</span>
          {metrics.total_client_answered > 0 && (
            <span className="absolute top-2 right-2 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          )}
        </div>

        {/* Categorized & Synced */}
        <div
          onClick={() => setStatusFilter('MAPPED')}
          className={`bg-slate-900/90 border rounded-2xl p-4 shadow-xl backdrop-blur-xl transition cursor-pointer ${
            statusFilter === 'MAPPED' ? 'border-indigo-500/80 ring-1 ring-indigo-500/50' : 'border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-400">Categorized &amp; Synced</span>
            <CheckCheck className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-black text-white">{metrics.total_mapped}</div>
          <span className="text-[10px] text-indigo-400/80 font-medium mt-1 block">Reconciled to accounting</span>
        </div>

      </div>

      {/* Filter Toolbar & Bulk Actions */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl backdrop-blur-xl space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          
          {/* Status Filter Tabs */}
          <div className="flex items-center gap-1.5 flex-wrap bg-slate-950/80 p-1 rounded-xl border border-slate-800">
            {[
              { id: 'ALL', label: `All Items (${metrics.total_count})` },
              { id: 'UNMAPPED', label: `Uncategorized (${metrics.total_uncategorized})` },
              { id: 'CLARIFICATION_REQUESTED', label: `Queried (${metrics.total_pending_client})` },
              { id: 'CLIENT_ANSWERED', label: `Client Responded (${metrics.total_client_answered})` },
              { id: 'MAPPED', label: `Categorized (${metrics.total_mapped})` },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative min-w-[220px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search reference, description, amount..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 font-sans"
            />
          </div>
        </div>

        {/* Bulk Action Bar (when rows are selected) */}
        {selectedTxIds.length > 0 && (
          <div className="bg-sky-950/60 border border-sky-500/40 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-sky-200">
                {selectedTxIds.length} transaction(s) selected
              </span>
              <button
                onClick={() => setSelectedTxIds([])}
                className="text-[11px] text-slate-400 hover:text-white underline cursor-pointer"
              >
                Deselect all
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={bulkAccountId}
                onChange={(e) => setBulkAccountId(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500 cursor-pointer"
              >
                <option value="">Assign Category to All...</option>
                {accounts.map((acc) => (
                  <option key={acc.account_id} value={acc.account_id}>
                    {acc.account_code ? `[${acc.account_code}] ` : ''}{acc.account_name}
                  </option>
                ))}
              </select>

              <button
                onClick={handleBulkCategorize}
                disabled={isBulkCategorizing || !bulkAccountId}
                className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Bulk Categorize</span>
              </button>

              <button
                onClick={handleBulkQuery}
                className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Batch Ask Client (Digest)</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Transactions Table */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl backdrop-blur-xl overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
            <RefreshCw className="w-6 h-6 text-sky-400 animate-spin" />
            <span>Loading bank transactions &amp; queries...</span>
          </div>
        ) : transactions.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs space-y-2">
            <Landmark className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="font-bold text-white text-sm">No Bank Transactions Found</p>
            <p className="text-slate-500 max-w-sm mx-auto">
              All transactions in watched suspense accounts are currently reconciled, or none match the active search query.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-950/80 border-b border-slate-800 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={selectedTxIds.length === transactions.length && transactions.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedTxIds(transactions.map((t) => t.id));
                        else setSelectedTxIds([]);
                      }}
                      className="rounded border-slate-700 text-sky-600 focus:ring-sky-500"
                    />
                  </th>
                  <th className="py-3 px-3">Date / Account</th>
                  <th className="py-3 px-3">Raw Description</th>
                  <th className="py-3 px-3">Amount (GHS)</th>
                  <th className="py-3 px-4">Chart of Accounts Category</th>
                  <th className="py-3 px-4">Status &amp; Client Communication</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {transactions.map((tx) => {
                  const isSelected = selectedTxIds.includes(tx.id);
                  const isUnmapped = tx.status === 'UNMAPPED';
                  const isPending = tx.status === 'CLARIFICATION_REQUESTED';
                  const isAnswered = tx.status === 'CLIENT_ANSWERED';
                  const isMapped = tx.status === 'MAPPED' || tx.status === 'POSTED';
                  const isSaving = savingRowIds[tx.id] || false;

                  return (
                    <tr
                      key={tx.id}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        isSelected ? 'bg-sky-950/20' : ''
                      } ${isAnswered ? 'bg-emerald-950/10' : ''}`}
                    >
                      {/* Checkbox */}
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedTxIds([...selectedTxIds, tx.id]);
                            else setSelectedTxIds(selectedTxIds.filter((id) => id !== tx.id));
                          }}
                          className="rounded border-slate-700 text-sky-600 focus:ring-sky-500"
                        />
                      </td>

                      {/* Date & Account */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className="font-mono font-bold text-white block">{tx.transaction_date}</span>
                        <span className="text-[10px] text-slate-400 font-mono block truncate max-w-[150px]">
                          {tx.bank_account_name || 'Bank Operating'}
                        </span>
                      </td>

                      {/* Raw Description */}
                      <td className="py-3.5 px-3 max-w-[240px]">
                        <p className="font-mono text-slate-200 text-[11px] break-words line-clamp-2" title={tx.description}>
                          {tx.description}
                        </p>
                        {tx.ai_suggested_account && !isMapped && (
                          <div className="flex items-center gap-1 text-[10px] text-amber-400 mt-1">
                            <Sparkles className="w-3 h-3 shrink-0" />
                            <span className="truncate">AI Suggestion: {tx.ai_suggested_account}</span>
                            {tx.category_confidence && (
                              <span className="text-slate-500">({Math.round(tx.category_confidence * 100)}%)</span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Amount */}
                      <td className="py-3.5 px-3 whitespace-nowrap font-mono">
                        <span className="font-extrabold text-white text-sm block">
                          GHS {tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                        <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded inline-block mt-0.5 ${
                          tx.transaction_type === 'DEBIT' ? 'bg-rose-950 text-rose-300 border border-rose-500/30' : 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                        }`}>
                          {tx.transaction_type}
                        </span>
                      </td>

                      {/* Category Selector */}
                      <td className="py-3.5 px-4 min-w-[200px]">
                        <div className="space-y-1.5">
                          <select
                            value={rowAccountMap[tx.id] || tx.mapped_account_id || ''}
                            onChange={(e) => setRowAccountMap({ ...rowAccountMap, [tx.id]: e.target.value })}
                            className={`w-full text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-sky-500 transition cursor-pointer ${
                              isMapped
                                ? 'bg-slate-950/80 text-emerald-300 border border-emerald-500/40 font-bold'
                                : 'bg-slate-950 border border-slate-800 text-white'
                            }`}
                          >
                            <option value="">Select Category...</option>
                            {accounts.map((acc) => (
                              <option key={acc.account_id} value={acc.account_id}>
                                {acc.account_code ? `[${acc.account_code}] ` : ''}{acc.account_name}
                              </option>
                            ))}
                          </select>

                          {/* Payee / Vendor Input */}
                          <input
                            type="text"
                            placeholder="Payee / Contact (optional)"
                            value={rowPayeeMap[tx.id] !== undefined ? rowPayeeMap[tx.id] : (tx.payee_name || '')}
                            onChange={(e) => setRowPayeeMap({ ...rowPayeeMap, [tx.id]: e.target.value })}
                            className="w-full bg-slate-950/60 border border-slate-800/80 rounded-lg px-2 py-1 text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500 font-sans"
                          />
                        </div>
                      </td>

                      {/* Status & Client Response Box */}
                      <td className="py-3.5 px-4 max-w-[260px]">
                        {isAnswered ? (
                          <div className="bg-emerald-950/40 border border-emerald-500/40 rounded-xl p-2.5 space-y-1 text-[11px]">
                            <div className="flex items-center justify-between text-emerald-300 font-bold">
                              <span className="flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                Client Responded
                              </span>
                            </div>
                            <p className="text-white font-sans bg-slate-950/60 p-1.5 rounded border border-emerald-500/20 italic">
                              "{tx.client_explanation}"
                            </p>
                            {tx.client_attachments && tx.client_attachments.length > 0 && (
                              <div className="flex items-center gap-1 text-sky-400 text-[10px]">
                                <Paperclip className="w-3 h-3" />
                                <span>{tx.client_attachments.length} attachment(s) uploaded</span>
                              </div>
                            )}
                          </div>
                        ) : isPending ? (
                          <div className="bg-amber-950/40 border border-amber-500/40 rounded-xl p-2.5 space-y-1 text-[11px]">
                            <span className="font-bold text-amber-300 flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 text-amber-400" />
                              Awaiting Client Response
                            </span>
                            <p className="text-slate-300 line-clamp-2 text-[10px]">
                              Asked: "{tx.accountant_query}"
                            </p>
                          </div>
                        ) : isMapped ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-indigo-950/80 text-indigo-300 border border-indigo-500/40">
                            <Check className="w-3 h-3 text-indigo-400" />
                            <span>{tx.mapped_account_name || 'Categorized'}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-950 text-slate-400 border border-slate-800">
                            <AlertCircle className="w-3 h-3 text-sky-400" />
                            <span>Uncategorized</span>
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Categorize Button */}
                          <button
                            type="button"
                            onClick={() => handleCategorizeRow(tx)}
                            disabled={isSaving}
                            className="inline-flex items-center gap-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 hover:text-white border border-emerald-500/40 px-2.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer"
                            title="Approve category & sync to accounting platform"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>{isSaving ? 'Saving...' : 'Categorize'}</span>
                          </button>

                          {/* Ask Client Button */}
                          <button
                            type="button"
                            onClick={() => handleOpenQueryModal(tx)}
                            className="inline-flex items-center gap-1 bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 hover:text-white border border-sky-500/40 px-2.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer"
                            title="Draw client attention / request explanation"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>Ask Client</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Query Composer Modal */}
      <QueryComposerModal
        transaction={selectedTxForQuery}
        isOpen={isQueryModalOpen}
        onClose={() => {
          setIsQueryModalOpen(false);
          setSelectedTxForQuery(null);
        }}
        onSuccess={(updated) => {
          setTransactions((prev) =>
            prev.map((item) => (item.id === updated.id ? updated : item))
          );
          setMetrics((prev) => ({
            ...prev,
            total_uncategorized: Math.max(0, prev.total_uncategorized - 1),
            total_pending_client: prev.total_pending_client + 1,
          }));
        }}
      />

    </div>
  );
};
