import React, { useState, useEffect, useMemo } from 'react';
import { fetchPublicChangelog, ChangelogEntryItem } from '../../lib/api';
import { useAutomation } from '../../context/AutomationContext';
import {
  BookOpen,
  Sparkles,
  RefreshCw,
  Search,
  Tag,
  Calendar,
  Layers,
  CheckCircle2,
  Share2,
  Filter,
  ShieldCheck,
  ChevronRight,
  ArrowUpRight,
} from 'lucide-react';

export const ChangelogSection: React.FC = () => {
  const { setActiveTab } = useAutomation();
  const [items, setItems] = useState<ChangelogEntryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  const loadChangelog = async () => {
    setIsLoading(true);
    try {
      const data = await fetchPublicChangelog(50);
      setItems(data || []);
    } catch (err) {
      console.error('Failed to load changelog:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadChangelog();
  }, []);

  // Extract unique categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => {
      if (item.category) set.add(item.category);
    });
    return ['ALL', ...Array.from(set)];
  }, [items]);

  // Filtered items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesCategory =
        selectedCategory === 'ALL' || item.category === selectedCategory;
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !query ||
        item.title.toLowerCase().includes(query) ||
        item.summary.toLowerCase().includes(query) ||
        item.version.toLowerCase().includes(query) ||
        (item.changelog_entry && item.changelog_entry.toLowerCase().includes(query));
      return matchesCategory && matchesSearch;
    });
  }, [items, selectedCategory, searchQuery]);

  const latestVersion = items[0]?.version || '2.0.0';

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-emerald-950/70 via-slate-900 to-sky-950/70 border border-emerald-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-500/10">
                <BookOpen className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-2xl font-black text-white tracking-tight">
                    What's New in S4 Automations
                  </h1>
                  <span className="bg-emerald-950 text-emerald-300 border border-emerald-500/40 text-xs font-mono font-bold px-2.5 py-0.5 rounded-full shadow-sm">
                    Current: v{latestVersion}
                  </span>
                </div>
              </div>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
              Explore the latest deployed features, workflow automations, accounting integrations, and system enhancements across the S4 platform.
            </p>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={loadChangelog}
              disabled={isLoading}
              className="flex items-center gap-1.5 bg-slate-900/90 hover:bg-slate-800 text-slate-200 text-xs font-bold py-2.5 px-3.5 rounded-xl border border-slate-800 transition cursor-pointer"
              title="Refresh changelog entries"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>

            <button
              onClick={() => setActiveTab('social')}
              className="flex items-center gap-1.5 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow-lg shadow-sky-600/20 transition cursor-pointer"
              title="Open the AI Multi-Channel Release Broadcaster"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Release Broadcaster</span>
              <ArrowUpRight className="w-3.5 h-3.5 opacity-80" />
            </button>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl backdrop-blur-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Category Filter Pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`text-xs font-bold px-3 py-1.5 rounded-xl transition cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'bg-slate-950/80 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800'
              }`}
            >
              {cat === 'ALL' ? 'All Updates' : cat.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative min-w-[240px]">
          <Search className="w-3.5 h-3.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search releases & updates..."
            className="w-full bg-slate-950/80 border border-slate-800 rounded-xl pl-9 pr-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
          />
        </div>
      </div>

      {/* Changelog Timeline Entries */}
      {isLoading ? (
        <div className="p-16 text-center text-slate-400 bg-slate-900/40 border border-slate-800 rounded-2xl flex flex-col items-center justify-center gap-2">
          <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
          <p className="text-xs font-medium">Loading release notes and changelog...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="p-16 text-center text-slate-400 bg-slate-900/40 border border-slate-800 rounded-2xl flex flex-col items-center justify-center gap-3">
          <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-slate-500">
            <BookOpen className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-white">No Releases Found</h3>
          <p className="text-xs text-slate-400 max-w-sm">
            {searchQuery
              ? `No release notes match "${searchQuery}". Try adjusting your search query.`
              : 'No published release notes found in this category.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {filteredItems.map((item, index) => {
            const isLatest = index === 0 && !searchQuery && selectedCategory === 'ALL';
            const formattedDate = item.published_at
              ? new Date(item.published_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })
              : 'Recently Released';

            return (
              <div
                key={item.id}
                className={`bg-slate-900/90 border rounded-2xl p-6 shadow-xl backdrop-blur-xl transition relative ${
                  isLatest
                    ? 'border-emerald-500/50 bg-gradient-to-b from-emerald-950/20 to-slate-900/90 ring-1 ring-emerald-500/20'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Release Card Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-mono text-xs font-extrabold text-emerald-300 bg-emerald-950/90 px-3 py-1 rounded-xl border border-emerald-500/40 shadow-sm">
                      v{item.version}
                    </span>
                    {isLatest && (
                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                        <Sparkles className="w-2.5 h-2.5" />
                        Latest Release
                      </span>
                    )}
                    <span className="text-[10px] font-bold text-sky-300 bg-sky-950/80 px-2.5 py-0.5 rounded-full border border-sky-500/30 uppercase tracking-wider">
                      {item.category.replace(/_/g, ' ')}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
                    <Calendar className="w-3.5 h-3.5 text-slate-500" />
                    <span>{formattedDate}</span>
                  </div>
                </div>

                {/* Release Title & Summary */}
                <div className="pt-4 space-y-3">
                  <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                    {item.title}
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-normal">
                    {item.summary}
                  </p>

                  {/* Detailed Changelog Markdown / Bullet Points */}
                  {item.changelog_entry && (
                    <div className="mt-4 pt-3 border-t border-slate-800/60">
                      <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5 font-mono">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        Release Highlights &amp; Scope:
                      </h4>
                      <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 text-xs text-slate-300 whitespace-pre-line leading-relaxed font-sans">
                        {item.changelog_entry}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
};
