import React, { useState } from 'react';
import { useClient } from '../../context/ClientContext';
import { useAutomation } from '../../context/AutomationContext';
import { queryBankTransaction } from '../../lib/api';
import type { BankTransactionRecord } from '../../types/client';
import {
  X,
  Send,
  HelpCircle,
  Sparkles,
  Mail,
  User,
  CheckCircle2,
  FileText,
  DollarSign,
  Calendar,
  Zap,
} from 'lucide-react';

interface QueryComposerModalProps {
  transaction: BankTransactionRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedTx: BankTransactionRecord) => void;
}

const QUICK_TEMPLATES = [
  'Please provide the business purpose and vendor invoice for this transaction.',
  'What goods or services were purchased with this transfer? Please attach receipt.',
  'Is this an operating business expense or director loan / personal draw?',
  'Could you clarify if this payment is for the main office or a specific client project?',
];

export const QueryComposerModal: React.FC<QueryComposerModalProps> = ({
  transaction,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { currentClient } = useClient();
  const { addLog } = useAutomation();

  const [queryText, setQueryText] = useState(
    transaction?.accountant_query || QUICK_TEMPLATES[0]
  );
  const [recipientEmail, setRecipientEmail] = useState<string>(() => {
    if (currentClient?.team_members && currentClient.team_members.length > 0) {
      const cfo = currentClient.team_members.find((m) => m.role === 'CFO' || m.role === 'Financial_Controller');
      return cfo ? cfo.email : currentClient.team_members[0].email;
    }
    return currentClient?.sourceEmail || 'cfo@clientorg.com';
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen || !transaction) return null;

  const handleSendQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryText.trim()) return;

    setIsSubmitting(true);
    try {
      const res = await queryBankTransaction(transaction.id, {
        query_text: queryText.trim(),
        recipient_email: recipientEmail.trim(),
        send_immediately: true,
      });

      addLog('success', `📧 Clarification query dispatched to ${res.recipient_email || recipientEmail} for GHS ${transaction.amount.toLocaleString()} transaction!`);
      onSuccess(res.transaction);
      onClose();
    } catch (err: any) {
      addLog('error', `Could not send query: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in">
      <div className="bg-slate-900 border border-sky-500/30 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 text-slate-100">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">
                Draw Client Attention / Send Clarification Query
              </h2>
              <p className="text-xs text-slate-400">
                {currentClient?.name || 'Client Organisation'} • Transaction #{transaction.id}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Transaction Summary Card */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1.5 font-mono">
              <Calendar className="w-3.5 h-3.5 text-sky-400" />
              {transaction.transaction_date}
            </span>
            <span className="font-extrabold text-white text-sm font-mono flex items-center gap-1">
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
              GHS {transaction.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ml-1 ${
                transaction.transaction_type === 'DEBIT' ? 'bg-rose-950/60 text-rose-300 border border-rose-500/30' : 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/30'
              }`}>
                {transaction.transaction_type}
              </span>
            </span>
          </div>
          <p className="text-xs font-mono text-slate-300 break-words bg-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-800/80">
            {transaction.description}
          </p>
          {transaction.bank_account_name && (
            <span className="text-[11px] text-slate-400 block font-mono">
              Account: {transaction.bank_account_name}
            </span>
          )}
        </div>

        {/* Quick Question Templates */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Suggested Clarification Templates:</span>
          </label>
          <div className="grid grid-cols-1 gap-1.5">
            {QUICK_TEMPLATES.map((tmpl, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setQueryText(tmpl)}
                className={`text-left text-xs p-2 rounded-lg border transition cursor-pointer ${
                  queryText === tmpl
                    ? 'bg-sky-950/60 border-sky-500/50 text-sky-200'
                    : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                "{tmpl}"
              </button>
            ))}
          </div>
        </div>

        {/* Custom Question Textarea */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-300 block">
            Accountant Question / Instructions for Client:
          </label>
          <textarea
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            rows={3}
            placeholder="Type specific question or context for the client..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 resize-none font-sans"
          />
        </div>

        {/* Target Stakeholder Recipient */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <Mail className="w-3.5 h-3.5 text-sky-400" />
            <span>Send Alert to Stakeholder / Client Contact:</span>
          </label>
          <div className="flex gap-2">
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="cfo@clientorg.com"
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono"
            />
            {currentClient?.team_members && currentClient.team_members.length > 0 && (
              <select
                onChange={(e) => {
                  if (e.target.value) setRecipientEmail(e.target.value);
                }}
                className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-slate-300 focus:outline-none focus:border-sky-500 cursor-pointer"
              >
                <option value="">Choose Team Member...</option>
                {currentClient.team_members.map((m) => (
                  <option key={m.id} value={m.email}>
                    {m.name} ({m.role.replace('_', ' ')})
                  </option>
                ))}
              </select>
            )}
          </div>
          <span className="text-[10px] text-slate-400 block">
            A secure 1-click magic link is generated automatically, allowing the recipient to answer without typing an OTP code.
          </span>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSendQuery}
            disabled={isSubmitting || !queryText.trim()}
            className="inline-flex items-center gap-2 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 active:from-sky-700 active:to-indigo-700 disabled:opacity-50 text-white text-xs font-bold py-2.5 px-5 rounded-xl shadow-lg shadow-sky-600/30 transition cursor-pointer"
          >
            {isSubmitting ? (
              <span>Dispatching Alert...</span>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Send Query &amp; Notify Client</span>
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};
