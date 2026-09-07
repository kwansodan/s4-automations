import React, { useState, useEffect } from 'react';
import { useAutomation } from '../../context/AutomationContext';
import {
  SlidersHorizontal,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Save,
  Key,
  Database,
  Cloud,
  Cpu,
  Mail,
  Zap,
  Sparkles,
  Lock,
  Server,
  Eye,
  EyeOff,
  Layers,
  Globe,
  Bell,
} from 'lucide-react';
import { testConnections } from '../../lib/api';
import type { DiagnosticsResult } from '../../types/config';

type ConfigCategory = 'ai' | 'notifications' | 'runtime' | 'database';

export const ConfigSection: React.FC = () => {
  const { config, saveSystemConfig, addLog } = useAutomation();

  const [formData, setFormData] = useState<Record<string, any>>(config || {});
  const [activeCategory, setActiveCategory] = useState<ConfigCategory>('ai');
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Show/hide masked secrets
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showMailjetSecret, setShowMailjetSecret] = useState(false);
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);
  const [showSaKey, setShowSaKey] = useState(false);

  useEffect(() => {
    if (config) {
      setFormData((prev) => ({ ...config, ...prev }));
    }
  }, [config]);

  const handleChange = (key: string, value: any) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveStatus('Saving platform settings...');
    try {
      await saveSystemConfig(formData);
      setSaveStatus('Platform configuration saved successfully!');
      addLog('success', 'Admin updated global platform configuration parameters.');
      setTimeout(() => setSaveStatus(''), 4000);
    } catch (err: any) {
      setSaveStatus(`Save failed: ${err.message}`);
      addLog('error', `Failed to save platform configuration: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunDiagnostics = async () => {
    setIsTesting(true);
    try {
      addLog('info', 'Executing live platform integration diagnostics across all subsystems...');
      const res = await testConnections();
      setDiagnostics(res);
      if (res.all_healthy) {
        addLog('success', 'All platform subsystems verified healthy.');
      } else {
        addLog('warning', 'One or more platform subsystem diagnostics reported issues.');
      }
    } catch (e: any) {
      console.error('Diagnostics failed:', e);
      addLog('error', `Diagnostics probe encountered an error: ${e.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header Panel */}
      <div className="glass-panel rounded-2xl p-5 shadow-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="p-2 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">
                  Platform Settings &amp; Global Infrastructure
                </h2>
                <span className="text-[10px] font-mono font-bold text-violet-400 bg-violet-950/80 border border-violet-500/40 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5" />
                  Admin Only
                </span>
                <span className="text-[10px] font-mono font-bold text-sky-400 bg-sky-950/80 border border-sky-500/30 px-2 py-0.5 rounded-full">
                  System Scope
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Configure platform-wide AI Vision models, Mailjet &amp; SMTP email gateways, Inngest orchestration, and database parameters.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={handleRunDiagnostics}
          disabled={isTesting}
          className="flex items-center gap-2 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-lg shadow-sky-600/30 transition cursor-pointer disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
          <span>{isTesting ? 'Testing Integrations...' : 'Run Integration Diagnostics'}</span>
        </button>
      </div>

      {/* Diagnostics Results Banner */}
      {diagnostics && (
        <div className="glass-panel rounded-2xl p-5 shadow-xl border border-slate-800 animate-in fade-in space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-white flex items-center gap-2 uppercase tracking-wider font-mono">
              <ShieldCheck className="w-4 h-4 text-sky-400" />
              <span>Platform Subsystems Live Diagnostic Report</span>
            </h3>
            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
              diagnostics.all_healthy ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/40' : 'bg-amber-950 text-amber-400 border border-amber-500/40'
            }`}>
              {diagnostics.all_healthy ? 'All Systems Operational' : 'Action Required'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Gemini Vision */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                  <span>Gemini OCR</span>
                </span>
                {diagnostics.gemini_status === 'CONNECTED' || diagnostics.gemini_status === 'MOCK_OK' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
              </div>
              <p className="text-[11px] text-slate-400 line-clamp-2">{diagnostics.gemini_message}</p>
            </div>

            {/* Zoho Books Gateway */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Zoho API</span>
                </span>
                {diagnostics.zoho_status === 'CONNECTED' || diagnostics.zoho_status === 'MOCK_OK' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
              </div>
              <p className="text-[11px] text-slate-400 line-clamp-2">{diagnostics.zoho_message}</p>
            </div>

            {/* Google Drive / Sheets */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Cloud className="w-3.5 h-3.5 text-sky-400" />
                  <span>Master Drive</span>
                </span>
                {diagnostics.google_status === 'CONNECTED' || diagnostics.google_status === 'MOCK_OK' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
              </div>
              <p className="text-[11px] text-slate-400 line-clamp-2">{diagnostics.google_message}</p>
            </div>

            {/* Inngest */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span>Inngest</span>
                </span>
                {diagnostics.inngest_status === 'CONFIGURED' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                )}
              </div>
              <p className="text-[11px] text-slate-400 line-clamp-2">{diagnostics.inngest_message}</p>
            </div>

            {/* Primary Database */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Database</span>
                </span>
                {diagnostics.database_status === 'CONNECTED' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                )}
              </div>
              <p className="text-[11px] text-slate-400 line-clamp-2">{diagnostics.database_message || 'Online'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Multi-Tenant Privacy & Credential Segregation Callout */}
      <div className="bg-sky-950/30 border border-sky-500/20 rounded-2xl p-4 text-xs text-sky-300 space-y-1.5">
        <div className="font-bold flex items-center gap-2 text-white text-xs">
          <Key className="w-4 h-4 text-sky-400" />
          <span>Tenant Isolation Architecture: Client Credentials vs Platform Infrastructure</span>
        </div>
        <p className="text-slate-300 text-[11px] leading-relaxed">
          S4 Automations enforces zero tenant credential leakage. Tenant accounting credentials (Zoho Books / QuickBooks / Xero OAuth tokens, dedicated Organization IDs) and client folder IDs are <strong>never stored in global platform settings</strong>. Each client organization manages its own isolated credentials under <strong>Client Workspace &gt; Client Settings</strong>. Platform Settings below exclusively configure system-wide infrastructure.
        </p>
      </div>

      {/* Main Settings Card with Category Tabs */}
      <div className="glass-panel rounded-2xl shadow-xl border border-slate-800 overflow-hidden">
        
        {/* Category Tab Bar */}
        <div className="flex border-b border-slate-800 bg-slate-950/60 overflow-x-auto custom-scrollbar">
          <button
            type="button"
            onClick={() => setActiveCategory('ai')}
            className={`flex items-center gap-2 px-5 py-3 text-xs font-bold border-b-2 transition cursor-pointer shrink-0 ${
              activeCategory === 'ai'
                ? 'border-sky-500 text-sky-400 bg-sky-950/20'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI &amp; Vision OCR Engine</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveCategory('notifications')}
            className={`flex items-center gap-2 px-5 py-3 text-xs font-bold border-b-2 transition cursor-pointer shrink-0 ${
              activeCategory === 'notifications'
                ? 'border-sky-500 text-sky-400 bg-sky-950/20'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Mailjet &amp; SMTP Gateways</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveCategory('runtime')}
            className={`flex items-center gap-2 px-5 py-3 text-xs font-bold border-b-2 transition cursor-pointer shrink-0 ${
              activeCategory === 'runtime'
                ? 'border-sky-500 text-sky-400 bg-sky-950/20'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Runtime &amp; Orchestration</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveCategory('database')}
            className={`flex items-center gap-2 px-5 py-3 text-xs font-bold border-b-2 transition cursor-pointer shrink-0 ${
              activeCategory === 'database'
                ? 'border-sky-500 text-sky-400 bg-sky-950/20'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Database &amp; Master Storage</span>
          </button>
        </div>

        {/* Configuration Form */}
        <form onSubmit={handleSave} className="p-6 space-y-6">
          
          {/* TAB 1: AI & VISION OCR ENGINE */}
          {activeCategory === 'ai' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="border-b border-slate-850 pb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-sky-400" />
                  <span>Google Gemini Vision OCR Parameters</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Platform-wide multimodal model configuration for handwritten invoice, delivery slip, and receipt extraction.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Default Gemini Model Identifier
                  </label>
                  <select
                    value={formData.GEMINI_MODEL || 'gemini-3.6-flash'}
                    onChange={(e) => handleChange('GEMINI_MODEL', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                  >
                    <option value="gemini-3.6-flash">gemini-3.6-flash (Recommended: High-Speed Multimodal)</option>
                    <option value="gemini-2.5-flash">gemini-2.5-flash (Standard OCR &amp; Vision)</option>
                    <option value="gemini-1.5-pro">gemini-1.5-pro (High-Precision Complex Invoices)</option>
                  </select>
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Used as the default extraction engine across all client ingestion pipelines.
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Google Gemini Developer API Key
                  </label>
                  <div className="relative">
                    <input
                      type={showGeminiKey ? 'text' : 'password'}
                      placeholder="AIzaSy..."
                      value={formData.GEMINI_API_KEY || ''}
                      onChange={(e) => handleChange('GEMINI_API_KEY', e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 pr-10 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowGeminiKey(!showGeminiKey)}
                      className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300 transition"
                    >
                      {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Key is masked for security. Overwrite to update the platform key.
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: MAILJET & SMTP GATEWAYS */}
          {activeCategory === 'notifications' && (
            <div className="space-y-5 animate-in fade-in">
              <div className="border-b border-slate-850 pb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Mail className="w-4 h-4 text-sky-400" />
                  <span>Email Dispatch &amp; Notification Infrastructure</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Platform gateways for login OTPs, discrepancy escalation alerts, and automated stakeholder reports.
                </p>
              </div>

              {/* Top Row: General Notification & Mailjet From */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Platform Security Alert Recipient
                  </label>
                  <input
                    type="email"
                    value={formData.NOTIFICATION_EMAIL || ''}
                    onChange={(e) => handleChange('NOTIFICATION_EMAIL', e.target.value)}
                    placeholder="cdanso@service4gh.com"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Receives pipeline crash alerts and unhandled error summaries.
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Mailjet Verified Sender Email
                  </label>
                  <input
                    type="email"
                    value={formData.MAILJET_FROM_EMAIL || ''}
                    onChange={(e) => handleChange('MAILJET_FROM_EMAIL', e.target.value)}
                    placeholder="cdanso@service4gh.com"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Must match a verified domain/address in your Mailjet account.
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Sender Display Name
                  </label>
                  <input
                    type="text"
                    value={formData.MAILJET_FROM_NAME || 'S4 Automations Security'}
                    onChange={(e) => handleChange('MAILJET_FROM_NAME', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500"
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Appears in email client inbox headers.
                  </span>
                </div>
              </div>

              {/* Mailjet API Keys Sub-Section */}
              <div className="bg-slate-950/60 border border-slate-850 rounded-xl p-4 space-y-3">
                <span className="text-xs font-bold text-sky-400 block uppercase tracking-wider font-mono">
                  Mailjet REST API Credentials
                </span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">Mailjet Public API Key</label>
                    <input
                      type="text"
                      value={formData.MAILJET_API_KEY || ''}
                      onChange={(e) => handleChange('MAILJET_API_KEY', e.target.value)}
                      placeholder="e.g. 78a9c..."
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">Mailjet Secret Key</label>
                    <div className="relative">
                      <input
                        type={showMailjetSecret ? 'text' : 'password'}
                        value={formData.MAILJET_SECRET_KEY || ''}
                        onChange={(e) => handleChange('MAILJET_SECRET_KEY', e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 pr-9 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowMailjetSecret(!showMailjetSecret)}
                        className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300"
                      >
                        {showMailjetSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* SMTP Server Configuration */}
              <div className="bg-slate-950/60 border border-slate-850 rounded-xl p-4 space-y-3">
                <span className="text-xs font-bold text-sky-400 block uppercase tracking-wider font-mono">
                  SMTP Transport Settings (Mailjet or Dedicated Relay)
                </span>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">SMTP Host</label>
                    <input
                      type="text"
                      value={formData.SMTP_HOST || 'in-v3.mailjet.com'}
                      onChange={(e) => handleChange('SMTP_HOST', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">SMTP Port</label>
                    <input
                      type="number"
                      value={formData.SMTP_PORT || 587}
                      onChange={(e) => handleChange('SMTP_PORT', parseInt(e.target.value) || 587)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">SMTP Username</label>
                    <input
                      type="text"
                      value={formData.SMTP_USER || ''}
                      onChange={(e) => handleChange('SMTP_USER', e.target.value)}
                      placeholder="API Key / Username"
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">SMTP Password</label>
                    <div className="relative">
                      <input
                        type={showSmtpPassword ? 'text' : 'password'}
                        value={formData.SMTP_PASSWORD || ''}
                        onChange={(e) => handleChange('SMTP_PASSWORD', e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 pr-9 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSmtpPassword(!showSmtpPassword)}
                        className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300"
                      >
                        {showSmtpPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* TAB 3: RUNTIME & ORCHESTRATION */}
          {activeCategory === 'runtime' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="border-b border-slate-850 pb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Zap className="w-4 h-4 text-sky-400" />
                  <span>Inngest Workflow Engine &amp; Runtime Environment</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Background job execution parameters, telemetry log levels, and dry-run simulation mode.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Inngest App Identifier</label>
                  <input
                    type="text"
                    value={formData.INNGEST_APP_ID || 'anr-laundry-billing'}
                    onChange={(e) => handleChange('INNGEST_APP_ID', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Inngest Dev Server URL</label>
                  <input
                    type="text"
                    placeholder="http://127.0.0.1:8288"
                    value={formData.INNGEST_DEV_SERVER_URL || ''}
                    onChange={(e) => handleChange('INNGEST_DEV_SERVER_URL', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">System Environment</label>
                  <select
                    value={formData.ENVIRONMENT || 'development'}
                    onChange={(e) => handleChange('ENVIRONMENT', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                  >
                    <option value="development">Development (Local)</option>
                    <option value="staging">Staging (Preview)</option>
                    <option value="production">Production (Live)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Server Port</label>
                  <input
                    type="number"
                    value={formData.PORT || 8000}
                    onChange={(e) => handleChange('PORT', parseInt(e.target.value) || 8000)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Telemetry Log Level</label>
                  <select
                    value={formData.LOG_LEVEL || 'INFO'}
                    onChange={(e) => handleChange('LOG_LEVEL', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                  >
                    <option value="DEBUG">DEBUG (Extensive Traceability)</option>
                    <option value="INFO">INFO (Standard Production)</option>
                    <option value="WARNING">WARNING (Alerts &amp; Faults Only)</option>
                    <option value="ERROR">ERROR (Critical Failures Only)</option>
                  </select>
                </div>
              </div>

              {/* Global Mock Mode Toggle */}
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-white block">
                    Zero-Cost Mock Simulation Mode
                  </span>
                  <p className="text-[11px] text-slate-400">
                    When enabled, the system uses synthesized Gemini Vision OCR payloads and sandbox Google Drive folders to test workflows without incurring billable API costs.
                  </p>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={Boolean(formData.MOCK_MODE)}
                    onChange={(e) => handleChange('MOCK_MODE', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
                </label>
              </div>
            </div>
          )}

          {/* TAB 4: DATABASE & MASTER STORAGE */}
          {activeCategory === 'database' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="border-b border-slate-850 pb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Database className="w-4 h-4 text-sky-400" />
                  <span>Database Connection &amp; Master Cloud Storage</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Primary relational database connection string, platform admin email, and master Google service account keys.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Authorized Master Admin Email
                  </label>
                  <input
                    type="email"
                    value={formData.AUTH_EMAIL || 's4bookkeeping@service4gh.com'}
                    onChange={(e) => handleChange('AUTH_EMAIL', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    The root administrative account allowed to receive login OTPs for platform settings.
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Default Master Control Sheets Root Folder ID
                  </label>
                  <input
                    type="text"
                    value={formData.CONTROL_SHEETS_FOLDER_ID || '1Uu_Q3p8s1_anr_laundry_slips'}
                    onChange={(e) => handleChange('CONTROL_SHEETS_FOLDER_ID', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Default Google Drive folder if an onboarded client doesn't specify a custom folder.
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Primary Relational Database Connection (PostgreSQL / SQLite)
                </label>
                <input
                  type="text"
                  value={formData.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/s4_automations'}
                  onChange={(e) => handleChange('DATABASE_URL', e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Supports PostgreSQL URL (e.g. <code className="text-sky-300">postgresql://user:pass@host:5432/db</code>) or local SQLite fallback.
                </span>
              </div>

              {/* Google Workspace & Cloud Service Account */}
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3 mt-4">
                <div className="border-b border-slate-850 pb-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Cloud className="w-4 h-4 text-sky-400" />
                    <span className="text-xs font-bold text-white">Google Cloud Platform Service Account (Drive &amp; Sheets)</span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-950 text-sky-300 border border-sky-500/30 font-semibold">
                    Centralized Platform Identity
                  </span>
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  All onboarded clients share their Google Drive folders with this central Service Account email as <strong>Viewer</strong> or <strong>Editor</strong>. Clients do <em>not</em> receive or require separate GCP service accounts.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Service Account Email (Shared with Client Folders)
                    </label>
                    <input
                      type="email"
                      value={formData.GOOGLE_SERVICE_ACCOUNT_EMAIL || 's4-vision-ingest@s4-automations.iam.gserviceaccount.com'}
                      onChange={(e) => handleChange('GOOGLE_SERVICE_ACCOUNT_EMAIL', e.target.value)}
                      placeholder="s4-vision-ingest@s4-automations.iam.gserviceaccount.com"
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                    />
                    <span className="text-[10px] text-slate-500 mt-1 block">
                      The IAM service account email provided to clients during onboarding and stream configuration.
                    </span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Service Account Private Key (JSON / Base64)
                    </label>
                    <div className="relative">
                      <input
                        type={showSaKey ? 'text' : 'password'}
                        value={formData.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || ''}
                        onChange={(e) => handleChange('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64', e.target.value)}
                        placeholder="Paste GCP Service Account JSON or Base64"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 pr-9 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSaKey(!showSaKey)}
                        className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300 cursor-pointer"
                        title={showSaKey ? 'Hide key' : 'Show key'}
                      >
                        {showSaKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <span className="text-[10px] text-slate-500 mt-1 block">
                      Downloaded from GCP Console &gt; IAM &amp; Admin &gt; Service Accounts &gt; Keys.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Form Action Footer */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-slate-800">
            <span className="text-xs font-semibold text-emerald-400">
              {saveStatus}
            </span>

            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold px-6 py-2.5 rounded-xl shadow-lg shadow-emerald-600/25 transition cursor-pointer disabled:opacity-50 shrink-0"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Saving Settings...' : 'Save & Apply Platform Settings'}</span>
            </button>
          </div>

        </form>
      </div>

    </div>
  );
};
