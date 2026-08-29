import React, { useState, useRef, useEffect } from 'react';
import { useClient } from '../../context/ClientContext';
import { useAutomation } from '../../context/AutomationContext';
import { ChevronDown, Search, Plus, Check, Building2, X } from 'lucide-react';
import type { ClientProfile } from '../../types/client';

export const ClientSwitcher: React.FC = () => {
  const { currentClient, clients, setClient, addClient, isSwitcherOpen, setIsSwitcherOpen } = useClient();
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
    if (client.id === 'anr_group') {
      setActiveTab('dashboard');
    } else {
      setActiveTab('workspace');
    }
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
        className="flex items-center gap-2.5 bg-slate-900/90 hover:bg-slate-850 border border-slate-700/80 hover:border-sky-500/50 rounded-xl px-3 py-1.5 transition-all shadow-md cursor-pointer group"
      >
        <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-lg">
          {currentClient.icon}
        </div>
        <div className="text-left">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-white group-hover:text-sky-300 transition-colors">
              {currentClient.name.split('(')[0].trim()}
            </span>
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                currentClient.status === 'live'
                  ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                  : currentClient.status === 'dev'
                  ? 'bg-sky-400 shadow-[0_0_8px_#38bdf8]'
                  : 'bg-amber-400'
              }`}
            />
          </div>
          <span className="text-[10px] text-slate-400 block max-w-[140px] truncate">
            {currentClient.industry.split('&')[0].trim()}
          </span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 group-hover:text-white transition-transform duration-200 ${
            isSwitcherOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {isSwitcherOpen && (
        <div className="absolute left-0 top-full mt-2 w-80 bg-slate-900/95 border border-sky-500/30 rounded-xl shadow-2xl p-2.5 z-50 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between px-2 py-1 mb-2 border-b border-slate-800">
            <span className="text-xs font-bold text-slate-300">Accounting Clients</span>
            <span className="text-[10px] font-mono text-sky-400 bg-sky-950 px-1.5 py-0.5 rounded border border-sky-500/20">
              {clients.length} Registered
            </span>
          </div>

          {/* Search Box */}
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search clients..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          {/* Client List */}
          <div className="max-h-60 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
            {filteredClients.map((client) => {
              const isSelected = client.id === currentClient.id;
              return (
                <button
                  key={client.id}
                  onClick={() => handleSelectClient(client)}
                  className={`w-full flex items-center justify-between p-2 rounded-lg text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-sky-500/20 border border-sky-500/40 text-white'
                      : 'hover:bg-slate-800/80 text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-xl shrink-0">{client.icon}</span>
                    <div className="truncate">
                      <p className="text-xs font-bold truncate">{client.name}</p>
                      <p className="text-[10px] text-slate-400 truncate">{client.industry}</p>
                    </div>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-sky-400 shrink-0 ml-2" />}
                </button>
              );
            })}
          </div>

          {/* Register Client Trigger */}
          <button
            onClick={() => {
              setIsSwitcherOpen(false);
              setIsAddModalOpen(true);
            }}
            className="w-full mt-2 pt-2 border-t border-slate-800 flex items-center justify-center gap-1.5 text-xs font-semibold text-sky-400 hover:text-sky-300 py-1.5 rounded-lg hover:bg-sky-500/10 transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Accounting Client</span>
          </button>
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
