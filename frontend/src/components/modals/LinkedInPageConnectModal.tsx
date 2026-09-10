import React, { useState, useEffect } from 'react';
import {
  X,
  Linkedin,
  Building2,
  User,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Save,
  RefreshCw,
  Info,
  ShieldCheck,
  Sparkles,
  Key,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  LinkedInConfig,
  LinkedInTestResult,
  fetchLinkedInConfig,
  updateLinkedInConfig,
  testLinkedInConnection,
} from '../../lib/api';

interface LinkedInPageConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected?: (config: LinkedInConfig) => void;
}

export const LinkedInPageConnectModal: React.FC<LinkedInPageConnectModalProps> = ({
  isOpen,
  onClose,
  onConnected,
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LinkedInTestResult | null>(null);

  // Form Fields
  const [postingMode, setPostingMode] = useState<'organization' | 'person'>('organization');
  const [organizationId, setOrganizationId] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showAdvancedApi, setShowAdvancedApi] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    setLoading(true);
    setTestResult(null);
    try {
      const cfg = await fetchLinkedInConfig();
      setPostingMode(cfg.posting_mode || 'organization');
      setOrganizationId(cfg.organization_id || '');
      setOrganizationName(cfg.organization_name || '');
      setClientId(cfg.client_id || '');
      if (cfg.has_access_token) {
        setAccessToken(cfg.masked_token || '••••••••••••••••');
        setShowAdvancedApi(true);
      }
    } catch (err) {
      console.warn('Failed to load LinkedIn config:', err);
    } finally {
      setLoading(false);
    }
  };

  // Helper to auto-clean organization input (e.g. if user pastes full LinkedIn URL)
  const handleOrgIdChange = (val: string) => {
    let clean = val.trim();
    if (clean.includes('linkedin.com/company/')) {
      const parts = clean.split('linkedin.com/company/')[1].replace(/\/$/, '').split('/');
      clean = parts[0];
    }
    if (clean.startsWith('urn:li:organization:')) {
      clean = clean.replace('urn:li:organization:', '');
    }
    setOrganizationId(clean);

    // Auto-generate name if empty and clean has words
    if (!organizationName && clean) {
      const formatted = clean
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      setOrganizationName(formatted);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testLinkedInConnection({
        organization_id: organizationId || undefined,
        access_token: accessToken.includes('••') ? undefined : accessToken || undefined,
      });
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Connection test failed. Verify network or credentials.',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setTestResult(null);

    try {
      const payload: any = {
        posting_mode: postingMode,
        organization_id: organizationId.trim(),
        organization_name: organizationName.trim(),
      };

      if (accessToken && !accessToken.includes('••')) {
        payload.access_token = accessToken.trim();
      }
      if (clientId) {
        payload.client_id = clientId.trim();
      }
      if (clientSecret && !clientSecret.includes('••')) {
        payload.client_secret = clientSecret.trim();
      }

      const updated = await updateLinkedInConfig(payload);
      if (onConnected) {
        onConnected(updated);
      }
      onClose();
    } catch (err: any) {
      alert(`Failed to save LinkedIn settings: ${err.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/15 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Linkedin className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">
                Connect LinkedIn Business Page
              </h2>
              <p className="text-xs text-slate-400">
                Configure company page posting for the Multi-Channel Release Broadcaster
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSave} className="p-5 overflow-y-auto space-y-5 flex-1 custom-scrollbar">
          
          {loading ? (
            <div className="py-12 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
              <span>Loading LinkedIn configuration...</span>
            </div>
          ) : (
            <>
              {/* Target Posting Identity Toggle */}
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-2">
                  Target Posting Identity
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div
                    onClick={() => setPostingMode('organization')}
                    className={`p-3 rounded-xl border cursor-pointer transition flex items-start gap-2.5 ${
                      postingMode === 'organization'
                        ? 'bg-blue-950/60 border-blue-500/50 text-white shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <Building2 className={`w-4 h-4 mt-0.5 shrink-0 ${postingMode === 'organization' ? 'text-blue-400' : 'text-slate-500'}`} />
                    <div>
                      <span className="text-xs font-bold block">Company / Business Page</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">
                        Post announcements to your verified LinkedIn business page feed
                      </span>
                    </div>
                  </div>

                  <div
                    onClick={() => setPostingMode('person')}
                    className={`p-3 rounded-xl border cursor-pointer transition flex items-start gap-2.5 ${
                      postingMode === 'person'
                        ? 'bg-blue-950/60 border-blue-500/50 text-white shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <User className={`w-4 h-4 mt-0.5 shrink-0 ${postingMode === 'person' ? 'text-blue-400' : 'text-slate-500'}`} />
                    <div>
                      <span className="text-xs font-bold block">Personal Profile</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">
                        Post directly to your personal executive / founder profile
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Business Page Settings (Shown when Organization selected) */}
              {postingMode === 'organization' && (
                <div className="space-y-4 bg-slate-950/70 p-4 rounded-xl border border-slate-850">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
                    <Building2 className="w-4 h-4 text-blue-400" />
                    <span>Business Page Credentials</span>
                  </div>

                  {/* Organization ID / Vanity Slug */}
                  <div>
                    <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                      LinkedIn Page Identifier or URL <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={organizationId}
                      onChange={(e) => handleOrgIdChange(e.target.value)}
                      placeholder="e.g. s4-automations or 10582910 or https://www.linkedin.com/company/s4-automations"
                      required={postingMode === 'organization'}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      Enter your page vanity slug (e.g. <code className="text-blue-300">s4-automations</code>) or numeric ID (from your admin URL: <code className="text-slate-400">linkedin.com/company/10582910/admin/</code>).
                    </p>
                  </div>

                  {/* Business Page Display Name */}
                  <div>
                    <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                      Business Page Display Name
                    </label>
                    <input
                      type="text"
                      value={organizationName}
                      onChange={(e) => setOrganizationName(e.target.value)}
                      placeholder="e.g. S4 Automations or ANR Group"
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  {/* Quick Preview & Direct Admin Link */}
                  {organizationId && (
                    <div className="p-2.5 rounded-lg bg-blue-950/40 border border-blue-500/20 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        <span className="text-[11px] text-blue-200 truncate">
                          Admin URL: <strong>linkedin.com/company/{organizationId}/admin/</strong>
                        </span>
                      </div>
                      <a
                        href={`https://www.linkedin.com/company/${organizationId}/admin/feed/posts/`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1 font-semibold shrink-0 ml-2"
                      >
                        <span>Test Link</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* Direct API Publishing Credentials (Optional Accordion) */}
              <div className="border border-slate-800 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAdvancedApi(!showAdvancedApi)}
                  className="w-full p-3 bg-slate-950/80 hover:bg-slate-950 flex items-center justify-between text-xs font-semibold text-slate-300 transition"
                >
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4 text-sky-400" />
                    <span>Automated REST API Dispatch (Optional)</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-400">
                    <span className="text-[10px] text-slate-500">
                      {accessToken ? 'Token Configured' : 'Web Intent Default'}
                    </span>
                    {showAdvancedApi ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </button>

                {showAdvancedApi && (
                  <div className="p-4 space-y-3.5 bg-slate-900/60 border-t border-slate-800 text-xs">
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 space-y-1.5 leading-relaxed">
                      <p className="font-bold text-slate-200 flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5 text-sky-400" />
                        <span>How Direct Automated API Publishing Works:</span>
                      </p>
                      <p>
                        Without an API token, S4 uses <strong>1-Click Business Page Intent</strong> (automatically copies the generated post and opens your company admin composer).
                      </p>
                      <p>
                        To post in the background without clicking through LinkedIn, enter an OAuth Bearer token with the <code className="text-sky-300">w_organization_social</code> scope from the{' '}
                        <a
                          href="https://www.linkedin.com/developers/apps"
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-400 hover:underline inline-flex items-center gap-0.5 font-semibold"
                        >
                          LinkedIn Developer Portal <ExternalLink className="w-2.5 h-2.5" />
                        </a>.
                      </p>
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                        LinkedIn OAuth Access Token
                      </label>
                      <input
                        type="password"
                        value={accessToken}
                        onChange={(e) => setAccessToken(e.target.value)}
                        placeholder="AQV..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Diagnostic Test Feedback Box */}
              {testResult && (
                <div
                  className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 animate-in fade-in ${
                    testResult.success
                      ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300'
                      : 'bg-rose-950/70 border-rose-500/40 text-rose-300'
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <strong className="block font-bold mb-0.5 uppercase tracking-wide text-[10px]">
                      {testResult.success ? 'Connection Verified' : 'Connection Warning'}
                    </strong>
                    <p className="text-[11px] leading-relaxed">{testResult.message}</p>
                    {testResult.company_admin_url && (
                      <a
                        href={testResult.company_admin_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:underline mt-1"
                      >
                        <span>Open Admin Feed</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Modal Actions Footer */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || (!organizationId && !accessToken)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin text-blue-400' : ''}`} />
              <span>{testing ? 'Testing...' : 'Test Connection'}</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition cursor-pointer disabled:opacity-50"
              >
                {saving ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>{saving ? 'Saving...' : 'Save & Connect Page'}</span>
              </button>
            </div>
          </div>

        </form>

      </div>
    </div>
  );
};
