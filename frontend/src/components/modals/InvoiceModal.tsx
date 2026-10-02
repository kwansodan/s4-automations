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
} from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { ApiError, fetchClientTransactions, saveCustomerMapping } from '../../lib/api';
import type { InvoicePreflightAudit } from '../../types/client';

export const InvoiceModal: React.FC = () => {
  const {
    isInvoiceModalOpen,
    setIsInvoiceModalOpen,
    selectedMonth,
    selectedYear,
    stats,
    runInvoicing,
    invoicePreflight,
    setInvoicePreflight,
    catalog,
  } = useAutomation();
  const { currentClient, clients } = useClient();
  const { openDebugDrawer } = useErrors();

  const [clientFilter, setClientFilter] = useState('');
  const [includeDescriptions, setIncludeDescriptions] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState(false);
  const [isAuditExpanded, setIsAuditExpanded] = useState(true);
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

  // Fallback audit computation if opened directly or if clientFilter changes
  useEffect(() => {
    if (!isInvoiceModalOpen) return;
    if (invoicePreflight && (!clientFilter || invoicePreflight.clientName === clientFilter)) return;

    if (!targetClient) return;

    let isMounted = true;
    fetchClientTransactions(targetClient.id, selectedMonth, String(selectedYear))
      .then((txs) => {
        if (!isMounted) return;
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

        // Group by customer (recipient on delivery slip)
        const contacts = catalog?.contacts || [];
        const customerMap: Record<
          string,
          { itemsCount: number; totalAmount: number; isReconciled: boolean; zohoContactId?: string }
        > = {};

        approvedTx.forEach((tx: any) => {
          let cust = 'General Customer';
          if (tx.metadata_json?.customer_name) cust = String(tx.metadata_json.customer_name).trim();
          else if (tx.metadata_json?.customer) cust = String(tx.metadata_json.customer).trim();
          else if (tx.metadata_json?.property_name) cust = String(tx.metadata_json.property_name).trim();
          else if (tx.source_file_name) {
            cust =
              tx.source_file_name
                .replace(/\.[a-zA-Z0-9]+$/, '')
                .replace(/[\s._-]+(\d{1,2}[\s._\/-]\d{1,2}[\s._\/-]\d{2,4}|\d{4}[\s._\/-]\d{1,2}[\s._\/-]\d{1,2})$/i, '')
                .replace(/^(manual_slip_|manual_bill_|manual_|slip_)/i, '')
                .replace(/_/g, ' ')
                .trim() || 'General Customer';
          }
          if (!customerMap[cust]) {
            const cLower = cust.toLowerCase();
            const customerMappings = targetClient?.custom_config?.customer_mappings || {};
            const mappedEntry = customerMappings[cust] || customerMappings[Object.keys(customerMappings).find((k) => k.toLowerCase() === cLower) || ''];
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
            const directContactId = tx.metadata_json?.zoho_contact_id || (mappedEntry ? mappedEntry.zoho_contact_id : undefined) || (found ? found.contact_id : undefined);

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
    invoicePreflight,
    clientFilter,
    currentClient,
    clients,
    selectedMonth,
    selectedYear,
    setInvoicePreflight,
  ]);

  if (!isInvoiceModalOpen) return null;

  const totalApproved = invoicePreflight?.totalApprovedAmount ?? stats?.approved_billing_total_ghs ?? 0;
  const approvedRowsCount =
    invoicePreflight?.approvedTransactions ?? stats?.approved_rows_count ?? stats?.pending_approval_count ?? 0;

  // Pre-flight warning detections
  const hasZohoMismatch = invoicePreflight ? !invoicePreflight.zohoContactMatched : false;
  const hasUnapprovedItems = invoicePreflight ? invoicePreflight.unapprovedTransactions > 0 : false;
  const hasUncatalogedItems = invoicePreflight ? invoicePreflight.uncatalogedApprovedCount > 0 : false;
  const hasZeroRates = invoicePreflight ? invoicePreflight.zeroRateCount > 0 : false;
  const hasLowConfidence = invoicePreflight ? invoicePreflight.lowConfidenceApprovedCount > 0 : false;

  const warningCount =
    (hasZohoMismatch ? 1 : 0) +
    (hasUnapprovedItems ? 1 : 0) +
    (hasUncatalogedItems ? 1 : 0) +
    (hasZeroRates ? 1 : 0) +
    (hasLowConfidence ? 1 : 0);

  const isFormBlocked = isSubmitting || (warningCount > 0 && !acknowledgedWarnings);

  const handleClose = () => {
    if (isSubmitting) return;
    setModalError(null);
    setAcknowledgedWarnings(false);
    setInvoicePreflight(null);
    setIsInvoiceModalOpen(false);
  };

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (warningCount > 0 && !acknowledgedWarnings) {
      return;
    }
    setModalError(null);
    setIsSubmitting(true);
    try {
      await runInvoicing({
        month: selectedMonth,
        year: selectedYear,
        client_id: targetClient?.id || currentClient?.id || clientFilter || null,
        client_name: targetClient?.name || currentClient?.name || clientFilter || null,
        include_line_item_description: includeDescriptions,
      });
      // runInvoicing closes modal on success
      setAcknowledgedWarnings(false);
      setInvoicePreflight(null);
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
          s.customerName === custName
            ? { ...s, isReconciled: true, zohoContactId: selectedContactId }
            : s
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
      setOpenQuickMapCust(null);
      setQuickMapSelectedId('');
    } catch (err) {
      console.error('Failed to quick-map customer:', err);
    } finally {
      setIsLinkingCust((prev) => ({ ...prev, [custName]: false }));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in">
      <div className="w-full max-w-xl bg-slate-900 border border-emerald-500/30 rounded-2xl p-6 shadow-2xl animate-in zoom-in-95 max-h-[92vh] overflow-y-auto custom-scrollbar">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white">Generate Accounting Draft Invoices</h2>
          </div>
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="text-slate-400 hover:text-white p-1 rounded cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
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
                    💡 Hint: {modalError.troubleshootingHint}
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

        <form onSubmit={handleDispatch} className="space-y-4">
          {/* Summary Stat Card */}
          <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-4 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-semibold text-emerald-300 block">Approved Billing Volume</span>
              <span className="text-xl font-extrabold text-white font-mono">{formatCurrency(totalApproved)}</span>
            </div>
            <div className="text-right">
              <span className="text-[11px] font-semibold text-emerald-300 block">Approved Items</span>
              <span className="text-xl font-extrabold text-white font-mono">{approvedRowsCount} Rows</span>
            </div>
          </div>

          {/* Pre-Flight Readiness Audit Checklist */}
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
                        All Customers Reconciled ({invoicePreflight?.customerSummaries?.length || 1}):{' '}
                      </span>
                      <span>
                        Every customer on approved slips matches an active contact in {currentClient?.name || 'tenant'}'s Zoho Books.
                      </span>
                      {invoicePreflight?.customerSummaries && invoicePreflight.customerSummaries.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {invoicePreflight.customerSummaries.map((c) => (
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
                        Unmatched Customers ({invoicePreflight?.unmatchedCustomers?.length || 1}):{' '}
                      </span>
                      <span>
                        The following customer(s) on approved slips are not mapped to official Zoho Books contacts:{' '}
                        <strong className="text-amber-100">{invoicePreflight?.unmatchedCustomers?.join(', ')}</strong>.
                        Map them below to resolve before invoice dispatch:
                      </span>
                      {invoicePreflight?.customerSummaries && invoicePreflight.customerSummaries.length > 0 && (
                        <div className="mt-2.5 space-y-2">
                          {invoicePreflight.customerSummaries.map((c) => (
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
                        {invoicePreflight?.unapprovedTransactions} unapproved{' '}
                        {invoicePreflight?.unapprovedTransactions === 1 ? 'item' : 'items'} (
                        {formatCurrency(invoicePreflight?.unapprovedAmount || 0)}) will be <strong>omitted</strong> from
                        this draft invoice.
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 text-emerald-400 bg-emerald-950/30 border border-emerald-500/20 rounded-lg p-2.5">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                    <div>
                      <span className="font-semibold text-white">100% Period Coverage: </span>
                      <span>
                        All {invoicePreflight?.approvedTransactions || approvedRowsCount} recorded items in{' '}
                        {selectedMonth} {selectedYear} are approved.
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
                        Uncataloged Items ({invoicePreflight?.uncatalogedApprovedCount}):{' '}
                      </span>
                      <span>
                        Approved items without standard catalog mapping:{' '}
                        {invoicePreflight?.uncatalogedItemNames
                          .slice(0, 3)
                          .map((n) => `"${n}"`)
                          .join(', ')}
                        {invoicePreflight && invoicePreflight.uncatalogedItemNames.length > 3 ? '...' : ''}. They will
                        generate as generic lines without Zoho inventory linkage.
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
                        Zero Rate Detected ({invoicePreflight?.zeroRateCount}):{' '}
                      </span>
                      <span>
                        Items with GHS 0.00 unit price:{' '}
                        {invoicePreflight?.zeroRateItemNames
                          .slice(0, 3)
                          .map((n) => `"${n}"`)
                          .join(', ')}
                        . Please verify pricing in the ledger before raising invoices.
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
                        Low OCR Confidence ({invoicePreflight?.lowConfidenceApprovedCount}):{' '}
                      </span>
                      <span>
                        Some approved items contain unverified OCR digits or text. Review in the ledger if needed.
                      </span>
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
                    Confirm that you have reviewed the omitted items or pricing warnings and want to proceed with drafting
                    invoices.
                  </span>
                </label>
              </div>
            )}
          </div>

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

          <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 flex items-start gap-3">
            <input
              type="checkbox"
              id="include-descriptions"
              checked={includeDescriptions}
              onChange={(e) => setIncludeDescriptions(e.target.checked)}
              disabled={isSubmitting}
              className="mt-0.5 w-4 h-4 text-emerald-500 rounded border-slate-700 bg-slate-900 focus:ring-emerald-500 cursor-pointer disabled:opacity-50"
            />
            <label htmlFor="include-descriptions" className="text-xs text-slate-300 cursor-pointer select-none">
              <span className="font-semibold block text-white">Include Line Item Descriptions</span>
              <span className="text-[11px] text-slate-400 block mt-0.5">
                When enabled, detailed operational summaries (pickups, deliveries, and discrepancies) are added to each
                invoice line item. When unchecked, line descriptions remain blank.
              </span>
            </label>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-[11px] text-slate-400 space-y-1.5">
            <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
              <span>⚡ Idempotent Append Engine</span>
            </div>
            <p>
              If a draft invoice already exists for this client in {selectedMonth} {selectedYear}, newly approved line
              items will be appended via <code className="text-emerald-400">PUT /invoices/{`{id}`}</code> to prevent
              duplicate invoices.
            </p>
          </div>

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
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
              }`}
              title={
                warningCount > 0 && !acknowledgedWarnings
                  ? 'Please acknowledge the data warnings above to proceed'
                  : 'Create Draft Invoices'
              }
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Creating Draft Invoices...</span>
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
      </div>
    </div>
  );
};
