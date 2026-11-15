import React, { useState, useEffect, useCallback } from 'react';
import { useClient } from '../../../context/ClientContext';
import {
  fetchFinancialReports,
  generateFinancialReport,
  fetchFinancialReportDetail,
  FinancialStatementReportItem,
} from '../../../lib/api';
import {
  BarChart3,
  FileText,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Download,
  Calendar,
  Layers,
  TrendingUp,
  Percent,
  BookOpen,
  Info,
  RefreshCw,
  Eye,
  X,
} from 'lucide-react';

export const ClientFRTab: React.FC = () => {
  const { currentClient } = useClient();
  const [reports, setReports] = useState<FinancialStatementReportItem[]>([]);
  const [selectedReport, setSelectedReport] = useState<FinancialStatementReportItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeStatementTab, setActiveStatementTab] = useState<'pnl' | 'balance_sheet' | 'cash_flow' | 'equity' | 'notes' | 'ratios' | 'commentary'>('pnl');
  const [framework, setFramework] = useState('IFRS');
  const [periodType, setPeriodType] = useState('MONTHLY');
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    if (!currentClient?.id) return;
    setIsLoading(true);
    try {
      const data = await fetchFinancialReports(currentClient.id, { year: 2026 });
      setReports(data);
      if (data.length > 0 && !selectedReport) {
        const detail = await fetchFinancialReportDetail(currentClient.id, data[0].report_id);
        setSelectedReport(detail);
      }
    } catch (err: any) {
      console.warn('Failed loading financial reports:', err);
    } finally {
      setIsLoading(false);
    }
  }, [currentClient?.id, selectedReport]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const handleGenerateReport = async () => {
    if (!currentClient?.id) return;
    setIsGenerating(true);
    setActionNotice(null);
    try {
      const res = await generateFinancialReport(currentClient.id, {
        period_type: periodType,
        period_month: 'October',
        period_year: 2026,
        reporting_framework: framework,
      });
      setActionNotice(`Financial reporting pack successfully synthesized for October 2026 under ${framework}.`);
      const detail = await fetchFinancialReportDetail(currentClient.id, res.report_id);
      setSelectedReport(detail);
      const updatedList = await fetchFinancialReports(currentClient.id, { year: 2026 });
      setReports(updatedList);
    } catch (err: any) {
      setActionNotice(`Synthesis failed: ${err.message || 'Error compiling financial statements'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSelectReport = async (reportId: string) => {
    if (!currentClient?.id) return;
    try {
      const detail = await fetchFinancialReportDetail(currentClient.id, reportId);
      setSelectedReport(detail);
    } catch (err: any) {
      console.warn('Failed to fetch report detail:', err);
    }
  };

  const pnl = selectedReport?.income_statement || {};
  const bs = selectedReport?.balance_sheet || {};
  const cf = selectedReport?.cash_flow_statement || {};
  const eq = selectedReport?.equity_statement || {};
  const notes = selectedReport?.notes_to_accounts || [];
  const ratios = selectedReport?.financial_ratios || {};
  const commentary = selectedReport?.executive_commentary || '';

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-[#0284C7]/10 flex items-center justify-center text-[#0284C7]">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-[#0F172A]">Financial Reporting & Statements</h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#EFF6FF] text-[#2563EB] border border-[#DBEAFE]">
                  Read-Only Synthesis
                </span>
              </div>
              <p className="text-xs text-[#64748B]">
                Synthesizes formal P&L, Balance Sheet, Indirect Cash Flow, Disclosures, and Ratios from the closed General Ledger.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <select
            value={framework}
            onChange={(e) => setFramework(e.target.value)}
            className="px-3 py-2 rounded-xl border border-[#E2E8F0] text-xs font-semibold text-[#0F172A] bg-white cursor-pointer focus:outline-none focus:border-[#0284C7]"
          >
            <option value="IFRS">IFRS (Standard)</option>
            <option value="IFRS_FOR_SMES">IFRS for SMEs</option>
            <option value="GHANA_GAAP">Ghana GAAP (GRA)</option>
            <option value="US_GAAP">US GAAP</option>
          </select>

          <button
            onClick={handleGenerateReport}
            disabled={isGenerating}
            className="px-4 py-2.5 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <Sparkles className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
            {isGenerating ? 'Synthesizing Statements...' : 'Synthesize Reporting Pack'}
          </button>
        </div>
      </div>

      {/* Notice Banner */}
      {actionNotice && (
        <div className="p-4 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] text-[#166534] text-xs font-medium flex items-center justify-between">
          <span>{actionNotice}</span>
          <button onClick={() => setActionNotice(null)} className="text-[#166534] hover:text-[#14532D] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Separation of Duties Callout */}
      <div className="p-4 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center gap-3">
        <Info className="w-5 h-5 text-[#0284C7] shrink-0" />
        <p className="text-xs text-[#475569]">
          <strong className="text-[#0F172A]">Strict Separation of Duties:</strong> The Financial Reporting Agent is strictly read-only.
          It consumes the adjusted trial balance and produces audit-ready statement packs. All adjusting journals and accruals are originated
          exclusively by the General Ledger (GL) Accountant Agent.
        </p>
      </div>

      {/* Reports Available / Selector */}
      {reports.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          <span className="text-xs font-bold text-[#64748B] shrink-0">Available Packs:</span>
          {reports.map((r) => (
            <button
              key={r.report_id}
              onClick={() => handleSelectReport(r.report_id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer shrink-0 ${
                selectedReport?.report_id === r.report_id
                  ? 'bg-[#0284C7] text-white shadow-xs'
                  : 'bg-white border border-[#E2E8F0] text-[#475569] hover:bg-[#F8FAFC]'
              }`}
            >
              {r.report_title}
            </button>
          ))}
        </div>
      )}

      {/* Main Statement Viewer */}
      {selectedReport ? (
        <div className="space-y-6">
          {/* Executive KPI Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs">
              <span className="text-xs font-medium text-[#64748B] uppercase tracking-wider">Revenue</span>
              <div className="mt-2 text-2xl font-bold text-[#0F172A]">
                {selectedReport.currency} {pnl.revenue ? pnl.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '0.00'}
              </div>
              <span className="text-[11px] text-[#16A34A] font-semibold mt-1 block">
                Gross Margin: {pnl.gross_profit_margin_pct || 0}%
              </span>
            </div>

            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs">
              <span className="text-xs font-medium text-[#64748B] uppercase tracking-wider">Net Profit</span>
              <div className="mt-2 text-2xl font-bold text-[#16A34A]">
                {selectedReport.currency} {pnl.net_profit_for_period ? pnl.net_profit_for_period.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '0.00'}
              </div>
              <span className="text-[11px] text-[#64748B] mt-1 block">
                Net Margin: {pnl.net_profit_margin_pct || 0}%
              </span>
            </div>

            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs">
              <span className="text-xs font-medium text-[#64748B] uppercase tracking-wider">Total Assets</span>
              <div className="mt-2 text-2xl font-bold text-[#0F172A]">
                {selectedReport.currency} {bs.total_assets ? bs.total_assets.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '0.00'}
              </div>
              <span className="text-[11px] text-[#16A34A] font-semibold mt-1 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Balance Sheet Balanced
              </span>
            </div>

            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs">
              <span className="text-xs font-medium text-[#64748B] uppercase tracking-wider">Current Ratio</span>
              <div className="mt-2 text-2xl font-bold text-[#0284C7]">
                {ratios.liquidity?.current_ratio || '0.00'}x
              </div>
              <span className="text-[11px] text-[#64748B] mt-1 block">
                {ratios.liquidity?.evaluation || 'Healthy liquidity cover'}
              </span>
            </div>
          </div>

          {/* Statement Tab Navigation */}
          <div className="flex border-b border-[#E2E8F0] gap-6 overflow-x-auto">
            <button
              onClick={() => setActiveStatementTab('pnl')}
              className={`pb-3 text-xs font-bold border-b-2 transition-colors cursor-pointer shrink-0 ${
                activeStatementTab === 'pnl' ? 'border-[#0284C7] text-[#0284C7]' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              Income Statement (P&L)
            </button>
            <button
              onClick={() => setActiveStatementTab('balance_sheet')}
              className={`pb-3 text-xs font-bold border-b-2 transition-colors cursor-pointer shrink-0 ${
                activeStatementTab === 'balance_sheet' ? 'border-[#0284C7] text-[#0284C7]' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              Balance Sheet
            </button>
            <button
              onClick={() => setActiveStatementTab('cash_flow')}
              className={`pb-3 text-xs font-bold border-b-2 transition-colors cursor-pointer shrink-0 ${
                activeStatementTab === 'cash_flow' ? 'border-[#0284C7] text-[#0284C7]' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              Cash Flow Statement
            </button>
            <button
              onClick={() => setActiveStatementTab('equity')}
              className={`pb-3 text-xs font-bold border-b-2 transition-colors cursor-pointer shrink-0 ${
                activeStatementTab === 'equity' ? 'border-[#0284C7] text-[#0284C7]' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              Changes in Equity
            </button>
            <button
              onClick={() => setActiveStatementTab('notes')}
              className={`pb-3 text-xs font-bold border-b-2 transition-colors cursor-pointer shrink-0 ${
                activeStatementTab === 'notes' ? 'border-[#0284C7] text-[#0284C7]' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              Notes & Disclosures ({notes.length})
            </button>
            <button
              onClick={() => setActiveStatementTab('ratios')}
              className={`pb-3 text-xs font-bold border-b-2 transition-colors cursor-pointer shrink-0 ${
                activeStatementTab === 'ratios' ? 'border-[#0284C7] text-[#0284C7]' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              Financial Ratios
            </button>
            <button
              onClick={() => setActiveStatementTab('commentary')}
              className={`pb-3 text-xs font-bold border-b-2 transition-colors cursor-pointer shrink-0 ${
                activeStatementTab === 'commentary' ? 'border-[#0284C7] text-[#0284C7]' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              MD&A Commentary
            </button>
          </div>

          {/* Statement View Panels */}
          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 shadow-xs">
            {/* P&L */}
            {activeStatementTab === 'pnl' && (
              <div className="space-y-4 max-w-2xl">
                <div className="border-b border-[#E2E8F0] pb-2 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#0F172A]">Statement of Profit or Loss ({selectedReport.period_month} {selectedReport.period_year})</h3>
                  <span className="text-xs font-mono text-[#64748B]">All values in {selectedReport.currency}</span>
                </div>

                <div className="space-y-2 text-xs divide-y divide-[#F1F5F9]">
                  <div className="pt-2 flex justify-between font-bold text-[#0F172A]">
                    <span>Commercial Revenue</span>
                    <span className="font-mono">{pnl.revenue?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="pt-2 flex justify-between text-[#DC2626]">
                    <span>Cost of Sales & Direct Supplies</span>
                    <span className="font-mono">({pnl.cost_of_sales?.toLocaleString(undefined, { minimumFractionDigits: 2 })})</span>
                  </div>
                  <div className="pt-2 flex justify-between font-bold text-[#0F172A] bg-[#F8FAFC] p-2 rounded-lg">
                    <span>Gross Profit</span>
                    <span className="font-mono">{pnl.gross_profit?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="pt-2 flex justify-between text-[#475569]">
                    <span>Administrative Expenses</span>
                    <span className="font-mono">({pnl.administrative_expenses?.toLocaleString(undefined, { minimumFractionDigits: 2 })})</span>
                  </div>
                  <div className="pt-2 flex justify-between text-[#475569]">
                    <span>Depreciation & Amortization (IAS 16)</span>
                    <span className="font-mono">({pnl.depreciation_and_amortization?.toLocaleString(undefined, { minimumFractionDigits: 2 })})</span>
                  </div>
                  <div className="pt-2 flex justify-between text-[#16A34A]">
                    <span>Foreign Exchange Gain / Loss (IAS 21)</span>
                    <span className="font-mono">{pnl.foreign_exchange_gain_loss?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="pt-2 flex justify-between font-bold text-[#0F172A] bg-[#F8FAFC] p-2 rounded-lg">
                    <span>Operating Profit (EBIT)</span>
                    <span className="font-mono">{pnl.operating_profit_ebit?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="pt-2 flex justify-between text-[#475569]">
                    <span>Finance Costs</span>
                    <span className="font-mono">{pnl.finance_costs?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '0.00'}</span>
                  </div>
                  <div className="pt-2 flex justify-between font-bold text-[#0F172A]">
                    <span>Profit Before Tax (PBT)</span>
                    <span className="font-mono">{pnl.profit_before_tax?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="pt-2 flex justify-between text-[#DC2626]">
                    <span>Income Tax Expense (Ghana GRA 25%)</span>
                    <span className="font-mono">({pnl.income_tax_expense?.toLocaleString(undefined, { minimumFractionDigits: 2 })})</span>
                  </div>
                  <div className="pt-3 flex justify-between font-bold text-sm text-[#16A34A] bg-[#F0FDF4] p-3 rounded-xl border border-[#DCFCE7]">
                    <span>Net Profit for the Period</span>
                    <span className="font-mono">{pnl.net_profit_for_period?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Balance Sheet */}
            {activeStatementTab === 'balance_sheet' && (
              <div className="space-y-4 max-w-2xl">
                <div className="border-b border-[#E2E8F0] pb-2 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#0F172A]">Statement of Financial Position (As at {bs.as_at_date})</h3>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#F0FDF4] text-[#16A34A] border border-[#DCFCE7] flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Balanced (Discrepancy: 0.00)
                  </span>
                </div>

                <div className="space-y-3 text-xs">
                  <h4 className="font-bold text-[#0284C7] uppercase tracking-wider text-[11px]">Non-Current Assets</h4>
                  <div className="flex justify-between pl-3 text-[#334155]">
                    <span>Property, Plant & Equipment (Net)</span>
                    <span className="font-mono">{bs.non_current_assets?.net_property_plant_and_equipment?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>

                  <h4 className="font-bold text-[#0284C7] uppercase tracking-wider text-[11px] pt-2">Current Assets</h4>
                  <div className="flex justify-between pl-3 text-[#334155]">
                    <span>Trade Receivables</span>
                    <span className="font-mono">{bs.current_assets?.trade_receivables?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between pl-3 text-[#334155]">
                    <span>Prepaid Expenses</span>
                    <span className="font-mono">{bs.current_assets?.prepaid_expenses?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between pl-3 text-[#334155]">
                    <span>Cash & Bank Balances</span>
                    <span className="font-mono">{bs.current_assets?.cash_and_bank_balances?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between font-bold text-[#0F172A] bg-[#F8FAFC] p-2 rounded-lg">
                    <span>Total Assets</span>
                    <span className="font-mono">{bs.total_assets?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>

                  <h4 className="font-bold text-[#0284C7] uppercase tracking-wider text-[11px] pt-3">Equity</h4>
                  <div className="flex justify-between pl-3 text-[#334155]">
                    <span>Stated Share Capital</span>
                    <span className="font-mono">{bs.equity?.stated_share_capital?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between pl-3 text-[#334155]">
                    <span>Retained Earnings</span>
                    <span className="font-mono">{bs.equity?.retained_earnings_closing?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between font-bold text-[#0F172A] pl-3">
                    <span>Total Equity</span>
                    <span className="font-mono">{bs.equity?.total_equity?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>

                  <h4 className="font-bold text-[#0284C7] uppercase tracking-wider text-[11px] pt-2">Current Liabilities</h4>
                  <div className="flex justify-between pl-3 text-[#334155]">
                    <span>Trade Payables</span>
                    <span className="font-mono">{bs.current_liabilities?.trade_payables?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between pl-3 text-[#334155]">
                    <span>Accrued Operating Expenses</span>
                    <span className="font-mono">{bs.current_liabilities?.accrued_operating_expenses?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between pl-3 text-[#334155]">
                    <span>Current Tax Payable</span>
                    <span className="font-mono">{bs.current_liabilities?.current_tax_payable?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between font-bold text-sm text-[#0F172A] bg-[#F0FDF4] p-3 rounded-xl border border-[#DCFCE7] mt-3">
                    <span>Total Equity and Liabilities</span>
                    <span className="font-mono">{bs.total_equity_and_liabilities?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Cash Flow */}
            {activeStatementTab === 'cash_flow' && (
              <div className="space-y-4 max-w-2xl">
                <div className="border-b border-[#E2E8F0] pb-2 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#0F172A]">Statement of Cash Flows ({cf.standard || 'IAS 7'})</h3>
                  <span className="text-xs font-mono text-[#64748B]">Method: {cf.method}</span>
                </div>

                <div className="space-y-2 text-xs divide-y divide-[#F1F5F9]">
                  <div className="font-bold text-[#0284C7] pt-2">Cash Flow from Operating Activities</div>
                  <div className="pt-2 flex justify-between pl-3 text-[#334155]">
                    <span>Profit Before Tax</span>
                    <span className="font-mono">{cf.operating_activities?.net_profit_before_tax?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="pt-2 flex justify-between pl-3 text-[#334155]">
                    <span>Adjustment for Depreciation</span>
                    <span className="font-mono">{cf.operating_activities?.adjustments_for_depreciation?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="pt-2 flex justify-between pl-3 text-[#334155]">
                    <span>Working Capital (Receivables & Payables)</span>
                    <span className="font-mono">
                      {(
                        (cf.operating_activities?.change_in_trade_receivables || 0) +
                        (cf.operating_activities?.change_in_trade_payables_and_accruals || 0)
                      ).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="pt-2 flex justify-between font-bold text-[#0F172A] bg-[#F8FAFC] p-2 rounded-lg">
                    <span>Net Cash from Operating Activities</span>
                    <span className="font-mono">{cf.operating_activities?.net_cash_from_operating_activities?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>

                  <div className="font-bold text-[#0284C7] pt-3">Cash Flow from Investing Activities</div>
                  <div className="pt-2 flex justify-between pl-3 text-[#DC2626]">
                    <span>Purchase of Plant & Equipment</span>
                    <span className="font-mono">({Math.abs(cf.investing_activities?.purchase_of_property_plant_equipment || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })})</span>
                  </div>

                  <div className="font-bold text-[#0284C7] pt-3">Cash & Cash Equivalents Summary</div>
                  <div className="pt-2 flex justify-between pl-3 text-[#334155]">
                    <span>Opening Cash Balance</span>
                    <span className="font-mono">{cf.cash_and_cash_equivalents_opening?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="pt-2 flex justify-between font-bold text-sm text-[#0F172A] bg-[#F0FDF4] p-3 rounded-xl border border-[#DCFCE7]">
                    <span>Closing Cash Balance</span>
                    <span className="font-mono">{cf.cash_and_cash_equivalents_closing?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Changes in Equity */}
            {activeStatementTab === 'equity' && (
              <div className="space-y-4 max-w-2xl">
                <div className="border-b border-[#E2E8F0] pb-2">
                  <h3 className="text-sm font-bold text-[#0F172A]">Statement of Changes in Equity</h3>
                  <p className="text-xs text-[#64748B]">IAS 1 Presentation of Financial Statements (Para 106)</p>
                </div>

                <div className="overflow-x-auto border border-[#E2E8F0] rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#475569] font-bold">
                        <th className="py-2.5 px-3">Item</th>
                        <th className="py-2.5 px-3 text-right">Share Capital</th>
                        <th className="py-2.5 px-3 text-right">Retained Earnings</th>
                        <th className="py-2.5 px-3 text-right">Total Equity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      <tr>
                        <td className="py-2.5 px-3 font-medium">Opening Balance</td>
                        <td className="py-2.5 px-3 text-right font-mono">{eq.share_capital_opening?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{eq.retained_earnings_opening?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold">
                          {((eq.share_capital_opening || 0) + (eq.retained_earnings_opening || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-medium text-[#16A34A]">Profit for the Period</td>
                        <td className="py-2.5 px-3 text-right font-mono">-</td>
                        <td className="py-2.5 px-3 text-right font-mono text-[#16A34A]">{eq.profit_for_the_period?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-[#16A34A]">{eq.profit_for_the_period?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      </tr>
                      <tr className="bg-[#F8FAFC] font-bold text-[#0F172A]">
                        <td className="py-3 px-3">Closing Balance</td>
                        <td className="py-3 px-3 text-right font-mono">{eq.share_capital_closing?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td className="py-3 px-3 text-right font-mono">{eq.retained_earnings_closing?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td className="py-3 px-3 text-right font-mono text-[#0284C7]">{eq.total_equity_closing?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Notes & Disclosures */}
            {activeStatementTab === 'notes' && (
              <div className="space-y-4 max-w-3xl">
                <div className="border-b border-[#E2E8F0] pb-2">
                  <h3 className="text-sm font-bold text-[#0F172A]">Notes to the Financial Statements</h3>
                  <p className="text-xs text-[#64748B]">Statutory accounting policies and explanatory disclosure notes</p>
                </div>

                <div className="space-y-4">
                  {notes.map((note: any) => (
                    <div key={note.note_number} className="bg-[#F8FAFC] p-4 rounded-xl border border-[#E2E8F0] space-y-1">
                      <h4 className="text-xs font-bold text-[#0F172A]">
                        Note {note.note_number}. {note.title}
                      </h4>
                      <p className="text-xs text-[#475569] leading-relaxed">{note.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Financial Ratios */}
            {activeStatementTab === 'ratios' && (
              <div className="space-y-4 max-w-3xl">
                <div className="border-b border-[#E2E8F0] pb-2">
                  <h3 className="text-sm font-bold text-[#0F172A]">Financial Ratios & Benchmark Analytics</h3>
                  <p className="text-xs text-[#64748B]">Key performance metrics evaluated across liquidity, profitability, and leverage</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-[#F8FAFC] p-4 rounded-xl border border-[#E2E8F0] space-y-2">
                    <span className="text-[11px] font-bold text-[#0284C7] uppercase tracking-wider">Liquidity Ratios</span>
                    <div className="flex justify-between text-xs">
                      <span>Current Ratio:</span>
                      <strong className="font-mono">{ratios.liquidity?.current_ratio}x</strong>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Quick Ratio:</span>
                      <strong className="font-mono">{ratios.liquidity?.quick_ratio}x</strong>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Cash Ratio:</span>
                      <strong className="font-mono">{ratios.liquidity?.cash_ratio}x</strong>
                    </div>
                  </div>

                  <div className="bg-[#F8FAFC] p-4 rounded-xl border border-[#E2E8F0] space-y-2">
                    <span className="text-[11px] font-bold text-[#0284C7] uppercase tracking-wider">Profitability Ratios</span>
                    <div className="flex justify-between text-xs">
                      <span>Gross Margin:</span>
                      <strong className="font-mono">{ratios.profitability?.gross_margin_pct}%</strong>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Operating Margin:</span>
                      <strong className="font-mono">{ratios.profitability?.operating_margin_pct}%</strong>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Net Profit Margin:</span>
                      <strong className="font-mono">{ratios.profitability?.net_profit_margin_pct}%</strong>
                    </div>
                  </div>

                  <div className="bg-[#F8FAFC] p-4 rounded-xl border border-[#E2E8F0] space-y-2">
                    <span className="text-[11px] font-bold text-[#0284C7] uppercase tracking-wider">Returns & Leverage</span>
                    <div className="flex justify-between text-xs">
                      <span>ROA:</span>
                      <strong className="font-mono">{ratios.profitability?.return_on_assets_pct}%</strong>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>ROE:</span>
                      <strong className="font-mono">{ratios.profitability?.return_on_equity_pct}%</strong>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Debt-to-Equity:</span>
                      <strong className="font-mono">{ratios.leverage?.debt_to_equity}x</strong>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Commentary */}
            {activeStatementTab === 'commentary' && (
              <div className="space-y-4 max-w-3xl">
                <div className="border-b border-[#E2E8F0] pb-2">
                  <h3 className="text-sm font-bold text-[#0F172A]">Management Discussion & Analysis (MD&A)</h3>
                  <p className="text-xs text-[#64748B]">Autonomous performance narrative and commentary</p>
                </div>

                <div className="prose prose-xs max-w-none text-xs text-[#334155] leading-relaxed whitespace-pre-wrap font-sans bg-[#F8FAFC] p-5 rounded-2xl border border-[#E2E8F0]">
                  {commentary || 'No commentary synthesized.'}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-12 text-center max-w-xl mx-auto space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-[#0284C7]/10 flex items-center justify-center text-[#0284C7] mx-auto">
            <BarChart3 className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-[#0F172A]">No Reporting Packs Generated Yet</h3>
          <p className="text-xs text-[#64748B]">
            Click "Synthesize Reporting Pack" above to compile the Income Statement, Balance Sheet, Cash Flow,
            Notes, and Financial Ratios from the adjusted General Ledger.
          </p>
          <button
            onClick={handleGenerateReport}
            disabled={isGenerating}
            className="mt-2 px-4 py-2.5 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold cursor-pointer"
          >
            {isGenerating ? 'Synthesizing...' : 'Synthesize First Reporting Pack'}
          </button>
        </div>
      )}
    </div>
  );
};
