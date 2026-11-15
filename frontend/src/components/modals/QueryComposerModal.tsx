import React, { useState, useEffect } from 'react';
import { useClient } from '../../context/ClientContext';
import { useAutomation } from '../../context/AutomationContext';
import {
  queryBankTransaction,
  createInformationRequest,
  fetchClientContacts,
} from '../../lib/api';
import type { BankTransactionRecord, InformationRequestPipelineType } from '../../types/client';
import type { ClientContact } from '../../types/contacts';
import {
  X,
  Send,
  HelpCircle,
  Sparkles,
  Mail,
  DollarSign,
  Calendar,
  Receipt,
  Landmark,
  FileText,
} from 'lucide-react';

export interface QueryContextSummary {
  title: string;
  subtitle?: string;
  amount?: number;
  date?: string;
  partyName?: string;
  itemsCount?: number;
  initialQuery?: string;
}

interface QueryComposerModalProps {
  transaction?: BankTransactionRecord | null;
  pipelineType?: InformationRequestPipelineType;
  bankTransactionIds?: number[];
  stagedTransactionIds?: number[];
  contextSummary?: QueryContextSummary | null;
  targetClientId?: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (result?: any) => void;
}

const TEMPLATES_BY_PIPELINE: Record<InformationRequestPipelineType, string[]> = {
  BANK: [
    'Please provide the business purpose and vendor invoice for this bank transaction.',
    'What goods or services were purchased with this transfer? Please attach the receipt.',
    'Is this an operating business expense or a director loan / personal draw?',
    'Could you clarify if this payment is for the main office or a specific client project?',
  ],
  AR: [
    'Please confirm the customer name and agreed unit rate for this delivery slip.',
    'There is a discrepancy between picked and delivered quantities on this slip. Please clarify.',
    'Is this slip billable under the monthly contract or should it be invoiced separately?',
    'Please attach the signed customer acknowledgment or purchase order for this receivable.',
  ],
  AP: [
    'Please attach the official tax invoice or VAT receipt from this vendor.',
    'Which expense category or cost center should this vendor bill be allocated to?',
    'Please confirm if this vendor bill has already been paid or remains payable.',
    'Could you verify the quantity and agreed unit price on this supplier bill?',
  ],
  GENERAL: [
    'Please upload the signed contract or supporting schedule for this accounting period.',
    'Please provide the missing monthly statement or supporting tax certificate.',
    'Could you confirm if there are any unrecorded cash expenses or credit notes for this month?',
    'Please review and confirm the attached schedule so we can finalize the monthly close.',
  ],
};

export const QueryComposerModal: React.FC<QueryComposerModalProps> = ({
  transaction = null,
  pipelineType,
  bankTransactionIds,
  stagedTransactionIds,
  contextSummary = null,
  targetClientId,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { currentClient, clients } = useClient();
  const { addLog } = useAutomation();

  const resolvedPipeline: InformationRequestPipelineType =
    pipelineType || (transaction ? 'BANK' : 'GENERAL');

  const activeClient =
    (targetClientId ? clients.find((c) => c.id === targetClientId) : currentClient) || currentClient;

  const templates = TEMPLATES_BY_PIPELINE[resolvedPipeline] || TEMPLATES_BY_PIPELINE.BANK;

  const [queryText, setQueryText] = useState(
    contextSummary?.initialQuery || transaction?.accountant_query || templates[0]
  );
  const [generalTitle, setGeneralTitle] = useState(contextSummary?.title || '');
  const [generalParty, setGeneralParty] = useState(contextSummary?.partyName || '');
  const [generalAmount, setGeneralAmount] = useState(
    contextSummary?.amount ? String(contextSummary.amount) : ''
  );
  const [generalDate, setGeneralDate] = useState(
    contextSummary?.date || new Date().toISOString().slice(0, 10)
  );

  const [recipientEmail, setRecipientEmail] = useState<string>(() => {
    if (activeClient?.team_members && activeClient.team_members.length > 0) {
      const cfo = activeClient.team_members.find(
        (m) => m.role === 'CFO' || m.role === 'Financial_Controller'
      );
      return cfo ? cfo.email : activeClient.team_members[0].email;
    }
    return activeClient?.sourceEmail || 'cfo@clientorg.com';
  });
  const [contacts, setContacts] = useState<ClientContact[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const nextTemplates = TEMPLATES_BY_PIPELINE[resolvedPipeline] || TEMPLATES_BY_PIPELINE.BANK;
      setQueryText(
        contextSummary?.initialQuery || transaction?.accountant_query || nextTemplates[0]
      );
      setGeneralTitle(contextSummary?.title || '');
      setGeneralParty(contextSummary?.partyName || '');
      setGeneralAmount(contextSummary?.amount ? String(contextSummary.amount) : '');
      setGeneralDate(contextSummary?.date || new Date().toISOString().slice(0, 10));
    }
  }, [isOpen, resolvedPipeline, transaction?.id, contextSummary?.title]);

  useEffect(() => {
    if (isOpen && activeClient?.id) {
      fetchClientContacts(activeClient.id)
        .then((res) => {
          if (res.contacts && res.contacts.length > 0) {
            setContacts(res.contacts);
            const cfo = res.contacts.find(
              (c) => c.role === 'CFO' || c.role === 'Financial_Controller'
            );
            if (cfo) {
              setRecipientEmail(cfo.email);
            } else if (res.contacts[0]) {
              setRecipientEmail(res.contacts[0].email);
            }
          }
        })
        .catch(() => {});
    }
  }, [isOpen, activeClient?.id]);

  if (!isOpen) return null;
  if (resolvedPipeline === 'BANK' && !transaction && (!bankTransactionIds || bankTransactionIds.length === 0)) {
    return null;
  }

  const handleSendQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryText.trim()) return;

    setIsSubmitting(true);
    try {
      if (
        resolvedPipeline === 'BANK' &&
        transaction &&
        (!bankTransactionIds || bankTransactionIds.length <= 1)
      ) {
        const res = await queryBankTransaction(transaction.id, {
          query_text: queryText.trim(),
          recipient_email: recipientEmail.trim(),
          send_immediately: true,
        });
        addLog(
          'success',
          `Clarification request dispatched to ${res.recipient_email || recipientEmail} for ${activeClient?.currency || 'GHS'} ${Number(transaction.amount || 0).toLocaleString()} bank transaction.`
        );
        onSuccess(res.transaction);
        onClose();
        return;
      }

      const res = await createInformationRequest({
        client_id: activeClient.id,
        pipeline_type: resolvedPipeline,
        query_text: queryText.trim(),
        recipient_email: recipientEmail.trim(),
        send_immediately: true,
        bank_transaction_ids:
          resolvedPipeline === 'BANK'
            ? bankTransactionIds && bankTransactionIds.length > 0
              ? bankTransactionIds
              : transaction
              ? [transaction.id]
              : []
            : undefined,
        staged_transaction_ids:
          resolvedPipeline === 'AR' || resolvedPipeline === 'AP'
            ? stagedTransactionIds || []
            : undefined,
        general_title: resolvedPipeline === 'GENERAL' ? generalTitle.trim() || 'General Accounting Inquiry' : undefined,
        general_amount: resolvedPipeline === 'GENERAL' && generalAmount ? Number(generalAmount) : undefined,
        general_date: resolvedPipeline === 'GENERAL' ? generalDate : undefined,
        party_name: resolvedPipeline === 'GENERAL' ? generalParty.trim() || 'General Request' : undefined,
      });

      addLog(
        'success',
        `Information request (${resolvedPipeline}) dispatched to ${res.recipient_email || recipientEmail}.`
      );
      onSuccess(res);
      onClose();
    } catch (err: any) {
      addLog('error', `Could not send information request: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const pipelineBadge = {
    BANK: {
      label: 'Bank & Reconciliations',
      icon: Landmark,
      color: 'bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]',
    },
    AR: {
      label: 'Accounts Receivable (Customer)',
      icon: Receipt,
      color: 'bg-[#F0F9FF] text-[#0284C7] border-[#BAE6FD]',
    },
    AP: {
      label: 'Accounts Payable (Vendor)',
      icon: DollarSign,
      color: 'bg-amber-50 text-amber-700 border-amber-200',
    },
    GENERAL: {
      label: 'General Information Request',
      icon: FileText,
      color: 'bg-purple-50 text-purple-700 border-purple-200',
    },
  }[resolvedPipeline];

  const BadgeIcon = pipelineBadge.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white border border-[#E2E8F0] rounded-2xl max-w-xl w-full p-6 shadow-xl space-y-5 text-slate-800 max-h-[92vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#F0F9FF] border border-[#BAE6FD] flex items-center justify-center text-[#0284C7]">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-[#0F172A] tracking-tight">
                  Send Client Information Request
                </h2>
                <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${pipelineBadge.color}`}>
                  <BadgeIcon className="w-3 h-3" />
                  {pipelineBadge.label}
                </span>
              </div>
              <p className="text-xs text-[#64748B]">
                {activeClient?.name || 'Client Organisation'}
                {transaction ? ` • Bank Item #${transaction.id}` : ''}
                {stagedTransactionIds && stagedTransactionIds.length > 0
                  ? ` • ${stagedTransactionIds.length} Ledger Item${stagedTransactionIds.length > 1 ? 's' : ''}`
                  : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Context Card for BANK / AR / AP or Editable Fields for GENERAL */}
        {resolvedPipeline === 'GENERAL' ? (
          <div className="bg-slate-50 border border-[#E2E8F0] rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Request Subject / Document Needed *
                </label>
                <input
                  type="text"
                  value={generalTitle}
                  onChange={(e) => setGeneralTitle(e.target.value)}
                  placeholder="e.g., Missing October GCB Bank Statement"
                  className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-[#0284C7]"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Related Customer / Vendor / Account (Optional)
                </label>
                <input
                  type="text"
                  value={generalParty}
                  onChange={(e) => setGeneralParty(e.target.value)}
                  placeholder="e.g., Tax Authority / Main Account"
                  className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-[#0284C7]"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Reference Date
                </label>
                <input
                  type="date"
                  value={generalDate}
                  onChange={(e) => setGeneralDate(e.target.value)}
                  className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-xs text-slate-800 font-mono focus:outline-none focus:border-[#0284C7]"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Reference Amount ({activeClient?.currency || 'GHS'}, Optional)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={generalAmount}
                  onChange={(e) => setGeneralAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-xs text-slate-800 font-mono focus:outline-none focus:border-[#0284C7]"
                />
              </div>
            </div>
          </div>
        ) : transaction ? (
          <div className="bg-slate-50 border border-[#E2E8F0] rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#64748B] flex items-center gap-1.5 font-mono">
                <Calendar className="w-3.5 h-3.5 text-[#0284C7]" />
                {transaction.transaction_date}
              </span>
              <span className="font-bold text-[#0F172A] text-sm font-mono flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5 text-[#059669]" />
                {transaction.transaction_type === 'CREDIT' ? '+' : '-'}
                {activeClient?.currency || 'GHS'}{' '}
                {Number(transaction.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold ml-1 ${
                    transaction.transaction_type === 'CREDIT'
                      ? 'bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]'
                      : 'bg-[#FFF1F2] text-[#E11D48] border border-[#FECDD3]'
                  }`}
                >
                  {transaction.transaction_type === 'CREDIT' ? 'Money In (+)' : 'Money Out (-)'}
                </span>
              </span>
            </div>
            <p className="text-xs font-mono text-slate-800 break-words bg-white px-2.5 py-1.5 rounded-lg border border-[#E2E8F0]">
              {transaction.description}
            </p>
            <span className="text-[11px] text-[#0284C7] block font-mono">
              Bank Account: {transaction.bank_account_name || 'Primary Bank Account'}
            </span>
          </div>
        ) : contextSummary ? (
          <div className="bg-slate-50 border border-[#E2E8F0] rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#64748B] flex items-center gap-1.5 font-mono">
                <Calendar className="w-3.5 h-3.5 text-[#0284C7]" />
                {contextSummary.date || 'Current Period'}
              </span>
              {contextSummary.amount !== undefined && (
                <span className="font-bold text-[#0F172A] text-sm font-mono flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5 text-[#059669]" />
                  {activeClient?.currency || 'GHS'}{' '}
                  {Number(contextSummary.amount || 0).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              )}
            </div>
            <div className="bg-white px-3 py-2 rounded-lg border border-[#E2E8F0]">
              <p className="text-xs font-bold text-slate-900">{contextSummary.title}</p>
              {contextSummary.subtitle && (
                <p className="text-[11px] text-slate-500 mt-0.5 font-mono">{contextSummary.subtitle}</p>
              )}
            </div>
            {contextSummary.partyName && (
              <span className="text-[11px] text-[#0284C7] block font-mono">
                {resolvedPipeline === 'AR' ? 'Customer' : resolvedPipeline === 'AP' ? 'Vendor' : 'Account'}:{' '}
                {contextSummary.partyName}
              </span>
            )}
          </div>
        ) : null}

        {/* Quick Question Templates */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#0284C7]" />
            <span>Suggested Clarification Templates:</span>
          </label>
          <div className="grid grid-cols-1 gap-1.5">
            {templates.map((tmpl, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setQueryText(tmpl)}
                className={`text-left text-xs p-2 rounded-lg border transition cursor-pointer ${
                  queryText === tmpl
                    ? 'bg-[#F0F9FF] border-[#BAE6FD] text-[#0284C7] font-medium'
                    : 'bg-white border-[#E2E8F0] text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                "{tmpl}"
              </button>
            ))}
          </div>
        </div>

        {/* Custom Question Textarea */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-700 block">
            Accountant Question / Instructions for Client:
          </label>
          <textarea
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            rows={3}
            placeholder="Type specific question or supporting document request for the client..."
            className="w-full bg-white border border-[#E2E8F0] rounded-xl p-3 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#0284C7] resize-none font-sans shadow-xs"
          />
        </div>

        {/* Target Stakeholder Recipient */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <Mail className="w-3.5 h-3.5 text-[#0284C7]" />
            <span>Send Alert to Stakeholder / Client Contact:</span>
          </label>
          <div className="flex gap-2">
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="cfo@clientorg.com"
              className="flex-1 bg-white border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#0284C7] font-mono shadow-xs"
            />
            {(contacts.length > 0 || (activeClient?.team_members && activeClient.team_members.length > 0)) && (
              <select
                value={recipientEmail}
                onChange={(e) => {
                  if (e.target.value) setRecipientEmail(e.target.value);
                }}
                className="bg-white border border-[#E2E8F0] rounded-xl px-2.5 py-2 text-xs text-slate-800 focus:outline-none focus:border-[#0284C7] cursor-pointer max-w-[200px] truncate shadow-xs"
              >
                <option value="">Select Stakeholder...</option>
                {contacts.length > 0
                  ? contacts.map((c) => (
                      <option key={c.id} value={c.email}>
                        {c.name} ({c.role.replace('_', ' ')})
                      </option>
                    ))
                  : activeClient?.team_members?.map((m) => (
                      <option key={m.id} value={m.email}>
                        {m.name} ({m.role.replace('_', ' ')})
                      </option>
                    ))}
              </select>
            )}
          </div>
          <span className="text-[10px] text-slate-500 block">
            A secure 1-click magic link is generated automatically so the client can reply and upload documents in the Client Portal without needing a password.
          </span>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E2E8F0]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSendQuery}
            disabled={isSubmitting || !queryText.trim()}
            className="inline-flex items-center gap-2 bg-[#0284C7] hover:bg-[#0EA5E9] active:bg-[#0369A1] disabled:opacity-50 text-white text-xs font-semibold py-2.5 px-5 rounded-xl shadow-xs transition cursor-pointer"
          >
            {isSubmitting ? (
              <span>Dispatching Request...</span>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Send Request &amp; Notify Client</span>
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};
