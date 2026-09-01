import React, { useState, useEffect } from 'react';
import { useClient } from '../../../context/ClientContext';
import { useAutomation } from '../../../context/AutomationContext';
import {
  fetchBankTransactions,
  fetchChartOfAccounts,
  updateWatchedAccounts,
  queryBankTransaction,
  mapBankTransaction,
  uploadBankStatement,
  syncBankFeedsFromAccounting,
} from '../../../lib/api';
import type { BankTransactionRecord, ChartOfAccountItem } from '../../../types/client';
import {
  Landmark,
  UploadCloud,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Send,
  HelpCircle,
  ShieldCheck,
  Check,
  Tag,
  Sliders,
  X,
  Plus,
  Trash2,
  Calendar,
  Layers,
  ChevronDown,
  Paperclip,
} from 'lucide-react';

const DEFAULT_FALLBACK_ACCOUNTS: ChartOfAccountItem[] = [
  { account_id: 'acc_6990', account_code: '6990', account_name: 'Uncategorized Expenses', account_type: 'Expense', is_suspense: true },
  { account_id: 'acc_4990', account_code: '4990', account_name: 'Uncategorized Income', account_type: 'Income', is_suspense: true },
  { account_id: 'acc_850', account_code: '850', account_name: 'Suspense Account', account_type: 'Other Current Liability', is_suspense: true },
  { account_id: 'acc_2150', account_code: '2150', account_name: 'Ask My Accountant / Clearing', account_type: 'Other Current Liability', is_suspense: true },
  { account_id: 'acc_1095', account_code: '1095', account_name: 'MTN MoMo Holding / Clearing', account_type: 'Current Asset', is_suspense: true },
  { account_id: 'acc_5100', account_code: '5100', account_name: 'Office Supplies & Stationery', account_type: 'Expense', is_suspense: false },
  { account_id: 'acc_5200', account_code: '5200', account_name: 'Vehicle Fuel & Transport', account_type: 'Expense', is_suspense: false },
  { account_id: 'acc_5300', account_code: '5300', account_name: 'Rent & Leasehold Utilities', account_type: 'Expense', is_suspense: false },
  { account_id: 'acc_5400', account_code: '5400', account_name: 'Internet & Data Services', account_type: 'Expense', is_suspense: false },
  { account_id: 'acc_4100', account_code: '4100', account_name: 'Direct Sales Revenue', account_type: 'Income', is_suspense: false },
];

export const ClientBankTab: React.FC = () => {
  const { currentClient } = useClient();
  const { selectedMonth, selectedYear, addLog, setActiveTab } = useAutomation();

  const [transactions, setTransactions] = useState<BankTransactionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Chart of Accounts & Watched Accounts
  const [accounts, setAccounts] = useState<ChartOfAccountItem[]>(DEFAULT_FALLBACK_ACCOUNTS);
  const [watchedAccounts, setWatchedAccounts] = useState<string[]>(['6990', '850', 'suspense', 'uncategorized']);
  const [isWatchedDrawerOpen, setIsWatchedDrawerOpen] = useState(false);
  const [isSavingWatched, setIsSavingWatched] = useState(false);
  const [customWatchedCode, setCustomWatchedCode] = useState('');

  // Inline action state
  const [queryInputs, setQueryInputs] = useState<{ [id: number]: string }>({});
  const [mappingInputs, setMappingInputs] = useState<{ [id: number]: string }>({});

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [txRes, coaRes] = await Promise.all([
        fetchBankTransactions(currentClient.id, statusFilter, search),
        fetchChartOfAccounts(currentClient.id),
      ]);
      setTransactions(txRes.transactions || (Array.isArray(txRes) ? txRes : []));
      if (coaRes.accounts && coaRes.accounts.length > 0) {
        setAccounts(coaRes.accounts);
      }
      if (coaRes.watched_accounts && coaRes.watched_accounts.length > 0) {
        setWatchedAccounts(coaRes.watched_accounts);
      }
    } catch (err: any) {
      console.warn('Error loading bank transactions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [currentClient.id, statusFilter]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setUploadMessage(null);
    addLog('info', `[BANK RECON] Uploading bank statement (${file.name}) for ${currentClient.name}...`);

    try {
      const res = await uploadBankStatement(currentClient.id, file, selectedMonth, selectedYear);
      setUploadMessage(`Successfully parsed statement: ${res.newly_staged || 0} unmapped transactions staged!`);
      addLog('success', `Bank statement ingested for ${currentClient.name}: ${res.newly_staged || 0} lines staged.`);
      await loadData();
    } catch (err: any) {
      setUploadMessage(`Upload error: ${err.message}`);
      addLog('error', `Bank statement upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleSyncAccountingFeed = async () => {
    setIsSyncing(true);
    addLog('info', `[BANK FEED] Syncing bank feed transactions from accounting API for ${currentClient.name}...`);
    try {
      const res = await syncBankFeedsFromAccounting(currentClient.id);
      addLog('success', `[BANK FEED] Synced ${res.synced_new_count || 0} transactions from accounting platform.`);
      await loadData();
    } catch (err: any) {
      addLog('error', `Bank feed sync failed: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSendQuery = async (txId: number) => {
    const queryText = queryInputs[txId]?.trim();
    if (!queryText) return;
    try {
      await queryBankTransaction(txId, { query_text: queryText, send_immediately: true });
      addLog('success', `Sent clarification question to client for bank line #${txId}.`);
      setQueryInputs((prev) => ({ ...prev, [txId]: '' }));
      await loadData();
    } catch (err: any) {
      addLog('error', `Failed sending query: ${err.message}`);
    }
  };

  const handleMapAccount = async (txId: number) => {
    const accountId = mappingInputs[txId]?.trim();
    if (!accountId) return;
    try {
      await mapBankTransaction(txId, accountId);
      addLog('success', `Transaction #${txId} mapped to account '${accountId}'.`);
      setMappingInputs((prev) => ({ ...prev, [txId]: '' }));
      await loadData();
    } catch (err: any) {
      addLog('error', `Failed mapping transaction: ${err.message}`);
    }
  };

  const handleSaveWatchedAccounts = async () => {
    setIsSavingWatched(true);
    try {
      await updateWatchedAccounts(currentClient.id, watchedAccounts);
      addLog('success', `Updated watched suspense accounts for ${currentClient.name}.`);
      setIsWatchedDrawerOpen(false);
    } catch (err: any) {
      addLog('error', `Failed saving watched accounts: ${err.message}`);
    } finally {
      setIsSavingWatched(false);
    }
  };

  const handleAddWatchedCode = () => {
    const code = customWatchedCode.trim();
    if (code && !watchedAccounts.includes(code)) {
      setWatchedAccounts([...watchedAccounts, code]);
      setCustomWatchedCode('');
    }
  };

  const handleRemoveWatchedCode = (code: string) => {
    setWatchedAccounts(watchedAccounts.filter((c) => c !== code));
  };

  const filteredTx = transactions.filter((t) => {
    const matchesSearch =
      t.description?.toLowerCase().includes(search.toLowerCase()) ||
      t.payee_name?.toLowerCase().includes(search.toLowerCase()) ||
      t.transaction_date?.toLowerCase().includes(search.toLowerCase());
    return matchesSearch;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header & Controls Toolbar */}
      <div className="glass-panel rounded-2xl p-5 shadow-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Landmark className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white tracking-tight">
              Bank Statements &amp; Clarification Ledger
            </h2>
            <span className="text-[10px] font-mono font-bold text-emerald-300 bg-emerald-950/80 border border-emerald-500/30 px-2 py-0.5 rounded-full">
              {currentClient.name}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Ingest monthly bank statements, monitor watched suspense accounts, and dispatch clarification requests.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Watched Accounts Drawer Toggle */}
          <button
            onClick={() => setIsWatchedDrawerOpen(!isWatchedDrawerOpen)}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl transition cursor-pointer border ${
              isWatchedDrawerOpen
                ? 'bg-emerald-600 border-emerald-500 text-white'
                : 'bg-slate-950 hover:bg-slate-900 border-slate-800 text-emerald-300'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Watched Suspense Accounts ({watchedAccounts.length})</span>
          </button>

          {/* Sync Accounting Feed */}
          <button
            onClick={handleSyncAccountingFeed}
            disabled={isSyncing}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold px-3 py-2 rounded-xl transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-emerald-400' : ''}`} />
            <span>{isSyncing ? 'Syncing Feed...' : 'Sync Accounting Feed'}</span>
          </button>

          {/* Upload Statement Button */}
          <label className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg shadow-emerald-600/20 transition cursor-pointer">
            <UploadCloud className="w-4 h-4" />
            <span>{isUploading ? 'Ingesting Statement...' : 'Upload Statement (PDF/CSV)'}</span>
            <input
              type="file"
              accept=".csv,.pdf,.xlsx,.xls"
              onChange={handleFileUpload}
              disabled={isUploading}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* Upload Message Alert */}
      {uploadMessage && (
        <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-xs text-emerald-300 flex items-center gap-2 shadow-lg">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{uploadMessage}</span>
        </div>
      )}

      {/* Watched Suspense Accounts Config Panel */}
      {isWatchedDrawerOpen && (
        <div className="glass-panel-elevated rounded-2xl p-5 border border-emerald-500/30 animate-in fade-in space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">
                Watched Suspense Accounts Configuration
              </h3>
            </div>
            <button
              onClick={() => setIsWatchedDrawerOpen(false)}
              className="p-1 rounded-lg text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-xs text-slate-400">
            Transactions posted to any of these Chart of Accounts codes or matching keywords will automatically be flagged for accountant review and client queries.
          </p>

          <div className="flex flex-wrap gap-2">
            {watchedAccounts.map((code) => (
              <span
                key={code}
                className="inline-flex items-center gap-1.5 bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs font-mono font-bold px-3 py-1 rounded-lg"
              >
                <span>{code}</span>
                <button
                  onClick={() => handleRemoveWatchedCode(code)}
                  className="hover:text-red-400 transition cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              type="text"
              placeholder="Add account code or keyword (e.g. 6990, suspense, ask_client)..."
              value={customWatchedCode}
              onChange={(e) => setCustomWatchedCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddWatchedCode())}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            <button
              onClick={handleAddWatchedCode}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
            >
              + Add Code
            </button>
            <button
              onClick={handleSaveWatchedAccounts}
              disabled={isSavingWatched}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition"
            >
              {isSavingWatched ? 'Saving...' : 'Save Watched Rules'}
            </button>
          </div>
        </div>
      )}

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800/80 rounded-xl p-2">
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 overflow-x-auto">
          {[
            { id: 'ALL', label: 'All Items' },
            { id: 'UNMAPPED', label: 'Unmapped' },
            { id: 'CLARIFICATION_REQUESTED', label: 'Awaiting Client' },
            { id: 'CLIENT_ANSWERED', label: 'Client Answered' },
            { id: 'MAPPED', label: 'Mapped' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`px-3 py-1 text-xs font-bold rounded-md transition cursor-pointer whitespace-nowrap ${
                statusFilter === f.id
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search bank transactions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 sm:w-72"
          />
        </div>
      </div>

      {/* Bank Transactions Ledger */}
      {isLoading ? (
        <div className="glass-panel rounded-2xl p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2 border border-slate-800">
          <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
          <p className="text-xs">Loading bank statement ledger...</p>
        </div>
      ) : filteredTx.length === 0 ? (
        <div className="glass-panel rounded-2xl p-12 text-center text-slate-400 border border-dashed border-slate-800">
          <Landmark className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-300">No bank transactions matching criteria.</p>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Upload a monthly bank statement (PDF, CSV, Excel) or sync feeds from your accounting platform.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTx.map((tx) => {
            const isAnswered = tx.status === 'CLIENT_ANSWERED';
            const isMapped = tx.status === 'MAPPED';
            const isClarification = tx.status === 'CLARIFICATION_REQUESTED';

            return (
              <div
                key={tx.id}
                className={`glass-panel rounded-2xl p-4 transition border ${
                  isMapped
                    ? 'border-emerald-500/30'
                    : isAnswered
                    ? 'border-teal-500/40 bg-teal-950/15'
                    : isClarification
                    ? 'border-amber-500/40'
                    : 'border-slate-800'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono font-bold text-slate-400">{tx.transaction_date}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          tx.transaction_type === 'CREDIT'
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                        }`}
                      >
                        {tx.transaction_type === 'CREDIT' ? 'Inflow (+)' : 'Outflow (-)'}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          isMapped
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                            : isAnswered
                            ? 'bg-teal-950 text-teal-300 border border-teal-500/30'
                            : isClarification
                            ? 'bg-amber-950 text-amber-300 border border-amber-500/30'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {isMapped
                          ? 'MAPPED'
                          : isAnswered
                          ? 'CLIENT ANSWERED'
                          : isClarification
                          ? 'AWAITING CLIENT'
                          : 'UNMAPPED'}
                      </span>
                    </div>

                    <h4 className="text-sm font-bold text-white mt-1">{tx.description}</h4>

                    {/* Client Written Explanation */}
                    {tx.client_explanation && (
                      <div className="mt-2 p-3 bg-teal-950/40 border border-teal-500/30 rounded-xl text-xs text-teal-200 space-y-1">
                        <div className="font-bold text-teal-300 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Client Explanation:</span>
                        </div>
                        <p>{tx.client_explanation}</p>
                        {tx.client_attachments && tx.client_attachments.length > 0 && (
                          <div className="flex items-center gap-2 pt-1">
                            <Paperclip className="w-3 h-3 text-teal-400" />
                            <span className="text-[11px] text-teal-300">
                              {tx.client_attachments.length} attachment(s) uploaded by client
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Accountant Question */}
                    {tx.accountant_query && (
                      <div className="mt-1 p-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-400">
                        <span className="font-bold text-slate-300">Your Query: </span>
                        <span>{tx.accountant_query}</span>
                      </div>
                    )}
                  </div>

                  {/* Amount & Account */}
                  <div className="text-right shrink-0">
                    <p
                      className={`text-base font-mono font-extrabold ${
                        tx.transaction_type === 'CREDIT' ? 'text-emerald-400' : 'text-slate-200'
                      }`}
                    >
                      {tx.transaction_type === 'CREDIT' ? '+' : '-'}GHS {Number(tx.amount || 0).toFixed(2)}
                    </p>
                    {tx.mapped_account_id && (
                      <p className="text-[11px] text-emerald-400 font-mono">Account: {tx.mapped_account_id}</p>
                    )}
                  </div>
                </div>

                {/* Inline Action Controls */}
                {!isMapped && (
                  <div className="mt-3 pt-3 border-t border-slate-850 grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Ask Client Query */}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={queryInputs[tx.id] || ''}
                        onChange={(e) => setQueryInputs((prev) => ({ ...prev, [tx.id]: e.target.value }))}
                        placeholder="Ask client for details / receipt..."
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                      />
                      <button
                        onClick={() => handleSendQuery(tx.id)}
                        disabled={!queryInputs[tx.id]?.trim()}
                        className="bg-amber-950/80 hover:bg-amber-900 border border-amber-500/40 text-amber-300 text-xs font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-40"
                      >
                        Ask Client
                      </button>
                    </div>

                    {/* Map to Chart of Accounts */}
                    <div className="flex items-center gap-2">
                      <select
                        value={mappingInputs[tx.id] || ''}
                        onChange={(e) => setMappingInputs((prev) => ({ ...prev, [tx.id]: e.target.value }))}
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                      >
                        <option value="">Select Chart of Accounts...</option>
                        {accounts.map((acc) => (
                          <option key={acc.account_id} value={acc.account_code || acc.account_name}>
                            {acc.account_code} - {acc.account_name} ({acc.account_type})
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleMapAccount(tx.id)}
                        disabled={!mappingInputs[tx.id]?.trim()}
                        className="bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/40 text-emerald-300 text-xs font-semibold px-3.5 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-40"
                      >
                        Map Account
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
};
