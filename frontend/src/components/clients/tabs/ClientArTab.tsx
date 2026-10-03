import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useClient } from '../../../context/ClientContext';
import { useAutomation } from '../../../context/AutomationContext';
import {
  fetchClientTransactions,
  fetchClientTransactionsSummary,
  fetchClientSourceMetrics,
  ClientSourceMetricsResponse,
  toggleClientTransaction,
  batchToggleTransactions,
  batchApproveTransactions,
  deleteStagedTransaction,
  batchDeleteStagedTransactions,
  batchUpdateTransactionDate,
  updateClientTransaction,
  createClientTransaction,
  fetchItemCatalog,
  fetchClientCatalog,
  CatalogItem,
  runClientStrategy,
  ClientTransactionSummaryRow,
  saveCustomerMapping,
} from '../../../lib/api';
import type { InvoicePreflightAudit } from '../../../types/client';
import { formatCurrency, downloadTxt, downloadCsv } from '../../../lib/utils';
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
  ExternalLink,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Building2,
  FolderKanban,
  List,
  CheckCircle2,
  Edit3,
  Link2,
  Save,
  Trash2,
  ArrowRight,
  FolderOpen,
  FileSpreadsheet,
  Plus,
  Sparkles,
  Clock,
  AlertCircle,
  CheckSquare,
  Square,
  Filter,
  Download,
  Package,
} from 'lucide-react';
import { ZohoItemSearchableSelect } from './ZohoItemSearchableSelect';
import { PurgeIngestedFileModal } from '../../modals/PurgeIngestedFileModal';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from(new Set([2024, 2025, 2026, 2027, CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1])).sort((a, b) => a - b);

export interface SlipGroup {
  slipKey: string;
  sourceFileName: string;
  propertyName: string; // Customer name
  slipDate: string;
  driveUrl?: string | null;
  items: any[];
  txIds: number[];
  totalPickQty: number;
  totalDelivQty: number;
  totalLossQty: number;
  totalAmount: number;
  isFullyApproved: boolean;
  isPartiallyApproved: boolean;
  isFullyReviewed: boolean;
  hasLowConfidence: boolean;
  hasUnmappedItem?: boolean;
  unmappedItemsCount?: number;
  isCustomerReconciled?: boolean;
  reconciledContactId?: string;
  reconciledContactName?: string;
  minConfidence: number;
  status: string;
}

export const ClientArTab: React.FC = () => {
  const { currentClient, refreshClients } = useClient();
  const {
    selectedMonth,
    setSelectedMonth,
    selectedYear,
    setSelectedYear,
    setIsInvoiceModalOpen,
    setInvoicePreflight,
    refreshAll,
    isLoading,
    addLog,
    catalog,
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

  // Purge Mistaken Ingestion Modal State
  const [isPurgeModalOpen, setIsPurgeModalOpen] = useState<boolean>(false);
  const [purgeTargetFileName, setPurgeTargetFileName] = useState<string>('');

  // Filters, Sorting & Pagination State
  const [dailyStatusFilter, setDailyStatusFilter] = useState<'ALL' | 'UNREVIEWED' | 'UNAPPROVED' | 'LOW_CONFIDENCE' | 'PENDING' | 'APPROVED' | 'DISCREPANCY' | 'INVOICED' | 'UNMAPPED'>('ALL');
  const [dailyPropertyFilter, setDailyPropertyFilter] = useState<string>('ALL');
  const [groupedSortBy, setGroupedSortBy] = useState<string>('date_desc');
  const [dailySortField, setDailySortField] = useState<string>('transaction_date');
  const [dailySortDirection, setDailySortDirection] = useState<'asc' | 'desc'>('asc');
  const [dailyPageSize, setDailyPageSize] = useState<number | 'all'>(50);
  const [dailyCurrentPage, setDailyCurrentPage] = useState<number>(1);
  const [groupedPageSize, setGroupedPageSize] = useState<number | 'all'>(20);
  const [groupedCurrentPage, setGroupedCurrentPage] = useState<number>(1);
  const [dailyViewMode, setDailyViewMode] = useState<'grouped' | 'flat'>('grouped');
  const [expandedSlips, setExpandedSlips] = useState<Record<string, boolean>>({});
  const [approvingSlipKey, setApprovingSlipKey] = useState<string | null>(null);

  // Bulk Operations State
  const [selectedSlipKeys, setSelectedSlipKeys] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState<boolean>(false);
  const [isBulkApproving, setIsBulkApproving] = useState<boolean>(false);
  const [isBulkReviewing, setIsBulkReviewing] = useState<boolean>(false);

  // Missing Activity Gap Cadence (Pipeline / Session configurable)
  const [missingCadence, setMissingCadence] = useState<'daily' | 'weekly' | 'fortnightly' | 'monthly' | 'disabled'>('daily');

  // Manual Add Slip Modal State
  const [isAddSlipModalOpen, setIsAddSlipModalOpen] = useState<boolean>(false);
  const [manualSlipCustomer, setManualSlipCustomer] = useState<string>('');
  const [manualSlipDate, setManualSlipDate] = useState<string>('');
  const [manualSlipDocName, setManualSlipDocName] = useState<string>('');
  const [manualSlipItemName, setManualSlipItemName] = useState<string>('');
  const [manualSlipPickQty, setManualSlipPickQty] = useState<number | string>(1);
  const [manualSlipDelivQty, setManualSlipDelivQty] = useState<number | string>(1);
  const [manualSlipRate, setManualSlipRate] = useState<number | string>(0);
  const [isCreatingSlip, setIsCreatingSlip] = useState<boolean>(false);
  const [createSlipError, setCreateSlipError] = useState<string | null>(null);

  // Line Item Inline Editing State (Strictly Zoho Books Item Master)
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [clientContacts, setClientContacts] = useState<any[]>([]);
  const [editingTxId, setEditingTxId] = useState<number | null>(null);
  const [editItemName, setEditItemName] = useState<string>('');
  const [editTxDate, setEditTxDate] = useState<string>('');
  const [editPickQty, setEditPickQty] = useState<number | string>('');
  const [editDelivQty, setEditDelivQty] = useState<number | string>('');
  const [editRate, setEditRate] = useState<number | string>('');
  const [isSavingTx, setIsSavingTx] = useState<boolean>(false);
  const [deletingSlipKey, setDeletingSlipKey] = useState<string | null>(null);
  const [deletingTxId, setDeletingTxId] = useState<number | null>(null);

  // Slip-level Date Correction State
  const [editingDateSlip, setEditingDateSlip] = useState<SlipGroup | null>(null);
  const [newSlipDateValue, setNewSlipDateValue] = useState<string>('');
  const [isSavingSlipDate, setIsSavingSlipDate] = useState<boolean>(false);

  // Quick Link Customer from Daily Review
  const [quickLinkCustomerSlip, setQuickLinkCustomerSlip] = useState<SlipGroup | null>(null);
  const [quickLinkSelectedContactId, setQuickLinkSelectedContactId] = useState<string>('');
  const [isSavingCustomerLink, setIsSavingCustomerLink] = useState<boolean>(false);

  // Adding Missed Item to Slip State
  const [addingItemSlipKey, setAddingItemSlipKey] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState<string>('');
  const [newItemPickQty, setNewItemPickQty] = useState<string>('1');
  const [newItemDelivQty, setNewItemDelivQty] = useState<string>('1');
  const [newItemRate, setNewItemRate] = useState<number | string>(0);
  const [isAddingItem, setIsAddingItem] = useState<boolean>(false);

  // Determine if this client uses specialized 2-stage custody / linen loss tracking (e.g. laundry)
  // vs Universal Accounting Primitives (Quantity, Unit Rate, Total Amount)
  const isCustodyTracking = useMemo(() => {
    if (!currentClient) return false;
    if (currentClient.customConfig?.enable_custody_tracking) return true;
    if (currentClient.id === 'anr_group' || currentClient.id === 'anr') return true;
    const ind = (currentClient.industry || '').toLowerCase();
    return ind.includes('laundry') || ind.includes('linen');
  }, [currentClient]);

  useEffect(() => {
    // Clear catalog when switching client workspace to prevent cross-client leakage
    setCatalogItems([]);
    setClientContacts([]);
    if (!currentClient?.id) return;
    fetchClientCatalog(currentClient.id, currentClient.zoho_org_id).then((res) => {
      setCatalogItems(Array.isArray(res?.items) ? res.items : []);
      setClientContacts(Array.isArray(res?.contacts) ? res.contacts : []);
    });

    if (currentClient?.pipelines) {
      const arPipe = currentClient.pipelines.find((p: any) => p.section === 'AR' || (p.entity_type && p.entity_type.includes('ar_')));
      const cad = arPipe?.source_config?.missing_cadence || (arPipe as any)?.missing_cadence;
      if (cad) setMissingCadence(cad);
    }
  }, [currentClient?.id, currentClient?.zoho_org_id, currentClient?.pipelines]);

  const [summarySortField, setSummarySortField] = useState<string>('item_name');
  const [summarySortDirection, setSummarySortDirection] = useState<'asc' | 'desc'>('asc');

  // Live Storage vs Processed Metrics State
  const [sourceMetricsData, setSourceMetricsData] = useState<ClientSourceMetricsResponse | null>(null);
  const [isLoadingSourceMetrics, setIsLoadingSourceMetrics] = useState<boolean>(false);

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
      const res = await fetchClientTransactionsSummary(
        currentClient.id,
        selectedMonth,
        selectedYear,
        'AR',
        dailyPropertyFilter
      );
      setSummaryRows(res?.summary || []);
      setSummaryStats(res || null);
    } catch (err: any) {
      console.warn('Failed loading client transactions summary:', err);
    } finally {
      setIsLoadingSummary(false);
    }
  };

  const loadSourceMetrics = async () => {
    if (!currentClient?.id) return;
    setIsLoadingSourceMetrics(true);
    try {
      const res = await fetchClientSourceMetrics(
        currentClient.id,
        selectedMonth,
        selectedYear,
        dailyPropertyFilter,
        'AR'
      );
      setSourceMetricsData(res);
    } catch (err: any) {
      console.warn('Failed loading client source metrics:', err);
    } finally {
      setIsLoadingSourceMetrics(false);
    }
  };

  useEffect(() => {
    loadTransactions();
    loadSummaryData();
    loadSourceMetrics();
  }, [currentClient?.id, selectedMonth, selectedYear, dailyPropertyFilter]);

  const handleDeleteRow = async (txId: number) => {
    if (!currentClient?.id) return;
    if (!window.confirm('Are you sure you want to delete this staged line item from the ledger? This will purge the mistakenly ingested record.')) {
      return;
    }
    setDeletingTxId(txId);
    try {
      await deleteStagedTransaction(currentClient.id, txId);
      setTransactions((prev) => prev.filter((t) => t.id !== txId));
      loadSummaryData();
      addLog('success', `Deleted staged transaction #${txId} from database.`);
    } catch (err: any) {
      addLog('error', `Failed to delete transaction: ${err.message}`);
    } finally {
      setDeletingTxId(null);
    }
  };

  const handleDeleteSlip = async (slip: SlipGroup) => {
    if (!currentClient?.id) return;
    const docName = slip.sourceFileName || slip.slipKey;
    if (
      !window.confirm(
        `Are you sure you want to delete all ${slip.items.length} unposted line items extracted from "${docName}"? This will purge the mistakenly ingested document data from PostgreSQL.`
      )
    ) {
      return;
    }
    setDeletingSlipKey(slip.slipKey);
    try {
      const ids = slip.items.map((i: any) => i.id);
      await batchDeleteStagedTransactions(currentClient.id, { transaction_ids: ids, file_name: slip.sourceFileName });
      setTransactions((prev) => prev.filter((t) => !ids.includes(t.id)));
      loadSummaryData();
      addLog('success', `Purged ${ids.length} staged line item(s) for "${docName}".`);
    } catch (err: any) {
      addLog('error', `Failed to purge document: ${err.message}`);
    } finally {
      setDeletingSlipKey(null);
    }
  };

  const handleToggleSelectSlip = (slipKey: string) => {
    setSelectedSlipKeys((prev) => {
      const next = new Set(prev);
      if (next.has(slipKey)) next.delete(slipKey);
      else next.add(slipKey);
      return next;
    });
  };

  const handleSelectAllVisibleSlips = () => {
    if (paginatedGroupedSlips.length === 0) return;
    const allSelected = paginatedGroupedSlips.every((s) => selectedSlipKeys.has(s.slipKey));
    if (allSelected) {
      setSelectedSlipKeys((prev) => {
        const next = new Set(prev);
        paginatedGroupedSlips.forEach((s) => next.delete(s.slipKey));
        return next;
      });
    } else {
      setSelectedSlipKeys((prev) => {
        const next = new Set(prev);
        paginatedGroupedSlips.forEach((s) => next.add(s.slipKey));
        return next;
      });
    }
  };

  const handleBulkDeleteSlips = async () => {
    if (!currentClient?.id || selectedSlipKeys.size === 0) return;
    const selectedSlips = groupedSlips.filter((s) => selectedSlipKeys.has(s.slipKey));
    const totalItems = selectedSlips.reduce((sum, s) => sum + s.items.length, 0);
    if (
      !window.confirm(
        `Are you sure you want to permanently delete ${selectedSlips.length} selected slips (${totalItems} line items) from PostgreSQL? This action cannot be undone.`
      )
    ) {
      return;
    }
    setIsBulkDeleting(true);
    try {
      const allTxIds = selectedSlips.flatMap((s) => s.txIds);
      await batchDeleteStagedTransactions(currentClient.id, { transaction_ids: allTxIds });
      setTransactions((prev) => prev.filter((t) => !allTxIds.includes(t.id)));
      setSelectedSlipKeys(new Set());
      addLog('success', `Bulk deleted ${selectedSlips.length} slips (${allTxIds.length} items) from ledger.`);
      loadSummaryData();
    } catch (err: any) {
      addLog('error', `Bulk delete failed: ${err.message}`);
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleBulkApproveSlips = async () => {
    if (!currentClient?.id || selectedSlipKeys.size === 0) return;
    const selectedSlips = groupedSlips.filter((s) => selectedSlipKeys.has(s.slipKey));
    const allTxIds = selectedSlips.flatMap((s) => s.txIds);
    setIsBulkApproving(true);
    try {
      await batchApproveTransactions(currentClient.id, allTxIds, 'Bulk Approved via Ledger');
      await batchToggleTransactions(currentClient.id, allTxIds, 'reviewed', true);
      setTransactions((prev) =>
        prev.map((t) => (allTxIds.includes(t.id) ? { ...t, approved: true, reviewed: true, status: 'APPROVED' } : t))
      );
      setSelectedSlipKeys(new Set());
      addLog('success', `Bulk approved ${selectedSlips.length} slips (${allTxIds.length} items).`);
      loadSummaryData();
    } catch (err: any) {
      addLog('error', `Bulk approve failed: ${err.message}`);
    } finally {
      setIsBulkApproving(false);
    }
  };

  const handleBulkReviewSlips = async () => {
    if (!currentClient?.id || selectedSlipKeys.size === 0) return;
    const selectedSlips = groupedSlips.filter((s) => selectedSlipKeys.has(s.slipKey));
    const allTxIds = selectedSlips.flatMap((s) => s.txIds);
    setIsBulkReviewing(true);
    try {
      await batchToggleTransactions(currentClient.id, allTxIds, 'reviewed', true);
      setTransactions((prev) =>
        prev.map((t) => (allTxIds.includes(t.id) ? { ...t, reviewed: true } : t))
      );
      setSelectedSlipKeys(new Set());
      addLog('success', `Bulk marked ${selectedSlips.length} slips (${allTxIds.length} items) as reviewed.`);
      loadSummaryData();
    } catch (err: any) {
      addLog('error', `Bulk review failed: ${err.message}`);
    } finally {
      setIsBulkReviewing(false);
    }
  };

  const handleOpenAddSlipModal = (prefillDate?: string) => {
    const mIdx = MONTHS.indexOf(selectedMonth);
    const mStr = String(mIdx !== -1 ? mIdx + 1 : new Date().getMonth() + 1).padStart(2, '0');
    const dStr = String(new Date().getDate()).padStart(2, '0');
    const defaultDate = prefillDate || `${selectedYear || new Date().getFullYear()}-${mStr}-${dStr}`;
    const defaultCustomer = dailyPropertyFilter !== 'ALL' ? dailyPropertyFilter : (availableProperties[0] || currentClient?.name || '');

    setManualSlipCustomer(defaultCustomer);
    setManualSlipDate(defaultDate);
    setManualSlipDocName(`Manual_Slip_${defaultCustomer ? defaultCustomer.replace(/\s+/g, '_') : 'Customer'}_${defaultDate}`);
    setManualSlipItemName(catalogItems[0]?.name || '');
    setManualSlipPickQty(1);
    setManualSlipDelivQty(1);
    setManualSlipRate(catalogItems[0]?.rate || 0);
    setCreateSlipError(null);
    setIsAddSlipModalOpen(true);
  };

  const handleCreateManualSlip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentClient?.id) return;
    setCreateSlipError(null);

    const custName = manualSlipCustomer.trim();
    const itemName = manualSlipItemName.trim();

    if (!custName) {
      setCreateSlipError('Please specify a customer name.');
      return;
    }
    if (!itemName) {
      setCreateSlipError('Please select or specify an item description.');
      return;
    }

    setIsCreatingSlip(true);
    try {
      const pick = Number(manualSlipPickQty) || 0;
      const deliv = Number(manualSlipDelivQty) || 0;
      const rate = Number(manualSlipRate) || 0;
      const tot = Math.round(deliv * rate * 100) / 100;
      const loss = isCustodyTracking ? Math.max(0, pick - deliv) : 0;
      const refItem = catalogItems.find((c) => c.name.toLowerCase() === itemName.toLowerCase());

      const docName = manualSlipDocName.trim() || `Manual_Slip_${custName.replace(/\s+/g, '_')}_${manualSlipDate}`;

      const res = await createClientTransaction(currentClient.id, {
        source_file_name: docName,
        transaction_date: manualSlipDate,
        item_or_description: itemName,
        quantity_or_debit: deliv,
        credit_amount: pick,
        rate_or_price: rate,
        total_amount: tot,
        discrepancy_amount: loss,
        category_or_account: (refItem as any)?.category_or_account,
        accounting_ref_id: (refItem as any)?.accounting_ref_id,
        reviewed: true,
        approved: true,
        status: 'APPROVED',
        metadata_json: {
          customer_name: custName,
          is_manual_entry: true,
          created_at: new Date().toISOString(),
        },
      });

      // Optimistically insert into transactions list immediately
      if (res?.transaction) {
        setTransactions((prev) => [res.transaction, ...prev]);
      }

      addLog('success', `Manually created delivery slip "${docName}" for ${custName}`);
      setIsAddSlipModalOpen(false);

      // Switch to daily slips view and reset filters so the newly created slip is immediately visible
      setActiveLedgerView('daily');
      setDailyStatusFilter('ALL');
      setDailyPropertyFilter('ALL');

      await loadTransactions();
      loadSummaryData();
      setExpandedSlips((prev) => ({ ...prev, [docName]: true }));
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to create manual slip. Please check backend connection.';
      setCreateSlipError(errMsg);
      addLog('error', `Failed to create manual slip: ${errMsg}`);
    } finally {
      setIsCreatingSlip(false);
    }
  };

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

    // Optimistic UI update for underlying transactions
    setTransactions((prev) =>
      prev.map((t) =>
        row.transaction_ids.includes(t.id)
          ? {
              ...t,
              [field]: newVal,
              ...(field === 'approved' && newVal ? { reviewed: true, status: 'APPROVED' } : {}),
            }
          : t
      )
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

  const extractPropertyName = (filename?: string, metadata?: any): string => {
    if (metadata?.customer_name && typeof metadata.customer_name === 'string' && metadata.customer_name.trim()) {
      return metadata.customer_name.trim();
    }
    if (metadata?.customer && typeof metadata.customer === 'string' && metadata.customer.trim()) {
      return metadata.customer.trim();
    }
    if (metadata?.customer_name_hint && typeof metadata.customer_name_hint === 'string' && metadata.customer_name_hint.trim()) {
      return metadata.customer_name_hint.trim();
    }
    if (!filename) return '';
    let base = filename.replace(/\.[a-zA-Z0-9]+$/, '').trim();
    base = base.replace(/[\s._-]+(\d{1,2}[\s._\/-]\d{1,2}[\s._\/-]\d{2,4}|\d{4}[\s._\/-]\d{1,2}[\s._\/-]\d{1,2})$/i, '').trim();
    base = base.replace(/^(manual_slip_|manual_bill_|manual_|slip_)/i, '').trim();
    base = base.replace(/_/g, ' ').trim();
    return base;
  };

  const toTitleCase = (str?: string): string => {
    if (!str) return '-';
    const cleaned = str.replace(/^[:;\s\-•.]+/, '').trim();
    if (!cleaned) return str;
    return cleaned.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
  };

  const handleSummarySort = (field: string) => {
    if (summarySortField === field) {
      setSummarySortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSummarySortField(field);
      setSummarySortDirection(field === 'item_name' ? 'asc' : 'desc');
    }
  };

  const arStagedTx = useMemo(() => transactions.filter((t) => t.pipeline_type !== 'AP'), [transactions]);

  const availableProperties = useMemo(() => {
    const props = new Set<string>();
    arStagedTx.forEach((tx) => {
      const p = extractPropertyName(tx.source_file_name, tx.metadata_json);
      if (p && p.length > 1 && !p.toLowerCase().startsWith('manual_slip_')) props.add(p);
    });
    if (sourceMetricsData?.properties) {
      Object.keys(sourceMetricsData.properties).forEach((p) => {
        const cleaned = extractPropertyName(p);
        if (cleaned && cleaned !== 'ALL' && cleaned.length > 1 && !cleaned.toLowerCase().startsWith('manual_slip_')) {
          props.add(cleaned);
        }
      });
    }
    return Array.from(props).sort();
  }, [arStagedTx, sourceMetricsData]);

  const propertyStatsMap = useMemo(() => {
    const map: Record<string, { slips: Set<string>; items: number; approvedItems: number; pendingItems: number; discrepancyItems: number; totalAmount: number; totalDeliv: number; totalPick: number }> = {};
    arStagedTx.forEach((tx) => {
      const p = extractPropertyName(tx.source_file_name, tx.metadata_json) || 'General';
      if (!map[p]) {
        map[p] = { slips: new Set(), items: 0, approvedItems: 0, pendingItems: 0, discrepancyItems: 0, totalAmount: 0, totalDeliv: 0, totalPick: 0 };
      }
      map[p].items++;
      const deliv = Number(tx.quantity_or_debit) || 0;
      const pick = Number(tx.credit_amount ?? tx.quantity_or_debit) || 0;
      const rate = Number(tx.rate_or_price) || 0;
      const amt = Number(tx.total_amount) || (deliv * rate);
      map[p].totalAmount += amt;
      map[p].totalDeliv += deliv;
      map[p].totalPick += pick;
      const slipKey = tx.source_file_name || `slip-${tx.transaction_date || tx.id}`;
      map[p].slips.add(slipKey);
      if (tx.approved || tx.status === 'INVOICED') {
        map[p].approvedItems++;
      } else {
        map[p].pendingItems++;
      }
      if ((tx.discrepancy_amount || 0) > 0) {
        map[p].discrepancyItems++;
      }
    });
    return map;
  }, [arStagedTx]);

  const filteredSummaryRows = useMemo(() => {
    let rows: ClientTransactionSummaryRow[] = [];

    if (dailyPropertyFilter !== 'ALL') {
      const custTx = arStagedTx.filter(
        (t) => extractPropertyName(t.source_file_name, t.metadata_json) === dailyPropertyFilter
      );
      const groups = new Map<
        string,
        {
          itemName: string;
          totalDeliv: number;
          totalPick: number;
          totalLoss: number;
          rates: number[];
          totalBilled: number;
          slips: Set<string>;
          txIds: number[];
          reviewedCount: number;
          approvedCount: number;
          totalCount: number;
          dates: Set<string>;
        }
      >();

      custTx.forEach((tx) => {
        const rawName = (tx.item_or_description || '').trim();
        const cleanName = rawName.replace(/^[:;\s\-•.]+/, '').trim() || 'General Item';
        const key = cleanName.toLowerCase();

        let g = groups.get(key);
        if (!g) {
          g = {
            itemName: cleanName,
            totalDeliv: 0,
            totalPick: 0,
            totalLoss: 0,
            rates: [],
            totalBilled: 0,
            slips: new Set<string>(),
            txIds: [],
            reviewedCount: 0,
            approvedCount: 0,
            totalCount: 0,
            dates: new Set<string>(),
          };
          groups.set(key, g);
        }

        const deliv = Number(tx.quantity_or_debit) || 0;
        const pick = Number(tx.credit_amount ?? tx.quantity_or_debit) || 0;
        const loss = Number(tx.discrepancy_amount) || 0;
        const rate = Number(tx.rate_or_price) || 0;
        const amt = Number(tx.total_amount) || (deliv * rate);

        g.totalDeliv += deliv;
        g.totalPick += pick;
        g.totalLoss += loss;
        if (rate > 0) g.rates.push(rate);
        g.totalBilled += amt;
        const slipKey = tx.source_file_name || `slip-${tx.transaction_date || tx.id}`;
        g.slips.add(slipKey);
        g.txIds.push(tx.id);
        if (tx.reviewed) g.reviewedCount++;
        if (tx.approved || tx.status === 'INVOICED') g.approvedCount++;
        g.totalCount++;
        if (tx.transaction_date) g.dates.add(tx.transaction_date);
      });

      rows = Array.from(groups.values()).map((g, idx) => {
        const avgRate = g.rates.length > 0 ? g.rates.reduce((a, b) => a + b, 0) / g.rates.length : 0;
        return {
          row_index: idx + 1,
          item_name: g.itemName,
          total_picked_up: g.totalPick,
          total_delivered: g.totalDeliv,
          linen_discrepancy: g.totalLoss,
          unit_rate: avgRate,
          unit_price: avgRate,
          total_billed: Math.round(g.totalBilled * 100) / 100,
          slips_count: g.slips.size,
          reviewed_count: g.reviewedCount,
          approved_count: g.approvedCount,
          is_fully_reviewed: g.reviewedCount === g.totalCount && g.totalCount > 0,
          is_fully_approved: g.approvedCount === g.totalCount && g.totalCount > 0,
          transaction_ids: g.txIds,
          dates_seen: Array.from(g.dates).sort(),
        };
      });
    } else {
      rows = summaryRows;
    }

    if (query) {
      rows = rows.filter((r) => {
        const item = (r?.item_name || '').toLowerCase();
        return item.includes(query);
      });
    }

    const list = [...rows];
    return list.sort((a, b) => {
      let aVal: any = (a as any)[summarySortField];
      let bVal: any = (b as any)[summarySortField];

      if (summarySortField === 'status') {
        aVal = a.is_fully_approved ? 2 : 1;
        bVal = b.is_fully_approved ? 2 : 1;
      }

      if (aVal == null) aVal = '';
      if (bVal == null) bVal = '';

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return summarySortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return summarySortDirection === 'asc'
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }, [summaryRows, arStagedTx, dailyPropertyFilter, query, summarySortField, summarySortDirection]);

  const isItemLowConf = (it: any): boolean => {
    if (it.confidence_score !== undefined && it.confidence_score !== null) {
      const val = Number(it.confidence_score);
      if (!isNaN(val) && val < 0.80) return true;
    }
    if (it.metadata_json?.confidence_score === 'LOW' || it.metadata_json?.confidence_score === 'low') return true;
    if (Array.isArray(it.metadata_json?.anomalies) && it.metadata_json.anomalies.some((a: any) => (a.rule_name || '').includes('LOW_CONFIDENCE'))) return true;
    return false;
  };

  // Active catalog items scoped to client, falling back to global catalog
  const effectiveCatalogItems = useMemo(
    () => (catalogItems.length > 0 ? catalogItems : catalog?.items || []),
    [catalogItems, catalog?.items]
  );

  const stringSimilarity = (s1: string, s2: string): number => {
    if (s1 === s2) return 1.0;
    if (!s1 || !s2) return 0.0;
    const l1 = s1.length;
    const l2 = s2.length;
    const matrix: number[][] = [];
    for (let i = 0; i <= l2; i++) matrix[i] = [i];
    for (let j = 0; j <= l1; j++) matrix[0][j] = j;
    for (let i = 1; i <= l2; i++) {
      for (let j = 1; j <= l1; j++) {
        if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    const maxLen = Math.max(l1, l2);
    return maxLen === 0 ? 1.0 : 1.0 - matrix[l2][l1] / maxLen;
  };

  // Strictly Zoho Books Item Master (Active items only) scoped to this client
  const officialZohoItemMap = useMemo(() => {
    const map = new Map<string, CatalogItem>();
    effectiveCatalogItems.forEach((c: any) => {
      if (c.status && c.status.toLowerCase() !== 'active') {
        return;
      }
      const rawName = (c.name || '').trim();
      if (!rawName) return;
      const lower = rawName.toLowerCase();
      const cleanKey = lower.replace(/^[:;\s\-•.]+/, '').trim();
      const noPunct = cleanKey.replace(/[,\-_/\\()]/g, ' ').replace(/\s+/g, ' ').trim();
      const singular = cleanKey.replace(/\b([a-z]+)s\b/g, '$1');
      const noSpaces = cleanKey.replace(/[^a-z0-9]/g, '');

      const itemObj: CatalogItem = {
        item_id: c.item_id || `item_${(cleanKey || lower).replace(/\s+/g, '_')}`,
        name: rawName,
        rate: Number(c.rate) || 0,
        description: c.description || '',
        status: 'active',
      };

      if (!map.has(lower)) map.set(lower, itemObj);
      if (cleanKey && !map.has(cleanKey)) map.set(cleanKey, itemObj);
      if (noPunct && !map.has(noPunct)) map.set(noPunct, itemObj);
      if (singular && !map.has(singular)) map.set(singular, itemObj);
      if (noSpaces && !map.has(noSpaces)) map.set(noSpaces, itemObj);
      if (c.item_id && !map.has(String(c.item_id))) map.set(String(c.item_id), itemObj);
    });
    return map;
  }, [effectiveCatalogItems]);

  const isTxUnmappedCatalog = useCallback(
    (tx: any): boolean => {
      // 1. If line item already has a linked Zoho accounting reference or item ID, it is cataloged
      if (tx?.accounting_ref_id) return false;
      if (tx?.zoho_item_id) return false;
      if (tx?.metadata_json?.zoho_item_id) return false;
      if (tx?.metadata_json?.catalog_status === 'cataloged') return false;

      // If catalog items are not loaded, do not falsely flag items as uncataloged
      if (effectiveCatalogItems.length === 0) return false;

      const raw = (tx?.item_or_description || '').trim();
      if (!raw) return false;

      const lower = raw.toLowerCase();
      const cleanKey = lower.replace(/^[:;\s\-•.]+/, '').trim();
      const noPunct = cleanKey.replace(/[,\-_/\\()]/g, ' ').replace(/\s+/g, ' ').trim();
      const singular = cleanKey.replace(/\b([a-z]+)s\b/g, '$1');
      const noSpaces = cleanKey.replace(/[^a-z0-9]/g, '');

      // 2. Direct map lookup
      if (
        officialZohoItemMap.has(lower) ||
        officialZohoItemMap.has(cleanKey) ||
        officialZohoItemMap.has(noPunct) ||
        officialZohoItemMap.has(singular) ||
        officialZohoItemMap.has(noSpaces)
      ) {
        return false;
      }

      // 3. Client custom item mappings configured in settings
      const customItemMappings =
        currentClient?.custom_config?.item_mappings ||
        (currentClient as any)?.customConfig?.item_mappings ||
        {};
      if (
        customItemMappings[raw] ||
        customItemMappings[cleanKey] ||
        customItemMappings[lower] ||
        customItemMappings[noPunct] ||
        customItemMappings[singular] ||
        customItemMappings[noSpaces]
      ) {
        return false;
      }

      // 4. Catalog iteration: substring, word token matching, and similarity
      const wordsTx = cleanKey.split(/\s+/).filter((w: string) => w.length > 1);

      for (const catItem of effectiveCatalogItems) {
        if (catItem.status && catItem.status.toLowerCase() !== 'active') continue;
        const catName = (catItem.name || '').trim().toLowerCase();
        if (!catName) continue;
        const catClean = catName.replace(/^[:;\s\-•.]+/, '').trim();
        const catNoPunct = catClean.replace(/[,\-_/\\()]/g, ' ').replace(/\s+/g, ' ').trim();
        const catSingular = catClean.replace(/\b([a-z]+)s\b/g, '$1');
        const catNoSpaces = catClean.replace(/[^a-z0-9]/g, '');

        // Normalized string matches
        if (
          catName === lower ||
          catClean === cleanKey ||
          catNoPunct === noPunct ||
          catSingular === singular ||
          catNoSpaces === noSpaces
        ) {
          return false;
        }

        // Substring inclusion (matching backend zoho.find_item_by_name)
        if (catClean.includes(cleanKey) || cleanKey.includes(catClean)) return false;
        if (catNoPunct.includes(noPunct) || noPunct.includes(catNoPunct)) return false;
        if (catSingular && singular && (catSingular.includes(singular) || singular.includes(catSingular))) return false;
        if (catNoSpaces && noSpaces && (catNoSpaces.includes(noSpaces) || noSpaces.includes(catNoSpaces))) return false;

        // Word token overlap
        const wordsCat = catClean.split(/\s+/).filter((w) => w.length > 1);
        if (wordsTx.length > 0 && wordsCat.length > 0) {
          // If all words of catalog item are present in transaction name (e.g. "Bath Towel" in "Bath Towel Large")
          if (wordsCat.every((cw: string) => wordsTx.some((w: string) => w.includes(cw) || cw.includes(w)))) return false;
          // Or if all words of transaction name are in catalog item (e.g. "Duvet Cover" in "Duvet Cover (King)")
          if (wordsTx.every((w: string) => wordsCat.some((cw: string) => cw.includes(w) || w.includes(cw)))) return false;
          // Substantial word overlap (at least 2 matching words)
          const matchedWords = wordsTx.filter((w: string) => wordsCat.some((cw: string) => cw === w || (cw.length > 3 && (cw.includes(w) || w.includes(cw)))));
          if (matchedWords.length >= 2) return false;
        }

        // Fuzzy similarity match (>= 0.70, matching backend zoho.find_item_by_name SequenceMatcher)
        if (stringSimilarity(cleanKey, catClean) >= 0.70 || stringSimilarity(noPunct, catNoPunct) >= 0.70) {
          return false;
        }
      }

      return true;
    },
    [effectiveCatalogItems, officialZohoItemMap, currentClient?.custom_config]
  );

  const zohoMasterItems = useMemo(() => {
    // Start with active items from Zoho Books Item Master
    const map = new Map<string, CatalogItem>();
    effectiveCatalogItems.forEach((c: any) => {
      if (c.status && c.status.toLowerCase() !== 'active') return;
      const key = (c.name || '').trim().toLowerCase();
      if (key && !map.has(key)) {
        map.set(key, {
          item_id: c.item_id || `item_${key.replace(/\s+/g, '_')}`,
          name: c.name,
          rate: Number(c.rate) || 0,
          description: c.description || '',
          status: 'active',
        });
      }
    });

    // Items from transactions that do not exist within the main catalog
    // are assigned an item ID with the predictable 'staged_' prefix
    transactions.forEach((tx: any) => {
      const rawName = (tx.item_or_description || '').trim();
      const cleanName = rawName.replace(/^[:;\s\-•.]+/, '').trim();
      const cleanKey = cleanName.toLowerCase();
      const rawKey = rawName.toLowerCase();
      if (cleanKey && !map.has(cleanKey) && !map.has(rawKey)) {
        map.set(cleanKey, {
          item_id: `staged_${cleanKey.replace(/\s+/g, '_')}`,
          name: cleanName || rawName,
          rate: Number(tx.rate_or_price) || 0,
          description: `${currentClient?.name || 'Client'} Staged Item`,
          status: 'active',
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [effectiveCatalogItems, transactions, currentClient?.name]);

  const dailyCounts = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let discrepancy = 0;
    let invoiced = 0;
    let unreviewed = 0;
    let unapproved = 0;
    let lowConfidence = 0;
    let unmappedItems = 0;
    const unmappedSlipsSet = new Set<string>();
    const unmappedNamesSet = new Set<string>();

    const targetTx = dailyPropertyFilter === 'ALL'
      ? arStagedTx
      : arStagedTx.filter((t) => extractPropertyName(t.source_file_name, t.metadata_json) === dailyPropertyFilter);

    targetTx.forEach((tx) => {
      if (tx.status === 'INVOICED') invoiced++;
      else if (tx.approved) approved++;
      else pending++;

      if (!tx.reviewed) unreviewed++;
      if (!tx.approved && tx.status !== 'INVOICED') unapproved++;
      if (isItemLowConf(tx)) lowConfidence++;

      if (isTxUnmappedCatalog(tx)) {
        unmappedItems++;
        const slipKey = tx.source_file_name || `slip-${tx.transaction_date || tx.id}`;
        unmappedSlipsSet.add(slipKey);
        const rawName = (tx.item_or_description || '').trim();
        const cleanName = rawName.replace(/^[:;\s\-•.]+/, '').trim();
        const finalName = cleanName || rawName;
        if (finalName) unmappedNamesSet.add(finalName);
      }

      if ((tx.discrepancy_amount || 0) > 0) {
        discrepancy++;
      }
    });

    return {
      all: targetTx.length,
      totalAcrossAllClients: arStagedTx.length,
      pending,
      approved,
      discrepancy,
      invoiced,
      unreviewed,
      unapproved,
      lowConfidence,
      unmappedItems,
      unmappedSlips: unmappedSlipsSet.size,
      distinctUnmappedNames: unmappedNamesSet.size,
    };
  }, [arStagedTx, dailyPropertyFilter, isTxUnmappedCatalog]);

  const currentPropertyMetrics = useMemo(() => {
    const isAll = dailyPropertyFilter === 'ALL';
    const targetTx = isAll
      ? arStagedTx
      : arStagedTx.filter((t) => extractPropertyName(t.source_file_name, t.metadata_json) === dailyPropertyFilter);

    const slipMap = new Map<string, { isApproved: boolean }>();
    targetTx.forEach((tx) => {
      const key = tx.source_file_name || `slip-${tx.transaction_date || tx.id}`;
      if (!slipMap.has(key)) {
        slipMap.set(key, { isApproved: true });
      }
      if (!tx.approved && tx.status !== 'INVOICED') {
        slipMap.get(key)!.isApproved = false;
      }
    });

    const ledgerSlipsCount = slipMap.size;
    const ledgerItemsCount = targetTx.length;
    let ledgerApprovedSlips = 0;
    slipMap.forEach((v) => {
      if (v.isApproved) ledgerApprovedSlips++;
    });
    const ledgerPendingSlips = ledgerSlipsCount - ledgerApprovedSlips;

    // Merge with remote metrics if available
    const remote = sourceMetricsData?.metrics;
    const remoteProp = !isAll && sourceMetricsData?.properties ? sourceMetricsData.properties[dailyPropertyFilter] : remote;

    const sourceTotal = remoteProp?.source_total_slips ?? remote?.source_total_slips ?? ledgerSlipsCount;
    const sourceUnprocessed = remoteProp?.source_unprocessed_slips ?? remote?.source_unprocessed_slips ?? 0;
    const sourceProcessed = remoteProp?.source_processed_slips ?? remote?.source_processed_slips ?? ledgerSlipsCount;

    return {
      propertyName: dailyPropertyFilter,
      sourceTotal: Math.max(sourceTotal, ledgerSlipsCount),
      sourceUnprocessed,
      sourceProcessed: Math.max(sourceProcessed, ledgerSlipsCount),
      ledgerSlipsCount,
      ledgerItemsCount,
      ledgerApprovedSlips,
      ledgerPendingSlips,
      isFullyProcessed: sourceUnprocessed === 0,
    };
  }, [dailyPropertyFilter, arStagedTx, sourceMetricsData]);

  const filteredArStagedTx = useMemo(() => {
    return arStagedTx.filter((t) => {
      // 1. Status Filter
      if (dailyStatusFilter === 'UNREVIEWED' && t.reviewed) return false;
      if (dailyStatusFilter === 'UNAPPROVED' && (t.approved || t.status === 'INVOICED')) return false;
      if (dailyStatusFilter === 'LOW_CONFIDENCE' && !isItemLowConf(t)) return false;
      if (dailyStatusFilter === 'PENDING' && (t.approved || t.status === 'INVOICED')) return false;
      if (dailyStatusFilter === 'APPROVED' && (!t.approved || t.status === 'INVOICED')) return false;
      if (dailyStatusFilter === 'DISCREPANCY' && (t.discrepancy_amount || 0) <= 0) return false;
      if (dailyStatusFilter === 'INVOICED' && t.status !== 'INVOICED') return false;
      if (dailyStatusFilter === 'UNMAPPED' && !isTxUnmappedCatalog(t)) return false;

      // 2. Property Filter
      if (dailyPropertyFilter !== 'ALL') {
        const prop = extractPropertyName(t.source_file_name, t.metadata_json);
        if (prop !== dailyPropertyFilter) return false;
      }

      // 3. Search Query
      if (!query) return true;
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
  }, [arStagedTx, dailyStatusFilter, dailyPropertyFilter, query, isTxUnmappedCatalog]);

  const handleDailySort = (field: string) => {
    if (dailySortField === field) {
      setDailySortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setDailySortField(field);
      setDailySortDirection(
        field === 'transaction_date' || field === 'item_or_description' || field === 'source_file_name'
          ? 'asc'
          : 'desc'
      );
    }
  };

  const sortedArStagedTx = useMemo(() => {
    const list = [...filteredArStagedTx];
    return list.sort((a, b) => {
      let aVal: any = a[dailySortField];
      let bVal: any = b[dailySortField];

      if (dailySortField === 'pickQty') {
        aVal = a.credit_amount || a.quantity_or_debit || 0;
        bVal = b.credit_amount || b.quantity_or_debit || 0;
      } else if (dailySortField === 'delivQty') {
        aVal = a.quantity_or_debit || 0;
        bVal = b.quantity_or_debit || 0;
      } else if (dailySortField === 'discrepancy_amount') {
        aVal = a.discrepancy_amount || 0;
        bVal = b.discrepancy_amount || 0;
      } else if (dailySortField === 'rate_or_price') {
        aVal = a.rate_or_price || 0;
        bVal = b.rate_or_price || 0;
      } else if (dailySortField === 'total_amount') {
        aVal = a.total_amount || 0;
        bVal = b.total_amount || 0;
      } else if (dailySortField === 'status') {
        aVal = a.status === 'INVOICED' ? 3 : a.approved ? 2 : 1;
        bVal = b.status === 'INVOICED' ? 3 : b.approved ? 2 : 1;
      }

      if (aVal == null) aVal = '';
      if (bVal == null) bVal = '';

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return dailySortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const strA = String(aVal).toLowerCase();
      const strB = String(bVal).toLowerCase();
      return dailySortDirection === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
    });
  }, [filteredArStagedTx, dailySortField, dailySortDirection]);

  const totalDailyCount = sortedArStagedTx.length;
  const totalDailyPages = dailyPageSize === 'all' ? 1 : Math.ceil(totalDailyCount / Number(dailyPageSize)) || 1;

  useEffect(() => {
    setDailyCurrentPage(1);
    setGroupedCurrentPage(1);
  }, [search, dailyStatusFilter, dailyPropertyFilter, dailyPageSize, groupedPageSize]);

  const paginatedArStagedTx = useMemo(() => {
    if (dailyPageSize === 'all') return sortedArStagedTx;
    const start = (dailyCurrentPage - 1) * Number(dailyPageSize);
    return sortedArStagedTx.slice(start, start + Number(dailyPageSize));
  }, [sortedArStagedTx, dailyCurrentPage, dailyPageSize]);

  const groupedSlips = useMemo<SlipGroup[]>(() => {
    const map = new Map<string, SlipGroup>();

    filteredArStagedTx.forEach((tx) => {
      const key = tx.source_file_name || `slip-${tx.transaction_date || 'unknown'}`;
      let group = map.get(key);
      if (!group) {
        const prop = extractPropertyName(tx.source_file_name, tx.metadata_json) || currentClient?.name || 'Slip';
        const driveUrl = tx.metadata_json?.drive_file_url ||
          (tx.source_identifier ? `https://drive.google.com/file/d/${tx.source_identifier}/view` : null);
        group = {
          slipKey: key,
          sourceFileName: tx.source_file_name || 'Slip Document',
          propertyName: prop,
          slipDate: tx.transaction_date || '-',
          driveUrl,
          items: [],
          txIds: [],
          totalPickQty: 0,
          totalDelivQty: 0,
          totalLossQty: 0,
          totalAmount: 0,
          isFullyApproved: true,
          isPartiallyApproved: false,
          isFullyReviewed: true,
          hasLowConfidence: false,
          hasUnmappedItem: false,
          unmappedItemsCount: 0,
          minConfidence: 1.0,
          status: 'PENDING',
        };
        map.set(key, group);
      }

      group.items.push(tx);
      group.txIds.push(tx.id);
      group.totalPickQty += (tx.credit_amount || tx.quantity_or_debit || 0);
      group.totalDelivQty += (tx.quantity_or_debit || 0);
      group.totalLossQty += (tx.discrepancy_amount || 0);
      group.totalAmount += (tx.total_amount || 0);
      if (!tx.approved) group.isFullyApproved = false;
      if (tx.approved) group.isPartiallyApproved = true;
      if (!tx.reviewed) group.isFullyReviewed = false;
      if (isItemLowConf(tx)) group.hasLowConfidence = true;
      if (isTxUnmappedCatalog(tx)) {
        group.hasUnmappedItem = true;
        group.unmappedItemsCount = (group.unmappedItemsCount || 0) + 1;
      }
      const conf = typeof tx.confidence_score === 'number' ? tx.confidence_score : 1.0;
      if (conf < group.minConfidence) group.minConfidence = conf;
    });

    const list = Array.from(map.values());
    const customerMappings = currentClient?.custom_config?.customer_mappings || {};
    list.forEach((g) => {
      const allInvoiced = g.items.every((i) => i.status === 'INVOICED');
      if (allInvoiced) g.status = 'INVOICED';
      else if (g.isFullyApproved) g.status = 'APPROVED';
      else g.status = 'PENDING';

      const directItem = g.items.find((i) => i.metadata_json?.zoho_contact_id);
      const directContactId = directItem?.metadata_json?.zoho_contact_id;
      const directContactName = directItem?.metadata_json?.customer_name;

      const pLower = g.propertyName.toLowerCase();
      const mappedEntryKey = Object.keys(customerMappings).find((k) => k.toLowerCase() === pLower);
      const mappedEntry = customerMappings[g.propertyName] || (mappedEntryKey ? customerMappings[mappedEntryKey] : undefined);
      const matchedContact = clientContacts.find((c: any) => {
        const cn = (c.contact_name || '').toLowerCase();
        const co = (c.company_name || '').toLowerCase();
        return cn === pLower || co === pLower || (pLower.length > 2 && (cn.includes(pLower) || co.includes(pLower)));
      });

      const effectiveContactId = directContactId || mappedEntry?.zoho_contact_id || matchedContact?.contact_id;
      const effectiveContactName = mappedEntry?.name || directContactName || matchedContact?.contact_name;

      g.isCustomerReconciled = Boolean(effectiveContactId);
      g.reconciledContactId = effectiveContactId;
      g.reconciledContactName = effectiveContactName;
    });

    list.sort((a, b) => {
      if (groupedSortBy === 'date_desc') {
        const diff = (b.slipDate || '').localeCompare(a.slipDate || '');
        return diff !== 0 ? diff : a.sourceFileName.localeCompare(b.sourceFileName);
      }
      if (groupedSortBy === 'date_asc') {
        const diff = (a.slipDate || '').localeCompare(b.slipDate || '');
        return diff !== 0 ? diff : a.sourceFileName.localeCompare(b.sourceFileName);
      }
      if (groupedSortBy === 'cust_asc') {
        const diff = (a.propertyName || '').localeCompare(b.propertyName || '');
        return diff !== 0 ? diff : (b.slipDate || '').localeCompare(a.slipDate || '');
      }
      if (groupedSortBy === 'cust_desc') {
        const diff = (b.propertyName || '').localeCompare(a.propertyName || '');
        return diff !== 0 ? diff : (b.slipDate || '').localeCompare(a.slipDate || '');
      }
      if (groupedSortBy === 'amount_desc') {
        return b.totalAmount - a.totalAmount;
      }
      if (groupedSortBy === 'amount_asc') {
        return a.totalAmount - b.totalAmount;
      }
      if (groupedSortBy === 'count_desc') {
        return b.items.length - a.items.length;
      }
      if (groupedSortBy === 'low_conf_first') {
        if (a.hasLowConfidence !== b.hasLowConfidence) {
          return a.hasLowConfidence ? -1 : 1;
        }
        return (b.slipDate || '').localeCompare(a.slipDate || '');
      }
      if (groupedSortBy === 'unreviewed_first') {
        if (a.isFullyReviewed !== b.isFullyReviewed) {
          return !a.isFullyReviewed ? -1 : 1;
        }
        return (b.slipDate || '').localeCompare(a.slipDate || '');
      }
      if (groupedSortBy === 'unapproved_first') {
        if (a.isFullyApproved !== b.isFullyApproved) {
          return !a.isFullyApproved ? -1 : 1;
        }
        return (b.slipDate || '').localeCompare(a.slipDate || '');
      }
      return (b.slipDate || '').localeCompare(a.slipDate || '');
    });

    return list;
  }, [filteredArStagedTx, currentClient, groupedSortBy, isTxUnmappedCatalog]);

  interface MissingPeriod {
    key: string;
    label: string;
    defaultDate: string;
  }

  const computeMissingGapsForTx = (
    txList: any[],
    cadence: 'daily' | 'weekly' | 'fortnightly' | 'monthly' | 'disabled',
    month: string,
    year: string | number
  ): MissingPeriod[] => {
    if (cadence === 'disabled') return [];
    if (!month || !year) return [];
    const monthIdx = MONTHS.indexOf(month);
    if (monthIdx === -1) return [];

    const yearNum = Number(year);
    const daysInMonth = new Date(yearNum, monthIdx + 1, 0).getDate();
    const today = new Date();
    const isCurrentMonthYear = today.getFullYear() === yearNum && today.getMonth() === monthIdx;
    const maxDay = isCurrentMonthYear ? today.getDate() : daysInMonth;

    const presentDates = new Set(
      txList.map((t) => t.transaction_date).filter(Boolean)
    );

    const gaps: MissingPeriod[] = [];

    if (cadence === 'daily') {
      for (let d = 1; d <= maxDay; d++) {
        const dStr = String(d).padStart(2, '0');
        const mStr = String(monthIdx + 1).padStart(2, '0');
        const fullDate = `${yearNum}-${mStr}-${dStr}`;
        if (!presentDates.has(fullDate)) {
          const shortName = `${month.slice(0, 3)} ${dStr}`;
          gaps.push({ key: fullDate, label: shortName, defaultDate: fullDate });
        }
      }
    } else if (cadence === 'weekly') {
      const weeks = [
        { name: 'Week 1', start: 1, end: 7 },
        { name: 'Week 2', start: 8, end: 14 },
        { name: 'Week 3', start: 15, end: 21 },
        { name: 'Week 4', start: 22, end: 28 },
        { name: 'Week 5', start: 29, end: daysInMonth },
      ];
      weeks.forEach((w) => {
        if (w.start <= maxDay) {
          const endDay = Math.min(w.end, maxDay);
          let hasSlip = false;
          for (let d = w.start; d <= endDay; d++) {
            const dStr = String(d).padStart(2, '0');
            const mStr = String(monthIdx + 1).padStart(2, '0');
            if (presentDates.has(`${yearNum}-${mStr}-${dStr}`)) {
              hasSlip = true;
              break;
            }
          }
          if (!hasSlip) {
            const mStr = String(monthIdx + 1).padStart(2, '0');
            const midDay = String(Math.min(w.start, maxDay)).padStart(2, '0');
            gaps.push({
              key: `${yearNum}-${mStr}-w${w.name}`,
              label: `${w.name} (${month.slice(0, 3)} ${w.start}-${endDay})`,
              defaultDate: `${yearNum}-${mStr}-${midDay}`,
            });
          }
        }
      });
    } else if (cadence === 'fortnightly') {
      const fn1End = Math.min(14, maxDay);
      let fn1HasSlip = false;
      for (let d = 1; d <= fn1End; d++) {
        const dStr = String(d).padStart(2, '0');
        const mStr = String(monthIdx + 1).padStart(2, '0');
        if (presentDates.has(`${yearNum}-${mStr}-${dStr}`)) {
          fn1HasSlip = true;
          break;
        }
      }
      const mStr = String(monthIdx + 1).padStart(2, '0');
      if (!fn1HasSlip) {
        gaps.push({
          key: `${yearNum}-${mStr}-fn1`,
          label: `1st Fortnight (${month.slice(0, 3)} 01-14)`,
          defaultDate: `${yearNum}-${mStr}-01`,
        });
      }
      if (maxDay >= 15) {
        let fn2HasSlip = false;
        for (let d = 15; d <= maxDay; d++) {
          const dStr = String(d).padStart(2, '0');
          if (presentDates.has(`${yearNum}-${mStr}-${dStr}`)) {
            fn2HasSlip = true;
            break;
          }
        }
        if (!fn2HasSlip) {
          gaps.push({
            key: `${yearNum}-${mStr}-fn2`,
            label: `2nd Fortnight (${month.slice(0, 3)} 15-${daysInMonth})`,
            defaultDate: `${yearNum}-${mStr}-15`,
          });
        }
      }
    } else if (cadence === 'monthly') {
      if (presentDates.size === 0) {
        const mStr = String(monthIdx + 1).padStart(2, '0');
        gaps.push({
          key: `${yearNum}-${mStr}-full`,
          label: `${month} ${yearNum}`,
          defaultDate: `${yearNum}-${mStr}-01`,
        });
      }
    }

    return gaps;
  };

  const missingPeriods = useMemo<MissingPeriod[]>(() => {
    const targetTx = dailyPropertyFilter === 'ALL'
      ? arStagedTx
      : arStagedTx.filter((t) => extractPropertyName(t.source_file_name, t.metadata_json) === dailyPropertyFilter);

    return computeMissingGapsForTx(targetTx, missingCadence, selectedMonth, selectedYear);
  }, [missingCadence, selectedMonth, selectedYear, arStagedTx, dailyPropertyFilter]);

  const handleExportMissingPeriodsTxt = () => {
    if (missingCadence === 'disabled') {
      alert('Missing activity detection is currently disabled. Please select a cadence first.');
      return;
    }

    const isFiltered = dailyPropertyFilter !== 'ALL';
    const clientName = currentClient?.name || 'Client';
    let txt = '';

    if (isFiltered) {
      const targetTx = arStagedTx.filter((t) => extractPropertyName(t.source_file_name, t.metadata_json) === dailyPropertyFilter);
      const gaps = computeMissingGapsForTx(targetTx, missingCadence, selectedMonth, selectedYear);

      txt += `Customer: ${dailyPropertyFilter}\n`;
      if (gaps.length === 0) {
        txt += 'No missing dates\n';
      } else {
        gaps.forEach((g) => {
          txt += `${missingCadence === 'daily' ? g.defaultDate : g.label}\n`;
        });
      }
    } else {
      const customersToReport = availableProperties.length > 0
        ? [...availableProperties]
        : Array.from(new Set(arStagedTx.map((t) => extractPropertyName(t.source_file_name, t.metadata_json)).filter(Boolean)));

      if (customersToReport.length === 0) {
        customersToReport.push(clientName);
      }

      customersToReport.forEach((cust, idx) => {
        const custTx = arStagedTx.filter((t) => extractPropertyName(t.source_file_name, t.metadata_json) === cust);
        const gaps = computeMissingGapsForTx(custTx, missingCadence, selectedMonth, selectedYear);

        if (idx > 0) txt += '\n';
        txt += `Customer: ${cust}\n`;
        if (gaps.length === 0) {
          txt += 'No missing dates\n';
        } else {
          gaps.forEach((g) => {
            txt += `${missingCadence === 'daily' ? g.defaultDate : g.label}\n`;
          });
        }
      });
    }

    const safeClient = clientName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeScope = isFiltered ? dailyPropertyFilter.replace(/[^a-zA-Z0-9_-]/g, '_') : 'All_Customers';
    const filename = `Missing_Dates_${safeClient}_${safeScope}_${selectedMonth}_${selectedYear}.txt`;

    downloadTxt(filename, txt);
    addLog('success', `Exported missing dates to ${filename}`);
  };

  const handleExportUncatalogedItemsCsv = () => {
    const isFiltered = dailyPropertyFilter !== 'ALL';
    const clientName = currentClient?.name || 'Client';
    const targetTx = isFiltered
      ? arStagedTx.filter((t) => extractPropertyName(t.source_file_name, t.metadata_json) === dailyPropertyFilter)
      : arStagedTx;

    // Filter to uncataloged line items only
    const uncatalogedTx = targetTx.filter((t) => isTxUnmappedCatalog(t));

    if (uncatalogedTx.length === 0) {
      alert('No uncataloged items found for the current selection.');
      return;
    }

    interface DistinctUncatalogedItem {
      itemName: string;
      occurrences: number;
      slips: Set<string>;
      customers: Set<string>;
      dates: Set<string>;
      totalDelivQty: number;
      totalPickQty: number;
      totalAmount: number;
      rates: number[];
    }

    const itemsMap = new Map<string, DistinctUncatalogedItem>();

    uncatalogedTx.forEach((tx) => {
      const rawName = (tx.item_or_description || '').trim();
      const cleanName = rawName.replace(/^[:;\s\-•.]+/, '').trim();
      const displayName = cleanName || rawName;
      const key = displayName.toLowerCase();
      if (!key) return;

      const cust = extractPropertyName(tx.source_file_name, tx.metadata_json) || clientName;
      const slipDoc = tx.source_file_name || `slip-${tx.transaction_date || tx.id}`;
      const date = tx.transaction_date || '';
      const qty = Number(tx.quantity_or_debit) || 0;
      const pick = Number(tx.credit_amount ?? tx.quantity_or_debit) || 0;
      const rate = Number(tx.rate_or_price) || 0;
      const amt = Number(tx.total_amount) || (qty * rate);

      let entry = itemsMap.get(key);
      if (!entry) {
        entry = {
          itemName: displayName,
          occurrences: 0,
          slips: new Set<string>(),
          customers: new Set<string>(),
          dates: new Set<string>(),
          totalDelivQty: 0,
          totalPickQty: 0,
          totalAmount: 0,
          rates: [],
        };
        itemsMap.set(key, entry);
      }

      entry.occurrences += 1;
      entry.slips.add(slipDoc);
      if (cust) entry.customers.add(cust);
      if (date) entry.dates.add(date);
      entry.totalDelivQty += qty;
      entry.totalPickQty += pick;
      entry.totalAmount += amt;
      if (rate > 0) entry.rates.push(rate);
    });

    const escapeCsv = (val: any): string => {
      if (val == null) return '""';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headers = [
      'Item Name',
      'Occurrences',
      'Slips Count',
      'Total Delivered Qty',
      'Total Picked Qty',
      'Average Rate (GHS)',
      'Total Amount (GHS)',
      'Customers',
      'Dates Seen',
      'Status',
    ];

    const rows: string[] = [headers.join(',')];
    const sortedItems = Array.from(itemsMap.values()).sort((a, b) => a.itemName.localeCompare(b.itemName));

    sortedItems.forEach((it) => {
      const avgRate = it.rates.length > 0 ? (it.rates.reduce((s, r) => s + r, 0) / it.rates.length).toFixed(2) : '0.00';
      const sortedDates = Array.from(it.dates).sort();
      const dateSummary = sortedDates.length > 2
        ? `${sortedDates[0]} to ${sortedDates[sortedDates.length - 1]} (${sortedDates.length} dates)`
        : sortedDates.join(', ');

      const row = [
        escapeCsv(it.itemName),
        it.occurrences,
        it.slips.size,
        it.totalDelivQty,
        it.totalPickQty,
        avgRate,
        it.totalAmount.toFixed(2),
        escapeCsv(Array.from(it.customers).join('; ')),
        escapeCsv(dateSummary),
        'Uncataloged',
      ];
      rows.push(row.join(','));
    });

    const csvContent = rows.join('\r\n');
    const safeClient = clientName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeScope = isFiltered ? dailyPropertyFilter.replace(/[^a-zA-Z0-9_-]/g, '_') : 'All_Customers';
    const filename = `Uncataloged_Items_${safeClient}_${safeScope}_${selectedMonth}_${selectedYear}.csv`;

    downloadCsv(filename, csvContent);
    addLog('success', `Exported ${sortedItems.length} distinct uncataloged items to ${filename}`);
  };

  const handleExportCustomerListingCsv = () => {
    const isFiltered = dailyPropertyFilter !== 'ALL';
    const clientName = currentClient?.name || 'Client';
    const targetTx = filteredArStagedTx.length > 0 ? filteredArStagedTx : arStagedTx;

    if (targetTx.length === 0) {
      alert('No transactions found to export for the current selection.');
      return;
    }

    const escapeCsv = (val: any): string => {
      if (val == null) return '""';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headers = [
      'Customer',
      'Transaction Date',
      'Slip Document',
      'Item Description',
      isCustodyTracking ? 'Delivered Qty' : 'Quantity',
      ...(isCustodyTracking ? ['Picked Up Qty', 'Linen Loss'] : []),
      'Unit Rate (GHS)',
      'Total Amount (GHS)',
      'Review Status',
      'Approval Status',
      'Catalog Status',
      'Source Drive Link',
    ];

    const rows: string[] = [headers.join(',')];

    // Sort by Customer, then Date desc, then Document, then Item
    const sorted = [...targetTx].sort((a, b) => {
      const custA = extractPropertyName(a.source_file_name, a.metadata_json) || clientName;
      const custB = extractPropertyName(b.source_file_name, b.metadata_json) || clientName;
      const custDiff = custA.localeCompare(custB);
      if (custDiff !== 0) return custDiff;

      const dateA = a.transaction_date || '';
      const dateB = b.transaction_date || '';
      const dateDiff = dateB.localeCompare(dateA);
      if (dateDiff !== 0) return dateDiff;

      const fileA = a.source_file_name || '';
      const fileB = b.source_file_name || '';
      const fileDiff = fileA.localeCompare(fileB);
      if (fileDiff !== 0) return fileDiff;

      const descA = a.item_or_description || '';
      const descB = b.item_or_description || '';
      return descA.localeCompare(descB);
    });

    sorted.forEach((tx) => {
      const cust = extractPropertyName(tx.source_file_name, tx.metadata_json) || clientName;
      const rawName = (tx.item_or_description || '').trim();
      const cleanName = rawName.replace(/^[:;\s\-•.]+/, '').trim();
      const displayName = toTitleCase(cleanName || rawName);
      const delivQty = Number(tx.quantity_or_debit) || 0;
      const pickQty = Number(tx.credit_amount ?? tx.quantity_or_debit) || 0;
      const lossQty = Number(tx.discrepancy_amount) || 0;
      const rate = Number(tx.rate_or_price) || 0;
      const amount = Number(tx.total_amount) || (delivQty * rate);
      const reviewStatus = tx.reviewed ? 'Reviewed' : 'Unreviewed';
      const approvalStatus = tx.status === 'INVOICED' ? 'Invoiced' : (tx.approved ? 'Approved' : 'Pending');
      const catalogStatus = isTxUnmappedCatalog(tx) ? 'Uncataloged' : 'Cataloged';
      const driveUrl = tx.metadata_json?.drive_file_url || (tx.source_identifier ? `https://drive.google.com/file/d/${tx.source_identifier}/view` : '');

      const row = [
        escapeCsv(cust),
        escapeCsv(tx.transaction_date || ''),
        escapeCsv(tx.source_file_name || ''),
        escapeCsv(displayName),
        delivQty,
        ...(isCustodyTracking ? [pickQty, lossQty] : []),
        rate.toFixed(2),
        amount.toFixed(2),
        escapeCsv(reviewStatus),
        escapeCsv(approvalStatus),
        escapeCsv(catalogStatus),
        escapeCsv(driveUrl),
      ];
      rows.push(row.join(','));
    });

    const csvContent = rows.join('\r\n');
    const safeClient = clientName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeScope = isFiltered ? dailyPropertyFilter.replace(/[^a-zA-Z0-9_-]/g, '_') : 'All_Customers';
    const filename = `Customer_Listing_${safeClient}_${safeScope}_${selectedMonth}_${selectedYear}.csv`;

    downloadCsv(filename, csvContent);
    addLog('success', `Exported ${sorted.length} transactions to ${filename}`);
  };

  const handleExportMonthlySummaryCsv = () => {
    if (!sortedSummaryRows || sortedSummaryRows.length === 0) {
      alert('No monthly summary data to export.');
      return;
    }

    const isFiltered = dailyPropertyFilter !== 'ALL';
    const clientName = currentClient?.name || 'Client';
    const safeClient = clientName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeScope = isFiltered ? dailyPropertyFilter.replace(/[^a-zA-Z0-9_-]/g, '_') : 'All_Customers';

    const escapeCsv = (val: any): string => {
      if (val == null) return '""';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headers = [
      ...(isFiltered ? ['Customer'] : []),
      'Standard Item Name',
      ...(isCustodyTracking ? ['Total Picked Up', 'Total Delivered', 'Linen Loss Discrepancy'] : ['Total Quantity']),
      'Unit Rate (GHS)',
      'Total Billed (GHS)',
      isCustodyTracking ? 'Slips Count' : 'Documents Count',
      'Reviewed',
      'Approved',
      'Status',
    ];

    const rows: string[] = [headers.join(',')];

    sortedSummaryRows.forEach((row) => {
      const r = [
        ...(isFiltered ? [escapeCsv(dailyPropertyFilter)] : []),
        escapeCsv(toTitleCase(row.item_name)),
        ...(isCustodyTracking
          ? [row.total_picked_up || 0, row.total_delivered || 0, row.linen_discrepancy || 0]
          : [row.total_delivered || 0]),
        Number(row.unit_rate ?? row.unit_price ?? 0).toFixed(2),
        Number(row.total_billed || 0).toFixed(2),
        row.slips_count || 0,
        row.is_fully_reviewed ? 'Yes' : 'No',
        row.is_fully_approved ? 'Yes' : 'No',
        escapeCsv(row.is_fully_approved ? 'Approved' : 'Pending'),
      ];
      rows.push(r.join(','));
    });

    const csvContent = rows.join('\r\n');
    const filename = `Monthly_Summary_${safeClient}_${safeScope}_${selectedMonth}_${selectedYear}.csv`;

    downloadCsv(filename, csvContent);
    addLog('success', `Exported monthly summary (${isFiltered ? dailyPropertyFilter : 'All Customers'}) to ${filename}`);
  };

  const handleExportZohoInvoiceImportCsv = () => {
    const isFiltered = dailyPropertyFilter !== 'ALL';
    const clientName = currentClient?.name || 'Client';
    const targetTx = isFiltered
      ? arStagedTx.filter((t) => extractPropertyName(t.source_file_name, t.metadata_json) === dailyPropertyFilter)
      : arStagedTx;

    if (targetTx.length === 0) {
      alert('No transactions found to export for Zoho Books import.');
      return;
    }

    const approvedTx = targetTx.filter((t) => t.approved || t.status === 'INVOICED');
    const txToExport = approvedTx.length > 0 ? approvedTx : targetTx;

    // Aggregate by Customer -> Item Name -> Unit Rate
    type AggItem = {
      customer: string;
      itemName: string;
      unitRate: number;
      quantity: number;
      totalAmount: number;
    };

    const aggMap = new Map<string, AggItem>();

    txToExport.forEach((tx) => {
      const cust = extractPropertyName(tx.source_file_name, tx.metadata_json) || clientName;
      const rawName = (tx.item_or_description || '').trim();
      const cleanName = rawName.replace(/^[:;\s\-•.]+/, '').trim();
      const itemName = toTitleCase(cleanName || rawName);
      const delivQty = Number(tx.quantity_or_debit) || 0;
      const rate = Number(tx.rate_or_price) || 0;
      const amount = Number(tx.total_amount) || (delivQty * rate);

      const key = `${cust}:::${itemName}:::${rate.toFixed(2)}`;
      const existing = aggMap.get(key);
      if (existing) {
        existing.quantity += delivQty;
        existing.totalAmount += amount;
      } else {
        aggMap.set(key, {
          customer: cust,
          itemName,
          unitRate: rate,
          quantity: delivQty,
          totalAmount: amount,
        });
      }
    });

    const escapeCsv = (val: any): string => {
      if (val == null) return '""';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return `"${str}"`;
    };

    // Group items by customer
    const custMap = new Map<string, AggItem[]>();
    for (const item of aggMap.values()) {
      if (!custMap.has(item.customer)) {
        custMap.set(item.customer, []);
      }
      custMap.get(item.customer)!.push(item);
    }

    const sortedCustomers = Array.from(custMap.keys()).sort((a, b) => a.localeCompare(b));

    const y = Number(selectedYear);
    const m = Number(selectedMonth);
    const lastDayOfMonth = new Date(y, m, 0).getDate();
    const invoiceDateStr = `${y}-${String(m).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`;
    const dueDateObj = new Date(y, m - 1, lastDayOfMonth + 14);
    const dueDateStr = `${dueDateObj.getFullYear()}-${String(dueDateObj.getMonth() + 1).padStart(2, '0')}-${String(dueDateObj.getDate()).padStart(2, '0')}`;
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthName = monthNames[m - 1] || `Month ${m}`;

    const headers = [
      'Invoice Date', 'Invoice Number', 'Estimate Number', 'Invoice Status', 'Customer Name',
      'Is Tracked For MOSS', 'Due Date', 'Expected Payment Date', 'PurchaseOrder', 'Template Name',
      'Currency Code', 'Exchange Rate', 'Item Name', 'SKU', 'Item Desc',
      'Quantity', 'Item Price', 'Usage unit', 'Discount', 'Expense Reference ID',
      'Is Inclusive Tax', 'Discount Amount', 'Item Tax1', 'Item Tax1 Type', 'Item Tax1 %',
      'Project Name', 'Notes', 'Terms & Conditions', 'PayPal', 'Authorize.Net',
      'Payflow Pro', 'Stripe', '2Checkout', 'Braintree', 'Forte',
      'WorldPay', 'Payments Pro', 'Square', 'WePay', 'GoCardless',
      'Partial Payments', 'Sales person', 'Shipping Charge', 'Adjustment', 'Adjustment Description',
      'Discount Type', 'Is Discount Before Tax', 'Entity Discount Percent', 'Entity Discount Amount', 'Payment Terms',
      'Payment Terms Label', 'Is Digital Service', 'Branch Name', 'Warehouse Name', 'CF.Transporter_Name'
    ];

    const rows: string[] = [headers.map((h) => `"${h}"`).join(',')];

    sortedCustomers.forEach((cust, custIdx) => {
      const invNum = `INV-${y}${String(m).padStart(2, '0')}-${String(custIdx + 1).padStart(3, '0')}`;
      const items = custMap.get(cust) || [];
      items.sort((a, b) => a.itemName.localeCompare(b.itemName) || a.unitRate - b.unitRate);

      items.forEach((item) => {
        const qtyStr = Number.isInteger(item.quantity) ? String(item.quantity) : item.quantity.toFixed(2);
        const rateStr = item.unitRate.toFixed(2);
        const noteStr = `Commercial Laundry Service Billing for ${cust} (${monthName} ${y})`;

        const row = [
          escapeCsv(invoiceDateStr),
          escapeCsv(invNum),
          '""', // Estimate Number
          escapeCsv('Draft'),
          escapeCsv(cust),
          '""', // Is Tracked For MOSS
          escapeCsv(dueDateStr),
          '""', // Expected Payment Date
          '""', // PurchaseOrder
          '""', // Template Name
          escapeCsv('GHS'),
          escapeCsv('1'),
          escapeCsv(item.itemName),
          '""', // SKU
          '""', // Item Desc strictly empty
          escapeCsv(qtyStr),
          escapeCsv(rateStr),
          '""', // Usage unit
          escapeCsv('0'), // Discount
          '""', // Expense Reference ID
          '""', // Is Inclusive Tax
          '""', // Discount Amount
          '""', // Item Tax1
          '""', // Item Tax1 Type
          '""', // Item Tax1 %
          '""', // Project Name
          escapeCsv(noteStr),
          '""', // Terms & Conditions
          '""', // PayPal
          '""', // Authorize.Net
          '""', // Payflow Pro
          '""', // Stripe
          '""', // 2Checkout
          '""', // Braintree
          '""', // Forte
          '""', // WorldPay
          '""', // Payments Pro
          '""', // Square
          '""', // WePay
          '""', // GoCardless
          '""', // Partial Payments
          '""', // Sales person
          '""', // Shipping Charge
          '""', // Adjustment
          '""', // Adjustment Description
          '""', // Discount Type
          '""', // Is Discount Before Tax
          '""', // Entity Discount Percent
          '""', // Entity Discount Amount
          '""', // Payment Terms
          '""', // Payment Terms Label
          '""', // Is Digital Service
          '""', // Branch Name
          '""', // Warehouse Name
          '""'  // CF.Transporter_Name
        ];
        rows.push(row.join(','));
      });
    });

    const csvContent = rows.join('\r\n');
    const safeClient = clientName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeScope = isFiltered ? dailyPropertyFilter.replace(/[^a-zA-Z0-9_-]/g, '_') : 'All_Customers';
    const filename = `Zoho_Invoice_Import_${safeClient}_${safeScope}_${selectedMonth}_${selectedYear}.csv`;

    downloadCsv(filename, csvContent);
    addLog('success', `Exported Zoho Books import file (${rows.length - 1} line items across ${sortedCustomers.length} invoices) to ${filename}`);
  };

  // Slip-level KPI counts for the active Customer filter
  const slipKpis = useMemo(() => {
    const targetTx = dailyPropertyFilter === 'ALL'
      ? arStagedTx
      : arStagedTx.filter((t) => extractPropertyName(t.source_file_name, t.metadata_json) === dailyPropertyFilter);

    const slipMap = new Map<string, { isFullyReviewed: boolean; isFullyApproved: boolean; hasLowConf: boolean; hasUnmapped: boolean }>();
    let totalUnmappedItems = 0;
    const distinctUnmappedNamesSet = new Set<string>();

    targetTx.forEach((tx) => {
      const key = tx.source_file_name || `slip-${tx.transaction_date || tx.id}`;
      let cur = slipMap.get(key);
      if (!cur) {
        cur = { isFullyReviewed: true, isFullyApproved: true, hasLowConf: false, hasUnmapped: false };
        slipMap.set(key, cur);
      }
      if (!tx.reviewed) cur.isFullyReviewed = false;
      if (!tx.approved && tx.status !== 'INVOICED') cur.isFullyApproved = false;
      if (isItemLowConf(tx)) cur.hasLowConf = true;
      if (isTxUnmappedCatalog(tx)) {
        cur.hasUnmapped = true;
        totalUnmappedItems++;
        const name = (tx.item_or_description || '').replace(/^[:;\s\-•.]+/, '').trim();
        if (name) distinctUnmappedNamesSet.add(name);
      }
    });

    let unreviewed = 0;
    let unapproved = 0;
    let lowConf = 0;
    let unmappedSlips = 0;
    slipMap.forEach((v) => {
      if (!v.isFullyReviewed) unreviewed++;
      if (!v.isFullyApproved) unapproved++;
      if (v.hasLowConf) lowConf++;
      if (v.hasUnmapped) unmappedSlips++;
    });

    return {
      totalSlips: slipMap.size,
      unreviewedSlips: unreviewed,
      unapprovedSlips: unapproved,
      lowConfidenceSlips: lowConf,
      unmappedSlips,
      unmappedItems: totalUnmappedItems,
      distinctUnmappedNames: distinctUnmappedNamesSet.size,
      missingPeriodsCount: missingPeriods.length,
    };
  }, [arStagedTx, dailyPropertyFilter, missingPeriods.length, isTxUnmappedCatalog]);

  const totalGroupedCount = groupedSlips.length;
  const totalGroupedPages = groupedPageSize === 'all' ? 1 : Math.ceil(totalGroupedCount / Number(groupedPageSize)) || 1;

  const paginatedGroupedSlips = useMemo(() => {
    if (groupedPageSize === 'all') return groupedSlips;
    const start = (groupedCurrentPage - 1) * Number(groupedPageSize);
    return groupedSlips.slice(start, start + Number(groupedPageSize));
  }, [groupedSlips, groupedCurrentPage, groupedPageSize]);

  const isSlipExpanded = (key: string) => {
    return expandedSlips[key] !== undefined ? expandedSlips[key] : true;
  };

  const toggleSlipExpanded = (key: string) => {
    setExpandedSlips((prev) => ({
      ...prev,
      [key]: !isSlipExpanded(key),
    }));
  };

  const handleExpandAll = () => {
    const next: Record<string, boolean> = {};
    groupedSlips.forEach((s) => {
      next[s.slipKey] = true;
    });
    setExpandedSlips(next);
  };

  const handleCollapseAll = () => {
    const next: Record<string, boolean> = {};
    groupedSlips.forEach((s) => {
      next[s.slipKey] = false;
    });
    setExpandedSlips(next);
  };

  const handleToggleSlipApproval = async (slip: SlipGroup) => {
    if (!currentClient?.id || !slip.txIds.length) return;
    const targetApproved = !slip.isFullyApproved;
    setApprovingSlipKey(slip.slipKey);
    try {
      await batchToggleTransactions(currentClient.id, slip.txIds, 'approved', targetApproved);
      if (targetApproved) {
        await batchToggleTransactions(currentClient.id, slip.txIds, 'reviewed', true);
      }
      addLog(
        'success',
        `${targetApproved ? 'Approved' : 'Unapproved'} all ${slip.txIds.length} items for ${slip.sourceFileName}`
      );
      await Promise.all([loadTransactions(), loadSummaryData()]);
    } catch (err: any) {
      addLog('error', `Failed approving slip ${slip.sourceFileName}: ${err.message}`);
    } finally {
      setApprovingSlipKey(null);
    }
  };

  const handleStartEdit = (tx: any) => {
    setEditingTxId(tx.id);
    const desc = (tx.item_or_description || '').trim();
    setEditItemName(desc);
    setEditTxDate(tx.transaction_date || '');
    setEditPickQty(tx.credit_amount ?? tx.quantity_or_debit ?? 0);
    setEditDelivQty(tx.quantity_or_debit ?? 0);
    setEditRate(tx.rate_or_price ?? 0);
    const key = tx.source_file_name || `slip-${tx.transaction_date || 'unknown'}`;
    setExpandedSlips((prev) => ({ ...prev, [key]: true }));
  };

  const handleCancelEdit = () => {
    setEditingTxId(null);
    setEditItemName('');
    setEditTxDate('');
    setEditPickQty('');
    setEditDelivQty('');
    setEditRate('');
  };

  const handleZohoItemSelect = (item: CatalogItem) => {
    setEditItemName(item.name);
    if (item.rate != null && item.rate > 0) {
      setEditRate(item.rate);
    }
  };

  const handleSaveEdit = async (txId: number) => {
    if (!currentClient?.id) return;
    const finalDesc = editItemName.trim();
    if (!finalDesc) {
      addLog('warning', 'Item name cannot be empty. Please select an item from the Zoho Books Item Master.');
      return;
    }

    const isZohoItem = zohoMasterItems.some(
      (z) => z.name.trim().toLowerCase() === finalDesc.toLowerCase()
    );
    if (!isZohoItem && zohoMasterItems.length > 0) {
      addLog(
        'warning',
        `"${finalDesc}" is not in the Zoho Books Item Master. Please search and select an official catalog item.`
      );
      return;
    }

    const pick = Math.max(0, Number(editPickQty) || 0);
    const deliv = Math.max(0, Number(editDelivQty) || 0);
    const rate = Math.max(0, Number(editRate) || 0);
    const total = Math.round(deliv * rate * 100) / 100;
    const loss = Math.max(0, pick - deliv);

    setIsSavingTx(true);
    try {
      await updateClientTransaction(currentClient.id, txId, {
        item_or_description: finalDesc,
        transaction_date: editTxDate.trim() || undefined,
        credit_amount: pick,
        quantity_or_debit: deliv,
        rate_or_price: rate,
        total_amount: total,
        discrepancy_amount: loss,
        reviewed: true,
      });

      addLog(
        'success',
        `Saved changes to "${toTitleCase(finalDesc)}": Picked ${pick}, Deliv ${deliv}, Rate GHS ${rate.toFixed(2)}, Loss ${loss}`
      );
      await Promise.all([loadTransactions(), loadSummaryData()]);
      setEditingTxId(null);
    } catch (err: any) {
      addLog('error', `Failed updating transaction: ${err.message}`);
    } finally {
      setIsSavingTx(false);
    }
  };

  const handleOpenEditSlipDate = (slip: SlipGroup) => {
    setEditingDateSlip(slip);
    setNewSlipDateValue(
      slip.slipDate && slip.slipDate !== '-'
        ? slip.slipDate
        : `${selectedYear}-${String(MONTHS.indexOf(selectedMonth) + 1).padStart(2, '0')}-01`
    );
  };

  const handleSaveSlipDate = async () => {
    if (!currentClient?.id || !editingDateSlip || !newSlipDateValue) return;
    setIsSavingSlipDate(true);
    try {
      const res = await batchUpdateTransactionDate(currentClient.id, {
        transaction_ids: editingDateSlip.txIds,
        new_date: newSlipDateValue,
      });

      const parts = newSlipDateValue.split('-');
      const yNum = parseInt(parts[0], 10);
      const mIdx = parseInt(parts[1], 10) - 1;
      const targetMonth = MONTHS[mIdx] || selectedMonth;
      const targetYear = yNum || selectedYear;

      addLog('success', `Corrected slip date to ${newSlipDateValue} (${res.updated_count} line items updated).`);

      if (targetMonth !== selectedMonth || targetYear !== selectedYear) {
        setSelectedMonth(targetMonth);
        setSelectedYear(targetYear);
        addLog('info', `Switched active ledger view to ${targetMonth} ${targetYear}.`);
      } else {
        await Promise.all([loadTransactions(), loadSummaryData()]);
      }
      setEditingDateSlip(null);
    } catch (err: any) {
      addLog('error', `Failed updating slip date: ${err.message}`);
    } finally {
      setIsSavingSlipDate(false);
    }
  };

  const handleConfirmQuickLinkCustomer = async () => {
    if (!quickLinkCustomerSlip || !quickLinkSelectedContactId || !currentClient?.id) return;
    setIsSavingCustomerLink(true);
    try {
      const selectedContact = clientContacts.find((c: any) => c.contact_id === quickLinkSelectedContactId);
      const wasReconciled = quickLinkCustomerSlip.isCustomerReconciled;
      const res = await saveCustomerMapping(currentClient.id, {
        alias: quickLinkCustomerSlip.propertyName,
        zoho_contact_id: quickLinkSelectedContactId,
        name: selectedContact?.contact_name || quickLinkCustomerSlip.propertyName,
      });

      if (currentClient.custom_config) {
        currentClient.custom_config.customer_mappings = {
          ...(currentClient.custom_config.customer_mappings || {}),
          [quickLinkCustomerSlip.propertyName]: {
            zoho_contact_id: quickLinkSelectedContactId,
            name: selectedContact?.contact_name || quickLinkCustomerSlip.propertyName,
          },
        };
      }

      addLog('success', `${wasReconciled ? 'Re-mapped' : 'Linked'} customer '${quickLinkCustomerSlip.propertyName}' to Zoho contact '${selectedContact?.contact_name || quickLinkSelectedContactId}' (${res.retroactive_staged_updated} slips updated).`);
      setQuickLinkCustomerSlip(null);
      setQuickLinkSelectedContactId('');
      await Promise.all([loadTransactions(), loadSummaryData(), refreshClients()]);
    } catch (err: any) {
      addLog('error', `Failed to link customer: ${err.message || err}`);
    } finally {
      setIsSavingCustomerLink(false);
    }
  };

  const handleStartAddItem = (slip: SlipGroup) => {
    setAddingItemSlipKey(slip.slipKey);
    setNewItemName('');
    setNewItemPickQty('1');
    setNewItemDelivQty('1');
    setNewItemRate(0);
    // Ensure the slip accordion is expanded
    setExpandedSlips((prev) => ({ ...prev, [slip.slipKey]: true }));
  };

  const handleCancelAddItem = () => {
    setAddingItemSlipKey(null);
    setNewItemName('');
    setNewItemPickQty('1');
    setNewItemDelivQty('1');
    setNewItemRate(0);
  };

  const handleZohoNewItemSelect = (item: CatalogItem) => {
    setNewItemName(item.name);
    if (item.rate != null && item.rate > 0) {
      setNewItemRate(item.rate);
    }
  };

  const handleSaveNewItem = async (slip: SlipGroup) => {
    if (!currentClient?.id) return;
    const finalDesc = newItemName.trim();
    if (!finalDesc) {
      addLog('warning', 'Please select or enter an item description.');
      return;
    }

    const pick = Math.max(0, Number(newItemPickQty) || 0);
    const deliv = Math.max(0, Number(newItemDelivQty) || 0);
    const rate = Math.max(0, Number(newItemRate) || 0);
    const total = Math.round(deliv * rate * 100) / 100;
    const loss = Math.max(0, pick - deliv);
    const refItem = slip.items[0];

    setIsAddingItem(true);
    try {
      await createClientTransaction(currentClient.id, {
        item_or_description: finalDesc,
        quantity_or_debit: deliv,
        credit_amount: pick,
        rate_or_price: rate,
        total_amount: total,
        discrepancy_amount: loss,
        transaction_date: slip.slipDate !== '-' ? slip.slipDate : (refItem?.transaction_date || undefined),
        source_file_name: slip.sourceFileName,
        source_identifier: refItem?.source_identifier,
        pipeline_id: refItem?.pipeline_id,
        pipeline_name: refItem?.pipeline_name,
        pipeline_type: refItem?.pipeline_type || 'AR',
        entity_type: refItem?.entity_type || 'ar_sales_invoice',
        category_or_account: refItem?.category_or_account,
        accounting_ref_id: refItem?.accounting_ref_id,
        reviewed: true,
        approved: true,
        status: 'APPROVED',
        metadata_json: refItem?.metadata_json || {},
      });

      addLog(
        'success',
        `Added "${toTitleCase(finalDesc)}" (${deliv} units @ GHS ${rate.toFixed(2)}) to slip "${slip.sourceFileName}".`
      );
      handleCancelAddItem();
      await Promise.all([loadTransactions(), loadSummaryData()]);
    } catch (err: any) {
      addLog('error', `Failed to add line item: ${err.message}`);
    } finally {
      setIsAddingItem(false);
    }
  };

  // Reconciled Zoho Books Customer Contact resolution
  const matchedZohoContact = useMemo(() => {
    const contacts = clientContacts.length > 0 ? clientContacts : (catalog?.contacts || []);
    if (!contacts.length || !currentClient) return null;

    const explicitId = (currentClient as any).zoho_contact_id || (currentClient as any).zohoContactId;
    if (explicitId) {
      const found = contacts.find((c) => c.contact_id === explicitId);
      if (found) return found;
    }

    const clientName = (currentClient?.name || '').trim().toLowerCase();
    for (const c of contacts) {
      const cName = (c.contact_name || '').trim().toLowerCase();
      const compName = (c.company_name || '').trim().toLowerCase();
      if (cName === clientName || compName === clientName) return c;
      if (clientName && (cName.includes(clientName) || compName.includes(clientName) || clientName.includes(cName))) return c;
    }
    return null;
  }, [clientContacts, catalog?.contacts, currentClient]);

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

    const approvedTx = transactions.filter((t) => t.approved && t.status !== 'INVOICED');
    const unapprovedTx = transactions.filter((t) => !t.approved && t.status !== 'INVOICED');
    const unapprovedAmount = unapprovedTx.reduce((sum, t) => sum + (t.total_amount || 0), 0);

    const uncatalogedApproved = approvedTx.filter((t) => isTxUnmappedCatalog(t));
    const uncatalogedNames = Array.from(
      new Set(
        uncatalogedApproved
          .map((t) => (t.item_or_description || '').replace(/^[:;\s\-•.]+/, '').trim())
          .filter(Boolean)
      )
    );

    const zeroRateApproved = approvedTx.filter((t) => (t.rate_or_price || t.total_amount || 0) <= 0);
    const zeroRateNames = Array.from(
      new Set(
        zeroRateApproved
          .map((t) => (t.item_or_description || '').replace(/^[:;\s\-•.]+/, '').trim())
          .filter(Boolean)
      )
    );

    const lowConfApproved = approvedTx.filter((t) => isItemLowConf(t));
    const totalLoss = approvedTx.reduce((sum, t) => sum + (t.discrepancy_amount || 0), 0);

    // Group approved items by Customer (recipient on slip) and reconcile against tenant's Zoho contacts
    const customerMap: Record<
      string,
      { itemsCount: number; totalAmount: number; zohoContactId?: string; isReconciled: boolean }
    > = {};
    const contacts = clientContacts.length > 0 ? clientContacts : catalog?.contacts || [];

    approvedTx.forEach((tx) => {
      const cust = extractPropertyName(tx.source_file_name, tx.metadata_json) || 'General Customer';
      if (!customerMap[cust]) {
        const cLower = cust.toLowerCase();
        const found = contacts.find((c: any) => {
          const cName = (c.contact_name || '').trim().toLowerCase();
          const compName = (c.company_name || '').trim().toLowerCase();
          return (
            cName === cLower ||
            compName === cLower ||
            (cLower.length > 2 &&
              (cName.includes(cLower) ||
                compName.includes(cLower) ||
                cLower.includes(cName) ||
                cLower.includes(compName)))
          );
        });

        customerMap[cust] = {
          itemsCount: 0,
          totalAmount: 0,
          isReconciled: Boolean(found),
          zohoContactId: found ? found.contact_id : undefined,
        };
      }
      customerMap[cust].itemsCount++;
      customerMap[cust].totalAmount += tx.total_amount || 0;
    });

    const customerSummaries = Object.entries(customerMap).map(([custName, data]) => ({
      customerName: custName,
      itemsCount: data.itemsCount,
      totalAmount: data.totalAmount,
      isReconciled: data.isReconciled,
      zohoContactId: data.zohoContactId,
    }));

    const unmatchedCustomers = customerSummaries.filter((c) => !c.isReconciled).map((c) => c.customerName);
    const matchedCustomersCount = customerSummaries.filter((c) => c.isReconciled).length;
    const allCustomersReconciled = customerSummaries.length > 0 && unmatchedCustomers.length === 0;

    const audit: InvoicePreflightAudit = {
      clientId: currentClient.id,
      clientName: currentClient.name,
      month: selectedMonth,
      year: selectedYear,
      totalTransactions: transactions.length,
      approvedTransactions: approvedTx.length,
      unapprovedTransactions: unapprovedTx.length,
      totalApprovedAmount: totalApprovedAmount,
      unapprovedAmount: unapprovedAmount,
      uncatalogedApprovedCount: uncatalogedApproved.length,
      uncatalogedItemNames: uncatalogedNames,
      zeroRateCount: zeroRateApproved.length,
      zeroRateItemNames: zeroRateNames,
      lowConfidenceApprovedCount: lowConfApproved.length,
      unreviewedSlipsCount: slipKpis.unreviewedSlips,
      zohoContactMatched: allCustomersReconciled,
      matchedCustomersCount: matchedCustomersCount,
      unmatchedCustomers: unmatchedCustomers,
      customerSummaries: customerSummaries,
      lossCount: totalLoss,
    };

    setInvoicePreflight(audit);
    setIsInvoiceModalOpen(true);
  };


  const renderDailySortHeader = (label: string, field: string, align: 'left' | 'center' | 'right' = 'left') => {
    const isActive = dailySortField === field;
    return (
      <th
        onClick={() => handleDailySort(field)}
        className={`py-3 px-4 select-none cursor-pointer hover:text-white transition-colors ${
          align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'
        } ${isActive ? 'text-sky-400 font-bold' : 'text-slate-400'}`}
      >
        <div className={`inline-flex items-center gap-1 ${align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : ''}`}>
          <span>{label}</span>
          {isActive ? (
            dailySortDirection === 'asc' ? (
              <ChevronUp className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            )
          ) : (
            <ArrowUpDown className="w-3 h-3 opacity-30 hover:opacity-70 shrink-0" />
          )}
        </div>
      </th>
    );
  };

  const renderSummarySortHeader = (label: string, field: string, align: 'left' | 'center' | 'right' = 'left') => {
    const isActive = summarySortField === field;
    return (
      <th
        onClick={() => handleSummarySort(field)}
        className={`py-3 px-4 select-none cursor-pointer hover:text-white transition-colors ${
          align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'
        } ${isActive ? 'text-sky-400 font-bold' : 'text-slate-400'}`}
      >
        <div className={`inline-flex items-center gap-1 ${align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : ''}`}>
          <span>{label}</span>
          {isActive ? (
            summarySortDirection === 'asc' ? (
              <ChevronUp className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            )
          ) : (
            <ArrowUpDown className="w-3 h-3 opacity-30 hover:opacity-70 shrink-0" />
          )}
        </div>
      </th>
    );
  };

  const sortedSummaryRows = filteredSummaryRows;

  const summaryTotals = useMemo(() => {
    let pick = 0;
    let deliv = 0;
    let loss = 0;
    let billed = 0;
    let slips = 0;

    sortedSummaryRows.forEach((r) => {
      pick += Number(r.total_picked_up) || 0;
      deliv += Number(r.total_delivered) || 0;
      loss += Number(r.linen_discrepancy) || 0;
      billed += Number(r.total_billed) || 0;
      slips += Number(r.slips_count) || 0;
    });

    return { pick, deliv, loss, billed, slips };
  }, [sortedSummaryRows]);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header & Controls Toolbar */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Receipt className="w-5 h-5 text-[#0284C7]" />
            <h2 className="text-base font-bold text-[#0F172A] tracking-tight">
              Accounts Receivable &amp; Review Sheets
            </h2>
            <span className="text-[10px] font-mono font-bold text-[#0284C7] bg-[#F0F9FF] border border-[#BAE6FD] px-2 py-0.5 rounded-full">
              {currentClient.name}
            </span>
            {matchedZohoContact ? (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#059669] bg-[#ECFDF5] border border-[#A7F3D0] px-2.5 py-0.5 rounded-full"
                title={`Reconciled with Zoho Books Customer: ${matchedZohoContact.contact_name} (${matchedZohoContact.contact_id})`}
              >
                <CheckCircle2 className="w-3 h-3 text-[#059669] shrink-0" />
                <span>Zoho Customer: {matchedZohoContact.company_name || matchedZohoContact.contact_name}</span>
                <span className="font-mono text-[#059669]/80">({matchedZohoContact.contact_id})</span>
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 bg-slate-50 border border-[#E2E8F0] px-2 py-0.5 rounded-full"
                title="Will match automatically during Zoho invoice creation using name similarity"
              >
                <Building2 className="w-3 h-3 text-slate-400 shrink-0" />
                <span>Auto-reconciles to Zoho Customer</span>
              </span>
            )}
          </div>
          <p className="text-xs text-[#64748B] mt-0.5">
            {isCustodyTracking
              ? 'Audit OCR extracted laundry/sales control slips, reconcile linen losses, and generate Zoho Books invoices.'
              : 'Audit OCR extracted revenue & sales documents, review line items, and generate Zoho Books invoices.'}
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Period Selector */}
          <div className="flex items-center gap-1.5 bg-white border border-[#E2E8F0] rounded-xl px-2.5 py-1 text-xs text-[#0F172A] font-semibold shadow-xs">
            <Calendar className="w-3.5 h-3.5 text-[#0284C7]" />
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-transparent text-[#0F172A] font-semibold focus:outline-none cursor-pointer"
            >
              {MONTHS.map((m) => (
                <option key={m} value={m} className="bg-white text-slate-800">
                  {m}
                </option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="bg-transparent text-[#0F172A] font-semibold focus:outline-none cursor-pointer ml-1"
            >
              {YEARS.map((y) => (
                <option key={y} value={y} className="bg-white text-slate-800">
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Run OCR */}
          <button
            onClick={() => handleRunArOcr()}
            disabled={isRunningOcr}
            className="flex items-center gap-1.5 bg-[#0284C7] hover:bg-[#0EA5E9] text-white text-xs font-semibold px-3.5 py-1.5 rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
          >
            <PlayCircle className={`w-3.5 h-3.5 ${isRunningOcr ? 'animate-spin' : ''}`} />
            <span>{isRunningOcr ? 'Extracting Slips...' : 'Run AR Extraction'}</span>
          </button>

          {/* Add Manual Slip */}
          <button
            onClick={() => handleOpenAddSlipModal()}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3.5 py-1.5 rounded-xl shadow-xs transition cursor-pointer"
            title="Manually create a new delivery slip in the ledger"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Slip</span>
          </button>

          {/* Delete Ingested File */}
          <button
            onClick={() => {
              setPurgeTargetFileName('');
              setIsPurgeModalOpen(true);
            }}
            className="flex items-center gap-1.5 bg-white hover:bg-[#FFF1F2] border border-[#FECDD3] text-[#E11D48] text-xs font-semibold px-3 py-1.5 rounded-xl transition cursor-pointer"
            title="Delete mistakenly ingested files or clear erroneous document data"
          >
            <Trash2 className="w-3.5 h-3.5 text-[#E11D48]" />
            <span>Delete Ingested File</span>
          </button>

          {/* Refresh */}
          <button
            onClick={() => { refreshAll(); loadTransactions(); loadSummaryData(); }}
            disabled={isLoading || isLoadingTx}
            className="p-2 bg-white border border-[#E2E8F0] hover:bg-slate-50 text-slate-600 rounded-xl transition cursor-pointer shadow-xs"
            title="Refresh AR Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading || isLoadingTx ? 'animate-spin text-[#0284C7]' : ''}`} />
          </button>

          {/* 1-Click Invoice Export */}
          <button
            onClick={handleGenerateInvoicesClick}
            className={`flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl transition cursor-pointer ${
              approvedRowsCount > 0
                ? 'bg-[#059669] hover:bg-[#047857] text-white shadow-sm font-bold'
                : 'bg-slate-100 text-slate-400 border border-[#E2E8F0] cursor-not-allowed opacity-60'
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
          className={`flex items-start justify-between gap-3 p-4 rounded-xl border transition shadow-xs animate-in fade-in slide-in-from-top-2 ${
            runFeedback.type === 'error'
              ? 'bg-[#FFF1F2] border-[#FECDD3] text-[#9F1239]'
              : runFeedback.type === 'warning'
              ? 'bg-[#FEF3C7] border-[#FDE68A] text-[#92400E]'
              : 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {runFeedback.type === 'error' ? (
              <AlertTriangle className="w-5 h-5 text-[#E11D48] shrink-0 mt-0.5" />
            ) : runFeedback.type === 'warning' ? (
              <AlertTriangle className="w-5 h-5 text-[#D97706] shrink-0 mt-0.5" />
            ) : (
              <Check className="w-5 h-5 text-[#059669] shrink-0 mt-0.5" />
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
            className="p-1 hover:bg-slate-200/60 rounded-lg text-slate-400 hover:text-slate-700 transition cursor-pointer"
            title="Dismiss notice"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Mode Switcher & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-[#E2E8F0] rounded-xl p-2 shadow-xs">
        <div className="flex items-center gap-1 bg-slate-100/80 p-1 rounded-lg border border-slate-200/80">
          <button
            onClick={() => setActiveLedgerView('summary')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition cursor-pointer flex items-center gap-1.5 ${
              activeLedgerView === 'summary'
                ? 'bg-white text-[#0284C7] shadow-xs border border-slate-200/80'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Monthly Summary ({summaryRows.length})</span>
          </button>
          <button
            onClick={() => setActiveLedgerView('daily')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition cursor-pointer flex items-center gap-1.5 ${
              activeLedgerView === 'daily'
                ? 'bg-white text-[#0284C7] shadow-xs border border-slate-200/80'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
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
            className="flex items-center gap-1.5 bg-[#ECFDF5] hover:bg-[#D1FAE5] border border-[#A7F3D0] text-[#059669] text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-40"
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
              className="bg-slate-50 border border-[#E2E8F0] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#0F172A] placeholder-slate-400 focus:outline-none focus:border-[#0284C7] focus:bg-white sm:w-60"
            />
          </div>
        </div>
      </div>

      {/* Source vs Processed Slips Display Card */}
      {activeLedgerView === 'daily' && (
        <div className="bg-gradient-to-r from-sky-50/90 via-white to-sky-50/60 border border-sky-200 rounded-xl p-3 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-sky-100 text-sky-700 rounded-lg shrink-0">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 text-sm">
                  {dailyPropertyFilter === 'ALL' ? 'All Customers' : dailyPropertyFilter}
                </span>
                <span className="text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 border border-sky-200">
                  Source vs Processed
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {dailyPropertyFilter === 'ALL'
                  ? 'Comparing control slips detected in source storage folders against transactions committed to review ledger.'
                  : `Comparing control slips detected for "${dailyPropertyFilter}" in source storage against transactions committed to review ledger.`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Found in Source */}
            <div className="flex items-center gap-2 bg-white border border-slate-200/90 rounded-lg px-3 py-1.5 shadow-2xs">
              <FolderOpen className="w-3.5 h-3.5 text-sky-600" />
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-400">Found in Source</div>
                <div className="font-mono font-bold text-sky-900 text-xs flex items-center gap-1.5">
                  <span>{currentPropertyMetrics.sourceTotal} Slips</span>
                  {currentPropertyMetrics.sourceUnprocessed > 0 ? (
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded-full">
                      {currentPropertyMetrics.sourceUnprocessed} pending in Drive
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded-full">
                      All Processed
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Arrow indicator */}
            <ArrowRight className="w-4 h-4 text-slate-300 hidden sm:block shrink-0" />

            {/* Processed into Ledger */}
            <div className="flex items-center gap-2 bg-white border border-slate-200/90 rounded-lg px-3 py-1.5 shadow-2xs">
              <Database className="w-3.5 h-3.5 text-emerald-600" />
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-400">Processed into Ledger</div>
                <div className="font-mono font-bold text-emerald-800 text-xs flex items-center gap-1.5">
                  <span>{currentPropertyMetrics.ledgerSlipsCount} Slips</span>
                  <span className="text-[11px] font-normal text-slate-500">
                    ({currentPropertyMetrics.ledgerItemsCount} {currentPropertyMetrics.ledgerItemsCount === 1 ? 'item' : 'items'})
                  </span>
                </div>
              </div>
            </div>

            {/* Ledger Review Status */}
            <div className="flex items-center gap-2 bg-white border border-slate-200/90 rounded-lg px-3 py-1.5 shadow-2xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" />
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-400">Ledger Review Status</div>
                <div className="font-mono font-bold text-slate-700 text-xs flex items-center gap-1.5">
                  <span className="text-emerald-700">{currentPropertyMetrics.ledgerApprovedSlips} Approved</span>
                  {currentPropertyMetrics.ledgerPendingSlips > 0 ? (
                    <span className="text-amber-600">({currentPropertyMetrics.ledgerPendingSlips} Pending)</span>
                  ) : (
                    <span className="text-slate-400 font-normal text-[11px]">(0 Pending)</span>
                  )}
                </div>
              </div>
            </div>

            {/* Refresh / Check Source button */}
            <button
              onClick={loadSourceMetrics}
              disabled={isLoadingSourceMetrics}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-sky-700 bg-white hover:bg-slate-50 border border-slate-200 hover:border-sky-300 rounded-lg transition cursor-pointer shadow-2xs"
              title="Check live Google Drive source folder for new slips"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSourceMetrics ? 'animate-spin text-sky-600' : ''}`} />
              <span className="hidden lg:inline">{isLoadingSourceMetrics ? 'Scanning...' : 'Check Source'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Dynamic AR Slips KPI Review Metric Cards */}
      {activeLedgerView === 'daily' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Card 1: Total Processed Slips */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-3 shadow-xs flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400">Total Slips</div>
              <div className="text-lg font-bold text-slate-900 font-mono">{groupedSlips.length}</div>
              <div className="text-[11px] text-slate-500 font-mono">
                {formatCurrency(groupedSlips.reduce((s, g) => s + g.totalAmount, 0))}
              </div>
            </div>
            <div className="p-2.5 bg-slate-100 rounded-xl text-slate-600">
              <FileText className="w-5 h-5" />
            </div>
          </div>

          {/* Card 2: Unreviewed Slips */}
          <button
            type="button"
            onClick={() => setDailyStatusFilter((prev) => (prev === 'UNREVIEWED' ? 'ALL' : 'UNREVIEWED'))}
            className={`p-3 rounded-xl border text-left transition shadow-xs cursor-pointer flex items-center justify-between ${
              dailyStatusFilter === 'UNREVIEWED'
                ? 'bg-sky-50 border-sky-300 ring-2 ring-sky-400/40'
                : 'bg-white border-[#E2E8F0] hover:border-sky-300'
            }`}
          >
            <div>
              <div className="text-[10px] uppercase font-bold text-sky-700">Unreviewed Slips</div>
              <div className="text-lg font-bold text-sky-900 font-mono">{slipKpis.unreviewedSlips}</div>
              <div className="text-[11px] text-sky-600 font-medium">Click to filter unreviewed</div>
            </div>
            <div className="p-2.5 bg-sky-100 text-sky-600 rounded-xl">
              <Clock className="w-5 h-5" />
            </div>
          </button>

          {/* Card 3: Unapproved Slips */}
          <button
            type="button"
            onClick={() => setDailyStatusFilter((prev) => (prev === 'UNAPPROVED' ? 'ALL' : 'UNAPPROVED'))}
            className={`p-3 rounded-xl border text-left transition shadow-xs cursor-pointer flex items-center justify-between ${
              dailyStatusFilter === 'UNAPPROVED'
                ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-400/40'
                : 'bg-white border-[#E2E8F0] hover:border-amber-300'
            }`}
          >
            <div>
              <div className="text-[10px] uppercase font-bold text-amber-700">Unapproved Slips</div>
              <div className="text-lg font-bold text-amber-900 font-mono">{slipKpis.unapprovedSlips}</div>
              <div className="text-[11px] text-amber-600 font-medium">Pending CPA sign-off</div>
            </div>
            <div className="p-2.5 bg-amber-100 text-amber-600 rounded-xl">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </button>

          {/* Card 4: AI Low Confidence */}
          <button
            type="button"
            onClick={() => setDailyStatusFilter((prev) => (prev === 'LOW_CONFIDENCE' ? 'ALL' : 'LOW_CONFIDENCE'))}
            className={`p-3 rounded-xl border text-left transition shadow-xs cursor-pointer flex items-center justify-between ${
              dailyStatusFilter === 'LOW_CONFIDENCE'
                ? 'bg-purple-50 border-purple-300 ring-2 ring-purple-400/40'
                : 'bg-white border-[#E2E8F0] hover:border-purple-300'
            }`}
          >
            <div>
              <div className="text-[10px] uppercase font-bold text-purple-700">AI Low Confidence</div>
              <div className="text-lg font-bold text-purple-900 font-mono">{slipKpis.lowConfidenceSlips}</div>
              <div className="text-[11px] text-purple-600 font-medium">OCR &lt; 80% legibility</div>
            </div>
            <div className="p-2.5 bg-purple-100 text-purple-600 rounded-xl">
              <Sparkles className="w-5 h-5" />
            </div>
          </button>

          {/* Card 5: Uncataloged Items */}
          <div
            onClick={() => setDailyStatusFilter((prev) => (prev === 'UNMAPPED' ? 'ALL' : 'UNMAPPED'))}
            className={`p-3 rounded-xl border text-left transition shadow-xs cursor-pointer flex items-center justify-between ${
              dailyStatusFilter === 'UNMAPPED'
                ? 'bg-rose-50 border-rose-300 ring-2 ring-rose-400/40'
                : 'bg-white border-[#E2E8F0] hover:border-rose-300'
            }`}
          >
            <div>
              <div className="text-[10px] uppercase font-bold text-rose-700">Uncataloged Items</div>
              <div className="text-lg font-bold text-rose-900 font-mono">{slipKpis.unmappedItems}</div>
              <div className="text-[11px] text-rose-600 font-medium">
                {slipKpis.unmappedSlips} {slipKpis.unmappedSlips === 1 ? 'slip' : 'slips'} ({slipKpis.distinctUnmappedNames} distinct)
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {slipKpis.distinctUnmappedNames > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExportUncatalogedItemsCsv();
                  }}
                  className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl transition cursor-pointer"
                  title="Export Distinct Uncataloged Items (.csv)"
                >
                  <Download className="w-4 h-4" />
                </button>
              )}
              <div className="p-2.5 bg-rose-100 text-rose-600 rounded-xl">
                <Package className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Card 6: Missing Activity Gaps */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-3 shadow-xs flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase font-bold text-rose-600">Missing Periods</div>
              <div className="text-lg font-bold text-rose-900 font-mono">{slipKpis.missingPeriodsCount}</div>
              <div className="text-[11px] text-slate-500 capitalize">{missingCadence} Gaps</div>
            </div>
            <div className="flex items-center gap-1.5">
              {missingCadence !== 'disabled' && (
                <button
                  type="button"
                  onClick={handleExportMissingPeriodsTxt}
                  className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl transition cursor-pointer"
                  title="Export Missing Activity Report (.txt)"
                >
                  <Download className="w-4 h-4" />
                </button>
              )}
              <div className="p-2.5 bg-rose-50 text-rose-600 rounded-xl">
                <Calendar className="w-5 h-5" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Missing Periods Alert Banner */}
      {activeLedgerView === 'daily' && missingCadence !== 'disabled' && missingPeriods.length > 0 && (
        <div className="bg-gradient-to-r from-amber-50/90 via-white to-amber-50/60 border border-amber-200 rounded-xl p-3 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 text-amber-800 rounded-lg shrink-0">
              <AlertCircle className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-amber-900 text-xs">
                  Missing Activity Detected ({missingPeriods.length} {missingCadence === 'daily' ? 'days' : missingCadence === 'weekly' ? 'weeks' : missingCadence === 'fortnightly' ? 'fortnights' : 'months'})
                </span>
                <span className="text-[10px] font-mono text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-200">
                  {dailyPropertyFilter === 'ALL' ? 'All Customers' : dailyPropertyFilter}
                </span>
                <button
                  type="button"
                  onClick={handleExportMissingPeriodsTxt}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-semibold text-[11px] transition shadow-xs cursor-pointer ml-1"
                  title={`Export missing activity to .txt (${dailyPropertyFilter === 'ALL' ? 'All Customers' : dailyPropertyFilter})`}
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export to TXT</span>
                </button>
              </div>
              <p className="text-[11px] text-amber-700/90 mt-0.5">
                No slips recorded in PostgreSQL for these periods. Click any <strong className="font-semibold">[ + ]</strong> badge to manually record a slip.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap max-h-24 overflow-y-auto">
            {missingPeriods.map((period) => (
              <button
                key={period.key}
                type="button"
                onClick={() => handleOpenAddSlipModal(period.defaultDate)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white border border-amber-300 text-amber-900 hover:bg-amber-100 hover:border-amber-400 font-mono text-[11px] font-semibold transition cursor-pointer shadow-2xs"
                title={`Click to manually add a slip for ${period.label}`}
              >
                <span>{period.label}</span>
                <Plus className="w-3 h-3 text-amber-600" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Floating / Sticky Bulk Actions Toolbar */}
      {activeLedgerView === 'daily' && selectedSlipKeys.size > 0 && (
        <div className="sticky top-4 z-30 bg-[#0F172A] text-white rounded-xl p-3 shadow-xl border border-slate-700 flex flex-wrap items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-sky-400" />
            <span className="font-bold text-xs">
              {selectedSlipKeys.size} {selectedSlipKeys.size === 1 ? 'Slip' : 'Slips'} Selected
            </span>
            <span className="text-slate-400 text-xs hidden sm:inline">•</span>
            <span className="text-slate-400 text-xs hidden sm:inline">
              {groupedSlips.filter((s) => selectedSlipKeys.has(s.slipKey)).reduce((sum, s) => sum + s.items.length, 0)} items total
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleBulkApproveSlips}
              disabled={isBulkApproving}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-xs transition cursor-pointer disabled:opacity-50"
            >
              {isBulkApproving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              <span>Approve Selected</span>
            </button>

            <button
              type="button"
              onClick={handleBulkReviewSlips}
              disabled={isBulkReviewing}
              className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-xs transition cursor-pointer disabled:opacity-50"
            >
              {isBulkReviewing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
              <span>Mark Reviewed</span>
            </button>

            <button
              type="button"
              onClick={handleBulkDeleteSlips}
              disabled={isBulkDeleting}
              className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-xs transition cursor-pointer disabled:opacity-50"
            >
              {isBulkDeleting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              <span>Delete Selected</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedSlipKeys(new Set())}
              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
              title="Deselect all slips"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Daily Slips Filter Toolbar: Status Pills, Customer, Sorting & Cadence */}
      {activeLedgerView === 'daily' && (
        <div className="flex flex-col gap-2.5 bg-white border border-[#E2E8F0] rounded-xl p-2.5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDailyStatusFilter('ALL')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                  dailyStatusFilter === 'ALL'
                    ? 'bg-[#0F172A] text-white shadow-xs'
                    : 'bg-slate-50 text-slate-600 hover:text-slate-900 border border-[#E2E8F0]'
                }`}
              >
                <span>All Slips</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-slate-200/70 text-slate-700">
                  {dailyCounts.all}
                </span>
                {dailyPropertyFilter !== 'ALL' && dailyCounts.all < dailyCounts.totalAcrossAllClients && (
                  <span className="text-[10px] text-slate-400 font-normal">
                    of {dailyCounts.totalAcrossAllClients}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setDailyStatusFilter('UNREVIEWED')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                  dailyStatusFilter === 'UNREVIEWED'
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'bg-slate-50 text-slate-600 hover:text-slate-900 border border-[#E2E8F0]'
                }`}
              >
                <Clock className="w-3 h-3" />
                <span>Unreviewed</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${dailyStatusFilter === 'UNREVIEWED' ? 'bg-sky-700 text-white' : 'bg-sky-100 text-sky-800'}`}>
                  {dailyCounts.unreviewed}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setDailyStatusFilter('UNAPPROVED')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                  dailyStatusFilter === 'UNAPPROVED'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-slate-50 text-slate-600 hover:text-slate-900 border border-[#E2E8F0]'
                }`}
              >
                <span>Unapproved</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${dailyStatusFilter === 'UNAPPROVED' ? 'bg-amber-700 text-white' : 'bg-amber-100 text-amber-800'}`}>
                  {dailyCounts.unapproved}
                </span>
              </button>

              {dailyCounts.lowConfidence > 0 && (
                <button
                  type="button"
                  onClick={() => setDailyStatusFilter('LOW_CONFIDENCE')}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                    dailyStatusFilter === 'LOW_CONFIDENCE'
                      ? 'bg-purple-600 text-white shadow-xs'
                      : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200'
                  }`}
                >
                  <Sparkles className="w-3 h-3 text-purple-500" />
                  <span>Low Conf</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${dailyStatusFilter === 'LOW_CONFIDENCE' ? 'bg-purple-700 text-white' : 'bg-purple-100 text-purple-800'}`}>
                    {dailyCounts.lowConfidence}
                  </span>
                </button>
              )}

              {dailyCounts.unmappedItems > 0 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setDailyStatusFilter((prev) => (prev === 'UNMAPPED' ? 'ALL' : 'UNMAPPED'))}
                    className={`px-3 py-1 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                      dailyStatusFilter === 'UNMAPPED'
                        ? 'bg-rose-600 text-white shadow-xs'
                        : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                    }`}
                    title={`${dailyCounts.unmappedItems} unmapped line items across ${dailyCounts.unmappedSlips} slips (${dailyCounts.distinctUnmappedNames} distinct item names)`}
                  >
                    <Package className="w-3 h-3 text-rose-500" />
                    <span>Uncataloged</span>
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                        dailyStatusFilter === 'UNMAPPED' ? 'bg-rose-700 text-white' : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {dailyCounts.unmappedItems}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportUncatalogedItemsCsv}
                    className="p-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg transition cursor-pointer"
                    title="Export distinct uncataloged items to CSV"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => setDailyStatusFilter('PENDING')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                  dailyStatusFilter === 'PENDING'
                    ? 'bg-[#FEF3C7] text-[#D97706] border border-[#FDE68A] shadow-xs'
                    : 'bg-slate-50 text-slate-600 hover:text-slate-900 border border-[#E2E8F0]'
                }`}
              >
                <span>Pending</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-[#FEF3C7] text-[#D97706] border border-[#FDE68A]">
                  {dailyCounts.pending}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setDailyStatusFilter('APPROVED')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                  dailyStatusFilter === 'APPROVED'
                    ? 'bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0] shadow-xs'
                    : 'bg-slate-50 text-slate-600 hover:text-slate-900 border border-[#E2E8F0]'
                }`}
              >
                <span>Approved</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]">
                  {dailyCounts.approved}
                </span>
              </button>

              {isCustodyTracking && (
                <button
                  type="button"
                  onClick={() => setDailyStatusFilter('DISCREPANCY')}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                    dailyStatusFilter === 'DISCREPANCY'
                      ? 'bg-[#FFF1F2] text-[#E11D48] border border-[#FECDD3] shadow-xs'
                      : 'bg-slate-50 text-slate-600 hover:text-slate-900 border border-[#E2E8F0]'
                  }`}
                >
                  <AlertTriangle className="w-3 h-3 text-[#E11D48]" />
                  <span>Loss Discrepancies</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-[#FFF1F2] text-[#E11D48] border border-[#FECDD3]">
                    {dailyCounts.discrepancy}
                  </span>
                </button>
              )}

              {dailyCounts.invoiced > 0 && (
                <button
                  type="button"
                  onClick={() => setDailyStatusFilter('INVOICED')}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                    dailyStatusFilter === 'INVOICED'
                      ? 'bg-[#F0F9FF] text-[#0284C7] border border-[#BAE6FD] shadow-xs'
                      : 'bg-slate-50 text-slate-600 hover:text-slate-900 border border-[#E2E8F0]'
                  }`}
                >
                  <span>Invoiced</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-[#F0F9FF] text-[#0284C7] border border-[#BAE6FD]">
                    {dailyCounts.invoiced}
                  </span>
                </button>
              )}
            </div>

            {/* Right side controls: Customer, Sort, Cadence */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Customer Selector */}
              {availableProperties.length > 0 && (
                <div className="flex items-center gap-1.5 bg-slate-50 border border-[#E2E8F0] rounded-lg px-2.5 py-1 text-xs shrink-0">
                  <Building2 className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-[#64748B] text-[11px]">Customer:</span>
                  <select
                    value={dailyPropertyFilter}
                    onChange={(e) => setDailyPropertyFilter(e.target.value)}
                    className="bg-transparent text-[#0F172A] font-semibold focus:outline-none cursor-pointer text-xs"
                  >
                    <option value="ALL" className="bg-white text-slate-800">
                      All Customers ({arStagedTx.length} items)
                    </option>
                    {availableProperties.map((p) => {
                      const stat = propertyStatsMap[p];
                      const slipsCnt = stat?.slips.size || 0;
                      const itemsCnt = stat?.items || 0;
                      return (
                        <option key={p} value={p} className="bg-white text-slate-800">
                          {p} ({slipsCnt} {slipsCnt === 1 ? 'slip' : 'slips'} • {itemsCnt} {itemsCnt === 1 ? 'item' : 'items'})
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {/* Grouped Slips Sort By */}
              {dailyViewMode === 'grouped' && (
                <div className="flex items-center gap-1.5 bg-slate-50 border border-[#E2E8F0] rounded-lg px-2.5 py-1 text-xs shrink-0">
                  <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-[#64748B] text-[11px]">Sort:</span>
                  <select
                    value={groupedSortBy}
                    onChange={(e) => setGroupedSortBy(e.target.value)}
                    className="bg-transparent text-[#0F172A] font-semibold focus:outline-none cursor-pointer text-xs"
                  >
                    <option value="date_desc">Date (Newest First)</option>
                    <option value="date_asc">Date (Oldest First)</option>
                    <option value="cust_asc">Customer (A to Z)</option>
                    <option value="cust_desc">Customer (Z to A)</option>
                    <option value="amount_desc">Total Amount (Highest)</option>
                    <option value="amount_asc">Total Amount (Lowest)</option>
                    <option value="count_desc">Item Count (Most)</option>
                    <option value="low_conf_first">Low Confidence First</option>
                    <option value="unreviewed_first">Unreviewed First</option>
                    <option value="unapproved_first">Unapproved First</option>
                  </select>
                </div>
              )}

              {/* Cadence Selector */}
              <div className="flex items-center gap-1.5 bg-slate-50 border border-[#E2E8F0] rounded-lg px-2.5 py-1 text-xs shrink-0">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-[#64748B] text-[11px]">Cadence:</span>
                <select
                  value={missingCadence}
                  onChange={(e) => setMissingCadence(e.target.value as any)}
                  className="bg-transparent text-[#0F172A] font-semibold focus:outline-none cursor-pointer text-xs"
                >
                  <option value="daily">By Dates (Daily)</option>
                  <option value="weekly">By Weeks</option>
                  <option value="fortnightly">By Fortnights</option>
                  <option value="monthly">By Months</option>
                  <option value="disabled">Cadence Off</option>
                </select>
              </div>

              {missingCadence !== 'disabled' && (
                <button
                  type="button"
                  onClick={handleExportMissingPeriodsTxt}
                  className="flex items-center gap-1.5 bg-white border border-[#E2E8F0] hover:bg-slate-50 text-slate-700 px-2.5 py-1 rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer shrink-0"
                  title={`Export missing activity report to .txt (${dailyPropertyFilter === 'ALL' ? 'All Customers' : dailyPropertyFilter})`}
                >
                  <Download className="w-3.5 h-3.5 text-amber-600" />
                  <span className="hidden sm:inline">Export Missing (.txt)</span>
                  <span className="sm:hidden">Export</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleExportCustomerListingCsv}
                className="flex items-center gap-1.5 bg-white border border-[#E2E8F0] hover:bg-slate-50 text-slate-700 px-2.5 py-1 rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer shrink-0"
                title={`Export customer transaction listing to .csv (${dailyPropertyFilter === 'ALL' ? 'All Customers' : dailyPropertyFilter})`}
              >
                <Download className="w-3.5 h-3.5 text-blue-600" />
                <span className="hidden sm:inline">Export Listing (.csv)</span>
                <span className="sm:hidden">Export CSV</span>
              </button>
            </div>
          </div>

          {/* Sub-toolbar: View Mode Switcher (Group by Slip vs Flat Table) & Accordion Actions */}
          <div className="w-full flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E2E8F0] mt-1">
            <div className="flex items-center gap-1 bg-slate-100/80 p-1 rounded-lg border border-slate-200/80">
              <button
                onClick={() => setDailyViewMode('grouped')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition cursor-pointer flex items-center gap-1.5 ${
                  dailyViewMode === 'grouped'
                    ? 'bg-white text-[#0284C7] shadow-xs border border-slate-200/80 font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                }`}
                title="Organize transactions by daily control slip with 1-click slip approval"
              >
                <FolderKanban className="w-3.5 h-3.5" />
                <span>Group by Slip ({groupedSlips.length})</span>
              </button>
              <button
                onClick={() => setDailyViewMode('flat')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition cursor-pointer flex items-center gap-1.5 ${
                  dailyViewMode === 'flat'
                    ? 'bg-white text-[#0284C7] shadow-xs border border-slate-200/80 font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                }`}
                title="View all transactions in a single flat ledger table"
              >
                <List className="w-3.5 h-3.5" />
                <span>Flat Table ({filteredArStagedTx.length})</span>
              </button>
            </div>

            {dailyViewMode === 'grouped' && groupedSlips.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExpandAll}
                  className="px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-white border border-[#E2E8F0] hover:bg-slate-50 rounded-lg transition cursor-pointer shadow-xs"
                  title="Expand all daily slips"
                >
                  Expand All
                </button>
                <button
                  onClick={handleCollapseAll}
                  className="px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-white border border-[#E2E8F0] hover:bg-slate-50 rounded-lg transition cursor-pointer shadow-xs"
                  title="Collapse all daily slips"
                >
                  Collapse All
                </button>
                <button
                  onClick={() => {
                    setPurgeTargetFileName('');
                    setIsPurgeModalOpen(true);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#E11D48] hover:bg-rose-50 bg-white border border-[#FECDD3] rounded-lg transition cursor-pointer shadow-xs"
                  title="Purge mistakenly uploaded document or file from PostgreSQL"
                >
                  <Trash2 className="w-3 h-3 text-[#E11D48]" />
                  <span>Purge File</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Primary In-App PostgreSQL Ledger Notice */}
      <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl px-3.5 py-2 flex items-center justify-between gap-2 text-xs text-[#065F46] shadow-xs">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 relative shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#10B981] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#059669]"></span>
          </span>
          <span>
            <strong className="text-[#065F46] font-bold">Native In-App PostgreSQL Ledger Active:</strong>{' '}
            {isCustodyTracking
              ? 'Daily control slips, linen loss reconciliations, and review approvals are committed directly to PostgreSQL. Zoho Books invoices are generated directly from approved transactions.'
              : 'Daily revenue documents, quantities, rates, and review approvals are committed directly to PostgreSQL. Zoho Books invoices are generated directly from approved transactions.'}
          </span>
        </div>
      </div>

      {/* Summary View Notice & Quick-Switch */}
      {activeLedgerView === 'summary' && (
        <div className="space-y-3">
          {/* Customer Selector Toolbar & Pills */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-3 shadow-xs space-y-2.5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              {/* Left: Customer Dropdown */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 bg-slate-50 border border-[#E2E8F0] rounded-lg px-2.5 py-1 text-xs shrink-0">
                  <Building2 className="w-3.5 h-3.5 text-[#0284C7]" />
                  <span className="text-[#64748B] text-[11px] font-semibold">Customer:</span>
                  <select
                    value={dailyPropertyFilter}
                    onChange={(e) => setDailyPropertyFilter(e.target.value)}
                    className="bg-transparent text-[#0F172A] font-bold focus:outline-none cursor-pointer text-xs"
                  >
                    <option value="ALL" className="bg-white text-slate-800">
                      All Customers ({arStagedTx.length} items total)
                    </option>
                    {availableProperties.map((p) => {
                      const stat = propertyStatsMap[p];
                      const itemsCnt = stat?.items || 0;
                      const amt = stat?.totalAmount || 0;
                      return (
                        <option key={p} value={p} className="bg-white text-slate-800">
                          {p} ({itemsCnt} {itemsCnt === 1 ? 'item' : 'items'} • GHS {amt.toFixed(2)})
                        </option>
                      );
                    })}
                  </select>
                </div>

                {dailyPropertyFilter !== 'ALL' && (
                  <button
                    onClick={() => setDailyPropertyFilter('ALL')}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/80 rounded-lg transition cursor-pointer"
                    title="Reset to All Customers view"
                  >
                    <X className="w-3 h-3" />
                    <span>Show All Customers</span>
                  </button>
                )}
              </div>

              {/* Right: Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleExportMonthlySummaryCsv}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-white text-emerald-700 border border-emerald-300 hover:bg-emerald-50 rounded-lg transition cursor-pointer shadow-xs"
                  title={`Export monthly SKU summary to CSV (${dailyPropertyFilter === 'ALL' ? 'All Customers' : dailyPropertyFilter})`}
                >
                  <Download className="w-3.5 h-3.5 text-emerald-600" />
                  <span>
                    {dailyPropertyFilter === 'ALL' ? 'Export Summary (.csv)' : `Export ${dailyPropertyFilter} (.csv)`}
                  </span>
                </button>
                <button
                  onClick={handleExportZohoInvoiceImportCsv}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-white text-indigo-700 border border-indigo-300 hover:bg-indigo-50 rounded-lg transition cursor-pointer shadow-xs"
                  title={`Export ready-to-upload Zoho Books invoice import CSV (${dailyPropertyFilter === 'ALL' ? 'All Customers' : dailyPropertyFilter})`}
                >
                  <Download className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Export Zoho Import (.csv)</span>
                </button>
                <button
                  onClick={() => setActiveLedgerView('daily')}
                  className="px-2.5 py-1.5 text-xs font-bold bg-white text-[#0284C7] border border-[#BAE6FD] hover:bg-sky-50 rounded-lg transition cursor-pointer shadow-xs"
                >
                  Open Daily Slips ({dailyPropertyFilter === 'ALL' ? arStagedTx.length : filteredArStagedTx.length})
                </button>
                <button
                  onClick={() => {
                    setPurgeTargetFileName('');
                    setIsPurgeModalOpen(true);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold bg-white text-[#E11D48] border border-[#FECDD3] hover:bg-rose-50 rounded-lg transition cursor-pointer shadow-xs"
                >
                  <Trash2 className="w-3.5 h-3.5 text-[#E11D48]" />
                  <span>Delete Ingested File</span>
                </button>
              </div>
            </div>

            {/* Quick Customer Switcher Pills */}
            {availableProperties.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar text-xs pt-1 border-t border-slate-100">
                <span className="text-[10px] uppercase font-bold text-slate-400 shrink-0 mr-1">Filter by Customer:</span>
                <button
                  type="button"
                  onClick={() => setDailyPropertyFilter('ALL')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold shrink-0 transition cursor-pointer flex items-center gap-1.5 ${
                    dailyPropertyFilter === 'ALL'
                      ? 'bg-[#0F172A] text-white shadow-xs'
                      : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  <span>All Customers</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${dailyPropertyFilter === 'ALL' ? 'bg-slate-800 text-slate-200' : 'bg-slate-200/70 text-slate-700'}`}>
                    {arStagedTx.length}
                  </span>
                </button>
                {availableProperties.map((p) => {
                  const stat = propertyStatsMap[p];
                  const isSelected = dailyPropertyFilter === p;
                  const amt = stat?.totalAmount || 0;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setDailyPropertyFilter(p)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold shrink-0 transition cursor-pointer flex items-center gap-1.5 ${
                        isSelected
                          ? 'bg-[#0284C7] text-white shadow-xs font-bold'
                          : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200'
                      }`}
                    >
                      <Building2 className={`w-3 h-3 ${isSelected ? 'text-white' : 'text-slate-400'}`} />
                      <span>{p}</span>
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${isSelected ? 'bg-sky-800 text-sky-100' : 'bg-slate-200/70 text-slate-700'}`}>
                        {formatCurrency(amt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Active Customer Focus Summary Banner */}
          {dailyPropertyFilter !== 'ALL' && (
            <div className="bg-gradient-to-r from-sky-50 via-white to-sky-50/60 border border-sky-200 rounded-xl p-3.5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-sky-100 text-[#0284C7] rounded-xl shrink-0">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-900 text-sm">{dailyPropertyFilter}</h3>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 border border-sky-200">
                      Customer Monthly Summary
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Aggregated SKU breakdown for manual invoice creation in Zoho Books ({selectedMonth} {selectedYear}).
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 shadow-2xs">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Total Billed</div>
                  <div className="font-mono font-bold text-emerald-700 text-sm">
                    {formatCurrency(summaryTotals.billed)}
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 shadow-2xs">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Delivered Units</div>
                  <div className="font-mono font-bold text-slate-800 text-sm">
                    {summaryTotals.deliv}
                  </div>
                </div>
                {isCustodyTracking && (
                  <div className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 shadow-2xs">
                    <div className="text-[10px] uppercase font-bold text-slate-400">Linen Loss</div>
                    <div className={`font-mono font-bold text-sm ${summaryTotals.loss > 0 ? 'text-[#E11D48]' : 'text-slate-800'}`}>
                      {summaryTotals.loss > 0 ? `-${summaryTotals.loss}` : '0'}
                    </div>
                  </div>
                )}
                <div className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 shadow-2xs">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Distinct Items</div>
                  <div className="font-mono font-bold text-slate-800 text-sm">
                    {sortedSummaryRows.length}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Table Views */}
      <div className="bg-white rounded-2xl overflow-hidden border border-[#E2E8F0] shadow-xs">
        <div className="overflow-x-auto custom-scrollbar">
          
          {/* VIEW 1: IN-APP POSTGRESQL MONTHLY SUMMARY */}
          {activeLedgerView === 'summary' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/90 border-b border-[#E2E8F0] text-[#64748B] uppercase tracking-wider font-semibold text-[11px]">
                <tr>
                  {renderSummarySortHeader(isCustodyTracking ? 'Standard Item Name' : 'Item / Service Description', 'item_name', 'left')}
                  {isCustodyTracking ? (
                    <>
                      {renderSummarySortHeader('Total Picked Up', 'total_picked_up', 'center')}
                      {renderSummarySortHeader('Total Delivered', 'total_delivered', 'center')}
                      {renderSummarySortHeader('Linen Loss Discrepancy', 'linen_discrepancy', 'center')}
                    </>
                  ) : (
                    renderSummarySortHeader('Total Quantity', 'total_delivered', 'center')
                  )}
                  {renderSummarySortHeader('Unit Rate', 'unit_price', 'right')}
                  {renderSummarySortHeader('Total Billed', 'total_billed', 'right')}
                  {renderSummarySortHeader(isCustodyTracking ? 'Slips Count' : 'Documents Count', 'slips_count', 'center')}
                  <th className="py-3 px-4 text-center">Reviewed</th>
                  <th className="py-3 px-4 text-center">Approved</th>
                  {renderSummarySortHeader('Status', 'status', 'center')}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] text-[#334155] font-medium bg-white">
                {sortedSummaryRows.length > 0 ? (
                  sortedSummaryRows.map((row) => {
                    const lossQty = row.linen_discrepancy || 0;
                    return (
                      <tr
                        key={row.item_name}
                        className={`hover:bg-slate-50/80 transition-colors ${
                          row.is_fully_approved ? 'bg-[#ECFDF5]/50' : (isCustodyTracking && lossQty > 0) ? 'border-l-2 border-l-[#E11D48] bg-[#FFF1F2]/50' : ''
                        }`}
                      >
                        <td className="py-3 px-4 font-bold text-[#0F172A] whitespace-nowrap">{toTitleCase(row.item_name)}</td>
                        {isCustodyTracking ? (
                          <>
                            <td className="py-3 px-4 text-center font-mono whitespace-nowrap text-[#0F172A]">{row.total_picked_up}</td>
                            <td className="py-3 px-4 text-center font-mono whitespace-nowrap text-[#0F172A]">{row.total_delivered}</td>
                            <td className="py-3 px-4 text-center whitespace-nowrap">
                              {lossQty > 0 ? (
                                <span className="inline-flex items-center gap-1 text-[#E11D48] font-mono font-bold bg-[#FFF1F2] border border-[#FECDD3] px-2 py-0.5 rounded-full text-[11px] shadow-xs">
                                  <AlertTriangle className="w-3 h-3 text-[#E11D48] shrink-0" />
                                  <span>-{lossQty} missing</span>
                                </span>
                              ) : (
                                <span className="text-slate-400 font-mono text-xs">-</span>
                              )}
                            </td>
                          </>
                        ) : (
                          <td className="py-3 px-4 text-center font-mono font-bold text-[#0F172A] whitespace-nowrap">{row.total_delivered}</td>
                        )}
                        <td className="py-3 px-4 text-right font-mono whitespace-nowrap text-[#475569]">{formatCurrency(row.unit_rate ?? row.unit_price ?? 0)}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-[#059669] whitespace-nowrap">
                          {formatCurrency(row.total_billed)}
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-[#64748B] whitespace-nowrap">{row.slips_count}</td>
                        <td className="py-3 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(row.is_fully_reviewed)}
                            onChange={() => handleToggleSummaryApproval(row, 'reviewed')}
                            className="w-4 h-4 rounded border-slate-300 bg-white text-[#0284C7] focus:ring-[#0284C7] cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(row.is_fully_approved)}
                            onChange={() => handleToggleSummaryApproval(row, 'approved')}
                            className="w-4 h-4 rounded border-slate-300 bg-white text-[#059669] focus:ring-[#059669] cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                              row.is_fully_approved
                                ? 'bg-[#ECFDF5] border border-[#A7F3D0] text-[#059669]'
                                : 'bg-[#FEF3C7] border border-[#FDE68A] text-[#D97706]'
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
                    <td colSpan={10} className="py-12 text-center text-[#64748B] text-xs">
                      {isLoadingSummary
                        ? 'Loading PostgreSQL reconciliation summary...'
                        : `No AR summary line items found for ${selectedMonth} ${selectedYear}. Click 'Run AR Extraction' above to process daily control slips.`}
                    </td>
                  </tr>
                )}
              </tbody>
              {sortedSummaryRows.length > 0 && (
                <tfoot className="bg-slate-50/90 border-t-2 border-[#E2E8F0] font-bold text-xs text-[#0F172A]">
                  <tr>
                    <td className="py-3 px-4 font-bold text-[#0F172A] whitespace-nowrap">
                      Total ({sortedSummaryRows.length} {sortedSummaryRows.length === 1 ? 'item' : 'items'})
                    </td>
                    {isCustodyTracking ? (
                      <>
                        <td className="py-3 px-4 text-center font-mono whitespace-nowrap text-[#0F172A]">{summaryTotals.pick}</td>
                        <td className="py-3 px-4 text-center font-mono whitespace-nowrap text-[#0F172A]">{summaryTotals.deliv}</td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          {summaryTotals.loss > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[#E11D48] font-mono font-bold bg-[#FFF1F2] border border-[#FECDD3] px-2 py-0.5 rounded-full text-[11px] shadow-xs">
                              <AlertTriangle className="w-3 h-3 text-[#E11D48] shrink-0" />
                              <span>-{summaryTotals.loss} missing</span>
                            </span>
                          ) : (
                            <span className="text-slate-400 font-mono text-xs">-</span>
                          )}
                        </td>
                      </>
                    ) : (
                      <td className="py-3 px-4 text-center font-mono font-bold text-[#0F172A] whitespace-nowrap">{summaryTotals.deliv}</td>
                    )}
                    <td className="py-3 px-4 text-right font-mono text-slate-400 text-xs">-</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-[#059669] whitespace-nowrap text-sm">
                      {formatCurrency(summaryTotals.billed)}
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-[#64748B] whitespace-nowrap">{summaryTotals.slips}</td>
                    <td className="py-3 px-4 text-center text-slate-400 text-xs">-</td>
                    <td className="py-3 px-4 text-center text-slate-400 text-xs">-</td>
                    <td className="py-3 px-4 text-center text-slate-400 text-xs">-</td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}

          {/* VIEW 2A: IN-APP POSTGRESQL DAILY SLIPS - GROUPED BY SLIP */}
          {activeLedgerView === 'daily' && dailyViewMode === 'grouped' && (
            <div>
              <div className="bg-slate-50/90 border-b border-[#E2E8F0] px-4 py-2 flex items-center justify-between text-xs text-slate-600 font-medium">
                <label className="flex items-center gap-2 cursor-pointer hover:text-slate-900 select-none">
                  <input
                    type="checkbox"
                    checked={
                      paginatedGroupedSlips.length > 0 &&
                      paginatedGroupedSlips.every((s) => selectedSlipKeys.has(s.slipKey))
                    }
                    onChange={handleSelectAllVisibleSlips}
                    className="w-4 h-4 rounded border-slate-300 text-[#0284C7] focus:ring-[#0284C7] cursor-pointer"
                  />
                  <span className="font-semibold text-slate-800">
                    Select All Visible Slips ({paginatedGroupedSlips.length})
                  </span>
                </label>
                <div className="flex items-center gap-3 text-slate-500 font-mono text-[11px]">
                  {selectedSlipKeys.size > 0 && (
                    <span className="font-bold text-[#0284C7]">{selectedSlipKeys.size} selected</span>
                  )}
                  <span>Showing {paginatedGroupedSlips.length} of {groupedSlips.length} slips</span>
                </div>
              </div>

              <div className="divide-y divide-[#E2E8F0]">
                {paginatedGroupedSlips.length > 0 ? (
                  paginatedGroupedSlips.map((slip) => {
                    const expanded = isSlipExpanded(slip.slipKey);
                    return (
                      <div key={slip.slipKey} className="transition-colors">
                        {/* Slip Card Header */}
                        <div
                          className={`flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3.5 transition-colors ${
                            slip.isFullyApproved
                              ? 'bg-[#ECFDF5]/50 hover:bg-[#ECFDF5]/80'
                              : slip.totalLossQty > 0
                              ? 'border-l-4 border-l-[#E11D48] bg-[#FFF1F2]/50 hover:bg-[#FFF1F2]/80'
                              : 'bg-slate-50/70 hover:bg-slate-100/70'
                          }`}
                        >
                          {/* Left: Checkbox, Expand Chevron, Customer, Date, File Name Link, Badges */}
                          <div className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={selectedSlipKeys.has(slip.slipKey)}
                              onChange={(e) => {
                                e.stopPropagation();
                                handleToggleSelectSlip(slip.slipKey);
                              }}
                              className="w-4 h-4 rounded border-slate-300 text-[#0284C7] focus:ring-[#0284C7] cursor-pointer shrink-0"
                              title="Select slip for bulk actions"
                            />

                            <button
                              type="button"
                              onClick={() => toggleSlipExpanded(slip.slipKey)}
                              className="p-1 rounded hover:bg-slate-200/60 text-slate-500 hover:text-slate-800 transition cursor-pointer shrink-0"
                              title={expanded ? 'Collapse slip line items' : 'Expand slip line items'}
                            >
                              {expanded ? (
                                <ChevronUp className="w-4 h-4 text-slate-600" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-slate-600" />
                              )}
                            </button>

                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#F0F9FF] text-[#0284C7] border border-[#BAE6FD] shrink-0">
                                <Building2 className="w-3 h-3 text-[#0284C7]" />
                                <span>{slip.propertyName}</span>
                              </span>

                              {!slip.isCustomerReconciled ? (
                                <div className="inline-flex items-center gap-1 shrink-0">
                                  <span
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-300"
                                    title={`Customer '${slip.propertyName}' is not mapped to an active Zoho Books contact`}
                                  >
                                    <AlertTriangle className="w-3 h-3 text-amber-600" />
                                    <span>Unmapped Customer</span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setQuickLinkCustomerSlip(slip);
                                      setQuickLinkSelectedContactId(slip.reconciledContactId || '');
                                    }}
                                    className="text-[10px] font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-2 py-0.5 rounded-full transition cursor-pointer"
                                    title="Link this customer to an official Zoho Books contact"
                                  >
                                    Link
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setQuickLinkCustomerSlip(slip);
                                    setQuickLinkSelectedContactId(slip.reconciledContactId || '');
                                  }}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-slate-500 hover:text-[#0284C7] bg-slate-50 hover:bg-[#F0F9FF] border border-slate-200 hover:border-[#BAE6FD] transition shrink-0 cursor-pointer group"
                                  title={`Customer is mapped${slip.reconciledContactName ? ` to '${slip.reconciledContactName}'` : ''}. Click to re-map.`}
                                >
                                  <Link2 className="w-2.5 h-2.5 text-slate-400 group-hover:text-[#0284C7]" />
                                  <span>Re-map</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenEditSlipDate(slip);
                                }}
                                className="font-mono text-xs font-bold text-[#0F172A] bg-white px-2 py-0.5 rounded border border-[#E2E8F0] hover:border-[#0284C7] hover:text-[#0284C7] hover:bg-[#F0F9FF] transition shrink-0 whitespace-nowrap shadow-xs flex items-center gap-1 cursor-pointer group"
                                title="Click to correct date for this delivery slip"
                              >
                                <span>{slip.slipDate}</span>
                                <Edit3 className="w-2.5 h-2.5 text-slate-400 group-hover:text-[#0284C7]" />
                              </button>

                              {slip.hasLowConfidence && (
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 shrink-0"
                                  title={`AI OCR Confidence: ${Math.round(slip.minConfidence * 100)}% - Verify values`}
                                >
                                  <Sparkles className="w-3 h-3 text-purple-600" />
                                  <span>Low Conf ({Math.round(slip.minConfidence * 100)}%)</span>
                                </span>
                              )}

                              {slip.hasUnmappedItem && (
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 shrink-0"
                                  title={`${slip.unmappedItemsCount} uncataloged item(s) on this slip`}
                                >
                                  <Package className="w-3 h-3 text-rose-600" />
                                  <span>Uncataloged ({slip.unmappedItemsCount})</span>
                                </span>
                              )}

                              {!slip.isFullyReviewed && (
                                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200 shrink-0">
                                  Unreviewed
                                </span>
                              )}

                            {slip.driveUrl ? (
                              <a
                                href={slip.driveUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[#0284C7] hover:text-[#0369A1] hover:underline transition font-mono text-xs group max-w-[280px] truncate"
                                title={`Open original slip in Google Drive: ${slip.sourceFileName}`}
                              >
                                <span className="truncate">{slip.sourceFileName}</span>
                                <ExternalLink className="w-3 h-3 shrink-0 opacity-70 group-hover:opacity-100 transition text-[#0284C7]" />
                              </a>
                            ) : (
                              <span className="font-mono text-xs text-[#64748B] max-w-[280px] truncate block" title={slip.sourceFileName}>
                                {slip.sourceFileName}
                              </span>
                            )}

                            <span className="text-[11px] text-[#64748B] font-medium whitespace-nowrap">
                              ({slip.items.length} {slip.items.length === 1 ? 'item' : 'items'})
                            </span>
                          </div>
                        </div>

                        {/* Right: Aggregated Totals & 1-Click Approve Entire Slip Button */}
                        <div className="flex flex-wrap items-center gap-2.5 shrink-0 justify-between lg:justify-end">
                          <div className="flex items-center gap-1.5 text-xs font-mono">
                            {isCustodyTracking ? (
                              <>
                                <div className="bg-white px-2 py-1 rounded border border-[#E2E8F0] whitespace-nowrap shadow-xs" title="Total Picked Up">
                                  <span className="text-[#64748B] text-[10px] mr-1">PICK</span>
                                  <span className="text-[#0F172A] font-semibold">{slip.totalPickQty}</span>
                                </div>
                                <div className="bg-white px-2 py-1 rounded border border-[#E2E8F0] whitespace-nowrap shadow-xs" title="Total Delivered">
                                  <span className="text-[#64748B] text-[10px] mr-1">DELIV</span>
                                  <span className="text-[#0F172A] font-semibold">{slip.totalDelivQty}</span>
                                </div>
                                {slip.totalLossQty > 0 ? (
                                  <div
                                    className="bg-[#FFF1F2] px-2 py-1 rounded border border-[#FECDD3] text-[#E11D48] flex items-center gap-1 font-bold shadow-xs whitespace-nowrap"
                                    title="Linen Loss Discrepancy"
                                  >
                                    <AlertTriangle className="w-3 h-3 text-[#E11D48] shrink-0" />
                                    <span className="text-[10px] text-[#E11D48] uppercase">Loss</span>
                                    <span>-{slip.totalLossQty} missing</span>
                                  </div>
                                ) : (
                                  <div className="bg-white px-2 py-1 rounded border border-[#E2E8F0] text-slate-400 whitespace-nowrap shadow-xs" title="No Loss">
                                    <span className="text-[10px] mr-1">LOSS</span>
                                    <span>-</span>
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="bg-white px-2.5 py-1 rounded border border-[#E2E8F0] whitespace-nowrap shadow-xs" title="Total Quantity">
                                <span className="text-[#64748B] text-[10px] mr-1.5 uppercase font-sans">Total Qty:</span>
                                <span className="text-[#0F172A] font-semibold">{slip.totalDelivQty}</span>
                              </div>
                            )}
                            <div className="bg-white px-2.5 py-1 rounded border border-[#E2E8F0] text-right whitespace-nowrap shadow-xs" title="Total Amount">
                              <span className="font-bold text-[#059669]">{formatCurrency(slip.totalAmount)}</span>
                            </div>
                          </div>

                          {/* 1-Click Approve Entire Slip Button */}
                          <button
                            onClick={() => handleToggleSlipApproval(slip)}
                            disabled={approvingSlipKey === slip.slipKey}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer shadow-xs disabled:opacity-40 whitespace-nowrap ${
                              slip.isFullyApproved
                                ? 'bg-[#ECFDF5] border border-[#A7F3D0] text-[#059669] hover:bg-[#D1FAE5]'
                                : slip.isPartiallyApproved
                                ? 'bg-[#FEF3C7] border border-[#FDE68A] text-[#D97706] hover:bg-[#FDE68A]'
                                : 'bg-[#059669] hover:bg-[#047857] text-white'
                            }`}
                            title={slip.isFullyApproved ? 'Click to unapprove all items on this slip' : '1-Click Approve all line items on this slip'}
                          >
                            {approvingSlipKey === slip.slipKey ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                <span>Updating...</span>
                              </>
                            ) : slip.isFullyApproved ? (
                              <>
                                <CheckCheck className="w-3.5 h-3.5 text-[#059669]" />
                                <span>Slip Approved</span>
                              </>
                            ) : slip.isPartiallyApproved ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-[#D97706]" />
                                <span>Approve Rest ({slip.items.filter((i) => !i.approved).length})</span>
                              </>
                            ) : (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>Approve Slip ({slip.items.length})</span>
                              </>
                            )}
                          </button>

                          {/* Edit Slip Date */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEditSlipDate(slip);
                            }}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-100 bg-white border border-[#CBD5E1] hover:border-slate-400 transition cursor-pointer shadow-xs shrink-0"
                            title={`Correct date for all ${slip.items.length} items on "${slip.sourceFileName || 'this slip'}"`}
                          >
                            <Calendar className="w-3.5 h-3.5 text-slate-500" />
                            <span>Edit Date</span>
                          </button>

                          {/* Add Missing Item to this Slip */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartAddItem(slip);
                            }}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-[#0284C7] hover:bg-[#F0F9FF] bg-white border border-[#BAE6FD] hover:border-[#0284C7] transition cursor-pointer shadow-xs shrink-0"
                            title={`Add a line item missed by OCR to "${slip.sourceFileName || 'this slip'}"`}
                          >
                            <Plus className="w-3.5 h-3.5 text-[#0284C7]" />
                            <span>Add Item</span>
                          </button>

                          {/* Purge / Delete Mistakenly Uploaded Slip */}
                          <button
                            onClick={() => handleDeleteSlip(slip)}
                            disabled={deletingSlipKey === slip.slipKey}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-[#E11D48] hover:bg-[#FFF1F2] bg-white border border-[#FECDD3] transition cursor-pointer shadow-xs disabled:opacity-40 shrink-0"
                            title={`Delete all ${slip.items.length} unposted line items extracted from "${slip.sourceFileName || 'this slip'}"`}
                          >
                            {deletingSlipKey === slip.slipKey ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#E11D48]" />
                                <span>Deleting...</span>
                              </>
                            ) : (
                              <>
                                <Trash2 className="w-3.5 h-3.5 text-[#E11D48]" />
                                <span>Delete Slip</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Nested Slip Items Table (when expanded) */}
                      {expanded && (
                        <div className="bg-white border-t border-[#E2E8F0] px-2 py-1.5 overflow-x-auto custom-scrollbar">
                          <table className="w-full text-left text-xs">
                            <thead className="text-[#64748B] uppercase tracking-wider font-semibold text-[10px] border-b border-[#E2E8F0] bg-slate-50/70">
                              <tr>
                                <th className="py-2 px-3 text-left">{isCustodyTracking ? 'Item Description' : 'Item / Service Description'}</th>
                                {isCustodyTracking ? (
                                  <>
                                    <th className="py-2 px-3 text-center">Picked Up</th>
                                    <th className="py-2 px-3 text-center">Delivered</th>
                                    <th className="py-2 px-3 text-center">Linen Loss</th>
                                  </>
                                ) : (
                                  <th className="py-2 px-3 text-center">Quantity</th>
                                )}
                                <th className="py-2 px-3 text-right">Unit Rate</th>
                                <th className="py-2 px-3 text-right">Total Amount</th>
                                <th className="py-2 px-3 text-center">Reviewed</th>
                                <th className="py-2 px-3 text-center">Approved</th>
                                <th className="py-2 px-3 text-center">Status</th>
                                <th className="py-2 px-3 text-center">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E2E8F0] text-[#334155] font-medium bg-white">
                              {slip.items.map((tx) => {
                                if (editingTxId === tx.id) {
                                  const livePick = Math.max(0, Number(editPickQty) || 0);
                                  const liveDeliv = Math.max(0, Number(editDelivQty) || 0);
                                  const liveLoss = Math.max(0, livePick - liveDeliv);
                                  const liveRate = Math.max(0, Number(editRate) || 0);
                                  const liveTotal = Math.round(liveDeliv * liveRate * 100) / 100;

                                  return (
                                    <tr key={tx.id} className="bg-[#F0F9FF] border-2 border-[#0284C7]/50 shadow-inner">
                                      <td className="py-2 px-3 min-w-[280px]">
                                        <ZohoItemSearchableSelect
                                          items={zohoMasterItems}
                                          selectedItemName={editItemName}
                                          onSelect={handleZohoItemSelect}
                                          disabled={isSavingTx}
                                        />
                                      </td>
                                      {isCustodyTracking ? (
                                        <>
                                          <td className="py-2 px-3 text-center">
                                            <input
                                              type="number"
                                              min="0"
                                              value={editPickQty}
                                              onChange={(e) => setEditPickQty(e.target.value)}
                                              className="w-16 bg-white border border-[#CBD5E1] rounded px-1.5 py-1 text-center font-mono text-xs text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
                                            />
                                          </td>
                                          <td className="py-2 px-3 text-center">
                                            <input
                                              type="number"
                                              min="0"
                                              value={editDelivQty}
                                              onChange={(e) => setEditDelivQty(e.target.value)}
                                              className="w-16 bg-white border border-[#CBD5E1] rounded px-1.5 py-1 text-center font-mono text-xs text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
                                            />
                                          </td>
                                          <td className="py-2 px-3 text-center">
                                            {liveLoss > 0 ? (
                                              <span className="inline-flex items-center gap-1 font-mono font-bold px-2 py-0.5 rounded-full text-[11px] bg-[#FFF1F2] border border-[#FECDD3] text-[#E11D48] shadow-xs">
                                                <AlertTriangle className="w-3 h-3 text-[#E11D48] shrink-0" />
                                                <span>-{liveLoss} missing</span>
                                              </span>
                                            ) : (
                                              <span className="text-slate-400 font-mono text-xs">-</span>
                                            )}
                                          </td>
                                        </>
                                      ) : (
                                        <td className="py-2 px-3 text-center">
                                          <input
                                            type="number"
                                            min="0"
                                            value={editDelivQty}
                                            onChange={(e) => {
                                              setEditDelivQty(e.target.value);
                                              setEditPickQty(e.target.value);
                                            }}
                                            className="w-20 bg-white border border-[#CBD5E1] rounded px-1.5 py-1 text-center font-mono text-xs text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
                                          />
                                        </td>
                                      )}
                                      <td className="py-2 px-3 text-right">
                                        <div className="inline-flex items-center justify-end gap-1">
                                          <span className="text-[#64748B] text-[10px]">GHS</span>
                                          <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={editRate}
                                            onChange={(e) => setEditRate(e.target.value)}
                                            className="w-20 bg-white border border-[#CBD5E1] rounded px-1.5 py-1 text-right font-mono text-xs text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
                                          />
                                        </div>
                                      </td>
                                      <td className="py-2 px-3 text-right font-mono font-bold text-[#059669] whitespace-nowrap">
                                        {formatCurrency(liveTotal)}
                                      </td>
                                      <td className="py-2 px-3 text-center">
                                        <span className="text-[#0284C7] text-[11px] font-semibold" title="Will be marked reviewed on save">Auto</span>
                                      </td>
                                      <td className="py-2 px-3 text-center">
                                        <input
                                          type="checkbox"
                                          checked={Boolean(tx.approved)}
                                          onChange={() => handleToggleTx(tx.id, 'approved', tx.approved)}
                                          className="w-4 h-4 rounded border-slate-300 bg-white text-[#059669] focus:ring-[#059669] cursor-pointer"
                                        />
                                      </td>
                                      <td className="py-2 px-3 text-center">
                                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-[#F0F9FF] border border-[#BAE6FD] text-[#0284C7]">
                                          EDITING
                                        </span>
                                      </td>
                                      <td className="py-2 px-3 text-center whitespace-nowrap">
                                        <div className="flex items-center justify-center gap-1.5">
                                          <button
                                            onClick={() => handleSaveEdit(tx.id)}
                                            disabled={isSavingTx}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-[#0284C7] hover:bg-[#0369A1] text-white transition shadow-xs cursor-pointer disabled:opacity-50"
                                            title="Save changes"
                                          >
                                            <Save className="w-3.5 h-3.5" />
                                            <span>{isSavingTx ? 'Saving...' : 'Save'}</span>
                                          </button>
                                          <button
                                            onClick={handleCancelEdit}
                                            disabled={isSavingTx}
                                            className="inline-flex items-center p-1 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition cursor-pointer"
                                            title="Cancel editing"
                                          >
                                            <X className="w-3.5 h-3.5" />
                                          </button>
                                          <button
                                            onClick={() => handleDeleteRow(tx.id)}
                                            disabled={deletingTxId === tx.id}
                                            className="inline-flex items-center p-1 rounded-md text-[#E11D48] hover:bg-rose-50 border border-[#FECDD3] transition cursor-pointer"
                                            title="Delete this mistakenly ingested row"
                                          >
                                            {deletingTxId === tx.id ? (
                                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#E11D48]" />
                                            ) : (
                                              <Trash2 className="w-3.5 h-3.5 text-[#E11D48]" />
                                            )}
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                }

                                const lossQty = tx.discrepancy_amount || 0;
                                const pickQty = tx.credit_amount || tx.quantity_or_debit || 0;
                                const delivQty = tx.quantity_or_debit || 0;
                                const rate = tx.rate_or_price || 0;
                                const total = tx.total_amount || 0;

                                return (
                                  <tr
                                    key={tx.id}
                                    className={`hover:bg-slate-50/80 transition-colors ${
                                      tx.approved
                                        ? 'bg-[#ECFDF5]/40'
                                        : lossQty > 0
                                        ? 'border-l-2 border-l-[#E11D48] bg-[#FFF1F2]/40'
                                        : ''
                                    }`}
                                  >
                                    <td className="py-2.5 px-3 font-bold text-[#0F172A] whitespace-nowrap">
                                      <div className="flex items-center gap-1.5 group">
                                        <span>{toTitleCase(tx.item_or_description)}</span>
                                        {isTxUnmappedCatalog(tx) && (
                                          <span
                                            className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 shrink-0"
                                            title="Item not found in active Zoho Books Item Master"
                                          >
                                            Uncataloged
                                          </span>
                                        )}
                                        <button
                                          onClick={() => handleStartEdit(tx)}
                                          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-slate-100 rounded text-slate-400 hover:text-[#0284C7] transition"
                                          title="Edit item name or details"
                                        >
                                          <Edit3 className="w-3 h-3" />
                                        </button>
                                      </div>
                                    </td>
                                    {isCustodyTracking ? (
                                      <>
                                        <td className="py-2.5 px-3 text-center font-mono whitespace-nowrap text-[#0F172A]">{pickQty}</td>
                                        <td className="py-2.5 px-3 text-center font-mono whitespace-nowrap text-[#0F172A]">{delivQty}</td>
                                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                          {lossQty > 0 ? (
                                            <span className="inline-flex items-center gap-1 font-mono font-bold px-2 py-0.5 rounded-full text-[11px] bg-[#FFF1F2] border border-[#FECDD3] text-[#E11D48] shadow-xs">
                                              <AlertTriangle className="w-3 h-3 text-[#E11D48] shrink-0" />
                                              <span>-{lossQty} missing</span>
                                            </span>
                                          ) : (
                                            <span className="text-slate-400 font-mono text-xs">-</span>
                                          )}
                                        </td>
                                      </>
                                    ) : (
                                      <td className="py-2.5 px-3 text-center font-mono font-bold text-[#0F172A] whitespace-nowrap">{delivQty}</td>
                                    )}
                                    <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap text-[#475569]">
                                      {formatCurrency(rate)}
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-mono font-bold text-[#059669] whitespace-nowrap">
                                      {formatCurrency(total)}
                                    </td>
                                    <td className="py-2.5 px-3 text-center">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(tx.reviewed)}
                                        onChange={() => handleToggleTx(tx.id, 'reviewed', tx.reviewed)}
                                        className="w-4 h-4 rounded border-slate-300 bg-white text-[#0284C7] focus:ring-[#0284C7] cursor-pointer"
                                      />
                                    </td>
                                    <td className="py-2.5 px-3 text-center">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(tx.approved)}
                                        onChange={() => handleToggleTx(tx.id, 'approved', tx.approved)}
                                        className="w-4 h-4 rounded border-slate-300 bg-white text-[#059669] focus:ring-[#059669] cursor-pointer"
                                      />
                                    </td>
                                    <td className="py-2.5 px-3 text-center">
                                      <span
                                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                                          tx.status === 'INVOICED'
                                            ? 'bg-[#F0F9FF] border border-[#BAE6FD] text-[#0284C7]'
                                            : tx.approved
                                            ? 'bg-[#ECFDF5] border border-[#A7F3D0] text-[#059669]'
                                            : 'bg-[#FEF3C7] border border-[#FDE68A] text-[#D97706]'
                                        }`}
                                      >
                                        {tx.status === 'INVOICED' ? 'INVOICED' : tx.approved ? 'APPROVED' : tx.status || 'PENDING'}
                                      </span>
                                    </td>
                                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                      <div className="inline-flex items-center gap-1">
                                        <button
                                          onClick={() => handleStartEdit(tx)}
                                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-slate-600 hover:text-[#0284C7] hover:bg-slate-100 border border-[#E2E8F0] hover:border-[#BAE6FD] transition cursor-pointer"
                                          title="Edit item name, quantities, or rate"
                                        >
                                          <Edit3 className="w-3 h-3 text-[#0284C7]" />
                                          <span>Edit</span>
                                        </button>
                                        {tx.status !== 'INVOICED' && (
                                          <button
                                            onClick={() => handleDeleteRow(tx.id)}
                                            disabled={deletingTxId === tx.id}
                                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold text-[#E11D48] hover:bg-rose-50 border border-[#FECDD3] transition cursor-pointer"
                                            title="Delete this line item from database"
                                          >
                                            {deletingTxId === tx.id ? (
                                              <RefreshCw className="w-3 h-3 animate-spin text-[#E11D48]" />
                                            ) : (
                                              <Trash2 className="w-3 h-3 text-[#E11D48]" />
                                            )}
                                            <span>Delete</span>
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}

                              {/* Inline New Item Form Row */}
                              {addingItemSlipKey === slip.slipKey ? (
                                <tr className="bg-[#F0FDF4] border-2 border-[#16A34A]/50 shadow-inner">
                                  <td className="py-2 px-3 min-w-[280px]">
                                    <ZohoItemSearchableSelect
                                      items={zohoMasterItems}
                                      selectedItemName={newItemName}
                                      onSelect={handleZohoNewItemSelect}
                                      disabled={isAddingItem}
                                    />
                                  </td>
                                  {isCustodyTracking ? (
                                    <>
                                      <td className="py-2 px-3 text-center">
                                        <input
                                          type="number"
                                          min="0"
                                          value={newItemPickQty}
                                          onChange={(e) => setNewItemPickQty(e.target.value)}
                                          className="w-16 bg-white border border-[#CBD5E1] rounded px-1.5 py-1 text-center font-mono text-xs text-[#0F172A] focus:outline-none focus:border-[#16A34A]"
                                          placeholder="Pick"
                                        />
                                      </td>
                                      <td className="py-2 px-3 text-center">
                                        <input
                                          type="number"
                                          min="0"
                                          value={newItemDelivQty}
                                          onChange={(e) => setNewItemDelivQty(e.target.value)}
                                          className="w-16 bg-white border border-[#CBD5E1] rounded px-1.5 py-1 text-center font-mono text-xs text-[#0F172A] focus:outline-none focus:border-[#16A34A]"
                                          placeholder="Deliv"
                                        />
                                      </td>
                                      <td className="py-2 px-3 text-center">
                                        {Math.max(0, (Number(newItemPickQty) || 0) - (Number(newItemDelivQty) || 0)) > 0 ? (
                                          <span className="inline-flex items-center gap-1 font-mono font-bold px-2 py-0.5 rounded-full text-[11px] bg-[#FFF1F2] border border-[#FECDD3] text-[#E11D48]">
                                            -{Math.max(0, (Number(newItemPickQty) || 0) - (Number(newItemDelivQty) || 0))}
                                          </span>
                                        ) : (
                                          <span className="text-slate-400 font-mono text-xs">-</span>
                                        )}
                                      </td>
                                    </>
                                  ) : (
                                    <td className="py-2 px-3 text-center">
                                      <input
                                        type="number"
                                        min="0"
                                        value={newItemDelivQty}
                                        onChange={(e) => {
                                          setNewItemDelivQty(e.target.value);
                                          setNewItemPickQty(e.target.value);
                                        }}
                                        className="w-20 bg-white border border-[#CBD5E1] rounded px-1.5 py-1 text-center font-mono text-xs text-[#0F172A] focus:outline-none focus:border-[#16A34A]"
                                      />
                                    </td>
                                  )}
                                  <td className="py-2 px-3 text-right">
                                    <div className="inline-flex items-center justify-end gap-1">
                                      <span className="text-[#64748B] text-[10px]">GHS</span>
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={newItemRate}
                                        onChange={(e) => setNewItemRate(e.target.value)}
                                        className="w-20 bg-white border border-[#CBD5E1] rounded px-1.5 py-1 text-right font-mono text-xs text-[#0F172A] focus:outline-none focus:border-[#16A34A]"
                                      />
                                    </div>
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono font-bold text-[#059669] whitespace-nowrap">
                                    {formatCurrency(Math.round((Number(newItemDelivQty) || 0) * (Number(newItemRate) || 0) * 100) / 100)}
                                  </td>
                                  <td className="py-2 px-3 text-center">
                                    <span className="text-[#16A34A] text-[11px] font-semibold" title="Auto-reviewed">Auto</span>
                                  </td>
                                  <td className="py-2 px-3 text-center">
                                    <span className="text-[#16A34A] text-[11px] font-semibold" title="Auto-approved">Auto</span>
                                  </td>
                                  <td className="py-2 px-3 text-center">
                                    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-[#ECFDF5] border border-[#A7F3D0] text-[#059669]">
                                      NEW
                                    </span>
                                  </td>
                                  <td className="py-2 px-3 text-center whitespace-nowrap">
                                    <div className="flex items-center justify-center gap-1.5">
                                      <button
                                        onClick={() => handleSaveNewItem(slip)}
                                        disabled={isAddingItem || !newItemName.trim()}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-[#16A34A] hover:bg-[#15803D] text-white transition shadow-xs cursor-pointer disabled:opacity-50"
                                        title="Add item to slip"
                                      >
                                        <Save className="w-3.5 h-3.5" />
                                        <span>{isAddingItem ? 'Adding...' : 'Add'}</span>
                                      </button>
                                      <button
                                        onClick={handleCancelAddItem}
                                        disabled={isAddingItem}
                                        className="inline-flex items-center p-1 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition cursor-pointer"
                                        title="Cancel"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ) : (
                                <tr className="bg-slate-50/50 hover:bg-[#F0F9FF]/60 transition border-t border-[#E2E8F0]">
                                  <td colSpan={isCustodyTracking ? 10 : 8} className="py-2 px-3">
                                    <button
                                      onClick={() => handleStartAddItem(slip)}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#0284C7] hover:text-[#0369A1] hover:bg-[#E0F2FE] transition cursor-pointer border border-dashed border-[#BAE6FD]"
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                      <span>Add Missed Item to this Slip</span>
                                    </button>
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="py-12 text-center text-[#64748B] text-xs">
                  {isLoadingTx
                    ? 'Loading daily slips from PostgreSQL...'
                    : dailyCounts.all === 0
                    ? "No daily slips found in database for this period. Click 'Run AR Extraction' above to process control slips."
                    : 'No daily slips match the selected filter criteria.'}
                </div>
              )}
              </div>
            </div>
          )}

          {/* VIEW 2B: IN-APP POSTGRESQL DAILY SLIPS - FLAT TABLE */}
          {activeLedgerView === 'daily' && dailyViewMode === 'flat' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/90 border-b border-[#E2E8F0] text-[#64748B] uppercase tracking-wider font-semibold text-[11px]">
                <tr>
                  {renderDailySortHeader('Date', 'transaction_date', 'left')}
                  {renderDailySortHeader(isCustodyTracking ? 'Slip Filename' : 'Document Reference', 'source_file_name', 'left')}
                  {renderDailySortHeader(isCustodyTracking ? 'Item Description' : 'Item / Service Description', 'item_or_description', 'left')}
                  {isCustodyTracking ? (
                    <>
                      {renderDailySortHeader('Picked Up', 'pickQty', 'center')}
                      {renderDailySortHeader('Delivered', 'delivQty', 'center')}
                      {renderDailySortHeader('Linen Loss', 'discrepancy_amount', 'center')}
                    </>
                  ) : (
                    renderDailySortHeader('Quantity', 'delivQty', 'center')
                  )}
                  {renderDailySortHeader('Unit Rate', 'rate_or_price', 'right')}
                  {renderDailySortHeader('Total Amount', 'total_amount', 'right')}
                  <th className="py-3 px-4 text-center">Reviewed</th>
                  <th className="py-3 px-4 text-center">Approved</th>
                  {renderDailySortHeader('Status', 'status', 'center')}
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] text-[#334155] font-medium">
                {paginatedArStagedTx.length > 0 ? (
                  paginatedArStagedTx.map((tx) => {
                    const driveUrl = tx.metadata_json?.drive_file_url ||
                      (tx.source_identifier ? `https://drive.google.com/file/d/${tx.source_identifier}/view` : null);

                    if (editingTxId === tx.id) {
                      const livePick = Math.max(0, Number(editPickQty) || 0);
                      const liveDeliv = Math.max(0, Number(editDelivQty) || 0);
                      const liveLoss = Math.max(0, livePick - liveDeliv);
                      const liveRate = Math.max(0, Number(editRate) || 0);
                      const liveTotal = Math.round(liveDeliv * liveRate * 100) / 100;

                      return (
                        <tr key={tx.id} className="bg-sky-50/70 border-2 border-sky-400 shadow-xs">
                          <td className="py-3 px-4 font-mono text-[#0F172A] font-semibold whitespace-nowrap">{tx.transaction_date || '-'}</td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {driveUrl ? (
                              <a
                                href={driveUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-sky-600 hover:text-sky-700 hover:underline transition font-mono text-[11px] group max-w-[220px]"
                                title={`Open original slip in Google Drive: ${tx.source_file_name}`}
                              >
                                <span className="truncate">{tx.source_file_name || 'Slip Document'}</span>
                                <ExternalLink className="w-3 h-3 shrink-0 opacity-70 group-hover:opacity-100 transition text-sky-600" />
                              </a>
                            ) : (
                              <span className="font-mono text-[11px] text-slate-500 max-w-[180px] truncate block" title={tx.source_file_name}>
                                {tx.source_file_name || 'Slip'}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 min-w-[280px]">
                            <ZohoItemSearchableSelect
                              items={zohoMasterItems}
                              selectedItemName={editItemName}
                              onSelect={handleZohoItemSelect}
                              disabled={isSavingTx}
                            />
                          </td>
                          {isCustodyTracking ? (
                            <>
                              <td className="py-2.5 px-4 text-center">
                                <input
                                  type="number"
                                  min="0"
                                  value={editPickQty}
                                  onChange={(e) => setEditPickQty(e.target.value)}
                                  className="w-16 bg-white border border-[#CBD5E1] rounded px-1.5 py-1 text-center font-mono text-xs text-[#0F172A] focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                                />
                              </td>
                              <td className="py-2.5 px-4 text-center">
                                <input
                                  type="number"
                                  min="0"
                                  value={editDelivQty}
                                  onChange={(e) => setEditDelivQty(e.target.value)}
                                  className="w-16 bg-white border border-[#CBD5E1] rounded px-1.5 py-1 text-center font-mono text-xs text-[#0F172A] focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                                />
                              </td>
                              <td className="py-2.5 px-4 text-center">
                                {liveLoss > 0 ? (
                                  <span className="inline-flex items-center gap-1 font-mono font-bold px-2 py-0.5 rounded-full text-[11px] bg-rose-50 border border-rose-200 text-rose-700 shadow-2xs">
                                    <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                                    <span>-{liveLoss} missing</span>
                                  </span>
                                ) : (
                                  <span className="text-slate-400 font-mono text-xs">-</span>
                                )}
                              </td>
                            </>
                          ) : (
                            <td className="py-2.5 px-4 text-center">
                              <input
                                type="number"
                                min="0"
                                value={editDelivQty}
                                onChange={(e) => {
                                  setEditDelivQty(e.target.value);
                                  setEditPickQty(e.target.value);
                                }}
                                className="w-16 bg-white border border-[#CBD5E1] rounded px-1.5 py-1 text-center font-mono text-xs text-[#0F172A] focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                              />
                            </td>
                          )}
                          <td className="py-2.5 px-4 text-right">
                            <div className="inline-flex items-center justify-end gap-1">
                              <span className="text-slate-500 text-[10px]">GHS</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={editRate}
                                onChange={(e) => setEditRate(e.target.value)}
                                className="w-20 bg-white border border-[#CBD5E1] rounded px-1.5 py-1 text-right font-mono text-xs text-[#0F172A] focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                              />
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-bold text-emerald-600 whitespace-nowrap">
                            {formatCurrency(liveTotal)}
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            <span className="text-sky-600 text-[11px] font-semibold" title="Will be marked reviewed on save">Auto</span>
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            <input
                              type="checkbox"
                              checked={Boolean(tx.approved)}
                              onChange={() => handleToggleTx(tx.id, 'approved', tx.approved)}
                              className="w-4 h-4 rounded border-[#CBD5E1] bg-white text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                            />
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-sky-50 border border-sky-200 text-sky-700">
                              EDITING
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-center whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => handleSaveEdit(tx.id)}
                                disabled={isSavingTx}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-[#0284C7] hover:bg-sky-600 text-white transition shadow-xs cursor-pointer disabled:opacity-50"
                                title="Save changes"
                              >
                                <Save className="w-3.5 h-3.5" />
                                <span>{isSavingTx ? 'Saving...' : 'Save'}</span>
                              </button>
                              <button
                                onClick={handleCancelEdit}
                                disabled={isSavingTx}
                                className="inline-flex items-center p-1 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer"
                                title="Cancel editing"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteRow(tx.id)}
                                disabled={deletingTxId === tx.id}
                                className="inline-flex items-center p-1 rounded-md text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200 transition cursor-pointer"
                                title="Delete this mistakenly ingested row"
                              >
                                {deletingTxId === tx.id ? (
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-600" />
                                ) : (
                                  <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    const lossQty = tx.discrepancy_amount || 0;
                    const pickQty = tx.credit_amount || tx.quantity_or_debit || 0;
                    const delivQty = tx.quantity_or_debit || 0;
                    const rate = tx.rate_or_price || 0;
                    const total = tx.total_amount || 0;

                    return (
                      <tr
                        key={tx.id}
                        className={`hover:bg-slate-50/80 transition-colors ${
                          tx.approved ? 'bg-emerald-50/40' : (isCustodyTracking && lossQty > 0) ? 'border-l-2 border-l-rose-500 bg-rose-50/40' : ''
                        }`}
                      >
                        <td className="py-3 px-4 font-mono text-[#0F172A] font-semibold whitespace-nowrap">{tx.transaction_date || '-'}</td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {driveUrl ? (
                            <a
                              href={driveUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-sky-600 hover:text-sky-700 hover:underline transition font-mono text-[11px] group max-w-[220px]"
                              title={`Open original slip in Google Drive: ${tx.source_file_name}`}
                            >
                              <span className="truncate">{tx.source_file_name || 'Slip Document'}</span>
                              <ExternalLink className="w-3 h-3 shrink-0 opacity-70 group-hover:opacity-100 transition text-sky-600" />
                            </a>
                          ) : (
                            <span className="font-mono text-[11px] text-slate-500 max-w-[180px] truncate block" title={tx.source_file_name}>
                              {tx.source_file_name || 'Slip'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-bold text-[#0F172A] whitespace-nowrap">
                          <div className="flex items-center gap-1.5 group">
                            <span>{toTitleCase(tx.item_or_description)}</span>
                            {isTxUnmappedCatalog(tx) && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 shrink-0"
                                title="Item not found in active Zoho Books Item Master"
                              >
                                Uncataloged
                              </span>
                            )}
                            <button
                              onClick={() => handleStartEdit(tx)}
                              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-slate-100 rounded text-slate-400 hover:text-sky-600 transition"
                              title="Edit item name or details"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                        {isCustodyTracking ? (
                          <>
                            <td className="py-3 px-4 text-center font-mono text-[#0F172A] whitespace-nowrap">{pickQty}</td>
                            <td className="py-3 px-4 text-center font-mono text-[#0F172A] whitespace-nowrap">{delivQty}</td>
                            <td className="py-3 px-4 text-center whitespace-nowrap">
                              {lossQty > 0 ? (
                                <span className="inline-flex items-center gap-1 font-mono font-bold px-2 py-0.5 rounded-full text-[11px] bg-rose-50 border border-rose-200 text-rose-700 shadow-2xs">
                                  <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                                  <span>-{lossQty} missing</span>
                                </span>
                              ) : (
                                <span className="text-slate-400 font-mono text-xs">-</span>
                              )}
                            </td>
                          </>
                        ) : (
                          <td className="py-3 px-4 text-center font-mono font-bold text-[#0F172A] whitespace-nowrap">{delivQty}</td>
                        )}
                        <td className="py-3 px-4 text-right font-mono text-[#334155] whitespace-nowrap">{formatCurrency(rate)}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600 whitespace-nowrap">
                          {formatCurrency(total)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(tx.reviewed)}
                            onChange={() => handleToggleTx(tx.id, 'reviewed', tx.reviewed)}
                            className="w-4 h-4 rounded border-[#CBD5E1] bg-white text-sky-600 focus:ring-sky-500 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(tx.approved)}
                            onChange={() => handleToggleTx(tx.id, 'approved', tx.approved)}
                            className="w-4 h-4 rounded border-[#CBD5E1] bg-white text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                              tx.status === 'INVOICED'
                                ? 'bg-sky-50 border border-sky-200 text-sky-700'
                                : tx.approved
                                ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                                : 'bg-amber-50 border border-amber-200 text-amber-700'
                            }`}
                          >
                            {tx.status === 'INVOICED' ? 'INVOICED' : tx.approved ? 'APPROVED' : tx.status || 'PENDING'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              onClick={() => handleStartEdit(tx)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-slate-600 hover:text-sky-700 hover:bg-sky-50 border border-slate-200 hover:border-sky-300 transition cursor-pointer"
                              title="Edit item name, quantities, or rate"
                            >
                              <Edit3 className="w-3 h-3 text-sky-600" />
                              <span>Edit</span>
                            </button>
                            {tx.status !== 'INVOICED' && (
                              <button
                                onClick={() => handleDeleteRow(tx.id)}
                                disabled={deletingTxId === tx.id}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 hover:border-rose-300 transition cursor-pointer"
                                title="Delete this line item from database"
                              >
                                {deletingTxId === tx.id ? (
                                  <RefreshCw className="w-3 h-3 animate-spin text-rose-600" />
                                ) : (
                                  <Trash2 className="w-3 h-3 text-rose-600" />
                                )}
                                <span>Delete</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={isCustodyTracking ? 12 : 10} className="py-12 text-center text-slate-500 text-xs">
                      {isLoadingTx
                        ? 'Loading daily slips from PostgreSQL...'
                        : dailyCounts.all === 0
                        ? "No daily slips found in database for this period. Click 'Run AR Extraction' above to process control slips."
                        : 'No daily slips match the selected filter criteria.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer for Daily Slips (Pagination for Flat Table or Count for Grouped) */}
        {activeLedgerView === 'daily' && totalDailyCount > 0 && (
          <div className="bg-slate-50/90 border-t border-[#E2E8F0] px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#64748B]">
            {dailyViewMode === 'grouped' ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between w-full gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <FolderKanban className="w-4 h-4 text-sky-600 shrink-0" />
                    <span>
                      Showing slips{' '}
                      <strong className="text-[#0F172A] font-mono">
                        {groupedPageSize === 'all' ? 1 : Math.min((groupedCurrentPage - 1) * Number(groupedPageSize) + 1, totalGroupedCount)}
                      </strong>{' '}
                      to{' '}
                      <strong className="text-[#0F172A] font-mono">
                        {groupedPageSize === 'all' ? totalGroupedCount : Math.min(groupedCurrentPage * Number(groupedPageSize), totalGroupedCount)}
                      </strong>{' '}
                      of <strong className="text-[#0F172A] font-mono">{totalGroupedCount}</strong> slips
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 ml-2">
                    <span className="text-slate-500 text-[11px]">Slips per page:</span>
                    {[10, 20, 50, 'all'].map((size) => (
                      <button
                        key={String(size)}
                        onClick={() => setGroupedPageSize(size as any)}
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer ${
                          groupedPageSize === size
                            ? 'bg-[#0284C7] text-white shadow-xs'
                            : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {size === 'all' ? 'All' : size}
                      </button>
                    ))}
                  </div>
                </div>

                {groupedPageSize !== 'all' && totalGroupedPages > 1 && (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setGroupedCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={groupedCurrentPage === 1}
                      className="p-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
                      title="Previous slips page"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-slate-600 font-mono text-xs px-2">
                      Page {groupedCurrentPage} of {totalGroupedPages}
                    </span>
                    <button
                      onClick={() => setGroupedCurrentPage((p) => Math.min(totalGroupedPages, p + 1))}
                      disabled={groupedCurrentPage >= totalGroupedPages}
                      className="p-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
                      title="Next slips page"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <span>
                    Showing{' '}
                    <strong className="text-[#0F172A] font-mono">
                      {dailyPageSize === 'all' ? 1 : Math.min((dailyCurrentPage - 1) * Number(dailyPageSize) + 1, totalDailyCount)}
                    </strong>{' '}
                    to{' '}
                    <strong className="text-[#0F172A] font-mono">
                      {dailyPageSize === 'all' ? totalDailyCount : Math.min(dailyCurrentPage * Number(dailyPageSize), totalDailyCount)}
                    </strong>{' '}
                    of <strong className="text-[#0F172A] font-mono">{totalDailyCount}</strong> items
                  </span>

                  <div className="flex items-center gap-1.5 ml-2">
                    <span className="text-slate-500 text-[11px]">Show:</span>
                    {[25, 50, 100, 'all'].map((size) => (
                      <button
                        key={String(size)}
                        onClick={() => setDailyPageSize(size as any)}
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer ${
                          dailyPageSize === size
                            ? 'bg-[#0284C7] text-white shadow-xs'
                            : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {size === 'all' ? 'All' : size}
                      </button>
                    ))}
                  </div>
                </div>

                {dailyPageSize !== 'all' && totalDailyPages > 1 && (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setDailyCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={dailyCurrentPage === 1}
                      className="p-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
                      title="Previous page"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>

                    <span className="px-2 font-mono text-slate-600 text-xs">
                      Page <strong className="text-[#0F172A]">{dailyCurrentPage}</strong> of{' '}
                      <strong className="text-[#0F172A]">{totalDailyPages}</strong>
                    </span>

                    <button
                      onClick={() => setDailyCurrentPage((p) => Math.min(totalDailyPages, p + 1))}
                      disabled={dailyCurrentPage === totalDailyPages}
                      className="p-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
                      title="Next page"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Manual Delivery / AR Slip Creation Modal */}
      {isAddSlipModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-[#0284C7]" />
                <h3 className="text-base font-bold text-[#0F172A]">Record Manual Delivery Slip</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddSlipModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {createSlipError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-medium flex items-center gap-2 animate-in fade-in">
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                <span className="flex-1">{createSlipError}</span>
              </div>
            )}

            <form onSubmit={handleCreateManualSlip} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Customer Name <span className="text-rose-500">*</span>
                </label>
                {availableProperties.length > 0 ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      list="arCustomerSuggestions"
                      value={manualSlipCustomer}
                      onChange={(e) => {
                        setManualSlipCustomer(e.target.value);
                        setManualSlipDocName(`Manual_Slip_${e.target.value.replace(/\s+/g, '_')}_${manualSlipDate}`);
                      }}
                      placeholder="Select or enter customer name..."
                      required
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-[#0284C7]"
                    />
                    <datalist id="arCustomerSuggestions">
                      {availableProperties.map((p) => (
                        <option key={p} value={p} />
                      ))}
                    </datalist>
                  </div>
                ) : (
                  <input
                    type="text"
                    value={manualSlipCustomer}
                    onChange={(e) => {
                      setManualSlipCustomer(e.target.value);
                      setManualSlipDocName(`Manual_Slip_${e.target.value.replace(/\s+/g, '_')}_${manualSlipDate}`);
                    }}
                    placeholder="e.g. Labadi Beach Hotel"
                    required
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-[#0284C7]"
                  />
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Slip Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={manualSlipDate}
                    onChange={(e) => {
                      setManualSlipDate(e.target.value);
                      setManualSlipDocName(`Manual_Slip_${manualSlipCustomer.replace(/\s+/g, '_')}_${e.target.value}`);
                    }}
                    required
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-[#0284C7]"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Slip Document / Ref #</label>
                  <input
                    type="text"
                    value={manualSlipDocName}
                    onChange={(e) => setManualSlipDocName(e.target.value)}
                    placeholder="e.g. Manual_Slip_Customer_2026-09-15"
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 font-mono focus:outline-none focus:border-[#0284C7]"
                  />
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <div className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">Initial Line Item</div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Item / Service <span className="text-rose-500">*</span>
                  </label>
                  <ZohoItemSearchableSelect
                    items={zohoMasterItems}
                    selectedItemName={manualSlipItemName}
                    onSelect={(it) => {
                      setManualSlipItemName(it.name);
                      if (it.rate != null && it.rate > 0) setManualSlipRate(it.rate);
                    }}
                    onTextChange={(val) => setManualSlipItemName(val)}
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {isCustodyTracking && (
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Pickup Qty</label>
                      <input
                        type="number"
                        min="0"
                        value={manualSlipPickQty}
                        onChange={(e) => setManualSlipPickQty(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-mono focus:outline-none focus:border-[#0284C7]"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Delivered Qty <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={manualSlipDelivQty}
                      onChange={(e) => setManualSlipDelivQty(e.target.value)}
                      required
                      className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-mono focus:outline-none focus:border-[#0284C7]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Unit Rate</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={manualSlipRate}
                      onChange={(e) => setManualSlipRate(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-mono focus:outline-none focus:border-[#0284C7]"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200">
                  <span className="text-slate-500">Calculated Total:</span>
                  <span className="font-mono font-bold text-emerald-600 text-sm">
                    {formatCurrency((Number(manualSlipDelivQty) || 0) * (Number(manualSlipRate) || 0))}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddSlipModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingSlip}
                  className="flex items-center gap-1.5 bg-[#0284C7] hover:bg-[#0EA5E9] text-white text-xs font-bold px-4 py-2 rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
                >
                  {isCreatingSlip ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>Save &amp; Record Slip</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Purge Ingested File Modal */}
      <PurgeIngestedFileModal
        isOpen={isPurgeModalOpen}
        onClose={() => setIsPurgeModalOpen(false)}
        clientId={currentClient?.id || ''}
        clientName={currentClient?.name || 'Client'}
        selectedMonth={selectedMonth}
        selectedYear={selectedYear}
        transactions={arStagedTx}
        initialFileName={purgeTargetFileName}
        onSuccess={() => {
          loadTransactions();
          loadSummaryData();
        }}
      />

      {/* Correct Slip Date Modal */}
      {editingDateSlip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 bg-slate-50/80 border-b border-[#E2E8F0] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-50 border border-sky-200 text-[#0284C7] flex items-center justify-center shadow-xs">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#0F172A]">Correct Slip Date</h3>
                  <p className="text-xs text-[#64748B]">
                    {editingDateSlip.propertyName} ({editingDateSlip.items.length} {editingDateSlip.items.length === 1 ? 'item' : 'items'})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEditingDateSlip(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  New Delivery Slip Date
                </label>
                <input
                  type="date"
                  value={newSlipDateValue}
                  onChange={(e) => setNewSlipDateValue(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0284C7] focus:border-[#0284C7] font-mono shadow-xs"
                />
                <p className="text-xs text-slate-500 mt-1.5">
                  Currently recorded as <strong className="font-mono text-slate-700">{editingDateSlip.slipDate}</strong>.
                </p>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 leading-relaxed">
                <p className="font-semibold flex items-center gap-1.5 text-amber-800 mb-1">
                  <Info className="w-4 h-4 text-amber-600 shrink-0" />
                  Automatic Ledger Re-filing
                </p>
                Updating this date will update all <strong>{editingDateSlip.items.length} line items</strong> on this delivery slip in PostgreSQL. If moved to another month, the ledger view will switch automatically so you can continue reviewing it.
              </div>
            </div>

            <div className="px-6 py-3.5 bg-slate-50 border-t border-[#E2E8F0] flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setEditingDateSlip(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-lg transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSlipDate}
                disabled={isSavingSlipDate || !newSlipDateValue}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#0284C7] hover:bg-[#0369A1] rounded-lg transition cursor-pointer shadow-xs disabled:opacity-50"
              >
                {isSavingSlipDate ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Save Date</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Link / Re-map Customer to Zoho Contact Modal */}
      {quickLinkCustomerSlip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 bg-slate-50/80 border-b border-[#E2E8F0] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shadow-xs ${
                  quickLinkCustomerSlip.isCustomerReconciled
                    ? 'bg-sky-50 border-sky-200 text-sky-700'
                    : 'bg-amber-50 border-amber-200 text-amber-700'
                }`}>
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#0F172A]">
                    {quickLinkCustomerSlip.isCustomerReconciled ? 'Re-map Slip Customer' : 'Link Slip Customer'}
                  </h3>
                  <p className="text-xs text-[#64748B]">
                    {quickLinkCustomerSlip.isCustomerReconciled
                      ? `Re-assign "${quickLinkCustomerSlip.propertyName}" to a different Zoho Books contact`
                      : `Map "${quickLinkCustomerSlip.propertyName}" to Zoho Books`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setQuickLinkCustomerSlip(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Slip Customer / Destination Name
                </label>
                <input
                  type="text"
                  disabled
                  value={quickLinkCustomerSlip.propertyName}
                  className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-sm text-slate-700 font-sans shadow-xs cursor-not-allowed"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    Official Zoho Books Customer
                  </label>
                  {quickLinkCustomerSlip.isCustomerReconciled && quickLinkCustomerSlip.reconciledContactName && (
                    <span className="text-[11px] text-slate-500 font-normal">
                      Current: <strong className="text-slate-700">{quickLinkCustomerSlip.reconciledContactName}</strong>
                    </span>
                  )}
                </div>
                <select
                  value={quickLinkSelectedContactId}
                  onChange={(e) => setQuickLinkSelectedContactId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0284C7] focus:border-[#0284C7] shadow-xs"
                >
                  <option value="">Select official Zoho contact...</option>
                  {clientContacts.map((c: any) => (
                    <option key={c.contact_id} value={c.contact_id}>
                      {c.contact_name} {c.company_name ? `(${c.company_name})` : ''} - ID: {c.contact_id}
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl text-xs text-sky-900 leading-relaxed">
                <p className="font-semibold flex items-center gap-1.5 text-sky-800 mb-1">
                  <Info className="w-4 h-4 text-sky-600 shrink-0" />
                  First Line of Defence Registry
                </p>
                This will save "{quickLinkCustomerSlip.propertyName}" in the Customer Mapping Registry and automatically update all <strong>{quickLinkCustomerSlip.items.length} line items</strong> on this slip so they are recognized immediately during draft invoicing.
              </div>
            </div>

            <div className="px-6 py-3.5 bg-slate-50 border-t border-[#E2E8F0] flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setQuickLinkCustomerSlip(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-lg transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmQuickLinkCustomer}
                disabled={isSavingCustomerLink || !quickLinkSelectedContactId}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition cursor-pointer shadow-xs disabled:opacity-50"
              >
                {isSavingCustomerLink ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>{quickLinkCustomerSlip.isCustomerReconciled ? 'Updating...' : 'Linking...'}</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>{quickLinkCustomerSlip.isCustomerReconciled ? 'Update Mapping' : 'Confirm Link'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
