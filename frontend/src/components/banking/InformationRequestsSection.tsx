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
  uploadBankStatement,
} from '../../lib/api';
import {
  ACCOUNTING_PLATFORMS,
  type BankTransactionRecord,
  type ChartOfAccountItem,
} from '../../types/client';
import { QueryComposerModal } from '../modals/QueryComposerModal';
import {
  Landmark,
  UploadCloud,
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
  Plus,
  Trash2,
  Calendar,
  Filter,
  Users,
} from 'lucide-react';

const MONTH_OPTIONS = [
  { id: 'ALL', label: 'All Months' },
  { id: 'January', label: 'January' },
  { id: 'February', label: 'February' },
  { id: 'March', label: 'March' },
  { id: 'April', label: 'April' },
  { id: 'May', label: 'May' },
  { id: 'June', label: 'June' },
  { id: 'July', label: 'July' },
  { id: 'August', label: 'August' },
  { id: 'September', label: 'September' },
  { id: 'October', label: 'October' },
  { id: 'November', label: 'November' },
  { id: 'December', label: 'December' },
];

const YEAR_OPTIONS = [
  { id: 'ALL', label: 'All Years' },
  { id: '2027', label: '2027' },
  { id: '2026', label: '2026' },
  { id: '2025', label: '2025' },
  { id: '2024', label: '2024' },
];

export const InformationRequestsSection: React.FC = () => {
  const { currentClient, clients, setClient } = useClient();
  const { addLog, setActiveTab, selectedMonth: globalMonth, selectedYear: globalYear } = useAutomation();

  const platformInfo = ACCOUNTING_PLATFORMS.find((p) => p.id === currentClient?.accounting_software);
  const platformName = platformInfo?.name || 'Accounting';
  const platformFeedLabel = currentClient?.accounting_software === 'zoho_books'
    ? 'Zoho Feeds'
    : currentClient?.accounting_software === 'quickbooks_online'
    ? 'QBO Suspense'
    : currentClient?.accounting_software === 'xero'
    ? 'Xero Suspense'
    : 'Watched Feeds';

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
  const [isUploading, setIsUploading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Month & Year Filter State (Synchronized with Global Canonical Header Scope)
  const [selectedMonth, setSelectedMonth] = useState<string>(globalMonth || 'ALL');
  const [selectedYear, setSelectedYear] = useState<string>(globalYear ? String(globalYear) : 'ALL');
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);

  useEffect(() => {
    if (globalMonth) setSelectedMonth(globalMonth);
    if (globalYear) setSelectedYear(String(globalYear));
  }, [globalMonth, globalYear]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentClient) return;
    setIsUploading(true);
    addLog('info', `[BANK] Ingesting bank statement (${file.name}) for ${currentClient.name}...`);
    try {
      const yearNum = selectedYear && selectedYear !== 'ALL' ? Number(selectedYear) : undefined;
      const monthVal = selectedMonth && selectedMonth !== 'ALL' ? selectedMonth : undefined;
      const res = await uploadBankStatement(currentClient.id, file, monthVal, yearNum);
      addLog('success', `Bank statement parsed: ${res.newly_staged || 0} unmapped transactions staged.`);
      await loadData();
    } catch (err: any) {
      addLog('error', `Bank statement upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  // Chart of Accounts & Watched Accounts State
  const [accounts, setAccounts] = useState<ChartOfAccountItem[]>([]);
  const [isOauthPending, setIsOauthPending] = useState<boolean>(false);
  const [watchedAccounts, setWatchedAccounts] = useState<string[]>(['6990', '850', 'suspense', 'uncategorized']);
  const [isWatchedDrawerOpen, setIsWatchedDrawerOpen] = useState(false);
  const [isSavingWatched, setIsSavingWatched] = useState(false);
  const [selectedDropdownCode, setSelectedDropdownCode] = useState<string>('');
  const [customCodeInput, setCustomCodeInput] = useState<string>('');

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
        fetchBankTransactions(currentClient.id, statusFilter, searchQuery, selectedMonth, selectedYear),
        fetchChartOfAccounts(currentClient.id),
      ]);

      setTransactions(txRes.transactions || []);
      if (txRes.available_months) {
        setAvailableMonths(txRes.available_months);
      }
      setMetrics(txRes.metrics || {
        total_count: 0,
        total_uncategorized: 0,
        total_pending_client: 0,
        total_client_answered: 0,
        total_mapped: 0,
      });

      if (coaRes.oauth_pending || !coaRes.accounts || coaRes.accounts.length === 0) {
        setIsOauthPending(true);
        setAccounts([]);
      } else {
        setIsOauthPending(false);
        setAccounts(coaRes.accounts);
      }

      const loadedWatched = coaRes.watched_accounts && coaRes.watched_accounts.length > 0
        ? coaRes.watched_accounts
        : ['6990', '850', 'suspense', 'uncategorized'];
      setWatchedAccounts(loadedWatched);

      // Initialize inline account selectors
      const initialRowAccounts: { [id: number]: string } = {};
      const initialRowPayees: { [id: number]: string } = {};
      (txRes.transactions || []).forEach((t: BankTransactionRecord) => {
        if (t.mapped_account_id) {
          initialRowAccounts[t.id] = t.mapped_account_id;
        } else if (t.ai_suggested_account && coaRes.accounts && coaRes.accounts.length > 0) {
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
  }, [currentClient, statusFilter, searchQuery, selectedMonth, selectedYear, addLog]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Sync Watched Accounts from Accounting Platform
  const handleSyncFeeds = async () => {
    if (!currentClient) return;
    setIsSyncing(true);
    try {
      const res = await syncBankFeedsFromAccounting(currentClient.id, selectedMonth, selectedYear);
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
      `Enter clarification query for ${selectedTxIds.length} selected transactions in watched accounts:`,
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
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="w-10 h-10 rounded-xl bg-[#F0F9FF] border border-[#BAE6FD] flex items-center justify-center text-[#0284C7] shadow-xs">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold text-[#0F172A] tracking-tight">
                    Information Requests
                  </h1>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-[#F0F9FF] text-[#0284C7] border border-[#BAE6FD] uppercase tracking-wider">
                    Watched Accounts
                  </span>
                  {clients && clients.length > 1 ? (
                    <div className="flex items-center gap-1.5 bg-white border border-[#E2E8F0] rounded-xl px-2.5 py-1 shadow-xs">
                      <span className="text-[10px] uppercase font-bold text-slate-500">Client:</span>
                      <select
                        value={currentClient?.id || ''}
                        onChange={(e) => setClient(e.target.value)}
                        className="bg-transparent text-slate-800 text-xs font-semibold focus:outline-none cursor-pointer"
                      >
                        {clients.map((c) => (
                          <option key={c.id} value={c.id} className="bg-white text-slate-800">
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-[#F0F9FF] text-[#0284C7] border border-[#BAE6FD]">
                      {currentClient?.name || 'Active Client'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#64748B] mt-0.5 max-w-2xl font-normal">
                  Review unclassified transactions in monitored watched accounts, assign Chart of Accounts categories inline, and query clients with instant 1-click notification alerts.
                </p>
              </div>
            </div>
          </div>

          {/* Action Bar */}
          <div className="flex items-center gap-2.5 flex-wrap shrink-0">
            <button
              onClick={() => setIsWatchedDrawerOpen(!isWatchedDrawerOpen)}
              className={`flex items-center gap-1.5 text-xs font-semibold py-2.5 px-3.5 rounded-xl border transition cursor-pointer ${
                isWatchedDrawerOpen
                  ? 'bg-[#0284C7] text-white border-[#0284C7] shadow-xs'
                  : 'bg-white text-slate-700 hover:bg-slate-50 border-[#E2E8F0] shadow-xs'
              }`}
            >
              <Sliders className={`w-3.5 h-3.5 ${isWatchedDrawerOpen ? 'text-white' : 'text-slate-600'}`} />
              <span>Watched Accounts ({watchedAccounts.length})</span>
              {isWatchedDrawerOpen ? <ChevronUp className="w-3.5 h-3.5 text-white" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-600" />}
            </button>

            <button
              onClick={handleSyncFeeds}
              disabled={isSyncing}
              className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold py-2.5 px-3.5 rounded-xl border border-[#E2E8F0] shadow-xs transition cursor-pointer"
              title={`Pull live uncategorized & suspense transactions from ${platformName}`}
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#0284C7] ${isSyncing ? 'animate-spin' : ''}`} />
              <span>
                {isSyncing
                  ? 'Syncing Feeds...'
                  : selectedMonth !== 'ALL'
                  ? `Sync ${platformFeedLabel} (${selectedMonth.slice(0, 3)})`
                  : `Sync Live Feeds (${platformName})`}
              </span>
            </button>

            <label
              className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold py-2.5 px-3.5 rounded-xl border border-[#E2E8F0] shadow-xs transition cursor-pointer"
              title="Upload bank statement (PDF or CSV)"
            >
              <UploadCloud className="w-3.5 h-3.5 text-[#0284C7]" />
              <span>{isUploading ? 'Ingesting...' : 'Upload Statement'}</span>
              <input
                type="file"
                accept=".pdf,.csv"
                className="hidden"
                onChange={handleFileUpload}
                disabled={isUploading}
              />
            </label>

            <button
              onClick={() => setActiveTab('contacts')}
              className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold py-2.5 px-3.5 rounded-xl border border-[#E2E8F0] shadow-xs transition cursor-pointer"
              title="Manage client contacts and firm team members"
            >
              <Users className="w-3.5 h-3.5 text-slate-600" />
              <span>Contacts &amp; Team</span>
            </button>

            <button
              onClick={() => setActiveTab('portal')}
              className="flex items-center gap-1.5 bg-[#0284C7] hover:bg-[#0EA5E9] text-white text-xs font-semibold py-2.5 px-4 rounded-xl shadow-xs transition cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Open Client Portal View</span>
            </button>
          </div>
        </div>

        {/* Collapsible Watched Chart of Accounts Drawer */}
        {isWatchedDrawerOpen && (
          <div className="mt-5 pt-4 border-t border-[#E2E8F0] space-y-4 animate-in fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold text-[#0F172A] flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-[#0284C7]" />
                  <span>Monitored Suspense &amp; Uncategorized Accounts</span>
                </h3>
                <p className="text-[11px] text-[#64748B] mt-0.5">
                  Select which Chart of Account codes to monitor for unclassified transactions:
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWatchedAccounts(['6990', '850', 'suspense', 'uncategorized'])}
                  className="text-[11px] text-slate-600 hover:text-slate-900 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-[#E2E8F0] transition cursor-pointer shadow-xs"
                >
                  Reset Defaults
                </button>
                <button
                  onClick={handleSaveWatchedAccounts}
                  disabled={isSavingWatched}
                  className="inline-flex items-center gap-1.5 bg-[#0284C7] hover:bg-[#0EA5E9] text-white text-xs font-bold px-4 py-2 rounded-xl transition cursor-pointer shadow-xs"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{isSavingWatched ? 'Saving...' : 'Save Watched Accounts'}</span>
                </button>
              </div>
            </div>

            {/* Dropdown Selector & Custom Code Input Controls */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-50/70 p-3.5 rounded-xl border border-[#E2E8F0]">
              {/* Dropdown Account Picker */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                  <span>Select from Chart of Accounts:</span>
                </label>
                <div className="flex gap-2">
                  <select
                    value={selectedDropdownCode}
                    onChange={(e) => setSelectedDropdownCode(e.target.value)}
                    className="flex-1 bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-[#0284C7] cursor-pointer"
                  >
                    <option value="">Choose an account to watch...</option>
                    {accounts.map((acc: ChartOfAccountItem) => {
                      const code = acc.account_code || acc.account_id;
                      const isAlreadyWatched = watchedAccounts.includes(code) || watchedAccounts.includes(acc.account_id);
                      return (
                        <option key={acc.account_id} value={code} disabled={isAlreadyWatched}>
                          {code ? `[${code}] ` : ''}{acc.account_name} ({acc.account_type}){isAlreadyWatched ? ' - (Already Watched)' : ''}
                        </option>
                      );
                    })}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedDropdownCode && !watchedAccounts.includes(selectedDropdownCode)) {
                        setWatchedAccounts([...watchedAccounts, selectedDropdownCode]);
                        setSelectedDropdownCode('');
                      }
                    }}
                    disabled={!selectedDropdownCode}
                    className="inline-flex items-center gap-1 bg-[#0284C7] hover:bg-[#0EA5E9] disabled:opacity-40 text-white text-xs font-semibold px-3 py-2 rounded-lg transition cursor-pointer shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>
                </div>
              </div>

              {/* Custom Code Input */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                  <span>Add Custom Account Code / Alias:</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customCodeInput}
                    onChange={(e) => setCustomCodeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && customCodeInput.trim()) {
                        e.preventDefault();
                        const val = customCodeInput.trim();
                        if (!watchedAccounts.includes(val)) {
                          setWatchedAccounts([...watchedAccounts, val]);
                          setCustomCodeInput('');
                        }
                      }
                    }}
                    placeholder="e.g. 1099, MOMO_CLEARING, 2150..."
                    className="flex-1 bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#0284C7] font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const val = customCodeInput.trim();
                      if (val && !watchedAccounts.includes(val)) {
                        setWatchedAccounts([...watchedAccounts, val]);
                        setCustomCodeInput('');
                      }
                    }}
                    disabled={!customCodeInput.trim()}
                    className="inline-flex items-center gap-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white text-xs font-semibold px-3 py-2 rounded-lg transition cursor-pointer shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Code</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Presets Row */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-[#0284C7]" />
                Quick Presets:
              </span>
              <button
                type="button"
                onClick={() => {
                  const toAdd = ['6990', '850', 'suspense', 'uncategorized'];
                  const merged = Array.from(new Set([...watchedAccounts, ...toAdd]));
                  setWatchedAccounts(merged);
                }}
                className="text-[11px] bg-white hover:bg-slate-50 text-slate-700 border border-[#E2E8F0] px-2.5 py-1 rounded-lg transition cursor-pointer shadow-xs"
              >
                + Default Suspense (6990 &amp; 850)
              </button>
              <button
                type="button"
                onClick={() => {
                  const toAdd = ['1095', '2150', 'momo_clearing'];
                  const merged = Array.from(new Set([...watchedAccounts, ...toAdd]));
                  setWatchedAccounts(merged);
                }}
                className="text-[11px] bg-white hover:bg-slate-50 text-slate-700 border border-[#E2E8F0] px-2.5 py-1 rounded-lg transition cursor-pointer shadow-xs"
              >
                + MoMo &amp; Clearing Holding
              </button>
            </div>

            {/* Active Watched Accounts Badges */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-700 font-bold">
                  Currently Monitored Accounts ({watchedAccounts.length}):
                </span>
                {watchedAccounts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setWatchedAccounts([])}
                    className="text-slate-500 hover:text-[#E11D48] transition underline cursor-pointer"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {watchedAccounts.length === 0 ? (
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-center text-xs text-amber-800">
                  ⚠️ No accounts are currently watched. Select from the dropdown or pick a preset above.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {watchedAccounts.map((code) => {
                    const matchedAcc = accounts.find(
                      (a: ChartOfAccountItem) => (a.account_code && a.account_code === code) || a.account_id === code
                    );
                    const label = matchedAcc ? matchedAcc.account_name : code;

                    return (
                      <div
                        key={code}
                        className="inline-flex items-center gap-1.5 bg-[#F0F9FF] text-[#0284C7] border border-[#BAE6FD] px-3 py-1.5 rounded-xl text-xs font-medium shadow-xs"
                      >
                        <span className="w-2 h-2 rounded-full bg-[#0284C7]" />
                        <span className="font-mono font-bold">{code}</span>
                        {label !== code && <span className="text-slate-700">— {label}</span>}
                        <button
                          type="button"
                          onClick={() => setWatchedAccounts(watchedAccounts.filter((c) => c !== code))}
                          className="text-[#0284C7] hover:text-[#E11D48] hover:bg-[#FFF1F2] p-0.5 rounded transition cursor-pointer ml-1"
                          title={`Remove ${code} from watched accounts`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        )}
      </div>

      {/* Summary KPI Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        
        {/* Unmapped / Needs Action */}
        <div
          onClick={() => setStatusFilter('UNMAPPED')}
          className={`bg-white border rounded-2xl p-4 shadow-sm transition cursor-pointer ${
            statusFilter === 'UNMAPPED' ? 'border-[#0284C7] ring-2 ring-[#0284C7]/20' : 'border-[#E2E8F0] hover:border-[#BAE6FD]'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#64748B]">Needs Classification</span>
            <AlertCircle className="w-4 h-4 text-[#E11D48]" />
          </div>
          <div className="text-2xl font-bold font-mono text-[#0F172A]">{metrics.total_uncategorized}</div>
          <span className="text-[10px] text-slate-400 font-normal mt-1 block">Awaiting account mapping</span>
        </div>

        {/* Pending Client Clarification */}
        <div
          onClick={() => setStatusFilter('CLARIFICATION_REQUESTED')}
          className={`bg-white border rounded-2xl p-4 shadow-sm transition cursor-pointer ${
            statusFilter === 'CLARIFICATION_REQUESTED' ? 'border-[#0284C7] ring-2 ring-[#0284C7]/20' : 'border-[#E2E8F0] hover:border-[#BAE6FD]'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#64748B]">Awaiting Client</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-[#0F172A]">{metrics.total_pending_client}</div>
          <span className="text-[10px] text-slate-400 font-normal mt-1 block">Clarification queries sent</span>
        </div>

        {/* Client Responded */}
        <div
          onClick={() => setStatusFilter('CLIENT_ANSWERED')}
          className={`bg-[#F0F9FF] border rounded-2xl p-4 shadow-sm transition cursor-pointer relative overflow-hidden ${
            statusFilter === 'CLIENT_ANSWERED' ? 'border-[#0284C7] ring-2 ring-[#0284C7]/20' : 'border-[#BAE6FD] hover:border-[#0284C7]'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#0284C7]">Client Responded</span>
            <CheckCircle2 className="w-4 h-4 text-[#0284C7]" />
          </div>
          <div className="text-2xl font-bold font-mono text-[#0284C7]">{metrics.total_client_answered}</div>
          <span className="text-[10px] text-slate-500 font-normal mt-1 block">Notes added • Ready to classify</span>
          {metrics.total_client_answered > 0 && (
            <span className="absolute top-2 right-2 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0284C7] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#0284C7]"></span>
            </span>
          )}
        </div>

        {/* Categorized & Synced */}
        <div
          onClick={() => setStatusFilter('MAPPED')}
          className={`bg-white border rounded-2xl p-4 shadow-sm transition cursor-pointer ${
            statusFilter === 'MAPPED' ? 'border-[#059669] ring-2 ring-[#059669]/20' : 'border-[#E2E8F0] hover:border-[#A7F3D0]'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#64748B]">Categorized &amp; Synced</span>
            <CheckCheck className="w-4 h-4 text-[#059669]" />
          </div>
          <div className="text-2xl font-bold font-mono text-[#059669]">{metrics.total_mapped}</div>
          <span className="text-[10px] text-slate-400 font-normal mt-1 block">Reconciled to accounting</span>
        </div>

      </div>

      {/* Filter Toolbar & Bulk Actions */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          
          {/* Status Filter Tabs */}
          <div className="flex items-center gap-1.5 flex-wrap bg-slate-50 p-1 rounded-xl border border-[#E2E8F0]">
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
                className={`text-xs px-3 py-1.5 rounded-lg transition cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-white text-[#0284C7] font-bold shadow-xs border border-[#E2E8F0]'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60 font-medium'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Controls: Month & Year Selector + Search Box */}
          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Month & Year Dropdown */}
            <div className="flex items-center gap-1.5 bg-white border border-[#E2E8F0] rounded-xl px-3 py-1.5 shadow-xs">
              <Calendar className="w-3.5 h-3.5 text-[#0284C7] shrink-0" />
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-transparent text-xs font-semibold text-slate-800 focus:outline-none cursor-pointer pr-1"
                title="Filter transactions by month"
              >
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id} className="bg-white text-slate-800">
                    {m.label}
                  </option>
                ))}
              </select>

              <span className="text-slate-300 text-xs">/</span>

              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="bg-transparent text-xs font-semibold text-slate-800 focus:outline-none cursor-pointer"
                title="Filter transactions by year"
              >
                {YEAR_OPTIONS.map((y) => (
                  <option key={y.id} value={y.id} className="bg-white text-slate-800">
                    {y.label}
                  </option>
                ))}
              </select>

              {(selectedMonth !== 'ALL' || selectedYear !== 'ALL') && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMonth('ALL');
                    setSelectedYear('ALL');
                  }}
                  className="ml-1 text-slate-400 hover:text-[#E11D48] hover:bg-[#FFF1F2] p-0.5 rounded transition cursor-pointer"
                  title="Clear month & year filters (Show all)"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Search Box */}
            <div className="relative min-w-[200px] flex-1 sm:flex-initial">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search description, payee, amount..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white border border-[#E2E8F0] rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#0284C7] font-sans shadow-xs"
              />
            </div>
          </div>
        </div>

        {/* Active Month & Year Indicator Banner */}
        {(selectedMonth !== 'ALL' || selectedYear !== 'ALL') && (
          <div className="flex items-center justify-between text-xs bg-[#F0F9FF] border border-[#BAE6FD] rounded-xl px-3 py-1.5 animate-in fade-in">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[#0284C7] animate-pulse" />
              <span className="text-slate-700 font-medium">
                Showing transactions for{' '}
                <strong className="text-[#0284C7]">
                  {selectedMonth !== 'ALL' ? selectedMonth : 'All Months'}
                  {selectedYear !== 'ALL' ? ` ${selectedYear}` : ' (All Years)'}
                </strong>{' '}
                ({metrics.total_count} records in watched accounts)
              </span>
            </div>
            <button
              onClick={() => {
                setSelectedMonth('ALL');
                setSelectedYear('ALL');
              }}
              className="text-[11px] text-[#0284C7] hover:underline cursor-pointer font-medium"
            >
              Reset Date Filters
            </button>
          </div>
        )}

        {/* Bulk Action Bar (when rows are selected) */}
        {selectedTxIds.length > 0 && (
          <div className="bg-[#F0F9FF] border border-[#BAE6FD] rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-800">
                {selectedTxIds.length} transaction(s) selected
              </span>
              <button
                onClick={() => setSelectedTxIds([])}
                className="text-[11px] text-slate-500 hover:text-slate-800 underline cursor-pointer"
              >
                Deselect all
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={bulkAccountId}
                onChange={(e) => setBulkAccountId(e.target.value)}
                className="bg-white border border-[#E2E8F0] rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-[#0284C7] cursor-pointer shadow-xs"
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
                className="inline-flex items-center gap-1.5 bg-[#059669] hover:bg-[#047857] disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer shadow-xs"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Bulk Categorize</span>
              </button>

              <button
                onClick={handleBulkQuery}
                className="inline-flex items-center gap-1.5 bg-[#0284C7] hover:bg-[#0EA5E9] text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer shadow-xs"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Batch Ask Client (Digest)</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Transactions Table */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-500 text-xs flex flex-col items-center gap-2">
            <RefreshCw className="w-6 h-6 text-[#0284C7] animate-spin" />
            <span>Loading watched account transactions &amp; queries...</span>
          </div>
        ) : transactions.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-xs space-y-3">
            <ShieldCheck className="w-8 h-8 text-[#059669] mx-auto" />
            <p className="font-bold text-slate-900 text-sm">No Transactions Found in Watched Accounts</p>
            <p className="text-slate-500 max-w-md mx-auto">
              {selectedMonth !== 'ALL' || selectedYear !== 'ALL' || searchQuery || statusFilter !== 'ALL'
                ? `No transactions match the current filter (${[selectedMonth !== 'ALL' && selectedMonth, selectedYear !== 'ALL' && selectedYear, statusFilter !== 'ALL' && statusFilter].filter(Boolean).join(', ')}). Your monitored accounts may contain records in other months or years.`
                : 'All transactions in monitored watched accounts are currently classified, or none have been imported yet from your accounting software.'}
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              {(selectedMonth !== 'ALL' || selectedYear !== 'ALL' || searchQuery || statusFilter !== 'ALL') && (
                <button
                  onClick={() => {
                    setSelectedMonth('ALL');
                    setSelectedYear('ALL');
                    setSearchQuery('');
                    setStatusFilter('ALL');
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-[#F0F9FF] text-[#0284C7] border border-[#BAE6FD] hover:bg-[#E0F2FE] font-medium transition text-xs flex items-center gap-1.5 shadow-xs"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Show All Periods &amp; Clear Filters
                </button>
              )}
              <button
                onClick={handleSyncFeeds}
                disabled={isSyncing}
                className="px-3.5 py-1.5 rounded-lg bg-white text-slate-700 border border-[#E2E8F0] hover:bg-slate-50 font-medium transition text-xs flex items-center gap-1.5 disabled:opacity-50 shadow-xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-[#0284C7]' : ''}`} />
                {isSyncing ? 'Syncing...' : `Sync Feeds from ${platformName}`}
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-[#E2E8F0] text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={selectedTxIds.length === transactions.length && transactions.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedTxIds(transactions.map((t) => t.id));
                        else setSelectedTxIds([]);
                      }}
                      className="rounded border-slate-300 text-[#0284C7] focus:ring-[#0284C7] cursor-pointer"
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
              <tbody className="divide-y divide-[#E2E8F0] text-xs">
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
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isSelected ? 'bg-[#F0F9FF]/60' : ''
                      } ${isAnswered ? 'bg-[#ECFDF5]/50' : ''}`}
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
                          className="rounded border-slate-300 text-[#0284C7] focus:ring-[#0284C7] cursor-pointer"
                        />
                      </td>

                      {/* Date & Account */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className="font-mono font-bold text-slate-900 block">{tx.transaction_date}</span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {tx.source_file_name?.includes('Zoho') ? (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold border border-amber-200">Zoho Feed</span>
                          ) : tx.source_file_name?.includes('QuickBooks') ? (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">QBO Suspense</span>
                          ) : tx.source_file_name?.includes('Xero') ? (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 font-semibold border border-sky-200">Xero Suspense</span>
                          ) : (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold border border-slate-200">Statement</span>
                          )}
                          <span className="text-[10px] text-slate-600 font-mono truncate max-w-[120px]">
                            {tx.metadata_json?.watched_account
                              ? `Code: ${tx.metadata_json.watched_account}`
                              : (tx.bank_account_name || 'Bank Line')}
                          </span>
                        </div>
                      </td>

                      {/* Raw Description */}
                      <td className="py-3.5 px-3 max-w-[240px]">
                        <p className="font-sans text-slate-800 text-[11px] font-medium break-words line-clamp-2" title={tx.description}>
                          {tx.description}
                        </p>
                        {tx.ai_suggested_account && !isMapped && (
                          <div className="flex items-center gap-1 text-[10px] text-[#0284C7] bg-[#F0F9FF] border border-[#BAE6FD] px-1.5 py-0.5 rounded mt-1 inline-flex">
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
                        <span className="font-bold font-mono text-slate-900 text-sm block">
                          GHS {tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                        <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded inline-block mt-0.5 font-mono ${
                          tx.transaction_type === 'DEBIT' ? 'bg-[#FFF1F2] text-[#E11D48] border border-[#FECDD3]' : 'bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]'
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
                            className={`w-full text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#0284C7] transition cursor-pointer shadow-xs ${
                              isMapped
                                ? 'bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0] font-bold'
                                : 'bg-white border border-[#E2E8F0] text-slate-800'
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
                            className="w-full bg-white border border-[#E2E8F0] rounded-lg px-2 py-1 text-[11px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#0284C7] font-sans shadow-xs"
                          />
                        </div>
                      </td>

                      {/* Status & Client Response Box */}
                      <td className="py-3.5 px-4 max-w-[260px]">
                        {isAnswered ? (
                          <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl p-2.5 space-y-1 text-[11px]">
                            <div className="flex items-center justify-between text-[#059669] font-bold">
                              <span className="flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5 text-[#059669]" />
                                Client Responded
                              </span>
                            </div>
                            <p className="text-slate-800 font-sans bg-white p-1.5 rounded border border-[#A7F3D0] italic">
                              "{tx.client_explanation}"
                            </p>
                            {tx.client_attachments && tx.client_attachments.length > 0 && (
                              <div className="flex items-center gap-1 text-[#0284C7] text-[10px]">
                                <Paperclip className="w-3 h-3" />
                                <span>{tx.client_attachments.length} attachment(s) uploaded</span>
                              </div>
                            )}
                          </div>
                        ) : isPending ? (
                          <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 space-y-1 text-[11px]">
                            <span className="font-bold text-amber-800 flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 text-amber-600" />
                              Awaiting Client Response
                            </span>
                            <p className="text-slate-700 line-clamp-2 text-[10px]">
                              Asked: "{tx.accountant_query}"
                            </p>
                          </div>
                        ) : isMapped ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]">
                            <Check className="w-3 h-3 text-[#059669]" />
                            <span>{tx.mapped_account_name || 'Categorized'}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 border border-[#E2E8F0]">
                            <AlertCircle className="w-3 h-3 text-[#0284C7]" />
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
                            className="inline-flex items-center gap-1 bg-[#ECFDF5] hover:bg-[#D1FAE5] text-[#059669] hover:text-[#047857] border border-[#A7F3D0] px-2.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer shadow-xs"
                            title="Approve category & sync to accounting platform"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>{isSaving ? 'Saving...' : 'Categorize'}</span>
                          </button>

                          {/* Ask Client Button */}
                          <button
                            type="button"
                            onClick={() => handleOpenQueryModal(tx)}
                            className="inline-flex items-center gap-1 bg-[#F0F9FF] hover:bg-[#E0F2FE] text-[#0284C7] hover:text-[#0369A1] border border-[#BAE6FD] px-2.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer shadow-xs"
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
