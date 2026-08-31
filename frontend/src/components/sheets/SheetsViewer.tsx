import React, { useState } from 'react';
import { useAutomation } from '../../context/AutomationContext';
import { ExternalLink, Check, AlertTriangle, FileSpreadsheet, RefreshCw, Layers, Calendar } from 'lucide-react';
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

  const [search, setSearch] = useState('');

  const dailyDetails = sheetsData?.daily_details || [];
  const monthlySummary = sheetsData?.monthly_summary || [];

  const filteredDaily = dailyDetails.filter(
    (d) =>
      d.client_name.toLowerCase().includes(search.toLowerCase()) ||
      d.item_name.toLowerCase().includes(search.toLowerCase()) ||
      d.file_name.toLowerCase().includes(search.toLowerCase())
  );

  const filteredSummary = monthlySummary.filter(
    (s) =>
      s.client_name.toLowerCase().includes(search.toLowerCase()) ||
      s.item_name.toLowerCase().includes(search.toLowerCase())
  );

  const approvedRowsCount = monthlySummary.filter((s) => s.approved).length;
  const totalApprovedAmount = monthlySummary
    .filter((s) => s.approved)
    .reduce((sum, r) => sum + (r.total_billed || 0), 0);

  return (
    <div className="space-y-4">
      
      {/* Header & Controls Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl backdrop-blur-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white tracking-tight">Google Sheets Review & Reconciliation</h2>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Audit OCR extracted control slips, verify linen discrepancies, and approve line-items for automated accounting invoicing.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Month / Year Selectors */}
          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1 text-xs">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-transparent text-white font-medium focus:outline-none cursor-pointer"
            >
              {MONTHS.map((m) => (
                <option key={m} value={m} className="bg-slate-900 text-white">
                  {m}
                </option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="bg-transparent text-white font-medium focus:outline-none cursor-pointer ml-1"
            >
              {YEARS.map((y) => (
                <option key={y} value={y} className="bg-slate-900 text-white">
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
              className="flex items-center gap-1.5 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/30 text-emerald-300 text-xs font-semibold px-3 py-1.5 rounded-xl transition cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Open in Google Sheets</span>
            </a>
          )}

          {/* Refresh */}
          <button
            onClick={() => refreshAll()}
            disabled={isLoading}
            className="p-1.5 bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-xl transition cursor-pointer"
            title="Refresh Sheet Data"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-sky-400' : ''}`} />
          </button>

          {/* 1-Click Zoho Invoicing Trigger */}
          <button
            onClick={() => setIsInvoiceModalOpen(true)}
            disabled={approvedRowsCount === 0}
            className="flex items-center gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:from-emerald-700 active:to-teal-700 text-white text-xs font-bold px-3.5 py-1.5 rounded-xl shadow-lg shadow-emerald-600/25 transition disabled:opacity-50 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Generate Invoices ({approvedRowsCount} Approved - {formatCurrency(totalApprovedAmount)})</span>
          </button>
        </div>
      </div>

      {/* Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800/80 rounded-xl p-2">
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setSheetsSubTab('monthly')}
            className={`px-3 py-1 text-xs font-bold rounded-md transition cursor-pointer ${
              sheetsSubTab === 'monthly'
                ? 'bg-sky-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Tab 2: Monthly Summary ({monthlySummary.length} rows)
          </button>
          <button
            onClick={() => setSheetsSubTab('daily')}
            className={`px-3 py-1 text-xs font-bold rounded-md transition cursor-pointer ${
              sheetsSubTab === 'daily'
                ? 'bg-sky-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
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
          className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 sm:w-72"
        />
      </div>

      {/* Table Container */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-xl backdrop-blur-xl">
        <div className="overflow-x-auto custom-scrollbar">
          {sheetsSubTab === 'monthly' ? (
            /* TAB 2: MONTHLY SUMMARY TABLE */
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
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
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {filteredSummary.length > 0 ? (
                  filteredSummary.map((row) => (
                    <tr
                      key={row.row_index}
                      className={`hover:bg-slate-850/50 transition-colors ${
                        row.approved ? 'bg-emerald-950/15' : row.linen_discrepancy > 0 ? 'bg-amber-950/10' : ''
                      }`}
                    >
                      <td className="py-3 px-4 font-bold text-white">{row.client_name}</td>
                      <td className="py-3 px-4">{row.item_name}</td>
                      <td className="py-3 px-4 text-center font-mono">{row.pickup_qty}</td>
                      <td className="py-3 px-4 text-center font-mono">{row.delivery_qty}</td>
                      <td className="py-3 px-4 text-center">
                        {row.linen_discrepancy > 0 ? (
                          <span className="inline-flex items-center gap-1 text-amber-400 font-mono font-bold bg-amber-950/60 border border-amber-500/30 px-2 py-0.5 rounded">
                            <AlertTriangle className="w-3 h-3" />
                            <span>+{row.linen_discrepancy}</span>
                          </span>
                        ) : (
                          <span className="text-slate-500 font-mono">0</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono">{formatCurrency(row.unit_price)}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                        {formatCurrency(row.total_billed)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={row.reviewed}
                          onChange={(e) => handleToggleApproval(row.row_index, 'reviewed', e.target.checked)}
                          className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-sky-600 focus:ring-sky-500 focus:ring-offset-slate-900 cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={row.approved}
                          onChange={(e) => handleToggleApproval(row.row_index, 'approved', e.target.checked)}
                          className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-emerald-600 focus:ring-emerald-500 focus:ring-offset-slate-900 cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            row.approved
                              ? 'bg-emerald-950 border border-emerald-500/40 text-emerald-300'
                              : row.status === 'INVOICED'
                              ? 'bg-sky-950 border border-sky-500/40 text-sky-300'
                              : 'bg-slate-950 border border-slate-700 text-slate-400'
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
              <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
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
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {filteredDaily.length > 0 ? (
                  filteredDaily.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-850/50 transition-colors">
                      <td className="py-3 px-4 font-mono text-slate-400">{row.date}</td>
                      <td className="py-3 px-4 font-bold text-white">{row.client_name}</td>
                      <td className="py-3 px-4 font-mono text-[11px] text-sky-400">{row.file_name}</td>
                      <td className="py-3 px-4">{row.item_name}</td>
                      <td className="py-3 px-4">
                        <span className="text-[10px] bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 text-slate-400">
                          {row.category}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono">{row.pickup_quantity}</td>
                      <td className="py-3 px-4 text-center font-mono">{row.delivery_quantity}</td>
                      <td className="py-3 px-4 text-center">
                        {row.discrepancy > 0 ? (
                          <span className="text-amber-400 font-mono font-bold">+{row.discrepancy}</span>
                        ) : (
                          <span className="text-slate-500 font-mono">0</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono">{formatCurrency(row.unit_price)}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                        {formatCurrency(row.total_amount)}
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
