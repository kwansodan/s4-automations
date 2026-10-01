import React, { useState, useEffect, useMemo } from 'react';
import { useClient } from '../../../context/ClientContext';
import { useAutomation } from '../../../context/AutomationContext';
import {
  fetchClientTransactions,
  toggleClientTransaction,
  batchToggleTransactions,
  batchApproveTransactions,
  deleteStagedTransaction,
  batchDeleteStagedTransactions,
  batchUpdateTransactionDate,
  createClientTransaction,
  triggerApPipeline,
} from '../../../lib/api';
import { formatCurrency, downloadTxt } from '../../../lib/utils';
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
  Plus,
  Sparkles,
  Clock,
  AlertCircle,
  CheckSquare,
  Square,
  Filter,
  ArrowUpDown,
  Calendar,
  Building2,
  Check,
  Save,
  X,
  Download,
  Edit3,
} from 'lucide-react';
import { PurgeIngestedFileModal } from '../../modals/PurgeIngestedFileModal';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const YEARS = [2025, 2026, 2027];

export const ClientApTab: React.FC = () => {
  const { currentClient } = useClient();
  const { selectedMonth, setSelectedMonth, selectedYear, setSelectedYear, addLog } = useAutomation();

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

  // Filtering & Sorting State
  const [apStatusFilter, setApStatusFilter] = useState<'ALL' | 'UNREVIEWED' | 'UNAPPROVED' | 'LOW_CONFIDENCE' | 'PENDING' | 'APPROVED' | 'INVOICED'>('ALL');
  const [vendorFilter, setVendorFilter] = useState<string>('ALL');
  const [apSortBy, setApSortBy] = useState<string>('date_desc');

  // Bulk Operations State
  const [selectedTxIds, setSelectedTxIds] = useState<Set<number>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState<boolean>(false);
  const [isBulkApproving, setIsBulkApproving] = useState<boolean>(false);
  const [isBulkReviewing, setIsBulkReviewing] = useState<boolean>(false);

  // Missing Activity Gap Cadence (Pipeline / Session configurable)
  const [missingCadence, setMissingCadence] = useState<'daily' | 'weekly' | 'fortnightly' | 'monthly' | 'disabled'>('daily');

  // Manual Add Vendor Bill Modal State
  const [isAddBillModalOpen, setIsAddBillModalOpen] = useState<boolean>(false);
  const [manualBillVendor, setManualBillVendor] = useState<string>('');
  const [manualBillDate, setManualBillDate] = useState<string>('');
  const [manualBillDocName, setManualBillDocName] = useState<string>('');
  const [manualBillCategory, setManualBillCategory] = useState<string>('Vendor Bill');
  const [manualBillAmount, setManualBillAmount] = useState<number | string>(0);
  const [isCreatingBill, setIsCreatingBill] = useState<boolean>(false);
  const [createBillError, setCreateBillError] = useState<string | null>(null);

  // Bill Date Correction State
  const [editingDateBill, setEditingDateBill] = useState<any | null>(null);
  const [newBillDateValue, setNewBillDateValue] = useState<string>('');
  const [isSavingBillDate, setIsSavingBillDate] = useState<boolean>(false);

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
    setSelectedTxIds(new Set());
  }, [currentClient?.id, selectedMonth, selectedYear]);

  // Auto-sync missing cadence from active AP pipeline configuration
  useEffect(() => {
    if (!currentClient?.pipelines) return;
    const apPipeline = currentClient.pipelines.find(
      (p: any) => p.pipeline_type === 'AP' || p.type === 'AP' || (p.name || '').toLowerCase().includes('payable') || (p.name || '').toLowerCase().includes('bill')
    );
    if (apPipeline) {
      const cad = (apPipeline as any).missing_cadence || apPipeline.source_config?.missing_cadence;
      if (cad && ['daily', 'weekly', 'fortnightly', 'monthly', 'disabled'].includes(cad)) {
        setMissingCadence(cad as any);
      }
    }
  }, [currentClient?.pipelines]);

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
      await batchToggleTransactions(currentClient.id, idsToApprove, 'reviewed', true);
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
      setSelectedTxIds((prev) => {
        const next = new Set(prev);
        next.delete(txId);
        return next;
      });
      addLog('success', `Deleted staged vendor bill #${txId}`);
    } catch (err: any) {
      addLog('error', `Failed to delete bill: ${err.message}`);
    } finally {
      setDeletingTxId(null);
    }
  };

  // Low confidence detector helper
  const isItemLowConf = (tx: any): boolean => {
    if (typeof tx?.confidence_score === 'number' && tx.confidence_score < 0.80) return true;
    if (tx?.confidence_score === 'LOW') return true;
    if (tx?.metadata_json?.warning === 'LOW_CONFIDENCE_OCR' || tx?.metadata_json?.confidence === 'LOW') return true;
    return false;
  };

  // Bulk Selection Handlers
  const handleToggleSelectBill = (txId: number) => {
    setSelectedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId);
      else next.add(txId);
      return next;
    });
  };

  const handleSelectAllVisibleBills = () => {
    if (selectedTxIds.size >= sortedApTransactions.length && sortedApTransactions.length > 0) {
      setSelectedTxIds(new Set());
    } else {
      setSelectedTxIds(new Set(sortedApTransactions.map((t) => t.id)));
    }
  };

  const handleBulkDeleteApBills = async () => {
    if (!currentClient?.id || selectedTxIds.size === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedTxIds.size} selected vendor bill(s) from the ledger? This will permanently purge the staged transactions.`)) {
      return;
    }
    const ids = Array.from(selectedTxIds);
    setIsBulkDeleting(true);
    try {
      await batchDeleteStagedTransactions(currentClient.id, { transaction_ids: ids });
      setTransactions((prev) => prev.filter((t) => !selectedTxIds.has(t.id)));
      setSelectedTxIds(new Set());
      addLog('success', `Bulk deleted ${ids.length} vendor bills.`);
    } catch (err: any) {
      addLog('error', `Bulk delete failed: ${err.message}`);
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleBulkApproveApBills = async () => {
    if (!currentClient?.id || selectedTxIds.size === 0) return;
    const ids = Array.from(selectedTxIds);
    setIsBulkApproving(true);
    try {
      await batchApproveTransactions(currentClient.id, ids, 'Bulk Approved via In-App AP Ledger');
      await batchToggleTransactions(currentClient.id, ids, 'reviewed', true);
      setTransactions((prev) =>
        prev.map((t) => (selectedTxIds.has(t.id) ? { ...t, approved: true, reviewed: true, status: 'APPROVED' } : t))
      );
      setSelectedTxIds(new Set());
      addLog('success', `Bulk approved ${ids.length} vendor bills.`);
    } catch (err: any) {
      addLog('error', `Bulk approve failed: ${err.message}`);
    } finally {
      setIsBulkApproving(false);
    }
  };

  const handleBulkReviewApBills = async () => {
    if (!currentClient?.id || selectedTxIds.size === 0) return;
    const ids = Array.from(selectedTxIds);
    setIsBulkReviewing(true);
    try {
      await batchToggleTransactions(currentClient.id, ids, 'reviewed', true);
      setTransactions((prev) =>
        prev.map((t) => (selectedTxIds.has(t.id) ? { ...t, reviewed: true } : t))
      );
      setSelectedTxIds(new Set());
      addLog('success', `Bulk marked ${ids.length} vendor bills as reviewed.`);
    } catch (err: any) {
      addLog('error', `Bulk review failed: ${err.message}`);
    } finally {
      setIsBulkReviewing(false);
    }
  };

  // Manual Vendor Bill Modal Handlers
  const handleOpenAddBillModal = (prefillDate?: string) => {
    const mIdx = MONTHS.indexOf(selectedMonth);
    const mStr = String(mIdx !== -1 ? mIdx + 1 : new Date().getMonth() + 1).padStart(2, '0');
    const dStr = String(new Date().getDate()).padStart(2, '0');
    const defaultDate = prefillDate || `${selectedYear || new Date().getFullYear()}-${mStr}-${dStr}`;
    const defaultVendor = vendorFilter !== 'ALL' ? vendorFilter : (availableVendors[0] || '');

    setManualBillVendor(defaultVendor);
    setManualBillDate(defaultDate);
    setManualBillDocName(`Bill_${defaultVendor ? defaultVendor.replace(/\s+/g, '_') : 'Vendor'}_${defaultDate}`);
    setManualBillCategory('Vendor Bill');
    setManualBillAmount('');
    setCreateBillError(null);
    setIsAddBillModalOpen(true);
  };

  const handleCreateManualBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentClient?.id) return;
    setCreateBillError(null);

    const vendorName = manualBillVendor.trim();
    if (!vendorName) {
      setCreateBillError('Please specify a vendor name.');
      return;
    }
    const amt = Number(manualBillAmount) || 0;
    if (amt <= 0) {
      setCreateBillError('Please enter a valid bill total amount greater than 0.');
      return;
    }

    setIsCreatingBill(true);
    try {
      const docName = manualBillDocName.trim() || `Manual_Bill_${vendorName.replace(/\s+/g, '_')}_${manualBillDate}`;

      const res = await createClientTransaction(currentClient.id, {
        pipeline_type: 'AP',
        source_file_name: docName,
        transaction_date: manualBillDate,
        item_or_description: vendorName,
        quantity_or_debit: 1,
        rate_or_price: amt,
        total_amount: amt,
        category_or_account: manualBillCategory.trim() || 'Vendor Bill',
        reviewed: true,
        approved: true,
        status: 'APPROVED',
        metadata_json: {
          vendor_name: vendorName,
          is_manual_entry: true,
          created_at: new Date().toISOString(),
        },
      });

      // Optimistically insert newly created bill transaction
      if (res?.transaction) {
        setTransactions((prev) => [res.transaction, ...prev]);
      }

      addLog('success', `Manually created vendor bill "${docName}" for ${vendorName}`);
      setIsAddBillModalOpen(false);
      setApStatusFilter('ALL');
      setVendorFilter('ALL');
      await loadTransactions();
      setActiveSubTab('bills');
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to create manual vendor bill. Please check backend connection.';
      setCreateBillError(errMsg);
      addLog('error', `Failed to create manual vendor bill: ${errMsg}`);
    } finally {
      setIsCreatingBill(false);
    }
  };

  const handleOpenEditBillDate = (bill: any) => {
    setEditingDateBill(bill);
    setNewBillDateValue(
      bill.transaction_date && bill.transaction_date !== '-'
        ? bill.transaction_date
        : `${selectedYear}-${String(MONTHS.indexOf(selectedMonth) + 1).padStart(2, '0')}-01`
    );
  };

  const handleSaveBillDate = async () => {
    if (!currentClient?.id || !editingDateBill || !newBillDateValue) return;
    setIsSavingBillDate(true);
    try {
      const res = await batchUpdateTransactionDate(currentClient.id, {
        transaction_ids: [editingDateBill.id],
        new_date: newBillDateValue,
      });

      const parts = newBillDateValue.split('-');
      const yNum = parseInt(parts[0], 10);
      const mIdx = parseInt(parts[1], 10) - 1;
      const targetMonth = MONTHS[mIdx] || selectedMonth;
      const targetYear = yNum || selectedYear;

      addLog('success', `Corrected bill date to ${newBillDateValue} for "${editingDateBill.item_or_description}".`);

      if (targetMonth !== selectedMonth || targetYear !== selectedYear) {
        setSelectedMonth(targetMonth);
        setSelectedYear(targetYear);
        addLog('info', `Switched active AP ledger view to ${targetMonth} ${targetYear}.`);
      } else {
        await loadTransactions();
      }
      setEditingDateBill(null);
    } catch (err: any) {
      addLog('error', `Failed updating bill date: ${err.message}`);
    } finally {
      setIsSavingBillDate(false);
    }
  };

  const query = (search || '').trim().toLowerCase();

  const apTransactions = transactions.filter((t) => t.pipeline_type === 'AP');

  const availableVendors = useMemo(() => {
    const set = new Set<string>();
    apTransactions.forEach((t) => {
      const v = (t.item_or_description || '').trim();
      if (v) set.add(v);
    });
    return Array.from(set).sort();
  }, [apTransactions]);

  const apCounts = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let invoiced = 0;
    let unreviewed = 0;
    let unapproved = 0;
    let lowConfidence = 0;

    const target = vendorFilter === 'ALL'
      ? apTransactions
      : apTransactions.filter((t) => (t.item_or_description || '').trim() === vendorFilter);

    target.forEach((tx) => {
      if (tx.status === 'INVOICED') invoiced++;
      else if (tx.approved) approved++;
      else pending++;

      if (!tx.reviewed) unreviewed++;
      if (!tx.approved && tx.status !== 'INVOICED') unapproved++;
      if (isItemLowConf(tx)) lowConfidence++;
    });

    return {
      all: target.length,
      totalAcrossAllVendors: apTransactions.length,
      pending,
      approved,
      invoiced,
      unreviewed,
      unapproved,
      lowConfidence,
    };
  }, [apTransactions, vendorFilter]);

  const filteredApTransactions = useMemo(() => {
    return apTransactions.filter((t) => {
      // 1. Status Filter
      if (apStatusFilter === 'UNREVIEWED' && t.reviewed) return false;
      if (apStatusFilter === 'UNAPPROVED' && (t.approved || t.status === 'INVOICED')) return false;
      if (apStatusFilter === 'LOW_CONFIDENCE' && !isItemLowConf(t)) return false;
      if (apStatusFilter === 'PENDING' && (t.approved || t.status === 'INVOICED')) return false;
      if (apStatusFilter === 'APPROVED' && (!t.approved || t.status === 'INVOICED')) return false;
      if (apStatusFilter === 'INVOICED' && t.status !== 'INVOICED') return false;

      // 2. Vendor Filter
      if (vendorFilter !== 'ALL' && (t.item_or_description || '').trim() !== vendorFilter) {
        return false;
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
  }, [apTransactions, apStatusFilter, vendorFilter, query]);

  const sortedApTransactions = useMemo(() => {
    const list = [...filteredApTransactions];
    list.sort((a, b) => {
      if (apSortBy === 'date_desc') {
        return (b.transaction_date || '').localeCompare(a.transaction_date || '');
      }
      if (apSortBy === 'date_asc') {
        return (a.transaction_date || '').localeCompare(b.transaction_date || '');
      }
      if (apSortBy === 'vendor_asc') {
        return (a.item_or_description || '').localeCompare(b.item_or_description || '');
      }
      if (apSortBy === 'vendor_desc') {
        return (b.item_or_description || '').localeCompare(a.item_or_description || '');
      }
      if (apSortBy === 'amount_desc') {
        return (b.total_amount || 0) - (a.total_amount || 0);
      }
      if (apSortBy === 'amount_asc') {
        return (a.total_amount || 0) - (b.total_amount || 0);
      }
      if (apSortBy === 'low_conf_first') {
        const aLow = isItemLowConf(a);
        const bLow = isItemLowConf(b);
        if (aLow !== bLow) return aLow ? -1 : 1;
        return (b.transaction_date || '').localeCompare(a.transaction_date || '');
      }
      if (apSortBy === 'unreviewed_first') {
        if (Boolean(a.reviewed) !== Boolean(b.reviewed)) {
          return !a.reviewed ? -1 : 1;
        }
        return (b.transaction_date || '').localeCompare(a.transaction_date || '');
      }
      if (apSortBy === 'unapproved_first') {
        if (Boolean(a.approved) !== Boolean(b.approved)) {
          return !a.approved ? -1 : 1;
        }
        return (b.transaction_date || '').localeCompare(a.transaction_date || '');
      }
      return (b.transaction_date || '').localeCompare(a.transaction_date || '');
    });
    return list;
  }, [filteredApTransactions, apSortBy]);

  interface MissingPeriod {
    key: string;
    label: string;
    defaultDate: string;
  }

  const computeMissingGapsForApTx = (
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
          let hasBill = false;
          for (let d = w.start; d <= endDay; d++) {
            const dStr = String(d).padStart(2, '0');
            const mStr = String(monthIdx + 1).padStart(2, '0');
            if (presentDates.has(`${yearNum}-${mStr}-${dStr}`)) {
              hasBill = true;
              break;
            }
          }
          if (!hasBill) {
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
      let fn1HasBill = false;
      for (let d = 1; d <= fn1End; d++) {
        const dStr = String(d).padStart(2, '0');
        const mStr = String(monthIdx + 1).padStart(2, '0');
        if (presentDates.has(`${yearNum}-${mStr}-${dStr}`)) {
          fn1HasBill = true;
          break;
        }
      }
      const mStr = String(monthIdx + 1).padStart(2, '0');
      if (!fn1HasBill) {
        gaps.push({
          key: `${yearNum}-${mStr}-fn1`,
          label: `1st Fortnight (${month.slice(0, 3)} 01-14)`,
          defaultDate: `${yearNum}-${mStr}-01`,
        });
      }
      if (maxDay >= 15) {
        let fn2HasBill = false;
        for (let d = 15; d <= maxDay; d++) {
          const dStr = String(d).padStart(2, '0');
          if (presentDates.has(`${yearNum}-${mStr}-${dStr}`)) {
            fn2HasBill = true;
            break;
          }
        }
        if (!fn2HasBill) {
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
    const targetTx = vendorFilter === 'ALL'
      ? apTransactions
      : apTransactions.filter((t) => (t.item_or_description || '').trim() === vendorFilter);

    return computeMissingGapsForApTx(targetTx, missingCadence, selectedMonth, selectedYear);
  }, [missingCadence, selectedMonth, selectedYear, apTransactions, vendorFilter]);

  const handleExportMissingPeriodsTxt = () => {
    if (missingCadence === 'disabled') {
      alert('Missing activity detection is currently disabled. Please select a cadence first.');
      return;
    }

    const isFiltered = vendorFilter !== 'ALL';
    const clientName = currentClient?.name || 'Client';
    let txt = '';

    if (isFiltered) {
      const targetTx = apTransactions.filter((t) => (t.item_or_description || '').trim() === vendorFilter);
      const gaps = computeMissingGapsForApTx(targetTx, missingCadence, selectedMonth, selectedYear);

      txt += `Vendor: ${vendorFilter}\n`;
      if (gaps.length === 0) {
        txt += 'No missing dates\n';
      } else {
        gaps.forEach((g) => {
          txt += `${missingCadence === 'daily' ? g.defaultDate : g.label}\n`;
        });
      }
    } else {
      const vendorsToReport = availableVendors.length > 0
        ? [...availableVendors]
        : Array.from(new Set(apTransactions.map((t) => (t.item_or_description || '').trim()).filter(Boolean)));

      if (vendorsToReport.length === 0) {
        vendorsToReport.push(clientName);
      }

      vendorsToReport.forEach((vnd, idx) => {
        const vndTx = apTransactions.filter((t) => (t.item_or_description || '').trim() === vnd);
        const gaps = computeMissingGapsForApTx(vndTx, missingCadence, selectedMonth, selectedYear);

        if (idx > 0) txt += '\n';
        txt += `Vendor: ${vnd}\n`;
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
    const safeScope = isFiltered ? vendorFilter.replace(/[^a-zA-Z0-9_-]/g, '_') : 'All_Vendors';
    const filename = `Missing_Dates_AP_${safeClient}_${safeScope}_${selectedMonth}_${selectedYear}.txt`;

    downloadTxt(filename, txt);
    addLog('success', `Exported missing dates to ${filename}`);
  };

  const apKpis = useMemo(() => {
    return {
      totalBills: apCounts.all,
      totalAmount: filteredApTransactions.reduce((sum, t) => sum + (t.total_amount || 0), 0),
      unreviewedBills: apCounts.unreviewed,
      unapprovedBills: apCounts.unapproved,
      lowConfidenceBills: apCounts.lowConfidence,
      missingPeriodsCount: missingPeriods.length,
    };
  }, [apCounts, filteredApTransactions, missingPeriods.length]);

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
      const vendor = (tx.item_or_description || 'Unknown Vendor').trim();
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
    let list = vendorSummary;
    if (vendorFilter !== 'ALL') {
      list = list.filter((v) => v.vendor_name === vendorFilter);
    }
    if (query) {
      list = list.filter(
        (v) =>
          v.vendor_name.toLowerCase().includes(query) ||
          v.category.toLowerCase().includes(query)
      );
    }
    return list;
  }, [vendorSummary, vendorFilter, query]);

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

          {/* Auto Post Toggle */}
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 bg-white border border-[#E2E8F0] px-3 py-1.5 rounded-xl cursor-pointer shadow-xs hover:bg-slate-50 transition">
            <input
              type="checkbox"
              checked={isAutoPostDraft}
              onChange={(e) => setIsAutoPostDraft(e.target.checked)}
              className="rounded border-slate-300 text-[#0284C7] focus:ring-0 cursor-pointer"
            />
            <span className="hidden sm:inline">Auto-Post Drafts</span>
          </label>

          {/* Refresh */}
          <button
            onClick={loadTransactions}
            disabled={isLoadingTx}
            className="p-2 bg-white border border-[#E2E8F0] hover:bg-slate-50 text-slate-600 rounded-xl transition cursor-pointer shadow-xs"
            title="Refresh AP Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingTx ? 'animate-spin text-[#0284C7]' : ''}`} />
          </button>

          {/* Run AP Pipeline */}
          <button
            onClick={handleRunApPipeline}
            disabled={isRunning}
            className="flex items-center gap-2 bg-[#0284C7] hover:bg-[#0EA5E9] text-white border border-[#0284C7] text-xs font-semibold px-3.5 py-1.5 rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
          >
            {isRunning ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <PlayCircle className="w-3.5 h-3.5" />
            )}
            <span>{isRunning ? 'Running Pipeline...' : 'Run AP Pipeline'}</span>
          </button>

          {/* Add Manual Vendor Bill */}
          <button
            onClick={() => handleOpenAddBillModal()}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3.5 py-1.5 rounded-xl shadow-xs transition cursor-pointer"
            title="Manually create a new vendor bill in the ledger"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Vendor Bill</span>
          </button>

          {/* Purge File */}
          <button
            onClick={() => {
              setPurgeTargetFileName('');
              setIsPurgeModalOpen(true);
            }}
            className="flex items-center gap-1.5 bg-white hover:bg-[#FFF1F2] border border-[#FECDD3] text-[#E11D48] text-xs font-semibold px-3 py-1.5 rounded-xl transition cursor-pointer"
            title="Delete mistakenly ingested files or clear erroneous document data"
          >
            <Trash2 className="w-3.5 h-3.5 text-[#E11D48]" />
            <span className="hidden sm:inline">Delete File</span>
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

      {/* Dynamic AP KPI Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        {/* Card 1: Total Bills */}
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-3 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-400">Total Vendor Bills</div>
            <div className="text-lg font-bold text-slate-900 font-mono">{apKpis.totalBills}</div>
            <div className="text-[11px] text-slate-500 font-mono">
              {formatCurrency(apKpis.totalAmount)}
            </div>
          </div>
          <div className="p-2.5 bg-slate-100 rounded-xl text-slate-600">
            <FileText className="w-5 h-5" />
          </div>
        </div>

        {/* Card 2: Unreviewed Bills */}
        <button
          type="button"
          onClick={() => {
            setActiveSubTab('bills');
            setApStatusFilter((prev) => (prev === 'UNREVIEWED' ? 'ALL' : 'UNREVIEWED'));
          }}
          className={`p-3 rounded-xl border text-left transition shadow-xs cursor-pointer flex items-center justify-between ${
            apStatusFilter === 'UNREVIEWED' && activeSubTab === 'bills'
              ? 'bg-sky-50 border-sky-300 ring-2 ring-sky-400/40'
              : 'bg-white border-[#E2E8F0] hover:border-sky-300'
          }`}
        >
          <div>
            <div className="text-[10px] uppercase font-bold text-sky-700">Unreviewed Bills</div>
            <div className="text-lg font-bold text-sky-900 font-mono">{apKpis.unreviewedBills}</div>
            <div className="text-[11px] text-sky-600 font-medium">Click to filter unreviewed</div>
          </div>
          <div className="p-2.5 bg-sky-100 text-sky-600 rounded-xl">
            <Clock className="w-5 h-5" />
          </div>
        </button>

        {/* Card 3: Unapproved Bills */}
        <button
          type="button"
          onClick={() => {
            setActiveSubTab('bills');
            setApStatusFilter((prev) => (prev === 'UNAPPROVED' ? 'ALL' : 'UNAPPROVED'));
          }}
          className={`p-3 rounded-xl border text-left transition shadow-xs cursor-pointer flex items-center justify-between ${
            apStatusFilter === 'UNAPPROVED' && activeSubTab === 'bills'
              ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-400/40'
              : 'bg-white border-[#E2E8F0] hover:border-amber-300'
          }`}
        >
          <div>
            <div className="text-[10px] uppercase font-bold text-amber-700">Unapproved Bills</div>
            <div className="text-lg font-bold text-amber-900 font-mono">{apKpis.unapprovedBills}</div>
            <div className="text-[11px] text-amber-600 font-medium">Pending approval sign-off</div>
          </div>
          <div className="p-2.5 bg-amber-100 text-amber-600 rounded-xl">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </button>

        {/* Card 4: AI Low Confidence */}
        <button
          type="button"
          onClick={() => {
            setActiveSubTab('bills');
            setApStatusFilter((prev) => (prev === 'LOW_CONFIDENCE' ? 'ALL' : 'LOW_CONFIDENCE'));
          }}
          className={`p-3 rounded-xl border text-left transition shadow-xs cursor-pointer flex items-center justify-between ${
            apStatusFilter === 'LOW_CONFIDENCE' && activeSubTab === 'bills'
              ? 'bg-purple-50 border-purple-300 ring-2 ring-purple-400/40'
              : 'bg-white border-[#E2E8F0] hover:border-purple-300'
          }`}
        >
          <div>
            <div className="text-[10px] uppercase font-bold text-purple-700">AI Low Confidence</div>
            <div className="text-lg font-bold text-purple-900 font-mono">{apKpis.lowConfidenceBills}</div>
            <div className="text-[11px] text-purple-600 font-medium">OCR &lt; 80% legibility</div>
          </div>
          <div className="p-2.5 bg-purple-100 text-purple-600 rounded-xl">
            <Sparkles className="w-5 h-5" />
          </div>
        </button>

        {/* Card 5: Missing Periods Gaps */}
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-3 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase font-bold text-rose-600">Missing Activity</div>
            <div className="text-lg font-bold text-rose-900 font-mono">{apKpis.missingPeriodsCount}</div>
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

      {/* Interactive Missing Periods Alert Banner */}
      {missingCadence !== 'disabled' && missingPeriods.length > 0 && (
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
                  {vendorFilter === 'ALL' ? 'All Vendors' : vendorFilter}
                </span>
                <button
                  type="button"
                  onClick={handleExportMissingPeriodsTxt}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-semibold text-[11px] transition shadow-xs cursor-pointer ml-1"
                  title={`Export missing activity to .txt (${vendorFilter === 'ALL' ? 'All Vendors' : vendorFilter})`}
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export to TXT</span>
                </button>
              </div>
              <p className="text-[11px] text-amber-700/90 mt-0.5">
                No vendor bills recorded in PostgreSQL for these periods. Click any <strong className="font-semibold">[ + ]</strong> badge to manually record a bill.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap max-h-24 overflow-y-auto">
            {missingPeriods.map((period) => (
              <button
                key={period.key}
                type="button"
                onClick={() => handleOpenAddBillModal(period.defaultDate)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white border border-amber-300 text-amber-900 hover:bg-amber-100 hover:border-amber-400 font-mono text-[11px] font-semibold transition cursor-pointer shadow-2xs"
                title={`Click to manually add a vendor bill for ${period.label}`}
              >
                <span>{period.label}</span>
                <Plus className="w-3 h-3 text-amber-600" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Floating / Sticky Bulk Actions Toolbar */}
      {selectedTxIds.size > 0 && (
        <div className="sticky top-4 z-30 bg-[#0F172A] text-white rounded-xl p-3 shadow-xl border border-slate-700 flex flex-wrap items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-sky-400" />
            <span className="font-bold text-xs">
              {selectedTxIds.size} {selectedTxIds.size === 1 ? 'Bill' : 'Bills'} Selected
            </span>
            <span className="text-slate-400 text-xs hidden sm:inline">•</span>
            <span className="text-emerald-400 font-mono font-bold text-xs">
              {formatCurrency(
                apTransactions.filter((t) => selectedTxIds.has(t.id)).reduce((sum, t) => sum + (t.total_amount || 0), 0)
              )}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleBulkApproveApBills}
              disabled={isBulkApproving}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-xs transition cursor-pointer disabled:opacity-50"
            >
              {isBulkApproving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              <span>Approve Selected</span>
            </button>

            <button
              type="button"
              onClick={handleBulkReviewApBills}
              disabled={isBulkReviewing}
              className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-xs transition cursor-pointer disabled:opacity-50"
            >
              {isBulkReviewing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
              <span>Mark Reviewed</span>
            </button>

            <button
              type="button"
              onClick={handleBulkDeleteApBills}
              disabled={isBulkDeleting}
              className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-xs transition cursor-pointer disabled:opacity-50"
            >
              {isBulkDeleting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              <span>Delete Selected</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedTxIds(new Set())}
              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
              title="Deselect all bills"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* View Switcher Tabs & Filters & Search */}
      <div className="flex flex-col gap-2.5 bg-white border border-[#E2E8F0] rounded-2xl p-3 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
              <span>Vendor Summary ({filteredVendorSummary.length})</span>
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
              <span>Vendor Bills ({filteredApTransactions.length})</span>
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
                className="bg-slate-50 border border-[#E2E8F0] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#0F172A] placeholder-slate-400 focus:outline-none focus:border-[#0284C7] sm:w-60"
              />
            </div>
          </div>
        </div>

        {/* Secondary Filter Row: Status Pills, Vendor Selector, Sort & Missing Cadence */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setApStatusFilter('ALL')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                apStatusFilter === 'ALL'
                  ? 'bg-[#0F172A] text-white shadow-xs'
                  : 'bg-slate-50 text-slate-600 hover:text-slate-900 border border-[#E2E8F0]'
              }`}
            >
              <span>All Bills</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-slate-200/70 text-slate-700">
                {apCounts.all}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setApStatusFilter('UNREVIEWED')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                apStatusFilter === 'UNREVIEWED'
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'bg-slate-50 text-slate-600 hover:text-slate-900 border border-[#E2E8F0]'
              }`}
            >
              <Clock className="w-3 h-3" />
              <span>Unreviewed</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${apStatusFilter === 'UNREVIEWED' ? 'bg-sky-700 text-white' : 'bg-sky-100 text-sky-800'}`}>
                {apCounts.unreviewed}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setApStatusFilter('UNAPPROVED')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                apStatusFilter === 'UNAPPROVED'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-slate-50 text-slate-600 hover:text-slate-900 border border-[#E2E8F0]'
              }`}
            >
              <AlertTriangle className="w-3 h-3" />
              <span>Unapproved</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${apStatusFilter === 'UNAPPROVED' ? 'bg-amber-700 text-white' : 'bg-amber-100 text-amber-800'}`}>
                {apCounts.unapproved}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setApStatusFilter('LOW_CONFIDENCE')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                apStatusFilter === 'LOW_CONFIDENCE'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-slate-50 text-slate-600 hover:text-slate-900 border border-[#E2E8F0]'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              <span>AI Low Conf</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${apStatusFilter === 'LOW_CONFIDENCE' ? 'bg-purple-700 text-white' : 'bg-purple-100 text-purple-800'}`}>
                {apCounts.lowConfidence}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setApStatusFilter('APPROVED')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                apStatusFilter === 'APPROVED'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-slate-50 text-slate-600 hover:text-slate-900 border border-[#E2E8F0]'
              }`}
            >
              <Check className="w-3 h-3" />
              <span>Approved</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${apStatusFilter === 'APPROVED' ? 'bg-emerald-700 text-white' : 'bg-emerald-100 text-emerald-800'}`}>
                {apCounts.approved}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setApStatusFilter('INVOICED')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                apStatusFilter === 'INVOICED'
                  ? 'bg-sky-700 text-white shadow-xs'
                  : 'bg-slate-50 text-slate-600 hover:text-slate-900 border border-[#E2E8F0]'
              }`}
            >
              <span>Draft Bills</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${apStatusFilter === 'INVOICED' ? 'bg-sky-800 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {apCounts.invoiced}
              </span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Vendor Filter */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-[#E2E8F0] rounded-lg px-2.5 py-1 text-xs">
              <Building2 className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={vendorFilter}
                onChange={(e) => setVendorFilter(e.target.value)}
                className="bg-transparent text-slate-700 font-semibold focus:outline-none cursor-pointer max-w-[150px] truncate"
              >
                <option value="ALL">All Vendors ({availableVendors.length})</option>
                {availableVendors.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            {/* Sorting Filter */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-[#E2E8F0] rounded-lg px-2.5 py-1 text-xs">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={apSortBy}
                onChange={(e) => setApSortBy(e.target.value)}
                className="bg-transparent text-slate-700 font-semibold focus:outline-none cursor-pointer"
              >
                <option value="date_desc">Date (Newest first)</option>
                <option value="date_asc">Date (Oldest first)</option>
                <option value="vendor_asc">Vendor (A to Z)</option>
                <option value="vendor_desc">Vendor (Z to A)</option>
                <option value="amount_desc">Bill Total (High to Low)</option>
                <option value="amount_asc">Bill Total (Low to High)</option>
                <option value="unreviewed_first">Unreviewed First</option>
                <option value="unapproved_first">Unapproved First</option>
                <option value="low_conf_first">AI Low Confidence First</option>
              </select>
            </div>

            {/* Missing Activity Cadence Dropdown */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-[#E2E8F0] rounded-lg px-2.5 py-1 text-xs" title="Missing Activity Gap Reporting Cadence">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[10px] uppercase font-bold text-slate-400 hidden sm:inline">Gap:</span>
              <select
                value={missingCadence}
                onChange={(e) => setMissingCadence(e.target.value as any)}
                className="bg-transparent text-slate-700 font-semibold focus:outline-none cursor-pointer text-xs"
              >
                <option value="daily">Daily Gaps</option>
                <option value="weekly">Weekly Gaps</option>
                <option value="fortnightly">Fortnightly Gaps</option>
                <option value="monthly">Monthly Gaps</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>

            {missingCadence !== 'disabled' && (
              <button
                type="button"
                onClick={handleExportMissingPeriodsTxt}
                className="flex items-center gap-1.5 bg-white border border-[#E2E8F0] hover:bg-slate-50 text-slate-700 px-2.5 py-1 rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer shrink-0"
                title={`Export missing activity report to .txt (${vendorFilter === 'ALL' ? 'All Vendors' : vendorFilter})`}
              >
                <Download className="w-3.5 h-3.5 text-amber-600" />
                <span className="hidden sm:inline">Export Missing (.txt)</span>
                <span className="sm:hidden">Export</span>
              </button>
            )}
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
              Viewing aggregated vendor totals. To review, approve, or delete individual supplier bills and files, switch to <strong className="text-[#0F172A]">Vendor Bills</strong> or use <strong className="text-rose-600">Delete File</strong>.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setActiveSubTab('bills')}
              className="px-2.5 py-1 text-xs font-bold bg-white text-[#0284C7] border border-[#BAE6FD] hover:bg-sky-50 rounded-lg transition cursor-pointer shadow-xs"
            >
              Open Vendor Bills ({filteredApTransactions.length})
            </button>
            <button
              onClick={() => {
                setPurgeTargetFileName('');
                setIsPurgeModalOpen(true);
              }}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-white text-rose-600 border border-rose-200 hover:bg-rose-50 rounded-lg transition cursor-pointer shadow-xs"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-500" />
              <span>Delete File</span>
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
                  Click <strong className="text-[#0284C7]">"Run AP Pipeline"</strong> above or add a manual vendor bill to populate the ledger.
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
            sortedApTransactions.length === 0 ? (
              <div className="text-center py-12 bg-slate-50/50">
                <FileText className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-[#0F172A]">No staged AP transactions match criteria.</p>
                <p className="text-xs text-[#64748B] mt-1 max-w-sm mx-auto">
                  Click <strong className="text-[#0284C7]">"Run AP Pipeline"</strong> or click <strong className="text-emerald-600">"Add Vendor Bill"</strong> to record a bill.
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/90 text-[#64748B] uppercase tracking-wider font-semibold text-[11px] border-b border-[#E2E8F0]">
                  <tr>
                    <th className="py-3 px-4 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={selectedTxIds.size >= sortedApTransactions.length && sortedApTransactions.length > 0}
                        onChange={handleSelectAllVisibleBills}
                        className="w-4 h-4 rounded border-[#CBD5E1] bg-white text-sky-600 focus:ring-sky-500 cursor-pointer"
                        title="Select/Deselect All Visible Bills"
                      />
                    </th>
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
                  {sortedApTransactions.map((tx) => {
                    const isSelected = selectedTxIds.has(tx.id);
                    const isLowConf = isItemLowConf(tx);
                    return (
                      <tr
                        key={tx.id}
                        className={`hover:bg-slate-50/80 transition ${
                          isSelected ? 'bg-sky-50/50' : tx.approved ? 'bg-emerald-50/30' : ''
                        }`}
                      >
                        <td className="py-3 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelectBill(tx.id)}
                            className="w-4 h-4 rounded border-[#CBD5E1] bg-white text-sky-600 focus:ring-sky-500 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4 text-slate-600 font-mono whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEditBillDate(tx);
                            }}
                            className="hover:text-sky-600 hover:underline flex items-center gap-1 group cursor-pointer"
                            title="Click to correct bill date"
                          >
                            <span>{tx.transaction_date}</span>
                            <Edit3 className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 text-sky-600 transition" />
                          </button>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[#0F172A] font-semibold">{tx.item_or_description}</span>
                            {isLowConf && (
                              <span
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200"
                                title={`AI Confidence: ${typeof tx.confidence_score === 'number' ? Math.round(tx.confidence_score * 100) + '%' : 'LOW'}. Please verify billing details.`}
                              >
                                <Sparkles className="w-2.5 h-2.5" />
                                <span>AI Low Conf</span>
                              </span>
                            )}
                          </div>
                        </td>
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
                          <div className="inline-flex items-center gap-1.5">
                            {tx.status !== 'INVOICED' && tx.status !== 'BILLED' && (
                              <>
                                <button
                                  onClick={() => handleOpenEditBillDate(tx)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 transition cursor-pointer"
                                  title="Correct bill date"
                                >
                                  <Calendar className="w-3 h-3 text-slate-500" />
                                  <span>Date</span>
                                </button>
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
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          )}
        </div>
      </div>

      {/* Manual Vendor Bill Creation Modal */}
      {isAddBillModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50/70">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl">
                  <DollarSign className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Add Manual Vendor Bill</h3>
                  <p className="text-[11px] text-slate-500">Record a supplier bill or expense missed by OCR ingestion</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddBillModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {createBillError && (
              <div className="mx-5 mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-medium flex items-center gap-2 animate-in fade-in">
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                <span className="flex-1">{createBillError}</span>
              </div>
            )}

            <form onSubmit={handleCreateManualBill} className="p-5 space-y-4">
              {/* Vendor Name */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Vendor Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  list="vendor-suggestions"
                  placeholder="e.g. Acme Supplies, Southern Energy..."
                  value={manualBillVendor}
                  onChange={(e) => setManualBillVendor(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white"
                />
                <datalist id="vendor-suggestions">
                  {availableVendors.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              </div>

              {/* Bill Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Bill Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={manualBillDate}
                    onChange={(e) => setManualBillDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white font-mono"
                  />
                </div>

                {/* Expense Category */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Expense Category
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Supplies, Fuel, Utilities..."
                    value={manualBillCategory}
                    onChange={(e) => setManualBillCategory(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white"
                  />
                </div>
              </div>

              {/* Invoice / Ref # */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Invoice / Document Ref #
                </label>
                <input
                  type="text"
                  placeholder="e.g. INV-2026-9042"
                  value={manualBillDocName}
                  onChange={(e) => setManualBillDocName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white font-mono"
                />
              </div>

              {/* Bill Total Amount */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Bill Total Amount ($) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-xs">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="0.00"
                    value={manualBillAmount}
                    onChange={(e) => setManualBillAmount(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-7 pr-3 py-2 text-xs text-slate-900 font-mono font-bold focus:outline-none focus:border-sky-500 focus:bg-white"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddBillModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingBill}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs transition cursor-pointer disabled:opacity-50"
                >
                  {isCreatingBill ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>{isCreatingBill ? 'Saving Bill...' : 'Save & Approve Bill'}</span>
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
        transactions={transactions}
        initialFileName={purgeTargetFileName}
        onSuccess={() => {
          loadTransactions();
        }}
      />

      {/* Correct Bill Date Modal */}
      {editingDateBill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 bg-slate-50/80 border-b border-[#E2E8F0] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shadow-xs">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#0F172A]">Correct Bill Date</h3>
                  <p className="text-xs text-[#64748B]">
                    {editingDateBill.item_or_description} - {formatCurrency(editingDateBill.total_amount)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEditingDateBill(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  New Vendor Bill Date
                </label>
                <input
                  type="date"
                  value={newBillDateValue}
                  onChange={(e) => setNewBillDateValue(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-mono shadow-xs"
                />
                <p className="text-xs text-slate-500 mt-1.5">
                  Currently recorded as <strong className="font-mono text-slate-700">{editingDateBill.transaction_date}</strong>.
                </p>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 leading-relaxed">
                <p className="font-semibold flex items-center gap-1.5 text-amber-800 mb-1">
                  <Info className="w-4 h-4 text-amber-600 shrink-0" />
                  Automatic AP Ledger Re-filing
                </p>
                Updating this date will update the record in PostgreSQL. If moved to another month, the AP ledger view will switch automatically.
              </div>
            </div>

            <div className="px-6 py-3.5 bg-slate-50 border-t border-[#E2E8F0] flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setEditingDateBill(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-lg transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveBillDate}
                disabled={isSavingBillDate || !newBillDateValue}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition cursor-pointer shadow-xs disabled:opacity-50"
              >
                {isSavingBillDate ? (
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
    </div>
  );
};
