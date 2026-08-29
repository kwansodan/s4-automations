import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Zap, ShieldCheck, Mail, Lock, AlertTriangle, CheckCircle2, ArrowLeft, RefreshCw } from 'lucide-react';

export const LoginCard: React.FC = () => {
  const { requestOtp, verifyOtp } = useAuth();

  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [email, setEmail] = useState('s4bookkeeping@service4gh.com');
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [devHint, setDevHint] = useState<string | null>(null);

  const [countdown, setCountdown] = useState(600); // 10 mins
  const otpInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let timer: any;
    if (step === 'verify' && countdown > 0) {
      timer = setInterval(() => setCountdown((prev) => prev - 1), 1000);
    }
    return () => clearInterval(timer);
  }, [step, countdown]);

  useEffect(() => {
    if (step === 'verify' && otpInputRef.current) {
      otpInputRef.current.focus();
    }
  }, [step]);

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const res = await requestOtp(email.trim());
      setIsLoading(false);
      if (res.success) {
        setStep('verify');
        setSuccessMessage(res.message || `Verification code sent to ${email}`);
        setCountdown(600);
        if (res.dev_hint) {
          const match = res.dev_hint.match(/\d{6}/);
          setDevHint(match ? match[0] : null);
        } else {
          setDevHint(null);
        }
      } else {
        setErrorMessage(res.message || 'Failed to send code.');
      }
    } catch (err: any) {
      setIsLoading(false);
      setErrorMessage(err.message || 'Failed to send verification code.');
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6) {
      setErrorMessage('Please enter the complete 6-digit verification code.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const success = await verifyOtp(email.trim(), otp);
      setIsLoading(false);
      if (!success) {
        setErrorMessage('Invalid or expired verification code.');
      }
    } catch (err: any) {
      setIsLoading(false);
      setErrorMessage(err.message || 'Verification failed.');
    }
  };

  const handleOtpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
    setOtp(val);
    if (val.length === 6) {
      // Auto verify on 6th digit
      verifyOtp(email.trim(), val).catch((err) => {
        setErrorMessage(err.message || 'Invalid code.');
      });
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900/90 border border-sky-500/30 rounded-2xl p-8 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200">
        
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-gradient-to-tr from-sky-500/30 to-indigo-500/30 border border-sky-400/40 flex items-center justify-center text-sky-400 shadow-lg shadow-sky-500/20">
            <Zap className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">S4 Automations</h1>
          <p className="text-xs text-slate-400 mt-1">Multi-Client Accounting & Financial Suite</p>
        </div>

        {/* Security Badge */}
        <div className="flex items-center justify-center gap-1.5 text-xs text-sky-400 bg-sky-950/60 border border-sky-500/20 rounded-full py-1 px-3 mb-6 font-medium">
          <ShieldCheck className="w-4 h-4 text-sky-400" />
          <span>Passwordless Email OTP Security</span>
        </div>

        {/* Feedback Alerts */}
        {errorMessage && (
          <div className="flex items-center gap-2 p-3 bg-red-950/60 border border-red-500/30 text-red-300 rounded-lg text-xs mb-4 animate-in fade-in">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="flex items-center gap-2 p-3 bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 rounded-lg text-xs mb-4 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Step 1: Request Form */}
        {step === 'request' ? (
          <form onSubmit={handleRequestSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Authorized Administrator Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="s4bookkeeping@service4gh.com"
                  required
                  disabled={isLoading}
                  className="w-full bg-slate-950/70 border border-slate-700/80 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all disabled:opacity-50"
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                A single-use 6-digit login code will be sent to this email address.
              </p>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white text-sm font-semibold py-2.5 px-4 rounded-lg shadow-lg shadow-sky-600/30 transition-all disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Sending Code...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>Send Verification Code</span>
                </>
              )}
            </button>
          </form>
        ) : (
          /* Step 2: 6-Digit OTP Form */
          <form onSubmit={handleVerifySubmit} className="space-y-4">
            <div className="text-center mb-2">
              <span className="text-xs text-slate-400">Enter the 6-digit code sent to:</span>
              <p className="text-sm font-bold text-sky-400">{email}</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 text-center mb-2">
                6-Digit Verification Code
              </label>
              <input
                ref={otpInputRef}
                type="text"
                maxLength={6}
                value={otp}
                onChange={handleOtpChange}
                placeholder="000000"
                required
                disabled={isLoading}
                className="w-full max-w-[260px] mx-auto block bg-slate-950 border border-slate-700 rounded-lg py-2.5 text-center font-mono text-2xl font-bold tracking-[0.5em] text-white focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 transition-all"
              />

              {devHint && (
                <div className="mt-2 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setOtp(devHint);
                      verifyOtp(email.trim(), devHint);
                    }}
                    className="inline-flex items-center gap-1 text-xs text-sky-400 bg-sky-950/60 border border-sky-500/30 rounded px-2 py-0.5 hover:bg-sky-900/60 transition cursor-pointer"
                  >
                    <span>⚡ Auto-fill:</span>
                    <strong className="font-mono">{devHint}</strong>
                  </button>
                </div>
              )}

              <div className="flex justify-between items-center text-xs text-slate-400 mt-3 px-1">
                <span>
                  Expires in: <strong className="text-amber-400 font-mono">{formatTimer(countdown)}</strong>
                </span>
                <button
                  type="button"
                  onClick={handleRequestSubmit}
                  className="text-sky-400 hover:text-sky-300 underline cursor-pointer"
                >
                  Resend Code
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || otp.length !== 6}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-sm font-semibold py-2.5 px-4 rounded-lg shadow-lg shadow-emerald-600/30 transition-all disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>Verify & Access Hub</span>
                </>
              )}
            </button>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => {
                  setStep('request');
                  setOtp('');
                  setErrorMessage('');
                }}
                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Use a different email</span>
              </button>
            </div>
          </form>
        )}

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-slate-800 text-center text-[11px] text-slate-500 flex items-center justify-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-slate-600" />
          <span>Protected by S4 Multi-Client Accounting Security</span>
        </div>
      </div>
    </div>
  );
};
