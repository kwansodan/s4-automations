import React, { useState, useEffect, useMemo } from 'react';
import { useClient } from '../../../context/ClientContext';
import { useAutomation } from '../../../context/AutomationContext';
import {
  fetchClientTransactions,
  fetchClientTransactionsSummary,
  toggleClientTransaction,
  batchToggleTransactions,
  batchApproveTransactions,
  deleteStagedTransaction,
  batchDeleteStagedTransactions,
  updateClientTransaction,
  fetchItemCatalog,
  fetchClientCatalog,
  CatalogItem,
  runClientStrategy,
  ClientTransactionSummaryRow,
} from '../../../lib/api';
import { formatCurrency } from '../../../lib/utils';
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
  Save,
  Trash2,
} from 'lucide-react';
import { ZohoItemSearchableSelect } from './ZohoItemSearchableSelect';
import { PurgeIngestedFileModal } from '../../modals/PurgeIngestedFileModal';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const YEARS = [2025, 2026, 2027];

export interface SlipGroup {
  slipKey: string;
  sourceFileName: string;
  propertyName: string;
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
  status: string;
}

export const ClientArTab: React.FC = () => {
  const { currentClient } = useClient();
  const {
    selectedMonth,
    setSelectedMonth,
    selectedYear,
    setSelectedYear,
    setIsInvoiceModalOpen,
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
  const [dailyStatusFilter, setDailyStatusFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'DISCREPANCY' | 'INVOICED'>('ALL');
  const [dailyPropertyFilter, setDailyPropertyFilter] = useState<string>('ALL');
  const [dailySortField, setDailySortField] = useState<string>('transaction_date');
  const [dailySortDirection, setDailySortDirection] = useState<'asc' | 'desc'>('asc');
  const [dailyPageSize, setDailyPageSize] = useState<number | 'all'>(50);
  const [dailyCurrentPage, setDailyCurrentPage] = useState<number>(1);
  const [groupedPageSize, setGroupedPageSize] = useState<number | 'all'>(20);
  const [groupedCurrentPage, setGroupedCurrentPage] = useState<number>(1);
  const [dailyViewMode, setDailyViewMode] = useState<'grouped' | 'flat'>('grouped');
  const [expandedSlips, setExpandedSlips] = useState<Record<string, boolean>>({});
  const [approvingSlipKey, setApprovingSlipKey] = useState<string | null>(null);

  // Line Item Inline Editing State (Strictly Zoho Books Item Master)
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [clientContacts, setClientContacts] = useState<any[]>([]);
  const [editingTxId, setEditingTxId] = useState<number | null>(null);
  const [editItemName, setEditItemName] = useState<string>('');
  const [editPickQty, setEditPickQty] = useState<number | string>('');
  const [editDelivQty, setEditDelivQty] = useState<number | string>('');
  const [editRate, setEditRate] = useState<number | string>('');
  const [isSavingTx, setIsSavingTx] = useState<boolean>(false);
  const [deletingSlipKey, setDeletingSlipKey] = useState<string | null>(null);
  const [deletingTxId, setDeletingTxId] = useState<number | null>(null);

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
  }, [currentClient?.id, currentClient?.zoho_org_id]);

  const [summarySortField, setSummarySortField] = useState<string>('item_name');
  const [summarySortDirection, setSummarySortDirection] = useState<'asc' | 'desc'>('asc');

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
      const res = await fetchClientTransactionsSummary(currentClient.id, selectedMonth, selectedYear, 'AR');
      setSummaryRows(res?.summary || []);
      setSummaryStats(res || null);
    } catch (err: any) {
      console.warn('Failed loading client transactions summary:', err);
    } finally {
      setIsLoadingSummary(false);
    }
  };

  useEffect(() => {
    loadTransactions();
    loadSummaryData();
  }, [currentClient?.id, selectedMonth, selectedYear]);

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

  const extractPropertyName = (filename?: string): string => {
    if (!filename) return '';
    let base = filename.replace(/\.[a-zA-Z0-9]+$/, '').trim();
    base = base.replace(/[\s._-]+(\d{1,2}[\s._\/-]\d{1,2}[\s._\/-]\d{2,4}|\d{4}[\s._\/-]\d{1,2}[\s._\/-]\d{1,2})$/i, '').trim();
    return base;
  };

  const toTitleCase = (str?: string): string => {
    if (!str) return '—';
    return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
  };

  const handleSummarySort = (field: string) => {
    if (summarySortField === field) {
      setSummarySortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSummarySortField(field);
      setSummarySortDirection(field === 'item_name' ? 'asc' : 'desc');
    }
  };

  const filteredSummaryRows = useMemo(() => {
    let rows = summaryRows;
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
  }, [summaryRows, query, summarySortField, summarySortDirection]);

  const arStagedTx = useMemo(() => transactions.filter((t) => t.pipeline_type !== 'AP'), [transactions]);

  const availableProperties = useMemo(() => {
    const props = new Set<string>();
    arStagedTx.forEach((tx) => {
      const p = extractPropertyName(tx.source_file_name);
      if (p && p.length > 1) props.add(p);
    });
    return Array.from(props).sort();
  }, [arStagedTx]);

  const dailyCounts = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let discrepancy = 0;
    let invoiced = 0;

    arStagedTx.forEach((tx) => {
      if (tx.status === 'INVOICED') invoiced++;
      else if (tx.approved) approved++;
      else pending++;

      if ((tx.discrepancy_amount || 0) > 0) {
        discrepancy++;
      }
    });

    return {
      all: arStagedTx.length,
      pending,
      approved,
      discrepancy,
      invoiced,
    };
  }, [arStagedTx]);

  const filteredArStagedTx = useMemo(() => {
    return arStagedTx.filter((t) => {
      // 1. Status Filter
      if (dailyStatusFilter === 'PENDING' && (t.approved || t.status === 'INVOICED')) return false;
      if (dailyStatusFilter === 'APPROVED' && (!t.approved || t.status === 'INVOICED')) return false;
      if (dailyStatusFilter === 'DISCREPANCY' && (t.discrepancy_amount || 0) <= 0) return false;
      if (dailyStatusFilter === 'INVOICED' && t.status !== 'INVOICED') return false;

      // 2. Property Filter
      if (dailyPropertyFilter !== 'ALL') {
        const prop = extractPropertyName(t.source_file_name);
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
  }, [arStagedTx, dailyStatusFilter, dailyPropertyFilter, query]);

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
        const prop = extractPropertyName(tx.source_file_name) || currentClient?.name || 'Slip';
        const driveUrl = tx.metadata_json?.drive_file_url ||
          (tx.source_identifier ? `https://drive.google.com/file/d/${tx.source_identifier}/view` : null);
        group = {
          slipKey: key,
          sourceFileName: tx.source_file_name || 'Slip Document',
          propertyName: prop,
          slipDate: tx.transaction_date || '—',
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
    });

    const list = Array.from(map.values());
    list.forEach((g) => {
      const allInvoiced = g.items.every((i) => i.status === 'INVOICED');
      if (allInvoiced) g.status = 'INVOICED';
      else if (g.isFullyApproved) g.status = 'APPROVED';
      else g.status = 'PENDING';
    });

    list.sort((a, b) => {
      const dateA = a.slipDate || '';
      const dateB = b.slipDate || '';
      if (dateA !== dateB) {
        return dailySortDirection === 'asc' ? dateA.localeCompare(dateB) : dateB.localeCompare(dateA);
      }
      return a.sourceFileName.localeCompare(b.sourceFileName);
    });

    return list;
  }, [filteredArStagedTx, currentClient, dailySortDirection]);

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

  const zohoMasterItems = useMemo(() => {
    // Strictly Zoho Books Item Master (Active items only) scoped to this client
    const map = new Map<string, CatalogItem>();
    catalogItems.forEach((c: any) => {
      if (c.status && c.status.toLowerCase() !== 'active') {
        return;
      }
      if (c.name && !map.has(c.name.trim().toLowerCase())) {
        map.set(c.name.trim().toLowerCase(), {
          item_id: c.item_id || `item_${c.name.toLowerCase().replace(/\s+/g, '_')}`,
          name: c.name.trim(),
          rate: Number(c.rate) || 0,
          description: c.description || '',
          status: 'active',
        });
      }
    });

    // Ensure distinct active items from THIS client's staged transactions are available as fallback
    transactions.forEach((tx: any) => {
      const name = (tx.item_or_description || '').trim();
      if (name && !map.has(name.toLowerCase())) {
        map.set(name.toLowerCase(), {
          item_id: `staged_${name.toLowerCase().replace(/\s+/g, '_')}`,
          name,
          rate: Number(tx.rate_or_price) || 0,
          description: `${currentClient?.name || 'Client'} Staged Item`,
          status: 'active',
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [catalogItems, transactions, currentClient?.name]);

  const handleStartEdit = (tx: any) => {
    setEditingTxId(tx.id);
    const desc = (tx.item_or_description || '').trim();
    setEditItemName(desc);
    setEditPickQty(tx.credit_amount ?? tx.quantity_or_debit ?? 0);
    setEditDelivQty(tx.quantity_or_debit ?? 0);
    setEditRate(tx.rate_or_price ?? 0);
    const key = tx.source_file_name || `slip-${tx.transaction_date || 'unknown'}`;
    setExpandedSlips((prev) => ({ ...prev, [key]: true }));
  };

  const handleCancelEdit = () => {
    setEditingTxId(null);
    setEditItemName('');
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

      {/* Daily Slips Filter Toolbar: Status Pills & Property Filter */}
      {activeLedgerView === 'daily' && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-[#E2E8F0] rounded-xl p-2.5 shadow-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
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
            </button>
            <button
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

          {availableProperties.length > 0 && (
            <div className="flex items-center gap-2 bg-slate-50 border border-[#E2E8F0] rounded-lg px-2.5 py-1 text-xs shrink-0">
              <Building2 className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[#64748B] text-[11px]">{isCustodyTracking ? 'Property:' : 'Customer / Site:'}</span>
              <select
                value={dailyPropertyFilter}
                onChange={(e) => setDailyPropertyFilter(e.target.value)}
                className="bg-transparent text-[#0F172A] font-medium focus:outline-none cursor-pointer"
              >
                <option value="ALL" className="bg-white text-slate-800">
                  {isCustodyTracking ? 'All Properties' : 'All Customers / Sites'} ({arStagedTx.length})
                </option>
                {availableProperties.map((p) => (
                  <option key={p} value={p} className="bg-white text-slate-800">{p}</option>
                ))}
              </select>
            </div>
          )}

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
        <div className="bg-[#F0F9FF] border border-[#BAE6FD] rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-xs">
          <div className="flex items-center gap-2 text-xs text-[#0369A1]">
            <Info className="w-4 h-4 text-[#0284C7] shrink-0" />
            <span>
              Viewing aggregated monthly totals. To inspect, edit, or delete individual ingested slips and files, switch to <strong className="text-[#0C4A6E] font-bold">Daily Slips</strong> or use <strong className="text-[#E11D48] font-bold">Delete Ingested File</strong>.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setActiveLedgerView('daily')}
              className="px-2.5 py-1 text-xs font-bold bg-white text-[#0284C7] border border-[#BAE6FD] hover:bg-sky-50 rounded-lg transition cursor-pointer shadow-xs"
            >
              Open Daily Slips ({arStagedTx.length})
            </button>
            <button
              onClick={() => {
                setPurgeTargetFileName('');
                setIsPurgeModalOpen(true);
              }}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-white text-[#E11D48] border border-[#FECDD3] hover:bg-rose-50 rounded-lg transition cursor-pointer shadow-xs"
            >
              <Trash2 className="w-3.5 h-3.5 text-[#E11D48]" />
              <span>Delete Ingested File</span>
            </button>
          </div>
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
                                <span className="text-slate-400 font-mono text-xs">—</span>
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
            </table>
          )}

          {/* VIEW 2A: IN-APP POSTGRESQL DAILY SLIPS - GROUPED BY SLIP */}
          {activeLedgerView === 'daily' && dailyViewMode === 'grouped' && (
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
                        {/* Left: Expand Chevron, Property, Date, File Name Link, Item Count */}
                        <div className="flex items-center gap-2.5 min-w-0">
                          <button
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

                            <span className="font-mono text-xs font-bold text-[#0F172A] bg-white px-2 py-0.5 rounded border border-[#E2E8F0] shrink-0 whitespace-nowrap shadow-xs">
                              {slip.slipDate}
                            </span>

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
                                    <span>—</span>
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
                                              <span className="text-slate-400 font-mono text-xs">—</span>
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
                                            <span className="text-slate-400 font-mono text-xs">—</span>
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
                          <td className="py-3 px-4 font-mono text-[#0F172A] font-semibold whitespace-nowrap">{tx.transaction_date || '—'}</td>
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
                                  <span className="text-slate-400 font-mono text-xs">—</span>
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
                        <td className="py-3 px-4 font-mono text-[#0F172A] font-semibold whitespace-nowrap">{tx.transaction_date || '—'}</td>
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
                                <span className="text-slate-400 font-mono text-xs">—</span>
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
    </div>
  );
};
