import React, { useState } from 'react';
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
} from 'lucide-react';
import { testConnections } from '../../lib/api';
import type { DiagnosticsResult } from '../../types/config';

export const ConfigSection: React.FC = () => {
  const { config, saveSystemConfig } = useAutomation();

  const [formData, setFormData] = useState<Record<string, any>>(config || {});
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  const handleChange = (key: string, value: any) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveStatus('Saving...');
    await saveSystemConfig(formData);
    setSaveStatus('Configuration saved successfully!');
    setTimeout(() => setSaveStatus(''), 3000);
  };

  const handleRunDiagnostics = async () => {
    setIsTesting(true);
    try {
      const res = await testConnections();
      setDiagnostics(res);
    } catch (e: any) {
      console.error('Diagnostics failed:', e);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header */}
      <div className="glass-panel rounded-2xl p-5 shadow-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-bold text-white tracking-tight">
              System Configuration &amp; Integration Diagnostics
            </h2>
            <span className="text-[10px] font-mono font-bold text-sky-400 bg-sky-950/80 border border-sky-500/30 px-2 py-0.5 rounded-full">
              Global Platform Keys
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage environment variables, Gemini Vision OCR models, and run live connectivity tests across all accounting subsystems.
          </p>
        </div>

        <button
          onClick={handleRunDiagnostics}
          disabled={isTesting}
          className="flex items-center gap-2 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg shadow-sky-600/30 transition cursor-pointer disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
          <span>Run Integration Diagnostics</span>
        </button>
      </div>

      {/* Diagnostics Results Banner */}
      {diagnostics && (
        <div className="glass-panel rounded-2xl p-5 shadow-xl border border-slate-800 animate-in fade-in space-y-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-sky-400" />
            <span>Integration Diagnostic Report</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Gemini */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">Gemini Vision OCR</span>
                {diagnostics.gemini_status === 'CONNECTED' || diagnostics.gemini_status === 'MOCK_OK' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-400" />
                )}
              </div>
              <p className="text-[11px] text-slate-400 line-clamp-2">{diagnostics.gemini_message}</p>
            </div>

            {/* Zoho Books */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">Zoho Books API</span>
                {diagnostics.zoho_status === 'CONNECTED' || diagnostics.zoho_status === 'MOCK_OK' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-400" />
                )}
              </div>
              <p className="text-[11px] text-slate-400 line-clamp-2">{diagnostics.zoho_message}</p>
            </div>

            {/* Google Drive / Sheets */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">Google Drive / Sheets</span>
                {diagnostics.google_status === 'CONNECTED' || diagnostics.google_status === 'MOCK_OK' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-400" />
                )}
              </div>
              <p className="text-[11px] text-slate-400 line-clamp-2">{diagnostics.google_message}</p>
            </div>

            {/* Inngest */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">Inngest Orchestrator</span>
                {diagnostics.inngest_status === 'CONFIGURED' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                )}
              </div>
              <p className="text-[11px] text-slate-400 line-clamp-2">{diagnostics.inngest_message}</p>
            </div>
          </div>
        </div>
      )}

      {/* Config Form */}
      <form onSubmit={handleSave} className="glass-panel rounded-2xl p-6 shadow-xl border border-slate-800 space-y-5">
        <h3 className="text-sm font-bold text-white mb-2">Environment Variables &amp; System Defaults</h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Gemini Vision Model</label>
            <input
              type="text"
              value={formData.GEMINI_MODEL || 'gemini-3.6-flash'}
              onChange={(e) => handleChange('GEMINI_MODEL', e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Authorized Admin Auth Email</label>
            <input
              type="text"
              value={formData.AUTH_EMAIL || 's4bookkeeping@service4gh.com'}
              onChange={(e) => handleChange('AUTH_EMAIL', e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Default Google Drive Folder ID</label>
            <input
              type="text"
              value={formData.CONTROL_SHEETS_FOLDER_ID || '1Uu_Q3p8s1_anr_laundry_slips'}
              onChange={(e) => handleChange('CONTROL_SHEETS_FOLDER_ID', e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
            />
          </div>
        </div>

        {/* Multi-Tenant Accounting Security Callout */}
        <div className="bg-sky-950/40 border border-sky-500/25 rounded-xl p-4 text-xs text-sky-300 space-y-1">
          <div className="font-bold flex items-center gap-2 text-white">
            <Key className="w-4 h-4 text-sky-400" />
            <span>Multi-Tenant Accounting Credentials Isolation</span>
          </div>
          <p className="text-slate-300 text-[11px]">
            To guarantee absolute tenant privacy and data segregation, accounting platform credentials (Zoho Books / QuickBooks / Xero <code className="text-sky-300 font-mono">Client ID</code>, <code className="text-sky-300 font-mono">Client Secret</code>, <code className="text-sky-300 font-mono">Refresh Token</code>, and <code className="text-sky-300 font-mono">Organization ID</code>) are <strong>never shared globally</strong>. Each client organization manages its own isolated credentials directly within its workspace under <strong>Client Settings &gt; Dedicated Accounting Platform</strong>.
          </p>
        </div>

        <div className="flex items-center gap-3 pt-3">
          <label className="flex items-center gap-2 cursor-pointer bg-slate-950 border border-slate-800 p-3 rounded-xl">
            <input
              type="checkbox"
              checked={Boolean(formData.MOCK_MODE)}
              onChange={(e) => handleChange('MOCK_MODE', e.target.checked)}
              className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-sky-600 focus:ring-sky-500 cursor-pointer"
            />
            <span className="text-xs font-semibold text-slate-200">
              Enable Mock Mode (Simulates Gemini Vision &amp; Google Drive APIs for zero-cost dry runs)
            </span>
          </label>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-slate-800">
          <span className="text-xs text-emerald-400 font-semibold">{saveStatus}</span>
          <button
            type="submit"
            className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold px-5 py-2.5 rounded-xl shadow-lg shadow-emerald-600/25 transition cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save &amp; Apply Configuration</span>
          </button>
        </div>
      </form>

    </div>
  );
};
