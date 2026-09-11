import React, { useState } from 'react';
import {
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Sliders,
  FileText,
  Building2,
  ShieldCheck,
  Zap,
  Clock,
  DollarSign,
  Layers,
  ExternalLink,
  MessageSquare,
  Play,
  Upload,
  RefreshCw,
  X,
  ChevronRight,
  TrendingUp,
  UserCheck,
} from 'lucide-react';
import { capturePublicLead } from '../../lib/api';

interface LandingPageProps {
  onGoToLogin: () => void;
  onOpenPortal?: () => void;
  onOpenPrivacy?: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onGoToLogin, onOpenPortal, onOpenPrivacy }) => {
  // Demo Booking Modal State
  const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
  const [isSubmittingLead, setIsSubmittingLead] = useState(false);
  const [leadSuccessMessage, setLeadSuccessMessage] = useState('');

  // Lead Form Fields
  const [leadName, setLeadName] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadCompany, setLeadCompany] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [isFirm, setIsFirm] = useState(true);
  const [clientCount, setClientCount] = useState('6-20');
  const [targetErp, setTargetErp] = useState('zoho_books');
  const [headache, setHeadache] = useState('Handwritten receipts and paper control slips');

  // ROI Calculator States
  const [clientVolume, setClientVolume] = useState(12);
  const [monthlyInvoicesPerClient, setMonthlyInvoicesPerClient] = useState(180);

  // Live OCR Sandbox States
  const [sandboxSample, setSandboxSample] = useState<'laundry' | 'receipt' | 'momo'>('laundry');
  const [isSimulatingOcr, setIsSimulatingOcr] = useState(false);
  const [ocrCompleted, setOcrCompleted] = useState(true);

  // ROI Calculations
  const totalMonthlyDocs = clientVolume * monthlyInvoicesPerClient;
  const manualHoursSpent = Math.round((totalMonthlyDocs * 3.5) / 60);
  const hoursSaved = Math.round(manualHoursSpent * 0.86);
  const estimatedSavingsGhs = hoursSaved * 75; // Approx GHS 75/hr bookkeeping cost

  const handleLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingLead(true);
    setLeadSuccessMessage('');
    try {
      const res = await capturePublicLead({
        full_name: leadName.trim(),
        email: leadEmail.trim(),
        company_name: leadCompany.trim(),
        phone_or_whatsapp: leadPhone.trim() || undefined,
        accounting_firm: isFirm,
        client_count_estimate: clientCount,
        primary_accounting_software: targetErp,
        biggest_headache: headache,
      });
      setLeadSuccessMessage(res.message || 'Demo request submitted! Our team will contact you shortly.');
      setLeadName('');
      setLeadEmail('');
      setLeadCompany('');
      setLeadPhone('');
    } catch (err: any) {
      alert(`Submission failed: ${err.message || err}`);
    } finally {
      setIsSubmittingLead(false);
    }
  };

  const handleRunOcrDemo = (sampleType: 'laundry' | 'receipt' | 'momo') => {
    setSandboxSample(sampleType);
    setIsSimulatingOcr(true);
    setOcrCompleted(false);
    setTimeout(() => {
      setIsSimulatingOcr(false);
      setOcrCompleted(true);
    }, 1400);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-sky-500 selection:text-white">
      {/* 1. Header Navigation */}
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-600 via-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <span className="text-base font-black tracking-tight text-white flex items-center gap-1.5">
                S4 Automations
                <span className="text-[10px] font-bold px-1.5 py-0.5 bg-sky-950 text-sky-400 border border-sky-800/60 rounded">
                  AI OCR
                </span>
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-300">
            <button
              type="button"
              onClick={() => document.getElementById('ocr-sandbox')?.scrollIntoView({ behavior: 'smooth' })}
              className="hover:text-white transition cursor-pointer"
            >
              Live OCR Sandbox
            </button>
            <button
              type="button"
              onClick={() => document.getElementById('roi-calculator')?.scrollIntoView({ behavior: 'smooth' })}
              className="hover:text-white transition cursor-pointer"
            >
              ROI Calculator
            </button>
            <button
              type="button"
              onClick={() => document.getElementById('integrations')?.scrollIntoView({ behavior: 'smooth' })}
              className="hover:text-white transition cursor-pointer"
            >
              ERP Integrations
            </button>
            <button
              type="button"
              onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
              className="hover:text-white transition cursor-pointer"
            >
              Workflow Engine
            </button>
          </nav>

          <div className="flex items-center gap-3">
            {onOpenPortal && (
              <button
                onClick={onOpenPortal}
                className="hidden sm:inline-block text-xs font-semibold text-slate-400 hover:text-sky-400 px-2 py-1.5 rounded-xl transition cursor-pointer"
              >
                Client Portal
              </button>
            )}
            <button
              onClick={onGoToLogin}
              className="text-xs font-semibold text-slate-300 hover:text-white px-3 py-1.5 rounded-xl transition cursor-pointer"
            >
              Sign In
            </button>
            <button
              onClick={() => setIsLeadModalOpen(true)}
              className="px-4 py-2 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 transition cursor-pointer flex items-center gap-1.5"
            >
              <span>Book Firm Demo</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* 2. Hero Section */}
      <section className="relative overflow-hidden pt-16 pb-20 lg:pt-24 lg:pb-28 border-b border-slate-800">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.15),rgba(255,255,255,0))]" />
        
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-700/80 text-[11px] font-semibold text-sky-300 shadow-sm animate-in fade-in">
            <Sparkles className="w-3.5 h-3.5 text-sky-400" />
            <span>Built for Accounting Firms, Hospitality &amp; Multi-Branch Enterprises</span>
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight leading-[1.15]">
            Stop Manually Keying Receipts, Control Slips &amp; MoMo Statements.
          </h1>

          <p className="text-sm sm:text-base text-slate-300 max-w-3xl mx-auto leading-relaxed">
            S4 Automations leverages <strong className="text-sky-300 font-semibold">Gemini Vision AI</strong> to read messy handwritten chits, crumpled vendor invoices, and mobile money dockets. It converts them into <strong className="text-sky-300 font-semibold">verified draft bills and invoices inside Zoho Books, QuickBooks, and Xero</strong> with 1 click.
          </p>

          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <a
              href="#ocr-sandbox"
              className="w-full sm:w-auto px-6 py-3.5 bg-gradient-to-r from-sky-600 via-indigo-600 to-purple-600 hover:from-sky-500 hover:to-purple-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-xl shadow-indigo-600/30 transition cursor-pointer flex items-center justify-center gap-2"
            >
              <span>Test Live OCR Sandbox Below</span>
              <ArrowRight className="w-4 h-4" />
            </a>

            <button
              onClick={() => setIsLeadModalOpen(true)}
              className="w-full sm:w-auto px-6 py-3.5 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer flex items-center justify-center gap-2"
            >
              <Building2 className="w-4 h-4 text-slate-400" />
              <span>Schedule 15-Min Free Audit</span>
            </button>
          </div>

          {/* Highlights strip */}
          <div className="pt-8 flex flex-wrap items-center justify-center gap-6 sm:gap-10 text-xs text-slate-400 font-medium">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>99.4% Extraction Accuracy</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Human-in-the-Loop Review Sheet</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Direct Bank &amp; MoMo Reconciliation</span>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Interactive OCR Sandbox Section */}
      <section id="ocr-sandbox" className="py-20 border-b border-slate-800 bg-slate-950/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <span className="text-xs font-bold text-sky-400 uppercase tracking-wider">
              Interactive Live Demo
            </span>
            <h2 className="text-2xl sm:text-3xl font-black text-white">
              See How Gemini Vision Solves Messy Accounting Ingestion
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              Select a messy sample document below to simulate how our multi-pipeline OCR engine extracts line items, applies tax, and prepares ERP journal postings.
            </p>
          </div>

          {/* Sample Switcher Tabs */}
          <div className="flex flex-wrap justify-center gap-2">
            {[
              { id: 'laundry', label: 'ANR Hospitality Laundry Docket (Handwritten)' },
              { id: 'receipt', label: 'Restaurant & Fuel Vendor Bill' },
              { id: 'momo', label: 'MTN Mobile Money Statement (Suspense)' },
            ].map((s) => (
              <button
                key={s.id}
                onClick={() => handleRunOcrDemo(s.id as any)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer border ${
                  sandboxSample === s.id
                    ? 'bg-sky-600/20 text-sky-300 border-sky-500/50 shadow-sm'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Sandbox Mockup Viewer */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl relative overflow-hidden">
            {isSimulatingOcr ? (
              <div className="py-24 text-center space-y-4">
                <RefreshCw className="w-8 h-8 animate-spin text-sky-400 mx-auto" />
                <div className="space-y-1">
                  <p className="text-sm font-bold text-white">Gemini Vision OCR Scanning Document...</p>
                  <p className="text-xs text-slate-400">
                    Recognizing handwriting, computing row math, and cross-matching Chart of Accounts...
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Left: Document Mockup & Meta (5 cols) */}
                <div className="lg:col-span-5 bg-slate-950 p-4 rounded-xl border border-slate-850 space-y-4">
                  <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-800">
                    <span className="font-bold text-white flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-sky-400" />
                      <span>
                        {sandboxSample === 'laundry'
                          ? 'Control_Slip_ANR_0908.jpg'
                          : sandboxSample === 'receipt'
                          ? 'Vendor_Fuel_Receipt_489.png'
                          : 'MTN_MoMo_Monthly_Stmt.pdf'}
                      </span>
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                      OCR Confidence: 99.2%
                    </span>
                  </div>

                  <div className="bg-slate-900/90 rounded-lg p-4 font-mono text-[11px] text-slate-300 space-y-2 border border-slate-800/80 leading-relaxed">
                    <p className="text-slate-500 font-sans text-xs italic">
                      [Raw Source: Snapped by field staff via phone camera]
                    </p>
                    {sandboxSample === 'laundry' ? (
                      <>
                        <p className="font-bold text-white">ANR LAUNDRY SERVICES - DAILY CONTROL SHEET</p>
                        <p>Date: 08-Sep-2026 | Client: Hotel Cresta</p>
                        <p>• Bed Sheets (King): 45 pcs @ GHS 12.00 = GHS 540.00</p>
                        <p>• Duvet Covers: 20 pcs @ GHS 25.00 = GHS 500.00</p>
                        <p>• Pillow Slips: 90 pcs @ GHS 5.50 = GHS 495.00</p>
                        <p>• Bath Towels: 70 pcs @ GHS 5.00 = GHS 350.00</p>
                        <p className="text-emerald-400 font-bold pt-1 border-t border-slate-800">
                          Total Extracted: GHS 1,885.00
                        </p>
                      </>
                    ) : sandboxSample === 'receipt' ? (
                      <>
                        <p className="font-bold text-white">GOIL PETROLEUM GHANA - TAX INVOICE</p>
                        <p>Date: 02-Sep-2026 | TIN: P002849182</p>
                        <p>• Super XP RON 95 (Litres: 55.40 @ GHS 14.80) = GHS 819.92</p>
                        <p>• Engine Oil 5W30 (1 Can) = GHS 240.00</p>
                        <p className="text-emerald-400 font-bold pt-1 border-t border-slate-800">
                          Total Bill: GHS 1,059.92 (GRA VAT: GHS 158.99)
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-bold text-white">MTN MOBILE MONEY STATEMENT</p>
                        <p>Period: Aug 2026 | Account: 0244******</p>
                        <p>• 15-Aug: Payment from Apex Logistics - GHS 4,500.00 [REF: 84920482]</p>
                        <p>• 22-Aug: Transfer to Kwame Transport - GHS 1,200.00</p>
                        <p className="text-sky-400 font-bold pt-1 border-t border-slate-800">
                          Auto-Classified: AR Revenue &amp; AP Haulage Expense
                        </p>
                      </>
                    )}
                  </div>

                  <div className="text-[11px] text-slate-400 flex items-center justify-between">
                    <span>Target Software: <strong>Zoho Books</strong></span>
                    <span>Status: <strong className="text-emerald-400">Ledger Ready</strong></span>
                  </div>
                </div>

                {/* Right: Real-Time Structured Accounting Output (7 cols) */}
                <div className="lg:col-span-7 bg-slate-950 p-4 rounded-xl border border-slate-850 space-y-4">
                  <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-800">
                    <span className="font-bold text-white flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>ERP Staged Ledger Preview</span>
                    </span>
                    <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                      Auto-Draft Mode Active
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-slate-900 text-slate-400 font-bold">
                        <tr>
                          <th className="py-2 px-3">Item / Ledger Account</th>
                          <th className="py-2 px-2 text-right">Qty</th>
                          <th className="py-2 px-2 text-right">Rate</th>
                          <th className="py-2 px-3 text-right">Total (GHS)</th>
                          <th className="py-2 px-2 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-850 text-slate-200">
                        {sandboxSample === 'laundry' ? (
                          <>
                            <tr>
                              <td className="py-2 px-3">Bed Sheets (King Size)</td>
                              <td className="py-2 px-2 text-right font-mono">45</td>
                              <td className="py-2 px-2 text-right font-mono">12.00</td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-white">540.00</td>
                              <td className="py-2 px-2 text-center text-emerald-400 text-[10px]">Verified</td>
                            </tr>
                            <tr>
                              <td className="py-2 px-3">Duvet Covers</td>
                              <td className="py-2 px-2 text-right font-mono">20</td>
                              <td className="py-2 px-2 text-right font-mono">25.00</td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-white">500.00</td>
                              <td className="py-2 px-2 text-center text-emerald-400 text-[10px]">Verified</td>
                            </tr>
                            <tr>
                              <td className="py-2 px-3">Pillow Slips</td>
                              <td className="py-2 px-2 text-right font-mono">90</td>
                              <td className="py-2 px-2 text-right font-mono">5.50</td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-white">495.00</td>
                              <td className="py-2 px-2 text-center text-emerald-400 text-[10px]">Verified</td>
                            </tr>
                            <tr>
                              <td className="py-2 px-3">Bath Towels</td>
                              <td className="py-2 px-2 text-right font-mono">70</td>
                              <td className="py-2 px-2 text-right font-mono">5.00</td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-white">350.00</td>
                              <td className="py-2 px-2 text-center text-emerald-400 text-[10px]">Verified</td>
                            </tr>
                          </>
                        ) : (
                          <>
                            <tr>
                              <td className="py-2 px-3">Vehicle Fuel &amp; Transport</td>
                              <td className="py-2 px-2 text-right font-mono">55.4</td>
                              <td className="py-2 px-2 text-right font-mono">14.80</td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-white">819.92</td>
                              <td className="py-2 px-2 text-center text-emerald-400 text-[10px]">Verified</td>
                            </tr>
                            <tr>
                              <td className="py-2 px-3">Automobile Repairs &amp; Maintenance</td>
                              <td className="py-2 px-2 text-right font-mono">1</td>
                              <td className="py-2 px-2 text-right font-mono">240.00</td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-white">240.00</td>
                              <td className="py-2 px-2 text-center text-emerald-400 text-[10px]">Verified</td>
                            </tr>
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                    <span className="text-xs text-slate-400">
                      Ready to sync automatically into <strong>Zoho Books Draft Bills</strong>
                    </span>
                    <button
                      onClick={() => setIsLeadModalOpen(true)}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1"
                    >
                      <span>Automate Your Firm's Documents</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 4. ROI & Hours-Saved Calculator */}
      <section id="roi-calculator" className="py-20 border-b border-slate-800 bg-slate-900/30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
              Measurable Return on Investment
            </span>
            <h2 className="text-2xl sm:text-3xl font-black text-white">
              Calculate How Many Hours S4 Automations Reclaims for Your Firm
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              Manual document keying burns 60% of a junior bookkeeper's month. See your firm's savings:
            </p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center shadow-xl">
            {/* Left: Interactive Sliders (7 cols) */}
            <div className="lg:col-span-7 space-y-6">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-white mb-2">
                  <span>Number of Business Clients or Entities Managed:</span>
                  <span className="text-sm font-mono text-sky-400 bg-sky-950 px-2.5 py-0.5 rounded border border-sky-800">
                    {clientVolume} Clients
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="40"
                  value={clientVolume}
                  onChange={(e) => setClientVolume(Number(e.target.value))}
                  className="w-full h-2 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-sky-500"
                />
                <div className="flex justify-between text-[10px] text-slate-500 mt-1 font-mono">
                  <span>1 client</span>
                  <span>20 clients</span>
                  <span>40 clients</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs font-bold text-white mb-2">
                  <span>Average Monthly Receipts / Vendor Slips per Client:</span>
                  <span className="text-sm font-mono text-indigo-400 bg-indigo-950 px-2.5 py-0.5 rounded border border-indigo-800">
                    {monthlyInvoicesPerClient} Slips
                  </span>
                </div>
                <input
                  type="range"
                  min="30"
                  max="600"
                  step="10"
                  value={monthlyInvoicesPerClient}
                  onChange={(e) => setMonthlyInvoicesPerClient(Number(e.target.value))}
                  className="w-full h-2 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <div className="flex justify-between text-[10px] text-slate-500 mt-1 font-mono">
                  <span>30 slips</span>
                  <span>300 slips</span>
                  <span>600 slips</span>
                </div>
              </div>

              <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 text-xs text-slate-300 flex items-center gap-3">
                <Clock className="w-5 h-5 text-sky-400 shrink-0" />
                <p className="text-[11px] leading-relaxed">
                  Your team currently processes approximately <strong>{totalMonthlyDocs.toLocaleString()} documents</strong> each month, spending roughly <strong>{manualHoursSpent} hours</strong> on manual data entry.
                </p>
              </div>
            </div>

            {/* Right: Results Card (5 cols) */}
            <div className="lg:col-span-5 bg-gradient-to-br from-slate-950 to-indigo-950/40 p-6 rounded-2xl border border-indigo-500/30 text-center space-y-4 shadow-lg">
              <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider block">
                Estimated Monthly Savings
              </span>

              <div className="space-y-1">
                <div className="text-4xl sm:text-5xl font-black text-white tracking-tight">
                  {hoursSaved} <span className="text-2xl text-sky-400 font-bold">Hours</span>
                </div>
                <p className="text-xs text-slate-400">saved every single month</p>
              </div>

              <div className="pt-2 border-t border-slate-800">
                <p className="text-xs font-semibold text-emerald-400">
                  ≈ GHS {estimatedSavingsGhs.toLocaleString()} Saved / Month
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Equivalent to hiring 1.5 full-time junior bookkeepers
                </p>
              </div>

              <button
                onClick={() => setIsLeadModalOpen(true)}
                className="w-full py-3 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 transition cursor-pointer"
              >
                Claim These Savings for Your Firm
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 5. ERP Integrations Strip */}
      <section id="integrations" className="py-16 border-b border-slate-800 bg-slate-950">
        <div className="max-w-6xl mx-auto px-4 text-center space-y-6">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Seamlessly Connected to Leading Cloud Accounting Platforms
          </p>

          <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-12 opacity-85">
            <div className="px-5 py-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-2">
              <span className="text-sm font-bold text-white">Zoho Books</span>
              <span className="text-[10px] text-emerald-400 font-mono bg-emerald-950 px-1.5 py-0.5 rounded">
                Live 1-Click
              </span>
            </div>
            <div className="px-5 py-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-2">
              <span className="text-sm font-bold text-white">QuickBooks Online</span>
              <span className="text-[10px] text-sky-400 font-mono bg-sky-950 px-1.5 py-0.5 rounded">
                OAuth2 Ready
              </span>
            </div>
            <div className="px-5 py-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-2">
              <span className="text-sm font-bold text-white">Xero</span>
              <span className="text-[10px] text-blue-400 font-mono bg-blue-950 px-1.5 py-0.5 rounded">
                Live
              </span>
            </div>
            <div className="px-5 py-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-2">
              <span className="text-sm font-bold text-white">Google Drive BYOS</span>
              <span className="text-[10px] text-amber-400 font-mono bg-amber-950 px-1.5 py-0.5 rounded">
                Compliant
              </span>
            </div>
            <div className="px-5 py-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-2">
              <span className="text-sm font-bold text-white">MTN &amp; Telecel MoMo</span>
              <span className="text-[10px] text-yellow-400 font-mono bg-yellow-950 px-1.5 py-0.5 rounded">
                Reconciliation
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Why S4 Automations Grid */}
      <section id="features" className="py-20 border-b border-slate-800 bg-slate-900/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <span className="text-xs font-bold text-purple-400 uppercase tracking-wider">
              Purpose-Built Architecture
            </span>
            <h2 className="text-2xl sm:text-3xl font-black text-white">
              Why Top Accounting Firms Choose S4 Automations
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400">
                <Zap className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-white">Gemini 2.5 Flash Vision OCR</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Reads difficult handwriting, low-light phone photos, and crumpled slips that traditional flat-file OCR models fail on.
              </p>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-white">Staged Google Sheets Review</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                CPAs and controllers maintain 100% human-in-the-loop oversight. Verify totals, edit account codes, and approve with 1 click before syncing to the ledger.
              </p>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400">
                <MessageSquare className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-white">Client Clarification Portal</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Stop chasing clients with endless emails. Resolve suspense accounts and missing receipt details directly through our streamlined client portal.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 7. Call To Action Footer Banner */}
      <section className="py-20 bg-gradient-to-b from-slate-950 to-indigo-950/40 text-center">
        <div className="max-w-3xl mx-auto px-4 space-y-6">
          <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
            Ready to Streamline Your Firm's Bookkeeping?
          </h2>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            Join forward-thinking accounting firms and businesses eliminating manual data entry. We'll run a sample batch of your documents for free.
          </p>
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => setIsLeadModalOpen(true)}
              className="px-6 py-3 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-xl shadow-indigo-600/30 transition cursor-pointer"
            >
              Book Your Free Automation Walkthrough
            </button>
            <a
              href="https://wa.me/233200000000?text=Hi%20S4%20Team,%20I%20would%20like%20to%20learn%20more%20about%20accounting%20automation%20for%20my%20firm"
              target="_blank"
              rel="noreferrer"
              className="px-5 py-3 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs sm:text-sm font-semibold transition flex items-center gap-2"
            >
              <span>Chat on WhatsApp</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </section>

      {/* 8. Footer */}
      <footer className="py-8 border-t border-slate-800 bg-slate-950 text-slate-500 text-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
          <p>© 2026 S4 Automations Inc. All rights reserved. Bank-Grade Security &amp; TLS 1.3 Certified.</p>
          <div className="flex flex-wrap items-center justify-center gap-4 text-slate-400 text-xs font-medium">
            <a
              href="/privacy.html"
              onClick={(e) => {
                if (onOpenPrivacy) {
                  e.preventDefault();
                  onOpenPrivacy();
                }
              }}
              className="hover:text-sky-400 transition"
            >
              Privacy Policy
            </a>
            <span>•</span>
            <button
              type="button"
              onClick={() => document.getElementById('ocr-sandbox')?.scrollIntoView({ behavior: 'smooth' })}
              className="hover:text-slate-200 transition cursor-pointer"
            >
              Live OCR Sandbox
            </button>
            <span>•</span>
            <button
              type="button"
              onClick={() => document.getElementById('roi-calculator')?.scrollIntoView({ behavior: 'smooth' })}
              className="hover:text-slate-200 transition cursor-pointer"
            >
              ROI Calculator
            </button>
            {onOpenPortal && (
              <>
                <span>•</span>
                <button
                  onClick={onOpenPortal}
                  className="hover:text-sky-400 transition cursor-pointer"
                >
                  Client Portal
                </button>
              </>
            )}
          </div>
        </div>
      </footer>

      {/* 9. Demo Booking Modal */}
      {isLeadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-sky-400" />
                <h3 className="text-base font-bold text-white">Book a Live Firm Walkthrough</h3>
              </div>
              <button
                onClick={() => setIsLeadModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {leadSuccessMessage ? (
              <div className="py-8 text-center space-y-3">
                <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
                <h4 className="text-base font-bold text-white">Request Received!</h4>
                <p className="text-xs text-slate-300 max-w-xs mx-auto leading-relaxed">
                  {leadSuccessMessage} Check your email inbox for confirmation.
                </p>
                <button
                  onClick={() => {
                    setIsLeadModalOpen(false);
                    setLeadSuccessMessage('');
                  }}
                  className="mt-2 px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleLeadSubmit} className="space-y-3.5">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Your Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={leadName}
                    onChange={(e) => setLeadName(e.target.value)}
                    placeholder="e.g. Kwesi Boateng"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Work Email *
                    </label>
                    <input
                      type="email"
                      required
                      value={leadEmail}
                      onChange={(e) => setLeadEmail(e.target.value)}
                      placeholder="k.boateng@cpa.com"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      WhatsApp / Phone
                    </label>
                    <input
                      type="text"
                      value={leadPhone}
                      onChange={(e) => setLeadPhone(e.target.value)}
                      placeholder="+233 24 000 0000"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Company / Firm Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={leadCompany}
                      onChange={(e) => setLeadCompany(e.target.value)}
                      placeholder="Boateng & Co. Advisory"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Target Accounting ERP
                    </label>
                    <select
                      value={targetErp}
                      onChange={(e) => setTargetErp(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                    >
                      <option value="zoho_books">Zoho Books</option>
                      <option value="quickbooks_online">QuickBooks Online</option>
                      <option value="xero">Xero</option>
                      <option value="sage_or_other">Sage / Other</option>
                    </select>
                  </div>
                </div>

                <div className="pt-1">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isFirm}
                      onChange={(e) => setIsFirm(e.target.checked)}
                      className="rounded bg-slate-950 border-slate-700 text-sky-600 focus:ring-0"
                    />
                    <span>We are an Accounting / Bookkeeping / Audit Firm</span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingLead}
                  className="w-full py-2.5 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 transition cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingLead ? 'Submitting Request...' : 'Schedule Live Demo'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
