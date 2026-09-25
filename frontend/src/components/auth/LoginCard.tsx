import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Zap, ShieldCheck, Mail, Lock, AlertTriangle, CheckCircle2, ArrowLeft, RefreshCw } from 'lucide-react';

interface LoginCardProps {
  onBackToLanding?: () => void;
}

export const LoginCard: React.FC<LoginCardProps> = ({ onBackToLanding }) => {
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
    <div className="min-h-[85vh] flex items-center justify-center p-4 bg-[#F8FAFC]">
      <div className="w-full max-w-md bg-white border border-[#E2E8F0] rounded-2xl p-8 shadow-sm animate-in fade-in zoom-in-95 duration-200">
        
        {/* Back to Homepage button */}
        {onBackToLanding && (
          <div className="mb-4">
            <button
              type="button"
              onClick={onBackToLanding}
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 transition cursor-pointer font-medium"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-[#0284C7]" />
              <span>Back to Homepage &amp; Live Demo</span>
            </button>
          </div>
        )}

        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-gradient-to-tr from-[#0284C7] to-[#38BDF8] border border-[#0284C7]/20 flex items-center justify-center text-white shadow-xs">
            <Zap className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">S4 Automations</h1>
          <p className="text-xs text-[#64748B] mt-1 font-normal">Multi-Client Accounting & Financial Suite</p>
        </div>

        {/* Security Badge */}
        <div className="flex items-center justify-center gap-1.5 text-xs text-[#0284C7] bg-[#F0F9FF] border border-[#BAE6FD] rounded-full py-1 px-3 mb-6 font-semibold">
          <ShieldCheck className="w-4 h-4 text-[#0284C7]" />
          <span>Passwordless Email OTP Security</span>
        </div>

        {/* Feedback Alerts */}
        {errorMessage && (
          <div className="flex items-center gap-2 p-3 bg-[#FFF1F2] border border-[#FECDD3] text-[#E11D48] rounded-xl text-xs mb-4 animate-in fade-in font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0 text-[#E11D48]" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="flex items-center gap-2 p-3 bg-[#ECFDF5] border border-[#A7F3D0] text-[#059669] rounded-xl text-xs mb-4 animate-in fade-in font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-[#059669]" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Step 1: Request Form */}
        {step === 'request' ? (
          <form onSubmit={handleRequestSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
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
                  className="w-full bg-white border border-[#E2E8F0] rounded-xl pl-9 pr-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#0284C7] transition-all disabled:opacity-50 shadow-xs"
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                A single-use 6-digit login code will be sent to this email address.
              </p>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 bg-[#0284C7] hover:bg-[#0EA5E9] active:bg-[#0369A1] text-white text-sm font-semibold py-2.5 px-4 rounded-xl shadow-xs transition-all disabled:opacity-50 cursor-pointer"
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
              <span className="text-xs text-slate-500">Enter the 6-digit code sent to:</span>
              <p className="text-sm font-bold text-slate-900">{email}</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 text-center mb-2">
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
                className="w-full max-w-[260px] mx-auto block bg-white border border-[#E2E8F0] rounded-xl py-2.5 text-center font-mono text-2xl font-bold tracking-[0.5em] text-slate-900 focus:outline-none focus:border-[#0284C7] transition-all shadow-xs"
              />

              {devHint && (
                <div className="mt-2 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setOtp(devHint);
                      verifyOtp(email.trim(), devHint);
                    }}
                    className="inline-flex items-center gap-1 text-xs text-[#0284C7] bg-[#F0F9FF] border border-[#BAE6FD] rounded-lg px-2 py-0.5 hover:bg-[#E0F2FE] transition cursor-pointer"
                  >
                    <span>⚡ Auto-fill:</span>
                    <strong className="font-mono">{devHint}</strong>
                  </button>
                </div>
              )}

              <div className="flex justify-between items-center text-xs text-slate-400 mt-3 px-1">
                <span>
                  Expires in: <strong className="text-slate-700 font-mono">{formatTimer(countdown)}</strong>
                </span>
                <button
                  type="button"
                  onClick={handleRequestSubmit}
                  className="text-[#0284C7] hover:underline cursor-pointer font-medium"
                >
                  Resend Code
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || otp.length !== 6}
              className="w-full flex items-center justify-center gap-2 bg-[#059669] hover:bg-[#047857] active:bg-[#065F46] text-white text-sm font-semibold py-2.5 px-4 rounded-xl shadow-xs transition-all disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Verify &amp; Enter Platform</span>
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
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Use a different email</span>
              </button>
            </div>
          </form>
        )}

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-[#E2E8F0] text-center text-[11px] text-slate-500 flex items-center justify-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
          <span>Protected by S4 Multi-Client Accounting Security</span>
        </div>
      </div>
    </div>
  );
};
