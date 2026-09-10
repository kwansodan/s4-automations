import React, { useState } from 'react';
import { X, UserCheck, Mail, Phone, ShieldCheck, Check, Send } from 'lucide-react';
import type { FirmTeamMember, InviteTeamMemberPayload } from '../../types/contacts';
import type { ClientProfile } from '../../types/client';
import { inviteFirmTeamMember } from '../../lib/api';

interface InviteTeamMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (member: FirmTeamMember) => void;
  clients: ClientProfile[];
}

const FIRM_ROLES = [
  { id: 'PARTNER', label: 'Firm Partner / Director', desc: 'Full practice authority, client management & approvals' },
  { id: 'SENIOR_ACCOUNTANT', label: 'Senior Accountant / Manager', desc: 'Reviews reconciliation, dispatches queries & syncs accounts' },
  { id: 'STAFF_ACCOUNTANT', label: 'Staff Bookkeeper / AP Clerk', desc: 'Categorizes daily transactions and drafts client queries' },
  { id: 'AUDITOR', label: 'Audit Reviewer (Read-Only)', desc: 'Inspects telemetry, audit trails & trial balance reconciliations' },
];

export const InviteTeamMemberModal: React.FC<InviteTeamMemberModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  clients,
}) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('SENIOR_ACCOUNTANT');
  const [isAllClients, setIsAllClients] = useState(true);
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  
  // Permissions state
  const [canQuery, setCanQuery] = useState(true);
  const [canCategorize, setCanCategorize] = useState(true);
  const [canSync, setCanSync] = useState(true);
  const [canManageClients, setCanManageClients] = useState(false);

  const [sendEmail, setSendEmail] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleRoleChange = (newRole: string) => {
    setRole(newRole);
    if (newRole === 'PARTNER') {
      setCanQuery(true);
      setCanCategorize(true);
      setCanSync(true);
      setCanManageClients(true);
      setIsAllClients(true);
    } else if (newRole === 'SENIOR_ACCOUNTANT') {
      setCanQuery(true);
      setCanCategorize(true);
      setCanSync(true);
      setCanManageClients(false);
    } else if (newRole === 'STAFF_ACCOUNTANT') {
      setCanQuery(true);
      setCanCategorize(true);
      setCanSync(false);
      setCanManageClients(false);
    } else if (newRole === 'AUDITOR') {
      setCanQuery(false);
      setCanCategorize(false);
      setCanSync(false);
      setCanManageClients(false);
    }
  };

  const toggleClientSelection = (cId: string) => {
    if (selectedClientIds.includes(cId)) {
      setSelectedClientIds(selectedClientIds.filter((id) => id !== cId));
    } else {
      setSelectedClientIds([...selectedClientIds, cId]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError('Staff name and email address are required.');
      return;
    }
    if (!isAllClients && selectedClientIds.length === 0) {
      setError('Please select at least one client to assign, or choose All Clients.');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const payload: InviteTeamMemberPayload = {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        role,
        assigned_client_ids: isAllClients ? ['*'] : selectedClientIds,
        permissions: {
          can_query_clients: canQuery,
          can_categorize: canCategorize,
          can_sync_accounting: canSync,
          can_manage_clients: canManageClients,
        },
        send_invitation: sendEmail,
      };

      const res = await inviteFirmTeamMember(payload);
      onSuccess(res.team_member);
      handleClose();
    } catch (err: any) {
      setError(err.message || 'Failed to invite team member');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setName('');
    setEmail('');
    setPhone('');
    setSelectedClientIds([]);
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in">
      <div className="bg-slate-900 border border-indigo-500/30 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 text-slate-100 relative max-h-[90vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                Invite Firm Team Member
              </h2>
              <p className="text-xs text-slate-400">
                Grant staff access to manage client accounting &amp; information requests
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

        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* Name & Email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300">
                Full Staff Name <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Abena Boateng"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300">
                Corporate Email <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <Mail className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="email"
                  placeholder="aboateng@service4gh.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>
            </div>
          </div>

          {/* Phone */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-300">
              Phone Number (Optional)
            </label>
            <div className="relative">
              <Phone className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="tel"
                placeholder="+233 24 000 0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Firm Role */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-300">
              Firm Practice Role <span className="text-rose-400">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {FIRM_ROLES.map((r) => (
                <div
                  key={r.id}
                  onClick={() => handleRoleChange(r.id)}
                  className={`p-3 rounded-xl border cursor-pointer transition ${
                    role === r.id
                      ? 'bg-indigo-950/60 border-indigo-500 text-white shadow-sm'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">{r.label}</span>
                    {role === r.id && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 leading-tight">{r.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Assigned Client Scope */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-300">
                Assigned Client Portfolio
              </label>
              <button
                type="button"
                onClick={() => setIsAllClients(!isAllClients)}
                className="text-[11px] text-indigo-400 hover:text-white font-medium cursor-pointer"
              >
                {isAllClients ? 'Switch to Specific Clients' : 'Assign All Clients (Global)'}
              </button>
            </div>

            {isAllClients ? (
              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-slate-300 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Global Portfolio Access: Team member can view and manage <strong>all client accounts</strong>.</span>
              </div>
            ) : (
              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2 max-h-36 overflow-y-auto">
                <span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">
                  Select Assigned Clients:
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {clients.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedClientIds.includes(c.id)}
                        onChange={() => toggleClientSelection(c.id)}
                        className="rounded border-slate-700 text-indigo-500 focus:ring-0"
                      />
                      <span className="truncate">{c.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Permission Flags */}
          <div className="space-y-2 pt-1">
            <label className="text-xs font-bold text-slate-300">
              Operational Permissions
            </label>
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
              <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={canQuery}
                  onChange={(e) => setCanQuery(e.target.checked)}
                  className="rounded border-slate-700 text-indigo-500 focus:ring-0"
                />
                <span>Query Clients</span>
              </label>

              <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={canCategorize}
                  onChange={(e) => setCanCategorize(e.target.checked)}
                  className="rounded border-slate-700 text-indigo-500 focus:ring-0"
                />
                <span>Classify Feeds</span>
              </label>

              <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={canSync}
                  onChange={(e) => setCanSync(e.target.checked)}
                  className="rounded border-slate-700 text-indigo-500 focus:ring-0"
                />
                <span>Sync Accounting</span>
              </label>

              <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={canManageClients}
                  onChange={(e) => setCanManageClients(e.target.checked)}
                  className="rounded border-slate-700 text-indigo-500 focus:ring-0"
                />
                <span>Manage Clients</span>
              </label>
            </div>
          </div>

          {/* Welcome Email Toggle */}
          <div className="flex items-center gap-2 p-3 bg-slate-950/80 rounded-xl border border-slate-800">
            <input
              type="checkbox"
              id="sendTeamEmailCheck"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
              className="rounded border-slate-700 text-indigo-500 focus:ring-0 cursor-pointer"
            />
            <label htmlFor="sendTeamEmailCheck" className="text-xs text-slate-300 cursor-pointer select-none">
              Dispatch welcome email with platform access credentials immediately
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
              className="flex items-center gap-1.5 bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg shadow-indigo-600/30 transition cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isLoading ? 'Inviting Staff...' : 'Send Team Invitation'}</span>
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
