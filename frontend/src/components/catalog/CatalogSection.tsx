import React, { useState } from 'react';
import { useAutomation } from '../../context/AutomationContext';
import { useClient } from '../../context/ClientContext';
import { formatCurrency } from '../../lib/utils';
import {
  Package,
  Search,
  RefreshCw,
  ArrowRight,
  Users,
} from 'lucide-react';

export const CatalogSection: React.FC = () => {
  const { catalog, refreshAll, isLoading, setActiveTab } = useAutomation();
  const { currentClient } = useClient();
  const [search, setSearch] = useState('');

  const items = catalog?.items || [];

  const filteredItems = items.filter(
    (i) =>
      i.name?.toLowerCase().includes(search.toLowerCase()) ||
      i.description?.toLowerCase().includes(search.toLowerCase()) ||
      i.item_id?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header Banner */}
      <div className="glass-panel rounded-2xl p-5 shadow-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-bold text-white tracking-tight">
              Accounting Master Item &amp; Pricing Catalog
            </h2>
            <span className="text-[10px] font-mono font-bold text-sky-400 bg-sky-950/80 border border-sky-500/30 px-2 py-0.5 rounded-full">
              Zoho Books API Sync
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
            Standard pricing rates, SKU items, and accounting descriptions used by Gemini Vision OCR to reconcile line-items and classify invoices automatically.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={() => refreshAll()}
            disabled={isLoading}
            className="flex items-center gap-2 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg shadow-sky-600/25 transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Sync Catalog from Zoho</span>
          </button>
        </div>
      </div>

      {/* Cross-Link Notice: Distinguishing Catalog vs Contacts & Team */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
            <Users className="w-3.5 h-3.5" />
          </div>
          <div className="text-xs">
            <span className="text-slate-300 font-medium">Looking for Client Stakeholders &amp; Team Invitations?</span>
            <p className="text-slate-500 text-[11px]">
              Manage portal access, 72-hour magic links, and internal staff roles in the dedicated Contacts &amp; Team directory.
            </p>
          </div>
        </div>

        <button
          onClick={() => setActiveTab('contacts')}
          className="flex items-center gap-1.5 text-xs font-bold text-indigo-400 hover:text-indigo-300 hover:underline shrink-0 cursor-pointer self-start sm:self-center"
        >
          <span>Open Contacts &amp; Team</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800/80 rounded-xl p-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-white px-2">
            Active Catalog Items
          </span>
          <span className="text-[11px] font-mono font-bold text-sky-400 bg-sky-950 border border-sky-500/30 px-2 py-0.5 rounded-md">
            {filteredItems.length} of {items.length} SKUs
          </span>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search items, SKUs, or descriptions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 sm:w-80"
          />
        </div>
      </div>

      {/* Catalog Table */}
      <div className="glass-panel rounded-2xl overflow-hidden shadow-xl border border-slate-800">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3 px-4">Item / SKU Name</th>
                <th className="py-3 px-4">Description &amp; Line-Item Mapping</th>
                <th className="py-3 px-4">Zoho Item ID</th>
                <th className="py-3 px-4 text-right">Standard Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300 font-medium">
              {filteredItems.length > 0 ? (
                filteredItems.map((item) => (
                  <tr key={item.item_id} className="hover:bg-slate-850/50 transition-colors">
                    <td className="py-3 px-4 font-bold text-white">{item.name}</td>
                    <td className="py-3 px-4 text-slate-400">{item.description || '—'}</td>
                    <td className="py-3 px-4 font-mono text-sky-400 text-[11px]">{item.item_id}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                      {formatCurrency(item.rate)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-500 text-xs">
                    {search ? (
                      <div>
                        No items matching &ldquo;{search}&rdquo;.
                        <button
                          onClick={() => setSearch('')}
                          className="ml-2 text-sky-400 hover:underline cursor-pointer"
                        >
                          Clear search
                        </button>
                      </div>
                    ) : (
                      <div>
                        No items in catalog. Click &ldquo;Sync Catalog from Zoho&rdquo; to populate master items.
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
