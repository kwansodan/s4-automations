import React, { useState } from 'react';
import { useAutomation } from '../../context/AutomationContext';
import { useClient } from '../../context/ClientContext';
import { formatCurrency } from '../../lib/utils';
import {
  Package,
  UserCheck,
  Search,
  RefreshCw,
  Layers,
  Building,
  CheckCircle2,
  ExternalLink,
  BookOpen,
} from 'lucide-react';

export const CatalogSection: React.FC = () => {
  const { catalog, refreshAll, isLoading } = useAutomation();
  const { currentClient } = useClient();
  const [tab, setTab] = useState<'items' | 'contacts'>('items');
  const [search, setSearch] = useState('');

  const items = catalog?.items || [];
  const contacts = catalog?.contacts || [];

  const filteredItems = items.filter(
    (i) =>
      i.name?.toLowerCase().includes(search.toLowerCase()) ||
      i.description?.toLowerCase().includes(search.toLowerCase()) ||
      i.item_id?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredContacts = contacts.filter(
    (c) =>
      c.contact_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.company_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.contact_id?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header Banner */}
      <div className="glass-panel rounded-2xl p-5 shadow-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-bold text-white tracking-tight">
              Accounting Master Item &amp; Contact Catalog
            </h2>
            <span className="text-[10px] font-mono font-bold text-sky-400 bg-sky-950/80 border border-sky-500/30 px-2 py-0.5 rounded-full">
              Zoho Books API Sync
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Pricing catalog and customer directories used by Gemini Vision OCR to reconcile line-items and match contacts automatically.
          </p>
        </div>

        <button
          onClick={() => refreshAll()}
          disabled={isLoading}
          className="flex items-center gap-2 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg shadow-sky-600/25 transition cursor-pointer disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Sync Accounting Catalog</span>
        </button>
      </div>

      {/* Tabs & Search Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800/80 rounded-xl p-2">
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setTab('items')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition cursor-pointer ${
              tab === 'items' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Items &amp; Standard Rates ({items.length})</span>
          </button>
          <button
            onClick={() => setTab('contacts')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition cursor-pointer ${
              tab === 'contacts' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Contacts &amp; Customers ({contacts.length})</span>
          </button>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search items, rates, or customer names..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 sm:w-72"
          />
        </div>
      </div>

      {/* Catalog Table */}
      <div className="glass-panel rounded-2xl overflow-hidden shadow-xl border border-slate-800">
        <div className="overflow-x-auto custom-scrollbar">
          {tab === 'items' ? (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-3 px-4">Item Name</th>
                  <th className="py-3 px-4">Description</th>
                  <th className="py-3 px-4">Accounting Item ID</th>
                  <th className="py-3 px-4 text-right">Standard Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300 font-medium">
                {filteredItems.length > 0 ? (
                  filteredItems.map((item) => (
                    <tr key={item.item_id} className="hover:bg-slate-850/50 transition-colors">
                      <td className="py-3 px-4 font-bold text-white">{item.name}</td>
                      <td className="py-3 px-4 text-slate-400">{item.description}</td>
                      <td className="py-3 px-4 font-mono text-sky-400 text-[11px]">{item.item_id}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                        {formatCurrency(item.rate)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-slate-500 text-xs">
                      No items matching search query. Click "Sync Accounting Catalog" to pull master items.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-3 px-4">Contact / Hotel Name</th>
                  <th className="py-3 px-4">Company Name</th>
                  <th className="py-3 px-4">Zoho Contact ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300 font-medium">
                {filteredContacts.length > 0 ? (
                  filteredContacts.map((contact) => (
                    <tr key={contact.contact_id} className="hover:bg-slate-850/50 transition-colors">
                      <td className="py-3 px-4 font-bold text-white">{contact.contact_name}</td>
                      <td className="py-3 px-4 text-slate-300">{contact.company_name}</td>
                      <td className="py-3 px-4 font-mono text-sky-400 text-[11px]">{contact.contact_id}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="py-12 text-center text-slate-500 text-xs">
                      No contacts matching search query.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
  );
};
