import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Building2,
  UserCheck,
  Mail,
  Phone,
  Search,
  Plus,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
  Shield,
  ShieldCheck,
  Clock,
  Trash2,
  Sliders,
  Send,
  AlertCircle,
  Briefcase,
} from 'lucide-react';
import { useClient } from '../../context/ClientContext';
import { useAutomation } from '../../context/AutomationContext';
import type { ClientContact, FirmTeamMember, ContactStats } from '../../types/contacts';
import {
  fetchContactStats,
  fetchClientContacts,
  resendClientContactInvite,
  deleteClientContact,
  fetchFirmTeamMembers,
  resendFirmTeamMemberInvite,
  deleteFirmTeamMember,
} from '../../lib/api';
import { InviteClientContactModal } from './InviteClientContactModal';
import { InviteTeamMemberModal } from './InviteTeamMemberModal';

export const ContactManagementSection: React.FC = () => {
  const { clients, currentClient } = useClient();
  const { addLog, setActiveTab, setWorkspaceSubTab } = useAutomation();

  const [activeTab, setActiveContactTab] = useState<'clients' | 'firm'>('clients');
  const [stats, setStats] = useState<ContactStats>({
    total_client_contacts: 0,
    active_portal_contacts: 0,
    pending_invites: 0,
    total_firm_members: 0,
  });

  // Client Contacts State
  const [clientContacts, setClientContacts] = useState<ClientContact[]>([]);
  const [selectedClientFilter, setSelectedClientFilter] = useState<string>('ALL');
  const [clientStatusFilter, setClientStatusFilter] = useState<string>('ALL');
  const [clientSearchQuery, setClientSearchQuery] = useState<string>('');

  // Firm Team State
  const [firmMembers, setFirmMembers] = useState<FirmTeamMember[]>([]);
  const [firmSearchQuery, setFirmSearchQuery] = useState<string>('');

  const [isLoading, setIsLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Modals
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);

  // Load All Data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [statsRes, contactsRes, teamRes] = await Promise.all([
        fetchContactStats('s4_advisory'),
        fetchClientContacts(selectedClientFilter, clientStatusFilter, clientSearchQuery, 's4_advisory'),
        fetchFirmTeamMembers(firmSearchQuery, 's4_advisory'),
      ]);

      setStats(statsRes);
      setClientContacts(contactsRes.contacts || []);
      setFirmMembers(teamRes.team_members || []);
    } catch (err: any) {
      addLog('error', `Failed to load contact data: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [selectedClientFilter, clientStatusFilter, clientSearchQuery, firmSearchQuery, addLog]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Copy Magic Link
  const handleCopyMagicLink = (contact: ClientContact) => {
    if (!contact.magic_url) return;
    navigator.clipboard.writeText(contact.magic_url);
    setCopiedId(contact.id);
    addLog('info', `📋 Copied 72-hour magic link for ${contact.name}`);
    setTimeout(() => setCopiedId(null), 2500);
  };

  // Resend Client Invite
  const handleResendClientInvite = async (contact: ClientContact) => {
    setActionLoadingId(`resend_client_${contact.id}`);
    try {
      const res = await resendClientContactInvite(contact.id);
      addLog('success', `📧 ${res.message}`);
      await loadData();
    } catch (err: any) {
      addLog('error', `Could not resend invite: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Delete Client Contact
  const handleDeleteClientContact = async (contact: ClientContact) => {
    if (!window.confirm(`Are you sure you want to revoke portal access for ${contact.name}?`)) return;
    setActionLoadingId(`delete_client_${contact.id}`);
    try {
      const res = await deleteClientContact(contact.id);
      addLog('info', res.message);
      await loadData();
    } catch (err: any) {
      addLog('error', `Could not delete contact: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Resend Firm Member Invite
  const handleResendTeamInvite = async (member: FirmTeamMember) => {
    setActionLoadingId(`resend_firm_${member.id}`);
    try {
      const res = await resendFirmTeamMemberInvite(member.id);
      addLog('success', `🤝 ${res.message}`);
      await loadData();
    } catch (err: any) {
      addLog('error', `Could not resend invite: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Delete Firm Member
  const handleDeleteTeamMember = async (member: FirmTeamMember) => {
    if (!window.confirm(`Remove staff member ${member.name} from the practice?`)) return;
    setActionLoadingId(`delete_firm_${member.id}`);
    try {
      const res = await deleteFirmTeamMember(member.id);
      addLog('info', res.message);
      await loadData();
    } catch (err: any) {
      addLog('error', `Could not remove team member: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-sky-950/80 via-slate-900 to-indigo-950/80 border border-sky-500/30 rounded-2xl p-6 shadow-xl backdrop-blur-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-extrabold text-white tracking-tight">
                  Contacts &amp; Practice Team Management
                </h1>
                <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
                  Invite client executives to clarify bank queries via 1-click magic links, and invite accounting firm team members to manage client portfolios.
                </p>
              </div>
            </div>
          </div>

          {/* Header Action Buttons */}
          <div className="flex items-center gap-2.5 flex-wrap shrink-0">
            <button
              onClick={() => setIsClientModalOpen(true)}
              className="flex items-center gap-1.5 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-bold py-2.5 px-3.5 rounded-xl shadow-lg shadow-sky-600/30 transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Invite Client Contact</span>
            </button>

            <button
              onClick={() => setIsTeamModalOpen(true)}
              className="flex items-center gap-1.5 bg-slate-900/90 hover:bg-slate-800 text-slate-200 hover:text-white text-xs font-bold py-2.5 px-3.5 rounded-xl border border-slate-800 transition cursor-pointer"
            >
              <UserCheck className="w-3.5 h-3.5 text-indigo-400" />
              <span>Invite Team Member</span>
            </button>

            <button
              onClick={loadData}
              disabled={isLoading}
              className="p-2.5 bg-slate-900/90 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl border border-slate-800 transition cursor-pointer"
              title="Refresh contact records"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Top KPI Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl backdrop-blur-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-400">Total Client Contacts</span>
            <Building2 className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-black text-white">{stats.total_client_contacts}</div>
          <span className="text-[10px] text-sky-400/80 font-medium mt-1 block">Registered client stakeholders</span>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl backdrop-blur-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-emerald-400">Active Portal Users</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-200">{stats.active_portal_contacts}</div>
          <span className="text-[10px] text-emerald-400/80 font-medium mt-1 block">Live portal participants</span>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl backdrop-blur-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-amber-300">Pending Invitations</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-200">{stats.pending_invites}</div>
          <span className="text-[10px] text-amber-400/80 font-medium mt-1 block">Awaiting magic link response</span>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl backdrop-blur-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-indigo-300">Practice Team</span>
            <UserCheck className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-black text-indigo-200">{stats.total_firm_members}</div>
          <span className="text-[10px] text-indigo-400/80 font-medium mt-1 block">Accountants managing clients</span>
        </div>

      </div>

      {/* Main Tab Navigation */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl backdrop-blur-xl space-y-4">
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          
          {/* Sub Tab Switcher */}
          <div className="flex items-center gap-2 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveContactTab('clients')}
              className={`flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-lg transition cursor-pointer ${
                activeTab === 'clients'
                  ? 'bg-sky-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Client Contacts (Info Requests)</span>
              <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-sky-950 text-sky-300 border border-sky-500/40 font-mono">
                {clientContacts.length}
              </span>
            </button>

            <button
              onClick={() => setActiveContactTab('firm')}
              className={`flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-lg transition cursor-pointer ${
                activeTab === 'firm'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Firm Team Members (Client Management)</span>
              <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-500/40 font-mono">
                {firmMembers.length}
              </span>
            </button>
          </div>

          {/* Quick Context Action */}
          {activeTab === 'clients' && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setActiveTab('workspace');
                  setWorkspaceSubTab('requests');
                }}
                className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 hover:underline cursor-pointer font-bold"
              >
                <span>Go to Information Requests Queue</span>
                <span>→</span>
              </button>
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------- */}
        {/* TAB 1: CLIENT CONTACTS */}
        {/* ------------------------------------------------------------- */}
        {activeTab === 'clients' && (
          <div className="space-y-4">
            
            {/* Filter Toolbar */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              
              <div className="flex items-center gap-2.5 flex-wrap">
                {/* Client Selector Filter */}
                <div className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-1.5">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Client:</span>
                  <select
                    value={selectedClientFilter}
                    onChange={(e) => setSelectedClientFilter(e.target.value)}
                    className="bg-transparent text-xs font-bold text-white focus:outline-none cursor-pointer"
                  >
                    <option value="ALL" className="bg-slate-900 text-white">All Clients</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id} className="bg-slate-900 text-white">
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status Tabs */}
                <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800 text-xs">
                  {['ALL', 'ACTIVE', 'INVITED'].map((st) => (
                    <button
                      key={st}
                      onClick={() => setClientStatusFilter(st)}
                      className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                        clientStatusFilter === st
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {st === 'ALL' ? 'All' : st}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search Box */}
              <div className="relative min-w-[220px]">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search contact, client, email..."
                  value={clientSearchQuery}
                  onChange={(e) => setClientSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            {/* Client Contacts List / Cards */}
            {clientContacts.length === 0 ? (
              <div className="p-8 bg-slate-950/40 rounded-2xl border border-slate-800 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-sky-950/60 border border-sky-500/30 flex items-center justify-center mx-auto text-sky-400">
                  <Building2 className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-white">No Client Contacts Found</h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Invite client owners, CFOs, or bookkeepers so they can receive 1-click magic link notifications to answer bank queries.
                </p>
                <button
                  onClick={() => setIsClientModalOpen(true)}
                  className="inline-flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Invite First Client Contact</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {clientContacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="bg-slate-950/80 border border-slate-800 hover:border-sky-500/50 rounded-2xl p-4 shadow-lg transition space-y-3 flex flex-col justify-between"
                  >
                    <div>
                      {/* Top Row: Name + Status Badge */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500/30 to-indigo-500/30 border border-sky-500/40 flex items-center justify-center text-white font-black text-xs">
                            {contact.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-white leading-tight">
                              {contact.name}
                            </h4>
                            <span className="text-[11px] font-medium text-sky-400">
                              {contact.role.replace('_', ' ')}
                            </span>
                          </div>
                        </div>

                        {/* Status Badge */}
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                            contact.portal_status === 'ACTIVE'
                              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                              : 'bg-amber-950/80 text-amber-300 border-amber-500/40'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              contact.portal_status === 'ACTIVE' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                            }`}
                          />
                          <span>{contact.portal_status}</span>
                        </span>
                      </div>

                      {/* Client Company Pill */}
                      <div className="mt-2.5">
                        <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 font-medium">
                          <Building2 className="w-3 h-3 text-sky-400" />
                          <span>{contact.client_name || contact.client_id}</span>
                        </span>
                      </div>

                      {/* Contact Info */}
                      <div className="mt-3 space-y-1.5 text-xs text-slate-400">
                        <div className="flex items-center gap-2 truncate">
                          <Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="truncate text-slate-200">{contact.email}</span>
                        </div>
                        {contact.phone && (
                          <div className="flex items-center gap-2">
                            <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <span className="font-mono text-slate-300">{contact.phone}</span>
                          </div>
                        )}
                        {contact.notes && (
                          <p className="text-[11px] text-slate-500 italic mt-1 line-clamp-2">
                            "{contact.notes}"
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Card Actions */}
                    <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                      <button
                        onClick={() => handleCopyMagicLink(contact)}
                        className="flex items-center gap-1 text-[11px] font-bold text-sky-400 hover:text-sky-300 bg-sky-950/60 border border-sky-500/30 px-2.5 py-1.5 rounded-xl transition cursor-pointer"
                        title="Copy 72-hour 1-click magic link to clipboard"
                      >
                        {copiedId === contact.id ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span className="text-emerald-300">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy Link</span>
                          </>
                        )}
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleResendClientInvite(contact)}
                          disabled={actionLoadingId === `resend_client_${contact.id}`}
                          className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition cursor-pointer"
                          title="Resend invitation email"
                        >
                          <Send className={`w-3.5 h-3.5 ${actionLoadingId === `resend_client_${contact.id}` ? 'animate-spin' : ''}`} />
                        </button>

                        <a
                          href={contact.magic_url}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded-lg transition cursor-pointer"
                          title="Launch portal as this contact (Preview)"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>

                        <button
                          onClick={() => handleDeleteClientContact(contact)}
                          disabled={actionLoadingId === `delete_client_${contact.id}`}
                          className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition cursor-pointer"
                          title="Revoke access and remove contact"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                  </div>
                ))}
              </div>
            )}

          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* TAB 2: FIRM TEAM MEMBERS */}
        {/* ------------------------------------------------------------- */}
        {activeTab === 'firm' && (
          <div className="space-y-4">
            
            {/* Search Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Shield className="w-4 h-4 text-indigo-400" />
                <span>Accounting practice staff participating in portfolio management and bank reconciliations</span>
              </div>

              <div className="relative min-w-[220px]">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search staff, role, email..."
                  value={firmSearchQuery}
                  onChange={(e) => setFirmSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Team Members Grid */}
            {firmMembers.length === 0 ? (
              <div className="p-8 bg-slate-950/40 rounded-2xl border border-slate-800 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-indigo-950/60 border border-indigo-500/30 flex items-center justify-center mx-auto text-indigo-400">
                  <UserCheck className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-white">No Team Members Found</h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Invite your accounting firm partners, senior accountants, and bookkeepers to manage client portfolios together.
                </p>
                <button
                  onClick={() => setIsTeamModalOpen(true)}
                  className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Invite First Team Member</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {firmMembers.map((member) => {
                  const isGlobal = member.assigned_client_ids.includes('*');
                  return (
                    <div
                      key={member.id}
                      className="bg-slate-950/80 border border-slate-800 hover:border-indigo-500/50 rounded-2xl p-4 shadow-lg transition space-y-3 flex flex-col justify-between"
                    >
                      <div>
                        {/* Top: Name + Role Badge */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-xl bg-indigo-950 border border-indigo-500/40 flex items-center justify-center text-indigo-300 font-black text-xs">
                              {member.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-white leading-tight">
                                {member.name}
                              </h4>
                              <span className="text-[11px] font-bold text-indigo-300">
                                {member.role.replace('_', ' ')}
                              </span>
                            </div>
                          </div>

                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              member.status === 'ACTIVE'
                                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                                : 'bg-amber-950/80 text-amber-300 border-amber-500/40'
                            }`}
                          >
                            {member.status}
                          </span>
                        </div>

                        {/* Email & Phone */}
                        <div className="mt-3 space-y-1 text-xs text-slate-400">
                          <div className="flex items-center gap-2 truncate">
                            <Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <span className="truncate text-slate-200">{member.email}</span>
                          </div>
                          {member.phone && (
                            <div className="flex items-center gap-2">
                              <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                              <span className="font-mono text-slate-300">{member.phone}</span>
                            </div>
                          )}
                        </div>

                        {/* Assigned Client Portfolio */}
                        <div className="mt-3 space-y-1">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">
                            Assigned Clients:
                          </span>
                          {isGlobal ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg bg-indigo-950/80 text-indigo-200 border border-indigo-500/30">
                              <ShieldCheck className="w-3 h-3 text-emerald-400" />
                              <span>All Clients (Global Practice Access)</span>
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {member.assigned_client_ids.map((cid) => (
                                <span
                                  key={cid}
                                  className="text-[10px] font-medium px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300"
                                >
                                  {cid}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Permissions Badges */}
                        <div className="mt-3 flex flex-wrap gap-1">
                          {member.permissions?.can_query_clients && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-500/30">
                              Queries
                            </span>
                          )}
                          {member.permissions?.can_categorize && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/30">
                              Categorization
                            </span>
                          )}
                          {member.permissions?.can_sync_accounting && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-500/30">
                              Sync
                            </span>
                          )}
                          {member.permissions?.can_manage_clients && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-500/30">
                              Admin
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Card Actions */}
                      <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
                        <span className="text-[10px] text-slate-500">
                          Joined {new Date(member.created_at).toLocaleDateString()}
                        </span>

                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleResendTeamInvite(member)}
                            disabled={actionLoadingId === `resend_firm_${member.id}`}
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition cursor-pointer"
                            title="Resend welcome email"
                          >
                            <Send className={`w-3.5 h-3.5 ${actionLoadingId === `resend_firm_${member.id}` ? 'animate-spin' : ''}`} />
                          </button>

                          <button
                            onClick={() => handleDeleteTeamMember(member)}
                            disabled={actionLoadingId === `delete_firm_${member.id}`}
                            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition cursor-pointer"
                            title="Remove staff member"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                    </div>
                  );
                })}
              </div>
            )}

          </div>
        )}

      </div>

      {/* Modals */}
      <InviteClientContactModal
        isOpen={isClientModalOpen}
        onClose={() => setIsClientModalOpen(false)}
        onSuccess={() => {
          loadData();
          addLog('success', '🎉 Client contact invited!');
        }}
        clients={clients}
        defaultClientId={currentClient?.id}
      />

      <InviteTeamMemberModal
        isOpen={isTeamModalOpen}
        onClose={() => setIsTeamModalOpen(false)}
        onSuccess={() => {
          loadData();
          addLog('success', '🎉 Firm team member invited!');
        }}
        clients={clients}
      />

    </div>
  );
};
