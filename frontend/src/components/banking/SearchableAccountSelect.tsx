import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, Check, X, Tag } from 'lucide-react';
import type { ChartOfAccountItem } from '../../types/client';

interface SearchableAccountSelectProps {
  accounts: ChartOfAccountItem[];
  value: string;
  onChange: (accountId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export const SearchableAccountSelect: React.FC<SearchableAccountSelectProps> = ({
  accounts,
  value,
  onChange,
  placeholder = 'Select Category...',
  disabled = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Position coordinates for portal
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});

  // Find currently selected account
  const selectedAccount = useMemo(() => {
    if (!value) return null;
    return accounts.find((a) => a.account_id === value || a.account_code === value || a.account_name === value) || null;
  }, [accounts, value]);

  // Filter accounts by search query (matching code, name, or type)
  const filteredAccounts = useMemo(() => {
    if (!search.trim()) return accounts;
    const q = search.trim().toLowerCase();
    return accounts.filter((acc) => {
      const codeMatch = acc.account_code?.toLowerCase().includes(q);
      const nameMatch = acc.account_name?.toLowerCase().includes(q);
      const typeMatch = acc.account_type?.toLowerCase().includes(q);
      const idMatch = acc.account_id?.toLowerCase().includes(q);
      return codeMatch || nameMatch || typeMatch || idMatch;
    });
  }, [accounts, search]);

  // Update popover positioning relative to trigger
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownHeight = 320;
    const spaceBelow = window.innerHeight - rect.bottom;
    const placeAbove = spaceBelow < dropdownHeight && rect.top > dropdownHeight;

    const width = Math.max(rect.width, 320);
    let left = rect.left;
    if (left + width > window.innerWidth - 12) {
      left = window.innerWidth - width - 12;
    }
    if (left < 12) left = 12;

    setPopoverStyle({
      position: 'fixed',
      top: placeAbove ? `${rect.top - 8}px` : `${rect.bottom + 4}px`,
      transform: placeAbove ? 'translateY(-100%)' : 'none',
      left: `${left}px`,
      width: `${width}px`,
      zIndex: 9999,
    });
  }, []);

  const handleOpen = () => {
    if (disabled) return;
    updatePosition();
    setIsOpen(true);
    setSearch('');
    setHighlightedIndex(0);
  };

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setSearch('');
  }, []);

  const handleSelect = useCallback(
    (account: ChartOfAccountItem) => {
      onChange(account.account_id);
      handleClose();
      triggerRef.current?.focus();
    },
    [onChange, handleClose]
  );

  // Auto-focus search input when opened
  useEffect(() => {
    if (isOpen) {
      updatePosition();
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [isOpen, updatePosition]);

  // Reposition on scroll or resize
  useEffect(() => {
    if (!isOpen) return;
    const handleScrollOrResize = () => {
      updatePosition();
    };
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [isOpen, updatePosition]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        handleClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, handleClose]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleOpen();
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
      triggerRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, filteredAccounts.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredAccounts[highlightedIndex]) {
        handleSelect(filteredAccounts[highlightedIndex]);
      }
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const activeEl = listRef.current.children[highlightedIndex] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, isOpen]);

  const isMapped = Boolean(selectedAccount);

  return (
    <div className={`relative ${className}`} onKeyDown={handleKeyDown}>
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (isOpen ? handleClose() : handleOpen())}
        className={`w-full text-left text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#0284C7]/30 transition cursor-pointer flex items-center justify-between gap-1.5 shadow-xs ${
          isMapped
            ? 'bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0] font-semibold'
            : 'bg-white border border-[#E2E8F0] text-slate-700 hover:border-slate-300'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span className="truncate flex-1">
          {selectedAccount ? (
            <>
              {selectedAccount.account_code && (
                <span className="font-mono font-bold mr-1.5 text-slate-600">
                  [{selectedAccount.account_code}]
                </span>
              )}
              <span>{selectedAccount.account_name}</span>
            </>
          ) : (
            <span className="text-slate-400 font-normal">{placeholder}</span>
          )}
        </span>

        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-180 text-[#0284C7]' : 'text-slate-400'}`} />
      </button>

      {/* Popover Portal */}
      {isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            style={popoverStyle}
            className="bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100"
          >
            {/* Search Input Header */}
            <div className="p-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setHighlightedIndex(0);
                }}
                placeholder="Type to search code or account..."
                className="w-full bg-transparent text-xs text-slate-800 placeholder-slate-400 focus:outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    searchInputRef.current?.focus();
                  }}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Results Count Bar */}
            <div className="px-3 py-1 bg-slate-100/60 border-b border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
              <span>{filteredAccounts.length} account(s) found</span>
              {selectedAccount && (
                <button
                  type="button"
                  onClick={() => {
                    onChange('');
                    handleClose();
                  }}
                  className="text-rose-600 hover:underline font-semibold cursor-pointer"
                >
                  Clear Selection
                </button>
              )}
            </div>

            {/* Options List */}
            <div ref={listRef} className="max-h-60 overflow-y-auto p-1 divide-y divide-slate-50">
              {filteredAccounts.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400">
                  <p>No matching accounts found</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Try searching another code or name</p>
                </div>
              ) : (
                filteredAccounts.map((acc, index) => {
                  const isSelected = selectedAccount?.account_id === acc.account_id;
                  const isHighlighted = index === highlightedIndex;

                  return (
                    <div
                      key={acc.account_id}
                      onClick={() => handleSelect(acc)}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      className={`px-2.5 py-2 rounded-lg cursor-pointer transition flex items-center justify-between gap-2 text-xs ${
                        isSelected
                          ? 'bg-[#F0F9FF] text-[#0284C7] font-semibold'
                          : isHighlighted
                          ? 'bg-slate-100 text-slate-900'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {acc.account_code && (
                            <span className="font-mono font-bold text-[11px] px-1.5 py-0.5 bg-slate-200/70 text-slate-700 rounded">
                              {acc.account_code}
                            </span>
                          )}
                          <span className="truncate">{acc.account_name}</span>
                        </div>
                        {acc.account_type && (
                          <span className="text-[10px] text-slate-400 capitalize block mt-0.5 font-normal">
                            {acc.account_type.replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>

                      {isSelected && <Check className="w-4 h-4 text-[#0284C7] shrink-0" />}
                    </div>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
