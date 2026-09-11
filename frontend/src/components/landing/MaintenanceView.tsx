import React, { useState } from 'react';
import { Sparkles, ShieldCheck, Mail, ArrowRight, CheckCircle2, MessageSquare, ExternalLink, Lock } from 'lucide-react';
import { capturePublicLead } from '../../lib/api';

interface MaintenanceViewProps {
  headline?: string;
  message?: string;
  estimatedTime?: string;
  whatsappNumber?: string;
  onStaffLogin: () => void;
}

export const MaintenanceView: React.FC<MaintenanceViewProps> = ({
  headline = 'S4 Automations is Upgrading',
  message = 'We are currently deploying high-throughput ingestion engine updates. Existing scheduled automated pipelines continue running in the background. Public registrations will re-open shortly.',
  estimatedTime = 'Resuming at 08:00 UTC',
  whatsappNumber = '233200000000',
  onStaffLogin,
}) => {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleNotifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setIsSubmitting(true);
    try {
      await capturePublicLead({
        full_name: 'Maintenance Waitlist Subscriber',
        email: email.trim(),
        company_name: 'Waitlist',
        accounting_firm: false,
        biggest_headache: 'Notified via maintenance screen',
      });
      setIsSubmitted(true);
      setEmail('');
    } catch {
      setIsSubmitted(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between font-sans selection:bg-sky-500 selection:text-white">
      {/* Header */}
      <header className="border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-sky-600 via-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-md">
              <Sparkles className="w-4 h-4" />
            </div>
            <span className="text-base font-black tracking-tight text-white">S4 Automations</span>
          </div>

          <button
            onClick={onStaffLogin}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-xl border border-slate-800 hover:border-slate-700 transition cursor-pointer"
          >
            <Lock className="w-3.5 h-3.5 text-sky-400" />
            <span>Staff Sign In</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="max-w-xl w-full text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-950/80 border border-indigo-500/40 text-[11px] font-bold text-indigo-300">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
            <span>Scheduled Maintenance &amp; Engine Upgrade</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            {headline}
          </h1>

          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-lg mx-auto">
            {message}
          </p>

          {estimatedTime && (
            <div className="inline-block px-3 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-400">
              ⏱️ {estimatedTime}
            </div>
          )}

          {/* Waitlist / Notify Box */}
          <div className="pt-2 max-w-md mx-auto">
            {isSubmitted ? (
              <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs flex items-center justify-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>You're on the priority notification list! We'll email you the moment we re-open.</span>
              </div>
            ) : (
              <form onSubmit={handleNotifySubmit} className="space-y-2">
                <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-2xl p-1.5 focus-within:border-sky-500 transition">
                  <Mail className="w-4 h-4 text-slate-400 ml-2.5 shrink-0" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email for immediate alert..."
                    className="flex-1 bg-transparent px-2 py-1.5 text-xs text-white focus:outline-none placeholder:text-slate-500"
                  />
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <span>Notify Me</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-[10px] text-slate-500">
                  Zero spam. We will only send a single ping when public access resumes.
                </p>
              </form>
            )}
          </div>

          {/* WhatsApp Support fallback */}
          {whatsappNumber && (
            <div className="pt-4">
              <a
                href={`https://wa.me/${whatsappNumber.replace(/[^0-9]/g, '')}?text=${encodeURIComponent('Hi S4 Team, inquiring regarding the system upgrade.')}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Urgent client inquiry? Reach our on-call team on WhatsApp</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-4 text-center text-[11px] text-slate-500">
        <p>© 2026 S4 Automations. Active client pipelines remain operational.</p>
      </footer>
    </div>
  );
};
