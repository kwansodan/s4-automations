import React, { useState, useEffect } from 'react';
import { useClient } from '../../context/ClientContext';
import { useAutomation } from '../../context/AutomationContext';
import { probeExternalConnection, dryRunSampleOcr, fetchZohoCatalog } from '../../lib/api';
import type { ExternalChecklistItem, IndustryPreset, ProbeResult, DryRunResult } from '../../types/client';
import {
  X,
  Check,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Building2,
  ExternalLink,
  Copy,
  Sparkles,
  Cloud,
  Folder,
  Mail,
  Zap,
  ShieldCheck,
  AlertTriangle,
  FileText,
  Sliders,
  Layers,
  ArrowRight,
  RefreshCw,
  Info,
  CheckCheck,
  Send,
  Eye,
  Terminal,
  Users,
  DollarSign,
} from 'lucide-react';

const INDUSTRY_PRESETS: IndustryPreset[] = [
  {
    id: 'laundry',
    name: 'Commercial Laundry & Hospitality',
    icon: '🧺',
    description: 'Physical handwritten pickup/delivery slip OCR vision, linen loss reconciliation, Google Sheets review sync, and Zoho draft billing.',
    defaultSource: 'google_drive',
    defaultEngine: 'gemini_flash_vision',
    samplePreset: 'laundry_slip',
    defaultVolume: '350+ Slips / mo',
    currency: 'GHS',
    defaultBlueprints: [
      { title: 'Vision OCR Extraction', desc: 'Gemini 3.6 Flash structured JSON extraction on daily control sheets', status: 'active' },
      { title: 'Google Sheets Review Sync', desc: 'Populate Tab 1 (Daily Details) and Tab 2 (Monthly Billing Summary)', status: 'active' },
      { title: 'Zoho Books Draft Invoicing', desc: '1-Click draft invoice creation appending newly approved line items', status: 'active' },
    ],
  },
  {
    id: 'property',
    name: 'Real Estate & Property Management',
    icon: '🏢',
    description: 'Tenant rent payment slip & mobile money receipt parsing, monthly recurring billing, utility apportionment, and late notice dispatch.',
    defaultSource: 'email',
    defaultEngine: 'rent_receipt_matcher',
    samplePreset: 'rent_receipt',
    defaultVolume: '100+ Units / mo',
    currency: 'GHS',
    defaultBlueprints: [
      { title: 'Rent Receipt OCR Ingestion', desc: 'Extract tenant mobile money and bank transfer receipts', status: 'active' },
      { title: 'Utility Cost Apportionment', desc: 'Apportion shared power/water bills across occupied units', status: 'in_progress' },
      { title: 'Tenant Monthly Invoicing', desc: 'Generate tenant invoices with automated email/SMS dispatch', status: 'queued' },
    ],
  },
  {
    id: 'financial',
    name: 'Financial Advisory & Asset Management',
    icon: '⚡',
    description: 'Multi-currency PDF bank statement parsing, automated chart of accounts matching, and Zoho Books journal batch posting.',
    defaultSource: 'onedrive',
    defaultEngine: 'pdf_bank_parser',
    samplePreset: 'bank_statement',
    defaultVolume: '1,500+ Tx / mo',
    currency: 'USD',
    defaultBlueprints: [
      { title: 'Bank Statement PDF Parser', desc: 'Extract structured transactions from multi-bank PDF statements', status: 'active' },
      { title: 'AI Transaction Categorization', desc: 'Fuzzy-match chart of accounts and assign expense categories', status: 'in_progress' },
      { title: 'Zoho Journal Batch Poster', desc: 'Post balanced double-entry journals into Zoho Books API', status: 'queued' },
    ],
  },
  {
    id: 'logistics',
    name: 'Logistics & Fleet Transport',
    icon: '🚛',
    description: 'Waybill & fuel slip extraction, driver expense logging, delivery confirmation reconciliation, and carrier invoice drafting.',
    defaultSource: 'google_drive',
    defaultEngine: 'gemini_flash_vision',
    samplePreset: 'laundry_slip',
    defaultVolume: '600+ Waybills / mo',
    currency: 'GHS',
    defaultBlueprints: [
      { title: 'Waybill Vision Extraction', desc: 'Extract consignee details, cargo weight, and fuel receipts', status: 'active' },
      { title: 'Driver Expense Ledger', desc: 'Cross-check fuel pump vouchers against GPS trip mileage', status: 'in_progress' },
      { title: 'Carrier Invoicing Engine', desc: 'Batch invoice freight clients based on signed PODs', status: 'queued' },
    ],
  },
  {
    id: 'retail',
    name: 'Retail & Wholesale Distribution',
    icon: '🛍️',
    description: 'Daily cash register tally sheet OCR, supplier invoice matching, inventory discrepancy logging, and sales tax filing export.',
    defaultSource: 'google_drive',
    defaultEngine: 'invoice_ocr',
    samplePreset: 'commercial_invoice',
    defaultVolume: '450+ Reports / mo',
    currency: 'GHS',
    defaultBlueprints: [
      { title: 'POS Tally Sheet Parser', desc: 'Capture end-of-day register z-reports and physical count slips', status: 'active' },
      { title: 'Supplier Invoice Reconciler', desc: 'Match vendor invoices against purchase orders and received goods', status: 'in_progress' },
      { title: 'Sales Tax Journal Sync', desc: 'Post daily gross revenue and tax breakdown to general ledger', status: 'queued' },
    ],
  },
];

const SERVICE_ACCOUNT_EMAIL = 's4-vision-ingest@s4-automations.iam.gserviceaccount.com';

export const ClientSetupWizardModal: React.FC = () => {
  const { isWizardOpen, setIsWizardOpen, createClientFromWizard, wizardDraft, saveWizardDraft, clearWizardDraft } = useClient();
  const { setActiveTab, addLog } = useAutomation();

  const [currentStep, setCurrentStep] = useState<number>(1);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState<string>('');
  const [selectedIndustry, setSelectedIndustry] = useState<string>('laundry');
  const [icon, setIcon] = useState<string>('🧺');
  const [currency, setCurrency] = useState<string>('GHS');
  const [projectedVolume, setProjectedVolume] = useState<string>('350+ Slips / mo');
  const [description, setDescription] = useState<string>('');

  // Step 2: Zoho Books External State
  const [zohoOrgId, setZohoOrgId] = useState<string>('');
  const [defaultIncomeAccount, setDefaultIncomeAccount] = useState<string>('4000 - Commercial Service Revenue');
  const [taxRateVat, setTaxRateVat] = useState<string>('Standard Ghana GRA (15% VAT + 2.5% NHIL + 2.5% GETFund + 1% COVID)');

  // Step 2 Zoho API Dynamic Customer & SKU Discovery State
  const [isFetchingZoho, setIsFetchingZoho] = useState<boolean>(false);
  const [zohoSyncedContacts, setZohoSyncedContacts] = useState<any[] | null>(null);
  const [zohoSyncedItemsCount, setZohoSyncedItemsCount] = useState<number | null>(null);

  // Step 2 External Checklist
  const [zohoChecks, setZohoChecks] = useState<Record<string, boolean>>({
    customer_created: false,
    org_id_retrieved: false,
    chart_accounts_verified: false,
    catalog_skus_registered: false,
  });

  // Step 3: Ingestion Channel State
  const [sourceType, setSourceType] = useState<'google_drive' | 'onedrive' | 'email' | 'webhook'>('google_drive');
  const [folderId, setFolderId] = useState<string>('');
  const [sourceEmail, setSourceEmail] = useState<string>('');
  const [allowedSenders, setAllowedSenders] = useState<string>('');
  const [oneDriveTenantId, setOneDriveTenantId] = useState<string>('');
  const [oneDriveClientId, setOneDriveClientId] = useState<string>('');
  const [oneDriveSecret, setOneDriveSecret] = useState<string>('');
  const [oneDriveDriveId, setOneDriveDriveId] = useState<string>('');

  // Step 3 External Checklist
  const [storageChecks, setStorageChecks] = useState<Record<string, boolean>>({
    folder_created: false,
    service_account_shared: false,
    subfolders_initialized: false,
    url_id_extracted: false,
  });

  // Step 4: AI Engine & Guardrails State
  const [aiEngine, setAiEngine] = useState<string>('gemini_flash_vision');
  const [varianceTolerance, setVarianceTolerance] = useState<number>(5.0);
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(80);
  const [enableSheetsSync, setEnableSheetsSync] = useState<boolean>(true);
  const [notificationEmail, setNotificationEmail] = useState<string>('cdanso@service4gh.com');

  // Step 5: Probe & Dry Run Results
  const [isProbing, setIsProbing] = useState<boolean>(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [isDryRunning, setIsDryRunning] = useState<boolean>(false);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [selectedSamplePreset, setSelectedSamplePreset] = useState<string>('laundry_slip');

  // Loading & Submission State
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Initialize or resume draft
  useEffect(() => {
    if (wizardDraft) {
      if (wizardDraft.name) setName(wizardDraft.name);
      if (wizardDraft.selectedIndustry) setSelectedIndustry(wizardDraft.selectedIndustry);
      if (wizardDraft.icon) setIcon(wizardDraft.icon);
      if (wizardDraft.currency) setCurrency(wizardDraft.currency);
      if (wizardDraft.projectedVolume) setProjectedVolume(wizardDraft.projectedVolume);
      if (wizardDraft.description) setDescription(wizardDraft.description);
      if (wizardDraft.zohoOrgId) setZohoOrgId(wizardDraft.zohoOrgId);
      if (wizardDraft.sourceType) setSourceType(wizardDraft.sourceType);
      if (wizardDraft.folderId) setFolderId(wizardDraft.folderId);
      if (wizardDraft.sourceEmail) setSourceEmail(wizardDraft.sourceEmail);
      if (wizardDraft.zohoChecks) setZohoChecks(wizardDraft.zohoChecks);
      if (wizardDraft.storageChecks) setStorageChecks(wizardDraft.storageChecks);
    }
  }, [wizardDraft]);

  // Handle Preset Change
  const handleSelectIndustryPreset = (presetId: string) => {
    const preset = INDUSTRY_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setSelectedIndustry(preset.id);
    setIcon(preset.icon);
    setSourceType(preset.defaultSource);
    setAiEngine(preset.defaultEngine);
    setSelectedSamplePreset(preset.samplePreset);
    setProjectedVolume(preset.defaultVolume);
    setCurrency(preset.currency);
    if (!description || description === INDUSTRY_PRESETS.find((p) => p.id === selectedIndustry)?.description) {
      setDescription(preset.description);
    }
  };

  // Auto-generate source email alias when name changes
  useEffect(() => {
    if (name) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (!sourceEmail || sourceEmail.includes('@inbound.service4gh.com')) {
        setSourceEmail(`${slug}@inbound.service4gh.com`);
      }
    }
  }, [name]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleFetchZohoData = async () => {
    setIsFetchingZoho(true);
    try {
      const data = await fetchZohoCatalog(zohoOrgId || undefined);
      if (data && data.contacts) {
        setZohoSyncedContacts(data.contacts);
        setZohoSyncedItemsCount(data.items_count || data.items?.length || 0);
        setZohoChecks((prev) => ({
          ...prev,
          org_id_retrieved: true,
          customer_created: true,
          catalog_skus_registered: true,
          chart_accounts_verified: true,
        }));
        addLog('success', `[ZOHO API] Synced ${data.contacts_count} customer contacts & ${data.items_count} catalog items from Zoho Books.`);
      }
    } catch (err: any) {
      addLog('warning', `Could not fetch live Zoho contacts: ${err.message}`);
    } finally {
      setIsFetchingZoho(false);
    }
  };

  const handleNextStep = () => {
    // Auto-save draft
    saveWizardDraft({
      name,
      selectedIndustry,
      icon,
      currency,
      projectedVolume,
      description,
      zohoOrgId,
      sourceType,
      folderId,
      sourceEmail,
      zohoChecks,
      storageChecks,
      currentStep: currentStep + 1,
    });
    setCurrentStep((prev) => Math.min(prev + 1, 6));
  };

  const handlePrevStep = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleRunProbe = async () => {
    setIsProbing(true);
    setProbeResult(null);
    try {
      const res = await probeExternalConnection({
        source_type: sourceType,
        folder_id: folderId,
        source_email: sourceEmail,
        zoho_org_id: zohoOrgId,
        source_config: {
          tenant_id: oneDriveTenantId,
          client_id: oneDriveClientId,
          drive_id: oneDriveDriveId,
        },
      });
      setProbeResult(res);
      addLog('info', `[WIZARD PROBE] Successfully probed ${sourceType} connection.`);
    } catch (err: any) {
      setProbeResult({
        success: false,
        status: 'FAILED',
        source_type: sourceType,
        checks: [
          {
            target: 'Connection Probe',
            identifier: 'Probe Failed',
            status: 'FAIL',
            message: err.message || 'Could not verify external connectivity.',
          },
        ],
        timestamp: new Date().toISOString(),
        summary: 'Probe failed. Please check network and credentials.',
      });
    } finally {
      setIsProbing(false);
    }
  };

  const handleRunDryRun = async () => {
    setIsDryRunning(true);
    setDryRunResult(null);
    try {
      const res = await dryRunSampleOcr({
        engine_type: aiEngine,
        sample_preset: selectedSamplePreset,
      });
      setDryRunResult(res);
      addLog('info', `[WIZARD OCR] Dry run parsed ${res.items?.length || 0} line items.`);
    } catch (err: any) {
      console.warn('Dry run failed:', err);
    } finally {
      setIsDryRunning(false);
    }
  };

  const handleLaunchClient = async () => {
    if (!name.trim()) return;
    setIsSubmitting(true);
    try {
      const currentPreset = INDUSTRY_PRESETS.find((p) => p.id === selectedIndustry);
      const blueprints = currentPreset?.defaultBlueprints || [
        { title: 'Source Ingestion', desc: `Connected via ${sourceType}`, status: 'active' },
        { title: 'AI Schema Extraction', desc: 'Custom vision models for document extraction', status: 'in_progress' },
        { title: 'Accounting Posting Engine', desc: 'Sync approved transactions into Zoho Books', status: 'queued' },
      ];

      await createClientFromWizard({
        name: name.trim(),
        industry: currentPreset?.name || 'Financial & Professional Services',
        icon: icon || '🏢',
        status: 'dev',
        status_text: 'In Development',
        description: description.trim() || currentPreset?.description,
        source_type: sourceType,
        source_email: sourceEmail,
        folder_id: folderId,
        zoho_org_id: zohoOrgId,
        currency,
        projectedMonthlyVolume: projectedVolume,
        blueprints,
        active_integrations: [
          sourceType === 'google_drive' ? 'Google Drive' : sourceType === 'onedrive' ? 'OneDrive' : 'Email Forwarding',
          'Gemini Vision',
          'Zoho Books',
          'Inngest',
        ],
        source_config: {
          tenant_id: oneDriveTenantId,
          client_id: oneDriveClientId,
          drive_id: oneDriveDriveId,
          allowed_senders: allowedSenders,
          auto_archive: true,
          scan_subfolders: true,
        },
        custom_config: {
          currency,
          volume: projectedVolume,
          variance_tolerance: varianceTolerance,
          confidence_threshold: confidenceThreshold,
          enable_sheets_sync: enableSheetsSync,
          notification_email: notificationEmail,
          default_income_account: defaultIncomeAccount,
          tax_rate_vat: taxRateVat,
          external_checks: {
            ...zohoChecks,
            ...storageChecks,
          },
        },
      });

      addLog('success', `🎉 Client organization "${name}" successfully registered and initialized!`);
      clearWizardDraft();
      setIsWizardOpen(false);
      setActiveTab('workspace');
    } catch (err: any) {
      addLog('error', `Failed to create client: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isWizardOpen) return null;

  const stepsList = [
    { num: 1, title: 'Profile & Blueprint', icon: Building2 },
    { num: 2, title: 'External Zoho Setup', icon: Sliders },
    { num: 3, title: 'External Ingestion', icon: Cloud },
    { num: 4, title: 'AI & Review Sheets', icon: Sparkles },
    { num: 5, title: 'Live Probe & Test', icon: Zap },
    { num: 6, title: 'Handover & Launch', icon: ShieldCheck },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-sky-500/30 rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/20">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">
                  New Client Onboarding & Setup Wizard
                </h2>
                <span className="text-[10px] bg-sky-500/15 border border-sky-500/30 text-sky-300 font-mono px-2 py-0.5 rounded-full font-bold">
                  Step {currentStep} of 6
                </span>
              </div>
              <p className="text-xs text-slate-400">
                End-to-end guidance for outside-of-app configurations (Google Drive, Zoho ERP, Email) and automated pipelines.
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsWizardOpen(false)}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Multi-Step Progress Tracker Bar */}
        <div className="px-6 py-3 bg-slate-950/40 border-b border-slate-800/80">
          <div className="grid grid-cols-6 gap-2">
            {stepsList.map((step) => {
              const StepIcon = step.icon;
              const isPast = currentStep > step.num;
              const isCurrent = currentStep === step.num;

              return (
                <button
                  key={step.num}
                  onClick={() => setCurrentStep(step.num)}
                  className={`flex items-center gap-2 py-2 px-2.5 rounded-xl text-left transition-all cursor-pointer ${
                    isCurrent
                      ? 'bg-sky-500/20 border border-sky-500/50 text-white shadow-md shadow-sky-500/10'
                      : isPast
                      ? 'bg-slate-900/60 border border-emerald-500/30 text-emerald-300 hover:bg-slate-850'
                      : 'bg-slate-900/30 border border-slate-800/50 text-slate-500 hover:bg-slate-850/50'
                  }`}
                >
                  <div
                    className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                      isCurrent
                        ? 'bg-sky-500 text-white'
                        : isPast
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    {isPast ? <Check className="w-3.5 h-3.5" /> : step.num}
                  </div>
                  <span className="text-[11px] font-semibold truncate hidden md:inline">
                    {step.title}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Wizard Step Body */}
        <div className="flex-1 p-6 overflow-y-auto custom-scrollbar space-y-6">

          {/* STEP 1: Profile & Industry Blueprint */}
          {currentStep === 1 && (
            <div className="space-y-6 animate-in fade-in">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-sky-400" />
                  <span>Client Organization Profile & Industry Blueprint</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Select an industry template to automatically configure document schemas, reconciliation rules, and accounting workflows.
                </p>
              </div>

              {/* Industry Preset Selector */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-2">
                  Select Industry Template
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {INDUSTRY_PRESETS.map((preset) => {
                    const isSelected = selectedIndustry === preset.id;
                    return (
                      <div
                        key={preset.id}
                        onClick={() => handleSelectIndustryPreset(preset.id)}
                        className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                          isSelected
                            ? 'bg-sky-500/15 border-sky-500/60 shadow-lg shadow-sky-500/10'
                            : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 hover:bg-slate-850'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-2xl">{preset.icon}</span>
                            {isSelected && (
                              <span className="text-[10px] bg-sky-500 text-white font-bold px-2 py-0.5 rounded-full">
                                Selected
                              </span>
                            )}
                          </div>
                          <h4 className="text-xs font-bold text-white">{preset.name}</h4>
                          <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                            {preset.description}
                          </p>
                        </div>
                        <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-sky-400 font-mono">
                          <span>{preset.defaultSource}</span>
                          <span>{preset.defaultVolume}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Form Inputs Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Client Organization Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Apex Logistics Ghana"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                      Accounting Currency
                    </label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500 cursor-pointer"
                    >
                      <option value="GHS">GHS (₵ - Ghana Cedi)</option>
                      <option value="USD">USD ($ - US Dollar)</option>
                      <option value="EUR">EUR (€ - Euro)</option>
                      <option value="GBP">GBP (£ - British Pound)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                      Client Icon
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={icon}
                        onChange={(e) => setIcon(e.target.value)}
                        className="w-14 text-center bg-slate-950 border border-slate-800 rounded-xl px-2 py-2.5 text-lg text-white focus:outline-none focus:border-sky-500"
                      />
                      <div className="flex gap-1">
                        {['🧺', '🏢', '⚡', '🚛', '🛍️', '🏥'].map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => setIcon(emoji)}
                            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm flex items-center justify-center cursor-pointer"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Target Monthly Volume
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 500+ Slips / mo"
                    value={projectedVolume}
                    onChange={(e) => setProjectedVolume(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Workflow Description
                  </label>
                  <input
                    type="text"
                    placeholder="Brief description of data flow..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: External Zoho Books ERP Setup */}
          {currentStep === 2 && (
            <div className="space-y-6 animate-in fade-in">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-sky-400" />
                  <span>Outside-of-App Setup: Client's Dedicated Zoho Books Organization</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Your clients sign up for and own their own Zoho Books accounts. Follow these steps to link this client's organization to your firm's automation pipeline.
                </p>
              </div>

              {/* Alert Callout */}
              <div className="bg-sky-950/40 border border-sky-500/30 rounded-xl p-4 flex items-start gap-3">
                <Info className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-300 space-y-1">
                  <span className="font-bold text-white">Multi-Tenant Accounting Architecture</span>
                  <p className="text-slate-400">
                    Each client has their own independent Zoho Books organization (with their own Organization ID). S4 Automations connects directly to that client's Zoho environment to draft invoices and post journals for <em>their</em> downstream customers.
                  </p>
                </div>
              </div>

              {/* Interactive External Checklist */}
              <div className="space-y-3">
                <label className="text-xs font-semibold text-slate-300 block">
                  Outside-of-App Setup Checklist for this Client
                </label>

                {/* Item 1 */}
                <div
                  onClick={() => setZohoChecks((prev) => ({ ...prev, org_id_retrieved: !prev.org_id_retrieved }))}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    zohoChecks.org_id_retrieved
                      ? 'bg-emerald-950/30 border-emerald-500/40'
                      : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center ${
                      zohoChecks.org_id_retrieved ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-slate-700 bg-slate-950'
                    }`}>
                      {zohoChecks.org_id_retrieved && <Check className="w-3.5 h-3.5" />}
                    </div>
                    <div className="flex-1 text-xs">
                      <span className="font-bold text-white block">1. Client's Zoho Books Organization &amp; Org ID</span>
                      <p className="text-slate-400 mt-1">
                        The client signs up or logs into their company's Zoho Books portal (<strong>books.zoho.com</strong>). Obtain the client's numeric <strong>Organization ID</strong> (e.g. <code className="text-sky-300 bg-slate-950 px-1 py-0.5 rounded">782910482</code>) from their top-right profile or <strong>Settings &gt; Organization Profile</strong>.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Item 2 */}
                <div
                  onClick={() => setZohoChecks((prev) => ({ ...prev, customer_created: !prev.customer_created }))}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    zohoChecks.customer_created
                      ? 'bg-emerald-950/30 border-emerald-500/40'
                      : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center ${
                      zohoChecks.customer_created ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-slate-700 bg-slate-950'
                    }`}>
                      {zohoChecks.customer_created && <Check className="w-3.5 h-3.5" />}
                    </div>
                    <div className="flex-1 text-xs">
                      <span className="font-bold text-white block">2. Invite Your Accounting Firm as Accountant / Admin</span>
                      <p className="text-slate-400 mt-1">
                        Inside the client's Zoho Books, they navigate to <strong>Settings &gt; Users &amp; Roles &gt; Invite User</strong> and invite your firm's email (e.g. <code className="text-sky-300 bg-slate-950 px-1 py-0.5 rounded">{notificationEmail || 'accounting@service4gh.com'}</code>) with the <strong>Accountant</strong> or <strong>Admin</strong> role.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Item 3 */}
                <div
                  onClick={() => setZohoChecks((prev) => ({ ...prev, chart_accounts_verified: !prev.chart_accounts_verified }))}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    zohoChecks.chart_accounts_verified
                      ? 'bg-emerald-950/30 border-emerald-500/40'
                      : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center ${
                      zohoChecks.chart_accounts_verified ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-slate-700 bg-slate-950'
                    }`}>
                      {zohoChecks.chart_accounts_verified && <Check className="w-3.5 h-3.5" />}
                    </div>
                    <div className="flex-1 text-xs">
                      <span className="font-bold text-white block">3. Register Client's Downstream Customers (Their Buyers/Hotels/Tenants)</span>
                      <p className="text-slate-400 mt-1">
                        In the client's Zoho Books (<strong>Sales &gt; Customers &gt; + New Customer</strong>), add the customers they bill (e.g. for ANR Laundry: <em>Luxwood Hotel</em>, <em>The Bantree</em>, <em>The Lennox</em>). Copy their Customer Contact IDs for downstream invoice drafting.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Item 4 */}
                <div
                  onClick={() => setZohoChecks((prev) => ({ ...prev, catalog_skus_registered: !prev.catalog_skus_registered }))}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    zohoChecks.catalog_skus_registered
                      ? 'bg-emerald-950/30 border-emerald-500/40'
                      : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center ${
                      zohoChecks.catalog_skus_registered ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-slate-700 bg-slate-950'
                    }`}>
                      {zohoChecks.catalog_skus_registered && <Check className="w-3.5 h-3.5" />}
                    </div>
                    <div className="flex-1 text-xs">
                      <span className="font-bold text-white block">4. Configure Client's Item Catalog &amp; Chart of Accounts</span>
                      <p className="text-slate-400 mt-1">
                        In the client's Zoho Books (<strong>Items &gt; Items</strong>), register their service items (e.g. <em>Bed Sheet Double</em>, <em>Face Towel</em>, <em>Bath Mat</em>) and link them to their primary revenue accounts and local tax rules (e.g. Ghana GRA 15% VAT + 2.5% NHIL + 2.5% GETFund).
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Zoho Organization ID & Dynamic API Sync */}
              <div className="space-y-4 pt-4 border-t border-slate-800">
                <div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1.5">
                    <label className="text-xs font-semibold text-slate-300">
                      Client's Zoho Books Organization ID <span className="text-slate-500 text-[10px]">(From client's Zoho account)</span>
                    </label>
                    <button
                      type="button"
                      onClick={handleFetchZohoData}
                      disabled={isFetchingZoho}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-400 hover:text-sky-300 bg-sky-950/80 hover:bg-sky-900 border border-sky-500/40 px-3 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-50"
                    >
                      <Users className={`w-3.5 h-3.5 ${isFetchingZoho ? 'animate-spin' : ''}`} />
                      <span>{isFetchingZoho ? 'Connecting API...' : 'Fetch Customers & Items via Zoho API'}</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="e.g. 782910482 (or leave default for mock sandbox)"
                    value={zohoOrgId}
                    onChange={(e) => setZohoOrgId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    S4 Automations connects directly to this Organization ID and automatically pulls all client customer profiles and catalog SKUs via API.
                  </span>
                </div>

                {/* Discovered Customers & SKUs Live Card */}
                {zohoSyncedContacts && zohoSyncedContacts.length > 0 && (
                  <div className="bg-gradient-to-r from-emerald-950/40 via-slate-950 to-sky-950/40 border border-emerald-500/40 rounded-xl p-4 space-y-3 animate-in fade-in">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-emerald-400" />
                        <span className="text-xs font-bold text-white">
                          Discovered Customers in this Zoho Books Account ({zohoSyncedContacts.length} Contacts)
                        </span>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-emerald-300 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-500/30">
                        {zohoSyncedItemsCount || 11} SKUs Synced
                      </span>
                    </div>

                    {/* Customer Badges Grid */}
                    <div className="flex flex-wrap gap-1.5">
                      {zohoSyncedContacts.map((contact, idx) => (
                        <span
                          key={contact.contact_id || idx}
                          className="inline-flex items-center gap-1.5 bg-slate-900 border border-slate-700/80 text-slate-200 text-xs px-2.5 py-1 rounded-lg"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          <span className="font-semibold">{contact.contact_name || contact.company_name}</span>
                          <span className="text-[10px] text-slate-400 font-mono">({contact.contact_id})</span>
                        </span>
                      ))}
                    </div>

                    <div className="text-[11px] text-slate-400 flex items-start gap-1.5 pt-1 border-t border-slate-800/80">
                      <Info className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
                      <span>
                        S4 Automations uses semantic OCR matching to automatically map each physical slip (e.g. <em>"Luxwood"</em>, <em>"Bantree"</em>) to the right customer contact when drafting invoices in Zoho Books.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: External Data Ingestion Channel Setup */}
          {currentStep === 3 && (
            <div className="space-y-6 animate-in fade-in">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Cloud className="w-4 h-4 text-sky-400" />
                  <span>Outside-of-App Setup: Data Ingestion Storage Channel</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Configure how physical handwritten slips or digital PDFs will be routed from the client's operations into S4 Automations.
                </p>
              </div>

              {/* Source Type Selector */}
              <div className="flex flex-wrap gap-2 p-1.5 bg-slate-950 border border-slate-800 rounded-xl">
                {[
                  { id: 'google_drive', label: 'Google Drive (Recommended)', icon: Folder },
                  { id: 'onedrive', label: 'Microsoft OneDrive / SharePoint', icon: Cloud },
                  { id: 'email', label: 'Automated Email Forwarding', icon: Mail },
                  { id: 'webhook', label: 'Direct Webhook / WhatsApp API', icon: Zap },
                ].map((type) => {
                  const IconComp = type.icon;
                  const isSel = sourceType === type.id;
                  return (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => setSourceType(type.id as any)}
                      className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        isSel ? 'bg-sky-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-850'
                      }`}
                    >
                      <IconComp className="w-3.5 h-3.5" />
                      <span>{type.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* GOOGLE DRIVE SETUP */}
              {sourceType === 'google_drive' && (
                <div className="space-y-4">
                  {/* Service Account Copy Box */}
                  <div className="bg-gradient-to-r from-sky-950/60 to-indigo-950/60 border border-sky-500/30 rounded-xl p-4">
                    <span className="text-[11px] font-bold text-sky-300 block mb-1">
                      Step 1: S4 Automations Service Account Email
                    </span>
                    <p className="text-xs text-slate-300 mb-2">
                      Share the client's Google Drive folder with this service account email with <strong>Editor</strong> access:
                    </p>
                    <div className="flex items-center justify-between bg-slate-950 border border-sky-500/40 rounded-lg p-2 font-mono text-xs text-sky-200">
                      <span className="truncate mr-2">{SERVICE_ACCOUNT_EMAIL}</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(SERVICE_ACCOUNT_EMAIL, 'sa_email')}
                        className="flex items-center gap-1 bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-bold px-2.5 py-1 rounded cursor-pointer shrink-0"
                      >
                        {copiedKey === 'sa_email' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedKey === 'sa_email' ? 'Copied!' : 'Copy Email'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Checklist */}
                  <div className="space-y-2.5">
                    <label className="text-xs font-semibold text-slate-300 block">
                      Google Drive Folder External Setup Checklist
                    </label>

                    <div
                      onClick={() => setStorageChecks((prev) => ({ ...prev, folder_created: !prev.folder_created }))}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center gap-3 ${
                        storageChecks.folder_created ? 'bg-emerald-950/30 border-emerald-500/40' : 'bg-slate-900/80 border-slate-800'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center ${storageChecks.folder_created ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-slate-700 bg-slate-950'}`}>
                        {storageChecks.folder_created && <Check className="w-3 h-3" />}
                      </div>
                      <span className="text-xs text-slate-300">
                        1. Created folder in Google Drive (e.g. <code className="text-sky-300">Client Name / Ingest / 2026</code>)
                      </span>
                    </div>

                    <div
                      onClick={() => setStorageChecks((prev) => ({ ...prev, service_account_shared: !prev.service_account_shared }))}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center gap-3 ${
                        storageChecks.service_account_shared ? 'bg-emerald-950/30 border-emerald-500/40' : 'bg-slate-900/80 border-slate-800'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center ${storageChecks.service_account_shared ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-slate-700 bg-slate-950'}`}>
                        {storageChecks.service_account_shared && <Check className="w-3 h-3" />}
                      </div>
                      <span className="text-xs text-slate-300">
                        2. Shared folder with S4 Service Account (<code className="text-sky-300">s4-vision-ingest@...</code>) as <strong>Editor</strong>
                      </span>
                    </div>

                    <div
                      onClick={() => setStorageChecks((prev) => ({ ...prev, subfolders_initialized: !prev.subfolders_initialized }))}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center gap-3 ${
                        storageChecks.subfolders_initialized ? 'bg-emerald-950/30 border-emerald-500/40' : 'bg-slate-900/80 border-slate-800'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center ${storageChecks.subfolders_initialized ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-slate-700 bg-slate-950'}`}>
                        {storageChecks.subfolders_initialized && <Check className="w-3 h-3" />}
                      </div>
                      <span className="text-xs text-slate-300">
                        3. Initialized subfolder hierarchy (<code className="text-sky-300">Daily_Slips/</code>, <code className="text-sky-300">Processed/</code>, <code className="text-sky-300">Review_Sheets/</code>)
                      </span>
                    </div>
                  </div>

                  {/* Input Folder ID */}
                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                      Google Drive Folder ID <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 1Uu_Q3p8s1_anr_laundry_slips (from drive.google.com/drive/folders/...)"
                      value={folderId}
                      onChange={(e) => setFolderId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Extracted from the URL when viewing the folder in your web browser.
                    </span>
                  </div>
                </div>
              )}

              {/* ONEDRIVE SETUP */}
              {sourceType === 'onedrive' && (
                <div className="space-y-4">
                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-2 text-xs text-slate-300">
                    <span className="font-bold text-white block">Microsoft Entra ID (Azure AD) Steps:</span>
                    <ol className="list-decimal pl-4 space-y-1 text-slate-400">
                      <li>Register an App Registration in Azure Portal for S4 Automations.</li>
                      <li>Grant API Permissions: <code className="text-sky-300 bg-slate-900 px-1 rounded">Files.ReadWrite.All</code> and <code className="text-sky-300 bg-slate-900 px-1 rounded">Sites.Read.All</code> with Admin Consent.</li>
                      <li>Create a Client Secret under Certificates &amp; Secrets.</li>
                    </ol>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">Azure Tenant ID</label>
                      <input
                        type="text"
                        placeholder="e.g. 3a5b8c9d-..."
                        value={oneDriveTenantId}
                        onChange={(e) => setOneDriveTenantId(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">Azure Client ID</label>
                      <input
                        type="text"
                        placeholder="e.g. 9f8e7d6c-..."
                        value={oneDriveClientId}
                        onChange={(e) => setOneDriveClientId(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">Client Secret</label>
                      <input
                        type="password"
                        placeholder="••••••••••••••••"
                        value={oneDriveSecret}
                        onChange={(e) => setOneDriveSecret(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-xs font-semibold text-slate-300 block mb-1">
                        OneDrive / SharePoint Folder URL or Path
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. https://service4limitedcompany.sharepoint.com/sites/s4bookkeeping/Shared%20Documents/General/Opera%20square/Ingestion"
                        value={oneDriveDriveId}
                        onChange={(e) => setOneDriveDriveId(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono"
                      />
                      <span className="text-[10px] text-slate-400 mt-1 block">
                        You can paste full SharePoint web folder URLs directly copied from your web browser.
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* EMAIL SETUP */}
              {sourceType === 'email' && (
                <div className="space-y-4">
                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-2 text-xs text-slate-300">
                    <span className="font-bold text-white block">Email Server Forwarding Rule:</span>
                    <p className="text-slate-400">
                      In the client's mail server (Exchange, Microsoft 365, or Google Workspace), create a rule to automatically forward incoming invoice/receipt PDFs from designated vendors to this dedicated inbound alias:
                    </p>
                    <div className="flex items-center justify-between bg-slate-900 border border-slate-700 rounded-lg p-2 font-mono text-xs text-sky-300">
                      <span>{sourceEmail || 'client@inbound.service4gh.com'}</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(sourceEmail, 'inbound_email')}
                        className="bg-sky-600 text-white text-[11px] px-2 py-1 rounded cursor-pointer"
                      >
                        {copiedKey === 'inbound_email' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1">
                      Allowed Sender Whitelist <span className="text-slate-500 text-[10px]">(Comma-separated emails)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. billing@clientdomain.com, frontdesk@hotel.com"
                      value={allowedSenders}
                      onChange={(e) => setAllowedSenders(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono"
                    />
                  </div>
                </div>
              )}

              {/* WEBHOOK SETUP */}
              {sourceType === 'webhook' && (
                <div className="space-y-4">
                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 text-xs text-slate-300 space-y-2">
                    <span className="font-bold text-white block">Real-time Webhook URL:</span>
                    <div className="p-2.5 bg-slate-900 border border-slate-700 rounded-lg font-mono text-xs text-sky-300 break-all">
                      https://autapi.service4gh.com/api/v1/webhooks/{name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '_') : 'client'}
                    </div>
                    <p className="text-slate-400">
                      Configure WhatsApp Business API or POS webhook subscriptions to POST raw payloads or image URLs to this endpoint.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 4: AI Extraction Strategy & Guardrails */}
          {currentStep === 4 && (
            <div className="space-y-6 animate-in fade-in">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-sky-400" />
                  <span>AI Extraction Strategy & Quality Guardrails</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Configure vision OCR models, discrepancy thresholds, and review workbook sync settings.
                </p>
              </div>

              {/* Model Blueprint Options */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  {
                    id: 'gemini_flash_vision',
                    name: 'Gemini 3.6 Flash Vision OCR',
                    tag: 'Physical Slips & Handwritten Forms',
                    desc: 'Extracts dates, handwritten item names, pickup/delivery quantities, and computes loss discrepancy (pickup - delivery).',
                  },
                  {
                    id: 'pdf_bank_parser',
                    name: 'Structured PDF & Bank Feed Parser',
                    tag: 'Bank Statements & Wire Feeds',
                    desc: 'Parses multi-currency statement transactions, balance lines, and auto-categorizes against general ledger chart of accounts.',
                  },
                  {
                    id: 'rent_receipt_matcher',
                    name: 'Tenant Rent & Utility Apportionment',
                    tag: 'Receipts & Sub-metering',
                    desc: 'Parses tenant mobile money / bank receipts and apportions master utility invoices across occupied rental units.',
                  },
                  {
                    id: 'invoice_ocr',
                    name: 'Commercial Invoice & POS Tally OCR',
                    tag: 'Vendor Bills & Register Reports',
                    desc: 'Extracts line items, sub-totals, GRA VAT/NHIL/GETFund breakdowns, and PO numbers for ERP matching.',
                  },
                ].map((eng) => (
                  <div
                    key={eng.id}
                    onClick={() => setAiEngine(eng.id)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                      aiEngine === eng.id
                        ? 'bg-sky-500/15 border-sky-500/60 shadow-lg shadow-sky-500/10'
                        : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-white">{eng.name}</span>
                        {aiEngine === eng.id && <Check className="w-4 h-4 text-sky-400" />}
                      </div>
                      <span className="inline-block text-[10px] bg-slate-950 border border-slate-800 text-sky-400 px-2 py-0.5 rounded-full mb-2">
                        {eng.tag}
                      </span>
                      <p className="text-xs text-slate-400">{eng.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Guardrails Sliders */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-800">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">Discrepancy Variance Tolerance Cap</span>
                    <span className="font-mono text-sky-400 font-bold">{varianceTolerance}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    step="0.5"
                    value={varianceTolerance}
                    onChange={(e) => setVarianceTolerance(parseFloat(e.target.value))}
                    className="w-full accent-sky-500 cursor-pointer"
                  />
                  <p className="text-[11px] text-slate-500">
                    Flag transactions with unit count or amount variance greater than {varianceTolerance}% for CPA manual review.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">Minimum AI Confidence Score</span>
                    <span className="font-mono text-sky-400 font-bold">{confidenceThreshold}%</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="100"
                    step="5"
                    value={confidenceThreshold}
                    onChange={(e) => setConfidenceThreshold(parseInt(e.target.value))}
                    className="w-full accent-sky-500 cursor-pointer"
                  />
                  <p className="text-[11px] text-slate-500">
                    Extractions below {confidenceThreshold}% confidence are marked as LOW confidence for human audit.
                  </p>
                </div>
              </div>

              {/* Review Workbook & Notification Toggles */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div
                  onClick={() => setEnableSheetsSync(!enableSheetsSync)}
                  className={`p-3.5 rounded-xl border flex items-center justify-between cursor-pointer transition ${
                    enableSheetsSync ? 'bg-sky-500/10 border-sky-500/40' : 'bg-slate-900/80 border-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-sky-400" />
                    <div>
                      <span className="text-xs font-bold text-white block">Google Sheets 2-Tier Review Sync</span>
                      <span className="text-[10px] text-slate-400">Generate Tab 1 (Daily Slips) &amp; Tab 2 (Monthly Rollup)</span>
                    </div>
                  </div>
                  <div className={`w-5 h-5 rounded border flex items-center justify-center ${enableSheetsSync ? 'bg-sky-600 border-sky-500 text-white' : 'border-slate-700 bg-slate-950'}`}>
                    {enableSheetsSync && <Check className="w-3.5 h-3.5" />}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    CPA Alert &amp; Summary Digest Email
                  </label>
                  <input
                    type="email"
                    value={notificationEmail}
                    onChange={(e) => setNotificationEmail(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: Live Probe & Dry-Run Test */}
          {currentStep === 5 && (
            <div className="space-y-6 animate-in fade-in">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Zap className="w-4 h-4 text-sky-400" />
                  <span>Live Connectivity Probe &amp; Sample OCR Dry-Run</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Verify end-to-end connectivity with external channels and preview structured AI extraction results.
                </p>
              </div>

              {/* Live Probe Section */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-white flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-sky-400" />
                      <span>Channel Connectivity Probe</span>
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Pings Google Drive folder permissions, Inbound email routing, and Zoho Books configuration.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleRunProbe}
                    disabled={isProbing}
                    className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white text-xs font-bold py-2 px-4 rounded-xl shadow-md shadow-sky-600/30 transition cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isProbing ? 'animate-spin' : ''}`} />
                    <span>{isProbing ? 'Probing...' : 'Run Live Probe'}</span>
                  </button>
                </div>

                {/* Probe Output */}
                {probeResult && (
                  <div className={`p-4 rounded-xl border space-y-3 ${
                    probeResult.success ? 'bg-emerald-950/30 border-emerald-500/40' : 'bg-amber-950/30 border-amber-500/40'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${
                        probeResult.success ? 'text-emerald-300' : 'text-amber-300'
                      }`}>
                        {probeResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-amber-400" />}
                        <span>{probeResult.status}: {probeResult.summary}</span>
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {new Date(probeResult.timestamp).toLocaleTimeString()}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {probeResult.checks?.map((chk, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs bg-slate-900/80 p-2.5 rounded-lg">
                          <div>
                            <span className="font-semibold text-white block">{chk.target}</span>
                            <span className="text-slate-400 text-[11px]">{chk.message}</span>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                            chk.status === 'PASS' ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30' : 'bg-amber-950 text-amber-300 border border-amber-500/30'
                          }`}>
                            {chk.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Sample Document Dry Run Section */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-bold text-white flex items-center gap-2">
                      <Eye className="w-4 h-4 text-indigo-400" />
                      <span>Sample Document OCR Extraction Preview</span>
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Simulate vision extraction and SKU reconciliation on sample documents for {name || 'this client'}.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={selectedSamplePreset}
                      onChange={(e) => setSelectedSamplePreset(e.target.value)}
                      className="bg-slate-900 border border-slate-700 text-xs text-white rounded-lg px-2.5 py-1.5 focus:outline-none"
                    >
                      <option value="laundry_slip">Handwritten Laundry Slip</option>
                      <option value="bank_statement">Corporate Bank Statement</option>
                      <option value="commercial_invoice">Commercial Invoice PDF</option>
                    </select>

                    <button
                      type="button"
                      onClick={handleRunDryRun}
                      disabled={isDryRunning}
                      className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-2 px-3.5 rounded-xl shadow-md transition cursor-pointer disabled:opacity-50"
                    >
                      <Sparkles className={`w-3.5 h-3.5 ${isDryRunning ? 'animate-spin' : ''}`} />
                      <span>{isDryRunning ? 'Extracting...' : 'Test OCR Extraction'}</span>
                    </button>
                  </div>
                </div>

                {/* Dry Run Output Table */}
                {dryRunResult && (
                  <div className="border border-slate-800 rounded-xl overflow-hidden animate-in fade-in">
                    <div className="bg-slate-900/90 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">{dryRunResult.preset}</span>
                        <span className="text-[10px] text-slate-400 font-mono">({dryRunResult.document_name})</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-emerald-400 font-mono font-bold">
                          Confidence: {(dryRunResult.overall_confidence * 100).toFixed(0)}%
                        </span>
                        <span className="text-[11px] text-sky-400 font-mono font-bold">
                          Total: {currency} {dryRunResult.total_value?.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800">
                          <tr>
                            <th className="py-2 px-3">Extracted Slip Text</th>
                            <th className="py-2 px-3">Matched Zoho SKU</th>
                            <th className="py-2 px-3 text-right">Pickup / Delivery</th>
                            <th className="py-2 px-3 text-right">Loss / Discrepancy</th>
                            <th className="py-2 px-3 text-right">Amount ({currency})</th>
                            <th className="py-2 px-3 text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 text-slate-300">
                          {dryRunResult.items?.map((item, idx) => (
                            <tr key={idx} className="hover:bg-slate-850/50">
                              <td className="py-2 px-3 font-mono font-bold text-white">
                                {item.raw_handwritten_text}
                              </td>
                              <td className="py-2 px-3 text-sky-300">{item.matched_sku}</td>
                              <td className="py-2 px-3 text-right font-mono">
                                {item.pickup_qty !== undefined ? `${item.pickup_qty} / ${item.delivery_qty}` : item.debit ? `Debit ${item.debit}` : '-'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono">
                                {item.discrepancy ? (
                                  <span className="text-amber-400 font-bold">+{item.discrepancy} Lost</span>
                                ) : (
                                  <span className="text-emerald-400">0</span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-white">
                                {(item.total_amount || item.credit || item.debit || 0).toFixed(2)}
                              </td>
                              <td className="py-2 px-3 text-center">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  item.status === 'MATCHED' ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300'
                                }`}>
                                  {item.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 6: Handover & Launch */}
          {currentStep === 6 && (
            <div className="space-y-6 animate-in fade-in">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Client Onboarding Handover Card &amp; Launch</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Review the operational handover package and finalize the client workspace.
                </p>
              </div>

              {/* Ready Summary Card */}
              <div className="bg-gradient-to-r from-emerald-950/40 via-slate-900 to-sky-950/40 border border-emerald-500/30 rounded-2xl p-5 shadow-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-2xl">
                    {icon || '🏢'}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">{name || 'New Accounting Client'}</h3>
                    <p className="text-xs text-emerald-400 font-medium">
                      {INDUSTRY_PRESETS.find((p) => p.id === selectedIndustry)?.name} • Ready for Production Ingestion
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Ingestion Source</span>
                    <span className="font-bold text-white font-mono">{sourceType}</span>
                  </div>
                  <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Currency</span>
                    <span className="font-bold text-white font-mono">{currency}</span>
                  </div>
                  <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Target Volume</span>
                    <span className="font-bold text-white font-mono">{projectedVolume}</span>
                  </div>
                  <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Zoho Org ID</span>
                    <span className="font-bold text-white font-mono">{zohoOrgId || 'Mock / Unlinked'}</span>
                  </div>
                </div>
              </div>

              {/* Copyable Operational Handover Sheet */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-sky-400" />
                    <span className="text-xs font-bold text-white">Client Operations Handover Instructions</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const handoverText = `
# S4 Automations - Client Ingestion Handover
Client Name: ${name}
Industry: ${selectedIndustry}
Operating Currency: ${currency}

## Document Routing Instructions
- Storage Channel: ${sourceType}
${sourceType === 'google_drive' ? `- Google Drive Folder ID: ${folderId}\n- Service Account Email: ${SERVICE_ACCOUNT_EMAIL}` : ''}
${sourceType === 'email' ? `- Inbound Email Alias: ${sourceEmail}` : ''}

## Slip Photography & Upload Guidelines
1. Ensure full handwritten control slip is clearly lit without heavy shadows.
2. Verify Pickup and Delivery count columns are legibly marked.
3. Upload slips daily to the designated Google Drive folder or forward PDF to ${sourceEmail}.

## Accounting & Billing Contact
- CPA Reviewer: ${notificationEmail}
- Invoicing Engine: Zoho Books (Automated 1-Click Draft Generation)
                      `.trim();
                      copyToClipboard(handoverText, 'handover_sheet');
                    }}
                    className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer transition"
                  >
                    {copiedKey === 'handover_sheet' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
                    <span>{copiedKey === 'handover_sheet' ? 'Copied Handover Text!' : 'Copy Handover Card'}</span>
                  </button>
                </div>

                <div className="p-3 bg-slate-900 rounded-lg text-xs font-mono text-slate-300 space-y-1 max-h-40 overflow-y-auto custom-scrollbar border border-slate-800">
                  <p className="text-sky-300 font-bold"># Operations Handover for {name || 'Client'}</p>
                  <p className="text-slate-400">• Dedicated Ingestion: {sourceType === 'google_drive' ? `Google Drive Folder ID ${folderId || '1Uu_...'}` : sourceEmail}</p>
                  <p className="text-slate-400">• AI Vision Engine: {aiEngine}</p>
                  <p className="text-slate-400">• Zoho Books Org ID: {zohoOrgId || 'Default / Sandbox'}</p>
                  <p className="text-slate-400">• Customer Directory: Multi-Customer Live API Sync ({zohoSyncedContacts?.length || 'Dynamic'} Customers Synced)</p>
                  <p className="text-slate-400">• Review Workflow: Google Sheets 2-Tier Review &amp; Zoho Draft Billing</p>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Wizard Footer Navigation */}
        <div className="px-6 py-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between">
          <div>
            {currentStep > 1 && (
              <button
                type="button"
                onClick={handlePrevStep}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold py-2.5 px-4 rounded-xl transition cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsWizardOpen(false)}
              className="text-xs text-slate-400 hover:text-slate-200 py-2 px-3 font-semibold transition cursor-pointer"
            >
              Cancel
            </button>

            {currentStep < 6 ? (
              <button
                type="button"
                onClick={handleNextStep}
                disabled={currentStep === 1 && !name.trim()}
                className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white text-xs font-bold py-2.5 px-5 rounded-xl shadow-lg shadow-sky-600/30 transition cursor-pointer disabled:opacity-50"
              >
                <span>Continue to Step {currentStep + 1}</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleLaunchClient}
                disabled={isSubmitting || !name.trim()}
                className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-extrabold py-2.5 px-6 rounded-xl shadow-xl shadow-emerald-600/30 transition cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCheck className="w-4 h-4" />
                )}
                <span>{isSubmitting ? 'Initializing Workspace...' : 'Launch Client Workspace'}</span>
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
