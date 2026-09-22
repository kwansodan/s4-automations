import React, { useState, useEffect, useMemo } from 'react';
import { useClient } from '../../../context/ClientContext';
import { useAutomation } from '../../../context/AutomationContext';
import {
  fetchClientTransactions,
  fetchClientTransactionsSummary,
  toggleClientTransaction,
  batchToggleTransactions,
  batchApproveTransactions,
  updateClientTransaction,
  fetchItemCatalog,
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
} from 'lucide-react';
import { ZohoItemSearchableSelect } from './ZohoItemSearchableSelect';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const YEARS = [2025, 2026, 2027];

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

  // Filters, Sorting & Pagination State
  const [dailyStatusFilter, setDailyStatusFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'DISCREPANCY' | 'INVOICED'>('ALL');
  const [dailyPropertyFilter, setDailyPropertyFilter] = useState<string>('ALL');
  const [dailySortField, setDailySortField] = useState<string>('transaction_date');
  const [dailySortDirection, setDailySortDirection] = useState<'asc' | 'desc'>('asc');
  const [dailyPageSize, setDailyPageSize] = useState<number | 'all'>(50);
  const [dailyCurrentPage, setDailyCurrentPage] = useState<number>(1);
  const [dailyViewMode, setDailyViewMode] = useState<'grouped' | 'flat'>('grouped');
  const [expandedSlips, setExpandedSlips] = useState<Record<string, boolean>>({});
  const [approvingSlipKey, setApprovingSlipKey] = useState<string | null>(null);

  // Line Item Inline Editing State (Strictly Zoho Books Item Master)
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [editingTxId, setEditingTxId] = useState<number | null>(null);
  const [editItemName, setEditItemName] = useState<string>('');
  const [editPickQty, setEditPickQty] = useState<number | string>('');
  const [editDelivQty, setEditDelivQty] = useState<number | string>('');
  const [editRate, setEditRate] = useState<number | string>('');
  const [isSavingTx, setIsSavingTx] = useState<boolean>(false);

  useEffect(() => {
    fetchItemCatalog().then((items) => {
      if (items && items.length > 0) {
        setCatalogItems(items);
      }
    });
  }, []);

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
  }, [search, dailyStatusFilter, dailyPropertyFilter, dailyPageSize]);

  const paginatedArStagedTx = useMemo(() => {
    if (dailyPageSize === 'all') return sortedArStagedTx;
    const start = (dailyCurrentPage - 1) * Number(dailyPageSize);
    return sortedArStagedTx.slice(start, start + Number(dailyPageSize));
  }, [sortedArStagedTx, dailyCurrentPage, dailyPageSize]);

  interface SlipGroup {
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
    // Strictly Zoho Books Item Master
    const source = catalogItems.length > 0 ? catalogItems : (catalog?.items || []);
    const map = new Map<string, CatalogItem>();
    source.forEach((c) => {
      if (c.name && !map.has(c.name.trim().toLowerCase())) {
        map.set(c.name.trim().toLowerCase(), c);
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [catalogItems, catalog]);

  const handleStartEdit = (tx: any) => {
    setEditingTxId(tx.id);
    const desc = (tx.item_or_description || '').trim();
    setEditItemName(desc);
    setEditPickQty(tx.credit_amount ?? tx.quantity_or_debit ?? 0);
    setEditDelivQty(tx.quantity_or_debit ?? 0);
    setEditRate(tx.rate_or_price ?? 0);
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

          {/* Run OCR */}
          <button
            onClick={() => handleRunArOcr()}
            disabled={isRunningOcr}
            className="flex items-center gap-1.5 bg-sky-950/60 hover:bg-sky-900/60 border border-sky-500/40 text-sky-300 text-xs font-semibold px-3.5 py-1.5 rounded-xl transition cursor-pointer disabled:opacity-50"
          >
            <PlayCircle className={`w-3.5 h-3.5 ${isRunningOcr ? 'animate-spin' : ''}`} />
            <span>{isRunningOcr ? 'Extracting Slips...' : 'Run AR Extraction'}</span>
          </button>

          {/* Refresh */}
          <button
            onClick={() => { refreshAll(); loadTransactions(); loadSummaryData(); }}
            disabled={isLoading || isLoadingTx}
            className="p-2 bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-xl transition cursor-pointer"
            title="Refresh AR Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading || isLoadingTx ? 'animate-spin text-sky-400' : ''}`} />
          </button>

          {/* 1-Click Invoice Export */}
          <button
            onClick={handleGenerateInvoicesClick}
            className={`flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-xl shadow-lg transition cursor-pointer ${
              approvedRowsCount > 0
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-600/25'
                : 'bg-slate-900 hover:bg-slate-850 text-slate-400 hover:text-slate-200 border border-slate-700/60'
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
          className={`flex items-start justify-between gap-3 p-4 rounded-xl border transition animate-in fade-in slide-in-from-top-2 ${
            runFeedback.type === 'error'
              ? 'bg-rose-950/40 border-rose-500/50 text-rose-200'
              : runFeedback.type === 'warning'
              ? 'bg-amber-950/40 border-amber-500/50 text-amber-200'
              : 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {runFeedback.type === 'error' ? (
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            ) : runFeedback.type === 'warning' ? (
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            ) : (
              <Check className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
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
            className="p-1 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
            title="Dismiss notice"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Mode Switcher & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800/80 rounded-xl p-2">
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setActiveLedgerView('summary')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition cursor-pointer flex items-center gap-1.5 ${
              activeLedgerView === 'summary'
                ? 'bg-sky-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Monthly Summary ({summaryRows.length})</span>
          </button>
          <button
            onClick={() => setActiveLedgerView('daily')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition cursor-pointer flex items-center gap-1.5 ${
              activeLedgerView === 'daily'
                ? 'bg-sky-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
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
              placeholder="Search item, slip or date..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 sm:w-60"
            />
          </div>
        </div>
      </div>

      {/* Daily Slips Filter Toolbar: Status Pills & Property Filter */}
      {activeLedgerView === 'daily' && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/60 border border-slate-800/60 rounded-xl p-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setDailyStatusFilter('ALL')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                dailyStatusFilter === 'ALL'
                  ? 'bg-slate-800 text-white border border-slate-600 shadow'
                  : 'bg-slate-950/60 text-slate-400 hover:text-white border border-slate-800/80'
              }`}
            >
              <span>All Slips</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-slate-700/60 text-slate-300">
                {dailyCounts.all}
              </span>
            </button>
            <button
              onClick={() => setDailyStatusFilter('PENDING')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                dailyStatusFilter === 'PENDING'
                  ? 'bg-amber-950/80 text-amber-300 border border-amber-500/50 shadow'
                  : 'bg-slate-950/60 text-slate-400 hover:text-white border border-slate-800/80'
              }`}
            >
              <span>Pending</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-amber-950 text-amber-400 border border-amber-500/30">
                {dailyCounts.pending}
              </span>
            </button>
            <button
              onClick={() => setDailyStatusFilter('APPROVED')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                dailyStatusFilter === 'APPROVED'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/50 shadow'
                  : 'bg-slate-950/60 text-slate-400 hover:text-white border border-slate-800/80'
              }`}
            >
              <span>Approved</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-emerald-950 text-emerald-400 border border-emerald-500/30">
                {dailyCounts.approved}
              </span>
            </button>
            <button
              onClick={() => setDailyStatusFilter('DISCREPANCY')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                dailyStatusFilter === 'DISCREPANCY'
                  ? 'bg-rose-950/80 text-rose-300 border border-rose-500/50 shadow'
                  : 'bg-slate-950/60 text-slate-400 hover:text-white border border-slate-800/80'
              }`}
            >
              <AlertTriangle className="w-3 h-3 text-rose-400" />
              <span>Loss Discrepancies</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-rose-950 text-rose-400 border border-rose-500/30">
                {dailyCounts.discrepancy}
              </span>
            </button>
            {dailyCounts.invoiced > 0 && (
              <button
                onClick={() => setDailyStatusFilter('INVOICED')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                  dailyStatusFilter === 'INVOICED'
                    ? 'bg-sky-950/80 text-sky-300 border border-sky-500/50 shadow'
                    : 'bg-slate-950/60 text-slate-400 hover:text-white border border-slate-800/80'
                }`}
              >
                <span>Invoiced</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-sky-950 text-sky-400 border border-sky-500/30">
                  {dailyCounts.invoiced}
                </span>
              </button>
            )}
          </div>

          {availableProperties.length > 0 && (
            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs shrink-0">
              <Building2 className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-500 text-[11px]">Property:</span>
              <select
                value={dailyPropertyFilter}
                onChange={(e) => setDailyPropertyFilter(e.target.value)}
                className="bg-transparent text-white font-medium focus:outline-none cursor-pointer"
              >
                <option value="ALL" className="bg-slate-900 text-white">All Properties ({arStagedTx.length})</option>
                {availableProperties.map((p) => (
                  <option key={p} value={p} className="bg-slate-900 text-white">{p}</option>
                ))}
              </select>
            </div>
          )}

          {/* Sub-toolbar: View Mode Switcher (Group by Slip vs Flat Table) & Accordion Actions */}
          <div className="w-full flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 mt-1">
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                onClick={() => setDailyViewMode('grouped')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition cursor-pointer flex items-center gap-1.5 ${
                  dailyViewMode === 'grouped'
                    ? 'bg-sky-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
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
                    ? 'bg-sky-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
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
                  className="px-2.5 py-1 text-[11px] font-semibold text-slate-400 hover:text-white bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-lg transition cursor-pointer"
                  title="Expand all daily slips"
                >
                  Expand All
                </button>
                <button
                  onClick={handleCollapseAll}
                  className="px-2.5 py-1 text-[11px] font-semibold text-slate-400 hover:text-white bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-lg transition cursor-pointer"
                  title="Collapse all daily slips"
                >
                  Collapse All
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Primary In-App PostgreSQL Ledger Notice */}
      <div className="bg-emerald-950/25 border border-emerald-500/20 rounded-xl px-3.5 py-2 flex items-center justify-between gap-2 text-xs text-emerald-300">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 relative shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span>
            <strong>Native In-App PostgreSQL Ledger Active:</strong> Daily control slips, linen loss reconciliations, and review approvals are committed directly to PostgreSQL. Zoho Books invoices are generated directly from approved transactions.
          </span>
        </div>
      </div>

      {/* Main Table Views */}
      <div className="glass-panel rounded-2xl overflow-hidden shadow-xl border border-slate-800">
        <div className="overflow-x-auto custom-scrollbar">
          
          {/* VIEW 1: IN-APP POSTGRESQL MONTHLY SUMMARY */}
          {activeLedgerView === 'summary' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold text-[11px]">
                <tr>
                  {renderSummarySortHeader('Standard Item Name', 'item_name', 'left')}
                  {renderSummarySortHeader('Total Picked Up', 'total_picked_up', 'center')}
                  {renderSummarySortHeader('Total Delivered', 'total_delivered', 'center')}
                  {renderSummarySortHeader('Linen Loss Discrepancy', 'linen_discrepancy', 'center')}
                  {renderSummarySortHeader('Unit Rate', 'unit_price', 'right')}
                  {renderSummarySortHeader('Total Billed', 'total_billed', 'right')}
                  {renderSummarySortHeader('Slips Count', 'slips_count', 'center')}
                  <th className="py-3 px-4 text-center">Reviewed</th>
                  <th className="py-3 px-4 text-center">Approved</th>
                  {renderSummarySortHeader('Status', 'status', 'center')}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300 font-medium">
                {sortedSummaryRows.length > 0 ? (
                  sortedSummaryRows.map((row) => {
                    const lossQty = row.linen_discrepancy || 0;
                    return (
                      <tr
                        key={row.item_name}
                        className={`hover:bg-slate-850/50 transition-colors ${
                          row.is_fully_approved ? 'bg-emerald-950/15' : lossQty > 0 ? 'border-l-2 border-l-rose-500 bg-rose-950/15' : ''
                        }`}
                      >
                        <td className="py-3 px-4 font-bold text-white whitespace-nowrap">{toTitleCase(row.item_name)}</td>
                        <td className="py-3 px-4 text-center font-mono whitespace-nowrap">{row.total_picked_up}</td>
                        <td className="py-3 px-4 text-center font-mono whitespace-nowrap">{row.total_delivered}</td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          {lossQty > 0 ? (
                            <span className="inline-flex items-center gap-1 text-rose-300 font-mono font-bold bg-rose-950/80 border border-rose-500/50 px-2 py-0.5 rounded-full text-[11px] shadow-sm">
                              <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                              <span>-{lossQty} missing</span>
                            </span>
                          ) : (
                            <span className="text-slate-600 font-mono text-xs">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono whitespace-nowrap">{formatCurrency(row.unit_rate ?? row.unit_price ?? 0)}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400 whitespace-nowrap">
                          {formatCurrency(row.total_billed)}
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-slate-400 whitespace-nowrap">{row.slips_count}</td>
                        <td className="py-3 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(row.is_fully_reviewed)}
                            onChange={() => handleToggleSummaryApproval(row, 'reviewed')}
                            className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-sky-600 focus:ring-sky-500 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(row.is_fully_approved)}
                            onChange={() => handleToggleSummaryApproval(row, 'approved')}
                            className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                              row.is_fully_approved
                                ? 'bg-emerald-950 border border-emerald-500/40 text-emerald-300'
                                : 'bg-amber-950/60 border border-amber-500/30 text-amber-400'
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
                    <td colSpan={10} className="py-12 text-center text-slate-500 text-xs">
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
            <div className="divide-y divide-slate-800/80">
              {groupedSlips.length > 0 ? (
                groupedSlips.map((slip) => {
                  const expanded = isSlipExpanded(slip.slipKey);
                  return (
                    <div key={slip.slipKey} className="transition-colors">
                      {/* Slip Card Header */}
                      <div
                        className={`flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3.5 transition-colors ${
                          slip.isFullyApproved
                            ? 'bg-emerald-950/20 hover:bg-emerald-950/30'
                            : slip.totalLossQty > 0
                            ? 'border-l-4 border-l-rose-500 bg-rose-950/15 hover:bg-rose-950/25'
                            : 'bg-slate-900/40 hover:bg-slate-850/60'
                        }`}
                      >
                        {/* Left: Expand Chevron, Property, Date, File Name Link, Item Count */}
                        <div className="flex items-center gap-2.5 min-w-0">
                          <button
                            onClick={() => toggleSlipExpanded(slip.slipKey)}
                            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer shrink-0"
                            title={expanded ? 'Collapse slip line items' : 'Expand slip line items'}
                          >
                            {expanded ? (
                              <ChevronUp className="w-4 h-4 text-slate-300" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-slate-300" />
                            )}
                          </button>

                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-950/80 text-sky-300 border border-sky-500/30 shrink-0">
                              <Building2 className="w-3 h-3 text-sky-400" />
                              <span>{slip.propertyName}</span>
                            </span>

                            <span className="font-mono text-xs font-bold text-white bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/60 shrink-0 whitespace-nowrap">
                              {slip.slipDate}
                            </span>

                            {slip.driveUrl ? (
                              <a
                                href={slip.driveUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 hover:underline transition font-mono text-xs group max-w-[280px] truncate"
                                title={`Open original slip in Google Drive: ${slip.sourceFileName}`}
                              >
                                <span className="truncate">{slip.sourceFileName}</span>
                                <ExternalLink className="w-3 h-3 shrink-0 opacity-70 group-hover:opacity-100 transition text-sky-400" />
                              </a>
                            ) : (
                              <span className="font-mono text-xs text-slate-300 max-w-[280px] truncate block" title={slip.sourceFileName}>
                                {slip.sourceFileName}
                              </span>
                            )}

                            <span className="text-[11px] text-slate-500 font-medium whitespace-nowrap">
                              ({slip.items.length} {slip.items.length === 1 ? 'item' : 'items'})
                            </span>
                          </div>
                        </div>

                        {/* Right: Aggregated Totals & 1-Click Approve Entire Slip Button */}
                        <div className="flex flex-wrap items-center gap-2.5 shrink-0 justify-between lg:justify-end">
                          <div className="flex items-center gap-1.5 text-xs font-mono">
                            <div className="bg-slate-950 px-2 py-1 rounded border border-slate-800 whitespace-nowrap" title="Total Picked Up">
                              <span className="text-slate-500 text-[10px] mr-1">PICK</span>
                              <span className="text-slate-200 font-semibold">{slip.totalPickQty}</span>
                            </div>
                            <div className="bg-slate-950 px-2 py-1 rounded border border-slate-800 whitespace-nowrap" title="Total Delivered">
                              <span className="text-slate-500 text-[10px] mr-1">DELIV</span>
                              <span className="text-slate-200 font-semibold">{slip.totalDelivQty}</span>
                            </div>
                            {slip.totalLossQty > 0 ? (
                              <div
                                className="bg-rose-950/80 px-2 py-1 rounded border border-rose-500/50 text-rose-300 flex items-center gap-1 font-bold shadow-sm whitespace-nowrap"
                                title="Linen Loss Discrepancy"
                              >
                                <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                                <span className="text-[10px] text-rose-400 uppercase">Loss</span>
                                <span>-{slip.totalLossQty} missing</span>
                              </div>
                            ) : (
                              <div className="bg-slate-950 px-2 py-1 rounded border border-slate-800 text-slate-500 whitespace-nowrap" title="No Loss">
                                <span className="text-[10px] mr-1">LOSS</span>
                                <span>—</span>
                              </div>
                            )}
                            <div className="bg-slate-950 px-2.5 py-1 rounded border border-slate-800 text-right whitespace-nowrap" title="Total Amount">
                              <span className="font-bold text-emerald-400">{formatCurrency(slip.totalAmount)}</span>
                            </div>
                          </div>

                          {/* 1-Click Approve Entire Slip Button */}
                          <button
                            onClick={() => handleToggleSlipApproval(slip)}
                            disabled={approvingSlipKey === slip.slipKey}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer shadow-sm disabled:opacity-40 whitespace-nowrap ${
                              slip.isFullyApproved
                                ? 'bg-emerald-950 border border-emerald-500/60 text-emerald-300 hover:bg-emerald-900/60'
                                : slip.isPartiallyApproved
                                ? 'bg-amber-950/80 border border-amber-500/60 text-amber-300 hover:bg-amber-900/80'
                                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
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
                                <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Slip Approved</span>
                              </>
                            ) : slip.isPartiallyApproved ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-amber-400" />
                                <span>Approve Rest ({slip.items.filter((i) => !i.approved).length})</span>
                              </>
                            ) : (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>Approve Slip ({slip.items.length})</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Nested Slip Items Table (when expanded) */}
                      {expanded && (
                        <div className="bg-slate-950/60 border-t border-slate-800/80 px-2 py-1.5 overflow-x-auto custom-scrollbar">
                          <table className="w-full text-left text-xs">
                            <thead className="text-slate-500 uppercase tracking-wider font-semibold text-[10px] border-b border-slate-800/60">
                              <tr>
                                <th className="py-2 px-3 text-left">Item Description</th>
                                <th className="py-2 px-3 text-center">Picked Up</th>
                                <th className="py-2 px-3 text-center">Delivered</th>
                                <th className="py-2 px-3 text-center">Linen Loss</th>
                                <th className="py-2 px-3 text-right">Unit Rate</th>
                                <th className="py-2 px-3 text-right">Total Amount</th>
                                <th className="py-2 px-3 text-center">Reviewed</th>
                                <th className="py-2 px-3 text-center">Approved</th>
                                <th className="py-2 px-3 text-center">Status</th>
                                <th className="py-2 px-3 text-center">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/40 text-slate-300 font-medium">
                              {slip.items.map((tx) => {
                                if (editingTxId === tx.id) {
                                  const livePick = Math.max(0, Number(editPickQty) || 0);
                                  const liveDeliv = Math.max(0, Number(editDelivQty) || 0);
                                  const liveLoss = Math.max(0, livePick - liveDeliv);
                                  const liveRate = Math.max(0, Number(editRate) || 0);
                                  const liveTotal = Math.round(liveDeliv * liveRate * 100) / 100;

                                  return (
                                    <tr key={tx.id} className="bg-sky-950/30 border-2 border-sky-500/50 shadow-inner">
                                      <td className="py-2 px-3 min-w-[280px]">
                                        <ZohoItemSearchableSelect
                                          items={zohoMasterItems}
                                          selectedItemName={editItemName}
                                          onSelect={handleZohoItemSelect}
                                          disabled={isSavingTx}
                                        />
                                      </td>
                                      <td className="py-2 px-3 text-center">
                                        <input
                                          type="number"
                                          min="0"
                                          value={editPickQty}
                                          onChange={(e) => setEditPickQty(e.target.value)}
                                          className="w-16 bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-center font-mono text-xs text-white focus:outline-none focus:border-sky-500"
                                        />
                                      </td>
                                      <td className="py-2 px-3 text-center">
                                        <input
                                          type="number"
                                          min="0"
                                          value={editDelivQty}
                                          onChange={(e) => setEditDelivQty(e.target.value)}
                                          className="w-16 bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-center font-mono text-xs text-white focus:outline-none focus:border-sky-500"
                                        />
                                      </td>
                                      <td className="py-2 px-3 text-center">
                                        {liveLoss > 0 ? (
                                          <span className="inline-flex items-center gap-1 font-mono font-bold px-2 py-0.5 rounded-full text-[11px] bg-rose-950/80 border border-rose-500/50 text-rose-300 shadow-sm">
                                            <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                                            <span>-{liveLoss} missing</span>
                                          </span>
                                        ) : (
                                          <span className="text-slate-600 font-mono text-xs">—</span>
                                        )}
                                      </td>
                                      <td className="py-2 px-3 text-right">
                                        <div className="inline-flex items-center justify-end gap-1">
                                          <span className="text-slate-500 text-[10px]">GHS</span>
                                          <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={editRate}
                                            onChange={(e) => setEditRate(e.target.value)}
                                            className="w-20 bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-right font-mono text-xs text-white focus:outline-none focus:border-sky-500"
                                          />
                                        </div>
                                      </td>
                                      <td className="py-2 px-3 text-right font-mono font-bold text-emerald-400 whitespace-nowrap">
                                        {formatCurrency(liveTotal)}
                                      </td>
                                      <td className="py-2 px-3 text-center">
                                        <span className="text-sky-400 text-[11px] font-semibold" title="Will be marked reviewed on save">Auto</span>
                                      </td>
                                      <td className="py-2 px-3 text-center">
                                        <input
                                          type="checkbox"
                                          checked={Boolean(tx.approved)}
                                          onChange={() => handleToggleTx(tx.id, 'approved', tx.approved)}
                                          className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                        />
                                      </td>
                                      <td className="py-2 px-3 text-center">
                                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-sky-950 border border-sky-500/40 text-sky-300">
                                          EDITING
                                        </span>
                                      </td>
                                      <td className="py-2 px-3 text-center whitespace-nowrap">
                                        <div className="flex items-center justify-center gap-1.5">
                                          <button
                                            onClick={() => handleSaveEdit(tx.id)}
                                            disabled={isSavingTx}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white transition shadow cursor-pointer disabled:opacity-50"
                                            title="Save changes"
                                          >
                                            <Save className="w-3.5 h-3.5" />
                                            <span>{isSavingTx ? 'Saving...' : 'Save'}</span>
                                          </button>
                                          <button
                                            onClick={handleCancelEdit}
                                            disabled={isSavingTx}
                                            className="inline-flex items-center p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                                            title="Cancel editing"
                                          >
                                            <X className="w-3.5 h-3.5" />
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
                                    className={`hover:bg-slate-850/40 transition-colors ${
                                      tx.approved
                                        ? 'bg-emerald-950/10'
                                        : lossQty > 0
                                        ? 'border-l-2 border-l-rose-500 bg-rose-950/15'
                                        : ''
                                    }`}
                                  >
                                    <td className="py-2.5 px-3 font-bold text-white whitespace-nowrap">
                                      <div className="flex items-center gap-1.5 group">
                                        <span>{toTitleCase(tx.item_or_description)}</span>
                                        <button
                                          onClick={() => handleStartEdit(tx)}
                                          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-slate-800 rounded text-slate-400 hover:text-sky-400 transition"
                                          title="Edit item name or details"
                                        >
                                          <Edit3 className="w-3 h-3" />
                                        </button>
                                      </div>
                                    </td>
                                    <td className="py-2.5 px-3 text-center font-mono whitespace-nowrap">{pickQty}</td>
                                    <td className="py-2.5 px-3 text-center font-mono whitespace-nowrap">{delivQty}</td>
                                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                      {lossQty > 0 ? (
                                        <span className="inline-flex items-center gap-1 font-mono font-bold px-2 py-0.5 rounded-full text-[11px] bg-rose-950/80 border border-rose-500/50 text-rose-300 shadow-sm">
                                          <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                                          <span>-{lossQty} missing</span>
                                        </span>
                                      ) : (
                                        <span className="text-slate-600 font-mono text-xs">—</span>
                                      )}
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap text-slate-300">
                                      {formatCurrency(rate)}
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400 whitespace-nowrap">
                                      {formatCurrency(total)}
                                    </td>
                                    <td className="py-2.5 px-3 text-center">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(tx.reviewed)}
                                        onChange={() => handleToggleTx(tx.id, 'reviewed', tx.reviewed)}
                                        className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-sky-600 focus:ring-sky-500 cursor-pointer"
                                      />
                                    </td>
                                    <td className="py-2.5 px-3 text-center">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(tx.approved)}
                                        onChange={() => handleToggleTx(tx.id, 'approved', tx.approved)}
                                        className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                      />
                                    </td>
                                    <td className="py-2.5 px-3 text-center">
                                      <span
                                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                                          tx.status === 'INVOICED'
                                            ? 'bg-sky-950 border border-sky-500/40 text-sky-300'
                                            : tx.approved
                                            ? 'bg-emerald-950 border border-emerald-500/40 text-emerald-300'
                                            : 'bg-amber-950/60 border border-amber-500/30 text-amber-400'
                                        }`}
                                      >
                                        {tx.status === 'INVOICED' ? 'INVOICED' : tx.approved ? 'APPROVED' : tx.status || 'PENDING'}
                                      </span>
                                    </td>
                                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                      <button
                                        onClick={() => handleStartEdit(tx)}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-slate-400 hover:text-sky-300 hover:bg-slate-800 border border-slate-800 hover:border-sky-500/40 transition cursor-pointer"
                                        title="Edit item name, quantities, or rate"
                                      >
                                        <Edit3 className="w-3 h-3 text-sky-400" />
                                        <span>Edit</span>
                                      </button>
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
                <div className="py-12 text-center text-slate-500 text-xs">
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
              <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold text-[11px]">
                <tr>
                  {renderDailySortHeader('Date', 'transaction_date', 'left')}
                  {renderDailySortHeader('Slip Filename', 'source_file_name', 'left')}
                  {renderDailySortHeader('Item Description', 'item_or_description', 'left')}
                  {renderDailySortHeader('Picked Up', 'pickQty', 'center')}
                  {renderDailySortHeader('Delivered', 'delivQty', 'center')}
                  {renderDailySortHeader('Linen Loss', 'discrepancy_amount', 'center')}
                  {renderDailySortHeader('Unit Rate', 'rate_or_price', 'right')}
                  {renderDailySortHeader('Total Amount', 'total_amount', 'right')}
                  <th className="py-3 px-4 text-center">Reviewed</th>
                  <th className="py-3 px-4 text-center">Approved</th>
                  {renderDailySortHeader('Status', 'status', 'center')}
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300 font-medium">
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
                        <tr key={tx.id} className="bg-sky-950/30 border-2 border-sky-500/50 shadow-inner">
                          <td className="py-3 px-4 font-mono text-slate-300 font-semibold whitespace-nowrap">{tx.transaction_date || '—'}</td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {driveUrl ? (
                              <a
                                href={driveUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-sky-400 hover:text-sky-300 hover:underline transition font-mono text-[11px] group max-w-[220px]"
                                title={`Open original slip in Google Drive: ${tx.source_file_name}`}
                              >
                                <span className="truncate">{tx.source_file_name || 'Slip Document'}</span>
                                <ExternalLink className="w-3 h-3 shrink-0 opacity-70 group-hover:opacity-100 transition text-sky-400" />
                              </a>
                            ) : (
                              <span className="font-mono text-[11px] text-slate-400 max-w-[180px] truncate block" title={tx.source_file_name}>
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
                          <td className="py-2.5 px-4 text-center">
                            <input
                              type="number"
                              min="0"
                              value={editPickQty}
                              onChange={(e) => setEditPickQty(e.target.value)}
                              className="w-16 bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-center font-mono text-xs text-white focus:outline-none focus:border-sky-500"
                            />
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            <input
                              type="number"
                              min="0"
                              value={editDelivQty}
                              onChange={(e) => setEditDelivQty(e.target.value)}
                              className="w-16 bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-center font-mono text-xs text-white focus:outline-none focus:border-sky-500"
                            />
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            {liveLoss > 0 ? (
                              <span className="inline-flex items-center gap-1 font-mono font-bold px-2 py-0.5 rounded-full text-[11px] bg-rose-950/80 border border-rose-500/50 text-rose-300 shadow-sm">
                                <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                                <span>-{liveLoss} missing</span>
                              </span>
                            ) : (
                              <span className="text-slate-600 font-mono text-xs">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <div className="inline-flex items-center justify-end gap-1">
                              <span className="text-slate-500 text-[10px]">GHS</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={editRate}
                                onChange={(e) => setEditRate(e.target.value)}
                                className="w-20 bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-right font-mono text-xs text-white focus:outline-none focus:border-sky-500"
                              />
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-bold text-emerald-400 whitespace-nowrap">
                            {formatCurrency(liveTotal)}
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            <span className="text-sky-400 text-[11px] font-semibold" title="Will be marked reviewed on save">Auto</span>
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            <input
                              type="checkbox"
                              checked={Boolean(tx.approved)}
                              onChange={() => handleToggleTx(tx.id, 'approved', tx.approved)}
                              className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                            />
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-sky-950 border border-sky-500/40 text-sky-300">
                              EDITING
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-center whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => handleSaveEdit(tx.id)}
                                disabled={isSavingTx}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white transition shadow cursor-pointer disabled:opacity-50"
                                title="Save changes"
                              >
                                <Save className="w-3.5 h-3.5" />
                                <span>{isSavingTx ? 'Saving...' : 'Save'}</span>
                              </button>
                              <button
                                onClick={handleCancelEdit}
                                disabled={isSavingTx}
                                className="inline-flex items-center p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                                title="Cancel editing"
                              >
                                <X className="w-3.5 h-3.5" />
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
                        className={`hover:bg-slate-850/50 transition-colors ${
                          tx.approved ? 'bg-emerald-950/15' : lossQty > 0 ? 'border-l-2 border-l-rose-500 bg-rose-950/15' : ''
                        }`}
                      >
                        <td className="py-3 px-4 font-mono text-slate-300 font-semibold whitespace-nowrap">{tx.transaction_date || '—'}</td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {driveUrl ? (
                            <a
                              href={driveUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-sky-400 hover:text-sky-300 hover:underline transition font-mono text-[11px] group max-w-[220px]"
                              title={`Open original slip in Google Drive: ${tx.source_file_name}`}
                            >
                              <span className="truncate">{tx.source_file_name || 'Slip Document'}</span>
                              <ExternalLink className="w-3 h-3 shrink-0 opacity-70 group-hover:opacity-100 transition text-sky-400" />
                            </a>
                          ) : (
                            <span className="font-mono text-[11px] text-slate-400 max-w-[180px] truncate block" title={tx.source_file_name}>
                              {tx.source_file_name || 'Slip'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-bold text-white whitespace-nowrap">
                          <div className="flex items-center gap-1.5 group">
                            <span>{toTitleCase(tx.item_or_description)}</span>
                            <button
                              onClick={() => handleStartEdit(tx)}
                              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-slate-800 rounded text-slate-400 hover:text-sky-400 transition"
                              title="Edit item name or details"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center font-mono whitespace-nowrap">{pickQty}</td>
                        <td className="py-3 px-4 text-center font-mono whitespace-nowrap">{delivQty}</td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          {lossQty > 0 ? (
                            <span className="inline-flex items-center gap-1 font-mono font-bold px-2 py-0.5 rounded-full text-[11px] bg-rose-950/80 border border-rose-500/50 text-rose-300 shadow-sm">
                              <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                              <span>-{lossQty} missing</span>
                            </span>
                          ) : (
                            <span className="text-slate-600 font-mono text-xs">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono whitespace-nowrap">{formatCurrency(rate)}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400 whitespace-nowrap">
                          {formatCurrency(total)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(tx.reviewed)}
                            onChange={() => handleToggleTx(tx.id, 'reviewed', tx.reviewed)}
                            className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-sky-600 focus:ring-sky-500 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(tx.approved)}
                            onChange={() => handleToggleTx(tx.id, 'approved', tx.approved)}
                            className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                              tx.status === 'INVOICED'
                                ? 'bg-sky-950 border border-sky-500/40 text-sky-300'
                                : tx.approved
                                ? 'bg-emerald-950 border border-emerald-500/40 text-emerald-300'
                                : 'bg-amber-950/60 border border-amber-500/30 text-amber-400'
                            }`}
                          >
                            {tx.status === 'INVOICED' ? 'INVOICED' : tx.approved ? 'APPROVED' : tx.status || 'PENDING'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <button
                            onClick={() => handleStartEdit(tx)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-slate-400 hover:text-sky-300 hover:bg-slate-800 border border-slate-800 hover:border-sky-500/40 transition cursor-pointer"
                            title="Edit item name, quantities, or rate"
                          >
                            <Edit3 className="w-3 h-3 text-sky-400" />
                            <span>Edit</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={12} className="py-12 text-center text-slate-500 text-xs">
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
          <div className="bg-slate-950/80 border-t border-slate-800 px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
            {dailyViewMode === 'grouped' ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between w-full gap-2">
                <div className="flex items-center gap-2">
                  <FolderKanban className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>
                    Showing <strong className="text-white font-mono">{groupedSlips.length}</strong> daily control slips (<strong className="text-white font-mono">{filteredArStagedTx.length}</strong> total line items)
                  </span>
                </div>
                <div className="flex items-center gap-1 text-slate-500 text-[11px]">
                  <span>Tip: Click</span>
                  <strong className="text-emerald-400 font-semibold">Approve Slip</strong>
                  <span>on any slip header to approve all items at once.</span>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <span>
                    Showing{' '}
                    <strong className="text-white font-mono">
                      {dailyPageSize === 'all' ? 1 : Math.min((dailyCurrentPage - 1) * Number(dailyPageSize) + 1, totalDailyCount)}
                    </strong>{' '}
                    to{' '}
                    <strong className="text-white font-mono">
                      {dailyPageSize === 'all' ? totalDailyCount : Math.min(dailyCurrentPage * Number(dailyPageSize), totalDailyCount)}
                    </strong>{' '}
                    of <strong className="text-white font-mono">{totalDailyCount}</strong> items
                  </span>

                  <div className="flex items-center gap-1.5 ml-2">
                    <span className="text-slate-500 text-[11px]">Show:</span>
                    {[25, 50, 100, 'all'].map((size) => (
                      <button
                        key={String(size)}
                        onClick={() => setDailyPageSize(size as any)}
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer ${
                          dailyPageSize === size
                            ? 'bg-sky-600 text-white shadow'
                            : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
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
                      className="p-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-lg text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
                      title="Previous page"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>

                    <span className="px-2 font-mono text-slate-300 text-xs">
                      Page <strong className="text-white">{dailyCurrentPage}</strong> of{' '}
                      <strong className="text-white">{totalDailyPages}</strong>
                    </span>

                    <button
                      onClick={() => setDailyCurrentPage((p) => Math.min(totalDailyPages, p + 1))}
                      disabled={dailyCurrentPage === totalDailyPages}
                      className="p-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-lg text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
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

    </div>
  );
};
