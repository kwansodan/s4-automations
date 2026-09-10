import React, { useState, useEffect } from 'react';
import {
  X,
  Users,
  UserPlus,
  Mail,
  Building2,
  Tag,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Trash2,
  Edit2,
  Search,
  Filter,
  Download,
  Upload,
  Layers,
  Sparkles,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import {
  EmailSubscriber,
  AudienceResponse,
  fetchAudienceSubscribers,
  createOrBulkImportSubscribers,
  updateAudienceSubscriber,
  deleteAudienceSubscriber,
  syncClientContactsToAudience,
} from '../../lib/api';

interface AudienceManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAudienceUpdated?: (totalActive: number) => void;
}

export const AudienceManagerModal: React.FC<AudienceManagerModalProps> = ({
  isOpen,
  onClose,
  onAudienceUpdated,
}) => {
  const [subscribers, setSubscribers] = useState<EmailSubscriber[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [tierCounts, setTierCounts] = useState<Record<string, number>>({});
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [selectedTier, setSelectedTier] = useState<string>('');
  const [activeOnly, setActiveOnly] = useState(false);

  // Sub-views: 'list' | 'add_single' | 'bulk_import'
  const [viewMode, setViewMode] = useState<'list' | 'add_single' | 'bulk_import'>('list');

  // Form states for adding single contact
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [roleOrTitle, setRoleOrTitle] = useState('Finance Lead');
  const [tier, setTier] = useState<'lead' | 'client' | 'firm_partner' | 'subscriber'>('firm_partner');
  const [tagsInput, setTagsInput] = useState('accounting_firm, qbo_user');
  const [notes, setNotes] = useState('');

  // Bulk import state
  const [bulkEmails, setBulkEmails] = useState('');
  const [bulkTier, setBulkTier] = useState<'lead' | 'client' | 'firm_partner' | 'subscriber'>('lead');
  const [bulkTags, setBulkTags] = useState('prospect, campaign_2026');

  // Action status feedback
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadAudience();
    }
  }, [isOpen, searchQuery, selectedTag, selectedTier, activeOnly]);

  const loadAudience = async () => {
    setIsLoading(true);
    try {
      const data = await fetchAudienceSubscribers({
        search: searchQuery || undefined,
        tag: selectedTag || undefined,
        tier: selectedTier || undefined,
        active_only: activeOnly,
        limit: 150,
      });
      setSubscribers(data.subscribers || []);
      setTotalCount(data.total_count || 0);
      setActiveCount(data.active_count || 0);
      setTierCounts(data.tier_counts || {});
      setAvailableTags(data.available_tags || []);
      if (onAudienceUpdated) {
        onAudienceUpdated(data.active_count || 0);
      }
    } catch (err: any) {
      console.error('Failed to load audience:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      alert('Please enter a valid email address.');
      return;
    }
    setIsSubmitting(true);
    setStatusMessage(null);
    try {
      const parsedTags = tagsInput
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);

      const res = await createOrBulkImportSubscribers({
        email: email.trim(),
        name: name.trim() || undefined,
        company: company.trim() || undefined,
        role_or_title: roleOrTitle.trim() || undefined,
        tier,
        tags: parsedTags.length > 0 ? parsedTags : ['general'],
        notes: notes.trim() || undefined,
      });

      setStatusMessage({ type: 'success', text: res.message });
      setEmail('');
      setName('');
      setCompany('');
      setViewMode('list');
      await loadAudience();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to add contact.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBulkImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkEmails.trim()) {
      alert('Please paste or type at least one email address.');
      return;
    }
    setIsSubmitting(true);
    setStatusMessage(null);
    try {
      const parsedTags = bulkTags
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);

      const res = await createOrBulkImportSubscribers({
        bulk_emails: bulkEmails,
        tier: bulkTier,
        tags: parsedTags.length > 0 ? parsedTags : ['outreach'],
      });

      setStatusMessage({ type: 'success', text: res.message });
      setBulkEmails('');
      setViewMode('list');
      await loadAudience();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to bulk import contacts.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (sub: EmailSubscriber) => {
    try {
      await updateAudienceSubscriber(sub.id, { is_active: !sub.is_active });
      setSubscribers((prev) =>
        prev.map((s) => (s.id === sub.id ? { ...s, is_active: !s.is_active } : s))
      );
      setActiveCount((prev) => (sub.is_active ? prev - 1 : prev + 1));
    } catch (err: any) {
      alert(`Failed to update status: ${err.message || err}`);
    }
  };

  const handleDelete = async (id: number, emailStr: string) => {
    if (!confirm(`Are you sure you want to remove ${emailStr} from your audience?`)) return;
    try {
      await deleteAudienceSubscriber(id);
      setSubscribers((prev) => prev.filter((s) => s.id !== id));
      setTotalCount((prev) => prev - 1);
    } catch (err: any) {
      alert(`Failed to delete contact: ${err.message || err}`);
    }
  };

  const handleSyncClientContacts = async () => {
    setIsLoading(true);
    setStatusMessage(null);
    try {
      const res = await syncClientContactsToAudience();
      setStatusMessage({ type: 'success', text: res.message });
      await loadAudience();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to sync client contacts.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportEmails = () => {
    const activeEmails = subscribers
      .filter((s) => s.is_active)
      .map((s) => s.email)
      .join(', ');
    navigator.clipboard.writeText(activeEmails);
    alert(`Copied ${subscribers.filter((s) => s.is_active).length} active emails to clipboard!`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">
                  Marketing Audience &amp; Email List
                </h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-950 border border-amber-800 text-amber-300">
                  {activeCount} Active / {totalCount} Total
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Manage firm partners, client contacts, and prospective leads for release broadcasts &amp; email outreach
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSyncClientContacts}
              disabled={isLoading}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
              title="Automatically pulls emails from all active client profiles and team members"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Sync Client Contacts</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation & Action Bar */}
        <div className="px-5 py-3 border-b border-slate-800 bg-slate-950/30 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white bg-slate-800/60'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>All Contacts ({totalCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('add_single')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'add_single'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white bg-slate-800/60'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Add Single Contact</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('bulk_import')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'bulk_import'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white bg-slate-800/60'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Bulk Paste / Import</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportEmails}
              className="text-xs text-slate-300 hover:text-white flex items-center gap-1.5 px-2.5 py-1 bg-slate-800/80 rounded-lg border border-slate-700 font-medium cursor-pointer"
              title="Copy active email addresses to clipboard"
            >
              <Download className="w-3 h-3 text-amber-400" />
              <span>Copy Active Emails</span>
            </button>
          </div>
        </div>

        {/* Status Toast Notice */}
        {statusMessage && (
          <div
            className={`px-5 py-2.5 text-xs flex items-center justify-between border-b ${
              statusMessage.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                : 'bg-rose-950/60 border-rose-800 text-rose-300'
            }`}
          >
            <div className="flex items-center gap-2">
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400" />
              )}
              <span>{statusMessage.text}</span>
            </div>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-xs font-bold opacity-70 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        )}

        {/* Main Content Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* VIEW 1: Contacts Table & Filtering */}
          {viewMode === 'list' && (
            <div className="space-y-4">
              {/* Search & Filter Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                <div className="sm:col-span-2 relative">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name, email, or company..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <select
                    value={selectedTier}
                    onChange={(e) => setSelectedTier(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="">All Tiers</option>
                    <option value="firm_partner">Accounting Firms ({tierCounts.firm_partner || 0})</option>
                    <option value="client">Active Clients ({tierCounts.client || 0})</option>
                    <option value="lead">Prospect Leads ({tierCounts.lead || 0})</option>
                    <option value="subscriber">Newsletter ({tierCounts.subscriber || 0})</option>
                  </select>
                </div>

                <div>
                  <select
                    value={selectedTag}
                    onChange={(e) => setSelectedTag(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="">All Tags ({availableTags.length})</option>
                    {availableTags.map((t) => (
                      <option key={t} value={t}>
                        #{t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Contacts List Table */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl overflow-hidden">
                {isLoading ? (
                  <div className="py-16 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                    <span>Loading audience contacts...</span>
                  </div>
                ) : subscribers.length === 0 ? (
                  <div className="py-16 text-center text-slate-400 text-xs space-y-3">
                    <Users className="w-8 h-8 mx-auto text-slate-600 opacity-50" />
                    <p className="font-medium text-slate-300">No audience contacts found.</p>
                    <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                      Click <strong>"Sync Client Contacts"</strong> to automatically import your client team emails, or click <strong>"Bulk Paste / Import"</strong> to paste a list.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="bg-slate-900/90 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                        <tr>
                          <th className="py-3 px-4">Contact</th>
                          <th className="py-3 px-3">Company &amp; Role</th>
                          <th className="py-3 px-3">Tier</th>
                          <th className="py-3 px-3">Tags</th>
                          <th className="py-3 px-3">Status</th>
                          <th className="py-3 px-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-850">
                        {subscribers.map((sub) => (
                          <tr key={sub.id} className="hover:bg-slate-900/50 transition">
                            <td className="py-2.5 px-4">
                              <div className="font-semibold text-white">{sub.name || 'Unnamed'}</div>
                              <div className="text-[11px] text-amber-300/80 font-mono">{sub.email}</div>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="text-slate-200">{sub.company || '—'}</div>
                              <div className="text-[10px] text-slate-500">{sub.role_or_title || '—'}</div>
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize border ${
                                  sub.tier === 'firm_partner'
                                    ? 'bg-purple-950 text-purple-300 border-purple-800'
                                    : sub.tier === 'client'
                                    ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                                    : 'bg-blue-950 text-blue-300 border-blue-800'
                                }`}
                              >
                                {sub.tier.replace('_', ' ')}
                              </span>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="flex flex-wrap gap-1 max-w-[160px]">
                                {(sub.tags || []).slice(0, 2).map((t) => (
                                  <span
                                    key={t}
                                    className="text-[9px] bg-slate-900 text-slate-400 px-1.5 py-0.5 rounded border border-slate-800"
                                  >
                                    #{t}
                                  </span>
                                ))}
                                {(sub.tags || []).length > 2 && (
                                  <span className="text-[9px] text-slate-500">
                                    +{(sub.tags || []).length - 2}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-3">
                              <button
                                type="button"
                                onClick={() => handleToggleActive(sub)}
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 cursor-pointer transition ${
                                  sub.is_active
                                    ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800'
                                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${sub.is_active ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                                <span>{sub.is_active ? 'Active' : 'Paused'}</span>
                              </button>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleDelete(sub.id, sub.email)}
                                className="text-slate-500 hover:text-rose-400 p-1 rounded transition cursor-pointer"
                                title="Remove subscriber"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* VIEW 2: Add Single Contact */}
          {viewMode === 'add_single' && (
            <form onSubmit={handleCreateSingle} className="space-y-4 max-w-xl mx-auto py-2">
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
                <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <UserPlus className="w-4 h-4 text-amber-400" />
                  <span>Add Recipient to Marketing List</span>
                </h3>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="partner@accra-cpa.com"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Kofi Mensah"
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Company / Firm Name
                    </label>
                    <input
                      type="text"
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      placeholder="Mensah & Associates"
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Audience Tier
                    </label>
                    <select
                      value={tier}
                      onChange={(e: any) => setTier(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                    >
                      <option value="firm_partner">Accounting / Audit Firm Partner</option>
                      <option value="client">Active Client Contact</option>
                      <option value="lead">Prospect Lead</option>
                      <option value="subscriber">General Newsletter Subscriber</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Role / Title
                    </label>
                    <input
                      type="text"
                      value={roleOrTitle}
                      onChange={(e) => setRoleOrTitle(e.target.value)}
                      placeholder="Managing Partner or CFO"
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Tags (Comma-separated)
                  </label>
                  <input
                    type="text"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    placeholder="e.g. hospitality, zoho_books, accra"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold hover:bg-slate-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-amber-600/30 transition cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Add to Audience'}
                </button>
              </div>
            </form>
          )}

          {/* VIEW 3: Bulk Import */}
          {viewMode === 'bulk_import' && (
            <form onSubmit={handleBulkImport} className="space-y-4 max-w-xl mx-auto py-2">
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
                <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Upload className="w-4 h-4 text-amber-400" />
                  <span>Bulk Paste / Import Email Addresses</span>
                </h3>

                <p className="text-[11px] text-slate-400">
                  Paste emails separated by commas, semicolons, or line breaks. Existing duplicates will be preserved without creating errors.
                </p>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Paste Email List *
                  </label>
                  <textarea
                    rows={6}
                    required
                    value={bulkEmails}
                    onChange={(e) => setBulkEmails(e.target.value)}
                    placeholder="partner1@cpa-firm.com&#10;finance@hotelgroup.com&#10;controller@logistics.gh"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-amber-500 font-mono resize-none leading-relaxed"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Assign Tier
                    </label>
                    <select
                      value={bulkTier}
                      onChange={(e: any) => setBulkTier(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                    >
                      <option value="lead">Prospect Leads</option>
                      <option value="firm_partner">Accounting / Audit Firms</option>
                      <option value="client">Client Contacts</option>
                      <option value="subscriber">General Newsletter</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Assign Tags
                    </label>
                    <input
                      type="text"
                      value={bulkTags}
                      onChange={(e) => setBulkTags(e.target.value)}
                      placeholder="e.g. campaign_q3, accra_firms"
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold hover:bg-slate-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-amber-600/30 transition cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Importing...' : 'Import Email List'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
