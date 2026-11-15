import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useClient } from '../../context/ClientContext';
import { useAutomation } from '../../context/AutomationContext';
import {
  fetchInformationRequests,
  remindInformationRequests,
  resolveInformationRequests,
  followupInformationRequest,
  categorizeBankTransaction,
  fetchChartOfAccounts,
} from '../../lib/api';
import type {
  InformationRequestItem,
  ClientRequestSummaryItem,
  ChartOfAccountItem,
} from '../../types/client';
import { QueryComposerModal } from '../modals/QueryComposerModal';
import { SearchableAccountSelect } from '../banking/SearchableAccountSelect';
import {
  HelpCircle,
  CheckCircle2,
  Clock,
  Send,
  RefreshCw,
  Search,
  Check,
  X,
  AlertTriangle,
  FileText,
  ArrowRight,
  ExternalLink,
  Layers,
  Paperclip,
  Plus,
  Users,
  Landmark,
  Receipt,
  CreditCard,
  Mail,
  Bell,
  Copy,
  MessageSquare,
  Sparkles,
  Building2,
  Eye,
  FolderOpen,
  Filter,
} from 'lucide-react';

type TriageTab = 'ALL' | 'CLIENT_ANSWERED' | 'PENDING_CLIENT' | 'OVERDUE' | 'RESOLVED';
type PipelineFilter = 'ALL' | 'AR' | 'AP' | 'BANK' | 'GENERAL';
type GroupByMode = 'PRIORITY' | 'PIPELINE' | 'RECIPIENT' | 'CLIENT';

const formatAgeLabel = (hours: number): string => {
  if (!hours || hours < 1) return 'Just now';
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const getPipelineBadgeMeta = (pipelineType: string) => {
  switch (pipelineType) {
    case 'AR':
      return {
        label: 'Receivables (AR)',
        shortLabel: 'AR',
        partyPrefix: 'Customer',
        className: 'bg-sky-50 text-sky-700 border-sky-200',
        icon: Receipt,
      };
    case 'AP':
      return {
        label: 'Payables (AP)',
        shortLabel: 'AP',
        partyPrefix: 'Vendor',
        className: 'bg-violet-50 text-violet-700 border-violet-200',
        icon: CreditCard,
      };
    case 'BANK':
      return {
        label: 'Banking',
        shortLabel: 'BANK',
        partyPrefix: 'Account',
        className: 'bg-amber-50 text-amber-800 border-amber-200',
        icon: Landmark,
      };
    default:
      return {
        label: 'General Request',
        shortLabel: 'DOC',
        partyPrefix: 'Topic',
        className: 'bg-slate-100 text-slate-700 border-slate-200',
        icon: FileText,
      };
  }
};

export const InformationRequestsControlCenter: React.FC = () => {
  const { currentClient, setClient } = useClient();
  const { addLog, setActiveTab, setWorkspaceSubTab } = useAutomation();

  // Scope: current client vs all firm clients
  const [scopeMode, setScopeMode] = useState<'CURRENT' | 'ALL_CLIENTS'>('CURRENT');
  const [triageTab, setTriageTab] = useState<TriageTab>('ALL');
  const [pipelineFilter, setPipelineFilter] = useState<PipelineFilter>('ALL');
  const [groupByMode, setGroupByMode] = useState<GroupByMode>('PRIORITY');
  const [searchQuery, setSearchQuery] = useState('');

  // Data state
  const [items, setItems] = useState<InformationRequestItem[]>([]);
  const [metrics, setMetrics] = useState({
    total_count: 0,
    pending_client_count: 0,
    client_answered_count: 0,
    overdue_count: 0,
    resolved_count: 0,
    ar_count: 0,
    ap_count: 0,
    bank_count: 0,
    general_count: 0,
  });
  const [clientSummaries, setClientSummaries] = useState<ClientRequestSummaryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Selection & Inspector state
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<Record<string, boolean>>({});

  // Inspector actions state
  const [coaAccounts, setCoaAccounts] = useState<ChartOfAccountItem[]>([]);
  const [selectedCoaCategory, setSelectedCoaCategory] = useState<string>('');
  const [followUpText, setFollowUpText] = useState('');
  const [isSubmittingFollowUp, setIsSubmittingFollowUp] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [isReminding, setIsReminding] = useState(false);
  const [lastMagicPortalUrl, setLastMagicPortalUrl] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [actionBanner, setActionBanner] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);

  // Modals state
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [composerPipelineType, setComposerPipelineType] = useState<'BANK' | 'AR' | 'AP' | 'GENERAL'>('GENERAL');
  const [previewAttachment, setPreviewAttachment] = useState<{ name: string; url: string; type?: string } | null>(null);
  const [previewDriveFileId, setPreviewDriveFileId] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    setIsLoading(true);
    try {
      const targetClientId = scopeMode === 'ALL_CLIENTS' ? 'ALL' : (currentClient?.id || 'ALL');
      const res = await fetchInformationRequests({
        client_id: targetClientId,
      });
      setItems(res.items || res.requests || []);
      setMetrics(
        res.metrics || {
          total_count: 0,
          pending_client_count: 0,
          client_answered_count: 0,
          overdue_count: 0,
          resolved_count: 0,
          ar_count: 0,
          ap_count: 0,
          bank_count: 0,
          general_count: 0,
        }
      );
      setClientSummaries(res.client_summaries || []);
    } catch (err: any) {
      addLog('error', `[Requests] Failed loading information requests: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [scopeMode, currentClient?.id, addLog]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  // Load Chart of Accounts for current client so Bank items can be categorized in 1 click
  useEffect(() => {
    if (!currentClient?.id) return;
    fetchChartOfAccounts(currentClient.id)
      .then((res) => {
        setCoaAccounts(res.accounts || []);
      })
      .catch(() => {});
  }, [currentClient?.id]);

  // Filter items according to triageTab, pipelineFilter, and searchQuery
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (triageTab === 'CLIENT_ANSWERED' && item.query_status !== 'CLIENT_ANSWERED') return false;
      if (triageTab === 'PENDING_CLIENT' && item.query_status !== 'CLARIFICATION_REQUESTED') return false;
      if (triageTab === 'OVERDUE' && !item.is_overdue) return false;
      if (triageTab === 'RESOLVED' && item.query_status !== 'RESOLVED') return false;

      if (pipelineFilter !== 'ALL' && item.pipeline_type !== pipelineFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hay = [
          item.description || item.title,
          item.party_or_account_name,
          item.accountant_query,
          item.client_explanation,
          item.recipient_email,
          item.client_name,
          item.source_file_name,
          String(item.amount || ''),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, triageTab, pipelineFilter, searchQuery]);

  // Keep selectedItemKey valid when filteredItems change
  const selectedItem = useMemo(() => {
    if (selectedItemKey) {
      const found = filteredItems.find((i) => i.item_key === selectedItemKey) || items.find((i) => i.item_key === selectedItemKey);
      if (found) return found;
    }
    return filteredItems[0] || null;
  }, [filteredItems, items, selectedItemKey]);

  useEffect(() => {
    if (selectedItem) {
      setSelectedCoaCategory(selectedItem.assigned_category || selectedItem.mapped_account_name || '');
    } else {
      setSelectedCoaCategory('');
    }
  }, [selectedItem?.item_key]);

  // Group filtered items for the left list pane
  const groupedItems = useMemo(() => {
    const groups: Array<{ id: string; title: string; badgeClass: string; items: InformationRequestItem[] }> = [];
    const map = new Map<string, { id: string; title: string; badgeClass: string; items: InformationRequestItem[] }>();

    const ensureGroup = (id: string, title: string, badgeClass: string) => {
      if (!map.has(id)) {
        const g = { id, title, badgeClass, items: [] };
        map.set(id, g);
        groups.push(g);
      }
      return map.get(id)!;
    };

    if (groupByMode === 'PRIORITY') {
      for (const item of filteredItems) {
        if (item.query_status === 'CLIENT_ANSWERED') {
          ensureGroup(
            'ANSWERED',
            'Needs Accountant Review (Client Replied)',
            'bg-emerald-50 text-emerald-700 border-emerald-200'
          ).items.push(item);
        } else if (item.is_overdue) {
          ensureGroup(
            'OVERDUE',
            'Overdue (> 72 Hours Without Reply)',
            'bg-rose-50 text-rose-700 border-rose-200'
          ).items.push(item);
        } else if (item.query_status === 'CLARIFICATION_REQUESTED') {
          ensureGroup(
            'PENDING',
            'Awaiting Client Response',
            'bg-amber-50 text-amber-800 border-amber-200'
          ).items.push(item);
        } else {
          ensureGroup(
            'RESOLVED',
            'Resolved & Closed',
            'bg-slate-100 text-slate-600 border-slate-200'
          ).items.push(item);
        }
      }
    } else if (groupByMode === 'PIPELINE') {
      for (const item of filteredItems) {
        const meta = getPipelineBadgeMeta(item.pipeline_type);
        ensureGroup(item.pipeline_type, meta.label, meta.className).items.push(item);
      }
    } else if (groupByMode === 'RECIPIENT') {
      for (const item of filteredItems) {
        const email = item.recipient_email || 'Unassigned Recipient Email';
        ensureGroup(email, email, 'bg-sky-50 text-sky-700 border-sky-200').items.push(item);
      }
    } else {
      for (const item of filteredItems) {
        const cName = item.client_name || item.client_id;
        ensureGroup(item.client_id, cName, 'bg-indigo-50 text-indigo-700 border-indigo-200').items.push(item);
      }
    }

    return groups;
  }, [filteredItems, groupByMode]);

  const selectedKeysList = useMemo(
    () => Object.keys(checkedKeys).filter((k) => checkedKeys[k]),
    [checkedKeys]
  );

  const toggleItemChecked = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCheckedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSelectAllFiltered = () => {
    const allSelected =
      filteredItems.length > 0 && filteredItems.every((i) => checkedKeys[i.item_key]);
    if (allSelected) {
      setCheckedKeys({});
    } else {
      const next: Record<string, boolean> = {};
      filteredItems.forEach((i) => {
        next[i.item_key] = true;
      });
      setCheckedKeys(next);
    }
  };

  // Send Reminder (single or bulk digest)
  const handleSendReminder = async (keysToRemind: string[]) => {
    if (keysToRemind.length === 0) return;
    setIsReminding(true);
    setActionBanner(null);
    try {
      const res: any = await remindInformationRequests({
        item_keys: keysToRemind,
      });
      const magicUrl = res.portal_url || res.magic_url || (res.magic_urls ? Object.values(res.magic_urls)[0] : null);
      if (magicUrl) {
        setLastMagicPortalUrl(String(magicUrl));
      }
      setActionBanner({
        type: 'success',
        message: res.message || `Sent reminder digest for ${res.reminded_count} request(s).`,
      });
      addLog('info', `[Requests] Sent reminder digest for ${res.reminded_count} item(s).`);
      await loadRequests();
    } catch (err: any) {
      setActionBanner({
        type: 'error',
        message: err.message || 'Failed to send reminder digest.',
      });
    } finally {
      setIsReminding(false);
    }
  };

  // Resolve Request (single or bulk)
  const handleResolveItems = async (keysToResolve: string[], approveInLedger: boolean) => {
    if (keysToResolve.length === 0) return;
    setIsResolving(true);
    setActionBanner(null);
    try {
      const res = await resolveInformationRequests({
        item_keys: keysToResolve,
        approve_in_ledger: approveInLedger,
      });
      setActionBanner({
        type: 'success',
        message: approveInLedger
          ? `Approved in ledger and resolved ${res.resolved_count} request(s).`
          : `Marked ${res.resolved_count} request(s) as resolved.`,
      });
      addLog('info', `[Requests] Resolved ${res.resolved_count} request(s) (approve_in_ledger=${approveInLedger}).`);
      setCheckedKeys({});
      await loadRequests();
    } catch (err: any) {
      setActionBanner({
        type: 'error',
        message: err.message || 'Failed resolving request.',
      });
    } finally {
      setIsResolving(false);
    }
  };

  // Categorize & Resolve Bank Transaction in 1 click
  const handleCategorizeAndResolveBank = async (item: InformationRequestItem) => {
    if (!selectedCoaCategory.trim()) return;
    setIsResolving(true);
    setActionBanner(null);
    try {
      const matchedAcc = coaAccounts.find(
        (a) => a.account_id === selectedCoaCategory || a.account_name === selectedCoaCategory
      );
      await categorizeBankTransaction(item.primary_id || item.id, {
        mapped_account_id: matchedAcc?.account_id || selectedCoaCategory.trim(),
        mapped_account_name: matchedAcc?.account_name || selectedCoaCategory.trim(),
        post_to_accounting: true,
      });
      setActionBanner({
        type: 'success',
        message: `Categorized under "${matchedAcc?.account_name || selectedCoaCategory}" and resolved request.`,
      });
      addLog('info', `[Requests] Categorized Bank TX #${item.primary_id || item.id} to "${selectedCoaCategory}".`);
      await loadRequests();
    } catch (err: any) {
      setActionBanner({
        type: 'error',
        message: err.message || 'Failed categorizing bank transaction.',
      });
    } finally {
      setIsResolving(false);
    }
  };

  // Send Follow-up Question on Selected Item
  const handleSendFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !followUpText.trim()) return;
    setIsSubmittingFollowUp(true);
    setActionBanner(null);
    try {
      const res: any = await followupInformationRequest({
        item_key: selectedItem.item_key,
        query_text: followUpText.trim(),
        send_immediately: true,
      });
      if (res.portal_url || res.magic_url) {
        setLastMagicPortalUrl(res.portal_url || res.magic_url);
      }
      setFollowUpText('');
      setActionBanner({
        type: 'success',
        message: 'Follow-up message sent to client and status updated to Awaiting Client.',
      });
      addLog('info', `[Requests] Sent follow-up question on ${selectedItem.item_key}.`);
      await loadRequests();
    } catch (err: any) {
      setActionBanner({
        type: 'error',
        message: err.message || 'Failed sending follow-up message.',
      });
    } finally {
      setIsSubmittingFollowUp(false);
    }
  };

  const handleCopyMagicLink = async (item: InformationRequestItem) => {
    try {
      let urlToCopy = item.magic_url || lastMagicPortalUrl;
      if (!urlToCopy) {
        const res: any = await remindInformationRequests({
          item_keys: [item.item_key],
        });
        urlToCopy = res.portal_url || res.magic_url || (res.magic_urls ? Object.values(res.magic_urls)[0] : null);
        if (urlToCopy) {
          setLastMagicPortalUrl(String(urlToCopy));
        }
      }
      if (urlToCopy) {
        await navigator.clipboard.writeText(urlToCopy);
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2500);
        setActionBanner({
          type: 'info',
          message: 'Client Portal Magic Link copied to clipboard.',
        });
      }
    } catch (err: any) {
      setActionBanner({
        type: 'error',
        message: err.message || 'Could not copy magic link.',
      });
    }
  };

  const handleJumpToPipeline = (item: InformationRequestItem) => {
    if (item.client_id && currentClient?.id !== item.client_id) {
      setClient(item.client_id);
    }
    if (item.pipeline_type === 'AR') {
      setWorkspaceSubTab('ar');
    } else if (item.pipeline_type === 'AP') {
      setWorkspaceSubTab('ap');
    } else if (item.pipeline_type === 'BANK') {
      setWorkspaceSubTab('bank');
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Control Header */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="w-9 h-9 rounded-xl bg-[#F0F9FF] border border-[#BAE6FD] flex items-center justify-center text-[#0284C7] shadow-2xs">
                <MessageSquare className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-bold text-[#0F172A] tracking-tight">
                    Information Requests Control Center
                  </h2>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#F0F9FF] text-[#0284C7] border border-[#BAE6FD]">
                    AR • AP • Bank • Docs
                  </span>
                </div>
                <p className="text-xs text-[#64748B]">
                  Track client queries across all accounting pipelines, review uploaded receipts, send consolidated reminders, and approve items directly into the ledger.
                </p>
              </div>
            </div>
          </div>

          {/* Scope Toggle & Primary Actions */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Scope Toggle: Current Client vs All Firm Clients */}
            <div className="inline-flex items-center bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-1">
              <button
                type="button"
                onClick={() => setScopeMode('CURRENT')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                  scopeMode === 'CURRENT'
                    ? 'bg-white text-[#0F172A] shadow-2xs border border-[#E2E8F0]'
                    : 'text-[#64748B] hover:text-[#0F172A]'
                }`}
              >
                <Building2 className="w-3.5 h-3.5 text-[#0284C7]" />
                <span>{currentClient?.name || 'Current Client'}</span>
              </button>
              <button
                type="button"
                onClick={() => setScopeMode('ALL_CLIENTS')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                  scopeMode === 'ALL_CLIENTS'
                    ? 'bg-white text-[#0F172A] shadow-2xs border border-[#E2E8F0]'
                    : 'text-[#64748B] hover:text-[#0F172A]'
                }`}
              >
                <Users className="w-3.5 h-3.5 text-indigo-600" />
                <span>All Firm Clients</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setComposerPipelineType('GENERAL');
                setIsComposerOpen(true);
              }}
              className="flex items-center gap-1.5 bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-bold px-3.5 py-2 rounded-xl transition cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Client Request</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('portal')}
              className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-[#E2E8F0] text-xs font-semibold px-3 py-2 rounded-xl transition cursor-pointer shadow-2xs"
              title="Open external Client Clarification Portal"
            >
              <ExternalLink className="w-3.5 h-3.5 text-[#0284C7]" />
              <span>Client Portal</span>
            </button>

            <button
              type="button"
              onClick={loadRequests}
              disabled={isLoading}
              className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-[#E2E8F0] text-xs font-semibold px-3 py-2 rounded-xl transition cursor-pointer shadow-2xs disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#0284C7] ${isLoading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* Multi-Client Attention Health Strip */}
        {clientSummaries.length > 0 && (
          <div className="mt-4 pt-4 border-t border-[#F1F5F9]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] flex items-center gap-1.5">
                <Users className="w-3 h-3 text-[#0284C7]" />
                Firm Client Request Radar (Click client to switch workspace)
              </span>
              {scopeMode === 'ALL_CLIENTS' && (
                <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md">
                  Viewing All Firm Clients ({items.length} requests)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {clientSummaries.map((cs) => {
                const isSelectedClient = currentClient?.id === cs.client_id && scopeMode === 'CURRENT';
                const hasActivity = cs.total_requests > 0;
                return (
                  <button
                    key={cs.client_id}
                    type="button"
                    onClick={() => {
                      setClient(cs.client_id);
                      setScopeMode('CURRENT');
                    }}
                    className={`shrink-0 flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left transition cursor-pointer ${
                      isSelectedClient
                        ? 'bg-[#F0F9FF] border-[#0284C7] ring-1 ring-[#0284C7]/20'
                        : hasActivity
                        ? 'bg-white hover:bg-slate-50 border-[#E2E8F0]'
                        : 'bg-slate-50/70 hover:bg-slate-100/80 border-slate-200/70 opacity-75'
                    }`}
                  >
                    <div>
                      <p className="text-xs font-bold text-[#0F172A] leading-tight">{cs.client_name}</p>
                      <p className="text-[10px] text-[#64748B] mt-0.5">
                        {cs.total_requests === 0 ? 'No open requests' : `${cs.total_requests} total`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {cs.answered_count > 0 && (
                        <span
                          className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200"
                          title={`${cs.answered_count} answered by client and waiting for your review`}
                        >
                          {cs.answered_count} Replied
                        </span>
                      )}
                      {cs.overdue_count > 0 && (
                        <span
                          className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200"
                          title={`${cs.overdue_count} overdue (> 72h)`}
                        >
                          {cs.overdue_count} Overdue
                        </span>
                      )}
                      {cs.answered_count === 0 && cs.overdue_count === 0 && cs.pending_count > 0 && (
                        <span
                          className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200"
                          title={`${cs.pending_count} awaiting client response`}
                        >
                          {cs.pending_count} Waiting
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Action Feedback Banner */}
      {actionBanner && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 text-xs font-semibold animate-in fade-in duration-200 ${
            actionBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : actionBanner.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : 'bg-sky-50 border-sky-200 text-sky-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : actionBanner.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            ) : (
              <Sparkles className="w-4 h-4 text-sky-600 shrink-0" />
            )}
            <span>{actionBanner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionBanner(null)}
            className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 4 Actionable Triage Queue Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Card 1: Needs Accountant Review (Client Answered) */}
        <button
          type="button"
          onClick={() => setTriageTab(triageTab === 'CLIENT_ANSWERED' ? 'ALL' : 'CLIENT_ANSWERED')}
          className={`text-left p-4 rounded-2xl border transition cursor-pointer shadow-2xs ${
            triageTab === 'CLIENT_ANSWERED'
              ? 'bg-emerald-50/90 border-emerald-400 ring-2 ring-emerald-500/20'
              : 'bg-white hover:bg-emerald-50/40 border-[#E2E8F0]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
              Needs My Review
            </span>
            <span className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black font-mono text-[#0F172A]">
              {metrics.client_answered_count}
            </span>
            <span className="text-[11px] font-semibold text-emerald-700">
              Client Replied
            </span>
          </div>
          <p className="text-[11px] text-[#64748B] mt-1">
            Explanations &amp; receipts ready to approve in ledger
          </p>
        </button>

        {/* Card 2: Awaiting Client Response */}
        <button
          type="button"
          onClick={() => setTriageTab(triageTab === 'PENDING_CLIENT' ? 'ALL' : 'PENDING_CLIENT')}
          className={`text-left p-4 rounded-2xl border transition cursor-pointer shadow-2xs ${
            triageTab === 'PENDING_CLIENT'
              ? 'bg-amber-50/90 border-amber-400 ring-2 ring-amber-500/20'
              : 'bg-white hover:bg-amber-50/40 border-[#E2E8F0]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
              Awaiting Client
            </span>
            <span className="w-7 h-7 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black font-mono text-[#0F172A]">
              {metrics.pending_client_count}
            </span>
            <span className="text-[11px] font-semibold text-amber-700">
              Sent to Client
            </span>
          </div>
          <p className="text-[11px] text-[#64748B] mt-1">
            Open queries pending client clarification
          </p>
        </button>

        {/* Card 3: Overdue (> 72h) */}
        <button
          type="button"
          onClick={() => setTriageTab(triageTab === 'OVERDUE' ? 'ALL' : 'OVERDUE')}
          className={`text-left p-4 rounded-2xl border transition cursor-pointer shadow-2xs ${
            triageTab === 'OVERDUE'
              ? 'bg-rose-50/90 border-rose-400 ring-2 ring-rose-500/20'
              : 'bg-white hover:bg-rose-50/40 border-[#E2E8F0]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-rose-800">
              Overdue (&gt; 72h)
            </span>
            <span className="w-7 h-7 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black font-mono text-[#0F172A]">
              {metrics.overdue_count}
            </span>
            <span className="text-[11px] font-semibold text-rose-700">
              Needs Follow-Up
            </span>
          </div>
          <p className="text-[11px] text-[#64748B] mt-1">
            Unanswered for over 3 days • Send reminder digest
          </p>
        </button>

        {/* Card 4: Resolved / Closed */}
        <button
          type="button"
          onClick={() => setTriageTab(triageTab === 'RESOLVED' ? 'ALL' : 'RESOLVED')}
          className={`text-left p-4 rounded-2xl border transition cursor-pointer shadow-2xs ${
            triageTab === 'RESOLVED'
              ? 'bg-slate-100 border-slate-400 ring-2 ring-slate-400/20'
              : 'bg-white hover:bg-slate-50 border-[#E2E8F0]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
              Resolved &amp; Closed
            </span>
            <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
              <Check className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black font-mono text-[#0F172A]">
              {metrics.resolved_count}
            </span>
            <span className="text-[11px] font-semibold text-slate-600">
              Completed
            </span>
          </div>
          <p className="text-[11px] text-[#64748B] mt-1">
            Approved in AR/AP ledger or mapped to COA
          </p>
        </button>
      </div>

      {/* Multi-Dimensional Filter, Grouping & Bulk Action Bar */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-2xs space-y-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          {/* Pipeline Filter Pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold text-[#64748B] mr-1 flex items-center gap-1">
              <Filter className="w-3.5 h-3.5 text-[#0284C7]" />
              Pipeline:
            </span>
            {[
              { id: 'ALL' as PipelineFilter, label: 'All Pipelines', count: metrics.total_count },
              { id: 'AR' as PipelineFilter, label: 'Receivables (AR)', count: metrics.ar_count },
              { id: 'AP' as PipelineFilter, label: 'Payables (AP)', count: metrics.ap_count },
              { id: 'BANK' as PipelineFilter, label: 'Banking', count: metrics.bank_count },
              { id: 'GENERAL' as PipelineFilter, label: 'General Docs', count: metrics.general_count },
            ].map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setPipelineFilter(pill.id)}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                  pipelineFilter === pill.id
                    ? 'bg-[#0284C7] text-white shadow-2xs'
                    : 'bg-[#F8FAFC] hover:bg-slate-100 text-[#475569] border border-[#E2E8F0]'
                }`}
              >
                <span>{pill.label}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                    pipelineFilter === pill.id ? 'bg-white/20 text-white' : 'bg-white text-slate-600'
                  }`}
                >
                  {pill.count}
                </span>
              </button>
            ))}
          </div>

          {/* Search & Group By Controls */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search customer, vendor, query, amount..."
                className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl pl-8 pr-3 py-1.5 text-xs text-[#0F172A] placeholder-slate-400 focus:outline-none focus:border-[#0284C7] focus:bg-white transition"
              />
            </div>

            <div className="flex items-center gap-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-2.5 py-1.5">
              <Layers className="w-3.5 h-3.5 text-[#0284C7]" />
              <span className="text-[11px] font-semibold text-[#64748B]">Group by:</span>
              <select
                value={groupByMode}
                onChange={(e) => setGroupByMode(e.target.value as GroupByMode)}
                className="bg-transparent text-xs font-bold text-[#0F172A] focus:outline-none cursor-pointer"
              >
                <option value="PRIORITY">Priority &amp; Status</option>
                <option value="PIPELINE">Pipeline (AR / AP / Bank)</option>
                <option value="RECIPIENT">Recipient Email</option>
                <option value="CLIENT">Client Organization</option>
              </select>
            </div>
          </div>
        </div>

        {/* Bulk Selection & Digest Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-[#F1F5F9]">
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#475569] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filteredItems.length > 0 && filteredItems.every((i) => checkedKeys[i.item_key])}
                onChange={handleSelectAllFiltered}
                className="rounded border-slate-300 text-[#0284C7] focus:ring-[#0284C7]"
              />
              <span>
                {selectedKeysList.length > 0
                  ? `${selectedKeysList.length} request(s) selected`
                  : `Showing ${filteredItems.length} request(s)`}
              </span>
            </label>

            {triageTab !== 'ALL' && (
              <button
                type="button"
                onClick={() => setTriageTab('ALL')}
                className="text-[11px] font-semibold text-[#0284C7] hover:underline cursor-pointer"
              >
                Clear status filter ({triageTab})
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedKeysList.length > 0 ? (
              <>
                <button
                  type="button"
                  disabled={isReminding}
                  onClick={() => handleSendReminder(selectedKeysList)}
                  className="flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-xs font-bold px-3 py-1.5 rounded-xl transition cursor-pointer disabled:opacity-50"
                >
                  <Bell className="w-3.5 h-3.5 text-amber-700" />
                  <span>Send Consolidated Reminder ({selectedKeysList.length})</span>
                </button>
                <button
                  type="button"
                  disabled={isResolving}
                  onClick={() => handleResolveItems(selectedKeysList, true)}
                  className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition cursor-pointer disabled:opacity-50 shadow-2xs"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Approve &amp; Resolve Selected ({selectedKeysList.length})</span>
                </button>
              </>
            ) : (
              metrics.overdue_count > 0 && (
                <button
                  type="button"
                  disabled={isReminding}
                  onClick={() => {
                    const overdueKeys = items.filter((i) => i.is_overdue).map((i) => i.item_key);
                    handleSendReminder(overdueKeys);
                  }}
                  className="flex items-center gap-1.5 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 text-xs font-bold px-3 py-1.5 rounded-xl transition cursor-pointer disabled:opacity-50"
                >
                  <Bell className="w-3.5 h-3.5 text-rose-600" />
                  <span>Nudge All Overdue ({metrics.overdue_count})</span>
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* Main Split Master-Detail Control Workspace */}
      {isLoading ? (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-16 text-center shadow-2xs flex flex-col items-center justify-center gap-3">
          <RefreshCw className="w-6 h-6 text-[#0284C7] animate-spin" />
          <p className="text-xs font-medium text-[#64748B]">
            Loading client information requests across all pipelines...
          </p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-12 text-center shadow-2xs flex flex-col items-center justify-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#F0F9FF] border border-[#BAE6FD] flex items-center justify-center text-[#0284C7]">
            <MessageSquare className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-[#0F172A]">No Information Requests Match Your Filter</h3>
          <p className="text-xs text-[#64748B] max-w-md">
            You can send questions to the client directly from Accounts Receivable (AR), Accounts Payable (AP), or Bank &amp; Reconciliations, or create a general request right here.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2.5 mt-2">
            <button
              type="button"
              onClick={() => {
                setComposerPipelineType('GENERAL');
                setIsComposerOpen(true);
              }}
              className="flex items-center gap-1.5 bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-bold px-4 py-2 rounded-xl transition cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create General Client Request</span>
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceSubTab('ar')}
              className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-[#E2E8F0] text-xs font-semibold px-3.5 py-2 rounded-xl transition cursor-pointer"
            >
              <Receipt className="w-3.5 h-3.5 text-sky-600" />
              <span>Go to Receivables (AR)</span>
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceSubTab('ap')}
              className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-[#E2E8F0] text-xs font-semibold px-3.5 py-2 rounded-xl transition cursor-pointer"
            >
              <CreditCard className="w-3.5 h-3.5 text-violet-600" />
              <span>Go to Payables (AP)</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Pane: Grouped Request Queue List (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            {groupedItems.map((group) => (
              <div
                key={group.id}
                className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden shadow-2xs"
              >
                {/* Group Header */}
                <div className="px-4 py-2.5 bg-[#F8FAFC] border-b border-[#E2E8F0] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${group.badgeClass}`}>
                      {group.items.length}
                    </span>
                    <h3 className="text-xs font-bold text-[#0F172A]">{group.title}</h3>
                  </div>
                </div>

                {/* Group Items */}
                <div className="divide-y divide-[#F1F5F9]">
                  {group.items.map((item) => {
                    const isSelected = selectedItem?.item_key === item.item_key;
                    const isChecked = !!checkedKeys[item.item_key];
                    const pipeMeta = getPipelineBadgeMeta(item.pipeline_type);
                    const PipeIcon = pipeMeta.icon;

                    return (
                      <div
                        key={item.item_key}
                        onClick={() => setSelectedItemKey(item.item_key)}
                        className={`p-4 transition cursor-pointer flex items-start gap-3 ${
                          isSelected
                            ? 'bg-[#F0F9FF]/70 border-l-4 border-l-[#0284C7]'
                            : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <div className="pt-0.5" onClick={(e) => toggleItemChecked(item.item_key, e)}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="rounded border-slate-300 text-[#0284C7] focus:ring-[#0284C7] cursor-pointer"
                          />
                        </div>

                        <div className="flex-1 min-w-0 space-y-1.5">
                          {/* Top Badges Row */}
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${pipeMeta.className}`}
                              >
                                <PipeIcon className="w-3 h-3" />
                                <span>{pipeMeta.shortLabel}</span>
                              </span>

                              {scopeMode === 'ALL_CLIENTS' && (
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                  {item.client_name}
                                </span>
                              )}

                              <span className="text-[11px] font-semibold text-[#475569] truncate max-w-[200px]">
                                {pipeMeta.partyPrefix}: <strong className="text-[#0F172A]">{item.party_or_account_name}</strong>
                              </span>

                              {item.line_count > 1 && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
                                  {item.line_count} slip items
                                </span>
                              )}
                            </div>

                            {/* Status & Age Pill */}
                            <div className="flex items-center gap-1.5 shrink-0">
                              {item.query_status === 'CLIENT_ANSWERED' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                  Client Replied
                                </span>
                              ) : item.query_status === 'RESOLVED' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                  <Check className="w-3 h-3 text-slate-600" />
                                  Resolved
                                </span>
                              ) : item.is_overdue ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                                  <AlertTriangle className="w-3 h-3 text-rose-600" />
                                  Overdue • {formatAgeLabel(item.age_hours)}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                  <Clock className="w-3 h-3 text-amber-600" />
                                  Awaiting • {formatAgeLabel(item.age_hours)}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Title & Amount Row */}
                          <div className="flex items-baseline justify-between gap-3">
                            <h4 className="text-xs font-bold text-[#0F172A] truncate">
                              {item.description}
                            </h4>
                            {item.amount > 0 && (
                              <span className="text-xs font-mono font-bold text-[#0F172A] shrink-0">
                                GHS {Number(item.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            )}
                          </div>

                          {/* Accountant Question Snippet */}
                          {item.accountant_query && (
                            <p className="text-[11px] text-[#475569] line-clamp-1">
                              <span className="font-semibold text-[#0F172A]">Q:</span> {item.accountant_query}
                            </p>
                          )}

                          {/* Client Reply Preview if present */}
                          {item.client_explanation && (
                            <div className="p-2 rounded-lg bg-emerald-50/80 border border-emerald-200/80 text-[11px] text-emerald-950 flex items-start justify-between gap-2">
                              <p className="line-clamp-1">
                                <span className="font-bold text-emerald-800">Client Reply:</span> {item.client_explanation}
                              </p>
                              {item.client_attachments && item.client_attachments.length > 0 && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white text-emerald-800 border border-emerald-200 text-[10px] font-bold shrink-0">
                                  <Paperclip className="w-2.5 h-2.5" />
                                  {item.client_attachments.length}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Right Pane: Sticky Master-Detail Resolution Inspector (5 cols) */}
          <div className="lg:col-span-5 lg:sticky lg:top-20">
            {selectedItem ? (
              <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden">
                {/* Inspector Header */}
                <div className="p-5 bg-[#F8FAFC] border-b border-[#E2E8F0] space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      {(() => {
                        const meta = getPipelineBadgeMeta(selectedItem.pipeline_type);
                        const Icon = meta.icon;
                        return (
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${meta.className}`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            <span>{meta.label}</span>
                          </span>
                        );
                      })()}

                      {selectedItem.query_status === 'CLIENT_ANSWERED' ? (
                        <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          Ready for Review
                        </span>
                      ) : selectedItem.query_status === 'RESOLVED' ? (
                        <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-200 text-slate-700">
                          Resolved
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                          Awaiting Client
                        </span>
                      )}
                    </div>

                    {selectedItem.pipeline_type !== 'GENERAL' && (
                      <button
                        type="button"
                        onClick={() => handleJumpToPipeline(selectedItem)}
                        className="inline-flex items-center gap-1 text-xs font-bold text-[#0284C7] hover:text-[#0369A1] bg-white border border-[#BAE6FD] px-2.5 py-1 rounded-lg transition cursor-pointer shadow-2xs"
                      >
                        <span>
                          Open in{' '}
                          {selectedItem.pipeline_type === 'AR'
                            ? 'AR Ledger'
                            : selectedItem.pipeline_type === 'AP'
                            ? 'AP Bills'
                            : 'Bank Queue'}
                        </span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-[#0F172A] leading-snug">
                      {selectedItem.description}
                    </h3>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-white border border-[#E2E8F0] rounded-xl p-2.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] block">
                          {getPipelineBadgeMeta(selectedItem.pipeline_type).partyPrefix}
                        </span>
                        <span className="font-bold text-[#0F172A] mt-0.5 block truncate">
                          {selectedItem.party_or_account_name}
                        </span>
                      </div>
                      <div className="bg-white border border-[#E2E8F0] rounded-xl p-2.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] block">
                          Amount / Date
                        </span>
                        <span className="font-mono font-bold text-[#0F172A] mt-0.5 block">
                          {selectedItem.amount > 0
                            ? `GHS ${Number(selectedItem.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : 'Document Query'}{' '}
                          <span className="text-[11px] font-sans font-normal text-[#64748B]">
                            • {selectedItem.transaction_date}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Recipient & Source Slip Metadata */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#64748B] pt-1">
                    <div className="flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        Recipient:{' '}
                        <strong className="text-[#0F172A]">
                          {selectedItem.recipient_email || 'Client Portal Default'}
                        </strong>
                      </span>
                      {selectedItem.reminder_count > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold">
                          {selectedItem.reminder_count} reminder(s) sent
                        </span>
                      )}
                    </div>

                    {selectedItem.drive_file_id && (
                      <button
                        type="button"
                        onClick={() => setPreviewDriveFileId(selectedItem.drive_file_id || null)}
                        className="inline-flex items-center gap-1 text-[#0284C7] hover:underline font-semibold cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Preview Source Slip</span>
                      </button>
                    )}
                  </div>

                  {/* Multi-item AR Slip Breakdown */}
                  {selectedItem.line_items && selectedItem.line_items.length > 1 && (
                    <div className="bg-white border border-[#E2E8F0] rounded-xl p-2.5 space-y-1.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">
                        Grouped Slip Line Items ({selectedItem.line_items.length})
                      </p>
                      <div className="max-h-28 overflow-y-auto divide-y divide-slate-100 text-xs">
                        {selectedItem.line_items.map((li) => (
                          <div key={li.id} className="py-1 flex items-center justify-between gap-2">
                            <span className="text-slate-700 truncate">{li.description}</span>
                            <span className="font-mono font-semibold text-slate-900 shrink-0">
                              GHS {Number(li.amount || 0).toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Q&A Conversation Timeline */}
                <div className="p-5 space-y-4 max-h-[380px] overflow-y-auto">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#64748B] flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-[#0284C7]" />
                    Clarification Audit Timeline
                  </h4>

                  {selectedItem.query_history && selectedItem.query_history.length > 0 ? (
                    <div className="space-y-3">
                      {selectedItem.query_history.map((entry, idx) => {
                        const isClient = entry.sender === 'client';
                        return (
                          <div
                            key={idx}
                            className={`p-3.5 rounded-2xl border text-xs space-y-1.5 ${
                              isClient
                                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950 ml-4'
                                : 'bg-amber-50/60 border-amber-200 text-amber-950 mr-4'
                            }`}
                          >
                            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
                              <span className={isClient ? 'text-emerald-800' : 'text-amber-800'}>
                                {isClient ? 'Client Response' : 'Accountant Question'}
                              </span>
                              <span className="text-slate-500 font-mono">
                                {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ''}
                              </span>
                            </div>
                            <p className="text-xs leading-relaxed whitespace-pre-wrap">{entry.message}</p>
                            {entry.attachments && entry.attachments.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {entry.attachments.map((att, aIdx) => (
                                  <button
                                    key={aIdx}
                                    type="button"
                                    onClick={() =>
                                      att.url
                                        ? setPreviewAttachment({ name: att.name, url: att.url, type: att.type })
                                        : undefined
                                    }
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-emerald-300 text-emerald-800 text-[11px] font-semibold hover:bg-emerald-100 transition cursor-pointer"
                                  >
                                    <Paperclip className="w-3 h-3" />
                                    <span className="truncate max-w-[180px]">{att.name}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {selectedItem.accountant_query && (
                        <div className="p-3.5 rounded-2xl bg-amber-50/60 border border-amber-200 text-xs text-amber-950 mr-4 space-y-1">
                          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-amber-800">
                            <span>Accountant Question</span>
                            <span className="font-mono text-slate-500">
                              {selectedItem.query_date ? new Date(selectedItem.query_date).toLocaleDateString() : ''}
                            </span>
                          </div>
                          <p className="leading-relaxed">{selectedItem.accountant_query}</p>
                        </div>
                      )}

                      {selectedItem.client_explanation ? (
                        <div className="p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-200 text-xs text-emerald-950 ml-4 space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                            <span>Client Response</span>
                            <span className="font-mono text-slate-500">
                              {selectedItem.response_date
                                ? new Date(selectedItem.response_date).toLocaleDateString()
                                : ''}
                            </span>
                          </div>
                          <p className="leading-relaxed">{selectedItem.client_explanation}</p>
                          {selectedItem.client_attachments && selectedItem.client_attachments.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {selectedItem.client_attachments.map((att, aIdx) => (
                                <button
                                  key={aIdx}
                                  type="button"
                                  onClick={() =>
                                    att.url
                                      ? setPreviewAttachment({ name: att.name, url: att.url, type: att.type })
                                      : undefined
                                  }
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-emerald-300 text-emerald-800 text-[11px] font-semibold hover:bg-emerald-100 transition cursor-pointer"
                                >
                                  <Paperclip className="w-3 h-3" />
                                  <span className="truncate max-w-[180px]">{att.name}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-500 italic">
                          No response received from the client yet.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 1-Click Resolution Action Panel */}
                <div className="p-5 bg-[#F8FAFC] border-t border-[#E2E8F0] space-y-4">
                  <div className="space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] block">
                      1-Click Accountant Resolution
                    </span>

                    {selectedItem.pipeline_type === 'BANK' ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <SearchableAccountSelect
                              accounts={coaAccounts}
                              value={selectedCoaCategory}
                              onChange={(val) => setSelectedCoaCategory(val)}
                              placeholder="Select Chart of Accounts category..."
                            />
                          </div>
                          <button
                            type="button"
                            disabled={!selectedCoaCategory.trim() || isResolving}
                            onClick={() => handleCategorizeAndResolveBank(selectedItem)}
                            className="bg-[#059669] hover:bg-[#047857] text-white text-xs font-bold px-3.5 py-2 rounded-xl transition cursor-pointer disabled:opacity-40 shrink-0 shadow-2xs"
                          >
                            Categorize &amp; Resolve
                          </button>
                        </div>
                        {selectedItem.query_status !== 'RESOLVED' && (
                          <button
                            type="button"
                            disabled={isResolving}
                            onClick={() => handleResolveItems([selectedItem.item_key], false)}
                            className="w-full bg-white hover:bg-slate-100 text-slate-700 border border-[#E2E8F0] text-xs font-semibold py-2 px-3 rounded-xl transition cursor-pointer"
                          >
                            Mark Query Resolved Without Categorizing
                          </button>
                        )}
                      </div>
                    ) : selectedItem.pipeline_type === 'AR' || selectedItem.pipeline_type === 'AP' ? (
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        <button
                          type="button"
                          disabled={isResolving}
                          onClick={() => handleResolveItems([selectedItem.item_key], true)}
                          className="flex-1 bg-[#059669] hover:bg-[#047857] text-white text-xs font-bold py-2.5 px-4 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>
                            Approve in {selectedItem.pipeline_type} Ledger &amp; Resolve
                          </span>
                        </button>
                        {selectedItem.query_status !== 'RESOLVED' && (
                          <button
                            type="button"
                            disabled={isResolving}
                            onClick={() => handleResolveItems([selectedItem.item_key], false)}
                            className="bg-white hover:bg-slate-100 text-slate-700 border border-[#E2E8F0] text-xs font-semibold py-2.5 px-3 rounded-xl transition cursor-pointer"
                          >
                            Resolve Only
                          </button>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={isResolving || selectedItem.query_status === 'RESOLVED'}
                        onClick={() => handleResolveItems([selectedItem.item_key], true)}
                        className="w-full bg-[#059669] hover:bg-[#047857] text-white text-xs font-bold py-2.5 px-4 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Mark Document Request Completed</span>
                      </button>
                    )}
                  </div>

                  {/* Follow-Up Question Input */}
                  <form onSubmit={handleSendFollowUp} className="space-y-2 pt-3 border-t border-[#E2E8F0]">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] block">
                      Need More Detail? Send Follow-Up Question
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={followUpText}
                        onChange={(e) => setFollowUpText(e.target.value)}
                        placeholder="Ask a follow-up question or request a clearer receipt..."
                        className="flex-1 bg-white border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] placeholder-slate-400 focus:outline-none focus:border-[#0284C7]"
                      />
                      <button
                        type="submit"
                        disabled={isSubmittingFollowUp || !followUpText.trim()}
                        className="bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-bold px-3.5 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 disabled:opacity-40 shrink-0"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Reply</span>
                      </button>
                    </div>
                  </form>

                  {/* Nudge & Magic Link Utility Footer */}
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E2E8F0]">
                    <button
                      type="button"
                      disabled={isReminding}
                      onClick={() => handleSendReminder([selectedItem.item_key])}
                      className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 hover:text-amber-950 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-xl transition cursor-pointer disabled:opacity-50"
                    >
                      <Bell className="w-3.5 h-3.5 text-amber-600" />
                      <span>Send Reminder Email</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleCopyMagicLink(selectedItem)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:bg-white bg-slate-100 border border-[#E2E8F0] px-3 py-1.5 rounded-xl transition cursor-pointer"
                    >
                      {copiedLink ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-emerald-700">Copied Magic Link</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-[#0284C7]" />
                          <span>Copy Magic Link</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* New Client Request Composer Modal */}
      {currentClient && (
        <QueryComposerModal
          isOpen={isComposerOpen}
          onClose={() => setIsComposerOpen(false)}
          targetClientId={currentClient.id}
          pipelineType={composerPipelineType}
          onSuccess={(res) => {
            if (res?.portal_url || res?.magic_url) {
              setLastMagicPortalUrl(res.portal_url || res.magic_url);
            }
            setActionBanner({
              type: 'success',
              message: 'New information request dispatched to client.',
            });
            loadRequests();
          }}
        />
      )}

      {/* Client Attachment Lightbox Modal */}
      {previewAttachment && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl max-w-3xl w-full max-h-[88vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-5 py-3.5 border-b border-[#E2E8F0] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Paperclip className="w-4 h-4 text-[#0284C7]" />
                <h3 className="text-sm font-bold text-[#0F172A] truncate">{previewAttachment.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewAttachment(null)}
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 bg-slate-50 p-4 overflow-auto flex items-center justify-center min-h-[360px]">
              {previewAttachment.url.startsWith('data:image/') ||
              /\.(png|jpg|jpeg|webp|gif)$/i.test(previewAttachment.name) ? (
                <img
                  src={previewAttachment.url}
                  alt={previewAttachment.name}
                  className="max-w-full max-h-[70vh] rounded-lg shadow-sm object-contain"
                />
              ) : (
                <iframe
                  src={previewAttachment.url}
                  title={previewAttachment.name}
                  className="w-full h-[70vh] rounded-lg border border-slate-200 bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Source Drive Slip Preview Modal */}
      {previewDriveFileId && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-5 py-3.5 border-b border-[#E2E8F0] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-[#0284C7]" />
                <h3 className="text-sm font-bold text-[#0F172A]">Source Document Preview</h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewDriveFileId(null)}
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 bg-slate-100 p-4 overflow-auto flex items-center justify-center min-h-[420px]">
              <img
                src={`/api/v1/clients/drive-files/${encodeURIComponent(previewDriveFileId)}/preview`}
                alt="Source Document Preview"
                className="max-w-full max-h-[75vh] rounded-lg shadow-sm object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
