import React, { useEffect, useState, useCallback } from 'react';
import {
  Building2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
} from 'lucide-react';
import {
  addPlatformSuperAdmin,
  fetchAdminUsers,
  fetchPlatformSuperAdmins,
  revokePlatformSuperAdmin,
  updateAdminMembership,
} from '../../lib/api';
import type { CrossTenantUser, PlatformSuperAdmin } from '../../types/admin';

export const AdminUsersRbacTab: React.FC = () => {
  const [subView, setSubView] = useState<'directory' | 'super_admins'>('directory');

  // Users directory
  const [users, setUsers] = useState<CrossTenantUser[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  // Super-Admin allowlist
  const [superAdmins, setSuperAdmins] = useState<PlatformSuperAdmin[]>([]);
  const [isLoadingAdmins, setIsLoadingAdmins] = useState(true);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminNotes, setNewAdminNotes] = useState('');
  const [isAddingAdmin, setIsAddingAdmin] = useState(false);

  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadDirectory = useCallback(async () => {
    setIsLoadingUsers(true);
    setErrorMsg('');
    try {
      const res = await fetchAdminUsers({
        search: search.trim() || undefined,
        role: roleFilter || undefined,
      });
      setUsers(res.users || []);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load user directory.');
    } finally {
      setIsLoadingUsers(false);
    }
  }, [search, roleFilter]);

  const loadSuperAdmins = useCallback(async () => {
    setIsLoadingAdmins(true);
    try {
      const res = await fetchPlatformSuperAdmins();
      setSuperAdmins(res.super_admins || []);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load super-admin allowlist.');
    } finally {
      setIsLoadingAdmins(false);
    }
  }, []);

  useEffect(() => {
    loadDirectory();
    loadSuperAdmins();
  }, [loadDirectory, loadSuperAdmins]);

  const handleRoleChange = async (membershipId: string, nextRole: string) => {
    setStatusMsg('');
    setErrorMsg('');
    try {
      await updateAdminMembership(membershipId, { role: nextRole });
      setStatusMsg(`Updated membership role to ${nextRole}.`);
      await loadDirectory();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed updating membership role.');
    }
  };

  const handleAddSuperAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminEmail.trim()) return;
    setIsAddingAdmin(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      await addPlatformSuperAdmin({
        email: newAdminEmail.trim(),
        name: newAdminName.trim() || undefined,
        notes: newAdminNotes.trim() || undefined,
      });
      setStatusMsg(`Added ${newAdminEmail.trim()} to Platform Super-Admin allowlist.`);
      setNewAdminEmail('');
      setNewAdminName('');
      setNewAdminNotes('');
      await Promise.all([loadSuperAdmins(), loadDirectory()]);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed adding platform super-admin.');
    } finally {
      setIsAddingAdmin(false);
    }
  };

  const handleRevokeSuperAdmin = async (admin: PlatformSuperAdmin) => {
    if (!window.confirm(`Revoke Platform Super-Admin access for ${admin.email}?`)) return;
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await revokePlatformSuperAdmin(admin.id);
      setStatusMsg(res.message);
      await Promise.all([loadSuperAdmins(), loadDirectory()]);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed revoking super-admin.');
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Header & View Switcher */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shadow-xs">
        <div>
          <h2 className="text-base font-bold text-[#0F172A]">Platform Users &amp; RBAC Controls</h2>
          <p className="text-xs text-[#64748B] mt-0.5">
            Inspect tenant memberships across organizations and manage the Platform Super-Admin allowlist.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setSubView('directory')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
              subView === 'directory'
                ? 'bg-[#F0F9FF] text-[#0284C7] border-[#BAE6FD]'
                : 'bg-white text-[#64748B] border-[#E2E8F0] hover:bg-slate-50'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Cross-Tenant Directory ({users.length})
          </button>
          <button
            onClick={() => setSubView('super_admins')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
              subView === 'super_admins'
                ? 'bg-[#F0F9FF] text-[#0284C7] border-[#BAE6FD]'
                : 'bg-white text-[#64748B] border-[#E2E8F0] hover:bg-slate-50'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Super-Admin Allowlist ({superAdmins.filter((a) => a.is_active).length})
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="px-4 py-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {subView === 'directory' ? (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by user email or display name..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
              />
            </div>

            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-semibold text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
            >
              <option value="">All Roles</option>
              <option value="ADMIN">ADMIN (Org Admin)</option>
              <option value="BOOKKEEPER">BOOKKEEPER</option>
              <option value="AUDITOR">AUDITOR</option>
              <option value="VIEWER">VIEWER</option>
            </select>

            <button
              onClick={loadDirectory}
              disabled={isLoadingUsers}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-[#E2E8F0] text-xs font-semibold text-[#0F172A] cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingUsers ? 'animate-spin' : ''}`} />
              Filter
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E2E8F0] text-[11px] font-bold uppercase tracking-wider text-[#64748B] font-mono">
                  <th className="py-2.5 pr-4">User</th>
                  <th className="py-2.5 pr-4">Scope Badge</th>
                  <th className="py-2.5 pr-4">Organization Memberships &amp; Role Assignment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] text-xs">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-[#F8FAFC] align-top">
                    <td className="py-3 pr-4">
                      <div className="font-semibold text-[#0F172A]">{u.name || 'Unnamed User'}</div>
                      <div className="text-[11px] font-mono text-[#64748B]">{u.email}</div>
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      {u.is_platform_admin ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-50 text-[#0284C7] border border-[#BAE6FD] text-[11px] font-bold">
                          <ShieldCheck className="w-3 h-3" />
                          Platform Super-Admin
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-[#E2E8F0] text-[11px] font-medium">
                          <UserCog className="w-3 h-3" />
                          Tenant User ({u.role})
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="space-y-1.5">
                        {(u.memberships || []).map((m) => (
                          <div
                            key={m.id}
                            className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <Building2 className="w-3.5 h-3.5 text-[#64748B] shrink-0" />
                              <span className="font-medium text-[#0F172A] truncate">
                                {m.organization_name}
                              </span>
                              {m.is_primary && (
                                <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-white border border-[#E2E8F0] text-[#0284C7]">
                                  Primary
                                </span>
                              )}
                            </div>
                            <select
                              value={m.role}
                              onChange={(e) => handleRoleChange(m.id, e.target.value)}
                              className="px-2 py-1 rounded-md bg-white border border-[#E2E8F0] text-[11px] font-bold text-[#0F172A] focus:outline-none focus:border-[#0284C7] cursor-pointer"
                            >
                              <option value="ADMIN">ADMIN</option>
                              <option value="BOOKKEEPER">BOOKKEEPER</option>
                              <option value="AUDITOR">AUDITOR</option>
                              <option value="VIEWER">VIEWER</option>
                            </select>
                          </div>
                        ))}
                        {(!u.memberships || u.memberships.length === 0) && (
                          <span className="text-[11px] text-[#64748B] italic">No memberships assigned</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && !isLoadingUsers && (
                  <tr>
                    <td colSpan={3} className="py-8 text-center text-xs text-[#64748B]">
                      No users matched your filter criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Add Platform Super-Admin Form */}
          <form
            onSubmit={handleAddSuperAdmin}
            className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs space-y-4 h-fit"
          >
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-[#0284C7]" />
              <h3 className="text-sm font-bold text-[#0F172A]">Grant Super-Admin Access</h3>
            </div>
            <p className="text-xs text-[#64748B]">
              Platform Super-Admins can access this /admin console, manage tenants, edit system configuration, and enter View-as-Tenant mode.
            </p>

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-1">Email *</label>
              <input
                type="email"
                required
                value={newAdminEmail}
                onChange={(e) => setNewAdminEmail(e.target.value)}
                placeholder="operator@s4.com"
                className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-xs text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-1">Operator Name</label>
              <input
                type="text"
                value={newAdminName}
                onChange={(e) => setNewAdminName(e.target.value)}
                placeholder="Full Name"
                className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-xs text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-1">Notes</label>
              <input
                type="text"
                value={newAdminNotes}
                onChange={(e) => setNewAdminNotes(e.target.value)}
                placeholder="e.g., SRE on-call or Billing Admin"
                className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-xs text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
              />
            </div>

            <button
              type="submit"
              disabled={isAddingAdmin}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              {isAddingAdmin ? 'Authorizing...' : 'Authorize Super-Admin'}
            </button>
          </form>

          {/* Allowlist Table */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#0F172A]">Authorized Platform Operators</h3>
              <button
                onClick={loadSuperAdmins}
                disabled={isLoadingAdmins}
                className="p-1.5 rounded-lg border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAdmins ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E2E8F0] text-[11px] font-bold uppercase tracking-wider text-[#64748B] font-mono">
                    <th className="py-2 pr-4">Operator</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Added By</th>
                    <th className="py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] text-xs">
                  {superAdmins.map((sa) => (
                    <tr key={sa.id} className="hover:bg-[#F8FAFC]">
                      <td className="py-3 pr-4">
                        <div className="font-semibold text-[#0F172A] flex items-center gap-1.5">
                          {sa.name || sa.email}
                          {sa.is_root && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-mono font-bold">
                              ROOT
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono text-[#64748B]">{sa.email}</div>
                        {sa.notes && <div className="text-[11px] text-[#64748B] mt-0.5">{sa.notes}</div>}
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                            sa.is_active
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {sa.is_active ? 'ACTIVE' : 'REVOKED'}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-[11px] font-mono text-[#64748B]">
                        {sa.added_by || 'env/bootstrap'}
                      </td>
                      <td className="py-3 text-right">
                        {!sa.is_root && sa.is_active && (
                          <button
                            onClick={() => handleRevokeSuperAdmin(sa)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[11px] font-semibold cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
