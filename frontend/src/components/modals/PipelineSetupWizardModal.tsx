import React, { useState, useEffect } from 'react';
import type { IngestionPipeline, AccountingSection, AccountingEntityType, TriggerType } from '../../types/client';
import { ACCOUNTING_PLATFORMS } from '../../types/client';
import { probeExternalConnection } from '../../lib/api';
import { useAutomation } from '../../context/AutomationContext';
import {
  X,
  Check,
  Sparkles,
  Cloud,
  Folder,
  Mail,
  Zap,
  Clock,
  SlidersHorizontal,
  ChevronRight,
  ChevronLeft,
  Copy,
  Info,
  CheckCircle2,
  AlertTriangle,
  PlayCircle,
  RefreshCw,
  Save,
  MessageSquare,
  FileText,
  DollarSign,
  ArrowRight,
} from 'lucide-react';

interface PipelineSetupWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (pipelineData: IngestionPipeline) => Promise<void>;
  clientId: string;
  clientName: string;
  initialPipeline?: IngestionPipeline | null;
  targetAccountingSoftware?: string;
}

const SERVICE_ACCOUNT_EMAIL = 's4-vision-ingest@s4-automations.iam.gserviceaccount.com';

export const PipelineSetupWizardModal: React.FC<PipelineSetupWizardModalProps> = ({
  isOpen,
  onClose,
  onSave,
  clientId,
  clientName,
  initialPipeline,
  targetAccountingSoftware = 'zoho_books',
}) => {
  const { addLog } = useAutomation();

  const [step, setStep] = useState<number>(1);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Form State
  const [pipeId, setPipeId] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [section, setSection] = useState<AccountingSection>('AR');
  const [entityType, setEntityType] = useState<AccountingEntityType>('ar_sales_invoice');
  const [sourceType, setSourceType] = useState<'google_drive' | 'onedrive' | 'email' | 'webhook' | 'whatsapp' | 'manual'>('google_drive');
  const [sourceIdentifier, setSourceIdentifier] = useState<string>('');
  const [defaultAccountCode, setDefaultAccountCode] = useState<string>('4000 - Commercial Sales Revenue');
  const [autoPostToZoho, setAutoPostToZoho] = useState<boolean>(false);
  const [isActive, setIsActive] = useState<boolean>(true);

  // Trigger State
  const [triggerType, setTriggerType] = useState<TriggerType>('scheduled_cron');
  const [cronExpression, setCronExpression] = useState<string>('0 20 * * *');
  const [cronScheduleHuman, setCronScheduleHuman] = useState<string>('Daily at 8:00 PM');

  // Channel External Configuration Details
  const [allowedSenders, setAllowedSenders] = useState<string>('');
  const [oneDriveTenantId, setOneDriveTenantId] = useState<string>('');
  const [oneDriveClientId, setOneDriveClientId] = useState<string>('');
  const [oneDriveSecret, setOneDriveSecret] = useState<string>('');

  // Probing State
  const [isProbing, setIsProbing] = useState<boolean>(false);
  const [probeResult, setProbeResult] = useState<{ success: boolean; message: string; details?: any } | null>(null);

  // Initialize or reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      if (initialPipeline) {
        setPipeId(initialPipeline.id);
        setName(initialPipeline.name);
        setSection(initialPipeline.section);
        setEntityType(initialPipeline.entity_type);
        setSourceType(initialPipeline.source_type as any || 'google_drive');
        setSourceIdentifier(initialPipeline.source_identifier || '');
        setDefaultAccountCode(initialPipeline.default_account_code || (initialPipeline.section === 'AR' ? '4000 - Sales Revenue' : initialPipeline.section === 'AP' ? '5000 - Operating Expenses' : '1001 - Main Operating Account'));
        setAutoPostToZoho(!!initialPipeline.auto_post_to_zoho);
        setIsActive(initialPipeline.is_active !== false);
        setTriggerType(initialPipeline.trigger_type || 'scheduled_cron');
        setCronExpression(initialPipeline.cron_expression || '0 20 * * *');
        setCronScheduleHuman(initialPipeline.cron_schedule_human || 'Daily at 8:00 PM');
      } else {
        const newId = `pipe_${Date.now()}`;
        setPipeId(newId);
        setName('');
        setSection('AR');
        setEntityType('ar_sales_invoice');
        setSourceType('google_drive');
        setSourceIdentifier('');
        setDefaultAccountCode('4000 - Commercial Sales Revenue');
        setAutoPostToZoho(false);
        setIsActive(true);
        setTriggerType('scheduled_cron');
        setCronExpression('0 20 * * *');
        setCronScheduleHuman('Daily at 8:00 PM');
        setAllowedSenders('');
        setOneDriveTenantId('');
        setOneDriveClientId('');
        setOneDriveSecret('');
      }
      setStep(1);
      setProbeResult(null);
    }
  }, [isOpen, initialPipeline]);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleTestChannel = async () => {
    setIsProbing(true);
    setProbeResult(null);
    try {
      const res = await probeExternalConnection({
        source_type: sourceType,
        folder_id: sourceType === 'google_drive' ? sourceIdentifier : undefined,
        source_email: sourceType === 'email' ? sourceIdentifier : undefined,
        source_config: {
          tenant_id: oneDriveTenantId,
          client_id: oneDriveClientId,
          drive_id: sourceType === 'onedrive' ? sourceIdentifier : undefined,
        },
      });
      setProbeResult({
        success: res.success !== false,
        message: res.summary || `Channel connectivity confirmed for ${sourceType}.`,
        details: res.checks,
      });
      addLog('success', `✅ [STREAM PROBE] Successfully probed ${sourceType} connection for stream "${name}".`);
    } catch (err: any) {
      setProbeResult({
        success: false,
        message: err.message || `Channel probe failed for ${sourceType}.`,
      });
      addLog('warning', `⚠️ [STREAM PROBE] Channel probe failed: ${err.message}`);
    } finally {
      setIsProbing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      const pipelineData: IngestionPipeline = {
        id: pipeId || `pipe_${Date.now()}`,
        name: name.trim(),
        section,
        entity_type: entityType,
        source_type: sourceType,
        source_identifier: sourceIdentifier.trim(),
        default_account_code: defaultAccountCode.trim(),
        auto_post_to_zoho: autoPostToZoho,
        is_active: isActive,
        trigger_type: triggerType,
        cron_expression: triggerType === 'scheduled_cron' ? cronExpression : undefined,
        cron_schedule_human: triggerType === 'scheduled_cron' ? cronScheduleHuman : undefined,
        webhook_slug: triggerType === 'realtime_webhook' ? `pipe_${pipeId || 'stream'}` : undefined,
      };

      await onSave(pipelineData);
      onClose();
    } catch (err: any) {
      addLog('error', `Failed to save pipeline: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const stepsList = [
    { num: 1, title: 'Accounting & Entity', icon: SlidersHorizontal },
    { num: 2, title: 'Channel & Storage', icon: Cloud },
    { num: 3, title: 'Trigger & Schedule', icon: Clock },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-sky-500/30 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/20">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">
                  {initialPipeline ? 'Edit Ingestion Pipeline Stream' : 'Configure New Ingestion Pipeline Stream'}
                </h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-sky-950 border border-sky-500/40 text-sky-300">
                  {clientName}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Define document classification, dedicated channel source, and automated trigger schedules for this stream.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step Navigation Bar */}
        <div className="px-6 py-3 bg-slate-950/40 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto">
            {stepsList.map((s) => {
              const IconComp = s.icon;
              const isCurrent = step === s.num;
              const isPassed = step > s.num;
              return (
                <button
                  key={s.num}
                  type="button"
                  onClick={() => setStep(s.num)}
                  className={`flex items-center gap-2 text-xs font-semibold py-1 px-2.5 rounded-lg transition cursor-pointer ${
                    isCurrent
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                      : isPassed
                      ? 'text-emerald-400 hover:bg-slate-800'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    isCurrent ? 'bg-sky-500 text-white' : isPassed ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {isPassed ? '✓' : s.num}
                  </span>
                  <span>{s.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step Content */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          
          {/* STEP 1: Accounting Classification & Target Entity */}
          {step === 1 && (
            <div className="space-y-4 animate-in fade-in">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Pipeline Stream Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Counter Sales Delivery Slips, China Container Bills, MoMo Customer Receipts"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Accounting Workflow Section
                  </label>
                  <select
                    value={section}
                    onChange={(e) => {
                      const sec = e.target.value as AccountingSection;
                      setSection(sec);
                      if (sec === 'AR') {
                        setEntityType('ar_sales_invoice');
                        setDefaultAccountCode('4000 - Commercial Sales Revenue');
                      } else if (sec === 'AP') {
                        setEntityType('ap_vendor_bill');
                        setDefaultAccountCode('5000 - Cost of Goods Sold (Inventory)');
                      } else if (sec === 'BANK') {
                        setEntityType('bank_statement');
                        setDefaultAccountCode('1001 - Main Operating Bank Account');
                      } else {
                        setEntityType('gl_journal');
                        setDefaultAccountCode('9000 - General Ledger Accruals');
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500 cursor-pointer"
                  >
                    <option value="AR">🔵 Accounts Receivable (AR) — Revenue &amp; Customer Invoices</option>
                    <option value="AP">🟠 Accounts Payable (AP) — Vendor Bills &amp; Expenses</option>
                    <option value="BANK">🟢 Banking &amp; Treasury (BANK) — Statements &amp; MoMo Feeds</option>
                    <option value="GL">🟣 General Ledger (GL) — Manual Journal Entries</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Target Accounting Entity (API Schema)
                  </label>
                  <select
                    value={entityType}
                    onChange={(e) => setEntityType(e.target.value as AccountingEntityType)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500 cursor-pointer"
                  >
                    {section === 'AR' && (
                      <>
                        <option value="ar_sales_invoice">Sales Invoice &amp; Delivery Slips (/invoices)</option>
                        <option value="ar_customer_payment">Customer Payment &amp; MoMo Proofs (/customerpayments)</option>
                        <option value="ar_credit_note">Credit Note &amp; Return Slips (/creditnotes)</option>
                        <option value="ar_retainer_invoice">Retainer Invoice (/retainerinvoices)</option>
                        <option value="ar_estimate">Sales Estimate / Quote (/estimates)</option>
                      </>
                    )}
                    {section === 'AP' && (
                      <>
                        <option value="ap_vendor_bill">Vendor / Supplier Bill (/bills)</option>
                        <option value="ap_vendor_payment">Vendor Payment &amp; Wire Proof (/vendorpayments)</option>
                        <option value="ap_direct_expense">Direct Expense &amp; Petty Cash (/expenses)</option>
                        <option value="ap_purchase_order">Purchase Order (/purchaseorders)</option>
                        <option value="ap_vendor_credit">Vendor Credit (/vendorcredits)</option>
                      </>
                    )}
                    {section === 'BANK' && (
                      <>
                        <option value="bank_statement">Bank Statement PDF / Feed (/banktransactions)</option>
                        <option value="momo_statement">Mobile Money (MoMo) Statement (/banktransactions)</option>
                      </>
                    )}
                    {section === 'GL' && (
                      <option value="gl_journal">Manual Double-Entry Journal Entry (/journalentries)</option>
                    )}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Default Chart of Accounts Code for this Stream
                </label>
                <input
                  type="text"
                  value={defaultAccountCode}
                  onChange={(e) => setDefaultAccountCode(e.target.value)}
                  placeholder="e.g. 4000 - Sales Revenue or 5000 - Inventory COGS"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Line items extracted from this stream's documents will default to this account if not explicitly overridden by AI SKU matching.
                </span>
              </div>
            </div>
          )}

          {/* STEP 2: Dedicated Ingestion Channel & Storage Setup */}
          {step === 2 && (
            <div className="space-y-4 animate-in fade-in">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  Select Ingestion Channel for "{name || 'this stream'}"
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { id: 'google_drive', label: 'Google Drive', icon: Folder, desc: 'Shared folder' },
                    { id: 'onedrive', label: 'OneDrive / SharePoint', icon: Cloud, desc: 'Microsoft 365 drive' },
                    { id: 'email', label: 'Inbound Email Alias', icon: Mail, desc: 'Forwarding mailbox' },
                    { id: 'webhook', label: 'Inbound Webhook', icon: Zap, desc: 'ERP / POS push' },
                    { id: 'whatsapp', label: 'WhatsApp Bot', icon: MessageSquare, desc: 'In Progress' },
                    { id: 'manual', label: 'Manual Upload', icon: FileText, desc: 'Staging dropzone' },
                  ].map((type) => {
                    const IconComp = type.icon;
                    const isSel = sourceType === type.id;
                    return (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => setSourceType(type.id as any)}
                        className={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between space-y-1 ${
                          isSel
                            ? 'bg-sky-950/60 border-sky-500 text-white shadow-lg shadow-sky-500/10'
                            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <IconComp className={`w-4 h-4 ${isSel ? 'text-sky-400' : 'text-slate-400'}`} />
                          <span className="text-xs font-bold text-white">{type.label}</span>
                        </div>
                        <span className="text-[10px] text-slate-500">{type.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Channel Identifier Inputs */}
              {sourceType === 'google_drive' && (
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <div className="bg-sky-950/40 border border-sky-500/30 rounded-xl p-3 text-xs space-y-2">
                    <span className="text-sky-300 font-bold block">1. Share Google Drive Folder with S4 Service Account:</span>
                    <div className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-lg p-2 font-mono text-[11px] text-sky-200">
                      <span className="truncate mr-2">{SERVICE_ACCOUNT_EMAIL}</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(SERVICE_ACCOUNT_EMAIL, 'sa_email')}
                        className="bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-bold px-2 py-0.5 rounded cursor-pointer"
                      >
                        {copiedKey === 'sa_email' ? 'Copied!' : 'Copy Email'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Google Drive Folder ID for this Stream <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 1Uu_Q3p8s1_anr_laundry_slips"
                      value={sourceIdentifier}
                      onChange={(e) => setSourceIdentifier(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-sky-500"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Extracted from the URL when viewing this stream's folder in Google Drive.
                    </span>
                  </div>
                </div>
              )}

              {sourceType === 'onedrive' && (
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      SharePoint / OneDrive Folder URL or Drive ID <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. https://company.sharepoint.com/sites/.../Ingestion"
                      value={sourceIdentifier}
                      onChange={(e) => setSourceIdentifier(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">Azure Tenant ID (Optional)</label>
                      <input
                        type="text"
                        placeholder="e.g. 3a5b8c9d-..."
                        value={oneDriveTenantId}
                        onChange={(e) => setOneDriveTenantId(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">Azure Client ID (Optional)</label>
                      <input
                        type="text"
                        placeholder="e.g. 9f8e7d6c-..."
                        value={oneDriveClientId}
                        onChange={(e) => setOneDriveClientId(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              {sourceType === 'email' && (
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Dedicated Inbound Email Alias for this Stream
                    </label>
                    <input
                      type="text"
                      placeholder={`e.g. ${clientId}_${section.toLowerCase()}@inbound.service4gh.com`}
                      value={sourceIdentifier || `${clientId}_${section.toLowerCase()}@inbound.service4gh.com`}
                      onChange={(e) => setSourceIdentifier(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Allowed Sender Whitelist (Comma-separated)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. billing@supplier.com, frontdesk@hotel.com"
                      value={allowedSenders}
                      onChange={(e) => setAllowedSenders(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono"
                    />
                  </div>
                </div>
              )}

              {sourceType === 'webhook' && (
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2 text-xs">
                    <span className="font-bold text-white block">Dedicated Stream Webhook Endpoint:</span>
                    <div className="p-2 bg-slate-900 border border-slate-700 rounded font-mono text-[11px] text-sky-300 break-all flex items-center justify-between">
                      <span>https://s4-api.service4gh.com/api/v1/webhooks/pipelines/{pipeId || 'pipe_id'}</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(`https://s4-api.service4gh.com/api/v1/webhooks/pipelines/${pipeId || 'pipe_id'}`, 'wh_url')}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] px-2 py-0.5 rounded cursor-pointer ml-2"
                      >
                        {copiedKey === 'wh_url' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {sourceType === 'whatsapp' && (
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <div className="bg-emerald-950/30 border border-emerald-500/40 rounded-xl p-3.5 space-y-2 text-xs text-slate-300">
                    <span className="font-bold text-white flex items-center gap-1.5">
                      <span>📱 WhatsApp Ingestion Bot</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        In Progress
                      </span>
                    </span>
                    <p className="text-slate-400">
                      Drivers and staff can snap photos of delivery slips or MoMo confirmation SMS and send them directly to this stream's WhatsApp bot.
                    </p>
                    <input
                      type="text"
                      placeholder="e.g. Dedicated WhatsApp Number: +233 55 123 4567"
                      value={sourceIdentifier}
                      onChange={(e) => setSourceIdentifier(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                </div>
              )}

              {/* Direct Test Channel Connection Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleTestChannel}
                  disabled={isProbing}
                  className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold px-3 py-2 rounded-xl transition cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isProbing ? 'animate-spin' : ''}`} />
                  <span>{isProbing ? 'Testing Connection...' : `🔍 Test ${sourceType.replace(/_/g, ' ')} Channel Connection`}</span>
                </button>

                {probeResult && (
                  <div className={`mt-2 p-2.5 rounded-lg border text-xs flex items-center gap-2 ${
                    probeResult.success ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300' : 'bg-red-950/40 border-red-500/40 text-red-300'
                  }`}>
                    {probeResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-red-400" />}
                    <span>{probeResult.message}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: Trigger Schedule & Automation Rules */}
          {step === 3 && (
            <div className="space-y-4 animate-in fade-in">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-300">
                  Trigger Modality for "{name || 'this stream'}"
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setTriggerType('scheduled_cron')}
                    className={`p-3 rounded-xl border text-center transition cursor-pointer flex flex-col items-center gap-1 ${
                      triggerType === 'scheduled_cron'
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-md'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <Clock className="w-4 h-4" />
                    <span className="text-xs font-bold">⏰ Scheduled Cron</span>
                    <span className="text-[10px] opacity-75">Recurring Batch</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTriggerType('realtime_webhook')}
                    className={`p-3 rounded-xl border text-center transition cursor-pointer flex flex-col items-center gap-1 ${
                      triggerType === 'realtime_webhook'
                        ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 shadow-md'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <Zap className="w-4 h-4" />
                    <span className="text-xs font-bold">⚡ Real-Time Push</span>
                    <span className="text-[10px] opacity-75">Instant Webhook</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTriggerType('manual_only')}
                    className={`p-3 rounded-xl border text-center transition cursor-pointer flex flex-col items-center gap-1 ${
                      triggerType === 'manual_only'
                        ? 'bg-purple-500/20 border-purple-500/50 text-purple-300 shadow-md'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <PlayCircle className="w-4 h-4" />
                    <span className="text-xs font-bold">🖱️ Manual Only</span>
                    <span className="text-[10px] opacity-75">On-Demand Trigger</span>
                  </button>
                </div>
              </div>

              {/* Scheduled Cron Presets */}
              {triggerType === 'scheduled_cron' && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                  <label className="block text-xs font-semibold text-slate-300">
                    Batch Frequency Preset
                  </label>
                  <select
                    value={cronScheduleHuman}
                    onChange={(e) => {
                      const val = e.target.value;
                      let expr = '0 20 * * *';
                      if (val === 'Hourly') expr = '0 * * * *';
                      else if (val === 'Every 6 Hours') expr = '0 */6 * * *';
                      else if (val === 'Weekdays at 6:00 PM') expr = '0 18 * * 1-5';
                      else if (val === '1st of Month at 9:00 AM') expr = '0 9 1 * *';
                      setCronScheduleHuman(val);
                      setCronExpression(expr);
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    <option value="Daily at 8:00 PM">Daily at 8:00 PM (Default End-of-Day Sweep)</option>
                    <option value="Hourly">Hourly Continuous Ingestion</option>
                    <option value="Every 6 Hours">Every 6 Hours (Periodic Batch)</option>
                    <option value="Weekdays at 6:00 PM">Weekdays at 6:00 PM (Business Close)</option>
                    <option value="1st of Month at 9:00 AM">1st of Month at 9:00 AM (Monthly Closing)</option>
                  </select>
                  <p className="text-[10px] text-slate-400 font-mono">
                    Cron Expression: <code className="text-amber-300">{cronExpression}</code>
                  </p>
                </div>
              )}

              {/* Auto-Post & Active Toggles */}
              <div className="space-y-3 pt-3 border-t border-slate-800">
                <label className="flex items-start gap-3 bg-slate-950 border border-slate-800 rounded-xl p-3.5 cursor-pointer hover:border-slate-700 transition">
                  <input
                    type="checkbox"
                    checked={autoPostToZoho}
                    onChange={(e) => setAutoPostToZoho(e.target.checked)}
                    className="mt-0.5 rounded border-slate-700 text-sky-600 focus:ring-sky-500"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-white block">
                      Auto-Post Live to {ACCOUNTING_PLATFORMS.find((p) => p.id === targetAccountingSoftware)?.name || 'Accounting Platform'}
                    </span>
                    <span className="text-slate-400">
                      When enabled, extracted documents that pass 100% strict contract validation will be created immediately in your accounting platform. If disabled, transactions are staged in the Review Ledger for CPA approval.
                    </span>
                  </div>
                </label>

                <label className="flex items-center gap-3 bg-slate-950 border border-slate-800 rounded-xl p-3.5 cursor-pointer hover:border-slate-700 transition">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-white">Stream Active</span>
                    <span className="text-slate-400 block text-[11px]">Uncheck to pause document scanning without deleting this stream configuration.</span>
                  </div>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between">
          <div>
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((prev) => prev - 1)}
                className="flex items-center gap-1 text-xs font-semibold text-slate-300 hover:text-white px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 transition cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-semibold text-slate-400 hover:text-white px-3.5 py-2 rounded-xl transition cursor-pointer"
            >
              Cancel
            </button>

            {step < 3 ? (
              <button
                type="button"
                onClick={() => setStep((prev) => prev + 1)}
                disabled={!name.trim()}
                className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-lg shadow-sky-600/20 transition cursor-pointer"
              >
                <span>Continue</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSaving || !name.trim()}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-lg shadow-emerald-600/20 transition cursor-pointer"
              >
                {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>{initialPipeline ? 'Save Pipeline Changes' : 'Create Ingestion Pipeline'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
