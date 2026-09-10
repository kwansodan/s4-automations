import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Share2,
  Linkedin,
  Twitter,
  Mail,
  BookOpen,
  GitCommit,
  Send,
  Copy,
  ExternalLink,
  CheckCircle2,
  RefreshCw,
  Sliders,
  Layers,
  ArrowRight,
  Eye,
  History,
  ShieldCheck,
  AlertCircle,
  FileText,
  Building2,
  Users,
  UserPlus,
} from 'lucide-react';
import {
  fetchRecentGitCommits,
  generateReleaseContent,
  broadcastRelease,
  fetchReleaseHistory,
  fetchPublicChangelog,
  fetchLinkedInConfig,
  fetchAudienceSubscribers,
  GitCommitItem,
  GeneratedReleaseContent,
  ReleaseHistoryItem,
  ChangelogEntryItem,
  LinkedInConfig,
  EmailSubscriber,
} from '../../lib/api';
import { LinkedInPageConnectModal } from '../modals/LinkedInPageConnectModal';
import { AudienceManagerModal } from '../modals/AudienceManagerModal';

export const MultiChannelLaunchpad: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'composer' | 'changelog' | 'history'>('composer');
  const [selectedChannelTab, setSelectedChannelTab] = useState<'linkedin' | 'twitter' | 'email' | 'changelog'>('linkedin');

  // Input states
  const [commits, setCommits] = useState<GitCommitItem[]>([]);
  const [isLoadingCommits, setIsLoadingCommits] = useState(false);
  const [selectedCommitHash, setSelectedCommitHash] = useState<string>('');
  
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [category, setCategory] = useState('ACCOUNTING_AUTOMATION');
  const [targetAudience, setTargetAudience] = useState('Accounting Firms & Finance Leaders');
  const [version, setVersion] = useState('1.4.0');

  // AI Generation & Output states
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<GeneratedReleaseContent | null>(null);

  // Editable fields per channel
  const [linkedinBody, setLinkedinBody] = useState('');
  const [selectedHookIndex, setSelectedHookIndex] = useState(0);
  const [twitterTweet, setTwitterTweet] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailHtml, setEmailHtml] = useState('');
  const [changelogMarkdown, setChangelogMarkdown] = useState('');

  // Channel toggles for broadcasting
  const [broadcastChannels, setBroadcastChannels] = useState<{
    linkedin: boolean;
    twitter: boolean;
    email: boolean;
    changelog: boolean;
  }>({
    linkedin: true,
    twitter: true,
    email: true,
    changelog: true,
  });

  // Broadcast execution & feedback
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<any>(null);
  const [copiedChannel, setCopiedChannel] = useState<string | null>(null);

  // History & Changelog lists
  const [historyItems, setHistoryItems] = useState<ReleaseHistoryItem[]>([]);
  const [changelogItems, setChangelogItems] = useState<ChangelogEntryItem[]>([]);
  const [isLoadingChangelog, setIsLoadingChangelog] = useState(false);

  // LinkedIn Business Page Config state
  const [linkedInConfig, setLinkedInConfig] = useState<LinkedInConfig | null>(null);
  const [isLinkedInModalOpen, setIsLinkedInModalOpen] = useState(false);
  const [isLoadingLinkedInConfig, setIsLoadingLinkedInConfig] = useState(false);

  // Marketing Audience & Subscriber state
  const [isAudienceModalOpen, setIsAudienceModalOpen] = useState(false);
  const [audienceCount, setAudienceCount] = useState(0);
  const [subscribersList, setSubscribersList] = useState<EmailSubscriber[]>([]);
  const [targetAudienceTier, setTargetAudienceTier] = useState<string>('all');

  // Load commits on mount
  useEffect(() => {
    loadCommits();
    loadChangelog();
    loadLinkedInConfig();
    loadAudienceInfo();
  }, []);

  const loadAudienceInfo = async () => {
    try {
      const res = await fetchAudienceSubscribers({ active_only: true, limit: 300 });
      setSubscribersList(res.subscribers || []);
      setAudienceCount(res.active_count || 0);
    } catch (err) {
      console.warn('Failed to load audience info:', err);
    }
  };

  const loadLinkedInConfig = async () => {
    setIsLoadingLinkedInConfig(true);
    try {
      const cfg = await fetchLinkedInConfig();
      setLinkedInConfig(cfg);
    } catch (err) {
      console.warn('Failed to load LinkedIn config:', err);
    } finally {
      setIsLoadingLinkedInConfig(false);
    }
  };

  const loadCommits = async () => {
    setIsLoadingCommits(true);
    try {
      const data = await fetchRecentGitCommits(8);
      setCommits(data || []);
      if (data && data.length > 0 && !title) {
        handleSelectCommit(data[0]);
      }
    } catch (err) {
      console.error('Failed to load commits:', err);
    } finally {
      setIsLoadingCommits(false);
    }
  };

  const loadChangelog = async () => {
    setIsLoadingChangelog(true);
    try {
      const [cData, hData] = await Promise.all([
        fetchPublicChangelog(30),
        fetchReleaseHistory(20),
      ]);
      setChangelogItems(cData || []);
      setHistoryItems(hData || []);
    } catch (err) {
      console.error('Failed to load changelog/history:', err);
    } finally {
      setIsLoadingChangelog(false);
    }
  };

  const handleSelectCommit = (c: GitCommitItem) => {
    setSelectedCommitHash(c.hash);
    setTitle(c.message);
    setSummary(`Automated deployment of '${c.message}' (${c.hash}) built by ${c.author} on ${c.date}.`);
    
    // Auto-detect category
    const lower = c.message.toLowerCase();
    if (lower.includes('ap') || lower.includes('bill') || lower.includes('vendor')) {
      setCategory('AP_WORKFLOW');
    } else if (lower.includes('ar') || lower.includes('invoice') || lower.includes('slip') || lower.includes('revenue')) {
      setCategory('AR_REVENUE');
    } else if (lower.includes('bank') || lower.includes('momo') || lower.includes('statement')) {
      setCategory('BANK_RECONCILIATION');
    } else if (lower.includes('oauth') || lower.includes('zoho') || lower.includes('quickbooks') || lower.includes('xero')) {
      setCategory('INTEGRATION');
    } else {
      setCategory('PLATFORM');
    }
  };

  const handleGenerate = async () => {
    if (!title && !summary) {
      alert('Please enter a feature title or select a recent commit.');
      return;
    }
    setIsGenerating(true);
    setBroadcastResult(null);

    try {
      const content = await generateReleaseContent({
        title,
        summary,
        category,
        target_audience: targetAudience,
        commit_hash: selectedCommitHash || undefined,
      });

      setGeneratedContent(content);
      setLinkedinBody(content.linkedin.body);
      setSelectedHookIndex(0);
      setTwitterTweet(content.twitter.tweet);
      setEmailSubject(content.client_email.subject);
      setEmailHtml(content.client_email.html);
      setChangelogMarkdown(content.changelog.markdown);
      if (content.changelog.version) {
        setVersion(content.changelog.version);
      }
    } catch (err: any) {
      alert(`Generation failed: ${err.message || err}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApplyHook = (hookText: string, index: number) => {
    setSelectedHookIndex(index);
    if (!linkedinBody) return;
    // Replace the first paragraph with the new hook
    const paragraphs = linkedinBody.split('\n\n');
    paragraphs[0] = hookText;
    setLinkedinBody(paragraphs.join('\n\n'));
  };

  const handleCopy = (text: string, channelName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedChannel(channelName);
    setTimeout(() => setCopiedChannel(null), 2000);
  };

  const handleBroadcast = async () => {
    const selectedChannels = (Object.keys(broadcastChannels) as (keyof typeof broadcastChannels)[])
      .filter((k) => broadcastChannels[k]);

    if (selectedChannels.length === 0) {
      alert('Please select at least one channel to broadcast to.');
      return;
    }

    setIsBroadcasting(true);
    try {
      // Filter audience emails based on selected tier
      let targetedEmails: string[] | undefined = undefined;
      if (broadcastChannels.email) {
        const filteredSubs = targetAudienceTier === 'all'
          ? subscribersList
          : subscribersList.filter((s) => s.tier === targetAudienceTier);
        if (filteredSubs.length > 0) {
          targetedEmails = filteredSubs.map((s) => s.email);
        }
      }

      const res = await broadcastRelease({
        version,
        title: title || 'S4 Automation Update',
        category,
        summary: summary || title,
        commit_hash: selectedCommitHash || undefined,
        linkedin_post: broadcastChannels.linkedin ? linkedinBody : undefined,
        twitter_post: broadcastChannels.twitter ? twitterTweet : undefined,
        client_email_subject: broadcastChannels.email ? emailSubject : undefined,
        client_email_html: broadcastChannels.email ? emailHtml : undefined,
        changelog_entry: broadcastChannels.changelog ? changelogMarkdown : undefined,
        channels: selectedChannels,
        email_recipients: targetedEmails,
      });

      setBroadcastResult(res);
      await loadChangelog();
    } catch (err: any) {
      alert(`Broadcast dispatch failed: ${err.message || err}`);
    } finally {
      setIsBroadcasting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Banner & Tab Controls */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sky-400 font-semibold text-xs uppercase tracking-wider mb-1">
            <Sparkles className="w-4 h-4 text-sky-400" />
            <span>Accounting Feature Launchpad</span>
          </div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <span>Multi-Channel Release Broadcaster</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Automatically craft and dispatch accounting feature announcements across <strong className="text-sky-300">LinkedIn</strong>, <strong className="text-sky-300">X (Twitter)</strong>, <strong className="text-sky-300">Client Email (Mailjet)</strong>, and the <strong className="text-sky-300">In-App Changelog</strong> with 1 click.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800 shrink-0">
          <button
            type="button"
            onClick={() => setActiveSubTab('composer')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
              activeSubTab === 'composer'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Broadcaster</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('changelog')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
              activeSubTab === 'changelog'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>In-App Changelog</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('history')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
              activeSubTab === 'history'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Broadcast Logs</span>
          </button>
        </div>
      </div>

      {activeSubTab === 'composer' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Feature Ingestion & AI Tuning (5 cols) */}
          <div className="lg:col-span-5 space-y-5">
            {/* Git Commit Selector */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-white">
                  <GitCommit className="w-4 h-4 text-emerald-400" />
                  <span>1. Pick From Recent Commits</span>
                </div>
                <button
                  type="button"
                  onClick={loadCommits}
                  disabled={isLoadingCommits}
                  className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 transition"
                  title="Refresh git commits"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoadingCommits ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>

              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {commits.map((c) => {
                  const isSelected = selectedCommitHash === c.hash;
                  return (
                    <div
                      key={c.hash}
                      onClick={() => handleSelectCommit(c)}
                      className={`p-2 rounded-xl text-xs cursor-pointer border transition ${
                        isSelected
                          ? 'bg-sky-950/60 border-sky-500/60 text-white shadow-sm'
                          : 'bg-slate-950/60 border-slate-850 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 text-[10px] text-slate-400 mb-1">
                        <span className="font-mono text-sky-400 bg-sky-950 px-1.5 py-0.5 rounded border border-sky-800/40">
                          {c.hash}
                        </span>
                        <span>{c.date}</span>
                      </div>
                      <p className="font-medium line-clamp-1">{c.message}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Custom Feature Details & Target Lens */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <Sliders className="w-4 h-4 text-sky-400" />
                <span>2. Feature Context &amp; Audience Lens</span>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">Feature Headline / Title</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. 1-Click Zoho Books OAuth Connect & Automated File Routing"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500 font-medium"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">Accounting Domain</label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                    >
                      <option value="ACCOUNTING_AUTOMATION">Accounting Automation</option>
                      <option value="AP_WORKFLOW">AP Vendor Bills</option>
                      <option value="AR_REVENUE">AR Invoicing & Revenue</option>
                      <option value="BANK_RECONCILIATION">Banking & MoMo</option>
                      <option value="INTEGRATION">Zoho / QBO / Xero Integration</option>
                      <option value="OCR_VISION">Gemini Vision OCR</option>
                      <option value="PLATFORM">Platform & Infrastructure</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">Target Audience</label>
                    <select
                      value={targetAudience}
                      onChange={(e) => setTargetAudience(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                    >
                      <option value="Accounting Firms & Bookkeepers">Accounting Firms & CPAs</option>
                      <option value="CFOs & Finance Controllers">CFOs & Controllers</option>
                      <option value="Small Business Owners & Founders">Business Owners</option>
                      <option value="Build in Public & FinTech Builders">Build in Public / Tech</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">What Was Built (Bullet Points)</label>
                  <textarea
                    rows={3}
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder="Describe how it works, what was automated, and the hours saved..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500 leading-relaxed resize-none"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-sky-600 via-indigo-600 to-purple-600 hover:from-sky-500 hover:to-purple-500 text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow-lg shadow-indigo-600/25 transition cursor-pointer disabled:opacity-50"
                >
                  <Sparkles className={`w-4 h-4 text-sky-200 ${isGenerating ? 'animate-spin' : ''}`} />
                  <span>{isGenerating ? 'Gemini AI Crafting Copy for 4 Channels...' : 'Generate Multi-Channel Release with Gemini'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Multi-Channel Studio & Broadcast Panel (7 cols) */}
          <div className="lg:col-span-7 space-y-5">
            {/* Studio Navigation Tabs */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl backdrop-blur-md space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-1 sm:gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedChannelTab('linkedin')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                      selectedChannelTab === 'linkedin'
                        ? 'bg-blue-600/20 text-blue-400 border border-blue-500/40'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Linkedin className="w-3.5 h-3.5 text-blue-400" />
                    <span>LinkedIn</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedChannelTab('twitter')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                      selectedChannelTab === 'twitter'
                        ? 'bg-sky-600/20 text-sky-400 border border-sky-500/40'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Twitter className="w-3.5 h-3.5 text-sky-400" />
                    <span>X (Twitter)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedChannelTab('email')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                      selectedChannelTab === 'email'
                        ? 'bg-amber-600/20 text-amber-400 border border-amber-500/40'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Mail className="w-3.5 h-3.5 text-amber-400" />
                    <span>Client Email</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedChannelTab('changelog')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                      selectedChannelTab === 'changelog'
                        ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/40'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Changelog</span>
                  </button>
                </div>

                <span className="text-[11px] font-mono text-slate-500">
                  {selectedChannelTab === 'linkedin' && `${linkedinBody.length}/3000 chars`}
                  {selectedChannelTab === 'twitter' && `${twitterTweet.length}/280 chars`}
                </span>
              </div>

              {/* Tab 1: LinkedIn View & Live Preview */}
              {selectedChannelTab === 'linkedin' && (
                <div className="space-y-4">
                  {/* LinkedIn Target & Business Page Connection Card */}
                  <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`p-2.5 rounded-xl border shrink-0 ${
                            linkedInConfig?.posting_mode === 'organization' && linkedInConfig?.organization_id
                              ? 'bg-blue-950/60 border-blue-500/50 text-blue-400'
                              : 'bg-slate-900 border-slate-800 text-slate-400'
                          }`}
                        >
                          <Building2 className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white">
                              {linkedInConfig?.posting_mode === 'organization' && linkedInConfig?.organization_id
                                ? (linkedInConfig.organization_name || linkedInConfig.organization_id)
                                : 'Personal Profile (Default)'}
                            </span>
                            <span
                              className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${
                                linkedInConfig?.posting_mode === 'organization' && linkedInConfig?.organization_id
                                  ? linkedInConfig.has_access_token
                                    ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800'
                                    : 'bg-blue-950/60 text-blue-300 border-blue-800'
                                  : 'bg-slate-800 text-slate-400 border-slate-700'
                              }`}
                            >
                              {linkedInConfig?.posting_mode === 'organization' && linkedInConfig?.organization_id
                                ? linkedInConfig.has_access_token
                                  ? 'API Automated'
                                  : '1-Click Admin Mode'
                                : 'Personal Feed'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {linkedInConfig?.posting_mode === 'organization' && linkedInConfig?.organization_id
                              ? 'Feature announcements will broadcast directly under this LinkedIn Business Page.'
                              : 'Want to broadcast updates directly under your Company / Business Page?'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setIsLinkedInModalOpen(true)}
                          className="px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <Building2 className="w-3.5 h-3.5 text-blue-400" />
                          <span>
                            {linkedInConfig?.posting_mode === 'organization' && linkedInConfig?.organization_id
                              ? 'Manage Page'
                              : 'Connect Business Page'}
                          </span>
                        </button>

                        {linkedInConfig?.posting_mode === 'organization' && linkedInConfig?.organization_id && (
                          <button
                            type="button"
                            onClick={() => {
                              if (linkedinBody) {
                                navigator.clipboard.writeText(linkedinBody);
                                setCopiedChannel('linkedin-admin');
                                setTimeout(() => setCopiedChannel(null), 2500);
                              }
                              const adminUrl =
                                linkedInConfig.company_admin_url ||
                                `https://www.linkedin.com/company/${encodeURIComponent(
                                  linkedInConfig.organization_id
                                )}/admin/feed/posts/`;
                              window.open(adminUrl, '_blank', 'noreferrer');
                            }}
                            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-850 text-slate-200 border border-slate-700 rounded-xl text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
                            title="Copies post copy to clipboard and opens your Company Admin Feed"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                            <span>
                              {copiedChannel === 'linkedin-admin' ? 'Copied & Opening...' : 'Open Page Composer'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Alternative Hooks Selector */}
                  {generatedContent?.linkedin?.hooks && generatedContent.linkedin.hooks.length > 0 && (
                    <div className="space-y-2 bg-slate-950/80 p-3 rounded-xl border border-slate-850">
                      <p className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
                        <span>🎯 Pick Opening Hook Angle:</span>
                      </p>
                      <div className="space-y-1.5">
                        {generatedContent.linkedin.hooks.map((hook, idx) => (
                          <div
                            key={idx}
                            onClick={() => handleApplyHook(hook, idx)}
                            className={`p-2 rounded-lg text-[11px] cursor-pointer border transition leading-relaxed ${
                              selectedHookIndex === idx
                                ? 'bg-blue-950/50 border-blue-500/50 text-blue-200'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <span className="font-bold text-blue-400 mr-1.5">Angle {idx + 1}:</span>
                            <span>{hook}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* LinkedIn Editor & Feed Mockup */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-bold text-slate-300">LinkedIn Post Copy</label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopy(linkedinBody, 'linkedin')}
                          className="text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-1 font-semibold cursor-pointer"
                        >
                          <Copy className="w-3 h-3" />
                          <span>{copiedChannel === 'linkedin' ? 'Copied!' : 'Copy'}</span>
                        </button>
                        {linkedInConfig?.posting_mode === 'organization' && linkedInConfig?.organization_id ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (linkedinBody) {
                                navigator.clipboard.writeText(linkedinBody);
                                setCopiedChannel('linkedin-admin');
                                setTimeout(() => setCopiedChannel(null), 2500);
                              }
                              const adminUrl =
                                linkedInConfig.company_admin_url ||
                                `https://www.linkedin.com/company/${encodeURIComponent(
                                  linkedInConfig.organization_id
                                )}/admin/feed/posts/`;
                              window.open(adminUrl, '_blank', 'noreferrer');
                            }}
                            className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 font-semibold cursor-pointer"
                          >
                            <ExternalLink className="w-3 h-3" />
                            <span>Open Company Composer</span>
                          </button>
                        ) : (
                          <a
                            href={`https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(linkedinBody)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 font-semibold"
                          >
                            <ExternalLink className="w-3 h-3" />
                            <span>Open Personal Composer</span>
                          </a>
                        )}
                      </div>
                    </div>

                    <textarea
                      rows={10}
                      value={linkedinBody}
                      onChange={(e) => setLinkedinBody(e.target.value)}
                      placeholder="Click 'Generate with Gemini' to craft a high-impact LinkedIn post..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 leading-relaxed font-sans"
                    />
                  </div>
                </div>
              )}

              {/* Tab 2: X (Twitter) */}
              {selectedChannelTab === 'twitter' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-bold text-slate-300">X (Twitter) Main Tweet</label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopy(twitterTweet, 'twitter')}
                        className="text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-1 font-semibold cursor-pointer"
                      >
                        <Copy className="w-3 h-3" />
                        <span>{copiedChannel === 'twitter' ? 'Copied!' : 'Copy'}</span>
                      </button>
                      <a
                        href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(twitterTweet)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-1 font-semibold"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Open X Composer</span>
                      </a>
                    </div>
                  </div>

                  <textarea
                    rows={4}
                    value={twitterTweet}
                    onChange={(e) => setTwitterTweet(e.target.value)}
                    placeholder="Tweet text..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500 leading-relaxed"
                  />

                  {/* Thread Breakdown */}
                  {generatedContent?.twitter?.thread && generatedContent.twitter.thread.length > 0 && (
                    <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-850 space-y-2">
                      <p className="text-[11px] font-bold text-slate-300">🧵 3-Tweet Thread Breakdown:</p>
                      {generatedContent.twitter.thread.map((t, i) => (
                        <div key={i} className="p-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300">
                          {t}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Tab 3: Client Email Broadcast */}
              {selectedChannelTab === 'email' && (
                <div className="space-y-4">
                  {/* Audience & Subscriber Target Strip */}
                  <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl border bg-amber-950/60 border-amber-500/40 text-amber-400 shrink-0">
                          <Users className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white">Email Audience &amp; Recipients</span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800">
                              {audienceCount} Active Contacts
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Manage partner firms, client contacts, and leads for release broadcasts &amp; email updates.
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setIsAudienceModalOpen(true)}
                          className="px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <Users className="w-3.5 h-3.5 text-amber-400" />
                          <span>Manage Email List (CRUD)</span>
                        </button>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-850 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-[11px] font-semibold text-slate-400">Target Audience:</span>
                      <div className="flex items-center gap-1.5">
                        {[
                          { id: 'all', label: `All Active (${audienceCount})` },
                          { id: 'firm_partner', label: 'Accounting Firms' },
                          { id: 'client', label: 'Active Clients' },
                          { id: 'lead', label: 'Prospect Leads' },
                        ].map((seg) => (
                          <button
                            key={seg.id}
                            type="button"
                            onClick={() => setTargetAudienceTier(seg.id)}
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold border transition cursor-pointer ${
                              targetAudienceTier === seg.id
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {seg.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-300 mb-1">Email Subject Line</label>
                    <input
                      type="text"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-300 mb-1">Email HTML Preview</label>
                    <div
                      className="bg-slate-950 border border-slate-800 rounded-xl p-4 max-h-80 overflow-y-auto"
                      dangerouslySetInnerHTML={{ __html: emailHtml || '<p class="text-xs text-slate-500">No email drafted yet.</p>' }}
                    />
                  </div>
                </div>
              )}

              {/* Tab 4: In-App Changelog */}
              {selectedChannelTab === 'changelog' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">Version Number</label>
                      <input
                        type="text"
                        value={version}
                        onChange={(e) => setVersion(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">Category</label>
                      <input
                        type="text"
                        value={category}
                        disabled
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-400"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-300 mb-1">Markdown Release Note</label>
                    <textarea
                      rows={6}
                      value={changelogMarkdown}
                      onChange={(e) => setChangelogMarkdown(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              )}

              {/* Channel Broadcaster Action Bar */}
              <div className="pt-4 border-t border-slate-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs font-bold text-slate-300">Channels to Broadcast:</span>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={broadcastChannels.linkedin}
                        onChange={(e) => setBroadcastChannels({ ...broadcastChannels, linkedin: e.target.checked })}
                        className="rounded bg-slate-950 border-slate-700 text-blue-600 focus:ring-0"
                      />
                      <span className="flex items-center gap-1"><Linkedin className="w-3 h-3 text-blue-400" /> LinkedIn</span>
                    </label>

                    <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={broadcastChannels.twitter}
                        onChange={(e) => setBroadcastChannels({ ...broadcastChannels, twitter: e.target.checked })}
                        className="rounded bg-slate-950 border-slate-700 text-sky-600 focus:ring-0"
                      />
                      <span className="flex items-center gap-1"><Twitter className="w-3 h-3 text-sky-400" /> X (Twitter)</span>
                    </label>

                    <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={broadcastChannels.email}
                        onChange={(e) => setBroadcastChannels({ ...broadcastChannels, email: e.target.checked })}
                        className="rounded bg-slate-950 border-slate-700 text-amber-600 focus:ring-0"
                      />
                      <span className="flex items-center gap-1"><Mail className="w-3 h-3 text-amber-400" /> Client Email</span>
                    </label>

                    <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={broadcastChannels.changelog}
                        onChange={(e) => setBroadcastChannels({ ...broadcastChannels, changelog: e.target.checked })}
                        className="rounded bg-slate-950 border-slate-700 text-emerald-600 focus:ring-0"
                      />
                      <span className="flex items-center gap-1"><BookOpen className="w-3 h-3 text-emerald-400" /> Changelog</span>
                    </label>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleBroadcast}
                  disabled={isBroadcasting}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 via-teal-600 to-sky-600 hover:from-emerald-500 hover:to-sky-500 text-white text-xs font-bold py-3 px-4 rounded-xl shadow-lg shadow-emerald-600/25 transition cursor-pointer disabled:opacity-50"
                >
                  <Send className={`w-4 h-4 ${isBroadcasting ? 'animate-bounce' : ''}`} />
                  <span>{isBroadcasting ? 'Broadcasting Release Across Channels...' : 'Broadcast Release to Selected Channels'}</span>
                </button>

                {/* Real-Time Delivery Feedback */}
                {broadcastResult && (
                  <div className="bg-emerald-950/50 border border-emerald-500/40 rounded-xl p-3 text-xs text-emerald-200 space-y-1.5 animate-in fade-in">
                    <div className="flex items-center gap-2 font-bold text-emerald-300">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>Release Broadcast Completed! (v{broadcastResult.version})</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                      {broadcastResult.delivery_status?.linkedin && (
                        <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                          <p className="font-bold text-[11px] text-blue-400 flex items-center gap-1">
                            <Linkedin className="w-3 h-3" /> LinkedIn
                          </p>
                          <p className="text-[10px] text-slate-300 mt-0.5">
                            {broadcastResult.delivery_status.linkedin.mode === 'api'
                              ? `Posted to ${
                                  broadcastResult.delivery_status.linkedin.target === 'organization'
                                    ? broadcastResult.delivery_status.linkedin.organization_name || 'Business Page'
                                    : 'Profile'
                                } ✅`
                              : `Composer Ready (${
                                  broadcastResult.delivery_status.linkedin.target === 'organization'
                                    ? broadcastResult.delivery_status.linkedin.organization_name || 'Business Page'
                                    : 'Personal'
                                }) 🚀`}
                          </p>
                          {(broadcastResult.delivery_status.linkedin.company_admin_url ||
                            broadcastResult.delivery_status.linkedin.web_intent_url) && (
                            <a
                              href={
                                broadcastResult.delivery_status.linkedin.company_admin_url ||
                                broadcastResult.delivery_status.linkedin.web_intent_url
                              }
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-1 font-semibold mt-1"
                            >
                              <ExternalLink className="w-2.5 h-2.5" />
                              <span>
                                {broadcastResult.delivery_status.linkedin.target === 'organization'
                                  ? 'Open Company Feed'
                                  : 'Open Feed'}
                              </span>
                            </a>
                          )}
                        </div>
                      )}
                      {broadcastResult.delivery_status?.twitter && (
                        <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                          <p className="font-bold text-[11px] text-sky-400 flex items-center gap-1">
                            <Twitter className="w-3 h-3" /> X (Twitter)
                          </p>
                          <p className="text-[10px] text-slate-300 mt-0.5">Ready to Share 🚀</p>
                        </div>
                      )}
                      {broadcastResult.delivery_status?.email && (
                        <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                          <p className="font-bold text-[11px] text-amber-400 flex items-center gap-1">
                            <Mail className="w-3 h-3" /> Client Email
                          </p>
                          <p className="text-[10px] text-slate-300 mt-0.5">
                            {broadcastResult.delivery_status.email.dispatched_count || 1} Delivered ✅
                          </p>
                        </div>
                      )}
                      {broadcastResult.delivery_status?.changelog && (
                        <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                          <p className="font-bold text-[11px] text-emerald-400 flex items-center gap-1">
                            <BookOpen className="w-3 h-3" /> Changelog
                          </p>
                          <p className="text-[10px] text-slate-300 mt-0.5">Live on Portal ✅</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Subtab 2: Public In-App Changelog */}
      {activeSubTab === 'changelog' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-md space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-emerald-400" />
                <span>What's New in S4 Automations</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Audit-ready timeline of all deployed accounting workflows, API updates, and OCR vision improvements.
              </p>
            </div>
            <button
              type="button"
              onClick={loadChangelog}
              disabled={isLoadingChangelog}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingChangelog ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          <div className="space-y-6">
            {changelogItems.map((item) => (
              <div key={item.id} className="relative pl-6 border-l-2 border-slate-800 space-y-2">
                <div className="absolute -left-1.5 top-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-4 ring-slate-900" />
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/40">
                    v{item.version}
                  </span>
                  <span className="text-[11px] font-semibold text-sky-400 bg-sky-950/60 px-2 py-0.5 rounded border border-sky-800/40 uppercase">
                    {item.category}
                  </span>
                  {item.published_at && (
                    <span className="text-[10px] text-slate-500">
                      {new Date(item.published_at).toLocaleDateString()}
                    </span>
                  )}
                </div>

                <h3 className="text-sm font-bold text-white">{item.title}</h3>
                <p className="text-xs text-slate-300 leading-relaxed">{item.summary}</p>

                {item.changelog_entry && item.changelog_entry !== item.summary && (
                  <div className="bg-slate-950/60 rounded-xl p-3 text-xs text-slate-400 font-sans border border-slate-850 whitespace-pre-line leading-relaxed">
                    {item.changelog_entry}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subtab 3: Broadcast History */}
      {activeSubTab === 'history' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-md space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <History className="w-5 h-5 text-sky-400" />
                <span>Multi-Channel Dispatch History</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Record of previous feature broadcasts, active distribution channels, and delivery confirmations.
              </p>
            </div>
            <button
              type="button"
              onClick={loadChangelog}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
          </div>

          <div className="divide-y divide-slate-800">
            {historyItems.map((h) => (
              <div key={h.id} className="py-4 space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-sky-400 bg-sky-950 px-2 py-0.5 rounded border border-sky-800/40">
                        v{h.version}
                      </span>
                      <h4 className="text-xs font-bold text-white">{h.title}</h4>
                      {h.commit_hash && (
                        <span className="font-mono text-[10px] text-slate-500 bg-slate-950 px-1.5 py-0.5 rounded">
                          {h.commit_hash}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{h.summary}</p>
                  </div>

                  <span className="text-[10px] text-slate-500 shrink-0">
                    {h.published_at ? new Date(h.published_at).toLocaleDateString() : 'Draft'}
                  </span>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <span className="text-[10px] font-semibold text-slate-500">Channels Dispatched:</span>
                  {(h.channels_broadcasted || []).map((ch) => (
                    <span
                      key={ch}
                      className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 capitalize"
                    >
                      {ch}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* LinkedIn Business Page Connection Modal */}
      <LinkedInPageConnectModal
        isOpen={isLinkedInModalOpen}
        onClose={() => setIsLinkedInModalOpen(false)}
        onConnected={(cfg) => setLinkedInConfig(cfg)}
      />

      {/* Marketing Audience & Subscriber Manager Modal */}
      <AudienceManagerModal
        isOpen={isAudienceModalOpen}
        onClose={() => setIsAudienceModalOpen(false)}
        onAudienceUpdated={() => loadAudienceInfo()}
      />
    </div>
  );
};
