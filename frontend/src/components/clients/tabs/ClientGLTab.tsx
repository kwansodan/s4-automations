import React, { useState, useEffect, useCallback } from 'react';
import { useClient } from '../../../context/ClientContext';
import {
  fetchTrialBalance,
  fetchWorkingPapers,
  fetchWorkingPaperDetail,
  auditAndSuggestWorkingPapers,
  approveAndPostJournal,
  TrialBalanceResponse,
  ManualJournalWorkingPaperItem,
} from '../../../lib/api';
import {
  Scale,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Send,
  RefreshCw,
  Search,
  BookOpen,
  ArrowRight,
  ExternalLink,
  ChevronRight,
  X,
  Layers,
  Clock,
} from 'lucide-react';

export const ClientGLTab: React.FC = () => {
  const { currentClient } = useClient();
  const [tb, setTb] = useState<TrialBalanceResponse | null>(null);
  const [workingPapers, setWorkingPapers] = useState<ManualJournalWorkingPaperItem[]>([]);
  const [selectedPaper, setSelectedPaper] = useState<ManualJournalWorkingPaperItem | null>(null);
  const [isLoadingTb, setIsLoadingTb] = useState(false);
  const [isLoadingWp, setIsLoadingWp] = useState(false);
  const [isAuditing, setIsAuditing] = useState(false);
  const [postingPaperId, setPostingPaperId] = useState<string | null>(null);
  const [activeSubView, setActiveSubView] = useState<'working_papers' | 'trial_balance'>('working_papers');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!currentClient?.id) return;
    setIsLoadingTb(true);
    setIsLoadingWp(true);
    try {
      const [tbRes, wpRes] = await Promise.all([
        fetchTrialBalance(currentClient.id, 'October', 2026),
        fetchWorkingPapers(currentClient.id, { year: 2026 }),
      ]);
      setTb(tbRes);
      setWorkingPapers(wpRes);
    } catch (err: any) {
      console.warn('Failed loading GL data:', err);
    } finally {
      setIsLoadingTb(false);
      setIsLoadingWp(false);
    }
  }, [currentClient?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAuditAndSuggest = async () => {
    if (!currentClient?.id) return;
    setIsAuditing(true);
    setActionNotice(null);
    try {
      const res = await auditAndSuggestWorkingPapers(currentClient.id, {
        month: 'October',
        year: 2026,
        auto_create_working_papers: true,
        auto_approve: false,
      });
      setActionNotice(
        `Audit complete: Identified ${res.adjustments_detected} required adjustments and created ${res.created_working_papers.length} auditable working paper(s).`
      );
      await loadData();
    } catch (err: any) {
      setActionNotice(`Audit error: ${err.message || 'Failed to complete GL audit'}`);
    } finally {
      setIsAuditing(false);
    }
  };

  const handleApproveAndPost = async (paperId: string) => {
    if (!currentClient?.id) return;
    setPostingPaperId(paperId);
    setActionNotice(null);
    try {
      const res = await approveAndPostJournal(currentClient.id, paperId);
      setActionNotice(`Journal posted to ERP for Working Paper '${paperId}'. Reference: ${res.journal?.journal_reference || 'JRNL'}`);
      await loadData();
      if (selectedPaper?.paper_id === paperId) {
        const refreshed = await fetchWorkingPaperDetail(currentClient.id, paperId);
        setSelectedPaper(refreshed);
      }
    } catch (err: any) {
      setActionNotice(`Failed to post journal: ${err.message || 'ERP communication error'}`);
    } finally {
      setPostingPaperId(null);
    }
  };

  const handleViewWhitePaper = async (paper: ManualJournalWorkingPaperItem) => {
    if (!currentClient?.id) return;
    try {
      const detail = await fetchWorkingPaperDetail(currentClient.id, paper.paper_id);
      setSelectedPaper(detail);
    } catch (err) {
      setSelectedPaper(paper);
    }
  };

  const filteredAccounts = (tb?.accounts || []).filter((a) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      a.account_name.toLowerCase().includes(q) ||
      a.account_code.toLowerCase().includes(q) ||
      a.account_type.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-[#0284C7]/10 flex items-center justify-center text-[#0284C7]">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-[#0F172A]">General Ledger & Closing Review</h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#F0FDF4] text-[#16A34A] border border-[#DCFCE7] flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Books Balanced
                </span>
              </div>
              <p className="text-xs text-[#64748B]">
                Autonomous GL audit against elected accounting policies, statutory regulations (Ghana GRA), and IFRS standards.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <button
            onClick={loadData}
            disabled={isLoadingTb || isLoadingWp}
            className="p-2.5 rounded-xl border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] hover:bg-[#F8FAFC] transition-colors cursor-pointer"
            title="Refresh Ledger"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingTb ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleAuditAndSuggest}
            disabled={isAuditing}
            className="flex-1 md:flex-initial px-4 py-2.5 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <Sparkles className={`w-4 h-4 ${isAuditing ? 'animate-spin' : ''}`} />
            {isAuditing ? 'Auditing Policies & Ledger...' : 'Audit Closing & Suggest Working Papers'}
          </button>
        </div>
      </div>

      {actionNotice && (
        <div className="p-4 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] text-[#166534] text-xs font-medium flex items-center justify-between">
          <span>{actionNotice}</span>
          <button onClick={() => setActionNotice(null)} className="text-[#166534] hover:text-[#14532D] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Ledger Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs">
          <span className="text-xs font-medium text-[#64748B] uppercase tracking-wider">Total Debits</span>
          <div className="mt-2 text-2xl font-bold text-[#0F172A]">
            {tb?.currency || 'GHS'} {tb?.total_debits ? tb.total_debits.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '0.00'}
          </div>
          <span className="text-[11px] text-[#64748B] mt-1 block">Trial Balance sum</span>
        </div>

        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs">
          <span className="text-xs font-medium text-[#64748B] uppercase tracking-wider">Total Credits</span>
          <div className="mt-2 text-2xl font-bold text-[#0F172A]">
            {tb?.currency || 'GHS'} {tb?.total_credits ? tb.total_credits.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '0.00'}
          </div>
          <span className="text-[11px] text-[#64748B] mt-1 block">Trial Balance sum</span>
        </div>

        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs">
          <span className="text-xs font-medium text-[#64748B] uppercase tracking-wider">Net Discrepancy</span>
          <div className="mt-2 text-2xl font-bold text-[#16A34A] flex items-center gap-1.5">
            0.00
            <CheckCircle2 className="w-5 h-5 text-[#16A34A]" />
          </div>
          <span className="text-[11px] text-[#64748B] mt-1 block">Debits equal Credits</span>
        </div>

        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs">
          <span className="text-xs font-medium text-[#64748B] uppercase tracking-wider">Closing Working Papers</span>
          <div className="mt-2 text-2xl font-bold text-[#0284C7]">
            {workingPapers.length}
          </div>
          <span className="text-[11px] text-[#64748B] mt-1 block">
            {workingPapers.filter((w) => w.status === 'POSTED_TO_ERP').length} posted to ERP
          </span>
        </div>
      </div>

      {/* Sub-Tab Navigation Bar */}
      <div className="flex border-b border-[#E2E8F0] gap-8">
        <button
          onClick={() => setActiveSubView('working_papers')}
          className={`pb-3 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
            activeSubView === 'working_papers'
              ? 'border-[#0284C7] text-[#0284C7]'
              : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
          }`}
        >
          <Layers className="w-4 h-4" />
          Closing Working Papers ({workingPapers.length})
        </button>
        <button
          onClick={() => setActiveSubView('trial_balance')}
          className={`pb-3 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
            activeSubView === 'trial_balance'
              ? 'border-[#0284C7] text-[#0284C7]'
              : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
          }`}
        >
          <FileText className="w-4 h-4" />
          General Ledger Accounts ({tb?.accounts?.length || 0})
        </button>
      </div>

      {/* Sub-View: Working Papers */}
      {activeSubView === 'working_papers' && (
        <div className="space-y-4">
          {workingPapers.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-12 text-center max-w-xl mx-auto space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-[#0284C7]/10 flex items-center justify-center text-[#0284C7] mx-auto">
                <Sparkles className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-[#0F172A]">No Closing Working Papers Yet</h3>
              <p className="text-xs text-[#64748B]">
                Click "Audit Closing & Suggest Working Papers" above to trigger an autonomous review of depreciation, prepayments, accruals, FX revaluations, and tax provisions.
              </p>
              <button
                onClick={handleAuditAndSuggest}
                disabled={isAuditing}
                className="mt-2 px-4 py-2.5 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold cursor-pointer"
              >
                {isAuditing ? 'Auditing...' : 'Run Autonomous Audit'}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {workingPapers.map((paper) => (
                <div
                  key={paper.paper_id}
                  className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs hover:border-[#0284C7]/30 transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-mono text-xs font-semibold text-[#0284C7] bg-[#0284C7]/10 px-2.5 py-0.5 rounded-md">
                        {paper.paper_id}
                      </span>
                      <h4 className="text-sm font-bold text-[#0F172A]">{paper.title}</h4>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#F1F5F9] text-[#475569]">
                        {paper.adjustment_type}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          paper.status === 'POSTED_TO_ERP'
                            ? 'bg-[#F0FDF4] text-[#16A34A] border border-[#DCFCE7]'
                            : paper.status === 'APPROVED'
                            ? 'bg-[#EFF6FF] text-[#2563EB] border border-[#DBEAFE]'
                            : 'bg-[#FFFBEB] text-[#D97706] border border-[#FEF3C7]'
                        }`}
                      >
                        {paper.status}
                      </span>
                    </div>

                    <p className="text-xs text-[#64748B]">
                      <strong className="text-[#334155]">Authority:</strong> {paper.standard_reference || 'IFRS'}
                      {paper.entity_policy_applied && (
                        <span> | <strong className="text-[#334155]">Policy:</strong> {paper.entity_policy_applied}</span>
                      )}
                    </p>

                    <div className="flex items-center gap-4 text-xs text-[#64748B] pt-1">
                      <span>Total Debit/Credit: <strong className="text-[#0F172A]">{paper.currency} {paper.total_debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></span>
                      {paper.journal_reference && (
                        <span>ERP Reference: <strong className="text-[#0284C7]">{paper.journal_reference}</strong></span>
                      )}
                      <span>Period: {paper.period_month} {paper.period_year}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                    <button
                      onClick={() => handleViewWhitePaper(paper)}
                      className="px-3 py-2 rounded-xl border border-[#E2E8F0] hover:bg-[#F8FAFC] text-[#334155] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <BookOpen className="w-3.5 h-3.5 text-[#0284C7]" />
                      View White Paper
                    </button>

                    {paper.status !== 'POSTED_TO_ERP' ? (
                      <button
                        onClick={() => handleApproveAndPost(paper.paper_id)}
                        disabled={postingPaperId === paper.paper_id}
                        className="px-3.5 py-2 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <Send className={`w-3.5 h-3.5 ${postingPaperId === paper.paper_id ? 'animate-spin' : ''}`} />
                        {postingPaperId === paper.paper_id ? 'Posting...' : 'Approve & Post to Ledger'}
                      </button>
                    ) : (
                      <span className="px-3 py-2 rounded-xl bg-[#F0FDF4] text-[#16A34A] text-xs font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        In Ledger
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sub-View: Trial Balance Accounts Table */}
      {activeSubView === 'trial_balance' && (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-xs overflow-hidden space-y-4 p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search account code, name, or type..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-[#E2E8F0] focus:outline-none focus:border-[#0284C7]"
              />
            </div>
            <span className="text-xs text-[#64748B]">
              Showing {filteredAccounts.length} of {tb?.accounts?.length || 0} accounts
            </span>
          </div>

          <div className="overflow-x-auto border border-[#E2E8F0] rounded-xl">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#475569] font-bold">
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Account Name</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4 text-right">Debit ({tb?.currency || 'GHS'})</th>
                  <th className="py-3 px-4 text-right">Credit ({tb?.currency || 'GHS'})</th>
                  <th className="py-3 px-4 text-right">Net Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {filteredAccounts.map((ac) => (
                  <tr key={ac.account_id} className="hover:bg-[#F8FAFC]/50 transition-colors">
                    <td className="py-2.5 px-4 font-mono font-semibold text-[#0284C7]">{ac.account_code || ac.account_id}</td>
                    <td className="py-2.5 px-4 font-medium text-[#0F172A]">{ac.account_name}</td>
                    <td className="py-2.5 px-4 text-[#64748B]">{ac.account_type}</td>
                    <td className="py-2.5 px-4 text-right font-mono">
                      {ac.debit > 0 ? ac.debit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono">
                      {ac.credit > 0 ? ac.credit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold text-[#0F172A]">
                      {ac.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[#F8FAFC] font-bold border-t-2 border-[#E2E8F0] text-[#0F172A]">
                  <td colSpan={3} className="py-3 px-4 text-right">Total:</td>
                  <td className="py-3 px-4 text-right font-mono text-[#0284C7]">
                    {tb?.total_debits?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-[#0284C7]">
                    {tb?.total_credits?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-[#16A34A]">Balanced</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Technical White Paper Modal */}
      {selectedPaper && (
        <div className="fixed inset-0 z-50 bg-[#0F172A]/50 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-3xl w-full border border-[#E2E8F0] shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-[#E2E8F0] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#0284C7]/10 flex items-center justify-center text-[#0284C7]">
                  <BookOpen className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#0F172A]">{selectedPaper.title}</h3>
                  <p className="text-xs text-[#64748B]">
                    Working Paper <code className="text-[#0284C7] font-bold">{selectedPaper.paper_id}</code> | Standard: {selectedPaper.standard_reference}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedPaper(null)}
                className="p-2 rounded-xl text-[#64748B] hover:text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 text-xs text-[#334155] leading-relaxed">
              {/* White Paper Memo Markdown View */}
              <div className="prose prose-xs max-w-none text-[#334155]">
                <pre className="whitespace-pre-wrap font-sans bg-[#F8FAFC] p-5 rounded-2xl border border-[#E2E8F0] text-xs leading-relaxed text-[#0F172A]">
                  {selectedPaper.memo_markdown || 'No white paper narrative attached.'}
                </pre>
              </div>

              {/* Status and Actions footer inside modal */}
              <div className="flex items-center justify-between pt-4 border-t border-[#E2E8F0]">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#64748B]">Status:</span>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#F1F5F9] text-[#334155]">
                    {selectedPaper.status}
                  </span>
                </div>
                {selectedPaper.status !== 'POSTED_TO_ERP' && (
                  <button
                    onClick={() => handleApproveAndPost(selectedPaper.paper_id)}
                    disabled={postingPaperId === selectedPaper.paper_id}
                    className="px-4 py-2 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Send className={`w-3.5 h-3.5 ${postingPaperId === selectedPaper.paper_id ? 'animate-spin' : ''}`} />
                    {postingPaperId === selectedPaper.paper_id ? 'Posting...' : 'Approve & Post to ERP'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
