import React, { useState, useEffect } from 'react';
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
  ChevronDown,
  HelpCircle,
  Award,
  Check,
  PhoneCall,
  Bell,
} from 'lucide-react';
import {
  capturePublicLead,
  fetchLandingPageConfig,
  LandingPageConfig,
  DEFAULT_LANDING_CONFIG,
} from '../../lib/api';

interface LandingPageProps {
  onGoToLogin: () => void;
  onOpenPortal?: () => void;
  onOpenPrivacy?: () => void;
  initialConfig?: LandingPageConfig;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onGoToLogin,
  onOpenPortal,
  onOpenPrivacy,
  initialConfig,
}) => {
  // Live Config State (Defaults to Static Production Config for 0ms Zero-CLS Render)
  const [cfg, setCfg] = useState<LandingPageConfig>(initialConfig || DEFAULT_LANDING_CONFIG);

  useEffect(() => {
    if (initialConfig) {
      setCfg(initialConfig);
    }
  }, [initialConfig]);

  useEffect(() => {
    // Background optimistic hydration
    let isMounted = true;
    fetchLandingPageConfig().then((liveConfig) => {
      if (isMounted && liveConfig) {
        setCfg(liveConfig);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Demo Booking Modal State
  const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
  const [modalTargetTier, setModalTargetTier] = useState<string>('');
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
  const [clientVolume, setClientVolume] = useState(cfg.roi_default_clients || 12);
  const [monthlyInvoicesPerClient, setMonthlyInvoicesPerClient] = useState(cfg.roi_default_slips || 180);

  // Live OCR Sandbox States
  const [sandboxSample, setSandboxSample] = useState<'laundry' | 'receipt' | 'momo'>('laundry');
  const [isSimulatingOcr, setIsSimulatingOcr] = useState(false);
  const [ocrCompleted, setOcrCompleted] = useState(true);

  // FAQ Accordion State
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  // ROI Calculations
  const hourlyRate = cfg.roi_hourly_rate_ghs || 75;
  const totalMonthlyDocs = clientVolume * monthlyInvoicesPerClient;
  const manualHoursSpent = Math.round((totalMonthlyDocs * 3.5) / 60);
  const hoursSaved = Math.round(manualHoursSpent * 0.86);
  const estimatedSavingsGhs = hoursSaved * hourlyRate;

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
        biggest_headache: modalTargetTier ? `Interested in ${modalTargetTier} tier. ${headache}` : headache,
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

  const openLeadModalWithTier = (tierTitle?: string) => {
    setModalTargetTier(tierTitle || '');
    setIsLeadModalOpen(true);
  };

  const cleanWhatsappNumber = (cfg.whatsapp_number || '233200000000').replace(/[^0-9]/g, '');
  const whatsappUrl = `https://wa.me/${cleanWhatsappNumber}?text=${encodeURIComponent(
    cfg.whatsapp_message || "Hi S4 Team, I'd like to test 3 sample receipts/invoices from my firm for automation."
  )}`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-sky-500 selection:text-white">
      
      {/* 0. Optional Global Announcement Banner */}
      {cfg.show_announcement && cfg.announcement_enabled && cfg.announcement_text && (
        <div className="bg-gradient-to-r from-sky-900/90 via-indigo-900/90 to-purple-900/90 border-b border-indigo-500/30 px-4 py-2 text-center text-xs font-medium text-slate-200 flex items-center justify-center gap-2">
          {cfg.announcement_badge && (
            <span className="px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-400/40 text-[10px] font-bold uppercase tracking-wider">
              {cfg.announcement_badge}
            </span>
          )}
          <span>{cfg.announcement_text}</span>
          {cfg.announcement_link && (
            <a
              href={cfg.announcement_link}
              className="text-sky-300 hover:text-white underline font-bold flex items-center gap-0.5 ml-1"
            >
              <span>Learn more</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      )}

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

          <nav className="hidden lg:flex items-center gap-6 text-xs font-medium text-slate-300">
            {cfg.show_how_it_works && (
              <a href="#how-it-works" className="hover:text-white transition">
                How It Works
              </a>
            )}
            {cfg.show_ocr_sandbox && (
              <a href="#ocr-sandbox" className="hover:text-white transition">
                Live OCR Demo
              </a>
            )}
            {cfg.show_roi_calculator && (
              <a href="#roi-calculator" className="hover:text-white transition">
                ROI Calculator
              </a>
            )}
            {cfg.show_pricing && (
              <a href="#pricing" className="hover:text-white transition">
                Pricing &amp; Pilots
              </a>
            )}
            {cfg.show_faq && (
              <a href="#faq" className="hover:text-white transition">
                FAQ
              </a>
            )}
          </nav>

          <div className="flex items-center gap-2.5 sm:gap-3">
            {cfg.show_client_portal_link && onOpenPortal && (
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
              onClick={() => openLeadModalWithTier()}
              className="px-3.5 sm:px-4 py-2 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 transition cursor-pointer flex items-center gap-1.5"
            >
              <span>Book Firm Demo</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* 2. Hero Section */}
      {cfg.show_hero && (
        <section className="relative overflow-hidden pt-16 pb-20 lg:pt-24 lg:pb-28 border-b border-slate-800">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.15),rgba(255,255,255,0))]" />

          <div className="relative max-w-5xl mx-auto px-4 sm:px-6 text-center space-y-6">
            {cfg.hero_badge && (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-700/80 text-[11px] font-semibold text-sky-300 shadow-sm animate-in fade-in">
                <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                <span>{cfg.hero_badge}</span>
              </div>
            )}

            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight leading-[1.15]">
              {cfg.hero_headline}
            </h1>

            <p className="text-sm sm:text-base text-slate-300 max-w-3xl mx-auto leading-relaxed">
              {cfg.hero_subheadline}
            </p>

            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
              <button
                onClick={() => openLeadModalWithTier('Free Firm Walkthrough')}
                className="w-full sm:w-auto px-6 py-3.5 bg-gradient-to-r from-sky-600 via-indigo-600 to-purple-600 hover:from-sky-500 hover:to-purple-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-xl shadow-indigo-600/30 transition cursor-pointer flex items-center justify-center gap-2"
              >
                <span>{cfg.hero_primary_cta_text || 'Request a Free Firm Walkthrough'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <a
                href={whatsappUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full sm:w-auto px-5 py-3.5 bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20"
              >
                <MessageSquare className="w-4 h-4 text-emerald-400" />
                <span>Send 3 Sample Slips on WhatsApp (10-Min Audit)</span>
              </a>
            </div>

            {/* Highlights Strip */}
            {cfg.hero_highlights && cfg.hero_highlights.length > 0 && (
              <div className="pt-8 flex flex-wrap items-center justify-center gap-6 sm:gap-10 text-xs text-slate-400 font-medium">
                {cfg.hero_highlights.map((highlight, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{highlight}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* 3. How It Works in 3 Simple Steps (Competitive Moat: Outcome-based) */}
      {cfg.show_how_it_works && (
        <section id="how-it-works" className="py-20 border-b border-slate-800 bg-slate-900/30">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
            <div className="text-center max-w-2xl mx-auto space-y-2">
              <span className="text-xs font-bold text-sky-400 uppercase tracking-wider">
                Frictionless Onboarding
              </span>
              <h2 className="text-2xl sm:text-3xl font-black text-white">
                How It Works in 3 Simple Steps
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Zero system migration. Zero staff learning curve. Keep your existing folders and accounting setup.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
              {/* Step 1 */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4 relative">
                <div className="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30 flex items-center justify-center font-black text-sm">
                  1
                </div>
                <h3 className="text-base font-bold text-white">Drop, Email, or Snap</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Drop paper scans into your existing Google Drive, forward supplier bills by email, or snap receipts directly with your phone. S4 connects via Bring-Your-Own-Storage.
                </p>
                <div className="pt-2 text-[11px] text-sky-300 font-medium flex items-center gap-1">
                  <Check className="w-3.5 h-3.5 text-sky-400" />
                  <span>Supports PDF, JPG, PNG, and WhatsApp photos</span>
                </div>
              </div>

              {/* Step 2 */}
              <div className="bg-slate-900/80 border border-indigo-500/40 rounded-2xl p-6 space-y-4 relative shadow-lg shadow-indigo-950/40">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center font-black text-sm">
                  2
                </div>
                <h3 className="text-base font-bold text-white">Review &amp; Reconcile</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  The S4 Neural Ingestion Engine™ reads handwriting, calculates statutory Ghana VAT/NHIL taxes, and flags discrepancies. Verify totals in a familiar Google Sheet or web inbox.
                </p>
                <div className="pt-2 text-[11px] text-indigo-300 font-medium flex items-center gap-1">
                  <Check className="w-3.5 h-3.5 text-indigo-400" />
                  <span>100% human-in-the-loop CPA oversight</span>
                </div>
              </div>

              {/* Step 3 */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4 relative">
                <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30 flex items-center justify-center font-black text-sm">
                  3
                </div>
                <h3 className="text-base font-bold text-white">1-Click Accounting Sync</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Click 'Create Draft Invoices' to push verified line items directly into Zoho Books, QuickBooks, or Xero. Our idempotent engine guarantees zero duplicate ledger records.
                </p>
                <div className="pt-2 text-[11px] text-purple-300 font-medium flex items-center gap-1">
                  <Check className="w-3.5 h-3.5 text-purple-400" />
                  <span>Posts to exact General Ledger accounts</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 4. Interactive OCR Sandbox Section */}
      {cfg.show_ocr_sandbox && (
        <section id="ocr-sandbox" className="py-20 border-b border-slate-800 bg-slate-950/60">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
            <div className="text-center max-w-2xl mx-auto space-y-2">
              <span className="text-xs font-bold text-sky-400 uppercase tracking-wider">
                Interactive Live Demo
              </span>
              <h2 className="text-2xl sm:text-3xl font-black text-white">
                See How Vision AI Handles Messy Unstructured Ingestion
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Select a messy sample document below to simulate how the S4 engine extracts line items, reconciles counts, and prepares ERP postings.
              </p>
            </div>

            {/* Sample Switcher Tabs */}
            <div className="flex flex-wrap justify-center gap-2">
              {[
                { id: 'laundry', label: 'Hospitality Linen & Laundry Docket (Handwritten)' },
                { id: 'receipt', label: 'Fuel, Hardware & Vendor Bill (Crumpled)' },
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

            {/* Sandbox Comparison View */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
              {/* Left: Document Mock (5 cols) */}
              <div className="lg:col-span-5 bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-4">
                <div className="flex items-center justify-between border-b border-slate-850 pb-2">
                  <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
                    Raw Document Feed
                  </span>
                  <span className="text-[10px] bg-amber-950 text-amber-300 border border-amber-800 px-2 py-0.5 rounded font-mono">
                    Unstructured Physical Slip
                  </span>
                </div>

                <div className="p-4 bg-slate-900/60 rounded-lg border border-slate-800 font-mono text-[11px] text-slate-300 space-y-2.5">
                  {sandboxSample === 'laundry' ? (
                    <>
                      <div className="text-xs font-bold text-white border-b border-slate-800 pb-1">
                        ANR LAUNDRY DOCKET #0482
                      </div>
                      <p className="text-slate-400">Date: 14/08/2026 • Client: Hotel Spintex</p>
                      <div className="space-y-1 pt-1 text-slate-300">
                        <p>• Bed Sheets (King): Picked up 45 / Delivered 42 (3 unreturned)</p>
                        <p>• Duvet Covers: 20 pcs delivered</p>
                        <p>• Pillow Slips: 90 pcs counted</p>
                        <p>• Bath Towels: 70 pcs delivered</p>
                      </div>
                      <div className="text-[10px] text-amber-400 pt-1 italic">
                        [Handwritten ink, carbon copy fade, smudged counts]
                      </div>
                    </>
                  ) : sandboxSample === 'receipt' ? (
                    <>
                      <div className="text-xs font-bold text-white border-b border-slate-800 pb-1">
                        TOTAL ENERGIES GH #99142
                      </div>
                      <p className="text-slate-400">Date: 22/08/2026 • Pump 04</p>
                      <div className="space-y-1 pt-1 text-slate-300">
                        <p>• Super XP Petrol: 55.4 Litres @ 14.80</p>
                        <p>• Engine Lubricant Oil: 1 can @ 240.00</p>
                        <p>• Total Amount Paid: GHS 1,059.92 (Cash)</p>
                      </div>
                      <div className="text-[10px] text-amber-400 pt-1 italic">
                        [Thermal paper crumple, low contrast scan]
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-xs font-bold text-white border-b border-slate-800 pb-1">
                        MTN MOMO RECONCILIATION EXCERPT
                      </div>
                      <p className="text-slate-400">Account: 0244000000 • August 2026</p>
                      <div className="space-y-1 pt-1 text-slate-300">
                        <p>• TxID: 28894191 - GHS 4,500.00 - Ref: Direct Payment</p>
                        <p>• TxID: 28894205 - GHS 1,200.00 - Ref: Supplier Disb</p>
                      </div>
                      <div className="text-[10px] text-amber-400 pt-1 italic">
                        [Unmapped narrative string needing Chart-of-Account classification]
                      </div>
                    </>
                  )}
                </div>

                <div className="text-[11px] text-slate-400 flex items-center justify-between">
                  <span>Confidence: <strong className="text-emerald-400 font-mono">99.4%</strong></span>
                  <span>Engine: <strong className="text-sky-400">Gemini 2.5 Flash</strong></span>
                </div>
              </div>

              {/* Right: Extracted Structured Ledger (7 cols) */}
              <div className="lg:col-span-7 flex flex-col justify-between space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold text-white">Extracted Accounting Line Items</span>
                  </div>
                  <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                    Ready for 1-Click Sync
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-slate-950 text-slate-400 font-bold border border-slate-800">
                      <tr>
                        <th className="py-2 px-3">Item / Description</th>
                        <th className="py-2 px-2 text-right">Qty</th>
                        <th className="py-2 px-2 text-right">Rate</th>
                        <th className="py-2 px-3 text-right">Total (GHS)</th>
                        <th className="py-2 px-2 text-center">Audit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850 text-slate-200 bg-slate-950/40">
                      {sandboxSample === 'laundry' ? (
                        <>
                          <tr>
                            <td className="py-2 px-3 font-medium text-white">Bed Sheets (King Size)</td>
                            <td className="py-2 px-2 text-right font-mono">42</td>
                            <td className="py-2 px-2 text-right font-mono">13.00</td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-white">546.00</td>
                            <td className="py-2 px-2 text-center text-amber-400 text-[10px] font-mono">3 Discrepancy</td>
                          </tr>
                          <tr>
                            <td className="py-2 px-3 font-medium text-white">Duvet Covers</td>
                            <td className="py-2 px-2 text-right font-mono">20</td>
                            <td className="py-2 px-2 text-right font-mono">25.00</td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-white">500.00</td>
                            <td className="py-2 px-2 text-center text-emerald-400 text-[10px] font-mono">Verified</td>
                          </tr>
                          <tr>
                            <td className="py-2 px-3 font-medium text-white">Bath Towels</td>
                            <td className="py-2 px-2 text-right font-mono">70</td>
                            <td className="py-2 px-2 text-right font-mono">9.00</td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-white">630.00</td>
                            <td className="py-2 px-2 text-center text-emerald-400 text-[10px] font-mono">Verified</td>
                          </tr>
                        </>
                      ) : (
                        <>
                          <tr>
                            <td className="py-2 px-3 font-medium text-white">Vehicle Fuel (Super Petrol)</td>
                            <td className="py-2 px-2 text-right font-mono">55.4</td>
                            <td className="py-2 px-2 text-right font-mono">14.80</td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-white">819.92</td>
                            <td className="py-2 px-2 text-center text-emerald-400 text-[10px] font-mono">VAT Applied</td>
                          </tr>
                          <tr>
                            <td className="py-2 px-3 font-medium text-white">Automobile Lubricant Oil</td>
                            <td className="py-2 px-2 text-right font-mono">1</td>
                            <td className="py-2 px-2 text-right font-mono">240.00</td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-white">240.00</td>
                            <td className="py-2 px-2 text-center text-emerald-400 text-[10px] font-mono">Account 60020</td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-xs text-slate-400">
                    Draft invoice automatically prepared for <strong>Zoho Books &amp; QuickBooks</strong>
                  </span>
                  <button
                    onClick={() => openLeadModalWithTier('Free OCR Trial')}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1"
                  >
                    <span>Automate Your Firm's Documents</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 5. ROI & Hours-Saved Calculator */}
      {cfg.show_roi_calculator && (
        <section id="roi-calculator" className="py-20 border-b border-slate-800 bg-slate-900/30">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
            <div className="text-center max-w-2xl mx-auto space-y-2">
              <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                Measurable Return on Investment
              </span>
              <h2 className="text-2xl sm:text-3xl font-black text-white">
                Calculate How Many Hours S4 Reclaims for Your Firm
              </h2>
              <p className="text-xs sm:text-sm text-slate-400">
                Manual document entry consumes up to 60% of junior bookkeepers' billable hours. See your monthly savings:
              </p>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center shadow-xl">
              {/* Left: Sliders */}
              <div className="lg:col-span-7 space-y-6">
                <div>
                  <div className="flex items-center justify-between text-xs font-bold text-white mb-2">
                    <span>Number of Business Clients or Entities Managed:</span>
                    <span className="text-sm font-mono text-sky-400 bg-sky-950 px-2.5 py-0.5 rounded border border-sky-800">
                      {clientVolume} Entities
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
                    <span>Average Monthly Receipts / Control Slips per Client:</span>
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
                    Your team currently handles approximately <strong>{totalMonthlyDocs.toLocaleString()} documents</strong> each month, spending roughly <strong>{manualHoursSpent} hours</strong> on repetitive typing.
                  </p>
                </div>
              </div>

              {/* Right: Savings Card */}
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
                    Calculated at conservative GHS {hourlyRate}/hr bookkeeping cost
                  </p>
                </div>

                <button
                  onClick={() => openLeadModalWithTier('ROI Savings Pilot')}
                  className="w-full py-3 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 transition cursor-pointer"
                >
                  Claim These Savings for Your Firm
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 6. ERP Integrations Strip */}
      {cfg.show_integrations && (
        <section id="integrations" className="py-16 border-b border-slate-800 bg-slate-950">
          <div className="max-w-6xl mx-auto px-4 text-center space-y-6">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Connected Directly to Leading Accounting &amp; Treasury Platforms
            </p>

            <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10 opacity-90">
              <div className="px-5 py-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-2">
                <span className="text-sm font-bold text-white">Zoho Books</span>
                <span className="text-[10px] text-emerald-400 font-mono bg-emerald-950 px-1.5 py-0.5 rounded">
                  1-Click OAuth
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
                  Direct Ingest
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 7. Anonymized Industry Results & Social Proof (Competitive Moat Safeguarded) */}
      {cfg.show_social_proof && (
        <section className="py-20 border-b border-slate-800 bg-slate-900/40">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
            <div className="text-center max-w-2xl mx-auto space-y-2">
              <span className="text-xs font-bold text-purple-400 uppercase tracking-wider">
                Proven Track Record
              </span>
              <h2 className="text-2xl sm:text-3xl font-black text-white">
                Trusted by Top Accounting Practices &amp; High-Volume Businesses
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Real operational benchmarks across West African hospitality, retail, and advisory firms.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                <div className="flex items-center gap-2 text-sky-400">
                  <Award className="w-5 h-5" />
                  <span className="text-xs font-bold uppercase tracking-wider">Hospitality &amp; Hotel Linen</span>
                </div>
                <h3 className="text-sm font-bold text-white leading-snug">
                  "4 Days of Linen Reconciliation Cut to 15 Minutes"
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  A premier Accra hospitality group processing over 800 monthly multi-item laundry control chits eliminated manual keying and discrepancy arguments with suppliers.
                </p>
                <div className="pt-2 border-t border-slate-850 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                  <span>Reconciliation: 100%</span>
                  <span>Discrepancy: Tracked</span>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                <div className="flex items-center gap-2 text-indigo-400">
                  <Building2 className="w-5 h-5" />
                  <span className="text-xs font-bold uppercase tracking-wider">Audit &amp; CPA Practice</span>
                </div>
                <h3 className="text-sm font-bold text-white leading-snug">
                  "28 Client Entities Automated Without Adding Staff"
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  An accounting advisory firm automated vendor bill processing, receipts, and client clarification emails for their entire client portfolio on Zoho Books.
                </p>
                <div className="pt-2 border-t border-slate-850 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                  <span>Client Portfolio: 28</span>
                  <span>Ledger Duplicates: 0</span>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                <div className="flex items-center gap-2 text-emerald-400">
                  <TrendingUp className="w-5 h-5" />
                  <span className="text-xs font-bold uppercase tracking-wider">Multi-Branch Retail &amp; MoMo</span>
                </div>
                <h3 className="text-sm font-bold text-white leading-snug">
                  "GHS 1.4M in Monthly Cash &amp; MoMo Reconciled"
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Direct ingestion of mobile money statements matched suspense disbursements directly against petty cash receipts with automatic statutory VAT calculation.
                </p>
                <div className="pt-2 border-t border-slate-850 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                  <span>Accuracy: 99.4%</span>
                  <span>Posting: 1-Click</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 8. Pricing & Pilot Packages (Toggable) */}
      {cfg.show_pricing && (
        <section id="pricing" className="py-20 border-b border-slate-800 bg-slate-950">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
            <div className="text-center max-w-2xl mx-auto space-y-2">
              <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                Transparent Value Tiers
              </span>
              <h2 className="text-2xl sm:text-3xl font-black text-white">
                Simple, High-ROI Plans Built for Your Scale
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Start with a zero-risk 20-slip pilot. Scale seamlessly as your client volume grows.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {(cfg.pricing_tiers || []).map((tier) => (
                <div
                  key={tier.id}
                  className={`bg-slate-900 rounded-2xl p-6 flex flex-col justify-between space-y-6 relative transition border ${
                    tier.is_popular
                      ? 'border-indigo-500/80 shadow-2xl shadow-indigo-950/60 bg-gradient-to-b from-slate-900 to-indigo-950/30'
                      : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {tier.badge && (
                    <div className="absolute -top-3 left-6">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-500 text-white shadow">
                        {tier.badge}
                      </span>
                    </div>
                  )}

                  <div className="space-y-3">
                    <h3 className="text-base font-bold text-white">{tier.title}</h3>
                    <p className="text-xs text-slate-400 leading-relaxed min-h-[36px]">
                      {tier.subtitle}
                    </p>

                    <div className="pt-2">
                      <div className="text-2xl font-black text-white">{tier.price_display}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{tier.period}</div>
                    </div>

                    <div className="pt-4 border-t border-slate-800 space-y-2.5">
                      {tier.features.map((feat, fIdx) => (
                        <div key={fIdx} className="flex items-start gap-2 text-xs text-slate-300">
                          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      if (tier.cta_action === 'whatsapp') {
                        window.open(whatsappUrl, '_blank');
                      } else {
                        openLeadModalWithTier(tier.title);
                      }
                    }}
                    className={`w-full py-2.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 ${
                      tier.is_popular
                        ? 'bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white shadow-lg shadow-indigo-600/30'
                        : 'bg-slate-800 hover:bg-slate-700 text-white'
                    }`}
                  >
                    <span>{tier.cta_text}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 9. Objection-Buster FAQ Section (Toggable) */}
      {cfg.show_faq && (
        <section id="faq" className="py-20 border-b border-slate-800 bg-slate-900/30">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
            <div className="text-center max-w-2xl mx-auto space-y-2">
              <span className="text-xs font-bold text-sky-400 uppercase tracking-wider">
                Frequently Asked Questions
              </span>
              <h2 className="text-2xl sm:text-3xl font-black text-white">
                Everything You Need to Know Before Getting Started
              </h2>
            </div>

            <div className="space-y-3">
              {(cfg.faq_items || []).map((faq, idx) => {
                const isOpen = openFaqIndex === idx;
                return (
                  <div
                    key={idx}
                    className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden transition"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                      className="w-full text-left px-5 py-4 flex items-center justify-between gap-4 cursor-pointer text-xs sm:text-sm font-bold text-white hover:text-sky-300 transition"
                    >
                      <span className="flex items-center gap-2">
                        <HelpCircle className="w-4 h-4 text-sky-400 shrink-0" />
                        <span>{faq.question}</span>
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180 text-sky-400' : ''}`}
                      />
                    </button>
                    {isOpen && (
                      <div className="px-5 pb-4 pt-1 text-xs text-slate-300 leading-relaxed border-t border-slate-850">
                        {faq.answer}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* 10. Call To Action Footer Banner */}
      {cfg.show_cta_banner && (
        <section className="py-20 bg-gradient-to-b from-slate-950 to-indigo-950/40 text-center border-b border-slate-800">
          <div className="max-w-3xl mx-auto px-4 space-y-6">
            <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
              Ready to Eliminate Manual Ingestion This Week?
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Join forward-thinking accounting firms and businesses eliminating manual data entry. We'll run a sample batch of your documents for free.
            </p>
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => openLeadModalWithTier('Free Automation Walkthrough')}
                className="px-6 py-3 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-xl shadow-indigo-600/30 transition cursor-pointer"
              >
                Book Your Free Automation Walkthrough
              </button>
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noreferrer"
                className="px-5 py-3 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs sm:text-sm font-semibold transition flex items-center gap-2"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Chat with Senior Team on WhatsApp</span>
              </a>
            </div>
          </div>
        </section>
      )}

      {/* 11. Footer */}
      <footer className="py-8 bg-slate-950 text-slate-500 text-xs">
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
            {cfg.show_ocr_sandbox && (
              <>
                <span>•</span>
                <a href="#ocr-sandbox" className="hover:text-slate-200 transition">
                  Live OCR Sandbox
                </a>
              </>
            )}
            {cfg.show_roi_calculator && (
              <>
                <span>•</span>
                <a href="#roi-calculator" className="hover:text-slate-200 transition">
                  ROI Calculator
                </a>
              </>
            )}
            {cfg.show_client_portal_link && onOpenPortal && (
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

      {/* 12. Lead Booking & Pilot Modal */}
      {isLeadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-sky-400" />
                <h3 className="text-base font-bold text-white">
                  {modalTargetTier ? `Start Pilot: ${modalTargetTier}` : 'Book a Live Firm Walkthrough'}
                </h3>
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
                  {leadSuccessMessage} Check your email inbox for confirmation and pilot instructions.
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
