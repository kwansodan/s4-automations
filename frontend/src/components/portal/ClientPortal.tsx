import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Mail,
  KeyRound,
  ArrowRight,
  HelpCircle,
  CheckCircle2,
  Clock,
  Send,
  Building,
  LogOut,
  AlertCircle,
  FileText,
  DollarSign,
  Search,
  Paperclip,
  UploadCloud,
  Trash2,
} from 'lucide-react';

interface BankTransaction {
  id: number;
  client_id: string;
  transaction_date: string;
  description: string;
  amount: number;
  transaction_type: string;
  status: string;
  client_explanation?: string;
  accountant_query?: string;
  client_attachments?: Array<{ name: string; size?: number; type?: string }>;
}

export const ClientPortal: React.FC<{ onBackToAdmin?: () => void }> = ({ onBackToAdmin }) => {
  const [sessionToken, setSessionToken] = useState<string | null>(() => localStorage.getItem('s4_portal_token'));
  const [clientInfo, setClientInfo] = useState<any | null>(() => {
    const saved = localStorage.getItem('s4_portal_client');
    return saved ? JSON.parse(saved) : null;
  });

  // Login Form States
  const [identifier, setIdentifier] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpHint, setOtpHint] = useState<string | null>(null);
  const [isRequestingOtp, setIsRequestingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Transactions State
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [isLoadingTx, setIsLoadingTx] = useState(false);
  const [explanationInputs, setExplanationInputs] = useState<{ [id: number]: string }>({});
  const [attachmentsMap, setAttachmentsMap] = useState<{ [id: number]: Array<{ name: string; size?: number; type?: string }> }>({});
  const [submittingIds, setSubmittingIds] = useState<{ [id: number]: boolean }>({});
  const [searchFilter, setSearchFilter] = useState('');

  // Load Transactions when logged in
  const fetchPortalTransactions = async () => {
    if (!sessionToken) return;
    setIsLoadingTx(true);
    try {
      const res = await fetch('/api/v1/portal/transactions', {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      const data = await res.json();
      setTransactions(Array.isArray(data) ? data : []);
      // Initialize inputs with existing explanations and attachments
      const initialInputs: { [id: number]: string } = {};
      const initialAttachments: { [id: number]: Array<{ name: string; size?: number; type?: string }> } = {};
      if (Array.isArray(data)) {
        data.forEach((tx) => {
          if (tx.client_explanation) {
            initialInputs[tx.id] = tx.client_explanation;
          }
          if (tx.client_attachments && tx.client_attachments.length > 0) {
            initialAttachments[tx.id] = tx.client_attachments;
          }
        });
      }
      setExplanationInputs(initialInputs);
      setAttachmentsMap(initialAttachments);
    } catch (err: any) {
      console.error('Error fetching portal transactions:', err);
    } finally {
      setIsLoadingTx(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const magicToken = params.get('portal_magic') || params.get('magic_token');
    if (magicToken) {
      (async () => {
        try {
          const res = await fetch(`/api/v1/portal/magic-access?token=${encodeURIComponent(magicToken)}`);
          if (res.ok) {
            const data = await res.json();
            setSessionToken(data.token);
            setClientInfo(data.client);
            localStorage.setItem('s4_portal_token', data.token);
            localStorage.setItem('s4_portal_client', JSON.stringify(data.client));
          }
        } catch (e) {
          console.error('Magic link login error:', e);
        }
      })();
    }
  }, []);

  useEffect(() => {
    if (sessionToken) {
      fetchPortalTransactions();
    }
  }, [sessionToken]);

  // Request OTP
  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) return;
    setIsRequestingOtp(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/v1/portal/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || 'Failed to request OTP');
      }
      setOtpSent(true);
      if (data.dev_hint) {
        setOtpHint(data.dev_hint);
      }
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsRequestingOtp(false);
    }
  };

  // Verify OTP
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim()) return;
    setIsVerifyingOtp(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/v1/portal/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: identifier.trim(),
          otp: otpCode.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || 'Verification failed');
      }
      setSessionToken(data.token);
      setClientInfo(data.client);
      localStorage.setItem('s4_portal_token', data.token);
      localStorage.setItem('s4_portal_client', JSON.stringify(data.client));
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  // Submit Explanation
  const handleSubmitExplanation = async (txId: number) => {
    const text = explanationInputs[txId]?.trim();
    if (!text) return;

    setSubmittingIds((prev) => ({ ...prev, [txId]: true }));
    try {
      const res = await fetch(`/api/v1/portal/transactions/${txId}/explain`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          client_explanation: text,
          client_attachments: attachmentsMap[txId] || [],
        }),
      });
      if (res.ok) {
        const result = await res.json();
        setTransactions((prev) =>
          prev.map((t) =>
            t.id === txId
              ? {
                  ...t,
                  client_explanation: text,
                  client_attachments: attachmentsMap[txId] || [],
                  status: 'CLIENT_ANSWERED',
                }
              : t
          )
        );
      }
    } catch (err) {
      console.error('Failed submitting explanation:', err);
    } finally {
      setSubmittingIds((prev) => ({ ...prev, [txId]: false }));
    }
  };

  const handleLogout = () => {
    setSessionToken(null);
    setClientInfo(null);
    localStorage.removeItem('s4_portal_token');
    localStorage.removeItem('s4_portal_client');
    setOtpSent(false);
    setOtpCode('');
    setOtpHint(null);
  };

  const filteredTxs = transactions.filter((t) => {
    if (!searchFilter) return true;
    const query = searchFilter.trim().toLowerCase();
    return (
      (t.description || '').toLowerCase().includes(query) ||
      (t.transaction_date || '').includes(query) ||
      (t.accountant_query && t.accountant_query.toLowerCase().includes(query)) ||
      (t.client_explanation && t.client_explanation.toLowerCase().includes(query))
    );
  });

  const pendingCount = transactions.filter((t) => t.status !== 'CLIENT_ANSWERED').length;
  const answeredCount = transactions.filter((t) => t.status === 'CLIENT_ANSWERED').length;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex flex-col font-sans selection:bg-[#0EA5E9]/20 selection:text-[#0284C7]">
      {/* Top Navigation */}
      <header className="border-b border-[#E2E8F0] bg-white/90 backdrop-blur-md sticky top-0 z-40 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#0284C7] to-[#38BDF8] flex items-center justify-center text-white shadow-xs font-black text-xl">
              S4
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-[#0F172A] tracking-tight">S4 Automations</span>
                <span className="bg-[#F0F9FF] text-[#0284C7] border border-[#BAE6FD] text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                  Client Clarification Portal
                </span>
              </div>
              <p className="text-[11px] text-[#64748B] font-medium">Information Requests &amp; Watched Account Clarifications</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {onBackToAdmin && (
              <button
                onClick={onBackToAdmin}
                className="text-xs font-semibold text-slate-700 hover:bg-slate-50 bg-white border border-[#E2E8F0] px-3 py-1.5 rounded-lg transition cursor-pointer shadow-xs"
              >
                Back to Firm Dashboard
              </button>
            )}
            {sessionToken && (
              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <p className="text-xs font-bold text-[#0F172A]">{clientInfo?.name || 'Client Portal'}</p>
                  <p className="text-[10px] text-slate-500 font-medium flex items-center justify-end gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#059669] animate-pulse"></span>
                    Verified Session
                  </p>
                </div>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-[#E2E8F0] text-xs font-semibold px-3 py-2 rounded-xl transition cursor-pointer shadow-xs"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Sign Out</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!sessionToken ? (
          /* OTP Login Card */
          <div className="max-w-md mx-auto mt-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white border border-[#E2E8F0] rounded-3xl p-8 shadow-sm relative overflow-hidden">
              <div className="text-center mb-8">
                <div className="w-14 h-14 bg-[#F0F9FF] border border-[#BAE6FD] rounded-2xl flex items-center justify-center text-[#0284C7] mx-auto mb-4 shadow-xs">
                  <ShieldCheck className="w-7 h-7" />
                </div>
                <h2 className="text-2xl font-bold text-[#0F172A] tracking-tight">Client Secure Access</h2>
                <p className="text-xs text-[#64748B] mt-1 max-w-xs mx-auto font-normal">
                  Login via email OTP to review and clarify monthly transactions in watched accounts for your accounting team.
                </p>
              </div>

              {authError && (
                <div className="mb-6 p-3.5 bg-[#FFF1F2] border border-[#FECDD3] rounded-xl text-xs text-[#E11D48] flex items-start gap-2.5 font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#E11D48]" />
                  <span>{authError}</span>
                </div>
              )}

              {!otpSent ? (
                <form onSubmit={handleRequestOtp} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">
                      Business Email or Organization ID
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        placeholder="e.g. anr_group or accounts@luxwood.com"
                        required
                        className="w-full bg-white border border-[#E2E8F0] rounded-xl px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#0284C7] font-medium transition shadow-xs"
                      />
                      <Building className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
                    </div>
                    <p className="text-[11px] text-[#64748B] mt-1.5">
                      Enter your company code or registered contact email.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={isRequestingOtp}
                    className="w-full bg-[#0284C7] hover:bg-[#0EA5E9] text-white font-bold py-3.5 px-4 rounded-xl transition shadow-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 text-sm"
                  >
                    {isRequestingOtp ? (
                      <Clock className="w-4 h-4 animate-spin text-white" />
                    ) : (
                      <>
                        <span>Send 6-Digit Login Code</span>
                        <ArrowRight className="w-4 h-4 text-white" />
                      </>
                    )}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp} className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                        Enter 6-Digit OTP Code
                      </label>
                      <button
                        type="button"
                        onClick={() => setOtpSent(false)}
                        className="text-[11px] text-[#0284C7] hover:underline cursor-pointer"
                      >
                        Change Email
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        maxLength={6}
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="123456"
                        required
                        autoFocus
                        className="w-full bg-white border border-[#E2E8F0] rounded-xl px-4 py-3 text-center text-xl tracking-widest font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#0284C7] transition shadow-xs"
                      />
                      <KeyRound className="w-4 h-4 text-slate-400 absolute right-3.5 top-4" />
                    </div>
                    {otpHint && (
                      <p className="text-[11px] text-[#0284C7] font-mono mt-2 bg-[#F0F9FF] border border-[#BAE6FD] p-2 rounded-lg text-center">
                        {otpHint}
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={isVerifyingOtp || otpCode.length !== 6}
                    className="w-full bg-[#059669] hover:bg-[#047857] text-white font-bold py-3.5 px-4 rounded-xl transition shadow-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 text-sm"
                  >
                    {isVerifyingOtp ? (
                      <Clock className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Verify &amp; Enter Portal</span>
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>
        ) : (
          /* Client Portal Dashboard */
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header Banner & Stats */}
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">
                    Welcome, {clientInfo?.name || 'Valued Client'}
                  </h1>
                  <span className="bg-[#F0F9FF] border border-[#BAE6FD] text-[#0284C7] text-xs font-semibold px-2.5 py-0.5 rounded-full">
                    {clientInfo?.industry || 'Accounting Services'}
                  </span>
                </div>
                <p className="text-xs text-[#64748B] mt-1 max-w-2xl font-normal">
                  Your accounting team at S4 Automations has ingested recent bank statement lines. Please review any
                  unexplained deposits, withdrawals, or queries below and provide short written explanations.
                </p>
              </div>

              {/* Stat Counters */}
              <div className="flex items-center gap-3 shrink-0">
                <div className="bg-white border border-[#E2E8F0] rounded-xl p-3.5 text-center min-w-[110px] shadow-xs">
                  <p className="text-[10px] font-semibold text-[#64748B] uppercase tracking-wider">Needs Attention</p>
                  <p className="text-2xl font-bold font-mono text-[#E11D48] mt-0.5">{pendingCount}</p>
                </div>
                <div className="bg-white border border-[#E2E8F0] rounded-xl p-3.5 text-center min-w-[110px] shadow-xs">
                  <p className="text-[10px] font-semibold text-[#64748B] uppercase tracking-wider">Answered</p>
                  <p className="text-2xl font-bold font-mono text-[#059669] mt-0.5">{answeredCount}</p>
                </div>
              </div>
            </div>

            {/* Filter / Search Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="relative w-full sm:w-80">
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Search transactions or queries..."
                  className="w-full bg-white border border-[#E2E8F0] rounded-xl pl-9 pr-4 py-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#0284C7] shadow-xs"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
              </div>

              <button
                onClick={fetchPortalTransactions}
                disabled={isLoadingTx}
                className="flex items-center gap-1.5 bg-white hover:bg-slate-50 border border-[#E2E8F0] text-slate-700 text-xs font-semibold px-3 py-2 rounded-xl transition cursor-pointer shadow-xs"
              >
                <Clock className={`w-3.5 h-3.5 text-[#0284C7] ${isLoadingTx ? 'animate-spin' : ''}`} />
                <span>Refresh List</span>
              </button>
            </div>

            {/* Transactions List */}
            {isLoadingTx ? (
              <div className="p-16 text-center text-slate-500 bg-white border border-[#E2E8F0] rounded-2xl flex flex-col items-center justify-center gap-2 shadow-xs">
                <Clock className="w-6 h-6 animate-spin text-[#0284C7]" />
                <p className="text-xs font-medium">Loading transactions in watched accounts requiring attention...</p>
              </div>
            ) : filteredTxs.length === 0 ? (
              <div className="p-16 text-center text-slate-500 bg-white border border-[#E2E8F0] rounded-2xl flex flex-col items-center justify-center gap-3 shadow-xs">
                <div className="w-12 h-12 rounded-full bg-[#ECFDF5] border border-[#A7F3D0] flex items-center justify-center text-[#059669]">
                  <CheckCircle2 className="w-6 h-6 text-[#059669]" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">All Caught Up!</h3>
                <p className="text-xs text-slate-500 max-w-sm">
                  There are currently no unexplained transactions in watched accounts requiring your input. Thank you for keeping your
                  books up to date!
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredTxs.map((tx) => {
                  const isAnswered = tx.status === 'CLIENT_ANSWERED';
                  const isSubmitting = submittingIds[tx.id] || false;

                  return (
                    <div
                      key={tx.id}
                      className={`bg-white border rounded-2xl p-5 shadow-sm transition ${
                        isAnswered
                          ? 'border-[#BAE6FD]'
                          : tx.accountant_query
                          ? 'border-amber-300 ring-1 ring-amber-200'
                          : 'border-[#E2E8F0] hover:border-[#BAE6FD]'
                      }`}
                    >
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                        {/* Transaction Details */}
                        <div className="space-y-1.5 flex-1">
                          <div className="flex items-center gap-2.5">
                            <span className="text-xs font-mono font-bold text-slate-500">{tx.transaction_date}</span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                tx.transaction_type === 'CREDIT'
                                  ? 'bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]'
                                  : 'bg-[#FFF1F2] text-[#E11D48] border border-[#FECDD3]'
                              }`}
                            >
                              {tx.transaction_type === 'CREDIT' ? 'Deposit / Inflow' : 'Withdrawal / Outflow'}
                            </span>
                            {isAnswered ? (
                              <span className="bg-[#ECFDF5] border border-[#A7F3D0] text-[#059669] text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3 text-[#059669]" /> Answered
                              </span>
                            ) : tx.accountant_query ? (
                              <span className="bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
                                <HelpCircle className="w-3 h-3 text-amber-600" /> Accountant Query
                              </span>
                            ) : (
                              <span className="bg-slate-50 border border-[#E2E8F0] text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded">
                                Needs Explanation
                              </span>
                            )}
                          </div>

                          <h4 className="text-sm font-bold text-[#0F172A]">{tx.description}</h4>

                          {/* Accountant Question / Query Callout */}
                          {tx.accountant_query && (
                            <div className="mt-2.5 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2">
                              <HelpCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                              <div>
                                <span className="font-bold text-amber-950">Accountant's Question: </span>
                                {tx.accountant_query}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Transaction Amount */}
                        <div className="text-right shrink-0">
                          <p className="text-lg font-mono font-bold text-[#0F172A]">
                            {tx.transaction_type === 'CREDIT' ? '+' : '-'}GHS {tx.amount.toFixed(2)}
                          </p>
                          <p className="text-[10px] text-slate-400">Statement Amount</p>
                        </div>
                      </div>

                      {/* Client Explanation Input Form */}
                      <div className="mt-4 pt-4 border-t border-[#E2E8F0] space-y-2">
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                          <div className="flex-1 relative">
                            <input
                              type="text"
                              value={explanationInputs[tx.id] || ''}
                              onChange={(e) =>
                                setExplanationInputs((prev) => ({ ...prev, [tx.id]: e.target.value }))
                              }
                              placeholder="Type explanation (e.g. Paid XYZ Supplier for detergents / Laundry supplies)..."
                              className="w-full bg-white border border-[#E2E8F0] rounded-xl px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#0284C7] shadow-xs"
                            />
                          </div>

                          {/* Attach Receipt Trigger */}
                          <label className="flex items-center justify-center gap-1 bg-white hover:bg-slate-50 border border-[#E2E8F0] text-slate-700 px-3 py-2 rounded-xl text-xs font-semibold transition cursor-pointer shrink-0 shadow-xs">
                            <Paperclip className="w-3.5 h-3.5 text-slate-500" />
                            <span>Attach Receipt</span>
                            <input
                              type="file"
                              className="hidden"
                              accept=".pdf,.png,.jpg,.jpeg,.csv"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                   const newAtt = { name: file.name, size: file.size, type: file.type };
                                  setAttachmentsMap((prev) => ({
                                    ...prev,
                                    [tx.id]: [...(prev[tx.id] || []), newAtt],
                                  }));
                                }
                              }}
                            />
                          </label>

                          <button
                            onClick={() => handleSubmitExplanation(tx.id)}
                            disabled={isSubmitting || !explanationInputs[tx.id]?.trim()}
                            className={`flex items-center justify-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl transition cursor-pointer shrink-0 disabled:opacity-40 ${
                              isAnswered
                                ? 'bg-white hover:bg-slate-50 text-slate-700 border border-[#E2E8F0] shadow-xs'
                                : 'bg-[#0284C7] hover:bg-[#0EA5E9] text-white shadow-xs'
                            }`}
                          >
                            {isSubmitting ? (
                              <Clock className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <>
                                <Send className="w-3.5 h-3.5" />
                                <span>{isAnswered ? 'Update Response' : 'Submit Explanation'}</span>
                              </>
                            )}
                          </button>
                        </div>

                        {/* Uploaded Attachments Chips */}
                        {attachmentsMap[tx.id] && attachmentsMap[tx.id].length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {attachmentsMap[tx.id].map((att, idx) => (
                              <div
                                key={idx}
                                className="flex items-center gap-1.5 bg-[#F0F9FF] text-[#0284C7] border border-[#BAE6FD] px-2.5 py-1 rounded-lg text-[11px] font-mono shadow-xs"
                              >
                                <Paperclip className="w-3 h-3 text-[#0284C7]" />
                                <span className="truncate max-w-[200px]">{att.name}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAttachmentsMap((prev) => ({
                                      ...prev,
                                      [tx.id]: prev[tx.id].filter((_, i) => i !== idx),
                                    }));
                                  }}
                                  className="text-slate-400 hover:text-[#E11D48] transition p-0.5 cursor-pointer ml-1"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};
