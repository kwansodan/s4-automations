import React, { useState, useEffect } from 'react';
import {
  Globe,
  Sliders,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Save,
  Eye,
  History,
  Users,
  MessageSquare,
  Lock,
  ArrowRight,
  ExternalLink,
  DollarSign,
  HelpCircle,
  FileText,
  Building2,
  Check,
  Search,
  Sparkles,
} from 'lucide-react';
import {
  fetchLandingPageConfig,
  saveLandingPageConfig,
  rollbackLandingPageConfig,
  fetchMarketingLeadsList,
  updateMarketingLeadStatus,
  LandingPageConfig,
  DEFAULT_LANDING_CONFIG,
  LandingPageMode,
} from '../../lib/api';
import { useAutomation } from '../../context/AutomationContext';

export const LandingManagerSection: React.FC = () => {
  const { addLog } = useAutomation();

  const [config, setConfig] = useState<LandingPageConfig>(DEFAULT_LANDING_CONFIG);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Active sub-tab in manager
  const [activeTab, setActiveTab] = useState<'mode' | 'toggles' | 'content' | 'leads' | 'history'>('mode');

  // Leads CRM State
  const [leads, setLeads] = useState<any[]>([]);
  const [totalLeads, setTotalLeads] = useState(0);
  const [leadsFilter, setLeadsFilter] = useState('ALL');
  const [leadsSearch, setLeadsSearch] = useState('');
  const [isLoadingLeads, setIsLoadingLeads] = useState(false);

  // Load configuration from backend
  const loadConfig = async () => {
    setIsLoading(true);
    try {
      const live = await fetchLandingPageConfig();
      setConfig(live);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed loading landing page configuration');
    } finally {
      setIsLoading(false);
    }
  };

  // Load leads
  const loadLeads = async () => {
    setIsLoadingLeads(true);
    try {
      const res = await fetchMarketingLeadsList(leadsFilter, leadsSearch);
      setLeads(res.leads || []);
      setTotalLeads(res.total_count || 0);
    } catch (err: any) {
      console.warn('Could not load marketing leads:', err);
    } finally {
      setIsLoadingLeads(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (activeTab === 'leads') {
      loadLeads();
    }
  }, [activeTab, leadsFilter, leadsSearch]);

  const handleSave = async (overrideData?: Partial<LandingPageConfig>) => {
    setIsSaving(true);
    setErrorMessage('');
    setSaveSuccess(false);

    const payload = {
      ...config,
      ...(overrideData || {}),
      last_updated_by: 'Platform Administrator',
    };

    try {
      const res = await saveLandingPageConfig(payload);
      setConfig(res.config);
      setSaveSuccess(true);
      addLog('success', `🎉 Published Landing Page Config v${res.config.version} (Mode: ${res.config.mode.toUpperCase()})`);
      setTimeout(() => setSaveSuccess(false), 3500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed saving configuration');
      addLog('error', `Failed to publish landing page config: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleModeSelect = async (newMode: LandingPageMode) => {
    setConfig((prev) => ({ ...prev, mode: newMode }));
    await handleSave({ mode: newMode });
  };

  const handleToggle = (key: keyof LandingPageConfig) => {
    setConfig((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleRollback = async (versionId: number) => {
    if (!confirm(`Are you sure you want to rollback to Version ${versionId}? Current state will be archived.`)) {
      return;
    }
    setIsSaving(true);
    try {
      const res = await rollbackLandingPageConfig(versionId);
      setConfig(res.config);
      addLog('success', `Restored Landing Page configuration to snapshot v${versionId}.`);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      alert(`Rollback failed: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLeadStatusChange = async (leadId: number, status: string) => {
    try {
      await updateMarketingLeadStatus(leadId, status);
      setLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, status } : l))
      );
      addLog('info', `Updated lead #${leadId} status to ${status}`);
    } catch (err: any) {
      alert(`Status update failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Header Toolbar */}
      <div className="glass-panel rounded-2xl p-5 shadow-xl border border-[#E2E8F0] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-[#0284C7]" />
            <h2 className="text-base font-bold text-white tracking-tight">
              Landing Page &amp; Visitor Visibility Manager
            </h2>
            <span className="text-[10px] font-mono font-bold text-[#0284C7] bg-[#F0F9FF] border border-sky-500/30 px-2 py-0.5 rounded-full">
              v{config.version || 1}
            </span>
            <span
              className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border ${
                config.mode === 'public'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-500/40'
                  : config.mode === 'login_only'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-500/40'
                  : 'bg-amber-50 text-amber-700 border-amber-500/40'
              }`}
            >
              {config.mode === 'public'
                ? '🌐 Public Marketing'
                : config.mode === 'login_only'
                ? '🔒 Direct Login Only'
                : '🛠️ Maintenance / Private Beta'}
            </span>
          </div>
          <p className="text-xs text-[#64748B] mt-0.5">
            Control what visitors see, toggle marketing sections, edit value propositions, and manage inbound pilot leads.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <a
            href="/"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-[#E2E8F0] rounded-xl text-xs font-semibold transition cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5 text-[#0284C7]" />
            <span>Preview Public Site</span>
            <ExternalLink className="w-3 h-3" />
          </a>

          <button
            onClick={() => handleSave()}
            disabled={isSaving}
            className="flex items-center gap-1.5 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg shadow-indigo-600/30 transition cursor-pointer disabled:opacity-50"
          >
            {isSaving ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>{isSaving ? 'Publishing...' : 'Save & Publish'}</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {saveSuccess && (
        <div className="bg-emerald-50 border border-emerald-500/40 rounded-xl p-3 text-xs text-emerald-700 flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>Landing page configuration updated and cached globally across all edge routes!</span>
        </div>
      )}

      {errorMessage && (
        <div className="bg-rose-50 border border-rose-500/40 rounded-xl p-3 text-xs text-rose-700 flex items-center gap-2 animate-in fade-in">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* 2. Sub Navigation */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#E2E8F0] pb-3">
        {[
          { id: 'mode', label: 'Visitor Access Mode', icon: ShieldCheck },
          { id: 'toggles', label: 'Section Visibility Switchboard', icon: Sliders },
          { id: 'content', label: 'Content & Conversion Editor', icon: Sparkles },
          { id: 'leads', label: `Inbound Leads (${totalLeads})`, icon: Users },
          { id: 'history', label: 'Version History & Rollback', icon: History },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer border ${
                isActive
                  ? 'bg-sky-600/20 text-[#0284C7] border-sky-500/50 shadow-sm'
                  : 'bg-white border-[#E2E8F0] text-[#64748B] hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* 3. Tab Content */}

      {/* TAB 1: VISITOR ACCESS MODE */}
      {activeTab === 'mode' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Mode 1: Public */}
            <div
              onClick={() => handleModeSelect('public')}
              className={`bg-white rounded-2xl p-5 border cursor-pointer transition flex flex-col justify-between space-y-4 ${
                config.mode === 'public'
                  ? 'border-emerald-500 shadow-xl shadow-emerald-100 bg-gradient-to-b from-white to-emerald-50/60'
                  : 'border-[#E2E8F0] hover:border-[#E2E8F0]'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-600 flex items-center justify-center">
                    <Globe className="w-4 h-4" />
                  </div>
                  {config.mode === 'public' && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-500/40">
                      Active Mode
                    </span>
                  )}
                </div>
                <h3 className="text-sm font-bold text-white">Public Marketing Mode</h3>
                <p className="text-xs text-[#64748B] leading-relaxed">
                  Visitors landing on your root domain see the full marketing landing page with the sections you have toggled on below.
                </p>
              </div>

              <div className="pt-3 border-t border-[#E2E8F0] text-[11px] text-slate-700 flex items-center justify-between">
                <span>Recommended for growth &amp; demos</span>
                <span className="font-mono text-emerald-600">Default</span>
              </div>
            </div>

            {/* Mode 2: Direct Login Only */}
            <div
              onClick={() => handleModeSelect('login_only')}
              className={`bg-white rounded-2xl p-5 border cursor-pointer transition flex flex-col justify-between space-y-4 ${
                config.mode === 'login_only'
                  ? 'border-indigo-500 shadow-xl shadow-indigo-100 bg-gradient-to-b from-white to-indigo-50/60'
                  : 'border-[#E2E8F0] hover:border-[#E2E8F0]'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-600 flex items-center justify-center">
                    <Lock className="w-4 h-4" />
                  </div>
                  {config.mode === 'login_only' && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-500/40">
                      Active Mode
                    </span>
                  )}
                </div>
                <h3 className="text-sm font-bold text-white">Direct Login Only (Bypass Marketing)</h3>
                <p className="text-xs text-[#64748B] leading-relaxed">
                  Bypasses the marketing landing page completely. Any visitor hitting <code className="text-indigo-600">/</code> is immediately presented with the secure staff &amp; client sign-in card.
                </p>
              </div>

              <div className="pt-3 border-t border-[#E2E8F0] text-[11px] text-slate-700 flex items-center justify-between">
                <span>Ideal for private firm portals</span>
                <span className="font-mono text-indigo-600">Gatekeeper</span>
              </div>
            </div>

            {/* Mode 3: Maintenance / Private Beta */}
            <div
              onClick={() => handleModeSelect('maintenance')}
              className={`bg-white rounded-2xl p-5 border cursor-pointer transition flex flex-col justify-between space-y-4 ${
                config.mode === 'maintenance'
                  ? 'border-amber-500 shadow-xl shadow-amber-100 bg-gradient-to-b from-white to-amber-50/60'
                  : 'border-[#E2E8F0] hover:border-[#E2E8F0]'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-600 flex items-center justify-center">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  {config.mode === 'maintenance' && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-500/40">
                      Active Mode
                    </span>
                  )}
                </div>
                <h3 className="text-sm font-bold text-white">Private Beta / Maintenance</h3>
                <p className="text-xs text-[#64748B] leading-relaxed">
                  Shows a branded system upgrade screen with email notification signup. Authorized team members can still log in via a discreet staff link.
                </p>
              </div>

              <div className="pt-3 border-t border-[#E2E8F0] text-[11px] text-slate-700 flex items-center justify-between">
                <span>Use during infrastructure upgrades</span>
                <span className="font-mono text-amber-600">Safe Hold</span>
              </div>
            </div>
          </div>

          {/* Maintenance Screen Customizer */}
          {config.mode === 'maintenance' && (
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4 animate-in fade-in">
              <h3 className="text-xs font-bold text-amber-600 uppercase tracking-wider">
                Maintenance Screen Content Parameters
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-[#64748B] mb-1">
                    Maintenance Headline
                  </label>
                  <input
                    type="text"
                    value={config.maintenance_headline}
                    onChange={(e) => setConfig({ ...config, maintenance_headline: e.target.value })}
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#64748B] mb-1">
                    Estimated Time Badge
                  </label>
                  <input
                    type="text"
                    value={config.maintenance_estimated_time || ''}
                    onChange={(e) => setConfig({ ...config, maintenance_estimated_time: e.target.value })}
                    placeholder="e.g. Resuming at 08:00 UTC"
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[11px] font-semibold text-[#64748B] mb-1">
                    Emergency Support Email
                  </label>
                  <input
                    type="email"
                    value={config.maintenance_support_email || ''}
                    onChange={(e) => setConfig({ ...config, maintenance_support_email: e.target.value })}
                    placeholder="support@service4gh.com"
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[11px] font-semibold text-[#64748B] mb-1">
                    Maintenance Message / Explanation
                  </label>
                  <textarea
                    rows={2}
                    value={config.maintenance_message}
                    onChange={(e) => setConfig({ ...config, maintenance_message: e.target.value })}
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: SECTION VISIBILITY SWITCHBOARD */}
      {activeTab === 'toggles' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0] mb-4">
              <div>
                <h3 className="text-sm font-bold text-white">Public Section Visibility Switchboard</h3>
                <p className="text-xs text-[#64748B]">
                  Selectively hide or reveal any section of the landing page. Changes take effect instantly upon saving.
                </p>
              </div>
              <button
                onClick={() => handleSave()}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition cursor-pointer"
              >
                Apply Toggles
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                { key: 'show_announcement', title: 'Top Announcement Banner', desc: 'Prominent header strip for product updates' },
                { key: 'show_hero', title: 'Hero Section', desc: 'Main headline, subheadline, and primary CTAs' },
                { key: 'show_how_it_works', title: 'How It Works (3 Steps)', desc: 'Frictionless customer journey without tech leakage' },
                { key: 'show_ocr_sandbox', title: 'Interactive OCR Sandbox', desc: 'Live document-to-ledger interactive simulator' },
                { key: 'show_roi_calculator', title: 'ROI Hours-Saved Calculator', desc: 'Interactive sliders calculating monthly hours saved' },
                { key: 'show_integrations', title: 'ERP Integrations Strip', desc: 'Zoho, QuickBooks, Xero, and MoMo logos' },
                { key: 'show_social_proof', title: 'Anonymized Case Highlights', desc: 'Real operational benchmarks (hospitality, audit, retail)' },
                { key: 'show_pricing', title: 'Pricing & Pilot Packages', desc: 'Value tiers with Start Pilot guarantees' },
                { key: 'show_faq', title: 'Objection-Buster FAQ', desc: 'Answers CPA hesitations on tax, handwriting, and security' },
                { key: 'show_cta_banner', title: 'WhatsApp & Walkthrough Banner', desc: 'High-converting 10-minute pilot audit call-to-action' },
                { key: 'show_demo_modal', title: 'Lead Capture Booking Modal', desc: 'Inbound demo inquiry popup form' },
                { key: 'show_client_portal_link', title: 'Client Portal Header/Footer Link', desc: 'Direct link to client clarification portal' },
              ].map((item) => {
                const isEnabled = Boolean(config[item.key as keyof LandingPageConfig]);
                return (
                  <div
                    key={item.key}
                    onClick={() => handleToggle(item.key as keyof LandingPageConfig)}
                    className={`p-3.5 rounded-xl border cursor-pointer transition flex items-start justify-between gap-3 ${
                      isEnabled
                        ? 'bg-[#F8FAFC] border-emerald-500/50 hover:border-emerald-400'
                        : 'bg-[#F8FAFC] border-[#E2E8F0] hover:border-[#E2E8F0] opacity-60'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">{item.title}</span>
                      </div>
                      <p className="text-[11px] text-[#64748B] mt-0.5 leading-snug">{item.desc}</p>
                    </div>

                    <div
                      className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 border ${
                        isEnabled
                          ? 'bg-emerald-600 border-emerald-500 text-white'
                          : 'bg-white border-[#E2E8F0] text-transparent'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: CONTENT & CONVERSION EDITOR */}
      {activeTab === 'content' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* Announcement Bar */}
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-3">
            <h3 className="text-xs font-bold text-[#0284C7] uppercase tracking-wider">
              1. Announcement Bar
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#64748B] mb-1">Badge Text</label>
                <input
                  type="text"
                  value={config.announcement_badge}
                  onChange={(e) => setConfig({ ...config, announcement_badge: e.target.value })}
                  placeholder="e.g. What's New"
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[11px] font-semibold text-[#64748B] mb-1">Announcement Message</label>
                <input
                  type="text"
                  value={config.announcement_text}
                  onChange={(e) => setConfig({ ...config, announcement_text: e.target.value })}
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>
          </div>

          {/* Hero Content */}
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
            <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-wider">
              2. Hero Value Proposition
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#64748B] mb-1">Badge</label>
                <input
                  type="text"
                  value={config.hero_badge}
                  onChange={(e) => setConfig({ ...config, hero_badge: e.target.value })}
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#64748B] mb-1">Main Headline</label>
                <input
                  type="text"
                  value={config.hero_headline}
                  onChange={(e) => setConfig({ ...config, hero_headline: e.target.value })}
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#64748B] mb-1">Subheadline Description</label>
                <textarea
                  rows={2}
                  value={config.hero_subheadline}
                  onChange={(e) => setConfig({ ...config, hero_subheadline: e.target.value })}
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* WhatsApp Routing & Conversion */}
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
            <h3 className="text-xs font-bold text-emerald-600 uppercase tracking-wider">
              3. WhatsApp Lead Routing &amp; Audit Hook
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-[#64748B] mb-1">
                  WhatsApp Number (with country code, no +)
                </label>
                <input
                  type="text"
                  value={config.whatsapp_number}
                  onChange={(e) => setConfig({ ...config, whatsapp_number: e.target.value })}
                  placeholder="e.g. 233200000000"
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#64748B] mb-1">
                  ROI Hourly Rate (GHS)
                </label>
                <input
                  type="number"
                  value={config.roi_hourly_rate_ghs}
                  onChange={(e) => setConfig({ ...config, roi_hourly_rate_ghs: parseFloat(e.target.value) || 75 })}
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[11px] font-semibold text-[#64748B] mb-1">
                  Pre-filled WhatsApp Greeting Message
                </label>
                <input
                  type="text"
                  value={config.whatsapp_message}
                  onChange={(e) => setConfig({ ...config, whatsapp_message: e.target.value })}
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: INBOUND LEADS PIPELINE */}
      {activeTab === 'leads' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E2E8F0]">
              <div>
                <h3 className="text-sm font-bold text-white">Inbound Pilot &amp; Demo Inquiries</h3>
                <p className="text-xs text-[#64748B]">
                  Prospects who requested a live walkthrough or submitted sample documents.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search name, email, firm..."
                    value={leadsSearch}
                    onChange={(e) => setLeadsSearch(e.target.value)}
                    className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500 w-48"
                  />
                </div>

                <select
                  value={leadsFilter}
                  onChange={(e) => setLeadsFilter(e.target.value)}
                  className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none cursor-pointer"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="NEW">New</option>
                  <option value="CONTACTED">Contacted</option>
                  <option value="DEMO_SCHEDULED">Demo Scheduled</option>
                  <option value="PILOT_ACTIVE">Pilot Active</option>
                  <option value="CONVERTED">Converted</option>
                </select>

                <button
                  onClick={loadLeads}
                  disabled={isLoadingLeads}
                  className="p-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-slate-700 hover:text-white"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingLeads ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {leads.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-xs">
                No inbound leads matching filter. When visitors submit the demo or pilot form, they appear here.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F8FAFC] text-[#64748B] font-bold border border-[#E2E8F0]">
                    <tr>
                      <th className="py-2.5 px-3">Prospect</th>
                      <th className="py-2.5 px-3">Company / Firm</th>
                      <th className="py-2.5 px-2">Target ERP</th>
                      <th className="py-2.5 px-2">Phone / WhatsApp</th>
                      <th className="py-2.5 px-2">Date</th>
                      <th className="py-2.5 px-3 text-right">Stage Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0] text-[#0F172A]">
                    {leads.map((lead) => (
                      <tr key={lead.id} className="hover:bg-slate-50/40 transition">
                        <td className="py-3 px-3">
                          <div className="font-bold text-white">{lead.full_name}</div>
                          <div className="text-[11px] text-[#64748B] font-mono">{lead.email}</div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium text-[#0F172A]">{lead.company_name}</div>
                          <div className="text-[10px] text-slate-500">
                            {lead.accounting_firm ? '🏛️ CPA / Accounting Firm' : '🏢 Business Entity'}
                          </div>
                        </td>
                        <td className="py-3 px-2 font-mono text-[11px] text-[#0284C7]">
                          {lead.primary_accounting_software || 'zoho_books'}
                        </td>
                        <td className="py-3 px-2 font-mono text-[11px] text-slate-700">
                          {lead.phone_or_whatsapp ? (
                            <a
                              href={`https://wa.me/${lead.phone_or_whatsapp.replace(/[^0-9]/g, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-emerald-600 hover:underline flex items-center gap-1"
                            >
                              <span>{lead.phone_or_whatsapp}</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="py-3 px-2 text-[11px] text-[#64748B]">
                          {lead.created_at ? new Date(lead.created_at).toLocaleDateString() : '-'}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <select
                            value={lead.status}
                            onChange={(e) => handleLeadStatusChange(lead.id, e.target.value)}
                            className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-2 py-1 text-[11px] font-bold text-[#0F172A] focus:outline-none cursor-pointer"
                          >
                            <option value="NEW">New</option>
                            <option value="CONTACTED">Contacted</option>
                            <option value="DEMO_SCHEDULED">Demo Scheduled</option>
                            <option value="PILOT_ACTIVE">Pilot Active</option>
                            <option value="CONVERTED">Converted</option>
                            <option value="CLOSED">Closed</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: VERSION HISTORY & ROLLBACK */}
      {activeTab === 'history' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-white">Publish Snapshots &amp; 1-Click Rollback</h3>
              <p className="text-xs text-[#64748B]">
                Every time you publish landing page settings, a full snapshot is archived. Revert unwanted changes instantly.
              </p>
            </div>

            {(!config.version_history || config.version_history.length === 0) ? (
              <div className="py-12 text-center text-slate-500 text-xs">
                No past snapshots archived yet. Previous versions appear automatically after future publish events.
              </div>
            ) : (
              <div className="space-y-2.5">
                {config.version_history.map((snapshot: any, idx: number) => (
                  <div
                    key={idx}
                    className="p-3.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl flex items-center justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">Version {snapshot.version || 'Prior'}</span>
                        <span className="text-[10px] bg-slate-50 text-[#64748B] px-2 py-0.5 rounded font-mono">
                          Mode: {snapshot.mode?.toUpperCase() || 'PUBLIC'}
                        </span>
                        {snapshot.note && (
                          <span className="text-[10px] text-amber-600 font-mono">({snapshot.note})</span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#64748B] mt-0.5">
                        Archived: {snapshot.snapshot_timestamp ? new Date(snapshot.snapshot_timestamp).toLocaleString() : 'Past Session'} • Last by: {snapshot.last_updated_by || 'Admin'}
                      </p>
                    </div>

                    <button
                      onClick={() => handleRollback(snapshot.version)}
                      disabled={isSaving}
                      className="px-3 py-1.5 bg-white hover:bg-slate-100 text-[#0284C7] border border-sky-500/30 rounded-lg text-xs font-bold transition cursor-pointer disabled:opacity-50"
                    >
                      Restore This Version
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
