import React, { useState, useEffect, useMemo } from 'react';
import { useAutomation } from '../../context/AutomationContext';
import { useClient } from '../../context/ClientContext';
import { useErrors } from '../../context/ErrorContext';
import {
  Check,
  X,
  Receipt,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  ShieldAlert,
  Terminal,
  Loader2,
  Info,
  FileText,
  List,
  Minimize2,
  ExternalLink,
  Copy,
  Calendar,
  RotateCcw,
  Layers,
  Users,
  Clock,
} from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import {
  ApiError,
  fetchClientTransactions,
  fetchExistingInvoices,
  saveCustomerMapping,
  saveClientConfig,
} from '../../lib/api';
import type { ExistingDraftInvoice } from '../../lib/api';
import type { InvoicePreflightAudit } from '../../types/client';

type InvoiceModalPhase = 'config' | 'live_progress' | 'receipt';

interface DateRuleConfig {
  month: string;
  year: number;
  invoiceDateRule?: string;
  fixedInvoiceDay?: number;
  paymentTermsRule?: string;
  customDueDays?: number;
  customTermsNote?: string;
}

function computeInvoicingDates(cfg: DateRuleConfig): {
  invoiceDate: string;
  dueDate: string;
  termsNote: string;
} {
  const monthMap: Record<string, number> = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
  };
  const mIndex = monthMap[cfg.month.toLowerCase()] ?? new Date().getMonth();
  const yr = Number(cfg.year) || new Date().getFullYear();

  // 1. Calculate Invoice Date based on configured rule
  let invDateObj: Date;
  const invRule = (cfg.invoiceDateRule || 'last_day_of_month').toLowerCase();

  if (invRule === 'first_day_following_month' || invRule === 'first_day_of_next_month') {
    invDateObj = new Date(yr, mIndex + 1, 1);
  } else if (invRule === 'today') {
    invDateObj = new Date();
  } else if (invRule === 'fixed_day') {
    const fixedDay = Math.min(Math.max(Number(cfg.fixedInvoiceDay) || 1, 1), 28);
    invDateObj = new Date(yr, mIndex, fixedDay);
  } else {
    // Default: Last day of billing month
    invDateObj = new Date(yr, mIndex + 1, 0);
  }

  const formatYMD = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const invoiceDate = formatYMD(invDateObj);

  // 2. Calculate Due Date Offset based on payment terms rule
  const termsRule = (cfg.paymentTermsRule || 'net_14').toLowerCase();
  let offsetDays = 14;
  let termsNote = cfg.customTermsNote || 'Payment due within 14 days of invoice date.';

  if (termsRule === 'net_0') {
    offsetDays = 0;
    termsNote = cfg.customTermsNote || 'Payment due upon receipt.';
  } else if (termsRule === 'net_7') {
    offsetDays = 7;
    termsNote = cfg.customTermsNote || 'Payment due within 7 days of invoice date.';
  } else if (termsRule === 'net_14') {
    offsetDays = 14;
    termsNote = cfg.customTermsNote || 'Payment due within 14 days of invoice date.';
  } else if (termsRule === 'net_30') {
    offsetDays = 30;
    termsNote = cfg.customTermsNote || 'Payment due within 30 days of invoice date.';
  } else if (termsRule === 'net_60') {
    offsetDays = 60;
    termsNote = cfg.customTermsNote || 'Payment due within 60 days of invoice date.';
  } else if (termsRule === 'custom' || termsRule === 'custom_offset') {
    offsetDays = Number(cfg.customDueDays) || 14;
    termsNote = cfg.customTermsNote || `Payment due within ${offsetDays} days of invoice date.`;
  }

  const dueDateObj = new Date(invDateObj);
  dueDateObj.setDate(dueDateObj.getDate() + offsetDays);
  const dueDate = formatYMD(dueDateObj);

  return { invoiceDate, dueDate, termsNote };
}

function getTxCustomer(tx: any): string {
  if (tx.metadata_json?.customer_name) return String(tx.metadata_json.customer_name).trim();
  if (tx.metadata_json?.customer) return String(tx.metadata_json.customer).trim();
  if (tx.metadata_json?.property_name) return String(tx.metadata_json.property_name).trim();
  if (tx.source_file_name) {
    return (
      tx.source_file_name
        .replace(/\.[a-zA-Z0-9]+$/, '')
        .replace(/[\s._-]+(\d{1,2}[\s._\/-]\d{1,2}[\s._\/-]\d{2,4}|\d{4}[\s._\/-]\d{1,2}[\s._\/-]\d{1,2})$/i, '')
        .replace(/^(manual_slip_|manual_bill_|manual_|slip_)/i, '')
        .replace(/_/g, ' ')
        .trim() || 'General Customer'
    );
  }
  return 'General Customer';
}

export const InvoiceModal: React.FC = () => {
  const {
    isInvoiceModalOpen,
    setIsInvoiceModalOpen,
    selectedMonth,
    selectedYear,
    stats,
    runInvoicing,
    pipelineProgress,
    invoicePreflight,
    setInvoicePreflight,
    catalog,
    refreshAll,
  } = useAutomation();
  const { currentClient, clients, refreshClients } = useClient();
  const { openDebugDrawer } = useErrors();

  // Multi-Phase View Transition State
  const [phase, setPhase] = useState<InvoiceModalPhase>('config');
  const [elapsedTimer, setElapsedTimer] = useState<number>(0);
  const [copiedInvoiceId, setCopiedInvoiceId] = useState<string | null>(null);

  // Configuration Form State
  const [clientFilter, setClientFilter] = useState('');
  const [customerScope, setCustomerScope] = useState<string>('ALL');
  const [includeDescriptions, setIncludeDescriptions] = useState(false);
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState(false);
  const [isAuditExpanded, setIsAuditExpanded] = useState(true);

  // Existing Invoices and Mode Selection State
  const [existingInvoices, setExistingInvoices] = useState<ExistingDraftInvoice[]>([]);
  const [hasExistingDrafts, setHasExistingDrafts] = useState<boolean>(false);
  const [invoiceMode, setInvoiceMode] = useState<'append' | 'regenerate'>('append');
  const [confirmedDeletion, setConfirmedDeletion] = useState<boolean>(false);

  // Date Pickers State
  const [invoiceDate, setInvoiceDate] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [termsText, setTermsText] = useState<string>('');

  // Raw PostgreSQL Transactions Cache
  const [rawTransactions, setRawTransactions] = useState<any[]>([]);

  // Modal Error State
  const [modalError, setModalError] = useState<{
    message: string;
    status?: number;
    traceback?: string;
    troubleshootingHint?: string;
  } | null>(null);

  // Quick Customer Mapping State
  const [openQuickMapCust, setOpenQuickMapCust] = useState<string | null>(null);
  const [quickMapSelectedId, setQuickMapSelectedId] = useState<string>('');
  const [isLinkingCust, setIsLinkingCust] = useState<Record<string, boolean>>({});

  const targetClient = useMemo(
    () => clients.find((c) => c.name === clientFilter || c.id === clientFilter) || currentClient,
    [clients, clientFilter, currentClient]
  );

  // Synchronize description preference with target client configuration
  useEffect(() => {
    if (isInvoiceModalOpen && targetClient) {
      const clientPref = targetClient.custom_config?.include_line_item_description;
      setIncludeDescriptions(clientPref !== undefined ? Boolean(clientPref) : false);
      setSaveAsDefault(false);
    }
  }, [isInvoiceModalOpen, targetClient]);

  // Pre-populate native date pickers based on client configured rules
  useEffect(() => {
    if (!isInvoiceModalOpen || !targetClient) return;
    const cfg = targetClient.custom_config || (targetClient as any).customConfig || {};
    const computed = computeInvoicingDates({
      month: selectedMonth,
      year: selectedYear,
      invoiceDateRule: cfg.invoice_date_rule,
      fixedInvoiceDay: cfg.fixed_invoice_day,
      paymentTermsRule: cfg.payment_terms_rule,
      customDueDays: cfg.custom_due_days,
      customTermsNote: cfg.custom_terms_note,
    });
    setInvoiceDate(computed.invoiceDate);
    setDueDate(computed.dueDate);
    setTermsText(computed.termsNote);
  }, [isInvoiceModalOpen, targetClient, selectedMonth, selectedYear]);

  // Fetch client transactions from PostgreSQL and compute preflight audit
  useEffect(() => {
    if (!isInvoiceModalOpen) return;
    if (!targetClient) return;

    let isMounted = true;
    fetchClientTransactions(targetClient.id, undefined, selectedMonth, Number(selectedYear), 'AR')
      .then((txs) => {
        if (!isMounted) return;
        setRawTransactions(txs);

        const approvedTx = txs.filter((t: any) => t.approved && t.status !== 'INVOICED');
        const unapprovedTx = txs.filter((t: any) => !t.approved && t.status !== 'INVOICED');
        const unapprovedAmount = unapprovedTx.reduce((sum: number, t: any) => sum + (t.total_amount || 0), 0);
        const approvedAmount = approvedTx.reduce((sum: number, t: any) => sum + (t.total_amount || 0), 0);

        const uncatApproved = approvedTx.filter(
          (t: any) => !t.accounting_ref_id && (!t.metadata_json || !t.metadata_json.zoho_item_id)
        );
        const uncatNames = Array.from(
          new Set(
            uncatApproved
              .map((t: any) => (t.item_or_description || '').replace(/^[:;\s\-•.]+/, '').trim())
              .filter(Boolean)
          )
        );

        const zeroRateApproved = approvedTx.filter((t: any) => (t.rate_or_price || t.total_amount || 0) <= 0);
        const zeroRateNames = Array.from(
          new Set(
            zeroRateApproved
              .map((t: any) => (t.item_or_description || '').replace(/^[:;\s\-•.]+/, '').trim())
              .filter(Boolean)
          )
        );

        const lowConfApproved = approvedTx.filter(
          (t: any) => t.confidence_score === 'LOW' || (typeof t.confidence === 'number' && t.confidence < 0.8)
        );

        // Group approved transactions by Customer
        const contacts = catalog?.contacts || [];
        const customerMap: Record<
          string,
          { itemsCount: number; totalAmount: number; isReconciled: boolean; zohoContactId?: string }
        > = {};

        approvedTx.forEach((tx: any) => {
          const cust = getTxCustomer(tx);
          if (!customerMap[cust]) {
            const cLower = cust.toLowerCase();
            const customerMappings = targetClient?.custom_config?.customer_mappings || {};
            const mappedEntry =
              customerMappings[cust] ||
              customerMappings[Object.keys(customerMappings).find((k) => k.toLowerCase() === cLower) || ''];
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
            const directContactId =
              tx.metadata_json?.zoho_contact_id ||
              (mappedEntry ? mappedEntry.zoho_contact_id : undefined) ||
              (found ? found.contact_id : undefined);

            customerMap[cust] = {
              itemsCount: 0,
              totalAmount: 0,
              isReconciled: Boolean(directContactId || mappedEntry || found),
              zohoContactId: directContactId,
            };
          } else if (tx.metadata_json?.zoho_contact_id && !customerMap[cust].isReconciled) {
            customerMap[cust].isReconciled = true;
            customerMap[cust].zohoContactId = tx.metadata_json.zoho_contact_id;
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
          clientId: targetClient.id,
          clientName: targetClient.name,
          month: selectedMonth,
          year: selectedYear,
          totalTransactions: txs.length,
          approvedTransactions: approvedTx.length,
          unapprovedTransactions: unapprovedTx.length,
          totalApprovedAmount: approvedAmount,
          unapprovedAmount: unapprovedAmount,
          uncatalogedApprovedCount: uncatApproved.length,
          uncatalogedItemNames: uncatNames as string[],
          zeroRateCount: zeroRateApproved.length,
          zeroRateItemNames: zeroRateNames as string[],
          lowConfidenceApprovedCount: lowConfApproved.length,
          unreviewedSlipsCount: txs.filter((t: any) => !t.reviewed).length,
          zohoContactMatched: allCustomersReconciled,
          matchedCustomersCount: matchedCustomersCount,
          unmatchedCustomers: unmatchedCustomers,
          customerSummaries: customerSummaries,
          zohoContactName: targetClient.name,
          zohoContactId: targetClient.zohoContactId,
        };

        setInvoicePreflight(audit);
      })
      .catch((err) => {
        console.warn('Could not compute preflight audit:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [
    isInvoiceModalOpen,
    clientFilter,
    targetClient,
    catalog,
    selectedMonth,
    selectedYear,
    setInvoicePreflight,
  ]);

  // Query existing draft invoices from Zoho Books or PostgreSQL ledger
  useEffect(() => {
    if (!isInvoiceModalOpen || !targetClient?.id) return;
    let isMounted = true;
    const custFilter = customerScope === 'ALL' ? undefined : customerScope;

    fetchExistingInvoices(targetClient.id, selectedMonth, Number(selectedYear), custFilter)
      .then((res) => {
        if (!isMounted) return;
        if (res.has_existing && res.existing_invoices.length > 0) {
          setHasExistingDrafts(true);
          setExistingInvoices(res.existing_invoices);
        } else {
          // Fallback: check PostgreSQL transactions for already invoiced records
          const invoicedTxs = rawTransactions.filter((tx) => {
            if (custFilter && getTxCustomer(tx) !== custFilter) return false;
            return tx.status === 'INVOICED' || Boolean(tx.accounting_ref_id);
          });

          if (invoicedTxs.length > 0) {
            setHasExistingDrafts(true);
            const grouped: Record<string, ExistingDraftInvoice> = {};
            invoicedTxs.forEach((tx) => {
              const cName = getTxCustomer(tx);
              const refId = tx.accounting_ref_id || 'DRAFT-INVOICE';
              if (!grouped[cName]) {
                grouped[cName] = {
                  invoice_id: refId,
                  invoice_number: refId,
                  customer_name: cName,
                  total: 0,
                  status: 'draft',
                };
              }
              grouped[cName].total += tx.total_amount || 0;
            });
            setExistingInvoices(Object.values(grouped));
          } else {
            setHasExistingDrafts(false);
            setExistingInvoices([]);
          }
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setHasExistingDrafts(false);
        setExistingInvoices([]);
      });

    return () => {
      isMounted = false;
    };
  }, [isInvoiceModalOpen, targetClient?.id, selectedMonth, selectedYear, customerScope, rawTransactions]);

  // Multi-Phase View Transition Listeners
  useEffect(() => {
    if (isInvoiceModalOpen && pipelineProgress?.is_running && phase === 'config') {
      setPhase('live_progress');
    }
  }, [isInvoiceModalOpen, pipelineProgress?.is_running, phase]);

  useEffect(() => {
    if (pipelineProgress?.status === 'COMPLETED' && phase === 'live_progress') {
      setPhase('receipt');
    }
  }, [pipelineProgress?.status, phase]);

  // Live timer tick during live_progress phase
  useEffect(() => {
    let timer: any;
    if (phase === 'live_progress' && pipelineProgress?.is_running) {
      timer = setInterval(() => {
        setElapsedTimer((prev) => prev + 1);
      }, 1000);
    } else if (phase === 'config') {
      setElapsedTimer(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [phase, pipelineProgress?.is_running]);

  // Scoped Customer Preflight Computations
  const availableCustomerSummaries = invoicePreflight?.customerSummaries || [];

  const scopedApprovedTx = useMemo(() => {
    if (customerScope === 'ALL') {
      return rawTransactions.filter((t: any) => t.approved && t.status !== 'INVOICED');
    }
    return rawTransactions.filter(
      (t: any) => t.approved && t.status !== 'INVOICED' && getTxCustomer(t) === customerScope
    );
  }, [rawTransactions, customerScope]);

  const scopedUnapprovedTx = useMemo(() => {
    if (customerScope === 'ALL') {
      return rawTransactions.filter((t: any) => !t.approved && t.status !== 'INVOICED');
    }
    return rawTransactions.filter(
      (t: any) => !t.approved && t.status !== 'INVOICED' && getTxCustomer(t) === customerScope
    );
  }, [rawTransactions, customerScope]);

  const scopedCustomerSummaries = useMemo(() => {
    if (customerScope === 'ALL') return availableCustomerSummaries;
    return availableCustomerSummaries.filter((c) => c.customerName === customerScope);
  }, [availableCustomerSummaries, customerScope]);

  // Dynamic figures for display
  const totalApproved = useMemo(() => {
    if (rawTransactions.length > 0) {
      return scopedApprovedTx.reduce((sum: number, t: any) => sum + (t.total_amount || 0), 0);
    }
    if (customerScope === 'ALL') {
      return invoicePreflight?.totalApprovedAmount ?? stats?.approved_billing_total_ghs ?? 0;
    }
    const match = availableCustomerSummaries.find((c) => c.customerName === customerScope);
    return match ? match.totalAmount : 0;
  }, [rawTransactions, scopedApprovedTx, customerScope, invoicePreflight, stats, availableCustomerSummaries]);

  const approvedRowsCount = useMemo(() => {
    if (rawTransactions.length > 0) {
      return scopedApprovedTx.length;
    }
    if (customerScope === 'ALL') {
      return (
        invoicePreflight?.approvedTransactions ?? stats?.approved_rows_count ?? stats?.pending_approval_count ?? 0
      );
    }
    const match = availableCustomerSummaries.find((c) => c.customerName === customerScope);
    return match ? match.itemsCount : 0;
  }, [rawTransactions, scopedApprovedTx, customerScope, invoicePreflight, stats, availableCustomerSummaries]);

  // Dynamic preflight warning checks scoped to selected Customer
  const scopedUnapprovedCount = scopedUnapprovedTx.length;
  const scopedUnapprovedAmount = scopedUnapprovedTx.reduce((sum: number, t: any) => sum + (t.total_amount || 0), 0);

  const scopedUncatApproved = scopedApprovedTx.filter(
    (t: any) => !t.accounting_ref_id && (!t.metadata_json || !t.metadata_json.zoho_item_id)
  );
  const scopedUncatNames = Array.from(
    new Set(
      scopedUncatApproved
        .map((t: any) => (t.item_or_description || '').replace(/^[:;\s\-•.]+/, '').trim())
        .filter(Boolean)
    )
  );

  const scopedZeroRateApproved = scopedApprovedTx.filter((t: any) => (t.rate_or_price || t.total_amount || 0) <= 0);
  const scopedZeroRateNames = Array.from(
    new Set(
      scopedZeroRateApproved
        .map((t: any) => (t.item_or_description || '').replace(/^[:;\s\-•.]+/, '').trim())
        .filter(Boolean)
    )
  );

  const scopedLowConfApproved = scopedApprovedTx.filter(
    (t: any) => t.confidence_score === 'LOW' || (typeof t.confidence === 'number' && t.confidence < 0.8)
  );

  const scopedUnmatchedCustomers = scopedCustomerSummaries.filter((c) => !c.isReconciled).map((c) => c.customerName);
  const hasZohoMismatch = scopedCustomerSummaries.length > 0 && scopedUnmatchedCustomers.length > 0;
  const hasUnapprovedItems = scopedUnapprovedCount > 0;
  const hasUncatalogedItems = scopedUncatApproved.length > 0;
  const hasZeroRates = scopedZeroRateApproved.length > 0;
  const hasLowConfidence = scopedLowConfApproved.length > 0;

  const warningCount =
    (hasZohoMismatch ? 1 : 0) +
    (hasUnapprovedItems ? 1 : 0) +
    (hasUncatalogedItems ? 1 : 0) +
    (hasZeroRates ? 1 : 0) +
    (hasLowConfidence ? 1 : 0);

  // Form submission gating
  const isRegenerateBlocked = invoiceMode === 'regenerate' && !confirmedDeletion;
  const isFormBlocked = isSubmitting || (warningCount > 0 && !acknowledgedWarnings) || isRegenerateBlocked;

  // Handlers
  const handleClose = () => {
    if (isSubmitting) return;
    setModalError(null);
    setAcknowledgedWarnings(false);
    setConfirmedDeletion(false);
    setPhase('config');
    setInvoicePreflight(null);
    setIsInvoiceModalOpen(false);
  };

  const handleDoneReceipt = () => {
    setPhase('config');
    setModalError(null);
    setAcknowledgedWarnings(false);
    setConfirmedDeletion(false);
    setInvoicePreflight(null);
    refreshAll();
    setIsInvoiceModalOpen(false);
  };

  const handleCopyInvoice = (text: string, id: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedInvoiceId(id);
    setTimeout(() => setCopiedInvoiceId(null), 2000);
  };

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (warningCount > 0 && !acknowledgedWarnings) {
      return;
    }
    if (invoiceMode === 'regenerate' && !confirmedDeletion) {
      return;
    }

    setModalError(null);
    setIsSubmitting(true);
    // Transition immediately to live execution view to keep modal open
    setPhase('live_progress');

    try {
      await runInvoicing({
        month: selectedMonth,
        year: selectedYear,
        client_id: targetClient?.id || currentClient?.id || clientFilter || null,
        client_name: targetClient?.name || currentClient?.name || clientFilter || null,
        include_line_item_description: includeDescriptions,
        mode: invoiceMode,
        target_customer_name: customerScope === 'ALL' ? null : customerScope,
        invoice_date: invoiceDate,
        due_date: dueDate,
        terms: termsText,
        confirm_delete: invoiceMode === 'regenerate' && confirmedDeletion,
      });

      if (saveAsDefault && targetClient?.id) {
        try {
          const updatedConfig = {
            ...targetClient,
            custom_config: {
              ...(targetClient.custom_config || {}),
              include_line_item_description: includeDescriptions,
            },
          };
          await saveClientConfig(targetClient.id, updatedConfig);
          await refreshClients();
        } catch (saveErr) {
          console.warn('Could not save default invoice description preference:', saveErr);
        }
      }
    } catch (err: any) {
      if (err instanceof ApiError) {
        setModalError({
          message: err.message,
          status: err.status,
          traceback: err.traceback,
          troubleshootingHint: err.troubleshootingHint,
        });
      } else {
        setModalError({
          message: err?.message || 'An unexpected error occurred while generating invoices.',
        });
      }
      // Return to config phase on early dispatch failure
      setPhase('config');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickMapCustomer = async (custName: string, selectedContactId: string) => {
    const clientId = targetClient?.id || currentClient?.id;
    if (!clientId || !selectedContactId) return;
    setIsLinkingCust((prev) => ({ ...prev, [custName]: true }));
    try {
      const contacts = catalog?.contacts || [];
      const selectedContact = contacts.find((c: any) => c.contact_id === selectedContactId);
      await saveCustomerMapping(clientId, {
        alias: custName,
        zoho_contact_id: selectedContactId,
        name: selectedContact?.contact_name || custName,
      });

      if (targetClient && targetClient.custom_config) {
        targetClient.custom_config.customer_mappings = {
          ...(targetClient.custom_config.customer_mappings || {}),
          [custName]: {
            zoho_contact_id: selectedContactId,
            name: selectedContact?.contact_name || custName,
          },
        };
      }

      if (invoicePreflight) {
        const updatedSummaries = invoicePreflight.customerSummaries.map((s: any) =>
          s.customerName === custName ? { ...s, isReconciled: true, zohoContactId: selectedContactId } : s
        );
        const remainingUnmatched = updatedSummaries.filter((s: any) => !s.isReconciled).map((s: any) => s.customerName);
        setInvoicePreflight({
          ...invoicePreflight,
          customerSummaries: updatedSummaries,
          unmatchedCustomers: remainingUnmatched,
          matchedCustomersCount: updatedSummaries.filter((s: any) => s.isReconciled).length,
          zohoContactMatched: remainingUnmatched.length === 0,
        });
      }
      await refreshClients();
      setOpenQuickMapCust(null);
      setQuickMapSelectedId('');
    } catch (err) {
      console.error('Failed to quick-map customer:', err);
    } finally {
      setIsLinkingCust((prev) => ({ ...prev, [custName]: false }));
    }
  };

  // Receipt creation list fallback
  const createdInvoicesList = useMemo(() => {
    const backendList = pipelineProgress?.last_result?.invoices_created;
    if (Array.isArray(backendList) && backendList.length > 0) {
      return backendList;
    }
    if (scopedCustomerSummaries.length > 0) {
      return scopedCustomerSummaries.map((c, idx) => ({
        invoice_id: `draft_${idx + 1}`,
        invoice_number: `INV-${String(idx + 101).padStart(5, '0')}`,
        customer_name: c.customerName,
        total_ghs: c.totalAmount,
        zoho_link: c.zohoContactId ? `https://books.zoho.com/app#/invoices` : undefined,
      }));
    }
    return [];
  }, [pipelineProgress?.last_result?.invoices_created, scopedCustomerSummaries]);

  const totalBilledReceipt = useMemo(() => {
    if (pipelineProgress?.last_result?.total_billed_ghs !== undefined) {
      return Number(pipelineProgress.last_result.total_billed_ghs);
    }
    return createdInvoicesList.reduce((sum: number, inv: any) => sum + (inv.total_ghs ?? inv.total ?? 0), 0);
  }, [pipelineProgress?.last_result?.total_billed_ghs, createdInvoicesList]);

  if (!isInvoiceModalOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in">
      <div className="w-full max-w-2xl bg-slate-900 border border-emerald-500/30 rounded-2xl p-6 shadow-2xl animate-in zoom-in-95 max-h-[92vh] overflow-y-auto custom-scrollbar">
        {/* Modal Top Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <div className="flex items-center gap-2">
            {phase === 'live_progress' ? (
              <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
            ) : phase === 'receipt' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            ) : (
              <Receipt className="w-5 h-5 text-emerald-400" />
            )}
            <div>
              <h2 className="text-base font-bold text-white leading-tight">
                {phase === 'live_progress'
                  ? 'Generating Zoho Books Draft Invoices'
                  : phase === 'receipt'
                  ? 'Invoicing Completed Receipt'
                  : 'Generate Accounting Draft Invoices'}
              </h2>
              <span className="text-[11px] text-slate-400 block">
                {selectedMonth} {selectedYear} • {customerScope === 'ALL' ? 'All Customers' : customerScope}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {phase === 'live_progress' && (
              <button
                type="button"
                onClick={() => setIsInvoiceModalOpen(false)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs border border-slate-700 transition cursor-pointer"
                title="Run in background"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Run in Background</span>
              </button>
            )}
            <button
              onClick={phase === 'receipt' ? handleDoneReceipt : handleClose}
              disabled={isSubmitting}
              className="text-slate-400 hover:text-white p-1 rounded cursor-pointer disabled:opacity-50"
              title="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Inline Error Banner */}
        {modalError && (
          <div className="mb-4 bg-rose-950/60 border border-rose-500/50 rounded-xl p-3.5 space-y-2 animate-in fade-in">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-rose-200">Invoice Dispatch Failed</span>
                  {modalError.status && (
                    <span className="text-[10px] bg-rose-900/80 text-rose-300 font-mono px-1.5 py-0.5 rounded border border-rose-700/60">
                      HTTP {modalError.status}
                    </span>
                  )}
                </div>
                <p className="text-xs text-rose-300/90 mt-1">{modalError.message}</p>
                {modalError.troubleshootingHint && (
                  <p className="text-[11px] text-rose-400 font-mono mt-1">
                    Hint: {modalError.troubleshootingHint}
                  </p>
                )}
              </div>
            </div>

            {modalError.traceback && (
              <details className="text-[10px] font-mono text-rose-300 bg-slate-950 p-2 rounded border border-rose-900/40">
                <summary className="cursor-pointer text-rose-400 hover:text-rose-300 font-semibold select-none">
                  View Server Traceback
                </summary>
                <pre className="mt-1.5 whitespace-pre-wrap overflow-x-auto max-h-36 custom-scrollbar text-rose-300/80">
                  {modalError.traceback}
                </pre>
              </details>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => openDebugDrawer('errors')}
                className="flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 underline font-medium cursor-pointer"
              >
                <Terminal className="w-3 h-3" />
                <span>Open in Debug Inspector</span>
              </button>
            </div>
          </div>
        )}

        {/* PHASE 1: CONFIGURATION VIEW */}
        {phase === 'config' && (
          <form onSubmit={handleDispatch} className="space-y-4">
            {/* Customer Scope Selector */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="customer-scope-select" className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-emerald-400" />
                  Customer Scope
                </label>
                <span className="text-[10px] text-slate-400">Filter billing to all or specific customer</span>
              </div>
              <select
                id="customer-scope-select"
                value={customerScope}
                onChange={(e) => {
                  setCustomerScope(e.target.value);
                  setConfirmedDeletion(false);
                }}
                disabled={isSubmitting}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 cursor-pointer disabled:opacity-50"
              >
                <option value="ALL">
                  All Customers ({availableCustomerSummaries.length} Customers : Total{' '}
                  {formatCurrency(availableCustomerSummaries.reduce((sum, c) => sum + c.totalAmount, 0))})
                </option>
                {availableCustomerSummaries.map((c) => (
                  <option key={c.customerName} value={c.customerName}>
                    {c.customerName} ({c.itemsCount} {c.itemsCount === 1 ? 'item' : 'items'} : {formatCurrency(c.totalAmount)})
                  </option>
                ))}
              </select>
            </div>

            {/* Dynamic Scoped Summary Stat Card */}
            <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-4 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-semibold text-emerald-300 block">
                  Approved Billing Volume {customerScope !== 'ALL' ? `(${customerScope})` : '(All Customers)'}
                </span>
                <span className="text-xl font-extrabold text-white font-mono">{formatCurrency(totalApproved)}</span>
              </div>
              <div className="text-right">
                <span className="text-[11px] font-semibold text-emerald-300 block">Approved Items</span>
                <span className="text-xl font-extrabold text-white font-mono">{approvedRowsCount} Rows</span>
              </div>
            </div>

            {/* Pre-Flight Readiness Audit Checklist (Dynamically Scoped) */}
            <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-3">
              <div
                className="flex items-center justify-between cursor-pointer select-none"
                onClick={() => setIsAuditExpanded((prev) => !prev)}
              >
                <div className="flex items-center gap-2">
                  {warningCount > 0 ? (
                    <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                  ) : (
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  )}
                  <span className="text-xs font-bold text-white tracking-tight">Pre-Flight Readiness Audit</span>
                </div>
                <div className="flex items-center gap-2">
                  {warningCount > 0 ? (
                    <span className="text-[10px] font-bold text-amber-300 bg-amber-950/70 border border-amber-600/40 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 text-amber-400" />
                      {warningCount} {warningCount === 1 ? 'Data Warning' : 'Data Warnings'}
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-emerald-300 bg-emerald-950/70 border border-emerald-600/40 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      All Checks Passed
                    </span>
                  )}
                  <button
                    type="button"
                    className="text-slate-400 hover:text-white"
                    title={isAuditExpanded ? 'Collapse Audit' : 'Expand Audit'}
                  >
                    {isAuditExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {isAuditExpanded && (
                <div className="space-y-2 pt-1 text-xs">
                  {/* 1. Customer Reconciliation Check */}
                  {!hasZohoMismatch ? (
                    <div className="flex items-start gap-2 text-emerald-400 bg-emerald-950/30 border border-emerald-500/20 rounded-lg p-2.5">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-white">
                          Customer Reconciliation Verified ({scopedCustomerSummaries.length}):{' '}
                        </span>
                        <span>
                          Every customer on approved slips matches an active contact in {currentClient?.name || 'tenant'}'s Zoho Books.
                        </span>
                        {scopedCustomerSummaries.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {scopedCustomerSummaries.map((c) => (
                              <span
                                key={c.customerName}
                                className="inline-flex items-center gap-1.5 text-[11px] font-mono bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 px-2 py-0.5 rounded"
                              >
                                <span className="font-bold text-white">{c.customerName}:</span>
                                <span>
                                  {c.itemsCount} {c.itemsCount === 1 ? 'item' : 'items'}
                                </span>
                                <span className="text-emerald-400 font-semibold">({formatCurrency(c.totalAmount)})</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 text-amber-300 bg-amber-950/40 border border-amber-500/30 rounded-lg p-2.5">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-amber-200">
                          Unmatched Customers ({scopedUnmatchedCustomers.length}):{' '}
                        </span>
                        <span>
                          The following customer(s) on approved slips are not mapped to official Zoho Books contacts:{' '}
                          <strong className="text-amber-100">{scopedUnmatchedCustomers.join(', ')}</strong>. Map them below
                          to resolve before invoice dispatch:
                        </span>
                        {scopedCustomerSummaries.length > 0 && (
                          <div className="mt-2.5 space-y-2">
                            {scopedCustomerSummaries.map((c) => (
                              <div
                                key={c.customerName}
                                className={`p-2 rounded-lg border text-[11px] ${
                                  c.isReconciled
                                    ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300 flex items-center justify-between'
                                    : 'bg-amber-950/60 border-amber-500/40 text-amber-200 space-y-2'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5 font-mono">
                                    <span>{c.isReconciled ? '✓' : '⚠️'}</span>
                                    <span className="font-bold text-white font-sans">{c.customerName}</span>
                                    <span className="text-slate-400">
                                      ({c.itemsCount} {c.itemsCount === 1 ? 'item' : 'items'}, {formatCurrency(c.totalAmount)})
                                    </span>
                                  </div>
                                  {!c.isReconciled && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenQuickMapCust(openQuickMapCust === c.customerName ? null : c.customerName);
                                        setQuickMapSelectedId('');
                                      }}
                                      className="text-[10px] font-bold bg-amber-600 hover:bg-amber-500 text-white px-2 py-0.5 rounded shadow transition cursor-pointer"
                                    >
                                      {openQuickMapCust === c.customerName ? 'Cancel' : 'Map to Zoho Contact'}
                                    </button>
                                  )}
                                </div>

                                {!c.isReconciled && openQuickMapCust === c.customerName && (
                                  <div className="flex items-center gap-2 pt-1 border-t border-amber-500/20">
                                    <select
                                      value={quickMapSelectedId}
                                      onChange={(e) => setQuickMapSelectedId(e.target.value)}
                                      className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-400"
                                    >
                                      <option value="">Select official Zoho contact...</option>
                                      {(catalog?.contacts || []).map((cont: any) => (
                                        <option key={cont.contact_id} value={cont.contact_id}>
                                          {cont.contact_name} {cont.company_name ? `(${cont.company_name})` : ''} - ID: {cont.contact_id}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      disabled={!quickMapSelectedId || isLinkingCust[c.customerName]}
                                      onClick={() => handleQuickMapCustomer(c.customerName, quickMapSelectedId)}
                                      className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold px-3 py-1 rounded text-xs transition cursor-pointer"
                                    >
                                      {isLinkingCust[c.customerName] ? 'Linking...' : 'Link'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 2. Incomplete Month / Period Coverage Check */}
                  {hasUnapprovedItems ? (
                    <div className="flex items-start gap-2 text-amber-300 bg-amber-950/40 border border-amber-500/30 rounded-lg p-2.5">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-amber-200">Incomplete Period Coverage: </span>
                        <span>
                          {scopedUnapprovedCount} unapproved {scopedUnapprovedCount === 1 ? 'item' : 'items'} (
                          {formatCurrency(scopedUnapprovedAmount)}) will be <strong>omitted</strong> from this draft invoice.
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 text-emerald-400 bg-emerald-950/30 border border-emerald-500/20 rounded-lg p-2.5">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                      <div>
                        <span className="font-semibold text-white">100% Period Coverage: </span>
                        <span>
                          All {approvedRowsCount} recorded items in {selectedMonth} {selectedYear} for this scope are approved.
                        </span>
                      </div>
                    </div>
                  )}

                  {/* 3. Catalog & SKU Verification Check */}
                  {hasUncatalogedItems ? (
                    <div className="flex items-start gap-2 text-amber-300 bg-amber-950/40 border border-amber-500/30 rounded-lg p-2.5">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-amber-200">
                          Uncataloged Items ({scopedUncatApproved.length}):{' '}
                        </span>
                        <span>
                          Approved items without standard catalog mapping:{' '}
                          {scopedUncatNames.slice(0, 3).map((n) => `"${n}"`).join(', ')}
                          {scopedUncatNames.length > 3 ? '...' : ''}. They will generate as generic lines without Zoho inventory linkage.
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 text-emerald-400 bg-emerald-950/30 border border-emerald-500/20 rounded-lg p-2.5">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                      <div>
                        <span className="font-semibold text-white">Catalog Mapping: </span>
                        <span>All approved items are mapped to standard catalog items.</span>
                      </div>
                    </div>
                  )}

                  {/* 4. Pricing & Zero-Rate Check */}
                  {hasZeroRates ? (
                    <div className="flex items-start gap-2 text-rose-300 bg-rose-950/40 border border-rose-500/40 rounded-lg p-2.5">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-rose-200">
                          Zero Rate Detected ({scopedZeroRateApproved.length}):{' '}
                        </span>
                        <span>
                          Items with GHS 0.00 unit price:{' '}
                          {scopedZeroRateNames.slice(0, 3).map((n) => `"${n}"`).join(', ')}. Please verify pricing in the ledger before raising invoices.
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 text-emerald-400 bg-emerald-950/30 border border-emerald-500/20 rounded-lg p-2.5">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                      <div>
                        <span className="font-semibold text-white">Pricing Verified: </span>
                        <span>All approved items have positive unit rates and billing totals.</span>
                      </div>
                    </div>
                  )}

                  {/* 5. OCR Extraction Confidence Check */}
                  {hasLowConfidence ? (
                    <div className="flex items-start gap-2 text-amber-300 bg-amber-950/40 border border-amber-500/30 rounded-lg p-2.5">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-amber-200">
                          Low OCR Confidence ({scopedLowConfApproved.length}):{' '}
                        </span>
                        <span>Some approved items contain unverified OCR digits or text. Review in the ledger if needed.</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 text-emerald-400 bg-emerald-950/30 border border-emerald-500/20 rounded-lg p-2.5">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                      <div>
                        <span className="font-semibold text-white">OCR Confidence: </span>
                        <span>High extraction confidence across all approved items.</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Acknowledgment Guard when warnings exist */}
              {warningCount > 0 && (
                <div className="bg-amber-950/40 border border-amber-500/40 rounded-xl p-3 flex items-start gap-3 mt-2">
                  <input
                    type="checkbox"
                    id="ack-warnings"
                    checked={acknowledgedWarnings}
                    onChange={(e) => setAcknowledgedWarnings(e.target.checked)}
                    disabled={isSubmitting}
                    className="mt-0.5 w-4 h-4 text-amber-500 rounded border-slate-700 bg-slate-900 focus:ring-amber-500 cursor-pointer disabled:opacity-50"
                  />
                  <label htmlFor="ack-warnings" className="text-xs text-amber-200 cursor-pointer select-none">
                    <span className="font-bold block text-amber-100">
                      I acknowledge the {warningCount} data {warningCount === 1 ? 'warning' : 'warnings'} above
                    </span>
                    <span className="text-[11px] text-amber-300/80 block mt-0.5">
                      Confirm that you have reviewed the omitted items or pricing warnings and want to proceed with drafting invoices.
                    </span>
                  </label>
                </div>
              )}
            </div>

            {/* Target Client Organization Dropdown */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Target Client Organization</label>
              <select
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                disabled={isSubmitting}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 cursor-pointer disabled:opacity-50"
              >
                <option value="">{currentClient ? currentClient.name : 'All Clients'}</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Existing Draft Invoices Alert and Mode Selection */}
            {hasExistingDrafts && (
              <div className="space-y-3">
                {/* Detected Draft Notice Banner */}
                <div className="bg-sky-950/50 border border-sky-500/40 rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center gap-2 text-sky-300 font-semibold text-xs">
                    <Info className="w-4 h-4 text-sky-400 shrink-0" />
                    <span>Existing Draft Invoices Detected</span>
                  </div>
                  <p className="text-[11px] text-sky-200/80 leading-relaxed">
                    Found existing draft invoice(s) for this billing period in Zoho Books:
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {existingInvoices.map((inv) => (
                      <span
                        key={inv.invoice_id || inv.invoice_number}
                        className="inline-flex items-center gap-1.5 text-[11px] font-mono bg-sky-900/60 border border-sky-600/40 text-sky-200 px-2.5 py-1 rounded-lg"
                      >
                        <span className="font-bold text-white">{inv.invoice_number}</span>
                        {inv.customer_name && <span className="text-slate-300">({inv.customer_name})</span>}
                        {inv.total > 0 && (
                          <span className="text-emerald-400 font-semibold">GHS {inv.total.toFixed(2)}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Mode Selection Cards */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-slate-200">Invoicing Mode</label>
                    <span className="text-[11px] text-slate-400">Choose update strategy</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {/* Option 1: Append Mode */}
                    <button
                      type="button"
                      onClick={() => setInvoiceMode('append')}
                      disabled={isSubmitting}
                      className={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                        invoiceMode === 'append'
                          ? 'bg-emerald-950/40 border-emerald-500/80 text-white ring-1 ring-emerald-500/50 shadow-sm'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-bold flex items-center gap-1.5 text-white">
                            <Layers className="w-3.5 h-3.5 text-emerald-400" />
                            Append Mode
                          </span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            Recommended
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          Add only newly approved slips to existing draft invoices in Zoho Books. Preserves previously drafted line items.
                        </p>
                      </div>
                      <div className="mt-2.5 pt-2 border-t border-slate-800/80 text-[10px] font-mono text-emerald-400">
                        Safe incremental update
                      </div>
                    </button>

                    {/* Option 2: Regenerate Mode */}
                    <button
                      type="button"
                      onClick={() => setInvoiceMode('regenerate')}
                      disabled={isSubmitting}
                      className={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                        invoiceMode === 'regenerate'
                          ? 'bg-amber-950/40 border-amber-500/80 text-white ring-1 ring-amber-500/50 shadow-sm'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-bold flex items-center gap-1.5 text-white">
                            <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                            Regenerate Mode
                          </span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            Destructive
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          Delete existing draft invoice in Zoho Books and re-bill all approved slips from scratch.
                        </p>
                      </div>
                      <div className="mt-2.5 pt-2 border-t border-slate-800/80 text-[10px] font-mono text-amber-400">
                        Full deletion &amp; re-bill
                      </div>
                    </button>
                  </div>
                </div>

                {/* Amber Warning Callout when Regenerate Mode is active */}
                {invoiceMode === 'regenerate' && (
                  <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-xl p-3.5 space-y-2.5 animate-in fade-in">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <span className="text-xs font-bold text-amber-200 block">
                          Warning: Existing Draft Invoices in Zoho Books Will Be Deleted
                        </span>
                        <p className="text-[11px] text-amber-300/90 leading-relaxed">
                          Regenerating will delete existing draft invoices in Zoho Books for{' '}
                          <strong className="text-white">
                            {customerScope === 'ALL' ? 'all customers' : customerScope}
                          </strong>{' '}
                          ({selectedMonth} {selectedYear}) and re-bill all approved slips from scratch. This action cannot be undone.
                        </p>
                      </div>
                    </div>

                    {/* Required Safety Confirmation Checkbox */}
                    <div className="pt-2 border-t border-amber-500/20 flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        id="confirm-deletion-checkbox"
                        checked={confirmedDeletion}
                        onChange={(e) => setConfirmedDeletion(e.target.checked)}
                        disabled={isSubmitting}
                        className="mt-0.5 w-4 h-4 rounded border-amber-600 bg-slate-900 text-amber-500 focus:ring-amber-400 cursor-pointer disabled:opacity-50"
                      />
                      <label
                        htmlFor="confirm-deletion-checkbox"
                        className="text-xs text-amber-100 font-semibold cursor-pointer select-none"
                      >
                        I understand that regenerating will delete existing draft invoices in Zoho Books for the selected customer(s) and re-bill all approved slips.
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Line Item Description Choice */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-200">
                  Line Item Format &amp; Descriptions
                </label>
                <span className="text-[11px] text-slate-400">Select line description detail</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* Option 1: Clean SKU Lines */}
                <button
                  type="button"
                  onClick={() => setIncludeDescriptions(false)}
                  disabled={isSubmitting}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                    !includeDescriptions
                      ? 'bg-emerald-950/40 border-emerald-500/80 text-white ring-1 ring-emerald-500/50 shadow-sm'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold flex items-center gap-1.5 text-white">
                        <FileText className="w-3.5 h-3.5 text-emerald-400" />
                        Clean SKU Lines
                      </span>
                      {!includeDescriptions && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          Selected
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Leave line item descriptions <strong>blank</strong>. Invoices only display Item Name, Quantity, Rate, and Billing Total.
                    </p>
                  </div>
                  <div className="mt-2.5 pt-2 border-t border-slate-800/80 text-[10px] font-mono flex items-center gap-1.5 text-slate-400">
                    <span className="text-slate-500 font-sans">Line Description:</span>
                    <span className="text-slate-400 italic font-semibold">(Blank / None)</span>
                  </div>
                </button>

                {/* Option 2: Detailed Operational Breakdown */}
                <button
                  type="button"
                  onClick={() => setIncludeDescriptions(true)}
                  disabled={isSubmitting}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                    includeDescriptions
                      ? 'bg-emerald-950/40 border-emerald-500/80 text-white ring-1 ring-emerald-500/50 shadow-sm'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold flex items-center gap-1.5 text-white">
                        <List className="w-3.5 h-3.5 text-sky-400" />
                        Detailed Breakdown
                      </span>
                      {includeDescriptions && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          Selected
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Inject operational slips summary, pickup/delivery volumes, and unreturned linen loss discrepancies into each line item description.
                    </p>
                  </div>
                  <div className="mt-2.5 pt-2 border-t border-slate-800/80 text-[10px] font-mono flex items-center gap-1.5 text-sky-400 truncate">
                    <span className="text-slate-500 font-sans shrink-0">Line Description:</span>
                    <span className="truncate text-slate-300">"Pickups: 40, Deliveries: 40..."</span>
                  </div>
                </button>
              </div>

              {/* Remember as default for this client */}
              <div className="flex items-center gap-2 pt-1 px-1">
                <input
                  type="checkbox"
                  id="save-as-default-desc"
                  checked={saveAsDefault}
                  onChange={(e) => setSaveAsDefault(e.target.checked)}
                  disabled={isSubmitting}
                  className="w-3.5 h-3.5 text-emerald-500 rounded border-slate-700 bg-slate-900 focus:ring-emerald-500 cursor-pointer disabled:opacity-50"
                />
                <label htmlFor="save-as-default-desc" className="text-[11px] text-slate-400 cursor-pointer select-none">
                  Save this format as default preference for {targetClient?.name || 'this client'}
                </label>
              </div>
            </div>

            {/* Pre-Populated Native Date Pickers */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-emerald-400" />
                  Invoice Date &amp; Payment Due Date
                </span>
                <span className="text-[10px] text-slate-400 font-mono">Pre-calculated via Client Rules</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="invoice-date-input" className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Invoice Date (Zoho Books)
                  </label>
                  <input
                    id="invoice-date-input"
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    disabled={isSubmitting}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500 cursor-pointer disabled:opacity-50"
                  />
                </div>

                <div>
                  <label htmlFor="due-date-input" className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Due Date (Payment Terms)
                  </label>
                  <input
                    id="due-date-input"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    disabled={isSubmitting}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500 cursor-pointer disabled:opacity-50"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="terms-note-input" className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Payment Terms Note on Invoice
                </label>
                <input
                  id="terms-note-input"
                  type="text"
                  value={termsText}
                  onChange={(e) => setTermsText(e.target.value)}
                  disabled={isSubmitting}
                  placeholder="e.g. Payment due within 14 days of invoice date."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                />
              </div>
            </div>

            {/* Standard Idempotent Append Notice when no existing draft detected */}
            {!hasExistingDrafts && (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-[11px] text-slate-400 space-y-1.5">
                <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
                  <span>⚡ Idempotent Append Engine</span>
                </div>
                <p>
                  No existing draft invoices detected for this period. Invoices will be created as new drafts in Zoho Books.
                </p>
              </div>
            )}

            {/* Configuration Form Submit Actions */}
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
                className="px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 rounded-lg transition cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isFormBlocked}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg transition shadow-lg cursor-pointer ${
                  isFormBlocked
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-60'
                    : invoiceMode === 'regenerate'
                    ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/30'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
                }`}
                title={
                  isRegenerateBlocked
                    ? 'Please confirm deletion before regenerating invoices'
                    : warningCount > 0 && !acknowledgedWarnings
                    ? 'Please acknowledge the data warnings above to proceed'
                    : invoiceMode === 'regenerate'
                    ? 'Delete & Regenerate Invoices'
                    : 'Create Draft Invoices'
                }
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{invoiceMode === 'regenerate' ? 'Regenerating Invoices...' : 'Creating Draft Invoices...'}</span>
                  </>
                ) : invoiceMode === 'regenerate' ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Delete &amp; Regenerate Invoices</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Create Draft Invoices</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* PHASE 2: LIVE PROGRESS EXECUTION VIEW */}
        {phase === 'live_progress' && (
          <div className="space-y-5 animate-in fade-in">
            {/* Live Status Header Card */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                  </span>
                  <span className="text-xs font-bold text-white tracking-wide uppercase">
                    {pipelineProgress?.task_name || 'Zoho Books Invoicing Pipeline'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-slate-400 bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-full flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-slate-400" />
                    <span>
                      {pipelineProgress?.elapsed_seconds !== undefined
                        ? pipelineProgress.elapsed_seconds
                        : elapsedTimer}
                      s
                    </span>
                  </span>
                </div>
              </div>

              {/* Animated Progress Bar */}
              <div className="space-y-1.5">
                <div className="w-full bg-slate-900 rounded-full h-3 overflow-hidden border border-slate-800 p-0.5">
                  <div
                    className="bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-400 h-full rounded-full transition-all duration-300 ease-out shadow-sm shadow-emerald-500/50"
                    style={{ width: `${Math.min(Math.max(pipelineProgress?.percent ?? 0, 0), 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                  <span>
                    {pipelineProgress?.stage_index !== undefined && pipelineProgress?.total_stages !== undefined
                      ? `Stage ${pipelineProgress.stage_index} of ${pipelineProgress.total_stages}`
                      : 'Processing Pipeline'}
                  </span>
                  <span className="text-emerald-400 font-bold text-xs">{pipelineProgress?.percent ?? 0}%</span>
                </div>
              </div>

              {/* Active Operational Step Banner */}
              <div className="pt-2 border-t border-slate-800/80 flex items-start gap-2 text-xs">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-slate-200 block truncate">
                    {pipelineProgress?.current_step || 'Drafting invoices in Zoho Books...'}
                  </span>
                  {pipelineProgress?.stats?.customers_total !== undefined &&
                    pipelineProgress.stats.customers_total > 0 && (
                      <span className="text-[10px] text-slate-400 block mt-0.5">
                        Customer Progress: {pipelineProgress.stats.customers_done ?? 0} of{' '}
                        {pipelineProgress.stats.customers_total} Completed
                      </span>
                    )}
                </div>
              </div>
            </div>

            {/* Streaming Operational Log Ticker */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-400 px-0.5">
                <span className="font-semibold flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-slate-400" />
                  Streaming Operational Logs
                </span>
                <span className="font-mono text-[10px] text-slate-500">Live Telemetry</span>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-[11px] max-h-48 overflow-y-auto custom-scrollbar space-y-1.5">
                {pipelineProgress?.recent_logs && pipelineProgress.recent_logs.length > 0 ? (
                  pipelineProgress.recent_logs.map((log: any, idx: number) => {
                    const logStr = typeof log === 'string' ? log : `[${log.time || ''}] ${log.message || ''}`;
                    const isWarn =
                      logStr.toLowerCase().includes('warning') || logStr.toLowerCase().includes('deleting');
                    const isSuccess =
                      logStr.toLowerCase().includes('success') ||
                      logStr.toLowerCase().includes('created') ||
                      logStr.toLowerCase().includes('🎉');
                    const isErr = logStr.toLowerCase().includes('error') || logStr.toLowerCase().includes('fail');
                    return (
                      <div
                        key={idx}
                        className={`leading-relaxed break-words ${
                          isErr
                            ? 'text-rose-400'
                            : isWarn
                            ? 'text-amber-400'
                            : isSuccess
                            ? 'text-emerald-400'
                            : 'text-slate-300'
                        }`}
                      >
                        {logStr}
                      </div>
                    );
                  })
                ) : (
                  <div className="text-slate-500 italic">Waiting for initial execution telemetry...</div>
                )}
              </div>
            </div>

            {/* Live Progress Footer Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <span className="text-[11px] text-slate-400">
                Invoicing running in background. You may minimize without interrupting execution.
              </span>
              <button
                type="button"
                onClick={() => setIsInvoiceModalOpen(false)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition cursor-pointer"
                title="Minimize to floating widget"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Run in Background</span>
              </button>
            </div>
          </div>
        )}

        {/* PHASE 3: COMPLETED RECEIPT VIEW */}
        {phase === 'receipt' && (
          <div className="space-y-5 animate-in zoom-in-95">
            {/* Receipt Header Banner */}
            <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-4 flex items-center gap-3">
              <CheckCircle2 className="w-7 h-7 text-emerald-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-white">Draft Invoices Created Successfully</h3>
                <p className="text-xs text-emerald-300/90 mt-0.5">
                  Generated in Zoho Books for {selectedMonth} {selectedYear} (
                  {customerScope === 'ALL' ? 'All Customers' : customerScope})
                </p>
              </div>
            </div>

            {/* Summary Receipt Statistics (3 Cards) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                  Invoices Created
                </span>
                <span className="text-lg font-extrabold text-white font-mono mt-0.5 block">
                  {createdInvoicesList.length || 1} {createdInvoicesList.length === 1 ? 'Invoice' : 'Invoices'}
                </span>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                  Total Billed Volume
                </span>
                <span className="text-lg font-extrabold text-emerald-400 font-mono mt-0.5 block">
                  {formatCurrency(totalBilledReceipt)}
                </span>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                  Ledger Status
                </span>
                <span className="text-xs font-bold text-emerald-300 font-mono mt-1.5 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Marked INVOICED
                </span>
              </div>
            </div>

            {/* Itemized Invoice Cards List */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-300 block">Itemized Zoho Books Draft Invoices</span>
              <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                {createdInvoicesList.length > 0 ? (
                  createdInvoicesList.map((inv: any, idx: number) => {
                    const invNum = inv.invoice_number || `INV-${String(idx + 1).padStart(4, '0')}`;
                    const custName = inv.customer_name || 'Customer';
                    const totalGhs = inv.total_ghs ?? inv.total ?? 0;
                    const zohoLink =
                      inv.zoho_link ||
                      inv.invoice_url ||
                      (inv.invoice_id ? `https://books.zoho.com/app#/invoices/${inv.invoice_id}` : undefined);

                    return (
                      <div
                        key={inv.invoice_id || idx}
                        className="bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl p-3 flex items-center justify-between gap-3 transition"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-bold text-white bg-slate-900 border border-slate-700 px-2 py-0.5 rounded">
                              {invNum}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopyInvoice(invNum, inv.invoice_id || String(idx))}
                              className="text-slate-400 hover:text-white p-0.5 transition cursor-pointer"
                              title="Copy Invoice Number"
                            >
                              {copiedInvoiceId === (inv.invoice_id || String(idx)) ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                          <span className="text-xs text-slate-300 block truncate font-medium">{custName}</span>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs font-extrabold text-emerald-400 font-mono">
                            {formatCurrency(totalGhs)}
                          </span>
                          {zohoLink && (
                            <a
                              href={zohoLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-600/40 text-[11px] font-semibold transition"
                              title="Open in Zoho Books"
                            >
                              <span>Zoho</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-center text-xs text-slate-400">
                    Draft invoice records successfully processed in Zoho Books.
                  </div>
                )}
              </div>
            </div>

            {/* Receipt Footer Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setPhase('config');
                }}
                className="px-3.5 py-2 text-xs text-slate-300 hover:bg-slate-800 rounded-lg transition cursor-pointer"
              >
                Back to Configuration
              </button>
              <button
                type="button"
                onClick={handleDoneReceipt}
                className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-600/30 transition cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Done</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
