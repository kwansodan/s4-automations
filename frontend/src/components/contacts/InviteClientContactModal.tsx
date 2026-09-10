import React, { useState, useEffect } from 'react';
import { X, Mail, Phone, User, Shield, Check, Copy, ExternalLink, Send } from 'lucide-react';
import type { ClientContact, InviteClientContactPayload } from '../../types/contacts';
import type { ClientProfile } from '../../types/client';
import { inviteClientContact } from '../../lib/api';

interface InviteClientContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (contact: ClientContact, magicUrl: string) => void;
  clients: ClientProfile[];
  defaultClientId?: string;
}

const ROLE_OPTIONS = [
  { id: 'CFO', label: 'Chief Financial Officer (CFO)' },
  { id: 'Financial_Controller', label: 'Financial Controller' },
  { id: 'Managing_Director', label: 'Managing Director / CEO' },
  { id: 'Operations_Lead', label: 'Operations Lead' },
  { id: 'Internal_Accountant', label: 'Internal Bookkeeper / Accountant' },
];

export const InviteClientContactModal: React.FC<InviteClientContactModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  clients,
  defaultClientId,
}) => {
  const [clientId, setClientId] = useState<string>(defaultClientId || (clients[0]?.id || ''));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('CFO');
  const [channel, setChannel] = useState<'email' | 'whatsapp' | 'both'>('both');
  const [notes, setNotes] = useState('');
  const [sendEmail, setSendEmail] = useState(true);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedResult, setGeneratedResult] = useState<{
    contact: ClientContact;
    magicUrl: string;
    emailSent: boolean;
  } | null>(null);
  const [hasCopied, setHasCopied] = useState(false);

  useEffect(() => {
    if (defaultClientId) {
      setClientId(defaultClientId);
    } else if (clients.length > 0 && !clientId) {
      setClientId(clients[0].id);
    }
  }, [defaultClientId, clients, clientId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !clientId) {
      setError('Name, email, and target client are required.');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const payload: InviteClientContactPayload = {
        client_id: clientId,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        role,
        notification_channel: channel,
        notes: notes.trim() || undefined,
        send_invitation: sendEmail,
      };

      const res = await inviteClientContact(payload);
      setGeneratedResult({
        contact: res.contact,
        magicUrl: res.magic_url,
        emailSent: res.email_sent,
      });
      onSuccess(res.contact, res.magic_url);
    } catch (err: any) {
      setError(err.message || 'Failed to invite client contact');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (!generatedResult?.magicUrl) return;
    navigator.clipboard.writeText(generatedResult.magicUrl);
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 2500);
  };

  const handleClose = () => {
    setGeneratedResult(null);
    setName('');
    setEmail('');
    setPhone('');
    setNotes('');
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in">
      <div className="bg-slate-900 border border-sky-500/30 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 text-slate-100 relative">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                Invite Client Contact
              </h2>
              <p className="text-xs text-slate-400">
                Grant 1-click magic access for Information Requests and bank clarifications
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-950/60 border border-rose-500/40 rounded-xl text-xs text-rose-300">
            {error}
          </div>
        )}

        {/* Success / Generated Magic Link View */}
        {generatedResult ? (
          <div className="space-y-4 py-2 animate-in fade-in">
            <div className="p-4 bg-sky-950/60 border border-sky-500/40 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-sky-300 text-xs font-bold">
                <Check className="w-4 h-4 text-emerald-400" />
                <span>Contact Invited Successfully!</span>
              </div>
              <p className="text-xs text-slate-300">
                <strong>{generatedResult.contact.name}</strong> ({generatedResult.contact.email}) has been invited to the portal.
                {generatedResult.emailSent
                  ? ' An invitation email with their 1-click magic link was dispatched.'
                  : ' Direct email was skipped.'}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                72-Hour Magic Access Link (Passwordless):
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={generatedResult.magicUrl}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-sky-300 select-all"
                />
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold px-3 py-2 rounded-xl transition cursor-pointer shrink-0"
                >
                  {hasCopied ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{hasCopied ? 'Copied!' : 'Copy Link'}</span>
                </button>
              </div>
              <span className="text-[10px] text-slate-500 block">
                You can copy this link and send it directly via WhatsApp, SMS, or Slack.
              </span>
            </div>

            <div className="flex justify-end pt-3">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          /* Input Form */
          <form onSubmit={handleSubmit} className="space-y-4">
            
            {/* Target Client Organization */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300">
                Target Client Organization <span className="text-rose-400">*</span>
              </label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                required
              >
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Name & Role */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-300">
                  Full Name <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <User className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    placeholder="e.g. Kwame Mensah"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-300">
                  Executive Role <span className="text-rose-400">*</span>
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500 cursor-pointer"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Email & Phone */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-300">
                  Email Address <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="email"
                    placeholder="cfo@clientorg.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-300">
                  Phone / WhatsApp (Optional)
                </label>
                <div className="relative">
                  <Phone className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="tel"
                    placeholder="+233 24 000 0000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>
            </div>

            {/* Notification Channel & Notes */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300">
                Alert Delivery Channel
              </label>
              <div className="flex items-center gap-4 text-xs text-slate-300 pt-1">
                {[
                  { id: 'both', label: 'Email & WhatsApp' },
                  { id: 'email', label: 'Email Only' },
                  { id: 'whatsapp', label: 'WhatsApp Only' },
                ].map((opt) => (
                  <label key={opt.id} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="channel"
                      checked={channel === opt.id}
                      onChange={() => setChannel(opt.id as any)}
                      className="text-sky-500 focus:ring-0"
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Internal Notes */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300">
                Internal Contact Notes (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Primary signatory for fuel card & director loan transactions"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
              />
            </div>

            {/* Immediate Email Toggle */}
            <div className="flex items-center gap-2 p-3 bg-slate-950/80 rounded-xl border border-slate-800">
              <input
                type="checkbox"
                id="sendEmailCheck"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
                className="rounded border-slate-700 text-sky-500 focus:ring-0 cursor-pointer"
              />
              <label htmlFor="sendEmailCheck" className="text-xs text-slate-300 cursor-pointer select-none">
                Dispatch branded invitation email with 72-hour 1-click magic link immediately
              </label>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={handleClose}
                disabled={isLoading}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="flex items-center gap-1.5 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg shadow-sky-600/30 transition cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isLoading ? 'Generating Invite...' : 'Send Portal Invitation'}</span>
              </button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
};
