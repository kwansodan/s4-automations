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
      // Initialize inputs with existing explanations
      const initialInputs: { [id: number]: string } = {};
      if (Array.isArray(data)) {
        data.forEach((tx) => {
          if (tx.client_explanation) {
            initialInputs[tx.id] = tx.client_explanation;
          }
        });
      }
      setExplanationInputs(initialInputs);
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
        body: JSON.stringify({ client_explanation: text }),
      });
      if (res.ok) {
        const result = await res.json();
        setTransactions((prev) =>
          prev.map((t) => (t.id === txId ? { ...t, client_explanation: text, status: 'CLIENT_ANSWERED' } : t))
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
    const query = searchFilter.toLowerCase();
    return (
      t.description.toLowerCase().includes(query) ||
      t.transaction_date.includes(query) ||
      (t.accountant_query && t.accountant_query.toLowerCase().includes(query)) ||
      (t.client_explanation && t.client_explanation.toLowerCase().includes(query))
    );
  });

  const pendingCount = transactions.filter((t) => t.status !== 'CLIENT_ANSWERED').length;
  const answeredCount = transactions.filter((t) => t.status === 'CLIENT_ANSWERED').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-sky-500 selection:text-white">
      {/* Top Navigation */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/20 font-black text-xl">
              S4
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-white tracking-tight">S4 Automations</span>
                <span className="bg-sky-500/10 text-sky-400 border border-sky-500/20 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                  Client Clarification Portal
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">Bank Transactions &amp; Accounting Queries</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {onBackToAdmin && (
              <button
                onClick={onBackToAdmin}
                className="text-xs font-semibold text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 px-3 py-1.5 rounded-lg transition"
              >
                Back to Firm Dashboard
              </button>
            )}
            {sessionToken && (
              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <p className="text-xs font-bold text-slate-200">{clientInfo?.name || 'Client Portal'}</p>
                  <p className="text-[10px] text-emerald-400 font-medium flex items-center justify-end gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    Verified Session
                  </p>
                </div>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 bg-slate-800/80 hover:bg-rose-950/60 hover:border-rose-500/40 text-slate-300 hover:text-rose-300 border border-slate-700 text-xs font-semibold px-3 py-2 rounded-xl transition cursor-pointer"
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
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-8 shadow-2xl backdrop-blur-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-sky-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>

              <div className="text-center mb-8">
                <div className="w-14 h-14 bg-sky-500/10 border border-sky-500/30 rounded-2xl flex items-center justify-center text-sky-400 mx-auto mb-4 shadow-lg shadow-sky-500/10">
                  <ShieldCheck className="w-7 h-7" />
                </div>
                <h2 className="text-2xl font-black text-white tracking-tight">Client Secure Access</h2>
                <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                  Login via email OTP to review and clarify monthly bank transactions for your accounting team.
                </p>
              </div>

              {authError && (
                <div className="mb-6 p-3.5 bg-rose-950/60 border border-rose-500/40 rounded-xl text-xs text-rose-300 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                  <span>{authError}</span>
                </div>
              )}

              {!otpSent ? (
                <form onSubmit={handleRequestOtp} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">
                      Business Email or Organization ID
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        placeholder="e.g. anr_group or accounts@luxwood.com"
                        required
                        className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 font-medium transition"
                      />
                      <Building className="w-4 h-4 text-slate-500 absolute right-3.5 top-3.5" />
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1.5">
                      Enter your company code or registered contact email.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={isRequestingOtp}
                    className="w-full bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white font-bold py-3.5 px-4 rounded-xl transition shadow-lg shadow-sky-600/30 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 text-sm"
                  >
                    {isRequestingOtp ? (
                      <Clock className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <span>Send 6-Digit Login Code</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp} className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
                        Enter 6-Digit OTP Code
                      </label>
                      <button
                        type="button"
                        onClick={() => setOtpSent(false)}
                        className="text-[11px] text-sky-400 hover:underline cursor-pointer"
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
                        className="w-full bg-slate-950/80 border border-sky-500/50 rounded-xl px-4 py-3 text-center text-xl tracking-widest font-mono text-white placeholder-slate-600 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400 transition"
                      />
                      <KeyRound className="w-4 h-4 text-sky-400 absolute right-3.5 top-4" />
                    </div>
                    {otpHint && (
                      <p className="text-[11px] text-emerald-400 font-mono mt-2 bg-emerald-950/40 border border-emerald-500/20 p-2 rounded-lg text-center">
                        {otpHint}
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={isVerifyingOtp || otpCode.length !== 6}
                    className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-3.5 px-4 rounded-xl transition shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 text-sm"
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
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-black text-white tracking-tight">
                    Welcome, {clientInfo?.name || 'Valued Client'}
                  </h1>
                  <span className="bg-sky-950 border border-sky-500/40 text-sky-300 text-xs font-bold px-2.5 py-0.5 rounded-full">
                    {clientInfo?.industry || 'Accounting Services'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1 max-w-2xl">
                  Your accounting team at S4 Automations has ingested recent bank statement lines. Please review any
                  unexplained deposits, withdrawals, or queries below and provide short written explanations.
                </p>
              </div>

              {/* Stat Counters */}
              <div className="flex items-center gap-3 shrink-0">
                <div className="bg-amber-950/40 border border-amber-500/30 rounded-xl p-3.5 text-center min-w-[110px]">
                  <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Needs Attention</p>
                  <p className="text-2xl font-black text-white mt-0.5">{pendingCount}</p>
                </div>
                <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-3.5 text-center min-w-[110px]">
                  <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Answered</p>
                  <p className="text-2xl font-black text-emerald-300 mt-0.5">{answeredCount}</p>
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
                  className="w-full bg-slate-900/90 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
              </div>

              <button
                onClick={fetchPortalTransactions}
                disabled={isLoadingTx}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-semibold px-3 py-2 rounded-xl transition cursor-pointer"
              >
                <Clock className={`w-3.5 h-3.5 ${isLoadingTx ? 'animate-spin' : ''}`} />
                <span>Refresh List</span>
              </button>
            </div>

            {/* Transactions List */}
            {isLoadingTx ? (
              <div className="p-16 text-center text-slate-400 bg-slate-900/40 border border-slate-800 rounded-2xl flex flex-col items-center justify-center gap-2">
                <Clock className="w-6 h-6 animate-spin text-sky-400" />
                <p className="text-xs font-medium">Loading bank transactions requiring attention...</p>
              </div>
            ) : filteredTxs.length === 0 ? (
              <div className="p-16 text-center text-slate-400 bg-slate-900/40 border border-slate-800 rounded-2xl flex flex-col items-center justify-center gap-3">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-white">All Caught Up!</h3>
                <p className="text-xs text-slate-400 max-w-sm">
                  There are currently no unexplained bank transactions requiring your input. Thank you for keeping your
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
                      className={`bg-slate-900/90 border rounded-2xl p-5 shadow-lg backdrop-blur-xl transition ${
                        isAnswered
                          ? 'border-emerald-500/30 bg-emerald-950/10'
                          : tx.accountant_query
                          ? 'border-amber-500/40 bg-amber-950/10'
                          : 'border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                        {/* Transaction Details */}
                        <div className="space-y-1.5 flex-1">
                          <div className="flex items-center gap-2.5">
                            <span className="text-xs font-mono font-bold text-slate-400">{tx.transaction_date}</span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                tx.transaction_type === 'CREDIT'
                                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                              }`}
                            >
                              {tx.transaction_type === 'CREDIT' ? 'Deposit / Inflow' : 'Withdrawal / Outflow'}
                            </span>
                            {isAnswered ? (
                              <span className="bg-emerald-950 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> Answered
                              </span>
                            ) : tx.accountant_query ? (
                              <span className="bg-amber-950 border border-amber-500/40 text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
                                <HelpCircle className="w-3 h-3" /> Accountant Query
                              </span>
                            ) : (
                              <span className="bg-slate-800 border border-slate-700 text-slate-400 text-[10px] font-bold px-2 py-0.5 rounded">
                                Needs Explanation
                              </span>
                            )}
                          </div>

                          <h4 className="text-sm font-bold text-white">{tx.description}</h4>

                          {/* Accountant Question / Query Callout */}
                          {tx.accountant_query && (
                            <div className="mt-2.5 p-3 bg-amber-950/40 border border-amber-500/30 rounded-xl text-xs text-amber-200 flex items-start gap-2">
                              <HelpCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                              <div>
                                <span className="font-bold text-amber-300">Accountant's Question: </span>
                                {tx.accountant_query}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Transaction Amount */}
                        <div className="text-right shrink-0">
                          <p
                            className={`text-lg font-mono font-extrabold ${
                              tx.transaction_type === 'CREDIT' ? 'text-emerald-400' : 'text-slate-200'
                            }`}
                          >
                            {tx.transaction_type === 'CREDIT' ? '+' : '-'}GHS {tx.amount.toFixed(2)}
                          </p>
                          <p className="text-[10px] text-slate-500">Statement Amount</p>
                        </div>
                      </div>

                      {/* Client Explanation Input Form */}
                      <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                        <div className="flex-1 relative">
                          <input
                            type="text"
                            value={explanationInputs[tx.id] || ''}
                            onChange={(e) =>
                              setExplanationInputs((prev) => ({ ...prev, [tx.id]: e.target.value }))
                            }
                            placeholder="Type explanation (e.g. Paid XYZ Supplier for detergents / Laundry supplies)..."
                            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                          />
                        </div>

                        <button
                          onClick={() => handleSubmitExplanation(tx.id)}
                          disabled={isSubmitting || !explanationInputs[tx.id]?.trim()}
                          className={`flex items-center justify-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl transition cursor-pointer shrink-0 disabled:opacity-40 ${
                            isAnswered
                              ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                              : 'bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white shadow-md shadow-sky-600/20'
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
