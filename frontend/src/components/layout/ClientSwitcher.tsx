import React, { useState, useRef, useEffect } from 'react';
import { useClient } from '../../context/ClientContext';
import { useAuth } from '../../context/AuthContext';
import { useAutomation } from '../../context/AutomationContext';
import { ChevronDown, Search, Plus, Check, Building2, X, ArrowRightLeft, Sparkles } from 'lucide-react';
import type { ClientProfile } from '../../types/client';

export const ClientSwitcher: React.FC = () => {
  const {
    currentClient,
    clients,
    setClient,
    addClient,
    isSwitcherOpen,
    setIsSwitcherOpen,
    setIsWizardOpen,
    isIndividualBusiness,
    isAccountingFirm,
    activeOrganization,
  } = useClient();
  const { user, switchOrganization } = useAuth();
  const { setActiveTab } = useAutomation();

  const [search, setSearch] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Add Client Form State
  const [newName, setNewName] = useState('');
  const [newIndustry, setNewIndustry] = useState('');
  const [newIcon, setNewIcon] = useState('🏢');
  const [newDesc, setNewDesc] = useState('');
  const [newStatus, setNewStatus] = useState<'live' | 'dev' | 'pending'>('dev');

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsSwitcherOpen(false);
      }
    };
    if (isSwitcherOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isSwitcherOpen, setIsSwitcherOpen]);

  const filteredClients = clients.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.industry.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelectClient = (client: ClientProfile) => {
    setClient(client.id);
    setActiveTab('workspace');
    setIsSwitcherOpen(false);
  };

  const handleCreateClient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    addClient({
      name: newName.trim(),
      industry: newIndustry.trim() || 'Financial & Professional Services',
      icon: newIcon || '🏢',
      status: newStatus,
      statusText: newStatus === 'live' ? 'Production Live' : newStatus === 'dev' ? 'In Development' : 'Setup Pending',
      desc: newDesc.trim() || 'Custom financial workflow automation pipeline.',
    });

    setIsAddModalOpen(false);
    setNewName('');
    setNewIndustry('');
    setNewDesc('');
    setActiveTab('workspace');
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Pill */}
      <button
        onClick={() => setIsSwitcherOpen(!isSwitcherOpen)}
        className="flex items-center gap-2.5 bg-white hover:bg-slate-50 border border-[#E2E8F0] hover:border-sky-300 rounded-xl px-3 py-1.5 transition-all shadow-sm cursor-pointer group"
      >
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-lg ${
          isIndividualBusiness ? 'bg-sky-50 border border-sky-200' : 'bg-slate-100 border border-slate-200'
        }`}>
          {currentClient?.icon || (isIndividualBusiness ? '🧺' : '🏢')}
        </div>
        <div className="text-left">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-900 group-hover:text-[#0284C7] transition-colors">
              {currentClient?.name?.split('(')[0].trim() || 'Select Client'}
            </span>
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                currentClient?.status === 'live'
                  ? 'bg-emerald-500 shadow-[0_0_6px_#10B981]'
                  : currentClient?.status === 'dev'
                  ? 'bg-amber-400'
                  : 'bg-slate-300'
              }`}
            />
          </div>
          <span className="text-[10px] text-slate-500 block max-w-[140px] truncate">
            {isIndividualBusiness ? 'Direct Company Account' : (currentClient?.industry?.split('&')[0].trim() || 'Accounting Portfolio')}
          </span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition-transform duration-200 ${
            isSwitcherOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {isSwitcherOpen && (
        <div className="absolute left-0 top-full mt-2 w-80 bg-white border border-[#E2E8F0] rounded-xl shadow-xl p-2.5 z-50 animate-in fade-in zoom-in-95 duration-150">
          {isAccountingFirm ? (
            /* Accounting Firm Practice Portfolio View */
            <>
              <div className="flex items-center justify-between px-2 py-1 mb-2 border-b border-[#E2E8F0]">
                <span className="text-xs font-bold text-slate-900">Accounting Clients</span>
                <span className="text-[10px] font-mono font-bold text-[#0284C7] bg-[#F0F9FF] px-1.5 py-0.5 rounded border border-[#BAE6FD]">
                  {clients.length} Registered
                </span>
              </div>

              {/* Search Box */}
              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search clients..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-slate-50 border border-[#E2E8F0] rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#0284C7] focus:bg-white transition"
                />
              </div>

              {/* Client List */}
              <div className="max-h-60 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                {filteredClients.map((client) => {
                  const isSelected = client.id === currentClient?.id;
                  return (
                    <button
                      key={client.id}
                      onClick={() => handleSelectClient(client)}
                      className={`w-full flex items-center justify-between p-2 rounded-lg text-left transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[#F0F9FF] border border-[#BAE6FD] text-[#0284C7]'
                          : 'hover:bg-slate-50 text-slate-700 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-xl shrink-0">{client.icon}</span>
                        <div className="truncate">
                          <p className="text-xs font-bold truncate">{client.name}</p>
                          <p className="text-[10px] text-slate-500 truncate">{client.industry}</p>
                        </div>
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-[#0284C7] shrink-0 ml-2" />}
                    </button>
                  );
                })}
              </div>

              {/* Setup Wizard & Register Client Trigger */}
              <div className="mt-2 pt-2 border-t border-[#E2E8F0] space-y-1">
                <button
                  onClick={() => {
                    setIsSwitcherOpen(false);
                    setIsWizardOpen(true);
                  }}
                  className="w-full flex items-center justify-center gap-1.5 text-xs font-bold text-white bg-[#0284C7] hover:bg-[#0EA5E9] py-2 rounded-lg shadow-sm transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Client Setup Wizard</span>
                </button>
              </div>
            </>
          ) : (
            /* Direct Individual Business Account View */
            <div className="space-y-3">
              <div className="p-3 bg-slate-50 border border-[#E2E8F0] rounded-xl space-y-2">
                <div className="flex items-center gap-2.5">
                  <span className="text-2xl">{currentClient?.icon || '🧺'}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 truncate">{currentClient?.name}</p>
                    <p className="text-[10px] text-[#0284C7] font-mono">Direct Business Workspace</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#E2E8F0] text-[11px]">
                  <div className="bg-white p-2 rounded-lg border border-[#E2E8F0]">
                    <span className="text-slate-400 text-[9px] block uppercase font-mono">Pipelines</span>
                    <span className="font-bold text-slate-900 font-mono">{currentClient?.pipelines?.length || 0} active</span>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-[#E2E8F0]">
                    <span className="text-slate-400 text-[9px] block uppercase font-mono">Platform</span>
                    <span className="font-bold text-[#059669] capitalize">{currentClient?.accounting_software?.replace('_', ' ') || 'Zoho'}</span>
                  </div>
                </div>
              </div>

              {/* Switch Organization Option (if user belongs to multiple organizations) */}
              {user?.organizations && user.organizations.length > 1 && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider font-mono block px-1">
                    Other Accessible Workspaces
                  </span>
                  {user.organizations
                    .filter((org) => org.id !== (activeOrganization?.id || 'anr_group_direct'))
                    .map((org) => (
                      <button
                        key={org.id}
                        onClick={async () => {
                          await switchOrganization(org.id);
                          setIsSwitcherOpen(false);
                        }}
                        className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-50 hover:bg-slate-100 border border-[#E2E8F0] text-left transition cursor-pointer group"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-base shrink-0">{org.icon || '🏛️'}</span>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 group-hover:text-[#0284C7] truncate">{org.name}</p>
                            <p className="text-[9px] text-slate-500 font-mono">
                              {org.org_type === 'ACCOUNTING_FIRM' ? 'Accounting Firm Practice' : 'Direct Business'}
                            </p>
                          </div>
                        </div>
                        <ArrowRightLeft className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#0284C7] shrink-0" />
                      </button>
                    ))}
                </div>
              )}

              <button
                onClick={() => {
                  setIsSwitcherOpen(false);
                  setIsWizardOpen(true);
                }}
                className="w-full flex items-center justify-center gap-1.5 text-xs font-bold text-white bg-[#0284C7] hover:bg-[#0EA5E9] py-2 rounded-lg shadow-sm transition cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Configure Ingestion Streams</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Register Client Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-sky-500/30 rounded-2xl p-6 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-sky-400" />
                <h2 className="text-base font-bold text-white">Register Accounting Client</h2>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateClient} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Business / Organization Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apex Logistics Ghana"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Industry</label>
                  <input
                    type="text"
                    placeholder="e.g. Supply Chain"
                    value={newIndustry}
                    onChange={(e) => setNewIndustry(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Icon / Emoji</label>
                  <input
                    type="text"
                    value={newIcon}
                    onChange={(e) => setNewIcon(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-center text-white focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Automation Scope</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Waybill OCR vision ingestion and Zoho Books vendor bill reconciliation."
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Status</label>
                <select
                  value={newStatus}
                  onChange={(e: any) => setNewStatus(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                >
                  <option value="dev">⚡ In Development</option>
                  <option value="live">● Production Live</option>
                  <option value="pending">⏳ Setup Pending</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 rounded-lg transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition shadow-lg shadow-sky-600/30 cursor-pointer"
                >
                  Create Client Workspace
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
