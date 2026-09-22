import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Search, ChevronDown, Check, AlertCircle, Package, X } from 'lucide-react';
import { CatalogItem } from '../../../lib/api';
import { formatCurrency } from '../../../lib/utils';

interface ZohoItemSearchableSelectProps {
  items: CatalogItem[];
  selectedItemName: string;
  onSelect: (item: CatalogItem) => void;
  disabled?: boolean;
}

export const ZohoItemSearchableSelect: React.FC<ZohoItemSearchableSelectProps> = ({
  items,
  selectedItemName,
  onSelect,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Active items filter (strictly active items from Zoho Books Item Master)
  const activeItems = useMemo(() => {
    return items.filter((i) => !i.status || i.status.toLowerCase() === 'active');
  }, [items]);

  // Check if current item name matches any active item in Zoho Books Item Master
  const matchedZohoItem = useMemo(() => {
    if (!selectedItemName) return null;
    const lower = selectedItemName.trim().toLowerCase();
    return activeItems.find((i) => i.name?.trim().toLowerCase() === lower) || null;
  }, [activeItems, selectedItemName]);

  // Filter items strictly from Zoho Books Item Master by search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return activeItems;
    const q = searchQuery.toLowerCase().trim();
    return activeItems.filter(
      (i) =>
        i.name?.toLowerCase().includes(q) ||
        (i.description && i.description.toLowerCase().includes(q)) ||
        (i.item_id && i.item_id.toLowerCase().includes(q))
    );
  }, [activeItems, searchQuery]);

  // Safe window of items to render (prevents DOM thrashing on large catalogs)
  const visibleItems = useMemo(() => {
    return filteredItems.slice(0, 100);
  }, [filteredItems]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Reset highlight index when filter results change length
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredItems.length]);

  const handleSelect = useCallback(
    (item: CatalogItem) => {
      onSelect(item);
      setSearchQuery('');
      setIsOpen(false);
    },
    [onSelect]
  );

  // Scroll active element into view ONLY on explicit keyboard navigation (never on mouse hover)
  const scrollIndexIntoView = useCallback((index: number) => {
    if (!listRef.current) return;
    const targetEl = listRef.current.children[index] as HTMLElement | undefined;
    if (targetEl && typeof targetEl.scrollIntoView === 'function') {
      targetEl.scrollIntoView({ block: 'nearest' });
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (visibleItems.length === 0) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = highlightedIndex < visibleItems.length - 1 ? highlightedIndex + 1 : 0;
        setHighlightedIndex(next);
        scrollIndexIntoView(next);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = highlightedIndex > 0 ? highlightedIndex - 1 : visibleItems.length - 1;
        setHighlightedIndex(prev);
        scrollIndexIntoView(prev);
        break;
      }
      case 'Enter': {
        e.preventDefault();
        if (visibleItems[highlightedIndex]) {
          handleSelect(visibleItems[highlightedIndex]);
        }
        break;
      }
      case 'Escape': {
        e.preventDefault();
        setIsOpen(false);
        break;
      }
      default:
        break;
    }
  };

  const handleInputFocus = () => {
    if (!isOpen) {
      setIsOpen(true);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full min-w-[260px] text-xs">
      {/* Searchable Combobox Trigger / Search Input */}
      <div className="relative">
        <div
          onClick={() => {
            if (!disabled) {
              setIsOpen(true);
              inputRef.current?.focus();
            }
          }}
          className={`flex items-center justify-between gap-1.5 bg-slate-900 border rounded-lg px-2.5 py-1.5 cursor-pointer transition shadow-sm ${
            isOpen
              ? 'border-sky-500 ring-1 ring-sky-500 bg-slate-900'
              : matchedZohoItem
              ? 'border-slate-700 hover:border-slate-600'
              : 'border-amber-500/80 bg-amber-950/20 hover:border-amber-400'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Search className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              disabled={disabled}
              value={isOpen ? searchQuery : matchedZohoItem?.name || selectedItemName || ''}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (!isOpen) setIsOpen(true);
              }}
              onFocus={handleInputFocus}
              onKeyDown={handleKeyDown}
              placeholder={matchedZohoItem?.name || selectedItemName || 'Search Zoho Books item master...'}
              className="w-full bg-transparent text-white placeholder-slate-400 text-xs font-medium focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {isOpen && searchQuery && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSearchQuery('');
                  inputRef.current?.focus();
                }}
                className="p-0.5 text-slate-400 hover:text-white rounded"
                title="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180 text-sky-400' : ''}`}
            />
          </div>
        </div>

        {/* Warning if current item is not found in Zoho Books Item Master */}
        {!matchedZohoItem && selectedItemName && !isOpen && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-400 font-medium">
            <AlertCircle className="w-3 h-3 shrink-0 text-amber-400" />
            <span className="truncate">Not in Zoho Master - click to select catalog item</span>
          </div>
        )}
      </div>

      {/* Dropdown Popover (Strictly Zoho Books Item Master) */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-80 sm:w-96 max-h-72 bg-slate-900 border border-sky-500/50 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col backdrop-blur-md animate-in fade-in slide-in-from-top-1 duration-150">
          {/* Header Badge */}
          <div className="bg-slate-950 px-3 py-1.5 border-b border-slate-800 flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1.5 text-sky-400 font-bold">
              <Package className="w-3.5 h-3.5" />
              <span>Zoho Books Item Master</span>
            </div>
            <span className="font-mono text-slate-400 text-[10px]">
              {filteredItems.length} of {activeItems.length} active items
            </span>
          </div>

          {/* Items List */}
          <div ref={listRef} className="overflow-y-auto max-h-56 p-1.5 space-y-1 custom-scrollbar">
            {visibleItems.length > 0 ? (
              visibleItems.map((item, index) => {
                const isSelected =
                  matchedZohoItem?.item_id === item.item_id ||
                  matchedZohoItem?.name.toLowerCase() === item.name.toLowerCase();
                const isHighlighted = index === highlightedIndex;

                return (
                  <div
                    key={item.item_id || item.name}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    className={`flex items-start justify-between gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition ${
                      isHighlighted
                        ? 'bg-sky-600/30 text-white border border-sky-500/40'
                        : isSelected
                        ? 'bg-sky-950/60 text-sky-200 border border-sky-600/30'
                        : 'hover:bg-slate-800/80 text-slate-200 border border-transparent'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-white text-xs truncate">
                          {item.name}
                        </span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-sky-400 shrink-0" />}
                      </div>
                      {item.description && (
                        <p className="text-[10px] text-slate-400 truncate mt-0.5">
                          {item.description}
                        </p>
                      )}
                      {item.item_id && (
                        <span className="font-mono text-[9px] text-slate-500 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 inline-block mt-0.5">
                          SKU: {item.item_id}
                        </span>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <span className="font-mono text-xs font-bold text-emerald-400 whitespace-nowrap">
                        {formatCurrency(item.rate || 0)}
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-6 px-3 text-center text-xs">
                <p className="text-slate-400 font-medium">
                  {searchQuery ? `No Zoho Books items match "${searchQuery}"` : 'No active items registered in Zoho Books'}
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Only active items registered in your Zoho Books Item Master are available.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
