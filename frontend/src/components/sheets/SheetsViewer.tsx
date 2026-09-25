import React, { useState, useMemo } from 'react';
import { useAutomation } from '../../context/AutomationContext';
import { useErrors } from '../../context/ErrorContext';
import { ExternalLink, Check, AlertTriangle, AlertCircle, FileSpreadsheet, RefreshCw, Layers, Calendar, Terminal } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const YEARS = [2025, 2026, 2027];

export const SheetsViewer: React.FC = () => {
  const {
    sheetsData,
    selectedMonth,
    setSelectedMonth,
    selectedYear,
    setSelectedYear,
    sheetsSubTab,
    setSheetsSubTab,
    handleToggleApproval,
    setIsInvoiceModalOpen,
    refreshAll,
    isLoading,
  } = useAutomation();
  const { errors, openDebugDrawer } = useErrors();

  const [search, setSearch] = useState('');

  const sheetsError = errors.find(
    (e) => e.endpoint?.includes('sheets') || (e.title || '').toLowerCase().includes('sheet')
  );

  const dailyDetails = sheetsData?.daily_details || [];
  const monthlySummary = sheetsData?.monthly_summary || [];

  const query = (search || '').trim().toLowerCase();

  const filteredDaily = useMemo(() => {
    if (!query) return dailyDetails;
    return dailyDetails.filter((d) => {
      const client = (d?.client_name || '').toLowerCase();
      const item = (d?.item_name || '').toLowerCase();
      const file = (d?.file_name || '').toLowerCase();
      const cat = (d?.category || '').toLowerCase();
      const date = (d?.date || '').toLowerCase();
      return (
        client.includes(query) ||
        item.includes(query) ||
        file.includes(query) ||
        cat.includes(query) ||
        date.includes(query)
      );
    });
  }, [dailyDetails, query]);

  const filteredSummary = useMemo(() => {
    if (!query) return monthlySummary;
    return monthlySummary.filter((s) => {
      const client = (s?.client_name || '').toLowerCase();
      const item = (s?.item_name || '').toLowerCase();
      const status = (s?.status || '').toLowerCase();
      return (
        client.includes(query) ||
        item.includes(query) ||
        status.includes(query)
      );
    });
  }, [monthlySummary, query]);

  const approvedRowsCount = monthlySummary.filter((s) => s.approved).length;
  const totalApprovedAmount = monthlySummary
    .filter((s) => s.approved)
    .reduce((sum, r) => sum + (r.total_billed || 0), 0);

  return (
    <div className="space-y-4">
      
      {/* Header & Controls Bar */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            <h2 className="text-base font-bold text-[#0F172A] tracking-tight">Google Sheets Review & Reconciliation</h2>
          </div>
          <p className="text-xs text-[#64748B] mt-0.5">
            Audit OCR extracted control slips, verify linen discrepancies, and approve line-items for automated accounting invoicing.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Month / Year Selectors */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-[#E2E8F0] rounded-xl px-2.5 py-1 text-xs">
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-transparent text-[#0F172A] font-medium focus:outline-none cursor-pointer"
            >
              {MONTHS.map((m) => (
                <option key={m} value={m} className="bg-white text-[#0F172A]">
                  {m}
                </option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="bg-transparent text-[#0F172A] font-medium focus:outline-none cursor-pointer ml-1"
            >
              {YEARS.map((y) => (
                <option key={y} value={y} className="bg-white text-[#0F172A]">
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* External Google Sheets Link */}
          {sheetsData?.spreadsheet_url && (
            <a
              href={sheetsData.spreadsheet_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded-xl transition cursor-pointer shadow-xs"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Open in Google Sheets</span>
            </a>
          )}

          {/* Refresh */}
          <button
            onClick={() => refreshAll()}
            disabled={isLoading}
            className="p-1.5 bg-white border border-[#E2E8F0] hover:bg-slate-50 text-slate-600 rounded-xl transition cursor-pointer shadow-xs"
            title="Refresh Sheet Data"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#0284C7]' : ''}`} />
          </button>

          {/* 1-Click Zoho Invoicing Trigger */}
          <button
            onClick={() => setIsInvoiceModalOpen(true)}
            disabled={approvedRowsCount === 0}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-bold px-3.5 py-1.5 rounded-xl shadow-xs transition disabled:opacity-50 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Generate Invoices ({approvedRowsCount} Approved - {formatCurrency(totalApprovedAmount)})</span>
          </button>
        </div>
      </div>

      {/* Sheets Sync Error Banner */}
      {sheetsError && (
        <div className="bg-[#FFF1F2] border border-[#FECDD3] rounded-2xl p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-rose-800">Google Sheets Sync Error</h3>
                {sheetsError.status && (
                  <span className="text-[10px] bg-rose-100 text-rose-700 font-mono px-2 py-0.5 rounded border border-rose-200">
                    HTTP {sheetsError.status}
                  </span>
                )}
              </div>
              <p className="text-xs text-rose-700 mt-1">{sheetsError.message}</p>
              {sheetsError.troubleshootingHint && (
                <p className="text-[11px] text-rose-800 mt-1 font-mono">
                  💡 Hint: {sheetsError.troubleshootingHint}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => refreshAll()}
              disabled={isLoading}
              className="flex items-center gap-1.5 bg-white hover:bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold px-3 py-1.5 rounded-xl transition cursor-pointer shadow-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Retry Sync</span>
            </button>
            <button
              onClick={() => openDebugDrawer('errors')}
              className="flex items-center gap-1.5 bg-white hover:bg-slate-50 border border-[#E2E8F0] text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-xl transition cursor-pointer shadow-xs"
            >
              <Terminal className="w-3.5 h-3.5 text-rose-600" />
              <span>Inspect Trace</span>
            </button>
          </div>
        </div>
      )}

      {/* Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-[#E2E8F0] rounded-2xl p-2.5 shadow-xs">
        <div className="flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200/80">
          <button
            onClick={() => setSheetsSubTab('monthly')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer ${
              sheetsSubTab === 'monthly'
                ? 'bg-white text-[#0284C7] shadow-xs border border-slate-200/80 font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Tab 2: Monthly Summary ({monthlySummary.length} rows)
          </button>
          <button
            onClick={() => setSheetsSubTab('daily')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer ${
              sheetsSubTab === 'daily'
                ? 'bg-white text-[#0284C7] shadow-xs border border-slate-200/80 font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Tab 1: Daily Details ({dailyDetails.length} items)
          </button>
        </div>

        <input
          type="text"
          placeholder="Filter by hotel, item, or slip filename..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-slate-50 border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-xs text-[#0F172A] placeholder-slate-400 focus:outline-none focus:border-[#0284C7] sm:w-72"
        />
      </div>

      {/* Table Container */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto custom-scrollbar">
          {sheetsSubTab === 'monthly' ? (
            /* TAB 2: MONTHLY SUMMARY TABLE */
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/90 border-b border-[#E2E8F0] text-[#64748B] uppercase tracking-wider font-semibold text-[11px]">
                <tr>
                  <th className="py-3 px-4">Client / Hotel</th>
                  <th className="py-3 px-4">Item Name</th>
                  <th className="py-3 px-4 text-center">Pickup</th>
                  <th className="py-3 px-4 text-center">Delivery</th>
                  <th className="py-3 px-4 text-center">Discrepancy (Loss)</th>
                  <th className="py-3 px-4 text-right">Unit Rate</th>
                  <th className="py-3 px-4 text-right">Total Billed</th>
                  <th className="py-3 px-4 text-center">Reviewed</th>
                  <th className="py-3 px-4 text-center">Approved</th>
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] text-[#334155] font-medium">
                {filteredSummary.length > 0 ? (
                  filteredSummary.map((row) => (
                    <tr
                      key={row.row_index}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        row.approved ? 'bg-emerald-50/40' : (row.linen_discrepancy ?? 0) > 0 ? 'bg-amber-50/40' : ''
                      }`}
                    >
                      <td className="py-3 px-4 font-bold text-[#0F172A]">{row.client_name}</td>
                      <td className="py-3 px-4">{row.item_name}</td>
                      <td className="py-3 px-4 text-center font-mono">{row.pickup_qty}</td>
                      <td className="py-3 px-4 text-center font-mono">{row.delivery_qty}</td>
                      <td className="py-3 px-4 text-center">
                        {(row.linen_discrepancy ?? 0) > 0 ? (
                          <span className="inline-flex items-center gap-1 text-amber-700 font-mono font-bold bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                            <AlertTriangle className="w-3 h-3 text-amber-600" />
                            <span>+{row.linen_discrepancy}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 font-mono">0</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-[#334155]">{formatCurrency(row.unit_price ?? 0)}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600">
                        {formatCurrency(row.total_billed ?? 0)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={row.reviewed}
                          onChange={(e) => handleToggleApproval(row.row_index, 'reviewed', e.target.checked)}
                          className="w-4 h-4 rounded border-[#CBD5E1] bg-white text-sky-600 focus:ring-sky-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={row.approved}
                          onChange={(e) => handleToggleApproval(row.row_index, 'approved', e.target.checked)}
                          className="w-4 h-4 rounded border-[#CBD5E1] bg-white text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            row.approved
                              ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                              : row.status === 'INVOICED'
                              ? 'bg-sky-50 border border-sky-200 text-sky-700'
                              : 'bg-slate-100 border border-slate-200 text-slate-600'
                          }`}
                        >
                          {row.approved ? 'APPROVED' : row.status || 'PENDING'}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-500 text-xs">
                      No monthly summary rows found for {selectedMonth} {selectedYear}. Run the ingestion pipeline to extract control slips.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            /* TAB 1: DAILY DETAILS TABLE */
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/90 border-b border-[#E2E8F0] text-[#64748B] uppercase tracking-wider font-semibold text-[11px]">
                <tr>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Client / Hotel</th>
                  <th className="py-3 px-4">Slip Filename</th>
                  <th className="py-3 px-4">Item Name</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4 text-center">Pickup</th>
                  <th className="py-3 px-4 text-center">Delivery</th>
                  <th className="py-3 px-4 text-center">Discrepancy</th>
                  <th className="py-3 px-4 text-right">Rate</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] text-[#334155] font-medium">
                {filteredDaily.length > 0 ? (
                  filteredDaily.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono text-slate-500">{row.date}</td>
                      <td className="py-3 px-4 font-bold text-[#0F172A]">{row.client_name}</td>
                      <td className="py-3 px-4 font-mono text-[11px] text-sky-600">{row.file_name}</td>
                      <td className="py-3 px-4">{row.item_name}</td>
                      <td className="py-3 px-4">
                        <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-slate-600">
                          {row.category}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-[#0F172A]">{row.pickup_quantity}</td>
                      <td className="py-3 px-4 text-center font-mono text-[#0F172A]">{row.delivery_quantity}</td>
                      <td className="py-3 px-4 text-center">
                        {(row.discrepancy ?? 0) > 0 ? (
                          <span className="text-amber-600 font-mono font-bold">+{row.discrepancy}</span>
                        ) : (
                          <span className="text-slate-400 font-mono">0</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-[#334155]">{formatCurrency(row.unit_price ?? 0)}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600">
                        {formatCurrency(row.total_amount ?? 0)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-500 text-xs">
                      No daily detail line items found. Trigger the OCR pipeline above to process Drive slips.
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
