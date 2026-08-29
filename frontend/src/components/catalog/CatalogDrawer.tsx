import React, { useState } from 'react';
import { useAutomation } from '../../context/AutomationContext';
import { Layers, Search, RefreshCw, UserCheck, Package } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';

export const CatalogDrawer: React.FC = () => {
  const { catalog, refreshAll, isLoading } = useAutomation();
  const [tab, setTab] = useState<'items' | 'contacts'>('items');
  const [search, setSearch] = useState('');

  const items = catalog?.items || [];
  const contacts = catalog?.contacts || [];

  const filteredItems = items.filter(
    (i) =>
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      i.description.toLowerCase().includes(search.toLowerCase()) ||
      i.item_id.toLowerCase().includes(search.toLowerCase())
  );

  const filteredContacts = contacts.filter(
    (c) =>
      c.contact_name.toLowerCase().includes(search.toLowerCase()) ||
      c.company_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      
      {/* Header */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl backdrop-blur-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-bold text-white tracking-tight">Zoho Books Master Item & Contact Catalog</h2>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Synchronized pricing rates and contact records used by Gemini Vision OCR to reconcile line-items.
          </p>
        </div>

        <button
          onClick={() => refreshAll()}
          disabled={isLoading}
          className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold px-3 py-1.5 rounded-xl transition cursor-pointer shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-sky-400' : ''}`} />
          <span>Sync Zoho Books Catalog</span>
        </button>
      </div>

      {/* Tabs & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800/80 rounded-xl p-2">
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setTab('items')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition cursor-pointer ${
              tab === 'items' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Items & Rates ({items.length})</span>
          </button>
          <button
            onClick={() => setTab('contacts')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition cursor-pointer ${
              tab === 'contacts' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Contacts & Hotels ({contacts.length})</span>
          </button>
        </div>

        <input
          type="text"
          placeholder="Search items, rates, or contact names..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 sm:w-72"
        />
      </div>

      {/* Content Table */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-xl backdrop-blur-xl">
        <div className="overflow-x-auto custom-scrollbar">
          {tab === 'items' ? (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-3 px-4">Item Name</th>
                  <th className="py-3 px-4">Description</th>
                  <th className="py-3 px-4">Zoho Item ID</th>
                  <th className="py-3 px-4 text-right">Standard Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {filteredItems.map((item) => (
                  <tr key={item.item_id} className="hover:bg-slate-850/50 transition-colors">
                    <td className="py-3 px-4 font-bold text-white">{item.name}</td>
                    <td className="py-3 px-4 text-slate-400">{item.description}</td>
                    <td className="py-3 px-4 font-mono text-sky-400 text-[11px]">{item.item_id}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                      {formatCurrency(item.rate)}
                    </td>
                  </tr>
                ))}
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
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {filteredContacts.map((contact) => (
                  <tr key={contact.contact_id} className="hover:bg-slate-850/50 transition-colors">
                    <td className="py-3 px-4 font-bold text-white">{contact.contact_name}</td>
                    <td className="py-3 px-4 text-slate-300">{contact.company_name}</td>
                    <td className="py-3 px-4 font-mono text-sky-400 text-[11px]">{contact.contact_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
  );
};
