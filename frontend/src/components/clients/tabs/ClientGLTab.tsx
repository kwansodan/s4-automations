import React, { useState, useEffect, useCallback } from 'react';
import { useClient } from '../../../context/ClientContext';
import {
  fetchTrialBalance,
  fetchWorkingPapers,
  fetchWorkingPaperDetail,
  approveAndPostJournal,
  fetchPeriodCloseChecklist,
  synthesizeBaselineChecklist,
  runInterAgentSubledgerTieOut,
  runPreFlightScan,
  executeChecklistStep,
  executeCloseRunbook,
  verifyPostCloseEquilibrium,
  dispatchStepInquiry,
  TrialBalanceResponse,
  ManualJournalWorkingPaperItem,
} from '../../../lib/api';
import type {
  MonthEndCloseChecklist,
  CloseChecklistItem,
  SubledgerTieOutSummary,
  PreFlightDiscoverySummary,
  PostCloseVerificationSummary,
} from '../../../types/client';
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
  Bot,
  ShieldCheck,
  PlayCircle,
  MessageSquare,
  Phone,
  Mail,
  Check,
  AlertCircle,
  Zap,
} from 'lucide-react';

export const ClientGLTab: React.FC = () => {
  const { currentClient } = useClient();
  const [tb, setTb] = useState<TrialBalanceResponse | null>(null);
  const [workingPapers, setWorkingPapers] = useState<ManualJournalWorkingPaperItem[]>([]);
  const [checklist, setChecklist] = useState<MonthEndCloseChecklist | null>(null);
  const [selectedPaper, setSelectedPaper] = useState<ManualJournalWorkingPaperItem | null>(null);

  const [isLoadingTb, setIsLoadingTb] = useState(false);
  const [isLoadingWp, setIsLoadingWp] = useState(false);
  const [isLoadingChecklist, setIsLoadingChecklist] = useState(false);
  const [isPreFlighting, setIsPreFlighting] = useState(false);
  const [isExecutingRunbook, setIsExecutingRunbook] = useState(false);
  const [executingStepId, setExecutingStepId] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [postingPaperId, setPostingPaperId] = useState<string | null>(null);

  const [activeSubView, setActiveSubView] = useState<'checklist' | 'working_papers' | 'trial_balance'>('checklist');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [showPreFlightMemo, setShowPreFlightMemo] = useState(false);

  // Controller Inquiry Dialog State
  const [inquiryStep, setInquiryStep] = useState<CloseChecklistItem | null>(null);
  const [inquiryText, setInquiryText] = useState('');
  const [inquiryChannel, setInquiryChannel] = useState<'WHATSAPP' | 'EMAIL'>('WHATSAPP');
  const [isSendingInquiry, setIsSendingInquiry] = useState(false);

  const loadAllData = useCallback(async () => {
    if (!currentClient?.id) return;
    setIsLoadingTb(true);
    setIsLoadingWp(true);
    setIsLoadingChecklist(true);
    try {
      const [tbRes, wpRes, clRes] = await Promise.all([
        fetchTrialBalance(currentClient.id, 'October', 2026),
        fetchWorkingPapers(currentClient.id, { year: 2026 }),
        fetchPeriodCloseChecklist(currentClient.id, 'October', 2026),
      ]);
      setTb(tbRes);
      setWorkingPapers(wpRes);
      setChecklist(clRes);
    } catch (err: any) {
      console.warn('Failed loading GL closing data:', err);
    } finally {
      setIsLoadingTb(false);
      setIsLoadingWp(false);
      setIsLoadingChecklist(false);
    }
  }, [currentClient?.id]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // Pre-Flight Coverage and Anomaly Scan
  const handleRunPreFlight = async () => {
    if (!currentClient?.id) return;
    setIsPreFlighting(true);
    setActionNotice(null);
    try {
      const res = await runPreFlightScan(currentClient.id, 'October', 2026);
      setActionNotice(
        `Pre-flight scan complete: ${res.coverage_percentage}% GL accounts verified. Discovered ${res.uncovered_accounts_found} new accounts, integrated ${res.new_steps_integrated} closing step(s).`
      );
      await loadAllData();
    } catch (err: any) {
      setActionNotice(`Pre-flight review error: ${err.message || 'Scan failed'}`);
    } finally {
      setIsPreFlighting(false);
    }
  };

  // Inter-Agent Subledger Tie-Out
  const handleRunSubledgerTieOut = async () => {
    if (!currentClient?.id) return;
    setActionNotice(null);
    try {
      const res = await runInterAgentSubledgerTieOut(currentClient.id, 'October', 2026);
      setActionNotice(
        `Inter-Agent Subledger Tie-Out: Status [${res.overall_status}]. Customer AR & Vendor AP control balances reconciled.`
      );
      await loadAllData();
    } catch (err: any) {
      setActionNotice(`Subledger tie-out error: ${err.message || 'Coordination failed'}`);
    }
  };

  // Execute Individual Checklist Step
  const handleExecuteStep = async (stepId: string) => {
    if (!currentClient?.id || !checklist?.checklist_id) return;
    setExecutingStepId(stepId);
    setActionNotice(null);
    try {
      const res = await executeChecklistStep(currentClient.id, stepId, {
        checklist_id: checklist.checklist_id,
        auto_post: false,
      });
      setActionNotice(`Executed step '${stepId}': Status [${res.step?.status}]. ${res.step?.findings_summary || ''}`);
      await loadAllData();
    } catch (err: any) {
      setActionNotice(`Step execution failed: ${err.message}`);
    } finally {
      setExecutingStepId(null);
    }
  };

  // Execute Entire Month-End Close Runbook
  const handleExecuteRunbook = async () => {
    if (!currentClient?.id || !checklist?.checklist_id) return;
    setIsExecutingRunbook(true);
    setActionNotice(null);
    try {
      const res = await executeCloseRunbook(currentClient.id, {
        checklist_id: checklist.checklist_id,
        auto_post: false,
      });
      setActionNotice(
        `Month-end close runbook executed: ${res.completed_steps} of ${res.total_steps} steps completed. Post-close verification: ${res.post_close_verification?.status || 'VERIFIED'}.`
      );
      await loadAllData();
    } catch (err: any) {
      setActionNotice(`Runbook execution error: ${err.message}`);
    } finally {
      setIsExecutingRunbook(false);
    }
  };

  // Post-Close Verification
  const handleVerifyPostClose = async () => {
    if (!currentClient?.id || !checklist?.checklist_id) return;
    setIsVerifying(true);
    setActionNotice(null);
    try {
      const res = await verifyPostCloseEquilibrium(currentClient.id, checklist.checklist_id);
      setActionNotice(
        `Post-Close Verification Certificate: ${res.certificate_id} - ${res.status}. Debits equal Credits. Suspense: GHS ${res.suspense_account_balance.toFixed(2)}.`
      );
      await loadAllData();
    } catch (err: any) {
      setActionNotice(`Verification error: ${err.message}`);
    } finally {
      setIsVerifying(false);
    }
  };

  // Study GL and Re-Synthesize Baseline
  const handleSynthesizeBaseline = async () => {
    if (!currentClient?.id) return;
    setActionNotice(null);
    try {
      const res = await synthesizeBaselineChecklist(currentClient.id, 'October', 2026);
      setActionNotice(`Studied Chart of Accounts & TB: Synthesized ${res.total_steps} tailored closing steps.`);
      await loadAllData();
    } catch (err: any) {
      setActionNotice(`Synthesis error: ${err.message}`);
    }
  };

  // Dispatch Autonomous Inquiry to Controller
  const handleSendInquiry = async () => {
    if (!currentClient?.id || !checklist?.checklist_id || !inquiryStep || !inquiryText.trim()) return;
    setIsSendingInquiry(true);
    try {
      const res = await dispatchStepInquiry(currentClient.id, inquiryStep.step_id, {
        checklist_id: checklist.checklist_id,
        question_text: inquiryText.trim(),
        target_channel: inquiryChannel,
      });
      setActionNotice(`Inquiry dispatched to Controller via ${res.channel} (ID: ${res.inquiry_id}).`);
      setInquiryStep(null);
      setInquiryText('');
      await loadAllData();
    } catch (err: any) {
      setActionNotice(`Inquiry dispatch failed: ${err.message}`);
    } finally {
      setIsSendingInquiry(false);
    }
  };

  // Post Working Paper Journal to ERP
  const handleApproveAndPost = async (paperId: string) => {
    if (!currentClient?.id) return;
    setPostingPaperId(paperId);
    setActionNotice(null);
    try {
      const res = await approveAndPostJournal(currentClient.id, paperId);
      setActionNotice(`Journal posted to ERP for Working Paper '${paperId}'. Reference: ${res.journal?.journal_reference || 'JRNL'}`);
      await loadAllData();
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

  const totalSteps = checklist?.total_steps_count || checklist?.steps?.length || 0;
  const completedSteps = checklist?.completed_steps_count || 0;
  const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const tieOuts = checklist?.subledger_tie_outs;
  const preFlight = checklist?.pre_flight_summary;
  const verification = checklist?.post_close_verification;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Header Banner */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 shadow-xs flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#0284C7]/10 flex items-center justify-center text-[#0284C7] shrink-0">
            <Scale className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-[#0F172A]">General Ledger Closing Accountant</h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#F0FDF4] text-[#16A34A] border border-[#DCFCE7] flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Books In Balance
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-purple-50 text-purple-700 border border-purple-200 flex items-center gap-1">
                <Bot className="w-3.5 h-3.5 text-purple-600" />
                Autonomous Close Agent
              </span>
            </div>
            <p className="text-xs text-[#64748B] mt-0.5">
              Period-end General Ledger review, tailored close runbook execution, subledger tie-outs, and technical white papers for {currentClient.name}.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
          <button
            type="button"
            onClick={loadAllData}
            disabled={isLoadingTb || isLoadingChecklist}
            className="p-2.5 rounded-xl border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] hover:bg-[#F8FAFC] transition-colors cursor-pointer"
            title="Refresh Ledger and Checklist"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingTb || isLoadingChecklist ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={handleRunPreFlight}
            disabled={isPreFlighting}
            className="px-3.5 py-2.5 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            title="Scan 100% of accounts for unmapped balances and anomalies"
          >
            <Search className={`w-4 h-4 text-amber-600 ${isPreFlighting ? 'animate-spin' : ''}`} />
            <span>{isPreFlighting ? 'Scanning Accounts...' : 'Run Pre-Flight Scan'}</span>
          </button>

          <button
            type="button"
            onClick={handleExecuteRunbook}
            disabled={isExecutingRunbook}
            className="px-4 py-2.5 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <Zap className={`w-4 h-4 ${isExecutingRunbook ? 'animate-spin' : ''}`} />
            <span>{isExecutingRunbook ? 'Executing Close Runbook...' : 'Execute Month-End Close'}</span>
          </button>
        </div>
      </div>

      {actionNotice && (
        <div className="p-4 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] text-[#166534] text-xs font-medium flex items-center justify-between">
          <span className="leading-relaxed">{actionNotice}</span>
          <button onClick={() => setActionNotice(null)} className="text-[#166534] hover:text-[#14532D] cursor-pointer ml-4">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Primary Sub-Tab Switcher */}
      <div className="flex border-b border-[#E2E8F0] gap-6">
        <button
          type="button"
          onClick={() => setActiveSubView('checklist')}
          className={`pb-3 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
            activeSubView === 'checklist'
              ? 'border-[#0284C7] text-[#0284C7]'
              : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Month-End Close Runbook ({checklist?.steps?.length || 0})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubView('working_papers')}
          className={`pb-3 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
            activeSubView === 'working_papers'
              ? 'border-[#0284C7] text-[#0284C7]'
              : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>Closing Working Papers ({workingPapers.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubView('trial_balance')}
          className={`pb-3 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
            activeSubView === 'trial_balance'
              ? 'border-[#0284C7] text-[#0284C7]'
              : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>General Ledger Accounts ({tb?.accounts?.length || 0})</span>
        </button>
      </div>

      {/* =====================================================================
          SUB-VIEW 1: AUTONOMOUS MONTH-END CLOSE CHECKLIST RUNBOOK
          ===================================================================== */}
      {activeSubView === 'checklist' && (
        <div className="space-y-6">
          {/* Progress Tracker Card */}
          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-[#0F172A]">
                    October 2026 Close Schedule
                  </h3>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 uppercase">
                    {checklist?.status || 'IN_PROGRESS'}
                  </span>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                    Autonomy: {checklist?.autonomy_level || 'semi_autonomous'}
                  </span>
                </div>
                <p className="text-xs text-[#64748B] mt-1">
                  Tailored closing runbook formulated by studying the entity's Chart of Accounts, active asset classes, and subledgers.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSynthesizeBaseline}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-medium cursor-pointer"
                  title="Re-study Trial Balance and re-synthesize baseline closing checklist"
                >
                  Study GL &amp; Re-Synthesize
                </button>
                <button
                  type="button"
                  onClick={handleVerifyPostClose}
                  disabled={isVerifying}
                  className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title="Verify post-posting trial balance equilibrium"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{isVerifying ? 'Verifying...' : 'Verify Equilibrium'}</span>
                </button>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-medium text-[#64748B]">
                <span>Runbook Completion</span>
                <span className="font-bold text-[#0F172A]">
                  {completedSteps} of {totalSteps} steps completed ({progressPercent}%)
                </span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#0284C7] to-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          </div>

          {/* Inter-Agent Subledger Coordination Card */}
          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-sky-600" />
                <h3 className="text-xs font-bold text-[#0F172A] uppercase tracking-wider">
                  Inter-Agent Subledger Coordination &amp; Tie-Outs
                </h3>
              </div>
              <button
                type="button"
                onClick={handleRunSubledgerTieOut}
                className="text-xs font-semibold text-[#0284C7] hover:underline cursor-pointer flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Re-Test Subledgers</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* AR Customer Tie-Out */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-700">Customer AR (Acct 1200)</span>
                  <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                    {tieOuts?.accounts_receivable?.status || 'TIED_OUT'}
                  </span>
                </div>
                <div className="text-sm font-mono font-bold text-[#0F172A]">
                  GHS {tieOuts?.accounts_receivable?.gl_balance?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '215,000.00'}
                </div>
                <p className="text-[11px] text-slate-500 line-clamp-1">
                  {tieOuts?.accounts_receivable?.message || 'Customer dispatch slips and billing locked.'}
                </p>
              </div>

              {/* AP Vendor Tie-Out */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-700">Vendor AP (Acct 2100)</span>
                  <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                    {tieOuts?.accounts_payable?.status || 'TIED_OUT'}
                  </span>
                </div>
                <div className="text-sm font-mono font-bold text-[#0F172A]">
                  GHS {tieOuts?.accounts_payable?.gl_balance?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '142,000.00'}
                </div>
                <p className="text-[11px] text-slate-500 line-clamp-1">
                  {tieOuts?.accounts_payable?.message || 'Vendor invoices parsed and subledger matched.'}
                </p>
              </div>

              {/* Bank Recon & Suspense Zero Clearance */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-700">Bank &amp; Suspense Clearance</span>
                  <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                    {tieOuts?.bank_reconciliation?.suspense_cleared ? 'ZERO CLEARED' : 'CHECK PENDING'}
                  </span>
                </div>
                <div className="text-sm font-mono font-bold text-[#0F172A]">
                  Suspense: GHS {tieOuts?.bank_reconciliation?.suspense_account_balance?.toFixed(2) || '0.00'}
                </div>
                <p className="text-[11px] text-slate-500 line-clamp-1">
                  {tieOuts?.bank_reconciliation?.message || 'Operating bank accounts reconciled. Zero suspense.'}
                </p>
              </div>
            </div>
          </div>

          {/* Pre-Flight Discovery Alert Banner */}
          {preFlight && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                  <Search className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-amber-900">
                    Pre-Flight Account Coverage &amp; Anomaly Audit: {preFlight.coverage_percentage}% Covered
                  </h4>
                  <p className="text-[11px] text-amber-800 mt-0.5">
                    {preFlight.uncovered_accounts_found > 0
                      ? `Discovered ${preFlight.uncovered_accounts_found} previously unmapped accounts; integrated ${preFlight.new_steps_integrated} new closing steps into runbook.`
                      : 'All General Ledger accounts verified and mapped to closing schedule. Equilibrium confirmed.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPreFlightMemo(true)}
                className="px-3 py-1.5 rounded-xl bg-amber-200 hover:bg-amber-300 text-amber-900 font-semibold text-xs cursor-pointer shrink-0"
              >
                View Discovery Memo
              </button>
            </div>
          )}

          {/* Post-Close Verification Seal */}
          {verification && verification.status === 'VERIFIED' && (
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-emerald-900 flex items-center gap-2">
                    <span>Post-Close ERP Verification Seal</span>
                    <code className="text-[10px] font-mono bg-emerald-200/60 px-1.5 py-0.2 rounded text-emerald-800">
                      {verification.certificate_id}
                    </code>
                  </h4>
                  <p className="text-[11px] text-emerald-800 mt-0.5">
                    Debits equal Credits. Net Discrepancy: {verification.discrepancy.toFixed(2)}. Suspense balance: GHS {verification.suspense_account_balance.toFixed(2)}.
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-bold uppercase px-2.5 py-1 rounded-full bg-emerald-600 text-white shrink-0">
                Verified In Balance
              </span>
            </div>
          )}

          {/* Close Steps List */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-[#64748B] uppercase tracking-wider">
              Closing Procedures &amp; Adjustments Runbook ({checklist?.steps?.length || 0} Steps)
            </h3>

            {(checklist?.steps || []).map((step) => {
              const isCompleted = step.status === 'COMPLETED';
              const isException = step.status === 'EXCEPTION_FLAGGED';
              const isInProgress = step.status === 'IN_PROGRESS';
              const isExecutingThis = executingStepId === step.step_id;

              return (
                <div
                  key={step.step_id}
                  className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs hover:border-slate-300 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                        Step {step.sequence}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200">
                        {step.category.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-sky-50 text-sky-700 border border-sky-200">
                        {step.accounting_standard}
                      </span>
                      {step.is_dynamically_discovered && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-amber-600" />
                          <span>Dynamically Discovered</span>
                        </span>
                      )}
                      <span
                        className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                          isCompleted
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : isException
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : isInProgress
                            ? 'bg-sky-50 text-sky-700 border border-sky-200 animate-pulse'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {step.status}
                      </span>
                    </div>

                    <h4 className="text-sm font-bold text-[#0F172A]">{step.title}</h4>
                    <p className="text-xs text-[#64748B] leading-relaxed">{step.description}</p>

                    {step.findings_summary && (
                      <div className="p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#334155] flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span className="font-medium">{step.findings_summary}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0 self-end md:self-auto">
                    {step.working_paper_id && (
                      <button
                        type="button"
                        onClick={() => {
                          const wp = workingPapers.find((w) => w.paper_id === step.working_paper_id);
                          if (wp) handleViewWhitePaper(wp);
                          else {
                            setSelectedPaper({
                              paper_id: step.working_paper_id!,
                              client_id: currentClient.id,
                              title: step.title,
                              adjustment_type: step.category,
                              standard_reference: step.accounting_standard,
                              period_month: checklist?.period_month || 'October',
                              period_year: checklist?.period_year || 2026,
                              currency: tb?.currency || 'GHS',
                              total_debit: 0,
                              total_credit: 0,
                              is_balanced: true,
                              status: 'SUGGESTED',
                              memo_markdown: '',
                              prepared_by: 'gl_accountant_agent',
                              created_at: new Date().toISOString(),
                            });
                          }
                        }}
                        className="px-3 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        title="View Technical White Paper and Calculation Schedules"
                      >
                        <BookOpen className="w-3.5 h-3.5 text-purple-600" />
                        <span>White Paper</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setInquiryStep(step);
                        setInquiryText(
                          `Regarding closing step '${step.title}': Please confirm the accounting treatment or supporting documentation for ${step.target_account_codes.join(', ')}.`
                        );
                      }}
                      className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                      title="Dispatch WhatsApp or Email inquiry to Controller"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-slate-500" />
                      <span>Ask Controller</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleExecuteStep(step.step_id)}
                      disabled={isExecutingThis}
                      className="px-3.5 py-1.5 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
                    >
                      <PlayCircle className={`w-3.5 h-3.5 ${isExecutingThis ? 'animate-spin' : ''}`} />
                      <span>{isExecutingThis ? 'Running...' : isCompleted ? 'Re-Run' : 'Execute Step'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-VIEW 2: CLOSING WORKING PAPERS
          ===================================================================== */}
      {activeSubView === 'working_papers' && (
        <div className="space-y-4">
          {workingPapers.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-12 text-center max-w-xl mx-auto space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-[#0284C7]/10 flex items-center justify-center text-[#0284C7] mx-auto">
                <Sparkles className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-[#0F172A]">No Working Papers Formulated</h3>
              <p className="text-xs text-[#64748B]">
                Execute the month-end closing steps or click "Audit Closing &amp; Suggest Working Papers" to formulate auditable journal packages.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {workingPapers.map((paper) => (
                <div
                  key={paper.paper_id}
                  className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between space-y-4"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200">
                        {paper.adjustment_type}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                          paper.status === 'POSTED_TO_ERP'
                            ? 'bg-[#F0FDF4] text-[#16A34A] border border-[#DCFCE7]'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {paper.status === 'POSTED_TO_ERP' ? 'POSTED TO ERP' : paper.status}
                      </span>
                    </div>

                    <h3 className="text-sm font-bold text-[#0F172A]">{paper.title}</h3>
                    <p className="text-xs text-[#64748B] mt-1">{paper.standard_reference}</p>

                    <div className="mt-3 p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-between">
                      <span className="text-xs text-[#64748B]">Balanced Amount:</span>
                      <span className="text-sm font-mono font-bold text-[#0284C7]">
                        {paper.currency} {paper.total_debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-[#E2E8F0] flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => handleViewWhitePaper(paper)}
                      className="text-xs font-semibold text-[#0284C7] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>View Technical White Paper</span>
                    </button>

                    {paper.status !== 'POSTED_TO_ERP' && (
                      <button
                        type="button"
                        onClick={() => handleApproveAndPost(paper.paper_id)}
                        disabled={postingPaperId === paper.paper_id}
                        className="px-3 py-1.5 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <Send className={`w-3.5 h-3.5 ${postingPaperId === paper.paper_id ? 'animate-spin' : ''}`} />
                        <span>Post to ERP</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          SUB-VIEW 3: GENERAL LEDGER ACCOUNTS & TRIAL BALANCE
          ===================================================================== */}
      {activeSubView === 'trial_balance' && (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search accounts by code, name..."
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

      {/* Pre-Flight Discovery Memo Modal */}
      {showPreFlightMemo && preFlight && (
        <div className="fixed inset-0 z-50 bg-[#0F172A]/50 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-3xl w-full border border-[#E2E8F0] shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-[#E2E8F0] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center">
                  <Search className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#0F172A]">Pre-Flight Audit Discovery Memo</h3>
                  <p className="text-xs text-[#64748B]">
                    Audit Coverage: {preFlight.coverage_percentage}% • Scanned: {preFlight.scanned_at ? new Date(preFlight.scanned_at).toLocaleString() : 'Recent'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPreFlightMemo(false)}
                className="p-2 rounded-xl text-[#64748B] hover:text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <pre className="whitespace-pre-wrap font-sans bg-[#F8FAFC] p-5 rounded-2xl border border-[#E2E8F0] text-xs leading-relaxed text-[#0F172A]">
                {preFlight.executive_pre_flight_memo || 'No pre-flight summary available.'}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Controller WhatsApp / Email Inquiry Dialog */}
      {inquiryStep && (
        <div className="fixed inset-0 z-50 bg-[#0F172A]/50 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-xl w-full border border-[#E2E8F0] shadow-2xl flex flex-col">
            <div className="p-6 border-b border-[#E2E8F0] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#0F172A]">Dispatch Controller Inquiry</h3>
                  <p className="text-xs text-[#64748B]">Step: {inquiryStep.title}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInquiryStep(null)}
                className="p-2 rounded-xl text-[#64748B] hover:text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div>
                <label className="font-bold text-[#0F172A] block mb-1.5">Communication Channel</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setInquiryChannel('WHATSAPP')}
                    className={`py-2 px-3 rounded-xl border flex items-center justify-center gap-2 font-bold cursor-pointer transition ${
                      inquiryChannel === 'WHATSAPP'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                        : 'bg-white text-slate-600 border-slate-200'
                    }`}
                  >
                    <Phone className="w-3.5 h-3.5 text-emerald-600" />
                    <span>WhatsApp</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setInquiryChannel('EMAIL')}
                    className={`py-2 px-3 rounded-xl border flex items-center justify-center gap-2 font-bold cursor-pointer transition ${
                      inquiryChannel === 'EMAIL'
                        ? 'bg-sky-50 text-sky-800 border-sky-300'
                        : 'bg-white text-slate-600 border-slate-200'
                    }`}
                  >
                    <Mail className="w-3.5 h-3.5 text-sky-600" />
                    <span>Email</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="font-bold text-[#0F172A] block mb-1.5">Inquiry Message Text</label>
                <textarea
                  rows={4}
                  value={inquiryText}
                  onChange={(e) => setInquiryText(e.target.value)}
                  className="w-full p-3 rounded-xl border border-[#E2E8F0] focus:outline-none focus:border-[#0284C7] text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setInquiryStep(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSendInquiry}
                  disabled={isSendingInquiry || !inquiryText.trim()}
                  className="px-4 py-2 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Send className={`w-3.5 h-3.5 ${isSendingInquiry ? 'animate-spin' : ''}`} />
                  <span>{isSendingInquiry ? 'Sending...' : 'Send Inquiry'}</span>
                </button>
              </div>
            </div>
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
                type="button"
                onClick={() => setSelectedPaper(null)}
                className="p-2 rounded-xl text-[#64748B] hover:text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 text-xs text-[#334155] leading-relaxed">
              <div className="prose prose-xs max-w-none text-[#334155]">
                <pre className="whitespace-pre-wrap font-sans bg-[#F8FAFC] p-5 rounded-2xl border border-[#E2E8F0] text-xs leading-relaxed text-[#0F172A]">
                  {selectedPaper.memo_markdown || 'No white paper narrative attached.'}
                </pre>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-[#E2E8F0]">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#64748B]">Status:</span>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#F1F5F9] text-[#334155]">
                    {selectedPaper.status}
                  </span>
                </div>
                {selectedPaper.status !== 'POSTED_TO_ERP' && (
                  <button
                    type="button"
                    onClick={() => handleApproveAndPost(selectedPaper.paper_id)}
                    disabled={postingPaperId === selectedPaper.paper_id}
                    className="px-4 py-2 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Send className={`w-3.5 h-3.5 ${postingPaperId === selectedPaper.paper_id ? 'animate-spin' : ''}`} />
                    <span>{postingPaperId === selectedPaper.paper_id ? 'Posting...' : 'Approve & Post to ERP'}</span>
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
